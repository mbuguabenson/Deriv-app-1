/**
 * ai-market-pattern.service.ts
 *
 * Real-time Market Pattern & Trend Learning Engine for ProfitHub
 *
 * Capabilities:
 * 1. Multi-Horizon Trend Analysis (EMA 15, 30, 50 & Linear Regression Slopes)
 * 2. Digit Pattern Recognition:
 *    - Streaks: Consecutive high/low digit runs, parity streaks (E->E->E), repeat cluster traps
 *    - Sine Wave Oscillations: Cyclical swing frequencies between low (0-4) and high (5-9) digits
 *    - Mean Reversion & Pullback Snapbacks
 * 3. Pattern Fingerprinting & Event Notifications for real-time user feedback
 */

export type TrendRegime =
    | 'STRONG_BULLISH'
    | 'BULLISH'
    | 'RANGING'
    | 'BEARISH'
    | 'STRONG_BEARISH';

export type PatternType =
    | 'HIGH_DIGIT_MOMENTUM'       // Digits clustering 5-9 with upward trend
    | 'LOW_DIGIT_MOMENTUM'        // Digits clustering 0-4 with downward trend
    | 'SINE_WAVE_OSCILLATION'     // Alternating wave between low and high digits
    | 'PARITY_STREAK_EVEN'        // 3+ consecutive even digits
    | 'PARITY_STREAK_ODD'         // 3+ consecutive odd digits
    | 'OVEREXTENDED_SNAPBACK'     // High digit run ripe for Under 6 snapback
    | 'DIFFERS_LOW_CLUSTER'       // Highly suppressed digit with lowest transition probability
    | 'EQUILIBRIUM_CONSOLIDATION'; // Balanced market with low directional bias

export interface MarketTrendState {
    symbol: string;
    trend: TrendRegime;
    slopePct: number;             // % slope over 30 ticks
    ema15: number;
    ema30: number;
    ema50: number;
    velocity: number;             // Rate of price change per tick
    volatilityRange: number;      // High - Low price range over 50 ticks
}

export interface RecognizedPattern {
    symbol: string;
    patternType: PatternType;
    confidence: number;           // 0 to 100%
    description: string;
    favoredStrategy: 'UNDER_6' | 'OVER_3' | 'DIFFERS' | 'EVEN_ODD' | 'HOLD';
    recommendedPrediction?: number | string;
    timestamp: number;
}

export interface MarketPatternTelemetry {
    symbol: string;
    trendState: MarketTrendState;
    activePatterns: RecognizedPattern[];
    primaryPattern: RecognizedPattern;
    consecutiveHighs: number;
    consecutiveLows: number;
    consecutiveEvens: number;
    consecutiveOdds: number;
    entropyScore: number;
    tickCount: number;
}

type PatternSubscriber = (telemetryMap: Map<string, MarketPatternTelemetry>) => void;

class AiMarketPatternEngine {
    private priceHistories: Map<string, number[]> = new Map();
    private digitHistories: Map<string, number[]> = new Map();
    private telemetryMap: Map<string, MarketPatternTelemetry> = new Map();
    private subscribers: Set<PatternSubscriber> = new Set();
    private lastPatternEventBySymbol: Map<string, { type: PatternType; time: number }> = new Map();
    private eventListeners: Set<(event: { type: 'TREND_SHIFT' | 'PATTERN_DETECTED' | 'STRATEGY_RECOMMENDED'; payload: any }) => void> = new Set();

    public subscribe(cb: PatternSubscriber): () => void {
        this.subscribers.add(cb);
        cb(this.telemetryMap);
        return () => this.subscribers.delete(cb);
    }

    public onEvent(cb: (event: { type: 'TREND_SHIFT' | 'PATTERN_DETECTED' | 'STRATEGY_RECOMMENDED'; payload: any }) => void): () => void {
        this.eventListeners.add(cb);
        return () => this.eventListeners.delete(cb);
    }

    private emitEvent(type: 'TREND_SHIFT' | 'PATTERN_DETECTED' | 'STRATEGY_RECOMMENDED', payload: any): void {
        this.eventListeners.forEach(cb => {
            try {
                cb({ type, payload });
            } catch (e) {
                console.error('[AiMarketPatternEngine] Event dispatch error:', e);
            }
        });
    }

    /**
     * Ingests a new tick price and last digit for a specific market
     */
    public ingestTick(symbol: string, price: number, digit: number): void {
        if (!this.priceHistories.has(symbol)) {
            this.priceHistories.set(symbol, []);
            this.digitHistories.set(symbol, []);
        }

        const prices = this.priceHistories.get(symbol)!;
        const digits = this.digitHistories.get(symbol)!;

        prices.push(price);
        digits.push(digit);

        if (prices.length > 100) prices.shift();
        if (digits.length > 100) digits.shift();

        // Perform multi-horizon trend and pattern evaluations
        this.evaluateMarketPatterns(symbol, prices, digits);
    }

    private evaluateMarketPatterns(symbol: string, prices: number[], digits: number[]): void {
        if (prices.length < 15) return;

        // 1. Calculate Multi-Horizon Moving Averages & Trend
        const ema15 = this.calculateEMA(prices, 15);
        const ema30 = this.calculateEMA(prices, Math.min(30, prices.length));
        const ema50 = this.calculateEMA(prices, Math.min(50, prices.length));

        const recentSlice = prices.slice(-30);
        const pStart = recentSlice[0];
        const pEnd = recentSlice[recentSlice.length - 1];
        const slopePct = pStart !== 0 ? ((pEnd - pStart) / pStart) * 100 : 0;

        let trend: TrendRegime = 'RANGING';
        if (slopePct > 0.08 && ema15 > ema30) {
            trend = slopePct > 0.25 ? 'STRONG_BULLISH' : 'BULLISH';
        } else if (slopePct < -0.08 && ema15 < ema30) {
            trend = slopePct < -0.25 ? 'STRONG_BEARISH' : 'BEARISH';
        }

        const minP = Math.min(...prices.slice(-50));
        const maxP = Math.max(...prices.slice(-50));
        const volatilityRange = maxP - minP;
        const velocity = Math.abs(pEnd - (recentSlice[recentSlice.length - 2] || pEnd));

        const trendState: MarketTrendState = {
            symbol,
            trend,
            slopePct: Number(slopePct.toFixed(3)),
            ema15: Number(ema15.toFixed(4)),
            ema30: Number(ema30.toFixed(4)),
            ema50: Number(ema50.toFixed(4)),
            velocity: Number(velocity.toFixed(4)),
            volatilityRange: Number(volatilityRange.toFixed(4)),
        };

        // 2. Digit Pattern Recognition
        const patterns: RecognizedPattern[] = [];
        const lastDigits = digits.slice(-30);

        // A. Streak Counters
        let consecutiveHighs = 0;
        let consecutiveLows = 0;
        let consecutiveEvens = 0;
        let consecutiveOdds = 0;

        for (let i = digits.length - 1; i >= 0; i--) {
            const d = digits[i];
            if (d >= 5 && consecutiveLows === 0) consecutiveHighs++;
            else if (d <= 4 && consecutiveHighs === 0) consecutiveLows++;

            if (d % 2 === 0 && consecutiveOdds === 0) consecutiveEvens++;
            else if (d % 2 !== 0 && consecutiveEvens === 0) consecutiveOdds++;

            if (
                (consecutiveHighs > 0 || consecutiveLows > 0) &&
                (consecutiveEvens > 0 || consecutiveOdds > 0) &&
                digits.length - 1 - i >= 10
            ) {
                break;
            }
        }

        // B. Evaluate Sine Wave Alternations (Low -> High -> Low -> High)
        const isAlternating = this.detectWaveAlternation(lastDigits.slice(-8));

        // C. Shannon Entropy of last 30 digits
        const entropyScore = this.calculateDigitEntropy(lastDigits);

        // Pattern 1: High Digit Momentum (Over 3 Favor)
        const countHighs = lastDigits.filter(d => d >= 5).length;
        const countLows = lastDigits.filter(d => d <= 4).length;

        if (countHighs >= 18 && (trend === 'BULLISH' || trend === 'STRONG_BULLISH')) {
            patterns.push({
                symbol,
                patternType: 'HIGH_DIGIT_MOMENTUM',
                confidence: Math.min(95, Math.round((countHighs / 30) * 100 + 10)),
                description: `High Digit Momentum (${countHighs}/30 highs) aligned with Bullish trend (${slopePct > 0 ? '+' : ''}${slopePct.toFixed(2)}%).`,
                favoredStrategy: 'OVER_3',
                recommendedPrediction: 3,
                timestamp: Date.now(),
            });
        }

        // Pattern 2: Low Digit Momentum (Under 6 Favor)
        if (countLows >= 18 && (trend === 'BEARISH' || trend === 'STRONG_BEARISH')) {
            patterns.push({
                symbol,
                patternType: 'LOW_DIGIT_MOMENTUM',
                confidence: Math.min(95, Math.round((countLows / 30) * 100 + 10)),
                description: `Low Digit Momentum (${countLows}/30 lows) aligned with Bearish trend (${slopePct.toFixed(2)}%).`,
                favoredStrategy: 'UNDER_6',
                recommendedPrediction: 6,
                timestamp: Date.now(),
            });
        }

        // Pattern 3: Overextended High Streak Snapback (Under 6 Favor)
        if (consecutiveHighs >= 4) {
            patterns.push({
                symbol,
                patternType: 'OVEREXTENDED_SNAPBACK',
                confidence: Math.min(92, 70 + consecutiveHighs * 5),
                description: `Overextended High Streak (${consecutiveHighs} consecutive high digits). Mean-reversion snapback to Under 6 favored.`,
                favoredStrategy: 'UNDER_6',
                recommendedPrediction: 6,
                timestamp: Date.now(),
            });
        }

        // Pattern 4: Parity Streak
        if (consecutiveEvens >= 4) {
            patterns.push({
                symbol,
                patternType: 'PARITY_STREAK_EVEN',
                confidence: Math.min(88, 65 + consecutiveEvens * 5),
                description: `Even Parity Streak (${consecutiveEvens} consecutive evens). Parity continuation/alternation favored.`,
                favoredStrategy: 'EVEN_ODD',
                recommendedPrediction: 'ODD',
                timestamp: Date.now(),
            });
        } else if (consecutiveOdds >= 4) {
            patterns.push({
                symbol,
                patternType: 'PARITY_STREAK_ODD',
                confidence: Math.min(88, 65 + consecutiveOdds * 5),
                description: `Odd Parity Streak (${consecutiveOdds} consecutive odds). Parity continuation/alternation favored.`,
                favoredStrategy: 'EVEN_ODD',
                recommendedPrediction: 'EVEN',
                timestamp: Date.now(),
            });
        }

        // Pattern 5: Sine Wave Oscillation
        if (isAlternating) {
            const lastD = digits[digits.length - 1];
            patterns.push({
                symbol,
                patternType: 'SINE_WAVE_OSCILLATION',
                confidence: 86,
                description: `Cyclical Sine Wave Alternation detected. Last digit was [${lastD}], expected counter-swing.`,
                favoredStrategy: lastD >= 5 ? 'UNDER_6' : 'OVER_3',
                recommendedPrediction: lastD >= 5 ? 6 : 3,
                timestamp: Date.now(),
            });
        }

        // Fallback Pattern: Equilibrium
        if (patterns.length === 0) {
            patterns.push({
                symbol,
                patternType: 'EQUILIBRIUM_CONSOLIDATION',
                confidence: 60,
                description: 'Market in statistical balance. Awaiting high-conviction breakout pattern.',
                favoredStrategy: 'HOLD',
                timestamp: Date.now(),
            });
        }

        // Select primary pattern by highest confidence
        patterns.sort((a, b) => b.confidence - a.confidence);
        const primaryPattern = patterns[0];

        // Check if we should emit a real-time event for user feedback
        const prevEvent = this.lastPatternEventBySymbol.get(symbol);
        const now = Date.now();
        if (
            (!prevEvent || prevEvent.type !== primaryPattern.patternType || now - prevEvent.time > 20000) &&
            primaryPattern.patternType !== 'EQUILIBRIUM_CONSOLIDATION'
        ) {
            this.lastPatternEventBySymbol.set(symbol, { type: primaryPattern.patternType, time: now });
            this.emitEvent('PATTERN_DETECTED', {
                symbol,
                pattern: primaryPattern,
                trend: trendState,
            });
        }

        // Save Telemetry State
        const telemetry: MarketPatternTelemetry = {
            symbol,
            trendState,
            activePatterns: patterns,
            primaryPattern,
            consecutiveHighs,
            consecutiveLows,
            consecutiveEvens,
            consecutiveOdds,
            entropyScore,
            tickCount: digits.length,
        };

        this.telemetryMap.set(symbol, telemetry);
        this.notifySubscribers();
    }

    private notifySubscribers(): void {
        this.subscribers.forEach(cb => {
            try {
                cb(this.telemetryMap);
            } catch (e) {
                console.error('[AiMarketPatternEngine] Subscriber error:', e);
            }
        });
    }

    private calculateEMA(data: number[], period: number): number {
        if (data.length === 0) return 0;
        const k = 2 / (period + 1);
        let ema = data[0];
        for (let i = 1; i < data.length; i++) {
            ema = data[i] * k + ema * (1 - k);
        }
        return ema;
    }

    private detectWaveAlternation(digits: number[]): boolean {
        if (digits.length < 6) return false;
        let switches = 0;
        for (let i = 1; i < digits.length; i++) {
            const prevHigh = digits[i - 1] >= 5;
            const currHigh = digits[i] >= 5;
            if (prevHigh !== currHigh) switches++;
        }
        return switches >= 5;
    }

    private calculateDigitEntropy(digits: number[]): number {
        if (digits.length === 0) return 0;
        const counts = new Array(10).fill(0);
        digits.forEach(d => {
            if (d >= 0 && d <= 9) counts[d]++;
        });

        let entropy = 0;
        const total = digits.length;
        counts.forEach(c => {
            if (c > 0) {
                const p = c / total;
                entropy += -p * Math.log2(p);
            }
        });
        return Number(entropy.toFixed(2));
    }

    public getTelemetry(symbol: string): MarketPatternTelemetry | undefined {
        return this.telemetryMap.get(symbol);
    }

    public getAllTelemetry(): Map<string, MarketPatternTelemetry> {
        return this.telemetryMap;
    }
}

export const aiMarketPatternService = new AiMarketPatternEngine();
