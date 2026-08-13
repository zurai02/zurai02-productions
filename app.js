// Zurai02 Productions - App.js
// Roblox OAuth Login Integration

const CONFIG = {
    CLIENT_ID: "3255755288279625071",
    CLIENT_SECRET: "RBX-cE3K03ijx0OmTf3zok1KFawge5PUR3Lld1pnkpTDUlxg72aKOndGdS0J7B9xhLf5",
    REDIRECT_URI: "https://zurai02.github.io/zurai02-productions/index.html",
    OAUTH_BASE: "https://authorize.roblox.com/",
    TOKEN_URL: "https://apis.roblox.com/oauth/v1/token",
    USERINFO_URL: "https://apis.roblox.com/oauth/v1/userinfo",
    SCOPE: "openid profile"
};

// State management
let currentUser = null;
let scripts = JSON.parse(localStorage.getItem('zp_scripts')) || [];
let execs = JSON.parse(localStorage.getItem('zp_execs')) || [];
let isBrowser = true;

// DOM Elements
const loginBtn = document.getElementById('loginBtn');
const modal = document.getElementById('modal');
const scriptGrid = document.getElementById('scriptGrid');
const empty = document.getElementById('empty');
const toasts = document.getElementById('toasts');

// ========================
// OAUTH LOGIN SYSTEM
// ========================

function generateState() {
    const state = btoa(crypto.getRandomValues(new Uint8Array(16)).join('')).slice(0, 32);
    sessionStorage.setItem('oauth_state', state);
    return state;
}

function buildOAuthUrl() {
    const state = generateState();
    const params = new URLSearchParams({
        client_id: CONFIG.CLIENT_ID,
        redirect_uri: CONFIG.REDIRECT_URI,
        scope: CONFIG.SCOPE,
        response_type: "code",
        state: state
    });
    return `${CONFIG.OAUTH_BASE}?${params.toString()}`;
}

function handleLogin() {
    window.location.href = buildOAuthUrl();
}

async function exchangeCodeForToken(code) {
    try {
        const params = new URLSearchParams({
            grant_type: 'authorization_code',
            code: code,
            redirect_uri: CONFIG.REDIRECT_URI,
            client_id: CONFIG.CLIENT_ID,
            client_secret: CONFIG.CLIENT_SECRET
        });

        const response = await fetch(CONFIG.TOKEN_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: params.toString()
        });

        if (!response.ok) {
            const errText = await response.text();
            throw new Error(`Token exchange failed: ${response.status} - ${errText}`);
        }

        const data = await response.json();
        localStorage.setItem('roblox_access_token', data.access_token);
        localStorage.setItem('roblox_refresh_token', data.refresh_token);

        // Clear URL params
        window.history.replaceState({}, document.title, window.location.pathname);

        await fetchUserInfo(data.access_token);
        toast('Successfully logged in with Roblox!', 'ok');
    } catch (err) {
        console.error('Token exchange error:', err);
        toast('Failed to complete login. Please try again.', 'err');
    }
}

async function fetchUserInfo(accessToken) {
    try {
        const response = await fetch(CONFIG.USERINFO_URL, {
            headers: {
                'Authorization': `Bearer ${accessToken}`
            }
        });

        if (!response.ok) {
            if (response.status === 401) {
                await refreshToken();
                return;
            }
            throw new Error(`Failed to fetch user info: ${response.status}`);
        }

        const userData = await response.json();
        currentUser = {
            id: userData.sub,
            name: userData.preferred_username || userData.name,
            displayName: userData.nickname || userData.preferred_username,
            picture: userData.picture
        };

        localStorage.setItem('zurai_user', JSON.stringify(currentUser));
        updateUIForLoggedInUser();
    } catch (err) {
        console.error('User info error:', err);
        logout();
    }
}

async function refreshToken() {
    const refreshToken = localStorage.getItem('roblox_refresh_token');
    if (!refreshToken) {
        logout();
        return;
    }

    try {
        const params = new URLSearchParams({
            grant_type: 'refresh_token',
            refresh_token: refreshToken,
            client_id: CONFIG.CLIENT_ID,
            client_secret: CONFIG.CLIENT_SECRET
        });

        const response = await fetch(CONFIG.TOKEN_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: params.toString()
        });

        if (!response.ok) throw new Error('Refresh failed');

        const data = await response.json();
        localStorage.setItem('roblox_access_token', data.access_token);
        localStorage.setItem('roblox_refresh_token', data.refresh_token);
        await fetchUserInfo(data.access_token);
    } catch (err) {
        console.error('Refresh error:', err);
        logout();
    }
}

function updateUIForLoggedInUser() {
    if (!currentUser || !loginBtn) return;

    loginBtn.innerHTML = `
        <img src="${currentUser.picture || 'https://tr.rbxcdn.com/avatar-default.png'}" 
             alt="${currentUser.name}" 
             style="width:28px;height:28px;border-radius:50%;vertical-align:middle;margin-right:8px;border:2px solid #64ffda;">
        <span>${escHtml(currentUser.displayName || currentUser.name)}</span>
    `;
    loginBtn.onclick = showUserMenu;
    loginBtn.style.background = 'linear-gradient(135deg, #1a1a2e, #2a2a4e)';
    loginBtn.style.border = '1px solid #667eea';
}

function showUserMenu() {
    // Remove existing menu
    const existing = document.querySelector('.user-menu');
    if (existing) existing.remove();

    const menu = document.createElement('div');
    menu.className = 'user-menu';
    menu.innerHTML = `
        <div class="user-menu-item" onclick="viewProfile()">👤 View Profile</div>
        <div class="user-menu-item" onclick="logout()" style="color:#f87171">🚪 Logout</div>
    `;
    loginBtn.parentElement.appendChild(menu);

    setTimeout(() => {
        document.addEventListener('click', function closeMenu(e) {
            if (!menu.contains(e.target) && e.target !== loginBtn) {
                menu.remove();
                document.removeEventListener('click', closeMenu);
            }
        });
    }, 10);
}

function viewProfile() {
    if (currentUser) {
        window.open(`https://www.roblox.com/users/${currentUser.id}/profile`, '_blank');
    }
}

function logout() {
    localStorage.removeItem('roblox_access_token');
    localStorage.removeItem('roblox_refresh_token');
    localStorage.removeItem('zurai_user');
    currentUser = null;

    if (loginBtn) {
        loginBtn.innerHTML = '🔐 Login with Roblox';
        loginBtn.onclick = handleLogin;
        loginBtn.style.background = '';
        loginBtn.style.border = '';
    }

    toast('Logged out successfully', 'info');
}

function checkOAuthCallback() {
    const urlParams = new URLSearchParams(window.location.search);
    const code = urlParams.get('code');
    const state = urlParams.get('state');
    const error = urlParams.get('error');
    const errorDesc = urlParams.get('error_description');

    if (error) {
        console.error('OAuth error:', error, errorDesc);
        toast(`Login failed: ${errorDesc || error}`, 'err');
        return;
    }

    if (code && state) {
        const savedState = sessionStorage.getItem('oauth_state');
        if (state !== savedState) {
            toast('Invalid state parameter. Security check failed.', 'err');
            return;
        }
        exchangeCodeForToken(code);
    } else {
        // Check for existing session
        const token = localStorage.getItem('roblox_access_token');
        if (token) {
            fetchUserInfo(token);
        }
    }
}

// ========================
// SCRIPT MANAGEMENT (FIXED)
// ========================

function detect() {
    const e = ['syn', 'krnl', 'fluxus', 'getexecutorname', 'getgc', 'getconnections', 'getloadedmodules', 'hookfunction'];
    isBrowser = !e.some(x => typeof window[x] !== 'undefined');
}

function initParticles() {
    const c = document.getElementById('particles');
    for (let i = 0; i < 35; i++) {
        const p = document.createElement('div');
        p.className = 'particle';
        p.style.left = Math.random() * 100 + '%';
        p.style.animationDelay = Math.random() * 20 + 's';
        p.style.animationDuration = (12 + Math.random() * 10) + 's';
        p.style.opacity = Math.random() * .4 + .1;
        c.appendChild(p);
    }
}

function openModal() {
    if (!currentUser) {
        toast('Please login with Roblox to create scripts', 'err');
        handleLogin();
        return;
    }
    modal.classList.add('active');
    document.getElementById('sName').focus();
}

function closeModal() {
    modal.classList.remove('active');
    ['sName', 'sDesc', 'sCode'].forEach(x => document.getElementById(x).value = '');
}

function saveScript() {
    if (!currentUser) {
        toast('Please login to save scripts', 'err');
        return;
    }
    const n = document.getElementById('sName').value.trim(),
        d = document.getElementById('sDesc').value.trim(),
        c = document.getElementById('sCode').value.trim();
    if (!n || !c) { toast('Name and code required!', 'err'); return; }
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2);
    scripts.push({
        id: id,
        name: n,
        desc: d || 'No description',
        lang: 'lua',
        code: c,
        execs: 0,
        last: null,
        output: '',
        ls: genLoadstring(id, n),
        owner: currentUser.id
    });
    save();
    render();
    updateStats();
    closeModal();
    toast('Script saved!', 'ok');
}

function delScript(id) {
    if (!confirm('Delete this script?')) return;
    scripts = scripts.filter(s => s.id !== id);
    save();
    render();
    updateStats();
    toast('Deleted', 'info');
}

function editScript(id) {
    const s = scripts.find(x => x.id === id);
    if (!s) return;
    document.getElementById('sName').value = s.name;
    document.getElementById('sDesc').value = s.desc;
    document.getElementById('sCode').value = s.code;
    scripts = scripts.filter(x => x.id !== id);
    openModal();
}

// FIXED: Proper loadstring generation with correct URL and pattern
function genLoadstring(id, name) {
    // Get the base URL - works on both GitHub Pages and local
    let base = window.location.origin + window.location.pathname;
    // Remove any filename to get the directory
    base = base.replace(/[^/]*$/, '');
    // Ensure trailing slash
    if (!base.endsWith('/')) base += '/';

    const url = base + 'index.html?script=' + id;

    // The Lua pattern must match: <!--LUA-->
...code...
<!--/LUA-->
    // In Lua string patterns: <!%-%-LUA%-%->(.-)<!%/LUA%>
    // Note: The closing tag in HTML is <!--/LUA--> but in Lua pattern we escape it

    return `-- Zurai02 Productions | ${name}
local _c = game:HttpGet("${url}", true)
local _s = _c:match("<!%-%-LUA%-%->(.-)<!%/LUA%>")
if _s then
    loadstring(_s)()
else
    warn("Zurai02: Script not found or failed to load")
end`;
}

function copyLoadstring(id) {
    const s = scripts.find(x => x.id === id);
    if (!s) return;
    navigator.clipboard.writeText(s.ls).then(() => toast('Loadstring copied! Paste in executor.', 'ok')).catch(() => {
        const ta = document.createElement('textarea');
        ta.value = s.ls;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        toast('Loadstring copied! Paste in executor.', 'ok');
    });
}

function runScript(id) {
    const s = scripts.find(x => x.id === id);
    if (!s) return;
    if (isBrowser) {
        window.open('protection.html?script=' + s.id + '&name=' + encodeURIComponent(s.name), '_blank');
        toast('Browser cannot execute scripts. Opening protection page...', 'err');
        logExec(id, false, 'Browser blocked - sent to protection');
        return;
    }
    let output = '';
    let success = true;
    try { output = execLua(s.code); } catch (e) { output = 'Error: ' + e.message; success = false; }
    s.execs++;
    s.last = new Date().toISOString();
    s.output = output;
    logExec(id, success, success ? 'Executed' : 'Error');
    save();
    updateStats();
    render();
    toast(success ? 'Executed! (' + s.execs + ' total)' : 'Failed', success ? 'ok' : 'err');
}

function execLua(code) {
    const out = [];
    code.split('\n').forEach(l => {
        const t = l.trim();
        if (!t) return;
        if (t.startsWith('--')) { out.push('💬 ' + t); return; }
        if (t.startsWith('local ')) {
            const m = t.match(/local\s+(\w+)/);
            out.push('📦 local ' + (m ? m[1] : 'var'));
        } else if (t.startsWith('function')) {
            out.push('🔧 Function');
        } else if (t === 'end') {
            out.push('🔚 end');
        } else if (t.startsWith('if ')) {
            out.push('❓ if');
        } else if (t.startsWith('for ') || t.startsWith('while ')) {
            out.push('🔄 Loop');
        } else if (t.startsWith('print')) {
            const m = t.match(/print\s*\((.+)\)/);
            out.push('🖨️  >> ' + (m ? m[1].replace(/["']/g, '').replace(/\.\./g, '') : ''));
        } else if (t.startsWith('game:') || t.startsWith('workspace') || t.startsWith('Players')) {
            out.push('🎮 Roblox API: ' + t.substring(0, 45));
        } else {
            out.push('▶️ ' + t.substring(0, 50));
        }
    });
    return out.join('\n') || '[Lua trace done]';
}

function logExec(sid, ok, msg) {
    execs.push({ sid, t: new Date().toISOString(), ok, msg, env: isBrowser ? 'browser' : 'executor' });
    save();
}

function render() {
    if (!scripts.length) { scriptGrid.innerHTML = ''; empty.style.display = 'block'; return; }
    empty.style.display = 'none';
    scriptGrid.innerHTML = scripts.map(s => {
        const le = s.last ? new Date(s.last).toLocaleString() : 'Never';
        const out = s.output ? `<div class="output active">${escHtml(s.output)}</div>` : '';
        const lsbox = `<div class="loadstring-box active"><label>📋 Copy this loadstring into your executor</label><div class="loadstring-text">${escHtml(s.ls)}</div></div>`;
        const browserBlock = isBrowser ? `<div class="browser-block active"><h3>🛡️ This script was protected by Zurai02 Productions</h3><p>This script cannot be executed from a browser. Copy the loadstring below and paste it into your Roblox executor.</p><button class="btn btn-copy btn-sm" onclick="copyLoadstring('${s.id}')">📋 Copy Loadstring</button></div>` : '';
        return `<div class="card"><div class="card-head"><div class="card-name">${escHtml(s.name)}</div><div class="card-lang">Lua</div></div><div class="card-desc">${escHtml(s.desc)}</div><div class="card-meta"><span>▶️ ${s.execs} executions</span><span>🕐 ${le}</span></div><div class="card-actions"><button class="run" onclick="runScript('${s.id}')">▶️ Run</button><button class="copy-btn" onclick="copyLoadstring('${s.id}')">📋 Copy</button><button class="del" onclick="delScript('${s.id}')">🗑️</button></div>${browserBlock}${lsbox}${out}</div>`;
    }).join('');
}

function updateStats() {
    const te = scripts.reduce((a, s) => a + s.execs, 0),
        tb = execs.filter(e => !e.ok).length,
        tl = execs.length ? new Date(execs[execs.length - 1].t).toLocaleTimeString() : 'Never';
    anim('tExec', te);
    anim('tScript', scripts.length);
    anim('tBlock', tb);
    document.getElementById('tLast').textContent = tl;
}

function anim(id, end) {
    const el = document.getElementById(id), st = parseInt(el.textContent) || 0;
    if (st === end) return;
    const d = 800, step = Math.max(30, Math.floor(d / Math.abs(end - st)));
    let cv = st;
    const t = setInterval(() => { cv += st < end ? 1 : -1; el.textContent = cv; if (cv === end) clearInterval(t); }, step);
}

function save() {
    try {
        localStorage.setItem('zp_scripts', JSON.stringify(scripts));
        localStorage.setItem('zp_execs', JSON.stringify(execs));
    } catch (e) { }
}

function load() {
    try {
        const sc = localStorage.getItem('zp_scripts'), ex = localStorage.getItem('zp_execs');
        if (sc) scripts = JSON.parse(sc);
        if (ex) execs = JSON.parse(ex);
        scripts.forEach(s => {
            if (!s.ls) s.ls = genLoadstring(s.id, s.name);
            if (!s.lang) s.lang = 'lua';
        });
        render();
        updateStats();
    } catch (e) { }
}

function escHtml(t) {
    const d = document.createElement('div');
    d.textContent = t;
    return d.innerHTML;
}

function toast(msg, type = 'info') {
    const t = document.createElement('div');
    t.className = 'toast ' + (type === 'ok' ? 'ok' : type === 'err' ? 'err' : '');
    t.innerHTML = (type === 'ok' ? '✅' : type === 'err' ? '❌' : 'ℹ️') + ' ' + escHtml(msg);
    toasts.appendChild(t);
    setTimeout(() => {
        t.style.opacity = '0';
        t.style.transform = 'translateX(120%)';
        setTimeout(() => t.remove(), 300);
    }, 4000);
}

// ========================
// INITIALIZATION
// ========================

document.addEventListener('DOMContentLoaded', () => {
    detect();
    initParticles();
    checkOAuthCallback();
    load();

    // Check for existing session
    const savedUser = localStorage.getItem('zurai_user');
    if (savedUser) {
        currentUser = JSON.parse(savedUser);
        updateUIForLoggedInUser();
    }

    modal.addEventListener('click', e => { if (e.target === modal) closeModal(); });
    document.addEventListener('keydown', e => {
        if (e.key === 'Escape') closeModal();
        if (e.ctrlKey && e.key === 'n') { e.preventDefault(); openModal(); }
    });
    document.querySelectorAll('.nav a').forEach(a => {
        a.addEventListener('click', () => {
            document.querySelectorAll('.nav a').forEach(x => x.classList.remove('active'));
            a.classList.add('active');
        });
    });
});

// Global exports
window.openModal = openModal;
window.closeModal = closeModal;
window.saveScript = saveScript;
window.delScript = delScript;
window.runScript = runScript;
window.editScript = editScript;
window.copyLoadstring = copyLoadstring;
window.handleLogin = handleLogin;
window.logout = logout;
window.viewProfile = viewProfile;
