const csv = require('csv-parser');
const { Readable } = require('stream');
const db = require('../models');

const TEMPLATES = {
  accounts: ['name', 'accountCode', 'accountType', 'currency', 'financialInstitutionName', 'openingBalance', 'openingBalanceDate', 'notes'],
  transactions: ['transactionDate', 'accountName', 'categoryName', 'description', 'transactionType', 'amount', 'currency', 'status', 'referenceNumber', 'memo'],
  categories: ['name', 'categoryType', 'parentName', 'taxRelevant'],
  proofs: ['ownerType', 'ownerExternalRef', 'originalName', 'notes']
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

exports.importDataset = async (req, res) => {
  const dataset = req.params.dataset;
  if (!TEMPLATES[dataset]) return res.status(404).json({ error: 'Unknown accounting import dataset.' });
  if (!req.file) return res.status(400).json({ error: 'CSV file is required.' });

  const rows = await parseCsv(req.file.buffer);
  const batch = await db.ImportBatch.create({
    importType: dataset,
    fileName: req.file.originalname,
    status: 'staged',
    rowCount: rows.length,
    acceptedCount: 0,
    rejectedCount: rows.length,
    notes: 'Rows staged only. Curated importer mapping is intentionally not auto-posting to the ledger yet.',
    createdByUserId: req.user && req.user.id
  });

  res.json({
    ok: true,
    batchId: batch.id,
    rowCount: rows.length,
    message: 'Curated import file received and staged. No ledger data was posted automatically.'
  });
};
