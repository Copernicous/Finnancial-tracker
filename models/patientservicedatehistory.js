'use strict';
const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class PatientServiceDateHistory extends Model {
    static associate(models) {
      PatientServiceDateHistory.belongsTo(models.Patient, { foreignKey: 'patientId' });
      PatientServiceDateHistory.belongsTo(models.User, { foreignKey: 'changedByUserId', as: 'ChangedBy' });
    }
  }

  PatientServiceDateHistory.init({
    patientId:           { type: DataTypes.INTEGER, allowNull: false },
    previousServiceDate: { type: DataTypes.DATEONLY, allowNull: true },
    newServiceDate:      { type: DataTypes.DATEONLY, allowNull: true },
    changedByUserId:     { type: DataTypes.INTEGER, allowNull: true },
    changeSource:        { type: DataTypes.STRING(60), allowNull: false, defaultValue: 'Patient Update' },
    reason:              { type: DataTypes.TEXT, allowNull: true },
    metadata:            { type: DataTypes.JSON, allowNull: true }
  }, {
    sequelize,
    modelName: 'PatientServiceDateHistory',
    tableName: 'PatientServiceDateHistories'
  });

  return PatientServiceDateHistory;
};
