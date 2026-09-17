/**
 * token-bridge.ts
 *
 * Shared utility for reading Deriv login tokens stored by the OAuth flow.
 * These tokens are written to localStorage under 'accountsList' as a map
 * of { [loginId]: token }.
 */

import { OAuthTokenExchangeService } from '@/services/oauth-token-exchange.service';
import { DerivWSAccountsService } from '@/services/derivws-accounts.service';

/** Returns the raw accountsList map from all localStorage/sessionStorage sources */
export const getAccountsList = (): Record<string, string> => {
    const map: Record<string, string> = {};

    try {
        // 1. Check accountsList map
        const rawAccountsList = localStorage.getItem('accountsList');
        if (rawAccountsList) {
            const parsed = JSON.parse(rawAccountsList);
            if (parsed && typeof parsed === 'object') {
                for (const k in parsed) {
                    const token = typeof parsed[k] === 'string' ? parsed[k] : parsed[k]?.token;
                    if (token && !isInvalidBearerToken(token)) {
                        map[k] = token;
                    }
                }
            }
        }

        // 2. Check client.accounts / clientAccounts
        const rawClientAccounts = localStorage.getItem('client.accounts') || localStorage.getItem('clientAccounts');
        if (rawClientAccounts) {
            const parsed = JSON.parse(rawClientAccounts);
            if (parsed && typeof parsed === 'object') {
                for (const k in parsed) {
                    const token = parsed[k]?.token || (typeof parsed[k] === 'string' ? parsed[k] : '');
                    if (token && !isInvalidBearerToken(token)) {
                        map[k] = token;
                    }
                }
            }
        }

        // 3. Check client_account_details
        const rawAccountDetails = localStorage.getItem('client_account_details');
        if (rawAccountDetails) {
            const parsed = JSON.parse(rawAccountDetails);
            if (Array.isArray(parsed)) {
                parsed.forEach((item: any) => {
                    const id = item?.loginid || item?.account_id;
                    const token = item?.token;
                    if (id && token && !isInvalidBearerToken(token)) {
                        map[id] = token;
                    }
                });
            }
        }

        // 4. Check deriv_accounts in session/local storage
        const rawDerivAccounts = sessionStorage.getItem('deriv_accounts') || localStorage.getItem('deriv_accounts');
        if (rawDerivAccounts) {
            const parsed = JSON.parse(rawDerivAccounts);
            if (Array.isArray(parsed)) {
                parsed.forEach((item: any) => {
                    const id = item?.account_id || item?.loginid;
                    const token = item?.token;
                    if (id && token && !isInvalidBearerToken(token)) {
                        map[id] = token;
                    }
                });
            }
        }

        // 5. Check acct1..acct10 & token1..token10 in localStorage and sessionStorage
        for (let i = 1; i <= 10; i++) {
            const acct = localStorage.getItem(`acct${i}`) || sessionStorage.getItem(`acct${i}`);
            const tok = localStorage.getItem(`token${i}`) || sessionStorage.getItem(`token${i}`);
            if (acct && tok && !isInvalidBearerToken(tok)) {
                map[acct] = tok;
            }
        }

        // 6. Direct token fallback if mapped with active_loginid
        const activeId = localStorage.getItem('active_loginid') || localStorage.getItem('client.loginid');
        const directToken =
            localStorage.getItem('token') ||
            localStorage.getItem('active_token') ||
            localStorage.getItem('authToken') ||
            localStorage.getItem('token1') ||
            localStorage.getItem('deriv_api_token');
        if (activeId && directToken && !isInvalidBearerToken(directToken) && !map[activeId]) {
            map[activeId] = directToken;
        }
    } catch {}

    return map;
};

/** Returns the active loginid (e.g. "CR123456" or "VRTC1234") */
export const getActiveLoginId = (): string =>
    localStorage.getItem('active_loginid') || localStorage.getItem('client.loginid') || '';

export const isInvalidBearerToken = (token: string | null | undefined): boolean =>
    !token ||
    typeof token !== 'string' ||
    token.trim() === '' ||
    token === 'null' ||
    token === 'undefined' ||
    token === 'a1-guest' ||
    token === 'guest' ||
    token.startsWith('demo_token') ||
    token.startsWith('real_token') ||
    token.startsWith('dummy_token') ||
    token.startsWith('mock_token') ||
    token.startsWith('test_token') ||
    token.length > 512;

export const STORAGE_KEYS = {
    BOT_NEW_API_TOKEN: 'bot_new_api_token',
    LEGACY_DTRADER_TOKEN: 'legacy_dtrader_token',
    LEGACY_TOKEN1: 'token1',
    LEGACY_ACCT1: 'acct1',
} as const;

/**
 * Validates whether a token conforms to Deriv Legacy API token format (e.g. "a1-..." or non-JWT).
 * Legacy DTrader and legacy WebSocket authorize only accept legacy tokens, NOT OAuth2 Bearer JWTs.
 */
export const isLegacyToken = (token: string | null | undefined): boolean =>
    Boolean(token && !isInvalidBearerToken(token) && !token.startsWith('ey'));

export const getBotNewApiToken = (): string | null => {
    return localStorage.getItem(STORAGE_KEYS.BOT_NEW_API_TOKEN);
};

/**
 * Returns the isolated New Deriv API token for Bot & Native Radar services.
 * Stored under 'bot_new_api_token' or retrieved from OAuthTokenExchangeService.
 */
export const getBotNewAPIToken = (): string | null => {
    try {
        const direct = localStorage.getItem(STORAGE_KEYS.BOT_NEW_API_TOKEN) || sessionStorage.getItem(STORAGE_KEYS.BOT_NEW_API_TOKEN);
        if (direct && !isInvalidBearerToken(direct)) return direct;
        const authInfo = OAuthTokenExchangeService.getAuthInfo({ allowExpiredWithRefresh: true });
        if (authInfo?.access_token && !isInvalidBearerToken(authInfo.access_token)) {
            return authInfo.access_token;
        }
    } catch {}
    return null;
};

/** Sets the isolated New Deriv API token for the Bot */
export const setBotNewAPIToken = (token: string): void => {
    try {
        if (token) {
            localStorage.setItem('bot_new_api_token', token);
        } else {
            localStorage.removeItem('bot_new_api_token');
        }
    } catch {}
};

/**
 * Returns the isolated Legacy Deriv token strictly for DTrader (iframe & legacy WebSocket).
 * Will NEVER return an OAuth2 JWT Bearer token, preventing "InvalidToken" / "Session Expired" in DTrader.
 */
export const getLegacyDTraderToken = (specificLoginId?: string): string | null => {
    try {
        const id = specificLoginId || getActiveLoginId();
        const list = getAccountsList();
        if (id && list[id] && isLegacyToken(list[id])) {
            return list[id];
        }

        const explicitLegacy =
            localStorage.getItem('legacy_dtrader_token') ||
            localStorage.getItem('token1');
        if (explicitLegacy && isLegacyToken(explicitLegacy)) {
            return explicitLegacy;
        }

        if (!specificLoginId) {
            for (const key in list) {
                if (isLegacyToken(list[key])) {
                    return list[key];
                }
            }
            const direct = localStorage.getItem('active_token') || localStorage.getItem('authToken');
            if (direct && isLegacyToken(direct)) {
                return direct;
            }
        }
    } catch {}
    return null;
};

/** Sets the isolated Legacy Deriv token for DTrader */
export const setLegacyDTraderToken = (token: string, loginid?: string): void => {
    try {
        if (token) {
            localStorage.setItem('legacy_dtrader_token', token);
            localStorage.setItem('token1', token);
            if (loginid) {
                const raw = localStorage.getItem('accountsList');
                const list = raw ? JSON.parse(raw) : {};
                list[loginid] = token;
                localStorage.setItem('accountsList', JSON.stringify(list));
            }
        } else {
            localStorage.removeItem('legacy_dtrader_token');
        }
    } catch {}
};

/** Synchronously checks if a valid token is available in storage or URL */
export const getActiveToken = (specificLoginId?: string): string | null => {
    const list = getAccountsList();
    const id = specificLoginId || getActiveLoginId();
    if (id && list[id] && !isInvalidBearerToken(list[id])) {
        return list[id];
    }
    if (!specificLoginId) {
        for (const key in list) {
            if (!isInvalidBearerToken(list[key])) {
                return list[key];
            }
        }

        const storedToken =
            localStorage.getItem('token') ||
            localStorage.getItem('active_token') ||
            localStorage.getItem('authToken') ||
            localStorage.getItem('token1') ||
            localStorage.getItem('legacy_dtrader_token') ||
            localStorage.getItem('deriv_api_token');
        if (storedToken && !isInvalidBearerToken(storedToken)) {
            return storedToken;
        }
    }

    return null;
};

/**
 * Robustly resolves a valid Deriv WebSocket authorization token for an account.
 * Fast-paths synchronous storage checks so postMessage handshakes are never delayed.
 */
export const resolveValidDerivWSToken = async (loginid?: string): Promise<string> => {
    // 1. Fast synchronous check from storage / URL for target loginid
    const syncToken = getActiveToken(loginid);
    if (syncToken && !isInvalidBearerToken(syncToken)) {
        return syncToken;
    }

    // 2. Check URL query parameters (e.g., ?token1=a1-xxx or ?token=a1-xxx)
    try {
        if (typeof window !== 'undefined') {
            const urlParams = new URLSearchParams(window.location.search);
            const tokenFromUrl = urlParams.get('token1') || urlParams.get('token');
            if (tokenFromUrl && !isInvalidBearerToken(tokenFromUrl)) {
                return tokenFromUrl;
            }
        }
    } catch (e) {
        // noop
    }

    // 3. Fetch OTP WebSocket token for PKCE OAuth2 session.
    // Two sequential REST calls are needed (accounts list + OTP), so allow 10s.
    try {
        const authInfo = OAuthTokenExchangeService.getAuthInfo();
        if (authInfo?.access_token) {
            const fetchPromise = DerivWSAccountsService.getAuthenticatedWebSocketURL(authInfo.access_token);
            const timeoutPromise = new Promise<string>((_, reject) =>
                setTimeout(() => reject(new Error('OTP fetch timeout')), 10000)
            );
            const wsUrl = await Promise.race([fetchPromise, timeoutPromise]);
            if (wsUrl) {
                const parsedUrl = new URL(wsUrl);
                const otpToken = parsedUrl.searchParams.get('token') || parsedUrl.searchParams.get('otp');
                if (otpToken && !isInvalidBearerToken(otpToken)) {
                    return otpToken;
                }
            }
        }
    } catch (e) {
        // OTP backend unreachable or timed out
        console.warn('[tokenBridge] OTP fetch failed:', e);
    }

    return '';
};

/** Returns true if the user is logged in (has any accounts or active tokens) */
export const isLoggedIn = (): boolean => {
    try {
        if (Object.keys(getAccountsList()).length > 0) return true;
        const authInfo = OAuthTokenExchangeService.getAuthInfo({ allowExpiredWithRefresh: true });
        if (authInfo?.access_token && !isInvalidBearerToken(authInfo.access_token)) return true;
        const botToken = localStorage.getItem('bot_new_api_token') || sessionStorage.getItem('bot_new_api_token');
        if (botToken && !isInvalidBearerToken(botToken)) return true;
        const directToken = localStorage.getItem('token') || localStorage.getItem('active_token') || localStorage.getItem('authToken');
        if (directToken && !isInvalidBearerToken(directToken)) return true;
        const activeLoginId = localStorage.getItem('active_loginid') || localStorage.getItem('client.loginid');
        if (activeLoginId && (localStorage.getItem('client.accounts') || localStorage.getItem('clientAccounts'))) return true;
    } catch {}
    return false;
};

/** Returns all tokens from the logged-in session */
export const getAllSessionTokens = (): string[] => Object.values(getAccountsList()).filter(Boolean);

/** Sanitize accountsList in-place */
export const sanitizeAccountsList = (): void => {
    try {
        const raw = getAccountsList();
        const filtered = Object.fromEntries(
            Object.entries(raw).filter(([, v]) => v && v !== 'null' && v !== 'undefined')
        );
        if (JSON.stringify(filtered) !== JSON.stringify(raw)) {
            localStorage.setItem('accountsList', JSON.stringify(filtered));
        }
    } catch (e) {
        // noop
    }
};

/** Returns the first real account token */
export const getRealAccountToken = (): string | null => {
    const list = getAccountsList();
    const realKey = Object.keys(list).find(k => !k.startsWith('VR') && !k.startsWith('VRT') && !k.startsWith('DOT'));
    return realKey ? list[realKey] : null;
};

export const getRealAccount = (): { loginId: string; token: string } | null => {
    const list = getAccountsList();
    const realKey = Object.keys(list).find(k => !k.startsWith('VR') && !k.startsWith('VRT') && !k.startsWith('DOT'));
    if (!realKey) return null;
    return { loginId: realKey, token: list[realKey] };
};

export const getDemoAccount = (): { loginId: string; token: string } | null => {
    const list = getAccountsList();
    const demoKey = Object.keys(list).find(k => k.startsWith('VR') || k.startsWith('VRT') || k.startsWith('DOT'));
    if (!demoKey) return null;
    return { loginId: demoKey, token: list[demoKey] };
};

export const formatLoginDisplay = (): string => {
    const active = getActiveLoginId();
    const list = getAccountsList();
    if (!active) return 'Not logged in';

    if (active.startsWith('VR') || active.startsWith('DOT')) {
        const crKey = Object.keys(list).find(k => !k.startsWith('VR') && !k.startsWith('DOT'));
        return crKey ? `Demo (${crKey})` : `Demo: ${active}`;
    }
    return active;
};

export const truncateToken = (token: string, visibleChars = 6): string =>
    token.length > visibleChars * 2 ? `${token.slice(0, visibleChars)}••••${token.slice(-4)}` : '••••••••';

/**
 * Checks whether the current session or supplied token represents a Personal Access Token (PAT).
 * PATs are manually generated in Deriv settings; OAuth tokens are obtained via OAuth 2.0 PKCE / redirect.
 */
export const isPersonalAccessToken = (token?: string): boolean => {
    try {
        if (typeof window !== 'undefined') {
            const authMethod = localStorage.getItem('auth_method');
            if (authMethod === 'api_token') return true;
        }
    } catch {}
    if (token && (token.startsWith('pat_') || token.startsWith('PAT_'))) return true;
    return false;
};

/**
 * Builds HTTP request headers according to Deriv API specifications:
 * - OAuth token: send Authorization: Bearer <token>; do NOT add Deriv-App-ID.
 * - Personal Access Token (PAT): send Authorization: Bearer <token> AND Deriv-App-ID header.
 */
export const getDerivAuthHeaders = (token: string, isPat?: boolean, customAppId?: string): Record<string, string> => {
    if (!token) {
        throw new Error('Deriv authentication token is missing.');
    }

    const cleanToken = token.replace(/^Bearer\s+/i, '');
    const headers: Record<string, string> = {
        Authorization: `Bearer ${cleanToken}`,
        'Content-Type': 'application/json',
    };

    const isPatToken = isPat !== undefined ? isPat : isPersonalAccessToken(cleanToken);
    if (isPatToken) {
        const appId = customAppId || localStorage.getItem('config.app_id') || '121856';
        headers['Deriv-App-ID'] = String(appId);
    }

    return headers;
};

/**
 * Completely purges an invalid token and/or associated loginid across all storage locations.
 * Prevents recursive authorization errors when Deriv rejects an expired or invalid token.
 */
export const purgeInvalidToken = (tokenOrLoginId?: string): void => {
    try {
        if (!tokenOrLoginId || typeof window === 'undefined') return;

        const target = tokenOrLoginId.trim();
        const isLoginId = /^[A-Za-z]+[0-9]+$/.test(target);

        // 1. Sanitize accountsList
        const rawAccountsList = localStorage.getItem('accountsList');
        if (rawAccountsList) {
            try {
                const list = JSON.parse(rawAccountsList);
                if (list && typeof list === 'object') {
                    let changed = false;
                    for (const [k, v] of Object.entries(list)) {
                        if (k === target || v === target) {
                            delete list[k];
                            changed = true;
                        }
                    }
                    if (changed) {
                        localStorage.setItem('accountsList', JSON.stringify(list));
                    }
                }
            } catch {}
        }

        // 2. Sanitize client.accounts & clientAccounts
        ['client.accounts', 'clientAccounts'].forEach(key => {
            const raw = localStorage.getItem(key);
            if (raw) {
                try {
                    const parsed = JSON.parse(raw);
                    if (parsed && typeof parsed === 'object') {
                        let changed = false;
                        for (const [k, v] of Object.entries(parsed)) {
                            const tok = (v as any)?.token || (typeof v === 'string' ? v : '');
                            if (k === target || tok === target) {
                                delete parsed[k];
                                changed = true;
                            }
                        }
                        if (changed) {
                            localStorage.setItem(key, JSON.stringify(parsed));
                        }
                    }
                } catch {}
            }
        });

        // 3. Sanitize client.tokens
        const rawClientTokens = localStorage.getItem('client.tokens');
        if (rawClientTokens) {
            try {
                const parsed = JSON.parse(rawClientTokens);
                if (parsed && typeof parsed === 'object') {
                    let changed = false;
                    for (const [k, v] of Object.entries(parsed)) {
                        if (k === target || v === target) {
                            delete parsed[k];
                            changed = true;
                        }
                    }
                    if (changed) {
                        localStorage.setItem('client.tokens', JSON.stringify(parsed));
                    }
                }
            } catch {}
        }

        // 4. Sanitize client_account_details
        const rawDetails = localStorage.getItem('client_account_details');
        if (rawDetails) {
            try {
                const parsed = JSON.parse(rawDetails);
                if (Array.isArray(parsed)) {
                    const filtered = parsed.filter(
                        item => item?.loginid !== target && item?.token !== target
                    );
                    localStorage.setItem('client_account_details', JSON.stringify(filtered));
                }
            } catch {}
        }

        // 5. Sanitize direct single-token keys
        const directKeys = [
            'active_token',
            'authToken',
            'token',
            'token1',
            'legacy_dtrader_token',
            'bot_new_api_token',
            'deriv_api_token',
        ];
        directKeys.forEach(k => {
            const val = localStorage.getItem(k);
            if (val === target || (isLoginId && localStorage.getItem('active_loginid') === target)) {
                localStorage.removeItem(k);
            }
        });

        if (
            localStorage.getItem('active_loginid') === target ||
            localStorage.getItem('active_account') === target ||
            localStorage.getItem('client.loginid') === target
        ) {
            localStorage.removeItem('active_loginid');
            localStorage.removeItem('active_account');
            localStorage.removeItem('client.loginid');
        }
    } catch (e) {
        console.warn('[tokenBridge] Failed to purge invalid token:', e);
    }
};

