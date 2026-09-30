import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import classNames from 'classnames';
import {
    getAccountsList,
    getActiveLoginId,
    getActiveToken,
    getLegacyDTraderToken,
    isInvalidBearerToken,
    isLegacyToken,
} from '@/utils/token-bridge';
import { ParentBridgeClient } from '../iframe-bridge';
import { generateOAuthURL } from '@/components/shared';
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
    appId = '121856',
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
    const [isIframeLoaded, setIsIframeLoaded] = useState<boolean>(false);
    const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
    const [iframeKey, setIframeKey] = useState<number>(0);

    // Robust token resolver checking all local storage sources for tokens (prioritizes clean legacy WebSocket tokens for DTrader)
    const resolveToken = useCallback((explicitToken?: string, loginid?: string) => {
        const targetId =
            loginid ||
            localStorage.getItem('active_loginid') ||
            localStorage.getItem('client.loginid') ||
            getActiveLoginId() ||
            '';

        // 1. Prefer explicit token ONLY if it is already a valid legacy token (not OAuth2 JWT)
        if (explicitToken && isLegacyToken(explicitToken)) return explicitToken;

        // 2. Look for isolated legacy Deriv token for DTrader (works directly on /websockets/v3)
        const legacy = getLegacyDTraderToken(targetId);
        if (legacy && isLegacyToken(legacy)) return legacy;

        const candidate =
            localStorage.getItem('legacy_dtrader_token') ||
            localStorage.getItem('token1') ||
            localStorage.getItem('active_token') ||
            localStorage.getItem('authToken') ||
            localStorage.getItem('token');
        if (candidate && isLegacyToken(candidate)) return candidate;

        const accounts = getAccountsList();
        if (targetId && accounts[targetId] && isLegacyToken(accounts[targetId])) {
            return accounts[targetId];
        }
        for (const k in accounts) {
            if (accounts[k] && isLegacyToken(accounts[k])) return accounts[k];
        }

        // 3. Fallback to explicitToken if provided (even if JWT or alternative)
        if (explicitToken && !isInvalidBearerToken(explicitToken)) return explicitToken;

        // 4. Fallback to activeToken
        const active = getActiveToken(targetId);
        if (active && !isInvalidBearerToken(active)) return active;

        return '';
    }, []);

    const [currentToken, setCurrentToken] = useState<string>(() => resolveToken(propToken, propLoginId));

    const [currentLoginId, setCurrentLoginId] = useState<string>(() => {
        if (propLoginId) return propLoginId;
        return (
            localStorage.getItem('active_loginid') ||
            localStorage.getItem('client.loginid') ||
            getActiveLoginId() ||
            Object.keys(getAccountsList())[0] ||
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

    // Build the query parameter URL for Embedded Mode with complete multi-account support
    const iframeSrc = useMemo(() => {
        try {
            const url = new URL(baseUrl);

            // 1. Resolve active account and its token
            const activeId =
                currentLoginId ||
                localStorage.getItem('active_loginid') ||
                localStorage.getItem('client.loginid') ||
                getActiveLoginId() ||
                '';

            const activeToken = resolveToken(currentToken, activeId);

            // 2. Resolve client accounts list with currencies
            let clientAccounts: Record<string, { token?: string; currency?: string }> = {};
            try {
                const stored = localStorage.getItem('client.accounts') || localStorage.getItem('clientAccounts');
                if (stored) clientAccounts = JSON.parse(stored);
            } catch {}

            const rawAccountsList = getAccountsList();

            // If we have an active token and account, build full Deriv multi-account query string
            if (activeId && activeToken && !isInvalidBearerToken(activeToken)) {
                // Set active account as acct1 / token1 / cur1
                url.searchParams.set('acct1', activeId);
                url.searchParams.set('token1', activeToken);
                const activeCur = clientAccounts[activeId]?.currency || localStorage.getItem('client.currency') || 'USD';
                url.searchParams.set('cur1', activeCur);

                // Add all other accounts so DTrader's account switcher and balance updates work seamlessly
                let index = 2;
                const allAccountIds = Array.from(
                    new Set<string>([...Object.keys(clientAccounts), ...Object.keys(rawAccountsList)])
                );

                allAccountIds.forEach(accId => {
                    if (accId === activeId) return; // already acct1
                    const accToken =
                        clientAccounts[accId]?.token && isLegacyToken(clientAccounts[accId]?.token)
                            ? clientAccounts[accId].token
                            : rawAccountsList[accId] && isLegacyToken(rawAccountsList[accId])
                              ? rawAccountsList[accId]
                              : '';
                    if (accToken && !isInvalidBearerToken(accToken)) {
                        url.searchParams.set(`acct${index}`, accId);
                        url.searchParams.set(`token${index}`, accToken);
                        url.searchParams.set(`cur${index}`, clientAccounts[accId]?.currency || 'USD');
                        index++;
                    }
                });

                // Supply standard single-parameter aliases for embeds
                url.searchParams.set('token', activeToken);
                url.searchParams.set('access_token', activeToken);
                url.searchParams.set('account', activeId);
                url.searchParams.set('loginid', activeId);
                url.searchParams.set('currency', activeCur);
                url.searchParams.set('is_embedded', 'true');
            }

            // Set app_id matching parent application
            const effectiveAppId = appId || '121856';
            url.searchParams.set('app_id', String(effectiveAppId));
            url.searchParams.set('theme', currentTheme);

            if (isMobileApp) {
                url.searchParams.set('is_mobile_app', 'true');
            }

            return url.toString();
        } catch {
            return baseUrl;
        }
    }, [baseUrl, currentToken, currentLoginId, currentTheme, isMobileApp, appId, resolveToken]);

    // Safety fallback timeout: ensure loading overlay clears quickly
    useEffect(() => {
        const timer = setTimeout(() => {
            setIsLoading(false);
            setIsIframeLoaded(true);
        }, 1200);
        return () => clearTimeout(timer);
    }, [iframeKey, iframeSrc]);

    // Attach ParentBridgeClient to handle postMessage auth handshakes
    // CRITICAL: Only attach AFTER the iframe has completed its load event (onLoad)
    // to prevent origin mismatch DOMExceptions before the remote document loads!
    useEffect(() => {
        if (!isIframeLoaded) return;
        const iframe = iframeRef.current;
        if (!iframe || !iframeSrc) return;

        let bridge: ParentBridgeClient | null = null;
        try {
            bridge = new ParentBridgeClient();
            bridge.attach(iframe, new URL(baseUrl).origin);
        } catch (e) {
            console.warn('[DTraderIframeContainer] Bridge attach warning:', e);
        }

        return () => {
            if (bridge) {
                try {
                    bridge.detach();
                } catch {}
            }
        };
    }, [baseUrl, iframeKey, iframeSrc, isIframeLoaded]);

    const handleIframeLoad = () => {
        setIsLoading(false);
        setIsIframeLoaded(true);
        if (onIframeLoaded) onIframeLoaded();
    };

    const handleReload = () => {
        setIsLoading(true);
        setIsIframeLoaded(false);
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

    const handleInitiateLogin = async () => {
        if (onLoginClick) {
            onLoginClick();
        } else {
            try {
                const url = await generateOAuthURL();
                if (url) {
                    window.location.assign(url);
                    return;
                }
            } catch (err) {
                console.error('[DTrader] Failed to generate OAuth URL:', err);
            }
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
                    </div>
                </div>
            )}

            {/* Trading Stage */}
            <div className='dtrader-container__stage'>
                {/* 1. Loading Skeleton & Glow Spinner */}
                {isLoading && (
                    <div className='dtrader-loader'>
                        <div className='dtrader-loader__spinner'>
                            <div className='spinner-ring' />
                            <div className='spinner-core' />
                        </div>
                        <div className='dtrader-loader__info'>
                            <span className='title'>Opening DTrader</span>
                            <span className='subtitle'>
                                {currentLoginId ? `Connecting account ${currentLoginId} & charts...` : 'Connecting live trading terminal & charts...'}
                            </span>
                        </div>
                        <div className='dtrader-loader__progress-bar'>
                            <div className='indicator' />
                        </div>
                    </div>
                )}

                {/* 2. Embedded Trading Iframe (sandbox omitted to allow IndexedDB & Web Workers for market data) */}
                <iframe
                    key={iframeKey}
                    ref={iframeRef}
                    src={iframeSrc}
                    title='DTrader Embedded Terminal'
                    className={classNames('dtrader-container__iframe', {
                        'dtrader-container__iframe--visible': !isLoading,
                    })}
                    allow='clipboard-write; fullscreen; camera; geolocation; microphone; display-capture; autoplay; encrypted-media; web-share'
                    referrerPolicy='no-referrer-when-downgrade'
                    loading='eager'
                    onLoad={handleIframeLoad}
                />
            </div>
        </div>
    );
};

export default DTraderIframeContainer;
