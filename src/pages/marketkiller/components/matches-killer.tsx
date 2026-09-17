import { useMemo } from 'react';
import classNames from 'classnames';
import { observer } from 'mobx-react-lite';
import { runInAction } from 'mobx';
import { useStore } from '@/hooks/useStore';
import './matches-killer.scss';

// ── Shared Digit Card ──────────────────────────────────────────────────────────
const DigitIntelCard = ({ stat, isLatest, ranksMost, ranks2nd, ranksLeast }: any) => {
    const isMost = stat.digit === ranksMost;
    const is2nd = stat.digit === ranks2nd;
    const isLeast = stat.digit === ranksLeast;
    const isElite = isMost || is2nd || isLeast;

    const themeClass = isMost ? 'theme-most' : is2nd ? 'theme-2nd' : isLeast ? 'theme-least' : 'theme-norm';

    return (
        <div
            className={classNames('digit-intel-modern', themeClass, {
                'is-latest': isLatest,
                'glow-most': isMost,
                'glow-least': isLeast,
            })}
        >
            {/* Background Glow */}
            {isElite && <div className='card-glow-bg'></div>}

            <div className='di-header'>
                <div className='di-val font-black'>{stat.digit}</div>
                <div className='di-rank-box'>
                    <div className='di-r-label uppercase tracking-widest font-bold'>Rank</div>
                    <div className='di-r-val font-black'>#{stat.rank}</div>
                </div>
            </div>

            <div className='di-stats'>
                <div className='di-s-row'>
                    <span className='s-lbl font-bold'>Strength</span>
                    <span className='s-pct font-black'>{stat.percentage.toFixed(1)}%</span>
                </div>

                {/* Glowing Progress Bar */}
                <div className='di-progress'>
                    <div className='di-fill' style={{ width: `${Math.min(stat.percentage * 5, 100)}%` }} />
                </div>
            </div>

            {/* Spinner indicator if increasing */}
            {stat.is_increasing && <div className='di-spinner'></div>}

            {isElite && (
                <div className='di-elite-badge uppercase tracking-widest font-black'>
                    {isMost ? 'DOMINANT' : is2nd ? 'RUNNER UP' : 'VOLATILE'}
                </div>
            )}
        </div>
    );
};

// ── Main Component ─────────────────────────────────────────────────────────────
const MatchesKiller = observer(() => {
    const { marketkiller } = useStore();
    const {
        symbol,
        current_price,
        last_digit,
        digit_stats,
        matches_settings,
        matches_ranks,
        ticks,
        is_running,
        session_pl,
        wins,
        losses,
        total_stake_used,
        total_runs,
        trades_journal,
    } = marketkiller;

    const last15 = useMemo(() => ticks.slice(-15).reverse(), [ticks]);
    const percentages = marketkiller.stats_engine.getPercentages();

    const toggleCondition = (index: number) => {
        const next = [...matches_settings.enabled_conditions];
        next[index] = !next[index];
        runInAction(() => {
            marketkiller.matches_settings.enabled_conditions = next;
        });
    };

    const conditions = [
        { id: 1, key: '1. TOP-3 / LEAST RANKING', desc: 'Auto-select dominant digit (Matches) or coldest digit (Differs)' },
        { id: 2, key: '2. POWER ACCELERATION', desc: 'Momentum trend verification for selected strategy' },
        { id: 3, key: '3. DUAL VELOCITY', desc: 'Consecutive velocity surge confirmation before entry' },
        { id: 4, key: '4. SEQUENTIAL STABILITY', desc: 'Last 5 ticks conform to stability threshold' },
        { id: 5, key: '5. PROBABILITY THRESHOLD', desc: 'Digit frequency must satisfy N% condition' },
        { id: 6, key: '6. EVEN/ODD BIAS GATE', desc: `Trigger Even/Odd when market bias >= ${matches_settings.even_odd_min_bias || 52}%` },
        { id: 7, key: '7. OVER/UNDER MOMENTUM', desc: `Trigger Over/Under when cluster >= ${matches_settings.over_under_min_bias || 50}%` },
        { id: 8, key: '8. DIFFERS SAFETY GATE', desc: `Trigger Differs only when target digit frequency <= ${matches_settings.differs_max_freq || 10}%` },
    ];

    return (
        <div className='mkill-modern-wrapper'>
            <div className='max-w-7xl'>
                {/* 1. Massive Digital Header Card */}
                <div className={classNames('mkill-hero-card', { 'signal-glow': marketkiller.signal_detected })}>
                    <div className='hero-glow-1'></div>
                    <div className='hero-glow-2'></div>

                    <div className='hero-content'>
                        {/* Market & Price */}
                        <div className='market-info'>
                            <div className='market-label uppercase tracking-widest'>LIVE MARKET STREAM</div>
                            <div className='market-name font-black'>{symbol.replace('_', ' ')}</div>
                            <div className='price-label uppercase tracking-widest font-bold'>Current Price</div>
                            <div className='price-val font-bold'>
                                ${Number(current_price).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                            </div>
                        </div>

                        {/* Last Digit Hero HUD */}
                        <div className='hud-center'>
                            <div className='hud-spin'></div>
                            <span className='hud-label uppercase tracking-widest font-bold'>Last Digit</span>
                            <span className='hud-val font-black'>{last_digit ?? '-'}</span>
                        </div>

                        {/* Top-Level Session Stats */}
                        <div className='session-stats'>
                            <div className='pl-box'>
                                <div className='pl-label uppercase tracking-widest font-bold'>SESSION P/L</div>
                                <div
                                    className={classNames('pl-val font-black', {
                                        pos: session_pl >= 0,
                                        neg: session_pl < 0,
                                    })}
                                >
                                    {session_pl >= 0 ? '+' : ''}${session_pl.toFixed(2)}
                                </div>
                            </div>
                            <div className='wl-row font-black'>
                                <div className='w-badge'>W: {wins}</div>
                                <div className='l-badge'>L: {losses}</div>
                            </div>
                        </div>
                    </div>
                </div>

                {/* 2. Last 15 Ticks Data Stream */}
                <div className='mkill-section-card'>
                    <div className='section-title uppercase tracking-widest font-bold'>
                        <svg
                            width='16'
                            height='16'
                            viewBox='0 0 24 24'
                            fill='none'
                            stroke='#6366f1'
                            strokeWidth='2'
                            strokeLinecap='round'
                            strokeLinejoin='round'
                        >
                            <circle cx='12' cy='12' r='10'></circle>
                            <polyline points='12 6 12 12 16 14'></polyline>
                        </svg>
                        Sequential Data Stream
                    </div>
                    <div className='tick-stream-bubbles'>
                        {last15.map((t, i) => (
                            <div
                                key={i}
                                className={classNames('bubble', {
                                    'is-latest': i === 0,
                                    'is-most': t === matches_ranks.most && i !== 0,
                                    'is-least': t === matches_ranks.least && i !== 0,
                                })}
                            >
                                {t}
                            </div>
                        ))}
                        {last15.length === 0 && (
                            <span style={{ color: '#64748b', fontSize: '0.875rem', fontStyle: 'italic' }}>
                                Awaiting market data synchronization...
                            </span>
                        )}
                    </div>
                </div>

                {/* 3. Market Scanner Grid */}
                <div className='mkill-section-card'>
                    <div className='section-title uppercase tracking-widest font-bold'>
                        <svg
                            width='16'
                            height='16'
                            viewBox='0 0 24 24'
                            fill='none'
                            stroke='#6366f1'
                            strokeWidth='2'
                            strokeLinecap='round'
                            strokeLinejoin='round'
                        >
                            <path d='M21.21 15.89A10 10 0 1 1 8 2.83'></path>
                            <path d='M22 12A10 10 0 0 0 12 2v10z'></path>
                        </svg>
                        Market Scanner & Intelligence
                    </div>
                    <div className='scanner-grid'>
                        {digit_stats
                            .slice()
                            .sort((a, b) => a.rank - b.rank)
                            .map(s => (
                                <DigitIntelCard
                                    key={s.digit}
                                    stat={s}
                                    isLatest={s.digit === last_digit}
                                    ranksMost={matches_ranks.most}
                                    ranks2nd={matches_ranks.second}
                                    ranksLeast={matches_ranks.least}
                                />
                            ))}
                    </div>
                </div>

                {/* 4. Controls Section: Tunnels, Gates, Strategy */}
                <div className='controls-grid'>
                    {/* Tunnels */}
                    <div className='mkill-section-card tunnels-wrap'>
                        <h3 className='section-title uppercase tracking-widest font-bold'>Prediction Tunnels</h3>

                        <div className='mode-toggle'>
                            <button
                                className={classNames('uppercase tracking-widest font-black', {
                                    active: !matches_settings.is_auto,
                                })}
                                onClick={() =>
                                    runInAction(() => {
                                        marketkiller.matches_settings.is_auto = false;
                                    })
                                }
                            >
                                Manual Ops
                            </button>
                            <button
                                className={classNames('uppercase tracking-widest font-black', {
                                    active: matches_settings.is_auto,
                                })}
                                onClick={() =>
                                    runInAction(() => {
                                        marketkiller.matches_settings.is_auto = true;
                                    })
                                }
                            >
                                Auto Discovery
                            </button>
                        </div>

                        {/* Strategy Selector Condition Bar */}
                        <div className='strategy-picker-box'>
                            <div className='strategy-picker-header'>
                                <label className='uppercase tracking-widest font-bold'>+ STRATEGY CONDITION</label>
                                <span className='strategy-badge font-bold'>
                                    {matches_settings.default_strategy === 'DIGITMATCH' && 'MATCHES'}
                                    {matches_settings.default_strategy === 'DIGITDIFF' && 'DIFFERS'}
                                    {matches_settings.default_strategy === 'DIGITEVEN' && 'EVEN'}
                                    {matches_settings.default_strategy === 'DIGITODD' && 'ODD'}
                                    {matches_settings.default_strategy === 'DIGITOVER' && 'OVER'}
                                    {matches_settings.default_strategy === 'DIGITUNDER' && 'UNDER'}
                                </span>
                            </div>
                            <div className='strategy-buttons-grid six-buttons'>
                                <button
                                    type='button'
                                    className={classNames('strat-btn', { active: matches_settings.default_strategy === 'DIGITDIFF' })}
                                    onClick={() =>
                                        runInAction(() => {
                                            marketkiller.matches_settings.default_strategy = 'DIGITDIFF';
                                        })
                                    }
                                >
                                    ⚡ DIFFERS
                                </button>
                                <button
                                    type='button'
                                    className={classNames('strat-btn', { active: matches_settings.default_strategy === 'DIGITMATCH' })}
                                    onClick={() =>
                                        runInAction(() => {
                                            marketkiller.matches_settings.default_strategy = 'DIGITMATCH';
                                        })
                                    }
                                >
                                    🎯 MATCHES
                                </button>
                                <button
                                    type='button'
                                    className={classNames('strat-btn', { active: matches_settings.default_strategy === 'DIGITEVEN' })}
                                    onClick={() =>
                                        runInAction(() => {
                                            marketkiller.matches_settings.default_strategy = 'DIGITEVEN';
                                        })
                                    }
                                >
                                    ⚖️ EVEN
                                </button>
                                <button
                                    type='button'
                                    className={classNames('strat-btn', { active: matches_settings.default_strategy === 'DIGITODD' })}
                                    onClick={() =>
                                        runInAction(() => {
                                            marketkiller.matches_settings.default_strategy = 'DIGITODD';
                                        })
                                    }
                                >
                                    ⚖️ ODD
                                </button>
                                <button
                                    type='button'
                                    className={classNames('strat-btn', { active: matches_settings.default_strategy === 'DIGITOVER' })}
                                    onClick={() =>
                                        runInAction(() => {
                                            marketkiller.matches_settings.default_strategy = 'DIGITOVER';
                                        })
                                    }
                                >
                                    📈 OVER
                                </button>
                                <button
                                    type='button'
                                    className={classNames('strat-btn', { active: matches_settings.default_strategy === 'DIGITUNDER' })}
                                    onClick={() =>
                                        runInAction(() => {
                                            marketkiller.matches_settings.default_strategy = 'DIGITUNDER';
                                        })
                                    }
                                >
                                    📉 UNDER
                                </button>
                            </div>

                            {/* Contextual Strategy Prediction & Parameter Controls */}
                            {matches_settings.default_strategy === 'DIGITDIFF' && (
                                <div className='strategy-context-panel'>
                                    <div className='context-panel-row'>
                                        <label className='uppercase tracking-widest font-bold'>Target Mode</label>
                                        <div className='mode-chips'>
                                            {[
                                                { id: 'least', label: '❄️ Coldest (Least)' },
                                                { id: 'most', label: '🔥 Hottest (Most)' },
                                                { id: '2nd_least', label: '🥈 2nd Least' },
                                                { id: 'custom', label: '🎯 Specific Digit' },
                                            ].map(m => (
                                                <button
                                                    key={m.id}
                                                    type='button'
                                                    className={classNames('mode-chip', {
                                                        active: matches_settings.differs_target_mode === m.id,
                                                    })}
                                                    onClick={() =>
                                                        runInAction(() => {
                                                            marketkiller.matches_settings.differs_target_mode = m.id as any;
                                                        })
                                                    }
                                                >
                                                    {m.label}
                                                </button>
                                            ))}
                                        </div>
                                    </div>

                                    <div className='context-panel-row'>
                                        <label className='uppercase tracking-widest font-bold'>Specific Prediction Digit</label>
                                        <div className='digit-chips-grid'>
                                            {Array.from({ length: 10 }, (_, d) => {
                                                const stat = digit_stats.find(s => s.digit === d);
                                                const isSelected =
                                                    matches_settings.differs_target_mode === 'custom'
                                                        ? matches_settings.specific_differs_prediction === d
                                                        : (matches_settings.differs_target_mode === 'least' && d === matches_ranks.least) ||
                                                          (matches_settings.differs_target_mode === 'most' && d === matches_ranks.most) ||
                                                          (matches_settings.differs_target_mode === '2nd_least' && d === matches_ranks.second);

                                                return (
                                                    <button
                                                        key={d}
                                                        type='button'
                                                        className={classNames('digit-chip', { active: isSelected })}
                                                        onClick={() =>
                                                            runInAction(() => {
                                                                marketkiller.matches_settings.differs_target_mode = 'custom';
                                                                marketkiller.matches_settings.specific_differs_prediction = d;
                                                                // Apply to active manual slots
                                                                const count = marketkiller.matches_settings.simultaneous_trades || 1;
                                                                marketkiller.matches_settings.predictions = Array(count).fill(d);
                                                            })
                                                        }
                                                    >
                                                        <span className='d-num font-black'>{d}</span>
                                                        <span className='d-pct'>{stat ? `${stat.percentage}%` : '0%'}</span>
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    </div>
                                </div>
                            )}

                            {matches_settings.default_strategy === 'DIGITMATCH' && (
                                <div className='strategy-context-panel'>
                                    <div className='context-panel-row'>
                                        <label className='uppercase tracking-widest font-bold'>Specific Prediction Digit</label>
                                        <div className='digit-chips-grid'>
                                            {Array.from({ length: 10 }, (_, d) => {
                                                const stat = digit_stats.find(s => s.digit === d);
                                                const isSelected = d === matches_ranks.most || (matches_settings.predictions[0] ?? 0) === d;

                                                return (
                                                    <button
                                                        key={d}
                                                        type='button'
                                                        className={classNames('digit-chip', { active: isSelected })}
                                                        onClick={() =>
                                                            runInAction(() => {
                                                                const count = marketkiller.matches_settings.simultaneous_trades || 1;
                                                                marketkiller.matches_settings.predictions = Array(count).fill(d);
                                                            })
                                                        }
                                                    >
                                                        <span className='d-num font-black'>{d}</span>
                                                        <span className='d-pct'>{stat ? `${stat.percentage}%` : '0%'}</span>
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    </div>
                                </div>
                            )}

                            {(matches_settings.default_strategy === 'DIGITEVEN' || matches_settings.default_strategy === 'DIGITODD') && (
                                <div className='strategy-context-panel'>
                                    <div className='context-panel-row'>
                                        <label className='uppercase tracking-widest font-bold'>Even/Odd Frequency Live</label>
                                        <div className='bias-display-row'>
                                            <div
                                                className={classNames('bias-card', {
                                                    active: matches_settings.default_strategy === 'DIGITEVEN',
                                                })}
                                                onClick={() =>
                                                    runInAction(() => {
                                                        marketkiller.matches_settings.default_strategy = 'DIGITEVEN';
                                                    })
                                                }
                                            >
                                                <span className='b-label font-bold'>EVEN BIAS</span>
                                                <span className='b-val font-black'>{percentages.even}%</span>
                                            </div>
                                            <div
                                                className={classNames('bias-card', {
                                                    active: matches_settings.default_strategy === 'DIGITODD',
                                                })}
                                                onClick={() =>
                                                    runInAction(() => {
                                                        marketkiller.matches_settings.default_strategy = 'DIGITODD';
                                                    })
                                                }
                                            >
                                                <span className='b-label font-bold'>ODD BIAS</span>
                                                <span className='b-val font-black'>{percentages.odd}%</span>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {matches_settings.default_strategy === 'DIGITOVER' && (
                                <div className='strategy-context-panel'>
                                    <div className='context-panel-row'>
                                        <label className='uppercase tracking-widest font-bold'>
                                            Select Barrier (OVER &gt; N) — Cluster: {percentages.over}%
                                        </label>
                                        <div className='barrier-chips-row'>
                                            {[0, 1, 2, 3, 4, 5, 6, 7, 8].map(barr => (
                                                <button
                                                    key={barr}
                                                    type='button'
                                                    className={classNames('barrier-chip', {
                                                        active: (matches_settings.over_barrier ?? 1) === barr,
                                                    })}
                                                    onClick={() =>
                                                        runInAction(() => {
                                                            marketkiller.matches_settings.over_barrier = barr;
                                                            const count = marketkiller.matches_settings.simultaneous_trades || 1;
                                                            marketkiller.matches_settings.predictions = Array(count).fill(barr);
                                                        })
                                                    }
                                                >
                                                    &gt; {barr}
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                </div>
                            )}

                            {matches_settings.default_strategy === 'DIGITUNDER' && (
                                <div className='strategy-context-panel'>
                                    <div className='context-panel-row'>
                                        <label className='uppercase tracking-widest font-bold'>
                                            Select Barrier (UNDER &lt; N) — Cluster: {percentages.under}%
                                        </label>
                                        <div className='barrier-chips-row'>
                                            {[1, 2, 3, 4, 5, 6, 7, 8, 9].map(barr => (
                                                <button
                                                    key={barr}
                                                    type='button'
                                                    className={classNames('barrier-chip', {
                                                        active: (matches_settings.under_barrier ?? 8) === barr,
                                                    })}
                                                    onClick={() =>
                                                        runInAction(() => {
                                                            marketkiller.matches_settings.under_barrier = barr;
                                                            const count = marketkiller.matches_settings.simultaneous_trades || 1;
                                                            marketkiller.matches_settings.predictions = Array(count).fill(barr);
                                                        })
                                                    }
                                                >
                                                    &lt; {barr}
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* Dual Target & Bulk Trades Row */}
                        <div className='targets-and-bulk-row'>
                            <div className='target-input-col'>
                                <label className='uppercase tracking-widest font-bold'>Active Slots (Max 10)</label>
                                <input
                                    type='number'
                                    min='1'
                                    max='10'
                                    className='font-black'
                                    value={matches_settings.simultaneous_trades}
                                    onChange={e =>
                                        runInAction(() => {
                                            marketkiller.matches_settings.simultaneous_trades = Math.max(
                                                1,
                                                Math.min(10, parseInt(e.target.value) || 1)
                                            );
                                        })
                                    }
                                />
                            </div>

                            <div className='target-input-col'>
                                <label className='uppercase tracking-widest font-bold'>Bulk Trades at Once</label>
                                <div className='bulk-stepper-wrap'>
                                    <input
                                        type='number'
                                        min='1'
                                        max='10'
                                        className='font-black'
                                        value={matches_settings.bulk_trades_count || 1}
                                        onChange={e =>
                                            runInAction(() => {
                                                marketkiller.matches_settings.bulk_trades_count = Math.max(
                                                    1,
                                                    Math.min(10, parseInt(e.target.value) || 1)
                                                );
                                            })
                                        }
                                    />
                                    <div className='quick-bulk-chips'>
                                        {[1, 2, 3, 5, 10].map(cnt => (
                                            <button
                                                key={cnt}
                                                type='button'
                                                className={classNames('bulk-chip', {
                                                    active: (matches_settings.bulk_trades_count || 1) === cnt,
                                                })}
                                                onClick={() =>
                                                    runInAction(() => {
                                                        marketkiller.matches_settings.bulk_trades_count = cnt;
                                                    })
                                                }
                                            >
                                                {cnt}x
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div className='slots-grid'>
                            {Array.from({ length: matches_settings.simultaneous_trades || 1 }).map((_, idx) => {
                                const sortedDigits = [...digit_stats]
                                    .sort((a, b) => b.count - a.count)
                                    .map(s => s.digit);
                                const leastDigits = [...digit_stats]
                                    .sort((a, b) => a.count - b.count)
                                    .map(s => s.digit);

                                const slotStrategy =
                                    matches_settings.slot_strategies[idx] ||
                                    matches_settings.default_strategy ||
                                    'DIGITMATCH';

                                let autoDigit = sortedDigits[idx] ?? 0;
                                if (slotStrategy === 'DIGITDIFF') {
                                    autoDigit = leastDigits[idx] ?? 0;
                                } else if (slotStrategy === 'DIGITOVER') {
                                    autoDigit = 1;
                                } else if (slotStrategy === 'DIGITUNDER') {
                                    autoDigit = 8;
                                }

                                const displayValue = matches_settings.is_auto
                                    ? autoDigit
                                    : (matches_settings.predictions[idx] ?? autoDigit);

                                const isEvenOdd = slotStrategy === 'DIGITEVEN' || slotStrategy === 'DIGITODD';

                                return (
                                    <div key={idx} className='slot-card'>
                                        <div className='slot-card-top'>
                                            <label className='uppercase tracking-widest font-bold'>Slot {idx + 1}</label>
                                            <select
                                                className='slot-strategy-dropdown'
                                                value={slotStrategy}
                                                disabled={matches_settings.is_auto}
                                                onChange={e => {
                                                    const next = [...matches_settings.slot_strategies];
                                                    next[idx] = e.target.value as any;
                                                    runInAction(() => {
                                                        marketkiller.matches_settings.slot_strategies = next;
                                                    });
                                                }}
                                            >
                                                <option value='DIGITDIFF'>DIFFERS</option>
                                                <option value='DIGITMATCH'>MATCHES</option>
                                                <option value='DIGITEVEN'>EVEN</option>
                                                <option value='DIGITODD'>ODD</option>
                                                <option value='DIGITOVER'>OVER</option>
                                                <option value='DIGITUNDER'>UNDER</option>
                                            </select>
                                        </div>

                                        {isEvenOdd ? (
                                            <div className='slot-even-odd-badge font-black'>
                                                {slotStrategy === 'DIGITEVEN' ? 'EVEN' : 'ODD'}
                                            </div>
                                        ) : (
                                            <input
                                                type='number'
                                                min='0'
                                                max='9'
                                                className='font-black'
                                                disabled={matches_settings.is_auto}
                                                value={displayValue}
                                                onChange={e => {
                                                    const val = parseInt(e.target.value);
                                                    const next = [...matches_settings.predictions];
                                                    next[idx] = isNaN(val) ? 0 : val;
                                                    runInAction(() => {
                                                        marketkiller.matches_settings.predictions = next;
                                                    });
                                                }}
                                            />
                                        )}

                                        {!matches_settings.is_auto && (
                                            <button
                                                className='strike-btn uppercase tracking-widest font-black'
                                                onClick={() =>
                                                    marketkiller.executeSingleManualTrade(
                                                        displayValue,
                                                        slotStrategy,
                                                        matches_settings.bulk_trades_count || 1
                                                    )
                                                }
                                            >
                                                Strike ({matches_settings.bulk_trades_count || 1}x)
                                            </button>
                                        )}
                                    </div>
                                );
                            })}
                        </div>

                        {/* Global Multi-Burst Strike Button for Manual Mode */}
                        {!matches_settings.is_auto && (
                            <button
                                onClick={() => marketkiller.executeOneShot()}
                                className='strike-multiburst-btn uppercase tracking-widest font-black'
                            >
                                ⚡ STRIKE MULTI-BURST ({matches_settings.simultaneous_trades} SLOTS × {matches_settings.bulk_trades_count || 1}x BULK = {(matches_settings.simultaneous_trades || 1) * (matches_settings.bulk_trades_count || 1)} TRADES)
                            </button>
                        )}
                    </div>

                    {/* Gates */}
                    <div className='mkill-section-card gates-wrap'>
                        <h3 className='section-title uppercase tracking-widest font-bold'>Auto-Entry Gates</h3>
                        {conditions.map((cond, idx) => {
                            const isActive = matches_settings.enabled_conditions[idx];
                            return (
                                <div
                                    key={cond.id}
                                    className={classNames('gate-card', { active: isActive })}
                                    onClick={() => toggleCondition(idx)}
                                >
                                    <div className='g-top'>
                                        <span className='g-name uppercase tracking-widest font-black'>{cond.key}</span>
                                        <div className='g-ind'>
                                            {isActive && (
                                                <svg
                                                    width='12'
                                                    height='12'
                                                    viewBox='0 0 24 24'
                                                    fill='none'
                                                    stroke='#fff'
                                                    strokeWidth='3'
                                                    strokeLinecap='round'
                                                    strokeLinejoin='round'
                                                >
                                                    <polyline points='20 6 9 17 4 12'></polyline>
                                                </svg>
                                            )}
                                        </div>
                                    </div>
                                    <p className='g-desc font-bold'>
                                        {cond.desc}
                                        {idx === 4 && (
                                            <span
                                                style={{
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    gap: '0.5rem',
                                                    marginTop: '0.5rem',
                                                }}
                                            >
                                                <span style={{ color: '#94a3b8' }}>Target N%:</span>
                                                <input
                                                    type='number'
                                                    min='1'
                                                    max='100'
                                                    value={matches_settings.c4_val}
                                                    onClick={e => e.stopPropagation()}
                                                    onChange={e =>
                                                        runInAction(() => {
                                                            marketkiller.matches_settings.c4_val = Number(
                                                                e.target.value
                                                            );
                                                        })
                                                    }
                                                    style={{
                                                        width: '4rem',
                                                        background: '#0f172a',
                                                        border: '1px solid #334155',
                                                        color: '#fff',
                                                        padding: '0.25rem',
                                                        borderRadius: '0.25rem',
                                                        outline: 'none',
                                                    }}
                                                />
                                            </span>
                                        )}
                                        {idx === 5 && (
                                            <span
                                                style={{
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    gap: '0.5rem',
                                                    marginTop: '0.5rem',
                                                }}
                                            >
                                                <span style={{ color: '#94a3b8' }}>Min Bias %:</span>
                                                <input
                                                    type='number'
                                                    min='50'
                                                    max='90'
                                                    value={matches_settings.even_odd_min_bias ?? 52}
                                                    onClick={e => e.stopPropagation()}
                                                    onChange={e =>
                                                        runInAction(() => {
                                                            marketkiller.matches_settings.even_odd_min_bias = Number(
                                                                e.target.value
                                                            );
                                                        })
                                                    }
                                                    style={{
                                                        width: '4rem',
                                                        background: '#0f172a',
                                                        border: '1px solid #334155',
                                                        color: '#fff',
                                                        padding: '0.25rem',
                                                        borderRadius: '0.25rem',
                                                        outline: 'none',
                                                    }}
                                                />
                                            </span>
                                        )}
                                        {idx === 6 && (
                                            <span
                                                style={{
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    gap: '0.5rem',
                                                    marginTop: '0.5rem',
                                                }}
                                            >
                                                <span style={{ color: '#94a3b8' }}>Min Cluster %:</span>
                                                <input
                                                    type='number'
                                                    min='40'
                                                    max='90'
                                                    value={matches_settings.over_under_min_bias ?? 50}
                                                    onClick={e => e.stopPropagation()}
                                                    onChange={e =>
                                                        runInAction(() => {
                                                            marketkiller.matches_settings.over_under_min_bias = Number(
                                                                e.target.value
                                                            );
                                                        })
                                                    }
                                                    style={{
                                                        width: '4rem',
                                                        background: '#0f172a',
                                                        border: '1px solid #334155',
                                                        color: '#fff',
                                                        padding: '0.25rem',
                                                        borderRadius: '0.25rem',
                                                        outline: 'none',
                                                    }}
                                                />
                                            </span>
                                        )}
                                        {idx === 7 && (
                                            <span
                                                style={{
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    gap: '0.5rem',
                                                    marginTop: '0.5rem',
                                                }}
                                            >
                                                <span style={{ color: '#94a3b8' }}>Max Freq %:</span>
                                                <input
                                                    type='number'
                                                    min='1'
                                                    max='25'
                                                    value={matches_settings.differs_max_freq ?? 10}
                                                    onClick={e => e.stopPropagation()}
                                                    onChange={e =>
                                                        runInAction(() => {
                                                            marketkiller.matches_settings.differs_max_freq = Number(
                                                                e.target.value
                                                            );
                                                        })
                                                    }
                                                    style={{
                                                        width: '4rem',
                                                        background: '#0f172a',
                                                        border: '1px solid #334155',
                                                        color: '#fff',
                                                        padding: '0.25rem',
                                                        borderRadius: '0.25rem',
                                                        outline: 'none',
                                                    }}
                                                />
                                            </span>
                                        )}
                                    </p>
                                </div>
                            );
                        })}
                    </div>

                    {/* Strategy & Execute */}
                    <div className='mkill-section-card strategy-wrap'>
                        <div>
                            <h3 className='section-title uppercase tracking-widest font-bold'>
                                Tactical Configuration
                            </h3>

                            <div className='str-row'>
                                <label className='uppercase tracking-widest font-bold'>Stake ($)</label>
                                <input
                                    type='number'
                                    step='0.1'
                                    min='0.35'
                                    className='font-black'
                                    value={matches_settings.stake}
                                    onChange={e =>
                                        runInAction(() => {
                                            marketkiller.matches_settings.stake = parseFloat(e.target.value);
                                        })
                                    }
                                />
                            </div>
                            <div className='str-row'>
                                <label className='uppercase tracking-widest font-bold'>Duration</label>
                                <input
                                    type='number'
                                    min='1'
                                    max='10'
                                    className='font-black'
                                    value={matches_settings.duration}
                                    onChange={e =>
                                        runInAction(() => {
                                            marketkiller.matches_settings.duration = parseInt(e.target.value);
                                        })
                                    }
                                />
                            </div>
                            <div className='str-row'>
                                <label className='uppercase tracking-widest font-bold'>Martingale X</label>
                                <input
                                    type='number'
                                    step='0.1'
                                    className='font-black'
                                    value={matches_settings.martingale_multiplier}
                                    onChange={e =>
                                        runInAction(() => {
                                            marketkiller.matches_settings.martingale_multiplier = parseFloat(
                                                e.target.value
                                            );
                                        })
                                    }
                                />
                            </div>

                            <div
                                style={{
                                    display: 'flex',
                                    justifyContent: 'space-between',
                                    alignItems: 'center',
                                    marginTop: '1.5rem',
                                }}
                            >
                                <span
                                    className='uppercase tracking-widest font-bold'
                                    style={{ fontSize: '0.75rem', color: '#94a3b8' }}
                                >
                                    Martingale Recovery
                                </span>
                                <div
                                    className={classNames('m-toggle', { on: matches_settings.martingale_enabled })}
                                    onClick={() =>
                                        runInAction(() => {
                                            marketkiller.matches_settings.martingale_enabled =
                                                !matches_settings.martingale_enabled;
                                        })
                                    }
                                >
                                    <div className='m-dot'></div>
                                </div>
                            </div>
                        </div>

                        <button
                            className={classNames('activate-btn uppercase tracking-widest font-black', {
                                running: is_running,
                            })}
                            onClick={() => marketkiller.toggleEngine()}
                        >
                            {is_running && <div className='btn-spin'></div>}
                            {is_running ? 'SHUTDOWN ENGINE' : 'ACTIVATE AUTO-ENGINE'}
                        </button>
                    </div>
                </div>

                {/* 5. Modern Transaction Ledger & Stats Grid */}
                <div className='mkill-section-card ledger-perf-card'>
                    {/* Performance Top Bar */}
                    <div className='lp-top'>
                        <div className='lp-metric'>
                            <span className='lp-lbl uppercase tracking-widest font-black'>Total Capital</span>
                            <span className='lp-val font-black'>${total_stake_used.toFixed(2)}</span>
                        </div>
                        <div className='lp-metric'>
                            <span className='lp-lbl uppercase tracking-widest font-black'>Engagements</span>
                            <span className='lp-val font-black'>{total_runs}</span>
                        </div>
                        <div className='lp-metric wins'>
                            <span className='lp-lbl uppercase tracking-widest font-black'>Successful Hits</span>
                            <span className='lp-val font-black'>{wins}</span>
                        </div>
                        <div className='lp-metric losses'>
                            <span className='lp-lbl uppercase tracking-widest font-black'>Misses</span>
                            <span className='lp-val font-black'>{losses}</span>
                        </div>
                        <div className={classNames('lp-metric hero', { pos: session_pl >= 0, neg: session_pl < 0 })}>
                            <div className='hero-bg'></div>
                            <span className='lp-lbl uppercase tracking-widest font-black'>Net Profitability</span>
                            <span className='lp-val font-black'>
                                {session_pl >= 0 ? '+' : ''}${session_pl.toFixed(2)}
                            </span>
                        </div>
                    </div>

                    {/* Ledger Header */}
                    <div className='lp-header'>
                        <h3 className='lp-title uppercase tracking-widest font-bold'>
                            <svg
                                width='18'
                                height='18'
                                viewBox='0 0 24 24'
                                fill='none'
                                stroke='#818cf8'
                                strokeWidth='2'
                                strokeLinecap='round'
                                strokeLinejoin='round'
                            >
                                <path d='M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z'></path>
                                <polyline points='14 2 14 8 20 8'></polyline>
                                <line x1='16' y1='13' x2='8' y2='13'></line>
                                <line x1='16' y1='17' x2='8' y2='17'></line>
                                <polyline points='10 9 9 9 8 9'></polyline>
                            </svg>
                            Mission Ledger
                        </h3>
                        <button
                            className='purge-btn uppercase tracking-widest font-black'
                            onClick={() => marketkiller.resetStats()}
                        >
                            Purge Logs
                        </button>
                    </div>

                    {/* Ledger Table */}
                    <div className='lp-table-wrap'>
                        <table>
                            <thead>
                                <tr>
                                    <th className='uppercase tracking-widest font-black'>Ref ID</th>
                                    <th className='uppercase tracking-widest font-black'>Market</th>
                                    <th className='uppercase tracking-widest font-black'>Type</th>
                                    <th className='uppercase tracking-widest font-black'>Target</th>
                                    <th className='uppercase tracking-widest font-black'>Stake</th>
                                    <th className='uppercase tracking-widest font-black'>Time</th>
                                    <th className='uppercase tracking-widest font-black'>Entry/Exit</th>
                                    <th className='uppercase tracking-widest font-black'>Outcome</th>
                                </tr>
                            </thead>
                            <tbody>
                                {trades_journal.map(j => (
                                    <tr key={j.id}>
                                        <td className='t-id'>{j.id}</td>
                                        <td className='t-mkt'>{j.market}</td>
                                        <td className='t-typ'>{j.type}</td>
                                        <td className='t-tgt font-black'>{j.prediction}</td>
                                        <td className='t-stk'>${j.stake.toFixed(2)}</td>
                                        <td className='t-tim'>{j.time}</td>
                                        <td className='t-pts'>
                                            {j.entry || '---'} / {j.exit || '---'}
                                        </td>
                                        <td
                                            className={classNames(
                                                't-out uppercase tracking-widest font-black',
                                                j.status.toLowerCase()
                                            )}
                                        >
                                            {j.status}
                                        </td>
                                    </tr>
                                ))}
                                {trades_journal.length === 0 && (
                                    <tr>
                                        <td colSpan={8} className='t-emp'>
                                            Systems nominal. Awaiting mission parameters.
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        </div>
    );
});

export default MatchesKiller;
