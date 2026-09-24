import React from 'react';
import { TransactionCardData } from '../types';
import { ArrowDown, ArrowUp, CheckCircle, Clock, XCircle } from 'lucide-react';

interface TransactionCardProps {
    card: TransactionCardData;
}

export const TransactionCard: React.FC<TransactionCardProps> = ({ card }) => {
    const isWon = card.status === 'WON';
    const isLost = card.status === 'LOST';
    const isOpen = card.status === 'OPEN';
    const isRise = card.direction === 'RISE';

    const profit = card.profit || 0;
    const formattedProfit =
        profit > 0 ? `+$${profit.toFixed(2)}` : profit < 0 ? `-$${Math.abs(profit).toFixed(2)}` : '$0.00';

    return (
        <div className={`rf-tx-card rf-tx-card--${card.status.toLowerCase()}`}>
            {/* Header */}
            <div className='rf-tx-card__header'>
                <div className='rf-tx-card__title-group'>
                    <span
                        className={`rf-tx-card__direction-tag ${
                            isRise ? 'rf-tx-card__direction-tag--rise' : 'rf-tx-card__direction-tag--fall'
                        }`}
                    >
                        {isRise ? <ArrowUp size={13} /> : <ArrowDown size={13} />}
                        {card.direction}
                    </span>
                    <span className='rf-tx-card__market'>{card.marketDisplayName}</span>
                </div>

                <div className='rf-tx-card__status-badge'>
                    {isOpen && (
                        <span className='rf-badge rf-badge--tx-open'>
                            <Clock size={12} className='animate-spin' /> TRADE OPEN
                        </span>
                    )}
                    {isWon && (
                        <span className='rf-badge rf-badge--tx-won'>
                            <CheckCircle size={12} /> {card.direction} WON
                        </span>
                    )}
                    {isLost && (
                        <span className='rf-badge rf-badge--tx-lost'>
                            <XCircle size={12} /> {card.direction} LOST
                        </span>
                    )}
                </div>
            </div>

            {/* Contract & Execution Meta */}
            <div className='rf-tx-card__meta-bar'>
                <span>ID: <b>{card.contractId || card.transactionId || card.id}</b></span>
                <span>Time: {new Date(card.entryTime * 1000).toLocaleTimeString()}</span>
                <span>
                    Stake: <b>${card.stake.toFixed(2)}</b> ({card.duration}{card.durationUnit})
                </span>
            </div>

            {/* Entry vs Exit Matrix */}
            <div className='rf-tx-card__price-grid'>
                <div className='rf-price-box'>
                    <div className='rf-price-box__label'>ENTRY SPOT</div>
                    <div className='rf-price-box__val'>{card.entryPrice > 0 ? card.entryPrice.toFixed(2) : '---'}</div>
                </div>

                <div className='rf-price-box'>
                    <div className='rf-price-box__label'>EXIT SPOT</div>
                    <div className='rf-price-box__val'>
                        {card.exitPrice && card.exitPrice > 0 ? card.exitPrice.toFixed(2) : isOpen ? 'Live...' : '---'}
                    </div>
                </div>

                <div className='rf-price-box'>
                    <div className='rf-price-box__label'>PROFIT / LOSS</div>
                    <div
                        className={`rf-price-box__val font-bold ${
                            isWon ? 'rf-text-bullish' : isLost ? 'rf-text-bearish' : 'rf-text-neutral'
                        }`}
                    >
                        {isOpen ? 'In Progress...' : formattedProfit}
                    </div>
                </div>
            </div>

            {/* Entry Analysis Snapshot Accordion/Block */}
            <div className='rf-tx-card__analysis-snapshot'>
                <div className='rf-snapshot-title'>ANALYSIS AT ENTRY:</div>
                <div className='rf-snapshot-tags'>
                    <span className='rf-tag'>30M: {card.analysisSnapshot.trend30m}</span>
                    <span className='rf-tag'>15M: {card.analysisSnapshot.confirm15m}</span>
                    <span className='rf-tag'>5M: {card.analysisSnapshot.confirm5m}</span>
                    <span className='rf-tag'>Donchian: {card.analysisSnapshot.donchianState.replace(/_/g, ' ')}</span>
                    <span className='rf-tag'>CCI: {card.analysisSnapshot.cciState.replace(/_/g, ' ')}</span>
                    <span className='rf-tag'>MACD: {card.analysisSnapshot.macdState.replace(/_/g, ' ')}</span>
                    <span className='rf-tag'>Pattern: {card.analysisSnapshot.candlestickPattern}</span>
                    <span className='rf-tag'>Activity: {card.analysisSnapshot.marketActivity}</span>
                </div>
            </div>
        </div>
    );
};
