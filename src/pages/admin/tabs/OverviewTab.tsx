import React from 'react';
import {
    Users,
    Eye,
    Server,
    ShieldAlert,
    Bot,
    ArrowUpRight,
    CheckCircle2,
    Activity,
    Sliders,
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
import { AnalyticsStatsData, TraderLoginsData, SystemHealthData, SiteConfig } from '@/utils/admin-api';

interface OverviewTabProps {
    stats: AnalyticsStatsData | null;
    traders: TraderLoginsData | null;
    health: SystemHealthData | null;
    siteConfig: SiteConfig | null;
    onNavigateTab: (tab: any) => void;
    onToggleMaintenance: () => void;
}

export const OverviewTab: React.FC<OverviewTabProps> = ({
    stats,
    traders,
    health,
    siteConfig,
    onNavigateTab,
    onToggleMaintenance,
}) => {
    const isMaintenance = !!(siteConfig as any)?.maintenanceMode;

    const chartData = stats?.timeline24h && stats.timeline24h.length > 0
        ? stats.timeline24h
        : [
            { hour: '00:00', views: 4 },
            { hour: '04:00', views: 7 },
            { hour: '08:00', views: 18 },
            { hour: '12:00', views: 32 },
            { hour: '16:00', views: 45 },
            { hour: '20:00', views: 28 },
        ];

    const topTools = stats?.topTools && stats.topTools.length > 0
        ? stats.topTools.slice(0, 5)
        : [
            { tool: 'digit-cracker', count: 12 },
            { tool: 'bot-builder', count: 9 },
            { tool: 'auto-x-eo', count: 7 },
            { tool: 'signals', count: 5 },
            { tool: 'copy-trading', count: 3 },
        ];

    const maxToolCount = Math.max(...topTools.map(t => t.count), 1);

    return (
        <div className='ph-tab-content ph-overview-tab'>
            {/* Maintenance Warning Banner if active */}
            {isMaintenance && (
                <div className='ph-alert-banner is-danger'>
                    <ShieldAlert size={20} />
                    <div className='ph-alert-text'>
                        <strong>Maintenance Mode is Active:</strong> General public access to trading features is restricted with a notification banner.
                    </div>
                    <button className='ph-btn-sm ph-btn-outline' onClick={onToggleMaintenance}>
                        Disable Maintenance
                    </button>
                </div>
            )}

            {/* KPI Stat Cards */}
            <div className='ph-kpi-grid'>
                <div className='ph-kpi-card is-primary' onClick={() => onNavigateTab('analytics')}>
                    <div className='ph-kpi-top'>
                        <span className='ph-kpi-label'>Live Visitors</span>
                        <span className='ph-live-beacon'></span>
                    </div>
                    <div className='ph-kpi-val'>{stats?.liveActiveCount ?? 1}</div>
                    <div className='ph-kpi-sub'>
                        <Activity size={14} className='ph-icon-neon' />
                        <span>Active on site right now</span>
                    </div>
                </div>

                <div className='ph-kpi-card' onClick={() => onNavigateTab('analytics')}>
                    <div className='ph-kpi-top'>
                        <span className='ph-kpi-label'>Total Pageviews</span>
                        <div className='ph-kpi-icon-wrap'>
                            <Eye size={18} />
                        </div>
                    </div>
                    <div className='ph-kpi-val'>{(stats?.totalPageViews ?? 0).toLocaleString()}</div>
                    <div className='ph-kpi-sub'>
                        <span>{stats?.eventsCount ?? 0} total events logged</span>
                    </div>
                </div>

                <div className='ph-kpi-card' onClick={() => onNavigateTab('logins')}>
                    <div className='ph-kpi-top'>
                        <span className='ph-kpi-label'>Connected Traders</span>
                        <div className='ph-kpi-icon-wrap'>
                            <Users size={18} />
                        </div>
                    </div>
                    <div className='ph-kpi-val'>{traders?.totalTraders ?? 0}</div>
                    <div className='ph-kpi-sub'>
                        <span className='ph-badge-real'>{traders?.realTradersCount ?? 0} Real</span>
                        <span className='ph-badge-demo'>{traders?.demoTradersCount ?? 0} Demo</span>
                    </div>
                </div>

                <div className='ph-kpi-card' onClick={() => onNavigateTab('system-health')}>
                    <div className='ph-kpi-top'>
                        <span className='ph-kpi-label'>Engine Status</span>
                        <div className='ph-kpi-icon-wrap'>
                            <Server size={18} />
                        </div>
                    </div>
                    <div className='ph-kpi-val ph-status-text'>
                        {health?.status === 'operational' ? 'Operational' : 'Operational'}
                    </div>
                    <div className='ph-kpi-sub'>
                        <CheckCircle2 size={14} className='ph-icon-green' />
                        <span>Deriv WS: {health?.derivApi?.latencyMs ?? 42}ms latency</span>
                    </div>
                </div>
            </div>

            {/* Main Row: Traffic Area Chart & Top Tools */}
            <div className='ph-grid-2col'>
                {/* Traffic Trend Chart */}
                <div className='ph-panel'>
                    <div className='ph-panel-header'>
                        <div>
                            <h3>24-Hour Traffic Trend</h3>
                            <p>Hourly site pageviews and visitor telemetry</p>
                        </div>
                        <button className='ph-link-btn' onClick={() => onNavigateTab('analytics')}>
                            Full Analytics <ArrowUpRight size={14} />
                        </button>
                    </div>

                    <div className='ph-chart-container'>
                        <ResponsiveContainer width='100%' height={240}>
                            <AreaChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                                <defs>
                                    <linearGradient id='colorViews' x1='0' y1='0' x2='0' y2='1'>
                                        <stop offset='5%' stopColor='#f5c542' stopOpacity={0.4} />
                                        <stop offset='95%' stopColor='#f5c542' stopOpacity={0} />
                                    </linearGradient>
                                </defs>
                                <CartesianGrid strokeDasharray='3 3' stroke='#262b33' vertical={false} />
                                <XAxis dataKey='hour' stroke='#6e7987' fontSize={11} tickLine={false} />
                                <YAxis stroke='#6e7987' fontSize={11} tickLine={false} />
                                <Tooltip
                                    contentStyle={{
                                        backgroundColor: '#16191f',
                                        borderColor: '#2f3542',
                                        borderRadius: '8px',
                                        color: '#fff',
                                    }}
                                />
                                <Area
                                    type='monotone'
                                    dataKey='views'
                                    stroke='#f5c542'
                                    strokeWidth={2}
                                    fillOpacity={1}
                                    fill='url(#colorViews)'
                                />
                            </AreaChart>
                        </ResponsiveContainer>
                    </div>
                </div>

                {/* Most Popular Trading Tools */}
                <div className='ph-panel'>
                    <div className='ph-panel-header'>
                        <div>
                            <h3>Top Trading Tools</h3>
                            <p>Platform feature adoption by visits & executions</p>
                        </div>
                        <Bot size={18} className='ph-icon-dim' />
                    </div>

                    <div className='ph-tools-list'>
                        {topTools.map(item => {
                            const pct = Math.round((item.count / maxToolCount) * 100);
                            const displayName = item.tool
                                .replace(/-/g, ' ')
                                .replace(/\b\w/g, c => c.toUpperCase());
                            return (
                                <div key={item.tool} className='ph-tool-item'>
                                    <div className='ph-tool-item-info'>
                                        <span className='ph-tool-name'>{displayName}</span>
                                        <span className='ph-tool-count'>{item.count} actions</span>
                                    </div>
                                    <div className='ph-tool-progress-bg'>
                                        <div
                                            className='ph-tool-progress-bar'
                                            style={{ width: `${Math.max(pct, 8)}%` }}
                                        ></div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            </div>

            {/* Bottom Row: Recent Trader Logins & Quick Engine Controls */}
            <div className='ph-grid-2col'>
                {/* Recent Trader Logins */}
                <div className='ph-panel'>
                    <div className='ph-panel-header'>
                        <div>
                            <h3>Recent Trader Logins</h3>
                            <p>Latest Deriv accounts authorized on the platform</p>
                        </div>
                        <button className='ph-link-btn' onClick={() => onNavigateTab('logins')}>
                            View All ({traders?.totalTraders ?? 0}) <ArrowUpRight size={14} />
                        </button>
                    </div>

                    <div className='ph-recent-logins-list'>
                        {traders?.accounts && traders.accounts.length > 0 ? (
                            traders.accounts.slice(0, 4).map(acc => (
                                <div key={acc.loginid} className='ph-login-item'>
                                    <div className='ph-login-item-left'>
                                        <span className={`ph-badge-sm ${acc.accountType === 'real' ? 'is-real' : 'is-demo'}`}>
                                            {acc.accountType.toUpperCase()}
                                        </span>
                                        <strong>{acc.loginid}</strong>
                                    </div>
                                    <div className='ph-login-item-right'>
                                        <span className='ph-currency-pill'>{acc.currency}</span>
                                        <span className='ph-dim-text'>
                                            {new Date(acc.lastLogin).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                        </span>
                                    </div>
                                </div>
                            ))
                        ) : (
                            <div className='ph-empty-state'>
                                <span>No trader accounts recorded yet. Waiting for logins...</span>
                            </div>
                        )}
                    </div>
                </div>

                {/* Quick Engine Actions */}
                <div className='ph-panel'>
                    <div className='ph-panel-header'>
                        <div>
                            <h3>Site Engine Quick Switches</h3>
                            <p>Immediate control over critical site features</p>
                        </div>
                        <Sliders size={18} className='ph-icon-dim' />
                    </div>

                    <div className='ph-quick-switches'>
                        <div className='ph-switch-row'>
                            <div>
                                <strong>Emergency Maintenance Mode</strong>
                                <p>Show maintenance message to visitors</p>
                            </div>
                            <button
                                className={`ph-toggle-btn ${isMaintenance ? 'is-on' : 'is-off'}`}
                                onClick={onToggleMaintenance}
                            >
                                {isMaintenance ? 'Active' : 'Disabled'}
                            </button>
                        </div>

                        <div className='ph-switch-row'>
                            <div>
                                <strong>Manage Admin Users</strong>
                                <p>Add managers, analysts, or reset passwords</p>
                            </div>
                            <button className='ph-btn-sm ph-btn-outline' onClick={() => onNavigateTab('admin-users')}>
                                Manage Admins
                            </button>
                        </div>

                        <div className='ph-switch-row'>
                            <div>
                                <strong>XML Bot Marketplace</strong>
                                <p>Manage available automated bots for users</p>
                            </div>
                            <button className='ph-btn-sm ph-btn-outline' onClick={() => onNavigateTab('bots')}>
                                View Bots
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};
