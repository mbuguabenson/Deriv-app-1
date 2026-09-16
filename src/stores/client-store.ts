import { action, computed, makeObservable, observable } from 'mobx';
/* [/AI] */
import { isEmptyObject } from '@/components/shared';
import { isMultipliersOnly, isOptionsBlocked } from '@/components/shared/common/utility';
import { removeCookies } from '@/components/shared/utils/storage/storage';
import { observer as globalObserver, observer } from '@/external/bot-skeleton';
import { api_base } from '@/external/bot-skeleton/services/api/api-base';
/* [AI] - Analytics removed - utility functions moved to @/utils/account-helpers */
import { getAccountId, isDemoAccount } from '@/utils/account-helpers';
import { ErrorLogger } from '@/utils/error-logger';
import type { Balance } from '@deriv/api-types';
import {
    authData$,
    setAccountList,
    setAuthData,
    setIsAuthorized,
} from '../external/bot-skeleton/services/api/observables/connection-status-stream';
import type { TAuthData } from '../types/api-types';
import { SharedActionsBridge } from '@/utils/shared-actions-bridge';

export default class ClientStore {
    loginid = '';
    account_list: TAuthData['account_list'] = [];
    balance = '0';
    currency = 'AUD';
    is_logged_in = false;
    is_account_regenerating = false;

    accounts: Record<string, NonNullable<TAuthData['account_list']>[number]> = {};
    all_accounts_balance: Balance | null = null;
    is_logging_out = false;

    private authDataSubscription: { unsubscribe: () => void } | null = null;

    private tab_visibility_handler: ((event: Event) => void) | null = null;
    private ws_login_id: string | null = null;
    private is_regenerating = false;
    private instance_id: string = '';

    // TODO: fix with self exclusion

    onAuthorizeEvent = (data: {
        account_list?: TAuthData['account_list'];
        current_account?: { loginid: string; currency: string; is_virtual: number; balance?: number };
    }) => {
        const currentAccountId = getAccountId() || this.loginid;
        const incomingLoginId = data?.current_account?.loginid;

        if (incomingLoginId && currentAccountId && incomingLoginId !== currentAccountId) {
            return;
        }

        if (data?.account_list) {
            this.setAccountList(data.account_list);
        }

        // Update current account details from new API structure only for the
        // currently selected account. Ignore stale authorize events from older
        // account sessions that arrive after a switch.
        if (data?.current_account) {
            this.setLoginId(data.current_account.loginid);
            this.setCurrency(data.current_account.currency);
            this.setIsLoggedIn(true);
            localStorage.setItem('active_loginid', data.current_account.loginid);

            this.setWebSocketLoginId(data.current_account.loginid);

            if (typeof data.current_account.balance === 'number') {
                this.setBalance(data.current_account.balance.toString());
            }
        }
    };

    constructor() {
        // FIX #3: Add cache to prevent redundant account loads
        const accountLoadingCache = new Map<string, Promise<void>>();

        // Hydrate from localStorage cache only if a genuine active session exists
        try {
            const hasAuthInfo = !!localStorage.getItem('auth_info') || !!sessionStorage.getItem('auth_info');
            const hasAccountsList = !!localStorage.getItem('accountsList');
            const hasTokens =
                !!localStorage.getItem('authToken') ||
                !!localStorage.getItem('active_token') ||
                !!localStorage.getItem('token1') ||
                !!localStorage.getItem('deriv_api_token');
            const cachedLoginid = localStorage.getItem('active_loginid') || localStorage.getItem('client.loginid');

            if (cachedLoginid && (hasAuthInfo || hasAccountsList || hasTokens)) {
                this.loginid = cachedLoginid;
                this.is_logged_in = true;

                // FIX #3: Async account details loading with timeout
                const cachedDetails = localStorage.getItem('client_account_details');
                if (cachedDetails) {
                    try {
                        const list = JSON.parse(cachedDetails);
                        if (Array.isArray(list) && list.length > 0) {
                            this.setAccountList(list);
                            const active = list.find((a: any) => a.loginid === cachedLoginid) || list[0];
                            if (active) {
                                this.currency = active.currency || 'USD';
                                if (active.balance !== undefined && active.balance !== null) {
                                    this.balance = active.balance.toString();
                                }
                            }
                        }
                    } catch (parseError: any) {
                        console.error('Failed to parse cached account details:', parseError);
                        this.is_logged_in = false;
                        this.loginid = '';
                    }
                }
            } else {
                this.loginid = '';
                this.is_logged_in = false;
            }
        } catch (e: any) {
            console.debug('[ClientStore] Initialization error:', e?.message);
            this.loginid = '';
            this.is_logged_in = false;
        }

        observer.register('api.authorize', this.onAuthorizeEvent);

        // Clean up any existing instance before registering new one to prevent memory leaks
        const existingId = globalObserver.getState('client.store.id');
        if (existingId) {
            globalObserver.setState({ 'client.store': null, 'client.store.id': null });
        }

        // Register this instance with the global observer so api-base can access it
        // Store a reference to this instance with a cryptographically secure unique ID to prevent memory leaks
        // Use crypto.getRandomValues for better uniqueness and security than Math.random()
        this.instance_id = `client_store_${Date.now()}_${crypto.getRandomValues(new Uint32Array(1))[0].toString(36)}`;
        globalObserver.setState({ 'client.store': this, 'client.store.id': this.instance_id });

        // Set up visibility change listener to regenerate WebSocket when tab becomes visible
        this.setupVisibilityListener();

        makeObservable(this, {
            accounts: observable,
            account_list: observable,

            all_accounts_balance: observable,
            balance: observable,
            currency: observable,

            is_logged_in: observable,
            is_account_regenerating: observable,
            loginid: observable,
            is_logging_out: observable,
            active_accounts: computed,
            is_bot_allowed: computed,

            is_eu_or_multipliers_only: computed,
            is_low_risk: computed,
            is_multipliers_only: computed,
            is_options_blocked: computed,
            is_virtual: computed,

            residence: computed,

            logout: action,
            onAuthorizeEvent: action,
            setAccountList: action,

            setAllAccountsBalance: action,
            setIsAccountRegenerating: action,
            setBalance: action,
            setCurrency: action,
            setIsLoggedIn: action,
            setIsLoggingOut: action,
            setLoginId: action,

            is_trading_experience_incomplete: computed,
            is_cr_account: computed,
            account_open_date: computed,
        });

        // Store cache reference for this store instance
        (this as any).accountLoadingCache = accountLoadingCache;
    }

    get active_accounts() {
        return this.accounts instanceof Object ? Object.values(this.accounts) : [];
    }

    get is_bot_allowed() {
        return this.isBotAllowed();
    }
    get is_trading_experience_incomplete() {
        return false;
    }

    get is_low_risk() {
        return false;
    }

    get residence() {
        return '';
    }

    get is_options_blocked() {
        return isOptionsBlocked(this.residence);
    }

    get is_multipliers_only() {
        return isMultipliersOnly(this.residence);
    }

    get is_eu_or_multipliers_only() {
        // Always return false - EU restrictions now handled by backend
        return false;
    }

    get is_virtual() {
        if (this.loginid) {
            return isDemoAccount(this.loginid) ? 1 : 0;
        }
        return !isEmptyObject(this.accounts) && this.accounts[this.loginid] && !!this.accounts[this.loginid].is_virtual
            ? 1
            : 0;
    }

    get all_loginids() {
        return !isEmptyObject(this.accounts) ? Object.keys(this.accounts) : [];
    }

    get virtual_account_loginid() {
        return this.all_loginids.find(loginid => !!this.accounts[loginid].is_virtual);
    }

    get is_cr_account() {
        return this.loginid?.startsWith('CR') || this.loginid?.startsWith('ROT');
    }

    get should_hide_header() {
        return false;
    }

    get account_open_date() {
        // TAccount does not carry a created_at field — always return undefined.
        return undefined;
    }

    isBotAllowed = () => {
        return this.is_virtual ? this.is_eu_or_multipliers_only : !this.is_options_blocked;
    };

    setLoginId = (loginid: string) => {
        this.loginid = loginid;
    };

    switchAccount = async (loginid: string) => {
        if (!loginid) return false;
        const { AccountSwitcherService } = await import('@/services/account-switcher.service');
        return AccountSwitcherService.switchAccount(loginid, this);
    };

    setIsVirtual = (is_virtual: number) => {
        this.accounts = {
            ...this.accounts,
            [this.loginid]: {
                ...this.accounts[this.loginid],
                is_virtual,
                loginid: this.loginid,
            } as any,
        };
    };

    setAccountList = (account_list?: TAuthData['account_list']) => {
        this.accounts = {};
        account_list?.forEach(account => {
            this.accounts[account.loginid] = account;
        });
        if (account_list) {
            this.account_list = account_list;
            try {
                localStorage.setItem('client_account_details', JSON.stringify(account_list));
            } catch (e: any) {
                console.debug('[ClientStore] Could not persist account_list:', e?.message);
            }
        }
    };

    setBalance = (balance: string, loginid?: string) => {
        const currentLoginId = getAccountId() || this.loginid;

        // If a specific loginid was provided with this balance update, ensure it belongs to the active account
        if (loginid && currentLoginId && loginid !== currentLoginId) {
            // Update the background account's balance in the accounts map without overwriting active balance
            const numBal = parseFloat(balance) || 0;
            if (this.accounts[loginid]) {
                this.accounts[loginid] = {
                    ...this.accounts[loginid],
                    balance: numBal,
                };
            }
            if (Array.isArray(this.account_list)) {
                this.account_list = this.account_list.map(acc =>
                    acc.loginid === loginid ? { ...acc, balance: numBal } : acc
                );
            }
            return;
        }

        if (currentLoginId && this.loginid !== currentLoginId) {
            this.loginid = currentLoginId;
        }

        this.balance = balance;
        const numBal = parseFloat(balance) || 0;
        const targetId = loginid || currentLoginId || this.loginid;
        if (targetId) {
            if (this.accounts[targetId]) {
                this.accounts[targetId] = {
                    ...this.accounts[targetId],
                    balance: numBal,
                };
            }
            if (Array.isArray(this.account_list)) {
                this.account_list = this.account_list.map(acc =>
                    acc.loginid === targetId ? { ...acc, balance: numBal } : acc
                );
                try {
                    localStorage.setItem('client_account_details', JSON.stringify(this.account_list));
                } catch (e: any) {
                    console.debug('[ClientStore] Could not update account_list in storage:', e?.message);
                }
            }
            try {
                const storedAccounts =
                    localStorage.getItem('client.accounts') || localStorage.getItem('clientAccounts');
                if (storedAccounts) {
                    const parsed = JSON.parse(storedAccounts);
                    if (parsed[targetId]) {
                        parsed[targetId].balance = numBal;
                        localStorage.setItem('client.accounts', JSON.stringify(parsed));
                        localStorage.setItem('clientAccounts', JSON.stringify(parsed));
                    }
                }
            } catch (e: any) {
                console.debug('[ClientStore] Could not update client.accounts in storage:', e?.message);
            }

            // Sync authData$ observable so useActiveAccount and reactive headers update immediately
            const currentAuth = authData$.getValue();
            if (currentAuth && (!currentAuth.loginid || currentAuth.loginid === targetId)) {
                authData$.next({
                    ...currentAuth,
                    balance: numBal,
                });
            }

            if (api_base?.account_info && (api_base.account_info as any).loginid === targetId) {
                (api_base.account_info as any).balance = numBal;
            }

            try {
                localStorage.setItem('balance', String(numBal));
            } catch {}

            // Broadcast balance update across windows / iframes
            try {
                SharedActionsBridge.dispatch('BALANCE_UPDATE', {
                    balance: numBal,
                    loginid: targetId,
                    currency: this.currency,
                });
            } catch {}
        }
    };

    setCurrency = (currency: string) => {
        this.currency = currency;
    };

    setIsLoggedIn = (is_logged_in: boolean) => {
        this.is_logged_in = is_logged_in;
    };

    getCurrency = () => {
        const clientAccounts = JSON.parse(localStorage.getItem('clientAccounts') ?? '{}');
        return clientAccounts[this.loginid]?.currency ?? '';
    };

    getToken = () => {
        const accountList = JSON.parse(localStorage.getItem('accountsList') ?? '{}');
        return accountList[this.loginid] ?? '';
    };

    getTokenForAccount = (loginid: string) => {
        const accountList = JSON.parse(localStorage.getItem('accountsList') ?? '{}');
        return accountList[loginid] ?? '';
    };

    setAllAccountsBalance = (all_accounts_balance: Balance | undefined) => {
        this.all_accounts_balance = all_accounts_balance ?? null;
    };

    /**
     * Returns the display balance as a number for the given (or active) loginid.
     * Used by trade-purchase.ts assertSufficientDemoBalance.
     */
    getDisplayBalanceAmount = (loginid?: string): number => {
        const id = loginid || this.loginid;
        // Prefer the live balance on the active account
        if (id === this.loginid) {
            return Number(this.balance ?? 0);
        }
        // Fallback: balance stored in the accounts map
        const account = this.accounts[id];
        return Number(account?.balance ?? 0);
    };

    /**
     * Returns the currency for the given (or active) loginid.
     * Used by trade-purchase.ts assertSufficientDemoBalance.
     */
    getAccountCurrency = (loginid?: string): string => {
        const id = loginid || this.loginid;
        if (id === this.loginid) return this.currency || 'USD';
        const account = this.accounts[id];
        return account?.currency || this.currency || 'USD';
    };

    /**
     * Returns true when the account has enough balance to cover the required amount.
     * For real-money accounts this guard is intentionally skipped (always returns true)
     * so only the Deriv backend enforces the real-money limit.
     * For virtual/demo accounts the local balance is checked to give instant feedback.
     * Used by trade-purchase.ts assertSufficientDemoBalance.
     */
    hasSufficientDemoBalance = (amount: number, loginid?: string): boolean => {
        const id = loginid || this.loginid;
        const account = this.accounts[id];
        // Only enforce the local balance check for virtual/demo accounts
        if (!account?.is_virtual) return true;
        return this.getDisplayBalanceAmount(id) >= amount;
    };
    setIsAccountRegenerating = (is_loading: boolean) => {
        this.is_account_regenerating = is_loading;
    };

    setIsLoggingOut = (is_logging_out: boolean) => {
        this.is_logging_out = is_logging_out;
    };

    /**
     * Request logout via WebSocket (legacy method for backward compatibility)
     */
    logout = async () => {
        this.setIsLoggingOut(true);
        try {
            // Clear DerivAPI singleton instance and close WebSocket
            const { clearDerivApiInstance } = await import('@/external/bot-skeleton/services/api/appId');
            clearDerivApiInstance();

            // Clear accounts cache from DerivWSAccountsService
            const { DerivWSAccountsService } = await import('@/services/derivws-accounts.service');
            DerivWSAccountsService.clearStoredAccounts();
            DerivWSAccountsService.clearCache();

            // Clear OAuth token from sessionStorage and localStorage
            const { OAuthTokenExchangeService } = await import('@/services/oauth-token-exchange.service');
            OAuthTokenExchangeService.clearAuthInfo();

            // Reset all client store states
            this.account_list = [];
            this.accounts = {};
            this.is_logged_in = false;
            this.loginid = '';
            this.balance = '0';
            this.currency = 'USD';
            this.all_accounts_balance = null;

            // Clear all auth-related storage keys
            const keysToRemove = [
                'active_loginid',
                'accountsList',
                'authToken',
                'active_token',
                'auth_info',
                'client.loginid',
                'client.currency',
                'client.accounts',
                'clientAccounts',
                'account_type',
                'deriv_api_token',
                'token1',
                'token2',
                'token3',
                'token4',
                'token5',
                'acct1',
                'acct2',
                'acct3',
                'acct4',
                'acct5',
                'cur1',
                'cur2',
                'cur3',
                'cur4',
                'cur5',
            ];
            keysToRemove.forEach(k => {
                localStorage.removeItem(k);
                sessionStorage.removeItem(k);
            });

            // Clear cookies
            removeCookies('client_information');

            // Reset observables
            setIsAuthorized(false);
            setAccountList([]);
            setAuthData(null);

            this.setIsLoggingOut(false);

            // Disable livechat
            try {
                window.LC_API?.close_chat?.();
                window.LiveChatWidget?.call('hide');
                if (window.Intercom) {
                    window.Intercom('shutdown');
                }
            } catch (e: any) {
                console.debug('[ClientStore] Could not close chat widgets:', e?.message);
            }

            // Cleanly redirect to root / login
            window.location.replace('/');
        } catch (e) {
            console.error('Logout error:', e);
            localStorage.clear();
            sessionStorage.clear();
            window.location.replace('/');
        }
    };

    /**
     * Sets up visibility change listener to regenerate WebSocket when tab becomes visible
     */
    setupVisibilityListener() {
        // Remove existing listener if any
        this.removeVisibilityListener();

        // Create handler function
        this.tab_visibility_handler = async () => {
            if (document.visibilityState === 'visible') {
                if (this.is_logged_in && !this.is_regenerating) {
                    this.checkAndRegenerateWebSocket();
                    api_base.refreshBalance?.().catch(() => {});
                    api_base.ensureAuthSubscriptions?.().catch(() => {});
                }
            }
        };

        // Add listener
        document.addEventListener('visibilitychange', this.tab_visibility_handler);
    }

    /**
     * Set the current WebSocket login ID
     * @param login_id The login ID used for the WebSocket connection
     */
    setWebSocketLoginId(login_id: string) {
        this.ws_login_id = login_id;
    }

    /**
     * Check if WebSocket needs to be regenerated based on login ID comparison
     * @returns True if WebSocket needs regeneration, false otherwise
     */
    needsWebSocketRegeneration(): boolean {
        const active_login_id = getAccountId();
        return (
            !this.is_regenerating &&
            !!active_login_id &&
            !!this.ws_login_id &&
            active_login_id !== this.ws_login_id &&
            !api_base.is_running
        );
    }

    /**
     * Check if WebSocket needs regeneration and regenerate if needed
     */
    checkAndRegenerateWebSocket() {
        if (this.needsWebSocketRegeneration()) {
            this.regenerateWebSocket();
        }
    }

    /**
     * Regenerate WebSocket connection with the new login ID
     * This method clears all data and creates a new connection with the current active login ID
     * Protected against race conditions with the is_regenerating flag
     * Includes error handling to prevent users from being stuck in loading state
     */
    async regenerateWebSocket() {
        if (this.is_regenerating) return;

        this.is_regenerating = true;
        this.setIsAccountRegenerating(true);

        try {
            const active_login_id = getAccountId();

            if (active_login_id) {
                // Clear DerivAPI singleton instance to force new connection
                const { clearDerivApiInstance } = await import('@/external/bot-skeleton/services/api/appId');
                clearDerivApiInstance();

                // Clear accounts cache but keep stored accounts for reuse
                const { DerivWSAccountsService } = await import('@/services/derivws-accounts.service');
                DerivWSAccountsService.clearCache();

                this.account_list = [];

                // Preserve is_logged_in state during WebSocket regeneration if active credentials exist
                const hasActiveCredentials =
                    !!active_login_id &&
                    (!!localStorage.getItem('accountsList') ||
                        !!localStorage.getItem('authToken') ||
                        !!localStorage.getItem('token1'));
                if (!hasActiveCredentials) {
                    this.setIsLoggedIn(false);
                }

                // NOTE: Do NOT remove accountsList, authToken, clientAccounts, or account_type
                // from localStorage here. Clearing them would permanently log the user out
                // if the subsequent api_base.init() call fails. The in-memory state above is
                // enough to reset the UI while preserving the ability to re-authorize.
                removeCookies('client_information');

                setIsAuthorized(false);
                setAccountList([]);
                setAuthData(null);

                this.setIsLoggingOut(false);

                // disable livechat
                window.LC_API?.close_chat?.();
                window.LiveChatWidget?.call('hide');

                // Force create a new connection with the current active login ID
                // Wrap the potentially failing init call in a try-catch
                try {
                    await api_base.init(true); // ✅ Await the async call
                } catch (initError) {
                    ErrorLogger.error('ClientStore', 'WebSocket initialization failed', initError);
                    this.setIsAccountRegenerating(false);
                    throw initError; // Re-throw to be caught by outer catch if needed
                }

                // Update the tracked WebSocket login ID
                this.setWebSocketLoginId(active_login_id);
            }
        } catch (error) {
            ErrorLogger.error('ClientStore', 'WebSocket regeneration failed', error);
            this.setIsAccountRegenerating(false);
            // Consider showing user-facing error notification here
            // or dispatching an event that UI components can listen to
        } finally {
            this.is_regenerating = false;
        }
    }

    /**
     * Removes the visibility change listener
     */
    removeVisibilityListener() {
        if (this.tab_visibility_handler) {
            document.removeEventListener('visibilitychange', this.tab_visibility_handler);
            this.tab_visibility_handler = null;
        }
    }

    destroy() {
        this.authDataSubscription?.unsubscribe();
        observer.unregister('api.authorize', this.onAuthorizeEvent);
        this.removeVisibilityListener();

        // Properly clean up the global observer reference
        // Only clear if this instance is the one referenced by checking the instance ID
        const storedId = globalObserver.getState('client.store.id');
        if (storedId === this.instance_id) {
            globalObserver.setState({ 'client.store': null, 'client.store.id': null });
        }
    }
}
