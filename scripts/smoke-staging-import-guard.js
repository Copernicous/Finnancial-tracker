'use strict';

const { prepareStagingEnv } = require('./lib/staging-env');

const stagingConfig = prepareStagingEnv();
const db = require('../models');
const { Op } = db.Sequelize;

const TEST_PREFIX = 'STG-IMP-GUARD-';
const DEFAULT_BASE_URL = 'http://localhost:' + (process.env.PORT || stagingConfig.port || '3100');
const baseUrl = (process.env.STAGING_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, '');
const username = process.env.STAGING_SMOKE_USER || process.env.STAGING_TEST_USER || 'test';
const password = process.env.STAGING_SMOKE_PASS || process.env.STAGING_TEST_PASS || 'test';

const WORKFLOW_HEADERS = [
    'RX Received Warehouse',
    'On Route with Driver',
    'Delivered',
    'Mark as Received to print log',
    'Signed by Pharmacy',
    'Archived on local and case close'
];

const PATIENT_IMPORT_HEADERS = [
    'patientCode',
    'firstName',
    'lastName',
    'dob',
    'phone',
    'address',
    'clinic',
    'serviceDate',
    'patientTransportCompany',
    'pharmacyTransportCompany',
    'notes',
    'isActive',
    ...WORKFLOW_HEADERS
];

function fail(message) {
    throw new Error(message);
}

function assert(condition, message) {
    if (!condition) fail(message);
}

function dateOnly(value) {
    if (!value) return null;
    if (typeof value === 'string') return value.slice(0, 10);
    if (value instanceof Date && !isNaN(value.getTime())) return value.toISOString().slice(0, 10);
    return String(value).slice(0, 10);
}

function csvEscape(value) {
    const text = value === null || value === undefined ? '' : String(value);
    if (!/[",\r\n]/.test(text)) return text;
    return '"' + text.replace(/"/g, '""') + '"';
}

function buildCsv(rows) {
    const lines = [PATIENT_IMPORT_HEADERS.map(csvEscape).join(',')];
    rows.forEach((row) => {
        lines.push(PATIENT_IMPORT_HEADERS.map((header) => csvEscape(row[header] || '')).join(','));
    });
    return lines.join('\n') + '\n';
}

async function parseJsonResponse(res, context) {
    const text = await res.text();
    try {
        return JSON.parse(text);
    } catch (err) {
        fail(context + ' did not return JSON. HTTP ' + res.status + '. Body starts with: ' + text.slice(0, 120));
    }
}

async function login() {
    let res;
    try {
        res = await fetch(baseUrl + '/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });
    } catch (err) {
        fail('Cannot reach staging at ' + baseUrl + '. Start it with "npm run staging:start" first. ' + err.message);
    }

    const body = await parseJsonResponse(res, 'Login');
    assert(res.ok, 'Login failed for ' + username + ': ' + (body.message || JSON.stringify(body)));
    assert(!body.requires2FA, 'The staging smoke user requires 2FA. Use STAGING_SMOKE_USER/STAGING_SMOKE_PASS with an import-capable test user.');
    assert(body.token, 'Login did not return a bearer token.');
    return body.token;
}

async function importPatients(rows, token, label) {
    const form = new FormData();
    form.append('file', new Blob([buildCsv(rows)], { type: 'text/csv' }), label + '.csv');

    const res = await fetch(baseUrl + '/api/import/patients', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + token },
        body: form
    });
    const body = await parseJsonResponse(res, 'Patient import ' + label);
    assert(res.ok, 'Patient import ' + label + ' failed HTTP ' + res.status + ': ' + JSON.stringify(body));
    return body;
}

async function criticalCounts() {
    return {
        patients: await db.Patient.count(),
        rxRecords: await db.RXRecord.count(),
        workflowTrackings: await db.RXWorkflowTracking.count(),
        serviceDateCycles: await db.PatientServiceDateCycle.count(),
        serviceDateHistories: await db.PatientServiceDateHistory.count()
    };
}

function assertCountsEqual(before, after, label) {
    Object.keys(before).forEach((key) => {
        assert(
            before[key] === after[key],
            label + ' changed ' + key + ' count. Before=' + before[key] + ', after=' + after[key]
        );
    });
}

async function findTestPatientIds(transaction) {
    const rows = await db.Patient.findAll({
        where: { patientCode: { [Op.like]: TEST_PREFIX + '%' } },
        attributes: ['id'],
        transaction
    });
    return rows.map((row) => row.id);
}

async function cleanupTestRows() {
    const transaction = await db.sequelize.transaction();
    try {
        const patientIds = await findTestPatientIds(transaction);
        if (!patientIds.length) {
            await transaction.commit();
            return;
        }

        const rxRows = await db.RXRecord.findAll({
            where: { patientId: { [Op.in]: patientIds } },
            attributes: ['id'],
            transaction
        });
        const rxIds = rxRows.map((row) => row.id);

        if (rxIds.length) {
            await db.RXWorkflowTracking.destroy({ where: { rxRecordId: { [Op.in]: rxIds } }, transaction });
            await db.RXHistory.destroy({ where: { rxRecordId: { [Op.in]: rxIds } }, transaction });
            await db.Medication.destroy({ where: { rxRecordId: { [Op.in]: rxIds } }, transaction });
            await db.DocumentAttachment.destroy({ where: { rxRecordId: { [Op.in]: rxIds } }, transaction });
            await db.RXRecord.destroy({ where: { id: { [Op.in]: rxIds } }, transaction });
        }

        await db.DocumentAttachment.destroy({ where: { patientId: { [Op.in]: patientIds } }, transaction });
        await db.PatientServiceDateHistory.destroy({ where: { patientId: { [Op.in]: patientIds } }, transaction });
        await db.PatientServiceDateCycle.destroy({ where: { patientId: { [Op.in]: patientIds } }, transaction });
        await db.Patient.destroy({ where: { id: { [Op.in]: patientIds } }, transaction });
        await transaction.commit();
    } catch (err) {
        await transaction.rollback();
        throw err;
    }
}

async function assertNoTestRows(label) {
    const patientIds = await findTestPatientIds();
    assert(patientIds.length === 0, label + ' left test patients in the DB: ' + patientIds.join(', '));
}

function invalidRows() {
    return [
        {
            patientCode: TEST_PREFIX + 'GOOD-ABORT',
            firstName: 'Stage',
            lastName: 'GoodAbort',
            dob: '01/01/1980',
            serviceDate: '06/01/2026',
            notes: 'This row is valid but must not import when the same file has bad rows.',
            isActive: 'true',
            'RX Received Warehouse': '06/01/2026',
            'On Route with Driver': '06/02/2026'
        },
        {
            patientCode: TEST_PREFIX + 'BEFORE-SVC',
            firstName: 'Stage',
            lastName: 'BeforeService',
            dob: '01/02/1980',
            serviceDate: '06/10/2026',
            notes: 'Workflow starts before service date.',
            isActive: 'true',
            'RX Received Warehouse': '06/09/2026'
        },
        {
            patientCode: TEST_PREFIX + 'OVER-90',
            firstName: 'Stage',
            lastName: 'OverNinety',
            dob: '01/03/1980',
            serviceDate: '01/01/2026',
            notes: 'Workflow step exceeds service date plus ninety days.',
            isActive: 'true',
            'RX Received Warehouse': '01/01/2026',
            'On Route with Driver': '04/15/2026'
        },
        {
            patientCode: TEST_PREFIX + 'BAD-ORDER',
            firstName: 'Stage',
            lastName: 'BadOrder',
            dob: '01/04/1980',
            serviceDate: '06/01/2026',
            notes: 'Workflow sequence dates move backwards.',
            isActive: 'true',
            'RX Received Warehouse': '06/05/2026',
            'On Route with Driver': '06/04/2026'
        }
    ];
}

function validRows() {
    return [
        {
            patientCode: TEST_PREFIX + 'VALID-INFER',
            firstName: 'Stage',
            lastName: 'ValidInfer',
            dob: '01/05/1980',
            serviceDate: '',
            notes: 'Blank service date should infer from earliest workflow date.',
            isActive: 'true',
            'RX Received Warehouse': '06/01/2026',
            'On Route with Driver': '06/15/2026'
        },
        {
            patientCode: TEST_PREFIX + 'VALID-PATIENT-ONLY',
            firstName: 'Stage',
            lastName: 'PatientOnly',
            dob: '01/06/1980',
            serviceDate: '06/05/2026',
            notes: 'Patient-only import should create a service-date cycle but no RX.',
            isActive: 'true'
        }
    ];
}

async function assertInvalidImportWasBlocked(token) {
    const before = await criticalCounts();
    const result = await importPatients(invalidRows(), token, 'staging-import-guard-invalid');
    const after = await criticalCounts();

    assert(result.aborted === true, 'Invalid import should be aborted.');
    assert(result.successCount === 0, 'Invalid import should report zero successes.');
    assert(result.errorCount >= 3, 'Invalid import should report the bad range errors.');

    const errorText = (result.errors || []).map((entry) => entry.error).join('\n');
    assert(/cannot be before service date/i.test(errorText), 'Missing service-date-before-workflow import error.');
    assert(/exceeds service date \+ 90 days/i.test(errorText), 'Missing workflow-over-90-days import error.');
    assert(/chronological order/i.test(errorText), 'Missing workflow chronology import error.');

    assertCountsEqual(before, after, 'Invalid import');
    await assertNoTestRows('Invalid import');

    console.log('PASS invalid import aborted without partial DB writes');
}

async function assertValidImportLinksCycles(token) {
    const result = await importPatients(validRows(), token, 'staging-import-guard-valid');
    assert(result.aborted === false, 'Valid import should not be aborted.');
    assert(result.successCount === 2, 'Valid import should create two patients.');
    assert(result.errorCount === 0, 'Valid import should have zero errors.');

    const inferredPatient = await db.Patient.findOne({
        where: { patientCode: TEST_PREFIX + 'VALID-INFER' }
    });
    assert(inferredPatient, 'Valid inferred-service-date patient was not created.');
    assert(dateOnly(inferredPatient.serviceDate) === '2026-06-01', 'Blank service date was not inferred from first workflow date.');

    const inferredRx = await db.RXRecord.findOne({
        where: { patientId: inferredPatient.id }
    });
    assert(inferredRx, 'Workflow import did not create an RX record.');
    assert(dateOnly(inferredRx.serviceDate) === '2026-06-01', 'Imported RX service date does not match inferred patient service date.');
    assert(inferredRx.patientServiceDateCycleId, 'Imported RX was not linked to a service-date cycle.');

    const inferredCycle = await db.PatientServiceDateCycle.findByPk(inferredRx.patientServiceDateCycleId);
    assert(inferredCycle, 'Linked service-date cycle was not found.');
    assert(dateOnly(inferredCycle.serviceDate) === '2026-06-01', 'Linked cycle service date is wrong.');
    assert(inferredCycle.status === 'active', 'Linked cycle should be active for the current patient service date.');

    const trackingCount = await db.RXWorkflowTracking.count({ where: { rxRecordId: inferredRx.id } });
    assert(trackingCount === 2, 'Imported RX should have two workflow tracking rows.');

    const patientOnly = await db.Patient.findOne({
        where: { patientCode: TEST_PREFIX + 'VALID-PATIENT-ONLY' }
    });
    assert(patientOnly, 'Patient-only import row was not created.');
    assert(dateOnly(patientOnly.serviceDate) === '2026-06-05', 'Patient-only service date was not stored.');

    const patientOnlyRxCount = await db.RXRecord.count({ where: { patientId: patientOnly.id } });
    assert(patientOnlyRxCount === 0, 'Patient-only import should not create an RX record when workflow columns are blank.');

    const patientOnlyCycles = await db.PatientServiceDateCycle.findAll({
        where: { patientId: patientOnly.id },
        order: [['serviceDate', 'ASC']]
    });
    assert(patientOnlyCycles.length === 1, 'Patient-only import should create exactly one service-date cycle.');
    assert(dateOnly(patientOnlyCycles[0].serviceDate) === '2026-06-05', 'Patient-only cycle service date is wrong.');

    console.log('PASS valid import created expected patient/RX/workflow/cycle links');
}

async function main() {
    console.log('Staging patient import guard smoke test');
    console.log('URL: ' + baseUrl);
    console.log('DB : ' + stagingConfig.dbHost + ':' + stagingConfig.dbPort + '/' + stagingConfig.dbName);

    await db.sequelize.authenticate();
    await cleanupTestRows();
    await assertNoTestRows('Initial cleanup');

    const token = await login();
    let beforeValid = null;
    try {
        await assertInvalidImportWasBlocked(token);
        beforeValid = await criticalCounts();
        await assertValidImportLinksCycles(token);
    } finally {
        await cleanupTestRows();
    }

    const afterCleanup = await criticalCounts();
    assertCountsEqual(beforeValid, afterCleanup, 'Valid import cleanup');

    console.log('PASS cleanup removed all import guard test rows');
    console.log('All staging import guard checks passed.');
}

main()
    .catch((err) => {
        console.error('FAIL staging import guard smoke test');
        console.error(err.stack || err.message);
        process.exitCode = 1;
    })
    .finally(async () => {
        await db.sequelize.close().catch(() => {});
    });
