import { useCallback, useEffect, useMemo, useRef } from 'react';
import Cookies from 'js-cookie';
import { observer } from 'mobx-react-lite';
import { toMoment } from '@/components/shared';
import { FORM_ERROR_MESSAGES } from '@/components/shared/constants/form-error-messages';
import { initFormErrorMessages } from '@/components/shared/utils/validation/declarative-validation-rules';
import { api_base } from '@/external/bot-skeleton';
import { useApiBase } from '@/hooks/useApiBase';
import { useStore } from '@/hooks/useStore';
import { TSocketResponseData } from '@/types/api-types';
import { clearInvalidTokenParams } from '@/utils/url-utils';
import { useTranslations } from '@deriv-com/translations';

import { getCookieDomain } from '@/utils/cookie-domain';

type TClientInformation = {
    loginid?: string;
    email?: string;
    currency?: string;
    residence?: string | null;
    first_name?: string;
    last_name?: string;
    preferred_language?: string | null;
    user_id?: number | string;
};
const CoreStoreProvider: React.FC<{ children: React.ReactNode }> = observer(({ children }) => {
    const currentDomain = useMemo(() => getCookieDomain(), []);
    const { isAuthorizing, isAuthorized, connectionStatus, accountList, activeLoginid } = useApiBase();

    const appInitialization = useRef(false);
    const accountInitialization = useRef(false);
    const timeInterval = useRef<NodeJS.Timeout | null>(null);
    const msg_listener = useRef<{ unsubscribe: () => void } | null>(null);
    const { client, common } = useStore() ?? {};

    const { currentLang } = useTranslations();

    const activeAccount = useMemo(
        () => accountList?.find(account => account.loginid === activeLoginid),
        [activeLoginid, accountList]
    );

    useEffect(() => {
        if (client && isAuthorized) {
            if (activeLoginid) client.setLoginId(activeLoginid);
            if (accountList && accountList.length > 0) client.setAccountList(accountList);
            client.setIsLoggedIn(true);
        } else if (client && !isAuthorized && !isAuthorizing) {
            // Only mark as logged out if NO stored credentials exist in storage
            const hasStoredSession =
                !!localStorage.getItem('active_loginid') ||
                !!localStorage.getItem('accountsList') ||
                !!localStorage.getItem('authToken') ||
                !!localStorage.getItem('active_token') ||
                !!localStorage.getItem('token1') ||
                !!localStorage.getItem('auth_info') ||
                !!sessionStorage.getItem('auth_info');

            if (!hasStoredSession) {
                client.setIsLoggedIn(false);
            }
        }
    }, [accountList, activeAccount, activeLoginid, client, isAuthorized, isAuthorizing]);

    useEffect(() => {
        initFormErrorMessages(FORM_ERROR_MESSAGES());

        return () => {
            if (timeInterval.current) {
                clearInterval(timeInterval.current);
            }
        };
    }, []);

    useEffect(() => {
        if (common && currentLang) {
            common.setCurrentLanguage(currentLang);
        }
    }, [currentLang, common]);

    // Type-safe interface for API with time() method
    interface ApiWithTime {
        time(): Promise<TSocketResponseData<'time'>>;
    }

    useEffect(() => {
        const updateServerTime = () => {
            // Fixed type safety: replaced 'as any' with proper interface and runtime check
            // Ensures time() method exists before calling it
            if (api_base.api && 'time' in api_base.api) {
                (api_base.api as ApiWithTime)
                    .time()
                    .then((res: TSocketResponseData<'time'>) => {
                        common.setServerTime(toMoment(res.time), false);
                    })
                    .catch(() => {
                        common.setServerTime(toMoment(Date.now()), true);
                    });
            }

            // Periodic balance refresh fallback (ensures balance never gets stuck or delayed)
            if (isAuthorized && !isAuthorizing && api_base?.is_authorized) {
                api_base.refreshBalance?.().catch(() => {});
                api_base.ensureAuthSubscriptions?.().catch(() => {});
            }
        };

        // Clear any existing interval before setting up a new one
        if (timeInterval.current) {
            clearInterval(timeInterval.current);
            timeInterval.current = null;
        }

        if (client && !appInitialization.current) {
            if (!api_base?.api) return;
            appInitialization.current = true;

            // Initial time update
            updateServerTime();

            // Schedule updates every 10 seconds
            timeInterval.current = setInterval(updateServerTime, 10000);
        }

        // Cleanup on unmount or dependency change
        return () => {
            if (timeInterval.current) {
                clearInterval(timeInterval.current);
                timeInterval.current = null;
            }
        };
    }, [client, common, isAuthorized, isAuthorizing]);

    const handleMessages = useCallback(
        // Changed parameter type from Record<string, unknown> to unknown to match onMessage signature
        async (res: unknown) => {
            if (!res) return;
            const data = (res as Record<string, unknown>).data as Record<string, any>;
            const { msg_type, error } = data || {};

            // Handle auth errors by attempting refresh first, preventing accidental logouts
            if (error?.code === 'DisabledClient' || (error?.code === 'InvalidToken' && msg_type === 'authorize')) {
                try {
                    const { OAuthTokenExchangeService } = await import('@/services/oauth-token-exchange.service');
                    const authInfo = OAuthTokenExchangeService.getAuthInfo({ allowExpiredWithRefresh: true });
                    if (authInfo?.refresh_token) {
                        const refreshed = await OAuthTokenExchangeService.refreshAccessToken(authInfo.refresh_token);
                        if (refreshed.access_token) {
                            client?.checkAndRegenerateWebSocket();
                            return;
                        }
                    }
                } catch {}

                // Clear all URL query parameters for these auth errors
                clearInvalidTokenParams();

                const isInIframe = typeof window !== 'undefined' && window.self !== window.top;
                if (isInIframe) {
                    // Inside an iframe: avoid disruptive full-window redirects
                    client?.setIsLoggedIn(false);
                } else if (client?.is_logged_in) {
                    await client?.logout();
                } else {
                    client?.setIsLoggedIn(false);
                }
            }

            if (msg_type === 'balance' && data && !error) {
                const balance = data.balance;
                if (balance && typeof balance.balance === 'number') {
                    const balanceLoginId = balance.loginid;
                    client.setBalance(balance.balance.toString(), balanceLoginId);

                    if (balance.currency && (!balanceLoginId || balanceLoginId === client.loginid)) {
                        client.setCurrency(balance.currency);
                    }
                }
            } else if (msg_type === 'transaction' && data && !error) {
                const tx = data.transaction;
                if (tx && typeof tx.balance === 'number') {
                    const txLoginId = tx.loginid || client.loginid;
                    client.setBalance(tx.balance.toString(), txLoginId);

                    if (tx.currency && (!txLoginId || txLoginId === client.loginid)) {
                        client.setCurrency(tx.currency);
                    }
                }
            } else if (msg_type === 'buy' && data && !error) {
                const buy = data.buy;
                if (buy && typeof buy.balance_after === 'number') {
                    client.setBalance(buy.balance_after.toString(), client.loginid);
                }
            } else if (msg_type === 'sell' && data && !error) {
                const sell = data.sell;
                if (sell && typeof sell.balance_after === 'number') {
                    client.setBalance(sell.balance_after.toString(), client.loginid);
                }
            } else if (msg_type === 'proposal_open_contract' && data && !error) {
                const poc = data.proposal_open_contract;
                if (poc && (poc.is_sold === 1 || poc.status === 'won' || poc.status === 'lost') && typeof poc.balance_after === 'number') {
                    client.setBalance(poc.balance_after.toString(), client.loginid);
                }
            }
        },
        // Fixed memory leak: removed handleLogout from deps as it's not used in function body
        // Only client is actually referenced (line 129), preventing unnecessary re-subscriptions
        [client]
    );

    useEffect(() => {
        if (!isAuthorizing && client) {
            const subscription = api_base?.api?.onMessage().subscribe(handleMessages);
            // Fixed unsubscribe type - only store if subscription exists
            if (subscription) {
                msg_listener.current = { unsubscribe: subscription.unsubscribe };
            }
        }

        return () => {
            if (msg_listener.current) {
                msg_listener.current.unsubscribe?.();
            }
        };
    }, [connectionStatus, handleMessages, isAuthorizing, isAuthorized, client]);

    useEffect(() => {
        if (!isAuthorizing && isAuthorized && !accountInitialization.current && client) {
            accountInitialization.current = true;
            const client_information: TClientInformation = {
                loginid: activeAccount?.loginid,
                email: '',
                currency: client?.currency,
                residence: '',
                first_name: '',
                last_name: '',
                preferred_language: '',
                user_id:
                    (api_base.account_info &&
                    typeof api_base.account_info === 'object' &&
                    'user_id' in api_base.account_info
                        ? (api_base.account_info as { user_id: number }).user_id
                        : null) || activeLoginid,
            };

            Cookies.set('client_information', JSON.stringify(client_information), {
                domain: currentDomain,
            });
        }
    }, [isAuthorizing, isAuthorized, client, activeAccount?.loginid, activeLoginid, currentDomain]);

    return <>{children}</>;
});

export default CoreStoreProvider;
