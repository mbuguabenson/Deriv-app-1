'use strict';

const handlers = {
    auth: require('./_lib/admin/auth'),
    users: require('./_lib/admin/users'),
    traders: require('./_lib/admin/traders'),
    audit: require('./_lib/admin/audit'),
    analytics: require('./analytics-handler'),
    bots: require('./_lib/admin/bots'),
    'copy-requests': require('./_lib/admin/copy-requests'),
    'deriv-apps': require('./_lib/admin/deriv-apps'),
    logs: require('./_lib/admin/logs'),
    notifications: require('./_lib/admin/notifications'),
    'site-config': require('./_lib/admin/site-config'),
    'system-health': require('./_lib/admin/system-health'),
    transactions: require('./_lib/admin/transactions'),
    commissions: require('./_lib/admin/commission-tracker'),
    'commission-tracker': require('./_lib/admin/commission-tracker'),
    trades: require('./_lib/admin/trades'),
    'user-trades': require('./_lib/admin/trades'),
};

module.exports = async function handler(req, res) {
    let subpath = req.query && req.query.subpath;
    if (!subpath && req.url) {
        const pathname = req.url.split('?')[0];
        const match = pathname.match(/^\/api\/admin\/?(.*)$/);
        if (match && match[1]) {
            subpath = match[1];
        }
    }

    if (Array.isArray(subpath)) {
        subpath = subpath.join('/');
    }
    subpath = String(subpath || '').trim();

    if (!subpath) {
        return res.status(200).json({
            status: 'online',
            service: 'admin-gateway',
            routes: Object.keys(handlers).map(k => `/api/admin/${k}`),
        });
    }

    const targetHandler = handlers[subpath];
    if (typeof targetHandler === 'function') {
        return await targetHandler(req, res);
    }

    return res.status(404).json({ error: `Admin route '/${subpath}' not found` });
};
