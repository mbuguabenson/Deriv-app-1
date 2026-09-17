import React, { useEffect, useState } from 'react';
import {
    aiGlobalAutoTraderService,
    GlobalAiConfig,
    GlobalAiState,
} from '@/services/ai-global-autotrader.service';
import { AiLearningHubModal } from '@/components/ai-learning-hub/ai-learning-hub-modal';
import { GlobalAiSettingsModal } from './global-ai-settings-modal';
import {
    Activity,
    Brain,
    Flame,
    Pause,
    Play,
    Settings,
    Shield,
    Sparkles,
    TrendingDown,
    TrendingUp,
    Zap,
} from 'lucide-react';
import './global-ai-hud.scss';

export const GlobalAiHud: React.FC = () => {
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
        lastActionMessage: 'AI Engine initialized and ready.',
        aiThoughts: [],
    }));

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

    const [isSettingsOpen, setIsSettingsOpen] = useState(false);
    const [isNeuralHubOpen, setIsNeuralHubOpen] = useState(false);
    const [isExpanded, setIsExpanded] = useState(false);

    useEffect(() => {
        const unsub = aiGlobalAutoTraderService.subscribe((s, c) => {
            setState(s);
            setConfig(c);
        });
        return () => unsub();
    }, []);

    const toggleRun = () => {
        if (state.isRunning) {
            aiGlobalAutoTraderService.pause();
        } else {
            aiGlobalAutoTraderService.start();
        }
    };

    const isProfitable = state.totalProfit >= 0;
    const trend = state.activeTrend?.trend || 'RANGING';
    const isBullish = trend.includes('BULLISH');
    const isBearish = trend.includes('BEARISH');

    return (
        <>
            <div className={`global-ai-hud ${state.isRunning ? 'is-active' : ''} ${state.status === 'EXECUTING' ? 'is-trading' : ''}`}>
                {/* 1. AI Crest & Status Badge */}
                <div className='hud-col hud-crest-col' onClick={() => setIsNeuralHubOpen(true)} title='Open 24/7 AI Neural Hub'>
                    <div className={`ai-crest-orb ${state.isRunning ? 'pulsing' : ''}`}>
                        <Brain size={16} className='brain-icon' />
                    </div>
                    <div className='ai-status-meta'>
                        <div className='status-row'>
                            <span className='ai-label'>SITE-WIDE AI</span>
                            <span className={`status-pill status-pill--${state.status.toLowerCase()}`}>
                                {state.status === 'IDLE' && 'IDLE'}
                                {state.status === 'SCANNING' && 'SCANNING'}
                                {state.status === 'WAITING_TRIGGER' && 'TRIGGER READY'}
                                {state.status === 'EXECUTING' && 'EXECUTING'}
                                {state.status === 'PAUSED' && 'PAUSED'}
                            </span>
                        </div>
                        <span className='sub-mode'>
                            {config.mode === 'autonomous_trading' ? 'Auto-Trading' : 'Signals Advisory'}
                        </span>
                    </div>
                </div>

                {/* 2. Active Market & Trend Pill */}
                <div className='hud-col hud-market-col' onClick={() => setIsSettingsOpen(true)} title='Active Market & Trend Telemetry'>
                    <div className='market-chip'>
                        <span className='m-name'>{state.activeMarketLabel}</span>
                        <span className={`trend-chip ${isBullish ? 'bullish' : isBearish ? 'bearish' : 'neutral'}`}>
                            {isBullish ? <TrendingUp size={12} /> : isBearish ? <TrendingDown size={12} /> : <Activity size={12} />}
                            {state.activeTrend ? `${state.activeTrend.slopePct > 0 ? '+' : ''}${state.activeTrend.slopePct}%` : 'Trend'}
                        </span>
                    </div>
                </div>

                {/* 3. Recognized Pattern Chip */}
                {state.activePattern && (
                    <div className='hud-col hud-pattern-col' onClick={() => setIsSettingsOpen(true)}>
                        <div className='pattern-chip'>
                            <Sparkles size={12} className='text-amber' />
                            <span className='p-text'>{state.activePattern.description.slice(0, 36)}...</span>
                            <span className='p-conf'>{state.activePattern.confidence}%</span>
                        </div>
                    </div>
                )}

                {/* 4. Live P&L and Win Rate */}
                <div className='hud-col hud-pnl-col'>
                    <div className='pnl-block'>
                        <span className='label'>AI NET P&amp;L</span>
                        <span className={`val ${isProfitable ? 'val--pos' : 'val--neg'}`}>
                            {isProfitable ? '+' : ''}${state.totalProfit.toFixed(2)}
                        </span>
                    </div>
                    <div className='pnl-block mini'>
                        <span className='label'>WIN RATE</span>
                        <span className='val'>{state.winRate}% ({state.wins}W / {state.losses}L)</span>
                    </div>
                </div>

                {/* 5. Quick Controls */}
                <div className='hud-col hud-actions-col'>
                    <button
                        className={`btn-toggle-ai ${state.isRunning ? 'btn-pause' : 'btn-start'}`}
                        onClick={toggleRun}
                        title={state.isRunning ? 'Pause Site-Wide AI Trading' : 'Start Site-Wide Autonomous AI Trading'}
                    >
                        {state.isRunning ? <Pause size={14} /> : <Play size={14} />}
                        <span>{state.isRunning ? 'PAUSE' : 'START AI'}</span>
                    </button>

                    <button
                        className='btn-icon'
                        onClick={() => setIsSettingsOpen(true)}
                        title='Configure AI Strategies, Stakes & Risk'
                    >
                        <Settings size={15} />
                    </button>
                </div>
            </div>

            {/* Modals */}
            <GlobalAiSettingsModal isOpen={isSettingsOpen} onClose={() => setIsSettingsOpen(false)} />
            <AiLearningHubModal isOpen={isNeuralHubOpen} onClose={() => setIsNeuralHubOpen(false)} />
        </>
    );
};
