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

function getArgValue(name) {
  const prefix = `${name}=`;
  const found = process.argv.find((arg) => arg.startsWith(prefix));
  return found ? found.slice(prefix.length) : null;
}

function selectedProfile() {
  return getArgValue('--profile') || getArgValue('--only-profile') || null;
}

function shouldAuditStatementForProfile(item, profileFilter) {
  if (!profileFilter) return true;
  const isCredit = item.copies.some((copy) => copy.profile === 'advantage_citi_pdf');
  if (profileFilter === 'advantage_citi_pdf') return isCredit;
  return !isCredit;
}

function canonicalBankStatementProfile(profile) {
  const config = PROFILE_CONFIG[profile] || {};
  return config.canonicalProfile || config.profile || profile;
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

function parseNotes(notes) {
  try {
    return JSON.parse(notes || '{}');
  } catch (err) {
    return {};
  }
}

function countValues(values) {
  const counts = new Map();
  values.forEach((value) => counts.set(value, (counts.get(value) || 0) + 1));
  return counts;
}

function diffCounts(expected, actual) {
  const missing = [];
  const extra = [];
  for (const [key, count] of expected.entries()) {
    const actualCount = actual.get(key) || 0;
    if (actualCount < count) missing.push({ key, count: count - actualCount });
  }
  for (const [key, count] of actual.entries()) {
    const expectedCount = expected.get(key) || 0;
    if (expectedCount < count) extra.push({ key, count: count - expectedCount });
  }
  return { missing, extra };
}

async function findBatchesForSection({ importType, hash, accountScopeKey }) {
  const candidates = await db.ImportBatch.findAll({
    where: {
      importType,
      status: { [Op.ne]: 'removed' },
      notes: { [Op.iLike]: `%${hash}%` }
    },
    order: [['id', 'ASC']]
  });
  return candidates.filter((batch) => {
    const notes = parseNotes(batch.notes);
    return notes.accountScopeKey === accountScopeKey
      || (notes.accountResolution && notes.accountResolution.registryKey === accountScopeKey)
      || (!notes.accountScopeKey && !notes.accountResolution);
  });
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

async function auditExpectedSection({
  item,
  profile,
  accountScopeKey,
  account,
  registryMatch,
  transactions,
  warnings,
  statementTotalValidation
}) {
  const canonicalProfile = canonicalBankStatementProfile(profile);
  const importType = `bank_statement_${canonicalProfile}`;
  const relativePath = item.copies[0].relativePath;
  const expectedRows = transactions.length;

  if (!registryMatch) {
    return {
      file: relativePath,
      profile: 'unmapped',
      account: accountLabel(account),
      status: 'needs_mapping',
      expectedRows,
      issues: ['Statement account is not mapped in config/bank-statement-accounts.json.'],
      statementTotalValidation,
      warnings
    };
  }

  if (registryMatch.status !== 'known') {
    return {
      file: relativePath,
      profile,
      account: accountLabel(account),
      registryKey: registryMatch.key,
      status: 'needs_confirmation',
      expectedRows,
      issues: [registryMatch.notes || 'Account mapping needs confirmation.'],
      statementTotalValidation,
      warnings
    };
  }

  if (!expectedRows) {
    return {
      file: relativePath,
      profile,
      account: accountLabel(account),
      registryKey: registryMatch.key,
      status: 'no_transactions',
      expectedRows: 0,
      statementTotalValidation,
      warnings
    };
  }

  const batches = await findBatchesForSection({ importType, hash: item.hash, accountScopeKey });
  if (!batches.length) {
    return {
      file: relativePath,
      profile,
      account: accountLabel(account),
      registryKey: registryMatch.key,
      status: 'missing_batch',
      expectedRows,
      statementTotalValidation,
      warnings
    };
  }

  const batch = batches[0];
  const rows = await db.ImportRow.findAll({
    where: { importBatchId: batch.id },
    attributes: ['id', 'rowNumber', 'normalizedData', 'status'],
    order: [['rowNumber', 'ASC']],
    raw: true
  });
  const expectedRefs = countValues(transactions.map((row) => row.fingerprint).filter(Boolean));
  const actualRefs = countValues(rows.map((row) => row.normalizedData && row.normalizedData.referenceNumber).filter(Boolean));
  const refDiff = diffCounts(expectedRefs, actualRefs);
  const issues = statementTotalValidation && !statementTotalValidation.ok
    ? statementTotalValidation.issues.slice()
    : [];

  if (batches.length > 1) issues.push(`Multiple active batches contain this file hash and account scope: ${batches.map((entry) => entry.id).join(', ')}`);
  if (batch.rowCount !== expectedRows) issues.push(`Batch rowCount ${batch.rowCount} does not match parsed rows ${expectedRows}.`);
  if (rows.length !== expectedRows) issues.push(`Stored ImportRow count ${rows.length} does not match parsed rows ${expectedRows}.`);
  if (refDiff.missing.length || refDiff.extra.length) issues.push(`Transaction fingerprint mismatch: missing ${refDiff.missing.length}, extra ${refDiff.extra.length}.`);

  return {
    file: relativePath,
    profile,
    account: accountLabel(account),
    registryKey: registryMatch.key,
    status: issues.length ? 'mismatch' : 'ok',
    batchId: batch.id,
    batchFileName: batch.fileName,
    expectedRows,
    storedRows: rows.length,
    issues,
    statementTotalValidation,
    warnings
  };
}

async function auditCreditStatement(item) {
  const parsed = await parseBankStatement({ buffer: item.buffer, profile: 'advantage_citi_pdf' });
  parsed.statementTotalValidation = validateStatementTotals(parsed, 'advantage_citi_pdf');
  const account = {
    accountType: 'credit_card',
    product: 'Citi AAdvantage Credit Card',
    last4: parsed.metadata && parsed.metadata.accountLast4
  };
  const registryMatch = matchRegistryAccount(account, ACCOUNT_REGISTRY);
  return [await auditExpectedSection({
    item,
    profile: registryMatch ? registryMatch.profile : 'advantage_citi_pdf',
    accountScopeKey: registryMatch ? registryMatch.key : `unknown:credit_card:${account.last4 || 'unknown'}`,
    account,
    registryMatch,
    transactions: parsed.transactions,
    statementTotalValidation: parsed.statementTotalValidation,
    warnings: parsed.warnings || []
  })];
}

async function auditBankingStatement(item) {
  const parsed = await parseCitiBankingStatement(item.buffer);
  const groups = groupBankingTransactions(parsed);
  if (!groups.length) {
    return [{
      file: item.copies[0].relativePath,
      profile: 'citi_banking_all_pdf',
      status: 'no_transactions',
      expectedRows: 0,
      warnings: parsed.warnings || []
    }];
  }

  const results = [];
  for (const group of groups) {
    const registryMatch = group.registryMatch;
    const sectionParsed = {
      ...parsed,
      profile: registryMatch ? registryMatch.profile : 'unmapped',
      transactions: group.transactions,
      metadata: {
        ...parsed.metadata,
        profile: registryMatch ? registryMatch.profile : 'unmapped',
        accountLast4: group.account.accountLast4 || group.account.last4,
        statementAccountLast4: group.account.accountLast4 || group.account.last4,
        accountNumber: group.account.accountNumber || null,
        accountName: group.account.accountName || group.account.product || null,
        registryKey: registryMatch ? registryMatch.key : null
      }
    };
    const statementTotalValidation = registryMatch
      ? validateStatementTotals(sectionParsed, registryMatch.profile)
      : null;
    results.push(await auditExpectedSection({
      item,
      profile: registryMatch ? registryMatch.profile : 'unmapped',
      accountScopeKey: registryMatch ? registryMatch.key : group.key,
      account: group.account,
      registryMatch,
      transactions: group.transactions,
      statementTotalValidation,
      warnings: parsed.warnings || []
    }));
  }
  return results;
}

async function main() {
  const records = [];
  const errors = [];
  const profileFilter = selectedProfile();
  const statements = collectStatementFiles().filter((item) => shouldAuditStatementForProfile(item, profileFilter));

  for (const item of statements) {
    const source = item.copies[0].relativePath;
    const isCredit = item.copies.some((copy) => copy.profile === 'advantage_citi_pdf');
    try {
      const audited = isCredit ? await auditCreditStatement(item) : await auditBankingStatement(item);
      records.push(...audited.filter((record) => !profileFilter || record.profile === profileFilter));
    } catch (err) {
      errors.push({ file: source, error: err.message });
    }
  }

  const summary = records.reduce((acc, item) => {
    acc[item.status] = (acc[item.status] || 0) + 1;
    return acc;
  }, {});
  const failures = records.filter((item) => ['missing_batch', 'mismatch'].includes(item.status));
  const reviewRequired = records.filter((item) => ['needs_mapping', 'needs_confirmation'].includes(item.status));
  const physicalFiles = statements.reduce((sum, item) => sum + item.copies.length, 0);
  const output = {
    physicalFiles,
    uniqueStatements: statements.length,
    duplicatePhysicalCopies: physicalFiles - statements.length,
    expectedSections: records.length,
    profileFilter,
    summary,
    failures,
    reviewRequired,
    errors
  };

  console.log(JSON.stringify(output, null, 2));
  if (failures.length || errors.length) process.exitCode = 1;
}

main()
  .catch((err) => {
    console.error(err.stack || err.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.sequelize.close().catch(() => {});
  });
