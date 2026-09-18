import React, { useState } from 'react';
import { CompoundingConfig } from '../types/b254.types';
import { Check, Settings, X } from 'lucide-react';

interface CompoundingSettingsModalProps {
    isOpen: boolean;
    onClose: () => void;
    config: CompoundingConfig;
    onSave: (newConfig: Partial<CompoundingConfig>) => void;
    currency: string;
}

export const CompoundingSettingsModal: React.FC<CompoundingSettingsModalProps> = ({
    isOpen,
    onClose,
    config,
    onSave,
    currency,
}) => {
    const [startBal, setStartBal] = useState(config.startBalance);
    const [targetBal, setTargetBal] = useState(config.targetBalance);
    const [days, setDays] = useState(config.days);
    const [reanalysisInterval, setReanalysisInterval] = useState(config.reanalysisIntervalMinutes);
    const [sessionDuration, setSessionDuration] = useState(config.sessionDurationMinutes);
    const [dailyTp, setDailyTp] = useState(config.dailyTakeProfit);
    const [dailySl, setDailySl] = useState(config.dailyStopLoss);

    if (!isOpen) return null;

    // Dynamically calculate preview daily rate
    const previewDailyRate =
        startBal > 0 && targetBal >= startBal && days > 0
            ? ((Math.pow(targetBal / startBal, 1 / days) - 1) * 100).toFixed(2)
            : '0.00';

    const handleSave = () => {
        onSave({
            startBalance: startBal,
            targetBalance: targetBal,
            days,
            reanalysisIntervalMinutes: reanalysisInterval,
            sessionDurationMinutes: sessionDuration,
            dailyTakeProfit: dailyTp,
            dailyStopLoss: dailySl,
        });
        onClose();
    };

    return (
        <div className='b254-modal-backdrop' onClick={onClose}>
            <div className='b254-glass b254-settings-modal' onClick={e => e.stopPropagation()}>
                <div className='b254-modal-header'>
                    <div className='title-wrap'>
                        <Settings size={22} className='text-cyan' />
                        <div>
                            <h3>Compounding Goal &amp; Session Configuration</h3>
                            <span className='subtitle'>Customize targets, time horizon &amp; risk containment</span>
                        </div>
                    </div>

                    <button className='b254-btn-close' onClick={onClose}>
                        <X size={18} />
                    </button>
                </div>

                <div className='b254-modal-body'>
                    {/* Live Preview Card */}
                    <div className='preview-rate-card'>
                        <div className='card-left'>
                            <Zap size={20} className='text-gold' />
                            <div>
                                <span className='lbl'>Required Daily Growth:</span>
                                <strong className='rate-val'>+{previewDailyRate}% / day</strong>
                            </div>
                        </div>
                        <div className='card-right'>
                            <span>${startBal.toFixed(2)} &rarr; ${targetBal.toFixed(2)} over {days} Days</span>
                        </div>
                    </div>

                    {/* Inputs */}
                    <div className='form-grid'>
                        <div className='form-group'>
                            <label>Starting Balance ({currency})</label>
                            <input
                                type='number'
                                min='1'
                                value={startBal}
                                onChange={e => setStartBal(Math.max(1, parseFloat(e.target.value) || 1))}
                            />
                        </div>

                        <div className='form-group'>
                            <label>Target End Balance ({currency})</label>
                            <input
                                type='number'
                                min='1'
                                value={targetBal}
                                onChange={e => setTargetBal(Math.max(1, parseFloat(e.target.value) || 1))}
                            />
                        </div>

                        <div className='form-group'>
                            <label>Compounding Horizon (Days)</label>
                            <input
                                type='number'
                                min='1'
                                max='365'
                                value={days}
                                onChange={e => setDays(Math.max(1, parseInt(e.target.value) || 1))}
                            />
                        </div>

                        <div className='form-group'>
                            <label>Reanalysis Interval (Minutes)</label>
                            <input
                                type='number'
                                min='1'
                                max='60'
                                value={reanalysisInterval}
                                onChange={e => setReanalysisInterval(Math.max(1, parseInt(e.target.value) || 10))}
                            />
                        </div>

                        <div className='form-group'>
                            <label>Session Duration (Minutes)</label>
                            <input
                                type='number'
                                min='5'
                                max='1440'
                                value={sessionDuration}
                                onChange={e => setSessionDuration(Math.max(5, parseInt(e.target.value) || 60))}
                            />
                        </div>

                        <div className='form-group'>
                            <label>Daily Take Profit ({currency})</label>
                            <input
                                type='number'
                                min='1'
                                value={dailyTp}
                                onChange={e => setDailyTp(Math.max(1, parseFloat(e.target.value) || 10))}
                            />
                        </div>

                        <div className='form-group'>
                            <label>Daily Stop Loss ({currency})</label>
                            <input
                                type='number'
                                min='1'
                                value={dailySl}
                                onChange={e => setDailySl(Math.max(1, parseFloat(e.target.value) || 20))}
                            />
                        </div>
                    </div>
                </div>

                <div className='b254-modal-footer'>
                    <button className='b254-btn-cancel' onClick={onClose}>
                        Cancel
                    </button>
                    <button className='b254-btn-save' onClick={handleSave}>
                        <Check size={16} />
                        <span>Save &amp; Apply Changes</span>
                    </button>
                </div>
            </div>
        </div>
    );
};
