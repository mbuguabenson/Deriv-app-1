import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { observer } from 'mobx-react-lite';
import { useStore } from '@/hooks/useStore';
import {
    AutoTradingConfig,
    Candle,
    MarketSymbolInfo,
    PriceZone,
    SignalEvaluation,
    SignalHistoryItem,
    TimeframeAnalysis,
    TimeframeKey,
    TransactionCardData,
    EntryExitSuggestion,
    BestMarketOpportunity,
} from './types';
import { DerivMarketFeedService } from './services/deriv-market-feed.service';
import { SignalEngineService } from './services/signal-engine.service';
import { ExecutionService, ExecutionStats } from './services/execution.service';
import { TimingAndMarketService } from './services/timing-and-market.service';

import { RiseFallHeader } from './components/RiseFallHeader';
import { MarketSelector } from './components/MarketSelector';
import { CandleChart } from './components/CandleChart';
import { MultiTimeframePanel } from './components/MultiTimeframePanel';
import { LiveAnalysisPanel } from './components/LiveAnalysisPanel';
import { SignalCard } from './components/SignalCard';
import { AutoTradingConfigModal } from './components/AutoTradingConfigModal';
import { TransactionCard } from './components/TransactionCard';
import { SignalHistory } from './components/SignalHistory';
import { DebugPanel } from './components/DebugPanel';
import { AutoAnalysisHud } from './components/AutoAnalysisHud';
import { IndicatorsService } from './services/indicators.service';
import { CandlestickService } from './services/candlestick.service';

import { Bug, Sliders } from 'lucide-react';
import useThemeSwitcher from '@/hooks/useThemeSwitcher';
import './rise-fall.scss';

const DEFAULT_CONFIG: AutoTradingConfig = {
    enabled: false,
    stake: 1.0,
    duration: 5,
    durationUnit: 't',
    maxTradesPerSession: 20,
    maxConsecutiveLosses: 3,
    sessionStopLoss: 20,
    sessionTakeProfit: 50,
    minConfidence: 65,
    cooldownSeconds: 6,
    pauseOnLowActivity: false,
    useMartingale: true,
    martingaleMultiplier: 2.1,
};

const RiseFallPage: React.FC = observer(() => {
    const store = useStore();
    const { client, common } = store ?? {};
    const { is_dark_mode_on, toggleTheme } = useThemeSwitcher();

    // Account & Connection State
    const activeLoginId = client?.loginid || (api_base as any)?.account_info?.loginid || '';
    const balance = client?.balance ?? 0;
    const currency = client?.currency || 'USD';
    const isVirtual = Boolean(
        client?.is_virtual ||
            activeLoginId.startsWith('VR') ||
            activeLoginId.startsWith('VRTC')
    );
    const isConnected = Boolean(common?.is_socket_opened && api_base?.api);

    // Market & Data Feed State
    const [markets, setMarkets] = useState<MarketSymbolInfo[]>([]);
    const [selectedSymbol, setSelectedSymbol] = useState<string>('R_100');
    const [currentPrice, setCurrentPrice] = useState<number>(0);
    const [activeTimeframe, setActiveTimeframe] = useState<TimeframeKey>('5m');
    const [donchianPeriod, setDonchianPeriod] = useState<number>(20);

    const [timeframeData, setTimeframeData] = useState<Record<TimeframeKey, Candle[]>>({
        '30m': [],
        '15m': [],
        '5m': [],
        '1m': [],
    });

    const [timeframeAnalyses, setTimeframeAnalyses] = useState<
        Record<TimeframeKey, TimeframeAnalysis | null>
    >({
        '30m': null,
        '15m': null,
        '5m': null,
        '1m': null,
    });

    const [zones, setZones] = useState<PriceZone[]>([]);

    // Signal & History State
    const [signal, setSignal] = useState<SignalEvaluation | null>(null);
    const [signalHistory, setSignalHistory] = useState<SignalHistoryItem[]>([]);

    // Auto Trading & Execution State
    const [autoConfig, setAutoConfig] = useState<AutoTradingConfig>(DEFAULT_CONFIG);
    const [isConfigModalOpen, setIsConfigModalOpen] = useState<boolean>(false);
    const [transactions, setTransactions] = useState<TransactionCardData[]>([]);
    const [execStats, setExecStats] = useState<ExecutionStats>({
        totalTrades: 0,
        wins: 0,
        losses: 0,
        winRate: 0,
        totalProfit: 0,
        consecutiveLosses: 0,
        isPaused: false,
    });

    const [isDebugMode, setIsDebugMode] = useState<boolean>(false);
    const [isExecutingTrade, setIsExecutingTrade] = useState<boolean>(false);
    const [autoAnalysisEnabled, setAutoAnalysisEnabled] = useState<boolean>(true);

    // Dynamic Market Trend Summary (Auto Technical Analysis)
    const marketTrend = useMemo(() => {
        if (!autoAnalysisEnabled) return null;
        return IndicatorsService.detectMarketTrend(timeframeAnalyses, timeframeData[activeTimeframe]);
    }, [autoAnalysisEnabled, timeframeAnalyses, timeframeData, activeTimeframe]);

    // Detected Candlestick Formations in Current Timeframe (Auto Technical Analysis)
    const detectedCandlePatterns = useMemo(() => {
        if (!autoAnalysisEnabled) return [];
        return CandlestickService.scanCandlePatterns(
            timeframeData[activeTimeframe],
            timeframeAnalyses[activeTimeframe]?.donchian || null
        );
    }, [autoAnalysisEnabled, timeframeData, activeTimeframe, timeframeAnalyses]);

    const [bestMarkets, setBestMarkets] = useState<BestMarketOpportunity[]>([]);
    const [tickSeconds, setTickSeconds] = useState<number>(() => Math.floor(Date.now() / 1000));

    // Fast 1s ticker for live candle countdown and entry timing
    useEffect(() => {
        const interval = setInterval(() => {
            setTickSeconds(Math.floor(Date.now() / 1000));
        }, 1000);
        return () => clearInterval(interval);
    }, []);

    // Recommended Entry Timing and Optimal Exit
    const entryExitSuggestion: EntryExitSuggestion | null = useMemo(() => {
        if (!autoAnalysisEnabled) return null;
        return TimingAndMarketService.calculateEntryExit(
            activeTimeframe,
            signal,
            timeframeData[activeTimeframe],
            timeframeAnalyses[activeTimeframe]?.activity || null,
            timeframeAnalyses[activeTimeframe]?.donchian || null,
            timeframeAnalyses[activeTimeframe]?.cci || null
        );
    }, [
        autoAnalysisEnabled,
        activeTimeframe,
        signal,
        timeframeData,
        timeframeAnalyses,
        tickSeconds,
    ]);

    // Periodically scan top Deriv synthetic markets for best opportunity
    useEffect(() => {
        if (markets.length === 0) return;
        let isCancelled = false;

        const runScan = async () => {
            const opps = await TimingAndMarketService.scanBestMarkets(markets, selectedSymbol);
            if (!isCancelled && opps && opps.length > 0) {
                setBestMarkets(opps);
            }
        };

        runScan();
        const interval = setInterval(runScan, 60000);
        return () => {
            isCancelled = true;
            clearInterval(interval);
        };
    }, [markets, selectedSymbol]);

    const bestMarket = useMemo(() => {
        return bestMarkets[0] || null;
    }, [bestMarkets]);

    // Service Instances
    const feedServiceRef = useRef<DerivMarketFeedService | null>(null);
    const executionServiceRef = useRef<ExecutionService>(new ExecutionService());
    const lastExecutedSignalRef = useRef<string>('');

    // Active Market Symbol Model
    const activeMarket = useMemo(() => {
        return (
            markets.find(m => m.symbol === selectedSymbol) || {
                symbol: selectedSymbol,
                displayName: 'Volatility 100 Index',
                market: 'synthetic_index',
                submarket: 'random_index',
                category: 'volatility' as const,
                isOpen: true,
                pipSize: 2,
            }
        );
    }, [markets, selectedSymbol]);

    // Trading Status Calculation
    const tradingStatus = useMemo(() => {
        if (execStats.isPaused) return 'PAUSED' as const;
        if (isExecutingTrade) return 'EXECUTING' as const;
        if (autoConfig.enabled) {
            if (transactions.some(t => t.status === 'OPEN')) return 'MONITORING' as const;
            return 'ANALYZING' as const;
        }
        return 'IDLE' as const;
    }, [execStats.isPaused, isExecutingTrade, autoConfig.enabled, transactions]);

    // Initialize Market Symbols
    useEffect(() => {
        let isMounted = true;
        DerivMarketFeedService.getAvailableSymbols().then(loadedSymbols => {
            if (isMounted && loadedSymbols.length > 0) {
                setMarkets(loadedSymbols);
            }
        });
        return () => {
            isMounted = false;
        };
    }, []);

    // Initialize Feed Service & Subscribe
    useEffect(() => {
        const feed = new DerivMarketFeedService();
        feedServiceRef.current = feed;

        const unsubscribe = feed.subscribe(data => {
            setCurrentPrice(data.currentPrice);
            setTimeframeData(data.timeframeData);
            setTimeframeAnalyses(data.timeframeAnalysis);
            setZones(data.zones);

            // Re-evaluate signal on every data update
            const evalResult = SignalEngineService.evaluate(
                data.timeframeAnalysis['30m'],
                data.timeframeAnalysis['15m'],
                data.timeframeAnalysis['5m'],
                data.timeframeAnalysis['1m'],
                autoConfig.minConfidence
            );
            setSignal(evalResult);
        });

        feed.switchMarket(selectedSymbol);

        return () => {
            unsubscribe();
            feed.stopFeed();
            feedServiceRef.current = null;
        };
    }, [selectedSymbol, autoConfig.minConfidence]);

    // Subscribe to Execution Events
    useEffect(() => {
        const exec = executionServiceRef.current;
        const unsubscribe = exec.subscribe(({ transaction, stats }) => {
            setTransactions(prev => {
                const existingIdx = prev.findIndex(t => t.id === transaction.id);
                if (existingIdx >= 0) {
                    const updated = [...prev];
                    updated[existingIdx] = transaction;
                    return updated;
                }
                return [transaction, ...prev.slice(0, 49)];
            });
            setExecStats(stats);
        });
        return unsubscribe;
    }, []);

    // Change Donchian Period
    const handleDonchianPeriodChange = (period: number) => {
        setDonchianPeriod(period);
        feedServiceRef.current?.setDonchianPeriod(period);
    };

    // Switch Market
    const handleSelectMarket = (symbol: string) => {
        setSelectedSymbol(symbol);
        feedServiceRef.current?.switchMarket(symbol);
    };

    // Core Trade Execution Action (supports both automated bot signals and manual trades)
    const executeTradeAction = useCallback(
        async (direction: 'RISE' | 'FALL', isManual: boolean = false) => {
            if (isExecutingTrade) return;

            const effectiveSignal: SignalEvaluation = signal || {
                state: 'WAIT',
                direction,
                confidence: 70,
                structure: 'BULLISH_CONTINUATION',
                reasons: ['Manual trade execution'],
                isExecutionReady: true,
                debugChecks: [],
                evaluatedAt: Date.now(),
            };

            setIsExecutingTrade(true);
            try {
                const result = await executionServiceRef.current.executeTrade({
                    direction,
                    symbol: selectedSymbol,
                    displayName: activeMarket.displayName,
                    stake: autoConfig.stake,
                    duration: autoConfig.duration,
                    durationUnit: autoConfig.durationUnit,
                    currency,
                    signal: effectiveSignal,
                    analyses: timeframeAnalyses,
                    config: autoConfig,
                    isManual,
                });

                // Add to history
                if (result) {
                    setSignalHistory(prev => [
                        {
                            id: result.id,
                            timestamp: Date.now(),
                            timeString: new Date().toLocaleTimeString(),
                            market: activeMarket.displayName,
                            direction,
                            signalType: effectiveSignal.structure.replace(/_/g, ' '),
                            timeframe: activeTimeframe.toUpperCase(),
                            confidence: effectiveSignal.confidence,
                            executed: true,
                            result: result.status === 'WON' ? 'WON' : result.status === 'LOST' ? 'LOST' : undefined,
                            profit: result.profit,
                        },
                        ...prev.slice(0, 99),
                    ]);
                }
            } finally {
                setIsExecutingTrade(false);
            }
        },
        [signal, isExecutingTrade, selectedSymbol, activeMarket, autoConfig, currency, timeframeAnalyses, activeTimeframe]
    );

    // Manual Trade Trigger
    const handleManualTrade = useCallback(
        (direction: 'RISE' | 'FALL') => {
            executeTradeAction(direction, true);
        },
        [executeTradeAction]
    );

    // Auto Trading Execution Engine Loop
    useEffect(() => {
        if (!autoConfig.enabled || !signal || isExecutingTrade) {
            return;
        }

        if (!signal.isExecutionReady || (signal.direction !== 'RISE' && signal.direction !== 'FALL')) {
            return;
        }

        // Avoid repeated triggers on the exact same signal evaluation timestamp
        const signalKey = `${signal.direction}_${signal.evaluatedAt}_${signal.confidence}`;
        if (lastExecutedSignalRef.current === signalKey) {
            return;
        }

        // Check if market activity is low and setting requires pause
        if (autoConfig.pauseOnLowActivity) {
            const act = timeframeAnalyses['5m']?.activity;
            if (act && !act.isTradable) {
                return;
            }
        }

        const canRun = executionServiceRef.current.canExecute(autoConfig);
        if (!canRun.allowed) {
            return;
        }

        lastExecutedSignalRef.current = signalKey;
        const targetDirection = signal.direction as 'RISE' | 'FALL';

        executeTradeAction(targetDirection, false);
    }, [autoConfig, signal, isExecutingTrade, timeframeAnalyses, executeTradeAction]);

    // Real-Time Auto-Trading Diagnostic HUD Status
    const autoTradingStatus = useMemo(() => {
        if (!autoConfig.enabled) {
            return {
                mode: 'OFF',
                title: 'Auto-Trading Off',
                detail: 'Click toggle to activate automated Deriv contract execution.',
                badgeClass: 'rf-status--off',
            };
        }

        if (execStats.isPaused) {
            return {
                mode: 'PAUSED',
                title: 'Trading Paused',
                detail: execStats.pauseReason || 'Session risk limit reached',
                badgeClass: 'rf-status--paused',
            };
        }

        if (isExecutingTrade) {
            return {
                mode: 'EXECUTING',
                title: 'Executing Trade...',
                detail: `Purchasing Deriv Rise/Fall contract (${activeMarket.displayName})...`,
                badgeClass: 'rf-status--executing',
            };
        }

        const cooldownRemaining = executionServiceRef.current.getCooldownRemaining(autoConfig.cooldownSeconds);
        if (cooldownRemaining > 0) {
            return {
                mode: 'COOLDOWN',
                title: `Cooldown Active (${cooldownRemaining}s)`,
                detail: `Next contract trigger in ${cooldownRemaining}s...`,
                badgeClass: 'rf-status--cooldown',
            };
        }

        if (!signal) {
            return {
                mode: 'ANALYZING',
                title: 'Loading Feeds',
                detail: 'Subscribing to real Deriv ticks & multi-timeframe candles...',
                badgeClass: 'rf-status--analyzing',
            };
        }

        if (signal.isExecutionReady && (signal.direction === 'RISE' || signal.direction === 'FALL')) {
            return {
                mode: 'READY',
                title: `Ready: ${signal.direction} (${signal.confidence}%)`,
                detail: `${signal.direction} order parameters verified. Initiating execution...`,
                badgeClass: 'rf-status--ready',
            };
        }

        // Waiting for confluence
        const currentConf = signal.confidence;
        const targetConf = autoConfig.minConfidence;
        const reason = signal.conflictReason || `Scanning market (${currentConf}% / ${targetConf}% target)`;
        return {
            mode: 'SCANNING',
            title: `Scanning: ${currentConf}% / ${targetConf}%`,
            detail: reason,
            badgeClass: 'rf-status--scanning',
        };
    }, [autoConfig, execStats, isExecutingTrade, signal, tickSeconds, activeMarket.displayName]);

    // Martingale Dynamic Stake Tracker
    const martingaleInfo = useMemo(() => {
        const nextStake = executionServiceRef.current.getNextStake(autoConfig);
        const step = executionServiceRef.current.getMartingaleStep();
        return {
            enabled: autoConfig.useMartingale,
            multiplier: autoConfig.martingaleMultiplier || 2.1,
            step,
            nextStake,
            baseStake: autoConfig.stake,
        };
    }, [autoConfig, execStats]);

    const [bottomDrawerTab, setBottomDrawerTab] = useState<'positions' | 'history' | 'audit'>('positions');

    const handleToggleAutoTrading = () => {
        setAutoConfig(prev => ({ ...prev, enabled: !prev.enabled }));
    };

    return (
        <div className={`rf-dashboard ${is_dark_mode_on ? 'rf-dashboard--dark' : 'rf-dashboard--light'}`}>
            {/* 1. Header */}
            <RiseFallHeader
                market={activeMarket}
                currentPrice={currentPrice}
                connectionStatus={isConnected}
                loginid={activeLoginId}
                balance={balance}
                currency={currency}
                isVirtual={isVirtual}
                autoTradingEnabled={autoConfig.enabled}
                onToggleAutoTrading={handleToggleAutoTrading}
                autoAnalysisEnabled={autoAnalysisEnabled}
                onToggleAutoAnalysis={() => setAutoAnalysisEnabled(prev => !prev)}
                tradingStatus={tradingStatus}
                pauseReason={execStats.pauseReason}
                isDarkMode={is_dark_mode_on}
                onToggleTheme={toggleTheme}
            />

            {/* Quick Actions & Market Sub-bar */}
            <div className='rf-subbar'>
                <div className='rf-subbar__left'>
                    <MarketSelector
                        markets={markets}
                        selectedSymbol={selectedSymbol}
                        onSelectMarket={handleSelectMarket}
                    />
                </div>

                <div className='rf-subbar__right'>
                    <button
                        className='rf-btn-secondary rf-btn-sm'
                        onClick={() => setIsConfigModalOpen(true)}
                    >
                        <Sliders size={14} />
                        <span>Settings</span>
                    </button>

                    <button
                        className={`rf-btn-secondary rf-btn-sm ${isDebugMode ? 'rf-btn-secondary--active' : ''}`}
                        onClick={() => setIsDebugMode(!isDebugMode)}
                    >
                        <Bug size={14} />
                        <span>Transparency Audit</span>
                    </button>
                </div>
            </div>

            {/* 2. Auto Technical Analysis Real-Time HUD */}
            <AutoAnalysisHud
                enabled={autoAnalysisEnabled}
                onToggle={() => setAutoAnalysisEnabled(prev => !prev)}
                marketTrend={marketTrend}
                detectedPatterns={detectedCandlePatterns}
                activeTimeframe={activeTimeframe}
                signal={signal}
                donchian={timeframeAnalyses[activeTimeframe]?.donchian || null}
                cci={timeframeAnalyses[activeTimeframe]?.cci || null}
                macd={timeframeAnalyses[activeTimeframe]?.macd || null}
                activity={timeframeAnalyses[activeTimeframe]?.activity || null}
                entryExit={entryExitSuggestion}
                onApplyDuration={(d, u) =>
                    setAutoConfig(prev => ({ ...prev, duration: d, durationUnit: u }))
                }
                bestMarket={bestMarket}
                onSwitchMarket={setSelectedSymbol}
                currentSymbol={selectedSymbol}
            />

            {/* Main Interactive Grid */}
            <div className='rf-main-grid'>
                {/* Left Column: Interactive Candlestick Chart */}
                <div className='rf-main-grid__chart-col'>
                    <CandleChart
                        candles={timeframeData[activeTimeframe]}
                        activeTimeframe={activeTimeframe}
                        onTimeframeChange={setActiveTimeframe}
                        donchian={timeframeAnalyses[activeTimeframe]?.donchian || null}
                        zones={zones}
                        signal={signal}
                        transactions={transactions}
                        currentPrice={currentPrice}
                        donchianPeriod={donchianPeriod}
                        onChangeDonchianPeriod={handleDonchianPeriodChange}
                        isDarkMode={is_dark_mode_on}
                        autoAnalysisEnabled={autoAnalysisEnabled}
                        detectedPatterns={detectedCandlePatterns}
                        symbol={selectedSymbol}
                        onSymbolChange={setSelectedSymbol}
                    />

                    {/* Multi-Timeframe Confirmation Strip */}
                    <MultiTimeframePanel analyses={timeframeAnalyses} signal={signal} />
                </div>

                {/* Right Column: Signal Card, Live Technical Readout, Execution Controls */}
                <div className='rf-main-grid__sidebar-col'>
                    {/* Signal Action & Reasoning Card */}
                    <SignalCard
                        signal={signal}
                        isExecuting={isExecutingTrade}
                        onManualTrade={handleManualTrade}
                        stake={autoConfig.stake}
                        duration={autoConfig.duration}
                        durationUnit={autoConfig.durationUnit}
                        currency={currency}
                        onChangeStake={s => setAutoConfig(prev => ({ ...prev, stake: s }))}
                        onChangeDuration={d => setAutoConfig(prev => ({ ...prev, duration: d }))}
                        onChangeDurationUnit={u => setAutoConfig(prev => ({ ...prev, durationUnit: u }))}
                        onOpenSettings={() => setIsConfigModalOpen(true)}
                        autoTradingEnabled={autoConfig.enabled}
                        onToggleAutoTrading={handleToggleAutoTrading}
                        entryExit={entryExitSuggestion}
                        autoTradingStatus={autoTradingStatus}
                        martingaleInfo={martingaleInfo}
                    />

                    {/* Live Technical Indicator Readout */}
                    <LiveAnalysisPanel
                        market={activeMarket}
                        currentPrice={currentPrice}
                        analyses={timeframeAnalyses}
                        signal={signal}
                        zones={zones}
                    />
                </div>
            </div>

            {/* Debug Transparency Panel (Collapsible/Toggleable) */}
            {isDebugMode && <DebugPanel signal={signal} />}

            {/* DTrader Style Bottom Drawer */}
            <div className='rf-bottom-drawer'>
                <div className='rf-bottom-drawer__header'>
                    <div className='rf-bottom-drawer__tabs'>
                        <button
                            className={`rf-drawer-tab ${bottomDrawerTab === 'positions' ? 'rf-drawer-tab--active' : ''}`}
                            onClick={() => setBottomDrawerTab('positions')}
                        >
                            Positions ({transactions.length})
                        </button>
                        <button
                            className={`rf-drawer-tab ${bottomDrawerTab === 'history' ? 'rf-drawer-tab--active' : ''}`}
                            onClick={() => setBottomDrawerTab('history')}
                        >
                            Signal Log ({signalHistory.length})
                        </button>
                        <button
                            className={`rf-drawer-tab ${bottomDrawerTab === 'audit' ? 'rf-drawer-tab--active' : ''}`}
                            onClick={() => setBottomDrawerTab('audit')}
                        >
                            Engine Audit
                        </button>
                    </div>

                    <div className='rf-stats-strip'>
                        <span>Win Rate: <b>{execStats.winRate}%</b></span>
                        <span className='rf-divider'>|</span>
                        <span>Wins: <b>{execStats.wins}</b></span>
                        <span className='rf-divider'>|</span>
                        <span>Losses: <b>{execStats.losses}</b></span>
                        <span className='rf-divider'>|</span>
                        <span>
                            Session P/L:{' '}
                            <b className={execStats.totalProfit >= 0 ? 'rf-text-bullish' : 'rf-text-bearish'}>
                                {execStats.totalProfit >= 0
                                    ? `+$${execStats.totalProfit.toFixed(2)}`
                                    : `-$${Math.abs(execStats.totalProfit).toFixed(2)}`}
                            </b>
                        </span>
                    </div>
                </div>

                <div className='rf-bottom-drawer__content'>
                    {bottomDrawerTab === 'positions' && (
                        <div className='rf-transactions-list'>
                            {transactions.length === 0 ? (
                                <div className='rf-empty-state'>
                                    No executed contracts yet. Enter a Rise / Fall trade or toggle Auto-Execution above.
                                </div>
                            ) : (
                                transactions.map(card => <TransactionCard key={card.id} card={card} />)
                            )}
                        </div>
                    )}

                    {bottomDrawerTab === 'history' && (
                        <SignalHistory history={signalHistory} onClear={() => setSignalHistory([])} />
                    )}

                    {bottomDrawerTab === 'audit' && <DebugPanel signal={signal} />}
                </div>
            </div>

            {/* Auto Trading Configuration Modal */}
            <AutoTradingConfigModal
                isOpen={isConfigModalOpen}
                config={autoConfig}
                currency={currency}
                onClose={() => setIsConfigModalOpen(false)}
                onSave={newConfig => {
                    setAutoConfig({ ...newConfig, enabled: true });
                }}
            />
        </div>
    );
});

export default RiseFallPage;
