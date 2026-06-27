'use strict';
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('Patients', 'isNonCompanyPatient', {
      type: Sequelize.BOOLEAN,
      allowNull: false,
      defaultValue: false
    });
  },
  async down(queryInterface) {
    await queryInterface.removeColumn('Patients', 'isNonCompanyPatient');
  }
};
