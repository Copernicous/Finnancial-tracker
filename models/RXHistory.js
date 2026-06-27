'use strict';
const { Model } = require('sequelize');
module.exports = (sequelize, DataTypes) => {
    class RXHistory extends Model {
        static associate(models) {
            RXHistory.belongsTo(models.RXRecord, { foreignKey: 'rxRecordId' });
            RXHistory.belongsTo(models.User, { foreignKey: 'userId', as: 'ChangedBy' });
        }
    }
    RXHistory.init({
        rxRecordId:  { type: DataTypes.INTEGER, allowNull: false },
        userId:      { type: DataTypes.INTEGER, allowNull: true },
        changeType:  { type: DataTypes.STRING(50),  defaultValue: 'Update' },  // Create | Update | Workflow | Delete | Restore
        snapshot:    { type: DataTypes.TEXT, allowNull: false },   // JSON of full record before change
        changedFields: { type: DataTypes.TEXT, allowNull: true },  // JSON array of {field, from, to}
        note:        { type: DataTypes.STRING(255), allowNull: true }
    }, {
        sequelize,
        modelName: 'RXHistory',
        tableName: 'RXHistories',
        updatedAt: false   // only createdAt needed
    });
    return RXHistory;
};
