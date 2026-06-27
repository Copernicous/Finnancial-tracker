'use strict';
const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class Role extends Model {
    static associate(models) {
      Role.hasMany(models.User, { foreignKey: 'roleId' });
    }
  }
  Role.init({
    name: {
      type: DataTypes.STRING,
      allowNull: false
    },
    description: {
      type: DataTypes.STRING,
      allowNull: true
    },
    isSystem: {
      type: DataTypes.BOOLEAN,
      defaultValue: false
    },
    permissions: {
      type: DataTypes.TEXT,
      allowNull: true,
      get() {
        const raw = this.getDataValue('permissions');
        return raw ? JSON.parse(raw) : null;
      },
      set(value) {
        this.setDataValue('permissions', value ? JSON.stringify(value) : null);
      }
    }
  }, {
    sequelize,
    modelName: 'Role',
  });
  return Role;
};