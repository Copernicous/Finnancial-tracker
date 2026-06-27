'use strict';
const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class Transaction extends Model {
    static associate(models) {
      Transaction.belongsTo(models.Account, { foreignKey: 'accountId' });
      Transaction.belongsTo(models.Category, { foreignKey: 'categoryId' });
      Transaction.belongsTo(models.Account, { foreignKey: 'relatedAccountId', as: 'RelatedAccount' });
      Transaction.belongsTo(models.User, { foreignKey: 'reviewedByUserId', as: 'ReviewedBy' });
    }
  }
  Transaction.init({
    transactionDate: { type: DataTypes.DATEONLY, allowNull: false },
    accountId: { type: DataTypes.INTEGER, allowNull: false },
    categoryId: DataTypes.INTEGER,
    relatedAccountId: DataTypes.INTEGER,
    description: { type: DataTypes.STRING, allowNull: false },
    merchant: DataTypes.STRING,
    normalizedMerchant: DataTypes.STRING,
    transactionType: { type: DataTypes.STRING, allowNull: false },
    amount: { type: DataTypes.DECIMAL(14, 2), allowNull: false },
    currency: { type: DataTypes.STRING, allowNull: false, defaultValue: 'USD' },
    originalAmount: DataTypes.DECIMAL(14, 2),
    originalCurrency: DataTypes.STRING,
    exchangeRate: DataTypes.DECIMAL(14, 6),
    status: { type: DataTypes.STRING, allowNull: false, defaultValue: 'draft' },
    sourceType: { type: DataTypes.STRING, allowNull: false, defaultValue: 'manual' },
    referenceNumber: DataTypes.STRING,
    tags: DataTypes.STRING,
    clearedDate: DataTypes.DATEONLY,
    isRecurring: { type: DataTypes.BOOLEAN, defaultValue: false },
    memo: DataTypes.TEXT,
    reviewedByUserId: DataTypes.INTEGER,
    reviewedAt: DataTypes.DATE,
    isSimulation: { type: DataTypes.BOOLEAN, defaultValue: false }
  }, { sequelize, modelName: 'Transaction' });
  return Transaction;
};
