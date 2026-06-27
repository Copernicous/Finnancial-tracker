'use strict';

const db = require('../models');
const storage = require('../services/documentStorageService');
const { getRequestPermission } = require('../middleware/rbac');

function serializeAttachment(row) {
    const doc = row.toJSON ? row.toJSON() : row;
    const uploader = doc.UploadedBy ? {
        id: doc.UploadedBy.id,
        username: doc.UploadedBy.username,
        name: [doc.UploadedBy.firstName, doc.UploadedBy.lastName].filter(Boolean).join(' ').trim()
    } : null;

    return {
        id: doc.id,
        ownerType: doc.ownerType,
        patientId: doc.patientId,
        rxRecordId: doc.rxRecordId,
        originalName: doc.originalName,
        storedName: doc.storedName,
        mimeType: doc.mimeType,
        sizeBytes: Number(doc.sizeBytes || 0),
        provider: doc.provider,
        driveWebViewLink: doc.driveWebViewLink,
        uploadedBy: uploader,
        createdAt: doc.createdAt,
        updatedAt: doc.updatedAt,
        downloadUrl: '/api/documents/' + doc.id + '/download'
    };
}

function listInclude() {
    return [{
        model: db.User,
        as: 'UploadedBy',
        attributes: ['id', 'username', 'firstName', 'lastName']
    }];
}

async function ensureOwner(ownerType, ownerId) {
    if (ownerType === 'patient') {
        const patient = await db.Patient.findByPk(ownerId);
        if (!patient) {
            const err = new Error('Patient not found.');
            err.status = 404;
            throw err;
        }
        return patient;
    }

    if (ownerType === 'rx-record') {
        const rx = await db.RXRecord.findByPk(ownerId, {
            include: [{ model: db.Patient }]
        });
        if (!rx) {
            const err = new Error('RX record not found.');
            err.status = 404;
            throw err;
        }
        return rx;
    }

    const err = new Error('Unsupported document owner.');
    err.status = 400;
    throw err;
}

function ownerWhere(ownerType, ownerId) {
    if (ownerType === 'patient') {
        return { ownerType: 'patient', patientId: ownerId, isDeleted: false };
    }
    return { ownerType: 'rx-record', rxRecordId: ownerId, isDeleted: false };
}

async function canAccessAttachment(req, attachment, action) {
    const moduleKey = attachment.rxRecordId ? 'rx_records' : 'patients';
    const perm = await getRequestPermission(req, moduleKey);
    if (!perm.visible) return false;
    if (action === 'read') return true;
    if (action === 'delete') return !!perm.canDelete;
    return !!(perm.canAdd || perm.canEdit);
}

async function listForOwner(req, res, ownerType, ownerId) {
    try {
        await ensureOwner(ownerType, ownerId);
        const rows = await db.DocumentAttachment.findAll({
            where: ownerWhere(ownerType, ownerId),
            include: listInclude(),
            order: [['createdAt', 'DESC']]
        });
        res.json(rows.map(serializeAttachment));
    } catch (err) {
        res.status(err.status || 500).json({ error: err.message });
    }
}

async function uploadForOwner(req, res, ownerType, ownerId) {
    try {
        const owner = await ensureOwner(ownerType, ownerId);
        const files = Array.isArray(req.files) ? req.files : [];
        if (!files.length) return res.status(400).json({ error: 'Choose at least one picture or document.' });

        const saved = [];
        for (const file of files) {
            const stored = await storage.upload(file, ownerType, ownerId, owner);
            const row = await db.DocumentAttachment.create({
                ownerType,
                patientId: ownerType === 'patient' ? ownerId : null,
                rxRecordId: ownerType === 'rx-record' ? ownerId : null,
                originalName: file.originalname || stored.storedName,
                storedName: stored.storedName,
                mimeType: file.mimetype || 'application/octet-stream',
                sizeBytes: file.size || 0,
                provider: stored.provider,
                driveFileId: stored.driveFileId,
                driveWebViewLink: stored.driveWebViewLink,
                localPath: stored.localPath,
                uploadedByUserId: req.user ? req.user.id : null
            });
            saved.push(row);
        }

        const ids = saved.map((row) => row.id);
        const rows = await db.DocumentAttachment.findAll({
            where: { id: ids },
            include: listInclude(),
            order: [['createdAt', 'DESC']]
        });
        res.status(201).json(rows.map(serializeAttachment));
    } catch (err) {
        res.status(err.status || 500).json({ error: err.message });
    }
}

exports.listPatientDocuments = async (req, res) => {
    await listForOwner(req, res, 'patient', parseInt(req.params.id, 10));
};

exports.uploadPatientDocuments = async (req, res) => {
    await uploadForOwner(req, res, 'patient', parseInt(req.params.id, 10));
};

exports.listRxDocuments = async (req, res) => {
    await listForOwner(req, res, 'rx-record', parseInt(req.params.id, 10));
};

exports.uploadRxDocuments = async (req, res) => {
    await uploadForOwner(req, res, 'rx-record', parseInt(req.params.id, 10));
};

exports.downloadDocument = async (req, res) => {
    try {
        const attachment = await db.DocumentAttachment.findOne({
            where: { id: req.params.id, isDeleted: false }
        });
        if (!attachment) return res.status(404).json({ error: 'Document not found.' });
        if (!await canAccessAttachment(req, attachment, 'read')) {
            return res.status(403).json({ error: 'Access denied.' });
        }

        const stream = await storage.openReadStream(attachment);
        res.setHeader('Content-Type', attachment.mimeType || 'application/octet-stream');
        const safeDownloadName = String(attachment.originalName || attachment.storedName).replace(/["\r\n]/g, '');
        res.setHeader('Content-Disposition', 'inline; filename="' + safeDownloadName + '"');
        stream.on('error', (err) => {
            if (!res.headersSent) res.status(500).json({ error: err.message });
            else res.destroy(err);
        });
        stream.pipe(res);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

exports.deleteDocument = async (req, res) => {
    try {
        const attachment = await db.DocumentAttachment.findOne({
            where: { id: req.params.id, isDeleted: false }
        });
        if (!attachment) return res.status(404).json({ error: 'Document not found.' });
        if (!await canAccessAttachment(req, attachment, 'delete')) {
            return res.status(403).json({ error: 'Access denied.' });
        }

        try {
            await storage.deleteStoredFile(attachment);
        } catch (err) {
            console.warn('[documents] Could not remove stored file:', err.message);
        }

        await attachment.update({ isDeleted: true, deletedAt: new Date() });
        res.status(204).end();
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};
