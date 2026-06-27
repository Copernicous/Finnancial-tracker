'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('UserActivityLogs', {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.INTEGER
      },
      userId: {
        allowNull: true,
        type: Sequelize.INTEGER,
        references: { model: 'Users', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL'
      },
      usernameSnapshot: {
        allowNull: true,
        type: Sequelize.STRING
      },
      roleSnapshot: {
        allowNull: true,
        type: Sequelize.STRING
      },
      pageUrl: {
        allowNull: true,
        type: Sequelize.TEXT
      },
      pagePath: {
        allowNull: true,
        type: Sequelize.STRING
      },
      pageTitle: {
        allowNull: true,
        type: Sequelize.STRING
      },
      visitedAt: {
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
        type: Sequelize.DATE
      },
      ipAddress: {
        allowNull: true,
        type: Sequelize.STRING
      },
      userAgent: {
        allowNull: true,
        type: Sequelize.TEXT
      },
      referrer: {
        allowNull: true,
        type: Sequelize.TEXT
      },
      statusCode: {
        allowNull: true,
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

    await queryInterface.addIndex('UserActivityLogs', ['userId']);
    await queryInterface.addIndex('UserActivityLogs', ['visitedAt']);
    await queryInterface.addIndex('UserActivityLogs', ['pagePath']);
    await queryInterface.addIndex('UserActivityLogs', ['statusCode']);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('UserActivityLogs');
  }
};
