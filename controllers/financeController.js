'use strict';

const db = require('../models');
const { Op } = require('sequelize');
const merchantCategorizer = require('../services/merchantCategorizer');

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

function cleanText(value) {
  return String(value == null ? '' : value).trim();
}

function cleanId(value) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
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

async function getStoredMerchantRules() {
  const row = await db.SystemSetting.findOne({ where: { key: 'merchant_category_rules' } });
  const rules = parseJsonField(row && row.value, []);
  return Array.isArray(rules) ? rules : [];
}

function pickDateWhere(query, defaultYear = 2026) {
  const year = Number(query.year) || defaultYear;
  const month = query.month ? Number(query.month) : null;
  const where = {};
  if (query.from || query.to) {
    if (query.from) where[Op.gte] = query.from;
    if (query.to) where[Op.lte] = query.to;
    return Object.keys(where).length ? where : null;
  }
  const [from, to] = dateRange(year, month);
  return { [Op.between]: [from, to] };
}

function transactionQueryParts(query, options = {}) {
  const where = {};
  const accountWhere = {};
  const q = cleanText(query.q);

  const dateWhere = pickDateWhere(query, options.defaultYear || 2026);
  if (dateWhere) where.transactionDate = dateWhere;

  if (query.accountId) where.accountId = Number(query.accountId);
  if (query.categoryId === 'uncategorized' || query.categoryId === 'none') {
    where.categoryId = { [Op.is]: null };
  } else if (query.categoryId) {
    where.categoryId = Number(query.categoryId);
  }
  if (query.type) where.transactionType = cleanText(query.type);
  if (query.status) where.status = cleanText(query.status);
  if (query.currency && query.currency !== 'ALL') where.currency = cleanText(query.currency).toUpperCase();
  if (query.sourceType) where.sourceType = cleanText(query.sourceType);
  if (query.onlyUncategorized === 'true' || query.onlyUncategorized === true) where.categoryId = { [Op.is]: null };
  if (query.min || query.max) {
    where.amount = {};
    if (query.min) where.amount[Op.gte] = Number(query.min);
    if (query.max) where.amount[Op.lte] = Number(query.max);
  }
  if (query.tag) where.tags = { [Op.iLike]: `%${cleanText(query.tag)}%` };
  if (q) {
    where[Op.or] = [
      { description: { [Op.iLike]: `%${q}%` } },
      { merchant: { [Op.iLike]: `%${q}%` } },
      { normalizedMerchant: { [Op.iLike]: `%${q}%` } },
      { referenceNumber: { [Op.iLike]: `%${q}%` } },
      { memo: { [Op.iLike]: `%${q}%` } },
      { tags: { [Op.iLike]: `%${q}%` } }
    ];
  }

  if (query.accountClass) accountWhere.accountClass = cleanText(query.accountClass);
  if (query.accountType) accountWhere.accountType = cleanText(query.accountType);

  return { where, accountWhere };
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

function sortOrder(sortKey, sortDir) {
  const dir = String(sortDir || '').toLowerCase() === 'asc' ? 'ASC' : 'DESC';
  const direct = {
    transactionDate: ['transactionDate', dir],
    merchant: ['merchant', dir],
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
  return [direct[sortKey] || ['transactionDate', 'DESC'], ['id', 'DESC']];
}

function transactionDto(row) {
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
    relatedAccountId: row.relatedAccountId,
    description: row.description,
    merchant: row.merchant,
    normalizedMerchant: row.normalizedMerchant,
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

function classifyTransaction(row) {
  const amount = toNumber(row.amount);
  const type = String(row.transactionType || '').toLowerCase();
  if (type === 'income') return 'income';
  if (type === 'expense') return 'expense';
  if (type === 'transfer') return 'transfer';
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

exports.overview = async (req, res, next) => {
  try {
    const year = Number(req.query.year) || 2026;
    const month = req.query.month ? Number(req.query.month) : null;
    const accountId = req.query.accountId ? Number(req.query.accountId) : null;
    const accountClass = cleanText(req.query.accountClass);
    const currency = req.query.currency && req.query.currency !== 'ALL' ? String(req.query.currency) : null;
    const [from, to] = dateRange(year, month);

    const txWhere = {
      transactionDate: { [Op.between]: [from, to] },
      status: { [Op.ne]: 'void' }
    };
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
          { model: db.Category, attributes: ['id', 'name', 'groupName', 'categoryType'] }
        ],
        order: [['transactionDate', 'ASC'], ['id', 'ASC']]
      }),
      db.Budget.findAll({
        where: {
          year,
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
          snapshotDate: { [Op.lte]: to },
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
    const monthly = Array.from({ length: 12 }, (_, idx) => ({
      month: idx + 1,
      label: `${year}-${String(idx + 1).padStart(2, '0')}`,
      income: 0,
      expenses: 0,
      transfers: 0,
      net: 0
    }));
    const accountMovement = new Map();
    const categoryTotals = new Map();
    let income = 0;
    let expenses = 0;
    let transfers = 0;

    transactions.forEach((tx) => {
      const amount = toNumber(tx.amount);
      const kind = classifyTransaction(tx);
      const monthIndex = Math.max(0, Math.min(11, Number(String(tx.transactionDate).slice(5, 7)) - 1));
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
        const balance = snapshot ? toNumber(snapshot.balance) : toNumber(account.currentBalance || account.openingBalance) + toNumber(accountMovement.get(account.id));
        return {
          id: account.id,
          name: accountLabel(account),
          accountClass: account.accountClass || 'banking',
          accountSubtype: account.accountSubtype || '',
          currency: account.currency,
          status: account.status,
          balance,
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
        year,
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
        merchant: tx.merchant,
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
    const { where, accountWhere } = transactionQueryParts(req.query);
    const exportAll = req.query.exportAll === 'true';
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = exportAll
      ? Math.min(Math.max(Number(req.query.limit) || 5000, 1), 20000)
      : Math.min(Math.max(Number(req.query.limit) || 50, 1), 500);
    const offset = exportAll ? 0 : (page - 1) * limit;
    const include = [accountInclude(accountWhere), categoryInclude()];

    const result = await db.Transaction.findAndCountAll({
      where,
      include,
      distinct: true,
      order: sortOrder(req.query.sort, req.query.dir),
      limit,
      offset
    });

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

      const merchantName = cleanText(row.merchant || row.normalizedMerchant || row.description) || 'No merchant';
      const merchantKey = merchantCategorizer.normalize(merchantName);
      if (!merchantSummary.has(merchantKey)) {
        merchantSummary.set(merchantKey, { name: merchantName, amount: 0, count: 0 });
      }
      const merchant = merchantSummary.get(merchantKey);
      merchant.amount += amount;
      merchant.count += 1;
    });

    const total = typeof result.count === 'number' ? result.count : result.count.length;
    res.json({
      count: result.rows.length,
      total,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(total / limit)),
      rows: result.rows.map(transactionDto),
      categorySummary: Array.from(categorySummary.values()).sort((a, b) => b.count - a.count || b.amount - a.amount).slice(0, 60),
      merchantSummary: Array.from(merchantSummary.values()).sort((a, b) => b.amount - a.amount).slice(0, 60)
    });
  } catch (err) {
    next(err);
  }
};

exports.trends = async (req, res, next) => {
  try {
    const groupBy = req.query.groupBy === 'merchant' ? 'merchant' : 'category';
    const measure = ['income', 'expense', 'transfer', 'net'].includes(req.query.measure) ? req.query.measure : 'expense';
    const { where, accountWhere } = transactionQueryParts({
      ...req.query,
      status: req.query.status || ''
    });
    if (!req.query.status) where.status = { [Op.ne]: 'void' };
    const rows = await db.Transaction.findAll({
      where,
      include: [accountInclude(accountWhere), categoryInclude()],
      order: [['transactionDate', 'ASC'], ['id', 'ASC']],
      limit: 20000
    });

    const labels = Array.from(new Set(rows.map((row) => String(row.transactionDate).slice(0, 7)))).sort();
    const labelIndex = new Map(labels.map((label, index) => [label, index]));
    const groups = new Map();
    rows.forEach((row) => {
      const kind = classifyTransaction(row);
      if (measure !== 'net' && kind !== measure) return;
      const label = String(row.transactionDate).slice(0, 7);
      const amount = measure === 'net' ? toNumber(row.amount) : Math.abs(toNumber(row.amount));
      const name = groupBy === 'merchant'
        ? (cleanText(row.merchant || row.normalizedMerchant || row.description) || 'No merchant')
        : (row.Category ? row.Category.name : 'Uncategorized');
      const key = merchantCategorizer.normalize(name) || 'uncategorized';
      if (!groups.has(key)) groups.set(key, { key, name, total: 0, values: Array(labels.length).fill(0) });
      const group = groups.get(key);
      group.values[labelIndex.get(label)] += amount;
      group.total += Math.abs(amount);
    });

    const series = Array.from(groups.values())
      .sort((a, b) => b.total - a.total)
      .slice(0, Math.min(Math.max(Number(req.query.top) || 8, 1), 15));
    res.json({ labels, groupBy, measure, series });
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
    const where = {};
    if (ids.length) where.id = { [Op.in]: ids };
    if (onlyUncategorized) where.categoryId = { [Op.is]: null };

    const [categories, customRules, rows] = await Promise.all([
      db.Category.findAll({ where: { isActive: { [Op.ne]: false } }, order: [['groupName', 'ASC'], ['name', 'ASC']] }),
      getStoredMerchantRules(),
      db.Transaction.findAll({ where, order: [['transactionDate', 'DESC'], ['id', 'DESC']], limit })
    ]);

    const result = { scanned: rows.length, applied: 0, skipped: 0, suggestions: [] };
    await db.sequelize.transaction(async (transaction) => {
      for (const row of rows) {
        const suggestion = merchantCategorizer.suggestFromRules({
          text: [row.merchant, row.description, row.normalizedMerchant, row.memo, row.tags].join(' '),
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
          merchant: row.merchant || row.description,
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
