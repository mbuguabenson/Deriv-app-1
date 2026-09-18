import React, { useMemo } from 'react';
import { Activity } from 'lucide-react';

interface LiveDigitChartProps {
    digits: number[];
    currentPrice: string;
    lastDigit: number;
    symbolLabel: string;
}

export const LiveDigitChart: React.FC<LiveDigitChartProps> = ({
    digits,
    currentPrice,
    lastDigit,
    symbolLabel,
}) => {
    const displayDigits = useMemo(() => digits.slice(-50), [digits]);
    const recent7 = useMemo(() => digits.slice(-7), [digits]);
    const recent10 = useMemo(() => digits.slice(-10), [digits]);

    // SVG Chart Geometry
    const width = 800;
    const height = 180;
    const paddingX = 25;
    const paddingY = 20;

    const points = useMemo(() => {
        if (displayDigits.length === 0) return [];
        const n = displayDigits.length;
        const stepX = n > 1 ? (width - 2 * paddingX) / (n - 1) : 0;
        return displayDigits.map((d, i) => {
            const x = paddingX + i * stepX;
            // Invert Y: 9 at top, 0 at bottom
            const y = height - paddingY - (d / 9) * (height - 2 * paddingY);
            return { x, y, d, i };
        });
    }, [displayDigits]);

    // Generate smooth Bezier curve SVG path
    const splinePath = useMemo(() => {
        if (points.length < 2) return '';
        let d = `M ${points[0].x} ${points[0].y}`;
        for (let i = 0; i < points.length - 1; i++) {
            const p0 = points[i === 0 ? 0 : i - 1];
            const p1 = points[i];
            const p2 = points[i + 1];
            const p3 = points[i + 2 < points.length ? i + 2 : i + 1];

            const cp1x = p1.x + (p2.x - p0.x) / 6;
            const cp1y = p1.y + (p2.y - p0.y) / 6;
            const cp2x = p2.x - (p3.x - p1.x) / 6;
            const cp2y = p2.y - (p3.y - p1.y) / 6;

            d += ` C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${p2.x} ${p2.y}`;
        }
        return d;
    }, [points]);

    // Barrier Y Coordinates
    const barrierOver3Y = height - paddingY - (3 / 9) * (height - 2 * paddingY);
    const barrierUnder6Y = height - paddingY - (6 / 9) * (height - 2 * paddingY);

    return (
        <section className='b254-glass b254-live-chart-container'>
            {/* Top Bar: Price and Last Digit Hero */}
            <div className='b254-chart-header'>
                <div className='title-box'>
                    <Activity size={18} className='text-cyan' />
                    <div>
                        <h3 className='title'>Live 50-Tick Digit Wave &bull; {symbolLabel}</h3>
                        <span className='subtitle'>Continuous Smooth Bezier Trajectory with Strategy Barriers</span>
                    </div>
                </div>

                <div className='live-hero-metrics'>
                    <div className='hero-item price'>
                        <span className='label'>CURRENT LIVE PRICE</span>
                        <div className='val-row'>
                            <strong className='val'>{currentPrice || '—'}</strong>
                            <span className='live-pulse-dot' />
                        </div>
                    </div>

                    <div className={`hero-item digit ${lastDigit <= 5 ? 'under' : 'over'}`}>
                        <span className='label'>LAST TICK DIGIT</span>
                        <div className='digit-orb-wrapper'>
                            <div className='digit-orb'>{lastDigit ?? '—'}</div>
                            <span className='zone-tag'>{lastDigit <= 5 ? 'Under Zone (0-5)' : 'Over Zone (6-9)'}</span>
                        </div>
                    </div>
                </div>
            </div>

            {/* SVG Chart Area */}
            <div className='b254-svg-wrapper'>
                <svg viewBox={`0 0 ${width} ${height}`} className='b254-spline-svg' preserveAspectRatio='none'>
                    <defs>
                        <linearGradient id='b254SplineGrad' x1='0' y1='0' x2='0' y2='1'>
                            <stop offset='0%' stopColor='#00F5FF' stopOpacity='0.4' />
                            <stop offset='100%' stopColor='#7000FF' stopOpacity='0.0' />
                        </linearGradient>
                        <linearGradient id='b254LineGrad' x1='0' y1='0' x2='1' y2='0'>
                            <stop offset='0%' stopColor='#00F5FF' />
                            <stop offset='50%' stopColor='#00E5FF' />
                            <stop offset='100%' stopColor='#00FF88' />
                        </linearGradient>
                    </defs>

                    {/* Horizontal Grid lines 0-9 */}
                    {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map(num => {
                        const y = height - paddingY - (num / 9) * (height - 2 * paddingY);
                        return (
                            <g key={num}>
                                <line
                                    x1={paddingX}
                                    y1={y}
                                    x2={width - paddingX}
                                    y2={y}
                                    stroke='rgba(255,255,255,0.06)'
                                    strokeWidth='1'
                                />
                                <text x={paddingX - 14} y={y + 3} fill='rgba(255,255,255,0.3)' fontSize='10' textAnchor='middle'>
                                    {num}
                                </text>
                            </g>
                        );
                    })}

                    {/* Level 3 Barrier (Over 3 Target Bound) */}
                    <line
                        x1={paddingX}
                        y1={barrierOver3Y}
                        x2={width - paddingX}
                        y2={barrierOver3Y}
                        stroke='#FF8800'
                        strokeWidth='1.5'
                        strokeDasharray='4 3'
                        opacity='0.7'
                    />
                    <text x={width - paddingX + 5} y={barrierOver3Y + 3} fill='#FF8800' fontSize='9' fontWeight='bold'>
                        OVER 3
                    </text>

                    {/* Level 6 Barrier (Under 6 Target Bound) */}
                    <line
                        x1={paddingX}
                        y1={barrierUnder6Y}
                        x2={width - paddingX}
                        y2={barrierUnder6Y}
                        stroke='#00FF88'
                        strokeWidth='1.5'
                        strokeDasharray='4 3'
                        opacity='0.7'
                    />
                    <text x={width - paddingX + 5} y={barrierUnder6Y + 3} fill='#00FF88' fontSize='9' fontWeight='bold'>
                        UNDER 6
                    </text>

                    {/* Spline Path */}
                    {splinePath && (
                        <path
                            d={splinePath}
                            fill='none'
                            stroke='url(#b254LineGrad)'
                            strokeWidth='2.5'
                            strokeLinecap='round'
                            strokeLinejoin='round'
                        />
                    )}

                    {/* Digit Point Circles */}
                    {points.map((pt, idx) => {
                        const isLast = idx === points.length - 1;
                        const isUnder = pt.d <= 5;
                        return (
                            <g key={idx}>
                                {isLast && (
                                    <circle
                                        cx={pt.x}
                                        cy={pt.y}
                                        r='9'
                                        fill='none'
                                        stroke={isUnder ? '#00FF88' : '#FF8800'}
                                        strokeWidth='1.5'
                                        className='b254-last-point-pulse'
                                    />
                                )}
                                <circle
                                    cx={pt.x}
                                    cy={pt.y}
                                    r={isLast ? '5' : '3'}
                                    fill={isUnder ? '#00FF88' : '#FF8800'}
                                    stroke='#080B11'
                                    strokeWidth='1'
                                />
                            </g>
                        );
                    })}
                </svg>
            </div>

            {/* Sequence Chips Strip */}
            <div className='b254-digit-sequences-row'>
                {/* Last 7 Ticks */}
                <div className='seq-group'>
                    <span className='seq-label'>LAST 7 TICKS:</span>
                    <div className='chips-row'>
                        {recent7.map((d, i) => (
                            <span key={i} className={`mini-digit-chip ${d <= 5 ? 'under' : 'over'}`}>
                                {d}
                            </span>
                        ))}
                    </div>
                </div>

                {/* Last 10 Ticks */}
                <div className='seq-group'>
                    <span className='seq-label'>LAST 10 TICKS:</span>
                    <div className='chips-row'>
                        {recent10.map((d, i) => (
                            <span key={i} className={`mini-digit-chip ${d <= 5 ? 'under' : 'over'}`}>
                                {d}
                            </span>
                        ))}
                    </div>
                </div>

                {/* Micro Ratio Summary */}
                <div className='seq-summary'>
                    <span>7t: <strong>{recent7.filter(d => d <= 5).length}U / {recent7.filter(d => d >= 4).length}O</strong></span>
                    <span className='divider'>|</span>
                    <span>10t: <strong>{recent10.filter(d => d <= 5).length}U / {recent10.filter(d => d >= 4).length}O</strong></span>
                </div>
            </div>
        </section>
    );
};
