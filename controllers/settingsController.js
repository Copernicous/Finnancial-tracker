const settings       = require('../services/settingsService');
const { extractRoutes } = require('../utils/routeInspector');
const routeManifest  = require('../config/routeManifest');

// GET /api/settings — returns all current settings (sensitive keys masked)
exports.getAll = (req, res) => {
    res.json(settings.getAll(false)); // false = mask passwords
};

// GET /api/settings/timezones — returns list of valid timezone options
exports.getTimezones = (req, res) => {
    res.json(settings.KNOWN_TIMEZONES);
};

// GET /api/session-config - authenticated users can read non-sensitive session timing.
exports.getSessionConfig = (req, res) => {
    const rawMinutes = parseInt(settings.get('session_timeout_minutes') || process.env.SESSION_TIMEOUT_MINUTES || '30', 10);
    const sessionTimeoutMinutes = Number.isFinite(rawMinutes) ? Math.min(Math.max(rawMinutes, 5), 480) : 30;
    res.json({
        sessionTimeoutMinutes,
        warningSeconds: 120
    });
};

// GET /api/settings/email-status — returns SMTP config without password, + configured flag
exports.getEmailStatus = (req, res) => {
    res.json({
        configured:    settings.isSmtpConfigured(),
        smtp_host:     settings.get('smtp_host')      || '',
        smtp_port:     settings.get('smtp_port')      || '587',
        smtp_user:     settings.get('smtp_user')      || '',
        smtp_from_name:settings.get('smtp_from_name') || 'Home Accounting',
        smtp_pass_set: !!(settings.get('smtp_pass'))  // just boolean — never send the value
    });
};

// PUT /api/settings — update one or more settings (Admin only)
exports.update = async (req, res) => {
    try {
        const updates = req.body; // { key: value, ... }
        if (!updates || typeof updates !== 'object') {
            return res.status(400).json({ error: 'Request body must be a JSON object of { key: value } pairs.' });
        }

        for (const [key, value] of Object.entries(updates)) {
            // Timezone validation
            if (key === 'app_timezone' && !settings.KNOWN_TIMEZONES.includes(value)) {
                return res.status(400).json({ error: `Unknown timezone: "${value}". Please select a value from the list.` });
            }
            // Port must be numeric
            if (key === 'smtp_port' && (isNaN(value) || parseInt(value) < 1 || parseInt(value) > 65535)) {
                return res.status(400).json({ error: 'SMTP port must be a number between 1 and 65535.' });
            }
            // Allow clearing smtp_pass by sending empty string (don't overwrite with empty)
            if (key === 'smtp_pass' && value === '') {
                continue; // skip — don't erase existing password with empty
            }
            await settings.set(key, String(value));
        }

        // Return masked copy
        res.json({ ok: true, settings: settings.getAll(false) });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
};

// GET /api/settings/api-routes — returns all live routes merged with manifest metadata
// The Express app is lazily required to avoid a circular dependency at boot time.
exports.getApiRoutes = (req, res) => {
    try {
        const app = require('../app');           // lazy require — safe after boot
        const routes = extractRoutes(app, '');

        const CATEGORY_ORDER = ['patients','rx','dashboard','reports','email','settings','auth','admin'];
        const CATEGORY_LABELS = {
            patients:'Patients', rx:'RX Records', dashboard:'Dashboard',
            reports:'Reports', email:'Email', settings:'Reference & Settings',
            auth:'Authentication', admin:'Admin Only'
        };
        const CATEGORY_COLORS = {
            patients:'#6366f1', rx:'#22c55e', dashboard:'#f59e0b',
            reports:'#06b6d4', email:'#8b5cf6', settings:'#64748b',
            auth:'#0ea5e9', admin:'#ef4444'
        };

        // Group routes by category using manifest; unknowns go to 'other'
        const groups = {};
        for (const route of routes) {
            const key = route.method + " " + route.path;
            const meta = routeManifest[key] || {};
            const cat  = meta.category || 'other';
            if (!groups[cat]) groups[cat] = [];
            groups[cat].push({
                method:  route.method,
                path:    route.path,
                desc:    meta.desc   || 'No description available.',
                perm:    meta.perm   || 'Authenticated',
                admin:   !!meta.admin,
                query:   meta.query  || null,
                body:    meta.body   || null,
                inManifest: !!routeManifest[key]
            });
        }

        // Build ordered sections
        const sections = [];
        const orderedCats = [...CATEGORY_ORDER, ...Object.keys(groups).filter(c => !CATEGORY_ORDER.includes(c))];
        for (const cat of orderedCats) {
            if (!groups[cat]) continue;
            sections.push({
                id:       cat,
                label:    CATEGORY_LABELS[cat] || cat.charAt(0).toUpperCase() + cat.slice(1),
                color:    CATEGORY_COLORS[cat] || '#6b7280',
                endpoints: groups[cat]
            });
        }

        res.json({
            totalRoutes: routes.length,
            sections,
            generatedAt: new Date().toISOString()
        });
    } catch (e) {
        console.error('[getApiRoutes]', e.message);
        res.status(500).json({ error: e.message });
    }
};

