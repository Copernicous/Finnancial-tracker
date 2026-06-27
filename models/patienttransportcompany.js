'use strict';
const {
  Model
} = require('sequelize');
module.exports = (sequelize, DataTypes) => {
  class PatientTransportCompany extends Model {
    /**
     * Helper method for defining associations.
     * This method is not a part of Sequelize lifecycle.
     * The `models/index` file will call this method automatically.
     */
    static associate(models) {
      PatientTransportCompany.hasMany(models.Patient, { foreignKey: 'patientTransportCompanyId' });
      PatientTransportCompany.hasMany(models.RXRecord, { foreignKey: 'patientTransportCompanyId' });
    }
  }
  PatientTransportCompany.init({
    companyName: DataTypes.STRING,
    phone: DataTypes.STRING,
    contactPerson: DataTypes.STRING,
    notes: DataTypes.TEXT,
    isActive: DataTypes.BOOLEAN
  }, {
    sequelize,
    modelName: 'PatientTransportCompany',
  });
  return PatientTransportCompany;
};