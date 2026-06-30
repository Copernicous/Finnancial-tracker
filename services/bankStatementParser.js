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
    credits: null,
    purchases: null,
    cashAdvances: null,
    fees: null,
    interest: null,
    creditLimit: null
  };
  let inAccountSummary = false;
  let accountSummaryComplete = false;

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

    if (!/Digital account number/i.test(line)) {
      match = line.match(/Account number ending in:?\s*(\d{4})/i) || line.match(/Account number ending in\s*(\d{4})/i);
      if (match) metadata.accountLast4 = match[1];
    }

    if (!accountSummaryComplete && /^Account Summary$/i.test(line)) {
      inAccountSummary = true;
      continue;
    }

    match = line.match(/Payment due date:?\s*(\d{2}\/\d{2}\/\d{2})/i);
    if (match) {
      const date = parseFullDate(match[1]);
      metadata.paymentDueDate = date ? date.toISOString().slice(0, 10) : null;
    }

    match = line.match(/New balance(?: as of (\d{2}\/\d{2}\/\d{2}))?\s*:?\s*([-+$(),.\d]+)/i);
    if (match && (inAccountSummary || match[1] || !accountSummaryComplete)) {
      if (match[1] && !metadata.statementDate) {
        const date = parseFullDate(match[1]);
        metadata.statementDate = date ? date.toISOString().slice(0, 10) : null;
        metadata.billingPeriodEnd = metadata.billingPeriodEnd || metadata.statementDate;
      }
      metadata.newBalance = parseMoney(match[2]);
      if (inAccountSummary && /^New balance\s+/i.test(line)) {
        accountSummaryComplete = true;
        inAccountSummary = false;
      }
    }

    match = line.match(/Minimum payment due:?\s*([-+$(),.\d]+)/i);
    if (match) metadata.minimumPaymentDue = parseMoney(match[1]);

    if (!inAccountSummary) {
      match = line.match(/^Credit Limit\s+([-+$(),.\d]+)/i);
      if (match) metadata.creditLimit = parseMoney(match[1]);
      continue;
    }

    match = line.match(/^Previous balance\s+([-+$(),.\d]+)/i);
    if (match) metadata.previousBalance = parseMoney(match[1]);

    match = line.match(/^Payments\s+([-+$(),.\d]+)/i);
    if (match) metadata.payments = parseMoney(match[1]);

    match = line.match(/^Credits\s+([-+$(),.\d]+)/i);
    if (match) metadata.credits = parseMoney(match[1]);

    match = line.match(/^Purchases\s+([-+$(),.\d]+)/i);
    if (match) metadata.purchases = parseMoney(match[1]);

    match = line.match(/^Cash advances\s+([-+$(),.\d]+)/i);
    if (match) metadata.cashAdvances = parseMoney(match[1]);

    match = line.match(/^Fees\s+([-+$(),.\d]+)/i);
    if (match) metadata.fees = parseMoney(match[1]);

    match = line.match(/^Interest\s+([-+$(),.\d]+)/i);
    if (match) metadata.interest = parseMoney(match[1]);

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
  if (text.includes('cash advance')) return 'cash_advance';
  return 'purchase';
}

function transactionTypeFor(section, amount) {
  const kind = classifySection(section);
  if (kind === 'credit_or_payment') return amount < 0 ? 'payment' : 'credit';
  if (kind === 'fee') return 'fee';
  if (kind === 'interest') return 'interest';
  if (kind === 'cash_advance') return 'cash_advance';
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

function isBankingInternalTransfer(description) {
  const text = String(description || '').toLowerCase();
  return /online payment, thank you|citi card online payment/.test(text)
    || /\btransfer\s+(to|from)\b/.test(text)
    || /\bmoney market\b/.test(text)
    || /\bult(?:imate)?\s+savings\b|\bsavings plus\b/.test(text)
    || /certificate(?:s)? of deposit|\bcd account\b|\b(to|from) cd\b/.test(text)
    || /\b(to|from)\s+(checking|savings)\b/.test(text);
}

function bankingSuggestedLedgerType(description, amount) {
  if (isBankingInternalTransfer(description)) return 'transfer';
  return amount >= 0 ? 'income' : 'expense';
}

function isSectionLine(line) {
  return /^(Payments, Credits and Adjustments|Standard Purchases(?:, cont'd)?|Fees Charged|Interest Charged|Cash Advances)$/i.test(line);
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
  const value = Number(text.replace(/[$()\s+-]/g, ''));
  if (!Number.isFinite(value)) return null;
  return negative ? -value : value;
}

function bankingDate(raw, closeDate) {
  const text = String(raw || '').trim();
  if (/^\d{2}\/\d{2}\/\d{2}$/.test(text)) {
    return new Date('20' + text.slice(6, 8) + '-' + text.slice(0, 2) + '-' + text.slice(3, 5) + 'T00:00:00Z').toISOString().slice(0, 10);
  }
  return parseShortDate(text, closeDate);
}

function parseBankingTransactionLine(line, closeDate) {
  const normalized = String(line || '').replace(/\s+/g, ' ').trim();
  const moneyPattern = '(\\(?-?(?:\\d{1,3}(?:,\\d{3})+|\\d+)\\.\\d{2}\\)?)';
  const match = normalized.match(new RegExp('^(\\d{2}\\/\\d{2}(?:\\/\\d{2})?)\\s+(.+?)\\s+' + moneyPattern + '(?:\\s+' + moneyPattern + ')?$'));
  if (!match) return null;
  const date = match[1];
  const description = match[2].trim();
  const amountOne = parseBankingAmount(match[3]);
  const amountTwo = match[4] ? parseBankingAmount(match[4]) : null;
  if (amountOne == null) return null;
  const desc = description.toLowerCase();
  const isNegative = /\b(debit|withdrawal|payment|transfer to|sent to|bill pay|online payment|purchase|check|cash withdrawal|fee|fees|service charge|charge)\b/.test(desc);
  const isPositive = !isNegative && /\b(credit|deposit|transfer from|incoming|interest paid|amount added)\b/.test(desc);
  const postDate = bankingDate(date, closeDate);
  if (!postDate) return null;
  return {
    postDate,
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

function parseBankingStatementPeriod(lines) {
  for (const line of lines) {
    const match = String(line || '').match(/\b([A-Za-z]+)\s+(\d{1,2})\s+-\s+([A-Za-z]+)\s+(\d{1,2}),\s+(\d{4})\b/);
    if (!match) continue;
    const start = new Date(`${match[1]} ${match[2]}, ${match[5]} 00:00:00 UTC`);
    const end = new Date(`${match[3]} ${match[4]}, ${match[5]} 00:00:00 UTC`);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) continue;
    if (start > end) start.setUTCFullYear(start.getUTCFullYear() - 1);
    return {
      start: start.toISOString().slice(0, 10),
      end: end.toISOString().slice(0, 10)
    };
  }
  return null;
}

function detectBankingStatementLayout(lines) {
  let hasLegacyMarker = false;
  let hasSimplifiedMarker = false;

  for (const line of lines) {
    const text = String(line || '');
    if (/simplified banking Account Statement/i.test(text) || /^Activity\s+(?:Regular Checking|.+\s+\d{7,})/i.test(text)) {
      hasSimplifiedMarker = true;
    }
    if (/Statement Period\s*-/i.test(text) || /^(CHECKING|SAVINGS|CERTIFICATES OF DEPOSIT) ACTIVITY(?: Continued)?$/i.test(text)) {
      hasLegacyMarker = true;
    }
  }

  if (hasSimplifiedMarker) return 'simplified';
  if (hasLegacyMarker) return 'legacy';
  return 'unknown';
}

function parseBankingAccountLine(line) {
  const checking = String(line || '').match(/\bRegular Checking\s+(\d{4,})\b/i);
  if (checking) {
    return {
      accountClass: 'checking',
      accountName: 'Regular Checking',
      accountNumber: checking[1],
      accountLast4: checking[1].slice(-4),
      section: 'Checking'
    };
  }

  const savings = String(line || '').match(/\bCitibank(?:\W+)?Savings Plus\s+(\d{4,})\b/i);
  if (savings) {
    return {
      accountClass: 'savings',
      accountName: 'Citibank Savings Plus',
      accountNumber: savings[1],
      accountLast4: savings[1].slice(-4),
      section: 'Savings'
    };
  }

  const cd = String(line || '').match(/\b(?:Certificate(?:s)? of Deposit|CD Account)\s+(\d{4,})\b/i);
  if (cd) {
    return {
      accountClass: 'cd',
      accountName: 'Certificate of Deposit',
      accountNumber: cd[1],
      accountLast4: cd[1].slice(-4),
      section: 'Certificates of Deposit'
    };
  }

  if (/\bUltimate Savings Account\b/i.test(line)) {
    return {
      accountClass: 'savings',
      accountName: 'Ultimate Savings Account',
      accountNumber: null,
      accountLast4: null,
      section: 'Savings'
    };
  }

  return null;
}

function parseBankingAccountNumber(line) {
  const text = String(line || '');
  const match = text.match(/\b(\d{7,})\b/);
  return match ? match[1] : null;
}

function bankingProductFromLine(line, currentClass) {
  const text = String(line || '').trim();
  if (/Regular Checking/i.test(text)) {
    return { accountClass: 'checking', accountName: 'Regular Checking', section: 'Checking' };
  }
  if (/Citibank(?:\W+)?Savings Plus/i.test(text)) {
    return { accountClass: 'savings', accountName: 'Citibank Savings Plus', section: 'Savings' };
  }
  if (/Ultimate Savings Account/i.test(text)) {
    return { accountClass: 'savings', accountName: 'Ultimate Savings Account', section: 'Savings' };
  }
  if (/Certificate(?:s)? of Deposit|CD Account/i.test(text)) {
    return { accountClass: 'cd', accountName: 'Certificate of Deposit', section: 'Certificates of Deposit' };
  }
  if (currentClass === 'checking') return { accountClass: 'checking', accountName: 'Regular Checking', section: 'Checking' };
  if (currentClass === 'savings') return { accountClass: 'savings', accountName: 'Citibank Savings Plus', section: 'Savings' };
  if (currentClass === 'cd') return { accountClass: 'cd', accountName: 'Certificate of Deposit', section: 'Certificates of Deposit' };
  return { accountClass: 'bank', accountName: 'Citi banking', section: 'Banking Activity' };
}

function firstMoneyValue(line) {
  const match = String(line || '').match(/\$?\(?-?(?:\d{1,3}(?:,\d{3})+|\d+)\.\d{2}\)?/);
  return match ? parseBankingAmount(match[0]) : null;
}

function parseOptionalBankingAmount(raw) {
  const text = String(raw || '').trim();
  if (!text || text === '-' || /^--+$/.test(text)) return null;
  return parseBankingAmount(text);
}

function parsePercent(raw) {
  const text = String(raw || '').trim();
  if (!text || text === '-' || /^--+$/.test(text)) return null;
  return text;
}

function parseStatementSlashDate(raw) {
  const parsed = parseFullDate(raw);
  return parsed ? parsed.toISOString().slice(0, 10) : null;
}

function roundMoney(value) {
  return Number(Number(value || 0).toFixed(2));
}

function ensureBankingSummary(summaries, state) {
  const accountNumber = state.accountNumber || parseBankingAccountNumber(state.rawLine || '') || null;
  const accountLast4 = state.accountLast4 || (accountNumber ? accountNumber.slice(-4) : null);
  const key = accountNumber || accountLast4 || `${state.accountClass || 'bank'}:${state.accountName || state.section || 'unknown'}:${summaries.length}`;
  if (!summaries.has(key)) {
    summaries.set(key, {
      accountClass: state.accountClass || 'bank',
      accountName: state.accountName || null,
      accountNumber,
      accountLast4,
      section: state.section || null,
      openingBalance: null,
      closingBalance: null,
      totalSubtracted: null,
      totalAdded: null
    });
  }
  const summary = summaries.get(key);
  summary.accountClass = state.accountClass || summary.accountClass;
  summary.accountName = state.accountName || summary.accountName;
  summary.section = state.section || summary.section;
  if (accountNumber && !summary.accountNumber) summary.accountNumber = accountNumber;
  if (accountLast4 && !summary.accountLast4) summary.accountLast4 = accountLast4;
  return summary;
}

function extractBankingAccountSummaries(lines) {
  const summaries = new Map();
  let currentClass = null;
  let currentSection = null;
  let currentName = null;
  let currentNumber = null;
  let currentLast4 = null;

  function setCurrent(payload) {
    if (!payload) return;
    currentClass = payload.accountClass || currentClass;
    currentSection = payload.section || currentSection;
    currentName = payload.accountName || currentName;
    currentNumber = payload.accountNumber || currentNumber;
    currentLast4 = payload.accountLast4 || (currentNumber ? currentNumber.slice(-4) : currentLast4);
  }

  function currentState(extra = {}) {
    const product = bankingProductFromLine(extra.rawLine || currentName || currentSection || '', currentClass);
    return {
      accountClass: currentClass || product.accountClass,
      accountName: currentName || product.accountName,
      accountNumber: currentNumber,
      accountLast4: currentLast4,
      section: currentSection || product.section,
      ...extra
    };
  }

  for (const line of lines) {
    const section = detectBankingSection(line);
    if (section) {
      const hasActiveSectionAccount = currentNumber && currentClass === section;
      currentClass = section === 'checking' ? 'checking' : section === 'savings' ? 'savings' : section;
      currentSection = section === 'checking' ? 'Checking' : section === 'savings' ? 'Savings' : 'Certificates of Deposit';
      if (!/continued/i.test(line) && !hasActiveSectionAccount) {
        currentName = null;
        currentNumber = null;
        currentLast4 = null;
      }
    }

    const accountLine = parseBankingAccountLine(line);
    if (accountLine) {
      setCurrent(accountLine);
      ensureBankingSummary(summaries, currentState({ rawLine: line }));
      continue;
    }

    const product = bankingProductFromLine(line, currentClass);
    if (/(Regular Checking|Citibank(?:\W+)?Savings Plus|Ultimate Savings Account|Certificate(?:s)? of Deposit|CD Account)/i.test(line)) {
      currentClass = product.accountClass;
      currentName = product.accountName;
      currentSection = product.section;
    }

    const accountNumber = parseBankingAccountNumber(line);
    if (accountNumber && /(Beginning|Opening|Ending|Closing) Balance/i.test(line)) {
      currentNumber = accountNumber;
      currentLast4 = accountNumber.slice(-4);
    }

    let match = line.match(/^(?:\d{2}\/\d{2}(?:\/\d{2})?\s+)?Opening Balance\s+(\$?\(?-?(?:\d{1,3}(?:,\d{3})+|\d+)\.\d{2}\)?)/i);
    if (match) {
      const summary = ensureBankingSummary(summaries, currentState({ rawLine: line }));
      summary.openingBalance = parseBankingAmount(match[1]);
      continue;
    }

    match = line.match(/^(?:\d{2}\/\d{2}(?:\/\d{2})?\s+)?Closing Balance\s+(\$?\(?-?(?:\d{1,3}(?:,\d{3})+|\d+)\.\d{2}\)?)/i);
    if (match) {
      const summary = ensureBankingSummary(summaries, currentState({ rawLine: line }));
      summary.closingBalance = parseBankingAmount(match[1]);
      continue;
    }

    if (/Beginning Balance/i.test(line)) {
      const summary = ensureBankingSummary(summaries, currentState({ rawLine: line }));
      const beginMatch = line.match(/Beginning Balance:?\s*\$?(\(?-?(?:\d{1,3}(?:,\d{3})+|\d+)\.\d{2}\)?)/i);
      if (beginMatch) summary.openingBalance = parseBankingAmount(beginMatch[1]);
      const endingAfterMatch = line.match(/Ending Balance:?\s*\$?(\(?-?(?:\d{1,3}(?:,\d{3})+|\d+)\.\d{2}\)?)/i);
      if (endingAfterMatch) {
        summary.closingBalance = parseBankingAmount(endingAfterMatch[1]);
      } else if (/Ending Balance:?$/i.test(line)) {
        const values = Array.from(line.matchAll(/\$?\(?-?(?:\d{1,3}(?:,\d{3})+|\d+)\.\d{2}\)?/g)).map((item) => parseBankingAmount(item[0]));
        if (values.length >= 2) summary.closingBalance = values[values.length - 1];
      }
      continue;
    }

    if (/^Ending Balance/i.test(line)) {
      const summary = ensureBankingSummary(summaries, currentState({ rawLine: line }));
      summary.closingBalance = firstMoneyValue(line);
      continue;
    }

    match = line.match(/^Total Subtracted\/Added\s+(\$?\(?-?(?:\d{1,3}(?:,\d{3})+|\d+)\.\d{2}\)?)\s+(\$?\(?-?(?:\d{1,3}(?:,\d{3})+|\d+)\.\d{2}\)?)/i);
    if (match) {
      const summary = ensureBankingSummary(summaries, currentState({ rawLine: line }));
      summary.totalSubtracted = parseBankingAmount(match[1]);
      summary.totalAdded = parseBankingAmount(match[2]);
    }
  }

  return Array.from(summaries.values()).filter((summary) => (
    summary.accountNumber || summary.accountLast4 || summary.openingBalance != null || summary.closingBalance != null || summary.totalAdded != null || summary.totalSubtracted != null
  ));
}

function extractCertificateOfDepositSummaries(lines, statementDate) {
  const aggregate = {
    lastPeriodBalance: null,
    thisPeriodBalance: null,
    interestThisPeriod: null,
    interestThisYear: null,
    impliedPrincipalChange: null
  };
  const accounts = [];
  const moneyValuePattern = '\\$?(?:-|\\(?-?(?:\\d{1,3}(?:,\\d{3})+|\\d+)\\.\\d{2}\\)?)';
  let summaryMode = null;

  for (const line of lines) {
    if (/^Value of Accounts Last Period This Period$/i.test(line)) {
      summaryMode = 'value';
      continue;
    }
    if (/^Earnings Summary This Period This Year$/i.test(line)) {
      summaryMode = 'earnings';
      continue;
    }
    if (/^Citi Priority Relationship Total\b/i.test(line)) {
      summaryMode = null;
      continue;
    }

    let match = line.match(new RegExp(`^Certificates of Deposit\\s+(${moneyValuePattern})\\s+(${moneyValuePattern})$`, 'i'));
    if (match && summaryMode === 'value') {
      aggregate.lastPeriodBalance = parseOptionalBankingAmount(match[1]);
      aggregate.thisPeriodBalance = parseOptionalBankingAmount(match[2]);
      continue;
    }
    if (match && summaryMode === 'earnings') {
      aggregate.interestThisPeriod = parseOptionalBankingAmount(match[1]);
      aggregate.interestThisYear = parseOptionalBankingAmount(match[2]);
      continue;
    }

    match = line.match(new RegExp(`^(.+?)\\s+(\\d{7,})\\s+(\\d{2}\\/\\d{2}\\/\\d{2})\\s+([\\d.]+%|-)\\s+([\\d.]+%|-)\\s+(${moneyValuePattern})\\s+(${moneyValuePattern})$`, 'i'));
    if (match && /\b(?:CD|Certificate)/i.test(match[1])) {
      const accountNumber = match[2];
      accounts.push({
        accountClass: 'cd',
        accountName: 'Certificate of Deposit',
        cdType: match[1].replace(/\s+/g, ' ').trim(),
        accountNumber,
        accountLast4: accountNumber.slice(-4),
        maturityDate: parseStatementSlashDate(match[3]),
        interestRate: parsePercent(match[4]),
        annualPercentageYield: parsePercent(match[5]),
        interestCreditedInPeriod: parseOptionalBankingAmount(match[6]),
        balanceAsOfStatementDate: parseOptionalBankingAmount(match[7]),
        statementDate
      });
    }
  }

  if (aggregate.lastPeriodBalance != null && aggregate.thisPeriodBalance != null && aggregate.interestThisPeriod != null) {
    aggregate.impliedPrincipalChange = roundMoney(aggregate.thisPeriodBalance - aggregate.lastPeriodBalance - aggregate.interestThisPeriod);
  }

  const hasAggregate = Object.values(aggregate).some((value) => value != null);
  if (!hasAggregate && !accounts.length) return null;
  return { aggregate, accounts };
}

function buildCertificateOfDepositInterestTransactions(cdSummary, statementDate) {
  if (!cdSummary || !Array.isArray(cdSummary.accounts) || !statementDate) return [];
  return cdSummary.accounts
    .filter((account) => Number(account.interestCreditedInPeriod || 0) !== 0)
    .map((account) => {
      const amount = Number(account.interestCreditedInPeriod || 0);
      const balance = account.balanceAsOfStatementDate;
      const description = `CD Interest Credited ${account.cdType || 'Certificate of Deposit'} ${account.accountLast4 || ''}`.trim();
      return {
        saleDate: null,
        postDate: statementDate,
        description,
        amount,
        statementDate,
        cardholder: null,
        section: 'Certificates of Deposit',
        transactionType: 'income',
        suggestedLedgerType: 'income',
        suggestedLedgerAmount: amount,
        currency: 'USD',
        confidence: 0.88,
        accountClass: 'cd',
        accountName: account.cdType || 'Certificate of Deposit',
        accountNumber: account.accountNumber,
        accountLast4: account.accountLast4,
        balance,
        cdSummary: account,
        fingerprint: crypto.createHash('sha256').update([
          statementDate,
          account.accountNumber || account.accountLast4 || '',
          'cd-interest',
          amount.toFixed(2),
          balance == null ? '' : Number(balance).toFixed(2)
        ].join('|').toLowerCase()).digest('hex')
      };
    });
}

function mergeBankingTransactionLine(lines, index) {
  let merged = lines[index];
  let consumed = 0;
  if (/\s+\(?-?(?:\d{1,3}(?:,\d{3})+|\d+)\.\d{2}\)?(?:\s+\(?-?(?:\d{1,3}(?:,\d{3})+|\d+)\.\d{2}\)?)?$/.test(merged)) return { line: merged, consumed };
  for (let offset = 1; offset <= 3 && index + offset < lines.length; offset++) {
    const next = lines[index + offset];
    if (/^\d{2}\/\d{2}(?:\/\d{2})?\s+/.test(next) || detectBankingSection(next) || /^Date Description /i.test(next) || /^Total Subtracted\/Added /i.test(next)) break;
    merged += ' ' + next;
    consumed = offset;
    if (/\s+\(?-?(?:\d{1,3}(?:,\d{3})+|\d+)\.\d{2}\)?(?:\s+\(?-?(?:\d{1,3}(?:,\d{3})+|\d+)\.\d{2}\)?)?$/.test(merged)) break;
  }
  return { line: merged, consumed };
}

function mergeWrappedTransaction(lines, index) {
  const current = lines[index];
  if (!/^(\d{2}\/\d{2})(?:\s+\d{2}\/\d{2})?\s+/.test(current)) return { line: current, consumed: 0 };
  if (/-?\$[\d,]+\.\d{2}$/.test(current)) return { line: current, consumed: 0 };

  let merged = current;
  let consumed = 0;
  for (let offset = 1; offset <= 8 && index + offset < lines.length; offset++) {
    const next = lines[index + offset];
    if (/^(\d{2}\/\d{2})(?:\s+\d{2}\/\d{2})?\s+/.test(next)) break;
    if (isSectionLine(next) || isStopLine(next)) break;
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

function uniquifyTransactionFingerprints(transactions) {
  const seen = new Map();
  transactions.forEach((row) => {
    if (!row.fingerprint) return;
    const baseFingerprint = row.fingerprint;
    const nextOccurrence = (seen.get(baseFingerprint) || 0) + 1;
    seen.set(baseFingerprint, nextOccurrence);
    row.baseFingerprint = baseFingerprint;
    row.fingerprintOccurrence = nextOccurrence;
    if (nextOccurrence > 1) {
      row.fingerprint = crypto
        .createHash('sha256')
        .update(`${baseFingerprint}|occurrence:${nextOccurrence}`)
        .digest('hex');
    }
  });
  return transactions;
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

  uniquifyTransactionFingerprints(transactions);

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
  if (/^checking(?: continued)?$/i.test(text) || text.includes('checking activity')) return 'checking';
  if (/^savings(?: continued)?$/i.test(text) || text.includes('savings activity') || (text.includes('savings') && text.includes('account activity'))) return 'savings';
  if (text.includes('certificate of deposit') || text.includes('certificates of deposit') || text.includes('cd account')) return 'cd';
  return null;
}

async function parsePriorityBankingPdf(buffer, options = {}) {
  const { text, pageCount } = await extractPdfText(buffer);
  const lines = normalizeLines(text);
  const metadata = parseStatementMetadata(lines);
  const statementPeriod = parseBankingStatementPeriod(lines);
  const closeDate = statementPeriod ? new Date(statementPeriod.end + 'T00:00:00Z') : null;
  const detectedLayout = detectBankingStatementLayout(lines);
  const expectedLayout = options.expectedLayout || null;
  metadata.institutionName = 'Citi Priority';
  metadata.profile = options.profile || 'citi_checking_pdf';
  metadata.canonicalProfile = options.canonicalProfile || metadata.profile;
  metadata.statementLayout = detectedLayout;
  metadata.expectedLayout = expectedLayout;
  metadata.bankingAccountSummaries = extractBankingAccountSummaries(lines);
  if (statementPeriod) {
    metadata.billingPeriodStart = statementPeriod.start;
    metadata.billingPeriodEnd = statementPeriod.end;
    metadata.statementDate = statementPeriod.end;
  }
  metadata.certificateOfDepositSummaries = extractCertificateOfDepositSummaries(lines, metadata.statementDate || null);

  if (expectedLayout && detectedLayout !== 'unknown' && expectedLayout !== detectedLayout) {
    return {
      profile: options.profile || 'citi_checking_pdf',
      parserVersion: `citi-banking-pdf-v2-${detectedLayout}`,
      pageCount,
      lineCount: lines.length,
      metadata,
      transactions: [],
      warnings: [`Selected Citi ${expectedLayout} format, but this statement looks like ${detectedLayout} format. Choose the matching Citi profile for this PDF.`]
    };
  }

  const targetLayout = expectedLayout || (detectedLayout === 'unknown' ? 'default' : detectedLayout);
  const layoutTarget = (options.layoutTargets && (options.layoutTargets[targetLayout] || options.layoutTargets.default)) || {};
  const statementTargetLast4 = layoutTarget.targetLast4 || options.targetLast4 || '';
  const profileTargetLast4 = options.targetLast4 || statementTargetLast4;
  const targetProductPattern = layoutTarget.targetProductPattern || options.targetProductPattern || null;
  const targetAccountClass = layoutTarget.targetAccountClass || options.targetAccountClass || '';
  const transactions = [];
  let currentSection = null;
  let currentAccountName = null;
  let currentAccountClass = 'checking';
  let currentAccountNumber = null;
  let currentAccountLast4 = null;
  let currentSectionBalance = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const section = detectBankingSection(line);
    if (section === 'checking') {
      const hasActiveCheckingAccount = currentAccountClass === 'checking' && currentAccountNumber;
      currentAccountClass = 'checking';
      currentSection = 'Checking';
      if (!/continued/i.test(line) && !hasActiveCheckingAccount) {
        currentAccountName = 'Regular Checking';
        currentAccountNumber = null;
        currentAccountLast4 = null;
      }
      continue;
    }
    if (section === 'savings') {
      const hasActiveSavingsAccount = currentAccountClass === 'savings' && currentAccountNumber;
      currentAccountClass = 'savings';
      currentSection = 'Savings';
      if (!/continued/i.test(line) && !hasActiveSavingsAccount) {
        currentAccountName = 'Citibank Savings Plus';
        currentAccountNumber = null;
        currentAccountLast4 = null;
      }
      continue;
    }
    if (section === 'cd') {
      currentAccountClass = 'cd';
      currentSection = 'Certificates of Deposit';
      currentAccountName = 'Certificate of Deposit';
      currentAccountNumber = null;
      currentAccountLast4 = null;
      continue;
    }
    const accountLine = parseBankingAccountLine(line);
    if (accountLine) {
      currentAccountClass = accountLine.accountClass;
      currentAccountName = accountLine.accountName;
      currentAccountNumber = accountLine.accountNumber;
      currentAccountLast4 = accountLine.accountLast4;
      currentSection = accountLine.section;
      continue;
    }
    const accountNumber = parseBankingAccountNumber(line);
    if (accountNumber && /Beginning Balance|Ending Balance/i.test(line)) {
      currentAccountNumber = accountNumber;
      currentAccountLast4 = accountNumber.slice(-4);
    }
    if (/^Date Description Amount Subtracted Amount Added Balance$/i.test(line)) continue;
    if (/^Activity Balance Amount Subtracted Amount Added Date Description Continued$/i.test(line)) continue;
    if (/^Opening Balance /i.test(line) || /^Closing Balance /i.test(line) || /^Total Subtracted\/Added /i.test(line)) continue;
    if (/^\d{2}\/\d{2}(?:\/\d{2})?\s+(Opening|Closing|Beginning) Balance\b/i.test(line)) continue;
    const headerMatch = line.match(/^(Checking|Savings|Certificates of Deposit)\s+(.+Account Activity.+)$/i);
    if (headerMatch) {
      if (/checking/i.test(headerMatch[1])) {
        currentAccountClass = 'checking';
      } else if (/deposit/i.test(headerMatch[1])) {
        currentAccountClass = 'cd';
      } else if (/savings|deposit/i.test(headerMatch[1])) {
        currentAccountClass = 'savings';
      }
      currentAccountName = headerMatch[2].replace(/Account Activity/i, '').replace(/\s+/g, ' ').trim();
      continue;
    }
    const merged = mergeBankingTransactionLine(lines, i);
    const parsed = parseBankingTransactionLine(merged.line, closeDate);
    if (!parsed) continue;
    i += merged.consumed;
    currentSectionBalance = parsed.rawAmounts[1];
    const amount = parsed.amount;
    const transactionType = bankingSuggestedLedgerType(parsed.description, amount);
    transactions.push({
      saleDate: null,
      postDate: parsed.postDate,
      description: parsed.description,
      amount,
      statementDate: metadata.statementDate,
      cardholder: null,
      section: currentSection || 'Banking Activity',
      transactionType,
      suggestedLedgerType: transactionType,
      suggestedLedgerAmount: amount,
      currency: 'USD',
      confidence: 0.9,
      accountClass: currentAccountClass,
      accountName: currentAccountName,
      accountNumber: currentAccountNumber,
      accountLast4: currentAccountLast4,
      balance: currentSectionBalance,
      fingerprint: crypto.createHash('sha256').update([parsed.postDate, parsed.description, amount.toFixed(2), currentAccountName || '', currentAccountNumber || currentAccountLast4 || ''].join('|').toLowerCase()).digest('hex')
    });
  }

  transactions.push(...buildCertificateOfDepositInterestTransactions(metadata.certificateOfDepositSummaries, metadata.statementDate));
  uniquifyTransactionFingerprints(transactions);

  const normalizedStatementTargetLast4 = statementTargetLast4 ? String(statementTargetLast4) : '';
  let scopedTransactions = transactions;
  if (targetAccountClass) {
    scopedTransactions = scopedTransactions.filter((row) => row.accountClass === targetAccountClass);
  }
  if (normalizedStatementTargetLast4) {
    scopedTransactions = scopedTransactions.filter((row) => String(row.accountLast4 || '') === normalizedStatementTargetLast4 || (targetProductPattern && targetProductPattern.test(row.accountName || '')));
  } else if (targetProductPattern && !targetAccountClass) {
    scopedTransactions = scopedTransactions.filter((row) => targetProductPattern.test(row.accountName || row.section || ''));
  }

  if (normalizedStatementTargetLast4) metadata.statementAccountLast4 = normalizedStatementTargetLast4;
  if (targetAccountClass) metadata.statementAccountClass = targetAccountClass;
  if (profileTargetLast4) metadata.accountLast4 = String(profileTargetLast4);

  return {
    profile: options.profile || 'citi_checking_pdf',
    parserVersion: `citi-banking-pdf-v2-${detectedLayout}`,
    pageCount,
    lineCount: lines.length,
    metadata,
    transactions: scopedTransactions,
    warnings: scopedTransactions.length ? [] : ['No banking transaction rows were detected for the selected account profile. The PDF may require OCR or a new banking profile.']
  };
}

async function parseCitiBankingStatement(buffer) {
  return parsePriorityBankingPdf(buffer, {
    profile: 'citi_banking_all_pdf',
    canonicalProfile: 'citi_banking_all_pdf'
  });
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
    accountSubtype: 'checking',
    targetLast4: '8384',
    layoutTargets: {
      legacy: { targetLast4: '8384' },
      simplified: { targetLast4: '8384' },
      default: { targetLast4: '8384' }
    }
  },
  citi_checking_legacy_pdf: {
    profile: 'citi_checking_legacy_pdf',
    canonicalProfile: 'citi_checking_pdf',
    institutionName: 'Citi Checking',
    accountClass: 'checking',
    accountSubtype: 'checking',
    targetLast4: '8384',
    expectedLayout: 'legacy',
    layoutTargets: {
      legacy: { targetLast4: '8384' },
      default: { targetLast4: '8384' }
    }
  },
  citi_checking_simplified_pdf: {
    profile: 'citi_checking_simplified_pdf',
    canonicalProfile: 'citi_checking_pdf',
    institutionName: 'Citi Checking',
    accountClass: 'checking',
    accountSubtype: 'checking',
    targetLast4: '8384',
    expectedLayout: 'simplified',
    layoutTargets: {
      simplified: { targetLast4: '8384' },
      default: { targetLast4: '8384' }
    }
  },
  citi_ultimate_plus_pdf: {
    profile: 'citi_ultimate_plus_pdf',
    institutionName: 'Citi Ultimate Plus',
    accountClass: 'savings',
    accountSubtype: 'savings',
    targetLast4: '2950',
    targetProductPattern: /Ultimate Savings/i,
    layoutTargets: {
      legacy: { targetLast4: '8293', targetProductPattern: /Ultimate Savings/i },
      simplified: { targetLast4: '2950' },
      default: { targetLast4: '2950', targetProductPattern: /Ultimate Savings/i }
    }
  },
  citi_ultimate_plus_legacy_pdf: {
    profile: 'citi_ultimate_plus_legacy_pdf',
    canonicalProfile: 'citi_ultimate_plus_pdf',
    institutionName: 'Citi Ultimate Plus',
    accountClass: 'savings',
    accountSubtype: 'savings',
    targetLast4: '2950',
    targetProductPattern: /Ultimate Savings/i,
    expectedLayout: 'legacy',
    layoutTargets: {
      legacy: { targetLast4: '8293', targetProductPattern: /Ultimate Savings/i },
      default: { targetLast4: '8293', targetProductPattern: /Ultimate Savings/i }
    }
  },
  citi_ultimate_plus_simplified_pdf: {
    profile: 'citi_ultimate_plus_simplified_pdf',
    canonicalProfile: 'citi_ultimate_plus_pdf',
    institutionName: 'Citi Ultimate Plus',
    accountClass: 'savings',
    accountSubtype: 'savings',
    targetLast4: '2950',
    expectedLayout: 'simplified',
    layoutTargets: {
      simplified: { targetLast4: '2950' },
      default: { targetLast4: '2950' }
    }
  },
  citi_savings_pdf: {
    profile: 'citi_savings_pdf',
    institutionName: 'Day to Day Savings',
    accountClass: 'savings',
    accountSubtype: 'savings',
    targetLast4: '8293',
    layoutTargets: {
      legacy: { targetLast4: '2950' },
      simplified: { targetLast4: '8293' },
      default: { targetLast4: '8293' }
    }
  },
  citi_savings_legacy_pdf: {
    profile: 'citi_savings_legacy_pdf',
    canonicalProfile: 'citi_savings_pdf',
    institutionName: 'Day to Day Savings',
    accountClass: 'savings',
    accountSubtype: 'savings',
    targetLast4: '8293',
    expectedLayout: 'legacy',
    layoutTargets: {
      legacy: { targetLast4: '2950' },
      default: { targetLast4: '2950' }
    }
  },
  citi_savings_simplified_pdf: {
    profile: 'citi_savings_simplified_pdf',
    canonicalProfile: 'citi_savings_pdf',
    institutionName: 'Day to Day Savings',
    accountClass: 'savings',
    accountSubtype: 'savings',
    targetLast4: '8293',
    expectedLayout: 'simplified',
    layoutTargets: {
      simplified: { targetLast4: '8293' },
      default: { targetLast4: '8293' }
    }
  },
  citi_cd_pdf: {
    profile: 'citi_cd_pdf',
    institutionName: 'Citi Certificates of Deposit',
    accountClass: 'cd',
    accountSubtype: 'certificate_of_deposit',
    targetAccountClass: 'cd',
    targetProductPattern: /Certificate(?:s)? of Deposit|CD Account/i,
    layoutTargets: {
      legacy: { targetAccountClass: 'cd', targetProductPattern: /Certificate(?:s)? of Deposit|CD Account/i },
      simplified: { targetAccountClass: 'cd', targetProductPattern: /Certificate(?:s)? of Deposit|CD Account/i },
      default: { targetAccountClass: 'cd', targetProductPattern: /Certificate(?:s)? of Deposit|CD Account/i }
    }
  },
  citi_cd_legacy_pdf: {
    profile: 'citi_cd_legacy_pdf',
    canonicalProfile: 'citi_cd_pdf',
    institutionName: 'Citi Certificates of Deposit',
    accountClass: 'cd',
    accountSubtype: 'certificate_of_deposit',
    expectedLayout: 'legacy',
    targetAccountClass: 'cd',
    targetProductPattern: /Certificate(?:s)? of Deposit|CD Account/i,
    layoutTargets: {
      legacy: { targetAccountClass: 'cd', targetProductPattern: /Certificate(?:s)? of Deposit|CD Account/i },
      default: { targetAccountClass: 'cd', targetProductPattern: /Certificate(?:s)? of Deposit|CD Account/i }
    }
  },
  citi_cd_simplified_pdf: {
    profile: 'citi_cd_simplified_pdf',
    canonicalProfile: 'citi_cd_pdf',
    institutionName: 'Citi Certificates of Deposit',
    accountClass: 'cd',
    accountSubtype: 'certificate_of_deposit',
    expectedLayout: 'simplified',
    targetAccountClass: 'cd',
    targetProductPattern: /Certificate(?:s)? of Deposit|CD Account/i,
    layoutTargets: {
      simplified: { targetAccountClass: 'cd', targetProductPattern: /Certificate(?:s)? of Deposit|CD Account/i },
      default: { targetAccountClass: 'cd', targetProductPattern: /Certificate(?:s)? of Deposit|CD Account/i }
    }
  }
};

async function parseBankStatement({ buffer, profile }) {
  if (!PROFILE_CONFIG[profile]) {
    throw new Error('Unsupported statement profile: ' + profile);
  }
  const parsed = profile === 'advantage_citi_pdf'
    ? await parseAdvantagePdf(buffer)
    : await parsePriorityBankingPdf(buffer, {
      profile,
      canonicalProfile: PROFILE_CONFIG[profile].canonicalProfile || PROFILE_CONFIG[profile].profile,
      expectedLayout: PROFILE_CONFIG[profile].expectedLayout,
      targetLast4: PROFILE_CONFIG[profile].targetLast4,
      targetAccountClass: PROFILE_CONFIG[profile].targetAccountClass,
      targetProductPattern: PROFILE_CONFIG[profile].targetProductPattern,
      layoutTargets: PROFILE_CONFIG[profile].layoutTargets
    });
  const config = PROFILE_CONFIG[profile];
  parsed.profile = config.profile;
  parsed.metadata = Object.assign({}, parsed.metadata, {
    profile: config.profile,
    canonicalProfile: config.canonicalProfile || config.profile,
    institutionName: config.institutionName,
    accountClass: config.accountClass,
    accountSubtype: config.accountSubtype
  });
  return parsed;
}

module.exports = {
  parseBankStatement,
  parseAdvantagePdf,
  parseCitiBankingStatement,
  PROFILE_CONFIG
};
