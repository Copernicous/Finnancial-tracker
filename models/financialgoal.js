'use strict';
const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class FinancialGoal extends Model {
    static associate(models) {
      FinancialGoal.belongsTo(models.Account, { foreignKey: 'accountId' });
    }
  }
  FinancialGoal.init({
    name: { type: DataTypes.STRING, allowNull: false },
    goalType: { type: DataTypes.STRING, allowNull: false, defaultValue: 'savings' },
    accountId: DataTypes.INTEGER,
    targetAmount: { type: DataTypes.DECIMAL(14, 2), allowNull: false, defaultValue: 0 },
    currentAmount: { type: DataTypes.DECIMAL(14, 2), allowNull: false, defaultValue: 0 },
    currency: { type: DataTypes.STRING, allowNull: false, defaultValue: 'USD' },
    targetDate: DataTypes.DATEONLY,
    priority: { type: DataTypes.INTEGER, defaultValue: 3 },
    status: { type: DataTypes.STRING, defaultValue: 'active' },
    notes: DataTypes.TEXT,
    isSimulation: { type: DataTypes.BOOLEAN, defaultValue: false }
  }, { sequelize, modelName: 'FinancialGoal' });
  return FinancialGoal;
};
