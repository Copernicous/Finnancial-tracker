'use strict';
const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
    class ApiKey extends Model {
        static associate(models) {
            ApiKey.belongsTo(models.User, { foreignKey: 'createdByUserId', as: 'CreatedBy' });
        }
    }

    ApiKey.init({
        // Human-readable label for this key (e.g. "Integration System", "Mobile App")
        name: {
            type: DataTypes.STRING,
            allowNull: false
        },
        // First 12 chars of the key, shown in the list so admins can identify which key is which
        // Format: "rxk_XXXXXXXX"
        keyPrefix: {
            type: DataTypes.STRING,
            allowNull: false
        },
        // SHA-256 hash of the full key — never store the plaintext after creation
        keyHash: {
            type: DataTypes.STRING,
            allowNull: false
        },
        // Optional: description of what this key is used for
        description: {
            type: DataTypes.TEXT,
            allowNull: true
        },
        // Who created this key
        createdByUserId: {
            type: DataTypes.INTEGER,
            allowNull: true
        },
        // Whether this key is currently active (can be disabled without deleting)
        isActive: {
            type: DataTypes.BOOLEAN,
            defaultValue: true
        },
        // When was this key last used to make an API call
        lastUsedAt: {
            type: DataTypes.DATE,
            allowNull: true
        },
        // Optional expiry date — null means never expires
        expiresAt: {
            type: DataTypes.DATE,
            allowNull: true
        }
    }, {
        sequelize,
        modelName: 'ApiKey',
        tableName: 'ApiKeys'
    });

    return ApiKey;
};
