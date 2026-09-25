import React, { useState } from 'react';
import { Shield, Lock, User, AlertCircle, ArrowRight, CheckCircle2 } from 'lucide-react';
import { loginAdminApi } from '@/utils/admin-api';

interface AdminLoginModalProps {
    onLoginSuccess: (session: { token: string; user: any }) => void;
}

export const AdminLoginModal: React.FC<AdminLoginModalProps> = ({ onLoginSuccess }) => {
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!username.trim() || !password) {
            setError('Please enter both username and password');
            return;
        }

        setLoading(true);
        setError(null);

        try {
            const res = await loginAdminApi(username.trim(), password);
            if (res.success && res.token) {
                const sessionData = {
                    token: res.token,
                    user: (res as any).user || { username: username.trim(), role: 'super_admin' },
                };
                localStorage.setItem('admin_token', res.token);
                localStorage.setItem('admin_user', JSON.stringify(sessionData.user));
                onLoginSuccess(sessionData);
            } else {
                setError(res.error || 'Invalid credentials. Access denied.');
            }
        } catch (err: any) {
            setError(err.message || 'Failed to authenticate with admin backend.');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className='ph-admin-login-overlay'>
            <div className='ph-admin-login-card'>
                <div className='ph-login-header'>
                    <div className='ph-login-shield'>
                        <Shield size={32} />
                    </div>
                    <h2>ProfitHub Admin Console</h2>
                    <p>Enter your authorized credentials to access site telemetry & management engine</p>
                </div>

                {error && (
                    <div className='ph-login-alert'>
                        <AlertCircle size={18} />
                        <span>{error}</span>
                    </div>
                )}

                <form onSubmit={handleSubmit} className='ph-login-form'>
                    <div className='ph-form-group'>
                        <label htmlFor='admin-user'>Username</label>
                        <div className='ph-input-wrap'>
                            <User size={18} className='ph-input-icon' />
                            <input
                                id='admin-user'
                                type='text'
                                placeholder='Admin username'
                                value={username}
                                onChange={e => setUsername(e.target.value)}
                                autoFocus
                                required
                            />
                        </div>
                    </div>

                    <div className='ph-form-group'>
                        <label htmlFor='admin-pass'>Password</label>
                        <div className='ph-input-wrap'>
                            <Lock size={18} className='ph-input-icon' />
                            <input
                                id='admin-pass'
                                type='password'
                                placeholder='••••••••••••'
                                value={password}
                                onChange={e => setPassword(e.target.value)}
                                required
                            />
                        </div>
                    </div>

                    <button type='submit' className='ph-login-btn' disabled={loading}>
                        {loading ? (
                            <span className='ph-spinner-sm'>Verifying...</span>
                        ) : (
                            <>
                                <span>Sign In to Console</span>
                                <ArrowRight size={18} />
                            </>
                        )}
                    </button>
                </form>

                <div className='ph-login-footer'>
                    <div className='ph-footer-note'>
                        <CheckCircle2 size={14} />
                        <span>Protected by ProfitHub Security Shield • Session Encrypted</span>
                    </div>
                </div>
            </div>
        </div>
    );
};
