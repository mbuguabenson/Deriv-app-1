import {
    SiteConfig,
    MpesaTransaction,
    MarkupCommission,
    SystemLogItem,
    UploadedBot,
    PlatformNotification,
    CopyRequest,
} from './supabase-copy';

export type {
    SiteConfig,
    MpesaTransaction,
    MarkupCommission,
    SystemLogItem,
    UploadedBot,
    PlatformNotification,
    CopyRequest,
};

const API_BASE = '/api/admin';

async function safeApiCall<T>(url: string, options?: RequestInit): Promise<T | null> {
    try {
        const res = await fetch(url, {
            headers: {
                'Content-Type': 'application/json',
                ...options?.headers,
            },
            ...options,
        });
        if (!res.ok) return null;
        return await res.json();
    } catch (e) {
        return null;
    }
}

// Like safeApiCall but returns the parsed body even on non-2xx responses
// so auth error messages ("Invalid credentials") can be surfaced to the UI
async function safeApiCallWithError<T>(url: string, options?: RequestInit): Promise<T | null> {
    try {
        const res = await fetch(url, {
            headers: {
                'Content-Type': 'application/json',
                ...options?.headers,
            },
            ...options,
        });
        try {
            return await res.json();
        } catch {
            return null;
        }
    } catch {
        return null;
    }
}

// ─── System Health & Deriv Health ─────────────────────────────────────────────
export interface SystemHealthData {
    timestamp: string;
    serverTime: number;
    status: 'operational' | 'degraded';
    derivApi: {
        status: 'healthy' | 'degraded' | 'unreachable';
        latencyMs: number;
        endpoint: string;
        rawHealth: any;
    };
    services: Array<{ name: string; status: string; pingMs: number }>;
    metrics: {
        uptimeSeconds: number;
        nodeVersion: string;
        memory: { heapUsedMB: number; heapTotalMB: number; rssMB: number };
    };
}

export const fetchSystemHealth = async (): Promise<SystemHealthData | null> => {
    return await safeApiCall<SystemHealthData>(`${API_BASE}/system-health`);
};

// ─── Admin Authentication ─────────────────────────────────────────────────────
export const loginAdminApi = async (
    username: string,
    password: string
): Promise<{ success: boolean; token?: string; error?: string }> => {
    const res = await safeApiCallWithError<{ success: boolean; token?: string; error?: string }>(`${API_BASE}/auth`, {
        method: 'POST',
        body: JSON.stringify({ action: 'login', username, password }),
    });

    // Got a real response (even 401 "Invalid credentials") — return it directly
    if (res !== null) return res;

    // True network/server failure — couldn't reach the endpoint at all
    return { success: false, error: 'Admin service unreachable. Ensure the backend server is running.' };
};

export const changeAdminPasswordApi = async (newPassword: string): Promise<boolean> => {
    const res = await safeApiCall<{ success: boolean }>(`${API_BASE}/auth`, {
        method: 'POST',
        body: JSON.stringify({ action: 'change_password', newPassword }),
    });
    return !!res?.success;
};

// ─── Site Configuration API ───────────────────────────────────────────────────
export const fetchSiteConfigApi = async (): Promise<SiteConfig | null> => {
    return await safeApiCall<SiteConfig>(`${API_BASE}/site-config`);
};

export const saveSiteConfigApi = async (config: Partial<SiteConfig>): Promise<SiteConfig | null> => {
    const res = await safeApiCall<{ success: boolean; config: SiteConfig }>(`${API_BASE}/site-config`, {
        method: 'POST',
        body: JSON.stringify(config),
    });
    return res?.config || null;
};

// ─── Copy Requests API ────────────────────────────────────────────────────────
export const fetchCopyRequestsApi = async (providerLoginid?: string): Promise<CopyRequest[]> => {
    const url = providerLoginid
        ? `${API_BASE}/copy-requests?provider_loginid=${providerLoginid}`
        : `${API_BASE}/copy-requests`;
    const res = await safeApiCall<CopyRequest[]>(url);
    return res || [];
};

export const updateCopyRequestStatusApi = async (
    id: string,
    status: 'accepted' | 'rejected' | 'stopped'
): Promise<boolean> => {
    const res = await safeApiCall<{ success: boolean }>(`${API_BASE}/copy-requests?id=${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ id, status }),
    });
    return !!res?.success;
};

// ─── System Logs API ──────────────────────────────────────────────────────────
export const fetchSystemLogsApi = async (): Promise<SystemLogItem[]> => {
    const res = await safeApiCall<SystemLogItem[]>(`${API_BASE}/logs`);
    return res || [];
};

export const pushSystemLogApi = async (
    level: 'info' | 'warn' | 'error',
    message: string,
    component: string
): Promise<boolean> => {
    const res = await safeApiCall<{ success: boolean }>(`${API_BASE}/logs`, {
        method: 'POST',
        body: JSON.stringify({ level, message, component }),
    });
    return !!res?.success;
};

// ─── Transactions & Commissions API ──────────────────────────────────────────
export const fetchTransactionsApi = async (): Promise<MpesaTransaction[]> => {
    const res = await safeApiCall<MpesaTransaction[]>(`${API_BASE}/transactions?type=transactions`);
    return res || [];
};

export const pushTransactionApi = async (txn: MpesaTransaction): Promise<boolean> => {
    const res = await safeApiCall<{ success: boolean }>(`${API_BASE}/transactions?type=transactions`, {
        method: 'POST',
        body: JSON.stringify(txn),
    });
    return !!res?.success;
};

export const fetchCommissionsApi = async (): Promise<MarkupCommission[]> => {
    const res = await safeApiCall<MarkupCommission[]>(`${API_BASE}/transactions?type=commissions`);
    return res || [];
};

// ─── Notifications API ────────────────────────────────────────────────────────
export const fetchNotificationsApi = async (): Promise<PlatformNotification[]> => {
    const res = await safeApiCall<PlatformNotification[]>(`${API_BASE}/notifications`);
    return res || [];
};

export const pushNotificationApi = async (title: string, message: string): Promise<boolean> => {
    const res = await safeApiCall<{ success: boolean }>(`${API_BASE}/notifications`, {
        method: 'POST',
        body: JSON.stringify({ title, message }),
    });
    return !!res?.success;
};

// ─── Uploaded Bots API ────────────────────────────────────────────────────────
export const fetchUploadedBotsApi = async (): Promise<UploadedBot[]> => {
    const res = await safeApiCall<UploadedBot[]>(`${API_BASE}/bots`);
    return res || [];
};

export const pushUploadedBotApi = async (bot: { name: string; description: string; xml: string }): Promise<boolean> => {
    const res = await safeApiCall<{ success: boolean }>(`${API_BASE}/bots`, {
        method: 'POST',
        body: JSON.stringify(bot),
    });
    return !!res?.success;
};

export const deleteUploadedBotApi = async (id: string): Promise<boolean> => {
    const res = await safeApiCall<{ success: boolean }>(`${API_BASE}/bots?id=${id}`, {
        method: 'DELETE',
    });
    return !!res?.success;
};

// ─── Analytics & Telemetry API ───────────────────────────────────────────────
export interface AnalyticsStatsData {
    totalPageViews: number;
    eventsCount: number;
    liveActiveCount: number;
    liveActiveUsers: Array<{
        sessionId: string;
        path: string;
        loginid?: string | null;
        device: string;
        ip: string;
        timestamp: number;
    }>;
    deviceStats: { desktop: number; mobile: number; tablet: number };
    browserStats: Record<string, number>;
    timeline24h: Array<{ hour: string; views: number }>;
    topPages: Array<{ path: string; count: number }>;
    topTools: Array<{ tool: string; count: number }>;
    recentEvents: Array<{
        id: string;
        eventType: string;
        path: string;
        sessionId: string;
        loginid?: string | null;
        device: string;
        ip: string;
        timestamp: string;
        metadata?: any;
    }>;
    lastUpdated: string;
}

export const fetchAnalyticsStatsApi = async (): Promise<AnalyticsStatsData | null> => {
    const res = await safeApiCall<{ success: boolean; data: AnalyticsStatsData }>('/api/analytics/stats');
    return res?.data || null;
};

// ─── Connected Traders & Logins API ──────────────────────────────────────────
export interface TraderAccountRecord {
    loginid: string;
    accountType: 'real' | 'demo';
    currency: string;
    balance: number;
    email: string;
    ip: string;
    userAgent: string;
    source: string;
    firstSeen: string;
    lastLogin: string;
    loginCount: number;
    status?: 'active' | 'blocked';
    blockReason?: string;
}

export interface TraderLoginsData {
    totalTraders: number;
    realTradersCount: number;
    demoTradersCount: number;
    accounts: TraderAccountRecord[];
    recentHistory: Array<{
        id: string;
        loginid: string;
        accountType: 'real' | 'demo';
        currency: string;
        balance: number;
        ip: string;
        timestamp: string;
        source: string;
    }>;
}

export const fetchTraderLoginsApi = async (): Promise<TraderLoginsData | null> => {
    const res = await safeApiCall<{ success: boolean; data: TraderLoginsData }>('/api/analytics/logins');
    return res?.data || null;
};

// ─── Admin Users Management API ──────────────────────────────────────────────
export interface AdminUserData {
    id: string;
    username: string;
    role: 'super_admin' | 'administrator' | 'manager' | 'analyst' | 'support';
    permissions: string[];
    created_at: string;
    last_login: string | null;
    status: 'active' | 'suspended';
}

export interface AdminAuditItem {
    id: string;
    action: string;
    details: any;
    actor: string;
    timestamp: string;
}

export const fetchAdminUsersApi = async (token?: string): Promise<{ admins: AdminUserData[]; auditLogs: AdminAuditItem[] } | null> => {
    const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
    const res = await safeApiCall<{ success: boolean; admins: AdminUserData[]; auditLogs: AdminAuditItem[] }>(
        `${API_BASE}/users`,
        { headers }
    );
    if (res?.success) return { admins: res.admins || [], auditLogs: res.auditLogs || [] };
    return null;
};

export const createAdminUserApi = async (
    data: { username: string; password: string; role: string; permissions: string[] },
    token?: string
): Promise<{ success: boolean; admin?: AdminUserData; error?: string }> => {
    const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
    const res = await safeApiCall<{ success: boolean; admin?: AdminUserData; error?: string }>(`${API_BASE}/users`, {
        method: 'POST',
        headers,
        body: JSON.stringify(data),
    });
    return res || { success: false, error: 'Network or server error creating admin' };
};

export const updateAdminUserApi = async (
    id: string,
    updates: Partial<{ role: string; permissions: string[]; password?: string; status: 'active' | 'suspended' }>,
    token?: string
): Promise<{ success: boolean; error?: string }> => {
    const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
    const res = await safeApiCall<{ success: boolean; error?: string }>(`${API_BASE}/users`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ id, updates }),
    });
    return res || { success: false, error: 'Network error updating admin' };
};

export const deleteAdminUserApi = async (
    id: string,
    token?: string
): Promise<{ success: boolean; error?: string }> => {
    const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
    const res = await safeApiCall<{ success: boolean; error?: string }>(`${API_BASE}/users?id=${id}`, {
        method: 'DELETE',
        headers,
    });
    return res || { success: false, error: 'Network error deleting admin' };
};

export const fetchAdminAuditLogsApi = async (limit = 50): Promise<AdminAuditItem[]> => {
    const res = await safeApiCall<{ success: boolean; logs: AdminAuditItem[] }>(`${API_BASE}/audit?limit=${limit}`);
    return res?.logs || [];
};

// ─── Commission Markup Tracker API ───────────────────────────────────────────
export interface CommissionUserRecord {
    clientId: string;
    commissionUsd: number;
    volumeUsd: number;
    tradesCount: number;
    lastTradeDate: string;
}

export interface CommissionTimelinePoint {
    label: string;
    commission: number;
    volume: number;
    trades: number;
}

export interface CommissionTransactionItem {
    id: string;
    date: string;
    clientId: string;
    symbol: string;
    volume: number;
    amount: number;
    markupRate: string;
    status: string;
}

export interface CommissionAnalyticsData {
    totalCommissionUsd: number;
    totalVolumeUsd: number;
    totalTrades: number;
    activeUsersCount: number;
    userBreakdown: CommissionUserRecord[];
    timeline: CommissionTimelinePoint[];
    transactions: CommissionTransactionItem[];
}

export const fetchCommissionAnalyticsApi = async (options: {
    dateFrom?: string;
    dateTo?: string;
    clientId?: string;
} = {}): Promise<CommissionAnalyticsData | null> => {
    const query = new URLSearchParams();
    if (options.dateFrom) query.set('date_from', options.dateFrom);
    if (options.dateTo) query.set('date_to', options.dateTo);
    if (options.clientId && options.clientId !== 'all') query.set('client_id', options.clientId);

    const res = await safeApiCall<{ success: boolean; data: CommissionAnalyticsData }>(
        `${API_BASE}/commission-tracker?${query.toString()}`
    );
    return res?.data || null;
};

export const recordCommissionTransactionApi = async (comm: {
    clientId: string;
    symbol: string;
    volume: number;
    amount: number;
    markupRate?: string;
    status?: string;
}): Promise<boolean> => {
    const res = await safeApiCall<{ success: boolean }>(`${API_BASE}/commission-tracker`, {
        method: 'POST',
        body: JSON.stringify(comm),
    });
    return !!res?.success;
};

// ─── User Blocking / Blacklist API ───────────────────────────────────────────
export const blockTraderUserApi = async (
    loginid: string,
    reason?: string,
    token?: string
): Promise<{ success: boolean; error?: string }> => {
    const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
    const res = await safeApiCall<{ success: boolean; error?: string }>(`${API_BASE}/traders`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ action: 'block', loginid, reason }),
    });
    return res || { success: false, error: 'Network error blocking user' };
};

export const unblockTraderUserApi = async (
    loginid: string,
    token?: string
): Promise<{ success: boolean; error?: string }> => {
    const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
    const res = await safeApiCall<{ success: boolean; error?: string }>(`${API_BASE}/traders`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ action: 'unblock', loginid }),
    });
    return res || { success: false, error: 'Network error unblocking user' };
};

// ─── User Trade History API ──────────────────────────────────────────────────
export interface UserTradeItem {
    id: string;
    contractId: string;
    clientId: string;
    symbol: string;
    tradeType: string;
    tool: string;
    stake: number;
    payout: number;
    profitLoss: number;
    status: 'WON' | 'LOST';
    purchaseTime: string;
    sellTime: string;
    barrier?: string | null;
}

export interface UserTradeUserStat {
    clientId: string;
    tradesCount: number;
    volume: number;
    profitLoss: number;
    winCount: number;
    lossCount: number;
    winRate: number;
    lastTrade: string;
}

export interface UserTradeCumulativePoint {
    time: string;
    profitLoss: number;
    cumulative: number;
}

export interface UserTradesAnalyticsData {
    totalTrades: number;
    totalVolume: number;
    netProfitLoss: number;
    winCount: number;
    lossCount: number;
    winRate: number;
    userStats: UserTradeUserStat[];
    symbolStats: Record<string, number>;
    toolStats: Record<string, number>;
    cumulativePnL: UserTradeCumulativePoint[];
    trades: UserTradeItem[];
}

export const fetchUserTradesAnalyticsApi = async (options: {
    clientId?: string;
    tool?: string;
    outcome?: string;
    symbol?: string;
    dateFrom?: string;
    dateTo?: string;
    limit?: number;
    offset?: number;
} = {}): Promise<UserTradesAnalyticsData | null> => {
    const query = new URLSearchParams();
    if (options.clientId && options.clientId !== 'all') query.set('client_id', options.clientId);
    if (options.tool && options.tool !== 'all') query.set('tool', options.tool);
    if (options.outcome && options.outcome !== 'all') query.set('outcome', options.outcome);
    if (options.symbol && options.symbol !== 'all') query.set('symbol', options.symbol);
    if (options.dateFrom) query.set('date_from', options.dateFrom);
    if (options.dateTo) query.set('date_to', options.dateTo);
    if (options.limit) query.set('limit', String(options.limit));
    if (options.offset) query.set('offset', String(options.offset));

    const res = await safeApiCall<{ success: boolean; data: UserTradesAnalyticsData }>(
        `${API_BASE}/trades?${query.toString()}`
    );
    return res?.data || null;
};

export const recordUserTradeApi = async (trade: Partial<UserTradeItem>): Promise<boolean> => {
    const res = await safeApiCall<{ success: boolean }>(`${API_BASE}/trades`, {
        method: 'POST',
        body: JSON.stringify(trade),
    });
    return !!res?.success;
};


