import React, { useState, useEffect, useMemo } from 'react';
import {
    aiContinuousLearningService,
    LiveLearningDiagnostics,
    QPatternWeight,
    SupportedBotName,
    BotLearningContribution,
} from '@/services/ai-continuous-learning.service';
import {
    Brain,
    Activity,
    Zap,
    Cpu,
    BookOpen,
    Layers,
    RotateCcw,
    ShieldCheck,
    CheckCircle2,
    X,
    Sparkles,
    Share2,
    TrendingUp,
    Target,
    Scale,
    Flame,
} from 'lucide-react';
import './ai-learning-hub-modal.scss';

interface AiLearningHubModalProps {
    isOpen: boolean;
    onClose: () => void;
}

export const AiLearningHubModal: React.FC<AiLearningHubModalProps> = ({ isOpen, onClose }) => {
    const [activeTab, setActiveTab] = useState<'matrix' | 'crossbot' | 'guide'>('matrix');
    const [diagnostics, setDiagnostics] = useState<LiveLearningDiagnostics>(
        aiContinuousLearningService.getDiagnostics()
    );
    const [qWeights, setQWeights] = useState<QPatternWeight[]>([]);
    const [markovMatrix, setMarkovMatrix] = useState<number[][]>(
        aiContinuousLearningService.getMarkovMatrix()
    );
    const [isMachineMode, setIsMachineMode] = useState(
        aiContinuousLearningService.isMachineModeActive()
    );
    const [hoveredCell, setHoveredCell] = useState<{ from: number; to: number; prob: number } | null>(null);

    // Subscribe to live learning engine updates
    useEffect(() => {
        if (!isOpen) return;

        const unsubscribe = aiContinuousLearningService.subscribe(diag => {
            setDiagnostics(diag);
            setMarkovMatrix(aiContinuousLearningService.getMarkovMatrix());
            setQWeights(aiContinuousLearningService.getQTableWeights());
            setIsMachineMode(aiContinuousLearningService.isMachineModeActive());
        });

        return () => {
            unsubscribe();
        };
    }, [isOpen]);

    const handleToggleMachineMode = async () => {
        const next = !isMachineMode;
        setIsMachineMode(next);
        await aiContinuousLearningService.setMachineMode(next);
    };

    const handleResetWeights = () => {
        if (window.confirm('Reset all learned Markov weights, Bot telemetry, and Q-scores back to baseline?')) {
            aiContinuousLearningService.resetLearnedWeights();
        }
    };

    const botContributions = diagnostics.botContributions || aiContinuousLearningService.getBotContributions();
    const parity = diagnostics.parityMatrix || { evenToEven: 50, evenToOdd: 50, oddToEven: 50, oddToOdd: 50 };

    if (!isOpen) return null;

    return (
        <div className='ai-learning-modal-overlay' onClick={onClose}>
            <div className='ai-learning-modal-card' onClick={e => e.stopPropagation()}>
                {/* ── Modal Header ── */}
                <div className='ai-learning-modal-header'>
                    <div className='title-group'>
                        <div className='icon-wrap'>
                            <Brain className='brain-icon' />
                        </div>
                        <div>
                            <div className='title-row'>
                                <h2>ProfitHub Neural Learning Lab</h2>
                                <span className='badge-ai-live'>
                                    <span className='pulse-dot' /> ONLINE MULTI-BOT LEARNING
                                </span>
                            </div>
                            <p className='subtitle'>
                                Continuous machine learning across Elite Pro, Overlord AI, Poverty Hunter, and Auto X E/O.
                            </p>
                        </div>
                    </div>

                    <div className='header-controls'>
                        {/* 24/7 Machine Mode Toggle */}
                        <div
                            className={`machine-mode-toggle ${isMachineMode ? 'active' : ''}`}
                            onClick={handleToggleMachineMode}
                            title={isMachineMode ? '24/7 Machine Mode Active (Screen WakeLock On)' : 'Enable 24/7 Machine Mode'}
                        >
                            <Zap className='zap-icon' />
                            <div className='toggle-labels'>
                                <span className='toggle-title'>24/7 Machine Mode</span>
                                <span className='toggle-status'>
                                    {isMachineMode ? '⚡ ACTIVE (No-Sleep)' : '○ Standby'}
                                </span>
                            </div>
                            <div className={`switch-indicator ${isMachineMode ? 'on' : 'off'}`} />
                        </div>

                        <button className='close-btn' onClick={onClose} aria-label='Close'>
                            <X size={20} />
                        </button>
                    </div>
                </div>

                {/* ── Navigation Tabs ── */}
                <div className='ai-learning-tabs'>
                    <button
                        className={`tab-btn ${activeTab === 'matrix' ? 'active' : ''}`}
                        onClick={() => setActiveTab('matrix')}
                    >
                        <Cpu size={16} />
                        <span>Live Neural Matrix &amp; Metrics</span>
                    </button>
                    <button
                        className={`tab-btn ${activeTab === 'crossbot' ? 'active' : ''}`}
                        onClick={() => setActiveTab('crossbot')}
                    >
                        <Share2 size={16} />
                        <span>Multi-Bot Neural Synergy (4 Bots)</span>
                    </button>
                    <button
                        className={`tab-btn ${activeTab === 'guide' ? 'active' : ''}`}
                        onClick={() => setActiveTab('guide')}
                    >
                        <BookOpen size={16} />
                        <span>How Does This Learn on Your Machine?</span>
                    </button>
                </div>

                {/* ── Tab 1: Live Neural Matrix & Metrics ── */}
                {activeTab === 'matrix' && (
                    <div className='ai-learning-tab-content'>
                        {/* 4 Diagnostics Metric Cards */}
                        <div className='diagnostics-grid'>
                            <div className='diag-card'>
                                <div className='diag-top'>
                                    <span className='diag-label'>TICKS INGESTED &amp; LEARNED</span>
                                    <Activity size={16} className='diag-icon text-cyan' />
                                </div>
                                <div className='diag-val'>{diagnostics.totalTicksIngested.toLocaleString()}</div>
                                <span className='diag-sub'>Epochs Completed: {diagnostics.learningEpochs}</span>
                            </div>

                            <div className='diag-card'>
                                <div className='diag-top'>
                                    <span className='diag-label'>MODEL STATISTICAL CONFIDENCE</span>
                                    <Sparkles size={16} className='diag-icon text-purple' />
                                </div>
                                <div className='diag-val text-purple'>{diagnostics.modelConfidence}%</div>
                                <span className='diag-sub'>Baseline Random Edge: 10%</span>
                            </div>

                            <div className='diag-card'>
                                <div className='diag-top'>
                                    <span className='diag-label'>SHANNON ENTROPY (RANDOMNESS)</span>
                                    <Layers size={16} className='diag-icon text-orange' />
                                </div>
                                <div className='diag-val text-orange'>{diagnostics.shannonEntropy}</div>
                                <span className='diag-sub'>Scale: 0 (Pure Pattern) to 3.32 (Pure Noise)</span>
                            </div>

                            <div className='diag-card'>
                                <div className='diag-top'>
                                    <span className='diag-label'>24/7 BACKGROUND KEEP-ALIVE</span>
                                    <ShieldCheck size={16} className='diag-icon text-emerald' />
                                </div>
                                <div className='diag-val text-emerald'>
                                    {isMachineMode ? 'ACTIVE' : 'STANDBY'}
                                </div>
                                <span className='diag-sub'>
                                    {diagnostics.wakeLockActive ? 'Screen Wake Lock Engaged' : 'Click Toggle to Enable'}
                                </span>
                            </div>
                        </div>

                        {/* Highlight Top Statistical Edge */}
                        <div className='top-edge-banner'>
                            <div className='banner-left'>
                                <span className='crown-pill'>🎯 HIGHEST LEARNED TRANSITION EDGE</span>
                                <h4>{diagnostics.topPatternEdge.pattern} ({diagnostics.topPatternEdge.edgePct}% Probability)</h4>
                                <p>{diagnostics.topPatternEdge.description}</p>
                            </div>
                            <div className='banner-badge'>
                                <span>+{diagnostics.topPatternEdge.edgePct - 10}% Edge</span>
                            </div>
                        </div>

                        {/* 10x10 Interactive Markov Transition Matrix */}
                        <div className='matrix-section'>
                            <div className='section-head'>
                                <div>
                                    <h3>10 &times; 10 Markov Digit Transition Probability Matrix</h3>
                                    <p className='section-desc'>
                                        Rows = Previous Digit (D<sub>t-1</sub>) &bull; Columns = Predicted Next Digit (D<sub>t</sub>). Colors highlight learned micro-anomalies.
                                    </p>
                                </div>
                                {hoveredCell && (
                                    <div className='hovered-cell-callout'>
                                        Digit {hoveredCell.from} &rarr; Digit {hoveredCell.to}:{' '}
                                        <strong>{(hoveredCell.prob * 100).toFixed(1)}% probability</strong>
                                    </div>
                                )}
                            </div>

                            <div className='matrix-table-wrap'>
                                <table className='markov-table'>
                                    <thead>
                                        <tr>
                                            <th className='th-corner'>From \ To</th>
                                            {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map(d => (
                                                <th key={d} className='th-col-digit'>
                                                    {d}
                                                </th>
                                            ))}
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {markovMatrix.map((row, fromDigit) => (
                                            <tr key={fromDigit}>
                                                <th className='th-row-digit'>{fromDigit}</th>
                                                {row.map((prob, toDigit) => {
                                                    const pct = prob * 100;
                                                    const intensity = Math.min(1, Math.max(0, (pct - 5) / 15));
                                                    return (
                                                        <td
                                                            key={toDigit}
                                                            className={`matrix-cell ${pct >= 14 ? 'high-edge' : ''}`}
                                                            style={{
                                                                backgroundColor: `rgba(139, 92, 246, ${0.1 + intensity * 0.7})`,
                                                                color: pct >= 14 ? '#38bdf8' : '#e2e8f0',
                                                            }}
                                                            onMouseEnter={() =>
                                                                setHoveredCell({ from: fromDigit, to: toDigit, prob })
                                                            }
                                                            onMouseLeave={() => setHoveredCell(null)}
                                                        >
                                                            {pct.toFixed(0)}%
                                                        </td>
                                                    );
                                                })}
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>

                        {/* Reinforcement Learning Q-Weights */}
                        {qWeights.length > 0 && (
                            <div className='q-weights-section'>
                                <h3>Reinforcement Learning Q-Scores (Pattern Value Function)</h3>
                                <p className='section-desc'>
                                    Patterns are automatically rewarded on profitable trades and penalized on losses via Q-Learning updates.
                                </p>
                                <div className='q-weights-list'>
                                    {qWeights.map(q => (
                                        <div key={q.patternKey} className='q-weight-item'>
                                            <div className='q-name-row'>
                                                <span className='q-key'>{q.patternKey}</span>
                                                <span className='q-winrate'>Win Rate: {q.winRate}% ({q.samples} samples)</span>
                                            </div>
                                            <div className='q-bar-track'>
                                                <div
                                                    className='q-bar-fill'
                                                    style={{ width: `${q.qValue * 100}%` }}
                                                />
                                            </div>
                                            <div className='q-score-row'>
                                                <span>Q-Score: {q.qValue.toFixed(3)}</span>
                                                <span className='q-status'>
                                                    {q.qValue >= 0.65 ? '🔥 High Edge' : q.qValue >= 0.5 ? '⚖️ Balanced' : '⚠️ Penalized'}
                                                </span>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        <div className='modal-footer-actions'>
                            <button className='btn-reset' onClick={handleResetWeights}>
                                <RotateCcw size={14} />
                                <span>Reset Learned Weights</span>
                            </button>
                            <button className='btn-done' onClick={onClose}>
                                Done
                            </button>
                        </div>
                    </div>
                )}

                {/* ── Tab 2: Multi-Bot Neural Synergy (4 Core Bots) ── */}
                {activeTab === 'crossbot' && (
                    <div className='ai-learning-tab-content crossbot-content'>
                        <div className='synergy-hero'>
                            <h3>Unified Cross-Bot Neural Training</h3>
                            <p>
                                The AI does not learn in isolation. Every tick and trade executed across <strong>Elite Pro</strong>, <strong>Overlord AI</strong>, <strong>Poverty Hunter</strong>, and <strong>Auto X Even/Odd</strong> trains a unified multi-layer state space.
                            </p>
                        </div>

                        {/* 4 Flagship Bot Cards */}
                        <div className='bots-synergy-grid'>
                            {/* 1. Elite Pro */}
                            <div className='bot-synergy-card elite'>
                                <div className='card-head'>
                                    <div className='bot-badge'>
                                        <TrendingUp size={16} />
                                        <span>ELITE PRO</span>
                                    </div>
                                    <span className='q-score-badge'>Q: {botContributions.ELITE_PRO.learnedQScore.toFixed(2)}</span>
                                </div>
                                <h4>{botContributions.ELITE_PRO.displayName}</h4>
                                <span className='domain-tag'>{botContributions.ELITE_PRO.primaryLearningDomain}</span>
                                <div className='bot-stats-row'>
                                    <div>
                                        <label>Trades</label>
                                        <strong>{botContributions.ELITE_PRO.totalTrades}</strong>
                                    </div>
                                    <div>
                                        <label>Win Rate</label>
                                        <strong className='text-emerald'>{botContributions.ELITE_PRO.winRate}%</strong>
                                    </div>
                                    <div>
                                        <label>Net P/L</label>
                                        <strong className={botContributions.ELITE_PRO.netProfit >= 0 ? 'text-emerald' : 'text-rose'}>
                                            {botContributions.ELITE_PRO.netProfit >= 0 ? '+' : ''}{botContributions.ELITE_PRO.netProfit.toFixed(2)}
                                        </strong>
                                    </div>
                                </div>
                            </div>

                            {/* 2. Overlord AI */}
                            <div className='bot-synergy-card overlord'>
                                <div className='card-head'>
                                    <div className='bot-badge'>
                                        <Flame size={16} />
                                        <span>OVERLORD AI</span>
                                    </div>
                                    <span className='q-score-badge'>Q: {botContributions.OVERLORD_AI.learnedQScore.toFixed(2)}</span>
                                </div>
                                <h4>{botContributions.OVERLORD_AI.displayName}</h4>
                                <span className='domain-tag'>{botContributions.OVERLORD_AI.primaryLearningDomain}</span>
                                <div className='bot-stats-row'>
                                    <div>
                                        <label>Trades</label>
                                        <strong>{botContributions.OVERLORD_AI.totalTrades}</strong>
                                    </div>
                                    <div>
                                        <label>Win Rate</label>
                                        <strong className='text-emerald'>{botContributions.OVERLORD_AI.winRate}%</strong>
                                    </div>
                                    <div>
                                        <label>Net P/L</label>
                                        <strong className={botContributions.OVERLORD_AI.netProfit >= 0 ? 'text-emerald' : 'text-rose'}>
                                            {botContributions.OVERLORD_AI.netProfit >= 0 ? '+' : ''}{botContributions.OVERLORD_AI.netProfit.toFixed(2)}
                                        </strong>
                                    </div>
                                </div>
                            </div>

                            {/* 3. Poverty Hunter */}
                            <div className='bot-synergy-card poverty'>
                                <div className='card-head'>
                                    <div className='bot-badge'>
                                        <Target size={16} />
                                        <span>POVERTY HUNTER</span>
                                    </div>
                                    <span className='q-score-badge'>Q: {botContributions.POVERTY_HUNTER.learnedQScore.toFixed(2)}</span>
                                </div>
                                <h4>{botContributions.POVERTY_HUNTER.displayName}</h4>
                                <span className='domain-tag'>{botContributions.POVERTY_HUNTER.primaryLearningDomain}</span>
                                <div className='bot-stats-row'>
                                    <div>
                                        <label>Trades</label>
                                        <strong>{botContributions.POVERTY_HUNTER.totalTrades}</strong>
                                    </div>
                                    <div>
                                        <label>Win Rate</label>
                                        <strong className='text-emerald'>{botContributions.POVERTY_HUNTER.winRate}%</strong>
                                    </div>
                                    <div>
                                        <label>Net P/L</label>
                                        <strong className={botContributions.POVERTY_HUNTER.netProfit >= 0 ? 'text-emerald' : 'text-rose'}>
                                            {botContributions.POVERTY_HUNTER.netProfit >= 0 ? '+' : ''}{botContributions.POVERTY_HUNTER.netProfit.toFixed(2)}
                                        </strong>
                                    </div>
                                </div>
                            </div>

                            {/* 4. Auto X E/O */}
                            <div className='bot-synergy-card autoeo'>
                                <div className='card-head'>
                                    <div className='bot-badge'>
                                        <Scale size={16} />
                                        <span>AUTO X E/O</span>
                                    </div>
                                    <span className='q-score-badge'>Q: {(botContributions?.AUTO_EO?.learnedQScore ?? 0.64).toFixed(2)}</span>
                                </div>
                                <h4>{botContributions?.AUTO_EO?.displayName || 'Auto X Even/Odd'}</h4>
                                <span className='domain-tag'>{botContributions?.AUTO_EO?.primaryLearningDomain || 'Parity Markov Transitions'}</span>
                                <div className='bot-stats-row'>
                                    <div>
                                        <label>Trades</label>
                                        <strong>{botContributions?.AUTO_EO?.totalTrades ?? 0}</strong>
                                    </div>
                                    <div>
                                        <label>Win Rate</label>
                                        <strong className='text-emerald'>{botContributions?.AUTO_EO?.winRate ?? 0}%</strong>
                                    </div>
                                    <div>
                                        <label>Net P/L</label>
                                        <strong className={(botContributions?.AUTO_EO?.netProfit ?? 0) >= 0 ? 'text-emerald' : 'text-rose'}>
                                            {(botContributions?.AUTO_EO?.netProfit ?? 0) >= 0 ? '+' : ''}{(botContributions?.AUTO_EO?.netProfit ?? 0).toFixed(2)}
                                        </strong>
                                    </div>
                                </div>
                            </div>

                            {/* 5. Autoflipper */}
                            <div className='bot-synergy-card autoflipper'>
                                <div className='card-head'>
                                    <div className='bot-badge'>
                                        <Sparkles size={16} />
                                        <span>AUTOFLIPPER</span>
                                    </div>
                                    <span className='q-score-badge'>Q: {(botContributions?.AUTOFLIPPER?.learnedQScore ?? 0.67).toFixed(2)}</span>
                                </div>
                                <h4>{botContributions?.AUTOFLIPPER?.displayName || 'Autoflipper Edge AI'}</h4>
                                <span className='domain-tag'>{botContributions?.AUTOFLIPPER?.primaryLearningDomain || 'Markov Auto-Switching Edge'}</span>
                                <div className='bot-stats-row'>
                                    <div>
                                        <label>Trades</label>
                                        <strong>{botContributions?.AUTOFLIPPER?.totalTrades ?? 0}</strong>
                                    </div>
                                    <div>
                                        <label>Win Rate</label>
                                        <strong className='text-emerald'>{botContributions?.AUTOFLIPPER?.winRate ?? 0}%</strong>
                                    </div>
                                    <div>
                                        <label>Net P/L</label>
                                        <strong className={(botContributions?.AUTOFLIPPER?.netProfit ?? 0) >= 0 ? 'text-emerald' : 'text-rose'}>
                                            {(botContributions?.AUTOFLIPPER?.netProfit ?? 0) >= 0 ? '+' : ''}{(botContributions?.AUTOFLIPPER?.netProfit ?? 0).toFixed(2)}
                                        </strong>
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Parity Transition Matrix & Cross-Domain Signals */}
                        <div className='parity-analysis-section'>
                            <div className='parity-card'>
                                <h4>Even/Odd Markov Parity Transition Matrix</h4>
                                <p>Used by <strong>Auto X E/O</strong> for conditional parity switching:</p>
                                <div className='parity-grid'>
                                    <div className='parity-cell'>
                                        <span className='cell-label'>Even &rarr; Even</span>
                                        <span className='cell-val'>{parity.evenToEven}%</span>
                                    </div>
                                    <div className='parity-cell'>
                                        <span className='cell-label'>Even &rarr; Odd</span>
                                        <span className='cell-val'>{parity.evenToOdd}%</span>
                                    </div>
                                    <div className='parity-cell'>
                                        <span className='cell-label'>Odd &rarr; Even</span>
                                        <span className='cell-val'>{parity.oddToEven}%</span>
                                    </div>
                                    <div className='parity-cell'>
                                        <span className='cell-label'>Odd &rarr; Odd</span>
                                        <span className='cell-val'>{parity.oddToOdd}%</span>
                                    </div>
                                </div>
                            </div>

                            <div className='synergy-details-card'>
                                <h4>Why Cross-Bot Training Outperforms Isolated Models:</h4>
                                <ul>
                                    <li>
                                        <strong>Differs Edge (Poverty Hunter):</strong> Uses the inverse minimum transition probability from the Markov matrix to pick the safest barrier digit.
                                    </li>
                                    <li>
                                        <strong>Parity Switching (Auto X E/O):</strong> Evaluates conditional state flips rather than simple trailing counts.
                                    </li>
                                    <li>
                                        <strong>Patient Triggering (Elite Pro):</strong> Only fires Over/Under trades when learned Markov cluster density confirms directional bias.
                                    </li>
                                    <li>
                                        <strong>Regime Filtering (Overlord AI):</strong> Re-weights all strategies dynamically according to live Shannon Entropy and Q-values.
                                    </li>
                                </ul>
                            </div>
                        </div>

                        <div className='modal-footer-actions'>
                            <button className='btn-done' onClick={onClose}>
                                Back to Trading
                            </button>
                        </div>
                    </div>
                )}

                {/* ── Tab 3: How Does This Learn? (Educational Breakdown) ── */}
                {activeTab === 'guide' && (
                    <div className='ai-learning-tab-content guide-content'>
                        <div className='guide-hero'>
                            <h3>How ProfitHub Continuously Learns Across All 4 Bots</h3>
                            <p>
                                When you leave this application open on your desktop or laptop with <strong>24/7 Machine Mode</strong> active, the engine engages in continuous, real-time online reinforcement learning across all markets and bot strategies.
                            </p>
                        </div>

                        <div className='steps-container'>
                            <div className='step-card'>
                                <div className='step-number'>1</div>
                                <div className='step-body'>
                                    <h4>24/7 Uninterrupted Tick Ingestion</h4>
                                    <p>
                                        The engine uses the modern <strong>Screen Wake Lock API</strong> and a dedicated Web Worker heartbeat. This prevents your operating system from putting the computer to sleep and stops browsers (Chrome, Edge, Firefox) from throttling background timers when the tab is inactive.
                                    </p>
                                </div>
                            </div>

                            <div className='step-card'>
                                <div className='step-number'>2</div>
                                <div className='step-body'>
                                    <h4>Dynamic Markov Chain State Transitions</h4>
                                    <p>
                                        Every tick from all 13+ synthetic markets is decoded. The engine updates a live $10 \times 10$ transition matrix $P(D_t \mid D_{t-1})$ and a $2 \times 2$ parity matrix in real-time to discover statistical non-uniformities.
                                    </p>
                                </div>
                            </div>

                            <div className='step-card'>
                                <div className='step-number'>3</div>
                                <div className='step-body'>
                                    <h4>Cross-Strategy Learning (Elite, Overlord, Poverty, Auto E/O)</h4>
                                    <p>
                                        Trades executed across all 4 flagship bots stream into a unified Q-learning state space. Winning strategies and barrier combinations are rewarded ($+Q$), while losing patterns receive negative weight adjustments.
                                    </p>
                                </div>
                            </div>

                            <div className='step-card'>
                                <div className='step-number'>4</div>
                                <div className='step-body'>
                                    <h4>Regime Decay Adaptation</h4>
                                    <p>
                                        Every 500 ticks, historical transitions are decayed by $\gamma = 0.95$. This allows the model to immediately adapt to changing market conditions without losing long-term statistical stability.
                                    </p>
                                </div>
                            </div>

                            <div className='step-card'>
                                <div className='step-number'>5</div>
                                <div className='step-body'>
                                    <h4>High-Conviction Patient Triggering</h4>
                                    <p>
                                        All bots utilize these learned statistical weights to ensure trades are never placed randomly. Entries only execute when the calculated mathematical edge satisfies strict confidence thresholds.
                                    </p>
                                </div>
                            </div>
                        </div>

                        <div className='best-practices-box'>
                            <h4>💡 Best Practices for 24/7 Machine Training:</h4>
                            <ul>
                                <li>
                                    <CheckCircle2 size={16} className='text-emerald' />
                                    <span><strong>Keep Machine Mode Enabled:</strong> Toggle the 24/7 Machine Mode switch on the top right so your computer remains awake.</span>
                                </li>
                                <li>
                                    <CheckCircle2 size={16} className='text-emerald' />
                                    <span><strong>Keep Power Connected:</strong> For laptops, keep AC power plugged in to prevent battery power-saver mode from throttling tick subscriptions.</span>
                                </li>
                                <li>
                                    <CheckCircle2 size={16} className='text-emerald' />
                                    <span><strong>Accumulate Ticks:</strong> Allow the engine to process at least 2,000–5,000 ticks across synthetic markets to build a robust statistical edge.</span>
                                </li>
                            </ul>
                        </div>

                        <div className='modal-footer-actions'>
                            <button className='btn-done' onClick={onClose}>
                                Back to Trading
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};
