'use strict';
const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class RecurringTransaction extends Model {
    static associate(models) {
      RecurringTransaction.belongsTo(models.Account, { foreignKey: 'accountId' });
      RecurringTransaction.belongsTo(models.Category, { foreignKey: 'categoryId' });
    }
  }
  RecurringTransaction.init({
    name: { type: DataTypes.STRING, allowNull: false },
    accountId: { type: DataTypes.INTEGER, allowNull: false },
    categoryId: DataTypes.INTEGER,
    transactionType: { type: DataTypes.STRING, allowNull: false },
    amount: { type: DataTypes.DECIMAL(14, 2), allowNull: false },
    currency: { type: DataTypes.STRING, allowNull: false, defaultValue: 'USD' },
    frequency: { type: DataTypes.STRING, allowNull: false, defaultValue: 'monthly' },
    nextDate: { type: DataTypes.DATEONLY, allowNull: false },
    endDate: DataTypes.DATEONLY,
    merchant: DataTypes.STRING,
    notes: DataTypes.TEXT,
    isActive: { type: DataTypes.BOOLEAN, defaultValue: true },
    isSimulation: { type: DataTypes.BOOLEAN, defaultValue: false }
  }, { sequelize, modelName: 'RecurringTransaction' });
  return RecurringTransaction;
};
