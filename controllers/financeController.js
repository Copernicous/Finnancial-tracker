'use strict';

const db = require('../models');
const { Op } = require('sequelize');

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
    const currency = req.query.currency && req.query.currency !== 'ALL' ? String(req.query.currency) : null;
    const [from, to] = dateRange(year, month);

    const txWhere = {
      transactionDate: { [Op.between]: [from, to] },
      status: { [Op.ne]: 'void' }
    };
    if (accountId) txWhere.accountId = accountId;
    if (currency) txWhere.currency = currency;

    const [accounts, categories, transactions, budgets, recurring, goals, holdings, snapshots, rates] = await Promise.all([
      db.Account.findAll({ order: [['accountClass', 'ASC'], ['name', 'ASC']] }),
      db.Category.findAll({ order: [['groupName', 'ASC'], ['name', 'ASC']] }),
      db.Transaction.findAll({
        where: txWhere,
        include: [
          { model: db.Account, attributes: ['id', 'name', 'accountClass', 'accountSubtype', 'currency'] },
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
    const where = {};
    const q = String(req.query.q || '').trim();
    const limit = Math.min(Number(req.query.limit) || 250, 500);

    if (req.query.accountId) where.accountId = Number(req.query.accountId);
    if (req.query.categoryId) where.categoryId = Number(req.query.categoryId);
    if (req.query.type) where.transactionType = String(req.query.type);
    if (req.query.status) where.status = String(req.query.status);
    if (req.query.currency && req.query.currency !== 'ALL') where.currency = String(req.query.currency);
    if (req.query.from || req.query.to) {
      where.transactionDate = {};
      if (req.query.from) where.transactionDate[Op.gte] = req.query.from;
      if (req.query.to) where.transactionDate[Op.lte] = req.query.to;
    }
    if (req.query.min || req.query.max) {
      where.amount = {};
      if (req.query.min) where.amount[Op.gte] = Number(req.query.min);
      if (req.query.max) where.amount[Op.lte] = Number(req.query.max);
    }
    if (req.query.tag) {
      where.tags = { [Op.iLike]: `%${String(req.query.tag).trim()}%` };
    }
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

    const rows = await db.Transaction.findAll({
      where,
      include: [
        { model: db.Account, attributes: ['id', 'name', 'accountClass', 'currency'] },
        { model: db.Category, attributes: ['id', 'name', 'groupName', 'categoryType'] }
      ],
      order: [['transactionDate', 'DESC'], ['id', 'DESC']],
      limit
    });

    res.json({
      count: rows.length,
      rows: rows.map((row) => ({
        id: row.id,
        transactionDate: row.transactionDate,
        accountId: row.accountId,
        accountName: row.Account ? row.Account.name : '',
        categoryId: row.categoryId,
        categoryName: row.Category ? row.Category.name : '',
        description: row.description,
        merchant: row.merchant,
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
        memo: row.memo
      }))
    });
  } catch (err) {
    next(err);
  }
};
