'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('Merchants', {
      id: { allowNull: false, autoIncrement: true, primaryKey: true, type: Sequelize.INTEGER },
      officialName: { type: Sequelize.STRING, allowNull: false },
      normalizedName: { type: Sequelize.STRING, allowNull: false, unique: true },
      merchantType: { type: Sequelize.STRING },
      website: { type: Sequelize.STRING },
      defaultCategoryId: {
        type: Sequelize.INTEGER,
        references: { model: 'Categories', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL'
      },
      defaultTransactionType: { type: Sequelize.STRING },
      notes: { type: Sequelize.TEXT },
      isActive: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
      lastSeenAt: { type: Sequelize.DATE },
      createdAt: { allowNull: false, type: Sequelize.DATE },
      updatedAt: { allowNull: false, type: Sequelize.DATE }
    });

    await queryInterface.createTable('MerchantAliases', {
      id: { allowNull: false, autoIncrement: true, primaryKey: true, type: Sequelize.INTEGER },
      merchantId: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'Merchants', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE'
      },
      aliasText: { type: Sequelize.STRING, allowNull: false },
      normalizedAlias: { type: Sequelize.STRING, allowNull: false },
      matchType: { type: Sequelize.STRING, allowNull: false, defaultValue: 'contains' },
      priority: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 50 },
      source: { type: Sequelize.STRING, allowNull: false, defaultValue: 'manual' },
      notes: { type: Sequelize.TEXT },
      isActive: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
      createdAt: { allowNull: false, type: Sequelize.DATE },
      updatedAt: { allowNull: false, type: Sequelize.DATE }
    });

    await queryInterface.addIndex('MerchantAliases', ['normalizedAlias', 'matchType']);
    await queryInterface.addIndex('MerchantAliases', ['merchantId']);

    await queryInterface.addColumn('Transactions', 'merchantId', {
      type: Sequelize.INTEGER,
      references: { model: 'Merchants', key: 'id' },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL'
    });
    await queryInterface.addColumn('Transactions', 'receiptMerchant', { type: Sequelize.STRING });
    await queryInterface.addColumn('Transactions', 'merchantMatchConfidence', { type: Sequelize.DECIMAL(5, 4) });
    await queryInterface.addColumn('Transactions', 'merchantMatchSource', { type: Sequelize.STRING });
    await queryInterface.addIndex('Transactions', ['merchantId']);
    await queryInterface.addIndex('Transactions', ['normalizedMerchant']);
  },

  async down(queryInterface) {
    await queryInterface.removeIndex('Transactions', ['normalizedMerchant']).catch(() => {});
    await queryInterface.removeIndex('Transactions', ['merchantId']).catch(() => {});
    await queryInterface.removeColumn('Transactions', 'merchantMatchSource');
    await queryInterface.removeColumn('Transactions', 'merchantMatchConfidence');
    await queryInterface.removeColumn('Transactions', 'receiptMerchant');
    await queryInterface.removeColumn('Transactions', 'merchantId');
    await queryInterface.dropTable('MerchantAliases');
    await queryInterface.dropTable('Merchants');
  }
};
