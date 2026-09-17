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
    Flame,
    Gauge,
    Layers,
    Play,
    Pause,
    RefreshCw,
    Shield,
    Sparkles,
    Square,
    TrendingDown,
    TrendingUp,
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
    targetBalance: number;
    recommendedStake: number;
    stageProfit: number;
    cumulativeProfit: number;
    status: 'DONE' | 'ACTIVE' | 'PENDING';
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

// ─── SVG Spline Line Chart (50 Ticks Trajectory) ───────────────────────────────

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
                    <linearGradient id='afLineGrad' x1='0%' y1='0%' x2='100%' y2='0%'>
                        <stop offset='0%' stopColor='#00d2ff' stopOpacity='0.8' />
                        <stop offset='50%' stopColor='#38bdf8' stopOpacity='1' />
                        <stop offset='100%' stopColor='#f5c542' stopOpacity='0.9' />
                    </linearGradient>
                    <filter id='afGlow' x='-20%' y='-20%' width='140%' height='140%'>
                        <feDropShadow dx='0' dy='2' stdDeviation='3' floodColor='#00d2ff' floodOpacity='0.6' />
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
                        stroke='url(#afLineGrad)'
                        strokeWidth={2.4}
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
                                stroke={isLatest ? '#ffffff' : '#00d2ff'}
                                strokeWidth={1.5}
                            />
                            <text
                                x={p.x}
                                y={p.y - 8}
                                textAnchor='middle'
                                fill={isLatest ? '#ffffff' : isUnder ? '#10b981' : '#f59e0b'}
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
    const [scanAllMarkets, setScanAllMarkets] = useState<boolean>(true);
    const [autoSwitchMarkets, setAutoSwitchMarkets] = useState<boolean>(true);
    const [showWideView, setShowWideView] = useState<boolean>(false);
    const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(false);

    // Bot execution controls
    const [botState, setBotState] = useState<AutoRunState>('IDLE');
    const [initialStake, setInitialStake] = useState<string>('1.00');
    const [currentStake, setCurrentStake] = useState<number>(1.0);
    const [martingale, setMartingale] = useState<string>('2.6');
    const [takeProfit, setTakeProfit] = useState<string>('20.00');
    const [stopLoss, setStopLoss] = useState<string>('50.00');
    const [tickDuration, setTickDuration] = useState<string>('1');

    // Compounding Plan Engine
    const [compTimeframe, setCompTimeframe] = useState<string>('24 Hours');
    const [compStartCapital, setCompStartCapital] = useState<string>('100.00');
    const [compTargetProfit, setCompTargetProfit] = useState<string>('250.00');
    const [compStages, setCompStages] = useState<CompoundingStage[]>([]);

    // Session Statistics
    const [sessionProfit, setSessionProfit] = useState<number>(0);
    const [winsCount, setWinsCount] = useState<number>(0);
    const [lossesCount, setLossesCount] = useState<number>(0);
    const [tradeLog, setTradeLog] = useState<TradeLogItem[]>([]);

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
        generateCompoundingPlan('100.00', '250.00');
    }, []);

    // ── WebSocket Multiplexed Streaming ────────────────────────────────────────

    useEffect(() => {
        const activeSubs = subscriptionsRef.current;
        const symbolsToStream = scanAllMarkets ? MARKETS.map(m => m.symbol) : [selectedSymbol];

        const subscribeSymbol = async (sym: string) => {
            try {
                const marketCfg = MARKETS.find(m => m.symbol === sym);
                const pip = marketCfg?.pip || 2;

                if (activeSubs.has(sym)) return;

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
                console.error(`AUTOFLIPPER: Error subscribing to ${sym}:`, err);
            }
        };

        symbolsToStream.forEach(sym => {
            void subscribeSymbol(sym);
        });

        return () => {
            // Keep active streams
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
        const isOver59Increasing = (15 - u04_last15) >= (15 - u04_prev15);

        // Split 2: Under (0-5) vs Over (4-9)
        const under05 = last50.filter(d => d <= 5).length;
        const over49 = last50.filter(d => d >= 4).length;
        const under05Pct = Math.round((under05 / total50) * 100);
        const over49Pct = Math.round((over49 / total50) * 100);

        const u05_last15 = last15.filter(d => d <= 5).length;
        const u05_prev15 = prev15.filter(d => d <= 5).length;
        const isUnder05Increasing = u05_last15 >= u05_prev15;
        const isOver49Increasing = (15 - u05_last15) >= (15 - u05_prev15);

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
            signalReason = `Under dominance (${under04Pct}%), 7/10 recent ticks under, waiting for [${highestUnderDigit}] trigger.`;
        } else if (over59Pct >= 55 && isOver59Increasing && over49 > under05 && last10Over >= 7) {
            activeSignal = 'OVER'; // Will trade Over 3
            isTriggerReady = currentSpot === highestOverDigit;
            signalReason = `Over dominance (${over59Pct}%), 7/10 recent ticks over, waiting for [${highestOverDigit}] trigger.`;
        } else {
            signalReason = 'Market consolidating. Waiting for clear 55%+ trend and 7/10 flip momentum.';
        }

        return {
            under04,
            over59,
            under04Pct,
            over59Pct,
            isUnder04Increasing,
            isOver59Increasing,
            under05,
            over49,
            under05Pct,
            over49Pct,
            isUnder05Increasing,
            isOver49Increasing,
            highestUnderDigit,
            highestUnderDigitPct,
            highestOverDigit,
            highestOverDigitPct,
            last10Under,
            last10Over,
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

    // ── Compounding Plan Engine Generator ──

    const generateCompoundingPlan = (startCapStr?: string, targetProfStr?: string) => {
        const startCapital = Number(startCapStr || compStartCapital) || 100;
        const targetProf = Number(targetProfStr || compTargetProfit) || 250;

        const stages: CompoundingStage[] = [];
        const numStages = 8;
        const stepProfit = targetProf / numStages;

        let runningBal = startCapital;
        for (let i = 1; i <= numStages; i++) {
            const stageProfit = stepProfit;
            runningBal += stageProfit;
            const recStake = Math.max(0.35, Math.round(runningBal * 0.02 * 100) / 100);
            const cumProfit = runningBal - startCapital;

            stages.push({
                stage: i,
                targetBalance: Math.round(runningBal * 100) / 100,
                recommendedStake: recStake,
                stageProfit: Math.round(stageProfit * 100) / 100,
                cumulativeProfit: Math.round(cumProfit * 100) / 100,
                status: sessionProfit >= cumProfit ? 'DONE' : i === 1 || sessionProfit >= (cumProfit - stepProfit) ? 'ACTIVE' : 'PENDING',
            });
        }

        setCompStages(stages);
    };

    // Update compounding stage statuses when session profit changes
    useEffect(() => {
        if (compStages.length === 0) return;
        const updated = compStages.map((st, idx) => {
            if (sessionProfit >= st.cumulativeProfit) {
                return { ...st, status: 'DONE' as const };
            }
            const prevProfit = idx > 0 ? compStages[idx - 1].cumulativeProfit : 0;
            if (sessionProfit >= prevProfit && sessionProfit < st.cumulativeProfit) {
                return { ...st, status: 'ACTIVE' as const };
            }
            return { ...st, status: 'PENDING' as const };
        });
        setCompStages(updated);
    }, [sessionProfit, compStages]);

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

            playSoundCue('signal');

            try {
                const duration = parseInt(tickDuration, 10) || 1;
                const buyResult = await buyContractForUi({
                    parameters: {
                        amount: stakeToUse,
                        basis: 'stake',
                        contract_type: contractType,
                        currency,
                        duration,
                        duration_unit: 't',
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
                const marketLabel = MARKETS.find(m => m.symbol === sym)?.label || sym;

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

                const newTradeItem: TradeLogItem = {
                    id: String(Date.now()),
                    time: new Date().toLocaleTimeString(),
                    market: marketLabel,
                    strategy: tradeSignal === 'UNDER' ? 'AUTOFLIP_UNDER' : 'AUTOFLIP_OVER',
                    contractType: `${contractType} [${barrier}]`,
                    prediction: Number(barrier),
                    stake: stakeToUse,
                    result: isWin ? 'WIN' : 'LOSS',
                    profit,
                };

                setTradeLog(prev => [newTradeItem, ...prev.slice(0, 49)]);

                if (isWin) {
                    playSoundCue('win');
                    consecutiveLossesRef.current = 0;
                    setCurrentStake(Number(initialStake) || 1);
                    setWinsCount(w => w + 1);
                    setSessionProfit(p => {
                        const newP = p + profit;
                        const tp = Number(takeProfit) || 20;
                        if (newP >= tp) {
                            setMilestone({ isOpen: true, type: 'tp' });
                            setBotState('IDLE');
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
                }
            } catch (err: any) {
                console.error('[Autoflipper] Trade Execution Error:', err);
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
            tickDuration,
            initialStake,
            takeProfit,
            martingale,
            stopLoss,
            autoSwitchMarkets,
            bestMarketCandidate,
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
        setCurrentStake(Number(initialStake) || 1);
        setBotState('WAITING_SIGNAL');
        playSoundCue('signal');
    };

    const handlePauseBot = () => {
        setBotState(prev => (prev === 'PAUSED' ? 'WAITING_SIGNAL' : 'PAUSED'));
    };

    const handleStopBot = () => {
        setBotState('IDLE');
        isTradingInProgressRef.current = false;
    };

    const handleClearLogs = () => {
        setTradeLog([]);
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
                        <Flame size={26} />
                    </div>
                    <div className='af-title-text'>
                        <div className='title-row'>
                            <h1>AUTOFLIPPER</h1>
                            <span
                                className={`af-status-chip af-status-chip--${botState.toLowerCase()}`}
                            >
                                {botState === 'TRADING' && '🚀 EXECUTING TRADE'}
                                {botState === 'WAITING_TRIGGER' && '⚡ TRIGGER READY'}
                                {botState === 'WAITING_SIGNAL' && '⏳ SCANNING REGIME'}
                                {botState === 'PAUSED' && '⏸ PAUSED'}
                                {botState === 'IDLE' && '● ENGINE READY'}
                            </span>
                        </div>
                        <span>Regime-Flipping Over 3 / Under 6 Engine with Multi-Tier Compounding Strategy</span>
                    </div>
                </div>

                <div className='autoflipper__header-actions'>
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

            {/* ── 2. Market Selector & Options Ribbon ── */}
            <div className='autoflipper__market-bar'>
                <div className='af-select-group'>
                    <label>Active Market:</label>
                    <select
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

                <div className='af-actions-cluster'>
                    <button
                        className={`af-toggle-button ${!sidebarCollapsed ? 'af-toggle-button--active' : ''}`}
                        onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
                        title='Toggle market list sidebar'
                    >
                        📋 {sidebarCollapsed ? 'Show Sidebar' : 'Hide Sidebar'}
                    </button>

                    <button
                        className={`af-toggle-button ${scanAllMarkets ? 'af-toggle-button--active' : ''}`}
                        onClick={() => setScanAllMarkets(!scanAllMarkets)}
                        title='Scan all derived synthetic indices simultaneously'
                    >
                        ⚡ Scan All ({scanAllMarkets ? 'ON' : 'OFF'})
                    </button>

                    <button
                        className={`af-toggle-button ${showWideView ? 'af-toggle-button--active' : ''}`}
                        onClick={() => setShowWideView(!showWideView)}
                    >
                        📊 {showWideView ? 'Collapse Grid' : 'Wide Market Matrix'}
                    </button>

                    <button
                        className={`af-toggle-button ${autoSwitchMarkets ? 'af-toggle-button--active' : ''}`}
                        onClick={() => setAutoSwitchMarkets(!autoSwitchMarkets)}
                        title='Automatically switch to best performing market after runs'
                    >
                        🔄 Auto-Switch ({autoSwitchMarkets ? 'ON' : 'OFF'})
                    </button>
                </div>
            </div>

            {/* ── 3. Expandable Wide View Matrix ── */}
            {showWideView && (
                <div className='autoflipper__wide-view'>
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

                        return (
                            <div
                                key={m.symbol}
                                className={`af-wide-card ${isSelected ? 'af-wide-card--selected' : ''} ${isBest ? 'af-wide-card--recommended' : ''}`}
                                onClick={() => {
                                    setSelectedSymbol(m.symbol);
                                    setShowWideView(false);
                                }}
                            >
                                <div className='af-wide-card__header'>
                                    <span className='name'>{m.label}</span>
                                    <span
                                        className={`digit-badge digit-badge--${(mState?.lastDigit ?? 0) <= 4 ? 'under' : 'over'}`}
                                    >
                                        {mState?.lastDigit ?? '—'}
                                    </span>
                                </div>
                                <div className='af-wide-card__price'>Price: {mState?.currentPrice ?? '0.00'}</div>
                                <div className='af-wide-card__stats-row'>
                                    <div className='split-line'>
                                        <span style={{ color: '#10b981' }}>Under (0-4): {uPct}%</span>
                                        <span style={{ color: '#f59e0b' }}>Over (5-9): {oPct}%</span>
                                    </div>
                                    <div className='mini-bar'>
                                        <div className='bar-under' style={{ width: `${uPct}%` }} />
                                        <div className='bar-over' style={{ width: `${oPct}%` }} />
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}

            {/* ── 4. Main Body: Sidebar + Workspace ── */}
            <div className={`autoflipper__body ${sidebarCollapsed ? 'autoflipper__body--collapsed' : ''}`}>
                {/* Left Sidebar */}
                {!sidebarCollapsed && (
                    <div className='autoflipper__sidebar'>
                        <div className='autoflipper__sidebar-header'>
                            <h3>DERIVED MARKETS</h3>
                            <span className='badge'>LIVE SCAN</span>
                        </div>
                        <div className='autoflipper__sidebar-list'>
                            {MARKETS.map(m => {
                                const mState = marketsDataRef.current.get(m.symbol);
                                const digits = mState?.digits || [];
                                const last50 = digits.slice(-50);
                                const u04 = last50.filter(d => d <= 4).length;
                                const o59 = last50.filter(d => d >= 5).length;
                                const isSelected = m.symbol === selectedSymbol;
                                const lastDigit = mState?.lastDigit ?? 0;

                                return (
                                    <div
                                        key={m.symbol}
                                        className={`af-market-card ${isSelected ? 'af-market-card--active' : ''}`}
                                        onClick={() => setSelectedSymbol(m.symbol)}
                                    >
                                        <div className='af-market-card__top'>
                                            <span className='symbol-name'>{m.label}</span>
                                            <span
                                                className={`digit-pill digit-pill--${lastDigit <= 4 ? 'under' : 'over'}`}
                                            >
                                                {lastDigit}
                                            </span>
                                        </div>
                                        <div className='af-market-card__mid'>
                                            <span className='price'>{mState?.currentPrice ?? '0.00'}</span>
                                            <span className={`bias ${u04 >= o59 ? 'bias--under' : 'bias--over'}`}>
                                                {u04 >= o59 ? `Under ${u04}` : `Over ${o59}`}
                                            </span>
                                        </div>
                                        <div className='af-market-card__bot'>
                                            <span>Flipping Signal:</span>
                                            <span className='rec-pick'>
                                                {u04 >= o59 ? 'Under 6' : 'Over 3'}
                                            </span>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                )}

                {/* Right Workspace */}
                <div className='autoflipper__workspace'>
                    {/* Live Trajectory Spline Chart */}
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
                                    <span className='digit-label'>LAST DIGIT</span>
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

                        <div className='ep-chart-wrap'>
                            <DigitLineChart digits={currentMarket.digits} />
                        </div>
                    </div>

                    {/* Dual Statistical Models Deck (0-4 vs 5-9 & 0-5 vs 4-9) */}
                    <div className='autoflipper__stats-grid'>
                        {/* Split Model 1: Under 0-4 vs Over 5-9 */}
                        <div className='stat-split-card'>
                            <div className='card-header'>
                                <h3>
                                    <Activity size={16} /> Parity Split: Under (0-4) vs Over (5-9)
                                </h3>
                                <span className={`badge-edge ${flipAnalysis.under04Pct >= 50 ? 'under-edge' : 'over-edge'}`}>
                                    {flipAnalysis.under04Pct >= 50 ? `Under Edge (+${flipAnalysis.under04Pct}%)` : `Over Edge (+${flipAnalysis.over59Pct}%)`}
                                </span>
                            </div>

                            <div className='split-metrics-row'>
                                <div className='metric-side under-side'>
                                    <span className='title'>Under (0,1,2,3,4)</span>
                                    <span className='pct'>{flipAnalysis.under04Pct}%</span>
                                    <span className='count'>{flipAnalysis.under04} of 50 Ticks</span>
                                </div>
                                <div className='metric-side over-side'>
                                    <span className='title'>Over (5,6,7,8,9)</span>
                                    <span className='pct'>{flipAnalysis.over59Pct}%</span>
                                    <span className='count'>{flipAnalysis.over59} of 50 Ticks</span>
                                </div>
                            </div>

                            <div className='split-bar-wrap'>
                                <div className='fill-under' style={{ width: `${flipAnalysis.under04Pct}%` }} />
                                <div className='fill-over' style={{ width: `${flipAnalysis.over59Pct}%` }} />
                            </div>

                            <div className='trend-footer'>
                                <span>Momentum Velocity:</span>
                                <span className={`trend-tag ${flipAnalysis.isUnder04Increasing ? 'up' : 'down'}`}>
                                    {flipAnalysis.isUnder04Increasing ? (
                                        <>
                                            <TrendingUp size={14} /> Under Accelerating
                                        </>
                                    ) : (
                                        <>
                                            <TrendingDown size={14} /> Over Accelerating
                                        </>
                                    )}
                                </span>
                            </div>
                        </div>

                        {/* Split Model 2: Under 0-5 vs Over 4-9 */}
                        <div className='stat-split-card'>
                            <div className='card-header'>
                                <h3>
                                    <Gauge size={16} /> Extended Range: Under (0-5) vs Over (4-9)
                                </h3>
                                <span className={`badge-edge ${flipAnalysis.under05Pct >= 50 ? 'under-edge' : 'over-edge'}`}>
                                    {flipAnalysis.under05Pct >= 50 ? `Under Dominant (${flipAnalysis.under05Pct}%)` : `Over Dominant (${flipAnalysis.over49Pct}%)`}
                                </span>
                            </div>

                            <div className='split-metrics-row'>
                                <div className='metric-side under-side'>
                                    <span className='title'>Under (0–5 Range)</span>
                                    <span className='pct'>{flipAnalysis.under05Pct}%</span>
                                    <span className='count'>{flipAnalysis.under05} of 50 Ticks</span>
                                </div>
                                <div className='metric-side over-side'>
                                    <span className='title'>Over (4–9 Range)</span>
                                    <span className='pct'>{flipAnalysis.over49Pct}%</span>
                                    <span className='count'>{flipAnalysis.over49} of 50 Ticks</span>
                                </div>
                            </div>

                            <div className='split-bar-wrap'>
                                <div className='fill-under' style={{ width: `${flipAnalysis.under05Pct}%` }} />
                                <div className='fill-over' style={{ width: `${flipAnalysis.over49Pct}%` }} />
                            </div>

                            <div className='trend-footer'>
                                <span>10-Tick Immediate Bias:</span>
                                <span style={{ fontWeight: 800, color: flipAnalysis.last10Under >= 7 ? '#10b981' : flipAnalysis.last10Over >= 7 ? '#f59e0b' : '#94a3b8' }}>
                                    {flipAnalysis.last10Under} Under / {flipAnalysis.last10Over} Over
                                </span>
                            </div>
                        </div>
                    </div>

                    {/* Glowing Entry Digits HUD */}
                    <div className='autoflipper__entry-hud'>
                        <div className='hud-header'>
                            <h3>
                                <Sparkles size={16} /> Highest Frequency Entry Triggers (Glowing Radar)
                            </h3>
                            <div className='live-pulse-badge'>
                                <span className='dot-pulse' />
                                <span>{flipAnalysis.signalReason}</span>
                            </div>
                        </div>

                        <div className='entry-cards-row'>
                            {/* Under Target Entry Card */}
                            <div className={`glowing-digit-card glowing-digit-card--under ${flipAnalysis.activeSignal === 'UNDER' ? 'is-active-trigger' : ''}`}>
                                <div className='info-col'>
                                    <span className='tag'>Dominant Under Entry Digit (0-5)</span>
                                    <span className='title'>Trade Under 6 Target</span>
                                    <span className='sub'>Occurred {flipAnalysis.highestUnderDigitPct}% in recent stream</span>
                                </div>
                                <div className='digit-orb' title={`Highest Under Digit: ${flipAnalysis.highestUnderDigit}`}>
                                    {flipAnalysis.highestUnderDigit}
                                </div>
                            </div>

                            {/* Over Target Entry Card */}
                            <div className={`glowing-digit-card glowing-digit-card--over ${flipAnalysis.activeSignal === 'OVER' ? 'is-active-trigger' : ''}`}>
                                <div className='info-col'>
                                    <span className='tag'>Dominant Over Entry Digit (4-9)</span>
                                    <span className='title'>Trade Over 3 Target</span>
                                    <span className='sub'>Occurred {flipAnalysis.highestOverDigitPct}% in recent stream</span>
                                </div>
                                <div className='digit-orb' title={`Highest Over Digit: ${flipAnalysis.highestOverDigit}`}>
                                    {flipAnalysis.highestOverDigit}
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Compounding Trade Engine Matrix */}
                    <div className='autoflipper__compounding-card'>
                        <div className='comp-header'>
                            <div className='title-wrap'>
                                <h3>
                                    <Layers size={18} /> Automated Compounding Multi-Tier Schedule
                                </h3>
                                <span>24-Hour Continuous Plan Generator &amp; Milestone Tracker</span>
                            </div>
                            <span className='risk-notice'>
                                🛡️ Conservative 2% Account Risk per Stage
                            </span>
                        </div>

                        <div className='comp-inputs-row'>
                            <div className='input-group'>
                                <label>Duration</label>
                                <select
                                    value={compTimeframe}
                                    onChange={e => setCompTimeframe(e.target.value)}
                                >
                                    <option value='12 Hours'>12 Hours</option>
                                    <option value='24 Hours'>24 Hours (Full Run)</option>
                                    <option value='3 Days'>3 Days</option>
                                    <option value='7 Days'>7 Days</option>
                                </select>
                            </div>
                            <div className='input-group'>
                                <label>Starting Capital ({currency})</label>
                                <input
                                    type='number'
                                    step='10'
                                    value={compStartCapital}
                                    onChange={e => setCompStartCapital(e.target.value)}
                                />
                            </div>
                            <div className='input-group'>
                                <label>Target Profit ({currency})</label>
                                <input
                                    type='number'
                                    step='10'
                                    value={compTargetProfit}
                                    onChange={e => setCompTargetProfit(e.target.value)}
                                />
                            </div>
                            <button
                                className='btn-generate'
                                onClick={() => generateCompoundingPlan()}
                                type='button'
                            >
                                <RefreshCw size={14} /> Generate Plan
                            </button>
                        </div>

                        <div className='comp-table-wrap'>
                            <table>
                                <thead>
                                    <tr>
                                        <th>Stage</th>
                                        <th>Target Balance</th>
                                        <th>2% Safe Stake</th>
                                        <th>Stage Target</th>
                                        <th>Cumulative P/L</th>
                                        <th>Status</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {compStages.map(st => (
                                        <tr key={st.stage} className={`stage-${st.status.toLowerCase()}`}>
                                            <td>Stage #{st.stage}</td>
                                            <td>${st.targetBalance.toFixed(2)}</td>
                                            <td>${st.recommendedStake.toFixed(2)}</td>
                                            <td>+${st.stageProfit.toFixed(2)}</td>
                                            <td>+${st.cumulativeProfit.toFixed(2)}</td>
                                            <td>
                                                <span className={`badge-stage-status ${st.status.toLowerCase()}`}>
                                                    {st.status === 'DONE' && '✓ DONE'}
                                                    {st.status === 'ACTIVE' && '⚡ ACTIVE'}
                                                    {st.status === 'PENDING' && '⏳ PENDING'}
                                                </span>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>

                    {/* Bottom Grid: Parameters & Trade Journal */}
                    <div className='autoflipper__bottom-grid'>
                        {/* Trading Parameters Panel */}
                        <div className='autoflipper__params-card'>
                            <h3>
                                <Shield size={16} /> Trading Parameters &amp; Risk Matrix
                            </h3>
                            <div className='af-inputs-grid'>
                                <div className='af-input-group'>
                                    <label>Initial Stake ({currency})</label>
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
                                    <label>Take Profit ({currency})</label>
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
                                <div className='af-input-group'>
                                    <label>Tick Duration</label>
                                    <select
                                        value={tickDuration}
                                        onChange={e => setTickDuration(e.target.value)}
                                        disabled={botState !== 'IDLE'}
                                    >
                                        <option value='1'>1 Tick (Fast Execution)</option>
                                        <option value='2'>2 Ticks</option>
                                    </select>
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

                        {/* Live Trade Journal */}
                        <div className='autoflipper__logs-card'>
                            <div className='af-logs-header'>
                                <h3>
                                    <Activity size={16} /> Live Trade Execution Journal
                                </h3>
                                {tradeLog.length > 0 && (
                                    <button className='af-clear-btn' onClick={handleClearLogs}>
                                        Clear
                                    </button>
                                )}
                            </div>

                            <div className='af-logs-list'>
                                {tradeLog.length === 0 ? (
                                    <div className='af-logs-empty'>
                                        Engine idle. Start Autoflipper to begin live hunting.
                                    </div>
                                ) : (
                                    tradeLog.map(item => (
                                        <div key={item.id} className={`af-log-row af-log-row--${item.result.toLowerCase()}`}>
                                            <span className='time'>{item.time}</span>
                                            <span className='market'>{item.market}</span>
                                            <span className='strategy'>{item.strategy}</span>
                                            <span className='contract'>{item.contractType}</span>
                                            <span className='stake'>${item.stake.toFixed(2)}</span>
                                            <span className={`profit ${item.profit >= 0 ? 'profit--pos' : 'profit--neg'}`}>
                                                {item.profit >= 0 ? `+$${item.profit.toFixed(2)}` : `-$${Math.abs(item.profit).toFixed(2)}`}
                                            </span>
                                            <span className='result'>{item.result}</span>
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
