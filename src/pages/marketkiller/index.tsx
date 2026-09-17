import React, { useEffect } from 'react';
import classNames from 'classnames';
import { observer } from 'mobx-react-lite';
import { useStore } from '@/hooks/useStore';
import { getGroupedMarkets } from '@/constants/markets';
import MatchesKiller from './components/matches-killer';
import Onetrader from './components/onetrader';
import './marketkiller.scss';

const Marketkiller = observer(() => {
    const { marketkiller } = useStore();
    const { active_subtab, current_price, last_digit, symbol, is_connected, is_running } = marketkiller;

    useEffect(() => {
        // Kickstart streaming ticks & stats on mount
        marketkiller.subscribeToTicks();
        marketkiller.subscribeToRibbon();

        return () => {
            // Safety cleanup hook
            marketkiller.is_running = false;
            marketkiller.cleanupSubscriptions();
        };
    }, [symbol]);

    const marketGroups = getGroupedMarkets();

    return (
        <div className='marketkiller-wrapper'>
            <div className='mk-global-header'>
                <div className='mk-header-left'>
                    <div className='mk-header-title-wrap'>
                        <span className='mk-header-icon'>🔪</span>
                        <div className='mk-header-title-text'>
                            <h2>MARKETKILLER</h2>
                            <span className='mk-connection-status'>
                                {is_connected ? '● LIVE CONNECTION' : '○ RECONNECTING...'}
                            </span>
                        </div>
                    </div>

                    <div className='mk-market-selector'>
                        <label>ACTIVE STREAM</label>
                        <select value={symbol} onChange={e => marketkiller.setSymbol(e.target.value)}>
                            {marketGroups.map(group => (
                                <optgroup key={group.group} label={group.group}>
                                    {group.items.map(m => (
                                        <option key={m.value} value={m.value}>
                                            {m.label}
                                        </option>
                                    ))}
                                </optgroup>
                            ))}
                        </select>
                    </div>
                </div>

                <div className='mk-live-feed'>
                    <div className='price-display'>
                        <span className='label'>TICK QUOTE</span>
                        <span className='value'>{current_price || '0.000'}</span>
                    </div>
                    <div className='digit-display'>{last_digit !== null ? last_digit : '-'}</div>

                    <button
                        className={classNames('mk-btn-primary', { running: is_running })}
                        onClick={() => marketkiller.toggleEngine()}
                    >
                        {is_running ? 'TERMINATE' : 'ACTIVATE KILLER'}
                    </button>
                </div>
            </div>

            <div className='mk-sub-nav'>
                <button
                    className={classNames({ active: active_subtab === 'onetrader' })}
                    onClick={() => marketkiller.setActiveSubtab('onetrader')}
                >
                    ONETRADER
                </button>
                <button
                    className={classNames({ active: active_subtab === 'matches' })}
                    onClick={() => marketkiller.setActiveSubtab('matches')}
                >
                    MATCHES KILLER
                </button>
            </div>

            <div className='mk-content'>
                {active_subtab === 'onetrader' && <Onetrader />}
                {active_subtab === 'matches' && <MatchesKiller />}
            </div>
        </div>
    );
});

export default Marketkiller;
