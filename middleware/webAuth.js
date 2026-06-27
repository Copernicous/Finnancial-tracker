/**
 * webAuth.js — Lightweight middleware for web (HTML) routes.
 *
 * Reads the JWT from the "rxToken" cookie that the client sets on login.
 * Decodes it (no error = valid), and attaches:
 *   - res.locals.currentUser   — the decoded user object
 *   - res.locals.userPerms     — the permissions map (keyed by module)
 *   - res.locals.isAdmin       — boolean shortcut
 *
 * All EJS templates can then use <%= locals.userPerms %> for conditional rendering.
 * If the cookie is absent or invalid, locals are null (guest / not-logged-in).
 */
const jwt = require('jsonwebtoken');

// Simple cookie string parser — no external package needed.
function parseCookies(cookieHeader) {
    const cookies = {};
    if (!cookieHeader) return cookies;
    cookieHeader.split(';').forEach(pair => {
        const idx = pair.indexOf('=');
        if (idx < 0) return;
        const key = pair.slice(0, idx).trim();
        const raw = pair.slice(idx + 1).trim();
        try {
            cookies[key] = decodeURIComponent(raw);
        } catch (e) {
            cookies[key] = raw; // already unencoded
        }
    });
    return cookies;
}

module.exports = (req, res, next) => {
    res.locals.currentUser = null;
    res.locals.userPerms   = null;
    res.locals.isAdmin     = false;
    res.locals.isMaster    = false;

    try {
        const cookies = parseCookies(req.headers.cookie);
        const token   = cookies.rxToken;
        if (!token) return next();

        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        req.user               = decoded;          // allow middleware like requireMaster to read req.user
        res.locals.currentUser = decoded;
        res.locals.userPerms   = decoded.permissions || {};
        res.locals.isAdmin     = decoded.role === 'Administrator';
        res.locals.isMaster    = decoded.isMaster === true;
    } catch (e) {
        // Expired or tampered token — clear it gracefully
        res.clearCookie('rxToken', { path: '/', sameSite: 'none', secure: true });
    }
    next();
};
