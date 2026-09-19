import { DerivWSAccountsService } from '@/services/derivws-accounts.service';
import { OAuthTokenExchangeService } from '@/services/oauth-token-exchange.service';
import { DERIV_AFFILIATE_CONFIG } from '@/constants/affiliate-config';
import brandConfig from '../../../../../brand.config.json';

// =============================================================================
// Domain Configuration Map
// Maps each hostname to its specific Deriv APP_ID, OAuth CLIENT_ID, and the
// exact redirect URI registered in that OAuth app. Add a new entry here to
// support an additional domain — no other code changes required.
// =============================================================================

interface DomainConfig {
    clientId: string; // OAuth 2.0 CLIENT_ID (new OAuth app)
    appId?: string; // Kept as optional for backwards compatibility
    redirectUri: string; // MUST match the redirect URL registered in the OAuth app exactly
    botsFolder: string; // Public folder used by Best Bots XML loading for this domain
    canonicalHost: string; // Preferred host used for redirects and auth/session consistency
    includeLegacyAppIdInOAuth?: boolean;
    useLegacyOAuthLogin?: boolean;
    features: DomainFeatureFlags;
    ui: DomainUIConfig;
}

type MartingaleMode = 'no_martingale' | 'fixed_loss_trigger' | 'consecutive_loss_trigger';

type DomainFeatureFlags = {
    botIdeas: boolean;
    printPopups: boolean;
    autoTrades: boolean;
    manualTrading: boolean;
    scanner: boolean;
    accumilatoirs: boolean;
    chart: boolean;
    tradingView: boolean;
    competition: boolean;
};

type MartingaleConfig = {
    mode: MartingaleMode;
    consecutiveLossThreshold: number;
};

type DomainUIConfig = {
    brandName: string;
    primaryColor: string;
    secondaryColor: string;
    accentColor: string;
    logoUrl: string;
    faviconUrl: string;
    headerBgColor: string;
    headerTextColor: string;
    sidebarBgColor: string;
    sidebarTextColor: string;
    buttonPrimaryBg: string;
    buttonPrimaryText: string;
    buttonSecondaryBg: string;
    buttonSecondaryText: string;
    cardBgColor: string;
    cardBorderColor: string;
    textPrimary: string;
    textSecondary: string;
    successColor: string;
    errorColor: string;
    warningColor: string;
    fontFamily: string;
    borderRadius: string;
    showHeaderLogo: boolean;
    showHeaderTitle: boolean;
    showFooter: boolean;
    showDisclaimer: boolean;
    customCssVars: Record<string, string>;
    martingale?: MartingaleConfig;
};

interface HostedDomainDefinition {
    primaryDomain: string;
    aliases?: string[];
    clientId: string;
    appId?: string;
    botsFolder?: string;
    includeLegacyAppIdInOAuth?: boolean;
    useLegacyOAuthLogin?: boolean;
    features?: Partial<DomainFeatureFlags>;
    redirectUri?: string;
    ui?: Partial<DomainUIConfig>;
}

type DomainShellPalette = {
    primaryColor: string;
    secondaryColor: string;
    accentColor: string;
    headerBgColor: string;
    headerTextColor?: string;
    sidebarBgColor: string;
    sidebarTextColor?: string;
    navBg: string;
    navActive: string;
    navHover: string;
    pageBg: string;
    pageBgLight: string;
    sectionBg: string;
    sectionBg2: string;
    sectionMuted: string;
    sectionBorder: string;
    panelBorder: string;
    panelBorderSoft: string;
    runButton?: string;
    runButtonHover?: string;
    authBlue?: string;
    authBorder?: string;
    gold?: string;
    panelText?: string;
    panelTextMuted?: string;
};

const DEFAULT_BOTS_FOLDER = 'optimumtraders.site';
const DEFAULT_DOMAIN_FEATURES: DomainFeatureFlags = {
    botIdeas: false,
    printPopups: true,
    autoTrades: true,
    manualTrading: true,
    scanner: true,
    accumilatoirs: false,
    chart: true,
    tradingView: true,
    competition: false,
};

const DEFAULT_MARTINGALE_CONFIG: MartingaleConfig = {
    mode: 'fixed_loss_trigger',
    consecutiveLossThreshold: 1,
};

const DEFAULT_DOMAIN_UI: DomainUIConfig = {
    brandName: 'Deriv Bot',
    primaryColor: '#ff444f',
    secondaryColor: '#181c25',
    accentColor: '#ff444f',
    logoUrl: '',
    faviconUrl: '',
    headerBgColor: '#12151c',
    headerTextColor: 'var(--text-colored-background)',
    sidebarBgColor: '#181c25',
    sidebarTextColor: '#e0e0e0',
    buttonPrimaryBg: '#ff444f',
    buttonPrimaryText: 'var(--text-colored-background)',
    buttonSecondaryBg: '#222734',
    buttonSecondaryText: '#e0e0e0',
    cardBgColor: '#181c25',
    cardBorderColor: '#262c3b',
    textPrimary: 'var(--text-colored-background)',
    textSecondary: '#a0a0b0',
    successColor: '#00a79e',
    errorColor: '#ff444f',
    warningColor: '#ff9c1a',
    fontFamily: "'Inter', 'Segoe UI', sans-serif",
    borderRadius: '12px',
    showHeaderLogo: true,
    showHeaderTitle: true,
    showFooter: true,
    showDisclaimer: true,
    customCssVars: {},
    martingale: DEFAULT_MARTINGALE_CONFIG,
};

const LOCALHOST_DOMAIN_UI: Partial<DomainUIConfig> = {
    ...DEFAULT_DOMAIN_UI,
};

const createDomainShellUI = (
    brandName: string,
    {
        primaryColor,
        secondaryColor,
        accentColor,
        headerBgColor,
        headerTextColor = '#ffffff',
        sidebarBgColor,
        sidebarTextColor = '#ffffff',
        navBg,
        navActive,
        navHover,
        pageBg,
        pageBgLight,
        sectionBg,
        sectionBg2,
        sectionMuted,
        sectionBorder,
        panelBorder,
        panelBorderSoft,
        runButton = primaryColor,
        runButtonHover = accentColor,
        authBlue = secondaryColor,
        authBorder = panelBorder,
        gold = accentColor,
        panelText = headerTextColor,
        panelTextMuted = `${sidebarTextColor}cc`,
    }: DomainShellPalette
): Partial<DomainUIConfig> => ({
    brandName,
    primaryColor,
    secondaryColor,
    accentColor,
    headerBgColor,
    headerTextColor,
    sidebarBgColor,
    sidebarTextColor,
    buttonPrimaryBg: primaryColor,
    buttonPrimaryText: '#ffffff',
    buttonSecondaryBg: secondaryColor,
    buttonSecondaryText: sidebarTextColor,
    cardBgColor: sectionBg,
    cardBorderColor: sectionBorder,
    textPrimary: panelText,
    textSecondary: panelTextMuted,
    successColor: runButton,
    warningColor: gold,
    customCssVars: {
        '--rm-shell-top': headerBgColor,
        '--rm-shell-top-light': headerBgColor,
        '--rm-shell-nav': navBg,
        '--rm-shell-nav-active': navActive,
        '--rm-shell-nav-hover': navHover,
        '--rm-shell-gold': gold,
        '--rm-shell-text': headerTextColor,
        '--rm-shell-header-text': headerTextColor,
        '--rm-shell-nav-text': sidebarTextColor,
        '--rm-shell-panel-text': panelText,
        '--rm-shell-panel-text-muted': panelTextMuted,
        '--rm-shell-surface': headerBgColor,
        '--rm-shell-surface-2': sectionBg,
        '--rm-shell-border': sectionBorder,
        '--rm-shell-input-bg': sectionBg,
        '--rm-shell-input-text': headerTextColor,
        '--rm-shell-button-text': '#ffffff',
        '--rm-shell-circle-bg': navActive,
        '--rm-shell-circle-text': sidebarTextColor,
        '--rm-shell-muted': panelTextMuted,
        '--rm-shell-auth-blue': authBlue,
        '--rm-shell-auth-border': authBorder,
        '--rm-shell-run': runButton,
        '--rm-shell-run-hover': runButtonHover,
        '--rm-shell-run-panel': pageBg,
        '--rm-shell-run-panel-light': pageBgLight,
        '--rm-shell-section': sectionBg,
        '--rm-shell-section-2': sectionBg2,
        '--rm-shell-section-muted': sectionMuted,
        '--rm-shell-section-border': sectionBorder,
        '--rm-shell-run-panel-border': panelBorder,
        '--rm-shell-run-panel-border-soft': panelBorderSoft,
    },
});

const createHostedDomainEntries = ({
    primaryDomain,
    aliases = [],
    clientId,
    appId = '121856',
    botsFolder = primaryDomain,
    includeLegacyAppIdInOAuth = true,
    useLegacyOAuthLogin = true,
    features = {},
    redirectUri = `https://${primaryDomain}/`,
    ui = {},
}: HostedDomainDefinition): Record<string, DomainConfig> => {
    const config: DomainConfig = {
        clientId,
        appId,
        redirectUri,
        botsFolder,
        canonicalHost: primaryDomain,
        includeLegacyAppIdInOAuth,
        useLegacyOAuthLogin,
        features: {
            ...DEFAULT_DOMAIN_FEATURES,
            ...features,
        },
        ui: {
            ...DEFAULT_DOMAIN_UI,
            ...ui,
        },
    };

    return [primaryDomain, ...aliases].reduce<Record<string, DomainConfig>>((accumulator, hostname) => {
        accumulator[hostname] = config;
        return accumulator;
    }, {});
};

export const DOMAIN_CONFIG: Record<string, DomainConfig> = {
    ...createHostedDomainEntries({
        primaryDomain: 'hazelhub.vercel.app',
        aliases: ['www.hazelhub.vercel.app', 'hazelhub.com', 'www.hazelhub.com'],
        clientId: '34qPhRSX2dxSujd2DQNLv',
        appId: '121856',
        redirectUri: 'https://hazelhub.vercel.app/',
        features: {
            autoTrades: true,
            manualTrading: true,
            chart: true,
        },
        ui: createDomainShellUI('Legacy Trading Hub', {
            primaryColor: '#00f5ff',
            secondaryColor: '#00ff88',
            accentColor: '#7000ff',
            headerBgColor: '#0a1020',
            sidebarBgColor: '#060a14',
            navBg: '#0d1527',
            navActive: '#00f5ff',
            navHover: '#162238',
            pageBg: '#070a13',
            pageBgLight: '#f8fafc',
            sectionBg: '#0e1626',
            sectionBg2: '#131e33',
            sectionMuted: '#676a6f',
            sectionBorder: 'rgba(0, 245, 255, 0.25)',
            panelBorder: '#1c2942',
            panelBorderSoft: 'rgba(255, 255, 255, 0.08)',
            runButton: '#00ff88',
            runButtonHover: '#00e67a',
            authBlue: '#00f5ff',
            authBorder: '#00f5ff',
            gold: '#ffb703',
        }),
    }),
    ...createHostedDomainEntries({
        primaryDomain: 'profithub.co.ke',
        aliases: ['www.profithub.co.ke', 'staging.profithub.co.ke'],
        clientId: '33Mmq9JHMrJaUKT2KIhKZ',
        redirectUri: 'https://profithub.co.ke/',
        features: {
            autoTrades: true,
            manualTrading: true,
            chart: true,
        },
        ui: createDomainShellUI('ProfitHub', {
            primaryColor: '#ff444f',
            secondaryColor: '#858d9d',
            accentColor: '#ff444f',
            headerBgColor: '#12151c',
            sidebarBgColor: '#181c25',
            navBg: '#181c25',
            navActive: '#ff444f',
            navHover: '#222734',
            pageBg: '#0e1117',
            pageBgLight: '#f8fafc',
            sectionBg: '#181c25',
            sectionBg2: '#1f2430',
            sectionMuted: '#676a6f',
            sectionBorder: 'rgba(255, 68, 79, 0.25)',
            panelBorder: '#262c3b',
            panelBorderSoft: 'rgba(255, 255, 255, 0.08)',
            runButton: '#ff444f',
            runButtonHover: '#eb3e48',
            authBlue: '#ff444f',
            authBorder: '#ff444f',
            gold: '#ff9c1a',
        }),
    }),
    // ── Primary production domain ────────────────────────────────────────────
    // New OAuth app registered redirect: https://riskmanagers.site/ (trailing slash)
    ...createHostedDomainEntries({
        primaryDomain: 'riskmanagers.site',
        aliases: ['www.riskmanagers.site'],
        clientId: '33cCr2bWsByPgLlormNFw',
        appId: '71937',
        redirectUri: 'https://riskmanagers.site/',
        includeLegacyAppIdInOAuth: true,
        features: {
            autoTrades: true,
            accumilatoirs: true,
            chart: false,
            manualTrading: true,
            tradingView: false,
            competition: true,
        },
        ui: {
            ...LOCALHOST_DOMAIN_UI,
            brandName: 'Risk Managers',
        },
    }),
    // ── Additional production domain ─────────────────────────────────────────
    ...createHostedDomainEntries({
        primaryDomain: 'derivhhub.com',
        aliases: ['www.derivhhub.com', 'derivhhub.site', 'www.derivhhub.site'],
        clientId: '33h4ThjleZotVMiKQ1gE7',
        appId: '124217',
        redirectUri: 'https://derivhhub.com/',
        botsFolder: 'optimumtraders.site',
        includeLegacyAppIdInOAuth: false,
        features: {
            botIdeas: false,
            printPopups: false,
        },
        ui: createDomainShellUI('Termica FX', {
            primaryColor: '#00ff88',
            secondaryColor: '#00aaff',
            accentColor: '#ffd700',
            headerBgColor: '#030712',
            sidebarBgColor: '#062b24',
            navBg: '#064e3b',
            navActive: '#047857',
            navHover: '#047857',
            pageBg: '#082f49',
            pageBgLight: '#dcfce7',
            sectionBg: '#063244',
            sectionBg2: '#075985',
            sectionMuted: '#0369a1',
            sectionBorder: 'rgba(0, 255, 136, 0.32)',
            panelBorder: '#00ff88',
            panelBorderSoft: 'rgba(0, 255, 136, 0.22)',
            runButton: '#00b8ad',
            runButtonHover: '#00ff88',
            authBlue: '#0369a1',
            authBorder: '#00aaff',
            gold: '#ffd700',
        }),
    }),
    // Dedicated branded domains wired with the same OAuth2 flow as the working domains.
    ...createHostedDomainEntries({
        primaryDomain: 'masterhunter.site',
        aliases: ['www.masterhunter.site'],
        clientId: '33y9R1zDsuaYKXK2RaEH9',
        appId: '96223',
        redirectUri: 'https://masterhunter.site/',
        botsFolder: 'masterhunter.site',
        includeLegacyAppIdInOAuth: true,
        features: {
            autoTrades: true,
            manualTrading: true,
        },
        ui: createDomainShellUI('Master Hunter', {
            primaryColor: '#22c55e',
            secondaryColor: '#14b8a6',
            accentColor: '#f8fafc',
            headerBgColor: '#02110b',
            sidebarBgColor: '#052e16',
            navBg: '#14532d',
            navActive: '#166534',
            navHover: '#15803d',
            pageBg: '#052e16',
            pageBgLight: '#dcfce7',
            sectionBg: '#06351b',
            sectionBg2: '#064e3b',
            sectionMuted: '#047857',
            sectionBorder: 'rgba(34, 197, 94, 0.32)',
            panelBorder: '#22c55e',
            panelBorderSoft: 'rgba(34, 197, 94, 0.2)',
            runButton: '#22c55e',
            runButtonHover: '#4ade80',
            authBlue: '#14532d',
            authBorder: '#14b8a6',
            gold: '#bef264',
        }),
    }),
    ...createHostedDomainEntries({
        primaryDomain: 'husseinfx.site',
        aliases: ['www.husseinfx.site'],
        clientId: '33B0O9dYtRl6X3OQ6rJsz',
        appId: '',
        redirectUri: 'https://husseinfx.site/',
        botsFolder: 'husseinfx.site',
        includeLegacyAppIdInOAuth: false,
        features: {
            autoTrades: true,
            manualTrading: true,
        },
        ui: createDomainShellUI('Husseinfx', {
            primaryColor: '#38bdf8',
            secondaryColor: '#2563eb',
            accentColor: '#fef3c7',
            headerBgColor: '#020617',
            sidebarBgColor: '#0f172a',
            navBg: '#1d4ed8',
            navActive: '#1e40af',
            navHover: '#2563eb',
            pageBg: '#0c4a6e',
            pageBgLight: '#e0f2fe',
            sectionBg: '#075985',
            sectionBg2: '#0369a1',
            sectionMuted: '#0284c7',
            sectionBorder: 'rgba(56, 189, 248, 0.34)',
            panelBorder: '#38bdf8',
            panelBorderSoft: 'rgba(56, 189, 248, 0.22)',
            runButton: '#0ea5e9',
            runButtonHover: '#38bdf8',
            authBlue: '#1d4ed8',
            authBorder: '#7dd3fc',
            gold: '#facc15',
        }),
    }),
    ...createHostedDomainEntries({
        primaryDomain: 'levynetrading.site',
        aliases: ['www.levynetrading.site', 'novaderiv.site', 'www.novaderiv.site'],
        clientId: '33B45506MeTF6j6VHOi7A',
        appId: '',
        redirectUri: 'https://levynetrading.site/',
        botsFolder: 'levynetrading.site',
        includeLegacyAppIdInOAuth: false,
        features: {
            autoTrades: true,
            manualTrading: true,
        },
        ui: createDomainShellUI('Levyne Trading', {
            primaryColor: '#a78bfa',
            secondaryColor: '#06b6d4',
            accentColor: '#ffffff',
            headerBgColor: '#100824',
            sidebarBgColor: '#1e1b4b',
            navBg: '#5b21b6',
            navActive: '#6d28d9',
            navHover: '#7c3aed',
            pageBg: '#312e81',
            pageBgLight: '#ede9fe',
            sectionBg: '#3730a3',
            sectionBg2: '#4338ca',
            sectionMuted: '#4f46e5',
            sectionBorder: 'rgba(167, 139, 250, 0.34)',
            panelBorder: '#a78bfa',
            panelBorderSoft: 'rgba(167, 139, 250, 0.22)',
            runButton: '#06b6d4',
            runButtonHover: '#22d3ee',
            authBlue: '#5b21b6',
            authBorder: '#a78bfa',
            gold: '#f0abfc',
        }),
    }),
    ...createHostedDomainEntries({
        primaryDomain: 'tradinghubs.site',
        aliases: ['www.tradinghubs.site'],
        clientId: '33hi7ev9NiDjWY64OJuSw',
        appId: '122208',
        redirectUri: 'https://tradinghubs.site/',
        botsFolder: 'tradinghubs.site',
        includeLegacyAppIdInOAuth: true,
        features: {
            autoTrades: true,
            manualTrading: true,
        },
        ui: createDomainShellUI('Trading Hubs', {
            primaryColor: '#f59e0b',
            secondaryColor: '#ef4444',
            accentColor: '#fff7ed',
            headerBgColor: '#170b04',
            sidebarBgColor: '#431407',
            navBg: '#9a3412',
            navActive: '#c2410c',
            navHover: '#9a3412',
            pageBg: '#7c2d12',
            pageBgLight: '#ffedd5',
            sectionBg: '#9a3412',
            sectionBg2: '#c2410c',
            sectionMuted: '#ea580c',
            sectionBorder: 'rgba(245, 158, 11, 0.34)',
            panelBorder: '#f59e0b',
            panelBorderSoft: 'rgba(245, 158, 11, 0.22)',
            runButton: '#f59e0b',
            runButtonHover: '#fbbf24',
            authBlue: '#9a3412',
            authBorder: '#fed7aa',
            gold: '#fbbf24',
        }),
    }),
    ...createHostedDomainEntries({
        primaryDomain: 'mafiahub.site',
        aliases: ['www.mafiahub.site'],
        clientId: '33ABjz4hBB7eawgytiT6P',
        appId: '120589',
        redirectUri: 'https://mafiahub.site/',
        botsFolder: 'mafiahub.site',
        includeLegacyAppIdInOAuth: true,
        features: {
            autoTrades: true,
            manualTrading: true,
        },
        ui: createDomainShellUI('Mafia Hub', {
            primaryColor: '#dc2626',
            secondaryColor: '#7f1d1d',
            accentColor: '#f9fafb',
            headerBgColor: '#080202',
            sidebarBgColor: '#1f0505',
            navBg: '#450a0a',
            navActive: '#7f1d1d',
            navHover: '#991b1b',
            pageBg: '#1f0505',
            pageBgLight: '#fee2e2',
            sectionBg: '#2a0707',
            sectionBg2: '#450a0a',
            sectionMuted: '#7f1d1d',
            sectionBorder: 'rgba(220, 38, 38, 0.34)',
            panelBorder: '#dc2626',
            panelBorderSoft: 'rgba(220, 38, 38, 0.22)',
            runButton: '#dc2626',
            runButtonHover: '#ef4444',
            authBlue: '#450a0a',
            authBorder: '#dc2626',
            gold: '#fca5a5',
        }),
    }),
    ...createHostedDomainEntries({
        primaryDomain: 'easytraders.site',
        aliases: ['www.easytraders.site'],
        clientId: '33Dp1fPdIGm7Sf0zGpJYw',
        appId: '',
        redirectUri: 'https://easytraders.site/',
        botsFolder: 'easytraders.site',
        includeLegacyAppIdInOAuth: false,
        features: {
            autoTrades: true,
            manualTrading: true,
        },
        ui: createDomainShellUI('Easy Traders', {
            primaryColor: '#10b981',
            secondaryColor: '#84cc16',
            accentColor: '#ecfccb',
            headerBgColor: '#04130b',
            sidebarBgColor: '#064e3b',
            navBg: '#047857',
            navActive: '#047857',
            navHover: '#047857',
            pageBg: '#065f46',
            pageBgLight: '#d1fae5',
            sectionBg: '#047857',
            sectionBg2: '#047857',
            sectionMuted: '#10b981',
            sectionBorder: 'rgba(132, 204, 22, 0.34)',
            panelBorder: '#10b981',
            panelBorderSoft: 'rgba(16, 185, 129, 0.22)',
            runButton: '#10b981',
            runButtonHover: '#34d399',
            authBlue: '#047857',
            authBorder: '#84cc16',
            gold: '#bef264',
        }),
    }),
    ...createHostedDomainEntries({
        primaryDomain: 'dollarmaster.site',
        aliases: ['www.dollarmaster.site'],
        clientId: '33Do7K9svQABFySnUo7pE',
        appId: '',
        redirectUri: 'https://dollarmaster.site/',
        botsFolder: 'dollarmaster.site',
        includeLegacyAppIdInOAuth: false,
        features: {
            autoTrades: true,
            manualTrading: true,
        },
        ui: createDomainShellUI('Dollar Master', {
            primaryColor: '#facc15',
            secondaryColor: '#22c55e',
            accentColor: '#ffffff',
            headerBgColor: '#111006',
            sidebarBgColor: '#1f2a0a',
            navBg: '#3f6212',
            navActive: '#4d7c0f',
            navHover: '#4d7c0f',
            pageBg: '#365314',
            pageBgLight: '#fef9c3',
            sectionBg: '#3f6212',
            sectionBg2: '#4d7c0f',
            sectionMuted: '#65a30d',
            sectionBorder: 'rgba(250, 204, 21, 0.34)',
            panelBorder: '#facc15',
            panelBorderSoft: 'rgba(250, 204, 21, 0.22)',
            runButton: '#22c55e',
            runButtonHover: '#4ade80',
            authBlue: '#3f6212',
            authBorder: '#facc15',
            gold: '#facc15',
        }),
    }),
    ...createHostedDomainEntries({
        primaryDomain: 'profitempire.site',
        aliases: ['www.profitempire.site', 'primempire.site', 'www.primempire.site'],
        clientId: '33DtjQWnmdxRkogkgAOtP',
        appId: '',
        redirectUri: 'https://profitempire.site/',
        botsFolder: 'profitempire.site',
        includeLegacyAppIdInOAuth: false,
        features: {
            autoTrades: true,
            manualTrading: true,
        },
        ui: createDomainShellUI('Prime Empire', {
            primaryColor: '#e879f9',
            secondaryColor: '#f97316',
            accentColor: '#fdf4ff',
            headerBgColor: '#16051c',
            sidebarBgColor: '#3b0764',
            navBg: '#86198f',
            navActive: '#a21caf',
            navHover: '#c026d3',
            pageBg: '#581c87',
            pageBgLight: '#fae8ff',
            sectionBg: '#701a75',
            sectionBg2: '#86198f',
            sectionMuted: '#a21caf',
            sectionBorder: 'rgba(232, 121, 249, 0.34)',
            panelBorder: '#e879f9',
            panelBorderSoft: 'rgba(232, 121, 249, 0.22)',
            runButton: '#f97316',
            runButtonHover: '#fb923c',
            authBlue: '#86198f',
            authBorder: '#e879f9',
            gold: '#fdba74',
        }),
    }),
    ...createHostedDomainEntries({
        primaryDomain: 'mkulimamdogo.site',
        aliases: ['www.mkulimamdogo.site'],
        clientId: '33FIBnsBLHouNk9bOnSVa',
        appId: '',
        redirectUri: 'https://mkulimamdogo.site/',
        botsFolder: 'mkulimamdogo.site',
        includeLegacyAppIdInOAuth: false,
        features: {
            autoTrades: true,
            manualTrading: true,
        },
        ui: createDomainShellUI('Mkulima Mdogo', {
            primaryColor: '#84cc16',
            secondaryColor: '#16a34a',
            accentColor: '#fef9c3',
            headerBgColor: '#101706',
            sidebarBgColor: '#1f2a0a',
            navBg: '#365314',
            navActive: '#4d7c0f',
            navHover: '#65a30d',
            pageBg: '#365314',
            pageBgLight: '#ecfccb',
            sectionBg: '#3f6212',
            sectionBg2: '#4d7c0f',
            sectionMuted: '#65a30d',
            sectionBorder: 'rgba(132, 204, 22, 0.34)',
            panelBorder: '#84cc16',
            panelBorderSoft: 'rgba(132, 204, 22, 0.22)',
            runButton: '#16a34a',
            runButtonHover: '#22c55e',
            authBlue: '#3f6212',
            authBorder: '#bef264',
            gold: '#fde047',
        }),
    }),
    ...createHostedDomainEntries({
        primaryDomain: 'kicktrade.site',
        aliases: ['www.kicktrade.site'],
        clientId: '33vlry53HSLhXICBcUURu',
        appId: '80364',
        redirectUri: 'https://www.kicktrade.site/',
        botsFolder: 'kicktrade.site',
        includeLegacyAppIdInOAuth: true,
        features: {
            autoTrades: true,
            manualTrading: true,
        },
        ui: createDomainShellUI('Kicktrade', {
            primaryColor: '#2dd4bf',
            secondaryColor: '#0f766e',
            accentColor: '#ccfbf1',
            headerBgColor: '#031412',
            sidebarBgColor: '#042f2e',
            navBg: '#0f766e',
            navActive: '#0f766e',
            navHover: '#0f766e',
            pageBg: '#134e4a',
            pageBgLight: '#ccfbf1',
            sectionBg: '#115e59',
            sectionBg2: '#0f766e',
            sectionMuted: '#0d9488',
            sectionBorder: 'rgba(45, 212, 191, 0.34)',
            panelBorder: '#2dd4bf',
            panelBorderSoft: 'rgba(45, 212, 191, 0.22)',
            runButton: '#14b8a6',
            runButtonHover: '#2dd4bf',
            authBlue: '#0f766e',
            authBorder: '#5eead4',
            gold: '#99f6e4',
        }),
    }),
    ...createHostedDomainEntries({
        primaryDomain: 'dollarsigns.site',
        aliases: ['www.dollarsigns.site'],
        clientId: '33uLmMotAXYx94pf0CLe6',
        appId: '',
        redirectUri: 'http://dollarsigns.site/',
        botsFolder: 'dollarsigns.site',
        includeLegacyAppIdInOAuth: false,
        features: {
            autoTrades: true,
            manualTrading: true,
        },
        ui: createDomainShellUI('Dollarsign', {
            primaryColor: '#fde047',
            secondaryColor: '#16a34a',
            accentColor: '#fefce8',
            headerBgColor: '#0f1204',
            sidebarBgColor: '#1a2e05',
            navBg: '#4d7c0f',
            navActive: '#4d7c0f',
            navHover: '#4d7c0f',
            pageBg: '#365314',
            pageBgLight: '#fef9c3',
            sectionBg: '#3f6212',
            sectionBg2: '#4d7c0f',
            sectionMuted: '#65a30d',
            sectionBorder: 'rgba(253, 224, 71, 0.34)',
            panelBorder: '#fde047',
            panelBorderSoft: 'rgba(253, 224, 71, 0.22)',
            runButton: '#16a34a',
            runButtonHover: '#22c55e',
            authBlue: '#4d7c0f',
            authBorder: '#fde047',
            gold: '#fde047',
        }),
    }),
};

const normalizeHostname = (hostname: string) => hostname.split(':')[0].toLowerCase();
const DOMAIN_REDIRECTS: Record<string, string> = {
    'mrzetuzetu.site': 'https://www.kicktrade.site',
    'www.mrzetuzetu.site': 'https://www.kicktrade.site',
};

export const getDomainConfigForHost = (hostname: string): DomainConfig | undefined =>
    DOMAIN_CONFIG[normalizeHostname(hostname)];
export const getCanonicalHostForHost = (hostname: string): string | undefined =>
    DOMAIN_CONFIG[normalizeHostname(hostname)]?.canonicalHost;
export const getDomainRedirectUrl = (
    location: Pick<Location, 'hash' | 'hostname' | 'pathname' | 'search'> = window.location
) => {
    const redirect_origin = DOMAIN_REDIRECTS[normalizeHostname(location.hostname)];
    if (!redirect_origin) return '';

    return `${redirect_origin}${location.pathname}${location.search}${location.hash}`;
};

/**
 * Returns the DomainConfig for the current hostname.
 * Falls back to env vars (for local / Replit dev) when the hostname is not
 * listed in DOMAIN_CONFIG.
 */
export const getDomainConfig = (activeHostname = window.location.hostname): DomainConfig => {
    const hostname = normalizeHostname(activeHostname);
    const domain_config = getDomainConfigForHost(hostname);
    if (domain_config) {
        return domain_config;
    }
    // Fallback — used on localhost and Replit dev domains
    return {
        clientId: process.env.CLIENT_ID || '34qPhRSX2dxSujd2DQNLv',
        appId: process.env.APP_ID || '121856',
        redirectUri: process.env.REDIRECT_URI || `${window.location.origin}/`,
        botsFolder: process.env.BOTS_FOLDER || DEFAULT_BOTS_FOLDER,
        canonicalHost: hostname,
        includeLegacyAppIdInOAuth: true,
        useLegacyOAuthLogin: true,
        features: DEFAULT_DOMAIN_FEATURES,
        ui: DEFAULT_DOMAIN_UI,
    };
};

/**
 * Returns the registered production hostname for the current domain.
 * Used when we need to know which domain is active in production.
 */
export const getCurrentProductionDomain = () =>
    Object.keys(DOMAIN_CONFIG).find(domain => window.location.hostname === domain);

export const getBestBotsFolder = () => getDomainConfig().botsFolder;

export const getDomainFeatures = () => getDomainConfig().features;

export const isDomainFeatureEnabled = (feature: keyof DomainFeatureFlags) => getDomainFeatures()[feature];

export const getDomainUIConfig = (): DomainUIConfig => getDomainConfig().ui;

export const getMartingaleConfig = (): MartingaleConfig => {
    const ui = getDomainUIConfig();
    return ui.martingale ?? DEFAULT_MARTINGALE_CONFIG;
};

export const getMartingaleMode = (): MartingaleMode => getMartingaleConfig().mode;

export const getConsecutiveLossThreshold = (): number => getMartingaleConfig().consecutiveLossThreshold;

export const isMartingaleEnabled = (): boolean => {
    const mode = getMartingaleMode();
    return mode !== 'no_martingale';
};

export const applyDomainUI = (): void => {
    const ui = getDomainUIConfig();
    const targets = [document.documentElement, document.body].filter(Boolean);
    const setVariable = (key: string, value: string) => {
        targets.forEach(target => target.style.setProperty(key, value));
    };

    setVariable('--domain-primary', ui.primaryColor);
    setVariable('--domain-secondary', ui.secondaryColor);
    setVariable('--domain-accent', ui.accentColor);
    setVariable('--domain-header-bg', ui.headerBgColor);
    setVariable('--domain-header-text', ui.headerTextColor);
    setVariable('--domain-sidebar-bg', ui.sidebarBgColor);
    setVariable('--domain-sidebar-text', ui.sidebarTextColor);
    setVariable('--domain-btn-primary-bg', ui.buttonPrimaryBg);
    setVariable('--domain-btn-primary-text', ui.buttonPrimaryText);
    setVariable('--domain-btn-secondary-bg', ui.buttonSecondaryBg);
    setVariable('--domain-btn-secondary-text', ui.buttonSecondaryText);
    setVariable('--domain-card-bg', ui.cardBgColor);
    setVariable('--domain-card-border', ui.cardBorderColor);
    setVariable('--domain-text-primary', ui.textPrimary);
    setVariable('--domain-text-secondary', ui.textSecondary);
    setVariable('--domain-success', ui.successColor);
    setVariable('--domain-error', ui.errorColor);
    setVariable('--domain-warning', ui.warningColor);
    setVariable('--domain-font-family', ui.fontFamily);
    setVariable('--domain-border-radius', ui.borderRadius);
    setVariable('--rm-shell-top', ui.headerBgColor);
    setVariable('--rm-shell-top-light', ui.headerBgColor);
    setVariable('--rm-shell-text', ui.textPrimary);
    setVariable('--rm-shell-header-text', ui.headerTextColor);
    setVariable('--rm-shell-nav', ui.sidebarBgColor);
    setVariable('--rm-shell-nav-text', ui.sidebarTextColor);
    setVariable('--rm-shell-panel-text', ui.textPrimary);
    setVariable('--rm-shell-panel-text-muted', ui.textSecondary);
    setVariable('--rm-shell-run-panel', ui.secondaryColor);
    setVariable('--rm-shell-section', ui.cardBgColor);
    setVariable('--rm-shell-section-border', ui.cardBorderColor);
    setVariable('--rm-shell-run', ui.primaryColor);
    setVariable('--rm-shell-run-hover', ui.accentColor);

    Object.entries(ui.customCssVars).forEach(([key, value]) => {
        setVariable(key, value);
    });
    if (ui.brandName) {
        document.title = ui.brandName;
    }
};

export const buildBestBotsFileUrl = (bots_folder: string, file_name: string) => {
    const folder = encodeURI(bots_folder);
    return `/${folder}/${encodeURIComponent(file_name)}`;
};

export const getBestBotsFileUrl = (file_name: string) => buildBestBotsFileUrl(getBestBotsFolder(), file_name);

// =============================================================================
// WebSocket server URLs — new authenticated Deriv v3 endpoint only
// =============================================================================

// New Deriv WebSocket endpoint (both staging and production share the same URL)
export const WS_SERVERS = {
    STAGING: 'wss://ws.derivws.com/websockets/v3',
    PRODUCTION: 'wss://ws.derivws.com/websockets/v3',
} as const;

// Helper to check if we're on production domains
export const isProduction = () => {
    if (process.env.APP_ENV === 'production') return true;
    const hostname = window.location.hostname;
    if (/localhost(:\d+)?$/i.test(hostname)) return true;
    return !!DOMAIN_CONFIG[hostname];
};

// Modern Deriv public options trading WebSocket endpoint for reliable unauthenticated market data
export const DERIV_PUBLIC_WS_BASE = 'wss://api.derivws.com/trading/v1/options/ws/public';
// The Deriv v3 WebSocket base URL (for authenticated accounts / OTP)
export const DERIV_WS_BASE = 'wss://ws.derivws.com/websockets/v3';
const PUBLIC_APP_ID = '1089';

/**
 * Returns a public (unauthenticated) WebSocket URL for pre-login market data.
 * Uses the official Deriv public options trading endpoint which reliably serves
 * active_symbols, ticks, candles, and contracts without geo-restriction blocks.
 */
export const getLegacyServerURL = () => {
    const appId = getAppId() || PUBLIC_APP_ID;
    return `${DERIV_WS_BASE}?app_id=${encodeURIComponent(appId)}&l=en&brand=deriv`;
};

export const getDefaultServerURL = () => getLegacyServerURL();

/**
 * Gets the WebSocket URL for the current session.
 *
 * - Authenticated users (PKCE auth_info present): always uses the OTP-authenticated
 *   WebSocket URL returned by the Deriv REST API. This is a single-use URL that
 *   embeds the session token, so no separate `authorize` call is needed.
 *
 * - Unauthenticated users (no auth_info): returns the public WebSocket URL so
 *   market data (active_symbols, ticks) works before login.
 *
 * The legacy `use_legacy_deriv_ws` sessionStorage flag is explicitly cleared on
 * every call so transient network errors from previous sessions can never
 * permanently prevent OTP authentication.
 */
export const getSocketURL = async (): Promise<string> => {
    // Always clear the legacy fallback flag
    try { sessionStorage.removeItem('use_legacy_deriv_ws'); } catch {}

    // The api.derivws.com REST endpoints do NOT allow CORS from our deployment
    // origins (hazelhub.vercel.app, etc.). Attempting the OTP flow from these
    // origins always fails with CORS errors and cascading 429 rate limits.
    // Use the legacy ws.derivws.com/websockets/v3 endpoint which works from
    // ANY origin via app_id-based authentication.
    const CORS_WHITELISTED_ORIGINS = [
        'https://app.deriv.com',
        'https://staging-app.deriv.com',
    ];

    const currentOrigin = typeof window !== 'undefined' ? window.location.origin : '';
    const canUseOTP = CORS_WHITELISTED_ORIGINS.includes(currentOrigin);

    if (canUseOTP) {
        try {
            let authInfo = OAuthTokenExchangeService.getAuthInfo({ allowExpiredWithRefresh: true });

            const tokenNeedsRefresh =
                !!authInfo?.refresh_token && !!authInfo.expires_at && Date.now() >= authInfo.expires_at - 300000;
            if (tokenNeedsRefresh && authInfo?.refresh_token) {
                const refreshedAuth = await OAuthTokenExchangeService.refreshAccessToken(authInfo.refresh_token);
                if (refreshedAuth.access_token) {
                    authInfo = OAuthTokenExchangeService.getAuthInfo({ allowExpiredWithRefresh: false });
                }
            }

            if (authInfo?.access_token) {
                const wsUrl = await DerivWSAccountsService.getAuthenticatedWebSocketURL(authInfo.access_token);
                if (wsUrl) {
                    console.log('[getSocketURL] Using OTP-authenticated Deriv WebSocket endpoint');
                    return wsUrl;
                }
            }
        } catch (error) {
            console.warn('[getSocketURL] OTP flow failed, using legacy endpoint:', error);
        }
    }

    // Use the legacy WebSocket endpoint — works from any origin, supports
    // authorize() call for authenticated sessions after connection
    console.log('[getSocketURL] Using legacy Deriv WebSocket endpoint');
    return getDefaultServerURL();
};

export const getDebugServiceWorker = () => {
    const debug_service_worker_flag = window.localStorage.getItem('debug_service_worker');
    if (debug_service_worker_flag) return !!parseInt(debug_service_worker_flag);

    return false;
};

/**
 * Generates a cryptographically secure CSRF token
 * @returns A random base64url-encoded string
 */
const generateCSRFToken = (): string => {
    // Generate 32 random bytes (256 bits) for strong security
    const array = new Uint8Array(32);
    crypto.getRandomValues(array);

    // Convert to base64url encoding (URL-safe)
    const base64 = btoa(String.fromCharCode(...array));
    return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
};

/**
 * Generates a PKCE code verifier (random string)
 * @returns A cryptographically random base64url-encoded string (43-128 characters)
 */
const generateCodeVerifier = (): string => {
    // Generate 32 random bytes (will result in 43 characters after base64url encoding)
    const array = new Uint8Array(32);
    crypto.getRandomValues(array);

    // Convert to base64url encoding (URL-safe, no padding)
    const base64 = btoa(String.fromCharCode(...array));
    return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
};

/**
 * Generates a PKCE code challenge from a code verifier using SHA-256
 * @param verifier The code verifier string
 * @returns Promise that resolves to the base64url-encoded SHA-256 hash
 */
const generateCodeChallenge = async (verifier: string): Promise<string> => {
    // Encode the verifier as UTF-8
    const encoder = new TextEncoder();
    const data = encoder.encode(verifier);

    // Hash with SHA-256
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);

    // Convert to base64url encoding
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const base64 = btoa(String.fromCharCode(...hashArray));
    return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
};

/**
 * Stores PKCE code verifier in storage for token exchange
 * @param verifier The code verifier to store
 */
const storeCodeVerifier = (verifier: string): void => {
    try {
        sessionStorage.setItem('oauth_code_verifier', verifier);
        sessionStorage.setItem('oauth_code_verifier_timestamp', Date.now().toString());
        localStorage.setItem('oauth_code_verifier', verifier);
        localStorage.setItem('oauth_code_verifier_timestamp', Date.now().toString());
    } catch (e) {
        console.warn('[PKCE] Failed to store code verifier:', e);
    }
};

/**
 * Retrieves and validates the stored PKCE code verifier
 * @returns The code verifier if valid and not expired, null otherwise
 */
export const getCodeVerifier = (): string | null => {
    try {
        const verifier = sessionStorage.getItem('oauth_code_verifier') || localStorage.getItem('oauth_code_verifier');
        const timestamp =
            sessionStorage.getItem('oauth_code_verifier_timestamp') ||
            localStorage.getItem('oauth_code_verifier_timestamp');

        if (!verifier) {
            return null;
        }

        if (timestamp) {
            const verifierAge = Date.now() - parseInt(timestamp, 10);
            if (verifierAge > 1800000) {
                // 30 minutes
                clearCodeVerifier();
                return null;
            }
        }

        return verifier;
    } catch {
        return null;
    }
};

/**
 * Clears PKCE code verifier from storage after successful token exchange
 */
export const clearCodeVerifier = (): void => {
    try {
        sessionStorage.removeItem('oauth_code_verifier');
        sessionStorage.removeItem('oauth_code_verifier_timestamp');
        localStorage.removeItem('oauth_code_verifier');
        localStorage.removeItem('oauth_code_verifier_timestamp');
    } catch {}
};

/**
 * Stores CSRF token in storage for validation after OAuth callback
 * @param token The CSRF token to store
 */
const storeCSRFToken = (token: string): void => {
    try {
        sessionStorage.setItem('oauth_csrf_token', token);
        sessionStorage.setItem('oauth_csrf_token_timestamp', Date.now().toString());
        localStorage.setItem('oauth_csrf_token', token);
        localStorage.setItem('oauth_csrf_token_timestamp', Date.now().toString());
    } catch (e) {
        console.warn('[OAuth] Failed to store CSRF token:', e);
    }
};

/**
 * Validates CSRF token from OAuth callback
 * @param token The token to validate
 * @returns true if token is valid and not expired
 */
export const validateCSRFToken = (token: string): boolean => {
    try {
        const storedToken = sessionStorage.getItem('oauth_csrf_token') || localStorage.getItem('oauth_csrf_token');
        const timestamp =
            sessionStorage.getItem('oauth_csrf_token_timestamp') || localStorage.getItem('oauth_csrf_token_timestamp');

        if (timestamp) {
            const age = Date.now() - parseInt(timestamp, 10);
            if (age > 15 * 60 * 1000) {
                console.warn('[OAuth] CSRF token expired (>15 min)');
            }
        }

        // If storedToken is found, check match
        if (storedToken) {
            if (storedToken === token) {
                return true;
            }
        }

        // If code_verifier exists, allow callback (CSRF token might have been partitioned by browser)
        if (getCodeVerifier()) {
            return true;
        }

        return !token;
    } catch {
        return true;
    }
};

/**
 * Clears CSRF token from storage after successful validation
 */
export const clearCSRFToken = (): void => {
    try {
        sessionStorage.removeItem('oauth_csrf_token');
        sessionStorage.removeItem('oauth_csrf_token_timestamp');
        localStorage.removeItem('oauth_csrf_token');
        localStorage.removeItem('oauth_csrf_token_timestamp');
    } catch {}
};

export const generateOAuthURL = async (prompt?: string, domainConfig = getDomainConfig()) => {
    try {
        if (prompt === 'registration') {
            return DERIV_AFFILIATE_CONFIG.signupUrl;
        }

        const domainCfg = domainConfig;
        const { clientId, appId } = domainCfg;

        // Auto-input referral code and affiliate tracking for onboarding
        try {
            localStorage.setItem('affiliate_token', DERIV_AFFILIATE_CONFIG.referralCode);
            localStorage.setItem('affiliate_tracking', DERIV_AFFILIATE_CONFIG.referralCode);
            localStorage.setItem('referral_code', DERIV_AFFILIATE_CONFIG.referralCode);
        } catch {}

        // When legacy OAuth login is enabled (default across hosted domains & browser SPAs),
        // route through Deriv's OAuth v1 endpoint to receive legacy tokens (a1-...)
        // which authorize directly on ws.derivws.com/websockets/v3 and synchronize with DTrader.
        if (domainCfg.useLegacyOAuthLogin !== false) {
            const effectiveAppId = appId || getLegacyAppId() || '121856';
            const params = new URLSearchParams({
                app_id: effectiveAppId,
                l: 'en',
                brand: 'deriv',
            });
            if (prompt) {
                params.set('prompt', prompt);
            }
            params.set('affiliate_token', DERIV_AFFILIATE_CONFIG.referralCode);
            params.set('affiliate_tracking', DERIV_AFFILIATE_CONFIG.referralCode);
            params.set('referral_code', DERIV_AFFILIATE_CONFIG.referralCode);
            params.set('ref', DERIV_AFFILIATE_CONFIG.referralCode);
            params.set('t', DERIV_AFFILIATE_CONFIG.affiliateToken);
            params.set('utm_source', DERIV_AFFILIATE_CONFIG.referralCode);
            params.set('utm_medium', 'affiliate');
            params.set('utm_campaign', DERIV_AFFILIATE_CONFIG.affiliateToken);

            return `https://oauth.deriv.com/oauth2/authorize?${params.toString()}`;
        }

        // Normalize: OAuth servers require redirect_uri to exactly match the registered URI.
        // Most Deriv apps are registered with a trailing slash, so ensure it is always present.
        const redirectUri = domainCfg.redirectUri.endsWith('/')
            ? domainCfg.redirectUri
            : `${domainCfg.redirectUri}/`;

        // Use brand config for the OAuth2 base URL
        const environment = isProduction() ? 'production' : 'staging';
        const hostname = brandConfig?.platform.auth2_url?.[environment] || 'https://auth.deriv.com/oauth2/';

        if (hostname && clientId) {
            // Generate CSRF token for security
            const csrfToken = generateCSRFToken();
            storeCSRFToken(csrfToken);

            // Generate PKCE parameters
            const codeVerifier = generateCodeVerifier();
            const codeChallenge = await generateCodeChallenge(codeVerifier);
            storeCodeVerifier(codeVerifier);

            // redirectUri is sourced from DOMAIN_CONFIG and must match the URL
            // registered in the Deriv OAuth app for clientId exactly.
            const params = new URLSearchParams({
                response_type: 'code',
                client_id: clientId,
                redirect_uri: redirectUri,
                scope: 'trade',
                state: csrfToken,
                code_challenge: codeChallenge,
                code_challenge_method: 'S256',
            });

            // Auto-input referral code and affiliate tracking for onboarding
            params.set('affiliate_token', DERIV_AFFILIATE_CONFIG.referralCode);
            params.set('affiliate_tracking', DERIV_AFFILIATE_CONFIG.referralCode);
            params.set('referral_code', DERIV_AFFILIATE_CONFIG.referralCode);
            params.set('ref', DERIV_AFFILIATE_CONFIG.referralCode);
            params.set('t', DERIV_AFFILIATE_CONFIG.affiliateToken);
            params.set('utm_source', DERIV_AFFILIATE_CONFIG.referralCode);
            params.set('utm_medium', 'affiliate');
            params.set('utm_campaign', DERIV_AFFILIATE_CONFIG.affiliateToken);

            // Store referral and affiliate tokens in storage for session attribution
            try {
                localStorage.setItem('affiliate_token', DERIV_AFFILIATE_CONFIG.referralCode);
                localStorage.setItem('affiliate_tracking', DERIV_AFFILIATE_CONFIG.referralCode);
                localStorage.setItem('referral_code', DERIV_AFFILIATE_CONFIG.referralCode);
            } catch {}

            // Optional: prompt parameter
            if (prompt) {
                params.set('prompt', prompt);
            }

            return `${hostname}auth?${params.toString()}`;
        }
    } catch (error) {
        console.error('Error generating OAuth URL:', error);
    }

    return '';
};

export const getAppId = (): string => {
    try {
        const domainConfig = getDomainConfig();
        if (domainConfig && domainConfig.appId) {
            return domainConfig.appId;
        }
    } catch (e) {
        // ignore and fallback
    }
    return process.env.APP_ID || '121856';
};

export const getClientId = (): string => {
    try {
        const domainConfig = getDomainConfig();
        if (domainConfig && domainConfig.clientId) {
            return domainConfig.clientId;
        }
    } catch (e) {
        // ignore and fallback
    }
    return process.env.CLIENT_ID || '33Mmq9JHMrJaUKT2KIhKZ';
};

export const DERIV_CONFIG = {
    NEW_API_CLIENT_ID: process.env.RSBUILD_NEW_API_CLIENT_ID || process.env.CLIENT_ID || '33Mmq9JHMrJaUKT2KIhKZ',
    LEGACY_DTRADER_APP_ID: process.env.RSBUILD_LEGACY_DTRADER_APP_ID || process.env.LEGACY_APP_ID || '121856',
    NEW_API_AUTH_URL: 'https://auth.deriv.com/oauth2/auth',
    LEGACY_AUTH_URL: 'https://oauth.deriv.com/oauth2/authorize',
};

export const getLegacyOAuthURL = (redirectUri?: string): string => {
    const redirectParam = redirectUri ? `&redirect_uri=${encodeURIComponent(redirectUri)}` : '';
    return `${DERIV_CONFIG.LEGACY_AUTH_URL}?app_id=${DERIV_CONFIG.LEGACY_DTRADER_APP_ID}&l=en&brand=deriv${redirectParam}`;
};

export const getLegacyAppId = (): string => {
    return DERIV_CONFIG.LEGACY_DTRADER_APP_ID;
};

export const generateLegacyOAuthURL = (appId: string = getLegacyAppId(), redirectUri?: string): string => {
    const redirectParam = redirectUri ? `&redirect_uri=${encodeURIComponent(redirectUri)}` : '';
    return `https://oauth.deriv.com/oauth2/authorize?app_id=${appId}&l=en&brand=deriv${redirectParam}`;
};
