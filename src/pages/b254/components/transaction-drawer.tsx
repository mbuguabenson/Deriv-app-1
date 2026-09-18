import React, { useState } from 'react';
import { B254TransactionRecord } from '../types/b254.types';
import { ChevronDown, ChevronUp, FileText, History, X, Zap } from 'lucide-react';

interface TransactionDrawerProps {
    isOpen: boolean;
    onClose: () => void;
    transactions: B254TransactionRecord[];
    currency: string;
}

export const TransactionDrawer: React.FC<TransactionDrawerProps> = ({
    isOpen,
    onClose,
    transactions,
    currency,
}) => {
    const [expandedTxId, setExpandedTxId] = useState<string | null>(null);

    if (!isOpen) return null;

    const toggleExpand = (id: string) => {
        setExpandedTxId(prev => (prev === id ? null : id));
    };

    const totalWins = transactions.filter(t => t.result === 'WIN').length;
    const totalLosses = transactions.filter(t => t.result === 'LOSS').length;
    const netProfit = transactions.reduce((acc, t) => acc + (t.result === 'WIN' ? t.profit : t.result === 'LOSS' ? t.profit : 0), 0);

    return (
        <div className='b254-drawer-backdrop' onClick={onClose}>
            <div className='b254-glass b254-transaction-drawer' onClick={e => e.stopPropagation()}>
                {/* Header */}
                <div className='b254-drawer-header'>
                    <div className='title-wrap'>
                        <History size={20} className='text-cyan' />
                        <div>
                            <h3>Real Trade Ledger &amp; Condition Audits</h3>
                            <span className='subtitle'>{transactions.length} Verified Transactions</span>
                        </div>
                    </div>

                    <button className='b254-btn-close' onClick={onClose}>
                        <X size={18} />
                    </button>
                </div>

                {/* Ledger Summary Stats Ribbon */}
                <div className='b254-drawer-stats-ribbon'>
                    <div className='stat-col'>
                        <span className='lbl'>Total Trades:</span>
                        <strong>{transactions.length}</strong>
                    </div>
                    <div className='stat-col'>
                        <span className='lbl'>Win Rate:</span>
                        <strong className='text-green'>
                            {transactions.length > 0 ? `${Math.round((totalWins / transactions.length) * 100)}%` : '0%'}
                        </strong>
                    </div>
                    <div className='stat-col'>
                        <span className='lbl'>Wins / Losses:</span>
                        <strong>{totalWins}W / {totalLosses}L</strong>
                    </div>
                    <div className='stat-col'>
                        <span className='lbl'>Net P/L:</span>
                        <strong className={netProfit >= 0 ? 'text-green' : 'text-red'}>
                            {netProfit >= 0 ? '+' : ''}${netProfit.toFixed(2)} {currency}
                        </strong>
                    </div>
                </div>

                {/* Transaction List */}
                <div className='b254-drawer-content'>
                    {transactions.length === 0 ? (
                        <div className='empty-state'>
                            <FileText size={32} className='text-muted' />
                            <span>No trades executed yet in this session.</span>
                        </div>
                    ) : (
                        <div className='transaction-items-list'>
                            {transactions.map(tx => {
                                const isWin = tx.result === 'WIN';
                                const isExpanded = expandedTxId === tx.id;
                                const audit = tx.auditSnapshot;

                                return (
                                    <div key={tx.id} className={`transaction-card ${tx.result.toLowerCase()}`}>
                                        <div className='card-main-row' onClick={() => toggleExpand(tx.id)}>
                                            <div className='tx-left'>
                                                <div className={`tx-result-badge ${isWin ? 'win' : 'loss'}`}>
                                                    {tx.result}
                                                </div>
                                                <div className='tx-meta'>
                                                    <strong>{tx.market} &bull; {tx.direction.replace('_', ' ')} (Target {tx.prediction})</strong>
                                                    <span className='tx-time'>{tx.timeFormatted} &bull; Entry Digit: [{tx.entryDigit}] &bull; Score: {tx.signalScore}/100</span>
                                                </div>
                                            </div>

                                            <div className='tx-right'>
                                                <div className='stake-box'>
                                                    <span className='lbl'>Stake:</span>
                                                    <span>${tx.stake.toFixed(2)}</span>
                                                </div>
                                                <div className='profit-box'>
                                                    <strong className={isWin ? 'text-green' : 'text-red'}>
                                                        {isWin ? '+' : ''}${tx.profit.toFixed(2)} {currency}
                                                    </strong>
                                                </div>
                                                <button className='expand-btn'>
                                                    {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                                                </button>
                                            </div>
                                        </div>

                                        {/* Expanded Trade Audit Snapshot */}
                                        {isExpanded && audit && (
                                            <div className='b254-trade-audit-snapshot'>
                                                <div className='snapshot-title'>
                                                    <Zap size={14} className='text-amber' />
                                                    <span>Verified Trade Entry Conditions Snapshot</span>
                                                </div>

                                                <div className='audit-grid'>
                                                    <div className='audit-cell'>
                                                        <span className='lbl'>Under 0-4 %:</span>
                                                        <strong>{audit.under04Pct.toFixed(1)}%</strong>
                                                    </div>
                                                    <div className='audit-cell'>
                                                        <span className='lbl'>50t Dominance:</span>
                                                        <strong>{audit.under05Count}U vs {audit.over49Count}O</strong>
                                                    </div>
                                                    <div className='audit-cell'>
                                                        <span className='lbl'>Last 10 Ratio:</span>
                                                        <strong>{audit.last10Ratio}</strong>
                                                    </div>
                                                    <div className='audit-cell'>
                                                        <span className='lbl'>Last 7 Ratio:</span>
                                                        <strong>{audit.last7Ratio}</strong>
                                                    </div>
                                                    <div className='audit-cell'>
                                                        <span className='lbl'>Outlier %:</span>
                                                        <strong>{audit.outlierPct.toFixed(1)}%</strong>
                                                    </div>
                                                    <div className='audit-cell'>
                                                        <span className='lbl'>30-Min History:</span>
                                                        <strong>{audit.history30mBias}</strong>
                                                    </div>
                                                    <div className='audit-cell'>
                                                        <span className='lbl'>1-Hour History:</span>
                                                        <strong>{audit.history1hBias}</strong>
                                                    </div>
                                                    <div className='audit-cell'>
                                                        <span className='lbl'>Regime:</span>
                                                        <strong>{audit.regime}</strong>
                                                    </div>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};
