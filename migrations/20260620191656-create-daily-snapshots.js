'use strict';
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('DailySnapshots', {
      id:                        { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
      snapshotDate:              { type: Sequelize.DATEONLY, allowNull: false, unique: true },

      // ── Patients ──────────────────────────────────────────────────────
      totalPatients:             { type: Sequelize.INTEGER, defaultValue: 0 },
      activePatients:            { type: Sequelize.INTEGER, defaultValue: 0 },
      inactivePatients:          { type: Sequelize.INTEGER, defaultValue: 0 },
      newPatientsToday:          { type: Sequelize.INTEGER, defaultValue: 0 },
      nonCompanyPatients:        { type: Sequelize.INTEGER, defaultValue: 0 },

      // ── RX Records ────────────────────────────────────────────────────
      totalRX:                   { type: Sequelize.INTEGER, defaultValue: 0 },
      newRXToday:                { type: Sequelize.INTEGER, defaultValue: 0 },
      pendingRX:                 { type: Sequelize.INTEGER, defaultValue: 0 },
      completedRX:               { type: Sequelize.INTEGER, defaultValue: 0 },
      deletedRX:                 { type: Sequelize.INTEGER, defaultValue: 0 },
      returnedToWarehouseRX:     { type: Sequelize.INTEGER, defaultValue: 0 },

      // ── Workflow ──────────────────────────────────────────────────────
      totalWorkflowSteps:        { type: Sequelize.INTEGER, defaultValue: 0 },
      completedWorkflowSteps:    { type: Sequelize.INTEGER, defaultValue: 0 },
      workflowStepsToday:        { type: Sequelize.INTEGER, defaultValue: 0 },
      workflowCompletionRate:    { type: Sequelize.FLOAT,   defaultValue: 0 },

      // ── Users & Activity ──────────────────────────────────────────────
      totalUsers:                { type: Sequelize.INTEGER, defaultValue: 0 },
      activeUsers:               { type: Sequelize.INTEGER, defaultValue: 0 },
      auditEventsToday:          { type: Sequelize.INTEGER, defaultValue: 0 },
      errorLogsToday:            { type: Sequelize.INTEGER, defaultValue: 0 },
      unresolvedErrors:          { type: Sequelize.INTEGER, defaultValue: 0 },

      // ── Lookup tables ─────────────────────────────────────────────────
      totalPharmacies:           { type: Sequelize.INTEGER, defaultValue: 0 },
      totalClinics:              { type: Sequelize.INTEGER, defaultValue: 0 },
      totalTransportCompanies:   { type: Sequelize.INTEGER, defaultValue: 0 },

      createdAt:                 { type: Sequelize.DATE, allowNull: false },
      updatedAt:                 { type: Sequelize.DATE, allowNull: false },
    });

    await queryInterface.addIndex('DailySnapshots', ['snapshotDate'], { unique: true, name: 'daily_snapshots_date_unique' });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('DailySnapshots');
  }
};
