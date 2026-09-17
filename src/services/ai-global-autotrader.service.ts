/**
 * ai-global-autotrader.service.ts
 *
 * Site-Wide Background Autonomous AI Trading Engine & User Feedback Dispatcher
 *
 * Runs seamlessly across all tabs/pages of ProfitHub:
 * 1. Multi-Market Scanner: Ingests all synthetic derived indices in real time.
 * 2. Pattern & Trend Correlation: Evaluates multi-horizon trend slope, digit momentum, and Markov transition matrices.
 * 3. Autonomous Execution: Places high-conviction trades (Under 6, Over 3, Differs, Even/Odd) when entry conditions match.
 * 4. Multi-Channel Feedback: Broadcasts real-time toast alerts, audio chimes, thought log updates, and transaction drawer sync.
 */

import { toast } from 'react-toastify';
import { observer as globalObserver } from '@/external/bot-skeleton/utils/observer';
import { SUPPORTED_VOLATILITY_MARKETS } from '@/utils/digit-strategy';
import { isLoggedIn } from '@/utils/token-bridge';
import { buyContractForUi, streamContractUntilSettled } from '@/utils/trade-purchase';
import { subscribeTicks } from '@/utils/websocket-handler';
import { aiContinuousLearningService } from './ai-continuous-learning.service';
import { aiMarketPatternService, RecognizedPattern, MarketTrendState } from './ai-market-pattern.service';

export type GlobalAiMode = 'autonomous_trading' | 'advisory_signals_only';
export type StrategyFamily = 'ALL_ADAPTIVE' | 'ELITE_PRO_OVER_UNDER' | 'POVERTY_HUNTER_DIFFERS' | 'AUTO_EO';

export interface GlobalAiConfig {
    mode: GlobalAiMode;
    strategyFamily: StrategyFamily;
    stake: number;
    martingale: number;
    takeProfit: number;
    stopLoss: number;
    tickDuration: number;
    soundAlerts: boolean;
    toastAlerts: boolean;
    minConfidence: number; // e.g. 75%
}

export interface GlobalAiState {
    isRunning: boolean;
    status: 'IDLE' | 'SCANNING' | 'WAITING_TRIGGER' | 'EXECUTING' | 'PAUSED';
    activeMarket: string;
    activeMarketLabel: string;
    activeTrend?: MarketTrendState;
    activePattern?: RecognizedPattern;
    currentStake: number;
    totalProfit: number;
    wins: number;
    losses: number;
    consecutiveLosses: number;
    winRate: number;
    lastActionMessage: string;
    aiThoughts: string[];
}

const STORAGE_KEY_GLOBAL_AI_CONFIG = 'ph_global_ai_config';

class AiGlobalAutoTraderEngine {
    private isInitialized = false;
    private config: GlobalAiConfig = {
        mode: 'autonomous_trading',
        strategyFamily: 'ALL_ADAPTIVE',
        stake: 0.50,
        martingale: 2.6,
        takeProfit: 10.00,
        stopLoss: 25.00,
        tickDuration: 1,
        soundAlerts: true,
        toastAlerts: true,
        minConfidence: 75,
    };

    private state: GlobalAiState = {
        isRunning: false,
        status: 'IDLE',
        activeMarket: 'R_100',
        activeMarketLabel: 'Vol 100',
        currentStake: 0.50,
        totalProfit: 0,
        wins: 0,
        losses: 0,
        consecutiveLosses: 0,
        winRate: 0,
        lastActionMessage: 'AI Engine initialized and ready.',
        aiThoughts: ['AI Neural Engine active. Monitoring volatility market streams.'],
    };

    private abortController: AbortController | null = null;
    private subscriptions: Map<string, { unsubscribe: () => void }> = new Map();
    private subscribers: Set<(state: GlobalAiState, config: GlobalAiConfig) => void> = new Set();
    private isExecutingTrade = false;
    private lastTradeTime = 0;

    constructor() {
        this.loadConfig();
    }

    public init(): void {
        if (this.isInitialized) return;
        this.isInitialized = true;
        this.startGlobalMarketStreamSubscriptions();
        this.listenToPatternEvents();
    }

    public subscribe(cb: (state: GlobalAiState, config: GlobalAiConfig) => void): () => void {
        this.subscribers.add(cb);
        cb(this.state, this.config);
        return () => this.subscribers.delete(cb);
    }

    private notifySubscribers(): void {
        this.subscribers.forEach(cb => {
            try {
                cb({ ...this.state }, { ...this.config });
            } catch (e) {
                console.error('[AiGlobalAutoTrader] Subscriber error:', e);
            }
        });
    }

    private logThought(thought: string): void {
        const timestamp = new Date().toLocaleTimeString();
        const entry = `[${timestamp}] ${thought}`;
        this.state.aiThoughts = [entry, ...this.state.aiThoughts.slice(0, 40)];
        this.state.lastActionMessage = thought;
        this.notifySubscribers();
    }

    // ─────────────────────────────────────────────────────────────────────────
    // GLOBAL TICK INGESTION ACROSS ALL VOLATILITY MARKETS
    // ─────────────────────────────────────────────────────────────────────────

    private startGlobalMarketStreamSubscriptions(): void {
        const symbols = SUPPORTED_VOLATILITY_MARKETS.map(m => m.symbol);

        symbols.forEach(sym => {
            if (this.subscriptions.has(sym)) return;

            const sub = subscribeTicks(sym, (data: Record<string, unknown>) => {
                const tickData = data?.tick as { quote?: number | string } | undefined;
                const quote = tickData?.quote;
                if (quote !== undefined && quote !== null) {
                    const price = Number(quote);
                    const digit = this.extractDigit(quote);

                    // 1. Ingest into Continuous Learning Engine (Markov & Entropy)
                    aiContinuousLearningService.ingestMarketTick(sym, digit);

                    // 2. Ingest into Market Pattern & Trend Engine
                    aiMarketPatternService.ingestTick(sym, price, digit);

                    // 3. Trigger Global AI evaluation loop tick
                    this.evaluateExecutionTick(sym);
                }
            });

            this.subscriptions.set(sym, sub);
        });
    }

    private extractDigit(quote: number | string): number {
        const s = typeof quote === 'number' ? quote.toFixed(6).replace(/\.?0+$/, '') : String(quote).trim();
        const parts = s.split('.');
        if (parts.length > 1 && parts[1].length > 0) {
            return parseInt(parts[1].slice(-1), 10) || 0;
        }
        return parseInt(parts[0].slice(-1), 10) || 0;
    }

    private listenToPatternEvents(): void {
        aiMarketPatternService.onEvent(event => {
            if (event.type === 'PATTERN_DETECTED') {
                const p: RecognizedPattern = event.payload.pattern;
                const sym = event.payload.symbol;
                const mLabel = SUPPORTED_VOLATILITY_MARKETS.find(m => m.symbol === sym)?.label || sym;

                this.logThought(`Pattern Detected on ${mLabel}: ${p.description} (${p.confidence}% Conviction).`);
            }
        });
    }

    // ─────────────────────────────────────────────────────────────────────────
    // AUTONOMOUS TRADING CONTROLS
    // ─────────────────────────────────────────────────────────────────────────

    public start(): void {
        if (this.state.isRunning) return;

        if (!isLoggedIn()) {
            toast.warn('Please connect your Deriv account to activate Site-Wide AI Trading.');
            return;
        }

        this.state.isRunning = true;
        this.state.status = 'SCANNING';
        this.state.currentStake = this.config.stake;
        this.abortController = new AbortController();

        this.logThought('⚡ Site-Wide Autonomous AI Engine ACTIVATED. Scanning all volatility markets.');
        if (this.config.toastAlerts) {
            toast.success('🚀 Site-Wide AI Trading Engine Started! Operating across all tabs.');
        }

        this.notifySubscribers();
    }

    public pause(): void {
        this.state.isRunning = false;
        this.state.status = 'PAUSED';
        this.abortController?.abort();
        this.abortController = null;
        this.logThought('⏸ Site-Wide AI Trading Engine PAUSED.');
        this.notifySubscribers();
    }

    public stop(): void {
        this.state.isRunning = false;
        this.state.status = 'IDLE';
        this.abortController?.abort();
        this.abortController = null;
        this.logThought('🛑 Site-Wide AI Trading Engine STOPPED.');
        this.notifySubscribers();
    }

    public updateConfig(newConfig: Partial<GlobalAiConfig>): void {
        this.config = { ...this.config, ...newConfig };
        this.saveConfig();
        this.notifySubscribers();
    }

    public resetStats(): void {
        this.state.totalProfit = 0;
        this.state.wins = 0;
        this.state.losses = 0;
        this.state.consecutiveLosses = 0;
        this.state.winRate = 0;
        this.state.currentStake = this.config.stake;
        this.notifySubscribers();
    }

    // ─────────────────────────────────────────────────────────────────────────
    // EVALUATION & TRADING LOOP
    // ─────────────────────────────────────────────────────────────────────────

    private async evaluateExecutionTick(_triggerSymbol: string): Promise<void> {
        if (!this.state.isRunning || this.isExecutingTrade) return;

        // Check TP/SL boundaries
        if (this.state.totalProfit >= this.config.takeProfit) {
            this.logThought(`🎉 Take Profit Target Hit! Total Profit: +$${this.state.totalProfit.toFixed(2)}`);
            toast.success(`🎉 AI Target Reached: Take Profit Hit (+$${this.state.totalProfit.toFixed(2)})`);
            this.stop();
            return;
        }
        if (this.state.totalProfit <= -this.config.stopLoss) {
            this.logThought(`🛡️ Stop Loss Limit Hit (-$${Math.abs(this.state.totalProfit).toFixed(2)}). Halting bot.`);
            toast.error(`🛡️ AI Stop Loss Reached (-$${Math.abs(this.state.totalProfit).toFixed(2)})`);
            this.stop();
            return;
        }

        // Throttle trades by at least 1.5 seconds between executions
        const now = Date.now();
        if (now - this.lastTradeTime < 1500) return;

        // Scan all telemetry across markets to find best opportunity
        const allTelemetry = aiMarketPatternService.getAllTelemetry();
        let bestOpportunity: {
            symbol: string;
            pattern: RecognizedPattern;
            trend: MarketTrendState;
            confidence: number;
        } | null = null;

        allTelemetry.forEach((t, sym) => {
            if (t.primaryPattern && t.primaryPattern.favoredStrategy !== 'HOLD') {
                const conf = t.primaryPattern.confidence;
                if (conf >= this.config.minConfidence) {
                    if (!bestOpportunity || conf > bestOpportunity.confidence) {
                        bestOpportunity = {
                            symbol: sym,
                            pattern: t.primaryPattern,
                            trend: t.trendState,
                            confidence: conf,
                        };
                    }
                }
            }
        });

        if (!bestOpportunity) {
            if (this.state.status !== 'SCANNING') {
                this.state.status = 'SCANNING';
                this.notifySubscribers();
            }
            return;
        }

        const opp = bestOpportunity as {
            symbol: string;
            pattern: RecognizedPattern;
            trend: MarketTrendState;
            confidence: number;
        };

        const mLabel = SUPPORTED_VOLATILITY_MARKETS.find(m => m.symbol === opp.symbol)?.label || opp.symbol;
        this.state.activeMarket = opp.symbol;
        this.state.activeMarketLabel = mLabel;
        this.state.activeTrend = opp.trend;
        this.state.activePattern = opp.pattern;

        // Check if strategy matches user configuration filter
        const strat = opp.pattern.favoredStrategy;
        const family = this.config.strategyFamily;

        if (family === 'ELITE_PRO_OVER_UNDER' && strat !== 'UNDER_6' && strat !== 'OVER_3') return;
        if (family === 'POVERTY_HUNTER_DIFFERS' && strat !== 'DIFFERS') return;
        if (family === 'AUTO_EO' && strat !== 'EVEN_ODD') return;

        // If in advisory mode, just update status and thoughts
        if (this.config.mode === 'advisory_signals_only') {
            this.state.status = 'WAITING_TRIGGER';
            this.logThought(`[Signal Advisory] ${mLabel} setup: ${opp.pattern.description}`);
            this.notifySubscribers();
            return;
        }

        // Execute Autonomous Trade
        await this.executeAutonomousTrade(opp.symbol, mLabel, opp.pattern);
    }

    private async executeAutonomousTrade(
        symbol: string,
        label: string,
        pattern: RecognizedPattern
    ): Promise<void> {
        this.isExecutingTrade = true;
        this.lastTradeTime = Date.now();
        this.state.status = 'EXECUTING';

        const stake = this.state.currentStake;
        const duration = this.config.tickDuration;

        let contractType = 'DIGITUNDER';
        let barrier = '6';

        if (pattern.favoredStrategy === 'OVER_3') {
            contractType = 'DIGITOVER';
            barrier = '3';
        } else if (pattern.favoredStrategy === 'DIFFERS') {
            contractType = 'DIGITDIFF';
            barrier = String(pattern.recommendedPrediction ?? '4');
        } else if (pattern.favoredStrategy === 'EVEN_ODD') {
            contractType = pattern.recommendedPrediction === 'EVEN' ? 'DIGITEVEN' : 'DIGITODD';
            barrier = '';
        }

        this.logThought(
            `🚀 Placing ${contractType} on ${label} (Stake: $${stake.toFixed(2)}, Reason: ${pattern.description})`
        );

        if (this.config.toastAlerts) {
            toast.info(`🚀 AI Executed Trade: ${label} ${contractType} | Stake: $${stake.toFixed(2)}`, {
                autoClose: 2500,
                hideProgressBar: true,
            });
        }

        try {
            const proposal = {
                amount: stake,
                basis: 'stake',
                contract_type: contractType,
                currency: 'USD',
                duration,
                duration_unit: 't',
                symbol,
                ...(barrier ? { barrier } : {}),
            };

            const buyRes = await buyContractForUi({
                parameters: proposal,
                price: stake,
                source: 'GLOBAL_AI_AUTOTRADER',
            });
            const contractId = buyRes?.contract_id;

            if (!contractId) {
                throw new Error('Failed to obtain contract ID from Deriv API.');
            }

            // Stream and await contract settlement
            const settledContract = await streamContractUntilSettled({
                contractId: Number(contractId),
                source: 'GLOBAL_AI_AUTOTRADER',
                onUpdate: (c: Record<string, any>) => {
                    this.pushToGlobalTransactions(c);
                },
            });

            const profit = Number(settledContract?.profit ?? 0);
            const isWin = profit >= 0;

            this.pushToGlobalTransactions(settledContract);

            // Record into continuous learning reinforcement engine
            aiContinuousLearningService.recordBotTrade({
                botName: 'ELITE_PRO',
                strategy: pattern.favoredStrategy,
                market: symbol,
                contractType,
                barrier,
                isWin,
                profit,
                stake,
            });

            if (isWin) {
                this.state.wins++;
                this.state.consecutiveLosses = 0;
                this.state.totalProfit = Number((this.state.totalProfit + profit).toFixed(2));
                this.state.currentStake = this.config.stake; // Reset to base stake on win

                this.logThought(`🎉 WIN +$${profit.toFixed(2)} on ${label} ${contractType}! Total Profit: $${this.state.totalProfit.toFixed(2)}`);
                if (this.config.toastAlerts) {
                    toast.success(`🎉 WIN +$${profit.toFixed(2)} [${label}]! Total: $${this.state.totalProfit.toFixed(2)}`);
                }
            } else {
                this.state.losses++;
                this.state.consecutiveLosses++;
                this.state.totalProfit = Number((this.state.totalProfit + profit).toFixed(2));
                // Apply 2.6x Martingale multiplier
                const nextStake = Number((this.state.currentStake * this.config.martingale).toFixed(2));
                this.state.currentStake = Math.max(this.config.stake, nextStake);

                this.logThought(
                    `🛡️ LOSS -$${Math.abs(profit).toFixed(2)} on ${label}. Martingale next stake: $${this.state.currentStake.toFixed(2)}`
                );
                if (this.config.toastAlerts) {
                    toast.warn(`🛡️ LOSS -$${Math.abs(profit).toFixed(2)} [${label}]. Applying Martingale $${this.state.currentStake.toFixed(2)}`);
                }
            }

            const totalTrades = this.state.wins + this.state.losses;
            this.state.winRate = Math.round((this.state.wins / (totalTrades || 1)) * 100);

            if (this.state.isRunning) {
                this.state.status = 'SCANNING';
            }
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            console.error('[AiGlobalAutoTrader] Trade execution error:', msg);
            this.logThought(`⚠️ Execution Notice: ${msg}`);
            if (this.state.isRunning) {
                this.state.status = 'SCANNING';
            }
        } finally {
            this.isExecutingTrade = false;
            this.notifySubscribers();
        }
    }

    private pushToGlobalTransactions(contractData: Record<string, unknown>): void {
        try {
            globalObserver.emit('bot.contract', contractData);
        } catch {}
    }

    // ─────────────────────────────────────────────────────────────────────────
    // PERSISTENCE
    // ─────────────────────────────────────────────────────────────────────────

    private saveConfig(): void {
        try {
            if (typeof localStorage !== 'undefined') {
                localStorage.setItem(STORAGE_KEY_GLOBAL_AI_CONFIG, JSON.stringify(this.config));
            }
        } catch {}
    }

    private loadConfig(): void {
        try {
            if (typeof localStorage !== 'undefined') {
                const raw = localStorage.getItem(STORAGE_KEY_GLOBAL_AI_CONFIG);
                if (raw) {
                    this.config = { ...this.config, ...JSON.parse(raw) };
                }
            }
        } catch {}
    }
}

export const aiGlobalAutoTraderService = new AiGlobalAutoTraderEngine();

try {
    if (typeof window !== 'undefined') {
        aiGlobalAutoTraderService.init();
    }
} catch {}
