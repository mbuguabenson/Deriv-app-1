'use strict';

const db = require('../db');

module.exports = async function handler(req, res) {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') return res.status(200).end();

    const authHeader = req.headers.authorization || '';
    const session = db.verifySession(authHeader);
    const actor = session ? session.username : 'admin';

    // GET /api/admin/traders - return summary and blocked list
    if (req.method === 'GET') {
        const summary = db.getTraderLoginsSummary();
        const blockedDb = db.getBlockedUsersDB();
        return res.status(200).json({
            success: true,
            data: {
                ...summary,
                blockedUsers: Object.values(blockedDb.blocked || {}),
            },
        });
    }

    // POST /api/admin/traders/block or PATCH to block/unblock
    if (req.method === 'POST' || req.method === 'PATCH') {
        const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
        const { action, loginid, reason } = body;

        if (action === 'block') {
            const result = db.blockTraderUser({
                loginid,
                reason: reason || 'Blocked by administrator',
                actor,
            });
            return res.status(200).json(result);
        }

        if (action === 'unblock') {
            const result = db.unblockTraderUser(loginid, actor);
            return res.status(200).json(result);
        }

        return res.status(400).json({ error: 'Action must be "block" or "unblock"' });
    }

    return res.status(405).json({ error: 'Method Not Allowed' });
};
