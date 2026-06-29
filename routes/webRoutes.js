const express = require('express');
const fs = require('fs');
const path = require('path');
const router = express.Router();
const { requireMaster } = require('../middleware/rbac');

router.get('/', (req, res) => res.redirect('/login'));

router.get('/login', (req, res) => {
  res.render('login', { title: 'Login - Home Accounting' });
});

router.get('/dashboard', (req, res) => {
  res.render('dashboard', { title: 'Dashboard', activePage: 'dashboard' });
});

router.get('/finance', (req, res) => {
  res.render('finance', { title: 'Financial Workspace', activePage: 'finance' });
});

router.get('/accounts', (req, res) => {
  res.render('crud', { title: 'Chart of Accounts', module: 'accounts', apiEndpoint: '/api/accounts', activePage: 'accounts' });
});

router.get('/transactions', (req, res) => {
  res.render('transactions', { title: 'Transactions', activePage: 'transactions', startNew: false });
});

router.get('/entry', (req, res) => {
  res.render('transactions', { title: 'New Entry', activePage: 'entry', startNew: true });
});

router.get('/categories', (req, res) => {
  res.render('crud', { title: 'Categories', module: 'categories', apiEndpoint: '/api/categories', activePage: 'categories' });
});

router.get('/merchants', (req, res) => {
  res.render('crud', { title: 'Official Merchants', module: 'merchants', apiEndpoint: '/api/merchants', activePage: 'merchants' });
});

router.get('/merchant-aliases', (req, res) => {
  res.render('crud', { title: 'Merchant Aliases', module: 'merchant-aliases', apiEndpoint: '/api/merchant-aliases', activePage: 'merchant-aliases' });
});

router.get('/financial-institutions', (req, res) => {
  res.render('crud', { title: 'Financial Institutions', module: 'financial-institutions', apiEndpoint: '/api/financial-institutions', activePage: 'financial-institutions' });
});

router.get('/reconciliations', (req, res) => {
  res.render('crud', { title: 'Reconciliations', module: 'reconciliations', apiEndpoint: '/api/reconciliations', activePage: 'reconciliations' });
});

router.get('/proofs', (req, res) => {
  res.render('crud', { title: 'Proofs & Documents', module: 'proof-documents', apiEndpoint: '/api/proof-documents', activePage: 'proofs' });
});

router.get('/budgets', (req, res) => {
  res.render('crud', { title: 'Budgets', module: 'budgets', apiEndpoint: '/api/budgets', activePage: 'budgets' });
});

router.get('/recurring', (req, res) => {
  res.render('crud', { title: 'Recurring Transactions', module: 'recurring', apiEndpoint: '/api/recurring-transactions', activePage: 'recurring' });
});

router.get('/financial-goals', (req, res) => {
  res.render('crud', { title: 'Financial Goals', module: 'financial-goals', apiEndpoint: '/api/financial-goals', activePage: 'financial-goals' });
});

router.get('/investments', (req, res) => {
  res.render('crud', { title: 'Investment Holdings', module: 'investment-holdings', apiEndpoint: '/api/investment-holdings', activePage: 'investments' });
});

router.get('/currency-rates', (req, res) => {
  res.render('crud', { title: 'Currency Rates', module: 'currency-rates', apiEndpoint: '/api/currency-rates', activePage: 'currency-rates' });
});

router.get('/balance-snapshots', (req, res) => {
  res.render('crud', { title: 'Balance Snapshots', module: 'balance-snapshots', apiEndpoint: '/api/account-balance-snapshots', activePage: 'balance-snapshots' });
});

router.get('/reports', (req, res) => {
  res.render('reports', { title: 'Reports', activePage: 'reports' });
});

router.get('/import', (req, res) => {
  res.render('import', { title: 'Curated Data Import', activePage: 'import' });
});

router.get('/audit-log', (req, res) => {
  res.render('audit-log', { title: 'Audit Log', activePage: 'audit-log' });
});

router.get('/users', (req, res) => {
  res.render('users', { title: 'User Management', activePage: 'users' });
});

router.get('/roles', (req, res) => {
  res.render('roles', { title: 'Roles Management', activePage: 'roles' });
});

router.get('/backups', (req, res) => {
  res.render('backups', { title: 'Backup Management', activePage: 'backups' });
});

router.get('/system-settings', (req, res) => {
  res.render('system-settings', { title: 'System Settings', activePage: 'system-settings' });
});

router.get('/backoffice', requireMaster, (req, res) => {
  res.render('backoffice', { title: 'Backoffice - Data Control Center', activePage: 'backoffice' });
});

router.get('/active-users', (req, res) => {
  res.render('active-users', { title: 'Active Users - Who is Online', activePage: 'active-users' });
});

router.get('/changelog', (req, res) => {
  const root = typeof process.pkg !== 'undefined' ? path.dirname(process.execPath) : path.join(__dirname, '..');
  const mdPath = path.join(root, 'CHANGELOG.md');
  let markdown = '';
  try { markdown = fs.readFileSync(mdPath, 'utf8'); } catch {}
  res.render('changelog', { title: 'Changelog', activePage: 'changelog', markdown });
});

module.exports = router;
