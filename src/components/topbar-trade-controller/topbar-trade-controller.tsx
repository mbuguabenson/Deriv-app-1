import React, { useEffect, useState, useCallback, useMemo } from 'react';
import RunStrategy from '@/pages/dashboard/run-strategy';
import { useStore } from '@/hooks/useStore';
import { observer as globalObserver } from '@/external/bot-skeleton/utils/observer';
import './topbar-trade-controller.scss';

export interface TopBarTradeControllerProps {
    currentTabKey: string;
}

type EngineStatus = {
    isRunning: boolean;
    state?: string;
    profit?: number;
};

export const TopBarTradeController: React.FC<TopBarTradeControllerProps> = ({ currentTabKey }) => {
    const [engineStatuses, setEngineStatuses] = useState<Record<string, EngineStatus>>({});
    const store = useStore();

    // Listen to real-time status updates dispatched by individual trading pages
    useEffect(() => {
        const handleStatusUpdate = (e: Event) => {
            const customEvent = e as CustomEvent<{ tab: string; isRunning: boolean; state?: string; profit?: number }>;
            if (customEvent.detail && customEvent.detail.tab) {
                setEngineStatuses(prev => ({
                    ...prev,
                    [customEvent.detail.tab]: {
                        isRunning: customEvent.detail.isRunning,
                        state: customEvent.detail.state,
                        profit: customEvent.detail.profit,
                    },
                }));
            }
        };

        window.addEventListener('PH_ENGINE_STATUS_UPDATE', handleStatusUpdate);
        return () => {
            window.removeEventListener('PH_ENGINE_STATUS_UPDATE', handleStatusUpdate);
        };
    }, []);

    const normalizedTab = (currentTabKey || '').toLowerCase();
    const currentStatus = engineStatuses[normalizedTab] || { isRunning: false };

    // Trigger action on the active trading engine
    const handleTriggerAction = useCallback(() => {
        const isRunning = Boolean(currentStatus.isRunning);

        if (isRunning) {
            // ── STOP ─────────────────────────────────────────────────────────────
            // Primary: call the MobX store stop directly — most reliable path
            try {
                if (store?.run_panel?.onStopBotClick) {
                    store.run_panel.onStopBotClick();
                } else if (store?.run_panel?.stopBot) {
                    store.run_panel.stopBot();
                }
            } catch (e) {
                console.warn('[TopBarTradeController] stop via store failed:', e);
            }

            // Secondary: emit the global observer event (works for bots not on run_panel)
            try {
                globalObserver.emit('bot.stop_button_click');
                globalObserver.emit('bot.stop');
            } catch {}

            // Tertiary: DOM fallback + PH event for non-bot strategies (Elite Pro, etc.)
            window.dispatchEvent(
                new CustomEvent('PH_TRIGGER_ENGINE_ACTION', {
                    detail: { tab: normalizedTab, action: 'stop' },
                })
            );

            // DOM click fallback (for pages that listen to their own stop button)
            setTimeout(() => {
                const stopSelectors: Record<string, string> = {
                    elite_pro: '.ep-btn--stop, button[data-testid="elite_pro_toggle"]',
                    poverty_hunter: '.ph-btn--stop, button[data-testid="poverty_hunter_toggle"]',
                    auto_x_eo: '.btn-stop-auto, button[data-testid="auto_x_eo_toggle"]',
                    marketkiller: '.mkill-btn, button[data-testid="marketkiller_strike"]',
                    market_hunter_pro: '.mhp-auto-btn, button[data-testid="market_hunter_start"]',
                    ai_trading_engine: '.ai-engine-run-btn, button[data-testid="ai_engine_start"]',
                    scanner: '.scanner-auto-btn, button[data-testid="scanner_start"]',
                    overlord_ai: '.btn-autotrade-stop, button[data-testid="overlord_ai_toggle"]',
                };
                const sel = stopSelectors[normalizedTab];
                if (sel) {
                    const btn = document.querySelector(sel) as HTMLElement;
                    if (btn) btn.click();
                }
            }, 10);
        } else {
            // ── START ─────────────────────────────────────────────────────────────
            window.dispatchEvent(
                new CustomEvent('PH_TRIGGER_ENGINE_ACTION', {
                    detail: { tab: normalizedTab, action: 'toggle' },
                })
            );

            setTimeout(() => {
                const startSelectors: Record<string, string> = {
                    elite_pro: '.ep-btn--start, button[data-testid="elite_pro_toggle"]',
                    poverty_hunter: '.ph-btn--start, button[data-testid="poverty_hunter_toggle"]',
                    auto_x_eo: '.btn-start-auto, button[data-testid="auto_x_eo_toggle"]',
                    marketkiller: '.strike-btn, button[data-testid="marketkiller_strike"]',
                    market_hunter_pro: '.mhp-auto-btn, .proai-btn-load, button[data-testid="market_hunter_start"]',
                    ai_trading_engine: '.entry-scanner-start, .ai-engine-run-btn, button[data-testid="ai_engine_start"]',
                    scanner: '.scanner-auto-btn, .scanner-run-btn, button[data-testid="scanner_start"]',
                    manual_trading: '.manual-trade-btn, .smart-trading-buy, button[data-testid="manual_trade_buy"]',
                    overlord_ai: '.btn-autotrade-start, button[data-testid="overlord_ai_toggle"]',
                };
                const sel = startSelectors[normalizedTab];
                if (sel) {
                    const btn = document.querySelector(sel) as HTMLElement;
                    if (btn) btn.click();
                }
            }, 10);
        }
    }, [normalizedTab, currentStatus.isRunning, store]);



    const tabConfig = useMemo(() => {
        switch (normalizedTab) {
            case 'elite_pro':
                return {
                    name: 'Elite Pro',
                    startLabel: 'START ELITE PRO',
                    stopLabel: 'STOP ELITE PRO',
                    icon: '⚡',
                    canToggle: true,
                };
            case 'poverty_hunter':
                return {
                    name: 'Poverty Hunter',
                    startLabel: 'START POVERTY HUNTER',
                    stopLabel: 'STOP POVERTY HUNTER',
                    icon: '🎯',
                    canToggle: true,
                };
            case 'auto_x_eo':
                return {
                    name: 'AUTO X E/O',
                    startLabel: 'START AUTO X E/O',
                    stopLabel: 'STOP AUTO X E/O',
                    icon: '🚀',
                    canToggle: true,
                };
            case 'overlord_ai':
                return {
                    name: 'Overlord AI',
                    startLabel: 'START OVERLORD AI',
                    stopLabel: 'STOP OVERLORD AI',
                    icon: '👑',
                    canToggle: true,
                };
            case 'marketkiller':
                return {
                    name: 'Market Killer',
                    startLabel: 'STRIKE MARKET KILLER',
                    stopLabel: 'STOP MARKET KILLER',
                    icon: '⚔️',
                    canToggle: true,
                };
            case 'market_hunter_pro':
                return {
                    name: 'Market Hunter',
                    startLabel: 'START AUTO-HUNTER',
                    stopLabel: 'STOP AUTO-HUNTER',
                    icon: '🏹',
                    canToggle: true,
                };
            case 'ai_trading_engine':
                return {
                    name: 'AI Trading Engine',
                    startLabel: 'START AI ENGINE',
                    stopLabel: 'STOP AI ENGINE',
                    icon: '🤖',
                    canToggle: true,
                };
            case 'scanner':
                return {
                    name: 'AI Scanner',
                    startLabel: 'START AI SCANNER',
                    stopLabel: 'STOP SCANNER',
                    icon: '🔍',
                    canToggle: true,
                };
            case 'manual_trading':
                return {
                    name: 'Manual Trading',
                    startLabel: 'QUICK STRIKE TRADE',
                    stopLabel: 'CANCEL TRADE',
                    icon: '🔥',
                    canToggle: false,
                };
            default:
                return null;
        }
    }, [normalizedTab]);

    // If on standard bot builder, dashboard, chart, etc., render the standard RunStrategy button
    if (!tabConfig) {
        return <RunStrategy />;
    }

    const isRunning = Boolean(currentStatus.isRunning);

    return (
        <div className='topbar-trade-controller'>
            <button
                className={`topbar-trade-btn ${isRunning ? 'topbar-trade-btn--running' : 'topbar-trade-btn--idle'}`}
                onClick={handleTriggerAction}
                title={`${isRunning ? 'Stop' : 'Start'} ${tabConfig.name}`}
            >
                <div className='topbar-trade-btn__pulse' />
                <div className='topbar-trade-btn__icon-box'>
                    {isRunning ? (
                        <svg width='14' height='14' viewBox='0 0 24 24' fill='currentColor'>
                            <rect x='4' y='4' width='16' height='16' rx='3' />
                        </svg>
                    ) : (
                        <svg width='14' height='14' viewBox='0 0 24 24' fill='currentColor'>
                            <polygon points='5 3 19 12 5 21 5 3' />
                        </svg>
                    )}
                </div>
                <span className='topbar-trade-btn__label'>
                    {isRunning ? tabConfig.stopLabel : tabConfig.startLabel}
                </span>
                <span className='topbar-trade-btn__tag'>{tabConfig.icon}</span>
            </button>
        </div>
    );
};

export default TopBarTradeController;
