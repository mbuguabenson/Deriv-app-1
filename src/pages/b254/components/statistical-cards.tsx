import React, { useState } from 'react';
import { MultiHorizonBreakdown, DigitPowerItem } from '../types/b254.types';
import { BarChart3, Sparkles, TrendingUp } from 'lucide-react';

interface StatisticalCardsProps {
    multiHorizon: MultiHorizonBreakdown;
    digitPower: {
        items: DigitPowerItem[];
        mostAppearing: number;
        secondMostAppearing: number;
        leastAppearing: number;
        outliersUnder6Safe: boolean;
        outliersOver3Safe: boolean;
    };
}

export const StatisticalCards: React.FC<StatisticalCardsProps> = ({
    multiHorizon,
    digitPower,
}) => {
    const [activeHorizonTab, setActiveHorizonTab] = useState<'50' | '100' | '500' | '1000'>('50');

    const currentStats =
        activeHorizonTab === '50'
            ? multiHorizon.h50
            : activeHorizonTab === '100'
              ? multiHorizon.h100
              : activeHorizonTab === '500'
                ? multiHorizon.h500
                : multiHorizon.h1000;

    return (
        <div className='b254-statistical-cards-grid'>
            {/* ── Card 1: Under (0-4) vs Over (5-9) ── */}
            <div className='b254-glass b254-stat-card'>
                <div className='b254-stat-card__head'>
                    <div className='title-wrap'>
                        <BarChart3 size={18} className='text-cyan' />
                        <div>
                            <h4>Statistical Analysis 1: Under (0–4) vs Over (5–9)</h4>
                            <span className='subtitle'>Threshold &ge; 55% &bull; Trend &amp; Momentum Tracking</span>
                        </div>
                    </div>

                    <div className='horizon-toggle-pill'>
                        {(['50', '100', '500', '1000'] as const).map(tab => (
                            <button
                                key={tab}
                                className={`pill-btn ${activeHorizonTab === tab ? 'active' : ''}`}
                                onClick={() => setActiveHorizonTab(tab)}
                            >
                                {tab}t
                            </button>
                        ))}
                    </div>
                </div>

                <div className='b254-stat-card__body'>
                    <div className='ratio-split-box'>
                        <div className='side under'>
                            <span className='tag'>UNDER (0–4)</span>
                            <strong className='val'>{currentStats.under04} Ticks</strong>
                            <span className='pct'>{currentStats.pctUnder04.toFixed(1)}%</span>
                        </div>
                        <div className='vs-badge'>VS</div>
                        <div className='side over'>
                            <span className='tag'>OVER (5–9)</span>
                            <strong className='val'>{currentStats.over59} Ticks</strong>
                            <span className='pct'>{currentStats.pctOver59.toFixed(1)}%</span>
                        </div>
                    </div>

                    {/* Progress Bar */}
                    <div className='b254-progress-track'>
                        <div className='fill under' style={{ width: `${currentStats.pctUnder04}%` }} />
                        <div className='fill over' style={{ width: `${currentStats.pctOver59}%` }} />
                    </div>

                    {/* Dynamic Momentum Callout */}
                    <div className='b254-momentum-callout'>
                        {currentStats.pctUnder04 >= 55 ? (
                            <span className='tip tip--green'>
                                ⚡ Under 0–4 threshold is above 55% ({currentStats.pctUnder04.toFixed(1)}%) &bull; Strong Under Trend ↗
                            </span>
                        ) : currentStats.pctOver59 >= 55 ? (
                            <span className='tip tip--orange'>
                                ⚡ Over 5–9 threshold is above 55% ({currentStats.pctOver59.toFixed(1)}%) &bull; Strong Over Trend ↗
                            </span>
                        ) : (
                            <span className='tip tip--neutral'>
                                ⚖️ Ratios consolidating in range (&lt; 55% threshold)
                            </span>
                        )}
                    </div>
                </div>
            </div>

            {/* ── Card 2: Under (0-5) vs Over (4-9) ── */}
            <div className='b254-glass b254-stat-card'>
                <div className='b254-stat-card__head'>
                    <div className='title-wrap'>
                        <TrendingUp size={18} className='text-purple' />
                        <div>
                            <h4>Statistical Analysis 2: Under (0–5) vs Over (4–9)</h4>
                            <span className='subtitle'>50-Tick Dominance &bull; Micro 10-Tick 7/10 Rule</span>
                        </div>
                    </div>

                    <span className={`bias-status-badge ${multiHorizon.h50.under05 >= multiHorizon.h50.over49 ? 'under' : 'over'}`}>
                        {multiHorizon.h50.under05 >= multiHorizon.h50.over49 ? '🛡️ UNDER 6 FAVORED' : '🚀 OVER 3 FAVORED'}
                    </span>
                </div>

                <div className='b254-stat-card__body'>
                    <div className='ratio-split-box'>
                        <div className='side under'>
                            <span className='tag'>UNDER (0–5)</span>
                            <strong className='val'>{multiHorizon.h50.under05} Ticks</strong>
                            <span className='pct'>{multiHorizon.h50.pctUnder05.toFixed(1)}%</span>
                        </div>
                        <div className='vs-badge'>VS</div>
                        <div className='side over'>
                            <span className='tag'>OVER (4–9)</span>
                            <strong className='val'>{multiHorizon.h50.over49} Ticks</strong>
                            <span className='pct'>{multiHorizon.h50.pctOver49.toFixed(1)}%</span>
                        </div>
                    </div>

                    {/* Progress Bar */}
                    <div className='b254-progress-track'>
                        <div
                            className='fill under'
                            style={{
                                width: `${(multiHorizon.h50.under05 / ((multiHorizon.h50.under05 + multiHorizon.h50.over49) || 1)) * 100}%`,
                            }}
                        />
                        <div
                            className='fill over'
                            style={{
                                width: `${(multiHorizon.h50.over49 / ((multiHorizon.h50.under05 + multiHorizon.h50.over49) || 1)) * 100}%`,
                            }}
                        />
                    </div>

                    {/* Micro 10-Tick & 7-Tick Rules */}
                    <div className='micro-chips-row'>
                        <div className='chip'>
                            <span className='lbl'>10-Tick Ratio (7/10 Rule):</span>
                            <strong>
                                {multiHorizon.h15.under05 >= 7
                                    ? `✅ ${multiHorizon.h15.under05} Under / ${10 - multiHorizon.h15.under05} Over`
                                    : `${multiHorizon.h15.under05} Under / ${10 - multiHorizon.h15.under05} Over`}
                            </strong>
                        </div>

                        <div className='chip'>
                            <span className='lbl'>50-Tick Dominance Spread:</span>
                            <strong>
                                {Math.abs(multiHorizon.h50.under05 - multiHorizon.h50.over49)} Ticks Edge ({multiHorizon.h50.under05 > multiHorizon.h50.over49 ? 'Under' : 'Over'})
                            </strong>
                        </div>
                    </div>
                </div>
            </div>

            {/* ── Card 3: Digit Power Matrix (0 – 9) ── */}
            <div className='b254-glass b254-stat-card full-width'>
                <div className='b254-stat-card__head'>
                    <div className='title-wrap'>
                        <Sparkles size={18} className='text-gold' />
                        <div>
                            <h4>Digit Power Matrix (Digits 0 – 9)</h4>
                            <span className='subtitle'>1,000-Tick Historical Reference &bull; 50-Tick Recent Intensity &bull; Outlier Safety</span>
                        </div>
                    </div>

                    <div className='rank-badges-row'>
                        <span className='rank-badge most'>🥇 Most: <strong>Digit {digitPower.mostAppearing}</strong></span>
                        <span className='rank-badge second'>🥈 2nd: <strong>Digit {digitPower.secondMostAppearing}</strong></span>
                        <span className='rank-badge least'>🥉 Least: <strong>Digit {digitPower.leastAppearing}</strong></span>
                    </div>
                </div>

                <div className='b254-digit-power-grid'>
                    {digitPower.items.map(item => {
                        const isUnderZone = item.digit <= 5;
                        const isRank1 = item.digit === digitPower.mostAppearing;
                        const isRank2 = item.digit === digitPower.secondMostAppearing;
                        const isRankLeast = item.digit === digitPower.leastAppearing;

                        return (
                            <div
                                key={item.digit}
                                className={`b254-digit-power-cell ${isUnderZone ? 'under-zone' : 'over-zone'} ${isRank1 ? 'rank-1' : ''}`}
                            >
                                <div className='cell-top'>
                                    <div className='digit-badge'>{item.digit}</div>
                                    <div className='rank-tags'>
                                        {isRank1 && <span className='tag gold'>#1</span>}
                                        {isRank2 && <span className='tag silver'>#2</span>}
                                        {isRankLeast && <span className='tag bronze'>LOW</span>}
                                    </div>
                                </div>

                                <div className='counts-row'>
                                    <div className='cnt'>
                                        <span className='lbl'>50t:</span>
                                        <strong>{item.count50} ({item.pct50.toFixed(0)}%)</strong>
                                    </div>
                                    <div className='cnt'>
                                        <span className='lbl'>1k:</span>
                                        <strong>{item.pct1000.toFixed(1)}%</strong>
                                    </div>
                                </div>

                                <div className='strength-track'>
                                    <div
                                        className={`fill ${isUnderZone ? 'under' : 'over'}`}
                                        style={{ width: `${Math.min(100, item.pct50 * 5)}%` }}
                                    />
                                </div>

                                <div className='cell-foot'>
                                    <span className={`trend ${item.trend.toLowerCase()}`}>
                                        {item.trend === 'INCREASING' && '↗ Rising'}
                                        {item.trend === 'DECREASING' && '↘ Safe'}
                                        {item.trend === 'STABLE' && '→ Flat'}
                                    </span>
                                </div>
                            </div>
                        );
                    })}
                </div>

                {/* Outlier Safety Badges */}
                <div className='b254-outliers-footer'>
                    <div className='safety-block'>
                        <span className='lbl'>Under 6 Outlier Safety (Digits 7, 8, 9 &lt; 10% non-increasing):</span>
                        <span className={`safety-tag ${digitPower.outliersUnder6Safe ? 'safe' : 'warn'}`}>
                            {digitPower.outliersUnder6Safe ? '✅ SAFE FOR UNDER 6' : '⚠️ OUTLIER SURGE DETECTED'}
                        </span>
                    </div>

                    <div className='safety-block'>
                        <span className='lbl'>Over 3 Outlier Safety (Digits 0, 1, 2 &lt; 10% non-increasing):</span>
                        <span className={`safety-tag ${digitPower.outliersOver3Safe ? 'safe' : 'warn'}`}>
                            {digitPower.outliersOver3Safe ? '✅ SAFE FOR OVER 3' : '⚠️ OUTLIER SURGE DETECTED'}
                        </span>
                    </div>
                </div>
            </div>

            {/* ── Card 4: Multi-Timeframe Alignment Matrix ── */}
            <div className='b254-glass b254-stat-card full-width'>
                <div className='b254-stat-card__head'>
                    <div className='title-wrap'>
                        <Layers size={18} className='text-blue' />
                        <div>
                            <h4>Multi-Timeframe Horizon Matrix (15t to 1-Hour)</h4>
                            <span className='subtitle'>Cross-Horizon Dominance Alignment &bull; 30-Min &amp; 1-Hour Trend Stability</span>
                        </div>
                    </div>
                </div>

                <div className='b254-multi-horizon-row'>
                    {[
                        { name: '15 Ticks', stat: multiHorizon.h15 },
                        { name: '30 Ticks', stat: multiHorizon.h30 },
                        { name: '50 Ticks', stat: multiHorizon.h50 },
                        { name: '100 Ticks', stat: multiHorizon.h100 },
                        { name: '500 Ticks', stat: multiHorizon.h500 },
                        { name: '1,000 Ticks', stat: multiHorizon.h1000 },
                    ].map(h => (
                        <div key={h.name} className={`horizon-item ${h.stat.bias.toLowerCase()}`}>
                            <span className='name'>{h.name}</span>
                            <strong className='bias'>{h.stat.bias}</strong>
                            <div className='ratios'>
                                <span>U: {h.stat.pctUnder05.toFixed(0)}%</span>
                                <span>O: {h.stat.pctOver49.toFixed(0)}%</span>
                            </div>
                        </div>
                    ))}

                    <div className={`horizon-item history ${multiHorizon.history30m.bias.toLowerCase()}`}>
                        <span className='name'>30-Min History</span>
                        <strong className='bias'>{multiHorizon.history30m.bias}</strong>
                        <div className='ratios'>
                            <span>U: {multiHorizon.history30m.pctUnder.toFixed(0)}%</span>
                            <span>O: {multiHorizon.history30m.pctOver.toFixed(0)}%</span>
                        </div>
                    </div>

                    <div className={`horizon-item history ${multiHorizon.history1h.bias.toLowerCase()}`}>
                        <span className='name'>1-Hour History</span>
                        <strong className='bias'>{multiHorizon.history1h.bias}</strong>
                        <div className='ratios'>
                            <span>U: {multiHorizon.history1h.pctUnder.toFixed(0)}%</span>
                            <span>O: {multiHorizon.history1h.pctOver.toFixed(0)}%</span>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};
