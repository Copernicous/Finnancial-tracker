'use strict';

const catalog = require('../services/defaultCategoryCatalog');

const now = () => new Date();
const normalize = (value) => String(value || '').toLowerCase().replace(/\s+/g, ' ').trim();
const validTypes = new Set(['income', 'expense', 'transfer', 'adjustment']);

module.exports = {
  async up(queryInterface) {
    const [existingRows] = await queryInterface.sequelize.query('SELECT id, name FROM "Categories";');
    const existingByName = new Map(existingRows.map((row) => [normalize(row.name), row]));
    const createdAt = now();
    const toCreate = [];

    for (const item of catalog) {
      const name = String(item.categoryName || '').trim();
      if (!name) continue;

      const payload = {
        name,
        categoryType: validTypes.has(normalize(item.categoryType)) ? normalize(item.categoryType) : 'expense',
        groupName: item.groupName || null,
        budgetBehavior: item.budgetBehavior || 'variable',
        isActive: true,
        taxRelevant: false,
        updatedAt: createdAt
      };

      const existing = existingByName.get(normalize(name));
      if (existing) {
        await queryInterface.bulkUpdate('Categories', payload, { id: existing.id });
      } else {
        toCreate.push({ ...payload, createdAt });
      }
    }

    if (toCreate.length) {
      await queryInterface.bulkInsert('Categories', toCreate);
    }

    const [settings] = await queryInterface.sequelize.query(
      'SELECT value FROM "SystemSettings" WHERE key = :key LIMIT 1;',
      { replacements: { key: 'merchant_category_rules' } }
    );
    let rules = [];
    try {
      rules = settings[0] && settings[0].value ? JSON.parse(settings[0].value) : [];
    } catch (err) {
      rules = [];
    }
    if (!Array.isArray(rules)) rules = [];

    const indexByPatternAndType = new Map(rules.map((rule, index) => [
      normalize(rule.pattern) + '|' + normalize(rule.transactionType),
      index
    ]));

    for (const item of catalog) {
      const categoryName = String(item.categoryName || '').trim();
      const transactionType = validTypes.has(normalize(item.categoryType)) ? normalize(item.categoryType) : 'expense';
      const keywords = Array.isArray(item.merchantKeywords) ? item.merchantKeywords : [];
      for (const keyword of keywords) {
        const pattern = normalize(keyword);
        if (!pattern || pattern.length < 2) continue;
        const rule = {
          pattern,
          categoryName,
          transactionType,
          source: 'category_keygroup',
          notes: item.groupName ? `Default catalog keyword group: ${item.groupName}.` : 'Default catalog keyword group.',
          updatedAt: createdAt.toISOString(),
          updatedByUserId: null
        };
        const key = pattern + '|' + transactionType;
        const existingIndex = indexByPatternAndType.get(key);
        if (existingIndex === undefined) {
          rules.unshift(rule);
          indexByPatternAndType.clear();
          rules.forEach((current, index) => {
            indexByPatternAndType.set(normalize(current.pattern) + '|' + normalize(current.transactionType), index);
          });
        } else {
          rules[existingIndex] = rule;
        }
      }
    }

    await queryInterface.sequelize.query(`
      INSERT INTO "SystemSettings" ("key", "value", "description", "createdAt", "updatedAt")
      VALUES (:key, :value, :description, :createdAt, :updatedAt)
      ON CONFLICT ("key") DO UPDATE SET
        "value" = EXCLUDED."value",
        "description" = EXCLUDED."description",
        "updatedAt" = EXCLUDED."updatedAt";
    `, {
      replacements: {
        key: 'merchant_category_rules',
        value: JSON.stringify(rules.slice(0, 1000)),
        description: 'Merchant keyword rules from default category catalog and user imports.',
        createdAt,
        updatedAt: createdAt
      }
    });
  },

  async down(queryInterface) {
    const names = catalog.map((item) => item.categoryName).filter(Boolean);
    await queryInterface.bulkDelete('Categories', { name: names }, {});

    const [settings] = await queryInterface.sequelize.query(
      'SELECT value FROM "SystemSettings" WHERE key = :key LIMIT 1;',
      { replacements: { key: 'merchant_category_rules' } }
    );
    let rules = [];
    try {
      rules = settings[0] && settings[0].value ? JSON.parse(settings[0].value) : [];
    } catch (err) {
      rules = [];
    }
    const filtered = Array.isArray(rules) ? rules.filter((rule) => rule.source !== 'category_keygroup') : [];
    await queryInterface.sequelize.query(
      'UPDATE "SystemSettings" SET value = :value, "updatedAt" = :updatedAt WHERE key = :key;',
      {
        replacements: {
          key: 'merchant_category_rules',
          value: JSON.stringify(filtered),
          updatedAt: now()
        }
      }
    );
  }
};
