const jwt = require('jsonwebtoken');

// Helper: parse a specific cookie from the Cookie header string
function getCookie(cookieHeader, name) {
    if (!cookieHeader) return null;
    const match = cookieHeader.match(new RegExp('(?:^|;)\\s*' + name + '=([^;]+)'));
    return match ? decodeURIComponent(match[1]) : null;
}

module.exports = (req, res, next) => {
    // 1. Try Authorization: Bearer header (standard JWT)
    let token = null;
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
        token = authHeader.split(' ')[1];
    }

    // 2. Fallback: rxToken cookie — passes through FortiGate SSL VPN when Bearer header is stripped
    if (!token) {
        token = getCookie(req.headers.cookie, 'rxToken');
    }

    if (!token) {
        return res.status(401).json({ message: 'Authorization token required' });
    }

    jwt.verify(token, process.env.JWT_SECRET, async (err, decoded) => {
        if (err) {
            return res.status(401).json({ message: 'Invalid or expired token' });
        }

        // tokenVersion check — invalidates JWTs issued before a password change.
        // SEC-02: Always run the DB check so that:
        //   (a) new tokens (with tv claim) must match the DB version exactly, AND
        //   (b) old tokens (no tv claim, issued before this feature) are rejected
        //       if the DB version is > 0 (user has changed password since feature landed).
        //
        // This closes the bypass where a stolen old token remained valid after
        // a password change because it lacked the tv claim.
        try {
            const db   = require('../models');
            const user = await db.User.findByPk(decoded.id, { attributes: ['tokenVersion'] });
            if (!user) {
                return res.status(401).json({ message: 'Session expired. Please log in again.' });
            }
            const dbVersion    = user.tokenVersion || 0;
            const tokenVersion = typeof decoded.tv === 'number' ? decoded.tv : null;

            if (dbVersion > 0 && tokenVersion === null) {
                // Old token without tv claim, but account has had password changes — reject.
                return res.status(401).json({ message: 'Session expired. Please log in again.' });
            }
            if (tokenVersion !== null && dbVersion !== tokenVersion) {
                // Token version doesn't match DB — password was changed, old token invalid.
                return res.status(401).json({ message: 'Session expired. Please log in again.' });
            }
        } catch (_e) {
            // Only swallow genuine DB-unavailable errors (ECONNREFUSED, ETIMEDOUT, etc.)
            // Re-throw programmer errors (wrong path, missing module, etc.) so they surface.
            const isDbError = _e.code === 'ECONNREFUSED' || _e.code === 'ETIMEDOUT' ||
                (_e.name && _e.name.includes('Sequelize'));
            if (!isDbError) throw _e;
            // DB temporarily unavailable — allow through to avoid full lockout during maintenance
            console.warn('[Auth] tokenVersion DB check skipped (DB unavailable):', _e.message);
        }


        req.user = decoded;
        next();
    });
};
