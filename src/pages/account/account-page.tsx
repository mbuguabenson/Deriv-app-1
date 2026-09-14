import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { observer } from 'mobx-react-lite';
import { useNavigate } from 'react-router-dom';
import { useApiBase } from '@/hooks/useApiBase';
import { useStore } from '@/hooks/useStore';
import {
    DerivAccountWalletService,
    DerivStatementTransaction,
    DerivPortfolioPosition,
    DerivProfitTableEntry,
    DerivTransactionStreamItem,
} from '@/services/deriv-account-wallet.service';

import { addComma, getCurrencyDisplayCode, getDecimalPlaces } from '@/components/shared';
import { isDemoAccount } from '@/utils/account-helpers';
import { api_base } from '@/external/bot-skeleton/services/api/api-base';
import { localize } from '@deriv-com/translations';
import {
    Activity,
    ArrowDownLeft,
    ArrowLeft,
    ArrowUpRight,
    Briefcase,
    Calendar,
    CheckCircle2,
    Copy,
    CreditCard,
    DollarSign,
    Download,
    ExternalLink,
    FileSpreadsheet,
    FileText,
    Filter,
    Layers,
    LogOut,
    Percent,
    Radio,
    RefreshCw,
    RotateCcw,
    Search,
    Shield,
    TrendingDown,
    TrendingUp,
    User,
    Wallet,
    Zap,
} from 'lucide-react';
import './account-page.scss';

type TActiveTab = 'statement' | 'portfolio' | 'profit_table' | 'transactions';

const AccountPage = observer(() => {
    const navigate = useNavigate();
    const { accountList, activeLoginid } = useApiBase();
    const { client } = useStore() ?? {};

    const [selectedLoginId, setSelectedLoginId] = useState<string>(
        activeLoginid || localStorage.getItem('active_loginid') || client?.loginid || ''
    );
    const [activeTab, setActiveTab] = useState<TActiveTab>('statement');

    // 1. Statement Data
    const [transactions, setTransactions] = useState<DerivStatementTransaction[]>([]);
    const [isLoadingStatement, setIsLoadingStatement] = useState<boolean>(false);
    const [actionFilter, setActionFilter] = useState<string>('all');
    const [dateRangeFilter, setDateRangeFilter] = useState<'all' | 'today' | '7d' | '30d'>('all');
    const [searchQuery, setSearchQuery] = useState<string>('');

    // 2. Portfolio Data (Open Positions)
    const [portfolioPositions, setPortfolioPositions] = useState<DerivPortfolioPosition[]>([]);
    const [isLoadingPortfolio, setIsLoadingPortfolio] = useState<boolean>(false);

    // 3. Profit Table Data (Closed Contracts)
    const [profitEntries, setProfitEntries] = useState<DerivProfitTableEntry[]>([]);
    const [isLoadingProfitTable, setIsLoadingProfitTable] = useState<boolean>(false);

    // 4. Transaction Stream Data
    const [streamEvents, setStreamEvents] = useState<DerivTransactionStreamItem[]>([]);
    const [latestTransaction, setLatestTransaction] = useState<DerivTransactionStreamItem | null>(null);
    const [isStreamSubscribed, setIsStreamSubscribed] = useState<boolean>(false);

    // UI state
    const [copiedId, setCopiedId] = useState(false);
    const [isResetting, setIsResetting] = useState(false);
    const [resetMsg, setResetMsg] = useState<string | null>(null);

    const displayCurrency = (localStorage.getItem('converter_display_currency') as 'USD' | 'KES') || 'USD';
    const rate = parseFloat(localStorage.getItem('converter_kes_rate') || '129.5');

    // Keep selectedLoginId in sync with activeLoginid initially
    useEffect(() => {
        if (!selectedLoginId && activeLoginid) {
            setSelectedLoginId(activeLoginid);
        }
    }, [activeLoginid, selectedLoginId]);

    // Active account data
    const activeAccountData = useMemo(() => {
        const found = accountList?.find(a => a.loginid === selectedLoginId);
        const isDemo = isDemoAccount(selectedLoginId);
        const curr = found?.currency || 'USD';
        let balance = Number(found?.balance ?? 0);

        if (selectedLoginId === activeLoginid && client?.balance !== undefined && client?.balance !== null) {
            const parsedLive = parseFloat(String(client.balance));
            if (!isNaN(parsedLive)) balance = parsedLive;
        }

        return {
            loginid: selectedLoginId || '',
            currency: curr || 'USD',
            balance: isNaN(balance) ? 0 : balance,
            isDemo: Boolean(isDemo),
        };
    }, [selectedLoginId, accountList, activeLoginid, client?.balance]);

    // Calculate timestamps for filtering
    const { dateFrom, dateTo } = useMemo(() => {
        const now = Math.floor(Date.now() / 1000);
        if (dateRangeFilter === 'today') {
            const startOfDay = new Date();
            startOfDay.setHours(0, 0, 0, 0);
            return { dateFrom: Math.floor(startOfDay.getTime() / 1000), dateTo: now };
        }
        if (dateRangeFilter === '7d') return { dateFrom: now - 7 * 86400, dateTo: now };
        if (dateRangeFilter === '30d') return { dateFrom: now - 30 * 86400, dateTo: now };
        return { dateFrom: undefined, dateTo: undefined };
    }, [dateRangeFilter]);

    // ─── API 1: Statement ───
    const fetchStatement = useCallback(async () => {
        const target = selectedLoginId || activeLoginid;
        if (!target) return;

        setIsLoadingStatement(true);
        try {
            const res = await DerivAccountWalletService.getStatementReport({
                loginid: target,
                limit: 100,
                date_from: dateFrom,
                date_to: dateTo,
                action_type: actionFilter !== 'all' ? actionFilter : undefined,
            });
            setTransactions(res.transactions || []);
        } catch (e) {
            console.error('[AccountPage] fetchStatement error:', e);
            setTransactions([]);
        } finally {
            setIsLoadingStatement(false);
        }
    }, [selectedLoginId, activeLoginid, dateFrom, dateTo, actionFilter]);

    // ─── API 2: Portfolio ───
    const fetchPortfolio = useCallback(async () => {
        setIsLoadingPortfolio(true);
        try {
            const positions = await DerivAccountWalletService.getPortfolio();
            setPortfolioPositions(positions);
        } catch (e) {
            console.error('[AccountPage] fetchPortfolio error:', e);
            setPortfolioPositions([]);
        } finally {
            setIsLoadingPortfolio(false);
        }
    }, []);

    // ─── API 3: Profit Table ───
    const fetchProfitTable = useCallback(async () => {
        setIsLoadingProfitTable(true);
        try {
            const res = await DerivAccountWalletService.getProfitTable({
                date_from: dateFrom,
                date_to: dateTo,
                limit: 100,
                sort: 'DESC',
            });
            setProfitEntries(res.transactions || []);
        } catch (e) {
            console.error('[AccountPage] fetchProfitTable error:', e);
            setProfitEntries([]);
        } finally {
            setIsLoadingProfitTable(false);
        }
    }, [dateFrom, dateTo]);

    // Fetch tab data when parameters change
    useEffect(() => {
        if (activeTab === 'statement') fetchStatement();
        else if (activeTab === 'portfolio') fetchPortfolio();
        else if (activeTab === 'profit_table') fetchProfitTable();
    }, [activeTab, fetchStatement, fetchPortfolio, fetchProfitTable]);

    // ─── API 4: Transaction Stream ───
    useEffect(() => {
        setIsStreamSubscribed(true);
        const unsubscribe = DerivAccountWalletService.subscribeTransactions(
            tx => {
                setLatestTransaction(tx);
                setStreamEvents(prev => [tx, ...prev.slice(0, 49)]);

                // Sync live balance
                if (typeof tx.balance === 'number' && client?.setBalance) {
                    client.setBalance(String(tx.balance));
                }

                // If active tab matches relevant transactions, refresh
                if (tx.action === 'buy' || tx.action === 'sell') {
                    fetchPortfolio();
                    fetchProfitTable();
                    fetchStatement();
                }
            },
            err => {
                console.warn('[AccountPage] Transaction stream notification:', err);
            }
        );

        return () => {
            setIsStreamSubscribed(false);
            unsubscribe();
        };
    }, [client, fetchPortfolio, fetchProfitTable, fetchStatement]);

    // Format money helper
    const formatAmount = (amount: number | string | undefined | null, curr = 'USD') => {
        const isKes = displayCurrency === 'KES' && curr === 'USD';
        const numVal = Number(amount) || 0;
        const val = isKes ? numVal * rate : numVal;
        const safeCurr = curr || 'USD';
        let code = isKes ? 'KES' : safeCurr;
        try {
            if (!isKes && typeof getCurrencyDisplayCode === 'function') {
                code = getCurrencyDisplayCode(safeCurr) || safeCurr;
            }
        } catch {
            code = safeCurr;
        }
        const prefix = val > 0 ? '+' : '';
        let dec = 2;
        try {
            if (!isKes && typeof getDecimalPlaces === 'function') {
                dec = getDecimalPlaces(safeCurr) ?? 2;
            }
        } catch {
            dec = 2;
        }
        const safeVal = isNaN(val) ? 0 : val;
        return `${prefix}${addComma(safeVal.toFixed(dec))} ${code}`;
    };

    // Filter statement transactions
    const filteredTransactions = useMemo(() => {
        let list = transactions;
        if (actionFilter !== 'all') {
            list = list.filter(t => (t.action_type || '').toLowerCase() === actionFilter.toLowerCase());
        }
        if (searchQuery.trim()) {
            const q = searchQuery.toLowerCase().trim();
            list = list.filter(t =>
                String(t.transaction_id || '').toLowerCase().includes(q) ||
                String(t.contract_id || '').toLowerCase().includes(q) ||
                String(t.symbol || '').toLowerCase().includes(q) ||
                String(t.action_type || '').toLowerCase().includes(q) ||
                String(t.longcode || '').toLowerCase().includes(q)
            );
        }
        return list;
    }, [transactions, actionFilter, searchQuery]);

    // Statement metrics
    const statementMetrics = useMemo(() => {
        let totalCredits = 0;
        let totalDebits = 0;

        filteredTransactions.forEach(t => {
            const amt = Number(t.amount) || 0;
            if (amt > 0) totalCredits += amt;
            else totalDebits += Math.abs(amt);
        });

        return {
            totalCredits,
            totalDebits,
            netCashFlow: totalCredits - totalDebits,
            count: filteredTransactions.length,
        };
    }, [filteredTransactions]);

    // Portfolio metrics
    const portfolioMetrics = useMemo(() => {
        let totalStake = 0;
        let totalPotentialPayout = 0;

        portfolioPositions.forEach(p => {
            totalStake += Number(p.buy_price) || 0;
            totalPotentialPayout += Number(p.payout) || 0;
        });

        return {
            totalStake,
            totalPotentialPayout,
            count: portfolioPositions.length,
        };
    }, [portfolioPositions]);

    // Profit Table metrics
    const profitMetrics = useMemo(() => {
        let totalBuy = 0;
        let totalSell = 0;
        let netProfit = 0;
        let winCount = 0;

        profitEntries.forEach(p => {
            const buy = Number(p.buy_price) || 0;
            const sell = Number(p.sell_price) || 0;
            const pl = Number(p.profit_loss) || 0;
            totalBuy += buy;
            totalSell += sell;
            netProfit += pl;
            if (pl > 0) winCount += 1;
        });

        const count = profitEntries.length;
        const winRate = count > 0 ? (winCount / count) * 100 : 0;

        return {
            totalBuy,
            totalSell,
            netProfit,
            winCount,
            count,
            winRate,
        };
    }, [profitEntries]);

    // Copy login ID
    const handleCopyId = () => {
        if (!selectedLoginId) return;
        navigator.clipboard.writeText(selectedLoginId);
        setCopiedId(true);
        setTimeout(() => setCopiedId(false), 2000);
    };

    // Reset Demo Balance
    const handleResetDemoBalance = async () => {
        if (!activeAccountData.isDemo || isResetting) return;
        setIsResetting(true);
        setResetMsg(null);
        try {
            if (api_base.api) {
                const topupRes = await api_base.api.send({ topup_virtual: 1 });
                if (topupRes?.topup_virtual) {
                    const newAmount = topupRes.topup_virtual.amount ?? 10000;
                    if (client?.setBalance) {
                        client.setBalance(String(newAmount));
                    }
                    setResetMsg(localize('Demo balance successfully reset to $10,000.00'));
                    fetchStatement();
                } else if (topupRes?.error) {
                    setResetMsg(topupRes.error.message || localize('Unable to reset demo balance'));
                }
            } else {
                setResetMsg(localize('Connection not available to reset balance'));
            }
        } catch (e: any) {
            setResetMsg(e?.message || localize('Error resetting balance'));
        } finally {
            setIsResetting(false);
            setTimeout(() => setResetMsg(null), 4000);
        }
    };

    // CSV Exports
    const handleExportCSV = () => {
        if (activeTab === 'statement') {
            if (filteredTransactions.length === 0) return;
            const headers = ['Transaction ID', 'Contract ID', 'Date & Time', 'Action', 'Market', 'Amount', 'Currency', 'Balance After'];
            const rows = filteredTransactions.map(t => [
                t.transaction_id,
                t.contract_id || '',
                new Date(t.transaction_time * 1000).toISOString(),
                (t.action_type || '').toUpperCase(),
                t.symbol || t.shortcode || '',
                t.amount,
                t.currency || 'USD',
                t.balance_after,
            ]);
            downloadCSV(`statement_${selectedLoginId}_${Date.now()}.csv`, headers, rows);
        } else if (activeTab === 'portfolio') {
            if (portfolioPositions.length === 0) return;
            const headers = ['Contract ID', 'Symbol', 'Type', 'Buy Price', 'Payout', 'Purchase Time', 'Expiry Time'];
            const rows = portfolioPositions.map(p => [
                p.contract_id,
                p.symbol,
                p.contract_type,
                p.buy_price,
                p.payout,
                new Date(p.purchase_time * 1000).toISOString(),
                p.expiry_time ? new Date(p.expiry_time * 1000).toISOString() : '',
            ]);
            downloadCSV(`portfolio_${selectedLoginId}_${Date.now()}.csv`, headers, rows);
        } else if (activeTab === 'profit_table') {
            if (profitEntries.length === 0) return;
            const headers = ['Contract ID', 'Purchase Time', 'Sell Time', 'Buy Price', 'Sell Price', 'Profit/Loss', 'Summary'];
            const rows = profitEntries.map(p => [
                p.contract_id,
                new Date(p.purchase_time * 1000).toISOString(),
                new Date(p.sell_time * 1000).toISOString(),
                p.buy_price,
                p.sell_price,
                p.profit_loss,
                p.shortcode || p.longcode || '',
            ]);
            downloadCSV(`profit_table_${selectedLoginId}_${Date.now()}.csv`, headers, rows);
        }
    };

    const downloadCSV = (filename: string, headers: string[], rows: any[][]) => {
        const csvContent = [headers.join(','), ...rows.map(r => r.map(c => `"${c}"`).join(','))].join('\n');
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        link.click();
        URL.revokeObjectURL(url);
    };

    const handleRefreshCurrentTab = () => {
        if (activeTab === 'statement') fetchStatement();
        else if (activeTab === 'portfolio') fetchPortfolio();
        else if (activeTab === 'profit_table') fetchProfitTable();
    };

    const isCurrentTabLoading =
        (activeTab === 'statement' && isLoadingStatement) ||
        (activeTab === 'portfolio' && isLoadingPortfolio) ||
        (activeTab === 'profit_table' && isLoadingProfitTable);

    return (
        <div className='account-page-v2'>
            {/* 1. COMPACT BALANCED HEADER BAR */}
            <header className='acc-topbar'>
                <div className='acc-topbar__left'>
                    <button
                        type='button'
                        className='acc-back-btn'
                        onClick={() => navigate(-1)}
                        title={localize('Go Back')}
                    >
                        <ArrowLeft size={16} />
                        <span>{localize('Back')}</span>
                    </button>
                    <div className='acc-title-group'>
                        <div className='acc-title-row'>
                            <h1 className='acc-title'>{localize('Account & Reports')}</h1>
                            <span className='acc-live-indicator'>
                                <span className='acc-live-dot' />
                                Deriv Gateway
                            </span>
                        </div>
                    </div>
                </div>

                <div className='acc-topbar__right'>
                    {/* Account Switcher Dropdown */}
                    {accountList && accountList.length > 0 && (
                        <div className='acc-selector-wrap'>
                            <select
                                className='acc-header-select'
                                value={selectedLoginId}
                                onChange={e => setSelectedLoginId(e.target.value)}
                            >
                                {accountList.map(acc => {
                                    const isDemo = isDemoAccount(acc.loginid);
                                    const bal = Number(acc.balance ?? 0).toFixed(2);
                                    return (
                                        <option key={acc.loginid} value={acc.loginid}>
                                            {isDemo ? '🟢 Demo' : '🔵 Real'} • {acc.loginid} (${bal} {acc.currency || 'USD'})
                                        </option>
                                    );
                                })}
                            </select>
                        </div>
                    )}

                    <button
                        type='button'
                        className='acc-btn-refresh'
                        onClick={handleRefreshCurrentTab}
                        disabled={isCurrentTabLoading}
                        title={localize('Refresh data')}
                    >
                        <RefreshCw size={14} className={isCurrentTabLoading ? 'animate-spin' : ''} />
                        <span>{localize('Refresh')}</span>
                    </button>

                    <a
                        href='https://app.deriv.com/cashier/deposit'
                        target='_blank'
                        rel='noopener noreferrer'
                        className='acc-btn-deposit'
                    >
                        <span>{localize('Deposit')}</span>
                        <ExternalLink size={13} />
                    </a>
                </div>
            </header>

            {/* 2. BALANCED 4-CARD HERO METRICS STRIP */}
            <section className='acc-hero-grid'>
                {/* CARD 1: Available Balance */}
                <div className={`acc-summary-card ${activeAccountData.isDemo ? 'demo-accent' : 'real-accent'}`}>
                    <div className='acc-card-head'>
                        <div className='acc-card-icon-wrap'>
                            <Wallet size={16} />
                        </div>
                        <span className='acc-card-label'>{localize('Available Funds')}</span>
                        <span className={`acc-tag ${activeAccountData.isDemo ? 'demo' : 'real'}`}>
                            {activeAccountData.isDemo ? 'DEMO' : 'REAL'}
                        </span>
                    </div>
                    <div className='acc-card-body'>
                        <div className='acc-card-val'>
                            {formatAmount(activeAccountData.balance, activeAccountData.currency)}
                        </div>
                        <div className='acc-card-sub'>
                            <button
                                type='button'
                                className='acc-inline-id-btn'
                                onClick={handleCopyId}
                                title={localize('Copy Login ID')}
                            >
                                <span>{activeAccountData.loginid}</span>
                                {copiedId ? <CheckCircle2 size={12} className='text-win' /> : <Copy size={12} />}
                            </button>
                            {activeAccountData.isDemo && (
                                <button
                                    type='button'
                                    className='acc-inline-action-btn'
                                    onClick={handleResetDemoBalance}
                                    disabled={isResetting}
                                >
                                    <RotateCcw size={11} className={isResetting ? 'animate-spin' : ''} />
                                    <span>{localize('Top-up $10k')}</span>
                                </button>
                            )}
                        </div>
                    </div>
                    {resetMsg && <div className='acc-card-toast'>{resetMsg}</div>}
                </div>

                {/* CARD 2: Net Closed P&L */}
                <div className='acc-summary-card'>
                    <div className='acc-card-head'>
                        <div className='acc-card-icon-wrap'>
                            {profitMetrics.netProfit >= 0 ? (
                                <TrendingUp size={16} className='text-win' />
                            ) : (
                                <TrendingDown size={16} className='text-loss' />
                            )}
                        </div>
                        <span className='acc-card-label'>{localize('Closed P&L')}</span>
                        <span className='acc-tag neutral'>{profitMetrics.count} {localize('Trades')}</span>
                    </div>
                    <div className='acc-card-body'>
                        <div className={`acc-card-val ${profitMetrics.netProfit >= 0 ? 'text-win' : 'text-loss'}`}>
                            {profitMetrics.netProfit >= 0 ? '+' : ''}
                            {formatAmount(profitMetrics.netProfit, activeAccountData.currency)}
                        </div>
                        <div className='acc-card-sub text-muted'>
                            {localize('Settled net return')}
                        </div>
                    </div>
                </div>

                {/* CARD 3: Win Rate */}
                <div className='acc-summary-card'>
                    <div className='acc-card-head'>
                        <div className='acc-card-icon-wrap'>
                            <Percent size={16} className='text-cyan' />
                        </div>
                        <span className='acc-card-label'>{localize('Win Rate')}</span>
                        <span className='acc-tag neutral'>{profitMetrics.winCount}/{profitMetrics.count}</span>
                    </div>
                    <div className='acc-card-body'>
                        <div className={`acc-card-val ${profitMetrics.winRate >= 50 ? 'text-win' : 'text-loss'}`}>
                            {profitMetrics.winRate.toFixed(1)}%
                        </div>
                        <div className='acc-card-sub text-muted'>
                            {profitMetrics.winCount}W • {Math.max(0, profitMetrics.count - profitMetrics.winCount)}L
                        </div>
                    </div>
                </div>

                {/* CARD 4: Open Market Exposure */}
                <div className='acc-summary-card'>
                    <div className='acc-card-head'>
                        <div className='acc-card-icon-wrap'>
                            <Briefcase size={16} className='text-indigo' />
                        </div>
                        <span className='acc-card-label'>{localize('Active Exposure')}</span>
                        <span className='acc-tag neutral'>{portfolioPositions.length} {localize('Open')}</span>
                    </div>
                    <div className='acc-card-body'>
                        <div className='acc-card-val text-cyan'>
                            {formatAmount(portfolioMetrics.totalStake, activeAccountData.currency)}
                        </div>
                        <div className='acc-card-sub text-muted'>
                            {portfolioPositions.length > 0
                                ? `+${formatAmount(portfolioMetrics.totalPotentialPayout, activeAccountData.currency)} ${localize('max')}`
                                : localize('0 open contracts')}
                        </div>
                    </div>
                </div>
            </section>

            {/* 3. SUBTLE REAL-TIME TICKER BANNER */}
            <div className='acc-live-ticker'>
                <div className='acc-ticker-head'>
                    <span className='acc-live-dot' />
                    <span className='acc-ticker-label'>{localize('LIVE TICKER')}</span>
                </div>
                {latestTransaction ? (
                    <div className='acc-ticker-body'>
                        <span className={`acc-action-pill acc-action-pill--${String(latestTransaction.action || 'buy').toLowerCase()}`}>
                            {String(latestTransaction.action || 'transaction').toUpperCase()}
                        </span>
                        <span className='acc-ticker-amount font-bold'>
                            {formatAmount(latestTransaction.amount, latestTransaction.currency || activeAccountData.currency)}
                        </span>
                        <span className='acc-ticker-divider'>•</span>
                        <span className='acc-ticker-balance'>
                            {localize('Balance')}: ${addComma((Number(latestTransaction.balance || 0)).toFixed(2))}
                        </span>
                        {latestTransaction.symbol && (
                            <>
                                <span className='acc-ticker-divider'>•</span>
                                <span className='acc-ticker-symbol'>{latestTransaction.symbol}</span>
                            </>
                        )}
                    </div>
                ) : (
                    <div className='acc-ticker-idle'>
                        {localize('Listening for live transaction broadcasts from Deriv WebSocket feed...')}
                    </div>
                )}
            </div>

            {/* 4. MAIN REPORTS & ANALYTICS WORKSPACE */}
            <main className='acc-workspace'>
                {/* Clean Segmented Tab Controls & CSV Export */}
                <div className='acc-workspace-nav'>
                    <div className='acc-tab-pills'>
                        <button
                            type='button'
                            className={`acc-tab-pill ${activeTab === 'statement' ? 'is-active' : ''}`}
                            onClick={() => setActiveTab('statement')}
                        >
                            <FileText size={14} />
                            <span>{localize('Statement & Ledger')}</span>
                            <span className='acc-tab-count'>{filteredTransactions.length}</span>
                        </button>

                        <button
                            type='button'
                            className={`acc-tab-pill ${activeTab === 'portfolio' ? 'is-active' : ''}`}
                            onClick={() => setActiveTab('portfolio')}
                        >
                            <Briefcase size={14} />
                            <span>{localize('Open Positions')}</span>
                            {portfolioPositions.length > 0 && (
                                <span className='acc-tab-count highlight'>{portfolioPositions.length}</span>
                            )}
                        </button>

                        <button
                            type='button'
                            className={`acc-tab-pill ${activeTab === 'profit_table' ? 'is-active' : ''}`}
                            onClick={() => setActiveTab('profit_table')}
                        >
                            <TrendingUp size={14} />
                            <span>{localize('Profit & Loss Table')}</span>
                            <span className='acc-tab-count'>{profitEntries.length}</span>
                        </button>

                        <button
                            type='button'
                            className={`acc-tab-pill ${activeTab === 'transactions' ? 'is-active' : ''}`}
                            onClick={() => setActiveTab('transactions')}
                        >
                            <Radio size={14} />
                            <span>{localize('Live Feed')}</span>
                            {streamEvents.length > 0 && (
                                <span className='acc-tab-count live'>{streamEvents.length}</span>
                            )}
                        </button>
                    </div>

                    <button
                        type='button'
                        className='acc-btn-export'
                        onClick={handleExportCSV}
                        disabled={
                            (activeTab === 'statement' && filteredTransactions.length === 0) ||
                            (activeTab === 'portfolio' && portfolioPositions.length === 0) ||
                            (activeTab === 'profit_table' && profitEntries.length === 0)
                        }
                    >
                        <Download size={13} />
                        <span>{localize('Export CSV')}</span>
                    </button>
                </div>

                {/* Filter & Search Toolbar */}
                {activeTab === 'statement' && (
                    <div className='acc-toolbar'>
                        <div className='acc-search-field'>
                            <Search size={14} className='acc-search-icon' />
                            <input
                                type='text'
                                placeholder={localize('Filter by ID, action, contract or market...')}
                                value={searchQuery}
                                onChange={e => setSearchQuery(e.target.value)}
                            />
                            {searchQuery && (
                                <button
                                    type='button'
                                    className='acc-clear-btn'
                                    onClick={() => setSearchQuery('')}
                                >
                                    &times;
                                </button>
                            )}
                        </div>

                        <div className='acc-filter-selects'>
                            <select
                                value={actionFilter}
                                onChange={e => setActionFilter(e.target.value)}
                                className='acc-select'
                            >
                                <option value='all'>{localize('All Actions')}</option>
                                <option value='buy'>{localize('Buy Contracts')}</option>
                                <option value='sell'>{localize('Sell / Payouts')}</option>
                                <option value='deposit'>{localize('Deposits')}</option>
                                <option value='withdrawal'>{localize('Withdrawals')}</option>
                                <option value='transfer'>{localize('Transfers')}</option>
                            </select>

                            <select
                                value={dateRangeFilter}
                                onChange={e => setDateRangeFilter(e.target.value as any)}
                                className='acc-select'
                            >
                                <option value='all'>{localize('All Time')}</option>
                                <option value='today'>{localize('Today')}</option>
                                <option value='7d'>{localize('Last 7 Days')}</option>
                                <option value='30d'>{localize('Last 30 Days')}</option>
                            </select>
                        </div>
                    </div>
                )}

                {/* ─── TAB 1: STATEMENT ─── */}
                {activeTab === 'statement' && (
                    <div className='acc-table-wrapper'>
                        {isLoadingStatement ? (
                            <div className='acc-empty-state'>
                                <RefreshCw size={24} className='animate-spin text-cyan' />
                                <p>{localize('Fetching statement ledger...')}</p>
                            </div>
                        ) : filteredTransactions.length === 0 ? (
                            <div className='acc-empty-state'>
                                <FileSpreadsheet size={32} className='text-muted' />
                                <h4>{localize('No transactions found')}</h4>
                                <p>{localize('Try adjusting your search query or date range filters.')}</p>
                            </div>
                        ) : (
                            <table className='acc-table'>
                                <thead>
                                    <tr>
                                        <th>{localize('Transaction ID')}</th>
                                        <th>{localize('Date & Time')}</th>
                                        <th>{localize('Action')}</th>
                                        <th>{localize('Market / Contract')}</th>
                                        <th className='text-right'>{localize('Amount')}</th>
                                        <th className='text-right'>{localize('Balance After')}</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {filteredTransactions.map(tx => {
                                        const isCredit = Number(tx.amount || 0) >= 0;
                                        const date = new Date(tx.transaction_time * 1000);
                                        const actionType = String(tx.action_type || 'transaction');
                                        return (
                                            <tr key={String(tx.transaction_id)}>
                                                <td className='acc-mono text-muted'>#{tx.transaction_id}</td>
                                                <td className='text-nowrap'>
                                                    {date.toLocaleDateString()} {date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                                </td>
                                                <td>
                                                    <span className={`acc-action-pill acc-action-pill--${actionType.toLowerCase()}`}>
                                                        {actionType.toUpperCase()}
                                                    </span>
                                                </td>
                                                <td>
                                                    <div className='acc-cell-contract'>
                                                        {tx.symbol && <span className='font-bold'>{tx.symbol}</span>}
                                                        {tx.contract_id && (
                                                            <span className='acc-mono text-muted'>#{tx.contract_id}</span>
                                                        )}
                                                        {tx.longcode && !tx.symbol && (
                                                            <span className='acc-cell-desc' title={tx.longcode}>
                                                                {tx.longcode}
                                                            </span>
                                                        )}
                                                    </div>
                                                </td>
                                                <td className={`text-right font-bold acc-mono ${isCredit ? 'text-win' : 'text-loss'}`}>
                                                    {formatAmount(tx.amount, tx.currency || activeAccountData.currency)}
                                                </td>
                                                <td className='text-right acc-mono'>
                                                    ${addComma((Number(tx.balance_after || 0)).toFixed(2))}
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        )}
                    </div>
                )}

                {/* ─── TAB 2: PORTFOLIO (OPEN POSITIONS) ─── */}
                {activeTab === 'portfolio' && (
                    <div className='acc-table-wrapper'>
                        {isLoadingPortfolio ? (
                            <div className='acc-empty-state'>
                                <RefreshCw size={24} className='animate-spin text-cyan' />
                                <p>{localize('Fetching live positions...')}</p>
                            </div>
                        ) : portfolioPositions.length === 0 ? (
                            <div className='acc-empty-state'>
                                <Briefcase size={32} className='text-muted' />
                                <h4>{localize('No active open positions')}</h4>
                                <p>{localize('Active contracts from manual or bot trades will appear here.')}</p>
                            </div>
                        ) : (
                            <table className='acc-table'>
                                <thead>
                                    <tr>
                                        <th>{localize('Contract ID')}</th>
                                        <th>{localize('Market / Symbol')}</th>
                                        <th>{localize('Contract Type')}</th>
                                        <th className='text-right'>{localize('Stake')}</th>
                                        <th className='text-right'>{localize('Potential Payout')}</th>
                                        <th>{localize('Purchase Time')}</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {portfolioPositions.map(p => {
                                        const pDate = new Date(p.purchase_time * 1000).toLocaleTimeString();
                                        return (
                                            <tr key={String(p.contract_id)}>
                                                <td className='acc-mono text-muted'>#{p.contract_id}</td>
                                                <td className='font-bold'>{p.symbol}</td>
                                                <td>
                                                    <span className='acc-action-pill acc-action-pill--buy'>
                                                        {p.contract_type}
                                                    </span>
                                                </td>
                                                <td className='text-right font-bold acc-mono'>
                                                    {formatAmount(p.buy_price, p.currency || activeAccountData.currency)}
                                                </td>
                                                <td className='text-right font-bold acc-mono text-win'>
                                                    +{formatAmount(p.payout, p.currency || activeAccountData.currency)}
                                                </td>
                                                <td className='text-muted'>{pDate}</td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        )}
                    </div>
                )}

                {/* ─── TAB 3: PROFIT & LOSS ─── */}
                {activeTab === 'profit_table' && (
                    <div className='acc-table-wrapper'>
                        {isLoadingProfitTable ? (
                            <div className='acc-empty-state'>
                                <RefreshCw size={24} className='animate-spin text-cyan' />
                                <p>{localize('Fetching profit/loss history...')}</p>
                            </div>
                        ) : profitEntries.length === 0 ? (
                            <div className='acc-empty-state'>
                                <TrendingUp size={32} className='text-muted' />
                                <h4>{localize('No settled contracts')}</h4>
                                <p>{localize('Closed contracts and trading performance will appear here.')}</p>
                            </div>
                        ) : (
                            <table className='acc-table'>
                                <thead>
                                    <tr>
                                        <th>{localize('Contract ID')}</th>
                                        <th>{localize('Purchase Time')}</th>
                                        <th>{localize('Sell Time')}</th>
                                        <th className='text-right'>{localize('Buy Price')}</th>
                                        <th className='text-right'>{localize('Sell Price')}</th>
                                        <th className='text-right'>{localize('Profit / Loss')}</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {profitEntries.map(p => {
                                        const isWon = (Number(p.profit_loss) || 0) > 0;
                                        const pTime = new Date(p.purchase_time * 1000).toLocaleString([], {
                                            month: 'short',
                                            day: 'numeric',
                                            hour: '2-digit',
                                            minute: '2-digit',
                                        });
                                        const sTime = new Date(p.sell_time * 1000).toLocaleTimeString([], {
                                            hour: '2-digit',
                                            minute: '2-digit',
                                        });
                                        return (
                                            <tr key={String(p.contract_id)}>
                                                <td className='acc-mono text-muted'>#{p.contract_id}</td>
                                                <td className='text-nowrap'>{pTime}</td>
                                                <td className='text-nowrap'>{sTime}</td>
                                                <td className='text-right acc-mono'>
                                                    {formatAmount(p.buy_price, activeAccountData.currency)}
                                                </td>
                                                <td className='text-right acc-mono font-bold'>
                                                    {formatAmount(p.sell_price, activeAccountData.currency)}
                                                </td>
                                                <td className={`text-right acc-mono font-bold ${isWon ? 'text-win' : 'text-loss'}`}>
                                                    {isWon ? '+' : ''}{formatAmount(p.profit_loss, activeAccountData.currency)}
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        )}
                    </div>
                )}

                {/* ─── TAB 4: LIVE STREAM ACTIVITY ─── */}
                {activeTab === 'transactions' && (
                    <div className='acc-table-wrapper'>
                        {streamEvents.length === 0 ? (
                            <div className='acc-empty-state'>
                                <Activity size={32} className='text-cyan' />
                                <h4>{localize('Stream connected and listening')}</h4>
                                <p>{localize('New contract purchases or settlements will appear here in real-time.')}</p>
                            </div>
                        ) : (
                            <table className='acc-table'>
                                <thead>
                                    <tr>
                                        <th>{localize('Time')}</th>
                                        <th>{localize('Action')}</th>
                                        <th>{localize('Contract ID')}</th>
                                        <th>{localize('Symbol')}</th>
                                        <th className='text-right'>{localize('Amount')}</th>
                                        <th className='text-right'>{localize('Balance After')}</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {streamEvents.map((st, idx) => {
                                        const isCredit = Number(st.amount || 0) >= 0;
                                        const tDate = st.transaction_time
                                            ? new Date(st.transaction_time * 1000).toLocaleTimeString()
                                            : '—';
                                        const actionStr = String(st.action || 'transaction');
                                        return (
                                            <tr key={`${st.transaction_id}-${idx}`}>
                                                <td className='acc-mono text-muted text-nowrap'>{tDate}</td>
                                                <td>
                                                    <span className={`acc-action-pill acc-action-pill--${actionStr.toLowerCase()}`}>
                                                        {actionStr.toUpperCase()}
                                                    </span>
                                                </td>
                                                <td className='acc-mono'>
                                                    {st.contract_id ? `#${st.contract_id}` : '—'}
                                                </td>
                                                <td className='font-bold'>{st.symbol || st.display_name || '—'}</td>
                                                <td className={`text-right acc-mono font-bold ${isCredit ? 'text-win' : 'text-loss'}`}>
                                                    {formatAmount(st.amount, st.currency || activeAccountData.currency)}
                                                </td>
                                                <td className='text-right acc-mono font-bold'>
                                                    ${addComma((Number(st.balance || 0)).toFixed(2))}
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        )}
                    </div>
                )}
            </main>

            {/* 5. SESSION SECURITY & PROTOCOL FOOTER */}
            <footer className='acc-footer'>
                <div className='acc-footer-left'>
                    <Shield size={14} className='text-win' />
                    <span>{localize('Secure Deriv Gateway Session Active')}</span>
                    <span className='acc-footer-id'>{selectedLoginId}</span>
                </div>

                <div className='acc-footer-right'>
                    <button
                        type='button'
                        className='acc-btn-logout'
                        onClick={() => {
                            if (client?.logout) client.logout();
                            else {
                                localStorage.clear();
                                sessionStorage.clear();
                                window.location.href = '/';
                            }
                        }}
                    >
                        <LogOut size={13} />
                        <span>{localize('Log Out')}</span>
                    </button>
                </div>
            </footer>
        </div>
    );
});

export default AccountPage;
