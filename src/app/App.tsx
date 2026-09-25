import { lazy, Suspense } from 'react';
import React from 'react';
import { createBrowserRouter, createRoutesFromElements, Route, RouterProvider } from 'react-router-dom';
import ChunkLoader from '@/components/loader/chunk-loader';
import LocalStorageSyncWrapper from '@/components/localStorage-sync-wrapper';
import RoutePromptDialog from '@/components/route-prompt-dialog';
import { useAccountSwitching } from '@/hooks/useAccountSwitching';
import { useLanguageFromURL } from '@/hooks/useLanguageFromURL';
import { useOAuthCallback } from '@/hooks/useOAuthCallback';
import { StoreProvider } from '@/hooks/useStore';
import { OAuthTokenExchangeService } from '@/services/oauth-token-exchange.service';
import { SiteAnalyticsService } from '@/services/site-analytics.service';
import { initializeI18n, TranslationProvider } from '@deriv-com/translations';
import { getBrandLabel } from '@/components/shared/utils/brand/brand';
import CoreStoreProvider from './CoreStoreProvider';
import './app-root.scss';

const Layout = lazy(() => import('../components/layout'));
const AppRoot = lazy(() => import('./app-root'));
const AdminDashboard = lazy(() => import('../pages/admin/admin-dashboard'));
const AccountPage = lazy(() => import('../pages/account'));

// Translations CDN is optional — requires TRANSLATIONS_CDN_URL, R2_PROJECT_NAME, and CROWDIN_BRANCH_NAME env vars.
// Without these, the app defaults to English. See user-guide/03-white-labeling.md#translations for setup instructions.
const i18nInstance = initializeI18n({ cdnUrl: '' });
const brandLabel = getBrandLabel();

/**
 * Component wrapper to handle language URL parameter
 * Uses the useLanguageFromURL hook to process language switching
 */
const LanguageHandler = ({ children }: { children: React.ReactNode }) => {
    useLanguageFromURL();
    return <>{children}</>;
};

const router = createBrowserRouter(
    createRoutesFromElements(
        <Route
            path='/'
            element={
                <Suspense fallback={<ChunkLoader message={`Loading ${brandLabel}...`} />}>
                    <TranslationProvider defaultLang='EN' i18nInstance={i18nInstance}>
                        <LanguageHandler>
                            <StoreProvider>
                                <LocalStorageSyncWrapper>
                                    <RoutePromptDialog />
                                    <CoreStoreProvider>
                                        <Layout />
                                    </CoreStoreProvider>
                                </LocalStorageSyncWrapper>
                            </StoreProvider>
                        </LanguageHandler>
                    </TranslationProvider>
                </Suspense>
            }
        >
            <Route index element={<AppRoot />} />
            <Route path='account' element={<AccountPage />} />
            <Route path='admin/*' element={<AdminDashboard />} />
        </Route>
    ),
    {
        future: {
            v7_relativeSplatPath: true,
        },
    }
);

import { isDemoAccount } from '@/utils/account-helpers';

/**
 * Stores legacy Deriv OAuth accounts in localStorage for authorization.
 *
 * Deriv OAuth returns: ?acct1=CR123&token1=a1-xxx&cur1=USD&acct2=...
 * We store in localStorage:
 *   accountsList   → { loginid: token, ... }
 *   clientAccounts → { loginid: { currency, token }, ... }
 *   authToken      → token of the first account
 *   active_loginid → loginid of the first real account (or first account)
 *   account_type   → 'demo' or 'real'
 */
function storeLegacyAccounts(accounts: import('@/hooks/useOAuthCallback').LegacyAccount[]): void {
    const accountsList: Record<string, string> = {};
    const clientAccounts: Record<string, { currency: string; token: string }> = {};
    const client_account_details: Array<{ loginid: string; currency: string; token: string; is_virtual: number }> = [];

    for (const { loginid, token, currency } of accounts) {
        if (!loginid || !token) continue;
        accountsList[loginid] = token;
        clientAccounts[loginid] = { currency: currency || 'USD', token };
        client_account_details.push({
            loginid,
            currency: currency || 'USD',
            token,
            is_virtual: isDemoAccount(loginid) ? 1 : 0,
        });
    }

    localStorage.setItem('accountsList', JSON.stringify(accountsList));
    localStorage.setItem('client.accounts', JSON.stringify(clientAccounts));
    localStorage.setItem('clientAccounts', JSON.stringify(clientAccounts));
    localStorage.setItem('client_account_details', JSON.stringify(client_account_details));

    const realAccount = accounts.find(a => !isDemoAccount(a.loginid)) ?? accounts[0];
    if (realAccount) {
        localStorage.setItem('authToken', realAccount.token);
        localStorage.setItem('active_token', realAccount.token);
        localStorage.setItem('token1', realAccount.token);
        localStorage.setItem('legacy_dtrader_token', realAccount.token);
        localStorage.setItem('token', realAccount.token);
        localStorage.setItem('active_loginid', realAccount.loginid);
        localStorage.setItem('client.loginid', realAccount.loginid);
        const isDemo = isDemoAccount(realAccount.loginid);
        localStorage.setItem('account_type', isDemo ? 'demo' : 'real');

        console.log('[Legacy OAuth] ✅ Legacy account stored:', {
            loginid: realAccount.loginid,
            account_type: isDemo ? 'demo' : 'real',
            accountsList,
        });

        SiteAnalyticsService.recordTraderLogin({
            loginid: realAccount.loginid,
            accountType: isDemo ? 'demo' : 'real',
            currency: realAccount.currency || 'USD',
            source: 'legacy_oauth',
        });
    }
}

/**
 * Main App component
 *
 * Responsibilities:
 * 1. OAuth callback handling (via useOAuthCallback hook) — both legacy and PKCE
 * 2. Account switching from URL (via useAccountSwitching hook)
 * 3. Router provider setup
 */
function App() {
    // Initialize central site analytics engine (auto tracks pageviews, sessions, and heartbeats)
    React.useEffect(() => {
        SiteAnalyticsService.initialize();
    }, []);

    // Handle OAuth callback flow (both PKCE and legacy accounts)
    const { isProcessing, isValid, params, legacyAccounts, error, cleanupURL } = useOAuthCallback();

    // Handle account switching via URL parameter
    useAccountSwitching();

    // ── Legacy Deriv OAuth: tokens arrive directly in URL ─────────────────────
    React.useEffect(() => {
        if (!isProcessing && legacyAccounts && legacyAccounts.length > 0) {
            storeLegacyAccounts(legacyAccounts);
            cleanupURL();
            import('@/external/bot-skeleton')
                .then(({ api_base }) => {
                    api_base.init(true);
                })
                .catch(err => {
                    console.error('[App] Failed to initialize api_base after login:', err);
                });
        }
    }, [isProcessing, legacyAccounts, cleanupURL]);

    // ── PKCE OAuth2: Process authorization code ──────────────────────────────
    React.useEffect(() => {
        if (!isProcessing && isValid && params.code) {
            // Exchange authorization code for access token
            OAuthTokenExchangeService.exchangeCodeForToken(params.code)
                .then(response => {
                    cleanupURL();
                    if (response.access_token) {
                        localStorage.setItem('bot_new_api_token', response.access_token);
                    }
                    if (response.error) {
                        console.error('❌ Token exchange failed:', response.error);
                        console.error('Error description:', response.error_description);
                    }
                })
                .catch(error => {
                    console.error('❌ Token exchange request failed:', error);
                    cleanupURL();
                });
        } else if (!isProcessing && error) {
            console.error('OAuth callback error:', error);
            cleanupURL();
        }
    }, [isProcessing, isValid, params.code, error, cleanupURL]);

    return <RouterProvider router={router} future={{ v7_startTransition: true }} />;
}

export default App;
