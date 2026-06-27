// system-settings.js â€” General, Email, Manual tabs only.
// API Keys moved to Backoffice.

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// GENERAL TAB â€” Timezone & App Name
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const TZ_GROUPS = {
    'Eastern US':    ['America/New_York','America/Detroit'],
    'Central US':    ['America/Chicago','America/Winnipeg'],
    'Mountain US':   ['America/Denver','America/Phoenix'],
    'Pacific US':    ['America/Los_Angeles','America/Vancouver'],
    'Other US':      ['America/Anchorage','Pacific/Honolulu'],
    'Caribbean':     ['America/Puerto_Rico','America/Santo_Domingo','America/Barbados','America/Jamaica','Atlantic/Bermuda'],
    'UTC':           ['UTC'],
    'Europe':        ['Europe/London','Europe/Madrid','Europe/Paris','Europe/Berlin','Europe/Lisbon','Europe/Rome'],
    'Latin America': ['America/Bogota','America/Lima','America/Caracas','America/La_Paz','America/Sao_Paulo','America/Argentina/Buenos_Aires','America/Santiago']
};

let currentSettings = {};
let clockInterval   = null;

function updateClocks(tz) {
    tz = tz || currentSettings.app_timezone || 'UTC';
    const now = new Date();
    const fmt = new Intl.DateTimeFormat('en-US', { timeZone:tz, year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', second:'2-digit', hour12:true }).format(now);
    const off = now.toLocaleString('en-US', { timeZone:tz, timeZoneName:'short' }).split(' ').pop();
    document.getElementById('liveClock').textContent     = fmt;
    document.getElementById('liveTimezone').textContent  = tz + ' (' + off + ')';
    document.getElementById('previewClock').textContent  = fmt;
    document.getElementById('previewOffset').textContent = off;
    document.getElementById('previewUtc').textContent    = now.toISOString().replace('T',' ').slice(0,19) + ' UTC';
}

function populateTzSelect(currentTz) {
    const sel = document.getElementById('tzSelect');
    sel.innerHTML = '';
    for (const [group, zones] of Object.entries(TZ_GROUPS)) {
        const og = document.createElement('optgroup');
        og.label = group;
        for (const tz of zones) {
            const opt = document.createElement('option');
            opt.value = tz;
            opt.textContent = tz.replace(/America\//,'').replace(/_/g,' ');
            if (tz === currentTz) opt.selected = true;
            og.appendChild(opt);
        }
        sel.appendChild(og);
    }
    sel.addEventListener('change', () => updateClocks(sel.value));
}

function renderSettingsTable(s) {
    const tbody = document.getElementById('allSettingsBody');
    const entries = Object.entries(s);
    if (!entries.length) { tbody.innerHTML = '<tr><td colspan="2" class="text-muted text-center">No settings found</td></tr>'; return; }
    tbody.innerHTML = (function(){ var _en=''; entries.forEach(function(_e){ var k=_e[0],v=_e[1]; _en+='<tr><td><code>'+k+'</code></td><td><span class="tz-badge">'+(v||'â€”')+'</span></td></tr>'; }); return _en; })();
}

async function loadSettings() {
    const res = await fetchWithAuth('/api/settings');
    if (!res || !res.ok) return;
    currentSettings = await res.json();
    const tz = currentSettings.app_timezone || 'America/New_York';
    document.getElementById('currentTzBadge').textContent = tz;
    document.getElementById('appNameInput').value = currentSettings.app_name || '';
    populateTzSelect(tz);
    renderSettingsTable(currentSettings);
    updateClocks(tz);
    initTwoFaToggle(currentSettings.require_2fa !== 'false');
    // Security settings
    var sTimeout = document.getElementById('sessionTimeoutInput');
    var sMaxFail = document.getElementById('maxFailedLoginsInput');
    if (sTimeout) sTimeout.value = currentSettings.session_timeout_minutes || '30';
    if (sMaxFail) sMaxFail.value = currentSettings.max_failed_logins || '5';
}

function showSaved(id) {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.add('visible');
    setTimeout(() => el.classList.remove('visible'), 2500);
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// 2FA GLOBAL TOGGLE
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function initTwoFaToggle(enabled) {
    const toggle = document.getElementById('twoFaToggle');
    if (!toggle) return;
    toggle.checked = enabled;
    _updateTwoFaUI(enabled);
    toggle.addEventListener('change', () => _updateTwoFaUI(toggle.checked));
}

function _updateTwoFaUI(enabled) {
    const badge   = document.getElementById('twoFaBadge');
    const label   = document.getElementById('twoFaToggleLabel');
    const dot     = document.getElementById('twoFaDot');
    const statusT = document.getElementById('twoFaStatusText');
    const warn    = document.getElementById('twoFaDisabledWarning');
    if (enabled) {
        if (badge)   { badge.className = 'badge bg-success'; badge.textContent = 'Enabled'; }
        if (label)   label.innerHTML = '2FA is <strong>Enabled</strong>';
        if (dot)     dot.style.background = '#22c55e';
        if (statusT) statusT.textContent = 'Active';
        if (warn)    warn.style.display = 'none';
    } else {
        if (badge)   { badge.className = 'badge bg-danger'; badge.textContent = 'Disabled'; }
        if (label)   label.innerHTML = '2FA is <strong>Disabled</strong>';
        if (dot)     dot.style.background = '#ef4444';
        if (statusT) statusT.textContent = 'Bypassed';
        if (warn)    warn.style.display = '';
    }
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// TAB SWITCHING (General, Email, Manual â€” API Keys moved to Backoffice)
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function switchTab(tab) {
    document.querySelectorAll('#settingsTabs .nav-link').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('[id^="tab-"]').forEach(t => t.classList.add('d-none'));
    const panel = document.getElementById('tab-' + tab);
    if (panel) panel.classList.remove('d-none');
    const btn = document.querySelector(`[data-tab="${tab}"]`);
    if (btn) btn.classList.add('active');
    if (tab === 'email') loadEmailSettings();
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// EMAIL SETTINGS TAB
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
let _emailLoaded = false;

async function loadEmailSettings() {
    if (_emailLoaded) return;
    _emailLoaded = true;
    try {
        const res = await fetchWithAuth('/api/settings/email-status');
        if (!res || !res.ok) return;
        const d = await res.json();

        document.getElementById('smtpHost').value     = d.smtp_host      || '';
        document.getElementById('smtpPort').value     = d.smtp_port      || '587';
        document.getElementById('smtpUser').value     = d.smtp_user      || '';
        document.getElementById('smtpFromName').value = d.smtp_from_name || 'Home Accounting';

        const hint = document.getElementById('smtpPassHint');
        if (hint) {
            if (d.smtp_pass_set) {
                hint.textContent = '(password already saved â€” leave blank to keep)';
                hint.style.color = '#22c55e';
            } else {
                hint.textContent = '(not set)';
                hint.style.color = '#f59e0b';
            }
        }

        const badge = document.getElementById('emailStatusBadge');
        if (badge) {
            if (d.configured) {
                badge.className = 'badge bg-success';
                badge.innerHTML = '<i class="fas fa-check me-1"></i>Configured';
            } else {
                badge.className = 'badge bg-warning text-dark';
                badge.innerHTML = '<i class="fas fa-exclamation-triangle me-1"></i>Not Configured';
            }
        }

        if (d.smtp_host && d.smtp_host.includes('gmail')) {
            document.getElementById('gmailGuide')?.classList.remove('d-none');
        }
    } catch(e) { console.error('loadEmailSettings:', e); }
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// CLIPBOARD HELPERS
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function copyCmd(elementId, btn) {
    const el = document.getElementById(elementId);
    if (!el) return;
    const text = el.innerText || el.textContent;
    navigator.clipboard.writeText(text).then(() => {
        const orig = btn.innerHTML;
        btn.innerHTML = '<i class="fas fa-check me-1"></i>Copied!';
        btn.style.background = 'rgba(34,197,94,.3)';
        btn.style.color = '#4ade80';
        setTimeout(() => { btn.innerHTML = orig; btn.style.background = ''; btn.style.color = ''; }, 2000);
    }).catch(() => showToast('Could not copy â€” please copy manually', 'warning'));
}

function copyToClipboard(text, btn) {
    if (!text || !text.trim()) return;
    navigator.clipboard.writeText(text.trim()).then(() => {
        const orig = btn.innerHTML;
        btn.innerHTML = '<i class="fas fa-check"></i> Copied!';
        setTimeout(() => { btn.innerHTML = orig; }, 1800);
    });
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// DOMContentLoaded â€” wire up all buttons and init
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
document.addEventListener('DOMContentLoaded', async () => {
    initApp();

    const user = JSON.parse(localStorage.getItem('user') || '{}');
    if (user.role !== 'Administrator') {
        document.getElementById('settingsContent')?.classList.add('d-none');
        document.getElementById('adminGuard')?.classList.remove('d-none');
        return;
    }

    await loadSettings();

    clockInterval = setInterval(() => {
        const tz = document.getElementById('tzSelect')?.value || currentSettings.app_timezone || 'UTC';
        updateClocks(tz);
    }, 1000);

    // â”€â”€ Tab switching â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    document.querySelectorAll('#settingsTabs .nav-link').forEach(btn => {
        btn.addEventListener('click', () => switchTab(btn.dataset.tab));
    });

    // Auto-open tab from URL param: ?tab=manual, ?tab=email, etc.
    const _urlTab = new URLSearchParams(location.search).get('tab');
    if (_urlTab && document.getElementById('tab-' + _urlTab)) {
        switchTab(_urlTab);
    }

    // â”€â”€ Save Timezone â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    document.getElementById('saveTzBtn')?.addEventListener('click', async () => {
        const tz  = document.getElementById('tzSelect').value;
        if (!tz) return;
        const btn = document.getElementById('saveTzBtn');
        btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin me-1"></i>Saving...';
        try {
            const res = await fetchWithAuth('/api/settings', { method:'PUT', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ app_timezone:tz }) });
            if (res && res.ok) {
                const data = await res.json();
                currentSettings = data.settings;
                document.getElementById('currentTzBadge').textContent = tz;
                renderSettingsTable(currentSettings);
                showSaved('tzSaveOk');
                showToast('Timezone updated to ' + tz, 'success');
            } else {
                const err = await res.json();
                showToast(err.error || 'Failed to save timezone', 'danger');
            }
        } catch(e) { showToast('Network error', 'danger'); }
        finally { btn.disabled = false; btn.innerHTML = '<i class="fas fa-save me-1"></i>Save Timezone'; }
    });

    // â”€â”€ Save App Name â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    document.getElementById('saveNameBtn')?.addEventListener('click', async () => {
        const name = document.getElementById('appNameInput').value.trim();
        if (!name) { showToast('App name cannot be empty', 'warning'); return; }
        const btn = document.getElementById('saveNameBtn');
        btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin me-1"></i>Saving...';
        try {
            const res = await fetchWithAuth('/api/settings', { method:'PUT', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ app_name:name }) });
            if (res && res.ok) {
                const data = await res.json();
                currentSettings = data.settings;
                renderSettingsTable(currentSettings);
                showSaved('nameSaveOk');
                showToast('App name updated!', 'success');
            } else { showToast('Failed to save name', 'danger'); }
        } catch(e) { showToast('Network error', 'danger'); }
        finally { btn.disabled = false; btn.innerHTML = '<i class="fas fa-save me-1"></i>Save Name'; }
    });

    // â”€â”€ Save Global 2FA Setting â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    document.getElementById('saveTwoFaBtn')?.addEventListener('click', async () => {
        const enabled = document.getElementById('twoFaToggle').checked;
        const btn = document.getElementById('saveTwoFaBtn');
        btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin me-1"></i>Saving...';
        try {
            const res = await fetchWithAuth('/api/settings', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ require_2fa: String(enabled) })
            });
            if (res && res.ok) {
                const data = await res.json();
                currentSettings = data.settings;
                renderSettingsTable(currentSettings);
                showSaved('twoFaSaveOk');
                showToast('2FA setting ' + (enabled ? 'enabled' : 'disabled') + ' globally', enabled ? 'success' : 'warning');
            } else { showToast('Failed to save 2FA setting', 'danger'); }
        } catch(e) { showToast('Network error', 'danger'); }
        finally { btn.disabled = false; btn.innerHTML = '<i class="fas fa-save me-1"></i>Save 2FA Setting'; }
    });

    // -- Save Security Settings (Session Timeout + Max Failed Logins) --------
    document.getElementById('saveSecurityBtn')?.addEventListener('click', async () => {
        var timeout  = parseInt(document.getElementById('sessionTimeoutInput')?.value || '30', 10);
        var maxFails = parseInt(document.getElementById('maxFailedLoginsInput')?.value || '5',  10);
        var errEl    = document.getElementById('securityErrMsg');
        var errBox   = document.getElementById('securitySaveErr');
        if (isNaN(timeout)  || timeout  < 1  || timeout  > 480) {
            if (errEl) errEl.textContent = 'Timeout must be 1-480 minutes';
            if (errBox) errBox.classList.add('visible');
            setTimeout(() => errBox && errBox.classList.remove('visible'), 3000);
            return;
        }
        if (isNaN(maxFails) || maxFails < 1  || maxFails > 20) {
            if (errEl) errEl.textContent = 'Max logins must be 1-20';
            if (errBox) errBox.classList.add('visible');
            setTimeout(() => errBox && errBox.classList.remove('visible'), 3000);
            return;
        }
        var btn = document.getElementById('saveSecurityBtn');
        btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin me-1"></i>Saving...';
        try {
            var res = await fetchWithAuth('/api/settings', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    session_timeout_minutes: String(timeout),
                    max_failed_logins:       String(maxFails)
                })
            });
            if (res && res.ok) {
                var data = await res.json();
                currentSettings = data.settings;
                renderSettingsTable(currentSettings);
                showSaved('securitySaveOk');
                showToast('Security settings saved. Restart server to apply session timeout.', 'success');
            } else {
                var err = await res.json();
                showToast(err.error || 'Failed to save security settings', 'danger');
            }
        } catch(e) { showToast('Network error: ' + e.message, 'danger'); }
        finally { btn.disabled = false; btn.innerHTML = '<i class="fas fa-save me-1"></i>Save Security Settings'; }
    });

    // â”€â”€ Email: Provider quick-fill â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    document.getElementById('providerBtns')?.addEventListener('click', (e) => {
        const btn = e.target.closest('.provider-btn');
        if (!btn) return;
        document.getElementById('smtpHost').value = btn.dataset.host;
        document.getElementById('smtpPort').value = btn.dataset.port;
        const guide = document.getElementById('gmailGuide');
        if (guide) {
            if (btn.dataset.host.includes('gmail')) guide.classList.remove('d-none');
            else guide.classList.add('d-none');
        }
        document.querySelectorAll('.provider-btn').forEach(b => b.classList.remove('btn-primary','text-white'));
        btn.classList.add('btn-primary','text-white');
    });

    // â”€â”€ Email: Show/hide password â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    document.getElementById('togglePassBtn')?.addEventListener('click', () => {
        const input = document.getElementById('smtpPass');
        const icon  = document.querySelector('#togglePassBtn i');
        if (input.type === 'password') { input.type = 'text';     if (icon) icon.className = 'fas fa-eye-slash'; }
        else                           { input.type = 'password'; if (icon) icon.className = 'fas fa-eye'; }
    });

    // â”€â”€ Email: Save SMTP settings â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    document.getElementById('saveSmtpBtn')?.addEventListener('click', async () => {
        const btn = document.getElementById('saveSmtpBtn');
        btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin me-1"></i>Saving...';
        try {
            const payload = {
                smtp_host:      document.getElementById('smtpHost').value.trim(),
                smtp_port:      document.getElementById('smtpPort').value.trim(),
                smtp_user:      document.getElementById('smtpUser').value.trim(),
                smtp_from_name: document.getElementById('smtpFromName').value.trim()
            };
            const pass = document.getElementById('smtpPass').value;
            if (pass) payload.smtp_pass = pass;

            const res = await fetchWithAuth('/api/settings', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            if (res && res.ok) {
                showSaved('smtpSaveOk');
                showToast('Email settings saved!', 'success');
                document.getElementById('smtpPass').value = '';
                const hint = document.getElementById('smtpPassHint');
                if (pass && hint) { hint.textContent = '(password saved)'; hint.style.color = '#22c55e'; }
                const badge = document.getElementById('emailStatusBadge');
                if (badge && payload.smtp_user) {
                    badge.className = 'badge bg-success';
                    badge.innerHTML = '<i class="fas fa-check me-1"></i>Configured';
                }
                _emailLoaded = false;
            } else {
                const err = await res.json();
                showToast(err.error || 'Failed to save settings', 'danger');
            }
        } catch(e) { showToast('Network error: ' + e.message, 'danger'); }
        finally { btn.disabled = false; btn.innerHTML = '<i class="fas fa-save me-1"></i>Save Settings'; }
    });

    // â”€â”€ Email: Test SMTP connection â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    document.getElementById('testSmtpSettingsBtn')?.addEventListener('click', async () => {
        const btn   = document.getElementById('testSmtpSettingsBtn');
        const alert = document.getElementById('smtpTestInlineResult');
        btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin me-1"></i>Testing...';
        if (alert) alert.className = 'alert d-none mt-3 mb-0';
        try {
            const res  = await fetchWithAuth('/api/email-report/test', { method: 'POST' });
            const data = await res.json();
            if (res.ok && data.ok) {
                if (alert) {
                    alert.className = 'alert alert-success mt-3 mb-0';
                    alert.innerHTML = '<i class="fas fa-check-circle me-2"></i><strong>Connection successful!</strong> SMTP is working with <strong>' + (data.user || 'your account') + '</strong>.';
                }
            } else { throw new Error(data.error || 'Unknown error'); }
        } catch(e) {
            if (alert) {
                alert.className = 'alert alert-danger mt-3 mb-0';
                alert.innerHTML = '<i class="fas fa-times-circle me-2"></i><strong>Connection failed:</strong> ' + e.message + '<br><small class="text-muted mt-1 d-block">Check your email, password, and port. For Gmail use an App Password.</small>';
            }
        } finally {
            btn.disabled = false;
            btn.innerHTML = '<i class="fas fa-plug me-1"></i>Test Connection';
            if (alert) alert.classList.remove('d-none');
        }
    });

    // â”€â”€ Email: Send test email â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    document.getElementById('sendTestEmailBtn')?.addEventListener('click', async () => {
        const to   = document.getElementById('testEmailTo').value.trim();
        if (!to) { document.getElementById('testEmailTo')?.focus(); return; }
        const btn   = document.getElementById('sendTestEmailBtn');
        const alert = document.getElementById('testEmailResult');
        btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin me-1"></i>Sending...';
        if (alert) alert.className = 'alert d-none mt-2 mb-0 py-2 small';
        try {
            const res  = await fetchWithAuth('/api/email-report', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ to, reportType:'summary', subject:'Home Accounting â€” Test Email' })
            });
            const data = await res.json();
            if (res.ok && data.ok) {
                if (alert) {
                    alert.className = 'alert alert-success mt-2 mb-0 py-2 small';
                    alert.innerHTML = '<i class="fas fa-check me-1"></i>Test email sent to <strong>' + to + '</strong>! Check your inbox.';
                }
            } else { throw new Error(data.error || 'Unknown error'); }
        } catch(e) {
            if (alert) {
                alert.className = 'alert alert-danger mt-2 mb-0 py-2 small';
                alert.innerHTML = '<i class="fas fa-times me-1"></i>' + e.message;
            }
        } finally {
            btn.disabled = false;
            btn.innerHTML = '<i class="fas fa-paper-plane me-1"></i>Send Test';
            if (alert) alert.classList.remove('d-none');
        }
    });
});

