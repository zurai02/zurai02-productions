/**
 * Zurai02 Productions — Backend Layer
 * Database models, authentication logic, script management
 */

const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');

// ============================================
// DATABASE SCHEMAS
// ============================================

const UserSchema = new mongoose.Schema({
    robloxId: { type: String, required: true, unique: true, index: true },
    username: { type: String, required: true },
    displayName: { type: String },
    avatarUrl: { type: String },
    accessToken: { type: String },
    refreshToken: { type: String },
    createdAt: { type: Date, default: Date.now },
    lastLogin: { type: Date, default: Date.now }
});

const ScriptSchema = new mongoose.Schema({
    id: { type: String, required: true, unique: true, index: true },
    name: { type: String, required: true },
    description: { type: String, default: 'No description' },
    code: { type: String, required: true },
    language: { type: String, default: 'lua' },
    ownerId: { type: String, required: true, index: true },
    executions: { type: Number, default: 0 },
    lastExecuted: { type: Date },
    isPublic: { type: Boolean, default: false },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
});

const ExecutionLogSchema = new mongoose.Schema({
    scriptId: { type: String, required: true, index: true },
    userId: { type: String },
    success: { type: Boolean, default: true },
    message: { type: String },
    environment: { type: String, enum: ['executor', 'browser', 'unknown'], default: 'unknown' },
    ipHash: { type: String },
    userAgent: { type: String },
    timestamp: { type: Date, default: Date.now }
});

// ============================================
// MODELS
// ============================================

let User, Script, ExecutionLog;

function initModels() {
    User = mongoose.model('User', UserSchema);
    Script = mongoose.model('Script', ScriptSchema);
    ExecutionLog = mongoose.model('ExecutionLog', ExecutionLogSchema);
}

// ============================================
// DATABASE CONNECTION
// ============================================

async function connectDatabase(uri) {
    try {
        await mongoose.connect(uri, {
            useNewUrlParser: true,
            useUnifiedTopology: true
        });
        console.log('[DB] Connected to MongoDB');
        initModels();
        return true;
    } catch (err) {
        console.error('[DB] Connection failed:', err.message);
        return false;
    }
}

// ============================================
// AUTHENTICATION
// ============================================

const JWT_CONFIG = {
    expiresIn: '7d',
    issuer: 'zurai02-productions'
};

function generateToken(user) {
    return jwt.sign(
        {
            sub: user.robloxId,
            name: user.username,
            displayName: user.displayName,
            picture: user.avatarUrl
        },
        process.env.JWT_SECRET,
        JWT_CONFIG
    );
}

function verifyToken(token) {
    try {
        return jwt.verify(token, process.env.JWT_SECRET, { issuer: 'zurai02-productions' });
    } catch {
        return null;
    }
}

async function getUserFromToken(token) {
    const payload = verifyToken(token);
    if (!payload) return null;
    return User.findOne({ robloxId: payload.sub }).lean();
}

// ============================================
// USER OPERATIONS
// ============================================

async function findOrCreateUser(userData) {
    const existing = await User.findOne({ robloxId: userData.robloxId });
    if (existing) {
        await User.updateOne(
            { robloxId: userData.robloxId },
            {
                $set: {
                    username: userData.username,
                    displayName: userData.displayName,
                    avatarUrl: userData.avatarUrl,
                    accessToken: userData.accessToken,
                    refreshToken: userData.refreshToken,
                    lastLogin: new Date()
                }
            }
        );
        return User.findOne({ robloxId: userData.robloxId }).lean();
    }

    const user = new User(userData);
    await user.save();
    return user.toObject();
}

// ============================================
// SCRIPT OPERATIONS
// ============================================

async function createScript(ownerId, data) {
    const script = new Script({
        id: uuidv4(),
        name: data.name.trim(),
        description: (data.description || 'No description').trim(),
        code: data.code.trim(),
        language: data.language || 'lua',
        ownerId,
        isPublic: data.isPublic || false
    });
    await script.save();
    return script.toObject();
}

async function getScriptById(scriptId) {
    return Script.findOne({ id: scriptId }).lean();
}

async function getScriptsByOwner(ownerId) {
    return Script.find({ ownerId }).sort({ createdAt: -1 }).lean();
}

async function updateScript(scriptId, ownerId, updates) {
    const script = await Script.findOne({ id: scriptId, ownerId });
    if (!script) return null;

    if (updates.name) script.name = updates.name.trim();
    if (updates.description !== undefined) script.description = updates.description.trim();
    if (updates.code) script.code = updates.code.trim();
    if (updates.isPublic !== undefined) script.isPublic = updates.isPublic;

    script.updatedAt = new Date();
    await script.save();
    return script.toObject();
}

async function deleteScript(scriptId, ownerId) {
    const result = await Script.deleteOne({ id: scriptId, ownerId });
    return result.deletedCount > 0;
}

async function incrementExecutions(scriptId) {
    return Script.updateOne(
        { id: scriptId },
        {
            $inc: { executions: 1 },
            $set: { lastExecuted: new Date() }
        }
    );
}

// ============================================
// EXECUTION LOGGING
// ============================================

async function logExecution(data) {
    const log = new ExecutionLog({
        scriptId: data.scriptId,
        userId: data.userId,
        success: data.success,
        message: data.message,
        environment: data.environment,
        ipHash: data.ipHash,
        userAgent: data.userAgent
    });
    await log.save();
    return log.toObject();
}

async function getExecutionStats(ownerId) {
    const scripts = await Script.find({ ownerId }).select('id').lean();
    const scriptIds = scripts.map(s => s.id);

    const totalExecs = await ExecutionLog.countDocuments({ scriptId: { $in: scriptIds } });
    const blocked = await ExecutionLog.countDocuments({
        scriptId: { $in: scriptIds },
        success: false
    });
    const lastExec = await ExecutionLog.findOne({ scriptId: { $in: scriptIds } })
        .sort({ timestamp: -1 })
        .select('timestamp')
        .lean();

    return {
        totalScripts: scripts.length,
        totalExecutions: totalExecs,
        blockedAttempts: blocked,
        lastExecution: lastExec ? lastExec.timestamp : null
    };
}

// ============================================
// LOADSTRING GENERATION
// ============================================

function generateLoadstring(scriptId, scriptName, baseUrl) {
    const url = `${baseUrl}api/raw/${scriptId}`;
    return `-- Zurai02 Productions | ${scriptName}
local _c = game:HttpGet("${url}", true)
local _s = _c:match("<!%-%-LUA%-%->(.-)<!%/LUA%>")
if _s then
    loadstring(_s)()
else
    warn("Zurai02: Script not found")
end`;
}

// ============================================
// EXPORTS
// ============================================

module.exports = {
    connectDatabase,
    generateToken,
    verifyToken,
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
};
