import React, { useState, useEffect, useCallback } from 'react';
import {
    DollarSign,
    Calendar,
    Users,
    TrendingUp,
    Download,
    Plus,
    Filter,
    Clock,
    UserX,
    UserCheck,
    CheckCircle,
    AlertCircle,
    ArrowUpRight,
    RefreshCw,
    ShieldAlert,
    X,
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
    CommissionAnalyticsData,
    fetchCommissionAnalyticsApi,
    recordCommissionTransactionApi,
    blockTraderUserApi,
    unblockTraderUserApi,
} from '@/utils/admin-api';

interface CommissionTrackerTabProps {
    onUserBlockedChange?: () => void;
    onViewUserTrades?: (clientId: string) => void;
}

type TimeframePreset = 'today' | 'yesterday' | '7days' | '30days' | 'month' | 'all' | 'custom';

export const CommissionTrackerTab: React.FC<CommissionTrackerTabProps> = ({
    onUserBlockedChange,
    onViewUserTrades,
}) => {
    const [timeframe, setTimeframe] = useState<TimeframePreset>('30days');
    const [dateFrom, setDateFrom] = useState('');
    const [dateTo, setDateTo] = useState('');
    const [selectedUser, setSelectedUser] = useState('all');

    const [data, setData] = useState<CommissionAnalyticsData | null>(null);
    const [loading, setLoading] = useState(false);

    // Modal states
    const [showAddModal, setShowAddModal] = useState(false);
    const [newClientId, setNewClientId] = useState('');
    const [newSymbol, setNewSymbol] = useState('R_100');
    const [newVolume, setNewVolume] = useState('50');
    const [newAmount, setNewAmount] = useState('1.00');
    const [addLoading, setAddLoading] = useState(false);

    // Block modal state
    const [blockTargetUser, setBlockTargetUser] = useState<string | null>(null);
    const [blockReason, setBlockReason] = useState('Suspicious volume or compliance review');
    const [blockLoading, setBlockLoading] = useState(false);

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
        const res = await fetchCommissionAnalyticsApi({
            dateFrom: from,
            dateTo: to,
            clientId: selectedUser,
        });
        if (res) {
            setData(res);
        }
        setLoading(false);
    }, [timeframe, calculateDateRange, selectedUser]);

    useEffect(() => {
        loadData();
    }, [loadData]);

    const handleApplyCustomDates = () => {
        setTimeframe('custom');
        loadData();
    };

    const handleAddCommission = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!newClientId.trim() || !newVolume || !newAmount) return;

        setAddLoading(true);
        const res = await recordCommissionTransactionApi({
            clientId: newClientId.trim().toUpperCase(),
            symbol: newSymbol,
            volume: Number(newVolume),
            amount: Number(newAmount),
            markupRate: '2.0%',
        });
        setAddLoading(false);

        if (res) {
            setShowAddModal(false);
            setNewClientId('');
            loadData();
        } else {
            alert('Failed to log commission transaction');
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

    const handleUnblock = async (clientId: string) => {
        if (!window.confirm(`Unblock user ${clientId}?`)) return;
        const token = localStorage.getItem('admin_token') || '';
        const res = await unblockTraderUserApi(clientId, token);
        if (res.success) {
            loadData();
            if (onUserBlockedChange) onUserBlockedChange();
            alert(`User ${clientId} has been unblocked.`);
        } else {
            alert(res.error || 'Failed to unblock user');
        }
    };

    const exportCSV = () => {
        if (!data) return;
        const rows = [
            ['Timestamp', 'Client ID', 'Symbol', 'Volume (USD)', 'Markup Commission (USD)', 'Status'],
            ...data.transactions.map(t => [
                t.date,
                t.clientId,
                t.symbol,
                t.volume,
                t.amount,
                t.status,
            ]),
        ];
        const csvContent = 'data:text/csv;charset=utf-8,' + rows.map(e => e.join(',')).join('\n');
        const encodedUri = encodeURI(csvContent);
        const link = document.createElement('a');
        link.setAttribute('href', encodedUri);
        link.setAttribute('download', `commission_markup_report_${timeframe}_${Date.now()}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    const chartData = data?.timeline && data.timeline.length > 0
        ? data.timeline
        : [
            { label: 'Day 1', commission: 2.4 },
            { label: 'Day 2', commission: 5.8 },
            { label: 'Day 3', commission: 4.2 },
            { label: 'Day 4', commission: 9.1 },
            { label: 'Day 5', commission: 14.5 },
        ];

    const totalComm = data?.totalCommissionUsd ?? 0;
    const totalVol = data?.totalVolumeUsd ?? 0;
    const totalTrades = data?.totalTrades ?? 0;
    const activeUsers = data?.activeUsersCount ?? 0;
    const avgPerTrade = totalTrades > 0 ? (totalComm / totalTrades).toFixed(2) : '0.00';

    return (
        <div className='ph-tab-content ph-commission-tab'>
            {/* Timeframe Selector & Action Bar */}
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
                    {/* User Filter Dropdown */}
                    <div className='ph-filter-select-wrap'>
                        <Filter size={14} className='ph-dim-text' />
                        <select
                            value={selectedUser}
                            onChange={e => setSelectedUser(e.target.value)}
                        >
                            <option value='all'>All Traders</option>
                            {(data?.userBreakdown || []).map(u => (
                                <option key={u.clientId} value={u.clientId}>
                                    {u.clientId} (${u.commissionUsd})
                                </option>
                            ))}
                        </select>
                    </div>

                    <button className='ph-btn-sm ph-btn-outline' onClick={exportCSV}>
                        <Download size={14} /> Export CSV
                    </button>

                    <button className='ph-btn-primary ph-btn-sm' onClick={() => setShowAddModal(true)}>
                        <Plus size={14} /> Log Commission
                    </button>

                    <button className='ph-icon-btn' onClick={loadData} title='Refresh Data'>
                        <RefreshCw size={14} className={loading ? 'is-spinning' : ''} />
                    </button>
                </div>
            </div>

            {/* KPI Metric Cards */}
            <div className='ph-kpi-grid'>
                <div className='ph-kpi-card is-primary'>
                    <div className='ph-kpi-top'>
                        <span className='ph-kpi-label'>Total Commission</span>
                        <DollarSign size={18} className='ph-icon-gold' />
                    </div>
                    <div className='ph-kpi-val ph-neon-gold'>${totalComm.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                    <div className='ph-kpi-sub'>
                        <span>Earned in selected timeframe</span>
                    </div>
                </div>

                <div className='ph-kpi-card'>
                    <div className='ph-kpi-top'>
                        <span className='ph-kpi-label'>Active Traders</span>
                        <Users size={18} />
                    </div>
                    <div className='ph-kpi-val'>{activeUsers}</div>
                    <div className='ph-kpi-sub'>
                        <span>Generating markup volume</span>
                    </div>
                </div>

                <div className='ph-kpi-card'>
                    <div className='ph-kpi-top'>
                        <span className='ph-kpi-label'>Traded Volume</span>
                        <TrendingUp size={18} />
                    </div>
                    <div className='ph-kpi-val'>${totalVol.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                    <div className='ph-kpi-sub'>
                        <span>{totalTrades} markup trades total</span>
                    </div>
                </div>

                <div className='ph-kpi-card'>
                    <div className='ph-kpi-top'>
                        <span className='ph-kpi-label'>Avg Per Trade</span>
                        <DollarSign size={18} />
                    </div>
                    <div className='ph-kpi-val'>${avgPerTrade}</div>
                    <div className='ph-kpi-sub'>
                        <span>Average app markup yield</span>
                    </div>
                </div>
            </div>

            {/* Commission Earnings Timeline Chart */}
            <div className='ph-panel'>
                <div className='ph-panel-header'>
                    <div>
                        <h3>Commission Markup Earnings Trend ({timeframe.toUpperCase()})</h3>
                        <p>Aggregated markup revenue across specified time window</p>
                    </div>
                    <span className='ph-badge-sm is-real'>
                        <CheckCircle size={12} /> 2.0% App Markup Rate
                    </span>
                </div>

                <div className='ph-chart-container'>
                    <ResponsiveContainer width='100%' height={260}>
                        <AreaChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                            <defs>
                                <linearGradient id='colorComm' x1='0' y1='0' x2='0' y2='1'>
                                    <stop offset='5%' stopColor='#10b981' stopOpacity={0.4} />
                                    <stop offset='95%' stopColor='#10b981' stopOpacity={0} />
                                </linearGradient>
                            </defs>
                            <CartesianGrid strokeDasharray='3 3' stroke='#262b33' vertical={false} />
                            <XAxis dataKey='label' stroke='#6e7987' fontSize={11} tickLine={false} />
                            <YAxis stroke='#6e7987' fontSize={11} tickLine={false} tickFormatter={v => `$${v}`} />
                            <Tooltip
                                formatter={(val: any) => [`$${Number(val).toFixed(2)}`, 'Commission']}
                                contentStyle={{
                                    backgroundColor: '#16191f',
                                    borderColor: '#2f3542',
                                    borderRadius: '8px',
                                    color: '#fff',
                                }}
                            />
                            <Area
                                type='monotone'
                                dataKey='commission'
                                stroke='#10b981'
                                strokeWidth={2}
                                fillOpacity={1}
                                fill='url(#colorComm)'
                            />
                        </AreaChart>
                    </ResponsiveContainer>
                </div>
            </div>

            {/* Users Breakdown Table */}
            <div className='ph-panel'>
                <div className='ph-panel-header'>
                    <div>
                        <h3>Users Commission Breakdown ({timeframe.toUpperCase()})</h3>
                        <p>Total commission and volume generated by each trader in the specified time</p>
                    </div>
                    <span className='ph-dim-text'>
                        Sorted by highest commission
                    </span>
                </div>

                <div className='ph-table-wrap'>
                    <table className='ph-data-table'>
                        <thead>
                            <tr>
                                <th>#</th>
                                <th>Trader Login ID</th>
                                <th>Commission Earned</th>
                                <th>Volume Traded</th>
                                <th>Total Trades</th>
                                <th>Share %</th>
                                <th>Last Trade</th>
                                <th>Action / Security</th>
                            </tr>
                        </thead>
                        <tbody>
                            {data?.userBreakdown && data.userBreakdown.length > 0 ? (
                                data.userBreakdown.map((user, idx) => {
                                    const share = totalComm > 0 ? Math.round((user.commissionUsd / totalComm) * 100) : 0;
                                    return (
                                        <tr key={user.clientId}>
                                            <td className='ph-cell-rank'>{idx + 1}</td>
                                            <td className='ph-cell-loginid'>
                                                <div className='ph-trader-id-pill'>
                                                    <strong>{user.clientId}</strong>
                                                </div>
                                            </td>
                                            <td>
                                                <strong className='ph-neon-gold'>${user.commissionUsd.toFixed(2)}</strong>
                                            </td>
                                            <td>${user.volumeUsd.toFixed(2)}</td>
                                            <td><strong>{user.tradesCount}</strong> trades</td>
                                            <td>
                                                <div className='ph-share-pill'>
                                                    <div className='ph-share-bar' style={{ width: `${Math.max(share, 5)}%` }}></div>
                                                    <span>{share}%</span>
                                                </div>
                                            </td>
                                            <td className='ph-cell-time'>
                                                <Clock size={12} />
                                                <span>{new Date(user.lastTradeDate).toLocaleString()}</span>
                                            </td>
                                            <td>
                                                <div className='ph-actions-row'>
                                                    {onViewUserTrades && (
                                                        <button
                                                            className='ph-btn-sm ph-btn-outline'
                                                            title='View trade history for this user'
                                                            onClick={() => onViewUserTrades(user.clientId)}
                                                        >
                                                            Trades
                                                        </button>
                                                    )}
                                                    <button
                                                        className='ph-btn-sm ph-btn-outline'
                                                        title='Filter transactions for this user'
                                                        onClick={() => setSelectedUser(user.clientId)}
                                                    >
                                                        Filter
                                                    </button>
                                                    <button
                                                        className='ph-btn-sm ph-btn-danger-outline'
                                                        title='Block this user from trading'
                                                        onClick={() => setBlockTargetUser(user.clientId)}
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
                                    <td colSpan={8} className='ph-empty-cell'>
                                        {loading ? 'Calculating commission analytics...' : 'No commissions recorded in this timeframe.'}
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Detailed Transactions Ledger */}
            <div className='ph-panel'>
                <div className='ph-panel-header'>
                    <div>
                        <h3>Detailed Markup Transactions Ledger</h3>
                        <p>Audit trail of all individual commission transactions in this period</p>
                    </div>
                    {selectedUser !== 'all' && (
                        <button
                            className='ph-btn-sm ph-btn-outline'
                            onClick={() => setSelectedUser('all')}
                        >
                            Clear Filter ({selectedUser})
                        </button>
                    )}
                </div>

                <div className='ph-table-wrap'>
                    <table className='ph-data-table'>
                        <thead>
                            <tr>
                                <th>Transaction ID</th>
                                <th>Date & Time</th>
                                <th>Trader ID</th>
                                <th>Market / Symbol</th>
                                <th>Trade Stake</th>
                                <th>Markup Yield</th>
                                <th>Rate</th>
                                <th>Status</th>
                            </tr>
                        </thead>
                        <tbody>
                            {data?.transactions && data.transactions.length > 0 ? (
                                data.transactions.map(t => (
                                    <tr key={t.id}>
                                        <td><code>{t.id}</code></td>
                                        <td className='ph-cell-time'>
                                            <Clock size={12} />
                                            <span>{new Date(t.date).toLocaleString()}</span>
                                        </td>
                                        <td><strong>{t.clientId}</strong></td>
                                        <td><span className='ph-source-pill'>{t.symbol}</span></td>
                                        <td>${Number(t.volume).toFixed(2)}</td>
                                        <td><strong className='ph-neon-green'>+${Number(t.amount).toFixed(2)}</strong></td>
                                        <td><span className='ph-currency-pill'>{t.markupRate || '2.0%'}</span></td>
                                        <td>
                                            <span className='ph-badge-sm is-real'>
                                                {t.status.toUpperCase()}
                                            </span>
                                        </td>
                                    </tr>
                                ))
                            ) : (
                                <tr>
                                    <td colSpan={8} className='ph-empty-cell'>
                                        No transactions found for the selected time range.
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Block User Confirmation Modal */}
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
                                    placeholder='Specify violation, risk, or compliance notice'
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

            {/* Log Commission Modal */}
            {showAddModal && (
                <div className='ph-modal-backdrop'>
                    <div className='ph-modal-card'>
                        <div className='ph-modal-header'>
                            <div className='ph-modal-title'>
                                <DollarSign size={20} />
                                <h3>Log Commission Transaction</h3>
                            </div>
                            <button className='ph-close-btn' onClick={() => setShowAddModal(false)}>
                                <X size={18} />
                            </button>
                        </div>

                        <form onSubmit={handleAddCommission} className='ph-modal-form'>
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
                                <label>Market / Index</label>
                                <select
                                    value={newSymbol}
                                    onChange={e => setNewSymbol(e.target.value)}
                                >
                                    <option value='R_100'>Volatility 100 Index</option>
                                    <option value='1HZ100V'>Volatility 100 (1s) Index</option>
                                    <option value='R_75'>Volatility 75 Index</option>
                                    <option value='R_50'>Volatility 50 Index</option>
                                    <option value='BOOM1000'>Boom 1000 Index</option>
                                    <option value='CRASH1000'>Crash 1000 Index</option>
                                </select>
                            </div>

                            <div className='ph-form-group'>
                                <label>Trade Stake Volume (USD)</label>
                                <input
                                    type='number'
                                    step='0.1'
                                    value={newVolume}
                                    onChange={e => {
                                        setNewVolume(e.target.value);
                                        const v = parseFloat(e.target.value) || 0;
                                        setNewAmount((v * 0.02).toFixed(2));
                                    }}
                                    required
                                />
                            </div>

                            <div className='ph-form-group'>
                                <label>Markup Commission (2.0% USD)</label>
                                <input
                                    type='number'
                                    step='0.01'
                                    value={newAmount}
                                    onChange={e => setNewAmount(e.target.value)}
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
                                    {addLoading ? 'Saving...' : 'Record Transaction'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
};
