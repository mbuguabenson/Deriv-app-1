import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { TradingMilestoneModal } from '@/components/shared';
import { api_base, observer as globalObserver } from '@/external/bot-skeleton';
import { useStore } from '@/hooks/useStore';
import { SUPPORTED_VOLATILITY_MARKETS } from '@/utils/digit-strategy';
import { buyContractForUi, streamContractUntilSettled } from '@/utils/trade-purchase';
import { safeSubscribe } from '@/utils/websocket-handler';
import {
    Activity,
    ArrowUpRight,
    CheckCircle2,
    ChevronLeft,
    ChevronRight,
    Gauge,
    Grid,
    Minus,
    Pause,
    Play,
    Shield,
    Square,
    Zap,
} from 'lucide-react';
import './auto-x-eo.scss';

// ─── Interfaces & Types ────────────────────────────────────────────────────────

export interface MarketDigitState {
    symbol: string;
    label: string;
    digits: number[];
    currentPrice: string;
    lastDigit: number;
    pip: number;
}

export interface DigitStat {
    digit: number;
    count: number;
    percentage: number;
    rank: number;
    power: number;
    isIncreasing: boolean;
    isEven: boolean;
}

export interface TradeLogItem {
    id: string;
    time: string;
    market: string;
    strategy: 'EVEN_ODD' | 'RECOVERY_OVER' | 'RECOVERY_UNDER';
    contractType: string;
    prediction?: number;
    stake: number;
    result: 'WIN' | 'LOSS' | 'PENDING';
    profit: number;
}

type AutoRunState = 'IDLE' | 'SCANNING' | 'WAITING_SIGNAL' | 'WAITING_TRIGGER' | 'TRADING' | 'PAUSED';

const MARKETS = SUPPORTED_VOLATILITY_MARKETS.map(m => ({
    symbol: m.symbol,
    label: m.label.replace('Volatility ', 'Vol ').replace(' Index', ''),
    pip: m.pip || 2,
}));

const MAX_TICKS_STORED = 100;
const CHART_TICKS = 50;

// ─── Web Audio API Sound Effects ───────────────────────────────────────────────

const playSoundCue = (type: 'win' | 'loss' | 'signal') => {
    try {
        const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
        if (!AudioContextClass) return;
        const ctx = new AudioContextClass();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        osc.connect(gain);
        gain.connect(ctx.destination);

        const now = ctx.currentTime;
        if (type === 'win') {
            osc.frequency.setValueAtTime(587.33, now); // D5
            osc.frequency.exponentialRampToValueAtTime(880, now + 0.15); // A5
            gain.gain.setValueAtTime(0.15, now);
            gain.gain.exponentialRampToValueAtTime(0.01, now + 0.35);
            osc.start(now);
            osc.stop(now + 0.35);
        } else if (type === 'loss') {
            osc.frequency.setValueAtTime(392.0, now); // G4
            osc.frequency.exponentialRampToValueAtTime(220, now + 0.2); // A3
            gain.gain.setValueAtTime(0.15, now);
            gain.gain.exponentialRampToValueAtTime(0.01, now + 0.3);
            osc.start(now);
            osc.stop(now + 0.3);
        } else {
            osc.frequency.setValueAtTime(659.25, now); // E5
            gain.gain.setValueAtTime(0.1, now);
            gain.gain.exponentialRampToValueAtTime(0.01, now + 0.15);
            osc.start(now);
            osc.stop(now + 0.15);
        }
    } catch {
        // Silently ignore audio context failures
    }
};

// ─── SVG Spline Line Chart (Elite Pro Specification) ───────────────────────────

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

const DigitLineChart: React.FC<{ digits: number[] }> = ({ digits }) => {
    const slice = digits.slice(-CHART_TICKS);
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
                    <linearGradient id='eoLineGrad' x1='0%' y1='0%' x2='100%' y2='0%'>
                        <stop offset='0%' stopColor='#00d2ff' stopOpacity='0.8' />
                        <stop offset='50%' stopColor='#a855f7' stopOpacity='1' />
                        <stop offset='100%' stopColor='#c084fc' stopOpacity='0.9' />
                    </linearGradient>
                    <filter id='eoGlow' x='-20%' y='-20%' width='140%' height='140%'>
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
                                stroke='rgba(255, 255, 255, 0.08)'
                                strokeWidth='1'
                                strokeDasharray={level === 3 || level === 6 ? '3 3' : undefined}
                            />
                            <text
                                x='4'
                                y={y - 3}
                                fill='rgba(255, 255, 255, 0.35)'
                                fontSize='9'
                                fontFamily='monospace'
                            >
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
                        stroke='url(#eoLineGrad)'
                        strokeWidth={2.4}
                        strokeLinejoin='round'
                        strokeLinecap='round'
                        filter='url(#eoGlow)'
                    />
                )}

                {/* Dots and condition-colored rectangular badges + bold digit labels */}
                {points.map((p, i) => {
                    const isLatest = i === points.length - 1;
                    const isEven = p.d % 2 === 0;
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
                                        ? '#ffffff'
                                        : isEven
                                          ? '#00d2ff'
                                          : '#a855f7'
                                }
                                stroke={isLatest ? '#ffffff' : '#8b5cf6'}
                                strokeWidth={1.5}
                            />
                            <text
                                x={p.x}
                                y={p.y - 8}
                                textAnchor='middle'
                                fill={isLatest ? '#ffffff' : isEven ? '#38bdf8' : '#c084fc'}
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

// ─── Digit Extraction Helper ───────────────────────────────────────────────────

const extractLastDigit = (quote: number | string, pip = 2): number => {
    const p = Number(quote);
    if (isNaN(p)) return 0;
    const fixed = p.toFixed(pip);
    const lastChar = fixed[fixed.length - 1];
    const digit = parseInt(lastChar, 10);
    return isNaN(digit) ? 0 : digit;
};

// ─── Main Component ────────────────────────────────────────────────────────────

const AutoXEo: React.FC = observer(() => {
    const store = useStore();
    const { run_panel, summary_card, transactions, client } = store;
    const currency = client?.currency || 'USD';

    // ── UI States ──
    const [selectedSymbol, setSelectedSymbol] = useState<string>('R_100');
    const [scanAllMarkets, setScanAllMarkets] = useState<boolean>(true);
    const [showWideView, setShowWideView] = useState<boolean>(false);
    const [autoSwitchMarkets, setAutoSwitchMarkets] = useState<boolean>(true);
    const [maxRunsBeforeCheck, setMaxRunsBeforeCheck] = useState<number>(6);
    const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(false);

    // ── Strategy Configuration & Inputs ──
    const [initialStake, setInitialStake] = useState<string>('0.50');
    const [currentStake, setCurrentStake] = useState<number>(0.5);
    const [martingale, setMartingale] = useState<string>('2.6');
    const [takeProfit, setTakeProfit] = useState<string>('10.00');
    const [stopLoss, setStopLoss] = useState<string>('25.00');
    const [tickDuration, setTickDuration] = useState<string>('1');
    const [bulkCount, setBulkCount] = useState<string>('6');
    const [autoRecoveryMode, setAutoRecoveryMode] = useState<boolean>(true);
    const [recoveryType, setRecoveryType] = useState<'OVER_2_UNDER_8' | 'OVER_3_UNDER_6'>('OVER_2_UNDER_8');
    const [targetProbabilityThreshold, setTargetProbabilityThreshold] = useState<number>(58);

    // ── Bot Running State ──
    const [botState, setBotState] = useState<AutoRunState>('IDLE');
    const [sessionProfit, setSessionProfit] = useState<number>(0);
    const [winsCount, setWinsCount] = useState<number>(0);
    const [lossesCount, setLossesCount] = useState<number>(0);
    const [consecutiveRuns, setConsecutiveRuns] = useState<number>(0);
    const [isInRecovery, setIsInRecovery] = useState<boolean>(false);
    const [accumulatedLoss, setAccumulatedLoss] = useState<number>(0);
    const [tradeLog, setTradeLog] = useState<TradeLogItem[]>([]);
    const [milestone, setMilestone] = useState<{ isOpen: boolean; type: 'tp' | 'sl' | null }>({
        isOpen: false,
        type: null,
    });

    // ── Active Market Data Map & Subscriptions ──
    const marketsDataRef = useRef<Map<string, MarketDigitState>>(new Map());
    const subscriptionsRef = useRef<Map<string, any>>(new Map());
    const [renderTrigger, setRenderTrigger] = useState<number>(0);
    const isMountedRef = useRef<boolean>(true);
    const executionLockRef = useRef<boolean>(false);

    // Initialize market entries
    useEffect(() => {
        MARKETS.forEach(m => {
            if (!marketsDataRef.current.has(m.symbol)) {
                marketsDataRef.current.set(m.symbol, {
                    symbol: m.symbol,
                    label: m.label,
                    digits: [],
                    currentPrice: '0.00',
                    lastDigit: 0,
                    pip: m.pip,
                });
            }
        });
    }, []);

    // Throttle UI re-renders
    const lastRenderTime = useRef<number>(0);
    const throttleRender = useCallback(() => {
        const now = Date.now();
        if (now - lastRenderTime.current > 100) {
            lastRenderTime.current = now;
            setRenderTrigger(t => t + 1);
        }
    }, []);

    // ── Manage Subscriptions for All Synthetic Markets ──
    const [streamRefreshKey, setStreamRefreshKey] = useState<number>(0);

    // Listen to account switch, WebSocket re-auth, and visibility change to refresh live streams
    useEffect(() => {
        const handleRefresh = () => {
            setStreamRefreshKey(k => k + 1);
        };

        const handleVisibility = () => {
            if (!document.hidden) {
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

    // ── Manage Subscriptions for All Synthetic Markets ──
    useEffect(() => {
        isMountedRef.current = true;
        const activeSubs = subscriptionsRef.current;
        const symbolsToStream = scanAllMarkets ? MARKETS.map(m => m.symbol) : [selectedSymbol];

        const subscribeSymbol = async (sym: string) => {
            if (!api_base.api || !isMountedRef.current) return;
            const pip = MARKETS.find(m => m.symbol === sym)?.pip || 2;

            try {
                const mData = marketsDataRef.current.get(sym);
                // Fetch initial tick history if missing or short
                if (!mData || mData.digits.length < 20) {
                    const res = await api_base.api.send({
                        ticks_history: sym,
                        end: 'latest',
                        count: MAX_TICKS_STORED,
                        style: 'ticks',
                    });

                    if (!isMountedRef.current) return;

                    if (mData && res?.history?.prices) {
                        const prices: number[] = res.history.prices || [];
                        const digits = prices.map(p => extractLastDigit(p, pip));
                        mData.digits = digits;
                        if (prices.length > 0) {
                            const lastP = prices[prices.length - 1];
                            mData.currentPrice = Number(lastP).toFixed(pip);
                            mData.lastDigit = digits[digits.length - 1];
                        }
                        throttleRender();
                    }
                }

                // Subscribe to real-time live ticks via observable
                const tickObservable = (api_base.api as any)?.subscribe?.({ ticks: sym });
                const sub = safeSubscribe(tickObservable, (tickRes: any) => {
                    if (!isMountedRef.current) return;
                    if (tickRes?.tick?.symbol === sym && tickRes?.tick?.quote !== undefined) {
                        const quote = Number(tickRes.tick.quote);
                        const lastD = extractLastDigit(quote, pip);
                        const item = marketsDataRef.current.get(sym);
                        if (item) {
                            item.currentPrice = quote.toFixed(pip);
                            item.lastDigit = lastD;
                            item.digits = [...item.digits, lastD].slice(-MAX_TICKS_STORED);
                            throttleRender();
                        }
                    }
                });

                if (isMountedRef.current) {
                    activeSubs.get(sym)?.unsubscribe?.();
                    activeSubs.set(sym, sub);
                }
            } catch (err) {
                console.error(`AUTO X E/O: Error subscribing to ${sym}:`, err);
            }
        };

        // Subscribe symbols
        const initAll = async () => {
            if (!api_base.api) {
                setTimeout(initAll, 1000);
                return;
            }
            for (const sym of symbolsToStream) {
                if (!isMountedRef.current) break;
                await subscribeSymbol(sym);
                await new Promise(r => setTimeout(r, 120)); // Rate-limiting guard
            }
        };

        void initAll();

        // Unsubscribe removed if single market mode
        if (!scanAllMarkets) {
            activeSubs.forEach((sub, sym) => {
                if (sym !== selectedSymbol) {
                    try {
                        sub?.unsubscribe?.();
                    } catch {
                        /* ignore */
                    }
                    activeSubs.delete(sym);
                }
            });
        }

        return () => {
            // Keep active streams alive
        };
    }, [scanAllMarkets, selectedSymbol, throttleRender, streamRefreshKey]);

    // Cleanup on component unmount
    useEffect(() => {
        return () => {
            isMountedRef.current = false;
            subscriptionsRef.current.forEach(sub => {
                try {
                    sub?.unsubscribe?.();
                } catch {
                    /* ignore */
                }
            });
            subscriptionsRef.current.clear();
        };
    }, []);

    // ── Current Active Market State ──
    const currentMarket = useMemo(() => {
        const m = marketsDataRef.current.get(selectedSymbol);
        if (m) return m;
        return {
            symbol: selectedSymbol,
            label: MARKETS.find(x => x.symbol === selectedSymbol)?.label || selectedSymbol,
            digits: [],
            currentPrice: '0.00',
            lastDigit: 0,
            pip: 2,
        };
    }, [selectedSymbol, renderTrigger]);

    // ── Digit Distribution Analysis (0-9 in Last 60 Ticks) ──
    const digitStats: DigitStat[] = useMemo(() => {
        const recent60 = currentMarket.digits.slice(-60);
        const total = recent60.length || 1;
        const counts = new Array(10).fill(0);

        recent60.forEach(d => {
            if (d >= 0 && d <= 9) counts[d]++;
        });

        // Calculate trend (last 15 vs previous 15)
        const last15 = currentMarket.digits.slice(-15);
        const prev15 = currentMarket.digits.slice(-30, -15);

        const stats: DigitStat[] = counts.map((count, digit) => {
            const percentage = Math.round((count / total) * 1000) / 10;
            const c15 = last15.filter(d => d === digit).length;
            const p15 = prev15.filter(d => d === digit).length;
            const isIncreasing = c15 > p15;
            const isEven = digit % 2 === 0;

            return {
                digit,
                count,
                percentage,
                rank: 0,
                power: Math.min(100, Math.round((percentage / 20) * 100)),
                isIncreasing,
                isEven,
            };
        });

        // Assign ranks
        const sorted = [...stats].sort((a, b) => b.count - a.count);
        sorted.forEach((item, index) => {
            const original = stats.find(s => s.digit === item.digit);
            if (original) original.rank = index + 1;
        });

        return stats;
    }, [currentMarket.digits]);

    // ── Summary Rankings (Most, 2nd Highest, Least) ──
    const mostAppearing = useMemo(() => {
        const sorted = [...digitStats].sort((a, b) => b.count - a.count);
        return sorted[0]?.digit ?? null;
    }, [digitStats]);

    const secondHighest = useMemo(() => {
        const sorted = [...digitStats].sort((a, b) => b.count - a.count);
        return sorted[1]?.digit ?? null;
    }, [digitStats]);

    const leastAppearing = useMemo(() => {
        const sorted = [...digitStats].sort((a, b) => a.count - b.count);
        return sorted[0]?.digit ?? null;
    }, [digitStats]);

    // ── Even vs Odd Statistical Analysis (Last 60 Ticks) ──
    const eoAnalysis = useMemo(() => {
        const last60 = currentMarket.digits.slice(-60);
        const total = last60.length || 1;

        const evenCount = last60.filter(d => d % 2 === 0).length;
        const oddCount = last60.filter(d => d % 2 !== 0).length;

        const evenPct = Math.round((evenCount / total) * 100);
        const oddPct = Math.round((oddCount / total) * 100);

        // Trend calculation (last 15 vs prev 15)
        const last15 = currentMarket.digits.slice(-15);
        const prev15 = currentMarket.digits.slice(-30, -15);
        const last15Even = last15.filter(d => d % 2 === 0).length;
        const prev15Even = prev15.filter(d => d % 2 === 0).length;
        const last15Odd = last15.filter(d => d % 2 !== 0).length;
        const prev15Odd = prev15.filter(d => d % 2 !== 0).length;

        const isEvenIncreasing = last15Even >= prev15Even;
        const isOddIncreasing = last15Odd >= prev15Odd;

        // Check if at least 3 digits of Even have probability > 10.5%
        const evenDigitsAbove10_5 = digitStats.filter(s => s.isEven && s.percentage >= 10.5).length;
        const oddDigitsAbove10_5 = digitStats.filter(s => !s.isEven && s.percentage >= 10.5).length;

        // Check if Most/2nd highest are Even
        const mostIsEven = mostAppearing !== null && mostAppearing % 2 === 0;
        const secondIsEven = secondHighest !== null && secondHighest % 2 === 0;
        const leastIsOdd = leastAppearing !== null && leastAppearing % 2 !== 0;

        const mostIsOdd = mostAppearing !== null && mostAppearing % 2 !== 0;
        const secondIsOdd = secondHighest !== null && secondHighest % 2 !== 0;
        const leastIsEven = leastAppearing !== null && leastAppearing % 2 === 0;

        // Check last 15 ticks >= 10 matches
        const last15EvenPassed = last15Even >= 10;
        const last15OddPassed = last15Odd >= 10;

        // Consecutive pattern check: Wait for 2+ consecutive odd then 1 even (for Even signal)
        const last3Digits = currentMarket.digits.slice(-3);
        let evenPatternTriggered = false;
        let oddPatternTriggered = false;

        if (last3Digits.length >= 3) {
            // [odd, odd, even]
            if (last3Digits[0] % 2 !== 0 && last3Digits[1] % 2 !== 0 && last3Digits[2] % 2 === 0) {
                evenPatternTriggered = true;
            }
            // [even, even, odd]
            if (last3Digits[0] % 2 === 0 && last3Digits[1] % 2 === 0 && last3Digits[2] % 2 !== 0) {
                oddPatternTriggered = true;
            }
        }

        // Final Even signal readiness
        const evenSignalReady =
            evenPct >= targetProbabilityThreshold &&
            isEvenIncreasing &&
            (mostIsEven || secondIsEven) &&
            leastIsOdd &&
            last15EvenPassed &&
            evenDigitsAbove10_5 >= 3;

        // Final Odd signal readiness
        const oddSignalReady =
            oddPct >= targetProbabilityThreshold &&
            isOddIncreasing &&
            (mostIsOdd || secondIsOdd) &&
            leastIsEven &&
            last15OddPassed &&
            oddDigitsAbove10_5 >= 3;

        let activeSignal: 'EVEN' | 'ODD' | 'NONE' = 'NONE';
        if (evenSignalReady) activeSignal = 'EVEN';
        else if (oddSignalReady) activeSignal = 'ODD';

        return {
            evenCount,
            oddCount,
            evenPct,
            oddPct,
            isEvenIncreasing,
            isOddIncreasing,
            evenDigitsAbove10_5,
            oddDigitsAbove10_5,
            last15Even,
            last15Odd,
            last15EvenPassed,
            last15OddPassed,
            evenPatternTriggered,
            oddPatternTriggered,
            evenSignalReady,
            oddSignalReady,
            activeSignal,
        };
    }, [currentMarket.digits, digitStats, mostAppearing, secondHighest, leastAppearing, targetProbabilityThreshold]);

    // ── Over/Under Statistics (Last 50 Ticks) ──
    const ouAnalysis = useMemo(() => {
        const last50 = currentMarket.digits.slice(-50);
        const total = last50.length || 1;

        // Split 1: Under 0-4 vs Over 5-9
        const under04 = last50.filter(d => d <= 4).length;
        const over59 = last50.filter(d => d >= 5).length;
        const under04Pct = Math.round((under04 / total) * 100);
        const over59Pct = Math.round((over59 / total) * 100);

        // Split 2: Under 0-5 vs Over 4-9
        const under05 = last50.filter(d => d <= 5).length;
        const over49 = last50.filter(d => d >= 4).length;
        const under05Pct = Math.round((under05 / total) * 100);
        const over49Pct = Math.round((over49 / total) * 100);

        // Highest Entry Digit in Under (0-4) and Over (5-9)
        const underDigits = digitStats.filter(s => s.digit <= 4).sort((a, b) => b.count - a.count);
        const overDigits = digitStats.filter(s => s.digit >= 5).sort((a, b) => b.count - a.count);
        const highestUnderEntryDigit = underDigits[0]?.digit ?? 2;
        const highestOverEntryDigit = overDigits[0]?.digit ?? 7;

        // Last 10 and 7 Ticks direction check
        const last10 = currentMarket.digits.slice(-10);
        const last10Under = last10.filter(d => d <= 4).length;
        const last10Over = last10.filter(d => d >= 5).length;

        const last7 = currentMarket.digits.slice(-7);
        const last7Under = last7.filter(d => d <= 4).length;
        const last7Over = last7.filter(d => d >= 5).length;

        // Bias calculation
        let bias: 'UNDER' | 'OVER' | 'NEUTRAL' = 'NEUTRAL';
        if (under04Pct >= 55 && under05 > over49 && last10Under >= 7 && last7Under >= 5) {
            bias = 'UNDER';
        } else if (over59Pct >= 55 && over49 > under05 && last10Over >= 7 && last7Over >= 5) {
            bias = 'OVER';
        }

        return {
            under04,
            over59,
            under04Pct,
            over59Pct,
            under05,
            over49,
            under05Pct,
            over49Pct,
            highestUnderEntryDigit,
            highestOverEntryDigit,
            last10Under,
            last10Over,
            last7Under,
            last7Over,
            bias,
        };
    }, [currentMarket.digits, digitStats]);

    // ── Best Market Candidate for Auto-Switching ──
    const bestMarketCandidate = useMemo(() => {
        let bestSym = selectedSymbol;
        let bestScore = -1;

        marketsDataRef.current.forEach((mState, sym) => {
            if (mState.digits.length < 30) return;
            const last60 = mState.digits.slice(-60);
            const total = last60.length || 1;
            const eCount = last60.filter(d => d % 2 === 0).length;
            const oCount = last60.filter(d => d % 2 !== 0).length;
            const maxEO = Math.max(eCount, oCount);
            const score = Math.round((maxEO / total) * 100);

            if (score > bestScore) {
                bestScore = score;
                bestSym = sym;
            }
        });

        return bestSym;
    }, [selectedSymbol, renderTrigger]);

    // ── Log and Drawer Contract Emitter ──
    const pushContractToDrawer = useCallback(
        (contractSnapshot: Record<string, unknown>) => {
            try {
                transactions?.pushTransaction?.({ ...contractSnapshot, run_id: run_panel?.run_id });
                run_panel?.onBotContractEvent?.(contractSnapshot);
                summary_card?.onBotContractEvent?.(contractSnapshot);
            } catch {
                // Ignore if core stores aren't initialized
            }
        },
        [run_panel, summary_card, transactions]
    );

    const addLogEntry = useCallback(
        (
            market: string,
            strategy: 'EVEN_ODD' | 'RECOVERY_OVER' | 'RECOVERY_UNDER',
            contractType: string,
            prediction: number | undefined,
            stake: number,
            result: 'WIN' | 'LOSS' | 'PENDING',
            profit: number
        ) => {
            const item: TradeLogItem = {
                id: `log-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
                time: new Date().toLocaleTimeString(),
                market,
                strategy,
                contractType,
                prediction,
                stake,
                result,
                profit,
            };
            setTradeLog(prev => [item, ...prev.slice(0, 49)]);
            return item.id;
        },
        []
    );

    const updateLogResult = useCallback((id: string, result: 'WIN' | 'LOSS', profit: number) => {
        setTradeLog(prev => prev.map(item => (item.id === id ? { ...item, result, profit } : item)));
    }, []);

    // ── Execute Trade Order ──
    const executeTradeOrder = useCallback(
        async (
            market: string,
            strategy: 'EVEN_ODD' | 'RECOVERY_OVER' | 'RECOVERY_UNDER',
            contractType: 'DIGITEVEN' | 'DIGITODD' | 'DIGITOVER' | 'DIGITUNDER',
            barrier: number | undefined,
            stake: number
        ) => {
            if (executionLockRef.current) return;
            executionLockRef.current = true;
            setBotState('TRADING');
            playSoundCue('signal');

            const logId = addLogEntry(market, strategy, contractType, barrier, stake, 'PENDING', 0);

            try {
                const duration = parseInt(tickDuration, 10) || 1;
                const params: Record<string, any> = {
                    amount: stake,
                    basis: 'stake',
                    contract_type: contractType,
                    currency,
                    duration,
                    duration_unit: 't',
                    symbol: market,
                };

                if (barrier !== undefined && (contractType === 'DIGITOVER' || contractType === 'DIGITUNDER')) {
                    params.barrier = String(barrier);
                }

                const buyResult = await buyContractForUi({
                    parameters: params,
                    price: stake,
                    source: 'AUTO X E/O',
                });

                if (!buyResult?.contract_id) {
                    throw new Error('No contract ID returned');
                }

                const contractId = buyResult.contract_id;
                const transactionId = buyResult.transaction_id || contractId;
                const startTime = Math.floor(Date.now() / 1000);
                const marketLabel = MARKETS.find(m => m.symbol === market)?.label || market;

                const initSnapshot = {
                    contract_id: contractId,
                    transaction_ids: { buy: transactionId },
                    buy_price: stake,
                    underlying: market,
                    underlying_symbol: market,
                    display_name: marketLabel,
                    shortcode: `AUTO_X_${contractType}`,
                    contract_type: contractType,
                    currency: currency || 'USD',
                    date_start: startTime,
                    status: 'open',
                    ...(barrier !== undefined ? { barrier: String(barrier) } : {}),
                };
                pushContractToDrawer(initSnapshot);

                // Stream until settled
                const settledSnapshot = await streamContractUntilSettled({
                    contractId,
                    fallback: initSnapshot,
                    onUpdate: snapshot => {
                        pushContractToDrawer(snapshot);
                    },
                    source: 'AUTO X E/O',
                });

                pushContractToDrawer(settledSnapshot);
                const profitVal = Number(settledSnapshot?.profit || 0);
                const isWin = profitVal > 0;

                if (isWin) {
                    playSoundCue('win');
                    updateLogResult(logId, 'WIN', profitVal);
                    setWinsCount(w => w + 1);
                    setSessionProfit(p => p + profitVal);

                    if (isInRecovery) {
                        // Recovered! Reset back to initial stake and exit recovery
                        setIsInRecovery(false);
                        setAccumulatedLoss(0);
                        setCurrentStake(parseFloat(initialStake) || 0.5);
                    } else {
                        // Normal win -> reset stake
                        setCurrentStake(parseFloat(initialStake) || 0.5);
                    }
                } else {
                    playSoundCue('loss');
                    updateLogResult(logId, 'LOSS', profitVal);
                    setLossesCount(l => l + 1);
                    setSessionProfit(p => p + profitVal);

                    if (autoRecoveryMode) {
                        setIsInRecovery(true);
                        const martMult = parseFloat(martingale) || 2.6;
                        const nextStake = Math.round(stake * martMult * 100) / 100;
                        setCurrentStake(nextStake);
                        setAccumulatedLoss(prev => prev + Math.abs(profitVal));
                    } else {
                        // Standard martingale
                        const martMult = parseFloat(martingale) || 2.0;
                        const nextStake = Math.round(stake * martMult * 100) / 100;
                        setCurrentStake(nextStake);
                    }
                }

                setConsecutiveRuns(r => r + 1);
                executionLockRef.current = false;
            } catch (err: any) {
                console.error('AUTO X E/O Trade execution failed:', err);
                updateLogResult(logId, 'LOSS', -stake);
                executionLockRef.current = false;
                setBotState('SCANNING');
            }
        },
        [
            addLogEntry,
            updateLogResult,
            tickDuration,
            currency,
            pushContractToDrawer,
            isInRecovery,
            initialStake,
            autoRecoveryMode,
            martingale,
        ]
    );

    // ── Main Automated AI Loop ──
    useEffect(() => {
        if (botState === 'IDLE' || botState === 'PAUSED' || executionLockRef.current) return;

        // Check TP / SL Limits
        const tpVal = parseFloat(takeProfit) || 10;
        const slVal = parseFloat(stopLoss) || 25;

        if (sessionProfit >= tpVal) {
            setBotState('IDLE');
            setMilestone({ isOpen: true, type: 'tp' });
            return;
        }
        if (sessionProfit <= -slVal) {
            setBotState('IDLE');
            setMilestone({ isOpen: true, type: 'sl' });
            return;
        }

        // Market Auto-Switch Check after max consecutive runs
        if (autoSwitchMarkets && consecutiveRuns >= maxRunsBeforeCheck) {
            if (bestMarketCandidate && bestMarketCandidate !== selectedSymbol) {
                setSelectedSymbol(bestMarketCandidate);
                setConsecutiveRuns(0);
                return;
            }
            setConsecutiveRuns(0);
        }

        // Recovery Mode Branch
        if (isInRecovery) {
            // Evaluate Over/Under recovery conditions
            const bias = ouAnalysis.bias;

            if (bias === 'UNDER') {
                const barrier = recoveryType === 'OVER_2_UNDER_8' ? 8 : 6;
                // Wait for high entry digit in Under to appear or last 7 ticks favor Under
                if (
                    currentMarket.digits.slice(-7).filter(d => d <= 4).length >= 5 ||
                    currentMarket.lastDigit === ouAnalysis.highestUnderEntryDigit
                ) {
                    executeTradeOrder(selectedSymbol, 'RECOVERY_UNDER', 'DIGITUNDER', barrier, currentStake);
                }
            } else if (bias === 'OVER') {
                const barrier = recoveryType === 'OVER_2_UNDER_8' ? 2 : 3;
                // Wait for high entry digit in Over to appear or last 7 ticks favor Over
                if (
                    currentMarket.digits.slice(-7).filter(d => d >= 5).length >= 5 ||
                    currentMarket.lastDigit === ouAnalysis.highestOverEntryDigit
                ) {
                    executeTradeOrder(selectedSymbol, 'RECOVERY_OVER', 'DIGITOVER', barrier, currentStake);
                }
            } else {
                // Neutral fallback -> use safe Under 8
                executeTradeOrder(selectedSymbol, 'RECOVERY_UNDER', 'DIGITUNDER', 8, currentStake);
            }
            return;
        }

        // Base Even / Odd Strategy Branch
        if (eoAnalysis.evenSignalReady) {
            // Signal matches! Now wait for Consecutive reversal pattern: 2+ consecutive odds followed by 1 even
            if (eoAnalysis.evenPatternTriggered) {
                executeTradeOrder(selectedSymbol, 'EVEN_ODD', 'DIGITEVEN', undefined, currentStake);
            } else {
                setBotState('WAITING_TRIGGER');
            }
        } else if (eoAnalysis.oddSignalReady) {
            // Odd Signal matches! Wait for 2+ consecutive evens followed by 1 odd
            if (eoAnalysis.oddPatternTriggered) {
                executeTradeOrder(selectedSymbol, 'EVEN_ODD', 'DIGITODD', undefined, currentStake);
            } else {
                setBotState('WAITING_TRIGGER');
            }
        } else {
            setBotState('SCANNING');

            // If auto-switch is on and active market is weak, auto switch to best candidate
            if (autoSwitchMarkets && bestMarketCandidate !== selectedSymbol) {
                setSelectedSymbol(bestMarketCandidate);
            }
        }
    }, [
        botState,
        sessionProfit,
        takeProfit,
        stopLoss,
        currency,
        autoSwitchMarkets,
        consecutiveRuns,
        maxRunsBeforeCheck,
        bestMarketCandidate,
        selectedSymbol,
        isInRecovery,
        ouAnalysis,
        currentMarket,
        recoveryType,
        currentStake,
        executeTradeOrder,
        eoAnalysis,
    ]);

    // ── Bot Start / Pause / Stop Handlers ──
    const handleStartBot = () => {
        setCurrentStake(parseFloat(initialStake) || 0.5);
        setBotState('SCANNING');
    };

    const handlePauseBot = () => {
        setBotState(prev => (prev === 'PAUSED' ? 'SCANNING' : 'PAUSED'));
    };

    const handleStopBot = () => {
        setBotState('IDLE');
        executionLockRef.current = false;
    };

    // TopBar controller integration
    useEffect(() => {
        window.dispatchEvent(
            new CustomEvent('PH_ENGINE_STATUS_UPDATE', {
                detail: {
                    tab: 'auto_x_eo',
                    isRunning: botState !== 'IDLE',
                    state: botState,
                    profit: sessionProfit,
                },
            })
        );
    }, [botState, sessionProfit]);

    useEffect(() => {
        const handleTrigger = (e: Event) => {
            const customEvent = e as CustomEvent<{ tab: string; action: string }>;
            if (customEvent.detail?.tab === 'auto_x_eo') {
                if (botState === 'IDLE') {
                    handleStartBot();
                } else {
                    handleStopBot();
                }
            }
        };
        window.addEventListener('PH_TRIGGER_ENGINE_ACTION', handleTrigger);
        return () => {
            window.removeEventListener('PH_TRIGGER_ENGINE_ACTION', handleTrigger);
        };
    }, [botState]);



    return (
        <div className='auto-x-eo'>
            {/* 1. Header Bar */}
            <div className='auto-x-eo__header'>
                <div className='auto-x-eo__header-brand'>
                    <div className='brand-icon'>
                        <Zap size={24} />
                    </div>
                    <div className='brand-text'>
                        <h1>AUTO X E/O</h1>
                        <span>Smart AI Parity &amp; Recovery Suite</span>
                    </div>
                </div>

                <div className='auto-x-eo__header-metrics'>
                    <div className='metric-pill'>
                        <span className='label'>Session P/L</span>
                        <span className={`val ${sessionProfit >= 0 ? 'profit-pos' : 'profit-neg'}`}>
                            {sessionProfit >= 0 ? `+${sessionProfit.toFixed(2)}` : sessionProfit.toFixed(2)} {currency}
                        </span>
                    </div>
                    <div className='metric-pill'>
                        <span className='label'>Win / Loss</span>
                        <span className='val'>
                            <span style={{ color: '#10b981' }}>{winsCount}W</span> /{' '}
                            <span style={{ color: '#ef4444' }}>{lossesCount}L</span>
                        </span>
                    </div>
                    <div className='metric-pill'>
                        <span className='label'>Current Stake</span>
                        <span className='val gold'>
                            {currentStake.toFixed(2)} {currency}
                        </span>
                    </div>
                    <div className='metric-pill'>
                        <span className='label'>Bot Status</span>
                        <span className='val cyan' style={{ fontSize: '0.85rem' }}>
                            {botState === 'IDLE' && '⏹ IDLE'}
                            {botState === 'SCANNING' && '🔍 SCANNING'}
                            {botState === 'WAITING_SIGNAL' && '⏳ WAITING SIGNAL'}
                            {botState === 'WAITING_TRIGGER' && '⚡ PATTERN TRIGGER'}
                            {botState === 'TRADING' && '🚀 TRADING'}
                            {botState === 'PAUSED' && '⏸ PAUSED'}
                        </span>
                    </div>
                </div>

                <div className='auto-x-eo__header-controls'>
                    {botState === 'IDLE' ? (
                        <button className='btn-start' onClick={handleStartBot}>
                            <Play size={18} /> START AUTO TRADER
                        </button>
                    ) : (
                        <>
                            <button className='btn-pause' onClick={handlePauseBot}>
                                {botState === 'PAUSED' ? <Play size={16} /> : <Pause size={16} />}
                                {botState === 'PAUSED' ? 'RESUME' : 'PAUSE'}
                            </button>
                            <button className='btn-stop' onClick={handleStopBot}>
                                <Square size={16} /> STOP
                            </button>
                        </>
                    )}
                </div>
            </div>

            {/* 2. Market Toolbar */}
            <div className='auto-x-eo__market-toolbar'>
                <div className='market-select-group'>
                    <select
                        className='custom-select'
                        value={selectedSymbol}
                        onChange={e => setSelectedSymbol(e.target.value)}
                    >
                        {MARKETS.map(m => (
                            <option key={m.symbol} value={m.symbol}>
                                {m.label} ({m.symbol})
                            </option>
                        ))}
                    </select>

                    <div className='badge-live-price'>
                        <span className='dot-pulse' />
                        <span>PRICE: {currentMarket.currentPrice}</span>
                    </div>

                    <div className='badge-digit-glow' title='Current Last Digit'>
                        {currentMarket.lastDigit}
                    </div>
                </div>

                <div className='market-toggles'>
                    <label className={`toggle-chip ${scanAllMarkets ? 'active' : ''}`}>
                        <input
                            type='checkbox'
                            checked={scanAllMarkets}
                            onChange={e => setScanAllMarkets(e.target.checked)}
                        />
                        <span>Scan All Synthetics</span>
                    </label>

                    <label className={`toggle-chip ${autoSwitchMarkets ? 'active' : ''}`}>
                        <input
                            type='checkbox'
                            checked={autoSwitchMarkets}
                            onChange={e => setAutoSwitchMarkets(e.target.checked)}
                        />
                        <span>Auto-Switch Market</span>
                    </label>

                    <button className='btn-view-toggle' onClick={() => setShowWideView(prev => !prev)}>
                        <Grid size={15} />
                        {showWideView ? 'Hide Grid View' : 'Wide Market Stats'}
                    </button>
                </div>
            </div>

            {/* 3. Wide View Modal Grid (Expandable) */}
            {showWideView && (
                <div className='auto-x-eo__wide-view'>
                    <div className='wide-view-header'>
                        <h3>
                            <Activity size={18} /> All Synthetic Indices Live Scanner
                        </h3>
                        <button className='close-btn' onClick={() => setShowWideView(false)}>
                            ✕
                        </button>
                    </div>

                    <div className='wide-grid'>
                        {MARKETS.map(m => {
                            const state = marketsDataRef.current.get(m.symbol) || {
                                digits: [],
                                currentPrice: '0.00',
                                lastDigit: 0,
                            };
                            const last60 = state.digits.slice(-60);
                            const total = last60.length || 1;
                            const evens = last60.filter(d => d % 2 === 0).length;
                            const odds = last60.filter(d => d % 2 !== 0).length;
                            const evenPct = Math.round((evens / total) * 100);
                            const oddPct = Math.round((odds / total) * 100);
                            const isSelected = m.symbol === selectedSymbol;
                            const isBest = m.symbol === bestMarketCandidate;

                            return (
                                <div
                                    key={m.symbol}
                                    className={`wide-card ${isSelected ? 'selected' : ''} ${isBest ? 'recommended' : ''}`}
                                    onClick={() => {
                                        setSelectedSymbol(m.symbol);
                                        setShowWideView(false);
                                    }}
                                >
                                    <div className='card-top'>
                                        <span className='market-name'>{m.label}</span>
                                        <span className='last-digit'>{state.lastDigit}</span>
                                    </div>
                                    <div className='card-stats'>
                                        <div className='stat-row'>
                                            <span>Price</span>
                                            <span>{state.currentPrice}</span>
                                        </div>
                                        <div className='stat-row'>
                                            <span>Even / Odd</span>
                                            <span>
                                                {evenPct}% / {oddPct}%
                                            </span>
                                        </div>
                                        <div className='mini-bar'>
                                            <div className='bar-even' style={{ width: `${evenPct}%` }} />
                                            <div className='bar-odd' style={{ width: `${oddPct}%` }} />
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}

            {/* 4. Main Body: Sidebar + Workspace */}
            <div className={`auto-x-eo__body ${sidebarCollapsed ? 'auto-x-eo__body--collapsed' : ''}`}>
                {/* Left Markets Sidebar */}
                <div className='auto-x-eo__sidebar'>
                    <div className='auto-x-eo__sidebar-header'>
                        <span>Derived Markets</span>
                        <button
                            className='collapse-btn'
                            onClick={() => setSidebarCollapsed(prev => !prev)}
                            title={sidebarCollapsed ? 'Expand' : 'Collapse'}
                        >
                            {sidebarCollapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
                        </button>
                    </div>

                    <div className='auto-x-eo__sidebar-list'>
                        {MARKETS.map(m => {
                            const state = marketsDataRef.current.get(m.symbol) || {
                                digits: [],
                                currentPrice: '0.00',
                                lastDigit: 0,
                            };
                            const last60 = state.digits.slice(-60);
                            const total = last60.length || 1;
                            const evens = last60.filter(d => d % 2 === 0).length;
                            const evenPct = Math.round((evens / total) * 100);
                            const isSelected = m.symbol === selectedSymbol;

                            return (
                                <div
                                    key={m.symbol}
                                    className={`sidebar-market-item ${isSelected ? 'active' : ''}`}
                                    onClick={() => setSelectedSymbol(m.symbol)}
                                >
                                    <div className='item-left'>
                                        <div className={`digit-badge ${state.lastDigit % 2 === 0 ? 'even' : 'odd'}`}>
                                            {state.lastDigit}
                                        </div>
                                        <div className='item-details'>
                                            <span className='title'>{m.label}</span>
                                            <span className='price'>{state.currentPrice}</span>
                                        </div>
                                    </div>

                                    <div className='item-stats'>
                                        <span className={`stat-tag ${evenPct >= 50 ? 'even-fav' : 'odd-fav'}`}>
                                            {evenPct >= 50 ? `E: ${evenPct}%` : `O: ${100 - evenPct}%`}
                                        </span>
                                        <span className='stat-sub'>{state.digits.length} ticks</span>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>

                {/* Right Workspace */}
                <div className='auto-x-eo__workspace'>
                    {/* Live 50 Ticks Trajectory Spline Chart */}
                    <div className='auto-x-eo__chart-card ep-chart-card'>
                        <div className='chart-header'>
                            <div className='chart-title-box'>
                                <h2>Live Digit Trajectory Stream</h2>
                                <span className='pill-ticks'>Last 50 Ticks</span>
                            </div>

                            <div className='chart-legend'>
                                <div className='legend-item'>
                                    <span className='dot' style={{ background: '#00d2ff', boxShadow: '0 0 8px rgba(0, 210, 255, 0.6)' }} />
                                    <span>Even (0,2,4,6,8)</span>
                                </div>
                                <div className='legend-item'>
                                    <span className='dot' style={{ background: '#a855f7', boxShadow: '0 0 8px rgba(168, 85, 247, 0.6)' }} />
                                    <span>Odd (1,3,5,7,9)</span>
                                </div>
                                <div className='legend-item'>
                                    <span className='dot' style={{ background: '#ffffff', boxShadow: '0 0 8px rgba(255, 255, 255, 0.8)' }} />
                                    <span>Active Spot</span>
                                </div>
                            </div>
                        </div>

                        <div className='ep-chart-wrap'>
                            <DigitLineChart digits={currentMarket.digits} />
                        </div>
                    </div>

                    {/* Digit 0-9 Statistical Grid */}
                    <div className='auto-x-eo__digits-grid'>
                        {digitStats.map(stat => {
                            const isTarget =
                                (eoAnalysis.activeSignal === 'EVEN' && stat.isEven) ||
                                (eoAnalysis.activeSignal === 'ODD' && !stat.isEven);

                            return (
                                <div
                                    key={stat.digit}
                                    className={`digit-stat-card ${stat.isEven ? 'is-even' : 'is-odd'} ${isTarget ? 'is-target' : ''}`}
                                >
                                    <span className='digit-num'>{stat.digit}</span>
                                    <span className={`digit-pct ${stat.percentage >= 10.5 ? 'highlight' : ''}`}>
                                        {stat.percentage}%
                                    </span>
                                    <span className='digit-count'>{stat.count} hits</span>

                                    <div className='power-bar-wrap'>
                                        <div className='power-bar-fill' style={{ width: `${stat.power}%` }} />
                                    </div>

                                    <div className={`trend-indicator ${stat.isIncreasing ? 'up' : 'steady'}`}>
                                        {stat.isIncreasing ? (
                                            <>
                                                <ArrowUpRight size={12} /> Rising
                                            </>
                                        ) : (
                                            <>
                                                <Minus size={12} /> Normal
                                            </>
                                        )}
                                    </div>
                                </div>
                            );
                        })}
                    </div>

                    {/* Key Rankings Strip */}
                    <div className='auto-x-eo__ranks-strip'>
                        <div className='rank-card'>
                            <div className='rank-info'>
                                <span className='title'>Most Appearing Digit</span>
                                <span className='sub'>Rank #1 Frequency</span>
                            </div>
                            <div className='rank-digit gold'>{mostAppearing ?? '-'}</div>
                        </div>

                        <div className='rank-card'>
                            <div className='rank-info'>
                                <span className='title'>2nd Highest Appearing</span>
                                <span className='sub'>Rank #2 Frequency</span>
                            </div>
                            <div className='rank-digit silver'>{secondHighest ?? '-'}</div>
                        </div>

                        <div className='rank-card'>
                            <div className='rank-info'>
                                <span className='title'>Least Appearing Digit</span>
                                <span className='sub'>Coldest Digit</span>
                            </div>
                            <div className='rank-digit cold'>{leastAppearing ?? '-'}</div>
                        </div>
                    </div>

                    {/* Dual Strategy Breakdown: Even/Odd & Over/Under */}
                    <div className='auto-x-eo__strategy-grid'>
                        {/* Even / Odd Smart AI Engine */}
                        <div className='strategy-card'>
                            <div className='card-head'>
                                <h3>
                                    <Gauge size={18} /> Even / Odd Smart AI Engine
                                </h3>
                                <span
                                    className={`badge-indicator ${eoAnalysis.activeSignal !== 'NONE' ? 'ready' : 'waiting'}`}
                                >
                                    {eoAnalysis.activeSignal !== 'NONE'
                                        ? `SIGNAL: ${eoAnalysis.activeSignal}`
                                        : 'SCANNING MARKET'}
                                </span>
                            </div>

                            <div className='eo-progress-section'>
                                <div className='eo-stats-row'>
                                    <span className='even-text'>
                                        Even: {eoAnalysis.evenPct}% ({eoAnalysis.evenCount} hits)
                                    </span>
                                    <span className='odd-text'>
                                        Odd: {eoAnalysis.oddPct}% ({eoAnalysis.oddCount} hits)
                                    </span>
                                </div>
                                <div className='eo-progress-bar'>
                                    <div className='fill-even' style={{ width: `${eoAnalysis.evenPct}%` }} />
                                    <div className='fill-odd' style={{ width: `${eoAnalysis.oddPct}%` }} />
                                </div>
                            </div>

                            <div className='conditions-list'>
                                <div
                                    className={`condition-item ${eoAnalysis.evenPct >= targetProbabilityThreshold || eoAnalysis.oddPct >= targetProbabilityThreshold ? 'passed' : 'pending'}`}
                                >
                                    <CheckCircle2 size={14} />
                                    <span>
                                        Target Probability &ge; {targetProbabilityThreshold}% &amp; Gaining Power
                                    </span>
                                </div>
                                <div
                                    className={`condition-item ${eoAnalysis.last15EvenPassed || eoAnalysis.last15OddPassed ? 'passed' : 'pending'}`}
                                >
                                    <CheckCircle2 size={14} />
                                    <span>Last 15 Ticks: &ge; 10 Digits Matching Direction</span>
                                </div>
                                <div
                                    className={`condition-item ${eoAnalysis.evenDigitsAbove10_5 >= 3 || eoAnalysis.oddDigitsAbove10_5 >= 3 ? 'passed' : 'pending'}`}
                                >
                                    <CheckCircle2 size={14} />
                                    <span>&ge; 3 Target Digits &gt; 10.5% in Last 60 Ticks</span>
                                </div>
                                <div
                                    className={`condition-item ${eoAnalysis.evenPatternTriggered || eoAnalysis.oddPatternTriggered ? 'passed' : 'pending'}`}
                                >
                                    <CheckCircle2 size={14} />
                                    <span>Reversal Trigger: 2+ Opposite then 1 Target Tick</span>
                                </div>
                            </div>
                        </div>

                        {/* Over / Under Recovery Engine */}
                        <div className='strategy-card'>
                            <div className='card-head'>
                                <h3>
                                    <Shield size={18} /> Over / Under Recovery Suite
                                </h3>
                                <span
                                    className={`badge-indicator ${ouAnalysis.bias !== 'NEUTRAL' ? 'ready' : 'waiting'}`}
                                >
                                    {isInRecovery
                                        ? `IN RECOVERY: -${accumulatedLoss.toFixed(2)} ${currency}`
                                        : `BIAS: ${ouAnalysis.bias}`}
                                </span>
                            </div>

                            <div className='ou-splits'>
                                <div className='split-row'>
                                    <div className='split-labels'>
                                        <span>
                                            Under 0-4: {ouAnalysis.under04Pct}% ({ouAnalysis.under04})
                                        </span>
                                        <span>
                                            Over 5-9: {ouAnalysis.over59Pct}% ({ouAnalysis.over59})
                                        </span>
                                    </div>
                                    <div className='split-bar'>
                                        <div className='under-part' style={{ width: `${ouAnalysis.under04Pct}%` }} />
                                        <div className='over-part' style={{ width: `${ouAnalysis.over59Pct}%` }} />
                                    </div>
                                </div>

                                <div className='split-row'>
                                    <div className='split-labels'>
                                        <span>
                                            Under 0-5: {ouAnalysis.under05Pct}% ({ouAnalysis.under05})
                                        </span>
                                        <span>
                                            Over 4-9: {ouAnalysis.over49Pct}% ({ouAnalysis.over49})
                                        </span>
                                    </div>
                                    <div className='split-bar'>
                                        <div className='under-part' style={{ width: `${ouAnalysis.under05Pct}%` }} />
                                        <div className='over-part' style={{ width: `${ouAnalysis.over49Pct}%` }} />
                                    </div>
                                </div>
                            </div>

                            <div className='entry-digits-row'>
                                <div className='entry-digit-card glowing-under'>
                                    <div className='info'>
                                        <span>Under Entry Digit</span>
                                        <span>Highest Under (0-4)</span>
                                    </div>
                                    <div className='val-pill green'>{ouAnalysis.highestUnderEntryDigit}</div>
                                </div>

                                <div className='entry-digit-card glowing-over'>
                                    <div className='info'>
                                        <span>Over Entry Digit</span>
                                        <span>Highest Over (5-9)</span>
                                    </div>
                                    <div className='val-pill amber'>{ouAnalysis.highestOverEntryDigit}</div>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Controls & Configuration Panel */}
                    <div className='auto-x-eo__controls-grid'>
                        <div className='control-field'>
                            <label>Initial Stake</label>
                            <div className='input-box'>
                                <input
                                    type='number'
                                    step='0.1'
                                    value={initialStake}
                                    onChange={e => setInitialStake(e.target.value)}
                                />
                                <span className='unit'>{currency}</span>
                            </div>
                        </div>

                        <div className='control-field'>
                            <label>Take Profit</label>
                            <div className='input-box'>
                                <input
                                    type='number'
                                    step='1'
                                    value={takeProfit}
                                    onChange={e => setTakeProfit(e.target.value)}
                                />
                                <span className='unit'>{currency}</span>
                            </div>
                        </div>

                        <div className='control-field'>
                            <label>Stop Loss</label>
                            <div className='input-box'>
                                <input
                                    type='number'
                                    step='1'
                                    value={stopLoss}
                                    onChange={e => setStopLoss(e.target.value)}
                                />
                                <span className='unit'>{currency}</span>
                            </div>
                        </div>

                        <div className='control-field'>
                            <label>Martingale Multiplier</label>
                            <div className='input-box'>
                                <input
                                    type='number'
                                    step='0.1'
                                    value={martingale}
                                    onChange={e => setMartingale(e.target.value)}
                                />
                                <span className='unit'>x</span>
                            </div>
                        </div>

                        <div className='control-field'>
                            <label>Min Target Probability</label>
                            <div className='input-box'>
                                <input
                                    type='number'
                                    min='50'
                                    max='85'
                                    value={targetProbabilityThreshold}
                                    onChange={e => setTargetProbabilityThreshold(parseInt(e.target.value, 10) || 58)}
                                />
                                <span className='unit'>%</span>
                            </div>
                        </div>

                        <div className='control-field'>
                            <label>Tick Duration</label>
                            <div className='input-box'>
                                <select value={tickDuration} onChange={e => setTickDuration(e.target.value)}>
                                    <option value='1'>1 Tick</option>
                                    <option value='2'>2 Ticks</option>
                                </select>
                            </div>
                        </div>

                        <div className='control-field'>
                            <label>Bulk Purchase Count</label>
                            <div className='input-box'>
                                <input
                                    type='number'
                                    min='1'
                                    max='6'
                                    value={bulkCount}
                                    onChange={e => setBulkCount(e.target.value)}
                                />
                                <span className='unit'>trades</span>
                            </div>
                        </div>

                        <div className='control-field'>
                            <label>Auto Recovery Mode</label>
                            <div className='input-box'>
                                <select
                                    value={autoRecoveryMode ? 'ENABLED' : 'DISABLED'}
                                    onChange={e => setAutoRecoveryMode(e.target.value === 'ENABLED')}
                                >
                                    <option value='ENABLED'>Enabled (2.6x O/U)</option>
                                    <option value='DISABLED'>Disabled (Standard)</option>
                                </select>
                            </div>
                        </div>

                        <div className='control-field'>
                            <label>Recovery Strategy</label>
                            <div className='input-box'>
                                <select value={recoveryType} onChange={e => setRecoveryType(e.target.value as any)}>
                                    <option value='OVER_2_UNDER_8'>Over 2 / Under 8</option>
                                    <option value='OVER_3_UNDER_6'>Over 3 / Under 6</option>
                                </select>
                            </div>
                        </div>

                        <div className='control-field'>
                            <label>Auto-Switch Threshold</label>
                            <div className='input-box'>
                                <input
                                    type='number'
                                    min='3'
                                    max='20'
                                    value={maxRunsBeforeCheck}
                                    onChange={e => setMaxRunsBeforeCheck(parseInt(e.target.value, 10) || 6)}
                                />
                                <span className='unit'>runs</span>
                            </div>
                        </div>
                    </div>

                    {/* Live Trade Logs */}
                    <div className='auto-x-eo__logs-card'>
                        <div className='logs-header'>
                            <h3>Real-Time Trade Stream</h3>
                            <span className='badge-count'>{tradeLog.length} Records</span>
                        </div>

                        <div className='logs-table-wrap'>
                            {tradeLog.length > 0 ? (
                                <table>
                                    <thead>
                                        <tr>
                                            <th>Time</th>
                                            <th>Market</th>
                                            <th>Strategy</th>
                                            <th>Contract</th>
                                            <th>Barrier</th>
                                            <th>Stake</th>
                                            <th>Result</th>
                                            <th>Profit</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {tradeLog.map(item => (
                                            <tr key={item.id}>
                                                <td>{item.time}</td>
                                                <td>{item.market}</td>
                                                <td>{item.strategy}</td>
                                                <td>{item.contractType}</td>
                                                <td>{item.prediction !== undefined ? item.prediction : '-'}</td>
                                                <td>
                                                    {item.stake.toFixed(2)} {currency}
                                                </td>
                                                <td>
                                                    <span className={`badge-${item.result.toLowerCase()}`}>
                                                        {item.result}
                                                    </span>
                                                </td>
                                                <td
                                                    style={{
                                                        color: item.profit >= 0 ? '#10b981' : '#ef4444',
                                                        fontWeight: 700,
                                                    }}
                                                >
                                                    {item.profit !== 0
                                                        ? `${item.profit > 0 ? '+' : ''}${item.profit.toFixed(2)} ${currency}`
                                                        : '-'}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            ) : (
                                <div className='no-logs'>
                                    No trades executed yet. Click &quot;START AUTO TRADER&quot; to begin.
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>
            <TradingMilestoneModal
                isOpen={milestone.isOpen}
                type={milestone.type}
                amount={sessionProfit}
                targetAmount={milestone.type === 'tp' ? parseFloat(takeProfit) || 10 : parseFloat(stopLoss) || 25}
                currency={currency}
                botName='AUTO X E/O Bot'
                winsCount={winsCount}
                lossesCount={lossesCount}
                onClose={() => setMilestone({ isOpen: false, type: null })}
                onRestart={() => {
                    setMilestone({ isOpen: false, type: null });
                    setBotState('SCANNING');
                }}
            />
        </div>
    );
});

export default AutoXEo;
