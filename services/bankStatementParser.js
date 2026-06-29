'use strict';

const crypto = require('crypto');
const { PDFParse } = require('pdf-parse');

function parseMoney(raw) {
  if (raw == null) return null;
  const text = String(raw).trim();
  const negative = text.includes('-') || /^\(.+\)$/.test(text);
  const value = Number(text.replace(/[,$()\s+-]/g, ''));
  if (!Number.isFinite(value)) return null;
  return negative ? -value : value;
}

function parseShortDate(raw, closeDate) {
  if (!raw || !closeDate) return null;
  const match = String(raw).match(/^(\d{2})\/(\d{2})$/);
  if (!match) return null;
  const month = Number(match[1]);
  const day = Number(match[2]);
  let year = closeDate.getUTCFullYear();
  const closeMonth = closeDate.getUTCMonth() + 1;
  if (closeMonth <= 2 && month >= 11) year -= 1;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function parseFullDate(raw) {
  const match = String(raw || '').match(/^(\d{2})\/(\d{2})\/(\d{2})$/);
  if (!match) return null;
  const year = 2000 + Number(match[3]);
  return new Date(Date.UTC(year, Number(match[1]) - 1, Number(match[2])));
}

function normalizeLines(text) {
  return String(text || '')
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

function parseStatementMetadata(lines) {
  const metadata = {
    profile: 'advantage_citi_pdf',
    institutionName: 'Citi Advantage',
    accountLast4: null,
    billingPeriodStart: null,
    billingPeriodEnd: null,
    statementDate: null,
    paymentDueDate: null,
    newBalance: null,
    minimumPaymentDue: null,
    previousBalance: null,
    payments: null,
    purchases: null,
    creditLimit: null
  };

  for (const line of lines) {
    let match = line.match(/Billing Period:\s*(\d{2}\/\d{2}\/\d{2})-(\d{2}\/\d{2}\/\d{2})/i);
    if (match) {
      const start = parseFullDate(match[1]);
      const end = parseFullDate(match[2]);
      metadata.billingPeriodStart = start ? start.toISOString().slice(0, 10) : null;
      metadata.billingPeriodEnd = end ? end.toISOString().slice(0, 10) : null;
      metadata.statementDate = metadata.billingPeriodEnd;
      continue;
    }

    match = line.match(/Account number ending in:?\s*(\d{4})/i) || line.match(/Account number ending in\s*(\d{4})/i);
    if (match) metadata.accountLast4 = match[1];

    match = line.match(/Payment due date:?\s*(\d{2}\/\d{2}\/\d{2})/i);
    if (match) {
      const date = parseFullDate(match[1]);
      metadata.paymentDueDate = date ? date.toISOString().slice(0, 10) : null;
    }

    match = line.match(/New balance(?: as of (\d{2}\/\d{2}\/\d{2}))?\s*:?\s*([-+$(),.\d]+)/i);
    if (match) {
      if (match[1] && !metadata.statementDate) {
        const date = parseFullDate(match[1]);
        metadata.statementDate = date ? date.toISOString().slice(0, 10) : null;
        metadata.billingPeriodEnd = metadata.billingPeriodEnd || metadata.statementDate;
      }
      metadata.newBalance = parseMoney(match[2]);
    }

    match = line.match(/Minimum payment due:?\s*([-+$(),.\d]+)/i);
    if (match) metadata.minimumPaymentDue = parseMoney(match[1]);

    match = line.match(/^Previous balance\s+([-+$(),.\d]+)/i);
    if (match) metadata.previousBalance = parseMoney(match[1]);

    match = line.match(/^Payments\s+([-+$(),.\d]+)/i);
    if (match) metadata.payments = parseMoney(match[1]);

    match = line.match(/^Purchases\s+([-+$(),.\d]+)/i);
    if (match) metadata.purchases = parseMoney(match[1]);

    match = line.match(/^Credit Limit\s+([-+$(),.\d]+)/i);
    if (match) metadata.creditLimit = parseMoney(match[1]);
  }

  return metadata;
}

function classifySection(section) {
  const text = String(section || '').toLowerCase();
  if (text.includes('payment') || text.includes('credit') || text.includes('adjustment')) return 'credit_or_payment';
  if (text.includes('fee')) return 'fee';
  if (text.includes('interest')) return 'interest';
  return 'purchase';
}

function transactionTypeFor(section, amount) {
  const kind = classifySection(section);
  if (kind === 'credit_or_payment') return amount < 0 ? 'payment' : 'credit';
  if (kind === 'fee') return 'fee';
  if (kind === 'interest') return 'interest';
  return 'purchase';
}

function suggestedLedgerType(section, amount) {
  const type = transactionTypeFor(section, amount);
  if (type === 'payment' || type === 'credit') return 'transfer';
  return 'expense';
}

function suggestedLedgerAmount(section, amount) {
  const type = transactionTypeFor(section, amount);
  if (type === 'payment' || type === 'credit') return Math.abs(amount);
  return -Math.abs(amount);
}

function isSectionLine(line) {
  return /^(Payments, Credits and Adjustments|Standard Purchases(?:, cont'd)?|Fees Charged|Interest Charged)$/i.test(line);
}

function isStopLine(line) {
  return /^(\d{4} totals year-to-date|Interest charge calculation|Account messages|AAdvantage Miles|Page \d+ of \d+)/i.test(line);
}

function isCardholderLine(line) {
  if (!/^[A-Z][A-Z .'-]{3,}$/.test(line)) return false;
  return !/^(ACCOUNT SUMMARY|CARDHOLDER SUMMARY|TOTAL FEES|TOTAL INTEREST|PURCHASES|ADVANCES|CITI|PO BOX|DALLAS|SIOUX FALLS|MEMBER SINCE|IMPORTANT INFORMATION)$/i.test(line);
}

function parseBankingAmount(raw) {
  const text = String(raw || '').replace(/,/g, '').trim();
  if (!text) return null;
  const negative = /^\(.*\)$/.test(text) || /^-/.test(text);
  const value = Number(text.replace(/[()\s+-]/g, ''));
  if (!Number.isFinite(value)) return null;
  return negative ? -value : value;
}

function parseBankingTransactionLine(line) {
  const normalized = String(line || '').replace(/\s+/g, ' ').trim();
  const match = normalized.match(/^(\d{2}\/\d{2}\/\d{2})\s+(.+?)\s+([0-9,.()-]+)\s+([0-9,.()-]+)$/);
  if (!match) return null;
  const date = match[1];
  const description = match[2].trim();
  const amountOne = parseBankingAmount(match[3]);
  const amountTwo = parseBankingAmount(match[4]);
  if (amountOne == null || amountTwo == null) return null;
  const desc = description.toLowerCase();
  const isNegative = /\b(debit|withdrawal|payment|transfer to|sent to|bill pay|online payment)\b/.test(desc);
  return {
    postDate: new Date('20' + date.slice(6, 8) + '-' + date.slice(0, 2) + '-' + date.slice(3, 5) + 'T00:00:00Z').toISOString().slice(0, 10),
    description,
    amount: isNegative ? -Math.abs(amountOne) : Math.abs(amountOne),
    rawAmounts: [amountOne, amountTwo]
  };
}

function parseTransactionLine(line, closeDate) {
  let match = line.match(/^(\d{2}\/\d{2})\s+(\d{2}\/\d{2})\s+(.+?)\s+(-?\$[\d,]+\.\d{2})$/);
  if (match) {
    return {
      saleDate: parseShortDate(match[1], closeDate),
      postDate: parseShortDate(match[2], closeDate),
      description: match[3].trim(),
      amount: parseMoney(match[4])
    };
  }

  match = line.match(/^(\d{2}\/\d{2})\s+(.+?)\s+(-?\$[\d,]+\.\d{2})$/);
  if (match) {
    return {
      saleDate: null,
      postDate: parseShortDate(match[1], closeDate),
      description: match[2].trim(),
      amount: parseMoney(match[3])
    };
  }

  return null;
}

function mergeWrappedTransaction(lines, index) {
  const current = lines[index];
  if (!/^(\d{2}\/\d{2})\s+(\d{2}\/\d{2})\s+/.test(current)) return { line: current, consumed: 0 };
  if (/-?\$[\d,]+\.\d{2}$/.test(current)) return { line: current, consumed: 0 };

  let merged = current;
  let consumed = 0;
  for (let offset = 1; offset <= 3 && index + offset < lines.length; offset++) {
    const next = lines[index + offset];
    if (isSectionLine(next) || isCardholderLine(next) || isStopLine(next)) break;
    merged += ' ' + next;
    consumed = offset;
    if (/-?\$[\d,]+\.\d{2}$/.test(merged)) break;
  }
  return { line: merged, consumed };
}

function fingerprint(row) {
  const source = [
    row.postDate || '',
    row.saleDate || '',
    row.cardholder || '',
    row.description || '',
    row.amount == null ? '' : row.amount.toFixed(2)
  ].join('|').toLowerCase();
  return crypto.createHash('sha256').update(source).digest('hex');
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

async function parseAdvantagePdf(buffer) {
  const { text, pageCount } = await extractPdfText(buffer);
  const lines = normalizeLines(text);
  const metadata = parseStatementMetadata(lines);
  const closeDate = metadata.billingPeriodEnd ? new Date(metadata.billingPeriodEnd + 'T00:00:00Z') : null;
  const transactions = [];
  let inTransactions = false;
  let currentSection = null;
  let currentCardholder = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^Sale$/i.test(line)) {
      inTransactions = true;
      continue;
    }

    if (isStopLine(line)) {
      if (/^Account messages/i.test(line)) break;
      continue;
    }
    if (isSectionLine(line)) {
      inTransactions = true;
      currentSection = line.replace(/, cont'd/i, '');
      continue;
    }
    if (!inTransactions && /^(\d{2}\/\d{2})\s+(\d{2}\/\d{2})\s+/.test(line)) {
      inTransactions = true;
      currentSection = currentSection || 'Standard Purchases';
    }
    if (!inTransactions) continue;
    if (isCardholderLine(line)) {
      currentCardholder = line;
      continue;
    }

    if (/^(Trans\.?|date|Post|Description Amount|date Description Amount)$/i.test(line)) continue;

    const merged = mergeWrappedTransaction(lines, i);
    const parsed = parseTransactionLine(merged.line, closeDate);
    if (parsed) i += merged.consumed;
    if (!parsed || parsed.amount == null || !parsed.postDate) continue;
    const extracted = {
      ...parsed,
      statementDate: metadata.statementDate,
      cardholder: currentCardholder,
      section: currentSection || 'Standard Purchases',
      transactionType: transactionTypeFor(currentSection, parsed.amount),
      suggestedLedgerType: suggestedLedgerType(currentSection, parsed.amount),
      suggestedLedgerAmount: suggestedLedgerAmount(currentSection, parsed.amount),
      currency: 'USD',
      confidence: currentSection ? 0.92 : 0.82
    };
    extracted.fingerprint = fingerprint(extracted);
    transactions.push(extracted);
  }

  return {
    profile: 'advantage_citi_pdf',
    parserVersion: 'advantage-citi-pdf-v1',
    pageCount,
    lineCount: lines.length,
    metadata,
    transactions,
    warnings: transactions.length ? [] : ['No transaction rows were detected. The PDF may require OCR or a new profile.']
  };
}

function detectBankingSection(line) {
  const text = String(line || '').toLowerCase();
  if (text.includes('checking activity')) return 'checking';
  if (text.includes('savings') && text.includes('account activity')) return 'savings';
  if (text.includes('certificate of deposit')) return 'cd';
  return null;
}

async function parsePriorityBankingPdf(buffer) {
  const { text, pageCount } = await extractPdfText(buffer);
  const lines = normalizeLines(text);
  const metadata = parseStatementMetadata(lines);
  metadata.institutionName = 'Citi Priority';
  metadata.profile = 'citi_checking_pdf';
  const transactions = [];
  let currentSection = null;
  let currentAccountName = null;
  let currentAccountClass = 'checking';
  let currentSectionBalance = null;

  for (const line of lines) {
    const section = detectBankingSection(line);
    if (section === 'checking') {
      currentAccountClass = 'checking';
      currentSection = 'Checking';
      currentAccountName = 'Regular Checking';
      continue;
    }
    if (section === 'savings') {
      currentAccountClass = 'savings';
      currentSection = 'Savings';
      currentAccountName = 'Citibank Savings Plus';
      continue;
    }
    if (section === 'cd') {
      currentAccountClass = 'savings';
      currentSection = 'Certificates of Deposit';
      currentAccountName = 'Certificate of Deposit';
      continue;
    }
    if (/^Date Description Amount Subtracted Amount Added Balance$/i.test(line)) continue;
    if (/^Opening Balance /i.test(line) || /^Closing Balance /i.test(line) || /^Total Subtracted\/Added /i.test(line)) continue;
    const headerMatch = line.match(/^(Checking|Savings|Certificates of Deposit)\s+(.+Account Activity.+)$/i);
    if (headerMatch) {
      if (/checking/i.test(headerMatch[1])) {
        currentAccountClass = 'checking';
      } else if (/savings|deposit/i.test(headerMatch[1])) {
        currentAccountClass = 'savings';
      }
      currentAccountName = headerMatch[2].replace(/Account Activity/i, '').replace(/\s+/g, ' ').trim();
      continue;
    }
    const parsed = parseBankingTransactionLine(line);
    if (!parsed) continue;
    currentSectionBalance = parsed.rawAmounts[1];
    const amount = parsed.amount;
    const transactionType = amount >= 0 ? 'income' : 'expense';
    transactions.push({
      saleDate: null,
      postDate: parsed.postDate,
      description: parsed.description,
      amount,
      statementDate: metadata.statementDate,
      cardholder: null,
      section: currentSection || 'Banking Activity',
      transactionType,
      suggestedLedgerType: amount >= 0 ? 'income' : 'expense',
      suggestedLedgerAmount: amount,
      currency: 'USD',
      confidence: 0.9,
      accountClass: currentAccountClass,
      accountName: currentAccountName,
      balance: currentSectionBalance,
      fingerprint: crypto.createHash('sha256').update([parsed.postDate, parsed.description, amount.toFixed(2), currentAccountName || ''].join('|').toLowerCase()).digest('hex')
    });
  }

  return {
    profile: 'citi_checking_pdf',
    parserVersion: 'citi-banking-pdf-v1',
    pageCount,
    lineCount: lines.length,
    metadata,
    transactions,
    warnings: transactions.length ? [] : ['No banking transaction rows were detected. The PDF may require OCR or a new banking profile.']
  };
}

const PROFILE_CONFIG = {
  advantage_citi_pdf: {
    profile: 'advantage_citi_pdf',
    institutionName: 'Citi Advantage',
    accountClass: 'credit_card',
    accountSubtype: 'credit card'
  },
  citi_checking_pdf: {
    profile: 'citi_checking_pdf',
    institutionName: 'Citi Checking',
    accountClass: 'checking',
    accountSubtype: 'checking'
  },
  citi_ultimate_plus_pdf: {
    profile: 'citi_ultimate_plus_pdf',
    institutionName: 'Citi Ultimate Plus',
    accountClass: 'savings',
    accountSubtype: 'savings'
  },
  citi_savings_pdf: {
    profile: 'citi_savings_pdf',
    institutionName: 'Day to Day Savings',
    accountClass: 'savings',
    accountSubtype: 'savings'
  }
};

async function parseBankStatement({ buffer, profile }) {
  if (!PROFILE_CONFIG[profile]) {
    throw new Error('Unsupported statement profile: ' + profile);
  }
  const parsed = profile === 'advantage_citi_pdf'
    ? await parseAdvantagePdf(buffer)
    : await parsePriorityBankingPdf(buffer);
  const config = PROFILE_CONFIG[profile];
  parsed.profile = config.profile;
  parsed.metadata = Object.assign({}, parsed.metadata, {
    profile: config.profile,
    institutionName: config.institutionName,
    accountClass: config.accountClass,
    accountSubtype: config.accountSubtype
  });
  return parsed;
}

module.exports = {
  parseBankStatement,
  parseAdvantagePdf,
  PROFILE_CONFIG
};
