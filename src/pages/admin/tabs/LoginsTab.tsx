import React, { useState } from 'react';
import {
    Search,
    Download,
    Clock,
    CheckCircle,
    UserCheck,
    RefreshCw,
} from 'lucide-react';
import {
    TraderLoginsData,
    blockTraderUserApi,
    unblockTraderUserApi,
} from '@/utils/admin-api';

interface LoginsTabProps {
    traders: TraderLoginsData | null;
    onRefresh: () => void;
    onViewTrades?: (loginid: string) => void;
}

export const LoginsTab: React.FC<LoginsTabProps> = ({ traders, onRefresh, onViewTrades }) => {
    const [searchQuery, setSearchQuery] = useState('');
    const [typeFilter, setTypeFilter] = useState<'all' | 'real' | 'demo'>('all');

    const accounts = traders?.accounts || [];
    const totalTraders = traders?.totalTraders || 0;
    const realCount = traders?.realTradersCount || 0;
    const demoCount = traders?.demoTradersCount || 0;

    const filteredAccounts = accounts.filter(acc => {
        const matchesType = typeFilter === 'all' || acc.accountType === typeFilter;
        const matchesQuery =
            acc.loginid.toLowerCase().includes(searchQuery.toLowerCase()) ||
            acc.currency.toLowerCase().includes(searchQuery.toLowerCase()) ||
            acc.ip.includes(searchQuery);
        return matchesType && matchesQuery;
    });

    const exportCSV = () => {
        const rows = [
            ['Login ID', 'Account Type', 'Currency', 'Balance', 'First Seen', 'Last Login', 'IP', 'Login Count'],
            ...accounts.map(a => [
                a.loginid,
                a.accountType,
                a.currency,
                a.balance,
                a.firstSeen,
                a.lastLogin,
                a.ip,
                a.loginCount,
            ]),
        ];
        const csvContent = 'data:text/csv;charset=utf-8,' + rows.map(e => e.join(',')).join('\n');
        const encodedUri = encodeURI(csvContent);
        const link = document.createElement('a');
        link.setAttribute('href', encodedUri);
        link.setAttribute('download', `profithub_trader_logins_${Date.now()}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    return (
        <div className='ph-tab-content ph-logins-tab'>
            {/* KPI Metric Strip */}
            <div className='ph-stats-strip'>
                <div className='ph-strip-card'>
                    <span className='ph-strip-label'>Total Registered Traders</span>
                    <strong className='ph-strip-val'>{totalTraders}</strong>
                    <span className='ph-strip-sub'>Authorized via Deriv OAuth</span>
                </div>
                <div className='ph-strip-card'>
                    <span className='ph-strip-label'>Real Money Accounts</span>
                    <strong className='ph-strip-val ph-neon-green'>{realCount}</strong>
                    <span className='ph-strip-sub'>CR accounts active</span>
                </div>
                <div className='ph-strip-card'>
                    <span className='ph-strip-label'>Virtual / Demo Accounts</span>
                    <strong className='ph-strip-val'>{demoCount}</strong>
                    <span className='ph-strip-sub'>VR demo practice accounts</span>
                </div>
                <div className='ph-strip-card'>
                    <span className='ph-strip-label'>Real Trader Share</span>
                    <strong className='ph-strip-val'>
                        {totalTraders > 0 ? `${Math.round((realCount / totalTraders) * 100)}%` : '0%'}
                    </strong>
                    <span className='ph-strip-sub'>Conversion to live funded</span>
                </div>
            </div>

            {/* Main Accounts Table Panel */}
            <div className='ph-panel'>
                <div className='ph-panel-header'>
                    <div>
                        <h3>Connected Deriv Accounts Directory</h3>
                        <p>Real-time registry of traders logged in across the platform</p>
                    </div>

                    <div className='ph-header-actions'>
                        {/* Search Bar */}
                        <div className='ph-search-wrap'>
                            <Search size={16} className='ph-search-icon' />
                            <input
                                type='text'
                                placeholder='Search Login ID, currency, IP...'
                                value={searchQuery}
                                onChange={e => setSearchQuery(e.target.value)}
                            />
                        </div>

                        {/* Account Type Filter */}
                        <div className='ph-filter-group'>
                            {(['all', 'real', 'demo'] as const).map(t => (
                                <button
                                    key={t}
                                    className={`ph-filter-btn ${typeFilter === t ? 'is-active' : ''}`}
                                    onClick={() => setTypeFilter(t)}
                                >
                                    {t.toUpperCase()}
                                </button>
                            ))}
                        </div>

                        <button className='ph-btn-sm ph-btn-outline' onClick={exportCSV}>
                            <Download size={14} /> Export CSV
                        </button>
                    </div>
                </div>

                <div className='ph-table-wrap'>
                    <table className='ph-data-table'>
                        <thead>
                            <tr>
                                <th>Login ID</th>
                                <th>Type</th>
                                <th>Currency</th>
                                <th>Total Logins</th>
                                <th>Last Active</th>
                                <th>Client IP</th>
                                <th>Status</th>
                                <th>Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {filteredAccounts.length > 0 ? (
                                filteredAccounts.map(acc => {
                                    const isBlocked = acc.status === 'blocked';
                                    return (
                                        <tr key={acc.loginid}>
                                            <td className='ph-cell-loginid'>
                                                <div className='ph-trader-id-pill'>
                                                    <UserCheck size={14} className={isBlocked ? 'ph-icon-red' : ''} />
                                                    <strong>{acc.loginid}</strong>
                                                </div>
                                            </td>
                                            <td>
                                                <span className={`ph-badge-sm ${acc.accountType === 'real' ? 'is-real' : 'is-demo'}`}>
                                                    {acc.accountType.toUpperCase()}
                                                </span>
                                            </td>
                                            <td>
                                                <span className='ph-currency-pill'>{acc.currency}</span>
                                            </td>
                                            <td>
                                                <strong>{acc.loginCount}</strong> times
                                            </td>
                                            <td className='ph-cell-time'>
                                                <Clock size={12} />
                                                <span>{new Date(acc.lastLogin).toLocaleString()}</span>
                                            </td>
                                            <td className='ph-dim-text'>{acc.ip}</td>
                                            <td>
                                                <span className={`ph-status-pill ${isBlocked ? 'is-suspended' : 'is-active'}`}>
                                                    {isBlocked ? 'BLOCKED' : 'ACTIVE'}
                                                </span>
                                            </td>
                                            <td>
                                                <div className='ph-actions-row'>
                                                    {onViewTrades && (
                                                        <button
                                                            className='ph-btn-sm ph-btn-outline'
                                                            title='View trade contracts for this user'
                                                            onClick={() => onViewTrades(acc.loginid)}
                                                        >
                                                            View Trades
                                                        </button>
                                                    )}
                                                    {isBlocked ? (
                                                        <button
                                                            className='ph-btn-sm ph-btn-outline'
                                                            onClick={async () => {
                                                                const token = localStorage.getItem('admin_token') || '';
                                                                await unblockTraderUserApi(acc.loginid, token);
                                                                onRefresh();
                                                            }}
                                                        >
                                                            Unblock
                                                        </button>
                                                    ) : (
                                                        <button
                                                            className='ph-btn-sm ph-btn-danger-outline'
                                                            onClick={async () => {
                                                                const reason = window.prompt(`Reason for blocking trader ${acc.loginid}:`, 'Risk/compliance review');
                                                                if (reason !== null) {
                                                                    const token = localStorage.getItem('admin_token') || '';
                                                                    await blockTraderUserApi(acc.loginid, reason || 'Administrative block', token);
                                                                    onRefresh();
                                                                }
                                                            }}
                                                        >
                                                            Block User
                                                        </button>
                                                    )}
                                                </div>
                                            </td>
                                        </tr>
                                    );
                                })
                            ) : (
                                <tr>
                                    <td colSpan={8} className='ph-empty-cell'>
                                        {accounts.length === 0
                                            ? 'No trader accounts tracked yet. As users log into Deriv, their credentials and telemetry will appear here.'
                                            : 'No accounts match the current filter or search criteria.'}
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Recent Login History Stream */}
            <div className='ph-panel'>
                <div className='ph-panel-header'>
                    <div>
                        <h3>Recent Authentication & Token Exchange History</h3>
                        <p>Audit trail of every Deriv token authorization recorded</p>
                    </div>
                    <button className='ph-link-btn' onClick={onRefresh}>
                        <RefreshCw size={14} /> Refresh Stream
                    </button>
                </div>

                <div className='ph-table-wrap'>
                    <table className='ph-data-table'>
                        <thead>
                            <tr>
                                <th>Timestamp</th>
                                <th>Login ID</th>
                                <th>Type</th>
                                <th>Currency</th>
                                <th>IP Address</th>
                                <th>Status</th>
                            </tr>
                        </thead>
                        <tbody>
                            {traders?.recentHistory && traders.recentHistory.length > 0 ? (
                                traders.recentHistory.slice(0, 15).map(h => (
                                    <tr key={h.id}>
                                        <td className='ph-cell-time'>
                                            <Clock size={12} />
                                            <span>{new Date(h.timestamp).toLocaleString()}</span>
                                        </td>
                                        <td><strong>{h.loginid}</strong></td>
                                        <td>
                                            <span className={`ph-badge-sm ${h.accountType === 'real' ? 'is-real' : 'is-demo'}`}>
                                                {h.accountType.toUpperCase()}
                                            </span>
                                        </td>
                                        <td><span className='ph-currency-pill'>{h.currency}</span></td>
                                        <td className='ph-dim-text'>{h.ip}</td>
                                        <td>
                                            <span className='ph-status-badge is-success'>
                                                <CheckCircle size={12} /> Authorized
                                            </span>
                                        </td>
                                    </tr>
                                ))
                            ) : (
                                <tr>
                                    <td colSpan={6} className='ph-empty-cell'>
                                        No recent login records yet.
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
};
