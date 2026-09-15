import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { observer } from 'mobx-react-lite';
import { useStore } from '@/hooks/useStore';
import { useApiBase } from '@/hooks/useApiBase';
import { getAccountsList, getActiveLoginId, getActiveToken, getLegacyDTraderToken, isInvalidBearerToken, isLegacyToken } from '@/utils/token-bridge';
import { getAppId } from '@/components/shared/utils/config/config';
import './dtrader.scss';

const DTRADER_BASE_URL = 'https://deriv-dtrader.vercel.app';

export const DTrader: React.FC = observer(() => {
    const { client } = useStore();
    const { activeLoginid, isVirtual } = useApiBase();
    const iframeRef = useRef<HTMLIFrameElement>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [hasError, setHasError] = useState(false);
    const [isFullscreen, setIsFullscreen] = useState(false);
    const [reloadKey, setReloadKey] = useState(0);
    const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

    // Current active login ID & account details
    const currentActiveLoginId =
        activeLoginid ||
        client?.loginid ||
        getActiveLoginId() ||
        localStorage.getItem('active_loginid') ||
        '';

    const isDemo =
        isVirtual ||
        client?.is_virtual ||
        currentActiveLoginId.startsWith('VR') ||
        currentActiveLoginId.startsWith('DOT') ||
        currentActiveLoginId.startsWith('DEM');

    const activeCurrency =
        client?.currency ||
        localStorage.getItem('client.currency') ||
        'USD';

    // Construct the fully authenticated DTrader URL with active session parameters
    const dtraderUrl = useMemo(() => {
        const accounts = getAccountsList();
        const rawClientAccounts = localStorage.getItem('client.accounts');
        let parsedClientAccounts: Record<string, any> = {};
        try {
            if (rawClientAccounts) {
                parsedClientAccounts = JSON.parse(rawClientAccounts);
            }
        } catch {}

        const activeId = currentActiveLoginId || Object.keys(accounts)[0] || '';
        
        // Find valid legacy token for active account (never pass OAuth JWT to DTrader URL)
        let activeToken = getLegacyDTraderToken(activeId);
        if (!activeToken && accounts[activeId] && isLegacyToken(accounts[activeId])) {
            activeToken = accounts[activeId];
        }
        if (!activeToken && client?.token && isLegacyToken(client?.token)) {
            activeToken = client?.token;
        }

        const appId = '121856'; // DTrader Vercel App ID

        const params = new URLSearchParams();
        params.set('app_id', String(appId));

        let index = 1;
        // Set active account as primary acct1/token1/cur1
        if (activeId) {
            params.set(`acct${index}`, activeId);
            if (activeToken) {
                params.set(`token${index}`, activeToken);
            }
            params.set(`cur${index}`, activeCurrency);
            index++;
        }

        // Add remaining accounts with legacy tokens only
        for (const [id, tok] of Object.entries(accounts)) {
            if (id !== activeId && tok && isLegacyToken(tok)) {
                const cur = parsedClientAccounts[id]?.currency || 'USD';
                params.set(`acct${index}`, id);
                params.set(`token${index}`, tok);
                params.set(`cur${index}`, cur);
                index++;
            }
        }

        return `${DTRADER_BASE_URL}/?${params.toString()}`;
    }, [currentActiveLoginId, client?.token, activeCurrency, reloadKey]);

    // Send complete authentication and credential payloads to DTrader iframe
    const sendAuthBridgeHandshake = useCallback(() => {
        const iframeWindow = iframeRef.current?.contentWindow;
        if (!iframeWindow) return;

        const clientAccounts = localStorage.getItem('client.accounts');
        const activeLoginId = currentActiveLoginId || localStorage.getItem('active_loginid') || '';

        let accountsObj: Record<string, any> = {};
        try {
            if (clientAccounts) {
                accountsObj = JSON.parse(clientAccounts);
            }
        } catch {}

        const activeAccount = (activeLoginId && accountsObj[activeLoginId]) ? accountsObj[activeLoginId] : {};
        const legacyToken = activeAccount.token || getLegacyDTraderToken(activeLoginId) || localStorage.getItem('token1') || '';
        const effectiveToken = legacyToken || activeAccount.token || client?.token || getActiveToken(activeLoginId) || '';
        const appIdStr = '121856';

        const payload = {
            type: 'NEWDTRADER_BRIDGE_AUTH',
            msg_type: 'authorization',
            token: effectiveToken,
            accountName: activeLoginId,
            appId: appIdStr,
            currency: activeCurrency,
            'client.accounts': clientAccounts,
            active_loginid: activeLoginId,
            accounts: accountsObj,
        };

        const fallbackPayload = {
            action: 'authorize',
            token: effectiveToken,
            loginid: activeLoginId,
            'client.accounts': clientAccounts,
            active_loginid: activeLoginId,
        };

        const syncPayload = {
            type: 'SYNC_CREDENTIALS',
            action: 'SYNC_CREDENTIALS',
            'client.accounts': clientAccounts,
            active_loginid: activeLoginId,
            clientAccounts,
            activeLoginId,
            accounts: accountsObj,
        };

        const v2AuthMsg = {
            type: 'deriv:dtrader:auth',
            version: 'v2',
            auth: {
                access_token: effectiveToken,
                token_type: 'Bearer',
                expires_at: Date.now() + 86400000,
            },
            activeAccountId: activeLoginId,
            currency: activeCurrency,
            clientId: appIdStr,
        };

        const postToIframe = () => {
            try {
                iframeWindow.postMessage(payload, DTRADER_BASE_URL);
                iframeWindow.postMessage(fallbackPayload, DTRADER_BASE_URL);
                iframeWindow.postMessage(syncPayload, DTRADER_BASE_URL);
                iframeWindow.postMessage(v2AuthMsg, DTRADER_BASE_URL);
                iframeWindow.postMessage(JSON.stringify(syncPayload), DTRADER_BASE_URL);
            } catch (e) {
                // ignore
            }
        };

        // 1. Post immediately
        postToIframe();

        // 2. Poll for 5 seconds to ensure the iframe handles initial script loading
        if (intervalRef.current) clearInterval(intervalRef.current);
        intervalRef.current = setInterval(() => {
            postToIframe();
        }, 300);

        setTimeout(() => {
            if (intervalRef.current) {
                clearInterval(intervalRef.current);
                intervalRef.current = null;
            }
        }, 5000);
    }, [currentActiveLoginId, client?.token, activeCurrency]);

    // Handle postMessage events from DTrader iframe
    useEffect(() => {
        const handleMessage = (event: MessageEvent) => {
            if (event.origin !== DTRADER_BASE_URL) return;

            const data = event.data;
            if (!data) return;

            // Handle credential requests from DTrader iframe
            if (
                data.type === 'GET_CREDENTIALS' ||
                data.type === 'REQUEST_CREDENTIALS' ||
                data.type === 'IFRAME_READY' ||
                data.type === 'REQUEST_TOKEN' ||
                data.action === 'REQUEST_CREDENTIALS'
            ) {
                sendAuthBridgeHandshake();
                return;
            }

            // Acknowledge successful auth
            if (
                data.type === 'NEWDTRADER_BRIDGE_AUTH_SUCCESS' ||
                data.type === 'AUTH_SUCCESS' ||
                data.msg_type === 'authorize'
            ) {
                setIsLoading(false);
                setHasError(false);
                if (intervalRef.current) {
                    clearInterval(intervalRef.current);
                    intervalRef.current = null;
                }
            }
        };

        window.addEventListener('message', handleMessage);
        return () => {
            window.removeEventListener('message', handleMessage);
            if (intervalRef.current) {
                clearInterval(intervalRef.current);
                intervalRef.current = null;
            }
        };
    }, [sendAuthBridgeHandshake]);

    // Listen to global account switch events to refresh iframe
    useEffect(() => {
        const handleAccountSwitched = () => {
            setIsLoading(true);
            setReloadKey(prev => prev + 1);
        };

        window.addEventListener('account_switched', handleAccountSwitched);
        return () => window.removeEventListener('account_switched', handleAccountSwitched);
    }, []);

    const handleIframeLoad = () => {
        setIsLoading(false);
        setHasError(false);
        sendAuthBridgeHandshake();
    };

    const handleIframeError = () => {
        setIsLoading(false);
        setHasError(true);
    };

    const handleReload = () => {
        setIsLoading(true);
        setHasError(false);
        setReloadKey(prev => prev + 1);
    };

    const toggleFullscreen = () => {
        setIsFullscreen(prev => !prev);
    };

    return (
        <div className={`dtrader-workstation ${isFullscreen ? 'dtrader-workstation--fullscreen' : ''}`}>
            {/* Workstation Top Toolbar */}
            <div className='dtrader-workstation__toolbar'>
                <div className='dtrader-workstation__brand'>
                    <div className='brand-logo'>
                        <svg width='20' height='20' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2.2' strokeLinecap='round' strokeLinejoin='round'>
                            <path d='M3 3v18h18' />
                            <path d='M18 9l-5 5-4-4-6 6' />
                        </svg>
                    </div>
                    <div className='brand-text'>
                        <span className='title'>DTrader Terminal</span>
                        <span className='subtitle'>Institutional Deriv Execution</span>
                    </div>
                </div>

                <div className='dtrader-workstation__controls'>
                    {/* Active Account Pill */}
                    <div className={`dtrader-workstation__account-badge ${isDemo ? 'dtrader-workstation__account-badge--demo' : 'dtrader-workstation__account-badge--real'}`}>
                        <span className='account-type-pill'>{isDemo ? 'Demo' : 'Real'}</span>
                        <span className='account-id'>{currentActiveLoginId || 'Not Logged In'}</span>
                        <span className='account-cur'>({activeCurrency})</span>
                    </div>

                    {/* Live Status Badge */}
                    <div className='dtrader-workstation__status-badge'>
                        <span className='pulse-dot' />
                        <span>Live Session</span>
                    </div>

                    {/* Reload Button */}
                    <button
                        type='button'
                        className='dtrader-workstation__action-btn'
                        onClick={handleReload}
                        title='Reload DTrader Terminal'
                    >
                        <svg width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2' strokeLinecap='round' strokeLinejoin='round'>
                            <path d='M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67' />
                        </svg>
                        <span>Reload</span>
                    </button>

                    {/* Fullscreen Toggle */}
                    <button
                        type='button'
                        className='dtrader-workstation__action-btn'
                        onClick={toggleFullscreen}
                        title={isFullscreen ? 'Exit Fullscreen' : 'Fullscreen Workstation'}
                    >
                        {isFullscreen ? (
                            <>
                                <svg width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2' strokeLinecap='round' strokeLinejoin='round'>
                                    <path d='M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3' />
                                </svg>
                                <span>Exit</span>
                            </>
                        ) : (
                            <>
                                <svg width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2' strokeLinecap='round' strokeLinejoin='round'>
                                    <path d='M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3' />
                                </svg>
                                <span>Fullscreen</span>
                            </>
                        )}
                    </button>

                    {/* Popout Button */}
                    <a
                        href={dtraderUrl}
                        target='_blank'
                        rel='noopener noreferrer'
                        className='dtrader-workstation__action-btn'
                        title='Open DTrader in New Window'
                    >
                        <svg width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2' strokeLinecap='round' strokeLinejoin='round'>
                            <path d='M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6' />
                            <polyline points='15 3 21 3 21 9' />
                            <line x1='10' y1='14' x2='21' y2='3' />
                        </svg>
                        <span>Popout</span>
                    </a>
                </div>
            </div>

            {/* Embedded DTrader Iframe Container */}
            <div className='dtrader-workstation__iframe-container'>
                {isLoading && !hasError && (
                    <div className='loading-overlay'>
                        <div className='spinner-ring' />
                        <span className='loading-text'>Connecting DTrader Terminal...</span>
                        <span className='loading-subtext'>Synchronizing session ({currentActiveLoginId || 'Active Account'})</span>
                    </div>
                )}

                {hasError && (
                    <div className='error-overlay'>
                        <div className='error-card'>
                            <h3>Connection Notice</h3>
                            <p>Unable to embed DTrader directly. Click below to reload or open the authenticated terminal in a dedicated tab.</p>
                            <div className='error-actions'>
                                <button type='button' className='dtrader-workstation__action-btn' onClick={handleReload}>
                                    Retry Connection
                                </button>
                                <a href={dtraderUrl} target='_blank' rel='noopener noreferrer' className='dtrader-workstation__action-btn'>
                                    Open in New Tab
                                </a>
                            </div>
                        </div>
                    </div>
                )}

                <iframe
                    key={reloadKey}
                    ref={iframeRef}
                    src={dtraderUrl}
                    title='Deriv DTrader'
                    allow='accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen; display-capture'
                    sandbox='allow-scripts allow-same-origin allow-forms allow-popups allow-modals allow-downloads'
                    referrerPolicy='no-referrer-when-downgrade'
                    onLoad={handleIframeLoad}
                    onError={handleIframeError}
                />
            </div>
        </div>
    );
});

export default DTrader;
