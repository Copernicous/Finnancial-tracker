'use strict';
const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class PatientServiceDateCycle extends Model {
    static associate(models) {
      PatientServiceDateCycle.belongsTo(models.Patient, { foreignKey: 'patientId' });
      PatientServiceDateCycle.belongsTo(models.User, { foreignKey: 'createdByUserId', as: 'CreatedBy' });
      PatientServiceDateCycle.hasMany(models.RXRecord, { foreignKey: 'patientServiceDateCycleId' });
    }
  }

  PatientServiceDateCycle.init({
    patientId:        { type: DataTypes.INTEGER, allowNull: false },
    serviceDate:      { type: DataTypes.DATEONLY, allowNull: false },
    status:           { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'historical' },
    source:           { type: DataTypes.STRING(60), allowNull: false, defaultValue: 'Patient Service Date' },
    startedAt:        { type: DataTypes.DATE, allowNull: true },
    endedAt:          { type: DataTypes.DATE, allowNull: true },
    createdByUserId:  { type: DataTypes.INTEGER, allowNull: true },
    metadata:         { type: DataTypes.JSON, allowNull: true }
  }, {
    sequelize,
    modelName: 'PatientServiceDateCycle',
    tableName: 'PatientServiceDateCycles',
    indexes: [
      { name: 'idx_patient_service_date_cycles_patient', fields: ['patientId'] },
      { name: 'idx_patient_service_date_cycles_status', fields: ['patientId', 'status'] },
      { name: 'uq_patient_service_date_cycles_patient_date', unique: true, fields: ['patientId', 'serviceDate'] }
    ]
  });

  return PatientServiceDateCycle;
};
