import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { generateOAuthURL, TradingMilestoneModal } from '@/components/shared';
import { api_base, observer as globalObserver } from '@/external/bot-skeleton';
import { useStore } from '@/hooks/useStore';
import { SUPPORTED_VOLATILITY_MARKETS } from '@/utils/digit-strategy';
import { isLoggedIn } from '@/utils/token-bridge';
import { buyContractForUi, streamContractUntilSettled } from '@/utils/trade-purchase';
import { subscribeTicks, derivTickManager } from '@/utils/websocket-handler';
import { aiContinuousLearningService } from '@/services/ai-continuous-learning.service';

// B254 Types & Engine
import {
    B254AutoState,
    B254MarketData,
    B254SignalResult,
    B254TransactionRecord,
    CompoundingConfig,
    SessionState,
    TargetStrategyChoice,
    TradeConditionSnapshot,
} from './types/b254.types';
import {
    calculateCompoundingPlan,
    computeDigitPower,
    computeMultiHorizon,
    evaluateB254Signal,
    evaluateRegime,
} from './services/b254-engine';

// B254 Subcomponents
import { CompoundingDashboard } from './components/compounding-dashboard';
import { LiveDigitChart } from './components/live-digit-chart';
import { StatisticalCards } from './components/statistical-cards';
import { SignalScoringHud } from './components/signal-scoring-hud';
import { MarketUnderstandingCard } from './components/market-understanding-card';
import { TradingControlPanel } from './components/trading-control-panel';
import { MarketScannerSidebar, ScannerMarketItem } from './components/market-scanner-sidebar';
import { TransactionDrawer } from './components/transaction-drawer';
import { CompoundingScheduleModal } from './components/compounding-schedule-modal';
import { CompoundingSettingsModal } from './components/compounding-settings-modal';

import './b254.scss';
import { ChevronRight, History, Radio, Sparkles } from 'lucide-react';

// ─── Constants ─────────────────────────────────────────────────────────────────

const MAX_TICKS_STORED = 1000;

const MARKETS = SUPPORTED_VOLATILITY_MARKETS.map(m => ({
    symbol: m.symbol,
    label: m.label.replace('Volatility ', 'Vol ').replace(' Index', ''),
    pip: m.pip || 2,
}));

const DEFAULT_COMPOUNDING_CONFIG: CompoundingConfig = {
    challengeName: 'B254 30-Day Master Compounding',
    startBalance: 20,
    targetBalance: 8080,
    durationValue: 30,
    timeUnit: 'DAYS',
    days: 30,
    stakeType: 'PERCENTAGE',
    baseStake: 0.50,
    stakePercentage: 2.0,
    enableMartingale: true,
    martingaleMultiplier: 2.6,
    maxStake: 100,
    dailyTakeProfit: 50,
    dailyStopLoss: 30,
    sessionTakeProfit: 25,
    sessionStopLoss: 15,
    maxConsecutiveLosses: 4,
    maxTradesPerSession: 50,
    signalScoreThreshold: 75,
    reanalysisIntervalMinutes: 10,
    sessionDurationMinutes: 60,
    sessionStartTime: '00:00',
};

const extractLastDigit = (quote: number | string | undefined | null, pip = 2): number => {
    if (quote === undefined || quote === null) return 0;
    const p = Number(quote);
    if (isNaN(p)) return 0;
    const fixed = p.toFixed(pip);
    const lastChar = fixed[fixed.length - 1];
    const digit = parseInt(lastChar, 10);
    return isNaN(digit) ? 0 : digit;
};

// ─── Master B254 Component ─────────────────────────────────────────────────────

export const B254Page: React.FC = observer(() => {
    const store = useStore();
    const { client } = store;
    const currency = client?.currency || 'USD';

    // ── Local Storage Config Persistence ──
    const [config, setConfig] = useState<CompoundingConfig>(() => {
        try {
            const saved = localStorage.getItem('b254_compounding_config');
            return saved ? { ...DEFAULT_COMPOUNDING_CONFIG, ...JSON.parse(saved) } : DEFAULT_COMPOUNDING_CONFIG;
        } catch {
            return DEFAULT_COMPOUNDING_CONFIG;
        }
    });

    const updateConfig = useCallback((partial: Partial<CompoundingConfig>) => {
        setConfig(prev => {
            const next = { ...prev, ...partial };
            try {
                localStorage.setItem('b254_compounding_config', JSON.stringify(next));
            } catch {}
            return next;
        });
    }, []);

    // ── Actual Balance & Compounding Plan ──
    const actualBalance = useMemo(() => {
        const clientBal = client?.balance;
        if (typeof clientBal === 'number') return clientBal;
        if (typeof clientBal === 'string') {
            const p = parseFloat(clientBal);
            if (!isNaN(p)) return p;
        }
        return config.startBalance;
    }, [client?.balance, config.startBalance]);

    const compoundingProgress = useMemo(() => {
        return calculateCompoundingPlan(
            config.startBalance,
            config.targetBalance,
            config.durationValue || config.days || 30,
            config.timeUnit || 'DAYS',
            actualBalance
        );
    }, [config.startBalance, config.targetBalance, config.durationValue, config.days, config.timeUnit, actualBalance]);

    // ── Market Data Streams ──
    const [selectedSymbol, setSelectedSymbol] = useState<string>('R_100');
    const [scanAllMarkets, setScanAllMarkets] = useState<boolean>(true);
    const [autoInputBestMarket, setAutoInputBestMarket] = useState<boolean>(false);
    const [sidebarExpanded, setSidebarExpanded] = useState<boolean>(false);
    const [targetStrategy, setTargetStrategy] = useState<TargetStrategyChoice>('AUTO');

    // UI Force Refresh Key for high-frequency render updates
    const [, setRenderTrigger] = useState<number>(0);
    const throttleRender = useRef<() => void>(() => {});
    useEffect(() => {
        let timer: any = null;
        throttleRender.current = () => {
            if (!timer) {
                timer = setTimeout(() => {
                    timer = null;
                    setRenderTrigger(t => (t + 1) % 10000);
                }, 150);
            }
        };
    }, []);

    // Map storing market tick buffers
    const marketsDataRef = useRef<Map<string, B254MarketData>>(new Map());
    const subscriptionsRef = useRef<Map<string, { unsubscribe?: () => void }>>(new Map());
    const isMountedRef = useRef<boolean>(true);

    // Initialize market buffers
    if (marketsDataRef.current.size === 0) {
        MARKETS.forEach(m => {
            marketsDataRef.current.set(m.symbol, {
                symbol: m.symbol,
                label: m.label,
                pip: m.pip,
                digits: [],
                currentPrice: '0.00',
                lastDigit: 0,
                tickCount: 0,
                lastTickTime: 0,
            });
        });
    }

    // ── Automated Trading & Session State ──
    const [autoState, setAutoState] = useState<B254AutoState>('IDLE');
    const [martingaleLevel, setMartingaleLevel] = useState<number>(0);
    const [consecutiveLosses, setConsecutiveLosses] = useState<number>(0);
    const [sessionProfit, setSessionProfit] = useState<number>(0);
    const [dailyProfit, setDailyProfit] = useState<number>(0);

    const [sessionState, setSessionState] = useState<SessionState>({
        isActive: false,
        startTime: null,
        endTime: null,
        sessionDurationSeconds: config.sessionDurationMinutes * 60,
        timeRemainingSeconds: config.sessionDurationMinutes * 60,
        nextReanalysisCountdownSeconds: config.reanalysisIntervalMinutes * 60,
        nextCheckpointFormatted: '10:00',
        tradesThisSession: 0,
        sessionProfit: 0,
        dailyProfit: 0,
        isSessionLocked: false,
    });

    // ── Transactions Ledger ──
    const [transactions, setTransactions] = useState<B254TransactionRecord[]>(() => {
        try {
            const saved = localStorage.getItem('b254_transactions');
            return saved ? JSON.parse(saved) : [];
        } catch {
            return [];
        }
    });

    const addTransaction = useCallback((tx: B254TransactionRecord) => {
        setTransactions(prev => {
            const next = [tx, ...prev].slice(0, 200);
            try {
                localStorage.setItem('b254_transactions', JSON.stringify(next));
            } catch {}
            return next;
        });
    }, []);

    // ── Modals & Drawers ──
    const [isScheduleModalOpen, setIsScheduleModalOpen] = useState<boolean>(false);
    const [isSettingsModalOpen, setIsSettingsModalOpen] = useState<boolean>(false);
    const [isDrawerOpen, setIsDrawerOpen] = useState<boolean>(false);
    const [milestoneModal, setMilestoneModal] = useState<{
        isOpen: boolean;
        type: 'tp' | 'sl';
        amount: number;
    }>({
        isOpen: false,
        type: 'tp',
        amount: 0,
    });

    // Trading in-progress execution lock
    const isExecutingTradeRef = useRef<boolean>(false);
    const autoStateRef = useRef<B254AutoState>(autoState);
    autoStateRef.current = autoState;

    const selectedSymbolRef = useRef<string>(selectedSymbol);
    selectedSymbolRef.current = selectedSymbol;

    // ─── WebSocket Tick Subscription Management ────────────────────────────────

    useEffect(() => {
        isMountedRef.current = true;

        const handleRefresh = () => {
            subscriptionsRef.current.forEach(sub => {
                try {
                    sub?.unsubscribe?.();
                } catch {}
            });
            subscriptionsRef.current.clear();
            derivTickManager.healStalledStreams();
            throttleRender.current();
        };

        const handleVisibility = () => {
            if (!document.hidden) {
                derivTickManager.healStalledStreams();
                throttleRender.current();
            }
        };

        window.addEventListener('account_switched', handleRefresh);
        window.addEventListener('online', handleRefresh);
        document.addEventListener('visibilitychange', handleVisibility);
        globalObserver.register('api.authorize', handleRefresh);

        // 3-second watchdog timer to heal stalled streams
        const watchdog = setInterval(() => {
            if (!isMountedRef.current || document.hidden) return;
            const current = marketsDataRef.current.get(selectedSymbolRef.current);
            const now = Date.now();
            if (current && current.lastTickTime && now - current.lastTickTime > 4000) {
                derivTickManager.healStalledStreams();
            }
        }, 3000);

        return () => {
            isMountedRef.current = false;
            window.removeEventListener('account_switched', handleRefresh);
            window.removeEventListener('online', handleRefresh);
            document.removeEventListener('visibilitychange', handleVisibility);
            globalObserver.unregister('api.authorize', handleRefresh);
            clearInterval(watchdog);
        };
    }, []);

    // Subscribe to Active Market and Scanned Volatility Markets
    useEffect(() => {
        const activeSubs = subscriptionsRef.current;
        const symbolsToStream = scanAllMarkets ? MARKETS.map(m => m.symbol) : [selectedSymbol];

        const subscribeSymbol = async (sym: string) => {
            if (!api_base.api || !isMountedRef.current) return;
            if (activeSubs.has(sym)) return;
            const pip = MARKETS.find(m => m.symbol === sym)?.pip || 2;

            try {
                const mData = marketsDataRef.current.get(sym);
                // Fetch initial tick history if missing
                if (!mData || mData.digits.length < 50) {
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
                        throttleRender.current();
                    }
                }

                if (activeSubs.has(sym)) return;

                // Subscribe via centralized WebSocket multiplexer
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
                            throttleRender.current();

                            // Trigger Trade Check if this tick belongs to currently selected market
                            if (sym === selectedSymbolRef.current) {
                                handleLiveMarketTick(item);
                            }
                        }
                    }
                });

                activeSubs.set(sym, sub);
            } catch (err) {
                console.warn(`[B254] Subscription notice for ${sym}:`, err);
            }
        };

        symbolsToStream.forEach(sym => {
            subscribeSymbol(sym);
        });

        // Unsubscribe from unneeded markets if scanAllMarkets was toggled off
        if (!scanAllMarkets) {
            activeSubs.forEach((sub, sym) => {
                if (sym !== selectedSymbol) {
                    try {
                        sub?.unsubscribe?.();
                    } catch {}
                    activeSubs.delete(sym);
                }
            });
        }
    }, [selectedSymbol, scanAllMarkets]);

    // ─── Market Data Slices for Currently Selected Market ───────────────────────

    const currentMarketData: B254MarketData = useMemo(() => {
        return (
            marketsDataRef.current.get(selectedSymbol) || {
                symbol: selectedSymbol,
                label: MARKETS.find(m => m.symbol === selectedSymbol)?.label || selectedSymbol,
                pip: MARKETS.find(m => m.symbol === selectedSymbol)?.pip || 2,
                digits: [],
                currentPrice: '0.00',
                lastDigit: 0,
                tickCount: 0,
                lastTickTime: 0,
            }
        );
    }, [selectedSymbol, marketsDataRef.current.get(selectedSymbol)?.tickCount]);

    const multiHorizon = useMemo(() => {
        return computeMultiHorizon(currentMarketData.digits);
    }, [currentMarketData.digits]);

    const digitPower = useMemo(() => {
        return computeDigitPower(currentMarketData.digits);
    }, [currentMarketData.digits]);

    const regime = useMemo(() => {
        return evaluateRegime(currentMarketData.digits);
    }, [currentMarketData.digits]);

    const currentSignal: B254SignalResult | null = useMemo(() => {
        return evaluateB254Signal(
            currentMarketData.digits,
            targetStrategy,
            config.signalScoreThreshold
        );
    }, [currentMarketData.digits, targetStrategy, config.signalScoreThreshold]);

    // ─── Multi-Market Scanner Evaluations ──────────────────────────────────────

    const scannerMarkets: ScannerMarketItem[] = useMemo(() => {
        const list: ScannerMarketItem[] = [];

        MARKETS.forEach(m => {
            const data = marketsDataRef.current.get(m.symbol);
            const digits = data?.digits || [];
            if (digits.length < 15) {
                list.push({
                    symbol: m.symbol,
                    label: m.label,
                    price: data?.currentPrice || '0.00',
                    lastDigit: data?.lastDigit ?? 0,
                    under04Pct: 50,
                    over59Pct: 50,
                    under05Pct: 50,
                    over49Pct: 50,
                    last7Ratio: '- / -',
                    last10Ratio: '- / -',
                    bias50t: 'BALANCED',
                    bias1000t: 'BALANCED',
                    history30mBias: 'NEUTRAL',
                    history1hBias: 'NEUTRAL',
                    regime: 'NEUTRAL',
                    signalScore: 0,
                    isBestMarket: false,
                    isEntryReady: false,
                    favoredDirection: 'UNDER_6',
                    entryDigit: 0,
                });
                return;
            }

            const mh = computeMultiHorizon(digits);
            const reg = evaluateRegime(digits);
            const sig = evaluateB254Signal(digits, 'AUTO', config.signalScoreThreshold);

            const u10 = digits.slice(-10).filter(d => d <= 5).length;
            const u7 = digits.slice(-7).filter(d => d <= 5).length;

            list.push({
                symbol: m.symbol,
                label: m.label,
                price: data?.currentPrice || '0.00',
                lastDigit: data?.lastDigit ?? 0,
                under04Pct: Number(mh.h50.pctUnder04.toFixed(1)),
                over59Pct: Number(mh.h50.pctOver59.toFixed(1)),
                under05Pct: Number(mh.h50.pctUnder05.toFixed(1)),
                over49Pct: Number(mh.h50.pctOver49.toFixed(1)),
                last7Ratio: `${u7}U / ${7 - u7}O`,
                last10Ratio: `${u10}U / ${10 - u10}O`,
                bias50t: mh.h50.bias === 'UNDER' ? 'UNDER' : mh.h50.bias === 'OVER' ? 'OVER' : 'BALANCED',
                bias1000t: mh.h1000.bias === 'UNDER' ? 'UNDER' : mh.h1000.bias === 'OVER' ? 'OVER' : 'BALANCED',
                history30mBias: mh.history30m.bias,
                history1hBias: mh.history1h.bias,
                regime: reg.currentRegime,
                signalScore: sig?.score.totalScore || 0,
                isBestMarket: false,
                isEntryReady: sig?.status === 'ENTRY_READY' || sig?.status === 'TRIGGERED',
                favoredDirection: sig?.direction || 'UNDER_6',
                entryDigit: sig?.entryDigit || 0,
            });
        });

        // Find highest score market
        let bestIndex = -1;
        let maxScore = -1;
        list.forEach((item, i) => {
            if (item.signalScore > maxScore && item.signalScore >= config.signalScoreThreshold) {
                maxScore = item.signalScore;
                bestIndex = i;
            }
        });

        if (bestIndex !== -1) {
            list[bestIndex].isBestMarket = true;
        }

        return list;
    }, [MARKETS, marketsDataRef.current, config.signalScoreThreshold]);

    const bestMarketItem = useMemo(() => {
        return scannerMarkets.find(m => m.isBestMarket) || null;
    }, [scannerMarkets]);

    // Auto-switch to best market if enabled and in Scanning state
    useEffect(() => {
        if (autoInputBestMarket && bestMarketItem && bestMarketItem.symbol !== selectedSymbol) {
            if (autoState === 'SCANNING' || autoState === 'WAITING_TRIGGER') {
                setSelectedSymbol(bestMarketItem.symbol);
            }
        }
    }, [autoInputBestMarket, bestMarketItem, selectedSymbol, autoState]);

    // ─── Session Timer & Reanalysis Checkpoint Countdown ───────────────────────

    useEffect(() => {
        if (autoState === 'IDLE' || autoState === 'PAUSED') return;

        const interval = setInterval(() => {
            setSessionState(prev => {
                const nextRemaining = Math.max(0, prev.timeRemainingSeconds - 1);
                const nextReanalysis = prev.nextReanalysisCountdownSeconds - 1;

                let updatedReanalysis = nextReanalysis;
                if (nextReanalysis <= 0) {
                    // Reanalysis Checkpoint Triggered
                    updatedReanalysis = config.reanalysisIntervalMinutes * 60;
                }

                const mins = Math.floor(updatedReanalysis / 60);
                const secs = updatedReanalysis % 60;
                const formattedCheckpoint = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;

                // Check session expiry
                if (nextRemaining === 0 && prev.isActive) {
                    setAutoState('IDLE');
                    setMilestoneModal({
                        isOpen: true,
                        type: 'tp',
                        amount: prev.sessionProfit,
                    });
                    return {
                        ...prev,
                        isActive: false,
                        timeRemainingSeconds: 0,
                        isSessionLocked: true,
                        lockReason: 'Session time completed.',
                    };
                }

                return {
                    ...prev,
                    timeRemainingSeconds: nextRemaining,
                    nextReanalysisCountdownSeconds: updatedReanalysis,
                    nextCheckpointFormatted: formattedCheckpoint,
                };
            });
        }, 1000);

        return () => clearInterval(interval);
    }, [autoState, config.sessionDurationMinutes, config.reanalysisIntervalMinutes]);

    // ─── Automated Trading Execution Handler ───────────────────────────────────

    const handleLiveMarketTick = async (marketData: B254MarketData) => {
        if (isExecutingTradeRef.current) return;
        const currentAutoState = autoStateRef.current;
        if (currentAutoState !== 'TRADING' && currentAutoState !== 'WAITING_TRIGGER') return;

        // Verify user login status
        if (!isLoggedIn()) {
            setAutoState('IDLE');
            const oauthUrl = await generateOAuthURL();
            window.location.assign(oauthUrl);
            return;
        }

        // Evaluate Signal
        const signal = evaluateB254Signal(
            marketData.digits,
            targetStrategy,
            config.signalScoreThreshold
        );

        if (!signal) return;

        // Auto-pause if regime shift or continuation broken
        if (signal.isAutoPaused) {
            setAutoState('PAUSED');
            return;
        }

        // Check if all 8 conditions passed, score threshold passed, and live tick matches dominant entry digit
        if (signal.status === 'TRIGGERED' && signal.checklist.allConditionsPassed) {
            // Check Daily / Session Risk Guardrails
            if (dailyProfit >= config.dailyTakeProfit) {
                setAutoState('IDLE');
                setMilestoneModal({
                    isOpen: true,
                    type: 'tp',
                    amount: dailyProfit,
                });
                return;
            }

            if (dailyProfit <= -config.dailyStopLoss) {
                setAutoState('IDLE');
                setMilestoneModal({
                    isOpen: true,
                    type: 'sl',
                    amount: Math.abs(dailyProfit),
                });
                return;
            }

            if (sessionProfit >= config.sessionTakeProfit) {
                setAutoState('IDLE');
                setMilestoneModal({
                    isOpen: true,
                    type: 'tp',
                    amount: sessionProfit,
                });
                return;
            }

            if (sessionProfit <= -config.sessionStopLoss) {
                setAutoState('IDLE');
                setMilestoneModal({
                    isOpen: true,
                    type: 'sl',
                    amount: Math.abs(sessionProfit),
                });
                return;
            }

            if (consecutiveLosses >= config.maxConsecutiveLosses) {
                setAutoState('IDLE');
                setMilestoneModal({
                    isOpen: true,
                    type: 'sl',
                    amount: Math.abs(sessionProfit),
                });
                return;
            }

            // Execute Trade
            await executeContractTrade(signal, marketData);
        }
    };

    const executeContractTrade = async (signal: B254SignalResult, marketData: B254MarketData) => {
        isExecutingTradeRef.current = true;
        setAutoState('TRADING');

        // Determine Stake (Fixed, Percentage of Capital, or Compounding Step target)
        let tradeStake = config.baseStake;
        if (config.stakeType === 'PERCENTAGE') {
            tradeStake = Number(((actualBalance * (config.stakePercentage || 2.0)) / 100).toFixed(2));
        } else if (config.stakeType === 'COMPOUNDING') {
            // Dynamic Compounding Stake based on current step progress
            const stepTarget = compoundingProgress.stepTargetBalance || compoundingProgress.dailyTargetBalance;
            tradeStake = Number(Math.max(config.baseStake, (stepTarget * 0.02)).toFixed(2));
        } else {
            tradeStake = config.baseStake;
        }

        // Apply Martingale if active
        if (config.enableMartingale && martingaleLevel > 0) {
            tradeStake = Number((tradeStake * Math.pow(config.martingaleMultiplier, martingaleLevel)).toFixed(2));
        }

        tradeStake = Math.min(config.maxStake, Math.max(0.35, tradeStake));

        const contractType = signal.direction === 'UNDER_6' ? 'DIGITUNDER' : 'DIGITOVER';
        const barrier = signal.direction === 'UNDER_6' ? '6' : '3';

        // Prepare Audit Snapshot
        const auditSnapshot: TradeConditionSnapshot = {
            direction: signal.direction,
            prediction: signal.prediction,
            entryDigit: signal.entryDigit,
            signalScore: signal.score.totalScore,
            under04Pct: multiHorizon.h50.pctUnder04,
            over59Pct: multiHorizon.h50.pctOver59,
            under05Count: multiHorizon.h50.under05,
            over49Count: multiHorizon.h50.over49,
            last10Ratio: `${multiHorizon.h15.under05}/10 Under`,
            last7Ratio: `${Math.min(7, Math.round((multiHorizon.h15.under05 / 15) * 7))}/7 Under`,
            outlierPct: signal.direction === 'UNDER_6'
                ? (digitPower.items[7]?.pct1000 || 0) + (digitPower.items[8]?.pct1000 || 0) + (digitPower.items[9]?.pct1000 || 0)
                : (digitPower.items[0]?.pct1000 || 0) + (digitPower.items[1]?.pct1000 || 0) + (digitPower.items[2]?.pct1000 || 0),
            history30mBias: multiHorizon.history30m.bias,
            history1hBias: multiHorizon.history1h.bias,
            regime: regime.currentRegime,
        };

        const txId = `B254-${Date.now().toString().slice(-6)}`;
        const now = new Date();
        const timeFormatted = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;

        const pendingRecord: B254TransactionRecord = {
            id: txId,
            timestamp: Date.now(),
            timeFormatted,
            market: marketData.label,
            symbol: marketData.symbol,
            direction: signal.direction,
            contractType,
            prediction: signal.prediction,
            entryDigit: signal.entryDigit,
            stake: tradeStake,
            martingaleLevel,
            signalScore: signal.score.totalScore,
            result: 'PENDING',
            profit: 0,
            balanceAfterTrade: actualBalance,
            auditSnapshot,
            durationTicks: 1,
            status: 'open',
        };

        addTransaction(pendingRecord);

        try {
            const buyResult = await buyContractForUi({
                parameters: {
                    amount: tradeStake,
                    basis: 'stake',
                    contract_type: contractType,
                    currency,
                    duration: 1,
                    duration_unit: 't',
                    symbol: marketData.symbol,
                    barrier,
                },
                price: tradeStake,
                source: 'B254',
            });

            if (buyResult?.contract_id) {
                const settled = await streamContractUntilSettled({
                    contractId: buyResult.contract_id,
                    source: 'B254',
                });
                const isWin = (settled?.profit ?? 0) > 0;
                const profitAmount = settled?.profit ?? (isWin ? tradeStake * 0.40 : -tradeStake);

                // Update ledger record
                const settledRecord: B254TransactionRecord = {
                    ...pendingRecord,
                    id: String(settled?.contract_id || txId),
                    result: isWin ? 'WIN' : 'LOSS',
                    profit: Number(profitAmount.toFixed(2)),
                    balanceAfterTrade: Number(((settled?.balance_after ?? actualBalance) + profitAmount).toFixed(2)),
                    status: 'settled',
                };

                setTransactions(prev => prev.map(t => (t.id === txId ? settledRecord : t)));

                // Update AI continuous learning engine
                try {
                    aiContinuousLearningService.recordBotTrade({
                        botName: 'AUTOFLIPPER',
                        strategy: signal.direction,
                        market: marketData.symbol,
                        contractType,
                        barrier,
                        prediction: signal.prediction,
                        isWin,
                        profit: profitAmount,
                        stake: tradeStake,
                    });
                } catch {}

                // Update Session & Risk Stats
                setSessionProfit(p => Number((p + profitAmount).toFixed(2)));
                setDailyProfit(p => Number((p + profitAmount).toFixed(2)));

                setSessionState(prev => ({
                    ...prev,
                    sessionProfit: Number((prev.sessionProfit + profitAmount).toFixed(2)),
                    dailyProfit: Number((prev.dailyProfit + profitAmount).toFixed(2)),
                    tradesThisSession: prev.tradesThisSession + 1,
                }));

                // Update Martingale & Loss streak
                if (isWin) {
                    setMartingaleLevel(0);
                    setConsecutiveLosses(0);
                } else {
                    setMartingaleLevel(l => l + 1);
                    setConsecutiveLosses(c => c + 1);
                }
            }
        } catch (err: any) {
            console.warn('[B254] Trade execution notice:', err);
            // Revert pending transaction
            setTransactions(prev => prev.filter(t => t.id !== txId));
        } finally {
            isExecutingTradeRef.current = false;
            if (autoStateRef.current === 'TRADING') {
                setAutoState('WAITING_TRIGGER');
            }
        }
    };

    // ─── Control Handlers ──────────────────────────────────────────────────────

    const handleStartAutoTrading = () => {
        setAutoState('WAITING_TRIGGER');
        setSessionState(prev => ({
            ...prev,
            isActive: true,
            startTime: Date.now(),
            endTime: Date.now() + config.sessionDurationMinutes * 60 * 1000,
            sessionDurationSeconds: config.sessionDurationMinutes * 60,
            timeRemainingSeconds: config.sessionDurationMinutes * 60,
            nextReanalysisCountdownSeconds: config.reanalysisIntervalMinutes * 60,
            isSessionLocked: false,
        }));
    };

    const handlePauseAutoTrading = () => {
        setAutoState('PAUSED');
    };

    const handleResumeAutoTrading = () => {
        setAutoState('WAITING_TRIGGER');
    };

    const handleStopAutoTrading = () => {
        setAutoState('IDLE');
        setSessionState(prev => ({
            ...prev,
            isActive: false,
        }));
    };

    const handleEmergencyStop = () => {
        setAutoState('IDLE');
        setSessionState(prev => ({
            ...prev,
            isActive: false,
            isSessionLocked: true,
            lockReason: 'Emergency stop activated by user.',
        }));
    };

    return (
        <div className='b254-suite'>
            {/* ── 1. Top Unified Compounding Ribbon & Metric Dashboard ── */}
            <CompoundingDashboard
                config={config}
                progress={compoundingProgress}
                session={sessionState}
                autoState={autoState}
                currency={currency}
                onOpenScheduleModal={() => setIsScheduleModalOpen(true)}
                onOpenSettingsModal={() => setIsSettingsModalOpen(true)}
            />

            {/* ── 2. Main Workspace Layout with Collapsible Market Scanner ── */}
            <div className={`b254-workspace-layout ${sidebarExpanded ? 'sidebar-open' : 'sidebar-closed'}`}>
                {/* Collapsible Left Scanner Tray */}
                <MarketScannerSidebar
                    isExpanded={sidebarExpanded}
                    onToggleExpand={() => setSidebarExpanded(v => !v)}
                    markets={scannerMarkets}
                    selectedSymbol={selectedSymbol}
                    onSelectMarket={sym => setSelectedSymbol(sym)}
                    scanAllMarkets={scanAllMarkets}
                    onToggleScanAll={setScanAllMarkets}
                    autoInputBestMarket={autoInputBestMarket}
                    onToggleAutoInputBest={setAutoInputBestMarket}
                    bestMarket={bestMarketItem}
                />

                {/* Center / Right Analysis & Execution Center */}
                <div className='b254-main-content'>
                    {/* Header Action Strip */}
                    <div className='b254-glass b254-market-strip'>
                        <div className='market-badge-group'>
                            <button
                                className='b254-btn-scanner-toggle'
                                onClick={() => setSidebarExpanded(v => !v)}
                                title='Toggle Market Scanner Tray'
                            >
                                <Radio size={16} className='pulse-icon' />
                                <span>Scanner ({scannerMarkets.length})</span>
                                <ChevronRight size={14} className={sidebarExpanded ? 'rotate-180' : ''} />
                            </button>

                            <select
                                className='b254-select-market'
                                value={selectedSymbol}
                                onChange={e => setSelectedSymbol(e.target.value)}
                            >
                                {MARKETS.map(m => (
                                    <option key={m.symbol} value={m.symbol}>
                                        {m.label} ({m.symbol})
                                    </option>
                                ))}
                            </select>

                            <div className='live-price-pill'>
                                <span className='price-val'>{currentMarketData.currentPrice}</span>
                                <div className='last-digit-orb' data-digit={currentMarketData.lastDigit}>
                                    {currentMarketData.lastDigit}
                                </div>
                            </div>
                        </div>

                        <div className='strategy-mode-group'>
                            <span className='group-label'>Strategy Bias:</span>
                            <div className='strategy-pill-selector'>
                                <button
                                    className={`pill-btn ${targetStrategy === 'AUTO' ? 'active auto' : ''}`}
                                    onClick={() => setTargetStrategy('AUTO')}
                                >
                                    <Sparkles size={13} />
                                    <span>AUTO (Strongest)</span>
                                </button>
                                <button
                                    className={`pill-btn ${targetStrategy === 'UNDER_6' ? 'active under' : ''}`}
                                    onClick={() => setTargetStrategy('UNDER_6')}
                                >
                                    <span>UNDER 6 (0–5)</span>
                                </button>
                                <button
                                    className={`pill-btn ${targetStrategy === 'OVER_3' ? 'active over' : ''}`}
                                    onClick={() => setTargetStrategy('OVER_3')}
                                >
                                    <span>OVER 3 (4–9)</span>
                                </button>
                            </div>
                        </div>

                        <button
                            className='b254-btn-glass b254-btn-ledger-trigger'
                            onClick={() => setIsDrawerOpen(true)}
                            title='Open Verified Transaction Audit Ledger'
                        >
                            <History size={16} />
                            <span>Ledger ({transactions.length})</span>
                        </button>
                    </div>

                    {/* Live SVG Bezier Spline Chart with Barrier Thresholds */}
                    <LiveDigitChart
                        digits={currentMarketData.digits}
                        currentPrice={currentMarketData.currentPrice}
                        lastDigit={currentMarketData.lastDigit}
                        symbolLabel={currentMarketData.label}
                    />

                    {/* Statistical Cards 1, 2, 3 (Digit Power 0-9), and 4 (Multi-Horizon Breakdown) */}
                    <StatisticalCards
                        multiHorizon={multiHorizon}
                        digitPower={digitPower}
                    />

                    {/* 100-Point Transparent Score HUD, 8-Point Checklist & Glowing Entry Digit Matcher */}
                    <SignalScoringHud
                        signal={currentSignal}
                        currentLastDigit={currentMarketData.lastDigit}
                    />

                    {/* Clear Market Understanding Card & "Why Not Trade?" Diagnostics */}
                    <MarketUnderstandingCard
                        explanation={currentSignal?.marketExplanation || 'Analyzing multi-timeframe tick streams...'}
                        whyNotTradeReasons={currentSignal?.whyNotTradeReasons || []}
                        regime={regime}
                        marketLabel={currentMarketData.label}
                    />

                    {/* Automated Trading Execution & Compounding Control Panel */}
                    <TradingControlPanel
                        config={config}
                        autoState={autoState}
                        targetStrategy={targetStrategy}
                        currency={currency}
                        liveBalance={actualBalance}
                        onUpdateConfig={updateConfig}
                        onUpdateStrategy={setTargetStrategy}
                        onStartAutoTrading={handleStartAutoTrading}
                        onPauseAutoTrading={handlePauseAutoTrading}
                        onResumeAutoTrading={handleResumeAutoTrading}
                        onStopAutoTrading={handleStopAutoTrading}
                        onEmergencyStop={handleEmergencyStop}
                    />
                </div>
            </div>

            {/* ── Slide-Out Verified Transaction Audit Ledger ── */}
            <TransactionDrawer
                isOpen={isDrawerOpen}
                onClose={() => setIsDrawerOpen(false)}
                transactions={transactions}
                currency={currency}
            />

            {/* ── 30-Day / 90-Day Compounding Schedule Table Modal ── */}
            <CompoundingScheduleModal
                isOpen={isScheduleModalOpen}
                onClose={() => setIsScheduleModalOpen(false)}
                config={config}
                progress={compoundingProgress}
                currency={currency}
            />

            {/* ── Compounding & Risk Settings Modal ── */}
            <CompoundingSettingsModal
                isOpen={isSettingsModalOpen}
                onClose={() => setIsSettingsModalOpen(false)}
                config={config}
                onSave={updateConfig}
                currency={currency}
                liveBalance={actualBalance}
            />

            {/* ── Milestone TP/SL Modal ── */}
            {milestoneModal.isOpen && (
                <TradingMilestoneModal
                    isOpen={milestoneModal.isOpen}
                    type={milestoneModal.type}
                    amount={milestoneModal.amount}
                    currency={currency}
                    botName='B254'
                    onClose={() => setMilestoneModal(prev => ({ ...prev, isOpen: false }))}
                />
            )}
        </div>
    );
});

export default B254Page;
