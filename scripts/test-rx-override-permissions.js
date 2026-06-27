const assert = require('assert');
const {
  readConfig,
  assertQaDatabase,
  applyRuntimeEnv
} = require('../qa/lib/qa-env');

process.env.SERVICE_DATE_OVERRIDE_ENABLED = 'false';

const config = readConfig();
assertQaDatabase(config);
applyRuntimeEnv(config);

const db = require('../models');
const { BUILT_IN_DEFAULTS, userCanOverrideExpired, requirePermission } = require('../middleware/rbac');
const rxController = require('../controllers/rxController');
const patientController = require('../controllers/patientController');

const runId = String(Date.now());
const created = {
  users: [],
  roles: [],
  patients: [],
  rxRecords: [],
  pharmacies: [],
  patientTransports: [],
  pharmacyTransports: [],
  workflowActions: []
};

function logPass(name, detail) {
  console.log('PASS:', name, detail || '');
}

function logScenario(name) {
  console.log('\nSCENARIO:', name);
}

function dateBefore(daysAgo) {
  const today = new Date();
  return new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - daysAgo)).toISOString().slice(0, 10);
}

function addDays(isoDate, days) {
  const date = new Date(isoDate + 'T00:00:00.000Z');
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function buildPermissions(canOverrideExpired, mode = 'write') {
  const perms = mode === 'readonly'
    ? BUILT_IN_DEFAULTS['Read Only']()
    : BUILT_IN_DEFAULTS.Supervisor();
  const canWrite = mode !== 'readonly';
  perms.rx_records = {
    ...(perms.rx_records || {}),
    visible: true,
    canAdd: canWrite,
    canEdit: canWrite,
    canDelete: canWrite,
    canExport: true,
    canUndo: canWrite,
    canWarehouse: canWrite,
    canOverrideExpired
  };
  perms.patients = {
    ...(perms.patients || {}),
    visible: true,
    canAdd: canWrite,
    canEdit: canWrite,
    canDelete: canWrite,
    canExport: true,
    canOverrideExpired
  };
  return perms;
}

function mockReq(user, body, params) {
  return {
    user: {
      id: user.id,
      username: user.username,
      role: user.Role ? user.Role.name : user.roleName
    },
    body: body || {},
    params: params || {},
    headers: { accept: 'application/json' },
    path: '/api/rx-records'
  };
}

function runHandler(handler, req) {
  return new Promise(resolve => {
    const res = {
      statusCode: 200,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(payload) {
        resolve({ status: this.statusCode, payload });
      },
      send(payload) {
        resolve({ status: this.statusCode, payload });
      }
    };
    Promise.resolve(handler(req, res)).catch(error => resolve({ status: 500, payload: { error: error.message } }));
  });
}

function runMiddleware(middleware, req) {
  return new Promise(resolve => {
    const res = {
      statusCode: 200,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(payload) {
        resolve({ ok: false, status: this.statusCode, payload });
      }
    };
    Promise.resolve(middleware(req, res, () => resolve({ ok: true, status: 200 })))
      .catch(error => resolve({ ok: false, status: 500, payload: { error: error.message } }));
  });
}

async function createRoleAndUser(label, canOverrideExpired, mode) {
  const role = await db.Role.create({
    name: `QA Override ${label} ${runId}`,
    description: `Temporary role for RX override scenario ${runId}`,
    isSystem: false,
    permissions: buildPermissions(canOverrideExpired, mode)
  });
  created.roles.push(role);

  const user = await db.User.create({
    firstName: 'QA',
    lastName: `OVERRIDE ${label.toUpperCase()}`,
    username: `qa_override_${label}_${runId}`,
    passwordHash: 'not-used',
    roleId: role.id,
    isActive: true,
    tokenVersion: 0
  });
  created.users.push(user);
  user.Role = role;
  user.roleName = role.name;
  return user;
}

async function ensureWorkflowActions() {
  let actions = await db.WorkflowAction.findAll({
    where: { isActive: true },
    order: [['sequenceNumber', 'ASC'], ['id', 'ASC']]
  });

  let nextSequence = actions.length
    ? Math.max(...actions.map(action => action.sequenceNumber || 0)) + 1
    : 1;

  while (actions.length < 3) {
    const action = await db.WorkflowAction.create({
      name: `QA Override Step ${actions.length + 1} ${runId}`,
      description: `Temporary workflow action for RX override scenario ${runId}`,
      sequenceNumber: nextSequence++,
      isActive: true
    });
    created.workflowActions.push(action);
    actions.push(action);
  }

  return actions.sort((a, b) => a.sequenceNumber - b.sequenceNumber);
}

async function createRxFixture(actions, label, serviceDateOverride) {
  const serviceDate = serviceDateOverride || dateBefore(120);
  const pharmacy = await db.Pharmacy.create({
    name: `QA Override Pharmacy ${label} ${runId}`,
    address: '100 QA Override St',
    phone: '555-9000',
    contactPerson: 'QA Override',
    notes: 'Temporary RX override scenario',
    isActive: true
  });
  created.pharmacies.push(pharmacy);

  const patientTransport = await db.PatientTransportCompany.create({
    companyName: `QA Override Patient Transport ${label} ${runId}`,
    phone: '555-9001',
    contactPerson: 'QA Override',
    notes: 'Temporary RX override scenario',
    isActive: true
  });
  created.patientTransports.push(patientTransport);

  const pharmacyTransport = await db.PharmacyTransportCompany.create({
    companyName: `QA Override Pharmacy Transport ${label} ${runId}`,
    phone: '555-9002',
    contactPerson: 'QA Override',
    notes: 'Temporary RX override scenario',
    isActive: true
  });
  created.pharmacyTransports.push(pharmacyTransport);

  const patient = await db.Patient.create({
    firstName: 'QA',
    lastName: `OVERRIDE ${label.toUpperCase()}`,
    dob: '1980-01-01',
    address: '200 QA Override Rd',
    phone: '555-9003',
    serviceDate,
    patientTransportCompanyId: patientTransport.id,
    pharmacyTransportCompanyId: pharmacyTransport.id,
    pharmacyId: pharmacy.id,
    notes: 'Temporary RX override scenario',
    isActive: true,
    isDeleted: false,
    patientCode: `QA-OVR-${label}-${runId}`.slice(0, 60),
    isNonCompanyPatient: false
  });
  created.patients.push(patient);

  const rx = await db.RXRecord.create({
    patientId: patient.id,
    arrivalDate: serviceDate,
    serviceDate,
    pharmacyId: pharmacy.id,
    patientTransportCompanyId: patientTransport.id,
    pharmacyTransportCompanyId: pharmacyTransport.id,
    isDeleted: false,
    returnedToWarehouse: false
  });
  created.rxRecords.push(rx);

  return { patient, rx, serviceDate, expiryDate: addDays(serviceDate, 90) };
}

async function createPatientFixture(label, serviceDate) {
  const patient = await db.Patient.create({
    firstName: 'QA',
    lastName: `PATIENT ${label.toUpperCase()}`,
    dob: '1980-01-01',
    address: '300 QA Patient Rd',
    phone: '555-9010',
    serviceDate,
    notes: 'Temporary patient override scenario',
    isActive: true,
    isDeleted: false,
    patientCode: `QA-PAT-OVR-${label}-${runId}`.slice(0, 60),
    isNonCompanyPatient: false
  });
  created.patients.push(patient);
  return patient;
}

async function addTracking(rx, action, user, completionDate) {
  return db.RXWorkflowTracking.create({
    rxRecordId: rx.id,
    workflowActionId: action.id,
    completionDate: completionDate + 'T10:00:00.000Z',
    userId: user.id
  });
}

async function completedActionIds(rx) {
  const rows = await db.RXWorkflowTracking.findAll({ where: { rxRecordId: rx.id } });
  return rows.map(row => row.workflowActionId);
}

async function assertUndoRemovedHighestSequence(rx, actions, user, name) {
  const highestAction = actions[actions.length - 1];
  const beforeIds = await completedActionIds(rx);
  assert(beforeIds.includes(highestAction.id), `${name}: highest action must exist before undo`);

  const undoRes = await runHandler(rxController.undoWorkflow, mockReq(user, { rxId: rx.id }));
  assert.strictEqual(undoRes.status, 200, `${name}: undo should succeed`);

  const afterIds = await completedActionIds(rx);
  assert(!afterIds.includes(highestAction.id), `${name}: highest sequence action should be removed`);
  logPass(name, `removed ${highestAction.name}`);
}

async function cleanup() {
  const rxIds = created.rxRecords.map(row => row.id);
  if (rxIds.length) {
    await db.RXWorkflowTracking.destroy({ where: { rxRecordId: rxIds } }).catch(() => {});
    await db.RXHistory.destroy({ where: { rxRecordId: rxIds } }).catch(() => {});
    await db.Medication.destroy({ where: { rxRecordId: rxIds } }).catch(() => {});
    await db.RXRecord.destroy({ where: { id: rxIds } }).catch(() => {});
  }
  const patientIds = created.patients.map(row => row.id);
  if (patientIds.length && db.PatientServiceDateHistory) {
    await db.PatientServiceDateHistory.destroy({ where: { patientId: patientIds } }).catch(() => {});
  }
  if (patientIds.length) await db.Patient.destroy({ where: { id: patientIds } }).catch(() => {});
  if (created.users.length) await db.User.destroy({ where: { id: created.users.map(row => row.id) } }).catch(() => {});
  if (created.roles.length) await db.Role.destroy({ where: { id: created.roles.map(row => row.id) } }).catch(() => {});
  if (created.workflowActions.length) await db.WorkflowAction.destroy({ where: { id: created.workflowActions.map(row => row.id) } }).catch(() => {});
  if (created.pharmacies.length) await db.Pharmacy.destroy({ where: { id: created.pharmacies.map(row => row.id) } }).catch(() => {});
  if (created.patientTransports.length) await db.PatientTransportCompany.destroy({ where: { id: created.patientTransports.map(row => row.id) } }).catch(() => {});
  if (created.pharmacyTransports.length) await db.PharmacyTransportCompany.destroy({ where: { id: created.pharmacyTransports.map(row => row.id) } }).catch(() => {});
}

async function run() {
  await db.sequelize.authenticate();
  await db.sequelize.sync();

  const actions = await ensureWorkflowActions();
  const noOverrideUser = await createRoleAndUser('nooverride', false);
  const overrideUser = await createRoleAndUser('override', true);
  const readOnlyOverrideUser = await createRoleAndUser('readonly-override', true, 'readonly');

  logScenario('permission matrix');
  assert.strictEqual(await userCanOverrideExpired(mockReq(noOverrideUser), 'rx_records'), false);
  assert.strictEqual(await userCanOverrideExpired(mockReq(overrideUser), 'rx_records'), true);
  assert.strictEqual(await userCanOverrideExpired(mockReq(readOnlyOverrideUser), 'rx_records'), true);
  assert.strictEqual((await runMiddleware(requirePermission('rx_records', 'overrideExpired'), mockReq(noOverrideUser))).status, 403);
  assert.strictEqual((await runMiddleware(requirePermission('rx_records', 'overrideExpired'), mockReq(overrideUser))).ok, true);
  assert.strictEqual((await runMiddleware(requirePermission('rx_records', 'write'), mockReq(readOnlyOverrideUser))).status, 403);
  assert.strictEqual((await runMiddleware(requirePermission('rx_records', 'writeOrOverrideExpired'), mockReq(readOnlyOverrideUser))).ok, true);
  assert.strictEqual((await runMiddleware(requirePermission('patients', 'writeOrOverrideExpired'), mockReq(readOnlyOverrideUser))).ok, true);
  logPass('permission override check', 'no-override blocked, override and read-only override allowed');

  logScenario('patient service-date override');
  const activeServiceDate = dateBefore(10);
  const blockedPatient = await createPatientFixture('blocked', activeServiceDate);
  const blockedPatientDate = addDays(activeServiceDate, 1);
  const blockedPatientUpdate = await runHandler(
    patientController.update,
    mockReq(noOverrideUser, { serviceDate: blockedPatientDate }, { id: blockedPatient.id })
  );
  assert.strictEqual(blockedPatientUpdate.status, 400);
  logPass('no override cannot change active patient service date', blockedPatientDate);

  const overrideOnlyPatient = await createPatientFixture('overrideonly', activeServiceDate);
  const overrideOnlyDate = addDays(activeServiceDate, 2);
  const overrideOnlyUpdate = await runHandler(
    patientController.update,
    mockReq(readOnlyOverrideUser, { serviceDate: overrideOnlyDate, firstName: 'SHOULDNOTCHANGE' }, { id: overrideOnlyPatient.id })
  );
  assert.strictEqual(overrideOnlyUpdate.status, 200, overrideOnlyUpdate.payload && overrideOnlyUpdate.payload.error);
  const overrideOnlyReloaded = await db.Patient.findByPk(overrideOnlyPatient.id);
  assert.strictEqual(overrideOnlyReloaded.serviceDate, overrideOnlyDate);
  assert.strictEqual(overrideOnlyReloaded.firstName, 'QA');
  logPass('override-only can change service date only', overrideOnlyDate);

  logScenario('expired workflow date edit');
  const editFixture = await createRxFixture(actions, 'edit');
  const editTracking = await addTracking(editFixture.rx, actions[0], overrideUser, editFixture.serviceDate);
  const blockedDate = addDays(editFixture.expiryDate, 1);
  const noOverrideEdit = await runHandler(
    rxController.updateWorkflowDate,
    mockReq(noOverrideUser, { trackingId: editTracking.id, newDate: blockedDate })
  );
  assert.strictEqual(noOverrideEdit.status, 400);
  assert.strictEqual(noOverrideEdit.payload.code, 'RX_WORKFLOW_DATE_WINDOW_LOCKED');
  logPass('no override cannot edit outside 90-day window', blockedDate);

  const overrideEdit = await runHandler(
    rxController.updateWorkflowDate,
    mockReq(overrideUser, { trackingId: editTracking.id, newDate: blockedDate })
  );
  assert.strictEqual(overrideEdit.status, 200, overrideEdit.payload && overrideEdit.payload.error);
  logPass('override can edit outside 90-day window', blockedDate);

  const readOnlyEditFixture = await createRxFixture(actions, 'edit-readonly');
  const readOnlyEditTracking = await addTracking(readOnlyEditFixture.rx, actions[0], readOnlyOverrideUser, readOnlyEditFixture.serviceDate);
  const readOnlyBlockedDate = addDays(readOnlyEditFixture.expiryDate, 1);
  assert.strictEqual(
    (await runMiddleware(requirePermission('rx_records', 'writeOrOverrideExpired'), mockReq(readOnlyOverrideUser))).ok,
    true
  );
  const readOnlyOverrideEdit = await runHandler(
    rxController.updateWorkflowDate,
    mockReq(readOnlyOverrideUser, { trackingId: readOnlyEditTracking.id, newDate: readOnlyBlockedDate })
  );
  assert.strictEqual(readOnlyOverrideEdit.status, 200, readOnlyOverrideEdit.payload && readOnlyOverrideEdit.payload.error);
  logPass('override-only can edit expired workflow date', readOnlyBlockedDate);

  const activeEditServiceDate = dateBefore(10);
  const activeReadOnlyFixture = await createRxFixture(actions, 'edit-readonly-active', activeEditServiceDate);
  const activeReadOnlyTracking = await addTracking(activeReadOnlyFixture.rx, actions[0], readOnlyOverrideUser, activeEditServiceDate);
  const activeReadOnlyEdit = await runHandler(
    rxController.updateWorkflowDate,
    mockReq(readOnlyOverrideUser, { trackingId: activeReadOnlyTracking.id, newDate: addDays(activeEditServiceDate, 1) })
  );
  assert.strictEqual(activeReadOnlyEdit.status, 403);
  assert.strictEqual(activeReadOnlyEdit.payload.code, 'RX_OVERRIDE_ONLY_ACTIVE_WINDOW');
  logPass('override-only cannot edit active-window workflow date', addDays(activeEditServiceDate, 1));

  logScenario('close expired RX without override, then undo');
  const closeNoOverrideFixture = await createRxFixture(actions, 'close-no');
  await addTracking(closeNoOverrideFixture.rx, actions[0], noOverrideUser, closeNoOverrideFixture.serviceDate);
  const closeNoOverride = await runHandler(
    rxController.closeExpiredWorkflow,
    mockReq(noOverrideUser, {}, { id: closeNoOverrideFixture.rx.id })
  );
  assert.strictEqual(closeNoOverride.status, 200, closeNoOverride.payload && closeNoOverride.payload.error);
  assert.strictEqual((await completedActionIds(closeNoOverrideFixture.rx)).length, actions.length);
  logPass('close expired RX without override', `closed ${closeNoOverride.payload.closedSteps} step(s)`);
  await assertUndoRemovedHighestSequence(closeNoOverrideFixture.rx, actions, noOverrideUser, 'undo after close without override');

  logScenario('close expired RX with override, then undo');
  const closeOverrideFixture = await createRxFixture(actions, 'close-yes');
  await addTracking(closeOverrideFixture.rx, actions[0], overrideUser, closeOverrideFixture.serviceDate);
  const closeOverride = await runHandler(
    rxController.closeExpiredWorkflow,
    mockReq(overrideUser, {}, { id: closeOverrideFixture.rx.id })
  );
  assert.strictEqual(closeOverride.status, 200, closeOverride.payload && closeOverride.payload.error);
  assert.strictEqual((await completedActionIds(closeOverrideFixture.rx)).length, actions.length);
  logPass('close expired RX with override', `closed ${closeOverride.payload.closedSteps} step(s)`);
  await assertUndoRemovedHighestSequence(closeOverrideFixture.rx, actions, overrideUser, 'undo after close with override');

  logScenario('close expired RX with read-only override');
  const readOnlyCloseFixture = await createRxFixture(actions, 'close-readonly');
  await addTracking(readOnlyCloseFixture.rx, actions[0], readOnlyOverrideUser, readOnlyCloseFixture.serviceDate);
  const readOnlyClose = await runHandler(
    rxController.closeExpiredWorkflow,
    mockReq(readOnlyOverrideUser, {}, { id: readOnlyCloseFixture.rx.id })
  );
  assert.strictEqual(readOnlyClose.status, 200, readOnlyClose.payload && readOnlyClose.payload.error);
  assert.strictEqual((await completedActionIds(readOnlyCloseFixture.rx)).length, actions.length);
  logPass('close expired RX with read-only override', `closed ${readOnlyClose.payload.closedSteps} step(s)`);

  logScenario('undo ignores createdAt order and follows workflow sequence');
  const undoFixture = await createRxFixture(actions, 'undo-order');
  const first = await addTracking(undoFixture.rx, actions[0], noOverrideUser, undoFixture.serviceDate);
  const second = await addTracking(undoFixture.rx, actions[1], noOverrideUser, addDays(undoFixture.serviceDate, 1));
  const third = await addTracking(undoFixture.rx, actions[2], noOverrideUser, addDays(undoFixture.serviceDate, 2));
  await db.sequelize.query(
    'UPDATE "RXWorkflowTrackings" SET "createdAt" = :createdAt, "updatedAt" = :updatedAt WHERE id = :id',
    { replacements: { id: first.id, createdAt: '2026-01-01T10:00:00.000Z', updatedAt: '2026-01-01T10:00:00.000Z' } }
  );
  await db.sequelize.query(
    'UPDATE "RXWorkflowTrackings" SET "createdAt" = :createdAt, "updatedAt" = :updatedAt WHERE id = :id',
    { replacements: { id: second.id, createdAt: '2026-01-03T10:00:00.000Z', updatedAt: '2026-01-03T10:00:00.000Z' } }
  );
  await db.sequelize.query(
    'UPDATE "RXWorkflowTrackings" SET "createdAt" = :createdAt, "updatedAt" = :updatedAt WHERE id = :id',
    { replacements: { id: third.id, createdAt: '2026-01-02T10:00:00.000Z', updatedAt: '2026-01-02T10:00:00.000Z' } }
  );
  const undoOrderRes = await runHandler(rxController.undoWorkflow, mockReq(noOverrideUser, { rxId: undoFixture.rx.id }));
  assert.strictEqual(undoOrderRes.status, 200, undoOrderRes.payload && undoOrderRes.payload.error);
  const remaining = await completedActionIds(undoFixture.rx);
  assert(remaining.includes(actions[0].id), 'step 1 should remain after sequence undo');
  assert(remaining.includes(actions[1].id), 'step 2 should remain even though it had newest createdAt');
  assert(!remaining.includes(actions[2].id), 'step 3 should be undone because it is the highest sequence');
  logPass('undo follows visible workflow sequence', `${actions[2].name} removed; ${actions[1].name} kept`);

  console.log('\nAll Patient/RX override permission scenarios passed.');
}

run()
  .catch(error => {
    console.error('\nFAIL:', error.message);
    console.error(error.stack);
    process.exitCode = 1;
  })
  .finally(async () => {
    await cleanup();
    await db.sequelize.close().catch(() => {});
  });
