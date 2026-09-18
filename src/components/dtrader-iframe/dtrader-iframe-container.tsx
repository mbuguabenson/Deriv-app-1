import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import classNames from 'classnames';
import { getLegacyDTraderToken, isInvalidBearerToken } from '@/utils/token-bridge';
import './dtrader-iframe-container.scss';

export interface DTraderIframeContainerProps {
    /** Target deployment URL of the custom white-labeled DTrader platform */
    baseUrl?: string;
    /** Deriv OAuth Client App ID */
    appId?: string;
    /** Active Deriv API session token (bypasses OAuth and enables Embedded Mode) */
    token?: string;
    /** Active account Login ID (e.g., 'CR1234567' or 'VRTC1234567') */
    loginId?: string;
    /** Color theme ('dark' | 'light') to synchronize with parent app */
    theme?: 'dark' | 'light';
    /** Suppress browser splash screens if running inside a mobile WebView */
    isMobileApp?: boolean;
    /** Edge-to-edge height (minimum 700px, default: calc(100vh - 56px)) */
    height?: string | number;
    /** Whether to show header toolbar with controls */
    showToolbar?: boolean;
    /** Custom CSS class name */
    className?: string;
    /** Callback when user clicks connect/sign in button in fallback state */
    onLoginClick?: () => void;
    /** Callback when the iframe finishes loading */
    onIframeLoaded?: () => void;
}

/**
 * DTraderIframeContainer
 * Production-ready embedded iframe container for the custom white-labeled Deriv DTrader platform.
 * Supports embedded query parameters, dynamic account & theme synchronization,
 * loading skeleton, and graceful unauthenticated fallback.
 */
export const DTraderIframeContainer: React.FC<DTraderIframeContainerProps> = ({
    baseUrl = 'https://profhubdtrader.vercel.app',
    appId = '34qV9FtmeYPRVWVJXIxr2',
    token: propToken,
    loginId: propLoginId,
    theme: propTheme,
    isMobileApp = false,
    height = 'calc(100vh - 56px)',
    showToolbar = false,
    className,
    onLoginClick,
    onIframeLoaded,
}) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const iframeRef = useRef<HTMLIFrameElement>(null);

    const [isLoading, setIsLoading] = useState<boolean>(true);
    const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
    const [iframeKey, setIframeKey] = useState<number>(0);

    // Resolve clean token (filters out OAuth2 Bearer JWTs that break DTrader)
    const resolveToken = useCallback((explicitToken?: string, loginid?: string) => {
        if (explicitToken && !isInvalidBearerToken(explicitToken)) return explicitToken;
        const legacy = getLegacyDTraderToken(loginid);
        if (legacy && !isInvalidBearerToken(legacy)) return legacy;
        const candidate =
            localStorage.getItem('legacy_dtrader_token') ||
            localStorage.getItem('token') ||
            localStorage.getItem('active_token') ||
            '';
        if (candidate && !isInvalidBearerToken(candidate)) return candidate;
        const auth = localStorage.getItem('authToken');
        if (auth && !isInvalidBearerToken(auth)) return auth;
        return '';
    }, []);

    const [currentToken, setCurrentToken] = useState<string>(() => resolveToken(propToken, propLoginId));

    const [currentLoginId, setCurrentLoginId] = useState<string>(() => {
        if (propLoginId) return propLoginId;
        return (
            localStorage.getItem('active_loginid') ||
            localStorage.getItem('client.loginid') ||
            ''
        );
    });

    const [currentTheme, setCurrentTheme] = useState<'dark' | 'light'>(() => {
        if (propTheme) return propTheme;
        const stored = localStorage.getItem('theme');
        if (stored === 'light' || stored === 'dark') return stored;
        return document.body.classList.contains('theme--light') ? 'light' : 'dark';
    });

    // Live Server / GMT Time clock
    const [currentTime, setCurrentTime] = useState<string>(() => {
        const now = new Date();
        return `${String(now.getUTCHours()).padStart(2, '0')}:${String(now.getUTCMinutes()).padStart(2, '0')}:${String(now.getUTCSeconds()).padStart(2, '0')} GMT`;
    });

    useEffect(() => {
        const timer = setInterval(() => {
            const now = new Date();
            setCurrentTime(`${String(now.getUTCHours()).padStart(2, '0')}:${String(now.getUTCMinutes()).padStart(2, '0')}:${String(now.getUTCSeconds()).padStart(2, '0')} GMT`);
        }, 1000);
        return () => clearInterval(timer);
    }, []);

    // Sync state when props change
    useEffect(() => {
        if (propToken !== undefined) setCurrentToken(resolveToken(propToken, currentLoginId));
    }, [propToken, currentLoginId, resolveToken]);

    useEffect(() => {
        if (propLoginId !== undefined) {
            setCurrentLoginId(propLoginId);
            const resolved = resolveToken(propToken, propLoginId);
            if (resolved) setCurrentToken(resolved);
        }
    }, [propLoginId, propToken, resolveToken]);

    useEffect(() => {
        if (propTheme !== undefined) setCurrentTheme(propTheme);
    }, [propTheme]);

    // Track host application theme changes
    useEffect(() => {
        if (propTheme) return;

        const observer = new MutationObserver(() => {
            const isLight = document.body.classList.contains('theme--light');
            setCurrentTheme(isLight ? 'light' : 'dark');
        });

        observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });
        return () => observer.disconnect();
    }, [propTheme]);

    // Dynamic Account Switching listener: update iframe without hard page reloads
    useEffect(() => {
        const handleAccountUpdate = (e: Event) => {
            const customEvent = e as CustomEvent<{ loginid?: string; token?: string }>;
            const nextLoginId = customEvent.detail?.loginid || localStorage.getItem('active_loginid');
            const nextToken = resolveToken(customEvent.detail?.token, nextLoginId || undefined);

            if (nextLoginId && nextLoginId !== currentLoginId) {
                setIsLoading(true);
                setCurrentLoginId(nextLoginId);
            }
            if (nextToken && nextToken !== currentToken) {
                setCurrentToken(nextToken);
            }
        };

        window.addEventListener('account_switching_start', handleAccountUpdate);
        window.addEventListener('account_switched', handleAccountUpdate);
        window.addEventListener('storage', handleAccountUpdate);

        return () => {
            window.removeEventListener('account_switching_start', handleAccountUpdate);
            window.removeEventListener('account_switched', handleAccountUpdate);
            window.removeEventListener('storage', handleAccountUpdate);
        };
    }, [currentLoginId, currentToken, resolveToken]);

    // Build the query parameter URL for Embedded Mode
    const iframeSrc = useMemo(() => {
        try {
            const url = new URL(baseUrl);

            if (currentToken && !isInvalidBearerToken(currentToken)) {
                url.searchParams.set('token', currentToken);
                if (currentLoginId) {
                    url.searchParams.set('account', currentLoginId);
                }
            }

            url.searchParams.set('theme', currentTheme);

            if (isMobileApp) {
                url.searchParams.set('is_mobile_app', 'true');
            }

            return url.toString();
        } catch {
            return baseUrl;
        }
    }, [baseUrl, currentToken, currentLoginId, currentTheme, isMobileApp]);

    const handleIframeLoad = () => {
        setIsLoading(false);
        if (onIframeLoaded) onIframeLoaded();
    };

    const handleReload = () => {
        setIsLoading(true);
        setIframeKey(k => k + 1);
    };

    const toggleFullscreen = useCallback(() => {
        if (!containerRef.current) return;
        if (!document.fullscreenElement) {
            containerRef.current.requestFullscreen().then(() => setIsFullscreen(true)).catch(console.error);
        } else {
            document.exitFullscreen().then(() => setIsFullscreen(false)).catch(console.error);
        }
    }, []);

    const openInNewTab = () => {
        if (iframeSrc) {
            window.open(iframeSrc, '_blank', 'noopener,noreferrer');
        }
    };

    const handleInitiateLogin = () => {
        if (onLoginClick) {
            onLoginClick();
        } else {
            const redirectUri = window.location.origin;
            window.location.href = `https://oauth.deriv.com/oauth2/authorize?app_id=${encodeURIComponent(
                appId
            )}&l=en&brand=deriv&redirect_uri=${encodeURIComponent(redirectUri)}`;
        }
    };

    const isDemo = currentLoginId?.toUpperCase().startsWith('VR');

    return (
        <div
            ref={containerRef}
            className={classNames(
                'dtrader-container',
                `dtrader-container--${currentTheme}`,
                { 'dtrader-container--fullscreen': isFullscreen },
                className
            )}
            style={{ height }}
        >
            {/* Header Control Toolbar */}
            {showToolbar && (
                <div className='dtrader-container__toolbar'>
                    <div className='dtrader-container__brand'>
                        <div className='brand-icon'>
                            <svg width='18' height='18' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2.2'>
                                <path d='M3 3v18h18' />
                                <path d='M18.7 8l-5.1 5.2-2.8-2.7L7 14.3' />
                            </svg>
                        </div>
                        <span className='brand-title'>ProfHub DTrader</span>
                        {currentToken && currentLoginId && (
                            <div className={classNames('account-pill', { 'account-pill--demo': isDemo })}>
                                <span className='account-pill__dot' />
                                <span className='account-pill__id'>{currentLoginId}</span>
                                <span className='account-pill__badge'>{isDemo ? 'DEMO' : 'REAL'}</span>
                            </div>
                        )}
                    </div>

                    <div className='dtrader-container__actions'>
                        <div className='dtrader-time-badge' title='Live GMT Server Time'>
                            <span className='dtrader-time-badge__dot' />
                            <span className='dtrader-time-badge__label'>{currentTime}</span>
                        </div>

                        <button
                            type='button'
                            className='action-btn'
                            onClick={handleReload}
                            title='Reload Trading Terminal'
                        >
                            <svg width='15' height='15' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2'>
                                <path d='M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.19' />
                            </svg>
                            <span>Reload</span>
                        </button>

                        <button
                            type='button'
                            className='action-btn'
                            onClick={toggleFullscreen}
                            title='Toggle Fullscreen'
                        >
                            {isFullscreen ? (
                                <svg width='15' height='15' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2'>
                                    <path d='M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3' />
                                </svg>
                            ) : (
                                <svg width='15' height='15' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2'>
                                    <path d='M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3' />
                                </svg>
                            )}
                        </button>

                        <button
                            type='button'
                            className='action-btn'
                            onClick={openInNewTab}
                            title='Open in Standalone Tab'
                        >
                            <svg width='15' height='15' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2'>
                                <path d='M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6' />
                                <polyline points='15 3 21 3 21 9' />
                                <line x1='10' y1='14' x2='21' y2='3' />
                            </svg>
                        </button>
                    </div>
                </div>
            )}

            {/* Trading Stage */}
            <div className='dtrader-container__stage'>
                {/* 1. Unauthenticated Fallback State */}
                {!currentToken ? (
                    <div className='dtrader-fallback'>
                        <div className='dtrader-fallback__card'>
                            <div className='dtrader-fallback__icon-box'>
                                <svg width='36' height='36' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='1.8'>
                                    <rect x='3' y='11' width='18' height='11' rx='2' ry='2' />
                                    <path d='M7 11V7a5 5 0 0 1 10 0v4' />
                                </svg>
                            </div>
                            <h3>Authentication Required</h3>
                            <p>
                                Connect your Deriv account to launch the embedded <strong>ProfHub DTrader</strong> terminal with direct session authorization.
                            </p>
                            <button
                                type='button'
                                className='dtrader-fallback__btn'
                                onClick={handleInitiateLogin}
                            >
                                <svg width='18' height='18' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2'>
                                    <path d='M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4' />
                                    <polyline points='10 17 15 12 10 7' />
                                    <line x1='15' y1='12' x2='3' y2='12' />
                                </svg>
                                <span>Connect Deriv Account</span>
                            </button>
                        </div>
                    </div>
                ) : (
                    <>
                        {/* 2. Loading Skeleton & Glow Spinner */}
                        {isLoading && (
                            <div className='dtrader-loader'>
                                <div className='dtrader-loader__spinner'>
                                    <div className='spinner-ring' />
                                    <div className='spinner-core' />
                                </div>
                                <div className='dtrader-loader__info'>
                                    <span className='title'>Initializing ProfHub DTrader</span>
                                    <span className='subtitle'>
                                        Authorizing {currentLoginId ? `account ${currentLoginId}` : 'session'} and syncing market feeds...
                                    </span>
                                </div>
                                <div className='dtrader-loader__progress-bar'>
                                    <div className='indicator' />
                                </div>
                            </div>
                        )}

                        {/* 3. Embedded Trading Iframe (sandbox omitted to allow IndexedDB & Web Workers for market data) */}
                        <iframe
                            key={iframeKey}
                            ref={iframeRef}
                            src={iframeSrc}
                            title='ProfHub DTrader Embedded Terminal'
                            className={classNames('dtrader-container__iframe', {
                                'dtrader-container__iframe--visible': !isLoading,
                            })}
                            allow='clipboard-write; fullscreen; camera; geolocation; microphone; display-capture; autoplay; encrypted-media; web-share'
                            referrerPolicy='no-referrer-when-downgrade'
                            loading='eager'
                            onLoad={handleIframeLoad}
                        />
                    </>
                )}
            </div>
        </div>
    );
};

export default DTraderIframeContainer;
