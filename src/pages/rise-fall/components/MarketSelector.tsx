import React, { useState, useMemo } from 'react';
import { MarketSymbolInfo } from '../types';
import { ChevronDown, Search } from 'lucide-react';

interface MarketSelectorProps {
    markets: MarketSymbolInfo[];
    selectedSymbol: string;
    onSelectMarket: (symbol: string) => void;
}

export const MarketSelector: React.FC<MarketSelectorProps> = ({
    markets,
    selectedSymbol,
    onSelectMarket,
}) => {
    const [isOpen, setIsOpen] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [activeCategory, setActiveCategory] = useState<'all' | 'volatility' | 'forex'>('volatility');

    const selectedMarket = useMemo(
        () => markets.find(m => m.symbol === selectedSymbol) || markets[0],
        [markets, selectedSymbol]
    );

    const filteredMarkets = useMemo(() => {
        return markets.filter(m => {
            const matchesCat =
                activeCategory === 'all' ||
                (activeCategory === 'volatility' && m.category === 'volatility') ||
                (activeCategory === 'forex' && m.category === 'forex');
            const matchesSearch =
                m.displayName.toLowerCase().includes(searchQuery.toLowerCase()) ||
                m.symbol.toLowerCase().includes(searchQuery.toLowerCase());
            return matchesCat && matchesSearch;
        });
    }, [markets, activeCategory, searchQuery]);

    const handleSelect = (symbol: string) => {
        onSelectMarket(symbol);
        setIsOpen(false);
        setSearchQuery('');
    };

    return (
        <div className='rf-market-selector'>
            <button
                className='rf-market-selector__btn'
                onClick={() => setIsOpen(!isOpen)}
                aria-expanded={isOpen}
            >
                <div className='rf-market-selector__label-group'>
                    <span className='rf-market-selector__category-badge'>
                        {selectedMarket?.category.toUpperCase() || 'INDEX'}
                    </span>
                    <span className='rf-market-selector__name'>{selectedMarket?.displayName || selectedSymbol}</span>
                </div>
                <ChevronDown size={16} className={`rf-market-selector__arrow ${isOpen ? 'rf-market-selector__arrow--open' : ''}`} />
            </button>

            {isOpen && (
                <div className='rf-market-selector__dropdown'>
                    {/* Search & Category Tabs */}
                    <div className='rf-market-selector__header'>
                        <div className='rf-market-selector__search'>
                            <Search size={14} />
                            <input
                                type='text'
                                placeholder='Search market (e.g. Volatility 100, EUR/USD)...'
                                value={searchQuery}
                                onChange={e => setSearchQuery(e.target.value)}
                                autoFocus
                            />
                        </div>

                        <div className='rf-market-selector__categories'>
                            <button
                                className={`rf-cat-btn ${activeCategory === 'volatility' ? 'rf-cat-btn--active' : ''}`}
                                onClick={() => setActiveCategory('volatility')}
                            >
                                Volatility Indices
                            </button>
                            <button
                                className={`rf-cat-btn ${activeCategory === 'forex' ? 'rf-cat-btn--active' : ''}`}
                                onClick={() => setActiveCategory('forex')}
                            >
                                Forex
                            </button>
                            <button
                                className={`rf-cat-btn ${activeCategory === 'all' ? 'rf-cat-btn--active' : ''}`}
                                onClick={() => setActiveCategory('all')}
                            >
                                All Markets
                            </button>
                        </div>
                    </div>

                    {/* Market List */}
                    <div className='rf-market-selector__list'>
                        {filteredMarkets.length === 0 ? (
                            <div className='rf-market-selector__empty'>No markets match your search</div>
                        ) : (
                            filteredMarkets.map(m => (
                                <button
                                    key={m.symbol}
                                    className={`rf-market-item ${m.symbol === selectedSymbol ? 'rf-market-item--selected' : ''}`}
                                    onClick={() => handleSelect(m.symbol)}
                                >
                                    <div className='rf-market-item__info'>
                                        <span className='rf-market-item__title'>{m.displayName}</span>
                                        <span className='rf-market-item__symbol'>{m.symbol}</span>
                                    </div>
                                    <span className={`rf-market-item__status ${m.isOpen ? 'rf-market-item__status--open' : ''}`}>
                                        {m.isOpen ? 'OPEN' : 'CLOSED'}
                                    </span>
                                </button>
                            ))
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};
