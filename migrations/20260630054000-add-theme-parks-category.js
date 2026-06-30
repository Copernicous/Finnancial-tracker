'use strict';

module.exports = {
  async up(queryInterface) {
    const now = new Date();
    await queryInterface.sequelize.query(`
      INSERT INTO "Categories" ("name", "categoryType", "groupName", "budgetBehavior", "taxRelevant", "isActive", "createdAt", "updatedAt")
      SELECT 'Theme Parks and Attractions', 'expense', 'Entertainment', 'discretionary', false, true, :now, :now
      WHERE NOT EXISTS (
        SELECT 1 FROM "Categories" WHERE lower("name") = lower('Theme Parks and Attractions')
      )
    `, { replacements: { now } });
    await queryInterface.sequelize.query(`
      UPDATE "Categories"
      SET "categoryType" = 'expense',
          "groupName" = 'Entertainment',
          "budgetBehavior" = 'discretionary',
          "isActive" = true,
          "updatedAt" = :now
      WHERE lower("name") = lower('Theme Parks and Attractions')
    `, { replacements: { now } });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.bulkDelete('Categories', { name: { [Sequelize.Op.iLike]: 'Theme Parks and Attractions' } });
  }
};
