import React from 'react';
import { StrategyDirection } from '../types/b254.types';
import { ChevronLeft, ChevronRight, Compass } from 'lucide-react';

export interface ScannerMarketItem {
    symbol: string;
    label: string;
    price: string;
    lastDigit: number;
    under04Pct: number;
    over59Pct: number;
    under05Pct: number;
    over49Pct: number;
    last7Ratio: string;
    last10Ratio: string;
    bias50t: 'UNDER' | 'OVER' | 'BALANCED';
    bias1000t: 'UNDER' | 'OVER' | 'BALANCED';
    history30mBias: 'UNDER' | 'OVER' | 'NEUTRAL';
    history1hBias: 'UNDER' | 'OVER' | 'NEUTRAL';
    regime: string;
    signalScore: number;
    isBestMarket: boolean;
    isEntryReady: boolean;
    favoredDirection: StrategyDirection;
    entryDigit: number;
}

interface MarketScannerSidebarProps {
    isExpanded: boolean;
    onToggleExpand: () => void;
    markets: ScannerMarketItem[];
    selectedSymbol: string;
    onSelectMarket: (symbol: string) => void;
    scanAllMarkets: boolean;
    onToggleScanAll: (val: boolean) => void;
    autoInputBestMarket: boolean;
    onToggleAutoInputBest: (val: boolean) => void;
    bestMarket: ScannerMarketItem | null;
}

export const MarketScannerSidebar: React.FC<MarketScannerSidebarProps> = ({
    isExpanded,
    onToggleExpand,
    markets,
    selectedSymbol,
    onSelectMarket,
    scanAllMarkets,
    onToggleScanAll,
    autoInputBestMarket,
    onToggleAutoInputBest,
    bestMarket,
}) => {
    return (
        <aside className={`b254-glass b254-sidebar-scanner ${isExpanded ? 'expanded' : 'collapsed'}`}>
            {/* Sidebar Top Header */}
            <div className='b254-sidebar-header'>
                <div className='title-wrap'>
                    <Compass size={18} className='text-cyan' />
                    {isExpanded && (
                        <div>
                            <h4>Market Scanner</h4>
                            <span className='subtitle'>{markets.length} Synthetic Indices</span>
                        </div>
                    )}
                </div>

                <button
                    className='b254-btn-collapse'
                    onClick={onToggleExpand}
                    title={isExpanded ? 'Collapse Scanner Tray' : 'Expand Scanner Tray'}
                >
                    {isExpanded ? <ChevronLeft size={16} /> : <ChevronRight size={16} />}
                </button>
            </div>

            {/* Controls Row (When Expanded) */}
            {isExpanded && (
                <div className='b254-scanner-controls'>
                    <label className='b254-checkbox-label'>
                        <input
                            type='checkbox'
                            checked={scanAllMarkets}
                            onChange={e => onToggleScanAll(e.target.checked)}
                        />
                        <span className='custom-checkbox' />
                        <span>Scan All Markets</span>
                    </label>

                    <label className='b254-checkbox-label'>
                        <input
                            type='checkbox'
                            checked={autoInputBestMarket}
                            onChange={e => onToggleAutoInputBest(e.target.checked)}
                        />
                        <span className='custom-checkbox' />
                        <span>Auto-Input Best Market</span>
                    </label>
                </div>
            )}

            {/* Collapsed Minimal Summary */}
            {!isExpanded && bestMarket && (
                <div className='b254-collapsed-best-card' onClick={() => onSelectMarket(bestMarket.symbol)}>
                    <div className='tag'>BEST MARKET</div>
                    <strong className='name'>{bestMarket.label}</strong>
                    <div className='price'>{bestMarket.price}</div>
                    <div className={`digit-badge ${bestMarket.lastDigit <= 5 ? 'under' : 'over'}`}>
                        {bestMarket.lastDigit}
                    </div>
                    <span className='strat-pill'>{bestMarket.favoredDirection.replace('_', ' ')}</span>
                    <span className='score-pill'>{bestMarket.signalScore}/100</span>
                </div>
            )}

            {/* Expanded Market Cards List */}
            {isExpanded && (
                <div className='b254-market-cards-list'>
                    {markets.map(m => {
                        const isSelected = m.symbol === selectedSymbol;
                        const isUnder = m.favoredDirection === 'UNDER_6';

                        return (
                            <div
                                key={m.symbol}
                                className={`b254-market-item-card ${isSelected ? 'selected' : ''} ${m.isBestMarket ? 'best-glow' : ''}`}
                                onClick={() => onSelectMarket(m.symbol)}
                            >
                                <div className='card-top'>
                                    <div className='name-row'>
                                        <strong className='label'>{m.label}</strong>
                                        {m.isBestMarket && <span className='top-tag'>TOP</span>}
                                        {m.isEntryReady && <span className='ready-tag'>⚡ READY</span>}
                                    </div>

                                    <div className='price-box'>{m.price}</div>

                                    <div className={`digit-chip ${m.lastDigit <= 5 ? 'under' : 'over'}`}>
                                        {m.lastDigit}
                                    </div>
                                </div>

                                <div className='ratios-strip'>
                                    <div className='progress-mini-bar'>
                                        <div className='u-fill' style={{ width: `${m.under05Pct}%` }} />
                                        <div className='o-fill' style={{ width: `${m.over49Pct}%` }} />
                                    </div>
                                    <div className='labels-row'>
                                        <span>U(0-5): {m.under05Pct.toFixed(0)}%</span>
                                        <span>O(4-9): {m.over49Pct.toFixed(0)}%</span>
                                    </div>
                                </div>

                                <div className='card-foot'>
                                    <span className={`direction-tag ${isUnder ? 'under' : 'over'}`}>
                                        {m.favoredDirection.replace('_', ' ')} (Digit [{m.entryDigit}])
                                    </span>
                                    <span className='score-tag'>Score: <strong>{m.signalScore}</strong></span>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </aside>
    );
};
