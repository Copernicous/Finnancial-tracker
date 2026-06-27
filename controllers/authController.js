'use strict';
const jwt      = require('jsonwebtoken');
const db       = require('../models');
const settings = require('../services/settingsService');
const { BUILT_IN_DEFAULTS } = require('../middleware/rbac');

// ── Account lockout constants ─────────────────────────────────────────────────
const MAX_FAILED_ATTEMPTS = 10;
const LOCKOUT_MINUTES     = 15;

exports.login = async (req, res) => {
    try {
        const { username, password } = req.body;

        if (!username || !password) {
            return res.status(400).json({ message: 'Username and password are required.' });
        }

        const user = await db.User.findOne({
            where: { username },
            include: [{ model: db.Role }]
        });

        // Generic error — don't reveal whether username exists
        const invalidMsg = 'Invalid credentials or inactive account.';

        if (!user || !user.isActive) {
            return res.status(401).json({ message: invalidMsg });
        }

        // ── Account lockout check ────────────────────────────────────────────
        if (user.lockedUntil && new Date(user.lockedUntil) > new Date()) {
            const remainMin = Math.ceil((new Date(user.lockedUntil) - Date.now()) / 60000);
            return res.status(423).json({
                message: `Account temporarily locked due to too many failed attempts. Try again in ${remainMin} minute(s).`
            });
        }

        const validPassword = await user.validPassword(password);
        if (!validPassword) {
            // Increment failed attempts
            const newCount = (user.failedLoginCount || 0) + 1;
            const updates  = { failedLoginCount: newCount };
            if (newCount >= MAX_FAILED_ATTEMPTS) {
                updates.lockedUntil = new Date(Date.now() + LOCKOUT_MINUTES * 60 * 1000);
            }
            await user.update(updates);

            // Log failed attempt
            await db.AuditLog.create({
                userId:    user.id,
                date:      new Date(),
                time:      new Date().toTimeString().split(' ')[0],
                module:    'Authentication',
                action:    `Login Failed (attempt ${newCount}${newCount >= MAX_FAILED_ATTEMPTS ? ' — account locked' : ''})`,
                ipAddress: req.ip
            }).catch(() => {});

            return res.status(401).json({ message: invalidMsg });
        }

        // ── Password correct — reset lockout counters ────────────────────────
        if (user.failedLoginCount > 0 || user.lockedUntil) {
            await user.update({ failedLoginCount: 0, lockedUntil: null });
        }

        // ── 2FA check — only if user has it enabled AND global setting allows it ───
        const globalTwoFa = settings.get('require_2fa') !== 'false';
        if (user.twoFactorEnabled && globalTwoFa) {
            const tempToken = jwt.sign(
                { id: user.id, purpose: '2fa_pending' },
                process.env.JWT_SECRET,
                { expiresIn: '5m' }     // 5-minute window to enter the TOTP code
            );
            return res.json({ requires2FA: true, tempToken });
        }

        // ── Normal login — issue full JWT ────────────────────────────────────
        return issueFullToken(user, req, res);

    } catch (error) {
        console.error('[Auth] Login error:', error.message);
        res.status(500).json({ message: 'Internal server error.' });
    }
};

// Called after TOTP verification succeeds (from twoFactorController)
exports.issueFullToken = issueFullToken;

async function issueFullToken(user, req, res) {
    // Permissions come from the Role record — fall back to built-in if not yet seeded
    const rolePerms = user.Role.permissions ||
        (BUILT_IN_DEFAULTS[user.Role.name] ? BUILT_IN_DEFAULTS[user.Role.name]() : {});

    const token = jwt.sign(
        {
            id:          user.id,
            username:    user.username,
            firstName:   user.firstName,
            lastName:    user.lastName,
            role:        user.Role.name,
            permissions: rolePerms,
            tv:          user.tokenVersion || 0,
            // MASTER admin flag — controls /backoffice access.
            // Value comes from DB; UI/API never allows changing it.
            isMaster:    user.isMaster === true
        },
        process.env.JWT_SECRET,
        { expiresIn: '8h' }
    );

    // Log successful login
    await db.AuditLog.create({
        userId:    user.id,
        date:      new Date(),
        time:      new Date().toTimeString().split(' ')[0],
        module:    'Authentication',
        action:    'Login',
        ipAddress: req.ip
    }).catch(() => {});

    // Set rxToken cookie so it passes through FortiGate SSL portal (which may strip Authorization headers) and can still be used across a proxy boundary.
    const cookieOptions = {
        httpOnly: true,    // 🔒 JS cannot read rxToken — prevents XSS token theft
        path: '/',
        maxAge: 8 * 60 * 60 * 1000  // 8 hours, matches JWT expiry
    };
    const forwardedProto = (req.headers['x-forwarded-proto'] || req.headers['x-forwarded-protocol'] || '').toLowerCase();
    const isSecureRequest = req.secure || forwardedProto.includes('https') || (req.headers['front-end-https'] || '').toLowerCase() === 'on' || !!req.headers['x-arr-ssl'];
    if (isSecureRequest) {
        cookieOptions.sameSite = 'none';
        cookieOptions.secure = true;
    } else {
        cookieOptions.sameSite = 'lax';
        cookieOptions.secure = process.env.FORCE_HTTPS === 'true';
    }

    res.cookie('rxToken', token, cookieOptions);

    res.json({
        message: 'Login successful',
        token,
        user: {
            id:          user.id,
            username:    user.username,
            firstName:   user.firstName,
            lastName:    user.lastName,
            role:        user.Role.name,
            roleId:      user.roleId,
            permissions: rolePerms,
            isMaster:    user.isMaster === true
        }
    });
}

exports.getProfile = async (req, res) => {
    try {
        const user = await db.User.findByPk(req.user.id, {
            attributes: { exclude: ['passwordHash', 'twoFactorSecret', 'backupCodes'] },
            include: [{ model: db.Role }]
        });
        res.json(user);
    } catch (error) {
        console.error('[Auth] getProfile error:', error.message);
        res.status(500).json({ message: 'Internal server error.' });
    }
};

// ── POST /api/auth/change-password ────────────────────────────────────────────
// Logged-in user changes their own password. Increments tokenVersion to
// immediately invalidate all other active sessions (logged-in on other devices).
exports.changePassword = async (req, res) => {
    try {
        const { currentPassword, newPassword } = req.body;
        if (!currentPassword || !newPassword) {
            return res.status(400).json({ message: 'Current and new password are required.' });
        }
        if (newPassword.length < 8) {
            return res.status(400).json({ message: 'New password must be at least 8 characters.' });
        }

        const bcrypt = require('bcryptjs');
        const user = await db.User.findByPk(req.user.id);
        if (!user) return res.status(404).json({ message: 'User not found.' });

        const valid = await user.validPassword(currentPassword);
        if (!valid) return res.status(400).json({ message: 'Current password is incorrect.' });

        const newHash     = await bcrypt.hash(newPassword, 12);
        const newVersion  = (user.tokenVersion || 0) + 1;
        await user.update({ passwordHash: newHash, tokenVersion: newVersion });

        await db.AuditLog.create({
            userId:    user.id,
            date:      new Date(),
            time:      new Date().toTimeString().split(' ')[0],
            module:    'Authentication',
            action:    'Password Changed (all sessions invalidated)',
            ipAddress: req.ip
        }).catch(() => {});

        res.json({ message: 'Password changed. All other sessions have been signed out.' });
    } catch (e) {
        console.error('[Auth] changePassword error:', e.message);
        res.status(500).json({ message: 'Internal server error.' });
    }
};
