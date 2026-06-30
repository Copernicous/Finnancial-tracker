const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const rbac = require('../middleware/rbac');
const db = require('../models');
const { Op } = require('sequelize');
const packageInfo = require('../package.json');
const userController = require('../controllers/userController');
const roleController = require('../controllers/roleController');
const auditLogController = require('../controllers/auditLogController');
const errorLogController = require('../controllers/errorLogController');
const snapshotController = require('../controllers/snapshotController');
const settingsController = require('../controllers/settingsController');
const apiKeyController = require('../controllers/apiKeyController');
const financeController = require('../controllers/financeController');
const importController = require('../controllers/importController');
const adminController = require('../controllers/adminController');
const backupService = require('../services/backupService');
const merchantResolver = require('../services/merchantResolver');

router.get('/version', (req, res) => {
  res.json({
    version: packageInfo.version,
    name: packageInfo.description || 'Home Accounting',
    node: process.version,
    uptime: Math.floor(process.uptime()),
    buildDate: new Date().toISOString().slice(0, 10)
  });
});

router.use(auth);

function pick(body, allowed) {
  const out = {};
  allowed.forEach((key) => {
    if (Object.prototype.hasOwnProperty.call(body, key)) out[key] = body[key];
  });
  return out;
}

function crud(path, modelName, moduleKey, fields, options = {}) {
  router.get(path, rbac.requirePermission(moduleKey, 'read'), async (req, res) => {
    const rows = await db[modelName].findAll({ order: options.order || [['id', 'ASC']] });
    res.json(rows);
  });

  router.get(`${path}/:id`, rbac.requirePermission(moduleKey, 'read'), async (req, res) => {
    const row = await db[modelName].findByPk(req.params.id);
    if (!row) return res.status(404).json({ error: 'Record not found' });
    res.json(row);
  });

  router.post(path, rbac.requirePermission(moduleKey, 'add'), async (req, res) => {
    const payload = pick(req.body, fields);
    if (modelName === 'Transaction') {
      Object.assign(payload, await merchantResolver.merchantPayload(payload.receiptMerchant || payload.merchant || payload.description));
    } else if (modelName === 'Merchant') {
      payload.normalizedName = merchantResolver.normalizeMerchantKey(payload.normalizedName || payload.officialName);
    } else if (modelName === 'MerchantAlias') {
      payload.normalizedAlias = merchantResolver.normalizeMerchantKey(payload.normalizedAlias || payload.aliasText);
    }
    const row = await db[modelName].create(payload);
    res.status(201).json(row);
  });

  router.put(`${path}/:id`, rbac.requirePermission(moduleKey, 'edit'), async (req, res) => {
    const row = await db[modelName].findByPk(req.params.id);
    if (!row) return res.status(404).json({ error: 'Record not found' });
    const payload = pick(req.body, fields);
    if (modelName === 'Transaction' && (payload.merchant || payload.receiptMerchant || payload.description)) {
      Object.assign(payload, await merchantResolver.merchantPayload(payload.receiptMerchant || payload.merchant || payload.description));
    } else if (modelName === 'Merchant' && (payload.officialName || payload.normalizedName)) {
      payload.normalizedName = merchantResolver.normalizeMerchantKey(payload.normalizedName || payload.officialName);
    } else if (modelName === 'MerchantAlias' && (payload.aliasText || payload.normalizedAlias)) {
      payload.normalizedAlias = merchantResolver.normalizeMerchantKey(payload.normalizedAlias || payload.aliasText);
    }
    await row.update(payload);
    res.json(row);
  });

  router.delete(`${path}/:id`, rbac.requirePermission(moduleKey, 'delete'), async (req, res) => {
    const row = await db[modelName].findByPk(req.params.id);
    if (!row) return res.status(404).json({ error: 'Record not found' });
    await row.destroy();
    res.json({ ok: true });
  });
}

crud('/financial-institutions', 'FinancialInstitution', 'financial_institutions', [
  'name', 'institutionType', 'website', 'contactInfo', 'notes', 'isActive'
]);
crud('/accounts', 'Account', 'accounts', [
  'name', 'accountCode', 'accountType', 'currency', 'financialInstitutionId',
  'accountClass', 'accountSubtype', 'openingBalance', 'openingBalanceDate',
  'currentBalance', 'creditLimit', 'interestRate', 'includeInNetWorth',
  'status', 'notes', 'isSimulation'
]);
crud('/categories', 'Category', 'categories', [
  'name', 'categoryType', 'groupName', 'budgetBehavior', 'parentId', 'taxRelevant', 'isActive'
]);
crud('/merchants', 'Merchant', 'merchants', [
  'officialName', 'normalizedName', 'merchantGroupName', 'merchantType', 'website', 'defaultCategoryId',
  'defaultTransactionType', 'notes', 'isActive', 'lastSeenAt'
], { order: [['officialName', 'ASC']] });
crud('/merchant-aliases', 'MerchantAlias', 'merchant_aliases', [
  'merchantId', 'aliasText', 'normalizedAlias', 'matchType', 'priority', 'source', 'notes', 'isActive'
], { order: [['priority', 'DESC'], ['aliasText', 'ASC']] });
crud('/transactions', 'Transaction', 'transactions', [
  'transactionDate', 'accountId', 'categoryId', 'relatedAccountId', 'description',
  'merchantId', 'merchant', 'receiptMerchant', 'normalizedMerchant',
  'merchantMatchConfidence', 'merchantMatchSource',
  'transactionType', 'amount', 'currency',
  'originalAmount', 'originalCurrency', 'exchangeRate', 'status', 'sourceType',
  'referenceNumber', 'tags', 'clearedDate', 'isRecurring', 'memo',
  'reviewedByUserId', 'reviewedAt', 'isSimulation'
], { order: [['transactionDate', 'DESC'], ['id', 'DESC']] });
crud('/reconciliations', 'Reconciliation', 'reconciliations', [
  'accountId', 'periodStart', 'periodEnd', 'statementBalance', 'bookBalance',
  'difference', 'status', 'reviewedByUserId', 'reviewedAt', 'notes', 'isSimulation'
], { order: [['periodEnd', 'DESC'], ['id', 'DESC']] });
crud('/proof-documents', 'ProofDocument', 'proofs', [
  'ownerType', 'ownerId', 'originalName', 'storedName', 'mimeType', 'sizeBytes',
  'provider', 'driveFileId', 'driveWebViewLink', 'localPath', 'uploadedByUserId',
  'isDeleted', 'deletedAt'
], { order: [['id', 'DESC']] });

crud('/budgets', 'Budget', 'budgets', [
  'name', 'year', 'month', 'categoryId', 'budgetType', 'plannedAmount',
  'currency', 'alertThresholdPct', 'isActive', 'notes', 'isSimulation'
], { order: [['year', 'DESC'], ['month', 'ASC'], ['name', 'ASC']] });
crud('/recurring-transactions', 'RecurringTransaction', 'recurring', [
  'name', 'accountId', 'categoryId', 'transactionType', 'amount', 'currency',
  'frequency', 'nextDate', 'endDate', 'merchant', 'notes', 'isActive', 'isSimulation'
], { order: [['nextDate', 'ASC'], ['name', 'ASC']] });
crud('/currency-rates', 'CurrencyRate', 'currency_rates', [
  'rateDate', 'fromCurrency', 'toCurrency', 'rate', 'source', 'notes', 'isSimulation'
], { order: [['rateDate', 'DESC'], ['fromCurrency', 'ASC']] });
crud('/financial-goals', 'FinancialGoal', 'goals', [
  'name', 'goalType', 'accountId', 'targetAmount', 'currentAmount', 'currency',
  'targetDate', 'priority', 'status', 'notes', 'isSimulation'
], { order: [['priority', 'ASC'], ['targetDate', 'ASC']] });
crud('/investment-holdings', 'InvestmentHolding', 'investments', [
  'accountId', 'symbol', 'name', 'assetClass', 'quantity', 'costBasis',
  'marketValue', 'currency', 'priceDate', 'notes', 'isSimulation'
], { order: [['assetClass', 'ASC'], ['symbol', 'ASC']] });
crud('/account-balance-snapshots', 'AccountBalanceSnapshot', 'balance_snapshots', [
  'accountId', 'snapshotDate', 'balance', 'currency', 'source', 'notes', 'isSimulation'
], { order: [['snapshotDate', 'DESC'], ['accountId', 'ASC']] });

router.get('/finance/overview', rbac.requirePermission('reports', 'read'), financeController.overview);
router.get('/finance/years', rbac.requirePermission('reports', 'read'), financeController.years);
router.get('/finance/search', rbac.requirePermission('transactions', 'read'), financeController.search);
router.get('/finance/kpi-detail', rbac.requirePermission('reports', 'read'), financeController.kpiDetail);
router.get('/finance/trends', rbac.requirePermission('reports', 'read'), financeController.trends);
router.get('/finance/statement-reconciliation-suggestions', rbac.requirePermission('reports', 'read'), financeController.statementReconciliationSuggestions);
router.get('/finance/statement-reconciliation-detail', rbac.requirePermission('reports', 'read'), financeController.statementReconciliationDetail);
router.post('/finance/transactions/bulk-category', rbac.requirePermission('transactions', 'edit'), financeController.bulkCategory);
router.post('/finance/transactions/auto-categorize', rbac.requirePermission('transactions', 'edit'), financeController.autoCategorize);
router.post('/finance/merchant-suggest', rbac.requirePermission('transactions', 'edit'), importController.suggestMerchantCategory);
router.post('/finance/merchants/backfill', rbac.requirePermission('transactions', 'edit'), async (req, res, next) => {
  try {
    res.json({ ok: true, ...(await merchantResolver.backfillTransactions({ limit: req.body && req.body.limit, force: req.body && req.body.force })) });
  } catch (err) {
    next(err);
  }
});
router.post('/admin/merchants/rebuild', rbac.requirePermission('transactions', 'edit'), async (req, res, next) => {
  try {
    const limit = req.body && req.body.limit ? Number(req.body.limit) : 10000;
    const force = req.body && req.body.force !== false;
    res.json({ ok: true, ...(await merchantResolver.backfillTransactions({ limit, force })) });
  } catch (err) {
    next(err);
  }
});

async function clearSimulationData() {
  const deletedBalanceSnapshots = await db.AccountBalanceSnapshot.destroy({ where: { isSimulation: true } });
  const deletedInvestmentHoldings = await db.InvestmentHolding.destroy({ where: { isSimulation: true } });
  const deletedFinancialGoals = await db.FinancialGoal.destroy({ where: { isSimulation: true } });
  const deletedRecurringTransactions = await db.RecurringTransaction.destroy({ where: { isSimulation: true } });
  const deletedBudgets = await db.Budget.destroy({ where: { isSimulation: true } });
  const deletedCurrencyRates = await db.CurrencyRate.destroy({ where: { isSimulation: true } });
  const deletedTransactions = await db.Transaction.destroy({ where: { isSimulation: true } });
  const deletedAccounts = await db.Account.destroy({ where: { isSimulation: true } });
  return {
    deletedTransactions,
    deletedAccounts,
    deletedBudgets,
    deletedRecurringTransactions,
    deletedFinancialGoals,
    deletedInvestmentHoldings,
    deletedBalanceSnapshots,
    deletedCurrencyRates
  };
}

router.post('/simulation/seed', rbac.requirePermission('simulation', 'add'), async (req, res) => {
  await clearSimulationData();
  const now = new Date();

  async function institution(name, institutionType, notes) {
    const [row] = await db.FinancialInstitution.findOrCreate({
      where: { name },
      defaults: { institutionType, notes, isActive: true }
    });
    return row;
  }
  async function category(name, categoryType, groupName, budgetBehavior) {
    const [row] = await db.Category.findOrCreate({
      where: { name },
      defaults: { categoryType, groupName, budgetBehavior, isActive: true }
    });
    await row.update({ categoryType, groupName, budgetBehavior, isActive: true });
    return row;
  }
  async function account(data) {
    const row = await db.Account.create({
      accountType: 'asset',
      currency: 'USD',
      openingBalanceDate: '2026-01-01',
      status: 'active',
      includeInNetWorth: true,
      isSimulation: true,
      ...data
    });
    return row;
  }

  const popular = await institution('Banco Popular', 'bank', 'Financial institution structure reference.');
  const adv = await institution('ADV / Advantage', 'credit_card', 'Financial institution structure reference.');
  const fidelity = await institution('Fidelity Demo', 'investment', 'Simulation brokerage for 2026 visualization.');

  const cats = {
    salary: await category('Salary', 'income', 'Income', 'fixed'),
    interest: await category('Interest Income', 'income', 'Income', 'variable'),
    otherIncome: await category('Other Income', 'income', 'Income', 'variable'),
    housing: await category('Housing', 'expense', 'Home', 'fixed'),
    utilities: await category('Utilities', 'expense', 'Home', 'fixed'),
    groceries: await category('Groceries', 'expense', 'Living', 'variable'),
    transportation: await category('Transportation', 'expense', 'Living', 'variable'),
    insurance: await category('Insurance', 'expense', 'Protection', 'fixed'),
    dining: await category('Dining & Entertainment', 'expense', 'Lifestyle', 'variable'),
    fees: await category('Bank Fees', 'expense', 'Finance', 'variable'),
    savings: await category('Savings Transfer', 'transfer', 'Transfers', 'planned'),
    investing: await category('Investment Transfer', 'transfer', 'Transfers', 'planned'),
    cardPayment: await category('Credit Card Payment', 'transfer', 'Transfers', 'planned')
  };

  const accounts = {
    checking: await account({
      name: 'Popular Checking 2026',
      accountCode: 'CHK-2026',
      accountClass: 'checking',
      accountSubtype: 'primary checking',
      openingBalance: 4200,
      currentBalance: 9600,
      financialInstitutionId: popular.id,
      notes: 'Simulation checking account for data visualization.'
    }),
    savings: await account({
      name: 'Popular Savings 2026',
      accountCode: 'SVG-2026',
      accountClass: 'savings',
      accountSubtype: 'emergency fund',
      openingBalance: 14500,
      currentBalance: 21500,
      interestRate: 4.1,
      financialInstitutionId: popular.id
    }),
    card: await account({
      name: 'ADV Credit Card 2026',
      accountCode: 'CARD-ADV-2026',
      accountType: 'liability',
      accountClass: 'credit_card',
      accountSubtype: 'rewards card',
      openingBalance: -1800,
      currentBalance: -2480,
      creditLimit: 15000,
      interestRate: 19.99,
      financialInstitutionId: adv.id
    }),
    investment: await account({
      name: 'Fidelity Investment 2026',
      accountCode: 'INV-2026',
      accountClass: 'investment',
      accountSubtype: 'brokerage',
      openingBalance: 43000,
      currentBalance: 48500,
      financialInstitutionId: fidelity.id
    }),
    copSavings: await account({
      name: 'COP Savings 2026',
      accountCode: 'COP-SVG-2026',
      accountClass: 'savings',
      accountSubtype: 'foreign currency',
      currency: 'COP',
      openingBalance: 7200000,
      currentBalance: 8200000,
      financialInstitutionId: popular.id
    })
  };

  const txRows = [];
  const addTx = (month, day, accountRow, categoryRow, description, type, amount, extra = {}) => {
    txRows.push({
      transactionDate: `2026-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
      accountId: accountRow.id,
      categoryId: categoryRow ? categoryRow.id : null,
      relatedAccountId: extra.relatedAccountId || null,
      description,
      merchant: extra.merchant || null,
      normalizedMerchant: extra.normalizedMerchant || extra.merchant || null,
      transactionType: type,
      amount,
      currency: extra.currency || accountRow.currency || 'USD',
      originalAmount: extra.originalAmount,
      originalCurrency: extra.originalCurrency,
      exchangeRate: extra.exchangeRate,
      status: extra.status || 'reviewed',
      sourceType: 'simulation',
      referenceNumber: extra.referenceNumber || `SIM-${month}-${txRows.length + 1}`,
      tags: extra.tags || null,
      clearedDate: extra.clearedDate || null,
      isRecurring: !!extra.isRecurring,
      memo: extra.memo || null,
      reviewedAt: now,
      reviewedByUserId: req.user && req.user.id,
      isSimulation: true
    });
  };

  for (let month = 1; month <= 12; month++) {
    const utilityBump = [1, 2, 7, 8].includes(month) ? 80 : 0;
    addTx(month, 1, accounts.checking, cats.salary, 'Payroll deposit', 'income', 8500, { merchant: 'Employer Payroll', tags: 'salary,income', isRecurring: true });
    addTx(month, 3, accounts.savings, cats.interest, 'Savings interest', 'income', 62 + month * 1.75, { merchant: 'Banco Popular', tags: 'interest,savings', isRecurring: true });
    addTx(month, 5, accounts.checking, cats.housing, 'Mortgage or rent payment', 'expense', -2300, { merchant: 'Housing Payment', tags: 'housing,fixed', isRecurring: true });
    addTx(month, 9, accounts.checking, cats.utilities, 'Electric, water, internet utilities', 'expense', -(335 + utilityBump), { merchant: 'Utility Providers', tags: 'utilities,fixed', isRecurring: true });
    addTx(month, 12, accounts.checking, cats.groceries, 'Household groceries', 'expense', -(920 + month * 18), { merchant: 'Grocery Market', tags: 'groceries,household' });
    addTx(month, 15, accounts.checking, cats.transportation, 'Fuel, parking, rideshare', 'expense', -(410 + month * 8), { merchant: 'Transportation', tags: 'transportation' });
    addTx(month, 17, accounts.checking, cats.insurance, 'Insurance premium', 'expense', -375, { merchant: 'Insurance Carrier', tags: 'insurance,fixed', isRecurring: true });
    addTx(month, 19, accounts.card, cats.dining, 'Dining and family entertainment', 'expense', -(460 + month * 12), { merchant: 'Restaurants', tags: 'dining,card' });
    addTx(month, 22, accounts.checking, cats.cardPayment, 'Credit card payment', 'transfer', -1250, { relatedAccountId: accounts.card.id, merchant: 'ADV / Advantage', tags: 'card-payment,transfer', isRecurring: true });
    addTx(month, 24, accounts.checking, cats.savings, 'Emergency fund transfer', 'transfer', -750, { relatedAccountId: accounts.savings.id, merchant: 'Banco Popular', tags: 'savings,transfer', isRecurring: true });
    addTx(month, 25, accounts.checking, cats.investing, 'Investment contribution', 'transfer', -650, { relatedAccountId: accounts.investment.id, merchant: 'Fidelity Demo', tags: 'investment,transfer', isRecurring: true });
    if ([3, 6, 9, 12].includes(month)) {
      addTx(month, 26, accounts.checking, cats.otherIncome, 'Quarterly other income', 'income', 1200, { merchant: 'Consulting Income', tags: 'other-income' });
    }
    if ([4, 8, 12].includes(month)) {
      addTx(month, 27, accounts.copSavings, cats.fees, 'Foreign currency bank fee', 'expense', -48000, { currency: 'COP', merchant: 'Banco Popular', tags: 'cop,fees' });
    }
  }

  for (const row of txRows) {
    Object.assign(row, await merchantResolver.merchantPayload(row.merchant || row.description));
  }
  const transactions = await db.Transaction.bulkCreate(txRows);

  await db.Budget.bulkCreate([
    ['Housing', cats.housing.id, 2300, 90],
    ['Utilities', cats.utilities.id, 430, 90],
    ['Groceries', cats.groceries.id, 1150, 85],
    ['Transportation', cats.transportation.id, 550, 90],
    ['Insurance', cats.insurance.id, 400, 95],
    ['Dining & Entertainment', cats.dining.id, 700, 85]
  ].map(([name, categoryId, plannedAmount, alertThresholdPct]) => ({
    name: `${name} 2026`,
    year: 2026,
    month: null,
    categoryId,
    budgetType: 'monthly',
    plannedAmount,
    currency: 'USD',
    alertThresholdPct,
    isActive: true,
    notes: 'Simulation monthly budget.',
    isSimulation: true
  })));

  await db.RecurringTransaction.bulkCreate([
    ['Payroll deposit', accounts.checking.id, cats.salary.id, 'income', 8500, 'monthly', '2026-07-01', 'Employer Payroll'],
    ['Mortgage or rent payment', accounts.checking.id, cats.housing.id, 'expense', -2300, 'monthly', '2026-07-05', 'Housing Payment'],
    ['Utilities bundle', accounts.checking.id, cats.utilities.id, 'expense', -385, 'monthly', '2026-07-09', 'Utility Providers'],
    ['Insurance premium', accounts.checking.id, cats.insurance.id, 'expense', -375, 'monthly', '2026-07-17', 'Insurance Carrier'],
    ['Emergency savings transfer', accounts.checking.id, cats.savings.id, 'transfer', -750, 'monthly', '2026-07-24', 'Banco Popular'],
    ['Investment contribution', accounts.checking.id, cats.investing.id, 'transfer', -650, 'monthly', '2026-07-25', 'Fidelity Demo']
  ].map(([name, accountId, categoryId, transactionType, amount, frequency, nextDate, merchant]) => ({
    name,
    accountId,
    categoryId,
    transactionType,
    amount,
    currency: 'USD',
    frequency,
    nextDate,
    merchant,
    notes: 'Simulation recurring item.',
    isActive: true,
    isSimulation: true
  })));

  await db.FinancialGoal.bulkCreate([
    {
      name: 'Emergency Fund',
      goalType: 'savings',
      accountId: accounts.savings.id,
      targetAmount: 40000,
      currentAmount: 21500,
      currency: 'USD',
      targetDate: '2026-12-31',
      priority: 1,
      status: 'active',
      notes: 'Six-month household reserve.',
      isSimulation: true
    },
    {
      name: 'Credit Card Payoff',
      goalType: 'debt_payoff',
      accountId: accounts.card.id,
      targetAmount: 3500,
      currentAmount: 1250,
      currency: 'USD',
      targetDate: '2026-10-31',
      priority: 2,
      status: 'active',
      notes: 'Pay down statement balance before higher-rate purchases.',
      isSimulation: true
    },
    {
      name: 'Vacation Reserve',
      goalType: 'sinking_fund',
      accountId: accounts.savings.id,
      targetAmount: 8000,
      currentAmount: 3100,
      currency: 'USD',
      targetDate: '2026-08-15',
      priority: 3,
      status: 'active',
      notes: 'Planned family trip reserve.',
      isSimulation: true
    }
  ]);

  await db.InvestmentHolding.bulkCreate([
    { accountId: accounts.investment.id, symbol: 'VTI', name: 'Total US Market ETF', assetClass: 'equity', quantity: 92.45, costBasis: 22000, marketValue: 25200, currency: 'USD', priceDate: '2026-06-30', notes: 'Simulation holding.', isSimulation: true },
    { accountId: accounts.investment.id, symbol: 'VXUS', name: 'International Equity ETF', assetClass: 'equity', quantity: 140.2, costBasis: 9300, marketValue: 10150, currency: 'USD', priceDate: '2026-06-30', notes: 'Simulation holding.', isSimulation: true },
    { accountId: accounts.investment.id, symbol: 'BND', name: 'Bond Market ETF', assetClass: 'fixed_income', quantity: 156.4, costBasis: 12400, marketValue: 13150, currency: 'USD', priceDate: '2026-06-30', notes: 'Simulation holding.', isSimulation: true }
  ]);

  const snapshotRows = [];
  for (let month = 1; month <= 12; month++) {
    const suffix = `2026-${String(month).padStart(2, '0')}-28`;
    snapshotRows.push(
      { accountId: accounts.checking.id, snapshotDate: suffix, balance: 4200 + month * 450, currency: 'USD', source: 'simulation', notes: 'Monthly simulation snapshot.', isSimulation: true },
      { accountId: accounts.savings.id, snapshotDate: suffix, balance: 14500 + month * 585, currency: 'USD', source: 'simulation', notes: 'Monthly simulation snapshot.', isSimulation: true },
      { accountId: accounts.card.id, snapshotDate: suffix, balance: -(1800 + month * 55), currency: 'USD', source: 'simulation', notes: 'Monthly simulation snapshot.', isSimulation: true },
      { accountId: accounts.investment.id, snapshotDate: suffix, balance: 43000 + month * 460, currency: 'USD', source: 'simulation', notes: 'Monthly simulation snapshot.', isSimulation: true },
      { accountId: accounts.copSavings.id, snapshotDate: suffix, balance: 7200000 + month * 80000, currency: 'COP', source: 'simulation', notes: 'Monthly simulation snapshot.', isSimulation: true }
    );
  }
  await db.AccountBalanceSnapshot.bulkCreate(snapshotRows);

  await db.CurrencyRate.bulkCreate(Array.from({ length: 12 }, (_, idx) => ({
    rateDate: `2026-${String(idx + 1).padStart(2, '0')}-28`,
    fromCurrency: 'COP',
    toCurrency: 'USD',
    rate: 0.00024 + idx * 0.000001,
    source: 'simulation',
    notes: 'Simulation FX rate for dashboards.',
    isSimulation: true
  })).concat(Array.from({ length: 12 }, (_, idx) => ({
    rateDate: `2026-${String(idx + 1).padStart(2, '0')}-28`,
    fromCurrency: 'EUR',
    toCurrency: 'USD',
    rate: 1.08 + idx * 0.002,
    source: 'simulation',
    notes: 'Simulation FX rate for dashboards.',
    isSimulation: true
  }))));

  res.json({
    ok: true,
    created: transactions.length,
    details: {
      accounts: Object.keys(accounts).length,
      categories: Object.keys(cats).length,
      transactions: transactions.length,
      budgets: 6,
      recurring: 6,
      goals: 3,
      holdings: 3,
      snapshots: snapshotRows.length,
      currencyRates: 24
    },
    replacedExistingSimulation: true
  });
});

router.delete('/simulation', rbac.requirePermission('simulation', 'delete'), async (req, res) => {
  const deleted = await clearSimulationData();
  res.json({ ok: true, ...deleted });
});

router.post('/heartbeat', async (req, res) => {
  const user = req.user || {};
  await db.UserActivityLog.create({
    userId: user.id || null,
    usernameSnapshot: user.username || null,
    roleSnapshot: user.role || null,
    pageUrl: req.body.currentUrl || req.body.pageUrl || '/',
    pagePath: req.body.currentUrl || req.body.pagePath || '/',
    pageTitle: req.body.currentPage || req.body.pageTitle || 'Accounting workspace',
    visitedAt: new Date(),
    ipAddress: req.ip || req.socket?.remoteAddress || '',
    userAgent: req.headers['user-agent'] || '',
    referrer: req.headers.referer || req.headers.referrer || null,
    statusCode: 204
  });
  res.status(204).end();
});

router.get('/active-sessions', rbac.requirePermission('active_users', 'read'), async (req, res) => {
  const since = new Date(Date.now() - 15 * 60 * 1000);
  const visits = await db.UserActivityLog.findAll({
    where: {
      visitedAt: { [Op.gte]: since },
      statusCode: { [Op.lt]: 400 }
    },
    include: [{ model: db.User, attributes: ['id', 'firstName', 'lastName', 'username'] }],
    order: [['visitedAt', 'DESC']],
    limit: 200
  });

  const byUser = new Map();
  visits.forEach((visit) => {
    const key = visit.userId || visit.usernameSnapshot || `anon-${visit.id}`;
    if (byUser.has(key)) return;
    const user = visit.User || {};
    byUser.set(key, {
      userId: visit.userId,
      username: user.username || visit.usernameSnapshot || 'unknown',
      firstName: user.firstName || '',
      lastName: user.lastName || '',
      role: visit.roleSnapshot || 'User',
      currentUrl: visit.pagePath || visit.pageUrl || '/',
      currentPage: visit.pageTitle || 'Accounting workspace',
      lastSeen: visit.visitedAt,
      loginTime: visit.visitedAt,
      idleMs: Date.now() - new Date(visit.visitedAt).getTime(),
      ip: visit.ipAddress || ''
    });
  });

  res.json(Array.from(byUser.values()));
});

router.get('/users', rbac.requireRole(['Administrator']), userController.getAll);
router.get('/users/:id', rbac.requireRole(['Administrator']), userController.getOne);
router.post('/users', rbac.requireRole(['Administrator']), userController.create);
router.put('/users/:id', rbac.requireRole(['Administrator']), userController.update);
router.delete('/users/:id', rbac.requireRole(['Administrator']), userController.delete);

router.get('/roles/permission-defaults', rbac.requireRole(['Administrator']), roleController.getDefaults);
router.get('/roles', rbac.requireRole(['Administrator']), roleController.getAll);
router.get('/roles/:id', rbac.requireRole(['Administrator']), roleController.getOne);
router.post('/roles', rbac.requireRole(['Administrator']), roleController.create);
router.put('/roles/:id', rbac.requireRole(['Administrator']), roleController.update);
router.delete('/roles/:id', rbac.requireRole(['Administrator']), roleController.delete);
router.post('/roles/:id/duplicate', rbac.requireRole(['Administrator']), roleController.duplicate);

router.get('/audit-logs', rbac.requirePermission('audit_log', 'read'), auditLogController.getAll);
router.get('/audit-logs/users', rbac.requirePermission('audit_log', 'read'), auditLogController.getUsers);
router.get('/audit-logs/modules', rbac.requirePermission('audit_log', 'read'), auditLogController.getModules);
router.get('/audit-logs/actions', rbac.requirePermission('audit_log', 'read'), auditLogController.getActions);
router.delete('/audit-logs/:id', rbac.requireRole(['Administrator']), auditLogController.deleteOne);
router.delete('/audit-logs', rbac.requireRole(['Administrator']), auditLogController.bulkDelete);
router.post('/audit-logs/rotate', rbac.requireRole(['Administrator']), auditLogController.rotate);

router.post('/errors', errorLogController.logFrontend);
router.get('/errors', rbac.requirePermission('audit_log', 'read'), errorLogController.getAll);
router.patch('/errors/bulk-resolve', rbac.requirePermission('audit_log', 'edit'), errorLogController.bulkResolve);
router.delete('/errors/bulk-delete', rbac.requirePermission('audit_log', 'delete'), errorLogController.bulkDelete);
router.patch('/errors/:id/resolve', rbac.requirePermission('audit_log', 'edit'), errorLogController.resolve);
router.delete('/errors', rbac.requirePermission('audit_log', 'delete'), errorLogController.clearResolved);

router.get('/settings', rbac.requirePermission('system_settings', 'read'), settingsController.getAll);
router.put('/settings', rbac.requirePermission('system_settings', 'edit'), settingsController.update);
router.get('/settings/timezones', rbac.requirePermission('system_settings', 'read'), settingsController.getTimezones);
router.get('/settings/api-routes', rbac.requirePermission('system_settings', 'read'), settingsController.getApiRoutes);

router.get('/api-keys', rbac.requireRole(['Administrator']), apiKeyController.getAll);
router.post('/api-keys', rbac.requireRole(['Administrator']), apiKeyController.generate);
router.patch('/api-keys/:id/toggle', rbac.requireRole(['Administrator']), apiKeyController.toggle);
router.delete('/api-keys/:id', rbac.requireRole(['Administrator']), apiKeyController.remove);

router.get('/backups/status', rbac.requireRole(['Administrator']), (req, res) => res.json(backupService.getStatus()));
router.post('/backups/run', rbac.requireRole(['Administrator']), async (req, res) => res.json(await backupService.runBackup('manual')));

const masterOnly = rbac.requireMaster;
router.get('/admin/stats', masterOnly, adminController.getStats);
router.get('/admin/schema', masterOnly, adminController.getSchema);
router.get('/admin/table-data/:tableName', masterOnly, adminController.getTableData);
router.get('/admin/table-export/:tableName', masterOnly, adminController.exportTable);
router.delete('/admin/purge', masterOnly, adminController.purgeTables);
router.get('/admin/orphans', masterOnly, adminController.getOrphans);
router.get('/admin/financial-checks', masterOnly, adminController.getFinancialChecks);
router.get('/admin/health', masterOnly, adminController.getHealth);
router.get('/admin/log-dashboard', masterOnly, adminController.getLogDashboard);
router.get('/admin/audit-logs', masterOnly, auditLogController.getAll);
router.get('/admin/audit-logs/users', masterOnly, auditLogController.getUsers);
router.get('/admin/audit-logs/modules', masterOnly, auditLogController.getModules);
router.get('/admin/audit-logs/actions', masterOnly, auditLogController.getActions);
router.get('/admin/error-logs', masterOnly, errorLogController.getAll);
router.patch('/admin/error-logs/resolve', masterOnly, errorLogController.bulkResolve);
router.delete('/admin/error-logs', masterOnly, errorLogController.bulkDelete);
router.get('/admin/api-keys', masterOnly, apiKeyController.getAll);
router.post('/admin/api-keys', masterOnly, apiKeyController.generate);
router.patch('/admin/api-keys/:id/toggle', masterOnly, apiKeyController.toggle);
router.delete('/admin/api-keys/:id', masterOnly, apiKeyController.remove);
router.get('/admin/snapshots/export', masterOnly, snapshotController.exportCSV);
router.get('/admin/snapshots', masterOnly, snapshotController.getSnapshots);
router.post('/admin/snapshots/capture', masterOnly, snapshotController.captureNow);
router.delete('/admin/snapshots/:date', masterOnly, snapshotController.deleteSnapshot);
router.get('/admin/users', masterOnly, adminController.getUsers);
router.patch('/admin/users/:id', masterOnly, adminController.updateUser);
router.post('/admin/users/:id/reset-password', masterOnly, adminController.adminResetPassword);
router.post('/admin/users/:id/unlock', masterOnly, adminController.adminUnlockUser);
router.delete('/admin/users/:id/reset-2fa', masterOnly, adminController.adminReset2fa);
router.get('/admin/backups/status', masterOnly, adminController.getBackupStatus);
router.post('/admin/backups/run', masterOnly, adminController.runDbBackup);
router.get('/admin/csv-backups', masterOnly, adminController.listCsvBackups);
router.post('/admin/csv-backups', masterOnly, adminController.createCsvBackup);
router.delete('/admin/csv-backups/:name', masterOnly, adminController.deleteCsvBackup);
router.get('/admin/csv-backups/:name/:file', masterOnly, adminController.downloadCsvBackupFile);

module.exports = router;
