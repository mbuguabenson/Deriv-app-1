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

    const durationValue = config.durationValue || config.days || 30;
    const unitLabel = progress.unitLabel || (config.timeUnit === 'HOURS' ? 'Hours' : config.timeUnit === 'MINUTES' ? 'Minutes' : 'Days');
    const singleUnit = unitLabel.endsWith('s') ? unitLabel.slice(0, -1) : unitLabel;
    const growthRate = progress.requiredStepGrowthPct || progress.requiredDailyGrowthPct;

    return (
        <div className='b254-modal-backdrop' onClick={onClose}>
            <div className='b254-glass b254-schedule-modal' onClick={e => e.stopPropagation()}>
                <div className='b254-modal-header'>
                    <div className='title-wrap'>
                        <Award size={22} className='text-gold' />
                        <div>
                            <h3>{config.challengeName || `${durationValue}-${unitLabel} Compounding Schedule`}</h3>
                            <span className='subtitle'>
                                ${config.startBalance.toFixed(2)} &rarr; ${config.targetBalance.toFixed(2)} &bull; Required Growth: <strong>+{growthRate}% / {singleUnit}</strong>
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
                            <span className='lbl'>Start Seed:</span>
                            <strong>${config.startBalance.toFixed(2)} {currency}</strong>
                        </div>
                        <div className='meta-item'>
                            <span className='lbl'>Target End Balance:</span>
                            <strong className='text-amber'>${config.targetBalance.toFixed(2)} {currency}</strong>
                        </div>
                        <div className='meta-item'>
                            <span className='lbl'>Current Step:</span>
                            <strong className='text-cyan'>{singleUnit} {progress.currentStep || progress.currentTradingDay} / {progress.totalSteps || durationValue}</strong>
                        </div>
                        <div className='meta-item'>
                            <span className='lbl'>Total Target Profit:</span>
                            <strong className='text-green'>+${(config.targetBalance - config.startBalance).toFixed(2)} {currency}</strong>
                        </div>
                    </div>

                    {/* Table */}
                    <div className='schedule-table-wrapper'>
                        <table className='schedule-table'>
                            <thead>
                                <tr>
                                    <th>{singleUnit}</th>
                                    <th>Start Balance ({currency})</th>
                                    <th>Target Profit ({currency})</th>
                                    <th>Target End Balance ({currency})</th>
                                    <th>Status</th>
                                </tr>
                            </thead>
                            <tbody>
                                {progress.schedule.map(item => {
                                    const stepNum = item.stepNumber || item.day;
                                    const currentNum = progress.currentStep || progress.currentTradingDay;
                                    const isCurrent = stepNum === currentNum;
                                    const label = item.stepLabel || `${singleUnit} ${stepNum}`;

                                    return (
                                        <tr key={stepNum} className={`${item.isCompleted ? 'completed' : ''} ${isCurrent ? 'current-day' : ''}`}>
                                            <td>
                                                <div className='day-cell'>
                                                    <span>{label}</span>
                                                    {isCurrent && <span className='current-tag'>ACTIVE</span>}
                                                </div>
                                            </td>
                                            <td>${item.startBal.toFixed(2)}</td>
                                            <td className='text-green'>+${item.targetProfit.toFixed(2)} (+{growthRate}%)</td>
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
