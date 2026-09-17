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

    const toggleCondition = (index: number) => {
        const next = [...matches_settings.enabled_conditions];
        next[index] = !next[index];
        runInAction(() => {
            marketkiller.matches_settings.enabled_conditions = next;
        });
    };

    const conditions = [
        { id: 1, key: '1. TOP-3 RANKING', desc: 'Use Most, 2nd, and Least digits' },
        { id: 2, key: '2. POWER ACCELERATION', desc: 'Prediction power must be increasing' },
        { id: 3, key: '3. DUAL VELOCITY', desc: 'Increase simultaneously twice' },
        { id: 4, key: '4. SEQUENTIAL STABILITY', desc: 'Last 5 digits must be Top-3' },
        { id: 5, key: '5. PROBABILITY THRESHOLD', desc: 'Prediction power must be above N%' },
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

                        <div className='target-input'>
                            <label className='uppercase tracking-widest font-bold'>Active Targets (Max 10)</label>
                            <input
                                type='number'
                                min='1'
                                max='10'
                                className='font-black'
                                value={matches_settings.simultaneous_trades}
                                onChange={e =>
                                    runInAction(() => {
                                        marketkiller.matches_settings.simultaneous_trades = parseInt(e.target.value);
                                    })
                                }
                            />
                        </div>

                        <div className='slots-grid'>
                            {Array.from({ length: matches_settings.simultaneous_trades || 1 }).map((_, idx) => {
                                const sortedDigits = [...digit_stats]
                                    .sort((a, b) => b.count - a.count)
                                    .map(s => s.digit);
                                const autoDigit = sortedDigits[idx] ?? 0;
                                const displayValue = matches_settings.is_auto
                                    ? autoDigit
                                    : (matches_settings.predictions[idx] ?? 0);

                                return (
                                    <div key={idx} className='slot-card'>
                                        <label className='uppercase tracking-widest font-bold'>Slot {idx + 1}</label>
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
                                        {!matches_settings.is_auto && (
                                            <button
                                                className='strike-btn uppercase tracking-widest font-black'
                                                onClick={() =>
                                                    marketkiller.executeSingleManualTrade(
                                                        matches_settings.predictions[idx]
                                                    )
                                                }
                                            >
                                                Strike
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
                                style={{
                                    width: '100%',
                                    marginTop: '1rem',
                                    padding: '0.75rem',
                                    borderRadius: '0.75rem',
                                    border: 'none',
                                    background: 'linear-gradient(to right, #10b981, #059669)',
                                    color: '#fff',
                                    cursor: 'pointer',
                                    boxShadow: '0 4px 15px rgba(16, 185, 129, 0.4)',
                                    transition: 'all 0.2s',
                                }}
                                className='uppercase tracking-widest font-black hover:opacity-90'
                            >
                                STRIKE MULTI-BURST ({matches_settings.simultaneous_trades})
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
                                                    onClick={e => e.stopPropagation()} // Prevent toggling the gate when editing input
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
