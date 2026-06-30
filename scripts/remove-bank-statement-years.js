'use strict';

const fs = require('fs');
const path = require('path');
const { Op } = require('sequelize');
const db = require('../models');

const ROOT = path.resolve(__dirname, '..');
const CONFIRM_TEXT = 'REMOVE_BANK_STATEMENT_YEARS';
const args = process.argv.slice(2);

function hasFlag(flag) {
  return args.includes(flag);
}

function argValue(name, fallback = '') {
  const prefix = `${name}=`;
  const found = args.find((arg) => arg.startsWith(prefix));
  return found ? found.slice(prefix.length) : fallback;
}

function parseYears() {
  return argValue('--years')
    .split(',')
    .map((year) => year.trim())
    .filter((year) => /^\d{4}$/.test(year));
}

function parseJson(value, fallback = {}) {
  if (!value) return fallback;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch (err) {
    return fallback;
  }
}

function statementYear(batch) {
  const notes = parseJson(batch.notes);
  const metadata = notes.metadata || {};
  const date = metadata.statementDate || metadata.billingPeriodEnd || metadata.billingPeriodStart || '';
  return String(date).slice(0, 4);
}

function safeJson(value) {
  return JSON.stringify(value, null, 2);
}

function writeBackup(payload) {
  const backupDir = path.join(ROOT, 'backups', 'import-reset');
  fs.mkdirSync(backupDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = path.join(backupDir, `bank-statement-year-removal-${payload.years.join('-')}-${stamp}.json`);
  fs.writeFileSync(backupPath, safeJson({
    createdAt: new Date().toISOString(),
    scope: `bank_statement_year_removal:${payload.years.join(',')}`,
    ...payload
  }), 'utf8');
  return backupPath;
}

function summarize(data) {
  const byYear = {};
  data.batches.forEach((batch) => {
    const year = statementYear(batch) || 'unknown';
    if (!byYear[year]) byYear[year] = { batches: 0, rows: 0, transactions: 0 };
    byYear[year].batches += 1;
  });
  data.rows.forEach((row) => {
    const batch = data.batchesById.get(row.importBatchId);
    const year = batch ? statementYear(batch) : 'unknown';
    if (!byYear[year]) byYear[year] = { batches: 0, rows: 0, transactions: 0 };
    byYear[year].rows += 1;
  });
  data.transactions.forEach((transaction) => {
    const row = data.rowsByPostedTransactionId.get(transaction.id);
    const batch = row ? data.batchesById.get(row.importBatchId) : null;
    const year = batch ? statementYear(batch) : String(transaction.transactionDate || '').slice(0, 4) || 'unknown';
    if (!byYear[year]) byYear[year] = { batches: 0, rows: 0, transactions: 0 };
    byYear[year].transactions += 1;
  });
  return {
    batches: data.batches.length,
    importRows: data.rows.length,
    linkedTransactions: data.transactions.length,
    accountSnapshots: data.snapshots.length,
    byYear
  };
}

async function collectData(years) {
  const allBatches = await db.ImportBatch.findAll({
    where: { importType: { [Op.like]: 'bank_statement_%' } },
    order: [['id', 'ASC']],
    raw: true
  });
  const batches = allBatches.filter((batch) => years.includes(statementYear(batch)));
  const batchIds = batches.map((batch) => batch.id);
  const rows = batchIds.length
    ? await db.ImportRow.findAll({
        where: { importBatchId: { [Op.in]: batchIds } },
        order: [['importBatchId', 'ASC'], ['rowNumber', 'ASC']],
        raw: true
      })
    : [];
  const transactionIds = Array.from(new Set(rows.map((row) => row.postedTransactionId).filter(Boolean)));
  const transactions = transactionIds.length
    ? await db.Transaction.findAll({
        where: { id: { [Op.in]: transactionIds } },
        order: [['id', 'ASC']],
        raw: true
      })
    : [];
  const snapshots = await db.AccountBalanceSnapshot.findAll({
    where: {
      snapshotDate: {
        [Op.gte]: `${Math.min(...years.map(Number))}-01-01`,
        [Op.lte]: `${Math.max(...years.map(Number))}-12-31`
      },
      source: { [Op.in]: ['statement_sync', 'statement_import_checkpoint'] }
    },
    order: [['id', 'ASC']],
    raw: true
  });

  return {
    years,
    batches,
    rows,
    transactions,
    snapshots,
    batchesById: new Map(batches.map((batch) => [batch.id, batch])),
    rowsByPostedTransactionId: new Map(rows.filter((row) => row.postedTransactionId).map((row) => [row.postedTransactionId, row]))
  };
}

async function applyRemoval(data) {
  const batchIds = data.batches.map((batch) => batch.id);
  const rowIds = data.rows.map((row) => row.id);
  const transactionIds = data.transactions.map((transaction) => transaction.id);
  const snapshotIds = data.snapshots.map((snapshot) => snapshot.id);
  const deleted = {
    transactions: 0,
    importRows: 0,
    importBatches: 0,
    accountSnapshots: 0
  };

  await db.sequelize.transaction(async (transaction) => {
    if (transactionIds.length) {
      deleted.transactions = await db.Transaction.destroy({
        where: { id: { [Op.in]: transactionIds } },
        transaction
      });
    }
    if (rowIds.length) {
      deleted.importRows = await db.ImportRow.destroy({
        where: { id: { [Op.in]: rowIds } },
        transaction
      });
    }
    if (batchIds.length) {
      deleted.importBatches = await db.ImportBatch.destroy({
        where: { id: { [Op.in]: batchIds } },
        transaction
      });
    }
    if (snapshotIds.length) {
      deleted.accountSnapshots = await db.AccountBalanceSnapshot.destroy({
        where: { id: { [Op.in]: snapshotIds } },
        transaction
      });
    }
  });

  return deleted;
}

async function main() {
  const years = parseYears();
  if (!years.length) {
    console.error('Provide one or more years, for example --years=2016,2017');
    process.exitCode = 1;
    return;
  }

  const apply = hasFlag('--apply');
  const confirm = argValue('--confirm');
  const data = await collectData(years);
  const summary = summarize(data);

  if (!apply) {
    console.log(safeJson({
      apply: false,
      years,
      summary,
      message: `Dry run only. Re-run with --apply --confirm=${CONFIRM_TEXT} to remove these bank statement years.`
    }));
    return;
  }

  if (confirm !== CONFIRM_TEXT) {
    console.error(`Refusing to remove data without --confirm=${CONFIRM_TEXT}`);
    process.exitCode = 1;
    return;
  }

  const backupPath = writeBackup({
    years,
    summary,
    data: {
      batches: data.batches,
      rows: data.rows,
      transactions: data.transactions,
      snapshots: data.snapshots
    }
  });
  const deleted = await applyRemoval(data);
  console.log(safeJson({
    apply: true,
    years,
    backupPath: path.relative(ROOT, backupPath),
    before: summary,
    deleted
  }));
}

main()
  .catch((err) => {
    console.error(err.stack || err.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.sequelize.close().catch(() => {});
  });
