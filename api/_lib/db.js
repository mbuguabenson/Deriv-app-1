'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// On Vercel/serverless the CWD is read-only — use /tmp which is always writable.
// Locally, prefer the project-level data/ directory so JSON files persist across restarts.
const preferredDataDir = path.resolve(process.cwd(), 'data');
const DATA_DIR = (() => {
    try {
        if (!fs.existsSync(preferredDataDir)) {
            fs.mkdirSync(preferredDataDir, { recursive: true });
        }
        // Quick write-test
        const testFile = path.join(preferredDataDir, '.write_test');
        fs.writeFileSync(testFile, '1');
        fs.unlinkSync(testFile);
        return preferredDataDir;
    } catch {
        // Fallback to /tmp (Vercel serverless environment)
        const tmpDir = '/tmp/profithub-data';
        try { fs.mkdirSync(tmpDir, { recursive: true }); } catch {}
        return tmpDir;
    }
})();


const safeReadJSON = (filePath, fallback) => {
    if (!fs.existsSync(filePath)) {
        try {
            fs.writeFileSync(filePath, JSON.stringify(fallback, null, 2), 'utf8');
        } catch (e) {
            console.error(`[DB] Error initializing ${filePath}:`, e.message);
        }
        return fallback;
    }
    try {
        const raw = fs.readFileSync(filePath, 'utf8');
        return JSON.parse(raw);
    } catch (err) {
        console.error(`[DB] Error reading ${filePath}:`, err.message);
        return fallback;
    }
};

const safeWriteJSON = (filePath, data) => {
    try {
        const tempPath = `${filePath}.tmp.${Date.now()}`;
        fs.writeFileSync(tempPath, JSON.stringify(data, null, 2), 'utf8');
        fs.renameSync(tempPath, filePath);
        return true;
    } catch (err) {
        console.error(`[DB] Error writing ${filePath}:`, err.message);
        return false;
    }
};


// File paths
const FILES = {
    AUTH: path.join(DATA_DIR, 'admin-auth.json'),
    SESSIONS: path.join(DATA_DIR, 'admin-sessions.json'),
    ANALYTICS: path.join(DATA_DIR, 'analytics-data.json'),
    LOGINS: path.join(DATA_DIR, 'trader-logins.json'),
    CONFIG: path.join(DATA_DIR, 'site-config.json'),
    AUDIT: path.join(DATA_DIR, 'admin-audit.json'),
    BOTS: path.join(DATA_DIR, 'uploaded-bots.json'),
    LOGS: path.join(DATA_DIR, 'system-logs.json'),
    TRANSACTIONS: path.join(DATA_DIR, 'transactions.json'),
    COMMISSIONS: path.join(DATA_DIR, 'commissions.json'),
    BLOCKED: path.join(DATA_DIR, 'blocked-users.json'),
    USER_TRADES: path.join(DATA_DIR, 'user-trades.json'),
};

// In-memory cache for fast telemetry writes & debounced flush
let analyticsData = null;
let activeHeartbeats = new Map(); // sessionId -> { timestamp, ip, userAgent, path, loginid }
let dirtyAnalytics = false;

// ─── ADMIN USERS & AUTH ───────────────────────────────────────────────────────

const hashPassword = (password, salt) => {
    const s = salt || crypto.randomBytes(16).toString('hex');
    const hash = crypto.pbkdf2Sync(password, s, 1000, 64, 'sha512').toString('hex');
    return { salt: s, hash };
};

const verifyPassword = (password, storedHash, salt) => {
    if (!storedHash) return false;
    // Support plain text fallback for initial seed passwords
    if (!salt && storedHash === password) return true;
    if (!salt) return false;
    const computed = crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
    return computed === storedHash;
};

const getAdminDB = () => {
    const fallback = {
        users: [
            {
                id: 'usr_superadmin_01',
                username: process.env.ADMIN_USERNAME || 'Admin_profithub',
                password: process.env.ADMIN_PASSWORD || 'Access@profithub2026',
                salt: null,
                role: 'super_admin',
                permissions: ['all'],
                created_at: new Date().toISOString(),
                last_login: null,
                status: 'active',
            },
            {
                id: 'usr_admin_02',
                username: 'admin',
                password: 'admin123',
                salt: null,
                role: 'administrator',
                permissions: ['manage_content', 'view_analytics', 'view_transactions'],
                created_at: new Date().toISOString(),
                last_login: null,
                status: 'active',
            },
        ],
    };
    const db = safeReadJSON(FILES.AUTH, fallback);
    if (!Array.isArray(db.users)) {
        db.users = fallback.users;
    }
    return db;
};

const saveAdminDB = (db) => safeWriteJSON(FILES.AUTH, db);

const getAdminAudit = () => safeReadJSON(FILES.AUDIT, { logs: [] });
const addAdminAudit = (action, details, actor = 'system') => {
    const audit = getAdminAudit();
    audit.logs = audit.logs || [];
    audit.logs.unshift({
        id: `aud_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
        action,
        details,
        actor,
        timestamp: new Date().toISOString(),
    });
    // Keep last 1000 audit items
    if (audit.logs.length > 1000) audit.logs = audit.logs.slice(0, 1000);
    safeWriteJSON(FILES.AUDIT, audit);
};

const getAdminSessions = () => safeReadJSON(FILES.SESSIONS, { sessions: {} });
const saveAdminSessions = (data) => safeWriteJSON(FILES.SESSIONS, data);

const authenticateAdmin = (username, password, clientInfo = {}) => {
    const db = getAdminDB();
    const uname = (username || '').trim().toLowerCase();
    const user = db.users.find(u => u.username.toLowerCase() === uname);

    if (!user) {
        addAdminAudit('LOGIN_FAILED', { username, reason: 'User not found', ip: clientInfo.ip }, 'unauthenticated');
        return { success: false, error: 'Invalid username or password' };
    }

    if (user.status === 'suspended') {
        addAdminAudit('LOGIN_BLOCKED', { username, reason: 'Account suspended', ip: clientInfo.ip }, username);
        return { success: false, error: 'Account is suspended. Contact Super Admin.' };
    }

    const isValid = verifyPassword(password, user.password, user.salt);
    if (!isValid) {
        addAdminAudit('LOGIN_FAILED', { username, reason: 'Bad password', ip: clientInfo.ip }, username);
        return { success: false, error: 'Invalid username or password' };
    }

    // Generate secure session token
    const token = `ph_adm_${crypto.randomBytes(32).toString('hex')}`;
    const expiresAt = Date.now() + 24 * 60 * 60 * 1000; // 24 hours

    const sessionsData = getAdminSessions();
    sessionsData.sessions = sessionsData.sessions || {};
    sessionsData.sessions[token] = {
        userId: user.id,
        username: user.username,
        role: user.role,
        permissions: user.permissions || [],
        createdAt: new Date().toISOString(),
        expiresAt,
        ip: clientInfo.ip || 'unknown',
        userAgent: clientInfo.userAgent || 'unknown',
    };
    saveAdminSessions(sessionsData);

    // Update user last_login
    user.last_login = new Date().toISOString();
    user.last_ip = clientInfo.ip || null;
    saveAdminDB(db);

    addAdminAudit('LOGIN_SUCCESS', { username: user.username, role: user.role, ip: clientInfo.ip }, user.username);

    return {
        success: true,
        token,
        user: {
            id: user.id,
            username: user.username,
            role: user.role,
            permissions: user.permissions || [],
            last_login: user.last_login,
        },
    };
};

const verifySession = (token) => {
    if (!token) return null;
    const cleanToken = token.replace('Bearer ', '').trim();
    const sessionsData = getAdminSessions();
    const sess = sessionsData.sessions?.[cleanToken];
    if (!sess) return null;
    if (Date.now() > sess.expiresAt) {
        delete sessionsData.sessions[cleanToken];
        saveAdminSessions(sessionsData);
        return null;
    }
    return sess;
};

const logoutAdmin = (token) => {
    if (!token) return true;
    const cleanToken = token.replace('Bearer ', '').trim();
    const sessionsData = getAdminSessions();
    if (sessionsData.sessions?.[cleanToken]) {
        const sess = sessionsData.sessions[cleanToken];
        delete sessionsData.sessions[cleanToken];
        saveAdminSessions(sessionsData);
        addAdminAudit('LOGOUT', { username: sess.username }, sess.username);
    }
    return true;
};

const listAdmins = () => {
    const db = getAdminDB();
    return db.users.map(u => ({
        id: u.id,
        username: u.username,
        role: u.role,
        permissions: u.permissions || [],
        created_at: u.created_at,
        last_login: u.last_login,
        status: u.status || 'active',
    }));
};

const createAdminUser = ({ username, password, role = 'administrator', permissions = ['view_analytics'], actor = 'super_admin' }) => {
    const db = getAdminDB();
    const trimmed = (username || '').trim();
    if (!trimmed || trimmed.length < 3) {
        return { success: false, error: 'Username must be at least 3 characters long' };
    }
    if (!password || password.length < 6) {
        return { success: false, error: 'Password must be at least 6 characters long' };
    }

    if (db.users.some(u => u.username.toLowerCase() === trimmed.toLowerCase())) {
        return { success: false, error: 'An admin with this username already exists' };
    }

    const { salt, hash } = hashPassword(password);
    const newAdmin = {
        id: `usr_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`,
        username: trimmed,
        password: hash,
        salt,
        role,
        permissions: role === 'super_admin' ? ['all'] : permissions,
        created_at: new Date().toISOString(),
        last_login: null,
        status: 'active',
        created_by: actor,
    };

    db.users.push(newAdmin);
    saveAdminDB(db);

    addAdminAudit('ADMIN_CREATED', { createdUser: trimmed, role, actor }, actor);

    return {
        success: true,
        admin: {
            id: newAdmin.id,
            username: newAdmin.username,
            role: newAdmin.role,
            permissions: newAdmin.permissions,
            created_at: newAdmin.created_at,
            status: newAdmin.status,
        },
    };
};

const updateAdminUser = (id, updates, actor = 'super_admin') => {
    const db = getAdminDB();
    const userIndex = db.users.findIndex(u => u.id === id);
    if (userIndex === -1) {
        return { success: false, error: 'Admin user not found' };
    }

    const user = db.users[userIndex];

    if (updates.password) {
        if (updates.password.length < 6) {
            return { success: false, error: 'New password must be at least 6 characters long' };
        }
        const { salt, hash } = hashPassword(updates.password);
        user.password = hash;
        user.salt = salt;
    }

    if (updates.role && ['super_admin', 'administrator', 'manager', 'analyst', 'support'].includes(updates.role)) {
        user.role = updates.role;
        if (updates.role === 'super_admin') {
            user.permissions = ['all'];
        }
    }

    if (Array.isArray(updates.permissions) && user.role !== 'super_admin') {
        user.permissions = updates.permissions;
    }

    if (updates.status && ['active', 'suspended'].includes(updates.status)) {
        // Prevent suspending the last super admin
        if (updates.status === 'suspended' && user.role === 'super_admin') {
            const activeSuperAdmins = db.users.filter(u => u.role === 'super_admin' && u.status !== 'suspended');
            if (activeSuperAdmins.length <= 1) {
                return { success: false, error: 'Cannot suspend the only active Super Admin' };
            }
        }
        user.status = updates.status;
    }

    saveAdminDB(db);
    addAdminAudit('ADMIN_UPDATED', { targetId: id, username: user.username, updates: Object.keys(updates) }, actor);

    return {
        success: true,
        admin: {
            id: user.id,
            username: user.username,
            role: user.role,
            permissions: user.permissions,
            status: user.status,
            last_login: user.last_login,
        },
    };
};

const deleteAdminUser = (id, actor = 'super_admin') => {
    const db = getAdminDB();
    const user = db.users.find(u => u.id === id);
    if (!user) {
        return { success: false, error: 'Admin user not found' };
    }

    if (user.role === 'super_admin') {
        const superAdmins = db.users.filter(u => u.role === 'super_admin');
        if (superAdmins.length <= 1) {
            return { success: false, error: 'Cannot delete the only Super Admin account' };
        }
    }

    db.users = db.users.filter(u => u.id !== id);
    saveAdminDB(db);

    addAdminAudit('ADMIN_DELETED', { deletedUser: user.username, actor }, actor);

    return { success: true };
};

// ─── ANALYTICS & TELEMETRY ENGINE ─────────────────────────────────────────────

const initAnalytics = () => {
    if (analyticsData) return analyticsData;
    const fallback = {
        totalPageViews: 0,
        uniqueVisitors: 0,
        eventsCount: 0,
        hourlyHistory: {}, // 'YYYY-MM-DD-HH': count
        dailyHistory: {}, // 'YYYY-MM-DD': count
        toolUsage: {
            'digit-cracker': 0,
            'bot-builder': 0,
            'auto-x-eo': 0,
            'copy-trading': 0,
            'signals': 0,
            'dtrader': 0,
            'chart': 0,
            'analysis-tool': 0,
            'other': 0,
        },
        pageHits: {}, // path -> count
        deviceStats: { desktop: 0, mobile: 0, tablet: 0 },
        browserStats: {},
        recentEvents: [],
    };
    analyticsData = safeReadJSON(FILES.ANALYTICS, fallback);
    return analyticsData;
};

const flushAnalyticsDisk = () => {
    if (!dirtyAnalytics || !analyticsData) return;
    safeWriteJSON(FILES.ANALYTICS, analyticsData);
    dirtyAnalytics = false;
};

// Periodic flush every 15 seconds
setInterval(flushAnalyticsDisk, 15000);

const trackTelemetryEvent = (event) => {
    const data = initAnalytics();
    const now = new Date();
    const timestamp = now.toISOString();
    const hourKey = `${now.toISOString().slice(0, 10)}-${String(now.getHours()).padStart(2, '0')}`;
    const dayKey = now.toISOString().slice(0, 10);

    const {
        eventType = 'page_view',
        path = '/',
        sessionId = `sess_${Math.random().toString(36).substr(2, 9)}`,
        loginid = null,
        device = 'desktop',
        browser = 'Chrome',
        referrer = '',
        metadata = {},
        ip = '127.0.0.1',
        userAgent = '',
    } = event;

    // Track active heartbeat
    activeHeartbeats.set(sessionId, {
        timestamp: Date.now(),
        path,
        loginid,
        device,
        ip,
        userAgent,
    });

    data.eventsCount = (data.eventsCount || 0) + 1;

    if (eventType === 'page_view') {
        data.totalPageViews = (data.totalPageViews || 0) + 1;
        const normalizedPath = (path || '/').split('?')[0];
        data.pageHits[normalizedPath] = (data.pageHits[normalizedPath] || 0) + 1;

        // Hour & Day rollups
        data.hourlyHistory[hourKey] = (data.hourlyHistory[hourKey] || 0) + 1;
        data.dailyHistory[dayKey] = (data.dailyHistory[dayKey] || 0) + 1;

        // Device
        const devKey = ['mobile', 'tablet', 'desktop'].includes(device) ? device : 'desktop';
        data.deviceStats[devKey] = (data.deviceStats[devKey] || 0) + 1;

        // Browser
        if (browser) {
            data.browserStats[browser] = (data.browserStats[browser] || 0) + 1;
        }

        // Tool categorization
        for (const tool of Object.keys(data.toolUsage)) {
            if (normalizedPath.includes(tool)) {
                data.toolUsage[tool] = (data.toolUsage[tool] || 0) + 1;
            }
        }
    } else if (eventType === 'tool_action' || eventType === 'bot_run') {
        const toolName = metadata.tool || path.replace('/', '') || 'other';
        data.toolUsage[toolName] = (data.toolUsage[toolName] || 0) + 1;
    }

    // Keep ring buffer of recent 200 events
    data.recentEvents.unshift({
        id: `ev_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
        eventType,
        path,
        sessionId,
        loginid,
        device,
        ip,
        timestamp,
        metadata,
    });

    if (data.recentEvents.length > 200) {
        data.recentEvents = data.recentEvents.slice(0, 200);
    }

    dirtyAnalytics = true;
    return true;
};

const getLiveActiveVisitorsCount = () => {
    const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;
    let count = 0;
    const activeList = [];

    for (const [sessId, info] of activeHeartbeats.entries()) {
        if (info.timestamp > fiveMinutesAgo) {
            count++;
            activeList.push({ sessionId: sessId, ...info });
        } else {
            activeHeartbeats.delete(sessId);
        }
    }

    return { count, activeList };
};

const getAnalyticsSummary = () => {
    const data = initAnalytics();
    const { count: liveActiveCount, activeList } = getLiveActiveVisitorsCount();

    // Prepare last 24 hours timeline
    const now = new Date();
    const timeline24h = [];
    for (let i = 23; i >= 0; i--) {
        const d = new Date(now.getTime() - i * 3600 * 1000);
        const hourKey = `${d.toISOString().slice(0, 10)}-${String(d.getHours()).padStart(2, '0')}`;
        const label = `${String(d.getHours()).padStart(2, '0')}:00`;
        timeline24h.push({
            hour: label,
            views: data.hourlyHistory[hourKey] || 0,
        });
    }

    // Top pages list
    const topPages = Object.entries(data.pageHits || {})
        .map(([path, count]) => ({ path, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 10);

    // Top tools list
    const topTools = Object.entries(data.toolUsage || {})
        .map(([tool, count]) => ({ tool, count }))
        .sort((a, b) => b.count - a.count);

    return {
        totalPageViews: data.totalPageViews || 0,
        eventsCount: data.eventsCount || 0,
        liveActiveCount,
        liveActiveUsers: activeList.slice(0, 20),
        deviceStats: data.deviceStats,
        browserStats: data.browserStats,
        timeline24h,
        topPages,
        topTools,
        recentEvents: data.recentEvents.slice(0, 50),
        lastUpdated: new Date().toISOString(),
    };
};

// ─── TRADER LOGINS & ACTIVE ACCOUNTS ──────────────────────────────────────────

const getTraderLoginsDB = () => safeReadJSON(FILES.LOGINS, { accounts: {}, history: [] });
const saveTraderLoginsDB = (data) => safeWriteJSON(FILES.LOGINS, data);

const recordTraderLogin = (loginData) => {
    const db = getTraderLoginsDB();
    const {
        loginid,
        accountType = 'unknown',
        currency = 'USD',
        balance = 0,
        email = '',
        ip = '127.0.0.1',
        userAgent = '',
        source = 'deriv_oauth',
    } = loginData;

    if (!loginid) return false;

    const now = new Date().toISOString();
    const isReal = !loginid.toLowerCase().startsWith('vr') && !loginid.toLowerCase().startsWith('crw');

    // Upsert account
    db.accounts[loginid] = {
        loginid,
        accountType: isReal ? 'real' : 'demo',
        currency,
        balance: Number(balance) || 0,
        email: email || db.accounts[loginid]?.email || '',
        ip,
        userAgent,
        source,
        firstSeen: db.accounts[loginid]?.firstSeen || now,
        lastLogin: now,
        loginCount: (db.accounts[loginid]?.loginCount || 0) + 1,
        status: isTraderBlocked(loginid) ? 'blocked' : (db.accounts[loginid]?.status || 'active'),
        blockReason: db.accounts[loginid]?.blockReason || null,
    };

    // Add to history
    db.history.unshift({
        id: `log_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`,
        loginid,
        accountType: isReal ? 'real' : 'demo',
        currency,
        balance: Number(balance) || 0,
        ip,
        timestamp: now,
        source,
    });

    if (db.history.length > 500) {
        db.history = db.history.slice(0, 500);
    }

    saveTraderLoginsDB(db);
    return true;
};

const getTraderLoginsSummary = () => {
    const db = getTraderLoginsDB();
    const accounts = Object.values(db.accounts || {});
    const realAccounts = accounts.filter(a => a.accountType === 'real');
    const demoAccounts = accounts.filter(a => a.accountType === 'demo');

    return {
        totalTraders: accounts.length,
        realTradersCount: realAccounts.length,
        demoTradersCount: demoAccounts.length,
        accounts: accounts.sort((a, b) => new Date(b.lastLogin) - new Date(a.lastLogin)),
        recentHistory: db.history.slice(0, 100),
    };
};

// ─── COMMISSION MARKUP TRACKER ENGINE ────────────────────────────────────────

const getCommissionsDB = () => {
    ensureDataDir();
    if (!fs.existsSync(FILES.COMMISSIONS)) {
        const seedUsers = ['CR3918204', 'CR1829401', 'CR5928103', 'CR2910392', 'CR7719204'];
        const seedSymbols = ['R_100', '1HZ100V', 'R_75', '1HZ75V', 'R_50', 'BOOM1000', 'CRASH1000'];
        const defaultData = [];
        const now = new Date();
        for (let i = 0; i < 45; i++) {
            const daysAgo = Math.floor(Math.random() * 14);
            const hoursAgo = Math.floor(Math.random() * 24);
            const txDate = new Date(now.getTime() - (daysAgo * 86400000 + hoursAgo * 3600000));
            const stake = Math.round((10 + Math.random() * 150) * 10) / 10;
            const markupRate = 0.02; // 2%
            const markupUsd = Math.round((stake * markupRate) * 100) / 100;
            const user = seedUsers[Math.floor(Math.random() * seedUsers.length)];
            const sym = seedSymbols[Math.floor(Math.random() * seedSymbols.length)];
            defaultData.push({
                id: `MKP-${Date.now().toString().slice(-6)}-${i}`,
                date: txDate.toISOString(),
                clientId: user,
                symbol: sym,
                volume: stake,
                amount: markupUsd,
                markupRate: '2.0%',
                status: 'credited',
            });
        }
        defaultData.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
        safeWriteJSON(FILES.COMMISSIONS, defaultData);
        return defaultData;
    }
    return safeReadJSON(FILES.COMMISSIONS, []);
};

const saveCommissionsDB = (data) => safeWriteJSON(FILES.COMMISSIONS, data);

const recordCommission = (comm) => {
    const list = getCommissionsDB();
    const item = {
        id: comm.id || `MKP-${Date.now().toString().slice(-6)}-${Math.floor(Math.random() * 1000)}`,
        date: comm.date || new Date().toISOString(),
        clientId: comm.clientId || comm.loginid || 'CR1000000',
        symbol: comm.symbol || 'R_100',
        volume: Number(comm.volume || comm.stake || 0),
        amount: Number(comm.amount || comm.markupUsd || 0),
        markupRate: comm.markupRate || '2.0%',
        status: comm.status || 'credited',
        appId: comm.appId || '121856',
    };
    list.unshift(item);
    saveCommissionsDB(list);
    return item;
};

const getCommissionAnalytics = ({ dateFrom, dateTo, clientId }) => {
    const list = getCommissionsDB();
    const fromTime = dateFrom ? new Date(dateFrom).getTime() : 0;
    const toTime = dateTo ? new Date(dateTo).getTime() : Infinity;

    const filtered = list.filter(item => {
        const itemTime = new Date(item.date).getTime();
        const matchesDate = itemTime >= fromTime && itemTime <= toTime;
        const matchesClient = !clientId || clientId === 'all' || item.clientId.toLowerCase() === clientId.toLowerCase();
        return matchesDate && matchesClient;
    });

    let totalCommissionUsd = 0;
    let totalVolumeUsd = 0;
    const userMap = new Map();
    const dayMap = new Map();

    filtered.forEach(item => {
        totalCommissionUsd += item.amount;
        totalVolumeUsd += item.volume;

        // User aggregation
        const u = item.clientId;
        if (!userMap.has(u)) {
            userMap.set(u, {
                clientId: u,
                commissionUsd: 0,
                volumeUsd: 0,
                tradesCount: 0,
                lastTradeDate: item.date,
            });
        }
        const uData = userMap.get(u);
        uData.commissionUsd += item.amount;
        uData.volumeUsd += item.volume;
        uData.tradesCount += 1;
        if (new Date(item.date) > new Date(uData.lastTradeDate)) {
            uData.lastTradeDate = item.date;
        }

        // Timeline aggregation by date (YYYY-MM-DD)
        const dayKey = item.date.slice(0, 10);
        if (!dayMap.has(dayKey)) {
            dayMap.set(dayKey, { label: dayKey, commission: 0, volume: 0, trades: 0 });
        }
        const dData = dayMap.get(dayKey);
        dData.commission += item.amount;
        dData.volume += item.volume;
        dData.trades += 1;
    });

    const userBreakdown = Array.from(userMap.values())
        .map(u => ({
            ...u,
            commissionUsd: Math.round(u.commissionUsd * 100) / 100,
            volumeUsd: Math.round(u.volumeUsd * 100) / 100,
        }))
        .sort((a, b) => b.commissionUsd - a.commissionUsd);

    const timeline = Array.from(dayMap.values())
        .map(d => ({
            ...d,
            commission: Math.round(d.commission * 100) / 100,
            volume: Math.round(d.volume * 100) / 100,
        }))
        .sort((a, b) => a.label.localeCompare(b.label));

    return {
        totalCommissionUsd: Math.round(totalCommissionUsd * 100) / 100,
        totalVolumeUsd: Math.round(totalVolumeUsd * 100) / 100,
        totalTrades: filtered.length,
        activeUsersCount: userMap.size,
        userBreakdown,
        timeline,
        transactions: filtered.slice(0, 100),
    };
};

// ─── USER BLOCKING / BLACKLIST ENGINE ────────────────────────────────────────

const getBlockedUsersDB = () => safeReadJSON(FILES.BLOCKED, { blocked: {} });
const saveBlockedUsersDB = (data) => safeWriteJSON(FILES.BLOCKED, data);

const isTraderBlocked = (loginid) => {
    if (!loginid) return false;
    const cleanId = loginid.trim().toUpperCase();
    const blockedDb = getBlockedUsersDB();
    return !!blockedDb.blocked[cleanId];
};

const blockTraderUser = ({ loginid, reason = 'Administrative block', actor = 'admin' }) => {
    if (!loginid) return { success: false, error: 'Missing loginid' };
    const cleanId = loginid.trim().toUpperCase();

    // 1. Update blocked registry
    const blockedDb = getBlockedUsersDB();
    blockedDb.blocked[cleanId] = {
        loginid: cleanId,
        reason,
        blockedAt: new Date().toISOString(),
        blockedBy: actor,
    };
    saveBlockedUsersDB(blockedDb);

    // 2. Update trader logins record
    const tradersDb = getTraderLoginsDB();
    if (tradersDb.accounts[cleanId]) {
        tradersDb.accounts[cleanId].status = 'blocked';
        tradersDb.accounts[cleanId].blockReason = reason;
        saveTraderLoginsDB(tradersDb);
    }

    addAdminAudit('USER_BLOCKED', { loginid: cleanId, reason, actor }, actor);
    return { success: true, loginid: cleanId, status: 'blocked', reason };
};

const unblockTraderUser = (loginid, actor = 'admin') => {
    if (!loginid) return { success: false, error: 'Missing loginid' };
    const cleanId = loginid.trim().toUpperCase();

    // 1. Remove from blocked registry
    const blockedDb = getBlockedUsersDB();
    delete blockedDb.blocked[cleanId];
    saveBlockedUsersDB(blockedDb);

    // 2. Update trader logins record
    const tradersDb = getTraderLoginsDB();
    if (tradersDb.accounts[cleanId]) {
        tradersDb.accounts[cleanId].status = 'active';
        delete tradersDb.accounts[cleanId].blockReason;
        saveTraderLoginsDB(tradersDb);
    }

    addAdminAudit('USER_UNBLOCKED', { loginid: cleanId, actor }, actor);
    return { success: true, loginid: cleanId, status: 'active' };
};

// ─── USER TRADE HISTORY & ANALYTICS ENGINE ───────────────────────────────────

const getUserTradesDB = () => {
    ensureDataDir();
    if (!fs.existsSync(FILES.USER_TRADES)) {
        const seedUsers = ['CR3918204', 'CR1829401', 'CR5928103', 'CR2910392', 'CR7719204'];
        const seedSymbols = ['1HZ100V', 'R_100', 'BOOM1000', 'CRASH1000', 'R_75', '1HZ50V', 'R_25'];
        const seedTools = ['bot-builder', 'digit-cracker', 'auto-x-eo', 'signals', 'manual', 'copy-trading'];
        const seedTypes = ['DIFFERS', 'MATCHES', 'CALL', 'PUT', 'OVER', 'UNDER', 'ACCU'];
        const defaultData = [];
        const now = new Date();

        for (let i = 0; i < 75; i++) {
            const daysAgo = Math.floor(Math.random() * 14);
            const hoursAgo = Math.floor(Math.random() * 24);
            const minutesAgo = Math.floor(Math.random() * 60);
            const purchaseTime = new Date(now.getTime() - (daysAgo * 86400000 + hoursAgo * 3600000 + minutesAgo * 60000));
            const stake = Math.round((5 + Math.random() * 95) * 10) / 10;
            const isWin = Math.random() > 0.42; // ~58% win rate
            const payoutRate = 1.95;
            const payout = isWin ? Math.round(stake * payoutRate * 100) / 100 : 0;
            const profitLoss = isWin ? Math.round((payout - stake) * 100) / 100 : -stake;
            const user = seedUsers[Math.floor(Math.random() * seedUsers.length)];
            const sym = seedSymbols[Math.floor(Math.random() * seedSymbols.length)];
            const tool = seedTools[Math.floor(Math.random() * seedTools.length)];
            const tradeType = seedTypes[Math.floor(Math.random() * seedTypes.length)];

            defaultData.push({
                id: `TRD-${Date.now().toString().slice(-6)}-${i}`,
                contractId: `2${Math.floor(100000000 + Math.random() * 900000000)}`,
                clientId: user,
                symbol: sym,
                tradeType,
                tool,
                stake,
                payout,
                profitLoss,
                status: isWin ? 'WON' : 'LOST',
                purchaseTime: purchaseTime.toISOString(),
                sellTime: new Date(purchaseTime.getTime() + 15000).toISOString(),
                barrier: tradeType.includes('DIFF') || tradeType.includes('MATCH') ? `Digit ${Math.floor(Math.random() * 10)}` : null,
            });
        }
        defaultData.sort((a, b) => new Date(b.purchaseTime).getTime() - new Date(a.purchaseTime).getTime());
        safeWriteJSON(FILES.USER_TRADES, defaultData);
        return defaultData;
    }
    return safeReadJSON(FILES.USER_TRADES, []);
};

const saveUserTradesDB = (data) => safeWriteJSON(FILES.USER_TRADES, data);

const recordUserTrade = (trade) => {
    const list = getUserTradesDB();
    const isWin = trade.status === 'WON' || (trade.profitLoss && trade.profitLoss > 0);
    const item = {
        id: trade.id || `TRD-${Date.now().toString().slice(-6)}-${Math.floor(Math.random() * 1000)}`,
        contractId: trade.contractId || `${Date.now()}`,
        clientId: trade.clientId || trade.loginid || 'CR1000000',
        symbol: trade.symbol || 'R_100',
        tradeType: trade.tradeType || 'CALL',
        tool: trade.tool || 'bot-builder',
        stake: Number(trade.stake || trade.buyPrice || 0),
        payout: Number(trade.payout || trade.sellPrice || 0),
        profitLoss: Number(trade.profitLoss || 0),
        status: isWin ? 'WON' : 'LOST',
        purchaseTime: trade.purchaseTime || new Date().toISOString(),
        sellTime: trade.sellTime || new Date().toISOString(),
        barrier: trade.barrier || null,
    };
    list.unshift(item);
    if (list.length > 2000) list.pop();
    saveUserTradesDB(list);
    return item;
};

const getUserTradesAnalytics = ({ clientId, tool, outcome, symbol, dateFrom, dateTo, limit = 100, offset = 0 }) => {
    const list = getUserTradesDB();
    const fromTime = dateFrom ? new Date(dateFrom).getTime() : 0;
    const toTime = dateTo ? new Date(dateTo).getTime() : Infinity;

    const filtered = list.filter(item => {
        const itemTime = new Date(item.purchaseTime).getTime();
        const matchesDate = itemTime >= fromTime && itemTime <= toTime;
        const matchesClient = !clientId || clientId === 'all' || item.clientId.toLowerCase() === clientId.toLowerCase();
        const matchesTool = !tool || tool === 'all' || item.tool.toLowerCase() === tool.toLowerCase();
        const matchesOutcome = !outcome || outcome === 'all' || item.status.toLowerCase() === outcome.toLowerCase();
        const matchesSymbol = !symbol || symbol === 'all' || item.symbol.toLowerCase() === symbol.toLowerCase();
        return matchesDate && matchesClient && matchesTool && matchesOutcome && matchesSymbol;
    });

    let totalVolume = 0;
    let netProfitLoss = 0;
    let winCount = 0;
    let lossCount = 0;

    const userMap = new Map();
    const symbolMap = new Map();
    const toolMap = new Map();

    // Chronological sort for cumulative PnL curve
    const chronological = [...filtered].sort((a, b) => new Date(a.purchaseTime).getTime() - new Date(b.purchaseTime).getTime());
    let runningPnL = 0;
    const cumulativePnL = [];

    chronological.forEach((item, index) => {
        runningPnL += item.profitLoss;
        // Sample points to keep chart performant
        if (chronological.length <= 40 || index % Math.ceil(chronological.length / 40) === 0 || index === chronological.length - 1) {
            cumulativePnL.push({
                time: item.purchaseTime.slice(5, 16).replace('T', ' '),
                profitLoss: Math.round(item.profitLoss * 100) / 100,
                cumulative: Math.round(runningPnL * 100) / 100,
            });
        }
    });

    filtered.forEach(item => {
        totalVolume += item.stake;
        netProfitLoss += item.profitLoss;
        if (item.status === 'WON') winCount++;
        else if (item.status === 'LOST') lossCount++;

        // User stats
        const u = item.clientId;
        if (!userMap.has(u)) {
            userMap.set(u, {
                clientId: u,
                tradesCount: 0,
                volume: 0,
                profitLoss: 0,
                winCount: 0,
                lossCount: 0,
                lastTrade: item.purchaseTime,
            });
        }
        const uStat = userMap.get(u);
        uStat.tradesCount += 1;
        uStat.volume += item.stake;
        uStat.profitLoss += item.profitLoss;
        if (item.status === 'WON') uStat.winCount++;
        else uStat.lossCount++;
        if (new Date(item.purchaseTime) > new Date(uStat.lastTrade)) {
            uStat.lastTrade = item.purchaseTime;
        }

        // Symbol stats
        symbolMap.set(item.symbol, (symbolMap.get(item.symbol) || 0) + 1);

        // Tool stats
        toolMap.set(item.tool, (toolMap.get(item.tool) || 0) + 1);
    });

    const userStats = Array.from(userMap.values())
        .map(u => ({
            ...u,
            volume: Math.round(u.volume * 100) / 100,
            profitLoss: Math.round(u.profitLoss * 100) / 100,
            winRate: Math.round((u.winCount / (u.tradesCount || 1)) * 100),
        }))
        .sort((a, b) => b.tradesCount - a.tradesCount);

    const winRate = Math.round((winCount / (winCount + lossCount || 1)) * 100);

    return {
        totalTrades: filtered.length,
        totalVolume: Math.round(totalVolume * 100) / 100,
        netProfitLoss: Math.round(netProfitLoss * 100) / 100,
        winCount,
        lossCount,
        winRate,
        userStats,
        symbolStats: Object.fromEntries(symbolMap),
        toolStats: Object.fromEntries(toolMap),
        cumulativePnL,
        trades: filtered.slice(offset, offset + limit),
    };
};

module.exports = {
    // Admin Auth & Management
    authenticateAdmin,
    verifySession,
    logoutAdmin,
    listAdmins,
    createAdminUser,
    updateAdminUser,
    deleteAdminUser,
    getAdminAudit,
    addAdminAudit,

    // Analytics Engine
    trackTelemetryEvent,
    getAnalyticsSummary,
    getLiveActiveVisitorsCount,

    // Trader Logins & User Blocking
    recordTraderLogin,
    getTraderLoginsSummary,
    blockTraderUser,
    unblockTraderUser,
    isTraderBlocked,
    getBlockedUsersDB,

    // Commission Markup Tracker
    recordCommission,
    getCommissionsDB,
    getCommissionAnalytics,

    // User Trade History Engine
    recordUserTrade,
    getUserTradesDB,
    getUserTradesAnalytics,

    // File references & helpers
    FILES,
    safeReadJSON,
    safeWriteJSON,
};
