'use strict';

/**
 * dateUtils.js â€” Centralised date normalisation for the Home Accounting
 *
 * The app stores all dates as YYYY-MM-DD (ISO 8601) in PostgreSQL.
 * Users may enter dates in multiple formats (the browser shows MM/DD/YYYY
 * on US-locale machines, the picker returns YYYY-MM-DD in .value, and
 * CSV imports may contain either).
 *
 * Two functions exported:
 *   parseDate(input)  â†’ 'YYYY-MM-DD' string  OR  null  (never throws)
 *   formatDate(input) â†’ 'MM/DD/YYYY' string  OR  ''    (for display)
 */

/**
 * parseDate â€” accept any common date string and return YYYY-MM-DD.
 *
 * Accepted formats (case-insensitive, leading zeros optional):
 *   YYYY-MM-DD       (ISO â€” from <input type=date> .value, DB read-back)
 *   MM/DD/YYYY       (US locale â€” user typed, CSV)
 *   M/D/YYYY         (US short)
 *   MM-DD-YYYY       (dash variant)
 *   DD/MM/YYYY is NOT supported to avoid ambiguity with MM/DD/YYYY
 *
 * Returns null for blank, undefined, 'Invalid date', or unparseable input.
 */
function parseDate(input) {
    if (!input) return null;
    const s = String(input).trim();
    if (!s || s.toLowerCase() === 'invalid date') return null;

    // Already ISO: YYYY-MM-DD
    const isoMatch = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (isoMatch) {
        const [, y, m, d] = isoMatch;
        if (_validParts(y, m, d)) return `${y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`;
        return null;
    }

    // MM/DD/YYYY or M/D/YYYY or MM-DD-YYYY
    const usMatch = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
    if (usMatch) {
        const [, m, d, y] = usMatch;
        if (_validParts(y, m, d)) return `${y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`;
        return null;
    }

    // Try native Date parsing as last resort (handles ISO with time, etc.)
    const dt = new Date(s);
    if (!isNaN(dt.getTime())) {
        const y = dt.getUTCFullYear();
        const m = String(dt.getUTCMonth() + 1).padStart(2, '0');
        const d = String(dt.getUTCDate()).padStart(2, '0');
        return `${y}-${m}-${d}`;
    }

    return null;
}

/**
 * formatDate â€” display a stored YYYY-MM-DD (or any parseable date) as MM/DD/YYYY.
 * Returns empty string for null/invalid.
 */
function formatDate(input) {
    const iso = parseDate(input);
    if (!iso) return '';
    const [y, m, d] = iso.split('-');
    return `${m}/${d}/${y}`;
}

/** Internal: validate year/month/day are in sensible ranges */
function _validParts(y, m, d) {
    const yi = parseInt(y, 10);
    const mi = parseInt(m, 10);
    const di = parseInt(d, 10);
    return yi >= 1900 && yi <= 2200 &&
           mi >= 1   && mi <= 12   &&
           di >= 1   && di <= 31;
}

module.exports = { parseDate, formatDate };

