import React from 'react';
import { RegimeAssessment } from '../types/b254.types';
import { AlertTriangle, BookOpen, CheckCircle, HelpCircle, Info, ShieldAlert } from 'lucide-react';

interface MarketUnderstandingCardProps {
    explanation: string;
    whyNotTradeReasons: string[];
    regime: RegimeAssessment;
    marketLabel: string;
}

export const MarketUnderstandingCard: React.FC<MarketUnderstandingCardProps> = ({
    explanation,
    whyNotTradeReasons,
    regime,
    marketLabel,
}) => {
    return (
        <div className='b254-understanding-grid'>
            {/* ── 1. Clear Market Understanding Card ── */}
            <div className='b254-glass b254-intel-card'>
                <div className='card-head'>
                    <div className='title-wrap'>
                        <BookOpen size={18} className='text-cyan' />
                        <div>
                            <h4>Market Understanding &bull; {marketLabel}</h4>
                            <span className='subtitle'>Multi-Horizon Synthesis &amp; Regime Dynamics</span>
                        </div>
                    </div>

                    <span className={`regime-tag ${regime.regimeStability === 'HIGH' ? 'stable' : regime.regimeStability === 'MODERATE' ? 'moderate' : 'unstable'}`}>
                        {regime.shiftDetected ? '⚠️ 15t REGIME SHIFT' : `REGIME: ${regime.currentRegime}`}
                    </span>
                </div>

                <div className='card-body'>
                    <p className='explanation-text'>
                        {explanation || 'Analyzing incoming ticks to form clear statistical narrative...'}
                    </p>

                    <div className='regime-meta-row'>
                        <div className='meta-item'>
                            <span className='lbl'>Current Regime:</span>
                            <strong>{regime.currentRegime}</strong>
                        </div>
                        <div className='meta-item'>
                            <span className='lbl'>Previous Regime:</span>
                            <strong>{regime.previousRegime}</strong>
                        </div>
                        <div className='meta-item'>
                            <span className='lbl'>Stability:</span>
                            <strong>{regime.regimeStability}</strong>
                        </div>
                        {regime.shiftDetected && (
                            <div className='meta-item alert'>
                                <span className='lbl'>Shift Direction:</span>
                                <strong className='text-orange'>{regime.shiftDirection.replace(/_/g, ' ')}</strong>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* ── 2. Dedicated "Why Not Trade?" Card ── */}
            <div className='b254-glass b254-intel-card why-not-card'>
                <div className='card-head'>
                    <div className='title-wrap'>
                        <HelpCircle size={18} className='text-amber' />
                        <div>
                            <h4>Why Not Trade? (Real-Time Diagnostic)</h4>
                            <span className='subtitle'>Transparent filters preventing low-probability entries</span>
                        </div>
                    </div>

                    <span className={`why-status-tag ${whyNotTradeReasons.length === 0 ? 'good' : 'filtering'}`}>
                        {whyNotTradeReasons.length === 0 ? '✅ ALL CLEAR — READY' : `FILTERING (${whyNotTradeReasons.length})`}
                    </span>
                </div>

                <div className='card-body'>
                    {whyNotTradeReasons.length === 0 ? (
                        <div className='all-good-msg'>
                            <CheckCircle size={18} className='text-green' />
                            <span>All criteria satisfied. Market conditions are optimal for trade execution.</span>
                        </div>
                    ) : (
                        <ul className='reasons-list'>
                            {whyNotTradeReasons.map((reason, idx) => (
                                <li key={idx} className='reason-item'>
                                    <span className='bullet'>&bull;</span>
                                    <span>{reason}</span>
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
            </div>
        </div>
    );
};
