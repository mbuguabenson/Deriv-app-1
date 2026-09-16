type TTabsTitle = {
    [key: string]: string | number;
};

type TDashboardTabIndex = {
    [key: string]: number;
};

export const tabs_title: TTabsTitle = Object.freeze({
    WORKSPACE: 'Workspace',
    CHART: 'Chart',
});

export const DBOT_TABS: TDashboardTabIndex = Object.freeze({
    DASHBOARD: 0,
    BOT_BUILDER: 1,
    CHART: 2,
    TRADING_BOTS: 3,
    ANALYSIS_TOOL: 4,
    TRADINGVIEW: 5,
    SIGNALS: 6,
    SCANNER: 7,
    MANUAL_TRADING: 8,
    EASY_TOOL: 9,
    MARKETKILLER: 10,
    MULTI_TRADER: 11,
    MARKET_HUNTER_PRO: 12,
    AI_TRADING_ENGINE: 13,
    DIGITFLOW: 14,
    ELITE_PRO: 15,
    POVERTY_HUNTER: 16,
    AUTO_X_EO: 17,
    OVERLORD_AI: 18,
    COPY_TRADING: 19,
});

export const MAX_STRATEGIES = 10;

export const TAB_IDS = [
    'id-dbot-dashboard',
    'id-bot-builder',
    'id-charts',
    'id-trading-bots',
    'id-analysis-tool',
    'id-tradingview',
    'id-signals',
    'id-scanner',
    'id-manual-trading',
    'id-easy-tool',
    'id-marketkiller',
    'id-multi-trader',
    'id-market-hunter-pro',
    'id-ai-trading-engine',
    'id-digitflow',
    'id-elite-pro',
    'id-poverty-hunter',
    'id-auto-x-eo',
    'id-overlord-ai',
    'id-copy-trading',
];
