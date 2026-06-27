'use strict';
const { Model } = require('sequelize');
module.exports = (sequelize, DataTypes) => {
  class DailySnapshot extends Model {
    static associate() { /* standalone — no FK associations */ }
  }
  DailySnapshot.init({
    snapshotDate:            { type: DataTypes.DATEONLY,  allowNull: false, unique: true },
    totalAccounts:           { type: DataTypes.INTEGER,  defaultValue: 0 },
    activeAccounts:          { type: DataTypes.INTEGER,  defaultValue: 0 },
    totalTransactions:       { type: DataTypes.INTEGER,  defaultValue: 0 },
    transactionsToday:       { type: DataTypes.INTEGER,  defaultValue: 0 },
    draftTransactions:       { type: DataTypes.INTEGER,  defaultValue: 0 },
    reviewedTransactions:    { type: DataTypes.INTEGER,  defaultValue: 0 },
    reconciledTransactions:  { type: DataTypes.INTEGER,  defaultValue: 0 },
    proofDocuments:          { type: DataTypes.INTEGER,  defaultValue: 0 },
    openReconciliations:     { type: DataTypes.INTEGER,  defaultValue: 0 },
    netWorth:                { type: DataTypes.DECIMAL(14, 2), defaultValue: 0 },
    netIncomeMonth:          { type: DataTypes.DECIMAL(14, 2), defaultValue: 0 },
    // Users & Activity
    totalUsers:              { type: DataTypes.INTEGER,  defaultValue: 0 },
    activeUsers:             { type: DataTypes.INTEGER,  defaultValue: 0 },
    auditEventsToday:        { type: DataTypes.INTEGER,  defaultValue: 0 },
    errorLogsToday:          { type: DataTypes.INTEGER,  defaultValue: 0 },
    unresolvedErrors:        { type: DataTypes.INTEGER,  defaultValue: 0 },
    totalFinancialInstitutions: { type: DataTypes.INTEGER,  defaultValue: 0 },
    totalCategories:           { type: DataTypes.INTEGER,  defaultValue: 0 },
  }, {
    sequelize,
    modelName: 'DailySnapshot',
  });
  return DailySnapshot;
};
