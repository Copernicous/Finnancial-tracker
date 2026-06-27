'use strict';
const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class ImportBatch extends Model {
    static associate(models) {
      ImportBatch.belongsTo(models.User, { foreignKey: 'createdByUserId', as: 'CreatedBy' });
      ImportBatch.hasMany(models.ImportRow, { foreignKey: 'importBatchId' });
    }
  }
  ImportBatch.init({
    importType: { type: DataTypes.STRING, allowNull: false },
    fileName: DataTypes.STRING,
    status: { type: DataTypes.STRING, allowNull: false, defaultValue: 'draft' },
    rowCount: { type: DataTypes.INTEGER, defaultValue: 0 },
    acceptedCount: { type: DataTypes.INTEGER, defaultValue: 0 },
    rejectedCount: { type: DataTypes.INTEGER, defaultValue: 0 },
    notes: DataTypes.TEXT,
    createdByUserId: DataTypes.INTEGER,
    isSimulation: { type: DataTypes.BOOLEAN, defaultValue: false }
  }, { sequelize, modelName: 'ImportBatch' });
  return ImportBatch;
};
