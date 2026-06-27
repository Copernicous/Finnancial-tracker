(function() {
    function escapeHtml(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function formatBytes(bytes) {
        var size = Number(bytes || 0);
        if (size < 1024) return size + ' B';
        if (size < 1024 * 1024) return (size / 1024).toFixed(1) + ' KB';
        return (size / (1024 * 1024)).toFixed(1) + ' MB';
    }

    function getAuthHeaders() {
        var token = localStorage.getItem('token') || '';
        return token ? { 'Authorization': 'Bearer ' + token } : {};
    }

    function toAppUrl(path) {
        if (/^https?:\/\//i.test(String(path || ''))) return path;
        if (typeof window.rxUrl === 'function') return window.rxUrl(path);
        return path;
    }

    function rawFetch(url, options) {
        options = options || {};
        options.credentials = options.credentials || 'include';
        options.headers = Object.assign({}, getAuthHeaders(), options.headers || {});
        return fetch(toAppUrl(url), options).then(function(res) {
            if (res.status === 401) {
                localStorage.removeItem('token');
                localStorage.removeItem('user');
                window.rxNav('/login');
                return null;
            }
            if (res.status === 403) {
                if (typeof showToast === 'function') showToast('Access denied.', 'warning');
                return null;
            }
            return res;
        });
    }

    function readJson(res, fallbackMessage) {
        if (!res) return Promise.resolve(null);
        return res.text().then(function(text) {
            var trimmed = String(text || '').trim();
            if (!trimmed) return null;
            var contentType = (res.headers.get('content-type') || '').toLowerCase();
            if (contentType.indexOf('application/json') === -1 && trimmed.charAt(0) === '<') {
                throw new Error(fallbackMessage || 'The server returned an HTML page instead of JSON. Please refresh the page and try again.');
            }
            try {
                return JSON.parse(trimmed);
            } catch (err) {
                throw new Error(fallbackMessage || 'The server returned an invalid response. Please refresh the page and try again.');
            }
        });
    }

    function canUploadHere() {
        try {
            var perms = getPagePerms();
            return !!perms.canEdit;
        } catch (e) {
            return false;
        }
    }

    function canDeleteHere() {
        try {
            return !!getPagePerms().canDelete;
        } catch (e) {
            return false;
        }
    }

    function endpoint(ownerType, ownerId) {
        if (ownerType === 'rx-record') return '/api/rx-records/' + ownerId + '/documents';
        return '/api/patients/' + ownerId + '/documents';
    }

    function setStatus(el, message, type) {
        if (!el) return;
        el.className = 'small mt-2 text-' + (type || 'muted');
        el.innerHTML = message || '';
    }

    function renderList(options, docs) {
        var listEl = typeof options.listEl === 'string' ? document.getElementById(options.listEl) : options.listEl;
        if (!listEl) return;

        if (!docs || !docs.length) {
            listEl.innerHTML = '<div class="text-muted small py-2"><i class="fas fa-folder-open me-1"></i>No pictures or documents uploaded yet.</div>';
            return;
        }

        var allowDelete = options.canDelete !== undefined ? !!options.canDelete : canDeleteHere();
        var html = '<div class="list-group list-group-flush">';
        docs.forEach(function(doc) {
            var icon = (doc.mimeType || '').indexOf('image/') === 0 ? 'fa-image' :
                (doc.mimeType === 'application/pdf' ? 'fa-file-pdf' : 'fa-file-alt');
            var date = doc.createdAt ? new Date(doc.createdAt).toLocaleString() : '';
            var provider = doc.provider === 'drive'
                ? '<span class="badge bg-success ms-2">Drive</span>'
                : '<span class="badge bg-secondary ms-2">Local</span>';
            var by = doc.uploadedBy && (doc.uploadedBy.name || doc.uploadedBy.username)
                ? ' by ' + escapeHtml(doc.uploadedBy.name || doc.uploadedBy.username)
                : '';

            html += '<div class="list-group-item px-0 d-flex align-items-center gap-2" data-doc-id="' + doc.id + '">' +
                '<i class="fas ' + icon + ' text-primary" style="width:20px"></i>' +
                '<div class="flex-grow-1" style="min-width:0">' +
                    '<div class="fw-semibold text-truncate">' + escapeHtml(doc.originalName) + provider + '</div>' +
                    '<div class="text-muted small">' + formatBytes(doc.sizeBytes) + (date ? ' &middot; ' + escapeHtml(date) : '') + by + '</div>' +
                '</div>' +
                '<a class="btn btn-sm btn-outline-primary" target="_blank" rel="noopener" href="' + escapeHtml(toAppUrl(doc.downloadUrl)) + '" title="Open / download"><i class="fas fa-download"></i></a>';
            if (doc.driveWebViewLink) {
                html += '<a class="btn btn-sm btn-outline-success" target="_blank" rel="noopener" href="' + escapeHtml(doc.driveWebViewLink) + '" title="Open in Google Drive"><i class="fab fa-google-drive"></i></a>';
            }
            if (allowDelete) {
                html += '<button type="button" class="btn btn-sm btn-outline-danger rx-doc-delete" data-doc-id="' + doc.id + '" title="Delete"><i class="fas fa-trash"></i></button>';
            }
            html += '</div>';
        });
        html += '</div>';
        listEl.innerHTML = html;

        listEl.querySelectorAll('.rx-doc-delete').forEach(function(btn) {
            btn.addEventListener('click', function() {
                deleteDocument(options, this.getAttribute('data-doc-id'));
            });
        });
    }

    function load(options) {
        var listEl = typeof options.listEl === 'string' ? document.getElementById(options.listEl) : options.listEl;
        if (!options.ownerId) {
            if (listEl) listEl.innerHTML = '<div class="text-muted small py-2"><i class="fas fa-save me-1"></i>Save the record first, then upload pictures or documents.</div>';
            return Promise.resolve([]);
        }
        if (listEl) listEl.innerHTML = '<div class="text-muted small py-2"><i class="fas fa-spinner fa-spin me-1"></i>Loading documents...</div>';
        return rawFetch(endpoint(options.ownerType, options.ownerId))
            .then(function(res) {
                if (!res || !res.ok) throw new Error('Could not load documents.');
                return readJson(res, 'Could not load documents. Please refresh the page and try again.');
            })
            .then(function(docs) {
                renderList(options, docs);
                return docs;
            })
            .catch(function(err) {
                if (listEl) listEl.innerHTML = '<div class="text-danger small py-2">' + escapeHtml(err.message) + '</div>';
                return [];
            });
    }

    function upload(options) {
        var inputEl = typeof options.inputEl === 'string' ? document.getElementById(options.inputEl) : options.inputEl;
        var statusEl = typeof options.statusEl === 'string' ? document.getElementById(options.statusEl) : options.statusEl;
        if (!options.ownerId) {
            setStatus(statusEl, 'Save the record first, then upload files.', 'warning');
            return;
        }
        if (!inputEl || !inputEl.files || !inputEl.files.length) {
            setStatus(statusEl, 'Choose one or more files first.', 'warning');
            return;
        }

        var form = new FormData();
        Array.prototype.forEach.call(inputEl.files, function(file) {
            form.append('files', file);
        });
        setStatus(statusEl, '<i class="fas fa-spinner fa-spin me-1"></i>Uploading...', 'muted');

        rawFetch(endpoint(options.ownerType, options.ownerId), {
            method: 'POST',
            body: form
        }).then(function(res) {
            if (!res) return null;
            if (!res.ok) {
                return readJson(res, 'Upload failed. Please refresh the page and try again.').catch(function() { return {}; }).then(function(err) {
                    throw new Error(err.error || err.message || 'Upload failed.');
                });
            }
            return readJson(res, 'Upload finished, but the server returned an unexpected response. Please refresh the document list.');
        }).then(function() {
            inputEl.value = '';
            setStatus(statusEl, 'Uploaded successfully.', 'success');
            if (typeof showToast === 'function') showToast('Document uploaded.', 'success');
            return load(options);
        }).catch(function(err) {
            setStatus(statusEl, escapeHtml(err.message || 'Upload failed.'), 'danger');
        });
    }

    function deleteDocument(options, documentId) {
        if (!documentId) return;
        if (!confirm('Delete this uploaded document?')) return;
        rawFetch('/api/documents/' + documentId, { method: 'DELETE' })
            .then(function(res) {
                if (!res) return;
                if (!res.ok) throw new Error('Delete failed.');
                if (typeof showToast === 'function') showToast('Document deleted.', 'success');
                return load(options);
            })
            .catch(function(err) {
                if (typeof showToast === 'function') showToast(err.message || 'Delete failed.', 'danger');
            });
    }

    function bind(options) {
        var inputEl = typeof options.inputEl === 'string' ? document.getElementById(options.inputEl) : options.inputEl;
        var buttonEl = typeof options.buttonEl === 'string' ? document.getElementById(options.buttonEl) : options.buttonEl;
        var statusEl = typeof options.statusEl === 'string' ? document.getElementById(options.statusEl) : options.statusEl;
        var uploadAllowed = options.canUpload !== undefined ? !!options.canUpload : canUploadHere();
        setStatus(statusEl, '', 'muted');

        if (inputEl) inputEl.disabled = !uploadAllowed || !options.ownerId;
        if (buttonEl) {
            buttonEl.disabled = !uploadAllowed || !options.ownerId;
            buttonEl.onclick = function() { upload(options); };
        }

        var uploadWrap = typeof options.uploadWrapEl === 'string' ? document.getElementById(options.uploadWrapEl) : options.uploadWrapEl;
        if (uploadWrap) uploadWrap.style.display = uploadAllowed && options.ownerId ? '' : 'none';

        return load(options);
    }

    window.rxDocuments = {
        bind: bind,
        load: load,
        upload: upload
    };
})();
