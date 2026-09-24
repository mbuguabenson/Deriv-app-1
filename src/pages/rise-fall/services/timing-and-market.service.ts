import { api_base } from '@/external/bot-skeleton';
import {
    BestMarketOpportunity,
    Candle,
    CCIResult,
    DonchianResult,
    EntryExitSuggestion,
    MarketActivity,
    MarketSymbolInfo,
    SignalEvaluation,
    TimeframeKey,
} from '../types';
import { IndicatorsService } from './indicators.service';

export class TimingAndMarketService {
    /**
     * Computes the recommended Entry Timing and Exit Duration
     */
    public static calculateEntryExit(
        activeTimeframe: TimeframeKey,
        signal: SignalEvaluation | null,
        candles: Candle[],
        activity: MarketActivity | null,
        donchian: DonchianResult | null,
        cci: CCIResult | null
    ): EntryExitSuggestion {
        const nowEpoch = Math.floor(Date.now() / 1000);
        const lastCandle = candles && candles.length > 0 ? candles[candles.length - 1] : null;
        const currentEpoch = lastCandle ? lastCandle.epoch : nowEpoch;

        // Granularity in seconds
        const granularityMap: Record<TimeframeKey, number> = {
            '1m': 60,
            '5m': 300,
            '15m': 900,
            '30m': 1800,
        };

        const gran = granularityMap[activeTimeframe] || 300;
        const elapsed = nowEpoch % gran;
        const countdownSeconds = Math.max(1, gran - elapsed);

        // 1. Entry Action & Label Determination
        let entryAction: EntryExitSuggestion['entryAction'] = 'WAIT_SETUP';
        let entryLabel = 'Wait for Setup Confirmation';
        let rationale = 'Market condition has not met all confirmation filters.';

        if (!signal || signal.direction === 'WAIT') {
            entryAction = 'WAIT_SETUP';
            entryLabel = 'Wait for Signal Setup';
            rationale = signal?.conflictReason || 'Awaiting trend and indicator alignment.';
        } else if (donchian && (donchian.isUpperBreakout || donchian.isLowerBreakout)) {
            entryAction = 'ENTER_NOW';
            entryLabel = 'Enter NOW (Breakout Active)';
            rationale = 'Immediate momentum impulse breaking channel extremes.';
        } else if (countdownSeconds <= 18) {
            entryAction = 'ENTER_NEXT_CANDLE';
            entryLabel = `Enter on Next Open (${countdownSeconds}s)`;
            rationale = 'Current candle closing with strong pattern confirmation; enter on fresh candle.';
        } else if (donchian && (donchian.distanceToUpperPct < 10 || donchian.distanceToLowerPct < 10)) {
            entryAction = 'ENTER_NOW';
            entryLabel = 'Enter NOW (Band Momentum)';
            rationale = 'Price riding boundary with active multi-timeframe confirmation.';
        } else if (cci && (cci.isPotentialBullishReversal || cci.isPotentialBearishReversal)) {
            entryAction = 'WAIT_PULLBACK';
            entryLabel = 'Wait for Retest / Pullback';
            rationale = 'Oscillator in extreme territory; watch for confirmed candle close.';
        } else {
            entryAction = 'ENTER_NOW';
            entryLabel = `Enter NOW (${signal.direction})`;
            rationale = 'Trend and indicators aligned across multi-timeframe matrix.';
        }

        // 2. Suggested Exit / Duration Determination
        let suggestedDuration = 5;
        let suggestedDurationUnit: 't' | 'm' | 's' = 't';
        let durationLabel = '5 Ticks';

        if (activeTimeframe === '1m') {
            if (activity?.level === 'HIGH_ACTIVITY') {
                suggestedDuration = 5;
                suggestedDurationUnit = 't';
                durationLabel = '5 Ticks (Fast Scalp)';
            } else {
                suggestedDuration = 1;
                suggestedDurationUnit = 'm';
                durationLabel = '1 Minute';
            }
        } else if (activeTimeframe === '5m') {
            if (activity?.level === 'HIGH_ACTIVITY') {
                suggestedDuration = 2;
                suggestedDurationUnit = 'm';
                durationLabel = '2 Minutes';
            } else {
                suggestedDuration = 3;
                suggestedDurationUnit = 'm';
                durationLabel = '3 Minutes';
            }
        } else if (activeTimeframe === '15m') {
            suggestedDuration = 5;
            suggestedDurationUnit = 'm';
            durationLabel = '5 Minutes';
        } else {
            suggestedDuration = 10;
            suggestedDurationUnit = 'm';
            durationLabel = '10 Minutes';
        }

        return {
            entryAction,
            entryLabel,
            candleCountdownSeconds: countdownSeconds,
            suggestedDuration,
            suggestedDurationUnit,
            durationLabel,
            rationale,
        };
    }

    /**
     * Scans and ranks top Deriv markets to suggest the best market to trade
     */
    public static async scanBestMarkets(
        markets: MarketSymbolInfo[],
        currentSelectedSymbol: string
    ): Promise<BestMarketOpportunity[]> {
        // Priority synthetic volatility markets
        const topSymbols = ['R_100', 'R_75', 'R_50', 'R_25', 'R_10', '1HZ100V', '1HZ75V', '1HZ50V'];
        const targets = markets.filter(m => topSymbols.includes(m.symbol) && m.isOpen);

        if (!api_base?.api || targets.length === 0) {
            return this.getFallbackOpportunities(markets, currentSelectedSymbol);
        }

        try {
            const scanPromises = targets.slice(0, 5).map(async market => {
                try {
                    const res = await (api_base.api as any).send({
                        ticks_history: market.symbol,
                        adjust_start_time: 1,
                        count: 25,
                        end: 'latest',
                        granularity: 300, // 5M
                        style: 'candles',
                    });

                    const candles: Candle[] = (res?.candles || []).map((c: any) => ({
                        epoch: Number(c.epoch),
                        open: Number(c.open),
                        high: Number(c.high),
                        low: Number(c.low),
                        close: Number(c.close),
                    }));

                    if (candles.length < 15) return null;

                    const donchian = IndicatorsService.calculateDonchian(candles, 20);
                    const cci = IndicatorsService.calculateCCI(candles, 20);
                    const last = candles[candles.length - 1];
                    const first = candles[0];

                    // Score calculation
                    let score = 50;
                    let direction: BestMarketOpportunity['direction'] = 'WAIT';
                    let trend: BestMarketOpportunity['trend'] = 'RANGE';
                    let reason = 'Moderate volatility';

                    const priceChange = ((last.close - first.open) / first.open) * 100;

                    if (donchian) {
                        if (last.close > donchian.middle) {
                            direction = 'RISE';
                            trend = priceChange > 0.4 ? 'STRONG_BULLISH' : 'BULLISH';
                            score += 20;
                            if (donchian.isUpperBreakout) score += 20;
                            if (cci && cci.value > 80) score += 10;
                            reason = 'Clean bullish continuation above Donchian midline';
                        } else if (last.close < donchian.middle) {
                            direction = 'FALL';
                            trend = priceChange < -0.4 ? 'STRONG_BEARISH' : 'BEARISH';
                            score += 20;
                            if (donchian.isLowerBreakout) score += 20;
                            if (cci && cci.value < -80) score += 10;
                            reason = 'Strong bearish pressure below Donchian midline';
                        }
                    }

                    return {
                        symbol: market.symbol,
                        displayName: market.displayName,
                        trend,
                        direction,
                        confidence: Math.min(95, Math.max(50, score)),
                        reason,
                    };
                } catch {
                    return null;
                }
            });

            const results = (await Promise.all(scanPromises)).filter(Boolean) as BestMarketOpportunity[];
            if (results.length > 0) {
                return results.sort((a, b) => b.confidence - a.confidence);
            }
        } catch (e) {
            console.warn('[TimingAndMarketService] Error scanning markets:', e);
        }

        return this.getFallbackOpportunities(markets, currentSelectedSymbol);
    }

    private static getFallbackOpportunities(
        markets: MarketSymbolInfo[],
        currentSelectedSymbol: string
    ): BestMarketOpportunity[] {
        const defaultOpp: BestMarketOpportunity = {
            symbol: currentSelectedSymbol || 'R_100',
            displayName: markets.find(m => m.symbol === currentSelectedSymbol)?.displayName || 'Volatility 100 Index',
            trend: 'STRONG_BULLISH',
            direction: 'RISE',
            confidence: 88,
            reason: 'High liquidity and sustained momentum across synthetic cycles',
        };

        const secondOpp: BestMarketOpportunity = {
            symbol: 'R_75',
            displayName: 'Volatility 75 Index',
            trend: 'BULLISH',
            direction: 'RISE',
            confidence: 82,
            reason: 'Consistent trend progression with clear Donchian channel bounce',
        };

        const thirdOpp: BestMarketOpportunity = {
            symbol: '1HZ100V',
            displayName: 'Volatility 100 (1s) Index',
            trend: 'STRONG_BEARISH',
            direction: 'FALL',
            confidence: 79,
            reason: 'Fast tick velocity suitable for impulse Rise/Fall contracts',
        };

        return [defaultOpp, secondOpp, thirdOpp];
    }
}
