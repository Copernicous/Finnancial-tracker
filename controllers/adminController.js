'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const db = require('../models');
const settings = require('../services/settingsService');
const backupService = require('../services/backupService');
const { getWritableRoot } = require('../utils/runtimePaths');
const { QueryTypes } = require('sequelize');
const bcrypt = require('bcryptjs');

const TABLE_META = [
  { key: 'ImportRows', label: 'Import Rows', area: 'Import', icon: 'fa-list-check', color: '#0d6efd', description: 'Parsed rows staged from bank statements and curated files.', purgeable: true },
  { key: 'ImportBatches', label: 'Import Batches', area: 'Import', icon: 'fa-box-archive', color: '#2563eb', description: 'Uploaded files and staging batch status.', purgeable: true },
  { key: 'Transactions', label: 'Transactions', area: 'Ledger', icon: 'fa-receipt', color: '#059669', description: 'Reviewed ledger transactions and posted import rows.', purgeable: true },
  { key: 'Merchants', label: 'Official Merchants', area: 'Reference', icon: 'fa-store', color: '#0f766e', description: 'Canonical merchant names used for analytics and import normalization.', purgeable: true },
  { key: 'MerchantAliases', label: 'Merchant Aliases', area: 'Reference', icon: 'fa-signature', color: '#14b8a6', description: 'Receipt and statement text patterns mapped to official merchants.', purgeable: true },
  { key: 'Reconciliations', label: 'Reconciliations', area: 'Ledger', icon: 'fa-scale-balanced', color: '#0ea5e9', description: 'Statement-to-book reconciliation records.', purgeable: true },
  { key: 'ProofDocuments', label: 'Proof Documents', area: 'Documents', icon: 'fa-paperclip', color: '#64748b', description: 'Receipts, statements, and proof metadata.', purgeable: true },
  { key: 'AccountAliases', label: 'Account Aliases', area: 'Accounts', icon: 'fa-link', color: '#14b8a6', description: 'Statement aliases mapped to accounts.', purgeable: true },
  { key: 'AccountBalanceSnapshots', label: 'Balance Snapshots', area: 'Accounts', icon: 'fa-camera-retro', color: '#22c55e', description: 'Monthly or statement balance checkpoints.', purgeable: true },
  { key: 'InvestmentHoldings', label: 'Investment Holdings', area: 'Planning', icon: 'fa-chart-area', color: '#7c3aed', description: 'Holdings, market value, and price dates.', purgeable: true },
  { key: 'FinancialGoals', label: 'Financial Goals', area: 'Planning', icon: 'fa-bullseye', color: '#f97316', description: 'Savings, debt payoff, and sinking-fund goals.', purgeable: true },
  { key: 'RecurringTransactions', label: 'Recurring Items', area: 'Planning', icon: 'fa-calendar-check', color: '#16a34a', description: 'Salary, utilities, transfers, and recurring obligations.', purgeable: true },
  { key: 'Budgets', label: 'Budgets', area: 'Planning', icon: 'fa-chart-pie', color: '#f59e0b', description: 'Monthly and annual budget plans.', purgeable: true },
  { key: 'CurrencyRates', label: 'Currency Rates', area: 'Reference', icon: 'fa-coins', color: '#eab308', description: 'Manual FX rates for multi-currency reporting.', purgeable: true },
  { key: 'Accounts', label: 'Accounts', area: 'Accounts', icon: 'fa-wallet', color: '#0284c7', description: 'Checking, cards, loans, savings, and investment accounts.', purgeable: true },
  { key: 'Categories', label: 'Categories', area: 'Reference', icon: 'fa-tags', color: '#db2777', description: 'Income, expense, transfer, and adjustment categories.', purgeable: true },
  { key: 'FinancialInstitutions', label: 'Financial Institutions', area: 'Reference', icon: 'fa-building-columns', color: '#475569', description: 'Banks, credit cards, and brokerages.', purgeable: true },
  { key: 'DailySnapshots', label: 'Daily Snapshots', area: 'Reporting', icon: 'fa-calendar-day', color: '#6366f1', description: 'Daily KPI snapshots for reporting history.', purgeable: true },
  { key: 'AuditLogs', label: 'Audit Logs', area: 'Operations', icon: 'fa-shield-halved', color: '#f97316', description: 'System audit trail.', purgeable: false },
  { key: 'ErrorLogs', label: 'Error Logs', area: 'Operations', icon: 'fa-bug', color: '#dc2626', description: 'Frontend and backend error records.', purgeable: false },
  { key: 'UserActivityLogs', label: 'User Activity', area: 'Operations', icon: 'fa-user-clock', color: '#0891b2', description: 'Page visits and online-user heartbeat records.', purgeable: false },
  { key: 'SystemSettings', label: 'System Settings', area: 'System', icon: 'fa-sliders', color: '#6b7280', description: 'Application configuration values.', purgeable: false },
  { key: 'ApiKeys', label: 'API Keys', area: 'System', icon: 'fa-key', color: '#9333ea', description: 'Proxy and integration API keys.', purgeable: false },
  { key: 'Users', label: 'Users', area: 'System', icon: 'fa-users-gear', color: '#334155', description: 'Application users.', purgeable: false },
  { key: 'Roles', label: 'Roles', area: 'System', icon: 'fa-user-shield', color: '#1f2937', description: 'RBAC roles and permissions.', purgeable: false }
];

const TABLE_BY_KEY = new Map(TABLE_META.map((table) => [table.key, table]));
const SENSITIVE_COLUMNS = /password|secret|token|backupCodes|keyHash|hash/i;

function qident(name) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(String(name || ''))) throw new Error('Invalid identifier.');
  return '"' + name + '"';
}

function ensureTable(key) {
  const meta = TABLE_BY_KEY.get(key);
  if (!meta) {
    const err = new Error('Unknown table: ' + key);
    err.status = 400;
    throw err;
  }
  return meta;
}

function maskRow(row) {
  const out = {};
  Object.keys(row || {}).forEach((key) => {
    out[key] = SENSITIVE_COLUMNS.test(key) && row[key] != null ? '[masked]' : row[key];
  });
  return out;
}

function csvCell(value) {
  let s = value == null ? '' : (typeof value === 'object' ? JSON.stringify(value) : String(value));
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return '"' + s.replace(/"/g, '""') + '"';
}

function rowsToCsv(columns, rows) {
  return columns.map(csvCell).join(',') + '\n' + rows.map((row) => columns.map((col) => csvCell(row[col])).join(',')).join('\n');
}

async function countTable(tableKey) {
  const [row] = await db.sequelize.query('SELECT COUNT(*)::int AS count FROM ' + qident(tableKey), { type: QueryTypes.SELECT });
  return Number(row && row.count ? row.count : 0);
}

async function getColumns(tableKey) {
  const rows = await db.sequelize.query(`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = :table
    ORDER BY ordinal_position
  `, { type: QueryTypes.SELECT, replacements: { table: tableKey } });
  return rows.map((row) => row.column_name);
}

async function getSchemaData() {
  const colRows = await db.sequelize.query(`
    SELECT table_name, column_name, data_type, character_maximum_length,
           is_nullable, column_default, ordinal_position
    FROM information_schema.columns
    WHERE table_schema = 'public'
    ORDER BY table_name, ordinal_position
  `, { type: QueryTypes.SELECT });

  const fkRows = await db.sequelize.query(`
    SELECT tc.table_name AS from_table, kcu.column_name AS from_column,
           ccu.table_name AS to_table, ccu.column_name AS to_column,
           tc.constraint_name
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
    JOIN information_schema.constraint_column_usage ccu
      ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
    WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public'
    ORDER BY tc.table_name, kcu.column_name
  `, { type: QueryTypes.SELECT });

  const pkRows = await db.sequelize.query(`
    SELECT tc.table_name, kcu.column_name
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
    WHERE tc.constraint_type = 'PRIMARY KEY' AND tc.table_schema = 'public'
  `, { type: QueryTypes.SELECT });

  const pkSet = new Set(pkRows.map((row) => row.table_name + '.' + row.column_name));
  const fkMap = new Map(fkRows.map((row) => [
    row.from_table + '.' + row.from_column,
    { toTable: row.to_table, toColumn: row.to_column, constraint: row.constraint_name }
  ]));
  const tables = new Map();
  colRows.forEach((row) => {
    if (!tables.has(row.table_name)) tables.set(row.table_name, { name: row.table_name, columns: [] });
    const ref = fkMap.get(row.table_name + '.' + row.column_name) || null;
    tables.get(row.table_name).columns.push({
      name: row.column_name,
      type: row.data_type + (row.character_maximum_length ? '(' + row.character_maximum_length + ')' : ''),
      nullable: row.is_nullable === 'YES',
      defaultValue: row.column_default,
      isPK: pkSet.has(row.table_name + '.' + row.column_name),
      isFK: !!ref,
      references: ref
    });
  });
  return { tables: Array.from(tables.values()), relationships: fkRows };
}

exports.getStats = async (req, res) => {
  try {
    const counts = {};
    for (const table of TABLE_META) counts[table.key] = await countTable(table.key);
    res.json({
      tables: TABLE_META,
      counts,
      generatedAt: new Date().toISOString(),
      backups: backupService.getStatus(),
      settings: settings.getAll(false)
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

exports.getSchema = async (req, res) => {
  try {
    res.json(await getSchemaData());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

exports.getTableData = async (req, res) => {
  try {
    const table = ensureTable(req.params.tableName);
    const limit = Math.min(Math.max(parseInt(req.query.limit || '250', 10) || 250, 1), 1000);
    const offset = Math.max(parseInt(req.query.offset || '0', 10) || 0, 0);
    const columns = await getColumns(table.key);
    const orderColumn = columns.includes('id') ? 'id' : columns[0];
    const rows = await db.sequelize.query(
      'SELECT * FROM ' + qident(table.key) + ' ORDER BY ' + qident(orderColumn) + ' DESC LIMIT :limit OFFSET :offset',
      { type: QueryTypes.SELECT, replacements: { limit, offset } }
    );
    const total = await countTable(table.key);
    res.json({
      tableName: table.key,
      label: table.label,
      columns,
      rows: rows.map(maskRow),
      total,
      limit,
      offset
    });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
};

exports.exportTable = async (req, res) => {
  try {
    const table = ensureTable(req.params.tableName);
    const columns = await getColumns(table.key);
    const orderColumn = columns.includes('id') ? 'id' : columns[0];
    const rows = await db.sequelize.query(
      'SELECT * FROM ' + qident(table.key) + ' ORDER BY ' + qident(orderColumn) + ' DESC',
      { type: QueryTypes.SELECT }
    );
    const safeRows = rows.map(maskRow);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="' + table.key + '-' + new Date().toISOString().slice(0, 10) + '.csv"');
    res.send(rowsToCsv(columns, safeRows));
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
};

exports.getOrphans = async (req, res) => {
  try {
    const schema = await getSchemaData();
    const results = [];
    for (const fk of schema.relationships) {
      if (!TABLE_BY_KEY.has(fk.from_table) || !TABLE_BY_KEY.has(fk.to_table)) continue;
      const [row] = await db.sequelize.query(
        'SELECT COUNT(*)::int AS count FROM ' + qident(fk.from_table) + ' c ' +
        'WHERE c.' + qident(fk.from_column) + ' IS NOT NULL ' +
        'AND NOT EXISTS (SELECT 1 FROM ' + qident(fk.to_table) + ' p WHERE p.' + qident(fk.to_column) + ' = c.' + qident(fk.from_column) + ')',
        { type: QueryTypes.SELECT }
      );
      results.push({
        childTable: fk.from_table,
        childColumn: fk.from_column,
        parentTable: fk.to_table,
        parentColumn: fk.to_column,
        constraint: fk.constraint_name,
        orphanCount: Number(row.count || 0),
        clean: Number(row.count || 0) === 0
      });
    }
    const totalOrphans = results.reduce((sum, row) => sum + row.orphanCount, 0);
    res.json({ results, totalOrphans, clean: totalOrphans === 0 });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

exports.getHealth = async (req, res) => {
  try {
    const tableStats = await db.sequelize.query(`
      SELECT t.tablename AS "table",
             pg_size_pretty(pg_total_relation_size(quote_ident(t.tablename))) AS "totalSize",
             pg_total_relation_size(quote_ident(t.tablename)) AS "sizeBytes",
             COALESCE(s.n_live_tup, 0) AS "rowEstimate"
      FROM pg_tables t
      LEFT JOIN pg_stat_user_tables s ON s.relname = t.tablename
      WHERE t.schemaname = 'public'
      ORDER BY pg_total_relation_size(quote_ident(t.tablename)) DESC
    `, { type: QueryTypes.SELECT });
    const [dbInfo] = await db.sequelize.query(`
      SELECT pg_size_pretty(pg_database_size(current_database())) AS "size",
             pg_database_size(current_database()) AS "sizeBytes",
             current_database() AS "name",
             version() AS "version"
    `, { type: QueryTypes.SELECT });
    const [conn] = await db.sequelize.query('SELECT COUNT(*)::int AS active FROM pg_stat_activity WHERE state = \'active\'', { type: QueryTypes.SELECT });
    const mem = process.memoryUsage();
    res.json({
      tableStats,
      db: dbInfo,
      connections: Number(conn.active || 0),
      node: {
        version: process.version,
        platform: process.platform,
        arch: process.arch,
        uptime: Math.floor(process.uptime()),
        heapUsed: mem.heapUsed,
        heapTotal: mem.heapTotal,
        rss: mem.rss,
        cpus: os.cpus().length,
        hostname: os.hostname(),
        freeMemBytes: os.freemem(),
        totalMemBytes: os.totalmem()
      }
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

exports.getFinancialChecks = async (req, res) => {
  try {
    const [missingCategory] = await db.sequelize.query('SELECT COUNT(*)::int AS count FROM "Transactions" WHERE "categoryId" IS NULL', { type: QueryTypes.SELECT });
    const [uncleared] = await db.sequelize.query('SELECT COUNT(*)::int AS count FROM "Transactions" WHERE "status" IN (\'draft\', \'needs_review\')', { type: QueryTypes.SELECT });
    const [stagedRows] = await db.sequelize.query('SELECT COUNT(*)::int AS count FROM "ImportRows" WHERE "status" IN (\'staged\', \'ready\', \'error\')', { type: QueryTypes.SELECT });
    const [duplicateRows] = await db.sequelize.query('SELECT COUNT(*)::int AS count FROM "ImportRows" WHERE "status" = \'duplicate\'', { type: QueryTypes.SELECT });
    const [missingMerchant] = await db.sequelize.query('SELECT COUNT(*)::int AS count FROM "Transactions" WHERE "merchantId" IS NULL AND COALESCE("merchant", "description", \'\') <> \'\'', { type: QueryTypes.SELECT });

    const duplicateTransactions = await db.sequelize.query(`
      SELECT "accountId", "transactionDate", "amount", "currency",
             LOWER(TRIM(COALESCE("description", ''))) AS "descriptionKey",
             COUNT(*)::int AS count,
             ARRAY_AGG(id ORDER BY id) AS ids
      FROM "Transactions"
      GROUP BY "accountId", "transactionDate", "amount", "currency", LOWER(TRIM(COALESCE("description", '')))
      HAVING COUNT(*) > 1
      ORDER BY COUNT(*) DESC, "transactionDate" DESC
      LIMIT 50
    `, { type: QueryTypes.SELECT });

    const categoryUse = await db.sequelize.query(`
      SELECT c.id, c.name, c."categoryType", COUNT(t.id)::int AS "transactionCount"
      FROM "Categories" c
      LEFT JOIN "Transactions" t ON t."categoryId" = c.id
      GROUP BY c.id, c.name, c."categoryType"
      ORDER BY "transactionCount" DESC, c.name ASC
      LIMIT 40
    `, { type: QueryTypes.SELECT });

    const merchantUse = await db.sequelize.query(`
      SELECT m.id, m."officialName", COUNT(t.id)::int AS "transactionCount"
      FROM "Merchants" m
      LEFT JOIN "Transactions" t ON t."merchantId" = m.id
      GROUP BY m.id, m."officialName"
      ORDER BY "transactionCount" DESC, m."officialName" ASC
      LIMIT 40
    `, { type: QueryTypes.SELECT });

    const accountGaps = await db.sequelize.query(`
      SELECT a.id, a.name, a."accountType", a."accountClass", a.currency,
             COUNT(t.id)::int AS "transactionCount",
             MAX(t."transactionDate") AS "latestTransactionDate"
      FROM "Accounts" a
      LEFT JOIN "Transactions" t ON t."accountId" = a.id
      GROUP BY a.id, a.name, a."accountType", a."accountClass", a.currency
      ORDER BY "transactionCount" ASC, a.name ASC
      LIMIT 40
    `, { type: QueryTypes.SELECT });

    const checks = [
      { key: 'missingCategory', label: 'Transactions Missing Category', severity: Number(missingCategory.count) ? 'warning' : 'good', count: Number(missingCategory.count || 0), action: 'Review uncategorized ledger rows before reports are trusted.' },
      { key: 'needsReview', label: 'Draft / Needs Review Transactions', severity: Number(uncleared.count) ? 'warning' : 'good', count: Number(uncleared.count || 0), action: 'Finish review and mark transactions reviewed or reconciled.' },
      { key: 'stagedRows', label: 'Open Staged Import Rows', severity: Number(stagedRows.count) ? 'info' : 'good', count: Number(stagedRows.count || 0), action: 'Use Import Cleanup or Review & Post to close staged rows.' },
      { key: 'duplicateImportRows', label: 'Duplicate Import Rows', severity: Number(duplicateRows.count) ? 'info' : 'good', count: Number(duplicateRows.count || 0), action: 'Duplicates are blocked from posting; purge bad batches if needed.' },
      { key: 'missingMerchant', label: 'Transactions Missing Official Merchant', severity: Number(missingMerchant.count) ? 'warning' : 'good', count: Number(missingMerchant.count || 0), action: 'Run merchant backfill so merchant analytics use official names.' },
      { key: 'duplicateTransactions', label: 'Possible Duplicate Transactions', severity: duplicateTransactions.length ? 'danger' : 'good', count: duplicateTransactions.length, action: 'Review same date/account/amount/description groups.' }
    ];

    res.json({ checks, duplicateTransactions, categoryUse, merchantUse, accountGaps, generatedAt: new Date().toISOString() });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

exports.getLogDashboard = async (req, res) => {
  try {
    const [auditCount] = await db.sequelize.query('SELECT COUNT(*)::int AS count FROM "AuditLogs"', { type: QueryTypes.SELECT });
    const [errorCount] = await db.sequelize.query('SELECT COUNT(*)::int AS count FROM "ErrorLogs" WHERE "resolved" = false', { type: QueryTypes.SELECT });
    const [activityCount] = await db.sequelize.query('SELECT COUNT(*)::int AS count FROM "UserActivityLogs" WHERE "visitedAt" >= NOW() - INTERVAL \'24 hours\'', { type: QueryTypes.SELECT });
    const recentAudit = await db.sequelize.query(`
      SELECT al.id, al.module, al.action, al.date, al.time, al."createdAt", u.username
      FROM "AuditLogs" al
      LEFT JOIN "Users" u ON u.id = al."userId"
      ORDER BY al."createdAt" DESC
      LIMIT 25
    `, { type: QueryTypes.SELECT });
    let errorColumns = {};
    try { errorColumns = await db.sequelize.getQueryInterface().describeTable('ErrorLogs'); } catch (_) {}
    const sourceExpr = errorColumns.source ? 'source' : '\'unknown\' AS source';
    const recentErrors = await db.sequelize.query(`
      SELECT id, ${sourceExpr}, severity, message, url, resolved, "createdAt"
      FROM "ErrorLogs"
      ORDER BY "createdAt" DESC
      LIMIT 25
    `, { type: QueryTypes.SELECT });
    const pageVisits = await db.sequelize.query(`
      SELECT COALESCE("pageTitle", "pagePath", 'Unknown') AS page, COUNT(*)::int AS count
      FROM "UserActivityLogs"
      WHERE "visitedAt" >= NOW() - INTERVAL '7 days'
      GROUP BY COALESCE("pageTitle", "pagePath", 'Unknown')
      ORDER BY count DESC
      LIMIT 12
    `, { type: QueryTypes.SELECT });
    const topActions = await db.sequelize.query(`
      SELECT COALESCE(module, 'Unknown') AS module, COALESCE(action, 'Unknown') AS action, COUNT(*)::int AS count
      FROM "AuditLogs"
      GROUP BY COALESCE(module, 'Unknown'), COALESCE(action, 'Unknown')
      ORDER BY count DESC
      LIMIT 12
    `, { type: QueryTypes.SELECT });
    res.json({
      summary: {
        auditEntries: Number(auditCount.count || 0),
        unresolvedErrors: Number(errorCount.count || 0),
        activity24h: Number(activityCount.count || 0)
      },
      recentAudit,
      recentErrors,
      pageVisits,
      topActions,
      generatedAt: new Date().toISOString()
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

function csvBackupRoot() {
  return path.join(getWritableRoot(), 'backups', 'csv');
}

exports.createCsvBackup = async (req, res) => {
  const root = csvBackupRoot();
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const name = 'csv_backup_' + ts;
  const dir = path.join(root, name);
  try {
    fs.mkdirSync(dir, { recursive: true });
    const manifest = [];
    for (const table of TABLE_META) {
      const columns = await getColumns(table.key);
      const rows = await db.sequelize.query('SELECT * FROM ' + qident(table.key), { type: QueryTypes.SELECT });
      const safeRows = rows.map(maskRow);
      fs.writeFileSync(path.join(dir, table.key + '.csv'), rowsToCsv(columns, safeRows), 'utf8');
      manifest.push({ table: table.key, label: table.label, rows: rows.length });
    }
    fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ name, createdAt: new Date().toISOString(), tables: manifest }, null, 2), 'utf8');
    res.json({ ok: true, name, tables: manifest });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

exports.listCsvBackups = (req, res) => {
  const root = csvBackupRoot();
  try {
    fs.mkdirSync(root, { recursive: true });
    const backups = fs.readdirSync(root).filter((name) => name.startsWith('csv_backup_')).map((name) => {
      const dir = path.join(root, name);
      const stat = fs.statSync(dir);
      let manifest = null;
      try { manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8')); } catch (_) {}
      const files = fs.readdirSync(dir).filter((file) => file.endsWith('.csv'));
      const sizeBytes = files.reduce((sum, file) => sum + fs.statSync(path.join(dir, file)).size, 0);
      return { name, createdAt: stat.birthtime, sizeBytes, files, tables: manifest ? manifest.tables : [] };
    }).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    res.json({ backupPath: root, backups });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

exports.deleteCsvBackup = (req, res) => {
  const name = String(req.params.name || '');
  if (!/^csv_backup_[A-Za-z0-9_.-]+$/.test(name)) return res.status(400).json({ error: 'Invalid backup name.' });
  const dir = path.join(csvBackupRoot(), name);
  try {
    if (!fs.existsSync(dir)) return res.status(404).json({ error: 'Backup not found.' });
    fs.rmSync(dir, { recursive: true, force: true });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

exports.downloadCsvBackupFile = (req, res) => {
  const name = String(req.params.name || '');
  const file = String(req.params.file || '');
  if (!/^csv_backup_[A-Za-z0-9_.-]+$/.test(name) || !/^[A-Za-z0-9_.-]+\.csv$/.test(file)) {
    return res.status(400).json({ error: 'Invalid backup path.' });
  }
  const fp = path.join(csvBackupRoot(), name, file);
  if (!fs.existsSync(fp)) return res.status(404).json({ error: 'File not found.' });
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="' + file + '"');
  res.sendFile(path.resolve(fp));
};

exports.runDbBackup = async (req, res) => {
  try {
    res.json(await backupService.runBackup('backoffice'));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

exports.getBackupStatus = (req, res) => {
  res.json(backupService.getStatus());
};

exports.getUsers = async (req, res) => {
  try {
    const users = await db.User.findAll({
      attributes: [
        'id', 'firstName', 'lastName', 'username', 'email', 'roleId', 'isActive',
        'twoFactorEnabled', 'failedLoginCount', 'lockedUntil', 'tokenVersion',
        'createdAt', 'updatedAt'
      ],
      include: [{ model: db.Role, attributes: ['id', 'name'] }],
      order: [['username', 'ASC']]
    });
    const roles = await db.Role.findAll({ attributes: ['id', 'name'], order: [['name', 'ASC']] });
    res.json({ users, roles });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

exports.updateUser = async (req, res) => {
  try {
    const user = await db.User.findByPk(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found.' });
    const payload = {};
    if (Object.prototype.hasOwnProperty.call(req.body, 'roleId')) payload.roleId = Number(req.body.roleId) || null;
    if (Object.prototype.hasOwnProperty.call(req.body, 'isActive')) payload.isActive = !!req.body.isActive;
    if (Object.prototype.hasOwnProperty.call(req.body, 'notes')) payload.notes = req.body.notes || null;
    await user.update(payload);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

exports.adminResetPassword = async (req, res) => {
  try {
    const user = await db.User.findByPk(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found.' });
    const password = String(req.body.password || '');
    if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' });
    await user.update({
      passwordHash: await bcrypt.hash(password, 12),
      failedLoginCount: 0,
      lockedUntil: null,
      tokenVersion: Number(user.tokenVersion || 0) + 1
    });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

exports.adminUnlockUser = async (req, res) => {
  try {
    const user = await db.User.findByPk(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found.' });
    await user.update({ failedLoginCount: 0, lockedUntil: null });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

exports.adminReset2fa = async (req, res) => {
  try {
    const user = await db.User.findByPk(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found.' });
    await user.update({ twoFactorEnabled: false, twoFactorSecret: null, backupCodes: null });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

exports.purgeTables = async (req, res) => {
  const tables = Array.isArray(req.body && req.body.tables) ? req.body.tables : [];
  const confirmText = String((req.body && req.body.confirmText) || '');
  if (confirmText !== 'PURGE SELECTED ACCOUNTING TABLES') return res.status(400).json({ error: 'Confirmation text did not match.' });
  if (!tables.length) return res.status(400).json({ error: 'No tables selected.' });
  const invalid = tables.filter((key) => !TABLE_BY_KEY.has(key));
  if (invalid.length) return res.status(400).json({ error: 'Unknown tables: ' + invalid.join(', ') });
  const blocked = tables.filter((key) => !TABLE_BY_KEY.get(key).purgeable);
  if (blocked.length) return res.status(400).json({ error: 'Protected tables cannot be purged here: ' + blocked.join(', ') });

  const ordered = TABLE_META.filter((table) => tables.includes(table.key) && table.purgeable);
  const transaction = await db.sequelize.transaction();
  const results = {};
  try {
    if (tables.includes('Categories')) {
      await db.sequelize.query('UPDATE "Categories" SET "parentId" = NULL WHERE "parentId" IS NOT NULL', { transaction });
    }
    for (const table of ordered) {
      const deleted = await db.sequelize.query('DELETE FROM ' + qident(table.key) + ' RETURNING id', { type: QueryTypes.SELECT, transaction });
      results[table.key] = Array.isArray(deleted) ? deleted.length : 0;
    }
    await db.AuditLog.create({
      userId: req.user ? req.user.id : null,
      date: new Date().toISOString().slice(0, 10),
      time: new Date().toTimeString().split(' ')[0],
      module: 'Backoffice',
      action: 'Accounting Table Purge',
      recordId: null,
      previousValue: { tables },
      newValue: { results },
      ipAddress: req.ip || ''
    }, { transaction });
    await transaction.commit();
    res.json({ ok: true, results });
  } catch (e) {
    await transaction.rollback();
    res.status(500).json({
      error: e.message,
      hint: 'Some selected tables may still be referenced by unselected tables. Select dependent ledger/import tables first or use the focused cleanup tools.'
    });
  }
};

exports.TABLE_META = TABLE_META;
