import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
    AnalyticsStatsData,
    TraderLoginsData,
    SystemHealthData,
    SiteConfig,
    AdminUserData,
    AdminAuditItem,
    fetchAnalyticsStatsApi,
    fetchTraderLoginsApi,
    fetchSystemHealth,
    fetchSiteConfigApi,
    saveSiteConfigApi,
    fetchAdminUsersApi,
} from '@/utils/admin-api';
import { AdminTab } from './admin-types';

import { AdminHeader } from './components/AdminHeader';
import { AdminSidebar } from './components/AdminSidebar';
import { AdminLoginModal } from './components/AdminLoginModal';
import { OverviewTab } from './tabs/OverviewTab';
import { AnalyticsTab } from './tabs/AnalyticsTab';
import { LoginsTab } from './tabs/LoginsTab';
import { AdminUsersTab } from './tabs/AdminUsersTab';
import { SiteEngineTab } from './tabs/SiteEngineTab';
import { BotsTab } from './tabs/BotsTab';
import { CommissionTrackerTab } from './tabs/CommissionTrackerTab';
import { UserTradesTab } from './tabs/UserTradesTab';
import { SystemHealthTab } from './tabs/SystemHealthTab';
import './admin-dashboard.scss';

const AdminDashboard: React.FC = () => {
    // ─── Authentication State ─────────────────────────────────────────────────
    const [authToken, setAuthToken] = useState<string | null>(() => {
        try {
            return localStorage.getItem('admin_token');
        } catch {
            return null;
        }
    });

    const [adminUser, setAdminUser] = useState<{ username: string; role: string } | null>(() => {
        try {
            const raw = localStorage.getItem('admin_user');
            return raw ? JSON.parse(raw) : null;
        } catch {
            return null;
        }
    });

    const [currentTab, setCurrentTab] = useState<AdminTab>('overview');
    const [tradesSelectedUser, setTradesSelectedUser] = useState<string>('all');
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [autoRefreshInterval, setAutoRefreshInterval] = useState<number>(15000); // 15 seconds default

    const handleViewUserTrades = (loginid: string) => {
        setTradesSelectedUser(loginid);
        setCurrentTab('user-trades');
    };

    // Data states
    const [stats, setStats] = useState<AnalyticsStatsData | null>(null);
    const [traders, setTraders] = useState<TraderLoginsData | null>(null);
    const [health, setHealth] = useState<SystemHealthData | null>(null);
    const [siteConfig, setSiteConfig] = useState<SiteConfig | null>(null);
    const [admins, setAdmins] = useState<AdminUserData[]>([]);
    const [auditLogs, setAuditLogs] = useState<AdminAuditItem[]>([]);

    const refreshTimerRef = useRef<any>(null);

    // ─── Data Fetching ────────────────────────────────────────────────────────
    const refreshAllData = useCallback(async () => {
        setIsRefreshing(true);
        try {
            const [statsRes, tradersRes, healthRes, configRes, usersRes] = await Promise.all([
                fetchAnalyticsStatsApi(),
                fetchTraderLoginsApi(),
                fetchSystemHealth(),
                fetchSiteConfigApi(),
                fetchAdminUsersApi(authToken || undefined),
            ]);

            if (statsRes) setStats(statsRes);
            if (tradersRes) setTraders(tradersRes);
            if (healthRes) setHealth(healthRes);
            if (configRes) setSiteConfig(configRes);
            if (usersRes) {
                setAdmins(usersRes.admins || []);
                setAuditLogs(usersRes.auditLogs || []);
            }
        } catch (err) {
            console.error('[Admin Console] Data fetch error:', err);
        } finally {
            setIsRefreshing(false);
        }
    }, [authToken]);

    // Initial load
    useEffect(() => {
        if (authToken) {
            refreshAllData();
        }
    }, [authToken, refreshAllData]);

    // Auto-refresh interval management
    useEffect(() => {
        if (refreshTimerRef.current) {
            clearInterval(refreshTimerRef.current);
            refreshTimerRef.current = null;
        }

        if (authToken && autoRefreshInterval > 0) {
            refreshTimerRef.current = setInterval(() => {
                refreshAllData();
            }, autoRefreshInterval);
        }

        return () => {
            if (refreshTimerRef.current) {
                clearInterval(refreshTimerRef.current);
            }
        };
    }, [authToken, autoRefreshInterval, refreshAllData]);

    // ─── Actions ──────────────────────────────────────────────────────────────
    const handleLoginSuccess = (session: { token: string; user: any }) => {
        setAuthToken(session.token);
        setAdminUser(session.user);
    };

    const handleLogout = () => {
        try {
            localStorage.removeItem('admin_token');
            localStorage.removeItem('admin_user');
        } catch {}
        setAuthToken(null);
        setAdminUser(null);
    };

    const handleToggleMaintenance = async () => {
        if (!siteConfig) return;
        const currentMode = !!(siteConfig as any).maintenanceMode;
        const nextMode = !currentMode;
        const updated = await saveSiteConfigApi({
            ...siteConfig,
            maintenanceMode: nextMode,
        } as any);

        if (updated) {
            setSiteConfig(updated);
        }
    };

    // ─── If not authenticated, render Login Modal ────────────────────────────
    if (!authToken || !adminUser) {
        return <AdminLoginModal onLoginSuccess={handleLoginSuccess} />;
    }

    return (
        <div className='ph-admin-app'>
            <AdminHeader
                user={adminUser}
                liveActiveCount={stats?.liveActiveCount ?? 1}
                isRefreshing={isRefreshing}
                autoRefreshInterval={autoRefreshInterval}
                onRefresh={refreshAllData}
                onSetAutoRefresh={setAutoRefreshInterval}
                onLogout={handleLogout}
            />

            <div className='ph-admin-body'>
                <AdminSidebar
                    currentTab={currentTab}
                    onSelectTab={setCurrentTab}
                    liveTradersCount={traders?.totalTraders ?? 0}
                    pendingAlertsCount={0}
                />

                <main className='ph-admin-main'>
                    {currentTab === 'overview' && (
                        <OverviewTab
                            stats={stats}
                            traders={traders}
                            health={health}
                            siteConfig={siteConfig}
                            onNavigateTab={setCurrentTab}
                            onToggleMaintenance={handleToggleMaintenance}
                        />
                    )}

                    {currentTab === 'analytics' && (
                        <AnalyticsTab stats={stats} />
                    )}

                    {currentTab === 'logins' && (
                        <LoginsTab
                            traders={traders}
                            onRefresh={refreshAllData}
                            onViewTrades={handleViewUserTrades}
                        />
                    )}

                    {currentTab === 'user-trades' && (
                        <UserTradesTab
                            initialClientId={tradesSelectedUser}
                            onUserBlockedChange={refreshAllData}
                        />
                    )}

                    {currentTab === 'commission-tracker' && (
                        <CommissionTrackerTab
                            onUserBlockedChange={refreshAllData}
                            onViewUserTrades={handleViewUserTrades}
                        />
                    )}

                    {currentTab === 'admin-users' && (
                        <AdminUsersTab
                            admins={admins}
                            auditLogs={auditLogs}
                            currentAdmin={adminUser}
                            onRefresh={refreshAllData}
                        />
                    )}

                    {currentTab === 'site-engine' && (
                        <SiteEngineTab
                            siteConfig={siteConfig}
                            onConfigUpdated={setSiteConfig}
                        />
                    )}

                    {currentTab === 'bots' && (
                        <BotsTab />
                    )}

                    {currentTab === 'system-health' && (
                        <SystemHealthTab
                            health={health}
                            onRefreshHealth={refreshAllData}
                        />
                    )}
                </main>
            </div>
        </div>
    );
};

export default AdminDashboard;
