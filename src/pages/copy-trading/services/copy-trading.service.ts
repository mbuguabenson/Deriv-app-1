/**
 * copy-trading.service.ts
 *
 * Institutional Copy Trading & Account Replication Engine for Deriv
 * Supports:
 * - Real-time PAT (Personal Access Token) validation with account type (REAL vs DEMO) & live balance detection.
 * - Multi-appId fallback (1089, 121856, 16929, 36544, 36545) preventing "invalid api token" failures.
 * - Demo-to-Real Protection Guard (DISABLED by default to prevent accidental real-money losses).
 * - Real-to-Real, Demo-to-Demo, and Real-to-Demo trade mirroring.
 * - Proportional stake scaling (multiplier) or fixed stake mode.
 * - Global trade interception from Bot Builder, Quick Strategy, Free Bots, or direct manual triggers.
 * - Multi-account concurrent trade execution with isolated WebSocket pipelines.
 */

import { getAppId } from '@/components/shared/utils/config/config';
import { getAccountsList } from '@/utils/token-bridge';
import { observer as globalObserver } from '@/external/bot-skeleton/utils/observer';
import { DerivWSAccountsService } from '@/services/derivws-accounts.service';

export interface CopierAccount {
    id: string; // Unique identifier (UUID or loginid)
    token: string; // Deriv PAT token
    app_id?: string; // Verified Deriv App ID (e.g. 1089)
    loginid: string; // e.g. CR1234567 or VRTC7654321
    is_virtual: boolean; // true = DEMO (Virtual), false = REAL
    currency: string; // e.g. USD, EUR, BTC
    balance: number; // Current live balance
    fullname?: string;
    alias: string; // Friendly name e.g. "Main Real Account"
    sizing_mode: 'multiplier' | 'fixed'; // Multiplier of master stake or fixed amount
    multiplier: number; // e.g. 1.0 = exact stake, 0.5 = half stake, 2.0 = double
    fixed_stake?: number; // e.g. 1.00 USD
    is_active: boolean; // Active or Paused
    allow_demo_to_real?: boolean; // Per-account override (defaults to false)
    scopes?: string[]; // Token permission scopes (read, trade, etc.)
    total_copied_trades?: number;
    total_profit?: number;
    last_trade_time?: string;
    last_trade_status?: 'idle' | 'success' | 'failed' | 'skipped';
    last_error?: string;
}

export interface CopierTradeLog {
    id: string;
    time: string;
    master_loginid: string;
    copier_loginid: string;
    is_virtual: boolean;
    symbol: string;
    contract_type: string;
    source_tab?: string;
    master_stake: number;
    copier_stake: number;
    buy_price?: number;
    status: 'pending' | 'success' | 'failed' | 'won' | 'lost';
    profit?: number;
    error_message?: string;
    contract_id?: string | number;
}

export interface TradeParameters {
    symbol: string;
    contract_type: string;
    stake: number;
    duration: number;
    duration_unit: string;
    barrier?: string | number;
    prediction?: number;
    selected_tick?: number;
    currency?: string;
    is_virtual?: boolean;
}

const STORAGE_KEY = 'deriv_copier_accounts';
const LOGS_STORAGE_KEY = 'deriv_copier_trade_logs';
const MASTER_CONFIG_KEY = 'deriv_copier_master_config';

export interface MasterAccountConfig {
    loginid: string;
    token: string;
    is_virtual: boolean;
    balance: number;
    currency: string;
    alias: string;
    is_active: boolean; // Global master copier switch
    allow_demo_to_real: boolean; // Safety guard: strictly FALSE by default
    max_stake_guard?: number; // Single trade maximum stake cap
    daily_loss_limit?: number; // Daily loss cutoff
}

type SubscriberCallback = () => void;

/**
 * Extracts contract parameters (symbol, contract_type, duration, barrier) from Deriv contract shortcodes.
 * Example shortcodes:
 * - DIGITDIFF_1HZ100V_1.09_1726388200_1T_5
 * - CALL_R_100_19.50_1726388200_5T_S0P_0
 * - ACCU_1HZ100V_10.00_1726388200_3_0_0.03
 */
export function parseDerivShortcode(shortcode?: string): Partial<TradeParameters> {
    if (!shortcode || typeof shortcode !== 'string') return {};
    const parts = shortcode.split('_');
    if (parts.length < 2) return {};

    const contract_type = parts[0];
    const symbol = parts[1];

    let duration = 5;
    let duration_unit = 't';
    const durMatch = shortcode.match(/_(\d+)([T|M|H|D|S])_/i);
    if (durMatch) {
        duration = parseInt(durMatch[1], 10);
        duration_unit = durMatch[2].toLowerCase();
    }

    let barrier: string | undefined;
    const cType = contract_type.toUpperCase();
    if (['DIGITMATCH', 'DIGITDIFF', 'DIGITOVER', 'DIGITUNDER'].some(t => cType.startsWith(t))) {
        const lastPart = parts[parts.length - 1];
        if (/^\d+$/.test(lastPart)) {
            barrier = lastPart;
        }
    } else if (['HIGHER', 'LOWER', 'TOUCH', 'NOTOUCH', 'ONETOUCH', 'EXPIRYRANGE', 'EXPIRYMISS'].includes(cType)) {
        const lastPart = parts[parts.length - 1];
        if (lastPart) barrier = lastPart;
    }

    return {
        contract_type,
        symbol,
        duration,
        duration_unit,
        barrier,
        prediction: barrier !== undefined ? Number(barrier) : undefined,
    };
}

/**
 * Builds a valid Deriv proposal request payload matching exact Deriv contract rules.
 */
export function buildProposalRequest(trade: TradeParameters, stake: number, currency = 'USD'): Record<string, any> {
    const proposalReq: Record<string, any> = {
        proposal: 1,
        amount: stake,
        basis: 'stake',
        contract_type: trade.contract_type,
        currency: currency || 'USD',
        symbol: trade.symbol,
    };

    if (trade.contract_type === 'ACCU') {
        proposalReq.growth_rate = Number((trade as any).growth_rate || 0.03);
    } else {
        proposalReq.duration = Number(trade.duration || 5);
        proposalReq.duration_unit = trade.duration_unit || 't';
    }

    // Barrier handling according to Deriv contract specifications
    const cType = trade.contract_type?.toUpperCase() || '';
    if (['DIGITMATCH', 'DIGITDIFF', 'DIGITOVER', 'DIGITUNDER'].includes(cType)) {
        const rawBarrier = trade.barrier !== undefined && trade.barrier !== null && trade.barrier !== ''
            ? trade.barrier
            : trade.prediction;
        if (rawBarrier !== undefined && rawBarrier !== null && rawBarrier !== '') {
            proposalReq.barrier = String(Math.floor(Number(rawBarrier)));
        } else {
            proposalReq.barrier = '0';
        }
    } else if (['HIGHER', 'LOWER', 'TOUCH', 'NOTOUCH', 'ONETOUCH', 'EXPIRYRANGE', 'EXPIRYMISS'].includes(cType)) {
        const rawBarrier = trade.barrier !== undefined && trade.barrier !== null && trade.barrier !== ''
            ? trade.barrier
            : trade.prediction;
        if (rawBarrier !== undefined && rawBarrier !== null && rawBarrier !== '') {
            proposalReq.barrier = String(rawBarrier);
        }
    }
    // Note: DIGITEVEN, DIGITODD, CALL, PUT, CALLE, PUTE, ASIANU, ASIAND do not take barrier for tick durations

    if (trade.selected_tick !== undefined) {
        proposalReq.selected_tick = trade.selected_tick;
    }

    return proposalReq;
}

class CopyTradingEngine {
    private accounts: CopierAccount[] = [];
    private tradeLogs: CopierTradeLog[] = [];
    private masterConfig: MasterAccountConfig = {
        loginid: '',
        token: '',
        is_virtual: true,
        balance: 0,
        currency: 'USD',
        alias: 'Active Session Account',
        is_active: true,
        allow_demo_to_real: false, // strictly disabled by default
        max_stake_guard: 50.0,
        daily_loss_limit: 100.0,
    };
    private subscribers: Set<SubscriberCallback> = new Set();
    private isInitialized = false;
    private botObserverAttached = false;
    private recentReplications: Map<string, number> = new Map();

    constructor() {
        this.loadFromStorage();
    }

    public init(): void {
        if (this.isInitialized) return;
        this.isInitialized = true;
        this.loadFromStorage();
        this.attachBotObserver();
        this.refreshAllBalances().catch(() => {});
    }

    public subscribe(cb: SubscriberCallback): () => void {
        this.subscribers.add(cb);
        return () => this.subscribers.delete(cb);
    }

    private notify(): void {
        this.subscribers.forEach(cb => {
            try {
                cb();
            } catch (err) {
                console.error('[CopyTradingEngine] Subscriber error:', err);
            }
        });
    }

    // ─────────────────────────────────────────────────────────────────────────
    // STORAGE & STATE
    // ─────────────────────────────────────────────────────────────────────────

    private loadFromStorage(): void {
        try {
            const rawAccounts = localStorage.getItem(STORAGE_KEY);
            if (rawAccounts) {
                this.accounts = JSON.parse(rawAccounts);
            }

            const rawLogs = localStorage.getItem(LOGS_STORAGE_KEY);
            if (rawLogs) {
                this.tradeLogs = JSON.parse(rawLogs);
            }

            const rawMaster = localStorage.getItem(MASTER_CONFIG_KEY);
            if (rawMaster) {
                const parsed = JSON.parse(rawMaster);
                // Ensure allow_demo_to_real is safely initialized
                this.masterConfig = {
                    ...this.masterConfig,
                    ...parsed,
                    allow_demo_to_real: parsed.allow_demo_to_real === true, // default false if missing
                };
            }
        } catch (e) {
            console.error('[CopyTradingEngine] Error loading storage:', e);
        }
    }

    private persist(): void {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(this.accounts));
            localStorage.setItem(LOGS_STORAGE_KEY, JSON.stringify(this.tradeLogs.slice(0, 100)));
            localStorage.setItem(MASTER_CONFIG_KEY, JSON.stringify(this.masterConfig));
        } catch (e) {
            console.error('[CopyTradingEngine] Error persisting:', e);
        }
        this.notify();
    }

    public getAccounts(): CopierAccount[] {
        return [...this.accounts];
    }

    public getTradeLogs(): CopierTradeLog[] {
        return [...this.tradeLogs];
    }

    public getMasterConfig(): MasterAccountConfig {
        return { ...this.masterConfig };
    }

    public setMasterConfig(config: Partial<MasterAccountConfig>): void {
        this.masterConfig = { ...this.masterConfig, ...config };
        this.persist();
    }

    public clearLogs(): void {
        this.tradeLogs = [];
        this.persist();
    }

    // ─────────────────────────────────────────────────────────────────────────
    // DERIV TOKEN VALIDATION VIA WEBSOCKET
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Cleans and sanitizes user-pasted Deriv tokens:
     * - Strips invisible BOM (\uFEFF) and zero-width spaces (\u200B-\u200D)
     * - Strips non-breaking spaces (\u00A0) and newlines
     * - Strips enclosing quotes, double quotes, and backticks
     * - Handles pasted JSON e.g. {"token":"..."}
     * - Handles pasted URLs or query strings e.g. ?token1=xxx or &token=xxx
     * - Strips "Bearer " prefix
     * - Strips trailing dots/ellipses
     */
    public sanitizeToken(input: string): string {
        if (!input || typeof input !== 'string') return '';
        let cleaned = input.trim();

        // 1. Remove BOM, zero-width spaces, and control chars
        cleaned = cleaned.replace(/[\u200B-\u200D\uFEFF\u00A0\r\n\t]/g, '');

        // 2. Strip surrounding quotes, backticks, brackets, semicolons
        cleaned = cleaned.replace(/^['"`“”‘’\[\]{};\s]+|['"`“”‘’\[\]{};\s]+$/g, '').trim();

        // 3. Handle JSON input (e.g. {"token": "xxx"})
        if (cleaned.startsWith('{') && cleaned.endsWith('}')) {
            try {
                const parsed = JSON.parse(cleaned);
                cleaned = parsed.token || parsed.api_token || parsed.access_token || parsed.authToken || cleaned;
            } catch {}
        }

        // 4. Handle "Account: Token" or "Account - Token" or "Token: xxx" input
        if (cleaned.includes(':') || cleaned.includes(' - ')) {
            const parts = cleaned.split(/[:\-]/).map(p => p.trim());
            const tokenPart = parts.find(p => p.length >= 6 && !/^(CR|VRTC|VRW|MF|MLT)\d+$/i.test(p) && !/^(token|token1|name|deriv)$/i.test(p));
            if (tokenPart) {
                cleaned = tokenPart;
            }
        }

        // 5. Handle URL or query parameter input (e.g. ?token1=xxx or &token=xxx or acct1=CR...&token1=xxx)
        if (cleaned.includes('token1=') || cleaned.includes('token=')) {
            const match = cleaned.match(/(?:token1|token)=([a-zA-Z0-9_-]+)/i);
            if (match && match[1]) {
                cleaned = match[1];
            }
        }

        // 6. Handle multi-column paste from Deriv table (e.g. "MyToken a1-xxxxxxxxxx Read, Trade" or "pat_xxxx...")
        if (cleaned.includes(' ') || cleaned.includes('\t')) {
            const tokens = cleaned.split(/\s+/);
            const patMatch = tokens.find(
                t =>
                    /^pat_[a-zA-Z0-9_-]{16,}$/i.test(t) ||
                    /^a1-[a-zA-Z0-9]{8,}$/i.test(t) ||
                    (/^[a-zA-Z0-9_-]{12,64}$/.test(t) && !/^(read|trade|admin|payments|never|active|demo|real)$/i.test(t))
            );
            if (patMatch) {
                cleaned = patMatch;
            }
        }

        // 7. Strip "Bearer " prefix if user copied from Authorization header
        cleaned = cleaned.replace(/^Bearer\s+/i, '').trim();

        // 8. Remove any trailing ellipses if copied from truncated UI
        cleaned = cleaned.replace(/\.{2,}$/, '').trim();

        // 9. Strip surrounding quotes once more in case of double quotes
        cleaned = cleaned.replace(/^['"`“”‘’]+|['"`“”‘’]+$/g, '').trim();

        return cleaned;
    }

    /**
     * Connects to Deriv and validates an API token (PAT or OAuth).
     * Tests candidate App IDs and WebSocket endpoints in parallel for fast response.
     */
    public async validateToken(token: string, targetLoginid?: string): Promise<{
        valid: boolean;
        loginid: string;
        is_virtual: boolean;
        balance: number;
        currency: string;
        scopes: string[];
        has_trade_scope: boolean;
        fullname: string;
        email: string;
        app_id?: string;
        error?: string;
    }> {
        const cleaned = this.sanitizeToken(token);
        if (!cleaned || cleaned.length < 4) {
            return {
                valid: false,
                loginid: '',
                is_virtual: false,
                balance: 0,
                currency: 'USD',
                scopes: [],
                has_trade_scope: false,
                fullname: '',
                email: '',
                error: 'Token must be a valid non-empty string.',
            };
        }

        // Check if token is a New Deriv API token (pat_...) or OAuth JWT token (ey...)
        if (cleaned.startsWith('pat_') || cleaned.startsWith('PAT_') || cleaned.startsWith('ey')) {
            try {
                const accounts = await DerivWSAccountsService.fetchAccountsList(cleaned);
                if (accounts && accounts.length > 0) {
                    const primary = (targetLoginid ? accounts.find(a => a.account_id === targetLoginid) : null) || accounts[0];
                    return {
                        valid: true,
                        loginid: primary.account_id,
                        is_virtual: primary.account_type === 'demo',
                        balance: parseFloat(primary.balance) || 0,
                        currency: primary.currency || 'USD',
                        scopes: ['read', 'trade'],
                        has_trade_scope: true,
                        fullname: primary.account_id,
                        email: '',
                        app_id: getAppId() || '121856',
                    };
                }
                return {
                    valid: false,
                    loginid: '',
                    is_virtual: false,
                    balance: 0,
                    currency: 'USD',
                    scopes: [],
                    has_trade_scope: false,
                    fullname: '',
                    email: '',
                    error: 'No active trading accounts found for this Deriv API token.',
                };
            } catch (e: any) {
                console.warn('[validateToken] DerivWS REST verification failed:', e);
                return {
                    valid: false,
                    loginid: '',
                    is_virtual: false,
                    balance: 0,
                    currency: 'USD',
                    scopes: [],
                    has_trade_scope: false,
                    fullname: '',
                    email: '',
                    error: e?.message || 'Invalid Deriv API token. Please ensure it has Read and Trade permissions.',
                };
            }
        }

        // Primary Candidate App IDs for legacy tokens (1089 is universal Deriv App ID)
        const primaryAppIds = Array.from(new Set(['1089', getAppId() || '121856']));
        const primaryAttempts = primaryAppIds.map(appId =>
            this.tryAuthorizeWithAppId(cleaned, appId, 'wss://ws.derivws.com/websockets/v3').then(res => ({
                ...res,
                app_id: appId,
            }))
        );

        try {
            const primaryResults = await Promise.allSettled(primaryAttempts);
            for (const r of primaryResults) {
                if (r.status === 'fulfilled' && r.value.valid) {
                    const res = r.value;
                    const hasTradeScope = Array.isArray(res.scopes) && (res.scopes.includes('trade') || res.scopes.includes('admin') || res.scopes.length === 0);
                    return {
                        ...res,
                        has_trade_scope: hasTradeScope,
                    };
                }
            }

            // Fallback candidate App IDs
            const fallbackAppIds = ['16929', '36544', '36545', '66723', '11780'];
            const fallbackAttempts = fallbackAppIds.map(appId =>
                this.tryAuthorizeWithAppId(cleaned, appId, 'wss://ws.derivws.com/websockets/v3').then(res => ({
                    ...res,
                    app_id: appId,
                }))
            );

            // Also test on fallback endpoint wss://ws.binaryws.com/websockets/v3
            const binarywsAttempts = ['1089', getAppId() || '121856'].map(appId =>
                this.tryAuthorizeWithAppId(cleaned, appId, 'wss://ws.binaryws.com/websockets/v3').then(res => ({
                    ...res,
                    app_id: appId,
                }))
            );

            const secondaryResults = await Promise.allSettled([...fallbackAttempts, ...binarywsAttempts]);
            for (const r of secondaryResults) {
                if (r.status === 'fulfilled' && r.value.valid) {
                    const res = r.value;
                    const hasTradeScope = Array.isArray(res.scopes) && (res.scopes.includes('trade') || res.scopes.includes('admin') || res.scopes.length === 0);
                    return {
                        ...res,
                        has_trade_scope: hasTradeScope,
                    };
                }
            }

            // Find best error message from attempts
            let lastError = 'Invalid API token. Please verify token permissions on Deriv.';
            for (const r of [...primaryResults, ...secondaryResults]) {
                if (r.status === 'fulfilled' && r.value.error) {
                    lastError = r.value.error;
                    break;
                }
            }

            return {
                valid: false,
                loginid: '',
                is_virtual: false,
                balance: 0,
                currency: 'USD',
                scopes: [],
                has_trade_scope: false,
                fullname: '',
                email: '',
                error: lastError,
            };
        } catch (err: any) {
            return {
                valid: false,
                loginid: '',
                is_virtual: false,
                balance: 0,
                currency: 'USD',
                scopes: [],
                has_trade_scope: false,
                fullname: '',
                email: '',
                error: err?.message || 'Token validation failed.',
            };
        }
    }

    private async tryAuthorizeWithAppId(
        token: string,
        appId: string,
        wsBase = 'wss://ws.derivws.com/websockets/v3'
    ): Promise<{
        valid: boolean;
        loginid: string;
        is_virtual: boolean;
        balance: number;
        currency: string;
        scopes: string[];
        fullname: string;
        email: string;
        error?: string;
    }> {
        const wsUrl = `${wsBase}?app_id=${encodeURIComponent(appId)}&l=EN`;

        return new Promise(resolve => {
            let ws: WebSocket | null = null;
            let timeout: any = null;

            const cleanup = () => {
                if (timeout) clearTimeout(timeout);
                if (ws) {
                    try {
                        ws.onopen = null;
                        ws.onmessage = null;
                        ws.onerror = null;
                        ws.onclose = null;
                        ws.close();
                    } catch (e) {}
                    ws = null;
                }
            };

            timeout = setTimeout(() => {
                cleanup();
                resolve({
                    valid: false,
                    loginid: '',
                    is_virtual: false,
                    balance: 0,
                    currency: 'USD',
                    scopes: [],
                    fullname: '',
                    email: '',
                    error: 'Connection timed out validating token.',
                });
            }, 6000);

            try {
                ws = new WebSocket(wsUrl);

                ws.onopen = () => {
                    ws?.send(JSON.stringify({ authorize: token }));
                };

                ws.onmessage = event => {
                    try {
                        const data = JSON.parse(event.data);
                        if (data.msg_type === 'authorize') {
                            cleanup();
                            if (data.error) {
                                return resolve({
                                    valid: false,
                                    loginid: '',
                                    is_virtual: false,
                                    balance: 0,
                                    currency: 'USD',
                                    scopes: [],
                                    fullname: '',
                                    email: '',
                                    error: data.error?.message || 'Invalid token or insufficient permissions.',
                                });
                            }

                            const auth = data.authorize;
                            const isVirtual = Boolean(
                                auth.is_virtual === 1 ||
                                    (typeof auth.loginid === 'string' &&
                                        (auth.loginid.startsWith('VRTC') || auth.loginid.startsWith('VRW') || auth.loginid.startsWith('VR')))
                            );

                            return resolve({
                                valid: true,
                                loginid: auth.loginid || '',
                                is_virtual: isVirtual,
                                balance: Number(auth.balance ?? 0),
                                currency: auth.currency || 'USD',
                                scopes: Array.isArray(auth.scopes) ? auth.scopes : [],
                                fullname: auth.fullname || auth.email || auth.loginid || '',
                                email: auth.email || '',
                            });
                        }
                    } catch (err: any) {
                        cleanup();
                        resolve({
                            valid: false,
                            loginid: '',
                            is_virtual: false,
                            balance: 0,
                            currency: 'USD',
                            scopes: [],
                            fullname: '',
                            email: '',
                            error: 'Failed to process authorization response.',
                        });
                    }
                };

                ws.onerror = () => {
                    cleanup();
                    resolve({
                        valid: false,
                        loginid: '',
                        is_virtual: false,
                        balance: 0,
                        currency: 'USD',
                        scopes: [],
                        fullname: '',
                        email: '',
                        error: 'WebSocket connection failure.',
                    });
                };

                ws.onclose = () => {
                    cleanup();
                    resolve({
                        valid: false,
                        loginid: '',
                        is_virtual: false,
                        balance: 0,
                        currency: 'USD',
                        scopes: [],
                        fullname: '',
                        email: '',
                        error: 'WebSocket closed before authorization.',
                    });
                };
            } catch (e: any) {
                cleanup();
                resolve({
                    valid: false,
                    loginid: '',
                    is_virtual: false,
                    balance: 0,
                    currency: 'USD',
                    scopes: [],
                    fullname: '',
                    email: '',
                    error: e?.message || 'Could not initiate connection.',
                });
            }
        });
    }

    // ─────────────────────────────────────────────────────────────────────────
    // COPIER ACCOUNTS CRUD
    // ─────────────────────────────────────────────────────────────────────────

    public async addCopierAccount(params: {
        token: string;
        alias?: string;
        sizing_mode?: 'multiplier' | 'fixed';
        multiplier?: number;
        fixed_stake?: number;
        allow_demo_to_real?: boolean;
    }): Promise<{ success: boolean; account?: CopierAccount; error?: string }> {
        const cleanedToken = this.sanitizeToken(params.token);
        if (!cleanedToken) {
            return { success: false, error: 'Please enter a valid Deriv API token.' };
        }

        const validation = await this.validateToken(cleanedToken);
        if (!validation.valid) {
            return { success: false, error: validation.error || 'Token validation failed.' };
        }

        // Check if account already exists
        const existingIndex = this.accounts.findIndex(acc => acc.loginid === validation.loginid);
        const newAccount: CopierAccount = {
            id: validation.loginid || `acc_${Date.now()}`,
            token: cleanedToken,
            app_id: validation.app_id || '1089',
            loginid: validation.loginid,
            is_virtual: validation.is_virtual,
            currency: validation.currency,
            balance: validation.balance,
            fullname: validation.fullname,
            alias:
                params.alias?.trim() ||
                `${validation.is_virtual ? 'Demo' : 'Real'} Account (${validation.loginid})`,
            sizing_mode: params.sizing_mode || 'multiplier',
            multiplier: params.multiplier ?? 1.0,
            fixed_stake: params.fixed_stake ?? 1.0,
            is_active: true,
            allow_demo_to_real: params.allow_demo_to_real ?? false,
            scopes: validation.scopes,
            total_copied_trades: 0,
            total_profit: 0,
            last_trade_status: 'idle',
        };

        if (existingIndex >= 0) {
            this.accounts[existingIndex] = {
                ...this.accounts[existingIndex],
                ...newAccount,
                total_copied_trades: this.accounts[existingIndex].total_copied_trades,
                total_profit: this.accounts[existingIndex].total_profit,
            };
        } else {
            this.accounts.push(newAccount);
        }

        this.persist();
        return { success: true, account: newAccount };
    }

    public updateCopierAccount(id: string, updates: Partial<CopierAccount>): void {
        const index = this.accounts.findIndex(acc => acc.id === id || acc.loginid === id);
        if (index >= 0) {
            this.accounts[index] = { ...this.accounts[index], ...updates };
            this.persist();
        }
    }

    public toggleCopierActive(id: string): void {
        const account = this.accounts.find(acc => acc.id === id || acc.loginid === id);
        if (account) {
            account.is_active = !account.is_active;
            this.persist();
        }
    }

    public removeCopierAccount(id: string): void {
        this.accounts = this.accounts.filter(acc => acc.id !== id && acc.loginid !== id);
        this.persist();
    }

    /**
     * Scans browser storage (accountsList, client.accounts) to offer 1-click addition
     * of logged-in accounts.
     */
    public getAvailableStoredAccounts(): Array<{ loginid: string; token: string; is_virtual: boolean }> {
        const list = getAccountsList();
        const results: Array<{ loginid: string; token: string; is_virtual: boolean }> = [];

        for (const [loginid, token] of Object.entries(list)) {
            if (token && typeof token === 'string' && token.length > 5) {
                const is_virtual = loginid.startsWith('VRTC') || loginid.startsWith('VRW') || loginid.startsWith('VR');
                results.push({ loginid, token, is_virtual });
            }
        }
        return results;
    }

    /**
     * Refreshes balances for all saved copier accounts & master account.
     */
    public async refreshAllBalances(): Promise<void> {
        // Refresh master if token available
        if (this.masterConfig.token) {
            try {
                const token = this.masterConfig.token;
                const isNewApi =
                    token.startsWith('pat_') ||
                    token.startsWith('PAT_') ||
                    token.startsWith('ey') ||
                    (this.masterConfig.loginid && this.masterConfig.loginid.startsWith('DOT'));
                if (isNewApi) {
                    const accounts = await DerivWSAccountsService.fetchAccountsList(token);
                    const matched = accounts.find(a => a.account_id === this.masterConfig.loginid) || accounts[0];
                    if (matched) {
                        this.masterConfig.balance = parseFloat(matched.balance) || 0;
                        this.masterConfig.currency = matched.currency || 'USD';
                        this.masterConfig.is_virtual = matched.account_type === 'demo';
                    }
                } else {
                    const res = await this.validateToken(token, this.masterConfig.loginid);
                    if (res.valid) {
                        this.masterConfig.balance = res.balance;
                        this.masterConfig.currency = res.currency;
                        this.masterConfig.is_virtual = res.is_virtual;
                    }
                }
            } catch {}
        }

        // Refresh copier accounts
        for (const acc of this.accounts) {
            try {
                const token = acc.token;
                const isNewApi =
                    token.startsWith('pat_') ||
                    token.startsWith('PAT_') ||
                    token.startsWith('ey') ||
                    (acc.loginid && acc.loginid.startsWith('DOT'));
                if (isNewApi) {
                    const accounts = await DerivWSAccountsService.fetchAccountsList(token);
                    const matched = accounts.find(a => a.account_id === acc.loginid) || accounts[0];
                    if (matched) {
                        acc.balance = parseFloat(matched.balance) || 0;
                        acc.currency = matched.currency || 'USD';
                        acc.is_virtual = matched.account_type === 'demo';
                    }
                } else {
                    const res = await this.validateToken(token, acc.loginid);
                    if (res.valid) {
                        acc.balance = res.balance;
                        acc.currency = res.currency;
                        acc.is_virtual = res.is_virtual;
                    }
                }
            } catch {}
        }

        this.persist();
    }

    // ─────────────────────────────────────────────────────────────────────────
    // GLOBAL BOT OBSERVER INTERCEPTOR
    // ─────────────────────────────────────────────────────────────────────────

    private attachBotObserver(): void {
        if (this.botObserverAttached) return;
        this.botObserverAttached = true;

        try {
            // 1. Listen to bot-skeleton & manual purchase events
            globalObserver.register('contract.status', (data: any) => {
                if (!this.masterConfig.is_active) return;
                if (!data || data.id !== 'contract.purchase_received' || !data.buy) return;

                const buy = data.buy;
                const req = data.request || {};
                const params = data.parameters || req.parameters || req || {};
                const parsedShortcode = parseDerivShortcode(buy.shortcode);

                const activeLogin =
                    data.account_id ||
                    data.loginid ||
                    this.masterConfig.loginid ||
                    localStorage.getItem('active_loginid') ||
                    '';

                const masterLoginid = data.source === 'Manual Trading'
                    ? (activeLogin || 'MANUAL_TRADER')
                    : (activeLogin || 'MASTER_BOT');

                const isVirtualMaster = Boolean(
                    data.is_virtual !== undefined
                        ? data.is_virtual
                        : this.masterConfig.is_virtual ||
                          masterLoginid.startsWith('VR') ||
                          masterLoginid.startsWith('VRTC') ||
                          masterLoginid.startsWith('VRW')
                );

                const symbol = (params.underlying_symbol || params.symbol || parsedShortcode.symbol || buy.symbol || 'R_100').toString();
                const contract_type = (params.contract_type || parsedShortcode.contract_type || buy.contract_type || 'CALL').toString();
                const stake = Number(buy.buy_price ?? params.amount ?? req.price ?? req.amount ?? 1);
                const duration = Number(params.duration || parsedShortcode.duration || buy.duration || req.duration || 5);
                const duration_unit = (params.duration_unit || parsedShortcode.duration_unit || buy.duration_unit || req.duration_unit || 't').toString();
                const barrier = params.barrier !== undefined ? String(params.barrier) : parsedShortcode.barrier;
                const prediction = barrier !== undefined ? Number(barrier) : parsedShortcode.prediction;

                const tradeParams: TradeParameters = {
                    symbol,
                    contract_type,
                    stake,
                    duration,
                    duration_unit,
                    barrier,
                    prediction,
                    currency: buy.currency || params.currency || 'USD',
                    is_virtual: isVirtualMaster,
                };

                console.log(`[CopyTrading] Intercepted contract purchase: ${contract_type} on ${symbol} ($${stake}) from ${masterLoginid}`);
                this.replicateTradeToCopiers(tradeParams, masterLoginid, data.source || 'Trading Engine');
            });

            // 2. Listen to replicator.purchase events directly from Purchase.js
            globalObserver.register('replicator.purchase', (data: any) => {
                if (!this.masterConfig.is_active) return;
                if (!data) return;

                const req = data.request || {};
                const opts = data.tradeOptions || {};
                const contract_type = (data.contract_type || req.contract_type || opts.contract_type || 'CALL').toString();
                const symbol = (req.symbol || req.underlying_symbol || opts.symbol || 'R_100').toString();
                const stake = Number(req.amount ?? req.price ?? opts.amount ?? 1);
                const duration = Number(req.duration ?? opts.duration ?? 5);
                const duration_unit = (req.duration_unit || opts.duration_unit || 't').toString();
                const barrier = req.barrier !== undefined ? String(req.barrier) : (opts.prediction !== undefined ? String(opts.prediction) : undefined);

                const activeLogin = data.account_id || this.masterConfig.loginid || localStorage.getItem('active_loginid') || 'MASTER_ACCOUNT';
                const isVirtualMaster = Boolean(
                    this.masterConfig.is_virtual ||
                    activeLogin.startsWith('VR') ||
                    activeLogin.startsWith('VRTC') ||
                    activeLogin.startsWith('VRW')
                );

                console.log(`[CopyTrading] Intercepted bot purchase event: ${contract_type} on ${symbol} ($${stake})`);
                this.replicateTradeToCopiers(
                    {
                        symbol,
                        contract_type,
                        stake,
                        duration,
                        duration_unit,
                        barrier,
                        prediction: barrier !== undefined ? Number(barrier) : undefined,
                        currency: req.currency || opts.currency || 'USD',
                        is_virtual: isVirtualMaster,
                    },
                    activeLogin,
                    'Bot Engine'
                );
            });

            // 3. Listen to open contract updates for profit/loss tracking
            globalObserver.register('bot.contract', (contract: any) => {
                if (!contract || !contract.contract_id) return;
                if (contract.is_sold) {
                    const profit = Number(contract.profit ?? 0);
                    const status = profit >= 0 ? 'won' : 'lost';

                    // Update corresponding trade logs
                    let updated = false;
                    this.tradeLogs.forEach(log => {
                        if (log.contract_id === contract.contract_id || String(log.contract_id) === String(contract.contract_id)) {
                            log.status = status;
                            log.profit = profit;
                            updated = true;
                        }
                    });
                    if (updated) this.persist();
                }
            });
        } catch (err) {
            console.warn('[CopyTradingEngine] Failed to register globalObserver hook:', err);
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // TRADE REPLICATION ENGINE
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Executes trade replication across all active follower accounts.
     * Enforces Demo-to-Real safety protection (disabled by default).
     */
    public async replicateTradeToCopiers(
        trade: TradeParameters,
        masterLoginid: string,
        source = 'Trading Engine'
    ): Promise<CopierTradeLog[]> {
        if (!this.masterConfig.is_active) {
            console.log('[CopyTrading] Master copier is inactive, skipping replication.');
            return [];
        }
        const activeCopiers = this.accounts.filter(acc => acc.is_active);
        if (activeCopiers.length === 0) {
            console.log('[CopyTrading] No active copier accounts connected.');
            return [];
        }

        const isMasterVirtual = Boolean(
            trade.is_virtual !== undefined
                ? trade.is_virtual
                : this.masterConfig.is_virtual ||
                  masterLoginid.startsWith('VR') ||
                  masterLoginid.startsWith('VRTC') ||
                  masterLoginid.startsWith('VRW')
        );

        // Deduplicate rapid dual-emits within 1200ms
        const barrierKey = trade.barrier ?? trade.prediction ?? '';
        const sig = `${trade.symbol}_${trade.contract_type}_${trade.stake}_${barrierKey}_${Math.floor(Date.now() / 1200)}`;
        if (this.recentReplications.has(sig)) {
            return [];
        }
        this.recentReplications.set(sig, Date.now());

        // Housekeeping: clean expired sigs
        if (this.recentReplications.size > 80) {
            const now = Date.now();
            this.recentReplications.forEach((ts, k) => {
                if (now - ts > 10000) this.recentReplications.delete(k);
            });
        }

        const timestamp = new Date().toLocaleTimeString();
        const logs: CopierTradeLog[] = [];
        const maxStakeGuard = this.masterConfig.max_stake_guard || 100;

        console.log(`[CopyTrading] 🔄 Replicating trade (${trade.contract_type} on ${trade.symbol}) from ${masterLoginid} [${isMasterVirtual ? 'DEMO' : 'REAL'}] to ${activeCopiers.length} follower account(s)...`);

        // Execute concurrently on all active follower accounts
        await Promise.all(
            activeCopiers.map(async account => {
                // Safety Guard: Check Demo-to-Real protection
                if (isMasterVirtual && !account.is_virtual) {
                    const isAllowed = Boolean(this.masterConfig.allow_demo_to_real || account.allow_demo_to_real);
                    if (!isAllowed) {
                        console.warn(`[CopyTrading] 🛡️ Skipped replication to ${account.loginid} (REAL) because master is DEMO and allow_demo_to_real is disabled.`);
                        const skipLog: CopierTradeLog = {
                            id: `log_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
                            time: timestamp,
                            master_loginid: masterLoginid,
                            copier_loginid: account.loginid,
                            is_virtual: account.is_virtual,
                            symbol: trade.symbol,
                            contract_type: trade.contract_type,
                            source_tab: source,
                            master_stake: trade.stake,
                            copier_stake: 0,
                            status: 'failed',
                            error_message: '🛡️ Skipped (Demo to Real copy disabled to protect funds)',
                        };
                        account.last_trade_status = 'skipped';
                        account.last_trade_time = timestamp;
                        logs.push(skipLog);
                        this.tradeLogs.unshift(skipLog);
                        return;
                    }
                }

                // Calculate copier stake (1:1 replication default)
                let copierStake = trade.stake;
                if (account.sizing_mode === 'fixed' && account.fixed_stake && account.fixed_stake > 0) {
                    copierStake = account.fixed_stake;
                } else if (account.multiplier && account.multiplier > 0) {
                    copierStake = Math.max(0.35, Math.round(trade.stake * account.multiplier * 100) / 100);
                }

                // Apply max stake risk guard
                if (copierStake > maxStakeGuard) {
                    copierStake = maxStakeGuard;
                }

                const logEntry: CopierTradeLog = {
                    id: `log_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
                    time: timestamp,
                    master_loginid: masterLoginid,
                    copier_loginid: account.loginid,
                    is_virtual: account.is_virtual,
                    symbol: trade.symbol,
                    contract_type: trade.contract_type,
                    source_tab: source,
                    master_stake: trade.stake,
                    copier_stake: copierStake,
                    status: 'pending',
                };

                try {
                    console.log(`[CopyTrading] Executing trade on follower ${account.loginid} ($${copierStake})...`);
                    const result = await this.executeTradeOnAccount(account, trade, copierStake);
                    if (result.success) {
                        logEntry.status = 'success';
                        logEntry.buy_price = copierStake;
                        logEntry.contract_id = result.contract_id;
                        account.last_trade_status = 'success';
                        account.last_trade_time = timestamp;
                        account.total_copied_trades = (account.total_copied_trades || 0) + 1;
                        if (typeof result.balance_after === 'number') {
                            account.balance = result.balance_after;
                        }
                    } else {
                        logEntry.status = 'failed';
                        logEntry.error_message = result.error || 'Execution failed';
                        account.last_trade_status = 'failed';
                        account.last_trade_time = timestamp;
                        console.error(`[CopyTrading] Failed replicating to ${account.loginid}:`, result.error);
                    }
                } catch (err: any) {
                    logEntry.status = 'failed';
                    logEntry.error_message = err?.message || 'Network error';
                    account.last_trade_status = 'failed';
                    account.last_trade_time = timestamp;
                    console.error(`[CopyTrading] Error replicating to ${account.loginid}:`, err);
                }

                logs.push(logEntry);
                this.tradeLogs.unshift(logEntry);
            })
        );

        this.persist();
        return logs;
    }

    /**
     * Universal endpoint for trade replication from ANY tab/bot
     */
    public async replicateFromAnySource(
        trade: TradeParameters,
        source = 'Active Tab',
        masterLoginid?: string
    ): Promise<CopierTradeLog[]> {
        if (!this.masterConfig.is_active) return [];
        const loginid = masterLoginid || this.masterConfig.loginid || localStorage.getItem('active_loginid') || 'MASTER_ACCOUNT';
        const isVirtual = Boolean(
            trade.is_virtual !== undefined
                ? trade.is_virtual
                : this.masterConfig.is_virtual ||
                  loginid.startsWith('VR') ||
                  loginid.startsWith('VRTC') ||
                  loginid.startsWith('VRW')
        );

        return this.replicateTradeToCopiers({ ...trade, is_virtual: isVirtual }, loginid, source);
    }

    /**
     * Executes a single contract on a specific Deriv account via WebSocket.
     * Flow:
     * - New Deriv API accounts (pat_..., DOT...): Request OTP WebSocket URL and execute immediately.
     * - Legacy Deriv accounts: Connect WS & Authorize with token (supports multi-appId fallback).
     */
    public async executeTradeOnAccount(
        account: CopierAccount,
        trade: TradeParameters,
        stake: number
    ): Promise<{
        success: boolean;
        contract_id?: string | number;
        balance_after?: number;
        error?: string;
    }> {
        const isNewApi =
            (account.token && (account.token.startsWith('pat_') || account.token.startsWith('PAT_') || account.token.startsWith('ey'))) ||
            (account.loginid && (account.loginid.startsWith('DOT') || account.loginid.startsWith('dot')));

        if (isNewApi) {
            return this.executeTradeOnNewApiAccount(account, trade, stake);
        }

        const appIdsToTry = Array.from(
            new Set([account.app_id || '1089', '1089', getAppId() || '121856', '16929', '36544', '36545'])
        );

        let lastError = 'Execution failed.';

        for (const appId of appIdsToTry) {
            try {
                const res = await this.attemptExecuteTradeWithAppId(account, trade, stake, appId);
                if (res.success) {
                    if (account.app_id !== appId) {
                        account.app_id = appId;
                        this.persist();
                    }
                    return res;
                }
                lastError = res.error || lastError;
                if (
                    lastError.includes('InsufficientBalance') ||
                    lastError.includes('MarketClosed') ||
                    lastError.includes('ContractClosed')
                ) {
                    break;
                }
            } catch (e: any) {
                lastError = e?.message || lastError;
            }
        }

        return { success: false, error: lastError };
    }

    /**
     * Executes trade replication on New Deriv API (DOT... accounts and PAT / OAuth tokens)
     * using the single-use OTP WebSocket URL.
     * NOTE: The OTP WebSocket endpoint is already pre-authorized via URL parameter.
     * Sending { authorize: token } will be rejected by Deriv as invalid token.
     */
    private async executeTradeOnNewApiAccount(
        account: CopierAccount,
        trade: TradeParameters,
        stake: number
    ): Promise<{
        success: boolean;
        contract_id?: string | number;
        balance_after?: number;
        error?: string;
    }> {
        return new Promise(async resolve => {
            let ws: WebSocket | null = null;
            let timeout: any = null;
            let proposalId: string | null = null;
            let askPrice: number = stake;
            let accountCurrency = account.currency || 'USD';
            let isDirectBuySent = false;
            let isResolved = false;

            const safeResolve = (res: {
                success: boolean;
                contract_id?: string | number;
                balance_after?: number;
                error?: string;
            }) => {
                if (isResolved) return;
                isResolved = true;
                if (timeout) clearTimeout(timeout);
                if (ws) {
                    try {
                        ws.onopen = null;
                        ws.onmessage = null;
                        ws.onerror = null;
                        ws.onclose = null;
                        ws.close();
                    } catch (e) {}
                    ws = null;
                }
                resolve(res);
            };

            timeout = setTimeout(() => {
                safeResolve({ success: false, error: 'OTP trade replication timed out.' });
            }, 12000);

            try {
                console.log(`[CopyTrading] Fetching OTP WebSocket URL for follower ${account.loginid}...`);
                const otpWsUrl = await DerivWSAccountsService.fetchOTPWebSocketURL(account.token, account.loginid);
                if (!otpWsUrl) {
                    return safeResolve({ success: false, error: 'Failed to obtain OTP WebSocket URL from Deriv.' });
                }

                console.log(`[CopyTrading] Opening OTP WebSocket connection for ${account.loginid}...`);
                ws = new WebSocket(otpWsUrl);

                const sendProposal = () => {
                    const proposalReq = buildProposalRequest(trade, stake, accountCurrency);
                    console.log(`[CopyTrading] Sending trade proposal for follower ${account.loginid}:`, proposalReq);
                    ws?.send(JSON.stringify(proposalReq));
                };

                ws.onopen = () => {
                    console.log(`[CopyTrading] Follower ${account.loginid} connected to OTP WebSocket. Requesting trade proposal immediately...`);
                    sendProposal();
                };

                ws.onmessage = event => {
                    try {
                        const data = JSON.parse(event.data);

                        // Step 1: Handle Proposal Response
                        if (data.msg_type === 'proposal') {
                            if (data.error) {
                                console.warn(`[CopyTrading] Follower ${account.loginid} proposal rejected (${data.error.message}), trying direct buy fallback...`);
                                if (!isDirectBuySent) {
                                    isDirectBuySent = true;
                                    const directParams = buildProposalRequest(trade, stake, accountCurrency);
                                    delete directParams.proposal;
                                    ws?.send(
                                        JSON.stringify({
                                            buy: '1',
                                            price: stake,
                                            parameters: directParams,
                                        })
                                    );
                                    return;
                                }
                                return safeResolve({
                                    success: false,
                                    error: `Proposal error: ${data.error.message}`,
                                });
                            }

                            proposalId = data.proposal?.id;
                            askPrice = Number(data.proposal?.ask_price ?? stake);

                            if (!proposalId) {
                                return safeResolve({ success: false, error: 'No proposal ID returned from Deriv.' });
                            }

                            console.log(`[CopyTrading] Proposal received (${proposalId}, $${askPrice}). Sending buy request for follower ${account.loginid}...`);
                            ws?.send(
                                JSON.stringify({
                                    buy: proposalId,
                                    price: askPrice,
                                })
                            );
                            return;
                        }

                        // Step 2: Handle Buy Response
                        if (data.msg_type === 'buy') {
                            if (data.error) {
                                console.error(`[CopyTrading] Follower ${account.loginid} buy failed:`, data.error.message);
                                return safeResolve({
                                    success: false,
                                    error: `Buy error: ${data.error.message}`,
                                });
                            }

                            console.log(`[CopyTrading] 🎯 Follower ${account.loginid} trade SUCCESS! Contract ID: ${data.buy?.contract_id}, Balance: ${data.buy?.balance_after}`);
                            return safeResolve({
                                success: true,
                                contract_id: data.buy?.contract_id,
                                balance_after: data.buy?.balance_after,
                            });
                        }
                    } catch (err: any) {
                        safeResolve({ success: false, error: 'Failed parsing trade response.' });
                    }
                };

                ws.onerror = err => {
                    console.error(`[CopyTrading] OTP WebSocket error for ${account.loginid}:`, err);
                    safeResolve({ success: false, error: 'OTP WebSocket connection error during execution.' });
                };

                ws.onclose = () => {
                    safeResolve({ success: false, error: 'OTP WebSocket closed during execution.' });
                };
            } catch (err: any) {
                console.error(`[CopyTrading] Error executing OTP trade for ${account.loginid}:`, err);
                safeResolve({ success: false, error: `Auth error: ${err?.message || 'Failed to authenticate follower'}` });
            }
        });
    }

    private async attemptExecuteTradeWithAppId(
        account: CopierAccount,
        trade: TradeParameters,
        stake: number,
        appId: string
    ): Promise<{
        success: boolean;
        contract_id?: string | number;
        balance_after?: number;
        error?: string;
    }> {
        const wsUrl = `wss://ws.derivws.com/websockets/v3?app_id=${encodeURIComponent(appId)}&l=EN`;

        return new Promise(resolve => {
            let ws: WebSocket | null = null;
            let timeout: any = null;
            let proposalId: string | null = null;
            let askPrice: number = stake;
            let accountCurrency = account.currency || 'USD';
            let isDirectBuySent = false;

            const cleanup = () => {
                if (timeout) clearTimeout(timeout);
                if (ws) {
                    try {
                        ws.onopen = null;
                        ws.onmessage = null;
                        ws.onerror = null;
                        ws.onclose = null;
                        ws.close();
                    } catch (e) {}
                    ws = null;
                }
            };

            const sendProposal = () => {
                const proposalReq = buildProposalRequest(trade, stake, accountCurrency);
                console.log(`[CopyTrading] Requesting proposal for ${account.loginid} (app_id: ${appId}):`, proposalReq);
                ws?.send(JSON.stringify(proposalReq));
            };

            timeout = setTimeout(() => {
                cleanup();
                resolve({ success: false, error: 'Trade replication timeout.' });
            }, 12000);

            try {
                ws = new WebSocket(wsUrl);

                ws.onopen = () => {
                    console.log(`[CopyTrading] Connected WS for follower ${account.loginid}, authorizing...`);
                    ws?.send(JSON.stringify({ authorize: account.token }));
                };

                ws.onmessage = event => {
                    try {
                        const data = JSON.parse(event.data);

                        // Step 1: Authorization
                        if (data.msg_type === 'authorize') {
                            if (data.error) {
                                cleanup();
                                console.warn(`[CopyTrading] Follower ${account.loginid} auth failed:`, data.error.message);
                                return resolve({
                                    success: false,
                                    error: `Auth error: ${data.error.message}`,
                                });
                            }

                            if (data.authorize?.currency) {
                                accountCurrency = data.authorize.currency;
                                account.currency = accountCurrency;
                            }

                            console.log(`[CopyTrading] Follower ${account.loginid} authorized. Requesting trade proposal...`);
                            sendProposal();
                            return;
                        }

                        // Step 2: Handle Proposal Response
                        if (data.msg_type === 'proposal') {
                            if (data.error) {
                                console.warn(`[CopyTrading] Proposal rejected (${data.error.message}), trying direct buy fallback for ${account.loginid}...`);
                                if (!isDirectBuySent) {
                                    isDirectBuySent = true;
                                    const directParams = buildProposalRequest(trade, stake, accountCurrency);
                                    delete directParams.proposal;
                                    ws?.send(
                                        JSON.stringify({
                                            buy: '1',
                                            price: stake,
                                            parameters: directParams,
                                        })
                                    );
                                    return;
                                }
                                cleanup();
                                return resolve({
                                    success: false,
                                    error: `Proposal error: ${data.error.message}`,
                                });
                            }

                            proposalId = data.proposal?.id;
                            askPrice = Number(data.proposal?.ask_price ?? stake);

                            if (!proposalId) {
                                cleanup();
                                return resolve({ success: false, error: 'No proposal ID returned from Deriv.' });
                            }

                            console.log(`[CopyTrading] Proposal received (${proposalId}, $${askPrice}). Sending buy request for ${account.loginid}...`);
                            ws?.send(
                                JSON.stringify({
                                    buy: proposalId,
                                    price: askPrice,
                                })
                            );
                            return;
                        }

                        // Step 3: Handle Buy Response
                        if (data.msg_type === 'buy') {
                            cleanup();
                            if (data.error) {
                                console.error(`[CopyTrading] Follower ${account.loginid} buy failed:`, data.error.message);
                                return resolve({
                                    success: false,
                                    error: `Buy error: ${data.error.message}`,
                                });
                            }

                            console.log(`[CopyTrading] 🎯 Follower ${account.loginid} trade SUCCESS! Contract ID: ${data.buy?.contract_id}, Balance: ${data.buy?.balance_after}`);
                            return resolve({
                                success: true,
                                contract_id: data.buy?.contract_id,
                                balance_after: data.buy?.balance_after,
                            });
                        }
                    } catch (err: any) {
                        cleanup();
                        resolve({ success: false, error: 'Failed parsing trade response.' });
                    }
                };

                ws.onerror = () => {
                    cleanup();
                    resolve({ success: false, error: 'WebSocket connection error during execution.' });
                };

                ws.onclose = () => {
                    cleanup();
                    resolve({ success: false, error: 'WebSocket closed during execution.' });
                };
            } catch (err: any) {
                cleanup();
                resolve({ success: false, error: err?.message || 'Execution error.' });
            }
        });
    }
}

export const copyTradingService = new CopyTradingEngine();

// Auto-initialize copy trading service so listeners are active from startup
try {
    if (typeof window !== 'undefined') {
        copyTradingService.init();
    }
} catch (e) {}
