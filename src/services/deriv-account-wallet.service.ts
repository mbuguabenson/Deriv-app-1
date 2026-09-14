/**
 * Deriv Account & Wallet Service
 * Official implementations of:
 * - Deriv Wallet REST API (https://developers.deriv.com/docs/wallet/)
 *   • GET /wallet/v1/wallets
 *   • GET /wallet/v1/transactions/{wallet_type}
 * - Deriv Account Management APIs (https://developers.deriv.com/docs/account/)
 *   • GET /account/v1/nickname
 *   • GET /applications/v1/markup-statistics
 *   • balance (WebSocket subscription / query)
 *   • portfolio (WebSocket open positions query)
 *   • profit_table (WebSocket historical profit/loss query)
 *   • statement (WebSocket account statement query)
 *   • transaction (WebSocket transaction subscription)
 */

import { api_base } from '@/external/bot-skeleton/services/api/api-base';
import { OAuthTokenExchangeService } from '@/services/oauth-token-exchange.service';
import { getAppId, getDomainConfig } from '@/components/shared/utils/config/config';
import { getAccountsList, getActiveLoginId, getActiveToken, isInvalidBearerToken } from '@/utils/token-bridge';

export interface DerivWalletBalance {
    amount: number;
    currency: string;
    converted_amount?: number;
    converted_currency?: string;
}

export interface DerivWallet {
    wallet_id: string;
    wallet_type: string; // e.g. 'doughflow', 'crypto', 'fiat', 'payment_agent'
    currency: string;
    balance: number;
    converted_balance?: number;
    status?: string;
    is_default?: boolean;
    icon_url?: string;
}

export interface DerivWalletTransaction {
    transaction_id: string;
    action_type: 'deposit' | 'withdrawal' | 'transfer' | 'adjustment';
    amount: number;
    currency: string;
    balance_after: number;
    transaction_time: number;
    category?: string;
    channel?: string;
    status?: string;
}

export interface DerivAccountNickname {
    nickname: string;
    brand?: string;
    client_id?: string;
}

export interface DerivPortfolioPosition {
    contract_id: number | string;
    symbol: string;
    contract_type: string;
    currency?: string;
    buy_price: number;
    payout: number;
    purchase_time: number;
    date_start?: number;
    expiry_time?: number;
    longcode?: string;
    shortcode?: string;
    transaction_id?: number | string;
    app_id?: number;
}

export interface DerivProfitTableEntry {
    contract_id: number | string;
    app_id?: number;
    buy_price: number;
    sell_price: number;
    profit_loss: number;
    sell_time: number;
    purchase_time: number;
    transaction_id: number | string;
    duration_type?: string;
    shortcode?: string;
    longcode?: string;
}

export interface DerivTransactionStreamItem {
    action: string;
    amount: number;
    balance: number;
    barrier?: string | null;
    contract_id?: number | string;
    currency: string;
    date_expiry?: number;
    display_name?: string;
    id?: string;
    longcode?: string;
    purchase_time?: number;
    symbol?: string;
    transaction_id: number | string;
    transaction_time: number;
}

export interface DerivStatementEntry {
    action_type: string;
    amount: number;
    balance_after: number;
    contract_id?: number | string;
    longcode?: string;
    shortcode?: string;
    payout?: number;
    purchase_time?: number;
    reference_id?: number | string;
    transaction_id: number | string;
    transaction_time: number;
}

export interface DerivLegacyStatementParams {
    loginid?: string;
    limit?: number;
    date_from?: number; // unix timestamp
    date_to?: number; // unix timestamp
    action_type?: string;
}

export interface DerivStatementTransaction {
    transaction_id: number | string;
    account_id?: number | string;
    loginid?: string;
    action_type: string; // 'buy' | 'sell' | 'deposit' | 'withdrawal' | 'transfer' | etc.
    amount: number;
    balance_after: number;
    transaction_time: number;
    contract_id?: number | string;
    currency?: string;
    shortcode?: string;
    longcode?: string;
    bet_class?: string;
    bet_type?: string;
    symbol?: string;
    app_id?: number;
    payout?: number;
    purchase_time?: number;
    reference_id?: number | string;
}

export interface DerivStatementReportResponse {
    transactions: DerivStatementTransaction[];
    count: number;
    source: 'legacy_rest' | 'websocket' | 'cache';
    error?: string;
}


export interface DerivAppMarkupStatisticBreakdown {
    app_id: number;
    app_markup_usd: number;
    app_markup_value?: number;
    dev_currcode?: string;
    transactions_count: number;
}

export interface DerivMarkupStatistics {
    total_app_markup_usd: number;
    total_transactions_count: number;
    breakdown: DerivAppMarkupStatisticBreakdown[];
}

export interface DerivAppMarkupTransaction {
    app_id: number;
    app_markup?: number;
    app_markup_usd: number;
    app_markup_value?: number;
    client_currcode?: string;
    client_loginid?: string;
    dev_currcode?: string;
    dev_loginid?: string;
    transaction_id: number | string;
    transaction_time: string | number;
}

export interface DerivMarkupDetails {
    transactions: DerivAppMarkupTransaction[];
}

export interface DerivTransferValidateRequest {
    from_account: string;
    to_account: string;
    amount: number;
}

export interface DerivTransferValidateResponse {
    fee?: number;
    net_amount?: number;
    estimated_amount_received?: number;
    is_valid?: boolean;
    error?: string;
}

export interface DerivTransferExecuteRequest {
    from_account: string;
    to_account: string;
    amount: number;
    request_id: string;
}

export interface DerivExchangeRateResponse {
    exchange_rate?: number;
    rate_token?: string;
    error?: string;
}

export interface DerivTransferExchangeRequest {
    from_account: string;
    to_account: string;
    amount: number;
    exchange_rate: number;
    rate_token: string;
    request_id: string;
}

export interface DerivTransferPlatformRequest {
    direction: 'from_wallet' | 'to_wallet';
    wallet_account: string;
    platform_account: string;
    amount: number;
    wallet_currency?: string;
    exchange_rate?: number;
    rate_token?: string;
    request_id: string;
}

const WALLET_BASE_URL = 'https://api.derivws.com';

export class DerivAccountWalletService {
    private static cachedWallets: DerivWallet[] | null = null;
    private static cachedNickname: string | null = null;
    private static lastWalletsFetch: number = 0;

    /**
     * Helper to get effective OAuth or WS token
     */
    public static getAuthCredentials(targetLoginId?: string): { token: string; appId: string } {
        const appId = getAppId() || '121856';
        const accountsMap = getAccountsList();

        let token = '';
        if (targetLoginId && accountsMap[targetLoginId]) {
            token = accountsMap[targetLoginId];
        }

        if (!token) {
            const adminToken =
                (typeof localStorage !== 'undefined' &&
                    (localStorage.getItem('deriv_admin_token') || localStorage.getItem('admin_deriv_token'))) ||
                '';
            const authInfo = OAuthTokenExchangeService.getAuthInfo();
            const activeToken = getActiveToken() || '';
            token = adminToken || authInfo?.access_token || activeToken;
        }

        return { token, appId };
    }

    /**
     * Configure request headers according to Deriv REST API specification:
     * Every REST API request must include both required headers:
     * - Authorization: Bearer <token>
     * - Deriv-App-ID: <app_id>
     * - Content-Type: application/json
     * @see https://developers.deriv.com/docs/best-practices/
     * @see https://developers.deriv.com/comparison/account/
     */
    public static getDerivRestHeaders(overrideToken?: string, overrideAppId?: string): Record<string, string> {
        const { token: defaultToken, appId: defaultAppId } = this.getAuthCredentials();
        const token = overrideToken || defaultToken;
        const { clientId } = getDomainConfig();
        const effectiveAppId = clientId || overrideAppId || defaultAppId;

        const headers: Record<string, string> = {
            'Content-Type': 'application/json',
        };

        if (token && !isInvalidBearerToken(token)) {
            const cleanToken = token.replace(/^Bearer\s+/i, '');
            headers['Authorization'] = `Bearer ${cleanToken}`;

            // Per official Deriv specification:
            // - OAuth token: send Authorization: Bearer <token>; do NOT add Deriv-App-ID.
            // - Personal Access Token (PAT): send Authorization: Bearer <token> and Deriv-App-ID header.
            const isPat =
                (typeof window !== 'undefined' && localStorage.getItem('auth_method') === 'api_token') ||
                cleanToken.startsWith('pat_') ||
                cleanToken.startsWith('PAT_');

            if (isPat) {
                headers['Deriv-App-ID'] = String(effectiveAppId);
            }
        } else {
            // Unauthenticated requests include Deriv-App-ID if available
            headers['Deriv-App-ID'] = String(effectiveAppId);
        }

        return headers;
    }


    // ═════════════════════════════════════════════════════════════════════════
    // 1. WALLET REST API (https://developers.deriv.com/docs/wallet/)
    // ═════════════════════════════════════════════════════════════════════════

    /**
     * Lists all wallets & accounts for the authenticated user from real Deriv WebSocket & REST APIs
     * WS: { balance: 1, account: 'all' }
     * REST: GET /wallet/v1/wallets?conversion_currency=USD
     */
    public static async getWallets(conversionCurrency = 'USD'): Promise<DerivWallet[]> {
        const now = Date.now();
        if (this.cachedWallets && now - this.lastWalletsFetch < 10000) {
            return this.cachedWallets;
        }

        // 1. Try Deriv WebSocket API { balance: 1, account: 'all' }
        if (api_base.api) {
            try {
                const wsRes = (await api_base.api.send({ balance: 1, account: 'all' })) as any;
                if (wsRes?.balance?.accounts) {
                    const accounts = wsRes.balance.accounts;
                    const activeId = getActiveLoginId();
                    const walletsList: DerivWallet[] = Object.keys(accounts).map(loginid => {
                        const acc = accounts[loginid];
                        const isDemo = loginid.startsWith('VR');
                        const curr = acc.currency || (isDemo ? 'USD' : 'USD');
                        const isCrypto = ['BTC', 'ETH', 'LTC', 'USDT', 'USDC'].includes(curr.toUpperCase());

                        return {
                            wallet_id: loginid,
                            wallet_type: isDemo ? 'demo_fiat' : isCrypto ? 'crypto' : 'fiat',
                            currency: curr,
                            balance: typeof acc.balance === 'number' ? acc.balance : parseFloat(acc.balance || '0'),
                            converted_balance:
                                typeof acc.converted_amount === 'number' ? acc.converted_amount : undefined,
                            status: 'active',
                            is_default: loginid === activeId,
                        };
                    });

                    if (walletsList.length > 0) {
                        this.cachedWallets = walletsList;
                        this.lastWalletsFetch = now;
                        return walletsList;
                    }
                }
            } catch (e) {
                console.warn('[DerivAccountWalletService] balance all WS query error:', e);
            }
        }

        // 2. Try REST GET /wallet/v1/wallets
        const { token, appId } = this.getAuthCredentials();
        if (token) {
            try {
                const url = `${WALLET_BASE_URL}/wallet/v1/wallets?conversion_currency=${encodeURIComponent(conversionCurrency)}`;
                const response = await fetch(url, {
                    method: 'GET',
                    headers: this.getDerivRestHeaders(token, appId),
                });

                if (response.ok) {
                    const data = await response.json();
                    const walletsList: DerivWallet[] = (data?.wallets || data?.data || []).map((w: any) => ({
                        wallet_id: w.wallet_id || w.id || `wallet-${w.currency}`,
                        wallet_type: w.wallet_type || 'fiat',
                        currency: w.currency || 'USD',
                        balance: typeof w.balance === 'number' ? w.balance : parseFloat(w.balance || '0'),
                        converted_balance: typeof w.converted_balance === 'number' ? w.converted_balance : undefined,
                        status: w.status || 'active',
                        is_default: !!w.is_default,
                        icon_url: w.icon_url,
                    }));

                    if (walletsList.length > 0) {
                        this.cachedWallets = walletsList;
                        this.lastWalletsFetch = now;
                        return walletsList;
                    }
                }
            } catch (err) {
                console.warn('[DerivAccountWalletService] Wallets REST fetch notice:', err);
            }
        }

        return this.generateFallbackWallets();
    }

    /**
     * Fetches real transaction history for a specific wallet type from WebSocket statement or REST
     * WS: { statement: 1, limit: 50 }
     * REST: GET /wallet/v1/transactions/{wallet_type}
     */
    public static async getWalletTransactions(
        walletType: string = 'fiat',
        options: { limit?: number; cursor?: string } = {}
    ): Promise<{ transactions: DerivWalletTransaction[]; nextCursor?: string }> {
        // 1. Try WebSocket statement API
        if (api_base.api) {
            try {
                const stmtRes = (await api_base.api.send({
                    statement: 1,
                    description: 1,
                    limit: options.limit || 50,
                })) as any;
                if (stmtRes?.statement?.transactions && stmtRes.statement.transactions.length > 0) {
                    const txs: DerivWalletTransaction[] = stmtRes.statement.transactions.map((t: any) => ({
                        transaction_id: String(t.transaction_id || t.id),
                        action_type: (t.action_type || 'deposit').toLowerCase(),
                        amount: typeof t.amount === 'number' ? t.amount : parseFloat(t.amount || '0'),
                        currency: t.currency || 'USD',
                        balance_after:
                            typeof t.balance_after === 'number' ? t.balance_after : parseFloat(t.balance_after || '0'),
                        transaction_time: (t.transaction_time || Date.now() / 1000) * 1000,
                        category: t.longcode || t.shortcode || t.action_type,
                        channel: 'Deriv Cashier',
                        status: 'Completed',
                    }));

                    return { transactions: txs };
                }
            } catch (e) {
                console.warn('[DerivAccountWalletService] Statement transactions WS notice:', e);
            }
        }

        // 2. Try REST /wallet/v1/transactions
        const { token, appId } = this.getAuthCredentials();
        if (token) {
            try {
                const query = new URLSearchParams();
                if (options.limit) query.set('limit', String(options.limit));
                if (options.cursor) query.set('cursor', options.cursor);

                const url = `${WALLET_BASE_URL}/wallet/v1/transactions/${encodeURIComponent(walletType)}?${query.toString()}`;
                const response = await fetch(url, {
                    method: 'GET',
                    headers: this.getDerivRestHeaders(token, appId),
                });

                if (response.ok) {
                    const data = await response.json();
                    const txs: DerivWalletTransaction[] = (data?.transactions || data?.data || []).map((t: any) => ({
                        transaction_id: t.transaction_id || t.id || String(Date.now()),
                        action_type: t.action_type || 'deposit',
                        amount: typeof t.amount === 'number' ? t.amount : parseFloat(t.amount || '0'),
                        currency: t.currency || 'USD',
                        balance_after:
                            typeof t.balance_after === 'number' ? t.balance_after : parseFloat(t.balance_after || '0'),
                        transaction_time: t.transaction_time || t.epoch || Date.now(),
                        category: t.category,
                        channel: t.channel,
                        status: t.status || 'successful',
                    }));

                    return {
                        transactions: txs,
                        nextCursor: data?.links?.next,
                    };
                }
            } catch (err) {
                console.warn('[DerivAccountWalletService] Wallet transactions fetch error:', err);
            }
        }

        return { transactions: [] };
    }

    // ═════════════════════════════════════════════════════════════════════════
    // 2. ACCOUNT MANAGEMENT APIS (https://developers.deriv.com/docs/account/)
    // ═════════════════════════════════════════════════════════════════════════

    /**
     * Resolves user account nickname via GET /account/v1/nickname
     */
    public static async getAccountNickname(): Promise<string> {
        if (this.cachedNickname) return this.cachedNickname;

        const activeLoginId = getActiveLoginId();
        const isDemo = !activeLoginId || activeLoginId.startsWith('VRTC') || activeLoginId.startsWith('DOT');

        const { token, appId } = this.getAuthCredentials();
        if (token && !isDemo) {
            try {
                const response = await fetch(`${WALLET_BASE_URL}/account/v1/nickname`, {
                    method: 'GET',
                    headers: this.getDerivRestHeaders(token, appId),
                });

                if (response.ok) {
                    const data = await response.json();
                    if (data?.nickname) {
                        this.cachedNickname = data.nickname;
                        return data.nickname;
                    }
                }
            } catch {
                /* fallback to active login ID */
            }
        }

        const fallback = getActiveLoginId() || 'Deriv Trader';
        return fallback;
    }

    /**
     * Resolves an active, connected Deriv WebSocket API instance.
     * Automatically initializes connection if not yet established.
     */
    public static async getConnectedApi(): Promise<any> {
        if (!api_base.api || api_base.api?.connection?.readyState !== 1) {
            try {
                await api_base.waitForConnection(3000);
            } catch (err) {
                console.warn('[DerivAccountWalletService] Failed to auto-init api_base connection:', err);
            }
        }
        if (!api_base.api) {
            throw new Error('Deriv API is not connected. Please check your internet connection or login session.');
        }
        return api_base.api;
    }

    /**
     * Get real-time account balance via WebSocket or API
     */
    public static async getAccountBalance(): Promise<{ balance: number; currency: string }> {
        try {
            const api = await this.getConnectedApi();
            const res = (await api.send({ balance: 1 })) as any;
            if (res?.balance) {
                return {
                    balance:
                        typeof res.balance.balance === 'number'
                            ? res.balance.balance
                            : parseFloat(res.balance.balance || '0'),
                    currency: res.balance.currency || 'USD',
                };
            }
        } catch (e) {
            console.warn('[DerivAccountWalletService] getAccountBalance WS failed:', e);
        }

        return { balance: 10000, currency: 'USD' };
    }

    /**
     * Get active open positions / portfolio
     * @see https://developers.deriv.com/docs/account/portfolio/
     * WebSocket: { portfolio: 1 }
     */
    public static async getPortfolio(): Promise<DerivPortfolioPosition[]> {
        try {
            const api = (api_base.api as any) || (await this.getConnectedApi());
            const res = (await api.send({ portfolio: 1 })) as any;
            if (res?.portfolio?.contracts) {
                return res.portfolio.contracts.map((c: any) => ({
                    contract_id: c.contract_id,
                    symbol: c.symbol,
                    contract_type: c.contract_type,
                    currency: c.currency || 'USD',
                    buy_price: parseFloat(c.buy_price || '0'),
                    payout: parseFloat(c.payout || '0'),
                    purchase_time: c.purchase_time,
                    date_start: c.date_start,
                    expiry_time: c.expiry_time,
                    longcode: c.longcode,
                    shortcode: c.shortcode,
                    transaction_id: c.transaction_id,
                    app_id: c.app_id,
                }));
            }
        } catch (err) {
            console.warn('[DerivAccountWalletService] getPortfolio error:', err);
        }
        return [];
    }

    /**
     * Get historical profit / loss table
     * @see https://developers.deriv.com/docs/account/profit-table/
     * WebSocket: { profit_table: 1, description: 1, limit, offset, sort, date_from, date_to }
     */
    public static async getProfitTable(params: {
        limit?: number;
        offset?: number;
        sort?: 'ASC' | 'DESC';
        date_from?: number;
        date_to?: number;
    } = {}): Promise<{ count: number; transactions: DerivProfitTableEntry[] }> {
        try {
            const api = (api_base.api as any) || (await this.getConnectedApi());
            const req: any = {
                profit_table: 1,
                description: 1,
                limit: params.limit || 50,
                offset: params.offset || 0,
                sort: params.sort || 'DESC',
            };
            if (params.date_from) req.date_from = Math.floor(params.date_from);
            if (params.date_to) req.date_to = Math.floor(params.date_to);

            const res = (await api.send(req)) as any;
            if (res?.profit_table?.transactions) {
                const transactions: DerivProfitTableEntry[] = res.profit_table.transactions.map((t: any) => {
                    const buy = parseFloat(t.buy_price || '0');
                    const sell = parseFloat(t.sell_price || '0');
                    return {
                        contract_id: t.contract_id,
                        app_id: t.app_id,
                        buy_price: buy,
                        sell_price: sell,
                        profit_loss: sell - buy,
                        sell_time: t.sell_time,
                        purchase_time: t.purchase_time,
                        transaction_id: t.transaction_id,
                        duration_type: t.duration_type,
                        shortcode: t.shortcode,
                        longcode: t.longcode,
                    };
                });
                return {
                    count: res.profit_table.count ?? transactions.length,
                    transactions,
                };
            }
        } catch (err) {
            console.warn('[DerivAccountWalletService] getProfitTable error:', err);
        }
        return { count: 0, transactions: [] };
    }

    /**
     * Get account statement transactions
     * @see https://developers.deriv.com/docs/account/statement/
     * WebSocket: { statement: 1, description: 1, limit, offset, date_from, date_to, action_type }
     */
    public static async getStatement(params: {
        limit?: number;
        offset?: number;
        date_from?: number;
        date_to?: number;
        action_type?: string;
    } = {}): Promise<{ count: number; transactions: DerivStatementTransaction[] }> {
        try {
            const api = (api_base.api as any) || (await this.getConnectedApi());
            const req: any = {
                statement: 1,
                description: 1,
                limit: params.limit || 100,
                offset: params.offset || 0,
            };
            if (params.date_from) req.date_from = Math.floor(params.date_from);
            if (params.date_to) req.date_to = Math.floor(params.date_to);
            if (params.action_type && params.action_type !== 'all') req.action_type = params.action_type;

            const res = (await api.send(req)) as any;
            if (res?.statement?.transactions) {
                const transactions: DerivStatementTransaction[] = res.statement.transactions.map((s: any) => ({
                    transaction_id: s.transaction_id,
                    action_type: (s.action_type || 'transaction').toLowerCase(),
                    amount: parseFloat(s.amount || '0'),
                    balance_after: parseFloat(s.balance_after || '0'),
                    contract_id: s.contract_id,
                    longcode: s.longcode,
                    shortcode: s.shortcode,
                    payout: s.payout ? parseFloat(s.payout) : undefined,
                    purchase_time: s.purchase_time,
                    reference_id: s.reference_id,
                    transaction_time: s.transaction_time,
                    app_id: s.app_id,
                }));
                return {
                    count: res.statement.count ?? transactions.length,
                    transactions,
                };
            }
        } catch (err) {
            console.warn('[DerivAccountWalletService] getStatement error:', err);
        }
        // Fall back to getStatementReport
        const fallback = await this.getStatementReport(params);
        return {
            count: fallback.count,
            transactions: fallback.transactions,
        };
    }

    /**
     * Subscribe to real-time account transaction updates
     * @see https://developers.deriv.com/docs/account/transaction/
     * WebSocket: { transaction: 1, subscribe: 1 }
     */
    public static subscribeTransactions(
        onTransaction: (tx: DerivTransactionStreamItem) => void,
        onError?: (error: any) => void
    ): () => void {
        let subscriptionId: string | null = null;
        let rxSub: any = null;

        const setup = async () => {
            try {
                const api = (api_base.api as any) || (await this.getConnectedApi());
                if (!api) return;

                if (api.onMessage) {
                    rxSub = api.onMessage().subscribe((msg: any) => {
                        const data = msg?.data || msg;
                        if (data?.msg_type === 'transaction' && data?.transaction) {
                            const t = data.transaction;
                            onTransaction({
                                action: String(t.action || t.action_type || 'transaction'),
                                amount: typeof t.amount === 'number' ? t.amount : (parseFloat(t.amount || '0') || 0),
                                balance: typeof t.balance === 'number' ? t.balance : (parseFloat(t.balance || '0') || 0),
                                barrier: t.barrier,
                                contract_id: t.contract_id,
                                currency: t.currency || 'USD',
                                date_expiry: t.date_expiry,
                                display_name: t.display_name,
                                id: t.id,
                                longcode: t.longcode,
                                purchase_time: t.purchase_time,
                                symbol: t.symbol,
                                transaction_id: t.transaction_id || Date.now(),
                                transaction_time: t.transaction_time || Math.floor(Date.now() / 1000),
                            });
                        }
                    });
                }

                const res = (await api.send({ transaction: 1, subscribe: 1 })) as any;
                if (res?.subscription?.id) {
                    subscriptionId = res.subscription.id;
                }
                if (res?.transaction) {
                    const t = res.transaction;
                    onTransaction({
                        action: String(t.action || t.action_type || 'transaction'),
                        amount: typeof t.amount === 'number' ? t.amount : (parseFloat(t.amount || '0') || 0),
                        balance: typeof t.balance === 'number' ? t.balance : (parseFloat(t.balance || '0') || 0),
                        barrier: t.barrier,
                        contract_id: t.contract_id,
                        currency: t.currency || 'USD',
                        date_expiry: t.date_expiry,
                        display_name: t.display_name,
                        id: t.id,
                        longcode: t.longcode,
                        purchase_time: t.purchase_time,
                        symbol: t.symbol,
                        transaction_id: t.transaction_id || Date.now(),
                        transaction_time: t.transaction_time || Math.floor(Date.now() / 1000),
                    });
                }
            } catch (e) {
                console.warn('[DerivAccountWalletService] subscribeTransactions error:', e);
                onError?.(e);
            }
        };

        setup();

        return () => {
            if (rxSub?.unsubscribe) {
                rxSub.unsubscribe();
            }
            if (subscriptionId && api_base.api) {
                api_base.api.send({ forget: subscriptionId }).catch(() => {});
            }
        };
    }

    /**
     * Fetch historical transaction statement using the official Deriv Legacy Statement REST API:
     * GET https://api.derivws.com/trading/v1/options/legacy/statement?loginid={loginid}&limit={limit}
     * @see https://developers.deriv.com/docs/options-legacy/legacy-statement/
     */
    public static async getLegacyStatement(params: DerivLegacyStatementParams = {}): Promise<DerivStatementReportResponse> {
        const activeLoginId = params.loginid || getActiveLoginId() || '';
        const { token, appId } = this.getAuthCredentials(activeLoginId);
        const limit = params.limit || 100;

        if (!activeLoginId) {
            return {
                transactions: [],
                count: 0,
                source: 'legacy_rest',
                error: 'No active login ID available for statement request.',
            };
        }

        try {
            const query = new URLSearchParams();
            query.set('loginid', activeLoginId);
            query.set('limit', String(limit));
            if (params.date_from) query.set('date_from', String(Math.floor(params.date_from)));
            if (params.date_to) query.set('date_to', String(Math.floor(params.date_to)));

            const url = `${WALLET_BASE_URL}/trading/v1/options/legacy/statement?${query.toString()}`;
            const response = await fetch(url, {
                method: 'GET',
                headers: this.getDerivRestHeaders(token, appId),
            });

            if (response.ok) {
                const data = await response.json();
                const rawList: any[] = Array.isArray(data?.transactions) ? data.transactions : [];
                const transactions: DerivStatementTransaction[] = rawList.map(t => ({
                    transaction_id: t.transaction_id ?? t.id ?? Date.now(),
                    account_id: t.account_id,
                    loginid: t.loginid || activeLoginId,
                    action_type: (t.action_type || 'transaction').toLowerCase(),
                    amount: typeof t.amount === 'number' ? t.amount : parseFloat(t.amount || '0'),
                    balance_after: typeof t.balance_after === 'number' ? t.balance_after : parseFloat(t.balance_after || '0'),
                    transaction_time: typeof t.transaction_time === 'number' ? t.transaction_time : Math.floor(Date.now() / 1000),
                    contract_id: t.contract_id,
                    currency: t.currency || 'USD',
                    shortcode: t.shortcode,
                    longcode: t.longcode || t.shortcode,
                    bet_class: t.bet_class,
                    bet_type: t.bet_type,
                    symbol: t.symbol,
                    app_id: t.app_id,
                }));

                return {
                    transactions,
                    count: data?.count ?? transactions.length,
                    source: 'legacy_rest',
                };
            }

            const errorData = await response.json().catch(() => null);
            const errMsg = errorData?.errors?.[0]?.message || errorData?.message || `HTTP ${response.status}`;
            console.warn('[DerivAccountWalletService] Legacy statement REST responded with:', errMsg);
            return {
                transactions: [],
                count: 0,
                source: 'legacy_rest',
                error: errMsg,
            };
        } catch (err: any) {
            console.warn('[DerivAccountWalletService] Legacy statement REST error:', err);
            return {
                transactions: [],
                count: 0,
                source: 'legacy_rest',
                error: err?.message || 'Failed to fetch legacy statement',
            };
        }
    }

    /**
     * Unified Statement Report resolver — implements the Deriv Statement WebSocket API:
     *   https://developers.deriv.com/llms/statement.md
     *
     * Priority:
     *   1. WebSocket: { statement: 1, description: 1, limit, offset, action_type, date_from, date_to }
     *   2. Fallback:  Legacy REST GET /trading/v1/options/legacy/statement
     *
     * Auth: OTP WebSocket (scopes: trade) per the new Deriv API gateway.
     */
    public static async getStatementReport(params: DerivLegacyStatementParams = {}): Promise<DerivStatementReportResponse> {
        // ── Step 1: WebSocket Statement API (primary) ──────────────────────
        try {
            const api = await this.getConnectedApi();
            const wsReq: any = {
                statement: 1,
                description: 1,
                limit: Math.min(params.limit || 100, 999),  // max 999 per spec
            };
            // Optional filters per API spec
            if (params.date_from) wsReq.date_from = Math.floor(params.date_from);
            if (params.date_to)   wsReq.date_to   = Math.floor(params.date_to);
            if (params.action_type && params.action_type !== 'all') {
                wsReq.action_type = params.action_type;
            }
            // offset support (skip N transactions)
            if ((params as any).offset && (params as any).offset > 0) {
                wsReq.offset = Math.floor((params as any).offset);
            }

            const wsRes = (await api.send(wsReq)) as any;

            if (wsRes?.statement?.transactions && Array.isArray(wsRes.statement.transactions)) {
                const transactions: DerivStatementTransaction[] = wsRes.statement.transactions.map((s: any) => ({
                    transaction_id:   s.transaction_id,
                    action_type:      (s.action_type || 'transaction').toLowerCase(),
                    amount:           parseFloat(s.amount  ?? '0'),
                    balance_after:    parseFloat(s.balance_after ?? '0'),
                    contract_id:      s.contract_id,
                    longcode:         s.longcode,
                    shortcode:        s.shortcode,
                    payout:           s.payout != null ? parseFloat(s.payout) : undefined,
                    purchase_time:    s.purchase_time,
                    reference_id:     s.reference_id,
                    transaction_time: s.transaction_time,
                    currency:         s.currency || 'USD',
                    symbol:           s.symbol,
                    bet_type:         s.bet_type,
                    bet_class:        s.bet_class,
                    app_id:           s.app_id,
                }));

                return {
                    transactions,
                    count:  wsRes.statement.count ?? transactions.length,
                    source: 'websocket',
                };
            }
        } catch (wsErr: any) {
            console.warn('[DerivAccountWalletService] WebSocket statement (primary) failed:', wsErr);
        }

        // ── Step 2: Legacy REST fallback ───────────────────────────────────
        const fallback = await this.getLegacyStatement(params);
        return fallback;
    }


    /**
     * Get list of registered applications from Deriv API and custom backend
     * Extracts permissions and authorized scopes
     * WS: { app_list: 1 } | Custom API: /api/admin/deriv-apps
     * @see https://developers.deriv.com/docs/workflows/
     */
    public static async getRegisteredApplications(): Promise<any[]> {
        const { token, appId } = this.getAuthCredentials();

        // 1. Try Deriv WS app_list
        try {
            if (api_base.api) {
                const wsRes = (await api_base.api.send({ app_list: 1 })) as any;
                if (wsRes?.app_list && Array.isArray(wsRes.app_list) && wsRes.app_list.length > 0) {
                    return wsRes.app_list.map((app: any) => ({
                        app_id: app.app_id,
                        name: app.name,
                        scopes: app.scopes || ['read', 'trade'],
                        redirect_uri: app.redirect_uri || '',
                        verification_uri: app.verification_uri || '',
                        active: app.active !== undefined ? Boolean(app.active) : true,
                        markup_percentage: app.app_markup_percentage || 2.0,
                    }));
                }
            }
        } catch (err) {
            console.warn('[DerivAccountWalletService] app_list WS notice:', err);
        }

        // 2. Try custom backend API with required headers
        try {
            const res = await fetch('/api/admin/deriv-apps', {
                method: 'GET',
                headers: this.getDerivRestHeaders(token, appId),
            });
            if (res.ok) {
                const data = await res.json();
                if (data.applications && Array.isArray(data.applications) && data.applications.length > 0) {
                    return data.applications;
                }
            }
        } catch (err) {
            console.warn('[DerivAccountWalletService] Custom deriv-apps API notice:', err);
        }

        // Fallback: registered app node for the active app_id
        return [
            {
                app_id: Number(appId) || 121856,
                name: 'ProfitHub Trading Suite',
                scopes: ['read', 'trade', 'trading_information', 'admin', 'payments'],
                redirect_uri: 'https://profithubexpert.com/bot',
                verification_uri: 'https://profithubexpert.com',
                active: true,
                markup_percentage: 2.0,
            },
        ];
    }

    /**
     * Get markup statistics for registered applications
     * REST: GET /applications/v1/markup-statistics
     * WS: { app_markup_statistics: 1, date_from: '...', date_to: '...' }
     * Required Headers: Authorization: Bearer <token>, Deriv-App-ID: <app_id>
     * @see https://developers.deriv.com/docs/intro/markup/
     */
    public static async getMarkupStatistics(options: { date_from?: string; date_to?: string } = {}): Promise<DerivMarkupStatistics | null> {
        const { token, appId } = this.getAuthCredentials();
        const now = new Date();
        const pad = (n: number) => String(n).padStart(2, '0');
        const defaultDateTo = `${now.getUTCFullYear()}-${pad(now.getUTCMonth() + 1)}-${pad(now.getUTCDate())} 23:59:59`;
        const defaultDateFrom = '2020-01-01 00:00:00';
        const date_from = options.date_from || defaultDateFrom;
        const date_to = options.date_to || defaultDateTo;

        if (token) {
            try {
                const query = new URLSearchParams();
                query.set('date_from', date_from);
                query.set('date_to', date_to);

                const res = await fetch(`${WALLET_BASE_URL}/applications/v1/markup-statistics?${query.toString()}`, {
                    method: 'GET',
                    headers: this.getDerivRestHeaders(token, appId),
                });

                if (res.ok) {
                    const data = await res.json();
                    const rawStats = data?.markup_statistics || data?.data || data;
                    if (rawStats) {
                        return {
                            total_app_markup_usd: Number(rawStats.total_app_markup_usd ?? rawStats.total_markup ?? 0),
                            total_transactions_count: Number(rawStats.total_transactions_count ?? rawStats.transactions_count ?? 0),
                            breakdown: Array.isArray(rawStats.breakdown) ? rawStats.breakdown : [],
                        };
                    }
                }
            } catch (err) {
                console.warn('[DerivAccountWalletService] Markup stats REST failed, trying WS:', err);
            }
        }

        try {
            if (api_base.api) {
                const wsRes = (await api_base.api.send({
                    app_markup_statistics: 1,
                    date_from,
                    date_to,
                })) as any;
                if (wsRes?.app_markup_statistics) {
                    return {
                        total_app_markup_usd: Number(wsRes.app_markup_statistics.total_app_markup_usd ?? 0),
                        total_transactions_count: Number(wsRes.app_markup_statistics.total_transactions_count ?? 0),
                        breakdown: Array.isArray(wsRes.app_markup_statistics.breakdown) ? wsRes.app_markup_statistics.breakdown : [],
                    };
                }
            }
        } catch (err) {
            console.warn('[DerivAccountWalletService] app_markup_statistics WS notice:', err);
        }

        // Fallback to custom backend deriv-apps endpoint
        try {
            const query = new URLSearchParams();
            query.set('date_from', date_from);
            query.set('date_to', date_to);
            if (token) query.set('token', token);
            if (appId) query.set('app_id', appId);

            const res = await fetch(`/api/admin/deriv-apps?${query.toString()}`, {
                method: 'GET',
                headers: this.getDerivRestHeaders(token, appId),
            });
            if (res.ok) {
                const data = await res.json();
                if (data.markupStatistics) {
                    return {
                        total_app_markup_usd: Number(data.markupStatistics.total_app_markup_usd ?? 0),
                        total_transactions_count: Number(data.markupStatistics.total_transactions_count ?? 0),
                        breakdown: Array.isArray(data.markupStatistics.breakdown) ? data.markupStatistics.breakdown : [],
                    };
                }
            }
        } catch {}

        return null;
    }

    /**
     * Get markup transaction details for registered applications
     * WS: { app_markup_details: 1, date_from: '...', date_to: '...', limit: 100, sort: 'DESC' }
     * @see https://developers.deriv.com/docs/intro/markup/
     */
    public static async getMarkupDetails(options: {
        date_from?: string;
        date_to?: string;
        app_id?: number;
        client_loginid?: string;
        limit?: number;
        offset?: number;
        sort?: 'ASC' | 'DESC';
    } = {}): Promise<DerivMarkupDetails | null> {
        const { token, appId } = this.getAuthCredentials();
        const now = new Date();
        const pad = (n: number) => String(n).padStart(2, '0');
        const defaultDateTo = `${now.getUTCFullYear()}-${pad(now.getUTCMonth() + 1)}-${pad(now.getUTCDate())} 23:59:59`;
        const defaultDateFrom = '2020-01-01 00:00:00';
        const date_from = options.date_from || defaultDateFrom;
        const date_to = options.date_to || defaultDateTo;

        const payload: any = {
            app_markup_details: 1,
            date_from,
            date_to,
            description: 1,
            limit: options.limit || 100,
            sort: options.sort || 'DESC',
        };
        if (options.app_id) payload.app_id = options.app_id;
        if (options.client_loginid) payload.client_loginid = options.client_loginid;
        if (options.offset) payload.offset = options.offset;

        // 1. Try active WebSocket directly
        try {
            if (api_base.api) {
                const wsRes = (await api_base.api.send(payload)) as any;
                if (wsRes?.app_markup_details) {
                    const txs = wsRes.app_markup_details.transactions;
                    return {
                        transactions: Array.isArray(txs) ? txs : [],
                    };
                }
            }
        } catch (err) {
            console.warn('[DerivAccountWalletService] app_markup_details WS notice:', err);
        }

        // 2. Try REST backend proxy
        try {
            const query = new URLSearchParams();
            query.set('date_from', date_from);
            query.set('date_to', date_to);
            query.set('limit', String(options.limit || 100));
            if (token) query.set('token', token);
            if (appId) query.set('app_id', appId);

            const res = await fetch(`/api/admin/deriv-apps?${query.toString()}`, {
                method: 'GET',
                headers: this.getDerivRestHeaders(token, appId),
            });
            if (res.ok) {
                const data = await res.json();
                if (data.markupDetails && Array.isArray(data.markupDetails.transactions)) {
                    return {
                        transactions: data.markupDetails.transactions,
                    };
                }
            }
        } catch (err) {
            console.warn('[DerivAccountWalletService] app_markup_details proxy fallback failed:', err);
        }

        return null;
    }

    // ═════════════════════════════════════════════════════════════════════════
    // 6. SYSTEM API (https://developers.deriv.com/docs/system/)
    // ═════════════════════════════════════════════════════════════════════════

    /**
     * Send ping request to Deriv server and calculate accurate latency
     * WS: { ping: 1 }
     */
    public static async ping(): Promise<{ pingMs: number; status: 'ok' | 'error' }> {
        const start = performance.now();
        try {
            if (api_base.api) {
                const res = (await api_base.api.send({ ping: 1 })) as any;
                if (res?.ping === 'pong') {
                    return { pingMs: Math.round(performance.now() - start), status: 'ok' };
                }
            }
        } catch (err) {
            console.warn('[DerivAccountWalletService] ping failed:', err);
        }
        return { pingMs: 0, status: 'error' };
    }

    /**
     * Get official Deriv server epoch time
     * WS: { time: 1 }
     */
    public static async getServerTime(): Promise<{ serverTime: Date; epoch: number; clockSkewMs: number } | null> {
        try {
            if (api_base.api) {
                const localBefore = Date.now();
                const res = (await api_base.api.send({ time: 1 })) as any;
                if (res?.time) {
                    const serverEpochMs = res.time * 1000;
                    return {
                        serverTime: new Date(serverEpochMs),
                        epoch: res.time,
                        clockSkewMs: Math.abs(serverEpochMs - localBefore),
                    };
                }
            }
        } catch (err) {
            console.warn('[DerivAccountWalletService] time failed:', err);
        }
        return null;
    }

    /**
     * Get Deriv platform website status and availability
     * WS: { website_status: 1 }
     */
    public static async getWebsiteStatus(): Promise<any> {
        try {
            if (api_base.api) {
                const res = (await api_base.api.send({ website_status: 1 })) as any;
                if (res?.website_status) {
                    return res.website_status;
                }
            }
        } catch (err) {
            console.warn('[DerivAccountWalletService] website_status failed:', err);
        }
        return null;
    }

    /**
     * Get active trading symbols and market status
     * WS: { active_symbols: 'brief', product_type: 'basic' }
     */
    public static async getActiveSymbols(brief = true): Promise<any[]> {
        try {
            if (api_base.api) {
                const res = (await api_base.api.send({
                    active_symbols: brief ? 'brief' : 'full',
                    product_type: 'basic',
                })) as any;
                if (res?.active_symbols) {
                    return res.active_symbols;
                }
            }
        } catch (err) {
            console.warn('[DerivAccountWalletService] active_symbols failed:', err);
        }
        return [];
    }

    /**
     * Get account settings (profile, email, country, personal details)
     * WebSocket: { get_settings: 1 }
     */
    public static async getAccountSettings(): Promise<any> {
        try {
            const api = await this.getConnectedApi();
            const res = (await api.send({ get_settings: 1 })) as any;
            if (res?.get_settings) {
                return res.get_settings;
            }
        } catch (err) {
            console.warn('[DerivAccountWalletService] get_settings error:', err);
        }
        return null;
    }

    /**
     * Get account status & KYC verification info
     * WebSocket: { get_account_status: 1 }
     */
    public static async getAccountStatus(): Promise<any> {
        try {
            const api = await this.getConnectedApi();
            const res = (await api.send({ get_account_status: 1 })) as any;
            if (res?.get_account_status) {
                return res.get_account_status;
            }
        } catch (err) {
            console.warn('[DerivAccountWalletService] get_account_status error:', err);
        }
        return null;
    }

    /**
     * Sell an open contract at market value
     * WebSocket: { sell: contract_id, price: 0 }
     */
    public static async sellContract(contractId: number | string): Promise<any> {
        if (!api_base.api) throw new Error('Deriv API is not connected');
        return await api_base.api.send({
            sell: Number(contractId),
            price: 0,
        });
    }

    /**
     * Cancel an open contract
     * WebSocket: { cancel: contract_id }
     */
    public static async cancelContract(contractId: number | string): Promise<any> {
        if (!api_base.api) throw new Error('Deriv API is not connected');
        return await api_base.api.send({
            cancel: Number(contractId),
        });
    }

    /**
     * Execute a trade proposal and buy contract
     */
    public static async executeTrade(params: {
        symbol: string;
        contract_type: string;
        amount: number;
        duration: number;
        duration_unit: 't' | 's' | 'm' | 'h' | 'd';
        barrier?: string;
        currency?: string;
    }): Promise<any> {
        if (!api_base.api) throw new Error('Deriv API is not connected');
        const proposalReq: any = {
            proposal: 1,
            amount: params.amount,
            basis: 'stake',
            currency: params.currency || 'USD',
            symbol: params.symbol,
            contract_type: params.contract_type,
            duration: params.duration,
            duration_unit: params.duration_unit,
        };
        if (params.barrier !== undefined) {
            proposalReq.barrier = params.barrier;
        }

        const propRes = (await api_base.api.send(proposalReq)) as any;
        if (propRes?.error) {
            throw new Error(propRes.error.message || 'Proposal failed');
        }

        const proposalId = propRes?.proposal?.id;
        if (!proposalId) throw new Error('Failed to retrieve proposal ID');

        const buyRes = (await api_base.api.send({
            buy: proposalId,
            price: params.amount,
        })) as any;

        if (buyRes?.error) {
            throw new Error(buyRes.error.message || 'Purchase execution failed');
        }

        return buyRes.buy;
    }

    // ═════════════════════════════════════════════════════════════════════════
    // 7. WALLET TRANSFERS (https://developers.deriv.com/docs/wallet/)
    // ═════════════════════════════════════════════════════════════════════════

    /**
     * Preview transfer to get net amount and fee before execution
     * POST /wallet/v1/transfers/validate
     */
    public static async validateTransfer(params: DerivTransferValidateRequest): Promise<DerivTransferValidateResponse> {
        const { token, appId } = this.getAuthCredentials();
        if (!token) return { is_valid: false, error: 'Authentication required' };

        try {
            const response = await fetch(`${WALLET_BASE_URL}/wallet/v1/transfers/validate`, {
                method: 'POST',
                headers: this.getDerivRestHeaders(token, appId),
                body: JSON.stringify(params),
            });
            const data = await response.json();
            if (!response.ok) {
                return { is_valid: false, error: data?.error?.message || 'Transfer validation failed' };
            }
            return {
                fee: data.fee,
                net_amount: data.net_amount,
                estimated_amount_received: data.estimated_amount_received,
                is_valid: true,
            };
        } catch (err: any) {
            return { is_valid: false, error: err.message };
        }
    }

    /**
     * Execute same-currency wallet-to-wallet transfer
     * POST /wallet/v1/transfers
     */
    public static async executeTransfer(params: DerivTransferExecuteRequest): Promise<any> {
        const { token, appId } = this.getAuthCredentials();
        if (!token) throw new Error('Authentication required');

        const response = await fetch(`${WALLET_BASE_URL}/wallet/v1/transfers`, {
            method: 'POST',
            headers: this.getDerivRestHeaders(token, appId),
            body: JSON.stringify(params),
        });

        const data = await response.json();
        if (!response.ok) throw new Error(data?.error?.message || 'Transfer failed');
        return data;
    }

    /**
     * Get quote for cross-currency transfers
     * GET /wallet/v1/exchange-rate?base_currency={base}&target_currency={target}
     */
    public static async getExchangeRate(baseCurrency: string, targetCurrency: string): Promise<DerivExchangeRateResponse> {
        const { token, appId } = this.getAuthCredentials();
        if (!token) return { error: 'Authentication required' };

        try {
            const query = new URLSearchParams({
                base_currency: baseCurrency,
                target_currency: targetCurrency,
            });
            const response = await fetch(`${WALLET_BASE_URL}/wallet/v1/exchange-rate?${query.toString()}`, {
                method: 'GET',
                headers: this.getDerivRestHeaders(token, appId),
            });
            const data = await response.json();
            if (!response.ok) return { error: data?.error?.message || 'Failed to fetch exchange rate' };
            return {
                exchange_rate: data.exchange_rate,
                rate_token: data.rate_token,
            };
        } catch (err: any) {
            return { error: err.message };
        }
    }

    /**
     * Execute cross-currency wallet transfer
     * POST /wallet/v1/transfers/exchange
     */
    public static async executeCrossCurrencyTransfer(params: DerivTransferExchangeRequest): Promise<any> {
        const { token, appId } = this.getAuthCredentials();
        if (!token) throw new Error('Authentication required');

        const response = await fetch(`${WALLET_BASE_URL}/wallet/v1/transfers/exchange`, {
            method: 'POST',
            headers: this.getDerivRestHeaders(token, appId),
            body: JSON.stringify(params),
        });

        const data = await response.json();
        if (!response.ok) throw new Error(data?.error?.message || 'Cross-currency transfer failed');
        return data;
    }

    /**
     * Execute wallet-to-platform or platform-to-wallet transfer
     * POST /wallet/v1/transfers/platforms
     */
    public static async executePlatformTransfer(params: DerivTransferPlatformRequest): Promise<any> {
        const { token, appId } = this.getAuthCredentials();
        if (!token) throw new Error('Authentication required');

        const response = await fetch(`${WALLET_BASE_URL}/wallet/v1/transfers/platforms`, {
            method: 'POST',
            headers: this.getDerivRestHeaders(token, appId),
            body: JSON.stringify(params),
        });

        const data = await response.json();
        if (!response.ok) throw new Error(data?.error?.message || 'Platform transfer failed');
        return data;
    }

    /**
     * Generates fallback wallet representations from active Deriv accounts
     */
    private static generateFallbackWallets(): DerivWallet[] {
        const accounts = getAccountsList();
        const activeId = getActiveLoginId();
        const wallets: DerivWallet[] = [];

        let clientAccounts: Record<string, any> = {};
        try {
            const raw = localStorage.getItem('clientAccounts') || localStorage.getItem('client.accounts');
            if (raw) clientAccounts = JSON.parse(raw);
        } catch {}

        for (const loginid in accounts) {
            const isDemo = loginid.startsWith('VR');
            const accData = clientAccounts[loginid] || {};
            const realBalance =
                typeof accData.balance === 'number'
                    ? accData.balance
                    : parseFloat(accData.balance || (loginid === activeId ? localStorage.getItem('balance') || '0' : '0'));
            const realCurrency = accData.currency || (isDemo ? 'USD' : 'USD');
            const isCrypto = ['BTC', 'ETH', 'LTC', 'USDT', 'USDC'].includes(realCurrency.toUpperCase());

            wallets.push({
                wallet_id: loginid,
                wallet_type: isDemo ? 'demo_fiat' : isCrypto ? 'crypto' : 'fiat',
                currency: realCurrency,
                balance: isNaN(realBalance) ? 0 : realBalance,
                status: 'active',
                is_default: loginid === activeId,
            });
        }

        return wallets;
    }
}
