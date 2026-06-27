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
    if (!await hasTable(queryInterface, 'PatientServiceDateCycles')) {
      await queryInterface.createTable('PatientServiceDateCycles', {
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
        serviceDate: {
          allowNull: false,
          type: Sequelize.DATEONLY
        },
        status: {
          allowNull: false,
          type: Sequelize.STRING(20),
          defaultValue: 'historical'
        },
        source: {
          allowNull: false,
          type: Sequelize.STRING(60),
          defaultValue: 'Patient Service Date'
        },
        startedAt: {
          allowNull: true,
          type: Sequelize.DATE
        },
        endedAt: {
          allowNull: true,
          type: Sequelize.DATE
        },
        createdByUserId: {
          allowNull: true,
          type: Sequelize.INTEGER,
          references: {
            model: 'Users',
            key: 'id'
          },
          onUpdate: 'CASCADE',
          onDelete: 'SET NULL'
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

    await addIndexIfMissing(queryInterface, 'PatientServiceDateCycles', ['patientId'], {
      name: 'idx_patient_service_date_cycles_patient'
    });
    await addIndexIfMissing(queryInterface, 'PatientServiceDateCycles', ['patientId', 'status'], {
      name: 'idx_patient_service_date_cycles_status'
    });
    await addIndexIfMissing(queryInterface, 'PatientServiceDateCycles', ['patientId', 'serviceDate'], {
      unique: true,
      name: 'uq_patient_service_date_cycles_patient_date'
    });

    const rxColumns = await queryInterface.describeTable('RXRecords');
    if (!rxColumns.patientServiceDateCycleId) {
      await queryInterface.addColumn('RXRecords', 'patientServiceDateCycleId', {
        allowNull: true,
        type: Sequelize.INTEGER,
        references: {
          model: 'PatientServiceDateCycles',
          key: 'id'
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL'
      });
    }
    await addIndexIfMissing(queryInterface, 'RXRecords', ['patientServiceDateCycleId'], {
      name: 'idx_rxrecords_patient_service_date_cycle'
    });

    await queryInterface.sequelize.query(`
      INSERT INTO "PatientServiceDateCycles"
        ("patientId", "serviceDate", "status", "source", "startedAt", "endedAt", "metadata", "createdAt", "updatedAt")
      SELECT
        x."patientId",
        x."serviceDate",
        CASE WHEN p."serviceDate" = x."serviceDate" THEN 'active' ELSE 'historical' END,
        'Migration Backfill',
        x."serviceDate"::timestamp with time zone,
        CASE WHEN p."serviceDate" = x."serviceDate" THEN NULL ELSE (x."serviceDate"::timestamp with time zone + INTERVAL '90 days') END,
        '{"backfilled":true}'::json,
        NOW(),
        NOW()
      FROM (
        SELECT "id" AS "patientId", "serviceDate" FROM "Patients" WHERE "serviceDate" IS NOT NULL
        UNION
        SELECT "patientId", "serviceDate" FROM "RXRecords" WHERE "patientId" IS NOT NULL AND "serviceDate" IS NOT NULL
      ) x
      JOIN "Patients" p ON p."id" = x."patientId"
      ON CONFLICT ("patientId", "serviceDate") DO NOTHING;
    `);

    await queryInterface.sequelize.query(`
      UPDATE "RXRecords" r
      SET "patientServiceDateCycleId" = c."id"
      FROM "PatientServiceDateCycles" c
      WHERE r."patientId" = c."patientId"
        AND r."serviceDate" = c."serviceDate"
        AND r."patientServiceDateCycleId" IS NULL;
    `);
  },

  async down(queryInterface) {
    await queryInterface.removeIndex('RXRecords', 'idx_rxrecords_patient_service_date_cycle').catch(() => {});
    await queryInterface.removeColumn('RXRecords', 'patientServiceDateCycleId');
    await queryInterface.dropTable('PatientServiceDateCycles');
  }
};
