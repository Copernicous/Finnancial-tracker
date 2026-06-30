'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { PDFParse } = require('pdf-parse');
const { parseBankStatement, parseCitiBankingStatement } = require('../services/bankStatementParser');
const accountRegistry = require('../services/bankStatementAccounts');
const { validateStatementTotals } = require('../services/bankStatementValidation');

const ROOT = path.resolve(__dirname, '..');
const DATA_SOURCE = path.join(ROOT, 'data-source', 'Statements');
const REPORT_DIR = path.join(ROOT, 'reports');
const ACCOUNT_REGISTRY_PATH = path.join(ROOT, 'config', 'bank-statement-accounts.json');

const FOLDERS = [
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

const PROFILES = [
  { key: 'advantage_citi_pdf', label: 'AAdvantage 3888', targetLast4: '3888' },
  { key: 'citi_checking_pdf', label: 'Checking 8384', targetLast4: '8384' },
  { key: 'citi_ultimate_plus_pdf', label: 'Ultimate/Savings 2950', targetLast4: '2950' },
  { key: 'citi_savings_pdf', label: 'Savings 8293', targetLast4: '8293' },
  { key: 'citi_cd_pdf', label: 'Citi CDs', targetLast4: '' }
];

const ACCOUNT_REGISTRY = accountRegistry.loadAccountRegistry();

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
  const known = FOLDERS.find((spec) => isInsideFolder(filePath, spec.folder));
  if (known) return known;
  const relative = path.relative(DATA_SOURCE, filePath);
  const topLevel = relative.split(path.sep)[0] || 'data-source';
  return {
    label: topLevel,
    profile: null,
    folder: path.join(DATA_SOURCE, topLevel)
  };
}

function hashBuffer(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function normalizeLines(text) {
  return String(text || '')
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

async function extractPdfText(buffer) {
  const parser = new PDFParse({ data: buffer });
  try {
    const result = await parser.getText();
    return {
      text: result.text || '',
      pageCount: result.total || result.numpages || null
    };
  } finally {
    await parser.destroy().catch(() => {});
  }
}

function addDetectedAccount(accounts, payload) {
  if (!payload.last4 && !payload.accountNumber) return;
  const accountNumber = payload.accountNumber || '';
  const last4 = payload.last4 || accountNumber.slice(-4);
  const key = `${payload.accountType || 'bank'}|${accountNumber || last4}|${payload.product || ''}`;
  if (!accounts.has(key)) {
    accounts.set(key, {
      accountType: payload.accountType || 'bank',
      product: payload.product || '',
      accountNumber,
      last4,
      isDigitalAccountNumber: !!payload.isDigitalAccountNumber,
      pages: [],
      evidence: []
    });
  }
  const record = accounts.get(key);
  if (payload.page && !record.pages.includes(payload.page)) record.pages.push(payload.page);
  if (payload.evidence && record.evidence.length < 5 && !record.evidence.includes(payload.evidence)) {
    record.evidence.push(payload.evidence);
  }
}

function detectAccountsFromText(lines) {
  const accounts = new Map();
  let currentPage = 1;
  let currentProduct = '';
  let currentType = 'bank';
  let currentSection = '';

  for (const line of lines) {
    const pageMatch = line.match(/\bPage\s+(\d+)\s+of\s+\d+\b/i);
    if (pageMatch) currentPage = Number(pageMatch[1]);

    let match = line.match(/Digital account number ending in\s*(\d{4})/i);
    if (match) {
      addDetectedAccount(accounts, {
        accountType: 'credit_card',
        product: 'Citi AAdvantage Digital Account',
        last4: match[1],
        page: currentPage,
        evidence: line,
        isDigitalAccountNumber: true
      });
      continue;
    }

    match = line.match(/Account number ending in:?\s*(\d{4})/i);
    if (match) {
      addDetectedAccount(accounts, {
        accountType: 'credit_card',
        product: 'Citi AAdvantage Credit Card',
        last4: match[1],
        page: currentPage,
        evidence: line
      });
    }

    if (/^CHECKING ACTIVITY(?: Continued)?$/i.test(line) || /^Checking(?: Continued)?$/i.test(line)) {
      currentSection = 'Checking';
      currentProduct = 'Regular Checking';
      currentType = 'checking';
      continue;
    }
    if (/^SAVINGS ACTIVITY(?: Continued)?$/i.test(line) || /^Savings(?: Plus)?$/i.test(line)) {
      currentSection = 'Savings';
      currentProduct = 'Savings Activity';
      currentType = 'savings';
      continue;
    }
    if (/\b(?:certificate(?:s)? of deposit|certificate of deposit \(cd\)|cd account)\b/i.test(line)) {
      currentSection = 'Certificates of Deposit';
      currentProduct = 'Certificate of Deposit';
      currentType = 'cd';
    }
    if (/^Account Activity$/i.test(line) && currentSection !== 'Checking') {
      currentSection = 'Savings';
      currentType = 'savings';
      continue;
    }

    match = line.match(/\b(?:Activity\s+)?Regular Checking\s+(\d{7,})\b/i);
    if (match) {
      currentProduct = 'Regular Checking';
      currentType = 'checking';
      addDetectedAccount(accounts, {
        accountType: 'checking',
        product: currentProduct,
        accountNumber: match[1],
        page: currentPage,
        evidence: line
      });
      continue;
    }

    if (/^Regular Checking$/i.test(line)) {
      currentProduct = 'Regular Checking';
      currentType = 'checking';
      continue;
    }

    match = line.match(/\bCitibank(?:\W+)?Savings Plus\s+(\d{7,})\b/i);
    if (match) {
      currentProduct = 'Citibank Savings Plus';
      currentType = 'savings';
      addDetectedAccount(accounts, {
        accountType: 'savings',
        product: currentProduct,
        accountNumber: match[1],
        page: currentPage,
        evidence: line
      });
      continue;
    }

    match = line.match(/\b(?:Certificate(?:s)? of Deposit|CD Account)\b.*?\b(\d{7,})\b/i);
    if (match) {
      currentProduct = 'Certificate of Deposit';
      currentType = 'cd';
      addDetectedAccount(accounts, {
        accountType: 'cd',
        product: currentProduct,
        accountNumber: match[1],
        page: currentPage,
        evidence: line
      });
      continue;
    }

    if (/\bUltimate Savings Account\b/i.test(line)) {
      currentProduct = 'Ultimate Savings Account';
      currentType = 'savings';
      continue;
    }

    match = line.match(/\b(\d{7,})\s+Beginning Balance\b/i)
      || line.match(/\bBeginning Balance:?\s+\$?[0-9,.]+\s+(\d{7,})\b/i);
    if (match && currentProduct) {
      addDetectedAccount(accounts, {
        accountType: currentType,
        product: currentProduct,
        accountNumber: match[1],
        page: currentPage,
        evidence: line
      });
    }
  }

  return Array.from(accounts.values()).map((account) => ({
    ...account,
    pages: account.pages.sort((a, b) => a - b)
  }));
}

function matchesProduct(account, registryAccount) {
  const product = String(account.product || '').toLowerCase();
  return (registryAccount.productPatterns || []).some((pattern) => product.includes(String(pattern).toLowerCase()));
}

function matchRegistryAccount(account) {
  for (const registryAccount of ACCOUNT_REGISTRY.accounts || []) {
    const accountNumber = String(account.accountNumber || '');
    const last4 = String(account.last4 || '');
    const exactNumber = accountNumber && (registryAccount.accountNumbers || []).includes(accountNumber);
    const exactLast4 = last4 && (registryAccount.last4 || []).includes(last4);
    const digitalLast4 = account.isDigitalAccountNumber && last4 && (registryAccount.digitalLast4 || []).includes(last4);
    const typeMatches = !registryAccount.accountType || registryAccount.accountType === account.accountType;
    if ((exactNumber || exactLast4 || digitalLast4) && typeMatches) {
      return {
        key: registryAccount.key,
        label: registryAccount.label,
        profile: registryAccount.profile,
        ledgerAccountCode: registryAccount.ledgerAccountCode,
        status: registryAccount.status || 'known',
        matchType: exactNumber ? 'account_number' : (digitalLast4 ? 'digital_last4' : 'last4'),
        notes: registryAccount.notes || ''
      };
    }
    if ((exactNumber || exactLast4 || digitalLast4) && !typeMatches && matchesProduct(account, registryAccount)) {
      return {
        key: registryAccount.key,
        label: registryAccount.label,
        profile: registryAccount.profile,
        ledgerAccountCode: registryAccount.ledgerAccountCode,
        status: 'type_mismatch_needs_review',
        matchType: exactNumber ? 'account_number' : (digitalLast4 ? 'digital_last4' : 'last4'),
        notes: `Detected as ${account.accountType}; registry expects ${registryAccount.accountType}.`
      };
    }
  }
  return null;
}

function annotateDetectedAccounts(accounts) {
  return accountRegistry.annotateDetectedAccounts(accounts, ACCOUNT_REGISTRY);
}

function buildAccountIssues(record) {
  const issues = [];
  const reportedCdKeys = new Set();
  const bankingRowsByAccount = ((record.profileParses.citi_banking_all_pdf || {}).rowsBySourceAccount || []);
  const advantageParse = record.profileParses.advantage_citi_pdf || {};
  const advantageTotals = advantageParse.statementTotalValidation;
  const hasAdvantageEvidence = Number(advantageParse.rowCount || 0) > 0
    || record.detectedAccounts.some((account) => account.accountType === 'credit_card');

  if (hasAdvantageEvidence && advantageTotals && !advantageTotals.ok) {
    issues.push({
      type: 'statement_total_mismatch',
      severity: 'needs_parser_review',
      account: 'Citi AAdvantage Credit Card',
      issues: advantageTotals.issues
    });
  }

  for (const account of record.detectedAccounts) {
    const label = `${account.product || account.accountType} ${account.accountNumber || account.last4}`.trim();
    if (account.accountType === 'cd' && !account.registryMatch) {
      issues.push({
        type: 'cd_account_detected',
        severity: 'needs_mapping',
        account: label,
        pages: account.pages,
        evidence: account.evidence[0] || ''
      });
      reportedCdKeys.add(account.accountNumber || account.last4 || account.accountLast4 || '');
      continue;
    }
    if (!account.registryMatch) {
      issues.push({
        type: 'unknown_account',
        severity: 'needs_mapping',
        account: label,
        pages: account.pages,
        evidence: account.evidence[0] || ''
      });
      continue;
    }
    if (account.registryMatch.status !== 'known') {
      issues.push({
        type: 'account_needs_confirmation',
        severity: 'needs_confirmation',
        account: label,
        registryKey: account.registryMatch.key,
        registryStatus: account.registryMatch.status,
        notes: account.registryMatch.notes,
        pages: account.pages,
        evidence: account.evidence[0] || ''
      });
    }
    const expectedProfile = account.registryMatch.profile;
    const accountLast4 = String(account.last4 || (account.accountNumber || '').slice(-4));
    const expectedRows = bankingRowsByAccount
      .filter((item) => String(item.accountLast4 || '') === accountLast4)
      .reduce((sum, item) => sum + Number(item.transactionRows || 0), 0);
    if (account.accountType !== 'credit_card' && expectedProfile && expectedRows === 0) {
      issues.push({
        type: 'detected_account_has_no_parsed_rows',
        severity: 'confirm_no_activity',
        account: label,
        expectedProfile,
        expectedProfileRows: expectedRows,
        pages: account.pages,
        evidence: account.evidence[0] || ''
      });
    }
  }

  const cdSummary = (record.profileParses.citi_cd_pdf || {}).certificateOfDepositSummaries || {};
  for (const cdAccount of cdSummary.accounts || []) {
    const key = cdAccount.accountNumber || cdAccount.accountLast4 || '';
    if (reportedCdKeys.has(key)) continue;
    const account = {
      accountType: 'cd',
      product: cdAccount.cdType || 'Certificate of Deposit',
      accountNumber: cdAccount.accountNumber,
      last4: cdAccount.accountLast4
    };
    const registryMatch = matchRegistryAccount(account);
    if (!registryMatch) {
      issues.push({
        type: 'cd_account_detected',
        severity: 'needs_mapping',
        account: accountRegistry.accountLabel(account),
        evidence: `${cdAccount.cdType || 'CD'} interest ${cdAccount.interestCreditedInPeriod || 0}, balance ${cdAccount.balanceAsOfStatementDate || 0}`,
        cdSummary: cdAccount
      });
      reportedCdKeys.add(key);
    } else if (registryMatch.status !== 'known') {
      issues.push({
        type: 'account_needs_confirmation',
        severity: 'needs_confirmation',
        account: accountRegistry.accountLabel(account),
        registryKey: registryMatch.key,
        registryStatus: registryMatch.status,
        notes: registryMatch.notes,
        evidence: `${cdAccount.cdType || 'CD'} interest ${cdAccount.interestCreditedInPeriod || 0}, balance ${cdAccount.balanceAsOfStatementDate || 0}`,
        cdSummary: cdAccount
      });
    }
  }

  return issues;
}

function summarizeRowsByAccount(transactions) {
  const byLast4 = new Map();
  for (const row of transactions || []) {
    const key = String(row.accountLast4 || 'unknown');
    if (!byLast4.has(key)) {
      byLast4.set(key, {
        accountLast4: key,
        accountName: row.accountName || '',
        transactionRows: 0,
        firstDate: row.postDate || null,
        lastDate: row.postDate || null,
        totalAmount: 0
      });
    }
    const item = byLast4.get(key);
    item.transactionRows += 1;
    item.totalAmount += Number(row.amount || 0);
    if (row.postDate && (!item.firstDate || row.postDate < item.firstDate)) item.firstDate = row.postDate;
    if (row.postDate && (!item.lastDate || row.postDate > item.lastDate)) item.lastDate = row.postDate;
  }
  return Array.from(byLast4.values()).map((item) => ({
    ...item,
    totalAmount: Number(item.totalAmount.toFixed(2))
  }));
}

async function parseProfiles(buffer) {
  const out = {};
  for (const profile of PROFILES) {
    try {
      const parsed = await parseBankStatement({ buffer, profile: profile.key });
      const statementTotalValidation = validateStatementTotals(parsed, profile.key);
      const certificateOfDepositSummaries = parsed.metadata && parsed.metadata.certificateOfDepositSummaries;
      out[profile.key] = {
        label: profile.label,
        targetLast4: profile.targetLast4,
        rowCount: parsed.transactions.length,
        cdSummaryCount: certificateOfDepositSummaries && Array.isArray(certificateOfDepositSummaries.accounts) ? certificateOfDepositSummaries.accounts.length : 0,
        parserVersion: parsed.parserVersion,
        pageCount: parsed.pageCount,
        statementDate: parsed.metadata && parsed.metadata.statementDate,
        statementLayout: parsed.metadata && parsed.metadata.statementLayout,
        metadataAccountLast4: parsed.metadata && parsed.metadata.accountLast4,
        statementAccountLast4: parsed.metadata && parsed.metadata.statementAccountLast4,
        rowsBySourceAccount: summarizeRowsByAccount(parsed.transactions),
        certificateOfDepositSummaries,
        statementTotalValidation,
        warnings: parsed.warnings || []
      };
    } catch (err) {
      out[profile.key] = {
        label: profile.label,
        targetLast4: profile.targetLast4,
        rowCount: 0,
        error: err.message
      };
    }
  }
  try {
    const parsed = await parseCitiBankingStatement(buffer);
    const certificateOfDepositSummaries = parsed.metadata && parsed.metadata.certificateOfDepositSummaries;
    out.citi_banking_all_pdf = {
      label: 'All Citi banking sections',
      targetLast4: '',
      rowCount: parsed.transactions.length,
      cdSummaryCount: certificateOfDepositSummaries && Array.isArray(certificateOfDepositSummaries.accounts) ? certificateOfDepositSummaries.accounts.length : 0,
      parserVersion: parsed.parserVersion,
      pageCount: parsed.pageCount,
      statementDate: parsed.metadata && parsed.metadata.statementDate,
      statementLayout: parsed.metadata && parsed.metadata.statementLayout,
      metadataAccountLast4: parsed.metadata && parsed.metadata.accountLast4,
      statementAccountLast4: parsed.metadata && parsed.metadata.statementAccountLast4,
      rowsBySourceAccount: summarizeRowsByAccount(parsed.transactions),
      certificateOfDepositSummaries,
      warnings: parsed.warnings || []
    };
  } catch (err) {
    out.citi_banking_all_pdf = {
      label: 'All Citi banking sections',
      targetLast4: '',
      rowCount: 0,
      error: err.message
    };
  }
  return out;
}

function csvEscape(value) {
  const text = String(value == null ? '' : value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function writeCsv(records, reportPath) {
  const headers = [
    'hash',
    'copies',
    'primaryFile',
    'pageCount',
    'statementDate',
    'detectedAccounts',
    'advantageRows',
    'checkingRows',
    'ultimateRows',
    'savingsRows',
    'cdRows',
    'cdSummaries',
    'allBankingRows',
    'accountIssues',
    'warnings'
  ];
  const rows = records.map((record) => [
    record.hash.slice(0, 12),
    record.files.length,
    record.files[0].relativePath,
    record.pageCount || '',
    record.statementDate || '',
    record.detectedAccounts.map((account) => `${account.product || account.accountType} ${account.accountNumber || account.last4}`).join(' | '),
    record.profileParses.advantage_citi_pdf.rowCount,
    record.profileParses.citi_checking_pdf.rowCount,
    record.profileParses.citi_ultimate_plus_pdf.rowCount,
    record.profileParses.citi_savings_pdf.rowCount,
    record.profileParses.citi_cd_pdf.rowCount,
    record.profileParses.citi_cd_pdf.cdSummaryCount,
    record.profileParses.citi_banking_all_pdf.rowCount,
    record.accountIssues.map((issue) => `${issue.type}: ${issue.account}`).join(' | '),
    record.warnings.join(' | ')
  ]);
  fs.writeFileSync(reportPath, [headers, ...rows].map((row) => row.map(csvEscape).join(',')).join('\n'), 'utf8');
}

async function main() {
  const grouped = new Map();
  let physicalFiles = 0;

  const files = listPdfFiles(DATA_SOURCE);
  physicalFiles = files.length;
  for (const filePath of files) {
    const folderSpec = folderSpecForFile(filePath);
    const buffer = fs.readFileSync(filePath);
    const hash = hashBuffer(buffer);
    if (!grouped.has(hash)) {
      grouped.set(hash, {
        hash,
        samplePath: filePath,
        buffer,
        files: []
      });
    }
    grouped.get(hash).files.push({
      folder: folderSpec.label,
      profile: folderSpec.profile,
      relativePath: path.relative(ROOT, filePath)
    });
  }

  const records = [];
  for (const item of Array.from(grouped.values()).sort((a, b) => a.samplePath.localeCompare(b.samplePath))) {
    const { text, pageCount } = await extractPdfText(item.buffer);
    const lines = normalizeLines(text);
    const profileParses = await parseProfiles(item.buffer);
    const detectedAccounts = annotateDetectedAccounts(detectAccountsFromText(lines));
    const statementDate = Object.values(profileParses).map((parsed) => parsed.statementDate).filter(Boolean).sort().pop() || '';
    const warnings = Object.values(profileParses).flatMap((parsed) => parsed.warnings || []).filter(Boolean);
    const record = {
      hash: item.hash,
      files: item.files,
      pageCount,
      statementDate,
      detectedAccounts,
      profileParses,
      warnings: Array.from(new Set(warnings))
    };
    record.accountIssues = buildAccountIssues(record);
    records.push(record);
  }

  fs.mkdirSync(REPORT_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const jsonPath = path.join(REPORT_DIR, `bank-statement-pdf-review-${stamp}.json`);
  const csvPath = path.join(REPORT_DIR, `bank-statement-pdf-review-${stamp}.csv`);
  const summary = {
    physicalFiles,
    uniqueStatements: records.length,
    duplicatePhysicalCopies: physicalFiles - records.length,
    multiCopyStatements: records.filter((record) => record.files.length > 1).length,
    multiAccountStatements: records.filter((record) => record.detectedAccounts.length > 1).length,
    recordsWithCheckingRows: records.filter((record) => record.profileParses.citi_checking_pdf.rowCount > 0).length,
    recordsWithUltimateRows: records.filter((record) => record.profileParses.citi_ultimate_plus_pdf.rowCount > 0).length,
    recordsWithSavingsRows: records.filter((record) => record.profileParses.citi_savings_pdf.rowCount > 0).length,
    recordsWithCdRows: records.filter((record) => record.profileParses.citi_cd_pdf.rowCount > 0).length,
    recordsWithCdSummaries: records.filter((record) => record.profileParses.citi_cd_pdf.cdSummaryCount > 0).length,
    recordsWithAllBankingRows: records.filter((record) => record.profileParses.citi_banking_all_pdf.rowCount > 0).length,
    recordsWithAdvantageRows: records.filter((record) => record.profileParses.advantage_citi_pdf.rowCount > 0).length,
    recordsWithAccountIssues: records.filter((record) => record.accountIssues.length).length,
    issueCounts: records.flatMap((record) => record.accountIssues).reduce((acc, issue) => {
      acc[issue.type] = (acc[issue.type] || 0) + 1;
      return acc;
    }, {})
  };

  fs.writeFileSync(jsonPath, JSON.stringify({ createdAt: new Date().toISOString(), summary, records }, null, 2), 'utf8');
  writeCsv(records, csvPath);

  console.log(JSON.stringify({
    summary,
    jsonReport: path.relative(ROOT, jsonPath),
    csvReport: path.relative(ROOT, csvPath),
    accountIssueExamples: records
      .filter((record) => record.accountIssues.length)
      .slice(0, 15)
      .map((record) => ({
        file: record.files[0].relativePath,
        date: record.statementDate,
        issues: record.accountIssues
      })),
    cdSummaryExamples: records
      .filter((record) => record.profileParses.citi_cd_pdf.cdSummaryCount > 0)
      .slice(0, 15)
      .map((record) => ({
        file: record.files[0].relativePath,
        date: record.statementDate,
        aggregate: record.profileParses.citi_cd_pdf.certificateOfDepositSummaries.aggregate,
        accounts: record.profileParses.citi_cd_pdf.certificateOfDepositSummaries.accounts
      })),
    multiAccountExamples: records
      .filter((record) => record.detectedAccounts.length > 1)
      .slice(0, 10)
      .map((record) => ({
        file: record.files[0].relativePath,
        copies: record.files.length,
        date: record.statementDate,
        accounts: record.detectedAccounts.map((account) => `${account.product || account.accountType} ${account.accountNumber || account.last4}`),
        rows: {
          checking8384: record.profileParses.citi_checking_pdf.rowCount,
          ultimate2950: record.profileParses.citi_ultimate_plus_pdf.rowCount,
          savings8293: record.profileParses.citi_savings_pdf.rowCount,
          cds: record.profileParses.citi_cd_pdf.rowCount,
          cdSummaries: record.profileParses.citi_cd_pdf.cdSummaryCount,
          allBanking: record.profileParses.citi_banking_all_pdf.rowCount,
          advantage3888: record.profileParses.advantage_citi_pdf.rowCount
        }
      }))
  }, null, 2));
}

main().catch((err) => {
  console.error(err.stack || err.message);
  process.exitCode = 1;
});
