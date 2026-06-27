'use strict';

const db = require('../models');
const { Op } = require('sequelize');

function parseLimit(rawLimit, exportAll) {
    if (exportAll) return null;
    const parsed = parseInt(rawLimit || '100', 10);
    if (!Number.isFinite(parsed) || parsed <= 0) return 100;
    return Math.min(parsed, 2000);
}

function buildWhere(query) {
    const {
        userId,
        username,
        role,
        pagePath,
        pageTitle,
        statusCode,
        ipAddress,
        browser,
        dateFrom,
        dateTo,
        search
    } = query;

    const where = {};
    if (userId) where.userId = userId;
    if (username) where.usernameSnapshot = { [Op.like]: `%${username}%` };
    if (role) where.roleSnapshot = role;
    if (pagePath) where.pagePath = pagePath;
    if (pageTitle) where.pageTitle = { [Op.like]: `%${pageTitle}%` };
    if (statusCode) {
        const parsedStatus = parseInt(statusCode, 10);
        if (Number.isFinite(parsedStatus)) where.statusCode = parsedStatus;
    }
    if (ipAddress) where.ipAddress = { [Op.like]: `%${ipAddress}%` };
    if (browser) where.userAgent = { [Op.like]: `%${browser}%` };
    if (dateFrom || dateTo) {
        where.visitedAt = {};
        if (dateFrom) where.visitedAt[Op.gte] = new Date(dateFrom + 'T00:00:00');
        if (dateTo) where.visitedAt[Op.lte] = new Date(dateTo + 'T23:59:59');
    }
    if (search) {
        where[Op.or] = [
            { usernameSnapshot: { [Op.like]: `%${search}%` } },
            { roleSnapshot: { [Op.like]: `%${search}%` } },
            { pagePath: { [Op.like]: `%${search}%` } },
            { pageTitle: { [Op.like]: `%${search}%` } },
            { ipAddress: { [Op.like]: `%${search}%` } },
            { userAgent: { [Op.like]: `%${search}%` } },
            { referrer: { [Op.like]: `%${search}%` } }
        ];
    }

    return where;
}

exports.getAll = async (req, res) => {
    try {
        res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
        res.set('Pragma', 'no-cache');

        const exportAll = req.query.exportAll === 'true';
        const limit = parseLimit(req.query.limit, exportAll);
        const offset = Math.max(parseInt(req.query.offset || '0', 10) || 0, 0);
        const where = buildWhere(req.query);

        const queryOptions = {
            where,
            order: [['visitedAt', 'DESC'], ['id', 'DESC']],
            include: [{ model: db.User, attributes: ['firstName', 'lastName', 'username'], required: false }]
        };
        if (limit !== null) {
            queryOptions.limit = limit;
            queryOptions.offset = offset;
        }

        const [total, data] = await Promise.all([
            db.UserActivityLog.count({ where }),
            db.UserActivityLog.findAll(queryOptions)
        ]);

        res.json({ data, total });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

exports.getUsers = async (req, res) => {
    try {
        const rows = await db.UserActivityLog.findAll({
            attributes: [
                [db.sequelize.fn('DISTINCT', db.sequelize.col('usernameSnapshot')), 'username']
            ],
            where: { usernameSnapshot: { [Op.ne]: null } },
            raw: true
        });
        res.json(rows.map(row => row.username).filter(Boolean).sort());
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

exports.getRoles = async (req, res) => {
    try {
        const rows = await db.UserActivityLog.findAll({
            attributes: [
                [db.sequelize.fn('DISTINCT', db.sequelize.col('roleSnapshot')), 'role']
            ],
            where: { roleSnapshot: { [Op.ne]: null } },
            raw: true
        });
        res.json(rows.map(row => row.role).filter(Boolean).sort());
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

exports.getPages = async (req, res) => {
    try {
        const rows = await db.UserActivityLog.findAll({
            attributes: [
                'pagePath',
                [db.sequelize.fn('MAX', db.sequelize.col('pageTitle')), 'pageTitle']
            ],
            where: { pagePath: { [Op.ne]: null } },
            group: ['pagePath'],
            raw: true
        });
        res.json(rows
            .filter(row => row.pagePath)
            .sort((left, right) => String(left.pageTitle || left.pagePath).localeCompare(String(right.pageTitle || right.pagePath))));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};
