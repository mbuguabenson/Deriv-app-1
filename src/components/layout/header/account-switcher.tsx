import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactDOM from 'react-dom';

import classNames from 'classnames';
import { observer } from 'mobx-react-lite';
import { addComma, getCurrencyDisplayCode, getDecimalPlaces } from '@/components/shared';
import { api_base } from '@/external/bot-skeleton/services/api/api-base';
import { useApiBase } from '@/hooks/useApiBase';
import { useStore } from '@/hooks/useStore';
import { isDemoAccount } from '@/utils/account-helpers';
import { Localize, localize } from '@deriv-com/translations';
import { useDevice } from '@deriv-com/ui';
import { DerivAccountWalletService } from '@/services/deriv-account-wallet.service';
import { DerivWSAccountsService } from '@/services/derivws-accounts.service';
import { AccountSwitcherService } from '@/services/account-switcher.service';
import { getAccountsList } from '@/utils/token-bridge';
import { CurrencyIcon } from '@/components/currency/currency-icon';
import { TAccountSwitcher } from './common/types';
import AccountInfoWrapper from './account-info-wrapper';
import './account-switcher.scss';

const getCurrencyLabel = (currency: string): string => {
    const labels: Record<string, string> = {
        USD: 'US Dollar',
        EUR: 'Euro',
        GBP: 'British Pound',
        AUD: 'Australian Dollar',
        CAD: 'Canadian Dollar',
        KES: 'Kenyan Shilling',
        NGN: 'Nigerian Naira',
        ZAR: 'South African Rand',
        GHS: 'Ghanaian Cedi',
    };
    return labels[currency] || currency;
};

// ─── 3D Glass Icon for Real Accounts ─────────────────────────────────────────
export const RealAccount3DGlassIcon = ({ currency = 'USD' }: { currency?: string }) => {
    const curr = currency?.toUpperCase() || 'USD';
    const symbol = curr === 'USD' ? '$' : curr === 'EUR' ? '€' : curr === 'GBP' ? '£' : curr === 'KES' ? 'K' : curr.slice(0, 1);

    return (
        <svg
            viewBox='0 0 40 40'
            fill='none'
            xmlns='http://www.w3.org/2000/svg'
            className='acc-icon-3d-glass'
            width='26'
            height='26'
        >
            <defs>
                <radialGradient id='glass3dBase' cx='35%' cy='30%' r='70%'>
                    <stop offset='0%' stopColor='#00f5ff' stopOpacity='0.95' />
                    <stop offset='45%' stopColor='#0284c7' stopOpacity='0.85' />
                    <stop offset='85%' stopColor='#0369a1' stopOpacity='0.95' />
                    <stop offset='100%' stopColor='#082f49' stopOpacity='1' />
                </radialGradient>
                <linearGradient id='glass3dRim' x1='0%' y1='0%' x2='100%' y2='100%'>
                    <stop offset='0%' stopColor='#ffffff' stopOpacity='0.95' />
                    <stop offset='40%' stopColor='#00F5FF' stopOpacity='0.85' />
                    <stop offset='80%' stopColor='#7000FF' stopOpacity='0.55' />
                    <stop offset='100%' stopColor='#00FF88' stopOpacity='0.95' />
                </linearGradient>
                <linearGradient id='glass3dHighlight' x1='0%' y1='0%' x2='100%' y2='50%'>
                    <stop offset='0%' stopColor='#ffffff' stopOpacity='0.75' />
                    <stop offset='100%' stopColor='#ffffff' stopOpacity='0' />
                </linearGradient>
                <filter id='glass3dGlow' x='-20%' y='-20%' width='140%' height='140%'>
                    <feDropShadow dx='0' dy='2' stdDeviation='2.5' floodColor='#00F5FF' floodOpacity='0.45' />
                </filter>
            </defs>

            <g filter='url(#glass3dGlow)'>
                {/* 3D Outer Glass Rim */}
                <circle cx='20' cy='20' r='18' fill='url(#glass3dBase)' stroke='url(#glass3dRim)' strokeWidth='1.6' />

                {/* Inner Bevel Ring */}
                <circle cx='20' cy='20' r='15.5' stroke='rgba(255, 255, 255, 0.3)' strokeWidth='0.8' />

                {/* Specular Glass Arc */}
                <path
                    d='M7 17 C8 10 14 6 20 6 C26 6 32 10 33 17 C28 14 12 14 7 17 Z'
                    fill='url(#glass3dHighlight)'
                />

                {/* 3D Center Currency Symbol */}
                <text
                    x='20'
                    y='25'
                    textAnchor='middle'
                    fill='#ffffff'
                    fontSize='13'
                    fontWeight='900'
                    fontFamily="'JetBrains Mono', 'Plus Jakarta Sans', sans-serif"
                    letterSpacing='-0.5px'
                    filter='drop-shadow(0 1px 2px rgba(0,0,0,0.6))'
                >
                    {symbol}
                </text>

                {/* Diamond Sparkle Highlight */}
                <circle cx='11' cy='11' r='1.2' fill='#ffffff' />
            </g>
        </svg>
    );
};

// ─── Account Avatar with 3D Glass Real Account Support ───────────────────────
const AccountAvatar = ({ currency, isVirtual }: { currency?: string; isVirtual?: boolean }) => (
    <div
        className={classNames('acc-icon', {
            'acc-icon--demo': isVirtual,
            'acc-icon--real': !isVirtual,
        })}
    >
        {isVirtual ? (
            <CurrencyIcon currency={currency || 'usd'} isVirtual={false} />
        ) : (
            <RealAccount3DGlassIcon currency={currency} />
        )}
    </div>
);

// ─── Main Component ───────────────────────────────────────────────────────────
const AccountSwitcher = observer(({ activeAccount, forceDropdown = false }: TAccountSwitcher & { forceDropdown?: boolean }) => {
    const { isDesktop } = useDevice();
    const isMobile = !isDesktop || (typeof window !== 'undefined' && window.innerWidth <= 768);
    const [isOpen, setIsOpen] = useState(forceDropdown);
    const [activeTab, setActiveTab] = useState<'real' | 'demo'>('real');
    const [userNickname, setUserNickname] = useState<string>('');
    const wrapperRef = useRef<HTMLDivElement>(null);
    const { accountList, activeLoginid } = useApiBase();
    const { client, run_panel } = useStore() ?? {};

    const [displayCurrency, setDisplayCurrency] = useState<'USD' | 'KES'>(() => {
        return (localStorage.getItem('converter_display_currency') as 'USD' | 'KES') || 'USD';
    });
    const [rate, setRate] = useState<number>(() => {
        return parseFloat(localStorage.getItem('converter_kes_rate') || '129.5');
    });

    // Reset balance state
    const [isResettingBalance, setIsResettingBalance] = useState(false);
    const [resetMessage, setResetMessage] = useState<{ type: 'success' | 'error' | 'info'; text: string } | null>(null);

    // Balance visibility state
    const [isBalanceVisible, setIsBalanceVisible] = useState(() => {
        return localStorage.getItem('is_balance_visible') !== 'false';
    });

    // Account switching state (shows loader while initializing new account balance)
    const [isSwitchingAccount, setIsSwitchingAccount] = useState(false);

    useEffect(() => {
        const handleStart = () => setIsSwitchingAccount(true);
        const handleEnd = () => setIsSwitchingAccount(false);
        window.addEventListener('account_switching_start', handleStart);
        window.addEventListener('account_switching_end', handleEnd);
        window.addEventListener('account_switched', handleEnd);
        return () => {
            window.removeEventListener('account_switching_start', handleStart);
            window.removeEventListener('account_switching_end', handleEnd);
            window.removeEventListener('account_switched', handleEnd);
        };
    }, []);

    const toggleBalanceVisibility = useCallback((e: React.MouseEvent) => {
        e.stopPropagation();
        setIsBalanceVisible(prev => {
            const next = !prev;
            localStorage.setItem('is_balance_visible', String(next));
            return next;
        });
    }, []);

    useEffect(() => {
        const handleSync = () => {
            setDisplayCurrency((localStorage.getItem('converter_display_currency') as 'USD' | 'KES') || 'USD');
            setRate(parseFloat(localStorage.getItem('converter_kes_rate') || '129.5'));
        };
        window.addEventListener('currency_changed', handleSync);
        return () => window.removeEventListener('currency_changed', handleSync);
    }, []);

    useEffect(() => {
        let isMounted = true;
        DerivAccountWalletService.getAccountNickname()
            .then(nick => {
                if (isMounted && nick) setUserNickname(nick);
            })
            .catch(() => {});

        return () => {
            isMounted = false;
        };
    }, [isOpen]);

    const is_bot_running = Boolean(run_panel?.is_running || (api_base as any)?.is_running);

    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (isMobile) return;
            if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
                setIsOpen(false);
            }
        };
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') setIsOpen(false);
        };
        document.addEventListener('mousedown', handleClickOutside);
        document.addEventListener('keydown', handleKeyDown);
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
            document.removeEventListener('keydown', handleKeyDown);
        };
    }, [isMobile]);

    // ─── Format accounts list ────────────────────────────────────────────────
    const formattedAccounts = useMemo(() => {
        const accountsMap: Record<
            string,
            {
                loginid: string;
                currency: string;
                balance: string | number;
                is_virtual: number;
                token?: string;
            }
        > = {};

        // 1. Merge from accountList observable
        if (Array.isArray(accountList)) {
            accountList.forEach(a => {
                if (a.loginid) {
                    accountsMap[a.loginid] = {
                        loginid: a.loginid,
                        currency: a.currency || 'USD',
                        balance: a.balance ?? 0,
                        is_virtual: a.is_virtual !== undefined ? a.is_virtual : isDemoAccount(a.loginid) ? 1 : 0,
                    };
                }
            });
        }

        // 2. Merge from MobX client.account_list
        if (client?.account_list && Array.isArray(client.account_list)) {
            client.account_list.forEach((a: any) => {
                if (a.loginid) {
                    accountsMap[a.loginid] = {
                        ...accountsMap[a.loginid],
                        loginid: a.loginid,
                        currency: a.currency || accountsMap[a.loginid]?.currency || 'USD',
                        balance: a.balance ?? accountsMap[a.loginid]?.balance ?? 0,
                        is_virtual: a.is_virtual !== undefined ? a.is_virtual : isDemoAccount(a.loginid) ? 1 : 0,
                    };
                }
            });
        }

        // 3. Merge from localStorage client.accounts or clientAccounts
        try {
            const rawStored = localStorage.getItem('client.accounts') || localStorage.getItem('clientAccounts');
            if (rawStored) {
                const parsed = JSON.parse(rawStored);
                if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                    Object.keys(parsed).forEach(id => {
                        const acc = parsed[id];
                        accountsMap[id] = {
                            loginid: id,
                            currency: acc?.currency || accountsMap[id]?.currency || 'USD',
                            balance: acc?.balance ?? accountsMap[id]?.balance ?? 0,
                            is_virtual: isDemoAccount(id) ? 1 : 0,
                            token: acc?.token,
                        };
                    });
                }
            }
        } catch {
            // Ignore parse errors from stale localStorage cache
        }

        // 4. Merge from client_account_details
        try {
            const rawDetails = localStorage.getItem('client_account_details');
            if (rawDetails) {
                const parsedDetails = JSON.parse(rawDetails);
                if (Array.isArray(parsedDetails)) {
                    parsedDetails.forEach((a: any) => {
                        const id = a?.loginid || a?.account_id;
                        if (id) {
                            accountsMap[id] = {
                                ...accountsMap[id],
                                loginid: id,
                                currency: a.currency || accountsMap[id]?.currency || 'USD',
                                balance: a.balance ?? accountsMap[id]?.balance ?? 0,
                                is_virtual: a.is_virtual !== undefined ? a.is_virtual : isDemoAccount(id) ? 1 : 0,
                            };
                        }
                    });
                }
            }
        } catch {
            // Ignore parse errors from stale localStorage cache
        }

        // 5. Merge from tokens list
        const tokensList = getAccountsList() || {};
        Object.keys(tokensList).forEach(id => {
            if (!accountsMap[id]) {
                accountsMap[id] = {
                    loginid: id,
                    currency: 'USD',
                    balance: 0,
                    is_virtual: isDemoAccount(id) ? 1 : 0,
                };
            }
        });

        // 6. Merge from durable OAuth stored accounts (DerivWSAccountsService)
        try {
            const derivAccounts = DerivWSAccountsService.getStoredAccounts();
            if (Array.isArray(derivAccounts)) {
                derivAccounts.forEach(acc => {
                    const id = acc.account_id;
                    if (id) {
                        const isVirt = acc.account_type === 'demo' || isDemoAccount(id);
                        accountsMap[id] = {
                            ...accountsMap[id],
                            loginid: id,
                            currency: acc.currency || accountsMap[id]?.currency || 'USD',
                            balance: accountsMap[id]?.balance ?? acc.balance ?? 0,
                            is_virtual: isVirt ? 1 : 0,
                        };
                    }
                });
            }
        } catch {
            // Ignore parse errors from stale localStorage cache
        }

        const activeId = activeLoginid || localStorage.getItem('active_loginid') || client?.loginid || '';

        // Merge live balance from client store directly into active account if available
        if (activeId && client?.balance !== undefined && client?.balance !== null && accountsMap[activeId]) {
            const parsedLiveBal = parseFloat(client.balance);
            if (!isNaN(parsedLiveBal)) {
                accountsMap[activeId].balance = parsedLiveBal;
            }
        }

        return Object.values(accountsMap)
            .map(account => {
                const accCurr = account.currency || 'USD';
                const balanceNum = Number(account.balance ?? 0);
                const displayBal =
                    displayCurrency === 'KES' && accCurr === 'USD'
                        ? new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(
                              balanceNum * rate
                          )
                        : addComma(balanceNum.toFixed(getDecimalPlaces(accCurr)));
                const displayCurr =
                    displayCurrency === 'KES' && accCurr === 'USD' ? 'KES' : getCurrencyDisplayCode(accCurr);

                return {
                    loginid: account.loginid,
                    currency: account.currency ? displayCurr : '',
                    rawCurrency: accCurr,
                    balance: displayBal,
                    isVirtual: isDemoAccount(account.loginid),
                    isActive: account.loginid === activeId,
                };
            })
            .sort((a, b) => (a.isActive ? -1 : b.isActive ? 1 : 0));
    }, [accountList, client?.account_list, client?.loginid, client?.balance, activeLoginid, displayCurrency, rate]);

    const toggleDropdown = useCallback(() => {
        if (is_bot_running) return;
        setIsOpen(prev => !prev);
    }, [is_bot_running]);

    const handleAccountSelect = useCallback(
        async (loginid: string) => {
            console.log('[AccountSwitcher] Switching to account:', loginid);
            setIsOpen(false);
            const target = formattedAccounts.find(a => a.loginid === loginid);
            try {
                await AccountSwitcherService.switchAccount(loginid, client, {
                    balance: target?.balance,
                    currency: target?.currency,
                });
            } catch (err) {
                console.error('[AccountSwitcher] Error switching account:', err);
            }
        },
        [client, formattedAccounts]
    );

    // Reset demo balance handler
    const handleResetBalance = useCallback(
        async (e: React.MouseEvent) => {
            e.stopPropagation();
            if (isResettingBalance) return;

            setIsResettingBalance(true);
            setResetMessage(null);

            let success = false;
            let errorMessage = '';

            try {
                const { OAuthTokenExchangeService } = await import('@/services/oauth-token-exchange.service');
                const { getAppId } = await import('@/components/shared/utils/config/config');

                // Method 1: Deriv Options REST API (Official Reset Demo Balance)
                const authInfo = OAuthTokenExchangeService.getAuthInfo();
                const appId = getAppId() || '121856';
                const currentLoginId = activeLoginid || localStorage.getItem('active_loginid') || client?.loginid;

                if (authInfo?.access_token && currentLoginId) {
                    try {
                        const res = await fetch(
                            `https://api.derivws.com/trading/v1/options/accounts/${encodeURIComponent(currentLoginId)}/reset-demo-balance`,
                            {
                                method: 'POST',
                                headers: {
                                    Authorization: `Bearer ${authInfo.access_token}`,
                                    'Content-Type': 'application/json',
                                    'X-App-Id': appId,
                                } as any,
                                body: JSON.stringify({ amount: 10000 }),
                            }
                        );

                        if (res.ok) {
                            const data = await res.json().catch(() => null);
                            const newBalance = data?.balance ?? data?.data?.balance ?? 10000;
                            if (client?.setBalance) {
                                client.setBalance(String(newBalance));
                            }
                            success = true;
                        } else {
                            const errData = await res.json().catch(() => null);
                            errorMessage = errData?.error?.message || `Server returned ${res.status}`;
                        }
                    } catch (restErr: any) {
                        console.warn('[AccountSwitcher] REST reset failed, trying WS fallback:', restErr?.message);
                    }
                }

                // Method 2: Direct Deriv WebSocket API Fallback (topup_virtual)
                if (!success) {
                    if (api_base.api) {
                        try {
                            const topupRes = await api_base.api.send({ topup_virtual: 1 });
                            if (topupRes?.topup_virtual) {
                                const newAmount = topupRes.topup_virtual.amount ?? 10000;
                                if (client?.setBalance) {
                                    client.setBalance(String(newAmount));
                                }
                                success = true;
                            } else if (topupRes?.error) {
                                errorMessage = topupRes.error.message || 'Topup request rejected';
                            }
                        } catch (wsErr: any) {
                            errorMessage = wsErr?.message || 'WebSocket topup failed';
                        }
                    }
                }

                if (success) {
                    setResetMessage({ type: 'success', text: localize('Demo balance reset to $10,000!') });
                    setTimeout(() => setResetMessage(null), 3500);
                } else {
                    setResetMessage({
                        type: 'error',
                        text:
                            errorMessage ||
                            localize('Could not reset demo balance. Only virtual accounts can be reset.'),
                    });
                    setTimeout(() => setResetMessage(null), 4000);
                }
            } catch (err: any) {
                setResetMessage({ type: 'error', text: err?.message || localize('Reset failed') });
                setTimeout(() => setResetMessage(null), 4000);
            } finally {
                setIsResettingBalance(false);
            }
        },
        [isResettingBalance, activeLoginid, client]
    );

    const realAccounts = formattedAccounts.filter(a => !a.isVirtual);
    const demoAccounts = formattedAccounts.filter(a => a.isVirtual);
    const tabAccounts = activeTab === 'real' ? realAccounts : demoAccounts;

    const activeFromList = formattedAccounts.find(a => a.isActive) || formattedAccounts[0];
    const resolvedActiveAccount =
        activeAccount ||
        (activeFromList
            ? {
                  currency: activeFromList.rawCurrency || activeFromList.currency || 'USD',
                  isVirtual: activeFromList.isVirtual,
                  balance: String(activeFromList.balance ?? '0'),
              }
            : null);

    if (!resolvedActiveAccount) return null;

    const { currency, isVirtual, balance } = resolvedActiveAccount;
    const showChevron = !is_bot_running;

    // Use client.balance as the "live" balance source, but only if:
    //  - it's a defined, non-empty value AND
    //  - it's not zero while we're in the middle of an account switch
    //    (balance=0 during a switch is "not yet loaded", not a real zero balance)
    const clientBalanceNum = client?.balance !== undefined && client?.balance !== null && client?.balance !== ''
        ? parseFloat(String(client.balance).replace(/,/g, ''))
        : NaN;
    const clientBalanceIsValid =
        !isNaN(clientBalanceNum) &&
        (!isSwitchingAccount || clientBalanceNum > 0 || isVirtual);

    const rawLiveBalance = clientBalanceIsValid
        ? addComma(clientBalanceNum.toFixed(getDecimalPlaces(currency || 'USD')))
        : balance;

    // ─── Format balance for header chip ──────────────────────────────────────
    const chipBalance = (() => {
        if (!currency) return localize('No currency');
        const accCurr = currency || 'USD';
        if (displayCurrency === 'KES' && accCurr === 'USD') {
            const num = parseFloat((rawLiveBalance || '0').replace(/,/g, '')) || 0;
            const converted = num * rate;
            return `${new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(converted)} KES`;
        }
        return `${rawLiveBalance} ${getCurrencyDisplayCode(accCurr)}`;
    })();

    // Set initial tab when dropdown opens
    useEffect(() => {
        if (isOpen) {
            setActiveTab(isVirtual ? 'demo' : 'real');
        }
    }, [isOpen]);

    return (
        <div className='acc-info__wrapper' ref={wrapperRef}>
            <AccountInfoWrapper>
                {/* ── Header Account Card ──────────────────────────────── */}
                <div
                    data-testid='dt_acc_info'
                    id='dt_core_account-info_acc-info'
                    className={classNames('acc-chip', {
                        'acc-chip--open': isOpen,
                        'acc-chip--interactive': showChevron,
                    })}
                    role='button'
                    tabIndex={showChevron ? 0 : -1}
                    onClick={toggleDropdown}
                    onKeyDown={e => {
                        if (showChevron && (e.key === 'Enter' || e.key === ' ')) {
                            e.preventDefault();
                            toggleDropdown();
                        }
                    }}
                >
                    {/* Currency / Avatar circle icon (3D Glass for Real, Real Currency Icon for Demo) */}
                    <div
                        className={classNames('acc-chip__currency-icon', {
                            'acc-chip__currency-icon--demo': isVirtual,
                            'acc-chip__currency-icon--real': !isVirtual,
                        })}
                    >
                        {isVirtual ? (
                            <CurrencyIcon currency={currency || 'usd'} isVirtual={false} />
                        ) : (
                            <RealAccount3DGlassIcon currency={currency} />
                        )}
                        <span className='acc-chip__online-dot'></span>
                    </div>

                    {/* Balance and Controls Block */}
                    <div className='acc-chip__text-block'>
                        <div className='acc-chip__balance-row'>
                            {/* Balance */}
                            <span
                                data-testid='dt_balance'
                                className={classNames('acc-chip__balance', {
                                    'acc-chip__balance--no-currency': !currency && !isVirtual,
                                    'acc-chip__balance--loading': isSwitchingAccount || client?.is_account_regenerating,
                                })}
                            >
                                {isSwitchingAccount || client?.is_account_regenerating ? (
                                    <div className='acc-chip__balance-loader' title={localize('Initializing balance...')}>
                                        <span className='acc-chip__spinner' />
                                        <span className='acc-chip__loading-text'>{localize('Updating...')}</span>
                                    </div>
                                ) : isBalanceVisible ? (
                                    chipBalance
                                ) : (
                                    '••••••'
                                )}
                            </span>

                            {/* Eye toggle button */}
                            <button
                                type='button'
                                className='acc-chip__visibility-btn'
                                onClick={toggleBalanceVisibility}
                                aria-label={isBalanceVisible ? 'Hide balance' : 'Show balance'}
                                title={isBalanceVisible ? 'Hide balance' : 'Show balance'}
                            >
                                {isBalanceVisible ? (
                                    <svg
                                        width='13'
                                        height='13'
                                        viewBox='0 0 24 24'
                                        fill='none'
                                        stroke='currentColor'
                                        strokeWidth='2.2'
                                        strokeLinecap='round'
                                        strokeLinejoin='round'
                                    >
                                        <path d='M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z' />
                                        <circle cx='12' cy='12' r='3' />
                                    </svg>
                                ) : (
                                    <svg
                                        width='13'
                                        height='13'
                                        viewBox='0 0 24 24'
                                        fill='none'
                                        stroke='currentColor'
                                        strokeWidth='2.2'
                                        strokeLinecap='round'
                                        strokeLinejoin='round'
                                    >
                                        <path d='M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24' />
                                        <line x1='1' y1='1' x2='23' y2='23' />
                                    </svg>
                                )}
                            </button>

                            {/* Dropdown chevron */}
                            {showChevron && (
                                <div className='acc-chip__chevron-wrapper'>
                                    <svg
                                        className={classNames('acc-chip__chevron', {
                                            'acc-chip__chevron--open': isOpen,
                                        })}
                                        width='10'
                                        height='10'
                                        viewBox='0 0 12 12'
                                        fill='none'
                                    >
                                        <path
                                            d='M2 4L6 8L10 4'
                                            stroke='currentColor'
                                            strokeWidth='2'
                                            strokeLinecap='round'
                                            strokeLinejoin='round'
                                        />
                                    </svg>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </AccountInfoWrapper>

            {/* ── Dropdown Panel (Real / Demo only) ────────────────────────── */}
            {isOpen && (() => {
                const panelContent = (
                    <>
                        {isMobile && (
                            <div
                                className='acc-panel__mobile-backdrop'
                                onClick={e => {
                                    e.stopPropagation();
                                    setIsOpen(false);
                                }}
                                onTouchEnd={e => {
                                    e.stopPropagation();
                                    setIsOpen(false);
                                }}
                                aria-hidden='true'
                            />
                        )}
                        <div
                            className={classNames('acc-panel', {
                                'acc-panel--mobile': isMobile,
                            })}
                            role='dialog'
                            aria-label={localize('Account switcher')}
                        >
                            {isMobile && (
                                <div className='acc-panel__mobile-header'>
                                    <button
                                        type='button'
                                        className='acc-panel__mobile-close-btn'
                                        onClick={e => {
                                            e.stopPropagation();
                                            setIsOpen(false);
                                        }}
                                        aria-label={localize('Close')}
                                    >
                                        <svg
                                            width='14'
                                            height='14'
                                            viewBox='0 0 24 24'
                                            fill='none'
                                            stroke='currentColor'
                                            strokeWidth='2.5'
                                            strokeLinecap='round'
                                            strokeLinejoin='round'
                                        >
                                            <line x1='18' y1='6' x2='6' y2='18' />
                                            <line x1='6' y1='6' x2='18' y2='18' />
                                        </svg>
                                    </button>
                                </div>
                            )}

                            {/* Real / Demo tab toggle (Standard Deriv Quill UI Tabs) */}
                            <div className='acc-panel__tabs' role='tablist' aria-label={localize('Account types')}>
                                <button
                                    type='button'
                                    role='tab'
                                    aria-selected={activeTab === 'real'}
                                    className={classNames('acc-panel__tab', {
                                        'acc-panel__tab--active': activeTab === 'real',
                                        'acc-panel__tab--active-real': activeTab === 'real',
                                        'acc-panel__tab--inactive': activeTab !== 'real',
                                    })}
                                    onClick={e => {
                                        e.stopPropagation();
                                        setActiveTab('real');
                                    }}
                                    onTouchEnd={e => {
                                        e.stopPropagation();
                                        setActiveTab('real');
                                    }}
                                    id='acc-tab-real'
                                >
                                    <span className='acc-panel__tab-text'>
                                        <Localize i18n_default_text='Real' />
                                    </span>
                                    {activeTab === 'real' && (
                                        <span className='acc-panel__tab-underline acc-panel__tab-underline--real' />
                                    )}
                                </button>
                                <button
                                    type='button'
                                    role='tab'
                                    aria-selected={activeTab === 'demo'}
                                    className={classNames('acc-panel__tab', {
                                        'acc-panel__tab--active': activeTab === 'demo',
                                        'acc-panel__tab--active-demo': activeTab === 'demo',
                                        'acc-panel__tab--inactive': activeTab !== 'demo',
                                    })}
                                    onClick={e => {
                                        e.stopPropagation();
                                        setActiveTab('demo');
                                    }}
                                    onTouchEnd={e => {
                                        e.stopPropagation();
                                        setActiveTab('demo');
                                    }}
                                    id='acc-tab-demo'
                                >
                                    <span className='acc-panel__tab-text'>
                                        <Localize i18n_default_text='Demo' />
                                    </span>
                                    {activeTab === 'demo' && (
                                        <span className='acc-panel__tab-underline acc-panel__tab-underline--demo' />
                                    )}
                                </button>
                            </div>

                            {/* Account list */}
                            <div className='acc-panel__body'>
                                <div
                                    className='acc-panel__section-header'
                                    style={{
                                        display: 'flex',
                                        justifyContent: 'space-between',
                                        alignItems: 'center',
                                        padding: '0 4px',
                                        marginBottom: '8px',
                                    }}
                                >
                                    <p className='acc-panel__section-label' style={{ margin: 0 }}>
                                        {userNickname
                                            ? `${localize('Deriv accounts')} (${userNickname})`
                                            : localize('Deriv accounts')}
                                    </p>
                                </div>

                                {tabAccounts.length === 0 ? (
                                    <div
                                        className='acc-panel__empty-container'
                                        style={{ padding: '16px 8px', textAlign: 'center' }}
                                    >
                                        <p className='acc-panel__empty' style={{ margin: '0 0 10px 0' }}>
                                            {activeTab === 'real'
                                                ? localize('No real accounts linked')
                                                : localize('No demo accounts linked')}
                                        </p>
                                        {activeTab === 'real' && (
                                            <button
                                                type='button'
                                                className='acc-panel__action-link'
                                                onClick={e => {
                                                    e.stopPropagation();
                                                    setIsOpen(false);
                                                    window.open('https://app.deriv.com', '_blank');
                                                }}
                                            >
                                                {localize('Open a Real Account on Deriv')}
                                            </button>
                                        )}
                                    </div>
                                ) : (
                                    <div className='acc-panel__account-list' role='listbox'>
                                        {tabAccounts.map(account => (
                                            <div
                                                key={account.loginid}
                                                role='option'
                                                aria-selected={account.isActive}
                                                tabIndex={0}
                                                className={classNames('acc-panel__account', {
                                                    'acc-panel__account--active': account.isActive,
                                                })}
                                                onClick={e => {
                                                    e.stopPropagation();
                                                    if (!account.isActive) {
                                                        handleAccountSelect(account.loginid);
                                                    }
                                                }}
                                                onTouchEnd={e => {
                                                    e.stopPropagation();
                                                    if (!account.isActive) {
                                                        handleAccountSelect(account.loginid);
                                                    }
                                                }}
                                                onKeyDown={e => {
                                                    if ((e.key === 'Enter' || e.key === ' ') && !account.isActive) {
                                                        e.preventDefault();
                                                        handleAccountSelect(account.loginid);
                                                    }
                                                }}
                                            >
                                                <div className='acc-panel__account-icon'>
                                                    <AccountAvatar
                                                        currency={account.rawCurrency || account.currency}
                                                        isVirtual={account.isVirtual}
                                                    />
                                                </div>
                                                <div className='acc-panel__account-info'>
                                                    <span className='acc-panel__account-name'>
                                                        {account.isVirtual
                                                            ? localize('Demo Account')
                                                            : getCurrencyLabel(account.rawCurrency)}
                                                    </span>
                                                    <span className='acc-panel__account-id'>{account.loginid}</span>
                                                </div>
                                                <div className='acc-panel__account-right'>
                                                    <span className='acc-panel__account-balance'>
                                                        {account.balance} {account.currency}
                                                    </span>
                                                    {account.isActive && (
                                                        <span className='acc-panel__account-check'>
                                                            <svg
                                                                width='12'
                                                                height='12'
                                                                viewBox='0 0 24 24'
                                                                fill='none'
                                                                stroke='currentColor'
                                                                strokeWidth='3'
                                                                strokeLinecap='round'
                                                                strokeLinejoin='round'
                                                            >
                                                                <polyline points='20 6 9 17 4 12' />
                                                            </svg>
                                                        </span>
                                                    )}
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>

                            {/* Footer */}
                            <div className='acc-panel__footer'>
                                {/* Demo tab: Reset balance button */}
                                {activeTab === 'demo' && (
                                    <button
                                        type='button'
                                        className='acc-panel__reset-btn'
                                        onClick={handleResetBalance}
                                        disabled={isResettingBalance}
                                        title={localize('Reset virtual balance to $10,000')}
                                    >
                                        {isResettingBalance ? (
                                            <svg
                                                className='acc-panel__reset-spinner'
                                                width='12'
                                                height='12'
                                                viewBox='0 0 24 24'
                                                fill='none'
                                                stroke='currentColor'
                                                strokeWidth='2.5'
                                            >
                                                <circle cx='12' cy='12' r='10' strokeOpacity='0.25' />
                                                <path d='M12 2a10 10 0 0 1 10 10' />
                                            </svg>
                                        ) : (
                                            <svg
                                                width='12'
                                                height='12'
                                                viewBox='0 0 24 24'
                                                fill='none'
                                                stroke='currentColor'
                                                strokeWidth='2.5'
                                                strokeLinecap='round'
                                                strokeLinejoin='round'
                                            >
                                                <path d='M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8' />
                                                <path d='M21 3v5h-5' />
                                                <path d='M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16' />
                                                <path d='M8 16H3v5' />
                                            </svg>
                                        )}
                                        <span>{isResettingBalance ? localize('Resetting...') : localize('Reset Balance')}</span>
                                    </button>
                                )}

                                <div className='acc-panel__footer-right' style={{ marginLeft: activeTab === 'real' ? 'auto' : undefined }}>
                                    <button
                                        type='button'
                                        className='acc-panel__logout-btn'
                                        onClick={e => {
                                            e.stopPropagation();
                                            setIsOpen(false);
                                            if (client?.logout) {
                                                client.logout();
                                            } else {
                                                localStorage.clear();
                                                sessionStorage.clear();
                                                window.location.reload();
                                            }
                                        }}
                                    >
                                        <svg
                                            className='acc-panel__logout-icon'
                                            width='12'
                                            height='12'
                                            viewBox='0 0 24 24'
                                            fill='none'
                                            stroke='currentColor'
                                            strokeWidth='2.5'
                                            strokeLinecap='round'
                                            strokeLinejoin='round'
                                        >
                                            <path d='M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4' />
                                            <polyline points='16 17 21 12 16 7' />
                                            <line x1='21' y1='12' x2='9' y2='12' />
                                        </svg>
                                        <span>{localize('Log out')}</span>
                                    </button>
                                </div>
                            </div>

                            {/* Reset / Create toast message */}
                            {resetMessage && (
                                <div
                                    className={classNames('acc-panel__toast', {
                                        'acc-panel__toast--success': resetMessage.type === 'success',
                                        'acc-panel__toast--error': resetMessage.type === 'error',
                                        'acc-panel__toast--info': resetMessage.type === 'info',
                                    })}
                                >
                                    {resetMessage.text}
                                </div>
                            )}
                        </div>
                    </>
                );

                if (isMobile && typeof document !== 'undefined') {
                    return ReactDOM.createPortal(panelContent, document.body);
                }
                return panelContent;
            })()}
        </div>
    );
});

export default AccountSwitcher;
