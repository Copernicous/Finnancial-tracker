'use strict';
const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class Account extends Model {
    static associate(models) {
      Account.belongsTo(models.FinancialInstitution, { foreignKey: 'financialInstitutionId' });
      Account.hasMany(models.Transaction, { foreignKey: 'accountId' });
      Account.hasMany(models.AccountAlias, { foreignKey: 'accountId' });
      Account.hasMany(models.Reconciliation, { foreignKey: 'accountId' });
      Account.hasMany(models.RecurringTransaction, { foreignKey: 'accountId' });
      Account.hasMany(models.FinancialGoal, { foreignKey: 'accountId' });
      Account.hasMany(models.InvestmentHolding, { foreignKey: 'accountId' });
      Account.hasMany(models.AccountBalanceSnapshot, { foreignKey: 'accountId' });
    }
  }
  Account.init({
    name: { type: DataTypes.STRING, allowNull: false },
    accountCode: DataTypes.STRING,
    accountType: { type: DataTypes.STRING, allowNull: false },
    accountClass: { type: DataTypes.STRING, defaultValue: 'banking' },
    accountSubtype: DataTypes.STRING,
    currency: { type: DataTypes.STRING, allowNull: false, defaultValue: 'USD' },
    financialInstitutionId: DataTypes.INTEGER,
    openingBalance: { type: DataTypes.DECIMAL(14, 2), defaultValue: 0 },
    openingBalanceDate: DataTypes.DATEONLY,
    currentBalance: { type: DataTypes.DECIMAL(14, 2), defaultValue: 0 },
    creditLimit: DataTypes.DECIMAL(14, 2),
    interestRate: DataTypes.DECIMAL(8, 4),
    includeInNetWorth: { type: DataTypes.BOOLEAN, defaultValue: true },
    status: { type: DataTypes.STRING, defaultValue: 'active' },
    notes: DataTypes.TEXT,
    isSimulation: { type: DataTypes.BOOLEAN, defaultValue: false }
  }, { sequelize, modelName: 'Account' });
  return Account;
};
