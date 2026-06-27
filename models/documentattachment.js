'use strict';

const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class DocumentAttachment extends Model {
    static associate(models) {
      DocumentAttachment.belongsTo(models.Patient, { foreignKey: 'patientId' });
      DocumentAttachment.belongsTo(models.RXRecord, { foreignKey: 'rxRecordId' });
      DocumentAttachment.belongsTo(models.User, { foreignKey: 'uploadedByUserId', as: 'UploadedBy' });
    }
  }

  DocumentAttachment.init({
    ownerType: {
      type: DataTypes.STRING,
      allowNull: false
    },
    patientId: {
      type: DataTypes.INTEGER,
      allowNull: true
    },
    rxRecordId: {
      type: DataTypes.INTEGER,
      allowNull: true
    },
    originalName: {
      type: DataTypes.STRING,
      allowNull: false
    },
    storedName: {
      type: DataTypes.STRING,
      allowNull: false
    },
    mimeType: {
      type: DataTypes.STRING,
      allowNull: true
    },
    sizeBytes: {
      type: DataTypes.BIGINT,
      allowNull: false,
      defaultValue: 0
    },
    provider: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: 'local'
    },
    driveFileId: {
      type: DataTypes.STRING,
      allowNull: true
    },
    driveWebViewLink: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    localPath: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    uploadedByUserId: {
      type: DataTypes.INTEGER,
      allowNull: true
    },
    isDeleted: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false
    },
    deletedAt: {
      type: DataTypes.DATE,
      allowNull: true
    }
  }, {
    sequelize,
    modelName: 'DocumentAttachment'
  });

  return DocumentAttachment;
};
