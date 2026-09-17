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
import './poverty-hunter.scss';

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
    isExcluded: boolean; // 0, 1, 8, 9
}

export interface TradeLogItem {
    id: string;
    time: string;
    market: string;
    strategy: 'DIFFERS' | 'OVER_UNDER' | 'RECOVERY_OVER' | 'RECOVERY_UNDER' | 'TAKE_PROFIT' | 'STOP_LOSS' | 'RECOVERY';
    contractType: string;
    prediction: number;
    stake: number;
    result: 'WIN' | 'LOSS' | 'PENDING';
    profit: number;
}

type AutoRunState = 'IDLE' | 'SCANNING' | 'WAITING_TRIGGER' | 'WAITING_CONFIRMATION' | 'TRADING' | 'PAUSED';

const MARKETS = SUPPORTED_VOLATILITY_MARKETS.map(m => ({
    symbol: m.symbol,
    label: m.label.replace('Volatility ', 'Vol ').replace(' Index', ''),
    pip: m.pip || 2,
}));

const MAX_TICKS_STORED = 100;
const CHART_TICKS = 50;
const EXCLUDED_DIGITS = [0, 1, 8, 9];

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
                    <linearGradient id='phLineGrad' x1='0%' y1='0%' x2='100%' y2='0%'>
                        <stop offset='0%' stopColor='#8b5cf6' stopOpacity='0.7' />
                        <stop offset='50%' stopColor='#a855f7' stopOpacity='1' />
                        <stop offset='100%' stopColor='#c084fc' stopOpacity='0.9' />
                    </linearGradient>
                    <filter id='phGlow' x='-20%' y='-20%' width='140%' height='140%'>
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
                        stroke='url(#phLineGrad)'
                        strokeWidth={2.4}
                        strokeLinejoin='round'
                        strokeLinecap='round'
                        filter='url(#phGlow)'
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

const PovertyHunter: React.FC = observer(() => {
    const store = useStore();
    const { run_panel, summary_card, transactions, client } = store;
    const currency = client?.currency || 'USD';

    // ── UI States ──
    const [selectedSymbol, setSelectedSymbol] = useState<string>('R_100');
    const [scanAllMarkets, setScanAllMarkets] = useState<boolean>(true);
    const [showWideView, setShowWideView] = useState<boolean>(false);
    const [autoSwitchMarkets, setAutoSwitchMarkets] = useState<boolean>(true);
    const [maxRunsBeforeCheck, setMaxRunsBeforeCheck] = useState<number>(7);
    const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(false);

    // ── Strategy Configuration & Inputs ──
    const [initialStake, setInitialStake] = useState<string>('0.50');
    const [currentStake, setCurrentStake] = useState<number>(0.5);
    const [martingale, setMartingale] = useState<string>('2.6');
    const [takeProfit, setTakeProfit] = useState<string>('10.00');
    const [stopLoss, setStopLoss] = useState<string>('25.00');
    const [tickDuration, setTickDuration] = useState<string>('1');
    const [autoRecoveryMode, setAutoRecoveryMode] = useState<boolean>(true);
    const [recoveryType, setRecoveryType] = useState<'OVER_1_UNDER_8' | 'OVER_2_UNDER_7' | 'OVER_3_UNDER_6'>('OVER_1_UNDER_8');

    // ── Bot Running State ──
    const [botState, setBotState] = useState<AutoRunState>('IDLE');
    const [sessionProfit, setSessionProfit] = useState<number>(0);
    const [winsCount, setWinsCount] = useState<number>(0);
    const [lossesCount, setLossesCount] = useState<number>(0);
    const [, setConsecutiveRuns] = useState<number>(0);
    const [isInRecovery, setIsInRecovery] = useState<boolean>(false);
    const [lossToRecover, setLossToRecover] = useState<number>(0);
    const [recoveryProfitEarned, setRecoveryProfitEarned] = useState<number>(0);
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
    const lossToRecoverRef = useRef<number>(0);
    const recoveryProfitEarnedRef = useRef<number>(0);
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

    // Initialize all market entries in ref map
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

    // ── Dynamic Prediction & Confirmation Counter State ──
    const [differTargetDigit, setDifferTargetDigit] = useState<number>(4);
    const [confirmationTicksRemaining, setConfirmationTicksRemaining] = useState<number>(2);
    const [waitingForAppear, setWaitingForAppear] = useState<boolean>(true);

    // ── Safe Manual Market Selection ──
    const handleManualMarketSelect = useCallback(
        (sym: string) => {
            setSelectedSymbol(sym);
            selectedSymbolRef.current = sym;
            lastProcessedTicksRef.current.set(sym, -1);
            setWaitingForAppear(true);
            setConfirmationTicksRemaining(2);
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
                console.error(`Poverty Hunter: Error subscribing to ${sym}:`, err);
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
            const isExcluded = EXCLUDED_DIGITS.includes(digit);

            return {
                digit,
                count,
                percentage,
                rank: 0,
                power: Math.min(100, Math.round((percentage / 20) * 100)),
                isIncreasing,
                isExcluded,
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

    // ── Filter Valid Digits for Differs Candidate (Excluding 0, 1, 8, 9) ──
    const validDifferStats = useMemo(() => {
        return digitStats.filter(s => !s.isExcluded).sort((a, b) => a.count - b.count);
    }, [digitStats]);

    // ── Automatically Selected Least Appearing Digit (Range 2-7) ──
    const autoDifferCandidate = useMemo(() => {
        if (validDifferStats.length === 0) return 4;
        return validDifferStats[0].digit;
    }, [validDifferStats]);

    // ── Best Market Candidate for Auto-Switching ──
    const bestMarketCandidate = useMemo(() => {
        let bestSym = selectedSymbol;
        let bestScore = -1;

        marketsDataRef.current.forEach((mState, sym) => {
            if (mState.digits.length < 30) return;
            const last60 = mState.digits.slice(-60);
            const counts = new Array(10).fill(0);
            last60.forEach(d => {
                if (d >= 0 && d <= 9) counts[d]++;
            });

            const validCounts = counts.filter((_, d) => !EXCLUDED_DIGITS.includes(d));
            const minCount = Math.min(...validCounts);
            const total = last60.length || 1;
            const minPct = (minCount / total) * 100;
            const score = Math.round(100 - minPct * 5);

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
            strategy: 'DIFFERS' | 'OVER_UNDER' | 'RECOVERY_OVER' | 'RECOVERY_UNDER' | 'TAKE_PROFIT' | 'STOP_LOSS' | 'RECOVERY',
            contractType: string,
            prediction: number,
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
            contractType: 'DIGITDIFF' | 'DIGITOVER' | 'DIGITUNDER',
            barrier: number,
            stake: number,
            isRecovery = false
        ) => {
            if (executionLockRef.current) return;
            executionLockRef.current = true;
            setBotState('TRADING');

            const stratName = isRecovery
                ? contractType === 'DIGITOVER'
                    ? 'RECOVERY_OVER'
                    : 'RECOVERY_UNDER'
                : 'DIFFERS';
            const logId = addLogEntry(market, stratName, contractType, barrier, stake, 'PENDING', 0);

            try {
                const duration = parseInt(tickDuration, 10) || 1;
                const buyResult = await buyContractForUi({
                    parameters: {
                        amount: stake,
                        basis: 'stake',
                        contract_type: contractType,
                        currency,
                        duration,
                        duration_unit: 't',
                        symbol: market,
                        barrier: String(barrier),
                    },
                    price: stake,
                    source: 'Poverty Hunter',
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
                    shortcode: `PH_${contractType}_${barrier}`,
                    contract_type: contractType,
                    currency: currency || 'USD',
                    date_start: startTime,
                    status: 'open',
                    barrier: String(barrier),
                };
                pushContractToDrawer(initSnapshot);

                // Stream until settled
                const settledSnapshot = await streamContractUntilSettled({
                    contractId,
                    fallback: initSnapshot,
                    onUpdate: snapshot => {
                        pushContractToDrawer(snapshot);
                    },
                    source: 'Poverty Hunter',
                });

                pushContractToDrawer(settledSnapshot);
                const profitVal = Number(settledSnapshot?.profit || 0);
                const isWin = profitVal > 0;

                // Record cross-bot learning outcome
                aiContinuousLearningService.recordBotTrade({
                    botName: 'POVERTY_HUNTER',
                    strategy: isInRecoveryRef.current ? 'RECOVERY' : 'DIFFERS',
                    market,
                    contractType: contractType,
                    barrier: String(barrier),
                    prediction: Number(barrier),
                    isWin,
                    profit: profitVal,
                    stake,
                });

                if (isWin) {
                    updateLogResult(logId, 'WIN', profitVal);
                    setWinsCount(w => w + 1);
                    const nextP = Math.round((sessionProfitRef.current + profitVal) * 100) / 100;
                    sessionProfitRef.current = nextP;
                    setSessionProfit(nextP);

                    if (isInRecoveryRef.current) {
                        const newEarned = Math.round((recoveryProfitEarnedRef.current + profitVal) * 100) / 100;
                        recoveryProfitEarnedRef.current = newEarned;
                        setRecoveryProfitEarned(newEarned);

                        // Only revert back to Differs after loss is 100% recovered
                        if (newEarned >= lossToRecoverRef.current) {
                            addLogEntry(
                                market,
                                'RECOVERY',
                                `RECOVERY COMPLETE 🏆 (+${newEarned.toFixed(2)} ${currency} recovered) — Reverting to Differs`,
                                barrier,
                                currentStakeRef.current,
                                'WIN',
                                profitVal
                            );
                            setIsInRecovery(false);
                            isInRecoveryRef.current = false;
                            lossToRecoverRef.current = 0;
                            setLossToRecover(0);
                            recoveryProfitEarnedRef.current = 0;
                            setRecoveryProfitEarned(0);
                            const baseStk = parseFloat(initialStake) || 0.5;
                            currentStakeRef.current = baseStk;
                            setCurrentStake(baseStk);
                        } else {
                            const remaining = Math.round((lossToRecoverRef.current - newEarned) * 100) / 100;
                            addLogEntry(
                                market,
                                contractType === 'DIGITOVER' ? 'RECOVERY_OVER' : 'RECOVERY_UNDER',
                                `RECOVERY WIN (+$${profitVal.toFixed(2)} | $${remaining.toFixed(2)} remaining to full recovery)`,
                                barrier,
                                currentStakeRef.current,
                                'WIN',
                                profitVal
                            );
                            // Keep current recovery stake to continue Over/Under recovery until target reached
                        }
                    } else {
                        const baseStk = parseFloat(initialStake) || 0.5;
                        currentStakeRef.current = baseStk;
                        setCurrentStake(baseStk);
                    }
                } else {
                    updateLogResult(logId, 'LOSS', profitVal);
                    setLossesCount(l => l + 1);
                    const nextP = Math.round((sessionProfitRef.current + profitVal) * 100) / 100;
                    sessionProfitRef.current = nextP;
                    setSessionProfit(nextP);

                    if (autoRecoveryMode) {
                        const lossAmount = Math.abs(profitVal);
                        lossToRecoverRef.current = Math.round((lossToRecoverRef.current + lossAmount) * 100) / 100;
                        setLossToRecover(lossToRecoverRef.current);
                        setIsInRecovery(true);
                        isInRecoveryRef.current = true;

                        const martMult = parseFloat(martingale) || 2.6;
                        const nextStake = Math.round(stake * martMult * 100) / 100;
                        currentStakeRef.current = nextStake;
                        setCurrentStake(nextStake);
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
                console.error('Poverty Hunter Trade execution failed:', err);
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
        let ticksRemaining = 2;
        let waitingForCandidate = true;

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
                    addLogEntry(targetSym, 'TAKE_PROFIT', 'TARGET ACHIEVED 🎯', 0, 0, 'WIN', sessionProfitRef.current);
                    setMilestone({ isOpen: true, type: 'tp' });
                    break;
                }
                if (sessionProfitRef.current <= -slVal && slVal > 0) {
                    setBotStateSync('IDLE');
                    addLogEntry(targetSym, 'STOP_LOSS', 'SAFETY STOP HIT 🛑', 0, 0, 'LOSS', sessionProfitRef.current);
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
                        waitingForCandidate = true;
                        ticksRemaining = 2;
                        setWaitingForAppear(true);
                        setConfirmationTicksRemaining(2);
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
                const currLastDigit = mData.lastDigit;
                const currTickCount = mData.tickCount || 0;
                const lastProcessed = lastProcessedTicksRef.current.get(targetSym) ?? -1;

                // Independent per-symbol fresh tick gate
                if (lastProcessed !== -1 && currTickCount <= lastProcessed) {
                    await new Promise(r => setTimeout(r, 40));
                    continue;
                }
                lastProcessedTicksRef.current.set(targetSym, currTickCount);

                // 1. RECOVERY MODE BRANCH: High-Frequency Over / Under Strategy
                if (isInRecoveryRef.current) {
                    const last50 = digits.slice(-50);
                    const under05 = last50.filter(d => d <= 5).length;
                    const over49 = last50.filter(d => d >= 4).length;
                    const isUnderFavored = under05 >= over49;

                    const barrier = isUnderFavored
                        ? (recoveryType === 'OVER_1_UNDER_8' ? 8 : recoveryType === 'OVER_2_UNDER_7' ? 7 : 6)
                        : (recoveryType === 'OVER_1_UNDER_8' ? 1 : recoveryType === 'OVER_2_UNDER_7' ? 2 : 3);
                    const contractType = isUnderFavored ? 'DIGITUNDER' : 'DIGITOVER';

                    // High-probability trigger entry
                    const isTrigger = isUnderFavored
                        ? (currLastDigit <= (barrier === 8 ? 6 : barrier === 7 ? 5 : 4) || under05 >= 25)
                        : (currLastDigit >= (barrier === 1 ? 3 : barrier === 2 ? 4 : 5) || over49 >= 25);

                    if (isTrigger) {
                        setBotStateSync('TRADING');
                        try {
                            await executeTradeOrder(targetSym, contractType, barrier, currentStakeRef.current, true);
                        } catch (e) {
                            console.error('Poverty Hunter Recovery trade error:', e);
                        }
                        waitingForCandidate = true;
                        ticksRemaining = 2;
                        setWaitingForAppear(true);
                        setConfirmationTicksRemaining(2);
                        if (botStateRef.current !== 'IDLE' && botStateRef.current !== 'PAUSED') {
                            setBotStateSync('SCANNING');
                        }
                        await new Promise(r => setTimeout(r, 500));
                    } else {
                        if (botStateRef.current !== 'WAITING_TRIGGER') {
                            setBotStateSync('WAITING_TRIGGER');
                        }
                        await new Promise(r => setTimeout(r, 40));
                    }
                    continue;
                }

                // 2. PRIMARY STRATEGY: Differs Strategy with Live Dynamic Prediction
                const targetDiff = autoDifferCandidate ?? differTargetDigit ?? 4;
                if (differTargetDigit !== targetDiff) {
                    setDifferTargetDigit(targetDiff);
                }

                if (waitingForCandidate) {
                    if (currLastDigit === targetDiff) {
                        waitingForCandidate = false;
                        setWaitingForAppear(false);
                        ticksRemaining = 2;
                        setConfirmationTicksRemaining(2);
                        if (botStateRef.current !== 'WAITING_CONFIRMATION') {
                            setBotStateSync('WAITING_CONFIRMATION');
                        }
                    } else {
                        if (botStateRef.current !== 'SCANNING') {
                            setBotStateSync('SCANNING');
                        }
                    }
                } else if (ticksRemaining > 0) {
                    if (currLastDigit === targetDiff) {
                        // Target candidate appeared during verification -> Reset countdown back to 2
                        waitingForCandidate = true;
                        setWaitingForAppear(true);
                        ticksRemaining = 2;
                        setConfirmationTicksRemaining(2);
                        if (botStateRef.current !== 'SCANNING') {
                            setBotStateSync('SCANNING');
                        }
                    } else {
                        ticksRemaining -= 1;
                        setConfirmationTicksRemaining(ticksRemaining);

                        if (ticksRemaining === 0) {
                            // 2 clean ticks elapsed without candidate appearing -> Execute Differs Trade!
                            setBotStateSync('TRADING');
                            try {
                                await executeTradeOrder(targetSym, 'DIGITDIFF', targetDiff, currentStakeRef.current, false);
                            } catch (e) {
                                console.error('Poverty Hunter Differs trade error:', e);
                            }
                            waitingForCandidate = true;
                            setWaitingForAppear(true);
                            ticksRemaining = 2;
                            setConfirmationTicksRemaining(2);
                            if (botStateRef.current !== 'IDLE' && botStateRef.current !== 'PAUSED') {
                                setBotStateSync('SCANNING');
                            }
                            await new Promise(r => setTimeout(r, 500));
                        } else {
                            if (botStateRef.current !== 'WAITING_CONFIRMATION') {
                                setBotStateSync('WAITING_CONFIRMATION');
                            }
                        }
                    }
                } else {
                    waitingForCandidate = true;
                    setWaitingForAppear(true);
                    ticksRemaining = 2;
                    setConfirmationTicksRemaining(2);
                    if (botStateRef.current !== 'SCANNING') {
                        setBotStateSync('SCANNING');
                    }
                }

                await new Promise(r => setTimeout(r, 40));
            }
        };

        void loop();
    }, [
        takeProfit,
        stopLoss,
        autoSwitchMarkets,
        maxRunsBeforeCheck,
        bestMarketCandidate,
        differTargetDigit,
        autoDifferCandidate,
        setBotStateSync,
        executeTradeOrder,
        addLogEntry,
        recoveryType,
    ]);

    // ── Handlers ──
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
        consecutiveRunsRef.current = 0;
        setConsecutiveRuns(0);
        sessionProfitRef.current = 0;
        setSessionProfit(0);
        setWinsCount(0);
        setLossesCount(0);
        isInRecoveryRef.current = false;
        setIsInRecovery(false);
        lossToRecoverRef.current = 0;
        setLossToRecover(0);
        recoveryProfitEarnedRef.current = 0;
        setRecoveryProfitEarned(0);
        setWaitingForAppear(true);
        setConfirmationTicksRemaining(2);
        lastProcessedTicksRef.current.clear();
        setBotStateSync('SCANNING');
        void startAutoTradingLoop();
    }, [client?.is_logged_in, initialStake, setBotStateSync, startAutoTradingLoop]);

    const handleStopBot = useCallback(() => {
        setBotStateSync('IDLE');
        autoAbortRef.current?.abort();
        executionLockRef.current = false;
        setIsInRecovery(false);
        isInRecoveryRef.current = false;
        lossToRecoverRef.current = 0;
        setLossToRecover(0);
        recoveryProfitEarnedRef.current = 0;
        setRecoveryProfitEarned(0);
    }, [setBotStateSync]);

    const handlePauseBot = useCallback(() => {
        if (botStateRef.current === 'PAUSED') {
            setBotStateSync('SCANNING');
        } else if (botStateRef.current !== 'IDLE') {
            setBotStateSync('PAUSED');
        }
    }, [setBotStateSync]);

    const handleClearStats = () => {
        setSessionProfit(0);
        setWinsCount(0);
        setLossesCount(0);
        setTradeLog([]);
    };

    // TopBar controller integration
    useEffect(() => {
        window.dispatchEvent(
            new CustomEvent('PH_ENGINE_STATUS_UPDATE', {
                detail: {
                    tab: 'poverty_hunter',
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
            if (customEvent.detail?.tab === 'poverty_hunter') {
                const act = customEvent.detail.action;
                if (act === 'start' || (act === 'toggle' && botStateRef.current === 'IDLE')) {
                    if (botStateRef.current === 'IDLE') {
                        handleStartBot();
                    }
                } else if (act === 'stop' || (act === 'toggle' && botStateRef.current !== 'IDLE')) {
                    if (botStateRef.current !== 'IDLE') {
                        handleStopBot();
                    }
                }
            }
        };
        window.addEventListener('PH_TRIGGER_ENGINE_ACTION', handleTrigger);
        return () => {
            window.removeEventListener('PH_TRIGGER_ENGINE_ACTION', handleTrigger);
        };
    }, [handleStartBot, handleStopBot]);

    const totalTrades = winsCount + lossesCount;
    const winRate = totalTrades > 0 ? ((winsCount / totalTrades) * 100).toFixed(1) : '0.0';

    return (
        <div className='poverty-hunter'>
            {/* ── Top Hero Header ── */}
            <div className='poverty-hunter__header'>
                <div className='poverty-hunter__header-title-box'>
                    <div className='ph-icon-badge'>
                        <svg
                            width='28'
                            height='28'
                            viewBox='0 0 24 24'
                            fill='none'
                            stroke='currentColor'
                            strokeWidth='2.2'
                        >
                            <circle cx='12' cy='12' r='10' />
                            <line x1='22' y1='12' x2='18' y2='12' />
                            <line x1='6' y1='12' x2='2' y2='12' />
                            <line x1='12' y1='6' x2='12' y2='2' />
                            <line x1='12' y1='22' x2='12' y2='18' />
                            <circle cx='12' cy='12' r='3' />
                        </svg>
                    </div>
                    <div className='ph-title-text'>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.8rem', flexWrap: 'wrap' }}>
                            <h1>POVERTY HUNTER</h1>
                            <span
                                className={`ph-status-chip ph-status-chip--${botState === 'TRADING' ? (isInRecovery ? 'recovery' : 'hunting') : botState.toLowerCase()}`}
                            >
                                {botState === 'TRADING'
                                    ? isInRecovery
                                        ? '⚡ RECOVERY ACTIVE'
                                        : '🎯 HUNTING LIVE'
                                    : botState === 'PAUSED'
                                      ? '⏸ PAUSED'
                                      : '● SYSTEM READY'}
                            </span>
                        </div>
                        <span>High-Precision Synthetic Multi-Scanner &amp; Automated Differs / Over-Under Engine</span>
                    </div>
                </div>

                <div className='poverty-hunter__header-actions'>
                    <div className='ph-metric-pill'>
                        <span className='ph-metric-pill__label'>Session P/L</span>
                        <span
                            className={`ph-metric-pill__val ${sessionProfit > 0 ? 'ph-metric-pill__val--profit' : sessionProfit < 0 ? 'ph-metric-pill__val--loss' : ''}`}
                        >
                            {sessionProfit >= 0 ? `+${sessionProfit.toFixed(2)}` : sessionProfit.toFixed(2)} {currency}
                        </span>
                    </div>
                    <div className='ph-metric-pill'>
                        <span className='ph-metric-pill__label'>Win Rate</span>
                        <span
                            className='ph-metric-pill__val'
                            style={{
                                color: Number(winRate) >= 60 ? '#10b981' : Number(winRate) > 0 ? '#f59e0b' : '#94a3b8',
                            }}
                        >
                            {winRate}%
                        </span>
                    </div>
                    <div className='ph-metric-pill'>
                        <span className='ph-metric-pill__label'>Wins / Losses</span>
                        <span className='ph-metric-pill__val'>
                            <span style={{ color: '#10b981' }}>{winsCount}W</span> /{' '}
                            <span style={{ color: '#ef4444' }}>{lossesCount}L</span>
                        </span>
                    </div>
                    <div className='ph-metric-pill'>
                        <span className='ph-metric-pill__label'>Active Stake</span>
                        <span className='ph-metric-pill__val ph-metric-pill__val--highlight'>
                            {currentStake.toFixed(2)} {currency}
                        </span>
                    </div>
                    <button
                        className='ph-ai-lab-btn'
                        onClick={() => setIsAiLearningModalOpen(true)}
                        title='Open Multi-Bot Continuous Neural Learning Lab & 24/7 Machine Mode'
                        type='button'
                    >
                        <span className='ph-ai-lab-btn__dot' />
                        🧠 AI Learning Lab
                    </button>
                </div>
            </div>

            {/* ── Market Selector & Wide View Ribbon ── */}
            <div className='poverty-hunter__market-bar'>
                <div className='ph-select-group'>
                    <label>Active Market:</label>
                    <select
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

                <div className='ph-actions-cluster'>
                    <button
                        className={`ph-toggle-button ${!sidebarCollapsed ? 'ph-toggle-button--active' : ''}`}
                        onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
                        title='Toggle market list sidebar'
                    >
                        📋 {sidebarCollapsed ? 'Show Markets Sidebar' : 'Hide Sidebar'}
                    </button>

                    <button
                        className={`ph-toggle-button ${scanAllMarkets ? 'ph-toggle-button--active' : ''}`}
                        onClick={() => setScanAllMarkets(!scanAllMarkets)}
                        title='Scan all derived synthetic indices simultaneously'
                    >
                        ⚡ Scan All ({scanAllMarkets ? 'ON' : 'OFF'})
                    </button>

                    <button
                        className={`ph-toggle-button ${showWideView ? 'ph-toggle-button--active' : ''}`}
                        onClick={() => setShowWideView(!showWideView)}
                    >
                        📊 {showWideView ? 'Collapse Matrix' : 'Wide Market Matrix'}
                    </button>

                    <button
                        className={`ph-toggle-button ${autoSwitchMarkets ? 'ph-toggle-button--active' : ''}`}
                        onClick={() => setAutoSwitchMarkets(!autoSwitchMarkets)}
                        title='Automatically switch to best performing market after runs'
                    >
                        🔄 Auto-Switch ({autoSwitchMarkets ? 'ON' : 'OFF'})
                    </button>
                </div>
            </div>

            {/* ── Expandable Wide View Grid ── */}
            {showWideView && (
                <div className='poverty-hunter__wide-view'>
                    {MARKETS.map(m => {
                        const mState = marketsDataRef.current.get(m.symbol);
                        const digits = mState?.digits || [];
                        const last50 = digits.slice(-50);
                        const u = last50.filter(d => d <= 4).length;
                        const o = last50.filter(d => d >= 5).length;
                        const isSelected = m.symbol === selectedSymbol;

                        return (
                            <div
                                key={m.symbol}
                                className={`ph-wide-card ${isSelected ? 'ph-wide-card--selected' : ''}`}
                                onClick={() => {
                                    handleManualMarketSelect(m.symbol);
                                    setShowWideView(false);
                                }}
                            >
                                <div className='ph-wide-card__header'>
                                    <span className='name'>{m.label}</span>
                                    <span
                                        className={`digit-badge digit-badge--${(mState?.lastDigit ?? 0) < 5 ? 'under' : 'over'}`}
                                    >
                                        {mState?.lastDigit ?? '—'}
                                    </span>
                                </div>
                                <div className='ph-wide-card__price'>Price: {mState?.currentPrice ?? '0.00'}</div>
                                <div className='ph-wide-card__stats-row'>
                                    <span style={{ color: '#10b981' }}>Under (0-4): {u}</span>
                                    <span style={{ color: '#60a5fa' }}>Over (5-9): {o}</span>
                                    <span style={{ color: '#f5c542' }}>Best: {u >= o ? 'UNDER' : 'OVER'}</span>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}

            {/* ── Main Body: Left Sidebar Ribbon + Center Workspace ── */}
            <div className={`poverty-hunter__body ${sidebarCollapsed ? 'poverty-hunter__body--collapsed' : ''}`}>
                {/* Left Sidebar / Markets List */}
                {!sidebarCollapsed && (
                    <div className='poverty-hunter__sidebar'>
                        <div className='poverty-hunter__sidebar-header'>
                            <h3>DERIVED MARKETS</h3>
                            <span className='badge'>LIVE FEED</span>
                        </div>
                        <div className='poverty-hunter__sidebar-list'>
                            {MARKETS.map(m => {
                                const mState = marketsDataRef.current.get(m.symbol);
                                const digits = mState?.digits || [];
                                const last50 = digits.slice(-50);
                                const u = last50.filter(d => d <= 4).length;
                                const o = last50.filter(d => d >= 5).length;
                                const isSelected = m.symbol === selectedSymbol;
                                const lastDigit = mState?.lastDigit ?? 0;

                                return (
                                    <div
                                        key={m.symbol}
                                        className={`ph-market-card ${isSelected ? 'ph-market-card--active' : ''}`}
                                        onClick={() => handleManualMarketSelect(m.symbol)}
                                    >
                                        <div className='ph-market-card__top'>
                                            <span className='symbol-name'>{m.label}</span>
                                            <span
                                                className={`digit-pill digit-pill--${lastDigit < 5 ? 'under' : 'over'}`}
                                            >
                                                {lastDigit}
                                            </span>
                                        </div>
                                        <div className='ph-market-card__mid'>
                                            <span className='price'>{mState?.currentPrice ?? '0.00'}</span>
                                            <span className={`bias ${u >= o ? 'bias--under' : 'bias--over'}`}>
                                                {u >= o ? `Under ${u}` : `Over ${o}`}
                                            </span>
                                        </div>
                                        <div className='ph-market-card__bot'>
                                            <span>Differs Pick:</span>
                                            <span className='rec-differ'>
                                                Digit {(((mState?.lastDigit ?? 3) + 4) % 6) + 2}
                                            </span>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                )}

                {/* Right Workspace */}
                <div className='poverty-hunter__workspace'>
                    {/* Live Chart & Last Digit Banner */}
                    <div className='poverty-hunter__chart-card'>
                        <div className='ph-chart-top'>
                            <div className='ph-price-badge-group'>
                                <div className='ph-current-price-box'>
                                    <span className='label'>LIVE QUOTE ({currentMarket.symbol})</span>
                                    <div className='price-row'>
                                        <span className='price'>{currentMarket.currentPrice}</span>
                                        <span className='live-dot' />
                                    </div>
                                </div>
                                <div
                                    className={`ph-last-digit-big ph-last-digit-big--${currentMarket.lastDigit < 5 ? 'under' : 'over'}`}
                                >
                                    <span className='digit-label'>LAST DIGIT</span>
                                    <span className='digit-val'>{currentMarket.lastDigit}</span>
                                    <span className='digit-sub'>
                                        {currentMarket.lastDigit < 5 ? 'Under (0–4)' : 'Over (5–9)'}
                                    </span>
                                </div>
                            </div>

                            <div className='ph-chart-legend'>
                                <div className='legend-item'>
                                    <span className='dot dot--curve' />
                                    <span>50-Ticks Spline</span>
                                </div>
                                <div className='legend-item'>
                                    <span className='dot dot--under' />
                                    <span>Under 0–4</span>
                                </div>
                                <div className='legend-item'>
                                    <span className='dot dot--over' />
                                    <span>Over 5–9</span>
                                </div>
                                <div className='legend-item'>
                                    <span className='dot dot--curr' />
                                    <span>Active Spot</span>
                                </div>
                            </div>
                        </div>

                        {/* Live Digit Trajectory Spline Chart */}
                        <div className='ep-chart-wrap'>
                            <DigitLineChart digits={currentMarket.digits} />
                        </div>
                    </div>

                    {/* Digits 0-9 Statistical Grid (Fainted for 0,1 & 8,9) */}
                    <div className='poverty-hunter__digits-grid'>
                        {digitStats.map(stat => {
                            const isDifferPick = stat.digit === differTargetDigit;
                            return (
                                <div
                                    key={stat.digit}
                                    className={`ph-digit-stat-card ${stat.isExcluded ? 'ph-digit-stat-card--excluded' : ''} ${isDifferPick ? 'ph-digit-stat-card--differ-pick' : ''}`}
                                >
                                    <span className='digit-num'>{stat.digit}</span>
                                    <span className='digit-pct'>{stat.percentage.toFixed(1)}%</span>
                                    <span className='digit-count'>{stat.count} ticks</span>
                                    <div className='digit-power-bar'>
                                        <div
                                            className='fill'
                                            style={{ width: `${Math.min(100, stat.percentage * 4)}%` }}
                                        />
                                    </div>
                                    <span
                                        className={`rank-tag ${stat.rank === 1 ? 'rank-tag--most' : stat.rank === 2 ? 'rank-tag--second' : stat.rank === 10 ? 'rank-tag--least' : ''}`}
                                    >
                                        Rank #{stat.rank}
                                    </span>
                                    {stat.isExcluded && <span className='ph-excluded-badge'>Excluded Edge</span>}
                                    {isDifferPick && (
                                        <span
                                            style={{
                                                fontSize: '0.85rem',
                                                color: '#10b981',
                                                fontWeight: 800,
                                                marginTop: '0.3rem',
                                            }}
                                        >
                                            ⭐ Differs Target
                                        </span>
                                    )}
                                </div>
                            );
                        })}
                    </div>

                    {/* Strategy Status & Trigger Progress Meter */}
                    <div className='poverty-hunter__meter-card'>
                        <div className='ph-meter-header'>
                            <div className='ph-meter-title-wrap'>
                                <h3>
                                    {isInRecovery ? '⚡ RECOVERY PROTOCOL ACTIVE (OVER/UNDER)' : '🎯 DIFFERS VERIFICATION MATRIX'}
                                </h3>
                                <span className='sub'>
                                    {isInRecovery
                                        ? `Over/Under Recovery: $${recoveryProfitEarned.toFixed(2)} / $${lossToRecover.toFixed(2)} ${currency} Recovered`
                                        : `Watching Target Digit [${differTargetDigit}] — Confirmation Status`}
                                </span>
                            </div>

                            <div className='ph-counter-badge'>
                                <span className='count-label'>
                                    {isInRecovery
                                        ? 'RECOVERY PROGRESS'
                                        : waitingForAppear
                                          ? 'AWAITING CANDIDATE'
                                          : 'COUNTDOWN CONFIRMATION'}
                                </span>
                                <span className='count-num'>
                                    {isInRecovery
                                        ? `${Math.min(100, Math.round((recoveryProfitEarned / (lossToRecover || 1)) * 100))}%`
                                        : waitingForAppear
                                          ? 'WAIT'
                                          : `${confirmationTicksRemaining} TICKS`}
                                </span>
                            </div>
                        </div>

                        <div className='ph-progress-container'>
                            <div className='ph-progress-bar-bg'>
                                <div
                                    className={`ph-progress-bar-fill ${isInRecovery ? 'ph-progress-bar-fill--recovery' : ''}`}
                                    style={{
                                        width: isInRecovery
                                            ? `${Math.min(100, Math.max(5, Math.round((recoveryProfitEarned / (lossToRecover || 1)) * 100)))}%`
                                            : waitingForAppear
                                              ? '25%'
                                              : confirmationTicksRemaining === 2
                                                ? '50%'
                                                : confirmationTicksRemaining === 1
                                                  ? '75%'
                                                  : '100%',
                                    }}
                                />
                            </div>
                            <span className='ph-progress-tip'>
                                {isInRecovery
                                    ? `🔥 Placing Over/Under contracts until loss is 100% recovered ($${recoveryProfitEarned.toFixed(2)} / $${lossToRecover.toFixed(2)} ${currency}). Reverting to Differs automatically upon recovery.`
                                    : waitingForAppear
                                      ? `Waiting for Least Appearing Digit [${differTargetDigit}] to trigger in live stream...`
                                      : `Digit [${differTargetDigit}] appeared! Verifying ${confirmationTicksRemaining} clean ticks before purchase...`}
                            </span>
                        </div>
                    </div>

                    {/* Parameter Configuration & Strategy Matrix */}
                    <div className='poverty-hunter__bottom-grid'>
                        {/* Parameters Panel */}
                        <div className='poverty-hunter__params-card'>
                            <h3>⚙️ Trading &amp; Recovery Parameters</h3>
                            <div className='ph-inputs-grid'>
                                <div className='ph-input-group'>
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

                                <div className='ph-input-group'>
                                    <label>Martingale Multiplier</label>
                                    <input
                                        type='number'
                                        step='0.1'
                                        value={martingale}
                                        onChange={e => setMartingale(e.target.value)}
                                        disabled={botState !== 'IDLE'}
                                    />
                                </div>

                                <div className='ph-input-group'>
                                    <label>Take Profit ({currency})</label>
                                    <input
                                        type='number'
                                        value={takeProfit}
                                        onChange={e => setTakeProfit(e.target.value)}
                                        disabled={botState !== 'IDLE'}
                                    />
                                </div>

                                <div className='ph-input-group'>
                                    <label>Stop Loss ({currency})</label>
                                    <input
                                        type='number'
                                        value={stopLoss}
                                        onChange={e => setStopLoss(e.target.value)}
                                        disabled={botState !== 'IDLE'}
                                    />
                                </div>

                                <div className='ph-input-group'>
                                    <label>Tick Duration</label>
                                    <select
                                        value={tickDuration}
                                        onChange={e => setTickDuration(e.target.value)}
                                        disabled={botState !== 'IDLE'}
                                    >
                                        <option value='1'>1 Tick (Fast)</option>
                                        <option value='2'>2 Ticks</option>
                                    </select>
                                </div>

                                <div className='ph-input-group'>
                                    <label>Auto-Recovery Mode</label>
                                    <select
                                        value={autoRecoveryMode ? 'true' : 'false'}
                                        onChange={e => setAutoRecoveryMode(e.target.value === 'true')}
                                        disabled={botState !== 'IDLE'}
                                    >
                                        <option value='true'>Enabled (Over/Under Fallback)</option>
                                        <option value='false'>Disabled (Differs Only)</option>
                                    </select>
                                </div>

                                {autoRecoveryMode && (
                                    <div className='ph-input-group'>
                                        <label>Recovery Strategy</label>
                                        <select
                                            value={recoveryType}
                                            onChange={e => setRecoveryType(e.target.value as any)}
                                            disabled={botState !== 'IDLE'}
                                        >
                                            <option value='OVER_1_UNDER_8'>Over 1 / Under 8 (~90% Win)</option>
                                            <option value='OVER_2_UNDER_7'>Over 2 / Under 7 (~80% Win)</option>
                                            <option value='OVER_3_UNDER_6'>Over 3 / Under 6 (~70% Win)</option>
                                        </select>
                                    </div>
                                )}
                            </div>

                            {/* Action Control Buttons */}
                            <div className='ph-buttons-row'>
                                {botState === 'IDLE' ? (
                                    <button className='ph-btn ph-btn--start' onClick={handleStartBot}>
                                        ▶ START POVERTY HUNTER
                                    </button>
                                ) : (
                                    <>
                                        <button className='ph-btn ph-btn--pause' onClick={handlePauseBot}>
                                            {botState === 'PAUSED' ? '▶ RESUME' : '⏸ PAUSE'}
                                        </button>
                                        <button className='ph-btn ph-btn--stop' onClick={handleStopBot}>
                                            ⏹ STOP BOT
                                        </button>
                                    </>
                                )}
                            </div>
                        </div>

                        {/* Execution Logs */}
                        <div className='poverty-hunter__logs-card'>
                            <div className='ph-logs-header'>
                                <h3>📋 Live Engine Trade Journal</h3>
                                {tradeLog.length > 0 && (
                                    <button className='ph-clear-btn' onClick={handleClearStats}>
                                        Clear
                                    </button>
                                )}
                            </div>

                            <div className='ph-logs-list'>
                                {tradeLog.length === 0 ? (
                                    <div className='ph-logs-empty'>
                                        System idle. Start the bot to begin hunting.
                                    </div>
                                ) : (
                                    tradeLog.map(item => (
                                        <div key={item.id} className={`ph-log-row ph-log-row--${item.result.toLowerCase()}`}>
                                            <span className='time'>{item.time}</span>
                                            <span className='market'>{item.market}</span>
                                            <span className='strategy'>{item.strategy}</span>
                                            <span className='contract'>{item.contractType} {item.prediction !== undefined ? `[${item.prediction}]` : ''}</span>
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
                botName='Poverty Hunter'
                onClose={() => setMilestone({ isOpen: false, type: null })}
            />

            <AiLearningHubModal
                isOpen={isAiLearningModalOpen}
                onClose={() => setIsAiLearningModalOpen(false)}
            />
        </div>
    );
});

export default PovertyHunter;
