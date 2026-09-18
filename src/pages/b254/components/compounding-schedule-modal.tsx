import React from 'react';
import { CompoundingConfig, CompoundingProgress } from '../types/b254.types';
import { Award, CheckCircle2, X } from 'lucide-react';

interface CompoundingScheduleModalProps {
    isOpen: boolean;
    onClose: () => void;
    config: CompoundingConfig;
    progress: CompoundingProgress;
    currency: string;
}

export const CompoundingScheduleModal: React.FC<CompoundingScheduleModalProps> = ({
    isOpen,
    onClose,
    config,
    progress,
    currency,
}) => {
    if (!isOpen) return null;

    return (
        <div className='b254-modal-backdrop' onClick={onClose}>
            <div className='b254-glass b254-schedule-modal' onClick={e => e.stopPropagation()}>
                <div className='b254-modal-header'>
                    <div className='title-wrap'>
                        <Award size={22} className='text-gold' />
                        <div>
                            <h3>{config.days}-Day Account Compounding Schedule</h3>
                            <span className='subtitle'>
                                ${config.startBalance.toFixed(2)} &rarr; ${config.targetBalance.toFixed(2)} &bull; Required Daily Growth: <strong>+{progress.requiredDailyGrowthPct}%</strong>
                            </span>
                        </div>
                    </div>

                    <button className='b254-btn-close' onClick={onClose}>
                        <X size={18} />
                    </button>
                </div>

                <div className='b254-modal-body'>
                    {/* Goal Metric Highlight Row */}
                    <div className='schedule-meta-ribbon'>
                        <div className='meta-item'>
                            <span className='lbl'>Start Balance:</span>
                            <strong>${config.startBalance.toFixed(2)}</strong>
                        </div>
                        <div className='meta-item'>
                            <span className='lbl'>Target End Balance:</span>
                            <strong className='text-amber'>${config.targetBalance.toFixed(2)}</strong>
                        </div>
                        <div className='meta-item'>
                            <span className='lbl'>Current Day:</span>
                            <strong className='text-cyan'>Day {progress.currentTradingDay} / {config.days}</strong>
                        </div>
                        <div className='meta-item'>
                            <span className='lbl'>Total Target Profit:</span>
                            <strong className='text-green'>+${(config.targetBalance - config.startBalance).toFixed(2)}</strong>
                        </div>
                    </div>

                    {/* Table */}
                    <div className='schedule-table-wrapper'>
                        <table className='schedule-table'>
                            <thead>
                                <tr>
                                    <th>Day</th>
                                    <th>Start Balance</th>
                                    <th>Daily Target Profit</th>
                                    <th>Target End Balance</th>
                                    <th>Status</th>
                                </tr>
                            </thead>
                            <tbody>
                                {progress.schedule.map(item => {
                                    const isCurrent = item.day === progress.currentTradingDay;
                                    return (
                                        <tr key={item.day} className={`${item.isCompleted ? 'completed' : ''} ${isCurrent ? 'current-day' : ''}`}>
                                            <td>
                                                <div className='day-cell'>
                                                    <span>Day {item.day}</span>
                                                    {isCurrent && <span className='current-tag'>ACTIVE</span>}
                                                </div>
                                            </td>
                                            <td>${item.startBal.toFixed(2)}</td>
                                            <td className='text-green'>+${item.targetProfit.toFixed(2)} (+{progress.requiredDailyGrowthPct}%)</td>
                                            <td><strong>${item.endBal.toFixed(2)}</strong></td>
                                            <td>
                                                {item.isCompleted ? (
                                                    <span className='status-tag done'>
                                                        <CheckCircle2 size={13} /> Completed
                                                    </span>
                                                ) : isCurrent ? (
                                                    <span className='status-tag active'>In Progress</span>
                                                ) : (
                                                    <span className='status-tag pending'>Pending</span>
                                                )}
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        </div>
    );
};
