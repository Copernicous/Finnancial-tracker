// dashboard.js -- FortiGate-safe ES5 rewrite
// No arrow functions, no const/let, no template literals, no ??, no ?.
// All async done with Promise chains (.then/.catch). Uses var throughout.

// =====================================================================
// API URL anchors -- FortiGate rewrites href on <a> elements correctly
// =====================================================================
var _api = (function() {
    function _h(id) { var el = document.getElementById(id); return el ? el.href : ''; }
    return {
        stats:    _h('xa-stats'),
        charts:   _h('xa-charts'),
        rxp:      _h('xa-rxp'),
        elig:     _h('xa-elig'),
        drill:    _h('xa-drill'),
        eligBase: _h('xa-elig-base'),
        ap:       _h('xa-ap'),
        ip:       _h('xa-ip'),
        tr:       _h('xa-tr'),
        pr:       _h('xa-pr'),
        nr:       _h('xa-nr'),
        s2fa:     _h('xa-s2fa'),
        u2fa:     _h('xa-u2fa'),
        e2fa:     _h('xa-e2fa'),
        d2fa:     _h('xa-d2fa'),
        r2fa:     _h('xa-r2fa'),
        cpw:      _h('xa-cpw')
    };
})();

var drilldownModal = null, drilldownCurrentData = [], drilldownType = '';
var _dashFrom = '', _dashTo = '';
var _accountModal = null;

// =====================================================================
// Date preset helpers
// =====================================================================
function _fmtDate(d) { return d.toISOString().slice(0,10); }

function getPresetRange(preset) {
    var now = new Date();
    var today = _fmtDate(now);
    if (preset === 'all')   return { from: '', to: '' };
    if (preset === 'today') return { from: today, to: today };
    if (preset === 'week')  {
        var s = new Date(now);
        s.setDate(now.getDate() - now.getDay());
        return { from: _fmtDate(s), to: today };
    }
    if (preset === 'month') return { from: _fmtDate(new Date(now.getFullYear(), now.getMonth(), 1)), to: today };
    if (preset === '30d')   {
        var s2 = new Date(now);
        s2.setDate(now.getDate() - 30);
        return { from: _fmtDate(s2), to: today };
    }
    if (preset === 'year')  return { from: _fmtDate(new Date(now.getFullYear(), 0, 1)), to: today };
    return { from: '', to: '' };
}

function setPreset(preset) {
    var range = getPresetRange(preset);
    _dashFrom = range.from;
    _dashTo   = range.to;
    var fromEl = document.getElementById('dashFrom');
    var toEl   = document.getElementById('dashTo');
    if (fromEl) fromEl.value = range.from;
    if (toEl)   toEl.value   = range.to;

    var presets = document.querySelectorAll('.dash-preset');
    for (var pi = 0; pi < presets.length; pi++) {
        var b = presets[pi];
        var isActive = b.getAttribute('data-preset') === preset;
        b.style.background  = isActive ? 'rgba(74,144,226,.18)' : '';
        b.style.borderColor = isActive ? '#4a90e2' : '';
        b.style.color       = isActive ? '#4a90e2' : '';
        b.style.fontWeight  = isActive ? '600' : '';
    }

    var labelMap = {
        all:   'Showing all time',
        today: 'Showing today',
        week:  'Showing this week',
        month: 'Showing this month',
        '30d': 'Showing last 30 days',
        year:  'Showing this year'
    };
    var lbl = document.getElementById('dashRangeLabel');
    if (lbl) lbl.textContent = labelMap[preset] || 'Custom range';
    refreshDashboard();
}

function buildDateQuery() {
    var parts = [];
    if (_dashFrom) parts.push('from=' + _dashFrom);
    if (_dashTo)   parts.push('to='   + _dashTo);
    return parts.length ? '?' + parts.join('&') : '';
}

// =====================================================================
// Dashboard stats refresh
// =====================================================================
function refreshDashboard() {
    var q = buildDateQuery();
    return fetchWithAuth(_api.stats + q).then(function(res) {
        if (!res) return;
        return res.json().then(function(data) {
            var safe = function(v) { return (v !== undefined && v !== null) ? v : 0; };
            var setTxt = function(id, val) { var el = document.getElementById(id); if (el) el.textContent = val; };
            setTxt('activePatientsCount',    safe(data.activePatients));
            setTxt('inactivePatientsCount',  safe(data.inactivePatients));
            setTxt('activeRxCount',          safe(data.activeRxCount));
            setTxt('patientsWithNoRxCount',  safe(data.patientsWithNoRx));
            setTxt('pendingDeliveriesCount', safe(data.pendingDeliveriesCount));

            if (window._auditLogAllowed) {
                var tbody = document.getElementById('recentActivityBody');
                if (tbody) {
                    var acts = (data.recentActivity && data.recentActivity.length > 0) ? data.recentActivity : [];
                    var html = '';
                    if (acts.length > 0) {
                        for (var i = 0; i < acts.length; i++) {
                            var a = acts[i];
                            html += '<tr><td>' + (a.User ? a.User.firstName + ' ' + a.User.lastName : 'System') + '</td>' +
                                   '<td>' + (a.module || '') + '</td>' +
                                   '<td><span class="badge bg-secondary">' + (a.action || '') + '</span></td>' +
                                   '<td>' + (a.date || '&mdash;') + '</td>' +
                                   '<td>' + (a.ipAddress || '&mdash;') + '</td></tr>';
                        }
                    } else {
                        html = '<tr><td colspan="5" class="text-center text-muted">No recent activity</td></tr>';
                    }
                    tbody.innerHTML = html;
                }
            }
        });
    }).catch(function(e) {
        console.warn('Stats refresh error:', e);
    }).then(function() {
        loadRxPipeline();
    });
}

// =====================================================================
// 90-Day Eligibility Widget
// =====================================================================
var _eligData = null;

// Count-up animation — FortiGate-safe (no arrow funcs, no const/let)
function countUp(elId, target, duration) {
    var el = document.getElementById(elId);
    if (!el) return;
    if (target === 0) { el.textContent = '0'; return; }
    var start   = 0;
    var steps   = Math.max(1, Math.ceil(duration / 30));
    var stepVal = Math.ceil(target / steps);
    var timer   = setInterval(function() {
        start += stepVal;
        if (start >= target) { start = target; clearInterval(timer); }
        el.textContent = start;
    }, 30);
}

// Navigate to patients page with a specific eligibility filter pre-applied
// (still kept as fallback from the drilldown modal's "Open Full Page" button)
function goEligFilter(filter) {
    var base = window._patientsUrl || '/patients';
    window.location.href = base + '?eligFilter=' + filter;
}

// =====================================================================
// Eligibility Drilldown — popup same as top stat cards, then full-page link
// =====================================================================
function openEligDrilldown(filter) {
    var titles = {
        'eligible': 'Eligible Now — 90-Day Window Expired',
        'expiring': 'Window Expiring ≤ 7 Days',
        'window':   'In Active 90-Day Window',
        'none':     'No Service Date Set'
    };
    var pageLinks = {
        'eligible': document.getElementById('xl-elig-eligible'),
        'expiring': document.getElementById('xl-elig-expiring'),
        'window':   document.getElementById('xl-elig-window'),
        'none':     document.getElementById('xl-elig-none')
    };
    var icons = {
        'eligible': 'fa-check-circle',
        'expiring': 'fa-hourglass-half',
        'window':   'fa-lock',
        'none':     'fa-calendar-times'
    };
    var colors = {
        'eligible': '#198754',
        'expiring': '#dc3545',
        'window':   '#4a90e2',
        'none':     '#6c757d'
    };

    var titleEl = document.getElementById('drilldownTitle');
    var bodyEl  = document.getElementById('drilldownBody');
    var fpBtn   = document.getElementById('drilldownFullPageBtn');

    if (titleEl) titleEl.textContent = titles[filter] || '90-Day Eligibility';
    if (bodyEl)  bodyEl.innerHTML    = '<p class="text-center text-muted py-4"><i class="fas fa-spinner fa-spin me-2"></i>Loading patients...</p>';
    if (fpBtn) {
        var plEl = pageLinks[filter];
        fpBtn.href = plEl ? plEl.href : '/patients';
        fpBtn.textContent = '';
        var fpIcon = document.createElement('i');
        fpIcon.className = 'fas fa-filter me-1';
        fpBtn.appendChild(fpIcon);
        fpBtn.appendChild(document.createTextNode('View Full Filter'));
    }

    drilldownModal.show();

    var apiUrl = (_api.eligBase || '/api/dashboard/eligibility-drilldown/') + filter;
    fetchWithAuth(apiUrl).then(function(res) {
        if (!res || !res.ok) throw new Error('API error');
        return res.json();
    }).then(function(data) {
        if (titleEl) titleEl.textContent = (titles[filter] || '90-Day Eligibility') + ' (' + data.length + ')';
        _renderEligDrilldownTable(filter, data, colors[filter] || '#6c757d', icons[filter] || 'fa-user');
    }).catch(function() {
        if (bodyEl) bodyEl.innerHTML = '<p class="text-danger text-center py-4"><i class="fas fa-exclamation-triangle me-1"></i>Could not load eligibility data.</p>';
    });
}

function _renderEligDrilldownTable(filter, data, color, icon) {
    var body = document.getElementById('drilldownBody');
    if (!data || !data.length) {
        body.innerHTML = '<p class="text-center text-muted py-4"><i class="fas ' + icon + ' me-2"></i>No patients in this category.</p>';
        return;
    }

    var rows = '';
    for (var i = 0; i < data.length; i++) {
        var p = data[i];

        // Status badge
        var badge = '';
        if (filter === 'eligible') {
            badge = '<span class="badge" style="background:' + color + '22;color:' + color + ';font-size:.78rem">' +
                    '<i class="fas fa-check me-1"></i>Overdue ' + (p.daysPastDue || 0) + 'd</span>';
        } else if (filter === 'expiring') {
            badge = '<span class="badge" style="background:' + color + '22;color:' + color + ';font-size:.78rem">' +
                    '<i class="fas fa-hourglass-half me-1"></i>' + (p.daysLeft || 0) + 'd left</span>';
        } else if (filter === 'window') {
            badge = '<span class="badge" style="background:' + color + '22;color:' + color + ';font-size:.78rem">' +
                    '<i class="fas fa-lock me-1"></i>' + (p.daysLeft || 0) + 'd left</span>';
        } else {
            badge = '<span class="badge bg-secondary" style="font-size:.78rem">No date</span>';
        }

        rows += '<tr>' +
            '<td><code style="color:' + color + '">' + (p.patientCode || p.id) + '</code></td>' +
            '<td><strong>' + (p.firstName || '') + ' ' + (p.lastName || '') + '</strong></td>' +
            '<td>' + (p.serviceDate || '&mdash;') + '</td>' +
            '<td>' + (p.expiryDate  || '&mdash;') + '</td>' +
            '<td>' + badge + '</td>' +
            '<td>' + (p.clinicName || '&mdash;') + '</td>' +
            '</tr>';
    }

    body.innerHTML =
        '<div class="table-responsive">' +
        '<table class="table table-hover table-sm align-middle">' +
        '<thead><tr style="border-bottom:2px solid ' + color + '44">' +
        '<th>Patient ID</th><th>Name</th><th>Service Date</th><th>90-Day Expiry</th><th>Status</th><th>Clinic</th>' +
        '</tr></thead><tbody>' + rows + '</tbody></table></div>' +
        '<small class="text-muted">' + data.length + ' patient' + (data.length !== 1 ? 's' : '') + '</small>';
}

function loadEligibility() {
    var luEl = document.getElementById('eligLastUpdated');
    if (luEl) luEl.textContent = 'Loading\u2026';
    if (!_api.elig) return;
    fetchWithAuth(_api.elig).then(function(res) {
        if (!res || !res.ok) throw new Error('Failed');
        return res.json();
    }).then(function(d) {
        _eligData = d;
        // Animate each counter in with count-up effect
        countUp('eligNowCount',      d.eligibleNow   || 0, 600);
        countUp('eligExpiringCount', d.expiringIn7   || 0, 600);
        countUp('eligInWindowCount', d.inWindow      || 0, 600);
        countUp('eligNoDateCount',   d.noServiceDate || 0, 600);
        if (luEl) luEl.textContent = 'Updated ' + new Date().toLocaleTimeString();
    }).catch(function() {
        if (luEl) luEl.textContent = 'Load failed';
    });
}

// =====================================================================
// RX Pipeline
// =====================================================================
function loadRxPipeline() {
    var stepsEl = document.getElementById('rxPipelineSteps');
    var luEl    = document.getElementById('rxPipelineLastUpdated');
    if (!stepsEl) return;
    stepsEl.innerHTML = '<div class="text-muted text-center py-3"><i class="fas fa-spinner fa-spin me-2"></i>Loading...</div>';

    fetchWithAuth(_api.rxp).then(function(res) {
        if (!res || !res.ok) throw new Error('Failed');
        return res.json();
    }).then(function(d) {
        var safe = function(v) { return (v !== undefined && v !== null) ? v : 0; };
        var setTxt = function(id, val) { var el = document.getElementById(id); if (el) el.textContent = val; };
        setTxt('rxPipelineNotStarted', safe(d.notStarted));
        setTxt('rxPipelineInProgress', safe(d.inProgress));
        setTxt('rxPipelineCompleted',  safe(d.completed));

        var pct = d.total > 0 ? Math.round((d.completed / d.total) * 100) : 0;
        setTxt('rxPipelinePercent', pct + '% complete');
        var bar = document.getElementById('rxPipelineProgressBar');
        if (bar) bar.style.width = pct + '%';
        if (luEl) luEl.textContent = 'Updated ' + new Date().toLocaleTimeString();

        var COLORS = ['#4a90e2','#7b61ff','#fd7e14','#20c997','#e24a9a','#50e3c2','#f5a623'];
        if (!d.stepBreakdown || !d.stepBreakdown.length) {
            stepsEl.innerHTML = '<p class="text-muted text-center small py-2">No workflow steps configured yet.</p>';
            return;
        }

        var stepsHtml = '<div style="font-size:.72rem;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:#888;margin-bottom:10px">Workflow Step Breakdown &mdash; RX records waiting at each step</div>' +
            '<div style="display:flex;flex-direction:column;gap:8px">';
        for (var si = 0; si < d.stepBreakdown.length; si++) {
            var step  = d.stepBreakdown[si];
            var color = COLORS[si % COLORS.length];
            var barPct = d.inProgress > 0 ? Math.round((step.count / d.inProgress) * 100) : 0;
            stepsHtml += '<div style="display:flex;align-items:center;gap:12px">' +
                '<div style="flex-shrink:0;width:22px;height:22px;border-radius:50%;background:' + color + '22;display:flex;align-items:center;justify-content:center;font-size:.65rem;font-weight:700;color:' + color + '">' + (si + 1) + '</div>' +
                '<div style="flex-shrink:0;width:160px;font-size:.82rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="' + (step.name || '') + '">' + (step.name || '') + '</div>' +
                '<div style="flex:1;height:8px;border-radius:4px;background:rgba(0,0,0,.07);overflow:hidden">' +
                    '<div style="height:100%;border-radius:4px;background:' + color + ';width:' + barPct + '%;transition:width .5s ease"></div>' +
                '</div>' +
                '<div style="flex-shrink:0;width:32px;text-align:right;font-size:.82rem;font-weight:600;color:' + color + '">' + step.count + '</div>' +
                '</div>';
        }
        stepsHtml += '</div>';

        if (d.completed > 0) {
            var completedPct = d.total > 0 ? Math.round(d.completed / d.total * 100) : 0;
            stepsHtml += '<div style="display:flex;align-items:center;gap:12px;margin-top:8px;padding-top:8px;border-top:1px solid rgba(0,0,0,.07)">' +
                '<div style="flex-shrink:0;width:22px;height:22px;border-radius:50%;background:#19875422;display:flex;align-items:center;justify-content:center"><i class="fas fa-check" style="font-size:.6rem;color:#198754"></i></div>' +
                '<div style="flex-shrink:0;width:160px;font-size:.82rem;font-weight:600;color:#198754">Completed</div>' +
                '<div style="flex:1;height:8px;border-radius:4px;background:rgba(0,0,0,.07);overflow:hidden">' +
                    '<div style="height:100%;border-radius:4px;background:#198754;width:' + completedPct + '%;transition:width .5s ease"></div>' +
                '</div>' +
                '<div style="flex-shrink:0;width:32px;text-align:right;font-size:.82rem;font-weight:600;color:#198754">' + d.completed + '</div>' +
                '</div>';
        }
        stepsEl.innerHTML = stepsHtml;
    }).catch(function() {
        stepsEl.innerHTML = '<p class="text-danger text-center small py-2"><i class="fas fa-exclamation-triangle me-1"></i>Could not load pipeline data.</p>';
    });
}

// =====================================================================
// Charts
// =====================================================================
function renderCharts(data) {
    var isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    var tc = isDark ? '#c9d1d9' : '#444';
    var gc = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.07)';
    Chart.defaults.color = tc;

    new Chart(document.getElementById('patientsBarChart').getContext('2d'), {
        type: 'bar',
        data: {
            labels: data.patientsPerMonth.labels,
            datasets: [{ label: 'New Patients', data: data.patientsPerMonth.data,
                backgroundColor: 'rgba(74,144,226,0.75)', borderColor: 'rgba(74,144,226,1)',
                borderWidth: 1, borderRadius: 6 }]
        },
        options: { responsive: true, maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
                x: { grid: { color: gc }, ticks: { color: tc } },
                y: { grid: { color: gc }, ticks: { color: tc, stepSize: 1, precision: 0 }, beginAtZero: true }
            }
        }
    });

    var rxData = data.rxStatus;
    var total  = 0;
    for (var ri = 0; ri < rxData.data.length; ri++) { total += rxData.data[ri]; }
    new Chart(document.getElementById('rxDonutChart').getContext('2d'), {
        type: 'doughnut',
        data: {
            labels: rxData.labels,
            datasets: [{
                data:            total > 0 ? rxData.data : [1],
                backgroundColor: total > 0 ? ['rgba(80,227,194,0.85)','rgba(245,166,35,0.85)'] : ['rgba(150,150,150,0.3)'],
                borderWidth: 2,
                borderColor: isDark ? '#1a1f2e' : '#fff'
            }]
        },
        options: {
            responsive: true, maintainAspectRatio: false, cutout: '68%',
            plugins: {
                legend: { position: 'bottom', labels: { color: tc, padding: 14, font: { size: 13 } } },
                tooltip: { callbacks: { label: function(ctx) {
                    return total > 0 ? ' ' + ctx.label + ': ' + ctx.raw + ' (' + Math.round(ctx.raw / total * 100) + '%)' : ' No RX records yet';
                }}}
            }
        }
    });
}

// =====================================================================
// Drilldown modal
// =====================================================================
function openDrilldown(type) {
    drilldownType = type;
    drilldownCurrentData = [];

    var titles = {
        'active-patients':   'Active Patients',
        'inactive-patients': 'Inactive Patients',
        'total-rx':          'All RX Records',
        'pending-rx':        'Pending RX Records (Incomplete Workflow)',
        'patients-no-rx':    'Active Patients with No RX Records'
    };
    var idMap = {
        'active-patients':   'xl-patients-active',
        'inactive-patients': 'xl-patients-inactive',
        'total-rx':          'xl-rx-records',
        'pending-rx':        'xl-rx-records-pending',
        'patients-no-rx':    'xl-patients-norx'
    };
    function getPageLink(t) {
        var lid = idMap[t];
        if (!lid) return '#';
        var el = document.getElementById(lid);
        return el ? el.href : '#';
    }

    var titleEl = document.getElementById('drilldownTitle');
    var bodyEl  = document.getElementById('drilldownBody');
    if (titleEl) titleEl.textContent = titles[type] || 'Report';
    if (bodyEl)  bodyEl.innerHTML = '<p class="text-center text-muted py-4"><i class="fas fa-spinner fa-spin me-2"></i>Loading...</p>';

    var fp = document.getElementById('drilldownFullPageBtn');
    if (fp) fp.href = getPageLink(type);
    drilldownModal.show();

    fetchWithAuth(_api.drill + type).then(function(res) {
        if (!res) return;
        return res.json().then(function(data) {
            drilldownCurrentData = data;
            if (titleEl) titleEl.textContent = (titles[type] || 'Report') + ' (' + data.length + ')';
            renderDrilldownTable(type, data);
        });
    }).catch(function() {
        if (bodyEl) bodyEl.innerHTML = '<p class="text-danger text-center py-4">Error loading data.</p>';
    });
}

function renderDrilldownTable(type, data) {
    var body = document.getElementById('drilldownBody');
    if (!data || !data.length) { body.innerHTML = '<p class="text-center text-muted py-4">No records found.</p>'; return; }
    var patientTypes = { 'active-patients': 1, 'inactive-patients': 1, 'patients-no-rx': 1 };
    var isPatient = !!patientTypes[type];

    if (isPatient) {
        var pRows = '';
        for (var pi = 0; pi < data.length; pi++) {
            var p = data[pi];
            pRows += '<tr>' +
                '<td><code>' + (p.patientCode || p.id) + '</code></td>' +
                '<td><strong>' + (p.firstName || '') + ' ' + (p.lastName || '') + '</strong></td>' +
                '<td>' + (p.dob || '&mdash;') + '</td>' +
                '<td>' + (p.phone || '&mdash;') + '</td>' +
                '<td>' + (p.serviceDate || '&mdash;') + '</td>' +
                '<td>' + (p.Clinic ? p.Clinic.name : '&mdash;') + '</td>' +
                '<td>' + (p.PatientTransportCompany ? (p.PatientTransportCompany.contactPerson || p.PatientTransportCompany.companyName || '&mdash;') : '&mdash;') + '</td>' +
                '<td>' + (p.PharmacyTransportCompany ? (p.PharmacyTransportCompany.contactPerson || p.PharmacyTransportCompany.companyName || '&mdash;') : '&mdash;') + '</td>' +
                '</tr>';
        }
        body.innerHTML = '<div class="table-responsive"><table class="table table-hover table-sm align-middle">' +
            '<thead><tr><th>Patient ID</th><th>Name</th><th>DOB</th><th>Phone</th>' +
            '<th>Service Date</th><th>Clinic</th><th>Patient Transport</th><th>Pharmacy Transport</th>' +
            '</tr></thead><tbody>' + pRows + '</tbody></table></div>' +
            '<small class="text-muted">' + data.length + ' records</small>';
    } else {
        var rxRows = '';
        for (var ri = 0; ri < data.length; ri++) {
            var rx = data[ri];
            var steps  = (rx.RXWorkflowTrackings || []).length;
            var pct    = steps > 0 ? Math.round(steps / Math.max(steps, 1) * 100) : 0;
            rxRows += '<tr>' +
                '<td><strong>#' + rx.id + '</strong></td>' +
                '<td>' + (rx.Patient ? rx.Patient.firstName + ' ' + rx.Patient.lastName : '&mdash;') + '</td>' +
                '<td><code>' + (rx.Patient ? (rx.Patient.patientCode || rx.patientId) : rx.patientId) + '</code></td>' +
                '<td>' + (rx.Pharmacy ? rx.Pharmacy.name : '&mdash;') + '</td>' +
                '<td>' + (rx.arrivalDate || '&mdash;') + '</td>' +
                '<td>' + (rx.serviceDate || '&mdash;') + '</td>' +
                '<td><div class="progress" style="height:8px;min-width:60px"><div class="progress-bar bg-primary" style="width:' + pct + '%"></div></div><small>' + steps + ' step(s) completed</small></td>' +
                '</tr>';
        }
        body.innerHTML = '<div class="table-responsive"><table class="table table-hover table-sm align-middle">' +
            '<thead><tr><th>RX #</th><th>Patient</th><th>Patient ID</th>' +
            '<th>Pharmacy</th><th>Arrival Date</th><th>Service Date</th><th>Workflow Progress</th>' +
            '</tr></thead><tbody>' + rxRows + '</tbody></table></div>' +
            '<small class="text-muted">' + data.length + ' records</small>';
    }
}

// =====================================================================
// CSV exports
// =====================================================================
function exportDrilldownCsv() {
    if (!drilldownCurrentData || !drilldownCurrentData.length) { showToast('No data to export.', 'warning'); return; }
    var patientTypes = { 'active-patients': 1, 'inactive-patients': 1, 'patients-no-rx': 1 };
    var isPatient = !!patientTypes[drilldownType];
    var headers, rows;
    if (isPatient) {
        headers = ['Patient ID','First Name','Last Name','DOB','Phone','Service Date','Clinic','Patient Transport','Pharmacy Transport','Status'];
        rows = [];
        for (var pi = 0; pi < drilldownCurrentData.length; pi++) {
            var p = drilldownCurrentData[pi];
            rows.push([
                p.patientCode || p.id, p.firstName, p.lastName, p.dob || '', p.phone || '',
                p.serviceDate || '',
                p.Clinic ? p.Clinic.name : '',
                p.PatientTransportCompany ? (p.PatientTransportCompany.contactPerson || p.PatientTransportCompany.companyName || '') : '',
                p.PharmacyTransportCompany ? (p.PharmacyTransportCompany.contactPerson || p.PharmacyTransportCompany.companyName || '') : '',
                p.isActive ? 'Active' : 'Inactive'
            ]);
        }
    } else {
        headers = ['RX #','Patient ID','Patient Name','Pharmacy','Arrival Date','Service Date','Steps Completed'];
        rows = [];
        for (var ri = 0; ri < drilldownCurrentData.length; ri++) {
            var rx = drilldownCurrentData[ri];
            rows.push([
                rx.id,
                rx.Patient ? (rx.Patient.patientCode || rx.patientId) : rx.patientId,
                rx.Patient ? rx.Patient.firstName + ' ' + rx.Patient.lastName : '',
                rx.Pharmacy ? rx.Pharmacy.name : '',
                rx.arrivalDate || '', rx.serviceDate || '',
                (rx.RXWorkflowTrackings || []).length
            ]);
        }
    }
    var typeMap = { 'active-patients':'active_patients','inactive-patients':'inactive_patients','total-rx':'all_rx_records','pending-rx':'pending_rx','patients-no-rx':'patients_no_rx' };
    exportToCsv((typeMap[drilldownType] || 'report') + '_' + new Date().toISOString().slice(0,10) + '.csv', headers, rows);
}

function exportDashboardReport() {
    var btn = document.getElementById('exportDashboardBtn');
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin me-1"></i>Exporting...';
    var results = {};
    var keys    = ['active','inactive','totalRx','pending','noRx'];
    var apis    = [_api.ap, _api.ip, _api.tr, _api.pr, _api.nr];
    var done    = 0;
    var failed  = false;

    function finish() {
        if (failed) { showToast('Export failed', 'danger'); btn.disabled = false; btn.innerHTML = '<i class="fas fa-file-csv me-1"></i>Export Report'; return; }
        var headers = ['Section','Patient/RX ID','Name','Status','DOB / Arrival Date','Service Date','Clinic / Pharmacy'];
        var rows = [];
        var addPatient = function(section, list, status) {
            for (var i = 0; i < list.length; i++) {
                var p = list[i];
                rows.push([section, p.patientCode || p.id, (p.firstName || '') + ' ' + (p.lastName || ''), status, p.dob || '', p.serviceDate || '', p.Clinic ? p.Clinic.name : '']);
            }
        };
        var addRx = function(section, list, status) {
            for (var i = 0; i < list.length; i++) {
                var rx = list[i];
                rows.push([section, '#' + rx.id, rx.Patient ? rx.Patient.firstName + ' ' + rx.Patient.lastName : '', status, rx.arrivalDate || '', rx.serviceDate || '', rx.Pharmacy ? rx.Pharmacy.name : '']);
            }
        };
        addPatient('Active Patients',    results.active   || [], 'Active');
        addPatient('Inactive Patients',  results.inactive || [], 'Inactive');
        addPatient('No RX Records',      results.noRx     || [], 'Active');
        addRx('RX Records',         results.totalRx  || [], 'RX');
        addRx('Pending Deliveries', results.pending  || [], 'Pending');
        exportToCsv('dashboard_report_' + new Date().toISOString().slice(0,10) + '.csv', headers, rows);
        showToast('Dashboard report exported!', 'success');
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-file-csv me-1"></i>Export Report';
    }

    for (var ki = 0; ki < keys.length; ki++) {
        (function(key, url) {
            fetchWithAuth(url).then(function(r) { return r.json(); }).then(function(data) {
                results[key] = data;
                done++;
                if (done === keys.length) finish();
            }).catch(function() {
                failed = true;
                done++;
                if (done === keys.length) finish();
            });
        })(keys[ki], apis[ki]);
    }
}

function exportRecentActivity() {
    var rows = [];
    var trs  = document.querySelectorAll('#recentActivityBody tr');
    for (var i = 0; i < trs.length; i++) {
        var c = trs[i].querySelectorAll('td');
        if (c.length >= 4) rows.push([c[0].textContent.trim(), c[1].textContent.trim(), c[2].textContent.trim(), c[3].textContent.trim(), c[4] ? c[4].textContent.trim() : '']);
    }
    if (!rows.length) { showToast('No activity to export', 'warning'); return; }
    exportToCsv('recent_activity_' + new Date().toISOString().slice(0,10) + '.csv', ['User','Module','Action','Date','IP Address'], rows);
    showToast('Recent activity exported!', 'success');
}

// =====================================================================
// Account / 2FA modal
// =====================================================================
function openAccountModal() {
    if (!_accountModal) _accountModal = new bootstrap.Modal(document.getElementById('accountModal'));
    load2FAStatus();
    _accountModal.show();
}

function load2FAStatus() {
    fetchWithAuth(_api.s2fa).then(function(res) {
        if (!res) return;
        return res.json().then(function(data) {
            var enabled = !!data.twoFactorEnabled;
            var icon   = document.getElementById('twoFAStatusIcon');
            var text   = document.getElementById('twoFAStatusText');
            var sub    = document.getElementById('twoFAStatusSub');
            var banner = document.getElementById('twoFAStatusBanner');
            var remain = document.getElementById('twoFABackupRemaining');

            if (enabled) {
                icon.innerHTML      = '<i class="fas fa-shield-alt text-success"></i>';
                text.innerHTML      = '<span class="text-success">2FA is ENABLED</span>';
                sub.textContent     = 'Your account is protected with two-factor authentication.';
                banner.style.background = 'rgba(25,135,84,.15)';
                if (remain) {
                    var cnt = data.backupCodesRemaining;
                    remain.className = 'mt-1 small ' + (cnt > 2 ? 'text-success' : 'text-warning');
                    remain.textContent = cnt + ' backup code' + (cnt !== 1 ? 's' : '') + ' remaining';
                    remain.classList.remove('d-none');
                }
                document.getElementById('twoFASetupSection').classList.add('d-none');
                document.getElementById('twoFADisableSection').classList.remove('d-none');
                document.getElementById('twoFADisableCode').value = '';
                document.getElementById('twoFADisableError').classList.add('d-none');
            } else {
                icon.innerHTML  = '<i class="fas fa-shield-alt text-muted"></i>';
                text.innerHTML  = '<span class="text-muted">2FA is DISABLED</span>';
                sub.textContent = 'Enable 2FA to protect your account.';
                banner.style.background = 'rgba(255,255,255,.05)';
                if (remain) remain.classList.add('d-none');
                document.getElementById('twoFASetupSection').classList.remove('d-none');
                document.getElementById('twoFADisableSection').classList.add('d-none');
                document.getElementById('twoFAQRSection').classList.add('d-none');
                document.getElementById('twoFABackupCodesSection').classList.add('d-none');
            }
        });
    }).catch(function(e) { console.error('2FA status load failed', e); });
}

function start2FASetup() {
    var btn = document.getElementById('startSetupBtn');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>Generating QR code\u2026';
    fetchWithAuth(_api.u2fa).then(function(res) {
        if (!res || !res.ok) { showToast('Failed to generate 2FA setup.', 'danger'); return; }
        return res.json().then(function(data) {
            document.getElementById('twoFAQRImg').src           = data.qrCode;
            document.getElementById('twoFASecretDisplay').value = data.secret;
            document.getElementById('twoFAEnableCode').value    = '';
            document.getElementById('twoFAEnableError').classList.add('d-none');
            document.getElementById('twoFAQRSection').classList.remove('d-none');
        });
    }).catch(function() { showToast('Network error.', 'danger'); })
    .then(function() {
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-qrcode me-1"></i>Set Up Two-Factor Authentication';
    });
}

function enable2FA() {
    var rawCode = document.getElementById('twoFAEnableCode').value.replace(/\s/g,'');
    var errEl   = document.getElementById('twoFAEnableError');
    var btn     = document.getElementById('enableTwoFABtn');
    var spinner = document.getElementById('enableSpinner');
    errEl.classList.add('d-none');
    if (rawCode.length !== 6) { errEl.textContent = 'Enter the full 6-digit code.'; errEl.classList.remove('d-none'); return; }
    btn.disabled = true; spinner.classList.remove('d-none');
    fetchWithAuth(_api.e2fa, { method: 'POST', body: JSON.stringify({ code: rawCode }) })
    .then(function(res) {
        return res.json().then(function(data) {
            if (res.ok) {
                showToast('2FA enabled! Save your backup codes.', 'success');
                if (data.backupCodes && data.backupCodes.length) {
                    var grid    = document.getElementById('twoFABackupCodesGrid');
                    var section = document.getElementById('twoFABackupCodesSection');
                    if (grid && section) {
                        var backupCodesHtml = '';
                        data.backupCodes.forEach(function(c) {
                            backupCodesHtml += '<div style="font-family:monospace;font-size:.85rem;background:rgba(255,255,255,.07);border-radius:6px;padding:6px 8px;text-align:center;letter-spacing:.08em">' + c + '</div>';
                        });
                        grid.innerHTML = backupCodesHtml;
                        section.classList.remove('d-none');
                        window._backupCodesArr = data.backupCodes;
                    }
                }
                load2FAStatus();
            } else { errEl.textContent = data.message || 'Invalid code.'; errEl.classList.remove('d-none'); }
        });
    }).catch(function() { errEl.textContent = 'Network error.'; errEl.classList.remove('d-none'); })
    .then(function() { btn.disabled = false; spinner.classList.add('d-none'); });
}

function disable2FA() {
    var rawCode = document.getElementById('twoFADisableCode').value.replace(/\s/g,'');
    var errEl   = document.getElementById('twoFADisableError');
    var btn     = document.getElementById('disableTwoFABtn');
    var spinner = document.getElementById('disableSpinner');
    errEl.classList.add('d-none');
    if (rawCode.length !== 6) { errEl.textContent = 'Enter the full 6-digit code.'; errEl.classList.remove('d-none'); return; }
    btn.disabled = true; spinner.classList.remove('d-none');
    fetchWithAuth(_api.d2fa, { method: 'POST', body: JSON.stringify({ code: rawCode }) })
    .then(function(res) {
        return res.json().then(function(data) {
            if (res.ok) { showToast('2FA has been disabled.', 'warning'); load2FAStatus(); }
            else        { errEl.textContent = data.message || 'Invalid code.'; errEl.classList.remove('d-none'); }
        });
    }).catch(function() { errEl.textContent = 'Network error.'; errEl.classList.remove('d-none'); })
    .then(function() { btn.disabled = false; spinner.classList.add('d-none'); });
}

function regenerateBackupCodes() {
    var code  = document.getElementById('regenCode').value.replace(/\s/g,'');
    var errEl = document.getElementById('regenError');
    errEl.classList.add('d-none');
    if (code.length !== 6) { errEl.textContent = 'Enter the 6-digit authenticator code.'; errEl.classList.remove('d-none'); return; }
    fetchWithAuth(_api.r2fa, { method: 'POST', body: JSON.stringify({ code: code }) })
    .then(function(res) {
        return res.json().then(function(data) {
            if (res.ok && data.backupCodes) {
                var grid    = document.getElementById('twoFABackupCodesGrid');
                var section = document.getElementById('twoFABackupCodesSection');
                if (grid && section) {
                    var backupCodesHtml = '';
                    data.backupCodes.forEach(function(c) {
                        backupCodesHtml += '<div style="font-family:monospace;font-size:.85rem;background:rgba(255,255,255,.07);border-radius:6px;padding:6px 8px;text-align:center;letter-spacing:.08em">' + c + '</div>';
                    });
                    grid.innerHTML = backupCodesHtml;
                    section.classList.remove('d-none');
                    window._backupCodesArr = data.backupCodes;
                }
                document.getElementById('regenCode').value = '';
                showToast('New backup codes generated. Old codes are now invalid.', 'success');
                load2FAStatus();
            } else { errEl.textContent = data.message || 'Failed.'; errEl.classList.remove('d-none'); }
        });
    }).catch(function() { errEl.textContent = 'Network error.'; errEl.classList.remove('d-none'); });
}

function copyBackupCodes() {
    var codes = window._backupCodesArr;
    if (!codes || !codes.length) { showToast('No codes to copy.', 'warning'); return; }
    navigator.clipboard.writeText(codes.join('\n')).then(function() { showToast('Backup codes copied!', 'info'); });
}

function shakeFeedback(el) {
    if (!el) return;
    if (el._shakeTimer) clearTimeout(el._shakeTimer);
    el.classList.remove('shake-feedback');
    void el.offsetWidth;
    el.classList.add('shake-feedback');
    el._shakeTimer = setTimeout(function() {
        el.classList.remove('shake-feedback');
        el._shakeTimer = null;
    }, 600);
}

function showChangePasswordError(message) {
    var errEl = document.getElementById('cpError');
    var section = document.getElementById('changePwSection');
    if (!errEl) return;
    errEl.textContent = message || 'Failed.';
    errEl.classList.remove('d-none');
    shakeFeedback(section || errEl);
}

function changePassword() {
    var current = document.getElementById('cpCurrentPw').value;
    var newPw   = document.getElementById('cpNewPw').value;
    var errEl   = document.getElementById('cpError');
    var okEl    = document.getElementById('cpSuccess');
    errEl.classList.add('d-none'); okEl.classList.add('d-none');
    if (!current || !newPw) { showChangePasswordError('Both fields are required.'); return; }
    if (newPw.length < 8)   { showChangePasswordError('New password must be at least 8 characters.'); return; }
    fetchWithAuth(_api.cpw, { method: 'POST', body: JSON.stringify({ currentPassword: current, newPassword: newPw }) })
    .then(function(res) {
        if (!res) return;
        return res.json().then(function(data) {
            if (res.ok) {
                // BUG-22 FIX: Immediately log out the current session too.
                // The server already incremented tokenVersion so the old token
                // is now invalid. Clear it from the browser and redirect to login.
                showToast('Password changed! Signing you out now…', 'success');
                setTimeout(function() {
                    localStorage.removeItem('token');
                    localStorage.removeItem('user');
                    // Expire the JS-writable rxToken cookie
                    document.cookie = 'rxToken=; path=/; max-age=0; SameSite=Lax';
                    window.rxNav('/login?reason=password-changed');
                }, 1200); // brief delay so the toast is visible
            } else { showChangePasswordError(data.message || 'Failed.'); }
        });
    }).catch(function() { showChangePasswordError('Network error.'); });

}

function copySecret() {
    var s = document.getElementById('twoFASecretDisplay').value;
    navigator.clipboard.writeText(s).then(function() { showToast('Secret key copied!', 'info'); });
}

// Auto-format 2FA code inputs (insert space after 3 digits)
(function() {
    var ids = ['twoFAEnableCode','twoFADisableCode','regenCode'];
    for (var ii = 0; ii < ids.length; ii++) {
        (function(id) {
            var el = document.getElementById(id);
            if (!el) return;
            el.addEventListener('input', function() {
                var v = this.value.replace(/\D/g,'').substring(0,6);
                this.value = v.length > 3 ? v.slice(0,3) + ' ' + v.slice(3) : v;
            });
        })(ids[ii]);
    }
})();

// =====================================================================
// Auto-refresh engine
// =====================================================================
(function initAutoRefresh() {
    var _arTimer       = null;
    var _arCountTimer  = null;
    var _arSecondsLeft = 0;
    var _arInterval    = 0;

    var elSelect    = document.getElementById('arIntervalSelect');
    var elCountdown = document.getElementById('arCountdown');
    var elDot       = document.getElementById('arPulseDot');
    var elManual    = document.getElementById('arManualBtn');

    if (!elSelect) return;

    var _saved = parseInt(localStorage.getItem('rxDashRefresh') || '0', 10);
    if (_saved > 0) { elSelect.value = String(_saved); }

    function formatCountdown(s) {
        if (s <= 0) return '0s';
        if (s < 60)  return s + 's';
        var m = Math.floor(s / 60);
        var r = s % 60;
        return r > 0 ? m + 'm ' + r + 's' : m + 'm';
    }

    function setDotActive(active) {
        elDot.style.background = active ? '#22c55e' : '#6c757d';
        elDot.style.boxShadow  = active ? '0 0 6px rgba(34,197,94,0.6)' : 'none';
    }

    function stopTimers() {
        if (_arTimer)      { clearInterval(_arTimer);      _arTimer      = null; }
        if (_arCountTimer) { clearInterval(_arCountTimer); _arCountTimer = null; }
    }

    function startAutoRefresh(seconds) {
        stopTimers();
        _arInterval    = seconds;
        _arSecondsLeft = seconds;
        if (seconds <= 0) {
            elCountdown.textContent = 'Off';
            setDotActive(false);
            return;
        }
        elCountdown.textContent = formatCountdown(_arSecondsLeft);
        setDotActive(true);
        _arCountTimer = setInterval(function() {
            _arSecondsLeft--;
            elCountdown.textContent = formatCountdown(Math.max(0, _arSecondsLeft));
        }, 1000);
        _arTimer = setInterval(function() {
            _arSecondsLeft = _arInterval;
            var icon = elManual ? elManual.querySelector('i') : null;
            if (icon) {
                icon.style.transition = 'transform 0.6s ease';
                icon.style.transform  = 'rotate(360deg)';
                setTimeout(function() { icon.style.transition = ''; icon.style.transform = ''; }, 700);
            }
            refreshDashboard();
        }, seconds * 1000);
    }

    startAutoRefresh(_saved);

    elSelect.addEventListener('change', function() {
        var val = parseInt(this.value, 10);
        localStorage.setItem('rxDashRefresh', String(val));
        startAutoRefresh(val);
    });

    if (elManual) {
        elManual.addEventListener('click', function() {
            var icon = this.querySelector('i');
            if (icon) {
                icon.style.transition = 'transform 0.5s ease';
                icon.style.transform  = 'rotate(360deg)';
                setTimeout(function() { icon.style.transition = ''; icon.style.transform = ''; }, 600);
            }
            _arSecondsLeft = _arInterval;
            refreshDashboard();
        });
    }

    document.addEventListener('visibilitychange', function() {
        if (document.hidden) {
            stopTimers();
        } else if (_arInterval > 0) {
            _arSecondsLeft = _arInterval;
            startAutoRefresh(_arInterval);
        }
    });
})();

// =====================================================================
// Main entry point -- DOMContentLoaded
// =====================================================================
document.addEventListener('DOMContentLoaded', function() {
    initApp();
    drilldownModal = new bootstrap.Modal(document.getElementById('drilldownModal'));

    // Preset buttons
    var presetBtns = document.querySelectorAll('.dash-preset');
    for (var pi = 0; pi < presetBtns.length; pi++) {
        (function(btn) {
            btn.addEventListener('click', function() { setPreset(btn.getAttribute('data-preset')); });
        })(presetBtns[pi]);
    }

    // Date pickers
    var dateIds = ['dashFrom', 'dashTo'];
    for (var di = 0; di < dateIds.length; di++) {
        var el = document.getElementById(dateIds[di]);
        if (el) {
            el.addEventListener('change', function() {
                _dashFrom = document.getElementById('dashFrom').value;
                _dashTo   = document.getElementById('dashTo').value;
                var presets = document.querySelectorAll('.dash-preset');
                for (var pi2 = 0; pi2 < presets.length; pi2++) {
                    var b = presets[pi2];
                    b.style.background = b.style.borderColor = b.style.color = b.style.fontWeight = '';
                }
                var lbl = document.getElementById('dashRangeLabel');
                if (lbl) lbl.textContent = (_dashFrom || _dashTo) ? 'Custom range' : 'Showing all time';
                refreshDashboard();
            });
        }
    }

    // Highlight "all" preset by default
    var allBtn = document.querySelector('.dash-preset[data-preset="all"]');
    if (allBtn) {
        allBtn.style.background  = 'rgba(74,144,226,.18)';
        allBtn.style.borderColor = '#4a90e2';
        allBtn.style.color       = '#4a90e2';
        allBtn.style.fontWeight  = '600';
    }

    // Audit log permission check
    window._auditLogAllowed = (function() {
        try {
            var u = JSON.parse(localStorage.getItem('user'));
            if (!u) return false;
            var perms = u.permissions || getRoleDefaultPermissions(u.role);
            var p = perms['audit_log'];
            return !!(p && p.visible === true);
        } catch(e) { return false; }
    })();
    if (!window._auditLogAllowed) {
        var card = document.getElementById('recentActivityCard');
        if (card) card.classList.add('d-none');
    }

    // Export buttons
    var drillCsv = document.getElementById('drilldownCsvBtn');
    if (drillCsv) drillCsv.addEventListener('click', exportDrilldownCsv);
    var expDash = document.getElementById('exportDashboardBtn');
    if (expDash) expDash.addEventListener('click', exportDashboardReport);
    var expAct = document.getElementById('exportActivityBtn');
    if (expAct) expAct.addEventListener('click', exportRecentActivity);

    // Load data
    refreshDashboard().then(function() {
        return fetchWithAuth(_api.charts);
    }).then(function(chartRes) {
        if (chartRes && chartRes.ok) {
            return chartRes.json().then(function(chartData) {
                window._lastChartData = chartData;
                renderCharts(chartData);
            });
        }
    }).catch(function(e) { console.warn('Charts failed:', e); });

    // Load eligibility widget independently
    loadEligibility();

    // ISSUE-03 FIX: Re-render charts on theme toggle so dark/light colors update
    var _themeBtn = document.getElementById('themeToggle');
    if (_themeBtn) {
        _themeBtn.addEventListener('click', function() {
            setTimeout(function() {
                if (window._lastChartData) {
                    var barCanvas   = document.getElementById('patientsBarChart');
                    var donutCanvas = document.getElementById('rxDonutChart');
                    if (barCanvas   && Chart.getChart(barCanvas))   Chart.getChart(barCanvas).destroy();
                    if (donutCanvas && Chart.getChart(donutCanvas)) Chart.getChart(donutCanvas).destroy();
                    renderCharts(window._lastChartData);
                }
            }, 60);
        });
    }
});
