'use strict';
const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class FinancialInstitution extends Model {
    static associate(models) {
      FinancialInstitution.hasMany(models.Account, { foreignKey: 'financialInstitutionId' });
    }
  }
  FinancialInstitution.init({
    name: { type: DataTypes.STRING, allowNull: false },
    institutionType: { type: DataTypes.STRING, allowNull: false, defaultValue: 'bank' },
    website: DataTypes.STRING,
    contactInfo: DataTypes.TEXT,
    notes: DataTypes.TEXT,
    isActive: { type: DataTypes.BOOLEAN, defaultValue: true }
  }, { sequelize, modelName: 'FinancialInstitution' });
  return FinancialInstitution;
};
