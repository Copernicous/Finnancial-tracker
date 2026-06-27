'use strict';

const fs = require('fs');
const path = require('path');
const db = require('../models');
const { QueryTypes } = require('sequelize');
const { getAppRoot, getWritableRoot } = require('../utils/runtimePaths');

const HTTP_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD']);

const STATUS_GUIDE = {
    200: ['OK', 'The request succeeded and the page/API answered normally.', 'Healthy traffic. No action needed unless volume is unusual.'],
    201: ['Created', 'A new record or resource was created successfully.', 'Normal after add/import/save actions.'],
    204: ['No Content', 'The request succeeded but returned no body.', 'Normal for lightweight save, delete, heartbeat, or status calls.'],
    301: ['Moved Permanently', 'The browser was redirected to a permanent URL.', 'Confirm the final URL is expected if this repeats often.'],
    302: ['Redirect', 'The browser was temporarily redirected.', 'Common after login, logout, or route guards.'],
    304: ['Cached', 'The browser reused cached content.', 'Normal and usually good for static assets.'],
    400: ['Bad Request', 'The request was invalid or missing expected data.', 'Review the form/action that triggered it.'],
    401: ['Login Required', 'The session is missing, expired, or invalid.', 'Ask the user to sign in again; check session/cookie settings if frequent.'],
    403: ['Forbidden', 'The user is logged in but role permissions blocked access.', 'Review the role or hide unavailable actions from that user.'],
    404: ['Not Found', 'The requested route or file does not exist.', 'Check broken links, old bookmarks, scanners, or missing files.'],
    409: ['Conflict', 'The request conflicted with current data/state.', 'Check duplicate records, locks, or active workflow state.'],
    429: ['Rate Limited', 'Too many requests arrived too quickly.', 'Look for repeated clicks, automation, or brute-force attempts.'],
    500: ['Server Error', 'The backend failed while handling the request.', 'Open Error Logs and server logs around the same time/user/page.'],
    502: ['Bad Gateway', 'A proxy/gateway could not get a valid upstream response.', 'Check the service process, proxy, and network path.'],
    503: ['Unavailable', 'The service was temporarily unavailable.', 'Check service uptime, maintenance mode, and restart history.'],
    504: ['Gateway Timeout', 'A proxy/gateway timed out waiting for the app.', 'Check slow DB queries, server load, or network/proxy timeout settings.']
};

function statusInfo(statusCode) {
    const code = Number(statusCode || 0);
    const guide = STATUS_GUIDE[code] || ['HTTP ' + (code || '?'), 'HTTP response status from the RX application.', 'Use the page, user, and time context to decide the next action.'];
    return {
        code,
        label: guide[0],
        meaning: guide[1],
        action: guide[2],
        level: code >= 500 ? 'danger' : (code >= 400 ? 'warning' : (code >= 300 ? 'info' : 'good')),
        reference: code
            ? 'https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Status/' + code
            : 'https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Status'
    };
}

function parsePositiveInt(value, fallback, min, max) {
    const parsed = parseInt(value, 10);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(max, Math.max(min, parsed));
}

function buildSinceDate(range, hours) {
    const now = new Date();
    const key = String(range || 'day').toLowerCase();
    if (key === 'live') return new Date(Date.now() - 15 * 60 * 1000);
    if (key === 'hour') return new Date(Date.now() - 60 * 60 * 1000);
    if (key === 'today') {
        const start = new Date(now);
        start.setHours(0, 0, 0, 0);
        return start;
    }
    if (key === 'week') return new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    if (key === 'all') return new Date(0);
    return new Date(Date.now() - parsePositiveInt(hours, 24, 1, 24 * 31) * 60 * 60 * 1000);
}

function normalizeFilters(input) {
    return {
        range: String(input.range || 'day').toLowerCase(),
        hours: parsePositiveInt(input.hours, 24, 1, 24 * 31),
        user: String(input.user || '').trim().slice(0, 80),
        role: String(input.role || '').trim().slice(0, 80),
        ip: String(input.ip || '').trim().slice(0, 80),
        browser: String(input.browser || '').trim().slice(0, 80),
        status: String(input.status || '').trim().slice(0, 10),
        path: String(input.path || '').trim().slice(0, 160),
        source: String(input.source || '').trim().slice(0, 120),
        method: String(input.method || '').trim().slice(0, 12).toUpperCase(),
        severity: String(input.severity || '').trim().slice(0, 20).toLowerCase(),
        logType: String(input.logType || '').trim().slice(0, 40).toLowerCase(),
        search: String(input.search || '').trim().slice(0, 160),
        limit: parsePositiveInt(input.limit, 75, 20, 250)
    };
}

function browserLabel(userAgent) {
    const ua = String(userAgent || '');
    if (!ua) return '(unknown)';

    let browser = 'Browser';
    if (/Edg\//.test(ua)) browser = 'Edge';
    else if (/Chrome\//.test(ua)) browser = 'Chrome';
    else if (/Firefox\//.test(ua)) browser = 'Firefox';
    else if (/Safari\//.test(ua)) browser = 'Safari';
    else if (/MSIE|Trident/.test(ua)) browser = 'Internet Explorer';

    let platform = '';
    if (/Windows/i.test(ua)) platform = 'Windows';
    else if (/Macintosh|Mac OS/i.test(ua)) platform = 'Mac';
    else if (/iPhone|iPad/i.test(ua)) platform = 'iOS';
    else if (/Android/i.test(ua)) platform = 'Android';
    else if (/Linux/i.test(ua)) platform = 'Linux';

    return platform ? browser + ' / ' + platform : browser;
}

function inc(counter, key, amount) {
    const label = key === undefined || key === null || key === '' ? '(unknown)' : String(key);
    counter[label] = (counter[label] || 0) + (amount || 1);
}

function topEntries(counter, limit) {
    return Object.keys(counter)
        .map(key => ({ label: key, value: counter[key] }))
        .sort((a, b) => b.value - a.value)
        .slice(0, limit || 10);
}

function timelineBucket(date, range) {
    const bucket = new Date(date);
    const key = String(range || 'day').toLowerCase();
    if (key === 'live' || key === 'hour') {
        bucket.setSeconds(0, 0);
    } else if (key === 'week' || key === 'all') {
        bucket.setHours(0, 0, 0, 0);
    } else {
        bucket.setMinutes(0, 0, 0);
    }
    return bucket.toISOString();
}

function timelineBucketSql(range) {
    const key = String(range || 'day').toLowerCase();
    if (key === 'live' || key === 'hour') return `date_trunc('minute', v."visitedAt")`;
    if (key === 'week' || key === 'all') return `date_trunc('day', v."visitedAt")`;
    return `date_trunc('hour', v."visitedAt")`;
}

function toInt(value) {
    const parsed = parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : 0;
}

async function tableExists(tableName) {
    const [row] = await db.sequelize.query(
        `SELECT EXISTS (
            SELECT 1 FROM information_schema.tables
            WHERE table_schema = 'public' AND table_name = :tableName
        ) AS exists`,
        { type: QueryTypes.SELECT, replacements: { tableName } }
    );
    return !!(row && row.exists);
}

function addLikeFilter(where, replacements, column, value, name) {
    if (!value) return;
    where.push(column + ' ILIKE :' + name);
    replacements[name] = '%' + value + '%';
}

function addBrowserFilter(where, replacements, column, value, name) {
    if (!value) return;
    const parts = String(value)
        .split(/[\/,]+/)
        .map(part => part.trim())
        .filter(Boolean)
        .slice(0, 4);
    if (!parts.length) return;
    where.push(parts.map((_part, index) => column + ' ILIKE :' + name + index).join(' AND '));
    parts.forEach((part, index) => {
        replacements[name + index] = '%' + part + '%';
    });
}

function uniqueList(values, limit) {
    const seen = new Set();
    const out = [];
    (values || []).forEach(value => {
        const label = String(value || '').trim();
        const key = label.toLowerCase();
        if (!label || key === '(unknown)' || seen.has(key)) return;
        seen.add(key);
        out.push(label);
    });
    return out.slice(0, limit || 40);
}

function labelsFromRows(rows) {
    return (rows || []).map(row => row && row.label);
}

function buildPageWhere(since, filters) {
    const where = ['v."visitedAt" >= :since'];
    const replacements = { since: since.toISOString() };

    if (filters.user) {
        where.push(`(
            v."usernameSnapshot" ILIKE :user
            OR u."username" ILIKE :user
            OR CONCAT(COALESCE(u."firstName", ''), ' ', COALESCE(u."lastName", '')) ILIKE :user
        )`);
        replacements.user = '%' + filters.user + '%';
    }
    addLikeFilter(where, replacements, 'v."roleSnapshot"', filters.role, 'role');
    addLikeFilter(where, replacements, 'v."ipAddress"', filters.ip, 'ip');
    addBrowserFilter(where, replacements, 'v."userAgent"', filters.browser, 'browser');
    if (filters.status) {
        where.push('v."statusCode" = :status');
        replacements.status = toInt(filters.status);
    }
    if (filters.path) {
        where.push('(v."pagePath" ILIKE :path OR v."pageTitle" ILIKE :path)');
        replacements.path = '%' + filters.path + '%';
    }
    if (filters.search) {
        where.push(`(
            v."usernameSnapshot" ILIKE :search
            OR v."roleSnapshot" ILIKE :search
            OR v."pageTitle" ILIKE :search
            OR v."pagePath" ILIKE :search
            OR v."ipAddress" ILIKE :search
            OR v."userAgent" ILIKE :search
        )`);
        replacements.search = '%' + filters.search + '%';
    }

    return { whereSql: where.join(' AND '), replacements };
}

async function readPageActivity(since, filters) {
    if (!(await tableExists('UserActivityLogs'))) {
        return {
            available: false,
            total: 0,
            note: 'UserActivityLogs table is not present yet. Deploy the page-visit tracking migration first.'
        };
    }

    const built = buildPageWhere(since, filters);
    const whereSql = built.whereSql;
    const replacements = built.replacements;

    const [totalRow] = await db.sequelize.query(`
        SELECT
            COUNT(*)::int AS total,
            SUM(CASE WHEN COALESCE(v."statusCode", 0) BETWEEN 200 AND 299 THEN 1 ELSE 0 END)::int AS ok,
            SUM(CASE WHEN COALESCE(v."statusCode", 0) BETWEEN 300 AND 399 THEN 1 ELSE 0 END)::int AS redirects,
            SUM(CASE WHEN COALESCE(v."statusCode", 0) BETWEEN 400 AND 499 THEN 1 ELSE 0 END)::int AS client_errors,
            SUM(CASE WHEN COALESCE(v."statusCode", 0) >= 500 THEN 1 ELSE 0 END)::int AS server_errors,
            SUM(CASE WHEN COALESCE(v."statusCode", 0) = 401 THEN 1 ELSE 0 END)::int AS unauthorized,
            SUM(CASE WHEN COALESCE(v."statusCode", 0) = 403 THEN 1 ELSE 0 END)::int AS forbidden,
            COUNT(DISTINCT COALESCE(v."userId"::text, v."usernameSnapshot"))::int AS unique_users,
            COUNT(DISTINCT v."ipAddress")::int AS unique_ips
        FROM "UserActivityLogs" v
        LEFT JOIN "Users" u ON u.id = v."userId"
        WHERE ${whereSql}
    `, { type: QueryTypes.SELECT, replacements });

    const topPages = await db.sequelize.query(`
        SELECT COALESCE(NULLIF(v."pageTitle", ''), NULLIF(v."pagePath", ''), '(unknown)') AS label,
               COUNT(*)::int AS value
        FROM "UserActivityLogs" v
        LEFT JOIN "Users" u ON u.id = v."userId"
        WHERE ${whereSql}
        GROUP BY label
        ORDER BY value DESC
        LIMIT 10
    `, { type: QueryTypes.SELECT, replacements });

    const topUsers = await db.sequelize.query(`
        SELECT COALESCE(NULLIF(v."usernameSnapshot", ''), NULLIF(u."username", ''), 'User #' || v."userId", '(unknown)') AS label,
               COUNT(*)::int AS value
        FROM "UserActivityLogs" v
        LEFT JOIN "Users" u ON u.id = v."userId"
        WHERE ${whereSql}
        GROUP BY label
        ORDER BY value DESC
        LIMIT 10
    `, { type: QueryTypes.SELECT, replacements });

    const topRoles = await db.sequelize.query(`
        SELECT COALESCE(NULLIF(v."roleSnapshot", ''), '(unknown)') AS label,
               COUNT(*)::int AS value
        FROM "UserActivityLogs" v
        LEFT JOIN "Users" u ON u.id = v."userId"
        WHERE ${whereSql}
        GROUP BY label
        ORDER BY value DESC
        LIMIT 10
    `, { type: QueryTypes.SELECT, replacements });

    const topStatuses = await db.sequelize.query(`
        SELECT COALESCE(v."statusCode", 0)::int AS label,
               COUNT(*)::int AS value
        FROM "UserActivityLogs" v
        LEFT JOIN "Users" u ON u.id = v."userId"
        WHERE ${whereSql}
        GROUP BY label
        ORDER BY value DESC
        LIMIT 10
    `, { type: QueryTypes.SELECT, replacements });

    const browserRows = await db.sequelize.query(`
        SELECT v."userAgent"
        FROM "UserActivityLogs" v
        LEFT JOIN "Users" u ON u.id = v."userId"
        WHERE ${whereSql}
        ORDER BY v."visitedAt" DESC
        LIMIT 1000
    `, { type: QueryTypes.SELECT, replacements });

    const browsers = Object.create(null);
    browserRows.forEach(row => inc(browsers, browserLabel(row.userAgent)));

    const topIps = await db.sequelize.query(`
        SELECT COALESCE(NULLIF(v."ipAddress", ''), '(unknown)') AS label,
               COUNT(*)::int AS value
        FROM "UserActivityLogs" v
        LEFT JOIN "Users" u ON u.id = v."userId"
        WHERE ${whereSql}
        GROUP BY label
        ORDER BY value DESC
        LIMIT 10
    `, { type: QueryTypes.SELECT, replacements });

    const bucketExpr = timelineBucketSql(filters.range);
    const timeline = await db.sequelize.query(`
        SELECT ${bucketExpr} AS bucket,
               COUNT(*)::int AS total,
               SUM(CASE WHEN COALESCE(v."statusCode", 0) BETWEEN 200 AND 299 THEN 1 ELSE 0 END)::int AS ok,
               SUM(CASE WHEN COALESCE(v."statusCode", 0) BETWEEN 300 AND 399 THEN 1 ELSE 0 END)::int AS redirects,
               SUM(CASE WHEN COALESCE(v."statusCode", 0) BETWEEN 400 AND 499 THEN 1 ELSE 0 END)::int AS client_errors,
               SUM(CASE WHEN COALESCE(v."statusCode", 0) >= 500 THEN 1 ELSE 0 END)::int AS server_errors,
               SUM(CASE WHEN COALESCE(v."statusCode", 0) = 401 THEN 1 ELSE 0 END)::int AS unauthorized,
               SUM(CASE WHEN COALESCE(v."statusCode", 0) = 403 THEN 1 ELSE 0 END)::int AS forbidden
        FROM "UserActivityLogs" v
        LEFT JOIN "Users" u ON u.id = v."userId"
        WHERE ${whereSql}
        GROUP BY bucket
        ORDER BY bucket ASC
        LIMIT 500
    `, { type: QueryTypes.SELECT, replacements });

    const recentVisits = await db.sequelize.query(`
        SELECT v.id, v."userId", v."usernameSnapshot", v."roleSnapshot",
               COALESCE(NULLIF(u."username", ''), v."usernameSnapshot") AS "username",
               v."pagePath", v."pageTitle", v."visitedAt", v."ipAddress",
               v."referrer", v."statusCode", v."userAgent"
        FROM "UserActivityLogs" v
        LEFT JOIN "Users" u ON u.id = v."userId"
        WHERE ${whereSql}
        ORDER BY v."visitedAt" DESC
        LIMIT :limit
    `, { type: QueryTypes.SELECT, replacements: Object.assign({}, replacements, { limit: filters.limit }) });

    const statusDetails = topStatuses.map(row => Object.assign({}, row, { info: statusInfo(row.label) }));
    const totals = {
        total: toInt(totalRow && totalRow.total),
        ok: toInt(totalRow && totalRow.ok),
        redirects: toInt(totalRow && totalRow.redirects),
        clientErrors: toInt(totalRow && totalRow.client_errors),
        serverErrors: toInt(totalRow && totalRow.server_errors),
        unauthorized: toInt(totalRow && totalRow.unauthorized),
        forbidden: toInt(totalRow && totalRow.forbidden),
        uniqueUsers: toInt(totalRow && totalRow.unique_users),
        uniqueIps: toInt(totalRow && totalRow.unique_ips)
    };

    return {
        available: true,
        totals,
        timeline: timeline.map(row => ({
            bucket: row.bucket,
            total: toInt(row.total),
            ok: toInt(row.ok),
            redirects: toInt(row.redirects),
            clientErrors: toInt(row.client_errors),
            serverErrors: toInt(row.server_errors),
            unauthorized: toInt(row.unauthorized),
            forbidden: toInt(row.forbidden)
        })),
        topPages,
        topUsers,
        topRoles,
        topIps,
        topStatuses: statusDetails,
        topBrowsers: topEntries(browsers, 10),
        recentVisits: recentVisits.map(row => ({
            id: row.id,
            userId: row.userId,
            username: row.usernameSnapshot || row.username || (row.userId ? 'User #' + row.userId : '(unknown)'),
            role: row.roleSnapshot || '',
            pagePath: row.pagePath || '',
            pageTitle: row.pageTitle || row.pagePath || 'Unknown Page',
            visitedAt: row.visitedAt,
            ipAddress: row.ipAddress || '',
            referrer: row.referrer || '',
            statusCode: row.statusCode,
            statusInfo: statusInfo(row.statusCode),
            browser: browserLabel(row.userAgent)
        }))
    };
}

function buildAuditWhere(since, filters) {
    const where = ['al."createdAt" >= :since'];
    const replacements = { since: since.toISOString() };

    if (filters.user) {
        where.push(`(
            u."username" ILIKE :user
            OR CONCAT(COALESCE(u."firstName", ''), ' ', COALESCE(u."lastName", '')) ILIKE :user
        )`);
        replacements.user = '%' + filters.user + '%';
    }
    if (filters.role) {
        where.push(`EXISTS (
            SELECT 1 FROM "Roles" r
            WHERE r.id = u."roleId" AND r."name" ILIKE :auditRole
        )`);
        replacements.auditRole = '%' + filters.role + '%';
    }
    if (filters.search) {
        where.push(`(
            al."action" ILIKE :search
            OR al."module" ILIKE :search
            OR al."ipAddress" ILIKE :search
            OR EXISTS (
                SELECT 1 FROM "Roles" r
                WHERE r.id = u."roleId" AND r."name" ILIKE :search
            )
        )`);
        replacements.search = '%' + filters.search + '%';
    }
    if (filters.ip) {
        where.push('al."ipAddress" ILIKE :auditIp');
        replacements.auditIp = '%' + filters.ip + '%';
    }

    return { whereSql: where.join(' AND '), replacements };
}

async function readAuditSummary(since, filters) {
    if (!(await tableExists('AuditLogs'))) {
        return { available: false, total: 0 };
    }

    const built = buildAuditWhere(since, filters);
    const whereSql = built.whereSql;
    const replacements = built.replacements;

    const [totalRow] = await db.sequelize.query(`
        SELECT COUNT(*)::int AS total,
               COUNT(DISTINCT al."userId")::int AS unique_users
        FROM "AuditLogs" al
        LEFT JOIN "Users" u ON u.id = al."userId"
        WHERE ${whereSql}
    `, { type: QueryTypes.SELECT, replacements });

    const topActions = await db.sequelize.query(`
        SELECT COALESCE(NULLIF(al."action", ''), '(unknown)') AS label,
               COUNT(*)::int AS value
        FROM "AuditLogs" al
        LEFT JOIN "Users" u ON u.id = al."userId"
        WHERE ${whereSql}
        GROUP BY label
        ORDER BY value DESC
        LIMIT 10
    `, { type: QueryTypes.SELECT, replacements });

    const topModules = await db.sequelize.query(`
        SELECT COALESCE(NULLIF(al."module", ''), '(unknown)') AS label,
               COUNT(*)::int AS value
        FROM "AuditLogs" al
        LEFT JOIN "Users" u ON u.id = al."userId"
        WHERE ${whereSql}
        GROUP BY label
        ORDER BY value DESC
        LIMIT 10
    `, { type: QueryTypes.SELECT, replacements });

    const recentEvents = await db.sequelize.query(`
        SELECT al.id, al."action", al."module", al."recordId", al."createdAt", al."ipAddress",
               COALESCE(NULLIF(u."username", ''), 'User #' || al."userId", '(system)') AS username
        FROM "AuditLogs" al
        LEFT JOIN "Users" u ON u.id = al."userId"
        WHERE ${whereSql}
        ORDER BY al."createdAt" DESC
        LIMIT :auditLimit
    `, { type: QueryTypes.SELECT, replacements: Object.assign({}, replacements, { auditLimit: filters.limit }) });

    return {
        available: true,
        total: toInt(totalRow && totalRow.total),
        uniqueUsers: toInt(totalRow && totalRow.unique_users),
        topActions,
        topModules,
        recentEvents
    };
}

function buildErrorWhere(since, filters) {
    const where = ['el."createdAt" >= :since'];
    const replacements = { since: since.toISOString() };

    if (filters.user) {
        where.push(`(
            u."username" ILIKE :errUser
            OR CONCAT(COALESCE(u."firstName", ''), ' ', COALESCE(u."lastName", '')) ILIKE :errUser
        )`);
        replacements.errUser = '%' + filters.user + '%';
    }
    if (filters.role) {
        where.push(`EXISTS (
            SELECT 1 FROM "Roles" r
            WHERE r.id = u."roleId" AND r."name" ILIKE :errRole
        )`);
        replacements.errRole = '%' + filters.role + '%';
    }
    if (filters.ip) {
        where.push('el."ipAddress" ILIKE :errIp');
        replacements.errIp = '%' + filters.ip + '%';
    }
    addBrowserFilter(where, replacements, 'el."userAgent"', filters.browser, 'errBrowser');
    if (filters.path) {
        where.push('el."url" ILIKE :errPath');
        replacements.errPath = '%' + filters.path + '%';
    }
    if (filters.source) {
        where.push('el."source"::text ILIKE :errSource');
        replacements.errSource = '%' + filters.source + '%';
    }
    if (filters.severity) {
        where.push('el."severity"::text = :errSeverity');
        replacements.errSeverity = filters.severity;
    }
    if (filters.search) {
        where.push(`(
            el."message" ILIKE :errSearch
            OR el."url" ILIKE :errSearch
            OR el."severity"::text ILIKE :errSearch
            OR el."source"::text ILIKE :errSearch
            OR el."userAgent" ILIKE :errSearch
        )`);
        replacements.errSearch = '%' + filters.search + '%';
    }

    return { whereSql: where.join(' AND '), replacements };
}

function safeUrl(rawUrl) {
    if (!rawUrl) return '';
    return String(rawUrl).split('?')[0].slice(0, 220);
}

function safeErrorMessage(message) {
    if (!message) return '';
    return String(message)
        .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email]')
        .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '[id]')
        .replace(/\b\d{5,}\b/g, '[number]')
        .slice(0, 180);
}

async function readErrorSummary(since, filters) {
    if (!(await tableExists('ErrorLogs'))) {
        return { available: false, total: 0 };
    }

    const built = buildErrorWhere(since, filters);
    const whereSql = built.whereSql;
    const replacements = built.replacements;

    const [totalRow] = await db.sequelize.query(`
        SELECT COUNT(*)::int AS total,
               SUM(CASE WHEN el."resolved" = false THEN 1 ELSE 0 END)::int AS unresolved,
               SUM(CASE WHEN el."severity"::text = 'error' THEN 1 ELSE 0 END)::int AS errors,
               SUM(CASE WHEN el."severity"::text = 'warning' THEN 1 ELSE 0 END)::int AS warnings,
               SUM(CASE WHEN el."source"::text = 'backend' THEN 1 ELSE 0 END)::int AS backend,
               SUM(CASE WHEN el."source"::text = 'frontend' THEN 1 ELSE 0 END)::int AS frontend
        FROM "ErrorLogs" el
        LEFT JOIN "Users" u ON u.id = el."userId"
        WHERE ${whereSql}
    `, { type: QueryTypes.SELECT, replacements });

    const topSeverities = await db.sequelize.query(`
        SELECT COALESCE(el."severity"::text, '(unknown)') AS label,
               COUNT(*)::int AS value
        FROM "ErrorLogs" el
        LEFT JOIN "Users" u ON u.id = el."userId"
        WHERE ${whereSql}
        GROUP BY label
        ORDER BY value DESC
        LIMIT 10
    `, { type: QueryTypes.SELECT, replacements });

    const topUrls = await db.sequelize.query(`
        SELECT COALESCE(NULLIF(split_part(el."url", '?', 1), ''), '(unknown)') AS label,
               COUNT(*)::int AS value
        FROM "ErrorLogs" el
        LEFT JOIN "Users" u ON u.id = el."userId"
        WHERE ${whereSql}
        GROUP BY label
        ORDER BY value DESC
        LIMIT 10
    `, { type: QueryTypes.SELECT, replacements });

    const recentErrors = await db.sequelize.query(`
        SELECT el.id, el."source", el."severity", el."message", el."url", el."ipAddress", el."resolved", el."createdAt",
               COALESCE(NULLIF(u."username", ''), 'User #' || el."userId", '(unknown)') AS username
        FROM "ErrorLogs" el
        LEFT JOIN "Users" u ON u.id = el."userId"
        WHERE ${whereSql}
        ORDER BY el."createdAt" DESC
        LIMIT :errorLimit
    `, { type: QueryTypes.SELECT, replacements: Object.assign({}, replacements, { errorLimit: filters.limit }) });

    return {
        available: true,
        total: toInt(totalRow && totalRow.total),
        unresolved: toInt(totalRow && totalRow.unresolved),
        errors: toInt(totalRow && totalRow.errors),
        warnings: toInt(totalRow && totalRow.warnings),
        backend: toInt(totalRow && totalRow.backend),
        frontend: toInt(totalRow && totalRow.frontend),
        topSeverities,
        topUrls: topUrls.map(row => ({ label: safeUrl(row.label), value: row.value })),
        recentErrors: recentErrors.map(row => ({
            id: row.id,
            source: row.source,
            severity: row.severity,
            message: safeErrorMessage(row.message),
            url: safeUrl(row.url),
            ipAddress: row.ipAddress || '',
            resolved: !!row.resolved,
            createdAt: row.createdAt,
            username: row.username || '(unknown)'
        }))
    };
}

function configuredLogPaths() {
    const paths = [];
    const configured = process.env.LOG_DASHBOARD_PATHS || process.env.RX_LOG_DASHBOARD_PATHS || '';
    if (configured) {
        configured.split(';').forEach(item => {
            if (item && item.trim()) paths.push(item.trim());
        });
    }

    const appRoot = getAppRoot();
    const runDir = getWritableRoot();
    const candidates = [
        path.join(runDir, 'logs'),
        path.join(appRoot, 'logs'),
        path.join(path.dirname(runDir), 'logs'),
        'C:\\RX-Tracker\\logs',
        'C:\\RX-Tracker\\RX-APP\\logs'
    ];

    candidates.forEach(candidate => paths.push(candidate));

    const seen = new Set();
    return paths.filter(item => {
        const key = String(item).toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

async function statIfReadable(target) {
    try {
        await fs.promises.access(target, fs.constants.R_OK);
        return await fs.promises.stat(target);
    } catch (_err) {
        return null;
    }
}

async function listLogFiles(pathsToScan) {
    const files = [];
    const missing = [];

    for (const configuredPath of pathsToScan) {
        const stat = await statIfReadable(configuredPath);
        if (!stat) {
            missing.push(configuredPath);
            continue;
        }
        if (stat.isFile()) {
            if (configuredPath.toLowerCase().endsWith('.log')) files.push(configuredPath);
            continue;
        }
        if (!stat.isDirectory()) continue;
        const entries = await fs.promises.readdir(configuredPath, { withFileTypes: true });
        entries.forEach(entry => {
            if (entry.isFile() && entry.name.toLowerCase().endsWith('.log')) {
                files.push(path.join(configuredPath, entry.name));
            }
        });
    }

    return { files, missing };
}

async function readTail(filePath, maxBytes) {
    const stat = await fs.promises.stat(filePath);
    const length = Math.min(stat.size, maxBytes);
    const start = Math.max(0, stat.size - length);
    if (!length) return { text: '', size: stat.size, modifiedAt: stat.mtime };
    const handle = await fs.promises.open(filePath, 'r');
    try {
        const buffer = Buffer.alloc(length);
        await handle.read(buffer, 0, length, start);
        return { text: buffer.toString('utf8'), size: stat.size, modifiedAt: stat.mtime };
    } finally {
        await handle.close();
    }
}

function parseTimestamp(line, fallbackDate) {
    const iso = line.match(/\[(\d{4}-\d{2}-\d{2}T[^\]]+Z)\]/);
    if (iso) return new Date(iso[1]);
    const plainIso = line.match(/(\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?)/);
    if (plainIso) {
        const parsed = new Date(plainIso[1]);
        if (!Number.isNaN(parsed.getTime())) return parsed;
    }
    return fallbackDate || new Date();
}

function parseHttpLine(line) {
    const combined = line.match(/^(\S+) \S+ \S+ \[([^\]]+)\] "([A-Z]+) ([^"]*?) HTTP\/[\d.]+" (\d{3}) (\S+)(?: "([^"]*)" "([^"]*)")?/);
    if (combined) {
        return {
            ip: combined[1],
            method: combined[3],
            url: safeUrl(combined[4]),
            status: Number(combined[5]),
            bytes: combined[6] === '-' ? 0 : Number(combined[6])
        };
    }

    const dev = line.match(/^([A-Z]+) ([^\s]+) (\d{3}) ([\d.]+) ms - (\S+)/);
    if (dev && HTTP_METHODS.has(dev[1])) {
        return {
            ip: '',
            method: dev[1],
            url: safeUrl(dev[2]),
            status: Number(dev[3]),
            durationMs: Number(dev[4]),
            bytes: dev[5] === '-' ? 0 : Number(dev[5])
        };
    }

    return null;
}

function classifyLogLine(line, http) {
    if (http) return 'http';
    const lower = String(line || '').toLowerCase();
    if (lower.includes('error') || lower.includes('failed') || lower.includes('fatal') || lower.includes('enoent') || lower.includes('exception')) return 'error';
    if (lower.includes('warn') || lower.includes('denied') || lower.includes('blocked')) return 'warning';
    if (lower.includes('login')) return 'login';
    if (lower.includes('backup')) return 'backup';
    if (lower.includes('scheduler') || lower.includes('cron')) return 'scheduler';
    if (lower.includes('server is running') || lower.includes('running on')) return 'startup';
    return 'system';
}

function buildLogEvent(line, source, modifiedAt) {
    const trimmed = String(line || '').trim();
    if (!trimmed) return null;

    const http = parseHttpLine(trimmed);
    const timestamp = parseTimestamp(trimmed, modifiedAt);
    const type = classifyLogLine(trimmed, http);
    const status = http ? http.status : 0;
    const severity = http
        ? (status >= 500 ? 'error' : (status >= 400 ? 'warning' : 'info'))
        : (type === 'error' ? 'error' : (type === 'warning' ? 'warning' : 'info'));

    return {
        timestamp,
        source,
        type,
        severity,
        method: http ? http.method : '',
        path: http ? http.url : '',
        status,
        statusInfo: http ? statusInfo(status) : null
    };
}

async function scanLogFiles(since, filters) {
    const pathsToScan = configuredLogPaths();
    const listed = await listLogFiles(pathsToScan);
    const files = listed.files
        .sort((a, b) => {
            try {
                return fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs;
            } catch (_err) {
                return 0;
            }
        })
        .slice(0, 25);

    const totals = { events: 0, http: 0, errors: 0, warnings: 0, serverErrors: 0, clientErrors: 0 };
    const byStatus = Object.create(null);
    const byPath = Object.create(null);
    const byType = Object.create(null);
    const bySource = Object.create(null);
    const byMethod = Object.create(null);
    const timeline = Object.create(null);
    const recentEvents = [];
    const filesRead = [];

    for (const filePath of files) {
        const tail = await readTail(filePath, 384 * 1024);
        filesRead.push({ path: filePath, size: tail.size, modifiedAt: tail.modifiedAt });
        const lines = tail.text.split(/\r?\n/);

        lines.forEach(line => {
            const event = buildLogEvent(line, path.basename(filePath), tail.modifiedAt);
            if (!event || event.timestamp < since) return;
            if (filters.status && String(event.status || '') !== filters.status) return;
            if (filters.path && (!event.path || event.path.toLowerCase().indexOf(filters.path.toLowerCase()) === -1)) return;
            if (filters.source && event.source.toLowerCase().indexOf(filters.source.toLowerCase()) === -1) return;
            if (filters.method && event.method !== filters.method) return;
            if (filters.severity && event.severity !== filters.severity) return;
            if (filters.logType && event.type !== filters.logType) return;
            if (filters.search) {
                const needle = filters.search.toLowerCase();
                const haystack = [event.source, event.type, event.severity, event.method, event.path, String(event.status || '')].join(' ').toLowerCase();
                if (haystack.indexOf(needle) === -1) return;
            }

            totals.events++;
            if (event.type === 'http') totals.http++;
            if (event.severity === 'error') totals.errors++;
            if (event.severity === 'warning') totals.warnings++;
            if (event.status >= 500) totals.serverErrors++;
            if (event.status >= 400 && event.status < 500) totals.clientErrors++;

            inc(byType, event.type);
            inc(bySource, event.source);
            if (event.method) inc(byMethod, event.method);
            if (event.status) inc(byStatus, event.status);
            if (event.path) inc(byPath, event.path);

            const bucket = timelineBucket(event.timestamp, filters.range);
            if (!timeline[bucket]) {
                timeline[bucket] = { bucket, total: 0, info: 0, warnings: 0, errors: 0, http: 0 };
            }
            timeline[bucket].total++;
            if (event.severity === 'error') timeline[bucket].errors++;
            else if (event.severity === 'warning') timeline[bucket].warnings++;
            else timeline[bucket].info++;
            if (event.type === 'http') timeline[bucket].http++;

            recentEvents.push({
                timestamp: event.timestamp.toISOString(),
                source: event.source,
                type: event.type,
                severity: event.severity,
                method: event.method,
                path: event.path,
                status: event.status,
                statusInfo: event.statusInfo
            });
        });
    }

    recentEvents.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    return {
        paths: pathsToScan,
        missingPaths: listed.missing,
        filesRead,
        totals,
        timeline: Object.keys(timeline)
            .sort()
            .map(key => timeline[key])
            .slice(-500),
        topStatuses: topEntries(byStatus, 10).map(row => Object.assign({}, row, { info: statusInfo(row.label) })),
        topPaths: topEntries(byPath, 10),
        topTypes: topEntries(byType, 10),
        topSources: topEntries(bySource, 10),
        topMethods: topEntries(byMethod, 10),
        recentEvents: recentEvents.slice(0, filters.limit)
    };
}

function pushInsight(insights, level, title, detail, action) {
    insights.push({ level, title, detail, action });
}

function buildInsights(summary) {
    const insights = [];
    const page = summary.pageActivity || {};
    const pageTotals = page.totals || {};
    const errors = summary.errors || {};
    const logs = summary.logs || {};

    if (page.available && pageTotals.total) {
        if (pageTotals.serverErrors) {
            pushInsight(
                insights,
                'danger',
                'Users hit server errors while browsing',
                pageTotals.serverErrors + ' page visit(s) returned 500-level statuses.',
                'Open Error Logs and compare timestamps, users, and pages.'
            );
        }
        if (pageTotals.forbidden) {
            pushInsight(
                insights,
                'warning',
                'Permission blocks are visible',
                pageTotals.forbidden + ' page visit(s) returned 403 Forbidden.',
                'Review roles if the user expected access; otherwise hide blocked actions.'
            );
        }
        if (pageTotals.unauthorized) {
            pushInsight(
                insights,
                'warning',
                'Session/login issues are visible',
                pageTotals.unauthorized + ' page visit(s) returned 401 Login Required.',
                'Check session timeout, stale tabs, or cookie/proxy behavior.'
            );
        }
        if (page.topPages && page.topPages[0]) {
            pushInsight(
                insights,
                'good',
                'Most-used page identified',
                page.topPages[0].label + ' has ' + page.topPages[0].value + ' visit(s) in this window.',
                'Use it to focus performance and UX improvements where staff spend time.'
            );
        }
    } else if (page.available) {
        pushInsight(
            insights,
            'info',
            'No page visits in this time window',
            'The tracker is active, but no authenticated page views matched the filters.',
            'Try a wider range or clear filters.'
        );
    } else {
        pushInsight(
            insights,
            'warning',
            'Page activity table is unavailable',
            page.note || 'UserActivityLogs is missing.',
            'Run migrations/deploy the page activity tracking update.'
        );
    }

    if (errors.available && errors.unresolved) {
        pushInsight(
            insights,
            errors.errors ? 'danger' : 'warning',
            'Unresolved application errors exist',
            errors.unresolved + ' unresolved error log(s) are in the selected window.',
            'Use the Error Logs tab to mark fixed items resolved after review.'
        );
    }

    if (logs.totals && logs.totals.serverErrors) {
        pushInsight(
            insights,
            'danger',
            'Server logs show 500-level responses',
            logs.totals.serverErrors + ' server-log HTTP event(s) returned 500+.',
            'Compare server stdout/stderr around those times.'
        );
    }

    if (insights.length === 0) {
        pushInsight(
            insights,
            'good',
            'Operations look stable',
            'No critical page, audit, error, or log-file warning was detected in this view.',
            'Keep monitoring after deployments or permission changes.'
        );
    }

    return insights.slice(0, 10);
}

function buildStabilitySummary(summary) {
    const pageTotals = (summary.pageActivity && summary.pageActivity.totals) || {};
    const errorTotals = summary.errors || {};
    const logTotals = (summary.logs && summary.logs.totals) || {};
    const statusRows = []
        .concat((summary.pageActivity && summary.pageActivity.topStatuses) || [])
        .concat((summary.logs && summary.logs.topStatuses) || []);
    const statusCounts = Object.create(null);

    statusRows.forEach(row => {
        const code = String(row.label || row.code || '');
        statusCounts[code] = (statusCounts[code] || 0) + toInt(row.value);
    });

    let score = 100;
    score -= toInt(pageTotals.serverErrors) * 12;
    score -= toInt(pageTotals.clientErrors) * 2;
    score -= toInt(errorTotals.unresolved) * 2;
    score -= toInt(logTotals.serverErrors) * 5;
    score -= toInt(logTotals.errors);
    score -= toInt(pageTotals.unauthorized);
    score -= toInt(pageTotals.forbidden) * 2;
    score = Math.max(0, Math.min(100, score));

    const dangerousStatuses = [401, 403, 404, 409, 429, 500, 502, 503, 504].map(code => ({
        code,
        count: toInt(statusCounts[String(code)]),
        info: statusInfo(code)
    })).filter(item => item.count > 0);

    return {
        score,
        level: score >= 85 ? 'good' : (score >= 65 ? 'warning' : 'danger'),
        label: score >= 85 ? 'Stable' : (score >= 65 ? 'Needs Review' : 'High Risk'),
        dangerousStatuses,
        signals: [
            { label: 'Page 500 errors', value: toInt(pageTotals.serverErrors), level: toInt(pageTotals.serverErrors) ? 'danger' : 'good' },
            { label: 'Page 4xx client blocks', value: toInt(pageTotals.clientErrors), level: toInt(pageTotals.clientErrors) ? 'warning' : 'good' },
            { label: 'Unresolved app errors', value: toInt(errorTotals.unresolved), level: toInt(errorTotals.unresolved) ? 'danger' : 'good' },
            { label: 'Server-log errors', value: toInt(logTotals.errors), level: toInt(logTotals.errors) ? 'danger' : 'good' },
            { label: '401 login/session events', value: toInt(pageTotals.unauthorized), level: toInt(pageTotals.unauthorized) ? 'warning' : 'good' },
            { label: '403 role blocks', value: toInt(pageTotals.forbidden), level: toInt(pageTotals.forbidden) ? 'warning' : 'good' }
        ]
    };
}

function buildFilterOptions(summary) {
    const page = summary.pageActivity || {};
    const audit = summary.audit || {};
    const errors = summary.errors || {};
    const logs = summary.logs || {};
    const visits = page.recentVisits || [];
    const auditEvents = audit.recentEvents || [];
    const errorEvents = errors.recentErrors || [];
    const serverEvents = logs.recentEvents || [];
    const statusCodes = labelsFromRows(page.topStatuses || [])
        .concat(labelsFromRows(logs.topStatuses || []))
        .concat(visits.map(row => row.statusCode))
        .concat(serverEvents.map(row => row.status));

    return {
        users: uniqueList(
            labelsFromRows(page.topUsers || [])
                .concat(visits.map(row => row.username))
                .concat(auditEvents.map(row => row.username))
                .concat(errorEvents.map(row => row.username)),
            50
        ),
        roles: uniqueList(
            labelsFromRows(page.topRoles || [])
                .concat(visits.map(row => row.role)),
            30
        ),
        pages: uniqueList(
            labelsFromRows(page.topPages || [])
                .concat(visits.map(row => row.pagePath))
                .concat(visits.map(row => row.pageTitle))
                .concat(labelsFromRows(logs.topPaths || []))
                .concat(labelsFromRows(errors.topUrls || []))
                .concat(serverEvents.map(row => row.path)),
            80
        ),
        ips: uniqueList(
            labelsFromRows(page.topIps || [])
                .concat(visits.map(row => row.ipAddress))
                .concat(auditEvents.map(row => row.ipAddress))
                .concat(errorEvents.map(row => row.ipAddress)),
            60
        ),
        browsers: uniqueList(
            labelsFromRows(page.topBrowsers || [])
                .concat(visits.map(row => row.browser)),
            30
        ),
        statuses: uniqueList(statusCodes.map(code => {
            const info = statusInfo(code);
            return info.code ? String(info.code) + ' ' + info.label : '';
        }), 30),
        sources: uniqueList(
            labelsFromRows(logs.topSources || [])
                .concat(errorEvents.map(row => row.source))
                .concat(serverEvents.map(row => row.source))
                .concat(['backend', 'frontend']),
            50
        ),
        methods: uniqueList(
            labelsFromRows(logs.topMethods || [])
                .concat(serverEvents.map(row => row.method))
                .concat(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD']),
            20
        ),
        severities: uniqueList(
            labelsFromRows(errors.topSeverities || [])
                .concat(serverEvents.map(row => row.severity))
                .concat(['error', 'warning', 'info']),
            20
        ),
        logTypes: uniqueList(
            labelsFromRows(logs.topTypes || [])
                .concat(serverEvents.map(row => row.type)),
            30
        )
    };
}

async function buildLogDashboardSummary(rawFilters) {
    const filters = normalizeFilters(rawFilters || {});
    const since = buildSinceDate(filters.range, filters.hours);

    const pageActivity = await readPageActivity(since, filters);
    const audit = await readAuditSummary(since, filters);
    const errors = await readErrorSummary(since, filters);
    const logs = await scanLogFiles(since, filters);

    const summary = {
        ok: true,
        generatedAt: new Date().toISOString(),
        filters: Object.assign({}, filters, { since: since.toISOString() }),
        statusGuide: [200, 201, 204, 301, 302, 304, 400, 401, 403, 404, 409, 429, 500, 502, 503, 504].map(statusInfo),
        pageActivity,
        audit,
        errors,
        logs
    };
    summary.filterOptions = buildFilterOptions(summary);
    summary.insights = buildInsights(summary);
    summary.stability = buildStabilitySummary(summary);
    return summary;
}

module.exports = {
    buildLogDashboardSummary,
    buildSinceDate,
    statusInfo
};
