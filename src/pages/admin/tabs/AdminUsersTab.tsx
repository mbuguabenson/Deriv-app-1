import React, { useState } from 'react';
import {
    Shield,
    UserPlus,
    Key,
    Trash2,
    AlertCircle,
    Clock,
    Lock,
    RefreshCw,
    X,
} from 'lucide-react';
import {
    AdminUserData,
    AdminAuditItem,
    createAdminUserApi,
    updateAdminUserApi,
    deleteAdminUserApi,
} from '@/utils/admin-api';

interface AdminUsersTabProps {
    admins: AdminUserData[];
    auditLogs: AdminAuditItem[];
    currentAdmin: { username: string; role: string };
    onRefresh: () => void;
}

export const AdminUsersTab: React.FC<AdminUsersTabProps> = ({
    admins,
    auditLogs,
    currentAdmin,
    onRefresh,
}) => {
    // Create Admin Modal State
    const [showCreateModal, setShowCreateModal] = useState(false);
    const [newUsername, setNewUsername] = useState('');
    const [newPassword, setNewPassword] = useState('');
    const [newRole, setNewRole] = useState<'administrator' | 'manager' | 'analyst' | 'support' | 'super_admin'>('administrator');
    const [newPermissions, setNewPermissions] = useState<string[]>([
        'view_analytics',
        'view_transactions',
    ]);
    const [createError, setCreateError] = useState<string | null>(null);
    const [createLoading, setCreateLoading] = useState(false);

    // Password Reset Modal State
    const [resetTargetId, setResetTargetId] = useState<string | null>(null);
    const [resetPassword, setResetPassword] = useState('');
    const [resetLoading, setResetLoading] = useState(false);
    const [resetMsg, setResetMsg] = useState<string | null>(null);

    const availablePermissions = [
        { key: 'view_analytics', label: 'View Analytics & Telemetry' },
        { key: 'view_transactions', label: 'View Transactions & Logins' },
        { key: 'manage_content', label: 'Manage Site Engine Flags' },
        { key: 'manage_bots', label: 'Manage Bot Marketplace' },
        { key: 'manage_admins', label: 'Create & Manage Sub-Admins' },
    ];

    const togglePermission = (permKey: string) => {
        if (newPermissions.includes(permKey)) {
            setNewPermissions(newPermissions.filter(p => p !== permKey));
        } else {
            setNewPermissions([...newPermissions, permKey]);
        }
    };

    const handleCreateAdmin = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!newUsername.trim() || !newPassword) {
            setCreateError('Username and password are required');
            return;
        }

        setCreateLoading(true);
        setCreateError(null);

        const token = localStorage.getItem('admin_token') || '';
        const res = await createAdminUserApi(
            {
                username: newUsername.trim(),
                password: newPassword,
                role: newRole,
                permissions: newRole === 'super_admin' ? ['all'] : newPermissions,
            },
            token
        );

        setCreateLoading(false);

        if (res.success) {
            setShowCreateModal(false);
            setNewUsername('');
            setNewPassword('');
            onRefresh();
        } else {
            setCreateError(res.error || 'Failed to create admin');
        }
    };

    const handleDeleteAdmin = async (id: string, uname: string) => {
        if (!window.confirm(`Are you sure you want to permanently remove admin '${uname}'?`)) {
            return;
        }
        const token = localStorage.getItem('admin_token') || '';
        const res = await deleteAdminUserApi(id, token);
        if (res.success) {
            onRefresh();
        } else {
            alert(res.error || 'Failed to delete admin');
        }
    };

    const handleToggleStatus = async (admin: AdminUserData) => {
        const nextStatus = admin.status === 'active' ? 'suspended' : 'active';
        const token = localStorage.getItem('admin_token') || '';
        const res = await updateAdminUserApi(admin.id, { status: nextStatus }, token);
        if (res.success) {
            onRefresh();
        } else {
            alert(res.error || 'Failed to update admin status');
        }
    };

    const handleResetPasswordSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!resetTargetId || !resetPassword || resetPassword.length < 6) {
            setResetMsg('Password must be at least 6 characters');
            return;
        }

        setResetLoading(true);
        const token = localStorage.getItem('admin_token') || '';
        const res = await updateAdminUserApi(resetTargetId, { password: resetPassword }, token);
        setResetLoading(false);

        if (res.success) {
            setResetTargetId(null);
            setResetPassword('');
            alert('Password successfully updated!');
        } else {
            setResetMsg(res.error || 'Failed to update password');
        }
    };

    return (
        <div className='ph-tab-content ph-admin-users-tab'>
            {/* KPI Strip */}
            <div className='ph-stats-strip'>
                <div className='ph-strip-card'>
                    <span className='ph-strip-label'>Authorized Administrators</span>
                    <strong className='ph-strip-val'>{admins.length}</strong>
                    <span className='ph-strip-sub'>Total admin accounts configured</span>
                </div>
                <div className='ph-strip-card'>
                    <span className='ph-strip-label'>Super Admins</span>
                    <strong className='ph-strip-val ph-neon-gold'>
                        {admins.filter(a => a.role === 'super_admin').length}
                    </strong>
                    <span className='ph-strip-sub'>Root platform authority</span>
                </div>
                <div className='ph-strip-card'>
                    <span className='ph-strip-label'>Active Accounts</span>
                    <strong className='ph-strip-val ph-neon-green'>
                        {admins.filter(a => a.status === 'active').length}
                    </strong>
                    <span className='ph-strip-sub'>In good standing</span>
                </div>
                <div className='ph-strip-card'>
                    <span className='ph-strip-label'>Your Account</span>
                    <strong className='ph-strip-val'>{currentAdmin.username}</strong>
                    <span className='ph-strip-sub'>{currentAdmin.role.replace('_', ' ')}</span>
                </div>
            </div>

            {/* Admins Table Panel */}
            <div className='ph-panel'>
                <div className='ph-panel-header'>
                    <div>
                        <h3>Platform Administrators & Managers</h3>
                        <p>Control who has access to site metrics, bot management, and settings</p>
                    </div>

                    <button
                        className='ph-btn-primary'
                        onClick={() => setShowCreateModal(true)}
                    >
                        <UserPlus size={16} />
                        <span>Create New Admin</span>
                    </button>
                </div>

                <div className='ph-table-wrap'>
                    <table className='ph-data-table'>
                        <thead>
                            <tr>
                                <th>Admin User</th>
                                <th>Role</th>
                                <th>Permissions</th>
                                <th>Status</th>
                                <th>Created</th>
                                <th>Last Login</th>
                                <th>Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {admins.map(admin => {
                                const isSuper = admin.role === 'super_admin';
                                return (
                                    <tr key={admin.id}>
                                        <td className='ph-cell-loginid'>
                                            <div className='ph-trader-id-pill'>
                                                <Shield size={14} className={isSuper ? 'ph-icon-gold' : 'ph-icon-neon'} />
                                                <strong>{admin.username}</strong>
                                            </div>
                                        </td>
                                        <td>
                                            <span className={`ph-badge-sm ${isSuper ? 'is-super' : 'is-admin'}`}>
                                                {admin.role.replace('_', ' ').toUpperCase()}
                                            </span>
                                        </td>
                                        <td>
                                            <div className='ph-perm-tags'>
                                                {admin.permissions.includes('all') ? (
                                                    <span className='ph-perm-pill is-all'>FULL ACCESS</span>
                                                ) : (
                                                    admin.permissions.map(p => (
                                                        <span key={p} className='ph-perm-pill'>
                                                            {p.replace(/_/g, ' ')}
                                                        </span>
                                                    ))
                                                )}
                                            </div>
                                        </td>
                                        <td>
                                            <span className={`ph-status-pill ${admin.status === 'active' ? 'is-active' : 'is-suspended'}`}>
                                                {admin.status.toUpperCase()}
                                            </span>
                                        </td>
                                        <td className='ph-dim-text'>
                                            {new Date(admin.created_at).toLocaleDateString()}
                                        </td>
                                        <td className='ph-cell-time'>
                                            {admin.last_login ? (
                                                <>
                                                    <Clock size={12} />
                                                    <span>{new Date(admin.last_login).toLocaleString()}</span>
                                                </>
                                            ) : (
                                                <span className='ph-dim-text'>Never</span>
                                            )}
                                        </td>
                                        <td>
                                            <div className='ph-actions-row'>
                                                <button
                                                    className='ph-action-icon-btn'
                                                    title='Change Password'
                                                    onClick={() => setResetTargetId(admin.id)}
                                                >
                                                    <Key size={14} />
                                                </button>

                                                <button
                                                    className='ph-action-icon-btn'
                                                    title={admin.status === 'active' ? 'Suspend Account' : 'Activate Account'}
                                                    onClick={() => handleToggleStatus(admin)}
                                                >
                                                    <Lock size={14} />
                                                </button>

                                                {!isSuper && (
                                                    <button
                                                        className='ph-action-icon-btn is-danger'
                                                        title='Delete Admin'
                                                        onClick={() => handleDeleteAdmin(admin.id, admin.username)}
                                                    >
                                                        <Trash2 size={14} />
                                                    </button>
                                                )}
                                            </div>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Admin Audit Trail */}
            <div className='ph-panel'>
                <div className='ph-panel-header'>
                    <div>
                        <h3>Admin Security Audit Trail</h3>
                        <p>Immutable log of administrator logins, changes, and authorizations</p>
                    </div>
                    <button className='ph-link-btn' onClick={onRefresh}>
                        <RefreshCw size={14} /> Refresh Logs
                    </button>
                </div>

                <div className='ph-table-wrap'>
                    <table className='ph-data-table'>
                        <thead>
                            <tr>
                                <th>Timestamp</th>
                                <th>Action</th>
                                <th>Actor</th>
                                <th>Details</th>
                            </tr>
                        </thead>
                        <tbody>
                            {auditLogs.length > 0 ? (
                                auditLogs.slice(0, 20).map(log => (
                                    <tr key={log.id}>
                                        <td className='ph-cell-time'>
                                            <Clock size={12} />
                                            <span>{new Date(log.timestamp).toLocaleString()}</span>
                                        </td>
                                        <td>
                                            <span className='ph-badge-sm is-audit'>
                                                {log.action}
                                            </span>
                                        </td>
                                        <td><strong>{log.actor}</strong></td>
                                        <td className='ph-dim-text'>
                                            {typeof log.details === 'object'
                                                ? JSON.stringify(log.details)
                                                : String(log.details)}
                                        </td>
                                    </tr>
                                ))
                            ) : (
                                <tr>
                                    <td colSpan={4} className='ph-empty-cell'>
                                        No audit entries recorded yet.
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Create Admin Modal */}
            {showCreateModal && (
                <div className='ph-modal-backdrop'>
                    <div className='ph-modal-card'>
                        <div className='ph-modal-header'>
                            <div className='ph-modal-title'>
                                <UserPlus size={20} />
                                <h3>Create New Administrator</h3>
                            </div>
                            <button className='ph-close-btn' onClick={() => setShowCreateModal(false)}>
                                <X size={18} />
                            </button>
                        </div>

                        {createError && (
                            <div className='ph-login-alert'>
                                <AlertCircle size={16} />
                                <span>{createError}</span>
                            </div>
                        )}

                        <form onSubmit={handleCreateAdmin} className='ph-modal-form'>
                            <div className='ph-form-group'>
                                <label>Admin Username</label>
                                <input
                                    type='text'
                                    placeholder='e.g. manager_alex'
                                    value={newUsername}
                                    onChange={e => setNewUsername(e.target.value)}
                                    required
                                />
                            </div>

                            <div className='ph-form-group'>
                                <label>Initial Password</label>
                                <input
                                    type='password'
                                    placeholder='At least 6 characters'
                                    value={newPassword}
                                    onChange={e => setNewPassword(e.target.value)}
                                    required
                                />
                            </div>

                            <div className='ph-form-group'>
                                <label>Assigned Role</label>
                                <select
                                    value={newRole}
                                    onChange={e => setNewRole(e.target.value as any)}
                                >
                                    <option value='administrator'>Administrator (Operational control)</option>
                                    <option value='manager'>Manager (Bot & content control)</option>
                                    <option value='analyst'>Analyst (Read-only analytics & transactions)</option>
                                    <option value='support'>Support (User logins & session assistance)</option>
                                    <option value='super_admin'>Super Admin (Full Root Authority)</option>
                                </select>
                            </div>

                            {newRole !== 'super_admin' && (
                                <div className='ph-form-group'>
                                    <label>Granular Permissions</label>
                                    <div className='ph-checkbox-grid'>
                                        {availablePermissions.map(p => (
                                            <label key={p.key} className='ph-checkbox-label'>
                                                <input
                                                    type='checkbox'
                                                    checked={newPermissions.includes(p.key)}
                                                    onChange={() => togglePermission(p.key)}
                                                />
                                                <span>{p.label}</span>
                                            </label>
                                        ))}
                                    </div>
                                </div>
                            )}

                            <div className='ph-modal-actions'>
                                <button
                                    type='button'
                                    className='ph-btn-outline'
                                    onClick={() => setShowCreateModal(false)}
                                >
                                    Cancel
                                </button>
                                <button
                                    type='submit'
                                    className='ph-btn-primary'
                                    disabled={createLoading}
                                >
                                    {createLoading ? 'Creating...' : 'Create Admin Account'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* Reset Password Modal */}
            {resetTargetId && (
                <div className='ph-modal-backdrop'>
                    <div className='ph-modal-card'>
                        <div className='ph-modal-header'>
                            <div className='ph-modal-title'>
                                <Key size={20} />
                                <h3>Reset Admin Password</h3>
                            </div>
                            <button className='ph-close-btn' onClick={() => setResetTargetId(null)}>
                                <X size={18} />
                            </button>
                        </div>

                        {resetMsg && (
                            <div className='ph-login-alert'>
                                <AlertCircle size={16} />
                                <span>{resetMsg}</span>
                            </div>
                        )}

                        <form onSubmit={handleResetPasswordSubmit} className='ph-modal-form'>
                            <div className='ph-form-group'>
                                <label>New Password</label>
                                <input
                                    type='password'
                                    placeholder='At least 6 characters'
                                    value={resetPassword}
                                    onChange={e => setResetPassword(e.target.value)}
                                    required
                                    autoFocus
                                />
                            </div>

                            <div className='ph-modal-actions'>
                                <button
                                    type='button'
                                    className='ph-btn-outline'
                                    onClick={() => setResetTargetId(null)}
                                >
                                    Cancel
                                </button>
                                <button
                                    type='submit'
                                    className='ph-btn-primary'
                                    disabled={resetLoading}
                                >
                                    {resetLoading ? 'Updating...' : 'Save New Password'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
};
