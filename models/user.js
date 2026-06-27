'use strict';
const {
  Model
} = require('sequelize');
module.exports = (sequelize, DataTypes) => {
  class User extends Model {
    /**
     * Helper method for defining associations.
     * This method is not a part of Sequelize lifecycle.
     * The `models/index` file will call this method automatically.
     */
    static associate(models) {
      User.belongsTo(models.Role, { foreignKey: 'roleId' });
      User.hasMany(models.PatientServiceDateHistory, { foreignKey: 'changedByUserId' });
    }
    
    async validPassword(password) {
      const bcrypt = require('bcryptjs');
      return await bcrypt.compare(password, this.passwordHash);
    }
  }
  User.init({
    firstName:        DataTypes.STRING,
    lastName:         DataTypes.STRING,
    username:         DataTypes.STRING,
    passwordHash:     DataTypes.STRING,
    email:            DataTypes.STRING,
    roleId:           DataTypes.INTEGER,
    isActive:         DataTypes.BOOLEAN,
    notes:            DataTypes.TEXT,
    // 2FA fields
    twoFactorSecret:  DataTypes.TEXT,
    twoFactorEnabled: { type: DataTypes.BOOLEAN, defaultValue: false },
    backupCodes: {
        type: DataTypes.TEXT,
        get() {
            const raw = this.getDataValue('backupCodes');
            return raw ? JSON.parse(raw) : [];
        },
        set(value) {
            this.setDataValue('backupCodes', value ? JSON.stringify(value) : null);
        }
    },
    // Account lockout fields
    failedLoginCount: { type: DataTypes.INTEGER, defaultValue: 0 },
    lockedUntil:      DataTypes.DATE,
    // Token version — increment on password change to invalidate old JWTs
    tokenVersion:     { type: DataTypes.INTEGER, defaultValue: 0 },
    // MASTER admin flag — grants access to /backoffice (Data Control Center).
    // ⚠️  This field can ONLY be set via direct SQL on PostgreSQL.
    // ⚠️  No API endpoint or UI exposes this field. See OPERATIONS_MANUAL for recovery SQL.
    isMaster:         { type: DataTypes.BOOLEAN, defaultValue: false },
    permissions: {
        type: DataTypes.TEXT,
        get() {
            const rawValue = this.getDataValue('permissions');
            return rawValue ? JSON.parse(rawValue) : null;
        },
        set(value) {
            this.setDataValue('permissions', value ? JSON.stringify(value) : null);
        }
    }
}, {
    sequelize,
    modelName: 'User',
});
return User;
};
