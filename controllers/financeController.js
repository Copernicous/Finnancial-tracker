'use strict';

const db = require('../models');
const { Op } = require('sequelize');
const merchantCategorizer = require('../services/merchantCategorizer');
const merchantResolver = require('../services/merchantResolver');

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function pct(value) {
  return Math.round(value * 10) / 10;
}

function dateRange(year, month) {
  const y = Number(year) || 2026;
  if (month) {
    const m = String(month).padStart(2, '0');
    const end = new Date(Date.UTC(y, Number(month), 0)).getUTCDate();
    return [`${y}-${m}-01`, `${y}-${m}-${String(end).padStart(2, '0')}`];
  }
  return [`${y}-01-01`, `${y}-12-31`];
}

function addYearFromValue(years, value) {
  const year = Number(String(value || '').slice(0, 4));
  if (Number.isInteger(year) && year >= 1900 && year <= 2200) years.add(year);
}

function isAllYears(value) {
  return ['all', 'all_years', '*'].includes(String(value || '').trim().toLowerCase());
}

function cleanText(value) {
  return String(value == null ? '' : value).trim();
}

function cleanId(value) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function merchantDisplayName(row) {
  return cleanText(row.Merchant && row.Merchant.merchantGroupName)
    || cleanText(row.Merchant && row.Merchant.officialName)
    || cleanText(row.merchant || row.normalizedMerchant || row.description)
    || 'No merchant';
}

function merchantFilterKey(row) {
  const groupName = cleanText(row.Merchant && row.Merchant.merchantGroupName);
  if (groupName) return `group:${groupName}`;
  if (row.merchantId) return `merchant:${row.merchantId}`;
  return `text:${merchantResolver.normalizeMerchantKey(merchantDisplayName(row)) || 'no-merchant'}`;
}

function transactionSearchOr(q, fields = {}) {
  const like = { [Op.iLike]: `%${q}%` };
  const clauses = [
    { description: like },
    { merchant: like },
    { receiptMerchant: like },
    { normalizedMerchant: like },
    { '$Merchant.officialName$': like },
    { '$Merchant.normalizedName$': like },
    { '$Merchant.merchantGroupName$': like },
    { '$Merchant.merchantType$': like }
  ];
  if (fields.referenceNumber !== false) clauses.push({ referenceNumber: like });
  if (fields.memo !== false) clauses.push({ memo: like });
  if (fields.tags) clauses.push({ tags: like });
  return clauses;
}

function internalTransferReason(row) {
  const categoryType = String(row.Category && row.Category.categoryType || '').toLowerCase();
  if (String(row.transactionType || '').toLowerCase() === 'transfer') return 'ledger_transfer';
  if (categoryType === 'transfer') return 'category_transfer';

  const text = [
    row.description,
    row.merchant,
    row.receiptMerchant,
    row.normalizedMerchant,
    row.memo,
    row.Category && row.Category.name,
    row.Category && row.Category.groupName
  ].filter(Boolean).join(' ').toLowerCase();

  if (/online payment, thank you|citi card online payment/.test(text)) return 'credit_card_payment';
  if (/\btransfer\s+(to|from)\b/.test(text)) return 'bank_transfer';
  if (/\bmoney market\b/.test(text)) return 'money_market_transfer';
  if (/\bult(?:imate)?\s+savings\b|\bsavings plus\b/.test(text)) return 'savings_transfer';
  if (/certificate(?:s)? of deposit|\bcd account\b|\b(to|from) cd\b/.test(text)) return 'cd_transfer';
  if (/\b(to|from)\s+(checking|savings)\b/.test(text)) return 'account_transfer';
  return '';
}

function parseJsonField(value, fallback) {
  if (!value) return fallback;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch (err) {
    return fallback;
  }
}

function importSourceFromRow(importRow) {
  if (!importRow) return null;
  const raw = importRow.rawData || {};
  const normalized = importRow.normalizedData || {};
  const batch = importRow.ImportBatch || null;
  const notes = parseJsonField(batch && batch.notes, {});
  const sourceCopies = Array.isArray(notes.sourceCopies) ? notes.sourceCopies : [];
  const firstCopy = sourceCopies[0] || {};
  return {
    importRowId: importRow.id,
    importBatchId: importRow.importBatchId,
    importBatchFileName: batch ? batch.fileName : '',
    originalFileName: notes.originalFileName || (batch ? batch.fileName : ''),
    relativePath: notes.relativePath || firstCopy.relativePath || '',
    statementDate: raw.statementDate || normalized.statementDate || (notes.metadata && notes.metadata.statementDate) || '',
    statementSection: raw.section || normalized.statementSection || '',
    cardholder: raw.cardholder || normalized.cardholder || '',
    parserVersion: normalized.parserVersion || notes.parserVersion || ''
  };
}

async function importSourcesByTransactionId(transactionIds) {
  const ids = Array.from(new Set((transactionIds || []).map(cleanId).filter(Boolean)));
  if (!ids.length) return new Map();
  const rows = await db.ImportRow.findAll({
    where: { postedTransactionId: { [Op.in]: ids } },
    include: [{ model: db.ImportBatch, attributes: ['id', 'fileName', 'notes'], required: false }],
    order: [['id', 'ASC']]
  });
  const map = new Map();
  rows.forEach((row) => {
    if (!map.has(row.postedTransactionId)) map.set(row.postedTransactionId, importSourceFromRow(row));
  });
  return map;
}

async function getStoredMerchantRules() {
  const row = await db.SystemSetting.findOne({ where: { key: 'merchant_category_rules' } });
  const rules = parseJsonField(row && row.value, []);
  return Array.isArray(rules) ? rules : [];
}

function pickDateWhere(query, defaultYear = 2026) {
  const where = {};
  if (query.from || query.to) {
    if (query.from) where[Op.gte] = query.from;
    if (query.to) where[Op.lte] = query.to;
    return where;
  }
  if (isAllYears(query.year)) return null;
  const year = Number(query.year) || defaultYear;
  const month = query.month ? Number(query.month) : null;
  const [from, to] = dateRange(year, month);
  return { [Op.between]: [from, to] };
}

function parseIsoDay(value) {
  const text = String(value || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const date = new Date(text + 'T00:00:00Z');
  return Number.isNaN(date.getTime()) ? null : date;
}

function isoDay(date) {
  return date.toISOString().slice(0, 10);
}

function addIsoDays(value, days) {
  const date = parseIsoDay(value);
  if (!date) return null;
  date.setUTCDate(date.getUTCDate() + days);
  return isoDay(date);
}

function bucketDate(dateValue, grain) {
  const date = parseIsoDay(dateValue);
  if (!date) return String(dateValue || '').slice(0, 10);
  if (grain === 'day') return isoDay(date);
  if (grain === 'week') {
    const copy = new Date(date);
    const day = (copy.getUTCDay() + 6) % 7;
    copy.setUTCDate(copy.getUTCDate() - day);
    return isoDay(copy);
  }
  if (grain === 'year') return String(date.getUTCFullYear());
  return isoDay(new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1))).slice(0, 7);
}

function rangeStartDate(date, grain) {
  if (grain === 'week') {
    const copy = new Date(date);
    const day = (copy.getUTCDay() + 6) % 7;
    copy.setUTCDate(copy.getUTCDate() - day);
    return copy;
  }
  if (grain === 'month') return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
  if (grain === 'year') return new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return new Date(date);
}

function stepBucket(date, grain) {
  const next = new Date(date);
  if (grain === 'week') next.setUTCDate(next.getUTCDate() + 7);
  else if (grain === 'month') next.setUTCMonth(next.getUTCMonth() + 1);
  else if (grain === 'year') next.setUTCFullYear(next.getUTCFullYear() + 1);
  else next.setUTCDate(next.getUTCDate() + 1);
  return next;
}

function buildTrendBuckets(query, rows, grain) {
  const rowDates = rows.map((row) => parseIsoDay(row.transactionDate)).filter(Boolean);
  const sortedRowDates = rowDates.slice().sort((a, b) => a - b);
  const [defaultFrom, defaultTo] = dateRange(query.year, query.month);
  let start = parseIsoDay(query.from) || sortedRowDates[0] || parseIsoDay(defaultFrom);
  let end = parseIsoDay(query.to) || sortedRowDates[sortedRowDates.length - 1] || parseIsoDay(query.from) || parseIsoDay(defaultTo);

  if (!start || !end) {
    return Array.from(new Set(rows.map((row) => bucketDate(row.transactionDate, grain)))).sort();
  }
  if (start > end) {
    const swap = start;
    start = end;
    end = swap;
  }

  const labels = [];
  let cursor = rangeStartDate(start, grain);
  let guard = 0;
  while (cursor <= end && guard < 2500) {
    labels.push(bucketDate(isoDay(cursor), grain));
    cursor = stepBucket(cursor, grain);
    guard += 1;
  }
  return labels;
}

function buildActiveTrendBuckets(rows, grain) {
  return Array.from(new Set(rows.map((row) => bucketDate(row.transactionDate, grain)))).sort();
}

function transactionQueryParts(query, options = {}) {
  const where = {};
  const accountWhere = {};
  const merchantWhere = {};
  const q = cleanText(query.q);

  const dateWhere = pickDateWhere(query, options.defaultYear || 2026);
  if (dateWhere) where.transactionDate = dateWhere;

  if (query.accountId) where.accountId = Number(query.accountId);
  const merchantKey = cleanText(query.merchantKey || query.merchantId);
  if (merchantKey) {
    if (merchantKey.startsWith('group:')) {
      const groupName = cleanText(merchantKey.slice('group:'.length));
      if (groupName) merchantWhere.merchantGroupName = groupName;
    } else if (merchantKey.startsWith('merchant:')) {
      const merchantId = cleanId(merchantKey.slice('merchant:'.length));
      if (merchantId) where.merchantId = merchantId;
    } else {
      const merchantId = cleanId(merchantKey);
      if (merchantId) where.merchantId = merchantId;
    }
  }
  if (query.categoryId === 'uncategorized' || query.categoryId === 'none') {
    where.categoryId = { [Op.is]: null };
  } else if (query.categoryId) {
    where.categoryId = Number(query.categoryId);
  }
  if (query.type) where.transactionType = cleanText(query.type);
  if (query.status) where.status = cleanText(query.status);
  if (query.currency && query.currency !== 'ALL') where.currency = cleanText(query.currency).toUpperCase();
  if (query.sourceType) where.sourceType = cleanText(query.sourceType);
  if (query.searchScope === 'entry' && q) {
    where[Op.or] = transactionSearchOr(q, { referenceNumber: false, tags: false });
  } else if (query.searchScope === 'group' && q) {
    where[Op.or] = transactionSearchOr(q, { memo: false, tags: true });
  }
  if (query.onlyUncategorized === 'true' || query.onlyUncategorized === true) where.categoryId = { [Op.is]: null };
  if (query.min || query.max) {
    where.amount = {};
    if (query.min) where.amount[Op.gte] = Number(query.min);
    if (query.max) where.amount[Op.lte] = Number(query.max);
  }
  if (query.tag) where.tags = { [Op.iLike]: `%${cleanText(query.tag)}%` };
  if (q && !where[Op.or]) {
    where[Op.or] = transactionSearchOr(q, { tags: true });
  }

  if (query.accountClass) accountWhere.accountClass = cleanText(query.accountClass);
  if (query.accountType) accountWhere.accountType = cleanText(query.accountType);

  return { where, accountWhere, merchantWhere };
}

function financeSqlFilters(query, options = {}) {
  const clauses = [];
  const replacements = {};
  const q = cleanText(query.q);
  const dateWhere = pickDateWhere(query, options.defaultYear || 2026);

  if (dateWhere) {
    if (dateWhere[Op.between]) {
      replacements.dateFrom = dateWhere[Op.between][0];
      replacements.dateTo = dateWhere[Op.between][1];
      clauses.push('t."transactionDate" BETWEEN :dateFrom AND :dateTo');
    } else {
      if (dateWhere[Op.gte]) {
        replacements.dateFrom = dateWhere[Op.gte];
        clauses.push('t."transactionDate" >= :dateFrom');
      }
      if (dateWhere[Op.lte]) {
        replacements.dateTo = dateWhere[Op.lte];
        clauses.push('t."transactionDate" <= :dateTo');
      }
    }
  }

  if (query.accountId) {
    replacements.accountId = Number(query.accountId);
    clauses.push('t."accountId" = :accountId');
  }
  const merchantKey = cleanText(query.merchantKey || query.merchantId);
  if (merchantKey) {
    if (merchantKey.startsWith('group:')) {
      replacements.merchantGroupName = cleanText(merchantKey.slice('group:'.length));
      clauses.push('m."merchantGroupName" = :merchantGroupName');
    } else if (merchantKey.startsWith('merchant:')) {
      replacements.merchantId = cleanId(merchantKey.slice('merchant:'.length));
      if (replacements.merchantId) clauses.push('t."merchantId" = :merchantId');
    } else {
      replacements.merchantId = cleanId(merchantKey);
      if (replacements.merchantId) clauses.push('t."merchantId" = :merchantId');
    }
  }
  if (query.categoryId === 'uncategorized' || query.categoryId === 'none' || query.onlyUncategorized === 'true' || query.onlyUncategorized === true) {
    clauses.push('t."categoryId" IS NULL');
  } else if (query.categoryId) {
    replacements.categoryId = Number(query.categoryId);
    clauses.push('t."categoryId" = :categoryId');
  }
  if (query.type) {
    replacements.transactionType = cleanText(query.type);
    clauses.push('t."transactionType" = :transactionType');
  }
  if (query.status) {
    replacements.status = cleanText(query.status);
    clauses.push('t."status" = :status');
  }
  if (query.currency && query.currency !== 'ALL') {
    replacements.currency = cleanText(query.currency).toUpperCase();
    clauses.push('t."currency" = :currency');
  }
  if (query.sourceType) {
    replacements.sourceType = cleanText(query.sourceType);
    clauses.push('t."sourceType" = :sourceType');
  }
  if (query.min) {
    replacements.minAmount = Number(query.min);
    clauses.push('t."amount" >= :minAmount');
  }
  if (query.max) {
    replacements.maxAmount = Number(query.max);
    clauses.push('t."amount" <= :maxAmount');
  }
  if (query.tag) {
    replacements.tagLike = `%${cleanText(query.tag)}%`;
    clauses.push('t."tags" ILIKE :tagLike');
  }
  if (query.accountClass) {
    replacements.accountClass = cleanText(query.accountClass);
    clauses.push('a."accountClass" = :accountClass');
  }
  if (query.accountType) {
    replacements.accountType = cleanText(query.accountType);
    clauses.push('a."accountType" = :accountType');
  }
  if (q) {
    replacements.qLike = `%${q}%`;
    const searchFields = [
      't."description"',
      't."merchant"',
      't."receiptMerchant"',
      't."normalizedMerchant"',
      'm."officialName"',
      'm."normalizedName"',
      'm."merchantGroupName"',
      'm."merchantType"'
    ];
    if (query.searchScope !== 'entry') searchFields.push('t."referenceNumber"');
    if (query.searchScope !== 'group') searchFields.push('t."memo"');
    if (query.searchScope !== 'entry') searchFields.push('t."tags"');
    clauses.push(`(${searchFields.map((field) => `${field} ILIKE :qLike`).join(' OR ')})`);
  }

  return {
    replacements,
    whereSql: clauses.length ? clauses.join(' AND ') : '1=1',
    joinsSql: `
      LEFT JOIN "Accounts" a ON a."id" = t."accountId"
      LEFT JOIN "Categories" c ON c."id" = t."categoryId"
      LEFT JOIN "Merchants" m ON m."id" = t."merchantId"
    `
  };
}

async function transactionSummarySql(query) {
  const { whereSql, joinsSql, replacements } = financeSqlFilters(query);
  const categorySql = `
    SELECT
      t."categoryId" AS "categoryId",
      COALESCE(c."name", 'Uncategorized') AS "name",
      COALESCE(c."groupName", 'Unassigned') AS "groupName",
      SUM(ABS(t."amount"))::float AS "amount",
      COUNT(*)::int AS "count"
    FROM "Transactions" t
    ${joinsSql}
    WHERE ${whereSql}
    GROUP BY t."categoryId", c."name", c."groupName"
    ORDER BY COUNT(*) DESC, SUM(ABS(t."amount")) DESC
    LIMIT 60
  `;
  const merchantSql = `
    SELECT
      CASE
        WHEN NULLIF(TRIM(m."merchantGroupName"), '') IS NOT NULL THEN 'group:' || m."merchantGroupName"
        WHEN t."merchantId" IS NOT NULL THEN 'merchant:' || t."merchantId"::text
        ELSE 'text:' || COALESCE(NULLIF(REGEXP_REPLACE(LOWER(COALESCE(NULLIF(t."merchant", ''), NULLIF(t."normalizedMerchant", ''), NULLIF(t."description", ''), 'no merchant')), '[^a-z0-9]+', '-', 'g'), ''), 'no-merchant')
      END AS "merchantKey",
      CASE WHEN NULLIF(TRIM(m."merchantGroupName"), '') IS NOT NULL THEN NULL ELSE t."merchantId" END AS "merchantId",
      NULLIF(TRIM(m."merchantGroupName"), '') AS "groupName",
      COALESCE(NULLIF(TRIM(m."merchantGroupName"), ''), NULLIF(TRIM(m."officialName"), ''), NULLIF(TRIM(t."merchant"), ''), NULLIF(TRIM(t."normalizedMerchant"), ''), NULLIF(TRIM(t."description"), ''), 'No merchant') AS "name",
      SUM(ABS(t."amount"))::float AS "amount",
      COUNT(*)::int AS "count"
    FROM "Transactions" t
    ${joinsSql}
    WHERE ${whereSql}
    GROUP BY 1, 2, 3, 4
    ORDER BY SUM(ABS(t."amount")) DESC
    LIMIT 60
  `;
  const [categorySummary, merchantSummary] = await Promise.all([
    db.sequelize.query(categorySql, { replacements, type: db.Sequelize.QueryTypes.SELECT }),
    db.sequelize.query(merchantSql, { replacements, type: db.Sequelize.QueryTypes.SELECT })
  ]);
  return { categorySummary, merchantSummary };
}

function accountInclude(accountWhere = {}) {
  return {
    model: db.Account,
    attributes: ['id', 'name', 'accountClass', 'accountSubtype', 'accountType', 'currency'],
    where: Object.keys(accountWhere).length ? accountWhere : undefined,
    required: Object.keys(accountWhere).length > 0
  };
}

function categoryInclude() {
  return { model: db.Category, attributes: ['id', 'name', 'groupName', 'categoryType'], required: false };
}

function merchantInclude(merchantWhere = {}) {
  const hasMerchantWhere = Object.keys(merchantWhere).length > 0;
  return {
    model: db.Merchant,
    attributes: ['id', 'officialName', 'normalizedName', 'merchantGroupName', 'merchantType'],
    where: hasMerchantWhere ? merchantWhere : undefined,
    required: hasMerchantWhere
  };
}

function sortOrder(sortKey, sortDir) {
  const dir = String(sortDir || '').toLowerCase() === 'asc' ? 'ASC' : 'DESC';
  const direct = {
    transactionDate: ['transactionDate', dir],
    description: ['description', dir],
    transactionType: ['transactionType', dir],
    amount: ['amount', dir],
    currency: ['currency', dir],
    status: ['status', dir],
    sourceType: ['sourceType', dir],
    id: ['id', dir]
  };
  if (sortKey === 'accountName') return [[db.Account, 'name', dir], ['transactionDate', 'DESC'], ['id', 'DESC']];
  if (sortKey === 'categoryName') return [[db.Category, 'name', dir], ['transactionDate', 'DESC'], ['id', 'DESC']];
  if (sortKey === 'merchant') return [[db.Merchant, 'merchantGroupName', dir], [db.Merchant, 'officialName', dir], ['merchant', dir], ['transactionDate', 'DESC'], ['id', 'DESC']];
  return [direct[sortKey] || ['transactionDate', 'DESC'], ['id', 'DESC']];
}

function transactionDto(row) {
  const displayMerchant = merchantDisplayName(row);
  return {
    id: row.id,
    transactionDate: row.transactionDate,
    accountId: row.accountId,
    accountName: row.Account ? row.Account.name : '',
    accountClass: row.Account ? row.Account.accountClass : '',
    accountType: row.Account ? row.Account.accountType : '',
    categoryId: row.categoryId,
    categoryName: row.Category ? row.Category.name : '',
    categoryGroup: row.Category ? row.Category.groupName : '',
    merchantId: row.merchantId,
    relatedAccountId: row.relatedAccountId,
    description: row.description,
    merchant: row.Merchant ? row.Merchant.officialName : row.merchant,
    merchantOfficialName: row.Merchant ? row.Merchant.officialName : '',
    merchantGroupName: row.Merchant ? row.Merchant.merchantGroupName : '',
    merchantDisplayName: displayMerchant,
    rawMerchant: row.merchant || '',
    merchantKey: merchantFilterKey(row),
    receiptMerchant: row.receiptMerchant,
    normalizedMerchant: row.normalizedMerchant,
    merchantMatchConfidence: row.merchantMatchConfidence == null ? null : toNumber(row.merchantMatchConfidence),
    merchantMatchSource: row.merchantMatchSource,
    transactionType: row.transactionType,
    amount: toNumber(row.amount),
    currency: row.currency,
    originalAmount: row.originalAmount == null ? null : toNumber(row.originalAmount),
    originalCurrency: row.originalCurrency,
    exchangeRate: row.exchangeRate == null ? null : toNumber(row.exchangeRate),
    status: row.status,
    sourceType: row.sourceType,
    referenceNumber: row.referenceNumber,
    tags: row.tags,
    clearedDate: row.clearedDate,
    isRecurring: !!row.isRecurring,
    memo: row.memo,
    isSimulation: !!row.isSimulation
  };
}

function transactionDetailDto(row, sourceMap, metric) {
  const dto = transactionDto(row);
  const kind = classifyTransaction(row);
  const amount = toNumber(row.amount);
  const contribution = metric === 'cashFlow'
    ? (kind === 'income' ? Math.abs(amount) : (kind === 'expense' ? -Math.abs(amount) : 0))
    : Math.abs(amount);
  return {
    ...dto,
    metricKind: kind,
    transferReason: internalTransferReason(row),
    metricContribution: contribution,
    source: sourceMap.get(row.id) || null
  };
}

function classifyTransaction(row) {
  const amount = toNumber(row.amount);
  const type = String(row.transactionType || '').toLowerCase();
  if (internalTransferReason(row)) return 'transfer';
  if (type === 'adjustment') return 'adjustment';
  if (amount > 0) return 'income';
  if (amount < 0) return 'expense';
  return type || 'adjustment';
}

function accountNetValue(account, balance) {
  const cls = String(account.accountClass || account.accountType || '').toLowerCase();
  const type = String(account.accountType || '').toLowerCase();
  if (account.includeInNetWorth === false) return 0;
  if (cls.includes('credit') || cls.includes('card') || cls.includes('loan') || type === 'liability') {
    return balance > 0 ? -balance : balance;
  }
  return balance;
}

function accountLabel(account) {
  return account.name + (account.currency ? ` (${account.currency})` : '');
}

exports.years = async (req, res, next) => {
  try {
    const rows = await db.sequelize.query(`
      SELECT DISTINCT year FROM (
        SELECT EXTRACT(YEAR FROM "transactionDate")::int AS year FROM "Transactions"
        UNION ALL SELECT "year"::int AS year FROM "Budgets" WHERE "year" IS NOT NULL
        UNION ALL SELECT EXTRACT(YEAR FROM "snapshotDate")::int AS year FROM "AccountBalanceSnapshots"
        UNION ALL SELECT EXTRACT(YEAR FROM "periodStart")::int AS year FROM "Reconciliations" WHERE "periodStart" IS NOT NULL
        UNION ALL SELECT EXTRACT(YEAR FROM "periodEnd")::int AS year FROM "Reconciliations" WHERE "periodEnd" IS NOT NULL
        UNION ALL SELECT EXTRACT(YEAR FROM "rateDate")::int AS year FROM "CurrencyRates"
      ) years
      WHERE year BETWEEN 1900 AND 2200
      ORDER BY year DESC
    `, { type: db.Sequelize.QueryTypes.SELECT });

    const currentYear = new Date().getFullYear();
    const sortedYears = rows.map((row) => Number(row.year)).filter(Boolean);
    if (!sortedYears.length) sortedYears.push(currentYear);

    res.json({
      years: sortedYears,
      defaultYear: sortedYears[0],
      currentYear,
      minYear: Math.min(...sortedYears),
      maxYear: Math.max(...sortedYears)
    });
  } catch (err) {
    next(err);
  }
};

exports.overview = async (req, res, next) => {
  try {
    const allYears = isAllYears(req.query.year);
    const year = allYears ? null : (Number(req.query.year) || 2026);
    const month = !allYears && req.query.month ? Number(req.query.month) : null;
    const accountId = req.query.accountId ? Number(req.query.accountId) : null;
    const accountClass = cleanText(req.query.accountClass);
    const currency = req.query.currency && req.query.currency !== 'ALL' ? String(req.query.currency) : null;
    const [from, to] = allYears ? [null, null] : dateRange(year, month);

    const txWhere = {
      status: { [Op.ne]: 'void' }
    };
    if (!allYears) txWhere.transactionDate = { [Op.between]: [from, to] };
    if (accountId) txWhere.accountId = accountId;
    if (currency) txWhere.currency = currency;
    const overviewAccountWhere = accountClass ? { accountClass } : {};

    const [accounts, categories, transactions, budgets, recurring, goals, holdings, snapshots, rates] = await Promise.all([
      db.Account.findAll({
        where: {
          ...(accountClass ? { accountClass } : {}),
          ...(currency ? { currency } : {})
        },
        order: [['accountClass', 'ASC'], ['name', 'ASC']]
      }),
      db.Category.findAll({ order: [['groupName', 'ASC'], ['name', 'ASC']] }),
      db.Transaction.findAll({
        where: txWhere,
        include: [
          {
            model: db.Account,
            attributes: ['id', 'name', 'accountClass', 'accountSubtype', 'accountType', 'currency'],
            where: Object.keys(overviewAccountWhere).length ? overviewAccountWhere : undefined,
            required: Object.keys(overviewAccountWhere).length > 0
          },
          { model: db.Category, attributes: ['id', 'name', 'groupName', 'categoryType'] },
          merchantInclude()
        ],
        order: [['transactionDate', 'ASC'], ['id', 'ASC']]
      }),
      db.Budget.findAll({
        where: {
          ...(allYears ? {} : { year }),
          isActive: true,
          ...(month ? { [Op.or]: [{ month }, { month: null }] } : {}),
          ...(currency ? { currency } : {})
        },
        include: [{ model: db.Category, attributes: ['id', 'name', 'groupName', 'categoryType'] }],
        order: [['month', 'ASC'], ['name', 'ASC']]
      }),
      db.RecurringTransaction.findAll({
        where: { isActive: true, ...(currency ? { currency } : {}) },
        include: [
          { model: db.Account, attributes: ['id', 'name', 'accountClass', 'currency'] },
          { model: db.Category, attributes: ['id', 'name', 'groupName', 'categoryType'] }
        ],
        order: [['nextDate', 'ASC'], ['name', 'ASC']],
        limit: 50
      }),
      db.FinancialGoal.findAll({
        where: { status: { [Op.ne]: 'archived' }, ...(currency ? { currency } : {}) },
        include: [{ model: db.Account, attributes: ['id', 'name', 'accountClass', 'currency'] }],
        order: [['priority', 'ASC'], ['targetDate', 'ASC']]
      }),
      db.InvestmentHolding.findAll({
        where: currency ? { currency } : {},
        include: [{ model: db.Account, attributes: ['id', 'name', 'accountClass', 'currency'] }],
        order: [['assetClass', 'ASC'], ['symbol', 'ASC']]
      }),
      db.AccountBalanceSnapshot.findAll({
        where: {
          ...(allYears ? {} : { snapshotDate: { [Op.lte]: to } }),
          ...(accountId ? { accountId } : {}),
          ...(currency ? { currency } : {})
        },
        order: [['snapshotDate', 'DESC'], ['id', 'DESC']],
        limit: 500
      }),
      db.CurrencyRate.findAll({
        where: currency ? { [Op.or]: [{ fromCurrency: currency }, { toCurrency: currency }] } : {},
        order: [['rateDate', 'DESC'], ['fromCurrency', 'ASC']],
        limit: 30
      })
    ]);

    const categoryMap = new Map(categories.map((category) => [Number(category.id), category]));
    const allYearLabels = Array.from(new Set(transactions.map((tx) => String(tx.transactionDate || '').slice(0, 4)).filter(Boolean))).sort();
    const monthly = allYears ? allYearLabels.map((label) => ({
      month: null,
      label,
      income: 0,
      expenses: 0,
      transfers: 0,
      net: 0
    })) : Array.from({ length: 12 }, (_, idx) => ({
      month: idx + 1,
      label: `${year}-${String(idx + 1).padStart(2, '0')}`,
      income: 0,
      expenses: 0,
      transfers: 0,
      net: 0
    }));
    const periodIndex = new Map(monthly.map((item, index) => [item.label, index]));
    const accountMovement = new Map();
    const categoryTotals = new Map();
    let income = 0;
    let expenses = 0;
    let transfers = 0;

    transactions.forEach((tx) => {
      const amount = toNumber(tx.amount);
      const kind = classifyTransaction(tx);
      const periodLabel = allYears ? String(tx.transactionDate || '').slice(0, 4) : `${year}-${String(tx.transactionDate).slice(5, 7)}`;
      const monthIndex = allYears
        ? periodIndex.get(periodLabel)
        : Math.max(0, Math.min(11, Number(String(tx.transactionDate).slice(5, 7)) - 1));
      if (monthIndex == null || !monthly[monthIndex]) return;
      if (!accountMovement.has(tx.accountId)) accountMovement.set(tx.accountId, 0);
      accountMovement.set(tx.accountId, accountMovement.get(tx.accountId) + amount);

      if (kind === 'income') {
        income += Math.abs(amount);
        monthly[monthIndex].income += Math.abs(amount);
      } else if (kind === 'expense') {
        expenses += Math.abs(amount);
        monthly[monthIndex].expenses += Math.abs(amount);
        const category = categoryMap.get(Number(tx.categoryId));
        const key = tx.categoryId || 'uncategorized';
        if (!categoryTotals.has(key)) {
          categoryTotals.set(key, {
            categoryId: tx.categoryId,
            name: category ? category.name : 'Uncategorized',
            groupName: category ? category.groupName : 'Unassigned',
            amount: 0,
            count: 0
          });
        }
        const current = categoryTotals.get(key);
        current.amount += Math.abs(amount);
        current.count += 1;
      } else if (kind === 'transfer') {
        transfers += Math.abs(amount);
        monthly[monthIndex].transfers += Math.abs(amount);
      }
    });
    monthly.forEach((item) => {
      item.net = item.income - item.expenses;
    });

    const latestSnapshotByAccount = new Map();
    snapshots.forEach((snapshot) => {
      if (!latestSnapshotByAccount.has(snapshot.accountId)) latestSnapshotByAccount.set(snapshot.accountId, snapshot);
    });

    const accountSummaries = accounts
      .filter((account) => !accountId || Number(account.id) === accountId)
      .filter((account) => !currency || account.currency === currency)
      .map((account) => {
        const snapshot = latestSnapshotByAccount.get(account.id);
        const ledgerBalance = toNumber(account.currentBalance || account.openingBalance) + toNumber(accountMovement.get(account.id));
        const statementBalance = snapshot ? toNumber(snapshot.balance) : null;
        const balance = snapshot ? statementBalance : ledgerBalance;
        return {
          id: account.id,
          name: accountLabel(account),
          accountCode: account.accountCode,
          accountClass: account.accountClass || 'banking',
          accountSubtype: account.accountSubtype || '',
          currency: account.currency,
          status: account.status,
          balance,
          ledgerBalance,
          statementBalance,
          statementDate: snapshot ? snapshot.snapshotDate : '',
          statementSource: snapshot ? snapshot.source : '',
          statementDifference: snapshot ? ledgerBalance - statementBalance : null,
          creditLimit: toNumber(account.creditLimit),
          interestRate: toNumber(account.interestRate),
          includeInNetWorth: account.includeInNetWorth !== false,
          netWorthValue: accountNetValue(account, balance)
        };
      });

    const accountClasses = new Map();
    accountSummaries.forEach((account) => {
      const key = account.accountClass || 'banking';
      if (!accountClasses.has(key)) accountClasses.set(key, { key, balance: 0, count: 0 });
      const current = accountClasses.get(key);
      current.balance += account.balance;
      current.count += 1;
    });

    const creditAccounts = accountSummaries.filter((account) => /credit|card|loan|liability/i.test(account.accountClass || '') || account.creditLimit > 0);
    const creditLimit = creditAccounts.reduce((sum, account) => sum + account.creditLimit, 0);
    const creditUsed = creditAccounts.reduce((sum, account) => sum + Math.abs(Math.min(0, account.balance)), 0);
    const budgetActualByCategory = new Map();
    Array.from(categoryTotals.values()).forEach((category) => {
      budgetActualByCategory.set(Number(category.categoryId), category.amount);
    });

    const budgetRows = budgets.map((budget) => {
      const actual = budget.categoryId ? toNumber(budgetActualByCategory.get(Number(budget.categoryId))) : expenses;
      const planned = toNumber(budget.plannedAmount) * (!month && budget.budgetType === 'monthly' && !budget.month ? 12 : 1);
      return {
        id: budget.id,
        name: budget.name,
        month: budget.month,
        categoryId: budget.categoryId,
        categoryName: budget.Category ? budget.Category.name : '',
        plannedAmount: planned,
        actualAmount: actual,
        variance: planned - actual,
        usagePct: planned > 0 ? pct((actual / planned) * 100) : 0,
        alertThresholdPct: budget.alertThresholdPct,
        currency: budget.currency
      };
    });

    const investmentValue = holdings.reduce((sum, holding) => sum + toNumber(holding.marketValue), 0);
    const netWorth = accountSummaries.reduce((sum, account) => sum + account.netWorthValue, 0) + investmentValue;
    const cashFlow = income - expenses;
    const budgetPlanned = budgetRows.reduce((sum, row) => sum + row.plannedAmount, 0);
    const budgetUsed = budgetRows.reduce((sum, row) => sum + row.actualAmount, 0);

    res.json({
      filters: {
        year: allYears ? 'all' : year,
        month,
        accountId,
        accountClass,
        currency: currency || 'ALL',
        currencies: Array.from(new Set([
          ...accounts.map((account) => account.currency).filter(Boolean),
          ...transactions.map((tx) => tx.currency).filter(Boolean),
          'USD', 'COP', 'EUR'
        ])).sort()
      },
      summary: {
        netWorth,
        income,
        expenses,
        cashFlow,
        transfers,
        savingsRatePct: income > 0 ? pct((cashFlow / income) * 100) : 0,
        creditUtilizationPct: creditLimit > 0 ? pct((creditUsed / creditLimit) * 100) : 0,
        investmentValue,
        budgetUsagePct: budgetPlanned > 0 ? pct((budgetUsed / budgetPlanned) * 100) : 0,
        transactionCount: transactions.length,
        accountCount: accountSummaries.length
      },
      monthly,
      statementSnapshots: snapshots.map((snapshot) => ({
        id: snapshot.id,
        accountId: snapshot.accountId,
        snapshotDate: snapshot.snapshotDate,
        balance: toNumber(snapshot.balance),
        currency: snapshot.currency,
        source: snapshot.source,
        notes: snapshot.notes
      })),
      categoryTotals: Array.from(categoryTotals.values()).sort((a, b) => b.amount - a.amount).slice(0, 20),
      accountTotals: accountSummaries.sort((a, b) => Math.abs(b.balance) - Math.abs(a.balance)),
      accountClasses: Array.from(accountClasses.values()).sort((a, b) => Math.abs(b.balance) - Math.abs(a.balance)),
      budgets: budgetRows.sort((a, b) => b.usagePct - a.usagePct),
      recurring: recurring.map((row) => ({
        id: row.id,
        name: row.name,
        nextDate: row.nextDate,
        frequency: row.frequency,
        transactionType: row.transactionType,
        amount: toNumber(row.amount),
        currency: row.currency,
        accountName: row.Account ? row.Account.name : '',
        categoryName: row.Category ? row.Category.name : '',
        merchant: row.merchant || ''
      })),
      goals: goals.map((goal) => ({
        id: goal.id,
        name: goal.name,
        goalType: goal.goalType,
        targetAmount: toNumber(goal.targetAmount),
        currentAmount: toNumber(goal.currentAmount),
        progressPct: toNumber(goal.targetAmount) > 0 ? pct((toNumber(goal.currentAmount) / toNumber(goal.targetAmount)) * 100) : 0,
        currency: goal.currency,
        targetDate: goal.targetDate,
        status: goal.status,
        accountName: goal.Account ? goal.Account.name : ''
      })),
      holdings: holdings.map((holding) => ({
        id: holding.id,
        symbol: holding.symbol,
        name: holding.name,
        assetClass: holding.assetClass,
        marketValue: toNumber(holding.marketValue),
        costBasis: toNumber(holding.costBasis),
        unrealizedGain: toNumber(holding.marketValue) - toNumber(holding.costBasis),
        currency: holding.currency,
        accountName: holding.Account ? holding.Account.name : '',
        priceDate: holding.priceDate
      })),
      rates: rates.map((rate) => ({
        id: rate.id,
        rateDate: rate.rateDate,
        fromCurrency: rate.fromCurrency,
        toCurrency: rate.toCurrency,
        rate: toNumber(rate.rate),
        source: rate.source
      })),
      recentTransactions: transactions.slice(-20).reverse().map((tx) => ({
        id: tx.id,
        transactionDate: tx.transactionDate,
        accountName: tx.Account ? tx.Account.name : '',
        categoryName: tx.Category ? tx.Category.name : '',
        description: tx.description,
        merchantId: tx.merchantId,
        merchant: tx.Merchant ? tx.Merchant.officialName : tx.merchant,
        receiptMerchant: tx.receiptMerchant,
        transactionType: tx.transactionType,
        amount: toNumber(tx.amount),
        currency: tx.currency,
        status: tx.status,
        tags: tx.tags
      }))
    });
  } catch (err) {
    next(err);
  }
};

exports.search = async (req, res, next) => {
  try {
    const { where, accountWhere, merchantWhere } = transactionQueryParts(req.query);
    const exportAll = req.query.exportAll === 'true';
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = exportAll
      ? Math.min(Math.max(Number(req.query.limit) || 5000, 1), 20000)
      : Math.min(Math.max(Number(req.query.limit) || 50, 1), 500);
    const offset = exportAll ? 0 : (page - 1) * limit;
    const include = [accountInclude(accountWhere), categoryInclude(), merchantInclude(merchantWhere)];

    const result = await db.Transaction.findAndCountAll({
      where,
      include,
      distinct: true,
      order: sortOrder(req.query.sort, req.query.dir),
      limit,
      offset
    });

    let categorySummaryRows = [];
    let merchantSummaryRows = [];
    try {
      const summaries = await transactionSummarySql(req.query);
      categorySummaryRows = summaries.categorySummary;
      merchantSummaryRows = summaries.merchantSummary;
    } catch (summaryErr) {
      console.warn('[Finance] PostgreSQL summary fast path failed; falling back to Sequelize rows:', summaryErr.message);
      const summaryRows = await db.Transaction.findAll({
        where,
        include,
        order: [['transactionDate', 'DESC'], ['id', 'DESC']],
        limit: 10000
      });
      const categorySummary = new Map();
      const merchantSummary = new Map();
      summaryRows.forEach((row) => {
        const amount = Math.abs(toNumber(row.amount));
        const categoryKey = row.categoryId || 'uncategorized';
        if (!categorySummary.has(categoryKey)) {
          categorySummary.set(categoryKey, {
            categoryId: row.categoryId,
            name: row.Category ? row.Category.name : 'Uncategorized',
            groupName: row.Category ? row.Category.groupName : 'Unassigned',
            amount: 0,
            count: 0
          });
        }
        const category = categorySummary.get(categoryKey);
        category.amount += amount;
        category.count += 1;

        const merchantName = merchantDisplayName(row);
        const merchantKey = merchantFilterKey(row);
        const groupName = cleanText(row.Merchant && row.Merchant.merchantGroupName);
        if (!merchantSummary.has(merchantKey)) {
          merchantSummary.set(merchantKey, {
            merchantKey,
            merchantId: groupName ? null : (row.merchantId || null),
            groupName,
            name: merchantName,
            amount: 0,
            count: 0
          });
        }
        const merchant = merchantSummary.get(merchantKey);
        merchant.amount += amount;
        merchant.count += 1;
      });
      categorySummaryRows = Array.from(categorySummary.values()).sort((a, b) => b.count - a.count || b.amount - a.amount).slice(0, 60);
      merchantSummaryRows = Array.from(merchantSummary.values()).sort((a, b) => b.amount - a.amount).slice(0, 60);
    }

    const total = typeof result.count === 'number' ? result.count : result.count.length;
    res.json({
      count: result.rows.length,
      total,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(total / limit)),
      rows: result.rows.map(transactionDto),
      categorySummary: categorySummaryRows,
      merchantSummary: merchantSummaryRows
    });
  } catch (err) {
    next(err);
  }
};

exports.kpiDetail = async (req, res, next) => {
  try {
    const metric = cleanText(req.query.metric) || 'income';
    const transactionMetrics = new Set(['income', 'expenses', 'cashFlow', 'transfers', 'savingsRate']);
    const allYears = isAllYears(req.query.year);
    const year = allYears ? null : (Number(req.query.year) || 2026);
    const month = !allYears && req.query.month ? Number(req.query.month) : null;
    const currency = req.query.currency && req.query.currency !== 'ALL' ? cleanText(req.query.currency).toUpperCase() : null;
    const accountId = cleanId(req.query.accountId);
    const accountClass = cleanText(req.query.accountClass);
    const limit = Math.min(Math.max(Number(req.query.limit) || 20000, 1), 20000);

    if (transactionMetrics.has(metric)) {
      const detailLimit = limit;
      const { where, accountWhere, merchantWhere } = transactionQueryParts({
        ...req.query,
        status: req.query.status || ''
      });
      if (!req.query.status) where.status = { [Op.ne]: 'void' };
      const rows = await db.Transaction.findAll({
        where,
        include: [accountInclude(accountWhere), categoryInclude(), merchantInclude(merchantWhere)],
        order: [['transactionDate', 'DESC'], ['id', 'DESC']],
        limit: 20000
      });

      const filteredRows = rows.filter((row) => {
        const kind = classifyTransaction(row);
        if (metric === 'income') return kind === 'income';
        if (metric === 'expenses') return kind === 'expense';
        if (metric === 'transfers') return kind === 'transfer';
        return kind === 'income' || kind === 'expense';
      });
      const sourceMap = await importSourcesByTransactionId(filteredRows.map((row) => row.id));
      const details = filteredRows.map((row) => transactionDetailDto(row, sourceMap, metric));
      const returnedDetails = details.slice(0, detailLimit);
      const income = details.filter((row) => row.metricKind === 'income').reduce((sum, row) => sum + Math.abs(toNumber(row.amount)), 0);
      const expenses = details.filter((row) => row.metricKind === 'expense').reduce((sum, row) => sum + Math.abs(toNumber(row.amount)), 0);
      const transfers = details.filter((row) => row.metricKind === 'transfer').reduce((sum, row) => sum + Math.abs(toNumber(row.amount)), 0);
      const total = metric === 'cashFlow' || metric === 'savingsRate'
        ? income - expenses
        : metric === 'income'
          ? income
          : metric === 'expenses'
            ? expenses
            : transfers;

      return res.json({
        metric,
        detailType: 'transactions',
        title: {
          income: 'Income Detail',
          expenses: 'Expense Detail',
          cashFlow: 'Cash Flow Detail',
          transfers: 'Transfer Detail',
          savingsRate: 'Savings Rate Basis'
        }[metric],
        formula: metric === 'cashFlow'
          ? 'Income transactions minus expense transactions. Transfers are excluded.'
          : metric === 'savingsRate'
            ? 'Cash flow divided by income. Rows include the income and expense basis.'
            : metric === 'transfers'
              ? 'Internal movements, credit-card payments, and explicit transfer rows.'
              : 'Rows classified with the same KPI rules used by the dashboard.',
        filters: { year: allYears ? 'all' : year, month, accountId, accountClass, currency: currency || 'ALL' },
        summary: {
          total,
          income,
          expenses,
          cashFlow: income - expenses,
          transfers,
          savingsRatePct: income > 0 ? pct(((income - expenses) / income) * 100) : 0,
          rowCount: details.length,
          returnedRowCount: returnedDetails.length,
          sourceFileCount: new Set(details.map((row) => row.source && (row.source.originalFileName || row.source.importBatchFileName)).filter(Boolean)).size
        },
        rows: returnedDetails
      });
    }

    const [from, to] = allYears ? [null, null] : dateRange(year, month);
    const txWhere = { status: { [Op.ne]: 'void' } };
    if (!allYears) txWhere.transactionDate = { [Op.between]: [from, to] };
    if (accountId) txWhere.accountId = accountId;
    if (currency) txWhere.currency = currency;
    const reportAccountWhere = {
      ...(accountClass ? { accountClass } : {}),
      ...(currency ? { currency } : {})
    };

    if (metric === 'netWorth' || metric === 'creditUtilization') {
      const [accounts, transactions, snapshots] = await Promise.all([
        db.Account.findAll({ where: reportAccountWhere, order: [['accountClass', 'ASC'], ['name', 'ASC']] }),
        db.Transaction.findAll({ where: txWhere, include: [accountInclude(accountClass ? { accountClass } : {})] }),
        db.AccountBalanceSnapshot.findAll({
          where: {
            ...(allYears ? {} : { snapshotDate: { [Op.lte]: to } }),
            ...(accountId ? { accountId } : {}),
            ...(currency ? { currency } : {})
          },
          order: [['snapshotDate', 'DESC'], ['id', 'DESC']],
          limit: 500
        })
      ]);
      const movement = new Map();
      transactions.forEach((row) => {
        movement.set(row.accountId, toNumber(movement.get(row.accountId)) + toNumber(row.amount));
      });
      const latestSnapshotByAccount = new Map();
      snapshots.forEach((snapshot) => {
        if (!latestSnapshotByAccount.has(snapshot.accountId)) latestSnapshotByAccount.set(snapshot.accountId, snapshot);
      });
      const rows = accounts
        .filter((account) => !accountId || Number(account.id) === accountId)
        .map((account) => {
          const snapshot = latestSnapshotByAccount.get(account.id);
          const balance = snapshot ? toNumber(snapshot.balance) : toNumber(account.currentBalance || account.openingBalance) + toNumber(movement.get(account.id));
          return {
            id: account.id,
            name: account.name,
            accountCode: account.accountCode,
            accountClass: account.accountClass,
            accountSubtype: account.accountSubtype,
            accountType: account.accountType,
            currency: account.currency,
            currentBalance: toNumber(account.currentBalance),
            snapshotDate: snapshot ? snapshot.snapshotDate : '',
            snapshotSource: snapshot ? snapshot.source : '',
            periodMovement: toNumber(movement.get(account.id)),
            balance,
            netWorthValue: accountNetValue(account, balance),
            creditLimit: toNumber(account.creditLimit),
            status: account.status,
            includeInNetWorth: account.includeInNetWorth !== false
          };
        })
        .filter((row) => metric === 'netWorth' || /credit|card|loan|liability/i.test(`${row.accountClass} ${row.accountType}`) || row.creditLimit > 0);
      const creditLimit = rows.reduce((sum, row) => sum + toNumber(row.creditLimit), 0);
      const creditUsed = rows.reduce((sum, row) => sum + Math.abs(Math.min(0, toNumber(row.balance))), 0);
      return res.json({
        metric,
        detailType: 'accounts',
        title: metric === 'netWorth' ? 'Net Worth Detail' : 'Credit Utilization Detail',
        formula: metric === 'netWorth'
          ? 'Eligible account balances from the latest statement snapshot available for the selected period, using liability sign rules.'
          : 'Credit used from the latest statement snapshot available for the selected period divided by credit limit.',
        filters: { year: allYears ? 'all' : year, month, accountId, accountClass, currency: currency || 'ALL' },
        summary: {
          total: metric === 'netWorth' ? rows.reduce((sum, row) => sum + toNumber(row.netWorthValue), 0) : (creditLimit > 0 ? pct((creditUsed / creditLimit) * 100) : 0),
          creditLimit,
          creditUsed,
          rowCount: rows.length
        },
        rows
      });
    }

    if (metric === 'investments') {
      const rows = await db.InvestmentHolding.findAll({
        where: currency ? { currency } : {},
        include: [{ model: db.Account, attributes: ['id', 'name', 'accountClass', 'currency'], required: false }],
        order: [['assetClass', 'ASC'], ['symbol', 'ASC']]
      });
      const details = rows.map((row) => ({
        id: row.id,
        symbol: row.symbol,
        name: row.name,
        assetClass: row.assetClass,
        quantity: toNumber(row.quantity),
        costBasis: toNumber(row.costBasis),
        marketValue: toNumber(row.marketValue),
        unrealizedGain: toNumber(row.marketValue) - toNumber(row.costBasis),
        currency: row.currency,
        priceDate: row.priceDate,
        accountName: row.Account ? row.Account.name : ''
      }));
      return res.json({
        metric,
        detailType: 'holdings',
        title: 'Investment Detail',
        formula: 'Sum of investment holding market values.',
        filters: { year: allYears ? 'all' : year, month, accountId, accountClass, currency: currency || 'ALL' },
        summary: { total: details.reduce((sum, row) => sum + row.marketValue, 0), rowCount: details.length },
        rows: details
      });
    }

    if (metric === 'budgetUsed') {
      const [budgets, transactions] = await Promise.all([
        db.Budget.findAll({
          where: {
            ...(allYears ? {} : { year }),
            isActive: true,
            ...(month ? { [Op.or]: [{ month }, { month: null }] } : {}),
            ...(currency ? { currency } : {})
          },
          include: [{ model: db.Category, attributes: ['id', 'name', 'groupName', 'categoryType'], required: false }],
          order: [['month', 'ASC'], ['name', 'ASC']]
        }),
        db.Transaction.findAll({ where: txWhere, include: [categoryInclude(), accountInclude(accountClass ? { accountClass } : {})], limit: 20000 })
      ]);
      const actualByCategory = new Map();
      transactions.forEach((row) => {
        if (classifyTransaction(row) !== 'expense') return;
        const key = row.categoryId || 'uncategorized';
        actualByCategory.set(key, toNumber(actualByCategory.get(key)) + Math.abs(toNumber(row.amount)));
      });
      const expenseTotal = Array.from(actualByCategory.values()).reduce((sum, value) => sum + toNumber(value), 0);
      const details = budgets.map((budget) => {
        const planned = toNumber(budget.plannedAmount) * (!month && budget.budgetType === 'monthly' && !budget.month ? 12 : 1);
        const actual = budget.categoryId ? toNumber(actualByCategory.get(Number(budget.categoryId))) : expenseTotal;
        return {
          id: budget.id,
          name: budget.name,
          year: budget.year,
          month: budget.month,
          categoryName: budget.Category ? budget.Category.name : '',
          categoryGroup: budget.Category ? budget.Category.groupName : '',
          plannedAmount: planned,
          actualAmount: actual,
          variance: planned - actual,
          usagePct: planned > 0 ? pct((actual / planned) * 100) : 0,
          currency: budget.currency
        };
      });
      const plannedTotal = details.reduce((sum, row) => sum + row.plannedAmount, 0);
      const actualTotal = details.reduce((sum, row) => sum + row.actualAmount, 0);
      return res.json({
        metric,
        detailType: 'budgets',
        title: 'Budget Usage Detail',
        formula: 'Actual expense rows divided by planned budget rows.',
        filters: { year: allYears ? 'all' : year, month, accountId, accountClass, currency: currency || 'ALL' },
        summary: {
          total: plannedTotal > 0 ? pct((actualTotal / plannedTotal) * 100) : 0,
          plannedTotal,
          actualTotal,
          rowCount: details.length
        },
        rows: details
      });
    }

    res.status(400).json({ error: 'Unknown KPI metric.' });
  } catch (err) {
    next(err);
  }
};

exports.trends = async (req, res, next) => {
  try {
    const groupBy = ['account', 'merchant', 'category', 'total'].includes(req.query.groupBy) ? req.query.groupBy : 'category';
    const grain = ['day', 'week', 'month', 'year'].includes(req.query.grain) ? req.query.grain : 'month';
    const measure = ['income', 'expense', 'transfer', 'net'].includes(req.query.measure) ? req.query.measure : 'expense';
    const calendarMode = req.query.calendar === 'active' ? 'active' : 'range';
    const { where, accountWhere, merchantWhere } = transactionQueryParts({
      ...req.query,
      status: req.query.status || ''
    });
    if (!req.query.status) where.status = { [Op.ne]: 'void' };
    const rows = await db.Transaction.findAll({
      where,
      include: [accountInclude(accountWhere), categoryInclude(), merchantInclude(merchantWhere)],
      order: [['transactionDate', 'ASC'], ['id', 'ASC']],
      limit: 20000
    });

    function timeBucket(dateValue) {
      return bucketDate(dateValue, grain);
    }

    function bucketLabel(value) {
      if (grain === 'week') {
        const start = new Date(value + 'T00:00:00Z');
        if (Number.isNaN(start.getTime())) return value;
        const end = new Date(start);
        end.setUTCDate(end.getUTCDate() + 6);
        if (calendarMode === 'active') return `${isoDay(start)} -> ${isoDay(end)}`;
        const selectedStart = parseIsoDay(req.query.from);
        const selectedEnd = parseIsoDay(req.query.to);
        const displayStart = selectedStart && selectedStart > start ? selectedStart : start;
        const displayEnd = selectedEnd && selectedEnd < end ? selectedEnd : end;
        return `${isoDay(displayStart)} -> ${isoDay(displayEnd)}`;
      }
      return value;
    }

    const labels = calendarMode === 'active' ? buildActiveTrendBuckets(rows, grain) : buildTrendBuckets(req.query, rows, grain);
    const labelIndex = new Map(labels.map((label, index) => [label, index]));
    const groups = new Map();
    rows.forEach((row) => {
      const kind = classifyTransaction(row);
      if (measure !== 'net' && kind !== measure) return;
      const label = timeBucket(row.transactionDate);
      const bucketIndex = labelIndex.get(label);
      if (bucketIndex == null) return;
      const amount = measure === 'net' ? toNumber(row.amount) : Math.abs(toNumber(row.amount));
      const name = groupBy === 'total'
        ? 'All merchants'
        : groupBy === 'merchant'
        ? merchantDisplayName(row)
        : groupBy === 'account'
          ? (row.Account ? row.Account.name : 'Unassigned account')
          : (row.Category ? row.Category.name : 'Uncategorized');
      const key = groupBy === 'total'
        ? 'total'
        : groupBy === 'merchant'
        ? merchantFilterKey(row)
        : groupBy === 'account'
          ? `account:${row.accountId || 'uncategorized'}`
        : merchantCategorizer.normalize(name) || 'uncategorized';
      if (!groups.has(key)) groups.set(key, { key, name, total: 0, values: Array(labels.length).fill(0) });
      const group = groups.get(key);
      group.values[bucketIndex] += amount;
      group.total += Math.abs(amount);
    });

    const series = Array.from(groups.values())
      .sort((a, b) => b.total - a.total)
      .slice(0, Math.min(Math.max(Number(req.query.top) || 8, 1), 15));
    res.json({ labels: labels.map(bucketLabel), groupBy, measure, grain, calendar: calendarMode, series });
  } catch (err) {
    next(err);
  }
};

exports.statementReconciliationSuggestions = async (req, res, next) => {
  try {
    const replacements = {
      limit: Math.min(Math.max(Number(req.query.limit) || 80, 1), 300)
    };
    const clauses = [
      `s."source" IN ('statement_sync', 'statement_import_checkpoint')`
    ];
    if (req.query.accountId) {
      replacements.accountId = Number(req.query.accountId);
      clauses.push('s."accountId" = :accountId');
    }
    if (req.query.currency && req.query.currency !== 'ALL') {
      replacements.currency = cleanText(req.query.currency).toUpperCase();
      clauses.push('s."currency" = :currency');
    }
    if (req.query.from) {
      replacements.from = cleanText(req.query.from).slice(0, 10);
      clauses.push('s."snapshotDate" >= :from');
    }
    if (req.query.to) {
      replacements.to = cleanText(req.query.to).slice(0, 10);
      clauses.push('s."snapshotDate" <= :to');
    }
    const sql = `
      WITH checkpoints AS (
        SELECT
          s."id",
          s."accountId",
          a."name" AS "accountName",
          a."accountCode",
          a."accountClass",
          s."snapshotDate",
          s."balance"::numeric AS "statementBalance",
          s."currency",
          s."source",
          s."notes",
          LAG(s."snapshotDate") OVER (PARTITION BY s."accountId" ORDER BY s."snapshotDate", s."id") AS "priorDate",
          LAG(s."balance"::numeric) OVER (PARTITION BY s."accountId" ORDER BY s."snapshotDate", s."id") AS "priorBalance"
        FROM "AccountBalanceSnapshots" s
        JOIN "Accounts" a ON a."id" = s."accountId"
        WHERE ${clauses.join(' AND ')}
      )
      SELECT
        c.*,
        COALESCE(tx."transactionSum", 0)::float AS "transactionSum",
        COALESCE(tx."transactionCount", 0)::int AS "transactionCount",
        CASE WHEN c."priorDate" IS NULL THEN NULL ELSE (c."priorBalance" + COALESCE(tx."transactionSum", 0))::float END AS "bookBalance",
        CASE WHEN c."priorDate" IS NULL THEN NULL ELSE (c."statementBalance" - (c."priorBalance" + COALESCE(tx."transactionSum", 0)))::float END AS "difference"
      FROM checkpoints c
      LEFT JOIN LATERAL (
        SELECT SUM(t."amount"::numeric) AS "transactionSum", COUNT(*) AS "transactionCount"
        FROM "Transactions" t
        WHERE t."accountId" = c."accountId"
          AND t."status" <> 'void'
          AND c."priorDate" IS NOT NULL
          AND t."transactionDate" > c."priorDate"
          AND t."transactionDate" <= c."snapshotDate"
      ) tx ON true
      ORDER BY c."snapshotDate" DESC, c."accountName" ASC
      LIMIT :limit
    `;
    const rows = await db.sequelize.query(sql, { replacements, type: db.Sequelize.QueryTypes.SELECT });
    res.json({
      count: rows.length,
      rows: rows.map((row) => {
        const notes = cleanText(row.notes);
        const fileMatch = notes.match(/from\s+([^;]+?\.pdf)/i);
        const batchMatch = notes.match(/batches\s+([0-9,\s]+)/i);
        const hasPrior = !!row.priorDate;
        const difference = row.difference == null ? null : toNumber(row.difference);
        return {
          accountId: row.accountId,
          accountName: row.accountName,
          accountCode: row.accountCode,
          accountClass: row.accountClass,
          periodStart: hasPrior ? addIsoDays(row.priorDate, 1) : '',
          periodEnd: row.snapshotDate,
          priorCutoffDate: row.priorDate || '',
          priorBalance: row.priorBalance == null ? null : toNumber(row.priorBalance),
          statementBalance: toNumber(row.statementBalance),
          bookBalance: row.bookBalance == null ? null : toNumber(row.bookBalance),
          difference,
          transactionSum: toNumber(row.transactionSum),
          transactionCount: Number(row.transactionCount || 0),
          currency: row.currency,
          source: row.source,
          sourceFile: fileMatch ? fileMatch[1].trim() : '',
          sourceBatches: batchMatch ? batchMatch[1].replace(/\s+/g, '') : '',
          status: !hasPrior ? 'baseline' : Math.abs(difference) <= 0.01 ? 'matched' : 'review'
        };
      })
    });
  } catch (err) {
    next(err);
  }
};

exports.statementReconciliationDetail = async (req, res, next) => {
  try {
    const accountId = cleanId(req.query.accountId);
    const periodStart = cleanText(req.query.periodStart).slice(0, 10);
    const periodEnd = cleanText(req.query.periodEnd).slice(0, 10);
    if (!accountId || !/^\d{4}-\d{2}-\d{2}$/.test(periodStart) || !/^\d{4}-\d{2}-\d{2}$/.test(periodEnd)) {
      return res.status(400).json({ error: 'accountId, periodStart, and periodEnd are required.' });
    }

    const account = await db.Account.findByPk(accountId);
    if (!account) return res.status(404).json({ error: 'Account not found.' });

    const [priorSnapshot, currentSnapshot, transactions] = await Promise.all([
      db.AccountBalanceSnapshot.findOne({
        where: {
          accountId,
          source: { [Op.in]: ['statement_sync', 'statement_import_checkpoint'] },
          snapshotDate: { [Op.lt]: periodEnd }
        },
        order: [['snapshotDate', 'DESC'], ['id', 'DESC']]
      }),
      db.AccountBalanceSnapshot.findOne({
        where: {
          accountId,
          source: { [Op.in]: ['statement_sync', 'statement_import_checkpoint'] },
          snapshotDate: periodEnd
        },
        order: [['id', 'DESC']]
      }),
      db.Transaction.findAll({
        where: {
          accountId,
          status: { [Op.ne]: 'void' },
          transactionDate: { [Op.between]: [periodStart, periodEnd] }
        },
        include: [accountInclude(), categoryInclude(), merchantInclude()],
        order: [['transactionDate', 'ASC'], ['id', 'ASC']]
      })
    ]);

    const transactionSum = transactions.reduce((sum, row) => sum + toNumber(row.amount), 0);
    const priorBalance = priorSnapshot ? toNumber(priorSnapshot.balance) : null;
    const statementBalance = currentSnapshot ? toNumber(currentSnapshot.balance) : null;
    const bookBalance = priorBalance == null ? null : priorBalance + transactionSum;
    const difference = statementBalance == null || bookBalance == null ? null : statementBalance - bookBalance;
    const sourceMap = await importSourcesByTransactionId(transactions.map((row) => row.id));

    const notes = cleanText(currentSnapshot && currentSnapshot.notes);
    const batchMatch = notes.match(/batches\s+([0-9,\s]+)/i);
    const batchIds = batchMatch ? batchMatch[1].split(',').map((id) => cleanId(id)).filter(Boolean) : [];
    const stagedRows = batchIds.length ? await db.ImportRow.findAll({
      where: { importBatchId: { [Op.in]: batchIds } },
      include: [{ model: db.ImportBatch, attributes: ['id', 'fileName', 'notes'], required: false }],
      order: [['importBatchId', 'ASC'], ['rowNumber', 'ASC']],
      limit: 1000
    }) : [];

    res.json({
      account: {
        id: account.id,
        name: account.name,
        accountCode: account.accountCode,
        accountClass: account.accountClass,
        currency: account.currency
      },
      periodStart,
      periodEnd,
      priorSnapshot: priorSnapshot ? {
        snapshotDate: priorSnapshot.snapshotDate,
        balance: priorBalance,
        source: priorSnapshot.source
      } : null,
      currentSnapshot: currentSnapshot ? {
        snapshotDate: currentSnapshot.snapshotDate,
        balance: statementBalance,
        source: currentSnapshot.source,
        notes: currentSnapshot.notes
      } : null,
      summary: {
        priorBalance,
        transactionSum,
        statementBalance,
        bookBalance,
        difference,
        transactionCount: transactions.length,
        stagedRowCount: stagedRows.length,
        sourceBatchIds: batchIds
      },
      transactions: transactions.map((row) => transactionDetailDto(row, sourceMap, 'cashFlow')),
      stagedRows: stagedRows.map((row) => {
        const raw = row.rawData || {};
        const normalized = row.normalizedData || {};
        return {
          id: row.id,
          importBatchId: row.importBatchId,
          batchFileName: row.ImportBatch ? row.ImportBatch.fileName : '',
          rowNumber: row.rowNumber,
          status: row.status,
          date: raw.postDate || normalized.transactionDate || raw.transactionDate || '',
          description: raw.description || normalized.description || '',
          merchant: normalized.merchant || raw.merchant || '',
          amount: raw.amount != null ? toNumber(raw.amount) : toNumber(normalized.amount),
          postedTransactionId: row.postedTransactionId,
          errorMessage: row.errorMessage || ''
        };
      })
    });
  } catch (err) {
    next(err);
  }
};

exports.bulkCategory = async (req, res, next) => {
  try {
    const ids = Array.isArray(req.body.ids) ? req.body.ids.map(cleanId).filter(Boolean) : [];
    if (!ids.length) return res.status(400).json({ error: 'Select at least one transaction.' });
    const categoryId = req.body.categoryId === null || req.body.categoryId === '' ? null : cleanId(req.body.categoryId);
    if (categoryId) {
      const category = await db.Category.findByPk(categoryId);
      if (!category) return res.status(404).json({ error: 'Category not found.' });
    }
    const payload = { categoryId };
    if (req.body.transactionType && ['income', 'expense', 'transfer', 'adjustment'].includes(req.body.transactionType)) {
      payload.transactionType = req.body.transactionType;
    }
    const [updated] = await db.Transaction.update(payload, { where: { id: { [Op.in]: ids } } });
    res.json({ ok: true, updated });
  } catch (err) {
    next(err);
  }
};

exports.autoCategorize = async (req, res, next) => {
  try {
    const ids = Array.isArray(req.body.ids) ? req.body.ids.map(cleanId).filter(Boolean) : [];
    const onlyUncategorized = req.body.onlyUncategorized !== false;
    const limit = Math.min(Math.max(Number(req.body.limit) || 500, 1), 2000);
    const forceGroup = cleanText(req.body.forceGroup);
    const where = {};
    if (ids.length) where.id = { [Op.in]: ids };
    if (onlyUncategorized) where.categoryId = { [Op.is]: null };

    const [categories, customRules, rows] = await Promise.all([
      db.Category.findAll({ where: { isActive: { [Op.ne]: false } }, order: [['groupName', 'ASC'], ['name', 'ASC']] }),
      getStoredMerchantRules(),
      db.Transaction.findAll({ where, include: [merchantInclude()], order: [['transactionDate', 'DESC'], ['id', 'DESC']], limit })
    ]);

    const result = { scanned: rows.length, applied: 0, skipped: 0, suggestions: [] };
    await db.sequelize.transaction(async (transaction) => {
        for (const row of rows) {
          const suggestion = merchantCategorizer.suggestFromRules({
            text: [
              row.Merchant ? row.Merchant.officialName : row.merchant,
              row.receiptMerchant,
              row.description,
              row.normalizedMerchant,
              row.memo,
              row.tags,
              forceGroup
            ].join(' '),
            categories,
            customRules,
            transactionType: row.transactionType
          });
          if (!suggestion || !suggestion.categoryId) {
          result.skipped += 1;
          continue;
        }
          await row.update({
            categoryId: suggestion.categoryId,
            transactionType: suggestion.transactionType || row.transactionType
          }, { transaction });
        result.applied += 1;
        result.suggestions.push({
          id: row.id,
          merchant: row.Merchant ? row.Merchant.officialName : (row.merchant || row.description),
          receiptMerchant: row.receiptMerchant,
          categoryId: suggestion.categoryId,
          categoryName: suggestion.categoryName,
          confidence: suggestion.confidence,
          source: suggestion.source,
          matchedPattern: suggestion.matchedPattern
        });
      }
    });
    res.json({ ok: true, ...result });
  } catch (err) {
    next(err);
  }
};
