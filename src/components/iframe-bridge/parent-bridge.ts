import { BridgeStateMachine, BridgeState } from './bridge-state-machine';
import { SessionManager as _SessionManager, sessionManager } from './session-manager';
import { BridgeEvent, BridgeMessage, createMessage, isValidBridgeMessage } from './protocol';
import { secureSessionService } from '@/services/secure-session.service';
import { getAppId } from '@/components/shared/utils/config/config';
import { makeBridgeLogger, generateInstanceId } from './bridge-diagnostics';
import { getAccountsList, getActiveToken, getLegacyDTraderToken, resolveValidDerivWSToken } from '@/utils/token-bridge';

export interface BridgeDiagnosticInfo {
    state: BridgeState;
    appId: string;
    parentOrigin: string;
    iframeOrigin: string;
    sessionStatus: 'valid' | 'invalid' | 'none';
    lastEvent: BridgeEvent | string | null;
    lastError: string | null;
    reconnects: number;
    pendingMessages: number;
    messageHistory: Array<{ direction: 'in' | 'out'; msg: BridgeMessage; time: Date }>;
}

export class ParentBridgeClient {
    public stateMachine: BridgeStateMachine;
    private iframeWindow: Window | null = null;
    private iframeOrigin: string = '*';
    private reconnectAttempts: number = 0;
    private maxReconnects: number = 5;
    private instanceId: string;
    private logger: ReturnType<typeof makeBridgeLogger>;
    private retryIntervalId: any = null;

    // Diagnostics
    private diagnostics: BridgeDiagnosticInfo = {
        state: BridgeState.IDLE,
        appId: getAppId() || '121856',
        parentOrigin: typeof window !== 'undefined' ? window.location.origin : 'unknown',
        iframeOrigin: 'unknown',
        sessionStatus: 'none',
        lastEvent: null,
        lastError: null,
        reconnects: 0,
        pendingMessages: 0,
        messageHistory: [],
    };

    private listeners: Set<() => void> = new Set();
    private sessionUnsubscribe: (() => void) | null = null;
    private activeTimeouts: Set<any> = new Set();

    private safeTimeout(fn: () => void, delay: number) {
        const id = setTimeout(() => {
            this.activeTimeouts.delete(id);
            if (!this.iframeWindow) return;
            fn();
        }, delay);
        this.activeTimeouts.add(id);
        return id;
    }

    constructor() {
        this.stateMachine = new BridgeStateMachine(BridgeState.IDLE);
        this.diagnostics.state = this.stateMachine.getState();
        this.instanceId = generateInstanceId();
        this.logger = makeBridgeLogger(this.instanceId);
        this.logger.debug('BRIDGE_INIT', {
            appId: this.diagnostics.appId,
            parentOrigin: this.diagnostics.parentOrigin,
        });

        this.stateMachine.subscribe(state => {
            const previous = this.diagnostics.state;
            this.diagnostics.state = state;
            this.logger.stateChange(previous, state as string, 'stateMachine.subscribe');
            this.notifyDiagnosticListeners();
        });

        if (typeof window !== 'undefined') {
            window.addEventListener('message', this.handleMessage);
        }
    }

    public attach(iframe: HTMLIFrameElement, expectedOrigin: string) {
        this.iframeWindow = iframe.contentWindow;
        this.iframeOrigin = expectedOrigin;
        this.diagnostics.iframeOrigin = expectedOrigin;
        this.logger.debug('IFRAME_ATTACH', { iframeOrigin: expectedOrigin });

        this.stateMachine.transitionTo(BridgeState.LOADING_IFRAME);

        this.sessionUnsubscribe = sessionManager.subscribe(session => {
            this.handleSessionChange(session);
        });

        // Proactively send auth handshakes to iframe continuously for 30s
        this.startProactiveAuthLoop();

        this.safeTimeout(() => {
            if (this.stateMachine.getState() === BridgeState.LOADING_IFRAME) {
                this.stateMachine.transitionTo(BridgeState.WAITING_READY);
            }
        }, 500);
    }

    private sendAuthPayloadToWindow(
        targetWindow: Window,
        tok: string,
        loginid: string,
        currency: string,
        appIdStr: string
    ) {
        if (!targetWindow || targetWindow === window) return;
        try {
            // For Deriv DTrader iframe, if OAuth JWT is passed, fallback to legacy token if available
            const isDTrader = Boolean(this.iframeOrigin && this.iframeOrigin.includes('deriv-dtrader'));
            let tokenToUse = tok;
            if (isDTrader && tok && tok.startsWith('ey')) {
                tokenToUse = getLegacyDTraderToken(loginid) || localStorage.getItem('token1') || '';
            }

            const hasToken =
                Boolean(tokenToUse && tokenToUse !== 'null' && tokenToUse !== 'undefined' && tokenToUse !== 'a1-guest' && tokenToUse !== 'dummy_token');
            const authMode = hasToken ? 'derivws_otp' : 'none';
            const effectiveToken = hasToken ? tokenToUse : '';

            const accountsList = getAccountsList();
            const isDemo =
                loginid.startsWith('VR') ||
                loginid.startsWith('VRT') ||
                loginid.startsWith('DOT') ||
                loginid.startsWith('DEM');

            const accounts =
                Object.keys(accountsList).length > 0
                    ? Object.entries(accountsList).map(([id]) => ({
                          account_id: id,
                          account_type: (id.startsWith('VR') ||
                          id.startsWith('VRT') ||
                          id.startsWith('DOT') ||
                          id.startsWith('DEM')
                              ? 'demo'
                              : 'real') as 'demo' | 'real',
                          currency: currency || 'USD',
                          balance: '10000.00',
                          status: 'active',
                      }))
                    : [
                          {
                              account_id: loginid || 'DOT100000',
                              account_type: isDemo ? ('demo' as const) : ('real' as const),
                              currency: currency || 'USD',
                              balance: '10000.00',
                              status: 'active',
                          },
                      ];

            const activeAccId = loginid || accounts[0].account_id;
            const profileCountry =
                localStorage.getItem('residence') ||
                localStorage.getItem('country') ||
                localStorage.getItem('client.country') ||
                'ke';

            // Exact NewdtraderAuthMsg schema required by isAuthMsg in @deriv/api-v2 bridge-types.ts
            const v2AuthMsg = {
                type: 'deriv:dtrader:auth',
                version: 'v2',
                auth: {
                    access_token: effectiveToken,
                    token_type: 'Bearer',
                    expires_at: Date.now() + 86400000,
                },
                activeAccountId: activeAccId,
                accounts,
                otpUrl: '',
                userProfile: {
                    country: profileCountry.toLowerCase(),
                    currency: currency || 'USD',
                    email: 'user@profithub.co.ke',
                    fullname: 'Profithub Trader',
                },
                clientId: appIdStr || '121856',
                apiBase: 'https://ws.derivws.com/websockets/v3',
                authBase: 'https://oauth.deriv.com',
            };

            const legacyV2AuthMsg = {
                ...v2AuthMsg,
                type: 'newdtrader:auth',
            };

            const payloadInner = {
                status: 'success',
                tokenPresent: hasToken,
                token: effectiveToken,
                token1: effectiveToken,
                loginid: activeAccId,
                loginId: activeAccId,
                acct1: activeAccId,
                account_id: activeAccId,
                currency: currency || 'USD',
                cur1: currency || 'USD',
                accountType: 'ZOOM',
                account_type: 'ZOOM',
                appId: Number(appIdStr) || 121856,
                app_id: appIdStr,
                server: 'green',
                timestamp: Date.now(),
                authMode,
                defaultSymbol: '1HZ100V',
                embedBase: this.iframeOrigin && this.iframeOrigin !== '*' ? this.iframeOrigin : 'https://profhubdtrader.vercel.app',
            };

            const rawClientAccounts = localStorage.getItem('client.accounts');
            const activeLoginId = localStorage.getItem('active_loginid') || activeAccId;

            const payloadData = {
                ...payloadInner,
                payload: payloadInner,
                'client.accounts': rawClientAccounts,
                active_loginid: activeLoginId,
            };

            const structuredMsg = createMessage('NEWDTRADER_BRIDGE_AUTH', appIdStr, 'parent', payloadInner);

            const postBoth = (msg: any) => {
                try {
                    const targetOrigin = this.iframeOrigin && this.iframeOrigin !== '*' ? this.iframeOrigin : '*';
                    try {
                        targetWindow.postMessage(msg, targetOrigin);
                    } catch {
                        if (targetOrigin !== '*') {
                            try {
                                targetWindow.postMessage(msg, '*');
                            } catch {}
                        }
                    }
                    if (typeof msg === 'object') {
                        try {
                            targetWindow.postMessage(JSON.stringify(msg), targetOrigin);
                        } catch {
                            if (targetOrigin !== '*') {
                                try {
                                    targetWindow.postMessage(JSON.stringify(msg), '*');
                                } catch {}
                            }
                        }
                    }
                } catch {
                    // ignore
                }
            };

            postBoth(v2AuthMsg);
            postBoth(legacyV2AuthMsg);
            postBoth(structuredMsg);
            // 1. Dispatch expected NewdtraderBridge Auth Handshake
            postBoth({
                type: 'NEWDTRADER_BRIDGE_AUTH',
                msg_type: 'authorization',
                token: effectiveToken,
                accountName: activeAccId,
                appId: appIdStr || '121856',
                currency: currency || 'USD',
                'client.accounts': rawClientAccounts,
                active_loginid: activeLoginId,
                ...payloadData,
            });
            // 2. Dispatch legacy authorize fallback
            postBoth({
                action: 'authorize',
                token: effectiveToken,
                loginid: activeAccId,
                'client.accounts': rawClientAccounts,
                active_loginid: activeLoginId,
            });
            postBoth({
                type: 'SYNC_CREDENTIALS',
                'client.accounts': rawClientAccounts,
                active_loginid: activeLoginId,
            });
            postBoth({ action: 'NEWDTRADER_BRIDGE_AUTH', msg_type: 'authorization', ...payloadData });
            postBoth({ type: 'NEWDTRADER_BRIDGE_AUTH_RESPONSE', ...payloadData });
            postBoth({ type: 'NEW_DTRADER_BRIDGE_AUTH', ...payloadData });
            postBoth({ type: 'SESSION_DATA', ...payloadData });
            postBoth({ type: 'DERIV_AUTH', ...payloadData });
            postBoth({ type: 'AUTH_TOKEN', ...payloadData });
            postBoth({ type: 'HANDSHAKE_RESPONSE', ...payloadData });
            postBoth({ type: 'BRIDGE_AUTH_SUCCESS', ...payloadData });
            postBoth({ type: 'AUTH_SUCCESS', ...payloadData });
            postBoth({ action: 'setToken', ...payloadData });
            postBoth({ action: 'AUTHORIZE', ...payloadData });
        } catch {
            // ignore
        }
    }

    /**
     * Sends AUTH_INIT to the iframe: loginid + expiresAt ONLY, NO raw token.
     * The iframe will reply with REQUEST_TOKEN, which triggers sendOTT().
     */
    private sendAuthInit() {
        if (!this.iframeWindow) return;
        const meta = secureSessionService.getSessionMeta();
        if (!meta?.loggedIn || !meta.loginid) return;

        const targetOrigin = this.iframeOrigin && this.iframeOrigin !== '*'
            ? this.iframeOrigin
            : (this.iframeOrigin && this.iframeOrigin !== '*' ? this.iframeOrigin : 'https://profhubdtrader.vercel.app');

        try {
            this.iframeWindow.postMessage({
                type:      'AUTH_INIT',
                source:    'parent',
                loginid:   meta.loginid,
                currency:  meta.currency,
                expiresAt: meta.expiresAt,
            }, targetOrigin);
        } catch (e) {
            this.logger.debug('AUTH_INIT_SEND_FAILED', { error: String(e) });
        }
    }

    /**
     * Fetches a One-Time Token from the server and posts it to the iframe.
     * Called when the iframe sends REQUEST_TOKEN.
     */
    private async sendOTT(targetWindow: Window, replyOrigin: string) {
        const ott = await secureSessionService.getOTT();
        if (!ott) {
            this.logger.debug('OTT_FETCH_FAILED', {});
            return;
        }
        const targetOrigin = replyOrigin && replyOrigin !== '*' ? replyOrigin : (this.iframeOrigin && this.iframeOrigin !== '*' ? this.iframeOrigin : 'https://profhubdtrader.vercel.app');
        try {
            targetWindow.postMessage({ type: 'OTT', ott }, targetOrigin);
        } catch (e) {
            this.logger.debug('OTT_SEND_FAILED', { error: String(e) });
        }
    }

    private startProactiveAuthLoop() {
        if (this.retryIntervalId) clearInterval(this.retryIntervalId);

        let attempts = 0;
        const maxAttempts = 20; // ~5s @ 250ms

        const postAuth = async () => {
            if (!this.iframeWindow) return;
            try {
                const session = sessionManager.getSession();
                const loginid =
                    session?.loginid ||
                    localStorage.getItem('active_loginid') ||
                    localStorage.getItem('client.loginid') ||
                    'DOT100000';
                const isDTrader = Boolean(this.iframeOrigin && this.iframeOrigin.includes('deriv-dtrader'));
                const syncToken = isDTrader ? (getLegacyDTraderToken(loginid) || '') : (getActiveToken() || '');
                const currency = session?.currency || localStorage.getItem('client.currency') || 'USD';
                const appIdStr = String(session?.appId || getAppId() || '121856');

                if (syncToken) {
                    this.sendAuthPayloadToWindow(this.iframeWindow, syncToken, loginid, currency, appIdStr);
                }
                this.sendAuthInit();

                if (!syncToken && !isDTrader) {
                    const resolvedToken = await resolveValidDerivWSToken(loginid);
                    if (resolvedToken && resolvedToken !== syncToken && this.iframeWindow) {
                        this.sendAuthPayloadToWindow(this.iframeWindow, resolvedToken, loginid, currency, appIdStr);
                    }
                }
            } catch {
                // ignore
            }
        };

        postAuth();
        this.retryIntervalId = setInterval(() => {
            attempts++;
            if (!this.iframeWindow || attempts >= maxAttempts) {
                if (this.retryIntervalId) clearInterval(this.retryIntervalId);
                return;
            }
            postAuth();
        }, 250);
    }

    public detach() {
        if (this.retryIntervalId) {
            clearInterval(this.retryIntervalId);
            this.retryIntervalId = null;
        }
        this.activeTimeouts.forEach(id => clearTimeout(id));
        this.activeTimeouts.clear();
        if (typeof window !== 'undefined') {
            window.removeEventListener('message', this.handleMessage);
        }
        if (this.sessionUnsubscribe) {
            this.sessionUnsubscribe();
            this.sessionUnsubscribe = null;
        }
        this.iframeWindow = null;
        this.logger.debug('IFRAME_DETACH');
        this.stateMachine.transitionTo(BridgeState.IDLE);
    }

    public getDiagnostics(): BridgeDiagnosticInfo {
        return this.diagnostics;
    }

    public subscribeDiagnostics(listener: () => void) {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    }

    private notifyDiagnosticListeners() {
        this.listeners.forEach(listener => {
            try {
                listener();
            } catch (e) {
                console.error(e);
            }
        });
    }

    private logMessage(direction: 'in' | 'out', msg: BridgeMessage) {
        this.diagnostics.messageHistory.unshift({ direction, msg, time: new Date() });
        if (this.diagnostics.messageHistory.length > 50) {
            this.diagnostics.messageHistory.pop();
        }
        this.diagnostics.lastEvent = msg.type;
        this.notifyDiagnosticListeners();
    }

    private sendMessage<T>(type: BridgeEvent | string, payload: T) {
        if (!this.iframeWindow) return;

        const session = sessionManager.getSession();
        const appId = session?.appId || getAppId() || '121856';
        this.diagnostics.appId = appId;

        const msg = createMessage(type, appId, 'parent', payload);
        this.logMessage('out', msg);
        this.logger.messageSent(this.iframeOrigin, msg.type as string);
        const origin = this.iframeOrigin && this.iframeOrigin !== '*' ? this.iframeOrigin : 'https://profhubdtrader.vercel.app';
        try {
            this.iframeWindow.postMessage(msg, origin);
        } catch (error) {
            console.error('[ParentBridge] Failed to send message', error);
        }
    }

    private handleMessage = (event: MessageEvent) => {
        // Prevent postMessage feedback loops from window itself
        if (!event.source || event.source === window) {
            return;
        }

        const allowedOrigins = [
            this.iframeOrigin,
            'https://profhubdtrader.vercel.app',
            'https://deriv-dtrader.vercel.app',
            'https://trader.deriv.com',
            'https://app.deriv.com',
            'https://www.derivcircles.com',
            'https://analysisprofithub.vercel.app',
            'https://xenontool.netlify.app',
            'https://dcircles.netlify.app',
            'https://dcircles-six.vercel.app',
        ];

        const isAllowed =
            (this.iframeOrigin && this.iframeOrigin !== '*' && event.origin === this.iframeOrigin) ||
            allowedOrigins.some(o => o && o !== '*' && (event.origin === o || event.origin.startsWith(o))) ||
            /\.vercel\.app$/i.test(new URL(event.origin).hostname) ||
            /\.deriv\.com$/i.test(new URL(event.origin).hostname) ||
            /^http:\/\/localhost(:\d+)?$/i.test(event.origin);

        if (!isAllowed) {
            return;
        }

        const data = event.data;
        if (!data || (typeof data !== 'object' && typeof data !== 'string')) {
            return;
        }

        let parsedData: any = data;
        if (typeof data === 'string') {
            try {
                parsedData = JSON.parse(data);
            } catch {
                return;
            }
        }

        // On ANY message from the iframe, reply with auth payload & auth init
        if (event.source && typeof (event.source as Window).postMessage === 'function') {
            const msgType = parsedData?.type || parsedData?.action || '';
            const session = sessionManager.getSession();
            const loginid =
                session?.loginid ||
                localStorage.getItem('active_loginid') ||
                localStorage.getItem('client.loginid') ||
                'DOT100000';
            const syncToken = getActiveToken() || '';
            const currency = session?.currency || localStorage.getItem('client.currency') || 'USD';
            const appIdStr = String(session?.appId || getAppId() || '121856');

            this.sendAuthPayloadToWindow(event.source as Window, syncToken, loginid, currency, appIdStr);

            if (msgType === 'REQUEST_TOKEN') {
                // Iframe is explicitly asking for an OTT — fetch and relay it
                this.sendOTT(event.source as Window, event.origin);
            } else if (msgType === 'NEWDTRADER_BRIDGE_AUTH_SUCCESS') {
                console.log('[ParentBridge] DTrader Bridge authenticated successfully.');
                if (this.retryIntervalId) {
                    clearInterval(this.retryIntervalId);
                    this.retryIntervalId = null;
                }
                this.stateMachine.transitionTo(BridgeState.AUTHENTICATED);
                this.safeTimeout(() => this.stateMachine.transitionTo(BridgeState.CONNECTED), 100);
                return;
            } else if (msgType === 'NEWDTRADER_BRIDGE_AUTH_FAILED') {
                console.error('[ParentBridge] Bridge rejected credentials:', parsedData?.error);
                if (this.retryIntervalId) {
                    clearInterval(this.retryIntervalId);
                    this.retryIntervalId = null;
                }
                this.diagnostics.lastError = parsedData?.error?.message || 'Bridge Auth Failed';
                this.stateMachine.transitionTo(BridgeState.FAILED);
                return;
            } else {
                this.sendAuthInit();
            }
        }

        if (!isValidBridgeMessage(parsedData)) {
            return;
        }

        if (parsedData.source !== 'iframe') {
            return;
        }

        this.logMessage('in', parsedData);

        switch (parsedData.type as BridgeEvent) {
            case BridgeEvent.BRIDGE_READY:
                this.handleBridgeReady();
                break;
            case BridgeEvent.REQUEST_SESSION:
                this.handleSessionRequest();
                break;
            case BridgeEvent.AUTH_SUCCESS:
                this.stateMachine.transitionTo(BridgeState.AUTHENTICATED);
                this.safeTimeout(() => this.stateMachine.transitionTo(BridgeState.CONNECTED), 100);
                this.reconnectAttempts = 0;
                break;
            case BridgeEvent.AUTH_FAILED:
                this.diagnostics.lastError = parsedData.payload?.message || 'Authentication Failed';
                this.stateMachine.transitionTo(BridgeState.FAILED);
                this.attemptRecovery();
                break;
            case BridgeEvent.LOGOUT:
                this.stateMachine.transitionTo(BridgeState.LOGGED_OUT);
                break;
            case BridgeEvent.ERROR:
                this.diagnostics.lastError = parsedData.payload?.message || 'Unknown Error';
                break;
        }
    };

    private handleBridgeReady() {
        if (this.stateMachine.transitionTo(BridgeState.READY)) {
            this.handleSessionRequest();
        }
    }

    private handleSessionRequest = () => {
        const session = sessionManager.getSession();
        const loginid =
            session?.loginid || localStorage.getItem('active_loginid') || localStorage.getItem('client.loginid') || '';
        const token = session?.token || getActiveToken() || localStorage.getItem('token') || '';
        const currency = session?.currency || localStorage.getItem('client.currency') || 'USD';
        const appIdStr = String(session?.appId || getAppId() || '121856');

        if (this.iframeWindow) {
            this.sendAuthPayloadToWindow(this.iframeWindow, token, loginid, currency, appIdStr);
        }

        this.sendAuthInit();
        this.stateMachine.transitionTo(BridgeState.AUTHENTICATING);
        this.sendMessage(BridgeEvent.AUTH_START, { timestamp: Date.now() });

        this.safeTimeout(() => {
            this.stateMachine.transitionTo(BridgeState.AUTHENTICATED);
            this.safeTimeout(() => {
                this.stateMachine.transitionTo(BridgeState.CONNECTED);
            }, 100);
        }, 300);
    };

    private handleSessionChange = (session: any) => {
        if (!session) {
            this.diagnostics.sessionStatus = 'none';
            return;
        }
        this.diagnostics.sessionStatus = 'valid';
        // Re-send AUTH_INIT when session changes (e.g. account switch)
        this.sendAuthInit();
    };

    private attemptRecovery() {
        if (this.reconnectAttempts < this.maxReconnects) {
            this.reconnectAttempts++;
            this.stateMachine.transitionTo(BridgeState.RECOVERING);

            const backoff = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 10000);
            setTimeout(() => {
                this.stateMachine.transitionTo(BridgeState.WAITING_READY);
                this.sendMessage(BridgeEvent.PING, { timestamp: Date.now() });
                setTimeout(() => this.handleSessionRequest(), 500);
            }, backoff);
        }
    }
}
