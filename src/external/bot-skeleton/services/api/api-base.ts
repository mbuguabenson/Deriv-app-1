/* [AI] - Analytics removed - utility functions moved to @/utils/account-helpers */
import { getAccountId, getAccountType, isDemoAccount, removeUrlParameter } from '@/utils/account-helpers';
/* [/AI] */
import CommonStore from '@/stores/common-store';
import { DerivWSAccountsService } from '@/services/derivws-accounts.service';
import { OAuthTokenExchangeService } from '@/services/oauth-token-exchange.service';
import { clearAuthData } from '@/utils/auth-utils';
import { purgeInvalidToken, resolveValidDerivWSToken } from '@/utils/token-bridge';

import { handleBackendError, isBackendError } from '@/utils/error-handler';
import { activeSymbolsProcessorService } from '../../../../services/active-symbols-processor.service';
import { observer as globalObserver } from '../../utils/observer';
import { socket_state } from '../tradeEngine/utils/helpers';
import {
    CONNECTION_STATUS,
    setAccountList,
    setAuthData,
    setConnectionStatus,
    setIsAuthorized,
    setIsAuthorizing,
} from './observables/connection-status-stream';
import { generateDerivApiInstance, V2GetActiveAccountId } from './appId';
import chart_api from './chart-api';
import { ALL_DERIV_MARKETS } from '@/constants/markets';

type CurrentSubscription = {
    id: string;
    unsubscribe: () => void;
};

type SubscriptionPromise = Promise<{
    subscription: CurrentSubscription;
}>;

type TApiBaseApi = any;

const FALLBACK_SYMBOLS_LIST = [
    // Continuous Indices
    { value: 'R_10', label: 'Volatility 10 Index', group: 'Continuous Indices', market: 'synthetic_index', submarket: 'random_index' },
    { value: 'R_25', label: 'Volatility 25 Index', group: 'Continuous Indices', market: 'synthetic_index', submarket: 'random_index' },
    { value: 'R_50', label: 'Volatility 50 Index', group: 'Continuous Indices', market: 'synthetic_index', submarket: 'random_index' },
    { value: 'R_75', label: 'Volatility 75 Index', group: 'Continuous Indices', market: 'synthetic_index', submarket: 'random_index' },
    { value: 'R_100', label: 'Volatility 100 Index', group: 'Continuous Indices', market: 'synthetic_index', submarket: 'random_index' },
    { value: '1HZ10V', label: 'Volatility 10 (1s) Index', group: 'Continuous Indices', market: 'synthetic_index', submarket: 'random_index' },
    { value: '1HZ25V', label: 'Volatility 25 (1s) Index', group: 'Continuous Indices', market: 'synthetic_index', submarket: 'random_index' },
    { value: '1HZ50V', label: 'Volatility 50 (1s) Index', group: 'Continuous Indices', market: 'synthetic_index', submarket: 'random_index' },
    { value: '1HZ75V', label: 'Volatility 75 (1s) Index', group: 'Continuous Indices', market: 'synthetic_index', submarket: 'random_index' },
    { value: '1HZ100V', label: 'Volatility 100 (1s) Index', group: 'Continuous Indices', market: 'synthetic_index', submarket: 'random_index' },
    // NOTE: 1HZ150V, 1HZ200V, 1HZ250V, 1HZ300V are disabled
    // Crash/Boom Indices
    { value: 'CRASH300N', label: 'Crash 300 Index', group: 'Crash/Boom Indices', market: 'synthetic_index', submarket: 'crash_index' },
    { value: 'CRASH500', label: 'Crash 500 Index', group: 'Crash/Boom Indices', market: 'synthetic_index', submarket: 'crash_index' },
    { value: 'CRASH1000', label: 'Crash 1000 Index', group: 'Crash/Boom Indices', market: 'synthetic_index', submarket: 'crash_index' },
    { value: 'BOOM300N', label: 'Boom 300 Index', group: 'Crash/Boom Indices', market: 'synthetic_index', submarket: 'crash_index' },
    { value: 'BOOM500', label: 'Boom 500 Index', group: 'Crash/Boom Indices', market: 'synthetic_index', submarket: 'crash_index' },
    { value: 'BOOM1000', label: 'Boom 1000 Index', group: 'Crash/Boom Indices', market: 'synthetic_index', submarket: 'crash_index' },
    // Jump Indices
    { value: 'JD10', label: 'Jump 10 Index', group: 'Jump Indices', market: 'synthetic_index', submarket: 'jump_index' },
    { value: 'JD25', label: 'Jump 25 Index', group: 'Jump Indices', market: 'synthetic_index', submarket: 'jump_index' },
    { value: 'JD50', label: 'Jump 50 Index', group: 'Jump Indices', market: 'synthetic_index', submarket: 'jump_index' },
    { value: 'JD75', label: 'Jump 75 Index', group: 'Jump Indices', market: 'synthetic_index', submarket: 'jump_index' },
    { value: 'JD100', label: 'Jump 100 Index', group: 'Jump Indices', market: 'synthetic_index', submarket: 'jump_index' },
    // Step Indices
    { value: 'STPIND', label: 'Step Index', group: 'Step Indices', market: 'synthetic_index', submarket: 'step_index' },
    { value: 'STEP100', label: 'Step 100 Index', group: 'Step Indices', market: 'synthetic_index', submarket: 'step_index' },
    { value: 'STEP200', label: 'Step 200 Index', group: 'Step Indices', market: 'synthetic_index', submarket: 'step_index' },
    { value: 'STEP500', label: 'Step 500 Index', group: 'Step Indices', market: 'synthetic_index', submarket: 'step_index' },
    // Range Break Indices
    { value: 'RDBEAR', label: 'Range Break 100 Index', group: 'Range Break Indices', market: 'synthetic_index', submarket: 'range_break' },
    { value: 'RDBULL', label: 'Range Break 200 Index', group: 'Range Break Indices', market: 'synthetic_index', submarket: 'range_break' },
    // Drift Switch Indices
    { value: 'DSI10', label: 'Drift Switch 10 Index', group: 'Drift Switch Indices', market: 'synthetic_index', submarket: 'random_daily' },
    { value: 'DSI20', label: 'Drift Switch 20 Index', group: 'Drift Switch Indices', market: 'synthetic_index', submarket: 'random_daily' },
    { value: 'DSI30', label: 'Drift Switch 30 Index', group: 'Drift Switch Indices', market: 'synthetic_index', submarket: 'random_daily' },
];

const buildFallbackActiveSymbols = (): any[] => {
    const list =
        typeof ALL_DERIV_MARKETS !== 'undefined' && Array.isArray(ALL_DERIV_MARKETS) && ALL_DERIV_MARKETS.length > 0
            ? ALL_DERIV_MARKETS
            : FALLBACK_SYMBOLS_LIST;
    return list.map(m => ({
        symbol: m.value,
        underlying_symbol: m.value,
        display_name: m.label,
        market: (m as any).market || 'synthetic_index',
        market_display_name: 'Derived',
        submarket: (m as any).submarket || 'random_index',
        submarket_display_name: m.group || 'Continuous Indices',
        subgroup: 'synthetics',
        subgroup_display_name: 'Synthetics',
        pip: 2,
        pip_size: 2,
        delay_amount: 0,
        exchange_is_open: true,
        is_trading_suspended: false,
    }));
};

class APIBase {
    api: TApiBaseApi | null = null;
    token: string = '';
    account_id: string = '';
    pip_sizes = {};
    account_info = {};
    is_running = false;
    subscriptions: CurrentSubscription[] = [];
    time_interval: ReturnType<typeof setInterval> | null = null;
    has_active_symbols = false;
    is_stopping = false;
    active_symbols: any[] = [];
    active_symbols_source: 'fallback' | 'cache' | 'live' = 'fallback';
    current_auth_subscriptions: SubscriptionPromise[] = [];
    is_authorized = false;
    active_symbols_promise: Promise<any[]> | null = null;
    common_store: CommonStore | undefined;
    reconnection_attempts: number = 0;
    ACTIVE_SYMBOLS_TIMEOUT_MS = 10000;
    ENRICHMENT_TIMEOUT_MS = 10000;
    private rate_limit_backoff_delay = 3000; // starts at 3s, doubles on rate limits up to 30s
    private rate_limit_retry_timer: ReturnType<typeof setTimeout> | null = null;
    private reconnect_timeout: ReturnType<typeof setTimeout> | null = null;
    private readonly MAX_RECONNECTION_ATTEMPTS = 15;
    private init_promise: Promise<void> | null = null;
    // Bump this version whenever the shape/content of cached_active_symbols changes
    // so stale caches are automatically invalidated on the next page load.
    private readonly CACHE_VERSION = 'v5_safe_fraction_pip';

    constructor() {
        this.loadCachedActiveSymbols();
    }

    private loadCachedActiveSymbols() {
        try {
            if (typeof window !== 'undefined' && window.localStorage) {
                // Check cache version — if stale, discard and rebuild from fallback
                const cachedVersion = localStorage.getItem('cached_active_symbols_version');
                if (cachedVersion !== this.CACHE_VERSION) {
                    // Stale cache: remove and force fresh fetch
                    localStorage.removeItem('cached_active_symbols');
                    localStorage.removeItem('cached_active_symbols_version');
                    console.info('[APIBase] Cleared stale active symbols cache (version mismatch)');
                } else {
                    const cached = localStorage.getItem('cached_active_symbols');
                    if (cached) {
                        const parsed = JSON.parse(cached);
                        if (Array.isArray(parsed) && parsed.length > 0) {
                            this.active_symbols = parsed;
                            // Cached symbols are provisional. Always refresh from the live API before
                            // treating them as authoritative because symbol availability changes.
                            this.has_active_symbols = false;
                            this.active_symbols_source = 'cache';
                            return;
                        }
                    }
                }
            }
        } catch {}
        // Pre-seed in-memory with fallback symbols so all components have valid symbols on frame 1
        this.active_symbols = buildFallbackActiveSymbols();
        this.has_active_symbols = false;
        this.active_symbols_source = 'fallback';
    }

    unsubscribeAllSubscriptions = () => {
        if (!Array.isArray(this.current_auth_subscriptions)) {
            this.current_auth_subscriptions = [];
            return;
        }

        this.current_auth_subscriptions.forEach((sub: any) => {
            if (!sub) return;
            try {
                if (typeof sub.then === 'function') {
                    sub.then((res: any) => {
                        const subId = res?.subscription?.id || res?.id || res?.subscription_id;
                        if (subId && this.api) {
                            this.api.send({ forget: subId }).catch(() => {});
                        }
                        if (typeof res?.unsubscribe === 'function') {
                            res.unsubscribe();
                        }
                    }).catch(() => {});
                } else {
                    const subId = sub?.subscription?.id || sub?.id || sub?.subscription_id;
                    if (subId && this.api) {
                        this.api.send({ forget: subId }).catch(() => {});
                    }
                    if (typeof sub.unsubscribe === 'function') {
                        sub.unsubscribe();
                    }
                }
            } catch (err) {
                console.warn('[APIBase] Error during subscription cleanup:', err);
            }
        });
        this.current_auth_subscriptions = [];
    };

    onsocketopen() {
        setConnectionStatus(CONNECTION_STATUS.OPENED);

        // Reset reconnection attempts on successful connection
        this.reconnection_attempts = 0;
        if (this.reconnect_timeout) {
            clearTimeout(this.reconnect_timeout);
            this.reconnect_timeout = null;
        }

        this.startHeartbeat();

        const currentClientStore = globalObserver.getState('client.store');
        if (currentClientStore) {
            currentClientStore.setIsAccountRegenerating(false);
        }

        globalObserver.emit('ws.opened');

        this.handleTokenExchangeIfNeeded();
    }

    private async handleTokenExchangeIfNeeded() {
        const urlParams = new URLSearchParams(window.location.search);
        const account_id = urlParams.get('account_id');
        const accountType = urlParams.get('account_type');

        if (account_id) {
            localStorage.setItem('active_loginid', account_id);
            // Remove account_id from URL after storing
            removeUrlParameter('account_id');
        }
        if (accountType) {
            localStorage.setItem('account_type', accountType);
            // Remove account_type from URL after storing
            removeUrlParameter('account_type');
        }

        // Check if we have an account_id from URL or localStorage
        let activeAccountId: string | null = getAccountId();

        // If no account_id in localStorage, check sessionStorage for accounts
        if (!activeAccountId) {
            try {
                const storedAccounts = sessionStorage.getItem('deriv_accounts');
                if (storedAccounts) {
                    const accounts = JSON.parse(storedAccounts);
                    if (accounts && accounts.length > 0 && accounts[0].account_id) {
                        // Use the first account as default
                        const accountId = accounts[0].account_id as string;
                        activeAccountId = accountId;
                        localStorage.setItem('active_loginid', accountId);

                        // Set account type based on account_id prefix
                        const isDemo = accountId.startsWith('VRT') || accountId.startsWith('VRTC');
                        localStorage.setItem('account_type', isDemo ? 'demo' : 'real');
                    }
                }
            } catch (error) {
                console.error('[APIBase] Error reading accounts from sessionStorage:', error);
            }
        }

        // Now proceed with normal authorization if we have an account_id
        if (activeAccountId) {
            setIsAuthorizing(true);
            await this.authorizeAndSubscribe();
            return;
        }

        // If a PKCE auth session exists, attempt authorization from access_token even
        // when active_loginid is not yet present in localStorage.
        const authInfo = OAuthTokenExchangeService.getAuthInfo();
        if (authInfo?.access_token) {
            setIsAuthorizing(true);
            await this.authorizeAndSubscribe();
            return;
        }

        // No active account or auth info found -- end authorizing state cleanly.
        setIsAuthorizing(false);
    }

    onsocketclose() {
        this.stopHeartbeat();
        setConnectionStatus(CONNECTION_STATUS.CLOSED);

        if (!this.is_authorized) {
            setIsAuthorizing(false);
        }

        this.reconnectIfNotConnected();
    }

    onSocketError = (event: Event) => {
        console.error('[APIBase] WebSocket error event:', event);
        if (!this.is_authorized) {
            setIsAuthorizing(false);
        }
    };

    async waitForConnection(timeoutMs = 5000): Promise<boolean> {
        if (this.api?.connection?.readyState === 1) return true;
        if (!this.api || this.api?.connection?.readyState > 1) {
            this.init().catch(() => {});
        }
        if (this.api?.connection?.readyState === 1) return true;

        return new Promise(resolve => {
            const start = Date.now();
            const check = () => {
                if (this.api?.connection?.readyState === 1) {
                    resolve(true);
                } else if (Date.now() - start >= timeoutMs) {
                    resolve(false);
                } else {
                    setTimeout(check, 50);
                }
            };
            check();
        });
    }

    async init(force_create_connection = false): Promise<void> {
        // If an init is already in flight and this is not a force reconnect, reuse the existing promise
        if (!force_create_connection && this.init_promise) {
            return this.init_promise;
        }

        // If connection is already OPEN and no force reconnect, nothing to do
        if (!force_create_connection && this.api?.connection?.readyState === 1) {
            return;
        }

        // If connection is currently CONNECTING and no force reconnect, wait for it rather than destroying it
        if (!force_create_connection && this.api?.connection?.readyState === 0) {
            return this.waitForConnection(5000).then(() => {});
        }

        this.init_promise = (async () => {
            try {
                if (this.api) {
                    this.unsubscribeAllSubscriptions();
                }

                // Reset reconnection attempts counter on successful connection initialization
                if (!force_create_connection) {
                    this.reconnection_attempts = 0;
                }

                const readyState = this.api?.connection?.readyState;
                const needsNewConnection = !this.api || readyState === undefined || readyState > 1 || force_create_connection;

                if (needsNewConnection) {
                    if (this.api?.connection) {
                        setConnectionStatus(CONNECTION_STATUS.CLOSED);
                        try {
                            this.api.connection.removeEventListener('open', this.onsocketopen.bind(this));
                            this.api.connection.removeEventListener('close', this.onsocketclose.bind(this));
                            this.api.disconnect();
                        } catch {}
                    }

                    this.api = await generateDerivApiInstance(force_create_connection);

                    this.api?.connection.addEventListener('open', this.onsocketopen.bind(this));
                    this.api?.connection.addEventListener('close', this.onsocketclose.bind(this));

                    // Store the current account ID used for this WebSocket connection
                    // This will be used to check if we need to regenerate the connection when the tab becomes active
                    const currentClientStore = globalObserver.getState('client.store');
                    if (currentClientStore) {
                        const active_login_id = getAccountId();
                        if (active_login_id) {
                            currentClientStore.setWebSocketLoginId(active_login_id);
                        }
                    }
                }

                const hasAccountID = V2GetActiveAccountId();

                if (!this.has_active_symbols && !hasAccountID) {
                    this.active_symbols_promise = this.getActiveSymbols();
                }

                this.initEventListeners();

                if (this.time_interval) clearInterval(this.time_interval);
                this.time_interval = null;

                try {
                    chart_api.init?.();
                } catch {}
            } finally {
                this.init_promise = null;
            }
        })();

        return this.init_promise;
    }

    getConnectionStatus() {
        if (this.api?.connection) {
            const ready_state = this.api.connection.readyState;
            return socket_state[ready_state as keyof typeof socket_state] || 'Unknown';
        }
        return 'Socket not initialized';
    }

    startHeartbeat() {
        this.stopHeartbeat();
        this.time_interval = setInterval(async () => {
            if (this.api?.connection?.readyState === 1) {
                const start = performance.now();
                try {
                    const res = await (this.api as any).send({ ping: 1 });
                    if (res?.ping === 'pong') {
                        const latency = Math.round(performance.now() - start);
                        if (this.common_store) {
                            this.common_store.latency = latency;
                        }
                        try {
                            const { systemCenterStore } = require('@/stores/system-center-store');
                            systemCenterStore?.updateWsLatency?.(latency);
                        } catch {}
                    }
                } catch (e) {
                    console.warn('[APIBase] Heartbeat ping notice:', e);
                }
            }
        }, 15000);
    }

    stopHeartbeat() {
        if (this.time_interval) {
            clearInterval(this.time_interval);
            this.time_interval = null;
        }
    }

    terminate() {
        this.stopHeartbeat();
        if (this.api) this.api.disconnect();
    }

    initEventListeners() {
        if (typeof window !== 'undefined') {
            window.addEventListener('online', () => {
                console.log('[APIBase] Network online event detected, reviving WebSocket immediately');
                this.reconnectIfNotConnected(true);
            });
            window.addEventListener('focus', () => {
                this.checkAndReviveConnection();
            });
            if (typeof document !== 'undefined') {
                document.addEventListener('visibilitychange', () => {
                    if (document.visibilityState === 'visible') {
                        this.checkAndReviveConnection();
                    }
                });
            }
        }
    }

    checkAndReviveConnection = async () => {
        const readyState = this.api?.connection?.readyState;
        // If connection is dead or closing, immediately reconnect
        if (!this.api || readyState === undefined || readyState > 1) {
            console.log('[APIBase] Page resumed and WebSocket is inactive. Forcing immediate reconnect.');
            this.reconnectIfNotConnected(true);
            return;
        }
        // If connection claims to be OPEN, verify responsiveness with a fast ping probe
        if (readyState === 1) {
            try {
                const timeoutPromise = new Promise((_, reject) =>
                    setTimeout(() => reject(new Error('Ping probe timeout')), 8000)
                );
                const pingPromise = (this.api as any).send({ ping: 1 });
                await Promise.race([pingPromise, timeoutPromise]);
            } catch (err) {
                if (this.api?.connection?.readyState !== 1) {
                    console.warn('[APIBase] Probed socket failed after page resume, re-initializing:', err);
                    this.reconnectIfNotConnected(true);
                } else {
                    console.log('[APIBase] Ping probe timed out but socket readyState is OPEN; skipping aggressive reconnect.');
                }
            }
        }
    };

    async createNewInstance(account_id: string) {
        if (this.account_id !== account_id) {
            await this.init();
        }
    }

    reconnectIfNotConnected = (immediate = false) => {
        if (this.reconnect_timeout) {
            clearTimeout(this.reconnect_timeout);
            this.reconnect_timeout = null;
        }

        const readyState = this.api?.connection?.readyState;
        if (!this.api || readyState === undefined || readyState > 1) {
            this.reconnection_attempts += 1;

            if (this.reconnection_attempts >= this.MAX_RECONNECTION_ATTEMPTS) {
                this.reconnection_attempts = 0;
                console.warn('[APIBase] Max reconnection attempts reached, will continue retrying with backoff');
            }

            // On immediate trigger (visibility change/online) or 1st attempt, reconnect quickly (250ms)
            // Progressive backoff capped at 15s instead of 30s
            const delay =
                immediate || this.reconnection_attempts <= 1
                    ? 250
                    : Math.min(1000 * Math.pow(1.4, Math.min(this.reconnection_attempts - 1, 8)), 15000);

            this.reconnect_timeout = setTimeout(() => {
                this.reconnect_timeout = null;
                this.init(true).catch(() => {});
            }, delay);
        }
    };

    async authorizeAndSubscribe() {
        if (!this.api) return;

        this.account_id = getAccountId() || '';
        setIsAuthorizing(true);

        try {
            let authResult: any = null;
            const expectedId = this.account_id || getAccountId();

            // 1. Check if the WebSocket is already authenticated via an OTP in the connection URL for the EXPECTED account
            try {
                const balanceRes = await (this.api as any).send({ balance: 1 });
                if (balanceRes?.balance && (!expectedId || balanceRes.balance.loginid === expectedId)) {
                    authResult = balanceRes;
                    console.log(
                        '[APIBase] WebSocket authorized via OTP connection URL for:',
                        balanceRes.balance.loginid
                    );
                }
            } catch (authCheckErr: any) {
                // If it fails with AuthorizationRequired or on public socket, proceed
            }

            // 2. If not already authenticated, proceed with token authorization if available
            if (!authResult) {
                const token = await resolveValidDerivWSToken(expectedId || '');

                // 2. Only invoke WebSocket authorize with legacy or OTP tokens, never raw OAuth2 JWTs
                if (token && !token.startsWith('ey')) {
                    try {
                        const res = await this.api.authorize(token);
                        if (res?.authorize) {
                            if (!expectedId || res.authorize.loginid === expectedId) {
                                authResult = { balance: res.authorize, account_list: res.authorize.account_list };
                            } else {
                                console.warn(
                                    `[APIBase] Token authorized for ${res.authorize.loginid}, expected ${expectedId}`
                                );
                            }
                        } else if (res?.error) {
                            console.warn('[APIBase] Token authorize returned error:', res.error.message || res.error);
                            if (
                                res.error.code === 'InvalidToken' ||
                                res.error.code === 'InputValidationFailed' ||
                                String(res.error.message).includes('authorize')
                            ) {
                                purgeInvalidToken(token);
                                if (expectedId) purgeInvalidToken(expectedId);
                            }
                        }
                    } catch (tokErr: any) {
                        console.warn('[APIBase] Token authorize failed:', tokErr?.message || tokErr);
                        const code = tokErr?.error?.code || tokErr?.code;
                        const msg = tokErr?.error?.message || tokErr?.message || '';
                        if (
                            code === 'InvalidToken' ||
                            code === 'InputValidationFailed' ||
                            String(msg).includes('authorize')
                        ) {
                            purgeInvalidToken(token);
                            if (expectedId) purgeInvalidToken(expectedId);
                        }
                    }

                }
            }

            // 3. Ensure we have authResult populated (only if matching expected account)
            if (!authResult) {
                try {
                    const res = await (this.api as any).send({ balance: 1 });
                    if (res?.balance && (!expectedId || res.balance.loginid === expectedId)) {
                        authResult = res;
                    }
                } catch {
                    // Unauthenticated
                }
            }

            const balance = authResult?.balance;
            const error = authResult?.error;

            if (error || !balance) {
                const errorMessage = error
                    ? isBackendError(error)
                        ? handleBackendError(error)
                        : error.message || 'Unauthenticated'
                    : 'Unauthenticated session';

                setIsAuthorizing(false);
                this.is_authorized = false;
                if (this.has_active_symbols) {
                    this.toggleRunButton(false);
                } else {
                    this.active_symbols_promise = this.getActiveSymbols();
                }
                return { localizedMessage: errorMessage };
            }

            this.account_info = {
                balance: balance?.balance,
                currency: balance?.currency,
                loginid: balance?.loginid,
            };
            this.token = balance?.loginid;

            const account_type = getAccountType(balance?.loginid);
            const currentAccount = balance?.loginid
                ? {
                      balance: balance.balance,
                      currency: balance.currency || 'USD',
                      is_virtual: account_type === 'real' ? 0 : 1,
                      loginid: balance.loginid,
                  }
                : null;

            // Build full account list from authorize response, localStorage, or DerivWSAccountsService
            const responseAccountList = balance?.account_list || authResult?.account_list;
            const storedAccounts = DerivWSAccountsService.getStoredAccounts();
            let rawStoredClientAccounts: any = null;
            const existingBalances: Record<string, number> = {};

            try {
                const storedRaw = localStorage.getItem('client_account_details');
                if (storedRaw) {
                    rawStoredClientAccounts = JSON.parse(storedRaw);
                    if (Array.isArray(rawStoredClientAccounts)) {
                        rawStoredClientAccounts.forEach((a: any) => {
                            const id = a.loginid || a.account_id;
                            if (id && typeof a.balance === 'number' && a.balance > 0) {
                                existingBalances[id] = a.balance;
                            }
                        });
                    }
                }
            } catch {}

            try {
                const rawClientAccounts =
                    localStorage.getItem('client.accounts') || localStorage.getItem('clientAccounts');
                if (rawClientAccounts) {
                    const parsed = JSON.parse(rawClientAccounts);
                    Object.keys(parsed).forEach(id => {
                        const b = Number(parsed[id]?.balance);
                        if (id && !isNaN(b) && b > 0 && existingBalances[id] === undefined) {
                            existingBalances[id] = b;
                        }
                    });
                }
            } catch {}

            let accountList: any[] = [];
            if (responseAccountList && Array.isArray(responseAccountList) && responseAccountList.length > 0) {
                accountList = responseAccountList.map((a: any) => {
                    let bal = 0;
                    if (typeof a.balance === 'number') {
                        bal = a.balance;
                    } else if (a.loginid === balance?.loginid && typeof balance?.balance === 'number') {
                        bal = balance.balance;
                    } else if (existingBalances[a.loginid] !== undefined) {
                        bal = existingBalances[a.loginid];
                    }
                    return {
                        balance: bal,
                        currency: a.currency || 'USD',
                        is_virtual: a.is_virtual !== undefined ? a.is_virtual : isDemoAccount(a.loginid) ? 1 : 0,
                        loginid: a.loginid,
                    };
                });
            } else if (Array.isArray(rawStoredClientAccounts) && rawStoredClientAccounts.length > 0) {
                accountList = rawStoredClientAccounts.map((a: any) => {
                    let bal = typeof a.balance === 'number' ? a.balance : 0;
                    if (a.loginid === balance?.loginid && typeof balance?.balance === 'number') {
                        bal = balance.balance;
                    } else if (existingBalances[a.loginid] !== undefined) {
                        bal = existingBalances[a.loginid];
                    }
                    return {
                        balance: bal,
                        currency: a.currency || 'USD',
                        is_virtual: a.is_virtual !== undefined ? a.is_virtual : isDemoAccount(a.loginid) ? 1 : 0,
                        loginid: a.loginid,
                    };
                });
            } else if (storedAccounts && storedAccounts.length > 0) {
                accountList = storedAccounts
                    .filter(a => !a.status || a.status === 'active')
                    .map(a => ({
                        balance: parseFloat(a.balance) || existingBalances[a.account_id] || 0,
                        currency: a.currency || 'USD',
                        is_virtual: a.account_type === 'demo' ? 1 : 0,
                        loginid: a.account_id,
                    }));
            } else if (currentAccount) {
                accountList = [currentAccount];
            }

            setAccountList(accountList); // Observable stream
            setAuthData({
                balance: balance?.balance,
                currency: balance?.currency,
                loginid: balance?.loginid,
                is_virtual: account_type === 'real' ? 0 : 1,
                account_list: accountList,
            });

            // // Set account_type in localStorage based on loginid prefix using centralized utility
            const loginid = balance?.loginid || '';
            const isDemo = isDemoAccount(loginid);

            if (isDemo) {
                localStorage.setItem('account_type', 'demo');
            } else {
                localStorage.setItem('account_type', 'real');
            }

            globalObserver.emit('api.authorize', {
                account_list: accountList,
                current_account: {
                    loginid: balance?.loginid,
                    currency: balance?.currency || 'USD',
                    is_virtual: account_type === 'real' ? 0 : 1,
                    balance: typeof balance?.balance === 'number' ? balance.balance : undefined,
                },
            });

            // Update the WebSocket login ID in the client store
            const currentClientStore = globalObserver.getState('client.store');
            if (currentClientStore && balance?.loginid) {
                currentClientStore.setWebSocketLoginId(balance.loginid);
                currentClientStore.setLoginId(balance.loginid);
                currentClientStore.setCurrency(balance.currency || 'USD');
                currentClientStore.setIsLoggedIn(true);
                currentClientStore.setAccountList(accountList);
                if (typeof balance?.balance === 'number') {
                    currentClientStore.setBalance(balance.balance.toString());
                }
            }

            setAuthData({
                loginid: balance?.loginid,
                currency: balance?.currency || 'USD',
                balance: typeof balance?.balance === 'number' ? balance.balance : 0,
                is_virtual: account_type === 'real' ? 0 : 1,
                email: balance?.email || '',
                fullname: balance?.fullname || '',
                landing_company_name: balance?.landing_company_name || 'svg',
                user_id: balance?.user_id || 0,
            } as any);
            setAccountList(accountList);

            setIsAuthorized(true);
            this.is_authorized = true;
            localStorage.setItem('client_account_details', JSON.stringify(accountList));
            localStorage.setItem('client.country', balance?.country);

            if (balance?.loginid) {
                localStorage.setItem('active_loginid', balance.loginid);
            }

            if (this.has_active_symbols) {
                this.toggleRunButton(false);
            } else {
                this.active_symbols_promise = this.getActiveSymbols();
            }
            this.subscribe();
        } catch (e) {
            this.is_authorized = false;

            // Only clear auth data for permanent authentication failures.
            // Transient errors (timeout, network flicker, race conditions) should
            // NOT destroy the user's session — they can recover on reconnect.
            const errorCode = (e as any)?.error?.code || (e as any)?.code || '';
            const permanentAuthErrors = ['InvalidToken', 'ExpiredToken', 'InvalidAppID'];
            if (permanentAuthErrors.includes(errorCode)) {
                clearAuthData();
                globalObserver.emit('InvalidToken', { context: 'bot', error: e });
            } else {
                console.warn(
                    '[APIBase] Authorization failed with transient error, preserving session:',
                    errorCode || e
                );
            }

            setIsAuthorized(false);
            globalObserver.emit('Error', e);
        } finally {
            setIsAuthorizing(false);
        }
    }

    async subscribe() {
        if (!this.is_authorized || !this.api) {
            return;
        }

        // Clean up previous auth stream subscriptions safely
        if (this.current_auth_subscriptions && this.current_auth_subscriptions.length > 0) {
            this.current_auth_subscriptions.forEach(sub => {
                try {
                    if (typeof (sub as any)?.unsubscribe === 'function') {
                        (sub as any).unsubscribe();
                    }
                } catch {}
            });
            this.current_auth_subscriptions = [];
        }

        const subscribeToStream = async (streamName: string) => {
            if (!this.is_authorized || !this.api) return;

            try {
                const subscription = await this.api.send({
                    [streamName]: 1,
                    subscribe: 1,
                });

                if (subscription) {
                    this.current_auth_subscriptions.push(subscription as any);
                }
                return subscription;
            } catch (err: any) {
                const code = err?.error?.code || err?.code;
                if (code !== 'AlreadySubscribed') {
                    console.warn(`[APIBase] Stream '${streamName}' subscription notice:`, err?.error || err);
                }
            }
        };

        const streamsToSubscribe = ['balance', 'transaction'];

        await Promise.all(streamsToSubscribe.map(subscribeToStream));
    }

    getActiveSymbols = async (): Promise<any[]> => {
        // Fast path 1: Return in-memory symbols if already available
        if (
            this.has_active_symbols &&
            this.active_symbols_source === 'live' &&
            Array.isArray(this.active_symbols) &&
            this.active_symbols.length > 0
        ) {
            return this.active_symbols;
        }

        // Fast path 2: Return localStorage cached symbols if available
        try {
            if (typeof window !== 'undefined' && window.localStorage) {
                const cached = localStorage.getItem('cached_active_symbols');
                if (cached) {
                    const parsed = JSON.parse(cached);
                    if (Array.isArray(parsed) && parsed.length > 0) {
                        this.active_symbols = parsed;
                        this.has_active_symbols = true;
                        return this.active_symbols;
                    }
                }
            }
        } catch {}

        // Fast path 3: If a fetch is already in flight, reuse the exact same promise (singleton lock)
        if (this.active_symbols_promise) {
            return this.active_symbols_promise;
        }

        // Start single in-flight request
        this.active_symbols_promise = (async (): Promise<any[]> => {
            let active_symbols: any[] = [];

            try {
                // Wait briefly for main WebSocket if it is connecting
                await this.waitForConnection(3000);

                if (this.api && this.api.connection?.readyState === WebSocket.OPEN) {
                    try {
                        const timeout = new Promise<never>((_, reject) =>
                            setTimeout(() => reject(new Error('Active symbols timeout')), this.ACTIVE_SYMBOLS_TIMEOUT_MS)
                        );
                        const fetchPromise = this.api.send({ active_symbols: 'brief' });
                        const apiResult = await Promise.race([fetchPromise, timeout]);

                        if (apiResult?.active_symbols && Array.isArray(apiResult.active_symbols) && apiResult.active_symbols.length > 0) {
                            active_symbols = apiResult.active_symbols;
                            this.rate_limit_backoff_delay = 3000; // Reset backoff on success
                        } else if (apiResult?.error) {
                            const errCode = apiResult.error.code || apiResult.error.name || '';
                            const errMsg = apiResult.error.message || '';
                            if (errCode === 'RateLimit' || errMsg.toLowerCase().includes('rate limit')) {
                                console.warn(`[APIBase] Deriv active_symbols rate limited. Coordinated backoff: ${this.rate_limit_backoff_delay}ms`);
                                this.scheduleSingleRateLimitRetry();
                            }
                        }
                    } catch (err: any) {
                        const errCode = err?.error?.code || err?.code || '';
                        const errMsg = err?.error?.message || err?.message || '';
                        if (errCode === 'RateLimit' || errMsg.toLowerCase().includes('rate limit')) {
                            console.warn(`[APIBase] Deriv active_symbols rate limited. Coordinated backoff: ${this.rate_limit_backoff_delay}ms`);
                            this.scheduleSingleRateLimitRetry();
                        } else {
                            console.warn('[APIBase] WS active symbols fetch notice:', errMsg || err);
                        }
                    }
                }
            } catch (err) {
                console.warn('[APIBase] getActiveSymbols network attempt failed, using fallback:', err);
            }

            // If primary connection did not return symbols, fetch directly from the options public WebSocket
            if (!active_symbols || active_symbols.length === 0) {
                try {
                    active_symbols = await new Promise((resolve) => {
                        const ws = new WebSocket('wss://api.derivws.com/trading/v1/options/ws/public');
                        const timer = setTimeout(() => {
                            try { ws.close(); } catch {}
                            resolve([]);
                        }, 5000);
                        ws.onopen = () => {
                            ws.send(JSON.stringify({ active_symbols: 'brief' }));
                        };
                        ws.onmessage = (event) => {
                            try {
                                const data = JSON.parse(event.data);
                                if (data?.active_symbols && Array.isArray(data.active_symbols) && data.active_symbols.length > 0) {
                                    clearTimeout(timer);
                                    try { ws.close(); } catch {}
                                    resolve(data.active_symbols);
                                }
                            } catch {}
                        };
                        ws.onerror = () => {
                            clearTimeout(timer);
                            resolve([]);
                        };
                    });
                } catch {}
            }

            // If network did not return symbols, use the comprehensive fallback list
            if (!active_symbols || active_symbols.length === 0) {
                active_symbols = buildFallbackActiveSymbols();
                this.active_symbols_source = 'fallback';
            } else {
                this.active_symbols_source = 'live';
            }

            try {
                this.has_active_symbols = true;

                // Process active symbols using the dedicated service with fallback
                try {
                    const enrichmentTimeout = new Promise<never>((_, reject) =>
                        setTimeout(() => reject(new Error('Enrichment timeout')), this.ENRICHMENT_TIMEOUT_MS)
                    );

                    const enrichmentPromise = activeSymbolsProcessorService.processActiveSymbols(active_symbols);
                    const processedResult = await Promise.race([enrichmentPromise, enrichmentTimeout]);

                    this.active_symbols = processedResult.enrichedSymbols;
                    this.pip_sizes = processedResult.pipSizes;
                } catch (enrichmentError) {
                    this.active_symbols = active_symbols;
                    this.pip_sizes = {};
                }

                // Persist to localStorage for instantaneous loading next time
                try {
                    if (typeof window !== 'undefined' && window.localStorage && this.active_symbols?.length > 0) {
                        localStorage.setItem('cached_active_symbols', JSON.stringify(this.active_symbols));
                        localStorage.setItem('cached_active_symbols_version', this.CACHE_VERSION);
                    }
                } catch {}

                this.toggleRunButton(false);
                return this.active_symbols;
            } catch (error) {
                console.error('[APIBase] Failed to process active symbols:', error);
                this.active_symbols = active_symbols;
                return this.active_symbols;
            } finally {
                this.active_symbols_promise = null;
            }
        })();

        return this.active_symbols_promise;
    };

    private scheduleSingleRateLimitRetry = () => {
        // Do not run several retry timers in parallel; use one retry after the suggested delay
        if (this.rate_limit_retry_timer) return;

        const delay = this.rate_limit_backoff_delay;
        // Increase backoff delay exponentially for subsequent rate limits (max 30s)
        this.rate_limit_backoff_delay = Math.min(this.rate_limit_backoff_delay * 2, 30000);

        this.rate_limit_retry_timer = setTimeout(async () => {
            this.rate_limit_retry_timer = null;
            try {
                if (this.api && this.api.connection?.readyState === WebSocket.OPEN) {
                    const res = await this.api.send({ active_symbols: 'brief' });
                    if (res?.active_symbols && Array.isArray(res.active_symbols) && res.active_symbols.length > 0) {
                        this.rate_limit_backoff_delay = 3000; // Reset backoff on success
                        const enriched = await activeSymbolsProcessorService.processActiveSymbols(res.active_symbols);
                        this.active_symbols = enriched.enrichedSymbols;
                        this.pip_sizes = enriched.pipSizes;
                        this.has_active_symbols = true;
                        try {
                            localStorage.setItem('cached_active_symbols', JSON.stringify(this.active_symbols));
                        } catch {}
                    }
                }
            } catch {
                // Ignore background retry failure
            }
        }, delay);
    };

    toggleRunButton = (toggle: boolean) => {
        const run_button = document.querySelector('#db-animation__run-button');
        if (!run_button) return;
        if (!toggle) {
            (run_button as HTMLButtonElement).disabled = false;
        }
    };

    setIsRunning(toggle = false) {
        this.is_running = toggle;
    }

    pushSubscription(subscription: CurrentSubscription) {
        this.subscriptions.push(subscription);
    }

    clearSubscriptions() {
        this.subscriptions.forEach(s => {
            try {
                if (typeof s?.unsubscribe === 'function') {
                    s.unsubscribe();
                }
            } catch {}
        });
        this.subscriptions = [];

        this.unsubscribeAllSubscriptions();

        // Resetting timeout resolvers
        const global_timeouts = globalObserver.getState('global_timeouts') ?? [];

        global_timeouts.forEach((_: unknown, i: number) => {
            clearTimeout(i);
        });
    }
}

export const api_base = new APIBase();
if (typeof window !== 'undefined') {
    (window as any).api_base = api_base;
}
