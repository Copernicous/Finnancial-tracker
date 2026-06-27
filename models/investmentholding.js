'use strict';
const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class InvestmentHolding extends Model {
    static associate(models) {
      InvestmentHolding.belongsTo(models.Account, { foreignKey: 'accountId' });
    }
  }
  InvestmentHolding.init({
    accountId: { type: DataTypes.INTEGER, allowNull: false },
    symbol: { type: DataTypes.STRING, allowNull: false },
    name: DataTypes.STRING,
    assetClass: { type: DataTypes.STRING, defaultValue: 'fund' },
    quantity: { type: DataTypes.DECIMAL(18, 6), allowNull: false, defaultValue: 0 },
    costBasis: { type: DataTypes.DECIMAL(14, 2), allowNull: false, defaultValue: 0 },
    marketValue: { type: DataTypes.DECIMAL(14, 2), allowNull: false, defaultValue: 0 },
    currency: { type: DataTypes.STRING, allowNull: false, defaultValue: 'USD' },
    priceDate: DataTypes.DATEONLY,
    notes: DataTypes.TEXT,
    isSimulation: { type: DataTypes.BOOLEAN, defaultValue: false }
  }, { sequelize, modelName: 'InvestmentHolding' });
  return InvestmentHolding;
};
