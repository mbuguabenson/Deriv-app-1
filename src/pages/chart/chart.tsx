import { useCallback, useEffect, useMemo, useState } from 'react';
import classNames from 'classnames';
import { observer } from 'mobx-react-lite';
/* [AI] - Analytics removed - rudderstack event tracking removed */
/* [/AI] */
import ChunkLoader from '@/components/loader/chunk-loader';
import chart_api from '@/external/bot-skeleton/services/api/chart-api';
import { useSmartChartAdaptor } from '@/hooks/useSmartChartAdaptor';
import { useStore } from '@/hooks/useStore';
import { ChartTitle, SmartChart, TGranularity, TStateChangeListener } from '@deriv-com/smartcharts-champion';
import { useDevice } from '@deriv-com/ui';
import ToolbarWidgets from './toolbar-widgets';
import '@deriv-com/smartcharts-champion/dist/smartcharts.css';

const EMPTY_BARRIERS: any[] = [];

const Chart = observer(({ show_digits_stats: _show_digits_stats }: { show_digits_stats?: boolean }) => {
    const barriers = EMPTY_BARRIERS;
    const store = useStore();
    const [isSafari, setIsSafari] = useState(false);

    const common = store?.common;
    const ui = store?.ui;
    const chart_store = store?.chart_store;
    const run_panel = store?.run_panel;
    const dashboard = store?.dashboard;

    const chart_type = chart_store?.chart_type;
    const getMarketsOrder = chart_store?.getMarketsOrder;
    const granularity = chart_store?.granularity;
    const onSymbolChange = chart_store?.onSymbolChange || (() => {});
    const setChartStatus = chart_store?.setChartStatus || (() => {});
    const symbol = chart_store?.symbol;
    const updateChartType = chart_store?.updateChartType || (() => {});
    const updateGranularity = chart_store?.updateGranularity || (() => {});

    // Use the custom hook for SmartChart Adaptor
    const { chartData, getQuotes, subscribeQuotes, unsubscribeQuotes } = useSmartChartAdaptor();

    const { isDesktop, isMobile } = useDevice();
    const is_drawer_open = run_panel?.is_drawer_open ?? false;
    const is_chart_modal_visible = dashboard?.is_chart_modal_visible ?? false;

    const settings = useMemo(() => ({
        assetInformation: false, // ui.is_chart_asset_info_visible,
        countdown: true,
        isHighestLowestMarkerEnabled: false, // TODO: Pending UI,
        language: common?.current_language ? common.current_language.toLowerCase() : 'en',
        position: (ui?.is_chart_layout_default ? 'bottom' : 'left') as 'bottom' | 'left',
        theme: (ui?.is_dark_mode_on ? 'dark' : 'light') as 'dark' | 'light',
    }), [common?.current_language, ui?.is_chart_layout_default, ui?.is_dark_mode_on]);

    useEffect(() => {
        // Safari browser detection using feature detection
        // More robust than user agent sniffing
        const isSafariBrowser = () => {
            // Check for Safari-specific features
            const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);

            // Additional check: Safari has specific webkit features
            const hasWebkitFeatures = 'webkitAudioContext' in window || 'WebKitMediaSource' in window;

            return isSafari && hasWebkitFeatures;
        };

        setIsSafari(isSafariBrowser());

        return () => {
            try {
                chart_api.api?.forgetAll?.('ticks');
            } catch {}
        };
    }, []);

    const activeSymbolsList = chartData.activeSymbols;

    // Resolve a safe, strictly valid symbol synchronously on every render
    const validSymbol = useMemo(() => {
        if (!activeSymbolsList || activeSymbolsList.length === 0) return symbol || 'R_100';
        if (symbol && activeSymbolsList.some(s => s.symbol === symbol)) {
            return symbol;
        }
        return (
            activeSymbolsList.find(s => s.symbol === 'R_100')?.symbol ||
            activeSymbolsList.find(s => s.symbol === 'R_50')?.symbol ||
            activeSymbolsList.find(s => s.symbol === 'R_10')?.symbol ||
            activeSymbolsList[0]?.symbol ||
            'R_100'
        );
    }, [activeSymbolsList, symbol]);

    // Keep chart_store symbol synchronized if it differs from the valid symbol
    useEffect(() => {
        if (validSymbol && validSymbol !== symbol) {
            onSymbolChange(validSymbol);
        }
    }, [validSymbol, symbol, onSymbolChange]);

    // Handle chart canvas recalculation on mount and when run panel drawer opens/closes
    useEffect(() => {
        const timer1 = setTimeout(() => {
            window.dispatchEvent(new Event('resize'));
        }, 50);
        const timer2 = setTimeout(() => {
            window.dispatchEvent(new Event('resize'));
        }, 200);
        const timer3 = setTimeout(() => {
            window.dispatchEvent(new Event('resize'));
        }, 500);
        return () => {
            clearTimeout(timer1);
            clearTimeout(timer2);
            clearTimeout(timer3);
        };
    }, [is_drawer_open]);

    // Manage reactive connection state for SmartChart
    const checkSocketOpen = () => Boolean(
        common?.is_socket_opened ||
        chart_api?.api?.connection?.readyState === WebSocket.OPEN ||
        (typeof window !== 'undefined' && (window as any)?.api_base?.api?.connection?.readyState === WebSocket.OPEN) ||
        (typeof window !== 'undefined' && (window as any)?.DerivAPI?.api?.connection?.readyState === WebSocket.OPEN)
    );

    const [isSocketConnected, setIsSocketConnected] = useState(checkSocketOpen);

    useEffect(() => {
        let isMounted = true;

        const updateConnectionStatus = () => {
            if (!isMounted) return;
            const isOpen = checkSocketOpen();
            setIsSocketConnected(prev => (prev !== isOpen ? isOpen : prev));
        };

        updateConnectionStatus();

        // Proactively request chart API initialization if not already done
        chart_api.init?.().then(() => {
            updateConnectionStatus();
            const conn = chart_api.api?.connection;
            if (conn) {
                conn.addEventListener('open', updateConnectionStatus);
                conn.addEventListener('close', updateConnectionStatus);
                conn.addEventListener('error', updateConnectionStatus);
            }
        }).catch(() => {});

        const conn = chart_api.api?.connection;
        if (conn) {
            conn.addEventListener('open', updateConnectionStatus);
            conn.addEventListener('close', updateConnectionStatus);
            conn.addEventListener('error', updateConnectionStatus);
        }

        // Fast poll every 100ms for 3 seconds to catch early socket state transitions
        const intervalId = setInterval(updateConnectionStatus, 100);
        const timeoutId = setTimeout(() => clearInterval(intervalId), 3000);

        return () => {
            isMounted = false;
            clearInterval(intervalId);
            clearTimeout(timeoutId);
            const currentConn = chart_api.api?.connection;
            if (currentConn) {
                currentConn.removeEventListener('open', updateConnectionStatus);
                currentConn.removeEventListener('close', updateConnectionStatus);
                currentConn.removeEventListener('error', updateConnectionStatus);
            }
        };
    }, [common?.is_socket_opened]);

    const is_connection_opened = Boolean(
        isSocketConnected ||
        common?.is_socket_opened ||
        chart_api?.api?.connection?.readyState === WebSocket.OPEN ||
        (typeof window !== 'undefined' && (window as any)?.api_base?.api?.connection?.readyState === WebSocket.OPEN) ||
        (typeof window !== 'undefined' && (window as any)?.DerivAPI?.api?.connection?.readyState === WebSocket.OPEN)
    );

    const handleStateChange: TStateChangeListener = (state, _options) => {
        /* [AI] - Analytics removed - rudderstack event call removed */
        // Handle state changes: INITIAL, READY, SCROLL_TO_LEFT
        /* [/AI] */
        if (state === 'READY') {
            setChartStatus(true);
        }
    };

    const effectiveTradingTimes = useMemo(() => {
        const times = { ...(chartData.tradingTimes || {}) };
        const sym = validSymbol || symbol;
        if (sym && !times[sym]) {
            times[sym] = {
                isOpen: true,
                openTime: '00:00:00',
                closeTime: '23:59:59',
            };
        }
        return times;
    }, [chartData.tradingTimes, validSymbol, symbol]);

    const chartDataProp = useMemo(() => ({
        activeSymbols: chartData.activeSymbols,
        tradingTimes: effectiveTradingTimes,
    }), [chartData.activeSymbols, effectiveTradingTimes]);

    const renderToolbarWidget = useCallback(() => (
        <ToolbarWidgets
            updateChartType={updateChartType}
            updateGranularity={updateGranularity}
            position={!isDesktop ? 'bottom' : 'top'}
            isDesktop={isDesktop}
        />
    ), [updateChartType, updateGranularity, isDesktop]);

    const renderTopWidgets = useCallback(() => (
        <ChartTitle onChange={onSymbolChange} />
    ), [onSymbolChange]);

    const isChartReadyToMount = Boolean(
        store &&
        chart_store &&
        validSymbol
    );

    if (!isChartReadyToMount || !validSymbol) {
        return <ChunkLoader message='' />;
    }

    return (
        <div
            className={classNames('dashboard__chart-wrapper', {
                'dashboard__chart-wrapper--expanded': is_drawer_open && isDesktop,
                'dashboard__chart-wrapper--modal': is_chart_modal_visible && isDesktop,
                'dashboard__chart-wrapper--safari': isSafari,
            })}
            dir='ltr'
        >
            <SmartChart
                id={`dbot-${validSymbol}`}
                key={`chart-${validSymbol}`}
                barriers={barriers}
                bottomWidgets={undefined}
                showLastDigitStats={false}
                chartControlsWidgets={null}
                enabledChartFooter={false}
                stateChangeListener={handleStateChange}
                toolbarWidget={renderToolbarWidget}
                chartType={chart_type}
                isMobile={isMobile}
                enabledNavigationWidget={isDesktop}
                granularity={granularity as TGranularity}
                getQuotes={getQuotes}
                subscribeQuotes={subscribeQuotes}
                unsubscribeQuotes={unsubscribeQuotes}
                chartData={chartDataProp}
                settings={settings}
                symbol={validSymbol}
                topWidgets={renderTopWidgets}
                isConnectionOpened={is_connection_opened}
                getMarketsOrder={getMarketsOrder}
                isLive
                leftMargin={isDesktop ? 20 : 10}
                yAxisMargin={{ top: 0, bottom: 0 }}
                drawingToolFloatingMenuPosition={isMobile ? { x: 100, y: 100 } : { x: 200, y: 200 }}
            />
        </div>
    );
});

export default Chart;
