import React, { useCallback, useMemo, useState, useEffect } from 'react';
import { observer } from 'mobx-react-lite';
import {
    ChartTitle,
    SmartChart,
    TGranularity,
} from '@deriv-com/smartcharts-champion';
import '@deriv-com/smartcharts-champion/dist/smartcharts.css';
import { useSmartChartAdaptor } from '@/hooks/useSmartChartAdaptor';
import { useStore } from '@/hooks/useStore';
import chart_api from '@/external/bot-skeleton/services/api/chart-api';
import ToolbarWidgets from '@/pages/chart/toolbar-widgets';
import { useDevice } from '@deriv-com/ui';
import ChunkLoader from '@/components/loader/chunk-loader';
import {
    Candle,
    CandleAnalysis,
    DonchianResult,
    PriceZone,
    SignalEvaluation,
    TimeframeKey,
    TransactionCardData,
} from '../types';

interface CandleChartProps {
    candles: Candle[];
    activeTimeframe: TimeframeKey;
    onTimeframeChange: (tf: TimeframeKey) => void;
    donchian: DonchianResult | null;
    zones: PriceZone[];
    signal: SignalEvaluation | null;
    transactions: TransactionCardData[];
    currentPrice: number;
    donchianPeriod: number;
    onChangeDonchianPeriod: (p: number) => void;
    isDarkMode?: boolean;
    autoAnalysisEnabled?: boolean;
    detectedPatterns?: Array<{ index: number; epoch: number; candle: Candle; analysis: CandleAnalysis }>;
    symbol?: string;
    onSymbolChange?: (symbol: string) => void;
}

const TIMEFRAME_TO_GRANULARITY: Record<TimeframeKey, TGranularity> = {
    '1m': 60,
    '5m': 300,
    '15m': 900,
    '30m': 1800,
};

const GRANULARITY_TO_TIMEFRAME: Record<number, TimeframeKey> = {
    60: '1m',
    300: '5m',
    900: '15m',
    1800: '30m',
};

export const CandleChart: React.FC<CandleChartProps> = observer(({
    activeTimeframe,
    onTimeframeChange,
    donchian,
    transactions,
    currentPrice,
    donchianPeriod,
    onChangeDonchianPeriod,
    isDarkMode = true,
    autoAnalysisEnabled = true,
    detectedPatterns = [],
    symbol = 'R_100',
    onSymbolChange,
}) => {
    const store = useStore();
    const common = store?.common;
    const { isDesktop, isMobile } = useDevice();

    // Chart type & Granularity state
    const [chartType, setChartType] = useState<string>('candles');
    const [granularity, setGranularity] = useState<TGranularity>(
        () => TIMEFRAME_TO_GRANULARITY[activeTimeframe] || 300
    );

    // Synchronize granularity when activeTimeframe changes from outside
    useEffect(() => {
        const expectedGranularity = TIMEFRAME_TO_GRANULARITY[activeTimeframe];
        if (expectedGranularity && expectedGranularity !== granularity) {
            setGranularity(expectedGranularity);
        }
    }, [activeTimeframe]);

    // Use official Deriv SmartCharts Champion Adaptor hook
    const { chartData, getQuotes, subscribeQuotes, unsubscribeQuotes } = useSmartChartAdaptor();

    const activeSymbol = symbol || 'R_100';

    // Socket connection status
    const is_connection_opened = Boolean(
        common?.is_socket_opened ||
        chart_api?.api?.connection?.readyState === WebSocket.OPEN ||
        (typeof window !== 'undefined' && (window as any)?.api_base?.api?.connection?.readyState === WebSocket.OPEN) ||
        (typeof window !== 'undefined' && (window as any)?.DerivAPI?.api?.connection?.readyState === WebSocket.OPEN)
    );

    // SmartChart configuration settings
    const settings = useMemo(
        () => ({
            assetInformation: false,
            countdown: true,
            isHighestLowestMarkerEnabled: false,
            language: common?.current_language ? common.current_language.toLowerCase() : 'en',
            position: 'bottom' as const,
            theme: (isDarkMode ? 'dark' : 'light') as 'dark' | 'light',
        }),
        [common?.current_language, isDarkMode]
    );

    // Effective trading times for the active symbol
    const effectiveTradingTimes = useMemo(() => {
        const times = { ...(chartData.tradingTimes || {}) };
        if (activeSymbol && !times[activeSymbol]) {
            times[activeSymbol] = {
                isOpen: true,
                openTime: '00:00:00',
                closeTime: '23:59:59',
            };
        }
        return times;
    }, [chartData.tradingTimes, activeSymbol]);

    const chartDataProp = useMemo(
        () => ({
            activeSymbols: chartData.activeSymbols,
            tradingTimes: effectiveTradingTimes,
        }),
        [chartData.activeSymbols, effectiveTradingTimes]
    );

    // SmartChart Barrier: Renders visual trade strike barrier when a contract is active
    const barriers: any[] = useMemo(() => {
        const openTrade = transactions.find(t => t.status === 'OPEN');
        if (!openTrade || !openTrade.entryPrice) return [];

        const isRise = openTrade.direction === 'RISE';
        return [
            {
                barrier: openTrade.entryPrice,
                color: isRise ? '#00a79e' : '#ff444f',
                lineStyle: 'solid',
                shade: isRise ? 'SHADE_UP' : 'SHADE_DOWN',
                shadeColor: isRise ? 'rgba(0, 167, 158, 0.15)' : 'rgba(255, 68, 79, 0.15)',
                title: `${openTrade.direction} Strike: ${openTrade.entryPrice}`,
                hideBarrierLine: false,
                hideOffscreenBarrier: false,
                hideOffscreenLabel: false,
            },
        ];
    }, [transactions]);

    // Handle granularity change from SmartCharts toolbar widget
    const handleGranularityChange = useCallback(
        (newGranularity: number) => {
            setGranularity(newGranularity as TGranularity);
            const mappedTf = GRANULARITY_TO_TIMEFRAME[newGranularity];
            if (mappedTf && mappedTf !== activeTimeframe) {
                onTimeframeChange(mappedTf);
            }
        },
        [activeTimeframe, onTimeframeChange]
    );

    // Handle timeframe pill clicks
    const handleSelectTimeframe = useCallback(
        (tf: TimeframeKey) => {
            onTimeframeChange(tf);
            const gran = TIMEFRAME_TO_GRANULARITY[tf];
            if (gran) {
                setGranularity(gran);
            }
        },
        [onTimeframeChange]
    );

    // Toolbar Widgets (Chart Type, Drawings, Indicators / StudyLegend, Views)
    const renderToolbarWidget = useCallback(
        () => (
            <ToolbarWidgets
                updateChartType={setChartType}
                updateGranularity={handleGranularityChange}
                position={!isDesktop ? 'bottom' : 'top'}
                isDesktop={isDesktop}
            />
        ),
        [setChartType, handleGranularityChange, isDesktop]
    );

    // Top Symbol Title widget
    const renderTopWidgets = useCallback(
        () => <ChartTitle onChange={onSymbolChange || (() => {})} />,
        [onSymbolChange]
    );

    const latestPattern = detectedPatterns.length > 0 ? detectedPatterns[detectedPatterns.length - 1] : null;

    return (
        <div className='rf-chart-wrapper'>
            {/* Soft UI Top Telemetry & Controls Toolbar */}
            <div className='rf-chart-toolbar'>
                <div className='rf-chart-toolbar__left'>
                    {/* Timeframe Selector Pills */}
                    <div className='rf-chart-toolbar__timeframes'>
                        {(['1m', '5m', '15m', '30m'] as TimeframeKey[]).map(tf => (
                            <button
                                key={tf}
                                type='button'
                                className={`rf-tf-btn ${activeTimeframe === tf ? 'rf-tf-btn--active' : ''}`}
                                onClick={() => handleSelectTimeframe(tf)}
                            >
                                {tf.toUpperCase()}
                            </button>
                        ))}
                    </div>

                    {/* Donchian Channel Period Configurator */}
                    <div
                        className='rf-chart-toolbar__donchian-config'
                        title='Donchian Channel Calculation Period'
                    >
                        <span className='rf-config-label'>Donchian:</span>
                        <input
                            type='number'
                            min={5}
                            max={100}
                            value={donchianPeriod}
                            onChange={e => onChangeDonchianPeriod(Number(e.target.value) || 20)}
                            className='rf-donchian-input'
                        />
                    </div>
                </div>

                <div className='rf-chart-toolbar__right'>
                    {autoAnalysisEnabled && latestPattern && (
                        <span className='rf-chart-pattern-badge'>
                            🎯 {latestPattern.analysis.patternLabel}
                        </span>
                    )}
                    {donchian && (
                        <span className='rf-chart-donchian-badge font-mono'>
                            Mid: {donchian.middle.toFixed(2)}
                        </span>
                    )}
                    {currentPrice > 0 && (
                        <div className='rf-candle-metrics'>
                            <span>
                                Spot: <b>{currentPrice.toFixed(2)}</b>
                            </span>
                        </div>
                    )}
                </div>
            </div>

            {/* Official Deriv SmartCharts Champion Canvas */}
            <div className='rf-smartchart-container' dir='ltr'>
                {activeSymbol ? (
                    <SmartChart
                        id={`rf-smartchart-${activeSymbol}`}
                        key={`rf-chart-${activeSymbol}`}
                        barriers={barriers}
                        bottomWidgets={undefined}
                        showLastDigitStats={false}
                        chartControlsWidgets={null}
                        enabledChartFooter={false}
                        toolbarWidget={renderToolbarWidget}
                        chartType={chartType}
                        isMobile={isMobile}
                        enabledNavigationWidget={isDesktop}
                        granularity={granularity}
                        getQuotes={getQuotes}
                        subscribeQuotes={subscribeQuotes}
                        unsubscribeQuotes={unsubscribeQuotes}
                        chartData={chartDataProp}
                        settings={settings}
                        symbol={activeSymbol}
                        topWidgets={onSymbolChange ? renderTopWidgets : undefined}
                        isConnectionOpened={is_connection_opened}
                        isLive
                        crosshair={isDesktop ? 1 : 0}
                        leftMargin={isDesktop ? 20 : 10}
                        yAxisMargin={{ top: 0, bottom: 0 }}
                        drawingToolFloatingMenuPosition={isMobile ? { x: 100, y: 100 } : { x: 200, y: 200 }}
                    />
                ) : (
                    <ChunkLoader message='Loading Official SmartCharts...' />
                )}
            </div>
        </div>
    );
});
