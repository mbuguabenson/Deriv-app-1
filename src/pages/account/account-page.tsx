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
    Download,
    ExternalLink,
    FileSpreadsheet,
    FileText,
    Filter,
    Layers,
    LogOut,
    Radio,
    RefreshCw,
    RotateCcw,
    Search,
    Shield,
    Sparkles,
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
            loginid: selectedLoginId,
            currency: curr,
            balance,
            isDemo,
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
    const formatAmount = (amount: number, curr = 'USD') => {
        const isKes = displayCurrency === 'KES' && curr === 'USD';
        const val = isKes ? amount * rate : amount;
        const code = isKes ? 'KES' : getCurrencyDisplayCode(curr);
        const prefix = val > 0 ? '+' : '';
        const dec = isKes ? 2 : getDecimalPlaces(curr);
        return `${prefix}${addComma(val.toFixed(dec))} ${code}`;
    };

    // Filter statement transactions
    const filteredTransactions = useMemo(() => {
        let list = transactions;
        if (actionFilter !== 'all') {
            list = list.filter(t => t.action_type.toLowerCase() === actionFilter.toLowerCase());
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

        const netCashFlow = totalCredits - totalDebits;
        const currentBalance =
            filteredTransactions.length > 0 ? Number(filteredTransactions[0].balance_after) || 0 : activeAccountData.balance;

        return {
            totalCredits,
            totalDebits,
            netCashFlow,
            currentBalance,
            count: filteredTransactions.length,
        };
    }, [filteredTransactions, activeAccountData.balance]);

    // Portfolio metrics
    const portfolioMetrics = useMemo(() => {
        let totalStake = 0;
        let totalPotentialPayout = 0;

        portfolioPositions.forEach(p => {
            totalStake += p.buy_price || 0;
            totalPotentialPayout += p.payout || 0;
        });

        return {
            count: portfolioPositions.length,
            totalStake,
            totalPotentialPayout,
        };
    }, [portfolioPositions]);

    // Profit table metrics
    const profitMetrics = useMemo(() => {
        let totalBuy = 0;
        let totalSell = 0;
        let winCount = 0;

        profitEntries.forEach(p => {
            totalBuy += p.buy_price || 0;
            totalSell += p.sell_price || 0;
            if (p.profit_loss > 0) winCount++;
        });

        const netProfit = totalSell - totalBuy;
        const count = profitEntries.length;
        const winRate = count > 0 ? (winCount / count) * 100 : 0;

        return {
            count,
            winCount,
            winRate,
            totalBuy,
            totalSell,
            netProfit,
        };
    }, [profitEntries]);

    const handleCopyId = () => {
        if (!selectedLoginId) return;
        navigator.clipboard?.writeText(selectedLoginId);
        setCopiedId(true);
        setTimeout(() => setCopiedId(false), 2000);
    };

    const handleResetDemoBalance = async () => {
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
                t.action_type.toUpperCase(),
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
            {/* 1. TOP INSTITUTIONAL HEADER BAR */}
            <header className='acc-topbar'>
                <div className='acc-topbar__left'>
                    <button
                        type='button'
                        className='acc-back-btn'
                        onClick={() => navigate(-1)}
                        title={localize('Go Back')}
                    >
                        <ArrowLeft size={18} />
                        <span>{localize('Back')}</span>
                    </button>
                    <div className='acc-title-group'>
                        <div className='acc-title-row'>
                            <div className='acc-brand-badge'>
                                <Shield size={18} />
                            </div>
                            <h1 className='acc-title'>{localize('Account Overview & Reports')}</h1>
                            <span className='acc-version-tag'>Deriv Live Gateway</span>
                        </div>
                        <p className='acc-subtitle'>
                            {localize('Multi-account financial ledger, active portfolio, and live trade analytics.')}
                        </p>
                    </div>
                </div>

                <div className='acc-topbar__right'>
                    {/* Active Account Pill Switcher */}
                    <div className='acc-topbar__account-pill'>
                        <span className={`acc-type-badge ${activeAccountData.isDemo ? 'demo' : 'real'}`}>
                            {activeAccountData.isDemo ? 'DEMO' : 'REAL'}
                        </span>
                        <span className='acc-topbar__loginid'>{activeAccountData.loginid}</span>
                        <span className='acc-topbar__balance'>
                            ${activeAccountData.balance.toLocaleString('en-US', {
                                minimumFractionDigits: 2,
                                maximumFractionDigits: 2,
                            })}
                        </span>
                    </div>

                    <button
                        type='button'
                        className='acc-action-btn acc-action-btn--refresh'
                        onClick={handleRefreshCurrentTab}
                        disabled={isCurrentTabLoading}
                        title={localize('Refresh reports data')}
                    >
                        <RefreshCw size={15} className={isCurrentTabLoading ? 'animate-spin' : ''} />
                        <span>{localize('Refresh')}</span>
                    </button>
                </div>
            </header>

            {/* 2. REAL-TIME TRANSACTION STREAM TICKER */}
            <div className='acc-stream-ticker'>
                <div className='acc-stream-ticker__indicator'>
                    <span className={`acc-pulse-dot ${isStreamSubscribed ? 'active' : ''}`} />
                    <span className='acc-stream-ticker__label'>{localize('LIVE FEED')}</span>
                </div>
                {latestTransaction ? (
                    <div className='acc-stream-ticker__event'>
                        <span className={`acc-stream-ticker__badge ${latestTransaction.amount >= 0 ? 'credit' : 'debit'}`}>
                            {latestTransaction.action.toUpperCase()}
                        </span>
                        <span className='acc-stream-ticker__amount'>
                            {formatAmount(latestTransaction.amount, latestTransaction.currency)}
                        </span>
                        <span className='acc-stream-ticker__dot'>•</span>
                        <span className='acc-stream-ticker__meta'>
                            {localize('Balance')}: ${addComma(latestTransaction.balance.toFixed(2))} {latestTransaction.currency}
                        </span>
                        {latestTransaction.symbol && (
                            <>
                                <span className='acc-stream-ticker__dot'>•</span>
                                <span className='acc-stream-ticker__symbol'>{latestTransaction.symbol}</span>
                            </>
                        )}
                    </div>
                ) : (
                    <span className='acc-stream-ticker__idle'>
                        {localize('Listening for real-time WebSocket transactions and balance updates...')}
                    </span>
                )}
            </div>

            {/* 3. CREATIVE BENTO CARDS HERO GRID */}
            <section className='acc-bento-grid'>
                {/* CARD 1: Creative VIP Glass Credit Card */}
                <div className={`acc-glass-card ${activeAccountData.isDemo ? 'acc-glass-card--demo' : 'acc-glass-card--real'}`}>
                    <div className='acc-glass-card__mesh' />
                    
                    <div className='acc-glass-card__top'>
                        <div className='acc-glass-card__chip-row'>
                            {/* EMV Chip & Contactless Icons */}
                            <div className='acc-emv-chip'>
                                <div className='acc-emv-line' />
                                <div className='acc-emv-line' />
                            </div>
                            <Radio size={20} className='acc-nfc-icon' />
                        </div>
                        <div className='acc-glass-card__badge-row'>
                            <button
                                type='button'
                                className='acc-glass-card__copy-btn'
                                onClick={handleCopyId}
                                title={localize('Copy Login ID')}
                            >
                                {copiedId ? <CheckCircle2 size={13} className='text-success' /> : <Copy size={13} />}
                                <span>{activeAccountData.loginid}</span>
                            </button>
                            <span className={`acc-pill-badge ${activeAccountData.isDemo ? 'demo' : 'real'}`}>
                                {activeAccountData.isDemo ? 'VIRTUAL DEMO' : 'REAL MONEY'}
                            </span>
                        </div>
                    </div>

                    <div className='acc-glass-card__mid'>
                        <span className='acc-glass-card__label'>{localize('Available Funds')}</span>
                        <div className='acc-glass-card__balance'>
                            {formatAmount(activeAccountData.balance, activeAccountData.currency)}
                        </div>
                        {displayCurrency === 'KES' && activeAccountData.currency === 'USD' && (
                            <div className='acc-glass-card__converted'>
                                &asymp; KES {addComma((activeAccountData.balance * rate).toFixed(2))}
                            </div>
                        )}
                    </div>

                    <div className='acc-glass-card__footer'>
                        <button
                            type='button'
                            className='acc-card-btn acc-card-btn--primary'
                            onClick={() => window.open('https://app.deriv.com/cashier/deposit', '_blank')}
                        >
                            <span>{localize('Deposit / Cashier')}</span>
                            <ExternalLink size={13} />
                        </button>

                        <button
                            type='button'
                            className='acc-card-btn acc-card-btn--secondary'
                            onClick={() => window.dispatchEvent(new Event('open_wallet_management'))}
                        >
                            <Wallet size={14} />
                            <span>{localize('Wallets')}</span>
                        </button>

                        {activeAccountData.isDemo && (
                            <button
                                type='button'
                                className='acc-card-btn acc-card-btn--reset'
                                onClick={handleResetDemoBalance}
                                disabled={isResetting}
                                title='Reset demo funds to $10,000'
                            >
                                <RotateCcw size={13} className={isResetting ? 'animate-spin' : ''} />
                                <span>{isResetting ? localize('Resetting...') : localize('Top-up $10k')}</span>
                            </button>
                        )}
                    </div>

                    {resetMsg && <div className='acc-glass-card__toast'>{resetMsg}</div>}
                </div>

                {/* CARD 2: Financial Performance Pulse Card */}
                <div className='acc-stat-bento-card'>
                    <div className='acc-stat-bento-card__head'>
                        <div className='acc-stat-bento-card__title-group'>
                            <TrendingUp size={18} className='text-cyan' />
                            <h3 className='acc-stat-bento-card__title'>{localize('Performance Pulse')}</h3>
                        </div>
                        <span className='acc-stat-bento-card__tag'>{localize('Session Stats')}</span>
                    </div>

                    <div className='acc-stat-bento-card__metrics'>
                        <div className='acc-metric-cell'>
                            <span className='acc-metric-cell__label'>{localize('Trading Win Rate')}</span>
                            <div className='acc-metric-cell__val-group'>
                                <span className={`acc-metric-cell__val ${profitMetrics.winRate >= 50 ? 'text-win' : 'text-loss'}`}>
                                    {profitMetrics.winRate.toFixed(1)}%
                                </span>
                                <span className='acc-metric-cell__sub'>
                                    ({profitMetrics.winCount}/{profitMetrics.count} {localize('Won')})
                                </span>
                            </div>
                        </div>

                        <div className='acc-metric-cell'>
                            <span className='acc-metric-cell__label'>{localize('Net Closed P&L')}</span>
                            <span className={`acc-metric-cell__val ${profitMetrics.netProfit >= 0 ? 'text-win' : 'text-loss'}`}>
                                {profitMetrics.netProfit >= 0 ? '+' : ''}
                                {formatAmount(profitMetrics.netProfit, activeAccountData.currency)}
                            </span>
                        </div>

                        <div className='acc-metric-cell'>
                            <span className='acc-metric-cell__label'>{localize('Net Cash Flow')}</span>
                            <span className={`acc-metric-cell__val ${statementMetrics.netCashFlow >= 0 ? 'text-win' : 'text-loss'}`}>
                                {statementMetrics.netCashFlow >= 0 ? '+' : ''}
                                {formatAmount(statementMetrics.netCashFlow, activeAccountData.currency)}
                            </span>
                        </div>

                        <div className='acc-metric-cell'>
                            <span className='acc-metric-cell__label'>{localize('Open Exposure')}</span>
                            <span className='acc-metric-cell__val text-cyan'>
                                {formatAmount(portfolioMetrics.totalStake, activeAccountData.currency)}
                            </span>
                        </div>
                    </div>
                </div>

                {/* CARD 3: Linked Accounts Switcher & Multi-Wallet Hub */}
                <div className='acc-stat-bento-card acc-stat-bento-card--accounts'>
                    <div className='acc-stat-bento-card__head'>
                        <div className='acc-stat-bento-card__title-group'>
                            <Layers size={18} className='text-indigo' />
                            <h3 className='acc-stat-bento-card__title'>{localize('Connected Accounts')}</h3>
                        </div>
                        <span className='acc-stat-bento-card__tag'>{accountList?.length || 0} {localize('Active')}</span>
                    </div>

                    <div className='acc-account-selector-list'>
                        {accountList && accountList.length > 0 ? (
                            accountList.map(acc => {
                                const isDemo = isDemoAccount(acc.loginid);
                                const isSelected = acc.loginid === selectedLoginId;
                                const accCurr = acc.currency || 'USD';
                                const balanceVal = Number(acc.balance ?? 0);

                                return (
                                    <div
                                        key={acc.loginid}
                                        className={`acc-selector-item ${isSelected ? 'is-selected' : ''}`}
                                        onClick={() => setSelectedLoginId(acc.loginid)}
                                    >
                                        <div className='acc-selector-item__left'>
                                            <span className={`acc-type-dot ${isDemo ? 'demo' : 'real'}`} />
                                            <div>
                                                <div className='acc-selector-item__loginid'>
                                                    {acc.loginid}
                                                    {isSelected && <span className='acc-selected-badge'>{localize('Viewing')}</span>}
                                                </div>
                                                <span className={`acc-selector-item__type ${isDemo ? 'demo' : 'real'}`}>
                                                    {isDemo ? 'Demo Account' : 'Real Money'}
                                                </span>
                                            </div>
                                        </div>

                                        <div className='acc-selector-item__right'>
                                            <span className='acc-selector-item__balance'>
                                                ${balanceVal.toLocaleString('en-US', {
                                                    minimumFractionDigits: 2,
                                                    maximumFractionDigits: 2,
                                                })}
                                            </span>
                                            <span className='acc-selector-item__curr'>{accCurr}</span>
                                        </div>
                                    </div>
                                );
                            })
                        ) : (
                            <div className='acc-selector-empty'>
                                {localize('No additional accounts detected in session.')}
                            </div>
                        )}
                    </div>
                </div>
            </section>

            {/* 4. MAIN REPORTS & ANALYTICS WORKSPACE */}
            <section className='acc-reports-card'>
                {/* Tab Navigation Segments */}
                <div className='acc-tabs-header'>
                    <div className='acc-nav-segments'>
                        <button
                            type='button'
                            className={`acc-segment-btn ${activeTab === 'statement' ? 'active' : ''}`}
                            onClick={() => setActiveTab('statement')}
                        >
                            <FileText size={15} />
                            <span>{localize('Statement & Ledger')}</span>
                            <span className='acc-segment-badge'>{filteredTransactions.length}</span>
                        </button>

                        <button
                            type='button'
                            className={`acc-segment-btn ${activeTab === 'portfolio' ? 'active' : ''}`}
                            onClick={() => setActiveTab('portfolio')}
                        >
                            <Briefcase size={15} />
                            <span>{localize('Open Positions')}</span>
                            {portfolioPositions.length > 0 && (
                                <span className='acc-segment-badge acc-segment-badge--highlight'>
                                    {portfolioPositions.length}
                                </span>
                            )}
                        </button>

                        <button
                            type='button'
                            className={`acc-segment-btn ${activeTab === 'profit_table' ? 'active' : ''}`}
                            onClick={() => setActiveTab('profit_table')}
                        >
                            <TrendingUp size={15} />
                            <span>{localize('Profit & Loss Table')}</span>
                            <span className='acc-segment-badge'>{profitEntries.length}</span>
                        </button>

                        <button
                            type='button'
                            className={`acc-segment-btn ${activeTab === 'transactions' ? 'active' : ''}`}
                            onClick={() => setActiveTab('transactions')}
                        >
                            <Radio size={15} />
                            <span>{localize('Live Stream')}</span>
                            {streamEvents.length > 0 && (
                                <span className='acc-segment-badge acc-segment-badge--live'>
                                    {streamEvents.length}
                                </span>
                            )}
                        </button>
                    </div>

                    <button
                        type='button'
                        className='acc-export-btn'
                        onClick={handleExportCSV}
                        disabled={
                            (activeTab === 'statement' && filteredTransactions.length === 0) ||
                            (activeTab === 'portfolio' && portfolioPositions.length === 0) ||
                            (activeTab === 'profit_table' && profitEntries.length === 0)
                        }
                        title={localize('Export active report as CSV')}
                    >
                        <Download size={14} />
                        <span>{localize('Export CSV')}</span>
                    </button>
                </div>

                {/* TAB 1: STATEMENT & FINANCIAL LEDGER */}
                {activeTab === 'statement' && (
                    <div className='acc-tab-content'>
                        {/* KPI Metrics Chips */}
                        <div className='acc-kpi-chips-grid'>
                            <div className='acc-kpi-chip'>
                                <span className='acc-kpi-chip__label'>{localize('Total Entries')}</span>
                                <span className='acc-kpi-chip__val'>{statementMetrics.count}</span>
                            </div>
                            <div className='acc-kpi-chip'>
                                <span className='acc-kpi-chip__label'>{localize('Net Cash Flow')}</span>
                                <span className={`acc-kpi-chip__val ${statementMetrics.netCashFlow >= 0 ? 'text-win' : 'text-loss'}`}>
                                    {statementMetrics.netCashFlow >= 0 ? '+' : ''}
                                    {formatAmount(statementMetrics.netCashFlow, activeAccountData.currency)}
                                </span>
                            </div>
                            <div className='acc-kpi-chip'>
                                <span className='acc-kpi-chip__label'>{localize('Total Inflow')}</span>
                                <span className='acc-kpi-chip__val text-win'>
                                    +{formatAmount(statementMetrics.totalCredits, activeAccountData.currency)}
                                </span>
                            </div>
                            <div className='acc-kpi-chip'>
                                <span className='acc-kpi-chip__label'>{localize('Total Outflow')}</span>
                                <span className='acc-kpi-chip__val text-loss'>
                                    -{formatAmount(statementMetrics.totalDebits, activeAccountData.currency)}
                                </span>
                            </div>
                        </div>

                        {/* Filter Bar */}
                        <div className='acc-filter-bar'>
                            <div className='acc-search-box'>
                                <Search size={14} className='acc-search-icon' />
                                <input
                                    type='text'
                                    placeholder={localize('Search by ID, contract, symbol, action...')}
                                    value={searchQuery}
                                    onChange={e => setSearchQuery(e.target.value)}
                                    className='acc-search-input'
                                />
                                {searchQuery && (
                                    <button
                                        type='button'
                                        className='acc-clear-search-btn'
                                        onClick={() => setSearchQuery('')}
                                    >
                                        &times;
                                    </button>
                                )}
                            </div>

                            <div className='acc-filter-select-group'>
                                <Filter size={13} className='acc-select-icon' />
                                <select
                                    value={actionFilter}
                                    onChange={e => setActionFilter(e.target.value)}
                                    className='acc-custom-select'
                                >
                                    <option value='all'>{localize('All Actions')}</option>
                                    <option value='buy'>{localize('Buy Contracts')}</option>
                                    <option value='sell'>{localize('Sell / Payouts')}</option>
                                    <option value='deposit'>{localize('Deposits')}</option>
                                    <option value='withdrawal'>{localize('Withdrawals')}</option>
                                    <option value='transfer'>{localize('Transfers')}</option>
                                    <option value='adjustment'>{localize('Adjustments')}</option>
                                </select>
                            </div>

                            <div className='acc-filter-select-group'>
                                <Calendar size={13} className='acc-select-icon' />
                                <select
                                    value={dateRangeFilter}
                                    onChange={e => setDateRangeFilter(e.target.value as any)}
                                    className='acc-custom-select'
                                >
                                    <option value='all'>{localize('All Time')}</option>
                                    <option value='today'>{localize('Today')}</option>
                                    <option value='7d'>{localize('Last 7 Days')}</option>
                                    <option value='30d'>{localize('Last 30 Days')}</option>
                                </select>
                            </div>
                        </div>

                        {/* Statement Table */}
                        {isLoadingStatement ? (
                            <div className='acc-table-loading'>
                                <RefreshCw size={24} className='animate-spin text-cyan' />
                                <p>{localize('Fetching statement ledger from Deriv Gateway...')}</p>
                            </div>
                        ) : filteredTransactions.length === 0 ? (
                            <div className='acc-table-empty'>
                                <FileSpreadsheet size={36} className='text-muted' />
                                <h4>{localize('No transactions found')}</h4>
                                <p>{localize('No transaction records match the current filter criteria.')}</p>
                            </div>
                        ) : (
                            <div className='acc-table-responsive'>
                                <table className='acc-data-table'>
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
                                            const isCredit = Number(tx.amount) >= 0;
                                            const date = new Date(tx.transaction_time * 1000);
                                            const formattedDate = date.toLocaleDateString(undefined, {
                                                month: 'short',
                                                day: '2-digit',
                                                year: 'numeric',
                                            });
                                            const formattedTime = date.toLocaleTimeString(undefined, {
                                                hour: '2-digit',
                                                minute: '2-digit',
                                                second: '2-digit',
                                            });

                                            return (
                                                <tr key={String(tx.transaction_id)}>
                                                    <td className='acc-mono text-muted'>
                                                        #{String(tx.transaction_id)}
                                                    </td>
                                                    <td className='text-nowrap'>
                                                        <div className='acc-datetime-cell'>
                                                            <span className='acc-datetime-cell__date'>{formattedDate}</span>
                                                            <span className='acc-datetime-cell__time'>{formattedTime}</span>
                                                        </div>
                                                    </td>
                                                    <td>
                                                        <span className={`acc-action-pill acc-action-pill--${tx.action_type.toLowerCase()}`}>
                                                            {tx.action_type.toUpperCase()}
                                                        </span>
                                                    </td>
                                                    <td>
                                                        <div className='acc-contract-cell'>
                                                            {tx.contract_id && (
                                                                <span className='acc-contract-id-pill'>ID: {tx.contract_id}</span>
                                                            )}
                                                            <span className='acc-contract-desc' title={tx.longcode || tx.shortcode}>
                                                                {tx.longcode || tx.shortcode || '—'}
                                                            </span>
                                                        </div>
                                                    </td>
                                                    <td className={`text-right acc-mono font-bold ${isCredit ? 'text-win' : 'text-loss'}`}>
                                                        {formatAmount(tx.amount, tx.currency || activeAccountData.currency)}
                                                    </td>
                                                    <td className='text-right acc-mono font-bold'>
                                                        ${addComma(Number(tx.balance_after).toFixed(2))} {tx.currency || activeAccountData.currency}
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                    <tfoot>
                                        <tr className='acc-table-footer-row'>
                                            <td colSpan={4} className='text-right font-bold'>
                                                {localize('Net Total (%{count} transactions):', { count: filteredTransactions.length })}
                                            </td>
                                            <td className={`text-right acc-mono font-bold ${statementMetrics.netCashFlow >= 0 ? 'text-win' : 'text-loss'}`}>
                                                {formatAmount(statementMetrics.netCashFlow, activeAccountData.currency)}
                                            </td>
                                            <td className='text-right acc-mono text-muted'>—</td>
                                        </tr>
                                    </tfoot>
                                </table>
                            </div>
                        )}
                    </div>
                )}

                {/* TAB 2: OPEN POSITIONS (PORTFOLIO) */}
                {activeTab === 'portfolio' && (
                    <div className='acc-tab-content'>
                        {/* KPI Metrics Chips */}
                        <div className='acc-kpi-chips-grid'>
                            <div className='acc-kpi-chip'>
                                <span className='acc-kpi-chip__label'>{localize('Open Positions')}</span>
                                <span className='acc-kpi-chip__val'>{portfolioMetrics.count}</span>
                            </div>
                            <div className='acc-kpi-chip'>
                                <span className='acc-kpi-chip__label'>{localize('Total Active Stake')}</span>
                                <span className='acc-kpi-chip__val text-cyan'>
                                    {formatAmount(portfolioMetrics.totalStake, activeAccountData.currency)}
                                </span>
                            </div>
                            <div className='acc-kpi-chip'>
                                <span className='acc-kpi-chip__label'>{localize('Potential Payout')}</span>
                                <span className='acc-kpi-chip__val text-win'>
                                    +{formatAmount(portfolioMetrics.totalPotentialPayout, activeAccountData.currency)}
                                </span>
                            </div>
                            <div className='acc-kpi-chip'>
                                <span className='acc-kpi-chip__label'>{localize('Potential Net Profit')}</span>
                                <span className='acc-kpi-chip__val text-win'>
                                    +{formatAmount(portfolioMetrics.totalPotentialPayout - portfolioMetrics.totalStake, activeAccountData.currency)}
                                </span>
                            </div>
                        </div>

                        {/* Portfolio Table */}
                        {isLoadingPortfolio ? (
                            <div className='acc-table-loading'>
                                <RefreshCw size={24} className='animate-spin text-cyan' />
                                <p>{localize('Fetching live market positions...')}</p>
                            </div>
                        ) : portfolioPositions.length === 0 ? (
                            <div className='acc-table-empty'>
                                <Briefcase size={36} className='text-muted' />
                                <h4>{localize('No active open positions')}</h4>
                                <p>{localize('Contracts placed manually or by automated bots will show here in real time.')}</p>
                            </div>
                        ) : (
                            <div className='acc-table-responsive'>
                                <table className='acc-data-table'>
                                    <thead>
                                        <tr>
                                            <th>{localize('Contract ID')}</th>
                                            <th>{localize('Market / Symbol')}</th>
                                            <th>{localize('Contract Type')}</th>
                                            <th className='text-right'>{localize('Stake')}</th>
                                            <th className='text-right'>{localize('Potential Payout')}</th>
                                            <th>{localize('Purchase Time')}</th>
                                            <th>{localize('Expiry Time')}</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {portfolioPositions.map(p => {
                                            const pDate = new Date(p.purchase_time * 1000).toLocaleTimeString();
                                            const eDate = p.expiry_time ? new Date(p.expiry_time * 1000).toLocaleTimeString() : '—';
                                            return (
                                                <tr key={String(p.contract_id)}>
                                                    <td className='acc-mono text-muted'>#{p.contract_id}</td>
                                                    <td className='font-bold'>{p.symbol}</td>
                                                    <td>
                                                        <span className='acc-action-pill acc-action-pill--buy'>
                                                            {p.contract_type}
                                                        </span>
                                                    </td>
                                                    <td className='text-right acc-mono font-bold'>
                                                        {formatAmount(p.buy_price, p.currency || activeAccountData.currency)}
                                                    </td>
                                                    <td className='text-right acc-mono font-bold text-win'>
                                                        +{formatAmount(p.payout, p.currency || activeAccountData.currency)}
                                                    </td>
                                                    <td className='text-muted'>{pDate}</td>
                                                    <td className='text-muted'>{eDate}</td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </div>
                )}

                {/* TAB 3: PROFIT & LOSS TABLE */}
                {activeTab === 'profit_table' && (
                    <div className='acc-tab-content'>
                        {/* KPI Metrics Chips */}
                        <div className='acc-kpi-chips-grid'>
                            <div className='acc-kpi-chip'>
                                <span className='acc-kpi-chip__label'>{localize('Total Trades')}</span>
                                <span className='acc-kpi-chip__val'>{profitMetrics.count}</span>
                            </div>
                            <div className='acc-kpi-chip'>
                                <span className='acc-kpi-chip__label'>{localize('Win Rate')}</span>
                                <span className={`acc-kpi-chip__val ${profitMetrics.winRate >= 50 ? 'text-win' : 'text-loss'}`}>
                                    {profitMetrics.winRate.toFixed(1)}% ({profitMetrics.winCount}/{profitMetrics.count})
                                </span>
                            </div>
                            <div className='acc-kpi-chip'>
                                <span className='acc-kpi-chip__label'>{localize('Net Return')}</span>
                                <span className={`acc-kpi-chip__val ${profitMetrics.netProfit >= 0 ? 'text-win' : 'text-loss'}`}>
                                    {profitMetrics.netProfit >= 0 ? '+' : ''}
                                    {formatAmount(profitMetrics.netProfit, activeAccountData.currency)}
                                </span>
                            </div>
                            <div className='acc-kpi-chip'>
                                <span className='acc-kpi-chip__label'>{localize('Total Turnover')}</span>
                                <span className='acc-kpi-chip__val'>
                                    {formatAmount(profitMetrics.totalBuy, activeAccountData.currency)}
                                </span>
                            </div>
                        </div>

                        {/* Date Filter Bar */}
                        <div className='acc-filter-bar'>
                            <div className='acc-filter-select-group'>
                                <Calendar size={13} className='acc-select-icon' />
                                <select
                                    value={dateRangeFilter}
                                    onChange={e => setDateRangeFilter(e.target.value as any)}
                                    className='acc-custom-select'
                                >
                                    <option value='all'>{localize('All Time')}</option>
                                    <option value='today'>{localize('Today')}</option>
                                    <option value='7d'>{localize('Last 7 Days')}</option>
                                    <option value='30d'>{localize('Last 30 Days')}</option>
                                </select>
                            </div>
                        </div>

                        {/* Profit Table */}
                        {isLoadingProfitTable ? (
                            <div className='acc-table-loading'>
                                <RefreshCw size={24} className='animate-spin text-cyan' />
                                <p>{localize('Fetching closed contracts...')}</p>
                            </div>
                        ) : profitEntries.length === 0 ? (
                            <div className='acc-table-empty'>
                                <TrendingUp size={36} className='text-muted' />
                                <h4>{localize('No closed contracts found')}</h4>
                                <p>{localize('Completed contracts will appear here with calculated P&L results.')}</p>
                            </div>
                        ) : (
                            <div className='acc-table-responsive'>
                                <table className='acc-data-table'>
                                    <thead>
                                        <tr>
                                            <th>{localize('Contract ID')}</th>
                                            <th>{localize('Purchase Time')}</th>
                                            <th>{localize('Sell Time')}</th>
                                            <th className='text-right'>{localize('Buy Price')}</th>
                                            <th className='text-right'>{localize('Sell Price')}</th>
                                            <th className='text-right'>{localize('Profit / Loss')}</th>
                                            <th>{localize('Summary')}</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {profitEntries.map(p => {
                                            const isWon = p.profit_loss > 0;
                                            const pTime = new Date(p.purchase_time * 1000).toLocaleString();
                                            const sTime = new Date(p.sell_time * 1000).toLocaleTimeString();
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
                                                    <td className='acc-details-text' title={p.longcode || p.shortcode}>
                                                        {p.shortcode || p.longcode || '—'}
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                    <tfoot>
                                        <tr className='acc-table-footer-row'>
                                            <td colSpan={5} className='text-right font-bold'>
                                                {localize('Net Profit/Loss Total (%{count} trades):', { count: profitEntries.length })}
                                            </td>
                                            <td className={`text-right acc-mono font-bold ${profitMetrics.netProfit >= 0 ? 'text-win' : 'text-loss'}`}>
                                                {profitMetrics.netProfit >= 0 ? '+' : ''}{formatAmount(profitMetrics.netProfit, activeAccountData.currency)}
                                            </td>
                                            <td className='text-muted'>—</td>
                                        </tr>
                                    </tfoot>
                                </table>
                            </div>
                        )}
                    </div>
                )}

                {/* TAB 4: LIVE TRANSACTION STREAM */}
                {activeTab === 'transactions' && (
                    <div className='acc-tab-content'>
                        <div className='acc-stream-feed-head'>
                            <div>
                                <h3 className='acc-stream-feed-title'>{localize('Real-Time Gateway Stream')}</h3>
                                <p className='acc-stream-feed-sub'>
                                    {localize('Instant push notifications streamed directly from Deriv WebSocket servers.')}
                                </p>
                            </div>
                            <span className='acc-live-pulse-badge'>
                                <span className='acc-live-pulse-badge__dot' />
                                {localize('LISTENING LIVE')}
                            </span>
                        </div>

                        {streamEvents.length === 0 ? (
                            <div className='acc-table-empty'>
                                <Activity size={36} className='text-cyan' />
                                <h4>{localize('Stream connected and listening')}</h4>
                                <p>{localize('Trade executions or balance shifts will populate this table instantaneously.')}</p>
                            </div>
                        ) : (
                            <div className='acc-table-responsive'>
                                <table className='acc-data-table'>
                                    <thead>
                                        <tr>
                                            <th>{localize('Time')}</th>
                                            <th>{localize('Action')}</th>
                                            <th>{localize('Contract ID')}</th>
                                            <th>{localize('Market')}</th>
                                            <th className='text-right'>{localize('Amount')}</th>
                                            <th className='text-right'>{localize('Balance After')}</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {streamEvents.map((st, idx) => {
                                            const isCredit = st.amount >= 0;
                                            const tDate = new Date(st.transaction_time * 1000).toLocaleTimeString();
                                            return (
                                                <tr key={`${st.transaction_id}-${idx}`}>
                                                    <td className='text-nowrap acc-mono text-muted'>{tDate}</td>
                                                    <td>
                                                        <span className={`acc-action-pill acc-action-pill--${st.action.toLowerCase()}`}>
                                                            {st.action.toUpperCase()}
                                                        </span>
                                                    </td>
                                                    <td className='acc-mono'>
                                                        {st.contract_id ? `#${st.contract_id}` : '—'}
                                                    </td>
                                                    <td className='font-bold'>{st.symbol || st.display_name || '—'}</td>
                                                    <td className={`text-right acc-mono font-bold ${isCredit ? 'text-win' : 'text-loss'}`}>
                                                        {formatAmount(st.amount, st.currency)}
                                                    </td>
                                                    <td className='text-right acc-mono font-bold'>
                                                        ${addComma(st.balance.toFixed(2))} {st.currency}
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </div>
                )}
            </section>

            {/* 5. SESSION SECURITY & PROTOCOL FOOTER */}
            <footer className='acc-session-footer'>
                <div className='acc-session-footer__left'>
                    <div className='acc-session-footer__status-indicator'>
                        <Shield size={16} className='text-win' />
                        <span>{localize('Session Active & Encrypted via Deriv WebSocket v3')}</span>
                    </div>
                    <span className='acc-session-footer__id'>
                        {selectedLoginId} ({isDemoAccount(selectedLoginId) ? 'Virtual Demo' : 'Real Account'})
                    </span>
                </div>

                <div className='acc-session-footer__right'>
                    <button
                        type='button'
                        className='acc-logout-btn'
                        onClick={() => {
                            if (client?.logout) client.logout();
                            else {
                                localStorage.clear();
                                sessionStorage.clear();
                                window.location.href = '/';
                            }
                        }}
                    >
                        <LogOut size={14} />
                        <span>{localize('Log Out of Deriv')}</span>
                    </button>
                </div>
            </footer>
        </div>
    );
});

export default AccountPage;
