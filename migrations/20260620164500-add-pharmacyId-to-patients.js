'use strict';
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('Patients', 'pharmacyId', {
      type: Sequelize.INTEGER,
      allowNull: true,
      references: { model: 'Pharmacies', key: 'id' },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL'
    });
  },
  async down(queryInterface) {
    await queryInterface.removeColumn('Patients', 'pharmacyId');
  }
};
