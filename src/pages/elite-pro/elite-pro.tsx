import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { generateOAuthURL, TradingMilestoneModal } from '@/components/shared';
import { api_base } from '@/external/bot-skeleton';
import { observer as globalObserver } from '@/external/bot-skeleton/utils/observer';
import { useStore } from '@/hooks/useStore';
import { SUPPORTED_VOLATILITY_MARKETS } from '@/utils/digit-strategy';
import { isLoggedIn } from '@/utils/token-bridge';
import { buyContractForUi, streamContractUntilSettled } from '@/utils/trade-purchase';
import { subscribeTicks } from '@/utils/websocket-handler';
import { aiContinuousLearningService } from '@/services/ai-continuous-learning.service';
import { AiLearningHubModal } from '@/components/ai-learning-hub/ai-learning-hub-modal';
import {
    LayoutGrid,
    Pause,
    Play,
    Square,
    Target,
} from 'lucide-react';
import './elite-pro.scss';

// ─── Types ─────────────────────────────────────────────────────────────────────

type MarketDigitData = {
    symbol: string;
    label: string;
    digits: number[];
    currentPrice: string;
    lastDigit: number;
    tickCount: number;
    lastTickTime: number;
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

// ─── Constants ─────────────────────────────────────────────────────────────────

const MARKETS = SUPPORTED_VOLATILITY_MARKETS.map(m => ({
    symbol: m.symbol,
    label: m.label.replace('Volatility ', 'Vol ').replace(' Index', ''),
}));

const MAX_DIGITS = 100;
const CHART_DIGITS = 50;
const ANALYSIS_WINDOW = 50;

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
    const { client } = store;
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

    // ── Comprehensive Multi-Horizon Statistical Analyzer ──
    const computeAnalysis = useCallback((digits: number[]) => {
        const slice = digits.slice(-ANALYSIS_WINDOW);
        const total = slice.length || 1;

        // Ratio 1: Under (0-4) vs Over (5-9)
        const under04 = slice.filter(d => d >= 0 && d <= 4).length;
        const over59 = slice.filter(d => d >= 5 && d <= 9).length;
        const pctUnder04 = (under04 / total) * 100;
        const pctOver59 = (over59 / total) * 100;

        // Ratio 2: Under (0-5) vs Over (4-9)
        const under05 = slice.filter(d => d >= 0 && d <= 5).length;
        const over49 = slice.filter(d => d >= 4 && d <= 9).length;
        const pctUnder05 = (under05 / total) * 100;
        const pctOver49 = (over49 / total) * 100;

        // Trend momentum: First 25 vs Second 25
        const firstHalf = slice.slice(0, Math.floor(total / 2));
        const secondHalf = slice.slice(Math.floor(total / 2));
        const firstHalfUnder04 = firstHalf.filter(d => d >= 0 && d <= 4).length / (firstHalf.length || 1);
        const secondHalfUnder04 = secondHalf.filter(d => d >= 0 && d <= 4).length / (secondHalf.length || 1);
        const underIncreasing = secondHalfUnder04 >= firstHalfUnder04;
        const overIncreasing = !underIncreasing;

        // Frequency table for all 10 digits (0..9)
        const freq = new Array(10).fill(0);
        slice.forEach(d => {
            if (d >= 0 && d <= 9) freq[d]++;
        });

        // Highest Entry Digit in Under (0-5)
        let maxUnderCount = -1;
        let highestUnderDigit = 0;
        freq.slice(0, 6).forEach((c, idx) => {
            if (c > maxUnderCount) {
                maxUnderCount = c;
                highestUnderDigit = idx;
            }
        });
        const highestUnderPct = (maxUnderCount / total) * 100;

        // Highest Entry Digit in Over (4-9)
        let maxOverCount = -1;
        let highestOverDigit = 4;
        freq.slice(4, 10).forEach((c, idx) => {
            if (c > maxOverCount) {
                maxOverCount = c;
                highestOverDigit = idx + 4;
            }
        });
        const highestOverPct = (maxOverCount / total) * 100;

        // Micro Windows: Last 15, Last 10, and Last 7 ticks
        const last15 = slice.slice(-15);
        const last15UnderCount = last15.filter(d => d <= 5).length;
        const last15OverCount = last15.filter(d => d >= 4).length;

        const last10 = slice.slice(-10);
        const last10UnderCount = last10.filter(d => d <= 5).length;
        const last10OverCount = last10.filter(d => d >= 4).length;

        const last7 = slice.slice(-7);
        const last7UnderCount = last7.filter(d => d <= 5).length;
        const last7OverCount = last7.filter(d => d >= 4).length;

        // Market Bias
        let bias: 'under' | 'over' | 'neutral' = 'neutral';
        if ((pctUnder05 >= 58 || (pctUnder04 >= 55 && underIncreasing)) && under05 > over49) {
            bias = 'under';
        } else if ((pctOver49 >= 58 || (pctOver59 >= 55 && overIncreasing)) && over49 > under05) {
            bias = 'over';
        }

        // Composite Quality Score (0 - 100)
        let qualityScore = 0;
        const maxDominance = Math.max(pctUnder05, pctOver49);
        qualityScore += Math.min(40, (maxDominance / 70) * 40);
        const microCount = bias === 'under' ? last10UnderCount : last10OverCount;
        qualityScore += (microCount / 10) * 35; // 35 pts from 10-tick micro dominance
        const maxDigitPct = Math.max(highestUnderPct, highestOverPct);
        qualityScore += Math.min(15, (maxDigitPct / 25) * 15);
        if (bias !== 'neutral') qualityScore += 10;
        qualityScore = Math.min(100, Math.round(qualityScore));

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
            last15UnderCount,
            last15OverCount,
            last10UnderCount,
            last10OverCount,
            last7UnderCount,
            last7OverCount,
            underIncreasing,
            overIncreasing,
            qualityScore,
            total,
        };
    }, []);

    // ── High-Precision Entry Signal Engine (Patience & Digit Triggers) ──
    const checkEntrySignal = useCallback(
        (
            digits: number[],
            forcedStrategy?: 'UNDER_6' | 'OVER_3' | 'AUTO'
        ): {
            direction: 'UNDER' | 'OVER';
            prediction: number;
            triggerDigit: number;
            reason: string;
            status: 'WAITING' | 'TRIGGERED';
            isAutoPaused?: boolean;
            qualityScore: number;
        } | null => {
            if (digits.length < 15) return null;
            const a = computeAnalysis(digits);
            const currentLastDigit = digits[digits.length - 1];
            const prevDigit = digits.length >= 2 ? digits[digits.length - 2] : null;

            // Determine active direction
            let activeStrat: 'UNDER_6' | 'OVER_3';
            if (forcedStrategy && forcedStrategy !== 'AUTO') {
                activeStrat = forcedStrategy;
            } else if (targetStrategyRef.current !== 'AUTO') {
                activeStrat = targetStrategyRef.current;
            } else {
                activeStrat = a.under05 >= a.over49 ? 'UNDER_6' : 'OVER_3';
            }

            if (activeStrat === 'UNDER_6') {
                // Strict Conditions for Under 6:
                // 1. Under 0-4 vs Over 5-9 is >= 55% & increasing OR 50-tick Under 0-5 >= 58%
                // 2. 50-tick Under 0-5 count is dominant over Over 4-9 (e.g. 34 Under vs 25 Over)
                // 3. Last 10 ticks >= 7 under AND Last 7 ticks >= 5 under
                const isMacroDominant = (a.pctUnder04 >= 55 && a.underIncreasing) || a.pctUnder05 >= 56;
                const is50TicksDominant = a.under05 > a.over49 && a.under05 >= 27;
                const isMicroDominant = a.last10UnderCount >= 7 && a.last7UnderCount >= 4;

                const isConditionMet = isMacroDominant && is50TicksDominant && isMicroDominant;

                // Patient Entry Digit Trigger:
                // Trigger A: Current digit matches the highest frequency Under entry digit
                const isPeakDigitMatch = currentLastDigit === a.highestUnderDigit;
                // Trigger B: Snapback from brief pullback (prev digit >= 6, current digit <= 2)
                const isSnapback = prevDigit !== null && prevDigit >= 6 && currentLastDigit <= 2;
                // Trigger C: Extreme momentum (last 10 >= 8 under and current digit <= 3)
                const isCoreMomentum = a.last10UnderCount >= 8 && currentLastDigit <= 3;

                const isTriggered = isConditionMet && (isPeakDigitMatch || isSnapback || isCoreMomentum);

                return {
                    direction: 'UNDER',
                    prediction: 6,
                    triggerDigit: a.highestUnderDigit,
                    reason: isConditionMet
                        ? isTriggered
                            ? `🎯 UNDER 6 Trigger! Digit [${currentLastDigit}] matched entry digit [${a.highestUnderDigit}] (U0-5: ${a.under05} vs O4-9: ${a.over49}, 10t: ${a.last10UnderCount}/10)`
                            : `Waiting for Under Entry Digit [${a.highestUnderDigit}] (Current: ${currentLastDigit}, U0-5: ${a.under05} vs O4-9: ${a.over49}, 10t: ${a.last10UnderCount}/10)`
                        : `Consolidating (U0-5: ${a.under05} vs O4-9: ${a.over49}, 10t: ${a.last10UnderCount}/10). Awaiting >= 55% edge & 7/10 ratio.`,
                    status: isTriggered ? 'TRIGGERED' : 'WAITING',
                    isAutoPaused: !isConditionMet,
                    qualityScore: a.qualityScore,
                };
            } else {
                // Strict Conditions for Over 3:
                // 1. Over 5-9 vs Under 0-4 is >= 55% & increasing OR 50-tick Over 4-9 >= 56%
                // 2. 50-tick Over 4-9 count is dominant over Under 0-5 (e.g. 34 Over vs 25 Under)
                // 3. Last 10 ticks >= 7 over AND Last 7 ticks >= 4 over
                const isMacroDominant = (a.pctOver59 >= 55 && a.overIncreasing) || a.pctOver49 >= 56;
                const is50TicksDominant = a.over49 > a.under05 && a.over49 >= 27;
                const isMicroDominant = a.last10OverCount >= 7 && a.last7OverCount >= 4;

                const isConditionMet = isMacroDominant && is50TicksDominant && isMicroDominant;

                // Patient Entry Digit Trigger:
                const isPeakDigitMatch = currentLastDigit === a.highestOverDigit;
                const isSnapback = prevDigit !== null && prevDigit <= 3 && currentLastDigit >= 7;
                const isCoreMomentum = a.last10OverCount >= 8 && currentLastDigit >= 6;

                const isTriggered = isConditionMet && (isPeakDigitMatch || isSnapback || isCoreMomentum);

                return {
                    direction: 'OVER',
                    prediction: 3,
                    triggerDigit: a.highestOverDigit,
                    reason: isConditionMet
                        ? isTriggered
                            ? `🎯 OVER 3 Trigger! Digit [${currentLastDigit}] matched entry digit [${a.highestOverDigit}] (O4-9: ${a.over49} vs U0-5: ${a.under05}, 10t: ${a.last10OverCount}/10)`
                            : `Waiting for Over Entry Digit [${a.highestOverDigit}] (Current: ${currentLastDigit}, O4-9: ${a.over49} vs U0-5: ${a.under05}, 10t: ${a.last10OverCount}/10)`
                        : `Consolidating (O4-9: ${a.over49} vs U0-5: ${a.under05}, 10t: ${a.last10OverCount}/10). Awaiting >= 55% edge & 7/10 ratio.`,
                    status: isTriggered ? 'TRIGGERED' : 'WAITING',
                    isAutoPaused: !isConditionMet,
                    qualityScore: a.qualityScore,
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
                });
            }
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
                    if (activeMarket.digits.length > MAX_DIGITS) activeMarket.digits.shift();
                    activeMarket.currentPrice = String(quote);
                    activeMarket.lastDigit = digit;
                    activeMarket.tickCount = (activeMarket.tickCount || 0) + 1;
                    activeMarket.lastTickTime = Date.now();
                    throttleRender();
                }
            });

            activeSubs.set(sym, sub);
        });
    }, [scanAll, selectedSymbol, streamRefreshKey, throttleRender]);

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
            bias: 'under' | 'over' | 'neutral';
            under05: number;
            over49: number;
            pctUnder05: number;
            pctOver49: number;
            highestUnderDigit: number;
            highestOverDigit: number;
            hasSignal: boolean;
            isTriggered: boolean;
            signalDirection?: 'UNDER' | 'OVER';
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
                under05: analysis.under05,
                over49: analysis.over49,
                pctUnder05: analysis.pctUnder05,
                pctOver49: analysis.pctOver49,
                highestUnderDigit: analysis.highestUnderDigit,
                highestOverDigit: analysis.highestOverDigit,
                hasSignal: Boolean(signal && !signal.isAutoPaused),
                isTriggered: Boolean(signal && signal.status === 'TRIGGERED'),
                signalDirection: signal?.direction,
            });
        });

        result.sort((a, b) => {
            if (a.isTriggered && !b.isTriggered) return -1;
            if (!a.isTriggered && b.isTriggered) return 1;
            if (a.hasSignal && !b.hasSignal) return -1;
            if (!a.hasSignal && b.hasSignal) return 1;
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

                    // 2. Auto-Input Best Market / Selection
                    let targetSym = selectedSymbolRef.current;
                    if (autoInputBestMarket && currentStakeRef.current <= baseStake) {
                        const liveRanked = getLiveRankedMarkets();
                        const top = liveRanked[0];
                        if (top && top.symbol && top.symbol !== selectedSymbolRef.current) {
                            targetSym = top.symbol;
                            setSelectedSymbol(targetSym);
                            selectedSymbolRef.current = targetSym;
                        }
                    }

                    const currentData = marketsRef.current.get(targetSym);
                    if (!currentData || currentData.digits.length < 15) {
                        if (autoStateRef.current !== 'SCANNING') {
                            setAutoState('SCANNING');
                            autoStateRef.current = 'SCANNING';
                        }
                        await new Promise(r => setTimeout(r, 200));
                        continue;
                    }

                    // 3. Evaluate Signal with Dynamic or Recovery Direction
                    const activeStrat = targetStrategyRef.current;
                    const entrySignal = checkEntrySignal(currentData.digits, activeStrat);

                    // 4. Handle Waiting / Multi-Market Radar Switching
                    if (!entrySignal || entrySignal.status === 'WAITING') {
                        if (autoSwitchMarkets && currentStakeRef.current <= baseStake) {
                            const liveRanked = getLiveRankedMarkets();
                            const readyMarket = liveRanked.find(
                                m => m.symbol !== targetSym && m.isTriggered && m.qualityScore >= 60
                            );

                            if (readyMarket) {
                                setSelectedSymbol(readyMarket.symbol);
                                selectedSymbolRef.current = readyMarket.symbol;
                                targetStrategyRef.current = 'AUTO';
                                setActiveTargetStrategy('AUTO');
                                addLogEntry(
                                    'SMART ROTATION',
                                    readyMarket.label,
                                    'PENDING',
                                    0,
                                    `⚡ Rotated to triggered setup on ${readyMarket.label} (${readyMarket.signalDirection} ${readyMarket.signalDirection === 'UNDER' ? '6' : '3'})`
                                );
                                throttleRender();
                                await new Promise(r => setTimeout(r, 60));
                                continue;
                            }
                        }

                        if (entrySignal && entrySignal.status === 'WAITING' && !entrySignal.isAutoPaused) {
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

                    // 5. Trigger Confirmed: Execute Trade Immediately
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

                        // 6. Intelligent Re-Entry & Recovery Handling
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

                            if (freshAnalysis.pctUnder05 >= 56) {
                                targetStrategyRef.current = 'UNDER_6';
                                setActiveTargetStrategy('UNDER_6');
                            } else if (freshAnalysis.pctOver49 >= 56) {
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
                            await new Promise(r => setTimeout(r, 1500));
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
                        await new Promise(r => setTimeout(r, 400));
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
        activeData && analysis && activeData.lastDigit === analysis.highestUnderDigit
    );
    const isOverTriggerGlowing = Boolean(
        activeData && analysis && activeData.lastDigit === analysis.highestOverDigit
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
                                return (
                                    <div
                                        key={m.symbol}
                                        className={`ep-side-market-card ${isSelected ? 'active' : ''} ${m.isTriggered ? 'signal-glowing' : ''}`}
                                        onClick={() => handleManualMarketSelect(m.symbol)}
                                    >
                                        <div className='ep-side-market-card__top'>
                                            <div className='name-box'>
                                                <span className='label'>{m.label}</span>
                                                {isBest && <span className='best-tag'>TOP</span>}
                                                {m.hasSignal && (
                                                    <span className={`signal-tag signal-tag--${m.signalDirection?.toLowerCase()}`}>
                                                        {m.signalDirection} {m.signalDirection === 'UNDER' ? '6' : '3'}
                                                    </span>
                                                )}
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
                                <span className='ep-title-sub'>High-Precision Digit Scanner, Neural Triggers &amp; Automated Over/Under Engine</span>
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
                                            <span>Score: {m.qualityScore}</span>
                                        </div>
                                    </div>
                                ))}
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

                    {/* ── 3. Statistical Analysis Cards & Glowing Entry Digit ── */}
                    {analysis && (
                        <div className='ep-stats-stack'>
                            {/* Card A: Statistical Analysis of Under (0-4) vs Over (5-9) */}
                            <div className='ep-glass ep-stats-card'>
                                <div className='ep-stats-card__header'>
                                    <div className='title-group'>
                                        <span className='title'>Statistical Analysis 1: Under (0–4) vs Over (5–9)</span>
                                        <span className='sample-count'>(50 Ticks Window &bull; Trend Acceleration)</span>
                                    </div>
                                    <span className={`ep-bias-badge ep-bias-badge--${analysis.pctUnder04 >= 55 ? 'under' : analysis.pctOver59 >= 55 ? 'over' : 'neutral'}`}>
                                        {analysis.pctUnder04 >= 55
                                            ? `UNDER 0-4 DOMINANT (${analysis.pctUnder04.toFixed(1)}%)`
                                            : analysis.pctOver59 >= 55
                                              ? `OVER 5-9 DOMINANT (${analysis.pctOver59.toFixed(1)}%)`
                                              : 'BALANCED'}
                                    </span>
                                </div>

                                <div className='ep-ratio-block'>
                                    <div className='ep-ratio-block__head'>
                                        <div className='side side--under'>
                                            <span className='tag'>Under (0–4)</span>
                                            <strong>{analysis.under04} Ticks ({analysis.pctUnder04.toFixed(1)}%)</strong>
                                        </div>
                                        <span className='vs'>VS</span>
                                        <div className='side side--over'>
                                            <span className='tag'>Over (5–9)</span>
                                            <strong>{analysis.over59} Ticks ({analysis.pctOver59.toFixed(1)}%)</strong>
                                        </div>
                                    </div>
                                    <div className='ep-progress-track'>
                                        <div className='ep-progress-bar ep-progress-bar--under' style={{ width: `${analysis.pctUnder04}%` }} />
                                        <div className='ep-progress-bar ep-progress-bar--over' style={{ width: `${analysis.pctOver59}%` }} />
                                    </div>
                                    <div className='ep-ratio-momentum'>
                                        {analysis.pctUnder04 >= 55 && (
                                            <span className='tip tip--green'>
                                                ⚡ Under 0-4 threshold is above 55% ({analysis.pctUnder04.toFixed(1)}%) {analysis.underIncreasing ? 'and INCREASING ↗' : 'steady'}
                                            </span>
                                        )}
                                        {analysis.pctOver59 >= 55 && (
                                            <span className='tip tip--orange'>
                                                ⚡ Over 5-9 threshold is above 55% ({analysis.pctOver59.toFixed(1)}%) {analysis.overIncreasing ? 'and INCREASING ↗' : 'steady'}
                                            </span>
                                        )}
                                        {analysis.pctUnder04 < 55 && analysis.pctOver59 < 55 && (
                                            <span className='tip tip--neutral'>⚖️ Ratios consolidating in range (&lt; 55% threshold)</span>
                                        )}
                                    </div>
                                </div>
                            </div>

                            {/* Card B: Statistical Analysis of Under (0-5) vs Over (4-9) */}
                            <div className='ep-glass ep-stats-card'>
                                <div className='ep-stats-card__header'>
                                    <div className='title-group'>
                                        <span className='title'>Statistical Analysis 2: Under (0–5) vs Over (4–9)</span>
                                        <span className='sample-count'>(50 Ticks Counts &bull; 10-Tick / 7-Tick Micro Windows)</span>
                                    </div>
                                    <span className={`ep-bias-badge ep-bias-badge--${analysis.bias}`}>
                                        {analysis.under05 >= analysis.over49 ? '🛡️ UNDER 6 FAVOR' : '🚀 OVER 3 FAVOR'}
                                    </span>
                                </div>

                                <div className='ep-ratio-block'>
                                    <div className='ep-ratio-block__head'>
                                        <div className='side side--under'>
                                            <span className='tag'>Under (0–5)</span>
                                            <strong>{analysis.under05} Ticks ({analysis.pctUnder05.toFixed(1)}%)</strong>
                                        </div>
                                        <span className='vs'>VS</span>
                                        <div className='side side--over'>
                                            <span className='tag'>Over (4–9)</span>
                                            <strong>{analysis.over49} Ticks ({analysis.pctOver49.toFixed(1)}%)</strong>
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

                                    <div className='ep-micro-ratios-row'>
                                        <div className='micro-chip'>
                                            <label>Last 10 Ticks Micro Ratio:</label>
                                            <strong>{analysis.last10UnderCount} Under (0-5) vs {analysis.last10OverCount} Over (4-9)</strong>
                                        </div>
                                        <div className='micro-chip'>
                                            <label>Last 7 Ticks Favor:</label>
                                            <strong>{analysis.last7UnderCount} Under vs {analysis.last7OverCount} Over</strong>
                                        </div>
                                    </div>

                                    <div className='ep-market-tendency-note'>
                                        {analysis.under05 > analysis.over49 ? (
                                            <span className='note note--under'>
                                                🔥 Market tends to be <strong>POWERFUL IN UNDER</strong> ({analysis.under05} Under 0-5 vs {analysis.over49} Over 4-9).
                                            </span>
                                        ) : analysis.over49 > analysis.under05 ? (
                                            <span className='note note--over'>
                                                🔥 Market tends to be <strong>POWERFUL IN OVER</strong> ({analysis.over49} Over 4-9 vs {analysis.under05} Under 0-5).
                                            </span>
                                        ) : (
                                            <span className='note note--neutral'>
                                                ℹ️ Neutral equilibrium ({analysis.under05} Under vs {analysis.over49} Over).
                                            </span>
                                        )}
                                    </div>
                                </div>
                            </div>

                            {/* Card C: Entry Digit Glowing in the Highest */}
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
                                                <span className='digit-num'>{analysis.highestUnderDigit}</span>
                                            </div>
                                            {isUnderTriggerGlowing && (
                                                <span className='live-trigger-badge'>⚡ LIVE TICK MATCH (TRIGGER READY)</span>
                                            )}
                                        </div>
                                        <div className='box-meta'>
                                            <span>Frequency: <strong>{analysis.highestUnderCount} times</strong> ({analysis.highestUnderPct.toFixed(0)}%) in 50 ticks</span>
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
                                                <span className='digit-num'>{analysis.highestOverDigit}</span>
                                            </div>
                                            {isOverTriggerGlowing && (
                                                <span className='live-trigger-badge'>⚡ LIVE TICK MATCH (TRIGGER READY)</span>
                                            )}
                                        </div>
                                        <div className='box-meta'>
                                            <span>Frequency: <strong>{analysis.highestOverCount} times</strong> ({analysis.highestOverPct.toFixed(0)}%) in 50 ticks</span>
                                        </div>
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
                                <span className='label'>Auto-Switch Markets</span>
                                <select
                                    value={autoSwitchMarkets ? 'true' : 'false'}
                                    onChange={e => setAutoSwitchMarkets(e.target.value === 'true')}
                                    disabled={autoState !== 'IDLE'}
                                >
                                    <option value='true'>Enabled (Auto-Hunt Best Market)</option>
                                    <option value='false'>Disabled (Current Market Only)</option>
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
