'use strict';
const db = require('../models');
const { Op } = require('sequelize');

// POST /api/errors  — called by frontend boundary
exports.logFrontend = async (req, res) => {
    try {
        const { message, stack, url, severity = 'error' } = req.body;
        await db.ErrorLog.create({
            source:    'frontend',
            severity,
            message:   message || 'Unknown error',
            stack:     stack   || null,
            url:       url     || req.headers.referer || null,
            userAgent: req.headers['user-agent'] || null,
            userId:    req.user ? req.user.id : null,
            ipAddress: req.ip
        });
        res.json({ ok: true });
    } catch (e) {
        res.status(500).json({ error: 'Failed to log error' });
    }
};

// GET /api/errors  — admin view
exports.getAll = async (req, res) => {
    try {
        const { source, severity, resolved, limit = 500 } = req.query;
        const where = {};
        if (source)   where.source   = source;
        if (severity) where.severity = severity;
        if (resolved !== undefined) where.resolved = resolved === 'true';

        const errors = await db.ErrorLog.findAll({
            where,
            include: [{ model: db.User, as: 'User', attributes: ['id','username','firstName','lastName'] }],
            order: [['createdAt', 'DESC']],
            limit: parseInt(limit)
        });
        res.json(errors);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
};

// PATCH /api/errors/:id/resolve  — resolve single
exports.resolve = async (req, res) => {
    try {
        const err = await db.ErrorLog.findByPk(req.params.id);
        if (!err) return res.status(404).json({ error: 'Not found' });
        await err.update({ resolved: true });
        res.json({ ok: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
};

// PATCH /api/errors/bulk-resolve  — resolve selected IDs
exports.bulkResolve = async (req, res) => {
    try {
        const { ids } = req.body;
        if (!ids || !ids.length) return res.status(400).json({ error: 'No IDs provided' });
        await db.ErrorLog.update({ resolved: true }, { where: { id: { [Op.in]: ids } } });
        res.json({ ok: true, count: ids.length });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
};

// DELETE /api/errors/bulk-delete  — delete selected IDs
exports.bulkDelete = async (req, res) => {
    try {
        const { ids } = req.body;
        if (!ids || !ids.length) return res.status(400).json({ error: 'No IDs provided' });
        const count = await db.ErrorLog.destroy({ where: { id: { [Op.in]: ids } } });
        res.json({ ok: true, count });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
};

// DELETE /api/errors  — clear resolved
exports.clearResolved = async (req, res) => {
    try {
        await db.ErrorLog.destroy({ where: { resolved: true } });
        res.json({ ok: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
};

// Internal: log a backend error (called from Express error middleware)
exports.logBackend = async ({ message, stack, url, userId, ipAddress, severity = 'error' }) => {
    try {
        await db.ErrorLog.create({ source: 'backend', severity, message, stack, url, userId, ipAddress });
    } catch {}   // never throw from error logger
};
