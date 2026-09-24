import {
    DebugCheckItem,
    SignalEvaluation,
    SignalState,
    TimeframeAnalysis,
    TrendStructure,
} from '../types';

export class SignalEngineService {
    /**
     * Evaluates all 12 criteria across 30M, 15M, 5M, and 1M timeframes
     */
    public static evaluate(
        tf30m: TimeframeAnalysis | null,
        tf15m: TimeframeAnalysis | null,
        tf5m: TimeframeAnalysis | null,
        tf1m: TimeframeAnalysis | null,
        minConfidenceThreshold: number = 75
    ): SignalEvaluation {
        const debugChecks: DebugCheckItem[] = [];
        const reasons: string[] = [];
        let conflictReason: string | undefined;

        // 1. Data Availability Pre-Check
        if (!tf30m || !tf15m || !tf5m || !tf1m) {
            return {
                state: 'NO_TRADE',
                direction: 'NONE',
                confidence: 0,
                structure: 'NEUTRAL_RANGE',
                reasons: ['Awaiting historical candle feeds across all 4 timeframes (30M, 15M, 5M, 1M).'],
                conflictReason: 'Insufficient multi-timeframe data.',
                isExecutionReady: false,
                debugChecks: [
                    {
                        id: 'data_feed',
                        name: 'DATA FEED',
                        status: 'FAIL',
                        weight: 10,
                        details: 'Missing one or more timeframe candle streams.',
                    },
                ],
                evaluatedAt: Date.now(),
            };
        }

        let riseScore = 0;
        let fallScore = 0;

        // ── 1. 30M Trend (Primary Structure - Weight 25) ──────────────────────
        const trend30 = tf30m.trend;
        if (trend30 === 'BULLISH') {
            riseScore += 25;
            debugChecks.push({
                id: 'tf_30m',
                name: '30M TREND',
                status: 'PASS',
                weight: 25,
                details: 'Primary trend is Bullish on 30M.',
            });
            reasons.push('30M bullish market structure established');
        } else if (trend30 === 'BEARISH') {
            fallScore += 25;
            debugChecks.push({
                id: 'tf_30m',
                name: '30M TREND',
                status: 'PASS',
                weight: 25,
                details: 'Primary trend is Bearish on 30M.',
            });
            reasons.push('30M bearish market structure established');
        } else {
            debugChecks.push({
                id: 'tf_30m',
                name: '30M TREND',
                status: 'WARN',
                weight: 5,
                details: '30M trend is Neutral/Range.',
            });
            reasons.push('30M market is in consolidation range');
        }

        // ── 2. 15M Trend Confirmation (Weight 20) ─────────────────────────────
        const trend15 = tf15m.trend;
        if (trend30 === 'BULLISH' && trend15 === 'BULLISH') {
            riseScore += 20;
            debugChecks.push({
                id: 'tf_15m',
                name: '15M CONFIRMATION',
                status: 'PASS',
                weight: 20,
                details: '15M confirms 30M Bullish trend.',
            });
            reasons.push('15M trend confirmed aligned with 30M');
        } else if (trend30 === 'BEARISH' && trend15 === 'BEARISH') {
            fallScore += 20;
            debugChecks.push({
                id: 'tf_15m',
                name: '15M CONFIRMATION',
                status: 'PASS',
                weight: 20,
                details: '15M confirms 30M Bearish trend.',
            });
            reasons.push('15M trend confirmed aligned with 30M');
        } else if ((trend30 === 'BULLISH' && trend15 === 'BEARISH') || (trend30 === 'BEARISH' && trend15 === 'BULLISH')) {
            debugChecks.push({
                id: 'tf_15m',
                name: '15M CONFIRMATION',
                status: 'FAIL',
                weight: 20,
                details: `15M (${trend15}) opposes 30M (${trend30}).`,
            });
            conflictReason = '15M timeframe opposes 30M primary trend.';
        } else {
            debugChecks.push({
                id: 'tf_15m',
                name: '15M CONFIRMATION',
                status: 'WARN',
                weight: 5,
                details: `15M is consolidating.`,
            });
        }

        // ── 3. 5M Setup Confirmation (Weight 20) ──────────────────────────────
        const trend5 = tf5m.trend;
        if (trend30 === 'BULLISH' && trend5 === 'BULLISH') {
            riseScore += 20;
            debugChecks.push({
                id: 'tf_5m',
                name: '5M CONFIRMATION',
                status: 'PASS',
                weight: 20,
                details: '5M short-term trend confirms upside setup.',
            });
            reasons.push('5M short-term trend setup confirmed');
        } else if (trend30 === 'BEARISH' && trend5 === 'BEARISH') {
            fallScore += 20;
            debugChecks.push({
                id: 'tf_5m',
                name: '5M CONFIRMATION',
                status: 'PASS',
                weight: 20,
                details: '5M short-term trend confirms downside setup.',
            });
            reasons.push('5M short-term trend setup confirmed');
        } else if ((trend30 === 'BULLISH' && trend5 === 'BEARISH') || (trend30 === 'BEARISH' && trend5 === 'BULLISH')) {
            debugChecks.push({
                id: 'tf_5m',
                name: '5M CONFIRMATION',
                status: 'FAIL',
                weight: 20,
                details: `5M (${trend5}) opposes 30M (${trend30}).`,
            });
            if (!conflictReason) {
                conflictReason = '5M setup opposes 30M trend.';
            }
        } else {
            debugChecks.push({
                id: 'tf_5m',
                name: '5M CONFIRMATION',
                status: 'WARN',
                weight: 5,
                details: `5M is consolidating.`,
            });
        }

        // ── 4. 1M Entry Timing Confirmation (Weight 15) ───────────────────────
        const trend1 = tf1m.trend;
        if (trend1 === 'BULLISH') {
            riseScore += 15;
            debugChecks.push({
                id: 'tf_1m',
                name: '1M ENTRY',
                status: 'PASS',
                weight: 15,
                details: '1M entry momentum ready for Rise.',
            });
            reasons.push('1M entry timing trigger ready for Rise');
        } else if (trend1 === 'BEARISH') {
            fallScore += 15;
            debugChecks.push({
                id: 'tf_1m',
                name: '1M ENTRY',
                status: 'PASS',
                weight: 15,
                details: '1M entry momentum ready for Fall.',
            });
            reasons.push('1M entry timing trigger ready for Fall');
        } else {
            debugChecks.push({
                id: 'tf_1m',
                name: '1M ENTRY',
                status: 'WARN',
                weight: 5,
                details: '1M entry timing is neutral/waiting.',
            });
        }

        // ── 5. Donchian Position & Dynamics (Weight 10) ───────────────────────
        const d15 = tf15m.donchian;
        const d5 = tf5m.donchian;
        if (d5) {
            if (d5.position === 'UPPER_CHANNEL' || d5.isUpperBreakout || (d15 && d15.position === 'UPPER_CHANNEL')) {
                riseScore += 10;
                debugChecks.push({
                    id: 'donchian',
                    name: 'DONCHIAN',
                    status: 'PASS',
                    weight: 10,
                    details: 'Price holding above midline / testing upper channel.',
                });
                reasons.push('Price holding firmly in upper Donchian channel');
            } else if (d5.position === 'LOWER_CHANNEL' || d5.isLowerBreakout || (d15 && d15.position === 'LOWER_CHANNEL')) {
                fallScore += 10;
                debugChecks.push({
                    id: 'donchian',
                    name: 'DONCHIAN',
                    status: 'PASS',
                    weight: 10,
                    details: 'Price holding below midline / testing lower channel.',
                });
                reasons.push('Price holding firmly in lower Donchian channel');
            } else {
                debugChecks.push({
                    id: 'donchian',
                    name: 'DONCHIAN',
                    status: 'WARN',
                    weight: 5,
                    details: 'Price fluctuating around Donchian middle line.',
                });
                reasons.push('Price near Donchian yellow midline (equilibrium)');
            }
        }

        // ── 6. CCI Momentum & Exhaustion Watch (Weight 10) ────────────────────
        const cci5 = tf5m.cci;
        const cci1 = tf1m.cci;
        if (cci5) {
            if (cci5.condition === 'STRONG_BULLISH' || cci5.isConfirmedBullishReversal) {
                riseScore += 10;
                debugChecks.push({
                    id: 'cci',
                    name: 'CCI',
                    status: 'PASS',
                    weight: 10,
                    details: `CCI is ${cci5.condition} (+${cci5.value}).`,
                });
                reasons.push(`CCI supports upside (+${cci5.value}, ${cci5.slope})`);
            } else if (cci5.condition === 'STRONG_BEARISH' || cci5.isConfirmedBearishReversal) {
                fallScore += 10;
                debugChecks.push({
                    id: 'cci',
                    name: 'CCI',
                    status: 'PASS',
                    weight: 10,
                    details: `CCI is ${cci5.condition} (${cci5.value}).`,
                });
                reasons.push(`CCI supports downside (${cci5.value}, ${cci5.slope})`);
            } else if (cci5.condition === 'BULLISH_EXHAUSTION') {
                debugChecks.push({
                    id: 'cci',
                    name: 'CCI',
                    status: 'WARN',
                    weight: 0,
                    details: 'CCI Bullish Exhaustion watch (+130+ turning down).',
                });
                reasons.push('CCI Bullish Exhaustion watch — awaiting confirmation');
            } else if (cci5.condition === 'BEARISH_EXHAUSTION') {
                debugChecks.push({
                    id: 'cci',
                    name: 'CCI',
                    status: 'WARN',
                    weight: 0,
                    details: 'CCI Bearish Exhaustion watch (-130+ turning up).',
                });
                reasons.push('CCI Bearish Exhaustion watch — awaiting confirmation');
            } else {
                debugChecks.push({
                    id: 'cci',
                    name: 'CCI',
                    status: 'WARN',
                    weight: 5,
                    details: 'CCI in neutral range.',
                });
            }
        }

        // ── 7. MACD Momentum Direction (Weight 10) ────────────────────────────
        const macd5 = tf5m.macd;
        if (macd5) {
            if (macd5.condition === 'BULLISH_MOMENTUM' || macd5.isBullishCross) {
                riseScore += 10;
                debugChecks.push({
                    id: 'macd',
                    name: 'MACD',
                    status: 'PASS',
                    weight: 10,
                    details: 'MACD showing Bullish Momentum expansion.',
                });
                reasons.push('MACD momentum expanding positively');
            } else if (macd5.condition === 'BEARISH_MOMENTUM' || macd5.isBearishCross) {
                fallScore += 10;
                debugChecks.push({
                    id: 'macd',
                    name: 'MACD',
                    status: 'PASS',
                    weight: 10,
                    details: 'MACD showing Bearish Momentum expansion.',
                });
                reasons.push('MACD momentum expanding negatively');
            } else {
                debugChecks.push({
                    id: 'macd',
                    name: 'MACD',
                    status: 'WARN',
                    weight: 4,
                    details: `MACD ${macd5.condition}.`,
                });
                reasons.push('MACD momentum weakening or neutral');
            }
        }

        // ── 8. Candlestick Formations & Closing (Weight 10) ───────────────────
        const candle1 = tf1m.candle;
        const candle5 = tf5m.candle;
        const activeCandle = candle1 || candle5;
        if (activeCandle) {
            if (activeCandle.isBullish && (activeCandle.closePosition === 'STRONG_BULLISH_CLOSE' || activeCandle.pattern === 'HAMMER' || activeCandle.pattern === 'BULLISH_ENGULFING')) {
                riseScore += 10;
                debugChecks.push({
                    id: 'candle',
                    name: 'CANDLESTICK',
                    status: 'PASS',
                    weight: 10,
                    details: `${activeCandle.patternLabel} with ${activeCandle.closePositionLabel}.`,
                });
                reasons.push(`Candle structure: ${activeCandle.patternLabel}`);
            } else if (activeCandle.isBearish && (activeCandle.closePosition === 'STRONG_BEARISH_CLOSE' || activeCandle.pattern === 'SHOOTING_STAR' || activeCandle.pattern === 'BEARISH_ENGULFING')) {
                fallScore += 10;
                debugChecks.push({
                    id: 'candle',
                    name: 'CANDLESTICK',
                    status: 'PASS',
                    weight: 10,
                    details: `${activeCandle.patternLabel} with ${activeCandle.closePositionLabel}.`,
                });
                reasons.push(`Candle structure: ${activeCandle.patternLabel}`);
            } else {
                debugChecks.push({
                    id: 'candle',
                    name: 'CANDLESTICK',
                    status: 'WARN',
                    weight: 4,
                    details: `${activeCandle.patternLabel} (${activeCandle.closePositionLabel}).`,
                });
            }
        }

        // ── 9. Market Activity Filter (Gatekeeper) ───────────────────────────
        const activity = tf5m.activity || tf1m.activity;
        const isActivityPass = activity ? activity.isTradable : true;
        if (isActivityPass) {
            debugChecks.push({
                id: 'activity',
                name: 'MARKET ACTIVITY',
                status: 'PASS',
                weight: 0,
                details: `${activity?.label || 'HIGH ACTIVITY'} (Index: ${activity?.index || 60}/100).`,
            });
            reasons.push('Market activity acceptable for trade entry');
        } else {
            debugChecks.push({
                id: 'activity',
                name: 'MARKET ACTIVITY',
                status: 'FAIL',
                weight: 0,
                details: 'Market activity is below tradable threshold (Low Activity — Wait).',
            });
            conflictReason = 'Low market activity — waiting for volume/tick volatility.';
        }

        // ── Trend vs Reversal Classification ──────────────────────────────────
        let structure: TrendStructure = 'NEUTRAL_RANGE';
        if (trend30 === 'BULLISH') {
            if (trend15 === 'BULLISH' && trend5 === 'BULLISH') {
                structure = 'BULLISH_CONTINUATION';
            } else if (trend5 === 'BEARISH' && cci5?.isPotentialBearishReversal) {
                structure = 'POTENTIAL_BEARISH_REVERSAL';
            } else {
                structure = 'BULLISH_CONTINUATION';
            }
        } else if (trend30 === 'BEARISH') {
            if (trend15 === 'BEARISH' && trend5 === 'BEARISH') {
                structure = 'BEARISH_CONTINUATION';
            } else if (trend5 === 'BULLISH' && cci5?.isPotentialBullishReversal) {
                structure = 'POTENTIAL_BULLISH_REVERSAL';
            } else {
                structure = 'BEARISH_CONTINUATION';
            }
        } else {
            if (cci5?.isConfirmedBullishReversal) {
                structure = 'BULLISH_REVERSAL_CONFIRMED';
            } else if (cci5?.isConfirmedBearishReversal) {
                structure = 'BEARISH_REVERSAL_CONFIRMED';
            }
        }

        // ── Final Signal Synthesis ────────────────────────────────────────────
        let direction: 'RISE' | 'FALL' | 'NONE' = 'NONE';
        let confidence = 0;
        let state: SignalState = 'WAIT';
        const maxScore = 110;

        if (riseScore > fallScore && riseScore >= 45) {
            direction = 'RISE';
            confidence = Math.min(99, Math.round((riseScore / maxScore) * 100));
        } else if (fallScore > riseScore && fallScore >= 45) {
            direction = 'FALL';
            confidence = Math.min(99, Math.round((fallScore / maxScore) * 100));
        } else {
            direction = 'NONE';
            confidence = Math.min(99, Math.round((Math.max(riseScore, fallScore) / maxScore) * 100));
        }

        // Check if there is a severe opposing timeframe conflict
        const hasTimeframeConflict =
            (direction === 'RISE' && (trend15 === 'BEARISH' || trend5 === 'BEARISH')) ||
            (direction === 'FALL' && (trend15 === 'BULLISH' || trend5 === 'BULLISH'));

        if (hasTimeframeConflict) {
            state = 'WAIT';
            conflictReason = 'TIMEFRAME OPPOSITION — AWAITING CONFLUENCE';
        } else if (!isActivityPass) {
            state = 'WAIT';
            conflictReason = 'LOW VOLATILITY — WAITING FOR TICK ACTION';
        } else if (direction === 'RISE') {
            if (confidence >= 80) {
                state = 'STRONG_RISE_SETUP';
            } else if (confidence >= minConfidenceThreshold) {
                state = 'RISE_SIGNAL';
            } else {
                state = 'RISE_WATCH';
            }
        } else if (direction === 'FALL') {
            if (confidence >= 80) {
                state = 'STRONG_FALL_SETUP';
            } else if (confidence >= minConfidenceThreshold) {
                state = 'FALL_SIGNAL';
            } else {
                state = 'FALL_WATCH';
            }
        } else {
            state = 'WAIT';
        }

        const isExecutionReady =
            (state === 'RISE_SIGNAL' ||
                state === 'STRONG_RISE_SETUP' ||
                state === 'FALL_SIGNAL' ||
                state === 'STRONG_FALL_SETUP') &&
            confidence >= minConfidenceThreshold &&
            !hasTimeframeConflict &&
            isActivityPass;

        return {
            state,
            direction,
            confidence,
            structure,
            reasons,
            conflictReason,
            isExecutionReady,
            debugChecks,
            evaluatedAt: Date.now(),
        };
    }
}
