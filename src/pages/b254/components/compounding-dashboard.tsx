import React from 'react';
import { CompoundingConfig, CompoundingProgress, SessionState, B254AutoState } from '../types/b254.types';
import { Activity, Award, CheckCircle2, Clock, DollarSign, Flame, PlusCircle, RefreshCw, Target, TrendingUp, Zap } from 'lucide-react';

interface CompoundingDashboardProps {
    config: CompoundingConfig;
    progress: CompoundingProgress;
    session: SessionState;
    autoState: B254AutoState;
    currency: string;
    onOpenScheduleModal: () => void;
    onOpenSettingsModal: () => void;
}

export const CompoundingDashboard: React.FC<CompoundingDashboardProps> = ({
    config,
    progress,
    session,
    autoState,
    currency,
    onOpenScheduleModal,
    onOpenSettingsModal,
}) => {
    const formatTime = (seconds: number) => {
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    };

    const durationValue = config.durationValue || config.days || 30;
    const unitLabel = progress.unitLabel || (config.timeUnit === 'HOURS' ? 'Hours' : config.timeUnit === 'MINUTES' ? 'Minutes' : 'Days');
    const singleUnit = unitLabel.endsWith('s') ? unitLabel.slice(0, -1) : unitLabel;

    return (
        <section className='b254-glass b254-compounding-dashboard'>
            {/* Header / Session Stats Row */}
            <div className='b254-compounding-header'>
                <div className='b254-title-meta'>
                    <div className='b254-logo-badge'>
                        <Flame size={20} className='flame-icon' />
                        <span className='b254-brand-name'>B254</span>
                    </div>
                    <div>
                        <h2 className='b254-main-title'>
                            {config.challengeName || 'B254 High-Frequency Compounding Challenge'}
                        </h2>
                        <span className='b254-sub-title'>
                            {durationValue} {unitLabel} Target: ${config.startBalance.toFixed(2)} &rarr; ${config.targetBalance.toFixed(2)} &bull; Stake: {config.stakeType === 'PERCENTAGE' ? `${config.stakePercentage || 2}% of Capital` : config.stakeType === 'FIXED' ? `$${config.baseStake.toFixed(2)} Fixed` : 'Compounding'}
                        </span>
                    </div>
                </div>

                <div className='b254-header-actions'>
                    <button
                        className='b254-btn-glass b254-btn-new-challenge'
                        onClick={onOpenSettingsModal}
                        title='Create New Challenge or Customize Goals'
                    >
                        <PlusCircle size={15} className='text-cyan' />
                        <span>New Challenge</span>
                    </button>

                    <button
                        className='b254-btn-glass b254-btn-schedule'
                        onClick={onOpenScheduleModal}
                        title='View Step-by-Step Compounding Plan Table'
                    >
                        <Award size={15} className='text-gold' />
                        <span>Growth Schedule ({durationValue} {unitLabel})</span>
                    </button>

                    <button
                        className='b254-btn-glass b254-btn-config'
                        onClick={onOpenSettingsModal}
                        title='Configure Compounding & Risk Parameters'
                    >
                        <Target size={15} />
                        <span>Config</span>
                    </button>

                    <div className={`b254-engine-pill b254-engine-pill--${autoState.toLowerCase()}`}>
                        <span className='dot' />
                        <span>
                            {autoState === 'IDLE' && 'ENGINE IDLE'}
                            {autoState === 'SCANNING' && 'SCANNING CRITERIA'}
                            {autoState === 'WAITING_TRIGGER' && 'WAITING ENTRY DIGIT'}
                            {autoState === 'TRADING' && 'EXECUTING TRADE'}
                            {autoState === 'PAUSED' && 'AUTO PAUSED'}
                        </span>
                    </div>
                </div>
            </div>

            {/* Metrics Ribbon Grid */}
            <div className='b254-metrics-grid'>
                {/* 1. Account Balance */}
                <div className='b254-metric-card primary'>
                    <div className='card-top'>
                        <span className='label'>ACCOUNT BALANCE</span>
                        <DollarSign size={16} className='icon text-cyan' />
                    </div>
                    <div className='value-row'>
                        <strong className='value'>${progress.actualBalance.toFixed(2)}</strong>
                        <span className='currency'>{currency}</span>
                    </div>
                    <span className='sub-text'>Real Live Wallet</span>
                </div>

                {/* 2. Starting Balance */}
                <div className='b254-metric-card'>
                    <div className='card-top'>
                        <span className='label'>START SEED</span>
                        <TrendingUp size={16} className='icon text-purple' />
                    </div>
                    <div className='value-row'>
                        <strong className='value'>${config.startBalance.toFixed(2)}</strong>
                    </div>
                    <span className='sub-text'>Baseline Capital</span>
                </div>

                {/* 3. Target End Balance */}
                <div className='b254-metric-card'>
                    <div className='card-top'>
                        <span className='label'>CHALLENGE GOAL</span>
                        <Award size={16} className='icon text-amber' />
                    </div>
                    <div className='value-row'>
                        <strong className='value'>${config.targetBalance.toFixed(2)}</strong>
                    </div>
                    <span className='sub-text'>{durationValue} {unitLabel} Target</span>
                </div>

                {/* 4. Current Step (Day / Hour / Minute) */}
                <div className='b254-metric-card'>
                    <div className='card-top'>
                        <span className='label'>CURRENT {singleUnit.toUpperCase()}</span>
                        <Activity size={16} className='icon text-blue' />
                    </div>
                    <div className='value-row'>
                        <strong className='value'>{singleUnit} {progress.currentStep || progress.currentTradingDay}</strong>
                        <span className='total-days'>/ {progress.totalSteps || durationValue}</span>
                    </div>
                    <span className='sub-text'>Target Rate: +{progress.requiredStepGrowthPct || progress.requiredDailyGrowthPct}%/{singleUnit}</span>
                </div>

                {/* 5. Step Target Balance */}
                <div className='b254-metric-card'>
                    <div className='card-top'>
                        <span className='label'>{singleUnit.toUpperCase()} TARGET</span>
                        <CheckCircle2 size={16} className='icon text-emerald' />
                    </div>
                    <div className='value-row'>
                        <strong className='value'>${(progress.stepTargetBalance || progress.dailyTargetBalance).toFixed(2)}</strong>
                    </div>
                    <span className={`sub-text ${progress.differenceFromTarget >= 0 ? 'text-green' : 'text-orange'}`}>
                        {progress.differenceFromTarget >= 0
                            ? `Ahead by +$${progress.differenceFromTarget.toFixed(2)}`
                            : `Deficit: -$${Math.abs(progress.differenceFromTarget).toFixed(2)}`}
                    </span>
                </div>

                {/* 6. Session Profit / Loss */}
                <div className='b254-metric-card'>
                    <div className='card-top'>
                        <span className='label'>SESSION P/L</span>
                        <Zap size={16} className={`icon ${session.dailyProfit >= 0 ? 'text-green' : 'text-red'}`} />
                    </div>
                    <div className='value-row'>
                        <strong className={`value ${session.dailyProfit >= 0 ? 'text-green' : 'text-red'}`}>
                            {session.dailyProfit >= 0 ? '+' : ''}${session.dailyProfit.toFixed(2)}
                        </strong>
                    </div>
                    <span className='sub-text'>{session.tradesThisSession} trades executed</span>
                </div>

                {/* 7. Progress % */}
                <div className='b254-metric-card'>
                    <div className='card-top'>
                        <span className='label'>PROGRESS %</span>
                        <Award size={16} className='icon text-gold' />
                    </div>
                    <div className='value-row'>
                        <strong className='value'>{progress.progressPct.toFixed(1)}%</strong>
                    </div>
                    <div className='b254-mini-progress-track'>
                        <div className='b254-mini-progress-fill' style={{ width: `${Math.min(100, Math.max(0, progress.progressPct))}%` }} />
                    </div>
                </div>

                {/* 8. Session Timer & Reanalysis */}
                <div className='b254-metric-card timer-card'>
                    <div className='card-top'>
                        <span className='label'>SESSION TIMER</span>
                        <Clock size={16} className='icon text-cyan' />
                    </div>
                    <div className='value-row'>
                        <strong className='value time'>{formatTime(session.timeRemainingSeconds)}</strong>
                    </div>
                    <div className='reanalysis-sub'>
                        <RefreshCw size={12} className='spin-icon' />
                        <span>Reanalysis in: <strong>{formatTime(session.nextReanalysisCountdownSeconds)}</strong></span>
                    </div>
                </div>
            </div>
        </section>
    );
};
