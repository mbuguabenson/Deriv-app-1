import React from 'react';
import { MarketSymbolInfo, PriceZone, SignalEvaluation, TimeframeAnalysis, TimeframeKey } from '../types';
import { Activity, Layers } from 'lucide-react';

interface LiveAnalysisPanelProps {
    market: MarketSymbolInfo | null;
    currentPrice: number;
    analyses: Record<TimeframeKey, TimeframeAnalysis | null>;
    signal: SignalEvaluation | null;
    zones: PriceZone[];
}

export const LiveAnalysisPanel: React.FC<LiveAnalysisPanelProps> = ({
    market,
    currentPrice,
    analyses,
    signal,
    zones,
}) => {
    const tf5 = analyses['5m'];
    const tf1 = analyses['1m'];
    const tf30 = analyses['30m'];

    const donchian = tf5?.donchian;
    const cci = tf5?.cci;
    const macd = tf5?.macd;
    const candle = tf1?.candle || tf5?.candle;
    const activity = tf5?.activity;

    const nearestZone = zones.length > 0 ? zones[0].label : 'None';

    return (
        <div className='rf-card rf-telemetry-panel'>
            <div className='rf-card__header'>
                <div className='rf-card__title'>
                    <Layers size={14} />
                    <span>Live Telemetry</span>
                </div>
                <span className='rf-telemetry-status'>
                    <span className='rf-telemetry-status__dot' />
                    <span>SYNCED</span>
                </span>
            </div>

            <div className='rf-telemetry-grid'>
                <div className='rf-telemetry-cell'>
                    <span className='rf-telemetry-cell__label'>Trend 30M</span>
                    <span
                        className={`rf-telemetry-cell__value font-bold ${
                            tf30?.trend === 'BULLISH'
                                ? 'rf-text-bullish'
                                : tf30?.trend === 'BEARISH'
                                ? 'rf-text-bearish'
                                : 'rf-text-neutral'
                        }`}
                    >
                        {tf30?.trend || '---'}
                    </span>
                </div>

                <div className='rf-telemetry-cell'>
                    <span className='rf-telemetry-cell__label'>Donchian</span>
                    <span className='rf-telemetry-cell__value'>
                        {donchian?.position === 'UPPER_CHANNEL' && <span className='rf-text-bullish'>Upper</span>}
                        {donchian?.position === 'LOWER_CHANNEL' && <span className='rf-text-bearish'>Lower</span>}
                        {donchian?.position === 'MIDDLE_CHANNEL' && <span className='rf-text-neutral'>Mid</span>}
                        {!donchian && '---'}
                    </span>
                </div>

                <div className='rf-telemetry-cell'>
                    <span className='rf-telemetry-cell__label'>CCI (20)</span>
                    <span className='rf-telemetry-cell__value font-mono'>
                        {cci ? (
                            <span
                                className={
                                    cci.value > 100
                                        ? 'rf-text-bullish'
                                        : cci.value < -100
                                        ? 'rf-text-bearish'
                                        : 'rf-text-neutral'
                                }
                            >
                                {cci.value > 0 ? `+${cci.value}` : cci.value}
                            </span>
                        ) : (
                            '---'
                        )}
                    </span>
                </div>

                <div className='rf-telemetry-cell'>
                    <span className='rf-telemetry-cell__label'>MACD</span>
                    <span className='rf-telemetry-cell__value'>
                        {macd ? (
                            <span
                                className={
                                    macd.condition.includes('BULLISH')
                                        ? 'rf-text-bullish'
                                        : macd.condition.includes('BEARISH')
                                        ? 'rf-text-bearish'
                                        : 'rf-text-neutral'
                                }
                            >
                                {macd.condition.replace(/_MOMENTUM/g, '')}
                            </span>
                        ) : (
                            '---'
                        )}
                    </span>
                </div>

                <div className='rf-telemetry-cell'>
                    <span className='rf-telemetry-cell__label'>Candle</span>
                    <span className='rf-telemetry-cell__value font-semibold'>
                        {candle ? candle.patternLabel.replace(/ \(.*\)/, '') : '---'}
                    </span>
                </div>

                <div className='rf-telemetry-cell'>
                    <span className='rf-telemetry-cell__label'>Activity</span>
                    <span className='rf-telemetry-cell__value'>
                        {activity ? (
                            <span className={activity.isTradable ? 'rf-text-bullish' : 'rf-text-warning'}>
                                {activity.level === 'HIGH_ACTIVITY' ? 'High' : 'Low'}
                            </span>
                        ) : (
                            '---'
                        )}
                    </span>
                </div>
            </div>
        </div>
    );
};
