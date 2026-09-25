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

    if (req.method === 'GET') {
        const { date_from, date_to, client_id } = req.query || {};
        const report = db.getCommissionAnalytics({
            dateFrom: date_from,
            dateTo: date_to,
            clientId: client_id,
        });

        return res.status(200).json({
            success: true,
            data: report,
            filters: {
                date_from: date_from || null,
                date_to: date_to || null,
                client_id: client_id || 'all',
            },
        });
    }

    if (req.method === 'POST') {
        const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
        const recorded = db.recordCommission(body);
        return res.status(201).json({
            success: true,
            commission: recorded,
        });
    }

    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method Not Allowed' });
};
