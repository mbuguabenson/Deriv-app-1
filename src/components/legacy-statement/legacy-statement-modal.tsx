import { useCallback, useEffect, useMemo, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { useApiBase } from '@/hooks/useApiBase';
import { useStore } from '@/hooks/useStore';
import { addComma, getCurrencyDisplayCode, getDecimalPlaces } from '@/components/shared';
import {
    LegacyStatementService,
    LegacyStatementTransaction,
} from '@/services/legacy-statement.service';
import { getAccountsList, getActiveLoginId } from '@/utils/token-bridge';
import { api_base } from '@/external/bot-skeleton';
import { DerivWSAccountsService } from '@/services/derivws-accounts.service';
import { isDemoAccount } from '@/utils/account-helpers';
import {
    AlertCircle,
    ArrowDownRight,
    ArrowUpRight,
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
    Loader2,
    Percent,
    RefreshCw,
    Search,
    TrendingDown,
    TrendingUp,
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

    // Comprehensive discovery of ALL user accounts from all storage & store sources
    const { realAccounts, demoAccounts, allAccounts } = useMemo(() => {
        const list: Array<{ loginid: string; currency: string; is_virtual: boolean }> = [];
        const seen = new Set<string>();

        const add = (id?: string, curr?: string, virtual?: boolean) => {
            if (!id || typeof id !== 'string') return;
            const clean = id.trim().toUpperCase();
            if (!clean || clean === 'DEFAULT' || clean === 'NULL' || clean === 'UNDEFINED') return;

            // Validate account prefix
            if (!/^[A-Z]{2,4}[0-9]+$/i.test(clean) && !clean.startsWith('DOT')) {
                return;
            }

            const isVirt =
                virtual !== undefined
                    ? Boolean(virtual)
                    : clean.startsWith('VR') || clean.startsWith('VRT') || clean.startsWith('DOT') || isDemoAccount(clean);

            const existing = list.find(a => a.loginid === clean);
            if (existing) {
                if (curr && curr !== 'USD' && (!existing.currency || existing.currency === 'USD')) {
                    existing.currency = curr;
                }
                return;
            }
            seen.add(clean);
            list.push({
                loginid: clean,
                currency: curr || 'USD',
                is_virtual: isVirt,
            });
        };

        // 1. Client Store account_list
        if (client?.account_list && Array.isArray(client.account_list)) {
            client.account_list.forEach((acc: any) => add(acc.loginid, acc.currency, acc.is_virtual));
        }

        // 2. Client Store accounts object
        if (client?.accounts && typeof client.accounts === 'object') {
            Object.entries(client.accounts).forEach(([id, acc]: [string, any]) => {
                add(id, acc?.currency, acc?.is_virtual);
            });
        }

        // 3. useApiBase accountList stream
        if (accountList && Array.isArray(accountList)) {
            accountList.forEach((acc: any) => add(acc.loginid, acc.currency, acc.is_virtual));
        }

        // 4. api_base.account_info account_list
        try {
            const apiInfoList = (api_base as any)?.account_info?.account_list;
            if (Array.isArray(apiInfoList)) {
                apiInfoList.forEach((acc: any) => add(acc.loginid, acc.currency, acc.is_virtual));
            }
        } catch {}

        // 5. DerivWSAccountsService getStoredAccounts() (checks deriv_accounts in local & session)
        try {
            const derivAccounts = DerivWSAccountsService.getStoredAccounts();
            if (Array.isArray(derivAccounts)) {
                derivAccounts.forEach((acc: any) => {
                    const id = acc.account_id || acc.loginid;
                    const isVirt = acc.account_type === 'demo' || isDemoAccount(id);
                    add(id, acc.currency, isVirt);
                });
            }
        } catch {}

        // 6. token-bridge getAccountsList()
        try {
            const map = getAccountsList();
            Object.keys(map).forEach(id => add(id));
        } catch {}

        // 7. localStorage and sessionStorage 'client.accounts' and 'clientAccounts'
        if (typeof window !== 'undefined') {
            const storages = [window.localStorage, window.sessionStorage];
            storages.forEach(storage => {
                ['client.accounts', 'clientAccounts'].forEach(key => {
                    try {
                        const raw = storage.getItem(key);
                        if (raw) {
                            const parsed = JSON.parse(raw);
                            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                                Object.entries(parsed).forEach(([id, acc]: [string, any]) => {
                                    add(id, acc?.currency, acc?.is_virtual);
                                });
                            }
                        }
                    } catch {}
                });
            });

            // 8. localStorage and sessionStorage 'client_account_details'
            storages.forEach(storage => {
                try {
                    const rawDetails = storage.getItem('client_account_details');
                    if (rawDetails) {
                        const parsed = JSON.parse(rawDetails);
                        if (Array.isArray(parsed)) {
                            parsed.forEach((acc: any) => add(acc.loginid || acc.account_id, acc.currency, acc.is_virtual));
                        }
                    }
                } catch {}
            });

            // 9. localStorage and sessionStorage 'accountsList'
            storages.forEach(storage => {
                try {
                    const raw = storage.getItem('accountsList');
                    if (raw) {
                        const parsed = JSON.parse(raw);
                        if (parsed && typeof parsed === 'object') {
                            Object.keys(parsed).forEach(id => add(id));
                        }
                    }
                } catch {}
            });

            // 10. Copy Trading accounts ('deriv_copier_accounts' & 'deriv_copier_master_config')
            try {
                const rawCopier = localStorage.getItem('deriv_copier_accounts');
                if (rawCopier) {
                    const parsed = JSON.parse(rawCopier);
                    if (Array.isArray(parsed)) {
                        parsed.forEach((acc: any) => add(acc.loginid, acc.currency, acc.is_virtual));
                    }
                }
                const rawMaster = localStorage.getItem('deriv_copier_master_config');
                if (rawMaster) {
                    const parsedMaster = JSON.parse(rawMaster);
                    if (parsedMaster?.loginid) {
                        add(parsedMaster.loginid, parsedMaster.currency, parsedMaster.is_virtual);
                    }
                }
            } catch {}

            // 11. Numbered OAuth keys acct1..acct25 in localStorage & sessionStorage
            storages.forEach(storage => {
                for (let i = 1; i <= 25; i++) {
                    const acct = storage.getItem(`acct${i}`);
                    const cur = storage.getItem(`cur${i}`);
                    if (acct) add(acct, cur || 'USD');
                }
            });

            // 12. Active login IDs
            const active =
                activeLoginid ||
                client?.loginid ||
                localStorage.getItem('active_loginid') ||
                sessionStorage.getItem('active_loginid');
            if (active) add(active, client?.currency);

            // 13. Deep scan of all localStorage keys for any CR accounts
            try {
                for (let i = 0; i < localStorage.length; i++) {
                    const key = localStorage.key(i);
                    if (key && /^[A-Z]{2,4}[0-9]+$/i.test(key)) {
                        add(key);
                    }
                }
            } catch {}
        }

        // Separate real and demo accounts
        const real = list.filter(a => !a.is_virtual);
        const demo = list.filter(a => a.is_virtual);

        // Sort real accounts alphabetically / numerically
        real.sort((a, b) => a.loginid.localeCompare(b.loginid));
        demo.sort((a, b) => a.loginid.localeCompare(b.loginid));

        return {
            realAccounts: real,
            demoAccounts: demo,
            allAccounts: [...real, ...demo],
        };
    }, [client?.account_list, client?.accounts, client?.currency, accountList, activeLoginid]);

    // Target login ID (defaults to active user account, first real account, or first discovered account)
    const [loginIdInput, setLoginIdInput] = useState<string>(() => {
        return (
            initialLoginId ||
            activeLoginid ||
            localStorage.getItem('active_loginid') ||
            client?.loginid ||
            ''
        );
    });


    // Auto-select real account or active account when discovered
    useEffect(() => {
        if (!loginIdInput && allAccounts.length > 0) {
            const activeId = activeLoginid || localStorage.getItem('active_loginid') || client?.loginid;
            const match = allAccounts.find(a => a.loginid === activeId) || realAccounts[0] || allAccounts[0];
            if (match && match.loginid !== loginIdInput) {
                setLoginIdInput(match.loginid);
            }
        }
    }, [allAccounts, realAccounts, loginIdInput, activeLoginid, client?.loginid]);

    const [transactions, setTransactions] = useState<LegacyStatementTransaction[]>([]);
    const [isLoading, setIsLoading] = useState<boolean>(false);
    const [activeSource, setActiveSource] = useState<'live_rest' | 'live_websocket'>('live_websocket');
    const [preferSource, setPreferSource] = useState<'auto' | 'rest' | 'websocket'>('auto');
    const [apiError, setApiError] = useState<{ message: string; code?: string; rawStatus?: number } | null>(null);
    const [fetchLatency, setFetchLatency] = useState<number | undefined>();
    const [copiedRef, setCopiedRef] = useState<string | null>(null);

    // Filters
    const [patTokenInput, setPatTokenInput] = useState<string>(() => {
        return localStorage.getItem('deriv_legacy_api_token') || '';
    });
    const [isTokenBarOpen, setIsTokenBarOpen] = useState<boolean>(false);
    const [timeFilter, setTimeFilter] = useState<'all' | 'today' | '7d' | '30d' | 'custom'>('all');
    const [customStartDate, setCustomStartDate] = useState<string>('');
    const [customEndDate, setCustomEndDate] = useState<string>('');
    const [actionFilter, setActionFilter] = useState<string>('all');
    const [limit, setLimit] = useState<number>(0); // 0 = Unlimited (All Transactions)
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

    // Fetch Statement via Real Deriv API (Strictly Real Account Data - NO Sample Simulation)
    const loadStatementData = useCallback(
        async (
            targetIdOverride?: string,
            sourceOverride?: 'auto' | 'rest' | 'websocket',
            limitOverride?: number
        ) => {
            const effectiveId =
                targetIdOverride ||
                loginIdInput ||
                allAccounts[0]?.loginid ||
                activeLoginid ||
                getActiveLoginId() ||
                '';
            const targetId = effectiveId.trim().toUpperCase();
            if (!targetId) {
                setTransactions([]);
                setIsLoading(false);
                return;
            }

            const selectedSource = sourceOverride || preferSource;
            const queryLimit = limitOverride !== undefined ? limitOverride : limit;

            setIsLoading(true);
            setApiError(null);

            try {
                const res = await LegacyStatementService.getLegacyStatement({
                    loginid: targetId,
                    date_from: dateFrom,
                    date_to: dateTo,
                    action_type: actionFilter !== 'all' ? actionFilter : undefined,
                    limit: queryLimit,
                    preferSource: selectedSource,
                    tokenOverride: patTokenInput.trim() || undefined,
                });

                setFetchLatency(res.timing);
                setActiveSource(res.source);

                if (res.transactions && res.transactions.length > 0) {
                    setTransactions(res.transactions);
                    setApiError(null);
                } else if (res.error) {
                    setApiError({ message: res.error, code: res.errorCode, rawStatus: res.rawStatus });
                    if (res.errorCode === 'AuthRequired') {
                        setIsTokenBarOpen(true);
                    }
                    setTransactions([]);
                } else {
                    setTransactions([]);
                    setApiError(null);
                }
            } catch (err: any) {
                console.error('[LegacyStatementModal] Load error:', err);
                setApiError({ message: err?.message || 'Error communicating with Deriv API', code: 'Unknown' });
                setTransactions([]);
            } finally {
                setIsLoading(false);
            }
        },
        [loginIdInput, allAccounts, activeLoginid, dateFrom, dateTo, actionFilter, limit, preferSource, patTokenInput]
    );

    const handleSaveTokenAndConnect = (e?: React.FormEvent) => {
        e?.preventDefault();
        const clean = patTokenInput.trim();
        if (clean) {
            localStorage.setItem('deriv_legacy_api_token', clean);
        } else {
            localStorage.removeItem('deriv_legacy_api_token');
        }
        setIsTokenBarOpen(false);
        loadStatementData(undefined, 'rest');
    };

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
                                            : 'Live WebSocket Feed'}
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
                        {/* Account Selector - Discovered strictly from user's logged-in account */}
                        <div className='account-switcher-box'>
                            <span className='box-label'>Account:</span>
                            <select
                                className='box-select'
                                value={loginIdInput}
                                onChange={e => {
                                    const newAcc = e.target.value;
                                    setLoginIdInput(newAcc);
                                    loadStatementData(newAcc);
                                }}
                                title='Switch account to view statement'
                            >
                                {realAccounts.length > 0 && (
                                    <optgroup label='Real Accounts (CR)'>
                                        {realAccounts.map(acc => (
                                            <option key={acc.loginid} value={acc.loginid}>
                                                {acc.loginid} ({acc.currency || 'USD'}) — Real
                                            </option>
                                        ))}
                                    </optgroup>
                                )}
                                {demoAccounts.length > 0 && (
                                    <optgroup label='Demo Accounts'>
                                        {demoAccounts.map(acc => (
                                            <option key={acc.loginid} value={acc.loginid}>
                                                {acc.loginid} ({acc.currency || 'USD'}) — Demo
                                            </option>
                                        ))}
                                    </optgroup>
                                )}
                                {allAccounts.length === 0 && (
                                    <option value={loginIdInput || ''}>{loginIdInput || 'Active Account'}</option>
                                )}
                            </select>
                        </div>

                        {/* Mode Selector Toggle */}
                        <div className='source-mode-toggle' title='Select data gateway'>
                            <button
                                type='button'
                                className={`mode-btn ${preferSource === 'auto' ? 'active' : ''}`}
                                onClick={() => {
                                    setPreferSource('auto');
                                    loadStatementData(undefined, 'auto');
                                }}
                            >
                                <Zap size={12} /> Auto
                            </button>
                            <button
                                type='button'
                                className={`mode-btn ${preferSource === 'rest' ? 'active' : ''}`}
                                onClick={() => {
                                    setPreferSource('rest');
                                    loadStatementData(undefined, 'rest');
                                }}
                            >
                                REST API
                            </button>
                            <button
                                type='button'
                                className={`mode-btn ${preferSource === 'websocket' ? 'active' : ''}`}
                                onClick={() => {
                                    setPreferSource('websocket');
                                    loadStatementData(undefined, 'websocket');
                                }}
                            >
                                WebSocket
                            </button>
                        </div>

                        {/* API Token Key Button */}
                        <button
                            type='button'
                            className={`cockpit-token-btn ${patTokenInput ? 'has-token' : ''}`}
                            onClick={() => setIsTokenBarOpen(prev => !prev)}
                            title='Enter or update Deriv Personal Access Token / API Token'
                        >
                            <span>🔑</span>
                            <span className='token-btn-text'>
                                {patTokenInput ? 'Token Saved' : 'API Token'}
                            </span>
                        </button>

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

                {/* ── Optional Deriv API Token Bar ── */}
                {(isTokenBarOpen || apiError?.code === 'AuthRequired' || apiError?.rawStatus === 401) && (
                    <div className='token-connect-deck'>
                        <div className='token-deck-inner'>
                            <div className='token-deck-info'>
                                <span className='token-badge'>🔑 LIVE ACCESS</span>
                                <span className='token-desc'>
                                    Enter your Deriv API token (Read/Trade scope) to query real historical options statements from <code>api.derivws.com</code> for account <strong>{loginIdInput}</strong>.
                                </span>
                            </div>
                            <form className='token-form' onSubmit={handleSaveTokenAndConnect}>
                                <input
                                    type='password'
                                    className='token-secret-input'
                                    placeholder='Paste Deriv API Token / PAT here...'
                                    value={patTokenInput}
                                    onChange={e => setPatTokenInput(e.target.value)}
                                    autoFocus={apiError?.code === 'AuthRequired'}
                                />
                                <button type='submit' className='token-submit-btn' disabled={!patTokenInput.trim()}>
                                    Connect Real API
                                </button>
                                {patTokenInput && (
                                    <button
                                        type='button'
                                        className='token-remove-btn'
                                        onClick={() => {
                                            setPatTokenInput('');
                                            localStorage.removeItem('deriv_legacy_api_token');
                                            loadStatementData(undefined, 'auto');
                                        }}
                                        title='Clear Saved Token'
                                    >
                                        Remove
                                    </button>
                                )}
                            </form>
                            <a
                                href='https://app.deriv.com/account/api-token'
                                target='_blank'
                                rel='noopener noreferrer'
                                className='token-link'
                            >
                                Get Token on Deriv Settings ↗
                            </a>
                        </div>
                    </div>
                )}

                {/* ── API Diagnostic Notice ── */}
                {apiError && apiError.code !== 'AuthRequired' && apiError.rawStatus !== 401 && (
                    <div className='api-notice-banner'>
                        <div className='notice-body'>
                            <AlertCircle size={18} className='text-amber-400 shrink-0' />
                            <div className='notice-text'>
                                <strong>Deriv Gateway Diagnostic ({apiError.code || `HTTP ${apiError.rawStatus}`}):</strong>{' '}
                                <span>{apiError.message}</span>
                            </div>
                        </div>
                        <div className='notice-actions'>
                            <button
                                type='button'
                                className='notice-btn notice-btn-primary'
                                onClick={() => {
                                    setPreferSource('websocket');
                                    loadStatementData(undefined, 'websocket');
                                }}
                            >
                                Switch to WebSocket Mode
                            </button>
                            <button
                                type='button'
                                className='notice-btn notice-btn-secondary'
                                onClick={() => setIsTokenBarOpen(true)}
                            >
                                🔑 Enter API Token
                            </button>
                            <button
                                type='button'
                                className='notice-btn notice-btn-secondary'
                                onClick={() => loadStatementData(undefined, 'rest')}
                            >
                                Retry REST Endpoint
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
                                onChange={e => {
                                    const newLim = Number(e.target.value);
                                    setLimit(newLim);
                                    loadStatementData(undefined, undefined, newLim);
                                }}
                                title='Transactions count limit'
                            >
                                <option value={0}>Unlimited (All Rows)</option>
                                <option value={50}>50 rows</option>
                                <option value={100}>100 rows</option>
                                <option value={250}>250 rows</option>
                                <option value={500}>500 rows</option>
                                <option value={1000}>1,000 rows</option>
                                <option value={2500}>2,500 rows</option>
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
                                Querying real statement records for account {loginIdInput}...
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
                                onClick={() => loadStatementData()}
                            >
                                <RefreshCw size={14} /> Refresh Real Statement
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
