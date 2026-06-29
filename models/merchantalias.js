'use strict';
const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class MerchantAlias extends Model {
    static associate(models) {
      MerchantAlias.belongsTo(models.Merchant, { foreignKey: 'merchantId' });
    }
  }
  MerchantAlias.init({
    merchantId: { type: DataTypes.INTEGER, allowNull: false },
    aliasText: { type: DataTypes.STRING, allowNull: false },
    normalizedAlias: { type: DataTypes.STRING, allowNull: false },
    matchType: { type: DataTypes.STRING, allowNull: false, defaultValue: 'contains' },
    priority: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 50 },
    source: { type: DataTypes.STRING, allowNull: false, defaultValue: 'manual' },
    notes: DataTypes.TEXT,
    isActive: { type: DataTypes.BOOLEAN, defaultValue: true }
  }, { sequelize, modelName: 'MerchantAlias' });
  return MerchantAlias;
};
