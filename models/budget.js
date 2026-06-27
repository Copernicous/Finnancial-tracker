'use strict';
const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class Budget extends Model {
    static associate(models) {
      Budget.belongsTo(models.Category, { foreignKey: 'categoryId' });
    }
  }
  Budget.init({
    name: { type: DataTypes.STRING, allowNull: false },
    year: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 2026 },
    month: DataTypes.INTEGER,
    categoryId: DataTypes.INTEGER,
    budgetType: { type: DataTypes.STRING, allowNull: false, defaultValue: 'monthly' },
    plannedAmount: { type: DataTypes.DECIMAL(14, 2), allowNull: false, defaultValue: 0 },
    currency: { type: DataTypes.STRING, allowNull: false, defaultValue: 'USD' },
    alertThresholdPct: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 90 },
    isActive: { type: DataTypes.BOOLEAN, defaultValue: true },
    notes: DataTypes.TEXT,
    isSimulation: { type: DataTypes.BOOLEAN, defaultValue: false }
  }, { sequelize, modelName: 'Budget' });
  return Budget;
};
