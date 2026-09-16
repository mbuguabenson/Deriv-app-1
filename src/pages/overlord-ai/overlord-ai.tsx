import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { generateOAuthURL, TradingMilestoneModal } from '@/components/shared';
import { api_base, observer as globalObserver } from '@/external/bot-skeleton';
import { useStore } from '@/hooks/useStore';
import { buyContractForUi, streamContractUntilSettled } from '@/utils/trade-purchase';
import { safeSubscribe, subscribeTicks, derivTickManager } from '@/utils/websocket-handler';
import { isLoggedIn } from '@/utils/token-bridge';
import {
    BarChart2,
    Download,
    Flame,
    Layers,
    Play,
    Radio,
    RotateCcw,
    Sparkles,
    Square,
    Volume2,
    VolumeX,
} from 'lucide-react';
import './overlord-ai.scss';

// ─── Type Definitions ─────────────────────────────────────────────────────────

export type OverlordStrategyMode =
    | 'OVER_1_UNDER_8'
    | 'OVER_2_UNDER_7'
    | 'OVER_3_UNDER_6'
    | 'ALL_AUTO';

export type AutoRunState =
    | 'IDLE'
    | 'SCANNING'
    | 'WAITING_SIGNAL'
    | 'WAITING_TRIGGER'
    | 'BURST_TRADING'
    | 'BURST_PAUSED'
    | 'TP_REACHED'
    | 'SL_REACHED'
    | 'PAUSED';

export interface MarketDigitState {
    symbol: string;
    label: string;
    digits: number[];
    currentPrice: string;
    lastDigit: number;
    pip: number;
    tickCount?: number;
}

export interface TradeLogItem {
    id: string;
    timestamp: number;
    symbol: string;
    contractType: 'DIGITOVER' | 'DIGITUNDER';
    barrier: number;
    stake: number;
    result: 'WIN' | 'LOSS' | 'PENDING';
    profit: number;
    exitDigit?: number;
    burstRunIndex?: number;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const DERIVED_SYNTHETIC_MARKETS = [
    { symbol: 'R_100', label: 'Volatility 100 Index', pip: 2 },
    { symbol: '1HZ10V', label: 'Volatility 10 (1s) Index', pip: 2 },
    { symbol: '1HZ25V', label: 'Volatility 25 (1s) Index', pip: 2 },
    { symbol: '1HZ50V', label: 'Volatility 50 (1s) Index', pip: 2 },
    { symbol: '1HZ75V', label: 'Volatility 75 (1s) Index', pip: 2 },
    { symbol: 'R_10', label: 'Volatility 10 Index', pip: 3 },
    { symbol: 'R_25', label: 'Volatility 25 Index', pip: 3 },
    { symbol: 'R_50', label: 'Volatility 50 Index', pip: 4 },
    { symbol: 'R_75', label: 'Volatility 75 Index', pip: 4 },
];

const MAX_HISTORY_TICKS = 1000;
const CHART_TICKS = 50;

// Sound Synthesizer for Audio Feedback
const playSoundCue = (type: 'win' | 'loss' | 'start' | 'burst_complete' | 'alert') => {
    try {
        const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
        if (!AudioCtx) return;
        const ctx = new AudioCtx();

        if (type === 'win') {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.frequency.setValueAtTime(587.33, ctx.currentTime); // D5
            osc.frequency.setValueAtTime(880.0, ctx.currentTime + 0.1); // A5
            gain.gain.setValueAtTime(0.15, ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
            osc.start();
            osc.stop(ctx.currentTime + 0.35);
        } else if (type === 'loss') {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.type = 'sawtooth';
            osc.frequency.setValueAtTime(320, ctx.currentTime);
            osc.frequency.setValueAtTime(180, ctx.currentTime + 0.12);
            gain.gain.setValueAtTime(0.2, ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
            osc.start();
            osc.stop(ctx.currentTime + 0.4);
        } else if (type === 'start') {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.frequency.setValueAtTime(440, ctx.currentTime);
            osc.frequency.setValueAtTime(659.25, ctx.currentTime + 0.08);
            osc.frequency.setValueAtTime(880, ctx.currentTime + 0.16);
            gain.gain.setValueAtTime(0.12, ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
            osc.start();
            osc.stop(ctx.currentTime + 0.3);
        } else if (type === 'burst_complete') {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.frequency.setValueAtTime(523.25, ctx.currentTime);
            osc.frequency.setValueAtTime(659.25, ctx.currentTime + 0.1);
            osc.frequency.setValueAtTime(783.99, ctx.currentTime + 0.2);
            osc.frequency.setValueAtTime(1046.5, ctx.currentTime + 0.3);
            gain.gain.setValueAtTime(0.15, ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);
            osc.start();
            osc.stop(ctx.currentTime + 0.5);
        }
    } catch {
        // AudioContext not allowed or disabled
    }
};

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

// ─── SVG Spline Line Chart (Elite Pro Specification) ───────────────────────────

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
                                        ? '#ffffff'
                                        : isUnder
                                          ? '#10b981'
                                          : '#f59e0b'
                                }
                                stroke='#8b5cf6'
                                strokeWidth={1.5}
                            />
                            <text
                                x={p.x}
                                y={p.y - 8}
                                textAnchor='middle'
                                fill={isLatest ? '#ffffff' : '#c084fc'}
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


// Digit Extraction Helper
const extractLastDigit = (quote: number | string, pip = 2): number => {
    const p = Number(quote);
    if (isNaN(p)) return 0;
    const fixed = p.toFixed(pip);
    const lastChar = fixed[fixed.length - 1];
    const digit = parseInt(lastChar, 10);
    return isNaN(digit) ? 0 : digit;
};

// ─── Main OVERLORD AI Component ───────────────────────────────────────────────

const OverlordAi: React.FC = observer(() => {
    const store = useStore();
    const { client, transactions, summary_card, run_panel } = store || {};
    const currency = client?.currency || 'USD';
    // ── Market States ──
    const [selectedSymbol, setSelectedSymbol] = useState<string>('R_100');
    const scanAllMarkets = true;
    const [marketSearchTerm, setMarketSearchTerm] = useState<string>('');
    const [autoPickBestMarket, setAutoPickBestMarket] = useState<boolean>(true);
    const [mobileActiveTab, setMobileActiveTab] = useState<
        'DASHBOARD' | 'AUTOTRADER' | 'MARKETS' | 'TRADES'
    >('DASHBOARD');

    // ── Markets Tick Storage ──
    const marketsDataRef = useRef<Map<string, MarketDigitState>>(
        new Map(
            DERIVED_SYNTHETIC_MARKETS.map(m => [
                m.symbol,
                {
                    symbol: m.symbol,
                    label: m.label,
                    digits: [],
                    currentPrice: '0.00',
                    lastDigit: 0,
                    pip: m.pip,
                },
            ])
        )
    );

    const subscriptionsRef = useRef<Map<string, { unsubscribe?: () => void }>>(new Map());
    const [renderTrigger, setRenderTrigger] = useState<number>(0);
    const isMountedRef = useRef<boolean>(true);
    const throttleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // ── User Configuration & Strategy Parameters ──
    const [manualStake, setManualStake] = useState<string>('1.00');
    const [takeProfit, setTakeProfit] = useState<string>('20.00');
    const [stopLoss, setStopLoss] = useState<string>('0.00');
    const [strategyMode, setStrategyMode] = useState<OverlordStrategyMode>('ALL_AUTO');
    const [martingaleMultiplier, setMartingaleMultiplier] = useState<string>('2.6');
    const [isMartingaleEnabled] = useState<boolean>(true);

    // ── Continuous Burst Trading & Market Rotation ──
    const [burstRunSize, setBurstRunSize] = useState<number>(10); // 7 to 12 runs default: 10
    const [currentBurstRun, setCurrentBurstRun] = useState<number>(0);
    const [burstCountTotal, setBurstCountTotal] = useState<number>(0);
    const [marketRotationRuns, setMarketRotationRuns] = useState<number>(4); // Change market after 4 runs
    const [isMarketRotationEnabled] = useState<boolean>(true);

    // ── Session State & Execution Engine ──
    const [botState, setBotState] = useState<AutoRunState>('IDLE');
    const [currentStake, setCurrentStake] = useState<number>(1.0);
    const [isInRecovery, setIsInRecovery] = useState<boolean>(false);
    const [, setMartingaleStage] = useState<number>(0);
    const [winsCount, setWinsCount] = useState<number>(0);
    const [lossesCount, setLossesCount] = useState<number>(0);
    const [sessionProfit, setSessionProfit] = useState<number>(0);
    const [tradeLog, setTradeLog] = useState<TradeLogItem[]>([]);
    const [soundEnabled, setSoundEnabled] = useState<boolean>(true);
    const executionLockRef = useRef<boolean>(false);

    // Automation Engine control refs
    const [milestone, setMilestone] = useState<{ isOpen: boolean; type: 'tp' | 'sl' | null }>({
        isOpen: false,
        type: null,
    });
    const botStateRef = useRef<AutoRunState>('IDLE');
    const autoAbortRef = useRef<AbortController | null>(null);
    const sessionProfitRef = useRef<number>(0);
    const currentStakeRef = useRef<number>(1.0);
    const selectedSymbolRef = useRef<string>(selectedSymbol);
    const burstRunRef = useRef<number>(0);
    const burstCountRef = useRef<number>(0);
    const runsOnMarketRef = useRef<number>(0);
    const contractStreamAbortRef = useRef<Set<AbortController>>(new Set());

    useEffect(() => {
        selectedSymbolRef.current = selectedSymbol;
    }, [selectedSymbol]);

    // Initial Manual Stake parse
    const initialBaseStake = useMemo(() => {
        const parsed = parseFloat(manualStake);
        return isNaN(parsed) || parsed <= 0 ? 1.0 : parsed;
    }, [manualStake]);

    // Throttle UI rerenders for maximum frame-rate
    const throttleRender = useCallback(() => {
        if (!throttleTimerRef.current) {
            throttleTimerRef.current = setTimeout(() => {
                throttleTimerRef.current = null;
                if (isMountedRef.current) {
                    setRenderTrigger(prev => prev + 1);
                }
            }, 120);
        }
    }, []);

    // ── Stream Refresh Listener ──
    const [streamRefreshKey, setStreamRefreshKey] = useState(0);
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

    // ── WebSocket Tick Ingestion ──
    useEffect(() => {
        isMountedRef.current = true;
        const activeSymbols = scanAllMarkets
            ? DERIVED_SYNTHETIC_MARKETS.map(m => m.symbol)
            : [selectedSymbol];
        const activeSubs = subscriptionsRef.current;

        const subscribeSymbol = async (sym: string) => {
            if (!isMountedRef.current || !api_base?.api) return;
            if (activeSubs.has(sym)) return;

            try {
                const marketMeta = DERIVED_SYNTHETIC_MARKETS.find(m => m.symbol === sym);
                const pip = marketMeta?.pip || 2;

                // 1. Fetch initial tick history so the UI is immediately populated
                const mData = marketsDataRef.current.get(sym);
                if (mData && mData.digits.length < 20) {
                    const res = await api_base.api.send({
                        ticks_history: sym,
                        end: 'latest',
                        count: 1000,
                        style: 'ticks',
                    });
                    if (res?.history?.prices && isMountedRef.current) {
                        const prices: number[] = res.history.prices || [];
                        const digits = prices.map(p => extractLastDigit(p, pip));
                        mData.digits = digits.slice(-MAX_HISTORY_TICKS);
                        if (prices.length > 0) {
                            const lastPrice = prices[prices.length - 1];
                            mData.currentPrice = Number(lastPrice).toFixed(pip);
                            mData.lastDigit = extractLastDigit(lastPrice, pip);
                        }
                        throttleRender();
                    }
                }

                if (activeSubs.has(sym)) return;

                // 2. Subscribe to real-time live ticks via centralized multiplexer
                const sub = subscribeTicks(sym, (res: Record<string, unknown>) => {
                    if (!isMountedRef.current) return;
                    const tickData = res?.tick as { quote?: number | string } | undefined;
                    const quote = tickData?.quote;
                    if (quote !== undefined && quote !== null) {
                        const digit = extractLastDigit(quote, pip);
                        const activeM = marketsDataRef.current.get(sym);
                        if (activeM) {
                            activeM.digits.push(digit);
                            if (activeM.digits.length > MAX_HISTORY_TICKS) {
                                activeM.digits.shift();
                            }
                            activeM.currentPrice = Number(quote).toFixed(pip);
                            activeM.lastDigit = digit;
                            activeM.tickCount = (activeM.tickCount || 0) + 1;
                            throttleRender();
                        }
                    }
                });

                activeSubs.set(sym, sub);
            } catch (err) {
                console.warn(`[Overlord AI] Stream setup error for ${sym}:`, err);
            }
        };

        const initAll = async () => {
            if (!api_base?.api || (api_base.api as any)?.connection?.readyState !== 1) {
                try {
                    await api_base.waitForConnection(3000);
                } catch {}
            }
            if (!api_base?.api) {
                if (isMountedRef.current) {
                    setTimeout(initAll, 1000);
                }
                return;
            }

            // Immediately load selected market first for fast UI render
            await subscribeSymbol(selectedSymbol);

            // Then asynchronously stream remaining markets
            for (const sym of activeSymbols) {
                if (!isMountedRef.current) break;
                if (sym !== selectedSymbol) {
                    await subscribeSymbol(sym);
                    await new Promise(r => setTimeout(r, 60)); // Rate limiting guard
                }
            }
        };

        void initAll();

        return () => {
            // Streams persist across renders
        };
    }, [scanAllMarkets, selectedSymbol, throttleRender, streamRefreshKey]);

    // Current Selected Market State
    const currentMarket = useMemo(() => {
        return (
            marketsDataRef.current.get(selectedSymbol) || {
                symbol: selectedSymbol,
                label: 'Selected Volatility',
                digits: [],
                currentPrice: '0.00',
                lastDigit: 0,
                pip: 2,
            }
        );
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedSymbol, renderTrigger]);

// ── Pure Overlord AI Statistical Analysis Function ──
const evaluateOverlordAnalysis = (
    digits: number[],
    mode: OverlordStrategyMode,
    lastDigit: number
) => {
    const totalTicks = digits.length;

    const frequencies: Record<number, number> = {
        0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 7: 0, 8: 0, 9: 0,
    };

    digits.forEach(d => {
        if (frequencies[d] !== undefined) frequencies[d]++;
    });

    const sampleSize = Math.max(1, totalTicks);
    const percentages: Record<number, number> = {};
    for (let i = 0; i <= 9; i++) {
        percentages[i] = Math.round((frequencies[i] / sampleSize) * 1000) / 10;
    }

    // Low Digits (0–4) vs High Digits (5–9)
    const lowCount = [0, 1, 2, 3, 4].reduce((sum, d) => sum + frequencies[d], 0);
    const lowRatio = Math.round((lowCount / sampleSize) * 100);
    const highRatio = 100 - lowRatio;

    // Specific Barriers Frequency
    const under8Count = [0, 1, 2, 3, 4, 5, 6, 7].reduce((s, d) => s + frequencies[d], 0);
    const over1Count = [2, 3, 4, 5, 6, 7, 8, 9].reduce((s, d) => s + frequencies[d], 0);
    const under7Count = [0, 1, 2, 3, 4, 5, 6].reduce((s, d) => s + frequencies[d], 0);
    const over2Count = [3, 4, 5, 6, 7, 8, 9].reduce((s, d) => s + frequencies[d], 0);
    const under6Count = [0, 1, 2, 3, 4, 5].reduce((s, d) => s + frequencies[d], 0);
    const over3Count = [4, 5, 6, 7, 8, 9].reduce((s, d) => s + frequencies[d], 0);

    const under8Pct = Math.round((under8Count / sampleSize) * 100);
    const over1Pct = Math.round((over1Count / sampleSize) * 100);
    const under7Pct = Math.round((under7Count / sampleSize) * 100);
    const over2Pct = Math.round((over2Count / sampleSize) * 100);
    const under6Pct = Math.round((under6Count / sampleSize) * 100);
    const over3Pct = Math.round((over3Count / sampleSize) * 100);

    // Micro-momentum (last 10 ticks)
    const last10 = digits.slice(-10);
    const last10Low = last10.filter(d => d <= 4).length;
    const last10High = 10 - last10Low;
    const last10Under = last10.filter(d => d <= 5).length;
    const last10Over = last10.filter(d => d >= 4).length;

    // Highest Entry Digit in Under (0-5) & Over (4-9)
    let highestUnderDigit = 0;
    let maxUnderCount = -1;
    for (let i = 0; i <= 5; i++) {
        if (frequencies[i] > maxUnderCount) {
            maxUnderCount = frequencies[i];
            highestUnderDigit = i;
        }
    }

    let highestOverDigit = 9;
    let maxOverCount = -1;
    for (let i = 4; i <= 9; i++) {
        if (frequencies[i] > maxOverCount) {
            maxOverCount = frequencies[i];
            highestOverDigit = i;
        }
    }

    // Strategy Resolution
    let chosenStrategy: OverlordStrategyMode = mode;
    if (mode === 'ALL_AUTO') {
        const scores = [
            { mode: 'OVER_1_UNDER_8' as OverlordStrategyMode, edge: Math.max(under8Pct, over1Pct) },
            { mode: 'OVER_2_UNDER_7' as OverlordStrategyMode, edge: Math.max(under7Pct, over2Pct) },
            { mode: 'OVER_3_UNDER_6' as OverlordStrategyMode, edge: Math.max(under6Pct, over3Pct) },
        ];
        scores.sort((a, b) => b.edge - a.edge);
        chosenStrategy = scores[0].mode;
    }

    let targetBarrier = 8;
    let signal: 'UNDER' | 'OVER' | 'NEUTRAL' = 'NEUTRAL';
    let signalConfidence = 50;
    let isTriggerReady = false;
    let triggerDigits: number[] = [];

    const isUnderCondition = lowRatio >= 55 || (under6Count >= over3Count && last10Under >= 7);
    const isOverCondition = highRatio >= 55 || (over3Count >= under6Count && last10Over >= 7);

    if (chosenStrategy === 'OVER_1_UNDER_8') {
        const isUnderFavored = under8Count >= over1Count;
        if (isUnderFavored && (isUnderCondition || under8Pct >= 70)) {
            signal = 'UNDER';
            targetBarrier = 8;
            signalConfidence = Math.min(99, Math.round(under8Pct * 0.95 + (last10Under >= 7 ? 5 : 0)));
            triggerDigits = [0, 1, 2, 3, 4, 5, 6, 7];
            isTriggerReady = lastDigit === highestUnderDigit || (last10Under >= 7 && lastDigit <= 4);
        } else if (!isUnderFavored && (isOverCondition || over1Pct >= 70)) {
            signal = 'OVER';
            targetBarrier = 1;
            signalConfidence = Math.min(99, Math.round(over1Pct * 0.95 + (last10Over >= 7 ? 5 : 0)));
            triggerDigits = [2, 3, 4, 5, 6, 7, 8, 9];
            isTriggerReady = lastDigit === highestOverDigit || (last10Over >= 7 && lastDigit >= 5);
        }
    } else if (chosenStrategy === 'OVER_2_UNDER_7') {
        const isUnderFavored = under7Count >= over2Count;
        if (isUnderFavored && (isUnderCondition || under7Pct >= 65)) {
            signal = 'UNDER';
            targetBarrier = 7;
            signalConfidence = Math.min(95, Math.round(under7Pct * 0.95 + (last10Under >= 7 ? 5 : 0)));
            triggerDigits = [0, 1, 2, 3, 4, 5, 6];
            isTriggerReady = lastDigit === highestUnderDigit || (last10Under >= 7 && lastDigit <= 3);
        } else if (!isUnderFavored && (isOverCondition || over2Pct >= 65)) {
            signal = 'OVER';
            targetBarrier = 2;
            signalConfidence = Math.min(95, Math.round(over2Pct * 0.95 + (last10Over >= 7 ? 5 : 0)));
            triggerDigits = [3, 4, 5, 6, 7, 8, 9];
            isTriggerReady = lastDigit === highestOverDigit || (last10Over >= 7 && lastDigit >= 6);
        }
    } else if (chosenStrategy === 'OVER_3_UNDER_6') {
        const isUnderFavored = under6Count >= over3Count;
        if (isUnderFavored && (isUnderCondition || under6Pct >= 55)) {
            signal = 'UNDER';
            targetBarrier = 6;
            signalConfidence = Math.min(92, Math.round(under6Pct * 0.95 + (last10Under >= 7 ? 5 : 0)));
            triggerDigits = [0, 1, 2, 3, 4, 5];
            isTriggerReady = lastDigit === highestUnderDigit || (last10Under >= 8 && lastDigit <= 2);
        } else if (!isUnderFavored && (isOverCondition || over3Pct >= 55)) {
            signal = 'OVER';
            targetBarrier = 3;
            signalConfidence = Math.min(92, Math.round(over3Pct * 0.95 + (last10Over >= 7 ? 5 : 0)));
            triggerDigits = [4, 5, 6, 7, 8, 9];
            isTriggerReady = lastDigit === highestOverDigit || (last10Over >= 8 && lastDigit >= 7);
        }
    }

    // Find Highest & Lowest Frequency Digits
    let highestDigit = 0;
    let highestFreq = -1;
    let lowestDigit = 0;
    let lowestFreq = 999999;

    for (let i = 0; i <= 9; i++) {
        if (frequencies[i] > highestFreq) {
            highestFreq = frequencies[i];
            highestDigit = i;
        }
        if (frequencies[i] < lowestFreq) {
            lowestFreq = frequencies[i];
            lowestDigit = i;
        }
    }

    return {
        totalTicks,
        frequencies,
        percentages,
        lowRatio,
        highRatio,
        under8Pct,
        over1Pct,
        under7Pct,
        over2Pct,
        under6Pct,
        over3Pct,
        last10Low,
        last10High,
        chosenStrategy,
        signal,
        targetBarrier,
        signalConfidence,
        isTriggerReady,
        triggerDigits,
        highestDigit,
        lowestDigit,
    };
};

    // ── Smart AI Pattern & Statistical Analysis Engine ──
    const patternEngine = useMemo(() => {
        return evaluateOverlordAnalysis(currentMarket.digits, strategyMode, currentMarket.lastDigit);
    }, [currentMarket.digits, currentMarket.lastDigit, strategyMode, renderTrigger]);

    // ── Multi-Market Cross Scanner Ranking ──
    const rankedMarketCandidates = useMemo(() => {
        return DERIVED_SYNTHETIC_MARKETS.map(meta => {
            const data = marketsDataRef.current.get(meta.symbol);
            const digits = data?.digits || [];
            const count = digits.length;
            if (count < 20) {
                return {
                    ...meta,
                    digitsCount: count,
                    bias: 'NEUTRAL',
                    score: 50,
                    lastDigit: data?.lastDigit || 0,
                    currentPrice: data?.currentPrice || '0.00',
                };
            }

            const lowC = digits.filter(d => d <= 4).length;
            const lowPct = Math.round((lowC / count) * 100);
            const last10 = digits.slice(-10);
            const last10Low = last10.filter(d => d <= 4).length;

            let score = 50;
            let bias: 'UNDER' | 'OVER' | 'NEUTRAL' = 'NEUTRAL';

            if (lowPct >= 56 || last10Low >= 7) {
                bias = 'UNDER';
                score = Math.min(99, 50 + (lowPct - 50) * 2.5 + (last10Low - 5) * 6);
            } else if (lowPct <= 44 || last10Low <= 3) {
                bias = 'OVER';
                score = Math.min(99, 50 + (50 - lowPct) * 2.5 + (5 - last10Low) * 6);
            }

            return {
                ...meta,
                digitsCount: count,
                bias,
                score: Math.round(score),
                lastDigit: data?.lastDigit || 0,
                currentPrice: data?.currentPrice || '0.00',
            };
        }).sort((a, b) => b.score - a.score);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [renderTrigger]);

    // Push Contract Details to Deriv System Drawer & Run Panel
    const pushContractToDrawer = useCallback(
        (poc: any) => {
            try {
                if (summary_card) {
                    summary_card.contract_info = poc;
                    if (summary_card.onBotContractEvent) {
                        summary_card.onBotContractEvent(poc);
                    }
                }
                if (transactions?.onBotContractEvent) {
                    transactions.onBotContractEvent(poc);
                }
                if (run_panel?.onBotContractEvent) {
                    run_panel.onBotContractEvent(poc);
                }
                globalObserver.emit('bot.contract', poc);

                if (poc?.is_sold) {
                    globalObserver.emit('contract.status', {
                        id: 'contract.sold',
                        contract: poc,
                        data: poc.transaction_ids?.sell || poc.contract_id,
                    });
                }
            } catch (err) {
                console.debug('[Overlord AI] Drawer update notice:', err);
            }
        },
        [summary_card, transactions, run_panel]
    );

    // ── Trade Order Execution ──
    const executeTradeOrder = useCallback(
        async (
            symbolToTrade: string,
            contractType: 'DIGITOVER' | 'DIGITUNDER',
            barrierValue: number,
            stakeAmount: number,
            burstRunNumber: number
        ) => {
            if (executionLockRef.current) return;
            executionLockRef.current = true;

            const logId = `trade_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
            const newLog: TradeLogItem = {
                id: logId,
                timestamp: Date.now(),
                symbol: symbolToTrade,
                contractType,
                barrier: barrierValue,
                stake: stakeAmount,
                result: 'PENDING',
                profit: 0,
                burstRunIndex: burstRunNumber,
            };

            setTradeLog(prev => [newLog, ...prev.slice(0, 49)]);

            try {
                globalObserver.emit('bot.running');
                globalObserver.emit('contract.status', {
                    id: 'contract.purchase_sent',
                    data: stakeAmount,
                });

                const buyRes = await buyContractForUi({
                    parameters: {
                        amount: stakeAmount,
                        basis: 'stake',
                        contract_type: contractType,
                        currency,
                        duration: 1,
                        duration_unit: 't',
                        symbol: symbolToTrade,
                        barrier: String(barrierValue),
                    },
                    price: stakeAmount,
                    source: 'Overlord AI',
                });

                const contractId = buyRes.contract_id;

                globalObserver.emit('contract.status', {
                    id: 'contract.purchase_received',
                    buy: buyRes,
                    data: buyRes.transaction_id,
                });

                const settledContract = await streamContractUntilSettled({
                    contractId: Number(contractId),
                    source: 'Overlord AI',
                    onUpdate: (snapshot: any) => {
                        pushContractToDrawer(snapshot);
                    },
                    timeoutMs: 12000,
                });

                pushContractToDrawer(settledContract);

                const isWon = settledContract.status === 'won' || settledContract.profit > 0;
                const profitVal = Number(settledContract.profit || 0);
                const exitDigit = extractLastDigit(settledContract.exit_tick || settledContract.current_spot || 0);

                // Update Session Log
                setTradeLog(prev =>
                    prev.map(item =>
                        item.id === logId
                            ? {
                                  ...item,
                                  result: isWon ? 'WIN' : 'LOSS',
                                  profit: profitVal,
                                  exitDigit,
                              }
                            : item
                    )
                );

                // Update Session Statistics
                if (isWon) {
                    if (soundEnabled) playSoundCue('win');
                    setWinsCount(w => w + 1);
                    const nextProfit = Math.round((sessionProfitRef.current + profitVal) * 100) / 100;
                    sessionProfitRef.current = nextProfit;
                    setSessionProfit(nextProfit);
                    setIsInRecovery(false);
                    setMartingaleStage(0);
                    currentStakeRef.current = initialBaseStake;
                    setCurrentStake(initialBaseStake);
                } else {
                    if (soundEnabled) playSoundCue('loss');
                    setLossesCount(l => l + 1);
                    const nextProfit = Math.round((sessionProfitRef.current + profitVal) * 100) / 100;
                    sessionProfitRef.current = nextProfit;
                    setSessionProfit(nextProfit);

                    if (isMartingaleEnabled) {
                        setIsInRecovery(true);
                        setMartingaleStage((s: number) => s + 1);
                        const mult = parseFloat(martingaleMultiplier) || 2.5;
                        const nextStakeVal = Math.round(stakeAmount * mult * 100) / 100;
                        currentStakeRef.current = nextStakeVal;
                        setCurrentStake(nextStakeVal);
                    } else {
                        currentStakeRef.current = initialBaseStake;
                        setCurrentStake(initialBaseStake);
                    }
                }

                return isWon;
            } catch (tradeErr: any) {
                console.error('[Overlord AI] Trade error:', tradeErr);
                setTradeLog(prev =>
                    prev.map(item =>
                        item.id === logId ? { ...item, result: 'LOSS', profit: -stakeAmount } : item
                    )
                );
                setLossesCount(l => l + 1);
                const nextProfit = Math.round((sessionProfitRef.current - stakeAmount) * 100) / 100;
                sessionProfitRef.current = nextProfit;
                setSessionProfit(nextProfit);
                return false;
            } finally {
                executionLockRef.current = false;
            }
        },
        [
            currency,
            pushContractToDrawer,
            soundEnabled,
            initialBaseStake,
            isMartingaleEnabled,
            martingaleMultiplier,
        ]
    );

    // Synchronize bot state helper
    const setBotStateSync = useCallback((newState: AutoRunState) => {
        botStateRef.current = newState;
        setBotState(newState);
    }, []);

    // Stop Auto Trading Engine
    const stopAutoTrading = useCallback(() => {
        setBotStateSync('IDLE');
        autoAbortRef.current?.abort();
        contractStreamAbortRef.current.forEach(c => c.abort());
        contractStreamAbortRef.current.clear();
        setCurrentBurstRun(0);
        burstRunRef.current = 0;
    }, [setBotStateSync]);

    // Start Auto Trading Engine Loop
    const startAutoTrading = useCallback(async () => {
        const loggedIn = Boolean(client?.is_logged_in || isLoggedIn() || api_base.is_authorized);
        if (!loggedIn) {
            const oauthUrl = await generateOAuthURL();
            if (oauthUrl) window.location.href = oauthUrl;
            return;
        }

        if (botStateRef.current !== 'IDLE' && botStateRef.current !== 'PAUSED') return;

        if (botStateRef.current === 'IDLE') {
            setSessionProfit(0);
            sessionProfitRef.current = 0;
            setWinsCount(0);
            setLossesCount(0);
            setCurrentBurstRun(0);
            burstRunRef.current = 0;
            setBurstCountTotal(0);
            runsOnMarketRef.current = 0;
            setIsInRecovery(false);
            setMartingaleStage(0);
        }

        const tp = parseFloat(takeProfit) || 20.0;
        const sl = parseFloat(stopLoss) || 50.0;
        const baseStake = initialBaseStake;
        currentStakeRef.current = baseStake;
        setCurrentStake(baseStake);

        if (soundEnabled) playSoundCue('start');

        setBotStateSync('SCANNING');
        autoAbortRef.current = new AbortController();
        const abortSignal = autoAbortRef.current.signal;
        let lastProcessedTick = -1;

        const loop = async () => {
            while (!abortSignal.aborted && botStateRef.current !== 'IDLE') {
                if (botStateRef.current === 'PAUSED') {
                    await new Promise(r => setTimeout(r, 600));
                    continue;
                }

                // Check Take Profit & Stop Loss
                if (sessionProfitRef.current >= tp && tp > 0) {
                    setBotStateSync('TP_REACHED');
                    if (soundEnabled) playSoundCue('burst_complete');
                    setMilestone({ isOpen: true, type: 'tp' });
                    break;
                }
                if (sessionProfitRef.current <= -sl && sl > 0) {
                    setBotStateSync('SL_REACHED');
                    if (soundEnabled) playSoundCue('loss');
                    setMilestone({ isOpen: true, type: 'sl' });
                    break;
                }

                // Determine active market
                let targetSym = selectedSymbolRef.current;
                if (autoPickBestMarket && rankedMarketCandidates.length > 0 && burstRunRef.current === 0) {
                    const bestCand = rankedMarketCandidates[0];
                    if (bestCand && bestCand.score >= 60 && bestCand.symbol !== targetSym) {
                        targetSym = bestCand.symbol;
                        selectedSymbolRef.current = targetSym;
                        setSelectedSymbol(targetSym);
                        lastProcessedTick = -1;
                    }
                }

                const mData = marketsDataRef.current.get(targetSym);
                if (!mData || mData.digits.length < 15) {
                    if (botStateRef.current !== 'SCANNING') setBotStateSync('SCANNING');
                    await new Promise(r => setTimeout(r, 400));
                    continue;
                }

                const currTickCount = mData.tickCount || 0;
                // Wait for a fresh live tick from the stream before processing
                if (lastProcessedTick !== -1 && currTickCount <= lastProcessedTick) {
                    await new Promise(r => setTimeout(r, 40));
                    continue;
                }
                lastProcessedTick = currTickCount;

                // Evaluate entry conditions dynamically on live incoming digits
                const liveAnalysis = evaluateOverlordAnalysis(mData.digits, strategyMode, mData.lastDigit);
                const signal = liveAnalysis.signal;
                const barrier = liveAnalysis.targetBarrier;
                const isTriggerReady = liveAnalysis.isTriggerReady;
                const confidence = liveAnalysis.signalConfidence;

                if (signal === 'NEUTRAL' || confidence < 55) {
                    if (botStateRef.current !== 'WAITING_SIGNAL') {
                        setBotStateSync('WAITING_SIGNAL');
                    }
                    await new Promise(r => setTimeout(r, 100));
                    continue;
                }

                if (!isTriggerReady) {
                    if (botStateRef.current !== 'WAITING_TRIGGER') {
                        setBotStateSync('WAITING_TRIGGER');
                    }
                    await new Promise(r => setTimeout(r, 60));
                    continue;
                }

                // Signal & Trigger confirmed -> Execute 1 verified trade in the burst sequence
                setBotStateSync('BURST_TRADING');
                const targetBurstSize = Math.max(1, burstRunSize);
                const currentRunNumber = burstRunRef.current + 1;
                burstRunRef.current = currentRunNumber;
                setCurrentBurstRun(currentRunNumber);
                runsOnMarketRef.current += 1;

                const contractType = signal === 'OVER' ? 'DIGITOVER' : 'DIGITUNDER';
                const stakeToUse = currentStakeRef.current;

                try {
                    await executeTradeOrder(
                        targetSym,
                        contractType,
                        barrier,
                        stakeToUse,
                        currentRunNumber
                    );
                } catch (tradeError) {
                    console.error('[Overlord AI] Error executing trade:', tradeError);
                }

                if (abortSignal.aborted || (botStateRef.current as string) === 'IDLE') break;

                // Check Take Profit / Stop Loss immediately after settlement
                if (sessionProfitRef.current >= tp && tp > 0) {
                    setBotStateSync('TP_REACHED');
                    if (soundEnabled) playSoundCue('burst_complete');
                    setMilestone({ isOpen: true, type: 'tp' });
                    break;
                }
                if (sessionProfitRef.current <= -sl && sl > 0) {
                    setBotStateSync('SL_REACHED');
                    if (soundEnabled) playSoundCue('loss');
                    setMilestone({ isOpen: true, type: 'sl' });
                    break;
                }

                // Check if full burst streak completed
                if (burstRunRef.current >= targetBurstSize) {
                    if (soundEnabled) playSoundCue('burst_complete');
                    burstRunRef.current = 0;
                    setCurrentBurstRun(0);
                    burstCountRef.current += 1;
                    setBurstCountTotal(burstCountRef.current);

                    setBotStateSync('BURST_PAUSED');

                    // Market rotation check
                    if (
                        isMarketRotationEnabled &&
                        (runsOnMarketRef.current >= marketRotationRuns || autoPickBestMarket) &&
                        rankedMarketCandidates.length > 0
                    ) {
                        const nextCandidate =
                            rankedMarketCandidates.find(c => c.symbol !== targetSym && c.score >= 60) ||
                            rankedMarketCandidates[0];
                        if (nextCandidate && nextCandidate.symbol !== targetSym) {
                            targetSym = nextCandidate.symbol;
                            selectedSymbolRef.current = targetSym;
                            setSelectedSymbol(targetSym);
                            runsOnMarketRef.current = 0;
                            lastProcessedTick = -1;
                        }
                    }

                    await new Promise(r => setTimeout(r, 600));
                    if (!abortSignal.aborted && botStateRef.current === 'BURST_PAUSED') {
                        setBotStateSync('SCANNING');
                    }
                } else {
                    // Continue burst streak on next tick
                    setBotStateSync('SCANNING');
                    await new Promise(r => setTimeout(r, 400));
                }
            }
        };

        void loop();
    }, [
        client?.is_logged_in,
        takeProfit,
        stopLoss,
        initialBaseStake,
        soundEnabled,
        setBotStateSync,
        autoPickBestMarket,
        rankedMarketCandidates,
        strategyMode,
        burstRunSize,
        executeTradeOrder,
        isMarketRotationEnabled,
        marketRotationRuns,
    ]);

    // TopBar controller status broadcast
    useEffect(() => {
        window.dispatchEvent(
            new CustomEvent('PH_ENGINE_STATUS_UPDATE', {
                detail: {
                    tab: 'overlord_ai',
                    isRunning: botState !== 'IDLE',
                    state: botState,
                    profit: sessionProfit,
                },
            })
        );
    }, [botState, sessionProfit]);

    // TopBar controller action listeners
    useEffect(() => {
        const handleTrigger = (e: Event) => {
            const customEvent = e as CustomEvent<{ tab: string; action?: string }>;
            if (customEvent.detail?.tab === 'overlord_ai') {
                const action = customEvent.detail.action;
                if (action === 'start') {
                    if (botStateRef.current === 'IDLE') {
                        void startAutoTrading();
                    }
                } else if (action === 'stop') {
                    if (botStateRef.current !== 'IDLE') {
                        stopAutoTrading();
                    }
                } else if (botStateRef.current === 'IDLE') {
                    void startAutoTrading();
                } else {
                    stopAutoTrading();
                }
            }
        };

        const handleGlobalStop = () => {
            if (botStateRef.current !== 'IDLE') {
                stopAutoTrading();
            }
        };

        window.addEventListener('PH_TRIGGER_ENGINE_ACTION', handleTrigger);
        globalObserver.register('bot.manual_stop', handleGlobalStop);

        return () => {
            window.removeEventListener('PH_TRIGGER_ENGINE_ACTION', handleTrigger);
            globalObserver.unregister('bot.manual_stop', handleGlobalStop);
        };
    }, [startAutoTrading, stopAutoTrading]);

    // Unmount cleanup
    useEffect(() => {
        const abortControllers = contractStreamAbortRef.current;
        return () => {
            botStateRef.current = 'IDLE';
            autoAbortRef.current?.abort();
            abortControllers.forEach(c => c.abort());
            abortControllers.clear();
        };
    }, []);

    // Filtered Market List for Search
    const filteredMarkets = useMemo(() => {
        if (!marketSearchTerm.trim()) return DERIVED_SYNTHETIC_MARKETS;
        const term = marketSearchTerm.toLowerCase();
        return DERIVED_SYNTHETIC_MARKETS.filter(
            m => m.label.toLowerCase().includes(term) || m.symbol.toLowerCase().includes(term)
        );
    }, [marketSearchTerm]);

    // Controls Action Handlers
    const handleResetStats = () => {
        setWinsCount(0);
        setLossesCount(0);
        setSessionProfit(0);
        sessionProfitRef.current = 0;
        setTradeLog([]);
        setCurrentBurstRun(0);
        burstRunRef.current = 0;
        setBurstCountTotal(0);
        burstCountRef.current = 0;
        setMartingaleStage(0);
        setIsInRecovery(false);
        setCurrentStake(initialBaseStake);
        currentStakeRef.current = initialBaseStake;
    };

    // Quick Stake Setters
    const handleAdjustStake = (delta: number) => {
        const current = parseFloat(manualStake) || 1.0;
        const next = Math.max(0.35, Math.round((current + delta) * 100) / 100);
        setManualStake(next.toFixed(2));
    };

    const totalTrades = winsCount + lossesCount;
    const winRate = totalTrades > 0 ? Math.round((winsCount / totalTrades) * 100) : 0;

    return (
        <div className='overlord-ai-wrapper'>
            {/* ── Master Configuration Deck (Market & Trading Parameters) ── */}
            <div className='overlord-master-config-deck'>
                {/* Row 1: Execution Control & Market Configuration */}
                <div className='config-deck-row'>
                    <div className='deck-action-group'>
                        {botState === 'IDLE' || botState === 'PAUSED' || botState === 'TP_REACHED' || botState === 'SL_REACHED' ? (
                            <button
                                type='button'
                                className='btn-control btn-autotrade-start'
                                data-testid='overlord_ai_toggle'
                                onClick={() => void startAutoTrading()}
                            >
                                <Play size={16} /> START AI TRADER
                            </button>
                        ) : (
                            <button
                                type='button'
                                className='btn-control btn-autotrade-stop'
                                data-testid='overlord_ai_toggle'
                                onClick={stopAutoTrading}
                            >
                                <Square size={16} /> STOP TRADING
                            </button>
                        )}

                        <button
                            type='button'
                            className={`btn-control btn-best-market ${autoPickBestMarket ? 'active' : ''}`}
                            onClick={() => setAutoPickBestMarket(!autoPickBestMarket)}
                            title='Auto-select the highest scoring volatility market'
                        >
                            <Sparkles size={14} />
                            {autoPickBestMarket ? 'AUTO-MARKET ACTIVE' : 'MANUAL MARKET'}
                        </button>
                    </div>

                    {/* Market Configs: Active Market Dropdown & Market Rotation */}
                    <div className='deck-market-configs'>
                        <div className='config-field'>
                            <label className='field-label'>
                                <Radio size={12} className='field-icon' /> TARGET MARKET
                            </label>
                            <select
                                className='config-select'
                                value={selectedSymbol}
                                onChange={e => {
                                    setSelectedSymbol(e.target.value);
                                    setAutoPickBestMarket(false);
                                }}
                            >
                                {DERIVED_SYNTHETIC_MARKETS.map(m => (
                                    <option key={m.symbol} value={m.symbol}>
                                        {m.label} ({m.symbol})
                                    </option>
                                ))}
                            </select>
                        </div>

                        <div className='config-field'>
                            <label className='field-label'>
                                <RotateCcw size={12} className='field-icon' /> MARKET ROTATION
                            </label>
                            <select
                                className='config-select'
                                value={marketRotationRuns}
                                onChange={e => setMarketRotationRuns(Number(e.target.value))}
                            >
                                <option value={3}>Every 3 Runs</option>
                                <option value={4}>Every 4 Runs</option>
                                <option value={6}>Every 6 Runs</option>
                                <option value={10}>After Every Burst</option>
                            </select>
                        </div>

                        <button
                            type='button'
                            className='btn-sound-toggle'
                            title='Toggle Sound Cues'
                            onClick={() => setSoundEnabled(!soundEnabled)}
                        >
                            {soundEnabled ? <Volume2 size={16} /> : <VolumeX size={16} />}
                        </button>
                    </div>
                </div>

                {/* Row 2: Strategy, Stake, Burst Runs, TP, SL, Martingale */}
                <div className='config-deck-row parameters-row'>
                    <div className='strategy-mode-group'>
                        <span className='field-label'>STRATEGY MODE</span>
                        <div className='strategy-pills-wrap'>
                            <button
                                type='button'
                                className={`strat-pill ${strategyMode === 'ALL_AUTO' ? 'active' : ''}`}
                                onClick={() => setStrategyMode('ALL_AUTO')}
                            >
                                <Sparkles size={11} /> ALL AUTO
                            </button>
                            <button
                                type='button'
                                className={`strat-pill ${strategyMode === 'OVER_1_UNDER_8' ? 'active' : ''}`}
                                onClick={() => setStrategyMode('OVER_1_UNDER_8')}
                            >
                                Over 1 / Under 8
                            </button>
                            <button
                                type='button'
                                className={`strat-pill ${strategyMode === 'OVER_2_UNDER_7' ? 'active' : ''}`}
                                onClick={() => setStrategyMode('OVER_2_UNDER_7')}
                            >
                                Over 2 / Under 7
                            </button>
                            <button
                                type='button'
                                className={`strat-pill ${strategyMode === 'OVER_3_UNDER_6' ? 'active' : ''}`}
                                onClick={() => setStrategyMode('OVER_3_UNDER_6')}
                            >
                                Over 3 / Under 6
                            </button>
                        </div>
                    </div>

                    <div className='deck-inputs-grid'>
                        <div className='config-field mini-field'>
                            <label className='field-label'>STAKE ({currency})</label>
                            <div className='input-with-quick'>
                                <input
                                    type='number'
                                    step='0.1'
                                    min='0.35'
                                    className='config-input'
                                    value={manualStake}
                                    onChange={e => setManualStake(e.target.value)}
                                />
                                <div className='quick-stake-pills'>
                                    <button type='button' className='quick-pill' onClick={() => handleAdjustStake(1)}>+1</button>
                                    <button type='button' className='quick-pill' onClick={() => handleAdjustStake(5)}>+5</button>
                                    <button type='button' className='quick-pill' onClick={() => setManualStake('1.00')}>$1</button>
                                </div>
                            </div>
                        </div>

                        <div className='config-field mini-field'>
                            <label className='field-label'>BURST RUNS</label>
                            <select
                                className='config-select'
                                value={burstRunSize}
                                onChange={e => setBurstRunSize(Number(e.target.value))}
                            >
                                <option value={7}>7 Runs</option>
                                <option value={8}>8 Runs</option>
                                <option value={10}>10 Runs</option>
                                <option value={12}>12 Runs</option>
                            </select>
                        </div>

                        <div className='config-field mini-field'>
                            <label className='field-label'>TAKE PROFIT ($)</label>
                            <input
                                type='number'
                                className='config-input'
                                value={takeProfit}
                                onChange={e => setTakeProfit(e.target.value)}
                            />
                        </div>

                        <div className='config-field mini-field'>
                            <label className='field-label'>STOP LOSS ($)</label>
                            <input
                                type='number'
                                className='config-input'
                                value={stopLoss}
                                onChange={e => setStopLoss(e.target.value)}
                            />
                        </div>

                        <div className='config-field mini-field'>
                            <label className='field-label'>MARTINGALE</label>
                            <input
                                type='number'
                                step='0.1'
                                className='config-input'
                                value={martingaleMultiplier}
                                onChange={e => setMartingaleMultiplier(e.target.value)}
                            />
                        </div>
                    </div>
                </div>
            </div>

            {/* ── Mobile Segmented Navigation Bar ── */}
            <nav className='mobile-segmented-nav'>
                <button
                    type='button'
                    className={`nav-pill ${mobileActiveTab === 'DASHBOARD' ? 'active' : ''}`}
                    onClick={() => setMobileActiveTab('DASHBOARD')}
                >
                    <BarChart2 size={14} /> DASHBOARD
                </button>
                <button
                    type='button'
                    className={`nav-pill ${mobileActiveTab === 'MARKETS' ? 'active' : ''}`}
                    onClick={() => setMobileActiveTab('MARKETS')}
                >
                    <Radio size={14} /> MARKETS
                </button>
                <button
                    type='button'
                    className={`nav-pill ${mobileActiveTab === 'TRADES' ? 'active' : ''}`}
                    onClick={() => setMobileActiveTab('TRADES')}
                >
                    <Layers size={14} /> JOURNAL
                </button>
            </nav>

            {/* ── Main 3-Column Grid Layout ── */}
            <div className='overlord-main-layout'>
                {/* ── LEFT COLUMN: Market Scanner ── */}
                <aside
                    className={`overlord-side-scanner ${mobileActiveTab === 'MARKETS' ? 'mobile-active' : ''}`}
                >
                    <div className='scanner-header'>
                        <h3 className='scanner-title'>
                            <Radio size={14} /> SYNTHETICS SCANNER
                        </h3>
                    </div>

                    <div className='scanner-search-box'>
                        <input
                            type='text'
                            placeholder='Search markets...'
                            value={marketSearchTerm}
                            onChange={e => setMarketSearchTerm(e.target.value)}
                        />
                    </div>

                    <div className='market-list-scroll'>
                        {filteredMarkets.map(m => {
                            const marketData = marketsDataRef.current.get(m.symbol);
                            const ranked = rankedMarketCandidates.find(c => c.symbol === m.symbol);
                            const isSelected = m.symbol === selectedSymbol;
                            const lastD = marketData?.lastDigit || 0;
                            const isUnder = lastD <= 4;

                            return (
                                <div
                                    key={m.symbol}
                                    className={`market-item-card ${isSelected ? 'active' : ''}`}
                                    onClick={() => setSelectedSymbol(m.symbol)}
                                >
                                    <div className='market-header-row'>
                                        <span className='market-name'>{m.label}</span>
                                        <span
                                            className={`last-digit-badge ${isUnder ? 'digit-under' : 'digit-over'}`}
                                        >
                                            {lastD}
                                        </span>
                                    </div>
                                    <div className='market-data-row'>
                                        <span className='market-price'>
                                            {marketData?.currentPrice || '0.00'}
                                        </span>
                                        <span
                                            className={`market-bias-badge ${
                                                ranked?.bias === 'UNDER'
                                                    ? 'bias-under'
                                                    : ranked?.bias === 'OVER'
                                                    ? 'bias-over'
                                                    : 'bias-neutral'
                                            }`}
                                        >
                                            {ranked?.bias || 'NEUTRAL'} ({ranked?.score || 50}%)
                                        </span>
                                    </div>
                                    <div className='market-mini-bar'>
                                        <div
                                            className='mini-bar-under'
                                            style={{ width: `${ranked?.score || 50}%` }}
                                        />
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </aside>

                {/* ── CENTER COLUMN: Live Wave & Deep Analytics ── */}
                <main
                    className={`overlord-center-content ${mobileActiveTab === 'DASHBOARD' ? 'mobile-active' : ''}`}
                >
                    {/* Active Market Hero */}
                    <div className='active-market-hero'>
                        <div className='market-left-info'>
                            <h2 className='active-market-title'>{currentMarket.label}</h2>
                            <div className='active-price-display'>
                                <span className='price-label'>LIVE SPOT</span>
                                {currentMarket.currentPrice}
                            </div>
                        </div>

                        <div className='market-right-digit'>
                            <div className='last-digit-hero-box'>
                                <div
                                    className={`digit-avatar ${currentMarket.lastDigit <= 4 ? 'digit-under' : 'digit-over'}`}
                                >
                                    {currentMarket.lastDigit}
                                </div>
                                <div className='digit-labels'>
                                    <span className='digit-sub'>AI SIGNAL</span>
                                    <span
                                        className={`digit-type-text ${
                                            patternEngine.signal === 'UNDER'
                                                ? 'text-under'
                                                : patternEngine.signal === 'OVER'
                                                ? 'text-over'
                                                : ''
                                        }`}
                                    >
                                        {patternEngine.signal === 'NEUTRAL'
                                            ? 'SCANNING...'
                                            : `${patternEngine.signal} ${patternEngine.targetBarrier} (${patternEngine.signalConfidence}%)`}
                                    </span>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* ── 50-Ticks Spline Line Chart (Elite Pro Specification) ── */}
                    <div className='ep-glass ep-chart-card'>
                        <div className='ep-chart-card__header'>
                            <span className='title'>
                                📊 50-Ticks Digit Trend Line Chart — {currentMarket.label}
                            </span>
                            <span className='subtitle'>Real-Time Spline with Digit Markers (0–9)</span>
                        </div>
                        <div className='ep-chart-wrap'>
                            <DigitLineChart digits={currentMarket.digits} />
                        </div>
                    </div>

                    {/* Dual Statistical Analysis Grid */}
                    <div className='overlord-stats-dual-grid'>
                        <div className='stat-split-card'>
                            <div className='split-title-row'>
                                <span className='split-title'>LOW vs HIGH RATIO</span>
                                <span className='split-badge'>ENTROPY SCAN</span>
                            </div>
                            <div className='split-meter-box'>
                                <div className='meter-bar'>
                                    <div
                                        className='meter-left'
                                        style={{ width: `${patternEngine.lowRatio}%` }}
                                    />
                                    <div
                                        className='meter-right'
                                        style={{ width: `${patternEngine.highRatio}%` }}
                                    />
                                </div>
                                <div className='meter-labels'>
                                    <span className='label-left'>LOW (0–4): {patternEngine.lowRatio}%</span>
                                    <span className='label-right'>HIGH (5–9): {patternEngine.highRatio}%</span>
                                </div>
                            </div>
                            <div className='stat-metrics-row'>
                                <span>Recent Momentum (10 Ticks):</span>
                                <strong>
                                    {patternEngine.last10Low} Low / {patternEngine.last10High} High
                                </strong>
                            </div>
                        </div>

                        <div className='stat-split-card'>
                            <div className='split-title-row'>
                                <span className='split-title'>HIGH-PROBABILITY BARRIERS</span>
                                <span className='split-badge'>EDGE CALC</span>
                            </div>
                            <div className='stat-metrics-row'>
                                <span>Under 8 Frequency:</span>
                                <strong>{patternEngine.under8Pct}%</strong>
                            </div>
                            <div className='stat-metrics-row'>
                                <span>Under 7 Frequency:</span>
                                <strong>{patternEngine.under7Pct}%</strong>
                            </div>
                            <div className='stat-metrics-row'>
                                <span>Under 6 Frequency:</span>
                                <strong>{patternEngine.under6Pct}%</strong>
                            </div>
                        </div>
                    </div>

                    {/* Glowing Highest Entry Digit Panel & 0-9 Spectrum */}
                    <div className='glowing-entry-digits-panel'>
                        <div className='entry-digits-grid'>
                            <div
                                className={`entry-digit-card under-glow ${
                                    patternEngine.signal === 'UNDER' && patternEngine.isTriggerReady
                                        ? 'is-active-trigger'
                                        : ''
                                }`}
                            >
                                <div className='digit-orb orb-under'>
                                    {patternEngine.highestDigit}
                                </div>
                                <div className='entry-details'>
                                    <span className='entry-type'>DOMINANT HOT DIGIT</span>
                                    <span className='entry-status'>
                                        Digit {patternEngine.highestDigit} ({patternEngine.percentages[patternEngine.highestDigit]}%)
                                    </span>
                                    <span className='entry-subtext'>
                                        High probability catalyst for Under triggers
                                    </span>
                                </div>
                            </div>

                            <div
                                className={`entry-digit-card over-glow ${
                                    patternEngine.signal === 'OVER' && patternEngine.isTriggerReady
                                        ? 'is-active-trigger'
                                        : ''
                                }`}
                            >
                                <div className='digit-orb orb-over'>
                                    {patternEngine.lowestDigit}
                                </div>
                                <div className='entry-details'>
                                    <span className='entry-type'>COLD DIGIT / REVERSAL</span>
                                    <span className='entry-status'>
                                        Digit {patternEngine.lowestDigit} ({patternEngine.percentages[patternEngine.lowestDigit]}%)
                                    </span>
                                    <span className='entry-subtext'>
                                        Oversold anomaly for Over triggers
                                    </span>
                                </div>
                            </div>
                        </div>

                        {/* 0 to 9 Spectrum Bars */}
                        <div className='digit-spectrum-row'>
                            {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map(digit => {
                                const pct = patternEngine.percentages[digit] || 0;
                                const isHighest = digit === patternEngine.highestDigit;
                                const isUnder = digit <= 4;

                                return (
                                    <div
                                        key={digit}
                                        className={`spectrum-bar-item ${
                                            isUnder ? 'is-under' : 'is-over'
                                        } ${isHighest ? 'is-highest' : ''}`}
                                    >
                                        <span className='digit-num'>{digit}</span>
                                        <span className='digit-freq-pct'>{pct}%</span>
                                        <span className='digit-rank-badge'>
                                            {isHighest ? 'HOT' : `${digit}`}
                                        </span>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                </main>

                {/* ── RIGHT COLUMN: Standalone AI Trader & Journal ── */}
                <aside
                    className={`overlord-right-panel ${
                        mobileActiveTab === 'AUTOTRADER' || mobileActiveTab === 'TRADES'
                            ? 'mobile-active'
                            : ''
                    }`}
                >
                    {/* Continuous Burst Monitor */}
                    <div className='compounding-timer-hud'>
                        <div className='timer-header'>
                            <span className='step-badge'>
                                <Flame size={14} /> CONTINUOUS BURST STREAK
                            </span>
                            <span className='live-clock-display'>
                                RUN {currentBurstRun} / {burstRunSize}
                            </span>
                        </div>
                        <div className='progress-stats-row'>
                            <span className='profit-track'>
                                Target Profit: <strong>+${takeProfit}</strong>
                            </span>
                            <span className='pct-track'>
                                Stop Loss: <strong>-${stopLoss}</strong>
                            </span>
                        </div>
                        <div className='dual-progress-bar'>
                            <div className='progress-track'>
                                <div
                                    className='progress-fill'
                                    style={{
                                        width: `${Math.min(100, (currentBurstRun / burstRunSize) * 100)}%`,
                                    }}
                                />
                            </div>
                        </div>
                    </div>

                    {/* Session Performance Grid */}
                    <div className='session-metrics-grid'>
                        <div className='metric-mini-card'>
                            <span className='m-label'>WINS</span>
                            <span className='m-val val-win'>{winsCount}</span>
                        </div>
                        <div className='metric-mini-card'>
                            <span className='m-label'>LOSSES</span>
                            <span className='m-val val-loss'>{lossesCount}</span>
                        </div>
                        <div className='metric-mini-card'>
                            <span className='m-label'>WIN RATE</span>
                            <span className='m-val' style={{ color: '#f5c542' }}>
                                {winRate}%
                            </span>
                        </div>
                        <div className='metric-mini-card'>
                            <span className='m-label'>CURRENT STAKE</span>
                            <span className='m-val' style={{ color: isInRecovery ? '#ff8c42' : '#38bdf8' }}>
                                ${currentStake.toFixed(2)}
                            </span>
                        </div>
                        <div className='metric-mini-card'>
                            <span className='m-label'>BURSTS</span>
                            <span className='m-val' style={{ color: '#00f5ff' }}>
                                {burstCountTotal}
                            </span>
                        </div>
                    </div>

                    {/* Live Trade Journal */}
                    <div className='trade-journal-card'>
                        <div className='chart-header-row'>
                            <span className='split-title'>
                                <Layers size={14} /> LIVE EXECUTION LOGS
                            </span>
                            <div style={{ display: 'flex', gap: '6px' }}>
                                <button
                                    className='chip'
                                    onClick={handleResetStats}
                                    title='Reset session statistics and trade log'
                                    style={{ cursor: 'pointer', background: 'rgba(255, 255, 255, 0.08)' }}
                                >
                                    <RotateCcw size={11} /> RESET
                                </button>
                                <button
                                    className='chip'
                                    onClick={() => {
                                        const csvContent =
                                            'data:text/csv;charset=utf-8,' +
                                            ['Time,Market,Type,Barrier,Stake,Result,Profit,ExitDigit']
                                                .concat(
                                                    tradeLog.map(
                                                        t =>
                                                            `${new Date(t.timestamp).toLocaleTimeString()},${t.symbol},${t.contractType},${t.barrier},${t.stake},${t.result},${t.profit},${t.exitDigit || ''}`
                                                    )
                                                )
                                                .join('\n');
                                        const encodedUri = encodeURI(csvContent);
                                        const link = document.createElement('a');
                                        link.setAttribute('href', encodedUri);
                                        link.setAttribute('download', `overlord_trades_${Date.now()}.csv`);
                                        document.body.appendChild(link);
                                        link.click();
                                        document.body.removeChild(link);
                                    }}
                                    style={{ cursor: 'pointer', background: 'rgba(255, 255, 255, 0.08)' }}
                                >
                                    <Download size={11} /> CSV
                                </button>
                            </div>
                        </div>

                        <div className='live-trade-log-container'>
                            {tradeLog.length === 0 ? (
                                <div
                                    style={{
                                        padding: '24px',
                                        textAlign: 'center',
                                        color: '#64748b',
                                        fontSize: '11px',
                                    }}
                                >
                                    Awaiting trade execution triggers...
                                </div>
                            ) : (
                                tradeLog.map(item => (
                                    <div
                                        key={item.id}
                                        className='log-item-row'
                                        style={{
                                            borderLeft: `3px solid ${
                                                item.result === 'WIN'
                                                    ? '#00e676'
                                                    : item.result === 'LOSS'
                                                    ? '#ff4757'
                                                    : '#94a3b8'
                                            }`,
                                        }}
                                    >
                                        <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                                            <span style={{ fontSize: '10px', color: '#64748b' }}>
                                                {new Date(item.timestamp).toLocaleTimeString([], {
                                                    hour: '2-digit',
                                                    minute: '2-digit',
                                                    second: '2-digit',
                                                })}
                                            </span>
                                            <span style={{ fontWeight: 800, fontSize: '11px', color: '#f1f5f9' }}>
                                                {item.symbol}
                                            </span>
                                            <span
                                                style={{
                                                    fontSize: '10px',
                                                    fontWeight: 800,
                                                    color: item.contractType === 'DIGITOVER' ? '#ffb700' : '#00e676',
                                                }}
                                            >
                                                {item.contractType === 'DIGITOVER' ? 'OVER' : 'UNDER'} {item.barrier}
                                            </span>
                                        </div>
                                        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                                            <span style={{ fontSize: '11px', color: '#94a3b8' }}>
                                                ${item.stake.toFixed(2)}
                                            </span>
                                            <span
                                                style={{
                                                    fontSize: '11px',
                                                    fontWeight: 900,
                                                    color:
                                                        item.result === 'WIN'
                                                            ? '#00e676'
                                                            : item.result === 'LOSS'
                                                            ? '#ff4757'
                                                            : '#94a3b8',
                                                }}
                                            >
                                                {item.result === 'WIN'
                                                    ? `+$${item.profit.toFixed(2)}`
                                                    : item.result === 'LOSS'
                                                    ? `-$${Math.abs(item.profit).toFixed(2)}`
                                                    : 'PENDING'}
                                            </span>
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>
                    </div>
                </aside>
            </div>

            <TradingMilestoneModal
                isOpen={milestone.isOpen}
                type={milestone.type}
                amount={sessionProfit}
                currency={currency}
                botName='Overlord AI'
                onClose={() => setMilestone({ isOpen: false, type: null })}
            />
        </div>
    );
});

export default OverlordAi;
