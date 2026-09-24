import React from 'react';
import {
    Candle,
    CandleAnalysis,
    CCIResult,
    DonchianResult,
    MACDResult,
    MarketActivity,
    MarketTrendSummary,
    SignalEvaluation,
    TimeframeKey,
    EntryExitSuggestion,
    BestMarketOpportunity,
} from '../types';
import {
    ArrowDownRight,
    ArrowUpRight,
    CheckCircle,
    Clock,
    Compass,
    Minus,
    Sparkles,
    Target,
    TrendingDown,
    TrendingUp,
    Zap,
} from 'lucide-react';

interface AutoAnalysisHudProps {
    enabled: boolean;
    onToggle: () => void;
    marketTrend: MarketTrendSummary | null;
    detectedPatterns: Array<{ index: number; epoch: number; candle: Candle; analysis: CandleAnalysis }>;
    activeTimeframe: TimeframeKey;
    signal: SignalEvaluation | null;
    donchian: DonchianResult | null;
    cci: CCIResult | null;
    macd: MACDResult | null;
    activity: MarketActivity | null;
    entryExit?: EntryExitSuggestion | null;
    onApplyDuration?: (duration: number, unit: 't' | 'm' | 's') => void;
    bestMarket?: BestMarketOpportunity | null;
    onSwitchMarket?: (symbol: string) => void;
    currentSymbol?: string;
}

export const AutoAnalysisHud: React.FC<AutoAnalysisHudProps> = ({
    enabled,
    onToggle,
    marketTrend,
    detectedPatterns,
    activeTimeframe,
    signal,
    donchian,
    cci,
    macd,
    activity,
    entryExit,
    onApplyDuration,
    bestMarket,
    onSwitchMarket,
    currentSymbol,
}) => {
    // Recent 3 detected patterns
    const recentPatterns = detectedPatterns.slice(-3).reverse();

    if (!enabled) {
        return (
            <div className='rf-auto-hud rf-auto-hud--disabled'>
                <div className='rf-auto-hud__disabled-inner'>
                    <div className='rf-auto-hud__disabled-info'>
                        <Sparkles size={14} className='rf-text-muted' />
                        <span className='rf-auto-hud__disabled-text'>Auto Analysis Paused</span>
                    </div>
                    <button className='rf-btn-soft rf-btn-sm' onClick={onToggle}>
                        <Zap size={12} />
                        <span>Enable</span>
                    </button>
                </div>
            </div>
        );
    }

    const isTrendBullish = marketTrend?.direction.includes('BULLISH');
    const isTrendBearish = marketTrend?.direction.includes('BEARISH');

    return (
        <div className='rf-auto-hud'>
            <div className='rf-auto-hud__grid'>
                {/* 1. Market Trend */}
                <div className='rf-hud-item rf-hud-item--trend'>
                    <span className='rf-hud-label'>TREND ({activeTimeframe.toUpperCase()})</span>
                    <div className='rf-hud-value'>
                        <div
                            className={`rf-trend-chip ${
                                isTrendBullish
                                    ? 'rf-trend-chip--bullish'
                                    : isTrendBearish
                                    ? 'rf-trend-chip--bearish'
                                    : 'rf-trend-chip--neutral'
                            }`}
                        >
                            {isTrendBullish ? (
                                <TrendingUp size={13} />
                            ) : isTrendBearish ? (
                                <TrendingDown size={13} />
                            ) : (
                                <Minus size={13} />
                            )}
                            <span className='font-bold'>{marketTrend?.label || 'Analyzing...'}</span>
                            <span className='rf-trend-chip__strength'>{marketTrend?.strength ?? 50}%</span>
                        </div>
                    </div>
                </div>

                {/* 2. Detected Candle Patterns */}
                <div className='rf-hud-item rf-hud-item--patterns'>
                    <span className='rf-hud-label'>CANDLE PATTERNS</span>
                    <div className='rf-hud-value rf-patterns-chips'>
                        {recentPatterns.length === 0 ? (
                            <span className='text-xs text-muted font-mono'>No Pattern Detected</span>
                        ) : (
                            recentPatterns.map((item, idx) => {
                                const a = item.analysis;
                                const isBull = a.isBullish;
                                const isBear = a.isBearish;

                                return (
                                    <div
                                        key={`${item.epoch}-${idx}`}
                                        className={`rf-pattern-tag ${
                                            isBull
                                                ? 'rf-pattern-tag--bullish'
                                                : isBear
                                                ? 'rf-pattern-tag--bearish'
                                                : 'rf-pattern-tag--neutral'
                                        }`}
                                        title={a.patternLabel}
                                    >
                                        <span>
                                            {a.pattern === 'HAMMER' && '🔨 Hammer'}
                                            {a.pattern === 'SHOOTING_STAR' && '⭐ Star'}
                                            {a.pattern === 'BULLISH_ENGULFING' && '⚡ Engulf'}
                                            {a.pattern === 'BEARISH_ENGULFING' && '⚡ Engulf'}
                                            {a.pattern === 'DOJI' && '✝ Doji'}
                                            {a.pattern === 'BREAKOUT_CANDLE' && '🚀 Breakout'}
                                            {a.pattern === 'REJECTION_CANDLE' && '🛡️ Reject'}
                                            {a.pattern === 'STRONG_BULLISH_CANDLE' && '🟢 Bull'}
                                            {a.pattern === 'STRONG_BEARISH_CANDLE' && '🔴 Bear'}
                                            {a.pattern === 'INSIDE_BAR' && '📦 Inside'}
                                            {a.pattern === 'OUTSIDE_BAR' && '↔️ Outside'}
                                            {a.pattern === 'CONTINUATION_CANDLE' && '⏩ Cont'}
                                            {!['HAMMER', 'SHOOTING_STAR', 'BULLISH_ENGULFING', 'BEARISH_ENGULFING', 'DOJI', 'BREAKOUT_CANDLE', 'REJECTION_CANDLE', 'STRONG_BULLISH_CANDLE', 'STRONG_BEARISH_CANDLE', 'INSIDE_BAR', 'OUTSIDE_BAR', 'CONTINUATION_CANDLE'].includes(a.pattern) && a.patternLabel}
                                        </span>
                                    </div>
                                );
                            })
                        )}
                    </div>
                </div>

                {/* 3. Indicators Summary */}
                <div className='rf-hud-item rf-hud-item--indicators'>
                    <span className='rf-hud-label'>INDICATORS</span>
                    <div className='rf-hud-value rf-ind-chips'>
                        <span className='rf-chip' title='Donchian Position'>
                            Donchian:{' '}
                            <b
                                className={
                                    donchian?.position === 'UPPER_CHANNEL'
                                        ? 'rf-text-bullish'
                                        : donchian?.position === 'LOWER_CHANNEL'
                                        ? 'rf-text-bearish'
                                        : 'rf-text-neutral'
                                }
                            >
                                {donchian?.isUpperBreakout
                                    ? 'Breakout'
                                    : donchian?.isLowerBreakout
                                    ? 'Breakdown'
                                    : donchian?.position === 'UPPER_CHANNEL'
                                    ? 'Upper'
                                    : donchian?.position === 'LOWER_CHANNEL'
                                    ? 'Lower'
                                    : 'Mid'}
                            </b>
                        </span>

                        <span className='rf-chip' title='CCI (20)'>
                            CCI:{' '}
                            <b
                                className={
                                    (cci?.value || 0) > 100
                                        ? 'rf-text-bullish font-mono'
                                        : (cci?.value || 0) < -100
                                        ? 'rf-text-bearish font-mono'
                                        : 'rf-text-neutral font-mono'
                                }
                            >
                                {cci ? `${cci.value > 0 ? '+' : ''}${cci.value}` : '---'}
                            </b>
                        </span>

                        <span className='rf-chip' title='MACD Momentum'>
                            MACD:{' '}
                            <b
                                className={
                                    macd?.condition.includes('BULLISH')
                                        ? 'rf-text-bullish'
                                        : macd?.condition.includes('BEARISH')
                                        ? 'rf-text-bearish'
                                        : 'rf-text-neutral'
                                }
                            >
                                {macd ? macd.condition.replace(/_MOMENTUM/g, '') : '---'}
                            </b>
                        </span>
                    </div>
                </div>

                {/* 4. Entry Signal */}
                <div className='rf-hud-item rf-hud-item--signal'>
                    <span className='rf-hud-label'>BIAS</span>
                    <div className='rf-hud-value'>
                        <div
                            className={`rf-signal-chip ${
                                signal?.direction === 'RISE'
                                    ? 'rf-signal-chip--rise'
                                    : signal?.direction === 'FALL'
                                    ? 'rf-signal-chip--fall'
                                    : 'rf-signal-chip--wait'
                            }`}
                        >
                            {signal?.direction === 'RISE' && <ArrowUpRight size={14} />}
                            {signal?.direction === 'FALL' && <ArrowDownRight size={14} />}
                            <span>{signal?.direction === 'RISE' ? 'CALL' : signal?.direction === 'FALL' ? 'PUT' : 'WAIT'}</span>
                            <span className='rf-signal-chip__conf'>{signal?.confidence ?? 0}%</span>
                        </div>
                    </div>
                </div>
            </div>

            {/* Suggested Entry Timing, Optimal Exit, and Best Market */}
            {(entryExit || bestMarket) && (
                <div className='rf-auto-hud__suggestions'>
                    {/* Suggested Entry Timing */}
                    {entryExit && (
                        <div className='rf-hud-suggestion-card'>
                            <div className='rf-hud-suggestion-header'>
                                <Clock size={13} className='rf-text-accent' />
                                <span className='rf-hud-label'>SUGGESTED ENTRY</span>
                            </div>
                            <div className='rf-hud-suggestion-body'>
                                <span
                                    className={`rf-timing-badge rf-timing-badge--${entryExit.entryAction.toLowerCase()}`}
                                >
                                    {entryExit.entryLabel}
                                </span>
                                <span className='rf-hud-suggestion-desc'>{entryExit.rationale}</span>
                            </div>
                        </div>
                    )}

                    {/* Suggested Exit / Expiry Duration */}
                    {entryExit && (
                        <div className='rf-hud-suggestion-card'>
                            <div className='rf-hud-suggestion-header'>
                                <Target size={13} className='rf-text-accent' />
                                <span className='rf-hud-label'>SUGGESTED EXIT</span>
                            </div>
                            <div className='rf-hud-suggestion-body'>
                                <div className='rf-hud-suggestion-action-row'>
                                    <span className='rf-exit-badge font-mono'>
                                        🎯 {entryExit.durationLabel}
                                    </span>
                                    {onApplyDuration && (
                                        <button
                                            type='button'
                                            className='rf-btn-soft rf-btn-xs'
                                            onClick={() =>
                                                onApplyDuration(
                                                    entryExit.suggestedDuration,
                                                    entryExit.suggestedDurationUnit
                                                )
                                            }
                                            title='Apply suggested duration to trading controls'
                                        >
                                            <Zap size={11} />
                                            <span>Apply</span>
                                        </button>
                                    )}
                                </div>
                                <span className='rf-hud-suggestion-desc'>
                                    {activeTimeframe.toUpperCase()} timeframe volatility profile
                                </span>
                            </div>
                        </div>
                    )}

                    {/* Best Market To Trade */}
                    {bestMarket && (
                        <div className='rf-hud-suggestion-card'>
                            <div className='rf-hud-suggestion-header'>
                                <Compass size={13} className='rf-text-accent' />
                                <span className='rf-hud-label'>BEST MARKET TO USE</span>
                            </div>
                            <div className='rf-hud-suggestion-body'>
                                <div className='rf-hud-suggestion-action-row'>
                                    <span className='rf-best-market-name'>
                                        ⭐ {bestMarket.displayName}
                                    </span>
                                    <span className='rf-best-market-score font-mono'>
                                        {bestMarket.confidence}%
                                    </span>
                                    {onSwitchMarket && bestMarket.symbol !== currentSymbol ? (
                                        <button
                                            type='button'
                                            className='rf-btn-soft rf-btn-xs rf-btn-soft--primary'
                                            onClick={() => onSwitchMarket(bestMarket.symbol)}
                                            title={`Switch to ${bestMarket.displayName}`}
                                        >
                                            <span>Switch</span>
                                        </button>
                                    ) : (
                                        <span className='rf-active-market-pill'>
                                            <CheckCircle size={11} /> Active
                                        </span>
                                    )}
                                </div>
                                <span className='rf-hud-suggestion-desc'>{bestMarket.reason}</span>
                            </div>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};
