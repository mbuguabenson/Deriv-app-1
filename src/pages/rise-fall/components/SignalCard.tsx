import { SignalEvaluation, EntryExitSuggestion } from '../types';
import {
    ArrowDown,
    ArrowUp,
    CheckCircle2,
    Minus,
    Plus,
    Sliders,
    Zap,
    AlertCircle,
    Clock,
    Target,
} from 'lucide-react';

interface SignalCardProps {
    signal: SignalEvaluation | null;
    isExecuting: boolean;
    onManualTrade: (direction: 'RISE' | 'FALL') => void;
    stake: number;
    duration: number;
    durationUnit: 't' | 'm' | 's';
    currency: string;
    onChangeStake: (newStake: number) => void;
    onChangeDuration: (newDuration: number) => void;
    onChangeDurationUnit: (unit: 't' | 'm' | 's') => void;
    onOpenSettings: () => void;
    autoTradingEnabled: boolean;
    onToggleAutoTrading: () => void;
    entryExit?: EntryExitSuggestion | null;
    autoTradingStatus?: {
        mode: string;
        title: string;
        detail: string;
        badgeClass: string;
    } | null;
    martingaleInfo?: {
        enabled: boolean;
        multiplier: number;
        step: number;
        nextStake: number;
        baseStake: number;
    } | null;
}

export const SignalCard: React.FC<SignalCardProps> = ({
    signal,
    isExecuting,
    onManualTrade,
    stake,
    duration,
    durationUnit,
    currency,
    onChangeStake,
    onChangeDuration,
    onChangeDurationUnit,
    onOpenSettings,
    autoTradingEnabled,
    onToggleAutoTrading,
    entryExit,
    autoTradingStatus,
    martingaleInfo,
}) => {
    const isRise = signal?.direction === 'RISE';
    const isFall = signal?.direction === 'FALL';
    const confidence = signal?.confidence || 0;

    const currentDisplayStake =
        martingaleInfo?.enabled && martingaleInfo.step > 1 ? martingaleInfo.nextStake : stake;

    // Approximate payout calculation (~95% standard Deriv payout for Rise/Fall)
    const estimatedPayout = (currentDisplayStake * 1.95).toFixed(2);

    const handleStakeChange = (delta: number) => {
        const next = Math.max(0.35, Number((stake + delta).toFixed(2)));
        onChangeStake(next);
    };

    const handleDurationChange = (delta: number) => {
        const next = Math.max(1, duration + delta);
        onChangeDuration(next);
    };

    return (
        <div className='rf-card rf-trade-panel'>
            {/* Trade Type Header */}
            <div className='rf-trade-panel__trade-type-header'>
                <div className='rf-trade-panel__type-info'>
                    <div className='rf-trade-panel__type-icon'>
                        <Zap size={16} />
                    </div>
                    <div>
                        <div className='rf-trade-panel__type-title'>Rise / Fall</div>
                        <div className='rf-trade-panel__type-desc'>Classic Options Contract</div>
                    </div>
                </div>

                <button
                    className='rf-btn-icon'
                    onClick={onOpenSettings}
                    title='Configure Risk & Safety Parameters'
                >
                    <Sliders size={16} />
                </button>
            </div>

            {/* DTrader Trade Parameters Form */}
            <div className='rf-trade-params'>
                {/* Duration Control */}
                <div className='rf-param-row'>
                    <label className='rf-param-label'>Duration</label>
                    <div className='rf-param-control'>
                        <button
                            type='button'
                            className='rf-param-btn'
                            onClick={() => handleDurationChange(-1)}
                            disabled={duration <= 1}
                        >
                            <Minus size={13} />
                        </button>
                        <input
                            type='number'
                            min={1}
                            className='rf-param-input'
                            value={duration}
                            onChange={e => onChangeDuration(Math.max(1, Number(e.target.value) || 1))}
                        />
                        <button
                            type='button'
                            className='rf-param-btn'
                            onClick={() => handleDurationChange(1)}
                        >
                            <Plus size={13} />
                        </button>
                        <select
                            className='rf-param-select'
                            value={durationUnit}
                            onChange={e => onChangeDurationUnit(e.target.value as 't' | 'm' | 's')}
                        >
                            <option value='t'>Ticks</option>
                            <option value='s'>Seconds</option>
                            <option value='m'>Minutes</option>
                        </select>
                    </div>
                </div>

                {/* Stake Control */}
                <div className='rf-param-row'>
                    <label className='rf-param-label'>Stake ({currency || 'USD'})</label>
                    <div className='rf-param-control'>
                        <button
                            type='button'
                            className='rf-param-btn'
                            onClick={() => handleStakeChange(-0.5)}
                            disabled={stake <= 0.5}
                        >
                            <Minus size={13} />
                        </button>
                        <input
                            type='number'
                            step='0.5'
                            min='0.35'
                            className='rf-param-input'
                            value={stake}
                            onChange={e => onChangeStake(Math.max(0.35, Number(e.target.value) || 0.35))}
                        />
                        <button
                            type='button'
                            className='rf-param-btn'
                            onClick={() => handleStakeChange(0.5)}
                        >
                            <Plus size={13} />
                        </button>
                        <span className='rf-param-unit-label'>{currency || 'USD'}</span>
                    </div>
                </div>

                {/* Martingale Dynamic Stake Notice */}
                {martingaleInfo?.enabled && (
                    <div className={`rf-martingale-indicator ${martingaleInfo.step > 1 ? 'rf-martingale-indicator--active' : ''}`}>
                        <div className='rf-martingale-indicator__badge'>
                            {martingaleInfo.step > 1 ? `MARTINGALE • STEP ${martingaleInfo.step}` : 'MARTINGALE: 2.1x'}
                        </div>
                        <div className='rf-martingale-indicator__detail font-mono'>
                            {martingaleInfo.step > 1 ? (
                                <span>
                                    Next: <b>${martingaleInfo.nextStake.toFixed(2)}</b> ({martingaleInfo.multiplier}x)
                                </span>
                            ) : (
                                <span>Base: ${martingaleInfo.baseStake.toFixed(2)} &bull; Mult: {martingaleInfo.multiplier}x</span>
                            )}
                        </div>
                    </div>
                )}

                {/* Payout Summary Bar */}
                <div className='rf-param-payout-bar'>
                    <span className='rf-payout-label'>Est. Payout (~95%)</span>
                    <span className='rf-payout-value font-mono'>
                        ${estimatedPayout} {currency || 'USD'}
                    </span>
                </div>
            </div>

            {/* Suggested Entry & Exit Timing Pill */}
            {entryExit && (
                <div className='rf-timing-guidance-pill'>
                    <div className='rf-timing-guidance-item'>
                        <span className='rf-timing-guidance-tag'>Entry</span>
                        <span
                            className={`rf-timing-guidance-val rf-timing-guidance-val--${entryExit.entryAction.toLowerCase()}`}
                        >
                            {entryExit.entryLabel}
                        </span>
                    </div>
                    <div className='rf-timing-guidance-item'>
                        <span className='rf-timing-guidance-tag'>Exit</span>
                        <span className='rf-timing-guidance-val font-mono'>
                            {entryExit.durationLabel}
                        </span>
                        <button
                            type='button'
                            className='rf-btn-soft rf-btn-xs'
                            onClick={() => {
                                onChangeDuration(entryExit.suggestedDuration);
                                onChangeDurationUnit(entryExit.suggestedDurationUnit);
                            }}
                            title={`Apply suggested duration (${entryExit.durationLabel})`}
                        >
                            <Zap size={10} />
                            <span>Apply</span>
                        </button>
                    </div>
                </div>
            )}

            {/* DTrader Signature Purchase Buttons */}
            <div className='rf-purchase-buttons-wrapper'>
                {/* RISE BUTTON */}
                <button
                    className={`btn-purchase btn-purchase--rise ${isRise ? 'btn-purchase--highlight' : ''}`}
                    disabled={isExecuting}
                    onClick={() => onManualTrade('RISE')}
                >
                    <div className='btn-purchase__side-left'>
                        <div className='btn-purchase__icon-circle'>
                            <ArrowUp size={16} />
                        </div>
                        <div className='btn-purchase__action-text'>
                            <span className='btn-purchase__label'>RISE</span>
                            <span className='btn-purchase__sublabel'>Higher</span>
                        </div>
                    </div>
                    <div className='btn-purchase__side-right'>
                        <span className='btn-purchase__payout-amt'>${estimatedPayout}</span>
                        <span className='btn-purchase__payout-label'>Payout</span>
                    </div>
                </button>

                {/* FALL BUTTON */}
                <button
                    className={`btn-purchase btn-purchase--fall ${isFall ? 'btn-purchase--highlight' : ''}`}
                    disabled={isExecuting}
                    onClick={() => onManualTrade('FALL')}
                >
                    <div className='btn-purchase__side-left'>
                        <div className='btn-purchase__icon-circle'>
                            <ArrowDown size={16} />
                        </div>
                        <div className='btn-purchase__action-text'>
                            <span className='btn-purchase__label'>FALL</span>
                            <span className='btn-purchase__sublabel'>Lower</span>
                        </div>
                    </div>
                    <div className='btn-purchase__side-right'>
                        <span className='btn-purchase__payout-amt'>${estimatedPayout}</span>
                        <span className='btn-purchase__payout-label'>Payout</span>
                    </div>
                </button>
            </div>

            {/* Auto Trading Switch Bar */}
            <div className='rf-auto-switch-row'>
                <div className='rf-auto-switch-info'>
                    <span className='rf-auto-switch-title'>Auto-Execution</span>
                    <span className='rf-auto-switch-sub'>
                        {autoTradingEnabled ? 'Active' : 'Manual'}
                    </span>
                </div>
                <button
                    className={`rf-toggle-pill ${autoTradingEnabled ? 'rf-toggle-pill--on' : ''}`}
                    onClick={onToggleAutoTrading}
                    title={autoTradingEnabled ? 'Disable Auto-Trading' : 'Enable Auto-Trading'}
                >
                    <div className='rf-toggle-pill__handle' />
                </button>
            </div>

            {/* Real-Time Auto-Trading HUD Banner */}
            {autoTradingEnabled && autoTradingStatus && (
                <div className={`rf-auto-status-banner ${autoTradingStatus.badgeClass}`}>
                    <div className='rf-auto-status-banner__top'>
                        <span className='rf-auto-status-pulse' />
                        <span className='rf-auto-status-title'>{autoTradingStatus.title}</span>
                    </div>
                    <span className='rf-auto-status-detail'>{autoTradingStatus.detail}</span>
                </div>
            )}

            {/* Signal & Evidence Card Section */}
            <div className='rf-signal-diagnostic-box'>
                <div className='rf-signal-diagnostic-header'>
                    <span className='rf-diagnostic-title'>SIGNAL BIAS</span>
                    <span className='rf-diagnostic-confidence font-mono'>{confidence}%</span>
                </div>

                <div
                    className={`rf-diagnostic-badge rf-diagnostic-badge--${
                        signal ? signal.state.toLowerCase() : 'wait'
                    }`}
                >
                    {signal?.state.replace(/_/g, ' ') || 'ANALYZING MARKET'}
                </div>

                {signal?.conflictReason && (
                    <div className='rf-conflict-banner'>
                        <AlertCircle size={12} />
                        <span>{signal.conflictReason}</span>
                    </div>
                )}
            </div>
        </div>
    );
};
