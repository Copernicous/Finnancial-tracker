'use strict';

const now = () => new Date();

const institutions = [
  ['Citi Advantage', 'credit_card', 'Legacy structure reference. Classification: CREDIT_CARD.'],
  ['Citi Bogota', 'bank', 'Legacy structure reference. Classification: SAVINGS_OR_BANK.'],
  ['Citi CDT', 'certificate_deposit', 'Legacy structure reference. Classification: CD.'],
  ['Citi Checking', 'bank', 'Legacy structure reference. Classification: CHECKING.'],
  ['Citi Savings', 'bank', 'Legacy structure reference. Classification: SAVINGS.'],
  ['Citi Ultimate Savings', 'bank', 'Legacy structure reference. Classification: SAVINGS.'],
  ['Corredores Asociados', 'investment', 'Legacy structure reference. Classification: INVESTMENT.'],
  ['Daniela Savings', 'family_savings', 'Legacy structure reference. Classification: FAMILY_SAVINGS.'],
  ['Davivienda', 'bank', 'Legacy structure reference. Classification: BANK.'],
  ['Fidelity Annie', 'investment', 'Legacy structure reference. Classification: INVESTMENT.'],
  ['Fidelity Frank', 'investment', 'Legacy structure reference. Classification: INVESTMENT.'],
  ['ING 360 Performance Savings', 'bank', 'Legacy structure reference. Classification: SAVINGS.'],
  ['ING CD', 'certificate_deposit', 'Legacy structure reference. Classification: CD.'],
  ['ING Savings', 'bank', 'Legacy structure reference. Classification: SAVINGS.'],
  ['Nicholas Savings', 'family_savings', 'Legacy structure reference. Classification: FAMILY_SAVINGS.'],
  ['Pension Annie', 'pension', 'Legacy structure reference. Classification: PENSION.'],
  ['Pension Frank', 'pension', 'Legacy structure reference. Classification: PENSION.'],
  ['Popular Checking', 'bank', 'Legacy structure reference. Classification: CHECKING.'],
  ['Popular Historical', 'bank', 'Legacy structure reference. Classification: BANK_HISTORICAL.'],
  ['Roth IRA Annie', 'retirement', 'Legacy structure reference. Classification: RETIREMENT.'],
  ['Roth IRA Frank', 'retirement', 'Legacy structure reference. Classification: RETIREMENT.'],
  ['Skandia', 'investment', 'Legacy structure reference. Classification: INVESTMENT.']
];

module.exports = {
  async up(queryInterface) {
    await queryInterface.bulkInsert('FinancialInstitutions', institutions.map(([name, institutionType, notes]) => ({
      name,
      institutionType,
      notes: `${notes} Structure only; no historical transactions, balances, or totals imported.`,
      isActive: true,
      createdAt: now(),
      updatedAt: now()
    })), { ignoreDuplicates: true });
  },

  async down(queryInterface) {
    await queryInterface.bulkDelete('FinancialInstitutions', {
      name: institutions.map(([name]) => name)
    }, {});
  }
};
