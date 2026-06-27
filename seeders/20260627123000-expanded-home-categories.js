'use strict';

const now = () => new Date();

const categories = [
  ['Travel & Lodging', 'expense', 'Lifestyle', 'variable'],
  ['Shopping', 'expense', 'Living', 'variable'],
  ['Health & Pharmacy', 'expense', 'Health', 'variable'],
  ['Subscriptions & Software', 'expense', 'Utilities', 'fixed'],
  ['Household Supplies', 'expense', 'Home', 'variable'],
  ['Professional Services', 'expense', 'Finance', 'variable'],
  ['Education', 'expense', 'Education', 'variable']
];

module.exports = {
  async up(queryInterface) {
    await queryInterface.bulkInsert('Categories', categories.map(([name, categoryType, groupName, budgetBehavior]) => ({
      name,
      categoryType,
      groupName,
      budgetBehavior,
      isActive: true,
      createdAt: now(),
      updatedAt: now()
    })), { ignoreDuplicates: true });
  },

  async down(queryInterface) {
    await queryInterface.bulkDelete('Categories', {
      name: categories.map(([name]) => name)
    }, {});
  }
};
