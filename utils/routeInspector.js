/**
 * routeInspector.js
 *
 * Walks an Express app's router stack to extract all registered API routes.
 * Mount prefixes are read from the ._mountPrefix tag attached to each sub-router
 * in app.js (since Express does not expose the mount path in layer properties
 * in all versions).
 *
 * Usage:
 *   const { extractRoutes } = require('./utils/routeInspector');
 *   const routes = extractRoutes(app);
 */

/**
 * Walk a single router's stack, applying the given prefix to all routes found.
 * @param {Array}  stack   - router.stack
 * @param {string} prefix  - path prefix already accumulated (e.g. '/api')
 * @returns {Array<{method:string, path:string}>}
 */
function walkRouterStack(stack, prefix) {
    if (!Array.isArray(stack)) return [];
    const results = [];

    for (const layer of stack) {
        // ── Concrete route (GET /foo, POST /bar, etc.) ─────────────────────
        if (layer.route) {
            const fullPath = prefix + (layer.route.path || '');
            const methods  = Object.keys(layer.route.methods || {})
                .filter(m => m !== '_all' && layer.route.methods[m])
                .map(m => m.toUpperCase());
            for (const method of methods) {
                results.push({ method, path: fullPath });
            }
            continue;
        }

        // ── Nested router / middleware with its own stack ──────────────────
        const handle = layer.handle;
        if (!handle || !Array.isArray(handle.stack)) continue;

        // Use the _mountPrefix tag if we set it; otherwise accumulate nothing
        const subPrefix = typeof handle._mountPrefix === 'string'
            ? handle._mountPrefix
            : prefix;                   // fallback: keep current prefix

        const nested = walkRouterStack(handle.stack, subPrefix);
        results.push(...nested);
    }

    return results;
}

/**
 * Extract all routes from an Express app.
 * Filters out internal/web routes (non-/api paths) so only REST API routes
 * are returned in the reference panel.
 *
 * @param {Object}  app            - Express app instance
 * @param {boolean} apiOnly        - if true (default), only return /api/* routes
 * @returns {Array<{method:string, path:string}>}
 */
exports.extractRoutes = (app, apiOnly = true) => {
    // app.router is Express's getter that returns (and lazily inits) the router
    const router = app._router || app.router;
    if (!router || !Array.isArray(router.stack)) {
        console.warn('[routeInspector] Router stack not accessible');
        return [];
    }

    const all = walkRouterStack(router.stack, '');

    // Deduplicate
    const seen = new Set();
    const unique = all.filter(r => {
        const k = r.method + ' ' + r.path;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
    });

    // Filter to API routes only (skip web/view routes)
    const filtered = apiOnly
        ? unique.filter(r => r.path.startsWith('/api/') || r.path === '/api')
        : unique;

    return filtered.sort((a, b) => {
        const pa = a.path.toLowerCase(), pb = b.path.toLowerCase();
        if (pa < pb) return -1;
        if (pa > pb) return 1;
        return a.method.localeCompare(b.method);
    });
};
