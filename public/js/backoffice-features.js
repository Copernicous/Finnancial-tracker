/* FortiGate compat: no template literals, no arrows, no spread, no ??, no ?. */
var _EMPTY_JOIN = '';

// ── Generic CSV download helper ──────────────────────────────────────────
// sanitizeCsvCell() from base.js prevents formula injection (=, +, -, @ prefix)
function _downloadCSV(filename, cols, rows) {
    var header = cols.join(',');
    var body = rows.map(function(row) {
        return cols.map(function(c) {
            return sanitizeCsvCell(row[c]);
        }).join(',');
    }).join('\n');
    var csv  = header + '\n' + body;
    var blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    var url  = URL.createObjectURL(blob);
    var a    = document.createElement('a');
    a.style.display = 'none';
    a.href = url; a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(function() {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }, 150);
}

// BO-03: Cache stores for export
var _orphansData     = [];
var _locksData       = [];
var _healthTableData = [];

/* BO-03: Orphan export — data cached after scan */
function exportOrphansCSV() {
    if (!_orphansData || !_orphansData.length) { toast('Run a scan first to generate export data.', 'info'); return; }
    var cols = ['childTable','childColumn','parentTable','parentColumn','orphanCount','sampleIds'];
    var rows = _orphansData.map(function(o) {
        return {
            childTable:   o.childTable   || '',
            childColumn:  o.childColumn  || '',
            parentTable:  o.parentTable  || '',
            parentColumn: o.parentColumn || '',
            orphanCount:  o.orphanCount  || 0,
            sampleIds:    (o.sampleIds   || []).join('|')
        };
    });
    _downloadCSV('orphans-' + new Date().toISOString().slice(0,10) + '.csv', cols, rows);
    toast('\u2713 Exported orphan data', 'success');
}

/* BO-03: Lock export — data cached after loadLocks() */
function exportLocksCSV() {
    if (!_locksData || !_locksData.length) { toast('No lock data to export.', 'info'); return; }
    var cols = ['id','status','patientName','patientId','lockedBy','username','lockedAt','expiresAt','secsRemaining'];
    var rows = _locksData.map(function(l) {
        return {
            id:            l.id,
            status:        l.isActive ? 'Active' : 'Expired',
            patientName:   l.patientName || '',
            patientId:     l.patientId,
            lockedBy:      l.userName || '',
            username:      l.username || '',
            lockedAt:      l.lockedAt  ? new Date(l.lockedAt).toLocaleString()  : '',
            expiresAt:     l.expiresAt ? new Date(l.expiresAt).toLocaleString() : '',
            secsRemaining: l.secsRemaining || 0
        };
    });
    _downloadCSV('locks-' + new Date().toISOString().slice(0,10) + '.csv', cols, rows);
    toast('\u2713 Exported ' + rows.length + ' lock(s)', 'success');
}

/* BO-03: Health table stats export — data cached after loadHealth() */
function exportHealthCSV() {
    if (!_healthTableData || !_healthTableData.length) { toast('Load health data first.', 'info'); return; }
    var cols = ['table','rowEstimate','totalSize','sizeBytes'];
    var rows = _healthTableData.map(function(t) {
        return {
            table:       t.table       || '',
            rowEstimate: t.rowEstimate || 0,
            totalSize:   t.totalSize   || '',
            sizeBytes:   t.sizeBytes   || 0
        };
    });
    _downloadCSV('health-tables-' + new Date().toISOString().slice(0,10) + '.csv', cols, rows);
    toast('\u2713 Exported health data', 'success');
}

// ══════════════════════════════════════════════════════════════════════════
// SYSTEM SETTINGS JS
// ══════════════════════════════════════════════════════════════════════════
var settingsLoaded = false;

function updateBackofficeToggle(cb, toggleId, knobId, onColor, bannerId) {
    if (!cb) return;
    var toggle = document.getElementById(toggleId);
    var knob = document.getElementById(knobId);
    var banner = bannerId ? document.getElementById(bannerId) : null;
    if (toggle) toggle.style.background = cb.checked ? onColor : '#334155';
    if (knob) knob.style.left = cb.checked ? '24px' : '4px';
    if (banner) banner.style.display = cb.checked ? 'flex' : 'none';
}

async function loadSettings() {
    try {
        var res  = await apiFetch('/api/admin/settings');
        var data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed');
        settingsLoaded = true;
        document.getElementById('sAppName').value        = data.appName || '';
        document.getElementById('sBackupPath').value     = data.backupPath || '';
        document.getElementById('sRetentionDays').value  = data.backupRetentionDays || 30;
        document.getElementById('sSessionTimeout').value = data.sessionTimeoutMinutes || 60;
        document.getElementById('sMaxLogin').value       = data.maxLoginAttempts || 5;
        var cb = document.getElementById('sMaintenanceMode');
        cb.checked = !!data.maintenanceMode;
        var svcCb = document.getElementById('sServiceDateOverrideEnabled');
        if (svcCb) svcCb.checked = !!data.serviceDateOverrideEnabled;
        function _updateMaintBanner() {
            updateBackofficeToggle(cb, 'sMaintenanceToggle', 'sMaintenanceKnob', '#6366f1', 'maintModeBanner');
        }
        function _updateSvcOverrideBanner() {
            updateBackofficeToggle(svcCb, 'sSvcOverrideToggle', 'sSvcOverrideKnob', '#f59e0b', 'svcOverrideGlobalBanner');
        }
        _updateMaintBanner();
        _updateSvcOverrideBanner();
        cb.addEventListener('change', _updateMaintBanner);
        if (svcCb) svcCb.addEventListener('change', _updateSvcOverrideBanner);
    } catch(e) { toast('Failed to load settings: ' + e.message, 'danger'); }
}

async function saveSettings(e) {
    e.preventDefault();
    try {
        var body = {
            appName:               document.getElementById('sAppName').value.trim(),
            backupPath:            document.getElementById('sBackupPath').value.trim(),
            backupRetentionDays:   parseInt(document.getElementById('sRetentionDays').value, 10),
            sessionTimeoutMinutes: parseInt(document.getElementById('sSessionTimeout').value, 10),
            maxLoginAttempts:      parseInt(document.getElementById('sMaxLogin').value, 10),
            maintenanceMode:       document.getElementById('sMaintenanceMode').checked,
            serviceDateOverrideEnabled: document.getElementById('sServiceDateOverrideEnabled').checked
        };
        var res  = await apiFetch('/api/admin/settings', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(body) });
        var data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Save failed');
        var msg = document.getElementById('settingsSavedMsg');
        msg.textContent = '\u2714 Settings saved'; msg.style.opacity = '1';
        setTimeout(function() { msg.style.opacity = '0'; }, 3000);
        toast('\u2713 Settings saved successfully', 'success');
        backupsLoaded = false;
    } catch(e) { toast('Save failed: ' + e.message, 'danger'); }
}

// ══════════════════════════════════════════════════════════════════════════
// BACKUP MANAGER JS
// ══════════════════════════════════════════════════════════════════════════
var backupsLoaded = false;

async function loadBackups() {
    backupsLoaded = false;
    document.getElementById('backupList').innerHTML = '<p style="text-align:center;padding:2rem;color:var(--text-muted)"><i class="fas fa-spinner fa-spin me-2"></i>Loading...</p>';
    try {
        var res  = await apiFetch('/api/admin/backups');
        var data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed');
        backupsLoaded = true;
        document.getElementById('backupPathText').textContent = data.backupPath || '\u2014';
        if (!data.backups.length) {
            document.getElementById('backupList').innerHTML = '<p style="text-align:center;padding:4rem;color:var(--text-muted)"><i class="fas fa-archive" style="display:block;font-size:2rem;opacity:.3;margin-bottom:1rem"></i>No backups yet. Click \u201cCreate Backup Now\u201d.</p>';
            return;
        }
        var fmtSz = function(b) { return b < 1024 ? b + ' B' : b < 1048576 ? (b/1024).toFixed(1) + ' KB' : (b/1048576).toFixed(1) + ' MB'; };
        var _bHtml = '';
        data.backups.forEach(function(bk) {
            var _dlLinks = '';
            (bk.tables || []).forEach(function(t) {
                if (t.rows > 0) {
                    _dlLinks += '<a href="/api/admin/backups/' + bk.name + '/' + t.table + '.csv" class="btn-bo btn-bo-outline" style="padding:0.25rem 0.5rem;font-size:0.68rem" download><i class="fas fa-download me-1"></i>' + t.table + '</a>';
                }
            });
            _bHtml +=
                '<div class="schema-card" style="margin-bottom:0.625rem">' +
                    '<div style="padding:0.75rem 1rem;display:flex;align-items:center;justify-content:space-between;gap:1rem;flex-wrap:wrap">' +
                        '<div style="display:flex;align-items:center;gap:0.75rem">' +
                            '<i class="fas fa-archive" style="color:#6366f1;font-size:1.1rem"></i>' +
                            '<div>' +
                                '<div style="font-weight:600;font-size:0.85rem;font-family:monospace">' + bk.name + '</div>' +
                                '<div style="font-size:0.7rem;color:var(--text-muted)">' + new Date(bk.createdAt).toLocaleString() + ' &bull; ' + bk.fileCount + ' tables &bull; ' + fmtSz(bk.sizeBytes) + '</div>' +
                            '</div>' +
                        '</div>' +
                        '<div style="display:flex;gap:0.4rem;flex-wrap:wrap">' +
                            _dlLinks +
                            '<button class="btn-bo btn-bo-danger" style="padding:0.3rem 0.65rem;font-size:0.72rem" onclick="deleteBackup(\'' + bk.name + '\',this)"><i class="fas fa-trash-alt"></i></button>' +
                        '</div>' +
                    '</div>' +
                '</div>';
        });
        document.getElementById('backupList').innerHTML = _bHtml;
    } catch(e) { document.getElementById('backupList').innerHTML = '<p style="color:#fca5a5;padding:2rem">' + e.message + '</p>'; }
}

async function createBackup() {
    var btn = document.getElementById('createBackupBtn');
    btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin me-1"></i>Creating...';
    try {
        var res  = await apiFetch('/api/admin/backups', { method: 'POST' });
        var data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed');
        var rows = data.files.reduce(function(s,f){ return s+(f.rows||0); }, 0);
        toast('\u2713 Backup created: ' + data.backupDir + ' (' + rows.toLocaleString() + ' rows, ' + data.files.length + ' tables)', 'success');
        await loadBackups();
    } catch(e) { toast('Backup failed: ' + e.message, 'danger'); }
    finally { btn.disabled=false; btn.innerHTML='<i class="fas fa-save me-1"></i>Create Backup Now'; }
}

async function deleteBackup(name, btn) {
    if (!confirm('Permanently delete backup "' + name + '"?')) return;
    btn.disabled=true; btn.innerHTML='<i class="fas fa-spinner fa-spin"></i>';
    try {
        var res = await apiFetch('/api/admin/backups/'+name, {method:'DELETE'});
        if (!res.ok) throw new Error((await res.json()).error||'Failed');
        toast('\u2713 Backup deleted','success'); await loadBackups();
    } catch(e) { toast('Delete failed: '+e.message,'danger'); btn.disabled=false; btn.innerHTML='<i class="fas fa-trash-alt"></i>'; }
}

// ══════════════════════════════════════════════════════════════════════════
// SYSTEM HEALTH JS
// ══════════════════════════════════════════════════════════════════════════
var healthLoaded = false;

/* BO-04: Auto-refresh timer */
var _healthTimer     = null;
var _healthCountSecs = 30;

function startHealthCountdown() {
    stopHealthCountdown();
    _healthCountSecs = 30;
    var badge = document.getElementById('healthCountdown');
    var numEl = document.getElementById('healthCountdownNum');
    if (badge) badge.style.display = '';
    _healthTimer = setInterval(function() {
        _healthCountSecs--;
        if (numEl) numEl.textContent = _healthCountSecs;
        if (_healthCountSecs <= 0) {
            stopHealthCountdown();
            loadHealth();
        }
    }, 1000);
}

function stopHealthCountdown() {
    clearInterval(_healthTimer);
    _healthTimer = null;
    var badge = document.getElementById('healthCountdown');
    if (badge) badge.style.display = 'none';
}

function manualHealthRefresh() {
    stopHealthCountdown();
    loadHealth();
}

async function loadHealth() {
    healthLoaded = false;
    document.getElementById('healthCards').innerHTML = '';
    document.getElementById('healthTables').innerHTML = '<p style="text-align:center;padding:2rem;color:var(--text-muted)"><i class="fas fa-spinner fa-spin me-2"></i>Loading...</p>';
    try {
        var res  = await apiFetch('/api/admin/health');
        var data = await res.json();
        if (!res.ok) throw new Error(data.error||'Failed');
        healthLoaded = true;
        startHealthCountdown(); /* BO-04 */
        var fmtB  = function(b) { return !b?'0 B':b<1024?b+' B':b<1048576?(b/1024).toFixed(1)+' KB':(b/1048576).toFixed(1)+' MB'; };
        var fmtUp = function(s) { return Math.floor(s/3600)+'h '+Math.floor((s%3600)/60)+'m'; };
        var n=data.node, d=data.db;
        var heapPct = Math.round((n.heapUsed/n.heapTotal)*100);
        var memPct  = Math.round(((n.totalMemBytes-n.freeMemBytes)/n.totalMemBytes)*100);
        var cards = [
            {icon:'fa-database', color:'#6366f1', label:'Database',    lines:[(d&&d.name)||'\u2014', (d&&d.size)||'\u2014', data.connections+' active connections']},
            {icon:'fa-server',   color:'#10b981', label:'Node.js',     lines:[n.version, n.platform+' ('+n.arch+')', 'Uptime: '+fmtUp(n.uptime)]},
            {icon:'fa-memory',   color:'#f59e0b', label:'Heap Memory', lines:[fmtB(n.heapUsed)+' used', fmtB(n.heapTotal)+' total', heapPct+'% heap used']},
            {icon:'fa-microchip',color:'#06b6d4', label:'System RAM',  lines:[fmtB(n.totalMemBytes-n.freeMemBytes)+' used', fmtB(n.totalMemBytes)+' total', memPct+'% utilization']},
            {icon:'fa-hdd',      color:'#a78bfa', label:'Process RSS', lines:[fmtB(n.rss), n.cpus+' CPU cores', n.hostname]},
        ];
        var _hcHtml = '';
        cards.forEach(function(card) {
            var _lHtml = '';
            card.lines.forEach(function(l) {
                _lHtml += '<div style="font-size:0.78rem;color:var(--text-muted);margin-bottom:0.25rem">' + l + '</div>';
            });
            _hcHtml +=
                '<div class="schema-card" style="padding:1rem">' +
                    '<div style="display:flex;align-items:center;gap:0.75rem;margin-bottom:0.75rem">' +
                        '<div style="width:36px;height:36px;border-radius:8px;background:' + card.color + '22;display:flex;align-items:center;justify-content:center"><i class="fas ' + card.icon + '" style="color:' + card.color + '"></i></div>' +
                        '<span style="font-weight:700;font-size:0.85rem">' + card.label + '</span>' +
                    '</div>' +
                    _lHtml +
                '</div>';
        });
        document.getElementById('healthCards').innerHTML = _hcHtml;

        var _tsSz = data.tableStats.map(function(t) { return parseInt(t.sizeBytes||0,10); });
        var maxSz = _tsSz.length ? Math.max.apply(null, _tsSz) : 1; if (!maxSz) maxSz = 1;
        var _tbRows = '';
        data.tableStats.forEach(function(t) {
            var pct = Math.round((parseInt(t.sizeBytes||0,10)/maxSz)*100);
            _tbRows +=
                '<tr style="border-bottom:1px solid rgba(255,255,255,0.04)" onmouseover="this.style.background=\'rgba(255,255,255,0.02)\'" onmouseout="this.style.background=\'\'">' +
                    '<td style="padding:0.45rem 1rem;font-family:monospace;font-size:0.8rem">' + t.table + '</td>' +
                    '<td style="padding:0.45rem 1rem;text-align:right;color:var(--text-muted)">' + parseInt(t.rowEstimate||0).toLocaleString() + '</td>' +
                    '<td style="padding:0.45rem 1rem;text-align:right;color:#a5b4fc;white-space:nowrap">' + (t.totalSize||'\u2014') + '</td>' +
                    '<td style="padding:0.45rem 1rem;min-width:120px"><div style="background:rgba(99,102,241,0.15);border-radius:4px;height:6px;overflow:hidden"><div style="background:#6366f1;height:100%;width:' + pct + '%;border-radius:4px"></div></div></td>' +
                '</tr>';
        });
        var _thHtml = '';
        ['Table','Rows (~)','Size','Usage'].forEach(function(h) {
            _thHtml += '<th style="padding:0.5rem 1rem;text-align:left;color:var(--text-muted);font-size:0.68rem;text-transform:uppercase">' + h + '</th>';
        });
        document.getElementById('healthTables').innerHTML =
            '<div style="background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);overflow:hidden">' +
            '<table style="width:100%;border-collapse:collapse;font-size:0.78rem">' +
                '<thead><tr style="background:var(--surface-2);border-bottom:1px solid var(--border)">' + _thHtml + '</tr></thead>' +
                '<tbody>' + _tbRows + '</tbody>' +
            '</table></div>';
        /* BO-03: cache for export */
        _healthTableData = data.tableStats || [];
        var _hExpBtn = document.getElementById('healthExportBtn');
        if (_hExpBtn) _hExpBtn.style.display = _healthTableData.length ? '' : 'none';
    } catch(e) { document.getElementById('healthTables').innerHTML='<p style="color:#fca5a5;padding:2rem">'+e.message+'</p>'; }
}

// ══════════════════════════════════════════════════════════════════════════
// LOG DASHBOARD JS
var logdashLoaded = false;
var _logdashData = null;
var _logdashDebTimer = null;
var _logdashCharts = {};
var _logdashStatusGuideOpen = false;
var _logdashPager = {
    visits: { page: 1, size: 20 },
    audit: { page: 1, size: 10 },
    errors: { page: 1, size: 10 },
    server: { page: 1, size: 10 }
};

function _logdashEsc(v) {
    if (typeof escHtml === 'function') return escHtml(v);
    return String(v === null || v === undefined ? '' : v)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function _logdashNum(v) {
    var n = parseInt(v || 0, 10);
    if (!isFinite(n)) n = 0;
    return n.toLocaleString();
}

function _logdashFmtDate(v) {
    if (!v) return '\u2014';
    try { return new Date(v).toLocaleString(); }
    catch(e) { return String(v); }
}

function _logdashChip(level, text, title) {
    return '<span class="logdash-chip ' + _logdashEsc(level || 'info') + '" title="' + _logdashEsc(title || '') + '">' + _logdashEsc(text || '') + '</span>';
}

function _logdashStatusChip(code, info) {
    if (!code) return _logdashChip('info', 'N/A', 'No HTTP status was recorded.');
    info = info || {};
    var label = code + ' ' + (info.label || '');
    var href = info.reference || ('https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Status/' + code);
    return '<a class="logdash-chip ' + _logdashEsc(info.level || 'info') + '" href="' + _logdashEsc(href) + '" target="_blank" rel="noopener" title="' + _logdashEsc((info.meaning || '') + ' ' + (info.action || '')) + '">' + _logdashEsc(label) + '</a>';
}

function _logdashGet(id) {
    return document.getElementById(id);
}

function _logdashDestroyChart(id) {
    if (_logdashCharts[id]) {
        _logdashCharts[id].destroy();
        _logdashCharts[id] = null;
    }
}

function _logdashSmallDate(v) {
    if (!v) return '';
    try {
        var d = new Date(v);
        return (d.getMonth()+1) + '/' + d.getDate() + ' ' + d.toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' });
    } catch(e) { return String(v); }
}

function _logdashParams() {
    var p = [];
    function add(id, name) {
        var el = _logdashGet(id);
        if (el && el.value) p.push(name + '=' + encodeURIComponent(el.value));
    }
    add('logdashRange', 'range');
    add('logdashUser', 'user');
    add('logdashRole', 'role');
    add('logdashPath', 'path');
    add('logdashIp', 'ip');
    add('logdashBrowser', 'browser');
    add('logdashStatusFilter', 'status');
    add('logdashSource', 'source');
    add('logdashMethod', 'method');
    add('logdashSeverity', 'severity');
    add('logdashLogType', 'logType');
    add('logdashSearch', 'search');
    p.push('limit=250');
    return p.join('&');
}

function _logdashFillDatalist(id, values) {
    var el = _logdashGet(id);
    if (!el) return;
    el.innerHTML = '';
    (values || []).forEach(function(value) {
        if (value === null || value === undefined || value === '') return;
        var opt = document.createElement('option');
        opt.value = String(value);
        el.appendChild(opt);
    });
}

function renderLogDashboardFilterOptions(data) {
    var options = (data && data.filterOptions) || {};
    _logdashFillDatalist('logdashUserOptions', options.users || []);
    _logdashFillDatalist('logdashRoleOptions', options.roles || []);
    _logdashFillDatalist('logdashPathOptions', options.pages || []);
    _logdashFillDatalist('logdashIpOptions', options.ips || []);
    _logdashFillDatalist('logdashBrowserOptions', options.browsers || []);
    _logdashFillDatalist('logdashSourceOptions', options.sources || []);
    _logdashFillDatalist('logdashMethodOptions', options.methods || ['GET','POST','PUT','PATCH','DELETE','OPTIONS','HEAD']);
    _logdashFillDatalist('logdashSeverityOptions', options.severities || ['error','warning','info']);
    _logdashFillDatalist('logdashTypeOptions', options.logTypes || ['http','error','warning','login','backup','scheduler','startup','system']);
}

function _logdashPagerState(key) {
    if (!_logdashPager[key]) _logdashPager[key] = { page: 1, size: 10 };
    var state = _logdashPager[key];
    state.page = parseInt(state.page || 1, 10);
    state.size = parseInt(state.size || 10, 10);
    if (!isFinite(state.page) || state.page < 1) state.page = 1;
    if ([10, 20, 50, 100, 250].indexOf(state.size) === -1) state.size = 10;
    return state;
}

function _logdashPageRows(key, rows) {
    rows = rows || [];
    var state = _logdashPagerState(key);
    var pageCount = Math.max(1, Math.ceil(rows.length / state.size));
    if (state.page > pageCount) state.page = pageCount;
    var start = (state.page - 1) * state.size;
    return rows.slice(start, start + state.size);
}

function _logdashPagerHtml(key, rows, compact) {
    rows = rows || [];
    var state = _logdashPagerState(key);
    var pageCount = Math.max(1, Math.ceil(rows.length / state.size));
    if (state.page > pageCount) state.page = pageCount;
    var start = rows.length ? ((state.page - 1) * state.size) + 1 : 0;
    var end = rows.length ? Math.min(rows.length, start + state.size - 1) : 0;
    var sizes = [10, 20, 50, 100, 250];
    var html = '<div class="logdash-pager' + (compact ? ' compact' : '') + '">' +
        '<div class="logdash-muted">Showing ' + _logdashNum(start) + '-' + _logdashNum(end) + ' of ' + _logdashNum(rows.length) + '</div>' +
        '<div class="logdash-pager-controls">' +
            '<span class="logdash-muted">Show</span>' +
            '<select class="logdash-pager-select" onchange="logdashSetPageSize(&quot;' + _logdashEsc(key) + '&quot;, this.value)">';
    sizes.forEach(function(size) {
        html += '<option value="' + size + '"' + (state.size === size ? ' selected' : '') + '>' + size + '</option>';
    });
    html += '</select>' +
            '<button type="button" class="logdash-pager-btn" onclick="logdashGoPage(&quot;' + _logdashEsc(key) + '&quot;,' + (state.page - 1) + ')"' + (state.page <= 1 ? ' disabled' : '') + '>Prev</button>' +
            '<span class="logdash-muted">Page ' + _logdashNum(state.page) + ' / ' + _logdashNum(pageCount) + '</span>' +
            '<button type="button" class="logdash-pager-btn" onclick="logdashGoPage(&quot;' + _logdashEsc(key) + '&quot;,' + (state.page + 1) + ')"' + (state.page >= pageCount ? ' disabled' : '') + '>Next</button>' +
        '</div>' +
    '</div>';
    return html;
}

function _logdashRenderPagedSection(key) {
    if (!_logdashData) return;
    if (key === 'visits') {
        renderLogDashboardRecentVisits(((_logdashData.pageActivity || {}).recentVisits) || []);
    } else if (key === 'audit') {
        renderLogDashboardAudit(_logdashData.audit || {});
    } else if (key === 'errors') {
        renderLogDashboardErrors(_logdashData.errors || {});
    } else if (key === 'server') {
        renderLogDashboardServerSignals(_logdashData.logs || {});
    }
}

function logdashSetPageSize(key, size) {
    var state = _logdashPagerState(key);
    var nextSize = parseInt(size || 10, 10);
    if ([10, 20, 50, 100, 250].indexOf(nextSize) === -1) nextSize = 10;
    state.size = nextSize;
    state.page = 1;
    _logdashRenderPagedSection(key);
}

function logdashGoPage(key, page) {
    var state = _logdashPagerState(key);
    state.page = parseInt(page || 1, 10);
    if (!isFinite(state.page) || state.page < 1) state.page = 1;
    _logdashRenderPagedSection(key);
}

function logdashDebounce() {
    clearTimeout(_logdashDebTimer);
    _logdashDebTimer = setTimeout(function() { loadLogDashboard(); }, 450);
}

async function loadLogDashboard() {
    var statusEl = _logdashGet('logdashStatus');
    var exportBtn = _logdashGet('logdashExportBtn');
    if (exportBtn) exportBtn.style.display = 'none';
    if (statusEl) statusEl.innerHTML = '<i class="fas fa-spinner fa-spin me-1"></i>Analyzing activity, errors, audit events, and log files...';
    ['logdashKpis','logdashInsights','logdashStatusGuide','logdashPageActivity','logdashServerSignals','logdashRecentVisits','logdashAuditActivity','logdashErrorActivity'].forEach(function(id) {
        var el = _logdashGet(id);
        if (el) el.innerHTML = '<p style="color:var(--text-muted);padding:1rem;margin:0"><i class="fas fa-spinner fa-spin me-2"></i>Loading...</p>';
    });
    ['logdashStability','logdashTrafficVariables'].forEach(function(id) {
        var el = _logdashGet(id);
        if (el) el.innerHTML = '<p style="color:var(--text-muted);padding:1rem;margin:0"><i class="fas fa-spinner fa-spin me-2"></i>Loading...</p>';
    });

    try {
        var qs = _logdashParams();
        var res = await apiFetch('/api/admin/log-dashboard' + (qs ? '?' + qs : ''));
        var data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to load log dashboard');
        _logdashData = data;
        logdashLoaded = true;
        renderLogDashboardFilterOptions(data);
        renderLogDashboard(data);
        if (exportBtn) exportBtn.style.display = '';
        if (statusEl) statusEl.textContent = 'Updated ' + _logdashFmtDate(data.generatedAt) + ' | Since ' + _logdashFmtDate(data.filters && data.filters.since);
    } catch(e) {
        if (statusEl) statusEl.textContent = 'Unable to load log dashboard: ' + e.message;
        var err = '<p style="color:#fca5a5;padding:1rem;margin:0">' + _logdashEsc(e.message) + '</p>';
        ['logdashKpis','logdashInsights','logdashStatusGuide','logdashPageActivity','logdashServerSignals','logdashRecentVisits','logdashAuditActivity','logdashErrorActivity'].forEach(function(id) {
            var el = _logdashGet(id);
            if (el) el.innerHTML = err;
        });
        ['logdashStability','logdashTrafficVariables'].forEach(function(id) {
            var el = _logdashGet(id);
            if (el) el.innerHTML = err;
        });
    }
}

function renderLogDashboard(data) {
    var page = data.pageActivity || {};
    var totals = page.totals || {};
    var errors = data.errors || {};
    var audit = data.audit || {};
    var logs = data.logs || {};
    var logTotals = logs.totals || {};

    var kpis = [
        { label:'Page Visits', value:totals.total || 0, color:'#10b981' },
        { label:'Unique Users', value:totals.uniqueUsers || 0, color:'#a5b4fc' },
        { label:'403 Blocks', value:totals.forbidden || 0, color:'#fbbf24' },
        { label:'500 Page Errors', value:totals.serverErrors || 0, color:'#ef4444' },
        { label:'Unresolved Errors', value:errors.unresolved || 0, color:'#fca5a5' },
        { label:'Audit Events', value:audit.total || 0, color:'#06b6d4' },
        { label:'Server Signals', value:logTotals.events || 0, color:'#c7d2fe' }
    ];
    var kpiHtml = '';
    kpis.forEach(function(k) {
        kpiHtml += '<div class="logdash-card"><div class="logdash-label">' + _logdashEsc(k.label) + '</div><div class="logdash-value" style="color:' + k.color + '">' + _logdashNum(k.value) + '</div></div>';
    });
    _logdashGet('logdashKpis').innerHTML = kpiHtml;

    renderLogDashboardCharts(data);
    renderLogDashboardStability(data.stability || {});
    renderLogDashboardTrafficVariables(data);
    renderLogDashboardInsights(data.insights || []);
    renderLogDashboardStatusGuide(data.statusGuide || []);
    renderLogDashboardPageActivity(page);
    renderLogDashboardServerSignals(logs);
    renderLogDashboardRecentVisits(page.recentVisits || []);
    renderLogDashboardAudit(audit);
    renderLogDashboardErrors(errors);
}

function renderLogDashboardCharts(data) {
    if (typeof Chart === 'undefined') {
        var trafficCanvas = _logdashGet('logdashTrafficChart');
        var statusCanvas = _logdashGet('logdashStatusChart');
        if (trafficCanvas && trafficCanvas.parentNode) trafficCanvas.parentNode.innerHTML = '<p class="logdash-muted">Chart.js is not available.</p>';
        if (statusCanvas && statusCanvas.parentNode) statusCanvas.parentNode.innerHTML = '<p class="logdash-muted">Chart.js is not available.</p>';
        return;
    }

    var page = data.pageActivity || {};
    var timeline = page.timeline || [];
    var labels = timeline.map(function(row) { return _logdashSmallDate(row.bucket); });
    var totals = timeline.map(function(row) { return row.total || 0; });
    var clientErrors = timeline.map(function(row) { return row.clientErrors || 0; });
    var serverErrors = timeline.map(function(row) { return row.serverErrors || 0; });

    _logdashDestroyChart('logdashTrafficChart');
    if (_logdashGet('logdashTrafficChart')) {
        _logdashCharts.logdashTrafficChart = new Chart(_logdashGet('logdashTrafficChart'), {
            type: 'line',
            data: {
                labels: labels,
                datasets: [
                    { label:'Visits', data:totals, borderColor:'#10b981', backgroundColor:'rgba(16,185,129,0.14)', fill:true, tension:0.35, pointRadius:1 },
                    { label:'4xx', data:clientErrors, borderColor:'#f59e0b', backgroundColor:'rgba(245,158,11,0.08)', fill:false, tension:0.35, pointRadius:1 },
                    { label:'5xx', data:serverErrors, borderColor:'#ef4444', backgroundColor:'rgba(239,68,68,0.08)', fill:false, tension:0.35, pointRadius:1 }
                ]
            },
            options: _logdashChartOptions()
        });
    }

    var statuses = page.topStatuses || [];
    if (!statuses.length && data.logs && data.logs.topStatuses) statuses = data.logs.topStatuses;
    _logdashDestroyChart('logdashStatusChart');
    if (_logdashGet('logdashStatusChart')) {
        _logdashCharts.logdashStatusChart = new Chart(_logdashGet('logdashStatusChart'), {
            type: 'doughnut',
            data: {
                labels: statuses.slice(0, 8).map(function(row) { return String(row.label) + ' ' + ((row.info && row.info.label) || ''); }),
                datasets: [{
                    data: statuses.slice(0, 8).map(function(row) { return row.value || 0; }),
                    backgroundColor: statuses.slice(0, 8).map(function(row) {
                        var code = parseInt(row.label || 0, 10);
                        if (code >= 500) return '#ef4444';
                        if (code >= 400) return '#f59e0b';
                        if (code >= 300) return '#6366f1';
                        return '#10b981';
                    }),
                    borderColor: '#111827',
                    borderWidth: 2
                }]
            },
            options: {
                responsive:true,
                maintainAspectRatio:false,
                plugins:{
                    legend:{ position:'bottom', labels:{ color:'#94a3b8', boxWidth:10, font:{ size:10 } } },
                    tooltip:{ backgroundColor:'rgba(15,23,42,.95)', titleColor:'#e2e8f0', bodyColor:'#94a3b8' }
                }
            }
        });
    }
}

function _logdashChartOptions() {
    return {
        responsive:true,
        maintainAspectRatio:false,
        interaction:{ mode:'index', intersect:false },
        plugins:{
            legend:{ display:true, labels:{ color:'#94a3b8', boxWidth:10, font:{ size:10 } } },
            tooltip:{ backgroundColor:'rgba(15,23,42,.95)', titleColor:'#e2e8f0', bodyColor:'#94a3b8' }
        },
        scales:{
            x:{ ticks:{ color:'#64748b', maxTicksLimit:10 }, grid:{ color:'rgba(255,255,255,0.04)' } },
            y:{ ticks:{ color:'#64748b' }, grid:{ color:'rgba(255,255,255,0.05)' }, beginAtZero:true }
        }
    };
}

function renderLogDashboardStability(stability) {
    var el = _logdashGet('logdashStability');
    var score = parseInt(stability.score || 0, 10);
    var level = stability.level || 'info';
    var color = level === 'good' ? '#10b981' : (level === 'warning' ? '#f59e0b' : '#ef4444');
    var html = '<div class="logdash-score" style="margin-bottom:0.9rem">' +
        '<div class="logdash-score-num" style="color:' + color + ';border-color:' + color + '55">' + score + '</div>' +
        '<div><div style="font-size:1rem;font-weight:800">' + _logdashEsc(stability.label || 'Unknown') + '</div>' +
        '<div class="logdash-muted">Score combines page errors, unresolved app errors, server-log errors, session problems, and role blocks.</div></div>' +
    '</div>';
    html += '<div class="logdash-list">';
    (stability.signals || []).forEach(function(sig) {
        html += '<div class="logdash-row"><span>' + _logdashEsc(sig.label) + '</span><span>' + _logdashChip(sig.level || 'info', _logdashNum(sig.value), '') + '</span></div>';
    });
    html += '</div>';
    if (stability.dangerousStatuses && stability.dangerousStatuses.length) {
        html += '<div class="logdash-panel-title" style="margin:0.9rem 0 0.45rem">Dangerous / Action Statuses</div>';
        stability.dangerousStatuses.forEach(function(item) {
            html += '<div class="logdash-row"><div>' + _logdashStatusChip(item.code, item.info) + '<div class="logdash-muted" style="margin-top:0.2rem">' + _logdashEsc(item.info && item.info.action) + '</div></div><strong>' + _logdashNum(item.count) + '</strong></div>';
        });
    }
    el.innerHTML = html;
}

function renderLogDashboardTrafficVariables(data) {
    var page = data.pageActivity || {};
    var logs = data.logs || {};
    var html = '<div class="logdash-two-col" style="margin-bottom:0.8rem">' +
        _logdashTopList('Top IPs', page.topIps || [], false) +
        _logdashTopList('Browsers', page.topBrowsers || [], false) +
    '</div>';
    html += '<div class="logdash-two-col">' +
        _logdashTopList('Top Server Paths', logs.topPaths || [], false) +
        _logdashTopList('Log Sources', logs.topSources || [], false) +
    '</div>';
    if (logs.filesRead && logs.filesRead.length) {
        html += '<div class="logdash-panel-title" style="margin:0.9rem 0 0.45rem">Files Scanned</div><table class="logdash-source-table">';
        logs.filesRead.slice(0, 8).forEach(function(file) {
            html += '<tr><td class="logdash-path" title="' + _logdashEsc(file.path || '') + '">' + _logdashEsc((file.path || '').split(/[\\\\/]/).pop()) + '</td><td style="text-align:right;color:var(--text-muted)">' + _logdashEsc(_logdashFmtDate(file.modifiedAt)) + '</td></tr>';
        });
        html += '</table>';
    }
    _logdashGet('logdashTrafficVariables').innerHTML = html;
}

function renderLogDashboardInsights(insights) {
    var el = _logdashGet('logdashInsights');
    if (!insights.length) {
        el.innerHTML = '<p style="color:var(--text-muted);margin:0">No operational insights available for this window.</p>';
        return;
    }
    var html = '';
    insights.forEach(function(item) {
        html += '<div class="logdash-insight ' + _logdashEsc(item.level || 'info') + '">' +
            '<div style="font-weight:700;font-size:0.82rem;margin-bottom:0.25rem">' + _logdashEsc(item.title) + '</div>' +
            '<div class="logdash-muted" style="margin-bottom:0.35rem">' + _logdashEsc(item.detail) + '</div>' +
            '<div style="font-size:0.74rem;color:#c7d2fe">' + _logdashEsc(item.action) + '</div>' +
        '</div>';
    });
    el.innerHTML = html;
}

function renderLogDashboardStatusGuide(rows) {
    var el = _logdashGet('logdashStatusGuide');
    rows = rows || [];
    var preview = rows.slice(0, 5);
    var html = '<div style="display:flex;align-items:center;justify-content:space-between;gap:0.75rem;flex-wrap:wrap;margin-bottom:0.65rem">' +
        '<div class="logdash-muted">Quick HTTP reference. Showing common statuses first; expand only when needed.</div>' +
        '<button type="button" class="logdash-collapse-btn" onclick="toggleLogDashboardStatusGuide()">' +
            (_logdashStatusGuideOpen ? '<i class="fas fa-chevron-up me-1"></i>Hide details' : '<i class="fas fa-chevron-down me-1"></i>Show all ' + _logdashNum(rows.length)) +
        '</button>' +
    '</div>';
    html += '<div style="display:flex;gap:0.35rem;flex-wrap:wrap;margin-bottom:' + (_logdashStatusGuideOpen ? '0.7rem' : '0') + '">';
    preview.forEach(function(info) {
        html += _logdashStatusChip(info.code, info);
    });
    html += '</div>';
    if (_logdashStatusGuideOpen) {
        html += '<div class="logdash-list">';
        rows.forEach(function(info) {
            html += '<div class="logdash-row" style="align-items:flex-start">' +
                '<div>' + _logdashStatusChip(info.code, info) +
                    '<div class="logdash-muted" style="margin-top:0.3rem">' + _logdashEsc(info.meaning) + '</div>' +
                    '<div style="font-size:0.72rem;color:#c7d2fe;margin-top:0.18rem">' + _logdashEsc(info.action) + '</div>' +
                '</div>' +
            '</div>';
        });
        html += '</div>';
    }
    el.innerHTML = html;
}

function toggleLogDashboardStatusGuide() {
    _logdashStatusGuideOpen = !_logdashStatusGuideOpen;
    if (_logdashData) renderLogDashboardStatusGuide(_logdashData.statusGuide || []);
}

function _logdashTopList(title, rows, statusMode) {
    rows = rows || [];
    if (!rows.length) return '<div><div class="logdash-panel-title" style="margin-bottom:0.5rem">' + _logdashEsc(title) + '</div><p class="logdash-muted">No data.</p></div>';
    var max = parseInt(rows[0].value || 1, 10);
    if (!max) max = 1;
    var html = '<div><div class="logdash-panel-title" style="margin-bottom:0.5rem">' + _logdashEsc(title) + '</div><div class="logdash-list">';
    rows.forEach(function(row) {
        var pct = Math.max(4, Math.round((parseInt(row.value || 0, 10) / max) * 100));
        var label = statusMode ? _logdashStatusChip(row.label, row.info) : _logdashEsc(row.label);
        html += '<div class="logdash-row">' +
            '<div style="min-width:0;overflow:hidden;text-overflow:ellipsis">' + label + '</div>' +
            '<div style="display:flex;align-items:center;gap:0.5rem;min-width:130px;justify-content:flex-end">' +
                '<div class="logdash-bar"><span style="width:' + pct + '%"></span></div>' +
                '<strong>' + _logdashNum(row.value) + '</strong>' +
            '</div>' +
        '</div>';
    });
    html += '</div></div>';
    return html;
}

function renderLogDashboardPageActivity(page) {
    var el = _logdashGet('logdashPageActivity');
    if (!page.available) {
        el.innerHTML = '<p style="color:#fbbf24;margin:0">' + _logdashEsc(page.note || 'Page activity is not available.') + '</p>';
        return;
    }
    el.innerHTML =
        '<div class="logdash-two-col" style="margin-bottom:1rem">' +
            _logdashTopList('Top Pages', page.topPages || [], false) +
            _logdashTopList('Top Users', page.topUsers || [], false) +
        '</div>' +
        '<div class="logdash-two-col">' +
            _logdashTopList('HTTP Statuses', page.topStatuses || [], true) +
            _logdashTopList('Browsers', page.topBrowsers || [], false) +
        '</div>' +
        '<div class="logdash-two-col" style="margin-top:1rem">' +
            _logdashTopList('Roles', page.topRoles || [], false) +
            _logdashTopList('Page IPs', page.topIps || [], false) +
        '</div>';
}

function renderLogDashboardServerSignals(logs) {
    var el = _logdashGet('logdashServerSignals');
    var totals = logs.totals || {};
    var files = logs.filesRead || [];
    var recent = logs.recentEvents || [];
    var paged = _logdashPageRows('server', recent);
    var fileText = files.length ? files.length + ' log file(s) scanned' : 'No readable .log files found';
    var html = '<div class="logdash-grid" style="grid-template-columns:repeat(auto-fill,minmax(115px,1fr));margin-bottom:0.75rem">' +
        '<div class="logdash-card"><div class="logdash-label">Events</div><div class="logdash-value">' + _logdashNum(totals.events) + '</div></div>' +
        '<div class="logdash-card"><div class="logdash-label">HTTP</div><div class="logdash-value">' + _logdashNum(totals.http) + '</div></div>' +
        '<div class="logdash-card"><div class="logdash-label">Warnings</div><div class="logdash-value" style="color:#fbbf24">' + _logdashNum(totals.warnings) + '</div></div>' +
        '<div class="logdash-card"><div class="logdash-label">Errors</div><div class="logdash-value" style="color:#fca5a5">' + _logdashNum(totals.errors) + '</div></div>' +
    '</div><div class="logdash-muted" style="margin-bottom:0.75rem">' + _logdashEsc(fileText) + '</div>';
    html += '<div class="logdash-two-col" style="margin-bottom:0.75rem">' + _logdashTopList('Log Types', logs.topTypes || [], false) + _logdashTopList('Log Statuses', logs.topStatuses || [], true) + '</div>';
    html += '<div class="logdash-two-col">' + _logdashTopList('Log Sources', logs.topSources || [], false) + _logdashTopList('HTTP Methods', logs.topMethods || [], false) + '</div>';
    html += '<div class="logdash-panel-title" style="margin:0.9rem 0 0.45rem">Recent Server Events</div>';
    if (recent.length) {
        html += _logdashPagerHtml('server', recent, true);
        html += '<div style="overflow:auto"><table class="logdash-table"><thead><tr><th>Time</th><th>Type</th><th>Path</th><th>Status</th></tr></thead><tbody>';
        paged.forEach(function(row) {
            html += '<tr>' +
                '<td>' + _logdashEsc(_logdashFmtDate(row.timestamp)) + '</td>' +
                '<td><div>' + _logdashEsc(row.type || '') + '</div><div class="logdash-muted">' + _logdashEsc(row.source || '') + '</div></td>' +
                '<td><div>' + _logdashEsc(row.method || '') + '</div><div class="logdash-path">' + _logdashEsc(row.path || '') + '</div></td>' +
                '<td>' + (row.status ? _logdashStatusChip(row.status, row.statusInfo) : _logdashChip(row.severity === 'error' ? 'danger' : (row.severity === 'warning' ? 'warning' : 'info'), row.severity || 'info', 'Server log severity')) + '</td>' +
            '</tr>';
        });
        html += '</tbody></table></div>';
    } else {
        html += '<p class="logdash-muted">No recent server events match the filters.</p>';
    }
    el.innerHTML = html;
}

function renderLogDashboardRecentVisits(rows) {
    var el = _logdashGet('logdashRecentVisits');
    if (!rows.length) {
        el.innerHTML = '<p style="color:var(--text-muted);padding:1rem;margin:0">No recent page visits match the filters.</p>';
        return;
    }
    var paged = _logdashPageRows('visits', rows);
    var html = _logdashPagerHtml('visits', rows, false) + '<table class="logdash-table"><thead><tr>' +
        '<th>Time</th><th>User</th><th>Role</th><th>Page</th><th>Status</th><th>IP</th><th>Browser</th><th>Referrer</th>' +
    '</tr></thead><tbody>';
    paged.forEach(function(row) {
        html += '<tr>' +
            '<td>' + _logdashEsc(_logdashFmtDate(row.visitedAt)) + '</td>' +
            '<td>' + _logdashEsc(row.username || '') + '</td>' +
            '<td>' + _logdashEsc(row.role || '') + '</td>' +
            '<td><div>' + _logdashEsc(row.pageTitle || '') + '</div><div class="logdash-path">' + _logdashEsc(row.pagePath || '') + '</div></td>' +
            '<td>' + _logdashStatusChip(row.statusCode, row.statusInfo) + '</td>' +
            '<td>' + _logdashEsc(row.ipAddress || '') + '</td>' +
            '<td>' + _logdashEsc(row.browser || '') + '</td>' +
            '<td class="logdash-path">' + _logdashEsc(row.referrer || '') + '</td>' +
        '</tr>';
    });
    html += '</tbody></table>';
    el.innerHTML = html;
}

function renderLogDashboardAudit(audit) {
    var el = _logdashGet('logdashAuditActivity');
    if (!audit.available) {
        el.innerHTML = '<p style="color:#fbbf24;margin:0">AuditLogs table is not available.</p>';
        return;
    }
    var recent = audit.recentEvents || [];
    var html = '<div class="logdash-grid" style="grid-template-columns:repeat(auto-fill,minmax(120px,1fr));margin-bottom:0.75rem">' +
        '<div class="logdash-card"><div class="logdash-label">Events</div><div class="logdash-value">' + _logdashNum(audit.total) + '</div></div>' +
        '<div class="logdash-card"><div class="logdash-label">Users</div><div class="logdash-value">' + _logdashNum(audit.uniqueUsers) + '</div></div>' +
    '</div><div class="logdash-two-col" style="margin-bottom:0.75rem">' + _logdashTopList('Actions', audit.topActions || [], false) + _logdashTopList('Modules', audit.topModules || [], false) + '</div>';
    if (recent.length) {
        var paged = _logdashPageRows('audit', recent);
        html += _logdashPagerHtml('audit', recent, true);
        html += '<div class="logdash-list">';
        paged.forEach(function(row) {
            html += '<div class="logdash-row"><div><strong>' + _logdashEsc(row.action || '') + '</strong> <span class="logdash-muted">' + _logdashEsc(row.module || '') + '</span><div class="logdash-muted">' + _logdashEsc(row.username || '') + ' | ' + _logdashEsc(_logdashFmtDate(row.createdAt)) + '</div></div></div>';
        });
        html += '</div>';
    } else {
        html += '<p class="logdash-muted">No audit activity matches the filters.</p>';
    }
    el.innerHTML = html;
}

function renderLogDashboardErrors(errors) {
    var el = _logdashGet('logdashErrorActivity');
    if (!errors.available) {
        el.innerHTML = '<p style="color:#fbbf24;margin:0">ErrorLogs table is not available.</p>';
        return;
    }
    var recent = errors.recentErrors || [];
    var html = '<div class="logdash-grid" style="grid-template-columns:repeat(auto-fill,minmax(110px,1fr));margin-bottom:0.75rem">' +
        '<div class="logdash-card"><div class="logdash-label">Total</div><div class="logdash-value">' + _logdashNum(errors.total) + '</div></div>' +
        '<div class="logdash-card"><div class="logdash-label">Unresolved</div><div class="logdash-value" style="color:#fca5a5">' + _logdashNum(errors.unresolved) + '</div></div>' +
        '<div class="logdash-card"><div class="logdash-label">Backend</div><div class="logdash-value">' + _logdashNum(errors.backend) + '</div></div>' +
        '<div class="logdash-card"><div class="logdash-label">Frontend</div><div class="logdash-value">' + _logdashNum(errors.frontend) + '</div></div>' +
    '</div><div class="logdash-two-col" style="margin-bottom:0.75rem">' + _logdashTopList('Severities', errors.topSeverities || [], false) + _logdashTopList('URLs', errors.topUrls || [], false) + '</div>';
    if (recent.length) {
        var paged = _logdashPageRows('errors', recent);
        html += _logdashPagerHtml('errors', recent, true);
        html += '<div class="logdash-list">';
        paged.forEach(function(row) {
            var level = row.severity === 'error' ? 'danger' : (row.severity === 'warning' ? 'warning' : 'info');
            html += '<div class="logdash-row"><div><span class="logdash-chip ' + level + '">' + _logdashEsc(row.severity || '') + '</span> <strong>' + _logdashEsc(row.source || '') + '</strong><div class="logdash-muted">' + _logdashEsc(row.message || '') + '</div><div class="logdash-path">' + _logdashEsc(row.url || '') + '</div></div><div class="logdash-muted">' + _logdashEsc(_logdashFmtDate(row.createdAt)) + '</div></div>';
        });
        html += '</div>';
    } else {
        html += '<p class="logdash-muted">No errors match the filters.</p>';
    }
    el.innerHTML = html;
}

function exportLogDashboardCSV() {
    if (!_logdashData) { toast('Load the Log Dashboard first.', 'info'); return; }
    var rows = [];
    var page = _logdashData.pageActivity || {};
    (page.recentVisits || []).forEach(function(v) {
        rows.push({
            type: 'page_visit',
            timestamp: _logdashFmtDate(v.visitedAt),
            user: v.username || '',
            role: v.role || '',
            path: v.pagePath || '',
            title: v.pageTitle || '',
            status: v.statusCode || '',
            statusMeaning: v.statusInfo ? v.statusInfo.label : '',
            ip: v.ipAddress || '',
            browser: v.browser || '',
            detail: ''
        });
    });
    ((_logdashData.audit || {}).recentEvents || []).forEach(function(a) {
        rows.push({
            type: 'audit',
            timestamp: _logdashFmtDate(a.createdAt),
            user: a.username || '',
            role: '',
            path: '',
            title: a.module || '',
            status: '',
            statusMeaning: '',
            ip: a.ipAddress || '',
            browser: '',
            detail: (a.action || '') + ' #' + (a.recordId || '')
        });
    });
    ((_logdashData.errors || {}).recentErrors || []).forEach(function(e) {
        rows.push({
            type: 'error',
            timestamp: _logdashFmtDate(e.createdAt),
            user: e.username || '',
            role: '',
            path: e.url || '',
            title: e.source || '',
            status: '',
            statusMeaning: '',
            ip: e.ipAddress || '',
            browser: '',
            detail: (e.severity || '') + ': ' + (e.message || '')
        });
    });
    ((_logdashData.logs || {}).recentEvents || []).forEach(function(l) {
        rows.push({
            type: 'server_log',
            timestamp: _logdashFmtDate(l.timestamp),
            user: '',
            role: '',
            path: l.path || '',
            title: l.source || '',
            status: l.status || '',
            statusMeaning: l.statusInfo ? l.statusInfo.label : '',
            ip: '',
            browser: '',
            detail: l.type || ''
        });
    });
    if (!rows.length) { toast('No Log Dashboard rows to export.', 'info'); return; }
    _downloadCSV('rx-log-dashboard-' + new Date().toISOString().slice(0,10) + '.csv',
        ['type','timestamp','user','role','path','title','status','statusMeaning','ip','browser','detail'], rows);
    toast('\u2713 Exported Log Dashboard CSV', 'success');
}

// LOCK MANAGER JS
// ══════════════════════════════════════════════════════════════════════════
var locksLoaded = false;
var svcOverrideResults = [];
var svcOverrideSelectedPatient = null;

function _svcOverrideEsc(v) {
    return String(v === null || v === undefined ? '' : v)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function _svcOverrideFmtDate(v) {
    if (!v) return 'None';
    try { return new Date(String(v).slice(0,10) + 'T12:00:00').toLocaleDateString(); }
    catch(e) { return String(v); }
}

function _svcOverrideWindowHtml(patient) {
    if (!patient.serviceDate) {
        return '<span style="color:#94a3b8">No service date set</span>';
    }
    var sd = new Date(String(patient.serviceDate).slice(0,10) + 'T12:00:00');
    sd.setHours(0,0,0,0);
    var exp = new Date(sd.getTime() + 90 * 864e5);
    var now = new Date(); now.setHours(0,0,0,0);
    var daysLeft = Math.ceil((exp - now) / 864e5);
    if (daysLeft >= 0) {
        return '<span style="color:#fbbf24;font-weight:700"><i class="fas fa-lock me-1"></i>Locked - ' + daysLeft + 'd left</span>';
    }
    return '<span style="color:#6ee7b7;font-weight:700"><i class="fas fa-check-circle me-1"></i>Expired - eligible</span>';
}

function _svcOverridePatientName(patient) {
    return ((patient.firstName || '') + ' ' + (patient.lastName || '')).trim() || ('Patient #' + patient.id);
}

async function searchSvcOverridePatients() {
    var qEl = document.getElementById('svcOverrideSearch');
    var resultsEl = document.getElementById('svcOverrideResults');
    var btn = document.getElementById('svcOverrideSearchBtn');
    if (!qEl || !resultsEl) return;
    var q = qEl.value.trim();
    svcOverrideSelectedPatient = null;
    checkSvcOverrideReady();
    document.getElementById('svcOverrideSelected').style.display = 'none';
    if (q.length < 2) {
        resultsEl.innerHTML = '<div style="font-size:0.76rem;color:#fca5a5">Enter at least 2 characters.</div>';
        return;
    }
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin me-1"></i>Search'; }
    resultsEl.innerHTML = '<div style="font-size:0.78rem;color:var(--text-muted)"><i class="fas fa-spinner fa-spin me-1"></i>Searching patients...</div>';
    try {
        var res = await apiFetch('/api/admin/service-date-overrides/patients?q=' + encodeURIComponent(q));
        var data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Search failed');
        svcOverrideResults = data.patients || [];
        renderSvcOverrideResults();
    } catch(e) {
        resultsEl.innerHTML = '<div style="font-size:0.76rem;color:#fca5a5">' + _svcOverrideEsc(e.message) + '</div>';
    } finally {
        if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-search me-1"></i>Search'; }
    }
}

function renderSvcOverrideResults() {
    var resultsEl = document.getElementById('svcOverrideResults');
    if (!resultsEl) return;
    if (!svcOverrideResults.length) {
        resultsEl.innerHTML = '<div style="font-size:0.76rem;color:var(--text-muted)">No matching active patients found.</div>';
        return;
    }
    var html = '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:0.55rem">';
    for (var i = 0; i < svcOverrideResults.length; i++) {
        var p = svcOverrideResults[i];
        var rxCount = p.RXRecords ? p.RXRecords.length : 0;
        html +=
            '<button type="button" onclick="selectSvcOverridePatient(' + p.id + ')" style="text-align:left;background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:0.75rem;color:var(--text);cursor:pointer">' +
                '<div style="display:flex;align-items:center;justify-content:space-between;gap:0.5rem;margin-bottom:0.25rem">' +
                    '<strong style="font-size:0.84rem">' + _svcOverrideEsc(_svcOverridePatientName(p)) + '</strong>' +
                    '<code style="font-size:0.68rem;color:#a5b4fc">' + _svcOverrideEsc(p.patientCode || p.id) + '</code>' +
                '</div>' +
                '<div style="font-size:0.72rem;color:var(--text-muted);line-height:1.5">' +
                    'Service: ' + _svcOverrideEsc(_svcOverrideFmtDate(p.serviceDate)) + '<br>' +
                    'RX records: ' + rxCount + '<br>' +
                    _svcOverrideWindowHtml(p) +
                '</div>' +
            '</button>';
    }
    html += '</div>';
    resultsEl.innerHTML = html;
}

function selectSvcOverridePatient(id) {
    svcOverrideSelectedPatient = null;
    for (var i = 0; i < svcOverrideResults.length; i++) {
        if (String(svcOverrideResults[i].id) === String(id)) {
            svcOverrideSelectedPatient = svcOverrideResults[i];
            break;
        }
    }
    var box = document.getElementById('svcOverrideSelected');
    if (!box || !svcOverrideSelectedPatient) return;
    var p = svcOverrideSelectedPatient;
    box.style.display = '';
    box.innerHTML =
        '<div style="border:1px solid rgba(245,158,11,0.3);background:rgba(245,158,11,0.07);border-radius:8px;padding:0.75rem;display:flex;align-items:center;justify-content:space-between;gap:1rem;flex-wrap:wrap">' +
            '<div>' +
                '<div style="font-weight:700;font-size:0.86rem;color:#fbbf24"><i class="fas fa-user-check me-1"></i>Selected: ' + _svcOverrideEsc(_svcOverridePatientName(p)) + '</div>' +
                '<div style="font-size:0.74rem;color:var(--text-muted);margin-top:0.2rem">Patient ID: ' + _svcOverrideEsc(p.patientCode || p.id) + ' | Current service date: ' + _svcOverrideEsc(_svcOverrideFmtDate(p.serviceDate)) + ' | ' + _svcOverrideWindowHtml(p) + '</div>' +
            '</div>' +
            '<button class="btn-bo btn-bo-outline" onclick="clearSvcOverrideSelection()" style="font-size:0.72rem"><i class="fas fa-times me-1"></i>Clear</button>' +
        '</div>';
    checkSvcOverrideReady();
}

function clearSvcOverrideSelection() {
    svcOverrideSelectedPatient = null;
    var box = document.getElementById('svcOverrideSelected');
    if (box) { box.style.display = 'none'; box.innerHTML = ''; }
    checkSvcOverrideReady();
}

function checkSvcOverrideReady() {
    var btn = document.getElementById('svcOverrideApplyBtn');
    var dateEl = document.getElementById('svcOverrideDate');
    var reasonEl = document.getElementById('svcOverrideReason');
    if (!btn || !dateEl || !reasonEl) return;
    btn.disabled = !(svcOverrideSelectedPatient && dateEl.value && reasonEl.value.trim().length >= 8);
}

async function applySvcOverride() {
    if (!svcOverrideSelectedPatient) { toast('Select a patient first.', 'info'); return; }
    var dateEl = document.getElementById('svcOverrideDate');
    var reasonEl = document.getElementById('svcOverrideReason');
    var syncEl = document.getElementById('svcOverrideSyncRx');
    var btn = document.getElementById('svcOverrideApplyBtn');
    var newDate = dateEl ? dateEl.value : '';
    var reason = reasonEl ? reasonEl.value.trim() : '';
    var oldDate = svcOverrideSelectedPatient.serviceDate ? String(svcOverrideSelectedPatient.serviceDate).slice(0,10) : 'none';
    if (!newDate || reason.length < 8) { checkSvcOverrideReady(); return; }
    if (!confirm('Override 90-day service date for ' + _svcOverridePatientName(svcOverrideSelectedPatient) + ' from ' + oldDate + ' to ' + newDate + '?')) return;

    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin me-1"></i>Applying...'; }
    try {
        var res = await apiFetch('/api/admin/patients/' + svcOverrideSelectedPatient.id + '/service-date-override', {
            method: 'POST',
            headers: {'Content-Type':'application/json'},
            body: JSON.stringify({
                serviceDate: newDate,
                reason: reason,
                syncMatchingRx: syncEl ? syncEl.checked : false
            })
        });
        var data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Override failed');
        toast('\u2713 Service date override applied' + (data.rxUpdated ? ' | RX rows updated: ' + data.rxUpdated : ''), 'success');
        svcOverrideSelectedPatient.serviceDate = data.patient.serviceDate;
        svcOverrideSelectedPatient.RXRecords = [];
        renderSvcOverrideResults();
        selectSvcOverridePatient(data.patient.id);
        if (dateEl) dateEl.value = '';
        if (reasonEl) reasonEl.value = '';
        if (syncEl) syncEl.checked = false;
        locksLoaded = false;
    } catch(e) {
        toast('Override failed: ' + e.message, 'danger');
    } finally {
        if (btn) { btn.innerHTML = '<i class="fas fa-unlock-alt me-1"></i>Override Service Date'; }
        checkSvcOverrideReady();
    }
}

/* BO-07: Format seconds to human-readable duration */
function _fmtDuration(secs) {
    if (secs < 0) secs = -secs;
    if (secs < 60)   return secs + 's';
    if (secs < 3600) return Math.floor(secs/60) + 'm ' + (secs%60) + 's';
    return Math.floor(secs/3600) + 'h ' + Math.floor((secs%3600)/60) + 'm';
}

/* BO-07: "X ago" from a timestamp string */
function _fmtAgo(dateStr) {
    var diffSecs = Math.floor((new Date() - new Date(dateStr)) / 1000);
    return _fmtDuration(diffSecs) + ' ago';
}

async function loadLocks() {
    locksLoaded = false;
    document.getElementById('locksList').innerHTML='<p style="text-align:center;padding:2rem;color:var(--text-muted)"><i class="fas fa-spinner fa-spin me-2"></i>Loading...</p>';
    try {
        var res  = await apiFetch('/api/admin/locks');
        var data = await res.json();
        if (!res.ok) throw new Error(data.error||'Failed');
        locksLoaded = true;
        /* BO-03: cache for export */
        _locksData = data.locks || [];
        var _lExpBtn = document.getElementById('locksExportBtn');
        if (_lExpBtn) _lExpBtn.style.display = _locksData.length ? '' : 'none';
        document.getElementById('locksStatus').innerHTML =
            '<div style="display:flex;gap:0.75rem;flex-wrap:wrap">' +
                '<span style="background:rgba(16,185,129,0.1);border:1px solid rgba(16,185,129,0.25);color:#6ee7b7;border-radius:6px;padding:0.35rem 0.75rem;font-size:0.78rem;font-weight:600">&#128274; ' + data.active + ' Active</span>' +
                '<span style="background:rgba(100,116,139,0.1);border:1px solid rgba(100,116,139,0.25);color:#94a3b8;border-radius:6px;padding:0.35rem 0.75rem;font-size:0.78rem;font-weight:600">&#8987; ' + data.expired + ' Expired</span>' +
            '</div>';
        if (!data.locks.length) {
            document.getElementById('locksList').innerHTML='<p style="text-align:center;padding:4rem;color:var(--text-muted)"><i class="fas fa-unlock" style="display:block;font-size:2rem;opacity:.3;margin-bottom:1rem"></i>No locks. All records are free.</p>';
            return;
        }
        var _lkRows = '';
        data.locks.forEach(function(l) {
            var lc = l.isActive ? '#10b981' : '#64748b';
            _lkRows +=
                '<tr style="border-bottom:1px solid rgba(255,255,255,0.04)" onmouseover="this.style.background=\'rgba(255,255,255,0.02)\'" onmouseout="this.style.background=\'\'">'+
                    '<td style="padding:0.45rem 1rem"><span style="font-size:0.65rem;font-weight:700;border-radius:4px;padding:0.15rem 0.45rem;background:' + lc + '22;color:' + lc + ';border:1px solid ' + lc + '44">' + (l.isActive?'Active':'Expired') + '</span></td>' +
                    '<td style="padding:0.45rem 1rem">' + (l.patientName||'#'+l.patientId) + '</td>' +
                    '<td style="padding:0.45rem 1rem;color:var(--text-muted)">' + (l.userName||'') + ' <span style="font-size:0.68rem">(' + (l.username||'') + ')</span></td>' +
                    /* BO-07: Acquired timestamp + "X ago" */
                    '<td style="padding:0.45rem 1rem;font-size:0.72rem;white-space:nowrap">' +
                        '<div style="color:var(--text-muted)">' + new Date(l.lockedAt).toLocaleString() + '</div>' +
                        '<div style="color:#94a3b8;font-size:0.67rem;margin-top:0.1rem"><i class="fas fa-clock me-1"></i>' + _fmtAgo(l.lockedAt) + '</div>' +
                    '</td>' +
                    /* BO-07: Expires + time remaining or expired X ago */
                    '<td style="padding:0.45rem 1rem;font-size:0.72rem;white-space:nowrap">' +
                        '<div style="color:var(--text-muted)">' + new Date(l.expiresAt).toLocaleString() + '</div>' +
                        (l.isActive
                            ? '<div style="color:#10b981;font-size:0.67rem;font-weight:600;margin-top:0.1rem"><i class="fas fa-hourglass-half me-1"></i>' + _fmtDuration(l.secsRemaining) + ' left</div>'
                            : '<div style="color:#ef4444;font-size:0.67rem;font-weight:600;margin-top:0.1rem"><i class="fas fa-times-circle me-1"></i>Expired ' + _fmtAgo(l.expiresAt) + '</div>'
                        ) +
                    '</td>' +
                    '<td style="padding:0.45rem 1rem"><button class="btn-bo btn-bo-danger" style="padding:0.25rem 0.6rem;font-size:0.7rem" onclick="releaseLock(' + l.id + ',this)"><i class="fas fa-times me-1"></i>Release</button></td>' +
                '</tr>';
        });
        var _lkThHtml = '';
        ['Status','Patient','Locked By','Acquired','Expires / Status','Action'].forEach(function(h) {
            _lkThHtml += '<th style="padding:0.5rem 1rem;text-align:left;color:var(--text-muted);font-size:0.68rem;text-transform:uppercase">' + h + '</th>';
        });
        document.getElementById('locksList').innerHTML =
            '<div style="background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);overflow:hidden">' +
            '<table style="width:100%;border-collapse:collapse;font-size:0.78rem">' +
                '<thead><tr style="background:var(--surface-2);border-bottom:1px solid var(--border)">' + _lkThHtml + '</tr></thead>' +
                '<tbody>' + _lkRows + '</tbody>' +
            '</table></div>';
    } catch(e) { document.getElementById('locksList').innerHTML='<p style="color:#fca5a5;padding:2rem">'+e.message+'</p>'; }
}

async function releaseLock(id, btn) {
    btn.disabled=true; btn.innerHTML='<i class="fas fa-spinner fa-spin"></i>';
    try {
        var res=await apiFetch('/api/admin/locks/'+id,{method:'DELETE'});
        if (!res.ok) throw new Error((await res.json()).error||'Failed');
        toast('\u2713 Lock released','success'); await loadLocks();
    } catch(e) { toast('Failed: '+e.message,'danger'); btn.disabled=false; btn.innerHTML='<i class="fas fa-times me-1"></i>Release'; }
}

async function releaseExpiredLocks() {
    try {
        var res=await apiFetch('/api/admin/locks',{method:'DELETE'});
        var data=await res.json();
        if (!res.ok) throw new Error(data.error||'Failed');
        toast('\u2713 Released ' + data.released + ' expired lock(s)','success'); await loadLocks();
    } catch(e) { toast('Failed: '+e.message,'danger'); }
}

// ══════════════════════════════════════════════════════════════════════════
// USER MANAGER JS
// ══════════════════════════════════════════════════════════════════════════
var usersLoaded = false;
var ROLE_NAMES  = {1:'Administrator',2:'Supervisor',3:'Operator',4:'Read Only'};
var ROLE_COLORS = {1:'#ef4444',2:'#f59e0b',3:'#6366f1',4:'#64748b'};
var pwdResetUserId = null;
var _usersData = []; // cached for export

async function loadUsers() {
    usersLoaded = false;
    var _ubtn = document.getElementById('usersExportBtn');
    if (_ubtn) _ubtn.style.display = 'none';
    document.getElementById('usersList').innerHTML='<p style="text-align:center;padding:2rem;color:var(--text-muted)"><i class="fas fa-spinner fa-spin me-2"></i>Loading...</p>';
    try {
        var res  = await apiFetch('/api/admin/users');
        var data = await res.json();
        if (!res.ok) throw new Error(data.error||'Failed');
        usersLoaded = true;
        _usersData = data.users || [];
        var _uRows = '';
        data.users.forEach(function(u) {
            var rc = ROLE_COLORS[u.roleId]||'#64748b';
            var ac = u.isActive ? '#10b981' : '#ef4444';
            var roleOpts = [1,2,3,4].map(function(r) {
                return '<option value="' + r + '"' + (r==u.roleId?' selected':'') + '>' + ROLE_NAMES[r] + '</option>';
            }).join(_EMPTY_JOIN);
            var toggleLabel = u.isActive ?
                '<i class="fas fa-ban me-1"></i>Disable' :
                '<i class="fas fa-check me-1"></i>Enable';
            var toggleStyle = u.isActive ?
                'background:rgba(239,68,68,0.12);color:#fca5a5;border:1px solid rgba(239,68,68,0.3)' :
                'background:rgba(16,185,129,0.12);color:#6ee7b7;border:1px solid rgba(16,185,129,0.3)';

            // 2FA status badge
            var twoFaBadge = u.twoFactorEnabled
                ? '<span style="display:inline-flex;align-items:center;gap:3px;font-size:0.62rem;font-weight:700;padding:0.12rem 0.4rem;border-radius:4px;background:rgba(34,197,94,0.12);color:#22c55e;border:1px solid rgba(34,197,94,0.3)" title="Two-Factor Authentication is active"><i class="fas fa-shield-alt"></i> 2FA ON</span>'
                : '<span style="display:inline-flex;align-items:center;gap:3px;font-size:0.62rem;font-weight:700;padding:0.12rem 0.4rem;border-radius:4px;background:rgba(100,116,139,0.12);color:#64748b;border:1px solid rgba(100,116,139,0.25)" title="No two-factor authentication"><i class="fas fa-shield-alt"></i> 2FA OFF</span>';

            // Locked badge (shows only when currently locked)
            var isLocked = u.lockedUntil && new Date(u.lockedUntil) > new Date();
            var lockedBadge = isLocked
                ? ' <span style="display:inline-flex;align-items:center;gap:3px;font-size:0.62rem;font-weight:700;padding:0.12rem 0.4rem;border-radius:4px;background:rgba(239,68,68,0.12);color:#fca5a5;border:1px solid rgba(239,68,68,0.3)" title="Account locked — too many failed login attempts"><i class="fas fa-lock"></i> LOCKED</span>'
                : '';

            _uRows +=
                '<tr style="border-bottom:1px solid rgba(255,255,255,0.04)" onmouseover="this.style.background=\'rgba(255,255,255,0.02)\'" onmouseout="this.style.background=\'\'"\'>' +
                    '<td style="padding:0.55rem 1rem"><div style="font-weight:600">' + (u.firstName||'') + ' ' + (u.lastName||'') + '</div><div style="font-size:0.7rem;color:var(--text-muted)">@' + u.username + ' &bull; ' + (u.email||'\u2014') + '</div></td>' +
                    '<td style="padding:0.55rem 1rem">' +
                        '<div style="font-size:0.65rem;font-weight:600;color:' + rc + ';margin-bottom:0.2rem">' + (ROLE_NAMES[u.roleId] || ('Role #' + u.roleId)) + '</div>' +
                        '<select style="background:' + rc + '22;color:' + rc + ';border:1px solid ' + rc + '44;border-radius:4px;padding:0.2rem 0.4rem;font-size:0.7rem;font-weight:700;cursor:pointer" onchange="updateUserRole(' + u.id + ',this.value,this)">' +
                            roleOpts +
                        '</select>' +
                    '</td>' +
                    '<td style="padding:0.55rem 1rem">' +
                        '<span style="font-size:0.65rem;font-weight:700;border-radius:4px;padding:0.15rem 0.45rem;background:' + ac + '22;color:' + ac + ';border:1px solid ' + ac + '44">' + (u.isActive?'Active':'Disabled') + '</span>' +
                    '</td>' +
                    '<td style="padding:0.55rem 1rem">' +
                        '<div style="display:flex;flex-direction:column;gap:3px">' + twoFaBadge + lockedBadge + '</div>' +
                    '</td>' +
                    '<td style="padding:0.55rem 1rem;color:var(--text-muted);font-size:0.72rem">' + (u.activityCount||0) + ' events<br><span style="font-size:0.68rem">' + (u.lastActivity?new Date(u.lastActivity).toLocaleDateString():'Never') + '</span></td>' +
                    '<td style="padding:0.55rem 1rem">' +
                        '<div style="display:flex;gap:0.35rem;flex-wrap:wrap">' +
                            '<button class="btn-bo" style="padding:0.25rem 0.5rem;font-size:0.68rem;' + toggleStyle + '" onclick="toggleUserActive(' + u.id + ',' + (!u.isActive) + ',this)">' + toggleLabel + '</button>' +
                            '<button class="btn-bo btn-bo-outline" style="padding:0.25rem 0.5rem;font-size:0.68rem" onclick="openResetPwd(' + u.id + ',\'' + (u.firstName||'') + ' ' + (u.lastName||'') + '\')"><i class="fas fa-key me-1"></i>Reset PWD</button>' +
                            (u.twoFactorEnabled ? '<button class="btn-bo" style="padding:0.25rem 0.5rem;font-size:0.68rem;background:rgba(245,158,11,0.12);color:#fbbf24;border:1px solid rgba(245,158,11,0.3)" onclick="resetUser2FA(' + u.id + ',\'' + (u.firstName||'') + ' ' + (u.lastName||'') + '\')"><i class="fas fa-shield-alt me-1"></i>Reset 2FA</button>' : '') +
                            (isLocked ? '<button class="btn-bo" style="padding:0.25rem 0.5rem;font-size:0.68rem;background:rgba(16,185,129,0.12);color:#6ee7b7;border:1px solid rgba(16,185,129,0.3)" onclick="unlockUser(' + u.id + ',\'' + (u.firstName||'') + ' ' + (u.lastName||'') + '\')"><i class="fas fa-lock-open me-1"></i>Unlock</button>' : '') +
                        '</div>' +
                    '</td>' +
                '</tr>';
        });
        var _uThHtml = '';
        ['User','Role','Status','2FA / Lock','Activity','Actions'].forEach(function(h) {
            _uThHtml += '<th style="padding:0.5rem 1rem;text-align:left;color:var(--text-muted);font-size:0.68rem;text-transform:uppercase">' + h + '</th>';
        });
        document.getElementById('usersList').innerHTML =
            '<div style="background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);overflow:hidden">' +
            '<table style="width:100%;border-collapse:collapse;font-size:0.78rem">' +
                '<thead><tr style="background:var(--surface-2);border-bottom:1px solid var(--border)">' + _uThHtml + '</tr></thead>' +
                '<tbody>' + _uRows + '</tbody>' +
            '</table></div>' +
            '<div id="pwdModal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:9999;align-items:center;justify-content:center">' +
                '<div style="background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:1.5rem;width:340px;max-width:95vw">' +
                    '<div style="font-weight:700;margin-bottom:0.5rem">Reset Password</div>' +
                    '<div id="pwdModalName" style="font-size:0.8rem;color:var(--text-muted);margin-bottom:1rem"></div>' +
                    '<input type="password" id="pwdModalInput" class="schema-search" style="margin:0 0 0.75rem" placeholder="New password (min 8 chars)">' +
                    '<div style="display:flex;gap:0.5rem;justify-content:flex-end">' +
                        '<button class="btn-bo btn-bo-outline" onclick="closePwdModal()">Cancel</button>' +
                        '<button class="btn-bo btn-bo-primary" onclick="submitResetPwd()"><i class="fas fa-key me-1"></i>Reset</button>' +
                    '</div>' +
                '</div>' +
            '</div>';
        if (_ubtn) _ubtn.style.display = '';
    } catch(e) { document.getElementById('usersList').innerHTML='<p style="color:#fca5a5;padding:2rem">'+e.message+'</p>'; }
}


// ── Export Users CSV ──────────────────────────────────────────────────────
function exportUsersCSV() {
    if (!_usersData.length) { toast('No user data to export.', 'info'); return; }
    var cols = ['id','username','firstName','lastName','email','roleId','roleName','isActive','twoFactorEnabled','isLocked','activityCount','lastActivity','createdAt'];
    var rows = _usersData.map(function(u) {
        var locked = u.lockedUntil && new Date(u.lockedUntil) > new Date();
        return {
            id:               u.id,
            username:         u.username,
            firstName:        u.firstName || '',
            lastName:         u.lastName  || '',
            email:            u.email     || '',
            roleId:           u.roleId,
            roleName:         ROLE_NAMES[u.roleId] || '',
            isActive:         u.isActive ? 'Yes' : 'No',
            twoFactorEnabled: u.twoFactorEnabled ? 'Yes' : 'No',
            isLocked:         locked ? 'Yes' : 'No',
            activityCount:    u.activityCount || 0,
            lastActivity:     u.lastActivity ? new Date(u.lastActivity).toLocaleString() : '',
            createdAt:        u.createdAt ? new Date(u.createdAt).toLocaleString() : '',
        };
    });
    _downloadCSV('users-export-' + new Date().toISOString().slice(0,10) + '.csv', cols, rows);
    toast('\u2713 Exported ' + rows.length + ' users', 'success');
}

function openResetPwd(id, name) {
    pwdResetUserId = id;
    var m = document.getElementById('pwdModal');
    if (m) { m.style.display='flex'; }
    document.getElementById('pwdModalName').textContent = name;
    document.getElementById('pwdModalInput').value = '';
    setTimeout(function() { document.getElementById('pwdModalInput').focus(); }, 80);
}
function closePwdModal() { var m=document.getElementById('pwdModal'); if(m) m.style.display='none'; }

async function submitResetPwd() {
    var pwd = document.getElementById('pwdModalInput').value;
    if (!pwd || pwd.length < 8) { toast('Password must be at least 8 characters.','danger'); return; }
    try {
        var res = await apiFetch('/api/admin/users/' + pwdResetUserId + '/reset-password', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({newPassword:pwd})});
        if (!res.ok) throw new Error((await res.json()).error||'Failed');
        toast('\u2713 Password reset successfully','success'); closePwdModal();
    } catch(e) { toast('Reset failed: '+e.message,'danger'); }
}

async function updateUserRole(id, roleId, sel) {
    sel.disabled = true;
    try {
        var res = await apiFetch('/api/admin/users/'+id, {method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({roleId:parseInt(roleId,10)})});
        if (!res.ok) throw new Error((await res.json()).error||'Failed');
        var rc = ROLE_COLORS[roleId]||'#64748b';
        sel.style.background = rc+'22'; sel.style.color = rc; sel.style.borderColor = rc+'44';
        toast('\u2713 Role updated','success');
    } catch(e) { toast('Role update failed: '+e.message,'danger'); }
    finally { sel.disabled=false; }
}

async function toggleUserActive(id, newState, btn) {
    btn.disabled = true;
    try {
        var res = await apiFetch('/api/admin/users/'+id, {method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({isActive:newState})});
        if (!res.ok) throw new Error((await res.json()).error||'Failed');
        toast('\u2713 User ' + (newState?'enabled':'disabled'),'success');
        usersLoaded=false; await loadUsers();
    } catch(e) { toast('Update failed: '+e.message,'danger'); btn.disabled=false; }
}

// ── Admin: Reset a user's 2FA so they can re-enroll ────────────────────────
async function resetUser2FA(id, name) {
    if (!confirm('Reset 2FA for ' + name + '?\n\nThis will clear their authenticator setup and backup codes. They can re-enroll from My Account.')) return;
    try {
        var res = await apiFetch('/api/admin/users/' + id + '/reset-2fa', {method:'DELETE'});
        var data = await res.json();
        if (!res.ok) throw new Error(data.message || data.error || 'Failed');
        toast('\u2713 ' + (data.message || '2FA reset for ' + name), 'success');
        usersLoaded = false;
        await loadUsers();
    } catch(e) { toast('Reset 2FA failed: ' + e.message, 'danger'); }
}

// ── Admin: Unlock a locked account ────────────────────────────────────────
async function unlockUser(id, name) {
    if (!confirm('Unlock account for ' + name + '?\n\nThis will clear the lockout and allow them to log in immediately.')) return;
    try {
        var res = await apiFetch('/api/admin/users/' + id + '/unlock', {method:'POST'});
        var data = await res.json();
        if (!res.ok) throw new Error(data.message || data.error || 'Failed');
        toast('\u2713 ' + (data.message || name + ' account unlocked'), 'success');
        usersLoaded = false;
        await loadUsers();
    } catch(e) { toast('Unlock failed: ' + e.message, 'danger'); }
}

// --------------------------------------------------------------------------
// ERROR LOG MANAGER JS
// --------------------------------------------------------------------------
var errlogLoaded  = false;
var errlogPage    = 1;
var errlogTotal   = 0;
var errlogPageSz  = 50;
var errDebTimer   = null;
var errSelIds     = new Set();
var _errlogAllData = []; // cached for export (current filter, all pages)

var SEV_COLORS = { error:'#ef4444', warning:'#f59e0b', info:'#6366f1' };
var SEV_ICONS  = { error:'fa-times-circle', warning:'fa-exclamation-triangle', info:'fa-info-circle' };

function errDebounce() {
    clearTimeout(errDebTimer);
    errDebTimer = setTimeout(function() { loadErrorLogs(1); }, 400);
}

function clearErrFilters() {
    ['errSearch','errDateFrom','errDateTo'].forEach(function(id) { document.getElementById(id).value = ''; });
    ['errSeverity','errSource','errResolved'].forEach(function(id) { document.getElementById(id).selectedIndex = 0; });
    loadErrorLogs(1);
}

async function loadErrorLogs(page) {
    errlogLoaded = false; errlogPage = page;
    var _ebtn = document.getElementById('errlogExportBtn');
    if (_ebtn) _ebtn.style.display = 'none';
    document.getElementById('errlogTable').innerHTML = '<p style="text-align:center;padding:3rem;color:var(--text-muted)"><i class="fas fa-spinner fa-spin me-2"></i>Loading...</p>';
    var _errSearch   = document.getElementById('errSearch')   ? document.getElementById('errSearch').value   : '';
    var _errSeverity = document.getElementById('errSeverity') ? document.getElementById('errSeverity').value : '';
    var _errSource   = document.getElementById('errSource')   ? document.getElementById('errSource').value   : '';
    var _errResolved = document.getElementById('errResolved') ? document.getElementById('errResolved').value : '';
    var _errDateFrom = document.getElementById('errDateFrom') ? document.getElementById('errDateFrom').value : '';
    var _errDateTo   = document.getElementById('errDateTo')   ? document.getElementById('errDateTo').value   : '';
    var params = new URLSearchParams({
        page:     page,
        size:     errlogPageSz,
        search:   _errSearch,
        severity: _errSeverity,
        source:   _errSource,
        resolved: _errResolved,
        dateFrom: _errDateFrom,
        dateTo:   _errDateTo,
    });
    try {
        var res  = await apiFetch('/api/admin/error-logs?' + params.toString());
        var data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed');
        errlogLoaded = true; errlogTotal = data.total;
        _errlogAllData = data.rows || [];

        // Stat cards
        var s = data.stats || {};
        var statCards = [
            { label:'Errors',    val: s.errors    || 0, color:'#ef4444', icon:'fa-times-circle' },
            { label:'Warnings',  val: s.warnings  || 0, color:'#f59e0b', icon:'fa-exclamation-triangle' },
            { label:'Info',      val: s.infos      || 0, color:'#6366f1', icon:'fa-info-circle' },
            { label:'Unresolved',val: s.unresolved || 0, color:'#e11d48', icon:'fa-bell' },
            { label:'Resolved',  val: s.resolved   || 0, color:'#10b981', icon:'fa-check-circle' },
            { label:'Frontend',  val: s.frontend   || 0, color:'#06b6d4', icon:'fa-desktop' },
            { label:'Backend',   val: s.backend    || 0, color:'#8b5cf6', icon:'fa-server' },
        ];
        var _scHtml = '';
        statCards.forEach(function(c) {
            _scHtml +=
                '<div class="schema-card" style="padding:0.65rem 0.875rem;display:flex;align-items:center;gap:0.5rem">' +
                    '<div style="width:28px;height:28px;border-radius:6px;background:' + c.color + '22;display:flex;align-items:center;justify-content:center;flex-shrink:0">' +
                        '<i class="fas ' + c.icon + '" style="color:' + c.color + ';font-size:0.75rem"></i>' +
                    '</div>' +
                    '<div><div style="font-weight:700;font-size:1rem;line-height:1">' + parseInt(c.val).toLocaleString() + '</div><div style="font-size:0.65rem;color:var(--text-muted)">' + c.label + '</div></div>' +
                '</div>';
        });
        document.getElementById('errlogStats').innerHTML = _scHtml;

        if (!data.rows.length) {
            document.getElementById('errlogTable').innerHTML = '<p style="text-align:center;padding:4rem;color:var(--text-muted)"><i class="fas fa-bug" style="display:block;font-size:2rem;opacity:.3;margin-bottom:1rem"></i>No error logs match your filters.</p>';
            document.getElementById('errlogPagination').innerHTML = '';
            return;
        }

        // Table rows
        var _eRows = '';
        data.rows.forEach(function(r) {
            var sev  = r.severity || 'error';
            var sc   = SEV_COLORS[sev] || '#6366f1';
            var si   = SEV_ICONS[sev]  || 'fa-circle';
            var resC = r.resolved ? '#10b981' : '#64748b';
            var _msgEsc  = String(r.message||'').replace(/"/g,'&quot;');
            var _urlEsc  = String(r.url||'').replace(/"/g,'&quot;');
            /* BO-09: Enhanced stack trace accordion */
            var _stackSafe = String(r.stack || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
            var _stackHtml = r.stack
                ? '<tr id="edetail-' + r.id + '" style="display:none;background:rgba(0,0,0,0.4)">' +
                      '<td colspan="9" style="padding:0;border-bottom:2px solid rgba(239,68,68,0.2)">' +
                          '<div style="padding:0.75rem 1rem 1rem">' +
                              '<div style="display:flex;align-items:center;gap:0.5rem;margin-bottom:0.5rem">' +
                                  '<i class="fas fa-code" style="color:#fca5a5;font-size:0.75rem"></i>' +
                                  '<span style="font-size:0.72rem;font-weight:700;color:#fca5a5;text-transform:uppercase;letter-spacing:.06em">Stack Trace</span>' +
                                  '<button class="btn-bo btn-bo-outline" style="padding:0.15rem 0.45rem;font-size:0.62rem;margin-left:auto" onclick="copyStack(' + r.id + ',this)"><i class="fas fa-copy me-1"></i>Copy</button>' +
                              '</div>' +
                              '<pre id="estack-' + r.id + '" style="font-size:0.63rem;color:#f1a1a1;background:rgba(0,0,0,0.5);border:1px solid rgba(239,68,68,0.15);border-radius:6px;padding:0.75rem;white-space:pre-wrap;word-break:break-all;max-height:250px;overflow:auto;margin:0;line-height:1.5">' + _stackSafe + '</pre>' +
                          '</div>' +
                      '</td>' +
                  '</tr>'
                : '';
            _eRows +=
                '<tr id="erow-' + r.id + '" style="border-bottom:1px solid rgba(255,255,255,0.04)" onmouseover="this.style.background=\'rgba(255,255,255,0.02)\'" onmouseout="this.style.background=\'\'">' +
                    '<td style="padding:0.4rem 0.625rem"><input type="checkbox" class="err-chk" value="' + r.id + '" onchange="onErrCheck(' + r.id + ',this.checked)"></td>' +
                    '<td style="padding:0.4rem 0.75rem"><span style="font-size:0.63rem;font-weight:700;border-radius:4px;padding:0.12rem 0.4rem;background:' + sc + '22;color:' + sc + ';border:1px solid ' + sc + '44;white-space:nowrap"><i class="fas ' + si + ' me-1"></i>' + sev + '</span></td>' +
                    '<td style="padding:0.4rem 0.75rem;color:var(--text-muted);font-size:0.7rem">' + (r.source||'\u2014') + '</td>' +
                    '<td style="padding:0.4rem 0.75rem;max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + _msgEsc + '">' + (r.message||'\u2014') + '</td>' +
                    '<td style="padding:0.4rem 0.75rem;max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--text-muted);font-size:0.68rem" title="' + _urlEsc + '">' + (r.url||'\u2014') + '</td>' +
                    '<td style="padding:0.4rem 0.75rem;white-space:nowrap;font-size:0.7rem">' + (r.username||'<span style="color:var(--text-muted)">System</span>') + '</td>' +
                    '<td style="padding:0.4rem 0.75rem;color:var(--text-muted);white-space:nowrap;font-size:0.7rem">' + new Date(r.createdAt).toLocaleString() + '</td>' +
                    '<td style="padding:0.4rem 0.75rem"><span style="font-size:0.63rem;font-weight:700;border-radius:4px;padding:0.12rem 0.4rem;background:' + resC + '22;color:' + resC + ';border:1px solid ' + resC + '44">' + (r.resolved?'Resolved':'Open') + '</span></td>' +
                    '<td style="padding:0.4rem 0.75rem">' +
                        (r.stack
                            ? '<button class="btn-bo btn-bo-outline" style="padding:0.18rem 0.5rem;font-size:0.63rem;white-space:nowrap" onclick="showErrDetail(' + r.id + ',this)"><i class="fas fa-code me-1"></i>Stack</button>'
                            : '<span style="font-size:0.63rem;color:var(--text-muted)">&mdash;</span>'
                        ) +
                    '</td>' +
                '</tr>' +
                _stackHtml;
        });
        var _eThHtml = '';
        ['','Severity','Source','Message','URL','User','Time','Status','Detail'].forEach(function(h) {
            if (h === '') {
                _eThHtml += '<th style="padding:0.4rem 0.625rem;width:32px"><input type="checkbox" id="errPageChk" onchange="toggleSelectAllErrors(this.checked)"></th>';
            } else {
                _eThHtml += '<th style="padding:0.4rem 0.75rem;text-align:left;color:var(--text-muted);font-size:0.65rem;text-transform:uppercase">' + h + '</th>';
            }
        });
        document.getElementById('errlogTable').innerHTML =
            '<div style="background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);overflow:hidden">' +
            '<table style="width:100%;border-collapse:collapse;font-size:0.76rem">' +
                '<thead><tr style="background:var(--surface-2);border-bottom:1px solid var(--border)">' + _eThHtml + '</tr></thead>' +
                '<tbody>' + _eRows + '</tbody>' +
            '</table></div>';

        // Pagination
        var pages = data.pages || 1;
        var pg = '';
        for (var i = 1; i <= pages; i++) {
            pg += '<button class="btn-bo ' + (i===page?'btn-bo-primary':'btn-bo-outline') + '" style="padding:0.25rem 0.6rem;font-size:0.72rem;min-width:32px" onclick="loadErrorLogs(' + i + ')">' + i + '</button>';
        }
        document.getElementById('errlogPagination').innerHTML = pg;
        updateErrSelCount();
        if (_ebtn) _ebtn.style.display = '';
    } catch(e) { document.getElementById('errlogTable').innerHTML = '<p style="color:#fca5a5;padding:2rem">'+e.message+'</p>'; }
}

// ── Export Error Logs CSV (all matching rows, fetches all pages) ───────────
async function exportErrorLogsCSV() {
    var _ebtn = document.getElementById('errlogExportBtn');
    if (_ebtn) { _ebtn.disabled = true; _ebtn.innerHTML = '<i class="fas fa-spinner fa-spin me-1"></i>Exporting...'; }
    try {
        var _errSearch   = document.getElementById('errSearch')   ? document.getElementById('errSearch').value   : '';
        var _errSeverity = document.getElementById('errSeverity') ? document.getElementById('errSeverity').value : '';
        var _errSource   = document.getElementById('errSource')   ? document.getElementById('errSource').value   : '';
        var _errResolved = document.getElementById('errResolved') ? document.getElementById('errResolved').value : '';
        var _errDateFrom = document.getElementById('errDateFrom') ? document.getElementById('errDateFrom').value : '';
        var _errDateTo   = document.getElementById('errDateTo')   ? document.getElementById('errDateTo').value   : '';
        var params = new URLSearchParams({
            page: 1, size: 9999,
            search:   _errSearch,
            severity: _errSeverity,
            source:   _errSource,
            resolved: _errResolved,
            dateFrom: _errDateFrom,
            dateTo:   _errDateTo,
        });
        var res  = await apiFetch('/api/admin/error-logs?' + params.toString());
        var data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed');
        var cols = ['id','severity','source','message','url','username','ipAddress','resolved','createdAt','stack'];
        var rows = (data.rows || []).map(function(r) {
            // Replace newlines in multi-line fields so each error stays on ONE CSV row.
            // Stack traces are joined with " | " so the full trace is readable in a single cell.
            function flattenField(v) {
                if (v == null) return '';
                return String(v).replace(/\r\n/g, ' | ').replace(/\n/g, ' | ').replace(/\r/g, ' | ');
            }
            return {
                id:        r.id,
                severity:  r.severity  || '',
                source:    r.source    || '',
                message:   flattenField(r.message),
                url:       r.url       || '',
                username:  r.username  || 'System',
                ipAddress: r.ipAddress || '',
                resolved:  r.resolved  ? 'Yes' : 'No',
                createdAt: r.createdAt ? new Date(r.createdAt).toLocaleString() : '',
                stack:     flattenField(r.stack),
            };
        });
        _downloadCSV('error-logs-' + new Date().toISOString().slice(0,10) + '.csv', cols, rows);
        toast('\u2713 Exported ' + rows.length + ' error log(s)', 'success');
    } catch(e) { toast('Export failed: ' + e.message, 'danger'); }
    finally { if (_ebtn) { _ebtn.disabled = false; _ebtn.innerHTML = '<i class="fas fa-file-csv me-1"></i>Export CSV'; } }
}

/* BO-09: Enhanced show/hide with button state feedback */
function showErrDetail(id, btn) {
    var row = document.getElementById('edetail-'+id);
    if (!row) return;
    var isShown = row.style.display !== 'none';
    row.style.display = isShown ? 'none' : '';
    if (btn) {
        btn.style.background   = isShown ? '' : 'rgba(239,68,68,0.12)';
        btn.style.borderColor  = isShown ? '' : 'rgba(239,68,68,0.3)';
        btn.style.color        = isShown ? '' : '#fca5a5';
    }
}

/* BO-09: Copy stack trace text to clipboard */
function copyStack(id, btn) {
    var pre = document.getElementById('estack-'+id);
    if (!pre) return;
    if (navigator.clipboard) {
        navigator.clipboard.writeText(pre.textContent).then(function() {
            btn.innerHTML = '<i class="fas fa-check me-1"></i>Copied!';
            setTimeout(function() { btn.innerHTML = '<i class="fas fa-copy me-1"></i>Copy'; }, 2000);
        });
    }
}

function onErrCheck(id, checked) {
    if (checked) errSelIds.add(id); else errSelIds.delete(id);
    updateErrSelCount();
}

function toggleSelectAllErrors(checked) {
    document.querySelectorAll('.err-chk').forEach(function(chk) {
        chk.checked = checked;
        onErrCheck(parseInt(chk.value, 10), checked);
    });
}

function updateErrSelCount() {
    var el = document.getElementById('errSelCount');
    if (el) el.textContent = errSelIds.size ? errSelIds.size + ' selected' : '';
}

async function resolveSelectedErrors() {
    if (!errSelIds.size) { toast('Select at least one error first.','danger'); return; }
    try {
        var _ids = Array.from(errSelIds);
        var res = await apiFetch('/api/admin/error-logs/resolve', {
            method:'PATCH', headers:{'Content-Type':'application/json'},
            body: JSON.stringify({ ids: _ids })
        });
        var data = await res.json();
        if (!res.ok) throw new Error(data.error||'Failed');
        toast('\u2713 ' + errSelIds.size + ' error(s) marked resolved', 'success');
        errSelIds.clear(); errlogLoaded = false; await loadErrorLogs(errlogPage);
    } catch(e) { toast('Failed: '+e.message,'danger'); }
}

// -- Purge Modal ------------------------------------------------
function openPurgeModal() {
    document.getElementById('purgeModal').style.display = 'flex';
    document.querySelectorAll('input[name="purgeMode"]').forEach(function(r) { r.checked = false; });
    ['purgeAgeOpts','purgeFilterOpts','purgeConfirmAll'].forEach(function(id) { document.getElementById(id).style.display='none'; });
}
function closePurgeModal() { document.getElementById('purgeModal').style.display='none'; }

function onPurgeModeChange() {
    var modeEl = document.querySelector('input[name="purgeMode"]:checked');
    var mode = modeEl ? modeEl.value : null;
    document.getElementById('purgeAgeOpts').style.display    = mode==='age'    ? '' : 'none';
    document.getElementById('purgeFilterOpts').style.display = mode==='filter' ? '' : 'none';
    document.getElementById('purgeConfirmAll').style.display = mode==='all'    ? '' : 'none';
    ['pmOpt1','pmOpt2','pmOpt3','pmOpt4'].forEach(function(id) {
        document.getElementById(id).style.borderColor = 'var(--border)';
        document.getElementById(id).style.background  = '';
    });
    var map = {age:'pmOpt1',filter:'pmOpt2',resolved:'pmOpt3',all:'pmOpt4'};
    if (mode && map[mode]) {
        document.getElementById(map[mode]).style.borderColor = '#6366f1';
        document.getElementById(map[mode]).style.background  = 'rgba(99,102,241,0.06)';
    }
}

async function doPurge() {
    var modeEl = document.querySelector('input[name="purgeMode"]:checked');
    var mode = modeEl ? modeEl.value : null;
    if (!mode) { toast('Select a purge mode.','danger'); return; }
    if (mode === 'all') {
        if (document.getElementById('purgeConfirmInput').value.trim() !== 'CONFIRM') {
            toast('Type CONFIRM to purge all error logs.','danger'); return;
        }
    }
    var body = {};
    if (mode === 'age') {
        body = {
            mode: 'age',
            olderThanDays: parseInt(document.getElementById('purgeAgeDays').value,10)||30,
            severity:      document.getElementById('purgeAgeSev').value,
            source:        document.getElementById('purgeAgeSrc').value,
            resolvedOnly:  document.getElementById('purgeAgeResOnly').checked,
        };
    } else if (mode === 'filter') {
        body = {
            mode: 'filter',
            severity:     document.getElementById('purgeFilterSev').value,
            source:       document.getElementById('purgeFilterSrc').value,
            resolvedOnly: document.getElementById('purgeFilterResOnly').checked,
        };
    } else if (mode === 'resolved') {
        body = { mode: 'filter', resolvedOnly: true };
    } else {
        body = { mode: 'all' };
    }
    var btn = document.getElementById('doPurgeBtn');
    btn.disabled=true; btn.innerHTML='<i class="fas fa-spinner fa-spin me-1"></i>Purging...';
    try {
        var res  = await apiFetch('/api/admin/error-logs', { method:'DELETE', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body) });
        var data = await res.json();
        if (!res.ok) throw new Error(data.error||'Failed');
        toast('\u2713 Purged ' + data.deleted + ' error log(s)', 'success');
        closePurgeModal();
        errlogLoaded = false; await loadErrorLogs(1);
    } catch(e) { toast('Purge failed: '+e.message,'danger'); }
    finally { btn.disabled=false; btn.innerHTML='<i class="fas fa-fire me-1"></i>Purge'; }
}

// --------------------------------------------------------------------------
// ANALYTICS & DAILY SNAPSHOTS
// --------------------------------------------------------------------------
var analyticsLoaded = false;
var anlCharts       = {};

function anlChartDefaults() {
    Chart.defaults.color = '#64748b';
    Chart.defaults.borderColor = 'rgba(255,255,255,0.07)';
    Chart.defaults.font.family = 'Inter, sans-serif';
    Chart.defaults.font.size   = 11;
}

async function loadAnalytics() {
    analyticsLoaded = false;
    var _anlFrom = document.getElementById('anlFrom') ? document.getElementById('anlFrom').value : '';
    var _anlTo   = document.getElementById('anlTo')   ? document.getElementById('anlTo').value   : '';
    var params = new URLSearchParams({ limit: 365 });
    if (_anlFrom) params.set('from', _anlFrom);
    if (_anlTo)   params.set('to',   _anlTo);

    document.getElementById('anlTableWrap').innerHTML =
        '<p style="text-align:center;padding:3rem;color:var(--text-muted)"><i class="fas fa-spinner fa-spin me-2"></i>Loading snapshots...</p>';

    try {
        var res  = await apiFetch('/api/admin/snapshots?' + params.toString());
        var data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed');
        analyticsLoaded = true;

        var rows   = data.rows   || [];
        var latest = data.latest || null;
        var prev   = data.prev   || null;

        function delta(key) {
            if (!latest || !prev) return '';
            var d = (latest[key] || 0) - (prev[key] || 0);
            if (d === 0) return '<span style="color:#64748b;font-size:.65rem"> -</span>';
            var c = d > 0 ? '#10b981' : '#ef4444';
            var arrow = d > 0 ? '\u2191' : '\u2193';
            return '<span style="color:' + c + ';font-size:.65rem"> ' + arrow + Math.abs(d) + '</span>';
        }
        function pctDelta(key) {
            if (!latest || !prev) return '';
            var d = ((latest[key] || 0) - (prev[key] || 0)).toFixed(1);
            if (d == 0) return '';
            var c = d > 0 ? '#10b981' : '#ef4444';
            return '<span style="color:' + c + ';font-size:.65rem"> ' + (d > 0 ? '\u2191' : '\u2193') + Math.abs(d) + '%</span>';
        }

        var kpis = latest ? [
            { label:'Total Patients',   val: latest.totalPatients,          delta: delta('totalPatients'),          color:'#6366f1', icon:'fa-users' },
            { label:'Active Patients',  val: latest.activePatients,         delta: delta('activePatients'),         color:'#10b981', icon:'fa-user-check' },
            { label:'New Today',        val: latest.newPatientsToday,       delta: delta('newPatientsToday'),       color:'#06b6d4', icon:'fa-user-plus' },
            { label:'Total RX',         val: latest.totalRX,                delta: delta('totalRX'),                color:'#f59e0b', icon:'fa-prescription-bottle-alt' },
            { label:'Pending RX',       val: latest.pendingRX,              delta: delta('pendingRX'),              color:'#e11d48', icon:'fa-clock' },
            { label:'Completed RX',     val: latest.completedRX,            delta: delta('completedRX'),            color:'#10b981', icon:'fa-check-circle' },
            { label:'Workflow Rate',    val: (latest.workflowCompletionRate||0).toFixed(1)+'%', delta: pctDelta('workflowCompletionRate'), color:'#8b5cf6', icon:'fa-tasks' },
            { label:'Error Logs Today', val: latest.errorLogsToday,         delta: delta('errorLogsToday'),         color:'#ef4444', icon:'fa-bug' },
            { label:'Audit Events',     val: latest.auditEventsToday,       delta: delta('auditEventsToday'),       color:'#64748b', icon:'fa-clipboard-list' },
        ] : [];

        if (kpis.length) {
            var _kHtml = '';
            kpis.forEach(function(k) {
                _kHtml +=
                    '<div class="schema-card" style="padding:0.75rem 0.875rem">' +
                        '<div style="display:flex;align-items:center;gap:0.4rem;margin-bottom:0.3rem">' +
                            '<div style="width:24px;height:24px;border-radius:5px;background:' + k.color + '22;display:flex;align-items:center;justify-content:center;flex-shrink:0">' +
                                '<i class="fas ' + k.icon + '" style="color:' + k.color + ';font-size:0.65rem"></i>' +
                            '</div>' +
                            '<div style="font-size:0.65rem;color:var(--text-muted)">' + k.label + '</div>' +
                        '</div>' +
                        '<div style="font-size:1.25rem;font-weight:700;line-height:1">' + k.val + k.delta + '</div>' +
                        (prev ? '<div style="font-size:0.6rem;color:var(--text-muted)">vs yesterday</div>' : '') +
                    '</div>';
            });
            document.getElementById('anlKpiCards').innerHTML = _kHtml;
        } else {
            document.getElementById('anlKpiCards').innerHTML = '<p style="color:var(--text-muted);padding:1rem">No snapshot data yet. Click <strong>Capture Now</strong> to record today\'s metrics.</p>';
        }

        if (!rows.length) {
            Object.keys(anlCharts).forEach(function(k) { anlCharts[k].destroy(); });
            anlCharts = {};
            document.getElementById('anlTableWrap').innerHTML =
                '<p style="text-align:center;padding:3rem;color:var(--text-muted)"><i class="fas fa-chart-bar" style="display:block;font-size:2rem;opacity:.3;margin-bottom:1rem"></i>No snapshots in this date range.</p>';
            return;
        }

        var labels = rows.map(function(r) { return r.snapshotDate; });
        anlChartDefaults();

        anlMakeChart('chartPatients', {
            type: 'line',
            data: {
                labels: labels,
                datasets: [
                    { label:'Active',   data: rows.map(function(r){return r.activePatients;}),   borderColor:'#10b981', backgroundColor:'rgba(16,185,129,.08)',  tension:.4, fill:true,  pointRadius:3 },
                    { label:'Inactive', data: rows.map(function(r){return r.inactivePatients;}), borderColor:'#64748b', backgroundColor:'rgba(100,116,139,.05)', tension:.4, fill:false, pointRadius:2 },
                    { label:'New/Day',  data: rows.map(function(r){return r.newPatientsToday;}), borderColor:'#6366f1', backgroundColor:'rgba(99,102,241,.08)',  tension:.4, fill:false, pointRadius:3, borderDash:[4,3] },
                ]
            },
            options: anlLineOpts('Patients'),
        });

        anlMakeChart('chartRX', {
            type: 'line',
            data: {
                labels: labels,
                datasets: [
                    { label:'New RX/Day', data: rows.map(function(r){return r.newRXToday;}),               borderColor:'#f59e0b', backgroundColor:'rgba(245,158,11,.08)', tension:.4, fill:true,  pointRadius:3 },
                    { label:'Pending',    data: rows.map(function(r){return r.pendingRX;}),                 borderColor:'#e11d48', backgroundColor:'rgba(225,29,72,.06)',  tension:.4, fill:false, pointRadius:2 },
                    { label:'Completed',  data: rows.map(function(r){return r.completedRX;}),               borderColor:'#10b981', backgroundColor:'rgba(16,185,129,.06)', tension:.4, fill:false, pointRadius:2 },
                    { label:'Returned',   data: rows.map(function(r){return r.returnedToWarehouseRX;}),     borderColor:'#8b5cf6', backgroundColor:'transparent',         tension:.4, fill:false, pointRadius:2, borderDash:[3,3] },
                ]
            },
            options: anlLineOpts('RX Records'),
        });

        var _wfOpts = anlLineOpts('Workflow %');
        _wfOpts.scales.y = { ticks:{ color:'#64748b', callback: function(v){return v+'%';} }, grid:{ color:'rgba(255,255,255,0.05)' }, beginAtZero:true, min:0, max:100 };
        anlMakeChart('chartWorkflow', {
            type: 'line',
            data: {
                labels: labels,
                datasets: [
                    { label:'Completion %', data: rows.map(function(r){return r.workflowCompletionRate;}), borderColor:'#8b5cf6', backgroundColor:'rgba(139,92,246,.12)', tension:.4, fill:true, pointRadius:3 },
                ]
            },
            options: _wfOpts,
        });

        var _evOpts = anlLineOpts('Events/Day');
        _evOpts.plugins.legend = { display:true, labels:{ color:'#64748b', boxWidth:10, font:{size:10} } };
        anlMakeChart('chartActivity', {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [
                    { label:'Errors',       data: rows.map(function(r){return r.errorLogsToday;}),   backgroundColor:'rgba(239,68,68,.6)',  borderRadius:3 },
                    { label:'Audit Events', data: rows.map(function(r){return r.auditEventsToday;}), backgroundColor:'rgba(100,116,139,.4)',borderRadius:3 },
                ]
            },
            options: _evOpts,
        });

        var COLS = [
            ['snapshotDate','Date'],['totalPatients','Patients'],['activePatients','Active'],
            ['newPatientsToday','New Pts'],['totalRX','Total RX'],['newRXToday','New RX'],
            ['pendingRX','Pending'],['completedRX','Done'],['workflowCompletionRate','WF %'],
            ['auditEventsToday','Audit'],['errorLogsToday','Errors'],['unresolvedErrors','Open Errs'],
        ];
        var allRows = rows.slice().reverse();
        var _aTh = '';
        COLS.forEach(function(col) {
            _aTh += '<th style="padding:.4rem .75rem;color:var(--text-muted);font-size:.63rem;text-transform:uppercase;text-align:right;font-weight:600">' + col[1] + '</th>';
        });
        _aTh += '<th style="padding:.4rem .75rem;color:var(--text-muted);font-size:.63rem;text-transform:uppercase"></th>';

        var _aTr = '';
        allRows.forEach(function(r) {
            var _tds = '';
            COLS.forEach(function(col) {
                var k = col[0];
                var v = r[k];
                var isDate = k==='snapshotDate';
                var isRate = k==='workflowCompletionRate';
                var disp   = isRate ? (parseFloat(v)||0).toFixed(1)+'%' : (v !== null && v !== undefined ? v : '\u2014');
                _tds += '<td style="padding:.35rem .75rem;text-align:' + (isDate?'left':'right') + ';' + (isDate?'font-weight:600':'color:var(--text-muted)') + '">' + disp + '</td>';
            });
            _aTr +=
                '<tr style="border-bottom:1px solid rgba(255,255,255,0.03)" onmouseover="this.style.background=\'rgba(255,255,255,0.02)\'" onmouseout="this.style.background=\'\'">' +
                    _tds +
                    '<td style="padding:.35rem .625rem;text-align:center"><button class="btn-bo btn-bo-danger" style="padding:.15rem .4rem;font-size:.62rem" onclick="deleteSnapshot(\'' + r.snapshotDate + '\')"><i class="fas fa-trash"></i></button></td>' +
                '</tr>';
        });

        document.getElementById('anlTableWrap').innerHTML =
            '<div style="background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);overflow:auto">' +
            '<table style="width:100%;border-collapse:collapse;font-size:0.72rem;white-space:nowrap">' +
                '<thead><tr style="background:var(--surface-2);border-bottom:1px solid var(--border)">' + _aTh + '</tr></thead>' +
                '<tbody>' + _aTr + '</tbody>' +
            '</table></div>' +
            '<div style="font-size:0.68rem;color:var(--text-muted);margin-top:.5rem;text-align:right">' + rows.length + ' snapshot(s) in range</div>';
        /* BO-06: Sparklines — last 30 snapshots */
        var _spRows = rows.slice(-30);
        var _spLbls = _spRows.map(function(r) { return r.snapshotDate; });
        anlMakeChart('sparkPatients', { type:'line', data:{ labels:_spLbls, datasets:[{ data:_spRows.map(function(r){return r.activePatients;}), borderColor:'#10b981', backgroundColor:'rgba(16,185,129,0.08)', tension:0.4, fill:true, pointRadius:0, borderWidth:2 }] }, options:{ responsive:true, animation:{duration:300}, plugins:{legend:{display:false},tooltip:{enabled:false}}, scales:{x:{display:false},y:{display:false,beginAtZero:false}} } });
        var _pFirst = _spRows.length > 1 ? (_spRows[0].activePatients || 0) : null;
        var _pLast  = _spRows.length > 0 ? (_spRows[_spRows.length-1].activePatients || 0) : null;
        var _pDelta = document.getElementById('sparkPatientsDelta');
        if (_pDelta && _pFirst !== null) { var _pd = _pLast - _pFirst; var _pc = _pd>=0?'#10b981':'#ef4444'; _pDelta.innerHTML = '<span style="color:' + _pc + ';font-weight:600">' + (_pd>=0?String.fromCharCode(8593):String.fromCharCode(8595)) + Math.abs(_pd) + '</span> vs 30d ago &bull; Latest: <strong>' + _pLast + '</strong>'; }
        anlMakeChart('sparkRX', { type:'line', data:{ labels:_spLbls, datasets:[{ data:_spRows.map(function(r){return r.totalRX;}), borderColor:'#f59e0b', backgroundColor:'rgba(245,158,11,0.08)', tension:0.4, fill:true, pointRadius:0, borderWidth:2 }] }, options:{ responsive:true, animation:{duration:300}, plugins:{legend:{display:false},tooltip:{enabled:false}}, scales:{x:{display:false},y:{display:false,beginAtZero:false}} } });
        var _rFirst = _spRows.length > 1 ? (_spRows[0].totalRX || 0) : null;
        var _rLast  = _spRows.length > 0 ? (_spRows[_spRows.length-1].totalRX || 0) : null;
        var _rDelta = document.getElementById('sparkRXDelta');
        if (_rDelta && _rFirst !== null) { var _rd = _rLast - _rFirst; var _rc = _rd>=0?'#10b981':'#ef4444'; _rDelta.innerHTML = '<span style="color:' + _rc + ';font-weight:600">' + (_rd>=0?String.fromCharCode(8593):String.fromCharCode(8595)) + Math.abs(_rd) + '</span> vs 30d ago &bull; Latest: <strong>' + _rLast + '</strong>'; }

    } catch(e) {
        document.getElementById('anlTableWrap').innerHTML = '<p style="color:#fca5a5;padding:2rem">'+e.message+'</p>';
    }
}

function anlMakeChart(id, config) {
    if (anlCharts[id]) { anlCharts[id].destroy(); delete anlCharts[id]; }
    var ctx = document.getElementById(id);
    if (!ctx) return;
    anlCharts[id] = new Chart(ctx, config);
}

function anlLineOpts(label) {
    return {
        responsive: true,
        animation: { duration: 500 },
        interaction: { mode:'index', intersect:false },
        plugins: {
            legend: { display: true, labels: { color:'#64748b', boxWidth:10, font:{size:10} } },
            tooltip: { backgroundColor:'rgba(15,23,42,.95)', titleColor:'#e2e8f0', bodyColor:'#94a3b8', borderColor:'rgba(255,255,255,0.1)', borderWidth:1 },
        },
        scales: {
            x: { ticks:{ color:'#64748b', maxTicksLimit:10 }, grid:{ color:'rgba(255,255,255,0.05)' } },
            y: { ticks:{ color:'#64748b' }, grid:{ color:'rgba(255,255,255,0.05)' }, beginAtZero:true },
        }
    };
}

async function captureNowSnapshot() {
    try {
        var res  = await apiFetch('/api/admin/snapshots/capture', { method:'POST', headers:{'Content-Type':'application/json'}, body:'{}' });
        var data = await res.json();
        if (!res.ok) throw new Error(data.error||'Failed');
        var snapDate = (data.snapshot && data.snapshot.snapshotDate) ? data.snapshot.snapshotDate : 'today';
        toast('\u2713 Snapshot captured for ' + snapDate, 'success');
        analyticsLoaded = false;
        await loadAnalytics();
    } catch(e) { toast('Capture failed: '+e.message, 'danger'); }
}

async function deleteSnapshot(date) {
    if (!confirm('Delete snapshot for ' + date + '?')) return;
    try {
        var res = await apiFetch('/api/admin/snapshots/'+date, { method:'DELETE' });
        if (!res.ok) { var d=await res.json(); throw new Error(d.error||'Failed'); }
        toast('\u2713 Snapshot ' + date + ' deleted', 'success');
        analyticsLoaded = false;
        await loadAnalytics();
    } catch(e) { toast('Delete failed: '+e.message, 'danger'); }
}

function exportAnalyticsCSV() {
    var _anlFrom = document.getElementById('anlFrom') ? document.getElementById('anlFrom').value : '';
    var _anlTo   = document.getElementById('anlTo')   ? document.getElementById('anlTo').value   : '';
    var url = '/api/admin/snapshots/export';
    var p = [];
    if (_anlFrom) p.push('from='+encodeURIComponent(_anlFrom));
    if (_anlTo)   p.push('to='+encodeURIComponent(_anlTo));
    if (p.length) url += '?' + p.join('&');
    apiFetch(url).then(async function(r) {
        if (!r) { toast('Session expired. Please log in again.', 'danger'); return; }
        if (!r.ok) {
            var errMsg = 'Export failed: ' + r.status;
            var ctype = (r.headers && r.headers.get) ? (r.headers.get('content-type') || '') : '';
            if (ctype.indexOf('json') !== -1) {
                var d = await r.json();
                if (d && d.error) errMsg = 'Export failed: ' + d.error;
            } else {
                var txt = await r.text();
                if (txt && txt.trim()) errMsg = txt.trim().substring(0, 260);
            }
            toast(errMsg, 'danger');
            return;
        }
        var blob = await r.blob();
        if (!blob || !blob.size) { toast('Export returned no data.', 'warning'); return; }
        var a = document.createElement('a');
        a.style.display = 'none';
        a.href = URL.createObjectURL(blob);
        a.download = 'daily-snapshots-' + (_anlFrom||'all') + '-to-' + (_anlTo||'today') + '.csv';
        document.body.appendChild(a);
        a.click();
        setTimeout(function() {
            document.body.removeChild(a);
            URL.revokeObjectURL(a.href);
        }, 150);
        toast('Download started.', 'success');
    }).catch(function(e) { toast('Export error: '+e.message,'danger'); });
}
