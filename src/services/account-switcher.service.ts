/**
 * High-Speed Instant Account Switcher Service
 * Zero-reload in-memory account switching with timeout guardrails.
 * - Instantly updates UI, stores, and local storage (0ms perceived latency)
 * - Seamlessly re-authorizes active WebSocket session without tearing down TCP/SSL connections
 * - Automatically falls back to background socket refresh if authorization times out (>2500ms)
 * - Dispatches global sync events to update all open tabs and components
 */

import { api_base } from '@/external/bot-skeleton/services/api/api-base';
import {
    setAccountList,
    setAuthData,
    setIsAuthorizing,
} from '@/external/bot-skeleton/services/api/observables/connection-status-stream';
import { observer as globalObserver } from '@/external/bot-skeleton/utils/observer';
import { isDemoAccount } from '@/utils/account-helpers';
import { getAccountsList, getActiveToken } from '@/utils/token-bridge';

export class AccountSwitcherService {
    private static isSwitching = false;

    /**
     * Instantly switch the active account across the entire platform
     * @param targetLoginId The loginid to switch to (e.g. 'CR123456', 'VRTC987654')
     * @param clientStore Optional reference to MobX ClientStore
     * @param options Optional pre-known balance and currency for instant 0ms sync
     */
    public static async switchAccount(
        targetLoginId: string,
        clientStore?: any,
        options?: { balance?: number | string; currency?: string }
    ): Promise<boolean> {
        if (!targetLoginId) return false;
        if (this.isSwitching) {
            console.warn('[AccountSwitcherService] Switch already in progress, proceeding with latest target...');
        }

        this.isSwitching = true;

        try {
            console.log(`[AccountSwitcherService] Initiating high-speed switch to ${targetLoginId}...`);
            window.dispatchEvent(new CustomEvent('account_switching_start', { detail: { loginid: targetLoginId } }));

            // 1. Update localStorage identifiers immediately
            localStorage.setItem('active_loginid', targetLoginId);
            localStorage.setItem('client.loginid', targetLoginId);
            api_base.account_id = targetLoginId;

            // 2. Resolve token for the target account
            const accountsList = getAccountsList();
            let targetToken = accountsList[targetLoginId] || '';
            if (!targetToken) {
                targetToken = getActiveToken(targetLoginId) || '';
            }
            if (!targetToken) {
                const { resolveValidDerivWSToken } = await import('@/utils/token-bridge');
                targetToken = await resolveValidDerivWSToken(targetLoginId);
            }

            if (targetToken) {
                localStorage.setItem('authToken', targetToken);
                localStorage.setItem('active_token', targetToken);
                localStorage.setItem('deriv_api_token', targetToken);
                localStorage.setItem('token', targetToken);
            }

            // 3. Resolve target account metadata with priority fallback
            let targetBalance: number = options?.balance !== undefined ? Number(options.balance) : 0;
            let targetCurrency: string = options?.currency || (isDemoAccount(targetLoginId) ? 'USD' : 'USD');

            if (targetBalance === 0) {
                // Priority 1: Check in-memory clientStore
                if (clientStore?.accounts?.[targetLoginId]?.balance !== undefined) {
                    targetBalance = Number(clientStore.accounts[targetLoginId].balance);
                    targetCurrency = clientStore.accounts[targetLoginId].currency || targetCurrency;
                } else if (Array.isArray(clientStore?.account_list)) {
                    const found = clientStore.account_list.find((a: any) => a.loginid === targetLoginId);
                    if (found && found.balance !== undefined) {
                        targetBalance = Number(found.balance);
                        targetCurrency = found.currency || targetCurrency;
                    }
                }
            }

            // Priority 2: Check localStorage client_account_details
            if (targetBalance === 0) {
                try {
                    const rawDetails = localStorage.getItem('client_account_details');
                    if (rawDetails) {
                        const parsed = JSON.parse(rawDetails);
                        if (Array.isArray(parsed)) {
                            const found = parsed.find((a: any) => a.loginid === targetLoginId);
                            if (found && found.balance !== undefined) {
                                targetBalance = Number(found.balance);
                                targetCurrency = found.currency || targetCurrency;
                            }
                        }
                    }
                } catch (e: any) {
                    // Silently ignore parse errors
                    console.debug('[AccountSwitcherService] Could not parse client_account_details:', e?.message);
                }
            }

            // Priority 3: Check client.accounts
            if (targetBalance === 0) {
                try {
                    const rawClientAccounts =
                        localStorage.getItem('client.accounts') || localStorage.getItem('clientAccounts');
                    if (rawClientAccounts) {
                        const parsed = JSON.parse(rawClientAccounts);
                        const found = parsed[targetLoginId];
                        if (found) {
                            targetBalance = Number(found.balance || 0);
                            targetCurrency = found.currency || targetCurrency;
                        }
                    }
                } catch (e: any) {
                    // Silently ignore parse errors
                    console.debug('[AccountSwitcherService] Could not parse client.accounts:', e?.message);
                }
            }

            const isVirtual = isDemoAccount(targetLoginId);
            localStorage.setItem('account_type', isVirtual ? 'demo' : 'real');
            localStorage.setItem('active_currency', targetCurrency);
            const balance = targetBalance;
            const hasKnownBalance = balance > 0;

            // 4. Instantly synchronize client store and auth observables (0ms perceived latency)
            // Only pre-set balance if we actually know it; otherwise leave the loading state
            // active (spinning) until the WS authorize response provides the real balance.
            const resolvedClientStore = clientStore || globalObserver.getState('client.store');
            if (resolvedClientStore) {
                if (typeof resolvedClientStore.setLoginId === 'function') {
                    resolvedClientStore.setLoginId(targetLoginId);
                }
                if (typeof resolvedClientStore.setCurrency === 'function') {
                    resolvedClientStore.setCurrency(targetCurrency);
                }
                // Only pre-populate balance if we have a real cached value to avoid showing 0.00
                if (hasKnownBalance && typeof resolvedClientStore.setBalance === 'function') {
                    resolvedClientStore.setBalance(String(balance), targetLoginId);
                }
            }

            // Only emit balance in the optimistic authData update if we actually know it.
            // Emitting balance=0 would make useActiveAccount render "0.00" until the real
            // authorize response arrives. If unknown, omit it so the previous balance is preserved.
            setAuthData({
                loginid: targetLoginId,
                currency: targetCurrency,
                ...(hasKnownBalance ? { balance } : {}),
                is_virtual: isVirtual ? 1 : 0,
            } as any);

            api_base.account_info = {
                balance,
                currency: targetCurrency,
                loginid: targetLoginId,
            };
            api_base.token = targetToken || targetLoginId;

            // 5. Invalidate old subscriptions to prevent cross-account stream overwrite
            if (typeof api_base.unsubscribeAllSubscriptions === 'function') {
                api_base.unsubscribeAllSubscriptions();
            }

            setIsAuthorizing(true);

            // 6. Broadcast the switch intent across the application
            window.dispatchEvent(
                new CustomEvent('account_switching_start', {
                    detail: { loginid: targetLoginId, currency: targetCurrency, balance, token: targetToken },
                })
            );
            window.dispatchEvent(new Event('currency_changed'));
            window.dispatchEvent(new Event('storage'));

            // 7. Seamless live WebSocket re-authorization with strict 2500ms timeout guard
            const { DerivWSAccountsService } = await import('./derivws-accounts.service');
            DerivWSAccountsService.clearCache();

            let authorized = false;

            if (
                api_base.api &&
                api_base.api.connection &&
                api_base.api.connection.readyState === WebSocket.OPEN &&
                targetToken
            ) {
                const authorizePromise = (async () => {
                    if (targetToken && typeof api_base.api.authorize === 'function') {
                        return api_base.api.authorize(targetToken);
                    }
                    return null;
                })();

                const timeoutPromise = new Promise((_, reject) =>
                    setTimeout(() => reject(new Error('WebSocket authorize timeout (2500ms)')), 2500)
                );

                try {
                    const res: any = await Promise.race([authorizePromise, timeoutPromise]);
                    if (res?.authorize && res.authorize.loginid === targetLoginId) {
                        console.log(
                            '[AccountSwitcherService] WebSocket authorized successfully for:',
                            res.authorize.loginid
                        );
                        const authBalance =
                            typeof res.authorize.balance === 'number'
                                ? res.authorize.balance
                                : parseFloat(res.authorize.balance || '0');
                        const authCurrency = res.authorize.currency || targetCurrency;
                        const authLoginid = res.authorize.loginid;
                        const authAccountList = res.authorize.account_list;

                        api_base.account_info = {
                            balance: authBalance,
                            currency: authCurrency,
                            loginid: authLoginid,
                        };
                        api_base.token = authLoginid;
                        api_base.is_authorized = true;
                        authorized = true;

                        if (resolvedClientStore) {
                            if (typeof resolvedClientStore.setBalance === 'function') {
                                resolvedClientStore.setBalance(String(authBalance), authLoginid);
                            }
                            if (typeof resolvedClientStore.setCurrency === 'function') {
                                resolvedClientStore.setCurrency(authCurrency);
                            }
                            if (typeof resolvedClientStore.setLoginId === 'function') {
                                resolvedClientStore.setLoginId(authLoginid);
                            }
                            if (authAccountList && typeof resolvedClientStore.setAccountList === 'function') {
                                resolvedClientStore.setAccountList(authAccountList);
                            }
                        }

                        try {
                            const { DerivAnalyticsService } = await import('@/services/deriv-analytics.service');
                            DerivAnalyticsService.identifyUser(authLoginid, {
                                currency: authCurrency,
                                balance: authBalance,
                                fullname: res.authorize.fullname || res.authorize.email,
                                email: res.authorize.email,
                                scopes: res.authorize.scopes,
                                country: res.authorize.country,
                            });
                        } catch {}

                        setAuthData({
                            loginid: authLoginid,
                            currency: authCurrency,
                            balance: authBalance,
                            is_virtual: isVirtual ? 1 : 0,
                            email: res.authorize.email || '',
                            fullname: res.authorize.fullname || '',
                            landing_company_name: res.authorize.landing_company_name || 'svg',
                            user_id: res.authorize.user_id || 0,
                        } as any);

                        if (authAccountList) {
                            setAccountList(authAccountList);
                        }

                        globalObserver.emit('api.authorize', {
                            account_list: authAccountList,
                            current_account: {
                                loginid: authLoginid,
                                currency: authCurrency,
                                is_virtual: isVirtual ? 1 : 0,
                                balance: authBalance,
                            },
                        });

                        window.dispatchEvent(
                            new CustomEvent('account_switched', {
                                detail: {
                                    loginid: authLoginid,
                                    currency: authCurrency,
                                    balance: authBalance,
                                    token: targetToken,
                                },
                            })
                        );
                        window.dispatchEvent(new Event('currency_changed'));

                        // Subscribe to live balance & transaction stream on new authoritative account
                        api_base.subscribe().catch(() => {});
                    } else if (res?.authorize && res.authorize.loginid !== targetLoginId) {
                        console.warn(
                            `[AccountSwitcherService] Fast authorize returned ${res.authorize.loginid}, expected ${targetLoginId}; reconnecting socket...`
                        );
                    }
                } catch (timeoutOrWsErr: any) {
                    console.warn(
                        '[AccountSwitcherService] Fast authorize notice, falling back to background socket refresh:',
                        timeoutOrWsErr?.message
                    );
                }
            }

            // If not authorized over existing connection (e.g. PKCE OAuth OTP or token mismatch), reinitialize socket in background
            if (!authorized) {
                await api_base.init(true).catch(() => {});
            }

            return true;
        } catch (err) {
            console.error('[AccountSwitcherService] Error during switch:', err);
            return false;
        } finally {
            this.isSwitching = false;
            window.dispatchEvent(new CustomEvent('account_switching_end', { detail: { loginid: targetLoginId } }));
        }
    }
}
