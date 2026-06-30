'use strict';

function cents(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? Math.round(number * 100) : null;
}

function money(centsValue) {
  return Number((centsValue / 100).toFixed(2));
}

function isMoney(value) {
  return value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));
}

function amountFor(row) {
  return cents(row && row.amount);
}

function summarizeAdvantageTransactions(transactions) {
  const sums = {
    purchases: 0,
    paymentsAndCredits: 0,
    fees: 0,
    interest: 0,
    cashAdvances: 0
  };

  for (const row of transactions || []) {
    const amount = amountFor(row);
    if (amount == null) continue;
    if (row.transactionType === 'purchase') sums.purchases += amount;
    else if (row.transactionType === 'fee') sums.fees += amount;
    else if (row.transactionType === 'interest') sums.interest += amount;
    else if (row.transactionType === 'cash_advance') sums.cashAdvances += amount;
    else if (row.transactionType === 'payment' || row.transactionType === 'credit') sums.paymentsAndCredits += amount;
    else if (Number(row.amount) < 0) sums.paymentsAndCredits += amount;
    else sums.purchases += amount;
  }

  return sums;
}

function summarizeBankingTransactions(transactions) {
  const sums = {
    totalSubtracted: 0,
    totalAdded: 0,
    net: 0,
    finalBalance: null
  };

  for (const row of transactions || []) {
    const amount = amountFor(row);
    if (amount == null) continue;
    sums.net += amount;
    if (amount < 0) sums.totalSubtracted += Math.abs(amount);
    else sums.totalAdded += amount;
    if (isMoney(row.balance)) sums.finalBalance = cents(row.balance);
  }

  return sums;
}

function buildCheck(key, expectedCents, actualCents) {
  const differenceCents = actualCents - expectedCents;
  return {
    key,
    expected: money(expectedCents),
    actual: money(actualCents),
    difference: money(differenceCents),
    ok: differenceCents === 0
  };
}

function findBankingStatementSummary(parsed) {
  const metadata = (parsed && parsed.metadata) || {};
  const summaries = Array.isArray(metadata.bankingAccountSummaries) ? metadata.bankingAccountSummaries : [];
  const targetLast4 = String(metadata.statementAccountLast4 || metadata.accountLast4 || '').trim();
  const targetAccountNumber = String(metadata.accountNumber || '').trim();
  if (targetAccountNumber) {
    const exact = summaries.find((summary) => String(summary.accountNumber || '') === targetAccountNumber);
    if (exact) return exact;
  }
  if (targetLast4) {
    const exact = summaries.find((summary) => String(summary.accountLast4 || '').slice(-4) === targetLast4);
    if (exact) return exact;
  }
  const rowLast4 = new Set((parsed.transactions || []).map((row) => String(row.accountLast4 || '').slice(-4)).filter(Boolean));
  if (rowLast4.size === 1) {
    const onlyLast4 = Array.from(rowLast4)[0];
    const exact = summaries.find((summary) => String(summary.accountLast4 || '').slice(-4) === onlyLast4);
    if (exact) return exact;
  }
  return summaries.length === 1 ? summaries[0] : null;
}

function validateAdvantageStatementTotals(parsed) {
  const metadata = (parsed && parsed.metadata) || {};
  const required = [
    'previousBalance',
    'payments',
    'credits',
    'purchases',
    'cashAdvances',
    'fees',
    'interest',
    'newBalance'
  ];
  const missing = required.filter((field) => !isMoney(metadata[field]));
  if (missing.length) {
    return {
      profile: 'advantage_citi_pdf',
      ok: false,
      status: 'missing_summary',
      checks: [],
      issues: [`Statement summary is missing: ${missing.join(', ')}.`]
    };
  }

  const sums = summarizeAdvantageTransactions(parsed.transactions || []);
  const expectedPaymentsAndCredits = cents(metadata.payments) + cents(metadata.credits);
  const expectedNewBalance = cents(metadata.previousBalance)
    + cents(metadata.payments)
    + cents(metadata.credits)
    + cents(metadata.purchases)
    + cents(metadata.cashAdvances)
    + cents(metadata.fees)
    + cents(metadata.interest);

  const checks = [
    buildCheck('purchases', cents(metadata.purchases), sums.purchases),
    buildCheck('paymentsAndCredits', expectedPaymentsAndCredits, sums.paymentsAndCredits),
    buildCheck('fees', cents(metadata.fees), sums.fees),
    buildCheck('interest', cents(metadata.interest), sums.interest),
    buildCheck('cashAdvances', cents(metadata.cashAdvances), sums.cashAdvances),
    buildCheck('newBalanceFormula', cents(metadata.newBalance), expectedNewBalance)
  ];
  const failed = checks.filter((check) => !check.ok);

  return {
    profile: 'advantage_citi_pdf',
    ok: failed.length === 0,
    status: failed.length ? 'mismatch' : 'ok',
    checks,
    issues: failed.map((check) => (
      `${check.key} mismatch: expected ${check.expected}, actual ${check.actual}, difference ${check.difference}.`
    ))
  };
}

function validateBankingStatementTotals(parsed, profile) {
  const summary = findBankingStatementSummary(parsed);
  if (!summary) {
    return {
      profile,
      ok: false,
      status: 'missing_summary',
      checks: [],
      issues: ['Banking statement account summary was not detected for this account section.']
    };
  }

  const sums = summarizeBankingTransactions(parsed.transactions || []);
  const checks = [];
  if (isMoney(summary.totalSubtracted)) {
    checks.push(buildCheck('totalSubtracted', cents(summary.totalSubtracted), sums.totalSubtracted));
  }
  if (isMoney(summary.totalAdded)) {
    checks.push(buildCheck('totalAdded', cents(summary.totalAdded), sums.totalAdded));
  }
  if (isMoney(summary.openingBalance) && isMoney(summary.closingBalance)) {
    checks.push(buildCheck('closingBalanceFormula', cents(summary.closingBalance), cents(summary.openingBalance) + sums.totalAdded - sums.totalSubtracted));
  }
  if (isMoney(summary.closingBalance) && sums.finalBalance != null) {
    checks.push(buildCheck('finalRowBalance', cents(summary.closingBalance), sums.finalBalance));
  }

  if (!checks.length) {
    return {
      profile,
      ok: false,
      status: 'missing_summary_totals',
      checks: [],
      issues: ['Banking statement summary was detected, but it did not include balances or total subtracted/added values.']
    };
  }

  const failed = checks.filter((check) => !check.ok);
  return {
    profile,
    ok: failed.length === 0,
    status: failed.length ? 'mismatch' : 'ok',
    accountLast4: summary.accountLast4 || null,
    summary,
    checks,
    issues: failed.map((check) => (
      `${check.key} mismatch: expected ${check.expected}, actual ${check.actual}, difference ${check.difference}.`
    ))
  };
}

function findCertificateOfDepositSummary(parsed) {
  const metadata = (parsed && parsed.metadata) || {};
  const summary = metadata.certificateOfDepositSummaries || {};
  const accounts = Array.isArray(summary.accounts) ? summary.accounts : [];
  const targetLast4 = String(metadata.statementAccountLast4 || metadata.accountLast4 || '').trim();
  const targetAccountNumber = String(metadata.accountNumber || '').trim();

  if (targetAccountNumber) {
    const exact = accounts.find((account) => String(account.accountNumber || '') === targetAccountNumber);
    if (exact) return { account: exact, aggregate: summary.aggregate || null };
  }
  if (targetLast4) {
    const exact = accounts.find((account) => String(account.accountLast4 || '').slice(-4) === targetLast4);
    if (exact) return { account: exact, aggregate: summary.aggregate || null };
  }
  if (accounts.length === 1) return { account: accounts[0], aggregate: summary.aggregate || null };
  return { account: null, aggregate: summary.aggregate || null };
}

function validateCdStatementTotals(parsed, profile) {
  const cdSummary = findCertificateOfDepositSummary(parsed);
  const expectedInterest = cdSummary.account && isMoney(cdSummary.account.interestCreditedInPeriod)
    ? cents(cdSummary.account.interestCreditedInPeriod)
    : (cdSummary.aggregate && isMoney(cdSummary.aggregate.interestThisPeriod) ? cents(cdSummary.aggregate.interestThisPeriod) : null);

  if (expectedInterest == null) {
    return {
      profile,
      ok: true,
      status: 'summary_only',
      checks: [],
      issues: []
    };
  }

  const sums = summarizeBankingTransactions(parsed.transactions || []);
  const checks = [
    buildCheck('interestCreditedInPeriod', expectedInterest, sums.totalAdded)
  ];
  const failed = checks.filter((check) => !check.ok);

  return {
    profile,
    ok: failed.length === 0,
    status: failed.length ? 'mismatch' : 'ok',
    accountLast4: cdSummary.account ? cdSummary.account.accountLast4 : null,
    summary: cdSummary,
    checks,
    issues: failed.map((check) => (
      `${check.key} mismatch: expected ${check.expected}, actual ${check.actual}, difference ${check.difference}.`
    ))
  };
}

function validateStatementTotals(parsed, profile) {
  if (profile === 'advantage_citi_pdf') return validateAdvantageStatementTotals(parsed);
  if (/^citi_cd/.test(String(profile || ''))) {
    return validateCdStatementTotals(parsed, profile);
  }
  if (/^citi_(checking|ultimate_plus|savings|cd)/.test(String(profile || ''))) {
    return validateBankingStatementTotals(parsed, profile);
  }
  return {
    profile,
    ok: true,
    status: 'not_applicable',
    checks: [],
    issues: []
  };
}

module.exports = {
  validateAdvantageStatementTotals,
  validateBankingStatementTotals,
  validateCdStatementTotals,
  validateStatementTotals
};
