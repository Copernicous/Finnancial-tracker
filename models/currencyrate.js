'use strict';
const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class CurrencyRate extends Model {}
  CurrencyRate.init({
    rateDate: { type: DataTypes.DATEONLY, allowNull: false },
    fromCurrency: { type: DataTypes.STRING, allowNull: false },
    toCurrency: { type: DataTypes.STRING, allowNull: false, defaultValue: 'USD' },
    rate: { type: DataTypes.DECIMAL(14, 6), allowNull: false },
    source: { type: DataTypes.STRING, defaultValue: 'manual' },
    notes: DataTypes.TEXT,
    isSimulation: { type: DataTypes.BOOLEAN, defaultValue: false }
  }, { sequelize, modelName: 'CurrencyRate' });
  return CurrencyRate;
};
