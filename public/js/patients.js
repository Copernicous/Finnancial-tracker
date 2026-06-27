var allPatients = [];
    var serviceDateOverrideEnabled = false;
    var filteredPatients = [];
    var currentPage = 1;
    var pageSize = 20;
    var editingPatientId = null;
    var deletingPatientId = null;
    var patientModalOriginalServiceDate = '';
    var patientModalCanUseAddRxShortcut = false;
    var pSortCol = 'id';
    var pSortDir = 'desc';

    function normalizeName(value) {
        return String(value || '').trim().toUpperCase();
    }

    function patientEscapeHtml(value) {
        if (typeof escHtml === 'function') return escHtml(value);
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#x27;');
    }

    function serviceDateHistoryActor(row) {
        var user = row && row.ChangedBy ? row.ChangedBy : null;
        if (!user) return 'System';
        return (user.firstName || user.lastName)
            ? ((user.firstName || '') + ' ' + (user.lastName || '')).trim()
            : (user.username || 'User');
    }

    function serviceDateHistoryTimestamp(row) {
        if (!row || !row.createdAt) return '';
        try {
            return new Date(row.createdAt).toLocaleString('en-US', {
                month: 'short',
                day: 'numeric',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
            });
        } catch(e) {
            return String(row.createdAt || '');
        }
    }

    function serviceDateHistoryChangeLabel(row) {
        var from = window.fmtDate(row.previousServiceDate) || 'None';
        var to = window.fmtDate(row.newServiceDate) || 'None';
        if (!row.previousServiceDate && row.newServiceDate) {
            return 'Initial service date: ' + to;
        }
        if (row.previousServiceDate && !row.newServiceDate) {
            return 'Removed service date: ' + from;
        }
        return from + ' -> ' + to;
    }

    function serviceDateHistoryRxBadge(rx) {
        var label = 'RX #' + patientEscapeHtml(rx.id);
        var detail = [];
        if (rx.serviceDate) detail.push('Svc ' + (window.fmtDate(rx.serviceDate) || rx.serviceDate));
        if (rx.pharmacyName) detail.push(rx.pharmacyName);
        if (rx.workflowStepCount) detail.push(rx.workflowStepCount + ' step' + (rx.workflowStepCount === 1 ? '' : 's'));
        return '<span class="badge bg-light text-dark border me-1 mb-1" title="' + patientEscapeHtml(detail.join(' | ')) + '">' + label + '</span>';
    }

    function serviceDateHistoryRxGroup(label, records, count) {
        records = Array.isArray(records) ? records : [];
        count = Number(count || records.length || 0);
        if (!count) return '';
        var shown = records.slice(0, 6).map(serviceDateHistoryRxBadge).join('');
        if (count > records.length || count > 6) {
            shown += '<span class="badge bg-light text-muted border me-1 mb-1">+' + patientEscapeHtml(count - Math.min(records.length, 6)) + ' more</span>';
        }
        return '<div class="mt-1"><span class="text-muted me-1">' + patientEscapeHtml(label) + ':</span> ' + shown + '</div>';
    }

    function renderServiceDateRelatedRx(row) {
        var related = row && row.relatedRxRecords ? row.relatedRxRecords : null;
        if (!related || !related.totalRxCount) return '';
        var html = '';
        html += serviceDateHistoryRxGroup('Previous service RX', related.previousRxRecords, related.previousRxCount);
        html += serviceDateHistoryRxGroup('New service RX', related.newRxRecords, related.newRxCount);
        if (!html) return '';
        return '<div class="small mt-2" style="color:var(--text-muted,#6c757d)">' +
            '<i class="fas fa-prescription-bottle-alt me-1"></i>Related RX service records' +
            html +
        '</div>';
    }

    function renderPatientServiceDateHistory(rows) {
        var section = document.getElementById('patientServiceDateHistorySection');
        var list = document.getElementById('patientServiceDateHistoryList');
        var count = document.getElementById('patientServiceDateHistoryCount');
        if (!section || !list) return;

        rows = Array.isArray(rows) ? rows : [];
        section.style.display = '';
        if (count) count.textContent = rows.length + ' entr' + (rows.length === 1 ? 'y' : 'ies');

        if (!rows.length) {
            list.innerHTML =
                '<div class="text-muted small py-2">' +
                    '<i class="fas fa-info-circle me-1"></i>No patient service date history recorded yet.' +
                '</div>';
            return;
        }

        var html = '';
        rows.forEach(function(row) {
            var source = patientEscapeHtml(row.changeSource || 'Patient Update');
            var reason = patientEscapeHtml(row.reason || '');
            var actor = patientEscapeHtml(serviceDateHistoryActor(row));
            var when = patientEscapeHtml(serviceDateHistoryTimestamp(row));
            var change = patientEscapeHtml(serviceDateHistoryChangeLabel(row));
            var relatedRx = renderServiceDateRelatedRx(row);

            html +=
                '<div style="border:1px solid var(--border-color,#dee2e6);border-radius:8px;padding:.6rem .75rem;margin-bottom:.55rem;background:rgba(74,144,226,.035)">' +
                    '<div class="d-flex justify-content-between align-items-start gap-2 flex-wrap">' +
                        '<div style="min-width:0">' +
                            '<div class="fw-semibold small"><i class="fas fa-calendar-check me-1 text-primary"></i>' + change + '</div>' +
                            '<div class="text-muted" style="font-size:.75rem"><i class="fas fa-user me-1"></i>' + actor + (when ? ' - ' + when : '') + '</div>' +
                        '</div>' +
                        '<span class="badge bg-secondary" style="font-size:.68rem">' + source + '</span>' +
                    '</div>' +
                    (reason ? '<div class="small mt-2" style="color:var(--text-muted,#6c757d)"><i class="fas fa-comment-alt me-1"></i>' + reason + '</div>' : '') +
                    relatedRx +
                '</div>';
        });

        list.innerHTML = html;
    }

    async function loadPatientServiceDateHistory(patientId) {
        var section = document.getElementById('patientServiceDateHistorySection');
        var list = document.getElementById('patientServiceDateHistoryList');
        var count = document.getElementById('patientServiceDateHistoryCount');
        if (!section || !list) return;

        if (!patientId) {
            section.style.display = 'none';
            list.innerHTML = '';
            if (count) count.textContent = '';
            return;
        }

        section.style.display = '';
        list.innerHTML = '<div class="text-muted small py-2"><i class="fas fa-spinner fa-spin me-1"></i>Loading service date history...</div>';
        if (count) count.textContent = '';

        try {
            var url = typeof window.rxUrl === 'function'
                ? window.rxUrl('/api/patients/' + patientId + '/service-date-history')
                : '/api/patients/' + patientId + '/service-date-history';
            var res = await fetchWithAuth(url, { silent: true });
            if (!res || !res.ok) throw new Error('Failed to load history');
            var rows = await res.json();
            renderPatientServiceDateHistory(rows);
        } catch(e) {
            list.innerHTML = '<div class="text-danger small py-2"><i class="fas fa-exclamation-triangle me-1"></i>Could not load service date history.</div>';
        }
    }

    function patientDecodeJwtPayload(token) {
        try {
            if (!token || token.split('.').length < 2) return null;
            var payload = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
            while (payload.length % 4) payload += '=';
            return JSON.parse(atob(payload));
        } catch (e) {
            return null;
        }
    }

    function patientCurrentUserIsAdmin() {
        var serverUser = null;
        try { serverUser = window.__RX_AUTH_USER || null; } catch (e) { serverUser = null; }
        if (serverUser) {
            var serverRole = String(
                serverUser.role || serverUser.roleName || (serverUser.Role && serverUser.Role.name) || ''
            ).trim().toLowerCase();
            var serverRoleId = Number(
                serverUser.roleId !== undefined ? serverUser.roleId :
                (serverUser.Role && serverUser.Role.id !== undefined ? serverUser.Role.id : NaN)
            );
            return serverRole === 'administrator' || serverRoleId === 1;
        }

        var user = null;
        try { user = JSON.parse(localStorage.getItem('user') || 'null'); } catch (e) { user = null; }
        var tokenUser = patientDecodeJwtPayload(localStorage.getItem('token'));
        var userRole = String(
            (user && (user.role || user.roleName || (user.Role && user.Role.name))) || ''
        ).trim().toLowerCase();
        var tokenRole = String((tokenUser && tokenUser.role) || '').trim().toLowerCase();
        var userRoleId = Number(
            user && user.roleId !== undefined ? user.roleId :
            (user && user.Role && user.Role.id !== undefined ? user.Role.id : NaN)
        );
        var tokenRoleId = Number(tokenUser && tokenUser.roleId !== undefined ? tokenUser.roleId : NaN);
        if (tokenUser && (tokenRole || !isNaN(tokenRoleId))) {
            return tokenRole === 'administrator' || tokenRoleId === 1;
        }
        return userRole === 'administrator' || tokenRole === 'administrator' || userRoleId === 1 || tokenRoleId === 1;
    }

    function patientFullPageAccess() {
        return { visible: true, canAdd: true, canEdit: true, canDelete: true, canExport: true, canUndo: true, canWarehouse: true, canOverrideExpired: true };
    }

    function getPatientModalPerms() {
        return patientCurrentUserIsAdmin() ? patientFullPageAccess() : getPagePerms();
    }

    function canAddRxAfterPatientCreate() {
        if (patientCurrentUserIsAdmin()) return true;
        var user = null;
        try {
            user = typeof getCurrentAuthUser === 'function'
                ? getCurrentAuthUser()
                : JSON.parse(localStorage.getItem('user') || '{}');
        } catch(e) {
            user = null;
        }
        var perms = (user && user.permissions) ? user.permissions : {};
        var rxPerms = perms.rx_records;
        if (!rxPerms) return true;
        if (rxPerms.visible === false) return false;
        return rxPerms.canAdd !== undefined ? !!rxPerms.canAdd : !!rxPerms.canEdit;
    }

    function patientServiceDateChangedForAddRx() {
        if (!editingPatientId) return true;
        var svcInput = document.getElementById('pServiceDate');
        var nextServiceDate = svcInput ? (svcInput.value || '') : '';
        return !!nextServiceDate && nextServiceDate !== patientModalOriginalServiceDate;
    }

    function updateSaveAddRxButtonState() {
        var btn = document.getElementById('savePatientAddRxBtn');
        if (!btn) return;

        var svcInput = document.getElementById('pServiceDate');
        var canUse = patientModalCanUseAddRxShortcut && canAddRxAfterPatientCreate();
        if (editingPatientId) {
            canUse = canUse &&
                patientServiceDateChangedForAddRx() &&
                svcInput &&
                !svcInput.disabled &&
                !svcInput.readOnly;
            btn.title = canUse
                ? 'Save this service date and continue to a new RX record.'
                : 'Change the service date to continue directly to a new RX record.';
        } else {
            btn.title = 'Create this patient and continue to a new RX record.';
        }

        btn.style.display = canUse ? '' : 'none';
    }

    async function refreshPatientAuthProfile() {
        try {
            var profileUrl = typeof window.rxUrl === 'function' ? window.rxUrl('/api/auth/profile') : '/api/auth/profile';
            const profileHeaders = { 'Content-Type': 'application/json' };
            const res = await fetch(profileUrl, {
                method: 'GET',
                credentials: 'include',
                headers: profileHeaders
            });
            if (!res || !res.ok) return;

            const profile = await res.json();
            const role = profile.Role || {};
            const permissions = role.permissions || profile.permissions || {};
            const freshUser = {
                id: profile.id,
                username: profile.username,
                firstName: profile.firstName,
                lastName: profile.lastName,
                role: role.name || profile.role,
                roleId: profile.roleId || role.id,
                permissions: permissions,
                isMaster: profile.isMaster === true
            };

            window.__RX_AUTH_USER = freshUser;
            window.__RX_AUTH_PERMS = permissions;
            localStorage.setItem('user', JSON.stringify(freshUser));
        } catch (e) {
            // Keep existing auth state if the profile refresh fails.
        }
    }

    document.addEventListener('DOMContentLoaded', async () => {
        initApp();
        await refreshPatientAuthProfile();
        if (typeof checkAuth === 'function') checkAuth();
        await loadDropdowns();
        await loadServiceDateOverrideState();

        // Page-size selector
        var psSel = document.getElementById('patPageSizeSelect');
        if (psSel) {
            psSel.addEventListener('change', function() {
                pageSize = parseInt(this.value);
                currentPage = 1;
                renderPatients();
            });
        }

        // â”€â”€ Determine URL params BEFORE loading patients â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        // This lets us avoid loading ALL patients when we only need a subset.
        const urlParams      = new URLSearchParams(window.location.search);
        const statusParam    = urlParams.get('status');
        const highlightId    = urlParams.get('highlight');   // from global search
        const preFilterName  = urlParams.get('name');         // from global search by name

        if (statusParam === 'norx') {
            // â”€â”€ Special case: active patients with NO RX records â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
            // Call the dedicated endpoint instead of loading all patients first.
            try {
                document.getElementById('patientsBody').innerHTML =
                    '<tr><td colspan="9" class="text-center text-muted py-4"><i class="fas fa-spinner fa-spin me-2"></i>Loading No-RX patients...</td></tr>';
                const norxRes = await fetchWithAuth('/api/dashboard/patients-no-rx');
                if (norxRes && norxRes.ok) {
                    const norxData = await norxRes.json();
                    allPatients      = Array.isArray(norxData) ? norxData : [];
                    filteredPatients = [...allPatients];
                    currentPage      = 1;
                    renderPatients();
                    const needsActionBanner = document.getElementById('patientsNeedsActionBanner');
                    if (needsActionBanner) needsActionBanner.textContent = '';
                    // Show a dismissable filter banner above the table
                    const tableCard = document.querySelector('.glass-card.p-4');
                    if (tableCard && !document.getElementById('norxBanner')) {
                        const banner = document.createElement('div');
                        banner.id = 'norxBanner';
                        banner.style.cssText = 'background:rgba(155,89,182,.09);border:1px solid rgba(155,89,182,.3);border-radius:10px;padding:.6rem 1rem;display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;font-size:.85rem';
                        const message = document.createElement('span');
                        const icon = document.createElement('i');
                        icon.className = 'fas fa-user-slash me-2';
                        icon.style.color = '#9b59b6';
                        message.appendChild(icon);
                        const label = document.createElement('strong');
                        label.textContent = 'Filtered:';
                        message.appendChild(label);
                        message.appendChild(document.createTextNode(' Showing only active patients with no RX records (' + allPatients.length + ' record' + (allPatients.length !== 1 ? 's' : '') + ')'));
                        const clearLink = document.createElement('a');
                        clearLink.href = '/patients';
                        clearLink.className = 'btn btn-sm btn-outline-secondary';
                        clearLink.style.fontSize = '.75rem';
                        const clearIcon = document.createElement('i');
                        clearIcon.className = 'fas fa-times me-1';
                        clearLink.appendChild(clearIcon);
                        clearLink.appendChild(document.createTextNode('Clear Filter'));
                        banner.appendChild(message);
                        banner.appendChild(clearLink);
                        tableCard.insertBefore(banner, tableCard.firstChild);
                    }
                    showToast('Showing Active Patients with No RX Records (' + allPatients.length + ')', 'info');
                } else {
                    throw new Error('API error');
                }
            } catch(e) {
                showToast('Could not load No-RX filter â€” showing all patients', 'warning');
                await loadPatients();
            }
        } else {
            // â”€â”€ Normal case: load all patients then apply any URL filter â”€â”€â”€â”€
            await loadPatients();

            if (highlightId) {
                const targetId = parseInt(highlightId);
                filteredPatients = allPatients.filter(p => p.id === targetId);
                renderPatients();
                setTimeout(() => {
                    const row = document.querySelector('tr[data-patient-id="' + targetId + '"]');
                    if (row) {
                        row.scrollIntoView({ behavior: 'smooth', block: 'center' });
                        row.style.transition = 'background 0.3s';
                        row.style.background = 'rgba(74,144,226,0.25)';
                        setTimeout(() => { row.style.background = ''; }, 2000);
                    }
                }, 300);
                showToast('Showing search result', 'info');
            } else if (preFilterName) {
                const nameParts = decodeURIComponent(preFilterName).trim().split(' ');
                if (nameParts[0]) document.getElementById('srchFirstName').value = nameParts[0];
                if (nameParts[1]) document.getElementById('srchLastName').value  = nameParts.slice(1).join(' ');
                applyPatientSearch();
            } else if (statusParam === 'active') {
                document.getElementById('srchStatus').value = 'true';
                applyPatientSearch();
                showToast('Showing Active Patients only', 'info');
            } else if (statusParam === 'inactive') {
                document.getElementById('srchStatus').value = 'false';
                applyPatientSearch();
                showToast('Showing Inactive Patients only', 'info');
            }

            // â”€â”€ ELIGIBILITY FILTER from dashboard card click â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
            // When user clicks an eligibility card on the dashboard, they arrive here
            // with ?eligFilter=eligible|expiring|window|none. Apply it automatically.
            var eligParam = urlParams.get('eligFilter');
            if (eligParam) {
                var eligEl = document.getElementById('srchEligibility');
                if (eligEl) {
                    eligEl.value = eligParam;
                    // Expand the advanced filter panel so users can see the active filter
                    var advRow = document.getElementById('advancedFilterRow');
                    if (advRow) advRow.style.display = '';
                    liveFilter();
                    var labelMap = {
                        'eligible':  'Eligible Now (window expired)',
                        'expiring':  'Window expiring within 7 days',
                        'window':    'In active 90-day window',
                        'none':      'No service date set',
                        'needsAction': 'Needs Action (expired window + open workflow)'
                    };
                    showToast('Filter: ' + (labelMap[eligParam] || eligParam), 'info');
                }
            }
            // â”€â”€ END ELIGIBILITY FILTER â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        }


        document.getElementById('addPatientBtn').addEventListener('click', () => openPatientModal(null));
        var addPatientRxBtn = document.getElementById('addPatientRxBtn');
        if (addPatientRxBtn) {
            addPatientRxBtn.addEventListener('click', function() {
                openPatientModal(null, { focusAddRx: true });
            });
        }

    // â”€â”€ Patient modal soft-lock â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    let _modalLockPatientId = null;
    let _modalHeartbeatTimer = null;

    async function acquireModalLock(patientId) {
        _modalLockPatientId = patientId;
        try {
            var _uAcquire = '/api/patient-locks/' + patientId + '/acquire';
        const res = await fetchWithAuth(_uAcquire, { method: 'POST' });
            if (res && res.ok) {
                const { others } = await res.json();
                updateModalViewerBanner(others);
            }
        } catch(e) { /* silent */ }
        // Start heartbeat
        if (_modalHeartbeatTimer) clearInterval(_modalHeartbeatTimer);
        _modalHeartbeatTimer = setInterval(async () => {
            try {
                var _uHb = '/api/patient-locks/' + patientId + '/heartbeat';
            const r = await fetchWithAuth(_uHb, { method: 'POST' });
                if (r && r.ok) { const d = await r.json(); updateModalViewerBanner(d.others); }
            } catch(e) {}
        }, 60000);
    }

    async function releaseModalLock() {
        if (!_modalLockPatientId) return;
        if (_modalHeartbeatTimer) { clearInterval(_modalHeartbeatTimer); _modalHeartbeatTimer = null; }
        try {
            var _uRel = '/api/patient-locks/' + _modalLockPatientId + '/release';
            await fetchWithAuth(_uRel, { method: 'DELETE' });
        } catch(e) {}
        _modalLockPatientId = null;
        updateModalViewerBanner([]);
    }

    function updateModalViewerBanner(others) {
        const banner = document.getElementById('modalViewerBanner');
        const names  = document.getElementById('modalViewerNames');
        if (!banner || !others) return;
        if (!others.length) { banner.classList.add('d-none'); return; }
        banner.classList.remove('d-none');
        names.textContent = others.map(v => v.name).join(', ');
    }

    window.acquireModalLock = acquireModalLock;
    window.releaseModalLock = releaseModalLock;

    // Hook into modal lifecycle
    const patientModal = document.getElementById('patientModal');
    if (patientModal) {
        patientModal.addEventListener('hidden.bs.modal', () => {
            releaseModalLock();
        });
    }

        document.getElementById('searchBtn').addEventListener('click', loadPatients);
        document.getElementById('clearBtn').addEventListener('click', () => {
            ['srchFirstName','srchLastName','srchDob','srchPhone','srchStatus','srchClinic',
             'srchPatientCode','srchPatientTransport','srchPharmacyTransport','srchServiceFrom','srchServiceTo','srchEligibility'
            ].forEach(id => { const el = document.getElementById(id); if(el) el.value = ''; });
            document.getElementById('srchShowDeleted').checked = false;
            updateFilterBadge();
            loadPatients();
        });
        document.getElementById('srchShowDeleted').addEventListener('change', loadPatients);
        document.getElementById('srchClinic').addEventListener('change', applyPatientSearch);

        document.getElementById('savePatientBtn').addEventListener('click', savePatient);
        var savePatientAddRxBtn = document.getElementById('savePatientAddRxBtn');
        if (savePatientAddRxBtn) {
            savePatientAddRxBtn.addEventListener('click', function() {
                savePatient({ addRxAfterSave: true });
            });
        }
        var serviceDateInput = document.getElementById('pServiceDate');
        if (serviceDateInput) {
            serviceDateInput.addEventListener('input', updateSaveAddRxButtonState);
            serviceDateInput.addEventListener('change', updateSaveAddRxButtonState);
        }
        document.getElementById('confirmDeleteBtn').addEventListener('click', deletePatient);
        document.getElementById('deleteConfirmInput').addEventListener('input', checkDeleteConfirmation);

        var rxHistPrintAllBtn = document.getElementById('rxHistoryPrintAllBtn');
        var rxHistExportAllBtn = document.getElementById('rxHistoryExportAllBtn');
        if (rxHistPrintAllBtn) rxHistPrintAllBtn.addEventListener('click', printRxHistoryAll);
        if (rxHistExportAllBtn) rxHistExportAllBtn.addEventListener('click', exportRxHistoryAll);

        document.addEventListener('click', function(e) {
            var printBtn = e.target.closest('[data-rxhist-print]');
            if (printBtn) {
                e.preventDefault();
                printRxHistoryCycle(parseInt(printBtn.dataset.rxhistPrint, 10));
                return;
            }

            var exportBtn = e.target.closest('[data-rxhist-export]');
            if (exportBtn) {
                e.preventDefault();
                exportRxHistoryCycle(parseInt(exportBtn.dataset.rxhistExport, 10));
            }
        });

        // â”€â”€ Export with Column Selector â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        const EXPORT_COLS = [
            { key: 'patientCode',  label: 'Patient ID',        fn: p => p.patientCode || p.id },
            { key: 'firstName',   label: 'First Name',         fn: p => p.firstName || '' },
            { key: 'lastName',    label: 'Last Name',          fn: p => p.lastName  || '' },
            { key: 'dob',         label: 'Date of Birth',      fn: p => p.dob       || '' },
            { key: 'phone',       label: 'Phone',              fn: p => p.phone     || '' },
            { key: 'address',     label: 'Address',            fn: p => p.address   || '' },
            { key: 'serviceDate', label: 'Service Date',       fn: p => p.serviceDate || '' },
            { key: 'status',      label: 'Status',             fn: p => p.isDeleted ? 'Deleted' : (p.isActive ? 'Active' : 'Inactive') },
            { key: 'clinic',      label: 'Clinic',             fn: p => p.Clinic ? p.Clinic.name : '' },
            { key: 'patTrans',    label: 'Patient Transport',  fn: p => p.PatientTransportCompany ? (p.PatientTransportCompany.contactPerson || p.PatientTransportCompany.companyName || '') : '' },
            { key: 'rxTrans',     label: 'Pharmacy Transport', fn: p => p.PharmacyTransportCompany ? (p.PharmacyTransportCompany.companyName || p.PharmacyTransportCompany.contactPerson || '') : '' },
        ];
        let _exportColState = {};
        EXPORT_COLS.forEach(c => { _exportColState[c.key] = true; });

        function openExportModal() {
            if (!filteredPatients.length) { showToast('No records to export. Adjust filters first.', 'warning'); return; }
            document.getElementById('exportModalCount').textContent =
                'Exporting ' + filteredPatients.length + ' record' + (filteredPatients.length !== 1 ? 's' : '') + ' matching current filters';
            const list = document.getElementById('exportColList');
            // Build checkbox HTML WITHOUT inline onchange (inline handlers run in global scope
            // and cannot access the _exportColState closure variable â€” that's the bug this fixes)
            var _ecHtml = '';
            for (var _eci = 0; _eci < EXPORT_COLS.length; _eci++) {
                var c = EXPORT_COLS[_eci];
                _ecHtml +=
                    '<div class="col-6">' +
                    '<label class="d-flex align-items-center gap-2 p-2 rounded" style="border:1px solid var(--border-color,#dee2e6);cursor:pointer" id="ecWrap_' + c.key + '">' +
                        '<input type="checkbox" class="form-check-input mt-0 ec-col-checkbox" id="ec_' + c.key + '" data-col-key="' + c.key + '" ' + (_exportColState[c.key] ? 'checked' : '') + '> ' +
                        '<span class="small">' + c.label + '</span>' +
                    '</label>' +
                    '</div>';
            }
            list.innerHTML = _ecHtml;
            // Attach change listeners programmatically so they can access the closure
            var checkboxes = list.querySelectorAll('.ec-col-checkbox');
            for (var ci = 0; ci < checkboxes.length; ci++) {
                checkboxes[ci].addEventListener('change', (function(colKey) {
                    return function() {
                        _exportColState[colKey] = this.checked;
                        updateEcStyle(colKey);
                    };
                })(checkboxes[ci].getAttribute('data-col-key')));
            }
            EXPORT_COLS.forEach(c => updateEcStyle(c.key));
            new bootstrap.Modal(document.getElementById('exportColumnsModal')).show();
        }
        function updateEcStyle(key) {
            const wrap = document.getElementById('ecWrap_' + key);
            if (!wrap) return;
            wrap.style.background  = _exportColState[key] ? 'rgba(40,167,69,.08)' : '';
            wrap.style.borderColor = _exportColState[key] ? 'rgba(40,167,69,.35)' : '';
        }
        function setAllExportCols(val) {
            EXPORT_COLS.forEach(c => {
                _exportColState[c.key] = val;
                const el = document.getElementById('ec_' + c.key); if (el) el.checked = val;
                updateEcStyle(c.key);
            });
        }
        // Expose to window so the HTML button onclick="setAllExportCols(...)" can reach it
        window.setAllExportCols = setAllExportCols;
        document.getElementById('exportPatientsCsvBtn').addEventListener('click', openExportModal);
        document.getElementById('doExportBtn').addEventListener('click', () => {
            const selected = EXPORT_COLS.filter(c => _exportColState[c.key]);
            if (!selected.length) { showToast('Select at least one column.', 'warning'); return; }
            const headers = selected.map(c => c.label);
            const rows    = filteredPatients.map(p => selected.map(c => c.fn(p)));
            // IMPROVE-05: include active date range filters in filename
            const today  = new Date().toISOString().slice(0,10);
            const svcFrom = (document.getElementById('srchServiceFrom') || {}).value || '';
            const svcTo   = (document.getElementById('srchServiceTo')   || {}).value || '';
            const dob     = (document.getElementById('srchDob')         || {}).value || '';
            let filenamePart = 'patients_';
            if (svcFrom && svcTo)   { filenamePart += svcFrom + '_to_' + svcTo + '_exported-' + today; }
            else if (svcFrom)       { filenamePart += 'from-' + svcFrom + '_exported-' + today; }
            else if (svcTo)         { filenamePart += 'through-' + svcTo + '_exported-' + today; }
            else if (dob)           { filenamePart += 'dob-' + dob + '_exported-' + today; }
            else                    { filenamePart += today; }
            exportToCsv(filenamePart + '.csv', headers, rows);
            bootstrap.Modal.getInstance(document.getElementById('exportColumnsModal')).hide();
            showToast('Exported ' + filteredPatients.length + ' records (' + selected.length + ' columns).', 'success');
        });

        // Apply permissions to top-level buttons
        const patPerms = getPatientModalPerms();
        if (!patPerms.canExport) { const b = document.getElementById('exportPatientsCsvBtn'); if(b) b.classList.add('d-none'); }
        if (!patPerms.canAdd)   { const b = document.getElementById('addPatientBtn');       if(b) b.classList.add('d-none'); }
        if (!patPerms.canAdd || !canAddRxAfterPatientCreate()) {
            const b = document.getElementById('addPatientRxBtn');
            if (b) b.classList.add('d-none');
        }
    });


    async function loadServiceDateOverrideState() {
        try {
            const res = await fetchWithAuth('/api/service-date-override/status', { silent: true });
            if (res && res.ok) {
                const data = await res.json();
                serviceDateOverrideEnabled = !!data.enabled;
            }
        } catch(e) {
            serviceDateOverrideEnabled = false;
        }
    }


    async function loadDropdowns() {
        try {
        var _uPt = '/api/lookup/patient-transport';
        var _uRx = '/api/lookup/pharmacy-transport';
        var _uCl = '/api/lookup/clinics';
        var _uPh = '/api/lookup/pharmacies';
            const [ptRes, rxRes, clRes, phRes] = await Promise.all([
                fetchWithAuth(_uPt, { silent: true }),
                fetchWithAuth(_uRx, { silent: true }),
                fetchWithAuth(_uCl, { silent: true }),
                fetchWithAuth(_uPh, { silent: true })
            ]);
            if (ptRes && ptRes.ok) {
                const pt = await ptRes.json();
                const ptSel = document.getElementById('pPatientTransport');
                const srchPtSel = document.getElementById('srchPatientTransport');
                pt.forEach(c => {
                    const label = c.contactPerson || c.companyName;
                    ptSel.innerHTML += '<option value="' + c.id + '">' + label + '</option>';
                    if (srchPtSel) srchPtSel.innerHTML += '<option value="' + c.id + '">' + label + '</option>';
                });
            }
            if (rxRes && rxRes.ok) {
                const rx = await rxRes.json();
                const rxSel = document.getElementById('pPharmacyTransport');
                const srchRxSel = document.getElementById('srchPharmacyTransport');
                rx.forEach(c => {
                    const label = c.companyName || c.contactPerson;
                    rxSel.innerHTML += '<option value="' + c.id + '">' + label + '</option>';
                    if (srchRxSel) srchRxSel.innerHTML += '<option value="' + c.id + '">' + label + '</option>';
                });
            }
            if (clRes && clRes.ok) {
                const cl = await clRes.json();
                const clSel = document.getElementById('pClinicId');
                const srchSel = document.getElementById('srchClinic');
                cl.forEach(c => {
                    const label = c.name + (c.address ? ' â€“ ' + c.address : '');
                    clSel.innerHTML   += '<option value="' + c.id + '">' + label + '</option>';
                    srchSel.innerHTML += '<option value="' + c.id + '">' + c.name + '</option>';
                });
            }
            if (phRes && phRes.ok) {
                const ph = await phRes.json();
                const phSel = document.getElementById('pPharmacyId');
                ph.forEach(p => {
                    phSel.innerHTML += '<option value="' + p.id + '">' + p.name + (p.address ? ' â€“ ' + p.address : '') + '</option>';
                });
            }
        } catch(e) {}
    }

    async function loadPatients() {
        const showDeleted = document.getElementById('srchShowDeleted').checked;
        const apiUrl = '/api/patients' + (showDeleted ? '?includeDeleted=true' : '');
        try {
            const res = await fetchWithAuth(apiUrl);
            if (!res) {
                // fetchWithAuth returned null = 401 â†’ already redirecting to login
                document.getElementById('patientsBody').innerHTML =
                    '<tr><td colspan="9" class="text-center text-warning py-4"><i class="fas fa-exclamation-triangle me-2"></i>Session expired â€” redirecting to loginâ€¦</td></tr>';
                return;
            }
            if (!res.ok) {
                const errText = await res.text().catch(() => 'no body');
                document.getElementById('patientsBody').innerHTML =
                    '<tr><td colspan="9" class="text-center py-4"><div class="alert alert-danger mb-0"><strong>API Error ' + res.status + '</strong><br><small>' + errText.substring(0, 200) + '</small><br><small class="text-muted">URL: ' + apiUrl + '</small></div></td></tr>';
                return;
            }
            let data;
            try {
                data = await res.json();
            } catch (jsonErr) {
                const raw = await res.clone().text().catch(() => 'unreadable');
                document.getElementById('patientsBody').innerHTML =
                    '<tr><td colspan="9" class="text-center py-4"><div class="alert alert-danger mb-0"><strong>JSON Parse Error</strong><br><small>' + jsonErr.message + '</small><br><small class="text-muted">Raw: ' + raw.substring(0, 200) + '</small></div></td></tr>';
                return;
            }
            allPatients = Array.isArray(data) ? data : [];
            applyPatientSearch();
        } catch (netErr) {
            document.getElementById('patientsBody').innerHTML =
                '<tr><td colspan="9" class="text-center py-4"><div class="alert alert-danger mb-0"><strong>Network Error</strong><br><small>' + netErr.message + '</small><br><small class="text-muted">URL attempted: ' + apiUrl + ' | Page origin: ' + window.location.origin + '</small></div></td></tr>';
        }
    }

    function applyPatientSearch() {
        const fn   = document.getElementById('srchFirstName').value.toLowerCase();
        const ln   = document.getElementById('srchLastName').value.toLowerCase();
        const dob  = document.getElementById('srchDob').value;
        const ph   = document.getElementById('srchPhone').value.toLowerCase();
        const st   = document.getElementById('srchStatus').value;
        const cl   = document.getElementById('srchClinic').value;
        // Advanced
        const pc   = (document.getElementById('srchPatientCode')?.value || '').toLowerCase();
        const pt   = document.getElementById('srchPatientTransport')?.value || '';
        const rx   = document.getElementById('srchPharmacyTransport')?.value || '';
        const sf   = document.getElementById('srchServiceFrom')?.value || '';
        const st2  = document.getElementById('srchServiceTo')?.value || '';
        const elig = (document.getElementById('srchEligibility')?.value || '');

        const _todayMs = new Date().setHours(0,0,0,0);

        filteredPatients = allPatients.filter(p => {
            if (fn && !(p.firstName||'').toLowerCase().includes(fn)) return false;
            if (ln && !(p.lastName||'').toLowerCase().includes(ln)) return false;
            if (dob && p.dob !== dob) return false;
            if (ph && !(p.phone||'').toLowerCase().includes(ph)) return false;
            if (st !== '' && String(p.isActive) !== st) return false;
            if (cl !== '') {
                const patClinic = p.clinicId !== null && p.clinicId !== undefined ? String(p.clinicId) : '';
                if (patClinic !== cl) return false;
            }
            // Advanced filters
            if (pc && !(p.patientCode||'').toLowerCase().includes(pc)) return false;
            if (pt !== '') {
                const patPt = p.patientTransportId !== null && p.patientTransportId !== undefined ? String(p.patientTransportId) : '';
                if (patPt !== pt) return false;
            }
            if (rx !== '') {
                const patRx = p.pharmacyTransportId !== null && p.pharmacyTransportId !== undefined ? String(p.pharmacyTransportId) : '';
                if (patRx !== rx) return false;
            }
            if (sf && p.serviceDate && p.serviceDate < sf) return false;
            if (st2 && p.serviceDate && p.serviceDate > st2) return false;
            // â”€â”€ 90-day eligibility filter â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
            // Logic MUST match dashboardController.js getEligibilityStats()
            // Source of truth: patient.serviceDate (not latest RX serviceDate)
            // daysLeft = days until expiry (negative = already past = eligible)
            if (elig) {
                if (!p.serviceDate) {
                    // 'none' = patient has no serviceDate
                    if (elig !== 'none') return false;
                } else if (elig === 'needsAction' && !p.needsAction) {
                    return false;
                } else {
                    var _svcMs  = new Date(p.serviceDate).setHours(0,0,0,0);
                    var _exp90  = _svcMs + 90 * 864e5;
                    var _dl90   = Math.ceil((_exp90 - _todayMs) / 864e5);
                    // eligible: window fully expired (daysLeft < 0)
                    if (elig === 'eligible' && _dl90 >= 0)          return false;
                    // expiring: 0-7 days remaining (matches backend <=7)
                    if (elig === 'expiring' && (_dl90 < 0 || _dl90 > 7)) return false;
                    // window: active window with > 7 days remaining
                    if (elig === 'window'   && (_dl90 < 0 || _dl90 <= 7)) return false;
                    // none: handled above - if patient has serviceDate, exclude
                    if (elig === 'none')                             return false;
                }
            }
            return true;
        });
        renderNeedsActionBanner();
        updateFilterBadge();

        filteredPatients.sort((a, b) => {
            let valA = a[pSortCol];
            let valB = b[pSortCol];
            if (pSortCol === 'Clinic.name') {
                valA = a.Clinic ? a.Clinic.name : '';
                valB = b.Clinic ? b.Clinic.name : '';
            } else if (pSortCol === 'nextSvcDate') {
                // Sort by days remaining until 90-day expiry (numeric)
                var _epA = a.serviceDate ? new Date(a.serviceDate).getTime() + 90*864e5 : null;
                var _epB = b.serviceDate ? new Date(b.serviceDate).getTime() + 90*864e5 : null;
                valA = _epA !== null ? Math.round((_epA - Date.now()) / 864e5) : -9999;
                valB = _epB !== null ? Math.round((_epB - Date.now()) / 864e5) : -9999;
            }
            if (typeof valA === 'string' && typeof valB === 'string') {
                return pSortDir === 'asc' ? valA.localeCompare(valB) : valB.localeCompare(valA);
            } else {
                if (valA < valB) return pSortDir === 'asc' ? -1 : 1;
                if (valA > valB) return pSortDir === 'asc' ? 1 : -1;
                return 0;
            }
        });
        
        updatePatientSortIcons();
        currentPage = 1;
        renderPatients();
    }

    function sortPatients(col) {
        if (pSortCol === col) {
            pSortDir = pSortDir === 'asc' ? 'desc' : 'asc';
        } else {
            pSortCol = col;
            pSortDir = 'asc';
        }
        applyPatientSearch();
    }

    function updatePatientSortIcons() {
        ['patientCode', 'firstName', 'Clinic.name', 'dob', 'phone', 'serviceDate', 'nextSvcDate', 'isActive'].forEach(c => {
            const icon = document.getElementById('spIcon_' + c);
            if (icon) {
                icon.className = c === pSortCol 
                    ? (pSortDir === 'asc' ? 'fas fa-sort-up ms-1' : 'fas fa-sort-down ms-1') 
                    : 'fas fa-sort text-muted ms-1';
                icon.style.opacity = c === pSortCol ? '1' : '0.3';
            }
        });
    }

    function renderPatients() {
        var start = (currentPage - 1) * pageSize;
        var page = filteredPatients.slice(start, start + pageSize);
        var tbody = document.getElementById('patientsBody');
        if (page.length === 0) {
            tbody.innerHTML = '<tr><td colspan="9" class="text-center text-muted py-4">No patients found.</td></tr>';
            var pi0 = document.getElementById('patientPageInfo');
            if (pi0) pi0.textContent = '';
            document.getElementById('patientPagination').innerHTML = '';
            return;
        }

        var pp = getPatientModalPerms();

        // ---- Build rows using DOM API to avoid FortiGate rewriting inline event attrs ----
        tbody.innerHTML = '';
        page.forEach(function(p) {
            var tr = document.createElement('tr');
            tr.setAttribute('data-patient-id', p.id);

            // Col: Patient Code
            var tdCode = document.createElement('td');
            var codeEl = document.createElement('code');
            codeEl.textContent = p.patientCode || p.id;
            tdCode.appendChild(codeEl);
            tr.appendChild(tdCode);

            // Col: Name
            var tdName = document.createElement('td');
            var strong = document.createElement('strong');
            strong.textContent = (p.firstName || '') + ' ' + (p.lastName || '');
            tdName.appendChild(strong);
            tr.appendChild(tdName);

            // Col: Clinic
            var tdClinic = document.createElement('td');
            if (p.Clinic) {
                var clinicSpan = document.createElement('span');
                // Custom style: deep teal bg + white text â€” readable in both light & dark mode
                // bg-info with text-dark fails in dark mode (dark text on cyan = invisible)
                clinicSpan.style.cssText = 'display:inline-flex;align-items:center;gap:4px;background:#0e7490;color:#ffffff;font-size:0.72rem;font-weight:600;padding:2px 8px;border-radius:5px;white-space:nowrap';
                clinicSpan.innerHTML = '<i class="fas fa-hospital" style="font-size:0.65rem;opacity:0.85"></i>';
                clinicSpan.appendChild(document.createTextNode(p.Clinic.name));
                tdClinic.appendChild(clinicSpan);
            } else {
                tdClinic.innerHTML = '<span class="text-muted">\u2014</span>';
            }
            tr.appendChild(tdClinic);

            // Col: DOB
            var tdDob = document.createElement('td');
            tdDob.textContent = window.fmtDate(p.dob) || '\u2014';
            tr.appendChild(tdDob);

            // Col: Phone
            var tdPhone = document.createElement('td');
            tdPhone.textContent = p.phone || '\u2014';
            tr.appendChild(tdPhone);

            // Col: Service Date
            var tdSvc = document.createElement('td');
            tdSvc.textContent = window.fmtDate(p.serviceDate) || '\u2014';
            tr.appendChild(tdSvc);

            // Col: Next Svc Date (serviceDate + 90 days, color-coded)
            // daysLeft < 0  â†’ window EXPIRED = patient ELIGIBLE for new service (green)
            // daysLeft 0-7  â†’ expiring very soon (orange warning)
            // daysLeft 8-14 â†’ expiring soon (yellow warning)
            // daysLeft > 14 â†’ in active window (plain date)
            var tdNext = document.createElement('td');
            if (p.serviceDate) {
                var _sd   = new Date(p.serviceDate); _sd.setHours(0,0,0,0);
                var _exp  = new Date(_sd.getTime() + 90 * 864e5);
                var _now  = new Date(); _now.setHours(0,0,0,0);
                var _dl   = Math.round((_exp - _now) / 864e5);
                var _es   = _exp.toLocaleDateString();
                if (_dl < 0) {
                    // Past 90 days â€” ELIGIBLE for new service
                    tdNext.innerHTML = '<span class="badge" style="background:#198754;font-size:.72rem" title="Eligible since ' + _es + ' (' + Math.abs(_dl) + 'd ago)"><i class="fas fa-check-circle me-1"></i>Eligible âœ“</span><small class="d-block text-muted" style="font-size:.68rem">Since ' + _es + '</small>';
                } else if (_dl <= 7) {
                    tdNext.innerHTML = '<span class="badge bg-danger" style="font-size:.72rem" title="Eligible in ' + _dl + ' days"><i class="fas fa-hourglass-half me-1"></i>' + _dl + 'd left</span><small class="d-block text-muted" style="font-size:.68rem">' + _es + '</small>';
                } else if (_dl <= 14) {
                    tdNext.innerHTML = '<span class="badge bg-warning text-dark" style="font-size:.72rem" title="Eligible in ' + _dl + ' days"><i class="fas fa-clock me-1"></i>' + _dl + 'd left</span><small class="d-block text-muted" style="font-size:.68rem">' + _es + '</small>';
                } else {
                    tdNext.innerHTML = '<span style="font-size:.87rem;color:var(--text-muted,#6c757d)">' + _es + '</span>';
                }
            } else {
                tdNext.innerHTML = '<span class="text-muted">â€”</span>';
            }
            tr.appendChild(tdNext);

            // Col: Status
            var tdStatus = document.createElement('td');
            var statusSpan = document.createElement('span');
            if (p.isDeleted) {
                statusSpan.className = 'badge bg-danger';
                statusSpan.textContent = 'Deleted';
            } else if (p.isActive) {
                statusSpan.className = 'badge bg-success';
                statusSpan.textContent = 'Active';
            } else {
                statusSpan.className = 'badge bg-secondary';
                statusSpan.textContent = 'Inactive';
            }
            tdStatus.appendChild(statusSpan);
            tr.appendChild(tdStatus);

            // Col: Actions
            var tdAct = document.createElement('td');

            if (p.isDeleted) {
                if (pp.canDelete) {
                    var btnRestore = document.createElement('button');
                    btnRestore.className = 'btn btn-sm btn-outline-success';
                    btnRestore.innerHTML = '<i class="fas fa-undo"></i> Restore';
                    btnRestore.dataset.pid = p.id;
                    btnRestore.addEventListener('click', function() { restorePatient(parseInt(this.dataset.pid)); });
                    tdAct.appendChild(btnRestore);
                }
            } else {
                // Shared RX count for badge display on RX, History, and Timeline buttons
                var rxCount = (p.RXRecords && p.RXRecords.length) || 0;

                // â”€â”€ Helper: build a count badge pill (only shown when count > 0) â”€â”€
                function makeBadgePill(count, color) {
                    if (count <= 0) return null;
                    var pill = document.createElement('span');
                    pill.className = 'position-absolute top-0 start-100 translate-middle badge rounded-pill';
                    pill.style.cssText = 'font-size:.55rem;min-width:1.1rem;padding:2px 4px;border:1.5px solid #fff;background:' + color + ';color:#fff;';
                    pill.textContent = count;
                    return pill;
                }

                // RX Records button
                var btnRx = document.createElement('button');
                btnRx.className = 'btn btn-sm btn-outline-info me-1 position-relative';
                var rxTitle = rxCount > 0 ? rxCount + ' RX record' + (rxCount !== 1 ? 's' : '') : 'No RX records';
                btnRx.title = rxTitle;
                btnRx.innerHTML = '<i class="fas fa-prescription-bottle-alt"></i>';
                btnRx.dataset.pid = p.id;
                btnRx.dataset.pname = encodeURIComponent((p.firstName || '') + ' ' + (p.lastName || ''));
                var _rxPill = makeBadgePill(rxCount, '#0dcaf0'); if (_rxPill) btnRx.appendChild(_rxPill);
                btnRx.addEventListener('click', function() { goToRxByEl(this); });
                tdAct.appendChild(btnRx);

                // RX History button (Previous Service Dates)
                var btnHist = document.createElement('button');
                btnHist.className = 'btn btn-sm me-1 position-relative';
                var histTitle = rxCount > 0 ? rxCount + ' service record' + (rxCount !== 1 ? 's' : '') : 'No history';
                btnHist.title = histTitle;
                btnHist.style.cssText = 'border-color:#7c3aed;color:#7c3aed';
                btnHist.dataset.pid = p.id;
                btnHist.dataset.pname = (p.firstName || '') + ' ' + (p.lastName || '');
                var _histIcon = document.createElement('i');
                _histIcon.className = 'fas fa-calendar-alt';
                btnHist.appendChild(_histIcon);
                var _histPill = makeBadgePill(rxCount, '#7c3aed'); if (_histPill) btnHist.appendChild(_histPill);
                btnHist.addEventListener('mouseenter', function() { this.style.background = 'rgba(124,58,237,.1)'; });
                btnHist.addEventListener('mouseleave', function() { this.style.background = ''; });
                btnHist.addEventListener('click', function() { openRxHistory(parseInt(this.dataset.pid), this.dataset.pname); });
                tdAct.appendChild(btnHist);

                // Timeline button â€” badge = RX count + notes (total events)
                var noteCount0 = (p.PatientNotes && p.PatientNotes.length) || 0;
                var tlCount = rxCount + noteCount0;
                var btnTl = document.createElement('button');
                btnTl.className = 'btn btn-sm me-1 position-relative';
                var tlTitle = tlCount > 0 ? tlCount + ' event' + (tlCount !== 1 ? 's' : '') + ' in timeline' : 'No timeline events';
                btnTl.title = tlTitle;
                btnTl.style.cssText = 'border-color:#20c9a0;color:#20c9a0';
                btnTl.dataset.pid = p.id;
                var _tlIcon = document.createElement('i');
                _tlIcon.className = 'fas fa-history';
                btnTl.appendChild(_tlIcon);
                var _tlPill = makeBadgePill(tlCount, '#20c9a0'); if (_tlPill) btnTl.appendChild(_tlPill);
                btnTl.addEventListener('mouseenter', function() { this.style.background = 'rgba(32,201,160,.1)'; });
                btnTl.addEventListener('mouseleave', function() { this.style.background = ''; });
                btnTl.addEventListener('click', function() { goToTimeline(parseInt(this.dataset.pid)); });
                tdAct.appendChild(btnTl);

                // Notes button
                var noteCount = (p.PatientNotes && p.PatientNotes.length) || 0;
                var noteTitle = noteCount ? (noteCount + ' note' + (noteCount !== 1 ? 's' : '')) : 'Notes';
                var btnNotes = document.createElement('button');
                btnNotes.className = 'btn btn-sm btn-outline-warning me-1 position-relative';
                btnNotes.title = noteTitle;
                btnNotes.id = 'notes-btn-' + p.id;
                btnNotes.dataset.nid = p.id;
                btnNotes.dataset.nfirst = p.firstName || '';
                btnNotes.dataset.nlast = p.lastName || '';
                btnNotes.innerHTML = '<i class="fas fa-sticky-note"></i>';
                if (noteCount > 0) {
                    var notePill = document.createElement('span');
                    notePill.className = 'position-absolute top-0 start-100 translate-middle badge rounded-pill bg-warning text-dark';
                    notePill.style.cssText = 'font-size:.6rem;min-width:1.1rem;padding:2px 4px;border:1.5px solid #fff';
                    notePill.textContent = noteCount;
                    btnNotes.appendChild(notePill);
                }
                btnNotes.addEventListener('click', function() { openNotesByEl(this); });
                tdAct.appendChild(btnNotes);

                // Print button
                var btnPrint = document.createElement('button');
                btnPrint.className = 'btn btn-sm btn-outline-secondary me-1';
                btnPrint.title = 'Print / PDF';
                btnPrint.innerHTML = '<i class="fas fa-print"></i>';
                btnPrint.dataset.pid = p.id;
                btnPrint.addEventListener('click', function() { printPatientRecord(parseInt(this.dataset.pid)); });
                tdAct.appendChild(btnPrint);

                // View button (shown when user cannot edit â€” read-only access to patient details)
                if (!pp.canEdit) {
                    var btnView = document.createElement('button');
                    btnView.className = 'btn btn-sm btn-outline-info me-1';
                    btnView.title = 'View details';
                    btnView.innerHTML = '<i class="fas fa-eye"></i>';
                    btnView.dataset.pid = p.id;
                    btnView.addEventListener('click', function() { openPatientModal(parseInt(this.dataset.pid)); });
                    tdAct.appendChild(btnView);
                }

                // Edit button (shown only when user has canEdit)
                if (pp.canEdit) {
                    var btnEdit = document.createElement('button');
                    btnEdit.className = 'btn btn-sm btn-outline-primary me-1';
                    btnEdit.innerHTML = '<i class="fas fa-edit"></i>';
                    btnEdit.dataset.pid = p.id;
                    btnEdit.addEventListener('click', function() { openPatientModal(parseInt(this.dataset.pid)); });
                    tdAct.appendChild(btnEdit);
                }

                // Delete button
                if (pp.canDelete) {
                    var btnDel = document.createElement('button');
                    btnDel.className = 'btn btn-sm btn-outline-danger';
                    btnDel.innerHTML = '<i class="fas fa-trash"></i>';
                    btnDel.dataset.pid = p.id;
                    btnDel.addEventListener('click', function() { promptDeletePatient(parseInt(this.dataset.pid)); });
                    tdAct.appendChild(btnDel);
                }
            }

            tr.appendChild(tdAct);
            tbody.appendChild(tr);
        });

        var pi = document.getElementById('patientPageInfo');
        if (pi) pi.textContent = 'Showing ' + (filteredPatients.length === 0 ? 0 : Math.min(start + 1, filteredPatients.length)) + '\u2013' + Math.min(start + pageSize, filteredPatients.length) + ' of ' + filteredPatients.length;

        var pages = Math.ceil(filteredPatients.length / pageSize);
        // Smart ellipsis pagination â€” never renders more than ~9 buttons
        var pagHtml = '<li class="page-item' + (currentPage === 1 ? ' disabled' : '') + '"><a class="page-link" href="#" data-pg="' + (currentPage - 1) + '">&laquo;</a></li>';
        var delta = 2; // pages each side of current
        var lo = Math.max(2, currentPage - delta);
        var hi = Math.min(pages - 1, currentPage + delta);
        // Always show page 1
        pagHtml += '<li class="page-item' + (currentPage === 1 ? ' active' : '') + '"><a class="page-link" href="#" data-pg="1">1</a></li>';
        if (lo > 2) pagHtml += '<li class="page-item disabled"><span class="page-link">&hellip;</span></li>';
        for (var pageNum = lo; pageNum <= hi; pageNum++) {
            pagHtml += '<li class="page-item' + (pageNum === currentPage ? ' active' : '') + '"><a class="page-link" href="#" data-pg="' + pageNum + '">' + pageNum + '</a></li>';
        }
        if (hi < pages - 1) pagHtml += '<li class="page-item disabled"><span class="page-link">&hellip;</span></li>';
        // Always show last page (if more than 1 page)
        if (pages > 1) pagHtml += '<li class="page-item' + (currentPage === pages ? ' active' : '') + '"><a class="page-link" href="#" data-pg="' + pages + '">' + pages + '</a></li>';
        pagHtml += '<li class="page-item' + ((currentPage >= pages || pages === 0) ? ' disabled' : '') + '"><a class="page-link" href="#" data-pg="' + (currentPage + 1) + '">&raquo;</a></li>';
        var pagEl = document.getElementById('patientPagination');
        pagEl.innerHTML = pagHtml;
        // Event delegation on pagination â€” avoids inline onclick= which FortiGate corrupts
        pagEl.addEventListener('click', function(e) {
            e.preventDefault();
            var a = e.target.closest('a[data-pg]');
            if (!a) return;
            goPPage(parseInt(a.dataset.pg));
        });
    }


    // â”€â”€ Navigation helpers â€” all URL building via concatenation + data attributes
    // Avoids putting complex expressions inside template literal onclick attributes,
    // which FortiGate SSL portal mangles when rewriting URLs.
    function renderNeedsActionBanner() {
        const container = document.getElementById('patientsNeedsActionBanner');
        if (!container) return;

        var pending = (Array.isArray(allPatients) ? allPatients : []).filter(function(p) {
            return !!p.needsAction;
        });

        if (!pending.length) {
            container.innerHTML = '';
            return;
        }

        const eligValue = (document.getElementById('srchEligibility')?.value || '');
        const isNeedsActionFilter = eligValue === 'needsAction';
        const plural = pending.length === 1 ? '' : 's';

        container.textContent = '';

        var banner = document.createElement('div');
        banner.style.padding = '8px 12px';
        banner.style.borderRadius = '10px';
        banner.style.fontSize = '.85rem';
        banner.style.display = 'flex';
        banner.style.alignItems = 'center';
        banner.style.justifyContent = 'space-between';
        banner.style.gap = '10px';
        banner.style.border = isNeedsActionFilter
            ? '1px solid rgba(220,53,69,.25)'
            : '1px solid rgba(255,193,7,.4)';
        banner.style.background = isNeedsActionFilter
            ? 'rgba(220,53,69,.06)'
            : 'rgba(255,193,7,.12)';

        var message = document.createElement('span');
        var icon = document.createElement('i');
        icon.className = isNeedsActionFilter
            ? 'fas fa-filter me-2'
            : 'fas fa-exclamation-triangle me-2 text-warning';
        if (isNeedsActionFilter) icon.style.color = '#dc3545';
        message.appendChild(icon);

        if (isNeedsActionFilter) {
            message.appendChild(document.createTextNode('Showing '));
            var strong = document.createElement('strong');
            strong.textContent = String(pending.length);
            message.appendChild(strong);
            message.appendChild(document.createTextNode(' patient' + plural + ' that require workflow action.'));
        } else {
            message.appendChild(document.createTextNode('There are '));
            var count = document.createElement('strong');
            count.textContent = String(pending.length);
            message.appendChild(count);
            message.appendChild(document.createTextNode(' patient' + plural + ' past the 90-day window with incomplete RX workflow.'));
        }

        banner.appendChild(message);

        if (!isNeedsActionFilter) {
            var showBtn = document.createElement('button');
            showBtn.type = 'button';
            showBtn.id = 'showNeedsActionBtn';
            showBtn.className = 'btn btn-sm btn-warning';
            var btnIcon = document.createElement('i');
            btnIcon.className = 'fas fa-filter me-1';
            showBtn.appendChild(btnIcon);
            showBtn.appendChild(document.createTextNode('Show Patients'));
            banner.appendChild(showBtn);
        }

        container.appendChild(banner);

        const btn = document.getElementById('showNeedsActionBtn');
        if (!isNeedsActionFilter && btn) {
            btn.addEventListener('click', function() {
                var eligEl = document.getElementById('srchEligibility');
                if (!eligEl) return;
                eligEl.value = 'needsAction';
                var advRow = document.getElementById('advancedFilterRow');
                var chevron = document.getElementById('advancedChevron');
                if (advRow) {
                    advRow.style.display = '';
                    _advancedOpen = true;
                }
                if (chevron) chevron.className = 'fas fa-chevron-up ms-1';
                liveFilter();
            });
        }
    }

    function goToRxByEl(el) {
        window.rxNav('/rx-records?patient=' + el.dataset.pid + '&name=' + el.dataset.pname);
    }
    function goToRxRecords(id, encodedName) {
        window.rxNav('/rx-records?patient=' + id + '&name=' + encodedName);
    }
    function goToTimeline(id) {
        window.rxNav('/patients/' + id + '/timeline');
    }
    function openNotesByEl(el) {
        const id   = parseInt(el.dataset.nid);
        const name = (el.dataset.nfirst || '') + ' ' + (el.dataset.nlast || '');
        openNotesModal(id, name.trim());
    }

    function goPPage(p) {
        const pages = Math.ceil(filteredPatients.length / pageSize);
        if(p<1||p>pages) return;
        currentPage = p; renderPatients();
    }

    // â”€â”€ RX History Modal â€” Previous Service Dates â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    var _rxHistoryModal = null;
    var _rxHistoryContext = null;

    function rxHistoryAssetUrl(path) {
        return typeof window.rxUrl === 'function' ? window.rxUrl(path) : path;
    }

    function rxHistoryFilePart(value) {
        return String(value || 'patient')
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '')
            .slice(0, 60) || 'patient';
    }

    function rxHistoryFindRx(rxId) {
        var rows = _rxHistoryContext && Array.isArray(_rxHistoryContext.rxRecords) ? _rxHistoryContext.rxRecords : [];
        rxId = Number(rxId);
        for (var i = 0; i < rows.length; i++) {
            if (Number(rows[i].id) === rxId) return rows[i];
        }
        return null;
    }

    function rxHistoryWorkflowStatus(rx) {
        var actions = _rxHistoryContext && Array.isArray(_rxHistoryContext.workflowActions) ? _rxHistoryContext.workflowActions : [];
        var done = rx && Array.isArray(rx.RXWorkflowTrackings) ? rx.RXWorkflowTrackings.length : 0;
        var total = actions.length;
        var pct = total > 0 ? Math.round((done / total) * 100) : 0;
        var label = total > 0 && done >= total ? 'Complete' : done > 0 ? 'In Progress' : 'Not Started';
        return { done: done, total: total, pct: pct, label: label };
    }

    function rxHistoryMedicationText(rx) {
        var meds = rx && Array.isArray(rx.Medications) ? rx.Medications : [];
        if (!meds.length) return 'None recorded';
        return meds.map(function(m) { return m.name || 'Medication'; }).join(', ');
    }

    function rxHistoryWorkflowTable(rx) {
        var actions = _rxHistoryContext && Array.isArray(_rxHistoryContext.workflowActions) ? _rxHistoryContext.workflowActions : [];
        var trackings = {};
        (rx.RXWorkflowTrackings || []).forEach(function(t) { trackings[t.workflowActionId] = t; });
        if (!actions.length) {
            var status = rxHistoryWorkflowStatus(rx);
            return '<div style="color:#667085;font-size:.85rem">Workflow steps recorded: ' + patientEscapeHtml(status.done) + '</div>';
        }
        var rows = actions.map(function(action, index) {
            var tracking = trackings[action.id];
            var done = !!tracking;
            var date = done && tracking.completionDate ? window.fmtDate(tracking.completionDate) : 'Pending';
            var by = done && tracking.User ? (' by ' + ((tracking.User.firstName || '') + ' ' + (tracking.User.lastName || '')).trim()) : '';
            return '<tr>' +
                '<td style="padding:6px 8px;border-bottom:1px solid #e5e7eb">' + (index + 1) + '. ' + patientEscapeHtml(action.name || 'Step') + '</td>' +
                '<td style="padding:6px 8px;border-bottom:1px solid #e5e7eb">' + patientEscapeHtml(date) + patientEscapeHtml(by) + '</td>' +
                '<td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;color:' + (done ? '#198754' : '#667085') + ';font-weight:700">' + (done ? 'Done' : 'Pending') + '</td>' +
            '</tr>';
        }).join('');
        return '<table style="width:100%;border-collapse:collapse;font-size:.84rem;margin-top:8px">' +
            '<thead><tr style="background:#1a2234;color:#fff"><th style="padding:7px 8px;text-align:left">Step</th><th style="padding:7px 8px;text-align:left">Date / User</th><th style="padding:7px 8px;text-align:left">Status</th></tr></thead>' +
            '<tbody>' + rows + '</tbody></table>';
    }

    function rxHistoryPrintCard(rx) {
        var status = rxHistoryWorkflowStatus(rx);
        var statusColor = status.label === 'Complete' ? '#198754' : status.done > 0 ? '#fd7e14' : '#6c757d';
        var svcDate = rx.serviceDate || '';
        var expDate = svcDate ? new Date(new Date(svcDate).getTime() + 90 * 864e5) : null;
        var pharmacy = rx.Pharmacy ? rx.Pharmacy.name : 'None';
        return '<div style="border:1px solid #e5e7eb;border-radius:10px;overflow:hidden;margin:14px 0;background:#fff">' +
            '<div style="background:#1a2234;color:#fff;padding:10px 14px;display:flex;justify-content:space-between;gap:10px;align-items:center">' +
                '<div><strong>RX #' + patientEscapeHtml(rx.id) + '</strong></div>' +
                '<span style="background:' + statusColor + ';color:#fff;padding:3px 10px;border-radius:12px;font-size:.76rem;font-weight:700">' + patientEscapeHtml(status.label) + '</span>' +
            '</div>' +
            '<div style="padding:12px 14px">' +
                '<div style="display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;font-size:.86rem">' +
                    '<div><div style="color:#667085;font-size:.68rem;text-transform:uppercase;font-weight:700">Service Date</div><strong>' + patientEscapeHtml(svcDate ? window.fmtDate(svcDate) : 'None') + '</strong></div>' +
                    '<div><div style="color:#667085;font-size:.68rem;text-transform:uppercase;font-weight:700">Next Available</div><strong>' + patientEscapeHtml(expDate ? expDate.toLocaleDateString() : 'None') + '</strong></div>' +
                    '<div><div style="color:#667085;font-size:.68rem;text-transform:uppercase;font-weight:700">Pharmacy</div><strong>' + patientEscapeHtml(pharmacy) + '</strong></div>' +
                    '<div><div style="color:#667085;font-size:.68rem;text-transform:uppercase;font-weight:700">Workflow</div><strong>' + status.done + '/' + status.total + ' (' + status.pct + '%)</strong></div>' +
                '</div>' +
                '<div style="margin-top:10px;font-size:.84rem"><span style="color:#667085;font-weight:700">Medications:</span> ' + patientEscapeHtml(rxHistoryMedicationText(rx)) + '</div>' +
                rxHistoryWorkflowTable(rx) +
            '</div>' +
        '</div>';
    }

    function rxHistoryOpenPrint(title, records) {
        if (!records.length) {
            if (typeof showToast === 'function') showToast('No RX history to print.', 'warning');
            return;
        }
        var patientName = (_rxHistoryContext && _rxHistoryContext.patientName) || 'Patient';
        var cssUrl = rxHistoryAssetUrl('/assets/inter.css').replace(/"/g, '%22');
        var cards = records.map(rxHistoryPrintCard).join('');
        var win = window.open('', '_blank', 'width=980,height=760');
        if (!win) {
            if (typeof showToast === 'function') showToast('Popup blocked. Allow popups to print.', 'warning');
            return;
        }
        win.document.write('<!DOCTYPE html><html><head><meta charset="UTF-8">' +
            '<title>' + patientEscapeHtml(title) + '</title>' +
            '<style>@import url("' + cssUrl + '");*{box-sizing:border-box}body{font-family:Inter,Arial,sans-serif;color:#1a2234;background:#f4f6f8;padding:28px}.sheet{max-width:960px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 8px 30px rgba(0,0,0,.08)}.head{background:linear-gradient(135deg,#1a2234,#2c3e6b);color:#fff;padding:20px 26px}.content{padding:22px 26px}@media print{@page{margin:15mm;size:A4 portrait}body{background:#fff;padding:0}.sheet{box-shadow:none;border-radius:0}.head{-webkit-print-color-adjust:exact;print-color-adjust:exact}}</style>' +
            '</head><body><div class="sheet"><div class="head"><h2 style="margin:0">' + patientEscapeHtml(title) + '</h2><div style="opacity:.8;margin-top:4px">' + patientEscapeHtml(patientName) + ' - Generated ' + patientEscapeHtml(new Date().toLocaleString()) + '</div></div><div class="content">' + cards + '</div></div>' +
            '<script>window.onload=function(){setTimeout(function(){window.print();},100);};<\/script></body></html>');
        win.document.close();
        win.focus();
    }

    function rxHistoryExportRecords(filename, records) {
        if (!records.length) {
            if (typeof showToast === 'function') showToast('No RX history to export.', 'warning');
            return;
        }
        var headers = ['RX ID', 'Service Date', 'Next Available', 'Arrival Date', 'Pharmacy', 'Workflow', 'Status', 'Medications'];
        var rows = records.map(function(rx) {
            var status = rxHistoryWorkflowStatus(rx);
            var expDate = rx.serviceDate ? new Date(new Date(rx.serviceDate).getTime() + 90 * 864e5) : null;
            return [
                rx.id,
                rx.serviceDate || '',
                expDate ? expDate.toISOString().slice(0, 10) : '',
                rx.arrivalDate || '',
                rx.Pharmacy ? rx.Pharmacy.name : '',
                status.done + '/' + status.total + ' (' + status.pct + '%)',
                status.label,
                rxHistoryMedicationText(rx)
            ];
        });
        exportToCsv(filename, headers, rows);
    }

    function printRxHistoryCycle(rxId) {
        var rx = rxHistoryFindRx(rxId);
        if (!rx) return;
        rxHistoryOpenPrint('RX Service Date History - RX #' + rx.id, [rx]);
    }

    function exportRxHistoryCycle(rxId) {
        var rx = rxHistoryFindRx(rxId);
        if (!rx) return;
        var patientName = rxHistoryFilePart((_rxHistoryContext && _rxHistoryContext.patientName) || 'patient');
        rxHistoryExportRecords('rx-service-history-' + patientName + '-rx-' + rx.id + '.csv', [rx]);
    }

    function printRxHistoryAll() {
        var records = _rxHistoryContext && Array.isArray(_rxHistoryContext.rxRecords) ? _rxHistoryContext.rxRecords : [];
        rxHistoryOpenPrint('RX Previous Service Dates', records);
    }

    function exportRxHistoryAll() {
        var records = _rxHistoryContext && Array.isArray(_rxHistoryContext.rxRecords) ? _rxHistoryContext.rxRecords : [];
        var patientName = rxHistoryFilePart((_rxHistoryContext && _rxHistoryContext.patientName) || 'patient');
        rxHistoryExportRecords('rx-service-history-' + patientName + '.csv', records);
    }

    async function openRxHistory(patientId, patientName) {
        var nameEl  = document.getElementById('rxHistoryPatientName');
        var body    = document.getElementById('rxHistoryBody');
        var countEl = document.getElementById('rxHistoryCount');
        if (nameEl)  nameEl.textContent  = patientName || ('Patient #' + patientId);
        if (body)    body.innerHTML      = '<p class="text-center text-muted py-5"><i class="fas fa-spinner fa-spin me-2"></i>Loading...</p>';
        if (countEl) countEl.textContent = '';
        if (!_rxHistoryModal) _rxHistoryModal = new bootstrap.Modal(document.getElementById('rxHistoryModal'));
        _rxHistoryModal.show();

        try {
            var waRes = await fetchWithAuth('/api/lookup/workflow-actions', { silent: true });
            var rxRes = await fetchWithAuth('/api/rx-records?includeDeleted=false');
            var allWA = (waRes && waRes.ok) ? await waRes.json() : [];
            var allRx = (rxRes && rxRes.ok) ? await rxRes.json() : [];
            var patRx = allRx.filter(function(r) { return r.patientId === patientId; });

            // Sort newest service date first
            patRx.sort(function(a, b) {
                var da = a.serviceDate || '', db = b.serviceDate || '';
                return da < db ? 1 : da > db ? -1 : 0;
            });
            _rxHistoryContext = {
                patientId: patientId,
                patientName: patientName || ('Patient #' + patientId),
                workflowActions: allWA,
                rxRecords: patRx
            };

            if (countEl) countEl.textContent = patRx.length + ' RX cycle' + (patRx.length !== 1 ? 's' : '') + ' found';

            if (!patRx.length) {
                body.innerHTML = '<div class="text-center text-muted py-5"><i class="fas fa-prescription-bottle-alt fa-2x mb-3 d-block opacity-50"></i>No RX records found for this patient.</div>';
                return;
            }

            var html = '<div class="p-3">';
            patRx.forEach(function(rx, idx) {
                var svcD    = rx.serviceDate || null;
                var expDate = svcD ? new Date(new Date(svcD).getTime() + 90 * 864e5) : null;
                var expStr  = expDate ? expDate.toLocaleDateString() : '\u2014';
                var dLeft   = expDate ? Math.round((expDate - new Date()) / 864e5) : null;
                var isNewest = idx === 0;

                var cycleLabel, cycleBg;
                if (dLeft === null)    { cycleLabel = 'No Date';    cycleBg = '#6c757d'; }
                else if (dLeft < 0)   { cycleLabel = 'Expired';    cycleBg = '#dc3545'; }
                else if (dLeft <= 14) { cycleLabel = dLeft + 'd left'; cycleBg = '#fd7e14'; }
                else                  { cycleLabel = 'Active';     cycleBg = '#198754'; }

                var trackings  = rx.RXWorkflowTrackings || [];
                var doneCount  = trackings.length;
                var totalSteps = allWA.length;
                var pct        = totalSteps > 0 ? Math.round((doneCount / totalSteps) * 100) : 0;
                var barColor   = pct >= 100 ? '#198754' : pct > 0 ? '#fd7e14' : '#6c757d';
                var pharmacy   = rx.Pharmacy ? rx.Pharmacy.name : '\u2014';

                html += '<div style="border:1px solid ' + (isNewest ? '#4a90e2' : '#dee2e6') + ';border-left:4px solid ' + (isNewest ? '#4a90e2' : '#adb5bd') + ';border-radius:10px;overflow:hidden;margin-bottom:14px">';

                // Header
                html += '<div style="background:' + (isNewest ? '#f0f5ff' : '#f8f9fa') + ';padding:8px 14px;display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid #e9ecef">';
                html += '<span style="font-weight:700"><i class="fas fa-prescription-bottle-alt me-2 text-primary"></i>RX #' + rx.id;
                if (isNewest) html += ' <span style="background:#4a90e2;color:#fff;font-size:.65rem;padding:2px 8px;border-radius:10px;margin-left:6px">Current</span>';
                html += '</span>';
                html += '<div class="d-flex align-items-center gap-2 flex-wrap">';
                html += '<span style="background:' + cycleBg + ';color:#fff;font-size:.72rem;padding:2px 10px;border-radius:12px;font-weight:600">' + cycleLabel + '</span>';
                html += '<button type="button" class="btn btn-sm btn-outline-secondary py-0 px-2" data-rxhist-print="' + rx.id + '" title="Print this service date cycle"><i class="fas fa-print"></i></button>';
                html += '<button type="button" class="btn btn-sm btn-outline-success py-0 px-2" data-rxhist-export="' + rx.id + '" title="Export this service date cycle CSV"><i class="fas fa-file-csv"></i></button>';
                html += '</div>';
                html += '</div>';

                // Info grid
                html += '<div style="padding:10px 14px">';
                html += '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:8px 20px;margin-bottom:10px">';
                html += '<div><div style="font-size:.63rem;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#888;margin-bottom:2px">Service Date</div><div style="font-weight:600">' + (svcD || '\u2014') + '</div></div>';
                html += '<div><div style="font-size:.63rem;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#888;margin-bottom:2px">Next Available</div><div style="font-weight:600;color:' + cycleBg + '">' + expStr + '</div></div>';
                html += '<div><div style="font-size:.63rem;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#888;margin-bottom:2px">Pharmacy</div><div>' + pharmacy + '</div></div>';
                html += '<div><div style="font-size:.63rem;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#888;margin-bottom:2px">Progress</div>';
                html += '<div style="display:flex;align-items:center;gap:6px"><div style="flex:1;height:6px;background:#e9ecef;border-radius:3px;overflow:hidden"><div style="height:100%;width:' + pct + '%;background:' + barColor + '"></div></div><small>' + doneCount + '/' + totalSteps + '</small></div></div>';
                html += '</div>';

                // Workflow step pills
                if (allWA.length > 0) {
                    var trackMap = {};
                    trackings.forEach(function(t) { trackMap[t.workflowActionId] = t; });
                    html += '<div style="display:flex;flex-wrap:wrap;gap:5px">';
                    allWA.forEach(function(wa) {
                        var t = trackMap[wa.id];
                        var done = !!t;
                        var dateStr = (t && t.completionDate) ? new Date(t.completionDate).toLocaleDateString() : null;
                        var pillBg  = done ? '#d1f0e0' : '#f0f0f0';
                        var pillClr = done ? '#0a5c36' : '#888';
                        html += '<span style="background:' + pillBg + ';color:' + pillClr + ';border-radius:20px;padding:2px 10px;font-size:.72rem;font-weight:' + (done ? '600' : '400') + '">';
                        html += (done ? '\u2713 ' : '\u25cb ') + wa.name;
                        if (dateStr) html += ' <span style="opacity:.75;font-size:.65rem">Â· ' + dateStr + '</span>';
                        html += '</span>';
                    });
                    html += '</div>';
                }
                html += '</div></div>';
            });
            html += '</div>';
            body.innerHTML = html;
        } catch(e) {
            if (body) body.innerHTML = '<p class="text-danger text-center py-4">Error loading RX history.</p>';
        }
    }
    // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    // Compute and display next available service date inside the edit modal
    function _updateNextSvcDisplay() {
        var el = document.getElementById('pNextSvcDisplay');
        var inp = document.getElementById('pServiceDate');
        if (!el || !inp) return;
        var val = inp.value;
        if (!val) { el.innerHTML = ''; return; }
        var sd   = new Date(val); sd.setHours(0,0,0,0);
        var exp  = new Date(sd.getTime() + 90 * 864e5);
        var now  = new Date(); now.setHours(0,0,0,0);
        var dl   = Math.round((exp - now) / 864e5);
        var es   = exp.toLocaleDateString();
        var html;
        if (dl < 0) {
            html = '<span class="badge bg-danger"><i class="fas fa-exclamation-circle me-1"></i>Expired ' + Math.abs(dl) + 'd ago</span> <small class="text-muted">Next: ' + es + '</small>';
        } else if (dl <= 14) {
            html = '<span class="badge bg-warning text-dark"><i class="fas fa-clock me-1"></i>' + dl + 'd left</span> <small class="text-muted">Closes: ' + es + '</small>';
        } else {
            html = '<span class="badge bg-success"><i class="fas fa-check me-1"></i>Active</span> <small class="text-muted">Next available: ' + es + '</small>';
        }
        el.innerHTML = html;
    }

    function openPatientModal(id, options) {
        options = options || {};
        editingPatientId = id;
        document.getElementById('patientModalTitle').textContent = id ? 'Edit Patient' : 'Add Patient';
        const patient = id ? allPatients.find(p => p.id === id) : null;
        patientModalOriginalServiceDate = patient ? (window.isoDate(patient.serviceDate) || '') : '';
        patientModalCanUseAddRxShortcut = false;
        document.getElementById('pPatientCode').value = patient ? patient.patientCode || '' : '';
        document.getElementById('pFirstName').value = patient ? normalizeName(patient.firstName || '') : '';
        document.getElementById('pLastName').value = patient ? normalizeName(patient.lastName || '') : '';
        document.getElementById('pDob').value = patient ? window.isoDate(patient.dob) : '';
        document.getElementById('pPhone').value = patient ? patient.phone || '' : '';
        document.getElementById('pServiceDate').value = patient ? window.isoDate(patient.serviceDate) : '';
        document.getElementById('pAddress').value = patient ? patient.address || '' : '';
        document.getElementById('pNotes').value = patient ? patient.notes || '' : '';
        document.getElementById('pIsActive').checked = patient ? patient.isActive : true;
        document.getElementById('pIsNonCompanyPatient').checked = patient ? !!patient.isNonCompanyPatient : false;
        document.getElementById('pPatientTransport').value = patient ? (patient.patientTransportCompanyId !== null && patient.patientTransportCompanyId !== undefined ? String(patient.patientTransportCompanyId) : '') : '';
        document.getElementById('pPharmacyTransport').value = patient ? (patient.pharmacyTransportCompanyId !== null && patient.pharmacyTransportCompanyId !== undefined ? String(patient.pharmacyTransportCompanyId) : '') : '';
        document.getElementById('pClinicId').value = patient ? (patient.clinicId !== null && patient.clinicId !== undefined ? String(patient.clinicId) : '') : '';
        document.getElementById('pPharmacyId').value = patient ? (patient.pharmacyId !== null && patient.pharmacyId !== undefined ? String(patient.pharmacyId) : '') : '';
        loadPatientServiceDateHistory(id);

        // â”€â”€ 90-DAY SERVICE DATE LOCK UI â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        // When editing a patient whose service date is still within the active 90-day
        // window, show the amber lock banner and make the date field read-only.
        // The Patient's serviceDate is the canonical clock for the 90-day cycle.
        const banner   = document.getElementById('svcDateLockBanner');
        const lockIcon = document.getElementById('svcDateLockIcon');
        const svcInput = document.getElementById('pServiceDate');
        const detail   = document.getElementById('svcDateLockDetail');
        const patientPagePerms = getPatientModalPerms();
        const patientCanOverrideExpired = !!patientPagePerms.canOverrideExpired;
        const canBypassServiceDateLock = patientCanOverrideExpired || !!serviceDateOverrideEnabled;
        const isLocked = (function() {
            if (canBypassServiceDateLock) return false;
            if (!patient || !patient.serviceDate) return false;
            var sd  = new Date(patient.serviceDate); sd.setHours(0,0,0,0);
            var exp = new Date(sd.getTime() + 90 * 864e5);
            var now = new Date(); now.setHours(0,0,0,0);
            return now <= exp;
        })();
        if (isLocked && patient && patient.serviceDate) {
            var sd      = new Date(patient.serviceDate); sd.setHours(0,0,0,0);
            var exp     = new Date(sd.getTime() + 90 * 864e5);
            var now     = new Date(); now.setHours(0,0,0,0);
            var dLeft   = Math.ceil((exp - now) / 864e5);
            if (banner)   banner.style.display = '';
            if (lockIcon) lockIcon.style.display = '';
            if (svcInput) svcInput.setAttribute('readonly', 'readonly');
            if (detail)   detail.textContent = 'Started: ' + sd.toLocaleDateString() +
                ' \u2014 Expires: ' + exp.toLocaleDateString() +
                ' (' + dLeft + ' day' + (dLeft !== 1 ? 's' : '') + ' remaining).' +
                ' To start a new cycle, update this date after the window expires.';
        } else {
            if (banner)   banner.style.display = 'none';
            if (lockIcon) lockIcon.style.display = 'none';
            if (svcInput) svcInput.removeAttribute('readonly');
            if (detail)   detail.textContent = '';
        }
        // â”€â”€ END LOCK UI â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

        new bootstrap.Modal(document.getElementById('patientModal')).show();
        // Refresh the next-svc-date display for whatever date is loaded
        setTimeout(_updateNextSvcDisplay, 50);
        // Show/hide save button based on add vs edit permission
        const _saveBtn = document.getElementById('savePatientBtn');
        const _saveAddRxBtn = document.getElementById('savePatientAddRxBtn');
        try {
            const _pp = getPatientModalPerms();
            const _canAddPat  = _pp.canAdd  !== undefined ? !!_pp.canAdd  : !!_pp.canEdit;
            const _canEditPat = _pp.canEdit !== undefined ? !!_pp.canEdit : true;
            const _canOverridePat = _pp.canOverrideExpired !== undefined ? !!_pp.canOverrideExpired : false;
            const _isOverrideOnly = id !== null && !_canEditPat && _canOverridePat;
            const _isEditable = id === null ? _canAddPat : (_canEditPat || _isOverrideOnly);

            if (_saveBtn) _saveBtn.style.display = _isEditable ? '' : 'none';
            patientModalCanUseAddRxShortcut = id === null
                ? (_canAddPat && canAddRxAfterPatientCreate())
                : (_isEditable && canAddRxAfterPatientCreate());

            // Lock / unlock all form inputs for view-only mode
            const _patModal = document.getElementById('patientModal');
            if (_patModal) {
                _patModal.querySelectorAll('input, select, textarea').forEach(function(el) {
                    if (_isOverrideOnly) {
                        if (el.id === 'pServiceDate') {
                            el.removeAttribute('readonly');
                            el.removeAttribute('disabled');
                        } else if (el.tagName === 'SELECT' || el.type === 'checkbox') {
                            el.setAttribute('disabled', 'true');
                        } else {
                            el.setAttribute('readonly', 'true');
                        }
                        return;
                    }
                    if (_isEditable) {
                        if (!(el.id === 'pServiceDate' && isLocked)) {
                            el.removeAttribute('readonly');
                        }
                        el.removeAttribute('disabled');
                    } else {
                        if (el.tagName === 'SELECT' || el.type === 'checkbox') {
                            el.setAttribute('disabled', 'true');
                        } else {
                            el.setAttribute('readonly', 'true');
                        }
                    }
                });
                // Show / hide the view-only banner
                var _voBanner = document.getElementById('patientViewOnlyBanner');
                if (!_voBanner) {
                    _voBanner = document.createElement('div');
                    _voBanner.id = 'patientViewOnlyBanner';
                    _voBanner.className = 'alert alert-info d-flex align-items-center py-2 mb-3';
                    _voBanner.innerHTML = '<i class="fas fa-eye me-2"></i><span>View Only â€” you do not have permission to edit patient records.</span>';
                    var _mBody = _patModal.querySelector('.modal-body');
                    if (_mBody) _mBody.insertBefore(_voBanner, _mBody.firstChild);
                }
                if (_isOverrideOnly) {
                    _voBanner.className = 'alert alert-warning d-flex align-items-center py-2 mb-3';
                    _voBanner.innerHTML = '<i class="fas fa-key me-2"></i><span>Override Only â€” you can update the Service Date for this patient, but other patient fields remain locked.</span>';
                } else {
                    _voBanner.className = 'alert alert-info d-flex align-items-center py-2 mb-3';
                    _voBanner.innerHTML = '<i class="fas fa-eye me-2"></i><span>View Only â€” you do not have permission to edit patient records.</span>';
                }
                const _hidePermissionBanner = _isEditable && !_isOverrideOnly;
                _voBanner.classList.toggle('d-none', _hidePermissionBanner);
                if (_hidePermissionBanner) {
                    _voBanner.style.setProperty('display', 'none', 'important');
                } else {
                    _voBanner.style.removeProperty('display');
                }
            }
        } catch(e) {
            if (_saveBtn) _saveBtn.style.display = '';
            patientModalCanUseAddRxShortcut = canAddRxAfterPatientCreate();
        }
        updateSaveAddRxButtonState();
        if (!id && options.focusAddRx) {
            setTimeout(function() {
                var addRxBtn = document.getElementById('savePatientAddRxBtn');
                if (addRxBtn && addRxBtn.style.display !== 'none') addRxBtn.focus();
            }, 150);
        }
        if (window.rxDocuments) {
            var _docPerms = getPatientModalPerms();
            window.rxDocuments.bind({
                ownerType: 'patient',
                ownerId: id,
                inputEl: 'patientDocFiles',
                buttonEl: 'patientDocUploadBtn',
                uploadWrapEl: 'patientDocUploadWrap',
                statusEl: 'patientDocStatus',
                listEl: 'patientDocumentsList',
                canUpload: !!(id && _docPerms.canEdit),
                canDelete: !!_docPerms.canDelete
            });
        }
        // Acquire soft lock if editing an existing patient
        if (id) acquireModalLock(id);
    }

    async function shouldContinuePatientCreate(body) {
        if (editingPatientId || !body.firstName || !body.lastName || !body.dob) {
            return true;
        }

        try {
            var dupUrl = '/api/patients/check-duplicate?firstName=' + encodeURIComponent(body.firstName) +
                '&lastName=' + encodeURIComponent(body.lastName) +
                '&dob=' + encodeURIComponent(body.dob);
            const dupRes = await fetchWithAuth(dupUrl);
            if (!dupRes || !dupRes.ok) return true;

            const data = await dupRes.json();
            const duplicates = Array.isArray(data.duplicates) ? data.duplicates : [];
            if (!duplicates.length) return true;

            if (typeof showDuplicateWarning === 'function') {
                return await showDuplicateWarning(duplicates, body);
            }

            return confirm('A patient with the same name and date of birth already exists. Save anyway?');
        } catch(e) {
            return true;
        }
    }


    async function savePatient(options) {
        options = options || {};
        const addRxAfterSave = options.addRxAfterSave === true || options.addRxAfterCreate === true;
        const btn = document.getElementById('savePatientBtn');
        const spinner = document.getElementById('savePatientSpinner');
        const addRxBtn = document.getElementById('savePatientAddRxBtn');
        const addRxSpinner = document.getElementById('savePatientAddRxSpinner');
        const editingIdAtSave = editingPatientId;
        const serviceDateChangedForRx = !!editingIdAtSave && patientServiceDateChangedForAddRx();
        if (addRxAfterSave && !canAddRxAfterPatientCreate()) {
            showToast('You do not have permission to add RX records.', 'warning');
            return;
        }
        if (addRxAfterSave && editingIdAtSave && !serviceDateChangedForRx) {
            showToast('Change the service date before adding a new RX for this patient.', 'warning');
            return;
        }
        btn.disabled = true;
        if (addRxBtn) addRxBtn.disabled = true;
        if (addRxAfterSave && addRxSpinner) {
            addRxSpinner.classList.remove('d-none');
        } else {
            spinner.classList.remove('d-none');
        }
        const patientCodeVal = document.getElementById('pPatientCode').value.trim();
        const body = {
            patientCode: patientCodeVal || undefined,
            firstName: normalizeName(document.getElementById('pFirstName').value),
            lastName: normalizeName(document.getElementById('pLastName').value),
            dob: document.getElementById('pDob').value,
            phone: document.getElementById('pPhone').value.trim(),
            serviceDate: document.getElementById('pServiceDate').value || null,
            address: document.getElementById('pAddress').value.trim(),
            notes: document.getElementById('pNotes').value.trim(),
            isActive: document.getElementById('pIsActive').checked,
            isNonCompanyPatient: document.getElementById('pIsNonCompanyPatient').checked,
            patientTransportCompanyId: document.getElementById('pPatientTransport').value || null,
            pharmacyTransportCompanyId: document.getElementById('pPharmacyTransport').value || null,
            clinicId: document.getElementById('pClinicId').value || null,
            pharmacyId: document.getElementById('pPharmacyId').value || null
        };
        try {
            const shouldContinue = await shouldContinuePatientCreate(body);
            if (!shouldContinue) return;

            const url = editingPatientId ? '/api/patients/' + editingPatientId : '/api/patients';
            const method = editingPatientId ? 'PUT' : 'POST';
            const res = await fetchWithAuth(url, { method, body: JSON.stringify(body) });
            if (!res) return;
            if (res.ok) {
                let savedPatient = null;
                try { savedPatient = await res.json(); } catch(e) {}
                bootstrap.Modal.getInstance(document.getElementById('patientModal')).hide();
                const wasCreating = !editingIdAtSave;
                showToast(editingPatientId ? 'Patient updated!' : 'Patient created!', 'success');
                await loadPatients();
                if (addRxAfterSave && (wasCreating || serviceDateChangedForRx) && savedPatient && savedPatient.id) {
                    const first = savedPatient.firstName || body.firstName || '';
                    const last = savedPatient.lastName || body.lastName || '';
                    const fullName = (first + ' ' + last).trim();
                    const rxPath = '/rx-records?patient=' + encodeURIComponent(savedPatient.id) +
                        '&name=' + encodeURIComponent(fullName) +
                        '&addRx=1';
                    if (typeof window.rxNav === 'function') window.rxNav(rxPath);
                    else window.location.href = rxPath;
                }
            } else {
                const err = await res.json();
                showToast(err.error || err.message || 'Save failed.', 'danger');
            }
        } catch(e) { showToast('Network error.', 'danger'); }
        finally {
            btn.disabled = false;
            if (addRxBtn) addRxBtn.disabled = false;
            spinner.classList.add('d-none');
            if (addRxSpinner) addRxSpinner.classList.add('d-none');
        }
    }

    function promptDeletePatient(id) {
        deletingPatientId = id;
        const patient = allPatients.find(p => p.id === id);
        var fullName = (patient.firstName||'') + ' ' + (patient.lastName||'');
        document.getElementById('deleteConfirmNameText').textContent = fullName;
        const input = document.getElementById('deleteConfirmInput');
        input.value = '';
        input.setAttribute('data-expected-name', fullName);
        document.getElementById('confirmDeleteBtn').disabled = true;
        new bootstrap.Modal(document.getElementById('deleteModal')).show();
    }

    function checkDeleteConfirmation() {
        const input = document.getElementById('deleteConfirmInput');
        const expected = input.getAttribute('data-expected-name');
        const btn = document.getElementById('confirmDeleteBtn');
        if (input.value.trim() === expected) {
            btn.disabled = false;
        } else {
            btn.disabled = true;
        }
    }

    async function deletePatient() {
        var _uDel = '/api/patients/' + deletingPatientId;
        const res = await fetchWithAuth(_uDel, { method: 'DELETE' });
        if (!res) return;
        if (res.ok || res.status === 204) {
            bootstrap.Modal.getInstance(document.getElementById('deleteModal')).hide();
            showToast('Patient deleted.', 'success');
            await loadPatients();
        } else {
            const err = await res.json();
            showToast(err.error || 'Delete failed.', 'danger');
        }
    }

    // â”€â”€ Patient Notes â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    var notesPatientId = null;
    var notesModal = null;

    // Helper: read patient_notes permission from current user's stored perms
    function getNotesPerms() {
        try {
            const u = JSON.parse(localStorage.getItem('user') || '{}');
            // Admins and Supervisors always have full note access
            if (u.role === 'Administrator' || u.role === 'Supervisor') {
                return { canAdd: true, canEdit: true, canDelete: true };
            }
            const np = (u.permissions || {}).patient_notes || {};
            return {
                canAdd:    np.canAdd    !== undefined ? !!np.canAdd    : !!np.canEdit, // fallback
                canEdit:   np.canEdit   !== undefined ? !!np.canEdit   : false,
                canDelete: np.canDelete !== undefined ? !!np.canDelete : false
            };
        } catch(e) { return { canAdd: true, canEdit: true, canDelete: false }; }
    }

    async function openNotesModal(patientId, patientName) {
        notesPatientId = patientId;
        document.getElementById('notesPatientName').textContent = patientName || ('Patient #' + patientId);
        document.getElementById('newNoteText').value = '';
        document.getElementById('notesListContainer').innerHTML = '<p class="text-center text-muted py-3"><i class="fas fa-spinner fa-spin me-1"></i> Loading...</p>';

        // Apply add-note permission
        const np = getNotesPerms();
        const addArea = document.getElementById('noteAddArea');
        if (addArea) addArea.style.display = np.canAdd ? '' : 'none';

        if (!notesModal) {
            notesModal = new bootstrap.Modal(document.getElementById('patientNotesModal'));
            document.getElementById('addNoteBtn').addEventListener('click', addNote);
            document.getElementById('newNoteText').addEventListener('keydown', function(e) {
                if (e.ctrlKey && e.key === 'Enter') addNote();
            });
        }
        notesModal.show();
        await loadNotes();
    }

    async function loadNotes() {
        try {
            var _uNotes = '/api/patients/' + notesPatientId + '/notes';
        const res = await fetchWithAuth(_uNotes);
            if (!res) return;
            const notes = await res.json();
            renderNotes(notes);
        } catch(e) {
            document.getElementById('notesListContainer').innerHTML = '<p class="text-danger text-center py-3">Error loading notes.</p>';
        }
    }

    function renderNotes(notes) {
        const container = document.getElementById('notesListContainer');
        const countLabel = document.getElementById('notesCountLabel');
        const currentUser = JSON.parse(localStorage.getItem('user') || '{}');
        const np = getNotesPerms();

        countLabel.textContent = notes.length + ' note' + (notes.length !== 1 ? 's' : '');
        if (!notes.length) {
            const np2 = getNotesPerms();
            container.innerHTML = '<p class="text-center text-muted py-3"><i class="fas fa-comment-slash me-1"></i>' +
                (np2.canAdd ? 'No notes yet. Add the first one above.' : 'No notes yet.') + '</p>';
            return;
        }
        var _notesHtml=''; for(var _ni=0;_ni<notes.length;_ni++){var n=notes[_ni]; _notesHtml+=(function(){
            const author = n.Author ? (n.Author.firstName + ' ' + n.Author.lastName) : 'System';
            const dt = new Date(n.createdAt);
            const dateStr = dt.toLocaleDateString() + ' ' + dt.toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'});
            // Strictly enforce canDelete â€” no author bypass
            const canDel = np.canDelete;

            let delBtn = '';
            if (canDel) {
                delBtn = '<button class="btn btn-sm btn-outline-danger py-0 px-2" onclick="deleteNote(' + n.id + ')" title="Delete note"><i class="fas fa-trash-alt" style="font-size:.7rem"></i></button>';
            } else {
                delBtn = '<span class="text-muted" title="You don\'t have permission to delete notes" data-bs-toggle="tooltip"><i class="fas fa-lock" style="font-size:.75rem;opacity:.5"></i></span>';
            }

            return '<div class="card mb-2 border-0" id="note-' + n.id + '" style="background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1) !important;border-radius:8px">' +
                '<div class="card-body py-2 px-3">' +
                    '<div class="d-flex justify-content-between align-items-start gap-2">' +
                        '<div style="min-width:0"><span class="badge bg-secondary me-1">' + author + '</span><small class="text-muted">' + dateStr + '</small></div>' +
                        '<div class="flex-shrink-0">' + delBtn + '</div>' +
                    '</div>' +
                    '<p class="mb-0 mt-2" style="white-space:pre-wrap;font-size:.9rem">' + n.note.replace(/</g,'&lt;').replace(/>/g,'&gt;') + '</p>' +
                '</div>' +
            '</div>';
        })(); } container.innerHTML = _notesHtml;

        // Activate Bootstrap tooltips on lock icons
        container.querySelectorAll('[data-bs-toggle="tooltip"]').forEach(el => {
            if (typeof bootstrap !== 'undefined') new bootstrap.Tooltip(el, {trigger:'hover'});
        });
    }

    async function addNote() {
        const np = getNotesPerms();
        if (!np.canAdd) { showToast('You do not have permission to add notes.', 'warning'); return; }
        const text = document.getElementById('newNoteText').value.trim();
        if (!text) { showToast('Please enter a note.', 'warning'); return; }
        const btn = document.getElementById('addNoteBtn');
        btn.disabled = true;
        try {
            var _uNotePost = '/api/patients/' + notesPatientId + '/notes';
        const res = await fetchWithAuth(_uNotePost, {
                method: 'POST', body: JSON.stringify({ note: text })
            });
            if (res && res.ok) {
                document.getElementById('newNoteText').value = '';
                showToast('Note added.', 'success');
                await loadNotes();
            } else if (res) {
                const err = await res.json();
                showToast(err.error || 'Failed to add note.', 'danger');
            }
        } catch(e) { showToast('Network error.', 'danger'); }
        finally { btn.disabled = false; }
    }

    async function deleteNote(noteId) {
        if (!confirm('Delete this note?')) return;
        try {
            var _uNoteDel = '/api/patients/' + notesPatientId + '/notes/' + noteId;
            const res = await fetchWithAuth(_uNoteDel, { method: 'DELETE' });
            if (res && (res.ok || res.status === 204)) {
                showToast('Note deleted.', 'success');
                await loadNotes();
            } else if (res) {
                const err = await res.json();
                showToast(err.error || 'Delete failed.', 'danger');
            }
        } catch(e) { showToast('Network error.', 'danger'); }
    }
    // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    async function restorePatient(id) {
        if (!confirm('Are you sure you want to restore this patient?')) return;
        try {
            var _uRestore = '/api/patients/' + id + '/restore';
        const res = await fetchWithAuth(_uRestore, { method: 'PUT' });
            if (res.ok) {
                showToast('Patient restored successfully.', 'success');
                await loadPatients();
            } else {
                const err = await res.json();
                showToast(err.error || 'Restore failed.', 'danger');
            }
        } catch (e) {
            showToast('Network error.', 'danger');
        }
    }

    // ---- Print / PDF ----
    var _printPatientData = null;
    var _printLayout = 'card'; // 'card' or 'classic'

    // Listen to toggle changes
    document.addEventListener('DOMContentLoaded', function() {
        document.querySelectorAll('input[name="printLayout"]').forEach(function(radio) {
            radio.addEventListener('change', function() {
                _printLayout = this.value;
                if (_printPatientData) switchPrintLayout();
            });
        });
    });

    function switchPrintLayout() {
        const body = document.getElementById('patientPrintBody');
        const card    = document.getElementById('printContentCard');
        const classic = document.getElementById('printContentClassic');
        if (!card || !classic) return;
        if (_printLayout === 'card') {
            card.style.display    = '';
            classic.style.display = 'none';
            body.style.background = '#f0f2f5';
        } else {
            card.style.display    = 'none';
            classic.style.display = '';
            body.style.background = '#fff';
        }
    }

    async function printPatientRecord(id) {
        const body = document.getElementById('patientPrintBody');
        body.innerHTML = '<p class="text-center text-muted py-5"><i class="fas fa-spinner fa-spin me-2"></i>Loading record...</p>';
        // Reset toggle to Card
        _printLayout = 'card';
        const cardRadio = document.getElementById('layoutCard');
        if (cardRadio) cardRadio.checked = true;
        const modal = new bootstrap.Modal(document.getElementById('patientPrintModal'));
        modal.show();

        var _uPat = '/api/patients/' + id;
        var _uWa  = '/api/lookup/workflow-actions';
        const pRes  = await fetchWithAuth(_uPat);
        const rxRes = await fetchWithAuth('/api/rx-records?includeDeleted=false');
        const waRes = await fetchWithAuth(_uWa, { silent: true });
        
        if (!pRes || !pRes.ok) { body.innerHTML = '<p class="text-danger text-center py-4">Failed to load patient record.</p>'; return; }
        const p     = await pRes.json();
        const allRx = rxRes && rxRes.ok  ? await rxRes.json() : [];
        const allWA = waRes && waRes.ok  ? await waRes.json() : [];
        const patientRx = allRx.filter(r => r.patientId === id);
        _printPatientData = { patient: p, rxRecords: patientRx };

        const isActive  = p.isActive;
        const clinic    = p.Clinic ? p.Clinic.name : '\u2014';
        const ptComp    = p.PatientTransportCompany  ? (p.PatientTransportCompany.companyName  || p.PatientTransportCompany.contactPerson  || '\u2014') : '\u2014';
        const phComp    = p.PharmacyTransportCompany ? (p.PharmacyTransportCompany.companyName || p.PharmacyTransportCompany.contactPerson || '\u2014') : '\u2014';
        const printDate = new Date().toLocaleString();

        function fmtDt(d) {
            if (!d) return '';
            try { return new Date(d).toLocaleString('en-US', { month:'short', day:'numeric', year:'numeric', hour:'2-digit', minute:'2-digit' }); }
            catch(e) { return d; }
        }

        function buildRxBlock(rx, style) {
            const trackMap = {};
            (rx.RXWorkflowTrackings || []).forEach(t => { trackMap[t.workflowActionId] = t; });
            const completedCount = (rx.RXWorkflowTrackings || []).length;
            const totalSteps     = allWA.length;
            const pct            = totalSteps > 0 ? Math.round((completedCount / totalSteps) * 100) : 0;
            const statusColor    = pct >= 100 ? '#198754' : pct > 0 ? '#fd7e14' : '#6c757d';
            const statusLabel    = pct >= 100 ? 'Complete' : pct > 0 ? pct + '% Done' : 'Not Started';

            const ptrans  = rx.PatientTransportCompany  ? (rx.PatientTransportCompany.companyName  || rx.PatientTransportCompany.contactPerson)  : null;
            const phtrans = rx.PharmacyTransportCompany ? (rx.PharmacyTransportCompany.companyName || rx.PharmacyTransportCompany.contactPerson) : null;

            const actions = (rx.Medications || []);
            const actionsHtml = actions.length
                ? (function(){var _ax=''; actions.forEach(function(a){_ax+='<span style="display:inline-block;background:#e8f0fe;color:#1a2234;border-radius:4px;padding:1px 7px;font-size:.75rem;margin:1px 3px 1px 0">' + a.name + (a.quantity > 1 ? ' \u00d7'+a.quantity : '') + (a.notes ? ' \u2014 '+a.notes : '') + '</span>';}); return _ax;})()
                : '<span style="color:#888;font-size:.78rem">None recorded</span>';

            var wfHtml;
            if (allWA.length === 0) {
                wfHtml = '<tr><td colspan="3" style="color:#888;padding:4px 0;font-size:.78rem">No workflow steps defined.</td></tr>';
            } else {
                wfHtml = '';
                for (var _wfi = 0; _wfi < allWA.length; _wfi++) {
                    var wa = allWA[_wfi]; var idx = _wfi;
                    var t = trackMap[wa.id];
                    var done = !!t;
                    var dateStr = t && t.completionDate ? fmtDt(t.completionDate) : '';
                    var byStr = t && t.User ? ' \u2014 ' + t.User.firstName + ' ' + t.User.lastName : '';
                    wfHtml += '<tr>' +
                        '<td style="padding:3px 6px;width:20px;text-align:center">' +
                          '<span style="display:inline-block;width:16px;height:16px;border-radius:50%;background:' + (done?'#198754':'#dee2e6') + ';color:#fff;font-size:.62rem;line-height:16px;text-align:center">' + (done?'\u2713':'') + '</span>' +
                        '</td>' +
                        '<td style="padding:3px 6px;font-size:.8rem;color:' + (done?'#1a2234':'#888') + ';font-weight:' + (done?'600':'400') + '">' + (idx+1) + '. ' + wa.name + '</td>' +
                        '<td style="padding:3px 6px;font-size:.75rem;color:' + (done?'#1a2234':'#aaa') + ';white-space:nowrap">' + (done ? dateStr + byStr : 'Pending') + '</td>' +
                    '</tr>';
                }
            }

            if (style === 'card') {
                return '<div style="margin-bottom:20px;border:1px solid #e9ecef;border-radius:8px;overflow:hidden;font-size:.82rem">' +
                  '<div style="background:#1a2234;color:#fff;padding:8px 14px;display:flex;justify-content:space-between;align-items:center">' +
                    '<span style="font-weight:700;letter-spacing:.03em">RX Record #' + rx.id + '</span>' +
                    '<span style="background:' + statusColor + ';padding:2px 10px;border-radius:20px;font-size:.72rem;font-weight:600">' + statusLabel + '</span>' +
                  '</div>' +
                  '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;padding:10px 14px;border-bottom:1px solid #f0f0f0;background:#fafafa">' +
                    '<div><div style="font-size:.65rem;color:#888;text-transform:uppercase;font-weight:700">Arrival Date</div><div style="font-weight:600">' + (rx.arrivalDate||'\u2014') + '</div></div>' +
                    '<div><div style="font-size:.65rem;color:#888;text-transform:uppercase;font-weight:700">Service Date</div><div style="font-weight:600">' + (rx.serviceDate||'\u2014') + '</div></div>' +
                    '<div><div style="font-size:.65rem;color:#888;text-transform:uppercase;font-weight:700">Pharmacy</div><div style="font-weight:600">' + (rx.Pharmacy ? rx.Pharmacy.name : '\u2014') + '</div></div>' +
                    (ptrans  ? '<div><div style="font-size:.65rem;color:#888;text-transform:uppercase;font-weight:700">Patient Transport</div><div style="font-weight:600">' + ptrans  + '</div></div>' : '') +
                    (phtrans ? '<div><div style="font-size:.65rem;color:#888;text-transform:uppercase;font-weight:700">Pharmacy Transport</div><div style="font-weight:600">' + phtrans + '</div></div>' : '') +
                  '</div>' +
                  (actions.length ? '<div style="padding:6px 14px;border-bottom:1px solid #f0f0f0;background:#f8f9fa"><span style="font-size:.65rem;color:#888;text-transform:uppercase;font-weight:700;margin-right:6px">Actions:</span>' + actionsHtml + '</div>' : '') +
                  '<div style="padding:10px 14px">' +
                    '<div style="font-size:.65rem;color:#888;text-transform:uppercase;font-weight:700;margin-bottom:6px">Workflow Steps (' + completedCount + '/' + totalSteps + ')</div>' +
                    '<div style="background:#f8f9fa;border-radius:4px;overflow:hidden">' +
                      '<table style="width:100%;border-collapse:collapse">' + wfHtml + '</table>' +
                    '</div>' +
                  '</div>' +
                '</div>';
            } else {
                return '<tr>' +
                  '<td colspan="5" style="padding:0;border-bottom:2px solid #dee2e6;background:#ffffff">' +
                    '<table style="width:100%;border-collapse:collapse;font-size:.82rem;color:#1a2234;background:#ffffff">' +
                      '<tr style="background:#ffffff">' +
                        '<td style="padding:6px 8px;font-weight:700;color:#1a2234;background:#ffffff">#' + rx.id + '</td>' +
                        '<td style="padding:6px 8px;color:#1a2234;background:#ffffff">' + (window.fmtDate(rx.arrivalDate)||'\u2014') + '</td>' +
                        '<td style="padding:6px 8px;color:#1a2234;background:#ffffff">' + (window.fmtDate(rx.serviceDate)||'\u2014') + '</td>' +
                        '<td style="padding:6px 8px;color:#1a2234;background:#ffffff">' + (rx.Pharmacy ? rx.Pharmacy.name : '\u2014') + '</td>' +
                        '<td style="padding:6px 8px;background:#ffffff"><span style="background:' + statusColor + ';color:#fff;padding:1px 8px;border-radius:10px;font-size:.72rem">' + statusLabel + '</span></td>' +
                      '</tr>' +
                      (actions.length ? '<tr><td colspan="5" style="padding:3px 8px 3px 24px;background:#f5f5f5;font-size:.78rem;color:#1a2234"><strong>Actions:</strong> ' + actionsHtml + '</td></tr>' : '') +
                      '<tr><td colspan="5" style="padding:3px 8px 8px 8px;background:#ffffff"><table style="width:100%;border-collapse:collapse;color:#1a2234">' + wfHtml + '</table></td></tr>' +
                    '</table>' +
                  '</td>' +
                '</tr>';
            }
        }

        const statusBadge = isActive
            ? '<span style="background:#198754;color:#fff;padding:3px 10px;border-radius:12px;font-size:.75rem">Active</span>'
            : '<span style="background:#6c757d;color:#fff;padding:3px 10px;border-radius:12px;font-size:.75rem">Inactive</span>';

        // â”€â”€ CARD LAYOUT â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        const cardHTML =
        '<div id="printContentCard" style="font-family:\'Inter\',Arial,sans-serif;background:#fff;margin:20px;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.12)">' +
          '<div style="background:linear-gradient(135deg,#1a2234,#2c3e6b);color:#fff;padding:20px 28px;display:flex;justify-content:space-between;align-items:center">' +
            '<div>' +
              '<div style="font-size:1.4rem;font-weight:700;letter-spacing:-.01em">' + p.firstName + ' ' + p.lastName + '</div>' +
              '<div style="font-size:.85rem;opacity:.75;margin-top:3px">Home Accounting &nbsp;&middot;&nbsp; Generated: ' + printDate + '</div>' +
            '</div>' +
            '<div style="text-align:right">' +
              '<div style="font-size:1.2rem;font-weight:700;font-family:monospace">' + (p.patientCode||'\u2014') + '</div>' +
              '<div style="margin-top:6px"><span style="background:' + (isActive?'#198754':'#6c757d') + ';color:#fff;padding:3px 12px;border-radius:20px;font-size:.78rem;font-weight:600">' + (isActive?'â— Active':'â—‹ Inactive') + '</span></div>' +
            '</div>' +
          '</div>' +
          '<div style="padding:24px 28px;display:grid;grid-template-columns:1fr 1fr;gap:14px 32px;border-bottom:1px solid #e9ecef">' +
(function(){ var _fd=''; var _farr=[['ðŸ“… Date of Birth',(p.dob?window.fmtDate(p.dob):'\u2014')],['ðŸ“ž Phone',p.phone||'\u2014'],['ðŸ“… Service Date',(p.serviceDate?window.fmtDate(p.serviceDate):'\u2014')],['ðŸ¥ Clinic',clinic],['ðŸ  Address',p.address||'\u2014'],['ðŸš Patient Transport',ptComp],['ðŸ’Š Pharmacy Transport',phComp]]; for(var _fi=0;_fi<_farr.length;_fi++){ var r=_farr[_fi]; _fd+='<div><div style="font-size:.68rem;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:#888;margin-bottom:3px">'+r[0]+'</div><div style="font-size:.88rem">'+r[1]+'</div></div>'; } return _fd;})() +
          '</div>' +
          (p.notes ? '<div style="margin:16px 28px;padding:12px 16px;background:#fffbea;border-left:4px solid #f5a623;border-radius:4px;font-size:.85rem;color:#7a5800"><strong>ðŸ“ Notes:</strong><br>' + p.notes.replace(/\n/g,'<br>') + '</div>' : '') +
          '<div style="padding:0 28px 28px">' +
            '<div style="font-size:.8rem;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:#888;margin:20px 0 12px">RX Records (' + patientRx.length + ')</div>' +
            (patientRx.length ? (function(){var _rx=''; patientRx.forEach(function(rx){_rx+=buildRxBlock(rx,'card');}); return _rx;})() : '<p style="color:#888;font-size:.85rem">No RX records found.</p>') +
          '</div>' +
        '</div>';

        // â”€â”€ CLASSIC LAYOUT â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        const classicHTML =
        '<div id="printContentClassic" style="display:none;font-family:Inter,Arial,sans-serif;color:#1a2234;background:#ffffff;padding:28px;border-radius:8px;margin:12px">' +
          '<div style="display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #1a2234;padding-bottom:12px;margin-bottom:20px">' +
            '<div><h4 style="margin:0;color:#1a2234">Patient Record</h4><div style="font-size:.8rem;color:#666;margin-top:4px">Printed: ' + printDate + '</div></div>' +
            '<div style="text-align:right"><div style="font-size:1.1rem;font-weight:700;color:#1a2234">' + p.firstName + ' ' + p.lastName + ' ' + statusBadge + '</div><div style="color:#666;font-size:.85rem"><code style="color:#1a2234">' + (p.patientCode||'\u2014') + '</code></div></div>' +
          '</div>' +
          '<table style="width:100%;border-collapse:collapse;margin-bottom:24px;font-size:.875rem;color:#1a2234;background:#ffffff">' +
            '<tr><td style="width:50%;padding:6px 0;color:#1a2234;background:#ffffff"><strong>Date of Birth:</strong> '+(window.fmtDate(p.dob)||'\u2014')+'</td><td style="padding:6px 0;color:#1a2234;background:#ffffff"><strong>Phone:</strong> '+(p.phone||'\u2014')+'</td></tr>' +
            '<tr><td style="padding:6px 0;color:#1a2234;background:#ffffff"><strong>Service Date:</strong> '+(window.fmtDate(p.serviceDate)||'\u2014')+'</td><td style="padding:6px 0;color:#1a2234;background:#ffffff"><strong>Clinic:</strong> '+clinic+'</td></tr>' +
            '<tr><td style="padding:6px 0;color:#1a2234;background:#ffffff"><strong>Address:</strong> '+(p.address||'\u2014')+'</td><td style="padding:6px 0;color:#1a2234;background:#ffffff"><strong>Patient Transport:</strong> '+ptComp+'</td></tr>' +
            '<tr><td style="padding:6px 0;color:#1a2234;background:#ffffff"><strong>Pharmacy Transport:</strong> '+phComp+'</td><td style="background:#ffffff"></td></tr>' +
          '</table>' +
          (p.notes ? '<div style="background:#f8f9fa;border-left:3px solid #4a90e2;padding:10px 14px;border-radius:4px;margin-bottom:24px;font-size:.85rem;color:#1a2234"><strong>Notes:</strong><br>' + p.notes.replace(/\n/g,'<br>') + '</div>' : '') +
          '<h6 style="border-bottom:1px solid #dee2e6;padding-bottom:6px;margin-bottom:12px;color:#1a2234">RX Records (' + patientRx.length + ')</h6>' +
          (patientRx.length ?
            '<table style="width:100%;border-collapse:collapse;font-size:.82rem;color:#1a2234;background:#ffffff">' +
            '<thead><tr style="background:#1a2234;color:#fff">' +
              '<th style="padding:7px 8px;color:#fff">RX #</th><th style="padding:7px 8px;color:#fff">Arrival</th><th style="padding:7px 8px;color:#fff">Service</th><th style="padding:7px 8px;color:#fff">Pharmacy</th><th style="padding:7px 8px;color:#fff">Status</th>' +
            '</tr></thead>' +
            '<tbody>' + (patientRx.length ? (function(){var _rxc=''; patientRx.forEach(function(rx){_rxc+=buildRxBlock(rx,'classic');}); return _rxc;})() : '<tr><td colspan="5" style="text-align:center;color:#888;background:#fff">No RX records found.</td></tr>') + '</tbody>' +
            '</table>'
          : '<p style="color:#666">No RX records found.</p>') +
        '</div>';

        body.innerHTML = cardHTML + classicHTML;
        body.style.background = '#f0f2f5';
    }

    function doPrint() {
        if (!_printPatientData) return;
        const p = _printPatientData.patient;
        // Get the active content element
        const contentId = _printLayout === 'card' ? 'printContentCard' : 'printContentClassic';
        const body = document.getElementById(contentId);
        if (!body) return;

        const win = window.open('', '_blank', 'width=900,height=750');
        if (_printLayout === 'card') {
            win.document.write('<!DOCTYPE html><html><head>' +
                '<meta charset="UTF-8">' +
                '<meta http-equiv="Content-Type" content="text/html; charset=UTF-8">' +
                '<title>Patient Record â€” ' + (p.firstName||'') + ' ' + (p.lastName||'') + '</title>' +
                '<style>' +
                    '@import url("/assets/inter.css");' +
                    '* { box-sizing:border-box; margin:0; padding:0; }' +
                    'body { font-family:Inter,Arial,sans-serif; background:#f0f2f5; padding:32px; }' +
                    '#printContentCard { background:#fff; border-radius:12px; overflow:hidden; box-shadow:0 2px 16px rgba(0,0,0,.1); }' +
                    '@media print {' +
                        '@page { margin:15mm; size:A4 portrait; }' +
                        'body { background:#fff; padding:0; }' +
                        '#printContentCard { box-shadow:none; border-radius:0; }' +
                        'thead tr { -webkit-print-color-adjust:exact !important; print-color-adjust:exact !important; }' +
                    '}' +
                '</style></head>' +
                '<body>' + body.outerHTML +
                '<script>window.onload=function(){window.print();}' + '<\/script>' +
                '</body></html>');
        } else {
            win.document.write('<!DOCTYPE html><html><head>' +
                '<meta charset="UTF-8">' +
                '<meta http-equiv="Content-Type" content="text/html; charset=UTF-8">' +
                '<title>Patient Record â€” ' + (p.firstName||'') + ' ' + (p.lastName||'') + '</title>' +
                '<style>' +
                    '@import url("/assets/inter.css");' +
                    'body { font-family:Inter,Arial,sans-serif; color:#1a2234; padding:32px; max-width:860px; margin:0 auto; }' +
                    'table { width:100%; border-collapse:collapse; }' +
                    'thead tr { background:#1a2234 !important; color:#fff !important; -webkit-print-color-adjust:exact; print-color-adjust:exact; }' +
                    'th,td { padding:7px 10px; text-align:left; border-bottom:1px solid #dee2e6; }' +
                    '@media print { @page { margin:20mm; } body { padding:0; } }' +
                '</style></head>' +
                '<body>' + body.outerHTML +
                '<script>window.onload=function(){window.print();}' + '<\/script>' +
                '</body></html>');
        }
        win.document.close();
        win.focus();
    }

    // \u2500\u2500 Advanced Filter Helpers \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
    var _advancedOpen = false;

    function toggleAdvancedFilters() {
        _advancedOpen = !_advancedOpen;
        const row = document.getElementById('advancedFilterRow');
        const chevron = document.getElementById('advancedChevron');
        row.style.display = _advancedOpen ? '' : 'none';
        chevron.className = _advancedOpen ? 'fas fa-chevron-up ms-1' : 'fas fa-chevron-down ms-1';
    }

    function liveFilter() {
        applyPatientSearch();
        renderPatients();
    }

    function updateFilterBadge() {
        const advancedIds = ['srchPatientCode','srchPatientTransport','srchPharmacyTransport','srchServiceFrom','srchServiceTo','srchEligibility'];
        const basicIds    = ['srchFirstName','srchLastName','srchDob','srchPhone'];
        const statusEl    = document.getElementById('srchStatus');
        const clinicEl    = document.getElementById('srchClinic');

        let count = 0;
        [...advancedIds, ...basicIds].forEach(id => {
            const el = document.getElementById(id);
            if (el && el.value) count++;
        });
        if (statusEl && statusEl.value) count++;
        if (clinicEl && clinicEl.value) count++;

        const badge = document.getElementById('activeFilterBadge');
        if (badge) {
            if (count > 0) {
                badge.textContent = count + ' filter' + (count > 1 ? 's' : '');
                badge.style.cssText = 'font-size:.7rem';  // clear display:none!important
                badge.removeAttribute('style');
                badge.style.display = 'inline-block';
                badge.style.fontSize = '.7rem';
            } else {
                badge.style.display = 'none';
            }
        }

        // Auto-expand advanced panel if any advanced filter is active
        const hasAdvanced = advancedIds.some(id => {
            const el = document.getElementById(id);
            return el && el.value;
        });
        if (hasAdvanced && !_advancedOpen) toggleAdvancedFilters();

        // Render chips
        const chipsEl = document.getElementById('activeFilterChips');
        if (!chipsEl) return;
        const CHIP_LABELS = {
            srchFirstName: 'First Name', srchLastName: 'Last Name', srchDob: 'DOB',
            srchPhone: 'Phone', srchStatus: 'Status', srchClinic: 'Clinic',
            srchPatientCode: 'Patient ID', srchPatientTransport: 'Patient Transport',
            srchPharmacyTransport: 'Pharmacy Transport', srchServiceFrom: 'From',
            srchServiceTo: 'To', srchEligibility: '90-Day Eligibility'
        };
        var _chipIds = [...basicIds, ...advancedIds, 'srchStatus','srchClinic']
            .filter(id => { const el = document.getElementById(id); return el && el.value; });
        var _chHtml = '';
        for(var _chi=0;_chi<_chipIds.length;_chi++){var id=_chipIds[_chi]; _chHtml+=(function(){
                const el  = document.getElementById(id);
                const val = el.tagName === 'SELECT' ? el.options[el.selectedIndex].text : el.value;
                return '<span class="badge" style="background:rgba(74,144,226,.12);color:#4a90e2;font-size:.72rem;font-weight:500;border:1px solid rgba(74,144,226,.25);border-radius:20px;padding:3px 10px">' +
                    (CHIP_LABELS[id]||id) + ': ' + val +
                    '<i class="fas fa-times ms-1" style="cursor:pointer" onclick="clearOneFilter(\'' + id + '\')"></i>' +
                '</span>';
            })(); } chipsEl.innerHTML = _chHtml;
    }

    function clearOneFilter(id) {
        const el = document.getElementById(id);
        if (el) el.value = '';
        liveFilter();
    }

