'use strict';
const db              = require('../models');
const { QueryTypes }  = require('sequelize');
const { captureSnapshot } = require('../services/snapshotService');
const { Op }          = require('sequelize');

// ── GET /api/admin/snapshots  ────────────────────────────────────────────────
exports.getSnapshots = async (req, res) => {
    try {
        const { from, to, limit = 90, offset = 0 } = req.query;
        const where = {};
        if (from || to) {
            where.snapshotDate = {};
            if (from) where.snapshotDate[Op.gte] = from;
            if (to)   where.snapshotDate[Op.lte] = to;
        }
        const rows = await db.DailySnapshot.findAll({
            where,
            order: [['snapshotDate', 'ASC']],
            limit:  Math.min(500, parseInt(limit, 10)),
            offset: parseInt(offset, 10),
        });
        const total = await db.DailySnapshot.count({ where });

        // Also send the very latest snapshot for KPI cards
        const latest = await db.DailySnapshot.findOne({ order: [['snapshotDate', 'DESC']] });
        const prev   = latest ? await db.DailySnapshot.findOne({
            where: { snapshotDate: { [Op.lt]: latest.snapshotDate } },
            order: [['snapshotDate', 'DESC']],
        }) : null;

        res.json({ rows, total, latest, prev });
    } catch (e) { res.status(500).json({ error: e.message }); }
};

// ── POST /api/admin/snapshots/capture  ──────────────────────────────────────
exports.captureNow = async (req, res) => {
    try {
        const { date } = req.body;  // optional — defaults to today
        const snap = await captureSnapshot(date);
        res.json({ success: true, snapshot: snap });
    } catch (e) { res.status(500).json({ error: e.message }); }
};

// ── GET /api/admin/snapshots/export  ────────────────────────────────────────
exports.exportCSV = async (req, res) => {
    try {
        const { from, to } = req.query;
        const filename = `daily-snapshots-${from || 'all'}-to-${to || 'today'}.csv`;
        const where = {};
        if (from || to) {
            where.snapshotDate = {};
            if (from) where.snapshotDate[Op.gte] = from;
            if (to)   where.snapshotDate[Op.lte] = to;
        }
        const rows = await db.DailySnapshot.findAll({
            where,
            order: [['snapshotDate', 'ASC']],
            raw: true,
        });
        const cols = Object.keys(db.DailySnapshot.rawAttributes).filter(c => c !== 'id' && c !== 'createdAt' && c !== 'updatedAt');
        const header = cols.join(',');
        const escapeCsv = function(v) {
            if (v === null || v === undefined) return '';
            const s = String(v);
            if (/[",\r\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
            return s;
        };
        const lines = rows.map(r => cols.map(c => escapeCsv(r[c])).join(','));
        const csv = ['\uFEFF' + header, ...lines].join('\r\n');

        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.setHeader('Content-Length', Buffer.byteLength(csv, 'utf8'));
        res.send(csv);
    } catch (e) { res.status(500).json({ error: e.message }); }
};

// ── DELETE /api/admin/snapshots/:date  ──────────────────────────────────────
exports.deleteSnapshot = async (req, res) => {
    try {
        const deleted = await db.DailySnapshot.destroy({ where: { snapshotDate: req.params.date } });
        if (!deleted) return res.status(404).json({ error: 'Snapshot not found.' });
        res.json({ success: true, deleted });
    } catch (e) { res.status(500).json({ error: e.message }); }
};
