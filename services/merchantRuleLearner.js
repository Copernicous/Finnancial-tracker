'use strict';

const { Op } = require('sequelize');
const db = require('../models');
const merchantCategorizer = require('./merchantCategorizer');
const merchantResolver = require('./merchantResolver');

const SETTING_KEY = 'merchant_category_rules';

const GENERIC_PATTERNS = new Set([
  'ach',
  'ach electronic',
  'cash',
  'check',
  'credit',
  'debit',
  'debit card',
  'debit card purchase',
  'deposit',
  'electronic',
  'electronic credit',
  'electronic debit',
  'online',
  'online payment',
  'payment',
  'purchase',
  'teller',
  'transfer'
]);

const AUTO_TAGS = [
  'auto-categorized',
  'operation-ai-categorized',
  'paypal-card-purchase-cleanup'
];

function parseJson(value, fallback) {
  if (Array.isArray(value)) return value;
  if (!value) return fallback;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : fallback;
  } catch (err) {
    return fallback;
  }
}

function cleanText(value) {
  return String(value == null ? '' : value).trim();
}

function normalizeRulePattern(value) {
  return cleanText(value)
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/^\W+|\W+$/g, '')
    .trim();
}

function stripBankNoise(value) {
  let text = normalizeRulePattern(value)
    .replace(/\bach\s+electronic\s+(?:debit|credit)\b/g, ' ')
    .replace(/\belectronic\s+(?:debit|credit)\b/g, ' ')
    .replace(/\bdebit\s+card\s+purchase\b/g, ' ')
    .replace(/\bcard\s+purchase\b/g, ' ')
    .replace(/\b(?:transaction|reference|auth|authorization|trace)\s*#?\s*[a-z]?\d{4,}\b/g, ' ')
    .replace(/\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/g, ' ')
    .replace(/\b\d{1,2}:\d{2}\s*(?:a|p|am|pm)?\b/g, ' ')
    .replace(/#\s*[a-z]?\d{3,}\b/g, ' ')
    .replace(/\b[a-z]?\d{7,}\b/g, ' ')
    .replace(/\bonline\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  text = text.replace(/\b(?:ach|electronic|debit|credit|purchase|payment)\b\s*/g, ' ').replace(/\s+/g, ' ').trim();
  return normalizeRulePattern(text);
}

function isGenericPattern(pattern) {
  const value = normalizeRulePattern(pattern);
  if (!value || value.length < 4) return true;
  if (GENERIC_PATTERNS.has(value)) return true;
  if (!/[a-z]/.test(value)) return true;
  if (/^check\s*#?\s*\d*$/i.test(value)) return true;
  if (/^(?:transfer|deposit|withdrawal|payment|purchase)(?:\s+\d+)?$/i.test(value)) return true;
  if (/\b(?:zelle|payroll|direct deposit|interest paid|interest earned|opening balance|closing balance|payment thank you|online payment)\b/i.test(value)) return true;
  const words = value.split(/\s+/).filter(Boolean);
  if (words.length === 1 && (value.length < 5 || /^(?:fee|tax|card|bank)$/i.test(value))) return true;
  return false;
}

function merchantNameFromRow(row) {
  return cleanText(row.Merchant && row.Merchant.officialName)
    || cleanText(row.merchant)
    || cleanText(row.receiptMerchant)
    || cleanText(row.normalizedMerchant);
}

function candidatePatterns(row) {
  const candidates = [];
  const official = merchantNameFromRow(row);
  if (official) {
    candidates.push(stripBankNoise(official));
    candidates.push(normalizeRulePattern(official));
  }
  if (row.receiptMerchant) {
    candidates.push(stripBankNoise(row.receiptMerchant));
    candidates.push(normalizeRulePattern(row.receiptMerchant));
  }
  if (row.normalizedMerchant) {
    candidates.push(stripBankNoise(row.normalizedMerchant));
    candidates.push(normalizeRulePattern(row.normalizedMerchant));
  }
  if (row.description) {
    candidates.push(stripBankNoise(row.description));
    candidates.push(normalizeRulePattern(row.description));
  }
  return candidates
    .map(normalizeRulePattern)
    .filter(Boolean)
    .filter((pattern, index, list) => list.indexOf(pattern) === index);
}

function choosePattern(row) {
  return candidatePatterns(row).find((pattern) => !isGenericPattern(pattern)) || '';
}

async function getStoredMerchantRules() {
  const row = await db.SystemSetting.findOne({ where: { key: SETTING_KEY } });
  return parseJson(row && row.value, []);
}

async function saveStoredMerchantRules(rules) {
  await db.SystemSetting.upsert({
    key: SETTING_KEY,
    value: JSON.stringify(rules.slice(0, 1000)),
    description: 'User-maintained merchant category index for statement imports.'
  });
}

function rowWasAutoCategorized(row) {
  const tags = cleanText(row.tags).toLowerCase();
  return AUTO_TAGS.some((tag) => tags.includes(tag));
}

function ruleFromRow(row, options = {}) {
  if (!row || !row.Category) return { skipped: true, reason: 'missing_category' };
  if (rowWasAutoCategorized(row) && options.allowAutoTagged !== true) {
    return { skipped: true, reason: 'auto_tagged' };
  }
  const pattern = choosePattern(row);
  if (!pattern) return { skipped: true, reason: 'weak_pattern' };
  const category = row.Category;
  const categoryType = cleanText(category.categoryType).toLowerCase();
  const rowType = cleanText(row.transactionType).toLowerCase();
  const transactionType = ['income', 'expense', 'transfer', 'adjustment'].includes(categoryType)
    ? categoryType
    : (['income', 'expense', 'transfer', 'adjustment'].includes(rowType) ? rowType : 'expense');

  return {
    pattern,
    categoryName: category.name,
    transactionType,
    source: options.source || 'user',
    notes: options.notes || 'Learned from manual transaction categorization.',
    updatedAt: new Date().toISOString(),
    updatedByUserId: options.userId || null,
    sampleTransactionId: row.id,
    sampleDescription: cleanText(row.description).slice(0, 180)
  };
}

function upsertRule(rules, rule) {
  const normalizedPattern = merchantCategorizer.normalize(rule.pattern);
  const normalizedType = merchantCategorizer.normalize(rule.transactionType || '');
  const existingIndex = rules.findIndex((existing) =>
    merchantCategorizer.normalize(existing.pattern) === normalizedPattern &&
    merchantCategorizer.normalize(existing.transactionType || '') === normalizedType
  );
  if (existingIndex >= 0) {
    rules[existingIndex] = { ...rules[existingIndex], ...rule };
    return 'updated';
  }
  rules.unshift(rule);
  return 'created';
}

async function updateMerchantDefault(rule, categoryId) {
  const resolvedMerchant = await merchantResolver.resolveMerchantText(rule.pattern, { create: true });
  if (resolvedMerchant && resolvedMerchant.merchantId) {
    await db.Merchant.update({
      defaultCategoryId: categoryId,
      defaultTransactionType: rule.transactionType,
      lastSeenAt: new Date()
    }, { where: { id: resolvedMerchant.merchantId } });
  }
  return resolvedMerchant;
}

async function learnFromTransactions(ids, options = {}) {
  const transactionIds = Array.from(new Set((ids || []).map((id) => Number(id)).filter(Number.isInteger)));
  if (!transactionIds.length) return { scanned: 0, learned: 0, created: 0, updated: 0, skipped: 0, rules: [], skippedReasons: {} };

  const rows = await db.Transaction.findAll({
    where: { id: { [Op.in]: transactionIds }, categoryId: { [Op.ne]: null } },
    include: [
      { model: db.Category, required: true },
      { model: db.Merchant, required: false }
    ],
    order: [['updatedAt', 'DESC'], ['id', 'DESC']]
  });
  const rules = await getStoredMerchantRules();
  const result = { scanned: rows.length, learned: 0, created: 0, updated: 0, skipped: 0, rules: [], skippedReasons: {} };
  const seenThisRun = new Set();

  for (const row of rows) {
    const rule = ruleFromRow(row, options);
    if (rule.skipped) {
      result.skipped += 1;
      result.skippedReasons[rule.reason] = (result.skippedReasons[rule.reason] || 0) + 1;
      continue;
    }
    const key = merchantCategorizer.normalize(rule.pattern) + '|' + merchantCategorizer.normalize(rule.transactionType || '');
    if (seenThisRun.has(key)) {
      result.skipped += 1;
      result.skippedReasons.duplicate_in_batch = (result.skippedReasons.duplicate_in_batch || 0) + 1;
      continue;
    }
    seenThisRun.add(key);
    const status = upsertRule(rules, rule);
    result[status] += 1;
    result.learned += 1;
    result.rules.push(rule);
    if (options.updateMerchantDefaults !== false) {
      await updateMerchantDefault(rule, row.categoryId);
    }
  }

  if (options.apply !== false && result.learned) await saveStoredMerchantRules(rules);
  return result;
}

async function learnRecentCategoryEdits(options = {}) {
  const hours = Math.min(Math.max(Number(options.hours) || 6, 1), 168);
  const limit = Math.min(Math.max(Number(options.limit) || 500, 1), 5000);
  const since = new Date(Date.now() - hours * 60 * 60 * 1000);
  const rows = await db.Transaction.findAll({
    where: {
      status: { [Op.ne]: 'void' },
      categoryId: { [Op.ne]: null },
      updatedAt: { [Op.gte]: since }
    },
    attributes: ['id'],
    order: [['updatedAt', 'DESC'], ['id', 'DESC']],
    limit
  });
  return learnFromTransactions(rows.map((row) => row.id), {
    ...options,
    source: options.source || 'user',
    notes: options.notes || `Learned from recent manual category edits in the last ${hours} hour(s).`
  });
}

module.exports = {
  choosePattern,
  getStoredMerchantRules,
  learnFromTransactions,
  learnRecentCategoryEdits,
  normalizeRulePattern,
  ruleFromRow,
  saveStoredMerchantRules
};
