import React, { useEffect, useRef, useState } from 'react';
import { observer } from 'mobx-react-lite';
import './iframe-wrapper.scss';
import { useStore } from '@/hooks/useStore';
import { contract_stages } from '@/constants/contract-stage';
import { ParentBridgeClient } from '../iframe-bridge';
import { STORAGE_KEYS, getLegacyDTraderToken } from '@/utils/token-bridge';
import { DERIV_CONFIG } from '@/components/shared/utils/config/config';

interface IframeWrapperProps {
    src: string;
    title: string;
    className?: string;
}

/**
 * IframeWrapper — generic iframe container for embedded tools.
 *
 * For DTrader Terminal: Attaches ParentBridgeClient to manage postMessage bridge
 * handshakes, passing accountType: "ZOOM", loginId, currency, appId, symbol, etc.
 *
 * For third-party bots: Listens for TRADE_PLACED / CONTRACT_EVENT / CONTRACT_UPDATE
 * and forwards them to the MobX run-panel / transactions store.
 */
const IframeWrapper: React.FC<IframeWrapperProps> = observer(({ src, title, className = '' }) => {
    const iframeRef = useRef<HTMLIFrameElement>(null);
    const [hasError, setHasError] = useState(false);
    const [isLoading, setIsLoading] = useState(true);
    const { transactions, run_panel, client } = useStore();

    useEffect(() => {
        const iframe = iframeRef.current;
        if (!iframe) return;

        const iframeOrigin = (() => {
            try {
                return new URL(src).origin;
            } catch {
                return '*';
            }
        })();

        const allowedOrigins = [
            iframeOrigin,
            'https://deriv-dtrader.vercel.app',
            'https://www.derivcircles.com',
            'https://bot-analysis-tool-belex.web.app',
            'https://analysisprofithub.vercel.app',
            'https://www.smartanalysistool.com',
            'https://dcircles.netlify.app',
            'https://dcircles-six.vercel.app',
            'https://xenontool.netlify.app',
            window.location.origin,
        ];

        // For DTrader Terminal, attach ParentBridgeClient which handles all auth handshakes
        if (title === 'DTrader Terminal') {
            const bridge = new ParentBridgeClient();
            bridge.attach(iframe, iframeOrigin);

            const handleLoad = () => {
                setIsLoading(false);
                setHasError(false);
            };
            const handleError = () => {
                setIsLoading(false);
                setHasError(true);
            };
            const loadTimeout = setTimeout(() => setIsLoading(false), 10000);

            iframe.addEventListener('load', handleLoad);
            iframe.addEventListener('error', handleError);

            return () => {
                iframe.removeEventListener('load', handleLoad);
                iframe.removeEventListener('error', handleError);
                bridge.detach();
                clearTimeout(loadTimeout);
            };
        }

        // Third-party bot event handling (Hyperbot, Diffbot, etc.)
        const handleMessage = (event: MessageEvent) => {
            const isAllowed =
                allowedOrigins.includes(event.origin) || /^http:\/\/localhost(:\d+)?$/i.test(event.origin);
            if (!isAllowed) return;
            if (!event.data) return;

            if (event.data.type === 'TRADE_PLACED' || event.data.type === 'CONTRACT_EVENT') {
                const tradeData = event.data;

                if (run_panel && !run_panel.run_id) {
                    const botName = title.toLowerCase().replace(/\s+/g, '');
                    run_panel.run_id = `${botName}-${Date.now()}`;
                    run_panel.setIsRunning(true);
                    run_panel.setContractStage(contract_stages.STARTING);
                }

                if (transactions?.onBotContractEvent && tradeData.contract_id) {
                    try {
                        const contractData = {
                            contract_id: tradeData.contract_id,
                            transaction_ids: tradeData.transaction_ids || {
                                buy: tradeData.transaction_id || tradeData.buy_transaction_id,
                                sell: tradeData.sell_transaction_id || tradeData.transaction_ids?.sell,
                            },
                            buy_price:
                                tradeData.buy_price || tradeData.price || tradeData.stake || tradeData.amount || 0,
                            currency: tradeData.currency || client?.currency || 'USD',
                            contract_type:
                                tradeData.contract_type ||
                                (title.toLowerCase().includes('matches')
                                    ? 'DIGITMATCH'
                                    : title.toLowerCase().includes('diffbot')
                                      ? 'DIGITDIFF'
                                      : 'DIGITUNDER'),
                            underlying: tradeData.underlying || tradeData.symbol || '',
                            display_name: tradeData.display_name || tradeData.underlying || tradeData.symbol || '',
                            date_start: tradeData.date_start || Math.floor(Date.now() / 1000),
                            status: tradeData.status || 'open',
                            entry_tick_display_value:
                                tradeData.entry_tick_display_value ||
                                tradeData.entry_spot_display_value ||
                                tradeData.entry_tick ||
                                tradeData.entry_spot,
                            exit_tick_display_value:
                                tradeData.exit_tick_display_value ||
                                tradeData.exit_spot_display_value ||
                                tradeData.exit_tick ||
                                tradeData.exit_spot,
                            entry_tick_time: tradeData.entry_tick_time || tradeData.entry_spot_time,
                            exit_tick_time: tradeData.exit_tick_time || tradeData.exit_spot_time,
                            profit: tradeData.profit ?? tradeData.margin ?? tradeData.payout ?? undefined,
                            sell_price: tradeData.sell_price || tradeData.bid_price,
                            bid_price: tradeData.bid_price || tradeData.sell_price,
                            is_expired: tradeData.is_expired,
                            is_settleable: tradeData.is_settleable,
                            is_valid_to_sell: tradeData.is_valid_to_sell,
                            is_sold: tradeData.is_sold,
                        };
                        transactions.onBotContractEvent(contractData);
                        if (run_panel) {
                            run_panel.setHasOpenContract(true);
                            run_panel.setContractStage(contract_stages.PURCHASE_SENT);
                            if (!run_panel.is_drawer_open) run_panel.toggleDrawer(true);
                            run_panel.setActiveTabIndex(1);
                        }
                    } catch (error) {
                        console.error(`[IframeWrapper] Error forwarding trade to Run Panel:`, error);
                    }
                }
                return;
            }

            if (event.data.type === 'CONTRACT_UPDATE') {
                if (event.data.contract_id && transactions?.onBotContractEvent) {
                    transactions.onBotContractEvent(event.data);
                }
                return;
            }
        };

        window.addEventListener('message', handleMessage);

        const handleLoad = () => {
            setIsLoading(false);
            setHasError(false);
        };
        const handleError = () => {
            setIsLoading(false);
            setHasError(true);
        };
        const loadTimeout = setTimeout(() => setIsLoading(false), 10000);

        iframe.addEventListener('load', handleLoad);
        iframe.addEventListener('error', handleError);

        return () => {
            iframe.removeEventListener('load', handleLoad);
            iframe.removeEventListener('error', handleError);
            window.removeEventListener('message', handleMessage);
            clearTimeout(loadTimeout);
        };
    }, [src, title, client?.loginid, client?.currency]);

    return (
        <div className={`iframe-wrapper ${className}`} style={{ pointerEvents: 'auto', position: 'relative' }}>
            {isLoading && !hasError && (
                <div
                    style={{
                        position: 'absolute',
                        top: '50%',
                        left: '50%',
                        transform: 'translate(-50%, -50%)',
                        color: 'var(--text-prominent)',
                        fontSize: '1.4rem',
                        zIndex: 100,
                        pointerEvents: 'none',
                        userSelect: 'none',
                    }}
                >
                    Loading {title}...
                </div>
            )}
            {hasError && (
                <div
                    style={{
                        position: 'absolute',
                        top: '50%',
                        left: '50%',
                        transform: 'translate(-50%, -50%)',
                        color: 'var(--text-prominent)',
                        fontSize: '1.4rem',
                        textAlign: 'center',
                        padding: '2rem',
                        zIndex: 1000,
                        backgroundColor: 'var(--general-main-1)',
                        borderRadius: '0.8rem',
                        boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
                    }}
                >
                    <p style={{ fontWeight: 'bold', marginBottom: '1rem' }}>Failed to load {title}</p>
                    <p
                        style={{
                            fontSize: '1rem',
                            marginTop: '1rem',
                            color: 'var(--text-less-prominent)',
                            marginBottom: '1.5rem',
                        }}
                    >
                        The external site may be blocking iframe embedding.
                    </p>
                    <a
                        href={src}
                        target='_blank'
                        rel='noopener noreferrer'
                        style={{
                            display: 'inline-block',
                            padding: '0.8rem 1.6rem',
                            backgroundColor: 'var(--button-primary-default)',
                            color: 'white',
                            textDecoration: 'none',
                            borderRadius: '0.4rem',
                            fontSize: '1.2rem',
                            marginTop: '1rem',
                        }}
                    >
                        Open in New Tab
                    </a>
                </div>
            )}
            <iframe
                ref={iframeRef}
                src={src}
                title={title}
                className='iframe-wrapper__frame'
                frameBorder='0'
                allowFullScreen
                loading='eager'
                allow='accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen; display-capture'
                sandbox='allow-scripts allow-same-origin allow-forms allow-popups allow-modals allow-downloads'
                referrerPolicy='no-referrer-when-downgrade'
                style={{
                    display: 'block',
                    width: '100%',
                    height: '100%',
                    minHeight: '100%',
                    opacity: hasError ? 0 : 1,
                    transition: 'opacity 0.3s',
                    border: 'none',
                    background: 'transparent',
                    visibility: hasError ? 'hidden' : 'visible',
                    pointerEvents: hasError ? 'none' : 'auto',
                    zIndex: 10,
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    right: 0,
                    bottom: 0,
                }}
                onLoad={() => setIsLoading(false)}
            />
        </div>
    );
});

export const DTraderIframe: React.FC = () => {
    const iframeRef = useRef<HTMLIFrameElement>(null);
    const intervalRef = useRef<any>(null);

    const startAuthBridgeHandshake = () => {
        const iframeWindow = iframeRef.current?.contentWindow;
        if (!iframeWindow) return;

        // Both apps read the same credentials:
        const clientAccounts = localStorage.getItem('client.accounts');
        const activeLoginId = localStorage.getItem('active_loginid');

        let accountsObj: Record<string, any> = {};
        try {
            if (clientAccounts) {
                accountsObj = JSON.parse(clientAccounts);
            }
        } catch {}

        const activeAccount = (activeLoginId && accountsObj[activeLoginId]) ? accountsObj[activeLoginId] : {};
        const legacyToken = activeAccount.token || getLegacyDTraderToken() || localStorage.getItem('token1') || '';
        const legacyAccount = activeLoginId || activeAccount.loginid || localStorage.getItem('legacy_acct1') || localStorage.getItem('acct1') || '';
        const currency = activeAccount.currency || 'USD';
        const effectiveToken = legacyToken && !legacyToken.startsWith('ey') ? legacyToken : (activeAccount.token || '');

        const payload = {
            type: 'NEWDTRADER_BRIDGE_AUTH',
            msg_type: 'authorization',
            token: effectiveToken,
            accountName: legacyAccount,
            appId: '121856',
            currency,
            'client.accounts': clientAccounts,
            active_loginid: activeLoginId,
            accounts: accountsObj,
        };

        const fallbackPayload = {
            action: 'authorize',
            token: effectiveToken,
            loginid: legacyAccount,
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

        // Clear any existing handshake loop
        if (intervalRef.current) clearInterval(intervalRef.current);

        const postToIframe = () => {
            try {
                iframeWindow.postMessage(payload, 'https://deriv-dtrader.vercel.app');
                iframeWindow.postMessage(fallbackPayload, 'https://deriv-dtrader.vercel.app');
                iframeWindow.postMessage(syncPayload, 'https://deriv-dtrader.vercel.app');
                iframeWindow.postMessage(JSON.stringify(syncPayload), 'https://deriv-dtrader.vercel.app');
            } catch (e) {
                // ignore
            }
        };

        // 1. Send immediate message
        postToIframe();

        // 2. Poll every 300ms until DTrader's bridge-client acknowledges receiving it
        intervalRef.current = setInterval(() => {
            postToIframe();
        }, 300);

        // Safety fallback: stop polling after 6 seconds
        setTimeout(() => {
            if (intervalRef.current) {
                clearInterval(intervalRef.current);
                intervalRef.current = null;
            }
        }, 6000);
    };

    useEffect(() => {
        const handleBridgeAck = (event: MessageEvent) => {
            if (event.origin !== 'https://deriv-dtrader.vercel.app') return;

            // Handle credential requests from DTrader iframe
            if (
                event.data?.type === 'GET_CREDENTIALS' ||
                event.data?.type === 'REQUEST_CREDENTIALS' ||
                event.data?.type === 'IFRAME_READY' ||
                event.data?.action === 'REQUEST_CREDENTIALS'
            ) {
                startAuthBridgeHandshake();
                return;
            }

            // Stop handshake interval upon successful handshake or failure response
            if (
                event.data?.type === 'NEWDTRADER_BRIDGE_AUTH_SUCCESS' ||
                event.data?.type === 'NEWDTRADER_BRIDGE_AUTH_FAILED' ||
                event.data?.msg_type === 'authorize'
            ) {
                console.log('[ParentBridge] Handshake acknowledged by DTrader V2RootGate.');
                if (intervalRef.current) {
                    clearInterval(intervalRef.current);
                    intervalRef.current = null;
                }
            }

            if (event.data?.error?.code === 'InvalidToken') {
                window.dispatchEvent(new CustomEvent('dtrader_session_expired'));
            }
        };

        window.addEventListener('message', handleBridgeAck);
        return () => {
            window.removeEventListener('message', handleBridgeAck);
            if (intervalRef.current) {
                clearInterval(intervalRef.current);
                intervalRef.current = null;
            }
        };
    }, []);

    const iframeSrc = React.useMemo(() => {
        const clientAccounts = localStorage.getItem('client.accounts');
        const activeLoginId = localStorage.getItem('active_loginid');
        let token = '';
        let cur = 'USD';
        if (clientAccounts && activeLoginId) {
            try {
                const parsed = JSON.parse(clientAccounts);
                if (parsed[activeLoginId]) {
                    token = parsed[activeLoginId].token || '';
                    cur = parsed[activeLoginId].currency || 'USD';
                }
            } catch {}
        }
        if (!token) {
            token = getLegacyDTraderToken() || localStorage.getItem('token1') || '';
        }
        const baseUrl = 'https://deriv-dtrader.vercel.app/?app_id=121856';
        if (activeLoginId && token && !token.startsWith('ey')) {
            return `${baseUrl}&acct1=${encodeURIComponent(activeLoginId)}&token1=${encodeURIComponent(token)}&cur1=${encodeURIComponent(cur)}`;
        }
        return baseUrl;
    }, []);

    return (
        <iframe
            ref={iframeRef}
            src={iframeSrc}
            onLoad={startAuthBridgeHandshake}
            className="w-full h-full border-none"
            allow="clipboard-write"
        />
    );
};

export default IframeWrapper;
