'use strict';
const express    = require('express');
const router     = express.Router();
const rateLimit  = require('express-rate-limit');
const tfCtrl     = require('../controllers/twoFactorController');
const authCtrl   = require('../controllers/authController');
const auth       = require('../middleware/auth');

// ── Rate limiter for 2FA login step ──────────────────────────────────────────
// 10 attempts per 15 min per IP — prevents TOTP/backup-code brute force
const twoFaLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { message: 'Too many 2FA attempts. Please try again in 15 minutes.' },
    skipSuccessfulRequests: true
});

// ── 2FA setup / management (requires valid full JWT) ─────────────────────────
router.get ('/2fa/setup',                    auth, tfCtrl.setup);
router.post('/2fa/enable',                   auth, tfCtrl.enable);
router.post('/2fa/disable',                  auth, tfCtrl.disable);
router.get ('/2fa/status',                   auth, tfCtrl.status);
router.post('/2fa/regenerate-backup-codes',  auth, tfCtrl.regenerateBackupCodes);

// ── 2FA login second step (uses tempToken — no auth middleware) ───────────────
router.post('/login/2fa', twoFaLimiter, tfCtrl.verifyLogin);

// ── Admin-only 2FA management ─────────────────────────────────────────────────
router.delete('/2fa/admin/reset/:userId',    auth, tfCtrl.adminReset);
router.post  ('/admin/unlock/:userId',       auth, tfCtrl.adminUnlock);

// ── Self-service password change (invalidates all other sessions) ─────────────
router.post('/change-password', auth, authCtrl.changePassword);

module.exports = router;
