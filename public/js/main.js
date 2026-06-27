// Ensure same-origin fetch requests send cookies, so FortiGate proxy users can authenticate with rxToken cookie fallback.
(function() {
    if (window.fetch) {
        var originalFetch = window.fetch.bind(window);
        window.fetch = function(resource, init) {
            init = init || {};
            var sameOrigin = typeof resource === 'string'
                ? resource.startsWith('/') || resource.startsWith(window.location.origin)
                : resource instanceof Request && resource.url.startsWith(window.location.origin);
            if (sameOrigin && !init.credentials) {
                init.credentials = 'include';
            }
            return originalFetch(resource, init);
        };
    }
})();

document.addEventListener('DOMContentLoaded', function() {
    // Sidebar Toggle
    var sidebarCollapse = document.getElementById('sidebarCollapse');
    if (sidebarCollapse) {
        sidebarCollapse.addEventListener('click', function() {
            document.getElementById('sidebar').classList.toggle('active');
            var content = document.getElementById('content');
            if (document.getElementById('sidebar').classList.contains('active')) {
                content.style.marginLeft = '0';
            } else {
                content.style.marginLeft = '250px';
            }
        });
    }

    // Theme Toggle
    var themeToggle = document.getElementById('themeToggle');
    if (themeToggle) {
        var currentTheme = localStorage.getItem('rxTheme') || 'light';
        document.documentElement.setAttribute('data-theme', currentTheme);
        themeToggle.innerHTML = currentTheme === 'dark' ? '<i class="fas fa-sun"></i>' : '<i class="fas fa-moon"></i>';

        themeToggle.addEventListener('click', function() {
            var theme = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
            document.documentElement.setAttribute('data-theme', theme);
            localStorage.setItem('rxTheme', theme);
            themeToggle.innerHTML = theme === 'dark' ? '<i class="fas fa-sun"></i>' : '<i class="fas fa-moon"></i>';
        });
    }

    // Login Handle
    var loginForm = document.getElementById('loginForm');
    if (loginForm) {
        loginForm.addEventListener('submit', async function(e) {
            e.preventDefault();
            var username = document.getElementById('username').value;
            var password = document.getElementById('password').value;

            try {
                var res = await fetch(window.rxUrl('/api/auth/login'), {
                    method: 'POST',
                    credentials: 'include',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ username: username, password: password })
                });
                var data = await res.json();
                if (res.ok) {
                    localStorage.setItem('token', data.token);
                    localStorage.setItem('user', JSON.stringify(data.user));
                    window.rxNav('/dashboard');
                } else {
                    showToast(data.message || 'Login failed', 'danger');
                }
            } catch (err) {
                showToast('An error occurred.', 'danger');
            }
        });
    }

    // Auth Check on Protected Pages
    if (!loginForm) {
        var token = localStorage.getItem('token');
        if (!token) {
            window.rxNav('/login');
        } else {
            var user = JSON.parse(localStorage.getItem('user'));
            var userGreeting = document.getElementById('userGreeting');
            if (userGreeting && user) {
                userGreeting.innerText = 'Hello, ' + user.firstName;
            }
        }
    }

    // Logout
    var logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', function() {
            localStorage.removeItem('token');
            localStorage.removeItem('user');
            window.rxNav('/login');
        });
    }
});

// Generic Fetch function with Auth header
// Pass options.silent = true to suppress the 403 toast for background/init calls
async function fetchWithAuth(url, options) {
    options = options || {};
    var token = localStorage.getItem('token');
    var silent = !!options.silent;
    var fetchOptions = Object.assign({}, options);
    delete fetchOptions.silent; // don't send to fetch()
    var headers = Object.assign({
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + token
    }, fetchOptions.headers || {});
    var res = await fetch(url, Object.assign({}, fetchOptions, { headers: headers }));
    // 401 = token expired / invalid -> logout
    if (res.status === 401) {
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        window.rxNav('/login');
        throw new Error('Unauthorized');
    }
    // 403 = authenticated but forbidden
    if (res.status === 403) {
        if (!silent) {
            var body = await res.clone().json().catch(function() { return {}; });
            if (typeof showToast === 'function') {
                showToast(body.message || 'Access denied.', 'warning');
            }
        }
        return res;
    }
    return res;
}

// Toast notification function
function showToast(message, type) {
    type = type || 'success';
    var container = document.querySelector('.toast-container');
    var toastHtml = '<div class="toast align-items-center text-white bg-' + type + ' border-0 show" role="alert" aria-live="assertive" aria-atomic="true" style="margin-bottom: 10px;">' +
        '<div class="d-flex">' +
        '<div class="toast-body">' + message + '</div>' +
        '<button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast" aria-label="Close"></button>' +
        '</div></div>';
    container.insertAdjacentHTML('beforeend', toastHtml);
    setTimeout(function() {
        if (container.firstChild) {
            container.firstChild.remove();
        }
    }, 3000);
}

// Generic CRUD loader placeholder
async function loadCrudData(moduleName, apiEndpoint) {
    try {
        var res = await fetchWithAuth(apiEndpoint);
        var data = await res.json();
        if (data.length > 0) {
            var headers = Object.keys(data[0]).filter(function(k) { return k !== 'passwordHash'; });
            var _hHtml = ''; for (var _hi = 0; _hi < headers.length; _hi++) { _hHtml += '<th>' + headers[_hi] + '</th>'; }
            document.getElementById('tableHeaders').innerHTML = _hHtml + '<th>Actions</th>';

            var _tHtml = ''; for (var _tri = 0; _tri < data.length; _tri++) {
                var row = data[_tri];
                var rowHtml = '<tr>';
                headers.forEach(function(h) {
                    rowHtml += '<td>' + (typeof row[h] === 'object' && row[h] !== null ? row[h].name || row[h].companyName || 'Obj' : row[h]) + '</td>';
                });
                rowHtml += '<td>' +
                    '<button class="btn btn-sm btn-info" data-edit-id="' + row.id + '"><i class="fas fa-edit"></i></button> ' +
                    '<button class="btn btn-sm btn-danger" data-del-id="' + row.id + '" data-del-ep="' + apiEndpoint + '"><i class="fas fa-trash"></i></button>' +
                    '</td></tr>';
                _tHtml += rowHtml;
            }
            document.getElementById('tableBody').innerHTML = _tHtml;
        } else {
            document.getElementById('tableBody').innerHTML = '<tr><td colspan="100%" class="text-center">No records found.</td></tr>';
        }
    } catch (err) {
        showToast('Error loading data', 'danger');
    }
}
