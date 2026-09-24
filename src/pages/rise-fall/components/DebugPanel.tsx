import React from 'react';
import { SignalEvaluation } from '../types';
import { AlertCircle, CheckCircle, Code, ShieldX, Terminal } from 'lucide-react';

interface DebugPanelProps {
    signal: SignalEvaluation | null;
}

export const DebugPanel: React.FC<DebugPanelProps> = ({ signal }) => {
    if (!signal) return null;

    return (
        <div className='rf-card rf-debug-panel'>
            <div className='rf-card__header'>
                <div className='rf-card__title'>
                    <Terminal size={16} />
                    <span>Engine Transparency & Signal Validation Matrix</span>
                </div>
                <span className='rf-badge rf-badge--neutral'>DEBUG AUDIT</span>
            </div>

            <div className='rf-debug-checklist'>
                {signal.debugChecks.map(check => (
                    <div key={check.id} className='rf-debug-row'>
                        <div className='rf-debug-row__left'>
                            <span className='rf-debug-row__name'>{check.name}</span>
                            <span className='rf-debug-row__weight'>[Wt: {check.weight}%]</span>
                        </div>

                        <div className='rf-debug-row__center'>
                            <span className='rf-debug-row__details'>{check.details}</span>
                        </div>

                        <div className='rf-debug-row__right'>
                            {check.status === 'PASS' && (
                                <span className='rf-badge rf-badge--pass'>
                                    <CheckCircle size={11} /> PASS
                                </span>
                            )}
                            {check.status === 'FAIL' && (
                                <span className='rf-badge rf-badge--fail'>
                                    <ShieldX size={11} /> FAIL
                                </span>
                            )}
                            {check.status === 'WARN' && (
                                <span className='rf-badge rf-badge--warn'>
                                    <AlertCircle size={11} /> WARN
                                </span>
                            )}
                        </div>
                    </div>
                ))}
            </div>

            {/* Final Diagnostic Status */}
            <div className='rf-debug-footer'>
                <div className='rf-debug-summary-item'>
                    <span className='rf-debug-label'>CONFLICTS:</span>
                    <span
                        className={
                            signal.conflictReason ? 'rf-text-warning font-semibold' : 'rf-text-bullish font-semibold'
                        }
                    >
                        {signal.conflictReason || 'NONE (ALIGNED)'}
                    </span>
                </div>

                <div className='rf-debug-summary-item'>
                    <span className='rf-debug-label'>FINAL SIGNAL:</span>
                    <span className='font-bold text-accent'>{signal.state}</span>
                </div>

                <div className='rf-debug-summary-item'>
                    <span className='rf-debug-label'>EXECUTION:</span>
                    <span
                        className={`rf-badge ${
                            signal.isExecutionReady ? 'rf-badge--connected' : 'rf-badge--disconnected'
                        }`}
                    >
                        {signal.isExecutionReady ? 'READY' : 'WAIT'}
                    </span>
                </div>
            </div>
        </div>
    );
};
