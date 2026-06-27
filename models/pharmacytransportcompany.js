'use strict';
const {
  Model
} = require('sequelize');
module.exports = (sequelize, DataTypes) => {
  class PharmacyTransportCompany extends Model {
    /**
     * Helper method for defining associations.
     * This method is not a part of Sequelize lifecycle.
     * The `models/index` file will call this method automatically.
     */
    static associate(models) {
      PharmacyTransportCompany.hasMany(models.Patient, { foreignKey: 'pharmacyTransportCompanyId' });
      PharmacyTransportCompany.hasMany(models.RXRecord, { foreignKey: 'pharmacyTransportCompanyId' });
    }
  }
  PharmacyTransportCompany.init({
    companyName: DataTypes.STRING,
    phone: DataTypes.STRING,
    contactPerson: DataTypes.STRING,
    notes: DataTypes.TEXT,
    isActive: DataTypes.BOOLEAN
  }, {
    sequelize,
    modelName: 'PharmacyTransportCompany',
  });
  return PharmacyTransportCompany;
};