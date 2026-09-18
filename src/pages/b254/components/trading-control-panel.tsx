import React from 'react';
import { CompoundingConfig, B254AutoState, TargetStrategyChoice } from '../types/b254.types';
import { AlertOctagon, Pause, Play, Square, Zap } from 'lucide-react';

interface TradingControlPanelProps {
    config: CompoundingConfig;
    autoState: B254AutoState;
    targetStrategy: TargetStrategyChoice;
    currency: string;
    liveBalance?: number;
    onUpdateConfig: (partial: Partial<CompoundingConfig>) => void;
    onUpdateStrategy: (strat: TargetStrategyChoice) => void;
    onStartAutoTrading: () => void;
    onPauseAutoTrading: () => void;
    onResumeAutoTrading: () => void;
    onStopAutoTrading: () => void;
    onEmergencyStop: () => void;
}

export const TradingControlPanel: React.FC<TradingControlPanelProps> = ({
    config,
    autoState,
    targetStrategy,
    currency,
    liveBalance = 0,
    onUpdateConfig,
    onUpdateStrategy,
    onStartAutoTrading,
    onPauseAutoTrading,
    onResumeAutoTrading,
    onStopAutoTrading,
    onEmergencyStop,
}) => {
    const isRunning = autoState !== 'IDLE';
    const effectiveBalance = liveBalance > 0 ? liveBalance : config.startBalance;
    const calculatedPercentStake = Number(((effectiveBalance * (config.stakePercentage || 2.0)) / 100).toFixed(2));
    const effectiveStake = config.stakeType === 'PERCENTAGE' 
        ? Math.max(0.35, calculatedPercentStake) 
        : config.baseStake;

    return (
        <section className='b254-glass b254-trading-panel'>
            <div className='b254-panel-head'>
                <div className='title-wrap'>
                    <Zap size={18} className='text-amber' />
                    <div>
                        <h3>B254 Automated Trading Engine Controls</h3>
                        <span className='subtitle'>Strict execution bounds &bull; Automatic risk containment</span>
                    </div>
                </div>

                {/* Strategy Mode Selector */}
                <div className='strategy-pills'>
                    <button
                        className={`strat-btn ${targetStrategy === 'AUTO' ? 'active' : ''}`}
                        onClick={() => onUpdateStrategy('AUTO')}
                        disabled={isRunning}
                    >
                        🤖 Auto-Detect (Best Edge)
                    </button>
                    <button
                        className={`strat-btn ${targetStrategy === 'UNDER_6' ? 'active under' : ''}`}
                        onClick={() => onUpdateStrategy('UNDER_6')}
                        disabled={isRunning}
                    >
                        🛡️ Force UNDER 6
                    </button>
                    <button
                        className={`strat-btn ${targetStrategy === 'OVER_3' ? 'active over' : ''}`}
                        onClick={() => onUpdateStrategy('OVER_3')}
                        disabled={isRunning}
                    >
                        🚀 Force OVER 3
                    </button>
                </div>
            </div>

            {/* Inputs Grid */}
            <div className='b254-inputs-grid'>
                {/* Stake Type Selection */}
                <div className='input-box'>
                    <label>Stake Sizing Method</label>
                    <select
                        value={config.stakeType}
                        onChange={e => onUpdateConfig({ stakeType: e.target.value as CompoundingConfig['stakeType'] })}
                        disabled={isRunning}
                    >
                        <option value='FIXED'>Direct Fixed Amount ($)</option>
                        <option value='PERCENTAGE'>Calculated by Capital (%)</option>
                        <option value='COMPOUNDING'>Step Compounding (Target %)</option>
                    </select>
                </div>

                {/* Stake Amount or Percentage Input */}
                {config.stakeType === 'PERCENTAGE' ? (
                    <div className='input-box'>
                        <div className='label-with-toggle'>
                            <label>Capital Risk %</label>
                            <span className='preview-chip text-cyan'>
                                Trade: ${effectiveStake.toFixed(2)} {currency}
                            </span>
                        </div>
                        <input
                            type='number'
                            step='0.5'
                            min='0.5'
                            max='25'
                            value={config.stakePercentage || 2.0}
                            onChange={e => onUpdateConfig({ stakePercentage: Math.max(0.5, Math.min(25, parseFloat(e.target.value) || 2.0)) })}
                            disabled={isRunning}
                        />
                    </div>
                ) : (
                    <div className='input-box'>
                        <label>Base Stake ({currency})</label>
                        <input
                            type='number'
                            step='0.1'
                            min='0.35'
                            value={config.baseStake}
                            onChange={e => onUpdateConfig({ baseStake: Math.max(0.35, parseFloat(e.target.value) || 0.35) })}
                            disabled={isRunning}
                        />
                    </div>
                )}

                {/* Martingale Multiplier */}
                <div className='input-box'>
                    <div className='label-with-toggle'>
                        <label>Martingale Multiplier</label>
                        <label className='b254-toggle-switch'>
                            <input
                                type='checkbox'
                                checked={config.enableMartingale}
                                onChange={e => onUpdateConfig({ enableMartingale: e.target.checked })}
                                disabled={isRunning}
                            />
                            <span className='slider' />
                        </label>
                    </div>
                    <input
                        type='number'
                        step='0.1'
                        min='1.0'
                        value={config.martingaleMultiplier}
                        onChange={e => onUpdateConfig({ martingaleMultiplier: Math.max(1.0, parseFloat(e.target.value) || 2.6) })}
                        disabled={isRunning || !config.enableMartingale}
                    />
                </div>

                {/* Daily Take Profit */}
                <div className='input-box'>
                    <label>Daily Take Profit ({currency})</label>
                    <input
                        type='number'
                        step='1'
                        min='1'
                        value={config.dailyTakeProfit}
                        onChange={e => onUpdateConfig({ dailyTakeProfit: Math.max(1, parseFloat(e.target.value) || 10) })}
                        disabled={isRunning}
                    />
                </div>

                {/* Daily Stop Loss */}
                <div className='input-box'>
                    <label>Daily Stop Loss ({currency})</label>
                    <input
                        type='number'
                        step='1'
                        min='1'
                        value={config.dailyStopLoss}
                        onChange={e => onUpdateConfig({ dailyStopLoss: Math.max(1, parseFloat(e.target.value) || 20) })}
                        disabled={isRunning}
                    />
                </div>

                {/* Signal Score Threshold */}
                <div className='input-box'>
                    <label>Min Signal Score (0–100)</label>
                    <input
                        type='number'
                        step='1'
                        min='50'
                        max='100'
                        value={config.signalScoreThreshold}
                        onChange={e => onUpdateConfig({ signalScoreThreshold: Math.min(100, Math.max(50, parseInt(e.target.value) || 75)) })}
                        disabled={isRunning}
                    />
                </div>

                {/* Max Consecutive Losses */}
                <div className='input-box'>
                    <label>Max Consecutive Losses</label>
                    <input
                        type='number'
                        step='1'
                        min='1'
                        max='10'
                        value={config.maxConsecutiveLosses}
                        onChange={e => onUpdateConfig({ maxConsecutiveLosses: Math.max(1, parseInt(e.target.value) || 4) })}
                        disabled={isRunning}
                    />
                </div>

                {/* Max Stake Cap */}
                <div className='input-box'>
                    <label>Max Stake Cap ({currency})</label>
                    <input
                        type='number'
                        step='1'
                        min='1'
                        value={config.maxStake}
                        onChange={e => onUpdateConfig({ maxStake: Math.max(1, parseFloat(e.target.value) || 50) })}
                        disabled={isRunning}
                    />
                </div>
            </div>

            {/* Action Execution Buttons Row */}
            <div className='b254-actions-row'>
                {autoState === 'IDLE' ? (
                    <button className='b254-btn-action btn-start' onClick={onStartAutoTrading}>
                        <Play size={16} />
                        <span>START B254 AUTOTRADING</span>
                    </button>
                ) : autoState === 'PAUSED' ? (
                    <button className='b254-btn-action btn-resume' onClick={onResumeAutoTrading}>
                        <Play size={16} />
                        <span>RESUME TRADING</span>
                    </button>
                ) : (
                    <button className='b254-btn-action btn-pause' onClick={onPauseAutoTrading}>
                        <Pause size={16} />
                        <span>PAUSE</span>
                    </button>
                )}

                {isRunning && (
                    <button className='b254-btn-action btn-stop' onClick={onStopAutoTrading}>
                        <Square size={16} />
                        <span>STOP</span>
                    </button>
                )}

                {isRunning && (
                    <button className='b254-btn-action btn-emergency' onClick={onEmergencyStop} title='Immediately abort all trades and disconnect engine'>
                        <AlertOctagon size={16} />
                        <span>EMERGENCY STOP</span>
                    </button>
                )}
            </div>
        </section>
    );
};
