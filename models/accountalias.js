'use strict';
const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class AccountAlias extends Model {
    static associate(models) {
      AccountAlias.belongsTo(models.Account, { foreignKey: 'accountId' });
    }
  }
  AccountAlias.init({
    accountId: { type: DataTypes.INTEGER, allowNull: false },
    alias: { type: DataTypes.STRING, allowNull: false },
    source: { type: DataTypes.STRING, allowNull: false, defaultValue: 'legacy_structure_reference' },
    notes: DataTypes.TEXT
  }, { sequelize, modelName: 'AccountAlias' });
  return AccountAlias;
};
