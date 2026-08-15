/**
 * Zurai02 Productions — API Server
 * Express.js backend with MongoDB, JWT auth, Roblox OAuth
 * v3.1.0
 */

require('dotenv').config();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const fetch = require('node-fetch');
const path = require('path');
const crypto = require('crypto');

const {
    connectDatabase,
    generateToken,
    getUserFromToken,
    findOrCreateUser,
    createScript,
    getScriptById,
    getScriptsByOwner,
    updateScript,
    deleteScript,
    incrementExecutions,
    logExecution,
    getExecutionStats,
    generateLoadstring
} = require('./backend');

// ============================================
// CONFIGURATION
// ============================================

const PORT = process.env.PORT || 3000;
const FRONTEND_URL = process.env.FRONTEND_URL || 'https://zurai02-productions.vercel.app';
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;

const ROBLOX_CONFIG = {
    clientId: process.env.ROBLOX_CLIENT_ID,
    clientSecret: process.env.ROBLOX_CLIENT_SECRET,
    redirectUri: process.env.ROBLOX_REDIRECT_URI,
    authorizeUrl: 'https://apis.roblox.com/oauth/v1/authorize',
    tokenUrl: 'https://apis.roblox.com/oauth/v1/token',
    userInfoUrl: 'https://apis.roblox.com/oauth/v1/userinfo'
};

// ============================================
// EXPRESS SETUP
// ============================================

const app = express();

// Security middleware
app.use(helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false
}));

// CORS — only allow frontend origin
app.use(cors({
    origin: FRONTEND_URL,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

// Rate limiting
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests, please try again later.' }
});
app.use('/api/', limiter);

// Stricter rate limit for auth endpoints
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    message: { error: 'Too many authentication attempts.' }
});
app.use('/api/auth/', authLimiter);

// Body parsing
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

// Static files
app.use(express.static(path.join(__dirname, 'public')));

// ============================================
// PKCE STORE (Replace with Redis in production)
// ============================================

const pkceStore = new Map();

function storePKCE(state, verifier) {
    pkceStore.set(state, {
        verifier,
        expires: Date.now() + 10 * 60 * 1000
    });
}

function getPKCE(state) {
    const entry = pkceStore.get(state);
    if (!entry) return null;
    if (Date.now() > entry.expires) {
        pkceStore.delete(state);
        return null;
    }
    pkceStore.delete(state);
    return entry.verifier;
}

// Cleanup old entries every 5 minutes
setInterval(() => {
    const now = Date.now();
    for (const [state, entry] of pkceStore) {
        if (now > entry.expires) pkceStore.delete(state);
    }
}, 5 * 60 * 1000);

// ============================================
// AUTHENTICATION MIDDLEWARE
// ============================================

async function requireAuth(req, res, next) {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ error: 'Authentication required' });
        }

        const token = authHeader.slice(7);
        const user = await getUserFromToken(token);
        if (!user) {
            return res.status(401).json({ error: 'Invalid or expired token' });
        }

        req.user = user;
        next();
    } catch (err) {
        console.error('[Auth] Middleware error:', err);
        res.status(500).json({ error: 'Authentication check failed' });
    }
}

// Optional auth — populates req.user if token present, doesn't reject
async function optionalAuth(req, res, next) {
    try {
        const authHeader = req.headers.authorization;
        if (authHeader?.startsWith('Bearer ')) {
            const user = await getUserFromToken(authHeader.slice(7));
            if (user) req.user = user;
        }
        next();
    } catch {
        next();
    }
}

// ============================================
// OAUTH ROUTES
// ============================================

/**
 * GET /api/auth/url
 * Returns the Roblox OAuth authorization URL with PKCE
 */
app.get('/api/auth/url', (req, res) => {
    try {
        const state = crypto.randomBytes(16).toString('base64url');
        const verifier = crypto.randomBytes(32).toString('base64url');
        const challenge = crypto
            .createHash('sha256')
            .update(verifier)
            .digest('base64url');

        storePKCE(state, verifier);

        const params = new URLSearchParams({
            client_id: ROBLOX_CONFIG.clientId,
            redirect_uri: ROBLOX_CONFIG.redirectUri,
            scope: 'openid profile',
            response_type: 'code',
            state: state,
            code_challenge: challenge,
            code_challenge_method: 'S256'
        });

        const url = `${ROBLOX_CONFIG.authorizeUrl}?${params.toString()}`;
        res.json({ url, state });
    } catch (err) {
        console.error('[Auth] URL generation failed:', err);
        res.status(500).json({ error: 'Failed to generate authorization URL' });
    }
});

/**
 * POST /api/auth/callback
 * Exchanges authorization code for tokens
 */
app.post('/api/auth/callback', async (req, res) => {
    try {
        const { code, state } = req.body;

        if (!code || !state) {
            return res.status(400).json({ error: 'Missing code or state' });
        }

        const verifier = getPKCE(state);
        if (!verifier) {
            return res.status(400).json({ error: 'Invalid or expired state' });
        }

        // Exchange code for token
        const tokenParams = new URLSearchParams({
            grant_type: 'authorization_code',
            code,
            redirect_uri: ROBLOX_CONFIG.redirectUri,
            client_id: ROBLOX_CONFIG.clientId,
            client_secret: ROBLOX_CONFIG.clientSecret,
            code_verifier: verifier
        });

        const tokenRes = await fetch(ROBLOX_CONFIG.tokenUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: tokenParams.toString()
        });

        if (!tokenRes.ok) {
            const errorText = await tokenRes.text();
            console.error('[Auth] Token exchange failed:', tokenRes.status, errorText);
            return res.status(400).json({ error: 'Token exchange failed' });
        }

        const tokenData = await tokenRes.json();

        // Fetch user info
        const userRes = await fetch(ROBLOX_CONFIG.userInfoUrl, {
            headers: { Authorization: `Bearer ${tokenData.access_token}` }
        });

        if (!userRes.ok) {
            return res.status(400).json({ error: 'Failed to fetch user info' });
        }

        const userInfo = await userRes.json();

        // Create or update user
        const user = await findOrCreateUser({
            robloxId: userInfo.sub,
            username: userInfo.preferred_username || userInfo.name,
            displayName: userInfo.nickname || userInfo.preferred_username,
            avatarUrl: userInfo.picture,
            accessToken: tokenData.access_token,
            refreshToken: tokenData.refresh_token
        });

        // Generate JWT
        const jwtToken = generateToken(user);

        res.json({
            token: jwtToken,
            user: {
                id: user.robloxId,
                name: user.username,
                displayName: user.displayName,
                picture: user.avatarUrl
            }
        });
    } catch (err) {
        console.error('[Auth] Callback error:', err);
        res.status(500).json({ error: 'Authentication failed' });
    }
});

/**
 * POST /api/auth/refresh
 * Refreshes access token
 */
app.post('/api/auth/refresh', async (req, res) => {
    try {
        const { refreshToken } = req.body;
        if (!refreshToken) {
            return res.status(400).json({ error: 'Missing refresh token' });
        }

        const params = new URLSearchParams({
            grant_type: 'refresh_token',
            refresh_token: refreshToken,
            client_id: ROBLOX_CONFIG.clientId,
            client_secret: ROBLOX_CONFIG.clientSecret
        });

        const tokenRes = await fetch(ROBLOX_CONFIG.tokenUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: params.toString()
        });

        if (!tokenRes.ok) {
            return res.status(401).json({ error: 'Refresh failed' });
        }

        const tokenData = await tokenRes.json();
        res.json({ token: tokenData.access_token });
    } catch (err) {
        console.error('[Auth] Refresh error:', err);
        res.status(500).json({ error: 'Refresh failed' });
    }
});

// ============================================
// USER ROUTES
// ============================================

/**
 * GET /api/user/me
 * Returns current user info
 */
app.get('/api/user/me', requireAuth, (req, res) => {
    res.json({
        id: req.user.robloxId,
        name: req.user.username,
        displayName: req.user.displayName,
        picture: req.user.avatarUrl
    });
});

// ============================================
// SCRIPT ROUTES
// ============================================

/**
 * GET /api/scripts
 * List all scripts for authenticated user
 */
app.get('/api/scripts', requireAuth, async (req, res) => {
    try {
        const scripts = await getScriptsByOwner(req.user.robloxId);
        const scriptsWithLoadstrings = scripts.map(s => ({
            ...s,
            loadstring: generateLoadstring(s.id, s.name, BASE_URL + '/')
        }));
        res.json(scriptsWithLoadstrings);
    } catch (err) {
        console.error('[Scripts] List error:', err);
        res.status(500).json({ error: 'Failed to fetch scripts' });
    }
});

/**
 * POST /api/scripts
 * Create a new script
 */
app.post('/api/scripts', requireAuth, async (req, res) => {
    try {
        const { name, description, code, language } = req.body;

        if (!name || !code) {
            return res.status(400).json({ error: 'Name and code are required' });
        }

        if (name.length > 100) {
            return res.status(400).json({ error: 'Name must be under 100 characters' });
        }

        if (code.length > 50000) {
            return res.status(400).json({ error: 'Code exceeds 50KB limit' });
        }

        const script = await createScript(req.user.robloxId, {
            name: name.trim(),
            description: description?.trim(),
            code,
            language: language || 'lua'
        });

        res.status(201).json({
            ...script,
            loadstring: generateLoadstring(script.id, script.name, BASE_URL + '/')
        });
    } catch (err) {
        console.error('[Scripts] Create error:', err);
        res.status(500).json({ error: 'Failed to create script' });
    }
});

/**
 * GET /api/scripts/:id
 * Get a specific script
 */
app.get('/api/scripts/:id', requireAuth, async (req, res) => {
    try {
        const script = await getScriptById(req.params.id);
        if (!script) {
            return res.status(404).json({ error: 'Script not found' });
        }
        if (script.ownerId !== req.user.robloxId && !script.isPublic) {
            return res.status(403).json({ error: 'Access denied' });
        }
        res.json(script);
    } catch (err) {
        console.error('[Scripts] Get error:', err);
        res.status(500).json({ error: 'Failed to fetch script' });
    }
});

/**
 * PUT /api/scripts/:id
 * Update a script
 */
app.put('/api/scripts/:id', requireAuth, async (req, res) => {
    try {
        const script = await updateScript(req.params.id, req.user.robloxId, req.body);
        if (!script) {
            return res.status(404).json({ error: 'Script not found or access denied' });
        }
        res.json(script);
    } catch (err) {
        console.error('[Scripts] Update error:', err);
        res.status(500).json({ error: 'Failed to update script' });
    }
});

/**
 * DELETE /api/scripts/:id
 * Delete a script
 */
app.delete('/api/scripts/:id', requireAuth, async (req, res) => {
    try {
        const success = await deleteScript(req.params.id, req.user.robloxId);
        if (!success) {
            return res.status(404).json({ error: 'Script not found or access denied' });
        }
        res.json({ success: true });
    } catch (err) {
        console.error('[Scripts] Delete error:', err);
        res.status(500).json({ error: 'Failed to delete script' });
    }
});

// ============================================
// RAW SCRIPT ENDPOINT (Executors Only)
// ============================================

/**
 * GET /api/raw/:id
 * Serves raw Lua code for Roblox executors via game:HttpGet()
 * Browsers are redirected to a protection page
 * Executors bypass JS and read raw code between <!--LUA--> tags
 */
app.get('/api/raw/:id', optionalAuth, async (req, res) => {
    try {
        const script = await getScriptById(req.params.id);

        if (!script) {
            // Return valid Lua comment for executor — won't break scripts
            return res.type('text/plain').send(`-- [Zurai02] Script not found
-- ID: ${req.params.id}
-- Visit https://zurai02-productions.vercel.app/ to create scripts`);
        }

        // Log execution (async, don't block response)
        logExecution({
            scriptId: script.id,
            userId: req.user?.robloxId || null,
            success: true,
            message: 'Fetched via game:HttpGet',
            environment: 'executor',
            ipHash: crypto.createHash('sha256').update(req.ip).digest('hex').slice(0, 16),
            userAgent: req.headers['user-agent'] || 'unknown'
        }).catch(err => console.error('[Raw] Log failed:', err));

        // Increment execution count (fire and forget)
        incrementExecutions(script.id).catch(() => {});

        // Check if request is from a browser vs executor
        const userAgent = req.headers['user-agent'] || '';
        const isExecutor = /Roblox|HttpGet|Executor|Synapse|Krnl|Fluxus|Oxygen/i.test(userAgent) 
            || req.headers['x-executor'] 
            || !userAgent; // Some executors send no UA

        if (!isExecutor) {
            // Browser — redirect to protection page
            return res.redirect(`/protection.html?script=${encodeURIComponent(script.id)}`);
        }

        // Executor — serve raw code with minimal wrapper
        // Executors read between <!--LUA--> and --/LUA-->
        const html = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"></head><body><!--LUA-->
${script.code}
--/LUA--></body></html>`;

        res.type('text/html').send(html);

    } catch (err) {
        console.error('[Raw] Serve error:', err);
        res.type('text/plain').send('-- [Zurai02] Error loading script');
    }
});

// ============================================
// STATISTICS ROUTES
// ============================================

/**
 * GET /api/stats
 * Get execution statistics for authenticated user
 */
app.get('/api/stats', requireAuth, async (req, res) => {
    try {
        const stats = await getExecutionStats(req.user.robloxId);
        res.json(stats);
    } catch (err) {
        console.error('[Stats] Error:', err);
        res.status(500).json({ error: 'Failed to fetch statistics' });
    }
});

// ============================================
// HEALTH CHECK
// ============================================

app.get('/api/health', (req, res) => {
    res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        version: '3.1.0',
        uptime: process.uptime()
    });
});

// ============================================
// ERROR HANDLING
// ============================================

app.use((err, req, res, next) => {
    console.error('[Server] Unhandled error:', err.stack || err);
    res.status(err.status || 500).json({ 
        error: process.env.NODE_ENV === 'production' 
            ? 'Internal server error' 
            : err.message 
    });
});

app.use((req, res) => {
    res.status(404).json({ error: 'Endpoint not found' });
});

// ============================================
// STARTUP
// ============================================

async function start() {
    console.log('[Server] Starting Zurai02 Productions API v3.1.0');

    // Validate environment
    const required = ['ROBLOX_CLIENT_ID', 'ROBLOX_CLIENT_SECRET', 'JWT_SECRET'];
    const missing = required.filter(key => !process.env[key]);
    if (missing.length > 0) {
        console.error('[Server] Missing environment variables:', missing.join(', '));
        process.exit(1);
    }

    // Connect to database
    if (process.env.MONGODB_URI) {
        const connected = await connectDatabase(process.env.MONGODB_URI);
        if (!connected) {
            console.error('[Server] Database connection failed. Exiting.');
            process.exit(1);
        }
        console.log('[Server] Database connected');
    } else {
        console.warn('[Server] No MONGODB_URI provided. Running without database persistence.');
    }

    // Start server
    app.listen(PORT, () => {
        console.log(`[Server] Listening on port ${PORT}`);
        console.log(`[Server] Frontend: ${FRONTEND_URL}`);
        console.log(`[Server] Base URL: ${BASE_URL}`);
        console.log(`[Server] Environment: ${process.env.NODE_ENV || 'development'}`);
    });
}

start().catch(err => {
    console.error('[Server] Fatal startup error:', err);
    process.exit(1);
});
