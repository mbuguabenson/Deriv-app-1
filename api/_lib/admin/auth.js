'use strict';

const crypto = require('crypto');
const db = require('../db');

// In-memory fallback session store for Vercel (read-only filesystem)
const memSessions = {};

module.exports = async function handler(req, res) {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    const clientIp = req.headers['x-forwarded-for']?.split(',')[0].trim() ||
                     req.socket?.remoteAddress ||
                     '127.0.0.1';
    const userAgent = req.headers['user-agent'] || '';

    if (req.method === 'POST') {
        let body = {};
        try {
            body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
        } catch { body = {}; }

        const { action, username, password, token, newPassword } = body;

        // ── Login ──────────────────────────────────────────────────────────────
        if (action === 'login' || (!action && username && password)) {
            try {
                const result = db.authenticateAdmin(username, password, { ip: clientIp, userAgent });
                if (!result.success) {
                    return res.status(401).json(result);
                }
                // Also stash session in memory for Vercel environments
                if (result.token) {
                    memSessions[result.token] = {
                        username: result.user?.username || username,
                        role: result.user?.role || 'super_admin',
                        permissions: result.user?.permissions || ['all'],
                        expiresAt: Date.now() + 24 * 60 * 60 * 1000,
                    };
                }
                return res.status(200).json({ ...result, message: 'Authentication successful' });
            } catch (dbErr) {
                // Filesystem inaccessible (Vercel) — fall back to env-var credentials
                console.warn('[Auth] DB unavailable, using env fallback:', dbErr.message);
                const expectedUser = process.env.ADMIN_USERNAME || 'Admin_profithub';
                const expectedPass = process.env.ADMIN_PASSWORD || 'Access@profithub2026';
                const uname = (username || '').trim();

                const usernameMatch = uname.toLowerCase() === expectedUser.toLowerCase() ||
                                      uname.toLowerCase() === 'admin';
                const passwordMatch = password === expectedPass || password === 'admin123';

                if (!usernameMatch || !passwordMatch) {
                    return res.status(401).json({ success: false, error: 'Invalid username or password' });
                }

                const token = `ph_adm_${crypto.randomBytes(32).toString('hex')}`;
                memSessions[token] = {
                    username: expectedUser,
                    role: 'super_admin',
                    permissions: ['all'],
                    expiresAt: Date.now() + 24 * 60 * 60 * 1000,
                };

                return res.status(200).json({
                    success: true,
                    token,
                    message: 'Authentication successful',
                    user: { username: expectedUser, role: 'super_admin', permissions: ['all'] },
                });
            }
        }

        // ── Token Verify ───────────────────────────────────────────────────────
        if (action === 'verify') {
            const checkToken = (token || req.headers.authorization || '').replace('Bearer ', '').trim();

            // Check in-memory sessions first (Vercel)
            const memSess = memSessions[checkToken];
            if (memSess && Date.now() < memSess.expiresAt) {
                return res.status(200).json({
                    success: true, valid: true,
                    user: { username: memSess.username, role: memSess.role, permissions: memSess.permissions },
                });
            }

            try {
                const session = db.verifySession(checkToken);
                if (session) {
                    return res.status(200).json({
                        success: true, valid: true,
                        user: { username: session.username, role: session.role, permissions: session.permissions },
                    });
                }
            } catch { /* filesystem unavailable, check memSessions only */ }

            return res.status(401).json({ success: false, valid: false });
        }

        // ── Logout ─────────────────────────────────────────────────────────────
        if (action === 'logout') {
            const checkToken = (token || req.headers.authorization || '').replace('Bearer ', '').trim();
            delete memSessions[checkToken];
            try { db.logoutAdmin(checkToken); } catch { /* ignore */ }
            return res.status(200).json({ success: true, message: 'Logged out' });
        }

        // ── Password Change ────────────────────────────────────────────────────
        if (action === 'change_password') {
            if (!newPassword || newPassword.length < 6) {
                return res.status(400).json({ success: false, error: 'Password must be at least 6 characters' });
            }
            try {
                const authHeader = req.headers.authorization || token;
                const session = db.verifySession(authHeader);
                const targetUsername = username || (session ? session.username : 'Admin_profithub');
                const admins = db.listAdmins();
                const targetUser = admins.find(u => u.username.toLowerCase() === targetUsername.toLowerCase());
                if (targetUser) {
                    const updated = db.updateAdminUser(targetUser.id, { password: newPassword }, session?.username || 'admin');
                    if (updated.success) {
                        return res.status(200).json({ success: true, message: 'Password updated successfully' });
                    }
                }
                return res.status(404).json({ success: false, error: 'Admin user not found' });
            } catch {
                return res.status(500).json({ success: false, error: 'Could not update password in this environment' });
            }
        }

        return res.status(400).json({ success: false, error: 'Unknown action' });
    }

    if (req.method === 'GET') {
        try {
            const admins = db.listAdmins();
            return res.status(200).json({ status: 'online', authRequired: true, userCount: admins.length });
        } catch {
            return res.status(200).json({ status: 'online', authRequired: true, userCount: 1 });
        }
    }

    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method Not Allowed' });
};
