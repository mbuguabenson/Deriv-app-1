import React from 'react';
import { B254ManualConfig, B254AutoState } from '../types/b254.types';
import { AlertOctagon, Pause, Play, RotateCcw, Sparkles, Square, Zap } from 'lucide-react';

interface TradingControlPanelProps {
    config: B254ManualConfig;
    autoState: B254AutoState;
    currency: string;
    onUpdateConfig: (partial: Partial<B254ManualConfig>) => void;
    onStartAutoTrading: () => void;
    onPauseAutoTrading: () => void;
    onResumeAutoTrading: () => void;
    onStopAutoTrading: () => void;
    onEmergencyStop: () => void;
    onResetStats: () => void;
}

export const TradingControlPanel: React.FC<TradingControlPanelProps> = ({
    config,
    autoState,
    currency,
    onUpdateConfig,
    onStartAutoTrading,
    onPauseAutoTrading,
    onResumeAutoTrading,
    onStopAutoTrading,
    onEmergencyStop,
    onResetStats,
}) => {
    const isRunning = autoState !== 'IDLE';

    return (
        <section className='b254-glass b254-trading-panel'>
            <div className='b254-panel-head'>
                <div className='title-wrap'>
                    <Zap size={18} className='text-cyan' />
                    <div>
                        <h3>B254 Manual Strategy & Risk Controls</h3>
                        <span className='subtitle'>
                            Full manual parameter control &bull; Autoflipper Under 6 / Over 3 Execution
                        </span>
                    </div>
                </div>

                {/* Strategy Mode Selector */}
                <div className='strategy-pills'>
                    <button
                        className={`strat-btn ${config.targetStrategy === 'AUTO' ? 'active' : ''}`}
                        onClick={() => onUpdateConfig({ targetStrategy: 'AUTO' })}
                        disabled={isRunning}
                    >
                        <Sparkles size={13} />
                        <span>Auto-Detect (Best Edge)</span>
                    </button>
                    <button
                        className={`strat-btn ${config.targetStrategy === 'UNDER_6' ? 'active under' : ''}`}
                        onClick={() => onUpdateConfig({ targetStrategy: 'UNDER_6' })}
                        disabled={isRunning}
                    >
                        <span>🛡️ Force UNDER 6</span>
                    </button>
                    <button
                        className={`strat-btn ${config.targetStrategy === 'OVER_3' ? 'active over' : ''}`}
                        onClick={() => onUpdateConfig({ targetStrategy: 'OVER_3' })}
                        disabled={isRunning}
                    >
                        <span>🚀 Force OVER 3</span>
                    </button>
                </div>
            </div>

            {/* Inputs Grid */}
            <div className='b254-inputs-grid'>
                {/* 1. Base Stake */}
                <div className='input-box'>
                    <label>Base Stake ({currency})</label>
                    <input
                        type='number'
                        step='0.1'
                        min='0.35'
                        value={config.stake}
                        onChange={e => onUpdateConfig({ stake: Math.max(0.35, parseFloat(e.target.value) || 0.35) })}
                        disabled={isRunning}
                    />
                </div>

                {/* 2. Take Profit */}
                <div className='input-box'>
                    <label>Take Profit Target ({currency})</label>
                    <input
                        type='number'
                        step='1'
                        min='1'
                        value={config.takeProfit}
                        onChange={e => onUpdateConfig({ takeProfit: Math.max(1, parseFloat(e.target.value) || 25) })}
                        disabled={isRunning}
                    />
                </div>

                {/* 3. Stop Loss */}
                <div className='input-box'>
                    <label>Stop Loss Limit ({currency})</label>
                    <input
                        type='number'
                        step='1'
                        min='1'
                        value={config.stopLoss}
                        onChange={e => onUpdateConfig({ stopLoss: Math.max(1, parseFloat(e.target.value) || 20) })}
                        disabled={isRunning}
                    />
                </div>

                {/* 4. Martingale Multiplier */}
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

                {/* 5. Max Consecutive Losses */}
                <div className='input-box'>
                    <label>Max Consecutive Losses</label>
                    <input
                        type='number'
                        step='1'
                        min='1'
                        max='10'
                        value={config.maxConsecutiveLosses}
                        onChange={e => onUpdateConfig({ maxConsecutiveLosses: Math.max(1, parseInt(e.target.value, 10) || 5) })}
                        disabled={isRunning}
                    />
                </div>

                {/* 6. Max Stake Ceiling */}
                <div className='input-box'>
                    <label>Max Stake Cap ({currency})</label>
                    <input
                        type='number'
                        step='1'
                        min='1'
                        value={config.maxStake}
                        onChange={e => onUpdateConfig({ maxStake: Math.max(1, parseFloat(e.target.value) || 100) })}
                        disabled={isRunning}
                    />
                </div>

                {/* 7. Trade Duration */}
                <div className='input-box'>
                    <label>Duration (Ticks)</label>
                    <select
                        value={config.tickDuration}
                        onChange={e => onUpdateConfig({ tickDuration: parseInt(e.target.value, 10) || 1 })}
                        disabled={isRunning}
                    >
                        <option value={1}>1 Tick (Fastest)</option>
                        <option value={2}>2 Ticks</option>
                        <option value={3}>3 Ticks</option>
                        <option value={5}>5 Ticks</option>
                    </select>
                </div>

                {/* 8. Min Quality Score */}
                <div className='input-box'>
                    <label>Min Quality Score (50–90%)</label>
                    <input
                        type='number'
                        step='1'
                        min='50'
                        max='90'
                        value={config.minQualityScore}
                        onChange={e => onUpdateConfig({ minQualityScore: Math.min(90, Math.max(50, parseInt(e.target.value, 10) || 65)) })}
                        disabled={isRunning}
                    />
                </div>

                {/* 9. Auto-Switch Markets Toggle */}
                <div className='input-box'>
                    <div className='label-with-toggle'>
                        <label>Auto-Switch Markets</label>
                        <label className='b254-toggle-switch'>
                            <input
                                type='checkbox'
                                checked={config.autoSwitchMarkets}
                                onChange={e => onUpdateConfig({ autoSwitchMarkets: e.target.checked })}
                                disabled={isRunning}
                            />
                            <span className='slider' />
                        </label>
                    </div>
                    <span className='helper-note'>
                        10-min dwell rotation &amp; auto-switches when market degrades
                    </span>
                </div>

                {/* 10. Loss Guard Re-Analysis */}
                <div className='input-box'>
                    <div className='label-with-toggle'>
                        <label>Loss Guard Protection</label>
                        <label className='b254-toggle-switch'>
                            <input
                                type='checkbox'
                                checked={config.lossGuardEnabled}
                                onChange={e => onUpdateConfig({ lossGuardEnabled: e.target.checked })}
                                disabled={isRunning}
                            />
                            <span className='slider' />
                        </label>
                    </div>
                    <span className='helper-note'>
                        Pauses after a loss to re-analyse before martingale recovery
                    </span>
                </div>
            </div>

            {/* Action Execution Buttons Row */}
            <div className='b254-actions-row'>
                {autoState === 'IDLE' ? (
                    <button className='b254-btn-action btn-start' onClick={onStartAutoTrading}>
                        <Play size={16} />
                        <span>START B254 AUTOTRADING</span>
                    </button>
                ) : autoState === 'PAUSED' || autoState === 'LOSS_GUARD' ? (
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
                    <button
                        className='b254-btn-action btn-emergency'
                        onClick={onEmergencyStop}
                        title='Immediately abort all trades and disconnect engine'
                    >
                        <AlertOctagon size={16} />
                        <span>EMERGENCY STOP</span>
                    </button>
                )}

                <button
                    className='b254-btn-action btn-reset'
                    onClick={onResetStats}
                    disabled={isRunning}
                    title='Reset session P&L and win/loss count'
                >
                    <RotateCcw size={15} />
                    <span>RESET STATS</span>
                </button>
            </div>
        </section>
    );
};
