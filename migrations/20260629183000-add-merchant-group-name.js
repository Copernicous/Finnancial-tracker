'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    const table = await queryInterface.describeTable('Merchants');
    if (!table.merchantGroupName) {
      await queryInterface.addColumn('Merchants', 'merchantGroupName', {
        type: Sequelize.STRING,
        allowNull: true
      });
    }
    await queryInterface.addIndex('Merchants', ['merchantGroupName'], {
      name: 'merchants_merchant_group_name_idx'
    }).catch(() => {});
  },

  async down(queryInterface) {
    await queryInterface.removeIndex('Merchants', 'merchants_merchant_group_name_idx').catch(() => {});
    const table = await queryInterface.describeTable('Merchants');
    if (table.merchantGroupName) {
      await queryInterface.removeColumn('Merchants', 'merchantGroupName');
    }
  }
};
