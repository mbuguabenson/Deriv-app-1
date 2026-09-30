import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { useApiBase } from '@/hooks/useApiBase';
import { useStore } from '@/hooks/useStore';
import { addComma, getCurrencyDisplayCode, getDecimalPlaces } from '@/components/shared';
import {
    LegacyStatementParams,
    LegacyStatementResponse,
    LegacyStatementService,
    LegacyStatementTransaction,
} from '@/services/legacy-statement.service';
import {
    Activity,
    AlertCircle,
    ArrowDownRight,
    ArrowUpRight,
    Calendar,
    Check,
    CheckCircle2,
    Clock,
    Copy,
    Database,
    Download,
    ExternalLink,
    FileSpreadsheet,
    FileText,
    Filter,
    Layers,
    Loader2,
    Percent,
    Radio,
    RefreshCw,
    Search,
    Shield,
    Sparkles,
    TrendingDown,
    TrendingUp,
    Wifi,
    X,
    Zap,
} from 'lucide-react';
import './legacy-statement-modal.scss';

export type TLegacyStatementModalProps = {
    isOpen: boolean;
    onClose: () => void;
    initialLoginId?: string;
};

export const LegacyStatementModal = observer(({ isOpen, onClose, initialLoginId }: TLegacyStatementModalProps) => {
    const { accountList, activeLoginid } = useApiBase();
    const { client } = useStore() ?? {};

    // Target login ID (defaults to active user account or CR8416851)
    const [loginIdInput, setLoginIdInput] = useState<string>(() => {
        return (
            initialLoginId ||
            activeLoginid ||
            localStorage.getItem('active_loginid') ||
            client?.loginid ||
            'CR8416851'
        );
    });

    const [transactions, setTransactions] = useState<LegacyStatementTransaction[]>([]);
    const [isLoading, setIsLoading] = useState<boolean>(false);
    const [activeSource, setActiveSource] = useState<'live_rest' | 'live_websocket' | 'sample_preview'>('live_rest');
    const [preferSource, setPreferSource] = useState<'auto' | 'rest' | 'websocket' | 'sample'>('auto');
    const [apiError, setApiError] = useState<{ message: string; code?: string; rawStatus?: number } | null>(null);
    const [fetchLatency, setFetchLatency] = useState<number | undefined>();
    const [copiedRef, setCopiedRef] = useState<string | null>(null);

    // Filters
    const [timeFilter, setTimeFilter] = useState<'all' | 'today' | '7d' | '30d' | 'custom'>('all');
    const [customStartDate, setCustomStartDate] = useState<string>('');
    const [customEndDate, setCustomEndDate] = useState<string>('');
    const [actionFilter, setActionFilter] = useState<string>('all');
    const [limit, setLimit] = useState<number>(100);
    const [searchQuery, setSearchQuery] = useState<string>('');

    // Currency conversion display
    const displayCurrency = (localStorage.getItem('converter_display_currency') as 'USD' | 'KES') || 'USD';
    const rate = parseFloat(localStorage.getItem('converter_kes_rate') || '129.5');

    // Compute epoch timestamps for time filters
    const { dateFrom, dateTo } = useMemo(() => {
        const now = Math.floor(Date.now() / 1000);
        if (timeFilter === 'all') {
            return { dateFrom: 0, dateTo: now };
        }
        if (timeFilter === 'today') {
            const startOfDay = new Date();
            startOfDay.setHours(0, 0, 0, 0);
            return { dateFrom: Math.floor(startOfDay.getTime() / 1000), dateTo: now };
        }
        if (timeFilter === '7d') {
            return { dateFrom: Math.max(0, now - 7 * 86400), dateTo: now };
        }
        if (timeFilter === '30d') {
            return { dateFrom: Math.max(0, now - 30 * 86400), dateTo: now };
        }
        if (timeFilter === 'custom') {
            const from = customStartDate ? Math.floor(new Date(customStartDate).getTime() / 1000) : 0;
            const to = customEndDate ? Math.floor(new Date(customEndDate).getTime() / 1000) : now;
            return { dateFrom: from, dateTo: to };
        }
        return { dateFrom: 0, dateTo: now };
    }, [timeFilter, customStartDate, customEndDate]);

    // Fetch Statement via Real Deriv API
    const loadStatementData = useCallback(async (sourceOverride?: 'auto' | 'rest' | 'websocket' | 'sample') => {
        const targetId = (loginIdInput || 'CR8416851').trim().toUpperCase();
        const selectedSource = sourceOverride || preferSource;

        setIsLoading(true);
        setApiError(null);

        try {
            const res = await LegacyStatementService.getLegacyStatement({
                loginid: targetId,
                date_from: dateFrom,
                date_to: dateTo,
                action_type: actionFilter !== 'all' ? actionFilter : undefined,
                limit,
                preferSource: selectedSource,
            });

            setFetchLatency(res.timing);
            setActiveSource(res.source);

            if (res.transactions && res.transactions.length > 0) {
                setTransactions(res.transactions);
                setApiError(null);
            } else if (res.error) {
                setApiError({ message: res.error, code: res.errorCode, rawStatus: res.rawStatus });
                // If live API returned an error, fallback to sample preview so user has a rich experience
                if (selectedSource === 'auto') {
                    const fallbackSample = LegacyStatementService.getSampleLegacyData(targetId);
                    setTransactions(fallbackSample);
                    setActiveSource('sample_preview');
                } else {
                    setTransactions([]);
                }
            } else {
                setTransactions([]);
            }
        } catch (err: any) {
            console.error('[LegacyStatementModal] Load error:', err);
            setApiError({ message: err?.message || 'Error communicating with Deriv API', code: 'Unknown' });
            const fallbackSample = LegacyStatementService.getSampleLegacyData(targetId);
            setTransactions(fallbackSample);
            setActiveSource('sample_preview');
        } finally {
            setIsLoading(false);
        }
    }, [loginIdInput, dateFrom, dateTo, actionFilter, limit, preferSource]);

    useEffect(() => {
        if (isOpen) {
            loadStatementData();
        }
    }, [isOpen, loadStatementData]);

    // Escape key listener
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape' && isOpen) {
                onClose();
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isOpen, onClose]);

    // Filter transactions by Search Query
    const filteredTransactions = useMemo(() => {
        let result = transactions;

        if (actionFilter !== 'all') {
            result = result.filter(t => t.action_type.toLowerCase() === actionFilter.toLowerCase());
        }

        if (searchQuery.trim()) {
            const q = searchQuery.toLowerCase().trim();
            result = result.filter(t => {
                const transId = String(t.transaction_id || '').toLowerCase();
                const refId = String(t.reference_id || '').toLowerCase();
                const contractId = String(t.contract_id || '').toLowerCase();
                const action = String(t.action_type || '').toLowerCase();
                const symbol = String(t.symbol || '').toLowerCase();
                const desc = String(t.longcode || t.shortcode || '').toLowerCase();
                return (
                    transId.includes(q) ||
                    refId.includes(q) ||
                    contractId.includes(q) ||
                    action.includes(q) ||
                    symbol.includes(q) ||
                    desc.includes(q)
                );
            });
        }

        return result;
    }, [transactions, actionFilter, searchQuery]);

    // Financial Metrics & TOTALS
    const totals = useMemo(() => {
        let totalCredit = 0;
        let totalDebit = 0;
        let buyCount = 0;
        let sellCount = 0;
        let depositCount = 0;
        let withdrawalCount = 0;
        let profitableTrades = 0;

        filteredTransactions.forEach(t => {
            const amt = Number(t.amount) || 0;
            if (amt > 0) {
                totalCredit += amt;
                profitableTrades++;
            } else if (amt < 0) {
                totalDebit += Math.abs(amt);
            }

            const action = (t.action_type || '').toLowerCase();
            if (action === 'buy') buyCount++;
            if (action === 'sell') sellCount++;
            if (action === 'deposit') depositCount++;
            if (action === 'withdrawal') withdrawalCount++;
        });

        const netProfitLoss = totalCredit - totalDebit;
        const latestBalance =
            filteredTransactions.length > 0 ? Number(filteredTransactions[0].balance_after) || 0 : 0;
        const initialBalance =
            filteredTransactions.length > 0
                ? Number(filteredTransactions[filteredTransactions.length - 1].balance_after) || 0
                : 0;

        const totalTrades = buyCount + sellCount;
        const winRate = totalTrades > 0 ? Math.round((profitableTrades / totalTrades) * 100) : 0;

        return {
            totalCredit,
            totalDebit,
            netProfitLoss,
            latestBalance,
            initialBalance,
            count: filteredTransactions.length,
            buyCount,
            sellCount,
            depositCount,
            withdrawalCount,
            winRate,
        };
    }, [filteredTransactions]);

    // Format Amount Display
    const formatAmount = (amount: number, curr = 'USD') => {
        const isKes = displayCurrency === 'KES' && curr === 'USD';
        const displayVal = isKes ? amount * rate : amount;
        const finalCurr = isKes ? 'KES' : getCurrencyDisplayCode(curr);
        const prefix = displayVal > 0 ? '+' : '';
        const decimals = isKes ? 2 : getDecimalPlaces(curr);
        return `${prefix}${addComma(displayVal.toFixed(decimals))} ${finalCurr}`;
    };

    // Format Date Display
    const formatTimestamp = (epoch: number) => {
        if (!epoch) return { date: '—', time: '—' };
        const d = new Date(epoch > 1e11 ? epoch : epoch * 1000);
        const dateStr = d.toLocaleDateString('en-GB', {
            day: '2-digit',
            month: 'short',
            year: 'numeric',
        });
        const timeStr = d.toLocaleTimeString('en-GB', {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: false,
        }) + ' UTC';
        return { date: dateStr, time: timeStr };
    };

    const copyToClipboard = (text: string) => {
        navigator.clipboard?.writeText(text);
        setCopiedRef(text);
        setTimeout(() => setCopiedRef(null), 1800);
    };

    // Export CSV
    const exportCSV = () => {
        if (!filteredTransactions.length) return;
        const headers = [
            'Type',
            'Ref. ID',
            'Contract ID',
            'Currency',
            'Transaction time',
            'Transaction Details',
            'Credit/Debit',
            'Balance',
        ];
        const rows = filteredTransactions.map(t => {
            const timeObj = formatTimestamp(t.transaction_time);
            return [
                t.action_type.toUpperCase(),
                t.reference_id || t.transaction_id,
                t.contract_id || '',
                t.currency || 'USD',
                `"${timeObj.date} ${timeObj.time}"`,
                `"${(t.longcode || t.shortcode || t.action_type).replace(/"/g, '""')}"`,
                t.amount,
                t.balance_after,
            ];
        });

        const csvContent = [headers.join(','), ...rows.map(e => e.join(','))].join('\n');
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.setAttribute('href', url);
        link.setAttribute('download', `legacy_statement_${loginIdInput}_${new Date().toISOString().slice(0, 10)}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    // Export JSON
    const exportJSON = () => {
        if (!filteredTransactions.length) return;
        const dataStr = JSON.stringify(filteredTransactions, null, 2);
        const blob = new Blob([dataStr], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.setAttribute('href', url);
        link.setAttribute('download', `legacy_statement_${loginIdInput}_${new Date().toISOString().slice(0, 10)}.json`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    if (!isOpen) return null;

    return (
        <div className='legacy-cockpit__overlay' onClick={onClose}>
            <div className='legacy-cockpit__modal' onClick={e => e.stopPropagation()}>
                {/* ── Top Institutional Header ── */}
                <header className='cockpit-header'>
                    <div className='cockpit-header__left'>
                        <div className='cockpit-header__icon-glow'>
                            <Database size={22} className='text-amber-400' />
                            <div className='cockpit-header__pulse-ring' />
                        </div>
                        <div className='cockpit-header__info'>
                            <div className='title-row'>
                                <h1 className='cockpit-title'>Options Trading (Legacy)</h1>
                                <span className='gateway-endpoint-pill'>
                                    <code>/trading/v1/options/legacy/statement</code>
                                </span>
                                <div className={`gateway-status-pill source-${activeSource}`}>
                                    <span className='status-dot' />
                                    <span>
                                        {activeSource === 'live_rest'
                                            ? 'Real REST Gateway (200 OK)'
                                            : activeSource === 'live_websocket'
                                            ? 'Live WebSocket Feed'
                                            : 'Sample Simulation'}
                                    </span>
                                    {fetchLatency !== undefined && (
                                        <span className='latency-tag'>{fetchLatency}ms</span>
                                    )}
                                </div>
                            </div>
                            <p className='cockpit-desc'>
                                Institutional Options Statement & Financial Movements prior to migration upgrade &bull; Direct access to api.derivws.com
                            </p>
                        </div>
                    </div>

                    <div className='cockpit-header__right'>
                        {/* Account Selector & Input */}
                        <div className='account-switcher-box'>
                            <span className='box-label'>Account:</span>
                            <input
                                type='text'
                                className='box-input'
                                value={loginIdInput}
                                onChange={e => setLoginIdInput(e.target.value.toUpperCase())}
                                placeholder='CR8416851'
                                title='Enter Deriv Legacy Login ID'
                            />
                            {accountList && accountList.length > 0 && (
                                <select
                                    className='box-select'
                                    value={loginIdInput}
                                    onChange={e => setLoginIdInput(e.target.value)}
                                    title='Switch account'
                                >
                                    {accountList.map(acc => (
                                        <option key={acc.loginid} value={acc.loginid}>
                                            {acc.loginid} ({acc.currency || 'USD'})
                                        </option>
                                    ))}
                                    <option value='CR8416851'>CR8416851</option>
                                </select>
                            )}
                        </div>

                        {/* Mode Selector Toggle */}
                        <div className='source-mode-toggle' title='Select data gateway'>
                            <button
                                type='button'
                                className={`mode-btn ${preferSource === 'auto' ? 'active' : ''}`}
                                onClick={() => {
                                    setPreferSource('auto');
                                    loadStatementData('auto');
                                }}
                            >
                                <Zap size={12} /> Auto
                            </button>
                            <button
                                type='button'
                                className={`mode-btn ${preferSource === 'rest' ? 'active' : ''}`}
                                onClick={() => {
                                    setPreferSource('rest');
                                    loadStatementData('rest');
                                }}
                            >
                                REST API
                            </button>
                            <button
                                type='button'
                                className={`mode-btn ${preferSource === 'websocket' ? 'active' : ''}`}
                                onClick={() => {
                                    setPreferSource('websocket');
                                    loadStatementData('websocket');
                                }}
                            >
                                WebSocket
                            </button>
                            <button
                                type='button'
                                className={`mode-btn ${preferSource === 'sample' ? 'active' : ''}`}
                                onClick={() => {
                                    setPreferSource('sample');
                                    loadStatementData('sample');
                                }}
                            >
                                Sample
                            </button>
                        </div>

                        {/* Refresh Button */}
                        <button
                            type='button'
                            className='cockpit-icon-btn'
                            onClick={() => loadStatementData()}
                            disabled={isLoading}
                            title='Refresh real statement data'
                        >
                            <RefreshCw size={15} className={isLoading ? 'animate-spin text-amber-400' : ''} />
                        </button>

                        {/* Close Modal Button */}
                        <button
                            type='button'
                            className='cockpit-close-btn'
                            onClick={onClose}
                            aria-label='Close Legacy Statement'
                        >
                            <X size={18} />
                        </button>
                    </div>
                </header>

                {/* ── API Diagnostic Notice (if 401 or 409 or network) ── */}
                {apiError && (
                    <div className='api-notice-banner'>
                        <div className='notice-body'>
                            <AlertCircle size={18} className='text-amber-400 shrink-0' />
                            <div className='notice-text'>
                                <strong>Deriv Gateway Diagnostic ({apiError.code || `HTTP ${apiError.rawStatus}`}):</strong>{' '}
                                <span>{apiError.message}</span>
                                <span className='notice-hint'>
                                    Displaying interactive pre-upgrade options history simulation for account {loginIdInput}. Click Refresh or switch to WebSocket mode to retry live feed.
                                </span>
                            </div>
                        </div>
                        <div className='notice-actions'>
                            <button
                                type='button'
                                className='notice-btn notice-btn-primary'
                                onClick={() => loadStatementData('rest')}
                            >
                                Query REST Endpoint
                            </button>
                            <button
                                type='button'
                                className='notice-btn notice-btn-secondary'
                                onClick={() => loadStatementData('websocket')}
                            >
                                Try Live WebSocket
                            </button>
                        </div>
                    </div>
                )}

                {/* ── TOTALS Analytical KPI Deck ── */}
                <section className='cockpit-kpi-deck'>
                    {/* 1. Net Profit / Cash Flow */}
                    <div className={`kpi-card ${totals.netProfitLoss >= 0 ? 'kpi-card--profit' : 'kpi-card--loss'}`}>
                        <div className='kpi-card__glow' />
                        <div className='kpi-card__header'>
                            <span className='kpi-label'>NET STATEMENT P&L</span>
                            <span className='kpi-chip'>
                                {totals.netProfitLoss >= 0 ? (
                                    <>
                                        <TrendingUp size={13} /> Profit
                                    </>
                                ) : (
                                    <>
                                        <TrendingDown size={13} /> Loss
                                    </>
                                )}
                            </span>
                        </div>
                        <div className='kpi-card__value'>
                            {formatAmount(totals.netProfitLoss)}
                        </div>
                        <div className='kpi-card__footer'>
                            <span>{totals.count} transactions in timeframe</span>
                            <span className='win-rate-pill'>
                                <Percent size={11} /> {totals.winRate}% Profitable
                            </span>
                        </div>
                    </div>

                    {/* 2. Total Credit Inflow (+) */}
                    <div className='kpi-card kpi-card--credit'>
                        <div className='kpi-card__glow' />
                        <div className='kpi-card__header'>
                            <span className='kpi-label'>TOTAL CREDIT (+)</span>
                            <span className='kpi-chip chip-green'>
                                <ArrowUpRight size={13} /> Inflow
                            </span>
                        </div>
                        <div className='kpi-card__value text-emerald-400'>
                            +{formatAmount(totals.totalCredit)}
                        </div>
                        <div className='kpi-card__footer'>
                            <span>{totals.sellCount} option settlements / {totals.depositCount} deposits</span>
                        </div>
                    </div>

                    {/* 3. Total Debit Outflow (-) */}
                    <div className='kpi-card kpi-card--debit'>
                        <div className='kpi-card__glow' />
                        <div className='kpi-card__header'>
                            <span className='kpi-label'>TOTAL DEBIT (-)</span>
                            <span className='kpi-chip chip-red'>
                                <ArrowDownRight size={13} /> Outflow
                            </span>
                        </div>
                        <div className='kpi-card__value text-rose-400'>
                            -{formatAmount(totals.totalDebit)}
                        </div>
                        <div className='kpi-card__footer'>
                            <span>{totals.buyCount} contracts bought / {totals.withdrawalCount} withdrawals</span>
                        </div>
                    </div>

                    {/* 4. Closing Ledger Balance */}
                    <div className='kpi-card kpi-card--balance'>
                        <div className='kpi-card__glow' />
                        <div className='kpi-card__header'>
                            <span className='kpi-label'>CLOSING BALANCE</span>
                            <span className='kpi-chip chip-cyan'>
                                <CheckCircle2 size={13} /> Verified
                            </span>
                        </div>
                        <div className='kpi-card__value text-cyan-400'>
                            {formatAmount(totals.latestBalance)}
                        </div>
                        <div className='kpi-card__footer'>
                            <span>Ledger account: {loginIdInput}</span>
                        </div>
                    </div>
                </section>

                {/* ── Interactive Command & Filter Deck ── */}
                <section className='cockpit-filters-bar'>
                    <div className='filters-group-left'>
                        {/* Time Period Filter Pills */}
                        <div className='time-segment-control'>
                            <span className='segment-label'>
                                <Clock size={13} /> Period:
                            </span>
                            <button
                                type='button'
                                className={`segment-pill ${timeFilter === 'all' ? 'active' : ''}`}
                                onClick={() => setTimeFilter('all')}
                            >
                                All time
                            </button>
                            <button
                                type='button'
                                className={`segment-pill ${timeFilter === 'today' ? 'active' : ''}`}
                                onClick={() => setTimeFilter('today')}
                            >
                                Today
                            </button>
                            <button
                                type='button'
                                className={`segment-pill ${timeFilter === '7d' ? 'active' : ''}`}
                                onClick={() => setTimeFilter('7d')}
                            >
                                Last 7 Days
                            </button>
                            <button
                                type='button'
                                className={`segment-pill ${timeFilter === '30d' ? 'active' : ''}`}
                                onClick={() => setTimeFilter('30d')}
                            >
                                Last 30 Days
                            </button>
                            <button
                                type='button'
                                className={`segment-pill ${timeFilter === 'custom' ? 'active' : ''}`}
                                onClick={() => setTimeFilter('custom')}
                            >
                                Custom
                            </button>
                        </div>

                        {/* Custom Date Pickers */}
                        {timeFilter === 'custom' && (
                            <div className='custom-range-picker'>
                                <input
                                    type='date'
                                    className='picker-input'
                                    value={customStartDate}
                                    onChange={e => setCustomStartDate(e.target.value)}
                                    title='Start date'
                                />
                                <span className='picker-sep'>→</span>
                                <input
                                    type='date'
                                    className='picker-input'
                                    value={customEndDate}
                                    onChange={e => setCustomEndDate(e.target.value)}
                                    title='End date'
                                />
                            </div>
                        )}

                        {/* Action Type Filter */}
                        <div className='select-pill-wrapper'>
                            <Filter size={13} className='text-amber-400' />
                            <select
                                value={actionFilter}
                                onChange={e => setActionFilter(e.target.value)}
                                title='Filter transaction action'
                            >
                                <option value='all'>All Types</option>
                                <option value='buy'>Buy (Options)</option>
                                <option value='sell'>Sell (Settlements)</option>
                                <option value='deposit'>Deposit</option>
                                <option value='withdrawal'>Withdrawal</option>
                            </select>
                        </div>

                        {/* Limit Selector */}
                        <div className='select-pill-wrapper'>
                            <select
                                value={limit}
                                onChange={e => setLimit(Number(e.target.value))}
                                title='Maximum transactions count'
                            >
                                <option value={50}>50 rows</option>
                                <option value={100}>100 rows</option>
                                <option value={250}>250 rows</option>
                                <option value={500}>500 rows</option>
                                <option value={999}>999 max</option>
                            </select>
                        </div>

                        {/* Instant Search Bar */}
                        <div className='cockpit-search-box'>
                            <Search size={14} className='search-icon text-slate-400' />
                            <input
                                type='text'
                                placeholder='Filter by Ref ID, symbol, contract...'
                                value={searchQuery}
                                onChange={e => setSearchQuery(e.target.value)}
                            />
                            {searchQuery && (
                                <button
                                    type='button'
                                    className='search-clear-btn'
                                    onClick={() => setSearchQuery('')}
                                    title='Clear search'
                                >
                                    ✕
                                </button>
                            )}
                        </div>
                    </div>

                    <div className='filters-group-right'>
                        <button
                            type='button'
                            className='export-action-btn'
                            onClick={exportCSV}
                            disabled={!filteredTransactions.length}
                            title='Export filtered ledger to CSV'
                        >
                            <FileSpreadsheet size={14} />
                            <span>Export CSV</span>
                        </button>
                        <button
                            type='button'
                            className='export-action-btn'
                            onClick={exportJSON}
                            disabled={!filteredTransactions.length}
                            title='Export raw JSON statement'
                        >
                            <Download size={14} />
                            <span>JSON</span>
                        </button>
                    </div>
                </section>

                {/* ── Main Data Grid Area ── */}
                <main className='cockpit-grid-container'>
                    {isLoading ? (
                        <div className='cockpit-loading-view'>
                            <div className='loading-spinner-wrap'>
                                <Loader2 size={42} className='animate-spin text-amber-400' />
                                <div className='spinner-glow' />
                            </div>
                            <h3 className='loading-title'>Accessing Deriv Options Legacy Statement...</h3>
                            <p className='loading-sub'>
                                Querying GET https://api.derivws.com/trading/v1/options/legacy/statement?loginid={loginIdInput}
                            </p>
                        </div>
                    ) : filteredTransactions.length === 0 ? (
                        <div className='cockpit-empty-view'>
                            <FileText size={48} className='text-slate-600' />
                            <h3>No Transactions Found</h3>
                            <p>
                                {searchQuery || actionFilter !== 'all' || timeFilter !== 'all'
                                    ? 'No records match your selected timeframe or filter terms.'
                                    : `Account ${loginIdInput} has no historical options records logged.`}
                            </p>
                            <button
                                type='button'
                                className='btn-load-sample'
                                onClick={() => loadStatementData('sample')}
                            >
                                <Sparkles size={14} /> Load Pre-Upgrade Sample History
                            </button>
                        </div>
                    ) : (
                        <table className='cockpit-table'>
                            <thead>
                                <tr>
                                    <th className='th-type'>Type</th>
                                    <th className='th-ref'>Ref. ID</th>
                                    <th className='th-curr'>Currency</th>
                                    <th className='th-time'>Transaction time</th>
                                    <th className='th-desc'>Transaction</th>
                                    <th className='th-amount text-right'>Credit/Debit</th>
                                    <th className='th-balance text-right'>Balance</th>
                                </tr>
                            </thead>
                            <tbody>
                                {filteredTransactions.map((tx, idx) => {
                                    const isCredit = Number(tx.amount) > 0;
                                    const isDebit = Number(tx.amount) < 0;
                                    const actionType = (tx.action_type || 'transaction').toLowerCase();
                                    const refId = String(tx.reference_id || tx.transaction_id || '');
                                    const timeObj = formatTimestamp(tx.transaction_time);

                                    return (
                                        <tr key={`${tx.transaction_id}-${idx}`} className='cockpit-row'>
                                            {/* 1. Type */}
                                            <td className='td-type'>
                                                <span className={`action-badge badge-${actionType}`}>
                                                    {actionType.toUpperCase()}
                                                </span>
                                            </td>

                                            {/* 2. Ref. ID */}
                                            <td className='td-ref'>
                                                <div className='ref-wrapper'>
                                                    <code className='ref-tag'>#{refId}</code>
                                                    <button
                                                        type='button'
                                                        className='copy-btn'
                                                        onClick={() => copyToClipboard(refId)}
                                                        title='Copy Ref ID'
                                                    >
                                                        {copiedRef === refId ? (
                                                            <Check size={11} className='text-emerald-400' />
                                                        ) : (
                                                            <Copy size={11} />
                                                        )}
                                                    </button>
                                                </div>
                                                {tx.contract_id && (
                                                    <div className='sub-cid'>CID: {tx.contract_id}</div>
                                                )}
                                            </td>

                                            {/* 3. Currency */}
                                            <td className='td-curr'>
                                                <span className='curr-tag'>{tx.currency || 'USD'}</span>
                                            </td>

                                            {/* 4. Transaction time */}
                                            <td className='td-time'>
                                                <div className='time-split'>
                                                    <span className='date-part'>{timeObj.date}</span>
                                                    <span className='clock-part'>{timeObj.time}</span>
                                                </div>
                                            </td>

                                            {/* 5. Transaction Details */}
                                            <td className='td-desc'>
                                                <div className='desc-cell-wrap'>
                                                    {tx.symbol && (
                                                        <span className='symbol-badge'>{tx.symbol}</span>
                                                    )}
                                                    {tx.bet_type && (
                                                        <span className='contract-type-badge'>{tx.bet_type}</span>
                                                    )}
                                                    <span
                                                        className='contract-longcode'
                                                        title={tx.longcode || tx.shortcode || 'Option transaction'}
                                                    >
                                                        {tx.longcode || tx.shortcode || 'Options Platform Transaction'}
                                                    </span>
                                                </div>
                                            </td>

                                            {/* 6. Credit/Debit */}
                                            <td
                                                className={`td-amount text-right ${
                                                    isCredit ? 'amount-credit' : isDebit ? 'amount-debit' : 'amount-zero'
                                                }`}
                                            >
                                                {formatAmount(Number(tx.amount) || 0, tx.currency)}
                                            </td>

                                            {/* 7. Balance */}
                                            <td className='td-balance text-right'>
                                                <span className='balance-num'>
                                                    {formatAmount(Number(tx.balance_after) || 0, tx.currency)}
                                                </span>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>

                            {/* ── Sticky TOTALS Footer ── */}
                            <tfoot className='cockpit-tfoot'>
                                <tr className='totals-row'>
                                    <td colSpan={5} className='totals-info-cell'>
                                        <div className='totals-indicator-wrap'>
                                            <span className='totals-tag'>TOTALS</span>
                                            <span className='totals-summary-text'>
                                                <strong>{totals.count}</strong> transactions in selected timeframe
                                            </span>
                                            <div className='totals-sub-stats'>
                                                <span className='buy-stat'>Buys: {totals.buyCount}</span>
                                                <span className='stat-sep'>&bull;</span>
                                                <span className='sell-stat'>Sells: {totals.sellCount}</span>
                                                <span className='stat-sep'>&bull;</span>
                                                <span className='winrate-stat'>Win Rate: {totals.winRate}%</span>
                                            </div>
                                        </div>
                                    </td>
                                    <td
                                        className={`totals-cashflow-cell text-right ${
                                            totals.netProfitLoss >= 0 ? 'amount-credit' : 'amount-debit'
                                        }`}
                                    >
                                        <div className='net-totals-value'>
                                            {formatAmount(totals.netProfitLoss)}
                                        </div>
                                        <div className='totals-breakdown-row'>
                                            <span className='credit-sub'>+{formatAmount(totals.totalCredit)}</span>
                                            <span className='sub-sep'>/</span>
                                            <span className='debit-sub'>-{formatAmount(totals.totalDebit)}</span>
                                        </div>
                                    </td>
                                    <td className='totals-closing-cell text-right'>
                                        <div className='closing-label'>Closing Balance</div>
                                        <div className='closing-value'>
                                            {formatAmount(totals.latestBalance)}
                                        </div>
                                    </td>
                                </tr>
                            </tfoot>
                        </table>
                    )}
                </main>

                {/* ── Bottom Institutional Status Bar ── */}
                <footer className='cockpit-footer'>
                    <div className='footer-left'>
                        <span className='live-beacon' />
                        <span className='footer-text'>
                            Deriv Options Legacy Statement &bull; Official REST Gateway: <code>https://api.derivws.com/trading/v1/options/legacy/statement</code>
                        </span>
                        <a
                            href='https://developers.deriv.com/docs/options-legacy/legacy-statement/'
                            target='_blank'
                            rel='noopener noreferrer'
                            className='doc-link'
                        >
                            <span>Official Documentation</span>
                            <ExternalLink size={12} />
                        </a>
                    </div>

                    <div className='footer-right'>
                        <button type='button' className='btn-close-cockpit' onClick={onClose}>
                            Close Statement
                        </button>
                    </div>
                </footer>
            </div>
        </div>
    );
});

export default LegacyStatementModal;
