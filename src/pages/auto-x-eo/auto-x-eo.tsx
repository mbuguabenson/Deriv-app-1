import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { generateOAuthURL, TradingMilestoneModal } from '@/components/shared';
import { api_base, observer as globalObserver } from '@/external/bot-skeleton';
import { useStore } from '@/hooks/useStore';
import { SUPPORTED_VOLATILITY_MARKETS } from '@/utils/digit-strategy';
import { isLoggedIn } from '@/utils/token-bridge';
import { buyContractForUi, streamContractUntilSettled } from '@/utils/trade-purchase';
import { safeSubscribe, subscribeTicks, derivTickManager } from '@/utils/websocket-handler';
import { aiContinuousLearningService } from '@/services/ai-continuous-learning.service';
import { AiLearningHubModal } from '@/components/ai-learning-hub/ai-learning-hub-modal';
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
    tickCount?: number;
    lastTickTime?: number;
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
    strategy: 'EVEN_ODD' | 'RECOVERY_OVER' | 'RECOVERY_UNDER' | 'TAKE_PROFIT' | 'STOP_LOSS' | 'RECOVERY';
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

const extractLastDigit = (quote: number | string | undefined | null, pip = 2): number => {
    if (quote === undefined || quote === null) return 0;
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
    const [autoRecoveryMode, setAutoRecoveryMode] = useState<boolean>(true);
    const [recoveryType] = useState<'OVER_2_UNDER_8' | 'OVER_3_UNDER_6'>('OVER_2_UNDER_8');
    const [targetProbabilityThreshold] = useState<number>(58);

    // ── Bot Running State ──
    const [botState, setBotState] = useState<AutoRunState>('IDLE');
    const [sessionProfit, setSessionProfit] = useState<number>(0);
    const [winsCount, setWinsCount] = useState<number>(0);
    const [lossesCount, setLossesCount] = useState<number>(0);
    const [, setConsecutiveRuns] = useState<number>(0);
    const [isInRecovery, setIsInRecovery] = useState<boolean>(false);
    const [, setAccumulatedLoss] = useState<number>(0);
    const [tradeLog, setTradeLog] = useState<TradeLogItem[]>([]);
    const [milestone, setMilestone] = useState<{ isOpen: boolean; type: 'tp' | 'sl' | null }>({
        isOpen: false,
        type: null,
    });
    const [isAiLearningModalOpen, setIsAiLearningModalOpen] = useState<boolean>(false);

    // ── Synchronized Refs for Non-Stalling Async Engine Loop ──
    const botStateRef = useRef<AutoRunState>('IDLE');
    const autoAbortRef = useRef<AbortController | null>(null);
    const selectedSymbolRef = useRef<string>(selectedSymbol);
    const sessionProfitRef = useRef<number>(0);
    const consecutiveRunsRef = useRef<number>(0);
    const currentStakeRef = useRef<number>(0.5);
    const isInRecoveryRef = useRef<boolean>(false);
    const lastProcessedTicksRef = useRef<Map<string, number>>(new Map());

    useEffect(() => {
        selectedSymbolRef.current = selectedSymbol;
    }, [selectedSymbol]);

    useEffect(() => {
        currentStakeRef.current = currentStake;
    }, [currentStake]);

    useEffect(() => {
        isInRecoveryRef.current = isInRecovery;
    }, [isInRecovery]);

    const setBotStateSync = useCallback((state: AutoRunState) => {
        botStateRef.current = state;
        setBotState(state);
    }, []);

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
                    tickCount: 0,
                    lastTickTime: 0,
                });
            }
        });
    }, []);

    // Throttle UI re-renders
    const lastRenderTime = useRef<number>(0);
    const throttleRender = useCallback(() => {
        const now = Date.now();
        if (now - lastRenderTime.current > 80) {
            lastRenderTime.current = now;
            setRenderTrigger(t => t + 1);
        }
    }, []);

    // ── Safe Manual Market Selection ──
    const handleManualMarketSelect = useCallback(
        (sym: string) => {
            setSelectedSymbol(sym);
            selectedSymbolRef.current = sym;
            lastProcessedTicksRef.current.set(sym, -1);
            throttleRender();
        },
        [throttleRender]
    );

    // ── Manage Subscriptions & Stream Refresh Watchdog ──
    const [streamRefreshKey, setStreamRefreshKey] = useState<number>(0);

    useEffect(() => {
        const handleRefresh = () => {
            subscriptionsRef.current.forEach(sub => {
                try {
                    sub?.unsubscribe?.();
                } catch {
                    /* ignore */
                }
            });
            subscriptionsRef.current.clear();
            derivTickManager.healStalledStreams();
            setStreamRefreshKey(k => k + 1);
        };

        const handleVisibility = () => {
            if (!document.hidden) {
                derivTickManager.healStalledStreams();
                setStreamRefreshKey(k => k + 1);
            }
        };

        window.addEventListener('account_switched', handleRefresh);
        window.addEventListener('online', handleRefresh);
        document.addEventListener('visibilitychange', handleVisibility);
        globalObserver.register('api.authorize', handleRefresh);

        // 3-second watchdog timer to auto-heal stalled streams
        const watchdog = setInterval(() => {
            if (!isMountedRef.current || document.hidden) return;
            const current = marketsDataRef.current.get(selectedSymbolRef.current);
            const now = Date.now();
            if (current && current.lastTickTime && now - current.lastTickTime > 4000) {
                derivTickManager.healStalledStreams();
            }
        }, 3000);

        return () => {
            window.removeEventListener('account_switched', handleRefresh);
            window.removeEventListener('online', handleRefresh);
            document.removeEventListener('visibilitychange', handleVisibility);
            globalObserver.unregister('api.authorize', handleRefresh);
            clearInterval(watchdog);
        };
    }, []);

    // ── Manage Subscriptions for All Synthetic Markets ──
    useEffect(() => {
        isMountedRef.current = true;
        const activeSubs = subscriptionsRef.current;
        const symbolsToStream = scanAllMarkets ? MARKETS.map(m => m.symbol) : [selectedSymbol];

        const subscribeSymbol = async (sym: string) => {
            if (!api_base.api || !isMountedRef.current) return;
            if (activeSubs.has(sym)) return;
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
                        digits.forEach(d => aiContinuousLearningService.ingestMarketTick(sym, d));
                        if (prices.length > 0) {
                            const lastP = prices[prices.length - 1];
                            mData.currentPrice = Number(lastP).toFixed(pip);
                            mData.lastDigit = digits[digits.length - 1];
                            mData.lastTickTime = Date.now();
                        }
                        throttleRender();
                    }
                }

                if (activeSubs.has(sym)) return;

                // Subscribe to real-time live ticks via centralized multiplexer
                const sub = subscribeTicks(sym, (tickRes: Record<string, unknown>) => {
                    if (!isMountedRef.current) return;
                    const tickData = tickRes?.tick as { quote?: number | string; symbol?: string } | undefined;
                    if (tickData?.symbol === sym && tickData?.quote !== undefined) {
                        const quote = Number(tickData.quote);
                        const lastD = extractLastDigit(quote, pip);
                        aiContinuousLearningService.ingestMarketTick(sym, lastD);
                        const item = marketsDataRef.current.get(sym);
                        if (item) {
                            item.currentPrice = quote.toFixed(pip);
                            item.lastDigit = lastD;
                            item.digits = [...item.digits, lastD].slice(-MAX_TICKS_STORED);
                            item.tickCount = (item.tickCount || 0) + 1;
                            item.lastTickTime = Date.now();
                            throttleRender();
                        }
                    }
                });

                activeSubs.set(sym, sub);
            } catch (err) {
                console.error(`AUTO X E/O: Error subscribing to ${sym}:`, err);
            }
        };

        const initAll = async () => {
            if (!api_base.api) {
                setTimeout(initAll, 1000);
                return;
            }
            for (const sym of symbolsToStream) {
                if (!isMountedRef.current) break;
                await subscribeSymbol(sym);
                await new Promise(r => setTimeout(r, 60));
            }
        };

        void initAll();

        return () => {
            // Streams persist across renders
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

        const evenDigitsAbove10_5 = digitStats.filter(s => s.isEven && s.percentage >= 10.5).length;
        const oddDigitsAbove10_5 = digitStats.filter(s => !s.isEven && s.percentage >= 10.5).length;

        const last3Digits = currentMarket.digits.slice(-3);
        const prevTick2 = last3Digits.length >= 3 ? last3Digits[0] : null;
        const prevTick1 = last3Digits.length >= 2 ? last3Digits[last3Digits.length - 2] : null;
        const currentTick = last3Digits.length >= 1 ? last3Digits[last3Digits.length - 1] : null;

        // Pattern 1: [Odd, Odd, Even] -> BUY DIGITEVEN
        const evenPatternTriggered =
            last3Digits.length >= 3 &&
            last3Digits[0] % 2 !== 0 &&
            last3Digits[1] % 2 !== 0 &&
            last3Digits[2] % 2 === 0;

        // Pattern 2: [Even, Even, Odd] -> BUY DIGITODD
        const oddPatternTriggered =
            last3Digits.length >= 3 &&
            last3Digits[0] % 2 === 0 &&
            last3Digits[1] % 2 === 0 &&
            last3Digits[2] % 2 !== 0;

        let activeSignal: 'EVEN' | 'ODD' | 'NONE' = 'NONE';
        if (evenPatternTriggered) {
            activeSignal = 'EVEN';
        } else if (oddPatternTriggered) {
            activeSignal = 'ODD';
        }

        const evenSignalReady = evenPatternTriggered || (evenPct >= targetProbabilityThreshold && isEvenIncreasing);
        const oddSignalReady = oddPatternTriggered || (oddPct >= targetProbabilityThreshold && isOddIncreasing);

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
            prevTick2,
            prevTick1,
            currentTick,
            evenPatternTriggered,
            oddPatternTriggered,
            evenSignalReady,
            oddSignalReady,
            activeSignal,
        };
    }, [currentMarket.digits, digitStats, targetProbabilityThreshold]);

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
            strategy: 'EVEN_ODD' | 'RECOVERY_OVER' | 'RECOVERY_UNDER' | 'TAKE_PROFIT' | 'STOP_LOSS' | 'RECOVERY',
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

                // Record cross-bot learning outcome
                aiContinuousLearningService.recordBotTrade({
                    botName: 'AUTO_EO',
                    strategy: contractType,
                    market,
                    contractType: contractType,
                    barrier: String(barrier ?? ''),
                    prediction: contractType === 'DIGITEVEN' ? 'EVEN' : 'ODD',
                    isWin,
                    profit: profitVal,
                    stake,
                });

                if (isWin) {
                    playSoundCue('win');
                    updateLogResult(logId, 'WIN', profitVal);
                    setWinsCount(w => w + 1);
                    const nextP = Math.round((sessionProfitRef.current + profitVal) * 100) / 100;
                    sessionProfitRef.current = nextP;
                    setSessionProfit(nextP);

                    if (isInRecoveryRef.current) {
                        setIsInRecovery(false);
                        isInRecoveryRef.current = false;
                        setAccumulatedLoss(0);
                        const baseStk = parseFloat(initialStake) || 0.5;
                        currentStakeRef.current = baseStk;
                        setCurrentStake(baseStk);
                    } else {
                        const baseStk = parseFloat(initialStake) || 0.5;
                        currentStakeRef.current = baseStk;
                        setCurrentStake(baseStk);
                    }
                } else {
                    playSoundCue('loss');
                    updateLogResult(logId, 'LOSS', profitVal);
                    setLossesCount(l => l + 1);
                    const nextP = Math.round((sessionProfitRef.current + profitVal) * 100) / 100;
                    sessionProfitRef.current = nextP;
                    setSessionProfit(nextP);

                    if (autoRecoveryMode) {
                        setIsInRecovery(true);
                        isInRecoveryRef.current = true;
                        const martMult = parseFloat(martingale) || 2.6;
                        const nextStake = Math.round(stake * martMult * 100) / 100;
                        currentStakeRef.current = nextStake;
                        setCurrentStake(nextStake);
                        setAccumulatedLoss(prev => prev + Math.abs(profitVal));
                    } else {
                        const martMult = parseFloat(martingale) || 2.0;
                        const nextStake = Math.round(stake * martMult * 100) / 100;
                        currentStakeRef.current = nextStake;
                        setCurrentStake(nextStake);
                    }
                }

                consecutiveRunsRef.current += 1;
                setConsecutiveRuns(consecutiveRunsRef.current);
                return profitVal;
            } catch (err: any) {
                console.error('AUTO X E/O Trade execution failed:', err);
                updateLogResult(logId, 'LOSS', -stake);
                return -stake;
            } finally {
                executionLockRef.current = false;
            }
        },
        [
            addLogEntry,
            updateLogResult,
            tickDuration,
            currency,
            pushContractToDrawer,
            initialStake,
            autoRecoveryMode,
            martingale,
        ]
    );

    // ── Dedicated Asynchronous Trading Engine Loop (Zero-Freeze) ──
    const startAutoTradingLoop = useCallback(async () => {
        autoAbortRef.current?.abort();
        const abortCtrl = new AbortController();
        autoAbortRef.current = abortCtrl;
        const signal = abortCtrl.signal;

        const tpVal = parseFloat(takeProfit) || 10;
        const slVal = parseFloat(stopLoss) || 25;

        setBotStateSync('SCANNING');
        let scanningCycles = 0;

        const loop = async () => {
            while (!signal.aborted && botStateRef.current !== 'IDLE') {
                if (botStateRef.current === 'PAUSED') {
                    await new Promise(r => setTimeout(r, 400));
                    continue;
                }

                let targetSym = selectedSymbolRef.current;

                // Check TP / SL Limits
                if (sessionProfitRef.current >= tpVal && tpVal > 0) {
                    setBotStateSync('IDLE');
                    addLogEntry(targetSym, 'TAKE_PROFIT', 'DOLLARS_PRINTED 💵💸', undefined, 0, 'WIN', sessionProfitRef.current);
                    setMilestone({ isOpen: true, type: 'tp' });
                    break;
                }
                if (sessionProfitRef.current <= -slVal && slVal > 0) {
                    setBotStateSync('IDLE');
                    addLogEntry(targetSym, 'STOP_LOSS', 'CAPITAL_PROTECTED 🛡️', undefined, 0, 'LOSS', sessionProfitRef.current);
                    setMilestone({ isOpen: true, type: 'sl' });
                    break;
                }

                // Market Auto-Switch Check after max consecutive runs
                if (autoSwitchMarkets && consecutiveRunsRef.current >= maxRunsBeforeCheck) {
                    consecutiveRunsRef.current = 0;
                    setConsecutiveRuns(0);
                    if (bestMarketCandidate && bestMarketCandidate !== targetSym) {
                        targetSym = bestMarketCandidate;
                        selectedSymbolRef.current = targetSym;
                        setSelectedSymbol(targetSym);
                        lastProcessedTicksRef.current.set(targetSym, -1);
                        await new Promise(r => setTimeout(r, 200));
                    }
                }

                const mData = marketsDataRef.current.get(targetSym);
                if (!mData || mData.digits.length < 15) {
                    if (botStateRef.current !== 'SCANNING') setBotStateSync('SCANNING');
                    await new Promise(r => setTimeout(r, 300));
                    continue;
                }

                const digits = mData.digits;
                const lastDigit = mData.lastDigit;
                const currTickCount = mData.tickCount || 0;
                const lastProcessed = lastProcessedTicksRef.current.get(targetSym) ?? -1;

                // Independent per-symbol fresh tick gate
                if (lastProcessed !== -1 && currTickCount <= lastProcessed) {
                    await new Promise(r => setTimeout(r, 40));
                    continue;
                }
                lastProcessedTicksRef.current.set(targetSym, currTickCount);

                // 1. Recovery Mode Branch
                if (isInRecoveryRef.current) {
                    const last50 = digits.slice(-50);
                    const under05 = last50.filter(d => d <= 5).length;
                    const over49 = last50.filter(d => d >= 4).length;
                    const isUnderFavored = under05 >= over49;

                    const barrier = isUnderFavored
                        ? (recoveryType === 'OVER_2_UNDER_8' ? 8 : 6)
                        : (recoveryType === 'OVER_2_UNDER_8' ? 2 : 3);
                    const contractType = isUnderFavored ? 'DIGITUNDER' : 'DIGITOVER';
                    const strategyType = isUnderFavored ? 'RECOVERY_UNDER' : 'RECOVERY_OVER';

                    const isTrigger = isUnderFavored
                        ? lastDigit <= (barrier === 8 ? 6 : 4)
                        : lastDigit >= (barrier === 2 ? 3 : 5);

                    if (isTrigger) {
                        setBotStateSync('TRADING');
                        scanningCycles = 0;
                        try {
                            await executeTradeOrder(targetSym, strategyType, contractType, barrier, currentStakeRef.current);
                        } catch (e) {
                            console.error('Auto X Recovery trade error:', e);
                        }
                        if (botStateRef.current !== 'IDLE' && botStateRef.current !== 'PAUSED') {
                            setBotStateSync('SCANNING');
                        }
                        await new Promise(r => setTimeout(r, 500));
                    } else {
                        scanningCycles++;
                        if (botStateRef.current !== 'WAITING_TRIGGER') setBotStateSync('WAITING_TRIGGER');
                        await new Promise(r => setTimeout(r, 40));
                    }
                    continue;
                }

                // 2. Base Even / Odd Strategy Branch (100% Verified Logic)
                const last3 = digits.slice(-3);
                const recent60 = digits.slice(-60);
                const total60 = recent60.length || 1;
                const evenCount = recent60.filter(d => d % 2 === 0).length;
                const oddCount = recent60.filter(d => d % 2 !== 0).length;
                const evenPct = Math.round((evenCount / total60) * 100);
                const oddPct = Math.round((oddCount / total60) * 100);

                const last15 = digits.slice(-15);
                const prev15 = digits.slice(-30, -15);
                const isEvenIncreasing = last15.filter(d => d % 2 === 0).length >= prev15.filter(d => d % 2 === 0).length;
                const isOddIncreasing = last15.filter(d => d % 2 !== 0).length >= prev15.filter(d => d % 2 !== 0).length;

                // Reversal Triggers: 2 consecutive Odds -> Buy Even; 2 consecutive Evens -> Buy Odd
                const isTwoOdds =
                    last3.length >= 2 &&
                    last3[last3.length - 2] % 2 !== 0 &&
                    last3[last3.length - 1] % 2 !== 0;
                const isTwoEvens =
                    last3.length >= 2 &&
                    last3[last3.length - 2] % 2 === 0 &&
                    last3[last3.length - 1] % 2 === 0;

                // Momentum Triggers: Probability >= threshold and increasing trend
                const isEvenMomentum = evenPct >= targetProbabilityThreshold && isEvenIncreasing && lastDigit % 2 === 0;
                const isOddMomentum = oddPct >= targetProbabilityThreshold && isOddIncreasing && lastDigit % 2 !== 0;

                if (isTwoOdds || isEvenMomentum) {
                    setBotStateSync('TRADING');
                    scanningCycles = 0;
                    try {
                        await executeTradeOrder(targetSym, 'EVEN_ODD', 'DIGITEVEN', undefined, currentStakeRef.current);
                    } catch (e) {
                        console.error('Auto X Even trade error:', e);
                    }
                    if (botStateRef.current !== 'IDLE' && botStateRef.current !== 'PAUSED') {
                        setBotStateSync('SCANNING');
                    }
                    await new Promise(r => setTimeout(r, 500));
                } else if (isTwoEvens || isOddMomentum) {
                    setBotStateSync('TRADING');
                    scanningCycles = 0;
                    try {
                        await executeTradeOrder(targetSym, 'EVEN_ODD', 'DIGITODD', undefined, currentStakeRef.current);
                    } catch (e) {
                        console.error('Auto X Odd trade error:', e);
                    }
                    if (botStateRef.current !== 'IDLE' && botStateRef.current !== 'PAUSED') {
                        setBotStateSync('SCANNING');
                    }
                    await new Promise(r => setTimeout(r, 500));
                } else {
                    scanningCycles++;
                    if (last3.length >= 1 && (lastDigit % 2 !== 0 ? isTwoOdds : isTwoEvens)) {
                        if (botStateRef.current !== 'WAITING_TRIGGER') setBotStateSync('WAITING_TRIGGER');
                    } else {
                        if (botStateRef.current !== 'SCANNING') setBotStateSync('SCANNING');
                    }

                    // Rotate to candidate if current market shows no pattern for >= 10 cycles
                    if (autoSwitchMarkets && scanningCycles >= 10 && bestMarketCandidate && bestMarketCandidate !== targetSym) {
                        targetSym = bestMarketCandidate;
                        selectedSymbolRef.current = targetSym;
                        setSelectedSymbol(targetSym);
                        scanningCycles = 0;
                        lastProcessedTicksRef.current.set(targetSym, -1);
                        await new Promise(r => setTimeout(r, 200));
                        continue;
                    }

                    await new Promise(r => setTimeout(r, 40));
                }
            }
        };

        void loop();
    }, [
        takeProfit,
        stopLoss,
        autoSwitchMarkets,
        maxRunsBeforeCheck,
        bestMarketCandidate,
        recoveryType,
        targetProbabilityThreshold,
        setBotStateSync,
        executeTradeOrder,
        addLogEntry,
    ]);

    // ── Bot Start / Pause / Stop Handlers ──
    const handleStartBot = useCallback(async () => {
        const logged_in = Boolean(client?.is_logged_in || isLoggedIn() || api_base.is_authorized);
        if (!logged_in) {
            const oauthUrl = await generateOAuthURL();
            if (oauthUrl) window.location.href = oauthUrl;
            return;
        }

        const baseStk = parseFloat(initialStake) || 0.5;
        currentStakeRef.current = baseStk;
        setCurrentStake(baseStk);
        sessionProfitRef.current = 0;
        setSessionProfit(0);
        setWinsCount(0);
        setLossesCount(0);
        consecutiveRunsRef.current = 0;
        setConsecutiveRuns(0);
        isInRecoveryRef.current = false;
        setIsInRecovery(false);
        setAccumulatedLoss(0);
        lastProcessedTicksRef.current.clear();
        setBotStateSync('SCANNING');
        void startAutoTradingLoop();
    }, [client?.is_logged_in, initialStake, setBotStateSync, startAutoTradingLoop]);

    const handlePauseBot = useCallback(() => {
        if (botStateRef.current === 'PAUSED') {
            setBotStateSync('SCANNING');
        } else if (botStateRef.current !== 'IDLE') {
            setBotStateSync('PAUSED');
        }
    }, [setBotStateSync]);

    const handleStopBot = useCallback(() => {
        setBotStateSync('IDLE');
        autoAbortRef.current?.abort();
        executionLockRef.current = false;
    }, [setBotStateSync]);

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
            const customEvent = e as CustomEvent<{ tab: string; action?: string }>;
            if (customEvent.detail?.tab === 'auto_x_eo') {
                const action = customEvent.detail.action;
                if (action === 'start') {
                    if (botStateRef.current === 'IDLE') {
                        handleStartBot();
                    }
                } else if (action === 'stop') {
                    if (botStateRef.current !== 'IDLE') {
                        handleStopBot();
                    }
                } else if (botStateRef.current === 'IDLE') {
                    handleStartBot();
                } else {
                    handleStopBot();
                }
            }
        };
        const handleGlobalStop = () => {
            if (botStateRef.current !== 'IDLE') {
                handleStopBot();
            }
        };

        window.addEventListener('PH_TRIGGER_ENGINE_ACTION', handleTrigger);
        globalObserver.register('bot.manual_stop', handleGlobalStop);
        return () => {
            window.removeEventListener('PH_TRIGGER_ENGINE_ACTION', handleTrigger);
            globalObserver.unregister('bot.manual_stop', handleGlobalStop);
        };
    }, [handleStartBot, handleStopBot]);

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
                    <button
                        className='btn-ai-lab'
                        onClick={() => setIsAiLearningModalOpen(true)}
                        title='Open Multi-Bot Continuous Neural Learning Lab & 24/7 Machine Mode'
                        type='button'
                    >
                        <Zap size={15} /> AI Learning Lab
                    </button>
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
                        onChange={e => handleManualMarketSelect(e.target.value)}
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
                                        handleManualMarketSelect(m.symbol);
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
                                    onClick={() => handleManualMarketSelect(m.symbol)}
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
                                    className={`digit-cell ${stat.isEven ? 'is-even' : 'is-odd'} ${isTarget ? 'is-target' : ''}`}
                                >
                                    <div className='digit-cell__top'>
                                        <span className='digit-number'>{stat.digit}</span>
                                        <span className='digit-rank'>#{stat.rank}</span>
                                    </div>
                                    <div className='digit-cell__pct'>{stat.percentage}%</div>
                                    <div className='digit-cell__bar-bg'>
                                        <div className='digit-cell__bar-fill' style={{ width: `${stat.power}%` }} />
                                    </div>
                                </div>
                            );
                        })}
                    </div>

                    {/* 3-Tick Real-Time Momentum Stream & Strategy Triggers HUD */}
                    <div className='auto-x-eo__stream-hud'>
                        <div className='hud-box stream-box'>
                            <h3>
                                <Activity size={16} /> 3-Tick Parity Confirmation
                            </h3>
                            <div className='tick-chain'>
                                <div className='tick-node'>
                                    <span className='node-label'>Tick -2</span>
                                    <div className={`node-val ${eoAnalysis.prevTick2 !== null && eoAnalysis.prevTick2 % 2 === 0 ? 'even' : 'odd'}`}>
                                        {eoAnalysis.prevTick2 ?? '—'}
                                    </div>
                                </div>
                                <span className='arrow'>→</span>
                                <div className='tick-node'>
                                    <span className='node-label'>Tick -1</span>
                                    <div className={`node-val ${eoAnalysis.prevTick1 !== null && eoAnalysis.prevTick1 % 2 === 0 ? 'even' : 'odd'}`}>
                                        {eoAnalysis.prevTick1 ?? '—'}
                                    </div>
                                </div>
                                <span className='arrow'>→</span>
                                <div className='tick-node live'>
                                    <span className='node-label'>Current</span>
                                    <div className={`node-val ${eoAnalysis.currentTick !== null && eoAnalysis.currentTick % 2 === 0 ? 'even' : 'odd'}`}>
                                        {eoAnalysis.currentTick ?? '—'}
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div className='hud-box pattern-box'>
                            <h3>
                                <Gauge size={16} /> Parity Bias &amp; Momentum
                            </h3>
                            <div className='parity-ratio-display'>
                                <div className='ratio-side even-side'>
                                    <span>EVEN</span>
                                    <strong>{eoAnalysis.evenPct}%</strong>
                                </div>
                                <div className='ratio-bar-wrap'>
                                    <div className='even-fill' style={{ width: `${eoAnalysis.evenPct}%` }} />
                                    <div className='odd-fill' style={{ width: `${eoAnalysis.oddPct}%` }} />
                                </div>
                                <div className='ratio-side odd-side'>
                                    <span>ODD</span>
                                    <strong>{eoAnalysis.oddPct}%</strong>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Parameter Configuration & Strategy Matrix */}
                    <div className='auto-x-eo__config-grid'>
                        <div className='config-card'>
                            <h3>
                                <Shield size={16} /> Strategy Parameters
                            </h3>
                            <div className='inputs-row'>
                                <div className='input-field'>
                                    <label>Stake ({currency})</label>
                                    <input
                                        type='number'
                                        step='0.1'
                                        min='0.35'
                                        value={initialStake}
                                        onChange={e => setInitialStake(e.target.value)}
                                        disabled={botState !== 'IDLE'}
                                    />
                                </div>
                                <div className='input-field'>
                                    <label>Martingale</label>
                                    <input
                                        type='number'
                                        step='0.1'
                                        value={martingale}
                                        onChange={e => setMartingale(e.target.value)}
                                        disabled={botState !== 'IDLE'}
                                    />
                                </div>
                                <div className='input-field'>
                                    <label>Take Profit ({currency})</label>
                                    <input
                                        type='number'
                                        value={takeProfit}
                                        onChange={e => setTakeProfit(e.target.value)}
                                        disabled={botState !== 'IDLE'}
                                    />
                                </div>
                                <div className='input-field'>
                                    <label>Stop Loss ({currency})</label>
                                    <input
                                        type='number'
                                        value={stopLoss}
                                        onChange={e => setStopLoss(e.target.value)}
                                        disabled={botState !== 'IDLE'}
                                    />
                                </div>
                                <div className='input-field'>
                                    <label>Duration</label>
                                    <select
                                        value={tickDuration}
                                        onChange={e => setTickDuration(e.target.value)}
                                        disabled={botState !== 'IDLE'}
                                    >
                                        <option value='1'>1 Tick</option>
                                        <option value='2'>2 Ticks</option>
                                    </select>
                                </div>
                            </div>
                        </div>

                        {/* Live Execution Logs */}
                        <div className='config-card logs-card'>
                            <div className='logs-header'>
                                <h3>
                                    <Activity size={16} /> Live Trade Execution Log
                                </h3>
                                {tradeLog.length > 0 && (
                                    <button className='btn-clear' onClick={() => setTradeLog([])}>
                                        Clear
                                    </button>
                                )}
                            </div>

                            <div className='logs-scroll'>
                                {tradeLog.length === 0 ? (
                                    <div className='empty-logs'>Awaiting trade triggers...</div>
                                ) : (
                                    tradeLog.map(item => (
                                        <div key={item.id} className={`log-row log-${item.result.toLowerCase()}`}>
                                            <span className='time'>{item.time}</span>
                                            <span className='market'>{item.market}</span>
                                            <span className='type'>{item.contractType}</span>
                                            <span className='stake'>${item.stake.toFixed(2)}</span>
                                            <span className={`profit ${item.profit >= 0 ? 'pos' : 'neg'}`}>
                                                {item.profit >= 0 ? `+$${item.profit.toFixed(2)}` : `-$${Math.abs(item.profit).toFixed(2)}`}
                                            </span>
                                            <span className='badge-res'>{item.result}</span>
                                        </div>
                                    ))
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <TradingMilestoneModal
                isOpen={milestone.isOpen}
                type={milestone.type}
                amount={sessionProfit}
                currency={currency}
                botName='Auto X E/O'
                onClose={() => setMilestone({ isOpen: false, type: null })}
            />

            <AiLearningHubModal
                isOpen={isAiLearningModalOpen}
                onClose={() => setIsAiLearningModalOpen(false)}
            />
        </div>
    );
});

export default AutoXEo;
