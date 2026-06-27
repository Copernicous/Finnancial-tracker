'use strict';
const {
  Model
} = require('sequelize');
module.exports = (sequelize, DataTypes) => {
  class Patient extends Model {
    /**
     * Helper method for defining associations.
     * This method is not a part of Sequelize lifecycle.
     * The `models/index` file will call this method automatically.
     */
    static associate(models) {
      Patient.belongsTo(models.PatientTransportCompany, { foreignKey: 'patientTransportCompanyId' });
      Patient.belongsTo(models.PharmacyTransportCompany, { foreignKey: 'pharmacyTransportCompanyId' });
      Patient.belongsTo(models.Clinic, { foreignKey: 'clinicId' });
      Patient.belongsTo(models.Pharmacy, { foreignKey: 'pharmacyId' });
      Patient.hasMany(models.RXRecord, { foreignKey: 'patientId' });
      Patient.hasMany(models.DocumentAttachment, { foreignKey: 'patientId' });
      Patient.hasMany(models.PatientNote, { foreignKey: 'patientId', as: 'Notes' });
      Patient.hasMany(models.PatientNote, { foreignKey: 'patientId', as: 'PatientNotes' });
      Patient.hasMany(models.PatientServiceDateCycle, { foreignKey: 'patientId' });
      Patient.hasMany(models.PatientServiceDateHistory, { foreignKey: 'patientId' });
    }
  }
  Patient.init({
    firstName: DataTypes.STRING,
    lastName: DataTypes.STRING,
    dob: DataTypes.DATEONLY,
    address: DataTypes.STRING,
    phone: DataTypes.STRING,
    serviceDate: DataTypes.DATEONLY,
    patientTransportCompanyId: DataTypes.INTEGER,
    pharmacyTransportCompanyId: DataTypes.INTEGER,
    notes: DataTypes.TEXT,
    isActive: DataTypes.BOOLEAN,
    patientCode: DataTypes.STRING,
    clinicId: DataTypes.INTEGER,
    pharmacyId: DataTypes.INTEGER,
    isDeleted: DataTypes.BOOLEAN,
    isNonCompanyPatient: { type: DataTypes.BOOLEAN, defaultValue: false }
  }, {
    sequelize,
    modelName: 'Patient',
  });
  return Patient;
};
