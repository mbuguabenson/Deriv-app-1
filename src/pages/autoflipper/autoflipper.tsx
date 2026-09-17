import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { generateOAuthURL, TradingMilestoneModal } from '@/components/shared';
import type { MilestoneType } from '@/components/shared/trading-milestone-modal';
import { observer as globalObserver } from '@/external/bot-skeleton';
import { useStore } from '@/hooks/useStore';
import { SUPPORTED_VOLATILITY_MARKETS } from '@/utils/digit-strategy';
import { isLoggedIn } from '@/utils/token-bridge';
import { buyContractForUi, streamContractUntilSettled } from '@/utils/trade-purchase';
import { subscribeTicks } from '@/utils/websocket-handler';
import { aiContinuousLearningService } from '@/services/ai-continuous-learning.service';
import { AiLearningHubModal } from '@/components/ai-learning-hub/ai-learning-hub-modal';
import {
    Activity,
    AlertCircle,
    Calendar,
    CheckCircle2,
    ChevronLeft,
    ChevronRight,
    Clock,
    FileText,
    Flame,
    Layers,
    Play,
    Pause,
    RefreshCw,
    Shield,
    Sparkles,
    Square,
    Zap,
} from 'lucide-react';
import './autoflipper.scss';

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

export interface CompoundingStage {
    stage: number;
    timeLabel: string;
    targetBalance: number;
    recommendedStake: number;
    stageProfit: number;
    cumulativeProfit: number;
    status: 'DONE' | 'ACTIVE' | 'PENDING';
}

export interface TransactionRecord {
    id: string;
    contractId?: number | string;
    transactionId?: number | string;
    time: string;
    market: string;
    symbol: string;
    contractType: string;
    barrier: string;
    entrySpot?: number | string;
    exitSpot?: number | string;
    stake: number;
    payout: number;
    profit: number;
    result: 'WIN' | 'LOSS' | 'OPEN';
    status: 'open' | 'settled';
}

export interface JournalLogItem {
    id: string;
    time: string;
    type: 'TRADE' | 'STAGE_UNLOCK' | 'GOAL_COMPLETE' | 'SIGNAL' | 'SYSTEM' | 'ERROR';
    title: string;
    description: string;
    level?: 'info' | 'success' | 'warning' | 'error';
    badge?: string;
}

export interface TradeLogItem {
    id: string;
    time: string;
    market: string;
    strategy: 'AUTOFLIP_UNDER' | 'AUTOFLIP_OVER' | 'RECOVERY' | 'TAKE_PROFIT' | 'STOP_LOSS';
    contractType: string;
    prediction: number;
    stake: number;
    result: 'WIN' | 'LOSS' | 'PENDING';
    profit: number;
}

type AutoRunState = 'IDLE' | 'SCANNING' | 'WAITING_SIGNAL' | 'WAITING_TRIGGER' | 'TRADING' | 'PAUSED';
type DurationUnitType = 'HOURS' | 'DAYS' | 'MINUTES';
type TradeDurationUnitType = 't' | 's' | 'm';
type JournalTabType = 'TRANSACTIONS' | 'JOURNAL';

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
        // Silently ignore audio context errors
    }
};

// ─── Modern Bezier Line + Area Spline Chart ────────────────────────────────────

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

const getAreaPath = (points: { x: number; y: number }[], H: number) => {
    if (points.length < 2) return '';
    const linePath = getBezierPath(points);
    const lastPoint = points[points.length - 1];
    const firstPoint = points[0];
    return `${linePath} L ${lastPoint.x.toFixed(1)},${H} L ${firstPoint.x.toFixed(1)},${H} Z`;
};

const DigitLineChart: React.FC<{ digits: number[] }> = ({ digits }) => {
    const slice = digits.slice(-CHART_TICKS);
    if (slice.length < 2) {
        return (
            <div className='af-chart-empty'>
                <div className='af-chart-empty__spinner' />
                <span>Connecting live tick trajectory stream...</span>
            </div>
        );
    }

    const W = Math.max(760, slice.length * 15.5);
    const H = 115;
    const padTop = 16;
    const padBot = 14;
    const usableH = H - padTop - padBot;
    const stepX = (W - 24) / (slice.length - 1);

    const points = slice.map((d, i) => ({
        x: 12 + i * stepX,
        y: padTop + usableH - (d / 9) * usableH,
        d,
    }));

    const pathD = getBezierPath(points);
    const areaD = getAreaPath(points, H);

    return (
        <div className='af-chart-inner-scroll'>
            <svg
                width='100%'
                height={H}
                viewBox={`0 0 ${W} ${H}`}
                preserveAspectRatio='none'
                style={{ display: 'block', minWidth: `${W}px` }}
            >
                <defs>
                    <linearGradient id='afLineGrad' x1='0%' y1='0%' x2='100%' y2='0%'>
                        <stop offset='0%' stopColor='#00f0ff' stopOpacity='0.9' />
                        <stop offset='50%' stopColor='#a855f7' stopOpacity='1' />
                        <stop offset='100%' stopColor='#ffb020' stopOpacity='0.95' />
                    </linearGradient>
                    <linearGradient id='afAreaGrad' x1='0%' y1='0%' x2='0%' y2='100%'>
                        <stop offset='0%' stopColor='#00f0ff' stopOpacity='0.22' />
                        <stop offset='60%' stopColor='#a855f7' stopOpacity='0.08' />
                        <stop offset='100%' stopColor='transparent' stopOpacity='0' />
                    </linearGradient>
                    <filter id='afGlow' x='-20%' y='-20%' width='140%' height='140%'>
                        <feDropShadow dx='0' dy='2' stdDeviation='4' floodColor='#00f0ff' floodOpacity='0.65' />
                    </filter>
                    <filter id='afSpotGlow' x='-40%' y='-40%' width='180%' height='180%'>
                        <feDropShadow dx='0' dy='0' stdDeviation='6' floodColor='#ffffff' floodOpacity='0.9' />
                    </filter>
                </defs>

                {/* Subtle Barrier Zones */}
                {/* Zone Under 6 (0–5): Bottom 60% */}
                <rect
                    x='0'
                    y={padTop + usableH - (5 / 9) * usableH}
                    width={W}
                    height={(5 / 9) * usableH + padBot}
                    fill='rgba(16, 185, 129, 0.035)'
                />
                {/* Zone Over 3 (4–9): Top 60% */}
                <rect
                    x='0'
                    y={0}
                    width={W}
                    height={padTop + usableH - (4 / 9) * usableH}
                    fill='rgba(245, 158, 11, 0.035)'
                />

                {/* Horizontal reference grid lines */}
                {[0, 3, 6, 9].map(level => {
                    const y = padTop + usableH - (level / 9) * usableH;
                    const isKeyBarrier = level === 3 || level === 6;
                    return (
                        <g key={level} className='af-chart-grid-line'>
                            <line
                                x1='0'
                                y1={y}
                                x2={W}
                                y2={y}
                                stroke={isKeyBarrier ? 'rgba(0, 240, 255, 0.22)' : 'rgba(255, 255, 255, 0.07)'}
                                strokeWidth={isKeyBarrier ? '1.2' : '1'}
                                strokeDasharray={isKeyBarrier ? '4 4' : undefined}
                            />
                            <text
                                x='6'
                                y={y - 4}
                                fill={isKeyBarrier ? '#00f0ff' : 'rgba(255, 255, 255, 0.35)'}
                                fontSize='10'
                                fontWeight={isKeyBarrier ? 700 : 400}
                                fontFamily='monospace'
                            >
                                {level} {level === 6 ? '• (UNDER 6 TARGET)' : level === 3 ? '• (OVER 3 TARGET)' : ''}
                            </text>
                        </g>
                    );
                })}

                {/* Area fill */}
                {areaD && <path d={areaD} fill='url(#afAreaGrad)' />}

                {/* Main Bezier Line path */}
                {pathD && (
                    <path
                        d={pathD}
                        fill='none'
                        stroke='url(#afLineGrad)'
                        strokeWidth={2.8}
                        strokeLinejoin='round'
                        strokeLinecap='round'
                        filter='url(#afGlow)'
                    />
                )}

                {/* Dots and condition-colored rectangular badges + bold digit labels */}
                {points.map((p, i) => {
                    const isLatest = i === points.length - 1;
                    const isUnder = p.d <= 4;
                    return (
                        <g key={i} className={`af-chart-point ${isLatest ? 'af-chart-point--latest' : ''}`}>
                            {isLatest && (
                                <circle
                                    cx={p.x}
                                    cy={p.y}
                                    r={14}
                                    fill='rgba(0, 240, 255, 0.25)'
                                    className='af-chart-point__pulse-ring'
                                />
                            )}
                            <rect
                                x={p.x - (isLatest ? 4 : 3)}
                                y={p.y - (isLatest ? 4 : 3)}
                                width={isLatest ? 8 : 6}
                                height={isLatest ? 8 : 6}
                                rx={isLatest ? 2 : 1.5}
                                fill={isLatest ? '#ffffff' : isUnder ? '#10b981' : '#f59e0b'}
                                stroke={isLatest ? '#00f0ff' : '#0e1726'}
                                strokeWidth={isLatest ? 2 : 1}
                                filter={isLatest ? 'url(#afSpotGlow)' : undefined}
                            />
                            <text
                                x={p.x}
                                y={p.y - (isLatest ? 10 : 8)}
                                textAnchor='middle'
                                fill={isLatest ? '#ffffff' : isUnder ? '#10b981' : '#f59e0b'}
                                fontSize={isLatest ? 13 : 11}
                                fontWeight={isLatest ? 900 : 700}
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

const extractLastDigit = (quote: number | string, pip: number = 2): number => {
    if (typeof quote === 'number') {
        quote = quote.toFixed(pip);
    }
    const clean = String(quote).trim();
    const lastChar = clean[clean.length - 1];
    const d = parseInt(lastChar, 10);
    return isNaN(d) ? 0 : d;
};

// ─── Main Autoflipper Component ────────────────────────────────────────────────

const Autoflipper: React.FC = observer(() => {
    const store = useStore();
    const { client } = store || {};
    const currency = client?.currency || 'USD';

    // Active market state
    const [selectedSymbol, setSelectedSymbol] = useState<string>('1HZ10V');
    const [scanAllMarkets, setScanAllMarkets] = useState<boolean>(false);
    const [autoSwitchMarkets, setAutoSwitchMarkets] = useState<boolean>(true);

    // Bot execution controls
    const [botState, setBotState] = useState<AutoRunState>('IDLE');
    const [initialStake, setInitialStake] = useState<string>('1.00');
    const [currentStake, setCurrentStake] = useState<number>(1.0);
    const [martingale, setMartingale] = useState<string>('2.6');
    const [takeProfit, setTakeProfit] = useState<string>('20.00');
    const [stopLoss, setStopLoss] = useState<string>('50.00');

    // Trade Duration Inputs (User customizable)
    const [tradeDurationUnit, setTradeDurationUnit] = useState<TradeDurationUnitType>('t');
    const [tradeDurationValue, setTradeDurationValue] = useState<string>('1');

    // Compounding Plan Engine (Fully Customizable Duration & Figure Inputs)
    const [compDurationUnit, setCompDurationUnit] = useState<DurationUnitType>('HOURS');
    const [compDurationValue, setCompDurationValue] = useState<string>('24');
    const [compStartCapital, setCompStartCapital] = useState<string>('100.00');
    const [compTargetProfit, setCompTargetProfit] = useState<string>('250.00');
    const [compRiskPercent, setCompRiskPercent] = useState<string>('2.0');
    const [compNumStages, setCompNumStages] = useState<string>('8');
    const [compStages, setCompStages] = useState<CompoundingStage[]>([]);
    const [showScheduleTable, setShowScheduleTable] = useState<boolean>(false);
    const [isCompoundingLinked, setIsCompoundingLinked] = useState<boolean>(true);

    // Session Statistics
    const [sessionProfit, setSessionProfit] = useState<number>(0);
    const [winsCount, setWinsCount] = useState<number>(0);
    const [lossesCount, setLossesCount] = useState<number>(0);

    // Live Transactions & Execution Journal
    const [transactions, setTransactions] = useState<TransactionRecord[]>([]);
    const [journalLogs, setJournalLogs] = useState<JournalLogItem[]>([]);
    const [activeJournalTab, setActiveJournalTab] = useState<JournalTabType>('TRANSACTIONS');

    // Modals
    const [milestone, setMilestone] = useState<{ isOpen: boolean; type: MilestoneType }>({
        isOpen: false,
        type: null,
    });
    const [isAiLearningModalOpen, setIsAiLearningModalOpen] = useState<boolean>(false);

    // Re-render trigger
    const [renderTrigger, setRenderTrigger] = useState<number>(0);

    // Refs
    const marketsDataRef = useRef<Map<string, MarketDigitState>>(new Map());
    const subscriptionsRef = useRef<Map<string, { unsubscribe: () => void }>>(new Map());
    const isMountedRef = useRef<boolean>(true);
    const botStateRef = useRef<AutoRunState>('IDLE');
    const isTradingInProgressRef = useRef<boolean>(false);
    const consecutiveLossesRef = useRef<number>(0);
    const marketScrollRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        botStateRef.current = botState;
    }, [botState]);

    // Throttle UI update triggers
    const lastThrottleTimeRef = useRef<number>(0);
    const throttleRender = useCallback(() => {
        const now = Date.now();
        if (now - lastThrottleTimeRef.current > 180) {
            lastThrottleTimeRef.current = now;
            setRenderTrigger(t => t + 1);
        }
    }, []);

    // Horizontal Market Strip Scroll Helper
    const scrollMarkets = (direction: 'left' | 'right') => {
        if (!marketScrollRef.current) return;
        const offset = direction === 'left' ? -260 : 260;
        marketScrollRef.current.scrollBy({ left: offset, behavior: 'smooth' });
    };

    // Initialize market storage
    useEffect(() => {
        isMountedRef.current = true;
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
                });
            }
        });

        // Initialize default compounding stages
        generateCompoundingPlan();
    }, []);

    // ── WebSocket Multiplexed Streaming ────────────────────────────────────────

    useEffect(() => {
        let isCancelled = false;
        const symbolsToStream = scanAllMarkets ? MARKETS.map(m => m.symbol) : [selectedSymbol];

        const startStreaming = async () => {
            for (const sym of symbolsToStream) {
                if (isCancelled || !isMountedRef.current) break;
                if (!subscriptionsRef.current.has(sym)) {
                    const marketCfg = MARKETS.find(m => m.symbol === sym);
                    const pip = marketCfg?.pip || 2;

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

                    subscriptionsRef.current.set(sym, sub);
                    if (scanAllMarkets && symbolsToStream.length > 1) {
                        await new Promise(r => setTimeout(r, 60));
                    }
                }
            }
        };

        void startStreaming();

        return () => {
            isCancelled = true;
        };
    }, [scanAllMarkets, selectedSymbol, throttleRender]);

    // Unmount cleanup
    useEffect(() => {
        return () => {
            isMountedRef.current = false;
            subscriptionsRef.current.forEach(sub => {
                try {
                    sub?.unsubscribe?.();
                } catch {}
            });
            subscriptionsRef.current.clear();
        };
    }, []);

    // ── Current Active Market Data ──
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

    // ── Dual Statistical Models & Flip Recognition ────────────────────────────

    const flipAnalysis = useMemo(() => {
        const last50 = currentMarket.digits.slice(-50);
        const total50 = last50.length || 1;

        // Split 1: Under (0-4) vs Over (5-9)
        const under04 = last50.filter(d => d <= 4).length;
        const over59 = last50.filter(d => d >= 5).length;
        const under04Pct = Math.round((under04 / total50) * 100);
        const over59Pct = Math.round((over59 / total50) * 100);

        // Trend calculation (last 15 vs prev 15)
        const last15 = currentMarket.digits.slice(-15);
        const prev15 = currentMarket.digits.slice(-30, -15);
        const u04_last15 = last15.filter(d => d <= 4).length;
        const u04_prev15 = prev15.filter(d => d <= 4).length;
        const isUnder04Increasing = u04_last15 >= u04_prev15;

        // Split 2: Under (0-5) vs Over (4-9)
        const under05 = last50.filter(d => d <= 5).length;
        const over49 = last50.filter(d => d >= 4).length;
        const under05Pct = Math.round((under05 / total50) * 100);
        const over49Pct = Math.round((over49 / total50) * 100);

        const u05_last15 = last15.filter(d => d <= 5).length;
        const u05_prev15 = prev15.filter(d => d <= 5).length;
        const isUnder05Increasing = u05_last15 >= u05_prev15;

        // Highest Entry Digit in Under (0-5)
        const underCounts = [0, 1, 2, 3, 4, 5].map(digit => ({
            digit,
            count: last50.filter(d => d === digit).length,
        }));
        underCounts.sort((a, b) => b.count - a.count);
        const highestUnderDigit = underCounts[0]?.digit ?? 3;
        const highestUnderDigitPct = Math.round(((underCounts[0]?.count || 0) / total50) * 100);

        // Highest Entry Digit in Over (4-9)
        const overCounts = [4, 5, 6, 7, 8, 9].map(digit => ({
            digit,
            count: last50.filter(d => d === digit).length,
        }));
        overCounts.sort((a, b) => b.count - a.count);
        const highestOverDigit = overCounts[0]?.digit ?? 7;
        const highestOverDigitPct = Math.round(((overCounts[0]?.count || 0) / total50) * 100);

        // Last 10 Ticks Ratio
        const last10 = currentMarket.digits.slice(-10);
        const last10Under = last10.filter(d => d <= 4).length;
        const last10Over = last10.filter(d => d >= 5).length;

        // Current spot
        const currentSpot = last50.length > 0 ? last50[last50.length - 1] : null;

        // Determine Signal Bias
        let activeSignal: 'UNDER' | 'OVER' | 'NEUTRAL' = 'NEUTRAL';
        let isTriggerReady = false;
        let signalReason = '';

        if (under04Pct >= 55 && isUnder04Increasing && under05 > over49 && last10Under >= 7) {
            activeSignal = 'UNDER'; // Will trade Under 6
            isTriggerReady = currentSpot === highestUnderDigit;
            signalReason = `Under dominance (${under04Pct}%), 7/10 recent ticks under. Waiting for [${highestUnderDigit}] trigger.`;
        } else if (over59Pct >= 55 && !isUnder04Increasing && over49 > under05 && last10Over >= 7) {
            activeSignal = 'OVER'; // Will trade Over 3
            isTriggerReady = currentSpot === highestOverDigit;
            signalReason = `Over dominance (${over59Pct}%), 7/10 recent ticks over. Waiting for [${highestOverDigit}] trigger.`;
        } else {
            signalReason = 'Market consolidating. Waiting for clear 55%+ regime trend and 7/10 momentum alignment.';
        }

        return {
            under04,
            over59,
            under04Pct,
            over59Pct,
            isUnder04Increasing,
            under05,
            over49,
            under05Pct,
            over49Pct,
            isUnder05Increasing,
            highestUnderDigit,
            highestUnderDigitPct,
            highestOverDigit,
            highestOverDigitPct,
            last10Under,
            last10Over,
            last10,
            currentSpot,
            activeSignal,
            isTriggerReady,
            signalReason,
        };
    }, [currentMarket.digits]);

    // ── Best Market Auto-Selector ──
    const bestMarketCandidate = useMemo(() => {
        let bestSym = selectedSymbol;
        let maxBias = -1;

        marketsDataRef.current.forEach((val, sym) => {
            const digits = val.digits.slice(-50);
            if (digits.length < 20) return;
            const u04 = digits.filter(d => d <= 4).length;
            const o59 = digits.filter(d => d >= 5).length;
            const bias = Math.max(u04, o59);
            if (bias > maxBias) {
                maxBias = bias;
                bestSym = sym;
            }
        });

        return bestSym;
    }, [renderTrigger, selectedSymbol]);

    // ── Dynamic Compounding Plan Generator ──

    const generateCompoundingPlan = (
        customStartCap?: string,
        customTargetProf?: string,
        customDurVal?: string,
        customDurUnit?: DurationUnitType,
        customRiskPct?: string,
        customStagesCount?: string,
        forceSyncWithEngine: boolean = false
    ) => {
        const startCapital = Number(customStartCap ?? compStartCapital) || 100;
        const targetProf = Number(customTargetProf ?? compTargetProfit) || 250;
        const durVal = Number(customDurVal ?? compDurationValue) || 24;
        const durUnit = customDurUnit ?? compDurationUnit;
        const riskPct = Number(customRiskPct ?? compRiskPercent) || 2.0;
        const numStages = Math.max(2, Math.min(30, Number(customStagesCount ?? compNumStages) || 8));

        const stages: CompoundingStage[] = [];
        const stepProfit = targetProf / numStages;

        let runningBal = startCapital;
        for (let i = 1; i <= numStages; i++) {
            const stageProfit = stepProfit;
            runningBal += stageProfit;
            const recStake = Math.max(0.35, Math.round(runningBal * (riskPct / 100) * 100) / 100);
            const cumProfit = runningBal - startCapital;

            // Generate intelligent time label
            let timeLabel = '';
            if (durUnit === 'HOURS') {
                const hourMarker = (i * (durVal / numStages)).toFixed(1);
                timeLabel = `Hour ${hourMarker}h`;
            } else if (durUnit === 'DAYS') {
                const dayMarker = (i * (durVal / numStages)).toFixed(1);
                timeLabel = `Day ${dayMarker}d`;
            } else {
                const minMarker = Math.round(i * (durVal / numStages));
                timeLabel = `${minMarker} min`;
            }

            stages.push({
                stage: i,
                timeLabel,
                targetBalance: Math.round(runningBal * 100) / 100,
                recommendedStake: recStake,
                stageProfit: Math.round(stageProfit * 100) / 100,
                cumulativeProfit: Math.round(cumProfit * 100) / 100,
                status: sessionProfit >= cumProfit ? 'DONE' : i === 1 || sessionProfit >= (cumProfit - stepProfit) ? 'ACTIVE' : 'PENDING',
            });
        }

        setCompStages(stages);

        if (isCompoundingLinked || forceSyncWithEngine) {
            setTakeProfit(targetProf.toFixed(2));
            const baseStake = stages[0]?.recommendedStake || 1.0;
            setInitialStake(baseStake.toFixed(2));
            if (botStateRef.current === 'IDLE') {
                setCurrentStake(baseStake);
            }
        }
    };

    // Calculate hourly/daily velocity required
    const planVelocityMetrics = useMemo(() => {
        const targetProf = Number(compTargetProfit) || 250;
        const durVal = Number(compDurationValue) || 24;
        let totalHours = 24;
        if (compDurationUnit === 'DAYS') {
            totalHours = Math.max(1, durVal * 24);
        } else if (compDurationUnit === 'MINUTES') {
            totalHours = Math.max(0.1, durVal / 60);
        } else {
            totalHours = Math.max(0.5, durVal);
        }

        const hourlyReq = targetProf / totalHours;
        const dailyReq = hourlyReq * 24;

        return {
            totalHours,
            hourlyReq: hourlyReq.toFixed(2),
            dailyReq: dailyReq.toFixed(2),
        };
    }, [compTargetProfit, compDurationValue, compDurationUnit]);

    // Derived stages with dynamic completion status based on live session profit
    const stagesWithStatus = useMemo(() => {
        return compStages.map((st, idx) => {
            if (sessionProfit >= st.cumulativeProfit) {
                return { ...st, status: 'DONE' as const };
            }
            const prevProfit = idx > 0 ? compStages[idx - 1].cumulativeProfit : 0;
            if (sessionProfit >= prevProfit && sessionProfit < st.cumulativeProfit) {
                return { ...st, status: 'ACTIVE' as const };
            }
            return { ...st, status: 'PENDING' as const };
        });
    }, [compStages, sessionProfit]);

    // Active compounding stage detection
    const activeStageIndex = useMemo(() => {
        if (!compStages.length) return 0;
        const idx = compStages.findIndex(st => sessionProfit < st.cumulativeProfit);
        return idx === -1 ? compStages.length - 1 : idx;
    }, [compStages, sessionProfit]);

    const activeStage = useMemo(() => {
        return (
            stagesWithStatus[activeStageIndex] || {
                stage: 1,
                timeLabel: '1h',
                targetBalance: Number(compStartCapital) || 100,
                recommendedStake: Number(initialStake) || 1.0,
                stageProfit: 30,
                cumulativeProfit: 30,
                status: 'ACTIVE' as const,
            }
        );
    }, [stagesWithStatus, activeStageIndex, compStartCapital, initialStake]);

    // Stage progress calculation
    const activeStageStartProfit = activeStageIndex > 0 ? (stagesWithStatus[activeStageIndex - 1]?.cumulativeProfit ?? 0) : 0;
    const stageRequiredProfit = Math.max(0.01, activeStage.stageProfit);
    const stageCurrentProgress = Math.max(0, Math.min(stageRequiredProfit, sessionProfit - activeStageStartProfit));
    const stageProgressPct = Math.min(100, Math.max(0, Math.round((stageCurrentProgress / stageRequiredProfit) * 100)));
    const isAllStagesComplete =
        stagesWithStatus.length > 0 &&
        sessionProfit >= (stagesWithStatus[stagesWithStatus.length - 1]?.cumulativeProfit ?? 0);

    // Apply Compounding Plan parameters directly to Trade Engine
    const applyCompoundingToEngine = () => {
        setIsCompoundingLinked(true);
        const targetProf = Number(compTargetProfit) || 250;
        setTakeProfit(targetProf.toFixed(2));
        const baseStake = activeStage.recommendedStake || compStages[0]?.recommendedStake || Number(initialStake) || 1.0;
        setInitialStake(baseStake.toFixed(2));
        if (botState === 'IDLE') {
            setCurrentStake(baseStake);
        }
        setJournalLogs(prev => [
            {
                id: String(Date.now()),
                time: new Date().toLocaleTimeString(),
                type: 'SYSTEM',
                title: 'Compounding Parameters Synchronized',
                description: `Linked Base Stake: $${baseStake.toFixed(2)} | Target Goal: +$${targetProf.toFixed(2)} (${compStages.length} Stages)`,
                level: 'info',
            },
            ...prev,
        ]);
    };

    // Quick Duration Presets Handler
    const applyDurationPreset = (value: string, unit: DurationUnitType) => {
        setCompDurationValue(value);
        setCompDurationUnit(unit);
        generateCompoundingPlan(compStartCapital, compTargetProfit, value, unit, compRiskPercent, compNumStages);
    };

    // ── Trade Execution Logic ──────────────────────────────────────────────────

    const executeTrade = useCallback(
        async (tradeSignal: 'UNDER' | 'OVER') => {
            if (isTradingInProgressRef.current) return;
            isTradingInProgressRef.current = true;
            setBotState('TRADING');

            const barrier = tradeSignal === 'UNDER' ? '6' : '3';
            const contractType = tradeSignal === 'UNDER' ? 'DIGITUNDER' : 'DIGITOVER';
            const stakeToUse = currentStake;
            const sym = selectedSymbol;
            const tempTxnId = String(Date.now());
            const marketLabel = MARKETS.find(m => m.symbol === sym)?.label || sym;
            const timeStr = new Date().toLocaleTimeString();

            // 1. Immediately post open transaction to Transaction Journal card
            const initialTxn: TransactionRecord = {
                id: tempTxnId,
                time: timeStr,
                market: marketLabel,
                symbol: sym,
                contractType: tradeSignal === 'UNDER' ? 'Under 6' : 'Over 3',
                barrier,
                stake: stakeToUse,
                payout: 0,
                profit: 0,
                result: 'OPEN',
                status: 'open',
            };

            setTransactions(prev => [initialTxn, ...prev.slice(0, 99)]);
            setJournalLogs(prev => [
                {
                    id: tempTxnId + '-journal',
                    time: timeStr,
                    type: 'TRADE',
                    title: `Signal Triggered: ${tradeSignal === 'UNDER' ? 'UNDER 6' : 'OVER 3'}`,
                    description: `Purchasing ${marketLabel} contract at $${stakeToUse.toFixed(2)} stake.`,
                    level: 'info',
                },
                ...prev.slice(0, 99),
            ]);

            playSoundCue('signal');

            try {
                const duration = parseInt(tradeDurationValue, 10) || 1;
                const buyResult = await buyContractForUi({
                    parameters: {
                        amount: stakeToUse,
                        basis: 'stake',
                        contract_type: contractType,
                        currency,
                        duration,
                        duration_unit: tradeDurationUnit,
                        symbol: sym,
                        barrier: String(barrier),
                    },
                    price: stakeToUse,
                    source: 'Autoflipper',
                });

                if (!buyResult || !buyResult.contract_id) {
                    throw new Error('No contract ID returned');
                }

                const contractId = buyResult.contract_id;
                const transactionId = buyResult.transaction_id || contractId;
                const startTime = Math.floor(Date.now() / 1000);

                // Update transaction with official contract IDs
                setTransactions(prev =>
                    prev.map(t => (t.id === tempTxnId ? { ...t, contractId, transactionId } : t))
                );

                const initSnapshot = {
                    contract_id: contractId,
                    transaction_ids: { buy: transactionId },
                    buy_price: stakeToUse,
                    underlying: sym,
                    underlying_symbol: sym,
                    display_name: marketLabel,
                    shortcode: `AF_${contractType}_${barrier}`,
                    contract_type: contractType,
                    currency: currency || 'USD',
                    date_start: startTime,
                    status: 'open',
                    barrier: String(barrier),
                };

                // Global observer emit for live trading drawer
                globalObserver.emit('bot.contract', initSnapshot);

                const settledSnapshot = await streamContractUntilSettled({
                    contractId,
                    fallback: initSnapshot,
                    onUpdate: snapshot => {
                        globalObserver.emit('bot.contract', snapshot);
                    },
                    source: 'Autoflipper',
                });

                const profit = Number(settledSnapshot?.profit || 0);
                const isWin = profit > 0;
                const entrySpotVal =
                    settledSnapshot?.entry_tick_display_value ??
                    settledSnapshot?.entry_tick ??
                    settledSnapshot?.barrier ??
                    '—';
                const exitSpotVal =
                    settledSnapshot?.exit_tick_display_value ??
                    settledSnapshot?.exit_tick ??
                    '—';

                // Record cross-bot continuous learning
                aiContinuousLearningService.recordBotTrade({
                    botName: 'AUTOFLIPPER',
                    strategy: tradeSignal === 'UNDER' ? 'AUTOFLIP_UNDER' : 'AUTOFLIP_OVER',
                    market: sym,
                    contractType: contractType,
                    barrier: String(barrier),
                    prediction: Number(barrier),
                    isWin,
                    profit,
                    stake: stakeToUse,
                });

                // 2. Post completed settlement into Transaction Journal card
                setTransactions(prev =>
                    prev.map(t =>
                        t.id === tempTxnId
                            ? {
                                  ...t,
                                  contractId,
                                  transactionId,
                                  profit,
                                  payout: isWin ? stakeToUse + profit : 0,
                                  entrySpot: entrySpotVal,
                                  exitSpot: exitSpotVal,
                                  result: isWin ? 'WIN' : 'LOSS',
                                  status: 'settled',
                              }
                            : t
                    )
                );

                if (isWin) {
                    playSoundCue('win');
                    consecutiveLossesRef.current = 0;
                    setWinsCount(w => w + 1);

                    setJournalLogs(prev => [
                        {
                            id: String(Date.now()),
                            time: new Date().toLocaleTimeString(),
                            type: 'TRADE',
                            title: `Trade Won: +$${profit.toFixed(2)}`,
                            description: `${marketLabel} ${tradeSignal === 'UNDER' ? 'Under 6' : 'Over 3'} settled successfully (Exit: ${exitSpotVal}).`,
                            level: 'success',
                        },
                        ...prev.slice(0, 99),
                    ]);

                    setSessionProfit(p => {
                        const newP = p + profit;

                        if (isCompoundingLinked && compStages.length > 0) {
                            const targetGoal = Number(compTargetProfit) || 250;
                            const prevStageIdx = compStages.findIndex(st => p < st.cumulativeProfit);
                            const newStageIdx = compStages.findIndex(st => newP < st.cumulativeProfit);

                            if (newP >= targetGoal) {
                                // Compounding Plan Complete!
                                setMilestone({ isOpen: true, type: 'tp' });
                                setBotState('IDLE');
                                setJournalLogs(prevLogs => [
                                    {
                                        id: String(Date.now() + 1),
                                        time: new Date().toLocaleTimeString(),
                                        type: 'GOAL_COMPLETE',
                                        title: '🏆 Compounding Target Reached!',
                                        description: `Full goal of +$${targetGoal.toFixed(2)} completed across all ${compStages.length} stages!`,
                                        level: 'success',
                                        badge: 'VICTORY',
                                    },
                                    ...prevLogs.slice(0, 99),
                                ]);
                            } else if (newStageIdx > prevStageIdx && newStageIdx !== -1) {
                                // Stepped up to next compounding stage
                                const nextStageObj = compStages[newStageIdx];
                                setCurrentStake(nextStageObj.recommendedStake);
                                setJournalLogs(prevLogs => [
                                    {
                                        id: String(Date.now() + 1),
                                        time: new Date().toLocaleTimeString(),
                                        type: 'STAGE_UNLOCK',
                                        title: `🚀 STAGE #${nextStageObj.stage} UNLOCKED`,
                                        description: `Milestone profit +$${nextStageObj.cumulativeProfit.toFixed(2)} reached! Base stake adjusted to $${nextStageObj.recommendedStake.toFixed(2)}.`,
                                        level: 'success',
                                        badge: `STAGE #${nextStageObj.stage}`,
                                    },
                                    ...prevLogs.slice(0, 99),
                                ]);
                            } else {
                                const currentBase = (compStages[newStageIdx === -1 ? compStages.length - 1 : newStageIdx] || activeStage).recommendedStake;
                                setCurrentStake(currentBase);
                            }
                        } else {
                            setCurrentStake(Number(initialStake) || 1);
                            const tp = Number(takeProfit) || 20;
                            if (newP >= tp) {
                                setMilestone({ isOpen: true, type: 'tp' });
                                setBotState('IDLE');
                            }
                        }
                        return newP;
                    });
                } else {
                    playSoundCue('loss');
                    consecutiveLossesRef.current += 1;
                    const mult = Number(martingale) || 2.6;
                    const nextStake = Math.round(stakeToUse * mult * 100) / 100;
                    setCurrentStake(nextStake);
                    setLossesCount(l => l + 1);

                    setJournalLogs(prev => [
                        {
                            id: String(Date.now()),
                            time: new Date().toLocaleTimeString(),
                            type: 'TRADE',
                            title: `Trade Lost: -$${Math.abs(profit).toFixed(2)}`,
                            description: `${marketLabel} ${tradeSignal === 'UNDER' ? 'Under 6' : 'Over 3'} closed out. Martingale stake scaled to $${nextStake.toFixed(2)}.`,
                            level: 'error',
                        },
                        ...prev.slice(0, 99),
                    ]);

                    setSessionProfit(p => {
                        const newP = p + profit;
                        const sl = Number(stopLoss) || 50;
                        if (newP <= -sl) {
                            setMilestone({ isOpen: true, type: 'sl' });
                            setBotState('IDLE');
                        }
                        return newP;
                    });
                }

                // Auto switch market if enabled
                if (autoSwitchMarkets && bestMarketCandidate && bestMarketCandidate !== selectedSymbol) {
                    setSelectedSymbol(bestMarketCandidate);
                    setJournalLogs(prev => [
                        {
                            id: String(Date.now() + 2),
                            time: new Date().toLocaleTimeString(),
                            type: 'SYSTEM',
                            title: 'Auto-Switch Market Activated',
                            description: `Switched active scanner to highest-momentum asset: ${bestMarketCandidate}.`,
                            level: 'info',
                        },
                        ...prev.slice(0, 99),
                    ]);
                }
            } catch (err: any) {
                console.error('[Autoflipper] Trade Execution Error:', err);
                setTransactions(prev =>
                    prev.map(t =>
                        t.id === tempTxnId
                            ? { ...t, result: 'LOSS', status: 'settled', profit: -stakeToUse }
                            : t
                    )
                );
                setJournalLogs(prev => [
                    {
                        id: String(Date.now()),
                        time: new Date().toLocaleTimeString(),
                        type: 'ERROR',
                        title: 'Trade Purchase Exception',
                        description: err?.message || 'Error communicating with Deriv WebSocket server.',
                        level: 'error',
                    },
                    ...prev.slice(0, 99),
                ]);
            } finally {
                isTradingInProgressRef.current = false;
                if (botStateRef.current === 'TRADING') {
                    setBotState('WAITING_SIGNAL');
                }
            }
        },
        [
            currentStake,
            selectedSymbol,
            currency,
            tradeDurationValue,
            tradeDurationUnit,
            initialStake,
            takeProfit,
            martingale,
            stopLoss,
            autoSwitchMarkets,
            bestMarketCandidate,
            isCompoundingLinked,
            compStages,
            compTargetProfit,
            activeStage,
        ]
    );

    // ── Live Strategy Trigger Loop ──
    useEffect(() => {
        if (botState !== 'WAITING_SIGNAL' && botState !== 'WAITING_TRIGGER') return;
        if (isTradingInProgressRef.current) return;

        if (flipAnalysis.activeSignal !== 'NEUTRAL') {
            if (flipAnalysis.isTriggerReady) {
                void executeTrade(flipAnalysis.activeSignal);
            } else {
                setBotState('WAITING_TRIGGER');
            }
        } else {
            setBotState('WAITING_SIGNAL');
        }
    }, [botState, flipAnalysis, executeTrade]);

    // ── Bot Controls ──

    const handleStartBot = async () => {
        if (!isLoggedIn()) {
            const oauthUrl = await generateOAuthURL();
            window.location.href = oauthUrl;
            return;
        }
        consecutiveLossesRef.current = 0;
        const baseStake = isCompoundingLinked
            ? (activeStage.recommendedStake || Number(initialStake) || 1.0)
            : (Number(initialStake) || 1.0);
        setCurrentStake(baseStake);
        setBotState('WAITING_SIGNAL');
        playSoundCue('signal');

        setJournalLogs(prev => [
            {
                id: String(Date.now()),
                time: new Date().toLocaleTimeString(),
                type: 'SYSTEM',
                title: 'Autoflipper Engine Activated',
                description: `Started with Base Stake $${baseStake.toFixed(2)}. Monitoring ${selectedSymbol} for regime flip triggers.`,
                level: 'info',
            },
            ...prev,
        ]);
    };

    const handlePauseBot = () => {
        const nextState = botState === 'PAUSED' ? 'WAITING_SIGNAL' : 'PAUSED';
        setBotState(nextState);
        setJournalLogs(prev => [
            {
                id: String(Date.now()),
                time: new Date().toLocaleTimeString(),
                type: 'SYSTEM',
                title: nextState === 'PAUSED' ? 'Bot Paused' : 'Bot Resumed',
                description: nextState === 'PAUSED' ? 'Execution halted by user.' : 'Resumed active regime monitoring.',
                level: 'warning',
            },
            ...prev,
        ]);
    };

    const handleStopBot = () => {
        setBotState('IDLE');
        isTradingInProgressRef.current = false;
        setJournalLogs(prev => [
            {
                id: String(Date.now()),
                time: new Date().toLocaleTimeString(),
                type: 'SYSTEM',
                title: 'Bot Stopped',
                description: 'Engine returned to idle state.',
                level: 'warning',
            },
            ...prev,
        ]);
    };

    const handleClearLogs = () => {
        setTransactions([]);
        setJournalLogs([]);
        setWinsCount(0);
        setLossesCount(0);
        setSessionProfit(0);
    };

    const totalTrades = winsCount + lossesCount;
    const winRate = totalTrades > 0 ? ((winsCount / totalTrades) * 100).toFixed(1) : '0.0';

    return (
        <div className='autoflipper'>
            {/* ── 1. Top Hero Header ── */}
            <div className='autoflipper__header'>
                <div className='autoflipper__header-title-box'>
                    <div className='af-icon-badge'>
                        <Flame size={24} />
                    </div>
                    <div className='af-title-text'>
                        <div className='title-row'>
                            <h1>AUTOFLIPPER PRO</h1>
                            <span className={`af-status-chip af-status-chip--${botState.toLowerCase()}`}>
                                {botState === 'TRADING' && '🚀 EXECUTING TRADE'}
                                {botState === 'WAITING_TRIGGER' && '⚡ TRIGGER READY'}
                                {botState === 'WAITING_SIGNAL' && '⏳ SCANNING REGIME'}
                                {botState === 'PAUSED' && '⏸ PAUSED'}
                                {botState === 'IDLE' && '● ENGINE READY'}
                            </span>
                        </div>
                        <span>Under 6 / Over 3 Neural Regime-Flipping Engine with Linked Compounding Schedule</span>
                    </div>
                </div>

                <div className='autoflipper__header-actions'>
                    {isCompoundingLinked && (
                        <div className='af-metric-pill' title={`Active Milestone: Stage ${activeStage.stage} of ${compStages.length}`}>
                            <span className='af-metric-pill__label'>Target Stage</span>
                            <span className='af-metric-pill__val' style={{ color: '#00f0ff' }}>
                                #{activeStage.stage}/{compStages.length}
                            </span>
                        </div>
                    )}
                    <div className='af-metric-pill'>
                        <span className='af-metric-pill__label'>Session P/L</span>
                        <span
                            className={`af-metric-pill__val ${sessionProfit > 0 ? 'af-metric-pill__val--profit' : sessionProfit < 0 ? 'af-metric-pill__val--loss' : ''}`}
                        >
                            {sessionProfit >= 0 ? `+${sessionProfit.toFixed(2)}` : sessionProfit.toFixed(2)} {currency}
                        </span>
                    </div>
                    <div className='af-metric-pill'>
                        <span className='af-metric-pill__label'>Win Rate</span>
                        <span
                            className='af-metric-pill__val'
                            style={{
                                color: Number(winRate) >= 60 ? '#10b981' : Number(winRate) > 0 ? '#f59e0b' : '#94a3b8',
                            }}
                        >
                            {winRate}%
                        </span>
                    </div>
                    <div className='af-metric-pill'>
                        <span className='af-metric-pill__label'>Wins / Losses</span>
                        <span className='af-metric-pill__val'>
                            <span style={{ color: '#10b981' }}>{winsCount}W</span> /{' '}
                            <span style={{ color: '#ef4444' }}>{lossesCount}L</span>
                        </span>
                    </div>
                    <div className='af-metric-pill'>
                        <span className='af-metric-pill__label'>Active Stake</span>
                        <span className='af-metric-pill__val af-metric-pill__val--gold'>
                            {currentStake.toFixed(2)} {currency}
                        </span>
                    </div>
                    <button
                        className='af-ai-lab-btn'
                        onClick={() => setIsAiLearningModalOpen(true)}
                        title='Open Multi-Bot Continuous Neural Learning Lab & 24/7 Machine Mode'
                        type='button'
                    >
                        <span className='af-ai-lab-btn__dot' />
                        🧠 AI Learning Lab
                    </button>
                </div>
            </div>

            {/* ── 2. Active Markets in ONE LINE (Horizontal Ticker Ribbon) ── */}
            <div className='autoflipper__markets-strip'>
                <div className='strip-nav'>
                    <button
                        className='strip-nav-btn'
                        onClick={() => scrollMarkets('left')}
                        type='button'
                        title='Scroll Left'
                    >
                        <ChevronLeft size={16} />
                    </button>
                </div>

                <div className='strip-scroll-track' ref={marketScrollRef}>
                    {MARKETS.map(m => {
                        const mState = marketsDataRef.current.get(m.symbol);
                        const digits = mState?.digits || [];
                        const last50 = digits.slice(-50);
                        const u04 = last50.filter(d => d <= 4).length;
                        const o59 = last50.filter(d => d >= 5).length;
                        const total = last50.length || 1;
                        const uPct = Math.round((u04 / total) * 100);
                        const oPct = Math.round((o59 / total) * 100);
                        const isSelected = m.symbol === selectedSymbol;
                        const isBest = m.symbol === bestMarketCandidate;
                        const lastDigit = mState?.lastDigit ?? 0;
                        const isUnder = lastDigit <= 4;

                        return (
                            <div
                                key={m.symbol}
                                className={`af-market-pill ${isSelected ? 'af-market-pill--selected' : ''} ${isBest ? 'af-market-pill--recommended' : ''}`}
                                onClick={() => setSelectedSymbol(m.symbol)}
                            >
                                <div className='pill-info'>
                                    <span className='pill-name'>{m.label}</span>
                                    <span className='pill-price'>{mState?.currentPrice || '0.00'}</span>
                                </div>
                                <div className={`pill-digit ${isUnder ? 'pill-digit--under' : 'pill-digit--over'}`}>
                                    {lastDigit}
                                </div>
                                <div className='pill-bias'>
                                    <span className={uPct >= oPct ? 'bias-u' : 'bias-o'}>
                                        {uPct >= oPct ? `U:${uPct}%` : `O:${oPct}%`}
                                    </span>
                                </div>
                                {isBest && <span className='pill-best-tag'>TOP</span>}
                            </div>
                        );
                    })}
                </div>

                <div className='strip-nav'>
                    <button
                        className='strip-nav-btn'
                        onClick={() => scrollMarkets('right')}
                        type='button'
                        title='Scroll Right'
                    >
                        <ChevronRight size={16} />
                    </button>
                </div>

                <div className='strip-actions'>
                    <button
                        className={`btn-strip-toggle ${scanAllMarkets ? 'btn-strip-toggle--active' : ''}`}
                        onClick={() => setScanAllMarkets(!scanAllMarkets)}
                        type='button'
                        title='Scan all synthetic markets simultaneously'
                    >
                        <Zap size={12} /> Scan All ({scanAllMarkets ? 'ON' : 'OFF'})
                    </button>
                    <button
                        className={`btn-strip-toggle ${autoSwitchMarkets ? 'btn-strip-toggle--active' : ''}`}
                        onClick={() => setAutoSwitchMarkets(!autoSwitchMarkets)}
                        type='button'
                        title='Automatically switch to highest bias market between runs'
                    >
                        <RefreshCw size={12} /> Auto-Switch ({autoSwitchMarkets ? 'ON' : 'OFF'})
                    </button>
                </div>
            </div>

            {/* ── 3. Balanced Analytics Command Deck (2 Equal Columns: Chart & Dual Model Radar) ── */}
            <div className='autoflipper__analytics-deck'>
                {/* Left Card: 50-Ticks Spline Trajectory Chart */}
                <div className='autoflipper__chart-card'>
                    <div className='af-chart-top'>
                        <div className='af-price-badge-group'>
                            <div className='af-current-price-box'>
                                <span className='label'>LIVE STREAM ({currentMarket.symbol})</span>
                                <div className='price-row'>
                                    <span className='price'>{currentMarket.currentPrice}</span>
                                    <span className='live-dot' />
                                </div>
                            </div>
                            <div
                                className={`af-last-digit-big af-last-digit-big--${currentMarket.lastDigit <= 4 ? 'under' : 'over'}`}
                            >
                                <span className='digit-label'>LAST SPOT</span>
                                <span className='digit-val'>{currentMarket.lastDigit}</span>
                                <span className='digit-sub'>
                                    {currentMarket.lastDigit <= 4 ? 'Under (0–4)' : 'Over (5–9)'}
                                </span>
                            </div>
                        </div>

                        <div className='af-chart-legend'>
                            <div className='legend-item'>
                                <span className='dot dot--curve' />
                                <span>50-Ticks Spline</span>
                            </div>
                            <div className='legend-item'>
                                <span className='dot dot--under' />
                                <span>Under (0–4)</span>
                            </div>
                            <div className='legend-item'>
                                <span className='dot dot--over' />
                                <span>Over (5–9)</span>
                            </div>
                            <div className='legend-item'>
                                <span className='dot dot--curr' />
                                <span>Active Spot</span>
                            </div>
                        </div>
                    </div>

                    <div className='af-chart-wrap'>
                        <DigitLineChart digits={currentMarket.digits} />
                    </div>
                </div>

                {/* Right Card: Dual Statistical Models & Glowing Entry Radar HUD */}
                <div className='autoflipper__radar-card'>
                    <div className='radar-top-header'>
                        <h3>
                            <Sparkles size={16} /> Parity &amp; Dominant Frequency Trigger Radar
                        </h3>
                        <div className='radar-pulse-badge'>
                            <span className='dot-pulse' />
                            <span>{flipAnalysis.signalReason}</span>
                        </div>
                    </div>

                    {/* Dual Parity Models */}
                    <div className='radar-models-grid'>
                        {/* Split 1: Under 0-4 vs Over 5-9 */}
                        <div className='mini-split-box'>
                            <div className='box-head'>
                                <span>Under (0-4) vs Over (5-9)</span>
                                <span className={`edge-tag ${flipAnalysis.under04Pct >= 50 ? 'edge-tag--under' : 'edge-tag--over'}`}>
                                    {flipAnalysis.under04Pct >= 50 ? `+${flipAnalysis.under04Pct}% Under` : `+${flipAnalysis.over59Pct}% Over`}
                                </span>
                            </div>
                            <div className='split-bar-track'>
                                <div className='bar-under' style={{ width: `${flipAnalysis.under04Pct}%` }} />
                                <div className='bar-over' style={{ width: `${flipAnalysis.over59Pct}%` }} />
                            </div>
                            <div className='box-foot'>
                                <span>{flipAnalysis.under04} of 50 Under</span>
                                <span>{flipAnalysis.over59} of 50 Over</span>
                            </div>
                        </div>

                        {/* Split 2: Under 0-5 vs Over 4-9 */}
                        <div className='mini-split-box'>
                            <div className='box-head'>
                                <span>Extended: (0-5) vs (4-9)</span>
                                <div className='af-tick-pills-row'>
                                    {flipAnalysis.last10.slice(-6).map((d, i) => (
                                        <span key={i} className={`mini-digit-badge ${d <= 4 ? 'under' : 'over'}`}>
                                            {d}
                                        </span>
                                    ))}
                                </div>
                            </div>
                            <div className='split-bar-track'>
                                <div className='bar-under' style={{ width: `${flipAnalysis.under05Pct}%` }} />
                                <div className='bar-over' style={{ width: `${flipAnalysis.over49Pct}%` }} />
                            </div>
                            <div className='box-foot'>
                                <span>{flipAnalysis.under05Pct}% Range Under</span>
                                <span>{flipAnalysis.over49Pct}% Range Over</span>
                            </div>
                        </div>
                    </div>

                    {/* Glowing Entry Trigger Cards */}
                    <div className='radar-trigger-row'>
                        <div className={`trigger-card trigger-card--under ${flipAnalysis.activeSignal === 'UNDER' ? 'is-active-trigger' : ''}`}>
                            <div className='trigger-info'>
                                <span className='trigger-tag'>Under Trigger (0–5)</span>
                                <span className='trigger-title'>Target: Under 6</span>
                                <span className='trigger-sub'>Freq: {flipAnalysis.highestUnderDigitPct}% in stream</span>
                            </div>
                            <div className='trigger-orb' title={`Highest Under Digit: ${flipAnalysis.highestUnderDigit}`}>
                                {flipAnalysis.highestUnderDigit}
                            </div>
                        </div>

                        <div className={`trigger-card trigger-card--over ${flipAnalysis.activeSignal === 'OVER' ? 'is-active-trigger' : ''}`}>
                            <div className='trigger-info'>
                                <span className='trigger-tag'>Over Trigger (4–9)</span>
                                <span className='trigger-title'>Target: Over 3</span>
                                <span className='trigger-sub'>Freq: {flipAnalysis.highestOverDigitPct}% in stream</span>
                            </div>
                            <div className='trigger-orb' title={`Highest Over Digit: ${flipAnalysis.highestOverDigit}`}>
                                {flipAnalysis.highestOverDigit}
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* ── 4. Advanced Compounding & Duration Engine Matrix ── */}
            <div className='autoflipper__compounding-card'>
                <div className='comp-header'>
                    <div className='title-wrap'>
                        <h3>
                            <Layers size={16} /> Time-Target Compounding Plan
                        </h3>
                        <span>Custom Duration ({compDurationValue} {compDurationUnit.toLowerCase()}) &bull; {compRiskPercent}% Risk &bull; {compNumStages} Stages</span>
                    </div>
                    <div className='comp-header-actions'>
                        <button
                            className={`btn-toggle-link ${isCompoundingLinked ? 'btn-toggle-link--active' : ''}`}
                            onClick={() => setIsCompoundingLinked(!isCompoundingLinked)}
                            type='button'
                            title='Toggle auto-linking compounding milestones directly to the trading engine'
                        >
                            🔗 Engine Linked: {isCompoundingLinked ? 'ON' : 'OFF'}
                        </button>
                        <span className='risk-notice'>
                            🛡️ {compRiskPercent}% Risk/Stage
                        </span>
                        <button
                            className='btn-toggle-schedule'
                            onClick={() => setShowScheduleTable(!showScheduleTable)}
                            type='button'
                        >
                            {showScheduleTable ? '▲ Hide Milestones' : '▼ View Milestones Table'}
                        </button>
                    </div>
                </div>

                {/* Duration Unit Selector Tabs & Presets */}
                <div className='comp-duration-selector-row'>
                    <div className='unit-switch-group'>
                        <span className='label'>Unit:</span>
                        <div className='btn-switch-group'>
                            <button
                                className={`btn-unit ${compDurationUnit === 'HOURS' ? 'btn-unit--active' : ''}`}
                                onClick={() => {
                                    setCompDurationUnit('HOURS');
                                    generateCompoundingPlan(compStartCapital, compTargetProfit, compDurationValue, 'HOURS', compRiskPercent, compNumStages);
                                }}
                                type='button'
                            >
                                <Clock size={12} /> Hours
                            </button>
                            <button
                                className={`btn-unit ${compDurationUnit === 'DAYS' ? 'btn-unit--active' : ''}`}
                                onClick={() => {
                                    setCompDurationUnit('DAYS');
                                    generateCompoundingPlan(compStartCapital, compTargetProfit, compDurationValue, 'DAYS', compRiskPercent, compNumStages);
                                }}
                                type='button'
                            >
                                <Calendar size={12} /> Days
                            </button>
                            <button
                                className={`btn-unit ${compDurationUnit === 'MINUTES' ? 'btn-unit--active' : ''}`}
                                onClick={() => {
                                    setCompDurationUnit('MINUTES');
                                    generateCompoundingPlan(compStartCapital, compTargetProfit, compDurationValue, 'MINUTES', compRiskPercent, compNumStages);
                                }}
                                type='button'
                            >
                                <Zap size={12} /> Mins
                            </button>
                        </div>
                    </div>

                    <div className='presets-wrap'>
                        <span className='presets-label'>Quick Presets:</span>
                        <div className='preset-chips'>
                            <button type='button' onClick={() => applyDurationPreset('12', 'HOURS')}>12h</button>
                            <button type='button' onClick={() => applyDurationPreset('24', 'HOURS')}>24h</button>
                            <button type='button' onClick={() => applyDurationPreset('48', 'HOURS')}>48h</button>
                            <button type='button' onClick={() => applyDurationPreset('3', 'DAYS')}>3d</button>
                            <button type='button' onClick={() => applyDurationPreset('7', 'DAYS')}>7d</button>
                            <button type='button' onClick={() => applyDurationPreset('14', 'DAYS')}>14d</button>
                            <button type='button' onClick={() => applyDurationPreset('30', 'DAYS')}>30d</button>
                        </div>
                    </div>
                </div>

                {/* Interactive Input Figures Form */}
                <div className='comp-inputs-row'>
                    <div className='input-group'>
                        <label>Duration ({compDurationUnit})</label>
                        <input
                            type='number'
                            min='1'
                            step='1'
                            value={compDurationValue}
                            onChange={e => setCompDurationValue(e.target.value)}
                            placeholder='24'
                        />
                    </div>

                    <div className='input-group'>
                        <label>Start Capital ({currency})</label>
                        <input
                            type='number'
                            min='5'
                            step='10'
                            value={compStartCapital}
                            onChange={e => setCompStartCapital(e.target.value)}
                            placeholder='100.00'
                        />
                    </div>

                    <div className='input-group'>
                        <label>Target Profit ({currency})</label>
                        <input
                            type='number'
                            min='10'
                            step='10'
                            value={compTargetProfit}
                            onChange={e => setCompTargetProfit(e.target.value)}
                            placeholder='250.00'
                        />
                    </div>

                    <div className='input-group'>
                        <label>Risk % / Trade</label>
                        <input
                            type='number'
                            min='0.5'
                            max='10'
                            step='0.5'
                            value={compRiskPercent}
                            onChange={e => setCompRiskPercent(e.target.value)}
                            placeholder='2.0'
                        />
                    </div>

                    <div className='input-group'>
                        <label>Target Stages</label>
                        <select
                            value={compNumStages}
                            onChange={e => setCompNumStages(e.target.value)}
                        >
                            <option value='4'>4 Stages</option>
                            <option value='6'>6 Stages</option>
                            <option value='8'>8 Stages (Std)</option>
                            <option value='10'>10 Stages</option>
                            <option value='12'>12 Stages</option>
                            <option value='16'>16 Stages</option>
                            <option value='24'>24 Stages</option>
                        </select>
                    </div>

                    <button
                        className='btn-generate'
                        onClick={() => generateCompoundingPlan()}
                        type='button'
                    >
                        <RefreshCw size={13} /> Recalculate
                    </button>

                    <button
                        className='btn-sync-engine'
                        onClick={applyCompoundingToEngine}
                        type='button'
                        title='Directly link and apply compounding parameters to Trade Engine'
                    >
                        ⚡ Sync with Engine
                    </button>
                </div>

                {/* Live Active Compounding Stage Gauge */}
                <div className='comp-live-stage-gauge'>
                    <div className='gauge-top'>
                        <div className='gauge-left'>
                            <span className='gauge-badge'>
                                {isAllStagesComplete ? '🏆 GOAL REACHED' : `STAGE #${activeStage.stage} OF ${compStages.length}`}
                            </span>
                            <span className='gauge-title'>
                                {activeStage.timeLabel} Target: <strong>+${activeStage.cumulativeProfit.toFixed(2)}</strong> ({currency})
                            </span>
                        </div>
                        <div className='gauge-right'>
                            <span>Base Stake: <strong>${activeStage.recommendedStake.toFixed(2)}</strong></span>
                            <span className='gauge-pct'>{stageProgressPct}%</span>
                        </div>
                    </div>
                    <div className='gauge-bar-track'>
                        <div
                            className='gauge-bar-fill'
                            style={{ width: `${stageProgressPct}%` }}
                        />
                    </div>
                    <div className='gauge-sub'>
                        <span>Progress: <strong>${stageCurrentProgress.toFixed(2)} / ${activeStage.stageProfit.toFixed(2)}</strong></span>
                        <span className='link-state-indicator'>
                            {isCompoundingLinked ? '🔗 Trade Engine Linked & Auto-Escalating' : '⚠️ Manual Stake Mode'}
                        </span>
                    </div>
                </div>

                {/* Plan Velocity Summary Cards */}
                <div className='comp-metrics-summary-bar'>
                    <div className='metric-stat-box'>
                        <span className='label'>Total Time</span>
                        <span className='val'>{compDurationValue} {compDurationUnit.toLowerCase()}</span>
                    </div>
                    <div className='metric-stat-box'>
                        <span className='label'>Hourly Target</span>
                        <span className='val'>+${planVelocityMetrics.hourlyReq} / hr</span>
                    </div>
                    <div className='metric-stat-box'>
                        <span className='label'>Daily Target</span>
                        <span className='val'>+${planVelocityMetrics.dailyReq} / day</span>
                    </div>
                    <div className='metric-stat-box'>
                        <span className='label'>Final Target Balance</span>
                        <span className='val' style={{ color: '#00f0ff' }}>
                            ${(Number(compStartCapital) + Number(compTargetProfit)).toFixed(2)}
                        </span>
                    </div>
                </div>

                {/* Compounding Stages Schedule Table (Collapsible) */}
                {showScheduleTable && (
                    <div className='comp-table-wrap'>
                        <table>
                            <thead>
                                <tr>
                                    <th>Milestone</th>
                                    <th>Target Timeline</th>
                                    <th>Target Balance</th>
                                    <th>{compRiskPercent}% Stake</th>
                                    <th>Stage Profit</th>
                                    <th>Cumulative Profit</th>
                                    <th>Status</th>
                                </tr>
                            </thead>
                            <tbody>
                                {stagesWithStatus.map(st => (
                                    <tr key={st.stage} className={`stage-${st.status.toLowerCase()}`}>
                                        <td className='stage-name'>Stage #{st.stage}</td>
                                        <td className='stage-time'>
                                            <Clock size={11} style={{ marginRight: '4px', verticalAlign: 'middle' }} />
                                            {st.timeLabel}
                                        </td>
                                        <td className='stage-bal'>${st.targetBalance.toFixed(2)}</td>
                                        <td className='stage-stake'>${st.recommendedStake.toFixed(2)}</td>
                                        <td className='stage-profit'>+${st.stageProfit.toFixed(2)}</td>
                                        <td className='stage-cum'>+${st.cumulativeProfit.toFixed(2)}</td>
                                        <td>
                                            <span className={`badge-stage-status ${st.status.toLowerCase()}`}>
                                                {st.status === 'DONE' && '✓ DONE'}
                                                {st.status === 'ACTIVE' && '⚡ ACTIVE'}
                                                {st.status === 'PENDING' && '⏳ QUEUED'}
                                            </span>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            {/* ── 5. Bottom Balanced Grid: Parameters & Transactions Journal ── */}
            <div className='autoflipper__bottom-grid'>
                {/* Left Card: Trading Parameters Panel */}
                <div className='autoflipper__params-card'>
                    <div className='params-card-header'>
                        <h3>
                            <Shield size={16} /> Trading Parameters &amp; Risk Matrix
                        </h3>
                    </div>

                    {/* Compounding Engine Link Banner */}
                    <div className={`comp-engine-badge ${isCompoundingLinked ? 'comp-engine-badge--active' : ''}`}>
                        <span className='dot' />
                        <span>
                            {isCompoundingLinked
                                ? `Linked with Stage #${activeStage.stage} (Base Stake: $${activeStage.recommendedStake.toFixed(2)}, Goal: +$${(Number(compTargetProfit) || 250).toFixed(2)})`
                                : 'Manual Stake Mode: Driven by input fields below'}
                        </span>
                        <button
                            className='btn-switch-link'
                            type='button'
                            onClick={() => setIsCompoundingLinked(!isCompoundingLinked)}
                        >
                            {isCompoundingLinked ? 'Manual Mode' : 'Link Plan'}
                        </button>
                    </div>

                    <div className='af-inputs-grid'>
                        <div className='af-input-group'>
                            <label>Initial Stake ({currency}) {isCompoundingLinked && '• [Plan Stake]'}</label>
                            <input
                                type='number'
                                step='0.1'
                                min='0.35'
                                value={initialStake}
                                onChange={e => setInitialStake(e.target.value)}
                                disabled={botState !== 'IDLE'}
                            />
                        </div>
                        <div className='af-input-group'>
                            <label>Martingale Multiplier</label>
                            <input
                                type='number'
                                step='0.1'
                                value={martingale}
                                onChange={e => setMartingale(e.target.value)}
                                disabled={botState !== 'IDLE'}
                            />
                        </div>
                        <div className='af-input-group'>
                            <label>Take Profit ({currency}) {isCompoundingLinked && '• [Plan Goal]'}</label>
                            <input
                                type='number'
                                value={takeProfit}
                                onChange={e => setTakeProfit(e.target.value)}
                                disabled={botState !== 'IDLE'}
                            />
                        </div>
                        <div className='af-input-group'>
                            <label>Stop Loss ({currency})</label>
                            <input
                                type='number'
                                value={stopLoss}
                                onChange={e => setStopLoss(e.target.value)}
                                disabled={botState !== 'IDLE'}
                            />
                        </div>

                        {/* Custom Trade Duration Figure & Unit */}
                        <div className='af-input-group'>
                            <label>Trade Duration</label>
                            <div className='af-duration-input-composite'>
                                <input
                                    type='number'
                                    min='1'
                                    step='1'
                                    value={tradeDurationValue}
                                    onChange={e => setTradeDurationValue(e.target.value)}
                                    disabled={botState !== 'IDLE'}
                                />
                                <select
                                    value={tradeDurationUnit}
                                    onChange={e => setTradeDurationUnit(e.target.value as TradeDurationUnitType)}
                                    disabled={botState !== 'IDLE'}
                                >
                                    <option value='t'>Ticks</option>
                                    <option value='s'>Seconds</option>
                                    <option value='m'>Minutes</option>
                                </select>
                            </div>
                        </div>

                        <div className='af-input-group'>
                            <label>Strategy Mode</label>
                            <select value='auto' disabled>
                                <option value='auto'>Under 6 / Over 3 (Auto-Pilot)</option>
                            </select>
                        </div>
                    </div>

                    {/* Execution Buttons */}
                    <div className='af-buttons-row'>
                        {botState === 'IDLE' ? (
                            <button className='af-btn af-btn--start' onClick={handleStartBot}>
                                <Play size={18} /> START AUTOFLIPPER
                            </button>
                        ) : (
                            <>
                                <button className='af-btn af-btn--pause' onClick={handlePauseBot}>
                                    {botState === 'PAUSED' ? <Play size={16} /> : <Pause size={16} />}
                                    {botState === 'PAUSED' ? 'RESUME' : 'PAUSE'}
                                </button>
                                <button className='af-btn af-btn--stop' onClick={handleStopBot}>
                                    <Square size={16} /> STOP BOT
                                </button>
                            </>
                        )}
                    </div>
                </div>

                {/* Right Card: Live Transactions & Execution Journal */}
                <div className='autoflipper__logs-card'>
                    <div className='af-logs-header'>
                        <div className='af-logs-tabs'>
                            <button
                                className={`af-tab-btn ${activeJournalTab === 'TRANSACTIONS' ? 'af-tab-btn--active' : ''}`}
                                onClick={() => setActiveJournalTab('TRANSACTIONS')}
                                type='button'
                            >
                                <FileText size={14} /> Live Transactions ({transactions.length})
                            </button>
                            <button
                                className={`af-tab-btn ${activeJournalTab === 'JOURNAL' ? 'af-tab-btn--active' : ''}`}
                                onClick={() => setActiveJournalTab('JOURNAL')}
                                type='button'
                            >
                                <Activity size={14} /> System Journal ({journalLogs.length})
                            </button>
                        </div>

                        {(transactions.length > 0 || journalLogs.length > 0) && (
                            <button className='af-clear-btn' onClick={handleClearLogs} type='button'>
                                Clear
                            </button>
                        )}
                    </div>

                    {/* Content View */}
                    {activeJournalTab === 'TRANSACTIONS' ? (
                        <div className='af-transactions-view'>
                            {transactions.length === 0 ? (
                                <div className='af-logs-empty'>
                                    <div className='af-logs-empty__icon'>📑</div>
                                    <span>No active transactions yet. Start Autoflipper to post live trades.</span>
                                </div>
                            ) : (
                                <div className='af-table-container'>
                                    <table className='af-txn-table'>
                                        <thead>
                                            <tr>
                                                <th>Time</th>
                                                <th>Ref / ID</th>
                                                <th>Market</th>
                                                <th>Type</th>
                                                <th>Entry/Exit</th>
                                                <th>Stake</th>
                                                <th>Payout</th>
                                                <th>Profit</th>
                                                <th>Status</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {transactions.map(txn => {
                                                const isWin = txn.result === 'WIN';
                                                const isOpen = txn.result === 'OPEN';
                                                return (
                                                    <tr key={txn.id} className={`txn-row txn-row--${txn.result.toLowerCase()}`}>
                                                        <td className='time-cell'>{txn.time}</td>
                                                        <td className='ref-cell'>
                                                            {txn.contractId ? `#${txn.contractId}` : 'Pending...'}
                                                        </td>
                                                        <td className='market-cell'>{txn.market}</td>
                                                        <td className='type-cell'>
                                                            <span className={`type-badge type-badge--${txn.contractType.toLowerCase().includes('under') ? 'under' : 'over'}`}>
                                                                {txn.contractType}
                                                            </span>
                                                        </td>
                                                        <td className='spot-cell'>
                                                            {isOpen ? (
                                                                <span className='spot-open'>Running...</span>
                                                            ) : (
                                                                <span>{txn.entrySpot} &rarr; <strong>{txn.exitSpot}</strong></span>
                                                            )}
                                                        </td>
                                                        <td className='stake-cell'>${txn.stake.toFixed(2)}</td>
                                                        <td className='payout-cell'>
                                                            {isOpen ? '—' : `$${txn.payout.toFixed(2)}`}
                                                        </td>
                                                        <td className={`profit-cell ${isWin ? 'profit-cell--win' : !isOpen ? 'profit-cell--loss' : ''}`}>
                                                            {isOpen ? (
                                                                <span className='profit-open'>$0.00</span>
                                                            ) : isWin ? (
                                                                `+$${txn.profit.toFixed(2)}`
                                                            ) : (
                                                                `-$${Math.abs(txn.profit).toFixed(2)}`
                                                            )}
                                                        </td>
                                                        <td className='status-cell'>
                                                            <span className={`status-pill status-pill--${txn.result.toLowerCase()}`}>
                                                                {txn.result === 'WIN' && '✓ WON'}
                                                                {txn.result === 'LOSS' && '✗ LOST'}
                                                                {txn.result === 'OPEN' && '⏳ OPEN'}
                                                            </span>
                                                        </td>
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                        </div>
                    ) : (
                        <div className='af-journal-view'>
                            {journalLogs.length === 0 ? (
                                <div className='af-logs-empty'>
                                    <div className='af-logs-empty__icon'>📝</div>
                                    <span>Engine log idle. Operational and milestone events will post here.</span>
                                </div>
                            ) : (
                                <div className='af-journal-list'>
                                    {journalLogs.map(log => (
                                        <div key={log.id} className={`af-journal-item af-journal-item--${log.level || 'info'}`}>
                                            <div className='journal-item-head'>
                                                <div className='journal-title-wrap'>
                                                    {log.level === 'success' && <CheckCircle2 size={13} className='icon-success' />}
                                                    {log.level === 'error' && <AlertCircle size={13} className='icon-error' />}
                                                    {log.level === 'warning' && <AlertCircle size={13} className='icon-warning' />}
                                                    {log.level === 'info' && <Activity size={13} className='icon-info' />}
                                                    <span className='title'>{log.title}</span>
                                                </div>
                                                <span className='time'>{log.time}</span>
                                            </div>
                                            <div className='journal-item-body'>
                                                <span className='desc'>{log.description}</span>
                                                {log.badge && <span className='badge'>{log.badge}</span>}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </div>

            <TradingMilestoneModal
                isOpen={milestone.isOpen}
                type={milestone.type}
                amount={sessionProfit}
                currency={currency}
                botName='Autoflipper'
                onClose={() => setMilestone({ isOpen: false, type: null })}
            />

            <AiLearningHubModal
                isOpen={isAiLearningModalOpen}
                onClose={() => setIsAiLearningModalOpen(false)}
            />
        </div>
    );
});

export default Autoflipper;
