'use strict';
const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class Merchant extends Model {
    static associate(models) {
      Merchant.belongsTo(models.Category, { foreignKey: 'defaultCategoryId', as: 'DefaultCategory' });
      Merchant.hasMany(models.MerchantAlias, { foreignKey: 'merchantId', as: 'Aliases' });
      Merchant.hasMany(models.Transaction, { foreignKey: 'merchantId' });
    }
  }
  Merchant.init({
    officialName: { type: DataTypes.STRING, allowNull: false },
    normalizedName: { type: DataTypes.STRING, allowNull: false, unique: true },
    merchantType: DataTypes.STRING,
    website: DataTypes.STRING,
    defaultCategoryId: DataTypes.INTEGER,
    defaultTransactionType: DataTypes.STRING,
    notes: DataTypes.TEXT,
    isActive: { type: DataTypes.BOOLEAN, defaultValue: true },
    lastSeenAt: DataTypes.DATE
  }, { sequelize, modelName: 'Merchant' });
  return Merchant;
};
