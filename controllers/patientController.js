const db = require('../models');
const { Op } = require('sequelize');
const { parseDate } = require('../utils/dateUtils');
const { isServiceDateOverrideEnabled } = require('../utils/globalSettings');
const { getRequestPermission } = require('../middleware/rbac');
const {
    attachRelatedRxServiceRecords,
    recordPatientServiceDateChange
} = require('../services/patientServiceDateHistoryService');
const {
    buildPatientContextSnapshot,
    syncPatientServiceDateCycles
} = require('../services/patientServiceDateCycleService');

function toUpperName(value) {
    return String(value || '').trim().toUpperCase();
}

function summarizeServiceDateCycle(cycle) {
    const plain = typeof cycle.toJSON === 'function' ? cycle.toJSON() : cycle;
    const rxRecords = Array.isArray(plain.RXRecords) ? plain.RXRecords : [];
    return {
        id: plain.id,
        patientId: plain.patientId,
        serviceDate: plain.serviceDate,
        status: plain.status,
        startedAt: plain.startedAt,
        endedAt: plain.endedAt,
        metadata: plain.metadata || null,
        rxCount: rxRecords.length,
        rxRecordIds: rxRecords.map(rx => rx.id)
    };
}

function idsEqual(left, right) {
    const clean = value => value === '' || value === undefined || value === null ? null : String(value);
    return clean(left) === clean(right);
}

function patientContextFieldsChanged(patient, payload) {
    return ['clinicId', 'pharmacyId', 'patientTransportCompanyId', 'pharmacyTransportCompanyId']
        .some(field => payload.hasOwnProperty(field) && !idsEqual(payload[field], patient[field]));
}

function patientContextChangedFields(previousContext, nextContext) {
    const comparable = snapshot => ({
        clinic: snapshot && snapshot.clinic ? snapshot.clinic : null,
        defaultPharmacy: snapshot && snapshot.defaultPharmacy ? snapshot.defaultPharmacy : null,
        patientTransport: snapshot && snapshot.patientTransport ? snapshot.patientTransport : null,
        pharmacyTransport: snapshot && snapshot.pharmacyTransport ? snapshot.pharmacyTransport : null
    });
    const previous = comparable(previousContext);
    const next = comparable(nextContext);
    return Object.keys(previous).filter(key => JSON.stringify(previous[key]) !== JSON.stringify(next[key]));
}

async function loadPatientServiceDateCycles(patient, options) {
    options = options || {};
    await syncPatientServiceDateCycles(patient, options);
    const queryOptions = {
        where: { patientId: patient.id },
        include: [{
            model: db.RXRecord,
            attributes: ['id', 'patientServiceDateCycleId', 'serviceDate'],
            where: { [Op.or]: [{ isDeleted: false }, { isDeleted: null }] },
            required: false
        }],
        order: [['serviceDate', 'DESC'], ['id', 'DESC']]
    };
    if (options.transaction) queryOptions.transaction = options.transaction;
    const cycles = await db.PatientServiceDateCycle.findAll(queryOptions);
    return cycles.map(summarizeServiceDateCycle);
}

function isWorkflowCycleNeedsAction(serviceDate, rxRecords, totalWorkflowSteps) {
    if (!serviceDate || !Array.isArray(rxRecords) || totalWorkflowSteps <= 0) {
        return false;
    }

    const svcDay = new Date(serviceDate);
    if (isNaN(svcDay.getTime())) return false;
    svcDay.setHours(0, 0, 0, 0);

    const svcExpiry = new Date(svcDay);
    svcExpiry.setDate(svcExpiry.getDate() + 90);

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    if (today <= svcExpiry) return false;

    return rxRecords.some((rx) => {
        const tracked = Array.isArray(rx.RXWorkflowTrackings) ? rx.RXWorkflowTrackings.length : 0;
        return tracked < totalWorkflowSteps;
    });
}

exports.getAll = async (req, res) => {
    try {
        const whereClause = {};
        const totalWorkflowSteps = await db.WorkflowAction.count({ where: { isActive: true } });
        if (req.query.includeDeleted !== 'true') {
            // LOGIC-03 FIX: Also include rows where isDeleted IS NULL (legacy records before the column existed)
            whereClause[Op.or] = [{ isDeleted: false }, { isDeleted: null }];
        }
        const data = await db.Patient.findAll({
            where: whereClause,
            include: [
                db.PatientTransportCompany,
                db.PharmacyTransportCompany,
                db.Clinic,
                db.Pharmacy,
                // Include PatientNotes with only id so the client can show a note count badge
                // NOTE: alias must differ from the 'notes' text field (case conflict in some JSON parsers)
                { model: db.PatientNote, as: 'PatientNotes', attributes: ['id'] },
                // Include RXRecords with only id (non-deleted) so the client can show RX/History/Timeline count badges
                {
                    model: db.RXRecord,
                    attributes: ['id'],
                    include: [{
                        model: db.RXWorkflowTracking,
                        attributes: ['id']
                    }],
                    where: { [Op.or]: [{ isDeleted: false }, { isDeleted: null }] },
                    required: false   // LEFT JOIN — patients with 0 RX records still appear
                }
            ]
        });
        const rows = data.map((patient) => {
            const plain = patient.toJSON();
            plain.needsAction = isWorkflowCycleNeedsAction(
                plain.serviceDate,
                plain.RXRecords,
                totalWorkflowSteps
            );
            return plain;
        });
        res.json(rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
};

exports.getOne = async (req, res) => {
    try {
        const data = await db.Patient.findByPk(req.params.id, {
            include: [db.PatientTransportCompany, db.PharmacyTransportCompany, db.Clinic, db.RXRecord]
        });
        if (!data) return res.status(404).json({ message: 'Not found' });
        res.json(data);
    } catch (err) { res.status(500).json({ error: err.message }); }
};

exports.create = async (req, res) => {
    try {
        let { patientCode, dob, serviceDate, ...otherData } = req.body;
        otherData.firstName = toUpperName(otherData.firstName);
        otherData.lastName = toUpperName(otherData.lastName);

        if (!otherData.firstName || !otherData.lastName) {
            return res.status(400).json({ error: 'First Name and Last Name are required.' });
        }

        // Normalise dates: accept MM/DD/YYYY, YYYY-MM-DD, or any common format
        const normDob         = parseDate(dob);
        const normServiceDate = parseDate(serviceDate);
        if (dob && !normDob) return res.status(400).json({ error: 'Date of Birth is not a valid date. Use MM/DD/YYYY format.' });
        otherData.dob         = normDob;
        otherData.serviceDate = normServiceDate;

        // Auto-generate patientCode if not provided
        if (!patientCode || !patientCode.trim()) {
            // H1 FIX: Use a retry loop to handle concurrent creates gracefully.
            // Try up to 10 candidate codes based on the current max id.
            const lastPatient = await db.Patient.findOne({ order: [['id', 'DESC']] });
            let baseId = lastPatient ? lastPatient.id : 0;
            let generated = null;
            for (let attempt = 0; attempt < 10; attempt++) {
                const candidate = 'PAT-' + String(baseId + 1 + attempt).padStart(5, '0');
                const exists = await db.Patient.findOne({ where: { patientCode: candidate } });
                if (!exists) { generated = candidate; break; }
            }
            if (!generated) {
                return res.status(500).json({ error: 'Could not generate a unique Patient ID. Please provide one manually.' });
            }
            patientCode = generated;
        } else {
            patientCode = patientCode.trim();
        }

        // Validate uniqueness of provided patientCode
        const existingCode = await db.Patient.findOne({ where: { patientCode } });
        if (existingCode) {
            return res.status(400).json({ error: `Patient ID "${patientCode}" is already assigned to another patient.` });
        }

        const data = await db.Patient.create({ ...otherData, patientCode });
        await syncPatientServiceDateCycles(data, {
            userId: req.user?.id || null,
            source: 'Patient Create',
            contextChangeReason: 'Initial patient clinic/pharmacy/transport defaults captured.'
        });
        const newPatientContext = await buildPatientContextSnapshot(data, {
            source: 'Patient Create'
        });
        await recordPatientServiceDateChange({
            patientId: data.id,
            previousServiceDate: null,
            newServiceDate: data.serviceDate,
            userId: req.user?.id || null,
            changeSource: 'Patient Create',
            reason: 'Patient created with initial service date.',
            metadata: {
                patientContextChange: {
                    previous: null,
                    next: newPatientContext,
                    changedFields: patientContextChangedFields(null, newPatientContext)
                }
            }
        });
        res.status(201).json(data);
    } catch (err) {
        // H1 FIX: Catch DB-level unique constraint violation (race condition fallback)
        if (err.name === 'SequelizeUniqueConstraintError') {
            return res.status(400).json({ error: 'Patient ID conflict — another record was just created with the same code. Please retry.' });
        }
        res.status(400).json({ error: err.message });
    }
};

exports.update = async (req, res) => {
    try {
        const patient = await db.Patient.findByPk(req.params.id);
        if (!patient) return res.status(404).json({ message: 'Not found' });
        const previousServiceDate = patient.serviceDate;
        const previousPatientContext = await buildPatientContextSnapshot(patient, {
            source: 'Before Patient Update'
        });

        // Normalise incoming dates (accept MM/DD/YYYY or YYYY-MM-DD)
        if (req.body.hasOwnProperty('dob')) {
            const norm = parseDate(req.body.dob);
            if (req.body.dob && !norm) return res.status(400).json({ error: 'Date of Birth is not a valid date. Use MM/DD/YYYY format.' });
            req.body.dob = norm;
        }
        if (req.body.hasOwnProperty('firstName')) {
            req.body.firstName = toUpperName(req.body.firstName);
        }
        if (req.body.hasOwnProperty('lastName')) {
            req.body.lastName = toUpperName(req.body.lastName);
        }
        if (req.body.hasOwnProperty('serviceDate')) {
            const norm = parseDate(req.body.serviceDate);
            if (req.body.serviceDate && !norm) return res.status(400).json({ error: 'Service Date is not valid. Use MM/DD/YYYY format.' });
            req.body.serviceDate = norm || null;
        }

        const patientPerm = await getRequestPermission(req, 'patients');
        const canEditPatient = !!(patientPerm.visible && patientPerm.canEdit);
        const canOverrideExpired = !!(patientPerm.visible && patientPerm.canOverrideExpired);

        if (!canEditPatient && !canOverrideExpired) {
            return res.status(403).json({ error: 'Access denied: you cannot edit patient records.' });
        }

        if (!canEditPatient && canOverrideExpired) {
            Object.keys(req.body).forEach((field) => {
                if (field !== 'serviceDate') delete req.body[field];
            });
        }

        // Validate uniqueness of updated patientCode if provided and changed
        if (req.body.patientCode && req.body.patientCode.trim() !== patient.patientCode) {
            const newCode = req.body.patientCode.trim();
            const existingCode = await db.Patient.findOne({
                where: {
                    patientCode: newCode,
                    id: { [Op.ne]: req.params.id }
                }
            });
            if (existingCode) {
                return res.status(400).json({ error: `Patient ID "${newCode}" is already assigned to another patient.` });
            }
            req.body.patientCode = newCode;
        }

        // Check if service date is being updated (90-day rule)
        const hasServiceDateChange = req.body.hasOwnProperty('serviceDate')
            && String(req.body.serviceDate || '') !== String(patient.serviceDate || '');
        const hasPatientContextChange = patientContextFieldsChanged(patient, req.body);
        if (!isServiceDateOverrideEnabled() && !canOverrideExpired && hasServiceDateChange) {
            if (patient.serviceDate) {
                const prevDate = new Date(patient.serviceDate);
                const currentDate = new Date();
                prevDate.setHours(0, 0, 0, 0);
                currentDate.setHours(0, 0, 0, 0);

                const windowExpiry = new Date(prevDate);
                windowExpiry.setDate(windowExpiry.getDate() + 90);

                if (currentDate <= windowExpiry) {
                    const daysRemaining = Math.ceil((windowExpiry.getTime() - currentDate.getTime()) / (1000 * 3600 * 24));
                    return res.status(400).json({
                        error: `A new Service Date can only be assigned after the active 90-day window expires on ${windowExpiry.toLocaleDateString()}. ${daysRemaining} day${daysRemaining !== 1 ? 's' : ''} remaining.`
                    });
                }
            }
        }

        // Use instance-level set()+save() instead of class-level update() to reliably
        // persist all fields including foreign key columns (pharmacyId, clinicId, etc.)
        const allowedFields = [
            'firstName', 'lastName', 'dob', 'address', 'phone',
            'serviceDate', 'notes', 'isActive', 'patientCode',
            'patientTransportCompanyId', 'pharmacyTransportCompanyId',
            'clinicId', 'pharmacyId', 'isDeleted'
        ];
        allowedFields.forEach(field => {
            if (req.body.hasOwnProperty(field)) {
                // Convert empty string FK values to null
                const val = req.body[field];
                patient[field] = (val === '' || val === undefined) ? null : val;
            }
        });
        await patient.save();

        if (hasServiceDateChange || hasPatientContextChange) {
            await syncPatientServiceDateCycles(patient, {
                userId: req.user?.id || null,
                source: (!canEditPatient && canOverrideExpired) ? 'Patient Override' : 'Patient Update',
                previousPatientContext,
                contextChangeReason: hasServiceDateChange
                    ? 'Patient service date changed; clinic/pharmacy/transport defaults captured for the active cycle.'
                    : 'Patient clinic/pharmacy/transport defaults changed during this service date cycle.'
            });
        }

        if (hasServiceDateChange) {
            const nextPatientContext = await buildPatientContextSnapshot(patient, {
                source: (!canEditPatient && canOverrideExpired) ? 'Patient Override' : 'Patient Update'
            });
            await recordPatientServiceDateChange({
                patientId: patient.id,
                previousServiceDate,
                newServiceDate: patient.serviceDate,
                userId: req.user?.id || null,
                changeSource: (!canEditPatient && canOverrideExpired) ? 'Patient Override' : 'Patient Update',
                reason: 'Patient record service date changed.',
                metadata: {
                    patientContextChange: {
                        previous: previousPatientContext,
                        next: nextPatientContext,
                        changedFields: patientContextChangedFields(previousPatientContext, nextPatientContext)
                    }
                }
            });
        }

        // Cascade: if isActive was explicitly changed, sync RX records accordingly
        if (req.body.hasOwnProperty('isActive')) {
            const active = req.body.isActive === true || req.body.isActive === 'true';
            if (!active) {
                // Patient deactivated → soft-delete all active RX records
                const count = await db.RXRecord.update(
                    { isDeleted: true, deletedAt: new Date() },
                    { where: { patientId: req.params.id, isDeleted: false } }
                );
                console.log(`[Patient Deactivate] Patient #${req.params.id} — ${count[0]} RX record(s) hidden.`);
            } else {
                // Patient re-activated → restore all soft-deleted RX records
                const count = await db.RXRecord.update(
                    { isDeleted: false, deletedAt: null },
                    { where: { patientId: req.params.id, isDeleted: true } }
                );
                console.log(`[Patient Activate] Patient #${req.params.id} — ${count[0]} RX record(s) restored.`);
            }
        }

        const updatedPatient = await db.Patient.findByPk(req.params.id, {
            include: [db.PatientTransportCompany, db.PharmacyTransportCompany, db.Clinic, db.Pharmacy]
        });
        res.json(updatedPatient);
    } catch (err) { res.status(400).json({ error: err.message }); }
};

exports.delete = async (req, res) => {
    try {
        const patient = await db.Patient.findByPk(req.params.id);
        if (!patient) return res.status(404).json({ message: 'Not found' });

        // Soft-delete the patient
        await patient.update({ isDeleted: true });

        // Cascade: soft-delete all RX records belonging to this patient
        const cascadeCount = await db.RXRecord.update(
            { isDeleted: true, deletedAt: new Date() },
            { where: { patientId: req.params.id, isDeleted: false } }
        );
        console.log(`[Patient Delete] Patient #${req.params.id} — ${cascadeCount[0]} RX record(s) soft-deleted.`);

        // Use res.json() (not res.send()) so auditLogger middleware can intercept and log the delete action
        res.json({ ok: true, message: 'Patient deleted', id: parseInt(req.params.id) });
    } catch (err) { res.status(500).json({ error: err.message }); }
};

exports.restore = async (req, res) => {
    try {
        const patient = await db.Patient.findByPk(req.params.id);
        if (!patient) return res.status(404).json({ message: 'Not found' });

        // Restore the patient
        await patient.update({ isDeleted: false });

        // Cascade: restore all RX records that were deleted along with this patient
        const cascadeCount = await db.RXRecord.update(
            { isDeleted: false, deletedAt: null },
            { where: { patientId: req.params.id, isDeleted: true } }
        );
        console.log(`[Patient Restore] Patient #${req.params.id} — ${cascadeCount[0]} RX record(s) restored.`);

        res.status(200).json({ message: 'Restored successfully' });
    } catch (err) { res.status(500).json({ error: err.message }); }
};

// Check for duplicate patients by firstName + lastName + dob
exports.checkDuplicate = async (req, res) => {
    try {
        const { firstName, lastName, dob } = req.query;
        if (!firstName || !lastName || !dob) {
            return res.json({ duplicates: [] });
        }
        const normalizedFirstName = toUpperName(firstName);
        const normalizedLastName = toUpperName(lastName);
        const normalizedDob = parseDate(dob);
        if (!normalizedFirstName || !normalizedLastName || !normalizedDob) {
            return res.json({ duplicates: [] });
        }
        const duplicates = await db.Patient.findAll({
            where: {
                firstName: normalizedFirstName,
                lastName:  normalizedLastName,
                dob:       normalizedDob
            },
            attributes: ['id', 'patientCode', 'firstName', 'lastName', 'dob', 'phone', 'isActive', 'isDeleted']
        });
        res.json({ duplicates });
    } catch (err) { res.status(500).json({ error: err.message }); }
};

// GET /api/patients/:id/service-date-history
exports.getServiceDateHistory = async (req, res) => {
    try {
        const patient = await db.Patient.findByPk(req.params.id, { attributes: ['id'] });
        if (!patient) return res.status(404).json({ message: 'Patient not found' });

        const history = await db.PatientServiceDateHistory.findAll({
            where: { patientId: req.params.id },
            include: [{
                model: db.User,
                as: 'ChangedBy',
                attributes: ['firstName', 'lastName', 'username']
            }],
            order: [['createdAt', 'DESC'], ['id', 'DESC']]
        });

        res.json(await attachRelatedRxServiceRecords(history));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

// GET /api/patients/:id/timeline
exports.getTimeline = async (req, res) => {
    try {
        const patient = await db.Patient.findByPk(req.params.id, {
            include: [db.PatientTransportCompany, db.PharmacyTransportCompany, db.Clinic, db.Pharmacy]
        });
        if (!patient) return res.status(404).json({ message: 'Patient not found' });

        const serviceDateCycles = await loadPatientServiceDateCycles(patient, {
            userId: req.user?.id || null,
            source: 'Timeline Review'
        });

        const rxRecords = await db.RXRecord.findAll({
            // LOGIC-02 FIX: Exclude soft-deleted RX records from the timeline
            where: { patientId: req.params.id, isDeleted: false },
            include: [
                { model: db.PatientServiceDateCycle },
                { model: db.Pharmacy },
                { model: db.PatientTransportCompany },
                { model: db.PharmacyTransportCompany },
                { model: db.Medication },
                {
                    model: db.RXWorkflowTracking,
                    include: [
                        { model: db.WorkflowAction },
                        { model: db.User, attributes: ['firstName', 'lastName', 'username'] }
                    ]
                }
            ],
            order: [['serviceDate', 'DESC'], ['id', 'DESC']]
        });

        const allWorkflowActions = await db.WorkflowAction.findAll({
            order: [['sequenceNumber', 'ASC']]
        });

        const serviceDateHistory = await db.PatientServiceDateHistory.findAll({
            where: { patientId: req.params.id },
            include: [{
                model: db.User,
                as: 'ChangedBy',
                attributes: ['firstName', 'lastName', 'username']
            }],
            order: [['createdAt', 'DESC'], ['id', 'DESC']]
        });

        const enrichedServiceDateHistory = await attachRelatedRxServiceRecords(serviceDateHistory);

        res.json({
            patient: patient.toJSON(),
            rxRecords: rxRecords.map(rx => {
                const plain = rx.toJSON();
                plain.completedSteps = (plain.RXWorkflowTrackings || []).map(t => t.workflowActionId);
                return plain;
            }),
            workflowActions: allWorkflowActions.map(a => a.toJSON()),
            serviceDateHistory: enrichedServiceDateHistory,
            serviceDateCycles
        });
    } catch (err) { res.status(500).json({ error: err.message }); }
};
