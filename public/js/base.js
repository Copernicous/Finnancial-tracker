// base.js — Proxy-aware base path detection.
// FortiGate Agentless VPN Portal rewrites href attributes on <a> elements,
// so a hidden <a id="xa-base" href="/login"> becomes the full proxy URL
// e.g. https://accounting.example.com:10443/proxy/513c244a/http/192.168.15.87:3000/login
// We strip the trailing "/login" to get the base path prefix for ALL navigation.
//
// Usage (available globally after this script loads):
//   window.HA_BASE      — e.g. "https://accounting.example.com:10443/proxy/513c244a/http/192.168.15.87:3000"
//   window.appUrl(path)  — returns the full proxy-aware URL for any app path
//   window.appNav(path)  — navigates to a proxy-aware URL (replaces window.location.href)

(function () {
    function storedTheme() {
        try { return localStorage.getItem('haTheme'); } catch (e) { return null; }
    }
    function systemTheme() {
        try {
            return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
        } catch (e) { return 'light'; }
    }
    function currentTheme() {
        var stored = storedTheme();
        return stored === 'dark' || stored === 'light' ? stored : systemTheme();
    }
    function syncThemeButtons(theme) {
        var buttons = document.querySelectorAll('[data-theme-toggle], .ha-theme-toggle, #themeToggle');
        for (var i = 0; i < buttons.length; i++) {
            var btn = buttons[i];
            btn.innerHTML = theme === 'dark' ? '<i class="fas fa-sun"></i>' : '<i class="fas fa-moon"></i>';
            btn.setAttribute('aria-label', theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode');
            btn.setAttribute('title', theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode');
            btn.setAttribute('aria-pressed', theme === 'dark' ? 'true' : 'false');
        }
    }
    function applyTheme(theme, persist) {
        theme = theme === 'dark' ? 'dark' : 'light';
        document.documentElement.setAttribute('data-theme', theme);
        if (persist !== false) {
            try { localStorage.setItem('haTheme', theme); } catch (e) {}
        }
        document.documentElement.style.colorScheme = theme;
        if (document.body) document.body.style.colorScheme = theme;
        syncThemeButtons(theme);
    }
    function bindThemeToggles() {
        syncThemeButtons(document.documentElement.getAttribute('data-theme') || currentTheme());
        var buttons = document.querySelectorAll('[data-theme-toggle], .ha-theme-toggle, #themeToggle');
        for (var i = 0; i < buttons.length; i++) {
            var btn = buttons[i];
            if (btn.getAttribute('data-theme-bound') === '1') continue;
            btn.setAttribute('data-theme-bound', '1');
            btn.addEventListener('click', function() {
                var next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
                applyTheme(next, true);
            });
        }
    }

    window.haSetTheme = applyTheme;
    window.haToggleTheme = function() {
        applyTheme(document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark', true);
    };
    window.haBindThemeToggles = bindThemeToggles;
    applyTheme(currentTheme(), false);
    document.addEventListener('DOMContentLoaded', bindThemeToggles);

    var base = '';

    // The anchor xa-base must exist in every page with href="/login"
    // FortiGate rewrites the href to its proxied equivalent.
    var el = document.getElementById('xa-base');
    if (el && el.href) {
        // el.href is the FULLY-RESOLVED URL (browsers always resolve href to absolute)
        // e.g. "https://accounting.example.com:10443/proxy/513c244a/http/192.168.15.87:3000/login"
        var full = el.href;
        // Strip the "/login" suffix (and any trailing slash) to get base
        base = full.replace(/\/login\/?$/, '').replace(/\/$/, '');
    }

    // Fallback: if no anchor or href (direct local access), derive from location
    if (!base) {
        base = window.location.origin;
    }

    window.HA_BASE = base;

    /**
     * Returns the absolute, proxy-aware URL for an app-root-relative path.
     * path must start with '/', e.g. '/api/auth/login', '/dashboard'
     */
    window.appUrl = function (path) {
        return base + path;
    };

    /**
     * Navigates to a proxy-aware URL (hard navigation).
     */
    window.appNav = function (path) {
        window.location.href = base + path;
    };
})();

// ─── Security Utilities (globally available) ─────────────────────────────────

/**
 * escHtml — sanitize a string before inserting into innerHTML.
 * Converts <, >, &, " to safe HTML entities so user-supplied content
 * cannot execute as HTML/JS (prevents XSS via audit log, names, etc.)
 * Usage: element.innerHTML = escHtml(untrustedString);
 */
function escHtml(s) {
    return String(s == null ? '' : s)
        .replace(/&/g,  '&amp;')
        .replace(/</g,  '&lt;')
        .replace(/>/g,  '&gt;')
        .replace(/"/g,  '&quot;')
        .replace(/'/g,  '&#x27;');
}

/**
 * sanitizeCsvCell — prevent CSV/spreadsheet formula injection.
 * If a cell value starts with =, +, -, @, tab, or carriage return,
 * Excel/LibreOffice would execute it as a formula. Prefix with ' to neutralize.
 * Usage: replace all cell values with sanitizeCsvCell(value) before building CSV.
 */
function sanitizeCsvCell(val) {
    var s = String(val == null ? '' : val);
    if (s.length > 0 && ['=', '+', '-', '@', '\t', '\r'].indexOf(s[0]) !== -1) {
        s = "'" + s;
    }
    return '"' + s.replace(/"/g, '""') + '"';
}

// ─── Active Session Heartbeat ─────────────────────────────────────────────────
// Sends the current page title + URL to the server every 30s so the
// "Who's Online" dashboard (active-users page) can track logged-in users.
// Uses the appUrl() helper from base.js for FortiGate proxy compatibility.
(function () {
    function _haHeartbeat() {
        var token = localStorage.getItem('haToken') || localStorage.getItem('token');
        if (!token) return; // not logged in — skip silently
        var url = typeof window.appUrl === 'function' ? window.appUrl('/api/heartbeat') : '/api/heartbeat';
        fetch(url, {
            method: 'POST',
            credentials: 'include',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + token
            },
            body: JSON.stringify({
                currentPage: document.title.replace(/ - Home Accounting$/, '').trim(),
                currentUrl:  window.location.pathname
            }),
            keepalive: true
        }).catch(function () {}); // fail silently — non-critical
    }

    // Fire immediately, then every 30 seconds
    _haHeartbeat();
    setInterval(_haHeartbeat, 30000);
})();

// ─── Client-Side Error Logger ─────────────────────────────────────────────────
// Logs frontend errors to POST /api/errors so developers can review them
// from the Audit Log → Error Log tab without needing to reproduce the issue.
//
// Usage anywhere in the app:
//   window.logClientError('Network error.', e.message + '\n' + e.stack, 'error');
//   window.logClientError('Validation failed', 'Missing field: arrivalDate', 'warning');
//
// severity: 'error' | 'warning' | 'info'
window.logClientError = function (message, detail, severity) {
    try {
        var token = localStorage.getItem('haToken') || localStorage.getItem('token');
        if (!token) return; // not authenticated — skip
        var url = typeof window.appUrl === 'function' ? window.appUrl('/api/errors') : '/api/errors';
        var stack = detail || '';
        // Append page context to make the log actionable
        stack += '\n\nPage: ' + document.title + ' (' + window.location.pathname + ')';
        fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + token
            },
            body: JSON.stringify({
                message:  message  || 'Unknown client error',
                stack:    stack,
                url:      window.location.href,
                severity: severity || 'error'
            }),
            keepalive: true
        }).catch(function () {}); // never let logging itself crash the app
    } catch (e) { /* never let logging itself crash the app */ }
};

// ─── Auto-catch ALL unhandled JS errors + Promise rejections ─────────────────
// Any crash or unhandled rejection anywhere in the app is now automatically
// saved to the ErrorLog DB table — no manual try/catch needed.
(function () {
    // Uncaught JS errors (syntax errors, null references, etc.)
    window.addEventListener('error', function (evt) {
        var msg = evt.message || 'Uncaught JS error';
        var detail = 'Source: ' + evt.filename + ':' + evt.lineno + ':' + evt.colno;
        if (evt.error && evt.error.stack) detail += '\n' + evt.error.stack;
        window.logClientError(msg, detail, 'error');
    });

    // Unhandled Promise rejections (fetch failures, async errors, etc.)
    window.addEventListener('unhandledrejection', function (evt) {
        var reason = evt.reason;
        var msg = reason instanceof Error ? reason.message : String(reason || 'Unhandled promise rejection');
        var detail = reason instanceof Error && reason.stack ? reason.stack : '';
        window.logClientError(msg, detail, 'error');
    });
})();


