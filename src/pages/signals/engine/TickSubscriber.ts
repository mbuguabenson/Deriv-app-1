import { SignalEngine, AnalysisResult, Signal } from './SignalEngine';
import { api_base } from '@/external/bot-skeleton/services/api/api-base';

export type SignalWithSymbol = Signal & { symbol?: string };

export type EngineState = {
    analysis: AnalysisResult | null;
    standard: SignalWithSymbol[];
    pro: SignalWithSymbol[];
    super: SignalWithSymbol[];
};

/**
 * TickSubscriber – Uses the shared api_base.api WebSocket connection
 * (same pattern as MarketKiller, DigitCracker, FreeBots, etc.)
 * instead of opening a standalone unauthenticated WebSocket.
 */
export class TickSubscriber {
    private engines: Map<string, SignalEngine> = new Map();
    private activeSymbols: string[] = [];
    private callbacks: ((state: EngineState) => void)[] = [];
    private isStreaming = false;
    private currentMode: string = '';
    private tickListenerSub: any = null;
    private streamSubscriptionIds: string[] = [];
    private retryTimeout: ReturnType<typeof setTimeout> | null = null;

    constructor() {}

    public subscribe(callback: (state: EngineState) => void) {
        this.callbacks.push(callback);
    }

    public unsubscribe(callback: (state: EngineState) => void) {
        this.callbacks = this.callbacks.filter(cb => cb !== callback);
    }

    private emit() {
        if (!this.isStreaming) return;

        let allStandard: SignalWithSymbol[] = [];
        let allPro: SignalWithSymbol[] = [];
        let allSuper: SignalWithSymbol[] = [];
        let primaryAnalysis: AnalysisResult | null = null;

        this.engines.forEach((engine, symbol) => {
            const analysis = engine.analyze();
            if (analysis) {
                const standard = engine.generateStandardSignals(analysis).map(s => ({ ...s, symbol }));
                const pro = engine.generateProSignals(analysis).map(s => ({ ...s, symbol }));
                const superSignals = engine.generateSuperSignals(analysis, standard, pro).map(s => ({ ...s, symbol }));

                allStandard.push(...standard);
                allPro.push(...pro);
                allSuper.push(...superSignals);

                // Use the first available analysis for stats UI if none exists
                if (!primaryAnalysis) {
                    primaryAnalysis = analysis;
                }
            }
        });

        // Bubble highest confidence signals to the top
        allStandard.sort((a, b) => b.probability - a.probability);
        allPro.sort((a, b) => b.probability - a.probability);
        allSuper.sort((a, b) => b.probability - a.probability);

        const state = {
            analysis: primaryAnalysis,
            standard: allStandard,
            pro: allPro,
            super: allSuper,
        };

        this.callbacks.forEach(cb => cb(state));
    }

    public async startStreaming(symbol: string = 'R_100') {
        if (this.isStreaming && this.currentMode === symbol) return;

        this.stopStreaming();
        this.currentMode = symbol;
        this.engines.clear();
        this.activeSymbols = [];
        this.isStreaming = true;

        if (symbol === 'ALL') {
            if (api_base.active_symbols && api_base.active_symbols.length > 0) {
                this.activeSymbols = api_base.active_symbols
                    .filter((s: any) => {
                        if (!s.symbol && !s.underlying_symbol) return false;
                        const sym = (s.symbol || s.underlying_symbol).toUpperCase();
                        if (sym.includes('BOOM') || sym.includes('CRASH')) return false;
                        return (
                            sym.includes('1HZ') || sym.startsWith('R_') || sym.includes('JD') || sym.includes('JUMP')
                        );
                    })
                    .map((s: any) => s.symbol || s.underlying_symbol);
            } else {
                this.activeSymbols = [
                    'R_10',
                    'R_25',
                    'R_50',
                    'R_75',
                    'R_100',
                    '1HZ10V',
                    '1HZ50V',
                    '1HZ100V',
                    'JD10',
                    'JD25',
                    'JD50',
                    'JD75',
                    'JD100',
                    'STPIND',
                ];
            }
        } else {
            this.activeSymbols = [symbol];
        }

        this.activeSymbols.forEach(sym => {
            this.engines.set(sym, new SignalEngine());
        });

        // Wait for api_base to be ready, then subscribe
        this.waitForApiAndSubscribe();
    }

    /**
     * Waits for api_base.api to be connected, then subscribes to tick history.
     * Mirrors the pattern used by MarketKiller store's waitForApiAndConnect.
     */
    private waitForApiAndSubscribe = (retryCount = 0) => {
        if (!this.isStreaming) return;

        if (!api_base?.api || api_base.api?.connection?.readyState !== 1) {
            if (retryCount < 10) {
                this.retryTimeout = setTimeout(() => this.waitForApiAndSubscribe(retryCount + 1), 1000);
            } else {
                console.warn('[SignalCentre] api_base not ready after 10 retries, giving up.');
                this.isStreaming = false;
            }
            return;
        }

        this.subscribeAllSymbols();
    };

    /**
     * Subscribes to tick history for all active symbols using the shared api_base.api connection.
     * Uses ticks_history with subscribe:1 for initial history + live tick stream.
     */
    private subscribeAllSymbols = async () => {
        if (!this.isStreaming || !api_base?.api) return;

        // Subscribe to each symbol's tick history
        for (const sym of this.activeSymbols) {
            if (!this.isStreaming) return;

            try {
                const response = await api_base.api
                    .send({
                        ticks_history: sym,
                        adjust_start_time: 1,
                        count: 100,
                        end: 'latest',
                        style: 'ticks',
                        subscribe: 1,
                    })
                    .catch((err: any) => {
                        const code = err?.error?.code || err?.code;
                        if (code === 'AlreadySubscribed' || code === 'InvalidSymbol') return err;
                        return { error: err?.error || err };
                    });

                if (response?.error) {
                    const code = response.error.code;
                    if (code === 'InvalidSymbol' || code === 'InputValidationFailed') {
                        this.engines.delete(sym);
                        continue;
                    }
                    if (code !== 'AlreadySubscribed') {
                        console.info(
                            `[SignalCentre] Subscription note for ${sym}:`,
                            response.error.message || response.error
                        );
                    }
                }

                // Save subscription ID for clean unsubscribe
                if (response?.subscription?.id) {
                    this.streamSubscriptionIds.push(response.subscription.id);
                }

                // Process initial history
                if (response?.history?.prices && Array.isArray(response.history.prices)) {
                    const engine = this.engines.get(sym);
                    if (engine) {
                        response.history.prices.forEach((price: number) => {
                            engine.addTick(price);
                        });
                        this.emit();
                    }
                }
            } catch (err: any) {
                const code = err?.error?.code || err?.code;
                if (code !== 'InvalidSymbol' && code !== 'AlreadySubscribed') {
                    console.info(`[SignalCentre] Notice for ${sym}:`, err?.message || err);
                }
            }
        }

        // Register a single RxJS event listener for all incoming ticks
        if (api_base.api?.onMessage) {
            this.tickListenerSub = api_base.api.onMessage().subscribe((res: any) => {
                const data = res?.data || res;

                if (data?.msg_type === 'tick' && data?.tick?.symbol) {
                    const sym = data.tick.symbol;
                    const engine = this.engines.get(sym);
                    if (engine) {
                        engine.addTick(data.tick.quote);
                        this.emit();
                    }
                }
            });
        }

        console.log(`[SignalCentre] Subscribed to ${this.activeSymbols.length} symbols via api_base.api`);
    };

    public stopStreaming() {
        if (this.retryTimeout) {
            clearTimeout(this.retryTimeout);
            this.retryTimeout = null;
        }

        // Unsubscribe RxJS listener to prevent memory leaks
        if (this.tickListenerSub) {
            try {
                this.tickListenerSub.unsubscribe();
            } catch (e) {
                /* ignore */
            }
            this.tickListenerSub = null;
        }

        // Forget all stream subscriptions via api_base
        if (api_base?.api && this.streamSubscriptionIds.length > 0) {
            this.streamSubscriptionIds.forEach(id => {
                try {
                    api_base.api.send({ forget: id });
                } catch (e) {
                    /* ignore */
                }
            });
        }
        this.streamSubscriptionIds = [];

        this.isStreaming = false;
        this.engines.clear();
        this.activeSymbols = [];
        this.currentMode = '';
    }
}

export const tickSubscriber = new TickSubscriber();
