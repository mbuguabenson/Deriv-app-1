import { useCallback, useEffect, useMemo, useState } from 'react';
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
    AlertTriangle,
    ArrowDownRight,
    ArrowUpRight,
    Calendar,
    CheckCircle2,
    Clock,
    Database,
    Download,
    ExternalLink,
    FileSpreadsheet,
    FileText,
    Filter,
    Layers,
    Loader2,
    RefreshCw,
    Search,
    ShieldAlert,
    SlidersHorizontal,
    TrendingDown,
    TrendingUp,
    X,
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

    // Target login ID (defaults to active user or requested CR8416851)
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
    const [errorInfo, setErrorInfo] = useState<{ message: string; code?: string } | null>(null);
    const [isSampleMode, setIsSampleMode] = useState<boolean>(false);
    const [lastFetchTiming, setLastFetchTiming] = useState<number | undefined>();

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

    // Compute epoch seconds for date filters
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

    // Fetch Statement via Official Legacy REST API
    const fetchLegacyStatement = useCallback(async (forcedSample = false) => {
        const targetId = (loginIdInput || 'CR8416851').trim().toUpperCase();

        if (forcedSample) {
            setIsLoading(true);
            setErrorInfo(null);
            setTimeout(() => {
                const sample = LegacyStatementService.getSampleLegacyData(targetId);
                setTransactions(sample);
                setIsSampleMode(true);
                setIsLoading(false);
            }, 300);
            return;
        }

        setIsLoading(true);
        setErrorInfo(null);
        setIsSampleMode(false);

        try {
            const res = await LegacyStatementService.getLegacyStatement({
                loginid: targetId,
                date_from: dateFrom,
                date_to: dateTo,
                action_type: actionFilter !== 'all' ? actionFilter : undefined,
                limit,
            });

            setLastFetchTiming(res.timing);

            if (res.transactions && res.transactions.length > 0) {
                setTransactions(res.transactions);
                setErrorInfo(null);
            } else if (res.error) {
                setErrorInfo({ message: res.error, code: res.errorCode });
                // Fallback to sample preview so user can immediately examine UI
                const sample = LegacyStatementService.getSampleLegacyData(targetId);
                setTransactions(sample);
                setIsSampleMode(true);
            } else {
                setTransactions([]);
            }
        } catch (err: any) {
            console.error('[LegacyStatementModal] Fetch error:', err);
            setErrorInfo({ message: err?.message || 'Connection failed', code: 'Unknown' });
            const sample = LegacyStatementService.getSampleLegacyData(targetId);
            setTransactions(sample);
            setIsSampleMode(true);
        } finally {
            setIsLoading(false);
        }
    }, [loginIdInput, dateFrom, dateTo, actionFilter, limit]);

    useEffect(() => {
        if (isOpen) {
            fetchLegacyStatement();
        }
    }, [isOpen, fetchLegacyStatement]);

    // Keyboard navigation (Escape to close)
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape' && isOpen) {
                onClose();
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isOpen, onClose]);

    // Filter transactions by Action & Search Query
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

    // Financial Metrics & TOTALS Calculation
    const totals = useMemo(() => {
        let totalCredit = 0;
        let totalDebit = 0;
        let buyCount = 0;
        let sellCount = 0;

        filteredTransactions.forEach(t => {
            const amt = Number(t.amount) || 0;
            if (amt > 0) {
                totalCredit += amt;
            } else if (amt < 0) {
                totalDebit += Math.abs(amt);
            }

            if (t.action_type === 'buy') buyCount++;
            if (t.action_type === 'sell') sellCount++;
        });

        const netProfitLoss = totalCredit - totalDebit;
        const latestBalance =
            filteredTransactions.length > 0 ? Number(filteredTransactions[0].balance_after) || 0 : 0;
        const initialBalance =
            filteredTransactions.length > 0
                ? Number(filteredTransactions[filteredTransactions.length - 1].balance_after) || 0
                : 0;

        return {
            totalCredit,
            totalDebit,
            netProfitLoss,
            latestBalance,
            initialBalance,
            count: filteredTransactions.length,
            buyCount,
            sellCount,
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
        if (!epoch) return '—';
        const date = new Date(epoch > 1e11 ? epoch : epoch * 1000);
        return date.toLocaleString('en-GB', {
            day: '2-digit',
            month: 'short',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: false,
        });
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
            'Transaction',
            'Credit/Debit',
            'Balance',
        ];
        const rows = filteredTransactions.map(t => [
            t.action_type.toUpperCase(),
            t.reference_id || t.transaction_id,
            t.contract_id || '',
            t.currency || 'USD',
            formatTimestamp(t.transaction_time),
            `"${(t.longcode || t.shortcode || t.action_type).replace(/"/g, '""')}"`,
            t.amount,
            t.balance_after,
        ]);

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
        <div className='legacy-statement-modal__overlay' onClick={onClose}>
            <div className='legacy-statement-modal__container' onClick={e => e.stopPropagation()}>
                {/* Header Bar */}
                <div className='legacy-statement-modal__header'>
                    <div className='legacy-statement-modal__header-left'>
                        <div className='legacy-icon-glow'>
                            <Database size={20} className='text-amber-400' />
                        </div>
                        <div>
                            <div className='legacy-title-row'>
                                <h2>Options Trading (Legacy)</h2>
                                <span className='legacy-endpoint-tag'>
                                    <code>/trading/v1/options/legacy/statement</code>
                                </span>
                                {isSampleMode && <span className='legacy-sample-badge'>Sample Preview</span>}
                            </div>
                            <p className='legacy-subtitle'>
                                Historical transaction statement & trade history from the legacy options platform before system upgrade.
                            </p>
                        </div>
                    </div>

                    <div className='legacy-statement-modal__header-actions'>
                        {/* Login ID Input / Switcher */}
                        <div className='legacy-loginid-box'>
                            <span className='loginid-label'>Account:</span>
                            <input
                                type='text'
                                className='loginid-input'
                                value={loginIdInput}
                                onChange={e => setLoginIdInput(e.target.value.toUpperCase())}
                                placeholder='CR8416851'
                                title='Deriv legacy login ID (e.g. CR8416851)'
                            />
                        </div>

                        {/* Account Selector dropdown if accounts exist */}
                        {accountList && accountList.length > 0 && (
                            <select
                                className='legacy-account-quick-select'
                                value={loginIdInput}
                                onChange={e => setLoginIdInput(e.target.value)}
                                title='Select account'
                            >
                                {accountList.map(acc => (
                                    <option key={acc.loginid} value={acc.loginid}>
                                        {acc.loginid} ({acc.currency || 'USD'})
                                    </option>
                                ))}
                                <option value='CR8416851'>CR8416851 (Default)</option>
                            </select>
                        )}

                        <button
                            type='button'
                            className='legacy-action-icon-btn'
                            onClick={() => fetchLegacyStatement(false)}
                            disabled={isLoading}
                            title='Refresh legacy statement from api.derivws.com'
                        >
                            <RefreshCw size={15} className={isLoading ? 'animate-spin' : ''} />
                        </button>

                        <button
                            type='button'
                            className='legacy-modal-close-btn'
                            onClick={onClose}
                            aria-label='Close Legacy Statement'
                        >
                            <X size={18} />
                        </button>
                    </div>
                </div>

                {/* API Notice / Migration Warning Banner */}
                {errorInfo && (
                    <div className='legacy-alert-banner'>
                        <div className='legacy-alert-content'>
                            {errorInfo.code === 'MigrationPending' ? (
                                <ShieldAlert size={18} className='text-amber-400 shrink-0' />
                            ) : (
                                <AlertTriangle size={18} className='text-amber-400 shrink-0' />
                            )}
                            <div className='legacy-alert-text'>
                                <strong>
                                    {errorInfo.code === 'MigrationPending'
                                        ? 'Deriv Migration In Progress (409): '
                                        : 'Legacy API Notice: '}
                                </strong>
                                <span>{errorInfo.message}</span>
                                <span className='legacy-alert-hint'>
                                    Showing pre-upgrade trade history simulation for {loginIdInput}. Click Refresh to query Deriv servers.
                                </span>
                            </div>
                        </div>
                        <div className='legacy-alert-btns'>
                            <button
                                type='button'
                                className='btn-test-sample'
                                onClick={() => fetchLegacyStatement(true)}
                            >
                                Reload Sample Data
                            </button>
                            <button
                                type='button'
                                className='btn-live-retry'
                                onClick={() => fetchLegacyStatement(false)}
                            >
                                Retry Live API
                            </button>
                        </div>
                    </div>
                )}

                {/* Summary / TOTALS Cards Strip */}
                <div className='legacy-totals-strip'>
                    {/* Net P&L Card */}
                    <div className={`legacy-stat-card ${totals.netProfitLoss >= 0 ? 'card-positive' : 'card-negative'}`}>
                        <div className='stat-card-top'>
                            <span className='stat-label'>TOTAL NET PROFIT / LOSS</span>
                            {totals.netProfitLoss >= 0 ? (
                                <TrendingUp size={16} className='text-emerald-400' />
                            ) : (
                                <TrendingDown size={16} className='text-rose-400' />
                            )}
                        </div>
                        <div className={`stat-value ${totals.netProfitLoss >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                            {formatAmount(totals.netProfitLoss)}
                        </div>
                        <div className='stat-sub'>
                            Across {totals.count} filtered legacy transactions
                        </div>
                    </div>

                    {/* Total In / Credit */}
                    <div className='legacy-stat-card card-credit'>
                        <div className='stat-card-top'>
                            <span className='stat-label'>TOTAL CREDIT (+)</span>
                            <ArrowUpRight size={16} className='text-emerald-400' />
                        </div>
                        <div className='stat-value text-emerald-400'>
                            +{formatAmount(totals.totalCredit)}
                        </div>
                        <div className='stat-sub'>
                            Payouts, settlements & deposits
                        </div>
                    </div>

                    {/* Total Out / Debit */}
                    <div className='legacy-stat-card card-debit'>
                        <div className='stat-card-top'>
                            <span className='stat-label'>TOTAL DEBIT (-)</span>
                            <ArrowDownRight size={16} className='text-rose-400' />
                        </div>
                        <div className='stat-value text-rose-400'>
                            -{formatAmount(totals.totalDebit)}
                        </div>
                        <div className='stat-sub'>
                            Stakes, contracts bought & withdrawals
                        </div>
                    </div>

                    {/* Account Balance */}
                    <div className='legacy-stat-card card-balance'>
                        <div className='stat-card-top'>
                            <span className='stat-label'>CLOSING BALANCE</span>
                            <CheckCircle2 size={16} className='text-sky-400' />
                        </div>
                        <div className='stat-value text-sky-400'>
                            {formatAmount(totals.latestBalance)}
                        </div>
                        <div className='stat-sub'>
                            {totals.buyCount} buys &bull; {totals.sellCount} sells
                        </div>
                    </div>
                </div>

                {/* Filter & Search Toolbar */}
                <div className='legacy-toolbar'>
                    <div className='legacy-toolbar-filters'>
                        {/* Time Filter Pills */}
                        <div className='time-filter-group'>
                            <span className='filter-icon-label'>
                                <Clock size={13} /> Time:
                            </span>
                            <button
                                type='button'
                                className={`time-pill ${timeFilter === 'all' ? 'active' : ''}`}
                                onClick={() => setTimeFilter('all')}
                            >
                                All time
                            </button>
                            <button
                                type='button'
                                className={`time-pill ${timeFilter === 'today' ? 'active' : ''}`}
                                onClick={() => setTimeFilter('today')}
                            >
                                Today
                            </button>
                            <button
                                type='button'
                                className={`time-pill ${timeFilter === '7d' ? 'active' : ''}`}
                                onClick={() => setTimeFilter('7d')}
                            >
                                Last 7 Days
                            </button>
                            <button
                                type='button'
                                className={`time-pill ${timeFilter === '30d' ? 'active' : ''}`}
                                onClick={() => setTimeFilter('30d')}
                            >
                                Last 30 Days
                            </button>
                            <button
                                type='button'
                                className={`time-pill ${timeFilter === 'custom' ? 'active' : ''}`}
                                onClick={() => setTimeFilter('custom')}
                            >
                                Custom
                            </button>
                        </div>

                        {/* Custom Date Pickers */}
                        {timeFilter === 'custom' && (
                            <div className='custom-date-inputs'>
                                <input
                                    type='date'
                                    className='legacy-date-input'
                                    value={customStartDate}
                                    onChange={e => setCustomStartDate(e.target.value)}
                                    title='Start Date'
                                />
                                <span className='date-sep'>to</span>
                                <input
                                    type='date'
                                    className='legacy-date-input'
                                    value={customEndDate}
                                    onChange={e => setCustomEndDate(e.target.value)}
                                    title='End Date'
                                />
                            </div>
                        )}

                        {/* Action Type Filter */}
                        <div className='legacy-select-filter'>
                            <Filter size={13} />
                            <select
                                value={actionFilter}
                                onChange={e => setActionFilter(e.target.value)}
                                title='Filter by action type'
                            >
                                <option value='all'>All Types</option>
                                <option value='buy'>Buy</option>
                                <option value='sell'>Sell</option>
                                <option value='deposit'>Deposit</option>
                                <option value='withdrawal'>Withdrawal</option>
                            </select>
                        </div>

                        {/* Limit Selector */}
                        <div className='legacy-select-filter'>
                            <select
                                value={limit}
                                onChange={e => setLimit(Number(e.target.value))}
                                title='Maximum transactions to return'
                            >
                                <option value={50}>50 limit</option>
                                <option value={100}>100 limit</option>
                                <option value={250}>250 limit</option>
                                <option value={500}>500 limit</option>
                                <option value={999}>999 max</option>
                            </select>
                        </div>

                        {/* Search Input */}
                        <div className='legacy-search-box'>
                            <Search size={14} className='search-icon' />
                            <input
                                type='text'
                                placeholder='Search Ref. ID, symbol, action...'
                                value={searchQuery}
                                onChange={e => setSearchQuery(e.target.value)}
                            />
                            {searchQuery && (
                                <button
                                    type='button'
                                    className='clear-search'
                                    onClick={() => setSearchQuery('')}
                                >
                                    ✕
                                </button>
                            )}
                        </div>
                    </div>

                    <div className='legacy-toolbar-actions'>
                        <button
                            type='button'
                            className='legacy-btn-export'
                            onClick={exportCSV}
                            disabled={!filteredTransactions.length}
                            title='Export filtered ledger to CSV'
                        >
                            <FileSpreadsheet size={14} />
                            <span>Export CSV</span>
                        </button>
                        <button
                            type='button'
                            className='legacy-btn-export'
                            onClick={exportJSON}
                            disabled={!filteredTransactions.length}
                            title='Export raw statement to JSON'
                        >
                            <Download size={14} />
                            <span>JSON</span>
                        </button>
                    </div>
                </div>

                {/* Table Content */}
                <div className='legacy-table-scroll-container'>
                    {isLoading ? (
                        <div className='legacy-loading-state'>
                            <Loader2 size={36} className='animate-spin text-amber-400' />
                            <h3>Accessing Legacy Options Statement...</h3>
                            <p>Querying https://api.derivws.com/trading/v1/options/legacy/statement for {loginIdInput}</p>
                        </div>
                    ) : filteredTransactions.length === 0 ? (
                        <div className='legacy-empty-state'>
                            <FileText size={44} className='text-zinc-600' />
                            <h3>No Historical Transactions Found</h3>
                            <p>
                                {searchQuery || actionFilter !== 'all' || timeFilter !== 'all'
                                    ? 'No records match the selected time filter or search query.'
                                    : `Account ${loginIdInput} does not have recorded options trades on the legacy platform.`}
                            </p>
                            <button
                                type='button'
                                className='btn-test-sample mt-3'
                                onClick={() => fetchLegacyStatement(true)}
                            >
                                Load Sample Legacy Data
                            </button>
                        </div>
                    ) : (
                        <table className='legacy-statement-table'>
                            <thead>
                                <tr>
                                    <th>Type</th>
                                    <th>Ref. ID</th>
                                    <th>Currency</th>
                                    <th>Transaction time</th>
                                    <th>Transaction</th>
                                    <th className='text-right'>Credit/Debit</th>
                                    <th className='text-right'>Balance</th>
                                </tr>
                            </thead>
                            <tbody>
                                {filteredTransactions.map((tx, idx) => {
                                    const isCredit = Number(tx.amount) > 0;
                                    const isDebit = Number(tx.amount) < 0;
                                    const actionType = (tx.action_type || 'transaction').toLowerCase();
                                    const refId = tx.reference_id || tx.transaction_id;

                                    return (
                                        <tr key={`${tx.transaction_id}-${idx}`}>
                                            {/* 1. Type */}
                                            <td className='col-type'>
                                                <span className={`legacy-action-pill pill-${actionType}`}>
                                                    {tx.action_type.toUpperCase()}
                                                </span>
                                            </td>

                                            {/* 2. Ref. ID */}
                                            <td className='col-ref'>
                                                <code className='ref-code'>#{refId}</code>
                                                {tx.contract_id && (
                                                    <span className='sub-contract-id' title='Contract ID'>
                                                        CID: {tx.contract_id}
                                                    </span>
                                                )}
                                            </td>

                                            {/* 3. Currency */}
                                            <td className='col-currency'>
                                                <span className='currency-badge'>{tx.currency || 'USD'}</span>
                                            </td>

                                            {/* 4. Transaction time */}
                                            <td className='col-time'>
                                                <div className='time-primary'>
                                                    {formatTimestamp(tx.transaction_time)}
                                                </div>
                                            </td>

                                            {/* 5. Transaction Details */}
                                            <td className='col-desc'>
                                                <div className='tx-details-wrapper'>
                                                    {tx.symbol && (
                                                        <span className='tx-symbol-pill'>{tx.symbol}</span>
                                                    )}
                                                    {tx.bet_type && (
                                                        <span className='tx-bet-pill'>{tx.bet_type}</span>
                                                    )}
                                                    <span
                                                        className='tx-longcode'
                                                        title={tx.longcode || tx.shortcode || 'Legacy movement'}
                                                    >
                                                        {tx.longcode || tx.shortcode || 'Options Platform Transaction'}
                                                    </span>
                                                </div>
                                            </td>

                                            {/* 6. Credit/Debit */}
                                            <td
                                                className={`col-amount text-right ${
                                                    isCredit ? 'val-credit' : isDebit ? 'val-debit' : 'val-zero'
                                                }`}
                                            >
                                                {formatAmount(Number(tx.amount) || 0, tx.currency)}
                                            </td>

                                            {/* 7. Balance */}
                                            <td className='col-balance text-right'>
                                                {formatAmount(Number(tx.balance_after) || 0, tx.currency)}
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>

                            {/* TOTALS Footer Row */}
                            <tfoot>
                                <tr className='legacy-totals-row'>
                                    <td colSpan={5} className='totals-label-cell'>
                                        <div className='totals-header-group'>
                                            <span className='totals-tag'>TOTALS</span>
                                            <span className='totals-count-text'>
                                                {totals.count} {totals.count === 1 ? 'transaction' : 'transactions'} in selected time
                                            </span>
                                            <span className='totals-breakdown-sub'>
                                                ({totals.buyCount} buys, {totals.sellCount} sells)
                                            </span>
                                        </div>
                                    </td>
                                    <td className={`totals-amount-cell text-right ${totals.netProfitLoss >= 0 ? 'val-credit' : 'val-debit'}`}>
                                        <div className='totals-net-value'>{formatAmount(totals.netProfitLoss)}</div>
                                        <div className='totals-sub-cashflow'>
                                            <span className='credit-part'>+{formatAmount(totals.totalCredit)}</span>
                                            <span className='divider'>/</span>
                                            <span className='debit-part'>-{formatAmount(totals.totalDebit)}</span>
                                        </div>
                                    </td>
                                    <td className='totals-balance-cell text-right'>
                                        <div className='totals-closing-label'>Closing Balance</div>
                                        <div className='totals-closing-val'>{formatAmount(totals.latestBalance)}</div>
                                    </td>
                                </tr>
                            </tfoot>
                        </table>
                    )}
                </div>

                {/* Footer Bar */}
                <div className='legacy-statement-modal__footer'>
                    <div className='footer-meta'>
                        <span className='endpoint-meta-dot' />
                        <span>
                            Endpoint: <code>GET https://api.derivws.com/trading/v1/options/legacy/statement</code> &bull; Base: Deriv Options Legacy API
                        </span>
                        <a
                            href='https://developers.deriv.com/docs/options-legacy/legacy-statement/'
                            target='_blank'
                            rel='noopener noreferrer'
                            className='api-doc-link'
                        >
                            <span>Documentation</span>
                            <ExternalLink size={12} />
                        </a>
                    </div>

                    <div className='footer-buttons'>
                        <button type='button' className='btn-legacy-close' onClick={onClose}>
                            Close
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
});

export default LegacyStatementModal;
