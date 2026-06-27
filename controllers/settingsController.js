const settings = require('../services/settingsService');
const { extractRoutes } = require('../utils/routeInspector');

exports.getAll = (req, res) => {
    res.json(settings.getAll(false));
};

exports.getTimezones = (req, res) => {
    res.json(settings.KNOWN_TIMEZONES);
};

exports.getSessionConfig = (req, res) => {
    const rawMinutes = parseInt(settings.get('session_timeout_minutes') || process.env.SESSION_TIMEOUT_MINUTES || '30', 10);
    const sessionTimeoutMinutes = Number.isFinite(rawMinutes) ? Math.min(Math.max(rawMinutes, 5), 480) : 30;
    res.json({ sessionTimeoutMinutes, warningSeconds: 120 });
};

exports.getEmailStatus = (req, res) => {
    res.json({
        configured: settings.isSmtpConfigured(),
        smtp_host: settings.get('smtp_host') || '',
        smtp_port: settings.get('smtp_port') || '587',
        smtp_user: settings.get('smtp_user') || '',
        smtp_from_name: settings.get('smtp_from_name') || 'Home Accounting',
        smtp_pass_set: !!settings.get('smtp_pass')
    });
};

exports.update = async (req, res) => {
    try {
        const updates = req.body;
        if (!updates || typeof updates !== 'object') {
            return res.status(400).json({ error: 'Request body must be a JSON object of { key: value } pairs.' });
        }
        for (const [key, value] of Object.entries(updates)) {
            if (key === 'app_timezone' && !settings.KNOWN_TIMEZONES.includes(value)) {
                return res.status(400).json({ error: `Unknown timezone: "${value}". Please select a value from the list.` });
            }
            if (key === 'smtp_port' && (isNaN(value) || parseInt(value, 10) < 1 || parseInt(value, 10) > 65535)) {
                return res.status(400).json({ error: 'SMTP port must be a number between 1 and 65535.' });
            }
            if (key === 'smtp_pass' && value === '') continue;
            await settings.set(key, String(value));
        }
        res.json({ ok: true, settings: settings.getAll(false) });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
};

exports.getApiRoutes = (req, res) => {
    try {
        const app = require('../app');
        const routes = extractRoutes(app, '');
        const categoryOrder = ['accounting', 'reports', 'settings', 'auth', 'admin', 'other'];
        const labels = {
            accounting: 'Accounting Data',
            reports: 'Reports',
            settings: 'Reference & Settings',
            auth: 'Authentication',
            admin: 'Admin Only',
            other: 'Other'
        };
        const colors = {
            accounting: '#0d6efd',
            reports: '#06b6d4',
            settings: '#64748b',
            auth: '#0ea5e9',
            admin: '#ef4444',
            other: '#6b7280'
        };
        function categorize(route) {
            if (route.path.includes('/auth')) return 'auth';
            if (route.path.includes('/reports')) return 'reports';
            if (route.path.includes('/settings') || route.path.includes('/roles') || route.path.includes('/categories') || route.path.includes('/financial-institutions')) return 'settings';
            if (route.path.includes('/users') || route.path.includes('/backups') || route.path.includes('/audit') || route.path.includes('/active-sessions') || route.path.includes('/import')) return 'admin';
            if (route.path.includes('/accounts') || route.path.includes('/transactions') || route.path.includes('/reconciliations') || route.path.includes('/proof-documents') || route.path.includes('/simulation')) return 'accounting';
            return 'other';
        }

        const groups = {};
        for (const route of routes) {
            const category = categorize(route);
            if (!groups[category]) groups[category] = [];
            groups[category].push({
                method: route.method,
                path: route.path,
                desc: 'Live Home Accounting endpoint.',
                perm: 'Authenticated',
                admin: category === 'admin',
                query: null,
                body: null,
                inManifest: false
            });
        }

        const sections = [];
        const ordered = [...categoryOrder, ...Object.keys(groups).filter((category) => !categoryOrder.includes(category))];
        for (const category of ordered) {
            if (!groups[category]) continue;
            sections.push({
                id: category,
                label: labels[category] || category,
                color: colors[category] || '#6b7280',
                endpoints: groups[category]
            });
        }
        res.json({ totalRoutes: routes.length, sections, generatedAt: new Date().toISOString() });
    } catch (e) {
        console.error('[getApiRoutes]', e.message);
        res.status(500).json({ error: e.message });
    }
};
