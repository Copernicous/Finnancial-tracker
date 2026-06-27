// audit-log.js — Extracted from audit-log.ejs inline script for FortiGate proxy compatibility.
// External JS files are not rewritten by FortiGate's content rewriter.

// API URL variables — FortiGate rewrites these string literals to full proxy URLs.
// All fetch calls use these variables so FortiGate can rewrite them safely.
var _uAlUsers    = '/api/audit-logs/users';
var _uAlModules  = '/api/audit-logs/modules';
var _uAlBulkDel  = '/api/audit-logs';
var _uAlRotate   = '/api/audit-logs/rotate';
var _uPageAct    = '/api/user-activity-logs';
var _uPageUsers  = '/api/user-activity-logs/users';
var _uPageRoles  = '/api/user-activity-logs/roles';
var _uPagePages  = '/api/user-activity-logs/pages';
var _uErrBulkRes = '/api/errors/bulk-resolve';
var _uErrBulkDel = '/api/errors/bulk-delete';
var _uErrDel     = '/api/errors';
'use strict';

const BADGE = { Login:'bg-success', Logout:'bg-secondary', Create:'bg-primary', Update:'bg-warning text-dark', Delete:'bg-danger', Disable:'bg-warning text-dark', Restore:'bg-info text-dark' };
const ROW_CLS = { Login:'row-login', Logout:'row-logout', Create:'row-create', Update:'row-update', Delete:'row-delete', Disable:'row-disable', Restore:'row-restore' };

// Extract human-readable record label from a log entry
function getRecordLabel(log) {
    let nv = log.newValue;
    if (typeof nv === 'string') { try { nv = JSON.parse(nv); } catch(e) { nv = null; } }
    const v = nv || {};
    // New entries have _label set by the middleware
    if (v._label) return v._label;
    // Fallback: parse known fields per module
    const m = log.module || '';
    const id = log.recordId;
    if (m === 'Patients' || (m.includes('Patient') && !m.includes('Transport')))
        return v.firstName && v.lastName ? (v.firstName + ' ' + v.lastName) : (id ? 'Patient #' + id : null);
    if (m === 'RX Records' || m === 'RX Workflow')
        return v.patientId ? 'Patient #' + v.patientId : (id ? 'RX #' + id : null);
    if (m === 'Pharmacies')
        return v.name || (id ? 'Pharmacy #' + id : null);
    if (m.includes('Transport'))
        return v.contactPerson || v.companyName || (id ? '#' + id : null);
    if (m === 'Workflow Actions')
        return v.name || (id ? 'Step #' + id : null);
    if (m === 'Clinics')
        return v.name || (id ? 'Clinic #' + id : null);
    if (m === 'Users')
        return v.username || (v.firstName && v.lastName ? v.firstName + ' ' + v.lastName : null) || (id ? 'User #' + id : null);
    if (m === 'Authentication')
        return log.User ? (log.User.firstName + ' ' + log.User.lastName) : null;
    return id ? '#' + id : null;
}

let currentPage = 1;
let pageSize    = 10;
let totalCount  = 0;
let currentLogs = [];
let selectedIds = new Set();
let isAdmin     = false;
let logsMap     = {};
let activityPage = 1;
let activityPageSize = 10;
let activityTotal = 0;
let currentActivityLogs = [];
let activityLoaded = false;

// Filter panel toggle
var _auditAdvOpen = false;
function toggleAuditAdv() {
    var el = document.getElementById('auditAdvPanel');
    var ch = document.getElementById('auditAdvChevron');
    _auditAdvOpen = !_auditAdvOpen;
    if (el) el.style.display = _auditAdvOpen ? '' : 'none';
    if (ch) ch.className    = _auditAdvOpen ? 'fas fa-chevron-up ms-1' : 'fas fa-chevron-down ms-1';
}

var _activityAdvOpen = false;
function toggleActivityAdv() {
    var el = document.getElementById('activityAdvPanel');
    var ch = document.getElementById('activityAdvChevron');
    _activityAdvOpen = !_activityAdvOpen;
    if (el) el.style.display = _activityAdvOpen ? '' : 'none';
    if (ch) ch.className = _activityAdvOpen ? 'fas fa-chevron-up ms-1' : 'fas fa-chevron-down ms-1';
}

function showAuditTab() {
    document.getElementById('auditTabPane').style.display = '';
    document.getElementById('activityTabPane').style.display = 'none';
    document.getElementById('auditTabBtn').classList.add('active');
    document.getElementById('activityTabBtn').classList.remove('active');
}

function showActivityTab() {
    document.getElementById('auditTabPane').style.display = 'none';
    document.getElementById('activityTabPane').style.display = '';
    document.getElementById('auditTabBtn').classList.remove('active');
    document.getElementById('activityTabBtn').classList.add('active');
    if (!activityLoaded) {
        activityLoaded = true;
        loadActivityPage();
    }
}

// Init
document.addEventListener('DOMContentLoaded', async function() {
    initApp();
    try {
        var _u = JSON.parse(localStorage.getItem('user') || '{}');
        if (_u.role === 'Administrator') {
            isAdmin = true;
            document.getElementById('adminZone').classList.remove('d-none');
            document.getElementById('actHeader').classList.remove('d-none');
            loadErrors();
        }
    } catch(e) {}
    await Promise.allSettled([loadUserFilter(), loadModuleFilter(), loadActionFilter()]);
    await Promise.allSettled([loadActivityUserFilter(), loadActivityRoleFilter(), loadActivityPageFilter()]);
    await loadPage();
    document.getElementById('auditTabBtn').addEventListener('click', showAuditTab);
    document.getElementById('activityTabBtn').addEventListener('click', showActivityTab);
    document.getElementById('searchBtn').addEventListener('click', function() { currentPage = 1; loadPage(); });
    document.getElementById('clearBtn').addEventListener('click', clearFilters);
    document.getElementById('exportBtn').addEventListener('click', exportAll);
    document.getElementById('pgSize').addEventListener('change', function(e) { pageSize = parseInt(e.target.value); currentPage = 1; loadPage(); });
    document.getElementById('selAll').addEventListener('change', function(e) { toggleAll(e.target.checked); });
    document.getElementById('paSearchBtn').addEventListener('click', function() { activityPage = 1; loadActivityPage(); });
    document.getElementById('paClearBtn').addEventListener('click', clearActivityFilters);
    document.getElementById('paExportBtn').addEventListener('click', exportActivity);
    document.getElementById('paSize').addEventListener('change', function(e) { activityPageSize = parseInt(e.target.value); activityPage = 1; loadActivityPage(); });
    if (isAdmin) {
        document.getElementById('delSelBtn').addEventListener('click', deleteSelected);
        document.getElementById('rotateBtn').addEventListener('click', rotateLogs);
    }
});

// Filter dropdowns
async function loadUserFilter() {
    var res = await fetchWithAuth(_uAlUsers);
    if (!res || !res.ok) return;
    var users = await res.json();
    var sel = document.getElementById('fUser');
    (users || []).forEach(function(u) {
        var opt = document.createElement('option');
        opt.value = u.id;
        opt.textContent = u.firstName + ' ' + u.lastName + ' (' + u.username + ')';
        sel.appendChild(opt);
    });
}

async function loadModuleFilter() {
    var res = await fetchWithAuth(_uAlModules);
    if (!res || !res.ok) return;
    var mods = await res.json();
    var sel = document.getElementById('fModule');
    (mods || []).forEach(function(m) {
        var opt = document.createElement('option');
        opt.value = m; opt.textContent = m;
        sel.appendChild(opt);
    });
}

async function loadActionFilter() {
    var _uAlActions = '/api/audit-logs/actions';
    var res = await fetchWithAuth(_uAlActions);
    if (!res || !res.ok) return;
    var actions = await res.json();
    if (!Array.isArray(actions) || !actions.length) return;
    var sel = document.getElementById('fAction');
    if (!sel) return;
    while (sel.options.length > 1) { sel.remove(1); }
    actions.forEach(function(a) {
        var opt = document.createElement('option');
        opt.value = a; opt.textContent = a;
        sel.appendChild(opt);
    });
}


async function loadActivityUserFilter() {
    var res = await fetchWithAuth(_uPageUsers);
    if (!res || !res.ok) return;
    var users = await res.json();
    var sel = document.getElementById('paUser');
    (users || []).forEach(function(username) {
        var opt = document.createElement('option');
        opt.value = username;
        opt.textContent = username;
        sel.appendChild(opt);
    });
}

async function loadActivityRoleFilter() {
    var res = await fetchWithAuth(_uPageRoles);
    if (!res || !res.ok) return;
    var roles = await res.json();
    var sel = document.getElementById('paRole');
    (roles || []).forEach(function(role) {
        var opt = document.createElement('option');
        opt.value = role;
        opt.textContent = role;
        sel.appendChild(opt);
    });
}

async function loadActivityPageFilter() {
    var res = await fetchWithAuth(_uPagePages);
    if (!res || !res.ok) return;
    var pages = await res.json();
    var sel = document.getElementById('paPage');
    (pages || []).forEach(function(page) {
        var opt = document.createElement('option');
        opt.value = page.pagePath;
        opt.textContent = (page.pageTitle || page.pagePath) + ' (' + page.pagePath + ')';
        sel.appendChild(opt);
    });
}

function buildActivityParams(forExport) {
    const p = new URLSearchParams();
    const username = document.getElementById('paUser').value;
    const role     = document.getElementById('paRole').value;
    const pagePath = document.getElementById('paPage').value;
    const status   = document.getElementById('paStatus').value;
    const from     = document.getElementById('paFrom').value;
    const to       = document.getElementById('paTo').value;
    const ip       = document.getElementById('paIp').value.trim();
    const browser  = document.getElementById('paBrowser').value.trim();
    const search   = document.getElementById('paSearch').value.trim();

    if (username) p.set('username', username);
    if (role)     p.set('role', role);
    if (pagePath) p.set('pagePath', pagePath);
    if (status)   p.set('statusCode', status);
    if (from)     p.set('dateFrom', from);
    if (to)       p.set('dateTo', to);
    if (ip)       p.set('ipAddress', ip);
    if (browser)  p.set('browser', browser);
    if (search)   p.set('search', search);

    if (forExport) {
        p.set('exportAll', 'true');
    } else {
        p.set('limit', activityPageSize);
        p.set('offset', (activityPage - 1) * activityPageSize);
    }
    return p;
}

function paEsc(value) {
    return String(value == null ? '' : value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function statusDescription(statusCode) {
    const map = {
        200: 'OK - page loaded normally',
        201: 'Created - new record/resource created',
        204: 'No Content - success, no body returned',
        301: 'Moved Permanently - redirect',
        302: 'Found - temporary redirect',
        304: 'Not Modified - cached response',
        400: 'Bad Request - invalid request',
        401: 'Unauthorized - login/session required',
        403: 'Forbidden - role lacks access',
        404: 'Not Found - page/route missing',
        409: 'Conflict - duplicate or conflicting state',
        429: 'Too Many Requests - rate limit',
        500: 'Server Error - backend failed'
    };
    return map[statusCode] || 'HTTP status ' + (statusCode || '-');
}

function statusShortLabel(statusCode) {
    const map = {
        200: 'OK',
        201: 'Created',
        204: 'No Content',
        301: 'Moved',
        302: 'Redirect',
        304: 'Cached',
        400: 'Bad Request',
        401: 'Login',
        403: 'Forbidden',
        404: 'Missing',
        409: 'Conflict',
        429: 'Rate Limit',
        500: 'Server Error'
    };
    return map[statusCode] || '';
}

function statusBadge(statusCode) {
    var code = parseInt(statusCode, 10);
    var cls = 'bg-secondary text-white';
    if (code >= 200 && code < 300) cls = 'bg-success text-white';
    else if (code >= 300 && code < 400) cls = 'bg-info text-dark';
    else if (code === 401 || code === 403) cls = 'bg-warning text-dark';
    else if (code >= 400) cls = 'bg-danger text-white';
    var description = statusDescription(code);
    if (!Number.isFinite(code)) {
        return '<span class="status-pill ' + cls + '" title="' + paEsc(description) + '">-</span>';
    }
    var label = statusShortLabel(code);
    var href = 'https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Status/' + code;
    return '<a class="status-pill ' + cls + '" href="' + href + '" target="_blank" rel="noopener noreferrer" title="' + paEsc(description) + '" aria-label="' + paEsc(description) + '">' +
        '<span>' + code + '</span>' +
        (label ? '<span class="status-label">' + paEsc(label) + '</span>' : '') +
        '<i class="fas fa-circle-info" style="font-size:.65rem"></i>' +
        '</a>';
}

function summarizeUserAgent(userAgent) {
    var ua = userAgent || '';
    if (!ua) return '';
    var browser = 'Browser';
    if (/Edg\//.test(ua)) browser = 'Edge';
    else if (/Chrome\//.test(ua)) browser = 'Chrome';
    else if (/Firefox\//.test(ua)) browser = 'Firefox';
    else if (/Safari\//.test(ua)) browser = 'Safari';
    else if (/MSIE|Trident/.test(ua)) browser = 'Internet Explorer';

    var platform = '';
    if (/Windows/i.test(ua)) platform = 'Windows';
    else if (/Macintosh|Mac OS/i.test(ua)) platform = 'Mac';
    else if (/iPhone|iPad/i.test(ua)) platform = 'iOS';
    else if (/Android/i.test(ua)) platform = 'Android';
    else if (/Linux/i.test(ua)) platform = 'Linux';

    return platform ? browser + ' / ' + platform : browser;
}

async function loadActivityPage() {
    var body = document.getElementById('paBody');
    body.innerHTML = '<tr><td colspan="9" class="text-center py-5 text-muted"><i class="fas fa-spinner fa-spin me-2"></i>Loading...</td></tr>';

    try {
        var url = _uPageAct + '?' + buildActivityParams(false).toString();
        var res = await fetchWithAuth(url);
        if (!res || !res.ok) {
            body.innerHTML = '<tr><td colspan="9" class="text-center text-danger py-4">Failed to load page activity.</td></tr>';
            return;
        }
        var json = await res.json();
        currentActivityLogs = json.data || [];
        activityTotal = json.total || 0;
        document.getElementById('paTotalBadge').textContent = activityTotal.toLocaleString() + ' total';
        renderActivityTable();
        renderActivityPagination();
    } catch(e) {
        body.innerHTML = '<tr><td colspan="9" class="text-center text-danger py-4">Error: ' + paEsc(e.message) + '</td></tr>';
    }
}

function renderActivityTable() {
    var body = document.getElementById('paBody');
    if (!currentActivityLogs.length) {
        body.innerHTML = '<tr><td colspan="9" class="text-center text-muted py-5">No page activity found for the selected filters.</td></tr>';
        document.getElementById('paInfo').textContent = 'No results';
        document.getElementById('paNav').innerHTML = '';
        return;
    }

    var html = '';
    currentActivityLogs.forEach(function(log) {
        var dt = new Date(log.visitedAt || log.createdAt);
        var dateStr = isNaN(dt) ? '-' : dt.toLocaleDateString('en-US', { year:'2-digit', month:'2-digit', day:'2-digit' });
        var timeStr = isNaN(dt) ? '' : dt.toLocaleTimeString('en-US', { hour:'2-digit', minute:'2-digit', second:'2-digit' });
        var userText = log.usernameSnapshot || (log.User ? log.User.username : '') || 'Unknown';
        var uaShort = summarizeUserAgent(log.userAgent);
        var userAgent = log.userAgent || '';
        var referrer = log.referrer || '';

        html += '<tr>' +
            '<td><span class="fw-semibold">' + paEsc(dateStr) + '</span><br><small class="text-muted">' + paEsc(timeStr) + '</small></td>' +
            '<td><span class="fw-semibold">' + paEsc(userText) + '</span></td>' +
            '<td><span class="badge bg-light text-dark border">' + paEsc(log.roleSnapshot || '-') + '</span></td>' +
            '<td><span class="fw-semibold">' + paEsc(log.pageTitle || '-') + '</span></td>' +
            '<td><code class="small">' + paEsc(log.pagePath || log.pageUrl || '-') + '</code></td>' +
            '<td>' + statusBadge(log.statusCode) + '</td>' +
            '<td><small class="text-muted font-monospace">' + paEsc(log.ipAddress || '-') + '</small></td>' +
            '<td class="ua-cell" title="' + paEsc(userAgent) + '"><small>' + paEsc(uaShort || userAgent || '-') + '</small></td>' +
            '<td class="ref-cell" title="' + paEsc(referrer) + '"><small class="text-muted">' + paEsc(referrer || '-') + '</small></td>' +
            '</tr>';
    });
    body.innerHTML = html;
}

function renderActivityPagination() {
    var pages = Math.ceil(activityTotal / activityPageSize) || 1;
    var start = activityTotal === 0 ? 0 : Math.min((activityPage - 1) * activityPageSize + 1, activityTotal);
    var end = Math.min(activityPage * activityPageSize, activityTotal);

    document.getElementById('paInfo').textContent = 'Showing ' + start.toLocaleString() + '-' + end.toLocaleString() + ' of ' + activityTotal.toLocaleString() + ' visits';

    var nav = document.getElementById('paNav');
    var isFirst = activityPage === 1;
    var isLast = activityPage >= pages;
    var html = '<li class="page-item' + (isFirst ? ' disabled' : '') + '"><a class="page-link" data-pa-pg="' + (activityPage - 1) + '">&laquo;</a></li>';
    var delta = 2;
    var lo = Math.max(2, activityPage - delta);
    var hi = Math.min(pages - 1, activityPage + delta);

    html += '<li class="page-item' + (activityPage === 1 ? ' active' : '') + '"><a class="page-link" data-pa-pg="1">1</a></li>';
    if (lo > 2) html += '<li class="page-item disabled"><span class="page-link">&hellip;</span></li>';
    for (var i = lo; i <= hi; i++) {
        html += '<li class="page-item' + (i === activityPage ? ' active' : '') + '"><a class="page-link" data-pa-pg="' + i + '">' + i + '</a></li>';
    }
    if (hi < pages - 1) html += '<li class="page-item disabled"><span class="page-link">&hellip;</span></li>';
    if (pages > 1) {
        html += '<li class="page-item' + (activityPage === pages ? ' active' : '') + '"><a class="page-link" data-pa-pg="' + pages + '">' + pages + '</a></li>';
    }
    html += '<li class="page-item' + (isLast ? ' disabled' : '') + '"><a class="page-link" data-pa-pg="' + (activityPage + 1) + '">&raquo;</a></li>';
    nav.innerHTML = html;
}

function goActivityPage(page) {
    var pages = Math.ceil(activityTotal / activityPageSize) || 1;
    if (page < 1 || page > pages) return;
    activityPage = page;
    loadActivityPage();
}

function clearActivityFilters() {
    ['paUser','paRole','paPage','paStatus'].forEach(function(id) { document.getElementById(id).value = ''; });
    ['paFrom','paTo','paIp','paBrowser','paSearch'].forEach(function(id) { document.getElementById(id).value = ''; });
    activityPage = 1;
    loadActivityPage();
}

async function exportActivity() {
    var btn = document.getElementById('paExportBtn');
    btn.disabled = true;
    var orig = btn.innerHTML;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Exporting';
    try {
        var url = _uPageAct + '?' + buildActivityParams(true).toString();
        var res = await fetchWithAuth(url);
        if (!res || !res.ok) { showToast('Page activity export failed.', 'danger'); return; }
        var json = await res.json();
        var rows = json.data || [];
        if (!rows.length) { showToast('No page activity to export.', 'warning'); return; }

        var headers = ['ID','Visited At','Username','Role','Page','Path','Status Code','IP Address','Browser/User Agent','Referrer'];
        var csvRows = rows.map(function(log) {
            return [
                log.id,
                log.visitedAt ? new Date(log.visitedAt).toLocaleString() : '',
                log.usernameSnapshot || '',
                log.roleSnapshot || '',
                log.pageTitle || '',
                log.pagePath || log.pageUrl || '',
                log.statusCode || '',
                log.ipAddress || '',
                log.userAgent || '',
                log.referrer || ''
            ];
        });
        var csv = [headers].concat(csvRows)
            .map(function(row) { return row.map(function(value) { return '"' + String(value == null ? '' : value).replace(/"/g,'""') + '"'; }).join(','); })
            .join('\n');
        var blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
        var a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'page_activity_' + new Date().toISOString().split('T')[0] + '.csv';
        a.click();
        URL.revokeObjectURL(a.href);
        showToast('Exported ' + rows.length.toLocaleString() + ' page visits.', 'success');
    } catch(e) {
        showToast('Page activity export error: ' + e.message, 'danger');
    } finally {
        btn.disabled = false;
        btn.innerHTML = orig;
    }
}

// ── Build query params ────────────────────────────────────────────────────────
function buildParams(forExport) {
    const p = new URLSearchParams();
    const userId = document.getElementById('fUser').value;
    const mod    = document.getElementById('fModule').value;
    const action = document.getElementById('fAction').value;
    const from   = document.getElementById('fFrom').value;
    const to     = document.getElementById('fTo').value;
    if (userId) p.set('userId', userId);
    if (mod)    p.set('module', mod);
    if (action) p.set('action', action);
    if (from)   p.set('dateFrom', from);
    if (to)     p.set('dateTo', to);
    if (forExport) {
        p.set('exportAll', 'true');
    } else {
        p.set('limit',  pageSize);
        p.set('offset', (currentPage - 1) * pageSize);
    }
    return p;
}

// ── Load a page ───────────────────────────────────────────────────────────────
async function loadPage() {
    document.getElementById('auditBody').innerHTML =
        '<tr><td colspan="10" class="text-center py-5 text-muted"><i class="fas fa-spinner fa-spin me-2"></i>Loading...</td></tr>';
    selectedIds.clear();
    updateSelCount();

    try {
        const token = localStorage.getItem('token');
        var _uAlQuery0 = '/api/audit-logs?' + buildParams(false).toString();
        const res = await fetch(_uAlQuery0, {
            headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json', 'Cache-Control': 'no-cache', 'Pragma': 'no-cache' }
        });
        if (!res) { showBody('<tr><td colspan="10" class="text-center text-danger py-4">Not authenticated.</td></tr>'); return; }
        if (res.status === 401 || res.status === 403) { window.rxNav('/login'); return; }
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            showBody('<tr><td colspan="10" class="text-center text-danger py-4"><i class="fas fa-exclamation-triangle me-2"></i>' + (err.message || err.error || 'Failed to load.') + '</td></tr>');
            return;
        }
        const text = await res.text();
        if (!text || text.trim() === '') {
            showBody('<tr><td colspan="10" class="text-center text-muted py-4">No data returned. Try refreshing.</td></tr>');
            return;
        }
        const json = JSON.parse(text);
        currentLogs = json.data  || [];
        totalCount  = json.total || 0;
        logsMap = {};
        currentLogs.forEach(l => { logsMap[l.id] = l; });

        // DEBUG - remove after testing
        if (currentLogs.length > 0) {
            const first = currentLogs[0];
            console.log('[DEBUG] first log id:', first.id, '| module:', first.module, '| action:', first.action);
            console.log('[DEBUG] newValue type:', typeof first.newValue, '| value:', first.newValue);
            console.log('[DEBUG] getRecordLabel result:', getRecordLabel(first));
        }

        document.getElementById('totalBadge').textContent = totalCount.toLocaleString() + ' total';
        renderTable();
        renderPagination();
    } catch(e) {
        showBody('<tr><td colspan="10" class="text-center text-danger py-4">Error: ' + e.message + '</td></tr>');
    }
}

function showBody(html) {
    document.getElementById('auditBody').innerHTML = html;
}

// ── Render table ──────────────────────────────────────────────────────────────
function renderTable() {
    if (!currentLogs.length) {
        showBody('<tr><td colspan="10" class="text-center text-muted py-5">No entries found for the selected filters.</td></tr>');
        document.getElementById('pgInfo').textContent = 'No results';
        document.getElementById('pgNav').innerHTML = '';
        return;
    }

    var _rtHtml = ''; for (var _rti = 0; _rti < currentLogs.length; _rti++) { var log = currentLogs[_rti]; _rtHtml += (function() {
        const user = log.User
            ? '<strong>' + log.User.firstName + ' ' + log.User.lastName + '</strong><br><small class="text-muted">' + log.User.username + '</small>'
            : '<span class="text-muted small">System</span>';
        const badge  = '<span class="badge log-badge ' + (BADGE[log.action] || 'bg-secondary') + '">' + log.action + '</span>';
        const rowCls = ROW_CLS[log.action] || '';
        const dt     = new Date(log.createdAt);
        const dateStr = dt.toLocaleDateString('en-US', {year:'2-digit',month:'2-digit',day:'2-digit'});
        const timeStr = dt.toLocaleTimeString('en-US', {hour:'2-digit',minute:'2-digit',second:'2-digit'});

        // Record / Patient label
        const lbl = getRecordLabel(log);
        const recordCell = lbl
            ? '<span class="fw-semibold text-primary" style="font-size:.82rem">' + lbl + '</span>'
            : (log.recordId ? '<code>#' + log.recordId + '</code>' : '<span class="text-muted">-</span>');

        // Data cell \u2014 readable summary
        let dataCell = '<span class="text-muted">-</span>';
        let nv = log.newValue;
        if (typeof nv === 'string') { try { nv = JSON.parse(nv); } catch(e) { nv = null; } }
        if (nv && typeof nv === 'object') {
            const parts = [];
            const m = log.module || '';

            if (m === 'Patients' || (m.includes('Patient') && !m.includes('Transport'))) {
                if (nv.firstName || nv.lastName) parts.push('<b>Name:</b> ' + ([nv.firstName, nv.lastName].filter(Boolean).join(' ')));
                if (nv.dob)   parts.push('<b>DOB:</b> ' + nv.dob);
                if (nv.phone) parts.push('<b>Phone:</b> ' + nv.phone);
                if (nv.isActive !== undefined) parts.push('<b>Status:</b> ' + (nv.isActive ? 'Active' : 'Inactive'));
            } else if (m === 'RX Records' || m === 'RX Workflow') {
                if (nv.arrivalDate) parts.push('<b>Arrival:</b> ' + nv.arrivalDate);
                if (nv.serviceDate) parts.push('<b>Service:</b> ' + nv.serviceDate);
                if (nv.actionId)    parts.push('<b>Step:</b> ' + nv.actionId);
            } else if (m === 'Users') {
                if (nv.username)  parts.push('<b>User:</b> ' + nv.username);
                if (nv.firstName) parts.push('<b>Name:</b> ' + ([nv.firstName, nv.lastName].filter(Boolean).join(' ')));
            } else if (m === 'Authentication') {
                parts.push('<b>' + (log.action || 'Event') + '</b>');
            } else {
                const skip = ['_label','id','createdAt','updatedAt','passwordHash'];
                Object.keys(nv).forEach(function(k) {
                    if (skip.indexOf(k) >= 0 || parts.length >= 3) return;
                    const v = nv[k];
                    if (v === null || v === undefined || v === '') return;
                    const lbl2 = k.replace(/([A-Z])/g, ' $1').replace(/^(.)/, function(s){ return s.toUpperCase(); });
                    parts.push('<b>' + lbl2 + ':</b> ' + String(v).substring(0, 30));
                });
            }

            if (parts.length) {
                const preview = parts.slice(0, 2).join(' · ');
                const more    = parts.length > 2 ? ' <small class="text-muted">+' + (parts.length - 2) + ' more</small>' : '';
                dataCell = '<span class="data-cell" data-detail="' + log.id + ' title="Click for full detail" style="cursor:pointer;font-size:.82rem">'
                         + preview + more + '</span>';
            } else if (log.action === 'Delete' || log.action === 'Disable') {
                dataCell = '<span class="text-muted small"><i class="fas fa-trash-alt me-1"></i>Record removed</span>';
            } else if (log.action === 'Restore') {
                dataCell = '<span class="text-success small"><i class="fas fa-undo me-1"></i>Record restored</span>';
            }
        } else if (log.action === 'Login' || log.action === 'Logout') {
            dataCell = '<span class="text-muted small">' + log.action + '</span>';
        } else if (log.action === 'Delete' || log.action === 'Disable') {
            dataCell = '<span class="text-muted small"><i class="fas fa-trash-alt me-1"></i>Record removed</span>';
        }

        const adminBtn = isAdmin
            ? '<td><button class="btn btn-sm btn-outline-danger py-0 px-1" data-del-single="' + log.id + '"><i class="fas fa-trash"></i></button></td>'
            : '';

        return '<tr class="' + rowCls + '">'
            + '<td><input type="checkbox" class="chk log-chk" data-id="' + log.id + '"></td>'
            + '<td class="text-muted">' + log.id + '</td>'
            + '<td><span class="fw-semibold">' + dateStr + '</span><br><small class="text-muted">' + timeStr + '</small></td>'
            + '<td>' + user + '</td>'
            + '<td><span class="badge bg-light text-dark border small">' + (log.module || '-') + '</span></td>'
            + '<td>' + badge + '</td>'
            + '<td>' + recordCell + '</td>'
            + '<td>' + dataCell + '</td>'
            + '<td><small class="text-muted font-monospace">' + (log.ipAddress || '-') + '</small></td>'
            + adminBtn
            + '</tr>';
    })();
    } document.getElementById('auditBody').innerHTML = _rtHtml;
}

// ── Pagination ────────────────────────────────────────────────────────────────
function renderPagination() {
    var pages = Math.ceil(totalCount / pageSize) || 1;
    var start = totalCount === 0 ? 0 : Math.min((currentPage - 1) * pageSize + 1, totalCount);
    var end   = Math.min(currentPage * pageSize, totalCount);

    // Counter text — string concat (no template literals for FortiGate safety)
    var pgInfoEl = document.getElementById('pgInfo');
    if (pgInfoEl) {
        pgInfoEl.textContent = 'Showing ' + start.toLocaleString() + '\u2013' + end.toLocaleString() + ' of ' + totalCount.toLocaleString() + ' entries';
    }

    var nav = document.getElementById('pgNav');
    if (!nav) return;

    var isFirst = currentPage === 1;
    var isLast  = currentPage >= pages;

    // Smart ellipsis paginator — matches patients.js pattern
    var html = '<li class="page-item' + (isFirst ? ' disabled' : '') + '"><a class="page-link" data-pg="' + (currentPage - 1) + '">&laquo;</a></li>';

    var delta = 2;
    var lo = Math.max(2, currentPage - delta);
    var hi = Math.min(pages - 1, currentPage + delta);

    // Always show page 1
    html += '<li class="page-item' + (currentPage === 1 ? ' active' : '') + '"><a class="page-link" data-pg="1">1</a></li>';

    if (lo > 2) html += '<li class="page-item disabled"><span class="page-link">&hellip;</span></li>';

    for (var i = lo; i <= hi; i++) {
        html += '<li class="page-item' + (i === currentPage ? ' active' : '') + '"><a class="page-link" data-pg="' + i + '">' + i + '</a></li>';
    }

    if (hi < pages - 1) html += '<li class="page-item disabled"><span class="page-link">&hellip;</span></li>';

    // Always show last page (if more than 1 page)
    if (pages > 1) {
        html += '<li class="page-item' + (currentPage === pages ? ' active' : '') + '"><a class="page-link" data-pg="' + pages + '">' + pages + '</a></li>';
    }

    html += '<li class="page-item' + (isLast ? ' disabled' : '') + '"><a class="page-link" data-pg="' + (currentPage + 1) + '">&raquo;</a></li>';
    nav.innerHTML = html;
}

function goPage(p) {
    const pages = Math.ceil(totalCount / pageSize);
    if (p < 1 || p > pages) return;
    currentPage = p;
    loadPage();
}

// ── Clear filters ─────────────────────────────────────────────────────────────
function clearFilters() {
    ['fUser','fModule','fAction'].forEach(id => document.getElementById(id).value = '');
    ['fFrom','fTo'].forEach(id => document.getElementById(id).value = '');
    currentPage = 1;
    loadPage();
}

// ── Detail modal ──────────────────────────────────────────────────────────────
const FIELD_LABELS = {
    firstName:'First Name', lastName:'Last Name', dob:'Date of Birth', phone:'Phone',
    address:'Address', isActive:'Status', serviceDate:'Service Date', arrivalDate:'Arrival Date',
    patientId:'Patient', pharmacyId:'Pharmacy', clinicId:'Clinic',
    patientTransportId:'Patient Transport', pharmacyTransportId:'Pharmacy Transport',
    notes:'Notes', username:'Username', email:'Email', role:'Role',
    name:'Name', companyName:'Company Name', contactPerson:'Contact Person',
    actionId:'Workflow Action', rxId:'RX Record', userId:'User'
};
const SKIP_FIELDS = ['id','createdAt','updatedAt','passwordHash','_label','__v'];

function formatVal(key, val) {
    if (val === null || val === undefined || val === '') return '<span class="text-muted fst-italic">empty</span>';
    if (key === 'isActive') return val ? '<span class="badge bg-success">Active</span>' : '<span class="badge bg-secondary">Inactive</span>';
    if (typeof val === 'boolean') return val ? '<span class="badge bg-success">Yes</span>' : '<span class="badge bg-secondary">No</span>';
    if (typeof val === 'object') return '<code class="small">' + JSON.stringify(val) + '</code>';
    const s = String(val);
    // detect dates
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
        const d = new Date(s);
        return isNaN(d) ? s : d.toLocaleDateString();
    }
    return s.length > 120 ? s.substring(0,120) + '…' : s;
}

function showDetail(id) {
    const log = logsMap[id];
    if (!log) return;

    // Modal title
    document.getElementById('detailModalTitle').innerHTML = '<i class="fas fa-file-alt me-2"></i>Change Details \u2014 ' + (log.module || 'System') + ' #' + (log.recordId || log.id);

    // Action color
    const actionColors = { Create:'success', Update:'primary', Delete:'danger', Login:'info', Logout:'secondary', Restore:'warning', Disable:'danger' };
    const aColor = actionColors[log.action] || 'secondary';

    // Summary bar
    const user = log.User ? (log.User.firstName + ' ' + log.User.lastName + ' <small class="text-muted">('+log.User.username+')</small>') : 'System';
    document.getElementById('detailSummary').innerHTML =
        '<span class="badge bg-' + aColor + ' fs-6 px-3 py-2">' + (log.action || '-') + '</span>' +
        '<span><i class="fas fa-layer-group me-1 text-muted"></i><strong>' + (log.module || '-') + '</strong></span>' +
        '<span><i class="fas fa-user me-1 text-muted"></i>' + user + '</span>' +
        '<span><i class="fas fa-clock me-1 text-muted"></i>' + new Date(log.createdAt).toLocaleString() + '</span>' +
        '<span class="ms-auto font-monospace small text-muted"><i class="fas fa-network-wired me-1"></i>' + (log.ipAddress || '-') + '</span>';

    // Parse values
    let oldObj = null, newObj = null;
    try { oldObj = typeof log.previousValue === 'string' ? JSON.parse(log.previousValue) : (log.previousValue || null); } catch(e) {}
    try { newObj = typeof log.newValue === 'string' ? JSON.parse(log.newValue) : (log.newValue || null); } catch(e) {}

    const diffDiv = document.getElementById('detailDiff');

    // No data to diff (Login, Delete with no data, etc.)
    if (!oldObj && !newObj) {
        diffDiv.innerHTML = '<p class="text-center text-muted py-3"><i class="fas fa-info-circle me-2"></i>No field data recorded for this event.</p>';
        new bootstrap.Modal(document.getElementById('detailModal')).show();
        return;
    }

    // Collect all keys
    const allKeys = Array.from(new Set([
        ...(oldObj ? Object.keys(oldObj) : []),
        ...(newObj ? Object.keys(newObj) : [])
    ])).filter(k => !SKIP_FIELDS.includes(k));

    if (!allKeys.length) {
        diffDiv.innerHTML = '<p class="text-center text-muted py-3"><i class="fas fa-info-circle me-2"></i>No changes recorded.</p>';
        new bootstrap.Modal(document.getElementById('detailModal')).show();
        return;
    }

    // Separate changed vs unchanged fields
    const changed = [], unchanged = [];
    allKeys.forEach(k => {
        const ov = oldObj ? oldObj[k] : undefined;
        const nv = newObj ? newObj[k] : undefined;
        const isDiff = JSON.stringify(ov) !== JSON.stringify(nv);
        (isDiff ? changed : unchanged).push(k);
    });

    let html = '';

    // Changed fields table
    if (changed.length) {
        var changedRows = '';
        changed.forEach(function(k) {
            const ov = oldObj ? oldObj[k] : undefined;
            const nv = newObj ? newObj[k] : undefined;
            const lbl = FIELD_LABELS[k] || k.replace(/([A-Z])/g,' $1').replace(/^./, function(s) { return s.toUpperCase(); });
            changedRows += '<tr>' +
                '<td class="fw-semibold text-muted small" style="text-transform:uppercase;letter-spacing:.04em">' + lbl + '</td>' +
                '<td style="background:rgba(220,53,69,0.06)">' + (ov !== undefined ? formatVal(k,ov) : '<span class="text-muted fst-italic">&mdash;</span>') + '</td>' +
                '<td style="background:rgba(25,135,84,0.06)">' + (nv !== undefined ? formatVal(k,nv) : '<span class="text-muted fst-italic">&mdash;</span>') + '</td>' +
            '</tr>';
        });
        html += '<div class="mb-3">' +
            '<div class="d-flex align-items-center gap-2 mb-2">' +
                '<span class="badge bg-warning text-dark"><i class="fas fa-exchange-alt me-1"></i>' + changed.length + ' Field' + (changed.length > 1 ? 's' : '') + ' Changed</span>' +
            '</div>' +
            '<div class="table-responsive">' +
            '<table class="table table-sm mb-0" style="border:1px solid var(--border);border-radius:8px;overflow:hidden">' +
                '<thead style="background:var(--bg)">' +
                    '<tr><th style="width:28%">Field</th><th style="width:36%"><i class="fas fa-minus-circle text-danger me-1"></i>Before</th><th style="width:36%"><i class="fas fa-plus-circle text-success me-1"></i>After</th></tr>' +
                '</thead>' +
                '<tbody>' + changedRows + '</tbody>' +
            '</table>' +
            '</div>' +
        '</div>';
    }

    // Unchanged fields (collapsed)
    if (unchanged.length) {
        var unchangedRows = '';
        unchanged.forEach(function(k) {
            const val = newObj ? newObj[k] : (oldObj ? oldObj[k] : undefined);
            const lbl = FIELD_LABELS[k] || k.replace(/([A-Z])/g,' $1').replace(/^./, function(s) { return s.toUpperCase(); });
            unchangedRows += '<tr><td class="fw-semibold text-muted small" style="text-transform:uppercase;letter-spacing:.04em">' + lbl + '</td><td>' + formatVal(k,val) + '</td></tr>';
        });
        html += '<details class="mt-2">' +
            '<summary class="text-muted small" style="cursor:pointer;user-select:none">' +
                '<i class="fas fa-chevron-right me-1"></i>' + unchanged.length + ' Unchanged field' + (unchanged.length > 1 ? 's' : '') +
            '</summary>' +
            '<div class="table-responsive mt-2">' +
            '<table class="table table-sm table-hover mb-0" style="border:1px solid var(--border);border-radius:8px;overflow:hidden;opacity:.7">' +
                '<thead style="background:var(--bg)"><tr><th style="width:28%">Field</th><th>Value</th></tr></thead>' +
                '<tbody>' + unchangedRows + '</tbody>' +
            '</table>' +
            '</div>' +
        '</details>';
    }
    diffDiv.innerHTML = html;
    new bootstrap.Modal(document.getElementById('detailModal')).show();
}

// ── Export CSV (all matching) ─────────────────────────────────────────────────
async function exportAll() {
    const btn = document.getElementById('exportBtn');
    btn.disabled = true;
    const orig = btn.innerHTML;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
    try {
        var _uAlQuery = '/api/audit-logs?' + buildParams(true).toString();
        const res = await fetchWithAuth(_uAlQuery);
        if (!res || !res.ok) { showToast('Export failed.', 'danger'); return; }
        const json = await res.json();
        const rows = json.data || [];
        if (!rows.length) { showToast('No records to export.', 'warning'); return; }

        const HEADERS = ['ID','Date','Time','User','Username','Module','Action','Record ID','IP Address','Previous Value','New Value'];
        const csvRows = rows.map(l => [
            l.id,
            new Date(l.createdAt).toLocaleDateString(),
            new Date(l.createdAt).toLocaleTimeString(),
            l.User ? `${l.User.firstName} ${l.User.lastName}` : 'System',
            l.User ? l.User.username : '',
            l.module || '', l.action || '', l.recordId || '', l.ipAddress || '',
            l.previousValue ? JSON.stringify(l.previousValue) : '',
            l.newValue      ? JSON.stringify(l.newValue)      : ''
        ]);
        const csv = [HEADERS, ...csvRows]
            .map(r => r.map(v => '"' + String(v ?? '').replace(/"/g,'""') + '"').join(','))
            .join('\n');
        const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
        const a = Object.assign(document.createElement('a'), {
            href: URL.createObjectURL(blob),
            download: `audit_log_${new Date().toISOString().split('T')[0]}.csv`
        });
        a.click();
        URL.revokeObjectURL(a.href);
        showToast(`Exported ${rows.length.toLocaleString()} entries.`, 'success');
    } catch(e) {
        showToast('Export error: ' + e.message, 'danger');
    } finally {
        btn.disabled = false;
        btn.innerHTML = orig;
    }
}

// ── Selection ─────────────────────────────────────────────────────────────────
function toggleOne(id, checked) { if (checked) selectedIds.add(id); else selectedIds.delete(id); updateSelCount(); }
function toggleAll(checked) {
    document.querySelectorAll('.log-chk').forEach(c => { c.checked = checked; toggleOne(parseInt(c.dataset.id), checked); });
}
function updateSelCount() {
    document.getElementById('selCount').textContent = selectedIds.size;
    const btn = document.getElementById('delSelBtn');
    if (btn) btn.disabled = selectedIds.size === 0;
}

// ── Admin: delete single ──────────────────────────────────────────────────────
async function deleteSingle(id) {
    if (!confirm(`Permanently delete audit entry #${id}?`)) return;
    var _uAlDel = '/api/audit-logs/' + id;
        const res = await fetchWithAuth(_uAlDel, { method: 'DELETE' });
    if (res && res.ok) { showToast('Entry deleted.', 'success'); loadPage(); }
    else showToast('Delete failed.', 'danger');
}

// ── Admin: delete selected ────────────────────────────────────────────────────
async function deleteSelected() {
    if (!selectedIds.size) return;
    if (!confirm(`Permanently delete ${selectedIds.size} selected entries?`)) return;
    const res = await fetchWithAuth(_uAlBulkDel, { method: 'DELETE', body: JSON.stringify({ ids: [...selectedIds] }) });
    if (res && res.ok) {
        const d = await res.json();
        showToast(d.message, 'success');
        selectedIds.clear();
        loadPage();
    } else showToast('Bulk delete failed.', 'danger');
}

// ── Admin: rotate ─────────────────────────────────────────────────────────────
async function rotateLogs() {
    const days = document.getElementById('rotateDays').value;
    if (!confirm(`Delete all entries older than ${days} days? This cannot be undone.`)) return;
    const res = await fetchWithAuth(_uAlRotate, { method: 'POST', body: JSON.stringify({ days: parseInt(days) }) });
    if (res && res.ok) { const d = await res.json(); showToast(d.message, 'success'); loadPage(); }
    else showToast('Rotation failed.', 'danger');
}

// ---- Error Log (Admin only) ----
var _errAllData = [];         // full current dataset for export
var _errSelected = new Set(); // selected IDs

async function loadErrors() {
    const user = JSON.parse(localStorage.getItem('user') || '{}');
    if (user.role !== 'Administrator') return;

    document.getElementById('errorLogSection').style.display = 'block';
    const jumpBtn = document.getElementById('errLogJumpBtn');
    if (jumpBtn) jumpBtn.style.display = 'inline-flex';
    const body = document.getElementById('errorLogBody');
    body.innerHTML = '<tr><td colspan="9" class="text-center py-3 text-muted"><i class="fas fa-spinner fa-spin"></i></td></tr>';
    _errSelected.clear();
    errUpdateBulkBar();

    var src    = document.getElementById('errSrcFilter')    ? document.getElementById('errSrcFilter').value    : '';
    var sev    = document.getElementById('errSevFilter')    ? document.getElementById('errSevFilter').value    : '';
    var status = document.getElementById('errStatusFilter') ? document.getElementById('errStatusFilter').value : '';

    var _uErrList = '/api/errors?limit=500'; var url = _uErrList;
    if (src)    url += '&source='   + src;
    if (sev)    url += '&severity=' + sev;
    if (status === 'open')     url += '&resolved=false';
    if (status === 'resolved') url += '&resolved=true';

    const res = await fetchWithAuth(url);
    if (!res || !res.ok) { body.innerHTML = '<tr><td colspan="9" class="text-center text-danger py-3">Failed to load errors.</td></tr>'; return; }
    _errAllData = await res.json();

    const openCount = _errAllData.filter(function(e) { return !e.resolved; }).length;
    document.getElementById('errorBadge').textContent = openCount;
    document.getElementById('errorBadge').style.display = openCount > 0 ? 'inline' : 'none';

    if (!_errAllData.length) {
        body.innerHTML = '<tr><td colspan="9" class="text-center text-muted py-3"><i class="fas fa-check-circle text-success me-1"></i>No errors logged.</td></tr>';
        return;
    }

    var _leHtml = ''; for (var _lei = 0; _lei < _errAllData.length; _lei++) { var e = _errAllData[_lei]; _leHtml += (function() {
        var srcBadge = e.source === 'backend'
            ? '<span class="badge bg-danger">Backend</span>'
            : '<span class="badge bg-warning text-dark">Frontend</span>';
        var sevBadge = e.severity === 'error'
            ? '<span class="badge bg-danger">Error</span>'
            : '<span class="badge bg-secondary">Warning</span>';
        var user2  = e.User ? (e.User.username || e.User.firstName) : '<span class="text-muted">\u2014</span>';
        var dt     = e.createdAt ? new Date(e.createdAt).toLocaleString() : '\u2014';
        var msg    = (e.message || '').substring(0, 80) + (e.message && e.message.length > 80 ? '…' : '');
        var urlShort = (e.url || '\u2014').replace(/^https?:\/\/[^/]+/, '').substring(0, 40) || '\u2014';
        var status2 = e.resolved
            ? '<span class="badge bg-success">Resolved</span>'
            : '<span class="badge bg-danger">Open</span>';
        var action = e.resolved
            ? '<button class="btn btn-xs btn-sm btn-outline-secondary py-0" data-unresolve="' + e.id + '" title="Mark Open"><i class="fas fa-undo"></i></button>'
            : '<button class="btn btn-xs btn-sm btn-outline-success py-0" data-resolve="' + e.id + '"><i class="fas fa-check"></i> Resolve</button>';
        return '<tr data-id="' + e.id + '">' +
            '<td><input type="checkbox" class="form-check-input err-chk" data-id="' + e.id + '" ></td>' +
            '<td><small>' + dt + '</small></td>' +
            '<td>' + srcBadge + '</td>' +
            '<td>' + sevBadge + '</td>' +
            '<td><small title="' + (e.message || '').replace(/"/g,'&quot;') + '">' + msg + '</small>' +
                (e.stack ? '<br><code style="font-size:.7rem;color:var(--text-muted,#888)">' + e.stack.split('\n')[0] + '</code>' : '') +
            '</td>' +
            '<td><small class="text-muted">' + urlShort + '</small></td>' +
            '<td><small>' + user2 + '</small></td>' +
            '<td>' + status2 + '</td>' +
            '<td>' + action + '</td>' +
            '</tr>';
    })();
    } body.innerHTML = _leHtml;
}

function errToggleOne(id, checked) {
    if (checked) _errSelected.add(id); else _errSelected.delete(id);
    errUpdateBulkBar();
}

function errToggleAll(checked) {
    document.querySelectorAll('.err-chk').forEach(function(c) {
        c.checked = checked;
        errToggleOne(parseInt(c.dataset.id), checked);
    });
}

function errClearSelection() {
    _errSelected.clear();
    document.querySelectorAll('.err-chk').forEach(function(c) { c.checked = false; });
    var selAll = document.getElementById('errSelAll');
    if (selAll) selAll.checked = false;
    errUpdateBulkBar();
}

function errUpdateBulkBar() {
    var bar = document.getElementById('errBulkBar');
    var cnt = document.getElementById('errSelCount');
    if (!bar) return;
    if (_errSelected.size > 0) {
        bar.style.display = 'flex';
        if (cnt) cnt.textContent = _errSelected.size;
    } else {
        bar.style.display = 'none';
    }
}

async function bulkResolveErrors() {
    if (!_errSelected.size) return;
    if (!confirm('Mark ' + _errSelected.size + ' selected error(s) as resolved?')) return;
    const res = await fetchWithAuth(_uErrBulkRes, {
        method: 'PATCH',
        body: JSON.stringify({ ids: Array.from(_errSelected) })
    });
    if (res && res.ok) { showToast(_errSelected.size + ' error(s) marked as resolved.', 'success'); loadErrors(); }
    else showToast('Bulk resolve failed.', 'danger');
}

async function bulkDeleteErrors() {
    if (!_errSelected.size) return;
    if (!confirm('Permanently delete ' + _errSelected.size + ' selected error(s)? This cannot be undone.')) return;
    const res = await fetchWithAuth(_uErrBulkDel, {
        method: 'DELETE',
        body: JSON.stringify({ ids: Array.from(_errSelected) })
    });
    if (res && res.ok) { showToast(_errSelected.size + ' error(s) deleted.', 'success'); loadErrors(); }
    else showToast('Bulk delete failed.', 'danger');
}

async function resolveError(id) {
    var _uErrRes = '/api/errors/' + id + '/resolve';
        const res = await fetchWithAuth(_uErrRes, { method: 'PATCH' });
    if (res && res.ok) { showToast('Marked as resolved.', 'success'); loadErrors(); }
    else showToast('Failed to resolve.', 'danger');
}

async function unresolveError(id) {
    // Re-open a resolved error by patching resolved=false via update
    showToast('Re-open not available \u2014 use filters to view open/resolved separately.', 'secondary');
}

async function clearResolvedErrors() {
    if (!confirm('Delete all resolved error entries?')) return;
    const res = await fetchWithAuth(_uErrDel, { method: 'DELETE' });
    if (res && res.ok) { showToast('Resolved errors cleared.', 'success'); loadErrors(); }
    else showToast('Failed to clear.', 'danger');
}

function exportErrors() {
    if (!_errAllData.length) { showToast('No data to export.', 'warning'); return; }
    const HEADERS = ['ID','Time','Source','Severity','Message','Stack','URL','User','Status'];
    const rows = _errAllData.map(function(e) {
        return [
            e.id,
            e.createdAt ? new Date(e.createdAt).toLocaleString() : '',
            e.source || '',
            e.severity || '',
            e.message || '',
            (e.stack || '').split('\n')[0] || '',
            e.url || '',
            e.User ? (e.User.username || (e.User.firstName + ' ' + e.User.lastName)) : '',
            e.resolved ? 'Resolved' : 'Open'
        ];
    });
    var csv = [HEADERS].concat(rows)
        .map(function(r) { return r.map(function(v) { return '"' + String(v == null ? '' : v).replace(/"/g,'""') + '"'; }).join(','); })
        .join('\n');
    var blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'error_log_' + new Date().toISOString().split('T')[0] + '.csv';
    a.click();
    URL.revokeObjectURL(a.href);
    showToast('Exported ' + rows.length + ' entries.', 'success');
}

    // Event delegation for audit-log \u2014 FortiGate corrupts onclick= inside template strings
    document.addEventListener('click', function(e) {
        var el;
        // Row detail
        el = e.target.closest('[data-detail]');     if (el) { showDetail(parseInt(el.dataset.detail)); return; }
        el = e.target.closest('[data-del-single]'); if (el) { deleteSingle(parseInt(el.dataset.delSingle)); return; }
        el = e.target.closest('[data-unresolve]');  if (el) { unresolveError(parseInt(el.dataset.unresolve)); return; }
        el = e.target.closest('[data-resolve]');    if (el) { resolveError(parseInt(el.dataset.resolve)); return; }
        // Pagination
        el = e.target.closest('[data-pa-pg]'); if (el) { e.preventDefault(); goActivityPage(parseInt(el.dataset.paPg)); return; }
        el = e.target.closest('[data-pg]'); if (el) { e.preventDefault(); goPage(parseInt(el.dataset.pg)); return; }
    });
