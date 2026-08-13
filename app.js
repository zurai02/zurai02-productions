/**
 * Zurai02 Productions v3.1 — Frontend (API Mode)
 * Calls backend API instead of using localStorage
 */

(function() {
    'use strict';

    // ============================================
    // CONFIGURATION
    // ============================================
    const CONFIG = Object.freeze({
        API_BASE: 'https://your-api-domain.com/api',  // CHANGE THIS to your backend URL
        STORAGE: Object.freeze({
            TOKEN: 'zp_token_v31',
            USER: 'zp_user_v31'
        })
    });

    // ============================================
    // API CLIENT
    // ============================================
    const API = {
        token: null,

        init() {
            this.token = localStorage.getItem(CONFIG.STORAGE.TOKEN);
        },

        headers() {
            const h = { 'Content-Type': 'application/json' };
            if (this.token) h['Authorization'] = `Bearer ${this.token}`;
            return h;
        },

        async get(endpoint) {
            const res = await fetch(`${CONFIG.API_BASE}${endpoint}`, {
                headers: this.headers()
            });
            if (res.status === 401) { Auth.signOut(); throw new Error('Unauthorized'); }
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            return res.json();
        },

        async post(endpoint, body) {
            const res = await fetch(`${CONFIG.API_BASE}${endpoint}`, {
                method: 'POST',
                headers: this.headers(),
                body: JSON.stringify(body)
            });
            if (res.status === 401) { Auth.signOut(); throw new Error('Unauthorized'); }
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                throw new Error(err.error || `HTTP ${res.status}`);
            }
            return res.json();
        },

        async delete(endpoint) {
            const res = await fetch(`${CONFIG.API_BASE}${endpoint}`, {
                method: 'DELETE',
                headers: this.headers()
            });
            if (res.status === 401) { Auth.signOut(); throw new Error('Unauthorized'); }
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            return res.json();
        }
    };

    // ============================================
    // STATE
    // ============================================
    const AppState = {
        user: null,
        scripts: [],
        isBrowser: true,

        init() {
            const savedUser = localStorage.getItem(CONFIG.STORAGE.USER);
            if (savedUser) this.user = JSON.parse(savedUser);
        }
    };

    // ============================================
    // ENVIRONMENT
    // ============================================
    const Env = {
        detect() {
            const markers = ['syn', 'krnl', 'fluxus', 'getexecutorname', 'getgc'];
            AppState.isBrowser = !markers.some(m => typeof window[m] !== 'undefined');
        }
    };

    // ============================================
    // NOTIFICATIONS
    // ============================================
    const Toast = {
        container: null,

        init() {
            this.container = document.getElementById('toastContainer');
        },

        push(message, type = 'info') {
            if (!this.container) return;
            const icons = {
                info: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>',
                success: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>',
                error: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>',
                warning: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>'
            };
            const el = document.createElement('div');
            el.className = `toast toast--${type}`;
            el.innerHTML = `${icons[type] || icons.info}<span>${escapeHtml(message)}</span>`;
            this.container.appendChild(el);
            setTimeout(() => {
                el.classList.add('is-exiting');
                el.addEventListener('animationend', () => el.remove(), { once: true });
            }, 4000);
        }
    };

    // ============================================
    // AUTHENTICATION
    // ============================================
    const Auth = {
        async beginLogin() {
            try {
                const res = await fetch(`${CONFIG.API_BASE}/auth/url`);
                const data = await res.json();
                window.location.href = data.url;
            } catch (err) {
                Toast.push('Failed to start authentication', 'error');
            }
        },

        async handleCallback() {
            const params = new URLSearchParams(window.location.search);
            const code = params.get('code');
            const state = params.get('state');
            const error = params.get('error');

            if (error) {
                Toast.push(`Auth error: ${params.get('error_description') || error}`, 'error');
                return;
            }

            if (code && state) {
                try {
                    const data = await API.post('/auth/callback', { code, state });
                    API.token = data.token;
                    localStorage.setItem(CONFIG.STORAGE.TOKEN, data.token);
                    localStorage.setItem(CONFIG.STORAGE.USER, JSON.stringify(data.user));
                    AppState.user = data.user;
                    window.history.replaceState({}, '', window.location.pathname);
                    UI.renderUser();
                    Toast.push('Signed in successfully', 'success');
                    Scripts.loadAll();
                } catch (err) {
                    Toast.push('Authentication failed', 'error');
                }
            } else {
                // Check existing session
                if (API.token) {
                    try {
                        const user = await API.get('/user/me');
                        AppState.user = user;
                        UI.renderUser();
                        Scripts.loadAll();
                    } catch {
                        this.signOut();
                    }
                }
            }
        },

        signOut() {
            API.token = null;
            AppState.user = null;
            AppState.scripts = [];
            localStorage.removeItem(CONFIG.STORAGE.TOKEN);
            localStorage.removeItem(CONFIG.STORAGE.USER);
            UI.renderGuest();
            Scripts.renderAll();
            Toast.push('Signed out', 'info');
        },

        toggleMenu() {
            const existing = document.querySelector('.user-menu');
            if (existing) { existing.remove(); return; }

            const menu = document.createElement('div');
            menu.className = 'user-menu';
            menu.innerHTML = `
                <button class="user-menu__item" data-action="view-profile">View Profile</button>
                <button class="user-menu__item user-menu__item--danger" data-action="sign-out">Sign Out</button>
            `;
            document.getElementById('authButton').parentElement.appendChild(menu);
        }
    };

    // ============================================
    // SCRIPTS
    // ============================================
    const Scripts = {
        async loadAll() {
            if (!AppState.user) return;
            try {
                AppState.scripts = await API.get('/scripts');
                this.renderAll();
                Stats.update();
            } catch (err) {
                Toast.push('Failed to load scripts', 'error');
            }
        },

        async create(name, desc, code) {
            if (!AppState.user) {
                Toast.push('Authentication required', 'warning');
                Auth.beginLogin();
                return;
            }
            try {
                const script = await API.post('/scripts', {
                    name, description: desc, code, language: 'lua'
                });
                AppState.scripts.unshift(script);
                this.renderAll();
                Stats.update();
                Toast.push('Script saved', 'success');
            } catch (err) {
                Toast.push(err.message || 'Failed to save script', 'error');
            }
        },

        async remove(id) {
            if (!confirm('Delete this script permanently?')) return;
            try {
                await API.delete(`/scripts/${id}`);
                AppState.scripts = AppState.scripts.filter(s => s.id !== id);
                this.renderAll();
                Stats.update();
                Toast.push('Script deleted', 'info');
            } catch (err) {
                Toast.push('Failed to delete script', 'error');
            }
        },

        async copyLoadstring(id) {
            const script = AppState.scripts.find(s => s.id === id);
            if (!script || !script.loadstring) return;

            try {
                await navigator.clipboard.writeText(script.loadstring);
                Toast.push('Loadstring copied to clipboard', 'success');
            } catch {
                const ta = document.createElement('textarea');
                ta.value = script.loadstring;
                document.body.appendChild(ta);
                ta.select();
                document.execCommand('copy');
                document.body.removeChild(ta);
                Toast.push('Loadstring copied to clipboard', 'success');
            }
        },

        execute(id) {
            const script = AppState.scripts.find(s => s.id === id);
            if (!script) return;

            if (AppState.isBrowser) {
                window.open(`protection.html?script=${id}`, '_blank');
                Toast.push('Execution blocked in browser', 'warning');
                return;
            }

            Toast.push('Use the loadstring in your executor', 'info');
        },

        renderAll() {
            const list = document.getElementById('scriptList');
            const empty = document.getElementById('emptyState');

            if (!AppState.scripts.length) {
                list.innerHTML = '';
                empty.classList.remove('is-hidden');
                return;
            }

            empty.classList.add('is-hidden');
            list.innerHTML = AppState.scripts.map(s => this.renderItem(s)).join('');
        },

        renderItem(s) {
            const last = s.lastExecuted
                ? new Date(s.lastExecuted).toLocaleString()
                : 'Never';
            const notice = AppState.isBrowser ? `
                <div class="script-item__notice">
                    <div class="script-item__notice-title">Protected Execution</div>
                    <p class="script-item__notice-text">This script must be run from a Roblox executor. Copy the loadstring below.</p>
                    <button type="button" class="button button--secondary button--small" data-action="copy" data-id="${s.id}">Copy Loadstring</button>
                </div>
            ` : '';

            return `
                <article class="script-item" data-script-id="${s.id}">
                    <div class="script-item__header">
                        <h3 class="script-item__title">${escapeHtml(s.name)}</h3>
                        <span class="script-item__badge">${s.language || 'lua'}</span>
                    </div>
                    <p class="script-item__desc">${escapeHtml(s.description)}</p>
                    <div class="script-item__meta">
                        <span>${s.executions || 0} executions</span>
                        <span>Last: ${last}</span>
                    </div>
                    <div class="script-item__actions">
                        <button type="button" class="button button--secondary button--small" data-action="run" data-id="${s.id}">Run</button>
                        <button type="button" class="button button--secondary button--small" data-action="copy" data-id="${s.id}">Copy</button>
                        <button type="button" class="button button--secondary button--small" data-action="edit" data-id="${s.id}">Edit</button>
                        <button type="button" class="button button--danger button--small" data-action="delete" data-id="${s.id}">Delete</button>
                    </div>
                    ${notice}
                    <div class="script-item__loadstring">
                        <div class="script-item__loadstring-label">Loadstring</div>
                        <code class="script-item__loadstring-code">${escapeHtml(s.loadstring || '')}</code>
                    </div>
                </article>
            `;
        }
    };

    // ============================================
    // STATISTICS
    // ============================================
    const Stats = {
        async update() {
            if (!AppState.user) return;
            try {
                const stats = await API.get('/stats');
                this.animateValue('statExecs', stats.totalExecutions || 0);
                this.animateValue('statScripts', stats.totalScripts || 0);
                this.animateValue('statBlocked', stats.blockedAttempts || 0);
                document.getElementById('statLast').textContent = stats.lastExecution
                    ? new Date(stats.lastExecution).toLocaleTimeString()
                    : 'Never';
            } catch {
                // Silently fail — stats are non-critical
            }
        },

        animateValue(id, target) {
            const el = document.getElementById(id);
            if (!el) return;
            const start = parseInt(el.textContent) || 0;
            if (start === target) return;
            const step = target > start ? 1 : -1;
            let current = start;
            const timer = setInterval(() => {
                current += step;
                el.textContent = current;
                if (current === target) clearInterval(timer);
            }, 30);
        }
    };

    // ============================================
    // UI
    // ============================================
    const UI = {
        modal: null,

        init() {
            this.modal = document.getElementById('modal');
            this.bindEvents();
        },

        bindEvents() {
            document.addEventListener('click', (e) => {
                const target = e.target.closest('[data-action]');
                if (!target) return;

                const action = target.dataset.action;
                const id = target.dataset.id;

                switch (action) {
                    case 'open-modal': this.openModal(); break;
                    case 'close-modal': this.closeModal(); break;
                    case 'sign-in': Auth.beginLogin(); break;
                    case 'sign-out': Auth.signOut(); break;
                    case 'view-profile':
                        if (AppState.user) window.open(`https://www.roblox.com/users/${AppState.user.id}/profile`, '_blank');
                        break;
                    case 'toggle-menu': Auth.toggleMenu(); break;
                    case 'run': Scripts.execute(id); break;
                    case 'copy': Scripts.copyLoadstring(id); break;
                    case 'delete': Scripts.remove(id); break;
                    case 'edit': this.prepEdit(id); break;
                }
            });

            document.getElementById('scriptForm').addEventListener('submit', (e) => {
                e.preventDefault();
                const name = document.getElementById('scriptName').value;
                const desc = document.getElementById('scriptDesc').value;
                const code = document.getElementById('scriptCode').value;
                Scripts.create(name, desc, code);
                this.closeModal();
                e.target.reset();
            });

            this.modal.addEventListener('click', (e) => {
                if (e.target.classList.contains('modal__backdrop')) this.closeModal();
            });
            document.addEventListener('keydown', (e) => {
                if (e.key === 'Escape' && this.modal.classList.contains('is-open')) {
                    this.closeModal();
                }
            });
        },

        openModal() {
            if (!AppState.user) {
                Toast.push('Sign in to create scripts', 'warning');
                Auth.beginLogin();
                return;
            }
            this.modal.classList.add('is-open');
            this.modal.setAttribute('aria-hidden', 'false');
            document.getElementById('scriptName').focus();
        },

        closeModal() {
            this.modal.classList.remove('is-open');
            this.modal.setAttribute('aria-hidden', 'true');
            document.getElementById('scriptForm').reset();
        },

        prepEdit(id) {
            const s = AppState.scripts.find(x => x.id === id);
            if (!s) return;
            document.getElementById('scriptName').value = s.name;
            document.getElementById('scriptDesc').value = s.description;
            document.getElementById('scriptCode').value = s.code;
            this.openModal();
        },

        renderUser() {
            const btn = document.getElementById('authButton');
            const prompt = document.getElementById('loginPrompt');
            const user = AppState.user;
            if (!user || !btn) return;

            btn.outerHTML = `
                <button type="button" class="user-badge" data-action="toggle-menu" aria-haspopup="true" aria-expanded="false">
                    <img src="${user.picture || 'https://tr.rbxcdn.com/avatar-default.png'}" alt="" class="user-badge__avatar" width="28" height="28">
                    <span class="user-badge__name">${escapeHtml(user.displayName || user.name)}</span>
                </button>
            `;
            if (prompt) prompt.classList.remove('is-visible');
        },

        renderGuest() {
            const container = document.querySelector('.nav');
            const prompt = document.getElementById('loginPrompt');
            if (!container) return;

            document.querySelector('.user-menu')?.remove();

            const existing = container.querySelector('.user-badge, #authButton');
            if (existing) {
                existing.outerHTML = `
                    <button type="button" class="button button--primary" id="authButton" data-action="sign-in">
                        <span class="button__icon" aria-hidden="true">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
                        </span>
                        <span class="button__label">Sign in with Roblox</span>
                    </button>
                `;
            }
            if (prompt) prompt.classList.add('is-visible');
        }
    };

    // ============================================
    // UTILITIES
    // ============================================
    function escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = String(str);
        return div.innerHTML;
    }

    // ============================================
    // BOOT
    // ============================================
    function boot() {
        console.log('[ZP] Booting v3.1 (API Mode)');
        Env.detect();
        API.init();
        AppState.init();
        Toast.init();
        UI.init();
        Auth.handleCallback();
        Scripts.renderAll();

        if (AppState.user) {
            UI.renderUser();
            Scripts.loadAll();
        } else {
            UI.renderGuest();
        }

        console.log('[ZP] Ready');
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }
})();
