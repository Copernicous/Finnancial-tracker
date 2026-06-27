'use strict';

const { Op } = require('sequelize');
const db = require('../models');

function dateOnly(value) {
    if (!value) return null;
    if (typeof value === 'string') return value.slice(0, 10);
    if (value instanceof Date && !isNaN(value.getTime())) return value.toISOString().slice(0, 10);
    return String(value).slice(0, 10);
}

function serviceDateMatches(left, right) {
    const l = dateOnly(left);
    const r = dateOnly(right);
    return !!l && !!r && l === r;
}

function addDays(value, days) {
    const d = new Date(value);
    if (isNaN(d.getTime())) return null;
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + days);
    return d;
}

function plainRecord(record) {
    return record && typeof record.toJSON === 'function' ? record.toJSON() : record;
}

function cleanId(value) {
    const id = parseInt(value, 10);
    return Number.isFinite(id) ? id : null;
}

function displayName(record, fields) {
    const plain = plainRecord(record) || {};
    for (const field of fields) {
        if (plain[field]) return plain[field];
    }
    return null;
}

function summarizeEntity(record, labelFields) {
    const plain = plainRecord(record);
    if (!plain || !plain.id) return null;
    return {
        id: cleanId(plain.id),
        label: displayName(plain, labelFields),
        name: plain.name || null,
        companyName: plain.companyName || null,
        contactPerson: plain.contactPerson || null
    };
}

async function loadEntity(model, included, id, options) {
    if (included && included.id) return included;
    const clean = cleanId(id);
    if (!model || !clean) return null;
    return model.findByPk(clean, options && options.transaction ? { transaction: options.transaction } : {});
}

function normalizeMetadata(metadata) {
    return metadata && typeof metadata === 'object' && !Array.isArray(metadata) ? { ...metadata } : {};
}

function comparableContext(snapshot) {
    if (!snapshot || typeof snapshot !== 'object') return null;
    return {
        clinic: snapshot.clinic || null,
        defaultPharmacy: snapshot.defaultPharmacy || null,
        patientTransport: snapshot.patientTransport || null,
        pharmacyTransport: snapshot.pharmacyTransport || null
    };
}

function contextsEqual(left, right) {
    return JSON.stringify(comparableContext(left)) === JSON.stringify(comparableContext(right));
}

function contextChangedFields(left, right) {
    const prev = comparableContext(left) || {};
    const next = comparableContext(right) || {};
    return ['clinic', 'defaultPharmacy', 'patientTransport', 'pharmacyTransport']
        .filter(field => JSON.stringify(prev[field] || null) !== JSON.stringify(next[field] || null));
}

async function buildPatientContextSnapshot(patient, options) {
    options = options || {};
    const plain = plainRecord(patient);
    if (!plain || !plain.id) return null;

    const queryOptions = options.transaction ? { transaction: options.transaction } : {};
    const [clinic, pharmacy, patientTransport, pharmacyTransport] = await Promise.all([
        loadEntity(db.Clinic, plain.Clinic, plain.clinicId, queryOptions),
        loadEntity(db.Pharmacy, plain.Pharmacy, plain.pharmacyId, queryOptions),
        loadEntity(db.PatientTransportCompany, plain.PatientTransportCompany, plain.patientTransportCompanyId, queryOptions),
        loadEntity(db.PharmacyTransportCompany, plain.PharmacyTransportCompany, plain.pharmacyTransportCompanyId, queryOptions)
    ]);

    return {
        capturedAt: new Date().toISOString(),
        source: options.source || 'Patient Context Snapshot',
        patientId: cleanId(plain.id),
        serviceDate: dateOnly(plain.serviceDate),
        clinic: summarizeEntity(clinic, ['name']),
        defaultPharmacy: summarizeEntity(pharmacy, ['name']),
        patientTransport: summarizeEntity(patientTransport, ['companyName', 'contactPerson']),
        pharmacyTransport: summarizeEntity(pharmacyTransport, ['companyName', 'contactPerson'])
    };
}

function mergePatientContextMetadata(currentMetadata, nextContext, options) {
    const metadata = normalizeMetadata(currentMetadata);
    const previousContext = options.previousPatientContext || metadata.patientContext || null;
    if (previousContext && !contextsEqual(previousContext, nextContext)) {
        const audit = Array.isArray(metadata.patientContextAudit) ? metadata.patientContextAudit.slice() : [];
        audit.push({
            changedAt: new Date().toISOString(),
            source: options.source || 'Patient Context Update',
            reason: options.contextChangeReason || null,
            changedFields: contextChangedFields(previousContext, nextContext),
            previous: comparableContext(previousContext),
            next: comparableContext(nextContext)
        });
        metadata.patientContextAudit = audit;
    }
    metadata.patientContext = nextContext;
    return metadata;
}

async function applyPatientContextSnapshot(cycle, patient, options) {
    options = options || {};
    if (!cycle || !patient || options.capturePatientContext === false) return cycle;

    const nextStatus = options.nextStatus || cycle.status;
    const isNewCycle = options.isNewCycle === true;
    const metadata = normalizeMetadata(cycle.metadata);
    if (!isNewCycle && nextStatus !== 'active' && metadata.patientContext) return cycle;
    if (!isNewCycle && nextStatus !== 'active' && !options.captureHistoricalContext) return cycle;

    const nextContext = await buildPatientContextSnapshot(patient, {
        transaction: options.transaction,
        source: options.source || 'Patient Context Snapshot'
    });
    if (!nextContext) return cycle;

    if (!isNewCycle && contextsEqual(metadata.patientContext, nextContext)) return cycle;

    const nextMetadata = mergePatientContextMetadata(metadata, nextContext, options);
    await cycle.update(
        { metadata: nextMetadata },
        options.transaction ? { transaction: options.transaction } : {}
    );
    return cycle;
}

async function cycleDefaults(patient, serviceDate, options) {
    const cleanDate = dateOnly(serviceDate);
    const active = serviceDateMatches(patient && patient.serviceDate, cleanDate);
    const baseMetadata = normalizeMetadata(options && options.metadata);
    if (!baseMetadata.patientContext && (!options || options.capturePatientContext !== false)) {
        const context = await buildPatientContextSnapshot(patient, {
            transaction: options && options.transaction,
            source: (options && options.source) || 'Patient Service Date'
        });
        if (context) baseMetadata.patientContext = context;
    }
    return {
        patientId:       patient.id,
        serviceDate:     cleanDate,
        status:          active ? 'active' : 'historical',
        source:          (options && options.source) || 'Patient Service Date',
        startedAt:       cleanDate ? new Date(cleanDate) : null,
        endedAt:         active ? null : addDays(cleanDate, 90),
        createdByUserId: (options && options.userId) || null,
        metadata:        Object.keys(baseMetadata).length ? baseMetadata : null
    };
}

async function findOrCreateCycle(patient, serviceDate, options) {
    options = options || {};
    const cleanDate = dateOnly(serviceDate);
    if (!patient || !patient.id || !cleanDate) return null;

    const tx = options.transaction;
    const defaults = await cycleDefaults(patient, cleanDate, options);
    const queryOptions = {
        where: { patientId: patient.id, serviceDate: cleanDate },
        defaults
    };
    if (tx) queryOptions.transaction = tx;

    let cycle;
    let created = false;
    try {
        [cycle, created] = await db.PatientServiceDateCycle.findOrCreate(queryOptions);
    } catch (err) {
        if (err.name !== 'SequelizeUniqueConstraintError') throw err;
        cycle = await db.PatientServiceDateCycle.findOne({
            where: { patientId: patient.id, serviceDate: cleanDate },
            transaction: tx
        });
    }

    if (!cycle) return null;
    const nextStatus = serviceDateMatches(patient.serviceDate, cleanDate) ? 'active' : 'historical';
    const nextEndedAt = nextStatus === 'active' ? null : addDays(cleanDate, 90);
    if (cycle.status !== nextStatus || String(cycle.endedAt || '') !== String(nextEndedAt || '')) {
        await cycle.update({ status: nextStatus, endedAt: nextEndedAt }, tx ? { transaction: tx } : {});
    }
    await applyPatientContextSnapshot(cycle, patient, {
        ...options,
        nextStatus,
        isNewCycle: created,
        source: options.source || 'Cycle Sync'
    });
    return cycle;
}

async function syncPatientServiceDateCycles(patientOrId, options) {
    options = options || {};
    const tx = options.transaction;
    const patient = typeof patientOrId === 'object' && patientOrId !== null
        ? patientOrId
        : await db.Patient.findByPk(patientOrId, { transaction: tx });
    if (!patient || !patient.id) return [];

    const patientId = patient.id;
    const dates = new Set();
    const activeDate = dateOnly(patient.serviceDate);
    if (activeDate) dates.add(activeDate);

    const rxRows = await db.RXRecord.findAll({
        where: {
            patientId,
            serviceDate: { [Op.ne]: null }
        },
        attributes: ['id', 'patientId', 'serviceDate', 'patientServiceDateCycleId'],
        transaction: tx
    });

    rxRows.forEach((rx) => {
        const d = dateOnly(rx.serviceDate);
        if (d) dates.add(d);
    });

    const cyclesByDate = new Map();
    for (const d of dates) {
        const cycle = await findOrCreateCycle(patient, d, {
            transaction: tx,
            userId: options.userId,
            source: options.source || 'Cycle Sync',
            metadata: options.metadata,
            previousPatientContext: options.previousPatientContext,
            contextChangeReason: options.contextChangeReason,
            capturePatientContext: options.capturePatientContext,
            captureHistoricalContext: options.captureHistoricalContext
        });
        if (cycle) cyclesByDate.set(d, cycle);
    }

    const updateOptions = tx ? { transaction: tx } : {};
    await db.PatientServiceDateCycle.update(
        { status: 'historical' },
        {
            where: activeDate
                ? { patientId, serviceDate: { [Op.ne]: activeDate } }
                : { patientId },
            ...updateOptions
        }
    );
    if (activeDate && cyclesByDate.has(activeDate)) {
        await cyclesByDate.get(activeDate).update({ status: 'active', endedAt: null }, updateOptions);
    }

    for (const rx of rxRows) {
        const cycle = cyclesByDate.get(dateOnly(rx.serviceDate));
        if (cycle && Number(rx.patientServiceDateCycleId || 0) !== Number(cycle.id)) {
            await rx.update({ patientServiceDateCycleId: cycle.id }, updateOptions);
        }
    }

    return db.PatientServiceDateCycle.findAll({
        where: { patientId },
        order: [['serviceDate', 'DESC'], ['id', 'DESC']],
        transaction: tx
    });
}

async function ensureCycleForRx(patient, serviceDate, options) {
    options = options || {};
    const cycle = await findOrCreateCycle(patient, serviceDate, {
        ...options,
        source: options.source || 'RX Create'
    });
    if (cycle) {
        await syncPatientServiceDateCycles(patient, {
            transaction: options.transaction,
            userId: options.userId,
            source: 'RX Cycle Link'
        });
    }
    return cycle;
}

module.exports = {
    dateOnly,
    serviceDateMatches,
    buildPatientContextSnapshot,
    findOrCreateCycle,
    ensureCycleForRx,
    syncPatientServiceDateCycles
};
