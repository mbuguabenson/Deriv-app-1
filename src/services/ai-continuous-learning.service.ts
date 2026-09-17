/**
 * ai-continuous-learning.service.ts
 *
 * Real-time Online / Incremental Machine Learning Engine for ProfitHub
 * 
 * Multi-Bot Neural Ingestion:
 * - Cross-trains across all 4 flagship bot systems:
 *   1. Elite Pro (Over/Under patient digit trigger patterns)
 *   2. Overlord AI (Multi-regime volatility & predictive edge)
 *   3. Poverty Hunter (Differs lowest-transition-probability edge & smart recovery)
 *   4. Auto X E/O (Even/Odd Markov parity matrix & dynamic switching)
 * 
 * Capabilities:
 * - 24/7 Machine Keep-Alive Mode via Screen Wake Lock API (navigator.wakeLock)
 * - Background tab throttle prevention using Web Worker heartbeat pulse
 * - Live 10x10 Markov Digit Transition Matrix (P(D_t | D_t-1)) with exponential recency decay
 * - 2x2 Markov Parity Transition Matrix (Even/Odd transitions)
 * - Multi-Bot Reinforcement Learning Q-Table with strategy weighting
 * - Rolling Shannon Entropy calculation to measure market randomness vs predictability
 */

import { observer as globalObserver } from '@/external/bot-skeleton/utils/observer';

export type SupportedBotName = 'ELITE_PRO' | 'OVERLORD_AI' | 'POVERTY_HUNTER' | 'AUTO_EO' | 'AUTOFLIPPER';

export interface MarkovTransitionStats {
    fromDigit: number;
    toDigit: number;
    count: number;
    probability: number; // 0.0 to 1.0 (0% to 100%)
}

export interface QPatternWeight {
    patternKey: string; // e.g., "ELITE_PRO:UNDER_6" or "POVERTY_HUNTER:DIFFERS_4"
    botName?: SupportedBotName;
    qValue: number;     // Expected value / reward score (0.0 to 1.0)
    samples: number;    // Times pattern has been tested
    winRate: number;    // % wins
}

export interface BotLearningContribution {
    botName: SupportedBotName;
    displayName: string;
    totalTrades: number;
    wins: number;
    losses: number;
    winRate: number;
    netProfit: number;
    primaryLearningDomain: string;
    learnedQScore: number;
}

export interface BotTradeRecord {
    botName: SupportedBotName;
    strategy: string;
    market: string;
    contractType: string;
    barrier?: string | number;
    prediction?: number | string;
    isWin: boolean;
    profit: number;
    stake: number;
}

export interface LiveLearningDiagnostics {
    totalTicksIngested: number;
    learningEpochs: number;
    machineModeActive: boolean;
    wakeLockActive: boolean;
    activeMarketCount: number;
    modelConfidence: number; // 0 to 100%
    shannonEntropy: number;   // 0 (pure pattern) to 3.32 (pure white noise)
    topPatternEdge: {
        pattern: string;
        edgePct: number;
        description: string;
    };
    parityMatrix: {
        evenToEven: number;
        evenToOdd: number;
        oddToEven: number;
        oddToOdd: number;
    };
    botContributions: Record<SupportedBotName, BotLearningContribution>;
}

type LearningSubscriber = (diagnostics: LiveLearningDiagnostics) => void;

const STORAGE_KEY_Q_TABLE = 'ph_ai_q_learning_table';
const STORAGE_KEY_MARKOV = 'ph_ai_markov_matrix';
const STORAGE_KEY_PARITY_MARKOV = 'ph_ai_parity_markov';
const STORAGE_KEY_TOTAL_TICKS = 'ph_ai_total_ticks_learned';
const STORAGE_KEY_BOT_STATS = 'ph_ai_bot_learning_stats';

class AiContinuousLearningEngine {
    // 10x10 Transition Matrix: transitionCounts[fromDigit][toDigit]
    private transitionCounts: number[][] = Array.from({ length: 10 }, () => new Array(10).fill(1)); // Laplace smoothing (+1)
    
    // 2x2 Parity Matrix: [0=Even, 1=Odd][0=Even, 1=Odd]
    private parityCounts: number[][] = [
        [5, 5],
        [5, 5],
    ];

    private lastSeenDigitBySymbol: Map<string, number> = new Map();

    // Reinforcement Learning Q-Table: Map<patternKey, { qValue, samples, wins, botName }>
    private qTable: Map<string, { qValue: number; samples: number; wins: number; botName?: SupportedBotName }> = new Map();

    // Per-bot contribution telemetry
    private botContributions: Record<SupportedBotName, BotLearningContribution> = {
        ELITE_PRO: {
            botName: 'ELITE_PRO',
            displayName: 'Elite Pro',
            totalTrades: 0,
            wins: 0,
            losses: 0,
            winRate: 0,
            netProfit: 0,
            primaryLearningDomain: 'Over/Under Patient Triggers',
            learnedQScore: 0.65,
        },
        OVERLORD_AI: {
            botName: 'OVERLORD_AI',
            displayName: 'Overlord AI',
            totalTrades: 0,
            wins: 0,
            losses: 0,
            winRate: 0,
            netProfit: 0,
            primaryLearningDomain: 'Multi-Regime Volatility AI',
            learnedQScore: 0.68,
        },
        POVERTY_HUNTER: {
            botName: 'POVERTY_HUNTER',
            displayName: 'Poverty Hunter',
            totalTrades: 0,
            wins: 0,
            losses: 0,
            winRate: 0,
            netProfit: 0,
            primaryLearningDomain: 'Differs Edge & Smart Recovery',
            learnedQScore: 0.62,
        },
        AUTO_EO: {
            botName: 'AUTO_EO',
            displayName: 'Auto X Even/Odd',
            totalTrades: 0,
            wins: 0,
            losses: 0,
            winRate: 0,
            netProfit: 0,
            primaryLearningDomain: 'Parity Markov Transitions',
            learnedQScore: 0.64,
        },
        AUTOFLIPPER: {
            botName: 'AUTOFLIPPER',
            displayName: 'Autoflipper Edge AI',
            totalTrades: 0,
            wins: 0,
            losses: 0,
            winRate: 0,
            netProfit: 0,
            primaryLearningDomain: 'Markov Auto-Switching Edge',
            learnedQScore: 0.67,
        },
    };

    // Diagnostics & Ingestion Tracking
    private totalTicksIngested = 0;
    private learningEpochs = 0;
    private machineModeActive = false;
    private wakeLockSentinel: any = null;
    private keepAliveWorker: Worker | null = null;
    private keepAliveInterval: any = null;
    private subscribers: Set<LearningSubscriber> = new Set();
    private isInitialized = false;

    constructor() {
        this.loadPersistedState();
    }

    public init(): void {
        if (this.isInitialized) return;
        this.isInitialized = true;
        this.loadPersistedState();
        this.attachGlobalTradeObserver();
        this.attachVisibilityWatcher();
    }

    public subscribe(cb: LearningSubscriber): () => void {
        this.subscribers.add(cb);
        cb(this.getDiagnostics());
        return () => this.subscribers.delete(cb);
    }

    private notifySubscribers(): void {
        const diag = this.getDiagnostics();
        this.subscribers.forEach(cb => {
            try {
                cb(diag);
            } catch (e) {
                console.error('[AI Learning Engine] Subscriber notification error:', e);
            }
        });
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 24/7 MACHINE KEEP-ALIVE & SCREEN WAKE LOCK
    // ─────────────────────────────────────────────────────────────────────────

    public async setMachineMode(active: boolean): Promise<boolean> {
        this.machineModeActive = active;

        if (active) {
            await this.requestWakeLock();
            this.startKeepAlivePulse();
            console.log('[AI Learning Engine] ⚡ 24/7 Machine Mode ACTIVATED across Elite, Overlord, Poverty & Auto E/O.');
        } else {
            await this.releaseWakeLock();
            this.stopKeepAlivePulse();
            console.log('[AI Learning Engine] ⏸ 24/7 Machine Mode DEACTIVATED.');
        }

        this.notifySubscribers();
        return this.isWakeLockActive();
    }

    public isMachineModeActive(): boolean {
        return this.machineModeActive;
    }

    public isWakeLockActive(): boolean {
        return Boolean(this.wakeLockSentinel && !this.wakeLockSentinel.released);
    }

    private async requestWakeLock(): Promise<void> {
        if (typeof navigator !== 'undefined' && 'wakeLock' in navigator) {
            try {
                this.wakeLockSentinel = await (navigator as any).wakeLock.request('screen');
                this.wakeLockSentinel.addEventListener('release', () => {
                    console.log('[AI Learning Engine] Wake Lock was released by browser.');
                });
            } catch (err) {
                console.warn('[AI Learning Engine] Wake Lock request was not allowed or unsupported:', err);
            }
        }
    }

    private async releaseWakeLock(): Promise<void> {
        if (this.wakeLockSentinel) {
            try {
                await this.wakeLockSentinel.release();
            } catch {}
            this.wakeLockSentinel = null;
        }
    }

    private attachVisibilityWatcher(): void {
        if (typeof document !== 'undefined') {
            document.addEventListener('visibilitychange', async () => {
                if (this.machineModeActive && document.visibilityState === 'visible') {
                    if (!this.isWakeLockActive()) {
                        await this.requestWakeLock();
                    }
                }
            });
        }
    }

    private startKeepAlivePulse(): void {
        this.stopKeepAlivePulse();
        try {
            const workerCode = `
                let interval = null;
                self.onmessage = function(e) {
                    if (e.data === 'start') {
                        if (interval) clearInterval(interval);
                        interval = setInterval(function() {
                            self.postMessage('tick');
                        }, 5000);
                    } else if (e.data === 'stop') {
                        if (interval) clearInterval(interval);
                        interval = null;
                    }
                };
            `;
            const blob = new Blob([workerCode], { type: 'application/javascript' });
            this.keepAliveWorker = new Worker(URL.createObjectURL(blob));
            this.keepAliveWorker.onmessage = () => {
                this.notifySubscribers();
            };
            this.keepAliveWorker.postMessage('start');
        } catch {
            this.keepAliveInterval = setInterval(() => {
                this.notifySubscribers();
            }, 5000);
        }
    }

    private stopKeepAlivePulse(): void {
        if (this.keepAliveWorker) {
            try {
                this.keepAliveWorker.postMessage('stop');
                this.keepAliveWorker.terminate();
            } catch {}
            this.keepAliveWorker = null;
        }
        if (this.keepAliveInterval) {
            clearInterval(this.keepAliveInterval);
            this.keepAliveInterval = null;
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // ONLINE MULTI-BOT TICK INGESTION & MARKOV PROBABILITIES
    // ─────────────────────────────────────────────────────────────────────────

    public ingestMarketTick(symbol: string, currentDigit: number): void {
        if (currentDigit < 0 || currentDigit > 9) return;

        this.totalTicksIngested++;
        const prevDigit = this.lastSeenDigitBySymbol.get(symbol);
        this.lastSeenDigitBySymbol.set(symbol, currentDigit);

        if (prevDigit !== undefined && prevDigit >= 0 && prevDigit <= 9) {
            // Exponential Recency Decay every 500 ticks
            if (this.totalTicksIngested % 500 === 0) {
                this.learningEpochs++;
                for (let r = 0; r < 10; r++) {
                    for (let c = 0; c < 10; c++) {
                        this.transitionCounts[r][c] = Math.max(1, Math.round(this.transitionCounts[r][c] * 0.95));
                    }
                }
                for (let pr = 0; pr < 2; pr++) {
                    for (let pc = 0; pc < 2; pc++) {
                        this.parityCounts[pr][pc] = Math.max(2, Math.round(this.parityCounts[pr][pc] * 0.95));
                    }
                }
            }

            // 1. Update 10x10 digit transition frequency
            this.transitionCounts[prevDigit][currentDigit]++;

            // 2. Update 2x2 parity transition frequency (0=Even, 1=Odd)
            const prevParity = prevDigit % 2 === 0 ? 0 : 1;
            const currParity = currentDigit % 2 === 0 ? 0 : 1;
            this.parityCounts[prevParity][currParity]++;
        }

        if (this.totalTicksIngested % 50 === 0) {
            this.persistState();
            this.notifySubscribers();
        }
    }

    public getMarkovMatrix(): number[][] {
        const matrix: number[][] = [];
        for (let r = 0; r < 10; r++) {
            const rowTotal = this.transitionCounts[r].reduce((sum, val) => sum + val, 0) || 1;
            matrix.push(this.transitionCounts[r].map(count => count / rowTotal));
        }
        return matrix;
    }

    public getParityMatrix(): { evenToEven: number; evenToOdd: number; oddToEven: number; oddToOdd: number } {
        const evenTotal = this.parityCounts[0][0] + this.parityCounts[0][1] || 1;
        const oddTotal = this.parityCounts[1][0] + this.parityCounts[1][1] || 1;
        return {
            evenToEven: Math.round((this.parityCounts[0][0] / evenTotal) * 100),
            evenToOdd: Math.round((this.parityCounts[0][1] / evenTotal) * 100),
            oddToEven: Math.round((this.parityCounts[1][0] / oddTotal) * 100),
            oddToOdd: Math.round((this.parityCounts[1][1] / oddTotal) * 100),
        };
    }

    // ─────────────────────────────────────────────────────────────────────────
    // CROSS-BOT PREDICTIVE ASSISTANCE
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * For POVERTY HUNTER (Differs):
     * Finds the digit with the absolute LOWEST transition probability given the current digit.
     * This provides the safest prediction barrier for DIFFERS contracts.
     */
    public getOptimalDiffersDigit(currentDigit: number): { digit: number; probability: number; rationale: string } {
        if (typeof currentDigit !== 'number' || isNaN(currentDigit) || currentDigit < 0 || currentDigit > 9) {
            return { digit: 4, probability: 0.1, rationale: 'Baseline fallback' };
        }
        const markov = this.getMarkovMatrix();
        const row = (markov && Array.isArray(markov[currentDigit])) ? markov[currentDigit] : [0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1];
        let minProb = 999;
        let lowestDigit = 0;

        row.forEach((prob, digit) => {
            if (prob < minProb) {
                minProb = prob;
                lowestDigit = digit;
            }
        });

        const probPct = Math.round(minProb * 100);
        return {
            digit: lowestDigit,
            probability: minProb,
            rationale: `AI Markov identifies digit ${lowestDigit} has only a ${probPct}% transition rate after ${currentDigit} (Lowest in distribution).`,
        };
    }

    /**
     * For AUTO X E/O (Even/Odd):
     * Determines whether Even or Odd is statistically favored given current digit parity.
     */
    public getParityPrediction(currentDigit: number): { recommendation: 'EVEN' | 'ODD'; confidence: number; evenProb: number; oddProb: number } {
        const matrix = this.getParityMatrix();
        const isCurrentEven = typeof currentDigit === 'number' && !isNaN(currentDigit) ? currentDigit % 2 === 0 : true;

        const evenProb = isCurrentEven ? matrix.evenToEven : matrix.oddToEven;
        const oddProb = isCurrentEven ? matrix.evenToOdd : matrix.oddToOdd;

        const recommendation = evenProb >= oddProb ? 'EVEN' : 'ODD';
        const confidence = Math.max(evenProb, oddProb);

        return {
            recommendation,
            confidence,
            evenProb,
            oddProb,
        };
    }

    /**
     * For ELITE PRO & OVERLORD AI (Over/Under):
     * Determines whether Under 6 or Over 3 has higher conditional transition probability.
     */
    public getOverUnderPrediction(currentDigit: number): { recommendation: 'UNDER_6' | 'OVER_3'; confidence: number; underProb: number; overProb: number } {
        if (typeof currentDigit !== 'number' || isNaN(currentDigit) || currentDigit < 0 || currentDigit > 9) {
            return { recommendation: 'UNDER_6', confidence: 60, underProb: 60, overProb: 60 };
        }
        const markov = this.getMarkovMatrix();
        const row = (markov && Array.isArray(markov[currentDigit])) ? markov[currentDigit] : [0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1];
        // Under 6 = digits 0, 1, 2, 3, 4, 5
        const underSum = row.slice(0, 6).reduce((s, p) => s + p, 0);
        // Over 3 = digits 4, 5, 6, 7, 8, 9
        const overSum = row.slice(4, 10).reduce((s, p) => s + p, 0);

        const underProb = Math.round(underSum * 100);
        const overProb = Math.round(overSum * 100);

        return {
            recommendation: underProb >= overProb ? 'UNDER_6' : 'OVER_3',
            confidence: Math.max(underProb, overProb),
            underProb,
            overProb,
        };
    }

    // ─────────────────────────────────────────────────────────────────────────
    // MULTI-BOT REINFORCEMENT LEARNING (RECORDING ALL 4 BOTS)
    // ─────────────────────────────────────────────────────────────────────────

    public recordBotTrade(trade: BotTradeRecord): void {
        const { botName, strategy, market, contractType, barrier, prediction, isWin, profit, stake } = trade;
        if (!botName) return;

        // 1. Update Per-Bot Contribution Telemetry
        const botStat = this.botContributions[botName] || {
            botName,
            displayName: botName,
            totalTrades: 0,
            wins: 0,
            losses: 0,
            winRate: 0,
            netProfit: 0,
            primaryLearningDomain: 'Multi-Strategy Bot',
            learnedQScore: 0.5,
        };

        botStat.totalTrades++;
        if (isWin) {
            botStat.wins++;
        } else {
            botStat.losses++;
        }
        botStat.netProfit = Number((botStat.netProfit + profit).toFixed(2));
        botStat.winRate = Math.round((botStat.wins / (botStat.totalTrades || 1)) * 100);

        // 2. Update Specific Q-Learning Pattern Key
        const specificKey = `${botName}:${strategy}_${barrier || prediction || 'DEFAULT'}`;
        const generalizedKey = `${contractType}_${barrier || ''}`;

        this.updateQValue(specificKey, isWin ? 1.0 : -1.0, profit, botName);
        this.updateQValue(generalizedKey, isWin ? 1.0 : -1.0, profit, botName);

        // 3. Compute Composite Learned Q-Score for the Bot
        const botWeights = this.getQTableWeights().filter(w => w.patternKey.startsWith(botName));
        if (botWeights.length > 0) {
            const avgQ = botWeights.reduce((sum, w) => sum + w.qValue, 0) / botWeights.length;
            botStat.learnedQScore = Number(avgQ.toFixed(3));
        }

        this.botContributions[botName] = botStat;
        this.persistState();
        this.notifySubscribers();
    }

    private attachGlobalTradeObserver(): void {
        try {
            globalObserver.register('bot.contract', (contract: any) => {
                if (!contract || !contract.is_sold) return;
                const profit = Number(contract.profit ?? 0);
                const isWin = profit >= 0;

                const contractType = contract.contract_type || '';
                const barrier = contract.barrier || '';

                const patternKey = `${contractType}_${barrier}`;
                this.updateQValue(patternKey, isWin ? 1.0 : -1.0, profit);
            });
        } catch (e) {
            console.warn('[AI Learning Engine] Global contract observer attach error:', e);
        }
    }

    public updateQValue(patternKey: string, reward: number, profitAmount = 0, botName?: SupportedBotName): void {
        if (!patternKey) return;
        const current = this.qTable.get(patternKey) || { qValue: 0.5, samples: 0, wins: 0, botName };
        const alpha = 0.15; // Learning Rate

        const newQValue = current.qValue + alpha * (reward > 0 ? 1 : 0 - current.qValue);
        const newSamples = current.samples + 1;
        const newWins = current.wins + (reward > 0 ? 1 : 0);

        this.qTable.set(patternKey, {
            qValue: Math.max(0, Math.min(1, newQValue)),
            samples: newSamples,
            wins: newWins,
            botName: botName || current.botName,
        });

        this.persistState();
        this.notifySubscribers();
    }

    public getQTableWeights(): QPatternWeight[] {
        const list: QPatternWeight[] = [];
        this.qTable.forEach((val, key) => {
            list.push({
                patternKey: key,
                botName: val.botName,
                qValue: Number(val.qValue.toFixed(3)),
                samples: val.samples,
                winRate: val.samples > 0 ? Math.round((val.wins / val.samples) * 100) : 50,
            });
        });
        return list.sort((a, b) => b.qValue - a.qValue);
    }

    public getBotContributions(): Record<SupportedBotName, BotLearningContribution> {
        return this.botContributions;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // STATISTICAL DIAGNOSTICS & ENTROPY
    // ─────────────────────────────────────────────────────────────────────────

    public getDiagnostics(): LiveLearningDiagnostics {
        const matrix = this.getMarkovMatrix();
        const parity = this.getParityMatrix();

        // Shannon Entropy calculation
        let entropySum = 0;
        let validRows = 0;
        for (let r = 0; r < 10; r++) {
            let rowEntropy = 0;
            for (let c = 0; c < 10; c++) {
                const p = matrix[r][c];
                if (p > 0) {
                    rowEntropy += -p * Math.log2(p);
                }
            }
            entropySum += rowEntropy;
            validRows++;
        }
        const avgEntropy = Number((entropySum / (validRows || 1)).toFixed(2));
        const confidence = Math.min(99, Math.max(45, Math.round(100 - (avgEntropy / 3.32) * 55)));

        // Top statistical transition edge
        let topFrom = 0;
        let topTo = 0;
        let topProb = 0;
        for (let r = 0; r < 10; r++) {
            for (let c = 0; c < 10; c++) {
                if (matrix[r][c] > topProb) {
                    topProb = matrix[r][c];
                    topFrom = r;
                    topTo = c;
                }
            }
        }

        const edgePct = Math.round(topProb * 100);

        return {
            totalTicksIngested: this.totalTicksIngested,
            learningEpochs: this.learningEpochs,
            machineModeActive: this.machineModeActive,
            wakeLockActive: this.isWakeLockActive(),
            activeMarketCount: this.lastSeenDigitBySymbol.size,
            modelConfidence: confidence,
            shannonEntropy: avgEntropy,
            topPatternEdge: {
                pattern: `Digit ${topFrom} ➔ Digit ${topTo}`,
                edgePct,
                description: `When digit ${topFrom} appears, digit ${topTo} follows with ${edgePct}% probability (Baseline: 10%).`,
            },
            parityMatrix: parity,
            botContributions: this.botContributions,
        };
    }

    public resetLearnedWeights(): void {
        this.transitionCounts = Array.from({ length: 10 }, () => new Array(10).fill(1));
        this.parityCounts = [
            [5, 5],
            [5, 5],
        ];
        this.qTable.clear();
        this.totalTicksIngested = 0;
        this.learningEpochs = 0;
        (Object.keys(this.botContributions) as SupportedBotName[]).forEach(k => {
            if (this.botContributions[k]) {
                this.botContributions[k].totalTrades = 0;
                this.botContributions[k].wins = 0;
                this.botContributions[k].losses = 0;
                this.botContributions[k].winRate = 0;
                this.botContributions[k].netProfit = 0;
                this.botContributions[k].learnedQScore = 0.5;
            }
        });
        this.persistState();
        this.notifySubscribers();
    }

    // ─────────────────────────────────────────────────────────────────────────
    // PERSISTENCE
    // ─────────────────────────────────────────────────────────────────────────

    private persistState(): void {
        try {
            if (typeof localStorage !== 'undefined') {
                localStorage.setItem(STORAGE_KEY_MARKOV, JSON.stringify(this.transitionCounts));
                localStorage.setItem(STORAGE_KEY_PARITY_MARKOV, JSON.stringify(this.parityCounts));
                localStorage.setItem(STORAGE_KEY_Q_TABLE, JSON.stringify(Array.from(this.qTable.entries())));
                localStorage.setItem(STORAGE_KEY_TOTAL_TICKS, String(this.totalTicksIngested));
                localStorage.setItem(STORAGE_KEY_BOT_STATS, JSON.stringify(this.botContributions));
            }
        } catch {}
    }

    private loadPersistedState(): void {
        try {
            if (typeof localStorage !== 'undefined') {
                const rawMarkov = localStorage.getItem(STORAGE_KEY_MARKOV);
                if (rawMarkov) {
                    const parsed = JSON.parse(rawMarkov);
                    if (Array.isArray(parsed) && parsed.length === 10) {
                        this.transitionCounts = parsed;
                    }
                }

                const rawParity = localStorage.getItem(STORAGE_KEY_PARITY_MARKOV);
                if (rawParity) {
                    const parsedParity = JSON.parse(rawParity);
                    if (Array.isArray(parsedParity) && parsedParity.length === 2) {
                        this.parityCounts = parsedParity;
                    }
                }

                const rawQ = localStorage.getItem(STORAGE_KEY_Q_TABLE);
                if (rawQ) {
                    const entries = JSON.parse(rawQ);
                    if (Array.isArray(entries)) {
                        this.qTable = new Map(entries);
                    }
                }

                const rawTicks = localStorage.getItem(STORAGE_KEY_TOTAL_TICKS);
                if (rawTicks) {
                    this.totalTicksIngested = parseInt(rawTicks, 10) || 0;
                    this.learningEpochs = Math.floor(this.totalTicksIngested / 500);
                }

                const rawBots = localStorage.getItem(STORAGE_KEY_BOT_STATS);
                if (rawBots) {
                    const parsedBots = JSON.parse(rawBots);
                    if (parsedBots && typeof parsedBots === 'object') {
                        this.botContributions = {
                            ...this.botContributions,
                            ...parsedBots,
                        };
                    }
                }
            }
        } catch {}
    }
}

export const aiContinuousLearningService = new AiContinuousLearningEngine();

try {
    if (typeof window !== 'undefined') {
        aiContinuousLearningService.init();
    }
} catch {}
