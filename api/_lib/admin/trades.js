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
        const {
            client_id,
            tool,
            outcome,
            symbol,
            date_from,
            date_to,
            limit = 100,
            offset = 0,
        } = req.query || {};

        const report = db.getUserTradesAnalytics({
            clientId: client_id,
            tool,
            outcome,
            symbol,
            dateFrom: date_from,
            dateTo: date_to,
            limit: Math.min(Number(limit) || 100, 500),
            offset: Number(offset) || 0,
        });

        return res.status(200).json({
            success: true,
            data: report,
            filters: {
                client_id: client_id || 'all',
                tool: tool || 'all',
                outcome: outcome || 'all',
                symbol: symbol || 'all',
                date_from: date_from || null,
                date_to: date_to || null,
                limit: Number(limit) || 100,
                offset: Number(offset) || 0,
            },
        });
    }

    if (req.method === 'POST') {
        const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
        const recorded = db.recordUserTrade(body);
        return res.status(201).json({
            success: true,
            trade: recorded,
        });
    }

    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method Not Allowed' });
};
