'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// Migration: Add performance indexes following the Patient → RXRecord chain
//
// Query path this covers:
//   Patients (list/search) → RXRecords (by patient) → Medications
//                                                    → RXWorkflowTracking
//                                                    → RXHistory
//   Users (login lookup)
//   AuditLogs (admin queries)
// ─────────────────────────────────────────────────────────────────────────────

module.exports = {
  async up(queryInterface, Sequelize) {

    // ── PATIENTS (the root) ──────────────────────────────────────────────────

    // Every patient list filters isDeleted first
    await queryInterface.addIndex('Patients', ['isDeleted'], {
      name: 'idx_patients_isDeleted'
    });

    // Patient search by name
    await queryInterface.addIndex('Patients', ['lastName', 'firstName'], {
      name: 'idx_patients_name'
    });

    // FK lookups: clinic, pharmacy, transport companies
    await queryInterface.addIndex('Patients', ['clinicId'], {
      name: 'idx_patients_clinicId'
    });
    await queryInterface.addIndex('Patients', ['pharmacyId'], {
      name: 'idx_patients_pharmacyId'
    });
    await queryInterface.addIndex('Patients', ['patientTransportCompanyId'], {
      name: 'idx_patients_patientTransportCompanyId'
    });
    await queryInterface.addIndex('Patients', ['pharmacyTransportCompanyId'], {
      name: 'idx_patients_pharmacyTransportCompanyId'
    });

    // isActive filter (soft-disable patients)
    await queryInterface.addIndex('Patients', ['isActive'], {
      name: 'idx_patients_isActive'
    });

    // ── RXRECORDS (the branch off every patient) ─────────────────────────────

    // Most critical: load all RX records for a patient
    await queryInterface.addIndex('RXRecords', ['patientId'], {
      name: 'idx_rxrecords_patientId'
    });

    // Every RX list filters isDeleted
    await queryInterface.addIndex('RXRecords', ['isDeleted'], {
      name: 'idx_rxrecords_isDeleted'
    });

    // Combined: almost every RX query is WHERE patientId = X AND isDeleted = false
    await queryInterface.addIndex('RXRecords', ['patientId', 'isDeleted'], {
      name: 'idx_rxrecords_patientId_isDeleted'
    });

    // Date filtering for dashboard stats and date-range searches
    await queryInterface.addIndex('RXRecords', ['arrivalDate'], {
      name: 'idx_rxrecords_arrivalDate'
    });
    await queryInterface.addIndex('RXRecords', ['serviceDate'], {
      name: 'idx_rxrecords_serviceDate'
    });

    // FK lookups
    await queryInterface.addIndex('RXRecords', ['pharmacyId'], {
      name: 'idx_rxrecords_pharmacyId'
    });
    await queryInterface.addIndex('RXRecords', ['patientTransportCompanyId'], {
      name: 'idx_rxrecords_patientTransportCompanyId'
    });
    await queryInterface.addIndex('RXRecords', ['pharmacyTransportCompanyId'], {
      name: 'idx_rxrecords_pharmacyTransportCompanyId'
    });

    // Warehouse return filter
    await queryInterface.addIndex('RXRecords', ['returnedToWarehouse'], {
      name: 'idx_rxrecords_returnedToWarehouse'
    });

    // ── CHILD TABLES of RXRecords ─────────────────────────────────────────────

    // Medications loaded for every RX record detail view
    await queryInterface.addIndex('Medications', ['rxRecordId'], {
      name: 'idx_medications_rxRecordId'
    });

    // Workflow steps loaded for every RX record
    await queryInterface.addIndex('RXWorkflowTrackings', ['rxRecordId'], {
      name: 'idx_rxworkflow_rxRecordId'
    });
    await queryInterface.addIndex('RXWorkflowTrackings', ['workflowActionId'], {
      name: 'idx_rxworkflow_workflowActionId'
    });

    // RX change history
    await queryInterface.addIndex('RXHistories', ['rxRecordId'], {
      name: 'idx_rxhistory_rxRecordId'
    });

    // ── USERS (login + permission checks on every request) ───────────────────

    // Login lookup — every auth check does WHERE username = ?
    // Also enforces uniqueness as a constraint
    await queryInterface.addIndex('Users', ['username'], {
      name:   'idx_users_username',
      unique: true
    });

    // Role lookup
    await queryInterface.addIndex('Users', ['roleId'], {
      name: 'idx_users_roleId'
    });

    // isActive check on login
    await queryInterface.addIndex('Users', ['isActive'], {
      name: 'idx_users_isActive'
    });

    // ── PATIENT CHILD TABLES ─────────────────────────────────────────────────

    await queryInterface.addIndex('PatientNotes', ['patientId'], {
      name: 'idx_patientnotes_patientId'
    });

    // ── AUDIT + ERROR LOGS ───────────────────────────────────────────────────

    await queryInterface.addIndex('AuditLogs', ['userId'], {
      name: 'idx_auditlogs_userId'
    });
    await queryInterface.addIndex('AuditLogs', ['createdAt'], {
      name: 'idx_auditlogs_createdAt'
    });

    await queryInterface.addIndex('ErrorLogs', ['resolved'], {
      name: 'idx_errorlogs_resolved'
    });

  },

  async down(queryInterface, Sequelize) {
    const indexes = [
      ['Patients',             'idx_patients_isDeleted'],
      ['Patients',             'idx_patients_name'],
      ['Patients',             'idx_patients_clinicId'],
      ['Patients',             'idx_patients_pharmacyId'],
      ['Patients',             'idx_patients_patientTransportCompanyId'],
      ['Patients',             'idx_patients_pharmacyTransportCompanyId'],
      ['Patients',             'idx_patients_isActive'],
      ['RXRecords',            'idx_rxrecords_patientId'],
      ['RXRecords',            'idx_rxrecords_isDeleted'],
      ['RXRecords',            'idx_rxrecords_patientId_isDeleted'],
      ['RXRecords',            'idx_rxrecords_arrivalDate'],
      ['RXRecords',            'idx_rxrecords_serviceDate'],
      ['RXRecords',            'idx_rxrecords_pharmacyId'],
      ['RXRecords',            'idx_rxrecords_patientTransportCompanyId'],
      ['RXRecords',            'idx_rxrecords_pharmacyTransportCompanyId'],
      ['RXRecords',            'idx_rxrecords_returnedToWarehouse'],
      ['Medications',          'idx_medications_rxRecordId'],
      ['RXWorkflowTrackings',  'idx_rxworkflow_rxRecordId'],
      ['RXWorkflowTrackings',  'idx_rxworkflow_workflowActionId'],
      ['RXHistories',          'idx_rxhistory_rxRecordId'],
      ['Users',                'idx_users_username'],
      ['Users',                'idx_users_roleId'],
      ['Users',                'idx_users_isActive'],
      ['PatientNotes',         'idx_patientnotes_patientId'],
      ['AuditLogs',            'idx_auditlogs_userId'],
      ['AuditLogs',            'idx_auditlogs_createdAt'],
      ['ErrorLogs',            'idx_errorlogs_resolved'],
    ];
    for (const [table, name] of indexes) {
      await queryInterface.removeIndex(table, name).catch(() => {});
    }
  }
};
