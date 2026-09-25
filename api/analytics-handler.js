'use strict';

const db = require('./_lib/db');

module.exports = async function analyticsHandler(req, res) {
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

    // Route matching from URL
    const pathname = (req.url || '').split('?')[0];

    // POST /api/analytics/track
    if (pathname.endsWith('/track') && req.method === 'POST') {
        const payload = req.body || {};
        db.trackTelemetryEvent({
            ...payload,
            ip: clientIp,
            userAgent,
        });
        return res.status(200).json({ success: true, recorded: true });
    }

    // GET /api/analytics/stats
    if (pathname.endsWith('/stats') && req.method === 'GET') {
        const stats = db.getAnalyticsSummary();
        return res.status(200).json({
            success: true,
            data: stats,
        });
    }

    // POST /api/analytics/login or /api/analytics/logins
    if ((pathname.endsWith('/login') || pathname.endsWith('/logins')) && req.method === 'POST') {
        const payload = req.body || {};
        const success = db.recordTraderLogin({
            ...payload,
            ip: clientIp,
            userAgent,
        });
        return res.status(200).json({ success: !!success });
    }

    // GET /api/analytics/logins or /api/analytics/traders
    if ((pathname.endsWith('/logins') || pathname.endsWith('/traders')) && req.method === 'GET') {
        const summary = db.getTraderLoginsSummary();
        return res.status(200).json({
            success: true,
            data: summary,
        });
    }

    // Default overview response for /api/analytics
    if (req.method === 'GET') {
        const stats = db.getAnalyticsSummary();
        const traders = db.getTraderLoginsSummary();
        return res.status(200).json({
            service: 'profithub-analytics-engine',
            status: 'operational',
            liveActiveVisitors: stats.liveActiveCount,
            totalPageViews: stats.totalPageViews,
            totalTraders: traders.totalTraders,
            endpoints: [
                'POST /api/analytics/track',
                'GET  /api/analytics/stats',
                'POST /api/analytics/login',
                'GET  /api/analytics/logins',
            ],
        });
    }

    return res.status(404).json({ error: `Analytics endpoint '${pathname}' not found` });
};
