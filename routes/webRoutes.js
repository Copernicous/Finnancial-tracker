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

router.get('/accounts', (req, res) => {
  res.render('crud', { title: 'Chart of Accounts', module: 'accounts', apiEndpoint: '/api/accounts', activePage: 'accounts' });
});

router.get('/transactions', (req, res) => {
  res.render('crud', { title: 'Transactions', module: 'transactions', apiEndpoint: '/api/transactions', activePage: 'transactions' });
});

router.get('/entry', (req, res) => {
  res.render('entry', { title: 'New Accounting Entry', activePage: 'entry' });
});

router.get('/categories', (req, res) => {
  res.render('crud', { title: 'Categories', module: 'categories', apiEndpoint: '/api/categories', activePage: 'categories' });
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
