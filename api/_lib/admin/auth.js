'use strict';

const db = require('../db');

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
        const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
        const { action, username, password, token, newPassword } = body;

        // Login Action
        if (action === 'login' || (!action && username && password)) {
            const result = db.authenticateAdmin(username, password, { ip: clientIp, userAgent });
            if (!result.success) {
                return res.status(401).json(result);
            }
            return res.status(200).json({
                ...result,
                message: 'Authentication successful',
            });
        }

        // Token Verification Action
        if (action === 'verify') {
            const checkToken = token || req.headers.authorization;
            const session = db.verifySession(checkToken);
            if (session) {
                return res.status(200).json({
                    success: true,
                    valid: true,
                    user: {
                        username: session.username,
                        role: session.role,
                        permissions: session.permissions,
                    },
                });
            }
            return res.status(401).json({ success: false, valid: false });
        }

        // Logout Action
        if (action === 'logout') {
            const checkToken = token || req.headers.authorization;
            db.logoutAdmin(checkToken);
            return res.status(200).json({ success: true, message: 'Logged out' });
        }

        // Password Change Action
        if (action === 'change_password') {
            if (!newPassword || newPassword.length < 6) {
                return res.status(400).json({ success: false, error: 'Password must be at least 6 characters' });
            }
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
        }

        return res.status(400).json({ success: false, error: 'Unknown action' });
    }

    if (req.method === 'GET') {
        const admins = db.listAdmins();
        return res.status(200).json({
            status: 'online',
            authRequired: true,
            userCount: admins.length,
        });
    }

    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method Not Allowed' });
};
