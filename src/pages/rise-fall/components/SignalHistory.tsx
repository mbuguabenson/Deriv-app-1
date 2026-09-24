import React from 'react';
import { SignalHistoryItem } from '../types';
import { History } from 'lucide-react';

interface SignalHistoryProps {
    history: SignalHistoryItem[];
    onClear?: () => void;
}

export const SignalHistory: React.FC<SignalHistoryProps> = ({ history, onClear }) => {
    return (
        <div className='rf-card rf-history-card'>
            <div className='rf-card__header'>
                <div className='rf-card__title'>
                    <History size={16} />
                    <span>Signal & Evaluation Log</span>
                </div>
                {onClear && history.length > 0 && (
                    <button className='rf-btn-link text-xs' onClick={onClear}>
                        Clear History
                    </button>
                )}
            </div>

            <div className='rf-history-table-container'>
                {history.length === 0 ? (
                    <div className='rf-history-empty'>No signals evaluated in this session yet.</div>
                ) : (
                    <table className='rf-history-table'>
                        <thead>
                            <tr>
                                <th>TIME</th>
                                <th>MARKET</th>
                                <th>DIRECTION</th>
                                <th>TYPE</th>
                                <th>CONFIDENCE</th>
                                <th>EXECUTED</th>
                                <th>OUTCOME</th>
                            </tr>
                        </thead>
                        <tbody>
                            {history.map(item => (
                                <tr key={item.id}>
                                    <td className='font-mono text-xs'>{item.timeString}</td>
                                    <td className='font-semibold'>{item.market}</td>
                                    <td>
                                        <span
                                            className={`rf-badge ${
                                                item.direction === 'RISE'
                                                    ? 'rf-badge--rise'
                                                    : item.direction === 'FALL'
                                                    ? 'rf-badge--fall'
                                                    : 'rf-badge--neutral'
                                            }`}
                                        >
                                            {item.direction}
                                        </span>
                                    </td>
                                    <td className='text-xs text-muted'>{item.signalType}</td>
                                    <td className='font-mono font-bold'>{item.confidence}%</td>
                                    <td>
                                        <span
                                            className={`rf-tag ${
                                                item.executed ? 'rf-tag--executed' : 'rf-tag--skipped'
                                            }`}
                                        >
                                            {item.executed ? 'EXECUTED' : 'NOT EXECUTED'}
                                        </span>
                                    </td>
                                    <td>
                                        {item.result === 'WON' && <span className='rf-text-bullish font-bold'>WON</span>}
                                        {item.result === 'LOST' && <span className='rf-text-bearish font-bold'>LOST</span>}
                                        {item.result === 'SKIPPED' && <span className='text-muted'>SKIPPED</span>}
                                        {!item.result && <span className='text-muted'>---</span>}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
            </div>
        </div>
    );
};
