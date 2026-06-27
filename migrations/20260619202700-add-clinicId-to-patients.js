'use strict';
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('Patients', 'clinicId', {
      type: Sequelize.INTEGER,
      allowNull: true,
      references: { model: 'Clinics', key: 'id' },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL'
    });
  },
  async down(queryInterface) {
    await queryInterface.removeColumn('Patients', 'clinicId');
  }
};
