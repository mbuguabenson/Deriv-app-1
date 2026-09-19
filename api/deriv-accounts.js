'use strict';

const WebSocket = typeof globalThis.WebSocket !== 'undefined' ? globalThis.WebSocket : require('ws');

module.exports = async function handler(req, res) {
    if (req.method !== 'GET') {
        res.setHeader('Allow', 'GET');
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    const authorization = req.headers.authorization || '';
    let token = '';

    if (authorization.toLowerCase().startsWith('bearer ')) {
        token = authorization.slice(7).trim();
    } else if (req.query.token) {
        token = String(req.query.token).trim();
    }

    if (!token) {
        return res.status(400).json({ error: 'Missing token. Pass Authorization: Bearer <token> or ?token=<token>' });
    }

    // For OAuth 2.0 JWT Bearer tokens, query the official New Deriv API options accounts endpoint
    if (token.startsWith('ey')) {
        try {
            const resp = await fetch('https://api.derivws.com/trading/v1/options/accounts', {
                method: 'GET',
                headers: {
                    Authorization: `Bearer ${token}`,
                },
            });
            if (resp.ok) {
                const accountsData = await resp.json();
                const accounts = accountsData?.data || [];
                const first = accounts[0] || {};
                return res.status(200).json({
                    success: true,
                    loginid: first.account_id || '',
                    fullname: first.account_id || 'Profithub Trader',
                    email: '',
                    currency: first.currency || 'USD',
                    balance: typeof first.balance === 'number' ? first.balance : parseFloat(first.balance || '0'),
                    scopes: ['trade'],
                    country: 'ke',
                    isVirtual: first.account_type === 'demo',
                    accountList: accounts.map(acc => ({
                        loginid: acc.account_id,
                        currency: acc.currency,
                        isVirtual: acc.account_type === 'demo',
                        isDisabled: acc.status !== 'active',
                    })),
                });
            }
        } catch (restErr) {
            console.warn('[DerivAccountsAPI] REST accounts fetch error:', restErr);
        }
    }

    const appId = req.headers['deriv-app-id'] || req.query.app_id || '1089';
    // Use official standard Deriv binaryws.com / derivws.com WebSocket gateway for legacy tokens
    const wsUrl = `wss://ws.binaryws.com/websockets/v3?app_id=${encodeURIComponent(appId)}`;

    return new Promise(resolve => {
        let ws;
        const timeout = setTimeout(() => {
            if (ws && ws.readyState === WebSocket.OPEN) {
                ws.close();
            }
            res.status(504).json({ error: 'Deriv WebSocket Gateway Timeout' });
            resolve();
        }, 6000);

        try {
            ws = new WebSocket(wsUrl);

            ws.on('open', () => {
                ws.send(JSON.stringify({ authorize: token }));
            });

            ws.on('message', message => {
                try {
                    const data = JSON.parse(message.toString());

                    if (data.error) {
                        clearTimeout(timeout);
                        ws.close();
                        res.status(400).json({
                            error: data.error.message || 'Authorization failed',
                            code: data.error.code,
                        });
                        return resolve();
                    }

                    if (data.msg_type === 'authorize') {
                        const auth = data.authorize || {};
                        clearTimeout(timeout);
                        ws.close();

                        res.status(200).json({
                            success: true,
                            loginid: auth.loginid,
                            fullname: auth.fullname || auth.nickname || auth.loginid,
                            email: auth.email || '',
                            currency: auth.currency || 'USD',
                            balance: typeof auth.balance === 'number' ? auth.balance : parseFloat(auth.balance || '0'),
                            scopes: auth.scopes || ['read', 'trade'],
                            country: auth.country || '',
                            isVirtual: Boolean(auth.is_virtual),
                            accountList: (auth.account_list || []).map(acc => ({
                                loginid: acc.loginid,
                                currency: acc.currency,
                                isVirtual: Boolean(acc.is_virtual),
                                isDisabled: Boolean(acc.is_disabled),
                            })),
                        });
                        return resolve();
                    }
                } catch (parseErr) {
                    clearTimeout(timeout);
                    ws.close();
                    res.status(500).json({ error: 'Failed to parse Deriv WS response' });
                    return resolve();
                }
            });

            ws.on('error', err => {
                clearTimeout(timeout);
                res.status(502).json({ error: 'Deriv WebSocket connection error', details: err.message });
                return resolve();
            });
        } catch (err) {
            clearTimeout(timeout);
            res.status(500).json({ error: 'Internal server error initializing WS', details: err.message });
            return resolve();
        }
    });
};
