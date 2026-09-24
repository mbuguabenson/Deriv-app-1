import { api_base } from '@/external/bot-skeleton';
import { safeSubscribe } from '@/utils/websocket-handler';
import {
    Candle,
    MarketSymbolInfo,
    PriceZone,
    TimeframeAnalysis,
    TimeframeKey,
} from '../types';
import { CandlestickService } from './candlestick.service';
import { IndicatorsService } from './indicators.service';

type TMarketFeedListener = (data: {
    symbol: string;
    currentPrice: number;
    timeframeData: Record<TimeframeKey, Candle[]>;
    timeframeAnalysis: Record<TimeframeKey, TimeframeAnalysis | null>;
    zones: PriceZone[];
}) => void;

const TIMEFRAME_CONFIG: Record<TimeframeKey, { granularity: number; count: number }> = {
    '30m': { granularity: 1800, count: 60 },
    '15m': { granularity: 900, count: 60 },
    '5m': { granularity: 300, count: 60 },
    '1m': { granularity: 60, count: 60 },
};

export class DerivMarketFeedService {
    private currentSymbol: string = 'R_100';
    private tickSubscription: any = null;
    private listeners: Set<TMarketFeedListener> = new Set();
    private isInitialized: boolean = false;
    private donchianPeriod: number = 20;

    // Cache of candles per timeframe
    private candleCache: Record<TimeframeKey, Candle[]> = {
        '30m': [],
        '15m': [],
        '5m': [],
        '1m': [],
    };

    private latestPrice: number = 0;

    public setDonchianPeriod(period: number) {
        this.donchianPeriod = period;
        this.recalculateAllTimeframes();
    }

    public subscribe(listener: TMarketFeedListener): () => void {
        this.listeners.add(listener);
        if (this.latestPrice > 0) {
            this.emitUpdate();
        }
        return () => {
            this.listeners.delete(listener);
        };
    }

    public async switchMarket(symbol: string) {
        if (this.currentSymbol === symbol && this.isInitialized) return;

        this.stopFeed();
        this.currentSymbol = symbol;
        this.candleCache = { '30m': [], '15m': [], '5m': [], '1m': [] };
        this.latestPrice = 0;

        await this.loadAllTimeframeCandles(symbol);
        this.startTickStream(symbol);
        this.isInitialized = true;
    }

    public stopFeed() {
        if (this.tickSubscription) {
            try {
                this.tickSubscription.unsubscribe?.();
            } catch {
                // ignore
            }
            this.tickSubscription = null;
        }
        this.isInitialized = false;
    }

    /**
     * Loads historical candles for 30M, 15M, 5M, and 1M
     */
    private async loadAllTimeframeCandles(symbol: string) {
        if (!api_base?.api) return;

        const keys: TimeframeKey[] = ['30m', '15m', '5m', '1m'];

        await Promise.all(
            keys.map(async tfKey => {
                const config = TIMEFRAME_CONFIG[tfKey];
                try {
                    const response = await (api_base.api as any).send({
                        ticks_history: symbol,
                        adjust_start_time: 1,
                        count: config.count,
                        end: 'latest',
                        granularity: config.granularity,
                        style: 'candles',
                    });

                    const rawCandles = response?.candles;
                    if (Array.isArray(rawCandles) && rawCandles.length > 0) {
                        const parsedCandles: Candle[] = rawCandles.map((c: any) => ({
                            epoch: Number(c.epoch),
                            open: Number(c.open),
                            high: Number(c.high),
                            low: Number(c.low),
                            close: Number(c.close),
                        }));

                        this.candleCache[tfKey] = parsedCandles;
                        const last = parsedCandles[parsedCandles.length - 1];
                        if (last && (this.latestPrice === 0 || tfKey === '1m')) {
                            this.latestPrice = last.close;
                        }
                    }
                } catch (err) {
                    console.warn(`[DerivMarketFeed] Error loading ${tfKey} candles for ${symbol}:`, err);
                }
            })
        );

        this.recalculateAllTimeframes();
    }

    /**
     * Subscribes to live ticks to incrementally update all candle timeframes
     */
    private startTickStream(symbol: string) {
        if (!api_base?.api) return;

        try {
            const observable = (api_base.api as any).subscribe({ ticks: symbol });
            this.tickSubscription = safeSubscribe(
                observable,
                (data: any) => {
                    if (data?.tick && data?.echo_req?.ticks === this.currentSymbol) {
                        const quote = Number(data.tick.quote);
                        const epoch = Number(data.tick.epoch);
                        if (Number.isFinite(quote)) {
                            this.handleNewTick(quote, epoch);
                        }
                    }
                },
                (err: any) => {
                    console.warn(`[DerivMarketFeed] Live tick error for ${symbol}:`, err);
                }
            );
        } catch (err) {
            console.warn(`[DerivMarketFeed] Failed to subscribe to ticks for ${symbol}:`, err);
        }
    }

    /**
     * Applies new tick to each timeframe candle incrementally
     */
    private handleNewTick(quote: number, epoch: number) {
        this.latestPrice = quote;
        const keys: TimeframeKey[] = ['30m', '15m', '5m', '1m'];

        keys.forEach(tfKey => {
            const config = TIMEFRAME_CONFIG[tfKey];
            const candles = this.candleCache[tfKey];
            if (!candles || candles.length === 0) return;

            const lastCandle = candles[candles.length - 1];
            const candleInterval = config.granularity;
            const currentCandleStart = Math.floor(epoch / candleInterval) * candleInterval;

            if (lastCandle.epoch === currentCandleStart) {
                // Update current candle
                lastCandle.high = Math.max(lastCandle.high, quote);
                lastCandle.low = Math.min(lastCandle.low, quote);
                lastCandle.close = quote;
            } else if (epoch >= lastCandle.epoch + candleInterval) {
                // New candle rolled over
                const newCandle: Candle = {
                    epoch: currentCandleStart,
                    open: quote,
                    high: quote,
                    low: quote,
                    close: quote,
                };
                candles.push(newCandle);
                if (candles.length > config.count) {
                    candles.shift();
                }
            }
        });

        this.recalculateAllTimeframes();
    }

    private recalculateAllTimeframes() {
        this.emitUpdate();
    }

    private emitUpdate() {
        const analyses: Record<TimeframeKey, TimeframeAnalysis | null> = {
            '30m': this.analyzeTimeframe('30m'),
            '15m': this.analyzeTimeframe('15m'),
            '5m': this.analyzeTimeframe('5m'),
            '1m': this.analyzeTimeframe('1m'),
        };

        const activeCandles = this.candleCache['5m'].length > 0 ? this.candleCache['5m'] : this.candleCache['1m'];
        const zones = IndicatorsService.identifyPriceZones(activeCandles);

        this.listeners.forEach(listener => {
            listener({
                symbol: this.currentSymbol,
                currentPrice: this.latestPrice,
                timeframeData: { ...this.candleCache },
                timeframeAnalysis: analyses,
                zones,
            });
        });
    }

    private analyzeTimeframe(tfKey: TimeframeKey): TimeframeAnalysis | null {
        const candles = this.candleCache[tfKey];
        if (!candles || candles.length < 15) return null;

        const donchian = IndicatorsService.calculateDonchian(candles, this.donchianPeriod);
        const cci = IndicatorsService.calculateCCI(candles, 20);
        const macd = IndicatorsService.calculateMACD(candles, 12, 26, 9);
        const candleAnalysis = CandlestickService.analyzeCandle(candles, donchian);
        const activity = IndicatorsService.calculateMarketActivity(candles, 14, 25);

        // Trend calculation based on Donchian channel position, MACD, and CCI
        let trend: 'BULLISH' | 'BEARISH' | 'RANGE' = 'RANGE';
        if (donchian) {
            const currentClose = candles[candles.length - 1].close;
            const isBullishIndicators = Boolean(
                macd?.isAboveZero ||
                (macd?.histogram && macd.histogram > 0) ||
                cci?.condition === 'STRONG_BULLISH' ||
                (cci?.value && cci.value > 0) ||
                candleAnalysis?.isBullish
            );
            const isBearishIndicators = Boolean(
                !macd?.isAboveZero ||
                (macd?.histogram && macd.histogram < 0) ||
                cci?.condition === 'STRONG_BEARISH' ||
                (cci?.value && cci.value < 0) ||
                candleAnalysis?.isBearish
            );

            if (currentClose >= donchian.middle && isBullishIndicators) {
                trend = 'BULLISH';
            } else if (currentClose <= donchian.middle && isBearishIndicators) {
                trend = 'BEARISH';
            } else if (currentClose > donchian.middle) {
                trend = 'BULLISH';
            } else if (currentClose < donchian.middle) {
                trend = 'BEARISH';
            } else {
                trend = 'RANGE';
            }
        }

        const confirmed = trend !== 'RANGE';
        const entryReady =
            tfKey === '1m'
                ? candleAnalysis !== null &&
                  candleAnalysis.pattern !== 'DOJI' &&
                  (candleAnalysis.closePosition === 'STRONG_BULLISH_CLOSE' ||
                      candleAnalysis.closePosition === 'STRONG_BEARISH_CLOSE' ||
                      candleAnalysis.closePosition === 'LOWER_WICK_REJECTION' ||
                      candleAnalysis.closePosition === 'UPPER_WICK_REJECTION')
                : confirmed;

        return {
            timeframe: tfKey,
            trend,
            confirmed,
            entryReady,
            donchian,
            cci,
            macd,
            candle: candleAnalysis,
            activity,
            lastPrice: this.latestPrice,
        };
    }

    /**
     * Retrieve available symbols categorized into Volatility, Forex, etc.
     */
    public static async getAvailableSymbols(): Promise<MarketSymbolInfo[]> {
        const fallbackList: MarketSymbolInfo[] = [
            { symbol: 'R_10', displayName: 'Volatility 10 Index', market: 'synthetic_index', submarket: 'random_index', category: 'volatility', isOpen: true, pipSize: 3 },
            { symbol: 'R_25', displayName: 'Volatility 25 Index', market: 'synthetic_index', submarket: 'random_index', category: 'volatility', isOpen: true, pipSize: 3 },
            { symbol: 'R_50', displayName: 'Volatility 50 Index', market: 'synthetic_index', submarket: 'random_index', category: 'volatility', isOpen: true, pipSize: 4 },
            { symbol: 'R_75', displayName: 'Volatility 75 Index', market: 'synthetic_index', submarket: 'random_index', category: 'volatility', isOpen: true, pipSize: 4 },
            { symbol: 'R_100', displayName: 'Volatility 100 Index', market: 'synthetic_index', submarket: 'random_index', category: 'volatility', isOpen: true, pipSize: 2 },
            { symbol: '1HZ10V', displayName: 'Volatility 10 (1s) Index', market: 'synthetic_index', submarket: 'random_index', category: 'volatility', isOpen: true, pipSize: 2 },
            { symbol: '1HZ25V', displayName: 'Volatility 25 (1s) Index', market: 'synthetic_index', submarket: 'random_index', category: 'volatility', isOpen: true, pipSize: 2 },
            { symbol: '1HZ50V', displayName: 'Volatility 50 (1s) Index', market: 'synthetic_index', submarket: 'random_index', category: 'volatility', isOpen: true, pipSize: 4 },
            { symbol: '1HZ75V', displayName: 'Volatility 75 (1s) Index', market: 'synthetic_index', submarket: 'random_index', category: 'volatility', isOpen: true, pipSize: 2 },
            { symbol: '1HZ100V', displayName: 'Volatility 100 (1s) Index', market: 'synthetic_index', submarket: 'random_index', category: 'volatility', isOpen: true, pipSize: 2 },
        ];

        try {
            let symbols = (api_base as any)?.active_symbols;
            if (!Array.isArray(symbols) || symbols.length === 0) {
                if (api_base?.api) {
                    const res = await (api_base.api as any).send({ active_symbols: 'brief', product_type: 'basic' });
                    symbols = res?.active_symbols;
                }
            }

            if (Array.isArray(symbols) && symbols.length > 0) {
                return symbols
                    .filter((s: any) => !s.is_trading_suspended && s.exchange_is_open)
                    .map((s: any) => {
                        let category: 'volatility' | 'forex' | 'other' = 'other';
                        if (s.market === 'synthetic_index') category = 'volatility';
                        else if (s.market === 'forex') category = 'forex';

                        return {
                            symbol: s.symbol,
                            displayName: s.display_name || s.symbol,
                            market: s.market || '',
                            submarket: s.submarket || '',
                            category,
                            isOpen: Boolean(s.exchange_is_open),
                            pipSize: s.pip_size || 2,
                        };
                    });
            }
        } catch (e) {
            console.warn('[DerivMarketFeed] Error retrieving active_symbols, using curated list:', e);
        }

        return fallbackList;
    }
}
