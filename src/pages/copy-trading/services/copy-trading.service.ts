/**
 * copy-trading.service.ts
 *
 * Institutional Copy Trading & Account Replication Engine for Deriv
 * Supports:
 * - Real-time PAT (Personal Access Token) validation with account type (REAL vs DEMO) & live balance detection.
 * - Demo-to-Real, Real-to-Real, Demo-to-Demo, and Real-to-Demo trade mirroring.
 * - Proportional stake scaling (multiplier) or fixed stake mode.
 * - Global trade interception from Bot Builder, Quick Strategy, Free Bots, or direct manual triggers.
 * - Multi-account concurrent trade execution with isolated WebSocket pipelines.
 */

import { getAppId } from '@/components/shared/utils/config/config';
import { getAccountsList } from '@/utils/token-bridge';
import { observer as globalObserver } from '@/external/bot-skeleton/utils/observer';

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
    scopes: string[]; // ['read', 'trade', 'payments', ...]
    last_trade_time?: string;
    last_trade_status?: 'success' | 'failed' | 'idle';
    total_copied_trades?: number;
    total_profit?: number;
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
    max_stake_guard?: number; // Single trade maximum stake cap
    daily_loss_limit?: number; // Daily loss cutoff
}

type SubscriberCallback = () => void;

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
    };
    private subscribers: Set<SubscriberCallback> = new Set();
    private isInitialized = false;
    private botObserverAttached = false;
    private wsConnections: Map<string, WebSocket> = new Map();
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
                this.masterConfig = { ...this.masterConfig, ...JSON.parse(rawMaster) };
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
     * Connects to Deriv WebSocket and validates an API PAT token.
     * Returns:
     * - valid: boolean
     * - loginid: string (e.g. CR12345 or VRTC12345)
     * - is_virtual: boolean (true = DEMO, false = REAL)
     * - balance: number
     * - currency: string
     * - scopes: string[]
     */
    /**
     * Connects to Deriv WebSocket and validates an API PAT token with multiple candidate App IDs.
     * Tries official Deriv API App ID (1089) first, then app-specific IDs.
     */
    public async validateToken(token: string): Promise<{
        valid: boolean;
        loginid: string;
        is_virtual: boolean;
        balance: number;
        currency: string;
        scopes: string[];
        fullname: string;
        email: string;
        app_id?: string;
        error?: string;
    }> {
        if (!token || typeof token !== 'string' || token.trim().length < 4) {
            return {
                valid: false,
                loginid: '',
                is_virtual: false,
                balance: 0,
                currency: 'USD',
                scopes: [],
                fullname: '',
                email: '',
                error: 'Token must be a valid non-empty string.',
            };
        }

        const trimmed = token.trim().replace(/^['"]+|['"]+$/g, '');
        // 1089 is the universal Deriv API ID for PAT tokens; also try platform IDs
        const candidateAppIds = Array.from(new Set(['1089', getAppId() || '121856', '66723']));

        let lastError = 'The token is invalid. Please verify token permissions on Deriv.';
        for (const appId of candidateAppIds) {
            const res = await this.tryAuthorizeWithAppId(trimmed, appId);
            if (res.valid) {
                return { ...res, app_id: appId };
            }
            if (res.error) {
                lastError = res.error;
            }
        }

        return {
            valid: false,
            loginid: '',
            is_virtual: false,
            balance: 0,
            currency: 'USD',
            scopes: [],
            fullname: '',
            email: '',
            error: lastError,
        };
    }

    private async tryAuthorizeWithAppId(
        token: string,
        appId: string
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
        const wsUrl = `wss://ws.derivws.com/websockets/v3?app_id=${encodeURIComponent(appId)}&l=EN`;

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
            }, 7000);

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
                                    error: data.error?.message || 'Invalid token or permissions insufficient.',
                                });
                            }

                            const auth = data.authorize;
                            const isVirtual = Boolean(
                                auth.is_virtual === 1 ||
                                    (typeof auth.loginid === 'string' &&
                                        (auth.loginid.startsWith('VRTC') || auth.loginid.startsWith('VRW')))
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
    }): Promise<{ success: boolean; account?: CopierAccount; error?: string }> {
        const validation = await this.validateToken(params.token);
        if (!validation.valid) {
            return { success: false, error: validation.error || 'Token validation failed.' };
        }

        // Check if account already exists
        const existingIndex = this.accounts.findIndex(acc => acc.loginid === validation.loginid);
        const newAccount: CopierAccount = {
            id: validation.loginid || `acc_${Date.now()}`,
            token: params.token.trim().replace(/^['"]+|['"]+$/g, ''),
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
                const is_virtual = loginid.startsWith('VRTC') || loginid.startsWith('VRW');
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
                const res = await this.validateToken(this.masterConfig.token);
                if (res.valid) {
                    this.masterConfig.balance = res.balance;
                    this.masterConfig.currency = res.currency;
                    this.masterConfig.is_virtual = res.is_virtual;
                }
            } catch {}
        }

        // Refresh copier accounts
        for (const acc of this.accounts) {
            try {
                const res = await this.validateToken(acc.token);
                if (res.valid) {
                    acc.balance = res.balance;
                    acc.currency = res.currency;
                    acc.is_virtual = res.is_virtual;
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
            // Listen to bot-skeleton purchase events
            globalObserver.register('contract.status', (data: any) => {
                if (!this.masterConfig.is_active) return;
                if (!data || data.id !== 'contract.purchase_received' || !data.buy) return;

                const buy = data.buy;
                const masterLoginid = this.masterConfig.loginid || 'MASTER_BOT';

                // Extract trade params from purchase response or context
                const tradeParams: TradeParameters = {
                    symbol: buy.symbol || 'R_100',
                    contract_type: buy.contract_type || 'CALL',
                    stake: Number(buy.buy_price ?? 1),
                    duration: Number(buy.duration ?? 5),
                    duration_unit: buy.duration_unit || 't',
                    barrier: buy.barrier,
                    prediction: buy.prediction,
                    currency: buy.currency || 'USD',
                };

                this.replicateTradeToCopiers(tradeParams, masterLoginid);
            });

            // Listen to open contract updates for profit/loss tracking
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
     */
    public async replicateTradeToCopiers(
        trade: TradeParameters,
        masterLoginid: string,
        source = 'Trading Engine'
    ): Promise<CopierTradeLog[]> {
        if (!this.masterConfig.is_active) return [];
        const activeCopiers = this.accounts.filter(acc => acc.is_active);
        if (activeCopiers.length === 0) return [];

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

        // Execute concurrently on all active follower accounts
        await Promise.all(
            activeCopiers.map(async account => {
                // Calculate copier stake
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
                    }
                } catch (err: any) {
                    logEntry.status = 'failed';
                    logEntry.error_message = err?.message || 'Network error';
                    account.last_trade_status = 'failed';
                    account.last_trade_time = timestamp;
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
        const loginid = masterLoginid || this.masterConfig.loginid || 'MASTER_ACCOUNT';
        return this.replicateTradeToCopiers(trade, loginid, source);
    }

    /**
     * Executes a single contract on a specific Deriv account via WebSocket.
     * Flow:
     * 1. Connect WS & Authorize with PAT token.
     * 2. Request Proposal (price & proposal ID).
     * 3. Send Buy request.
     * 4. Return result and new balance.
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
        const appId = account.app_id || '1089';
        const wsUrl = `wss://ws.derivws.com/websockets/v3?app_id=${encodeURIComponent(appId)}&l=EN`;

        return new Promise(resolve => {
            let ws: WebSocket | null = null;
            let timeout: any = null;
            let proposalId: string | null = null;
            let askPrice: number = stake;

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
                resolve({ success: false, error: 'Trade replication timeout.' });
            }, 18000);

            try {
                ws = new WebSocket(wsUrl);

                ws.onopen = () => {
                    ws?.send(JSON.stringify({ authorize: account.token }));
                };

                ws.onmessage = event => {
                    try {
                        const data = JSON.parse(event.data);

                        // Step 1: Authorization
                        if (data.msg_type === 'authorize') {
                            if (data.error) {
                                cleanup();
                                return resolve({
                                    success: false,
                                    error: `Auth error: ${data.error.message}`,
                                });
                            }

                            // Step 2: Send Proposal Request
                            const proposalReq: Record<string, any> = {
                                proposal: 1,
                                amount: stake,
                                basis: 'stake',
                                contract_type: trade.contract_type,
                                currency: account.currency || 'USD',
                                symbol: trade.symbol,
                                duration: trade.duration || 5,
                                duration_unit: trade.duration_unit || 't',
                            };

                            const rawBarrier =
                                trade.barrier !== undefined && trade.barrier !== null && trade.barrier !== ''
                                    ? trade.barrier
                                    : trade.prediction;
                            if (rawBarrier !== undefined && rawBarrier !== null && rawBarrier !== '') {
                                proposalReq.barrier = String(rawBarrier);
                            }
                            if (trade.selected_tick !== undefined) {
                                proposalReq.selected_tick = trade.selected_tick;
                            }

                            ws?.send(JSON.stringify(proposalReq));
                            return;
                        }

                        // Step 3: Handle Proposal Response
                        if (data.msg_type === 'proposal') {
                            if (data.error) {
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
                                return resolve({ success: false, error: 'No proposal ID returned' });
                            }

                            // Step 4: Send Buy Request
                            ws?.send(
                                JSON.stringify({
                                    buy: proposalId,
                                    price: askPrice,
                                })
                            );
                            return;
                        }

                        // Step 5: Handle Buy Response
                        if (data.msg_type === 'buy') {
                            cleanup();
                            if (data.error) {
                                return resolve({
                                    success: false,
                                    error: `Buy failed: ${data.error.message}`,
                                });
                            }

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
                    resolve({ success: false, error: 'WebSocket error during execution.' });
                };
            } catch (err: any) {
                cleanup();
                resolve({ success: false, error: err?.message || 'Execution error.' });
            }
        });
    }
}

export const copyTradingService = new CopyTradingEngine();
