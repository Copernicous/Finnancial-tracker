const csv = require('csv-parser');
const { Readable } = require('stream');
const crypto = require('crypto');
const { Op } = require('sequelize');
const db = require('../models');
const { parseBankStatement } = require('../services/bankStatementParser');

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

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function cleanId(value) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function cleanText(value) {
  return String(value == null ? '' : value).trim();
}

function cleanDate(value) {
  const text = cleanText(value);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

function parseJsonField(value, fallback) {
  if (!value) return fallback;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch (err) {
    return fallback;
  }
}

function batchNotes(batch) {
  return parseJsonField(batch && batch.notes, {});
}

function normalizeDraft(input, defaults = {}) {
  const source = input || {};
  const accountId = cleanId(source.accountId) || cleanId(defaults.accountId);
  const categoryId = cleanId(source.categoryId) || cleanId(defaults.categoryId);
  const relatedAccountId = cleanId(source.relatedAccountId);
  const amount = toNumber(source.amount);
  const transactionType = cleanText(source.transactionType || defaults.transactionType || 'expense').toLowerCase();
  const currency = cleanText(source.currency || defaults.currency || 'USD').toUpperCase();
  const transactionStatus = cleanText(source.status || defaults.status || 'draft').toLowerCase();

  return {
    transactionDate: cleanDate(source.transactionDate),
    saleDate: cleanDate(source.saleDate),
    accountId,
    categoryId,
    relatedAccountId,
    description: cleanText(source.description),
    merchant: cleanText(source.merchant || source.description),
    normalizedMerchant: cleanText(source.merchant || source.description).toLowerCase(),
    transactionType: ['income', 'expense', 'transfer', 'adjustment'].includes(transactionType) ? transactionType : 'expense',
    amount,
    currency: currency || 'USD',
    originalAmount: source.originalAmount == null || source.originalAmount === '' ? null : toNumber(source.originalAmount),
    originalCurrency: cleanText(source.originalCurrency).toUpperCase() || null,
    exchangeRate: source.exchangeRate == null || source.exchangeRate === '' ? null : toNumber(source.exchangeRate),
    status: ['draft', 'reviewed', 'reconciled'].includes(transactionStatus) ? transactionStatus : 'draft',
    sourceType: cleanText(source.sourceType || defaults.sourceType || 'bank_statement') || 'bank_statement',
    referenceNumber: cleanText(source.referenceNumber),
    tags: cleanText(source.tags),
    clearedDate: cleanDate(source.clearedDate),
    memo: cleanText(source.memo),
    statementAmount: source.statementAmount == null ? null : toNumber(source.statementAmount),
    statementSection: cleanText(source.statementSection),
    cardholder: cleanText(source.cardholder),
    confidence: source.confidence == null ? null : toNumber(source.confidence),
    parserVersion: cleanText(source.parserVersion)
  };
}

function validateDraft(draft) {
  const errors = [];
  if (!draft.transactionDate) errors.push('transaction date');
  if (!draft.accountId) errors.push('account');
  if (!draft.description) errors.push('description');
  if (draft.amount == null) errors.push('amount');
  if (!draft.transactionType) errors.push('transaction type');
  return errors;
}

function mergeTags(tags, extra) {
  const values = String(tags || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  extra.forEach((item) => {
    if (item && !values.includes(item)) values.push(item);
  });
  return values.join(',');
}

async function refreshBatchCounts(batchId, transaction) {
  const rows = await db.ImportRow.findAll({
    where: { importBatchId: batchId },
    attributes: ['status'],
    transaction
  });
  const posted = rows.filter((row) => row.status === 'posted').length;
  const closed = rows.filter((row) => ['posted', 'rejected', 'duplicate'].includes(row.status)).length;
  const failed = rows.filter((row) => ['rejected', 'duplicate', 'error'].includes(row.status)).length;
  const status = rows.length && closed === rows.length
    ? (posted ? 'posted' : 'closed')
    : (posted ? 'partially_posted' : 'staged');
  await db.ImportBatch.update({
    acceptedCount: posted,
    rejectedCount: failed,
    status
  }, { where: { id: batchId }, transaction });
  return { posted, failed, status, total: rows.length };
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

exports.updateBatchRows = async (req, res) => {
  const batch = await db.ImportBatch.findByPk(req.params.id);
  if (!batch) return res.status(404).json({ error: 'Import batch not found.' });

  const incomingRows = Array.isArray(req.body.rows) ? req.body.rows : [];
  if (!incomingRows.length) return res.status(400).json({ error: 'No rows were provided.' });

  const allowedStatuses = new Set(['staged', 'ready', 'rejected', 'error']);
  const rowIds = incomingRows.map((row) => cleanId(row.id)).filter(Boolean);
  const currentRows = await db.ImportRow.findAll({
    where: { importBatchId: batch.id, id: { [Op.in]: rowIds } }
  });
  const rowMap = new Map(currentRows.map((row) => [Number(row.id), row]));
  let updated = 0;

  await db.sequelize.transaction(async (transaction) => {
    for (const incoming of incomingRows) {
      const row = rowMap.get(cleanId(incoming.id));
      if (!row || row.status === 'posted' || row.status === 'duplicate') continue;

      const existing = parseJsonField(row.normalizedData, {});
      const draft = normalizeDraft({ ...existing, ...(incoming.normalizedData || incoming) }, {
        accountId: row.matchedAccountId,
        categoryId: row.matchedCategoryId,
        sourceType: batch.importType && batch.importType.startsWith('bank_statement') ? 'bank_statement' : 'import_batch'
      });
      const nextStatus = cleanText(incoming.rowStatus || incoming.status || row.status);
      await row.update({
        normalizedData: draft,
        status: allowedStatuses.has(nextStatus) ? nextStatus : row.status,
        matchedAccountId: draft.accountId,
        matchedCategoryId: draft.categoryId,
        errorMessage: null
      }, { transaction });
      updated += 1;
    }
    await refreshBatchCounts(batch.id, transaction);
  });

  res.json({ ok: true, updated });
};

exports.getBankStatementProfiles = async (req, res) => {
  res.json([
    {
      key: 'advantage_citi_pdf',
      label: 'Advantage / Citi Credit Card PDF',
      institution: 'Citi Advantage',
      fileTypes: ['pdf'],
      importMode: 'stage_only',
      posting: 'manual_review_required'
    }
  ]);
};

exports.importBankStatement = async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Statement file is required.' });

  const profile = req.body.profile || 'advantage_citi_pdf';
  const requestedAccountId = req.body.accountId ? Number(req.body.accountId) : null;
  const accountId = Number.isInteger(requestedAccountId) && requestedAccountId > 0 ? requestedAccountId : null;
  const hash = crypto.createHash('sha256').update(req.file.buffer).digest('hex');
  const existingBatch = await db.ImportBatch.findOne({
    where: {
      importType: 'bank_statement_' + profile,
      notes: { [Op.iLike]: `%${hash}%` }
    },
    order: [['id', 'ASC']]
  });
  if (existingBatch) {
    return res.status(409).json({
      ok: false,
      duplicate: true,
      existingBatchId: existingBatch.id,
      existingBatchStatus: existingBatch.status,
      message: `This exact statement file was already staged as batch #${existingBatch.id}. Open that batch to review or post it.`
    });
  }

  const parsed = await parseBankStatement({ buffer: req.file.buffer, profile });
  const fingerprints = parsed.transactions.map((row) => row.fingerprint).filter(Boolean);
  const existingTransactions = fingerprints.length ? await db.Transaction.findAll({
    where: {
      sourceType: 'bank_statement',
      referenceNumber: { [Op.in]: fingerprints }
    },
    attributes: ['id', 'referenceNumber']
  }) : [];
  const existingRefs = new Map(existingTransactions.map((tx) => [tx.referenceNumber, tx.id]));
  const seenRefs = new Set();
  const stagedRows = parsed.transactions.map((row) => {
    const alreadyPosted = row.fingerprint && existingRefs.has(row.fingerprint);
    const repeatedInUpload = row.fingerprint && seenRefs.has(row.fingerprint);
    if (row.fingerprint) seenRefs.add(row.fingerprint);
    return {
      row,
      status: alreadyPosted || repeatedInUpload ? 'duplicate' : 'staged',
      duplicateReason: alreadyPosted
        ? 'A ledger transaction already exists for this statement fingerprint.'
        : (repeatedInUpload ? 'This upload contains the same statement fingerprint more than once.' : null),
      duplicateTransactionId: alreadyPosted ? existingRefs.get(row.fingerprint) : null
    };
  });
  const duplicateCount = stagedRows.filter((item) => item.status === 'duplicate').length;

  const notesPayload = {
    source: 'bank_statement_web_upload',
    profile,
    parserVersion: parsed.parserVersion,
    fileHashSha256: hash,
    originalFileName: req.file.originalname,
    pageCount: parsed.pageCount,
    lineCount: parsed.lineCount,
    metadata: parsed.metadata,
    warnings: parsed.warnings || [],
    postingPolicy: 'stage_only_no_ledger_posting'
  };

  const batch = await db.sequelize.transaction(async (transaction) => {
    const created = await db.ImportBatch.create({
      importType: 'bank_statement_' + profile,
      fileName: req.file.originalname,
      status: parsed.transactions.length && duplicateCount < parsed.transactions.length ? 'staged' : 'needs_review',
      rowCount: parsed.transactions.length,
      acceptedCount: 0,
      rejectedCount: duplicateCount,
      notes: JSON.stringify(notesPayload),
      createdByUserId: req.user && req.user.id
    }, { transaction });

    if (parsed.transactions.length) {
      await db.ImportRow.bulkCreate(stagedRows.map((item, index) => {
        const row = item.row;
        return {
        importBatchId: created.id,
        rowNumber: index + 1,
        rawData: {
          ...row,
          duplicateReason: item.duplicateReason,
          duplicateTransactionId: item.duplicateTransactionId
        },
        normalizedData: {
          transactionDate: row.postDate,
          saleDate: row.saleDate,
          accountId,
          description: row.description,
          merchant: row.description,
          transactionType: row.suggestedLedgerType,
          amount: row.suggestedLedgerAmount,
          currency: row.currency || 'USD',
          status: 'draft',
          sourceType: 'bank_statement',
          referenceNumber: row.fingerprint,
          tags: ['bank-statement', profile, row.transactionType].filter(Boolean).join(','),
          statementAmount: row.amount,
          statementSection: row.section,
          cardholder: row.cardholder,
          confidence: row.confidence,
          parserVersion: parsed.parserVersion
        },
        status: item.status,
        errorMessage: item.duplicateReason,
        matchedAccountId: accountId
      };
      }), { transaction });
    }

    return created;
  });

  res.json({
    ok: true,
    batchId: batch.id,
    profile,
    rowCount: parsed.transactions.length,
    duplicateCount,
    metadata: parsed.metadata,
    warnings: parsed.warnings || [],
    previewRows: stagedRows.slice(0, 50).map((item) => ({
      ...item.row,
      rowStatus: item.status,
      duplicateReason: item.duplicateReason,
      duplicateTransactionId: item.duplicateTransactionId
    })),
    message: 'Bank statement parsed and staged for review. No ledger data was posted.'
  });
};

exports.postBatchRows = async (req, res) => {
  const batch = await db.ImportBatch.findByPk(req.params.id);
  if (!batch) return res.status(404).json({ error: 'Import batch not found.' });
  const notes = batchNotes(batch);
  if (notes.fileHashSha256) {
    const originalBatch = await db.ImportBatch.findOne({
      where: {
        importType: batch.importType,
        id: { [Op.lt]: batch.id },
        notes: { [Op.iLike]: `%${notes.fileHashSha256}%` }
      },
      order: [['id', 'ASC']]
    });
    if (originalBatch) {
      return res.status(409).json({
        ok: false,
        duplicate: true,
        existingBatchId: originalBatch.id,
        message: `This batch is a duplicate of batch #${originalBatch.id}. Open the original batch to review or post it.`
      });
    }
  }

  const incomingRows = Array.isArray(req.body.rows) ? req.body.rows : [];
  if (!incomingRows.length) return res.status(400).json({ error: 'Select at least one staged row to post.' });

  const defaults = {
    accountId: cleanId(req.body.accountId),
    categoryId: cleanId(req.body.categoryId),
    status: cleanText(req.body.transactionStatus || 'draft'),
    sourceType: batch.importType && batch.importType.startsWith('bank_statement') ? 'bank_statement' : 'import_batch'
  };
  const requestedIds = incomingRows.map((row) => cleanId(row.id)).filter(Boolean);
  const currentRows = await db.ImportRow.findAll({
    where: {
      importBatchId: batch.id,
      id: { [Op.in]: requestedIds }
    },
    order: [['rowNumber', 'ASC']]
  });
  const incomingById = new Map(incomingRows.map((row) => [cleanId(row.id), row]));
  const referenceNumbers = [];
  const drafts = currentRows.map((row) => {
    const incoming = incomingById.get(Number(row.id)) || {};
    const existing = parseJsonField(row.normalizedData, {});
    const draft = normalizeDraft({ ...existing, ...(incoming.normalizedData || incoming) }, {
      ...defaults,
      accountId: existing.accountId || row.matchedAccountId || defaults.accountId,
      categoryId: existing.categoryId || row.matchedCategoryId || defaults.categoryId
    });
    if (draft.referenceNumber) referenceNumbers.push(draft.referenceNumber);
    return { row, draft };
  });

  const existingTransactions = referenceNumbers.length ? await db.Transaction.findAll({
    where: {
      sourceType: defaults.sourceType,
      referenceNumber: { [Op.in]: referenceNumbers }
    },
    attributes: ['id', 'referenceNumber']
  }) : [];
  const existingRefs = new Map(existingTransactions.map((tx) => [tx.referenceNumber, tx.id]));
  const seenRefs = new Set();
  const result = { posted: 0, duplicates: 0, errors: [] };

  await db.sequelize.transaction(async (transaction) => {
    for (const { row, draft } of drafts) {
      if (row.status === 'posted' || row.status === 'duplicate' || row.status === 'rejected') {
        result.duplicates += 1;
        continue;
      }

      const validationErrors = validateDraft(draft);
      if (validationErrors.length) {
        const message = 'Missing required posting fields: ' + validationErrors.join(', ');
        await row.update({ status: 'error', normalizedData: draft, errorMessage: message }, { transaction });
        result.errors.push({ rowId: row.id, rowNumber: row.rowNumber, error: message });
        continue;
      }

      if (draft.referenceNumber && (existingRefs.has(draft.referenceNumber) || seenRefs.has(draft.referenceNumber))) {
        await row.update({
          status: 'duplicate',
          normalizedData: draft,
          errorMessage: existingRefs.has(draft.referenceNumber)
            ? 'A ledger transaction already exists for this statement fingerprint.'
            : 'This posting selection contains the same statement fingerprint more than once.'
        }, { transaction });
        result.duplicates += 1;
        continue;
      }

      const tx = await db.Transaction.create({
        transactionDate: draft.transactionDate,
        accountId: draft.accountId,
        categoryId: draft.categoryId,
        relatedAccountId: draft.relatedAccountId,
        description: draft.description,
        merchant: draft.merchant,
        normalizedMerchant: draft.normalizedMerchant,
        transactionType: draft.transactionType,
        amount: draft.amount,
        currency: draft.currency,
        originalAmount: draft.originalAmount,
        originalCurrency: draft.originalCurrency,
        exchangeRate: draft.exchangeRate,
        status: draft.status,
        sourceType: draft.sourceType,
        referenceNumber: draft.referenceNumber,
        tags: mergeTags(draft.tags, ['imported', `batch-${batch.id}`]),
        clearedDate: draft.clearedDate,
        isRecurring: false,
        memo: draft.memo || [
          draft.statementSection ? `Statement section: ${draft.statementSection}` : '',
          draft.cardholder ? `Cardholder: ${draft.cardholder}` : ''
        ].filter(Boolean).join(' | '),
        reviewedByUserId: ['reviewed', 'reconciled'].includes(draft.status) && req.user ? req.user.id : null,
        reviewedAt: ['reviewed', 'reconciled'].includes(draft.status) ? new Date() : null,
        isSimulation: false
      }, { transaction });

      if (draft.referenceNumber) seenRefs.add(draft.referenceNumber);
      await row.update({
        status: 'posted',
        normalizedData: draft,
        matchedAccountId: draft.accountId,
        matchedCategoryId: draft.categoryId,
        postedTransactionId: tx.id,
        errorMessage: null
      }, { transaction });
      result.posted += 1;
    }
    result.batch = await refreshBatchCounts(batch.id, transaction);
  });

  res.json({
    ok: true,
    message: `${result.posted} row(s) posted to the ledger.`,
    posted: result.posted,
    duplicates: result.duplicates,
    errors: result.errors,
    batch: result.batch
  });
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
