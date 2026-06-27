'use strict';
const speakeasy = require('speakeasy');
const QRCode    = require('qrcode');
const crypto    = require('crypto');
const bcrypt    = require('bcryptjs');
const jwt       = require('jsonwebtoken');
const db        = require('../models');
const { issueFullToken } = require('./authController');

const APP_NAME = process.env.APP_NAME || 'Home Accounting';

// ── helpers ───────────────────────────────────────────────────────────────────
function _auditLog(userId, action, ip) {
    return db.AuditLog.create({
        userId, date: new Date(),
        time: new Date().toTimeString().split(' ')[0],
        module: 'Authentication', action, ipAddress: ip
    }).catch(() => {});
}

// Generate 8 random one-time recovery codes (plain + hashed pair)
async function _generateBackupCodes() {
    const plain  = Array.from({ length: 8 }, () => {
        const hex = crypto.randomBytes(5).toString('hex').toUpperCase();
        return hex.slice(0,4) + '-' + hex.slice(4,8) + '-' + hex.slice(8);
    });
    const hashed = await Promise.all(plain.map(c => bcrypt.hash(c, 10)));
    return { plain, hashed };
}

// ── GET /api/auth/2fa/setup ───────────────────────────────────────────────────
exports.setup = async (req, res) => {
    try {
        const user = await db.User.findByPk(req.user.id);
        if (!user) return res.status(404).json({ message: 'User not found.' });

        const secret = speakeasy.generateSecret({ name: `${APP_NAME} (${user.username})`, length: 20 });
        const qrCodeDataUrl = await QRCode.toDataURL(secret.otpauth_url);
        await user.update({ twoFactorSecret: secret.base32 });

        res.json({
            secret:  secret.base32,
            qrCode:  qrCodeDataUrl,
            message: 'Scan the QR code with Google Authenticator or Authy, then call /2fa/enable with the 6-digit code to activate.'
        });
    } catch (e) {
        console.error('[2FA] setup error:', e.message);
        res.status(500).json({ message: 'Internal server error.' });
    }
};

// ── POST /api/auth/2fa/enable ─────────────────────────────────────────────────
// Verifies the TOTP code, activates 2FA, generates 8 backup codes (shown once).
exports.enable = async (req, res) => {
    try {
        const { code } = req.body;
        if (!code) return res.status(400).json({ message: 'Verification code is required.' });

        const user = await db.User.findByPk(req.user.id);
        if (!user) return res.status(404).json({ message: 'User not found.' });
        if (!user.twoFactorSecret) return res.status(400).json({ message: 'No 2FA setup in progress. Call /2fa/setup first.' });
        if (user.twoFactorEnabled)  return res.status(400).json({ message: '2FA is already enabled for this account.' });

        const verified = speakeasy.totp.verify({
            secret: user.twoFactorSecret, encoding: 'base32',
            token: String(code).replace(/\s/g, ''), window: 1
        });
        if (!verified) return res.status(401).json({ message: 'Invalid verification code. Please try again.' });

        // Generate backup codes — plain shown once to user, only hashes stored
        const { plain, hashed } = await _generateBackupCodes();
        await user.update({ twoFactorEnabled: true, backupCodes: hashed });

        await _auditLog(user.id, '2FA Enabled', req.ip);

        res.json({
            message: '2FA has been enabled. Save your backup codes — they will not be shown again.',
            backupCodes: plain
        });
    } catch (e) {
        console.error('[2FA] enable error:', e.message);
        res.status(500).json({ message: 'Internal server error.' });
    }
};

// ── POST /api/auth/2fa/disable ────────────────────────────────────────────────
// Requires current TOTP code to confirm identity before disabling.
exports.disable = async (req, res) => {
    try {
        const { code } = req.body;
        if (!code) return res.status(400).json({ message: 'Current authenticator code is required to disable 2FA.' });

        const user = await db.User.findByPk(req.user.id);
        if (!user) return res.status(404).json({ message: 'User not found.' });
        if (!user.twoFactorEnabled) return res.status(400).json({ message: '2FA is not enabled for this account.' });

        const verified = speakeasy.totp.verify({
            secret: user.twoFactorSecret, encoding: 'base32',
            token: String(code).replace(/\s/g, ''), window: 1
        });
        if (!verified) return res.status(401).json({ message: 'Invalid authenticator code. 2FA was NOT disabled.' });

        await user.update({ twoFactorEnabled: false, twoFactorSecret: null, backupCodes: null });
        await _auditLog(user.id, '2FA Disabled', req.ip);

        res.json({ message: '2FA has been disabled.' });
    } catch (e) {
        console.error('[2FA] disable error:', e.message);
        res.status(500).json({ message: 'Internal server error.' });
    }
};

// ── GET /api/auth/2fa/status ──────────────────────────────────────────────────
exports.status = async (req, res) => {
    try {
        const user = await db.User.findByPk(req.user.id, {
            attributes: ['id', 'twoFactorEnabled', 'backupCodes']
        });
        if (!user) return res.status(404).json({ message: 'User not found.' });
        const codes = Array.isArray(user.backupCodes) ? user.backupCodes : [];
        res.json({ twoFactorEnabled: !!user.twoFactorEnabled, backupCodesRemaining: codes.length });
    } catch (e) {
        res.status(500).json({ message: 'Internal server error.' });
    }
};

// ── POST /api/auth/2fa/regenerate-backup-codes ───────────────────────────────
// Logged-in user refreshes backup codes (requires current TOTP to confirm).
exports.regenerateBackupCodes = async (req, res) => {
    try {
        const { code } = req.body;
        if (!code) return res.status(400).json({ message: 'Authenticator code is required.' });

        const user = await db.User.findByPk(req.user.id);
        if (!user || !user.twoFactorEnabled) return res.status(400).json({ message: '2FA is not enabled.' });

        const verified = speakeasy.totp.verify({
            secret: user.twoFactorSecret, encoding: 'base32',
            token: String(code).replace(/\s/g, ''), window: 1
        });
        if (!verified) return res.status(401).json({ message: 'Invalid code.' });

        const { plain, hashed } = await _generateBackupCodes();
        await user.update({ backupCodes: hashed });
        await _auditLog(user.id, '2FA Backup Codes Regenerated', req.ip);

        res.json({ message: 'New backup codes generated. Old codes are now invalid.', backupCodes: plain });
    } catch (e) {
        res.status(500).json({ message: 'Internal server error.' });
    }
};

// ── POST /api/auth/login/2fa ──────────────────────────────────────────────────
// Second login step: verifies TOTP OR a backup code (backup codes are consumed on use).
exports.verifyLogin = async (req, res) => {
    try {
        const { tempToken, code } = req.body;
        if (!tempToken || !code) return res.status(400).json({ message: 'Temp token and code are required.' });

        let payload;
        try { payload = jwt.verify(tempToken, process.env.JWT_SECRET); }
        catch (e) { return res.status(401).json({ message: 'Session expired. Please log in again.' }); }

        if (payload.purpose !== '2fa_pending') return res.status(401).json({ message: 'Invalid token.' });

        const user = await db.User.findByPk(payload.id, { include: [{ model: db.Role }] });
        if (!user || !user.isActive) return res.status(401).json({ message: 'User not found or inactive.' });
        if (!user.twoFactorEnabled || !user.twoFactorSecret) return res.status(400).json({ message: '2FA is not set up for this account.' });

        const cleanCode = String(code).replace(/[\s-]/g, '');

        // ── Try TOTP first ────────────────────────────────────────────────────
        const totpOk = speakeasy.totp.verify({
            secret: user.twoFactorSecret, encoding: 'base32', token: cleanCode, window: 1
        });

        if (totpOk) {
            if (user.failedLoginCount > 0 || user.lockedUntil) {
                await user.update({ failedLoginCount: 0, lockedUntil: null });
            }
            return issueFullToken(user, req, res);
        }

        // ── Try backup codes ──────────────────────────────────────────────────
        const stored  = Array.isArray(user.backupCodes) ? user.backupCodes : [];
        let usedIdx   = -1;
        for (let i = 0; i < stored.length; i++) {
            const match = await bcrypt.compare(cleanCode.toUpperCase(), stored[i]).catch(() => false);
            if (match) { usedIdx = i; break; }
        }

        if (usedIdx !== -1) {
            const remaining = stored.filter((_, i) => i !== usedIdx);
            await user.update({ backupCodes: remaining, failedLoginCount: 0, lockedUntil: null });
            await _auditLog(user.id, `Login via Backup Code (${remaining.length} remaining)`, req.ip);
            return issueFullToken(user, req, res);
        }

        // ── Both failed ───────────────────────────────────────────────────────
        const newCount = (user.failedLoginCount || 0) + 1;
        const updates  = { failedLoginCount: newCount };
        if (newCount >= 10) updates.lockedUntil = new Date(Date.now() + 15 * 60 * 1000);
        await user.update(updates);

        return res.status(401).json({
            message: 'Invalid authenticator code. You can also use a backup code if you don\'t have your device.'
        });

    } catch (e) {
        console.error('[2FA] verifyLogin error:', e.message);
        res.status(500).json({ message: 'Internal server error.' });
    }
};

// ── DELETE /api/auth/2fa/admin/reset/:userId ──────────────────────────────────
// Admin clears a user's 2FA so they can re-enroll with a new authenticator app.
exports.adminReset = async (req, res) => {
    try {
        if (req.user.role !== 'Administrator') return res.status(403).json({ message: 'Admin only.' });

        const target = await db.User.findByPk(req.params.userId);
        if (!target) return res.status(404).json({ message: 'User not found.' });

        await target.update({ twoFactorEnabled: false, twoFactorSecret: null, backupCodes: null });
        await _auditLog(req.user.id, `Admin Reset 2FA for ${target.username} (id:${target.id})`, req.ip);

        res.json({ message: `2FA reset for ${target.firstName} ${target.lastName}. They can re-enroll from their account settings.` });
    } catch (e) {
        res.status(500).json({ message: 'Internal server error.' });
    }
};

// ── POST /api/auth/admin/unlock/:userId ───────────────────────────────────────
// Admin manually unlocks a locked account without waiting for the timer.
exports.adminUnlock = async (req, res) => {
    try {
        if (req.user.role !== 'Administrator') return res.status(403).json({ message: 'Admin only.' });

        const target = await db.User.findByPk(req.params.userId);
        if (!target) return res.status(404).json({ message: 'User not found.' });

        await target.update({ failedLoginCount: 0, lockedUntil: null });
        await _auditLog(req.user.id, `Admin Unlocked Account: ${target.username} (id:${target.id})`, req.ip);

        res.json({ message: `Account for ${target.firstName} ${target.lastName} has been unlocked.` });
    } catch (e) {
        res.status(500).json({ message: 'Internal server error.' });
    }
};

