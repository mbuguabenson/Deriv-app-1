/**
 * legacy-statement.service.ts
 *
 * Official Deriv Options Trading (Legacy) Statement REST API Service:
 * GET https://api.derivws.com/trading/v1/options/legacy/statement
 *
 * Specification:
 * https://developers.deriv.com/docs/options-legacy/legacy-statement/
 * https://developers.deriv.com/docs/options-legacy/
 */

import { getAppId } from '@/components/shared/utils/config/config';
import {
    getAccountsList,
    getActiveLoginId,
    getActiveToken,
    getBotNewAPIToken,
    isInvalidBearerToken,
    isPersonalAccessToken,
} from '@/utils/token-bridge';
import { OAuthTokenExchangeService } from '@/services/oauth-token-exchange.service';

export interface LegacyStatementParams {
    loginid: string; // Must match ^[A-Z]+[0-9]+$ (e.g. "CR8416851")
    date_from?: number; // Inclusive lower bound epoch seconds (0 = all history)
    date_to?: number; // Exclusive upper bound epoch seconds (<= 2147483647)
    action_type?: string; // Filter: buy, sell, deposit, withdrawal, all
    limit?: number; // Default: 100, Min: 1, Max: 999
    offset?: number; // Default: 0
}

export interface LegacyStatementTransaction {
    transaction_id: number | string;
    account_id?: number | string;
    loginid?: string;
    action_type: string; // 'buy' | 'sell' | 'deposit' | 'withdrawal' | 'transfer'
    amount: number;
    balance_after: number;
    transaction_time: number; // Unix epoch seconds
    contract_id?: number | string;
    currency: string;
    reference_id?: number | string;
    shortcode?: string;
    longcode?: string;
    bet_class?: string;
    bet_type?: string;
    symbol?: string;
    app_id?: number;
}

export interface LegacyStatementResponse {
    transactions: LegacyStatementTransaction[];
    count: number;
    source: 'live_rest' | 'sample_preview';
    error?: string;
    errorCode?: string;
    timing?: number;
}

const LEGACY_STATEMENT_ENDPOINT = 'https://api.derivws.com/trading/v1/options/legacy/statement';
const MAX_EPOCH_2038 = 2147483647;

export class LegacyStatementService {
    /**
     * Resolves authentication headers according to Deriv Legacy REST specifications:
     * - Authorization: Bearer <token>
     * - Deriv-App-ID: <app_id> (required for Personal Access Tokens)
     */
    private static getHeaders(overrideToken?: string): Record<string, string> {
        let token = overrideToken;

        if (!token) {
            token =
                getBotNewAPIToken() ||
                getActiveToken() ||
                OAuthTokenExchangeService.getAuthInfo({ allowExpiredWithRefresh: true })?.access_token ||
                localStorage.getItem('token') ||
                '';
        }

        const headers: Record<string, string> = {
            Accept: 'application/json',
            'Content-Type': 'application/json',
        };

        if (token && !isInvalidBearerToken(token)) {
            const cleanToken = token.replace(/^Bearer\s+/i, '').trim();
            headers['Authorization'] = `Bearer ${cleanToken}`;

            const isPat = isPersonalAccessToken(cleanToken) || cleanToken.startsWith('pat_') || cleanToken.startsWith('PAT_');
            if (isPat) {
                const appId = getAppId() || localStorage.getItem('config.app_id') || '121856';
                headers['Deriv-App-ID'] = String(appId);
            }
        }

        return headers;
    }

    /**
     * Fetches historical legacy statement transactions from the temporary Deriv endpoint:
     * GET /trading/v1/options/legacy/statement
     */
    public static async getLegacyStatement(params: LegacyStatementParams): Promise<LegacyStatementResponse> {
        const rawLoginId = (params.loginid || getActiveLoginId() || 'CR8416851').trim().toUpperCase();

        // Validate loginid regex: ^[A-Z]+[0-9]+$
        if (!/^[A-Z]+[0-9]+$/.test(rawLoginId)) {
            return {
                transactions: [],
                count: 0,
                source: 'live_rest',
                error: 'Invalid loginid. Must match ^[A-Z]+[0-9]+$ (e.g. CR8416851)',
                errorCode: 'ValidationError',
            };
        }

        // Build URL query parameters
        const urlParams = new URLSearchParams();
        urlParams.set('loginid', rawLoginId);

        const limit = Math.min(Math.max(params.limit ?? 100, 1), 999);
        urlParams.set('limit', String(limit));

        if (params.offset && params.offset > 0) {
            urlParams.set('offset', String(params.offset));
        }

        if (params.date_from !== undefined && params.date_from >= 0) {
            const clampedFrom = Math.min(Math.floor(params.date_from), MAX_EPOCH_2038);
            urlParams.set('date_from', String(clampedFrom));
        }

        if (params.date_to !== undefined && params.date_to > 0) {
            const clampedTo = Math.min(Math.floor(params.date_to), MAX_EPOCH_2038);
            urlParams.set('date_to', String(clampedTo));
        }

        if (params.action_type && params.action_type !== 'all') {
            urlParams.set('action_type', params.action_type.toLowerCase());
        }

        const url = `${LEGACY_STATEMENT_ENDPOINT}?${urlParams.toString()}`;

        // Find token associated with this loginid if available
        const accountsMap = getAccountsList();
        const accountToken = accountsMap[rawLoginId];
        const headers = this.getHeaders(accountToken);

        try {
            const res = await fetch(url, {
                method: 'GET',
                headers,
            });

            // 200 OK
            if (res.ok) {
                const data = await res.json();
                const rawList: any[] =
                    (Array.isArray(data?.transactions) && data.transactions) ||
                    (Array.isArray(data?.statement?.transactions) && data.statement.transactions) ||
                    [];

                const transactions: LegacyStatementTransaction[] = rawList.map(t => ({
                    transaction_id: t.transaction_id ?? t.id ?? Date.now(),
                    account_id: t.account_id,
                    loginid: t.loginid || rawLoginId,
                    action_type: String(t.action_type || 'transaction').toLowerCase(),
                    amount: typeof t.amount === 'number' ? t.amount : parseFloat(t.amount || '0'),
                    balance_after: typeof t.balance_after === 'number' ? t.balance_after : parseFloat(t.balance_after || '0'),
                    transaction_time: typeof t.transaction_time === 'number' ? t.transaction_time : Math.floor(Date.now() / 1000),
                    contract_id: t.contract_id,
                    currency: t.currency || 'USD',
                    reference_id: t.reference_id,
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
                    source: 'live_rest',
                    timing: data?.meta?.timing,
                };
            }

            // Error response
            const errorJson = await res.json().catch(() => null);
            const apiError = errorJson?.errors?.[0];
            const errorCode = apiError?.code || `HTTP_${res.status}`;
            const errorMessage = apiError?.message || errorJson?.message || `Request failed with status ${res.status}`;

            console.warn('[LegacyStatementService] API Error:', { status: res.status, errorCode, errorMessage });

            return {
                transactions: [],
                count: 0,
                source: 'live_rest',
                error: errorMessage,
                errorCode,
            };
        } catch (fetchErr: any) {
            console.warn('[LegacyStatementService] Network or CORS fetch exception:', fetchErr);
            return {
                transactions: [],
                count: 0,
                source: 'live_rest',
                error: fetchErr?.message || 'Network request failed to Deriv Legacy API.',
                errorCode: 'NetworkError',
            };
        }
    }

    /**
     * Generates realistic legacy sample data for verification / testing
     * (e.g. For CR8416851 pre-upgrade legacy options trading history)
     */
    public static getSampleLegacyData(loginid = 'CR8416851'): LegacyStatementTransaction[] {
        const now = Math.floor(Date.now() / 1000);
        return [
            {
                transaction_id: 28416891,
                account_id: 8416851,
                loginid,
                action_type: 'sell',
                amount: 19.55,
                balance_after: 10452.8,
                transaction_time: now - 3600 * 2,
                contract_id: 10892341,
                reference_id: 9481726,
                currency: 'USD',
                shortcode: 'CALL_1HZ100V_19.55_1711200000_1711200060_S0P_0',
                longcode: 'Win payout if Volatility 100 (1s) Index is strictly higher after 5 ticks',
                bet_class: 'rise_fall',
                bet_type: 'CALL',
                symbol: '1HZ100V',
                app_id: 121856,
            },
            {
                transaction_id: 28416885,
                account_id: 8416851,
                loginid,
                action_type: 'buy',
                amount: -10.0,
                balance_after: 10433.25,
                transaction_time: now - 3600 * 2 - 65,
                contract_id: 10892341,
                reference_id: 9481725,
                currency: 'USD',
                shortcode: 'CALL_1HZ100V_10.00_1711200000_1711200060_S0P_0',
                longcode: 'Buy Call option on Volatility 100 (1s) Index',
                bet_class: 'rise_fall',
                bet_type: 'CALL',
                symbol: '1HZ100V',
                app_id: 121856,
            },
            {
                transaction_id: 28416750,
                account_id: 8416851,
                loginid,
                action_type: 'sell',
                amount: 0.0,
                balance_after: 10443.25,
                transaction_time: now - 86400 * 1 - 1800,
                contract_id: 10891902,
                reference_id: 9481540,
                currency: 'USD',
                shortcode: 'DIGITDIFF_R_75_0.00_1711100000_1711100060_S0P_0',
                longcode: 'Contract lost: Last digit matched prediction on Volatility 75 Index',
                bet_class: 'digits',
                bet_type: 'DIGITDIFF',
                symbol: 'R_75',
                app_id: 121856,
            },
            {
                transaction_id: 28416744,
                account_id: 8416851,
                loginid,
                action_type: 'buy',
                amount: -25.0,
                balance_after: 10443.25,
                transaction_time: now - 86400 * 1 - 1860,
                contract_id: 10891902,
                reference_id: 9481539,
                currency: 'USD',
                shortcode: 'DIGITDIFF_R_75_25.00_1711100000_1711100060_S0P_0',
                longcode: 'Buy Differs option on Volatility 75 Index (Prediction != 5)',
                bet_class: 'digits',
                bet_type: 'DIGITDIFF',
                symbol: 'R_75',
                app_id: 121856,
            },
            {
                transaction_id: 28416520,
                account_id: 8416851,
                loginid,
                action_type: 'sell',
                amount: 38.2,
                balance_after: 10468.25,
                transaction_time: now - 86400 * 3,
                contract_id: 10890123,
                reference_id: 9480998,
                currency: 'USD',
                shortcode: 'ACCU_R_100_38.20_1710900000_1710900300_S0P_0',
                longcode: 'Manual closure of Accumulator option on Volatility 100 Index at 382% return',
                bet_class: 'accumulator',
                bet_type: 'ACCU',
                symbol: 'R_100',
                app_id: 121856,
            },
            {
                transaction_id: 28416510,
                account_id: 8416851,
                loginid,
                action_type: 'buy',
                amount: -10.0,
                balance_after: 10430.05,
                transaction_time: now - 86400 * 3 - 320,
                contract_id: 10890123,
                reference_id: 9480997,
                currency: 'USD',
                shortcode: 'ACCU_R_100_10.00_1710900000_1710900300_S0P_0',
                longcode: 'Buy Accumulator contract with 3% growth rate on Volatility 100 Index',
                bet_class: 'accumulator',
                bet_type: 'ACCU',
                symbol: 'R_100',
                app_id: 121856,
            },
            {
                transaction_id: 28415900,
                account_id: 8416851,
                loginid,
                action_type: 'deposit',
                amount: 500.0,
                balance_after: 10440.05,
                transaction_time: now - 86400 * 6,
                contract_id: undefined,
                reference_id: 9478201,
                currency: 'USD',
                shortcode: 'DEPOSIT_DOUGHFLOW_USD_500.00',
                longcode: 'Account credit: Card / Instant payment deposit',
                bet_class: undefined,
                bet_type: undefined,
                symbol: undefined,
                app_id: 121856,
            },
            {
                transaction_id: 28415200,
                account_id: 8416851,
                loginid,
                action_type: 'withdrawal',
                amount: -200.0,
                balance_after: 9940.05,
                transaction_time: now - 86400 * 12,
                contract_id: undefined,
                reference_id: 9474100,
                currency: 'USD',
                shortcode: 'WITHDRAWAL_CR_USD_200.00',
                longcode: 'Account debit: Crypto / Wallet withdrawal processed',
                bet_class: undefined,
                bet_type: undefined,
                symbol: undefined,
                app_id: 121856,
            },
        ];
    }
}
