'use strict';

const db = require('../models');
const { Op } = require('sequelize');

const dryRun = process.argv.includes('--dry-run');

function textOf(row) {
  return [
    row.description,
    row.merchant,
    row.receiptMerchant,
    row.normalizedMerchant,
    row.memo,
    row.Category && row.Category.name,
    row.Category && row.Category.groupName
  ].filter(Boolean).join(' ').toLowerCase();
}

function transferReason(row) {
  const categoryType = String(row.Category && row.Category.categoryType || '').toLowerCase();
  if (String(row.transactionType || '').toLowerCase() === 'transfer') return '';
  if (categoryType === 'transfer') return 'category_transfer';
  const text = textOf(row);
  if (/online payment, thank you|citi card online payment/.test(text)) return 'credit_card_payment';
  if (/\btransfer\s+(to|from)\b/.test(text)) return 'bank_transfer';
  if (/\bmoney market\b/.test(text)) return 'money_market_transfer';
  if (/\bult(?:imate)?\s+savings\b|\bsavings plus\b/.test(text)) return 'savings_transfer';
  if (/certificate(?:s)? of deposit|\bcd account\b|\b(to|from) cd\b/.test(text)) return 'cd_transfer';
  if (/\b(to|from)\s+(checking|savings)\b/.test(text)) return 'account_transfer';
  return '';
}

function appendTag(tags, tag) {
  const parts = String(tags || '').split(',').map((part) => part.trim()).filter(Boolean);
  if (!parts.includes(tag)) parts.push(tag);
  return parts.join(',');
}

async function categoryMap() {
  const categories = await db.Category.findAll({ raw: true });
  const byName = new Map(categories.map((category) => [String(category.name || '').toLowerCase(), category]));
  return {
    creditCardPayment: byName.get('credit card payment') || null,
    savingsTransfer: byName.get('savings transfer') || null,
    transfers: byName.get('transfers') || byName.get('transfers in') || null
  };
}

function targetCategory(reason, categories) {
  if (reason === 'credit_card_payment') return categories.creditCardPayment || categories.transfers;
  if (['bank_transfer', 'money_market_transfer', 'savings_transfer', 'account_transfer', 'cd_transfer'].includes(reason)) {
    return categories.savingsTransfer || categories.transfers;
  }
  return categories.transfers;
}

async function main() {
  const categories = await categoryMap();
  const rows = await db.Transaction.findAll({
    where: {
      status: { [Op.ne]: 'void' },
      transactionType: { [Op.in]: ['income', 'expense'] }
    },
    include: [
      { model: db.Category, attributes: ['id', 'name', 'categoryType', 'groupName'], required: false },
      { model: db.Account, attributes: ['id', 'name', 'accountClass'], required: false }
    ],
    order: [['transactionDate', 'ASC'], ['id', 'ASC']]
  });

  const candidates = rows
    .map((row) => ({ row, reason: transferReason(row) }))
    .filter((item) => item.reason);

  const summary = {
    dryRun,
    scanned: rows.length,
    candidates: candidates.length,
    updated: 0,
    byReason: {},
    examples: []
  };

  await db.sequelize.transaction(async (transaction) => {
    for (const { row, reason } of candidates) {
      const category = targetCategory(reason, categories);
      const payload = {
        transactionType: 'transfer',
        tags: appendTag(row.tags, 'internal-transfer-reclassified')
      };
      if (category) payload.categoryId = category.id;

      summary.byReason[reason] = (summary.byReason[reason] || 0) + 1;
      if (summary.examples.length < 20) {
        summary.examples.push({
          id: row.id,
          date: row.transactionDate,
          account: row.Account ? row.Account.name : '',
          fromType: row.transactionType,
          toType: 'transfer',
          toCategory: category ? category.name : null,
          amount: row.amount,
          reason,
          description: row.description
        });
      }

      if (!dryRun) await row.update(payload, { transaction });
      summary.updated += 1;
    }
    if (dryRun) throw new Error('__dry_run_rollback__');
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
