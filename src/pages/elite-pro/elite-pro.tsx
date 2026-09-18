import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { generateOAuthURL, TradingMilestoneModal } from '@/components/shared';
import { api_base } from '@/external/bot-skeleton';
import { observer as globalObserver } from '@/external/bot-skeleton/utils/observer';
import { useStore } from '@/hooks/useStore';
import { isLoggedIn } from '@/utils/token-bridge';
import { buyContractForUi, streamContractUntilSettled } from '@/utils/trade-purchase';
import { subscribeTicks, derivTickManager } from '@/utils/websocket-handler';
import { aiContinuousLearningService } from '@/services/ai-continuous-learning.service';
import { AiLearningHubModal } from '@/components/ai-learning-hub/ai-learning-hub-modal';
import {
    Activity,
    AlertTriangle,
    CheckCircle2,
    Info,
    LayoutGrid,
    Pause,
    Play,
    RefreshCw,
    RotateCcw,
    ShieldCheck,
    Square,
    Target,
} from 'lucide-react';
import './elite-pro.scss';

// ─── Types ─────────────────────────────────────────────────────────────────────

export type MarketDigitData = {
    symbol: string;
    label: string;
    digits: number[];
    currentPrice: string;
    lastDigit: number;
    tickCount: number;
    lastTickTime: number;
    cycleTicks: number; // Rolling ticks counter for 15-tick cycle evaluation
};

export type Macro1000Analysis = {
    total1000: number;
    freq1000: number[];
    pct1000: number[];
    most1000: number;
    second1000: number;
    least1000: number;
    outlier7Pct: number;
    outlier8Pct: number;
    outlier9Pct: number;
    outlier0Pct: number;
    outlier1Pct: number;
    outlier2Pct: number;
    outlier7Increasing: boolean;
    outlier8Increasing: boolean;
    outlier9Increasing: boolean;
    outlier0Increasing: boolean;
    outlier1Increasing: boolean;
    outlier2Increasing: boolean;
    outliersUnder6Safe: boolean;
    outliersOver3Safe: boolean;
    macroUnder6Dominant: boolean;
    macroOver3Dominant: boolean;
};

export type Mid50Analysis = {
    under04: number;
    over59: number;
    pctUnder04: number;
    pctOver59: number;
    under05: number;
    over49: number;
    pctUnder05: number;
    pctOver49: number;
    underIncreasing: boolean;
    overIncreasing: boolean;
    under04Increasing: boolean;
    over59Increasing: boolean;
    under05Increasing: boolean;
    over49Increasing: boolean;
    highestUnderDigit: number;
    highestUnderCount: number;
    highestUnderPct: number;
    highestOverDigit: number;
    highestOverCount: number;
    highestOverPct: number;
    freq50: number[];
};

export type Cycle15Analysis = {
    cycleUnder05: number;
    cycleOver49: number;
    pctCycleUnder05: number;
    pctCycleOver49: number;
    isRegimeShiftUnder: boolean;
    isRegimeShiftOver: boolean;
    stabilityStatus: 'STABLE_UNDER' | 'STABLE_OVER' | 'SHIFTING' | 'NEUTRAL';
};

export type MicroAnalysis = {
    last10UnderCount: number;
    last10OverCount: number;
    last7UnderCount: number;
    last7OverCount: number;
};

export type MarketConditionAssessment = {
    status: 'GOOD' | 'ANALYZING' | 'NOT_GOOD';
    isGood: boolean;
    isNotGood: boolean;
    alertTitle: string;
    alertMessage: string;
    alertSeverity: 'danger' | 'warning' | 'success' | 'info';
    unbalancedDigits: boolean;
    unbalancedDigitsReason?: string;
    unidentifiedPattern: boolean;
    unidentifiedPatternReason?: string;
    conditionsNotMet: boolean;
    conditionsNotMetReason?: string;
    reasons: string[];
    marketHealthScore: number;
};

export type ComprehensiveMarketAnalysis = {
    macro: Macro1000Analysis;
    mid: Mid50Analysis;
    cycle: Cycle15Analysis;
    micro: MicroAnalysis;
    bias: 'under' | 'over' | 'shifting' | 'neutral';
    qualityScore: number;
    totalTicks: number;
    isAvoidMarket: boolean;
    condition: MarketConditionAssessment;
};

export type EntrySignalResult = {
    direction: 'UNDER' | 'OVER';
    prediction: number;
    triggerDigit: number;
    reason: string;
    status: 'WAITING' | 'TRIGGERED';
    isAutoPaused: boolean;
    pauseReason?: string;
    qualityScore: number;
    conditions: {
        macroCondition: boolean;
        stat1Condition: boolean;
        stat2Condition: boolean;
        micro10Condition: boolean;
        cycleCondition: boolean;
        triggerDigitCondition: boolean;
        midCondition?: boolean;
        micro7Condition?: boolean;
    };
};

export type TradeLogEntry = {
    id: string;
    time: string;
    type: string;
    market: string;
    result: 'WIN' | 'LOSS' | 'PENDING' | 'ABORTED';
    profit: number;
    contractId?: number;
    details?: string;
};

export type AutoState = 'IDLE' | 'SCANNING' | 'WAITING_TRIGGER' | 'TRADING' | 'PAUSED';

// ─── Universally Valid Deriv Volatility Synthetic Markets ───────────────────────

const MARKETS = [
    { symbol: 'R_10', label: 'Vol 10' },
    { symbol: 'R_25', label: 'Vol 25' },
    { symbol: 'R_50', label: 'Vol 50' },
    { symbol: 'R_75', label: 'Vol 75' },
    { symbol: 'R_100', label: 'Vol 100' },
    { symbol: '1HZ10V', label: 'Vol 10 (1s)' },
    { symbol: '1HZ25V', label: 'Vol 25 (1s)' },
    { symbol: '1HZ50V', label: 'Vol 50 (1s)' },
    { symbol: '1HZ75V', label: 'Vol 75 (1s)' },
    { symbol: '1HZ100V', label: 'Vol 100 (1s)' },
];

const MAX_DIGITS_BUFFER = 1000;
const CHART_DIGITS = 50;

// ─── Helpers ───────────────────────────────────────────────────────────────────

const extractDigitFromPrice = (quote: number | string | undefined | null): number => {
    if (quote === undefined || quote === null) return 0;
    const s = typeof quote === 'number' ? quote.toFixed(6).replace(/\.?0+$/, '') : String(quote).trim();
    if (!s) return 0;
    const parts = s.split('.');
    if (parts.length > 1 && parts[1].length > 0) {
        return parseInt(parts[1].slice(-1), 10) || 0;
    }
    return parseInt(parts[0].slice(-1), 10) || 0;
};

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

const createInitialMarketsMap = (): Map<string, MarketDigitData> => {
    const map = new Map<string, MarketDigitData>();
    MARKETS.forEach(m => {
        map.set(m.symbol, {
            symbol: m.symbol,
            label: m.label,
            digits: [],
            currentPrice: '—',
            lastDigit: 0,
            tickCount: 0,
            lastTickTime: 0,
            cycleTicks: 0,
        });
    });
    return map;
};

// ─── SVG Spline Line Chart (50 Last Digits) ────────────────────────────────────

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
                                x1={0}
                                y1={y}
                                x2={W}
                                y2={y}
                                stroke={level === 3 || level === 6 ? 'rgba(139, 92, 246, 0.35)' : 'rgba(255, 255, 255, 0.08)'}
                                strokeDasharray={level === 3 || level === 6 ? '4,4' : '2,2'}
                            />
                            <text
                                x={8}
                                y={y - 3}
                                fill={level === 3 || level === 6 ? '#c084fc' : '#64748b'}
                                fontSize='9'
                                fontWeight='700'
                            >
                                {level === 6 ? 'Under 6 Barrier (6)' : level === 3 ? 'Over 3 Barrier (3)' : `Level ${level}`}
                            </text>
                        </g>
                    );
                })}

                {/* Spline Area Fill */}
                <path
                    d={`${pathD} L ${points[points.length - 1].x},${H} L ${points[0].x},${H} Z`}
                    fill='url(#epLineGrad)'
                    opacity={0.12}
                />

                {/* Spline Curve Line */}
                <path
                    d={pathD}
                    fill='none'
                    stroke='url(#epLineGrad)'
                    strokeWidth='2.8'
                    strokeLinecap='round'
                    strokeLinejoin='round'
                    filter='url(#epGlow)'
                />

                {/* Digit Markers & Labels */}
                {points.map((p, idx) => {
                    const isLast = idx === points.length - 1;
                    const isUnder = p.d <= 5;
                    return (
                        <g key={idx}>
                            <circle
                                cx={p.x}
                                cy={p.y}
                                r={isLast ? 6.5 : 3.5}
                                fill={isLast ? (isUnder ? '#38bdf8' : '#f97316') : isUnder ? '#818cf8' : '#fb923c'}
                                stroke='#0f172a'
                                strokeWidth='1.5'
                            />
                            {isLast && (
                                <circle
                                    cx={p.x}
                                    cy={p.y}
                                    r={10}
                                    fill='none'
                                    stroke={isUnder ? '#38bdf8' : '#f97316'}
                                    strokeWidth='1.5'
                                    opacity='0.7'
                                    className='ep-pulsing-circle'
                                />
                            )}
                            <text
                                x={p.x}
                                y={p.y - (isLast ? 9 : 7)}
                                textAnchor='middle'
                                fill={isLast ? '#ffffff' : isUnder ? '#93c5fd' : '#fdba74'}
                                fontSize={isLast ? '11' : '8.5'}
                                fontWeight={isLast ? '800' : '600'}
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

// ─── Main Elite Pro Component ──────────────────────────────────────────────────

const ElitePro: React.FC = observer(() => {
    const store = useStore();
    const { run_panel, summary_card, transactions, client } = store;
    const currency = client?.currency || 'USD';
    const logged_in = Boolean(client?.is_logged_in || isLoggedIn() || api_base.is_authorized);

    // ── UI States ──
    const [selectedSymbol, setSelectedSymbol] = useState('R_100');
    const [scanAll, setScanAll] = useState(true);
    const [showWideView, setShowWideView] = useState(false);
    const [autoInputBestMarket, setAutoInputBestMarket] = useState(true);
    const [autoSwitchMarkets, setAutoSwitchMarkets] = useState(true);
    const [marketsSideExpanded, setMarketsSideExpanded] = useState(true);
    const [isAiLearningHubOpen, setIsAiLearningHubOpen] = useState(false);

    // ── Strategy Configuration & Inputs ──
    const [stake, setStake] = useState('0.50');
    const [takeProfit, setTakeProfit] = useState('10.00');
    const [stopLoss, setStopLoss] = useState('25.00');
    const [martingale, setMartingale] = useState('2.6');
    const [tickDuration, setTickDuration] = useState('1');

    // ── Bot Running State ──
    const [autoState, setAutoState] = useState<AutoState>('IDLE');
    const [tradeLog, setTradeLog] = useState<TradeLogEntry[]>([]);
    const [totalProfit, setTotalProfit] = useState(0);
    const [wins, setWins] = useState(0);
    const [losses, setLosses] = useState(0);
    const [milestone, setMilestone] = useState<{ isOpen: boolean; type: 'tp' | 'sl' | null }>({
        isOpen: false,
        type: null,
    });

    // ── Strategy Direction Control ──
    const targetStrategyRef = useRef<'UNDER_6' | 'OVER_3' | 'AUTO'>('AUTO');
    const [activeTargetStrategy, setActiveTargetStrategy] = useState<'UNDER_6' | 'OVER_3' | 'AUTO'>('AUTO');

    // ── Synchronized References for Stable Asynchronous Loops ──
    const currentStakeRef = useRef(0.50);
    const autoAbortRef = useRef<AbortController | null>(null);
    const autoStateRef = useRef<AutoState>('IDLE');
    const contractStreamAbortRef = useRef<Set<AbortController>>(new Set());
    const selectedSymbolRef = useRef(selectedSymbol);

    const totalProfitRef = useRef(0);
    const winsRef = useRef(0);
    const lossesRef = useRef(0);
    const consecutiveLossesRef = useRef(0);

    const marketsRef = useRef<Map<string, MarketDigitData>>(createInitialMarketsMap());
    const subscriptionsRef = useRef<Map<string, { unsubscribe: () => void }>>(new Map());
    const historyFetchedSymbolsRef = useRef<Set<string>>(new Set());
    const unmountedRef = useRef(false);
    const uiThrottleRef = useRef<number>(0);
    const throttleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const [, forceRender] = useState(0);

    // Sync refs
    useEffect(() => {
        selectedSymbolRef.current = selectedSymbol;
    }, [selectedSymbol]);
    useEffect(() => {
        autoStateRef.current = autoState;
    }, [autoState]);
    useEffect(() => {
        currentStakeRef.current = parseFloat(stake) || 0.50;
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

    // ── Throttle UI re-renders ──
    const throttleRender = useCallback(() => {
        const now = Date.now();
        const elapsed = now - uiThrottleRef.current;
        if (elapsed >= 70) {
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
            }, 70 - elapsed);
        }
    }, []);

    // ── Systematic Multi-Horizon Statistical Analyzer ──
    // Evaluates Macro 1000-tick (~30m-1hr), Mid 50-tick, 15-tick cycle, and Micro 10/7 tick windows
    const computeAnalysis = useCallback((digits: number[]): ComprehensiveMarketAnalysis => {
        const totalTicks = digits.length;

        // 1. MACRO 1000-TICK ANALYSIS (~30 min to 1 hr history)
        const slice1000 = digits.slice(-1000);
        const total1000 = slice1000.length || 1;
        const freq1000 = new Array(10).fill(0);
        slice1000.forEach(d => {
            if (d >= 0 && d <= 9) freq1000[d]++;
        });
        const pct1000 = freq1000.map(c => (c / total1000) * 100);

        const sortedDigits1000 = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].sort((a, b) => freq1000[b] - freq1000[a]);
        const most1000 = sortedDigits1000[0];
        const second1000 = sortedDigits1000[1];
        const least1000 = sortedDigits1000[9];

        // Macro Trend & Outlier Momentum (First Half vs Second Half of 1000 ticks)
        const halfLen = Math.floor(total1000 / 2) || 1;
        const half1 = slice1000.slice(0, halfLen);
        const half2 = slice1000.slice(halfLen);

        const getHalfPct = (half: number[], digit: number) => {
            const count = half.filter(d => d === digit).length;
            return (count / (half.length || 1)) * 100;
        };

        const outlier7Pct = pct1000[7] || 0;
        const outlier8Pct = pct1000[8] || 0;
        const outlier9Pct = pct1000[9] || 0;
        const outlier0Pct = pct1000[0] || 0;
        const outlier1Pct = pct1000[1] || 0;
        const outlier2Pct = pct1000[2] || 0;

        const outlier7Increasing = getHalfPct(half2, 7) > getHalfPct(half1, 7) + 0.5;
        const outlier8Increasing = getHalfPct(half2, 8) > getHalfPct(half1, 8) + 0.5;
        const outlier9Increasing = getHalfPct(half2, 9) > getHalfPct(half1, 9) + 0.5;
        const outlier0Increasing = getHalfPct(half2, 0) > getHalfPct(half1, 0) + 0.5;
        const outlier1Increasing = getHalfPct(half2, 1) > getHalfPct(half1, 1) + 0.5;
        const outlier2Increasing = getHalfPct(half2, 2) > getHalfPct(half1, 2) + 0.5;

        // Outlier Safety Checks: Outliers must be < 10% each and NOT increasing
        const outliersUnder6Safe =
            outlier7Pct < 10.0 &&
            outlier8Pct < 10.0 &&
            outlier9Pct < 10.0 &&
            !outlier7Increasing &&
            !outlier8Increasing &&
            !outlier9Increasing;

        const outliersOver3Safe =
            outlier0Pct < 10.0 &&
            outlier1Pct < 10.0 &&
            outlier2Pct < 10.0 &&
            !outlier0Increasing &&
            !outlier1Increasing &&
            !outlier2Increasing;

        // Macro Dominance: Top 2 digits and least appearing digit must align in the target zone (<6 or >3)
        const macroUnder6Dominant = (most1000 <= 5 && second1000 <= 5 && least1000 <= 5) || (outliersUnder6Safe && pct1000.slice(0, 6).reduce((a, b) => a + b, 0) >= 58);
        const macroOver3Dominant = (most1000 >= 4 && second1000 >= 4 && least1000 >= 4) || (outliersOver3Safe && pct1000.slice(4, 10).reduce((a, b) => a + b, 0) >= 58);

        // 2. MID 50-TICK ANALYSIS
        const slice50 = digits.slice(-50);
        const total50 = slice50.length || 1;

        const under04 = slice50.filter(d => d >= 0 && d <= 4).length;
        const over59 = slice50.filter(d => d >= 5 && d <= 9).length;
        const pctUnder04 = (under04 / total50) * 100;
        const pctOver59 = (over59 / total50) * 100;

        const under05 = slice50.filter(d => d >= 0 && d <= 5).length;
        const over49 = slice50.filter(d => d >= 4 && d <= 9).length;
        const pctUnder05 = (under05 / total50) * 100;
        const pctOver49 = (over49 / total50) * 100;

        // Momentum: 1st 25 vs 2nd 25 of 50 ticks
        const firstHalf50 = slice50.slice(0, Math.floor(total50 / 2));
        const secondHalf50 = slice50.slice(Math.floor(total50 / 2));

        // Statistical Analysis 1 Momentum: Under (0-4) vs Over (5-9)
        const firstHalfUnder04Pct = firstHalf50.filter(d => d <= 4).length / (firstHalf50.length || 1);
        const secondHalfUnder04Pct = secondHalf50.filter(d => d <= 4).length / (secondHalf50.length || 1);
        const under04Increasing = secondHalfUnder04Pct >= firstHalfUnder04Pct;
        const over59Increasing = !under04Increasing;

        // Statistical Analysis 2 Momentum: Under (0-5) vs Over (4-9)
        const firstHalfUnder05Pct = firstHalf50.filter(d => d <= 5).length / (firstHalf50.length || 1);
        const secondHalfUnder05Pct = secondHalf50.filter(d => d <= 5).length / (secondHalf50.length || 1);
        const under05Increasing = secondHalfUnder05Pct >= firstHalfUnder05Pct;
        const over49Increasing = !under05Increasing;

        const underIncreasing = under04Increasing || under05Increasing;
        const overIncreasing = over59Increasing || over49Increasing;

        // Frequency table for 50 ticks
        const freq50 = new Array(10).fill(0);
        slice50.forEach(d => {
            if (d >= 0 && d <= 9) freq50[d]++;
        });

        // Dominant Entry Digit in Under (0-5)
        let maxUnderCount = -1;
        let highestUnderDigit = 0;
        freq50.slice(0, 6).forEach((c, idx) => {
            if (c > maxUnderCount) {
                maxUnderCount = c;
                highestUnderDigit = idx;
            }
        });
        const highestUnderPct = (maxUnderCount / total50) * 100;

        // Dominant Entry Digit in Over (4-9)
        let maxOverCount = -1;
        let highestOverDigit = 4;
        freq50.slice(4, 10).forEach((c, idx) => {
            if (c > maxOverCount) {
                maxOverCount = c;
                highestOverDigit = idx + 4;
            }
        });
        const highestOverPct = (maxOverCount / total50) * 100;

        // 3. 15-TICK ROLLING STABILITY CYCLE
        const slice15 = digits.slice(-15);
        const total15 = slice15.length || 1;
        const cycleUnder05 = slice15.filter(d => d <= 5).length;
        const cycleOver49 = slice15.filter(d => d >= 4).length;
        const pctCycleUnder05 = (cycleUnder05 / total15) * 100;
        const pctCycleOver49 = (cycleOver49 / total15) * 100;

        // Regime shift detection: Market has flip-flopped significantly within 15 ticks
        const isRegimeShiftUnder = cycleOver49 >= 9; // Looking for Under, but last 15 has 9+ Over digits
        const isRegimeShiftOver = cycleUnder05 >= 9; // Looking for Over, but last 15 has 9+ Under digits

        let stabilityStatus: 'STABLE_UNDER' | 'STABLE_OVER' | 'SHIFTING' | 'NEUTRAL' = 'NEUTRAL';
        if (cycleUnder05 >= 10 && !isRegimeShiftUnder) {
            stabilityStatus = 'STABLE_UNDER';
        } else if (cycleOver49 >= 10 && !isRegimeShiftOver) {
            stabilityStatus = 'STABLE_OVER';
        } else if (isRegimeShiftUnder || isRegimeShiftOver) {
            stabilityStatus = 'SHIFTING';
        }

        // 4. MICRO WINDOWS (Last 10 & Last 7 Ticks)
        const slice10 = digits.slice(-10);
        const last10UnderCount = slice10.filter(d => d <= 5).length;
        const last10OverCount = slice10.filter(d => d >= 4).length;

        const slice7 = digits.slice(-7);
        const last7UnderCount = slice7.filter(d => d <= 5).length;
        const last7OverCount = slice7.filter(d => d >= 4).length;

        // 5. MARKET BIAS & COMPOSITE QUALITY SCORE
        let bias: 'under' | 'over' | 'shifting' | 'neutral' = 'neutral';
        if (stabilityStatus === 'SHIFTING') {
            bias = 'shifting';
        } else if ((pctUnder05 >= 56 || (pctUnder04 >= 55 && underIncreasing)) && under05 > over49) {
            bias = 'under';
        } else if ((pctOver49 >= 56 || (pctOver59 >= 55 && overIncreasing)) && over49 > under05) {
            bias = 'over';
        }

        // Quality Score calculation (0 - 100)
        let qualityScore = 50;
        if (bias === 'under') {
            qualityScore = Math.round(
                (pctUnder05 * 0.4) +
                ((last10UnderCount / 10) * 100 * 0.3) +
                (outliersUnder6Safe ? 20 : 0) +
                (macroUnder6Dominant ? 10 : 0)
            );
        } else if (bias === 'over') {
            qualityScore = Math.round(
                (pctOver49 * 0.4) +
                ((last10OverCount / 10) * 100 * 0.3) +
                (outliersOver3Safe ? 20 : 0) +
                (macroOver3Dominant ? 10 : 0)
            );
        } else {
            qualityScore = Math.round(Math.max(pctUnder05, pctOver49) * 0.8);
        }
        qualityScore = Math.min(100, Math.max(0, qualityScore));

        const isAvoidMarket =
            (bias === 'under' && !outliersUnder6Safe) ||
            (bias === 'over' && !outliersOver3Safe) ||
            stabilityStatus === 'SHIFTING' ||
            qualityScore < 45;

        // 6. MARKET CONDITION, UNBALANCED DIGITS & PATTERN DIAGNOSIS
        const reasons: string[] = [];
        let unbalancedDigits = false;
        let unbalancedDigitsReason = '';
        let unidentifiedPattern = false;
        let unidentifiedPatternReason = '';
        let conditionsNotMet = false;
        let conditionsNotMetReason = '';

        const isSampleSufficient = totalTicks >= 15;

        // A. Unbalanced Digits & Outlier Surge Evaluation
        const maxOutlierUnder = Math.max(outlier7Pct, outlier8Pct, outlier9Pct);
        const maxOutlierOver = Math.max(outlier0Pct, outlier1Pct, outlier2Pct);
        const hasOutlierSurgeUnder =
            outlier7Pct >= 11.5 ||
            outlier8Pct >= 11.5 ||
            outlier9Pct >= 11.5 ||
            (outlier7Pct >= 10 && outlier7Increasing) ||
            (outlier8Pct >= 10 && outlier8Increasing) ||
            (outlier9Pct >= 10 && outlier9Increasing);
        const hasOutlierSurgeOver =
            outlier0Pct >= 11.5 ||
            outlier1Pct >= 11.5 ||
            outlier2Pct >= 11.5 ||
            (outlier0Pct >= 10 && outlier0Increasing) ||
            (outlier1Pct >= 10 && outlier1Increasing) ||
            (outlier2Pct >= 10 && outlier2Increasing);

        const isDeadlockedRatio = Math.abs(under05 - over49) <= 1 && totalTicks >= 25;

        if ((bias === 'under' || under05 >= over49) && hasOutlierSurgeUnder) {
            unbalancedDigits = true;
            unbalancedDigitsReason = `Under 6 Outlier Risk: Digits 7,8,9 reach ${maxOutlierUnder.toFixed(1)}% (ceiling 10%) with rising outlier momentum.`;
            reasons.push(unbalancedDigitsReason);
        } else if ((bias === 'over' || over49 > under05) && hasOutlierSurgeOver) {
            unbalancedDigits = true;
            unbalancedDigitsReason = `Over 3 Outlier Risk: Digits 0,1,2 reach ${maxOutlierOver.toFixed(1)}% (ceiling 10%) with rising outlier momentum.`;
            reasons.push(unbalancedDigitsReason);
        } else if (isDeadlockedRatio && (hasOutlierSurgeUnder || hasOutlierSurgeOver)) {
            unbalancedDigits = true;
            unbalancedDigitsReason = `Deadlocked 50/50 digit ratio with unstable outlier distribution.`;
            reasons.push(unbalancedDigitsReason);
        }

        // B. Unidentified Pattern Evaluation
        const maxDomPct = Math.max(pctUnder05, pctOver49);
        const hasNoDominance = maxDomPct < 54 && totalTicks >= 20;
        const isNeutralChoppy = (bias === 'neutral' || bias === 'shifting') && totalTicks >= 20;
        const dominantMicroCount = bias === 'under' ? last10UnderCount : last10OverCount;
        const isWeakMicro = dominantMicroCount <= 5 && totalTicks >= 15;

        if (hasNoDominance || (isNeutralChoppy && stabilityStatus !== 'STABLE_UNDER' && stabilityStatus !== 'STABLE_OVER')) {
            unidentifiedPattern = true;
            unidentifiedPatternReason = `Unidentified Pattern: Choppy neutral consolidation (U: ${under05} vs O: ${over49}, ${maxDomPct.toFixed(0)}% edge). No statistical trend found.`;
            reasons.push(unidentifiedPatternReason);
        } else if (isWeakMicro && !unidentifiedPattern) {
            unidentifiedPattern = true;
            unidentifiedPatternReason = `Unidentified Pattern: Weak micro momentum (${dominantMicroCount}/10 ratio in favored direction).`;
            reasons.push(unidentifiedPatternReason);
        }

        // C. Conditions Not Met (Regime Shift, Macro Conflict, Low Quality Score)
        const hasRegimeShift = isRegimeShiftUnder || isRegimeShiftOver;
        const isLowQuality = qualityScore < 50 && totalTicks >= 25;
        const isMacroMismatch =
            (bias === 'under' && !macroUnder6Dominant && macroOver3Dominant) ||
            (bias === 'over' && !macroOver3Dominant && macroUnder6Dominant);

        if (hasRegimeShift) {
            conditionsNotMet = true;
            conditionsNotMetReason = `15-Tick Regime Shift: Counter-trend spike detected (${isRegimeShiftUnder ? cycleOver49 : cycleUnder05}/15 counter digits).`;
            reasons.push(conditionsNotMetReason);
        } else if (isMacroMismatch) {
            conditionsNotMet = true;
            conditionsNotMetReason = `Macro Mismatch: 1,000-tick macro trend opposes current 50-tick direction.`;
            reasons.push(conditionsNotMetReason);
        } else if (isLowQuality && !conditionsNotMet) {
            conditionsNotMet = true;
            conditionsNotMetReason = `Insufficient Statistical Quality: Edge score is low (${qualityScore}/100).`;
            reasons.push(conditionsNotMetReason);
        }

        // Market Health Status & Diagnostic Alert
        let status: 'GOOD' | 'ANALYZING' | 'NOT_GOOD' = 'ANALYZING';
        let alertTitle = '🔍 ANALYZING MARKET CONDITIONS';
        let alertMessage = `Observing market ticks (${totalTicks}/20 ticks for baseline)...`;
        let alertSeverity: 'danger' | 'warning' | 'success' | 'info' = 'info';

        const isNotGood = (unbalancedDigits || unidentifiedPattern || conditionsNotMet || isAvoidMarket) && isSampleSufficient;
        const isGood =
            !isNotGood &&
            isSampleSufficient &&
            qualityScore >= 60 &&
            !hasRegimeShift &&
            ((bias === 'under' && outliersUnder6Safe && pctUnder05 >= 55) ||
                (bias === 'over' && outliersOver3Safe && pctOver49 >= 55));

        if (!isSampleSufficient) {
            status = 'ANALYZING';
            alertTitle = '🔍 ANALYZING MARKET CONDITIONS';
            alertMessage = `Observing market ticks (${totalTicks}/20 ticks for baseline analysis)...`;
            alertSeverity = 'info';
        } else if (isNotGood) {
            status = 'NOT_GOOD';
            alertTitle = '⚠️ MARKET NOT GOOD';
            alertSeverity = 'danger';
            alertMessage = reasons.length > 0 ? reasons.join(' • ') : 'Market condition not met: Unbalanced digits or unidentified pattern.';
        } else if (isGood) {
            status = 'GOOD';
            alertTitle = '✅ MARKET CONDITIONS OPTIMAL';
            alertSeverity = 'success';
            alertMessage = `Pattern Identified: Strong ${bias === 'under' ? 'Under 6' : 'Over 3'} momentum (${maxDomPct.toFixed(0)}% Dominance, Safe Outliers, Score: ${qualityScore}/100).`;
        } else {
            status = 'ANALYZING';
            alertTitle = '⚖️ MARKET CONSOLIDATING';
            alertSeverity = 'warning';
            alertMessage = `Market is consolidating (U: ${under05} vs O: ${over49}, Score: ${qualityScore}/100). Monitoring for breakout pattern.`;
        }

        const condition: MarketConditionAssessment = {
            status,
            isGood,
            isNotGood,
            alertTitle,
            alertMessage,
            alertSeverity,
            unbalancedDigits,
            unbalancedDigitsReason: unbalancedDigits ? unbalancedDigitsReason : undefined,
            unidentifiedPattern,
            unidentifiedPatternReason: unidentifiedPattern ? unidentifiedPatternReason : undefined,
            conditionsNotMet,
            conditionsNotMetReason: conditionsNotMet ? conditionsNotMetReason : undefined,
            reasons,
            marketHealthScore: qualityScore,
        };

        return {
            macro: {
                total1000,
                freq1000,
                pct1000,
                most1000,
                second1000,
                least1000,
                outlier7Pct,
                outlier8Pct,
                outlier9Pct,
                outlier0Pct,
                outlier1Pct,
                outlier2Pct,
                outlier7Increasing,
                outlier8Increasing,
                outlier9Increasing,
                outlier0Increasing,
                outlier1Increasing,
                outlier2Increasing,
                outliersUnder6Safe,
                outliersOver3Safe,
                macroUnder6Dominant,
                macroOver3Dominant,
            },
            mid: {
                under04,
                over59,
                pctUnder04,
                pctOver59,
                under05,
                over49,
                pctUnder05,
                pctOver49,
                underIncreasing,
                overIncreasing,
                under04Increasing,
                over59Increasing,
                under05Increasing,
                over49Increasing,
                highestUnderDigit,
                highestUnderCount: maxUnderCount,
                highestUnderPct,
                highestOverDigit,
                highestOverCount: maxOverCount,
                highestOverPct,
                freq50,
            },
            cycle: {
                cycleUnder05,
                cycleOver49,
                pctCycleUnder05,
                pctCycleOver49,
                isRegimeShiftUnder,
                isRegimeShiftOver,
                stabilityStatus,
            },
            micro: {
                last10UnderCount,
                last10OverCount,
                last7UnderCount,
                last7OverCount,
            },
            bias,
            qualityScore,
            totalTicks,
            isAvoidMarket,
            condition,
        };
    }, []);

    // ── Systematic Trade Condition Engine (Enforcing Conditions 0, 1, 2, 3, 4) ──
    const checkEntrySignal = useCallback(
        (
            digits: number[],
            forcedStrategy?: 'UNDER_6' | 'OVER_3' | 'AUTO'
        ): EntrySignalResult | null => {
            if (digits.length < 15) return null;
            const a = computeAnalysis(digits);
            const currentLastDigit = digits[digits.length - 1];

            // Determine active direction
            let activeStrat: 'UNDER_6' | 'OVER_3';
            if (forcedStrategy && forcedStrategy !== 'AUTO') {
                activeStrat = forcedStrategy;
            } else if (targetStrategyRef.current !== 'AUTO') {
                activeStrat = targetStrategyRef.current;
            } else {
                activeStrat = a.mid.under05 >= a.mid.over49 ? 'UNDER_6' : 'OVER_3';
            }

            if (activeStrat === 'UNDER_6') {
                // Condition 0: Macro 1000-tick verification
                // Most appearing, 2nd highest, and least appearing digits all < 6 (0-5) OR outliers 7,8,9 < 10% and non-increasing
                const hasEnoughHistory = a.macro.total1000 >= 30;
                const macroCondition = !hasEnoughHistory || (a.macro.macroUnder6Dominant && a.macro.outliersUnder6Safe);

                // Condition 1: Statistical Analysis 1 (Under 0-4 vs Over 5-9 threshold is above 55% & Under 0-5 vs Over 4-9 is increasing)
                const stat1Condition =
                    (a.mid.pctUnder04 >= 55 || (a.mid.pctUnder04 >= 53 && a.mid.under05Increasing)) &&
                    (a.mid.under05Increasing || a.mid.underIncreasing);

                // Condition 2: Statistical Analysis 2 (50-tick Dominance: e.g. Under 0-5 is 34 vs Over 4-9 is 25)
                const stat2Condition =
                    a.mid.under05 >= 27 && a.mid.under05 > a.mid.over49;

                // Condition 3: Micro 10-Tick Ratio (Last 10 ticks has >= 7 Under and <= 3 Over - 7/10 rule)
                const micro10Condition = a.micro.last10UnderCount >= 7;

                // Condition 4: 15-tick cycle stability check (No regime shift, auto-pause on shift & auto-resume when clear)
                const cycleCondition = !a.cycle.isRegimeShiftUnder;

                // Condition 5: Highest Dominant Entry Digit Trigger Matching
                // Strictly wait for the highest dominant entry digit in Under (0-5) to appear on the live tick
                const triggerDigitCondition = currentLastDigit === a.mid.highestUnderDigit;

                const allConditionsPassed =
                    macroCondition && stat1Condition && stat2Condition && cycleCondition && micro10Condition;

                const isTriggered = allConditionsPassed && triggerDigitCondition && !a.cycle.isRegimeShiftUnder;
                const isAutoPaused = a.cycle.isRegimeShiftUnder;

                let reason = '';
                if (isAutoPaused) {
                    reason = `⏸️ AUTO-PAUSED: 15-Tick Regime Shift detected (${a.cycle.cycleOver49}/15 Over). Pausing until cycle stabilizes.`;
                } else if (isTriggered) {
                    reason = `🎯 UNDER 6 Trigger Fired! Live digit [${currentLastDigit}] matched dominant Under entry digit [${a.mid.highestUnderDigit}] (U0-4: ${a.mid.pctUnder04.toFixed(0)}%, U0-5: ${a.mid.under05} vs O4-9: ${a.mid.over49}, 10t: ${a.micro.last10UnderCount}/10)`;
                } else if (allConditionsPassed) {
                    reason = `⏳ Clear Under Signal Found! Waiting for Highest Under Entry Digit [${a.mid.highestUnderDigit}] (Current: ${currentLastDigit}, U0-4: ${a.mid.pctUnder04.toFixed(0)}%, U0-5: ${a.mid.under05} vs O4-9: ${a.mid.over49}, 10t: ${a.micro.last10UnderCount}/10)`;
                } else {
                    reason = `Consolidating (U0-4: ${a.mid.pctUnder04.toFixed(0)}%, U0-5: ${a.mid.under05} vs O4-9: ${a.mid.over49}, 10t: ${a.micro.last10UnderCount}/10). Awaiting >= 55% edge, dominance & 7/10 ratio.`;
                }

                return {
                    direction: 'UNDER',
                    prediction: 6,
                    triggerDigit: a.mid.highestUnderDigit,
                    reason,
                    status: isTriggered ? 'TRIGGERED' : 'WAITING',
                    isAutoPaused,
                    pauseReason: isAutoPaused ? '15-Tick Cycle Shift (Flipping to Over)' : undefined,
                    qualityScore: a.qualityScore,
                    conditions: {
                        macroCondition,
                        stat1Condition,
                        stat2Condition,
                        micro10Condition,
                        cycleCondition,
                        triggerDigitCondition,
                        midCondition: stat1Condition && stat2Condition,
                        micro7Condition: micro10Condition,
                    },
                };
            } else {
                // Condition 0: Macro 1000-tick verification
                // Most appearing, 2nd highest, and least appearing digits all > 3 (4-9) OR outliers 0,1,2 < 10% and non-increasing
                const hasEnoughHistory = a.macro.total1000 >= 30;
                const macroCondition = !hasEnoughHistory || (a.macro.macroOver3Dominant && a.macro.outliersOver3Safe);

                // Condition 1: Statistical Analysis 1 (Over 5-9 vs Under 0-4 threshold is above 55% & Over 4-9 vs Under 0-5 is increasing)
                const stat1Condition =
                    (a.mid.pctOver59 >= 55 || (a.mid.pctOver59 >= 53 && a.mid.over49Increasing)) &&
                    (a.mid.over49Increasing || a.mid.overIncreasing);

                // Condition 2: Statistical Analysis 2 (50-tick Dominance: e.g. Over 4-9 is 34 vs Under 0-5 is 25)
                const stat2Condition =
                    a.mid.over49 >= 27 && a.mid.over49 > a.mid.under05;

                // Condition 3: Micro 10-Tick Ratio (Last 10 ticks has >= 7 Over and <= 3 Under - 7/10 rule)
                const micro10Condition = a.micro.last10OverCount >= 7;

                // Condition 4: 15-tick cycle stability check (No regime shift, auto-pause on shift & auto-resume when clear)
                const cycleCondition = !a.cycle.isRegimeShiftOver;

                // Condition 5: Highest Dominant Entry Digit Trigger Matching
                // Strictly wait for the highest dominant entry digit in Over (4-9) to appear on the live tick
                const triggerDigitCondition = currentLastDigit === a.mid.highestOverDigit;

                const allConditionsPassed =
                    macroCondition && stat1Condition && stat2Condition && cycleCondition && micro10Condition;

                const isTriggered = allConditionsPassed && triggerDigitCondition && !a.cycle.isRegimeShiftOver;
                const isAutoPaused = a.cycle.isRegimeShiftOver;

                let reason = '';
                if (isAutoPaused) {
                    reason = `⏸️ AUTO-PAUSED: 15-Tick Regime Shift detected (${a.cycle.cycleUnder05}/15 Under). Pausing until cycle stabilizes.`;
                } else if (isTriggered) {
                    reason = `🎯 OVER 3 Trigger Fired! Live digit [${currentLastDigit}] matched dominant Over entry digit [${a.mid.highestOverDigit}] (O5-9: ${a.mid.pctOver59.toFixed(0)}%, O4-9: ${a.mid.over49} vs U0-5: ${a.mid.under05}, 10t: ${a.micro.last10OverCount}/10)`;
                } else if (allConditionsPassed) {
                    reason = `⏳ Clear Over Signal Found! Waiting for Highest Over Entry Digit [${a.mid.highestOverDigit}] (Current: ${currentLastDigit}, O5-9: ${a.mid.pctOver59.toFixed(0)}%, O4-9: ${a.mid.over49} vs U0-5: ${a.mid.under05}, 10t: ${a.micro.last10OverCount}/10)`;
                } else {
                    reason = `Consolidating (O5-9: ${a.mid.pctOver59.toFixed(0)}%, O4-9: ${a.mid.over49} vs U0-5: ${a.mid.under05}, 10t: ${a.micro.last10OverCount}/10). Awaiting >= 55% edge, dominance & 7/10 ratio.`;
                }

                return {
                    direction: 'OVER',
                    prediction: 3,
                    triggerDigit: a.mid.highestOverDigit,
                    reason,
                    status: isTriggered ? 'TRIGGERED' : 'WAITING',
                    isAutoPaused,
                    pauseReason: isAutoPaused ? '15-Tick Cycle Shift (Flipping to Under)' : undefined,
                    qualityScore: a.qualityScore,
                    conditions: {
                        macroCondition,
                        stat1Condition,
                        stat2Condition,
                        micro10Condition,
                        cycleCondition,
                        triggerDigitCondition,
                        midCondition: stat1Condition && stat2Condition,
                        micro7Condition: micro10Condition,
                    },
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
    }, [selectedSymbol]);

    // ── Initial 1000-Tick Historical Ingestion on Symbol Activation ──
    const fetch1000TicksHistory = useCallback(async (sym: string) => {
        if (historyFetchedSymbolsRef.current.has(sym)) return;
        historyFetchedSymbolsRef.current.add(sym);

        try {
            if (api_base?.api?.connection?.readyState === 1) {
                const res = (await api_base.api
                    .send({
                        ticks_history: sym,
                        count: 1000,
                        end: 'latest',
                        style: 'ticks',
                    })
                    .catch(() => null)) as { history?: { prices?: (number | string)[] } } | null;

                if (res?.history?.prices && Array.isArray(res.history.prices) && res.history.prices.length > 0) {
                    const activeMarket = marketsRef.current.get(sym);
                    if (activeMarket) {
                        const histDigits = res.history.prices.map(p => extractDigitFromPrice(p));
                        const lastPrice = res.history.prices[res.history.prices.length - 1];
                        activeMarket.digits = histDigits.slice(-MAX_DIGITS_BUFFER);
                        activeMarket.currentPrice = String(lastPrice);
                        activeMarket.lastDigit = histDigits[histDigits.length - 1] || 0;
                        activeMarket.lastTickTime = Date.now();
                        throttleRender();
                    }
                }
            }
        } catch {}
    }, [throttleRender]);

    // ── Real-Time Tick Subscriptions for Multi-Market Scanner ──
    const [streamRefreshKey, setStreamRefreshKey] = useState(0);

    useEffect(() => {
        const handleRefresh = () => {
            subscriptionsRef.current.forEach(sub => {
                try {
                    sub.unsubscribe();
                } catch {}
            });
            subscriptionsRef.current.clear();
            historyFetchedSymbolsRef.current.clear();
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

        const watchdog = setInterval(() => {
            if (unmountedRef.current || document.hidden) return;
            const current = marketsRef.current.get(selectedSymbolRef.current);
            const now = Date.now();
            if (current && current.lastTickTime > 0 && now - current.lastTickTime > 4000) {
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

    useEffect(() => {
        const activeSubs = subscriptionsRef.current;
        const symbolsToSubscribe = scanAll ? MARKETS.map(m => m.symbol) : [selectedSymbol];

        symbolsToSubscribe.forEach(sym => {
            if (!marketsRef.current.has(sym)) {
                const label = MARKETS.find(m => m.symbol === sym)?.label || sym;
                marketsRef.current.set(sym, {
                    symbol: sym,
                    label,
                    digits: [],
                    currentPrice: '—',
                    lastDigit: 0,
                    tickCount: 0,
                    lastTickTime: 0,
                    cycleTicks: 0,
                });
            }
            void fetch1000TicksHistory(sym);
        });

        symbolsToSubscribe.forEach(sym => {
            if (activeSubs.has(sym)) return;

            const sub = subscribeTicks(sym, (data: Record<string, unknown>) => {
                if (unmountedRef.current) return;

                const activeMarket = marketsRef.current.get(sym);
                if (!activeMarket) return;

                const tickData = data?.tick as { quote?: number | string } | undefined;
                const quote = tickData?.quote;
                if (quote !== undefined && quote !== null) {
                    const digit = extractDigitFromPrice(quote);
                    aiContinuousLearningService.ingestMarketTick(sym, digit);
                    activeMarket.digits.push(digit);
                    if (activeMarket.digits.length > MAX_DIGITS_BUFFER) activeMarket.digits.shift();
                    activeMarket.currentPrice = String(quote);
                    activeMarket.lastDigit = digit;
                    activeMarket.tickCount = (activeMarket.tickCount || 0) + 1;
                    activeMarket.cycleTicks = (activeMarket.cycleTicks || 0) + 1;
                    activeMarket.lastTickTime = Date.now();
                    throttleRender();
                }
            });

            activeSubs.set(sym, sub);
        });
    }, [scanAll, selectedSymbol, streamRefreshKey, fetch1000TicksHistory, throttleRender]);

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            unmountedRef.current = true;
            subscriptionsRef.current.forEach(sub => {
                try {
                    sub.unsubscribe();
                } catch {}
            });
            subscriptionsRef.current.clear();
        };
    }, []);

    // ── Live Ranked Markets Scanner Radar ──
    const getLiveRankedMarkets = useCallback(() => {
        const result: Array<{
            symbol: string;
            label: string;
            currentPrice: string;
            lastDigit: number;
            qualityScore: number;
            bias: 'under' | 'over' | 'shifting' | 'neutral';
            under05: number;
            over49: number;
            pctUnder05: number;
            pctOver49: number;
            highestUnderDigit: number;
            highestOverDigit: number;
            hasSignal: boolean;
            isTriggered: boolean;
            isAutoPaused: boolean;
            signalDirection?: 'UNDER' | 'OVER';
            condition: MarketConditionAssessment;
        }> = [];

        marketsRef.current.forEach(m => {
            const analysis = computeAnalysis(m.digits);
            const signal = checkEntrySignal(m.digits, 'AUTO');

            result.push({
                symbol: m.symbol,
                label: m.label,
                currentPrice: m.currentPrice,
                lastDigit: m.lastDigit,
                qualityScore: analysis.qualityScore,
                bias: analysis.bias,
                under05: analysis.mid.under05,
                over49: analysis.mid.over49,
                pctUnder05: analysis.mid.pctUnder05,
                pctOver49: analysis.mid.pctOver49,
                highestUnderDigit: analysis.mid.highestUnderDigit,
                highestOverDigit: analysis.mid.highestOverDigit,
                hasSignal: Boolean(signal && !signal.isAutoPaused),
                isTriggered: Boolean(signal && signal.status === 'TRIGGERED'),
                isAutoPaused: Boolean(signal?.isAutoPaused),
                signalDirection: signal?.direction,
                condition: analysis.condition,
            });
        });

        result.sort((a, b) => {
            // 1. Triggered & Good condition markets first
            const aTriggeredGood = a.isTriggered && a.condition.isGood;
            const bTriggeredGood = b.isTriggered && b.condition.isGood;
            if (aTriggeredGood && !bTriggeredGood) return -1;
            if (!aTriggeredGood && bTriggeredGood) return 1;

            // 2. Has Signal & Good condition
            const aSignalGood = a.hasSignal && a.condition.isGood;
            const bSignalGood = b.hasSignal && b.condition.isGood;
            if (aSignalGood && !bSignalGood) return -1;
            if (!aSignalGood && bSignalGood) return 1;

            // 3. Good condition markets before Analyzing/Not Good
            if (a.condition.status === 'GOOD' && b.condition.status !== 'GOOD') return -1;
            if (a.condition.status !== 'GOOD' && b.condition.status === 'GOOD') return 1;

            // 4. Analyzing before Not Good
            if (a.condition.status === 'ANALYZING' && b.condition.status === 'NOT_GOOD') return -1;
            if (a.condition.status === 'NOT_GOOD' && b.condition.status === 'ANALYZING') return 1;

            // 5. By qualityScore descending
            return b.qualityScore - a.qualityScore;
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
                globalObserver.emit('bot.contract', data);
            } catch {}
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
            const entry: TradeLogEntry = {
                id: `EP-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                time: new Date().toLocaleTimeString(),
                type,
                market,
                result,
                profit,
                details,
            };
            setTradeLog(prev => [entry, ...prev].slice(0, 100));

            try {
                const message = details ? `[${market}] ${type}: ${details}` : `[${market}] ${type}`;
                const className = result === 'WIN' ? 'greentext' : result === 'LOSS' ? 'redtext' : 'journal-notify';
                globalObserver.emit('bot.notify', { message, className });
            } catch {}
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

    // ── Handle manual market selection ──
    const handleManualMarketSelect = useCallback(
        (sym: string) => {
            setSelectedSymbol(sym);
            selectedSymbolRef.current = sym;
            if (autoInputBestMarket) setAutoInputBestMarket(false);

            if (autoStateRef.current !== 'IDLE') {
                const label = MARKETS.find(m => m.symbol === sym)?.label || sym;
                addLogEntry('MARKET SWITCHED', label, 'PENDING', 0, `Focused live trading on ${label}`);
            }
            throttleRender();
        },
        [autoInputBestMarket, addLogEntry, throttleRender]
    );

    // ── Automated Trading Execution Loop (Continuous Non-Stalling Loop) ──
    const startAutoTrading = useCallback(async () => {
        if (!logged_in) {
            const oauthUrl = await generateOAuthURL();
            if (oauthUrl) window.location.replace(oauthUrl);
            return;
        }

        const tp = parseFloat(takeProfit) || 10;
        const sl = parseFloat(stopLoss) || 25;
        const baseStake = parseFloat(stake) || 0.50;
        const mgMultiplier = parseFloat(martingale) || 2.6;

        currentStakeRef.current = baseStake;
        consecutiveLossesRef.current = 0;
        targetStrategyRef.current = 'AUTO';
        setActiveTargetStrategy('AUTO');

        addLogEntry(
            'ENGINE STARTED',
            MARKETS.find(m => m.symbol === selectedSymbol)?.label || selectedSymbol,
            'PENDING',
            0,
            `Stake: $${baseStake.toFixed(2)} | TP: $${tp} | SL: $${sl} | Martingale: ${mgMultiplier}x`
        );

        const startLocalEngineLoop = () => {
            setAutoState('SCANNING');
            autoStateRef.current = 'SCANNING';
            autoAbortRef.current = new AbortController();
            const abortSignal = autoAbortRef.current.signal;
            let tradeRuns = 0;

            // Stabilized Market Analysis Dwell Tracking
            let currentMarketDwellTicks = 0;
            let lastProcessedTickCount = 0;
            let lastMarketSwitchTime = Date.now();
            let badMarketConsecutiveCycles = 0;
            let noPatternConsecutiveCycles = 0;
            const MIN_ANALYSIS_DWELL_TICKS = 8;
            const MIN_ANALYSIS_DWELL_TIME_MS = 4000;

            const loop = async () => {
                while (!abortSignal.aborted && autoStateRef.current !== 'IDLE') {
                    if (autoStateRef.current === 'PAUSED') {
                        await new Promise(r => setTimeout(r, 400));
                        continue;
                    }

                    // 1. Check Take Profit & Stop Loss Limits
                    if (totalProfitRef.current >= tp) {
                        addLogEntry('TARGET REACHED', 'Take Profit Target Hit 🎉', 'PENDING', 0);
                        setAutoState('IDLE');
                        autoStateRef.current = 'IDLE';
                        setMilestone({ isOpen: true, type: 'tp' });
                        break;
                    }
                    if (totalProfitRef.current <= -sl) {
                        addLogEntry('STOP LOSS HIT', 'Stop Loss Limit Reached 🛡️', 'PENDING', 0);
                        setAutoState('IDLE');
                        autoStateRef.current = 'IDLE';
                        setMilestone({ isOpen: true, type: 'sl' });
                        break;
                    }

                    let targetSym = selectedSymbolRef.current;
                    const currentData = marketsRef.current.get(targetSym);
                    if (!currentData || currentData.digits.length < 15) {
                        if (autoStateRef.current !== 'SCANNING') {
                            setAutoState('SCANNING');
                            autoStateRef.current = 'SCANNING';
                        }
                        await new Promise(r => setTimeout(r, 200));
                        continue;
                    }

                    // Track tick ingestion on current market for stabilized dwell window
                    const currentMarketTickCount = currentData.tickCount || 0;
                    if (currentMarketTickCount > lastProcessedTickCount) {
                        currentMarketDwellTicks += Math.max(1, currentMarketTickCount - lastProcessedTickCount);
                        lastProcessedTickCount = currentMarketTickCount;
                    }

                    // 2. Perform Complete Condition Assessment on Current Market
                    const currentAnalysis = computeAnalysis(currentData.digits);
                    const currentCondition = currentAnalysis.condition;
                    const activeStrat = targetStrategyRef.current;
                    const entrySignal = checkEntrySignal(currentData.digits, activeStrat);

                    const isDwellSatisfied =
                        currentMarketDwellTicks >= MIN_ANALYSIS_DWELL_TICKS ||
                        Date.now() - lastMarketSwitchTime >= MIN_ANALYSIS_DWELL_TIME_MS;

                    // 3. Intelligent Bad Market Detection & Auto-Switching
                    // Market switches ONLY if:
                    //   a) Market condition is NOT_GOOD (unbalanced digits, unidentified patterns, regime shift, or poor score)
                    //   b) OR no pattern forms after extended observation (>= 15 cycles)
                    const isMarketNotGood =
                        currentCondition.isNotGood ||
                        Boolean(entrySignal?.isAutoPaused) ||
                        currentCondition.unbalancedDigits ||
                        currentCondition.unidentifiedPattern;

                    if (isMarketNotGood) {
                        badMarketConsecutiveCycles++;
                    } else {
                        badMarketConsecutiveCycles = 0;
                    }

                    // Auto-Switch when market condition is NOT MET and dwell time has elapsed
                    if (autoSwitchMarkets && currentStakeRef.current <= baseStake) {
                        // Emergency fast-switch if severe regime shift or immediate dangerous outlier surge, otherwise wait for dwell
                        const isCriticalFailure = Boolean(entrySignal?.isAutoPaused) || currentCondition.unbalancedDigits;
                        const shouldSwitch =
                            (isMarketNotGood && (isDwellSatisfied || isCriticalFailure)) ||
                            noPatternConsecutiveCycles >= 15;

                        if (shouldSwitch) {
                            const liveRanked = getLiveRankedMarkets();
                            const cleanAltMarket = liveRanked.find(
                                m => m.symbol !== targetSym && m.condition.isGood && m.qualityScore >= 60 && !m.isAutoPaused
                            );

                            if (cleanAltMarket) {
                                const oldLabel = currentData.label;
                                setSelectedSymbol(cleanAltMarket.symbol);
                                selectedSymbolRef.current = cleanAltMarket.symbol;
                                targetStrategyRef.current = 'AUTO';
                                setActiveTargetStrategy('AUTO');
                                currentMarketDwellTicks = 0;
                                lastProcessedTickCount = marketsRef.current.get(cleanAltMarket.symbol)?.tickCount || 0;
                                lastMarketSwitchTime = Date.now();
                                badMarketConsecutiveCycles = 0;
                                noPatternConsecutiveCycles = 0;

                                const reasonSummary =
                                    currentCondition.alertMessage ||
                                    (entrySignal?.isAutoPaused
                                        ? '15-Tick Regime Shift'
                                        : 'Unbalanced digits or unidentified pattern');

                                addLogEntry(
                                    'MARKET ROTATION',
                                    cleanAltMarket.label,
                                    'PENDING',
                                    0,
                                    `⚠️ [${oldLabel}] Market Not Good: ${reasonSummary} -> Auto-switched to ${cleanAltMarket.label} (Score: ${cleanAltMarket.qualityScore}, ${cleanAltMarket.bias.toUpperCase()} Setup)`
                                );
                                throttleRender();
                                await new Promise(r => setTimeout(r, 600));
                                continue;
                            }
                        }
                    }

                    // 4. Handle Auto-Pause on 15-Tick Regime Shift if not auto-switched
                    if (entrySignal?.isAutoPaused) {
                        if (autoStateRef.current !== 'SCANNING') {
                            setAutoState('SCANNING');
                            autoStateRef.current = 'SCANNING';
                        }
                        await new Promise(r => setTimeout(r, 200));
                        continue;
                    }

                    // 5. Handle Waiting State / Trigger Observation
                    if (!entrySignal || entrySignal.status === 'WAITING') {
                        noPatternConsecutiveCycles++;

                        if (entrySignal && entrySignal.status === 'WAITING' && currentCondition.isGood) {
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

                        await new Promise(r => setTimeout(r, 100));
                        continue;
                    }

                    // 6. Trigger Confirmed & Market Condition Validated: Execute Trade Immediately
                    noPatternConsecutiveCycles = 0;
                    setAutoState('TRADING');
                    autoStateRef.current = 'TRADING';

                    try {
                        const stakeToUse = currentStakeRef.current;
                        addLogEntry(
                            `BUYING ${entrySignal.direction} ${entrySignal.prediction}`,
                            currentData.label,
                            'PENDING',
                            0,
                            `Stake: $${stakeToUse.toFixed(2)} ${currency} | ${entrySignal.reason}`
                        );

                        const profit = await executeTrade(
                            targetSym,
                            entrySignal.direction,
                            entrySignal.prediction,
                            stakeToUse
                        );

                        if (abortSignal.aborted || (autoStateRef.current as AutoState) === 'IDLE') break;

                        const isWin = profit > 0;
                        const resultStr = isWin ? 'WIN' : 'LOSS';

                        // Record trade in continuous learning engine
                        aiContinuousLearningService.recordBotTrade({
                            botName: 'ELITE_PRO',
                            strategy: `DIGIT${entrySignal.direction}_${entrySignal.prediction}`,
                            market: targetSym,
                            contractType: entrySignal.direction === 'UNDER' ? 'DIGITUNDER' : 'DIGITOVER',
                            barrier: String(entrySignal.prediction),
                            prediction: entrySignal.prediction,
                            isWin,
                            profit,
                            stake: stakeToUse,
                        });

                        addLogEntry(
                            `${entrySignal.direction} ${entrySignal.prediction}`,
                            currentData.label,
                            resultStr,
                            profit,
                            `Return: ${profit >= 0 ? '+' : ''}$${profit.toFixed(2)} ${currency}`
                        );

                        const nextProfit = Number((totalProfitRef.current + profit).toFixed(2));
                        totalProfitRef.current = nextProfit;
                        setTotalProfit(nextProfit);
                        tradeRuns++;

                        // 7. Intelligent Re-Entry & Recovery Handling
                        if (isWin) {
                            winsRef.current++;
                            setWins(winsRef.current);
                            consecutiveLossesRef.current = 0;
                            currentStakeRef.current = baseStake;

                            // Reset to AUTO on win so the bot seamlessly follows optimal statistical momentum
                            targetStrategyRef.current = 'AUTO';
                            setActiveTargetStrategy('AUTO');
                        } else {
                            lossesRef.current++;
                            setLosses(lossesRef.current);
                            consecutiveLossesRef.current++;

                            // Martingale Recovery Calculation (capped at 5 steps)
                            const maxSteps = 5;
                            if (consecutiveLossesRef.current < maxSteps) {
                                currentStakeRef.current = Number((currentStakeRef.current * mgMultiplier).toFixed(2));
                            } else {
                                currentStakeRef.current = baseStake;
                                consecutiveLossesRef.current = 0;
                                addLogEntry(
                                    'MARTINGALE RESET',
                                    currentData.label,
                                    'PENDING',
                                    0,
                                    `🛡️ Reached maximum recovery steps (${maxSteps}). Resetting to base stake.`
                                );
                            }

                            // Intelligent Loss Adaptation:
                            const updatedDigits = marketsRef.current.get(targetSym)?.digits || [];
                            const freshAnalysis = computeAnalysis(updatedDigits);

                            if (freshAnalysis.mid.pctUnder05 >= 56 && freshAnalysis.macro.outliersUnder6Safe) {
                                targetStrategyRef.current = 'UNDER_6';
                                setActiveTargetStrategy('UNDER_6');
                            } else if (freshAnalysis.mid.pctOver49 >= 56 && freshAnalysis.macro.outliersOver3Safe) {
                                targetStrategyRef.current = 'OVER_3';
                                setActiveTargetStrategy('OVER_3');
                            } else {
                                targetStrategyRef.current = 'AUTO';
                                setActiveTargetStrategy('AUTO');
                            }

                            addLogEntry(
                                'INTELLIGENT RE-ENTRY',
                                currentData.label,
                                'PENDING',
                                0,
                                `🔄 [RECOVERY] Next Stake: $${currentStakeRef.current.toFixed(2)} ${currency} (Direction: ${targetStrategyRef.current.replace('_', ' ')})`
                            );

                            // Post-loss cooldown: Allow market confirmation ticks to settle before next trigger
                            await new Promise(r => setTimeout(r, 1200));
                        }

                        // Check Take Profit or Stop Loss after trade settlement
                        if (totalProfitRef.current >= tp) {
                            addLogEntry('TARGET REACHED', 'Take Profit Target Hit 🎉', 'PENDING', 0);
                            setAutoState('IDLE');
                            autoStateRef.current = 'IDLE';
                            setMilestone({ isOpen: true, type: 'tp' });
                            break;
                        }
                        if (totalProfitRef.current <= -sl) {
                            addLogEntry('STOP LOSS HIT', 'Stop Loss Limit Reached 🛡️', 'PENDING', 0);
                            setAutoState('IDLE');
                            autoStateRef.current = 'IDLE';
                            setMilestone({ isOpen: true, type: 'sl' });
                            break;
                        }

                        // Always cycle back to SCANNING so the loop continues effortlessly!
                        if ((autoStateRef.current as AutoState) !== 'IDLE') {
                            setAutoState('SCANNING');
                            autoStateRef.current = 'SCANNING';
                        }
                        await new Promise(r => setTimeout(r, 350));
                    } catch (err) {
                        if (abortSignal.aborted || (autoStateRef.current as AutoState) === 'IDLE') break;
                        const msg = err instanceof Error ? err.message : String(err);
                        console.error('[ElitePro] Trade execution loop error:', msg);
                        addLogEntry('EXECUTION ERROR', currentData.label, 'LOSS', 0, msg);
                        if ((autoStateRef.current as AutoState) !== 'IDLE') {
                            setAutoState('SCANNING');
                            autoStateRef.current = 'SCANNING';
                        }
                        await new Promise(r => setTimeout(r, 1200));
                    }
                }
            };

            void loop();
        };

        startLocalEngineLoop();
    }, [
        logged_in,
        takeProfit,
        stopLoss,
        martingale,
        stake,
        currency,
        selectedSymbol,
        addLogEntry,
        autoInputBestMarket,
        getLiveRankedMarkets,
        checkEntrySignal,
        autoSwitchMarkets,
        executeTrade,
        computeAnalysis,
        throttleRender,
    ]);

    // ── Pause, Resume, Stop controls ──
    const pauseAutoTrading = useCallback(() => {
        setAutoState('PAUSED');
        autoStateRef.current = 'PAUSED';
        addLogEntry('BOT PAUSED', selectedSymbol, 'PENDING', 0, 'Auto-trading paused');
    }, [selectedSymbol, addLogEntry]);

    const resumeAutoTrading = useCallback(() => {
        if (autoStateRef.current === 'PAUSED') {
            setAutoState('SCANNING');
            autoStateRef.current = 'SCANNING';
            addLogEntry('BOT RESUMED', selectedSymbol, 'PENDING', 0, 'Auto-trading resumed');
        }
    }, [selectedSymbol, addLogEntry]);

    const stopAutoTrading = useCallback(() => {
        setAutoState('IDLE');
        autoStateRef.current = 'IDLE';
        autoAbortRef.current?.abort();
        autoAbortRef.current = null;
        contractStreamAbortRef.current.forEach(c => c.abort());
        contractStreamAbortRef.current.clear();
        addLogEntry('BOT STOPPED', selectedSymbol, 'PENDING', 0, 'Auto-trading stopped');
    }, [selectedSymbol, addLogEntry]);

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

    // Derived active analysis data
    const activeData = getActiveData();
    const analysis = activeData?.digits ? computeAnalysis(activeData.digits) : null;
    const activeSignal = activeData?.digits ? checkEntrySignal(activeData.digits, activeTargetStrategy) : null;
    const allMarketsData = getLiveRankedMarkets();
    const bestMarket = allMarketsData[0];

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

    // Check whether current live digit matches the active entry trigger digit
    const isUnderTriggerGlowing = Boolean(
        activeData && analysis && activeData.lastDigit === analysis.mid.highestUnderDigit
    );
    const isOverTriggerGlowing = Boolean(
        activeData && analysis && activeData.lastDigit === analysis.mid.highestOverDigit
    );

    return (
        <div className='elite-pro'>
            <div className='ep-background-blobs'>
                <div className='blob blob-1' />
                <div className='blob blob-2' />
                <div className='blob blob-3' />
            </div>

            <div className='ep-layout'>
                {/* ══════════════════════════════════════════════════════════════════
                    SIDE PANEL: ALL DERIVED SYNTHETIC MARKETS SCANNER
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
                                <span>Auto-Input Best Market</span>
                            </label>
                        </div>
                    )}

                    {marketsSideExpanded && (
                        <div className='ep-sidebar__market-list'>
                            {allMarketsData.map(m => {
                                const isSelected = m.symbol === selectedSymbol;
                                const isBest = bestMarket?.symbol === m.symbol;
                                const condStatus = m.condition?.status || 'ANALYZING';
                                return (
                                    <div
                                        key={m.symbol}
                                        className={`ep-side-market-card ${isSelected ? 'active' : ''} ${m.isTriggered ? 'signal-glowing' : ''} ${m.isAutoPaused ? 'cycle-paused' : ''} ep-side-market-card--${condStatus.toLowerCase()}`}
                                        onClick={() => handleManualMarketSelect(m.symbol)}
                                    >
                                        <div className='ep-side-market-card__top'>
                                            <div className='name-box'>
                                                <span className='label'>{m.label}</span>
                                                {isBest && <span className='best-tag'>TOP</span>}
                                                <span className={`health-tag health-tag--${condStatus.toLowerCase()}`}>
                                                    {condStatus === 'GOOD' ? 'QUALIFIED' : condStatus === 'NOT_GOOD' ? 'NOT GOOD' : 'ANALYZING'}
                                                </span>
                                                {m.hasSignal && (
                                                    <span className={`signal-tag signal-tag--${m.signalDirection?.toLowerCase()}`}>
                                                        {m.signalDirection} {m.signalDirection === 'UNDER' ? '6' : '3'}
                                                    </span>
                                                )}
                                                {m.isAutoPaused && <span className='pause-tag'>CYCLE PAUSED</span>}
                                            </div>
                                            <div className='price-box'>{m.currentPrice}</div>
                                            <div className='last-digit-badge'>
                                                <strong className={m.lastDigit <= 5 ? 'digit-under' : 'digit-over'}>
                                                    {m.lastDigit}
                                                </strong>
                                            </div>
                                        </div>

                                        <div className='ep-side-market-card__stats'>
                                            <div className='ratio-mini-bar'>
                                                <div className='u-part' style={{ width: `${m.pctUnder05}%` }} />
                                                <div className='o-part' style={{ width: `${m.pctOver49}%` }} />
                                            </div>
                                            <div className='stat-labels'>
                                                <span className='u-text'>U (0-5): {m.under05} ({m.pctUnder05.toFixed(0)}%)</span>
                                                <span className='o-text'>O (4-9): {m.over49} ({m.pctOver49.toFixed(0)}%)</span>
                                            </div>
                                        </div>

                                        <div className='ep-side-market-card__footer'>
                                            <span className={`bias-pill bias-pill--${m.bias}`}>
                                                {m.bias.toUpperCase()} (Score: {m.qualityScore})
                                            </span>
                                            <span className='best-digits'>
                                                U*:[{m.highestUnderDigit}] | O*:[{m.highestOverDigit}]
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
                <main className='ep-main-content'>
                    {/* ── Top Header Bar ── */}
                    <div className='ep-glass ep-header'>
                        <div className='ep-header__title'>
                            <span className='ep-crown'>👑</span>
                            <div className='ep-title-meta'>
                                <span className='ep-title-text'>Elite Pro Trading Suite</span>
                                <span className='ep-title-sub'>High-Probability Multi-Timeframe Statistical Engine (Under 6 &amp; Over 3)</span>
                            </div>
                        </div>

                        <div className='ep-header__actions'>
                            <button
                                className='ep-btn-ai-learning-hub'
                                onClick={() => setIsAiLearningHubOpen(true)}
                                title='Open Neural Learning Lab & 24/7 Machine Mode'
                            >
                                🧠 AI Learning Lab (24/7 Mode)
                            </button>

                            {bestMarket && (
                                <div
                                    className='ep-best-market-badge'
                                    onClick={() => handleManualMarketSelect(bestMarket.symbol)}
                                    title='Click to switch to best ranked market'
                                >
                                    🏆 Best Market: <strong>{bestMarket.label}</strong> ({bestMarket.bias.toUpperCase()} — Score: {bestMarket.qualityScore})
                                </div>
                            )}

                            <span className={`ep-engine-status-badge ep-engine-status-badge--${autoState.toLowerCase()}`}>
                                {autoState === 'IDLE' && '● ENGINE IDLE'}
                                {autoState === 'SCANNING' && '⚡ SCANNING CRITERIA'}
                                {autoState === 'WAITING_TRIGGER' && '🎯 WAITING TRIGGER DIGIT'}
                                {autoState === 'TRADING' && '🚀 EXECUTING TRADE'}
                                {autoState === 'PAUSED' && '⏸ ENGINE PAUSED'}
                            </span>
                        </div>
                    </div>

                    {/* ── Active Market Bar & Quick Dropdown ── */}
                    <div className='ep-glass ep-market-bar'>
                        <div className='select-container'>
                            <span className='label'>Active Market:</span>
                            <select
                                className='ep-market-select'
                                value={selectedSymbol}
                                onChange={e => handleManualMarketSelect(e.target.value)}
                            >
                                {MARKETS.map(m => (
                                    <option key={m.symbol} value={m.symbol}>
                                        {m.label} ({m.symbol})
                                    </option>
                                ))}
                            </select>
                        </div>

                        <div className='market-meta-tags'>
                            <span className='meta-tag'>
                                📈 Active Market: <strong>{MARKETS.find(m => m.symbol === selectedSymbol)?.label}</strong>
                            </span>
                            <span className='meta-tag'>
                                🎯 Trade Type: <strong>{currentTradeType}</strong>
                            </span>
                            <span className='meta-tag'>
                                🔮 Auto Prediction:{' '}
                                <strong>
                                    {currentTradeType === 'DIGITOVER' ? `Over ${currentPrediction}` : `Under ${currentPrediction}`}
                                </strong>
                            </span>
                        </div>

                        <button
                            className={`ep-toggle-wide-view-btn ${showWideView ? 'active' : ''}`}
                            onClick={() => setShowWideView(!showWideView)}
                            title='Toggle Full Market Radar Matrix'
                        >
                            <LayoutGrid size={15} />
                            <span>{showWideView ? 'Collapse Radar' : 'Wide Radar View'}</span>
                        </button>
                    </div>

                    {/* ── Wide View Radar Grid (When Toggled) ── */}
                    {showWideView && (
                        <div className='ep-glass ep-wide-view-radar'>
                            <div className='radar-head'>
                                <h4>🛰️ Live Synthetic Indices Radar Matrix</h4>
                                <p>Real-time statistical evaluation across all derived volatility markets</p>
                            </div>
                            <div className='radar-grid'>
                                {allMarketsData.map(m => (
                                    <div
                                        key={m.symbol}
                                        className={`radar-item ${m.symbol === selectedSymbol ? 'radar-item--active' : ''}`}
                                        onClick={() => handleManualMarketSelect(m.symbol)}
                                    >
                                        <div className='item-top'>
                                            <strong>{m.label}</strong>
                                            <span className={`digit-chip ${m.lastDigit <= 5 ? 'u' : 'o'}`}>{m.lastDigit}</span>
                                        </div>
                                        <div className='item-price'>{m.currentPrice}</div>
                                        <div className='item-ratios'>
                                            <span>U: {m.under05} ({m.pctUnder05.toFixed(0)}%)</span>
                                            <span>O: {m.over49} ({m.pctOver49.toFixed(0)}%)</span>
                                        </div>
                                        <div className='item-foot'>
                                            <span className={`bias-tag ${m.bias}`}>{m.bias.toUpperCase()}</span>
                                            <span className={`cond-mini-tag cond-mini-tag--${m.condition?.status.toLowerCase() || 'analyzing'}`}>
                                                {m.condition?.status === 'GOOD' ? 'QUALIFIED' : m.condition?.status === 'NOT_GOOD' ? 'NOT GOOD' : 'ANALYZING'}
                                            </span>
                                            <span>Score: {m.qualityScore}</span>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* ── Live Market Condition & Health Alert Banner ── */}
                    {analysis && (
                        <div className={`ep-glass ep-market-health-banner ep-market-health-banner--${analysis.condition.alertSeverity}`}>
                            <div className='ep-market-health-banner__left'>
                                <div className='status-pill-wrap'>
                                    <span className={`health-status-pill health-status-pill--${analysis.condition.status.toLowerCase()}`}>
                                        {analysis.condition.status === 'GOOD' && <CheckCircle2 size={15} />}
                                        {analysis.condition.status === 'NOT_GOOD' && <AlertTriangle size={15} />}
                                        {analysis.condition.status === 'ANALYZING' && <Info size={15} />}
                                        {analysis.condition.alertTitle}
                                    </span>
                                    <span className='market-name-tag'>{MARKETS.find(m => m.symbol === selectedSymbol)?.label}</span>
                                </div>

                                <p className='health-message'>
                                    {analysis.condition.alertMessage}
                                </p>

                                <div className='diagnostic-chips-row'>
                                    <span className={`diag-chip ${analysis.condition.unbalancedDigits ? 'diag-chip--bad' : 'diag-chip--good'}`}>
                                        {analysis.condition.unbalancedDigits ? '⚠️ Unbalanced Digits' : '✅ Balanced Digits'}
                                    </span>
                                    <span className={`diag-chip ${analysis.condition.unidentifiedPattern ? 'diag-chip--bad' : 'diag-chip--good'}`}>
                                        {analysis.condition.unidentifiedPattern ? '⚠️ Unidentified Pattern' : `✅ Pattern: ${analysis.bias.toUpperCase()}`}
                                    </span>
                                    <span className={`diag-chip ${analysis.cycle.stabilityStatus === 'SHIFTING' ? 'diag-chip--bad' : 'diag-chip--good'}`}>
                                        {analysis.cycle.stabilityStatus === 'SHIFTING' ? '⚠️ 15t Regime Shift' : '✅ Stable 15t Cycle'}
                                    </span>
                                    <span className={`diag-chip ${analysis.qualityScore >= 60 ? 'diag-chip--good' : analysis.qualityScore >= 45 ? 'diag-chip--warn' : 'diag-chip--bad'}`}>
                                        Quality Score: <strong>{analysis.qualityScore}/100</strong>
                                    </span>
                                </div>
                            </div>

                            <div className='ep-market-health-banner__right'>
                                {analysis.condition.isNotGood && bestMarket && bestMarket.symbol !== selectedSymbol && (
                                    <button
                                        className='ep-btn-switch-best-market'
                                        onClick={() => handleManualMarketSelect(bestMarket.symbol)}
                                        title={`Switch to ${bestMarket.label} (Score: ${bestMarket.qualityScore})`}
                                    >
                                        <RefreshCw size={14} />
                                        <span>Switch to <strong>{bestMarket.label}</strong> (Score {bestMarket.qualityScore})</span>
                                    </button>
                                )}

                                <div className='auto-switch-status-indicator'>
                                    <span className='dot' />
                                    <span>Auto-Switch on Bad Market: <strong>{autoSwitchMarkets ? 'ON' : 'OFF'}</strong></span>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* ── 1. Live Price & Last Digit Cards ── */}
                    <div className='ep-hero-grid'>
                        <div className='ep-glass ep-hero-card ep-price-card'>
                            <span className='ep-hero-label'>CURRENT LIVE PRICE</span>
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
                            <div className={`ep-digit-orb-wrapper ep-digit-orb-wrapper--${(activeData?.lastDigit ?? 0) <= 5 ? 'under' : 'over'}`}>
                                <div className='ep-digit-orb'>{activeData?.lastDigit ?? '—'}</div>
                            </div>
                            <span className='ep-digit-sub'>
                                {(activeData?.lastDigit ?? 0) <= 5 ? 'Under Zone (0 – 5)' : 'Over Zone (6 – 9)'}
                            </span>
                        </div>
                    </div>

                    {/* ── 2. Live Last Digit Line Chart (50 Last Digits) ── */}
                    <div className='ep-glass ep-chart-card'>
                        <div className='ep-chart-card__header'>
                            <span className='title'>
                                📊 Live Last Digit Spline Line Chart (Last 50 Digits) — {MARKETS.find(m => m.symbol === selectedSymbol)?.label}
                            </span>
                            <span className='subtitle'>Smooth Bezier trajectory with level 3 &amp; 6 barrier bounds</span>
                        </div>
                        <div className='ep-chart-wrap'>
                            <DigitLineChart digits={activeData?.digits || []} />
                        </div>
                    </div>

                    {/* ── 3. Multi-Horizon Statistical Intelligence Suite ── */}
                    {analysis && (
                        <div className='ep-stats-stack'>
                            {/* ── Card 0: Macro 1000-Tick Historical Intelligence (~30m–1hr) ── */}
                            <div className='ep-glass ep-macro-intel-card'>
                                <div className='card-header-row'>
                                    <div className='title-wrap'>
                                        <ShieldCheck size={20} className='icon text-purple' />
                                        <div>
                                            <h4 className='title'>Macro Market Intelligence (1,000 Ticks / ~30m–1hr Horizon)</h4>
                                            <span className='sub'>Understanding digit history, frequency power &amp; outlier elimination</span>
                                        </div>
                                    </div>
                                    <div className='macro-badges'>
                                        <span className={`macro-bias-badge ${analysis.macro.macroUnder6Dominant ? 'badge--under' : analysis.macro.macroOver3Dominant ? 'badge--over' : 'badge--neutral'}`}>
                                            {analysis.macro.macroUnder6Dominant
                                                ? '🛡️ UNDER 6 MACRO FAVORED'
                                                : analysis.macro.macroOver3Dominant
                                                  ? '🚀 OVER 3 MACRO FAVORED'
                                                  : '⚖️ MACRO CONSOLIDATING'}
                                        </span>
                                    </div>
                                </div>

                                {/* Macro Ranks: Most Appearing, 2nd Highest, Least Appearing */}
                                <div className='ep-macro-ranks-grid'>
                                    <div className='macro-rank-item most'>
                                        <span className='rank-label'>🥇 Most Appearing Digit</span>
                                        <div className='rank-digit-box'>
                                            <span className='digit'>{analysis.macro.most1000}</span>
                                            <span className='pct'>{analysis.macro.pct1000[analysis.macro.most1000]?.toFixed(1)}%</span>
                                        </div>
                                        <span className='status-tag'>{analysis.macro.most1000 <= 5 ? 'Under Zone (0-5)' : 'Over Zone (4-9)'}</span>
                                    </div>

                                    <div className='macro-rank-item second'>
                                        <span className='rank-label'>🥈 2nd Highest Digit</span>
                                        <div className='rank-digit-box'>
                                            <span className='digit'>{analysis.macro.second1000}</span>
                                            <span className='pct'>{analysis.macro.pct1000[analysis.macro.second1000]?.toFixed(1)}%</span>
                                        </div>
                                        <span className='status-tag'>{analysis.macro.second1000 <= 5 ? 'Under Zone (0-5)' : 'Over Zone (4-9)'}</span>
                                    </div>

                                    <div className='macro-rank-item least'>
                                        <span className='rank-label'>🥉 Least Appearing Digit</span>
                                        <div className='rank-digit-box'>
                                            <span className='digit'>{analysis.macro.least1000}</span>
                                            <span className='pct'>{analysis.macro.pct1000[analysis.macro.least1000]?.toFixed(1)}%</span>
                                        </div>
                                        <span className='status-tag'>{analysis.macro.least1000 <= 5 ? 'Under Zone (0-5)' : 'Over Zone (4-9)'}</span>
                                    </div>
                                </div>

                                {/* Outlier Safety Badges Matrix */}
                                <div className='ep-outlier-safety-matrix'>
                                    <div className='safety-col'>
                                        <div className='safety-head'>
                                            <span>Under 6 Outlier Safety (Digits 7, 8, 9 must be &lt; 10% &amp; not increasing)</span>
                                            <span className={`safety-status-pill ${analysis.macro.outliersUnder6Safe ? 'safe' : 'warn'}`}>
                                                {analysis.macro.outliersUnder6Safe ? '✅ SAFE FOR UNDER 6' : '⚠️ OUTLIER RISK'}
                                            </span>
                                        </div>
                                        <div className='outlier-chips-row'>
                                            <div className={`outlier-chip ${analysis.macro.outlier7Pct < 10 && !analysis.macro.outlier7Increasing ? 'good' : 'bad'}`}>
                                                <span className='name'>Digit 7</span>
                                                <strong>{analysis.macro.outlier7Pct.toFixed(1)}%</strong>
                                                <span className='trend'>{analysis.macro.outlier7Increasing ? '↗ Rising' : '↘ Safe'}</span>
                                            </div>
                                            <div className={`outlier-chip ${analysis.macro.outlier8Pct < 10 && !analysis.macro.outlier8Increasing ? 'good' : 'bad'}`}>
                                                <span className='name'>Digit 8</span>
                                                <strong>{analysis.macro.outlier8Pct.toFixed(1)}%</strong>
                                                <span className='trend'>{analysis.macro.outlier8Increasing ? '↗ Rising' : '↘ Safe'}</span>
                                            </div>
                                            <div className={`outlier-chip ${analysis.macro.outlier9Pct < 10 && !analysis.macro.outlier9Increasing ? 'good' : 'bad'}`}>
                                                <span className='name'>Digit 9</span>
                                                <strong>{analysis.macro.outlier9Pct.toFixed(1)}%</strong>
                                                <span className='trend'>{analysis.macro.outlier9Increasing ? '↗ Rising' : '↘ Safe'}</span>
                                            </div>
                                        </div>
                                    </div>

                                    <div className='safety-col'>
                                        <div className='safety-head'>
                                            <span>Over 3 Outlier Safety (Digits 0, 1, 2 must be &lt; 10% &amp; not increasing)</span>
                                            <span className={`safety-status-pill ${analysis.macro.outliersOver3Safe ? 'safe' : 'warn'}`}>
                                                {analysis.macro.outliersOver3Safe ? '✅ SAFE FOR OVER 3' : '⚠️ OUTLIER RISK'}
                                            </span>
                                        </div>
                                        <div className='outlier-chips-row'>
                                            <div className={`outlier-chip ${analysis.macro.outlier0Pct < 10 && !analysis.macro.outlier0Increasing ? 'good' : 'bad'}`}>
                                                <span className='name'>Digit 0</span>
                                                <strong>{analysis.macro.outlier0Pct.toFixed(1)}%</strong>
                                                <span className='trend'>{analysis.macro.outlier0Increasing ? '↗ Rising' : '↘ Safe'}</span>
                                            </div>
                                            <div className={`outlier-chip ${analysis.macro.outlier1Pct < 10 && !analysis.macro.outlier1Increasing ? 'good' : 'bad'}`}>
                                                <span className='name'>Digit 1</span>
                                                <strong>{analysis.macro.outlier1Pct.toFixed(1)}%</strong>
                                                <span className='trend'>{analysis.macro.outlier1Increasing ? '↗ Rising' : '↘ Safe'}</span>
                                            </div>
                                            <div className={`outlier-chip ${analysis.macro.outlier2Pct < 10 && !analysis.macro.outlier2Increasing ? 'good' : 'bad'}`}>
                                                <span className='name'>Digit 2</span>
                                                <strong>{analysis.macro.outlier2Pct.toFixed(1)}%</strong>
                                                <span className='trend'>{analysis.macro.outlier2Increasing ? '↗ Rising' : '↘ Safe'}</span>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* ── Card 1: Statistical Analysis of Under (0-4) vs Over (5-9) ── */}
                            <div className='ep-glass ep-stats-card'>
                                <div className='ep-stats-card__header'>
                                    <div className='title-group'>
                                        <span className='title'>Statistical Analysis 1: Under (0–4) vs Over (5–9)</span>
                                        <span className='sample-count'>(50 Ticks Window &bull; Threshold &gt; 55% &amp; Momentum Direction)</span>
                                    </div>
                                    <span className={`ep-bias-badge ep-bias-badge--${analysis.mid.pctUnder04 >= 55 ? 'under' : analysis.mid.pctOver59 >= 55 ? 'over' : 'neutral'}`}>
                                        {analysis.mid.pctUnder04 >= 55
                                            ? `UNDER 0-4 DOMINANT (${analysis.mid.pctUnder04.toFixed(1)}%)`
                                            : analysis.mid.pctOver59 >= 55
                                              ? `OVER 5-9 DOMINANT (${analysis.mid.pctOver59.toFixed(1)}%)`
                                              : 'BALANCED'}
                                    </span>
                                </div>

                                <div className='ep-ratio-block'>
                                    <div className='ep-ratio-block__head'>
                                        <div className='side side--under'>
                                            <span className='tag'>Under (0–4)</span>
                                            <strong>{analysis.mid.under04} Ticks ({analysis.mid.pctUnder04.toFixed(1)}%)</strong>
                                        </div>
                                        <span className='vs'>VS</span>
                                        <div className='side side--over'>
                                            <span className='tag'>Over (5–9)</span>
                                            <strong>{analysis.mid.over59} Ticks ({analysis.mid.pctOver59.toFixed(1)}%)</strong>
                                        </div>
                                    </div>
                                    <div className='ep-progress-track'>
                                        <div className='ep-progress-bar ep-progress-bar--under' style={{ width: `${analysis.mid.pctUnder04}%` }} />
                                        <div className='ep-progress-bar ep-progress-bar--over' style={{ width: `${analysis.mid.pctOver59}%` }} />
                                    </div>
                                    <div className='ep-ratio-momentum'>
                                        {analysis.mid.pctUnder04 >= 55 && (
                                            <span className='tip tip--green'>
                                                ⚡ Under 0–4 threshold is above 55% ({analysis.mid.pctUnder04.toFixed(1)}%) &amp; Under 0–5 momentum is {analysis.mid.under05Increasing ? 'INCREASING ↗' : 'steady'}
                                            </span>
                                        )}
                                        {analysis.mid.pctOver59 >= 55 && (
                                            <span className='tip tip--orange'>
                                                ⚡ Over 5–9 threshold is above 55% ({analysis.mid.pctOver59.toFixed(1)}%) &amp; Over 4–9 momentum is {analysis.mid.over49Increasing ? 'INCREASING ↗' : 'steady'}
                                            </span>
                                        )}
                                        {analysis.mid.pctUnder04 < 55 && analysis.mid.pctOver59 < 55 && (
                                            <span className='tip tip--neutral'>⚖️ Ratios consolidating in range (&lt; 55% threshold)</span>
                                        )}
                                    </div>
                                </div>
                            </div>

                            {/* ── Card 2: Statistical Analysis of Under (0-5) vs Over (4-9) ── */}
                            <div className='ep-glass ep-stats-card'>
                                <div className='ep-stats-card__header'>
                                    <div className='title-group'>
                                        <span className='title'>Statistical Analysis 2: Under (0–5) vs Over (4–9)</span>
                                        <span className='sample-count'>(50 Ticks Dominance e.g. 34 vs 25 &bull; Last 10-Tick 7/10 Micro Rule)</span>
                                    </div>
                                    <span className={`ep-bias-badge ep-bias-badge--${analysis.bias}`}>
                                        {analysis.mid.under05 >= analysis.mid.over49 ? '🛡️ UNDER 6 FAVOR' : '🚀 OVER 3 FAVOR'}
                                    </span>
                                </div>

                                <div className='ep-ratio-block'>
                                    <div className='ep-ratio-block__head'>
                                        <div className='side side--under'>
                                            <span className='tag'>Under (0–5)</span>
                                            <strong>{analysis.mid.under05} Ticks ({analysis.mid.pctUnder05.toFixed(1)}%)</strong>
                                        </div>
                                        <span className='vs'>VS</span>
                                        <div className='side side--over'>
                                            <span className='tag'>Over (4–9)</span>
                                            <strong>{analysis.mid.over49} Ticks ({analysis.mid.pctOver49.toFixed(1)}%)</strong>
                                        </div>
                                    </div>
                                    <div className='ep-progress-track'>
                                        <div
                                            className='ep-progress-bar ep-progress-bar--under'
                                            style={{ width: `${(analysis.mid.under05 / ((analysis.mid.under05 + analysis.mid.over49) || 1)) * 100}%` }}
                                        />
                                        <div
                                            className='ep-progress-bar ep-progress-bar--over'
                                            style={{ width: `${(analysis.mid.over49 / ((analysis.mid.under05 + analysis.mid.over49) || 1)) * 100}%` }}
                                        />
                                    </div>

                                    <div className='ep-micro-ratios-row'>
                                        <div className='micro-chip'>
                                            <label>Last 10 Ticks Micro Ratio (7/10 Rule):</label>
                                            <strong className={analysis.micro.last10UnderCount >= 7 ? 'text-green' : analysis.micro.last10OverCount >= 7 ? 'text-orange' : ''}>
                                                {analysis.micro.last10UnderCount} Under (0-5) vs {analysis.micro.last10OverCount} Over (4-9)
                                                {analysis.micro.last10UnderCount >= 7 ? ' (✅ Under 7/10 Rule Met)' : analysis.micro.last10OverCount >= 7 ? ' (✅ Over 7/10 Rule Met)' : ''}
                                            </strong>
                                        </div>
                                        <div className='micro-chip'>
                                            <label>Momentum Direction (Under 0-5 / Over 4-9):</label>
                                            <strong>
                                                U0-5: {analysis.mid.under05Increasing ? '↗ Increasing' : '↘ Steady'} | O4-9: {analysis.mid.over49Increasing ? '↗ Increasing' : '↘ Steady'}
                                            </strong>
                                        </div>
                                    </div>

                                    <div className='ep-market-tendency-note'>
                                        {analysis.mid.under05 > analysis.mid.over49 ? (
                                            <span className='note note--under'>
                                                🔥 Market tends to be <strong>POWERFUL IN UNDER</strong> ({analysis.mid.under05} Under 0-5 vs {analysis.mid.over49} Over 4-9).
                                            </span>
                                        ) : analysis.mid.over49 > analysis.mid.under05 ? (
                                            <span className='note note--over'>
                                                🔥 Market tends to be <strong>POWERFUL IN OVER</strong> ({analysis.mid.over49} Over 4-9 vs {analysis.mid.under05} Under 0-5).
                                            </span>
                                        ) : (
                                            <span className='note note--neutral'>
                                                ℹ️ Neutral equilibrium ({analysis.mid.under05} Under vs {analysis.mid.over49} Over).
                                            </span>
                                        )}
                                    </div>
                                </div>
                            </div>

                            {/* ── Card 3: 15-Tick Rolling Stability Cycle Monitor ── */}
                            <div className='ep-glass ep-cycle-monitor-card'>
                                <div className='card-head'>
                                    <div className='title-wrap'>
                                        <RotateCcw size={18} className='text-purple' />
                                        <h4>15-Tick Rolling Stability Cycle &amp; Shift Monitor</h4>
                                    </div>
                                    <span className={`cycle-status-pill cycle-status-pill--${analysis.cycle.stabilityStatus.toLowerCase()}`}>
                                        {analysis.cycle.stabilityStatus === 'STABLE_UNDER' && '🛡️ STABLE UNDER CYCLE'}
                                        {analysis.cycle.stabilityStatus === 'STABLE_OVER' && '🚀 STABLE OVER CYCLE'}
                                        {analysis.cycle.stabilityStatus === 'SHIFTING' && '⚠️ REGIME SHIFT DETECTED (AUTO-PAUSED)'}
                                        {analysis.cycle.stabilityStatus === 'NEUTRAL' && '⚖️ CYCLE CONSOLIDATING'}
                                    </span>
                                </div>

                                <div className='cycle-body'>
                                    <div className='cycle-stat'>
                                        <span className='label'>Last 15 Ticks Distribution:</span>
                                        <strong>{analysis.cycle.cycleUnder05} Under (0-5) / {analysis.cycle.cycleOver49} Over (4-9)</strong>
                                    </div>
                                    <div className='cycle-note'>
                                        {analysis.cycle.isRegimeShiftUnder && (
                                            <span className='text-orange'>
                                                Market shifted momentum towards Over ({analysis.cycle.cycleOver49}/15 Over). System auto-pauses Under execution to prevent counter-trend loss.
                                            </span>
                                        )}
                                        {analysis.cycle.isRegimeShiftOver && (
                                            <span className='text-orange'>
                                                Market shifted momentum towards Under ({analysis.cycle.cycleUnder05}/15 Under). System auto-pauses Over execution to prevent counter-trend loss.
                                            </span>
                                        )}
                                        {!analysis.cycle.isRegimeShiftUnder && !analysis.cycle.isRegimeShiftOver && (
                                            <span className='text-green'>
                                                Cycle is stable with favored direction. Re-evaluates continuously every tick.
                                            </span>
                                        )}
                                    </div>
                                </div>
                            </div>

                            {/* ── Card 4: Highest Entry Trigger Digit Glowing Orb Card ── */}
                            <div className='ep-glass ep-entry-digit-glow-card'>
                                <div className='card-head'>
                                    <div className='title-wrap'>
                                        <Target size={18} className='text-purple' />
                                        <h4>Highest Entry Trigger Digits (Patient Execution Triggers)</h4>
                                    </div>
                                    <span className='info-tag'>Auto-Glows When Entry Digit Appears on Live Tick</span>
                                </div>

                                <div className='ep-entry-digits-grid'>
                                    {/* Highest Under Digit */}
                                    <div className={`ep-glowing-entry-box ep-glowing-entry-box--under ${isUnderTriggerGlowing ? 'glowing-live' : ''}`}>
                                        <div className='box-top'>
                                            <span className='box-title'>Highest Entry Digit in Under</span>
                                            <span className='range-badge'>Range 0 – 5</span>
                                        </div>
                                        <div className='orb-container'>
                                            <div className='glowing-orb under'>
                                                <span className='digit-num'>{analysis.mid.highestUnderDigit}</span>
                                            </div>
                                            {isUnderTriggerGlowing && (
                                                <span className='live-trigger-badge'>⚡ LIVE TICK MATCH (TRIGGER READY)</span>
                                            )}
                                        </div>
                                        <div className='box-meta'>
                                            <span>Frequency: <strong>{analysis.mid.highestUnderCount} times</strong> ({analysis.mid.highestUnderPct.toFixed(0)}%) in 50 ticks</span>
                                        </div>
                                    </div>

                                    {/* Highest Over Digit */}
                                    <div className={`ep-glowing-entry-box ep-glowing-entry-box--over ${isOverTriggerGlowing ? 'glowing-live' : ''}`}>
                                        <div className='box-top'>
                                            <span className='box-title'>Highest Entry Digit in Over</span>
                                            <span className='range-badge'>Range 4 – 9</span>
                                        </div>
                                        <div className='orb-container'>
                                            <div className='glowing-orb over'>
                                                <span className='digit-num'>{analysis.mid.highestOverDigit}</span>
                                            </div>
                                            {isOverTriggerGlowing && (
                                                <span className='live-trigger-badge'>⚡ LIVE TICK MATCH (TRIGGER READY)</span>
                                            )}
                                        </div>
                                        <div className='box-meta'>
                                            <span>Frequency: <strong>{analysis.mid.highestOverCount} times</strong> ({analysis.mid.highestOverPct.toFixed(0)}%) in 50 ticks</span>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* ── Card 5: Systematic Strategy Verification Checklist HUD ── */}
                            {activeSignal && (
                                <div className='ep-glass ep-checklist-hud-card'>
                                    <div className='card-head'>
                                        <div className='title-wrap'>
                                            <Activity size={18} className='text-purple' />
                                            <h4>Systematic Condition Checklist HUD ({activeSignal.direction} {activeSignal.prediction})</h4>
                                        </div>
                                        <span className={`signal-state-pill ${activeSignal.status === 'TRIGGERED' ? 'triggered' : activeSignal.isAutoPaused ? 'paused' : 'waiting'}`}>
                                            {activeSignal.status === 'TRIGGERED'
                                                ? '🎯 ALL CONDITIONS MET — FIRING'
                                                : activeSignal.isAutoPaused
                                                  ? '⏸ AUTO-PAUSED'
                                                  : '⏳ WAITING CONDITIONS'}
                                        </span>
                                    </div>

                                    <div className='ep-checklist-grid'>
                                        <div className={`check-item ${activeSignal.conditions.macroCondition ? 'pass' : 'fail'}`}>
                                            <div className='check-icon'>{activeSignal.conditions.macroCondition ? '✅' : '⏳'}</div>
                                            <div className='check-info'>
                                                <span className='name'>Condition 0: 1,000-Tick Macro Alignment</span>
                                                <span className='desc'>Top digits in zone &amp; outliers &lt; 10% non-increasing</span>
                                            </div>
                                        </div>

                                        <div className={`check-item ${activeSignal.conditions.stat1Condition ? 'pass' : 'fail'}`}>
                                            <div className='check-icon'>{activeSignal.conditions.stat1Condition ? '✅' : '⏳'}</div>
                                            <div className='check-info'>
                                                <span className='name'>Condition 1: Stat Analysis 1 (&ge;55% Threshold)</span>
                                                <span className='desc'>Under 0-4 vs Over 5-9 &ge; 55% &amp; momentum increasing</span>
                                            </div>
                                        </div>

                                        <div className={`check-item ${activeSignal.conditions.stat2Condition ? 'pass' : 'fail'}`}>
                                            <div className='check-icon'>{activeSignal.conditions.stat2Condition ? '✅' : '⏳'}</div>
                                            <div className='check-info'>
                                                <span className='name'>Condition 2: Stat Analysis 2 (50-Tick Dominance)</span>
                                                <span className='desc'>Favored side dominant (e.g. 34 vs 25) in 50 ticks</span>
                                            </div>
                                        </div>

                                        <div className={`check-item ${activeSignal.conditions.micro10Condition ? 'pass' : 'fail'}`}>
                                            <div className='check-icon'>{activeSignal.conditions.micro10Condition ? '✅' : '⏳'}</div>
                                            <div className='check-info'>
                                                <span className='name'>Condition 3: Micro 10-Tick 7/10 Ratio Rule</span>
                                                <span className='desc'>Last 10 ticks has &ge; 7 in favored direction &amp; &le; 3 opposite</span>
                                            </div>
                                        </div>

                                        <div className={`check-item ${activeSignal.conditions.cycleCondition ? 'pass' : 'fail'}`}>
                                            <div className='check-icon'>{activeSignal.conditions.cycleCondition ? '✅' : '⏳'}</div>
                                            <div className='check-info'>
                                                <span className='name'>Condition 4: 15-Tick Cycle Stability</span>
                                                <span className='desc'>No regime shift detected (auto-pauses on shift, auto-resumes)</span>
                                            </div>
                                        </div>

                                        <div className={`check-item ${activeSignal.conditions.triggerDigitCondition ? 'pass' : 'fail'}`}>
                                            <div className='check-icon'>{activeSignal.conditions.triggerDigitCondition ? '⚡' : '⏳'}</div>
                                            <div className='check-info'>
                                                <span className='name'>Trigger Condition: Highest Entry Digit Match</span>
                                                <span className='desc'>Live tick matches highest dominant entry digit [{activeSignal.triggerDigit}]</span>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>
                    )}

                    {/* ── Automated Trading Control Panel ── */}
                    <div className='ep-glass ep-auto-panel'>
                        <div className='ep-auto-panel__header'>
                            <div className='title-wrap'>
                                <span className='icon'>🤖</span>
                                <h3>Automated Trading Strategy Engine</h3>
                            </div>

                            {activeSignal && (
                                <span className={`ep-signal-active-pill ${activeSignal.status === 'TRIGGERED' ? 'ep-signal-active-pill--triggered' : ''}`}>
                                    {activeSignal.status === 'TRIGGERED' ? '🎯 TRIGGERED' : '⏳ WAITING'}: {activeSignal.direction} {activeSignal.prediction} (Digit [
                                    {activeSignal.triggerDigit}])
                                </span>
                            )}
                        </div>

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
                                <span className='label'>Auto-Switch on Bad Market</span>
                                <select
                                    value={autoSwitchMarkets ? 'true' : 'false'}
                                    onChange={e => setAutoSwitchMarkets(e.target.value === 'true')}
                                    disabled={autoState !== 'IDLE'}
                                >
                                    <option value='true'>Enabled (Rotate on Bad Market/No Pattern)</option>
                                    <option value='false'>Disabled (Lock Current Market Only)</option>
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
                                    <Play size={18} /> START AUTOMATED BOT
                                </button>
                            )}

                            {(autoState === 'SCANNING' ||
                                autoState === 'WAITING_TRIGGER' ||
                                autoState === 'TRADING') && (
                                <>
                                    <button className='ep-action-btn ep-action-btn--pause' onClick={pauseAutoTrading}>
                                        <Pause size={16} /> PAUSE ENGINE
                                    </button>
                                    <button
                                        className='ep-action-btn ep-action-btn--stop'
                                        data-testid='elite_pro_toggle'
                                        onClick={stopAutoTrading}
                                    >
                                        <Square size={16} /> STOP ENGINE
                                    </button>
                                </>
                            )}

                            {autoState === 'PAUSED' && (
                                <>
                                    <button className='ep-action-btn ep-action-btn--start' onClick={resumeAutoTrading}>
                                        <Play size={16} /> RESUME ENGINE
                                    </button>
                                    <button
                                        className='ep-action-btn ep-action-btn--stop'
                                        data-testid='elite_pro_toggle'
                                        onClick={stopAutoTrading}
                                    >
                                        <Square size={16} /> STOP ENGINE
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
                                <span className='pnl-label'>ACTIVE STAKE (MG {martingale}x)</span>
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
                                Bot is idle. Start the bot to begin live automated scanning, trigger detection, and trade execution.
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
                targetAmount={milestone.type === 'tp' ? parseFloat(takeProfit) || 10 : parseFloat(stopLoss) || 25}
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

            <AiLearningHubModal
                isOpen={isAiLearningHubOpen}
                onClose={() => setIsAiLearningHubOpen(false)}
            />
        </div>
    );
});

export { ElitePro };
export default ElitePro;
