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
    EASY_TOOL: 8,
    MARKETKILLER: 9,
    MULTI_TRADER: 10,
    MARKET_HUNTER_PRO: 11,
    AI_TRADING_ENGINE: 12,
    DIGITFLOW: 13,
    ELITE_PRO: 14,
    POVERTY_HUNTER: 15,
    AUTO_X_EO: 16,
    OVERLORD_AI: 17,
    B254: 18,
    COPY_TRADING: 19,
    DTRADER: 20,
    AUTOFLIPPER: 21,
    RISE_FALL: 22,
    MANUAL_TRADING: 23,
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
    'id-b254',
    'id-copy-trading',
    'id-dtrader',
    'id-autoflipper',
    'id-rise-fall',
];
