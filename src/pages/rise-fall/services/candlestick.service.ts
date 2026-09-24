import { Candle, CandleAnalysis, CandlePatternName, DonchianResult } from '../types';

export class CandlestickService {
    /**
     * Smart Candlestick Analysis & Closing Position Engine
     */
    public static analyzeCandle(
        candles: Candle[],
        donchian?: DonchianResult | null
    ): CandleAnalysis | null {
        if (!candles || candles.length === 0) return null;

        const current = candles[candles.length - 1];
        const prev = candles.length > 1 ? candles[candles.length - 2] : null;

        const open = current.open;
        const high = current.high;
        const low = current.low;
        const close = current.close;

        const range = Math.max(0.000001, high - low);
        const bodySize = Math.abs(close - open);
        const isBullish = close >= open;
        const isBearish = close < open;
        const bodyRatio = bodySize / range;

        const upperWick = high - Math.max(open, close);
        const lowerWick = Math.min(open, close) - low;

        // Closing position relative to total range (0.0 = at low, 1.0 = at high)
        const closeRatio = (close - low) / range;

        let closePosition: CandleAnalysis['closePosition'] = 'MIDDLE_CLOSE';
        let closePositionLabel = 'Closed in Middle Range';

        if (closeRatio >= 0.82 && bodyRatio >= 0.55 && isBullish) {
            closePosition = 'STRONG_BULLISH_CLOSE';
            closePositionLabel = 'Strong Bullish Close (Near High)';
        } else if (closeRatio <= 0.18 && bodyRatio >= 0.55 && isBearish) {
            closePosition = 'STRONG_BEARISH_CLOSE';
            closePositionLabel = 'Strong Bearish Close (Near Low)';
        } else if (upperWick / range >= 0.45 && close <= low + range * 0.4) {
            closePosition = 'UPPER_WICK_REJECTION';
            closePositionLabel = 'Upper Wick Rejection (Sold Down From High)';
        } else if (lowerWick / range >= 0.45 && close >= high - range * 0.4) {
            closePosition = 'LOWER_WICK_REJECTION';
            closePositionLabel = 'Lower Wick Rejection (Bought Up From Low)';
        }

        // Pattern Detection
        let pattern: CandlePatternName = 'NEUTRAL_CANDLE';
        let patternLabel = 'Standard Candle';
        let contextQuality: CandleAnalysis['contextQuality'] = 'MEDIUM';
        let contextDescription = 'Neutral market action without clear single candle edge.';

        // 1. Doji
        if (bodyRatio <= 0.1) {
            pattern = 'DOJI';
            patternLabel = 'Doji (Indecision)';
            contextQuality = 'MEDIUM';
            contextDescription = 'Balance between buyers and sellers; watch for next directional breakout.';
        }
        // 2. Hammer (long lower shadow, small body near top)
        else if (lowerWick >= 2 * bodySize && upperWick <= bodySize * 0.4 && closeRatio >= 0.6) {
            pattern = 'HAMMER';
            patternLabel = 'Hammer (Bullish Rejection)';
            if (donchian && donchian.position === 'LOWER_CHANNEL') {
                contextQuality = 'HIGH';
                contextDescription = 'High-probability bullish rejection at lower Donchian channel boundary.';
            } else {
                contextQuality = 'MEDIUM';
                contextDescription = 'Potential bullish bounce; verify higher timeframe support.';
            }
        }
        // 3. Shooting Star (long upper shadow, small body near bottom)
        else if (upperWick >= 2 * bodySize && lowerWick <= bodySize * 0.4 && closeRatio <= 0.4) {
            pattern = 'SHOOTING_STAR';
            patternLabel = 'Shooting Star (Bearish Rejection)';
            if (donchian && donchian.position === 'UPPER_CHANNEL') {
                contextQuality = 'HIGH';
                contextDescription = 'High-probability bearish rejection at upper Donchian channel resistance.';
            } else {
                contextQuality = 'MEDIUM';
                contextDescription = 'Price tested highs and was rejected; watch for downside follow-through.';
            }
        }
        // 4. Inverted Hammer (long upper wick after down move)
        else if (upperWick >= 2 * bodySize && lowerWick <= bodySize * 0.35 && isBullish) {
            pattern = 'INVERTED_HAMMER';
            patternLabel = 'Inverted Hammer';
            contextQuality = 'MEDIUM';
            contextDescription = 'Buyers attempted upside move; needs subsequent candle confirmation.';
        }
        // 5. Hanging Man (long lower shadow after up move)
        else if (lowerWick >= 2 * bodySize && upperWick <= bodySize * 0.4 && isBearish) {
            pattern = 'HANGING_MAN';
            patternLabel = 'Hanging Man';
            contextQuality = 'MEDIUM';
            contextDescription = 'Exhaustion warning at peak; caution on long positions.';
        }
        // 6. Bullish Engulfing
        else if (
            prev &&
            prev.close < prev.open &&
            isBullish &&
            open <= prev.close &&
            close > prev.open &&
            bodyRatio >= 0.6
        ) {
            pattern = 'BULLISH_ENGULFING';
            patternLabel = 'Bullish Engulfing';
            contextQuality = 'HIGH';
            contextDescription = 'Buyers overpowered prior selling wave; strong continuation or reversal cue.';
        }
        // 7. Bearish Engulfing
        else if (
            prev &&
            prev.close > prev.open &&
            isBearish &&
            open >= prev.close &&
            close < prev.open &&
            bodyRatio >= 0.6
        ) {
            pattern = 'BEARISH_ENGULFING';
            patternLabel = 'Bearish Engulfing';
            contextQuality = 'HIGH';
            contextDescription = 'Sellers engulfed prior bullish advance; aggressive downside shift.';
        }
        // 8. Inside Bar
        else if (prev && high < prev.high && low > prev.low) {
            pattern = 'INSIDE_BAR';
            patternLabel = 'Inside Bar (Compression)';
            contextQuality = 'MEDIUM';
            contextDescription = 'Volatility contraction inside prior range; prepare for expansion.';
        }
        // 9. Outside Bar
        else if (prev && high > prev.high && low < prev.low) {
            pattern = 'OUTSIDE_BAR';
            patternLabel = 'Outside Bar (Expansion)';
            contextQuality = isBullish ? 'HIGH' : 'MEDIUM';
            contextDescription = 'Expanded range engulfing prior extremes; active momentum battle.';
        }
        // 10. Rejection Candle (Long wick + opposite close)
        else if (closePosition === 'UPPER_WICK_REJECTION') {
            pattern = 'REJECTION_CANDLE';
            patternLabel = 'Upper Wick Rejection';
            contextQuality = 'HIGH';
            contextDescription = 'Sellers defended resistance and forced close near lows.';
        } else if (closePosition === 'LOWER_WICK_REJECTION') {
            pattern = 'REJECTION_CANDLE';
            patternLabel = 'Lower Wick Rejection';
            contextQuality = 'HIGH';
            contextDescription = 'Buyers defended support and reclaimed control before close.';
        }
        // 11. Strong Bullish Candle
        else if (isBullish && bodyRatio >= 0.72 && closeRatio >= 0.85) {
            pattern = 'STRONG_BULLISH_CANDLE';
            patternLabel = 'Strong Bullish Candle (Impulse)';
            contextQuality = 'HIGH';
            contextDescription = 'Aggressive demand pushing price to close at absolute highs.';
        }
        // 12. Strong Bearish Candle
        else if (isBearish && bodyRatio >= 0.72 && closeRatio <= 0.15) {
            pattern = 'STRONG_BEARISH_CANDLE';
            patternLabel = 'Strong Bearish Candle (Impulse)';
            contextQuality = 'HIGH';
            contextDescription = 'Dominant supply pushing price to close at absolute lows.';
        }
        // 13. Breakout Candle
        else if (donchian && ((isBullish && donchian.isUpperBreakout) || (isBearish && donchian.isLowerBreakout))) {
            pattern = 'BREAKOUT_CANDLE';
            patternLabel = isBullish ? 'Bullish Donchian Breakout' : 'Bearish Donchian Breakdown';
            contextQuality = 'HIGH';
            contextDescription = 'Candle penetrates 20-period boundary with momentum.';
        }
        // 14. Continuation Candle
        else if (
            prev &&
            ((isBullish && prev.close > prev.open && close > prev.close) ||
                (isBearish && prev.close < prev.open && close < prev.close)) &&
            bodyRatio >= 0.5
        ) {
            pattern = 'CONTINUATION_CANDLE';
            patternLabel = isBullish ? 'Bullish Continuation Candle' : 'Bearish Continuation Candle';
            contextQuality = 'MEDIUM';
            contextDescription = 'Sustained momentum in line with previous candle direction.';
        }

        return {
            pattern,
            patternLabel,
            isBullish,
            isBearish,
            bodySize: Number(bodySize.toFixed(5)),
            upperWick: Number(upperWick.toFixed(5)),
            lowerWick: Number(lowerWick.toFixed(5)),
            range: Number(range.toFixed(5)),
            bodyRatio: Number(bodyRatio.toFixed(3)),
            closePosition,
            closePositionLabel,
            contextQuality,
            contextDescription,
        };
    }

    /**
     * Scans candles for notable patterns with index tracking for chart display
     */
    public static scanCandlePatterns(
        candles: Candle[],
        donchian?: DonchianResult | null,
        lookback: number = 35
    ): Array<{ index: number; epoch: number; candle: Candle; analysis: CandleAnalysis }> {
        if (!candles || candles.length < 2) return [];

        const results: Array<{ index: number; epoch: number; candle: Candle; analysis: CandleAnalysis }> = [];
        const start = Math.max(1, candles.length - lookback);

        for (let i = start; i < candles.length; i++) {
            const slice = candles.slice(0, i + 1);
            const analysis = CandlestickService.analyzeCandle(slice, donchian);
            if (analysis && analysis.pattern !== 'NEUTRAL_CANDLE') {
                results.push({
                    index: i,
                    epoch: candles[i].epoch,
                    candle: candles[i],
                    analysis,
                });
            }
        }

        return results;
    }
}

