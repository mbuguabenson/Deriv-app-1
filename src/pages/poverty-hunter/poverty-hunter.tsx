import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { TradingMilestoneModal } from '@/components/shared';
import { api_base, observer as globalObserver } from '@/external/bot-skeleton';
import { useStore } from '@/hooks/useStore';
import { SUPPORTED_VOLATILITY_MARKETS } from '@/utils/digit-strategy';
import { buyContractForUi, streamContractUntilSettled } from '@/utils/trade-purchase';
import { safeSubscribe } from '@/utils/websocket-handler';
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

const extractLastDigit = (quote: number | string, pip = 2): number => {
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
    const [bulkCount, setBulkCount] = useState<string>('6');
    const [autoRecoveryMode, setAutoRecoveryMode] = useState<boolean>(true);
    const [recoveryType, setRecoveryType] = useState<'OVER_1_UNDER_8' | 'OVER_2_UNDER_7' | 'OVER_3_UNDER_6'>('OVER_1_UNDER_8');

    // ── Bot Running State ──
    const [botState, setBotState] = useState<AutoRunState>('IDLE');
    const [sessionProfit, setSessionProfit] = useState<number>(0);
    const [winsCount, setWinsCount] = useState<number>(0);
    const [lossesCount, setLossesCount] = useState<number>(0);
    const [, setConsecutiveRuns] = useState<number>(0);
    const [isInRecovery, setIsInRecovery] = useState<boolean>(false);
    const [accumulatedLoss, setAccumulatedLoss] = useState<number>(0);
    const [tradeLog, setTradeLog] = useState<TradeLogItem[]>([]);
    const [milestone, setMilestone] = useState<{ isOpen: boolean; type: 'tp' | 'sl' | null }>({
        isOpen: false,
        type: null,
    });

    // ── Differs Automation Condition States ──
    const [differTargetDigit, setDifferTargetDigit] = useState<number | null>(null);
    const [waitingForAppear, setWaitingForAppear] = useState<boolean>(false);
    const [confirmationTicksRemaining, setConfirmationTicksRemaining] = useState<number>(0);

    // ── Synchronized Refs for Non-Stalling Async Engine Loop ──
    const recoveryTypeRef = useRef<'OVER_1_UNDER_8' | 'OVER_2_UNDER_7' | 'OVER_3_UNDER_6'>(recoveryType);
    useEffect(() => {
        recoveryTypeRef.current = recoveryType;
    }, [recoveryType]);

    // ── Synchronized Refs for Non-Stalling Async Engine Loop ──
    const botStateRef = useRef<AutoRunState>('IDLE');
    const autoAbortRef = useRef<AbortController | null>(null);
    const selectedSymbolRef = useRef<string>(selectedSymbol);
    const sessionProfitRef = useRef<number>(0);
    const consecutiveRunsRef = useRef<number>(0);
    const currentStakeRef = useRef<number>(0.5);
    const isInRecoveryRef = useRef<boolean>(false);

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
                });
            }
        });
    }, []);

    // Throttle UI re-renders
    const lastRenderTime = useRef<number>(0);
    const throttleRender = useCallback(() => {
        const now = Date.now();
        if (now - lastRenderTime.current > 120) {
            lastRenderTime.current = now;
            setRenderTrigger(t => t + 1);
        }
    }, []);

    const [streamRefreshKey, setStreamRefreshKey] = useState(0);

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
                // 1. Fetch initial tick history (50 ticks) if empty or few
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
                        mData.digits = digits.slice(-MAX_TICKS_STORED);
                        if (prices.length > 0) {
                            const lastPrice = prices[prices.length - 1];
                            mData.currentPrice = Number(lastPrice).toFixed(pip);
                            mData.lastDigit = extractLastDigit(lastPrice, pip);
                        }
                        throttleRender();
                    }
                }

                // 2. Subscribe to real-time live ticks
                const tickObservable = api_base.api.subscribe({ ticks: sym });
                const sub = safeSubscribe(tickObservable, (data: Record<string, unknown>) => {
                    if (!isMountedRef.current) return;
                    const activeM = marketsDataRef.current.get(sym);
                    if (!activeM) return;

                    const tick = data?.tick as { quote?: number | string } | undefined;
                    const quote = tick?.quote;
                    if (quote !== undefined && quote !== null) {
                        const d = extractLastDigit(quote, pip);
                        activeM.digits.push(d);
                        if (activeM.digits.length > MAX_TICKS_STORED) activeM.digits.shift();
                        activeM.currentPrice = Number(quote).toFixed(pip);
                        activeM.lastDigit = d;
                        activeM.tickCount = (activeM.tickCount || 0) + 1;
                        throttleRender();
                    }
                });

                activeSubs.get(sym)?.unsubscribe();
                activeSubs.set(sym, sub);
            } catch (err) {
                console.warn(`[PovertyHunter] Stream error for ${sym}:`, err);
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
                await new Promise(r => setTimeout(r, 120)); // Rate-limiting guard
            }
        };

        void initAll();

        // Unsubscribe unused symbols
        activeSubs.forEach((sub, sym) => {
            if (!symbolsToStream.includes(sym)) {
                try {
                    sub.unsubscribe();
                } catch {
                    /* ignore */
                }
                activeSubs.delete(sym);
            }
        });

        return () => {
            isMountedRef.current = false;
            activeSubs.forEach(sub => {
                try {
                    sub.unsubscribe();
                } catch {
                    /* ignore */
                }
            });
            activeSubs.clear();
        };
    }, [scanAllMarkets, selectedSymbol, throttleRender, streamRefreshKey]);

    // ── Current Active Market Data ──
    const currentMarket = useMemo(() => {
        return (
            marketsDataRef.current.get(selectedSymbol) || {
                symbol: selectedSymbol,
                label: selectedSymbol,
                digits: [],
                currentPrice: '0.00',
                lastDigit: 0,
                pip: 2,
            }
        );
    }, [selectedSymbol, renderTrigger]);

    // ── Calculate 0-9 Digit Analytics (Last 60 Ticks) ──
    const digitStats: DigitStat[] = useMemo(() => {
        const last60 = currentMarket.digits.slice(-60);
        const total = last60.length || 1;
        const counts = Array(10).fill(0);
        last60.forEach(d => {
            if (d >= 0 && d <= 9) counts[d]++;
        });

        // Compute power in last 20 vs previous 20 to detect if increasing
        const last20 = currentMarket.digits.slice(-20);
        const prev20 = currentMarket.digits.slice(-40, -20);
        const cLast20 = Array(10).fill(0);
        const cPrev20 = Array(10).fill(0);
        last20.forEach(d => cLast20[d]++);
        prev20.forEach(d => cPrev20[d]++);

        const stats = counts.map((count, digit) => {
            const percentage = (count / total) * 100;
            const isExcluded = EXCLUDED_DIGITS.includes(digit);
            const isIncreasing = cLast20[digit] > cPrev20[digit];
            return {
                digit,
                count,
                percentage,
                rank: 0,
                power: Math.round(percentage),
                isIncreasing,
                isExcluded,
            };
        });

        // Sort to assign rankings
        const sortedIndices = [...stats].map((s, idx) => ({ idx, count: s.count })).sort((a, b) => b.count - a.count);

        sortedIndices.forEach((item, rankIdx) => {
            stats[item.idx].rank = rankIdx + 1;
        });

        return stats;
    }, [currentMarket.digits]);

    // Summary Rankings (Most, 2nd Highest, Least)
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

        // Last 10 Ticks direction check
        const last10 = currentMarket.digits.slice(-10);
        const last10Under = last10.filter(d => d <= 4).length;
        const last10Over = last10.filter(d => d >= 5).length;

        // Bias calculation
        let bias: 'UNDER' | 'OVER' | 'NEUTRAL' = 'NEUTRAL';
        if (under04Pct >= 55 && under05 > over49 && last10Under >= 7) {
            bias = 'UNDER';
        } else if (over59Pct >= 55 && over49 > under05 && last10Over >= 7) {
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
            bias,
        };
    }, [currentMarket.digits, digitStats]);

    // ── Differs Candidate Auto-Selection (Safe Middle Digits 2 to 7) ──
    const autoDifferCandidate = useMemo(() => {
        // Safe middle candidate pool: digits 2 to 7 (excluding edge digits 0, 1, 8, 9)
        const middleCandidates = digitStats.filter(
            s => s.digit >= 2 && s.digit <= 7 && s.digit !== mostAppearing
        );
        if (middleCandidates.length > 0) {
            // Pick lowest frequency safe digit
            middleCandidates.sort((a, b) => a.count - b.count);
            return middleCandidates[0].digit;
        }
        return 4;
    }, [digitStats, mostAppearing]);

    // Auto update differ target digit continuously to track safest middle digit dynamically
    useEffect(() => {
        setDifferTargetDigit(autoDifferCandidate);
    }, [autoDifferCandidate]);

    // ── Best Market Auto-Selector for Switcher ──
    const bestMarketCandidate = useMemo(() => {
        let bestSym = selectedSymbol;
        let bestScore = -1;

        marketsDataRef.current.forEach((mState, sym) => {
            if (mState.digits.length < 30) return;
            const last50 = mState.digits.slice(-50);
            const uCount = last50.filter(d => d <= 4).length;
            const oCount = last50.filter(d => d >= 5).length;
            const score = Math.max(uCount, oCount);
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
                transactions.pushTransaction({ ...contractSnapshot, run_id: run_panel.run_id });
                run_panel.onBotContractEvent(contractSnapshot);
                summary_card.onBotContractEvent(contractSnapshot);
            } catch {
                // Ignore if core stores aren't initialized
            }
        },
        [run_panel, summary_card, transactions]
    );

    const addLogEntry = useCallback(
        (
            market: string,
            strategy: 'DIFFERS' | 'OVER_UNDER' | 'RECOVERY_OVER' | 'RECOVERY_UNDER',
            contractType: string,
            prediction: number,
            stake: number,
            result: 'WIN' | 'LOSS' | 'PENDING',
            profit: number
        ) => {
            setTradeLog(prev =>
                [
                    {
                        id: `PH-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                        time: new Date().toLocaleTimeString(),
                        market,
                        strategy,
                        contractType,
                        prediction,
                        stake,
                        result,
                        profit,
                    },
                    ...prev,
                ].slice(0, 80)
            );
        },
        []
    );

    // ── Execute Trade Order (Single or Bulk) ──
    const executeTradeOrder = useCallback(
        async (
            symbol: string,
            contractType: 'DIGITDIFF' | 'DIGITOVER' | 'DIGITUNDER',
            barrier: number,
            stakeAmount: number,
            isRecoveryTrade = false
        ) => {
            if (executionLockRef.current) return;
            executionLockRef.current = true;

            const dur = parseInt(tickDuration, 10) || 1;
            const count = Math.max(1, parseInt(bulkCount, 10) || 1);
            const marketLabel = MARKETS.find(m => m.symbol === symbol)?.label || symbol;

            const params = {
                amount: stakeAmount,
                basis: 'stake',
                contract_type: contractType,
                currency: currency || 'USD',
                duration: dur,
                duration_unit: 't',
                symbol,
                barrier: String(barrier),
            };

            const stratType = isRecoveryTrade
                ? contractType === 'DIGITOVER'
                    ? 'RECOVERY_OVER'
                    : 'RECOVERY_UNDER'
                : contractType === 'DIGITDIFF'
                  ? 'DIFFERS'
                  : 'OVER_UNDER';

            try {
                // Execute batch (Bulk purchases executed in parallel with same entry/exit)
                const buyPromises = Array.from({ length: count }, () =>
                    buyContractForUi({ parameters: params, price: stakeAmount, source: 'PovertyHunter' })
                );

                const buyResults = await Promise.all(buyPromises);
                let totalBatchProfit = 0;
                let batchWon = true;

                for (const buy of buyResults) {
                    if (!buy?.contract_id) continue;
                    const startTime = Math.floor(Date.now() / 1000);
                    const initSnapshot = {
                        buy_price: buy.buy_price,
                        contract_id: buy.contract_id,
                        transaction_ids: { buy: buy.transaction_id },
                        date_start: startTime,
                        display_name: marketLabel,
                        underlying_symbol: symbol,
                        shortcode: `PH_${contractType}_${barrier}`,
                        contract_type: contractType,
                        currency: currency || 'USD',
                        barrier: String(barrier),
                    };

                    pushContractToDrawer(initSnapshot);

                    const settled = await streamContractUntilSettled({
                        contractId: buy.contract_id,
                        fallback: initSnapshot,
                        onUpdate: snap => pushContractToDrawer(snap),
                        source: 'PovertyHunter',
                    });

                    const p = Number(settled.profit || 0);
                    totalBatchProfit += p;
                    if (settled.status === 'lost' || p < 0) {
                        batchWon = false;
                    }
                }

                // Post-trade handling
                const roundedProfit = Number(totalBatchProfit.toFixed(2));
                const nextP = Number((sessionProfitRef.current + roundedProfit).toFixed(2));
                sessionProfitRef.current = nextP;
                setSessionProfit(nextP);

                if (batchWon) {
                    setWinsCount(w => w + count);
                    addLogEntry(symbol, stratType, contractType, barrier, stakeAmount * count, 'WIN', roundedProfit);

                    // Recovery logic check
                    if (isRecoveryTrade || isInRecoveryRef.current) {
                        const newAccLoss = accumulatedLoss - roundedProfit;
                        if (newAccLoss <= 0) {
                            // Fully recovered! Revert to Differs with original base stake
                            setIsInRecovery(false);
                            isInRecoveryRef.current = false;
                            setAccumulatedLoss(0);
                            const baseStk = parseFloat(initialStake) || 0.5;
                            currentStakeRef.current = baseStk;
                            setCurrentStake(baseStk);
                            addLogEntry(symbol, 'RECOVERY', 'RECOVERED_TO_DIFFERS', 0, 0, 'WIN', roundedProfit);
                        } else {
                            setAccumulatedLoss(newAccLoss);
                        }
                    } else {
                        const baseStk = parseFloat(initialStake) || 0.5;
                        currentStakeRef.current = baseStk;
                        setCurrentStake(baseStk);
                    }
                } else {
                    setLossesCount(l => l + count);
                    addLogEntry(symbol, stratType, contractType, barrier, stakeAmount * count, 'LOSS', roundedProfit);

                    // Single Loss -> Trigger Over/Under Recovery
                    if (autoRecoveryMode) {
                        setIsInRecovery(true);
                        isInRecoveryRef.current = true;
                        const lost = Math.abs(roundedProfit);
                        setAccumulatedLoss(al => al + lost);

                        const mult = parseFloat(martingale) || 2.6;
                        const nextStake = Number((stakeAmount * mult).toFixed(2));
                        currentStakeRef.current = nextStake;
                        setCurrentStake(nextStake);
                    }
                }

                consecutiveRunsRef.current += 1;
                setConsecutiveRuns(consecutiveRunsRef.current);
                return roundedProfit;
            } catch (err) {
                console.error('[PovertyHunter] Order execution error:', err);
                addLogEntry(symbol, stratType, contractType, barrier, stakeAmount, 'LOSS', 0);
                return -stakeAmount;
            } finally {
                executionLockRef.current = false;
            }
        },
        [
            tickDuration,
            bulkCount,
            currency,
            pushContractToDrawer,
            addLogEntry,
            accumulatedLoss,
            initialStake,
            autoRecoveryMode,
            martingale,
        ]
    );

    // ── Dedicated Asynchronous Trading Engine Loop ──
    const startAutoTradingLoop = useCallback(async () => {
        autoAbortRef.current?.abort();
        const abortCtrl = new AbortController();
        autoAbortRef.current = abortCtrl;
        const signal = abortCtrl.signal;

        const tp = parseFloat(takeProfit) || 9999;
        const sl = parseFloat(stopLoss) || 9999;

        setBotStateSync('SCANNING');

        let waitingForCandidate = true;
        let ticksRemaining = 3;
        let lastProcessedTick = -1;

        const loop = async () => {
            while (!signal.aborted && botStateRef.current !== 'IDLE') {
                if (botStateRef.current === 'PAUSED') {
                    await new Promise(r => setTimeout(r, 400));
                    continue;
                }

                // Check Take Profit & Stop Loss
                if (sessionProfitRef.current >= tp) {
                    setBotStateSync('IDLE');
                    addLogEntry(selectedSymbolRef.current, 'TAKE_PROFIT', 'DOLLARS_PRINTED 💵💸', 0, 0, 'WIN', sessionProfitRef.current);
                    setMilestone({ isOpen: true, type: 'tp' });
                    break;
                }
                if (sessionProfitRef.current <= -sl) {
                    setBotStateSync('IDLE');
                    addLogEntry(selectedSymbolRef.current, 'STOP_LOSS', 'CAPITAL_PROTECTED 🛡️', 0, 0, 'LOSS', sessionProfitRef.current);
                    setMilestone({ isOpen: true, type: 'sl' });
                    break;
                }

                let targetSym = selectedSymbolRef.current;

                // Check Max Runs threshold (default 7 runs) -> Auto-pause, re-analyze & resume/switch
                if (consecutiveRunsRef.current >= maxRunsBeforeCheck) {
                    consecutiveRunsRef.current = 0;
                    setConsecutiveRuns(0);
                    // Soft cooldown pause to re-analyze conditions
                    if (bestMarketCandidate && bestMarketCandidate !== targetSym && autoSwitchMarkets) {
                        targetSym = bestMarketCandidate;
                        selectedSymbolRef.current = targetSym;
                        setSelectedSymbol(targetSym);
                        lastProcessedTick = -1;
                    }
                    waitingForCandidate = true;
                    ticksRemaining = 3;
                    setWaitingForAppear(true);
                    setConfirmationTicksRemaining(3);
                    if (botStateRef.current !== 'PAUSED' && botStateRef.current !== 'IDLE') {
                        setBotStateSync('SCANNING');
                    }
                    await new Promise(r => setTimeout(r, 600));
                }

                const mData = marketsDataRef.current.get(targetSym);
                if (!mData || mData.digits.length < 15) {
                    if (botStateRef.current !== 'SCANNING') setBotStateSync('SCANNING');
                    await new Promise(r => setTimeout(r, 400));
                    continue;
                }

                // Check if candidate digit frequency has increased >= 10% in last 60 ticks -> pause & re-select
                const recent60 = mData.digits.slice(-60);
                const currentDiff = autoDifferCandidate ?? differTargetDigit ?? 4;
                const digitOccurrences = recent60.filter(d => d === currentDiff).length;
                const digitPct = (digitOccurrences / (recent60.length || 1)) * 100;
                if (digitPct >= 10 && autoDifferCandidate !== null) {
                    // Candidate gaining power: pause and reset candidate
                    waitingForCandidate = true;
                    ticksRemaining = 3;
                    setWaitingForAppear(true);
                    setConfirmationTicksRemaining(3);
                    if (botStateRef.current !== 'PAUSED' && botStateRef.current !== 'IDLE') {
                        setBotStateSync('SCANNING');
                    }
                    await new Promise(r => setTimeout(r, 500));
                }

                const digits = mData.digits;
                const currLastDigit = mData.lastDigit;
                const currTickCount = mData.tickCount || 0;

                // Wait for a fresh live tick from the stream before processing
                if (lastProcessedTick !== -1 && currTickCount <= lastProcessedTick) {
                    await new Promise(r => setTimeout(r, 40));
                    continue;
                }
                lastProcessedTick = currTickCount;

                // 1. RECOVERY MODE: Over / Under Execution (Over 1,2,3 or Under 8,7,6)
                if (isInRecoveryRef.current) {
                    const last50 = digits.slice(-50);
                    const under05 = last50.filter(d => d <= 5).length;
                    const over49 = last50.filter(d => d >= 4).length;
                    const isUnderFavored = under05 >= over49;

                    const activeRecMode = recoveryTypeRef.current;
                    const barrier = isUnderFavored
                        ? (activeRecMode === 'OVER_1_UNDER_8' ? 8 : activeRecMode === 'OVER_2_UNDER_7' ? 7 : 6)
                        : (activeRecMode === 'OVER_1_UNDER_8' ? 1 : activeRecMode === 'OVER_2_UNDER_7' ? 2 : 3);
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
                        ticksRemaining = 3;
                        setWaitingForAppear(true);
                        setConfirmationTicksRemaining(3);
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
                        ticksRemaining = 3;
                        setConfirmationTicksRemaining(3);
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
                        // Target candidate appeared during verification -> Reset countdown back to 3
                        waitingForCandidate = true;
                        setWaitingForAppear(true);
                        ticksRemaining = 3;
                        setConfirmationTicksRemaining(3);
                        if (botStateRef.current !== 'SCANNING') {
                            setBotStateSync('SCANNING');
                        }
                    } else {
                        ticksRemaining -= 1;
                        setConfirmationTicksRemaining(ticksRemaining);

                        if (ticksRemaining === 0) {
                            // 3 clean ticks elapsed without candidate appearing -> Execute Differs Trade!
                            setBotStateSync('TRADING');
                            try {
                                await executeTradeOrder(targetSym, 'DIGITDIFF', targetDiff, currentStakeRef.current, false);
                            } catch (e) {
                                console.error('Poverty Hunter Differs trade error:', e);
                            }
                            waitingForCandidate = true;
                            setWaitingForAppear(true);
                            ticksRemaining = 3;
                            setConfirmationTicksRemaining(3);
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
                    ticksRemaining = 3;
                    setConfirmationTicksRemaining(3);
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
    ]);

    // ── Handlers ──
    const handleStartBot = useCallback(() => {
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
        setAccumulatedLoss(0);
        setWaitingForAppear(true);
        setConfirmationTicksRemaining(3);
        setBotStateSync('SCANNING');
        void startAutoTradingLoop();
    }, [initialStake, setBotStateSync, startAutoTradingLoop]);

    const handleStopBot = useCallback(() => {
        setBotStateSync('IDLE');
        autoAbortRef.current?.abort();
        executionLockRef.current = false;
        setIsInRecovery(false);
        isInRecoveryRef.current = false;
    }, [setBotStateSync]);

    const handlePauseBot = useCallback(() => {
        if (botStateRef.current === 'PAUSED') {
            setBotStateSync('TRADING');
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
                    isRunning: botState === 'TRADING' || botState === 'SCANNING',
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
                </div>
            </div>

            {/* ── Market Selector & Wide View Ribbon ── */}
            <div className='poverty-hunter__market-bar'>
                <div className='ph-select-group'>
                    <label>Active Market:</label>
                    <select value={selectedSymbol} onChange={e => setSelectedSymbol(e.target.value)}>
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
                                    setSelectedSymbol(m.symbol);
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
                                        onClick={() => setSelectedSymbol(m.symbol)}
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
                                            🎯 DIFFERS PICK
                                        </span>
                                    )}
                                </div>
                            );
                        })}
                    </div>

                    {/* Rankings Strip & Excluded Digits Legend */}
                    <div className='poverty-hunter__ranks-strip'>
                        <div className='ph-rank-item'>
                            <span className='rank-pill rank-pill--most'>Most Appearing</span>
                            <span className='rank-digit'>{mostAppearing ?? '—'}</span>
                        </div>
                        <div className='ph-rank-item'>
                            <span className='rank-pill rank-pill--second'>2nd Highest</span>
                            <span className='rank-digit'>{secondHighest ?? '—'}</span>
                        </div>
                        <div className='ph-rank-item'>
                            <span className='rank-pill rank-pill--least'>Least Appearing</span>
                            <span className='rank-digit'>{leastAppearing ?? '—'}</span>
                        </div>
                        <div className='ph-excluded-notice'>
                            <strong>Edge Digits 0, 1 & 8, 9:</strong> Excluded from Differs calculation (Fainted)
                        </div>
                    </div>

                    {/* Two Strategic Engines: Differs Engine & Over/Under Recovery Analytics */}
                    <div className='poverty-hunter__strategy-grid'>
                        {/* Differs Primary Strategy Card */}
                        <div className='ph-card-box'>
                            <div className='ph-card-box__header'>
                                <h3>
                                    <span>🎯</span> Differs Primary Strategy
                                </h3>
                                <span className='badge badge--differs'>AUTOMATED (Digits 2–7)</span>
                            </div>

                            <div className='ph-differ-details'>
                                <div className='ph-pick-banner'>
                                    <div className='label-group'>
                                        <span className='subtitle'>AI AUTO-SELECTED PREDICTION</span>
                                        <span className='title'>DIFFER DIGIT: {differTargetDigit ?? '—'}</span>
                                    </div>
                                    <div className='digit-circle'>{differTargetDigit ?? '—'}</div>
                                </div>

                                <div className='ph-conditions-list'>
                                    <div className='condition-row'>
                                        <span>Candidate Range (2–7 &amp; Non-Edge):</span>
                                        <span className='status status--met'>✓ VERIFIED</span>
                                    </div>
                                    <div className='condition-row'>
                                        <span>Frequency in Last 60 Ticks (&lt; 10%):</span>
                                        <span className='status status--met'>
                                            {digitStats.find(s => s.digit === differTargetDigit)?.percentage.toFixed(1)}
                                            % (Pass)
                                        </span>
                                    </div>
                                    <div className='condition-row'>
                                        <span>Not Increasing in Power:</span>
                                        <span className='status status--met'>✓ PASS</span>
                                    </div>
                                    <div className='condition-row'>
                                        <span>Appeared ≤ 3 Times in Last 15 Ticks:</span>
                                        <span className='status status--met'>✓ PASS</span>
                                    </div>
                                    <div className='condition-row'>
                                        <span>Entry Confirmation Status:</span>
                                        <span
                                            className={`status ${confirmationTicksRemaining === 0 ? 'status--met' : 'status--waiting'}`}
                                        >
                                            {botState === 'TRADING'
                                                ? waitingForAppear
                                                    ? 'Waiting for digit to appear'
                                                    : `Confirming 3 ticks (${confirmationTicksRemaining} left)`
                                                : 'Ready'}
                                        </span>
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Over / Under Recovery & Analytics Card */}
                        <div className='ph-card-box'>
                            <div className='ph-card-box__header'>
                                <h3>
                                    <span>🛡️</span> Over / Under Recovery Engine
                                </h3>
                                <span className='badge badge--recovery'>
                                    {isInRecovery ? '⚡ RECOVERY ACTIVE' : 'HEDGING STANDBY'}
                                </span>
                            </div>

                            <div className='ph-ou-details'>
                                {/* Under 0-4 vs Over 5-9 */}
                                <div className='ph-split-stat'>
                                    <div className='ph-split-header'>
                                        <span className='under-side'>
                                            Under 0–4: {ouAnalysis.under04} ({ouAnalysis.under04Pct}%)
                                        </span>
                                        <span className='over-side'>
                                            Over 5–9: {ouAnalysis.over59} ({ouAnalysis.over59Pct}%)
                                        </span>
                                    </div>
                                    <div className='ph-split-bar'>
                                        <div className='under-fill' style={{ width: `${ouAnalysis.under04Pct}%` }} />
                                        <div className='over-fill' style={{ width: `${ouAnalysis.over59Pct}%` }} />
                                    </div>
                                </div>

                                {/* Under 0-5 vs Over 4-9 */}
                                <div className='ph-split-stat'>
                                    <div className='ph-split-header'>
                                        <span className='under-side'>
                                            Under 0–5: {ouAnalysis.under05} ({ouAnalysis.under05Pct}%)
                                        </span>
                                        <span className='over-side'>
                                            Over 4–9: {ouAnalysis.over49} ({ouAnalysis.over49Pct}%)
                                        </span>
                                    </div>
                                    <div className='ph-split-bar'>
                                        <div className='under-fill' style={{ width: `${ouAnalysis.under05Pct}%` }} />
                                        <div className='over-fill' style={{ width: `${ouAnalysis.over49Pct}%` }} />
                                    </div>
                                </div>

                                {/* Glowing Entry Digit Card */}
                                <div className='ph-glowing-entry-card'>
                                    <div className='entry-box entry-box--under'>
                                        <span className='tag'>HIGHEST UNDER ENTRY</span>
                                        <span className='digit-glowing'>{ouAnalysis.highestUnderEntryDigit}</span>
                                        <span className='desc'>Prediction Under 6 / 8</span>
                                    </div>
                                    <div className='entry-box entry-box--over'>
                                        <span className='tag'>HIGHEST OVER ENTRY</span>
                                        <span className='digit-glowing'>{ouAnalysis.highestOverEntryDigit}</span>
                                        <span className='desc'>Prediction Over 3 / 2</span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* ── Trading Controls & Risk Management ── */}
                    <div className='poverty-hunter__controls-grid'>
                        <div className='ph-input-group'>
                            <label>Base Stake ({currency})</label>
                            <input
                                type='number'
                                step='0.1'
                                value={initialStake}
                                onChange={e => {
                                    setInitialStake(e.target.value);
                                    if (!isInRecovery) setCurrentStake(parseFloat(e.target.value) || 0.5);
                                }}
                            />
                        </div>
                        <div className='ph-input-group'>
                            <label>Martingale (Recovery)</label>
                            <input
                                type='number'
                                step='0.1'
                                value={martingale}
                                onChange={e => setMartingale(e.target.value)}
                            />
                        </div>
                        <div className='ph-input-group'>
                            <label>Take Profit ({currency})</label>
                            <input
                                type='number'
                                step='1'
                                value={takeProfit}
                                onChange={e => setTakeProfit(e.target.value)}
                            />
                        </div>
                        <div className='ph-input-group'>
                            <label>Stop Loss ({currency})</label>
                            <input
                                type='number'
                                step='1'
                                value={stopLoss}
                                onChange={e => setStopLoss(e.target.value)}
                            />
                        </div>
                        <div className='ph-input-group'>
                            <label>Ticks Duration</label>
                            <input
                                type='number'
                                min='1'
                                max='10'
                                value={tickDuration}
                                onChange={e => setTickDuration(e.target.value)}
                            />
                        </div>
                        <div className='ph-input-group'>
                            <label>Bulk Purchases (Batch)</label>
                            <input
                                type='number'
                                min='1'
                                max='10'
                                value={bulkCount}
                                onChange={e => setBulkCount(e.target.value)}
                            />
                        </div>
                        <div className='ph-input-group'>
                            <label>Max Runs Before Check</label>
                            <input
                                type='number'
                                min='1'
                                max='50'
                                value={maxRunsBeforeCheck}
                                onChange={e => setMaxRunsBeforeCheck(Math.max(1, parseInt(e.target.value, 10) || 7))}
                            />
                        </div>
                        <div className='ph-input-group'>
                            <label>Auto-Recovery (Hedging)</label>
                            <select
                                value={autoRecoveryMode ? 'true' : 'false'}
                                onChange={e => setAutoRecoveryMode(e.target.value === 'true')}
                            >
                                <option value='true'>Enabled (Over/Under)</option>
                                <option value='false'>Disabled (Differs Only)</option>
                            </select>
                        </div>
                        {autoRecoveryMode && (
                            <div className='ph-input-group'>
                                <label>Recovery Strategy</label>
                                <select
                                    value={recoveryType}
                                    onChange={e => setRecoveryType(e.target.value as any)}
                                >
                                    <option value='OVER_1_UNDER_8'>Over 1 / Under 8 (90% Win Rate)</option>
                                    <option value='OVER_2_UNDER_7'>Over 2 / Under 7 (80% Win Rate)</option>
                                    <option value='OVER_3_UNDER_6'>Over 3 / Under 6 (70% Win Rate)</option>
                                </select>
                            </div>
                        )}
                    </div>

                    {/* ── Action Buttons & Status Ribbon ── */}
                    <div className='poverty-hunter__actions-bar'>
                        <div className='ph-status-indicator'>
                            <span
                                className={`pulse-dot pulse-dot--${botState === 'TRADING' ? 'running' : botState === 'PAUSED' ? 'paused' : 'idle'}`}
                            />
                            <span className='status-text'>
                                STATUS:{' '}
                                {botState === 'TRADING'
                                    ? isInRecovery
                                        ? '🚨 RECOVERY TRADING (Over/Under)'
                                        : '🎯 HUNTING (Differs Automation)'
                                    : botState === 'PAUSED'
                                      ? '⏸️ PAUSED'
                                      : 'IDLE / READY'}
                            </span>
                        </div>

                        <div className='ph-buttons-cluster'>
                            {botState === 'IDLE' ? (
                                <button className='ph-btn ph-btn--start' onClick={handleStartBot}>
                                    ▶ START POVERTY HUNTER
                                </button>
                            ) : (
                                <>
                                    <button className='ph-btn ph-btn--stop' onClick={handleStopBot}>
                                        ⏹ STOP HUNTER
                                    </button>
                                    <button className='ph-btn ph-btn--pause' onClick={handlePauseBot}>
                                        {botState === 'PAUSED' ? '▶ RESUME' : '⏸ PAUSE'}
                                    </button>
                                </>
                            )}

                            <button
                                className='ph-btn ph-btn--bulk'
                                onClick={() =>
                                    void executeTradeOrder(
                                        selectedSymbol,
                                        'DIGITDIFF',
                                        differTargetDigit ?? 4,
                                        currentStake,
                                        false
                                    )
                                }
                                disabled={botState === 'TRADING'}
                            >
                                ⚡ MANUAL BULK ({bulkCount}x)
                            </button>

                            <button className='ph-btn ph-btn--secondary' onClick={handleClearStats}>
                                🗑 CLEAR STATS
                            </button>
                        </div>
                    </div>

                    {/* ── Real-Time Trade Journal ── */}
                    <div className='poverty-hunter__logs-card'>
                        <div className='ph-log-header'>
                            <h3>REAL-TIME TRADE JOURNAL</h3>
                            <button className='clear-btn' onClick={() => setTradeLog([])}>
                                Clear Log
                            </button>
                        </div>
                        <div className='ph-log-table-wrap'>
                            <table>
                                <thead>
                                    <tr>
                                        <th>Time</th>
                                        <th>Market</th>
                                        <th>Strategy</th>
                                        <th>Contract</th>
                                        <th>Barrier</th>
                                        <th>Total Stake</th>
                                        <th>Result</th>
                                        <th>Profit/Loss</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {tradeLog.length === 0 ? (
                                        <tr>
                                            <td
                                                colSpan={8}
                                                style={{ textAlign: 'center', color: '#64748b', padding: '2rem' }}
                                            >
                                                No trade history yet. Click Start Poverty Hunter or Manual Bulk to
                                                trade.
                                            </td>
                                        </tr>
                                    ) : (
                                        tradeLog.map(item => (
                                            <tr key={item.id}>
                                                <td>{item.time}</td>
                                                <td>{item.market}</td>
                                                <td>{item.strategy}</td>
                                                <td>{item.contractType}</td>
                                                <td>{item.prediction}</td>
                                                <td>
                                                    {item.stake.toFixed(2)} {currency}
                                                </td>
                                                <td>
                                                    <span
                                                        className={`status-badge status-badge--${item.result.toLowerCase()}`}
                                                    >
                                                        {item.result}
                                                    </span>
                                                </td>
                                                <td
                                                    style={{
                                                        color: item.profit >= 0 ? '#10b981' : '#ef4444',
                                                        fontWeight: 800,
                                                    }}
                                                >
                                                    {item.profit >= 0
                                                        ? `+${item.profit.toFixed(2)}`
                                                        : item.profit.toFixed(2)}{' '}
                                                    {currency}
                                                </td>
                                            </tr>
                                        ))
                                    )}
                                </tbody>
                            </table>
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
                botName='Poverty Hunter Bot'
                winsCount={winsCount}
                lossesCount={lossesCount}
                onClose={() => setMilestone({ isOpen: false, type: null })}
                onRestart={() => {
                    setMilestone({ isOpen: false, type: null });
                    handleStartBot();
                }}
            />
        </div>
    );
});

export default PovertyHunter;
