import React from 'react';
import { systemCenterStore } from '@/stores/system-center-store';

type Props = {
    tabId: string;
    tabName: string;
    children: React.ReactNode;
};

type State = {
    hasError: boolean;
    error: Error | null;
};

export class TabErrorBoundary extends React.Component<Props, State> {
    constructor(props: Props) {
        super(props);
        this.state = { hasError: false, error: null };
        systemCenterStore.registerTab(props.tabId, props.tabName);
    }

    static getDerivedStateFromError(error: Error): State {
        return { hasError: true, error };
    }

    componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
        console.error(`[System Center] Tab Failure isolated in ${this.props.tabName}:`, error, errorInfo);
        systemCenterStore.updateTabStatus(this.props.tabId, 'Error', error.message);
    }

    componentDidMount() {
        if (!this.state.hasError) {
            systemCenterStore.updateTabStatus(this.props.tabId, 'Ready');
        }
    }

    handleRestart = () => {
        this.setState({ hasError: false, error: null });
        systemCenterStore.updateTabStatus(this.props.tabId, 'Refreshing');
        setTimeout(() => {
            systemCenterStore.updateTabStatus(this.props.tabId, 'Ready');
        }, 100);
    };

    handleClearCacheAndReload = () => {
        try {
            sessionStorage.clear();
            localStorage.removeItem('last_global_chunk_reload');
            if ('caches' in window) {
                caches.keys().then(names => {
                    names.forEach(name => caches.delete(name));
                });
            }
        } catch {}
        window.location.reload();
    };

    handleReturnToDashboard = () => {
        try {
            localStorage.setItem('profithub_last_active_tab', 'dashboard');
            window.location.hash = 'dashboard';
        } catch {}
        window.location.reload();
    };

    render() {
        if (this.state.hasError) {
            const isChunkError =
                /loading chunk/i.test(this.state.error?.message || '') ||
                /failed to fetch dynamically imported module/i.test(this.state.error?.message || '');

            return (
                <div
                    style={{
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        justifyContent: 'center',
                        minHeight: '400px',
                        height: '100%',
                        width: '100%',
                        padding: '2rem',
                        background: 'rgba(255, 77, 79, 0.04)',
                        borderRadius: '12px',
                        border: '1px solid rgba(255, 77, 79, 0.2)',
                    }}
                >
                    <div
                        style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '8px',
                            background: 'rgba(255, 77, 79, 0.12)',
                            color: '#ff4d4f',
                            padding: '6px 14px',
                            borderRadius: '20px',
                            fontSize: '13px',
                            fontWeight: 'bold',
                            marginBottom: '1rem',
                        }}
                    >
                        <span>●</span> {this.props.tabName}
                    </div>

                    <h2 style={{ color: '#ff4d4f', marginBottom: '0.75rem', fontSize: '1.4rem' }}>
                        {isChunkError ? 'Module Update / Cache Sync Required' : `Module Issue: ${this.props.tabName}`}
                    </h2>

                    <p
                        style={{
                            color: 'var(--text-general, #888)',
                            marginBottom: '1.25rem',
                            textAlign: 'center',
                            maxWidth: '580px',
                            lineHeight: '1.5',
                            fontSize: '0.95rem',
                        }}
                    >
                        {isChunkError ? (
                            <>
                                The browser was unable to load the latest bundle for <strong>{this.props.tabName}</strong>.
                                This usually happens when new changes were deployed or the development server recompiled assets.
                            </>
                        ) : (
                            <>
                                The System Operations Center isolated an issue inside <strong>{this.props.tabName}</strong> to keep the rest of ProfitHub running smoothly.
                            </>
                        )}
                    </p>

                    {this.state.error?.message && (
                        <div
                            style={{
                                background: 'rgba(0, 0, 0, 0.25)',
                                border: '1px solid rgba(255, 255, 255, 0.08)',
                                borderRadius: '8px',
                                padding: '10px 16px',
                                fontSize: '12px',
                                fontFamily: 'monospace',
                                color: '#fca5a5',
                                maxWidth: '650px',
                                width: '100%',
                                textAlign: 'left',
                                wordBreak: 'break-all',
                                marginBottom: '1.5rem',
                            }}
                        >
                            <strong>Details:</strong> {this.state.error.message}
                        </div>
                    )}

                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', justifyContent: 'center' }}>
                        <button
                            onClick={this.handleRestart}
                            style={{
                                padding: '9px 20px',
                                background: '#1e3a8a',
                                color: 'white',
                                border: 'none',
                                borderRadius: '8px',
                                cursor: 'pointer',
                                fontWeight: 'bold',
                                fontSize: '13px',
                                boxShadow: '0 4px 12px rgba(30, 58, 138, 0.3)',
                            }}
                        >
                            Retry Loading {this.props.tabName}
                        </button>

                        <button
                            onClick={this.handleClearCacheAndReload}
                            style={{
                                padding: '9px 20px',
                                background: '#059669',
                                color: 'white',
                                border: 'none',
                                borderRadius: '8px',
                                cursor: 'pointer',
                                fontWeight: 'bold',
                                fontSize: '13px',
                                boxShadow: '0 4px 12px rgba(5, 150, 105, 0.3)',
                            }}
                        >
                            Hard Refresh & Sync Cache
                        </button>

                        <button
                            onClick={this.handleReturnToDashboard}
                            style={{
                                padding: '9px 20px',
                                background: 'rgba(255, 255, 255, 0.1)',
                                color: 'var(--text-general, #eee)',
                                border: '1px solid rgba(255, 255, 255, 0.15)',
                                borderRadius: '8px',
                                cursor: 'pointer',
                                fontWeight: '600',
                                fontSize: '13px',
                            }}
                        >
                            Return to Dashboard
                        </button>
                    </div>
                </div>
            );
        }

        return this.props.children;
    }
}
