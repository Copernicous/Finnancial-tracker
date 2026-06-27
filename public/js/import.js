// import.js — Extracted from inline script.
// FortiGate .map().join() corruption fix applied.

    let currentDataset = 'patients';
    let parsedRows  = [];
    let validRows   = [];
    let invalidRows = [];

    const DATASET_SPECS = {
        'patients': {
            title: 'Patients Import',
            desc: 'Import patients with validation. The template includes headers and an example row you can edit. Duplicate patient names matching identical birth dates will be skipped. Transport company columns can use either active company names or database IDs. Patient ID (patientCode) is optional — one will be auto-generated if left blank.',
            fields: [
                { name: 'patientCode', req: false, format: 'e.g. PAT-00001 (Auto-generated if blank)' },
                { name: 'firstName',   req: true,  format: 'Plain Text' },
                { name: 'lastName',    req: true,  format: 'Plain Text' },
                { name: 'dob',         req: true,  format: 'MM/DD/YYYY (e.g. 05/15/1985)' },
                { name: 'phone',       req: false, format: '123-456-7890' },
                { name: 'address',     req: false, format: 'Street, City' },
                { name: 'clinic',      req: false, format: 'Clinic Name or ID' },
                { name: 'serviceDate', req: false, format: 'MM/DD/YYYY (e.g. 01/01/2026)' },
                { name: 'patientTransportCompany',  req: false, format: 'Contact, Company Name, or ID' },
                { name: 'pharmacyTransportCompany', req: false, format: 'Contact, Company Name, or ID' },
                { name: 'notes',    req: false, format: 'Plain Text' },
                { name: 'isActive', req: false, format: 'true/false (Default: true)' },
                { name: 'RX Received Warehouse', req: false, format: 'MM/DD/YYYY (e.g. 06/24/2026)' },
                { name: 'On Route with Driver', req: false, format: 'MM/DD/YYYY (e.g. 06/24/2026)' },
                { name: 'Delivered', req: false, format: 'MM/DD/YYYY (e.g. 06/24/2026)' },
                { name: 'Mark as Received to print log', req: false, format: 'MM/DD/YYYY (e.g. 06/24/2026)' },
                { name: 'Signed by Pharmacy', req: false, format: 'MM/DD/YYYY (e.g. 06/24/2026)' },
                { name: 'Archived on local and case close', req: false, format: 'MM/DD/YYYY (e.g. 06/24/2026)' }
            ],
            dateFields: [
                'dob',
                'serviceDate',
                'RX Received Warehouse',
                'On Route with Driver',
                'Delivered',
                'Mark as Received to print log',
                'Signed by Pharmacy',
                'Archived on local and case close'
            ],
            requiredFields: ['firstName','lastName','dob']
        },
        'pharmacies': {
            title: 'Pharmacies Import',
            desc: 'Import pharmacy details. Duplicate pharmacy names will be skipped.',
            fields: [
                { name: 'name',          req: true,  format: 'Plain Text' },
                { name: 'address',       req: false, format: 'Street, City' },
                { name: 'phone',         req: false, format: 'Phone Number' },
                { name: 'contactPerson', req: false, format: 'Contact Name' },
                { name: 'notes',         req: false, format: 'Plain Text' },
                { name: 'isActive',      req: false, format: 'true/false (Default: true)' }
            ],
            dateFields: [],
            requiredFields: ['name']
        },
        'clinics': {
            title: 'Clinics Import',
            desc: 'Import clinic details. Duplicate clinic names will be skipped.',
            fields: [
                { name: 'name',          req: true,  format: 'Plain Text' },
                { name: 'address',       req: false, format: 'Street, City' },
                { name: 'phone',         req: false, format: 'Phone Number' },
                { name: 'contactPerson', req: false, format: 'Contact Name' },
                { name: 'notes',         req: false, format: 'Plain Text' },
                { name: 'isActive',      req: false, format: 'true/false (Default: true)' }
            ],
            dateFields: [],
            requiredFields: ['name']
        },
        'patient-transport': {
            title: 'Patient Transport Companies Import',
            desc: 'Import companies that deliver patients. Duplicate contact persons will be skipped if company name is missing.',
            fields: [
                { name: 'companyName',   req: false, format: 'Plain Text' },
                { name: 'phone',         req: false, format: 'Phone Number' },
                { name: 'contactPerson', req: true,  format: 'Contact Name' },
                { name: 'notes',         req: false, format: 'Plain Text' },
                { name: 'isActive',      req: false, format: 'true/false (Default: true)' }
            ],
            dateFields: [],
            requiredFields: ['contactPerson']
        },
        'pharmacy-transport': {
            title: 'Pharmacy Transport Companies Import',
            desc: 'Import companies that deliver from pharmacies. Duplicate company names will be skipped.',
            fields: [
                { name: 'companyName',   req: true,  format: 'Plain Text' },
                { name: 'phone',         req: false, format: 'Phone Number' },
                { name: 'contactPerson', req: false, format: 'Contact Name (optional)' },
                { name: 'notes',         req: false, format: 'Plain Text' },
                { name: 'isActive',      req: false, format: 'true/false (Default: true)' }
            ],
            dateFields: [],
            requiredFields: ['companyName']
        },
        'workflow-actions': {
            title: 'Workflow Actions Import',
            desc: 'Import state stages for rx tracking. Both action names and sequence numbers must be globally unique.',
            fields: [
                { name: 'name',           req: true,  format: 'Plain Text' },
                { name: 'description',    req: false, format: 'Plain Text' },
                { name: 'sequenceNumber', req: true,  format: 'Integer (Unique)' },
                { name: 'isActive',       req: false, format: 'true/false (Default: true)' }
            ],
            dateFields: [],
            requiredFields: ['name','sequenceNumber']
        },
        'users': {
            title: 'Users Import',
            desc: 'Import system operator profiles. Username and email must be unique. Passwords will be automatically encrypted.',
            fields: [
                { name: 'firstName', req: true,  format: 'Plain Text' },
                { name: 'lastName',  req: true,  format: 'Plain Text' },
                { name: 'username',  req: true,  format: 'Unique string' },
                { name: 'email',     req: true,  format: 'name@domain.com' },
                { name: 'password',  req: true,  format: 'Secure password text' },
                { name: 'role',      req: true,  format: 'Administrator | Supervisor | Operator | Read Only  (or ID: 1 / 2 / 3 / 4)' },
                { name: 'notes',     req: false, format: 'Optional description or note about this user' },
                { name: 'isActive',  req: false, format: 'true/false (Default: true)' }
            ],
            dateFields: [],
            requiredFields: ['firstName','lastName','username','email','password','role']
        }
    };

    document.addEventListener('DOMContentLoaded', () => {
        initApp();

        const user = JSON.parse(localStorage.getItem('user') || '{}');
        const allowedRoles = ['Administrator', 'Supervisor'];
        if (!user.role || !allowedRoles.includes(user.role)) {
            document.getElementById('accessDeniedPanel').classList.remove('d-none');
        } else {
            document.getElementById('importPanel').classList.remove('d-none');
            selectDataset('patients');
        }

        const dropZone = document.getElementById('dropZone');
        dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.style.borderColor = 'var(--primary)'; });
        dropZone.addEventListener('dragleave', () => { dropZone.style.borderColor = 'var(--border)'; });
        dropZone.addEventListener('drop', (e) => {
            e.preventDefault();
            dropZone.style.borderColor = 'var(--border)';
            if (e.dataTransfer.files.length) {
                const input = document.getElementById('csvFile');
                input.files = e.dataTransfer.files;
                fileSelected(input);
            }
        });

        document.getElementById('importForm').addEventListener('submit', executeImport);
        document.getElementById('downloadTemplateBtn').addEventListener('click', downloadTemplate);
        document.getElementById('confirmImportBtn').addEventListener('click', confirmImport);
        document.getElementById('cancelPreviewBtn').addEventListener('click', () => {
            document.getElementById('previewSection').classList.add('d-none');
            document.getElementById('uploadBtn').disabled = false;
        });
    });

    function selectDataset(dataset) {
        currentDataset = dataset;
        const spec = DATASET_SPECS[dataset];
        document.getElementById('datasetNameTitle').textContent = spec.title;
        document.getElementById('datasetDescription').textContent = spec.desc;
        const tbody = document.getElementById('csvFieldsBody');
        var _sf=''; spec.fields.forEach(function(f){
            _sf += '<tr><td><code>' + f.name + '</code></td>' +
            '<td><span class="badge ' + (f.req ? 'bg-danger' : 'bg-secondary') + '">' + (f.req ? 'Yes' : 'No') + '</span></td>' +
            '<td class="text-muted">' + f.format + '</td></tr>'

        });
        tbody.innerHTML = _sf;
        document.getElementById('csvFile').value = '';
        document.getElementById('fileNameDisplay').classList.add('d-none');
        document.getElementById('uploadBtn').disabled = true;
        document.getElementById('resultsBox').style.display = 'none';
        document.getElementById('previewSection').classList.add('d-none');
        parsedRows = []; validRows = []; invalidRows = [];
    }

    function fileSelected(input) {
        const file = input.files[0];
        const display = document.getElementById('fileNameDisplay');
        const uploadBtn = document.getElementById('uploadBtn');
        if (file) {
            display.textContent = 'Selected: ' + file.name + ' (' + (file.size / 1024).toFixed(1) + ' KB)';
            display.classList.remove('d-none');
            uploadBtn.disabled = false;
        } else {
            display.classList.add('d-none');
            uploadBtn.disabled = true;
        }
        document.getElementById('previewSection').classList.add('d-none');
        document.getElementById('resultsBox').style.display = 'none';
    }

    // ---- CSV Parser ----
    function parseCSV(text) {
        const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n').filter(l => l.trim());
        if (lines.length < 2) return { headers: [], rows: [] };
        const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
        const rows = lines.slice(1).map((line, i) => {
            const values = line.match(/(".*?"|[^,]+|(?<=,)(?=,)|(?<=,)$|^(?=,))/g) || line.split(',');
            const obj = { _rowNum: i + 2 };
            headers.forEach((h, idx) => { obj[h] = (values[idx] || '').trim().replace(/^"|"$/g, ''); });
            return obj;
        });
        return { headers, rows };
    }

    // ---- Client-side Validator ----
    function validateRows(rows) {
        const spec     = DATASET_SPECS[currentDataset];
        const required = spec.requiredFields || [];
        const dateFlds = spec.dateFields || [];
        // Accept MM/DD/YYYY or YYYY-MM-DD
        const dateRe   = /^(\d{1,2}\/\d{1,2}\/\d{4}|\d{4}-\d{2}-\d{2})$/;
        const emailRe  = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

        return rows.map(row => {
            const errors = [];
            required.forEach(f => { if (!row[f] || !row[f].trim()) errors.push('"' + f + '" is required'); });
            dateFlds.forEach(f => { if (row[f] && !dateRe.test(row[f].trim())) errors.push('"' + f + '" must be MM/DD/YYYY'); });
            if (currentDataset === 'users' && row.email && !emailRe.test(row.email)) errors.push('"email" format invalid');
            if (currentDataset === 'workflow-actions' && row.sequenceNumber && isNaN(parseInt(row.sequenceNumber))) errors.push('"sequenceNumber" must be an integer');
            return { ...row, _errors: errors };
        });
    }

    // ---- Execute Import: preview first ----
    async function executeImport(e) {
        e.preventDefault();
        const fileInput = document.getElementById('csvFile');
        const file = fileInput.files[0];
        if (!file) return;

        const uploadBtn = document.getElementById('uploadBtn');
        uploadBtn.disabled = true;

        const text = await file.text();
        const { headers, rows } = parseCSV(text);

        if (!rows.length) {
            showToast('CSV file appears empty or has no data rows.', 'warning');
            uploadBtn.disabled = false;
            return;
        }

        const validated = validateRows(rows);
        validRows   = validated.filter(r => !r._errors.length);
        invalidRows = validated.filter(r =>  r._errors.length);
        parsedRows  = validated;

        renderPreview(headers, validated);
    }

    function renderPreview(headers, rows) {
        const section    = document.getElementById('previewSection');
        const badge      = document.getElementById('previewBadge');
        const countEl    = document.getElementById('previewCount');
        const tHead      = document.getElementById('previewHead');
        const tBody      = document.getElementById('previewBody');
        const errSect    = document.getElementById('previewErrors');
        const errList    = document.getElementById('previewErrorList');
        const confirmBtn = document.getElementById('confirmImportBtn');

        const total   = rows.length;
        const errCnt  = invalidRows.length;
        const goodCnt = validRows.length;

        badge.textContent   = errCnt > 0 ? errCnt + ' row(s) with errors' : 'All rows valid';
        badge.className     = 'badge ' + (errCnt > 0 ? 'bg-warning text-dark' : 'bg-success');
        countEl.textContent = total + ' rows found — ' + goodCnt + ' valid, ' + errCnt + ' with errors';

        tHead.innerHTML = '<tr>' + (function(){var _hh=''; for(var _i=0;_i<headers.length;_i++){_hh+='<th class="text-nowrap">' + headers[_i] + '</th>';} return _hh;})() + '<th>Status</th></tr>';

        var _rows200=rows.slice(0,200); var _impHtml=''; for(var _ii=0;_ii<_rows200.length;_ii++){var row=_rows200[_ii]; _impHtml+=(function(){
            const hasErr   = row._errors.length > 0;
            const rowClass = hasErr ? 'table-danger' : 'table-success';
            var _cells=''; for(var _ci=0;_ci<headers.length;_ci++){var h=headers[_ci]; _cells+='<td>' + (row[h] || '<span class="text-muted">—</span>') + '</td>';} var cells=_cells;
            const status   = hasErr
                ? '<td><span class="badge bg-danger" title="' + row._errors.join('; ') + '">⚠ ' + row._errors.length + ' error(s)</span></td>'
                : '<td><span class="badge bg-success">✓ Valid</span></td>';
            return '<tr class="' + rowClass + '">' + cells + status + '</tr>';
        })(); } tBody.innerHTML=_impHtml;

        if (rows.length > 200) {
            tBody.innerHTML += '<tr><td colspan="' + (headers.length + 1) + '" class="text-center text-muted py-2">...and ' + (rows.length - 200) + ' more rows (not shown)</td></tr>';
        }

        if (errCnt > 0) {
            errSect.classList.remove('d-none');
            var _er=''; invalidRows.forEach(function(row){ _er +=
                '<div class="py-1 border-bottom"><strong class="text-danger">Row ' + row._rowNum + ':</strong> ' + row._errors.join(', ') + '</div>'
;
            }); errList.innerHTML = _er;
        } else {
            errSect.classList.add('d-none');
        }

        confirmBtn.disabled    = invalidRows.length > 0 || goodCnt === 0;
        if (invalidRows.length > 0) {
            confirmBtn.textContent = 'Fix ' + invalidRows.length + ' error(s) to continue';
            confirmBtn.className   = 'btn btn-danger btn-sm';
        } else if (goodCnt === 0) {
            confirmBtn.textContent = 'No valid rows to import';
            confirmBtn.className   = 'btn btn-secondary btn-sm';
        } else {
            confirmBtn.textContent = 'Import All ' + goodCnt + ' Rows';
            confirmBtn.className   = 'btn btn-success btn-sm';
        }

        section.classList.remove('d-none');
        section.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    // ---- Confirm: send to server ----
    async function confirmImport() {
        const confirmBtn = document.getElementById('confirmImportBtn');
        const cancelBtn  = document.getElementById('cancelPreviewBtn');
        confirmBtn.disabled = true;
        cancelBtn.disabled  = true;
        confirmBtn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Importing...';

        try {
            const token    = localStorage.getItem('token');
            const fileInput = document.getElementById('csvFile');
            const formData  = new FormData();
            formData.append('file', fileInput.files[0]);

            const res = await fetch(window.rxUrl('/api/import/' + currentDataset), {
                method: 'POST',
                headers: { 'Authorization': 'Bearer ' + token },
                body: formData
            });

            if (res.status === 401 || res.status === 403) { window.rxNav('/login'); return; }
            const data = await res.json();
            if (res.ok) {
                document.getElementById('previewSection').classList.add('d-none');
                displayResults(data);
            } else {
                showToast(data.error || 'Import failed', 'danger');
            }
        } catch (err) {
            showToast('Network error during upload', 'danger');
        } finally {
            confirmBtn.disabled = false;
            cancelBtn.disabled  = false;
            if (invalidRows.length > 0) {
                confirmBtn.innerHTML = 'Fix ' + invalidRows.length + ' error(s) to continue';
                confirmBtn.className = 'btn btn-danger btn-sm';
            } else {
                confirmBtn.innerHTML = 'Import All ' + validRows.length + ' Rows';
                confirmBtn.className = 'btn btn-success btn-sm';
            }

        }
    }

    function downloadTemplate() {
        const token = localStorage.getItem('token');
        const url   = window.rxUrl('/api/import/template/' + currentDataset);
        fetch(url, { headers: { 'Authorization': 'Bearer ' + token } })
        .then(r => { if (r.status === 401 || r.status === 403) { window.rxNav('/login'); return; } return r.blob(); })
        .then(blob => {
            if (!blob) return;
            const url2 = window.URL.createObjectURL(blob);
            const a = Object.assign(document.createElement('a'), { href: url2, download: 'template_' + currentDataset + '.csv' });
            document.body.appendChild(a); a.click(); document.body.removeChild(a);
            window.URL.revokeObjectURL(url2);
        })
        .catch(() => showToast('Error downloading template', 'danger'));
    }

    function displayResults(data) {
        const box = document.getElementById('resultsBox');
        box.style.display = 'block';

        if (data.aborted) {
            // All-or-nothing: nothing was saved, show download button
            box.className = 'results-box alert alert-danger';
            document.getElementById('resultsHeading').textContent = '\u26a0 Import Aborted — Nothing Saved';
            document.getElementById('resultsSummary').textContent =
                data.errorCount + ' error(s) found. NO records were imported. Fix the errors and re-upload.';

            const errSection = document.getElementById('errorsSection');
            const errList    = document.getElementById('errorsList');
            errSection.classList.remove('d-none');
            var _de = ''; data.errors.forEach(function(e) {
                _de += '<div class="text-danger py-1 border-bottom border-light-subtle"><strong>Line ' + e.row + ':</strong> ' + e.error + '</div>';
            }); errList.innerHTML = _de;

            // Download Failed Rows button
            var dlBtn = document.getElementById('downloadFailedBtn');
            if (!dlBtn) {
                dlBtn = document.createElement('button');
                dlBtn.id = 'downloadFailedBtn';
                dlBtn.className = 'btn btn-outline-danger btn-sm mt-2';
                dlBtn.innerHTML = '<i class="fas fa-download me-1"></i>Download Failed Rows CSV';
                errSection.appendChild(dlBtn);
            }
            dlBtn.onclick = function() { downloadFailedRows(data.failedRows); };
            dlBtn.style.display = '';

        } else {
            box.className = 'results-box alert alert-success';
            document.getElementById('resultsHeading').textContent = '\u2705 Import Successful!';
        document.getElementById('resultsSummary').textContent = 'Successfully imported ' + data.successCount + ' rows.';
        const errSection = document.getElementById('errorsSection');
        errSection.classList.add('d-none');
        var dlBtn2 = document.getElementById('downloadFailedBtn');
        if (dlBtn2) dlBtn2.style.display = 'none';
        }

        showToast(
            data.aborted
                ? 'Import aborted: ' + data.errorCount + ' error(s). Nothing was saved.'
                : 'Import complete! ' + data.successCount + ' records added.',
            data.aborted ? 'danger' : 'success'
        );
    }

    function downloadFailedRows(failedRows) {
        if (!failedRows || !failedRows.length) return;
        // Build CSV — all columns of first row, _import_error last
        var keys = Object.keys(failedRows[0]).filter(function(k) { return k !== '_import_error'; });
        keys.push('_import_error');
        var lines = [keys.map(function(k) { return '"' + k + '"'; }).join(',')];
        failedRows.forEach(function(row) {
            var vals = keys.map(function(k) {
                var v = (row[k] !== undefined && row[k] !== null) ? String(row[k]) : '';
                return '"' + v.replace(/"/g, '""') + '"';
            });
            lines.push(vals.join(','));
        });
        var csv = lines.join('\r\n');
        var blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        var url  = URL.createObjectURL(blob);
        var a = Object.assign(document.createElement('a'), {
            href: url,
            download: 'failed_rows_' + currentDataset + '_' + new Date().toISOString().slice(0,10) + '.csv'
        });
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }
