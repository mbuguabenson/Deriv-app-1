import { api_base } from '@/external/bot-skeleton/services/api/api-base';
import { observer as globalObserver } from '@/external/bot-skeleton/utils/observer';

export type TTickHandler = (data: {
    tick: {
        symbol: string;
        quote: number | string;
        epoch?: number;
        pip_size?: number;
        id?: string;
        ask?: number;
        bid?: number;
    };
    echo_req?: Record<string, unknown>;
    msg_type?: string;
    subscription?: { id: string };
    [key: string]: unknown;
}) => void;

interface SubscriptionRecord {
    listeners: Set<TTickHandler>;
    subscriptionId?: string;
    forgetTimer?: ReturnType<typeof setTimeout> | null;
    lastTickEpoch: number;
    isSubscribedInDeriv: boolean;
}

/**
 * Centralized Deriv Tick Multiplexer & Manager
 *
 * Prevents:
 * 1. Deriv server 'AlreadySubscribed' errors when multiple components/tabs subscribe to the same symbol.
 * 2. Dropped streams when one tab unsubscribes (which previously sent `forget` and broke all other tabs).
 * 3. Market pause and disconnects during tab switching and trading.
 * 4. Stale/dead streams after browser tab backgrounding or WebSocket reconnects.
 */
class DerivTickManager {
    private streams = new Map<string, SubscriptionRecord>();
    private messageSubscription: { unsubscribe: () => void } | null = null;
    private isInitialized = false;
    private currentApiInstance: unknown = null;
    private subscriptionQueue: string[] = [];
    private isProcessingQueue = false;
    private queueDelayMs = 120; // 120ms between subscription requests to prevent Deriv rate limits
    private isRateLimited = false;

    constructor() {
        this.init();
    }

    private init() {
        if (this.isInitialized) return;
        this.isInitialized = true;

        this.bindSocketMessageObserver();

        // Auto-resubscribe all active symbols on socket reconnect or authorization
        globalObserver.register('api.authorize', () => {
            this.resubscribeAll('api.authorize');
        });
        globalObserver.register('ws.opened', () => {
            this.resubscribeAll('ws.opened');
        });

        // Auto-heal stalled streams when browser tab resumes focus / visibility
        if (typeof document !== 'undefined') {
            document.addEventListener('visibilitychange', () => {
                if (!document.hidden) {
                    this.healStalledStreams();
                }
            });
        }
        if (typeof window !== 'undefined') {
            window.addEventListener('focus', () => {
                this.healStalledStreams();
            });
            window.addEventListener('online', () => {
                this.resubscribeAll('online');
            });
        }
    }

    /**
     * Bind to the central api_base.api.onMessage() stream
     * so all incoming ticks on the WebSocket are multiplexed immediately.
     */
    private bindSocketMessageObserver() {
        const api = api_base.api;
        if (!api) {
            // Check again shortly until api is initialized
            setTimeout(() => this.bindSocketMessageObserver(), 500);
            return;
        }

        if (this.currentApiInstance === api && this.messageSubscription) {
            return;
        }

        if (this.messageSubscription) {
            try {
                this.messageSubscription.unsubscribe();
            } catch {
                /* ignore */
            }
            this.messageSubscription = null;
        }

        this.currentApiInstance = api;

        try {
            if (typeof api.onMessage === 'function') {
                const observable = api.onMessage();
                if (observable && typeof observable.subscribe === 'function') {
                    this.messageSubscription = observable.subscribe(
                        ({ data }: { data: Record<string, any> }) => {
                            this.handleIncomingSocketMessage(data);
                        },
                        (err: unknown) => {
                            console.warn('[DerivTickManager] onMessage error notice:', err);
                            // Re-bind if stream errored
                            this.messageSubscription = null;
                            setTimeout(() => this.bindSocketMessageObserver(), 1000);
                        }
                    );
                }
            }
        } catch (e) {
            console.warn('[DerivTickManager] Could not bind onMessage:', e);
        }
    }

    private handleIncomingSocketMessage(data: Record<string, any>) {
        if (!data) return;

        if (data.msg_type === 'tick' && data.tick) {
            const sym = (data.tick.symbol || data.echo_req?.ticks) as string;
            if (!sym) return;

            const record = this.streams.get(sym);
            if (record) {
                record.lastTickEpoch = Date.now();
                record.isSubscribedInDeriv = true;
                if (data.subscription?.id) {
                    record.subscriptionId = data.subscription.id;
                }

                if (record.listeners) {
                    record.listeners.forEach(handler => {
                        try {
                            if (typeof handler === 'function') {
                                handler(data as any);
                            }
                        } catch (handlerErr) {
                            console.error(`[DerivTickManager] Exception in listener for ${sym}:`, handlerErr);
                        }
                    });
                }
            }
        }
    }

    /**
     * Subscribe to live ticks for a symbol.
     * Reuses active WebSocket streams across all tabs and components without duplication or collision.
     */
    public subscribeTicks(symbol: string, callback: TTickHandler): { unsubscribe: () => void } {
        if (!symbol) {
            return { unsubscribe: () => {} };
        }

        let record = this.streams.get(symbol);
        if (!record) {
            record = {
                listeners: new Set(),
                lastTickEpoch: 0,
                isSubscribedInDeriv: false,
            };
            this.streams.set(symbol, record);
        }

        // Cancel pending forget timer if new subscriber joined during grace period
        if (record.forgetTimer) {
            clearTimeout(record.forgetTimer);
            record.forgetTimer = null;
        }

        record.listeners.add(callback);

        // Ensure socket listener is attached
        this.bindSocketMessageObserver();

        // If this is the first listener or stream hasn't been confirmed on Deriv
        if (record.listeners.size === 1 || !record.isSubscribedInDeriv) {
            this.enqueueDerivSubscription(symbol);
        }

        let unsubscribed = false;
        return {
            unsubscribe: () => {
                if (unsubscribed) return;
                unsubscribed = true;

                const currentRecord = this.streams.get(symbol);
                if (!currentRecord) return;

                currentRecord.listeners.delete(callback);

                // If no listeners remain for this symbol across all tabs, initiate grace period
                if (currentRecord.listeners.size === 0) {
                    if (currentRecord.forgetTimer) {
                        clearTimeout(currentRecord.forgetTimer);
                    }
                    // 15 seconds grace period before sending forget to server
                    // Prevents connection thrashing when switching between tabs
                    currentRecord.forgetTimer = setTimeout(() => {
                        this.cleanupSymbolStream(symbol);
                    }, 15000);
                }
            },
        };
    }

    /**
     * Enqueue a subscription request with automatic pacing and rate limit handling
     */
    private enqueueDerivSubscription(symbol: string) {
        if (!this.subscriptionQueue.includes(symbol)) {
            this.subscriptionQueue.push(symbol);
        }
        void this.processSubscriptionQueue();
    }

    private async processSubscriptionQueue() {
        if (this.isProcessingQueue || this.isRateLimited) return;
        this.isProcessingQueue = true;

        while (this.subscriptionQueue.length > 0) {
            if (this.isRateLimited) break;

            const symbol = this.subscriptionQueue.shift();
            if (!symbol) continue;

            const record = this.streams.get(symbol);
            if (!record || record.listeners.size === 0 || record.isSubscribedInDeriv) {
                continue;
            }

            await this.dispatchDerivSubscription(symbol);

            if (this.subscriptionQueue.length > 0) {
                await new Promise(res => setTimeout(res, this.queueDelayMs));
            }
        }

        this.isProcessingQueue = false;
    }

    /**
     * Sends the subscription request to Deriv WebSocket safely,
     * handling AlreadySubscribed and RateLimit responses.
     */
    private async dispatchDerivSubscription(symbol: string) {
        const api = api_base.api;
        if (!api || typeof api.send !== 'function') return;

        const record = this.streams.get(symbol);
        if (!record || record.listeners.size === 0) return;

        try {
            const res = await api.send({ ticks: symbol, subscribe: 1 });
            if (res) {
                if (res.subscription?.id) {
                    record.subscriptionId = res.subscription.id;
                    record.isSubscribedInDeriv = true;
                }
                if (res.tick) {
                    this.handleIncomingSocketMessage(res);
                }
            }
        } catch (err: any) {
            const code = err?.error?.code || err?.code;
            const msg = String(err?.error?.message || err?.message || '').toLowerCase();

            if (code === 'AlreadySubscribed' || msg.includes('already subscribed')) {
                // Ticks are already flowing on this connection for this symbol
                record.isSubscribedInDeriv = true;
            } else if (code === 'RateLimit' || msg.includes('rate limit')) {
                console.warn(`[DerivTickManager] RateLimit reached on ${symbol}, backing off for 2.5s.`);
                this.isRateLimited = true;
                if (!this.subscriptionQueue.includes(symbol)) {
                    this.subscriptionQueue.unshift(symbol);
                }
                setTimeout(() => {
                    this.isRateLimited = false;
                    void this.processSubscriptionQueue();
                }, 2500);
            } else {
                console.info(`[DerivTickManager] Subscription notice for ${symbol}:`, err?.message || err);
            }
        }
    }

    private cleanupSymbolStream(symbol: string) {
        const record = this.streams.get(symbol);
        if (!record || record.listeners.size > 0) return;

        if (record.subscriptionId && api_base.api?.send) {
            try {
                api_base.api.send({ forget: record.subscriptionId }).catch(() => {});
            } catch {
                /* ignore */
            }
        }
        this.streams.delete(symbol);
    }

    /**
     * Re-subscribe all active symbols after a socket reconnect or auth change
     */
    public resubscribeAll(_reason?: string) {
        this.bindSocketMessageObserver();

        if (this.streams) {
            this.streams.forEach((record, symbol) => {
                if (record && record.listeners && record.listeners.size > 0) {
                    record.isSubscribedInDeriv = false;
                    this.enqueueDerivSubscription(symbol);
                }
            });
        }
    }

    /**
     * Heals any stalled streams (no ticks received in > 4.5 seconds for active symbols)
     * Useful when returning to tab from background or lock screen.
     */
    public healStalledStreams() {
        this.bindSocketMessageObserver();
        const now = Date.now();

        if (this.streams) {
            this.streams.forEach((record, symbol) => {
                if (record && record.listeners && record.listeners.size > 0) {
                    const elapsed = now - (record.lastTickEpoch || 0);
                    if (elapsed > 4500) {
                        this.enqueueDerivSubscription(symbol);
                    }
                }
            });
        }
    }

    /**
     * Checks if a symbol currently has active listeners
     */
    public hasActiveListeners(symbol: string): boolean {
        const record = this.streams.get(symbol);
        return Boolean(record && record.listeners.size > 0);
    }
}

export const derivTickManager = new DerivTickManager();
export const subscribeTicks = derivTickManager.subscribeTicks.bind(derivTickManager);
