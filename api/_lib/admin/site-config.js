'use strict';

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.resolve(process.cwd(), 'data');
const CONFIG_FILE = path.join(DATA_DIR, 'site-config.json');

const ensureDataDir = () => {
    if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
    }
};

const getDefaultTabConfig = () => [
    { key: 'dashboard', label: 'Dashboard', enabled: true, order: 0 },
    { key: 'bot_builder', label: 'Bot Builder', enabled: true, order: 1 },
    { key: 'chart', label: 'Charts', enabled: true, order: 2 },
    { key: 'trading_bots', label: 'Trading Bots', enabled: true, order: 3 },
    { key: 'analysis_tool', label: 'Analysis Tool', enabled: true, order: 4 },
    { key: 'copy_trading', label: 'Copy Trading', enabled: true, order: 5 },
    { key: 'tradingview', label: 'TradingView', enabled: true, order: 6 },
    { key: 'signals', label: 'Signals', enabled: true, order: 7 },
    { key: 'auto_trades', label: 'Auto Trades', enabled: true, order: 8 },
    { key: 'scanner', label: 'AI Strategy Scanner', enabled: true, order: 9 },
    { key: 'manual_trading', label: 'Manual Trading', enabled: true, order: 10 },
    { key: 'easy_tool', label: 'Easy Tool', enabled: true, order: 11 },
    { key: 'signal_centre', label: 'Signal Centre', enabled: true, order: 12 },
    { key: 'marketkiller', label: 'MarketKiller', enabled: true, order: 13 },
    { key: 'multi_trader', label: 'Multi Trader', enabled: true, order: 14 },
    { key: 'market_hunter_pro', label: 'Market Hunter Pro', enabled: true, order: 15 },
    { key: 'ai_compounding_engine', label: 'AI Compounding Engine', enabled: true, order: 16 },
    { key: 'ai_trading_engine', label: 'AI Trading Engine 🤖', enabled: true, order: 18 },
    { key: 'dcircles', label: 'DCircles', enabled: true, order: 19 },
    { key: 'account_center', label: 'Account Center', enabled: true, order: 20 },
    { key: 'system_center', label: 'System Center', enabled: true, order: 21 },
    { key: 'pro_journal', label: 'Pro Journal', enabled: true, order: 22 },
];

const getDefaultSiteConfig = () => ({
    primaryColor: '#f5c542',
    secondaryColor: '#0e0e0e',
    accentColor: '#3b82f6',
    fontFamily: 'Inter',
    logoBase64: '',
    tabConfig: getDefaultTabConfig(),
    disabledTabs: [],
    maintenanceMode: false,
    maintenanceMessage: 'We are currently performing scheduled maintenance. Please check back shortly.',
    tabColor: 'rgba(255,255,255,0.6)',
    activeTabColor: '#ffffff',
    loginBtnBg: 'transparent',
    loginBtnText: '#ffffff',
    signupBtnBg: '#f5c542',
    signupBtnText: '#000000',
    runPanelBg: '#0e0e0e',
    runPanelText: '#ffffff',
    faviconBase64: '',
    updatedAt: Date.now(),
});

const getStoredConfig = () => {
    ensureDataDir();
    if (fs.existsSync(CONFIG_FILE)) {
        try {
            const raw = fs.readFileSync(CONFIG_FILE, 'utf8');
            const parsed = JSON.parse(raw);
            return { ...getDefaultSiteConfig(), ...parsed };
        } catch {
            /* ignore */
        }
    }
    const def = getDefaultSiteConfig();
    try {
        fs.writeFileSync(CONFIG_FILE, JSON.stringify(def, null, 2));
    } catch {
        /* ignore */
    }
    return def;
};

module.exports = async function handler(req, res) {
    res.setHeader('Content-Type', 'application/json');

    if (req.method === 'OPTIONS') {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
        return res.status(200).end();
    }

    if (req.method === 'GET') {
        const config = getStoredConfig();
        return res.status(200).json(config);
    }

    if (req.method === 'POST' || req.method === 'PUT') {
        const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
        const current = getStoredConfig();
        const updated = {
            ...current,
            ...body,
            updatedAt: Date.now(),
        };

        ensureDataDir();
        try {
            fs.writeFileSync(CONFIG_FILE, JSON.stringify(updated, null, 2));
            return res.status(200).json({
                success: true,
                message: 'Site configuration updated successfully',
                config: updated,
            });
        } catch (err) {
            console.error('[SiteConfigAPI] Failed to save site config:', err);
            return res.status(500).json({ success: false, error: 'Failed to write site config file' });
        }
    }

    res.setHeader('Allow', 'GET, POST, PUT');
    return res.status(405).json({ error: 'Method Not Allowed' });
};
