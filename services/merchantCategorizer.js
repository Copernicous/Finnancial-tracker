'use strict';

const DEFAULT_MERCHANT_RULES = [
  { pattern: 'online payment', categoryName: 'Credit Card Payment', transactionType: 'transfer', source: 'default' },
  { pattern: 'payment thank you', categoryName: 'Credit Card Payment', transactionType: 'transfer', source: 'default' },
  { pattern: 'autopay', categoryName: 'Credit Card Payment', transactionType: 'transfer', source: 'default' },
  { pattern: 'google fi', categoryName: 'Utilities', transactionType: 'expense', source: 'default', notes: 'Wireless phone service.' },
  { pattern: 'xfinity', categoryName: 'Utilities', transactionType: 'expense', source: 'default' },
  { pattern: 'comcast', categoryName: 'Utilities', transactionType: 'expense', source: 'default' },
  { pattern: 'verizon', categoryName: 'Utilities', transactionType: 'expense', source: 'default' },
  { pattern: 'tmobile', categoryName: 'Utilities', transactionType: 'expense', source: 'default' },
  { pattern: 't-mobile', categoryName: 'Utilities', transactionType: 'expense', source: 'default' },
  { pattern: 'at&t', categoryName: 'Utilities', transactionType: 'expense', source: 'default' },
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
  { pattern: 'bestwester', categoryName: 'Travel & Lodging', transactionType: 'expense', source: 'default', notes: 'Best Western hotel/lodging.' },
  { pattern: 'best western', categoryName: 'Travel & Lodging', transactionType: 'expense', source: 'default' },
  { pattern: 'hotel', categoryName: 'Travel & Lodging', transactionType: 'expense', source: 'default' },
  { pattern: 'airbnb', categoryName: 'Travel & Lodging', transactionType: 'expense', source: 'default' },
  { pattern: 'marriott', categoryName: 'Travel & Lodging', transactionType: 'expense', source: 'default' },
  { pattern: 'hilton', categoryName: 'Travel & Lodging', transactionType: 'expense', source: 'default' },
  { pattern: 'american airlines', categoryName: 'Travel & Lodging', transactionType: 'expense', source: 'default' },
  { pattern: 'delta air', categoryName: 'Travel & Lodging', transactionType: 'expense', source: 'default' },
  { pattern: 'united airlines', categoryName: 'Travel & Lodging', transactionType: 'expense', source: 'default' },
  { pattern: 'cvs', categoryName: 'Health & Pharmacy', transactionType: 'expense', source: 'default' },
  { pattern: 'walgreens', categoryName: 'Health & Pharmacy', transactionType: 'expense', source: 'default' },
  { pattern: 'pharmacy', categoryName: 'Health & Pharmacy', transactionType: 'expense', source: 'default' },
  { pattern: 'doctor', categoryName: 'Health & Pharmacy', transactionType: 'expense', source: 'default' },
  { pattern: 'dentist', categoryName: 'Health & Pharmacy', transactionType: 'expense', source: 'default' },
  { pattern: 'netflix', categoryName: 'Subscriptions & Software', transactionType: 'expense', source: 'default' },
  { pattern: 'spotify', categoryName: 'Subscriptions & Software', transactionType: 'expense', source: 'default' },
  { pattern: 'apple.com/bill', categoryName: 'Subscriptions & Software', transactionType: 'expense', source: 'default' },
  { pattern: 'microsoft', categoryName: 'Subscriptions & Software', transactionType: 'expense', source: 'default' },
  { pattern: 'adobe', categoryName: 'Subscriptions & Software', transactionType: 'expense', source: 'default' },
  { pattern: 'github', categoryName: 'Subscriptions & Software', transactionType: 'expense', source: 'default' },
  { pattern: 'restaurant', categoryName: 'Dining & Entertainment', transactionType: 'expense', source: 'default' },
  { pattern: 'starbucks', categoryName: 'Dining & Entertainment', transactionType: 'expense', source: 'default' },
  { pattern: 'doordash', categoryName: 'Dining & Entertainment', transactionType: 'expense', source: 'default' },
  { pattern: 'uber eats', categoryName: 'Dining & Entertainment', transactionType: 'expense', source: 'default' },
  { pattern: 'fee', categoryName: 'Bank Fees', transactionType: 'expense', source: 'default' },
  { pattern: 'interest charge', categoryName: 'Bank Fees', transactionType: 'expense', source: 'default' },
  { pattern: 'insurance', categoryName: 'Insurance', transactionType: 'expense', source: 'default' },
  { pattern: 'legal', categoryName: 'Professional Services', transactionType: 'expense', source: 'default' },
  { pattern: 'accounting', categoryName: 'Professional Services', transactionType: 'expense', source: 'default' }
];

function normalize(value) {
  return String(value || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function categoryByName(categories, name) {
  return categories.find((category) => normalize(category.name) === normalize(name));
}

function sourceConfidence(source) {
  if (source === 'user') return 0.95;
  if (source === 'category_keygroup') return 0.9;
  if (source === 'online_lookup') return 0.65;
  return 0.82;
}

function ruleScore(rule, requestedType) {
  const sourceScore = rule.source === 'user' ? 40 : (rule.source === 'category_keygroup' ? 30 : 10);
  const typeScore = requestedType && normalize(rule.transactionType) === requestedType ? 30 : 0;
  const mismatchPenalty = requestedType && normalize(rule.transactionType) && normalize(rule.transactionType) !== requestedType ? -25 : 0;
  const patternScore = Math.min(normalize(rule.pattern).length, 50);
  return sourceScore + typeScore + mismatchPenalty + patternScore;
}

function suggestFromRules({ text, categories, customRules = [], transactionType }) {
  const haystack = normalize(text);
  const requestedType = normalize(transactionType);
  const rules = [...customRules, ...DEFAULT_MERCHANT_RULES];
  const matches = [];
  for (const rule of rules) {
    if (!rule.pattern || !haystack.includes(normalize(rule.pattern))) continue;
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
  return null;
}

function inferFromLookupText(text, categories) {
  const haystack = normalize(text);
  const hints = [
    ['hotel motel lodging travel airline flight airport', 'Travel & Lodging'],
    ['wireless mobile phone internet telecom communications', 'Utilities'],
    ['gas fuel gasoline convenience station', 'Transportation'],
    ['grocery supermarket food market', 'Groceries'],
    ['pharmacy drugstore health medical dental doctor', 'Health & Pharmacy'],
    ['software subscription streaming cloud app', 'Subscriptions & Software'],
    ['restaurant cafe coffee dining food', 'Dining & Entertainment'],
    ['hardware home improvement household supplies', 'Household Supplies'],
    ['insurance', 'Insurance']
  ];
  for (const [words, categoryName] of hints) {
    if (!words.split(' ').some((word) => haystack.includes(word))) continue;
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
  suggestFromRules,
  inferFromLookupText
};
