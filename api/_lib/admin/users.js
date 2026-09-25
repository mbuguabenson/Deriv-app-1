'use strict';

const db = require('../db');

module.exports = async function adminUsersHandler(req, res) {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    // Auth check: verify admin session token
    const authHeader = req.headers.authorization || '';
    const session = db.verifySession(authHeader);

    // If unauthenticated, reject unless running in local development mode or initial setup
    if (!session && process.env.NODE_ENV === 'production') {
        return res.status(401).json({ error: 'Unauthorized: valid admin session token required' });
    }

    const actor = session ? session.username : 'system';

    // GET /api/admin/users - List all admins
    if (req.method === 'GET') {
        const admins = db.listAdmins();
        const audit = db.getAdminAudit();
        return res.status(200).json({
            success: true,
            admins,
            auditLogs: audit.logs.slice(0, 30),
        });
    }

    // POST /api/admin/users - Create new admin
    if (req.method === 'POST') {
        const body = req.body || {};
        const { username, password, role, permissions } = body;

        const result = db.createAdminUser({
            username,
            password,
            role,
            permissions,
            actor,
        });

        if (!result.success) {
            return res.status(400).json(result);
        }

        return res.status(201).json(result);
    }

    // PATCH /api/admin/users - Update admin
    if (req.method === 'PATCH' || req.method === 'PUT') {
        const body = req.body || {};
        const { id, updates } = body;
        const targetId = id || req.query.id;

        if (!targetId) {
            return res.status(400).json({ error: 'Missing admin id' });
        }

        const result = db.updateAdminUser(targetId, updates || body, actor);
        if (!result.success) {
            return res.status(400).json(result);
        }

        return res.status(200).json(result);
    }

    // DELETE /api/admin/users - Delete admin
    if (req.method === 'DELETE') {
        const targetId = req.query.id || req.body?.id;
        if (!targetId) {
            return res.status(400).json({ error: 'Missing admin id to delete' });
        }

        const result = db.deleteAdminUser(targetId, actor);
        if (!result.success) {
            return res.status(400).json(result);
        }

        return res.status(200).json({ success: true, message: 'Admin deleted successfully' });
    }

    return res.status(405).json({ error: 'Method Not Allowed' });
};
