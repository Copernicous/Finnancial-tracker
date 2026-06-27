'use strict';
const {
  Model
} = require('sequelize');
module.exports = (sequelize, DataTypes) => {
  class AuditLog extends Model {
    /**
     * Helper method for defining associations.
     * This method is not a part of Sequelize lifecycle.
     * The `models/index` file will call this method automatically.
     */
    static associate(models) {
      AuditLog.belongsTo(models.User, { foreignKey: 'userId' });
    }
  }
  AuditLog.init({
    userId: DataTypes.INTEGER,
    date: DataTypes.DATEONLY,
    time: DataTypes.TIME,
    module: DataTypes.STRING,
    action: DataTypes.STRING,
    recordId: DataTypes.INTEGER,
    previousValue: DataTypes.JSON,
    newValue: DataTypes.JSON,
    ipAddress: DataTypes.STRING
  }, {
    sequelize,
    modelName: 'AuditLog',
  });
  return AuditLog;
};