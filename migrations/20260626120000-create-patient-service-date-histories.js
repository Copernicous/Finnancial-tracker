'use strict';

async function hasTable(queryInterface, tableName) {
  const tables = await queryInterface.showAllTables();
  return tables.some((entry) => {
    if (typeof entry === 'string') return entry === tableName;
    return entry.tableName === tableName || entry.table_name === tableName || entry.name === tableName;
  });
}

async function addIndexIfMissing(queryInterface, tableName, fields, options) {
  const indexes = await queryInterface.showIndex(tableName).catch(() => []);
  if (!indexes.some((index) => index.name === options.name)) {
    await queryInterface.addIndex(tableName, fields, options);
  }
}

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    if (!await hasTable(queryInterface, 'PatientServiceDateHistories')) {
      await queryInterface.createTable('PatientServiceDateHistories', {
        id: {
          allowNull: false,
          autoIncrement: true,
          primaryKey: true,
          type: Sequelize.INTEGER
        },
        patientId: {
          allowNull: false,
          type: Sequelize.INTEGER,
          references: {
            model: 'Patients',
            key: 'id'
          },
          onUpdate: 'CASCADE',
          onDelete: 'CASCADE'
        },
        previousServiceDate: {
          allowNull: true,
          type: Sequelize.DATEONLY
        },
        newServiceDate: {
          allowNull: true,
          type: Sequelize.DATEONLY
        },
        changedByUserId: {
          allowNull: true,
          type: Sequelize.INTEGER,
          references: {
            model: 'Users',
            key: 'id'
          },
          onUpdate: 'CASCADE',
          onDelete: 'SET NULL'
        },
        changeSource: {
          allowNull: false,
          type: Sequelize.STRING(60),
          defaultValue: 'Patient Update'
        },
        reason: {
          allowNull: true,
          type: Sequelize.TEXT
        },
        metadata: {
          allowNull: true,
          type: Sequelize.JSON
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
    }

    await addIndexIfMissing(queryInterface, 'PatientServiceDateHistories', ['patientId'], {
      name: 'idx_patient_service_date_histories_patient'
    });
    await addIndexIfMissing(queryInterface, 'PatientServiceDateHistories', ['patientId', 'createdAt'], {
      name: 'idx_patient_service_date_histories_patient_created'
    });
    await addIndexIfMissing(queryInterface, 'PatientServiceDateHistories', ['newServiceDate'], {
      name: 'idx_patient_service_date_histories_new_date'
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('PatientServiceDateHistories');
  }
};
