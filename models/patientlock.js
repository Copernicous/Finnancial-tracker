'use strict';
const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
    class PatientLock extends Model {
        static associate(models) {
            PatientLock.belongsTo(models.Patient, { foreignKey: 'patientId', as: 'Patient' });
            PatientLock.belongsTo(models.User,    { foreignKey: 'userId',    as: 'User'    });
        }

        /** True if the lock has not yet expired */
        get isActive() {
            return new Date() < new Date(this.expiresAt);
        }
    }

    PatientLock.init({
        patientId: {
            type:      DataTypes.INTEGER,
            allowNull: false
        },
        userId: {
            type:      DataTypes.INTEGER,
            allowNull: false
        },
        // ISO timestamp: when the lock was first acquired
        lockedAt: {
            type:         DataTypes.DATE,
            allowNull:    false,
            defaultValue: DataTypes.NOW
        },
        // ISO timestamp: lock expires if not renewed — set to NOW + TTL on each heartbeat
        expiresAt: {
            type:      DataTypes.DATE,
            allowNull: false
        }
    }, {
        sequelize,
        modelName: 'PatientLock',
        tableName: 'PatientLocks',
        indexes: [
            // One active lock row per patient — enforce in app logic, not DB constraint
            // (allows replacing stale locks without DELETE+INSERT)
            { fields: ['patientId'] },
            { fields: ['userId'] },
            { fields: ['expiresAt'] }   // speeds up cleanup of expired locks
        ]
    });

    return PatientLock;
};
