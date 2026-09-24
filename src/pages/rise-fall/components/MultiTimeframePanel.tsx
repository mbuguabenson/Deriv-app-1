import React from 'react';
import { SignalEvaluation, TimeframeAnalysis, TimeframeKey } from '../types';
import {
    ArrowRight,
    CheckCircle2,
    Clock,
    Layers,
    Minus,
    TrendingDown,
    TrendingUp,
    Zap,
    AlertCircle,
} from 'lucide-react';

interface MultiTimeframePanelProps {
    analyses: Record<TimeframeKey, TimeframeAnalysis | null>;
    signal: SignalEvaluation | null;
}

interface TFConfig {
    key: TimeframeKey;
    label: string;
    sublabel: string;
    role: string;
}

const TF_CONFIGS: TFConfig[] = [
    { key: '30m', label: '30M', sublabel: '30 Minutes', role: 'Major Trend' },
    { key: '15m', label: '15M', sublabel: '15 Minutes', role: 'Structure' },
    { key: '5m', label: '5M', sublabel: '5 Minutes', role: 'Trigger Setup' },
    { key: '1m', label: '1M', sublabel: '1 Minute', role: 'Entry Timing' },
];

export const MultiTimeframePanel: React.FC<MultiTimeframePanelProps> = ({
    analyses,
    signal,
}) => {
    // Count aligned timeframes
    const primaryTrend = analyses['30m']?.trend || 'RANGE';
    const alignedCount = (['30m', '15m', '5m', '1m'] as TimeframeKey[]).filter(
        tf => analyses[tf]?.trend === primaryTrend && primaryTrend !== 'RANGE'
    ).length;

    const alignmentLabel =
        alignedCount === 4
            ? '4/4 Full Alignment'
            : alignedCount === 3
            ? '3/4 Strong Bias'
            : alignedCount === 2
            ? '2/4 Partial Alignment'
            : 'Consolidation / Mixed';

    const alignmentClass =
        alignedCount === 4
            ? 'rf-alignment-badge--full'
            : alignedCount === 3
            ? 'rf-alignment-badge--strong'
            : 'rf-alignment-badge--mixed';

    return (
        <div className='rf-card rf-multi-tf-panel'>
            {/* Header: Title, Subtitle, Regime, and Alignment Meter */}
            <div className='rf-card__header rf-multi-tf-panel__header'>
                <div className='rf-multi-tf-panel__title-group'>
                    <div className='rf-multi-tf-panel__icon-box'>
                        <Layers size={15} />
                    </div>
                    <div>
                        <div className='rf-card__title'>Multi-Timeframe Market Structure</div>
                        <div className='rf-multi-tf-panel__subtitle'>
                            Higher-Timeframe Trend ➔ Lower-Timeframe Precision Execution
                        </div>
                    </div>
                </div>

                <div className='rf-multi-tf-panel__header-badges'>
                    <span className={`rf-alignment-badge ${alignmentClass}`}>
                        {alignmentLabel}
                    </span>
                    {signal && (
                        <span
                            className={`rf-badge rf-badge--structure rf-badge--${signal.structure.toLowerCase()}`}
                        >
                            {signal.structure.replace(/_/g, ' ')}
                        </span>
                    )}
                </div>
            </div>

            {/* 4 Timeframe Structure Matrix Grid */}
            <div className='rf-mtf-matrix'>
                {TF_CONFIGS.map((cfg, idx) => {
                    const analysis = analyses[cfg.key];
                    const isBullish = analysis?.trend === 'BULLISH';
                    const isBearish = analysis?.trend === 'BEARISH';

                    const donchian = analysis?.donchian;
                    const cci = analysis?.cci;
                    const macd = analysis?.macd;
                    const candle = analysis?.candle;

                    // Channel position label
                    const channelPos = donchian?.isUpperBreakout
                        ? '🚀 Upper Breakout'
                        : donchian?.isLowerBreakout
                        ? '🔻 Lower Breakdown'
                        : donchian?.position === 'UPPER_CHANNEL'
                        ? 'Upper Band'
                        : donchian?.position === 'LOWER_CHANNEL'
                        ? 'Lower Band'
                        : 'Mid Channel';

                    // Next timeframe alignment connector
                    const nextAnalysis = idx < 3 ? analyses[TF_CONFIGS[idx + 1].key] : null;
                    const isCascaded =
                        nextAnalysis &&
                        analysis &&
                        analysis.trend === nextAnalysis.trend &&
                        analysis.trend !== 'RANGE';

                    return (
                        <React.Fragment key={cfg.key}>
                            <div
                                className={`rf-mtf-card ${
                                    isBullish
                                        ? 'rf-mtf-card--bullish'
                                        : isBearish
                                        ? 'rf-mtf-card--bearish'
                                        : 'rf-mtf-card--neutral'
                                }`}
                            >
                                {/* Card Header: Timeframe + Trend Direction */}
                                <div className='rf-mtf-card__header'>
                                    <div className='rf-mtf-card__tf-badge'>
                                        <span className='rf-mtf-card__tf-code'>{cfg.label}</span>
                                        <span className='rf-mtf-card__tf-role'>{cfg.role}</span>
                                    </div>
                                    <div
                                        className={`rf-mtf-card__trend-pill ${
                                            isBullish
                                                ? 'rf-mtf-card__trend-pill--bullish'
                                                : isBearish
                                                ? 'rf-mtf-card__trend-pill--bearish'
                                                : 'rf-mtf-card__trend-pill--neutral'
                                        }`}
                                    >
                                        {isBullish ? (
                                            <TrendingUp size={12} />
                                        ) : isBearish ? (
                                            <TrendingDown size={12} />
                                        ) : (
                                            <Minus size={12} />
                                        )}
                                        <span>{analysis ? analysis.trend : 'SCANNING'}</span>
                                    </div>
                                </div>

                                {/* Channel & Indicator Telemetry Grid */}
                                <div className='rf-mtf-card__body'>
                                    <div className='rf-mtf-card__row'>
                                        <span className='rf-mtf-card__prop'>Structure:</span>
                                        <span className='rf-mtf-card__val font-bold'>{channelPos}</span>
                                    </div>

                                    <div className='rf-mtf-card__row'>
                                        <span className='rf-mtf-card__prop'>Momentum:</span>
                                        <span
                                            className={`rf-mtf-card__val ${
                                                macd?.condition.includes('BULLISH')
                                                    ? 'rf-text-bullish'
                                                    : macd?.condition.includes('BEARISH')
                                                    ? 'rf-text-bearish'
                                                    : 'rf-text-neutral'
                                            }`}
                                        >
                                            {macd ? macd.condition.replace(/_MOMENTUM/g, '') : '---'}
                                        </span>
                                    </div>

                                    <div className='rf-mtf-card__row'>
                                        <span className='rf-mtf-card__prop'>CCI ({cfg.label}):</span>
                                        <span
                                            className={`rf-mtf-card__val font-mono ${
                                                (cci?.value || 0) > 100
                                                    ? 'rf-text-bullish'
                                                    : (cci?.value || 0) < -100
                                                    ? 'rf-text-bearish'
                                                    : 'rf-text-neutral'
                                            }`}
                                        >
                                            {cci ? `${cci.value > 0 ? '+' : ''}${cci.value}` : '---'}
                                        </span>
                                    </div>

                                    {candle && candle.pattern !== 'NEUTRAL_CANDLE' && (
                                        <div className='rf-mtf-card__row'>
                                            <span className='rf-mtf-card__prop'>Candle:</span>
                                            <span className='rf-mtf-card__val rf-text-accent'>
                                                {candle.patternLabel}
                                            </span>
                                        </div>
                                    )}
                                </div>

                                {/* Status Footer Badge */}
                                <div className='rf-mtf-card__footer'>
                                    {cfg.key === '1m' ? (
                                        analysis?.entryReady ? (
                                            <div className='rf-mtf-card__status rf-mtf-card__status--ready'>
                                                <Zap size={11} />
                                                <span>ENTRY READY</span>
                                            </div>
                                        ) : (
                                            <div className='rf-mtf-card__status rf-mtf-card__status--wait'>
                                                <Clock size={11} />
                                                <span>AWAITING CLOSE</span>
                                            </div>
                                        )
                                    ) : analysis?.confirmed ? (
                                        <div className='rf-mtf-card__status rf-mtf-card__status--confirmed'>
                                            <CheckCircle2 size={11} />
                                            <span>CONFIRMED</span>
                                        </div>
                                    ) : (
                                        <div className='rf-mtf-card__status rf-mtf-card__status--unconfirmed'>
                                            <AlertCircle size={11} />
                                            <span>PENDING</span>
                                        </div>
                                    )}
                                </div>
                            </div>

                            {/* Cascade Connector */}
                            {idx < 3 && (
                                <div
                                    className={`rf-mtf-connector ${
                                        isCascaded ? 'rf-mtf-connector--aligned' : ''
                                    }`}
                                >
                                    <ArrowRight size={13} />
                                </div>
                            )}
                        </React.Fragment>
                    );
                })}
            </div>
        </div>
    );
};
