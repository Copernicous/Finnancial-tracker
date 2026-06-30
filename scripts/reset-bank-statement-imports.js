'use strict';

const fs = require('fs');
const path = require('path');
const { Op } = require('sequelize');
const db = require('../models');

const ROOT = path.resolve(__dirname, '..');
const CONFIRM_TEXT = 'RESET_BANK_STATEMENT_IMPORTS';

function hasFlag(flag) {
  return process.argv.includes(flag);
}

function getArgValue(name) {
  const prefix = `${name}=`;
  const found = process.argv.find((arg) => arg.startsWith(prefix));
  return found ? found.slice(prefix.length) : null;
}

function selectedProfile() {
  return getArgValue('--profile') || getArgValue('--only-profile') || null;
}

function importTypeForProfile(profile) {
  return profile ? `bank_statement_${profile}` : null;
}

function safeJson(value) {
  return JSON.stringify(value, null, 2);
}

function rowReferenceNumber(row) {
  const normalized = row.normalizedData || {};
  return normalized.referenceNumber || null;
}

async function collectBankStatementImportData(profile) {
  const importType = importTypeForProfile(profile);
  const batches = await db.ImportBatch.findAll({
    where: {
      importType: importType || { [Op.like]: 'bank_statement_%' }
    },
    order: [['id', 'ASC']],
    raw: true
  });
  const batchIds = batches.map((batch) => batch.id);
  const rows = batchIds.length
    ? await db.ImportRow.findAll({
      where: { importBatchId: { [Op.in]: batchIds } },
      order: [['importBatchId', 'ASC'], ['rowNumber', 'ASC']],
      raw: true
    })
    : [];
  const referenceNumbers = Array.from(new Set(rows.map(rowReferenceNumber).filter(Boolean)));
  const transactionWhere = profile
    ? {
        sourceType: 'bank_statement',
        referenceNumber: referenceNumbers.length ? { [Op.in]: referenceNumbers } : '__no_reference_numbers__'
      }
    : { sourceType: 'bank_statement' };
  const transactions = await db.Transaction.findAll({
    where: transactionWhere,
    order: [['id', 'ASC']],
    raw: true
  });

  return { profile: profile || null, importType: importType || null, batches, rows, transactions };
}

function summarize(data) {
  const batchesByType = data.batches.reduce((acc, batch) => {
    acc[batch.importType] = (acc[batch.importType] || 0) + 1;
    return acc;
  }, {});
  const batchesByStatus = data.batches.reduce((acc, batch) => {
    acc[batch.status] = (acc[batch.status] || 0) + 1;
    return acc;
  }, {});
  return {
    batches: data.batches.length,
    rows: data.rows.length,
    ledgerTransactions: data.transactions.length,
    batchesByType,
    batchesByStatus
  };
}

function writeBackup(data) {
  const backupDir = path.join(ROOT, 'backups', 'import-reset');
  fs.mkdirSync(backupDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = path.join(backupDir, `bank-statement-import-reset-${stamp}.json`);
  fs.writeFileSync(backupPath, safeJson({
    createdAt: new Date().toISOString(),
    scope: data.profile ? `bank_statement_imports_only:${data.profile}` : 'bank_statement_imports_only',
    summary: summarize(data),
    data
  }), 'utf8');
  return backupPath;
}

async function applyReset(data) {
  const batchIds = data.batches.map((batch) => batch.id);
  const transactionIds = data.transactions.map((transaction) => transaction.id);
  const result = {
    deletedImportRows: 0,
    deletedImportBatches: 0,
    deletedLedgerTransactions: 0
  };

  await db.sequelize.transaction(async (transaction) => {
    if (batchIds.length) {
      result.deletedImportRows = await db.ImportRow.destroy({
        where: { importBatchId: { [Op.in]: batchIds } },
        transaction
      });
      result.deletedImportBatches = await db.ImportBatch.destroy({
        where: { id: { [Op.in]: batchIds } },
        transaction
      });
    }
    if (transactionIds.length) {
      result.deletedLedgerTransactions = await db.Transaction.destroy({
        where: {
          id: { [Op.in]: transactionIds },
          sourceType: 'bank_statement'
        },
        transaction
      });
    }
  });

  return result;
}

async function main() {
  const apply = hasFlag('--apply');
  const confirm = getArgValue('--confirm');
  const profile = selectedProfile();
  const data = await collectBankStatementImportData(profile);
  const summary = summarize(data);

  if (!apply) {
    console.log(safeJson({
      apply: false,
      profile,
      summary,
      message: `Dry run only. Re-run with --apply --confirm=${CONFIRM_TEXT} to reset bank statement import data.`
    }));
    return;
  }

  if (confirm !== CONFIRM_TEXT) {
    console.error(`Refusing to reset without --confirm=${CONFIRM_TEXT}`);
    process.exitCode = 1;
    return;
  }

  const backupPath = writeBackup(data);
  const deleted = await applyReset(data);
  console.log(safeJson({
    apply: true,
    profile,
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
