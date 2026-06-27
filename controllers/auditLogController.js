const db = require('../models');
const { Op } = require('sequelize');

// GET /api/audit-logs — with optional filters
exports.getAll = async (req, res) => {
    try {
        // Prevent browser caching so we never get a 304 with empty body
        res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
        res.set('Pragma', 'no-cache');

        const { userId, module, action, dateFrom, dateTo, search, limit = 1000, offset = 0, exportAll } = req.query;

        const where = {};
        if (userId)   where.userId  = userId;
        if (module)   where.module  = { [Op.like]: `%${module}%` };
        if (action)   where.action  = { [Op.like]: `%${action}%` };
        if (dateFrom || dateTo) {
            where.createdAt = {};
            if (dateFrom) where.createdAt[Op.gte] = new Date(dateFrom + 'T00:00:00');
            if (dateTo)   where.createdAt[Op.lte] = new Date(dateTo   + 'T23:59:59');
        }
        if (search) {
            where[Op.or] = [
                { module: { [Op.like]: `%${search}%` } },
                { action: { [Op.like]: `%${search}%` } },
                { ipAddress: { [Op.like]: `%${search}%` } }
            ];
        }

        const total = await db.AuditLog.count({ where });

        // exportAll=true → return every matching record (no limit)
        const queryOptions = {
            where,
            order: [['createdAt', 'DESC']],
            include: [{ model: db.User, attributes: ['firstName', 'lastName', 'username'], required: false }]
        };
        if (!exportAll) {
            queryOptions.limit  = Math.min(parseInt(limit), 2000);
            queryOptions.offset = parseInt(offset);
        }

        const data = await db.AuditLog.findAll(queryOptions);
        res.json({ data, total });
    } catch (err) { res.status(500).json({ error: err.message }); }
};

// GET /api/audit-logs/users — distinct users who have log entries
exports.getUsers = async (req, res) => {
    try {
        const rows = await db.AuditLog.findAll({
            attributes: [[db.sequelize.fn('DISTINCT', db.sequelize.col('userId')), 'userId']],
            where: { userId: { [Op.ne]: null } },
            raw: true
        });
        const ids = rows.map(r => r.userId).filter(Boolean);
        const users = await db.User.findAll({
            where: { id: ids },
            attributes: ['id', 'firstName', 'lastName', 'username']
        });
        res.json(users);
    } catch (err) { res.status(500).json({ error: err.message }); }
};

// GET /api/audit-logs/modules — distinct modules
exports.getModules = async (req, res) => {
    try {
        const rows = await db.AuditLog.findAll({
            attributes: [[db.sequelize.fn('DISTINCT', db.sequelize.col('module')), 'module']],
            raw: true
        });
        res.json(rows.map(r => r.module).filter(Boolean).sort());
    } catch (err) { res.status(500).json({ error: err.message }); }
};

// GET /api/audit-logs/actions — distinct actions
exports.getActions = async (req, res) => {
    try {
        const rows = await db.AuditLog.findAll({
            attributes: [[db.sequelize.fn('DISTINCT', db.sequelize.col('action')), 'action']],
            raw: true
        });
        res.json(rows.map(r => r.action).filter(Boolean).sort());
    } catch (err) { res.status(500).json({ error: err.message }); }
};


// DELETE /api/audit-logs/:id — delete single log (Admin only)
exports.deleteOne = async (req, res) => {
    try {
        const deleted = await db.AuditLog.destroy({ where: { id: req.params.id } });
        if (!deleted) return res.status(404).json({ message: 'Log entry not found' });
        res.status(200).json({ message: 'Log entry deleted.' });
    } catch (err) { res.status(500).json({ error: err.message }); }
};

// DELETE /api/audit-logs/bulk — delete by filter (Admin only)
exports.bulkDelete = async (req, res) => {
    try {
        const { ids, beforeDate, module, userId } = req.body;
        const where = {};
        if (ids && ids.length) {
            where.id = { [Op.in]: ids };
        } else {
            if (beforeDate) where.createdAt = { [Op.lt]: new Date(beforeDate + 'T00:00:00') };
            if (module)     where.module    = module;
            if (userId)     where.userId    = userId;
        }
        if (Object.keys(where).length === 0) {
            return res.status(400).json({ error: 'No filter provided for bulk delete.' });
        }
        const count = await db.AuditLog.destroy({ where });
        res.status(200).json({ message: `${count} log entry/entries deleted.`, count });
    } catch (err) { res.status(500).json({ error: err.message }); }
};

// POST /api/audit-logs/rotate — delete entries older than N days (Admin only)
exports.rotate = async (req, res) => {
    try {
        const { days = 90 } = req.body;
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - parseInt(days));
        const count = await db.AuditLog.destroy({ where: { createdAt: { [Op.lt]: cutoff } } });
        res.status(200).json({ message: `Log rotation complete. ${count} entries older than ${days} days removed.`, count });
    } catch (err) { res.status(500).json({ error: err.message }); }
};
