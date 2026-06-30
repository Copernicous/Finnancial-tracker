'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { Op } = require('sequelize');
const db = require('../models');
const {
  parseBankStatement,
  parseCitiBankingStatement,
  PROFILE_CONFIG
} = require('../services/bankStatementParser');
const merchantResolver = require('../services/merchantResolver');
const {
  loadAccountRegistry,
  matchRegistryAccount,
  accountLabel
} = require('../services/bankStatementAccounts');
const { validateStatementTotals } = require('../services/bankStatementValidation');

const ROOT = path.resolve(__dirname, '..');
const DATA_SOURCE = path.join(ROOT, 'data-source', 'Statements');
const ACCOUNT_REGISTRY = loadAccountRegistry();

const KNOWN_FOLDERS = [
  {
    label: 'Citi AAdvantage Credit Card Statement 3888',
    profile: 'advantage_citi_pdf',
    folder: path.join(DATA_SOURCE, 'Citi AAdvantage Credit Card Statement 3888')
  },
  {
    label: 'Citi Checking Statement 8384',
    profile: 'citi_checking_pdf',
    folder: path.join(DATA_SOURCE, 'Citi Checking Statement 8384')
  },
  {
    label: 'Citi Ultimate Plus Statement 2950',
    profile: 'citi_ultimate_plus_pdf',
    folder: path.join(DATA_SOURCE, 'Citi Ultimate Plus Statement 2950')
  },
  {
    label: 'Day To Day Savings Statement 8293',
    profile: 'citi_savings_pdf',
    folder: path.join(DATA_SOURCE, 'Day To Day Savings Statement 8293')
  }
];

function hasFlag(flag) {
  return process.argv.includes(flag);
}

function getArgValue(name) {
  const prefix = `${name}=`;
  const found = process.argv.find((arg) => arg.startsWith(prefix));
  return found ? found.slice(prefix.length) : null;
}

function selectedProfile() {
  return getArgValue('--profile') || getArgValue('--only-profile') || null;
}

function shouldProcessStatementForProfile(item, profileFilter) {
  if (!profileFilter) return true;
  const isCredit = item.copies.some((copy) => copy.profile === 'advantage_citi_pdf');
  if (profileFilter === 'advantage_citi_pdf') return isCredit;
  return !isCredit;
}

function listPdfFiles(folder) {
  if (!fs.existsSync(folder)) return [];
  const out = [];
  for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
    const fullPath = path.join(folder, entry.name);
    if (entry.isDirectory()) out.push(...listPdfFiles(fullPath));
    else if (entry.isFile() && /\.pdf$/i.test(entry.name)) out.push(fullPath);
  }
  return out.sort((a, b) => a.localeCompare(b));
}

function isInsideFolder(filePath, folder) {
  const relative = path.relative(folder, filePath);
  return relative && !relative.startsWith('..') && !path.isAbsolute(relative);
}

function folderSpecForFile(filePath) {
  const known = KNOWN_FOLDERS.find((spec) => isInsideFolder(filePath, spec.folder));
  if (known) return known;
  const relative = path.relative(DATA_SOURCE, filePath);
  const topLevel = relative.split(path.sep)[0] || 'data-source';
  return {
    label: topLevel,
    profile: null,
    folder: path.join(DATA_SOURCE, topLevel)
  };
}

function collectStatementFiles() {
  const files = listPdfFiles(DATA_SOURCE);
  const grouped = new Map();

  for (const filePath of files) {
    const buffer = fs.readFileSync(filePath);
    const hash = crypto.createHash('sha256').update(buffer).digest('hex');
    const spec = folderSpecForFile(filePath);
    if (!grouped.has(hash)) {
      grouped.set(hash, {
        hash,
        buffer,
        samplePath: filePath,
        copies: []
      });
    }
    grouped.get(hash).copies.push({
      filePath,
      relativePath: path.relative(ROOT, filePath),
      folder: spec.label,
      profile: spec.profile
    });
  }

  return Array.from(grouped.values()).sort((a, b) => a.samplePath.localeCompare(b.samplePath));
}

function appendNote(existing, addition) {
  const current = String(existing || '').trim();
  if (!current) return addition;
  if (current.includes(addition)) return current;
  return `${current} ${addition}`;
}

function rowSoftKey({ date, description, amount, accountId }) {
  const amountNumber = Number(amount || 0);
  return [
    date || '',
    String(description || '').replace(/\s+/g, ' ').trim().toLowerCase(),
    Number.isFinite(amountNumber) ? Math.abs(amountNumber).toFixed(2) : '',
    accountId || ''
  ].join('|');
}

function parsedRowSoftKey(row, accountId) {
  return rowSoftKey({
    date: row.postDate,
    description: row.description,
    amount: row.amount,
    accountId
  });
}

function importRowSoftKey(row) {
  const raw = row.rawData || {};
  const normalized = row.normalizedData || {};
  return rowSoftKey({
    date: raw.postDate || normalized.transactionDate,
    description: raw.description || normalized.description,
    amount: raw.amount != null ? raw.amount : (normalized.statementAmount != null ? normalized.statementAmount : normalized.amount),
    accountId: row.matchedAccountId || normalized.accountId
  });
}

function canonicalBankStatementProfile(profile) {
  const config = PROFILE_CONFIG[profile] || {};
  return config.canonicalProfile || config.profile || profile;
}

function parseNotes(notes) {
  try {
    return JSON.parse(notes || '{}');
  } catch (err) {
    return {};
  }
}

function accountSpecFromRegistry(registryMatch, account) {
  const spec = registryMatch && registryMatch.ledgerAccountSpec;
  if (!spec) return null;
  const last4 = account.accountLast4 || account.last4 || (account.accountNumber || '').slice(-4);
  return {
    ...spec,
    last4,
    notes: spec.notes || (last4 ? `Created for bank statement import; account ending ${last4}.` : 'Created for bank statement import.')
  };
}

async function ensureAccount(accountSpec, dryRun) {
  let account = await db.Account.findOne({ where: { accountCode: accountSpec.accountCode } });
  if (!account) {
    account = await db.Account.findOne({ where: { name: accountSpec.name } });
  }
  if (!account && accountSpec.last4) {
    const candidates = await db.Account.findAll({
      where: {
        status: { [Op.notIn]: ['inactive', 'closed'] }
      },
      order: [['id', 'ASC']]
    });
    account = candidates.find((row) => {
      const haystack = [row.name, row.accountCode, row.notes].filter(Boolean).join(' ');
      return new RegExp(`(^|\\D)${accountSpec.last4}(\\D|$)`).test(haystack);
    }) || null;
  }

  if (!account) {
    if (dryRun) return { id: null, created: true, account: accountSpec };
    account = await db.Account.create({
      name: accountSpec.name,
      accountCode: accountSpec.accountCode,
      accountType: accountSpec.accountType,
      accountClass: accountSpec.accountClass,
      accountSubtype: accountSpec.accountSubtype,
      currency: accountSpec.currency || 'USD',
      status: accountSpec.status || 'active',
      notes: accountSpec.notes,
      includeInNetWorth: accountSpec.includeInNetWorth !== false
    });
    return { id: account.id, created: true, account };
  }

  const updates = {};
  if (!account.accountCode) updates.accountCode = accountSpec.accountCode;
  if (!account.accountSubtype) updates.accountSubtype = accountSpec.accountSubtype;
  if (!account.currency) updates.currency = accountSpec.currency || 'USD';
  if (account.status !== 'active') updates.status = 'active';
  const last4Note = `account ending ${accountSpec.last4}`;
  if (accountSpec.last4 && !String(account.notes || '').includes(last4Note)) {
    updates.notes = appendNote(account.notes, last4Note + '.');
  }
  if (Object.keys(updates).length && !dryRun) await account.update(updates);
  return { id: account.id, created: false, account };
}

async function findExistingBatch({ importType, hash, accountScopeKey }) {
  const candidates = await db.ImportBatch.findAll({
    where: {
      importType,
      status: { [Op.ne]: 'removed' },
      notes: { [Op.iLike]: `%${hash}%` }
    },
    order: [['id', 'ASC']]
  });
  if (!candidates.length) return null;
  return candidates.find((batch) => {
    const notes = parseNotes(batch.notes);
    return notes.accountScopeKey === accountScopeKey
      || (notes.accountResolution && notes.accountResolution.registryKey === accountScopeKey)
      || (!notes.accountScopeKey && !notes.accountResolution);
  }) || null;
}

async function stageParsedStatementSection({
  item,
  profile,
  parsed,
  transactions,
  accountId,
  accountResolution,
  dryRun,
  userId
}) {
  const canonicalProfile = canonicalBankStatementProfile(profile);
  const importType = 'bank_statement_' + canonicalProfile;
  const sourceCopy = item.copies.find((copy) => copy.profile === profile) || item.copies[0];
  const relativePath = sourceCopy.relativePath;
  const accountScopeKey = accountResolution.registryKey || accountResolution.accountLast4 || canonicalProfile;

  const existingBatch = await findExistingBatch({
    importType,
    hash: item.hash,
    accountScopeKey
  });
  if (existingBatch) {
    return {
      file: relativePath,
      profile,
      status: 'skipped',
      reason: `already staged as batch #${existingBatch.id}`,
      batchId: existingBatch.id,
      rowCount: 0,
      duplicateCount: transactions.length
    };
  }

  if (!transactions.length) {
    return {
      file: relativePath,
      profile,
      status: 'skipped',
      reason: 'no transaction rows detected',
      rowCount: 0,
      duplicateCount: 0,
      warnings: parsed.warnings || []
    };
  }

  const fingerprints = transactions.map((row) => row.fingerprint).filter(Boolean);
  const existingTransactions = fingerprints.length ? await db.Transaction.findAll({
    where: {
      sourceType: 'bank_statement',
      referenceNumber: { [Op.in]: fingerprints }
    },
    attributes: ['id', 'referenceNumber']
  }) : [];
  const existingRefs = new Map(existingTransactions.map((tx) => [tx.referenceNumber, tx.id]));
  const existingImportRows = fingerprints.length ? await db.ImportRow.findAll({
    where: db.sequelize.where(db.sequelize.json('normalizedData.referenceNumber'), { [Op.in]: fingerprints }),
    include: [{
      model: db.ImportBatch,
      attributes: ['id', 'status'],
      where: {
        importType,
        status: { [Op.ne]: 'removed' }
      }
    }],
    attributes: ['id', 'importBatchId', 'normalizedData']
  }) : [];
  const candidateImportRows = await db.ImportRow.findAll({
    include: [{
      model: db.ImportBatch,
      attributes: ['id', 'status'],
      where: {
        importType,
        status: { [Op.ne]: 'removed' }
      }
    }],
    attributes: ['id', 'importBatchId', 'rawData', 'normalizedData', 'matchedAccountId']
  });
  const existingImportRefs = new Map();
  existingImportRows.forEach((row) => {
    const ref = row.normalizedData && row.normalizedData.referenceNumber;
    if (!ref) return;
    if (!existingImportRefs.has(ref)) existingImportRefs.set(ref, row.importBatchId);
  });
  const existingImportSoftKeys = new Map();
  candidateImportRows.forEach((row) => {
    const key = importRowSoftKey(row);
    if (!existingImportSoftKeys.has(key)) existingImportSoftKeys.set(key, row.importBatchId);
  });
  const parsedKeys = transactions.map((row) => ({
    ref: row.fingerprint,
    softKey: parsedRowSoftKey(row, accountId)
  }));
  if (parsedKeys.length && parsedKeys.every((entry) => existingImportRefs.has(entry.ref) || existingImportSoftKeys.has(entry.softKey))) {
    const batchIds = Array.from(new Set(parsedKeys.map((entry) => existingImportRefs.get(entry.ref) || existingImportSoftKeys.get(entry.softKey)))).sort((a, b) => a - b);
    return {
      file: relativePath,
      profile,
      status: 'skipped',
      reason: `all transaction rows already staged in batch${batchIds.length === 1 ? '' : 'es'} #${batchIds.join(', #')}`,
      rowCount: 0,
      duplicateCount: transactions.length,
      warnings: []
    };
  }

  const seenRefs = new Set();
  const stagedRows = transactions.map((row) => {
    const alreadyPosted = row.fingerprint && existingRefs.has(row.fingerprint);
    const softKey = parsedRowSoftKey(row, accountId);
    const alreadyStaged = (row.fingerprint && existingImportRefs.has(row.fingerprint)) || existingImportSoftKeys.has(softKey);
    const repeatedInUpload = row.fingerprint && seenRefs.has(row.fingerprint);
    if (row.fingerprint) seenRefs.add(row.fingerprint);
    return {
      row,
      status: alreadyPosted || alreadyStaged || repeatedInUpload ? 'duplicate' : 'staged',
      duplicateReason: alreadyPosted
        ? 'A ledger transaction already exists for this statement fingerprint.'
        : (alreadyStaged
          ? `A staged import row already exists for this statement row in batch #${existingImportRefs.get(row.fingerprint) || existingImportSoftKeys.get(softKey)}.`
          : (repeatedInUpload ? 'This upload contains the same statement fingerprint more than once.' : null)),
      duplicateTransactionId: alreadyPosted ? existingRefs.get(row.fingerprint) : null
    };
  });

  for (const entry of stagedRows) {
    entry.merchantResolution = await merchantResolver.resolveMerchantText(entry.row.description, { create: !dryRun });
  }

  const duplicateCount = stagedRows.filter((entry) => entry.status === 'duplicate').length;
  const baseName = path.basename(sourceCopy.filePath);
  const fileName = accountResolution.accountLast4
    ? `${baseName} (${accountResolution.accountLast4})`
    : baseName;
  const notesPayload = {
    source: 'bank_statement_folder_bulk_combined_safe',
    profile,
    canonicalProfile,
    parserVersion: parsed.parserVersion,
    fileHashSha256: item.hash,
    accountScopeKey,
    originalFileName: baseName,
    relativePath,
    sourceCopies: item.copies.map((copy) => ({
      relativePath: copy.relativePath,
      folder: copy.folder,
      profile: copy.profile
    })),
    accountLast4: accountResolution.accountLast4 || null,
    accountNumber: accountResolution.accountNumber || null,
    pageCount: parsed.pageCount,
    lineCount: parsed.lineCount,
    metadata: parsed.metadata,
    statementTotalValidation: parsed.statementTotalValidation || null,
    accountResolution,
    warnings: parsed.warnings || [],
    postingPolicy: 'stage_only_no_ledger_posting'
  };

  if (dryRun) {
    return {
      file: relativePath,
      profile,
      status: 'dry-run',
      rowCount: transactions.length,
      duplicateCount,
      warnings: parsed.warnings || []
    };
  }

  const batch = await db.sequelize.transaction(async (transaction) => {
    const created = await db.ImportBatch.create({
      importType,
      fileName,
      status: transactions.length && duplicateCount < transactions.length ? 'staged' : 'needs_review',
      rowCount: transactions.length,
      acceptedCount: 0,
      rejectedCount: duplicateCount,
      notes: JSON.stringify(notesPayload),
      createdByUserId: userId || null
    }, { transaction });

    await db.ImportRow.bulkCreate(stagedRows.map((entry, index) => {
      const row = entry.row;
      const merchant = entry.merchantResolution || {};
      return {
        importBatchId: created.id,
        rowNumber: index + 1,
        rawData: {
          ...row,
          duplicateReason: entry.duplicateReason,
          duplicateTransactionId: entry.duplicateTransactionId
        },
        normalizedData: {
          transactionDate: row.postDate,
          saleDate: row.saleDate,
          accountId,
          description: row.description,
          merchantId: merchant.merchantId || null,
          merchant: merchant.officialName || row.description,
          receiptMerchant: row.description,
          normalizedMerchant: merchant.normalizedMerchant || merchantResolver.normalizeMerchantKey(row.description),
          merchantMatchConfidence: merchant.confidence || null,
          merchantMatchSource: merchant.source || null,
          transactionType: row.suggestedLedgerType,
          amount: row.suggestedLedgerAmount,
          currency: row.currency || 'USD',
          status: 'draft',
          sourceType: 'bank_statement',
          referenceNumber: row.fingerprint,
          tags: ['bank-statement', canonicalProfile, profile !== canonicalProfile ? profile : null, row.transactionType].filter(Boolean).join(','),
          statementAmount: row.amount,
          statementSection: row.section,
          statementAccountLast4: row.accountLast4,
          statementAccountNumber: row.accountNumber,
          cardholder: row.cardholder,
          confidence: row.confidence,
          parserVersion: parsed.parserVersion
        },
        status: entry.status,
        errorMessage: entry.duplicateReason,
        matchedAccountId: accountId
      };
    }), { transaction });

    return created;
  });

  return {
    file: relativePath,
    profile,
    status: 'staged',
    batchId: batch.id,
    rowCount: transactions.length,
    duplicateCount,
    warnings: parsed.warnings || []
  };
}

function groupBankingTransactions(parsed) {
  const groups = new Map();
  for (const row of parsed.transactions || []) {
    const account = {
      accountType: row.accountClass || 'bank',
      product: row.accountName || row.section || 'Citi banking',
      accountName: row.accountName,
      accountNumber: row.accountNumber,
      accountLast4: row.accountLast4,
      last4: row.accountLast4
    };
    const registryMatch = matchRegistryAccount(account, ACCOUNT_REGISTRY);
    const key = registryMatch
      ? registryMatch.key
      : `unknown:${account.accountType}:${account.accountNumber || account.accountLast4 || account.product}`;
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        account,
        registryMatch,
        transactions: []
      });
    }
    groups.get(key).transactions.push(row);
  }
  return Array.from(groups.values());
}

function statementSectionIdentityKey(registryKey, parsed, transactions) {
  const metadata = (parsed && parsed.metadata) || {};
  const period = [
    metadata.billingPeriodStart || '',
    metadata.billingPeriodEnd || metadata.statementDate || '',
    metadata.accountNumber || '',
    metadata.statementAccountLast4 || metadata.accountLast4 || ''
  ].join(':');
  const refs = (transactions || []).map((row) => row.fingerprint).filter(Boolean).sort().join('|');
  const detailHash = crypto.createHash('sha256').update(refs || JSON.stringify(transactions || [])).digest('hex');
  return [registryKey || 'unmapped', period, detailHash].join('|');
}

async function processCreditStatement({ item, dryRun, allowNeedsConfirmation, userId, summary }) {
  const parsed = await parseBankStatement({ buffer: item.buffer, profile: 'advantage_citi_pdf' });
  parsed.statementTotalValidation = validateStatementTotals(parsed, 'advantage_citi_pdf');
  if (!parsed.statementTotalValidation.ok) {
    const issue = {
      file: item.copies[0].relativePath,
      profile: 'advantage_citi_pdf',
      rows: parsed.transactions.length,
      reason: 'statement summary totals do not match parsed transaction detail',
      issues: parsed.statementTotalValidation.issues
    };
    summary.totalValidationFailures.push(issue);
    return [{ ...issue, status: 'skipped', rowCount: 0 }];
  }

  if (!parsed.transactions.length) {
    return [{
      file: item.copies[0].relativePath,
      profile: 'advantage_citi_pdf',
      status: 'skipped',
      reason: 'no AAdvantage transaction rows detected',
      rowCount: 0
    }];
  }

  const account = {
    accountType: 'credit_card',
    product: 'Citi AAdvantage Credit Card',
    last4: parsed.metadata && parsed.metadata.accountLast4
  };
  const registryMatch = matchRegistryAccount(account, ACCOUNT_REGISTRY);
  if (!registryMatch) {
    const issue = {
      file: item.copies[0].relativePath,
      account: accountLabel(account),
      rows: parsed.transactions.length,
      reason: 'credit card account is not mapped in config/bank-statement-accounts.json'
    };
    summary.needsMapping.push(issue);
    return [{ ...issue, profile: 'advantage_citi_pdf', status: 'skipped' }];
  }
  if (registryMatch.status !== 'known' && !allowNeedsConfirmation) {
    const issue = {
      file: item.copies[0].relativePath,
      account: accountLabel(account),
      registryKey: registryMatch.key,
      status: registryMatch.status,
      rows: parsed.transactions.length,
      reason: registryMatch.notes || 'account mapping needs confirmation'
    };
    summary.needsConfirmation.push(issue);
    return [{ ...issue, profile: registryMatch.profile, status: 'skipped' }];
  }

  const accountSpec = accountSpecFromRegistry(registryMatch, account);
  if (!accountSpec) {
    const issue = {
      file: item.copies[0].relativePath,
      account: accountLabel(account),
      registryKey: registryMatch.key,
      rows: parsed.transactions.length,
      reason: 'registry entry is missing ledgerAccountSpec'
    };
    summary.needsMapping.push(issue);
    return [{ ...issue, profile: registryMatch.profile, status: 'skipped' }];
  }

  const accountResult = await ensureAccount(accountSpec, dryRun);
  const result = await stageParsedStatementSection({
    item,
    profile: registryMatch.profile,
    parsed,
    transactions: parsed.transactions,
    accountId: accountResult.id,
    accountResolution: {
      source: 'account_registry',
      registryKey: registryMatch.key,
      registryStatus: registryMatch.status,
      accountId: accountResult.id,
      accountCode: accountSpec.accountCode,
      accountLast4: account.last4,
      accountNumber: null,
      matchType: registryMatch.matchType
    },
    dryRun,
    userId
  });
  return [result];
}

async function processBankingStatement({ item, dryRun, allowNeedsConfirmation, userId, summary, profileFilter, seenSectionKeys }) {
  const parsed = await parseCitiBankingStatement(item.buffer);
  const groups = groupBankingTransactions(parsed);
  if (!groups.length) {
    return [{
      file: item.copies[0].relativePath,
      profile: 'citi_banking_all_pdf',
      status: 'skipped',
      reason: 'no banking transaction rows detected',
      rowCount: 0,
      warnings: parsed.warnings || []
    }];
  }

  const results = [];
  for (const group of groups) {
    summary.sectionsReviewed += 1;
    const registryMatch = group.registryMatch;
    if (profileFilter) {
      const filterConfig = PROFILE_CONFIG[profileFilter] || {};
      const matchesKnownProfile = registryMatch && registryMatch.profile === profileFilter;
      const matchesUnmappedClass = !registryMatch && filterConfig.accountClass && group.account.accountType === filterConfig.accountClass;
      if (!matchesKnownProfile && !matchesUnmappedClass) {
        continue;
      }
    }
    if (!registryMatch) {
      const issue = {
        file: item.copies[0].relativePath,
        account: accountLabel(group.account),
        rows: group.transactions.length,
        reason: 'statement account is not mapped in config/bank-statement-accounts.json'
      };
      summary.needsMapping.push(issue);
      results.push({ ...issue, profile: 'unmapped', status: 'skipped' });
      continue;
    }
    if (registryMatch.status !== 'known' && !allowNeedsConfirmation) {
      const issue = {
        file: item.copies[0].relativePath,
        account: accountLabel(group.account),
        registryKey: registryMatch.key,
        status: registryMatch.status,
        rows: group.transactions.length,
        reason: registryMatch.notes || 'account mapping needs confirmation'
      };
      summary.needsConfirmation.push(issue);
      results.push({ ...issue, profile: registryMatch.profile, status: 'skipped' });
      continue;
    }
    const accountSpec = accountSpecFromRegistry(registryMatch, group.account);
    if (!accountSpec) {
      const issue = {
        file: item.copies[0].relativePath,
        account: accountLabel(group.account),
        registryKey: registryMatch.key,
        rows: group.transactions.length,
        reason: 'registry entry is missing ledgerAccountSpec'
      };
      summary.needsMapping.push(issue);
      results.push({ ...issue, profile: registryMatch.profile, status: 'skipped' });
      continue;
    }

    const accountResult = await ensureAccount(accountSpec, dryRun);
    const sectionParsed = {
      ...parsed,
      profile: registryMatch.profile,
      transactions: group.transactions,
      metadata: {
        ...parsed.metadata,
        profile: registryMatch.profile,
        canonicalProfile: canonicalBankStatementProfile(registryMatch.profile),
        accountLast4: group.account.accountLast4 || group.account.last4,
        statementAccountLast4: group.account.accountLast4 || group.account.last4,
        accountNumber: group.account.accountNumber || null,
        accountName: group.account.accountName || group.account.product || null,
        registryKey: registryMatch.key
      }
    };
    sectionParsed.statementTotalValidation = validateStatementTotals(sectionParsed, registryMatch.profile);
    if (!sectionParsed.statementTotalValidation.ok) {
      const issue = {
        file: item.copies[0].relativePath,
        profile: registryMatch.profile,
        account: accountLabel(group.account),
        registryKey: registryMatch.key,
        rows: group.transactions.length,
        reason: 'banking statement summary totals do not match parsed transaction detail',
        issues: sectionParsed.statementTotalValidation.issues
      };
      summary.totalValidationFailures.push(issue);
      results.push({ ...issue, status: 'skipped', rowCount: 0 });
      continue;
    }
    const identityKey = statementSectionIdentityKey(registryMatch.key, sectionParsed, group.transactions);
    const firstSeenFile = seenSectionKeys.get(identityKey);
    if (firstSeenFile) {
      const issue = {
        file: item.copies[0].relativePath,
        profile: registryMatch.profile,
        account: accountLabel(group.account),
        registryKey: registryMatch.key,
        rows: group.transactions.length,
        reason: `duplicate statement section already seen in ${firstSeenFile}`
      };
      summary.duplicateSections.push(issue);
      results.push({ ...issue, status: 'skipped', rowCount: 0, duplicateCount: group.transactions.length });
      continue;
    }
    seenSectionKeys.set(identityKey, item.copies[0].relativePath);
    const result = await stageParsedStatementSection({
      item,
      profile: registryMatch.profile,
      parsed: sectionParsed,
      transactions: group.transactions,
      accountId: accountResult.id,
      accountResolution: {
        source: 'statement_account_registry',
        registryKey: registryMatch.key,
        registryStatus: registryMatch.status,
        accountId: accountResult.id,
        accountCode: accountSpec.accountCode,
        accountLast4: group.account.accountLast4 || group.account.last4,
        accountNumber: group.account.accountNumber || null,
        accountName: group.account.accountName || group.account.product || null,
        matchType: registryMatch.matchType
      },
      dryRun,
      userId
    });
    results.push(result);
  }
  return results;
}

async function main() {
  const dryRun = hasFlag('--dry-run');
  const allowNeedsConfirmation = hasFlag('--allow-needs-confirmation');
  const profileFilter = selectedProfile();
  const user = await db.User.findOne({ where: { username: 'admin' }, attributes: ['id'] }).catch(() => null);
  const statements = collectStatementFiles().filter((item) => shouldProcessStatementForProfile(item, profileFilter));
  const physicalFiles = statements.reduce((sum, item) => sum + item.copies.length, 0);
  const seenSectionKeys = new Map();
  const summary = {
    dryRun,
    allowNeedsConfirmation,
    profileFilter,
    physicalFiles,
    uniqueStatements: statements.length,
    duplicatePhysicalCopies: physicalFiles - statements.length,
    statementsReviewed: 0,
    sectionsReviewed: 0,
    staged: 0,
    skipped: 0,
    rows: 0,
    duplicates: 0,
    duplicateSections: [],
    needsMapping: [],
    needsConfirmation: [],
    totalValidationFailures: [],
    errors: []
  };

  for (const item of statements) {
    summary.statementsReviewed += 1;
    const source = item.copies[0].relativePath;
    const isCredit = item.copies.some((copy) => copy.profile === 'advantage_citi_pdf');
    console.log(`[${summary.statementsReviewed}/${statements.length}] ${source}${item.copies.length > 1 ? ` (${item.copies.length} copies)` : ''}`);
    try {
      const results = isCredit
        ? await processCreditStatement({ item, dryRun, allowNeedsConfirmation, userId: user && user.id, summary })
        : await processBankingStatement({ item, dryRun, allowNeedsConfirmation, userId: user && user.id, summary, profileFilter, seenSectionKeys });
      for (const result of results) {
        if (result.status === 'skipped') summary.skipped += 1;
        else if (result.status === 'staged' || result.status === 'dry-run') summary.staged += 1;
        summary.rows += result.rowCount || 0;
        summary.duplicates += result.duplicateCount || 0;
        console.log(`  - ${result.status}: ${result.profile} (${result.rowCount || result.rows || 0} row(s))${result.batchId ? ` -> batch #${result.batchId}` : ''}${result.reason ? `, ${result.reason}` : ''}`);
        if (result.warnings && result.warnings.length) console.log(`    warnings: ${result.warnings.join('; ')}`);
      }
    } catch (err) {
      summary.errors.push({ file: source, error: err.message });
      console.error(`  ! error: ${err.message}`);
    }
  }

  console.log(JSON.stringify(summary, null, 2));
  if (summary.errors.length || summary.totalValidationFailures.length) process.exitCode = 1;
}

main()
  .catch((err) => {
    console.error(err.stack || err.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.sequelize.close().catch(() => {});
  });
