import { useEffect, useState } from 'react';
import { api_base } from '@/external/bot-skeleton/services/api/api-base';
import { getSocketURL } from '@/components/shared/utils/config/config';

export interface HybridTickData {
    quote: number;
    epoch: number;
    symbol: string;
    pip_size?: number;
    digit?: number;
}

export interface MarketStats {
    symbol: string;
    lastPrice: number;
    lastDigit: number;
    digits: number[];
    quotes: number[];
    oddPct: number;
    evenPct: number;
    over4Pct: number;
    under5Pct: number;
    hotDigit: number;
    coldDigit: number;
    isBullish: boolean;
}

export type TickCallback = (tick: HybridTickData, stats: MarketStats) => void;

class HybridMarketAdapter {
    private fallbackWs: WebSocket | null = null;
    private callbacks = new Map<string, Set<TickCallback>>();
    private tickHistory = new Map<string, { quotes: number[]; digits: number[]; lastTick: HybridTickData | null }>();
    private activeSubscriptions = new Set<string>();
    private failedSymbols = new Set<string>();
    private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    private reconnectAttempts: number = 0;

    constructor() {
        this.init();
    }

    private init() {
        this.connectFallback();
        this.listenPrimaryApi();
    }

    private async connectFallback() {
        if (
            this.fallbackWs &&
            (this.fallbackWs.readyState === WebSocket.OPEN || this.fallbackWs.readyState === WebSocket.CONNECTING)
        ) {
            return;
        }

        try {
            const wsUrl = await getSocketURL();
            this.fallbackWs = new WebSocket(wsUrl);

            this.fallbackWs.onopen = () => {
                // Reset backoff on successful connection
                this.reconnectAttempts = 0;
                // Resubscribe active symbols on fallback WS
                this.activeSubscriptions.forEach(symbol => this.sendSubscription(symbol));
            };

            this.fallbackWs.onmessage = event => {
                try {
                    const data = JSON.parse(event.data);
                    this.handleIncomingMessage(data);
                } catch {
                    // ignore JSON parse errors
                }
            };

            this.fallbackWs.onclose = () => {
                this.scheduleReconnect();
            };

            this.fallbackWs.onerror = () => {
                // fallback handles errors gracefully
            };
        } catch {
            this.scheduleReconnect();
        }
    }

    private scheduleReconnect() {
        if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
        // Exponential backoff: 2.5s, 5s, 10s, 20s, max 30s
        const delay = Math.min(2500 * Math.pow(2, this.reconnectAttempts), 30_000);
        this.reconnectAttempts++;
        this.reconnectTimer = setTimeout(() => this.connectFallback(), delay);
    }

    private listenPrimaryApi() {
        if (api_base?.api?.onMessage) {
            try {
                api_base.api.onMessage().subscribe((res: any) => {
                    const data = res?.data || res;
                    this.handleIncomingMessage(data);
                });
            } catch {
                // primary API listening fallback
            }
        }
    }

    private handleIncomingMessage(data: any) {
        if (!data) return;

        // Tick history response
        if (data.history && data.history.prices) {
            const reqSymbol = data.echo_req?.ticks_history || data.echo_req?.ticks;
            if (reqSymbol) {
                const prices = (data.history.prices as (number | string)[]).map(p => parseFloat(p.toString()));
                const digits = prices.map(p => {
                    const s = p.toString();
                    return parseInt(s[s.length - 1], 10);
                });

                const lastPrice = prices[prices.length - 1] || 0;
                const lastDigit = digits[digits.length - 1] || 0;

                const tickObj: HybridTickData = {
                    quote: lastPrice,
                    epoch: Date.now() / 1000,
                    symbol: reqSymbol,
                    digit: lastDigit,
                };

                this.tickHistory.set(reqSymbol, {
                    quotes: prices.slice(-1000),
                    digits: digits.slice(-1000),
                    lastTick: tickObj,
                });

                this.broadcast(reqSymbol, tickObj);
            }
        }

        // Live tick response
        if (data.msg_type === 'tick' && data.tick) {
            const t = data.tick;
            const quote = parseFloat(t.quote);
            const s = quote.toString();
            const digit = parseInt(s[s.length - 1], 10);

            const tickObj: HybridTickData = {
                quote,
                epoch: t.epoch,
                symbol: t.symbol,
                pip_size: t.pip_size,
                digit,
            };

            const existing = this.tickHistory.get(t.symbol) || { quotes: [], digits: [], lastTick: null };
            const newQuotes = [...existing.quotes, quote].slice(-1000);
            const newDigits = [...existing.digits, digit].slice(-1000);

            this.tickHistory.set(t.symbol, {
                quotes: newQuotes,
                digits: newDigits,
                lastTick: tickObj,
            });

            this.broadcast(t.symbol, tickObj);
        }

        // Error handling
        if (data.error && data.error.code === 'InvalidSymbol') {
            const errSym = data.echo_req?.ticks_history || data.echo_req?.ticks;
            if (errSym) this.failedSymbols.add(errSym);
        }
    }

    private sendSubscription(symbol: string) {
        if (this.failedSymbols.has(symbol)) return;

        const payload = JSON.stringify({
            ticks_history: symbol,
            count: 100,
            end: 'latest',
            style: 'ticks',
            subscribe: 1,
        });

        // Primary WS if available and open
        if (api_base?.api?.connection?.readyState === 1) {
            try {
                api_base.api.send({ ticks_history: symbol, count: 100, end: 'latest', style: 'ticks', subscribe: 1 });
            } catch {
                // fallback will execute below
            }
        }

        // Fallback WS
        if (this.fallbackWs && this.fallbackWs.readyState === WebSocket.OPEN) {
            try {
                this.fallbackWs.send(payload);
            } catch {
                // ignore send error
            }
        }
    }

    public subscribe(symbol: string, callback: TickCallback): () => void {
        if (!this.callbacks.has(symbol)) {
            this.callbacks.set(symbol, new Set());
        }

        this.callbacks.get(symbol)!.add(callback);
        this.activeSubscriptions.add(symbol);

        // Send subscription request
        this.sendSubscription(symbol);

        // Immediately push cached state if present
        const cached = this.tickHistory.get(symbol);
        if (cached && cached.lastTick) {
            const stats = this.computeStats(symbol);
            if (stats) callback(cached.lastTick, stats);
        }

        // Return cleanup unsubscribe function
        return () => {
            const set = this.callbacks.get(symbol);
            if (set) {
                set.delete(callback);
                if (set.size === 0) {
                    this.callbacks.delete(symbol);
                    this.activeSubscriptions.delete(symbol);
                }
            }
        };
    }

    public computeStats(symbol: string): MarketStats | null {
        const data = this.tickHistory.get(symbol);
        if (!data || data.digits.length === 0 || !data.lastTick) return null;

        const digits = data.digits;
        const quotes = data.quotes;
        const total = digits.length;

        const oddCount = digits.filter(d => d % 2 !== 0).length;
        const oddPct = Math.round((oddCount / total) * 100);
        const evenPct = 100 - oddPct;

        const over4Count = digits.filter(d => d > 4).length;
        const over4Pct = Math.round((over4Count / total) * 100);
        const under5Pct = 100 - over4Pct;

        const counts = Array(10).fill(0);
        digits.forEach(d => counts[d]++);
        let hotDigit = 0,
            coldDigit = 0;
        for (let d = 1; d < 10; d++) {
            if (counts[d] > counts[hotDigit]) hotDigit = d;
            if (counts[d] < counts[coldDigit]) coldDigit = d;
        }

        const rises = quotes.filter((q, i) => i > 0 && q > quotes[i - 1]).length;
        const falls = Math.max(0, quotes.length - 1 - rises);
        const isBullish = rises >= falls;

        return {
            symbol,
            lastPrice: data.lastTick.quote,
            lastDigit: data.lastTick.digit ?? 0,
            digits,
            quotes,
            oddPct,
            evenPct,
            over4Pct,
            under5Pct,
            hotDigit,
            coldDigit,
            isBullish,
        };
    }

    private broadcast(symbol: string, tick: HybridTickData) {
        const set = this.callbacks.get(symbol);
        if (!set || set.size === 0) return;

        const stats = this.computeStats(symbol);
        if (!stats) return;

        set.forEach(cb => {
            try {
                cb(tick, stats);
            } catch {
                // ignore subscriber errors
            }
        });
    }
}

export const hybridMarketAdapter = new HybridMarketAdapter();

export function useHybridMarket(symbol: string) {
    const [tick, setTick] = useState<HybridTickData | null>(null);
    const [stats, setStats] = useState<MarketStats | null>(null);

    useEffect(() => {
        if (!symbol) return;
        const unsub = hybridMarketAdapter.subscribe(symbol, (t, s) => {
            setTick(t);
            setStats(s);
        });
        return unsub;
    }, [symbol]);

    return { tick, stats };
}
