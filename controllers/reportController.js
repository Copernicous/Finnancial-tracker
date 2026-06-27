const db = require('../models');

exports.getPatientReport = async (req, res) => {
    try {
        // BUG-12 FIX: Exclude soft-deleted patients from reports
        const patients = await db.Patient.findAll({
            where: { isDeleted: false },
            include: [db.PatientTransportCompany, db.PharmacyTransportCompany, db.Clinic]
        });
        res.json(patients);
    } catch (err) { res.status(500).json({ error: err.message }); }
};

exports.getRXReceiptReport = async (req, res) => {
    try {
        const rxRecords = await db.RXRecord.findAll({
            where: { isDeleted: false },
            include: [
                db.Patient,
                db.Pharmacy,
                { model: db.RXWorkflowTracking, include: [db.WorkflowAction] }
            ]
        });
        res.json(rxRecords);
    } catch (err) { res.status(500).json({ error: err.message }); }
};

exports.getRXActionReport = async (req, res) => {
    try {
        const rxRecords = await db.RXRecord.findAll({
            where: { isDeleted: false },
            include: [
                db.Patient,
                db.Pharmacy,
                { model: db.RXWorkflowTracking, include: [db.WorkflowAction] }
            ]
        });
        res.json(rxRecords);
    } catch (err) { res.status(500).json({ error: err.message }); }
};
