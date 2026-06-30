const csv = require('csv-parser');
const { Readable } = require('stream');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { Op } = require('sequelize');
const db = require('../models');
const { parseBankStatement, PROFILE_CONFIG } = require('../services/bankStatementParser');
const merchantCategorizer = require('../services/merchantCategorizer');
const merchantResolver = require('../services/merchantResolver');
const ROOT = path.resolve(__dirname, '..');

const TEMPLATES = {
  accounts: ['name', 'accountCode', 'accountType', 'accountClass', 'accountSubtype', 'currency', 'financialInstitutionName', 'openingBalance', 'openingBalanceDate', 'currentBalance', 'creditLimit', 'interestRate', 'includeInNetWorth', 'status', 'notes'],
  transactions: ['transactionDate', 'accountName', 'categoryName', 'relatedAccountName', 'description', 'merchant', 'transactionType', 'amount', 'currency', 'originalAmount', 'originalCurrency', 'exchangeRate', 'status', 'referenceNumber', 'tags', 'clearedDate', 'memo'],
  categories: ['name', 'categoryType', 'groupName', 'budgetBehavior', 'parentName', 'taxRelevant', 'isActive', 'merchantKeywords'],
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

function csvEscape(value) {
  const text = String(value == null ? '' : value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
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

function cleanBoolean(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  const text = cleanText(value).toLowerCase();
  if (['1', 'true', 'yes', 'y', 'active', 'enabled'].includes(text)) return true;
  if (['0', 'false', 'no', 'n', 'inactive', 'disabled'].includes(text)) return false;
  return fallback;
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

function batchPdfPath(batch) {
  const notes = batchNotes(batch);
  const sourceCopies = Array.isArray(notes.sourceCopies) ? notes.sourceCopies : [];
  const candidates = [
    notes.relativePath,
    ...sourceCopies.map((copy) => copy && copy.relativePath)
  ].filter((value) => /\.pdf$/i.test(String(value || '')));

  for (const relativePath of candidates) {
    const resolved = path.resolve(ROOT, relativePath);
    const relativeToRoot = path.relative(ROOT, resolved);
    if (!relativeToRoot || relativeToRoot.startsWith('..') || path.isAbsolute(relativeToRoot)) continue;
    if (fs.existsSync(resolved)) return resolved;
  }
  return null;
}

function batchArchiveMetadata(batch) {
  const notes = batchNotes(batch);
  return {
    notes,
    archived: notes.archived === true,
    archivedAt: notes.archivedAt || null,
    archiveReason: notes.archiveReason || ''
  };
}

function editableBatchNotes(batch) {
  const notes = batchNotes(batch);
  const rawNotes = batch && typeof batch.notes === 'string' ? batch.notes.trim() : '';
  if (!rawNotes) return notes;
  try {
    JSON.parse(rawNotes);
    return notes;
  } catch (err) {
    return { originalNotes: rawNotes };
  }
}

function canonicalBankStatementProfile(profile) {
  const config = PROFILE_CONFIG[profile] || {};
  return config.canonicalProfile || config.profile || profile;
}

async function getStoredMerchantRules() {
  const row = await db.SystemSetting.findOne({ where: { key: 'merchant_category_rules' } });
  const rules = parseJsonField(row && row.value, []);
  return Array.isArray(rules) ? rules : [];
}

async function saveStoredMerchantRules(rules) {
  const value = JSON.stringify(rules.slice(0, 1000));
  await db.SystemSetting.upsert({
    key: 'merchant_category_rules',
    value,
    description: 'User-maintained merchant category index for statement imports.'
  });
}

function firstPresent(source, keys) {
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(source, key)) return source[key];
  }
  return undefined;
}

function parseKeywordList(value) {
  if (Array.isArray(value)) {
    return value.map((item) => cleanText(item)).filter(Boolean);
  }
  return cleanText(value)
    .split(/[|;,]/)
    .map((item) => cleanText(item))
    .filter(Boolean);
}

function extractJsonPayload(text) {
  const trimmed = cleanText(text);
  if (!trimmed) return null;
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) return trimmed;
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced && fenced[1]) return fenced[1].trim();
  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) return trimmed.slice(firstBrace, lastBrace + 1);
  return null;
}

function normalizeCategoryImportRow(row, index) {
  const source = row || {};
  const hasField = (keys) => keys.some((key) => Object.prototype.hasOwnProperty.call(source, key));
  const name = cleanText(firstPresent(source, ['name', 'category_name', 'categoryName']));
  const categoryType = cleanText(firstPresent(source, ['categoryType', 'category_type', 'transaction_type', 'transactionType'])).toLowerCase();
  return {
    rowNumber: index + 2,
    name,
    categoryType,
    groupName: cleanText(firstPresent(source, ['groupName', 'group_name'])) || null,
    budgetBehavior: cleanText(firstPresent(source, ['budgetBehavior', 'budget_behavior'])).toLowerCase() || null,
    parentName: cleanText(firstPresent(source, ['parentName', 'parent_name'])),
    taxRelevant: cleanBoolean(firstPresent(source, ['taxRelevant', 'tax_relevant']), false),
    isActive: cleanBoolean(firstPresent(source, ['isActive', 'is_active']), true),
    merchantKeywords: parseKeywordList(firstPresent(source, [
      'merchantKeywords',
      'merchant_keywords',
      'merchantKeyGroup',
      'merchant_keygroup',
      'merchantKeygroup',
      'keygroup'
    ])),
    fields: {
      categoryType: hasField(['categoryType', 'category_type', 'transaction_type', 'transactionType']),
      groupName: hasField(['groupName', 'group_name']),
      budgetBehavior: hasField(['budgetBehavior', 'budget_behavior']),
      parentName: hasField(['parentName', 'parent_name']),
      taxRelevant: hasField(['taxRelevant', 'tax_relevant']),
      isActive: hasField(['isActive', 'is_active']),
      merchantKeywords: hasField(['merchantKeywords', 'merchant_keywords', 'merchantKeyGroup', 'merchant_keygroup', 'merchantKeygroup', 'keygroup'])
    }
  };
}

async function parseCategorySetupRows(buffer) {
  const text = buffer.toString('utf8');
  const jsonPayload = extractJsonPayload(text);
  if (jsonPayload) {
    try {
      const parsed = JSON.parse(jsonPayload);
      const sourceRows = Array.isArray(parsed) ? parsed : parsed.categories;
      if (Array.isArray(sourceRows)) {
        return {
          rows: sourceRows.map((row, index) => normalizeCategoryImportRow(row, index)),
          format: 'json'
        };
      }
    } catch (err) {
      if (cleanText(text).startsWith('{') || cleanText(text).includes('```json')) {
        throw err;
      }
    }
  }

  const csvRows = await parseCsv(buffer);
  return {
    rows: csvRows.map((row, index) => normalizeCategoryImportRow(row, index)),
    format: 'csv'
  };
}

function normalizeDraft(input, defaults = {}) {
  const source = input || {};
  const accountId = cleanId(source.accountId) || cleanId(defaults.accountId);
  const categoryId = cleanId(source.categoryId) || cleanId(defaults.categoryId);
  const relatedAccountId = cleanId(source.relatedAccountId);
  const merchantId = cleanId(source.merchantId);
  const merchantText = cleanText(source.merchant || source.receiptMerchant || source.description);
  const receiptMerchant = cleanText(source.receiptMerchant || source.rawMerchant || merchantText);
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
    merchantId,
    merchant: merchantText,
    receiptMerchant,
    normalizedMerchant: cleanText(source.normalizedMerchant) || merchantResolver.normalizeMerchantKey(merchantText),
    merchantMatchConfidence: source.merchantMatchConfidence == null || source.merchantMatchConfidence === '' ? null : toNumber(source.merchantMatchConfidence),
    merchantMatchSource: cleanText(source.merchantMatchSource),
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

async function resolveDefaultBankAccountId(requestedAccountId, profile, metadata = {}) {
  const explicitAccountId = cleanId(requestedAccountId);
  if (explicitAccountId) return { accountId: explicitAccountId, source: 'explicit' };

  const activeAccounts = await db.Account.findAll({
    where: {
      status: { [Op.notIn]: ['inactive', 'closed'] }
    },
    order: [['id', 'ASC']]
  });

  if (!activeAccounts.length) return { accountId: null, source: 'none', reason: 'No active accounts exist.' };
  if (activeAccounts.length === 1) return { accountId: activeAccounts[0].id, source: 'single_active' };

  const last4 = cleanText(metadata.accountLast4 || metadata.last4 || metadata.accountEnding);
  const normalizedProfile = cleanText(profile).toLowerCase();
  const accountText = (account) => [
    account.name,
    account.accountCode,
    account.accountType,
    account.accountClass,
    account.accountSubtype,
    account.notes
  ].filter(Boolean).join(' ');

  const directLast4Match = last4 ? activeAccounts.find((account) => {
    const haystack = accountText(account);
    return new RegExp(`(^|\\D)${last4}(\\D|$)`).test(haystack);
  }) : null;
  if (directLast4Match) return { accountId: directLast4Match.id, source: 'last4', reason: `Matched account ending in ${last4}.` };

  const profileMatchers = [];
  if (normalizedProfile.includes('checking')) profileMatchers.push(/checking/i, /current/i);
  if (normalizedProfile.includes('savings') || normalizedProfile.includes('ultimate')) profileMatchers.push(/savings/i, /deposit/i, /ultimate/i);
  if (normalizedProfile.includes('credit')) profileMatchers.push(/credit/i, /card/i);
  if (!profileMatchers.length) profileMatchers.push(/checking/i, /savings/i, /bank/i);

  const profileMatches = activeAccounts.filter((account) => profileMatchers.some((pattern) => pattern.test(accountText(account))));
  if (profileMatches.length === 1) return { accountId: profileMatches[0].id, source: 'profile', reason: `Matched account by ${profile}.` };
  if (profileMatches.length > 1) {
    return { accountId: null, source: 'ambiguous', reason: `Multiple active accounts match ${profile}; please select the account manually.` };
  }

  return { accountId: activeAccounts[0].id, source: 'first_active', reason: 'No exact account match was found; using the first active account.' };
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

exports.exportCategories = async (req, res) => {
  const [categories, customRules] = await Promise.all([
    db.Category.findAll({
      include: [{ model: db.Category, as: 'Parent', attributes: ['name'] }],
      order: [['groupName', 'ASC'], ['name', 'ASC']]
    }),
    getStoredMerchantRules()
  ]);
  const keywordsByCategory = new Map();
  customRules.forEach((rule) => {
    if (!rule || !rule.categoryName || !rule.pattern) return;
    const key = merchantCategorizer.normalize(rule.categoryName);
    if (!keywordsByCategory.has(key)) keywordsByCategory.set(key, []);
    const values = keywordsByCategory.get(key);
    if (!values.includes(rule.pattern)) values.push(rule.pattern);
  });
  const headers = TEMPLATES.categories;
  const lines = [
    headers.join(','),
    ...categories.map((category) => headers.map((header) => {
      if (header === 'parentName') return csvEscape(category.Parent ? category.Parent.name : '');
      if (header === 'merchantKeywords') {
        return csvEscape((keywordsByCategory.get(merchantCategorizer.normalize(category.name)) || []).join('|'));
      }
      return csvEscape(category[header]);
    }).join(','))
  ];

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="home_accounting_categories.csv"');
  res.send(lines.join('\n') + '\n');
};

exports.importCategories = async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Category CSV or JSON setup file is required.' });

  const parsedSetup = await parseCategorySetupRows(req.file.buffer);
  const rows = parsedSetup.rows;
  const allowedTypes = new Set(['income', 'expense', 'transfer', 'adjustment']);
  const warnings = [];
  const prepared = rows.map((row) => {
    const categoryType = allowedTypes.has(row.categoryType) ? row.categoryType : 'expense';
    return {
      ...row,
      categoryType,
      budgetBehavior: row.budgetBehavior || 'variable'
    };
  });

  let created = 0;
  let updated = 0;
  let skipped = 0;
  const keywordRuleImports = [];

  await db.sequelize.transaction(async (transaction) => {
    const existing = await db.Category.findAll({ transaction });
    const byName = new Map(existing.map((category) => [merchantCategorizer.normalize(category.name), category]));
    const imported = [];

    for (const item of prepared) {
      if (!item.name) {
        skipped += 1;
        warnings.push(`Row ${item.rowNumber}: missing category name.`);
        continue;
      }

      const key = merchantCategorizer.normalize(item.name);
      const current = byName.get(key);
      const payload = { name: item.name };
      if (!current || item.fields.categoryType) payload.categoryType = item.categoryType;
      if (!current || item.fields.groupName) payload.groupName = item.groupName;
      if (!current || item.fields.budgetBehavior) payload.budgetBehavior = item.budgetBehavior;
      if (!current || item.fields.taxRelevant) payload.taxRelevant = item.taxRelevant;
      if (!current || item.fields.isActive) payload.isActive = item.isActive;

      if (current) {
        await current.update(payload, { transaction });
        updated += 1;
        imported.push({ item, category: current });
      } else {
        const category = await db.Category.create(payload, { transaction });
        byName.set(key, category);
        created += 1;
        imported.push({ item, category });
      }

      if (item.fields.merchantKeywords && item.merchantKeywords.length) {
        item.merchantKeywords.forEach((keyword) => {
          keywordRuleImports.push({
            pattern: keyword,
            categoryName: item.name,
            transactionType: item.categoryType,
            groupName: item.groupName,
            sourceRow: item.rowNumber
          });
        });
      }
    }

    for (const { item, category } of imported) {
      if (!item.fields.parentName) continue;
      const parentName = item.parentName;
      if (!parentName) {
        await category.update({ parentId: null }, { transaction });
        continue;
      }

      const parent = byName.get(merchantCategorizer.normalize(parentName));
      if (!parent) {
        warnings.push(`Row ${item.rowNumber}: parent category "${parentName}" was not found.`);
        continue;
      }
      if (Number(parent.id) === Number(category.id)) {
        warnings.push(`Row ${item.rowNumber}: category cannot be its own parent.`);
        continue;
      }
      await category.update({ parentId: parent.id }, { transaction });
    }
  });

  let keywordRulesCreated = 0;
  let keywordRulesUpdated = 0;
  let keywordRulesSkipped = 0;
  if (keywordRuleImports.length) {
    const rules = await getStoredMerchantRules();
    const existingIndex = new Map(rules.map((rule, index) => [
      merchantCategorizer.normalize(rule.pattern) + '|' + merchantCategorizer.normalize(rule.transactionType || ''),
      index
    ]));
    const now = new Date().toISOString();

    for (const item of keywordRuleImports) {
      const pattern = merchantCategorizer.normalize(item.pattern);
      const transactionType = allowedTypes.has(merchantCategorizer.normalize(item.transactionType))
        ? merchantCategorizer.normalize(item.transactionType)
        : 'expense';
      if (!pattern || pattern.length < 2) {
        keywordRulesSkipped += 1;
        warnings.push(`Row ${item.sourceRow}: skipped short merchant keyword "${item.pattern}".`);
        continue;
      }

      const key = pattern + '|' + transactionType;
      const rule = {
        pattern,
        categoryName: item.categoryName,
        transactionType,
        source: 'category_keygroup',
        notes: cleanText(item.groupName ? `Imported from category setup: ${item.groupName}.` : 'Imported from category setup.'),
        updatedAt: now,
        updatedByUserId: req.user && req.user.id
      };
      const index = existingIndex.get(key);
      if (index === undefined) {
        rules.unshift(rule);
        existingIndex.set(key, 0);
        for (const [mapKey, mapIndex] of existingIndex.entries()) {
          if (mapKey !== key) existingIndex.set(mapKey, mapIndex + 1);
        }
        keywordRulesCreated += 1;
      } else {
        rules[index] = rule;
        keywordRulesUpdated += 1;
      }
    }

    if (keywordRulesCreated || keywordRulesUpdated) {
      await saveStoredMerchantRules(rules);
    }
  }

  res.json({
    ok: true,
    message: `${created} category/categories created and ${updated} updated.`,
    format: parsedSetup.format,
    created,
    updated,
    skipped,
    keywordRulesCreated,
    keywordRulesUpdated,
    keywordRulesSkipped,
    warnings
  });
};

exports.getBatches = async (req, res) => {
  const includeRemoved = cleanBoolean(req.query.includeRemoved, false);
  const includeArchived = cleanBoolean(req.query.includeArchived, false);
  const batches = await db.ImportBatch.findAll({
    where: includeRemoved ? {} : { status: { [Op.ne]: 'removed' } },
    include: [{ model: db.User, as: 'CreatedBy', attributes: ['id', 'firstName', 'lastName', 'username'] }],
    order: [['createdAt', 'DESC']],
    limit: 500
  });
  const rows = batches.map((batch) => {
    const archive = batchArchiveMetadata(batch);
    return {
      id: batch.id,
      importType: batch.importType,
      fileName: batch.fileName,
      status: batch.status,
      archived: archive.archived,
      archivedAt: archive.archivedAt,
      archiveReason: archive.archiveReason,
      rowCount: batch.rowCount,
      acceptedCount: batch.acceptedCount,
      rejectedCount: batch.rejectedCount,
      pdfAvailable: !!batchPdfPath(batch),
      notes: batch.notes,
      createdAt: batch.createdAt,
      createdBy: batch.CreatedBy ? `${batch.CreatedBy.firstName || ''} ${batch.CreatedBy.lastName || ''}`.trim() || batch.CreatedBy.username : ''
    };
  }).filter((row) => includeArchived || !row.archived);
  res.json(rows);
};

async function setBatchArchiveState(req, res, archived) {
  const rawIds = Array.isArray(req.body && req.body.ids) ? req.body.ids : [];
  const ids = Array.from(new Set(rawIds.map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0)));
  if (!ids.length) return res.status(400).json({ error: 'Select at least one staged document.' });

  const batches = await db.ImportBatch.findAll({ where: { id: ids } });
  const now = new Date().toISOString();
  let updated = 0;

  await db.sequelize.transaction(async (transaction) => {
    for (const batch of batches) {
      if (batch.status === 'removed') continue;
      const existingNotes = editableBatchNotes(batch);
      if (archived && existingNotes.archived === true) continue;
      if (!archived && existingNotes.archived !== true) continue;

      const archiveFields = archived
        ? {
            archived: true,
            archivedAt: now,
            archivedByUserId: req.user && req.user.id,
            archiveReason: cleanText(req.body && req.body.reason) || 'Archived from import screen.',
            unarchivedAt: null,
            unarchivedByUserId: null
          }
        : {
            archived: false,
            unarchivedAt: now,
            unarchivedByUserId: req.user && req.user.id
          };

      await batch.update({
        notes: JSON.stringify({
          ...existingNotes,
          ...archiveFields
        })
      }, { transaction });
      updated += 1;
    }
  });

  res.json({
    ok: true,
    updated,
    requested: ids.length,
    message: archived
      ? `${updated} staged document(s) archived.`
      : `${updated} staged document(s) unarchived.`
  });
}

exports.archiveBatches = async (req, res) => setBatchArchiveState(req, res, true);

exports.unarchiveBatches = async (req, res) => setBatchArchiveState(req, res, false);

exports.previewBatchPdf = async (req, res) => {
  const batch = await db.ImportBatch.findByPk(req.params.id);
  if (!batch) return res.status(404).json({ error: 'Import batch not found.' });
  const filePath = batchPdfPath(batch);
  if (!filePath) return res.status(404).json({ error: 'No source PDF is available for this batch.' });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${path.basename(filePath).replace(/"/g, '')}"`);
  res.sendFile(filePath);
};

exports.getBatchRows = async (req, res) => {
  const rows = await db.ImportRow.findAll({
    where: { importBatchId: req.params.id },
    order: [['rowNumber', 'ASC']],
    limit: 500
  });
  res.json(rows);
};

exports.removeBatch = async (req, res) => {
  const batch = await db.ImportBatch.findByPk(req.params.id);
  if (!batch) return res.status(404).json({ error: 'Import batch not found.' });
  if (batch.status === 'removed') {
    return res.json({ ok: true, message: 'Staged document is already removed.', removedRows: 0, postedRowsPreserved: 0 });
  }

  const reason = cleanText(req.body && req.body.reason) || 'Removed from staging queue by user.';
  const existingNotes = editableBatchNotes(batch);
  const rows = await db.ImportRow.findAll({ where: { importBatchId: batch.id } });
  const postedRows = rows.filter((row) => row.status === 'posted' || row.postedTransactionId).length;
  const removableRows = rows.filter((row) => row.status !== 'posted' && !row.postedTransactionId);

  await db.sequelize.transaction(async (transaction) => {
    if (removableRows.length) {
      await db.ImportRow.update({
        status: 'removed',
        errorMessage: reason
      }, {
        where: {
          importBatchId: batch.id,
          status: { [Op.ne]: 'posted' },
          postedTransactionId: null
        },
        transaction
      });
    }

    await batch.update({
      status: 'removed',
      notes: JSON.stringify({
        ...existingNotes,
        removedAt: new Date().toISOString(),
        removedByUserId: req.user && req.user.id,
        removalReason: reason,
        postedRowsPreserved: postedRows
      })
    }, { transaction });
  });

  res.json({
    ok: true,
    message: postedRows
      ? `Staged document removed from the active queue. ${postedRows} posted ledger row(s) were preserved.`
      : 'Staged document removed from the active queue.',
    removedRows: removableRows.length,
    postedRowsPreserved: postedRows
  });
};

exports.purgeBatch = async (req, res) => {
  const batch = await db.ImportBatch.findByPk(req.params.id);
  if (!batch) return res.status(404).json({ error: 'Import batch not found.' });

  const confirmText = cleanText(req.body && req.body.confirmText);
  const expected = `PURGE BATCH ${batch.id}`;
  if (confirmText !== expected) {
    return res.status(400).json({ error: `Confirmation text must be exactly: ${expected}` });
  }

  const deletePostedTransactions = !!(req.body && req.body.deletePostedTransactions);
  const rows = await db.ImportRow.findAll({ where: { importBatchId: batch.id } });
  const postedRows = rows.filter((row) => row.status === 'posted' || row.postedTransactionId);
  const postedTransactionIds = Array.from(new Set(postedRows.map((row) => row.postedTransactionId).filter(Boolean)));

  if (postedTransactionIds.length && !deletePostedTransactions) {
    return res.status(409).json({
      error: 'This batch has posted ledger transactions. Enable posted transaction rollback to purge it.',
      postedTransactions: postedTransactionIds.length
    });
  }

  let deletedTransactions = 0;
  await db.sequelize.transaction(async (transaction) => {
    if (postedTransactionIds.length) {
      deletedTransactions = await db.Transaction.destroy({
        where: {
          id: { [Op.in]: postedTransactionIds },
          sourceType: 'bank_statement'
        },
        transaction
      });
    }
    await db.ImportRow.destroy({ where: { importBatchId: batch.id }, transaction });
    await batch.destroy({ transaction });
  });

  res.json({
    ok: true,
    message: deletedTransactions
      ? `Batch #${batch.id} purged and ${deletedTransactions} posted ledger transaction(s) rolled back.`
      : `Batch #${batch.id} purged from staging.`,
    deletedImportRows: rows.length,
    deletedTransactions
  });
};

exports.updateBatchRows = async (req, res) => {
  const batch = await db.ImportBatch.findByPk(req.params.id);
  if (!batch) return res.status(404).json({ error: 'Import batch not found.' });
  if (batch.status === 'removed') return res.status(409).json({ error: 'This staged document has been removed from the active queue.' });

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
    },
    {
      key: 'citi_checking_pdf',
      label: 'Citi Checking PDF - Auto format',
      institution: 'Citi Checking',
      fileTypes: ['pdf'],
      importMode: 'stage_only',
      posting: 'manual_review_required'
    },
    {
      key: 'citi_checking_legacy_pdf',
      label: 'Citi Checking PDF - Legacy statement',
      institution: 'Citi Checking',
      fileTypes: ['pdf'],
      importMode: 'stage_only',
      posting: 'manual_review_required'
    },
    {
      key: 'citi_checking_simplified_pdf',
      label: 'Citi Checking PDF - Simplified statement',
      institution: 'Citi Checking',
      fileTypes: ['pdf'],
      importMode: 'stage_only',
      posting: 'manual_review_required'
    },
    {
      key: 'citi_ultimate_plus_pdf',
      label: 'Citi Ultimate Plus PDF - Auto format',
      institution: 'Citi Ultimate Plus',
      fileTypes: ['pdf'],
      importMode: 'stage_only',
      posting: 'manual_review_required'
    },
    {
      key: 'citi_ultimate_plus_legacy_pdf',
      label: 'Citi Ultimate Plus PDF - Legacy statement',
      institution: 'Citi Ultimate Plus',
      fileTypes: ['pdf'],
      importMode: 'stage_only',
      posting: 'manual_review_required'
    },
    {
      key: 'citi_ultimate_plus_simplified_pdf',
      label: 'Citi Ultimate Plus PDF - Simplified statement',
      institution: 'Citi Ultimate Plus',
      fileTypes: ['pdf'],
      importMode: 'stage_only',
      posting: 'manual_review_required'
    },
    {
      key: 'citi_savings_pdf',
      label: 'Day to Day Savings PDF - Auto format',
      institution: 'Day to Day Savings',
      fileTypes: ['pdf'],
      importMode: 'stage_only',
      posting: 'manual_review_required'
    },
    {
      key: 'citi_savings_legacy_pdf',
      label: 'Day to Day Savings PDF - Legacy statement',
      institution: 'Day to Day Savings',
      fileTypes: ['pdf'],
      importMode: 'stage_only',
      posting: 'manual_review_required'
    },
    {
      key: 'citi_savings_simplified_pdf',
      label: 'Day to Day Savings PDF - Simplified statement',
      institution: 'Day to Day Savings',
      fileTypes: ['pdf'],
      importMode: 'stage_only',
      posting: 'manual_review_required'
    }
  ]);
};

exports.getMerchantRules = async (req, res) => {
  const customRules = await getStoredMerchantRules();
  res.json({
    customRules,
    defaultRules: merchantCategorizer.DEFAULT_MERCHANT_RULES
  });
};

exports.saveMerchantRule = async (req, res) => {
  const pattern = cleanText(req.body.pattern || req.body.merchant);
  const categoryId = cleanId(req.body.categoryId);
  const transactionType = cleanText(req.body.transactionType || 'expense').toLowerCase();
  if (!pattern) return res.status(400).json({ error: 'Merchant pattern is required.' });
  if (!categoryId) return res.status(400).json({ error: 'Category is required.' });

  const category = await db.Category.findByPk(categoryId);
  if (!category) return res.status(404).json({ error: 'Category not found.' });

  const rules = await getStoredMerchantRules();
  const normalizedPattern = merchantCategorizer.normalize(pattern);
  const nextRule = {
    pattern: normalizedPattern,
    categoryName: category.name,
    transactionType: ['income', 'expense', 'transfer', 'adjustment'].includes(transactionType) ? transactionType : category.categoryType || 'expense',
    source: 'user',
    notes: cleanText(req.body.notes),
    updatedAt: new Date().toISOString(),
    updatedByUserId: req.user && req.user.id
  };
  const existingIndex = rules.findIndex((rule) =>
    merchantCategorizer.normalize(rule.pattern) === normalizedPattern &&
    merchantCategorizer.normalize(rule.transactionType || '') === merchantCategorizer.normalize(nextRule.transactionType || '')
  );
  if (existingIndex >= 0) rules[existingIndex] = nextRule;
  else rules.unshift(nextRule);
  await saveStoredMerchantRules(rules);

  const resolvedMerchant = await merchantResolver.resolveMerchantText(pattern, { create: true });
  if (resolvedMerchant.merchantId) {
    await db.Merchant.update({
      defaultCategoryId: category.id,
      defaultTransactionType: nextRule.transactionType,
      lastSeenAt: new Date()
    }, { where: { id: resolvedMerchant.merchantId } });
  }

  res.json({ ok: true, rule: nextRule, merchant: resolvedMerchant, count: rules.length });
};

function cleanMerchantLookupQuery(value) {
  return cleanText(value)
    .replace(/\b\d{4,}\b/g, ' ')
    .replace(/[#*]+/g, ' ')
    .replace(/[^a-zA-Z0-9&.\-/ ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 90);
}

function stripHtml(value) {
  return cleanText(String(value || '').replace(/<[^>]*>/g, ' '));
}

async function lookupWikipediaSummary(query) {
  const params = new URLSearchParams({
    action: 'query',
    list: 'search',
    srsearch: query,
    format: 'json',
    origin: '*',
    srlimit: '1'
  });
  const searchResponse = await fetch('https://en.wikipedia.org/w/api.php?' + params.toString(), {
    headers: { 'User-Agent': 'HomeAccountingMerchantLookup/0.1' },
    signal: AbortSignal.timeout(7000)
  });
  if (searchResponse.status === 429) throw new Error('Public lookup rate limited by Wikipedia (HTTP 429). Try fewer rows or wait a minute.');
  if (!searchResponse.ok) throw new Error('Wikipedia search returned HTTP ' + searchResponse.status);
  const searchData = await searchResponse.json();
  const first = searchData && searchData.query && Array.isArray(searchData.query.search)
    ? searchData.query.search[0]
    : null;
  if (!first || !first.title) return { text: '', query, sources: [] };

  const summaryResponse = await fetch('https://en.wikipedia.org/api/rest_v1/page/summary/' + encodeURIComponent(first.title.replace(/ /g, '_')), {
    headers: { 'User-Agent': 'HomeAccountingMerchantLookup/0.1' },
    signal: AbortSignal.timeout(7000)
  });
  if (summaryResponse.status === 429) throw new Error('Public lookup rate limited by Wikipedia (HTTP 429). Try fewer rows or wait a minute.');
  if (!summaryResponse.ok) {
    return {
      query,
      text: [first.title, stripHtml(first.snippet)].filter(Boolean).join(' '),
      sources: []
    };
  }

  const summary = await summaryResponse.json();
  const pageUrl = summary && summary.content_urls && summary.content_urls.desktop
    ? summary.content_urls.desktop.page
    : null;
  return {
    query,
    text: [summary.title, summary.description, summary.extract].filter(Boolean).join(' '),
    sources: pageUrl ? [{ label: 'Wikipedia', url: pageUrl }] : []
  };
}

const merchantLookupCache = new Map();
const MERCHANT_LOOKUP_CACHE_MS = 6 * 60 * 60 * 1000;

async function lookupMerchantOnline(query) {
  const merchantQuery = cleanMerchantLookupQuery(query);
  if (!merchantQuery) return { text: '', query: '' };
  const cacheKey = merchantCategorizer.normalize(merchantQuery);
  const cached = merchantLookupCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return { ...cached.value, cached: true };
  }

  const searchQuery = `${merchantQuery} company business type`;
  const url = 'https://api.duckduckgo.com/?format=json&no_html=1&skip_disambig=1&q=' + encodeURIComponent(searchQuery);
  const response = await fetch(url, {
    headers: { 'User-Agent': 'HomeAccountingMerchantLookup/0.1' },
    signal: AbortSignal.timeout(7000)
  });
  if (response.status === 429) throw new Error('Public lookup rate limited by DuckDuckGo (HTTP 429). Try fewer rows or wait a minute.');
  if (!response.ok) throw new Error('Lookup returned HTTP ' + response.status);
  const data = await response.json();
  const related = Array.isArray(data.RelatedTopics) ? data.RelatedTopics.slice(0, 3).map((item) => item.Text || '').filter(Boolean).join(' ') : '';
  const sources = data.AbstractURL ? [{ label: data.AbstractSource || 'DuckDuckGo', url: data.AbstractURL }] : [];
  const text = [data.Heading, data.AbstractText, data.AbstractSource, related].filter(Boolean).join(' ');
  if (!text) {
    const wiki = await lookupWikipediaSummary(merchantQuery);
    const value = {
      query: searchQuery + (wiki.query ? ' | Wikipedia: ' + wiki.query : ''),
      text: wiki.text,
      sources: wiki.sources
    };
    merchantLookupCache.set(cacheKey, { value, expiresAt: Date.now() + MERCHANT_LOOKUP_CACHE_MS });
    return value;
  }
  const value = {
    query: searchQuery,
    text,
    sources
  };
  merchantLookupCache.set(cacheKey, { value, expiresAt: Date.now() + MERCHANT_LOOKUP_CACHE_MS });
  return value;
}

exports.suggestMerchantCategory = async (req, res) => {
  const merchant = cleanText(req.body.merchant || req.body.receiptMerchant || req.body.description || req.body.text);
  const receiptMerchant = cleanText(req.body.receiptMerchant);
  const description = cleanText(req.body.description);
  const transactionType = cleanText(req.body.transactionType).toLowerCase();
  const onlineLookup = !!req.body.onlineLookup;
  if (!merchant && !description) return res.status(400).json({ error: 'Merchant or description is required.' });

  const [categories, customRules] = await Promise.all([
    db.Category.findAll({ where: { isActive: { [Op.ne]: false } }, order: [['groupName', 'ASC'], ['name', 'ASC']] }),
    getStoredMerchantRules()
  ]);
  const resolvedMerchant = await merchantResolver.resolveMerchantText(merchant || receiptMerchant || description, { create: true });
  let merchantDefaultSuggestion = null;
  if (resolvedMerchant.merchantId) {
    const canonicalMerchant = await db.Merchant.findByPk(resolvedMerchant.merchantId, {
      include: [{ model: db.Category, as: 'DefaultCategory' }]
    });
    if (canonicalMerchant && canonicalMerchant.DefaultCategory) {
      merchantDefaultSuggestion = {
        categoryId: canonicalMerchant.DefaultCategory.id,
        categoryName: canonicalMerchant.DefaultCategory.name,
        transactionType: canonicalMerchant.defaultTransactionType || canonicalMerchant.DefaultCategory.categoryType || 'expense',
        confidence: 0.96,
        source: 'merchant_default',
        matchedPattern: canonicalMerchant.officialName,
        notes: 'Suggested from canonical merchant default category.'
      };
    }
  }
  const localSuggestion = merchantCategorizer.suggestFromRules({
    text: [merchant, receiptMerchant, description].join(' '),
    categories,
    customRules,
    transactionType
  });
  if (!onlineLookup) {
    return res.json({
      ok: true,
      merchant,
      canonicalMerchant: resolvedMerchant,
      suggestion: merchantDefaultSuggestion || localSuggestion,
      merchantDefaultSuggestion,
      localSuggestion,
      onlineSuggestion: null,
      onlineLookupUsed: false
    });
  }

  try {
    const lookup = await lookupMerchantOnline([merchant, receiptMerchant, description].join(' '));
    const onlineSuggestion = lookup.text
      ? merchantCategorizer.inferFromLookupText([merchant, receiptMerchant, description, lookup.text].join(' '), categories)
      : null;
    res.json({
      ok: true,
      merchant,
      canonicalMerchant: resolvedMerchant,
      suggestion: merchantDefaultSuggestion || onlineSuggestion || localSuggestion,
      merchantDefaultSuggestion,
      localSuggestion,
      onlineSuggestion,
      onlineLookupUsed: true,
      lookupQuery: lookup.query,
      lookupSummary: lookup.text ? lookup.text.slice(0, 400) : '',
      lookupSources: lookup.sources || [],
      lookupCached: !!lookup.cached
    });
  } catch (err) {
    res.json({
      ok: true,
      merchant,
      canonicalMerchant: resolvedMerchant,
      suggestion: merchantDefaultSuggestion || localSuggestion,
      merchantDefaultSuggestion,
      localSuggestion,
      onlineSuggestion: null,
      onlineLookupUsed: true,
      lookupError: err.message
    });
  }
};

exports.importBankStatement = async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Statement file is required.' });

  const profile = req.body.profile || 'advantage_citi_pdf';
  const canonicalProfile = canonicalBankStatementProfile(profile);
  const importType = 'bank_statement_' + canonicalProfile;
  const hash = crypto.createHash('sha256').update(req.file.buffer).digest('hex');
  const parsed = await parseBankStatement({ buffer: req.file.buffer, profile });
  const accountResolution = await resolveDefaultBankAccountId(req.body.accountId, profile, parsed.metadata || {});
  const accountId = accountResolution.accountId;
  if (!accountId) {
    return res.status(400).json({
      error: accountResolution.reason || 'Unable to determine an import account for this statement.',
      metadata: parsed.metadata || {},
      suggestion: 'Create/select the matching account, or rename the account so its last 4 digits appear in the name, code, or notes.'
    });
  }
  const existingBatch = await db.ImportBatch.findOne({
    where: {
      importType,
      status: { [Op.ne]: 'removed' },
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
  for (const item of stagedRows) {
    item.merchantResolution = await merchantResolver.resolveMerchantText(item.row.description, { create: true });
  }
  const duplicateCount = stagedRows.filter((item) => item.status === 'duplicate').length;

  const notesPayload = {
    source: 'bank_statement_web_upload',
    profile,
    canonicalProfile,
    parserVersion: parsed.parserVersion,
    fileHashSha256: hash,
    originalFileName: req.file.originalname,
    accountLast4: parsed.metadata && parsed.metadata.accountLast4 ? String(parsed.metadata.accountLast4) : null,
    pageCount: parsed.pageCount,
    lineCount: parsed.lineCount,
    metadata: parsed.metadata,
    accountResolution,
    warnings: parsed.warnings || [],
    postingPolicy: 'stage_only_no_ledger_posting'
  };

  const batch = await db.sequelize.transaction(async (transaction) => {
    const created = await db.ImportBatch.create({
      importType,
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
        const merchant = item.merchantResolution || {};
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
          merchantId: merchant.merchantId || null,
          merchant: merchant.officialName || row.description,
          receiptMerchant: row.description,
          normalizedMerchant: merchant.normalizedMerchant || merchantResolver.normalizeMerchantKey(row.description),
          merchantMatchConfidence: merchant.confidence || null,
          merchantMatchSource: merchant.source || null,
          transactionType: row.suggestedLedgerType,
          amount: row.suggestedLedgerAmount,
          currency: row.currency || 'USD',
          status: 'draft',
          sourceType: 'bank_statement',
          referenceNumber: row.fingerprint,
          tags: ['bank-statement', canonicalProfile, profile !== canonicalProfile ? profile : null, row.transactionType].filter(Boolean).join(','),
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
    canonicalProfile,
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
  if (batch.status === 'removed') return res.status(409).json({ error: 'This staged document has been removed from the active queue.' });
  const notes = batchNotes(batch);
  if (notes.fileHashSha256) {
    const originalBatch = await db.ImportBatch.findOne({
      where: {
        importType: batch.importType,
        id: { [Op.lt]: batch.id },
        status: { [Op.ne]: 'removed' },
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
    accountId: (await resolveDefaultBankAccountId(req.body.accountId, batch.importType || '', batchNotes(batch))).accountId,
    categoryId: cleanId(req.body.categoryId),
    status: cleanText(req.body.transactionStatus || 'draft'),
    sourceType: batch.importType && batch.importType.startsWith('bank_statement') ? 'bank_statement' : 'import_batch'
  };
  if (!defaults.accountId) {
    return res.status(400).json({
      error: 'Unable to determine the correct account for posting.',
      suggestion: 'Open the batch and select the matching account before posting.'
    });
  }
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

      const merchantPayload = await merchantResolver.merchantPayload(
        draft.merchant || draft.receiptMerchant || draft.description,
        { transaction, source: 'import_post' }
      );
      Object.assign(draft, {
        merchantId: merchantPayload.merchantId,
        merchant: merchantPayload.merchant,
        receiptMerchant: merchantPayload.receiptMerchant,
        normalizedMerchant: merchantPayload.normalizedMerchant,
        merchantMatchConfidence: merchantPayload.merchantMatchConfidence,
        merchantMatchSource: merchantPayload.merchantMatchSource
      });

      const tx = await db.Transaction.create({
        transactionDate: draft.transactionDate,
        accountId: draft.accountId,
        categoryId: draft.categoryId,
        relatedAccountId: draft.relatedAccountId,
        description: draft.description,
        merchantId: draft.merchantId,
        merchant: draft.merchant,
        receiptMerchant: draft.receiptMerchant,
        normalizedMerchant: draft.normalizedMerchant,
        merchantMatchConfidence: draft.merchantMatchConfidence,
        merchantMatchSource: draft.merchantMatchSource,
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
