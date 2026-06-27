'use strict';
const { Model } = require('sequelize');
module.exports = (sequelize, DataTypes) => {
  class ErrorLog extends Model {
    static associate(models) {
      ErrorLog.belongsTo(models.User, { foreignKey: 'userId', as: 'User' });
    }
  }
  ErrorLog.init({
    source:     { type: DataTypes.ENUM('frontend', 'backend'), defaultValue: 'frontend' },
    severity:   { type: DataTypes.ENUM('error', 'warning', 'info'), defaultValue: 'error' },
    message:    DataTypes.TEXT,
    stack:      DataTypes.TEXT,
    url:        DataTypes.STRING,
    userAgent:  DataTypes.STRING,
    userId:     DataTypes.INTEGER,
    ipAddress:  DataTypes.STRING,
    resolved:   { type: DataTypes.BOOLEAN, defaultValue: false }
  }, {
    sequelize,
    modelName: 'ErrorLog',
  });
  return ErrorLog;
};
