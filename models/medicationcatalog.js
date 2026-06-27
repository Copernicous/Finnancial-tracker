'use strict';
const { Model } = require('sequelize');
module.exports = (sequelize, DataTypes) => {
  class MedicationCatalog extends Model {
    static associate(models) {
      // standalone catalog — no direct FK associations needed
    }
  }
  MedicationCatalog.init({
    name:        { type: DataTypes.STRING, allowNull: false },
    description: { type: DataTypes.TEXT },
    sortOrder:   { type: DataTypes.INTEGER, defaultValue: 999 },
    isActive:    { type: DataTypes.BOOLEAN, defaultValue: true }
  }, {
    sequelize,
    modelName: 'MedicationCatalog',
  });
  return MedicationCatalog;
};
