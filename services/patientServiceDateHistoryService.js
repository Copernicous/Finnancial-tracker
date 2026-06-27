'use strict';

const db = require('../models');
const { Op } = require('sequelize');

function dateOnly(value) {
    if (value === null || value === undefined || value === '') return null;
    if (value instanceof Date) {
        if (isNaN(value.getTime())) return null;
        return value.toISOString().slice(0, 10);
    }
    const raw = String(value).trim();
    if (!raw) return null;
    const iso = raw.match(/^(\d{4}-\d{2}-\d{2})/);
    if (iso) return iso[1];
    const parsed = new Date(raw);
    if (!isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
    return raw.slice(0, 10);
}

function datesEqual(left, right) {
    return dateOnly(left) === dateOnly(right);
}

function buildHistoryRow(entry, defaults) {
    const previousServiceDate = dateOnly(entry.previousServiceDate);
    const newServiceDate = dateOnly(entry.newServiceDate);
    if (previousServiceDate === newServiceDate) return null;

    return {
        patientId:           entry.patientId,
        previousServiceDate,
        newServiceDate,
        changedByUserId:     entry.userId || defaults.userId || null,
        changeSource:        entry.changeSource || defaults.changeSource || 'Patient Update',
        reason:              entry.reason || defaults.reason || null,
        metadata:            entry.metadata || defaults.metadata || null
    };
}

function summarizeRxRecord(rx) {
    const plain = typeof rx.toJSON === 'function' ? rx.toJSON() : rx;
    return {
        id: plain.id,
        patientServiceDateCycleId: plain.patientServiceDateCycleId || null,
        serviceDate: dateOnly(plain.serviceDate),
        arrivalDate: dateOnly(plain.arrivalDate),
        pharmacyName: plain.Pharmacy ? plain.Pharmacy.name : null,
        workflowStepCount: Array.isArray(plain.RXWorkflowTrackings) ? plain.RXWorkflowTrackings.length : 0,
        returnedToWarehouse: plain.returnedToWarehouse === true
    };
}

function serviceDateKey(patientId, serviceDate) {
    return String(patientId) + '|' + String(serviceDate || '');
}

function buildRelatedRxSummary(row, rxByPatientAndDate) {
    const previousServiceDate = dateOnly(row.previousServiceDate);
    const newServiceDate = dateOnly(row.newServiceDate);
    const previousRxRecords = previousServiceDate
        ? (rxByPatientAndDate.get(serviceDateKey(row.patientId, previousServiceDate)) || [])
        : [];
    const newRxRecords = newServiceDate
        ? (rxByPatientAndDate.get(serviceDateKey(row.patientId, newServiceDate)) || [])
        : [];
    const uniqueIds = new Set();
    previousRxRecords.forEach(rx => uniqueIds.add(rx.id));
    newRxRecords.forEach(rx => uniqueIds.add(rx.id));

    return {
        previousServiceDate,
        newServiceDate,
        previousRxCount: previousRxRecords.length,
        newRxCount: newRxRecords.length,
        totalRxCount: uniqueIds.size,
        previousRxRecords,
        newRxRecords
    };
}

async function findRelatedRxRecords(patientIds, serviceDates, options) {
    const cleanPatientIds = Array.from(new Set((patientIds || [])
        .map(id => parseInt(id, 10))
        .filter(id => Number.isFinite(id))));
    const cleanDates = Array.from(new Set((serviceDates || []).map(dateOnly).filter(Boolean)));
    if (!cleanPatientIds.length || !cleanDates.length || !db.RXRecord) return [];

    let cycleIds = [];
    if (db.PatientServiceDateCycle) {
        const cycleOptions = {
            where: {
                patientId: { [Op.in]: cleanPatientIds },
                serviceDate: { [Op.in]: cleanDates }
            },
            attributes: ['id']
        };
        if (options && options.transaction) cycleOptions.transaction = options.transaction;
        const cycles = await db.PatientServiceDateCycle.findAll(cycleOptions);
        cycleIds = cycles.map(cycle => cycle.id);
    }

    const relatedWhere = [
        {
            patientId: { [Op.in]: cleanPatientIds },
            serviceDate: { [Op.in]: cleanDates }
        }
    ];
    if (cycleIds.length) {
        relatedWhere.push({ patientServiceDateCycleId: { [Op.in]: cycleIds } });
    }

    const queryOptions = {
        where: {
            [Op.and]: [
                { [Op.or]: relatedWhere },
                { [Op.or]: [{ isDeleted: false }, { isDeleted: null }] }
            ]
        },
        attributes: ['id', 'patientId', 'patientServiceDateCycleId', 'arrivalDate', 'serviceDate', 'pharmacyId', 'returnedToWarehouse'],
        include: [
            { model: db.PatientServiceDateCycle, attributes: ['id', 'patientId', 'serviceDate'], required: false },
            { model: db.Pharmacy, attributes: ['id', 'name'], required: false },
            { model: db.RXWorkflowTracking, attributes: ['id', 'workflowActionId'], required: false }
        ],
        order: [['serviceDate', 'DESC'], ['id', 'DESC']]
    };
    if (options && options.transaction) queryOptions.transaction = options.transaction;

    return db.RXRecord.findAll(queryOptions);
}

async function buildRxServiceSnapshot(row, options) {
    const rxRows = await findRelatedRxRecords(
        [row.patientId],
        [row.previousServiceDate, row.newServiceDate],
        options
    );
    const rxByPatientAndDate = new Map();
    rxRows.forEach((rx) => {
        const plain = typeof rx.toJSON === 'function' ? rx.toJSON() : rx;
        const cycle = plain.PatientServiceDateCycle || null;
        const key = cycle
            ? serviceDateKey(cycle.patientId || plain.patientId, dateOnly(cycle.serviceDate))
            : serviceDateKey(plain.patientId, dateOnly(plain.serviceDate));
        const list = rxByPatientAndDate.get(key) || [];
        list.push(summarizeRxRecord(plain));
        rxByPatientAndDate.set(key, list);
    });
    return buildRelatedRxSummary(row, rxByPatientAndDate);
}

async function attachRelatedRxServiceRecords(historyRows, options) {
    const rows = (historyRows || []).map((row) => (
        typeof row.toJSON === 'function' ? row.toJSON() : { ...row }
    ));
    const patientIds = [];
    const serviceDates = [];

    rows.forEach((row) => {
        if (row.patientId) patientIds.push(row.patientId);
        const previousServiceDate = dateOnly(row.previousServiceDate);
        const newServiceDate = dateOnly(row.newServiceDate);
        if (previousServiceDate) serviceDates.push(previousServiceDate);
        if (newServiceDate) serviceDates.push(newServiceDate);
    });

    let rxRows = [];
    try {
        rxRows = await findRelatedRxRecords(patientIds, serviceDates, options);
    } catch (err) {
        console.warn('[PatientServiceDateHistory] Could not load related RX records:', err.message);
    }

    const rxByPatientAndDate = new Map();
    rxRows.forEach((rx) => {
        const plain = typeof rx.toJSON === 'function' ? rx.toJSON() : rx;
        const cycle = plain.PatientServiceDateCycle || null;
        const key = cycle
            ? serviceDateKey(cycle.patientId || plain.patientId, dateOnly(cycle.serviceDate))
            : serviceDateKey(plain.patientId, dateOnly(plain.serviceDate));
        const list = rxByPatientAndDate.get(key) || [];
        list.push(summarizeRxRecord(plain));
        rxByPatientAndDate.set(key, list);
    });

    return rows.map((row) => ({
        ...row,
        relatedRxRecords: buildRelatedRxSummary(row, rxByPatientAndDate)
    }));
}

async function recordPatientServiceDateChange(entry, options) {
    options = options || {};
    const row = buildHistoryRow(entry || {}, options);
    if (!row || !row.patientId) return null;

    try {
        if (options.includeRxSnapshot !== false) {
            try {
                const metadata = row.metadata && typeof row.metadata === 'object' && !Array.isArray(row.metadata)
                    ? { ...row.metadata }
                    : {};
                metadata.rxServiceSnapshot = await buildRxServiceSnapshot(row, options);
                row.metadata = metadata;
            } catch (err) {
                console.warn('[PatientServiceDateHistory] Could not attach RX snapshot:', err.message);
            }
        }
        const createOptions = options.transaction ? { transaction: options.transaction } : {};
        return await db.PatientServiceDateHistory.create(row, createOptions);
    } catch (err) {
        console.warn('[PatientServiceDateHistory] Could not record change:', err.message);
        return null;
    }
}

async function bulkRecordPatientServiceDateChanges(entries, options) {
    options = options || {};
    const rows = (entries || [])
        .map(entry => buildHistoryRow(entry || {}, options))
        .filter(row => row && row.patientId);

    if (!rows.length) return [];

    try {
        const bulkOptions = options.transaction ? { transaction: options.transaction } : {};
        return await db.PatientServiceDateHistory.bulkCreate(rows, bulkOptions);
    } catch (err) {
        console.warn('[PatientServiceDateHistory] Could not record bulk changes:', err.message);
        return [];
    }
}

module.exports = {
    dateOnly,
    datesEqual,
    attachRelatedRxServiceRecords,
    recordPatientServiceDateChange,
    bulkRecordPatientServiceDateChanges
};
