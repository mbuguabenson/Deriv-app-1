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
    lastTickTime?: number;
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
                    <linearGradient id='overlordLineGrad' x1='0%' y1='0%' x2='100%' y2='0%'>
                        <stop offset='0%' stopColor='#8b5cf6' stopOpacity='0.7' />
                        <stop offset='50%' stopColor='#a855f7' stopOpacity='1' />
                        <stop offset='100%' stopColor='#c084fc' stopOpacity='0.9' />
                    </linearGradient>
                    <filter id='overlordGlow' x='-20%' y='-20%' width='140%' height='140%'>
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
                        stroke='url(#overlordLineGrad)'
                        strokeWidth={2.4}
                        strokeLinejoin='round'
                        strokeLinecap='round'
                        filter='url(#overlordGlow)'
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
const extractLastDigit = (quote: number | string | undefined | null, pip = 2): number => {
    if (quote === undefined || quote === null) return 0;
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
                    tickCount: 0,
                    lastTickTime: 0,
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
    const [burstRunSize, setBurstRunSize] = useState<number>(10);
    const [currentBurstRun, setCurrentBurstRun] = useState<number>(0);
    const [burstCountTotal, setBurstCountTotal] = useState<number>(0);
    const [marketRotationRuns, setMarketRotationRuns] = useState<number>(4);
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
    const lastProcessedTicksRef = useRef<Map<string, number>>(new Map());

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
            }, 80);
        }
    }, []);

    // ── Safe Manual Market Selection Handler ──
    const handleManualMarketSelect = useCallback(
        (sym: string) => {
            setSelectedSymbol(sym);
            selectedSymbolRef.current = sym;
            lastProcessedTicksRef.current.set(sym, -1);
            setAutoPickBestMarket(false);

            if (botStateRef.current !== 'IDLE') {
                const label = DERIVED_SYNTHETIC_MARKETS.find(m => m.symbol === sym)?.label || sym;
                setTradeLog(prev => [
                    {
                        id: `log_switch_${Date.now()}`,
                        timestamp: Date.now(),
                        symbol: sym,
                        contractType: 'DIGITUNDER',
                        barrier: 8,
                        stake: currentStakeRef.current,
                        result: 'PENDING',
                        profit: 0,
                    },
                    ...prev.slice(0, 49),
                ]);
            }
            throttleRender();
        },
        [throttleRender]
    );

    // ── Stream Refresh & Watchdog Listener ──
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

        // Periodic watchdog: ensure selected market is receiving ticks, auto-heal if stalled
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
                            mData.lastTickTime = Date.now();
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
                            activeM.lastTickTime = Date.now();
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
                    await new Promise(r => setTimeout(r, 60));
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
    }, [selectedSymbol, renderTrigger]);

    // ── Pure Overlord AI Statistical Analysis & Edge Engine (100% Quantitative Gated Logic) ──
    const evaluateOverlordAnalysis = (
        digits: number[],
        mode: OverlordStrategyMode,
        lastDigit: number
    ) => {
        const totalTicks = digits.length;
        if (totalTicks < 15) {
            return {
                totalTicks,
                frequencies: { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 7: 0, 8: 0, 9: 0 },
                percentages: { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 7: 0, 8: 0, 9: 0 },
                lowRatio: 50,
                highRatio: 50,
                under8Pct: 80,
                over1Pct: 80,
                under7Pct: 70,
                over2Pct: 70,
                under6Pct: 60,
                over3Pct: 60,
                last10Low: 5,
                last10High: 5,
                chosenStrategy: mode,
                signal: 'NEUTRAL' as const,
                targetBarrier: 8,
                signalConfidence: 50,
                isTriggerReady: false,
                triggerDigits: [] as number[],
                highestDigit: 0,
                lowestDigit: 9,
                highestUnderDigit: 0,
                highestOverDigit: 9,
                edgePct: 0,
                reason: 'Awaiting tick stream...',
            };
        }

        // 1. Whole-Sample Frequencies & Percentages (0-9 Spectrum Display)
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

        // 2. Rolling 50-Tick Window (Real Active Market State & Statistical Edge)
        const sample50 = digits.slice(-50);
        const count50 = sample50.length;

        const u8_50 = sample50.filter(d => d <= 7).length;
        const o1_50 = sample50.filter(d => d >= 2).length;
        const u7_50 = sample50.filter(d => d <= 6).length;
        const o2_50 = sample50.filter(d => d >= 3).length;
        const u6_50 = sample50.filter(d => d <= 5).length;
        const o3_50 = sample50.filter(d => d >= 4).length;
        const low_50 = sample50.filter(d => d <= 4).length;
        const high_50 = count50 - low_50;

        const under8Pct = Math.round((u8_50 / count50) * 100);
        const over1Pct = Math.round((o1_50 / count50) * 100);
        const under7Pct = Math.round((u7_50 / count50) * 100);
        const over2Pct = Math.round((o2_50 / count50) * 100);
        const under6Pct = Math.round((u6_50 / count50) * 100);
        const over3Pct = Math.round((o3_50 / count50) * 100);
        const lowRatio = Math.round((low_50 / count50) * 100);
        const highRatio = 100 - lowRatio;

        // 3. Local Frequencies in Recent 50 Ticks (for accurate Catalyst Entry Digits)
        const localFreq: Record<number, number> = {
            0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 7: 0, 8: 0, 9: 0,
        };
        sample50.forEach(d => {
            if (localFreq[d] !== undefined) localFreq[d]++;
        });

        let highestUnderDigit = 0;
        let maxUnderCount = -1;
        for (let i = 0; i <= 5; i++) {
            if (localFreq[i] > maxUnderCount) {
                maxUnderCount = localFreq[i];
                highestUnderDigit = i;
            }
        }

        let highestOverDigit = 9;
        let maxOverCount = -1;
        for (let i = 4; i <= 9; i++) {
            if (localFreq[i] > maxOverCount) {
                maxOverCount = localFreq[i];
                highestOverDigit = i;
            }
        }

        // Global spectrum hot & cold digits
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

        // 4. Micro-momentum (last 10 ticks)
        const last10 = digits.slice(-10);
        const last10Low = last10.filter(d => d <= 4).length;
        const last10High = 10 - last10Low;
        const last10Under8 = last10.filter(d => d <= 7).length;
        const last10Over1 = last10.filter(d => d >= 2).length;
        const last10Under7 = last10.filter(d => d <= 6).length;
        const last10Over2 = last10.filter(d => d >= 3).length;
        const last10Under6 = last10.filter(d => d <= 5).length;
        const last10Over3 = last10.filter(d => d >= 4).length;

        // 5. Anti-Exhaustion & Trend Reversal Filter (last 3 ticks)
        const last3 = digits.slice(-3);
        const isUnderExhausted =
            last3.length >= 2 &&
            (last3.every(d => d >= 7) || last3.filter(d => d >= 8).length >= 2);
        const isOverExhausted =
            last3.length >= 2 &&
            (last3.every(d => d <= 2) || last3.filter(d => d <= 1).length >= 2);

        // Previous tick for pullback detection
        const prevDigit = digits.length >= 2 ? digits[digits.length - 2] : lastDigit;

        // 6. Quantitative Edge Calculation (Actual % vs Baseline Expected Win Rate)
        // Baseline: Under 8 / Over 1 = 80%, Under 7 / Over 2 = 70%, Under 6 / Over 3 = 60%
        const edgeU8 = (under8Pct - 80) * 1.5 + (last10Under8 - 8) * 3 + (last10Low - 5) * 2;
        const edgeO1 = (over1Pct - 80) * 1.5 + (last10Over1 - 8) * 3 + (last10High - 5) * 2;

        const edgeU7 = (under7Pct - 70) * 1.6 + (last10Under7 - 7) * 3 + (last10Low - 5) * 2;
        const edgeO2 = (over2Pct - 70) * 1.6 + (last10Over2 - 7) * 3 + (last10High - 5) * 2;

        const edgeU6 = (under6Pct - 60) * 1.8 + (last10Under6 - 6) * 3 + (last10Low - 5) * 2;
        const edgeO3 = (over3Pct - 60) * 1.8 + (last10Over3 - 6) * 3 + (last10High - 5) * 2;

        // 7. Strategy & Signal Resolution
        let chosenStrategy: OverlordStrategyMode = mode;
        let signal: 'UNDER' | 'OVER' | 'NEUTRAL' = 'NEUTRAL';
        let targetBarrier = 8;
        let signalConfidence = 50;
        let isTriggerReady = false;
        let triggerDigits: number[] = [];
        let edgePct = 0;
        let reason = '';

        if (mode === 'ALL_AUTO') {
            const candidateStrategies = [
                {
                    mode: 'OVER_1_UNDER_8' as OverlordStrategyMode,
                    dir: 'UNDER' as const,
                    barrier: 8,
                    edge: edgeU8,
                    pct: under8Pct,
                    m10: last10Under8,
                    ex: isUnderExhausted,
                    minPct: 82,
                    minM10: 8,
                },
                {
                    mode: 'OVER_1_UNDER_8' as OverlordStrategyMode,
                    dir: 'OVER' as const,
                    barrier: 1,
                    edge: edgeO1,
                    pct: over1Pct,
                    m10: last10Over1,
                    ex: isOverExhausted,
                    minPct: 82,
                    minM10: 8,
                },
                {
                    mode: 'OVER_2_UNDER_7' as OverlordStrategyMode,
                    dir: 'UNDER' as const,
                    barrier: 7,
                    edge: edgeU7,
                    pct: under7Pct,
                    m10: last10Under7,
                    ex: isUnderExhausted,
                    minPct: 72,
                    minM10: 7,
                },
                {
                    mode: 'OVER_2_UNDER_7' as OverlordStrategyMode,
                    dir: 'OVER' as const,
                    barrier: 2,
                    edge: edgeO2,
                    pct: over2Pct,
                    m10: last10Over2,
                    ex: isOverExhausted,
                    minPct: 72,
                    minM10: 7,
                },
                {
                    mode: 'OVER_3_UNDER_6' as OverlordStrategyMode,
                    dir: 'UNDER' as const,
                    barrier: 6,
                    edge: edgeU6,
                    pct: under6Pct,
                    m10: last10Under6,
                    ex: isUnderExhausted,
                    minPct: 62,
                    minM10: 6,
                },
                {
                    mode: 'OVER_3_UNDER_6' as OverlordStrategyMode,
                    dir: 'OVER' as const,
                    barrier: 3,
                    edge: edgeO3,
                    pct: over3Pct,
                    m10: last10Over3,
                    ex: isOverExhausted,
                    minPct: 62,
                    minM10: 6,
                },
            ];

            candidateStrategies.sort((a, b) => b.edge - a.edge);
            const best = candidateStrategies[0];

            if (best && best.edge > 0 && best.pct >= best.minPct && best.m10 >= best.minM10 && !best.ex) {
                chosenStrategy = best.mode;
                signal = best.dir;
                targetBarrier = best.barrier;
                edgePct = Math.round(best.edge * 10) / 10;
                signalConfidence = Math.min(99, Math.round(65 + best.edge * 2));
            } else {
                chosenStrategy = best?.mode || 'OVER_1_UNDER_8';
                signal = 'NEUTRAL';
                signalConfidence = 50;
                reason = 'Consolidating — Waiting for statistically verified momentum edge';
            }
        } else if (mode === 'OVER_1_UNDER_8') {
            const isUnderValid =
                under8Pct >= 82 && last10Under8 >= 8 && last10Low >= 5 && !isUnderExhausted;
            const isOverValid =
                over1Pct >= 82 && last10Over1 >= 8 && last10High >= 5 && !isOverExhausted;

            if (isUnderValid && edgeU8 >= edgeO1) {
                signal = 'UNDER';
                targetBarrier = 8;
                edgePct = Math.round(edgeU8 * 10) / 10;
                signalConfidence = Math.min(
                    99,
                    Math.max(65, Math.round(75 + (under8Pct - 80) * 2 + (last10Under8 - 8) * 4))
                );
            } else if (isOverValid) {
                signal = 'OVER';
                targetBarrier = 1;
                edgePct = Math.round(edgeO1 * 10) / 10;
                signalConfidence = Math.min(
                    99,
                    Math.max(65, Math.round(75 + (over1Pct - 80) * 2 + (last10Over1 - 8) * 4))
                );
            } else {
                signal = 'NEUTRAL';
                signalConfidence = 50;
                reason = `Waiting for Over 1 / Under 8 edge (U8: ${under8Pct}%, O1: ${over1Pct}%, Last 10: ${last10Low}L/${last10High}H)`;
            }
        } else if (mode === 'OVER_2_UNDER_7') {
            const isUnderValid =
                under7Pct >= 72 && last10Under7 >= 7 && last10Low >= 5 && !isUnderExhausted;
            const isOverValid =
                over2Pct >= 72 && last10Over2 >= 7 && last10High >= 5 && !isOverExhausted;

            if (isUnderValid && edgeU7 >= edgeO2) {
                signal = 'UNDER';
                targetBarrier = 7;
                edgePct = Math.round(edgeU7 * 10) / 10;
                signalConfidence = Math.min(
                    96,
                    Math.max(65, Math.round(70 + (under7Pct - 70) * 2 + (last10Under7 - 7) * 4))
                );
            } else if (isOverValid) {
                signal = 'OVER';
                targetBarrier = 2;
                edgePct = Math.round(edgeO2 * 10) / 10;
                signalConfidence = Math.min(
                    96,
                    Math.max(65, Math.round(70 + (over2Pct - 70) * 2 + (last10Over2 - 7) * 4))
                );
            } else {
                signal = 'NEUTRAL';
                signalConfidence = 50;
                reason = `Waiting for Over 2 / Under 7 edge (U7: ${under7Pct}%, O2: ${over2Pct}%, Last 10: ${last10Low}L/${last10High}H)`;
            }
        } else if (mode === 'OVER_3_UNDER_6') {
            const isUnderValid =
                (under6Pct >= 62 || (lowRatio >= 54 && last10Low >= 6)) &&
                last10Under6 >= 6 &&
                !isUnderExhausted;
            const isOverValid =
                (over3Pct >= 62 || (highRatio >= 54 && last10High >= 6)) &&
                last10Over3 >= 6 &&
                !isOverExhausted;

            if (isUnderValid && edgeU6 >= edgeO3) {
                signal = 'UNDER';
                targetBarrier = 6;
                edgePct = Math.round(edgeU6 * 10) / 10;
                signalConfidence = Math.min(
                    92,
                    Math.max(65, Math.round(65 + (under6Pct - 60) * 2.5 + (last10Under6 - 6) * 4))
                );
            } else if (isOverValid) {
                signal = 'OVER';
                targetBarrier = 3;
                edgePct = Math.round(edgeO3 * 10) / 10;
                signalConfidence = Math.min(
                    92,
                    Math.max(65, Math.round(65 + (over3Pct - 60) * 2.5 + (last10Over3 - 6) * 4))
                );
            } else {
                signal = 'NEUTRAL';
                signalConfidence = 50;
                reason = `Waiting for Over 3 / Under 6 edge (U6: ${under6Pct}%, O3: ${over3Pct}%, Last 10: ${last10Low}L/${last10High}H)`;
            }
        }

        // 8. Strict Entry Trigger Gate
        if (signal === 'UNDER') {
            // Safety Barrier Rule: Current lastDigit MUST be strictly less than target barrier
            const isSafe = lastDigit < targetBarrier;
            triggerDigits =
                targetBarrier === 8
                    ? [0, 1, 2, 3, 4, 5, 6, 7]
                    : targetBarrier === 7
                    ? [0, 1, 2, 3, 4, 5, 6]
                    : [0, 1, 2, 3, 4, 5];

            // Specific Catalyst Entry Trigger:
            // 1. Matched recent hot low digit
            // 2. Strong directional follow-through (lastDigit <= 4 and prev was <= 5)
            // 3. Pullback recovery (prev was >= 5 and current tick reversed back down to <= 3)
            const isHotHit = lastDigit === highestUnderDigit;
            const isContinuation = lastDigit <= 4 && prevDigit <= 5;
            const isPullback = prevDigit >= 5 && lastDigit <= 3;

            isTriggerReady = isSafe && (isHotHit || isContinuation || isPullback);
            if (!isSafe) {
                reason = `Barrier safety hold: digit [${lastDigit}] is at or above barrier ${targetBarrier}`;
            } else if (!isTriggerReady) {
                reason = `Waiting for Under trigger catalyst: Hot [${highestUnderDigit}] or low reversal (<= 3)`;
            } else {
                reason = `Under ${targetBarrier} Triggered: digit [${lastDigit}] (Hot: ${highestUnderDigit}, Edge: +${edgePct}%)`;
            }
        } else if (signal === 'OVER') {
            // Safety Barrier Rule: Current lastDigit MUST be strictly greater than target barrier
            const isSafe = lastDigit > targetBarrier;
            triggerDigits =
                targetBarrier === 1
                    ? [2, 3, 4, 5, 6, 7, 8, 9]
                    : targetBarrier === 2
                    ? [3, 4, 5, 6, 7, 8, 9]
                    : [4, 5, 6, 7, 8, 9];

            // Specific Catalyst Entry Trigger:
            // 1. Matched recent hot high digit
            // 2. Strong directional follow-through (lastDigit >= 5 and prev was >= 4)
            // 3. Bounce recovery (prev was <= 4 and current tick jumped up to >= 6)
            const isHotHit = lastDigit === highestOverDigit;
            const isContinuation = lastDigit >= 5 && prevDigit >= 4;
            const isBounce = prevDigit <= 4 && lastDigit >= 6;

            isTriggerReady = isSafe && (isHotHit || isContinuation || isBounce);
            if (!isSafe) {
                reason = `Barrier safety hold: digit [${lastDigit}] is at or below barrier ${targetBarrier}`;
            } else if (!isTriggerReady) {
                reason = `Waiting for Over trigger catalyst: Hot [${highestOverDigit}] or high bounce (>= 6)`;
            } else {
                reason = `Over ${targetBarrier} Triggered: digit [${lastDigit}] (Hot: ${highestOverDigit}, Edge: +${edgePct}%)`;
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
            highestUnderDigit,
            highestOverDigit,
            edgePct,
            reason,
        };
    };

    // ── Smart AI Pattern & Statistical Analysis Engine ──
    const patternEngine = useMemo(() => {
        return evaluateOverlordAnalysis(currentMarket.digits, strategyMode, currentMarket.lastDigit);
    }, [currentMarket.digits, currentMarket.lastDigit, strategyMode, renderTrigger]);

    // ── Multi-Market Cross Scanner Ranking (50-Tick Statistical Edge + Micro-Momentum) ──
    const rankedMarketCandidates = useMemo(() => {
        return DERIVED_SYNTHETIC_MARKETS.map(meta => {
            const data = marketsDataRef.current.get(meta.symbol);
            const digits = data?.digits || [];
            const count = digits.length;
            if (count < 20) {
                return {
                    ...meta,
                    digitsCount: count,
                    bias: 'NEUTRAL' as const,
                    score: 50,
                    lastDigit: data?.lastDigit || 0,
                    currentPrice: data?.currentPrice || '0.00',
                };
            }

            const sample50 = digits.slice(-50);
            const low50 = sample50.filter(d => d <= 4).length;
            const lowPct = Math.round((low50 / sample50.length) * 100);
            const last10 = digits.slice(-10);
            const last10Low = last10.filter(d => d <= 4).length;

            const u8_50 = (sample50.filter(d => d <= 7).length / sample50.length) * 100;
            const o1_50 = (sample50.filter(d => d >= 2).length / sample50.length) * 100;

            let score = 50;
            let bias: 'UNDER' | 'OVER' | 'NEUTRAL' = 'NEUTRAL';

            const underEdge = (u8_50 - 80) * 1.5 + (lowPct - 50) * 1.2 + (last10Low - 5) * 4;
            const overEdge = (o1_50 - 80) * 1.5 + (50 - lowPct) * 1.2 + (5 - last10Low) * 4;

            if (underEdge >= 3 && underEdge > overEdge) {
                bias = 'UNDER';
                score = Math.min(99, Math.max(52, Math.round(50 + underEdge * 2.5)));
            } else if (overEdge >= 3 && overEdge > underEdge) {
                bias = 'OVER';
                score = Math.min(99, Math.max(52, Math.round(50 + overEdge * 2.5)));
            } else {
                bias = 'NEUTRAL';
                score = Math.round(50 + Math.max(underEdge, overEdge));
                score = Math.max(30, Math.min(65, score));
            }

            return {
                ...meta,
                digitsCount: count,
                bias,
                score,
                lastDigit: data?.lastDigit || 0,
                currentPrice: data?.currentPrice || '0.00',
            };
        }).sort((a, b) => b.score - a.score);
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

    // Start Auto Trading Engine Loop (Zero-Freeze, 100% Verified Gated Execution)
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
            lastProcessedTicksRef.current.clear();
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
                        lastProcessedTicksRef.current.set(targetSym, -1);
                    }
                }

                const mData = marketsDataRef.current.get(targetSym);
                if (!mData || mData.digits.length < 15) {
                    if (botStateRef.current !== 'SCANNING') setBotStateSync('SCANNING');
                    await new Promise(r => setTimeout(r, 300));
                    continue;
                }

                const currTickCount = mData.tickCount || 0;
                const lastProcessed = lastProcessedTicksRef.current.get(targetSym) ?? -1;

                // Independent per-symbol fresh tick gate (zero market switch freeze)
                if (lastProcessed !== -1 && currTickCount <= lastProcessed) {
                    await new Promise(r => setTimeout(r, 40));
                    continue;
                }
                lastProcessedTicksRef.current.set(targetSym, currTickCount);

                // Evaluate entry conditions dynamically on live incoming digits
                const liveAnalysis = evaluateOverlordAnalysis(mData.digits, strategyMode, mData.lastDigit);
                const signal = liveAnalysis.signal;
                const barrier = liveAnalysis.targetBarrier;
                const isTriggerReady = liveAnalysis.isTriggerReady;
                const confidence = liveAnalysis.signalConfidence;

                if (signal === 'NEUTRAL' || confidence < 60) {
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
                    await new Promise(r => setTimeout(r, 50));
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
                    const isWon = await executeTradeOrder(
                        targetSym,
                        contractType,
                        barrier,
                        stakeToUse,
                        currentRunNumber
                    );

                    // If trade lost, reset burst streak for strict recovery discipline
                    if (!isWon) {
                        burstRunRef.current = 0;
                        setCurrentBurstRun(0);
                    }
                } catch (tradeError) {
                    console.error('[Overlord AI] Error executing trade:', tradeError);
                    burstRunRef.current = 0;
                    setCurrentBurstRun(0);
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

                // Record current tick count after settlement so next trade MUST wait for a fresh tick
                const currentMarketData = marketsDataRef.current.get(targetSym);
                if (currentMarketData) {
                    lastProcessedTicksRef.current.set(targetSym, currentMarketData.tickCount || 0);
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
                            lastProcessedTicksRef.current.set(targetSym, -1);
                        }
                    }

                    await new Promise(r => setTimeout(r, 600));
                    if (!abortSignal.aborted && botStateRef.current === 'BURST_PAUSED') {
                        setBotStateSync('SCANNING');
                    }
                } else {
                    // Continue burst streak on next tick
                    setBotStateSync('SCANNING');
                    await new Promise(r => setTimeout(r, 200));
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
                                    handleManualMarketSelect(e.target.value);
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
                                    onClick={() => handleManualMarketSelect(m.symbol)}
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
                                    <span className='digit-sub'>AI QUANTITATIVE SIGNAL</span>
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
                                            ? 'SCANNING FOR EDGE...'
                                            : `${patternEngine.signal} ${patternEngine.targetBarrier} (+${patternEngine.edgePct}% EDGE • ${patternEngine.signalConfidence}%)`}
                                    </span>
                                    <span
                                        style={{
                                            fontSize: '10px',
                                            color: '#94a3b8',
                                            marginTop: '2px',
                                            fontFamily: 'monospace',
                                            maxWidth: '300px',
                                            whiteSpace: 'nowrap',
                                            overflow: 'hidden',
                                            textOverflow: 'ellipsis',
                                        }}
                                        title={patternEngine.reason}
                                    >
                                        {patternEngine.reason}
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
                                <span>Under 8 Frequency (50t):</span>
                                <strong>{patternEngine.under8Pct}%</strong>
                            </div>
                            <div className='stat-metrics-row'>
                                <span>Under 7 Frequency (50t):</span>
                                <strong>{patternEngine.under7Pct}%</strong>
                            </div>
                            <div className='stat-metrics-row'>
                                <span>Under 6 Frequency (50t):</span>
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
                                    {patternEngine.highestUnderDigit}
                                </div>
                                <div className='entry-details'>
                                    <span className='entry-type'>UNDER CATALYST HOT DIGIT</span>
                                    <span className='entry-status'>
                                        Digit {patternEngine.highestUnderDigit} ({patternEngine.percentages[patternEngine.highestUnderDigit] || 0}%)
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
                                    {patternEngine.highestOverDigit}
                                </div>
                                <div className='entry-details'>
                                    <span className='entry-type'>OVER CATALYST HOT DIGIT</span>
                                    <span className='entry-status'>
                                        Digit {patternEngine.highestOverDigit} ({patternEngine.percentages[patternEngine.highestOverDigit] || 0}%)
                                    </span>
                                    <span className='entry-subtext'>
                                        High probability catalyst for Over triggers
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
