import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { buildSmartchartsChampionAdapter, transformations } from '@/adapters/smartcharts-champion';
import { createServices } from '@/adapters/smartcharts-champion/services';
import { createTransport } from '@/adapters/smartcharts-champion/transport';
import { ALL_DERIV_MARKETS } from '@/constants/markets';
import chart_api from '@/external/bot-skeleton/services/api/chart-api';
import type { SmartchartsChampionAdapter } from '@/types/smartchart.types';
import type {
    ActiveSymbols,
    TGetQuotes,
    TGranularity,
    TradingTimesMap,
    TSubscribeQuotes,
    TUnsubscribeQuotes,
} from '@deriv-com/smartcharts-champion';

// Logger utility
const logger = {
    log: () => {}, // Disabled in production
    warn: console.warn.bind(console, '[SmartCharts Hook]'),
    error: console.error.bind(console, '[SmartCharts Hook]'),
};

// Type guard for valid granularity values
function isValidGranularity(value: unknown): value is TGranularity {
    const validGranularities = [0, 60, 120, 180, 300, 600, 900, 1800, 3600, 7200, 14400, 28800, 86400];
    return typeof value === 'number' && validGranularities.includes(value);
}

interface UseSmartChartAdaptorReturn {
    adapter: SmartchartsChampionAdapter | null;
    adapterInitialized: boolean;
    chartData: {
        activeSymbols: ActiveSymbols;
        tradingTimes: TradingTimesMap;
    };
    getQuotes: TGetQuotes;
    subscribeQuotes: TSubscribeQuotes;
    unsubscribeQuotes: TUnsubscribeQuotes;
    isLoading: boolean;
    error: Error | null;
}

const FALLBACK_SYMBOLS_LIST = [
    { value: 'R_10', label: 'Volatility 10 Index', group: 'Continuous Indices', market: 'synthetic_index', submarket: 'random_index' },
    { value: 'R_25', label: 'Volatility 25 Index', group: 'Continuous Indices', market: 'synthetic_index', submarket: 'random_index' },
    { value: 'R_50', label: 'Volatility 50 Index', group: 'Continuous Indices', market: 'synthetic_index', submarket: 'random_index' },
    { value: 'R_75', label: 'Volatility 75 Index', group: 'Continuous Indices', market: 'synthetic_index', submarket: 'random_index' },
    { value: 'R_100', label: 'Volatility 100 Index', group: 'Continuous Indices', market: 'synthetic_index', submarket: 'random_index' },
    { value: '1HZ10V', label: 'Volatility 10 (1s) Index', group: 'Continuous Indices', market: 'synthetic_index', submarket: 'random_index' },
    { value: '1HZ25V', label: 'Volatility 25 (1s) Index', group: 'Continuous Indices', market: 'synthetic_index', submarket: 'random_index' },
    { value: '1HZ50V', label: 'Volatility 50 (1s) Index', group: 'Continuous Indices', market: 'synthetic_index', submarket: 'random_index' },
    { value: '1HZ75V', label: 'Volatility 75 (1s) Index', group: 'Continuous Indices', market: 'synthetic_index', submarket: 'random_index' },
    { value: '1HZ100V', label: 'Volatility 100 (1s) Index', group: 'Continuous Indices', market: 'synthetic_index', submarket: 'random_index' },
    { value: 'CRASH500', label: 'Crash 500 Index', group: 'Crash/Boom Indices', market: 'synthetic_index', submarket: 'crash_index' },
    { value: 'CRASH1000', label: 'Crash 1000 Index', group: 'Crash/Boom Indices', market: 'synthetic_index', submarket: 'crash_index' },
    { value: 'BOOM500', label: 'Boom 500 Index', group: 'Crash/Boom Indices', market: 'synthetic_index', submarket: 'crash_index' },
    { value: 'BOOM1000', label: 'Boom 1000 Index', group: 'Crash/Boom Indices', market: 'synthetic_index', submarket: 'crash_index' },
    { value: 'JD10', label: 'Jump 10 Index', group: 'Jump Indices', market: 'synthetic_index', submarket: 'jump_index' },
    { value: 'JD25', label: 'Jump 25 Index', group: 'Jump Indices', market: 'synthetic_index', submarket: 'jump_index' },
    { value: 'JD50', label: 'Jump 50 Index', group: 'Jump Indices', market: 'synthetic_index', submarket: 'jump_index' },
    { value: 'JD75', label: 'Jump 75 Index', group: 'Jump Indices', market: 'synthetic_index', submarket: 'jump_index' },
    { value: 'JD100', label: 'Jump 100 Index', group: 'Jump Indices', market: 'synthetic_index', submarket: 'jump_index' },
    { value: 'STPIND', label: 'Step Index', group: 'Step Indices', market: 'synthetic_index', submarket: 'step_index' },
    { value: 'STEP100', label: 'Step 100 Index', group: 'Step Indices', market: 'synthetic_index', submarket: 'step_index' },
    { value: 'RDBEAR', label: 'Range Break 100 Index', group: 'Range Break Indices', market: 'synthetic_index', submarket: 'range_break' },
    { value: 'RDBULL', label: 'Range Break 200 Index', group: 'Range Break Indices', market: 'synthetic_index', submarket: 'range_break' },
];

const getStaticFallbackChartData = (): { activeSymbols: ActiveSymbols; tradingTimes: TradingTimesMap } => {
    const list =
        typeof ALL_DERIV_MARKETS !== 'undefined' && Array.isArray(ALL_DERIV_MARKETS) && ALL_DERIV_MARKETS.length > 0
            ? ALL_DERIV_MARKETS
            : FALLBACK_SYMBOLS_LIST;
    const fallbackActive = transformations.toActiveSymbols(
        list.map(m => ({
            symbol: m.value,
            underlying_symbol: m.value,
            display_name: m.label,
            market: (m as any).market || 'synthetic_index',
            market_display_name: 'Derived',
            submarket: (m as any).submarket || 'random_index',
            submarket_display_name: m.group || 'Continuous Indices',
            subgroup: 'synthetics',
            subgroup_display_name: 'Synthetics',
            pip: 0.01,
            delay_amount: 0,
            exchange_is_open: 1,
            is_trading_suspended: 0,
        }))
    );
    const fallbackTimes = transformations.toTradingTimesMap({}, fallbackActive);
    return { activeSymbols: fallbackActive, tradingTimes: fallbackTimes };
};

/**
 * Custom hook for SmartChart Adaptor
 * Handles adapter initialization, data fetching, and subscription management
 * with proper memoization and memory leak prevention
 */
export const useSmartChartAdaptor = (): UseSmartChartAdaptorReturn => {
    // State management
    // Bump this when cached_active_symbols data shape changes
    const CHART_CACHE_VERSION = 'v5_safe_fraction_pip';

    const getInitialChartData = (): { activeSymbols: ActiveSymbols; tradingTimes: TradingTimesMap } => {
        try {
            if (typeof window !== 'undefined' && window.localStorage) {
                const cachedVersion = localStorage.getItem('cached_active_symbols_version');
                if (cachedVersion !== CHART_CACHE_VERSION) {
                    // Stale cache - discard and use static fallback
                    try {
                        localStorage.removeItem('cached_active_symbols');
                        localStorage.setItem('cached_active_symbols_version', CHART_CACHE_VERSION);
                    } catch {}
                    return getStaticFallbackChartData();
                }
                const cached = localStorage.getItem('cached_active_symbols');
                if (cached) {
                    const parsed = JSON.parse(cached);
                    if (Array.isArray(parsed) && parsed.length > 0) {
                        const activeSymbols = transformations.toActiveSymbols(parsed);
                        const tradingTimes = transformations.toTradingTimesMap({}, activeSymbols);
                        return { activeSymbols, tradingTimes };
                    }
                }
            }
        } catch {}
        return getStaticFallbackChartData();
    };

    const adapter = useMemo(
        () =>
            buildSmartchartsChampionAdapter(createTransport(), createServices(), {
                debug: false,
                subscriptionTimeout: 30000,
            }),
        []
    );
    const [chartData, setChartData] = useState<{
        activeSymbols: ActiveSymbols;
        tradingTimes: TradingTimesMap;
    }>(getInitialChartData);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<Error | null>(null);

    // Refs to track mounted state and prevent memory leaks
    const isMountedRef = useRef(true);
    const cleanupFunctionsRef = useRef<Array<() => void>>([]);
    const retryTimeoutRef = useRef<NodeJS.Timeout | null>(null); // Ref to store timeout for cleanup

    // Track mounted state
    useEffect(() => {
        isMountedRef.current = true;
        // Proactively initialize chart_api in parallel
        chart_api.init?.().catch(() => {});

        return () => {
            isMountedRef.current = false;

            // Clear any pending retry timeouts
            if (retryTimeoutRef.current) {
                clearTimeout(retryTimeoutRef.current);
                retryTimeoutRef.current = null;
            }
        };
    }, []);

    // Load chart data on mount
    useEffect(() => {
        let cancelled = false;

        const loadChartData = async (retryCount = 0, maxRetries = 5, delayMs = 150) => {
            try {
                const data = await adapter.getChartData();

                if (!cancelled && isMountedRef.current) {
                    // Check if activeSymbols is empty and we have retries left
                    if (data.activeSymbols.length === 0 && retryCount < maxRetries) {
                        if (retryTimeoutRef.current) {
                            clearTimeout(retryTimeoutRef.current);
                        }

                        retryTimeoutRef.current = setTimeout(() => {
                            if (!cancelled && isMountedRef.current) {
                                loadChartData(retryCount + 1, maxRetries, delayMs);
                            }
                        }, delayMs);

                        return;
                    }

                    if (data.activeSymbols.length > 0) {
                        setChartData({
                            activeSymbols: data.activeSymbols,
                            tradingTimes: data.tradingTimes,
                        });
                    }
                    setIsLoading(false);
                    setError(null);
                }
            } catch (err) {
                if (!cancelled && isMountedRef.current && retryCount < maxRetries) {
                    if (retryTimeoutRef.current) {
                        clearTimeout(retryTimeoutRef.current);
                    }

                    retryTimeoutRef.current = setTimeout(() => {
                        if (!cancelled && isMountedRef.current) {
                            loadChartData(retryCount + 1, maxRetries, delayMs);
                        }
                    }, delayMs);

                    return;
                }

                if (!cancelled && isMountedRef.current) {
                    setIsLoading(false);
                }
            }
        };

        loadChartData();

        return () => {
            cancelled = true;
            if (retryTimeoutRef.current) {
                clearTimeout(retryTimeoutRef.current);
                retryTimeoutRef.current = null;
            }
        };
    }, [adapter]);

    // Memoized getQuotes function
    const getQuotes: TGetQuotes = useCallback(
        async params => {
            try {
                const result = await adapter.getQuotes({
                    symbol: params.symbol,
                    granularity: isValidGranularity(params.granularity) ? params.granularity : 0,
                    count: params.count,
                    start: params.start,
                    end: params.end,
                });

                if (!result) {
                    return params.granularity === 0 ? { history: { prices: [], times: [] } } : { candles: [] };
                }

                // Prefer raw history and candles if provided by adapter
                if (params.granularity === 0) {
                    if (result.history && Array.isArray(result.history.prices) && Array.isArray(result.history.times)) {
                        return {
                            history: {
                                prices: (result.history.prices || []).map((p: any) => +(p ?? 0)),
                                times: (result.history.times || []).map((t: any) => +(t ?? 0)),
                            },
                        };
                    }
                    const quotes = Array.isArray(result.quotes) ? result.quotes : [];
                    return {
                        history: {
                            prices: quotes.map(q => +(q?.Close ?? q?.close ?? 0)),
                            times: quotes.map(q => {
                                const dtEpoch = q?.DT ? Math.floor(q.DT.getTime() / 1000) : NaN;
                                if (Number.isFinite(dtEpoch) && dtEpoch > 100000) return dtEpoch;
                                const parsed = parseInt(q?.Date || '');
                                return Number.isFinite(parsed) && parsed > 100000 ? parsed : Math.floor(Date.now() / 1000);
                            }),
                        },
                    };
                } else {
                    if (result.candles && Array.isArray(result.candles)) {
                        return {
                            candles: result.candles.map((c: any) => ({
                                open: +(c?.open ?? c?.Open ?? 0),
                                high: +(c?.high ?? c?.High ?? 0),
                                low: +(c?.low ?? c?.Low ?? 0),
                                close: +(c?.close ?? c?.Close ?? 0),
                                epoch: +(c?.epoch ?? c?.Epoch ?? 0),
                            })),
                        };
                    }
                    const quotes = Array.isArray(result.quotes) ? result.quotes : [];
                    return {
                        candles: quotes.map(q => {
                            const dtEpoch = q?.DT ? Math.floor(q.DT.getTime() / 1000) : NaN;
                            const epoch = Number.isFinite(dtEpoch) && dtEpoch > 100000
                                ? dtEpoch
                                : (parseInt(q?.Date || '') || Math.floor(Date.now() / 1000));
                            return {
                                open: +(q?.Open ?? q?.Close ?? q?.open ?? q?.close ?? 0),
                                high: +(q?.High ?? q?.Close ?? q?.high ?? q?.close ?? 0),
                                low: +(q?.Low ?? q?.Close ?? q?.low ?? q?.close ?? 0),
                                close: +(q?.Close ?? q?.close ?? 0),
                                epoch,
                            };
                        }),
                    };
                }
            } catch (err) {
                console.error('[SmartCharts Hook] Error in getQuotes:', err);
                return params.granularity === 0 ? { history: { prices: [], times: [] } } : { candles: [] };
            }
        },
        [adapter]
    );

    // Memoized subscribeQuotes function
    const subscribeQuotes: TSubscribeQuotes = useCallback(
        (params, callback) => {
            console.log('[SmartCharts] subscribeQuotes called with params:', params);
            if (!adapter) {
                return () => {};
            }

            const unsubscribe = adapter.subscribeQuotes(
                {
                    symbol: params.symbol,
                    granularity: isValidGranularity(params.granularity) ? params.granularity : 0,
                },
                quote => {
                    if (isMountedRef.current) {
                        callback(quote);
                    }
                }
            );

            // Create wrapper BEFORE storing/returning to avoid race condition
            const wrappedUnsubscribe = () => {
                unsubscribe();
                const index = cleanupFunctionsRef.current.indexOf(wrappedUnsubscribe);
                if (index > -1) {
                    cleanupFunctionsRef.current.splice(index, 1);
                }
            };

            // Store BEFORE returning to avoid race condition
            cleanupFunctionsRef.current.push(wrappedUnsubscribe);

            return wrappedUnsubscribe;
        },
        [adapter]
    );

    // Memoized unsubscribeQuotes function
    const unsubscribeQuotes: TUnsubscribeQuotes = useCallback(
        request => {
            if (adapter) {
                // If we have request details, use the adapter's unsubscribe method
                if (request?.symbol && typeof request.granularity !== 'undefined') {
                    adapter.unsubscribeQuotes({
                        symbol: request.symbol,
                        granularity: isValidGranularity(request.granularity) ? request.granularity : 0,
                    });
                } else {
                    // Fallback: unsubscribe all via transport
                    adapter.transport.unsubscribeAll('ticks');
                }
            }
        },
        [adapter]
    );

    // Cleanup effect - runs on unmount
    useEffect(() => {
        return () => {
            // Execute all cleanup functions
            cleanupFunctionsRef.current.forEach(cleanup => {
                try {
                    cleanup();
                } catch (err) {
                    logger.error('Error during cleanup:', err);
                }
            });
            cleanupFunctionsRef.current = [];

            // Unsubscribe from all ticks
            try {
                chart_api.api?.forgetAll('ticks');
            } catch (err) {
                logger.error('Error forgetting ticks:', err);
            }

            // Clean up adapter subscriptions
            if (adapter?.transport) {
                try {
                    adapter.transport.unsubscribeAll('ticks');
                } catch (err) {
                    logger.error('Error unsubscribing from adapter:', err);
                }
            }

            // Clear any pending retry timeouts
            if (retryTimeoutRef.current) {
                clearTimeout(retryTimeoutRef.current);
                retryTimeoutRef.current = null;
            }
        };
    }, [adapter]);

    // Return object without useMemo wrapper (callbacks are already memoized)
    return {
        adapter,
        adapterInitialized: true,
        chartData,
        getQuotes,
        subscribeQuotes,
        unsubscribeQuotes,
        isLoading,
        error,
    };
};
