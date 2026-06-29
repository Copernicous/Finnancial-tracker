'use strict';

const { Op } = require('sequelize');
const db = require('../models');

const KNOWN_MERCHANTS = [
  { officialName: 'Amazon', aliases: ['amazon', 'amzn', 'amazon marketplace', 'amazon.com', 'amzn mktp'] },
  { officialName: 'Walmart', aliases: ['walmart', 'wal-mart', 'wm supercenter', 'walmart supercenter', 'walmart.com'] },
  { officialName: 'Target', aliases: ['target', 'target.com', 'target t-'] },
  { officialName: 'Publix', aliases: ['publix', 'publix super market'] },
  { officialName: 'Costco', aliases: ['costco', 'costco whse', 'costco wholesale'] },
  { officialName: 'Whole Foods Market', aliases: ['whole foods', 'wholefds', 'whole foods market'] },
  { officialName: 'Trader Joe\'s', aliases: ['trader joe', 'trader joe\'s'] },
  { officialName: 'Aldi', aliases: ['aldi'] },
  { officialName: 'CVS Pharmacy', aliases: ['cvs', 'cvs pharmacy', 'cvs/pharmacy'] },
  { officialName: 'Walgreens', aliases: ['walgreens', 'walgreen'] },
  { officialName: 'The Home Depot', aliases: ['home depot', 'the home depot', 'homedepot'] },
  { officialName: 'Lowe\'s', aliases: ['lowes', 'lowe\'s', 'lowe s'] },
  { officialName: 'Best Buy', aliases: ['best buy', 'bestbuy'] },
  { officialName: 'Apple', aliases: ['apple.com/bill', 'apple bill', 'apple services', 'apple store'] },
  { officialName: 'Google', aliases: ['google', 'google *', 'google storage', 'google youtube', 'youtube premium'] },
  { officialName: 'Microsoft', aliases: ['microsoft', 'msft', 'xbox'] },
  { officialName: 'Netflix', aliases: ['netflix'] },
  { officialName: 'Spotify', aliases: ['spotify'] },
  { officialName: 'Adobe', aliases: ['adobe'] },
  { officialName: 'GitHub', aliases: ['github'] },
  { officialName: 'Starbucks', aliases: ['starbucks', 'sbux'] },
  { officialName: 'McDonald\'s', aliases: ['mcdonald', 'mcdonalds', 'mcdonald\'s'] },
  { officialName: 'Chick-fil-A', aliases: ['chick-fil-a', 'chick fil a', 'chickfila'] },
  { officialName: 'DoorDash', aliases: ['doordash', 'dd doordash'] },
  { officialName: 'Uber Eats', aliases: ['uber eats', 'ubereats'] },
  { officialName: 'Uber', aliases: ['uber trip', 'uber *trip', 'uber'] },
  { officialName: 'Lyft', aliases: ['lyft'] },
  { officialName: 'Shell', aliases: ['shell oil', 'shell service', 'shell'] },
  { officialName: 'Chevron', aliases: ['chevron'] },
  { officialName: 'ExxonMobil', aliases: ['exxon', 'mobil', 'exxonmobil'] },
  { officialName: 'Wawa', aliases: ['wawa'] },
  { officialName: 'SunPass', aliases: ['sunpass'] },
  { officialName: 'Xfinity', aliases: ['xfinity', 'comcast'] },
  { officialName: 'Verizon', aliases: ['verizon', 'vzwrlss', 'vzw'] },
  { officialName: 'T-Mobile', aliases: ['t-mobile', 'tmobile'] },
  { officialName: 'AT&T', aliases: ['at&t', 'att payment', 'att*'] },
  { officialName: 'Google Fi', aliases: ['google fi', 'fi google'] },
  { officialName: 'PayPal', aliases: ['paypal', 'paypal *'] },
  { officialName: 'Zelle', aliases: ['zelle'] },
  { officialName: 'Venmo', aliases: ['venmo'] },
  { officialName: 'Citi', aliases: ['citi', 'citibank', 'payment thank you', 'online payment'] },
  { officialName: 'Banco Popular', aliases: ['banco popular', 'popular bank', 'bppr'] },
  { officialName: 'Fidelity', aliases: ['fidelity', 'fidelity investments'] }
];

const STATE_WORDS = new Set([
  'al', 'ak', 'az', 'ar', 'ca', 'co', 'ct', 'dc', 'de', 'fl', 'ga', 'hi', 'ia', 'id',
  'il', 'in', 'ks', 'ky', 'la', 'ma', 'md', 'me', 'mi', 'mn', 'mo', 'ms', 'mt', 'nc',
  'nd', 'ne', 'nh', 'nj', 'nm', 'nv', 'ny', 'oh', 'ok', 'or', 'pa', 'ri', 'sc', 'sd',
  'tn', 'tx', 'ut', 'va', 'vt', 'wa', 'wi', 'wv', 'wy'
]);

function normalizeBasic(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/['`]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanReceiptText(value) {
  let text = normalizeBasic(value);
  text = text
    .replace(/\b(?:sq|tst|paypal|pp|sp|apl|chkcard|checkcard|debit|visa|mc|pos|ach)\b\s*/g, ' ')
    .replace(/\b(?:purchase|authorization|auth|recurring|web|online|payment)\b/g, ' ')
    .replace(/\b(?:store|st|terminal|term|register|reg|auth|ref|order|ord|trace|seq|invoice|inv)\s*\d+\b/g, ' ')
    .replace(/\b(?:x{2,}|card|ending)\s*\d{2,6}\b/g, ' ')
    .replace(/\b\d{1,2}[\/-]\d{1,2}(?:[\/-]\d{2,4})?\b/g, ' ')
    .replace(/\b\d{5}(?:-\d{4})?\b/g, ' ')
    .replace(/\b\d{3,}\b/g, ' ')
    .replace(/\b(?:inc|llc|ltd|corp|corporation|company|co)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const tokens = text.split(' ').filter(Boolean);
  while (tokens.length > 1 && STATE_WORDS.has(tokens[tokens.length - 1])) tokens.pop();
  return tokens.join(' ');
}

function normalizeMerchantKey(value) {
  return cleanReceiptText(value);
}

function titleCase(value) {
  const special = {
    atandt: 'AT&T',
    cvs: 'CVS',
    bppr: 'BPPR',
    citi: 'Citi',
    mcdonalds: 'McDonald\'s'
  };
  const words = normalizeBasic(value).split(' ').filter(Boolean).slice(0, 5);
  if (!words.length) return 'Unknown Merchant';
  return words.map((word) => special[word] || word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
}

function knownMatch(key) {
  if (!key) return null;
  let best = null;
  for (const merchant of KNOWN_MERCHANTS) {
    for (const alias of merchant.aliases) {
      const aliasKey = normalizeMerchantKey(alias);
      if (!aliasKey) continue;
      const matched = key === aliasKey || key.includes(aliasKey);
      if (!matched) continue;
      const score = aliasKey.length + (key === aliasKey ? 50 : 0);
      if (!best || score > best.score) best = { ...merchant, alias, aliasKey, score };
    }
  }
  return best;
}

async function findAliasMatch(key) {
  if (!key || !db.MerchantAlias || !db.Merchant) return null;
  const aliases = await db.MerchantAlias.findAll({
    where: { isActive: { [Op.ne]: false } },
    include: [{ model: db.Merchant, required: true }],
    order: [['priority', 'DESC'], ['id', 'ASC']]
  });
  let best = null;
  for (const alias of aliases) {
    const aliasKey = alias.normalizedAlias || normalizeMerchantKey(alias.aliasText);
    if (!aliasKey) continue;
    let matched = false;
    if (alias.matchType === 'exact') matched = key === aliasKey;
    else if (alias.matchType === 'starts_with') matched = key.startsWith(aliasKey);
    else if (alias.matchType === 'regex') {
      try { matched = new RegExp(alias.aliasText, 'i').test(key); } catch (_e) { matched = false; }
    } else {
      matched = key === aliasKey || key.includes(aliasKey);
    }
    if (!matched) continue;
    const score = Number(alias.priority || 0) * 100 + aliasKey.length + (key === aliasKey ? 50 : 0);
    if (!best || score > best.score) best = { alias, merchant: alias.Merchant, score };
  }
  return best;
}

async function ensureMerchant(officialName, options = {}) {
  if (!db.Merchant) return null;
  const normalizedName = normalizeMerchantKey(officialName);
  if (!normalizedName) return null;
  const [merchant] = await db.Merchant.findOrCreate({
    where: { normalizedName },
    defaults: {
      officialName,
      normalizedName,
      merchantType: options.merchantType || null,
      defaultTransactionType: options.defaultTransactionType || null,
      notes: options.notes || null,
      isActive: true,
      lastSeenAt: new Date()
    },
    transaction: options.transaction
  });
  if (merchant.officialName !== officialName && options.preferOfficialName) {
    await merchant.update({ officialName, lastSeenAt: new Date() }, { transaction: options.transaction });
  } else {
    await merchant.update({ lastSeenAt: new Date() }, { transaction: options.transaction });
  }
  return merchant;
}

async function ensureAlias(merchant, aliasText, options = {}) {
  if (!merchant || !db.MerchantAlias) return null;
  const normalizedAlias = normalizeMerchantKey(aliasText);
  if (!normalizedAlias) return null;
  const [alias] = await db.MerchantAlias.findOrCreate({
    where: {
      merchantId: merchant.id,
      normalizedAlias,
      matchType: options.matchType || 'contains'
    },
    defaults: {
      merchantId: merchant.id,
      aliasText: String(aliasText || '').trim().slice(0, 255),
      normalizedAlias,
      matchType: options.matchType || 'contains',
      priority: options.priority || 50,
      source: options.source || 'auto',
      notes: options.notes || null,
      isActive: true
    },
    transaction: options.transaction
  });
  return alias;
}

async function resolveMerchantText(value, options = {}) {
  const receiptMerchant = String(value || '').trim();
  const key = normalizeMerchantKey(receiptMerchant);
  if (!key) return {
    merchantId: null,
    officialName: '',
    receiptMerchant,
    normalizedMerchant: '',
    confidence: 0,
    source: 'empty'
  };

  const manual = await findAliasMatch(key);
  if (manual && manual.merchant) {
    return {
      merchantId: manual.merchant.id,
      officialName: manual.merchant.officialName,
      receiptMerchant,
      normalizedMerchant: manual.merchant.normalizedName,
      confidence: 0.98,
      source: 'merchant_alias',
      aliasText: manual.alias.aliasText
    };
  }

  const known = knownMatch(key);
  if (known) {
    const merchant = options.create === false
      ? null
      : await ensureMerchant(known.officialName, {
        ...options,
        source: 'built_in_alias',
        notes: 'Created from built-in merchant alias.'
      });
    if (merchant) {
      await ensureAlias(merchant, receiptMerchant, {
        ...options,
        source: 'built_in_alias',
        priority: 80,
        notes: 'Learned from statement text.'
      });
    }
    return {
      merchantId: merchant ? merchant.id : null,
      officialName: known.officialName,
      receiptMerchant,
      normalizedMerchant: normalizeMerchantKey(known.officialName),
      confidence: 0.9,
      source: 'built_in_alias',
      aliasText: known.alias
    };
  }

  const existing = db.Merchant
    ? await db.Merchant.findOne({ where: { normalizedName: key }, transaction: options.transaction })
    : null;
  if (existing) {
    await ensureAlias(existing, receiptMerchant, { ...options, source: 'exact_merchant_name', priority: 70 });
    return {
      merchantId: existing.id,
      officialName: existing.officialName,
      receiptMerchant,
      normalizedMerchant: existing.normalizedName,
      confidence: 0.86,
      source: 'exact_merchant_name'
    };
  }

  const officialName = titleCase(key);
  const merchant = options.create === false
    ? null
    : await ensureMerchant(officialName, {
      ...options,
      notes: 'Auto-created from first reviewed transaction text.'
    });
  if (merchant) {
    await ensureAlias(merchant, receiptMerchant, {
      ...options,
      source: 'auto_cleaned',
      priority: 40,
      notes: 'Auto-learned cleaned merchant text.'
    });
  }
  return {
    merchantId: merchant ? merchant.id : null,
    officialName,
    receiptMerchant,
    normalizedMerchant: normalizeMerchantKey(officialName),
    confidence: 0.62,
    source: 'auto_cleaned'
  };
}

async function merchantPayload(value, options = {}) {
  const resolved = await resolveMerchantText(value, options);
  return {
    merchantId: resolved.merchantId,
    merchant: resolved.officialName || resolved.receiptMerchant || '',
    receiptMerchant: resolved.receiptMerchant || resolved.officialName || '',
    normalizedMerchant: resolved.normalizedMerchant || normalizeMerchantKey(resolved.officialName || resolved.receiptMerchant),
    merchantMatchConfidence: resolved.confidence || null,
    merchantMatchSource: resolved.source || null
  };
}

async function backfillTransactions(options = {}) {
  const limit = Math.min(Math.max(Number(options.limit) || 1000, 1), 10000);
  const where = options.force ? {} : { [Op.or]: [{ merchantId: { [Op.is]: null } }, { receiptMerchant: { [Op.is]: null } }] };
  const rows = await db.Transaction.findAll({
    where,
    order: [['transactionDate', 'DESC'], ['id', 'DESC']],
    limit
  });
  let updated = 0;
  for (const row of rows) {
    const raw = row.description || row.receiptMerchant || row.merchant || '';
    const payload = await merchantPayload(raw, { source: 'backfill' });
    await row.update({
      merchantId: payload.merchantId,
      merchant: payload.merchant,
      receiptMerchant: payload.receiptMerchant,
      normalizedMerchant: payload.normalizedMerchant,
      merchantMatchConfidence: payload.merchantMatchConfidence,
      merchantMatchSource: payload.merchantMatchSource
    });
    updated += 1;
  }
  return { scanned: rows.length, updated };
}

module.exports = {
  KNOWN_MERCHANTS,
  cleanReceiptText,
  normalizeMerchantKey,
  resolveMerchantText,
  merchantPayload,
  backfillTransactions
};
