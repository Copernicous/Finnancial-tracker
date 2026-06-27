'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    // 1. Add patientCode column as nullable initially
    await queryInterface.addColumn('Patients', 'patientCode', {
      type: Sequelize.STRING,
      allowNull: true,
      unique: true
    });

    // 2. Select existing patients and backfill patientCode sequentially (e.g. PAT-00001, PAT-00002)
    const [patients] = await queryInterface.sequelize.query(
      'SELECT id FROM "Patients" ORDER BY id ASC;'
    );

    if (patients && patients.length > 0) {
      for (let i = 0; i < patients.length; i++) {
        const patientId = patients[i].id;
        const code = 'PAT-' + String(i + 1).padStart(5, '0');
        await queryInterface.sequelize.query(
          `UPDATE "Patients" SET "patientCode" = '${code}' WHERE id = ${patientId};`
        );
      }
    }

    // 3. Alter the column to disallow nulls now that backfill is complete
    await queryInterface.changeColumn('Patients', 'patientCode', {
      type: Sequelize.STRING,
      allowNull: false,
      unique: true
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.removeColumn('Patients', 'patientCode');
  }
};
