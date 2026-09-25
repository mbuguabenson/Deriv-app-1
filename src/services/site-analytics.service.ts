/**
 * ProfitHub Expert - Site Telemetry & Live Analytics Service
 * Automatically records pageviews, tool runs, active heartbeats, and trader logins.
 */

const getSessionId = (): string => {
    try {
        let sid = sessionStorage.getItem('ph_session_id');
        if (!sid) {
            sid = `sess_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            sessionStorage.setItem('ph_session_id', sid);
        }
        return sid;
    } catch {
        return `sess_temp_${Date.now()}`;
    }
};

const getDeviceType = (): 'desktop' | 'mobile' | 'tablet' => {
    if (typeof window === 'undefined') return 'desktop';
    const width = window.innerWidth;
    if (width <= 768) return 'mobile';
    if (width <= 1024) return 'tablet';
    return 'desktop';
};

const getBrowserName = (): string => {
    if (typeof navigator === 'undefined') return 'Unknown';
    const ua = navigator.userAgent;
    if (ua.includes('Firefox')) return 'Firefox';
    if (ua.includes('SamsungBrowser')) return 'Samsung Browser';
    if (ua.includes('Opera') || ua.includes('OPR')) return 'Opera';
    if (ua.includes('Trident')) return 'Internet Explorer';
    if (ua.includes('Edge') || ua.includes('Edg')) return 'Edge';
    if (ua.includes('Chrome')) return 'Chrome';
    if (ua.includes('Safari')) return 'Safari';
    return 'Other';
};

export class SiteAnalyticsService {
    private static isInitialized = false;
    private static heartbeatTimer: any = null;
    private static lastTrackedPath = '';

    static initialize(): void {
        if (this.isInitialized || typeof window === 'undefined') return;
        this.isInitialized = true;

        // Track initial page load
        this.trackPageView(window.location.pathname);

        // Heartbeat interval every 45s for accurate live visitor presence
        this.heartbeatTimer = setInterval(() => {
            if (document.visibilityState === 'visible') {
                this.sendHeartbeat();
            }
        }, 45000);

        // Track visibility change
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible') {
                this.sendHeartbeat();
            }
        });

        // Listen for popstate (history navigation)
        window.addEventListener('popstate', () => {
            this.trackPageView(window.location.pathname);
        });

        // Check if user is currently logged in with Deriv and sync
        try {
            const activeLoginId = localStorage.getItem('active_loginid') || localStorage.getItem('loginid');
            if (activeLoginId) {
                const accountsList = JSON.parse(localStorage.getItem('clientAccounts') || '{}');
                const account = accountsList[activeLoginId] || {};
                this.recordTraderLogin({
                    loginid: activeLoginId,
                    currency: account.currency || 'USD',
                    source: 'deriv_storage_sync',
                });
            }
        } catch {}
    }

    static trackPageView(path?: string): void {
        const currentPath = path || (typeof window !== 'undefined' ? window.location.pathname : '/');
        if (this.lastTrackedPath === currentPath) return;
        this.lastTrackedPath = currentPath;

        const activeLoginId = typeof localStorage !== 'undefined' ? localStorage.getItem('active_loginid') : null;

        this.sendBeaconOrFetch('/api/analytics/track', {
            eventType: 'page_view',
            path: currentPath,
            sessionId: getSessionId(),
            loginid: activeLoginId,
            device: getDeviceType(),
            browser: getBrowserName(),
            referrer: typeof document !== 'undefined' ? document.referrer : '',
        });
    }

    static trackToolAction(toolName: string, actionName: string, metadata: Record<string, any> = {}): void {
        const activeLoginId = typeof localStorage !== 'undefined' ? localStorage.getItem('active_loginid') : null;

        this.sendBeaconOrFetch('/api/analytics/track', {
            eventType: 'tool_action',
            path: typeof window !== 'undefined' ? window.location.pathname : `/${toolName}`,
            sessionId: getSessionId(),
            loginid: activeLoginId,
            device: getDeviceType(),
            metadata: {
                tool: toolName,
                action: actionName,
                ...metadata,
            },
        });
    }

    static sendHeartbeat(): void {
        const activeLoginId = typeof localStorage !== 'undefined' ? localStorage.getItem('active_loginid') : null;

        this.sendBeaconOrFetch('/api/analytics/track', {
            eventType: 'heartbeat',
            path: typeof window !== 'undefined' ? window.location.pathname : '/',
            sessionId: getSessionId(),
            loginid: activeLoginId,
            device: getDeviceType(),
        });
    }

    static recordTraderLogin(details: {
        loginid: string;
        accountType?: string;
        currency?: string;
        balance?: number;
        email?: string;
        source?: string;
    }): void {
        if (!details.loginid) return;

        this.sendBeaconOrFetch('/api/analytics/logins', {
            loginid: details.loginid,
            accountType: details.accountType,
            currency: details.currency || 'USD',
            balance: details.balance || 0,
            email: details.email,
            source: details.source || 'deriv_oauth',
        });
    }

    private static sendBeaconOrFetch(url: string, data: any): void {
        try {
            const payload = JSON.stringify(data);
            if (typeof navigator !== 'undefined' && navigator.sendBeacon) {
                const blob = new Blob([payload], { type: 'application/json' });
                navigator.sendBeacon(url, blob);
                return;
            }
            fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: payload,
                keepalive: true,
            }).catch(() => {});
        } catch {}
    }
}
