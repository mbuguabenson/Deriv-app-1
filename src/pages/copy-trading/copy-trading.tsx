import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { observer } from 'mobx-react-lite';
import { useStore } from '@/hooks/useStore';
import {
    copyTradingService,
    CopierAccount,
    CopierTradeLog,
    MasterAccountConfig,
} from './services/copy-trading.service';
import { getAccountsList } from '@/utils/token-bridge';
import './copy-trading.scss';

export const CopyTradingPage: React.FC = observer(() => {
    const { client } = useStore();

    // Local reactive copies from service
    const [accounts, setAccounts] = useState<CopierAccount[]>([]);
    const [tradeLogs, setTradeLogs] = useState<CopierTradeLog[]>([]);
    const [masterConfig, setMasterConfig] = useState<MasterAccountConfig>(
        copyTradingService.getMasterConfig()
    );

    // Dock Tabs & Input state
    const [dockTab, setDockTab] = useState<'token' | 'stored'>('token');
    const [inputToken, setInputToken] = useState('');

    // Live validation state for dock
    const [isValidating, setIsValidating] = useState(false);
    const [selectedTargetLoginid, setSelectedTargetLoginid] = useState<string>('');
    const [validationResult, setValidationResult] = useState<{
        valid?: boolean;
        loginid?: string;
        is_virtual?: boolean;
        balance?: number;
        currency?: string;
        scopes?: string[];
        has_trade_scope?: boolean;
        app_id?: string;
        available_accounts?: Array<{
            loginid: string;
            is_virtual: boolean;
            balance: number;
            currency: string;
        }>;
        error?: string;
    } | null>(null);

    // Capital Protection settings state (Demo to Real guard)
    const [allowDemoToReal, setAllowDemoToReal] = useState<boolean>(
        Boolean(copyTradingService.getMasterConfig().allow_demo_to_real)
    );

    // Audit log filter & mobile tab
    const [logFilter, setLogFilter] = useState<'all' | 'real' | 'demo' | 'won' | 'lost'>('all');
    const [mobileTab, setMobileTab] = useState<'copiers' | 'add' | 'history'>('copiers');

    // Synchronize with copyTradingService
    useEffect(() => {
        copyTradingService.init();

        const updateState = () => {
            const currentAccs = copyTradingService.getAccounts();
            const currentLogs = copyTradingService.getTradeLogs();
            const currentCfg = copyTradingService.getMasterConfig();
            setAccounts(currentAccs);
            setTradeLogs(currentLogs);
            setMasterConfig(currentCfg);
            setAllowDemoToReal(Boolean(currentCfg.allow_demo_to_real));
        };

        updateState();
        const unsubscribe = copyTradingService.subscribe(updateState);

        // Auto sync active client account if master is unset
        if (client?.loginid) {
            const currentToken = getAccountsList()[client.loginid] || '';
            const isVirtual = Boolean(
                client.is_virtual ||
                    client.loginid.startsWith('VRTC') ||
                    client.loginid.startsWith('VRW') ||
                    client.loginid.startsWith('VR')
            );
            const currentBal = Number(client.balance || 0);
            const currentCurr = client.currency || 'USD';

            const currentMaster = copyTradingService.getMasterConfig();
            if (!currentMaster.loginid || currentMaster.loginid === client.loginid) {
                copyTradingService.setMasterConfig({
                    loginid: client.loginid,
                    token: currentToken,
                    is_virtual: isVirtual,
                    balance: currentBal,
                    currency: currentCurr,
                    alias: `Active (${client.loginid})`,
                });
            }
        }

        return () => {
            unsubscribe();
        };
    }, [client?.loginid, client?.balance, client?.is_virtual]);

    // Available stored accounts from browser
    const storedAccounts = useMemo(() => {
        return copyTradingService.getAvailableStoredAccounts();
    }, [dockTab]);

    const validationTimerRef = React.useRef<any>(null);

    // Handle token validation with auto cleaning & debouncing
    const handleValidateToken = useCallback(
        (tokenToValidate: string, targetLoginid?: string) => {
            const cleaned = copyTradingService.sanitizeToken(tokenToValidate);
            if (!cleaned || cleaned.length < 4) {
                setValidationResult(null);
                setIsValidating(false);
                setSelectedTargetLoginid('');
                return;
            }

            if (validationTimerRef.current) {
                clearTimeout(validationTimerRef.current);
            }

            setIsValidating(true);
            validationTimerRef.current = setTimeout(async () => {
                try {
                    const res = await copyTradingService.validateToken(cleaned, targetLoginid);
                    setValidationResult(res);
                    if (res.loginid && !targetLoginid) {
                        setSelectedTargetLoginid(res.loginid);
                    }
                } catch (err: any) {
                    setValidationResult({
                        valid: false,
                        error: err?.message || 'Failed to communicate with Deriv server.',
                    });
                } finally {
                    setIsValidating(false);
                }
            }, 300);
        },
        []
    );

    // Paste token directly from clipboard
    const handlePasteFromClipboard = async () => {
        try {
            const text = await navigator.clipboard.readText();
            if (text) {
                const cleaned = copyTradingService.sanitizeToken(text);
                setInputToken(cleaned);
                handleValidateToken(cleaned);
            }
        } catch (err) {
            console.warn('Clipboard read failed:', err);
        }
    };

    // Save token as follower account
    const handleSaveAccount = async () => {
        const cleaned = copyTradingService.sanitizeToken(inputToken);
        if (!cleaned || !validationResult?.valid) return;

        const targetId = selectedTargetLoginid || validationResult.loginid || '';
        const autoAlias = `${validationResult.is_virtual ? 'Demo' : 'Real'} Account (${targetId || 'Follower'})`;
        const res = await copyTradingService.addCopierAccount({
            token: cleaned,
            target_loginid: targetId,
            alias: autoAlias,
            sizing_mode: 'multiplier',
            multiplier: 1.0,
        });

        if (res.success) {
            setInputToken('');
            setSelectedTargetLoginid('');
            setValidationResult(null);
            if (mobileTab === 'add') {
                setMobileTab('copiers');
            }
        } else {
            alert(res.error || 'Failed to save follower account');
        }
    };

    // 1-Click add stored account
    const handleAddStoredAccount = async (stored: {
        loginid: string;
        token: string;
        is_virtual: boolean;
    }) => {
        const res = await copyTradingService.addCopierAccount({
            token: stored.token,
            alias: `${stored.is_virtual ? 'Demo' : 'Real'} Account (${stored.loginid})`,
            sizing_mode: 'multiplier',
            multiplier: 1.0,
        });
        if (res.success) {
            if (mobileTab === 'add') {
                setMobileTab('copiers');
            }
        } else {
            alert(res.error || 'Failed to add account');
        }
    };

    // Toggle master global copier status
    const handleToggleMasterCopier = () => {
        copyTradingService.setMasterConfig({
            is_active: !masterConfig.is_active,
        });
    };

    // Toggle Demo-to-Real Protection
    const handleToggleDemoToReal = (enabled: boolean) => {
        if (enabled) {
            const confirmed = confirm(
                '⚠️ SAFETY WARNING:\n\nEnabling Demo-to-Real copying means any trade placed on DEMO (bots, manual trading, free bots, etc.) will place REAL MONEY trades on your connected Real accounts.\n\nAre you sure you want to enable Demo-to-Real copying?'
            );
            if (!confirmed) return;
        }
        setAllowDemoToReal(enabled);
        copyTradingService.setMasterConfig({ allow_demo_to_real: enabled });
    };

    // Switch Master account source
    const handleSelectMasterAccount = (loginid: string) => {
        const found = storedAccounts.find(a => a.loginid === loginid);
        if (found) {
            copyTradingService.setMasterConfig({
                loginid: found.loginid,
                token: found.token,
                is_virtual: found.is_virtual,
                alias: `Selected (${found.loginid})`,
            });
            copyTradingService.refreshAllBalances();
        }
    };

    // Derived metrics
    const activeCount = accounts.filter(a => a.is_active).length;
    const realCount = accounts.filter(a => !a.is_virtual).length;
    const demoCount = accounts.filter(a => a.is_virtual).length;

    const totalProfitCalculated = useMemo(() => {
        return tradeLogs.reduce((acc, log) => acc + (log.profit || 0), 0);
    }, [tradeLogs]);

    // Filtered audit logs
    const filteredLogs = useMemo(() => {
        return tradeLogs.filter(log => {
            if (logFilter === 'real') return !log.is_virtual;
            if (logFilter === 'demo') return log.is_virtual;
            if (logFilter === 'won') return log.status === 'won';
            if (logFilter === 'lost') return log.status === 'lost';
            return true;
        });
    }, [tradeLogs, logFilter]);

    return (
        <div className='copy-trading-container'>
            {/* 1. TOP HEADER & GLOBAL CONTROL BAR */}
            <header className='ct-header-bar'>
                <div className='ct-header-bar__left'>
                    <div className='ct-header-bar__logo-badge'>
                        <svg
                            width='22'
                            height='22'
                            viewBox='0 0 24 24'
                            fill='none'
                            stroke='currentColor'
                            strokeWidth='2'
                            strokeLinecap='round'
                            strokeLinejoin='round'
                        >
                            <path d='M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2' />
                            <circle cx='9' cy='7' r='4' />
                            <path d='M22 21v-2a4 4 0 0 0-3-3.87' />
                            <path d='M16 3.13a4 4 0 0 1 0 7.75' />
                        </svg>
                    </div>
                    <div className='ct-header-bar__title-group'>
                        <div className='ct-header-bar__title'>
                            Copy Trading
                            <span className='ct-header-bar__badge-tag'>Universal Mirror</span>
                        </div>
                        <p className='ct-header-bar__desc'>
                            Mirror trades across accounts with proportional risk sizing & capital guards.
                        </p>
                    </div>
                </div>

                <div className='ct-header-bar__right'>
                    {/* Master Account Info Card */}
                    <div className='ct-header-bar__master-pill'>
                        <span className='ct-header-bar__master-label'>Source:</span>
                        <span className={`ct-header-bar__master-badge ${masterConfig.is_virtual ? 'demo' : 'real'}`}>
                            {masterConfig.is_virtual ? 'DEMO' : 'REAL'}
                        </span>
                        <span className='ct-header-bar__master-id'>
                            {masterConfig.loginid || 'Active Account'}
                        </span>
                        <span className='ct-header-bar__master-balance'>
                            ${masterConfig.balance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </span>
                        {storedAccounts.length > 1 && (
                            <select
                                className='ct-header-bar__master-select'
                                value={masterConfig.loginid}
                                onChange={e => handleSelectMasterAccount(e.target.value)}
                                title='Switch Master Account'
                            >
                                {storedAccounts.map(a => (
                                    <option key={a.loginid} value={a.loginid}>
                                        {a.is_virtual ? 'Demo' : 'Real'} ({a.loginid})
                                    </option>
                                ))}
                            </select>
                        )}
                    </div>

                    {/* Master Replication Toggle */}
                    <button
                        type='button'
                        className={`ct-header-bar__toggle-btn ${masterConfig.is_active ? 'active' : 'paused'}`}
                        onClick={handleToggleMasterCopier}
                        title='Toggle global copy trading replication'
                    >
                        <span className='indicator-dot' />
                        {masterConfig.is_active ? 'MIRROR ACTIVE' : 'PAUSED'}
                    </button>

                    <button
                        type='button'
                        className='ct-header-bar__btn ct-header-bar__btn--secondary'
                        onClick={() => copyTradingService.refreshAllBalances()}
                        title='Refresh account balances'
                    >
                        <svg width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2'>
                            <path d='M23 4v6h-6' />
                            <path d='M1 20v-6h6' />
                            <path d='M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15' />
                        </svg>
                        Refresh
                    </button>
                </div>
            </header>

            {/* 2. DEMO-TO-REAL SAFETY PROTECTION BANNER */}
            <div className={`ct-safety-banner ${allowDemoToReal ? 'ct-safety-banner--warning' : 'ct-safety-banner--safe'}`}>
                <div className='ct-safety-banner__left'>
                    <span className='ct-safety-banner__icon'>
                        {allowDemoToReal ? '⚠️' : '🛡️'}
                    </span>
                    <div className='ct-safety-banner__content'>
                        <div className='ct-safety-banner__heading'>
                            {allowDemoToReal ? (
                                <strong>Demo-to-Real Copying Is ACTIVE:</strong>
                            ) : (
                                <strong>Demo-to-Real Protection Active:</strong>
                            )}
                        </div>
                        <div className='ct-safety-banner__sub'>
                            {allowDemoToReal
                                ? 'Demo trades will place REAL MONEY orders on connected Real accounts. Disable in Risk Settings below to prevent unexpected losses.'
                                : 'Demo trades are blocked from copying to Real accounts to protect funds. Demo trades only mirror to Demo accounts.'}
                        </div>
                    </div>
                </div>

                <div className='ct-safety-banner__action'>
                    <button
                        type='button'
                        className={`ct-safety-banner__btn ${allowDemoToReal ? 'ct-safety-banner__btn--danger' : 'ct-safety-banner__btn--safe'}`}
                        onClick={() => handleToggleDemoToReal(!allowDemoToReal)}
                    >
                        {allowDemoToReal ? 'Disable Demo-to-Real' : 'Enable Demo-to-Real'}
                    </button>
                </div>
            </div>

            {/* 3. PERFORMANCE STATS CARDS */}
            <div className='ct-stats-bar'>
                <div className='ct-stat-box'>
                    <div className='ct-stat-box__icon ct-stat-box__icon--emerald'>
                        <svg width='18' height='18' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2'>
                            <path d='M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2' />
                            <circle cx='9' cy='7' r='4' />
                        </svg>
                    </div>
                    <div>
                        <div className='ct-stat-box__label'>Followers</div>
                        <div className='ct-stat-box__value'>
                            {activeCount} <span className='ct-stat-box__small'>/ {accounts.length} Active</span>
                        </div>
                        <div className='ct-stat-box__sub'>{realCount} Real • {demoCount} Demo</div>
                    </div>
                </div>

                <div className='ct-stat-box'>
                    <div className='ct-stat-box__icon ct-stat-box__icon--cyan'>
                        <svg width='18' height='18' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2'>
                            <polyline points='23 6 13.5 15.5 8.5 10.5 1 18' />
                            <polyline points='17 6 23 6 23 12' />
                        </svg>
                    </div>
                    <div>
                        <div className='ct-stat-box__label'>Copied Trades</div>
                        <div className='ct-stat-box__value'>{tradeLogs.length}</div>
                        <div className='ct-stat-box__sub'>Session Executions</div>
                    </div>
                </div>

                <div className='ct-stat-box'>
                    <div className='ct-stat-box__icon ct-stat-box__icon--amber'>
                        <svg width='18' height='18' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2'>
                            <path d='M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6' />
                        </svg>
                    </div>
                    <div>
                        <div className='ct-stat-box__label'>Copied P&L</div>
                        <div className={`ct-stat-box__value ${totalProfitCalculated >= 0 ? 'text-win' : 'text-loss'}`}>
                            {totalProfitCalculated >= 0 ? `+$${totalProfitCalculated.toFixed(2)}` : `-$${Math.abs(totalProfitCalculated).toFixed(2)}`}
                        </div>
                        <div className='ct-stat-box__sub'>Net Performance</div>
                    </div>
                </div>
            </div>

            {/* MOBILE NAV SWITCHER (Visible on small screens) */}
            <div className='ct-mobile-nav'>
                <button
                    type='button'
                    className={`ct-mobile-nav__btn ${mobileTab === 'copiers' ? 'active' : ''}`}
                    onClick={() => setMobileTab('copiers')}
                >
                    Followers ({accounts.length})
                </button>
                <button
                    type='button'
                    className={`ct-mobile-nav__btn ${mobileTab === 'add' ? 'active' : ''}`}
                    onClick={() => setMobileTab('add')}
                >
                    + Connect Account
                </button>
                <button
                    type='button'
                    className={`ct-mobile-nav__btn ${mobileTab === 'history' ? 'active' : ''}`}
                    onClick={() => setMobileTab('history')}
                >
                    Trades ({tradeLogs.length})
                </button>
            </div>

            {/* 4. MAIN WORKSPACE: FOLLOWER POOL & CONNECT DOCK */}
            <div className={`ct-workspace-grid ct-workspace-grid--${mobileTab}`}>
                {/* LEFT: Follower Copiers Pool */}
                <section className='ct-copier-pool'>
                    <div className='ct-copier-pool__header'>
                        <h2 className='ct-copier-pool__title'>
                            <svg width='18' height='18' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2'>
                                <path d='M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2' />
                                <circle cx='9' cy='7' r='4' />
                            </svg>
                            Linked Follower Accounts
                        </h2>
                        <span className='ct-copier-pool__count-tag'>{accounts.length} Linked</span>
                    </div>

                    {accounts.length === 0 ? (
                        <div className='ct-empty-pool-card'>
                            <div className='ct-empty-pool-card__icon'>
                                <svg width='28' height='28' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2'>
                                    <path d='M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2' />
                                    <circle cx='9' cy='7' r='4' />
                                    <line x1='19' y1='8' x2='19' y2='14' />
                                    <line x1='22' y1='11' x2='16' y2='11' />
                                </svg>
                            </div>
                            <h3 className='ct-empty-pool-card__title'>
                                No Follower Accounts Connected
                            </h3>
                            <p className='ct-empty-pool-card__desc'>
                                Use the Connect Dock on the right to paste a Deriv API Token (PAT) or pick an active account from your current browser session.
                            </p>
                        </div>
                    ) : (
                        <div className='ct-copier-pool__cards'>
                            {accounts.map(acc => (
                                <div
                                    key={acc.id}
                                    className={`ct-pool-card ${acc.is_virtual ? 'ct-pool-card--demo' : 'ct-pool-card--real'} ${
                                        !acc.is_active ? 'ct-pool-card--inactive' : ''
                                    }`}
                                >
                                    <div className='ct-pool-card__top'>
                                        <div className='ct-pool-card__identity'>
                                            <div
                                                className={`ct-pool-card__avatar ${
                                                    acc.is_virtual
                                                        ? 'ct-pool-card__avatar--demo'
                                                        : 'ct-pool-card__avatar--real'
                                                }`}
                                            >
                                                {acc.is_virtual ? 'DEMO' : 'REAL'}
                                            </div>
                                            <div className='ct-pool-card__name-group'>
                                                <h4 className='ct-pool-card__alias'>{acc.alias}</h4>
                                                <span className='ct-pool-card__loginid'>{acc.loginid}</span>
                                            </div>
                                        </div>

                                        <div className='ct-pool-card__badges-group'>
                                            {!acc.is_virtual && !allowDemoToReal && (
                                                <span className='ct-pool-card__protect-badge' title='Demo trades will not copy to this real account'>
                                                    🛡️ Demo Guarded
                                                </span>
                                            )}
                                            <span
                                                className={`ct-pool-card__status-pill ${
                                                    acc.is_active
                                                        ? 'ct-pool-card__status-pill--active'
                                                        : 'ct-pool-card__status-pill--paused'
                                                }`}
                                            >
                                                {acc.is_active ? '● Active' : '○ Paused'}
                                            </span>
                                        </div>
                                    </div>

                                    {/* Metrics row */}
                                    <div className='ct-pool-card__metrics-row'>
                                        <div className='ct-pool-card__metric-cell'>
                                            <span className='ct-pool-card__metric-label'>Live Balance</span>
                                            <span className='ct-pool-card__metric-value ct-pool-card__metric-value--accent'>
                                                ${acc.balance.toLocaleString('en-US', {
                                                    minimumFractionDigits: 2,
                                                    maximumFractionDigits: 2,
                                                })}{' '}
                                                <span style={{ fontSize: '0.74rem' }}>{acc.currency}</span>
                                            </span>
                                        </div>

                                        <div className='ct-pool-card__metric-cell'>
                                            <span className='ct-pool-card__metric-label'>Copied Trades</span>
                                            <span className='ct-pool-card__metric-value'>
                                                {acc.total_copied_trades || 0}
                                            </span>
                                        </div>

                                        <div className='ct-pool-card__metric-cell' style={{ alignItems: 'flex-end', justifyContent: 'center' }}>
                                            <div className='ct-pool-card__actions-group'>
                                                <button
                                                    type='button'
                                                    className='ct-pool-card__action-btn'
                                                    onClick={() => copyTradingService.toggleCopierActive(acc.id)}
                                                >
                                                    {acc.is_active ? 'Pause' : 'Activate'}
                                                </button>
                                                <button
                                                    type='button'
                                                    className='ct-pool-card__action-btn ct-pool-card__action-btn--danger'
                                                    onClick={() => {
                                                        if (confirm(`Disconnect follower ${acc.alias} (${acc.loginid})?`)) {
                                                            copyTradingService.removeCopierAccount(acc.id);
                                                        }
                                                    }}
                                                >
                                                    Disconnect
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </section>

                {/* RIGHT: Connect Follower Account Dock */}
                <div className='ct-sidebar-column'>
                    {/* Interactive Connect Follower Account Dock */}
                    <aside className='ct-connect-dock'>
                        <h3 className='ct-connect-dock__title'>
                            <svg width='18' height='18' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2'>
                                <path d='M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4' />
                            </svg>
                            Connect Follower Account
                        </h3>

                        <div className='ct-connect-dock__tabs'>
                            <button
                                type='button'
                                className={`ct-connect-dock__tab-btn ${dockTab === 'token' ? 'active' : ''}`}
                                onClick={() => setDockTab('token')}
                            >
                                API Token (PAT)
                            </button>
                            <button
                                type='button'
                                className={`ct-connect-dock__tab-btn ${dockTab === 'stored' ? 'active' : ''}`}
                                onClick={() => setDockTab('stored')}
                            >
                                Session Accounts ({storedAccounts.length})
                            </button>
                        </div>

                        {dockTab === 'token' ? (
                            <>
                                {client?.loginid && !accounts.some(a => a.loginid === client.loginid) && (
                                    <div className='ct-quick-link-banner'>
                                        <div>
                                            <div style={{ fontSize: '0.78rem', fontWeight: 800, color: 'var(--ct-text-title)' }}>
                                                ⚡ Active Account Detected: {client.loginid}
                                            </div>
                                            <div style={{ fontSize: '0.7rem', color: 'var(--ct-text-muted)' }}>
                                                Link your current session account in 1 click without copying a token.
                                            </div>
                                        </div>
                                        <button
                                            type='button'
                                            className='ct-header-bar__btn ct-header-bar__btn--primary'
                                            style={{ padding: '0.3rem 0.65rem', fontSize: '0.74rem' }}
                                            onClick={() => {
                                                const currentToken = getAccountsList()[client.loginid] || '';
                                                if (currentToken) {
                                                    handleAddStoredAccount({
                                                        loginid: client.loginid,
                                                        token: currentToken,
                                                        is_virtual: Boolean(client.is_virtual || client.loginid.startsWith('VR')),
                                                    });
                                                }
                                            }}
                                        >
                                            + Link Active
                                        </button>
                                    </div>
                                )}

                                <div className='ct-connect-dock__field'>
                                    <div className='ct-connect-dock__field-head'>
                                        <label>Deriv API Token (PAT)</label>
                                        <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
                                            <a
                                                href='https://app.deriv.com/account/api-token'
                                                target='_blank'
                                                rel='noopener noreferrer'
                                                style={{
                                                    fontSize: '0.7rem',
                                                    color: '#06b6d4',
                                                    fontWeight: 700,
                                                    textDecoration: 'none',
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    gap: '0.2rem',
                                                }}
                                                title='Open Deriv to generate a new API token'
                                            >
                                                Get Token ↗
                                            </a>
                                            <button
                                                type='button'
                                                className='ct-connect-dock__paste-btn'
                                                onClick={handlePasteFromClipboard}
                                                title='Paste token from clipboard and auto-clean'
                                            >
                                                📋 Paste
                                            </button>
                                        </div>
                                    </div>
                                    <input
                                        type='text'
                                        placeholder='Paste Deriv API Token (e.g. pat_... or a1-...)'
                                        value={inputToken}
                                        onChange={e => {
                                            setInputToken(e.target.value);
                                            handleValidateToken(e.target.value);
                                        }}
                                    />
                                    <span className='ct-connect-dock__hint'>
                                        Token must have both <strong>Read</strong> & <strong>Trade</strong> permissions selected on{' '}
                                        <a
                                            href='https://app.deriv.com/account/api-token'
                                            target='_blank'
                                            rel='noopener noreferrer'
                                        >
                                            app.deriv.com/account/api-token
                                        </a>.
                                    </span>
                                </div>

                                {/* Live WebSocket validation preview */}
                                {isValidating && (
                                    <div className='ct-connect-dock__live-preview'>
                                        <div className='ct-connect-dock__validating-row'>
                                            <span className='ct-pulse-dot running' />
                                            Verifying token with Deriv servers...
                                        </div>
                                    </div>
                                )}

                                {validationResult && !isValidating && (
                                    <div
                                        className={`ct-connect-dock__live-preview ${
                                            validationResult.valid
                                                ? validationResult.is_virtual
                                                    ? 'ct-connect-dock__live-preview--demo'
                                                    : 'ct-connect-dock__live-preview--real'
                                                : 'ct-connect-dock__live-preview--error'
                                        }`}
                                    >
                                        {validationResult.valid ? (
                                            <>
                                                <div className='ct-connect-dock__prev-head'>
                                                    <span
                                                        className={`ct-connect-dock__prev-badge ${
                                                            validationResult.is_virtual
                                                                ? 'ct-connect-dock__prev-badge--demo'
                                                                : 'ct-connect-dock__prev-badge--real'
                                                        }`}
                                                    >
                                                        {validationResult.is_virtual ? '✓ DEMO ACCOUNT' : '✓ REAL ACCOUNT'}
                                                    </span>
                                                    <span className='ct-connect-dock__prev-balance'>
                                                        ${validationResult.balance?.toLocaleString('en-US', {
                                                            minimumFractionDigits: 2,
                                                            maximumFractionDigits: 2,
                                                        })}{' '}
                                                        <span style={{ fontSize: '0.78rem', color: validationResult.is_virtual ? '#f59e0b' : '#10b981' }}>
                                                            {validationResult.currency}
                                                        </span>
                                                    </span>
                                                </div>
                                                <div className='ct-connect-dock__prev-meta'>
                                                    <span>Login ID: <strong>{validationResult.loginid}</strong></span>
                                                    <span>Scopes: <strong>{validationResult.scopes?.join(', ') || 'read, trade'}</strong></span>
                                                </div>

                                                {/* If token is linked to multiple accounts (Demo & Real), allow 1-click selection */}
                                                {validationResult.available_accounts && validationResult.available_accounts.length > 1 && (
                                                    <div style={{ marginTop: '0.6rem', paddingTop: '0.5rem', borderTop: '1px solid rgba(255,255,255,0.08)' }}>
                                                        <div style={{ fontSize: '0.72rem', color: 'var(--ct-text-muted)', marginBottom: '0.35rem', fontWeight: 600 }}>
                                                            Select Target Account (Demo vs Real):
                                                        </div>
                                                        <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                                                            {validationResult.available_accounts.map(acc => {
                                                                const isSelected = (selectedTargetLoginid || validationResult.loginid) === acc.loginid;
                                                                return (
                                                                    <button
                                                                        key={acc.loginid}
                                                                        type='button'
                                                                        style={{
                                                                            padding: '0.35rem 0.6rem',
                                                                            borderRadius: '6px',
                                                                            border: isSelected
                                                                                ? (acc.is_virtual ? '1px solid #f59e0b' : '1px solid #10b981')
                                                                                : '1px solid rgba(255,255,255,0.12)',
                                                                            background: isSelected
                                                                                ? (acc.is_virtual ? 'rgba(245, 158, 11, 0.15)' : 'rgba(16, 185, 129, 0.15)')
                                                                                : 'rgba(255,255,255,0.04)',
                                                                            color: isSelected
                                                                                ? (acc.is_virtual ? '#f59e0b' : '#10b981')
                                                                                : 'var(--ct-text-main)',
                                                                            fontSize: '0.72rem',
                                                                            cursor: 'pointer',
                                                                            display: 'flex',
                                                                            alignItems: 'center',
                                                                            gap: '0.35rem',
                                                                            fontWeight: isSelected ? 700 : 500,
                                                                        }}
                                                                        onClick={() => {
                                                                            setSelectedTargetLoginid(acc.loginid);
                                                                            handleValidateToken(inputToken, acc.loginid);
                                                                        }}
                                                                    >
                                                                        <span>{acc.is_virtual ? '🟡 Demo' : '🟢 Real'}</span>
                                                                        <strong>{acc.loginid}</strong>
                                                                        <span style={{ opacity: 0.8 }}>(${acc.balance.toFixed(2)})</span>
                                                                    </button>
                                                                );
                                                            })}
                                                        </div>
                                                    </div>
                                                )}

                                                {!validationResult.has_trade_scope && (
                                                    <div
                                                        style={{
                                                            marginTop: '0.4rem',
                                                            padding: '0.4rem 0.6rem',
                                                            borderRadius: '6px',
                                                            background: 'rgba(245, 158, 11, 0.15)',
                                                            border: '1px solid rgba(245, 158, 11, 0.3)',
                                                            color: '#fbbf24',
                                                            fontSize: '0.72rem',
                                                            lineHeight: '1.4',
                                                        }}
                                                    >
                                                        ⚠️ <strong>Notice:</strong> This token only has <strong>Read</strong> scope. To execute copy trades, please generate a token with <strong>Trade</strong> scope checked on Deriv.
                                                    </div>
                                                )}
                                            </>
                                        ) : (
                                            <div className='ct-connect-dock__error-block'>
                                                <div className='ct-connect-dock__error-msg'>
                                                    ⚠️ {validationResult.error || 'The token is invalid.'}
                                                </div>
                                                <div className='ct-connect-dock__error-help'>
                                                    <strong>How to fix this:</strong>
                                                    <ol>
                                                        <li>
                                                            Open{' '}
                                                            <a
                                                                href='https://app.deriv.com/account/api-token'
                                                                target='_blank'
                                                                rel='noopener noreferrer'
                                                            >
                                                                app.deriv.com/account/api-token
                                                            </a>
                                                        </li>
                                                        <li>Switch to your target account (Demo or Real) on Deriv</li>
                                                        <li>Check both <strong>Read</strong> and <strong>Trade</strong> checkboxes</li>
                                                        <li>Click <strong>Create</strong>, copy the new token and paste it here</li>
                                                    </ol>
                                                    {storedAccounts.length > 0 && (
                                                        <div style={{ marginTop: '0.5rem', paddingTop: '0.4rem', borderTop: '1px solid rgba(255,255,255,0.1)' }}>
                                                            <span>Or link your active account without a token:</span>{' '}
                                                            <button
                                                                type='button'
                                                                style={{
                                                                    background: 'none',
                                                                    border: 'none',
                                                                    color: '#06b6d4',
                                                                    fontWeight: 700,
                                                                    cursor: 'pointer',
                                                                    textDecoration: 'underline',
                                                                    padding: 0,
                                                                    fontSize: '0.74rem',
                                                                }}
                                                                onClick={() => setDockTab('stored')}
                                                            >
                                                                View {storedAccounts.length} Logged-in Accounts ➔
                                                            </button>
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                )}

                                <button
                                    type='button'
                                    className='ct-connect-dock__submit-btn'
                                    disabled={!validationResult?.valid}
                                    onClick={handleSaveAccount}
                                >
                                    <svg width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2'>
                                        <line x1='12' y1='5' x2='12' y2='19' />
                                        <line x1='5' y1='12' x2='19' y2='12' />
                                    </svg>
                                    Link Follower Account
                                </button>
                            </>
                        ) : (
                            <div className='ct-connect-dock__stored-list'>
                                <p className='ct-connect-dock__stored-desc'>
                                    Deriv accounts detected in your current session:
                                </p>
                                {storedAccounts.length === 0 ? (
                                    <div className='ct-connect-dock__stored-empty'>
                                        No session accounts detected. Paste an API token in the first tab.
                                    </div>
                                ) : (
                                    storedAccounts.map(acc => {
                                        const isAlreadyAdded = accounts.some(a => a.loginid === acc.loginid);
                                        return (
                                            <div key={acc.loginid} className='ct-connect-dock__stored-item'>
                                                <div>
                                                    <div className='ct-connect-dock__stored-id'>
                                                        {acc.loginid}
                                                    </div>
                                                    <span
                                                        className={`ct-connect-dock__stored-tag ${
                                                            acc.is_virtual ? 'demo' : 'real'
                                                        }`}
                                                    >
                                                        {acc.is_virtual ? 'Demo Account' : 'Real Account'}
                                                    </span>
                                                </div>

                                                <button
                                                    type='button'
                                                    className='ct-header-bar__btn ct-header-bar__btn--primary'
                                                    disabled={isAlreadyAdded}
                                                    onClick={() => handleAddStoredAccount(acc)}
                                                    style={{ padding: '0.35rem 0.75rem', fontSize: '0.78rem' }}
                                                >
                                                    {isAlreadyAdded ? 'Linked' : '+ Link'}
                                                </button>
                                            </div>
                                        );
                                    })
                                )}
                            </div>
                        )}
                    </aside>
                </div>
            </div>

            {/* 5. LIVE COPIED TRADES AUDIT TABLE & FILTERS */}
            <section className={`ct-audit-section ${mobileTab === 'history' ? 'ct-audit-section--mobile-active' : ''}`}>
                <div className='ct-audit-section__top'>
                    <div className='ct-audit-section__title-area'>
                        <svg width='18' height='18' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2'>
                            <polyline points='22 12 18 12 15 21 9 3 6 12 2 12' />
                        </svg>
                        <h3 className='ct-audit-section__title'>Copied Trades History</h3>
                    </div>

                    <div className='ct-audit-section__filters'>
                        <button
                            type='button'
                            className={`ct-audit-section__filter-btn ${logFilter === 'all' ? 'active' : ''}`}
                            onClick={() => setLogFilter('all')}
                        >
                            All ({tradeLogs.length})
                        </button>
                        <button
                            type='button'
                            className={`ct-audit-section__filter-btn ${logFilter === 'real' ? 'active' : ''}`}
                            onClick={() => setLogFilter('real')}
                        >
                            Real
                        </button>
                        <button
                            type='button'
                            className={`ct-audit-section__filter-btn ${logFilter === 'demo' ? 'active' : ''}`}
                            onClick={() => setLogFilter('demo')}
                        >
                            Demo
                        </button>
                        <button
                            type='button'
                            className={`ct-audit-section__filter-btn ${logFilter === 'won' ? 'active' : ''}`}
                            onClick={() => setLogFilter('won')}
                        >
                            Wins
                        </button>
                        <button
                            type='button'
                            className={`ct-audit-section__filter-btn ${logFilter === 'lost' ? 'active' : ''}`}
                            onClick={() => setLogFilter('lost')}
                        >
                            Losses
                        </button>

                        {tradeLogs.length > 0 && (
                            <button
                                type='button'
                                className='ct-audit-section__filter-btn ct-audit-section__filter-btn--clear'
                                onClick={() => copyTradingService.clearLogs()}
                            >
                                Clear
                            </button>
                        )}
                    </div>
                </div>

                {/* Desktop Streamlined Table View */}
                <div className='ct-audit-section__table-wrap ct-desktop-only'>
                    <table className='ct-audit-section__table'>
                        <thead>
                            <tr>
                                <th>Time</th>
                                <th>Source</th>
                                <th>Follower</th>
                                <th>Account</th>
                                <th>Market</th>
                                <th>Contract</th>
                                <th>Master Stake</th>
                                <th>Copier Stake</th>
                                <th>Status</th>
                                <th>Result / P&L</th>
                            </tr>
                        </thead>
                        <tbody>
                            {filteredLogs.length === 0 ? (
                                <tr>
                                    <td colSpan={10} style={{ textAlign: 'center', padding: '2.5rem', color: 'var(--ct-text-muted)' }}>
                                        No copied trades yet. When you place a trade on any bot or tab, it will mirror and record here.
                                    </td>
                                </tr>
                            ) : (
                                filteredLogs.map(log => (
                                    <tr key={log.id}>
                                        <td style={{ fontFamily: 'monospace' }}>{log.time}</td>
                                        <td>
                                            <span className='ct-source-badge'>
                                                {log.source_tab || 'Trading Engine'}
                                            </span>
                                        </td>
                                        <td>
                                            <span style={{ fontFamily: 'monospace', fontWeight: 700 }}>
                                                {log.copier_loginid}
                                            </span>
                                        </td>
                                        <td>
                                            <span
                                                style={{
                                                    fontSize: '0.68rem',
                                                    fontWeight: 800,
                                                    padding: '0.15rem 0.45rem',
                                                    borderRadius: '4px',
                                                    background: log.is_virtual ? 'rgba(245, 158, 11, 0.18)' : 'rgba(16, 185, 129, 0.18)',
                                                    color: log.is_virtual ? '#f59e0b' : '#10b981',
                                                    border: `1px solid ${log.is_virtual ? '#f59e0b' : '#10b981'}`,
                                                }}
                                            >
                                                {log.is_virtual ? 'DEMO' : 'REAL'}
                                            </span>
                                        </td>
                                        <td><strong>{log.symbol}</strong></td>
                                        <td>{log.contract_type}</td>
                                        <td>${log.master_stake.toFixed(2)}</td>
                                        <td style={{ color: '#10b981', fontWeight: 700 }}>
                                            ${log.copier_stake.toFixed(2)}
                                        </td>
                                        <td>
                                            <span className={`ct-audit-section__status-pill ct-audit-section__status-pill--${log.status}`}>
                                                {log.status}
                                            </span>
                                        </td>
                                        <td>
                                            {log.profit !== undefined ? (
                                                <span
                                                    style={{
                                                        color: log.profit >= 0 ? '#10b981' : '#f43f5e',
                                                        fontWeight: 800,
                                                    }}
                                                >
                                                    {log.profit >= 0 ? `+$${log.profit.toFixed(2)}` : `-$${Math.abs(log.profit).toFixed(2)}`}
                                                </span>
                                            ) : (
                                                <span style={{ color: 'var(--ct-text-subtle)', fontSize: '0.78rem' }}>
                                                    {log.error_message || 'In Execution'}
                                                </span>
                                            )}
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>

                {/* Mobile Responsive Trade Cards View */}
                <div className='ct-mobile-history-list'>
                    {filteredLogs.length === 0 ? (
                        <div className='ct-mobile-history-empty'>
                            No copied trades yet.
                        </div>
                    ) : (
                        filteredLogs.map(log => (
                            <div key={log.id} className='ct-mobile-history-card'>
                                <div className='ct-mobile-history-card__top'>
                                    <div className='ct-mobile-history-card__symbol'>
                                        <strong>{log.symbol}</strong> ({log.contract_type})
                                    </div>
                                    <span
                                        className={`ct-audit-section__status-pill ct-audit-section__status-pill--${log.status}`}
                                    >
                                        {log.status}
                                    </span>
                                </div>

                                <div className='ct-mobile-history-card__meta'>
                                    <span>
                                        Follower: <strong>{log.copier_loginid}</strong> (
                                        <span style={{ color: log.is_virtual ? '#f59e0b' : '#10b981', fontWeight: 700 }}>
                                            {log.is_virtual ? 'Demo' : 'Real'}
                                        </span>
                                        )
                                    </span>
                                    <span>Time: {log.time}</span>
                                </div>

                                <div className='ct-mobile-history-card__bottom'>
                                    <div>
                                        Stake: <strong>${log.copier_stake.toFixed(2)}</strong>
                                    </div>
                                    <div>
                                        {log.profit !== undefined ? (
                                            <span
                                                style={{
                                                    color: log.profit >= 0 ? '#10b981' : '#f43f5e',
                                                    fontWeight: 800,
                                                    fontSize: '0.9rem',
                                                }}
                                            >
                                                {log.profit >= 0 ? `+$${log.profit.toFixed(2)}` : `-$${Math.abs(log.profit).toFixed(2)}`}
                                            </span>
                                        ) : (
                                            <span style={{ color: 'var(--ct-text-subtle)', fontSize: '0.74rem' }}>
                                                {log.error_message || 'Executing'}
                                            </span>
                                        )}
                                    </div>
                                </div>
                            </div>
                        ))
                    )}
                </div>
            </section>
        </div>
    );
});

export default CopyTradingPage;
