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
    B254ManualConfig,
    B254MarketData,
    B254SignalResult,
    B254TransactionRecord,
    TradeConditionSnapshot,
} from './types/b254.types';
import {
    computeDigitPower,
    computeMultiHorizon,
    evaluateB254Signal,
    evaluateRegime,
} from './services/b254-engine';

// B254 Subcomponents
import { B254TradingDashboard } from './components/b254-trading-dashboard';
import { LiveDigitChart } from './components/live-digit-chart';
import { StatisticalCards } from './components/statistical-cards';
import { SignalScoringHud } from './components/signal-scoring-hud';
import { MarketUnderstandingCard } from './components/market-understanding-card';
import { TradingControlPanel } from './components/trading-control-panel';
import { MarketScannerSidebar, ScannerMarketItem } from './components/market-scanner-sidebar';
import { TransactionDrawer } from './components/transaction-drawer';

import './b254.scss';
import { ChevronRight, History, Radio, Sparkles } from 'lucide-react';

// ─── Constants ─────────────────────────────────────────────────────────────────

const MAX_TICKS_STORED = 1000;
const MARKET_DWELL_LIMIT_MS = 10 * 60 * 1000; // 10 minutes dwell before scheduled rotation
const CONFIG_STORAGE_KEY = 'b254_manual_config';
const SESSION_STORAGE_KEY = 'b254_session_state';

const MARKETS = SUPPORTED_VOLATILITY_MARKETS.map(m => ({
    symbol: m.symbol,
    label: m.label.replace('Volatility ', 'Vol ').replace(' Index', ''),
    pip: m.pip || 2,
}));

const DEFAULT_MANUAL_CONFIG: B254ManualConfig = {
    stake: 0.50,
    takeProfit: 25.0,
    stopLoss: 20.0,
    enableMartingale: true,
    martingaleMultiplier: 2.6,
    maxConsecutiveLosses: 5,
    maxStake: 100.0,
    tickDuration: 1,
    targetStrategy: 'AUTO',
    autoSwitchMarkets: true,
    lossGuardEnabled: true,
    minQualityScore: 65,
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

// ─── Sound Cues ────────────────────────────────────────────────────────────────

const playSound = (type: 'win' | 'loss' | 'signal') => {
    try {
        const Ctx = window.AudioContext || (window as any).webkitAudioContext;
        if (!Ctx) return;
        const ctx = new Ctx();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        const now = ctx.currentTime;
        if (type === 'win') {
            osc.frequency.setValueAtTime(587, now);
            osc.frequency.exponentialRampToValueAtTime(880, now + 0.15);
            gain.gain.setValueAtTime(0.15, now);
            gain.gain.exponentialRampToValueAtTime(0.01, now + 0.35);
            osc.start(now);
            osc.stop(now + 0.35);
        } else if (type === 'loss') {
            osc.frequency.setValueAtTime(392, now);
            osc.frequency.exponentialRampToValueAtTime(220, now + 0.2);
            gain.gain.setValueAtTime(0.15, now);
            gain.gain.exponentialRampToValueAtTime(0.01, now + 0.3);
            osc.start(now);
            osc.stop(now + 0.3);
        } else {
            osc.frequency.setValueAtTime(659, now);
            gain.gain.setValueAtTime(0.1, now);
            gain.gain.exponentialRampToValueAtTime(0.01, now + 0.15);
            osc.start(now);
            osc.stop(now + 0.15);
        }
    } catch {
        /* audio context blocked or unavailable */
    }
};

// ─── Master B254 Component ─────────────────────────────────────────────────────

export const B254Page: React.FC = observer(() => {
    const store = useStore();
    const { client } = store;
    const currency = client?.currency || 'USD';

    // ── Manual Config State (LocalStorage persistence) ──
    const [config, setConfig] = useState<B254ManualConfig>(() => {
        try {
            const saved = localStorage.getItem(CONFIG_STORAGE_KEY);
            return saved ? { ...DEFAULT_MANUAL_CONFIG, ...JSON.parse(saved) } : DEFAULT_MANUAL_CONFIG;
        } catch {
            return DEFAULT_MANUAL_CONFIG;
        }
    });

    const updateConfig = useCallback((partial: Partial<B254ManualConfig>) => {
        setConfig(prev => {
            const next = { ...prev, ...partial };
            try {
                localStorage.setItem(CONFIG_STORAGE_KEY, JSON.stringify(next));
            } catch {}
            return next;
        });
    }, []);

    // ── Actual Balance ──
    const actualBalance = useMemo(() => {
        const clientBal = client?.balance;
        if (typeof clientBal === 'number') return clientBal;
        if (typeof clientBal === 'string') {
            const p = parseFloat(clientBal);
            if (!isNaN(p)) return p;
        }
        return 0;
    }, [client?.balance]);

    // ── Market Data Streams & Selection ──
    const [selectedSymbol, setSelectedSymbol] = useState<string>('R_100');
    const [scanAllMarkets, setScanAllMarkets] = useState<boolean>(true);
    const [sidebarExpanded, setSidebarExpanded] = useState<boolean>(false);

    // ── Session Trading Stats ──
    const [totalProfit, setTotalProfit] = useState<number>(() => {
        try {
            const saved = localStorage.getItem(SESSION_STORAGE_KEY);
            if (saved) return JSON.parse(saved).totalProfit || 0;
        } catch {}
        return 0;
    });
    const [wins, setWins] = useState<number>(() => {
        try {
            const saved = localStorage.getItem(SESSION_STORAGE_KEY);
            if (saved) return JSON.parse(saved).wins || 0;
        } catch {}
        return 0;
    });
    const [losses, setLosses] = useState<number>(() => {
        try {
            const saved = localStorage.getItem(SESSION_STORAGE_KEY);
            if (saved) return JSON.parse(saved).losses || 0;
        } catch {}
        return 0;
    });
    const [consecutiveLosses, setConsecutiveLosses] = useState<number>(0);
    const [martingaleLevel, setMartingaleLevel] = useState<number>(0);
    const [currentStake, setCurrentStake] = useState<number>(config.stake);

    // Sync stake when idle and config stake changes
    useEffect(() => {
        if (autoStateRef.current === 'IDLE' && martingaleLevel === 0) {
            setCurrentStake(config.stake);
            currentStakeRef.current = config.stake;
        }
    }, [config.stake, martingaleLevel]);

    // ── Engine Execution State ──
    const [autoState, setAutoState] = useState<B254AutoState>('IDLE');

    // ── 10-Minute Dwell Countdown Timer ──
    const marketStartTimeRef = useRef<number>(Date.now());
    const [dwellRemainingSec, setDwellRemainingSec] = useState<number>(600);

    const switchSelectedSymbol = useCallback((sym: string) => {
        setSelectedSymbol(sym);
        selectedSymbolRef.current = sym;
        marketStartTimeRef.current = Date.now();
        setDwellRemainingSec(600);
    }, []);

    useEffect(() => {
        if (autoState === 'IDLE') {
            setDwellRemainingSec(600);
            return;
        }
        const dwellInterval = setInterval(() => {
            const elapsed = Date.now() - marketStartTimeRef.current;
            const rem = Math.max(0, Math.ceil((MARKET_DWELL_LIMIT_MS - elapsed) / 1000));
            setDwellRemainingSec(rem);
        }, 1000);
        return () => clearInterval(dwellInterval);
    }, [autoState]);

    // ── UI Force Refresh Key for High-Frequency Render Updates ──
    const [, setRenderTrigger] = useState<number>(0);
    const throttleRender = useRef<() => void>(() => {});
    useEffect(() => {
        let timer: any = null;
        throttleRender.current = () => {
            if (!timer) {
                timer = setTimeout(() => {
                    timer = null;
                    setRenderTrigger(t => (t + 1) % 100000);
                }, 100);
            }
        };
    }, []);

    // ── Market Buffers & WebSockets ──
    const marketsDataRef = useRef<Map<string, B254MarketData>>(new Map());
    const subscriptionsRef = useRef<Map<string, { unsubscribe?: () => void }>>(new Map());
    const isMountedRef = useRef<boolean>(true);

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

    // ── Refs for Loop Access ──
    const autoStateRef = useRef<B254AutoState>(autoState);
    autoStateRef.current = autoState;

    const selectedSymbolRef = useRef<string>(selectedSymbol);
    selectedSymbolRef.current = selectedSymbol;

    const configRef = useRef<B254ManualConfig>(config);
    configRef.current = config;

    const totalProfitRef = useRef<number>(totalProfit);
    totalProfitRef.current = totalProfit;

    const winsRef = useRef<number>(wins);
    winsRef.current = wins;

    const lossesRef = useRef<number>(losses);
    lossesRef.current = losses;

    const consecutiveLossesRef = useRef<number>(consecutiveLosses);
    consecutiveLossesRef.current = consecutiveLosses;

    const martingaleLevelRef = useRef<number>(martingaleLevel);
    martingaleLevelRef.current = martingaleLevel;

    const currentStakeRef = useRef<number>(currentStake);
    currentStakeRef.current = currentStake;

    const autoAbortRef = useRef<AbortController | null>(null);

    // Save session state to localStorage periodically
    const saveSessionState = useCallback(() => {
        try {
            localStorage.setItem(
                SESSION_STORAGE_KEY,
                JSON.stringify({
                    totalProfit: totalProfitRef.current,
                    wins: winsRef.current,
                    losses: lossesRef.current,
                })
            );
        } catch {}
    }, []);

    // Reset session stats handler
    const handleResetStats = useCallback(() => {
        if (autoStateRef.current !== 'IDLE') return;
        setTotalProfit(0);
        totalProfitRef.current = 0;
        setWins(0);
        winsRef.current = 0;
        setLosses(0);
        lossesRef.current = 0;
        setConsecutiveLosses(0);
        consecutiveLossesRef.current = 0;
        setMartingaleLevel(0);
        martingaleLevelRef.current = 0;
        setCurrentStake(config.stake);
        currentStakeRef.current = config.stake;
        try {
            localStorage.removeItem(SESSION_STORAGE_KEY);
        } catch {}
    }, [config.stake]);

    // ─── WebSocket Tick Subscriptions ──────────────────────────────────────────

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

    useEffect(() => {
        const activeSubs = subscriptionsRef.current;
        const symbolsToStream = scanAllMarkets ? MARKETS.map(m => m.symbol) : [selectedSymbol];

        const subscribeSymbol = async (sym: string) => {
            if (!api_base.api || !isMountedRef.current) return;
            if (activeSubs.has(sym)) return;
            const pip = MARKETS.find(m => m.symbol === sym)?.pip || 2;

            try {
                const mData = marketsDataRef.current.get(sym);
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
                        }
                    }
                });

                activeSubs.set(sym, sub);
            } catch (err) {
                console.warn(`[B254] Subscription error for ${sym}:`, err);
            }
        };

        symbolsToStream.forEach(sym => {
            subscribeSymbol(sym);
        });

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

    // ── Market Data Slices ──
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
            config.targetStrategy,
            config.minQualityScore
        );
    }, [currentMarketData.digits, config.targetStrategy, config.minQualityScore]);

    // ── Multi-Market Scanner Evaluations ──
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
            const sig = evaluateB254Signal(digits, 'AUTO', config.minQualityScore);

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

        let bestIndex = -1;
        let maxScore = -1;
        list.forEach((item, i) => {
            if (item.signalScore > maxScore && item.signalScore >= config.minQualityScore) {
                maxScore = item.signalScore;
                bestIndex = i;
            }
        });

        if (bestIndex !== -1) {
            list[bestIndex].isBestMarket = true;
        }

        return list;
    }, [MARKETS, marketsDataRef.current, config.minQualityScore]);

    const bestMarketItem = useMemo(() => {
        return scannerMarkets.find(m => m.isBestMarket) || null;
    }, [scannerMarkets]);

    // ── Ranked Markets Helper for Auto-Switch ──
    const getLiveRankedMarkets = useCallback(() => {
        const result: Array<{
            symbol: string;
            label: string;
            qualityScore: number;
            isAutoPaused: boolean;
            isTriggered: boolean;
            direction: 'UNDER_6' | 'OVER_3';
        }> = [];

        MARKETS.forEach(m => {
            const data = marketsDataRef.current.get(m.symbol);
            if (!data || data.digits.length < 15) return;
            const sig = evaluateB254Signal(data.digits, 'AUTO', configRef.current.minQualityScore);
            result.push({
                symbol: m.symbol,
                label: m.label,
                qualityScore: sig?.score.totalScore || 0,
                isAutoPaused: Boolean(sig?.isAutoPaused),
                isTriggered: sig?.status === 'TRIGGERED',
                direction: sig?.direction || 'UNDER_6',
            });
        });

        result.sort((a, b) => {
            if (a.isTriggered && !b.isTriggered) return -1;
            if (!a.isTriggered && b.isTriggered) return 1;
            return b.qualityScore - a.qualityScore;
        });

        return result;
    }, []);

    // ── Execute Trade Subroutine ──
    const executeTrade = async (
        symbol: string,
        direction: 'UNDER_6' | 'OVER_3',
        prediction: number,
        tradeStake: number,
        durationTicks: number
    ): Promise<number> => {
        const contractType = direction === 'UNDER_6' ? 'DIGITUNDER' : 'DIGITOVER';
        const barrier = direction === 'UNDER_6' ? '6' : '3';
        const marketLabel = MARKETS.find(m => m.symbol === symbol)?.label || symbol;

        const txId = `B254-${Date.now().toString().slice(-6)}`;
        const now = new Date();
        const timeFormatted = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;

        const auditSnapshot: TradeConditionSnapshot = {
            direction,
            prediction,
            entryDigit: currentSignal?.entryDigit || 0,
            signalScore: currentSignal?.score.totalScore || 0,
            under04Pct: multiHorizon.h50.pctUnder04,
            over59Pct: multiHorizon.h50.pctOver59,
            under05Count: multiHorizon.h50.under05,
            over49Count: multiHorizon.h50.over49,
            last10Ratio: `${multiHorizon.h15.under05}/10 Under`,
            last7Ratio: `${Math.min(7, Math.round((multiHorizon.h15.under05 / 15) * 7))}/7 Under`,
            outlierPct: direction === 'UNDER_6'
                ? (digitPower.items[7]?.pct1000 || 0) + (digitPower.items[8]?.pct1000 || 0) + (digitPower.items[9]?.pct1000 || 0)
                : (digitPower.items[0]?.pct1000 || 0) + (digitPower.items[1]?.pct1000 || 0) + (digitPower.items[2]?.pct1000 || 0),
            history30mBias: multiHorizon.history30m.bias,
            history1hBias: multiHorizon.history1h.bias,
            regime: regime.currentRegime,
        };

        const pendingRecord: B254TransactionRecord = {
            id: txId,
            timestamp: Date.now(),
            timeFormatted,
            market: marketLabel,
            symbol,
            direction,
            contractType,
            prediction,
            entryDigit: currentSignal?.entryDigit || 0,
            stake: tradeStake,
            martingaleLevel: martingaleLevelRef.current,
            signalScore: currentSignal?.score.totalScore || 0,
            result: 'PENDING',
            profit: 0,
            balanceAfterTrade: actualBalance,
            auditSnapshot,
            durationTicks,
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
                    duration: durationTicks,
                    duration_unit: 't',
                    symbol,
                    barrier,
                },
                price: tradeStake,
                source: 'B254',
            });

            if (!buyResult?.contract_id) {
                setTransactions(prev => prev.filter(t => t.id !== txId));
                return 0;
            }

            const settled = await streamContractUntilSettled({
                contractId: buyResult.contract_id,
                source: 'B254',
            });

            const isWin = (settled?.profit ?? 0) > 0;
            const profitAmount = settled?.profit ?? (isWin ? tradeStake * 0.40 : -tradeStake);

            const settledRecord: B254TransactionRecord = {
                ...pendingRecord,
                id: String(settled?.contract_id || txId),
                result: isWin ? 'WIN' : 'LOSS',
                profit: Number(profitAmount.toFixed(2)),
                balanceAfterTrade: Number(((settled?.balance_after ?? actualBalance) + profitAmount).toFixed(2)),
                status: 'settled',
            };

            setTransactions(prev => prev.map(t => (t.id === txId ? settledRecord : t)));

            // AI Continuous Learning
            try {
                aiContinuousLearningService.recordBotTrade({
                    botName: 'AUTOFLIPPER',
                    strategy: direction,
                    market: symbol,
                    contractType,
                    barrier,
                    prediction,
                    isWin,
                    profit: profitAmount,
                    stake: tradeStake,
                });
            } catch {}

            return profitAmount;
        } catch (err) {
            console.error('[B254] Trade execution error:', err);
            setTransactions(prev => prev.filter(t => t.id !== txId));
            return 0;
        }
    };

    // ─── Continuous Autonomous Trading Loop ────────────────────────────────────

    const startTradingLoop = useCallback(() => {
        if (autoAbortRef.current) {
            autoAbortRef.current.abort();
        }
        const abortController = new AbortController();
        autoAbortRef.current = abortController;
        const abortSig = abortController.signal;

        marketStartTimeRef.current = Date.now();
        setDwellRemainingSec(600);
        setAutoState('SCANNING');
        autoStateRef.current = 'SCANNING';

        let noPatternCycles = 0;
        let cycleRunCount = 0; // Tracks base-stake trade completions for the 5-run cycle pause

        const loop = async () => {
            while (!abortSig.aborted && autoStateRef.current !== 'IDLE') {
                if (autoStateRef.current === 'PAUSED' || autoStateRef.current === 'LOSS_GUARD') {
                    await new Promise(r => setTimeout(r, 400));
                    continue;
                }

                // 1. Verify User Login Status
                if (!isLoggedIn()) {
                    setAutoState('IDLE');
                    autoStateRef.current = 'IDLE';
                    const oauthUrl = await generateOAuthURL();
                    window.location.assign(oauthUrl);
                    break;
                }

                // 2. Check Stop Loss Auto-Stop
                const sl = configRef.current.stopLoss;
                if (totalProfitRef.current <= -sl) {
                    setAutoState('IDLE');
                    autoStateRef.current = 'IDLE';
                    playSound('loss');
                    setMilestoneModal({
                        isOpen: true,
                        type: 'sl',
                        amount: Math.abs(totalProfitRef.current),
                    });
                    break;
                }

                // 3. Check Take Profit Auto-Stop
                const tp = configRef.current.takeProfit;
                if (totalProfitRef.current >= tp) {
                    setAutoState('IDLE');
                    autoStateRef.current = 'IDLE';
                    playSound('win');
                    setMilestoneModal({
                        isOpen: true,
                        type: 'tp',
                        amount: totalProfitRef.current,
                    });
                    break;
                }

                // 4. Check Consecutive Losses Safety Auto-Stop
                if (consecutiveLossesRef.current >= configRef.current.maxConsecutiveLosses) {
                    setAutoState('IDLE');
                    autoStateRef.current = 'IDLE';
                    playSound('loss');
                    break;
                }

                // 5. Get Active Market Data
                const targetSym = selectedSymbolRef.current;
                const mData = marketsDataRef.current.get(targetSym);
                if (!mData || mData.digits.length < 15) {
                    if (autoStateRef.current !== 'SCANNING') {
                        setAutoState('SCANNING');
                        autoStateRef.current = 'SCANNING';
                    }
                    await new Promise(r => setTimeout(r, 300));
                    continue;
                }

                const sig = evaluateB254Signal(
                    mData.digits,
                    configRef.current.targetStrategy,
                    configRef.current.minQualityScore
                );

                // 6. Check 10-Minute Dwell or Market Degradation Auto-Switch
                const dwellElapsed = Date.now() - marketStartTimeRef.current;
                const isTenMinuteDwellReached = dwellElapsed >= MARKET_DWELL_LIMIT_MS;
                const isMarketBad = !sig || sig.isAutoPaused || noPatternCycles >= 15;

                // Rotate only when not in middle of martingale recovery to avoid switching stakes
                if (
                    configRef.current.autoSwitchMarkets &&
                    currentStakeRef.current <= configRef.current.stake &&
                    (isTenMinuteDwellReached || isMarketBad)
                ) {
                    const ranked = getLiveRankedMarkets();
                    const alt = ranked.find(
                        m => m.symbol !== targetSym && !m.isAutoPaused && m.qualityScore >= configRef.current.minQualityScore
                    ) || (isTenMinuteDwellReached ? ranked.find(m => m.symbol !== targetSym && !m.isAutoPaused) : null);

                    if (alt) {
                        switchSelectedSymbol(alt.symbol);
                        noPatternCycles = 0;
                        throttleRender.current();
                        await new Promise(r => setTimeout(r, 600));
                        continue;
                    }
                }

                // 7. Handle Signal Auto-Pause (Regime shift)
                if (sig?.isAutoPaused) {
                    if (autoStateRef.current !== 'SCANNING') {
                        setAutoState('SCANNING');
                        autoStateRef.current = 'SCANNING';
                    }
                    await new Promise(r => setTimeout(r, 200));
                    continue;
                }

                // 8. Handle Waiting for Trigger
                if (!sig || sig.status === 'WAITING' || sig.status === 'ENTRY_READY') {
                    noPatternCycles++;
                    const nextState = sig?.status === 'ENTRY_READY' ? 'WAITING_TRIGGER' : 'SCANNING';
                    if (autoStateRef.current !== nextState) {
                        setAutoState(nextState);
                        autoStateRef.current = nextState;
                    }
                    await new Promise(r => setTimeout(r, 120));
                    continue;
                }

                // 9. EXECUTE TRADE
                noPatternCycles = 0;
                setAutoState('TRADING');
                autoStateRef.current = 'TRADING';

                try {
                    const stake = currentStakeRef.current;
                    const durationTicks = configRef.current.tickDuration || 1;

                    const profit = await executeTrade(targetSym, sig.direction, sig.prediction, stake, durationTicks);
                    if (abortSig.aborted || (autoStateRef.current as B254AutoState) === 'IDLE') break;

                    const isWin = profit > 0;
                    const newTotalProfit = parseFloat((totalProfitRef.current + profit).toFixed(2));
                    totalProfitRef.current = newTotalProfit;
                    setTotalProfit(newTotalProfit);
                    saveSessionState();

                    if (isWin) {
                        winsRef.current++;
                        setWins(winsRef.current);
                        consecutiveLossesRef.current = 0;
                        setConsecutiveLosses(0);
                        martingaleLevelRef.current = 0;
                        setMartingaleLevel(0);
                        currentStakeRef.current = configRef.current.stake;
                        setCurrentStake(configRef.current.stake);
                        playSound('win');
                    } else {
                        lossesRef.current++;
                        setLosses(lossesRef.current);
                        consecutiveLossesRef.current++;
                        setConsecutiveLosses(consecutiveLossesRef.current);

                        if (configRef.current.enableMartingale) {
                            martingaleLevelRef.current++;
                            setMartingaleLevel(martingaleLevelRef.current);
                            const nextStake = Math.min(
                                configRef.current.maxStake,
                                parseFloat((currentStakeRef.current * configRef.current.martingaleMultiplier).toFixed(2))
                            );
                            currentStakeRef.current = nextStake;
                            setCurrentStake(nextStake);
                        } else {
                            currentStakeRef.current = configRef.current.stake;
                            setCurrentStake(configRef.current.stake);
                        }

                        playSound('loss');

                        // ── Post-Loss Guard Re-Analysis ──
                        if (configRef.current.lossGuardEnabled && !abortSig.aborted && (autoStateRef.current as B254AutoState) !== 'IDLE') {
                            const lossCount = consecutiveLossesRef.current;
                            const cooldownMs = lossCount >= 2 ? 4000 : 2000;

                            setAutoState('LOSS_GUARD');
                            autoStateRef.current = 'LOSS_GUARD';

                            await new Promise(r => setTimeout(r, cooldownMs));

                            // Poll for fresh high-quality triggered signal before resuming
                            const pollStart = Date.now();
                            const maxWait = 45000;
                            let verifiedSignal = false;

                            while (
                                !abortSig.aborted &&
                                autoStateRef.current === 'LOSS_GUARD' &&
                                Date.now() - pollStart < maxWait
                            ) {
                                const liveData = marketsDataRef.current.get(selectedSymbolRef.current);
                                if (liveData && liveData.digits.length >= 15) {
                                    const freshSig = evaluateB254Signal(
                                        liveData.digits,
                                        configRef.current.targetStrategy,
                                        configRef.current.minQualityScore
                                    );
                                    if (freshSig && freshSig.status === 'TRIGGERED' && !freshSig.isAutoPaused) {
                                        verifiedSignal = true;
                                        break;
                                    }
                                }
                                await new Promise(r => setTimeout(r, 2000));
                            }

                            if (!abortSig.aborted && autoStateRef.current === 'LOSS_GUARD') {
                                if (verifiedSignal) {
                                    playSound('signal');
                                }
                                setAutoState('WAITING_TRIGGER');
                                autoStateRef.current = 'WAITING_TRIGGER';
                            }
                        }
                    }
                    // ── 5-Run Cycle Pause: only count base-stake completions ──────────────────
                    if (currentStakeRef.current <= configRef.current.stake * 1.05) {
                        cycleRunCount++;
                    }
                    if (cycleRunCount >= 5) {
                        cycleRunCount = 0;
                        const cycleMarket = marketsDataRef.current.get(selectedSymbolRef.current);
                        const cycleLabel = cycleMarket?.label || selectedSymbolRef.current;
                        setAutoState('LOSS_GUARD');
                        autoStateRef.current = 'LOSS_GUARD';
                        console.log('[B254] Cycle pause — scanning for quality setup…');

                        // 3s settle window
                        await new Promise(r => setTimeout(r, 3000));

                        // Poll up to 90s for a fresh TRIGGERED quality signal
                        const cyclePollStart = Date.now();
                        let cycleSignalFound = false;
                        while (
                            !abortSig.aborted &&
                            autoStateRef.current === 'LOSS_GUARD' &&
                            Date.now() - cyclePollStart < 90_000
                        ) {
                            const liveD = marketsDataRef.current.get(selectedSymbolRef.current);
                            if (liveD && liveD.digits.length >= 15) {
                                const freshSig = evaluateB254Signal(
                                    liveD.digits,
                                    configRef.current.targetStrategy,
                                    configRef.current.minQualityScore
                                );
                                if (
                                    freshSig &&
                                    freshSig.status === 'TRIGGERED' &&
                                    !freshSig.isAutoPaused &&
                                    freshSig.qualityScore >= configRef.current.minQualityScore
                                ) {
                                    cycleSignalFound = true;
                                    playSound('signal');
                                    console.log(`[B254] Quality setup found after cycle pause (Q:${freshSig.qualityScore}). Resuming.`);
                                    break;
                                }
                            }
                            await new Promise(r => setTimeout(r, 2000));
                        }

                        if (!abortSig.aborted && autoStateRef.current === 'LOSS_GUARD') {
                            if (!cycleSignalFound) {
                                console.log('[B254] Cycle pause: 90s timeout — resuming scan.');
                            }
                            setAutoState('WAITING_TRIGGER');
                            autoStateRef.current = 'WAITING_TRIGGER';
                        }
                    }
                } catch (tradeErr) {
                    console.error('[B254] Trade execution loop notice:', tradeErr);
                } finally {
                    if (!abortSig.aborted && autoStateRef.current === 'TRADING') {
                        setAutoState('WAITING_TRIGGER');
                        autoStateRef.current = 'WAITING_TRIGGER';
                    }
                }

                await new Promise(r => setTimeout(r, 400));
            }
        };

        loop();
    }, [executeTrade, getLiveRankedMarkets, saveSessionState, switchSelectedSymbol]);

    // ── Action Handlers ──

    const handleStartAutoTrading = useCallback(() => {
        startTradingLoop();
    }, [startTradingLoop]);

    const handlePauseAutoTrading = useCallback(() => {
        setAutoState('PAUSED');
        autoStateRef.current = 'PAUSED';
    }, []);

    const handleResumeAutoTrading = useCallback(() => {
        setAutoState('WAITING_TRIGGER');
        autoStateRef.current = 'WAITING_TRIGGER';
    }, []);

    const handleStopAutoTrading = useCallback(() => {
        if (autoAbortRef.current) {
            autoAbortRef.current.abort();
            autoAbortRef.current = null;
        }
        setAutoState('IDLE');
        autoStateRef.current = 'IDLE';
    }, []);

    const handleEmergencyStop = useCallback(() => {
        if (autoAbortRef.current) {
            autoAbortRef.current.abort();
            autoAbortRef.current = null;
        }
        setAutoState('IDLE');
        autoStateRef.current = 'IDLE';
    }, []);

    return (
        <div className='b254-suite'>
            {/* ── 1. Top Real-Time Trading Terminal HUD (No Compounding) ── */}
            <B254TradingDashboard
                liveBalance={actualBalance}
                currency={currency}
                autoState={autoState}
                totalProfit={totalProfit}
                wins={wins}
                losses={losses}
                currentStake={currentStake}
                baseStake={config.stake}
                martingaleLevel={martingaleLevel}
                takeProfit={config.takeProfit}
                stopLoss={config.stopLoss}
                selectedSymbol={selectedSymbol}
                selectedLabel={currentMarketData.label}
                dwellRemainingSec={dwellRemainingSec}
                autoSwitch={config.autoSwitchMarkets}
                regime={regime.currentRegime}
                qualityScore={currentSignal?.score.totalScore || 0}
                biasPct={
                    regime.currentRegime === 'UNDER'
                        ? multiHorizon.h50.pctUnder05
                        : regime.currentRegime === 'OVER'
                        ? multiHorizon.h50.pctOver49
                        : 50
                }
                onResetStats={handleResetStats}
            />

            {/* ── 2. Main Workspace Layout with Collapsible Market Scanner ── */}
            <div className={`b254-workspace-layout ${sidebarExpanded ? 'sidebar-open' : 'sidebar-closed'}`}>
                {/* Collapsible Left Scanner Tray */}
                <MarketScannerSidebar
                    isExpanded={sidebarExpanded}
                    onToggleExpand={() => setSidebarExpanded(v => !v)}
                    markets={scannerMarkets}
                    selectedSymbol={selectedSymbol}
                    onSelectMarket={sym => switchSelectedSymbol(sym)}
                    scanAllMarkets={scanAllMarkets}
                    onToggleScanAll={setScanAllMarkets}
                    autoInputBestMarket={config.autoSwitchMarkets}
                    onToggleAutoInputBest={v => updateConfig({ autoSwitchMarkets: v })}
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
                                onChange={e => switchSelectedSymbol(e.target.value)}
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
                                    className={`pill-btn ${config.targetStrategy === 'AUTO' ? 'active auto' : ''}`}
                                    onClick={() => updateConfig({ targetStrategy: 'AUTO' })}
                                >
                                    <Sparkles size={13} />
                                    <span>AUTO (Strongest)</span>
                                </button>
                                <button
                                    className={`pill-btn ${config.targetStrategy === 'UNDER_6' ? 'active under' : ''}`}
                                    onClick={() => updateConfig({ targetStrategy: 'UNDER_6' })}
                                >
                                    <span>UNDER 6 (0–5)</span>
                                </button>
                                <button
                                    className={`pill-btn ${config.targetStrategy === 'OVER_3' ? 'active over' : ''}`}
                                    onClick={() => updateConfig({ targetStrategy: 'OVER_3' })}
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

                    {/* Clear Market Understanding Card & Diagnostics */}
                    <MarketUnderstandingCard
                        explanation={currentSignal?.marketExplanation || 'Analyzing multi-timeframe tick streams...'}
                        whyNotTradeReasons={currentSignal?.whyNotTradeReasons || []}
                        regime={regime}
                        marketLabel={currentMarketData.label}
                    />

                    {/* Automated Trading Execution & Manual Risk Control Panel */}
                    <TradingControlPanel
                        config={config}
                        autoState={autoState}
                        currency={currency}
                        onUpdateConfig={updateConfig}
                        onStartAutoTrading={handleStartAutoTrading}
                        onPauseAutoTrading={handlePauseAutoTrading}
                        onResumeAutoTrading={handleResumeAutoTrading}
                        onStopAutoTrading={handleStopAutoTrading}
                        onEmergencyStop={handleEmergencyStop}
                        onResetStats={handleResetStats}
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
