'use strict';

const db = require('../models');

const PAGE_TITLES = [
    [/^\/dashboard\/?$/, 'Dashboard'],
    [/^\/pharmacies\/?$/, 'Pharmacies'],
    [/^\/patient-transport\/?$/, 'Patient Transport Companies'],
    [/^\/pharmacy-transport\/?$/, 'Pharmacy Transport Companies'],
    [/^\/clinics\/?$/, 'Clinics'],
    [/^\/users\/?$/, 'User Management'],
    [/^\/roles\/?$/, 'Roles Management'],
    [/^\/workflow-actions\/?$/, 'Workflow Actions'],
    [/^\/medication-catalog\/?$/, 'RX Actions'],
    [/^\/patients\/?$/, 'Patients Management'],
    [/^\/patients\/[^/]+\/timeline\/?$/, 'Patient Timeline'],
    [/^\/rx-records\/?$/, 'RX Records'],
    [/^\/reports\/?$/, 'Reports'],
    [/^\/import\/?$/, 'Data Import'],
    [/^\/audit-log\/?$/, 'Audit Log'],
    [/^\/backups\/?$/, 'Backup Management'],
    [/^\/system-settings\/?$/, 'System Settings'],
    [/^\/backoffice\/?$/, 'Back Office'],
    [/^\/active-users\/?$/, 'Active Users'],
    [/^\/changelog\/?$/, 'Changelog']
];

function getClientIp(req) {
    const forwarded = req.headers['x-forwarded-for'];
    if (typeof forwarded === 'string' && forwarded.trim()) {
        return forwarded.split(',')[0].trim().substring(0, 80);
    }
    return (req.ip || req.socket?.remoteAddress || '').substring(0, 80);
}

function normalizePagePath(pathname) {
    if (!pathname) return '/';
    return pathname
        .replace(/\/patients\/[^/]+\/timeline\/?$/i, '/patients/:id/timeline')
        .replace(/\/+$/, '') || '/';
}

function sanitizeReferrer(rawReferrer) {
    if (!rawReferrer) return null;
    const withoutQuery = String(rawReferrer).split('?')[0];
    try {
        const parsed = new URL(withoutQuery, 'http://local');
        return normalizePagePath(parsed.pathname).substring(0, 2000);
    } catch (_e) {
        return normalizePagePath(withoutQuery).substring(0, 2000);
    }
}

function getPageTitle(pathname) {
    for (const [pattern, title] of PAGE_TITLES) {
        if (pattern.test(pathname)) return title;
    }
    return pathname === '/' ? 'Home Redirect' : 'Unknown Page';
}

function shouldLog(req) {
    if (!req.user) return false;
    if (req.method !== 'GET' && req.method !== 'HEAD') return false;
    if ((req.headers.accept || '').includes('application/json')) return false;

    const pathOnly = (req.path || '').toLowerCase();
    if (!pathOnly || pathOnly.startsWith('/api/')) return false;
    if (pathOnly.startsWith('/assets/') || pathOnly.startsWith('/css/') || pathOnly.startsWith('/js/')) return false;
    if (pathOnly.startsWith('/uploads/') || pathOnly.startsWith('/documents/')) return false;
    if (/\.(?:js|css|png|jpg|jpeg|gif|svg|ico|map|woff2?|ttf|eot|csv|xlsx?|pdf|zip)$/i.test(pathOnly)) return false;

    return true;
}

module.exports = function userActivityLogger(req, res, next) {
    if (!shouldLog(req)) return next();

    const rawPath = req.path || '/';
    const pagePath = normalizePagePath(rawPath);
    const pageTitle = getPageTitle(rawPath);
    const user = req.user || {};
    const userId = Number.isInteger(user.id) ? user.id : (user.id ? parseInt(user.id, 10) : null);

    res.on('finish', () => {
        db.UserActivityLog.create({
            userId: Number.isFinite(userId) ? userId : null,
            usernameSnapshot: user.username ? String(user.username).substring(0, 255) : null,
            roleSnapshot: user.role ? String(user.role).substring(0, 255) : null,
            pageUrl: pagePath,
            pagePath,
            pageTitle,
            visitedAt: new Date(),
            ipAddress: getClientIp(req),
            userAgent: (req.headers['user-agent'] || '').substring(0, 2000),
            referrer: sanitizeReferrer(req.headers.referer || req.headers.referrer),
            statusCode: res.statusCode || null
        }).catch(err => {
            console.warn('[UserActivityLogger] Unable to save page visit:', err.message);
        });
    });

    next();
};
