// Use the serverless proxy by default to avoid CORS issues when calling Supabase from browser
const USE_PROXY = true;
const SUPABASE_PROXY_PREFIX = '/api/supabase/';
const SUPABASE_URL = USE_PROXY ? SUPABASE_PROXY_PREFIX : 'https://bljwlgebdrgfqcsawygs.supabase.co';
const SUPABASE_ANON_KEY = USE_PROXY
    ? ''
    : 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJsandsZ2ViZHJnZnFjc2F3eWdzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njc3MjA5NTgsImV4cCI6MjA4MzI5Njk1OH0.vgcxmT6mR62LbynwhS177biIwZCqr-GR9kIigr5HLO4';

export interface CopyTraderProfile {
    loginid: string;
    display_name: string;
    description: string;
    is_public: boolean;
    win_rate?: number;
    total_trades?: number;
}

export interface CopyRequest {
    id?: string;
    requester_loginid: string;
    requester_token: string;
    provider_loginid: string;
    status: 'pending' | 'accepted' | 'rejected' | 'stopped';
    created_at?: string;
    accepted_at?: string;
}

// Ensure the tables copy_traders and copy_requests are populated/stored.
// Since Supabase REST works on tables via endpoints, let's wrap them in try/catch fetch.

let isUnreachable = false;
let lastFailTime = 0;

const safeFetch = async (url: string, options: RequestInit): Promise<Response | null> => {
    if (isUnreachable && Date.now() - lastFailTime < 60000) {
        return null;
    }
    try {
        const response = await fetch(url, options);
        isUnreachable = false;
        return response;
    } catch {
        isUnreachable = true;
        lastFailTime = Date.now();
        return null;
    }
};

export const publishTraderProfile = async (profile: CopyTraderProfile): Promise<boolean> => {
    try {
        const endpoint = USE_PROXY ? `${SUPABASE_URL}copy_traders` : `${SUPABASE_URL}/rest/v1/copy_traders`;
        const response = await safeFetch(endpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                apikey: SUPABASE_ANON_KEY,
                Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
                Prefer: 'resolution=merge-duplicates',
            },
            body: JSON.stringify(profile),
        });
        return !!response?.ok;
    } catch {
        return false;
    }
};

export const getPublicTraders = async (): Promise<CopyTraderProfile[]> => {
    try {
        const endpoint = USE_PROXY
            ? `${SUPABASE_URL}copy_traders?is_public=eq.true&select=*`
            : `${SUPABASE_URL}/rest/v1/copy_traders?is_public=eq.true&select=*`;
        const response = await safeFetch(endpoint, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
                apikey: SUPABASE_ANON_KEY,
                Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
            },
        });
        if (!response?.ok) return [];
        return await response.json();
    } catch {
        return [];
    }
};

export const getTraderProfile = async (loginid: string): Promise<CopyTraderProfile | null> => {
    try {
        const endpoint = USE_PROXY
            ? `${SUPABASE_URL}copy_traders?loginid=eq.${encodeURIComponent(loginid)}&select=*`
            : `${SUPABASE_URL}/rest/v1/copy_traders?loginid=eq.${encodeURIComponent(loginid)}&select=*`;
        const response = await safeFetch(endpoint, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
                apikey: SUPABASE_ANON_KEY,
                Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
            },
        });
        if (!response?.ok) return null;
        const data = await response.json();
        return data && data.length > 0 ? data[0] : null;
    } catch {
        return null;
    }
};

// Copy Requests

export const requestFollowProvider = async (
    requesterLoginid: string,
    requesterToken: string,
    providerLoginid: string
): Promise<boolean> => {
    try {
        const requestData: CopyRequest = {
            requester_loginid: requesterLoginid,
            requester_token: requesterToken,
            provider_loginid: providerLoginid,
            status: 'pending',
        };

        // First clean up any existing request for the same pair
        await deleteRequest(requesterLoginid, providerLoginid);

        const endpoint = USE_PROXY ? `${SUPABASE_URL}copy_requests` : `${SUPABASE_URL}/rest/v1/copy_requests`;
        const response = await safeFetch(endpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                apikey: SUPABASE_ANON_KEY,
                Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
            },
            body: JSON.stringify(requestData),
        });
        return !!response?.ok;
    } catch {
        return false;
    }
};

export const deleteRequest = async (requesterLoginid: string, providerLoginid: string): Promise<boolean> => {
    try {
        const query = `copy_requests?requester_loginid=eq.${encodeURIComponent(
            requesterLoginid
        )}&provider_loginid=eq.${encodeURIComponent(providerLoginid)}`;
        const endpoint = USE_PROXY ? `${SUPABASE_URL}${query}` : `${SUPABASE_URL}/rest/v1/${query}`;
        const response = await safeFetch(endpoint, {
            method: 'DELETE',
            headers: {
                apikey: SUPABASE_ANON_KEY,
                Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
            },
        });
        return !!response?.ok;
    } catch {
        return false;
    }
};

export const getCopyRequestStatus = async (
    requesterLoginid: string,
    providerLoginid: string
): Promise<CopyRequest | null> => {
    try {
        const query = `copy_requests?requester_loginid=eq.${encodeURIComponent(
            requesterLoginid
        )}&provider_loginid=eq.${encodeURIComponent(providerLoginid)}&select=*`;
        const endpoint = USE_PROXY ? `${SUPABASE_URL}${query}` : `${SUPABASE_URL}/rest/v1/${query}`;
        const response = await safeFetch(endpoint, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
                apikey: SUPABASE_ANON_KEY,
                Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
            },
        });
        if (!response?.ok) return null;
        const data = await response.json();
        return data && data.length > 0 ? data[0] : null;
    } catch {
        return null;
    }
};

// Admin REST operations

export const getPendingRequestsForProvider = async (providerLoginid: string): Promise<CopyRequest[]> => {
    try {
        const query = `copy_requests?provider_loginid=eq.${encodeURIComponent(providerLoginid)}&select=*`;
        const endpoint = USE_PROXY ? `${SUPABASE_URL}${query}` : `${SUPABASE_URL}/rest/v1/${query}`;
        const response = await safeFetch(endpoint, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
                apikey: SUPABASE_ANON_KEY,
                Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
            },
        });
        if (!response?.ok) return [];
        return await response.json();
    } catch {
        return [];
    }
};

export const updateCopyRequestStatus = async (
    requestId: string,
    status: 'accepted' | 'rejected' | 'stopped'
): Promise<boolean> => {
    try {
        const updateData: Partial<CopyRequest> = {
            status,
            ...(status === 'accepted' && { accepted_at: new Date().toISOString() }),
        };

        const endpoint = USE_PROXY
            ? `${SUPABASE_URL}copy_requests?id=eq.${requestId}`
            : `${SUPABASE_URL}/rest/v1/copy_requests?id=eq.${requestId}`;
        const response = await fetch(endpoint, {
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/json',
                apikey: SUPABASE_ANON_KEY,
                Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
            },
            body: JSON.stringify(updateData),
        });
        return response.ok;
    } catch {
        return false;
    }
};

// ─── Chat Messages (localStorage-backed) ─────────────────────────────────────
export interface ChatMessage {
    id: string;
    sender: 'client' | 'admin';
    loginid: string;
    text: string;
    timestamp: number;
}

const CHAT_STORAGE_KEY = 'profithub_chat_messages';

export const sendChatMessage = (msg: Omit<ChatMessage, 'id'>): ChatMessage => {
    const fullMsg: ChatMessage = { ...msg, id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}` };
    try {
        const existing: ChatMessage[] = JSON.parse(localStorage.getItem(CHAT_STORAGE_KEY) || '[]');
        existing.push(fullMsg);
        localStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify(existing));
    } catch {
        /* ignore */
    }
    return fullMsg;
};

export const getChatMessages = (loginid?: string): ChatMessage[] => {
    try {
        const all: ChatMessage[] = JSON.parse(localStorage.getItem(CHAT_STORAGE_KEY) || '[]');
        if (!loginid) return all;
        return all.filter(m => m.loginid === loginid);
    } catch {
        return [];
    }
};

export const getChatSessions = (): string[] => {
    try {
        const all: ChatMessage[] = JSON.parse(localStorage.getItem(CHAT_STORAGE_KEY) || '[]');
        return [...new Set(all.map(m => m.loginid))];
    } catch {
        return [];
    }
};

// ─── Frontend Site Configuration (localStorage-backed) ────────────────────────
export interface SiteConfig {
    primaryColor: string;
    secondaryColor: string;
    accentColor: string;
    fontFamily: string;
    logoBase64: string;
    tabConfig: TabConfigItem[];
    disabledTabs: string[];
    maintenanceMode: boolean;
    maintenanceMessage: string;
    tabColor?: string;
    activeTabColor?: string;
    loginBtnBg?: string;
    loginBtnText?: string;
    signupBtnBg?: string;
    signupBtnText?: string;
    runPanelBg?: string;
    runPanelText?: string;
    faviconBase64?: string;
    dangerShieldEnabled?: boolean;
    dangerShieldWhatsAppUrl?: string;
    dangerShieldTelegramUrl?: string;
    dangerShieldDomainName?: string;
}

export interface TabConfigItem {
    key: string;
    label: string;
    enabled: boolean;
    order: number;
}

const SITE_CONFIG_KEY = 'profithub_site_config';

export const getDefaultTabConfig = (): TabConfigItem[] => [
    { key: 'dashboard', label: 'Dashboard', enabled: true, order: 0 },
    { key: 'bot_builder', label: 'Bot Builder', enabled: true, order: 1 },
    { key: 'chart', label: 'Charts', enabled: true, order: 2 },
    { key: 'trading_bots', label: 'Trading Bots', enabled: true, order: 3 },
];

// Bump this when new tabs are added or removed to force clients to pick up new defaults
const TAB_CONFIG_VERSION = 28;

export const getSiteConfig = (): SiteConfig => {
    try {
        const raw = localStorage.getItem(SITE_CONFIG_KEY);
        if (raw) {
            const stored: SiteConfig = JSON.parse(raw);
            const defaults = getDefaultTabConfig();
            const storedKeys = new Set((stored.tabConfig || []).map(t => t.key));
            let changed = false;

            // Add any missing default tabs
            const missingTabs = defaults.filter(t => !storedKeys.has(t.key));
            if (missingTabs.length > 0) {
                stored.tabConfig = [...(stored.tabConfig || []), ...missingTabs];
                changed = true;
            }

            // Force re-enable and re-sync if version stamp is old
            const storedVersion = (stored as any).__tabConfigVersion || 0;
            if (storedVersion < TAB_CONFIG_VERSION) {
                const defaultKeySet = new Set(defaults.map(t => t.key));
                // Remove obsolete tabs that no longer exist in defaults
                stored.tabConfig = (stored.tabConfig || [])
                    .filter(tab => defaultKeySet.has(tab.key))
                    .map(tab => {
                        const def = defaults.find(d => d.key === tab.key)!;
                        return { ...tab, enabled: tab.enabled ?? def.enabled, order: def.order };
                    });
                // Ensure all default tabs exist
                const currentKeys = new Set(stored.tabConfig.map(t => t.key));
                defaults.forEach(def => {
                    if (!currentKeys.has(def.key)) {
                        stored.tabConfig!.push(def);
                    }
                });
                stored.tabConfig.sort((a, b) => a.order - b.order);
                (stored as any).__tabConfigVersion = TAB_CONFIG_VERSION;
                changed = true;
            }

            if (changed) {
                localStorage.setItem(SITE_CONFIG_KEY, JSON.stringify(stored));
            }
            return stored;
        }
    } catch {
        /* ignore */
    }
    return {
        primaryColor: '#f5c542',
        secondaryColor: '#0e0e0e',
        accentColor: '#3b82f6',
        fontFamily: 'Inter',
        logoBase64: '',
        tabConfig: getDefaultTabConfig(),
        disabledTabs: [],
        maintenanceMode: false,
        maintenanceMessage: 'We are currently performing scheduled maintenance. Please check back shortly.',
        tabColor: 'rgba(255,255,255,0.6)',
        activeTabColor: '#ffffff',
        loginBtnBg: 'transparent',
        loginBtnText: '#ffffff',
        signupBtnBg: '#f5c542',
        signupBtnText: '#000000',
        runPanelBg: '#0e0e0e',
        runPanelText: '#ffffff',
        faviconBase64: '',
        dangerShieldEnabled: true,
        dangerShieldWhatsAppUrl: 'https://whatsapp.com/channel/profithub',
        dangerShieldTelegramUrl: 'https://t.me/profithubofficial',
        dangerShieldDomainName: 'profithubexpert.com',
    };
};

export const saveSiteConfig = (config: Partial<SiteConfig>): void => {
    const current = getSiteConfig();
    const merged = { ...current, ...config };
    localStorage.setItem(SITE_CONFIG_KEY, JSON.stringify(merged));
    // Save to backend API asynchronously
    import('./admin-api')
        .then(({ saveSiteConfigApi }) => {
            saveSiteConfigApi(merged);
        })
        .catch(() => {
            /* ignore */
        });
    // Dispatch event so the main site picks it up in real-time
    window.dispatchEvent(new CustomEvent('profithub_config_changed', { detail: merged }));
};

export const initSiteConfigSync = async (): Promise<void> => {
    try {
        const { fetchSiteConfigApi } = await import('./admin-api');
        const remote = await fetchSiteConfigApi();
        if (remote && typeof remote === 'object' && Object.keys(remote).length > 0) {
            const current = getSiteConfig();
            const merged = { ...current, ...remote };
            localStorage.setItem(SITE_CONFIG_KEY, JSON.stringify(merged));
            window.dispatchEvent(new CustomEvent('profithub_config_changed', { detail: merged }));
        }
    } catch {
        /* fallback to localStorage */
    }
};

// ─── Uploaded Bots (localStorage-backed) ──────────────────────────────────────
export interface UploadedBot {
    id: string;
    name: string;
    description: string;
    xml: string;
    uploadedAt: number;
}

const UPLOADED_BOTS_KEY = 'profithub_uploaded_bots';

export const getUploadedBots = (): UploadedBot[] => {
    try {
        return JSON.parse(localStorage.getItem(UPLOADED_BOTS_KEY) || '[]');
    } catch {
        return [];
    }
};

export const saveUploadedBot = (bot: Omit<UploadedBot, 'id' | 'uploadedAt'>): void => {
    const bots = getUploadedBots();
    bots.push({ ...bot, id: `bot-${Date.now()}`, uploadedAt: Date.now() });
    localStorage.setItem(UPLOADED_BOTS_KEY, JSON.stringify(bots));
};

export const deleteUploadedBot = (id: string): void => {
    const bots = getUploadedBots().filter(b => b.id !== id);
    localStorage.setItem(UPLOADED_BOTS_KEY, JSON.stringify(bots));
};

// ─── Platform Notifications (localStorage-backed) ─────────────────────────────
export interface PlatformNotification {
    id: string;
    title: string;
    message: string;
    timestamp: number;
    is_read: boolean;
}

const NOTIFICATIONS_STORAGE_KEY = 'profithub_platform_notifications';

export const getPlatformNotifications = (): PlatformNotification[] => {
    try {
        return JSON.parse(localStorage.getItem(NOTIFICATIONS_STORAGE_KEY) || '[]');
    } catch {
        return [];
    }
};

export const pushPlatformNotification = (title: string, message: string): void => {
    const items = getPlatformNotifications();
    items.unshift({
        id: `noti-${Date.now()}`,
        title,
        message,
        timestamp: Date.now(),
        is_read: false,
    });
    localStorage.setItem(NOTIFICATIONS_STORAGE_KEY, JSON.stringify(items));
};

// ─── M-Pesa Transactions (localStorage-backed) ────────────────────────────────
export interface MpesaTransaction {
    id: string;
    phoneNumber: string;
    amount: number;
    packageName: string;
    timestamp: number;
    status: 'completed' | 'pending' | 'failed';
    reference: string;
}

const TRANSACTIONS_STORAGE_KEY = 'profithub_mpesa_transactions';

export const getMpesaTransactions = (): MpesaTransaction[] => {
    try {
        const raw = localStorage.getItem(TRANSACTIONS_STORAGE_KEY);
        if (!raw) {
            return [];
        }
        return JSON.parse(raw);
    } catch {
        return [];
    }
};

export const saveMpesaTransaction = (txn: MpesaTransaction): void => {
    const list = getMpesaTransactions();
    list.unshift(txn);
    localStorage.setItem(TRANSACTIONS_STORAGE_KEY, JSON.stringify(list));
};

// ─── Markup Commissions (localStorage-backed) ──────────────────────────────────
export interface MarkupCommission {
    id: string;
    date: string;
    clientId: string;
    volume: number;
    profitShare: number;
    amount: number;
    status: 'paid' | 'pending' | 'unpaid';
}

const COMMISSIONS_STORAGE_KEY = 'profithub_commissions';

export const getCommissions = (): MarkupCommission[] => {
    try {
        const raw = localStorage.getItem(COMMISSIONS_STORAGE_KEY);
        if (!raw) {
            return [];
        }
        return JSON.parse(raw);
    } catch {
        return [];
    }
};

export const addCommission = (comm: MarkupCommission): void => {
    const list = getCommissions();
    list.unshift(comm);
    localStorage.setItem(COMMISSIONS_STORAGE_KEY, JSON.stringify(list));
};

export const updateCommissionStatus = (id: string, status: 'paid' | 'pending' | 'unpaid'): void => {
    const list = getCommissions();
    const idx = list.findIndex(c => c.id === id);
    if (idx >= 0) {
        list[idx].status = status;
        localStorage.setItem(COMMISSIONS_STORAGE_KEY, JSON.stringify(list));
    }
};

// ─── System Logs (localStorage-backed) ────────────────────────────────────────
export interface SystemLogItem {
    id: string;
    timestamp: number;
    level: 'info' | 'warn' | 'error';
    message: string;
    component: string;
}

const SYSTEM_LOGS_STORAGE_KEY = 'profithub_system_logs';

export const getSystemLogs = (): SystemLogItem[] => {
    try {
        const raw = localStorage.getItem(SYSTEM_LOGS_STORAGE_KEY);
        if (!raw) {
            return [];
        }
        return JSON.parse(raw);
    } catch {
        return [];
    }
};

export const addSystemLog = (level: 'info' | 'warn' | 'error', message: string, component: string): void => {
    const list = getSystemLogs();
    list.unshift({
        id: `LOG-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
        timestamp: Date.now(),
        level,
        message,
        component,
    });
    if (list.length > 200) {
        list.splice(200);
    }
    localStorage.setItem(SYSTEM_LOGS_STORAGE_KEY, JSON.stringify(list));
};

export const clearSystemLogs = (): void => {
    localStorage.setItem(SYSTEM_LOGS_STORAGE_KEY, JSON.stringify([]));
};
