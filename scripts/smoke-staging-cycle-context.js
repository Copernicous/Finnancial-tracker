'use strict';

const { prepareStagingEnv } = require('./lib/staging-env');

const stagingConfig = prepareStagingEnv();
const db = require('../models');
const { Op } = db.Sequelize;
const {
    buildPatientContextSnapshot,
    syncPatientServiceDateCycles
} = require('../services/patientServiceDateCycleService');

const TEST_PREFIX = 'STG-CYCLE-CTX-';

const created = {
    patients: [],
    rxRecords: [],
    clinics: [],
    pharmacies: [],
    patientTransports: [],
    pharmacyTransports: []
};

function assert(condition, message) {
    if (!condition) throw new Error(message);
}

function label(entity) {
    return entity && (entity.label || entity.name || entity.companyName || entity.contactPerson || null);
}

async function cleanupPrefixRows() {
    const patients = await db.Patient.findAll({
        where: { patientCode: { [Op.like]: TEST_PREFIX + '%' } },
        attributes: ['id']
    });
    const patientIds = patients.map(row => row.id);
    if (patientIds.length) {
        const rxRows = await db.RXRecord.findAll({
            where: { patientId: { [Op.in]: patientIds } },
            attributes: ['id']
        });
        const rxIds = rxRows.map(row => row.id);
        if (rxIds.length) {
            await db.RXWorkflowTracking.destroy({ where: { rxRecordId: { [Op.in]: rxIds } } }).catch(() => {});
            await db.RXHistory.destroy({ where: { rxRecordId: { [Op.in]: rxIds } } }).catch(() => {});
            await db.Medication.destroy({ where: { rxRecordId: { [Op.in]: rxIds } } }).catch(() => {});
            await db.RXRecord.destroy({ where: { id: { [Op.in]: rxIds } } }).catch(() => {});
        }
        await db.PatientServiceDateHistory.destroy({ where: { patientId: { [Op.in]: patientIds } } }).catch(() => {});
        await db.PatientServiceDateCycle.destroy({ where: { patientId: { [Op.in]: patientIds } } }).catch(() => {});
        await db.Patient.destroy({ where: { id: { [Op.in]: patientIds } } }).catch(() => {});
    }

    await db.Clinic.destroy({ where: { name: { [Op.like]: TEST_PREFIX + '%' } } }).catch(() => {});
    await db.Pharmacy.destroy({ where: { name: { [Op.like]: TEST_PREFIX + '%' } } }).catch(() => {});
    await db.PatientTransportCompany.destroy({ where: { companyName: { [Op.like]: TEST_PREFIX + '%' } } }).catch(() => {});
    await db.PharmacyTransportCompany.destroy({ where: { companyName: { [Op.like]: TEST_PREFIX + '%' } } }).catch(() => {});
}

async function cleanupCreatedRows() {
    const rxIds = created.rxRecords.map(row => row.id);
    if (rxIds.length) {
        await db.RXWorkflowTracking.destroy({ where: { rxRecordId: { [Op.in]: rxIds } } }).catch(() => {});
        await db.RXHistory.destroy({ where: { rxRecordId: { [Op.in]: rxIds } } }).catch(() => {});
        await db.Medication.destroy({ where: { rxRecordId: { [Op.in]: rxIds } } }).catch(() => {});
        await db.RXRecord.destroy({ where: { id: { [Op.in]: rxIds } } }).catch(() => {});
    }

    const patientIds = created.patients.map(row => row.id);
    if (patientIds.length) {
        await db.PatientServiceDateHistory.destroy({ where: { patientId: { [Op.in]: patientIds } } }).catch(() => {});
        await db.PatientServiceDateCycle.destroy({ where: { patientId: { [Op.in]: patientIds } } }).catch(() => {});
        await db.Patient.destroy({ where: { id: { [Op.in]: patientIds } } }).catch(() => {});
    }

    if (created.clinics.length) await db.Clinic.destroy({ where: { id: created.clinics.map(row => row.id) } }).catch(() => {});
    if (created.pharmacies.length) await db.Pharmacy.destroy({ where: { id: created.pharmacies.map(row => row.id) } }).catch(() => {});
    if (created.patientTransports.length) await db.PatientTransportCompany.destroy({ where: { id: created.patientTransports.map(row => row.id) } }).catch(() => {});
    if (created.pharmacyTransports.length) await db.PharmacyTransportCompany.destroy({ where: { id: created.pharmacyTransports.map(row => row.id) } }).catch(() => {});
}

async function makeFixtureSet(tag) {
    const clinic = await db.Clinic.create({
        name: `${TEST_PREFIX}${tag} Clinic`,
        address: `${tag} clinic address`,
        phone: '555-1000',
        contactPerson: `${tag} clinic contact`,
        notes: 'Temporary cycle context smoke fixture',
        isActive: true
    });
    created.clinics.push(clinic);

    const pharmacy = await db.Pharmacy.create({
        name: `${TEST_PREFIX}${tag} Pharmacy`,
        address: `${tag} pharmacy address`,
        phone: '555-1001',
        contactPerson: `${tag} pharmacist`,
        notes: 'Temporary cycle context smoke fixture',
        isActive: true
    });
    created.pharmacies.push(pharmacy);

    const patientTransport = await db.PatientTransportCompany.create({
        companyName: `${TEST_PREFIX}${tag} Patient Transport`,
        phone: '555-1002',
        contactPerson: `${tag} patient driver`,
        notes: 'Temporary cycle context smoke fixture',
        isActive: true
    });
    created.patientTransports.push(patientTransport);

    const pharmacyTransport = await db.PharmacyTransportCompany.create({
        companyName: `${TEST_PREFIX}${tag} Pharmacy Transport`,
        phone: '555-1003',
        contactPerson: `${tag} pharmacy driver`,
        notes: 'Temporary cycle context smoke fixture',
        isActive: true
    });
    created.pharmacyTransports.push(pharmacyTransport);

    return { clinic, pharmacy, patientTransport, pharmacyTransport };
}

async function main() {
    console.log('Staging service-date cycle context smoke test');
    console.log('DB: ' + stagingConfig.dbHost + ':' + stagingConfig.dbPort + '/' + stagingConfig.dbName);
    await db.sequelize.authenticate();
    await cleanupPrefixRows();

    const oldSet = await makeFixtureSet('Old');
    const newSet = await makeFixtureSet('New');

    const patient = await db.Patient.create({
        firstName: 'STAGING',
        lastName: 'CYCLE CONTEXT',
        dob: '1980-01-01',
        address: 'Temporary staging smoke patient',
        phone: '555-1999',
        serviceDate: '2025-01-01',
        clinicId: oldSet.clinic.id,
        pharmacyId: oldSet.pharmacy.id,
        patientTransportCompanyId: oldSet.patientTransport.id,
        pharmacyTransportCompanyId: oldSet.pharmacyTransport.id,
        notes: 'Temporary service-date cycle context smoke patient',
        isActive: true,
        isDeleted: false,
        patientCode: TEST_PREFIX + Date.now()
    });
    created.patients.push(patient);

    await syncPatientServiceDateCycles(patient, {
        source: 'Cycle Context Smoke Create',
        contextChangeReason: 'Initial old defaults captured.'
    });

    const oldCycle = await db.PatientServiceDateCycle.findOne({
        where: { patientId: patient.id, serviceDate: '2025-01-01' }
    });
    assert(oldCycle, 'Old service-date cycle was not created.');

    const rx = await db.RXRecord.create({
        patientId: patient.id,
        patientServiceDateCycleId: oldCycle.id,
        arrivalDate: '2025-01-01',
        serviceDate: '2025-01-01',
        pharmacyId: oldSet.pharmacy.id,
        patientTransportCompanyId: oldSet.patientTransport.id,
        pharmacyTransportCompanyId: oldSet.pharmacyTransport.id,
        isDeleted: false,
        returnedToWarehouse: false
    });
    created.rxRecords.push(rx);

    const previousContext = await buildPatientContextSnapshot(patient, {
        source: 'Before Cycle Context Smoke Update'
    });

    await patient.update({
        serviceDate: '2026-06-26',
        clinicId: newSet.clinic.id,
        pharmacyId: newSet.pharmacy.id,
        patientTransportCompanyId: newSet.patientTransport.id,
        pharmacyTransportCompanyId: newSet.pharmacyTransport.id
    });

    await syncPatientServiceDateCycles(patient, {
        source: 'Cycle Context Smoke Update',
        previousPatientContext: previousContext,
        contextChangeReason: 'Service date and patient defaults changed.'
    });

    const cycles = await db.PatientServiceDateCycle.findAll({
        where: { patientId: patient.id },
        order: [['serviceDate', 'ASC']]
    });
    const reloadedOld = cycles.find(cycle => String(cycle.serviceDate) === '2025-01-01');
    const reloadedNew = cycles.find(cycle => String(cycle.serviceDate) === '2026-06-26');

    assert(reloadedOld, 'Old service-date cycle disappeared.');
    assert(reloadedNew, 'New service-date cycle was not created.');

    const oldContext = reloadedOld.metadata && reloadedOld.metadata.patientContext;
    const newContext = reloadedNew.metadata && reloadedNew.metadata.patientContext;
    assert(oldContext, 'Old cycle has no captured patient defaults.');
    assert(newContext, 'New cycle has no captured patient defaults.');
    assert(label(oldContext.clinic) === oldSet.clinic.name, 'Old cycle clinic snapshot was overwritten.');
    assert(label(oldContext.defaultPharmacy) === oldSet.pharmacy.name, 'Old cycle default pharmacy snapshot was overwritten.');
    assert(label(oldContext.patientTransport) === oldSet.patientTransport.companyName, 'Old cycle patient transport snapshot was overwritten.');
    assert(label(oldContext.pharmacyTransport) === oldSet.pharmacyTransport.companyName, 'Old cycle pharmacy transport snapshot was overwritten.');

    assert(label(newContext.clinic) === newSet.clinic.name, 'New cycle clinic snapshot is wrong.');
    assert(label(newContext.defaultPharmacy) === newSet.pharmacy.name, 'New cycle default pharmacy snapshot is wrong.');
    assert(label(newContext.patientTransport) === newSet.patientTransport.companyName, 'New cycle patient transport snapshot is wrong.');
    assert(label(newContext.pharmacyTransport) === newSet.pharmacyTransport.companyName, 'New cycle pharmacy transport snapshot is wrong.');
    assert(Array.isArray(reloadedNew.metadata.patientContextAudit) && reloadedNew.metadata.patientContextAudit.length >= 1, 'New cycle did not record context audit.');

    console.log('PASS old cycle kept old clinic/pharmacy/transport defaults');
    console.log('PASS new cycle captured new clinic/pharmacy/transport defaults');
    console.log('PASS new cycle recorded patient context audit metadata');
}

main()
    .catch((err) => {
        console.error('FAIL staging service-date cycle context smoke test');
        console.error(err.stack || err.message);
        process.exitCode = 1;
    })
    .finally(async () => {
        await cleanupCreatedRows().catch(() => {});
        await db.sequelize.close().catch(() => {});
    });
