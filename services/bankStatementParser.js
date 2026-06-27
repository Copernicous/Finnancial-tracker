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

async function parseBankStatement({ buffer, profile }) {
  if (profile !== 'advantage_citi_pdf') {
    throw new Error('Unsupported statement profile: ' + profile);
  }
  return parseAdvantagePdf(buffer);
}

module.exports = {
  parseBankStatement,
  parseAdvantagePdf
};
