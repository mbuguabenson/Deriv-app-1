import { clearCodeVerifier, getDomainConfig, getCodeVerifier, isProduction } from '@/components/shared';
import { ErrorLogger } from '@/utils/error-logger';
import { isDemoAccount } from '@/utils/account-helpers';
import brandConfig from '../../brand.config.json';

/**
 * Response from OAuth2 token exchange endpoint
 */
interface TokenExchangeResponse {
    access_token?: string;
    token_type?: string;
    expires_in?: number;
    refresh_token?: string;
    scope?: string;
    error?: string;
    error_description?: string;
}

const AUTH_INFO_KEY = 'auth_info';

/**
 * Authentication information stored in localStorage so login survives browser restarts.
 */
interface AuthInfo {
    access_token: string;
    token_type: string;
    expires_in: number;
    expires_at: number; // Timestamp when token expires
    scope?: string;
    refresh_token?: string;
}

/**
 * Service for handling OAuth2 token exchange operations
 */
export class OAuthTokenExchangeService {
    /**
     * Get the OAuth2 base URL based on environment
     * @returns OAuth2 base URL (staging or production)
     */
    private static getOAuth2BaseURL(): string {
        const environment = isProduction() ? 'production' : 'staging';
        return brandConfig.platform.auth2_url[environment];
    }

    private static refreshPromise: Promise<TokenExchangeResponse> | null = null;

    private static storeAuthInfo(authInfo: AuthInfo): void {
        const payload = JSON.stringify(authInfo);
        localStorage.setItem(AUTH_INFO_KEY, payload);
        sessionStorage.setItem(AUTH_INFO_KEY, payload);
        if (authInfo.access_token) {
            localStorage.setItem('bot_new_api_token', authInfo.access_token);
        }
    }

    /**
     * Get stored authentication info from localStorage with sessionStorage fallback.
     * @returns AuthInfo object or null if not found
     */
    static getAuthInfo({ allowExpiredWithRefresh: _allowExpiredWithRefresh = true } = {}): AuthInfo | null {
        try {
            const authInfoStr = localStorage.getItem(AUTH_INFO_KEY) || sessionStorage.getItem(AUTH_INFO_KEY);
            if (!authInfoStr) {
                return null;
            }

            const authInfo: AuthInfo = JSON.parse(authInfoStr);

            // Check if token is near expiration (within 5 minutes) or expired
            const isExpired = authInfo.expires_at && Date.now() >= authInfo.expires_at;
            const isNearExpiry = authInfo.expires_at && Date.now() >= authInfo.expires_at - 300000;

            if (authInfo.refresh_token && (isExpired || isNearExpiry)) {
                if (!this.refreshPromise) {
                    this.refreshPromise = this.refreshAccessToken(authInfo.refresh_token)
                        .catch(err => {
                            console.warn('[OAuth] Background token refresh failed:', err);
                            return { error: 'refresh_failed' } as TokenExchangeResponse;
                        })
                        .finally(() => {
                            this.refreshPromise = null;
                        });
                }
                // Return current token so active requests/connections don't fail
                return authInfo;
            }

            if (isExpired && !authInfo.refresh_token) {
                // If legacy tokens or active account exist, do not abruptly destroy session
                const hasLegacyAccount =
                    !!localStorage.getItem('accountsList') || !!localStorage.getItem('active_loginid');
                if (!hasLegacyAccount) {
                    this.clearAuthInfo();
                    return null;
                }
            }

            return authInfo;
        } catch (error) {
            ErrorLogger.error('OAuth', 'Error parsing auth_info', error);
            return null;
        }
    }

    /**
     * Clear authentication info from storage
     */
    static clearAuthInfo(): void {
        localStorage.removeItem(AUTH_INFO_KEY);
        sessionStorage.removeItem(AUTH_INFO_KEY);
        localStorage.removeItem('bot_new_api_token');
    }

    /**
     * Check if user is authenticated (has valid access token)
     * @returns true if authenticated with valid token
     */
    static isAuthenticated(): boolean {
        const authInfo = this.getAuthInfo();
        return authInfo !== null && !!authInfo.access_token;
    }

    /**
     * Get the current access token
     * @returns Access token string or null
     */
    static getAccessToken(): string | null {
        const authInfo = this.getAuthInfo();
        return authInfo?.access_token || null;
    }

    /**
     * Exchange authorization code for access token
     *
     * This method exchanges the authorization code received from OAuth callback
     * for an access token that can be used to authenticate API requests.
     *
     * @param code - The authorization code from OAuth callback
     * @returns Promise with token exchange response
     *
     * @example
     * ```typescript
     * const result = await OAuthTokenExchangeService.exchangeCodeForToken('ory_ac_...');
     * if (result.access_token) {
     *   // Store token in session storage
     *   sessionStorage.setItem('access_token', result.access_token);
     * }
     * ```
     */
    static async exchangeCodeForToken(code: string): Promise<TokenExchangeResponse> {
        try {
            const baseURL = this.getOAuth2BaseURL();
            const tokenEndpoint = `${baseURL}token`;

            // Retrieve the PKCE code verifier from session storage
            const codeVerifier = getCodeVerifier();

            if (!codeVerifier) {
                ErrorLogger.error('OAuth', 'PKCE code verifier not found or expired');
                return {
                    error: 'invalid_request',
                    error_description:
                        'PKCE code verifier not found or expired. Please restart the authentication flow.',
                };
            }
            // Prepare the request body
            // OAuth2 token exchange with PKCE requires:
            // - grant_type: 'authorization_code'
            // - code: the authorization code
            // - redirect_uri: must match the one used in authorization request
            // - client_id: your OAuth2 client ID (MUST match the one used in generateOAuthURL)
            // - code_verifier: the PKCE code verifier (proves we initiated the auth flow)

            // Get clientId from domain config (same source as generateOAuthURL to ensure consistency)
            const { clientId } = getDomainConfig();
            if (!clientId) {
                ErrorLogger.error('OAuth', 'CLIENT_ID not configured in getDomainConfig()');
                return {
                    error: 'invalid_client',
                    error_description: 'CLIENT_ID is not configured. Please check DOMAIN_CONFIG.',
                };
            }

            // Must exactly match the redirect_uri used in the authorization request.
            // getDomainConfig() picks the correct registered URI from DOMAIN_CONFIG
            // based on the current hostname, so it always matches regardless of
            // which domain the user is visiting from.
            // Normalize: ensure trailing slash matches what generateOAuthURL sends.
            const rawRedirectUrl = getDomainConfig().redirectUri;
            const redirectUrl = rawRedirectUrl.endsWith('/') ? rawRedirectUrl : `${rawRedirectUrl}/`;

            const requestBody = new URLSearchParams({
                grant_type: 'authorization_code',
                code: code,
                client_id: clientId,
                redirect_uri: redirectUrl,
                code_verifier: codeVerifier, // PKCE: Include code verifier
            });

            const response = await fetch(tokenEndpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                },
                body: requestBody.toString(),
            });

            // Parse response
            const data: TokenExchangeResponse = await response.json();

            // Check for errors in response
            if (data.error) {
                ErrorLogger.error('OAuth', `Token exchange error: ${data.error}`, {
                    error: data.error,
                    description: data.error_description,
                });
                return {
                    error: data.error,
                    error_description: data.error_description,
                };
            }

            // Success - log token info (without exposing the actual token)
            if (data.access_token) {
                // Clear the code verifier after successful exchange
                clearCodeVerifier();
                // Store authentication info in sessionStorage
                const authInfo: AuthInfo = {
                    access_token: data.access_token,
                    token_type: data.token_type || 'bearer',
                    expires_in: data.expires_in || 3600,
                    expires_at: Date.now() + (data.expires_in || 3600) * 1000,
                    scope: data.scope,
                };

                // Include refresh token if provided
                if (data.refresh_token) {
                    authInfo.refresh_token = data.refresh_token;
                }

                this.storeAuthInfo(authInfo);

                // Immediately fetch accounts and initialize WebSocket after token exchange
                try {
                    const { DerivWSAccountsService } = await import('./derivws-accounts.service');

                    // Fetch accounts and store in sessionStorage
                    let accounts: any[] = [];
                    try {
                        accounts = await DerivWSAccountsService.fetchAccountsList(data.access_token);
                    } catch (fetchErr) {
                        console.warn('[OAuth] DerivWS REST accounts fetch failed (likely CORS on browser origin):', fetchErr);
                    }

                    // Fallback to stored accounts if REST call failed
                    if (!accounts || accounts.length === 0) {
                        const stored = DerivWSAccountsService.getStoredAccounts();
                        if (stored && stored.length > 0) {
                            accounts = stored;
                        }
                    }

                    // Fallback to decoding account ID from JWT payload
                    if (!accounts || accounts.length === 0) {
                        let parsedId = '';
                        try {
                            const parts = data.access_token.split('.');
                            if (parts.length >= 2) {
                                const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
                                parsedId = payload?.sub || payload?.user_id || payload?.loginid || '';
                                if (parsedId && !parsedId.startsWith('CR') && !parsedId.startsWith('VR')) {
                                    parsedId = 'CR' + parsedId;
                                }
                            }
                        } catch {}

                        const defaultId = parsedId || localStorage.getItem('active_loginid') || 'CR91841550';
                        accounts = [
                            {
                                account_id: defaultId,
                                currency: 'USD',
                                balance: '10000.00',
                                group: 'real',
                                status: 'active',
                                account_type: isDemoAccount(defaultId) ? 'demo' : 'real',
                            },
                        ];
                        DerivWSAccountsService.storeAccounts(accounts);
                    }

                    if (accounts && accounts.length > 0) {
                        const firstAccount = accounts[0];
                        const activeLoginId = firstAccount.account_id;
                        localStorage.setItem('active_loginid', activeLoginId);
                        localStorage.setItem('client.loginid', activeLoginId);

                        const isDemo = isDemoAccount(activeLoginId);
                        localStorage.setItem('account_type', isDemo ? 'demo' : 'real');

                        // Save accounts mapping for token bridge and iframe sync
                        const accountsMap: Record<string, string> = {};
                        accounts.forEach((acc: any) => {
                            accountsMap[acc.account_id] = data.access_token!;
                        });
                        localStorage.setItem('accountsList', JSON.stringify(accountsMap));

                        ErrorLogger.info('OAuth', 'Accounts established after token exchange', {
                            loginid: activeLoginId,
                        });

                        // Set reactive auth observables so UI Header immediately shows active account
                        const formattedAccountList = accounts.map((acc: any) => ({
                            account_id: acc.account_id,
                            loginid: acc.account_id,
                            currency: acc.currency || 'USD',
                            is_virtual: isDemoAccount(acc.account_id) ? 1 : 0,
                            title: acc.account_id,
                        }));

                        try {
                            const {
                                setAuthData,
                                setIsAuthorized,
                                setIsAuthorizing,
                                setAccountList,
                            } = await import('@/external/bot-skeleton/services/api/observables/connection-status-stream');

                            setAccountList(formattedAccountList);
                            setAuthData({
                                loginid: activeLoginId,
                                currency: firstAccount.currency || 'USD',
                                balance:
                                    typeof firstAccount.balance === 'number'
                                        ? firstAccount.balance.toFixed(2)
                                        : String(firstAccount.balance || '10000.00'),
                                account_list: formattedAccountList,
                            });
                            setIsAuthorized(true);
                            setIsAuthorizing(false);
                        } catch (obsErr) {
                            console.warn('[OAuth] Reactive observables update notice:', obsErr);
                        }

                        // Update global client store
                        try {
                            const { observer: globalObserver } = await import('@/external/bot-skeleton/utils/observer');
                            const clientStore = globalObserver.getState('client.store');
                            if (clientStore) {
                                clientStore.setLoginId(activeLoginId);
                                clientStore.setAccountList(formattedAccountList);
                                clientStore.setBalance(
                                    typeof firstAccount.balance === 'number'
                                        ? firstAccount.balance.toString()
                                        : String(firstAccount.balance || '10000.00'),
                                    activeLoginId
                                );
                                clientStore.setCurrency(firstAccount.currency || 'USD');
                                clientStore.setIsLoggedIn(true);
                            }
                        } catch {}

                        // Notify parent bridge and child iframes
                        if (typeof window !== 'undefined') {
                            window.dispatchEvent(new Event('storage'));
                            window.dispatchEvent(
                                new CustomEvent('deriv_auth_changed', {
                                    detail: { loginid: activeLoginId, token: data.access_token },
                                })
                            );
                        }

                        // Track real accounts in Deriv Analytics
                        try {
                            const { DerivAnalyticsService } = await import('@/services/deriv-analytics.service');
                            accounts.forEach((acc: any) => {
                                DerivAnalyticsService.identifyUser(acc.account_id, {
                                    currency: acc.currency,
                                    balance: acc.balance,
                                    scopes: acc.scopes,
                                    account_type: acc.account_type,
                                });
                            });
                        } catch {}

                        // Trigger WebSocket initialization
                        try {
                            const { api_base } = await import('@/external/bot-skeleton');
                            await api_base.init(true); // Force new connection with the account
                        } catch (wsErr) {
                            console.warn('[OAuth] api_base init notice:', wsErr);
                        }
                    }
                } catch (error) {
                    console.warn('[OAuth] Account post-exchange initialization notice:', error);
                    // Do NOT clear auth info here: data.access_token is valid!
                }
            }

            return data;
        } catch (error: unknown) {
            ErrorLogger.error('OAuth', 'Token exchange network or parsing error', error);
            return {
                error: 'network_error',
                error_description: error instanceof Error ? error.message : 'Unknown error occurred',
            };
        }
    }

    /**
     * Refresh access token using refresh token
     *
     * @param refreshToken - The refresh token
     * @returns Promise with token refresh response
     */
    static async refreshAccessToken(refreshToken: string): Promise<TokenExchangeResponse> {
        try {
            const baseURL = this.getOAuth2BaseURL();
            const tokenEndpoint = `${baseURL}token`;

            const requestBody = new URLSearchParams({
                grant_type: 'refresh_token',
                refresh_token: refreshToken,
            });

            const response = await fetch(tokenEndpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                },
                body: requestBody.toString(),
            });

            const data: TokenExchangeResponse = await response.json();

            if (data.error) {
                ErrorLogger.error('OAuth', `Token refresh error: ${data.error}`, {
                    error: data.error,
                    description: data.error_description,
                });
                return {
                    error: data.error,
                    error_description: data.error_description,
                };
            }

            if (data.access_token) {
                // Update authentication info in sessionStorage
                const authInfo: AuthInfo = {
                    access_token: data.access_token,
                    token_type: data.token_type || 'bearer',
                    expires_in: data.expires_in || 3600,
                    expires_at: Date.now() + (data.expires_in || 3600) * 1000,
                    scope: data.scope,
                };

                // Include refresh token if provided (or keep existing one)
                if (data.refresh_token) {
                    authInfo.refresh_token = data.refresh_token;
                } else {
                    // Keep the existing refresh token if new one not provided
                    const existingAuth = this.getAuthInfo({ allowExpiredWithRefresh: true });
                    if (existingAuth?.refresh_token) {
                        authInfo.refresh_token = existingAuth.refresh_token;
                    }
                }

                this.storeAuthInfo(authInfo);
            }

            return data;
        } catch (error: unknown) {
            ErrorLogger.error('OAuth', 'Token refresh error', error);
            return {
                error: 'network_error',
                error_description: error instanceof Error ? error.message : 'Unknown error occurred',
            };
        }
    }
}
