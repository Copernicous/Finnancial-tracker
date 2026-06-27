/**
 * patientLockController.js
 *
 * Manages soft-locks on patient records.
 * A "lock" is just a record saying "user X is currently viewing patient Y".
 * It does NOT block editing — it only provides a warning to other users.
 *
 * Lock TTL: 5 minutes (300 seconds). The client sends a heartbeat every 60s.
 * If the tab/browser closes, the lock expires naturally after 5 minutes.
 *
 * Note: navigator.sendBeacon sends a DELETE with content-type text/plain,
 * so the release endpoint also accepts POST (for sendBeacon compatibility
 * via a dedicated /release route).
 *
 * Endpoints:
 *   POST   /api/patient-locks/:patientId/acquire    — open a patient page
 *   POST   /api/patient-locks/:patientId/heartbeat  — renew while editing
 *   POST   /api/patient-locks/:patientId/release    — release (sendBeacon)
 *   DELETE /api/patient-locks/:patientId/release    — release (fetch DELETE)
 *   GET    /api/patient-locks/:patientId            — check who else is viewing
 */

const db  = require('../models');
const { Op } = require('sequelize');

const LOCK_TTL_MS = 5 * 60 * 1000;   // 5 minutes

function makeExpiresAt() {
    return new Date(Date.now() + LOCK_TTL_MS);
}

// ── Acquire or refresh a lock ─────────────────────────────────────────────────
exports.acquire = async (req, res) => {
    try {
        const patientId = parseInt(req.params.patientId, 10);
        const userId    = req.user.id;

        // Upsert: findOrCreate returns [instance, wasCreated]
        const [lock, created] = await db.PatientLock.findOrCreate({
            where:    { patientId, userId },
            defaults: { lockedAt: new Date(), expiresAt: makeExpiresAt() }
        });

        if (!created) {
            // Existing lock — renew the expiry
            lock.expiresAt = makeExpiresAt();
            await lock.save();
        }

        const others = await _getOtherViewers(patientId, userId);
        res.json({ ok: true, others });
    } catch (e) {
        console.error('[patientLock.acquire]', e.message);
        res.status(500).json({ error: e.message });
    }
};

// ── Heartbeat — renew a lock every 60s ───────────────────────────────────────
exports.heartbeat = async (req, res) => {
    try {
        const patientId = parseInt(req.params.patientId, 10);
        const userId    = req.user.id;

        const [lock] = await db.PatientLock.findOrCreate({
            where:    { patientId, userId },
            defaults: { lockedAt: new Date(), expiresAt: makeExpiresAt() }
        });
        lock.expiresAt = makeExpiresAt();
        await lock.save();

        const others = await _getOtherViewers(patientId, userId);
        res.json({ ok: true, others });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
};

// ── Release a lock ────────────────────────────────────────────────────────────
// Accepts both DELETE (fetch API) and POST (navigator.sendBeacon on tab close)
exports.release = async (req, res) => {
    try {
        const patientId = parseInt(req.params.patientId, 10);
        const userId    = req.user.id;

        await db.PatientLock.destroy({ where: { patientId, userId } });
        res.status(204).end();
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
};

// ── Check who is currently viewing a patient ─────────────────────────────────
exports.getViewers = async (req, res) => {
    try {
        const patientId = parseInt(req.params.patientId, 10);
        const userId    = req.user.id;

        const others = await _getOtherViewers(patientId, userId);
        res.json({ others });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
};

// ── Internal: get all non-expired viewers excluding a given userId ────────────
async function _getOtherViewers(patientId, excludeUserId) {
    const locks = await db.PatientLock.findAll({
        where: {
            patientId,
            userId:    { [Op.ne]: excludeUserId },
            expiresAt: { [Op.gt]: new Date() }      // only non-expired
        },
        include: [{
            model:      db.User,
            as:         'User',
            attributes: ['id', 'firstName', 'lastName', 'username']
        }]
    });

    return locks.map(l => ({
        userId:    l.userId,
        name:      (l.User
                    ? (`${l.User.firstName || ''} ${l.User.lastName || ''}`).trim() || l.User.username
                    : 'Another user'),
        lockedAt:  l.lockedAt,
        expiresAt: l.expiresAt,
        minutesAgo: Math.floor((Date.now() - new Date(l.lockedAt)) / 60000)
    }));
}
