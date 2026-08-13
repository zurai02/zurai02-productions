/**
 * Zurai02 Productions - Script Hub
 * Professional Roblox Script Management System
 * @version 2.0.0
 */

'use strict';

// ============================================
// CONFIGURATION
// ============================================
const CONFIG = Object.freeze({
    CLIENT_ID: '3255755288279625071',
    REDIRECT_URI: 'https://zurai02.github.io/zurai02-productions/index.html',
    OAUTH_BASE: 'https://authorize.roblox.com/',
    TOKEN_URL: 'https://apis.roblox.com/oauth/v1/token',
    USERINFO_URL: 'https://apis.roblox.com/oauth/v1/userinfo',
    SCOPE: 'openid profile',
    STORAGE_KEYS: Object.freeze({
        SCRIPTS: 'zp_scripts',
        EXECS: 'zp_execs',
        USER: 'zurai_user',
        ACCESS_TOKEN: 'roblox_access_token',
        REFRESH_TOKEN: 'roblox_refresh_token',
        OAUTH_STATE: 'oauth_state'
    })
});

// ============================================
// STATE MANAGEMENT
// ============================================
const State = {
    user: null,
    scripts: [],
    executions: [],
    isBrowser: true,

    init() {
        this.scripts = Storage.get(CONFIG.STORAGE_KEYS.SCRIPTS, []);
        this.executions = Storage.get(CONFIG.STORAGE_KEYS.EXECS, []);
        this.user = Storage.get(CONFIG.STORAGE_KEYS.USER, null);
    },

    setUser(user) {
        this.user = user;
        Storage.set(CONFIG.STORAGE_KEYS.USER, user);
    },

    clearUser() {
        this.user = null;
        Storage.remove(CONFIG.STORAGE_KEYS.USER);
        Storage.remove(CONFIG.STORAGE_KEYS.ACCESS_TOKEN);
        Storage.remove(CONFIG.STORAGE_KEYS.REFRESH_TOKEN);
    }
};

// ============================================
// STORAGE UTILITIES
// ============================================
const Storage = {
    get(key, defaultValue = null) {
        try {
            const item = localStorage.getItem(key);
            return item ? JSON.parse(item) : defaultValue;
        } catch {
            return defaultValue;
        }
    },

    set(key, value) {
        try {
            localStorage.setItem(key, JSON.stringify(value));
            return true;
        } catch {
            return false;
        }
    },

    remove(key) {
        try {
            localStorage.removeItem(key);
        } catch { /* ignore */ }
    }
};

// ============================================
// ENVIRONMENT DETECTION
// ============================================
const Environment = {
    EXECUTOR_GLOBALS: Object.freeze([
        'syn', 'krnl', 'fluxus', 'oxygen', 'electron',
        'getexecutorname', 'getscriptclosure', 'getgc',
        'getconnections', 'getloadedmodules', 'hookfunction'
    ]),

    detect() {
        const hasExecutorGlobal = this.EXECUTOR_GLOBALS.some(
            g => typeof window[g] !== 'undefined'
        );
        State.isBrowser = !hasExecutorGlobal;
        return State.isBrowser;
    },

    isBrowser() {
        return State.isBrowser;
    }
};

// ============================================
// NOTIFICATION SYSTEM
// ============================================
const Notify = {
    container: null,

    init() {
        this.container = document.getElementById('toastContainer');
    },

    show(message, type = 'info') {
        if (!this.container) return;

        const icons = { info: 'ℹ️', success: '✅', error: '❌', warning: '⚠️' };
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        toast.innerHTML = `<span>${icons[type] || icons.info}</span> ${Utils.escapeHtml(message)}`;

        this.container.appendChild(toast);

        setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transform = 'translateX(120%)';
            setTimeout(() => toast.remove(), 300);
        }, 4000);
    }
};

// ============================================
// AUTHENTICATION MODULE
// ============================================
const Auth = {
    async exchangeCode(code) {
        try {
            const params = new URLSearchParams({
                grant_type: 'authorization_code',
                code,
                redirect_uri: CONFIG.REDIRECT_URI,
                client_id: CONFIG.CLIENT_ID
            });

            const response = await fetch(CONFIG.TOKEN_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: params.toString()
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`Token exchange failed: ${response.status}`);
            }

            const data = await response.json();
            Storage.set(CONFIG.STORAGE_KEYS.ACCESS_TOKEN, data.access_token);
            Storage.set(CONFIG.STORAGE_KEYS.REFRESH_TOKEN, data.refresh_token);

            window.history.replaceState({}, document.title, window.location.pathname);

            await this.fetchUserInfo(data.access_token);
            Notify.show('Successfully logged in with Roblox!', 'success');
        } catch (err) {
            console.error('[Auth] Token exchange failed:', err);
            Notify.show('Login failed. Please try again.', 'error');
        }
    },

    async fetchUserInfo(accessToken) {
        try {
            const response = await fetch(CONFIG.USERINFO_URL, {
                headers: { 'Authorization': `Bearer ${accessToken}` }
            });

            if (!response.ok) {
                if (response.status === 401) {
                    await this.refreshToken();
                    return;
                }
                throw new Error(`User info fetch failed: ${response.status}`);
            }

            const data = await response.json();
            const user = {
                id: data.sub,
                name: data.preferred_username || data.name,
                displayName: data.nickname || data.preferred_username,
                picture: data.picture
            };

            State.setUser(user);
            UI.updateForUser(user);
        } catch (err) {
            console.error('[Auth] User info error:', err);
            this.logout();
        }
    },

    async refreshToken() {
        const refreshToken = Storage.get(CONFIG.STORAGE_KEYS.REFRESH_TOKEN);
        if (!refreshToken) {
            this.logout();
            return;
        }

        try {
            const params = new URLSearchParams({
                grant_type: 'refresh_token',
                refresh_token: refreshToken,
                client_id: CONFIG.CLIENT_ID
            });

            const response = await fetch(CONFIG.TOKEN_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: params.toString()
            });

            if (!response.ok) throw new Error('Refresh failed');

            const data = await response.json();
            Storage.set(CONFIG.STORAGE_KEYS.ACCESS_TOKEN, data.access_token);
            Storage.set(CONFIG.STORAGE_KEYS.REFRESH_TOKEN, data.refresh_token);
            await this.fetchUserInfo(data.access_token);
        } catch (err) {
            console.error('[Auth] Refresh error:', err);
            this.logout();
        }
    },

    generateState() {
        const array = new Uint8Array(16);
        crypto.getRandomValues(array);
        const state = btoa(String.fromCharCode(...array)).slice(0, 32);
        sessionStorage.setItem(CONFIG.STORAGE_KEYS.OAUTH_STATE, state);
        return state;
    },

    buildOAuthUrl() {
        const state = this.generateState();
        const params = new URLSearchParams({
            client_id: CONFIG.CLIENT_ID,
            redirect_uri: CONFIG.REDIRECT_URI,
            scope: CONFIG.SCOPE,
            response_type: 'code',
            state
        });
        return `${CONFIG.OAUTH_BASE}?${params.toString()}`;
    },

    handleLogin() {
        window.location.href = this.buildOAuthUrl();
    },

    handleCallback() {
        const urlParams = new URLSearchParams(window.location.search);
        const code = urlParams.get('code');
        const state = urlParams.get('state');
        const error = urlParams.get('error');
        const errorDesc = urlParams.get('error_description');

        if (error) {
            console.error('[Auth] OAuth error:', error, errorDesc);
            Notify.show(`Login failed: ${errorDesc || error}`, 'error');
            return;
        }

        if (code && state) {
            const savedState = sessionStorage.getItem(CONFIG.STORAGE_KEYS.OAUTH_STATE);
            if (state !== savedState) {
                Notify.show('Security check failed. Invalid state.', 'error');
                return;
            }
            this.exchangeCode(code);
        } else {
            const token = Storage.get(CONFIG.STORAGE_KEYS.ACCESS_TOKEN);
            if (token) {
                this.fetchUserInfo(token);
            }
        }
    },

    logout() {
        State.clearUser();
        UI.resetAuthButton();
        Notify.show('Logged out successfully', 'info');
    },

    showUserMenu() {
        const existing = document.querySelector('.user-menu');
        if (existing) {
            existing.remove();
            return;
        }

        const menu = document.createElement('div');
        menu.className = 'user-menu';
        menu.innerHTML = `
            <div class="user-menu-item" onclick="window.open('https://www.roblox.com/users/${State.user?.id}/profile', '_blank')">👤 View Profile</div>
            <div class="user-menu-item" onclick="Auth.logout()" style="color: var(--error)">🚪 Logout</div>
        `;

        const authBtn = document.getElementById('authButton');
        authBtn.parentElement.style.position = 'relative';
        authBtn.parentElement.appendChild(menu);

        setTimeout(() => {
            document.addEventListener('click', function closeMenu(e) {
                if (!menu.contains(e.target) && e.target !== authBtn) {
                    menu.remove();
                    document.removeEventListener('click', closeMenu);
                }
            });
        }, 10);
    }
};

// ============================================
// SCRIPT MANAGEMENT
// ============================================
const ScriptManager = {
    modal: null,

    init() {
        this.modal = document.getElementById('modal');
        this.load();
    },

    openModal() {
        if (!State.user) {
            Notify.show('Please login to create scripts', 'warning');
            Auth.handleLogin();
            return;
        }
        this.modal.classList.add('active');
        document.getElementById('scriptName').focus();
    },

    closeModal() {
        this.modal.classList.remove('active');
        ['scriptName', 'scriptDesc', 'scriptCode'].forEach(id => {
            document.getElementById(id).value = '';
        });
    },

    save() {
        if (!State.user) {
            Notify.show('Please login to save scripts', 'error');
            return;
        }

        const name = document.getElementById('scriptName').value.trim();
        const desc = document.getElementById('scriptDesc').value.trim();
        const code = document.getElementById('scriptCode').value.trim();

        if (!name || !code) {
            Notify.show('Name and code are required', 'error');
            return;
        }

        const script = {
            id: Utils.generateId(),
            name,
            desc: desc || 'No description',
            lang: 'lua',
            code,
            execs: 0,
            last: null,
            output: '',
            owner: State.user.id,
            createdAt: new Date().toISOString()
        };

        script.ls = this.generateLoadstring(script.id, script.name);
        State.scripts.push(script);
        this.persist();
        this.render();
        this.updateStats();
        this.closeModal();
        Notify.show('Script saved successfully', 'success');
    },

    delete(id) {
        if (!confirm('Are you sure you want to delete this script?')) return;
        State.scripts = State.scripts.filter(s => s.id !== id);
        this.persist();
        this.render();
        this.updateStats();
        Notify.show('Script deleted', 'info');
    },

    edit(id) {
        const script = State.scripts.find(s => s.id === id);
        if (!script) return;

        document.getElementById('scriptName').value = script.name;
        document.getElementById('scriptDesc').value = script.desc;
        document.getElementById('scriptCode').value = script.code;

        State.scripts = State.scripts.filter(s => s.id !== id);
        this.openModal();
    },

    generateLoadstring(id, name) {
        let base = window.location.origin + window.location.pathname;
        base = base.replace(/[^/]*$/, '');
        if (!base.endsWith('/')) base += '/';

        const url = `${base}raw.html?script=${id}`;

        return `-- Zurai02 Productions | ${name}
local _c = game:HttpGet("${url}", true)
local _s = _c:match("<!%-%-LUA%-%->(.-)<!%/LUA%>")
if _s then
    loadstring(_s)()
else
    warn("Zurai02: Script not found or failed to load")
end`;
    },

    copyLoadstring(id) {
        const script = State.scripts.find(s => s.id === id);
        if (!script) return;

        Utils.copyToClipboard(script.ls)
            .then(() => Notify.show('Loadstring copied! Paste in your executor.', 'success'))
            .catch(() => Notify.show('Failed to copy loadstring', 'error'));
    },

    run(id) {
        const script = State.scripts.find(s => s.id === id);
        if (!script) return;

        if (Environment.isBrowser()) {
            window.open(`protection.html?script=${id}&name=${encodeURIComponent(script.name)}`, '_blank');
            Notify.show('Browser execution blocked. Opening protection page.', 'warning');
            this.logExecution(id, false, 'Browser blocked');
            return;
        }

        let output = '';
        let success = true;
        try {
            output = this.traceLua(script.code);
        } catch (err) {
            output = `Error: ${err.message}`;
            success = false;
        }

        script.execs++;
        script.last = new Date().toISOString();
        script.output = output;
        this.logExecution(id, success, success ? 'Executed' : 'Error');
        this.persist();
        this.updateStats();
        this.render();
        Notify.show(
            success ? `Executed! (${script.execs} total)` : 'Execution failed',
            success ? 'success' : 'error'
        );
    },

    traceLua(code) {
        const lines = code.split('\n');
        const output = [];

        const patterns = [
            { test: /^--/, icon: '💬' },
            { test: /^local\s+/, icon: '📦', extract: /local\s+(\w+)/ },
            { test: /^function/, icon: '🔧' },
            { test: /^end$/, icon: '🔚' },
            { test: /^if\s+/, icon: '❓' },
            { test: /^(for|while)\s+/, icon: '🔄' },
            { test: /^print/, icon: '🖨️', extract: /print\s*\((.+)\)/ },
            { test: /^(game:|workspace|Players)/, icon: '🎮' }
        ];

        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;

            let matched = false;
            for (const pattern of patterns) {
                if (pattern.test.test(trimmed)) {
                    let text = trimmed;
                    if (pattern.extract) {
                        const match = trimmed.match(pattern.extract);
                        text = match ? match[1].replace(/["']/g, '').replace(/\.\./g, '') : '';
                    }
                    output.push(`${pattern.icon} ${text.substring(0, 50)}`);
                    matched = true;
                    break;
                }
            }

            if (!matched) {
                output.push(`▶️ ${trimmed.substring(0, 50)}`);
            }
        }

        return output.join('\n') || '[No output]';
    },

    logExecution(scriptId, success, message) {
        State.executions.push({
            scriptId,
            timestamp: new Date().toISOString(),
            success,
            message,
            environment: Environment.isBrowser() ? 'browser' : 'executor'
        });
        this.persist();
    },

    render() {
        const grid = document.getElementById('scriptList');
        const empty = document.getElementById('emptyState');

        if (!State.scripts.length) {
            grid.innerHTML = '';
            empty.style.display = 'block';
            return;
        }

        empty.style.display = 'none';
        grid.innerHTML = State.scripts.map(script => this.renderCard(script)).join('');
    },

    renderCard(script) {
        const lastExec = script.last
            ? new Date(script.last).toLocaleString()
            : 'Never';

        const outputHtml = script.output
            ? `<div class="output active">${Utils.escapeHtml(script.output)}</div>`
            : '';

        const loadstringHtml = `
            <div class="loadstring-container">
                <div class="loadstring-label">📋 Loadstring</div>
                <div class="loadstring-code">${Utils.escapeHtml(script.ls)}</div>
            </div>
        `;

        const browserNotice = Environment.isBrowser() ? `
            <div class="browser-notice">
                <h4>🛡️ Protected Script</h4>
                <p>This script cannot be executed from a browser. Copy the loadstring and paste it into your Roblox executor.</p>
                <button class="btn btn-secondary btn-sm" onclick="ScriptManager.copyLoadstring('${script.id}')">
                    📋 Copy Loadstring
                </button>
            </div>
        ` : '';

        return `
            <div class="script-card">
                <div class="card-header">
                    <span class="card-title">${Utils.escapeHtml(script.name)}</span>
                    <span class="card-badge badge-lua">Lua</span>
                </div>
                <div class="card-desc">${Utils.escapeHtml(script.desc)}</div>
                <div class="card-meta">
                    <span>▶️ ${script.execs} executions</span>
                    <span>🕐 ${lastExec}</span>
                </div>
                <div class="card-actions">
                    <button class="btn btn-secondary btn-sm" onclick="ScriptManager.run('${script.id}')">
                        ▶️ Run
                    </button>
                    <button class="btn btn-secondary btn-sm" onclick="ScriptManager.copyLoadstring('${script.id}')">
                        📋 Copy
                    </button>
                    <button class="btn btn-secondary btn-sm" onclick="ScriptManager.edit('${script.id}')">
                        ✏️ Edit
                    </button>
                    <button class="btn btn-danger btn-sm" onclick="ScriptManager.delete('${script.id}')">
                        🗑️ Delete
                    </button>
                </div>
                ${browserNotice}
                ${loadstringHtml}
                ${outputHtml}
            </div>
        `;
    },

    updateStats() {
        const totalExecs = State.scripts.reduce((sum, s) => sum + s.execs, 0);
        const blocked = State.executions.filter(e => !e.success).length;
        const lastExec = State.executions.length
            ? new Date(State.executions[State.executions.length - 1].timestamp).toLocaleTimeString()
            : 'Never';

        Utils.animateNumber('statExecs', totalExecs);
        Utils.animateNumber('statScripts', State.scripts.length);
        Utils.animateNumber('statBlocked', blocked);
        document.getElementById('statLast').textContent = lastExec;
    },

    persist() {
        Storage.set(CONFIG.STORAGE_KEYS.SCRIPTS, State.scripts);
        Storage.set(CONFIG.STORAGE_KEYS.EXECS, State.executions);
    },

    load() {
        State.scripts.forEach(script => {
            if (!script.ls) script.ls = this.generateLoadstring(script.id, script.name);
            if (!script.lang) script.lang = 'lua';
        });
        this.render();
        this.updateStats();
    }
};

// ============================================
// UI MODULE
// ============================================
const UI = {
    updateForUser(user) {
        const btn = document.getElementById('authButton');
        if (!btn || !user) return;

        btn.innerHTML = `
            <img src="${user.picture || 'https://tr.rbxcdn.com/avatar-default.png'}" 
                 alt="${user.name}" 
                 style="width:24px;height:24px;border-radius:50%;border:2px solid var(--accent);">
            <span>${Utils.escapeHtml(user.displayName || user.name)}</span>
        `;
        btn.className = 'user-badge';
        btn.onclick = Auth.showUserMenu;

        const loginSection = document.getElementById('loginSection');
        if (loginSection) loginSection.style.display = 'none';
    },

    resetAuthButton() {
        const btn = document.getElementById('authButton');
        if (!btn) return;

        btn.innerHTML = '<span>🔐</span> Login with Roblox';
        btn.className = 'btn btn-primary';
        btn.onclick = Auth.handleLogin;

        const loginSection = document.getElementById('loginSection');
        if (loginSection) loginSection.style.display = 'block';
    }
};

// ============================================
// UTILITIES
// ============================================
const Utils = {
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = String(text);
        return div.innerHTML;
    },

    generateId() {
        return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    },

    async copyToClipboard(text) {
        try {
            await navigator.clipboard.writeText(text);
            return true;
        } catch {
            const textarea = document.createElement('textarea');
            textarea.value = text;
            document.body.appendChild(textarea);
            textarea.select();
            document.execCommand('copy');
            document.body.removeChild(textarea);
            return true;
        }
    },

    animateNumber(elementId, target) {
        const element = document.getElementById(elementId);
        if (!element) return;

        const start = parseInt(element.textContent) || 0;
        if (start === target) return;

        const duration = 600;
        const steps = Math.min(Math.abs(target - start), 30);
        const increment = target > start ? 1 : -1;
        const stepTime = duration / steps;

        let current = start;
        const timer = setInterval(() => {
            current += increment;
            element.textContent = current;
            if (current === target) clearInterval(timer);
        }, stepTime);
    }
};

// ============================================
// INITIALIZATION
// ============================================
function initialize() {
    Environment.detect();
    State.init();
    Notify.init();
    ScriptManager.init();
    Auth.handleCallback();

    if (State.user) {
        UI.updateForUser(State.user);
    }

    // Event listeners
    const modal = document.getElementById('modal');
    modal.addEventListener('click', (e) => {
        if (e.target === modal) ScriptManager.closeModal();
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') ScriptManager.closeModal();
        if (e.ctrlKey && e.key === 'n') {
            e.preventDefault();
            ScriptManager.openModal();
        }
    });

    document.querySelectorAll('.nav-link').forEach(link => {
        link.addEventListener('click', () => {
            document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
            link.classList.add('active');
        });
    });
}

// Global exports for inline onclick handlers
window.Auth = Auth;
window.ScriptManager = ScriptManager;

// Start
document.addEventListener('DOMContentLoaded', initialize);
