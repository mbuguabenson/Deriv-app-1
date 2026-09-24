export type TimeframeKey = '30m' | '15m' | '5m' | '1m';

export interface Candle {
    epoch: number;
    open: number;
    high: number;
    low: number;
    close: number;
}

export interface DonchianResult {
    upper: number;
    middle: number;
    lower: number;
    position: 'UPPER_CHANNEL' | 'MIDDLE_CHANNEL' | 'LOWER_CHANNEL';
    distanceToUpperPct: number;
    distanceToLowerPct: number;
    distanceToMiddlePct: number;
    isUpperBreakout: boolean;
    isLowerBreakout: boolean;
    isUpperRejection: boolean;
    isLowerRejection: boolean;
}

export type CCICondition =
    | 'STRONG_BULLISH'
    | 'BULLISH_EXHAUSTION'
    | 'RANGE'
    | 'STRONG_BEARISH'
    | 'BEARISH_EXHAUSTION'
    | 'REVERSAL_CONFIRMING';

export interface CCIResult {
    value: number;
    previousValue: number;
    condition: CCICondition;
    isPotentialBullishReversal: boolean;
    isPotentialBearishReversal: boolean;
    isConfirmedBullishReversal: boolean;
    isConfirmedBearishReversal: boolean;
    slope: 'RISING' | 'FALLING' | 'FLAT';
}

export type MACDCondition =
    | 'BULLISH_MOMENTUM'
    | 'BEARISH_MOMENTUM'
    | 'MOMENTUM_WEAKENING'
    | 'NEUTRAL';

export interface MACDResult {
    macd: number;
    signal: number;
    histogram: number;
    previousHistogram: number;
    condition: MACDCondition;
    isBullishCross: boolean;
    isBearishCross: boolean;
    isAboveZero: boolean;
    isHistogramExpanding: boolean;
}

export interface MarketActivity {
    index: number; // 0 to 100
    level: 'HIGH_ACTIVITY' | 'LOW_ACTIVITY';
    label: string;
    atr: number;
    avgCandleRange: number;
    currentRange: number;
    tickFrequency: number;
    isTradable: boolean;
}

export type CandlePatternName =
    | 'DOJI'
    | 'HAMMER'
    | 'INVERTED_HAMMER'
    | 'SHOOTING_STAR'
    | 'HANGING_MAN'
    | 'BULLISH_ENGULFING'
    | 'BEARISH_ENGULFING'
    | 'INSIDE_BAR'
    | 'OUTSIDE_BAR'
    | 'STRONG_BULLISH_CANDLE'
    | 'STRONG_BEARISH_CANDLE'
    | 'LONG_UPPER_WICK'
    | 'LONG_LOWER_WICK'
    | 'REJECTION_CANDLE'
    | 'BREAKOUT_CANDLE'
    | 'CONTINUATION_CANDLE'
    | 'NEUTRAL_CANDLE';

export interface CandleAnalysis {
    pattern: CandlePatternName;
    patternLabel: string;
    isBullish: boolean;
    isBearish: boolean;
    bodySize: number;
    upperWick: number;
    lowerWick: number;
    range: number;
    bodyRatio: number;
    closePosition: 'STRONG_BULLISH_CLOSE' | 'STRONG_BEARISH_CLOSE' | 'MIDDLE_CLOSE' | 'UPPER_WICK_REJECTION' | 'LOWER_WICK_REJECTION';
    closePositionLabel: string;
    contextQuality: 'HIGH' | 'MEDIUM' | 'LOW';
    contextDescription: string;
}

export interface PriceZone {
    type: 'SUPPORT' | 'RESISTANCE' | 'BREAKOUT_ZONE' | 'REVERSAL_ZONE' | 'RANGE_ZONE';
    label: string;
    high: number;
    low: number;
    price: number;
    strength: number; // 1 to 5
}

export interface TimeframeAnalysis {
    timeframe: TimeframeKey;
    trend: 'BULLISH' | 'BEARISH' | 'RANGE';
    confirmed: boolean;
    entryReady: boolean;
    donchian: DonchianResult | null;
    cci: CCIResult | null;
    macd: MACDResult | null;
    candle: CandleAnalysis | null;
    activity: MarketActivity | null;
    lastPrice: number;
}

export type SignalState =
    | 'WAIT'
    | 'RISE_WATCH'
    | 'FALL_WATCH'
    | 'RISE_SIGNAL'
    | 'FALL_SIGNAL'
    | 'STRONG_RISE_SETUP'
    | 'STRONG_FALL_SETUP'
    | 'NO_TRADE';

export type TrendStructure =
    | 'BULLISH_CONTINUATION'
    | 'BEARISH_CONTINUATION'
    | 'POTENTIAL_BULLISH_REVERSAL'
    | 'BULLISH_REVERSAL_CONFIRMED'
    | 'POTENTIAL_BEARISH_REVERSAL'
    | 'BEARISH_REVERSAL_CONFIRMED'
    | 'NEUTRAL_RANGE';

export interface DebugCheckItem {
    id: string;
    name: string;
    status: 'PASS' | 'FAIL' | 'WARN';
    weight: number;
    details: string;
}

export interface SignalEvaluation {
    state: SignalState;
    direction: 'RISE' | 'FALL' | 'NONE';
    confidence: number; // 0 to 100
    structure: TrendStructure;
    reasons: string[];
    conflictReason?: string;
    isExecutionReady: boolean;
    debugChecks: DebugCheckItem[];
    evaluatedAt: number;
}

export interface AutoTradingConfig {
    enabled: boolean;
    stake: number;
    duration: number;
    durationUnit: 't' | 'm' | 's';
    maxTradesPerSession: number;
    maxConsecutiveLosses: number;
    sessionStopLoss: number;
    sessionTakeProfit: number;
    minConfidence: number; // e.g. 65
    cooldownSeconds: number; // e.g. 6
    pauseOnLowActivity: boolean;
    useMartingale: boolean;
    martingaleMultiplier: number; // e.g. 2.1
}

export interface TradeAnalysisSnapshot {
    trend30m: string;
    confirm15m: string;
    confirm5m: string;
    entry1m: string;
    donchianState: string;
    cciState: string;
    macdState: string;
    candlestickPattern: string;
    marketActivity: string;
    signalState: SignalState;
    confidence: number;
}

export interface TransactionCardData {
    id: string;
    contractId?: number | string;
    transactionId?: number | string;
    marketSymbol: string;
    marketDisplayName: string;
    direction: 'RISE' | 'FALL';
    stake: number;
    duration: number;
    durationUnit: string;
    entryPrice: number;
    entryTime: number;
    exitPrice?: number;
    exitTime?: number;
    payout?: number;
    profit?: number;
    balanceAfter?: number;
    status: 'OPEN' | 'WON' | 'LOST' | 'ERROR';
    statusMessage?: string;
    analysisSnapshot: TradeAnalysisSnapshot;
}

export interface SignalHistoryItem {
    id: string;
    timestamp: number;
    timeString: string;
    market: string;
    direction: 'RISE' | 'FALL' | 'WAIT';
    signalType: string;
    timeframe: string;
    confidence: number;
    executed: boolean;
    result?: 'WON' | 'LOST' | 'SKIPPED';
    profit?: number;
}

export interface MarketSymbolInfo {
    symbol: string;
    displayName: string;
    market: string;
    submarket: string;
    category: 'volatility' | 'forex' | 'other';
    isOpen: boolean;
    pipSize: number;
}

export interface DetectedCandlePattern {
    index: number;
    epoch: number;
    candle: Candle;
    analysis: CandleAnalysis;
}

export interface MarketTrendSummary {
    direction: 'STRONG_BULLISH' | 'BULLISH' | 'RANGE' | 'BEARISH' | 'STRONG_BEARISH';
    label: string;
    strength: number; // 0 to 100
    slope: 'UP' | 'DOWN' | 'FLAT';
    timeframeConfluence: string;
    description: string;
}

export interface EntryExitSuggestion {
    entryAction: 'ENTER_NOW' | 'ENTER_NEXT_CANDLE' | 'WAIT_PULLBACK' | 'WAIT_SETUP';
    entryLabel: string;
    candleCountdownSeconds: number;
    suggestedDuration: number;
    suggestedDurationUnit: 't' | 'm' | 's';
    durationLabel: string;
    rationale: string;
}

export interface BestMarketOpportunity {
    symbol: string;
    displayName: string;
    trend: 'STRONG_BULLISH' | 'BULLISH' | 'RANGE' | 'BEARISH' | 'STRONG_BEARISH';
    direction: 'RISE' | 'FALL' | 'WAIT';
    confidence: number;
    reason: string;
}


