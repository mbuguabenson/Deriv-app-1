import React from 'react';
import { B254SignalResult } from '../types/b254.types';
import { Activity, Award, ShieldCheck, Target } from 'lucide-react';

interface SignalScoringHudProps {
    signal: B254SignalResult | null;
    currentLastDigit: number;
}

export const SignalScoringHud: React.FC<SignalScoringHudProps> = ({
    signal,
    currentLastDigit,
}) => {
    if (!signal) {
        return (
            <div className='b254-glass b254-signal-hud-placeholder'>
                <Activity size={24} className='spin-icon text-cyan' />
                <span>Accumulating live tick sequence for statistical scoring...</span>
            </div>
        );
    }

    const { score, checklist, direction, prediction, entryDigit, status, isAutoPaused } = signal;
    const isEntryMatch = currentLastDigit === entryDigit;

    return (
        <div className='b254-signal-hud-grid'>
            {/* ── 1. 100-Point Transparent Signal Score Card ── */}
            <div className='b254-glass b254-score-card'>
                <div className='card-head'>
                    <div className='title-wrap'>
                        <Award size={18} className='text-gold' />
                        <div>
                            <h4>100-Point Transparent Signal Score</h4>
                            <span className='subtitle'>Real-time composite probability weight</span>
                        </div>
                    </div>

                    <div className={`score-badge ${score.isPassedThreshold ? 'pass' : 'fail'}`}>
                        <strong>{score.totalScore}</strong> / 100
                    </div>
                </div>

                {/* Meter Bar */}
                <div className='b254-score-meter-track'>
                    <div
                        className={`b254-score-meter-fill ${score.totalScore >= 75 ? 'emerald' : score.totalScore >= 60 ? 'amber' : 'red'}`}
                        style={{ width: `${score.totalScore}%` }}
                    />
                    <div className='threshold-marker' style={{ left: `${score.threshold}%` }}>
                        <span className='marker-lbl'>Min {score.threshold}</span>
                    </div>
                </div>

                {/* Score Component Breakdown Tags */}
                <div className='b254-score-breakdown-list'>
                    {score.explanations.map((exp, idx) => (
                        <span key={idx} className='score-chip'>
                            {exp}
                        </span>
                    ))}
                </div>
            </div>

            {/* ── 2. Glowing Dominant Entry Digit Orb ── */}
            <div className={`b254-glass b254-entry-digit-card ${isEntryMatch ? 'glowing-live' : ''}`}>
                <div className='card-head'>
                    <div className='title-wrap'>
                        <Target size={18} className='text-cyan' />
                        <div>
                            <h4>Dominant Entry Digit Trigger</h4>
                            <span className='subtitle'>
                                {direction === 'UNDER_6' ? 'Strongest Qualifying Digit < 6' : 'Strongest Qualifying Digit > 3'}
                            </span>
                        </div>
                    </div>

                    <span className={`entry-status-badge ${isEntryMatch ? 'match' : 'waiting'}`}>
                        {isEntryMatch ? '⚡ ENTRY READY' : '⏳ WAITING'}
                    </span>
                </div>

                <div className='orb-body'>
                    <div className={`b254-digit-orb-main ${direction === 'UNDER_6' ? 'under' : 'over'} ${isEntryMatch ? 'active-pulse' : ''}`}>
                        <span className='digit-val'>{entryDigit}</span>
                    </div>

                    <div className='orb-meta'>
                        <span className='target-strategy'>{direction.replace('_', ' ')} (Target {prediction})</span>
                        <span className='current-live'>Live Digit: <strong>[{currentLastDigit}]</strong></span>
                        {isEntryMatch && (
                            <span className='match-alert-text'>
                                🎯 Live tick matched dominant entry digit [{entryDigit}]!
                            </span>
                        )}
                    </div>
                </div>
            </div>

            {/* ── 3. 8-Point Systematic Strategy Verification Checklist ── */}
            <div className='b254-glass b254-checklist-card full-width'>
                <div className='card-head'>
                    <div className='title-wrap'>
                        <ShieldCheck size={18} className='text-purple' />
                        <div>
                            <h4>8-Point Systematic Condition Engine ({direction.replace('_', ' ')})</h4>
                            <span className='subtitle'>All conditions must pass before trade execution</span>
                        </div>
                    </div>

                    <span className={`signal-state-tag ${status === 'TRIGGERED' ? 'triggered' : isAutoPaused ? 'paused' : 'waiting'}`}>
                        {status === 'TRIGGERED'
                            ? '🚀 ALL 8 CONDITIONS MET & TRIGGER FIRED'
                            : isAutoPaused
                              ? '⏸ AUTO-PAUSED'
                              : '⏳ WAITING CONDITIONS'}
                    </span>
                </div>

                <div className='b254-checklist-grid'>
                    {/* Cond 0 */}
                    <div className={`check-cell ${checklist.cond0_historyAlignment ? 'pass' : 'fail'}`}>
                        <div className='icon'>{checklist.cond0_historyAlignment ? '✅' : '⏳'}</div>
                        <div className='info'>
                            <span className='name'>Condition 0: 30m &amp; 1h History Alignment</span>
                            <span className='desc'>Macro history agrees with favored direction</span>
                        </div>
                    </div>

                    {/* Cond 1 */}
                    <div className={`check-cell ${checklist.cond1_stat1_threshold55 ? 'pass' : 'fail'}`}>
                        <div className='icon'>{checklist.cond1_stat1_threshold55 ? '✅' : '⏳'}</div>
                        <div className='info'>
                            <span className='name'>Condition 1: Stat Analysis 1 (&ge; 55% Threshold)</span>
                            <span className='desc'>50-tick dominant ratio is above 55%</span>
                        </div>
                    </div>

                    {/* Cond 2 */}
                    <div className={`check-cell ${checklist.cond2_stat2_dominance ? 'pass' : 'fail'}`}>
                        <div className='icon'>{checklist.cond2_stat2_dominance ? '✅' : '⏳'}</div>
                        <div className='info'>
                            <span className='name'>Condition 2: Stat Analysis 2 (50t Dominance)</span>
                            <span className='desc'>Favored side dominant (e.g. 34 vs 25) in 50 ticks</span>
                        </div>
                    </div>

                    {/* Cond 3 */}
                    <div className={`check-cell ${checklist.cond3_micro10_ratio ? 'pass' : 'fail'}`}>
                        <div className='icon'>{checklist.cond3_micro10_ratio ? '✅' : '⏳'}</div>
                        <div className='info'>
                            <span className='name'>Condition 3: Micro 10-Tick 7/10 Ratio Rule</span>
                            <span className='desc'>Last 10 ticks has &ge; 7 in favored direction</span>
                        </div>
                    </div>

                    {/* Cond 4 */}
                    <div className={`check-cell ${checklist.cond4_micro7_continuation ? 'pass' : 'fail'}`}>
                        <div className='icon'>{checklist.cond4_micro7_continuation ? '✅' : '⏳'}</div>
                        <div className='info'>
                            <span className='name'>Condition 4: Micro 7-Tick Continuation</span>
                            <span className='desc'>Last 7 ticks has &ge; 5 in favored direction</span>
                        </div>
                    </div>

                    {/* Cond 5 */}
                    <div className={`check-cell ${checklist.cond5_outlierSafety ? 'pass' : 'fail'}`}>
                        <div className='icon'>{checklist.cond5_outlierSafety ? '✅' : '⏳'}</div>
                        <div className='info'>
                            <span className='name'>Condition 5: 1,000-Tick Outlier Filter</span>
                            <span className='desc'>Counter outliers &lt; 10% each and non-increasing</span>
                        </div>
                    </div>

                    {/* Cond 6 */}
                    <div className={`check-cell ${checklist.cond6_digitPowerSupport ? 'pass' : 'fail'}`}>
                        <div className='icon'>{checklist.cond6_digitPowerSupport ? '✅' : '⏳'}</div>
                        <div className='info'>
                            <span className='name'>Condition 6: Digit Power Zone Support</span>
                            <span className='desc'>Top digits align with strategy zone</span>
                        </div>
                    </div>

                    {/* Cond 7 */}
                    <div className={`check-cell ${checklist.cond7_entryDigitMatch ? 'pass' : 'fail'}`}>
                        <div className='icon'>{checklist.cond7_entryDigitMatch ? '⚡' : '⏳'}</div>
                        <div className='info'>
                            <span className='name'>Condition 7: Entry Digit Match</span>
                            <span className='desc'>Live digit matches dominant trigger [{entryDigit}]</span>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};
