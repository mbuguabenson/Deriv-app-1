import { isProduction } from '@/components/shared';
import { getDomainConfig } from '@/components/shared/utils/config/config';
import brandConfig from '../../brand.config.json';

/**
 * Account information from derivatives/accounts endpoint
 */
export interface DerivAccount {
    account_id: string;
    balance: string;
    currency: string;
    group: string;
    status: string;
    account_type: 'demo' | 'real';
}

/**
 * Response from derivatives/accounts endpoint
 */
interface AccountsResponse {
    data: DerivAccount[];
}

interface ResetDemoBalanceResponse {
    data: {
        account_id: string;
        account_type: 'demo' | 'real';
        balance: number;
        currency: string;
        status: string;
    };
}

/**
 * Request payload for creating an options account (POST /trading/v1/options/accounts)
 */
export interface CreateOptionsAccountRequest {
    currency?: string;
    group?: string;
    account_type: 'demo' | 'real';
}

/**
 * Response payload for creating an options account
 */
export interface CreateOptionsAccountResponse {
    data: DerivAccount | DerivAccount[];
    meta?: {
        endpoint: string;
        method: string;
        timing?: number;
    };
}

/**
 * OTP response data
 */
interface OTPResponseData {
    url: string;
}

/**
 * Response from options/accounts/{accountId}/otp endpoint
 */
interface OTPResponse {
    data: OTPResponseData;
}

/**
 * Service for handling DerivWS account operations and WebSocket URL retrieval.
 *
 * Current Deriv API requirements:
 * - Authenticated REST calls use the OAuth Bearer token.
 * - Every authenticated REST call also sends Deriv-App-ID.
 * - Deriv-App-ID is the new developers.deriv.com OAuth application ID
 *   (our per-domain clientId), not the optional legacy V1 app_id.
 * - Authenticated WebSockets are opened from the one-time URL returned by
 *   POST /trading/v1/options/accounts/{accountId}/otp.
 */
export class DerivWSAccountsService {
    private static accountsFetchPromise: Promise<DerivAccount[]> | null = null;
    private static otpFetchPromises: Map<string, Promise<string>> = new Map();

    // Circuit breaker to prevent infinite retry storms that trigger 429 rate limiting
    private static _accountsFetchFailCount: number = 0;
    private static _accountsFetchCooldownUntil: number = 0;
    private static readonly MAX_ACCOUNTS_FETCH_COOLDOWN_MS = 300_000; // 5 min max
    private static readonly BASE_ACCOUNTS_FETCH_COOLDOWN_MS = 30_000;  // 30s initial

    /**
     * Gets the DerivWS base URL based on environment.
     */
    private static getDerivWSBaseURL(): string {
        const environment = isProduction() ? 'production' : 'staging';
        return brandConfig.platform.derivws.url[environment];
    }

    /**
     * Return the current developers.deriv.com application ID.
     *
     * DomainConfig.clientId is the new OAuth application ID. DomainConfig.appId
     * is intentionally reserved for the optional legacy V1 routing app ID and
     * must not be used as Deriv-App-ID on the current REST API.
     */
    private static getDerivAppID(): string {
        const { clientId } = getDomainConfig();
        if (!clientId) {
            throw new Error('Deriv application ID is not configured for this domain.');
        }
        return clientId;
    }

    private static getAuthenticatedHeaders(accessToken: string): Record<string, string> {
        if (!accessToken) {
            throw new Error('Deriv OAuth access token is missing.');
        }

        const cleanToken = accessToken.replace(/^Bearer\s+/i, '');
        const headers: Record<string, string> = {
            Authorization: `Bearer ${cleanToken}`,
        };

        // Per official Deriv specification:
        // - OAuth token: send Authorization: Bearer <token>; do NOT add Deriv-App-ID.
        // - Personal Access Token (PAT): send Authorization: Bearer <token> and Deriv-App-ID header.
        const isPat =
            (typeof window !== 'undefined' && localStorage.getItem('auth_method') === 'api_token') ||
            cleanToken.startsWith('pat_') ||
            cleanToken.startsWith('PAT_');

        if (isPat) {
            headers['Deriv-App-ID'] = this.getDerivAppID();
        }

        return headers;
    }


    /**
     * Clears all cached promises (useful for testing or forced refresh).
     */
    static clearCache(): void {
        this.accountsFetchPromise = null;
        this.otpFetchPromises.clear();
    }

    /**
     * Stores accounts list durably so users stay logged in across browser restarts.
     */
    static storeAccounts(accounts: DerivAccount[]): void {
        const payload = JSON.stringify(accounts);
        localStorage.setItem('deriv_accounts', payload);
        sessionStorage.setItem('deriv_accounts', payload);
    }

    /**
     * Retrieves accounts list from durable storage with session fallback.
     */
    static getStoredAccounts(): DerivAccount[] | null {
        try {
            const accountsStr = localStorage.getItem('deriv_accounts') || sessionStorage.getItem('deriv_accounts');
            if (!accountsStr) {
                return null;
            }
            return JSON.parse(accountsStr) as DerivAccount[];
        } catch (error) {
            console.error('[DerivWS] Error parsing stored accounts:', error);
            return null;
        }
    }

    /**
     * Gets the default account (first account from the list).
     */
    static getDefaultAccount(): DerivAccount | null {
        const accounts = this.getStoredAccounts();
        if (!accounts || accounts.length === 0) {
            return null;
        }
        return accounts[0];
    }

    /**
     * Clears stored accounts from storage.
     */
    static clearStoredAccounts(): void {
        localStorage.removeItem('deriv_accounts');
        sessionStorage.removeItem('deriv_accounts');
    }

    /**
     * Fetches the Options account list from the current Deriv REST API.
     */
    static async fetchAccountsList(accessToken: string): Promise<DerivAccount[]> {
        // Deduplicate in-flight requests
        if (this.accountsFetchPromise) {
            return this.accountsFetchPromise;
        }

        // Circuit breaker: if we recently failed, don't hammer the endpoint
        if (this._accountsFetchCooldownUntil > Date.now()) {
            const stored = this.getStoredAccounts();
            if (stored && stored.length > 0) {
                console.warn('[DerivWS] accounts fetch on cooldown – returning stored accounts');
                return stored;
            }
            throw new Error('[DerivWS] accounts fetch on cooldown and no stored accounts');
        }

        this.accountsFetchPromise = (async () => {
            try {
                const baseURL = this.getDerivWSBaseURL();
                const optionsDir = brandConfig.platform.derivws.directories.options;
                const endpoint = `${baseURL}${optionsDir}accounts`;

                const response = await fetch(endpoint, {
                    method: 'GET',
                    headers: this.getAuthenticatedHeaders(accessToken),
                });

                if (!response.ok) {
                    throw new Error(`Failed to fetch accounts: ${response.status} ${response.statusText}`);
                }

                const data: AccountsResponse = await response.json();
                const accounts = data?.data || [];

                if (accounts.length === 0) {
                    console.warn('[DerivWS] No accounts found in response');
                }

                this.storeAccounts(accounts);
                // Reset circuit breaker on success
                this._accountsFetchFailCount = 0;
                this._accountsFetchCooldownUntil = 0;
                return accounts;
            } catch (error) {
                console.error('[DerivWS] Error fetching accounts:', error);
                // Engage circuit breaker with exponential backoff
                this._accountsFetchFailCount++;
                const backoff = Math.min(
                    this.BASE_ACCOUNTS_FETCH_COOLDOWN_MS * Math.pow(2, this._accountsFetchFailCount - 1),
                    this.MAX_ACCOUNTS_FETCH_COOLDOWN_MS
                );
                this._accountsFetchCooldownUntil = Date.now() + backoff;
                console.warn(`[DerivWS] accounts fetch circuit breaker: cooling down for ${backoff / 1000}s`);
                this.accountsFetchPromise = null;
                throw error;
            } finally {
                // Keep the dedup promise cached for 30s to avoid rapid re-invocation
                setTimeout(() => {
                    this.accountsFetchPromise = null;
                }, 30_000);
            }
        })();

        return this.accountsFetchPromise;
    }

    /**
     * Resets a DerivWS Options demo account balance on Deriv's server.
     */
    static async resetDemoBalance(accessToken: string, accountId: string): Promise<ResetDemoBalanceResponse['data']> {
        if (!accountId) {
            throw new Error('Demo account id is required.');
        }

        const baseURL = this.getDerivWSBaseURL();
        const optionsDir = brandConfig.platform.derivws.directories.options;
        const endpoint = `${baseURL}${optionsDir}accounts/${encodeURIComponent(accountId)}/reset-demo-balance`;

        const response = await fetch(endpoint, {
            method: 'POST',
            headers: this.getAuthenticatedHeaders(accessToken),
        });

        if (!response.ok) {
            let message = `Failed to reset demo balance: ${response.status} ${response.statusText}`;
            try {
                const data = await response.json();
                message = data?.errors?.[0]?.message || data?.error?.message || data?.message || message;
            } catch {
                // Keep the HTTP status message when the body is not JSON.
            }
            throw new Error(message);
        }

        const data: ResetDemoBalanceResponse = await response.json();
        if (!data?.data?.account_id) {
            throw new Error('Deriv did not return the reset demo account.');
        }

        this.clearCache();
        const storedAccounts = this.getStoredAccounts();
        if (storedAccounts?.length) {
            this.storeAccounts(
                storedAccounts.map(account =>
                    account.account_id === data.data.account_id
                        ? {
                              ...account,
                              balance: String(data.data.balance),
                              currency: data.data.currency || account.currency,
                              status: data.data.status || account.status,
                          }
                        : account
                )
            );
        }

        return data.data;
    }

    static async fetchOTPWebSocketURL(accessToken: string, accountId: string): Promise<string> {
        if (!accountId) {
            throw new Error('Deriv account id is required to request an authenticated WebSocket.');
        }

        try {
            const baseURL = this.getDerivWSBaseURL();
            const optionsDir = brandConfig.platform.derivws.directories.options;
            const endpoint = `${baseURL}${optionsDir}accounts/${encodeURIComponent(accountId)}/otp`;

            const response = await fetch(endpoint, {
                method: 'POST',
                headers: this.getAuthenticatedHeaders(accessToken),
            });

            if (!response.ok) {
                let message = `Failed to fetch OTP: ${response.status} ${response.statusText}`;
                try {
                    const data = await response.json();
                    message = data?.errors?.[0]?.message || data?.error?.message || data?.message || message;
                } catch {
                    // Keep the HTTP status message when the body is not JSON.
                }
                throw new Error(message);
            }

            const otpResponse: OTPResponse = await response.json();
            const websocketURL = otpResponse?.data?.url;

            if (!websocketURL) {
                throw new Error('WebSocket URL not found in OTP response');
            }
            return websocketURL;
        } catch (error) {
            console.error('[DerivWS] Error fetching OTP:', error);
            throw error;
        }
    }

    /**
     * Complete authenticated WebSocket flow.
     * 1. Reuse/fetch the current Options accounts.
     * 2. Respect the selected active_loginid when it belongs to the account list.
     * 3. Request a fresh OTP URL for that account.
     */
    static async getAuthenticatedWebSocketURL(accessToken: string): Promise<string> {
        try {
            const storedAccounts = this.getStoredAccounts();
            let accounts: DerivAccount[];

            // Cached accounts can contain stale special/DOT IDs that the Options
            // API does not recognize. Always prefer the live account list before
            // requesting a single-use OTP URL.
            try {
                accounts = await this.fetchAccountsList(accessToken);
            } catch (error) {
                accounts = (storedAccounts || []).filter(account => !account.account_id.startsWith('DOT'));
                if (accounts.length === 0) throw error;
            }

            if (accounts.length === 0) {
                throw new Error('No accounts available');
            }

            const activeLoginId = localStorage.getItem('active_loginid');
            const targetAccount = (activeLoginId && accounts.find(a => a.account_id === activeLoginId)) || accounts[0];

            return await this.fetchOTPWebSocketURL(accessToken, targetAccount.account_id);
        } catch (error) {
            console.error('[DerivWS] Error in authenticated WebSocket URL flow:', error);
            throw error;
        }
    }

    /**
     * Creates a new Options trading account on Deriv Options REST API.
     * Endpoint: POST /trading/v1/options/accounts
     * Docs: https://developers.deriv.com/docs/options/create-account/
     */
    static async createAccount(
        accessToken: string,
        params: CreateOptionsAccountRequest
    ): Promise<DerivAccount> {
        if (!accessToken) {
            throw new Error('Deriv OAuth access token is required to create an account.');
        }

        const account_type = params.account_type;
        if (account_type !== 'demo' && account_type !== 'real') {
            throw new Error(`Invalid account_type: "${account_type}". Must be "demo" or "real".`);
        }

        const currency = params.currency || 'USD';
        const group = params.group || 'row';

        const baseURL = this.getDerivWSBaseURL();
        const optionsDir = brandConfig.platform.derivws.directories.options;
        const endpoint = `${baseURL}${optionsDir}accounts`;

        const response = await fetch(endpoint, {
            method: 'POST',
            headers: {
                ...this.getAuthenticatedHeaders(accessToken),
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                currency,
                group,
                account_type,
            }),
        });

        if (!response.ok) {
            let message = `Failed to create account: ${response.status} ${response.statusText}`;
            try {
                const errData = await response.json();
                message =
                    errData?.errors?.[0]?.message ||
                    errData?.error?.message ||
                    errData?.message ||
                    message;
            } catch {
                // Keep default HTTP status message
            }
            throw new Error(message);
        }

        const resData: CreateOptionsAccountResponse = await response.json();
        const rawAccount = Array.isArray(resData?.data) ? resData.data[0] : resData?.data;

        if (!rawAccount || !rawAccount.account_id) {
            throw new Error('Deriv did not return account details in the response.');
        }

        const createdAccount: DerivAccount = {
            account_id: rawAccount.account_id,
            balance: String(rawAccount.balance ?? (account_type === 'demo' ? 10000 : 0)),
            currency: rawAccount.currency || currency,
            group: rawAccount.group || group,
            status: rawAccount.status || 'active',
            account_type: (rawAccount.account_type as 'demo' | 'real') || account_type,
        };

        // Invalidate cache
        this.clearCache();

        // Update stored accounts
        const storedAccounts = this.getStoredAccounts() || [];
        const existingIdx = storedAccounts.findIndex(a => a.account_id === createdAccount.account_id);
        let updatedAccounts: DerivAccount[];
        if (existingIdx >= 0) {
            updatedAccounts = storedAccounts.map((a, idx) => (idx === existingIdx ? createdAccount : a));
        } else {
            updatedAccounts = [...storedAccounts, createdAccount];
        }
        this.storeAccounts(updatedAccounts);

        // Also update client_account_details for global observables
        try {
            const rawDetails = localStorage.getItem('client_account_details');
            const existingDetails = rawDetails ? JSON.parse(rawDetails) : [];
            if (Array.isArray(existingDetails)) {
                const foundIdx = existingDetails.findIndex(
                    (a: any) => (a.loginid || a.account_id) === createdAccount.account_id
                );
                const detailEntry = {
                    account_id: createdAccount.account_id,
                    loginid: createdAccount.account_id,
                    balance: parseFloat(createdAccount.balance) || 0,
                    currency: createdAccount.currency,
                    is_virtual: createdAccount.account_type === 'demo' ? 1 : 0,
                };
                if (foundIdx >= 0) {
                    existingDetails[foundIdx] = { ...existingDetails[foundIdx], ...detailEntry };
                } else {
                    existingDetails.push(detailEntry);
                }
                localStorage.setItem('client_account_details', JSON.stringify(existingDetails));
            }
        } catch (e) {
            console.warn('[DerivWS] Failed to sync client_account_details:', e);
        }

        // Dispatch sync events for UI listeners
        if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('deriv_account_created', { detail: createdAccount }));
            window.dispatchEvent(new CustomEvent('accounts_updated', { detail: updatedAccounts }));
        }

        return createdAccount;
    }
}
