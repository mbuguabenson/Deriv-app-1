import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { observer } from 'mobx-react-lite';
import { useStore } from '@/hooks/useStore';
import {
    copyTradingService,
    CopierAccount,
    CopierTradeLog,
    MasterAccountConfig,
    TradeParameters,
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
    const [inputAlias, setInputAlias] = useState('');
    const [sizingMode, setSizingMode] = useState<'multiplier' | 'fixed'>('multiplier');
    const [multiplierValue, setMultiplierValue] = useState<number>(1.0);
    const [fixedStakeValue, setFixedStakeValue] = useState<number>(1.0);

    // Live validation state for dock
    const [isValidating, setIsValidating] = useState(false);
    const [validationResult, setValidationResult] = useState<{
        valid?: boolean;
        loginid?: string;
        is_virtual?: boolean;
        balance?: number;
        currency?: string;
        scopes?: string[];
        app_id?: string;
        error?: string;
    } | null>(null);

    // Risk Controls state
    const [maxStakeGuard, setMaxStakeGuard] = useState<number>(
        copyTradingService.getMasterConfig().max_stake_guard || 50.0
    );
    const [dailyLossLimit, setDailyLossLimit] = useState<number>(
        copyTradingService.getMasterConfig().daily_loss_limit || 100.0
    );

    // Audit log filter
    const [logFilter, setLogFilter] = useState<'all' | 'real' | 'demo' | 'won' | 'lost'>('all');

    // Synchronize with copyTradingService
    useEffect(() => {
        copyTradingService.init();

        const updateState = () => {
            setAccounts(copyTradingService.getAccounts());
            setTradeLogs(copyTradingService.getTradeLogs());
            setMasterConfig(copyTradingService.getMasterConfig());
        };

        updateState();
        const unsubscribe = copyTradingService.subscribe(updateState);

        // Auto sync active client account if master is unset
        if (client?.loginid) {
            const currentToken = getAccountsList()[client.loginid] || '';
            const isVirtual = Boolean(
                client.is_virtual ||
                    client.loginid.startsWith('VRTC') ||
                    client.loginid.startsWith('VRW')
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
        (tokenToValidate: string) => {
            const cleaned = copyTradingService.sanitizeToken(tokenToValidate);
            if (!cleaned || cleaned.length < 4) {
                setValidationResult(null);
                setIsValidating(false);
                return;
            }

            if (validationTimerRef.current) {
                clearTimeout(validationTimerRef.current);
            }

            setIsValidating(true);
            validationTimerRef.current = setTimeout(async () => {
                try {
                    const res = await copyTradingService.validateToken(cleaned);
                    setValidationResult(res);
                    if (res.valid && !inputAlias) {
                        setInputAlias(`${res.is_virtual ? 'Demo' : 'Real'} (${res.loginid})`);
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
        [inputAlias]
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

        const res = await copyTradingService.addCopierAccount({
            token: cleaned,
            alias: inputAlias,
            sizing_mode: sizingMode,
            multiplier: multiplierValue,
            fixed_stake: fixedStakeValue,
        });

        if (res.success) {
            setInputToken('');
            setInputAlias('');
            setValidationResult(null);
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
        if (!res.success) {
            alert(res.error || 'Failed to add account');
        }
    };

    // Toggle master global copier status
    const handleToggleMasterCopier = () => {
        copyTradingService.setMasterConfig({
            is_active: !masterConfig.is_active,
        });
    };

    // Update risk guards
    const handleUpdateMaxStakeGuard = (val: number) => {
        setMaxStakeGuard(val);
        copyTradingService.setMasterConfig({ max_stake_guard: val });
    };

    const handleUpdateDailyLossLimit = (val: number) => {
        setDailyLossLimit(val);
        copyTradingService.setMasterConfig({ daily_loss_limit: val });
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
                            width='24'
                            height='24'
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
                            Copy Trading Suite
                            <span className='ct-header-bar__badge-tag'>Universal Cross-Tab Mirror</span>
                        </div>
                        <p className='ct-header-bar__desc'>
                            Institutional low-latency trade replication across all Deriv accounts.
                        </p>
                    </div>
                </div>

                <div className='ct-header-bar__right'>
                    {/* Master Account Info Card */}
                    <div className='ct-header-bar__master-pill'>
                        <span className='ct-header-bar__master-label'>Master Source:</span>
                        <span className={`ct-header-bar__master-badge ${masterConfig.is_virtual ? 'demo' : 'real'}`}>
                            {masterConfig.is_virtual ? 'DEMO' : 'REAL'}
                        </span>
                        <span className='ct-header-bar__master-id'>
                            {masterConfig.loginid || 'Session Active'}
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
                    <div className='ct-header-bar__switch-container'>
                        <button
                            type='button'
                            className={`ct-header-bar__toggle-btn ${masterConfig.is_active ? 'active' : 'paused'}`}
                            onClick={handleToggleMasterCopier}
                        >
                            <span className='indicator-dot' />
                            {masterConfig.is_active ? 'COPY TRADING ACTIVE' : 'REPLICATION PAUSED'}
                        </button>
                    </div>

                    <button
                        className='ct-header-bar__btn ct-header-bar__btn--secondary'
                        onClick={() => copyTradingService.refreshAllBalances()}
                        title='Fetch latest balances across all Deriv accounts'
                    >
                        <svg width='15' height='15' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2'>
                            <path d='M23 4v6h-6' />
                            <path d='M1 20v-6h6' />
                            <path d='M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15' />
                        </svg>
                        Refresh
                    </button>
                </div>
            </header>

            {/* 2. UNIVERSAL MIRROR NOTIFICATION BANNER */}
            <div className={`ct-universal-banner ${masterConfig.is_active ? 'active' : 'paused'}`}>
                <div className='ct-universal-banner__left'>
                    <span className={`ct-pulse-dot ${masterConfig.is_active ? 'running' : 'paused'}`} />
                    <span className='ct-universal-banner__text'>
                        {masterConfig.is_active ? (
                            <>
                                <strong>Universal Real-Time Mirror Active:</strong> Any trade placed on <strong>Elite Pro</strong>, <strong>Overlord AI</strong>, <strong>Poverty Hunter</strong>, <strong>Auto X E/O</strong>, <strong>Scanner</strong>, <strong>Manual Trading</strong>, or <strong>Bot Builder</strong> automatically replicates to all active follower accounts.
                            </>
                        ) : (
                            <>
                                <strong>Replication Paused:</strong> Trades executed on other tabs are currently not being mirrored. Click <strong>COPY TRADING ACTIVE</strong> above to resume replication.
                            </>
                        )}
                    </span>
                </div>
                <div className='ct-universal-banner__count'>
                    {activeCount} of {accounts.length} Accounts Active
                </div>
            </div>

            {/* 3. PERFORMANCE SUMMARY BAR */}
            <div className='ct-stats-bar'>
                <div className='ct-stat-box'>
                    <div className='ct-stat-box__icon ct-stat-box__icon--emerald'>
                        <svg width='20' height='20' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2'>
                            <path d='M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2' />
                            <circle cx='9' cy='7' r='4' />
                            <path d='M23 21v-2a4 4 0 0 0-3-3.87' />
                            <path d='M16 3.13a4 4 0 0 1 0 7.75' />
                        </svg>
                    </div>
                    <div>
                        <div className='ct-stat-box__label'>Follower Accounts</div>
                        <div className='ct-stat-box__value'>
                            {activeCount} <span style={{ fontSize: '0.82rem', color: 'var(--ct-text-subtle)' }}>/ {accounts.length} Active</span>
                        </div>
                        <div className='ct-stat-box__sub'>{realCount} Real • {demoCount} Demo</div>
                    </div>
                </div>

                <div className='ct-stat-box'>
                    <div className='ct-stat-box__icon ct-stat-box__icon--cyan'>
                        <svg width='20' height='20' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2'>
                            <polyline points='23 6 13.5 15.5 8.5 10.5 1 18' />
                            <polyline points='17 6 23 6 23 12' />
                        </svg>
                    </div>
                    <div>
                        <div className='ct-stat-box__label'>Total Replicated Trades</div>
                        <div className='ct-stat-box__value'>{tradeLogs.length}</div>
                        <div className='ct-stat-box__sub'>All Connected Accounts</div>
                    </div>
                </div>

                <div className='ct-stat-box'>
                    <div className='ct-stat-box__icon ct-stat-box__icon--indigo'>
                        <svg width='20' height='20' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2'>
                            <circle cx='12' cy='12' r='10' />
                            <line x1='12' y1='8' x2='12' y2='12' />
                            <line x1='12' y1='16' x2='12.01' y2='16' />
                        </svg>
                    </div>
                    <div>
                        <div className='ct-stat-box__label'>Max Stake Guard</div>
                        <div className='ct-stat-box__value'>${maxStakeGuard.toFixed(2)}</div>
                        <div className='ct-stat-box__sub'>Auto Stake Capping</div>
                    </div>
                </div>

                <div className='ct-stat-box'>
                    <div className='ct-stat-box__icon ct-stat-box__icon--amber'>
                        <svg width='20' height='20' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2'>
                            <path d='M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6' />
                        </svg>
                    </div>
                    <div>
                        <div className='ct-stat-box__label'>Copied Trades P&L</div>
                        <div className={`ct-stat-box__value ${totalProfitCalculated >= 0 ? 'text-win' : 'text-loss'}`}>
                            {totalProfitCalculated >= 0 ? `+$${totalProfitCalculated.toFixed(2)}` : `-$${Math.abs(totalProfitCalculated).toFixed(2)}`}
                        </div>
                        <div className='ct-stat-box__sub'>Session Replication Return</div>
                    </div>
                </div>
            </div>

            {/* 4. MAIN WORKSPACE: FOLLOWER POOL & CONNECT DOCK */}
            <div className='ct-workspace-grid'>
                {/* LEFT: Follower Copiers Pool */}
                <section className='ct-copier-pool'>
                    <div className='ct-copier-pool__header'>
                        <h2 className='ct-copier-pool__title'>
                            <svg width='18' height='18' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2'>
                                <path d='M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2' />
                                <circle cx='9' cy='7' r='4' />
                            </svg>
                            Target Follower Accounts
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
                                Connect a Follower Account to Mirror Trades
                            </h3>
                            <p className='ct-empty-pool-card__desc'>
                                Use the Connect Dock on the right to paste a Deriv API Token (PAT) or pick an active session account to mirror demo or real trades automatically.
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

                                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                                            <span
                                                className={`ct-pool-card__status-pill ${
                                                    acc.is_active
                                                        ? 'ct-pool-card__status-pill--active'
                                                        : 'ct-pool-card__status-pill--paused'
                                                }`}
                                            >
                                                {acc.is_active ? '● Active Mirror' : '○ Paused'}
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

                                        <div className='ct-pool-card__metric-cell'>
                                            <span className='ct-pool-card__metric-label'>Sizing Mode</span>
                                            <span className='ct-pool-card__metric-value'>
                                                {acc.sizing_mode === 'multiplier'
                                                    ? `${acc.multiplier}x Stake`
                                                    : `$${acc.fixed_stake?.toFixed(2)} Fixed`}
                                            </span>
                                        </div>
                                    </div>

                                    {/* Quick Stake Sizing Presets */}
                                    <div className='ct-pool-card__controls-row'>
                                        <div className='ct-pool-card__sizing-pill-group'>
                                            <span style={{ fontSize: '0.72rem', color: 'var(--ct-text-subtle)', fontWeight: 800, textTransform: 'uppercase', marginRight: '0.2rem' }}>
                                                Multiplier:
                                            </span>
                                            {[0.5, 1.0, 1.5, 2.0].map(mult => (
                                                <button
                                                    key={mult}
                                                    type='button'
                                                    className={acc.sizing_mode === 'multiplier' && acc.multiplier === mult ? 'active' : ''}
                                                    onClick={() =>
                                                        copyTradingService.updateCopierAccount(acc.id, {
                                                            sizing_mode: 'multiplier',
                                                            multiplier: mult,
                                                        })
                                                    }
                                                >
                                                    {mult}x
                                                </button>
                                            ))}
                                            <button
                                                type='button'
                                                className={acc.sizing_mode === 'fixed' ? 'active' : ''}
                                                onClick={() =>
                                                    copyTradingService.updateCopierAccount(acc.id, {
                                                        sizing_mode: 'fixed',
                                                        fixed_stake: 1.0,
                                                    })
                                                }
                                            >
                                                Fixed $1
                                            </button>
                                        </div>

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
                            ))}
                        </div>
                    )}
                </section>

                {/* RIGHT: Connect Follower Account Dock & Risk Guards */}
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
                                Deriv API Token (PAT)
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
                                <div className='ct-connect-dock__field'>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                        <label>Deriv API Token (PAT)</label>
                                        <button
                                            type='button'
                                            onClick={handlePasteFromClipboard}
                                            style={{
                                                background: 'rgba(6, 182, 212, 0.12)',
                                                border: '1px solid rgba(6, 182, 212, 0.3)',
                                                color: '#06b6d4',
                                                borderRadius: '6px',
                                                padding: '0.15rem 0.5rem',
                                                fontSize: '0.72rem',
                                                fontWeight: 700,
                                                cursor: 'pointer',
                                            }}
                                            title='Paste token from clipboard and auto-clean'
                                        >
                                            📋 Paste
                                        </button>
                                    </div>
                                    <input
                                        type='text'
                                        placeholder='Paste Deriv API Token (e.g. a1-abcdef12345...)'
                                        value={inputToken}
                                        onChange={e => {
                                            setInputToken(e.target.value);
                                            handleValidateToken(e.target.value);
                                        }}
                                    />
                                    <span style={{ fontSize: '0.72rem', color: 'var(--ct-text-subtle)' }}>
                                        Generated on{' '}
                                        <a
                                            href='https://app.deriv.com/account/api-token'
                                            target='_blank'
                                            rel='noopener noreferrer'
                                            style={{ color: '#06b6d4', textDecoration: 'underline' }}
                                        >
                                            app.deriv.com/account/api-token
                                        </a>{' '}
                                        with <strong>Read</strong> & <strong>Trade</strong> scopes.
                                    </span>
                                </div>

                                {/* Live WebSocket validation preview */}
                                {isValidating && (
                                    <div className='ct-connect-dock__live-preview'>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', color: '#06b6d4', fontSize: '0.82rem' }}>
                                            <span className='ct-pulse-dot' />
                                            Verifying Deriv token across API endpoints...
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
                                            </>
                                        ) : (
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                                                <div style={{ color: '#f43f5e', fontSize: '0.84rem', fontWeight: 800 }}>
                                                    ⚠️ {validationResult.error || 'The token is invalid.'}
                                                </div>
                                                <div
                                                    style={{
                                                        fontSize: '0.75rem',
                                                        color: 'var(--ct-text-muted)',
                                                        lineHeight: '1.45',
                                                        borderTop: '1px solid rgba(255, 255, 255, 0.08)',
                                                        paddingTop: '0.45rem',
                                                    }}
                                                >
                                                    <strong style={{ color: 'var(--ct-text-title)' }}>How to fix this:</strong>
                                                    <ol style={{ margin: '0.3rem 0 0', paddingLeft: '1.1rem' }}>
                                                        <li>
                                                            Open{' '}
                                                            <a
                                                                href='https://app.deriv.com/account/api-token'
                                                                target='_blank'
                                                                rel='noopener noreferrer'
                                                                style={{ color: '#06b6d4', textDecoration: 'underline' }}
                                                            >
                                                                app.deriv.com/account/api-token
                                                            </a>
                                                        </li>
                                                        <li>Switch to your target account (Demo or Real) on Deriv</li>
                                                        <li>
                                                            Check both <strong>Read</strong> and <strong>Trade</strong> checkboxes
                                                        </li>
                                                        <li>Click <strong>Create</strong>, copy the new token and paste it here</li>
                                                    </ol>
                                                    <div style={{ marginTop: '0.4rem', color: '#f59e0b' }}>
                                                        💡 <em>Tip: You can also click the <strong>Session Accounts</strong> tab above to link your active accounts in 1 click!</em>
                                                    </div>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                )}

                                <div className='ct-connect-dock__field'>
                                    <label>Account Label / Alias</label>
                                    <input
                                        type='text'
                                        placeholder='e.g. My Real Account 1'
                                        value={inputAlias}
                                        onChange={e => setInputAlias(e.target.value)}
                                    />
                                </div>

                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.8rem' }}>
                                    <div className='ct-connect-dock__field'>
                                        <label>Stake Sizing Mode</label>
                                        <select
                                            value={sizingMode}
                                            onChange={e => setSizingMode(e.target.value as 'multiplier' | 'fixed')}
                                        >
                                            <option value='multiplier'>Multiplier (x)</option>
                                            <option value='fixed'>Fixed Stake ($)</option>
                                        </select>
                                    </div>

                                    <div className='ct-connect-dock__field'>
                                        <label>{sizingMode === 'multiplier' ? 'Multiplier (x)' : 'Fixed Stake ($)'}</label>
                                        {sizingMode === 'multiplier' ? (
                                            <input
                                                type='number'
                                                step='0.1'
                                                min='0.1'
                                                max='10'
                                                value={multiplierValue}
                                                onChange={e => setMultiplierValue(parseFloat(e.target.value) || 1)}
                                            />
                                        ) : (
                                            <input
                                                type='number'
                                                step='0.5'
                                                min='0.35'
                                                value={fixedStakeValue}
                                                onChange={e => setFixedStakeValue(parseFloat(e.target.value) || 1)}
                                            />
                                        )}
                                    </div>
                                </div>

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
                                    Link & Enable Follower
                                </button>
                            </>
                        ) : (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.8rem' }}>
                                <p style={{ fontSize: '0.8rem', color: 'var(--ct-text-muted)', margin: '0 0 0.4rem' }}>
                                    Active Deriv accounts detected in your current browser session:
                                </p>
                                {storedAccounts.length === 0 ? (
                                    <div style={{ textAlign: 'center', padding: '1.5rem', color: 'var(--ct-text-subtle)', fontSize: '0.82rem' }}>
                                        No other accounts detected in this browser session. Paste a PAT token in the first tab.
                                    </div>
                                ) : (
                                    storedAccounts.map(acc => {
                                        const isAlreadyAdded = accounts.some(a => a.loginid === acc.loginid);
                                        return (
                                            <div
                                                key={acc.loginid}
                                                style={{
                                                    background: 'rgba(0,0,0,0.3)',
                                                    border: '1px solid var(--ct-border)',
                                                    borderRadius: '10px',
                                                    padding: '0.7rem 0.9rem',
                                                    display: 'flex',
                                                    justifyContent: 'space-between',
                                                    alignItems: 'center',
                                                }}
                                            >
                                                <div>
                                                    <div style={{ fontWeight: 800, fontSize: '0.86rem', color: 'var(--ct-text-title)' }}>
                                                        {acc.loginid}
                                                    </div>
                                                    <span
                                                        style={{
                                                            fontSize: '0.7rem',
                                                            color: acc.is_virtual ? '#f59e0b' : '#10b981',
                                                            fontWeight: 700,
                                                        }}
                                                    >
                                                        {acc.is_virtual ? 'Demo Account' : 'Real Account'}
                                                    </span>
                                                </div>

                                                <button
                                                    type='button'
                                                    className='ct-header-bar__btn ct-header-bar__btn--primary'
                                                    disabled={isAlreadyAdded}
                                                    onClick={() => handleAddStoredAccount(acc)}
                                                    style={{ padding: '0.35rem 0.7rem', fontSize: '0.76rem' }}
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

                    {/* Capital Protection & Risk Guards */}
                    <div className='ct-action-card'>
                        <h4 className='ct-action-card__title'>
                            <svg width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2'>
                                <path d='M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z' />
                            </svg>
                            Capital Protection Guards
                        </h4>

                        <div className='ct-action-card__grid'>
                            <div className='ct-action-card__input-wrap'>
                                <label>Max Single Stake Cap ($)</label>
                                <input
                                    type='number'
                                    step='5'
                                    min='1'
                                    value={maxStakeGuard}
                                    onChange={e => handleUpdateMaxStakeGuard(parseFloat(e.target.value) || 50)}
                                />
                            </div>

                            <div className='ct-action-card__input-wrap'>
                                <label>Daily Loss Cutoff ($)</label>
                                <input
                                    type='number'
                                    step='10'
                                    min='5'
                                    value={dailyLossLimit}
                                    onChange={e => handleUpdateDailyLossLimit(parseFloat(e.target.value) || 100)}
                                />
                            </div>
                        </div>

                        <div className='ct-risk-notice'>
                            <strong>Risk Guard:</strong> If any tab places a stake that would scale above ${maxStakeGuard.toFixed(2)}, the follower stake is automatically capped at ${maxStakeGuard.toFixed(2)} to protect capital.
                        </div>
                    </div>
                </div>
            </div>

            {/* 5. LIVE COPIED TRADES AUDIT TABLE & FILTERS */}
            <section className='ct-audit-section'>
                <div className='ct-audit-section__top'>
                    <div className='ct-audit-section__title-area'>
                        <svg width='18' height='18' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2'>
                            <polyline points='22 12 18 12 15 21 9 3 6 12 2 12' />
                        </svg>
                        <h3 className='ct-audit-section__title'>Real-Time Copied Trades Audit Log</h3>
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
                            Real Accounts
                        </button>
                        <button
                            type='button'
                            className={`ct-audit-section__filter-btn ${logFilter === 'demo' ? 'active' : ''}`}
                            onClick={() => setLogFilter('demo')}
                        >
                            Demo Accounts
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
                                Clear Log
                            </button>
                        )}
                    </div>
                </div>

                <div className='ct-audit-section__table-wrap'>
                    <table className='ct-audit-section__table'>
                        <thead>
                            <tr>
                                <th>Time</th>
                                <th>Source Tab</th>
                                <th>Master</th>
                                <th>Follower Account</th>
                                <th>Type</th>
                                <th>Market</th>
                                <th>Contract</th>
                                <th>Master Stake</th>
                                <th>Copier Stake</th>
                                <th>Status</th>
                                <th>P&L Result</th>
                            </tr>
                        </thead>
                        <tbody>
                            {filteredLogs.length === 0 ? (
                                <tr>
                                    <td colSpan={11} style={{ textAlign: 'center', padding: '2.5rem', color: 'var(--ct-text-muted)' }}>
                                        No copied trades yet. When you place a trade on Elite Pro, Overlord AI, Poverty Hunter, Auto X, Scanner, or Manual Trading, it will mirror and record here automatically.
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
                                                {log.master_loginid}
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
                                                    padding: '0.2rem 0.45rem',
                                                    borderRadius: '5px',
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
                                                <span style={{ color: 'var(--ct-text-subtle)' }}>
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
            </section>
        </div>
    );
});

export default CopyTradingPage;
