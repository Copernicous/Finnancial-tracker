'use strict';
const {
  Model
} = require('sequelize');
module.exports = (sequelize, DataTypes) => {
  class RXRecord extends Model {
    /**
     * Helper method for defining associations.
     * This method is not a part of Sequelize lifecycle.
     * The `models/index` file will call this method automatically.
     */
    static associate(models) {
      RXRecord.belongsTo(models.Patient, { foreignKey: 'patientId' });
      RXRecord.belongsTo(models.PatientServiceDateCycle, { foreignKey: 'patientServiceDateCycleId' });
      RXRecord.belongsTo(models.Pharmacy, { foreignKey: 'pharmacyId' });
      RXRecord.belongsTo(models.PatientTransportCompany, { foreignKey: 'patientTransportCompanyId' });
      RXRecord.belongsTo(models.PharmacyTransportCompany, { foreignKey: 'pharmacyTransportCompanyId' });
      RXRecord.hasMany(models.Medication, { foreignKey: 'rxRecordId' });
      RXRecord.hasMany(models.RXWorkflowTracking, { foreignKey: 'rxRecordId' });
      RXRecord.hasMany(models.RXHistory, { foreignKey: 'rxRecordId' });
      RXRecord.hasMany(models.DocumentAttachment, { foreignKey: 'rxRecordId' });
    }
  }
  RXRecord.init({
    patientId: DataTypes.INTEGER,
    patientServiceDateCycleId: { type: DataTypes.INTEGER, allowNull: true },
    arrivalDate: DataTypes.DATEONLY,
    serviceDate: DataTypes.DATEONLY,
    pharmacyId: DataTypes.INTEGER,
    patientTransportCompanyId: DataTypes.INTEGER,
    pharmacyTransportCompanyId: DataTypes.INTEGER,
    isDeleted: { type: DataTypes.BOOLEAN, defaultValue: false },
    deletedAt: { type: DataTypes.DATE, allowNull: true },
    returnedToWarehouse: { type: DataTypes.BOOLEAN, defaultValue: false },
    warehouseReturnDate: { type: DataTypes.DATE, allowNull: true },
    warehouseReturnNote: { type: DataTypes.STRING, allowNull: true }
  }, {
    sequelize,
    modelName: 'RXRecord',
  });
  return RXRecord;
};
