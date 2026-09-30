import { useCallback, useEffect, useState } from 'react';
import clsx from 'clsx';
import { observer } from 'mobx-react-lite';
import { generateOAuthURL } from '@/components/shared';
import Button from '@/components/shared_ui/button';
import useActiveAccount from '@/hooks/api/account/useActiveAccount';
import { useApiBase } from '@/hooks/useApiBase';
import { useLogout } from '@/hooks/useLogout';
import { useStore } from '@/hooks/useStore';
import { navigateToTransfer } from '@/utils/transfer-utils';
import { Localize } from '@deriv-com/translations';
import { Header, useDevice, Wrapper } from '@deriv-com/ui';
import { AppLogo } from '../app-logo';
import AccountSwitcher from './account-switcher';
import MenuItems from './menu-items';
import MobileMenu from './mobile-menu';
import './header.scss';

// ─────────────────────────────────────────────────────────────────────────────
// Currency Dropdown  (USD / KES)
// ─────────────────────────────────────────────────────────────────────────────
const CurrencyDropdown = () => {
    const [currency, setCurrency] = useState<'USD' | 'KES'>(() => {
        return (localStorage.getItem('converter_display_currency') as 'USD' | 'KES') || 'USD';
    });

    const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
        const next = e.target.value as 'USD' | 'KES';
        localStorage.setItem('converter_display_currency', next);
        setCurrency(next);
        window.dispatchEvent(new Event('currency_changed'));
    };

    // Sync across tabs / other components
    useEffect(() => {
        const handleSync = () => {
            setCurrency((localStorage.getItem('converter_display_currency') as 'USD' | 'KES') || 'USD');
        };
        window.addEventListener('currency_changed', handleSync);
        return () => window.removeEventListener('currency_changed', handleSync);
    }, []);

    // Fetch live KES rate once on mount
    useEffect(() => {
        const fetchRate = () => {
            fetch('https://open.er-api.com/v6/latest/USD')
                .then(res => res.json())
                .then(data => {
                    if (data?.rates?.KES) {
                        localStorage.setItem('converter_kes_rate', String(data.rates.KES));
                        window.dispatchEvent(new Event('currency_changed'));
                    }
                })
                .catch(err => console.warn('Failed to fetch KES rate:', err));
        };
        fetchRate();
    }, []);

    return (
        <div className='currency-dropdown'>
            <select
                id='currency-select'
                className='currency-dropdown__select'
                value={currency}
                onChange={handleChange}
                title='Select display currency (USD / KES)'
            >
                <option value='USD'>USD</option>
                <option value='KES'>KES</option>
            </select>
        </div>
    );
};

// ─────────────────────────────────────────────────────────────────────────────
// Header Speed Toggle (Desktop: ⚡ Fast Switch | Mobile: ⚡ Icon Alone)
// ─────────────────────────────────────────────────────────────────────────────
const HeaderSpeedToggle = observer(() => {
    const { run_panel } = useStore() ?? {};
    const { isDesktop } = useDevice();

    if (!run_panel) return null;

    const isActive = run_panel.is_every_tick_mode;

    return (
        <button
            type='button'
            id='header-speed-toggle'
            className={clsx('app-header__speed-toggle', {
                'app-header__speed-toggle--active': isActive,
                'app-header__speed-toggle--mobile': !isDesktop,
            })}
            title={
                isActive
                    ? 'FAST MODE ON — Instant purchase cycle, skips proposal negotiation (max speed)'
                    : 'NORMAL MODE — Proposal-based tick-paced trading (default). Click to enable Fast Mode.'
            }
            onClick={() => run_panel.toggleEveryTickMode()}
        >
            <span className='speed-toggle__icon'>⚡</span>
            {isDesktop && (
                <>
            <span className='speed-toggle__text'>{isActive ? 'FAST' : 'Normal'}</span>
                    <div className='speed-toggle__track'>
                        <div className='speed-toggle__thumb' />
                    </div>
                </>
            )}
        </button>
    );
});

// ─────────────────────────────────────────────────────────────────────────────
// Main AppHeader
// ─────────────────────────────────────────────────────────────────────────────
const AppHeader = observer(() => {
    const { isDesktop } = useDevice();
    const { isAuthorizing, activeLoginid, setIsAuthorizing, authData } = useApiBase();
    const { client } = useStore() ?? {};
    const [authTimeout, setAuthTimeout] = useState(false);
    const [isRefreshing, setIsRefreshing] = useState(false);
    const is_account_regenerating = client?.is_account_regenerating || false;

    const handleMobileRefresh = useCallback(() => {
        setIsRefreshing(true);
        setTimeout(() => {
            window.location.reload();
        }, 200);
    }, []);

    // Detect OAuth callback on mount (only pending if active code & state in URL)
    const [isOAuthPending, setIsOAuthPending] = useState(() => {
        const params = new URLSearchParams(window.location.search);
        return Boolean(params.get('code') && params.get('state'));
    });

    const { data: activeAccount } = useActiveAccount({
        allBalanceData: client?.all_accounts_balance,
        directBalance: client?.balance,
    });

    const handleLogout = useLogout();

    // Clear OAuth-pending flag once the account is set (auth succeeded) or timed out
    useEffect(() => {
        if (!isOAuthPending) return;
        if (activeLoginid) {
            setIsOAuthPending(false);
            return;
        }
        // Keep pending for up to 60s – PKCE exchange + WS auth can take several seconds
        const timer = setTimeout(() => setIsOAuthPending(false), 60_000);
        return () => clearTimeout(timer);
    }, [isOAuthPending, activeLoginid]);

    // Handle direct URL access with legacy token param
    useEffect(() => {
        const urlParams = new URLSearchParams(window.location.search);
        const account_id = urlParams.get('account_id');
        if (account_id) {
            setIsAuthorizing(true);
        }
    }, [setIsAuthorizing]);

    // Fallback timeout: only fire when no OAuth flow is in progress.
    // The timeout is intentionally long (15s) to accommodate slow network conditions.
    useEffect(() => {
        // Never apply the timeout while an OAuth callback is being processed
        if (isOAuthPending) return;

        const timer = setTimeout(() => {
            if (isAuthorizing && !activeLoginid) {
                // Double-check that a verifier hasn't appeared (race between mount and token exchange)
                const hasVerifier =
                    !!sessionStorage.getItem('oauth_code_verifier') ||
                    !!localStorage.getItem('oauth_code_verifier');
                if (hasVerifier) return; // Still in PKCE flow, do not timeout
                setAuthTimeout(true);
                setIsAuthorizing(false);
            }
        }, 15_000);

        if (activeLoginid || !isAuthorizing) {
            if (authTimeout) setAuthTimeout(false);
            clearTimeout(timer);
        }

        return () => clearTimeout(timer);
    }, [isAuthorizing, activeLoginid, setIsAuthorizing, authTimeout, isOAuthPending]);

    const handleSignup = useCallback(() => {
        window.location.assign('https://t.deriv.link?t=HFJ29NBD7CHV');
    }, []);

    const handleLogin = useCallback(async () => {
        try {
            setIsAuthorizing(true);
            const oauthUrl = await generateOAuthURL();
            if (oauthUrl) {
                window.location.replace(oauthUrl);
            } else {
                console.error('Failed to generate OAuth URL');
                setIsAuthorizing(false);
            }
        } catch (error) {
            console.error('Login redirection failed:', error);
            setIsAuthorizing(false);
        }
    }, [setIsAuthorizing]);

    const handleTransfer = useCallback(() => {
        const transferCurrency = authData?.currency;
        if (!transferCurrency) {
            console.error('No currency available for transfer');
            return;
        }
        navigateToTransfer(transferCurrency);
    }, [authData?.currency]);

    const renderAccountSection = useCallback(
        (position: 'left' | 'right' = 'right') => {
            // Show account switcher and logout when user is fully authenticated
            if (activeLoginid && !is_account_regenerating) {
                if (position === 'left' && !isDesktop) {
                    return (
                        <div className='auth-actions'>
                            <div className='account-info'>
                                <AccountSwitcher activeAccount={activeAccount} />
                            </div>
                        </div>
                    );
                } else if (position === 'right') {
                    return (
                        <div className='auth-actions'>
                            {isDesktop && (
                                <div className='account-info'>
                                    <AccountSwitcher activeAccount={activeAccount} />
                                </div>
                            )}
                            <Button
                                primary
                                className='app-header__transfer-btn'
                                disabled={client?.is_logging_out || !authData?.currency}
                                onClick={handleTransfer}
                            >
                                {isDesktop ? (
                                    <Localize i18n_default_text='Transfer' />
                                ) : (
                                    <svg
                                        width='16'
                                        height='16'
                                        viewBox='0 0 24 24'
                                        fill='none'
                                        stroke='currentColor'
                                        strokeWidth='2'
                                        strokeLinecap='round'
                                        strokeLinejoin='round'
                                    >
                                        <path d='M17 1l4 4-4 4' />
                                        <path d='M3 11V9a4 4 0 014-4h14' />
                                        <path d='M7 23l-4-4 4-4' />
                                        <path d='M21 13v2a4 4 0 01-4 4H3' />
                                    </svg>
                                )}
                            </Button>
                        </div>
                    );
                }
            }
            // Show login button only when not logged in (and not actively exchanging an OAuth code)
            else if (position === 'right' && !isOAuthPending && !activeLoginid) {
                return (
                    <div className='auth-actions'>
                        <Button tertiary className='app-header__login-btn modern-login-btn' onClick={handleLogin}>
                            <Localize i18n_default_text='Log in' />
                        </Button>
                        <a
                            id='btn__signup'
                            href='https://t.deriv.link?t=HFJ29NBD7CHV'
                            className='dc-btn dc-btn--primary__light app-header__signup-btn modern-signup-btn'
                            style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
                            onClick={() => {
                                window.location.href = 'https://t.deriv.link?t=HFJ29NBD7CHV';
                            }}
                        >
                            <span className='dc-btn__text'>
                                <Localize i18n_default_text='Sign up' />
                            </span>
                        </a>
                    </div>
                );
            }
            // Default: spinner during loading
            else if (position === 'right') {
                return (
                    <div className='auth-actions auth-actions--loading'>
                        <svg
                            className='auth-actions__spinner'
                            viewBox='0 0 24 24'
                            fill='none'
                            xmlns='http://www.w3.org/2000/svg'
                        >
                            <circle
                                cx='12'
                                cy='12'
                                r='10'
                                stroke='currentColor'
                                strokeWidth='2.5'
                                strokeLinecap='round'
                                strokeDasharray='31.416'
                                strokeDashoffset='10'
                            />
                        </svg>
                    </div>
                );
            }

            return null;
        },
        [
            isAuthorizing,
            isDesktop,
            activeLoginid,
            client,
            activeAccount,
            authTimeout,
            is_account_regenerating,
            isOAuthPending,
            authData,
            handleLogin,
            handleSignup,
            handleTransfer,
        ]
    );

    if (client?.should_hide_header) return null;

    return (
        <>
            <Header
                className={clsx('app-header', {
                    'app-header--desktop': isDesktop,
                    'app-header--mobile': !isDesktop,
                })}
            >
                <Wrapper variant='left'>
                    <MobileMenu onLogout={handleLogout} />
                    <AppLogo />
                    {isDesktop ? <MenuItems /> : renderAccountSection('left')}

                </Wrapper>
                <Wrapper variant='right'>
                    <div style={{ display: 'flex', alignItems: 'center', gap: isDesktop ? '8px' : '4px', paddingRight: isDesktop ? '1.6rem' : '0.4rem' }}>
                        <HeaderSpeedToggle />
                        <button
                            type='button'
                            id='header-legacy-statement-btn'
                            className='app-header__legacy-btn'
                            title='Options Trading (Legacy) Statement — Access previous trade history before system upgrade'
                            aria-label='Options Trading (Legacy) Statement'
                            onClick={() => window.dispatchEvent(new Event('open_legacy_statement'))}
                        >
                            <span className='legacy-btn__icon'>
                                <svg width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2.2' strokeLinecap='round' strokeLinejoin='round'>
                                    <ellipse cx='12' cy='5' rx='9' ry='3' />
                                    <path d='M21 12c0 1.66-4 3-9 3s-9-1.34-9-3' />
                                    <path d='M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5' />
                                </svg>
                            </span>
                            {isDesktop && <span className='legacy-btn__text'>Legacy Data</span>}
                            {isDesktop && <span className='legacy-btn__badge'>REST</span>}
                        </button>
                        {isDesktop && (
                            <button
                                type='button'
                                id='header-risk-disclaimer-btn'
                                className='app-header__risk-btn'
                                title='Risk Disclaimer & Regulatory Warning'
                                aria-label='Risk Disclaimer & Regulatory Warning'
                                onClick={() => window.dispatchEvent(new Event('open_risk_disclaimer'))}
                            >
                                <svg viewBox='0 0 24 24' width='14' height='14' fill='none' stroke='currentColor' strokeWidth='2' strokeLinecap='round' strokeLinejoin='round'>
                                    <path d='M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z' />
                                    <line x1='12' y1='8' x2='12' y2='12' />
                                    <line x1='12' y1='16' x2='12.01' y2='16' />
                                </svg>
                            </button>
                        )}
                        {!isDesktop && (
                            <button
                                type='button'
                                className={clsx('app-header__mobile-refresh-btn', {
                                    'app-header__mobile-refresh-btn--spinning': isRefreshing,
                                })}
                                onClick={handleMobileRefresh}
                                title='Refresh Application'
                                aria-label='Refresh Application'
                            >
                                <svg
                                    width='16'
                                    height='16'
                                    viewBox='0 0 24 24'
                                    fill='none'
                                    stroke='currentColor'
                                    strokeWidth='2.2'
                                    strokeLinecap='round'
                                    strokeLinejoin='round'
                                >
                                    <path d='M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67' />
                                </svg>
                            </button>
                        )}
                        {/* Currency dropdown — only when logged in */}
                        {activeLoginid && <CurrencyDropdown />}
                        {renderAccountSection('right')}
                    </div>
                </Wrapper>
            </Header>
        </>
    );
});

export default AppHeader;
