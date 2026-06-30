'use strict';

const OPERATION_CATEGORIES = [
  {
    name: 'Payments Received',
    categoryType: 'transfer',
    groupName: 'Transfers',
    budgetBehavior: 'transfer'
  },
  {
    name: 'Payments Sent',
    categoryType: 'transfer',
    groupName: 'Transfers',
    budgetBehavior: 'transfer'
  },
  {
    name: 'Cash Deposit',
    categoryType: 'transfer',
    groupName: 'Cash',
    budgetBehavior: 'transfer'
  }
];

module.exports = {
  async up(queryInterface, Sequelize) {
    const now = new Date();
    for (const category of OPERATION_CATEGORIES) {
      await queryInterface.sequelize.query(
        `INSERT INTO "Categories" ("name", "categoryType", "groupName", "budgetBehavior", "taxRelevant", "isActive", "createdAt", "updatedAt")
         SELECT :name, :categoryType, :groupName, :budgetBehavior, false, true, :now, :now
         WHERE NOT EXISTS (
           SELECT 1 FROM "Categories" WHERE lower("name") = lower(:name)
         )`,
        { replacements: { ...category, now } }
      );
    }
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.bulkDelete('Categories', {
      name: { [Sequelize.Op.in]: OPERATION_CATEGORIES.map((category) => category.name) }
    });
  }
};
