import React, { useEffect, useMemo } from 'react';
import './trading-milestone-modal.scss';

export type MilestoneType = 'tp' | 'sl' | null;

export interface TradingMilestoneModalProps {
    isOpen: boolean;
    type: MilestoneType;
    amount: number;
    targetAmount?: number;
    currency?: string;
    botName: string;
    winsCount?: number;
    lossesCount?: number;
    totalTrades?: number;
    onClose: () => void;
    onRestart?: () => void;
}

// ── Web Audio Synthesized Chimes (Zero external assets, 100% reliable) ──
const playMilestoneAudio = (type: 'tp' | 'sl') => {
    try {
        const AudioCtx =
            window.AudioContext ||
            (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        if (!AudioCtx) return;
        const ctx = new AudioCtx();
        const now = ctx.currentTime;

        if (type === 'tp') {
            // Triumphant rising arpeggio: C5 (523Hz) -> E5 (659Hz) -> G5 (784Hz) -> C6 (1046Hz)
            const freqs = [523.25, 659.25, 783.99, 1046.5];
            freqs.forEach((freq, i) => {
                const osc = ctx.createOscillator();
                const gain = ctx.createGain();
                osc.type = 'triangle';
                osc.frequency.setValueAtTime(freq, now + i * 0.12);
                gain.gain.setValueAtTime(0.01, now + i * 0.12);
                gain.gain.exponentialRampToValueAtTime(0.25, now + i * 0.12 + 0.04);
                gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.12 + 0.45);
                osc.connect(gain);
                gain.connect(ctx.destination);
                osc.start(now + i * 0.12);
                osc.stop(now + i * 0.12 + 0.5);
            });
        } else {
            // Gentle safety alert tone
            const freqs = [440, 349.23];
            freqs.forEach((freq, i) => {
                const osc = ctx.createOscillator();
                const gain = ctx.createGain();
                osc.type = 'sine';
                osc.frequency.setValueAtTime(freq, now + i * 0.18);
                gain.gain.setValueAtTime(0.01, now + i * 0.18);
                gain.gain.exponentialRampToValueAtTime(0.2, now + i * 0.18 + 0.03);
                gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.18 + 0.4);
                osc.connect(gain);
                gain.connect(ctx.destination);
                osc.start(now + i * 0.18);
                osc.stop(now + i * 0.18 + 0.45);
            });
        }
    } catch {
        // AudioContext may be blocked before first user gesture
    }
};

export const TradingMilestoneModal: React.FC<TradingMilestoneModalProps> = ({
    isOpen,
    type,
    amount,
    targetAmount,
    currency = 'USD',
    botName,
    winsCount = 0,
    lossesCount = 0,
    totalTrades,
    onClose,
    onRestart,
}) => {
    useEffect(() => {
        if (isOpen && type) {
            playMilestoneAudio(type);
        }
    }, [isOpen, type]);

    const stats = useMemo(() => {
        const total = totalTrades !== undefined ? totalTrades : winsCount + lossesCount;
        const winRate = total > 0 ? ((winsCount / total) * 100).toFixed(1) : '0.0';
        return { total, winRate };
    }, [totalTrades, winsCount, lossesCount]);

    if (!isOpen || !type) return null;

    const isTp = type === 'tp';

    return (
        <div className='trading-milestone-overlay' onClick={onClose}>
            <div
                className={`trading-milestone-card ${isTp ? 'trading-milestone-card--tp' : 'trading-milestone-card--sl'}`}
                onClick={e => e.stopPropagation()}
            >
                {/* ── Background Glow & Floating Sparkles ── */}
                <div className='trading-milestone-card__glow' />
                {isTp && (
                    <div className='trading-milestone-card__confetti'>
                        <span className='sparkle s1'>✨</span>
                        <span className='sparkle s2'>⭐</span>
                        <span className='sparkle s3'>🎉</span>
                        <span className='sparkle s4'>✨</span>
                        <span className='sparkle s5'>🌟</span>
                        <span className='sparkle s6'>🎊</span>
                    </div>
                )}

                {/* ── Close Button ── */}
                <button className='trading-milestone-card__close' onClick={onClose} aria-label='Close'>
                    <svg width='18' height='18' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2.5'>
                        <line x1='18' y1='6' x2='6' y2='18' />
                        <line x1='6' y1='6' x2='18' y2='18' />
                    </svg>
                </button>

                {/* ── Header Icon & Title ── */}
                <div className='trading-milestone-card__header'>
                    <div className='trading-milestone-card__icon-wrapper'>
                        {isTp ? (
                            <svg
                                className='milestone-icon trophy-icon'
                                viewBox='0 0 24 24'
                                fill='none'
                                stroke='currentColor'
                                strokeWidth='2'
                            >
                                <path d='M6 9H4.5a2.5 2.5 0 0 1 0-5H6' />
                                <path d='M18 9h1.5a2.5 2.5 0 0 0 0-5H18' />
                                <path d='M4 22h16' />
                                <path d='M10 14.66V17c0 .55-.45 1-1 1H7' />
                                <path d='M14 14.66V17c0 .55.45 1 1 1h2' />
                                <path d='M18 2H6v7a6 6 0 0 0 12 0V2Z' />
                            </svg>
                        ) : (
                            <svg
                                className='milestone-icon shield-icon'
                                viewBox='0 0 24 24'
                                fill='none'
                                stroke='currentColor'
                                strokeWidth='2'
                            >
                                <path d='M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z' />
                                <line x1='12' y1='8' x2='12' y2='12' />
                                <line x1='12' y1='16' x2='12.01' y2='16' />
                            </svg>
                        )}
                    </div>
                    <div className='trading-milestone-card__badge-tag'>
                        {isTp ? 'DOLLARS PRINTED 💵💸' : 'RISK PROTECTION ACTIVE 🛡️'}
                    </div>
                    <h2 className='trading-milestone-card__title'>
                        {isTp ? 'Dollars Printed! 💸' : 'Stop Loss Hit — Capital Protected'}
                    </h2>
                    <p className='trading-milestone-card__subtitle'>
                        {isTp
                            ? `${botName} successfully printed +${amount.toFixed(2)} ${currency}! Target profit goal smashed.`
                            : `${botName} safely halted trading to protect your account capital.`}
                    </p>
                </div>

                {/* ── Main Amount Display ── */}
                <div className='trading-milestone-card__amount-box'>
                    <span className='trading-milestone-card__amount-label'>
                        {isTp ? 'Total Profit Generated' : 'Protected Loss Limit'}
                    </span>
                    <div className='trading-milestone-card__amount-value'>
                        <span className='amount-sign'>{isTp ? '+' : '-'}</span>
                        <span className='amount-num'>{Math.abs(amount).toFixed(2)}</span>
                        <span className='amount-curr'>{currency}</span>
                    </div>
                    {targetAmount !== undefined && (
                        <div className='trading-milestone-card__target-sub'>
                            Target Threshold: {targetAmount.toFixed(2)} {currency}
                        </div>
                    )}
                </div>

                {/* ── Session Performance Metrics ── */}
                <div className='trading-milestone-card__stats-grid'>
                    <div className='stat-pill'>
                        <span className='stat-pill__label'>Total Trades</span>
                        <span className='stat-pill__value'>{stats.total}</span>
                    </div>
                    <div className='stat-pill stat-pill--win'>
                        <span className='stat-pill__label'>Wins</span>
                        <span className='stat-pill__value'>{winsCount}</span>
                    </div>
                    <div className='stat-pill stat-pill--loss'>
                        <span className='stat-pill__label'>Losses</span>
                        <span className='stat-pill__value'>{lossesCount}</span>
                    </div>
                    <div className='stat-pill stat-pill--rate'>
                        <span className='stat-pill__label'>Win Rate</span>
                        <span className='stat-pill__value'>{stats.winRate}%</span>
                    </div>
                </div>

                {/* ── Advice / Note ── */}
                <div className='trading-milestone-card__note'>
                    {isTp ? (
                        <span>
                            💡 Tip: Lock in your profits or adjust your target before starting your next session.
                        </span>
                    ) : (
                        <span>
                            🛡️ Capital Protection: Review market volatility or revise your strategy settings before
                            restarting.
                        </span>
                    )}
                </div>

                {/* ── Action Buttons ── */}
                <div className='trading-milestone-card__actions'>
                    {onRestart && (
                        <button
                            className={`milestone-btn milestone-btn--primary ${isTp ? 'milestone-btn--tp' : 'milestone-btn--sl'}`}
                            onClick={() => {
                                onClose();
                                onRestart();
                            }}
                        >
                            <svg
                                width='16'
                                height='16'
                                viewBox='0 0 24 24'
                                fill='none'
                                stroke='currentColor'
                                strokeWidth='2.5'
                            >
                                <path d='M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67' />
                            </svg>
                            {isTp ? 'Start Next Session' : 'Reset & Resume'}
                        </button>
                    )}
                    <button className='milestone-btn milestone-btn--secondary' onClick={onClose}>
                        Dismiss & View Log
                    </button>
                </div>
            </div>
        </div>
    );
};

export default TradingMilestoneModal;
