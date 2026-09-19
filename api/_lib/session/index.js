'use strict';

const DERIV_TOKEN_ENDPOINT = 'https://auth.deriv.com/oauth2/token';
const COOKIE_NAME_ACCESS = 'deriv_session';
const COOKIE_NAME_REFRESH = 'deriv_refresh';
const SESSION_TTL_S = 3600;
const REFRESH_TTL_S = 2592000;

function cookieHeader(name, value, maxAge, sameSite) {
    const site = sameSite || 'Strict';
    return `${name}=${value}; HttpOnly; Secure; SameSite=${site}; Path=/api/session; Max-Age=${maxAge}`;
}

module.exports = async function handler(req, res) {
    const origin = req.headers.origin || '';
    const allowedOrigins = [
        process.env.NEXT_PUBLIC_APP_URL,
        'https://profithub.vercel.app',
        'http://localhost:3000',
        'http://localhost:5173',
    ].filter(Boolean);

    const isAllowed = allowedOrigins.some(o => origin.startsWith(o)) || !origin;

    res.setHeader('Access-Control-Allow-Origin', origin || '*');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
        return res.status(204).end();
    }

    if (!isAllowed) {
        return res.status(403).json({ error: 'Forbidden' });
    }

    if (req.method === 'DELETE') {
        res.setHeader('Set-Cookie', [
            `${COOKIE_NAME_ACCESS}=; HttpOnly; Secure; SameSite=Strict; Path=/api/session; Max-Age=0`,
            `${COOKIE_NAME_REFRESH}=; HttpOnly; Secure; SameSite=Strict; Path=/api/session; Max-Age=0`,
        ]);
        return res.status(200).json({ success: true });
    }

    if (req.method !== 'POST') {
        res.setHeader('Allow', 'POST, DELETE, OPTIONS');
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    const { code } = req.body || {};
    if (!code || typeof code !== 'string') {
        return res.status(400).json({ error: 'Missing code parameter' });
    }

    const clientId = process.env.DERIV_APP_ID || '121856';
    const clientSecret = process.env.DERIV_CLIENT_SECRET || '';
    const redirectUri = process.env.DERIV_REDIRECT_URI || (origin ? `${origin}/oauth/callback` : '');

    try {
        const response = await fetch(DERIV_TOKEN_ENDPOINT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                grant_type: 'authorization_code',
                code,
                client_id: clientId,
                client_secret: clientSecret,
                redirect_uri: redirectUri,
            }),
        });

        const tokenResponse = await response.json();
        const { access_token, refresh_token, expires_in, account_id, currency, account_type } = tokenResponse;

        if (!access_token) {
            return res.status(401).json({ error: tokenResponse.error || 'Token exchange failed' });
        }

        const expiresAt = Date.now() + (Number(expires_in) || SESSION_TTL_S) * 1000;
        const cookies = [cookieHeader(COOKIE_NAME_ACCESS, access_token, SESSION_TTL_S)];
        if (refresh_token) {
            cookies.push(cookieHeader(COOKIE_NAME_REFRESH, refresh_token, REFRESH_TTL_S));
        }
        res.setHeader('Set-Cookie', cookies);

        return res.status(200).json({
            loginid: account_id || '',
            currency: currency || 'USD',
            account_type: account_type || 'real',
            expiresAt,
        });
    } catch (err) {
        console.error('[/api/session] Token exchange error:', err);
        return res.status(502).json({ error: 'Token exchange failed' });
    }
};
