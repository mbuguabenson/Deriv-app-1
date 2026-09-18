import React, { useState } from 'react';
import { ChallengeTimeUnit, CompoundingConfig } from '../types/b254.types';
import { Award, Check, Clock, DollarSign, Percent, Settings, Sparkles, X, Zap } from 'lucide-react';

interface CompoundingSettingsModalProps {
    isOpen: boolean;
    onClose: () => void;
    config: CompoundingConfig;
    onSave: (newConfig: Partial<CompoundingConfig>) => void;
    currency: string;
    liveBalance: number;
}

export const CompoundingSettingsModal: React.FC<CompoundingSettingsModalProps> = ({
    isOpen,
    onClose,
    config,
    onSave,
    currency,
    liveBalance,
}) => {
    const [startBal, setStartBal] = useState(config.startBalance);
    const [targetBal, setTargetBal] = useState(config.targetBalance);
    const [timeUnit, setTimeUnit] = useState<ChallengeTimeUnit>(config.timeUnit || 'DAYS');
    const [durationValue, setDurationValue] = useState(config.durationValue || config.days || 30);
    const [stakeType, setStakeType] = useState<'FIXED' | 'PERCENTAGE' | 'COMPOUNDING'>(config.stakeType || 'FIXED');
    const [baseStake, setBaseStake] = useState(config.baseStake || 0.50);
    const [stakePercentage, setStakePercentage] = useState(config.stakePercentage || 2.0);
    const [dailyTp, setDailyTp] = useState(config.dailyTakeProfit);
    const [dailySl, setDailySl] = useState(config.dailyStopLoss);
    const [reanalysisInterval, setReanalysisInterval] = useState(config.reanalysisIntervalMinutes || 10);
    const [sessionDuration, setSessionDuration] = useState(config.sessionDurationMinutes || 60);

    if (!isOpen) return null;

    const unitSingular = timeUnit === 'DAYS' ? 'Day' : timeUnit === 'HOURS' ? 'Hour' : 'Minute';
    const totalSteps = Math.max(1, durationValue);

    // Dynamically calculate preview growth rate per step
    const previewRate =
        startBal > 0 && targetBal >= startBal && totalSteps > 0
            ? ((Math.pow(targetBal / startBal, 1 / totalSteps) - 1) * 100).toFixed(2)
            : '0.00';

    // Calculate effective starting stake based on mode
    const previewStake =
        stakeType === 'FIXED'
            ? baseStake.toFixed(2)
            : stakeType === 'PERCENTAGE'
              ? ((startBal * stakePercentage) / 100).toFixed(2)
              : Math.max(0.5, (startBal * (parseFloat(previewRate) / 100) * 0.5)).toFixed(2);

    const applyPreset = (presetUnit: ChallengeTimeUnit, duration: number, targetMult: number) => {
        setTimeUnit(presetUnit);
        setDurationValue(duration);
        const currentBal = liveBalance > 0 ? liveBalance : startBal;
        setStartBal(Number(currentBal.toFixed(2)));
        setTargetBal(Number((currentBal * targetMult).toFixed(2)));
    };

    const handleSave = () => {
        onSave({
            startBalance: startBal,
            targetBalance: targetBal,
            durationValue,
            timeUnit,
            days: timeUnit === 'DAYS' ? durationValue : Math.max(1, Math.round(durationValue / (timeUnit === 'HOURS' ? 24 : 1440))),
            stakeType,
            baseStake,
            stakePercentage,
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
                            <h3>Create Challenge / Compounding Plan</h3>
                            <span className='subtitle'>Configure Capital Targets, Time Units (Days/Hours/Mins) &amp; Stake Calculation</span>
                        </div>
                    </div>

                    <button className='b254-btn-close' onClick={onClose}>
                        <X size={18} />
                    </button>
                </div>

                <div className='b254-modal-body'>
                    {/* Quick Challenge Presets */}
                    <div className='b254-challenge-presets'>
                        <span className='preset-title'>Quick Challenge Presets:</span>
                        <div className='preset-btns-row'>
                            <button
                                type='button'
                                className='preset-chip'
                                onClick={() => applyPreset('DAYS', 30, 404)}
                            >
                                <Sparkles size={13} className='text-gold' />
                                <span>30-Day Master ($20 &rarr; $8,080)</span>
                            </button>
                            <button
                                type='button'
                                className='preset-chip'
                                onClick={() => applyPreset('HOURS', 24, 20)}
                            >
                                <Clock size={13} className='text-cyan' />
                                <span>24-Hour Flip (20x Capital)</span>
                            </button>
                            <button
                                type='button'
                                className='preset-chip'
                                onClick={() => applyPreset('MINUTES', 60, 5)}
                            >
                                <Zap size={13} className='text-purple' />
                                <span>60-Minute Sprint (5x Capital)</span>
                            </button>
                        </div>
                    </div>

                    {/* Live Preview Card */}
                    <div className='preview-rate-card'>
                        <div className='card-left'>
                            <Zap size={20} className='text-gold' />
                            <div>
                                <span className='lbl'>Required Compound Growth:</span>
                                <strong className='rate-val'>+{previewRate}% / {unitSingular}</strong>
                            </div>
                        </div>
                        <div className='card-right'>
                            <div className='target-summary'>
                                <span>${startBal.toFixed(2)} &rarr; ${targetBal.toFixed(2)} {currency}</span>
                                <span className='steps-sub'>({totalSteps} {unitSingular}s &bull; Initial Stake: ~${previewStake})</span>
                            </div>
                        </div>
                    </div>

                    {/* Form Controls */}
                    <div className='form-grid'>
                        {/* Time Horizon Unit */}
                        <div className='form-group full-width'>
                            <label>Challenge Horizon Unit</label>
                            <div className='time-unit-pill-selector'>
                                <button
                                    type='button'
                                    className={`unit-pill ${timeUnit === 'DAYS' ? 'active' : ''}`}
                                    onClick={() => setTimeUnit('DAYS')}
                                >
                                    <span>Days Horizon</span>
                                </button>
                                <button
                                    type='button'
                                    className={`unit-pill ${timeUnit === 'HOURS' ? 'active' : ''}`}
                                    onClick={() => setTimeUnit('HOURS')}
                                >
                                    <span>Hours Horizon</span>
                                </button>
                                <button
                                    type='button'
                                    className={`unit-pill ${timeUnit === 'MINUTES' ? 'active' : ''}`}
                                    onClick={() => setTimeUnit('MINUTES')}
                                >
                                    <span>Minutes Horizon</span>
                                </button>
                            </div>
                        </div>

                        {/* Duration Count */}
                        <div className='form-group'>
                            <label>Duration in {unitSingular}s</label>
                            <input
                                type='number'
                                min='1'
                                max='1440'
                                value={durationValue}
                                onChange={e => setDurationValue(Math.max(1, parseInt(e.target.value) || 1))}
                            />
                        </div>

                        {/* Starting Balance */}
                        <div className='form-group'>
                            <div className='label-with-action'>
                                <label>Starting Capital ({currency})</label>
                                {liveBalance > 0 && (
                                    <button
                                        type='button'
                                        className='btn-use-live'
                                        onClick={() => setStartBal(Number(liveBalance.toFixed(2)))}
                                        title='Set to current live wallet balance'
                                    >
                                        Use Wallet (${liveBalance.toFixed(2)})
                                    </button>
                                )}
                            </div>
                            <input
                                type='number'
                                min='0.5'
                                step='0.1'
                                value={startBal}
                                onChange={e => setStartBal(Math.max(0.5, parseFloat(e.target.value) || 0.5))}
                            />
                        </div>

                        {/* Target Balance */}
                        <div className='form-group'>
                            <label>Target Goal ({currency})</label>
                            <input
                                type='number'
                                min='1'
                                step='1'
                                value={targetBal}
                                onChange={e => setTargetBal(Math.max(startBal, parseFloat(e.target.value) || startBal))}
                            />
                        </div>

                        {/* Stake Calculation Mode */}
                        <div className='form-group full-width'>
                            <label>Stake Sizing Mode</label>
                            <div className='stake-mode-selector'>
                                <button
                                    type='button'
                                    className={`mode-btn ${stakeType === 'FIXED' ? 'active' : ''}`}
                                    onClick={() => setStakeType('FIXED')}
                                >
                                    <DollarSign size={14} />
                                    <span>Direct Input Stake ($)</span>
                                </button>
                                <button
                                    type='button'
                                    className={`mode-btn ${stakeType === 'PERCENTAGE' ? 'active' : ''}`}
                                    onClick={() => setStakeType('PERCENTAGE')}
                                >
                                    <Percent size={14} />
                                    <span>Calculated by Capital (%)</span>
                                </button>
                                <button
                                    type='button'
                                    className={`mode-btn ${stakeType === 'COMPOUNDING' ? 'active' : ''}`}
                                    onClick={() => setStakeType('COMPOUNDING')}
                                >
                                    <Award size={14} />
                                    <span>Compounding Step Target</span>
                                </button>
                            </div>
                        </div>

                        {/* Base Stake (Input Amount) */}
                        {stakeType === 'FIXED' && (
                            <div className='form-group'>
                                <label>Base Stake Amount ({currency})</label>
                                <input
                                    type='number'
                                    min='0.35'
                                    step='0.1'
                                    value={baseStake}
                                    onChange={e => setBaseStake(Math.max(0.35, parseFloat(e.target.value) || 0.35))}
                                />
                            </div>
                        )}

                        {/* Stake % of Balance */}
                        {stakeType === 'PERCENTAGE' && (
                            <div className='form-group'>
                                <label>Stake % of Capital Balance</label>
                                <input
                                    type='number'
                                    min='0.5'
                                    max='50'
                                    step='0.5'
                                    value={stakePercentage}
                                    onChange={e => setStakePercentage(Math.max(0.5, parseFloat(e.target.value) || 2.0))}
                                />
                            </div>
                        )}

                        {/* Daily / Session Take Profit */}
                        <div className='form-group'>
                            <label>Take Profit Target ({currency})</label>
                            <input
                                type='number'
                                min='1'
                                value={dailyTp}
                                onChange={e => setDailyTp(Math.max(1, parseFloat(e.target.value) || 10))}
                            />
                        </div>

                        {/* Daily / Session Stop Loss */}
                        <div className='form-group'>
                            <label>Stop Loss Limit ({currency})</label>
                            <input
                                type='number'
                                min='1'
                                value={dailySl}
                                onChange={e => setDailySl(Math.max(1, parseFloat(e.target.value) || 20))}
                            />
                        </div>

                        {/* Reanalysis Checkpoint */}
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

                        {/* Session Duration */}
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
                    </div>
                </div>

                <div className='b254-modal-footer'>
                    <button type='button' className='b254-btn-cancel' onClick={onClose}>
                        Cancel
                    </button>
                    <button type='button' className='b254-btn-save' onClick={handleSave}>
                        <Check size={16} />
                        <span>Launch &amp; Apply Challenge</span>
                    </button>
                </div>
            </div>
        </div>
    );
};
