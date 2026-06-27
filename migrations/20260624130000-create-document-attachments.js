'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('DocumentAttachments', {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.INTEGER
      },
      ownerType: {
        allowNull: false,
        type: Sequelize.STRING
      },
      patientId: {
        allowNull: true,
        type: Sequelize.INTEGER,
        references: { model: 'Patients', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL'
      },
      rxRecordId: {
        allowNull: true,
        type: Sequelize.INTEGER,
        references: { model: 'RXRecords', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL'
      },
      originalName: {
        allowNull: false,
        type: Sequelize.STRING
      },
      storedName: {
        allowNull: false,
        type: Sequelize.STRING
      },
      mimeType: {
        allowNull: true,
        type: Sequelize.STRING
      },
      sizeBytes: {
        allowNull: false,
        defaultValue: 0,
        type: Sequelize.BIGINT
      },
      provider: {
        allowNull: false,
        defaultValue: 'local',
        type: Sequelize.STRING
      },
      driveFileId: {
        allowNull: true,
        type: Sequelize.STRING
      },
      driveWebViewLink: {
        allowNull: true,
        type: Sequelize.TEXT
      },
      localPath: {
        allowNull: true,
        type: Sequelize.TEXT
      },
      uploadedByUserId: {
        allowNull: true,
        type: Sequelize.INTEGER,
        references: { model: 'Users', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL'
      },
      isDeleted: {
        allowNull: false,
        defaultValue: false,
        type: Sequelize.BOOLEAN
      },
      deletedAt: {
        allowNull: true,
        type: Sequelize.DATE
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

    await queryInterface.addIndex('DocumentAttachments', ['patientId']);
    await queryInterface.addIndex('DocumentAttachments', ['rxRecordId']);
    await queryInterface.addIndex('DocumentAttachments', ['provider']);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('DocumentAttachments');
  }
};
