const csv = require('csv-parser');
const { Readable } = require('stream');
const db = require('../models');

const TEMPLATES = {
  accounts: ['name', 'accountCode', 'accountType', 'accountClass', 'accountSubtype', 'currency', 'financialInstitutionName', 'openingBalance', 'openingBalanceDate', 'currentBalance', 'creditLimit', 'interestRate', 'includeInNetWorth', 'status', 'notes'],
  transactions: ['transactionDate', 'accountName', 'categoryName', 'relatedAccountName', 'description', 'merchant', 'transactionType', 'amount', 'currency', 'originalAmount', 'originalCurrency', 'exchangeRate', 'status', 'referenceNumber', 'tags', 'clearedDate', 'memo'],
  categories: ['name', 'categoryType', 'groupName', 'budgetBehavior', 'parentName', 'taxRelevant', 'isActive'],
  budgets: ['name', 'year', 'month', 'categoryName', 'budgetType', 'plannedAmount', 'currency', 'alertThresholdPct', 'isActive', 'notes'],
  recurring: ['name', 'accountName', 'categoryName', 'transactionType', 'amount', 'currency', 'frequency', 'nextDate', 'endDate', 'merchant', 'isActive', 'notes'],
  goals: ['name', 'goalType', 'accountName', 'targetAmount', 'currentAmount', 'currency', 'targetDate', 'priority', 'status', 'notes'],
  investments: ['accountName', 'symbol', 'name', 'assetClass', 'quantity', 'costBasis', 'marketValue', 'currency', 'priceDate', 'notes'],
  currency_rates: ['rateDate', 'fromCurrency', 'toCurrency', 'rate', 'source', 'notes'],
  balance_snapshots: ['accountName', 'snapshotDate', 'balance', 'currency', 'source', 'notes'],
  proofs: ['ownerType', 'ownerExternalRef', 'originalName', 'provider', 'driveWebViewLink', 'localPath', 'notes']
};

function parseCsv(buffer) {
  return new Promise((resolve, reject) => {
    const rows = [];
    Readable.from(buffer.toString('utf8'))
      .pipe(csv())
      .on('data', row => rows.push(row))
      .on('end', () => resolve(rows))
      .on('error', reject);
  });
}

exports.getTemplate = (req, res) => {
  const headers = TEMPLATES[req.params.dataset];
  if (!headers) return res.status(404).json({ error: 'Unknown accounting import template.' });
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${req.params.dataset}_template.csv"`);
  res.send(headers.join(',') + '\n');
};

exports.getBatches = async (req, res) => {
  const batches = await db.ImportBatch.findAll({
    include: [{ model: db.User, as: 'CreatedBy', attributes: ['id', 'firstName', 'lastName', 'username'] }],
    order: [['createdAt', 'DESC']],
    limit: 100
  });
  res.json(batches.map((batch) => ({
    id: batch.id,
    importType: batch.importType,
    fileName: batch.fileName,
    status: batch.status,
    rowCount: batch.rowCount,
    acceptedCount: batch.acceptedCount,
    rejectedCount: batch.rejectedCount,
    notes: batch.notes,
    createdAt: batch.createdAt,
    createdBy: batch.CreatedBy ? `${batch.CreatedBy.firstName || ''} ${batch.CreatedBy.lastName || ''}`.trim() || batch.CreatedBy.username : ''
  })));
};

exports.getBatchRows = async (req, res) => {
  const rows = await db.ImportRow.findAll({
    where: { importBatchId: req.params.id },
    order: [['rowNumber', 'ASC']],
    limit: 500
  });
  res.json(rows);
};

exports.importDataset = async (req, res) => {
  const dataset = req.params.dataset;
  if (!TEMPLATES[dataset]) return res.status(404).json({ error: 'Unknown accounting import dataset.' });
  if (!req.file) return res.status(400).json({ error: 'CSV file is required.' });

  const rows = await parseCsv(req.file.buffer);
  const batch = await db.sequelize.transaction(async (transaction) => {
    const created = await db.ImportBatch.create({
      importType: dataset,
      fileName: req.file.originalname,
      status: 'staged',
      rowCount: rows.length,
      acceptedCount: 0,
      rejectedCount: 0,
      notes: 'Rows staged only. Curated importer mapping is intentionally not auto-posting to the ledger yet.',
      createdByUserId: req.user && req.user.id
    }, { transaction });

    if (rows.length) {
      await db.ImportRow.bulkCreate(rows.map((row, index) => ({
        importBatchId: created.id,
        rowNumber: index + 1,
        rawData: row,
        normalizedData: null,
        status: 'staged'
      })), { transaction });
    }
    return created;
  });

  res.json({
    ok: true,
    batchId: batch.id,
    rowCount: rows.length,
    message: 'Curated import file received and staged row-by-row. No ledger data was posted automatically.'
  });
};
