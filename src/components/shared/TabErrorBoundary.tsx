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
                        height: '100%',
                        width: '100%',
                        padding: '2rem',
                        background: 'rgba(255,0,0,0.05)',
                        borderRadius: '8px',
                        border: '1px solid rgba(255,0,0,0.2)',
                    }}
                >
                    <h2 style={{ color: '#ff4d4f', marginBottom: '1rem' }}>
                        {isChunkError ? 'New Update Available' : `Module Crashed: ${this.props.tabName}`}
                    </h2>
                    <p
                        style={{
                            color: 'var(--text-general)',
                            marginBottom: '2rem',
                            textAlign: 'center',
                            maxWidth: '600px',
                        }}
                    >
                        {isChunkError ? (
                            <>
                                A new platform update was recently deployed. Your browser was loading an older cached
                                version of this module.
                                <br />
                                Please reload to load the latest release.
                            </>
                        ) : (
                            <>
                                The System Operations Center isolated a critical failure in this module to prevent the
                                entire application from crashing.
                                <br />
                                <br />
                                <strong>Error:</strong> {this.state.error?.message}
                            </>
                        )}
                    </p>
                    <div style={{ display: 'flex', gap: '1rem' }}>
                        <button
                            onClick={this.handleRestart}
                            style={{
                                padding: '10px 24px',
                                background: '#1e3a8a',
                                color: 'white',
                                border: 'none',
                                borderRadius: '8px',
                                cursor: 'pointer',
                                fontWeight: 'bold',
                                boxShadow: '0 4px 12px rgba(30, 58, 138, 0.4)',
                            }}
                        >
                            {isChunkError ? 'Reload Page to Update' : 'Restart Module'}
                        </button>
                        {isChunkError && (
                            <button
                                onClick={() => window.location.reload()}
                                style={{
                                    padding: '10px 24px',
                                    background: '#10b981',
                                    color: 'white',
                                    border: 'none',
                                    borderRadius: '8px',
                                    cursor: 'pointer',
                                    fontWeight: 'bold',
                                    boxShadow: '0 4px 12px rgba(16, 185, 129, 0.4)',
                                }}
                            >
                                Force Refresh
                            </button>
                        )}
                    </div>
                </div>
            );
        }

        return this.props.children;
    }
}
