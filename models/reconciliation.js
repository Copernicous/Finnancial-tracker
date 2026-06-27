'use strict';
const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class Reconciliation extends Model {
    static associate(models) {
      Reconciliation.belongsTo(models.Account, { foreignKey: 'accountId' });
      Reconciliation.belongsTo(models.User, { foreignKey: 'reviewedByUserId', as: 'ReviewedBy' });
    }
  }
  Reconciliation.init({
    accountId: { type: DataTypes.INTEGER, allowNull: false },
    periodStart: { type: DataTypes.DATEONLY, allowNull: false },
    periodEnd: { type: DataTypes.DATEONLY, allowNull: false },
    statementBalance: { type: DataTypes.DECIMAL(14, 2), defaultValue: 0 },
    bookBalance: { type: DataTypes.DECIMAL(14, 2), defaultValue: 0 },
    difference: { type: DataTypes.DECIMAL(14, 2), defaultValue: 0 },
    status: { type: DataTypes.STRING, defaultValue: 'open' },
    reviewedByUserId: DataTypes.INTEGER,
    reviewedAt: DataTypes.DATE,
    notes: DataTypes.TEXT,
    isSimulation: { type: DataTypes.BOOLEAN, defaultValue: false }
  }, { sequelize, modelName: 'Reconciliation' });
  return Reconciliation;
};
