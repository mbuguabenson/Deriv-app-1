import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { generateOAuthURL, TradingMilestoneModal } from '@/components/shared';
import { api_base } from '@/external/bot-skeleton';

import {
    autoListStrategies,
    autoPause,
    autoResume,
    autoStart,
    autoStop,
} from '@/external/bot-skeleton/services/api/automation';
import { observer as globalObserver } from '@/external/bot-skeleton/utils/observer';
import { useStore } from '@/hooks/useStore';
import { SUPPORTED_VOLATILITY_MARKETS } from '@/utils/digit-strategy';
import { isLoggedIn } from '@/utils/token-bridge';
import { buyContractForUi, streamContractUntilSettled } from '@/utils/trade-purchase';
import { safeSubscribe, subscribeTicks, derivTickManager } from '@/utils/websocket-handler';
import './elite-pro.scss';

// ─── Types ─────────────────────────────────────────────────────────────────────

type MarketDigitData = {
    symbol: string;
    label: string;
    digits: number[];
    currentPrice: string;
    lastDigit: number;
    tickCount?: number;
};

type TradeLogEntry = {
    id: string;
    time: string;
    type: string;
    market: string;
    result: 'WIN' | 'LOSS' | 'PENDING' | 'ABORTED';
    profit: number;
    contractId?: number;
    details?: string;
};

type AutoState = 'IDLE' | 'SCANNING' | 'WAITING_TRIGGER' | 'TRADING' | 'PAUSED';
type ExecutionMode = 'local' | 'deriv_server';

type StrategyOption = {
    id: string;
    name?: string;
};

// ─── Constants ─────────────────────────────────────────────────────────────────

const MARKETS = SUPPORTED_VOLATILITY_MARKETS.map(m => ({
    symbol: m.symbol,
    label: m.label.replace('Volatility ', 'Vol ').replace(' Index', ''),
}));

const MAX_DIGITS = 100;
const CHART_DIGITS = 50;
const ANALYSIS_WINDOW = 50;

// ─── Helpers ───────────────────────────────────────────────────────────────────

const extractDigitFromPrice = (quote: number | string): number => {
    const s = String(quote);
    const parts = s.split('.');
    const dec = parts[1] || '0';
    return parseInt(dec[dec.length - 1] || '0', 10);
};

const countDigitsInRange = (digits: number[], low: number, high: number): number =>
    digits.filter(d => d >= low && d <= high).length;

const cleanMoneyInput = (v: string) => v.replace(/[^\d.]/g, '').replace(/(\..*)\./g, '$1');

// Generates smooth bezier curves for SVG line chart
const getBezierPath = (points: { x: number; y: number }[]) => {
    if (points.length < 2) return '';
    let d = `M ${points[0].x.toFixed(1)},${points[0].y.toFixed(1)}`;
    for (let i = 0; i < points.length - 1; i++) {
        const p0 = points[i];
        const p1 = points[i + 1];
        const cpX1 = p0.x + (p1.x - p0.x) / 2;
        const cpY1 = p0.y;
        const cpX2 = p0.x + (p1.x - p0.x) / 2;
        const cpY2 = p1.y;
        d += ` C ${cpX1.toFixed(1)},${cpY1.toFixed(1)} ${cpX2.toFixed(1)},${cpY2.toFixed(1)} ${p1.x.toFixed(1)},${p1.y.toFixed(1)}`;
    }
    return d;
};

// ─── SVG Spline Line Chart ─────────────────────────────────────────────────────

const DigitLineChart: React.FC<{ digits: number[] }> = ({ digits }) => {
    const slice = digits.slice(-CHART_DIGITS);
    if (slice.length < 2) {
        return (
            <div className='ep-chart-empty'>
                <span className='ep-chart-empty__icon'>📊</span>
                Waiting for tick stream...
            </div>
        );
    }

    const W = Math.max(760, slice.length * 15.5);
    const H = 140;
    const padTop = 26;
    const padBot = 18;
    const usableH = H - padTop - padBot;
    const stepX = (W - 20) / (slice.length - 1);

    const points = slice.map((d, i) => ({
        x: 10 + i * stepX,
        y: padTop + usableH - (d / 9) * usableH,
        d,
    }));

    const pathD = getBezierPath(points);

    return (
        <div className='ep-chart-inner-scroll'>
            <svg
                width='100%'
                height={H}
                viewBox={`0 0 ${W} ${H}`}
                preserveAspectRatio='none'
                style={{ display: 'block', minWidth: `${W}px` }}
            >
                <defs>
                    <linearGradient id='epLineGrad' x1='0%' y1='0%' x2='100%' y2='0%'>
                        <stop offset='0%' stopColor='#8b5cf6' stopOpacity='0.7' />
                        <stop offset='50%' stopColor='#a855f7' stopOpacity='1' />
                        <stop offset='100%' stopColor='#c084fc' stopOpacity='0.9' />
                    </linearGradient>
                    <filter id='epGlow' x='-20%' y='-20%' width='140%' height='140%'>
                        <feDropShadow dx='0' dy='2' stdDeviation='3' floodColor='#9333ea' floodOpacity='0.6' />
                    </filter>
                </defs>

                {/* Horizontal reference grid lines */}
                {[0, 3, 6, 9].map(level => {
                    const y = padTop + usableH - (level / 9) * usableH;
                    return (
                        <g key={level} className='ep-chart-grid-line'>
                            <line
                                x1='0'
                                y1={y}
                                x2={W}
                                y2={y}
                                stroke='var(--ep-svg-line-stroke)'
                                strokeWidth='1'
                                strokeDasharray={level === 3 || level === 6 ? '3 3' : undefined}
                            />
                            <text x='4' y={y - 3} fill='var(--ep-svg-text-fill)' fontSize='9' fontFamily='monospace'>
                                {level}
                            </text>
                        </g>
                    );
                })}

                {/* Main Bezier Line path */}
                {pathD && (
                    <path
                        d={pathD}
                        fill='none'
                        stroke='url(#epLineGrad)'
                        strokeWidth={2.4}
                        strokeLinejoin='round'
                        strokeLinecap='round'
                        filter='url(#epGlow)'
                    />
                )}

                {/* Dots and purple bold digit labels */}
                {points.map((p, i) => {
                    const isLatest = i === points.length - 1;
                    const isUnder = p.d < 5;
                    return (
                        <g key={i} className={`ep-chart-point ${isLatest ? 'ep-chart-point--latest' : ''}`}>
                            <rect
                                x={p.x - 3}
                                y={p.y - 3}
                                width={6}
                                height={6}
                                rx={1.5}
                                fill={
                                    isLatest
                                        ? 'var(--ep-svg-orb-fill)'
                                        : isUnder
                                          ? 'var(--ep-accent-green)'
                                          : 'var(--ep-accent-orange)'
                                }
                                stroke='var(--ep-accent-purple)'
                                strokeWidth={1.5}
                            />
                            <text
                                x={p.x}
                                y={p.y - 8}
                                textAnchor='middle'
                                fill={isLatest ? 'var(--ep-svg-orb-text)' : 'var(--ep-svg-orb-text-muted)'}
                                fontSize={isLatest ? 12 : 11}
                                fontWeight={800}
                                fontFamily='system-ui, -apple-system, sans-serif'
                            >
                                {p.d}
                            </text>
                        </g>
                    );
                })}
            </svg>
        </div>
    );
};

// ─── Main Component ────────────────────────────────────────────────────────────

const ElitePro = observer(() => {
    const store = useStore();
    const { client, run_panel, summary_card, transactions } = store;
    const showElitePro = true;
    const currency = client?.currency || 'USD';
    const logged_in = Boolean(client?.is_logged_in || isLoggedIn() || api_base.is_authorized);

    // ── Mode Toggle state ──
    const [executionMode, setExecutionMode] = useState<ExecutionMode>('local');
    const [strategies, setStrategies] = useState<StrategyOption[]>([]);
    const [selectedStrategy, setSelectedStrategy] = useState('martingale');
    const [activeRunId, setActiveRunId] = useState<string | null>(null);
    const [serverRunStatus, setServerRunStatus] = useState<string>('idle');

    // ── Market state ──
    const [selectedSymbol, setSelectedSymbol] = useState(MARKETS[0].symbol);
    const [scanAll, setScanAll] = useState(true);
    const [autoInputBestMarket, setAutoInputBestMarket] = useState(false);
    const [autoSwitchMarkets, setAutoSwitchMarkets] = useState(true);
    const [maxRunsBeforeSwitch, setMaxRunsBeforeSwitch] = useState('7');
    const [marketsSideExpanded, setMarketsSideExpanded] = useState(true);
    const marketsRef = useRef<Map<string, MarketDigitData>>(new Map());
    const [renderTick, forceRender] = useState(0);
    const subscriptionsRef = useRef<Map<string, { unsubscribe: () => void }>>(new Map());
    const unmountedRef = useRef(false);
    const uiThrottleRef = useRef(0);
    const throttleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const selectedSymbolRef = useRef(MARKETS[0].symbol);

    // Component lifecycle
    useEffect(() => {
        unmountedRef.current = false;
        return () => {
            unmountedRef.current = true;
            if (throttleTimerRef.current) {
                clearTimeout(throttleTimerRef.current);
                throttleTimerRef.current = null;
            }
        };
    }, []);

    // Keep selectedSymbolRef in sync
    useEffect(() => {
        selectedSymbolRef.current = selectedSymbol;
    }, [selectedSymbol]);

    // ── Autotrading parameters ──
    const [autoState, setAutoState] = useState<AutoState>('IDLE');
    const [stake, setStake] = useState('0.35');
    const [takeProfit, setTakeProfit] = useState('10');
    const [stopLoss, setStopLoss] = useState('5');
    const [martingale, setMartingale] = useState('2.6');
    const [tickDuration, setTickDuration] = useState('1');
    const [tradeLog, setTradeLog] = useState<TradeLogEntry[]>([]);
    const [totalProfit, setTotalProfit] = useState(0);
    const [wins, setWins] = useState(0);
    const [losses, setLosses] = useState(0);
    const [milestone, setMilestone] = useState<{ isOpen: boolean; type: 'tp' | 'sl' | null }>({
        isOpen: false,
        type: null,
    });

    const currentStakeRef = useRef(0.35);
    const autoAbortRef = useRef<AbortController | null>(null);
    const autoStateRef = useRef<AutoState>('IDLE');
    const contractStreamAbortRef = useRef<Set<AbortController>>(new Set());
    const serverSubscriptionRef = useRef<{ unsubscribe: () => void } | null>(null);

    const totalProfitRef = useRef(0);
    const winsRef = useRef(0);
    const lossesRef = useRef(0);

    // Sync refs with state
    useEffect(() => {
        autoStateRef.current = autoState;
    }, [autoState]);
    useEffect(() => {
        currentStakeRef.current = parseFloat(stake) || 0.35;
    }, [stake]);
    useEffect(() => {
        totalProfitRef.current = totalProfit;
    }, [totalProfit]);
    useEffect(() => {
        winsRef.current = wins;
    }, [wins]);
    useEffect(() => {
        lossesRef.current = losses;
    }, [losses]);

    // ── Handle manual market selection (Seamless market transition without stopping bot) ──
    const handleManualMarketSelect = useCallback(
        (sym: string) => {
            setSelectedSymbol(sym);
            selectedSymbolRef.current = sym;
            if (autoInputBestMarket) setAutoInputBestMarket(false);

            if (autoStateRef.current !== 'IDLE') {
                const label = MARKETS.find(m => m.symbol === sym)?.label || sym;
                setTradeLog(prev =>
                    [
                        {
                            id: `EP-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                            time: new Date().toLocaleTimeString(),
                            type: 'MARKET SWITCHED',
                            market: label,
                            result: 'PENDING' as const,
                            profit: 0,
                            details: `Focused trading on ${label}`,
                        },
                        ...prev,
                    ].slice(0, 100)
                );
            }
        },
        [autoInputBestMarket]
    );

    // ── Fetch Deriv Automation strategies if in server mode ──
    useEffect(() => {
        if (executionMode === 'deriv_server' && logged_in) {
            const fetchStrats = async () => {
                try {
                    const res = await autoListStrategies();
                    if (res?.auto_list_strategies?.strategies) {
                        setStrategies(res.auto_list_strategies.strategies);
                    } else {
                        setStrategies([{ id: 'martingale', name: 'Martingale Strategy' }]);
                    }
                } catch {
                    setStrategies([{ id: 'martingale', name: 'Martingale Strategy' }]);
                }
            };
            void fetchStrats();
        }
    }, [executionMode, logged_in]);

    // ── Compute full statistical analysis ──
    const computeAnalysis = useCallback((digits: number[]) => {
        const slice = digits.slice(-ANALYSIS_WINDOW);
        const total = slice.length || 1;

        // 1. Under 0-4 vs Over 5-9
        const under04 = countDigitsInRange(slice, 0, 4);
        const over59 = countDigitsInRange(slice, 5, 9);
        const pctUnder04 = (under04 / total) * 100;
        const pctOver59 = (over59 / total) * 100;

        // 2. Under 0-5 vs Over 4-9
        const under05 = countDigitsInRange(slice, 0, 5);
        const over49 = countDigitsInRange(slice, 4, 9);
        const pctUnder05 = (under05 / total) * 100;
        const pctOver49 = (over49 / total) * 100;

        // 3. Momentum & Trend Momentum calculation (using purely the 50-tick window)
        const firstHalf = slice.slice(0, 25);
        const secondHalf = slice.slice(25);
        const firstHalfUnder = firstHalf.length > 0 ? (countDigitsInRange(firstHalf, 0, 5) / 25) * 100 : 50;
        const firstHalfOver = firstHalf.length > 0 ? (countDigitsInRange(firstHalf, 4, 9) / 25) * 100 : 50;
        const secondHalfUnder = secondHalf.length > 0 ? (countDigitsInRange(secondHalf, 0, 5) / 25) * 100 : 50;
        const secondHalfOver = secondHalf.length > 0 ? (countDigitsInRange(secondHalf, 4, 9) / 25) * 100 : 50;

        const underIncreasing = secondHalfUnder >= firstHalfUnder;
        const overIncreasing = secondHalfOver >= firstHalfOver;

        // 4. Frequency distribution & Highest Digits
        const freq = new Array(10).fill(0);
        slice.forEach(d => {
            if (d >= 0 && d <= 9) freq[d]++;
        });

        // Highest Entry Digit in Under (0-5)
        const underFreq = freq.slice(0, 6);
        let maxUnderCount = -1;
        let highestUnderDigit = 0;
        underFreq.forEach((c, idx) => {
            if (c > maxUnderCount) {
                maxUnderCount = c;
                highestUnderDigit = idx;
            }
        });
        const highestUnderPct = (maxUnderCount / total) * 100;

        // Highest Entry Digit in Over (4-9)
        const overFreq = freq.slice(4, 10);
        let maxOverCount = -1;
        let highestOverDigit = 4;
        overFreq.forEach((c, idx) => {
            if (c > maxOverCount) {
                maxOverCount = c;
                highestOverDigit = idx + 4;
            }
        });
        const highestOverPct = (maxOverCount / total) * 100;

        // Overall dominant side & market bias (comparing true relative dominance)
        let bias: 'under' | 'over' | 'neutral' = 'neutral';
        if (under05 > over49 && under05 >= 28) {
            bias = 'under';
        } else if (over49 > under05 && over49 >= 28) {
            bias = 'over';
        } else if (pctUnder04 >= 52 && pctUnder04 > pctOver59) {
            bias = 'under';
        } else if (pctOver59 >= 52 && pctOver59 > pctUnder04) {
            bias = 'over';
        }

        // Last 10 ticks count
        const last10 = slice.slice(-10);
        const last10UnderCount = last10.filter(d => d <= 5).length;
        const last10OverCount = last10.filter(d => d >= 4).length;
        const last10Under = last10.length === 10 && last10UnderCount >= 8;
        const last10Over = last10.length === 10 && last10OverCount >= 8;

        // Last 15 ticks count
        const last15 = slice.slice(-15);
        const last15UnderCount = last15.filter(d => d <= 5).length;
        const last15OverCount = last15.filter(d => d >= 4).length;
        const last15Under = last15.length === 15 && last15UnderCount >= 11;
        const last15Over = last15.length === 15 && last15OverCount >= 11;

        // Last 7 ticks check (strictly favoring direction)
        const last7 = slice.slice(-7);
        const last7Under = last7.length === 7 && last7.every(d => d < 6);
        const last7Over = last7.length === 7 && last7.every(d => d > 3);

        // Trend flip detection (dominant side losing majority in recent 25 ticks)
        const recent3 = slice.slice(-3);
        const recentTrendFlip =
            (bias === 'under' && recent3.every(d => d >= 7)) || (bias === 'over' && recent3.every(d => d <= 2));

        const secondHalfHighDigits = secondHalf.filter(d => d >= 6).length;
        const secondHalfLowDigits = secondHalf.filter(d => d <= 3).length;

        return {
            under04,
            over59,
            pctUnder04,
            pctOver59,
            under05,
            over49,
            pctUnder05,
            pctOver49,
            highestUnderDigit,
            highestUnderCount: maxUnderCount,
            highestUnderPct,
            highestOverDigit,
            highestOverCount: maxOverCount,
            highestOverPct,
            freq,
            bias,
            last10UnderCount,
            last10OverCount,
            last10Under,
            last10Over,
            last7Under,
            last7Over,
            underIncreasing,
            overIncreasing,
            recentTrendFlip,
            isUnderTrendFlipped: secondHalfHighDigits >= 14,
            isOverTrendFlipped: secondHalfLowDigits >= 14,
            last15Under,
            last15Over,
            total,
        };
    }, []);

    // ── Canonical Elite Pro Strategy State (Over 3 / Under 6 momentum engine) ──
    const targetStrategyRef = useRef<'UNDER_6' | 'OVER_3' | 'AUTO'>('AUTO');
    const [activeTargetStrategy, setActiveTargetStrategy] = useState<'UNDER_6' | 'OVER_3' | 'AUTO'>('AUTO');

    // ── Check entry signal based on canonical Elite Pro XML conditions ──
    const checkEntrySignal = useCallback(
        (
            digits: number[],
            _waitCycles = 0,
            forcedStrategy?: 'UNDER_6' | 'OVER_3'
        ): {
            direction: 'UNDER' | 'OVER';
            prediction: number;
            triggerDigit: number;
            reason: string;
            status: 'WAITING' | 'TRIGGERED';
            isAutoPaused?: boolean;
        } | null => {
            if (digits.length < 15) return null;
            const a = computeAnalysis(digits);
            const currentLastDigit = digits[digits.length - 1];

            // Determine active direction according to Elite Pro strategy state or momentum
            const activeStrat: 'UNDER_6' | 'OVER_3' =
                forcedStrategy ||
                (targetStrategyRef.current !== 'AUTO'
                    ? targetStrategyRef.current
                    : a.under05 >= a.over49
                      ? 'UNDER_6'
                      : 'OVER_3');

            if (activeStrat === 'UNDER_6') {
                // Condition 1 & 2: Under 0-4 vs Over 5-9 >= 55% or (Under 0-5 dominant & last 10 ticks >= 7 under)
                const isConditionMet = a.pctUnder04 >= 55 || (a.under05 >= a.over49 && a.last10UnderCount >= 7);
                // Trigger: wait for highest digit in under to appear (or if under is overwhelmingly strong >= 8/10, any digit <= 4)
                const isTriggered =
                    isConditionMet &&
                    (currentLastDigit === a.highestUnderDigit || (a.last10UnderCount >= 8 && currentLastDigit <= 4));

                return {
                    direction: 'UNDER',
                    prediction: 6,
                    triggerDigit: a.highestUnderDigit,
                    reason: isConditionMet
                        ? `Under 6 Signal Active (U0-4: ${a.pctUnder04}%, U0-5: ${a.under05}/50, Last 10: ${a.last10UnderCount}/10). Trigger Digit: [${a.highestUnderDigit}]`
                        : `Auto-Paused: Market power shifted (U0-4: ${a.pctUnder04}%, Last 10: ${a.last10UnderCount}/10). Auto-resumes when >= 7/10.`,
                    status: isTriggered ? 'TRIGGERED' : 'WAITING',
                    isAutoPaused: !isConditionMet,
                };
            } else {
                // Condition 1 & 2: Over 5-9 vs Under 0-4 >= 55% or (Over 4-9 dominant & last 10 ticks >= 7 over)
                const isConditionMet = a.pctOver59 >= 55 || (a.over49 >= a.under05 && a.last10OverCount >= 7);
                // Trigger: wait for highest digit in over to appear (or if over is overwhelmingly strong >= 8/10, any digit >= 5)
                const isTriggered =
                    isConditionMet &&
                    (currentLastDigit === a.highestOverDigit || (a.last10OverCount >= 8 && currentLastDigit >= 5));

                return {
                    direction: 'OVER',
                    prediction: 3,
                    triggerDigit: a.highestOverDigit,
                    reason: isConditionMet
                        ? `Over 3 Signal Active (O5-9: ${a.pctOver59}%, O4-9: ${a.over49}/50, Last 10: ${a.last10OverCount}/10). Trigger Digit: [${a.highestOverDigit}]`
                        : `Auto-Paused: Market power shifted (O5-9: ${a.pctOver59}%, Last 10: ${a.last10OverCount}/10). Auto-resumes when >= 7/10.`,
                    status: isTriggered ? 'TRIGGERED' : 'WAITING',
                    isAutoPaused: !isConditionMet,
                };
            }
        },
        [computeAnalysis]
    );

    // ── Get active market data ──
    const getActiveData = useCallback((): MarketDigitData | null => {
        const data = marketsRef.current.get(selectedSymbol);
        if (!data) return null;
        return {
            ...data,
            digits: [...data.digits],
        };
    }, [selectedSymbol, renderTick]);

    // ── Throttle UI re-renders with trailing edge so frames are never dropped ──
    const throttleRender = useCallback(() => {
        const now = Date.now();
        const elapsed = now - uiThrottleRef.current;
        if (elapsed >= 80) {
            uiThrottleRef.current = now;
            if (throttleTimerRef.current) {
                clearTimeout(throttleTimerRef.current);
                throttleTimerRef.current = null;
            }
            if (!unmountedRef.current) {
                forceRender(n => (n + 1) % 1000000);
            }
        } else if (!throttleTimerRef.current) {
            throttleTimerRef.current = setTimeout(() => {
                throttleTimerRef.current = null;
                uiThrottleRef.current = Date.now();
                if (!unmountedRef.current) {
                    forceRender(n => (n + 1) % 1000000);
                }
            }, 80 - elapsed);
        }
    }, []);

    // ── Subscribe to real-time ticks for all / selected markets ──
    const [streamRefreshKey, setStreamRefreshKey] = useState(0);

    // Listen to account switch, WebSocket re-auth, and visibility change to refresh live streams
    useEffect(() => {
        const handleRefresh = () => {
            subscriptionsRef.current.forEach(sub => {
                try {
                    sub.unsubscribe();
                } catch {
                    /* ignore */
                }
            });
            subscriptionsRef.current.clear();
            setStreamRefreshKey(k => k + 1);
        };

        const handleVisibility = () => {
            if (!document.hidden) {
                derivTickManager.healStalledStreams();
                setStreamRefreshKey(k => k + 1);
            }
        };

        window.addEventListener('account_switched', handleRefresh);
        document.addEventListener('visibilitychange', handleVisibility);
        globalObserver.register('api.authorize', handleRefresh);

        return () => {
            window.removeEventListener('account_switched', handleRefresh);
            document.removeEventListener('visibilitychange', handleVisibility);
            globalObserver.unregister('api.authorize', handleRefresh);
        };
    }, []);

    const isBotIdle = autoState === 'IDLE';
    useEffect(() => {
        const shouldSubscribe = showElitePro || !isBotIdle;
        const activeSubs = subscriptionsRef.current;

        if (!shouldSubscribe) {
            activeSubs.forEach(sub => {
                try {
                    sub.unsubscribe();
                } catch {
                    /* ignore */
                }
            });
            activeSubs.clear();
            return;
        }

        const symbolsToSubscribe = scanAll ? MARKETS.map(m => m.symbol) : [selectedSymbolRef.current];

        symbolsToSubscribe.forEach(sym => {
            if (!marketsRef.current.has(sym)) {
                const label = MARKETS.find(m => m.symbol === sym)?.label || sym;
                marketsRef.current.set(sym, {
                    symbol: sym,
                    label,
                    digits: [],
                    currentPrice: '—',
                    lastDigit: 0,
                });
            }
        });

        let isEffectActive = true;

        const startSubscription = async (sym: string) => {
            if (!api_base.api || unmountedRef.current) return;
            // If already actively subscribed, skip re-subscribing to prevent rate limits and dropped streams
            if (activeSubs.has(sym)) return;

            try {
                const market = marketsRef.current.get(sym);
                // Only fetch history if we don't already have sufficient digits
                if (!market || market.digits.length < 20) {
                    const res = await api_base.api.send({
                        ticks_history: sym,
                        end: 'latest',
                        count: MAX_DIGITS,
                        style: 'ticks',
                    });
                    if (!isEffectActive || unmountedRef.current) return;

                    if (market && res?.history?.prices) {
                        const prices: number[] = res.history.prices || [];
                        const newDigits = prices.map(p => extractDigitFromPrice(p));
                        market.digits = newDigits.slice(-MAX_DIGITS);
                        if (prices.length > 0) {
                            const lastPrice = prices[prices.length - 1];
                            market.currentPrice = String(lastPrice);
                            market.lastDigit = extractDigitFromPrice(lastPrice);
                        }
                        throttleRender();
                    }
                }

                if (activeSubs.has(sym)) return;

                // Always establish / renew live tick observable via centralized multiplexer
                const sub = subscribeTicks(sym, (data: Record<string, unknown>) => {
                    if (unmountedRef.current) return;

                    const activeMarket = marketsRef.current.get(sym);
                    if (!activeMarket) return;

                    const tickData = data?.tick as { quote?: number | string } | undefined;
                    const quote = tickData?.quote;
                    if (quote !== undefined && quote !== null) {
                        const digit = extractDigitFromPrice(quote);
                        activeMarket.digits.push(digit);
                        if (activeMarket.digits.length > MAX_DIGITS) activeMarket.digits.shift();
                        activeMarket.currentPrice = String(quote);
                        activeMarket.lastDigit = digit;
                        activeMarket.tickCount = (activeMarket.tickCount || 0) + 1;
                        throttleRender();
                    }
                });

                activeSubs.set(sym, sub);
            } catch (err) {
                console.error(`[ElitePro] Subscription error for ${sym}:`, err);
            }
        };

        let retryTimeout: ReturnType<typeof setTimeout> | null = null;
        const initSubscriptions = async () => {
            if (!api_base.api) {
                retryTimeout = setTimeout(initSubscriptions, 1000);
                return;
            }
            for (const sym of symbolsToSubscribe) {
                if (!isEffectActive || unmountedRef.current) break;
                await startSubscription(sym);
                await new Promise(r => setTimeout(r, 100)); // Gentle throttle to prevent Deriv WS rate limiting
            }
        };

        void initSubscriptions();

        activeSubs.forEach((sub, sym) => {
            if (!symbolsToSubscribe.includes(sym)) {
                try {
                    sub.unsubscribe();
                } catch {
                    /* ignore */
                }
                activeSubs.delete(sym);
            }
        });

        return () => {
            isEffectActive = false;
            if (retryTimeout) clearTimeout(retryTimeout);
        };
    }, [scanAll, showElitePro, client?.loginid, isBotIdle, throttleRender, streamRefreshKey]);

    // ── Active Market Data & Analysis ──
    const activeData = getActiveData();
    const analysis = useMemo(() => {
        if (!activeData || activeData.digits.length < 15) return null;
        return computeAnalysis(activeData.digits);
    }, [activeData, computeAnalysis, renderTick]);

    const activeSignal = useMemo(() => {
        if (!activeData || activeData.digits.length < 25) return null;
        return checkEntrySignal(activeData.digits);
    }, [activeData, checkEntrySignal, renderTick]);

    // ── Multi-Market Comparative Overview ──
    const allMarketsData = useMemo(() => {
        const result: Array<{
            symbol: string;
            label: string;
            currentPrice: string;
            lastDigit: number;
            bias: string;
            strength: number;
            pctUnder04: number;
            pctOver59: number;
            under05: number;
            over49: number;
            pctUnder05: number;
            pctOver49: number;
            highestUnderDigit: number;
            highestOverDigit: number;
            hasSignal: boolean;
            signalDirection?: 'UNDER' | 'OVER';
            radarStatus: 'green' | 'yellow' | 'red' | 'blue' | 'normal';
        }> = [];

        marketsRef.current.forEach((data, sym) => {
            if (data.digits.length < 10) return;
            const a = computeAnalysis(data.digits);
            const entrySignal = checkEntrySignal(data.digits);
            const strength = Math.max(a.pctUnder05, a.pctOver49);

            let radarStatus: 'green' | 'yellow' | 'red' | 'blue' | 'normal' = 'normal';
            if (entrySignal) {
                if (entrySignal.status === 'TRIGGERED') radarStatus = 'green';
                else radarStatus = 'yellow';
            } else if (
                a.recentTrendFlip ||
                a.isUnderTrendFlipped ||
                a.isOverTrendFlipped ||
                (a.pctUnder05 >= 45 && a.pctUnder05 <= 55 && a.pctOver49 >= 45 && a.pctOver49 <= 55)
            ) {
                radarStatus = 'blue';
            } else if (strength < 58) {
                radarStatus = 'red'; // Less than 58% strength is considered not safe enough for an imminent signal
            } else {
                radarStatus = 'normal';
            }

            result.push({
                symbol: sym,
                label: data.label,
                currentPrice: data.currentPrice,
                lastDigit: data.lastDigit,
                bias: a.bias,
                strength,
                pctUnder04: a.pctUnder04,
                pctOver59: a.pctOver59,
                pctUnder05: a.pctUnder05,
                pctOver49: a.pctOver49,
                under05: a.under05,
                over49: a.over49,
                highestUnderDigit: a.highestUnderDigit,
                highestOverDigit: a.highestOverDigit,
                hasSignal: !!entrySignal,
                signalDirection: entrySignal?.direction,
                radarStatus,
            });
        });

        result.sort((a, b) => {
            if (a.hasSignal && !b.hasSignal) return -1;
            if (!a.hasSignal && b.hasSignal) return 1;
            return b.strength - a.strength;
        });

        return result;
    }, [computeAnalysis, checkEntrySignal, renderTick]);

    // Best Market identification
    const bestMarket = useMemo(() => {
        if (allMarketsData.length === 0) return null;
        return allMarketsData[0];
    }, [allMarketsData]);

    // Auto-select best market if autoInputBestMarket is true and bot is idle
    useEffect(() => {
        if (autoInputBestMarket && bestMarket && bestMarket.symbol !== selectedSymbol && autoState === 'IDLE') {
            setSelectedSymbol(bestMarket.symbol);
        }
    }, [autoInputBestMarket, bestMarket, selectedSymbol, autoState]);

    // ── Real-time dynamic ranked markets helper for the continuous trading loop ──
    const getLiveRankedMarkets = useCallback(() => {
        const result: Array<{
            symbol: string;
            label: string;
            currentPrice: string;
            lastDigit: number;
            bias: string;
            strength: number;
            hasSignal: boolean;
            isTriggered: boolean;
            signalDirection?: 'UNDER' | 'OVER';
        }> = [];

        marketsRef.current.forEach((data, sym) => {
            if (data.digits.length < 15) return;
            const a = computeAnalysis(data.digits);
            const entrySignal = checkEntrySignal(data.digits);
            const strength = Math.max(a.pctUnder05, a.pctOver49);
            result.push({
                symbol: sym,
                label: data.label,
                currentPrice: data.currentPrice,
                lastDigit: data.lastDigit,
                bias: a.bias,
                strength,
                hasSignal: !!entrySignal,
                isTriggered: entrySignal?.status === 'TRIGGERED',
                signalDirection: entrySignal?.direction,
            });
        });

        result.sort((a, b) => {
            if (a.isTriggered && !b.isTriggered) return -1;
            if (!a.isTriggered && b.isTriggered) return 1;
            if (a.hasSignal && !b.hasSignal) return -1;
            if (!a.hasSignal && b.hasSignal) return 1;
            return b.strength - a.strength;
        });

        return result;
    }, [computeAnalysis, checkEntrySignal]);

    // ── Push trade updates to Transaction Drawer & Run Panel ──
    const pushContract = useCallback(
        (data: Record<string, unknown>) => {
            try {
                transactions.pushTransaction({ ...data, run_id: run_panel.run_id });
                run_panel.onBotContractEvent(data);
                summary_card.onBotContractEvent(data);
            } catch {
                // ignore
            }
        },
        [run_panel, summary_card, transactions]
    );

    // ── Log entry helper ──
    const addLogEntry = useCallback(
        (
            type: string,
            market: string,
            result: 'WIN' | 'LOSS' | 'PENDING' | 'ABORTED',
            profit: number,
            details?: string
        ) => {
            setTradeLog(prev =>
                [
                    {
                        id: `EP-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                        time: new Date().toLocaleTimeString(),
                        type,
                        market,
                        result,
                        profit,
                        details,
                    },
                    ...prev,
                ].slice(0, 100)
            );
        },
        []
    );

    // ── Execute Single Trade (Local Engine) ──
    const executeTrade = useCallback(
        async (
            symbol: string,
            direction: 'UNDER' | 'OVER',
            prediction: number,
            stakeAmount: number
        ): Promise<number> => {
            const contractType = direction === 'UNDER' ? 'DIGITUNDER' : 'DIGITOVER';
            const dur = parseInt(tickDuration) || 1;
            const params: Record<string, unknown> = {
                amount: stakeAmount,
                basis: 'stake',
                contract_type: contractType,
                currency: currency || 'USD',
                duration: dur,
                duration_unit: 't',
                symbol,
                barrier: String(prediction),
            };

            const tradeStartTime = Math.floor(Date.now() / 1000);
            const verificationId = `EP-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
            const marketLabel = MARKETS.find(m => m.symbol === symbol)?.label || symbol;

            try {
                const buy = await buyContractForUi({ parameters: params, price: stakeAmount, source: 'ElitePro' });
                const { contract_id, buy_price, transaction_id } = buy;

                const initialContractSnapshot = {
                    buy_price,
                    contract_id,
                    transaction_ids: { buy: transaction_id },
                    date_start: tradeStartTime,
                    display_name: marketLabel,
                    underlying_symbol: symbol,
                    shortcode: `ELITE_${contractType}_${symbol}`,
                    contract_type: contractType,
                    currency: currency || 'USD',
                    verification_id: verificationId,
                    barrier: String(prediction),
                };

                pushContract(initialContractSnapshot);

                const abortController = new AbortController();
                contractStreamAbortRef.current.add(abortController);

                const settledContract = await streamContractUntilSettled({
                    contractId: contract_id,
                    fallback: initialContractSnapshot,
                    onUpdate: snapshot => {
                        if (!unmountedRef.current) pushContract(snapshot);
                    },
                    signal: abortController.signal,
                    source: 'ElitePro',
                });

                contractStreamAbortRef.current.delete(abortController);
                return Number(settledContract.profit ?? 0);
            } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                console.error('[ElitePro] Trade execution error:', msg);
                throw err;
            }
        },
        [tickDuration, currency, pushContract]
    );

    // ── Subscribe to Server-Side Deriv Automation ──
    const subscribeToServerRun = useCallback(
        (runId: string) => {
            if (!api_base.api) return;
            try {
                const observable = api_base.api.subscribe({ auto_get: 1, run_id: runId });
                const sub = safeSubscribe(observable, (data: Record<string, unknown>) => {
                    if (unmountedRef.current) return;

                    const runDetails = (data?.auto_get || data?.auto_start) as
                        | {
                              status?: string;
                              stop_reason?: string;
                              total_stake?: number;
                              total_payout?: number;
                              contracts?: Array<{
                                  contract_id?: number;
                                  stake?: number;
                                  buy_price?: number;
                                  transaction_id?: number;
                                  start_time?: number;
                                  contract_type?: string;
                                  profit?: number;
                                  barrier?: string;
                                  status?: string;
                              }>;
                          }
                        | undefined;

                    if (!runDetails) return;

                    const status = runDetails.status || 'idle';
                    setServerRunStatus(status);

                    if (status === 'stopped') {
                        setAutoState('IDLE');
                        setActiveRunId(null);
                        addLogEntry(
                            'SERVER STOPPED',
                            `Reason: ${runDetails.stop_reason || 'user_stopped'}`,
                            'PENDING',
                            0
                        );
                    } else if (status === 'paused') {
                        setAutoState('PAUSED');
                    } else if (status === 'running') {
                        setAutoState('TRADING');
                    }

                    const totalSpent = Number(runDetails.total_stake || 0);
                    const totalPayout = Number(runDetails.total_payout || 0);
                    const profit = Number((totalPayout - totalSpent).toFixed(2));

                    setTotalProfit(profit);
                    totalProfitRef.current = profit;

                    const contracts = runDetails.contracts || [];
                    let winsCount = 0;
                    let lossesCount = 0;

                    contracts.forEach(c => {
                        const p = Number(c.profit || 0);
                        if (c.status === 'won' || p > 0) winsCount++;
                        else if (c.status === 'lost' || p < 0) lossesCount++;

                        if (c.contract_id) {
                            pushContract({
                                buy_price: c.buy_price || c.stake,
                                contract_id: c.contract_id,
                                transaction_ids: { buy: c.transaction_id },
                                date_start: c.start_time,
                                display_name: selectedSymbol,
                                underlying_symbol: selectedSymbol,
                                shortcode: `AUTO_SERVER_${selectedStrategy.toUpperCase()}_${c.contract_id}`,
                                contract_type:
                                    c.contract_type || (analysis?.bias === 'over' ? 'DIGITOVER' : 'DIGITUNDER'),
                                currency: currency || 'USD',
                                profit: c.profit,
                                barrier: c.barrier,
                                is_completed: c.status === 'won' || c.status === 'lost',
                            });
                        }
                    });

                    setWins(winsCount);
                    winsRef.current = winsCount;
                    setLosses(lossesCount);
                    lossesRef.current = lossesCount;

                    if (contracts.length > 0) {
                        const latest = contracts[contracts.length - 1];
                        const latestProfit = Number(latest.profit || 0);
                        const isWon = latest.status === 'won' || latestProfit > 0;
                        addLogEntry(
                            `SERVER ${latest.contract_type || 'TRADE'}`,
                            selectedSymbol,
                            isWon ? 'WIN' : 'LOSS',
                            latestProfit
                        );
                    }
                });

                serverSubscriptionRef.current = sub;
            } catch (err) {
                console.error('[ElitePro] Server subscription error:', err);
            }
        },
        [selectedSymbol, selectedStrategy, analysis?.bias, currency, pushContract, addLogEntry]
    );

    // ── Launch Full Auto-Trading Engine ──
    const startAutoTrading = useCallback(async () => {
        if (!logged_in) {
            window.location.href = await generateOAuthURL();
            return;
        }

        if (autoStateRef.current !== 'IDLE' && autoStateRef.current !== 'PAUSED') return;

        if (autoStateRef.current === 'IDLE') {
            setTotalProfit(0);
            totalProfitRef.current = 0;
            setWins(0);
            winsRef.current = 0;
            setLosses(0);
            lossesRef.current = 0;
            targetStrategyRef.current = 'AUTO';
            setActiveTargetStrategy('AUTO');
        }

        const tp = parseFloat(takeProfit) || 999;
        const sl = parseFloat(stopLoss) || 999;
        const mgMultiplier = parseFloat(martingale) || 2.6;
        const baseStake = parseFloat(stake) || 0.35;
        currentStakeRef.current = baseStake;

        const startLocalEngineLoop = () => {
            setAutoState('SCANNING');
            autoStateRef.current = 'SCANNING';
            autoAbortRef.current = new AbortController();
            const abortSignal = autoAbortRef.current.signal;
            let tradeRuns = 0;
            let scanningCycles = 0;
            let lastProcessedTick = -1;

            const loop = async () => {
                while (!abortSignal.aborted && autoStateRef.current !== 'IDLE') {
                    if (autoStateRef.current === 'PAUSED') {
                        await new Promise(r => setTimeout(r, 1000));
                        continue;
                    }

                    if (totalProfitRef.current >= tp) {
                        addLogEntry('TARGET REACHED', 'Take Profit Target Hit 🎉', 'PENDING', 0);
                        setAutoState('IDLE');
                        setMilestone({ isOpen: true, type: 'tp' });
                        break;
                    }
                    if (totalProfitRef.current <= -sl) {
                        addLogEntry('STOP LOSS HIT', 'Stop Loss Limit Reached 🛡️', 'PENDING', 0);
                        setAutoState('IDLE');
                        setMilestone({ isOpen: true, type: 'sl' });
                        break;
                    }

                    let targetSym = selectedSymbolRef.current;
                    if (autoInputBestMarket && scanningCycles === 0 && tradeRuns === 0) {
                        const liveRanked = getLiveRankedMarkets();
                        const top = liveRanked[0];
                        if (top && top.symbol && top.symbol !== selectedSymbolRef.current) {
                            targetSym = top.symbol;
                            setSelectedSymbol(targetSym);
                            selectedSymbolRef.current = targetSym;
                            lastProcessedTick = -1;
                        }
                    }

                    const currentData = marketsRef.current.get(targetSym);
                    if (!currentData || currentData.digits.length < 15) {
                        if (autoStateRef.current !== 'SCANNING') {
                            setAutoState('SCANNING');
                            autoStateRef.current = 'SCANNING';
                        }
                        await new Promise(r => setTimeout(r, 400));
                        continue;
                    }

                    const currTickCount = currentData.tickCount || 0;
                    // Wait for a fresh live tick from the stream before processing
                    if (lastProcessedTick !== -1 && currTickCount <= lastProcessedTick) {
                        await new Promise(r => setTimeout(r, 40));
                        continue;
                    }
                    lastProcessedTick = currTickCount;

                    const entrySignal = checkEntrySignal(currentData.digits, scanningCycles);
                    if (!entrySignal || entrySignal.status === 'WAITING') {
                        scanningCycles++;

                        // Smart Auto-Switch: check if any market has an immediate TRIGGERED signal or better setup
                        if (autoSwitchMarkets) {
                            const liveRanked = getLiveRankedMarkets();
                            // 1. If another market has an immediately triggered entry, switch to it and execute!
                            const readyMarket = liveRanked.find(m => m.symbol !== targetSym && m.isTriggered);
                            if (readyMarket) {
                                setSelectedSymbol(readyMarket.symbol);
                                selectedSymbolRef.current = readyMarket.symbol;
                                targetStrategyRef.current = 'AUTO';
                                setActiveTargetStrategy('AUTO');
                                lastProcessedTick = -1;
                                addLogEntry(
                                    'SMART SWITCH',
                                    readyMarket.label,
                                    'PENDING',
                                    0,
                                    `Instantly switched to ${readyMarket.label} (Triggered ${readyMarket.signalDirection})`
                                );
                                scanningCycles = 0;
                                await new Promise(r => setTimeout(r, 100));
                                continue;
                            }

                            // 2. If current market has no qualified setup at all, rotate to top candidate after 3 cycles
                            if (!entrySignal && scanningCycles >= 3) {
                                const bestCandidate = liveRanked.find(
                                    m => m.symbol !== targetSym && (m.hasSignal || m.strength >= 55)
                                );
                                if (bestCandidate) {
                                    setSelectedSymbol(bestCandidate.symbol);
                                    selectedSymbolRef.current = bestCandidate.symbol;
                                    targetStrategyRef.current = 'AUTO';
                                    setActiveTargetStrategy('AUTO');
                                    lastProcessedTick = -1;
                                    addLogEntry(
                                        'SMART SWITCH',
                                        bestCandidate.label,
                                        'PENDING',
                                        0,
                                        `Switched to active setup on ${bestCandidate.label}`
                                    );
                                    scanningCycles = 0;
                                    await new Promise(r => setTimeout(r, 300));
                                    continue;
                                }
                            }
                        }

                        if (entrySignal && entrySignal.status === 'WAITING') {
                            if (autoStateRef.current !== 'WAITING_TRIGGER') {
                                setAutoState('WAITING_TRIGGER');
                                autoStateRef.current = 'WAITING_TRIGGER';
                            }
                        } else {
                            if (autoStateRef.current !== 'SCANNING') {
                                setAutoState('SCANNING');
                                autoStateRef.current = 'SCANNING';
                            }
                        }

                        // Poll fast when waiting for trigger to execute tick immediately
                        const delay = autoStateRef.current === 'WAITING_TRIGGER' ? 60 : 400;
                        await new Promise(r => setTimeout(r, delay));
                        continue;
                    }

                    scanningCycles = 0;
                    setAutoState('TRADING');
                    autoStateRef.current = 'TRADING';
                    try {
                        const stakeToUse = currentStakeRef.current;
                        addLogEntry(
                            `BUYING ${entrySignal.direction} ${entrySignal.prediction}`,
                            currentData.label,
                            'PENDING',
                            0,
                            `Stake: ${stakeToUse.toFixed(2)} ${currency} | ${entrySignal.reason}`
                        );

                        const profit = await executeTrade(
                            targetSym,
                            entrySignal.direction,
                            entrySignal.prediction,
                            stakeToUse
                        );

                        const isWin = profit > 0;
                        const resultStr = isWin ? 'WIN' : 'LOSS';
                        addLogEntry(
                            `${entrySignal.direction} ${entrySignal.prediction}`,
                            currentData.label,
                            resultStr,
                            profit,
                            `Return: ${profit >= 0 ? '+' : ''}${profit.toFixed(2)} ${currency}`
                        );

                        const nextProfit = Number((totalProfitRef.current + profit).toFixed(2));
                        totalProfitRef.current = nextProfit;
                        setTotalProfit(nextProfit);
                        tradeRuns++;

                        if (isWin) {
                            winsRef.current++;
                            setWins(winsRef.current);
                            currentStakeRef.current = baseStake;

                            // Canonical Elite Pro Momentum Adaptation on Win
                            const lastD = currentData.lastDigit;
                            const nextStrat: 'UNDER_6' | 'OVER_3' = lastD <= 4 ? 'UNDER_6' : 'OVER_3';
                            targetStrategyRef.current = nextStrat;
                            setActiveTargetStrategy(nextStrat);
                        } else {
                            lossesRef.current++;
                            setLosses(lossesRef.current);
                            currentStakeRef.current = Number((currentStakeRef.current * mgMultiplier).toFixed(2));

                            // Canonical Elite Pro Adaptive Martingale Reversal on Loss (Under 6 -> Over 3, Over 3 -> Under 6)
                            const prevDirection = entrySignal.direction;
                            const nextStrat: 'UNDER_6' | 'OVER_3' = prevDirection === 'UNDER' ? 'OVER_3' : 'UNDER_6';
                            targetStrategyRef.current = nextStrat;
                            setActiveTargetStrategy(nextStrat);

                            addLogEntry(
                                'ADAPTIVE REVERSAL',
                                currentData.label,
                                'PENDING',
                                0,
                                `🔄 [ELITE PRO REVERSAL] Switching to ${nextStrat.replace('_', ' ')} for Martingale Recovery (Stake: ${currentStakeRef.current.toFixed(2)} ${currency})`
                            );
                        }

                        // Check Take Profit or Stop Loss immediately after trade settlement
                        if (totalProfitRef.current >= tp) {
                            addLogEntry('TARGET REACHED', 'Take Profit Target Hit 🎉', 'PENDING', 0);
                            setAutoState('IDLE');
                            setMilestone({ isOpen: true, type: 'tp' });
                            break;
                        }
                        if (totalProfitRef.current <= -sl) {
                            addLogEntry('STOP LOSS HIT', 'Stop Loss Limit Reached 🛡️', 'PENDING', 0);
                            setAutoState('IDLE');
                            setMilestone({ isOpen: true, type: 'sl' });
                            break;
                        }

                        const maxRuns = parseInt(maxRunsBeforeSwitch, 10) || 7;
                        if (tradeRuns >= maxRuns) {
                            tradeRuns = 0;
                            if (autoSwitchMarkets) {
                                const liveRanked = getLiveRankedMarkets();
                                const currentRank = liveRanked.find(m => m.symbol === targetSym);
                                const bestCandidate = liveRanked[0];
                                if (
                                    bestCandidate &&
                                    bestCandidate.symbol !== targetSym &&
                                    (bestCandidate.isTriggered || bestCandidate.hasSignal || bestCandidate.strength > (currentRank?.strength || 50))
                                ) {
                                    setSelectedSymbol(bestCandidate.symbol);
                                    selectedSymbolRef.current = bestCandidate.symbol;
                                    targetStrategyRef.current = 'AUTO';
                                    setActiveTargetStrategy('AUTO');
                                    lastProcessedTick = -1;
                                    addLogEntry(
                                        'SMART SWITCH',
                                        bestCandidate.label,
                                        'PENDING',
                                        0,
                                        `Rotated to top market ${bestCandidate.label} after ${maxRuns} runs`
                                    );
                                } else {
                                    addLogEntry(
                                        'CONTINUING RUN',
                                        currentData.label,
                                        'PENDING',
                                        0,
                                        `Completed ${maxRuns} runs. Maintaining current top market ${currentData.label}`
                                    );
                                }
                            }
                            setAutoState('SCANNING');
                            autoStateRef.current = 'SCANNING';
                            await new Promise(r => setTimeout(r, 600));
                        } else {
                            setAutoState('SCANNING');
                            autoStateRef.current = 'SCANNING';
                            await new Promise(r => setTimeout(r, 600));
                        }
                        await new Promise(r => setTimeout(r, 1000));
                    } catch (err) {
                        const msg = err instanceof Error ? err.message : String(err);
                        console.error('[ElitePro] Trade execution loop error:', msg);
                        addLogEntry('EXECUTION ERROR', currentData.label, 'LOSS', 0, msg);
                        setAutoState('SCANNING');
                        autoStateRef.current = 'SCANNING';
                        await new Promise(r => setTimeout(r, 2500));
                    }
                }
            };

            loop();
        };

        if (executionMode === 'deriv_server') {
            const activeBias = analysis?.bias || 'under';
            const ct = activeBias === 'over' ? 'DIGITOVER' : 'DIGITUNDER';
            const bar = activeBias === 'over' ? '3' : '6';

            setAutoState('TRADING');
            try {
                const res = await autoStart({
                    contract_template: {
                        amount: baseStake,
                        basis: 'stake',
                        contract_type: ct,
                        currency: currency || 'USD',
                        duration: parseInt(tickDuration) || 1,
                        duration_unit: 't',
                        underlying_symbol: selectedSymbol,
                        barrier: bar,
                    },
                    strategy_id: selectedStrategy,
                    strategy_parameters: {
                        multiplier: mgMultiplier,
                        stop_loss: sl,
                        take_profit: tp,
                    },
                    subscribe: 1,
                    passthrough: undefined,
                    req_id: undefined,
                });

                if (res?.error) throw new Error(res.error.message || 'Server start error');

                const runId = res?.auto_start?.run_id;
                if (runId) {
                    setActiveRunId(runId);
                    setServerRunStatus('running');
                    addLogEntry('RUN LAUNCHED', `Server Automation Run: ${runId}`, 'PENDING', 0);
                    subscribeToServerRun(runId);
                } else {
                    throw new Error('No run ID returned from server');
                }
            } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                console.warn('[ElitePro] Server mode rejected, switching to local neural engine:', msg);
                addLogEntry('SERVER RUN REJECTED', 'Falling back to Local Neural Engine...', 'PENDING', 0, msg);
                setExecutionMode('local');
                setTimeout(() => {
                    startLocalEngineLoop();
                }, 100);
            }
            return;
        }

        startLocalEngineLoop();
    }, [
        executionMode,
        selectedSymbol,
        stake,
        takeProfit,
        stopLoss,
        martingale,
        selectedStrategy,
        currency,
        tickDuration,
        analysis?.bias,
        autoInputBestMarket,
        autoSwitchMarkets,
        maxRunsBeforeSwitch,
        getLiveRankedMarkets,
        checkEntrySignal,
        computeAnalysis,
        executeTrade,
        addLogEntry,
        subscribeToServerRun,
    ]);

    // ── Pause, Resume, Stop controls ──
    const pauseAutoTrading = useCallback(async () => {
        if (executionMode === 'deriv_server' && activeRunId) {
            try {
                await autoPause(activeRunId);
                setServerRunStatus('paused');
                setAutoState('PAUSED');
                autoStateRef.current = 'PAUSED';
                addLogEntry('SERVER PAUSED', 'Server Run Paused', 'PENDING', 0);
            } catch (err) {
                console.error('[ElitePro] Server pause error:', err);
            }
        } else {
            setAutoState('PAUSED');
            autoStateRef.current = 'PAUSED';
            addLogEntry('BOT PAUSED', selectedSymbol, 'PENDING', 0, 'Auto-trading paused by user');
        }
    }, [executionMode, activeRunId, selectedSymbol, addLogEntry]);

    const resumeAutoTrading = useCallback(async () => {
        if (executionMode === 'deriv_server' && activeRunId) {
            try {
                await autoResume(activeRunId);
                setServerRunStatus('running');
                setAutoState('TRADING');
                autoStateRef.current = 'TRADING';
                addLogEntry('SERVER RESUMED', 'Server Run Resumed', 'PENDING', 0);
            } catch (err) {
                console.error('[ElitePro] Server resume error:', err);
            }
        } else {
            if (autoStateRef.current === 'PAUSED') {
                setAutoState('SCANNING');
                autoStateRef.current = 'SCANNING';
                addLogEntry('BOT RESUMED', selectedSymbol, 'PENDING', 0, 'Auto-trading resumed');
            }
        }
    }, [executionMode, activeRunId, selectedSymbol, addLogEntry]);

    const stopAutoTrading = useCallback(async () => {
        if (executionMode === 'deriv_server') {
            if (activeRunId) {
                try {
                    await autoStop(activeRunId);
                    addLogEntry('SERVER STOPPED', 'Automation Run Stopped', 'PENDING', 0);
                } catch (err) {
                    console.error('[ElitePro] Server stop error:', err);
                }
            }
            serverSubscriptionRef.current?.unsubscribe();
            serverSubscriptionRef.current = null;
            setActiveRunId(null);
            setServerRunStatus('stopped');
            setAutoState('IDLE');
            autoStateRef.current = 'IDLE';
        } else {
            setAutoState('IDLE');
            autoStateRef.current = 'IDLE';
            autoAbortRef.current?.abort();
            autoAbortRef.current = null;
            contractStreamAbortRef.current.forEach(c => c.abort());
            contractStreamAbortRef.current.clear();
            addLogEntry('BOT STOPPED', selectedSymbol, 'PENDING', 0, 'Auto-trading stopped');
        }
    }, [executionMode, activeRunId, selectedSymbol, addLogEntry]);

    // Handle global manual stop
    useEffect(() => {
        const handleGlobalStop = () => {
            if (autoStateRef.current !== 'IDLE') {
                void stopAutoTrading();
            }
        };
        globalObserver.register('bot.manual_stop', handleGlobalStop);
        return () => {
            globalObserver.unregister('bot.manual_stop', handleGlobalStop);
        };
    }, [stopAutoTrading]);

    // TopBar controller integration
    useEffect(() => {
        window.dispatchEvent(
            new CustomEvent('PH_ENGINE_STATUS_UPDATE', {
                detail: {
                    tab: 'elite_pro',
                    isRunning: autoState !== 'IDLE',
                    state: autoState,
                    profit: totalProfit,
                },
            })
        );
    }, [autoState, totalProfit]);

    useEffect(() => {
        const handleTrigger = (e: Event) => {
            const customEvent = e as CustomEvent<{ tab: string; action: string }>;
            if (customEvent.detail?.tab === 'elite_pro') {
                const act = customEvent.detail.action;
                if (act === 'start' || (act === 'toggle' && autoStateRef.current === 'IDLE')) {
                    if (autoStateRef.current === 'IDLE') {
                        void startAutoTrading();
                    }
                } else if (act === 'stop' || (act === 'toggle' && autoStateRef.current !== 'IDLE')) {
                    if (autoStateRef.current !== 'IDLE') {
                        void stopAutoTrading();
                    }
                }
            }
        };
        window.addEventListener('PH_TRIGGER_ENGINE_ACTION', handleTrigger);
        return () => {
            window.removeEventListener('PH_TRIGGER_ENGINE_ACTION', handleTrigger);
        };
    }, [startAutoTrading, stopAutoTrading]);

    // Cleanup on unmount
    useEffect(() => {
        const abortControllers = contractStreamAbortRef.current;
        return () => {
            if (executionMode === 'deriv_server') {
                void stopAutoTrading();
            } else {
                setAutoState('IDLE');
                autoAbortRef.current?.abort();
                abortControllers.forEach(c => c.abort());
            }
        };
    }, [executionMode, stopAutoTrading]);

    const handleLogin = async () => {
        const oauthUrl = await generateOAuthURL();
        if (oauthUrl) window.location.replace(oauthUrl);
    };

    // Determine current trade type & prediction to display
    const currentTradeType = useMemo(() => {
        if (activeTargetStrategy === 'UNDER_6') return 'DIGITUNDER';
        if (activeTargetStrategy === 'OVER_3') return 'DIGITOVER';
        if (activeSignal) return activeSignal.direction === 'UNDER' ? 'DIGITUNDER' : 'DIGITOVER';
        if (analysis?.bias === 'over') return 'DIGITOVER';
        return 'DIGITUNDER';
    }, [activeTargetStrategy, activeSignal, analysis?.bias]);

    const currentPrediction = useMemo(() => {
        if (activeTargetStrategy === 'UNDER_6') return 6;
        if (activeTargetStrategy === 'OVER_3') return 3;
        if (activeSignal) return activeSignal.prediction;
        if (analysis?.bias === 'over') return 3;
        return 6;
    }, [activeTargetStrategy, activeSignal, analysis?.bias]);

    return (
        <div className='elite-pro'>
            <div className='ep-background-blobs'>
                <div className='blob blob-1' />
                <div className='blob blob-2' />
                <div className='blob blob-3' />
            </div>

            {!logged_in && (
                <div className='ep-login-overlay'>
                    <div className='ep-login-overlay__panel'>
                        <span className='ep-login-overlay__icon'>👑</span>
                        <h3>ProfitHub Elite Pro</h3>
                        <p>
                            Authenticate with your Deriv account to unlock advanced scanners, real-time digit
                            statistics, and the automated neural trading engine.
                        </p>
                        <button className='ep-login-overlay__btn' onClick={handleLogin}>
                            Connect Deriv Account
                        </button>
                    </div>
                </div>
            )}

            <div className='ep-layout'>
                {/* ══════════════════════════════════════════════════════════════════
                    LEFT / SIDE PANEL: ALL MARKETS SCANNER
                    ══════════════════════════════════════════════════════════════════ */}
                <aside className={`ep-sidebar ${marketsSideExpanded ? 'expanded' : 'collapsed'}`}>
                    <div className='ep-sidebar__header'>
                        <div className='title-wrap'>
                            <span className='icon'>📡</span>
                            <h3>Derived Synthetics ({allMarketsData.length})</h3>
                        </div>
                        <button
                            className='ep-sidebar__collapse-btn'
                            onClick={() => setMarketsSideExpanded(!marketsSideExpanded)}
                            title={marketsSideExpanded ? 'Collapse Scanner Tray' : 'Expand Scanner Tray'}
                        >
                            {marketsSideExpanded ? '◀' : '▶'}
                        </button>
                    </div>

                    {marketsSideExpanded && (
                        <div className='ep-sidebar__controls'>
                            <label className='ep-checkbox-label'>
                                <input type='checkbox' checked={scanAll} onChange={e => setScanAll(e.target.checked)} />
                                <span className='ep-checkbox-custom' />
                                <span>Scan All Markets</span>
                            </label>

                            <label className='ep-checkbox-label'>
                                <input
                                    type='checkbox'
                                    checked={autoInputBestMarket}
                                    onChange={e => setAutoInputBestMarket(e.target.checked)}
                                />
                                <span className='ep-checkbox-custom' />
                                <span>Auto-Select Best Market</span>
                            </label>
                        </div>
                    )}

                    {marketsSideExpanded && (
                        <div className='ep-sidebar__market-list'>
                            {allMarketsData.map(m => {
                                const isSelected = m.symbol === selectedSymbol;
                                const isBest = bestMarket?.symbol === m.symbol;
                                return (
                                    <div
                                        key={m.symbol}
                                        className={`ep-side-market-card ${isSelected ? 'active' : ''} ${m.hasSignal ? 'signal-glowing' : ''} radar-${m.radarStatus}`}
                                        onClick={() => {
                                            handleManualMarketSelect(m.symbol);
                                        }}
                                    >
                                        <div className='ep-side-market-card__top'>
                                            <div
                                                className='name-box'
                                                style={{
                                                    flex: 1,
                                                    minWidth: 0,
                                                    overflow: 'hidden',
                                                    textOverflow: 'ellipsis',
                                                    whiteSpace: 'nowrap',
                                                }}
                                            >
                                                <span className='label' style={{ marginRight: '4px' }}>
                                                    {m.label}
                                                </span>
                                                {isBest && <span className='best-tag'>TOP</span>}
                                                {m.hasSignal && (
                                                    <span
                                                        className={`signal-tag signal-tag--${m.signalDirection?.toLowerCase()}`}
                                                    >
                                                        {m.signalDirection}
                                                    </span>
                                                )}
                                            </div>
                                            <div className='price-box'>{m.currentPrice}</div>
                                            <div
                                                className='last-digit-badge'
                                                style={{ marginLeft: 'auto', flexShrink: 0 }}
                                            >
                                                <strong
                                                    className={m.lastDigit < 5 ? 'digit-under' : 'digit-over'}
                                                    style={{ fontSize: '12px' }}
                                                >
                                                    {m.lastDigit}
                                                </strong>
                                            </div>
                                        </div>

                                        <div className='ep-side-market-card__stats' style={{ marginTop: '6px' }}>
                                            <div className='ratio-mini-bar'>
                                                <div className='u-part' style={{ width: `${m.pctUnder05}%` }} />
                                                <div className='o-part' style={{ width: `${m.pctOver49}%` }} />
                                            </div>
                                            <div className='stat-labels'>
                                                <span className='u-text'>U (0-5): {m.pctUnder05.toFixed(0)}%</span>
                                                <span className='o-text'>O (4-9): {m.pctOver49.toFixed(0)}%</span>
                                            </div>
                                        </div>

                                        <div className='ep-side-market-card__footer'>
                                            <span className={`bias-pill bias-pill--${m.bias}`}>
                                                {m.bias.toUpperCase()} ({m.under05}U / {m.over49}O)
                                            </span>
                                            <span className='best-digits'>
                                                U*:{m.highestUnderDigit} | O*:{m.highestOverDigit}
                                            </span>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </aside>

                {/* ══════════════════════════════════════════════════════════════════
                    MAIN WORKSPACE CONTENT
                    ══════════════════════════════════════════════════════════════════ */}
                <main
                    className={`ep-main-content ${activeData ? `radar-${allMarketsData.find(m => m.symbol === activeData.symbol)?.radarStatus || 'normal'}` : ''}`}
                >
                    {/* ── Top Header ── */}
                    <div className='ep-glass ep-header'>
                        <div className='ep-header__title'>
                            <span className='ep-crown'>👑</span>
                            <div className='ep-title-meta'>
                                <span className='ep-title-text'>Elite Pro</span>
                                <span className='ep-title-sub'>Neural Multi-Market Scanner &amp; Automated Trader</span>
                            </div>
                        </div>

                        <div className='ep-header__actions'>
                            {bestMarket && (
                                <div
                                    className='ep-best-market-badge'
                                    onClick={() => handleManualMarketSelect(bestMarket.symbol)}
                                    title='Click to focus best market'
                                >
                                    🏆 Best Market: <strong>{bestMarket.label}</strong> ({bestMarket.bias.toUpperCase()}
                                    )
                                </div>
                            )}
                            <span
                                className={`ep-engine-status-badge ep-engine-status-badge--${autoState.toLowerCase()}`}
                            >
                                {autoState === 'IDLE' && '● ENGINE IDLE'}
                                {autoState === 'SCANNING' && '⚡ SCANNING CRITERIA'}
                                {autoState === 'WAITING_TRIGGER' && '🎯 WAITING TRIGGER DIGIT'}
                                {autoState === 'TRADING' && '🚀 EXECUTING TRADE'}
                                {autoState === 'PAUSED' && '⏸ ENGINE PAUSED'}
                                {executionMode === 'deriv_server' &&
                                    serverRunStatus !== 'idle' &&
                                    ` (Server: ${serverRunStatus})`}
                            </span>
                        </div>
                    </div>

                    {/* ── Quick Market Switch Dropdown & Top Controls ── */}
                    <div className='ep-glass ep-market-bar'>
                        <div className='select-container'>
                            <span className='label'>Active Market:</span>
                            <select
                                className='ep-market-select'
                                value={selectedSymbol}
                                onChange={e => {
                                    handleManualMarketSelect(e.target.value);
                                }}
                            >
                                {MARKETS.map(m => (
                                    <option key={m.symbol} value={m.symbol}>
                                        {m.label}
                                    </option>
                                ))}
                            </select>
                        </div>

                        <div className='market-meta-tags'>
                            <span className='meta-tag'>
                                📈 Input Market:{' '}
                                <strong>{MARKETS.find(m => m.symbol === selectedSymbol)?.label}</strong>
                            </span>
                            <span className='meta-tag'>
                                🎯 Trade Type: <strong>{currentTradeType}</strong>
                            </span>
                            <span className='meta-tag'>
                                🔮 Prediction Set:{' '}
                                <strong>
                                    {currentTradeType === 'DIGITOVER'
                                        ? `Over ${currentPrediction}`
                                        : `Under ${currentPrediction}`}
                                </strong>
                            </span>
                        </div>
                    </div>

                    {/* ── Live Price & Last Digit Orb Cards ── */}
                    <div className='ep-hero-grid'>
                        <div className='ep-glass ep-hero-card ep-price-card'>
                            <span className='ep-hero-label'>CURRENT LIVE QUOTE</span>
                            <div className='ep-price-value-row'>
                                <span className='ep-price-value'>{activeData?.currentPrice ?? '—'}</span>
                                <span className='ep-live-pulse-dot' />
                            </div>
                            <span className='ep-price-sub'>
                                {MARKETS.find(m => m.symbol === selectedSymbol)?.label}
                            </span>
                        </div>

                        <div className='ep-glass ep-hero-card ep-digit-card'>
                            <span className='ep-hero-label'>LAST TICK DIGIT</span>
                            <div
                                className={`ep-digit-orb-wrapper ep-digit-orb-wrapper--${(activeData?.lastDigit ?? 0) <= 5 ? 'under' : 'over'}`}
                            >
                                <div className='ep-digit-orb'>{activeData?.lastDigit ?? '—'}</div>
                            </div>
                            <span className='ep-digit-sub'>
                                {(activeData?.lastDigit ?? 0) <= 5 ? 'Under 6 Zone (0-5)' : 'Over 3 Zone (6-9)'}
                            </span>
                        </div>
                    </div>

                    {/* ── 50-Ticks Spline Line Chart ── */}
                    <div className='ep-glass ep-chart-card'>
                        <div className='ep-chart-card__header'>
                            <span className='title'>
                                📊 50-Ticks Digit Trend Line Chart —{' '}
                                {MARKETS.find(m => m.symbol === selectedSymbol)?.label}
                            </span>
                            <span className='subtitle'>Real-Time Spline with Digit Markers (0–9)</span>
                        </div>
                        <div className='ep-chart-wrap'>
                            <DigitLineChart digits={activeData?.digits || []} />
                        </div>
                    </div>

                    {/* ── Deep Statistical Analysis Ratios ── */}
                    {analysis && (
                        <div className='ep-glass ep-stats-card'>
                            <div className='ep-stats-card__header'>
                                <div className='title-group'>
                                    <span className='title'>Statistical Ratio &amp; Probability Analysis</span>
                                    <span className='sample-count'>(Last 50 Ticks Sample)</span>
                                </div>
                                <span className={`ep-bias-badge ep-bias-badge--${analysis.bias}`}>
                                    {analysis.bias === 'under'
                                        ? '🛡️ UNDER 6 BIAS'
                                        : analysis.bias === 'over'
                                          ? '🚀 OVER 3 BIAS'
                                          : '⚖️ BALANCED'}
                                </span>
                            </div>

                            {/* Ratio 1: Under 0-4 vs Over 5-9 */}
                            <div className='ep-ratio-block'>
                                <div className='ep-ratio-block__head'>
                                    <div className='side side--under'>
                                        <span className='tag'>Under (0-4)</span>
                                        <strong>
                                            {analysis.under04} Ticks ({analysis.pctUnder04.toFixed(1)}%)
                                        </strong>
                                    </div>
                                    <span className='vs'>VS</span>
                                    <div className='side side--over'>
                                        <span className='tag'>Over (5-9)</span>
                                        <strong>
                                            {analysis.over59} Ticks ({analysis.pctOver59.toFixed(1)}%)
                                        </strong>
                                    </div>
                                </div>
                                <div className='ep-progress-track'>
                                    <div
                                        className='ep-progress-bar ep-progress-bar--under'
                                        style={{ width: `${analysis.pctUnder04}%` }}
                                    />
                                    <div
                                        className='ep-progress-bar ep-progress-bar--over'
                                        style={{ width: `${analysis.pctOver59}%` }}
                                    />
                                </div>
                                <div className='ep-ratio-momentum'>
                                    {analysis.underIncreasing && analysis.pctUnder04 > 55 && (
                                        <span className='tip tip--green'>
                                            ⚡ Under Momentum is above 55% and INCREASING (Condition 1 Met)
                                        </span>
                                    )}
                                    {analysis.overIncreasing && analysis.pctOver59 > 55 && (
                                        <span className='tip tip--orange'>
                                            ⚡ Over Momentum is above 55% and INCREASING (Condition 1 Met)
                                        </span>
                                    )}
                                    {!analysis.underIncreasing && !analysis.overIncreasing && (
                                        <span className='tip tip--neutral'>⚖️ Momentum consolidating</span>
                                    )}
                                </div>
                            </div>

                            {/* Ratio 2: Under 0-5 vs Over 4-9 */}
                            <div className='ep-ratio-block'>
                                <div className='ep-ratio-block__head'>
                                    <div className='side side--under'>
                                        <span className='tag'>Under (0-5)</span>
                                        <strong>
                                            {analysis.under05} Ticks ({((analysis.under05 / ((analysis.under05 + analysis.over49) || 1)) * 100).toFixed(1)}% share)
                                        </strong>
                                    </div>
                                    <span className='vs'>VS</span>
                                    <div className='side side--over'>
                                        <span className='tag'>Over (4-9)</span>
                                        <strong>
                                            {analysis.over49} Ticks ({((analysis.over49 / ((analysis.under05 + analysis.over49) || 1)) * 100).toFixed(1)}% share)
                                        </strong>
                                    </div>
                                </div>
                                <div className='ep-progress-track'>
                                    <div
                                        className='ep-progress-bar ep-progress-bar--under'
                                        style={{ width: `${(analysis.under05 / ((analysis.under05 + analysis.over49) || 1)) * 100}%` }}
                                    />
                                    <div
                                        className='ep-progress-bar ep-progress-bar--over'
                                        style={{ width: `${(analysis.over49 / ((analysis.under05 + analysis.over49) || 1)) * 100}%` }}
                                    />
                                </div>
                                <div className='ep-market-tendency-note'>
                                    {analysis.bias === 'under' && analysis.under05 >= 29 ? (
                                        <span className='note note--under'>
                                            🔥 Market is strongly favoring <strong>UNDER 6</strong> ({analysis.under05}{' '}
                                            Under vs {analysis.over49} Over). High-probability Under setup active!
                                        </span>
                                    ) : analysis.bias === 'over' && analysis.over49 >= 29 ? (
                                        <span className='note note--over'>
                                            🔥 Market is strongly favoring <strong>OVER 3</strong> ({analysis.over49} Over
                                            vs {analysis.under05} Under). High-probability Over setup active!
                                        </span>
                                    ) : (
                                        <span className='note note--neutral'>
                                            ℹ️ Market digits are shifting ({analysis.under05} Under 0-5 vs{' '}
                                            {analysis.over49} Over 4-9). Engine actively hunting best entry trigger...
                                        </span>
                                    )}
                                </div>
                            </div>

                            {/* Glowing Highest Entry Digit Cards */}
                            <div className='ep-entry-digits-container'>
                                <div
                                    className={`ep-entry-card ep-entry-card--under ${analysis.highestUnderPct >= analysis.highestOverPct ? 'ep-entry-card--dominant' : ''}`}
                                >
                                    <div className='ep-entry-card__top'>
                                        <span className='title'>Under Entry Trigger Digit</span>
                                        <span className='range'>(Range 0 – 5)</span>
                                    </div>
                                    <div className='ep-glowing-digit-badge ep-glowing-digit-badge--under'>
                                        <span className='digit'>{analysis.highestUnderDigit}</span>
                                        <span className='pct'>{analysis.highestUnderPct.toFixed(0)}%</span>
                                    </div>
                                    <span className='frequency-sub'>
                                        Appeared <strong>{analysis.highestUnderCount}</strong> times in 50 ticks
                                    </span>
                                </div>

                                <div
                                    className={`ep-entry-card ep-entry-card--over ${analysis.highestOverPct >= analysis.highestUnderPct ? 'ep-entry-card--dominant' : ''}`}
                                >
                                    <div className='ep-entry-card__top'>
                                        <span className='title'>Over Entry Trigger Digit</span>
                                        <span className='range'>(Range 4 – 9)</span>
                                    </div>
                                    <div className='ep-glowing-digit-badge ep-glowing-digit-badge--over'>
                                        <span className='digit'>{analysis.highestOverDigit}</span>
                                        <span className='pct'>{analysis.highestOverPct.toFixed(0)}%</span>
                                    </div>
                                    <span className='frequency-sub'>
                                        Appeared <strong>{analysis.highestOverCount}</strong> times in 50 ticks
                                    </span>
                                </div>
                            </div>

                            {/* Market Dynamics & Canonical Elite Pro Checklist */}
                            <div className='ep-checklist-grid'>
                                <div className='ep-checklist-col'>
                                    <span className='col-title'>Under 6 Strategy Execution Matrix</span>
                                    <div
                                        className={`check-row ${activeTargetStrategy === 'UNDER_6' || (activeTargetStrategy === 'AUTO' && analysis.under05 >= analysis.over49) ? 'valid' : ''}`}
                                    >
                                        <span className='mark'>✓</span> Strategy Active: UNDER 6 ({analysis.under05} U0-5 vs {analysis.over49} O4-9)
                                    </div>
                                    <div
                                        className={`check-row ${analysis.under05 >= 25 ? 'valid' : ''}`}
                                    >
                                        <span className='mark'>✓</span> 50-Ticks Momentum Advantage: {analysis.pctUnder05.toFixed(1)}% Under 0-5
                                    </div>
                                    <div
                                        className={`check-row ${activeData?.lastDigit !== undefined && activeData.lastDigit <= 5 ? 'valid' : ''}`}
                                    >
                                        <span className='mark'>✓</span> Canonical Trigger: Last Digit &le; 5 (Current: {activeData?.lastDigit})
                                    </div>
                                    <div className='check-row valid'>
                                        <span className='mark'>✓</span> Loss Recovery: Auto-Reverses to OVER 3 on loss with Martingale
                                    </div>
                                </div>

                                <div className='ep-checklist-col'>
                                    <span className='col-title'>Over 3 Strategy Execution Matrix</span>
                                    <div
                                        className={`check-row ${activeTargetStrategy === 'OVER_3' || (activeTargetStrategy === 'AUTO' && analysis.over49 > analysis.under05) ? 'valid' : ''}`}
                                    >
                                        <span className='mark'>✓</span> Strategy Active: OVER 3 ({analysis.over49} O4-9 vs {analysis.under05} U0-5)
                                    </div>
                                    <div
                                        className={`check-row ${analysis.over49 >= 25 ? 'valid' : ''}`}
                                    >
                                        <span className='mark'>✓</span> 50-Ticks Momentum Advantage: {analysis.pctOver49.toFixed(1)}% Over 4-9
                                    </div>
                                    <div
                                        className={`check-row ${activeData?.lastDigit !== undefined && activeData.lastDigit >= 4 ? 'valid' : ''}`}
                                    >
                                        <span className='mark'>✓</span> Canonical Trigger: Last Digit &ge; 4 (Current: {activeData?.lastDigit})
                                    </div>
                                    <div className='check-row valid'>
                                        <span className='mark'>✓</span> Loss Recovery: Auto-Reverses to UNDER 6 on loss with Martingale
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* ── Automated Trading Control Panel ── */}
                    <div className='ep-glass ep-auto-panel'>
                        <div className='ep-auto-panel__header'>
                            <div className='title-wrap'>
                                <span className='icon'>🤖</span>
                                <h3>Automated Trading Strategy Engine</h3>
                            </div>

                            {activeSignal && executionMode === 'local' && (
                                <span className='ep-signal-active-pill'>
                                    ⚡ {activeSignal.direction} {activeSignal.prediction} TRIGGERED (Digit{' '}
                                    {activeSignal.triggerDigit})
                                </span>
                            )}
                        </div>

                        {/* Mode Selector */}
                        <div className='ep-mode-selector'>
                            <button
                                className={`ep-mode-btn ${executionMode === 'local' ? 'active' : ''}`}
                                onClick={() => {
                                    if (autoState === 'IDLE') setExecutionMode('local');
                                }}
                                disabled={autoState !== 'IDLE'}
                            >
                                🧠 Neural Local Engine (Full Auto Under 6 / Over 3)
                            </button>
                            <button
                                className={`ep-mode-btn ${executionMode === 'deriv_server' ? 'active' : ''}`}
                                onClick={() => {
                                    if (autoState === 'IDLE') setExecutionMode('deriv_server');
                                }}
                                disabled={autoState !== 'IDLE'}
                            >
                                ☁️ Deriv Cloud Server Automation
                            </button>
                        </div>

                        {executionMode === 'deriv_server' && (
                            <div className='ep-server-strat-select'>
                                <span>Predefined Server Strategy:</span>
                                <select
                                    value={selectedStrategy}
                                    onChange={e => setSelectedStrategy(e.target.value)}
                                    disabled={autoState !== 'IDLE'}
                                >
                                    {strategies.map(s => (
                                        <option key={s.id} value={s.id}>
                                            {s.name || s.id}
                                        </option>
                                    ))}
                                </select>
                            </div>
                        )}

                        {/* Parameter Inputs Grid */}
                        <div className='ep-inputs-grid'>
                            <div className='ep-input-card'>
                                <span className='label'>Base Stake ({currency})</span>
                                <input
                                    type='text'
                                    value={stake}
                                    onChange={e => setStake(cleanMoneyInput(e.target.value))}
                                    disabled={autoState !== 'IDLE'}
                                />
                            </div>

                            <div className='ep-input-card'>
                                <span className='label'>Martingale Multiplier</span>
                                <input
                                    type='text'
                                    value={martingale}
                                    onChange={e => setMartingale(cleanMoneyInput(e.target.value))}
                                    disabled={autoState !== 'IDLE'}
                                />
                            </div>

                            <div className='ep-input-card'>
                                <span className='label'>Take Profit ({currency})</span>
                                <input
                                    type='text'
                                    value={takeProfit}
                                    onChange={e => setTakeProfit(cleanMoneyInput(e.target.value))}
                                    disabled={autoState !== 'IDLE'}
                                />
                            </div>

                            <div className='ep-input-card'>
                                <span className='label'>Stop Loss ({currency})</span>
                                <input
                                    type='text'
                                    value={stopLoss}
                                    onChange={e => setStopLoss(cleanMoneyInput(e.target.value))}
                                    disabled={autoState !== 'IDLE'}
                                />
                            </div>

                            <div className='ep-input-card'>
                                <span className='label'>Number of Ticks</span>
                                <select
                                    value={tickDuration}
                                    onChange={e => setTickDuration(e.target.value)}
                                    disabled={autoState !== 'IDLE'}
                                >
                                    <option value='1'>1 Tick (Recommended)</option>
                                    <option value='2'>2 Ticks</option>
                                </select>
                            </div>

                            <div className='ep-input-card'>
                                <span className='label'>Auto-Switch Market Runs</span>
                                <input
                                    type='number'
                                    min='1'
                                    max='50'
                                    value={maxRunsBeforeSwitch}
                                    onChange={e => setMaxRunsBeforeSwitch(e.target.value)}
                                    disabled={autoState !== 'IDLE'}
                                />
                            </div>

                            <div className='ep-input-card'>
                                <span className='label'>Smart Market Switch</span>
                                <select
                                    value={autoSwitchMarkets ? 'true' : 'false'}
                                    onChange={e => setAutoSwitchMarkets(e.target.value === 'true')}
                                    disabled={autoState !== 'IDLE'}
                                >
                                    <option value='true'>Enabled (Auto-Hunt)</option>
                                    <option value='false'>Disabled (Single Market)</option>
                                </select>
                            </div>
                        </div>

                        {/* Execution Action Buttons */}
                        <div className='ep-actions-row'>
                            {autoState === 'IDLE' && (
                                <button
                                    className='ep-action-btn ep-action-btn--start'
                                    data-testid='elite_pro_toggle'
                                    onClick={startAutoTrading}
                                >
                                    ▶ Start Automated Bot
                                </button>
                            )}

                            {(autoState === 'SCANNING' ||
                                autoState === 'WAITING_TRIGGER' ||
                                autoState === 'TRADING') && (
                                <>
                                    <button className='ep-action-btn ep-action-btn--pause' onClick={pauseAutoTrading}>
                                        ⏸ Auto Pause Engine
                                    </button>
                                    <button
                                        className='ep-action-btn ep-action-btn--stop'
                                        data-testid='elite_pro_toggle'
                                        onClick={stopAutoTrading}
                                    >
                                        ⏹ Stop Engine
                                    </button>
                                </>
                            )}

                            {autoState === 'PAUSED' && (
                                <>
                                    <button className='ep-action-btn ep-action-btn--start' onClick={resumeAutoTrading}>
                                        ▶ Auto Resume Engine
                                    </button>
                                    <button
                                        className='ep-action-btn ep-action-btn--stop'
                                        data-testid='elite_pro_toggle'
                                        onClick={stopAutoTrading}
                                    >
                                        ⏹ Stop Engine
                                    </button>
                                </>
                            )}
                        </div>

                        {/* Live P&L Performance Metrics */}
                        <div className='ep-pnl-summary'>
                            <div className='ep-pnl-card'>
                                <span className='pnl-label'>TOTAL PROFIT / LOSS</span>
                                <span className={`pnl-val ${totalProfit >= 0 ? 'pnl-val--win' : 'pnl-val--loss'}`}>
                                    {totalProfit >= 0 ? '+' : ''}
                                    {totalProfit.toFixed(2)} {currency}
                                </span>
                            </div>

                            <div className='ep-pnl-card'>
                                <span className='pnl-label'>WINS</span>
                                <span className='pnl-val pnl-val--win'>{wins}</span>
                            </div>

                            <div className='ep-pnl-card'>
                                <span className='pnl-label'>LOSSES</span>
                                <span className='pnl-val pnl-val--loss'>{losses}</span>
                            </div>

                            <div className='ep-pnl-card'>
                                <span className='pnl-label'>NEXT STAKE (MG 2.6)</span>
                                <span className='pnl-val'>
                                    {currentStakeRef.current.toFixed(2)} {currency}
                                </span>
                            </div>
                        </div>
                    </div>

                    {/* ── Engine Execution Logs ── */}
                    <div className='ep-glass ep-logs-card'>
                        <div
                            className='ep-logs-card__header'
                            style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
                        >
                            <div style={{ display: 'flex', flexDirection: 'column' }}>
                                <span className='title'>📋 Live Engine Execution Logs</span>
                                <span className='sync-note'>Synced to Global Transaction Drawer</span>
                            </div>
                            {tradeLog.length > 0 && (
                                <button
                                    onClick={() => setTradeLog([])}
                                    className='ep-btn-clear-logs'
                                    title='Clear execution logs'
                                >
                                    Clear Logs
                                </button>
                            )}
                        </div>

                        {tradeLog.length === 0 ? (
                            <div className='ep-logs-empty'>
                                Bot is idle. Start the bot to begin live automated logging and contract streaming.
                            </div>
                        ) : (
                            <div className='ep-logs-list'>
                                {tradeLog.map(entry => (
                                    <div key={entry.id} className='ep-log-row'>
                                        <span className='time'>{entry.time}</span>
                                        <span className='type'>{entry.type}</span>
                                        <span className='market'>{entry.market}</span>
                                        {entry.details && <span className='details'>{entry.details}</span>}
                                        <span className={`result result--${entry.result.toLowerCase()}`}>
                                            {entry.result}
                                        </span>
                                        <span className={`profit ${entry.profit >= 0 ? 'profit--pos' : 'profit--neg'}`}>
                                            {entry.profit >= 0 ? '+' : ''}
                                            {entry.profit.toFixed(2)} {currency}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </main>
            </div>
            <TradingMilestoneModal
                isOpen={milestone.isOpen}
                type={milestone.type}
                amount={totalProfit}
                targetAmount={milestone.type === 'tp' ? parseFloat(takeProfit) || 10 : parseFloat(stopLoss) || 5}
                currency={currency}
                botName='Elite Pro AI Engine'
                winsCount={wins}
                lossesCount={losses}
                onClose={() => setMilestone({ isOpen: false, type: null })}
                onRestart={() => {
                    setMilestone({ isOpen: false, type: null });
                    void startAutoTrading();
                }}
            />
        </div>
    );
});

export { ElitePro };
export default ElitePro;
