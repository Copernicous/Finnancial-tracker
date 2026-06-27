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
const settingsController = require('../controllers/settingsController');
const apiKeyController = require('../controllers/apiKeyController');
const backupService = require('../services/backupService');

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
    const row = await db[modelName].create(pick(req.body, fields));
    res.status(201).json(row);
  });

  router.put(`${path}/:id`, rbac.requirePermission(moduleKey, 'edit'), async (req, res) => {
    const row = await db[modelName].findByPk(req.params.id);
    if (!row) return res.status(404).json({ error: 'Record not found' });
    await row.update(pick(req.body, fields));
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
  'openingBalance', 'openingBalanceDate', 'status', 'notes', 'isSimulation'
]);
crud('/categories', 'Category', 'categories', [
  'name', 'categoryType', 'parentId', 'taxRelevant', 'isActive'
]);
crud('/transactions', 'Transaction', 'transactions', [
  'transactionDate', 'accountId', 'categoryId', 'relatedAccountId', 'description',
  'transactionType', 'amount', 'currency', 'status', 'sourceType', 'referenceNumber',
  'memo', 'reviewedByUserId', 'reviewedAt', 'isSimulation'
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

router.post('/simulation/seed', rbac.requirePermission('simulation', 'add'), async (req, res) => {
  await db.Transaction.destroy({ where: { isSimulation: true } });
  const institution = await db.FinancialInstitution.findOrCreate({
    where: { name: 'Demo Banco Popular' },
    defaults: { institutionType: 'bank', notes: 'Simulation only', isActive: true }
  });
  const account = await db.Account.findOrCreate({
    where: { name: 'Demo Checking 2026' },
    defaults: {
      accountCode: 'SIM-CHK-2026',
      accountType: 'asset',
      currency: 'USD',
      financialInstitutionId: institution[0].id,
      isSimulation: true
    }
  });
  const rows = [];
  for (let month = 1; month <= 12; month++) {
    rows.push({
      transactionDate: `2026-${String(month).padStart(2, '0')}-01`,
      accountId: account[0].id,
      description: 'Simulation income',
      transactionType: 'income',
      amount: 7200,
      currency: 'USD',
      status: 'reviewed',
      sourceType: 'simulation',
      isSimulation: true
    });
    rows.push({
      transactionDate: `2026-${String(month).padStart(2, '0')}-05`,
      accountId: account[0].id,
      description: 'Simulation household expenses',
      transactionType: 'expense',
      amount: -3100 - (month * 25),
      currency: 'USD',
      status: 'reviewed',
      sourceType: 'simulation',
      isSimulation: true
    });
  }
  await db.Transaction.bulkCreate(rows);
  res.json({ ok: true, created: rows.length, replacedExistingSimulation: true });
});

router.delete('/simulation', rbac.requirePermission('simulation', 'delete'), async (req, res) => {
  const deletedTransactions = await db.Transaction.destroy({ where: { isSimulation: true } });
  const deletedAccounts = await db.Account.destroy({ where: { isSimulation: true } });
  res.json({ ok: true, deletedTransactions, deletedAccounts });
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

module.exports = router;
