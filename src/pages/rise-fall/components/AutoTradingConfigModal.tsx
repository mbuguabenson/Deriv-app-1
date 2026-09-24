import React, { useState } from 'react';
import { AutoTradingConfig } from '../types';
import { ShieldCheck, Sliders, TrendingUp, X } from 'lucide-react';

interface AutoTradingConfigModalProps {
    isOpen: boolean;
    config: AutoTradingConfig;
    currency: string;
    onClose: () => void;
    onSave: (config: AutoTradingConfig) => void;
}

export const AutoTradingConfigModal: React.FC<AutoTradingConfigModalProps> = ({
    isOpen,
    config,
    currency,
    onClose,
    onSave,
}) => {
    const [stake, setStake] = useState<number>(config.stake);
    const [duration, setDuration] = useState<number>(config.duration);
    const [durationUnit, setDurationUnit] = useState<'t' | 'm' | 's'>(config.durationUnit);
    const [maxTrades, setMaxTrades] = useState<number>(config.maxTradesPerSession);
    const [maxConsecutiveLosses, setMaxConsecutiveLosses] = useState<number>(config.maxConsecutiveLosses);
    const [sessionStopLoss, setSessionStopLoss] = useState<number>(config.sessionStopLoss);
    const [sessionTakeProfit, setSessionTakeProfit] = useState<number>(config.sessionTakeProfit);
    const [minConfidence, setMinConfidence] = useState<number>(config.minConfidence);
    const [cooldownSeconds, setCooldownSeconds] = useState<number>(config.cooldownSeconds);
    const [pauseOnLowActivity, setPauseOnLowActivity] = useState<boolean>(config.pauseOnLowActivity);
    const [useMartingale, setUseMartingale] = useState<boolean>(config.useMartingale ?? true);
    const [martingaleMultiplier, setMartingaleMultiplier] = useState<number>(config.martingaleMultiplier || 2.1);

    if (!isOpen) return null;

    const handleSave = () => {
        onSave({
            ...config,
            stake: Math.max(0.35, stake),
            duration: Math.max(1, duration),
            durationUnit,
            maxTradesPerSession: Math.max(1, maxTrades),
            maxConsecutiveLosses: Math.max(1, maxConsecutiveLosses),
            sessionStopLoss: Math.max(0, sessionStopLoss),
            sessionTakeProfit: Math.max(0, sessionTakeProfit),
            minConfidence: Math.min(95, Math.max(50, minConfidence)),
            cooldownSeconds: Math.max(2, cooldownSeconds),
            pauseOnLowActivity,
            useMartingale,
            martingaleMultiplier: Math.max(1.0, martingaleMultiplier),
        });
        onClose();
    };

    return (
        <div className='rf-modal-overlay'>
            <div className='rf-modal'>
                <div className='rf-modal__header'>
                    <div className='rf-modal__title'>
                        <Sliders size={18} />
                        <span>Auto Trading Risk & Execution Settings</span>
                    </div>
                    <button className='rf-btn-icon' onClick={onClose}>
                        <X size={18} />
                    </button>
                </div>

                <div className='rf-modal__body'>
                    {/* Execution Parameters */}
                    <div className='rf-form-section'>
                        <div className='rf-form-section__title'>Order Execution Parameters</div>
                        <div className='rf-form-grid'>
                            <div className='rf-form-field'>
                                <label>Stake ({currency || 'USD'})</label>
                                <input
                                    type='number'
                                    step='0.5'
                                    min='0.35'
                                    value={stake}
                                    onChange={e => setStake(Number(e.target.value))}
                                />
                            </div>

                            <div className='rf-form-field'>
                                <label>Duration</label>
                                <div className='rf-duration-input-group'>
                                    <input
                                        type='number'
                                        min='1'
                                        value={duration}
                                        onChange={e => setDuration(Number(e.target.value))}
                                    />
                                    <select
                                        value={durationUnit}
                                        onChange={e => setDurationUnit(e.target.value as 't' | 'm' | 's')}
                                    >
                                        <option value='t'>Ticks</option>
                                        <option value='s'>Seconds</option>
                                        <option value='m'>Minutes</option>
                                    </select>
                                </div>
                            </div>

                            <div className='rf-form-field'>
                                <label>Min Confidence Threshold (%)</label>
                                <input
                                    type='number'
                                    min='50'
                                    max='95'
                                    value={minConfidence}
                                    onChange={e => setMinConfidence(Number(e.target.value))}
                                />
                            </div>

                            <div className='rf-form-field'>
                                <label>Cooldown Between Trades (sec)</label>
                                <input
                                    type='number'
                                    min='2'
                                    max='120'
                                    value={cooldownSeconds}
                                    onChange={e => setCooldownSeconds(Number(e.target.value))}
                                />
                            </div>
                        </div>
                    </div>

                    {/* Money Management & Martingale */}
                    <div className='rf-form-section'>
                        <div className='rf-form-section__title'>
                            <TrendingUp size={15} />
                            <span>Money Management (Martingale Strategy)</span>
                        </div>
                        <div className='rf-form-grid'>
                            <div className='rf-form-field rf-form-field--checkbox'>
                                <label className='rf-checkbox-label'>
                                    <input
                                        type='checkbox'
                                        checked={useMartingale}
                                        onChange={e => setUseMartingale(e.target.checked)}
                                    />
                                    <span>Enable Martingale on Loss</span>
                                </label>
                                <span className='rf-field-hint'>
                                    Multiplies stake after each loss to recover previous losses on next win
                                </span>
                            </div>

                            <div className='rf-form-field'>
                                <label>Martingale Multiplier (x)</label>
                                <input
                                    type='number'
                                    step='0.1'
                                    min='1.0'
                                    max='10.0'
                                    value={martingaleMultiplier}
                                    disabled={!useMartingale}
                                    onChange={e => setMartingaleMultiplier(Number(e.target.value))}
                                />
                                <span className='rf-field-hint'>
                                    Default 2.1x (e.g. ${stake.toFixed(2)} &rarr; ${(stake * martingaleMultiplier).toFixed(2)} &rarr; ${(stake * Math.pow(martingaleMultiplier, 2)).toFixed(2)})
                                </span>
                            </div>
                        </div>
                    </div>

                    {/* Risk & Safety Controls */}
                    <div className='rf-form-section'>
                        <div className='rf-form-section__title'>
                            <ShieldCheck size={15} />
                            <span>Risk & Safety Protections</span>
                        </div>
                        <div className='rf-form-grid'>
                            <div className='rf-form-field'>
                                <label>Max Trades Per Session</label>
                                <input
                                    type='number'
                                    min='1'
                                    value={maxTrades}
                                    onChange={e => setMaxTrades(Number(e.target.value))}
                                />
                            </div>

                            <div className='rf-form-field'>
                                <label>Max Consecutive Losses</label>
                                <input
                                    type='number'
                                    min='1'
                                    value={maxConsecutiveLosses}
                                    onChange={e => setMaxConsecutiveLosses(Number(e.target.value))}
                                />
                            </div>

                            <div className='rf-form-field'>
                                <label>Session Stop Loss ({currency || 'USD'})</label>
                                <input
                                    type='number'
                                    min='0'
                                    step='1'
                                    value={sessionStopLoss}
                                    onChange={e => setSessionStopLoss(Number(e.target.value))}
                                />
                            </div>

                            <div className='rf-form-field'>
                                <label>Session Take Profit ({currency || 'USD'})</label>
                                <input
                                    type='number'
                                    min='0'
                                    step='1'
                                    value={sessionTakeProfit}
                                    onChange={e => setSessionTakeProfit(Number(e.target.value))}
                                />
                            </div>
                        </div>

                        <div className='rf-form-checkbox'>
                            <input
                                type='checkbox'
                                id='rf-pause-low-act'
                                checked={pauseOnLowActivity}
                                onChange={e => setPauseOnLowActivity(e.target.checked)}
                            />
                            <label htmlFor='rf-pause-low-act'>
                                Automatically pause auto-trading during Low Market Activity
                            </label>
                        </div>
                    </div>
                </div>

                <div className='rf-modal__footer'>
                    <button className='rf-btn-secondary' onClick={onClose}>
                        Cancel
                    </button>
                    <button className='rf-btn-primary' onClick={handleSave}>
                        Save & Apply Configuration
                    </button>
                </div>
            </div>
        </div>
    );
};
