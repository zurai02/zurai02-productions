/**
 * Zurai02 Productions — API Server
 * Express.js backend with MongoDB, JWT auth, Roblox OAuth
 */

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const fetch = require('node-fetch');
const path = require('path');

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
    contentSecurityPolicy: false, // Allow inline scripts for raw.html
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
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // 100 requests per window
    message: { error: 'Too many requests, please try again later.' }
});
app.use('/api/', limiter);

// Body parsing
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

// Static files (for raw.html endpoint)
app.use(express.static(path.join(__dirname, 'public')));

// ============================================
// AUTHENTICATION MIDDLEWARE
// ============================================

async function requireAuth(req, res, next) {
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
}

// ============================================
// OAUTH ROUTES
// ============================================

/**
 * GET /api/auth/url
 * Returns the Roblox OAuth authorization URL
 */
app.get('/api/auth/url', async (req, res) => {
    try {
        const state = require('crypto').randomBytes(16).toString('base64url');
        const verifier = require('crypto').randomBytes(32).toString('base64url');
        const challenge = require('crypto')
            .createHash('sha256')
            .update(verifier)
            .digest('base64url');

        // Store PKCE verifier temporarily (in production, use Redis)
        global.pkceStore = global.pkceStore || new Map();
        global.pkceStore.set(state, verifier);

        // Clean up old entries after 10 minutes
        setTimeout(() => global.pkceStore.delete(state), 10 * 60 * 1000);

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

        // Verify state and get PKCE verifier
        const verifier = global.pkceStore?.get(state);
        if (!verifier) {
            return res.status(400).json({ error: 'Invalid or expired state' });
        }
        global.pkceStore.delete(state);

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

        // Create or update user in database
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
app.get('/api/user/me', requireAuth, async (req, res) => {
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

        const script = await createScript(req.user.robloxId, {
            name,
            description,
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
// RAW SCRIPT ENDPOINT (For Executors)
# ============================================

/**
 * GET /api/raw/:id
 * Serves raw Lua code for executors
 * No authentication required — anyone with the ID can execute
 */
app.get('/api/raw/:id', async (req, res) => {
    try {
        const script = await getScriptById(req.params.id);

        if (!script) {
            return res.type('text/html').send(`<!DOCTYPE html>
<html><body><!--LUA-->
-- Script not found
-- Visit https://zurai02-productions.vercel.app/ to create scripts
--/LUA--></body></html>`);
        }

        // Log execution attempt
        await logExecution({
            scriptId: script.id,
            userId: null,
            success: true,
            message: 'Fetched via game:HttpGet',
            environment: 'executor',
            ipHash: require('crypto').createHash('sha256').update(req.ip).digest('hex').slice(0, 16),
            userAgent: req.headers['user-agent'] || 'unknown'
        });

        // Increment execution count
        await incrementExecutions(script.id);

        // Serve raw HTML with code between tags
        const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><title>ZP Raw</title>
<script>window.location.replace('/protection.html?script=${script.id}');</script>
</head><body><!--LUA-->
${script.code}
--/LUA--></body></html>`;

        res.type('text/html').send(html);
    } catch (err) {
        console.error('[Raw] Serve error:', err);
        res.type('text/html').send(`<!DOCTYPE html>
<html><body><!--LUA-->
-- Error loading script
--/LUA--></body></html>`);
    }
});

// ============================================
# STATISTICS ROUTES
# ============================================

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
# HEALTH CHECK
# ============================================

app.get('/api/health', (req, res) => {
    res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        version: '3.1.0'
    });
});

// ============================================
# ERROR HANDLING
# ============================================

app.use((err, req, res, next) => {
    console.error('[Server] Unhandled error:', err);
    res.status(500).json({ error: 'Internal server error' });
});

app.use((req, res) => {
    res.status(404).json({ error: 'Endpoint not found' });
});

// ============================================
# STARTUP
# ============================================

async function start() {
    console.log('[Server] Starting Zurai02 Productions API v3.1.0');

    // Validate environment
    const required = ['ROBLOX_CLIENT_ID', 'ROBLOX_CLIENT_SECRET', 'JWT_SECRET'];
    const missing = required.filter(key => !process.env[key]);
    if (missing.length > 0) {
        console.error('[Server] Missing environment variables:', missing.join(', '));
        console.error('[Server] Please check your .env file');
        process.exit(1);
    }

    // Connect to database
    if (process.env.MONGODB_URI) {
        const connected = await connectDatabase(process.env.MONGODB_URI);
        if (!connected) {
            console.error('[Server] Database connection failed. Starting without persistence.');
        }
    } else {
        console.warn('[Server] No MONGODB_URI provided. Running without database persistence.');
    }

    // Start server
    app.listen(PORT, () => {
        console.log(`[Server] Listening on port ${PORT}`);
        console.log(`[Server] Frontend: ${FRONTEND_URL}`);
        console.log(`[Server] Base URL: ${BASE_URL}`);
    });
}

start();
