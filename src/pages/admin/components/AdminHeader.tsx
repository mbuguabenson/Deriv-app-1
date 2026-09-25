import React from 'react';
import {
    Activity,
    LogOut,
    RefreshCw,
    Shield,
    Users,
    Clock,
    CheckCircle,
} from 'lucide-react';

interface AdminHeaderProps {
    user: { username: string; role: string };
    liveActiveCount: number;
    isRefreshing: boolean;
    autoRefreshInterval: number; // 0 for off, else ms
    onRefresh: () => void;
    onSetAutoRefresh: (val: number) => void;
    onLogout: () => void;
}

export const AdminHeader: React.FC<AdminHeaderProps> = ({
    user,
    liveActiveCount,
    isRefreshing,
    autoRefreshInterval,
    onRefresh,
    onSetAutoRefresh,
    onLogout,
}) => {
    return (
        <header className='ph-admin-header'>
            <div className='ph-header-left'>
                <div className='ph-brand-badge'>
                    <div className='ph-brand-icon'>
                        <Shield size={20} />
                    </div>
                    <div className='ph-brand-titles'>
                        <span className='ph-brand-name'>ProfitHub Console</span>
                        <span className='ph-brand-sub'>Site Engine & Telemetry</span>
                    </div>
                </div>

                <div className='ph-live-pill' title='Users active on the platform in the last 5 minutes'>
                    <span className='ph-pulse-beacon'></span>
                    <Users size={14} />
                    <strong>{liveActiveCount}</strong>
                    <span>Live Now</span>
                </div>
            </div>

            <div className='ph-header-right'>
                {/* Auto-refresh interval dropdown */}
                <div className='ph-interval-selector'>
                    <Clock size={14} className='ph-interval-icon' />
                    <select
                        value={autoRefreshInterval}
                        onChange={e => onSetAutoRefresh(Number(e.target.value))}
                        title='Auto-refresh frequency'
                    >
                        <option value={0}>Auto: Off</option>
                        <option value={5000}>Auto: 5s</option>
                        <option value={15000}>Auto: 15s</option>
                        <option value={30000}>Auto: 30s</option>
                        <option value={60000}>Auto: 1m</option>
                    </select>
                </div>

                {/* Manual refresh button */}
                <button
                    className={`ph-icon-btn ${isRefreshing ? 'is-spinning' : ''}`}
                    onClick={onRefresh}
                    title='Refresh Data Now'
                    disabled={isRefreshing}
                >
                    <RefreshCw size={16} />
                </button>

                {/* User Info & Role Badge */}
                <div className='ph-user-profile'>
                    <div className='ph-user-avatar'>
                        {user.username.charAt(0).toUpperCase()}
                    </div>
                    <div className='ph-user-details'>
                        <span className='ph-username'>{user.username}</span>
                        <span className='ph-user-role'>{user.role.replace('_', ' ')}</span>
                    </div>
                </div>

                {/* Logout button */}
                <button className='ph-logout-btn' onClick={onLogout} title='Sign out of Admin Console'>
                    <LogOut size={16} />
                    <span>Exit</span>
                </button>
            </div>
        </header>
    );
};
