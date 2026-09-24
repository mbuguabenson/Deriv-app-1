import React, { useEffect, useRef, useState } from 'react';
import { MarketSymbolInfo } from '../types';
import { Moon, Power, ShieldAlert, Sparkles, Sun, TrendingDown, TrendingUp, Wifi, WifiOff, Zap } from 'lucide-react';

interface RiseFallHeaderProps {
    market: MarketSymbolInfo | null;
    currentPrice: number;
    connectionStatus: boolean;
    loginid: string;
    balance: string | number;
    currency: string;
    isVirtual: boolean;
    autoTradingEnabled: boolean;
    onToggleAutoTrading: () => void;
    autoAnalysisEnabled: boolean;
    onToggleAutoAnalysis: () => void;
    tradingStatus: 'IDLE' | 'ANALYZING' | 'EXECUTING' | 'MONITORING' | 'PAUSED';
    pauseReason?: string;
    isDarkMode: boolean;
    onToggleTheme: () => void;
}

export const RiseFallHeader: React.FC<RiseFallHeaderProps> = ({
    market,
    currentPrice,
    connectionStatus,
    loginid,
    balance,
    currency,
    isVirtual,
    autoTradingEnabled,
    onToggleAutoTrading,
    autoAnalysisEnabled,
    onToggleAutoAnalysis,
    tradingStatus,
    pauseReason,
    isDarkMode,
    onToggleTheme,
}) => {
    const formattedPrice = currentPrice > 0 ? currentPrice.toFixed(market?.pipSize || 2) : '---';
    const numBalance = typeof balance === 'number' ? balance : parseFloat(String(balance || '0'));
    const formattedBalance = `${numBalance.toLocaleString(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    })} ${currency || 'USD'}`;

    // Tick direction flash state
    const prevPriceRef = useRef<number>(currentPrice);
    const [priceFlash, setPriceFlash] = useState<'up' | 'down' | null>(null);

    useEffect(() => {
        if (prevPriceRef.current > 0 && currentPrice > 0 && currentPrice !== prevPriceRef.current) {
            setPriceFlash(currentPrice > prevPriceRef.current ? 'up' : 'down');
            const timer = setTimeout(() => setPriceFlash(null), 500);
            return () => clearTimeout(timer);
        }
        prevPriceRef.current = currentPrice;
    }, [currentPrice]);

    return (
        <header className='rf-header'>
            <div className='rf-header__left'>
                <div className='rf-header__brand'>
                    <Zap className='rf-header__brand-icon' size={18} />
                    <span className='rf-header__brand-title'>Rise & Fall Pro</span>
                    <span className='rf-header__mode-badge'>DERIV PRO</span>
                </div>

                <div className='rf-header__market-info'>
                    <span className='rf-header__market-name'>{market?.displayName || 'Volatility 100 Index'}</span>

                    {/* Animated Pulsing Price */}
                    <div
                        className={`rf-header__price-wrapper ${
                            priceFlash === 'up'
                                ? 'rf-header__price-wrapper--up'
                                : priceFlash === 'down'
                                ? 'rf-header__price-wrapper--down'
                                : ''
                        }`}
                    >
                        {priceFlash === 'up' && <TrendingUp size={14} className='rf-flash-icon rf-text-bullish' />}
                        {priceFlash === 'down' && <TrendingDown size={14} className='rf-flash-icon rf-text-bearish' />}
                        <span className='rf-header__price-display'>{formattedPrice}</span>
                    </div>

                    <span className={`rf-badge rf-badge--market ${market?.isOpen ? 'rf-badge--open' : 'rf-badge--closed'}`}>
                        {market?.isOpen ? 'MARKET OPEN' : 'CLOSED'}
                    </span>
                    <span
                        className={`rf-badge rf-badge--conn ${connectionStatus ? 'rf-badge--connected' : 'rf-badge--disconnected'}`}
                    >
                        {connectionStatus ? <Wifi size={11} /> : <WifiOff size={11} />}
                        {connectionStatus ? 'CONNECTED' : 'OFFLINE'}
                    </span>
                </div>
            </div>

            <div className='rf-header__right'>
                {/* Account & Live Balance */}
                <div className='rf-header__account'>
                    <div className='rf-header__account-top'>
                        <span className={`rf-badge rf-badge--account-type ${isVirtual ? 'rf-badge--demo' : 'rf-badge--real'}`}>
                            {isVirtual ? 'DEMO' : 'REAL'}
                        </span>
                        <span className='rf-header__loginid'>{loginid || 'Guest'}</span>
                    </div>
                    <div className='rf-header__balance font-mono'>{formattedBalance}</div>
                </div>

                {/* Trading Status Badge */}
                <div className={`rf-badge rf-badge--status rf-badge--status-${tradingStatus.toLowerCase()}`}>
                    {tradingStatus === 'PAUSED' && <ShieldAlert size={12} />}
                    {tradingStatus}
                    {pauseReason && tradingStatus === 'PAUSED' && (
                        <span className='rf-badge__sub'>({pauseReason})</span>
                    )}
                </div>

                {/* Dark / Light Mode Switcher */}
                <button
                    className='rf-btn-theme-toggle'
                    onClick={onToggleTheme}
                    title={isDarkMode ? 'Switch to Light Theme' : 'Switch to Dark Theme'}
                >
                    {isDarkMode ? <Sun size={15} /> : <Moon size={15} />}
                </button>

                {/* Auto Technical Analysis Switch Button */}
                <button
                    className={`rf-btn-toggle-analysis ${autoAnalysisEnabled ? 'rf-btn-toggle-analysis--active' : ''}`}
                    onClick={onToggleAutoAnalysis}
                    title={autoAnalysisEnabled ? 'Turn OFF Auto Technical Analysis' : 'Turn ON Auto Technical Analysis'}
                >
                    <Sparkles size={13} />
                    <span>{autoAnalysisEnabled ? 'ANALYSIS: ON' : 'ANALYSIS: OFF'}</span>
                </button>

                {/* Auto Trading Switch Button */}
                <button
                    className={`rf-btn-toggle-auto ${autoTradingEnabled ? 'rf-btn-toggle-auto--active' : ''}`}
                    onClick={onToggleAutoTrading}
                    title={autoTradingEnabled ? 'Turn OFF Auto Trading' : 'Turn ON Auto Trading'}
                >
                    <Power size={14} />
                    <span>{autoTradingEnabled ? 'AUTO: ON' : 'AUTO: OFF'}</span>
                </button>
            </div>
        </header>
    );
};
