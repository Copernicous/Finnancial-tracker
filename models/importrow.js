'use strict';
const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class ImportRow extends Model {
    static associate(models) {
      ImportRow.belongsTo(models.ImportBatch, { foreignKey: 'importBatchId' });
    }
  }
  ImportRow.init({
    importBatchId: { type: DataTypes.INTEGER, allowNull: false },
    rowNumber: { type: DataTypes.INTEGER, allowNull: false },
    rawData: { type: DataTypes.JSON, allowNull: false },
    normalizedData: DataTypes.JSON,
    status: { type: DataTypes.STRING, allowNull: false, defaultValue: 'staged' },
    errorMessage: DataTypes.TEXT,
    matchedAccountId: DataTypes.INTEGER,
    matchedCategoryId: DataTypes.INTEGER,
    postedTransactionId: DataTypes.INTEGER
  }, { sequelize, modelName: 'ImportRow' });
  return ImportRow;
};
