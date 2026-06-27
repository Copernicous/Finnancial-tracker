'use strict';
const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class AccountBalanceSnapshot extends Model {
    static associate(models) {
      AccountBalanceSnapshot.belongsTo(models.Account, { foreignKey: 'accountId' });
    }
  }
  AccountBalanceSnapshot.init({
    accountId: { type: DataTypes.INTEGER, allowNull: false },
    snapshotDate: { type: DataTypes.DATEONLY, allowNull: false },
    balance: { type: DataTypes.DECIMAL(14, 2), allowNull: false, defaultValue: 0 },
    currency: { type: DataTypes.STRING, allowNull: false, defaultValue: 'USD' },
    source: { type: DataTypes.STRING, defaultValue: 'manual' },
    notes: DataTypes.TEXT,
    isSimulation: { type: DataTypes.BOOLEAN, defaultValue: false }
  }, { sequelize, modelName: 'AccountBalanceSnapshot' });
  return AccountBalanceSnapshot;
};
