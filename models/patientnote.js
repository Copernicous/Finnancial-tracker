'use strict';
const { Model } = require('sequelize');
module.exports = (sequelize, DataTypes) => {
  class PatientNote extends Model {
    static associate(models) {
      PatientNote.belongsTo(models.Patient, { foreignKey: 'patientId' });
      PatientNote.belongsTo(models.User,    { foreignKey: 'userId',    as: 'Author' });
    }
  }
  PatientNote.init({
    patientId: { type: DataTypes.INTEGER, allowNull: false },
    userId:    { type: DataTypes.INTEGER, allowNull: true },
    note:      { type: DataTypes.TEXT,    allowNull: false }
  }, {
    sequelize,
    modelName: 'PatientNote',
    timestamps: true   // adds createdAt / updatedAt automatically
  });
  return PatientNote;
};
