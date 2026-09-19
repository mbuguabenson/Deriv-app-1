'use strict';

const DERIV_TOKEN_ENDPOINT = 'https://auth.deriv.com/oauth2/token';
const COOKIE_NAME_ACCESS = 'deriv_session';
const COOKIE_NAME_REFRESH = 'deriv_refresh';
const SESSION_TTL_S = 3600;
const REFRESH_TTL_S = 2592000;

function cookieHeader(name, value, maxAge) {
    return `${name}=${value}; HttpOnly; Secure; SameSite=Strict; Path=/api/session; Max-Age=${maxAge}`;
}

function parseCookies(header) {
    const map = {};
    if (!header) return map;
    header.split(';').forEach(part => {
        const [k, ...v] = part.trim().split('=');
        if (k) map[k.trim()] = v.join('=').trim();
    });
    return map;
}

module.exports = async function handler(req, res) {
    const origin = req.headers.origin || '';
    res.setHeader('Access-Control-Allow-Origin', origin || '*');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
        return res.status(204).end();
    }

    if (req.method !== 'POST') {
        res.setHeader('Allow', 'POST, OPTIONS');
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    const cookies = req.cookies || parseCookies(req.headers.cookie || '');
    const refreshToken = cookies[COOKIE_NAME_REFRESH];

    if (!refreshToken) {
        return res.status(401).json({ error: 'No refresh token' });
    }

    const clientId = process.env.DERIV_APP_ID || '121856';
    const clientSecret = process.env.DERIV_CLIENT_SECRET || '';

    try {
        const response = await fetch(DERIV_TOKEN_ENDPOINT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                grant_type: 'refresh_token',
                refresh_token: refreshToken,
                client_id: clientId,
                client_secret: clientSecret,
            }),
        });

        const tokenResponse = await response.json();
        const { access_token, refresh_token, expires_in, account_id, currency, account_type } = tokenResponse;

        if (!access_token) {
            res.setHeader('Set-Cookie', [
                `${COOKIE_NAME_ACCESS}=; HttpOnly; Secure; SameSite=Strict; Path=/api/session; Max-Age=0`,
                `${COOKIE_NAME_REFRESH}=; HttpOnly; Secure; SameSite=Strict; Path=/api/session; Max-Age=0`,
            ]);
            return res.status(401).json({ error: 'Session expired', requiresLogin: true });
        }

        const expiresAt = Date.now() + (Number(expires_in) || SESSION_TTL_S) * 1000;
        const newCookies = [cookieHeader(COOKIE_NAME_ACCESS, access_token, SESSION_TTL_S)];
        if (refresh_token) {
            newCookies.push(cookieHeader(COOKIE_NAME_REFRESH, refresh_token, REFRESH_TTL_S));
        }
        res.setHeader('Set-Cookie', newCookies);

        return res.status(200).json({
            loginid: account_id || '',
            currency: currency || 'USD',
            account_type: account_type || 'real',
            expiresAt,
        });
    } catch (err) {
        console.error('[/api/session/refresh] Refresh error:', err);
        return res.status(502).json({ error: 'Refresh failed' });
    }
};
