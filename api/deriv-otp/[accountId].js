'use strict';

const brandConfig = require('../../brand.config.json');

const getDerivWSBaseURL = () => {
    // Both staging and production environments authenticate against production Deriv auth.deriv.com
    return brandConfig.platform?.derivws?.url?.production || 'https://api.derivws.com/trading/v1/';
};

const getOptionsDir = () => brandConfig.platform?.derivws?.directories?.options || 'options/';

module.exports = async function handler(req, res) {
    if (req.method !== 'POST') {
        res.setHeader('Allow', 'POST');
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    const accountId = Array.isArray(req.query.accountId) ? req.query.accountId[0] : req.query.accountId;
    if (!accountId) {
        return res.status(400).json({ error: 'Missing accountId parameter' });
    }

    const authorization = req.headers.authorization || '';
    if (!authorization.toLowerCase().startsWith('bearer ')) {
        return res.status(401).json({ error: 'Missing or invalid Authorization header' });
    }

    const endpoint = `${getDerivWSBaseURL()}${getOptionsDir()}accounts/${encodeURIComponent(accountId)}/otp`;

    try {
        const headers = {
            Authorization: authorization,
        };
        // Per official Deriv documentation:
        // Deriv-App-ID is required for Personal Access Token (PAT) authentication, but not required for OAuth Bearer tokens.
        if (req.headers['deriv-app-id']) {
            headers['Deriv-App-ID'] = req.headers['deriv-app-id'];
        }

        const response = await fetch(endpoint, {
            method: 'POST',
            headers,
        });

        const contentType = response.headers.get('content-type') || 'application/json';
        const body = await response.text();

        res.status(response.status);
        res.setHeader('Content-Type', contentType);
        return res.send(body);
    } catch (error) {
        console.error('[DerivOTPProxy] Error forwarding OTP request:', error);
        return res.status(502).json({ error: 'Failed to forward Deriv OTP request' });
    }
};

