import { buyContractForUi, streamContractUntilSettled } from '@/utils/trade-purchase';
import {
    AutoTradingConfig,
    SignalEvaluation,
    TimeframeAnalysis,
    TimeframeKey,
    TransactionCardData,
} from '../types';

export interface ExecutionStats {
    totalTrades: number;
    wins: number;
    losses: number;
    winRate: number;
    totalProfit: number;
    consecutiveLosses: number;
    isPaused: boolean;
    pauseReason?: string;
    currentStake?: number;
    martingaleStep?: number;
}

export type TExecutionListener = (event: {
    transaction: TransactionCardData;
    stats: ExecutionStats;
}) => void;

export class ExecutionService {
    private isExecuting: boolean = false;
    private lastTradeTime: number = 0;
    private consecutiveLossCount: number = 0;
    private totalTradesCount: number = 0;
    private totalWinsCount: number = 0;
    private totalLossesCount: number = 0;
    private accumulatedProfit: number = 0;
    private isPausedByRisk: boolean = false;
    private pauseReason: string = '';
    private listeners: Set<TExecutionListener> = new Set();

    public subscribe(listener: TExecutionListener): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    public getNextStake(config: AutoTradingConfig): number {
        if (!config.useMartingale || this.consecutiveLossCount === 0) {
            return config.stake;
        }
        const mult = config.martingaleMultiplier || 2.1;
        const calculated = config.stake * Math.pow(mult, this.consecutiveLossCount);
        return Math.max(0.35, Number(calculated.toFixed(2)));
    }

    public getMartingaleStep(): number {
        return this.consecutiveLossCount + 1;
    }

    public getConsecutiveLossCount(): number {
        return this.consecutiveLossCount;
    }

    public getStats(config?: AutoTradingConfig): ExecutionStats {
        const winRate =
            this.totalTradesCount > 0
                ? Number(((this.totalWinsCount / this.totalTradesCount) * 100).toFixed(1))
                : 0;

        const currentStake = config ? this.getNextStake(config) : undefined;

        return {
            totalTrades: this.totalTradesCount,
            wins: this.totalWinsCount,
            losses: this.totalLossesCount,
            winRate,
            totalProfit: Number(this.accumulatedProfit.toFixed(2)),
            consecutiveLosses: this.consecutiveLossCount,
            isPaused: this.isPausedByRisk,
            pauseReason: this.pauseReason,
            currentStake,
            martingaleStep: this.getMartingaleStep(),
        };
    }

    public resetSessionStats() {
        this.consecutiveLossCount = 0;
        this.totalTradesCount = 0;
        this.totalWinsCount = 0;
        this.totalLossesCount = 0;
        this.accumulatedProfit = 0;
        this.isPausedByRisk = false;
        this.pauseReason = '';
    }

    public getCooldownRemaining(cooldownSeconds: number): number {
        if (this.lastTradeTime === 0) return 0;
        const elapsed = (Date.now() - this.lastTradeTime) / 1000;
        return Math.max(0, Math.ceil(cooldownSeconds - elapsed));
    }

    public canExecute(config: AutoTradingConfig): { allowed: boolean; reason?: string } {
        if (this.isExecuting) {
            return { allowed: false, reason: 'Previous transaction still being processed.' };
        }

        if (this.isPausedByRisk) {
            return { allowed: false, reason: `Trading paused: ${this.pauseReason}` };
        }

        // Check Cooldown
        const cooldownRemaining = this.getCooldownRemaining(config.cooldownSeconds);
        if (cooldownRemaining > 0) {
            return {
                allowed: false,
                reason: `Cooldown active: ${cooldownRemaining}s remaining.`,
            };
        }

        // Check Max Trades
        if (config.maxTradesPerSession > 0 && this.totalTradesCount >= config.maxTradesPerSession) {
            this.isPausedByRisk = true;
            this.pauseReason = `Reached maximum session trades limit (${config.maxTradesPerSession}).`;
            return { allowed: false, reason: this.pauseReason };
        }

        // Check Consecutive Losses
        if (config.maxConsecutiveLosses > 0 && this.consecutiveLossCount >= config.maxConsecutiveLosses) {
            this.isPausedByRisk = true;
            this.pauseReason = `Reached maximum consecutive losses limit (${config.maxConsecutiveLosses}).`;
            return { allowed: false, reason: this.pauseReason };
        }

        // Check Stop Loss
        if (config.sessionStopLoss > 0 && this.accumulatedProfit <= -config.sessionStopLoss) {
            this.isPausedByRisk = true;
            this.pauseReason = `Session stop loss triggered (-$${config.sessionStopLoss}).`;
            return { allowed: false, reason: this.pauseReason };
        }

        // Check Take Profit
        if (config.sessionTakeProfit > 0 && this.accumulatedProfit >= config.sessionTakeProfit) {
            this.isPausedByRisk = true;
            this.pauseReason = `Session take profit target reached (+$${config.sessionTakeProfit}).`;
            return { allowed: false, reason: this.pauseReason };
        }

        return { allowed: true };
    }

    /**
     * Executes real Deriv Rise/Fall contract
     */
    public async executeTrade({
        direction,
        symbol,
        displayName,
        stake,
        duration,
        durationUnit,
        currency,
        signal,
        analyses,
        config,
        isManual = false,
    }: {
        direction: 'RISE' | 'FALL';
        symbol: string;
        displayName: string;
        stake: number;
        duration: number;
        durationUnit: 't' | 'm' | 's';
        currency: string;
        signal: SignalEvaluation;
        analyses: Record<TimeframeKey, TimeframeAnalysis | null>;
        config: AutoTradingConfig;
        isManual?: boolean;
    }): Promise<TransactionCardData | null> {
        if (!isManual) {
            const canRun = this.canExecute(config);
            if (!canRun.allowed) {
                console.warn(`[ExecutionService] Execution blocked: ${canRun.reason}`);
                return null;
            }
        } else if (this.isExecuting) {
            console.warn('[ExecutionService] Execution blocked: Transaction in progress.');
            return null;
        }

        const effectiveStake = isManual ? stake : this.getNextStake(config);
        this.isExecuting = true;
        this.lastTradeTime = Date.now();

        const contractType = direction === 'RISE' ? 'CALL' : 'PUT';
        const cardId = `trade_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

        const initialCard: TransactionCardData = {
            id: cardId,
            marketSymbol: symbol,
            marketDisplayName: displayName,
            direction,
            stake: effectiveStake,
            duration,
            durationUnit,
            entryPrice: analyses['1m']?.lastPrice || 0,
            entryTime: Math.floor(Date.now() / 1000),
            status: 'OPEN',
            statusMessage: `Initiating Deriv contract ($${effectiveStake.toFixed(2)}${config.useMartingale && this.consecutiveLossCount > 0 ? ` • Martingale Step ${this.consecutiveLossCount + 1}` : ''})...`,
            analysisSnapshot: {
                trend30m: analyses['30m']?.trend || 'RANGE',
                confirm15m: analyses['15m']?.confirmed ? 'CONFIRMED' : 'WAIT',
                confirm5m: analyses['5m']?.confirmed ? 'CONFIRMED' : 'WAIT',
                entry1m: analyses['1m']?.entryReady ? 'READY' : 'WAIT',
                donchianState: analyses['5m']?.donchian?.position || 'MIDDLE_CHANNEL',
                cciState: analyses['5m']?.cci?.condition || 'RANGE',
                macdState: analyses['5m']?.macd?.condition || 'NEUTRAL',
                candlestickPattern: analyses['1m']?.candle?.patternLabel || 'Standard',
                marketActivity: analyses['5m']?.activity?.label || 'HIGH ACTIVITY',
                signalState: signal.state,
                confidence: signal.confidence,
            },
        };

        this.notifyListeners(initialCard, config);

        try {
            // Purchase Contract via official trading pipeline
            initialCard.statusMessage = 'Purchasing live contract...';
            this.notifyListeners(initialCard, config);

            const buy = await buyContractForUi({
                parameters: {
                    amount: effectiveStake,
                    basis: 'stake',
                    contract_type: contractType,
                    currency: currency || 'USD',
                    duration,
                    duration_unit: durationUnit,
                    symbol,
                },
                price: effectiveStake,
                source: 'Rise & Fall Auto Trader',
            });

            initialCard.contractId = buy.contract_id;
            initialCard.transactionId = buy.transaction_id;
            initialCard.entryPrice = Number(buy.buy_price || effectiveStake);
            initialCard.statusMessage = 'Contract active — streaming live ticks...';
            this.notifyListeners(initialCard, config);

            // 3. Stream Contract Settlement
            const fallbackSnapshot = {
                buy_price: effectiveStake,
                contract_id: buy.contract_id,
                transaction_ids: { buy: buy.transaction_id },
                underlying_symbol: symbol,
                display_name: displayName,
                contract_type: contractType,
                currency: currency || 'USD',
                date_start: Math.floor(Date.now() / 1000),
            };

            const settledContract = await streamContractUntilSettled({
                contractId: Number(buy.contract_id),
                fallback: fallbackSnapshot,
                source: 'Rise & Fall Auto Trader',
                onUpdate: snapshot => {
                    if (snapshot.exit_spot) {
                        initialCard.exitPrice = Number(snapshot.exit_spot);
                    }
                    if (snapshot.bid_price) {
                        initialCard.payout = Number(snapshot.bid_price);
                    }
                    this.notifyListeners(initialCard, config);
                },
            });

            // 4. Final Result Processing
            const profit = Number(settledContract.profit ?? 0);
            const isWon = profit > 0 || settledContract.status === 'won';

            initialCard.exitPrice = Number(settledContract.exit_spot || settledContract.exit_tick || 0);
            initialCard.exitTime = settledContract.exit_tick_time || Math.floor(Date.now() / 1000);
            initialCard.payout = Number(settledContract.sell_price || settledContract.payout || 0);
            initialCard.profit = profit;
            initialCard.status = isWon ? 'WON' : 'LOST';
            initialCard.statusMessage = isWon ? 'Trade Won' : 'Trade Lost';

            // Update stats
            this.totalTradesCount++;
            if (isWon) {
                this.totalWinsCount++;
                this.consecutiveLossCount = 0;
            } else {
                this.totalLossesCount++;
                this.consecutiveLossCount++;
            }
            this.accumulatedProfit += profit;

            this.notifyListeners(initialCard, config);
            return initialCard;
        } catch (err: any) {
            console.error('[ExecutionService] Trade purchase error:', err);
            initialCard.status = 'ERROR';
            initialCard.statusMessage = err.message || 'Execution error';
            this.notifyListeners(initialCard, config);
            return initialCard;
        } finally {
            this.isExecuting = false;
        }
    }

    private notifyListeners(card: TransactionCardData, config?: AutoTradingConfig) {
        const stats = this.getStats(config);
        this.listeners.forEach(l => l({ transaction: card, stats }));
    }
}
