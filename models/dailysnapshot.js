'use strict';
const { Model } = require('sequelize');
module.exports = (sequelize, DataTypes) => {
  class DailySnapshot extends Model {
    static associate() { /* standalone — no FK associations */ }
  }
  DailySnapshot.init({
    snapshotDate:            { type: DataTypes.DATEONLY,  allowNull: false, unique: true },
    // Patients
    totalPatients:           { type: DataTypes.INTEGER,  defaultValue: 0 },
    activePatients:          { type: DataTypes.INTEGER,  defaultValue: 0 },
    inactivePatients:        { type: DataTypes.INTEGER,  defaultValue: 0 },
    newPatientsToday:        { type: DataTypes.INTEGER,  defaultValue: 0 },
    nonCompanyPatients:      { type: DataTypes.INTEGER,  defaultValue: 0 },
    // RX Records
    totalRX:                 { type: DataTypes.INTEGER,  defaultValue: 0 },
    newRXToday:              { type: DataTypes.INTEGER,  defaultValue: 0 },
    pendingRX:               { type: DataTypes.INTEGER,  defaultValue: 0 },
    completedRX:             { type: DataTypes.INTEGER,  defaultValue: 0 },
    deletedRX:               { type: DataTypes.INTEGER,  defaultValue: 0 },
    returnedToWarehouseRX:   { type: DataTypes.INTEGER,  defaultValue: 0 },
    // Workflow
    totalWorkflowSteps:      { type: DataTypes.INTEGER,  defaultValue: 0 },
    completedWorkflowSteps:  { type: DataTypes.INTEGER,  defaultValue: 0 },
    workflowStepsToday:      { type: DataTypes.INTEGER,  defaultValue: 0 },
    workflowCompletionRate:  { type: DataTypes.FLOAT,    defaultValue: 0 },
    // Users & Activity
    totalUsers:              { type: DataTypes.INTEGER,  defaultValue: 0 },
    activeUsers:             { type: DataTypes.INTEGER,  defaultValue: 0 },
    auditEventsToday:        { type: DataTypes.INTEGER,  defaultValue: 0 },
    errorLogsToday:          { type: DataTypes.INTEGER,  defaultValue: 0 },
    unresolvedErrors:        { type: DataTypes.INTEGER,  defaultValue: 0 },
    // Lookup
    totalPharmacies:         { type: DataTypes.INTEGER,  defaultValue: 0 },
    totalClinics:            { type: DataTypes.INTEGER,  defaultValue: 0 },
    totalTransportCompanies: { type: DataTypes.INTEGER,  defaultValue: 0 },
  }, {
    sequelize,
    modelName: 'DailySnapshot',
  });
  return DailySnapshot;
};
