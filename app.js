/**
 * Zurai02 Productions v3.0
 * Production-grade script management
 * Architecture: Event delegation, module pattern, zero global pollution
 */

(function() {
    'use strict';

    // ============================================
    // CONFIGURATION
    // ============================================
    const CONFIG = Object.freeze({
        CLIENT_ID: '3255755288279625071',
        REDIRECT_URI: 'https://zurai02-productions.vercel.app/',
        BASE_URL: 'https://zurai02-productions.vercel.app/',
        OAUTH_AUTHORIZE: 'https://apis.roblox.com/oauth/v1/authorize',
        OAUTH_TOKEN: 'https://apis.roblox.com/oauth/v1/token',
        OAUTH_USERINFO: 'https://apis.roblox.com/oauth/v1/userinfo',
        SCOPE: 'openid profile',
        STORAGE: Object.freeze({
            SCRIPTS: 'zp_scripts_v3',
            EXECS: 'zp_execs_v3',
            USER: 'zp_user_v3',
            TOKEN: 'zp_token_v3',
            REFRESH: 'zp_refresh_v3',
            STATE: 'zp_state_v3',
            PKCE: 'zp_pkce_v3'
        })
    });

    // ============================================
    // STORAGE
    // ============================================
    const Store = {
        get(key, fallback = null) {
            try {
                const raw = localStorage.getItem(key);
                return raw ? JSON.parse(raw) : fallback;
            } catch { return fallback; }
        },
        set(key, value) {
            try { localStorage.setItem(key, JSON.stringify(value)); return true; }
            catch { return false; }
        },
        remove(key) {
            try { localStorage.removeItem(key); } catch {}
        }
    };

    // ============================================
    // STATE
    // ============================================
    const AppState = {
        user: null,
        scripts: [],
        executions: [],
        isBrowser: true,

        init() {
            this.scripts = Store.get(CONFIG.STORAGE.SCRIPTS, []);
            this.executions = Store.get(CONFIG.STORAGE.EXECS, []);
            this.user = Store.get(CONFIG.STORAGE.USER, null);
        },

        persist() {
            Store.set(CONFIG.STORAGE.SCRIPTS, this.scripts);
            Store.set(CONFIG.STORAGE.EXECS, this.executions);
        }
    };

    // ============================================
    // CRYPTO / PKCE
    // ============================================
    const Crypto = {
        randomString(length = 32) {
            const buf = new Uint8Array(length);
            window.crypto.getRandomValues(buf);
            return btoa(String.fromCharCode(...buf))
                .replace(/\+/g, '-')
                .replace(/\//g, '_')
                .replace(/=/g, '')
                .slice(0, length);
        },

        async sha256(plain) {
            const encoder = new TextEncoder();
            const data = encoder.encode(plain);
            const hash = await window.crypto.subtle.digest('SHA-256', data);
            return btoa(String.fromCharCode(...new Uint8Array(hash)))
                .replace(/\+/g, '-')
                .replace(/\//g, '_')
                .replace(/=/g, '');
        }
    };

    // ============================================
    // ENVIRONMENT
    // ============================================
    const Env = {
        EXECUTOR_MARKERS: Object.freeze([
            'syn', 'krnl', 'fluxus', 'oxygen', 'electron',
            'getexecutorname', 'getscriptclosure', 'getgc',
            'getconnections', 'getloadedmodules', 'hookfunction',
            'setreadonly', 'getrawmetatable'
        ]),

        detect() {
            const found = this.EXECUTOR_MARKERS.some(m => typeof window[m] !== 'undefined');
            AppState.isBrowser = !found;
            return AppState.isBrowser;
        },

        isBrowser() { return AppState.isBrowser; }
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
    // AUTH
    // ============================================
    const Auth = {
        async buildAuthUrl() {
            const state = Crypto.randomString(32);
            sessionStorage.setItem(CONFIG.STORAGE.STATE, state);

            const verifier = Crypto.randomString(128);
            const challenge = await Crypto.sha256(verifier);
            Store.set(CONFIG.STORAGE.PKCE, verifier);

            const params = new URLSearchParams({
                client_id: CONFIG.CLIENT_ID,
                redirect_uri: CONFIG.REDIRECT_URI,
                scope: CONFIG.SCOPE,
                response_type: 'code',
                state: state,
                code_challenge: challenge,
                code_challenge_method: 'S256'
            });

            return `${CONFIG.OAUTH_AUTHORIZE}?${params.toString()}`;
        },

        async beginLogin() {
            const url = await this.buildAuthUrl();
            window.location.href = url;
        },

        async exchangeCode(code) {
            try {
                const verifier = Store.get(CONFIG.STORAGE.PKCE);
                const params = new URLSearchParams({
                    grant_type: 'authorization_code',
                    code,
                    redirect_uri: CONFIG.REDIRECT_URI,
                    client_id: CONFIG.CLIENT_ID
                });
                if (verifier) params.append('code_verifier', verifier);

                const res = await fetch(CONFIG.OAUTH_TOKEN, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                    body: params.toString()
                });

                if (!res.ok) {
                    const text = await res.text();
                    throw new Error(`${res.status}: ${text}`);
                }

                const data = await res.json();
                Store.set(CONFIG.STORAGE.TOKEN, data.access_token);
                Store.set(CONFIG.STORAGE.REFRESH, data.refresh_token);

                window.history.replaceState({}, '', window.location.pathname);
                await this.fetchUser(data.access_token);
                Toast.push('Signed in successfully', 'success');
            } catch (err) {
                console.error('[Auth] Exchange failed:', err);
                Toast.push('Authentication failed', 'error');
            }
        },

        async fetchUser(token) {
            try {
                const res = await fetch(CONFIG.OAUTH_USERINFO, {
                    headers: { Authorization: `Bearer ${token}` }
                });
                if (!res.ok) throw new Error(res.status);
                const data = await res.json();

                AppState.user = {
                    id: data.sub,
                    name: data.preferred_username || data.name,
                    displayName: data.nickname || data.preferred_username,
                    picture: data.picture
                };
                Store.set(CONFIG.STORAGE.USER, AppState.user);
                UI.renderUser();
            } catch (err) {
                console.error('[Auth] User fetch failed:', err);
                this.signOut();
            }
        },

        async tryRefresh() {
            const refresh = Store.get(CONFIG.STORAGE.REFRESH);
            if (!refresh) return false;

            try {
                const params = new URLSearchParams({
                    grant_type: 'refresh_token',
                    refresh_token: refresh,
                    client_id: CONFIG.CLIENT_ID
                });

                const res = await fetch(CONFIG.OAUTH_TOKEN, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                    body: params.toString()
                });

                if (!res.ok) throw new Error('Refresh failed');
                const data = await res.json();
                Store.set(CONFIG.STORAGE.TOKEN, data.access_token);
                Store.set(CONFIG.STORAGE.REFRESH, data.refresh_token);
                await this.fetchUser(data.access_token);
                return true;
            } catch {
                this.signOut();
                return false;
            }
        },

        handleCallback() {
            const params = new URLSearchParams(window.location.search);
            const code = params.get('code');
            const state = params.get('state');
            const error = params.get('error');
            const errorDesc = params.get('error_description');

            if (error) {
                Toast.push(`Auth error: ${errorDesc || error}`, 'error');
                return;
            }

            if (code && state) {
                const saved = sessionStorage.getItem(CONFIG.STORAGE.STATE);
                if (state !== saved) {
                    Toast.push('Security validation failed', 'error');
                    return;
                }
                this.exchangeCode(code);
            } else {
                const token = Store.get(CONFIG.STORAGE.TOKEN);
                if (token) this.fetchUser(token);
            }
        },

        signOut() {
            AppState.user = null;
            Store.remove(CONFIG.STORAGE.USER);
            Store.remove(CONFIG.STORAGE.TOKEN);
            Store.remove(CONFIG.STORAGE.REFRESH);
            Store.remove(CONFIG.STORAGE.PKCE);
            UI.renderGuest();
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
        generateId() {
            return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
        },

        generateLoadstring(id, name) {
            const url = `${CONFIG.BASE_URL}raw.html?script=${id}`;
            return `local _c = game:HttpGet("${url}", true)
local _s = _c:match("<!%-%-LUA%-%->(.-)<!%/LUA%>")
if _s then loadstring(_s)() else warn("Zurai02: Script not found") end`;
        },

        create(name, desc, code) {
            if (!AppState.user) {
                Toast.push('Authentication required', 'warning');
                Auth.beginLogin();
                return;
            }

            const script = {
                id: this.generateId(),
                name: name.trim(),
                desc: (desc || 'No description').trim(),
                code: code.trim(),
                lang: 'lua',
                execs: 0,
                last: null,
                output: '',
                owner: AppState.user.id,
                createdAt: new Date().toISOString()
            };
            script.ls = this.generateLoadstring(script.id, script.name);

            AppState.scripts.push(script);
            AppState.persist();
            this.renderAll();
            UI.updateStats();
            Toast.push('Script saved', 'success');
        },

        remove(id) {
            if (!confirm('Delete this script permanently?')) return;
            AppState.scripts = AppState.scripts.filter(s => s.id !== id);
            AppState.persist();
            this.renderAll();
            UI.updateStats();
            Toast.push('Script deleted', 'info');
        },

        copyLoadstring(id) {
            const script = AppState.scripts.find(s => s.id === id);
            if (!script) return;

            navigator.clipboard.writeText(script.ls).then(() => {
                Toast.push('Loadstring copied to clipboard', 'success');
            }).catch(() => {
                const ta = document.createElement('textarea');
                ta.value = script.ls;
                document.body.appendChild(ta);
                ta.select();
                document.execCommand('copy');
                document.body.removeChild(ta);
                Toast.push('Loadstring copied to clipboard', 'success');
            });
        },

        execute(id) {
            const script = AppState.scripts.find(s => s.id === id);
            if (!script) return;

            if (Env.isBrowser()) {
                window.open(`protection.html?script=${id}`, '_blank');
                Toast.push('Execution blocked in browser', 'warning');
                this.logExec(id, false, 'browser');
                return;
            }

            // In executor: would run actual Lua
            script.execs++;
            script.last = new Date().toISOString();
            script.output = '[Executor trace would appear here]';
            this.logExec(id, true, 'executed');
            AppState.persist();
            this.renderAll();
            UI.updateStats();
            Toast.push(`Executed (${script.execs} total)`, 'success');
        },

        logExec(id, ok, msg) {
            AppState.executions.push({
                scriptId: id,
                timestamp: new Date().toISOString(),
                success: ok,
                message: msg,
                env: Env.isBrowser() ? 'browser' : 'executor'
            });
            AppState.persist();
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
            const last = s.last ? new Date(s.last).toLocaleString() : 'Never';
            const notice = Env.isBrowser() ? `
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
                        <span class="script-item__badge">${s.lang}</span>
                    </div>
                    <p class="script-item__desc">${escapeHtml(s.desc)}</p>
                    <div class="script-item__meta">
                        <span>${s.execs} executions</span>
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
                        <code class="script-item__loadstring-code">${escapeHtml(s.ls)}</code>
                    </div>
                </article>
            `;
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
            // Event delegation — no inline handlers
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

            // Form submission
            document.getElementById('scriptForm').addEventListener('submit', (e) => {
                e.preventDefault();
                const name = document.getElementById('scriptName').value;
                const desc = document.getElementById('scriptDesc').value;
                const code = document.getElementById('scriptCode').value;
                Scripts.create(name, desc, code);
                this.closeModal();
                e.target.reset();
            });

            // Modal backdrop / escape
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
            document.getElementById('scriptDesc').value = s.desc;
            document.getElementById('scriptCode').value = s.code;
            AppState.scripts = AppState.scripts.filter(x => x.id !== id);
            AppState.persist();
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

            // Remove user menu if open
            document.querySelector('.user-menu')?.remove();

            // Rebuild auth button
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
        },

        updateStats() {
            const totalExecs = AppState.scripts.reduce((a, s) => a + s.execs, 0);
            const blocked = AppState.executions.filter(e => !e.success).length;
            const last = AppState.executions.length
                ? new Date(AppState.executions[AppState.executions.length - 1].timestamp).toLocaleTimeString()
                : 'Never';

            this.animateValue('statExecs', totalExecs);
            this.animateValue('statScripts', AppState.scripts.length);
            this.animateValue('statBlocked', blocked);
            document.getElementById('statLast').textContent = last;
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
        console.log('[ZP] Booting v3.0');
        Env.detect();
        AppState.init();
        Toast.init();
        UI.init();
        Auth.handleCallback();
        Scripts.renderAll();
        UI.updateStats();

        if (AppState.user) UI.renderUser();
        else UI.renderGuest();

        console.log('[ZP] Ready');
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }
})();
