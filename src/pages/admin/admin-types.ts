export type AdminTab =
    | 'overview'
    | 'analytics'
    | 'logins'
    | 'user-trades'
    | 'commission-tracker'
    | 'admin-users'
    | 'site-engine'
    | 'bots'
    | 'system-health';

export interface AdminUser {
    id: string;
    username: string;
    role: 'super_admin' | 'administrator' | 'manager' | 'analyst' | 'support';
    permissions: string[];
    created_at: string;
    last_login: string | null;
    status: 'active' | 'suspended';
}

export interface AdminSession {
    token: string;
    user: {
        id: string;
        username: string;
        role: string;
        permissions: string[];
        last_login?: string | null;
    };
}
