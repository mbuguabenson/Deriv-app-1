import React, { useEffect, useState } from 'react';
import {
    aiGlobalAutoTraderService,
    GlobalAiConfig,
    GlobalAiState,
    StrategyFamily,
    GlobalAiMode,
} from '@/services/ai-global-autotrader.service';
import { aiMarketPatternService, MarketPatternTelemetry } from '@/services/ai-market-pattern.service';
import {
    Brain,
    Sliders,
    TrendingUp,
    Shield,
    Volume2,
    Bell,
    CheckCircle2,
    X,
    Activity,
    Zap,
    RotateCcw,
} from 'lucide-react';
import './global-ai-hud.scss';

interface GlobalAiSettingsModalProps {
    isOpen: boolean;
    onClose: () => void;
}

export const GlobalAiSettingsModal: React.FC<GlobalAiSettingsModalProps> = ({ isOpen, onClose }) => {
    const [config, setConfig] = useState<GlobalAiConfig>({
        mode: 'autonomous_trading',
        strategyFamily: 'ALL_ADAPTIVE',
        stake: 0.50,
        martingale: 2.6,
        takeProfit: 10.00,
        stopLoss: 25.00,
        tickDuration: 1,
        soundAlerts: true,
        toastAlerts: true,
        minConfidence: 75,
    });

    const [state, setState] = useState<GlobalAiState>(() => ({
        isRunning: false,
        status: 'IDLE',
        activeMarket: 'R_100',
        activeMarketLabel: 'Vol 100',
        currentStake: 0.50,
        totalProfit: 0,
        wins: 0,
        losses: 0,
        consecutiveLosses: 0,
        winRate: 0,
        lastActionMessage: '',
        aiThoughts: [],
    }));

    const [telemetry, setTelemetry] = useState<Map<string, MarketPatternTelemetry>>(new Map());

    useEffect(() => {
        const unsubTrader = aiGlobalAutoTraderService.subscribe((s, c) => {
            setState(s);
            setConfig(c);
        });
        const unsubPattern = aiMarketPatternService.subscribe(t => {
            setTelemetry(new Map(t));
        });
        return () => {
            unsubTrader();
            unsubPattern();
        };
    }, []);

    if (!isOpen) return null;

    const handleSave = () => {
        aiGlobalAutoTraderService.updateConfig(config);
        onClose();
    };

    const telemetryList = Array.from(telemetry.values());

    return (
        <div className='global-ai-modal-overlay'>
            <div className='global-ai-modal'>
                <div className='global-ai-modal__header'>
                    <div className='title-wrap'>
                        <Brain size={22} className='text-purple' />
                        <div>
                            <h3>Site-Wide AI Master Controller</h3>
                            <p>Autonomous Trading, Neural Trend Detection &amp; Real-Time Feedback Configuration</p>
                        </div>
                    </div>
                    <button className='close-btn' onClick={onClose}>
                        <X size={18} />
                    </button>
                </div>

                <div className='global-ai-modal__body'>
                    {/* Mode Selector */}
                    <div className='config-section'>
                        <label className='section-label'>
                            <Activity size={16} /> Operational Mode
                        </label>
                        <div className='mode-toggle-grid'>
                            <button
                                className={`mode-btn ${config.mode === 'autonomous_trading' ? 'active' : ''}`}
                                onClick={() => setConfig({ ...config, mode: 'autonomous_trading' })}
                            >
                                <Zap size={16} />
                                <div>
                                    <strong>Full Autonomous Trading</strong>
                                    <span>AI scans, analyzes, and executes trades site-wide automatically</span>
                                </div>
                            </button>

                            <button
                                className={`mode-btn ${config.mode === 'advisory_signals_only' ? 'active' : ''}`}
                                onClick={() => setConfig({ ...config, mode: 'advisory_signals_only' })}
                            >
                                <Brain size={16} />
                                <div>
                                    <strong>Advisory &amp; Signals Only</strong>
                                    <span>AI broadcasts real-time entry alerts without auto-placing orders</span>
                                </div>
                            </button>
                        </div>
                    </div>

                    {/* Permitted Strategy Filter */}
                    <div className='config-section'>
                        <label className='section-label'>
                            <Sliders size={16} /> Permitted Strategy Engine
                        </label>
                        <select
                            className='ai-input-select'
                            value={config.strategyFamily}
                            onChange={e => setConfig({ ...config, strategyFamily: e.target.value as StrategyFamily })}
                        >
                            <option value='ALL_ADAPTIVE'>Multi-Strategy Adaptive (Auto-selects highest-conviction pattern)</option>
                            <option value='ELITE_PRO_OVER_UNDER'>Elite Pro (Under 6 &amp; Over 3 Only)</option>
                            <option value='POVERTY_HUNTER_DIFFERS'>Poverty Hunter (Lowest Transition Differs Only)</option>
                            <option value='AUTO_EO'>Auto X Even/Odd (Markov Parity Matrix Only)</option>
                        </select>
                    </div>

                    {/* Risk & Money Management Inputs */}
                    <div className='config-section'>
                        <label className='section-label'>
                            <Shield size={16} /> Risk Management &amp; Execution Settings
                        </label>
                        <div className='inputs-grid'>
                            <div className='input-field'>
                                <span>Base Stake ($)</span>
                                <input
                                    type='number'
                                    step='0.1'
                                    value={config.stake}
                                    onChange={e => setConfig({ ...config, stake: parseFloat(e.target.value) || 0.5 })}
                                />
                            </div>

                            <div className='input-field'>
                                <span>Martingale Multiplier</span>
                                <input
                                    type='number'
                                    step='0.1'
                                    value={config.martingale}
                                    onChange={e => setConfig({ ...config, martingale: parseFloat(e.target.value) || 2.6 })}
                                />
                            </div>

                            <div className='input-field'>
                                <span>Take Profit ($)</span>
                                <input
                                    type='number'
                                    step='1'
                                    value={config.takeProfit}
                                    onChange={e => setConfig({ ...config, takeProfit: parseFloat(e.target.value) || 10 })}
                                />
                            </div>

                            <div className='input-field'>
                                <span>Stop Loss ($)</span>
                                <input
                                    type='number'
                                    step='1'
                                    value={config.stopLoss}
                                    onChange={e => setConfig({ ...config, stopLoss: parseFloat(e.target.value) || 25 })}
                                />
                            </div>

                            <div className='input-field'>
                                <span>Tick Duration</span>
                                <select
                                    value={config.tickDuration}
                                    onChange={e => setConfig({ ...config, tickDuration: parseInt(e.target.value, 10) || 1 })}
                                >
                                    <option value='1'>1 Tick (Recommended)</option>
                                    <option value='2'>2 Ticks</option>
                                </select>
                            </div>

                            <div className='input-field'>
                                <span>Min Pattern Confidence</span>
                                <select
                                    value={config.minConfidence}
                                    onChange={e => setConfig({ ...config, minConfidence: parseInt(e.target.value, 10) || 75 })}
                                >
                                    <option value='70'>70% (Aggressive)</option>
                                    <option value='75'>75% (Balanced)</option>
                                    <option value='80'>80% (High Quality)</option>
                                    <option value='85'>85% (Ultra Strict)</option>
                                </select>
                            </div>
                        </div>
                    </div>

                    {/* Real-time Feedback Notifications */}
                    <div className='config-section'>
                        <label className='section-label'>
                            <Bell size={16} /> Real-Time User Feedback &amp; Alerts
                        </label>
                        <div className='toggles-row'>
                            <label className='toggle-checkbox'>
                                <input
                                    type='checkbox'
                                    checked={config.toastAlerts}
                                    onChange={e => setConfig({ ...config, toastAlerts: e.target.checked })}
                                />
                                <span>Popup HUD Toast Notifications for Executions &amp; Trades</span>
                            </label>
                            <label className='toggle-checkbox'>
                                <input
                                    type='checkbox'
                                    checked={config.soundAlerts}
                                    onChange={e => setConfig({ ...config, soundAlerts: e.target.checked })}
                                />
                                <span>Sound Chimes for Trade Executions &amp; Wins</span>
                            </label>
                        </div>
                    </div>

                    {/* Live Market Pattern & Trend Inspector */}
                    <div className='config-section'>
                        <label className='section-label'>
                            <TrendingUp size={16} /> Live Market Pattern &amp; Trend Telemetry ({telemetryList.length} Markets)
                        </label>
                        <div className='telemetry-grid'>
                            {telemetryList.slice(0, 8).map(t => (
                                <div key={t.symbol} className='telemetry-card'>
                                    <div className='card-top'>
                                        <strong>{t.symbol}</strong>
                                        <span className={`trend-badge ${t.trendState.trend.toLowerCase()}`}>
                                            {t.trendState.trend.replace('_', ' ')} ({t.trendState.slopePct > 0 ? '+' : ''}{t.trendState.slopePct}%)
                                        </span>
                                    </div>
                                    <p className='pattern-desc'>{t.primaryPattern.description}</p>
                                    <div className='card-foot'>
                                        <span className='strategy-tag'>Favors: {t.primaryPattern.favoredStrategy}</span>
                                        <span className='conf-tag'>{t.primaryPattern.confidence}%</span>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>

                <div className='global-ai-modal__footer'>
                    <button
                        className='btn-reset'
                        onClick={() => aiGlobalAutoTraderService.resetStats()}
                        title='Reset Global AI session P&L'
                    >
                        <RotateCcw size={14} /> Reset Session Stats
                    </button>
                    <div className='footer-actions'>
                        <button className='btn-cancel' onClick={onClose}>
                            Cancel
                        </button>
                        <button className='btn-save' onClick={handleSave}>
                            Save &amp; Apply Changes
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};
