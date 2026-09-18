// ─── B254 Unified Trading Suite Types & Interfaces ──────────────────────────────

export type StrategyDirection = 'UNDER_6' | 'OVER_3';
export type TargetStrategyChoice = 'UNDER_6' | 'OVER_3' | 'AUTO';
export type B254AutoState = 'IDLE' | 'SCANNING' | 'WAITING_TRIGGER' | 'TRADING' | 'PAUSED';

export type RegimeStatus = 'STABLE_UNDER' | 'STABLE_OVER' | 'SHIFTING' | 'NEUTRAL' | 'UNDER_BIAS_FORMING' | 'OVER_BIAS_FORMING';
export type HorizonBias = 'UNDER' | 'OVER' | 'BALANCED' | 'SHIFTING' | 'STABLE' | 'WEAKENING' | 'STRENGTHENING';

export interface B254MarketData {
    symbol: string;
    label: string;
    pip: number;
    digits: number[];
    currentPrice: string;
    lastDigit: number;
    tickCount: number;
    lastTickTime: number;
}

export interface DigitPowerItem {
    digit: number;
    count1000: number;
    pct1000: number;
    count50: number;
    pct50: number;
    trend: 'INCREASING' | 'DECREASING' | 'STABLE';
    strength: number; // 0-100
    isOutlierSafeUnder: boolean; // digits 7,8,9 < 10% & non-increasing
    isOutlierSafeOver: boolean; // digits 0,1,2 < 10% & non-increasing
}

export interface HorizonStats {
    total: number;
    under04: number;
    over59: number;
    pctUnder04: number;
    pctOver59: number;
    under05: number;
    over49: number;
    pctUnder05: number;
    pctOver49: number;
    bias: HorizonBias;
}

export interface MultiHorizonBreakdown {
    h15: HorizonStats;
    h30: HorizonStats;
    h50: HorizonStats;
    h100: HorizonStats;
    h500: HorizonStats;
    h1000: HorizonStats;
    history30m: {
        pctUnder: number;
        pctOver: number;
        bias: 'UNDER' | 'OVER' | 'NEUTRAL';
        isAlignedWith50t: boolean;
    };
    history1h: {
        pctUnder: number;
        pctOver: number;
        bias: 'UNDER' | 'OVER' | 'NEUTRAL';
        isAlignedWith50t: boolean;
    };
}

export interface RegimeAssessment {
    currentRegime: 'UNDER' | 'OVER' | 'NEUTRAL';
    previousRegime: 'UNDER' | 'OVER' | 'NEUTRAL';
    regimeStability: 'HIGH' | 'MODERATE' | 'UNSTABLE';
    shiftDetected: boolean;
    shiftDirection: 'FLIPPED_TO_OVER' | 'FLIPPED_TO_UNDER' | 'NONE';
    shiftStrength: number; // 0 - 100
    recentShiftMessage?: string;
}

export interface SignalScoreBreakdown {
    totalScore: number; // 0 - 100
    isPassedThreshold: boolean;
    threshold: number; // default 75
    components: {
        historicalBiasScore: number; // Max 20
        history30mScore: number;     // Max 10
        history1hScore: number;      // Max 10
        fiftyTickScore: number;      // Max 15
        thirtyTickScore: number;     // Max 10
        tenTickScore: number;        // Max 10
        sevenTickScore: number;      // Max 10
        outlierFilterScore: number;  // Max 10
        entryDigitScore: number;     // Max 5
    };
    explanations: string[];
}

export interface B254ConditionChecklist {
    // Condition 0: 30m & 1h Market History Alignment
    cond0_historyAlignment: boolean;
    // Condition 1: Under 0-4 (or Over 5-9) > 55% & increasing
    cond1_stat1_threshold55: boolean;
    // Condition 2: Under 0-5 (or Over 4-9) dominance
    cond2_stat2_dominance: boolean;
    // Condition 3: Last 10 ticks 7/10 rule
    cond3_micro10_ratio: boolean;
    // Condition 4: Last 7 ticks continuation
    cond4_micro7_continuation: boolean;
    // Condition 5: Outliers < 10% & non-increasing
    cond5_outlierSafety: boolean;
    // Condition 6: Digit power distribution supports direction
    cond6_digitPowerSupport: boolean;
    // Condition 7: Strongest qualifying entry digit match
    cond7_entryDigitMatch: boolean;
    // 15-tick cycle stability (no regime shift)
    cycleStable: boolean;
    allConditionsPassed: boolean;
}

export interface B254SignalResult {
    direction: StrategyDirection;
    prediction: number; // 6 for Under, 3 for Over
    entryDigit: number;
    score: SignalScoreBreakdown;
    checklist: B254ConditionChecklist;
    status: 'WAITING' | 'ENTRY_READY' | 'TRIGGERED';
    isAutoPaused: boolean;
    pauseReason?: string;
    whyNotTradeReasons: string[];
    marketExplanation: string;
}

export type ChallengeTimeUnit = 'DAYS' | 'HOURS' | 'MINUTES';

export interface CompoundingConfig {
    challengeName?: string;
    startBalance: number;
    targetBalance: number;
    durationValue: number; // e.g. 30, 24, 60
    timeUnit: ChallengeTimeUnit; // 'DAYS' | 'HOURS' | 'MINUTES'
    days: number; // Backward-compatibility alias
    stakeType: 'FIXED' | 'PERCENTAGE' | 'COMPOUNDING';
    baseStake: number; // User input stake amount
    stakePercentage: number; // Capital % calculation
    enableMartingale: boolean;
    martingaleMultiplier: number;
    maxStake: number;
    dailyTakeProfit: number;
    dailyStopLoss: number;
    sessionTakeProfit: number;
    sessionStopLoss: number;
    maxConsecutiveLosses: number;
    maxTradesPerSession: number;
    signalScoreThreshold: number;
    reanalysisIntervalMinutes: number;
    sessionDurationMinutes: number;
    sessionStartTime: string; // e.g. "22:00"
}

export interface CompoundingProgress {
    requiredStepGrowthPct: number;
    stepTargetBalance: number;
    actualBalance: number;
    differenceFromTarget: number;
    progressPct: number;
    currentStep: number;
    totalSteps: number;
    timeUnit: ChallengeTimeUnit;
    unitLabel: string;
    remainingTarget: number;
    requiredFutureGrowthPct: number;
    schedule: Array<{
        step: number;
        stepNumber?: number;
        day?: number;
        stepLabel: string;
        startBal: number;
        targetProfit: number;
        endBal: number;
        isCompleted: boolean;
    }>;
    // Backward-compatibility aliases
    requiredDailyGrowthPct: number;
    dailyTargetBalance: number;
    currentTradingDay: number;
}

export interface SessionState {
    isActive: boolean;
    startTime: number | null;
    endTime: number | null;
    sessionDurationSeconds: number;
    timeRemainingSeconds: number;
    nextReanalysisCountdownSeconds: number;
    nextCheckpointFormatted: string;
    tradesThisSession: number;
    sessionProfit: number;
    dailyProfit: number;
    isSessionLocked: boolean;
    lockReason?: string;
}

export interface TradeConditionSnapshot {
    direction: StrategyDirection;
    prediction: number;
    entryDigit: number;
    signalScore: number;
    under04Pct: number;
    over59Pct: number;
    under05Count: number;
    over49Count: number;
    last10Ratio: string;
    last7Ratio: string;
    outlierPct: number;
    history30mBias: string;
    history1hBias: string;
    regime: string;
}

export interface B254TransactionRecord {
    id: string;
    timestamp: number;
    timeFormatted: string;
    market: string;
    symbol: string;
    direction: StrategyDirection;
    contractType: 'DIGITUNDER' | 'DIGITOVER';
    prediction: number;
    entryDigit: number;
    stake: number;
    martingaleLevel: number;
    signalScore: number;
    result: 'WIN' | 'LOSS' | 'PENDING';
    profit: number;
    balanceAfterTrade: number;
    auditSnapshot: TradeConditionSnapshot;
    durationTicks: number;
    status: 'open' | 'settled';
}
