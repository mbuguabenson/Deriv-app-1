import React, { useState } from 'react';
import {
    Smartphone,
    Monitor,
    Tablet,
    Globe,
    Layers,
    Clock,
    Compass,
    Download,
} from 'lucide-react';
import {
    AreaChart,
    Area,
    BarChart,
    Bar,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    ResponsiveContainer,
    Cell,
} from 'recharts';
import { AnalyticsStatsData } from '@/utils/admin-api';

interface AnalyticsTabProps {
    stats: AnalyticsStatsData | null;
}

export const AnalyticsTab: React.FC<AnalyticsTabProps> = ({ stats }) => {
    const [eventFilter, setEventFilter] = useState<'all' | 'page_view' | 'tool_action' | 'heartbeat'>('all');

    const totalViews = stats?.totalPageViews || 1;
    const deviceStats = stats?.deviceStats || { desktop: 0, mobile: 0, tablet: 0 };
    const totalDevices = (deviceStats.desktop + deviceStats.mobile + deviceStats.tablet) || 1;

    const desktopPct = Math.round((deviceStats.desktop / totalDevices) * 100);
    const mobilePct = Math.round((deviceStats.mobile / totalDevices) * 100);
    const tabletPct = Math.max(0, 100 - desktopPct - mobilePct);

    const toolsData = stats?.topTools && stats.topTools.length > 0
        ? stats.topTools.map(t => ({
            name: t.tool.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
            count: t.count,
        }))
        : [
            { name: 'Digit Cracker', count: 18 },
            { name: 'Bot Builder', count: 14 },
            { name: 'Auto X EO', count: 11 },
            { name: 'Signals', count: 8 },
            { name: 'Copy Trading', count: 5 },
            { name: 'DTrader', count: 4 },
        ];

    const timelineData = stats?.timeline24h && stats.timeline24h.length > 0
        ? stats.timeline24h
        : [
            { hour: '00:00', views: 5 },
            { hour: '04:00', views: 8 },
            { hour: '08:00', views: 24 },
            { hour: '12:00', views: 42 },
            { hour: '16:00', views: 58 },
            { hour: '20:00', views: 33 },
        ];

    const filteredEvents = (stats?.recentEvents || []).filter(e => {
        if (eventFilter === 'all') return true;
        return e.eventType === eventFilter;
    });

    const exportCSV = () => {
        const rows = [
            ['Timestamp', 'Event Type', 'Path', 'Device', 'IP', 'Session ID'],
            ...(stats?.recentEvents || []).map(e => [
                e.timestamp,
                e.eventType,
                e.path,
                e.device,
                e.ip,
                e.sessionId,
            ]),
        ];
        const csvContent = 'data:text/csv;charset=utf-8,' + rows.map(e => e.join(',')).join('\n');
        const encodedUri = encodeURI(csvContent);
        const link = document.createElement('a');
        link.setAttribute('href', encodedUri);
        link.setAttribute('download', `profithub_telemetry_${Date.now()}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    return (
        <div className='ph-tab-content ph-analytics-tab'>
            {/* Top Metric Strip */}
            <div className='ph-stats-strip'>
                <div className='ph-strip-card'>
                    <span className='ph-strip-label'>Total Page Visits</span>
                    <strong className='ph-strip-val'>{(stats?.totalPageViews ?? 0).toLocaleString()}</strong>
                    <span className='ph-strip-sub'>Live platform sessions</span>
                </div>
                <div className='ph-strip-card'>
                    <span className='ph-strip-label'>Active Users Now</span>
                    <strong className='ph-strip-val ph-neon-gold'>{stats?.liveActiveCount ?? 1}</strong>
                    <span className='ph-strip-sub'>Heartbeats in last 5m</span>
                </div>
                <div className='ph-strip-card'>
                    <span className='ph-strip-label'>Telemetry Events</span>
                    <strong className='ph-strip-val'>{(stats?.eventsCount ?? 0).toLocaleString()}</strong>
                    <span className='ph-strip-sub'>Actions & telemetry</span>
                </div>
                <div className='ph-strip-card'>
                    <span className='ph-strip-label'>Top Tool Adoption</span>
                    <strong className='ph-strip-val'>{stats?.topTools?.[0]?.tool?.replace(/-/g, ' ') || 'Digit Cracker'}</strong>
                    <span className='ph-strip-sub'>{stats?.topTools?.[0]?.count ?? 0} direct launches</span>
                </div>
            </div>

            {/* 24-Hour Traffic Chart */}
            <div className='ph-panel'>
                <div className='ph-panel-header'>
                    <div>
                        <h3>Platform Traffic & Activity (Past 24 Hours)</h3>
                        <p>Aggregated hourly requests across all trading bots and analysis engines</p>
                    </div>
                    <button className='ph-btn-sm ph-btn-outline' onClick={exportCSV}>
                        <Download size={14} /> Export CSV
                    </button>
                </div>

                <div className='ph-chart-container'>
                    <ResponsiveContainer width='100%' height={260}>
                        <AreaChart data={timelineData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                            <defs>
                                <linearGradient id='colorTraffic' x1='0' y1='0' x2='0' y2='1'>
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
                                fill='url(#colorTraffic)'
                            />
                        </AreaChart>
                    </ResponsiveContainer>
                </div>
            </div>

            {/* Middle Row: Tool Breakdown Bar Chart & Device Distribution */}
            <div className='ph-grid-2col'>
                {/* Tools Usage */}
                <div className='ph-panel'>
                    <div className='ph-panel-header'>
                        <div>
                            <h3>Trading Tool Executions</h3>
                            <p>Activity frequency across bots and tools</p>
                        </div>
                        <Layers size={18} className='ph-icon-dim' />
                    </div>

                    <div className='ph-chart-container'>
                        <ResponsiveContainer width='100%' height={220}>
                            <BarChart data={toolsData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                                <CartesianGrid strokeDasharray='3 3' stroke='#262b33' vertical={false} />
                                <XAxis dataKey='name' stroke='#6e7987' fontSize={10} tickLine={false} interval={0} />
                                <YAxis stroke='#6e7987' fontSize={11} tickLine={false} />
                                <Tooltip
                                    contentStyle={{
                                        backgroundColor: '#16191f',
                                        borderColor: '#2f3542',
                                        borderRadius: '8px',
                                        color: '#fff',
                                    }}
                                />
                                <Bar dataKey='count' fill='#f5c542' radius={[4, 4, 0, 0]}>
                                    {toolsData.map((_, index) => (
                                        <Cell key={`cell-${index}`} fill={index % 2 === 0 ? '#f5c542' : '#e0ab20'} />
                                    ))}
                                </Bar>
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                </div>

                {/* Device & Browser Distribution */}
                <div className='ph-panel'>
                    <div className='ph-panel-header'>
                        <div>
                            <h3>Device & Client Distribution</h3>
                            <p>Breakdown of visitor operating hardware</p>
                        </div>
                        <Globe size={18} className='ph-icon-dim' />
                    </div>

                    <div className='ph-device-breakdown'>
                        <div className='ph-device-row'>
                            <div className='ph-device-info'>
                                <Monitor size={18} className='ph-icon-neon' />
                                <span>Desktop</span>
                            </div>
                            <div className='ph-device-bar-wrap'>
                                <div className='ph-device-bar-fill' style={{ width: `${desktopPct}%` }}></div>
                            </div>
                            <span className='ph-device-pct'>{desktopPct}% ({deviceStats.desktop})</span>
                        </div>

                        <div className='ph-device-row'>
                            <div className='ph-device-info'>
                                <Smartphone size={18} className='ph-icon-neon' />
                                <span>Mobile</span>
                            </div>
                            <div className='ph-device-bar-wrap'>
                                <div className='ph-device-bar-fill' style={{ width: `${mobilePct}%` }}></div>
                            </div>
                            <span className='ph-device-pct'>{mobilePct}% ({deviceStats.mobile})</span>
                        </div>

                        <div className='ph-device-row'>
                            <div className='ph-device-info'>
                                <Tablet size={18} className='ph-icon-neon' />
                                <span>Tablet</span>
                            </div>
                            <div className='ph-device-bar-wrap'>
                                <div className='ph-device-bar-fill' style={{ width: `${tabletPct}%` }}></div>
                            </div>
                            <span className='ph-device-pct'>{tabletPct}% ({deviceStats.tablet})</span>
                        </div>
                    </div>

                    <div className='ph-browser-tags'>
                        <span className='ph-tag-title'>Browsers:</span>
                        {Object.entries(stats?.browserStats || { Chrome: 85, Safari: 10, Edge: 5 }).map(([b, count]) => (
                            <span key={b} className='ph-tag-pill'>
                                {b}: {count}
                            </span>
                        ))}
                    </div>
                </div>
            </div>

            {/* Top Visited Pages Table */}
            <div className='ph-panel'>
                <div className='ph-panel-header'>
                    <div>
                        <h3>Top Visited Platform Pages</h3>
                        <p>Most requested routes and bot workspaces</p>
                    </div>
                    <Compass size={18} className='ph-icon-dim' />
                </div>

                <div className='ph-table-wrap'>
                    <table className='ph-data-table'>
                        <thead>
                            <tr>
                                <th>#</th>
                                <th>Route Path</th>
                                <th>Views Count</th>
                                <th>Traffic Share</th>
                            </tr>
                        </thead>
                        <tbody>
                            {(stats?.topPages && stats.topPages.length > 0
                                ? stats.topPages
                                : [
                                    { path: '/', count: 32 },
                                    { path: '/digit-cracker', count: 18 },
                                    { path: '/bot-builder', count: 14 },
                                    { path: '/auto-x-eo', count: 9 },
                                    { path: '/copy-trading', count: 7 },
                                ]
                            ).map((page, idx) => {
                                const share = Math.round((page.count / totalViews) * 100);
                                return (
                                    <tr key={page.path}>
                                        <td className='ph-cell-rank'>{idx + 1}</td>
                                        <td className='ph-cell-path'>
                                            <code>{page.path}</code>
                                        </td>
                                        <td><strong>{page.count.toLocaleString()}</strong></td>
                                        <td>
                                            <div className='ph-share-pill'>
                                                <div className='ph-share-bar' style={{ width: `${Math.max(share, 5)}%` }}></div>
                                                <span>{share}%</span>
                                            </div>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Live Telemetry Events Stream */}
            <div className='ph-panel'>
                <div className='ph-panel-header'>
                    <div>
                        <h3>Live Telemetry Events Stream</h3>
                        <p>Real-time audit of user navigations, tool actions, and heartbeats</p>
                    </div>
                    <div className='ph-filter-group'>
                        {(['all', 'page_view', 'tool_action', 'heartbeat'] as const).map(f => (
                            <button
                                key={f}
                                className={`ph-filter-btn ${eventFilter === f ? 'is-active' : ''}`}
                                onClick={() => setEventFilter(f)}
                            >
                                {f.replace('_', ' ')}
                            </button>
                        ))}
                    </div>
                </div>

                <div className='ph-table-wrap'>
                    <table className='ph-data-table'>
                        <thead>
                            <tr>
                                <th>Timestamp</th>
                                <th>Event Type</th>
                                <th>Path / Target</th>
                                <th>Device</th>
                                <th>Client IP</th>
                            </tr>
                        </thead>
                        <tbody>
                            {filteredEvents.length > 0 ? (
                                filteredEvents.slice(0, 15).map(ev => (
                                    <tr key={ev.id}>
                                        <td className='ph-cell-time'>
                                            <Clock size={12} />
                                            <span>{new Date(ev.timestamp).toLocaleTimeString()}</span>
                                        </td>
                                        <td>
                                            <span className={`ph-event-badge is-${ev.eventType}`}>
                                                {ev.eventType}
                                            </span>
                                        </td>
                                        <td className='ph-cell-path'><code>{ev.path}</code></td>
                                        <td>{ev.device}</td>
                                        <td className='ph-dim-text'>{ev.ip}</td>
                                    </tr>
                                ))
                            ) : (
                                <tr>
                                    <td colSpan={5} className='ph-empty-cell'>
                                        No recent events matching filter
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
