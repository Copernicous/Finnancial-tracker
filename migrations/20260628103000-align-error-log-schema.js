'use strict';

async function addColumnIfMissing(queryInterface, table, column, spec) {
  const definition = await queryInterface.describeTable(table);
  if (!definition[column]) await queryInterface.addColumn(table, column, spec);
}

module.exports = {
  async up(queryInterface, Sequelize) {
    await addColumnIfMissing(queryInterface, 'ErrorLogs', 'source', {
      type: Sequelize.STRING,
      allowNull: false,
      defaultValue: 'frontend'
    });
    await addColumnIfMissing(queryInterface, 'ErrorLogs', 'userAgent', { type: Sequelize.TEXT });
    await addColumnIfMissing(queryInterface, 'ErrorLogs', 'resolvedAt', { type: Sequelize.DATE });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('ErrorLogs', 'userAgent').catch(() => {});
    await queryInterface.removeColumn('ErrorLogs', 'source').catch(() => {});
  }
};
