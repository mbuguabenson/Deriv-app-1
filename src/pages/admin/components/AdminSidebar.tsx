import React from 'react';
import {
    LayoutDashboard,
    BarChart3,
    Users2,
    ShieldCheck,
    Sliders,
    Bot,
    DollarSign,
    Server,
    ExternalLink,
    History,
} from 'lucide-react';
import { AdminTab } from '../admin-types';

interface AdminSidebarProps {
    currentTab: AdminTab;
    onSelectTab: (tab: AdminTab) => void;
    liveTradersCount: number;
    pendingAlertsCount: number;
}

export const AdminSidebar: React.FC<AdminSidebarProps> = ({
    currentTab,
    onSelectTab,
    liveTradersCount,
    pendingAlertsCount,
}) => {
    const navItems = [
        {
            key: 'overview' as AdminTab,
            label: 'Overview',
            icon: LayoutDashboard,
            badge: null,
        },
        {
            key: 'analytics' as AdminTab,
            label: 'Site Analytics',
            icon: BarChart3,
            badge: 'Live',
        },
        {
            key: 'logins' as AdminTab,
            label: 'Trader Logins',
            icon: Users2,
            badge: liveTradersCount > 0 ? String(liveTradersCount) : null,
        },
        {
            key: 'user-trades' as AdminTab,
            label: 'User Trade History',
            icon: History,
            badge: 'Live',
        },
        {
            key: 'commission-tracker' as AdminTab,
            label: 'Commission Tracker',
            icon: DollarSign,
            badge: '$ Markup',
        },
        {
            key: 'admin-users' as AdminTab,
            label: 'Admin Management',
            icon: ShieldCheck,
            badge: null,
        },
        {
            key: 'site-engine' as AdminTab,
            label: 'Site Engine & Flags',
            icon: Sliders,
            badge: null,
        },
        {
            key: 'bots' as AdminTab,
            label: 'Bot Marketplace',
            icon: Bot,
            badge: null,
        },
        {
            key: 'system-health' as AdminTab,
            label: 'System Health & Logs',
            icon: Server,
            badge: pendingAlertsCount > 0 ? `${pendingAlertsCount}` : null,
        },
    ];

    return (
        <aside className='ph-admin-sidebar'>
            <div className='ph-sidebar-section'>
                <span className='ph-sidebar-heading'>NAVIGATION</span>
                <nav className='ph-sidebar-nav'>
                    {navItems.map(item => {
                        const Icon = item.icon;
                        const isActive = currentTab === item.key;
                        return (
                            <button
                                key={item.key}
                                className={`ph-nav-item ${isActive ? 'is-active' : ''}`}
                                onClick={() => onSelectTab(item.key)}
                            >
                                <div className='ph-nav-item-left'>
                                    <Icon size={18} className='ph-nav-icon' />
                                    <span>{item.label}</span>
                                </div>
                                {item.badge && (
                                    <span className={`ph-nav-badge ${item.badge === 'Live' ? 'is-live' : ''}`}>
                                        {item.badge}
                                    </span>
                                )}
                            </button>
                        );
                    })}
                </nav>
            </div>

            <div className='ph-sidebar-footer'>
                <a
                    href='/'
                    target='_blank'
                    rel='noopener noreferrer'
                    className='ph-site-link'
                    title='Open ProfitHub Expert Trader in new tab'
                >
                    <span>View Public Site</span>
                    <ExternalLink size={14} />
                </a>
                <div className='ph-version-tag'>v2.4.0 Engine • Ready</div>
            </div>
        </aside>
    );
};
