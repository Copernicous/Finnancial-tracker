'use strict';
/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('RXRecords', {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.INTEGER
      },
      patientId: {
        type: Sequelize.INTEGER
      },
      arrivalDate: {
        type: Sequelize.DATEONLY
      },
      serviceDate: {
        type: Sequelize.DATEONLY
      },
      pharmacyId: {
        type: Sequelize.INTEGER
      },
      patientTransportCompanyId: {
        type: Sequelize.INTEGER
      },
      pharmacyTransportCompanyId: {
        type: Sequelize.INTEGER
      },
      createdAt: {
        allowNull: false,
        type: Sequelize.DATE
      },
      updatedAt: {
        allowNull: false,
        type: Sequelize.DATE
      }
    });
  },
  async down(queryInterface, Sequelize) {
    await queryInterface.dropTable('RXRecords');
  }
};