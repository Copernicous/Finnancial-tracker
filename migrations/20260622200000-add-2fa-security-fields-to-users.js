'use strict';
module.exports = {
  async up(queryInterface, Sequelize) {
    const tableDesc = await queryInterface.describeTable('Users');

    // twoFactorSecret — stores the TOTP base32 secret
    if (!tableDesc.twoFactorSecret) {
      await queryInterface.addColumn('Users', 'twoFactorSecret', {
        type: Sequelize.TEXT,
        allowNull: true,
        defaultValue: null
      });
    }

    // twoFactorEnabled — is TOTP active for this user?
    if (!tableDesc.twoFactorEnabled) {
      await queryInterface.addColumn('Users', 'twoFactorEnabled', {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false
      });
    }

    // failedLoginCount — brute-force / lockout counter
    if (!tableDesc.failedLoginCount) {
      await queryInterface.addColumn('Users', 'failedLoginCount', {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 0
      });
    }

    // lockedUntil — timestamp after which the account is unlocked
    if (!tableDesc.lockedUntil) {
      await queryInterface.addColumn('Users', 'lockedUntil', {
        type: Sequelize.DATE,
        allowNull: true,
        defaultValue: null
      });
    }

    // backupCodes — JSON array of hashed one-time recovery codes
    if (!tableDesc.backupCodes) {
      await queryInterface.addColumn('Users', 'backupCodes', {
        type: Sequelize.TEXT,
        allowNull: true,
        defaultValue: null,
        comment: 'JSON array of bcrypt-hashed one-time 2FA recovery codes'
      });
    }

    // tokenVersion — incremented on password change to invalidate old JWTs
    if (!tableDesc.tokenVersion) {
      await queryInterface.addColumn('Users', 'tokenVersion', {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 0
      });
    }
  },

  async down(queryInterface) {
    const tableDesc = await queryInterface.describeTable('Users');
    const cols = ['twoFactorSecret','twoFactorEnabled','failedLoginCount','lockedUntil','backupCodes','tokenVersion'];
    for (const col of cols) {
      if (tableDesc[col]) {
        await queryInterface.removeColumn('Users', col);
      }
    }
  }
};
