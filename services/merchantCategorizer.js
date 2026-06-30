'use strict';

const DEFAULT_MERCHANT_RULES = [
  { pattern: 'online payment', categoryName: 'Credit Card Payment', transactionType: 'transfer', source: 'default' },
  { pattern: 'payment thank you', categoryName: 'Credit Card Payment', transactionType: 'transfer', source: 'default' },
  { pattern: 'autopay', categoryName: 'Credit Card Payment', transactionType: 'transfer', source: 'default' },
  { pattern: 'west20rent', categoryName: 'Rent', transactionType: 'expense', source: 'default', notes: 'Debit-card rent payment merchant.' },
  { pattern: 'primos barber', categoryName: 'Hair and Salon', transactionType: 'expense', source: 'default', notes: 'Barber/personal care merchant.' },
  { pattern: 'barber shop', categoryName: 'Hair and Salon', transactionType: 'expense', source: 'default' },
  { pattern: 'fpl direct', categoryName: 'Electricity', transactionType: 'expense', source: 'default', notes: 'Electric utility service.' },
  { pattern: 'fpl', categoryName: 'Electricity', transactionType: 'expense', source: 'default' },
  { pattern: 'florida power', categoryName: 'Electricity', transactionType: 'expense', source: 'default' },
  { pattern: 'duke energy', categoryName: 'Electricity', transactionType: 'expense', source: 'default' },
  { pattern: 'water department', categoryName: 'Water and Sewer', transactionType: 'expense', source: 'default' },
  { pattern: 'water bill', categoryName: 'Water and Sewer', transactionType: 'expense', source: 'default' },
  { pattern: 'municipal water', categoryName: 'Water and Sewer', transactionType: 'expense', source: 'default' },
  { pattern: 'sewer', categoryName: 'Water and Sewer', transactionType: 'expense', source: 'default' },
  { pattern: 'waste management', categoryName: 'Trash and Recycling', transactionType: 'expense', source: 'default' },
  { pattern: 'republic services', categoryName: 'Trash and Recycling', transactionType: 'expense', source: 'default' },
  { pattern: 'google fi', categoryName: 'Mobile Phone', transactionType: 'expense', source: 'default', notes: 'Wireless phone service.' },
  { pattern: 'verizon', categoryName: 'Mobile Phone', transactionType: 'expense', source: 'default' },
  { pattern: 'tmobile', categoryName: 'Mobile Phone', transactionType: 'expense', source: 'default' },
  { pattern: 't-mobile', categoryName: 'Mobile Phone', transactionType: 'expense', source: 'default' },
  { pattern: 'metro by t-mobile', categoryName: 'Mobile Phone', transactionType: 'expense', source: 'default' },
  { pattern: 'at&t', categoryName: 'Mobile Phone', transactionType: 'expense', source: 'default' },
  { pattern: 'xfinity', categoryName: 'Internet', transactionType: 'expense', source: 'default' },
  { pattern: 'comcast-xfinity', categoryName: 'Internet', transactionType: 'expense', source: 'default' },
  { pattern: 'comcast', categoryName: 'Internet', transactionType: 'expense', source: 'default' },
  { pattern: 'spectrum', categoryName: 'Internet', transactionType: 'expense', source: 'default' },
  { pattern: 'chevron', categoryName: 'Transportation', transactionType: 'expense', source: 'default', notes: 'Fuel/service station.' },
  { pattern: 'shell', categoryName: 'Transportation', transactionType: 'expense', source: 'default' },
  { pattern: 'exxon', categoryName: 'Transportation', transactionType: 'expense', source: 'default' },
  { pattern: 'mobil', categoryName: 'Transportation', transactionType: 'expense', source: 'default' },
  { pattern: 'wawa', categoryName: 'Transportation', transactionType: 'expense', source: 'default', notes: 'Convenience store and fuel.' },
  { pattern: 'sunoco', categoryName: 'Transportation', transactionType: 'expense', source: 'default' },
  { pattern: 'uber', categoryName: 'Transportation', transactionType: 'expense', source: 'default' },
  { pattern: 'lyft', categoryName: 'Transportation', transactionType: 'expense', source: 'default' },
  { pattern: 'toll', categoryName: 'Transportation', transactionType: 'expense', source: 'default' },
  { pattern: 'publix', categoryName: 'Groceries', transactionType: 'expense', source: 'default' },
  { pattern: 'bjs.com', categoryName: 'Warehouse Groceries', transactionType: 'expense', source: 'default' },
  { pattern: 'bjs com', categoryName: 'Warehouse Groceries', transactionType: 'expense', source: 'default' },
  { pattern: 'bj wholesale', categoryName: 'Warehouse Groceries', transactionType: 'expense', source: 'default' },
  { pattern: 'bjs wholesale', categoryName: 'Warehouse Groceries', transactionType: 'expense', source: 'default' },
  { pattern: 'food & beverages', categoryName: 'Groceries', transactionType: 'expense', source: 'default', notes: 'Debit-card merchant-category hint from bank statement.' },
  { pattern: 'whole foods', categoryName: 'Groceries', transactionType: 'expense', source: 'default' },
  { pattern: 'trader joe', categoryName: 'Groceries', transactionType: 'expense', source: 'default' },
  { pattern: 'aldi', categoryName: 'Groceries', transactionType: 'expense', source: 'default' },
  { pattern: 'costco', categoryName: 'Groceries', transactionType: 'expense', source: 'default' },
  { pattern: 'walmart', categoryName: 'Shopping', transactionType: 'expense', source: 'default' },
  { pattern: 'target', categoryName: 'Shopping', transactionType: 'expense', source: 'default' },
  { pattern: 'amazon', categoryName: 'Shopping', transactionType: 'expense', source: 'default' },
  { pattern: 'best buy', categoryName: 'Shopping', transactionType: 'expense', source: 'default' },
  { pattern: 'home depot', categoryName: 'Household Supplies', transactionType: 'expense', source: 'default' },
  { pattern: 'lowes', categoryName: 'Household Supplies', transactionType: 'expense', source: 'default' },
  { pattern: 'irobot', categoryName: 'Household Supplies', transactionType: 'expense', source: 'default' },
  { pattern: 'bestwester', categoryName: 'Travel & Lodging', transactionType: 'expense', source: 'default', notes: 'Best Western hotel/lodging.' },
  { pattern: 'best western', categoryName: 'Travel & Lodging', transactionType: 'expense', source: 'default' },
  { pattern: 'hotel', categoryName: 'Travel & Lodging', transactionType: 'expense', source: 'default' },
  { pattern: 'airbnb', categoryName: 'Travel & Lodging', transactionType: 'expense', source: 'default' },
  { pattern: 'marriott', categoryName: 'Travel & Lodging', transactionType: 'expense', source: 'default' },
  { pattern: 'hilton', categoryName: 'Travel & Lodging', transactionType: 'expense', source: 'default' },
  { pattern: 'american airlines', categoryName: 'Travel & Lodging', transactionType: 'expense', source: 'default' },
  { pattern: 'delta air', categoryName: 'Travel & Lodging', transactionType: 'expense', source: 'default' },
  { pattern: 'united airlines', categoryName: 'Travel & Lodging', transactionType: 'expense', source: 'default' },
  { pattern: 'cvs', categoryName: 'Pharmacy', transactionType: 'expense', source: 'default' },
  { pattern: 'walgreens', categoryName: 'Pharmacy', transactionType: 'expense', source: 'default' },
  { pattern: 'walgreen', categoryName: 'Pharmacy', transactionType: 'expense', source: 'default' },
  { pattern: 'pharmacy', categoryName: 'Pharmacy', transactionType: 'expense', source: 'default' },
  { pattern: 'labcorp', categoryName: 'Labs and Testing', transactionType: 'expense', source: 'default' },
  { pattern: 'quest diagnostics', categoryName: 'Labs and Testing', transactionType: 'expense', source: 'default' },
  { pattern: 'dentist', categoryName: 'Dental', transactionType: 'expense', source: 'default' },
  { pattern: 'dental', categoryName: 'Dental', transactionType: 'expense', source: 'default' },
  { pattern: 'lenscrafters', categoryName: 'Vision', transactionType: 'expense', source: 'default' },
  { pattern: 'vision', categoryName: 'Vision', transactionType: 'expense', source: 'default' },
  { pattern: 'doctor', categoryName: 'Doctor and Medical', transactionType: 'expense', source: 'default' },
  { pattern: 'medical', categoryName: 'Doctor and Medical', transactionType: 'expense', source: 'default' },
  { pattern: 'hospital', categoryName: 'Doctor and Medical', transactionType: 'expense', source: 'default' },
  { pattern: 'clinic', categoryName: 'Doctor and Medical', transactionType: 'expense', source: 'default' },
  { pattern: 'urgent care', categoryName: 'Doctor and Medical', transactionType: 'expense', source: 'default' },
  { pattern: 'mdnow', categoryName: 'Doctor and Medical', transactionType: 'expense', source: 'default' },
  { pattern: 'sanitas', categoryName: 'Doctor and Medical', transactionType: 'expense', source: 'default' },
  { pattern: 'dermatol', categoryName: 'Doctor and Medical', transactionType: 'expense', source: 'default' },
  { pattern: 'healthc', categoryName: 'Doctor and Medical', transactionType: 'expense', source: 'default' },
  { pattern: 'oscarinsuranceco', categoryName: 'Health Insurance', transactionType: 'expense', source: 'default' },
  { pattern: 'florida kid care', categoryName: 'Health Insurance', transactionType: 'expense', source: 'default' },
  { pattern: 'netflix', categoryName: 'Subscriptions & Software', transactionType: 'expense', source: 'default' },
  { pattern: 'spotify', categoryName: 'Subscriptions & Software', transactionType: 'expense', source: 'default' },
  { pattern: 'apple.com/bill', categoryName: 'Subscriptions & Software', transactionType: 'expense', source: 'default' },
  { pattern: 'godaddy', categoryName: 'Subscriptions & Software', transactionType: 'expense', source: 'default' },
  { pattern: 'microsoft', categoryName: 'Subscriptions & Software', transactionType: 'expense', source: 'default' },
  { pattern: 'adobe', categoryName: 'Subscriptions & Software', transactionType: 'expense', source: 'default' },
  { pattern: 'github', categoryName: 'Subscriptions & Software', transactionType: 'expense', source: 'default' },
  { pattern: 'restaurant', categoryName: 'Dining & Entertainment', transactionType: 'expense', source: 'default' },
  { pattern: 'restaurant/bar', categoryName: 'Restaurants', transactionType: 'expense', source: 'default', notes: 'Debit-card merchant-category hint from bank statement.' },
  { pattern: 'wdw boardwalk', categoryName: 'Theme Parks and Attractions', transactionType: 'expense', source: 'default' },
  { pattern: 'wdw strollers', categoryName: 'Theme Parks and Attractions', transactionType: 'expense', source: 'default' },
  { pattern: 'walt disney', categoryName: 'Theme Parks and Attractions', transactionType: 'expense', source: 'default' },
  { pattern: 'disney world', categoryName: 'Theme Parks and Attractions', transactionType: 'expense', source: 'default' },
  { pattern: 'disneyworld', categoryName: 'Theme Parks and Attractions', transactionType: 'expense', source: 'default' },
  { pattern: 'starbucks', categoryName: 'Dining & Entertainment', transactionType: 'expense', source: 'default' },
  { pattern: 'doordash', categoryName: 'Dining & Entertainment', transactionType: 'expense', source: 'default' },
  { pattern: 'uber eats', categoryName: 'Dining & Entertainment', transactionType: 'expense', source: 'default' },
  { pattern: 'fee', categoryName: 'Bank Fees', transactionType: 'expense', source: 'default' },
  { pattern: 'interest charge', categoryName: 'Bank Fees', transactionType: 'expense', source: 'default' },
  { pattern: 'insurance', categoryName: 'Insurance', transactionType: 'expense', source: 'default' },
  { pattern: 'bathbodywor', categoryName: 'Beauty and Personal Care', transactionType: 'expense', source: 'default' },
  { pattern: 'fila online', categoryName: 'Clothing', transactionType: 'expense', source: 'default' },
  { pattern: 'legal', categoryName: 'Professional Services', transactionType: 'expense', source: 'default' },
  { pattern: 'accounting', categoryName: 'Professional Services', transactionType: 'expense', source: 'default' }
];

function normalize(value) {
  return String(value || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function categoryByName(categories, name) {
  return categories.find((category) => normalize(category.name) === normalize(name));
}

function firstCategory(categories, names) {
  for (const name of names) {
    const category = categoryByName(categories, name);
    if (category) return category;
  }
  return null;
}

function sourceConfidence(source) {
  if (source === 'operation_ai') return 0.97;
  if (source === 'user') return 0.95;
  if (source === 'category_keygroup') return 0.9;
  if (source === 'online_lookup') return 0.65;
  return 0.82;
}

function ruleScore(rule, requestedType) {
  const sourceScore = rule.source === 'category_keygroup' ? 70 : (rule.source === 'user' ? 50 : 10);
  const typeScore = requestedType && normalize(rule.transactionType) === requestedType ? 30 : 0;
  const mismatchPenalty = requestedType && normalize(rule.transactionType) && normalize(rule.transactionType) !== requestedType ? -25 : 0;
  const patternScore = Math.min(normalize(rule.pattern).length, 50);
  return sourceScore + typeScore + mismatchPenalty + patternScore;
}

function includesTerm(haystack, term) {
  const value = normalize(term);
  if (!value) return false;
  if (value.includes(' ')) return haystack.includes(value);
  const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp('(^|[^a-z0-9])' + escaped + '([^a-z0-9]|$)').test(haystack);
}

function isPaymentAppTransferText(haystack) {
  if (/\bpurchase\b/.test(haystack)) return false;
  return /\b(inst\s+xfer|xfer|transfer|cash\s*out|cashout)\b/.test(haystack);
}

function shouldSkipRule(rule, haystack) {
  const pattern = normalize(rule.pattern);
  const categoryName = normalize(rule.categoryName);
  const transferCategory = ['transfers', 'transfers in', 'payments received', 'payments sent'].includes(categoryName);
  if (transferCategory && pattern.includes('paypal') && !isPaymentAppTransferText(haystack)) return true;
  return false;
}

function buildSuggestion(category, transactionType, operationKind, confidence, notes) {
  if (!category) return null;
  return {
    categoryId: category.id,
    categoryName: category.name,
    transactionType: transactionType || category.categoryType || 'expense',
    confidence,
    source: 'operation_ai',
    matchedPattern: operationKind,
    operationKind,
    notes: notes || 'Suggested from banking operation pattern.'
  };
}

function suggestOperation({ text, categories, amount, transactionType }) {
  const haystack = normalize(text);
  const numericAmount = Number(amount || 0);
  const requestedType = normalize(transactionType);
  const positive = numericAmount > 0 || requestedType === 'income';
  const negative = numericAmount < 0 || requestedType === 'expense';

  if (!haystack) return null;

  if (/\b(payroll|direct deposit|salary)\b/.test(haystack) && positive) {
    return buildSuggestion(
      firstCategory(categories, ['Paycheck', 'Salary', 'Income']),
      'income',
      'payroll_credit',
      0.99,
      'Payroll/direct-deposit credit is treated as earned income.'
    );
  }

  if (/\birs treas\b|\btax ref\b|\btax refund\b/.test(haystack) && positive) {
    return buildSuggestion(
      firstCategory(categories, ['Tax Refund', 'Other Income', 'Income']),
      'income',
      'tax_refund_credit',
      0.95,
      'Treasury/tax refund credit.'
    );
  }

  if (/\binterest paid\b|\binterest credit\b|\binterest earned\b/.test(haystack) && positive) {
    return buildSuggestion(
      firstCategory(categories, ['Interest Income', 'Interest and Dividends', 'Other Income']),
      'income',
      'interest_credit',
      0.94,
      'Bank interest credit.'
    );
  }

  if (/\b(incoming wire transfer fee|wire transfer fee|incoming wire fee|monthly service fee|overdraft fee|returned item fee|atm fee)\b/.test(haystack)) {
    return buildSuggestion(
      firstCategory(categories, ['Bank Fees']),
      'expense',
      'bank_fee',
      0.96,
      'Bank/service fee operation.'
    );
  }

  if (/\b(online payment, thank you|payment thank you|citi card online payment|card online payment|credit card payment|autopay)\b/.test(haystack)) {
    return buildSuggestion(
      firstCategory(categories, ['Credit Card Payment', 'Transfers']),
      'transfer',
      'credit_card_payment',
      0.99,
      'Credit-card payment should not count as spending or income.'
    );
  }

  if (includesTerm(haystack, 'zelle')) {
    return buildSuggestion(
      positive
        ? firstCategory(categories, ['Payments Received', 'Transfers In', 'Transfers'])
        : firstCategory(categories, ['Payments Sent', 'Transfers']),
      'transfer',
      positive ? 'zelle_received' : 'zelle_sent',
      0.97,
      'Zelle is treated as a payment transfer; review later if it should become gift, split reimbursement, or another category.'
    );
  }

  if ((includesTerm(haystack, 'paypal') || includesTerm(haystack, 'venmo') || includesTerm(haystack, 'cash app')) && isPaymentAppTransferText(haystack)) {
    return buildSuggestion(
      positive
        ? firstCategory(categories, ['Payments Received', 'Transfers In', 'Transfers'])
        : firstCategory(categories, ['Payments Sent', 'Transfers']),
      'transfer',
      positive ? 'payment_app_received' : 'payment_app_sent',
      0.92,
      'Payment app transfer; review later if it should become a purchase, gift, split reimbursement, or income.'
    );
  }

  if (/\b(incoming wire transfer|wire from)\b/.test(haystack) && positive) {
    return buildSuggestion(
      firstCategory(categories, ['Payments Received', 'Transfers In', 'Transfers']),
      'transfer',
      'wire_received',
      0.94,
      'Incoming wire transfer; review if it represents taxable/earned income.'
    );
  }

  if (/\b(outgoing wire transfer|wire to)\b/.test(haystack) && negative) {
    return buildSuggestion(
      firstCategory(categories, ['Payments Sent', 'Transfers']),
      'transfer',
      'wire_sent',
      0.94,
      'Outgoing wire transfer.'
    );
  }

  if (/\btransfer\s+(to|from)\b|\b(to|from)\s+(checking|savings|money market|cd account|certificate(?:s)? of deposit)\b|\bmoney market\b/.test(haystack)) {
    return buildSuggestion(
      firstCategory(categories, ['Savings Transfer', 'Transfers In', 'Transfers']),
      'transfer',
      positive ? 'account_transfer_in' : 'account_transfer_out',
      0.96,
      'Account-to-account transfer.'
    );
  }

  if (/\b(teller deposit|deposit .* teller|cash deposit|mobile deposit)\b/.test(haystack) && positive) {
    return buildSuggestion(
      firstCategory(categories, ['Cash Deposit', 'Transfers In', 'Transfers']),
      'transfer',
      'cash_deposit',
      0.93,
      'Teller/mobile deposit; review if this is actually income.'
    );
  }

  if (/\b(cash withdrawal|atm withdrawal|withdrawal .* teller|teller withdrawal)\b/.test(haystack) && negative) {
    return buildSuggestion(
      firstCategory(categories, ['ATM Withdrawal', 'Transfers']),
      'transfer',
      'cash_withdrawal',
      0.95,
      'Cash withdrawal is a cash movement, not spending by itself.'
    );
  }

  return null;
}

function suggestFromRules({ text, categories, customRules = [], transactionType, amount }) {
  const operationSuggestion = suggestOperation({ text, categories, transactionType, amount });
  if (operationSuggestion) return operationSuggestion;

  const haystack = normalize(text);
  const requestedType = normalize(transactionType);
  const numericAmount = Number(amount || 0);
  const rules = [...customRules, ...DEFAULT_MERCHANT_RULES];
  const matches = [];
  for (const rule of rules) {
    if (!rule.pattern || !includesTerm(haystack, rule.pattern)) continue;
    if (shouldSkipRule(rule, haystack)) continue;
    const category = categoryByName(categories, rule.categoryName);
    if (!category) continue;
    matches.push({ rule, category, score: ruleScore(rule, requestedType) });
  }
  matches.sort((a, b) => b.score - a.score);
  const best = matches[0];
  if (best) {
    const { rule, category } = best;
    return {
      categoryId: category.id,
      categoryName: category.name,
      transactionType: rule.transactionType || category.categoryType || 'expense',
      confidence: sourceConfidence(rule.source),
      source: rule.source || 'default',
      matchedPattern: rule.pattern,
      notes: rule.notes || ''
    };
  }
  if (/\bdebit card purchase\b/.test(haystack)) {
    const category = firstCategory(categories, ['General Shopping', 'Shopping']);
    if (category) {
      return {
        categoryId: category.id,
        categoryName: category.name,
        transactionType: 'expense',
        confidence: 0.7,
        source: 'default',
        matchedPattern: 'debit card purchase',
        notes: 'Debit-card purchase with no stronger merchant match; review merchant if needed.'
      };
    }
  }
  if (/\bpaypal\s+\*/.test(haystack) && !isPaymentAppTransferText(haystack) && numericAmount < 0) {
    const category = firstCategory(categories, ['General Shopping', 'Shopping']);
    if (category) {
      return {
        categoryId: category.id,
        categoryName: category.name,
        transactionType: 'expense',
        confidence: 0.72,
        source: 'default',
        matchedPattern: 'paypal card purchase',
        notes: 'PayPal card merchant purchase with no stronger merchant match.'
      };
    }
  }
  return null;
}

function inferFromLookupText(text, categories) {
  const haystack = normalize(text);
  const hints = [
    ['pharmacy|drugstore', 'Pharmacy'],
    ['health|medical|doctor|hospital|clinic', 'Doctor and Medical'],
    ['dental|dentist', 'Dental'],
    ['gas|fuel|gasoline|oil|petroleum|energy', 'Gas and Fuel'],
    ['convenience store', 'Convenience Store'],
    ['hotel|motel|lodging', 'Hotels'],
    ['airline|flight|airport', 'Flights'],
    ['wireless|mobile phone|telecom|communications', 'Mobile Phone'],
    ['internet|broadband|fiber|cable', 'Internet'],
    ['grocery|supermarket|food market', 'Groceries'],
    ['software|subscription|streaming|cloud app', 'Subscriptions & Software'],
    ['restaurant|cafe|dining', 'Restaurants'],
    ['coffee|snack', 'Coffee and Snacks'],
    ['hardware|home improvement|household supplies', 'Home Improvement'],
    ['insurance', 'Insurance'],
    ['toll|parking|transit', 'Transportation'],
    ['utility|utilities', 'Utilities'],
    ['travel', 'Travel & Lodging'],
    ['health pharmacy', 'Health & Pharmacy'],
    ['entertainment', 'Dining & Entertainment'],
    ['household', 'Household Supplies']
  ];
  for (const [words, categoryName] of hints) {
    if (!words.split('|').some((word) => includesTerm(haystack, word))) continue;
    const category = categoryByName(categories, categoryName);
    if (category) {
      return {
        categoryId: category.id,
        categoryName: category.name,
        transactionType: category.categoryType || 'expense',
        confidence: 0.65,
        source: 'online_lookup',
        matchedPattern: categoryName,
        notes: 'Suggested from public lookup text.'
      };
    }
  }
  return null;
}

module.exports = {
  DEFAULT_MERCHANT_RULES,
  normalize,
  suggestOperation,
  suggestFromRules,
  inferFromLookupText
};
