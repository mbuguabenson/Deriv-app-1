import {
    Candle,
    DonchianResult,
    CCIResult,
    CCICondition,
    MACDResult,
    MACDCondition,
    MarketActivity,
    MarketTrendSummary,
    PriceZone,
    TimeframeAnalysis,
    TimeframeKey,
} from '../types';

export class IndicatorsService {
    /**
     * Donchian Channel
     * Upper Band = Highest High over period N
     * Lower Band = Lowest Low over period N
     * Middle Line = (Upper + Lower) / 2
     */
    public static calculateDonchian(candles: Candle[], period: number = 20): DonchianResult | null {
        if (!candles || candles.length < Math.min(period, 5)) return null;

        const slice = candles.slice(-period);
        let highest = -Infinity;
        let lowest = Infinity;

        for (const c of slice) {
            if (c.high > highest) highest = c.high;
            if (c.low < lowest) lowest = c.low;
        }

        if (!Number.isFinite(highest) || !Number.isFinite(lowest) || highest === lowest) {
            return null;
        }

        const middle = (highest + lowest) / 2;
        const currentCandle = candles[candles.length - 1];
        const prevCandle = candles.length > 1 ? candles[candles.length - 2] : currentCandle;
        const close = currentCandle.close;
        const range = highest - lowest;

        // Position categorization
        const upperThreshold = highest - range * 0.25;
        const lowerThreshold = lowest + range * 0.25;

        let position: 'UPPER_CHANNEL' | 'MIDDLE_CHANNEL' | 'LOWER_CHANNEL' = 'MIDDLE_CHANNEL';
        if (close >= upperThreshold) {
            position = 'UPPER_CHANNEL';
        } else if (close <= lowerThreshold) {
            position = 'LOWER_CHANNEL';
        }

        const distanceToUpperPct = ((highest - close) / range) * 100;
        const distanceToLowerPct = ((close - lowest) / range) * 100;
        const distanceToMiddlePct = (Math.abs(close - middle) / range) * 100;

        // Breakout detection
        const isUpperBreakout = close >= highest && prevCandle.close < highest;
        const isLowerBreakout = close <= lowest && prevCandle.close > lowest;

        // Rejection detection: spiked beyond boundary but closed back inside with long wick
        const candleRange = Math.max(0.000001, currentCandle.high - currentCandle.low);
        const upperWick = currentCandle.high - Math.max(currentCandle.open, currentCandle.close);
        const lowerWick = Math.min(currentCandle.open, currentCandle.close) - currentCandle.low;

        const isUpperRejection =
            currentCandle.high >= highest * 0.9995 &&
            upperWick / candleRange >= 0.4 &&
            close < middle + range * 0.35;

        const isLowerRejection =
            currentCandle.low <= lowest * 1.0005 &&
            lowerWick / candleRange >= 0.4 &&
            close > middle - range * 0.35;

        return {
            upper: highest,
            middle,
            lower: lowest,
            position,
            distanceToUpperPct,
            distanceToLowerPct,
            distanceToMiddlePct,
            isUpperBreakout,
            isLowerBreakout,
            isUpperRejection,
            isLowerRejection,
        };
    }

    /**
     * Commodity Channel Index (CCI)
     * TP = (H + L + C) / 3
     * SMA = Average of TP over N periods
     * MD = Mean Deviation: sum(|TP_i - SMA|) / N
     * CCI = (TP - SMA) / (0.015 * MD)
     */
    public static calculateCCI(candles: Candle[], period: number = 20): CCIResult | null {
        if (!candles || candles.length < period + 1) return null;

        const tps: number[] = candles.map(c => (c.high + c.low + c.close) / 3);

        const getCciAt = (endIdx: number): number => {
            if (endIdx < period) return 0;
            const sub = tps.slice(endIdx - period, endIdx);
            const sma = sub.reduce((a, b) => a + b, 0) / period;
            const md = sub.reduce((acc, tp) => acc + Math.abs(tp - sma), 0) / period;
            if (md === 0) return 0;
            return (tps[endIdx - 1] - sma) / (0.015 * md);
        };

        const currentCci = getCciAt(tps.length);
        const prevCci = getCciAt(tps.length - 1);
        const prevPrevCci = getCciAt(tps.length - 2);

        // Slope
        const delta = currentCci - prevCci;
        const slope: 'RISING' | 'FALLING' | 'FLAT' =
            delta > 1.5 ? 'RISING' : delta < -1.5 ? 'FALLING' : 'FLAT';

        // Categorize Condition
        let condition: CCICondition = 'RANGE';
        let isPotentialBullishReversal = false;
        let isPotentialBearishReversal = false;
        let isConfirmedBullishReversal = false;
        let isConfirmedBearishReversal = false;

        if (currentCci > 100) {
            if (prevCci > 130 && delta < -5) {
                condition = 'BULLISH_EXHAUSTION';
                isPotentialBearishReversal = true;
            } else {
                condition = 'STRONG_BULLISH';
            }
        } else if (currentCci < -100) {
            if (prevCci < -130 && delta > 5) {
                condition = 'BEARISH_EXHAUSTION';
                isPotentialBullishReversal = true;
            } else {
                condition = 'STRONG_BEARISH';
            }
        } else {
            // Between -100 and +100
            if (prevCci <= -100 && currentCci > -100) {
                condition = 'REVERSAL_CONFIRMING';
                isConfirmedBullishReversal = true;
            } else if (prevCci >= 100 && currentCci < 100) {
                condition = 'REVERSAL_CONFIRMING';
                isConfirmedBearishReversal = true;
            } else if (prevPrevCci < -80 && prevCci < -50 && delta > 15) {
                condition = 'REVERSAL_CONFIRMING';
                isConfirmedBullishReversal = true;
            } else if (prevPrevCci > 80 && prevCci > 50 && delta < -15) {
                condition = 'REVERSAL_CONFIRMING';
                isConfirmedBearishReversal = true;
            } else {
                condition = 'RANGE';
            }
        }

        return {
            value: Number(currentCci.toFixed(2)),
            previousValue: Number(prevCci.toFixed(2)),
            condition,
            isPotentialBullishReversal,
            isPotentialBearishReversal,
            isConfirmedBullishReversal,
            isConfirmedBearishReversal,
            slope,
        };
    }

    /**
     * MACD (12, 26, 9)
     */
    public static calculateMACD(
        candles: Candle[],
        fastPeriod: number = 12,
        slowPeriod: number = 26,
        signalPeriod: number = 9
    ): MACDResult | null {
        if (!candles || candles.length < slowPeriod + signalPeriod) return null;

        const closes = candles.map(c => c.close);

        const calculateEMA = (data: number[], p: number): number[] => {
            const k = 2 / (p + 1);
            const emaArray: number[] = new Array(data.length);
            let sum = 0;
            for (let i = 0; i < p; i++) {
                sum += data[i];
            }
            emaArray[p - 1] = sum / p;

            for (let i = p; i < data.length; i++) {
                emaArray[i] = data[i] * k + emaArray[i - 1] * (1 - k);
            }
            return emaArray;
        };

        const fastEMA = calculateEMA(closes, fastPeriod);
        const slowEMA = calculateEMA(closes, slowPeriod);

        const macdLine: number[] = [];
        const macdValidIndices: number[] = [];

        for (let i = slowPeriod - 1; i < closes.length; i++) {
            macdLine.push(fastEMA[i] - slowEMA[i]);
            macdValidIndices.push(i);
        }

        if (macdLine.length < signalPeriod) return null;

        const signalLine = calculateEMA(macdLine, signalPeriod);

        const currentMacd = macdLine[macdLine.length - 1];
        const currentSignal = signalLine[signalLine.length - 1];
        const currentHist = currentMacd - currentSignal;

        const prevMacd = macdLine[macdLine.length - 2];
        const prevSignal = signalLine[signalLine.length - 2];
        const prevHist = prevMacd - prevSignal;

        const isBullishCross = prevMacd <= prevSignal && currentMacd > currentSignal;
        const isBearishCross = prevMacd >= prevSignal && currentMacd < currentSignal;
        const isAboveZero = currentMacd > 0;
        const isHistogramExpanding = Math.abs(currentHist) > Math.abs(prevHist);

        let condition: MACDCondition = 'NEUTRAL';
        if (currentHist > 0) {
            if (isHistogramExpanding) {
                condition = 'BULLISH_MOMENTUM';
            } else {
                condition = 'MOMENTUM_WEAKENING';
            }
        } else if (currentHist < 0) {
            if (isHistogramExpanding) {
                condition = 'BEARISH_MOMENTUM';
            } else {
                condition = 'MOMENTUM_WEAKENING';
            }
        }

        return {
            macd: Number(currentMacd.toFixed(5)),
            signal: Number(currentSignal.toFixed(5)),
            histogram: Number(currentHist.toFixed(5)),
            previousHistogram: Number(prevHist.toFixed(5)),
            condition,
            isBullishCross,
            isBearishCross,
            isAboveZero,
            isHistogramExpanding,
        };
    }

    /**
     * Market Activity Filter (Proxy metric based on ATR, recent candle ranges, and tick movement)
     */
    public static calculateMarketActivity(
        candles: Candle[],
        period: number = 14,
        threshold: number = 30
    ): MarketActivity | null {
        if (!candles || candles.length < period) return null;

        const recent = candles.slice(-period);
        let sumTR = 0;
        let sumRange = 0;

        for (let i = 1; i < recent.length; i++) {
            const cur = recent[i];
            const prev = recent[i - 1];
            const tr = Math.max(
                cur.high - cur.low,
                Math.abs(cur.high - prev.close),
                Math.abs(cur.low - prev.close)
            );
            sumTR += tr;
            sumRange += cur.high - cur.low;
        }

        const atr = sumTR / (recent.length - 1);
        const avgRange = sumRange / (recent.length - 1);
        const lastCandle = recent[recent.length - 1];
        const currentRange = lastCandle.high - lastCandle.low;

        // Evaluate recent completed candle volatility so new forming candles do not artificially zero the index
        const completedCandles = recent.slice(0, -1);
        const lastCompletedCandle = completedCandles[completedCandles.length - 1] || lastCandle;
        const referenceRange = Math.max(lastCompletedCandle.high - lastCompletedCandle.low, currentRange);

        // Relative volatility index 0 to 100
        const price = Math.max(0.0001, lastCandle.close);
        const volatilityPct = (atr / price) * 100;
        const rangeRatio = avgRange > 0 ? referenceRange / avgRange : 1;

        // Base activity calculation - synthetic indices and active markets maintain robust baseline activity
        let activityIndex = Math.min(100, Math.max(10, Math.round(rangeRatio * 30 + 40 + Math.min(30, volatilityPct * 600))));

        const isTradable = activityIndex >= threshold;
        const level = isTradable ? 'HIGH_ACTIVITY' : 'LOW_ACTIVITY';
        const label = isTradable ? 'HIGH ACTIVITY' : 'LOW ACTIVITY — WAIT';

        return {
            index: activityIndex,
            level,
            label,
            atr: Number(atr.toFixed(5)),
            avgCandleRange: Number(avgRange.toFixed(5)),
            currentRange: Number(currentRange.toFixed(5)),
            tickFrequency: 1.0,
            isTradable,
        };
    }

    /**
     * Support & Resistance Zones
     */
    public static identifyPriceZones(candles: Candle[], lookback: number = 40): PriceZone[] {
        if (!candles || candles.length < 15) return [];

        const slice = candles.slice(-lookback);
        const swingHighs: number[] = [];
        const swingLows: number[] = [];

        // Identify local swing points with 2-bar left and right confirmation
        for (let i = 2; i < slice.length - 2; i++) {
            const c = slice[i];
            if (
                c.high >= slice[i - 1].high &&
                c.high >= slice[i - 2].high &&
                c.high >= slice[i + 1].high &&
                c.high >= slice[i + 2].high
            ) {
                swingHighs.push(c.high);
            }
            if (
                c.low <= slice[i - 1].low &&
                c.low <= slice[i - 2].low &&
                c.low <= slice[i + 1].low &&
                c.low <= slice[i + 2].low
            ) {
                swingLows.push(c.low);
            }
        }

        const zones: PriceZone[] = [];
        const currentPrice = slice[slice.length - 1].close;

        // Cluster swing highs into resistance zones
        if (swingHighs.length > 0) {
            const sortedHighs = [...swingHighs].sort((a, b) => b - a);
            const topResistance = sortedHighs[0];
            zones.push({
                type: 'RESISTANCE',
                label: 'RESISTANCE',
                high: topResistance * 1.0005,
                low: topResistance * 0.9995,
                price: topResistance,
                strength: Math.min(5, sortedHighs.length),
            });
        }

        // Cluster swing lows into support zones
        if (swingLows.length > 0) {
            const sortedLows = [...swingLows].sort((a, b) => a - b);
            const bottomSupport = sortedLows[0];
            zones.push({
                type: 'SUPPORT',
                label: 'SUPPORT',
                high: bottomSupport * 1.0005,
                low: bottomSupport * 0.9995,
                price: bottomSupport,
                strength: Math.min(5, sortedLows.length),
            });
        }

        // Donchian extreme zones
        const donchian = this.calculateDonchian(slice, Math.min(20, slice.length));
        if (donchian) {
            if (currentPrice >= donchian.upper * 0.999) {
                zones.push({
                    type: 'BREAKOUT_ZONE',
                    label: 'BREAKOUT ZONE',
                    high: donchian.upper * 1.001,
                    low: donchian.upper * 0.999,
                    price: donchian.upper,
                    strength: 4,
                });
            } else if (currentPrice <= donchian.lower * 1.001) {
                zones.push({
                    type: 'REVERSAL_ZONE',
                    label: 'REVERSAL ZONE',
                    high: donchian.lower * 1.001,
                    low: donchian.lower * 0.999,
                    price: donchian.lower,
                    strength: 4,
                });
            }
        }

        return zones;
    }

    /**
     * Compute comprehensive Market Trend Summary across timeframes
     */
    public static detectMarketTrend(
        analyses: Record<TimeframeKey, TimeframeAnalysis | null>,
        currentCandles: Candle[]
    ): MarketTrendSummary {
        let bullishPoints = 0;
        let bearishPoints = 0;
        let totalTimeframes = 0;

        const tfKeys: TimeframeKey[] = ['30m', '15m', '5m', '1m'];
        const weights: Record<TimeframeKey, number> = {
            '30m': 35,
            '15m': 30,
            '5m': 25,
            '1m': 10,
        };

        tfKeys.forEach(tf => {
            const a = analyses[tf];
            if (a) {
                totalTimeframes++;
                const w = weights[tf];
                if (a.trend === 'BULLISH') bullishPoints += w;
                else if (a.trend === 'BEARISH') bearishPoints += w;

                if (a.macd?.isAboveZero) bullishPoints += w * 0.2;
                else bearishPoints += w * 0.2;

                if (a.donchian?.position === 'UPPER_CHANNEL') bullishPoints += w * 0.2;
                else if (a.donchian?.position === 'LOWER_CHANNEL') bearishPoints += w * 0.2;
            }
        });

        // Price slope from recent candles
        let slope: 'UP' | 'DOWN' | 'FLAT' = 'FLAT';
        if (currentCandles && currentCandles.length >= 5) {
            const recent = currentCandles.slice(-5);
            const delta = recent[recent.length - 1].close - recent[0].open;
            if (delta > 0) slope = 'UP';
            else if (delta < 0) slope = 'DOWN';
        }

        const netScore = bullishPoints - bearishPoints;
        const maxScore = 140; // weighted sum
        const confidence = Math.min(100, Math.round((Math.abs(netScore) / maxScore) * 100));

        let direction: MarketTrendSummary['direction'] = 'RANGE';
        let label = 'Range / Consolidating';
        let description = 'Market is moving sideways without dominant directional trend.';

        if (netScore >= 45) {
            direction = 'STRONG_BULLISH';
            label = 'Strong Bullish Trend';
            description = 'High upward momentum confirmed across multiple timeframes and Donchian upper band.';
        } else if (netScore >= 18) {
            direction = 'BULLISH';
            label = 'Bullish Trend';
            description = 'Price action favors upside advances; monitor pullbacks to midline.';
        } else if (netScore <= -45) {
            direction = 'STRONG_BEARISH';
            label = 'Strong Bearish Trend';
            description = 'High downward pressure confirmed across multiple timeframes and Donchian lower band.';
        } else if (netScore <= -18) {
            direction = 'BEARISH';
            label = 'Bearish Trend';
            description = 'Price action favors downside pressure; monitor resistance retests.';
        }

        const tfAlignedCount = tfKeys.filter(tf => {
            const a = analyses[tf];
            if (!a) return false;
            return direction.includes('BULLISH') ? a.trend === 'BULLISH' : a.trend === 'BEARISH';
        }).length;

        return {
            direction,
            label,
            strength: confidence,
            slope,
            timeframeConfluence: `${tfAlignedCount} of ${totalTimeframes || 4} Timeframes Aligned`,
            description,
        };
    }
}

