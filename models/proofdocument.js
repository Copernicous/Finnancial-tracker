'use strict';
const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class ProofDocument extends Model {
    static associate(models) {
      ProofDocument.belongsTo(models.User, { foreignKey: 'uploadedByUserId', as: 'UploadedBy' });
    }
  }
  ProofDocument.init({
    ownerType: { type: DataTypes.STRING, allowNull: false },
    ownerId: DataTypes.INTEGER,
    originalName: { type: DataTypes.STRING, allowNull: false },
    storedName: { type: DataTypes.STRING, allowNull: false },
    mimeType: DataTypes.STRING,
    sizeBytes: { type: DataTypes.BIGINT, allowNull: false, defaultValue: 0 },
    provider: { type: DataTypes.STRING, allowNull: false, defaultValue: 'local' },
    driveFileId: DataTypes.STRING,
    driveWebViewLink: DataTypes.TEXT,
    localPath: DataTypes.TEXT,
    uploadedByUserId: DataTypes.INTEGER,
    isDeleted: { type: DataTypes.BOOLEAN, defaultValue: false },
    deletedAt: DataTypes.DATE
  }, { sequelize, modelName: 'ProofDocument' });
  return ProofDocument;
};
