'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { Op } = require('sequelize');
const db = require('../models');
const { loadAccountRegistry } = require('../services/bankStatementAccounts');
const { parseBankStatement } = require('../services/bankStatementParser');

const ROOT = path.resolve(__dirname, '..');
const DATA_SOURCE = path.join(ROOT, 'data-source', 'Statements');
const REGISTRY = loadAccountRegistry();

const args = new Set(process.argv.slice(2));
const dryRun = args.has('--dry-run');
const scanSource = args.has('--scan-source');
const syncBalances = !args.has('--no-balances');
const syncSnapshots = args.has('--snapshots');

function money(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return number.toFixed(2);
}

function normalizeDate(value) {
  if (!value) return null;
  return String(value).slice(0, 10);
}

function parseJson(value) {
  try {
    return JSON.parse(value || '{}');
  } catch (err) {
    return {};
  }
}

function appendNote(existing, addition) {
  const current = String(existing || '').trim();
  if (!addition) return current;
  if (!current) return addition;
  if (current.includes(addition)) return current;
  return `${current} ${addition}`;
}

function registryAccounts() {
  return (REGISTRY.accounts || []).filter((account) => account.ledgerAccountSpec);
}

function findRegistryByNumber({ accountNumber, last4, accountType }) {
  const number = String(accountNumber || '');
  const suffix = String(last4 || (number ? number.slice(-4) : ''));
  const type = String(accountType || '').toLowerCase();

  return registryAccounts().find((account) => {
    const exactNumber = number && (account.accountNumbers || []).includes(number);
    const exactLast4 = suffix && (account.last4 || []).includes(suffix);
    const typeMatches = !type || !account.accountType || String(account.accountType).toLowerCase() === type;
    return (exactNumber || exactLast4) && typeMatches;
  }) || null;
}

function chooseLatest(balanceMap, key, candidate) {
  if (!key || candidate.balance == null || !candidate.statementDate) return;
  const current = balanceMap.get(key);
  if (!current || String(candidate.statementDate) > String(current.statementDate)) {
    balanceMap.set(key, candidate);
  }
}

function addBankingSummaries(balanceMap, metadata, source) {
  const statementDate = normalizeDate(metadata.statementDate || metadata.billingPeriodEnd || source.statementDate);
  for (const summary of metadata.bankingAccountSummaries || []) {
    const registryAccount = findRegistryByNumber({
      accountNumber: summary.accountNumber,
      last4: summary.accountLast4,
      accountType: summary.accountClass
    });
    chooseLatest(balanceMap, registryAccount && registryAccount.key, {
      statementDate,
      balance: Number(summary.closingBalance),
      source: source.source,
      sourceId: source.sourceId,
      sourceName: source.sourceName,
      sourcePath: source.sourcePath,
      accountLast4: summary.accountLast4 || String(summary.accountNumber || '').slice(-4)
    });
  }
}

function addCertificateSummaries(balanceMap, metadata, source) {
  const statementDate = normalizeDate(metadata.statementDate || metadata.billingPeriodEnd || source.statementDate);
  const certificateSummary = metadata.certificateOfDepositSummaries || [];
  const summaries = Array.isArray(certificateSummary) ? certificateSummary : (certificateSummary.accounts || []);
  for (const summary of summaries) {
    const registryAccount = findRegistryByNumber({
      accountNumber: summary.accountNumber,
      last4: summary.accountLast4,
      accountType: 'cd'
    });
    const balance = summary.balanceAsOfStatementDate ?? summary.closingBalance ?? summary.principalBalance;
    chooseLatest(balanceMap, registryAccount && registryAccount.key, {
      statementDate,
      balance: Number(balance),
      source: source.source,
      sourceId: source.sourceId,
      sourceName: source.sourceName,
      sourcePath: source.sourcePath,
      accountLast4: summary.accountLast4 || String(summary.accountNumber || '').slice(-4)
    });
  }
}

function addCreditCardBalance(balanceMap, notes, metadata, source) {
  const key = notes.accountScopeKey || (notes.accountResolution && notes.accountResolution.registryKey);
  const registryAccount = (REGISTRY.accounts || []).find((account) => account.key === key);
  if (!registryAccount || registryAccount.accountType !== 'credit_card' || metadata.newBalance == null) return;
  chooseLatest(balanceMap, key, {
    statementDate: normalizeDate(metadata.statementDate || metadata.billingPeriodEnd || source.statementDate),
    balance: -Number(metadata.newBalance),
    source: source.source,
    sourceId: source.sourceId,
    sourceName: source.sourceName,
    sourcePath: source.sourcePath,
    accountLast4: notes.accountLast4
  });
}

async function collectPostedBalances() {
  const balanceMap = new Map();
  const batches = await db.ImportBatch.findAll({
    where: { status: 'posted' },
    attributes: ['id', 'fileName', 'notes'],
    order: [['id', 'DESC']],
    raw: true
  });

  for (const batch of batches) {
    const notes = parseJson(batch.notes);
    const metadata = notes.metadata || {};
    const source = {
      source: 'posted_import_batch',
      sourceId: batch.id,
      sourceName: batch.fileName,
      statementDate: metadata.statementDate || metadata.billingPeriodEnd
    };
    addCreditCardBalance(balanceMap, notes, metadata, source);
    addBankingSummaries(balanceMap, metadata, source);
    addCertificateSummaries(balanceMap, metadata, source);
  }

  return balanceMap;
}

function listPdfFiles(folder) {
  if (!fs.existsSync(folder)) return [];
  const files = [];
  for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
    const fullPath = path.join(folder, entry.name);
    if (entry.isDirectory()) files.push(...listPdfFiles(fullPath));
    else if (entry.isFile() && /\.pdf$/i.test(entry.name)) files.push(fullPath);
  }
  return files.sort((a, b) => a.localeCompare(b));
}

function uniquePdfFiles() {
  const grouped = new Map();
  for (const filePath of listPdfFiles(DATA_SOURCE)) {
    const buffer = fs.readFileSync(filePath);
    const hash = crypto.createHash('sha256').update(buffer).digest('hex');
    if (!grouped.has(hash)) {
      grouped.set(hash, {
        buffer,
        filePath,
        relativePath: path.relative(ROOT, filePath)
      });
    }
  }
  return Array.from(grouped.values()).sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}

function profileForPath(filePath) {
  return /aadvantage|advantage/i.test(filePath) ? 'advantage_citi_pdf' : 'citi_checking_pdf';
}

async function collectSourceBalances(existingMap) {
  const balanceMap = new Map(existingMap);
  const files = uniquePdfFiles();
  let parsedCount = 0;
  const failures = [];

  for (const file of files) {
    const profile = profileForPath(file.filePath);
    try {
      const parsed = await parseBankStatement({ buffer: file.buffer, profile });
      const metadata = parsed.metadata || {};
      const source = {
        source: 'statement_pdf_scan',
        sourceName: path.basename(file.filePath),
        sourcePath: file.relativePath,
        statementDate: metadata.statementDate || metadata.billingPeriodEnd
      };
      addCreditCardBalance(balanceMap, {
        accountScopeKey: profile === 'advantage_citi_pdf' ? 'citi_aadvantage_primary' : null,
        accountLast4: metadata.accountLast4
      }, metadata, source);
      addBankingSummaries(balanceMap, metadata, source);
      addCertificateSummaries(balanceMap, metadata, source);
      parsedCount += 1;
    } catch (err) {
      failures.push({ file: file.relativePath, profile, error: err.message });
    }
  }

  return { balanceMap, parsedCount, failures };
}

async function ensureCitiInstitution() {
  if (dryRun) {
    const existing = await db.FinancialInstitution.findOne({ where: { name: 'Citi' } });
    return existing || { id: null, name: 'Citi' };
  }
  const [institution] = await db.FinancialInstitution.findOrCreate({
    where: { name: 'Citi' },
    defaults: {
      institutionType: 'bank',
      website: 'https://www.citi.com',
      notes: 'Created for Citi statement account imports.',
      isActive: true
    }
  });
  return institution;
}

async function findExistingAccount(accountSpec, last4) {
  let account = await db.Account.findOne({ where: { accountCode: accountSpec.accountCode } });
  if (account) return account;
  account = await db.Account.findOne({ where: { name: accountSpec.name } });
  if (account) return account;
  if (!last4) return null;

  const candidates = await db.Account.findAll({
    where: { status: { [Op.notIn]: ['inactive', 'closed'] } },
    order: [['id', 'ASC']]
  });
  const pattern = new RegExp(`(^|\\D)${last4}(\\D|$)`);
  return candidates.find((row) => {
    const haystack = [row.name, row.accountCode, row.notes].filter(Boolean).join(' ');
    return pattern.test(haystack);
  }) || null;
}

function accountUpdates(account, spec, registryAccount, institutionId, balanceInfo) {
  const updates = {};
  const desired = {
    name: spec.name,
    accountCode: spec.accountCode,
    accountType: spec.accountType,
    accountClass: spec.accountClass,
    accountSubtype: spec.accountSubtype,
    currency: spec.currency || 'USD',
    status: spec.status || 'active',
    includeInNetWorth: spec.includeInNetWorth !== false
  };

  for (const [key, value] of Object.entries(desired)) {
    if (value !== undefined && value !== null && String(account[key]) !== String(value)) {
      updates[key] = value;
    }
  }

  if (!account.financialInstitutionId && institutionId) {
    updates.financialInstitutionId = institutionId;
  }

  if (balanceInfo && balanceInfo.balance != null) {
    const syncedBalance = money(balanceInfo.balance);
    if (String(account.currentBalance) !== syncedBalance) {
      updates.currentBalance = syncedBalance;
    }
  }

  let notes = appendNote(account.notes, spec.notes);
  notes = appendNote(notes, `Statement registry key: ${registryAccount.key}.`);
  if (balanceInfo && balanceInfo.statementDate) {
    notes = appendNote(notes, `Latest statement balance synced from ${balanceInfo.source} as of ${balanceInfo.statementDate}.`);
  }
  if (String(account.notes || '') !== notes) updates.notes = notes;

  return updates;
}

async function syncSnapshot(accountId, balanceInfo) {
  if (!syncSnapshots || !balanceInfo || balanceInfo.balance == null || !balanceInfo.statementDate) return null;
  const where = {
    accountId,
    snapshotDate: balanceInfo.statementDate,
    source: 'statement_sync'
  };
  const payload = {
    ...where,
    balance: money(balanceInfo.balance),
    currency: 'USD',
    notes: `Synced from ${balanceInfo.source}${balanceInfo.sourceName ? `: ${balanceInfo.sourceName}` : ''}.`,
    isSimulation: false
  };
  const existing = await db.AccountBalanceSnapshot.findOne({ where });
  if (existing) {
    if (!dryRun) await existing.update(payload);
    return { action: 'updated', id: existing.id };
  }
  if (!dryRun) {
    const created = await db.AccountBalanceSnapshot.create(payload);
    return { action: 'created', id: created.id };
  }
  return { action: 'created', id: null };
}

async function main() {
  const institution = await ensureCitiInstitution();
  let balanceMap = syncBalances ? await collectPostedBalances() : new Map();
  let sourceScan = null;

  if (syncBalances && scanSource) {
    sourceScan = await collectSourceBalances(balanceMap);
    balanceMap = sourceScan.balanceMap;
  }

  const report = {
    dryRun,
    scanSource,
    syncBalances,
    syncSnapshots,
    parsedSourcePdfs: sourceScan ? sourceScan.parsedCount : 0,
    sourceFailures: sourceScan ? sourceScan.failures : [],
    accounts: []
  };

  for (const registryAccount of registryAccounts()) {
    const spec = registryAccount.ledgerAccountSpec;
    const last4 = (registryAccount.last4 || [])[0] || '';
    const balanceInfo = balanceMap.get(registryAccount.key) || null;
    let account = await findExistingAccount(spec, last4);
    let action = 'unchanged';

    if (!account) {
      action = 'created';
      const payload = {
        name: spec.name,
        accountCode: spec.accountCode,
        accountType: spec.accountType,
        accountClass: spec.accountClass,
        accountSubtype: spec.accountSubtype,
        currency: spec.currency || 'USD',
        financialInstitutionId: institution.id,
        currentBalance: balanceInfo ? money(balanceInfo.balance) : '0.00',
        status: spec.status || 'active',
        includeInNetWorth: spec.includeInNetWorth !== false,
        notes: appendNote(
          appendNote(spec.notes, `Statement registry key: ${registryAccount.key}.`),
          balanceInfo && balanceInfo.statementDate
            ? `Latest statement balance synced from ${balanceInfo.source} as of ${balanceInfo.statementDate}.`
            : ''
        )
      };
      if (!dryRun) account = await db.Account.create(payload);
      else account = { id: null, ...payload };
    } else {
      const updates = accountUpdates(account, spec, registryAccount, institution.id, balanceInfo);
      if (Object.keys(updates).length) {
        action = 'updated';
        if (!dryRun) {
          await account.update(updates);
          account = await db.Account.findByPk(account.id);
        } else {
          account = { ...account.get({ plain: true }), ...updates };
        }
      }
    }

    const snapshot = account.id ? await syncSnapshot(account.id, balanceInfo) : null;
    report.accounts.push({
      key: registryAccount.key,
      action,
      id: account.id,
      name: account.name,
      accountCode: account.accountCode,
      accountClass: account.accountClass,
      currentBalance: account.currentBalance,
      balanceDate: balanceInfo && balanceInfo.statementDate,
      balanceSource: balanceInfo && balanceInfo.source,
      balanceSourceName: balanceInfo && balanceInfo.sourceName,
      snapshot
    });
  }

  console.log(JSON.stringify(report, null, 2));
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.sequelize.close();
  });
