'use strict';
const {
  Model
} = require('sequelize');
module.exports = (sequelize, DataTypes) => {
  class Pharmacy extends Model {
    /**
     * Helper method for defining associations.
     * This method is not a part of Sequelize lifecycle.
     * The `models/index` file will call this method automatically.
     */
    static associate(models) {
      Pharmacy.hasMany(models.RXRecord, { foreignKey: 'pharmacyId' });
      Pharmacy.hasMany(models.Patient,  { foreignKey: 'pharmacyId' });
    }
  }
  Pharmacy.init({
    name: DataTypes.STRING,
    address: DataTypes.STRING,
    phone: DataTypes.STRING,
    contactPerson: DataTypes.STRING,
    notes: DataTypes.TEXT,
    isActive: DataTypes.BOOLEAN
  }, {
    sequelize,
    modelName: 'Pharmacy',
  });
  return Pharmacy;
};