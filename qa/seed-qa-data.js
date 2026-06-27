const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const {
  readConfig,
  ensureQaDirectories,
  assertQaDatabase,
  applyRuntimeEnv
} = require('./lib/qa-env');
const { ensureDatabase } = require('./lib/postgres');

async function upsertOne(model, where, values) {
  const existing = await model.findOne({ where });
  if (existing) {
    await existing.update(values);
    return existing;
  }
  return model.create({ ...where, ...values });
}

async function main() {
  const config = readConfig();
  ensureQaDirectories(config);
  assertQaDatabase(config);
  applyRuntimeEnv(config);
  const appendMode = process.env.QA_SEED_APPEND === 'true';
  const batchId = (process.env.QA_SEED_BATCH_ID || new Date().toISOString())
    .replace(/[^0-9A-Za-z]+/g, '')
    .slice(0, 18);
  const nameFor = baseName => appendMode ? `${baseName} ${batchId}` : baseName;
  const patientLastName = appendMode ? `Patient ${batchId}` : 'Patient';

  const dbStatus = await ensureDatabase(config);
  if (dbStatus.created) console.log(`Created QA database: ${config.dbName}`);

  const db = require('../models');
  const { BUILT_IN_DEFAULTS } = require('../middleware/rbac');

  await db.sequelize.authenticate();
  await db.sequelize.sync();

  const adminRole = await upsertOne(
    db.Role,
    { name: 'Administrator' },
    {
      description: 'QA administrator role',
      isSystem: true,
      permissions: BUILT_IN_DEFAULTS.Administrator()
    }
  );

  for (const roleName of ['Supervisor', 'Operator', 'Read Only']) {
    await upsertOne(
      db.Role,
      { name: roleName },
      {
        description: `QA ${roleName} role`,
        isSystem: true,
        permissions: BUILT_IN_DEFAULTS[roleName]()
      }
    );
  }

  const passwordHash = await bcrypt.hash(config.loginPassword, 10);
  const admin = await upsertOne(
    db.User,
    { username: config.loginUsername },
    {
      firstName: 'QA',
      lastName: 'Administrator',
      email: 'qa-admin@rxsystem.local',
      passwordHash,
      roleId: adminRole.id,
      isActive: true,
      isMaster: false,
      tokenVersion: 0,
      failedLoginCount: 0,
      lockedUntil: null,
      twoFactorEnabled: false,
      twoFactorSecret: null,
      backupCodes: null,
      notes: 'QA smoke-test user. Password is controlled by qa/.env.qa.'
    }
  );

  const pharmacy = await upsertOne(db.Pharmacy, { name: nameFor('QA Pharmacy') }, {
    address: '100 QA Pharmacy Ave',
    phone: '555-0100',
    contactPerson: 'QA Pharmacist',
    notes: 'QA smoke-test pharmacy',
    isActive: true
  });

  const clinic = await upsertOne(db.Clinic, { name: nameFor('QA Clinic') }, {
    address: '200 QA Clinic St',
    phone: '555-0200',
    contactPerson: 'QA Clinic Lead',
    notes: 'QA smoke-test clinic',
    isActive: true
  });

  const patientTransport = await upsertOne(db.PatientTransportCompany, { companyName: nameFor('QA Patient Transport') }, {
    phone: '555-0300',
    contactPerson: 'QA Patient Driver',
    notes: 'QA smoke-test patient transport',
    isActive: true
  });

  const pharmacyTransport = await upsertOne(db.PharmacyTransportCompany, { companyName: nameFor('QA Pharmacy Transport') }, {
    phone: '555-0400',
    contactPerson: 'QA Pharmacy Driver',
    notes: 'QA smoke-test pharmacy transport',
    isActive: true
  });

  const medicationCatalog = await upsertOne(db.MedicationCatalog, { name: nameFor('QA Medication Action') }, {
    description: 'QA smoke-test catalog item',
    sortOrder: 10,
    isActive: true
  });

  const workflow1 = await upsertOne(db.WorkflowAction, { name: nameFor('QA Received Warehouse') }, {
    description: 'QA smoke-test workflow step 1',
    sequenceNumber: 1,
    isActive: true
  });

  const workflow2 = await upsertOne(db.WorkflowAction, { name: nameFor('QA Out for Delivery') }, {
    description: 'QA smoke-test workflow step 2',
    sequenceNumber: 2,
    isActive: true
  });

  const patient = await upsertOne(db.Patient, { firstName: 'QA', lastName: patientLastName }, {
    dob: '1980-01-01',
    address: '300 QA Patient Rd',
    phone: '555-0500',
    serviceDate: '2026-06-24',
    patientTransportCompanyId: patientTransport.id,
    pharmacyTransportCompanyId: pharmacyTransport.id,
    clinicId: clinic.id,
    pharmacyId: pharmacy.id,
    notes: 'QA smoke-test patient',
    isActive: true,
    isDeleted: false,
    patientCode: appendMode ? `QA-${batchId}` : 'QA-001',
    isNonCompanyPatient: false
  });

  let note = await db.PatientNote.findOne({
    where: { patientId: patient.id, note: appendMode ? `QA smoke-test note ${batchId}` : 'QA smoke-test note' }
  });
  if (!note) {
    note = await db.PatientNote.create({
      patientId: patient.id,
      userId: admin.id,
      note: appendMode ? `QA smoke-test note ${batchId}` : 'QA smoke-test note'
    });
  }

  const rx = await upsertOne(db.RXRecord, { patientId: patient.id, serviceDate: '2026-06-24' }, {
    arrivalDate: '2026-06-24',
    pharmacyId: pharmacy.id,
    patientTransportCompanyId: patientTransport.id,
    pharmacyTransportCompanyId: pharmacyTransport.id,
    isDeleted: false,
    returnedToWarehouse: false,
    warehouseReturnDate: null,
    warehouseReturnNote: null
  });

  await upsertOne(db.Medication, { rxRecordId: rx.id, name: medicationCatalog.name }, {
    quantity: 1,
    notes: 'QA smoke-test medication'
  });

  await upsertOne(db.RXWorkflowTracking, { rxRecordId: rx.id, workflowActionId: workflow1.id }, {
    completionDate: new Date('2026-06-24T10:00:00Z'),
    userId: admin.id
  });

  await upsertOne(db.RXWorkflowTracking, { rxRecordId: rx.id, workflowActionId: workflow2.id }, {
    completionDate: new Date('2026-06-24T11:00:00Z'),
    userId: admin.id
  });

  await upsertOne(db.RXHistory, { rxRecordId: rx.id, changeType: 'Workflow', note: 'QA seed workflow step' }, {
    userId: admin.id,
    snapshot: JSON.stringify({ patientId: patient.id, serviceDate: rx.serviceDate }),
    changedFields: JSON.stringify([{ field: 'workflowActionId', from: null, to: workflow2.id }])
  });

  const summary = {
    mode: appendMode ? 'append' : 'baseline',
    batchId: appendMode ? batchId : null,
    database: config.dbName,
    baseURL: config.baseURL,
    loginUsername: config.loginUsername,
    seeded: {
      adminUserId: admin.id,
      pharmacyId: pharmacy.id,
      clinicId: clinic.id,
      patientTransportId: patientTransport.id,
      pharmacyTransportId: pharmacyTransport.id,
      medicationCatalogId: medicationCatalog.id,
      workflowActionIds: [workflow1.id, workflow2.id],
      patientId: patient.id,
      patientNoteId: note.id,
      rxRecordId: rx.id
    }
  };

  const resultPath = path.join(config.resultsDir, 'seed-result.json');
  fs.writeFileSync(resultPath, JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));

  await db.sequelize.close();
}

main().catch(err => {
  console.error('[QA seed failed]', err.stack || err.message);
  process.exit(1);
});
