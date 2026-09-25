import React, { useState, useEffect, useCallback } from 'react';
import {
    History,
    Calendar,
    Users,
    TrendingUp,
    TrendingDown,
    Download,
    Plus,
    Filter,
    Clock,
    UserX,
    CheckCircle2,
    XCircle,
    Search,
    RefreshCw,
    ShieldAlert,
    X,
    FileSpreadsheet,
    Activity,
    Layers,
    DollarSign,
} from 'lucide-react';
import {
    AreaChart,
    Area,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    ResponsiveContainer,
} from 'recharts';
import {
    UserTradesAnalyticsData,
    fetchUserTradesAnalyticsApi,
    recordUserTradeApi,
    blockTraderUserApi,
    unblockTraderUserApi,
} from '@/utils/admin-api';

interface UserTradesTabProps {
    initialClientId?: string;
    onUserBlockedChange?: () => void;
}

type TimeframePreset = 'today' | 'yesterday' | '7days' | '30days' | 'month' | 'all' | 'custom';

export const UserTradesTab: React.FC<UserTradesTabProps> = ({
    initialClientId,
    onUserBlockedChange,
}) => {
    const [timeframe, setTimeframe] = useState<TimeframePreset>('30days');
    const [dateFrom, setDateFrom] = useState('');
    const [dateTo, setDateTo] = useState('');
    const [selectedUser, setSelectedUser] = useState<string>(initialClientId || 'all');
    const [selectedTool, setSelectedTool] = useState<string>('all');
    const [selectedOutcome, setSelectedOutcome] = useState<string>('all');
    const [selectedSymbol, setSelectedSymbol] = useState<string>('all');
    const [searchQuery, setSearchQuery] = useState('');

    const [data, setData] = useState<UserTradesAnalyticsData | null>(null);
    const [loading, setLoading] = useState(false);

    // Modal state for recording a manual trade
    const [showAddModal, setShowAddModal] = useState(false);
    const [newClientId, setNewClientId] = useState('');
    const [newSymbol, setNewSymbol] = useState('1HZ100V');
    const [newTool, setNewTool] = useState('bot-builder');
    const [newTradeType, setNewTradeType] = useState('DIFFERS');
    const [newStake, setNewStake] = useState('10');
    const [newPayout, setNewPayout] = useState('19.50');
    const [newStatus, setNewStatus] = useState<'WON' | 'LOST'>('WON');
    const [addLoading, setAddLoading] = useState(false);

    // Block user modal
    const [blockTargetUser, setBlockTargetUser] = useState<string | null>(null);
    const [blockReason, setBlockReason] = useState('Risk management / excessive anomalies');
    const [blockLoading, setBlockLoading] = useState(false);

    // Keep initialClientId synchronized if passed from parent
    useEffect(() => {
        if (initialClientId) {
            setSelectedUser(initialClientId);
        }
    }, [initialClientId]);

    const calculateDateRange = useCallback((preset: TimeframePreset) => {
        const now = new Date();
        const pad = (n: number) => String(n).padStart(2, '0');
        const formatDay = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

        const todayStr = formatDay(now);

        switch (preset) {
            case 'today':
                return { from: `${todayStr}T00:00:00.000Z`, to: `${todayStr}T23:59:59.999Z` };
            case 'yesterday': {
                const yest = new Date(now.getTime() - 86400000);
                const yestStr = formatDay(yest);
                return { from: `${yestStr}T00:00:00.000Z`, to: `${yestStr}T23:59:59.999Z` };
            }
            case '7days': {
                const past7 = new Date(now.getTime() - 7 * 86400000);
                return { from: past7.toISOString(), to: now.toISOString() };
            }
            case '30days': {
                const past30 = new Date(now.getTime() - 30 * 86400000);
                return { from: past30.toISOString(), to: now.toISOString() };
            }
            case 'month': {
                const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
                return { from: monthStart.toISOString(), to: now.toISOString() };
            }
            case 'all':
                return { from: '2020-01-01T00:00:00.000Z', to: now.toISOString() };
            case 'custom':
                return {
                    from: dateFrom ? `${dateFrom}T00:00:00.000Z` : '',
                    to: dateTo ? `${dateTo}T23:59:59.999Z` : '',
                };
        }
    }, [dateFrom, dateTo]);

    const loadData = useCallback(async () => {
        setLoading(true);
        const { from, to } = calculateDateRange(timeframe);
        const res = await fetchUserTradesAnalyticsApi({
            dateFrom: from,
            dateTo: to,
            clientId: selectedUser,
            tool: selectedTool,
            outcome: selectedOutcome,
            symbol: selectedSymbol,
            limit: 200,
        });
        if (res) {
            setData(res);
        }
        setLoading(false);
    }, [timeframe, calculateDateRange, selectedUser, selectedTool, selectedOutcome, selectedSymbol]);

    useEffect(() => {
        loadData();
    }, [loadData]);

    const handleApplyCustomDates = () => {
        setTimeframe('custom');
        loadData();
    };

    const handleRecordTrade = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!newClientId.trim() || !newStake) return;

        setAddLoading(true);
        const stakeNum = parseFloat(newStake) || 0;
        const payoutNum = newStatus === 'WON' ? (parseFloat(newPayout) || 0) : 0;
        const profitLoss = newStatus === 'WON' ? Math.round((payoutNum - stakeNum) * 100) / 100 : -stakeNum;

        const res = await recordUserTradeApi({
            clientId: newClientId.trim().toUpperCase(),
            symbol: newSymbol,
            tool: newTool,
            tradeType: newTradeType,
            stake: stakeNum,
            payout: payoutNum,
            profitLoss,
            status: newStatus,
            contractId: `${Date.now()}`,
            purchaseTime: new Date().toISOString(),
        });
        setAddLoading(false);

        if (res) {
            setShowAddModal(false);
            setNewClientId('');
            loadData();
        } else {
            alert('Failed to log user trade');
        }
    };

    const handleConfirmBlock = async () => {
        if (!blockTargetUser) return;
        setBlockLoading(true);
        const token = localStorage.getItem('admin_token') || '';
        const res = await blockTraderUserApi(blockTargetUser, blockReason, token);
        setBlockLoading(false);

        if (res.success) {
            setBlockTargetUser(null);
            loadData();
            if (onUserBlockedChange) onUserBlockedChange();
            alert(`User ${blockTargetUser} has been blocked from trading.`);
        } else {
            alert(res.error || 'Failed to block user');
        }
    };

    const exportCSV = () => {
        if (!data || !data.trades) return;
        const rows = [
            ['Contract ID', 'Timestamp', 'Client ID', 'Tool', 'Market', 'Type', 'Stake (USD)', 'Payout (USD)', 'Profit/Loss (USD)', 'Outcome'],
            ...data.trades.map(t => [
                t.contractId,
                t.purchaseTime,
                t.clientId,
                t.tool,
                t.symbol,
                t.tradeType,
                t.stake,
                t.payout,
                t.profitLoss,
                t.status,
            ]),
        ];
        const csvContent = 'data:text/csv;charset=utf-8,' + rows.map(e => e.join(',')).join('\n');
        const encodedUri = encodeURI(csvContent);
        const link = document.createElement('a');
        link.setAttribute('href', encodedUri);
        link.setAttribute('download', `user_trades_report_${timeframe}_${Date.now()}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    // Filter trades in memory for quick text search
    const filteredTrades = (data?.trades || []).filter(t => {
        if (!searchQuery) return true;
        const q = searchQuery.toLowerCase();
        return (
            t.clientId.toLowerCase().includes(q) ||
            t.contractId.includes(q) ||
            t.symbol.toLowerCase().includes(q) ||
            t.tradeType.toLowerCase().includes(q) ||
            t.tool.toLowerCase().includes(q)
        );
    });

    const totalTrades = data?.totalTrades ?? 0;
    const totalVol = data?.totalVolume ?? 0;
    const netPnL = data?.netProfitLoss ?? 0;
    const winRate = data?.winRate ?? 0;
    const winCount = data?.winCount ?? 0;
    const lossCount = data?.lossCount ?? 0;

    const chartData = (data?.cumulativePnL && data.cumulativePnL.length > 0)
        ? data.cumulativePnL
        : [
            { time: '00:00', profitLoss: 0, cumulative: 0 },
            { time: '04:00', profitLoss: 12, cumulative: 12 },
            { time: '08:00', profitLoss: -5, cumulative: 7 },
            { time: '12:00', profitLoss: 25, cumulative: 32 },
            { time: '16:00', profitLoss: 18, cumulative: 50 },
        ];

    return (
        <div className='ph-tab-content ph-user-trades-tab'>
            {/* Top Toolbar & Filter Presets */}
            <div className='ph-panel ph-timeframe-toolbar'>
                <div className='ph-timeframe-presets'>
                    <span className='ph-toolbar-label'>
                        <Calendar size={14} /> Time Range:
                    </span>
                    {(
                        [
                            { key: 'today', label: 'Today' },
                            { key: 'yesterday', label: 'Yesterday' },
                            { key: '7days', label: 'Last 7 Days' },
                            { key: '30days', label: 'Last 30 Days' },
                            { key: 'month', label: 'This Month' },
                            { key: 'all', label: 'All Time' },
                        ] as const
                    ).map(p => (
                        <button
                            key={p.key}
                            className={`ph-timeframe-btn ${timeframe === p.key ? 'is-active' : ''}`}
                            onClick={() => setTimeframe(p.key)}
                        >
                            {p.label}
                        </button>
                    ))}
                </div>

                {/* Custom Date Pickers */}
                <div className='ph-custom-dates-wrap'>
                    <input
                        type='date'
                        value={dateFrom}
                        onChange={e => setDateFrom(e.target.value)}
                        placeholder='From'
                        title='Start Date'
                    />
                    <span className='ph-dim-text'>to</span>
                    <input
                        type='date'
                        value={dateTo}
                        onChange={e => setDateTo(e.target.value)}
                        placeholder='To'
                        title='End Date'
                    />
                    <button
                        className='ph-btn-sm ph-btn-outline'
                        onClick={handleApplyCustomDates}
                    >
                        Apply Range
                    </button>
                </div>

                <div className='ph-toolbar-right'>
                    <button className='ph-btn-sm ph-btn-outline' onClick={exportCSV}>
                        <Download size={14} /> Export CSV
                    </button>

                    <button className='ph-btn-primary ph-btn-sm' onClick={() => setShowAddModal(true)}>
                        <Plus size={14} /> Record Trade
                    </button>

                    <button className='ph-icon-btn' onClick={loadData} title='Refresh Trade Data'>
                        <RefreshCw size={14} className={loading ? 'is-spinning' : ''} />
                    </button>
                </div>
            </div>

            {/* Filter Bar: User, Tool, Outcome, Symbol, Search */}
            <div className='ph-panel ph-filters-strip'>
                <div className='ph-filter-group-wrap'>
                    {/* Trader Selector */}
                    <div className='ph-filter-item'>
                        <label><Users size={13} /> Trader:</label>
                        <select
                            value={selectedUser}
                            onChange={e => setSelectedUser(e.target.value)}
                        >
                            <option value='all'>All Traders</option>
                            {(data?.userStats || []).map(u => (
                                <option key={u.clientId} value={u.clientId}>
                                    {u.clientId} ({u.tradesCount} trades • {u.winRate}% win)
                                </option>
                            ))}
                        </select>
                    </div>

                    {/* Tool Filter */}
                    <div className='ph-filter-item'>
                        <label><Layers size={13} /> Platform Tool:</label>
                        <select
                            value={selectedTool}
                            onChange={e => setSelectedTool(e.target.value)}
                        >
                            <option value='all'>All Tools</option>
                            <option value='bot-builder'>Bot Builder</option>
                            <option value='digit-cracker'>Digit Cracker</option>
                            <option value='auto-x-eo'>Auto-X-EO</option>
                            <option value='signals'>Signals Engine</option>
                            <option value='manual'>Manual Trading</option>
                            <option value='copy-trading'>Copy Trading</option>
                        </select>
                    </div>

                    {/* Outcome Filter */}
                    <div className='ph-filter-item'>
                        <label><Activity size={13} /> Outcome:</label>
                        <select
                            value={selectedOutcome}
                            onChange={e => setSelectedOutcome(e.target.value)}
                        >
                            <option value='all'>All Outcomes</option>
                            <option value='WON'>Won (Wins Only)</option>
                            <option value='LOST'>Lost (Losses Only)</option>
                        </select>
                    </div>

                    {/* Symbol Filter */}
                    <div className='ph-filter-item'>
                        <label>Asset / Market:</label>
                        <select
                            value={selectedSymbol}
                            onChange={e => setSelectedSymbol(e.target.value)}
                        >
                            <option value='all'>All Markets</option>
                            <option value='1HZ100V'>Volatility 100 (1s)</option>
                            <option value='R_100'>Volatility 100</option>
                            <option value='1HZ75V'>Volatility 75 (1s)</option>
                            <option value='R_75'>Volatility 75</option>
                            <option value='1HZ50V'>Volatility 50 (1s)</option>
                            <option value='R_50'>Volatility 50</option>
                            <option value='BOOM1000'>Boom 1000</option>
                            <option value='CRASH1000'>Crash 1000</option>
                        </select>
                    </div>
                </div>

                {/* Instant Search Bar */}
                <div className='ph-search-wrap'>
                    <Search size={15} className='ph-search-icon' />
                    <input
                        type='text'
                        placeholder='Search contract ID, client ID, strategy...'
                        value={searchQuery}
                        onChange={e => setSearchQuery(e.target.value)}
                    />
                    {searchQuery && (
                        <button className='ph-icon-btn-sm' onClick={() => setSearchQuery('')}>
                            <X size={13} />
                        </button>
                    )}
                </div>
            </div>

            {/* KPI Metric Strip */}
            <div className='ph-kpi-grid'>
                <div className='ph-kpi-card'>
                    <div className='ph-kpi-top'>
                        <span className='ph-kpi-label'>Total Trades</span>
                        <History size={18} />
                    </div>
                    <div className='ph-kpi-val'>{totalTrades}</div>
                    <div className='ph-kpi-sub'>
                        <span>{winCount} Wins • {lossCount} Losses</span>
                    </div>
                </div>

                <div className='ph-kpi-card'>
                    <div className='ph-kpi-top'>
                        <span className='ph-kpi-label'>Total Volume Staked</span>
                        <DollarSign size={18} />
                    </div>
                    <div className='ph-kpi-val'>
                        ${totalVol.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </div>
                    <div className='ph-kpi-sub'>
                        <span>Cumulative turnover</span>
                    </div>
                </div>

                <div className={`ph-kpi-card ${netPnL >= 0 ? 'is-success' : 'is-danger'}`}>
                    <div className='ph-kpi-top'>
                        <span className='ph-kpi-label'>Total Net Profit / Loss</span>
                        {netPnL >= 0 ? (
                            <TrendingUp size={18} className='ph-neon-green' />
                        ) : (
                            <TrendingDown size={18} className='ph-neon-red' />
                        )}
                    </div>
                    <div className={`ph-kpi-val ${netPnL >= 0 ? 'ph-neon-green' : 'ph-neon-red'}`}>
                        {netPnL >= 0 ? '+' : ''}${netPnL.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </div>
                    <div className='ph-kpi-sub'>
                        <span>Net user P/L outcome</span>
                    </div>
                </div>

                <div className='ph-kpi-card'>
                    <div className='ph-kpi-top'>
                        <span className='ph-kpi-label'>Platform Win Rate</span>
                        <Activity size={18} className='ph-neon-gold' />
                    </div>
                    <div className='ph-kpi-val ph-neon-gold'>{winRate}%</div>
                    <div className='ph-kpi-sub'>
                        <span>{data?.userStats?.length || 0} active trading accounts</span>
                    </div>
                </div>
            </div>

            {/* Cumulative Profit & Loss Curve */}
            <div className='ph-panel'>
                <div className='ph-panel-header'>
                    <div>
                        <h3>Cumulative Trader P/L Curve ({timeframe.toUpperCase()})</h3>
                        <p>Real-time running profit and loss trajectory across executed contracts</p>
                    </div>
                    <div className='ph-badge-sm is-real'>
                        <CheckCircle2 size={12} /> {selectedUser === 'all' ? 'All Platform Users' : `Trader: ${selectedUser}`}
                    </div>
                </div>

                <div className='ph-chart-container'>
                    <ResponsiveContainer width='100%' height={260}>
                        <AreaChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                            <defs>
                                <linearGradient id='colorPnL' x1='0' y1='0' x2='0' y2='1'>
                                    <stop offset='5%' stopColor={netPnL >= 0 ? '#10b981' : '#ef4444'} stopOpacity={0.4} />
                                    <stop offset='95%' stopColor={netPnL >= 0 ? '#10b981' : '#ef4444'} stopOpacity={0} />
                                </linearGradient>
                            </defs>
                            <CartesianGrid strokeDasharray='3 3' stroke='#262b33' vertical={false} />
                            <XAxis dataKey='time' stroke='#6e7987' fontSize={11} tickLine={false} />
                            <YAxis stroke='#6e7987' fontSize={11} tickLine={false} tickFormatter={v => `$${v}`} />
                            <Tooltip
                                formatter={(val: any) => [`$${Number(val).toFixed(2)}`, 'Cumulative P/L']}
                                contentStyle={{
                                    backgroundColor: '#16191f',
                                    borderColor: '#2f3542',
                                    borderRadius: '8px',
                                    color: '#fff',
                                }}
                            />
                            <Area
                                type='monotone'
                                dataKey='cumulative'
                                stroke={netPnL >= 0 ? '#10b981' : '#ef4444'}
                                strokeWidth={2}
                                fillOpacity={1}
                                fill='url(#colorPnL)'
                            />
                        </AreaChart>
                    </ResponsiveContainer>
                </div>
            </div>

            {/* Traders Performance Summary Breakdown */}
            <div className='ph-panel'>
                <div className='ph-panel-header'>
                    <div>
                        <h3>Trader Performance Directory</h3>
                        <p>Aggregated win rates, volume, and net P/L per user</p>
                    </div>
                    {selectedUser !== 'all' && (
                        <button
                            className='ph-btn-sm ph-btn-outline'
                            onClick={() => setSelectedUser('all')}
                        >
                            Show All Traders
                        </button>
                    )}
                </div>

                <div className='ph-table-wrap'>
                    <table className='ph-data-table'>
                        <thead>
                            <tr>
                                <th>#</th>
                                <th>Trader Login ID</th>
                                <th>Total Trades</th>
                                <th>Volume (USD)</th>
                                <th>Wins / Losses</th>
                                <th>Win Rate</th>
                                <th>Net P/L</th>
                                <th>Last Trade</th>
                                <th>Action</th>
                            </tr>
                        </thead>
                        <tbody>
                            {data?.userStats && data.userStats.length > 0 ? (
                                data.userStats.map((u, idx) => {
                                    const isPos = u.profitLoss >= 0;
                                    return (
                                        <tr key={u.clientId}>
                                            <td className='ph-cell-rank'>{idx + 1}</td>
                                            <td className='ph-cell-loginid'>
                                                <div className='ph-trader-id-pill'>
                                                    <strong>{u.clientId}</strong>
                                                </div>
                                            </td>
                                            <td><strong>{u.tradesCount}</strong> trades</td>
                                            <td>${u.volume.toFixed(2)}</td>
                                            <td>
                                                <span className='ph-dim-text'>
                                                    {u.winCount}W / {u.lossCount}L
                                                </span>
                                            </td>
                                            <td>
                                                <div className='ph-share-pill'>
                                                    <div
                                                        className='ph-share-bar'
                                                        style={{
                                                            width: `${u.winRate}%`,
                                                            backgroundColor: u.winRate >= 50 ? '#10b981' : '#ef4444',
                                                        }}
                                                    ></div>
                                                    <span>{u.winRate}%</span>
                                                </div>
                                            </td>
                                            <td>
                                                <strong className={isPos ? 'ph-neon-green' : 'ph-neon-red'}>
                                                    {isPos ? '+' : ''}${u.profitLoss.toFixed(2)}
                                                </strong>
                                            </td>
                                            <td className='ph-cell-time'>
                                                <Clock size={12} />
                                                <span>{new Date(u.lastTrade).toLocaleString()}</span>
                                            </td>
                                            <td>
                                                <div className='ph-actions-row'>
                                                    <button
                                                        className='ph-btn-sm ph-btn-outline'
                                                        title='Filter trades to this user'
                                                        onClick={() => setSelectedUser(u.clientId)}
                                                    >
                                                        Filter Trades
                                                    </button>
                                                    <button
                                                        className='ph-btn-sm ph-btn-danger-outline'
                                                        title='Block user from placing trades'
                                                        onClick={() => setBlockTargetUser(u.clientId)}
                                                    >
                                                        <UserX size={12} /> Block
                                                    </button>
                                                </div>
                                            </td>
                                        </tr>
                                    );
                                })
                            ) : (
                                <tr>
                                    <td colSpan={9} className='ph-empty-cell'>
                                        {loading ? 'Fetching trader statistics...' : 'No trader data found.'}
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Detailed User Trades Ledger */}
            <div className='ph-panel'>
                <div className='ph-panel-header'>
                    <div>
                        <h3>Detailed Trades Ledger ({filteredTrades.length} contracts)</h3>
                        <p>Complete execution history across platform bots, tools, and markets</p>
                    </div>
                    <div className='ph-dim-text'>
                        Live order executions
                    </div>
                </div>

                <div className='ph-table-wrap'>
                    <table className='ph-data-table'>
                        <thead>
                            <tr>
                                <th>Timestamp</th>
                                <th>Trader ID</th>
                                <th>Tool / Bot</th>
                                <th>Market / Asset</th>
                                <th>Trade Type</th>
                                <th>Stake</th>
                                <th>Payout</th>
                                <th>Profit / Loss</th>
                                <th>Outcome</th>
                                <th>Contract ID</th>
                            </tr>
                        </thead>
                        <tbody>
                            {filteredTrades.length > 0 ? (
                                filteredTrades.map(trade => {
                                    const isWin = trade.status === 'WON';
                                    const isPos = trade.profitLoss > 0;
                                    return (
                                        <tr key={trade.id}>
                                            <td className='ph-cell-time'>
                                                <Clock size={12} />
                                                <span>{new Date(trade.purchaseTime).toLocaleString()}</span>
                                            </td>
                                            <td className='ph-cell-loginid'>
                                                <div className='ph-trader-id-pill'>
                                                    <strong>{trade.clientId}</strong>
                                                </div>
                                            </td>
                                            <td>
                                                <span className='ph-source-pill'>
                                                    {trade.tool}
                                                </span>
                                            </td>
                                            <td><strong>{trade.symbol}</strong></td>
                                            <td><span className='ph-currency-pill'>{trade.tradeType}</span></td>
                                            <td>${Number(trade.stake).toFixed(2)}</td>
                                            <td>${Number(trade.payout).toFixed(2)}</td>
                                            <td>
                                                <strong className={isPos ? 'ph-neon-green' : 'ph-neon-red'}>
                                                    {isPos ? '+' : ''}${Number(trade.profitLoss).toFixed(2)}
                                                </strong>
                                            </td>
                                            <td>
                                                <span className={`ph-status-pill ${isWin ? 'is-active' : 'is-suspended'}`}>
                                                    {isWin ? (
                                                        <><CheckCircle2 size={12} /> WON</>
                                                    ) : (
                                                        <><XCircle size={12} /> LOST</>
                                                    )}
                                                </span>
                                            </td>
                                            <td>
                                                <code>{trade.contractId}</code>
                                            </td>
                                        </tr>
                                    );
                                })
                            ) : (
                                <tr>
                                    <td colSpan={10} className='ph-empty-cell'>
                                        {loading ? 'Loading trade history...' : 'No trades found matching current criteria.'}
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Block User Modal */}
            {blockTargetUser && (
                <div className='ph-modal-backdrop'>
                    <div className='ph-modal-card'>
                        <div className='ph-modal-header'>
                            <div className='ph-modal-title'>
                                <ShieldAlert size={20} className='ph-icon-red' />
                                <h3>Block Trader Account</h3>
                            </div>
                            <button className='ph-close-btn' onClick={() => setBlockTargetUser(null)}>
                                <X size={18} />
                            </button>
                        </div>

                        <div className='ph-modal-form'>
                            <p className='ph-dim-text'>
                                Are you sure you want to block <strong>{blockTargetUser}</strong>? This user will be immediately blocked from launching bots, placing trades, or executing strategies on the platform.
                            </p>

                            <div className='ph-form-group'>
                                <label>Reason for Block</label>
                                <input
                                    type='text'
                                    value={blockReason}
                                    onChange={e => setBlockReason(e.target.value)}
                                    placeholder='Specify risk, anomaly, or compliance reason'
                                    required
                                />
                            </div>

                            <div className='ph-modal-actions'>
                                <button
                                    type='button'
                                    className='ph-btn-outline'
                                    onClick={() => setBlockTargetUser(null)}
                                >
                                    Cancel
                                </button>
                                <button
                                    type='button'
                                    className='ph-btn-primary is-danger'
                                    onClick={handleConfirmBlock}
                                    disabled={blockLoading}
                                >
                                    {blockLoading ? 'Blocking...' : `Block ${blockTargetUser}`}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Record / Log Trade Modal */}
            {showAddModal && (
                <div className='ph-modal-backdrop'>
                    <div className='ph-modal-card'>
                        <div className='ph-modal-header'>
                            <div className='ph-modal-title'>
                                <Plus size={20} />
                                <h3>Record User Trade Contract</h3>
                            </div>
                            <button className='ph-close-btn' onClick={() => setShowAddModal(false)}>
                                <X size={18} />
                            </button>
                        </div>

                        <form onSubmit={handleRecordTrade} className='ph-modal-form'>
                            <div className='ph-form-group'>
                                <label>Trader Login ID</label>
                                <input
                                    type='text'
                                    placeholder='e.g. CR3918204'
                                    value={newClientId}
                                    onChange={e => setNewClientId(e.target.value)}
                                    required
                                />
                            </div>

                            <div className='ph-form-group'>
                                <label>Platform Tool / Bot</label>
                                <select
                                    value={newTool}
                                    onChange={e => setNewTool(e.target.value)}
                                >
                                    <option value='bot-builder'>Bot Builder (XML)</option>
                                    <option value='digit-cracker'>Digit Cracker</option>
                                    <option value='auto-x-eo'>Auto-X-EO</option>
                                    <option value='signals'>Signals Engine</option>
                                    <option value='manual'>Manual DTrader</option>
                                    <option value='copy-trading'>Copy Trading</option>
                                </select>
                            </div>

                            <div className='ph-form-group'>
                                <label>Market / Index</label>
                                <select
                                    value={newSymbol}
                                    onChange={e => setNewSymbol(e.target.value)}
                                >
                                    <option value='1HZ100V'>Volatility 100 (1s) Index</option>
                                    <option value='R_100'>Volatility 100 Index</option>
                                    <option value='1HZ75V'>Volatility 75 (1s) Index</option>
                                    <option value='R_75'>Volatility 75 Index</option>
                                    <option value='BOOM1000'>Boom 1000 Index</option>
                                    <option value='CRASH1000'>Crash 1000 Index</option>
                                </select>
                            </div>

                            <div className='ph-form-group'>
                                <label>Trade Type</label>
                                <select
                                    value={newTradeType}
                                    onChange={e => setNewTradeType(e.target.value)}
                                >
                                    <option value='DIFFERS'>DIFFERS</option>
                                    <option value='MATCHES'>MATCHES</option>
                                    <option value='CALL'>CALL (Higher/Rise)</option>
                                    <option value='PUT'>PUT (Lower/Fall)</option>
                                    <option value='OVER'>OVER</option>
                                    <option value='UNDER'>UNDER</option>
                                    <option value='ACCU'>ACCUMULATOR</option>
                                </select>
                            </div>

                            <div className='ph-form-group'>
                                <label>Outcome Status</label>
                                <select
                                    value={newStatus}
                                    onChange={e => {
                                        const st = e.target.value as 'WON' | 'LOST';
                                        setNewStatus(st);
                                        if (st === 'LOST') {
                                            setNewPayout('0');
                                        } else {
                                            const s = parseFloat(newStake) || 10;
                                            setNewPayout((s * 1.95).toFixed(2));
                                        }
                                    }}
                                >
                                    <option value='WON'>WON</option>
                                    <option value='LOST'>LOST</option>
                                </select>
                            </div>

                            <div className='ph-form-group'>
                                <label>Stake (USD)</label>
                                <input
                                    type='number'
                                    step='0.1'
                                    value={newStake}
                                    onChange={e => {
                                        setNewStake(e.target.value);
                                        const s = parseFloat(e.target.value) || 0;
                                        if (newStatus === 'WON') {
                                            setNewPayout((s * 1.95).toFixed(2));
                                        }
                                    }}
                                    required
                                />
                            </div>

                            <div className='ph-form-group'>
                                <label>Payout (USD)</label>
                                <input
                                    type='number'
                                    step='0.01'
                                    value={newPayout}
                                    onChange={e => setNewPayout(e.target.value)}
                                    required
                                />
                            </div>

                            <div className='ph-modal-actions'>
                                <button
                                    type='button'
                                    className='ph-btn-outline'
                                    onClick={() => setShowAddModal(false)}
                                >
                                    Cancel
                                </button>
                                <button
                                    type='submit'
                                    className='ph-btn-primary'
                                    disabled={addLoading}
                                >
                                    {addLoading ? 'Saving...' : 'Record Contract'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
};
