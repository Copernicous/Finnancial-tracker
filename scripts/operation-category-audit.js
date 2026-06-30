'use strict';

const db = require('../models');
const { Op } = require('sequelize');
const merchantCategorizer = require('../services/merchantCategorizer');

const apply = process.argv.includes('--apply');
const onlyUncategorized = process.argv.includes('--only-uncategorized');
const fullRules = process.argv.includes('--full-rules');
const limitArg = process.argv.find((arg) => arg.startsWith('--limit='));
const limit = limitArg ? Math.max(1, Number(limitArg.split('=')[1]) || 5000) : 5000;

function appendTag(tags, tag) {
  const parts = String(tags || '').split(',').map((part) => part.trim()).filter(Boolean);
  if (!parts.includes(tag)) parts.push(tag);
  return parts.join(',');
}

function textOf(row) {
  return [
    row.Merchant ? row.Merchant.officialName : '',
    row.merchant,
    row.receiptMerchant,
    row.description,
    row.normalizedMerchant,
    row.memo,
    row.tags
  ].filter(Boolean).join(' ');
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

async function getStoredMerchantRules() {
  const row = await db.SystemSetting.findOne({ where: { key: 'merchant_category_rules' } });
  const rules = parseJsonField(row && row.value, []);
  return Array.isArray(rules) ? rules : [];
}

async function main() {
  const [categories, customRules] = await Promise.all([
    db.Category.findAll({
      where: { isActive: { [Op.ne]: false } },
      order: [['groupName', 'ASC'], ['name', 'ASC']]
    }),
    fullRules ? getStoredMerchantRules() : Promise.resolve([])
  ]);
  const rows = await db.Transaction.findAll({
    where: {
      status: { [Op.ne]: 'void' },
      ...(onlyUncategorized ? { categoryId: { [Op.is]: null } } : {})
    },
    include: [
      { model: db.Category, attributes: ['id', 'name', 'categoryType', 'groupName'], required: false },
      { model: db.Merchant, attributes: ['id', 'officialName', 'merchantGroupName'], required: false },
      { model: db.Account, attributes: ['id', 'name', 'accountClass'], required: false }
    ],
    order: [['transactionDate', 'DESC'], ['id', 'DESC']],
    limit
  });

  const candidates = [];
  for (const row of rows) {
    const input = {
      text: textOf(row),
      categories,
      customRules,
      amount: row.amount,
      transactionType: row.transactionType
    };
    const suggestion = fullRules
      ? merchantCategorizer.suggestFromRules(input)
      : merchantCategorizer.suggestOperation(input);
    if (!suggestion || !suggestion.categoryId) continue;
    const changesType = String(row.transactionType || '') !== String(suggestion.transactionType || '');
    const changesCategory = Number(row.categoryId || 0) !== Number(suggestion.categoryId || 0);
    if (!changesType && !changesCategory) continue;
    candidates.push({ row, suggestion, changesType, changesCategory });
  }

  const summary = {
    mode: apply ? 'apply' : 'dry-run',
    rules: fullRules ? 'operation-and-merchant' : 'operation-only',
    scanned: rows.length,
    candidates: candidates.length,
    updated: 0,
    byOperation: {},
    examples: []
  };

  await db.sequelize.transaction(async (transaction) => {
    for (const item of candidates) {
      const { row, suggestion } = item;
      summary.byOperation[suggestion.operationKind || suggestion.matchedPattern || 'operation'] =
        (summary.byOperation[suggestion.operationKind || suggestion.matchedPattern || 'operation'] || 0) + 1;
      if (summary.examples.length < 40) {
        summary.examples.push({
          id: row.id,
          date: row.transactionDate,
          account: row.Account ? row.Account.name : '',
          amount: Number(row.amount),
          fromType: row.transactionType,
          toType: suggestion.transactionType,
          fromCategory: row.Category ? row.Category.name : null,
          toCategory: suggestion.categoryName,
          operation: suggestion.operationKind || suggestion.matchedPattern,
          source: suggestion.source,
          description: row.description
        });
      }
      if (apply) {
        await row.update({
          categoryId: suggestion.categoryId,
          transactionType: suggestion.transactionType || row.transactionType,
          merchantMatchConfidence: suggestion.confidence,
          merchantMatchSource: suggestion.source,
          tags: appendTag(row.tags, fullRules ? 'auto-categorized' : 'operation-ai-categorized')
        }, { transaction });
      }
      summary.updated += 1;
    }
    if (!apply) throw new Error('__dry_run_rollback__');
  }).catch((err) => {
    if (err.message !== '__dry_run_rollback__') throw err;
  });

  console.log(JSON.stringify(summary, null, 2));
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.sequelize.close();
  });
