import React from 'react';
import { B254AutoState } from '../types/b254.types';
import {
    Activity,
    BarChart3,
    Clock,
    DollarSign,
    Flame,
    RotateCcw,
    Shield,
    Target,
    TrendingDown,
    TrendingUp,
    Zap,
} from 'lucide-react';

export interface B254TradingDashboardProps {
    liveBalance: number;
    currency: string;
    autoState: B254AutoState;
    totalProfit: number;
    wins: number;
    losses: number;
    currentStake: number;
    baseStake: number;
    martingaleLevel: number;
    takeProfit: number;
    stopLoss: number;
    selectedSymbol: string;
    selectedLabel: string;
    dwellRemainingSec: number;
    autoSwitch: boolean;
    regime: 'UNDER' | 'OVER' | 'NEUTRAL';
    qualityScore: number;
    biasPct: number;
    onResetStats: () => void;
}

export const B254TradingDashboard: React.FC<B254TradingDashboardProps> = ({
    liveBalance,
    currency,
    autoState,
    totalProfit,
    wins,
    losses,
    currentStake,
    baseStake,
    martingaleLevel,
    takeProfit,
    stopLoss,
    selectedSymbol,
    selectedLabel,
    dwellRemainingSec,
    autoSwitch,
    regime,
    qualityScore,
    biasPct,
    onResetStats,
}) => {
    const totalTrades = wins + losses;
    const winRate = totalTrades > 0 ? ((wins / totalTrades) * 100).toFixed(1) : '0.0';
    const isProfitPositive = totalProfit >= 0;

    // Take profit progress (0 - 100%)
    const tpProgressPct = takeProfit > 0
        ? Math.min(100, Math.max(0, (totalProfit / takeProfit) * 100))
        : 0;
    const tpRemaining = Math.max(0, takeProfit - totalProfit);

    // Stop loss drawdown progress (0 - 100%)
    const currentDrawdown = totalProfit < 0 ? Math.abs(totalProfit) : 0;
    const slUsagePct = stopLoss > 0
        ? Math.min(100, Math.max(0, (currentDrawdown / stopLoss) * 100))
        : 0;
    const slRemaining = Math.max(0, stopLoss - currentDrawdown);

    // Format Dwell Seconds (MM:SS)
    const formatDwellTime = (secs: number) => {
        const m = Math.floor(secs / 60);
        const s = secs % 60;
        return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    };

    return (
        <section className='b254-glass b254-trading-dashboard'>
            {/* ── Top Header Row ── */}
            <div className='b254-compounding-header'>
                <div className='b254-title-meta'>
                    <div className='b254-logo-badge'>
                        <Flame size={20} className='flame-icon text-cyan' />
                        <span className='b254-brand-name'>B254</span>
                    </div>
                    <div>
                        <h2 className='b254-main-title'>
                            B254 Edge AI Trading Terminal
                        </h2>
                        <span className='b254-sub-title'>
                            Autonomous Under 6 / Over 3 Execution &bull; Strict Risk Containment &bull; Manual Controls
                        </span>
                    </div>
                </div>

                <div className='b254-header-actions'>
                    <button
                        className='b254-btn-glass b254-btn-reset-stats'
                        onClick={onResetStats}
                        title='Reset session P&L and win/loss count'
                        disabled={autoState === 'TRADING'}
                    >
                        <RotateCcw size={14} className='text-amber' />
                        <span>Reset Stats</span>
                    </button>

                    <div className={`b254-engine-pill b254-engine-pill--${autoState.toLowerCase()}`}>
                        <span className='dot' />
                        <span>
                            {autoState === 'IDLE' && 'ENGINE IDLE'}
                            {autoState === 'SCANNING' && 'SCANNING MARKETS'}
                            {autoState === 'WAITING_TRIGGER' && 'WAITING FOR TRIGGER'}
                            {autoState === 'TRADING' && 'EXECUTING TRADE'}
                            {autoState === 'LOSS_GUARD' && 'LOSS GUARD PAUSE'}
                            {autoState === 'PAUSED' && 'PAUSED'}
                        </span>
                    </div>
                </div>
            </div>

            {/* ── Metric Cards Grid ── */}
            <div className='b254-metrics-grid'>
                {/* 1. Account Wallet Balance */}
                <div className='b254-metric-card primary'>
                    <div className='card-top'>
                        <span className='label'>ACCOUNT BALANCE</span>
                        <DollarSign size={16} className='icon text-cyan' />
                    </div>
                    <div className='value-row'>
                        <strong className='value'>${liveBalance.toFixed(2)}</strong>
                        <span className='currency'>{currency}</span>
                    </div>
                    <span className='sub-text'>Real Live Wallet</span>
                </div>

                {/* 2. Total Net P&L */}
                <div className='b254-metric-card'>
                    <div className='card-top'>
                        <span className='label'>TOTAL NET PROFIT</span>
                        {isProfitPositive ? (
                            <TrendingUp size={16} className='icon text-emerald' />
                        ) : (
                            <TrendingDown size={16} className='icon text-rose' />
                        )}
                    </div>
                    <div className='value-row'>
                        <strong className={`value ${isProfitPositive ? 'text-emerald' : 'text-rose'}`}>
                            {isProfitPositive ? '+' : ''}${totalProfit.toFixed(2)}
                        </strong>
                        <span className='currency'>{currency}</span>
                    </div>
                    <span className='sub-text'>
                        {totalTrades} trade{totalTrades === 1 ? '' : 's'} executed
                    </span>
                </div>

                {/* 3. Win Rate & Accuracy */}
                <div className='b254-metric-card'>
                    <div className='card-top'>
                        <span className='label'>WIN RATE & RECORD</span>
                        <BarChart3 size={16} className='icon text-gold' />
                    </div>
                    <div className='value-row'>
                        <strong className='value text-gold'>{winRate}%</strong>
                        <span className='total-days'>
                            ({wins}W / {losses}L)
                        </span>
                    </div>
                    <div className='b254-mini-progress-track'>
                        <div
                            className='b254-mini-progress-fill'
                            style={{
                                width: `${Math.min(100, Math.max(0, parseFloat(winRate)))}%`,
                                backgroundColor: '#10b981',
                            }}
                        />
                    </div>
                </div>

                {/* 4. Active Stake & Martingale Level */}
                <div className='b254-metric-card'>
                    <div className='card-top'>
                        <span className='label'>ACTIVE STAKE</span>
                        <Zap size={16} className='icon text-cyan' />
                    </div>
                    <div className='value-row'>
                        <strong className='value text-cyan'>${currentStake.toFixed(2)}</strong>
                        <span className='currency'>{currency}</span>
                    </div>
                    <span className='sub-text'>
                        {martingaleLevel > 0 ? (
                            <span className='text-amber font-semibold'>Martingale Step {martingaleLevel}</span>
                        ) : (
                            <span>Base: ${baseStake.toFixed(2)}</span>
                        )}
                    </span>
                </div>

                {/* 5. Take Profit Target & Progress */}
                <div className='b254-metric-card'>
                    <div className='card-top'>
                        <span className='label'>TAKE PROFIT TARGET</span>
                        <Target size={16} className='icon text-emerald' />
                    </div>
                    <div className='value-row'>
                        <strong className='value text-emerald'>+${takeProfit.toFixed(2)}</strong>
                    </div>
                    <div className='b254-mini-progress-track'>
                        <div
                            className='b254-mini-progress-fill'
                            style={{
                                width: `${tpProgressPct}%`,
                                backgroundColor: '#00f5ff',
                            }}
                        />
                    </div>
                    <span className='sub-text'>
                        {tpRemaining === 0 ? '🎯 TP Target Reached!' : `$${tpRemaining.toFixed(2)} to auto-stop`}
                    </span>
                </div>

                {/* 6. Stop Loss Limit & Drawdown */}
                <div className='b254-metric-card'>
                    <div className='card-top'>
                        <span className='label'>STOP LOSS LIMIT</span>
                        <Shield size={16} className='icon text-rose' />
                    </div>
                    <div className='value-row'>
                        <strong className='value text-rose'>-${stopLoss.toFixed(2)}</strong>
                    </div>
                    <div className='b254-mini-progress-track'>
                        <div
                            className='b254-mini-progress-fill'
                            style={{
                                width: `${slUsagePct}%`,
                                backgroundColor: slUsagePct > 60 ? '#f43f5e' : '#f59e0b',
                            }}
                        />
                    </div>
                    <span className='sub-text'>
                        {currentDrawdown > 0 ? `Drawdown: -$${currentDrawdown.toFixed(2)} (${slRemaining.toFixed(2)} safe)` : 'Safe buffer 100%'}
                    </span>
                </div>

                {/* 7. Active Market & Edge */}
                <div className='b254-metric-card'>
                    <div className='card-top'>
                        <span className='label'>ACTIVE MARKET</span>
                        <Activity size={16} className='icon text-purple' />
                    </div>
                    <div className='value-row'>
                        <strong className='value text-purple' title={selectedSymbol}>{selectedLabel}</strong>
                    </div>
                    <span className='sub-text'>
                        {regime === 'UNDER' ? (
                            <span className='text-cyan font-semibold'>UNDER 6 Bias ({biasPct.toFixed(0)}%)</span>
                        ) : regime === 'OVER' ? (
                            <span className='text-amber font-semibold'>OVER 3 Bias ({biasPct.toFixed(0)}%)</span>
                        ) : (
                            <span>Consolidating (Q: {qualityScore}%)</span>
                        )}
                    </span>
                </div>

                {/* 8. 10-Minute Dwell Rotation Timer */}
                <div className='b254-metric-card timer-card'>
                    <div className='card-top'>
                        <span className='label'>ROTATION DWELL</span>
                        <Clock size={16} className='icon text-cyan' />
                    </div>
                    <div className='value-row'>
                        <strong className='value time'>{formatDwellTime(dwellRemainingSec)}</strong>
                    </div>
                    <span className='sub-text'>
                        {autoSwitch ? (
                            <span className='text-cyan'>Auto-Switch Active</span>
                        ) : (
                            <span className='text-gray-400'>Auto-Switch Off</span>
                        )}
                    </span>
                </div>
            </div>
        </section>
    );
};
