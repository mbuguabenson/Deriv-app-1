import { observer } from 'mobx-react-lite';
import { getSiteConfig } from '@/utils/supabase-copy';
import { getBrandLabel } from '@/components/shared/utils/brand/brand';
import './app-logo.scss';

type TBrandLogoProps = {
    width?: number;
    height?: number;
    fill?: string;
    className?: string;
};

export const BrandLogo = observer(({ height = 36, className = '' }: TBrandLogoProps) => {
    const cfg = getSiteConfig();
    const customLogo = cfg?.logoBase64;
    const brandName = getBrandLabel() || 'Legacy Trading Hub';

    return (
        <div className={`lth-brand-logo ${className}`}>
            <div className='lth-brand-logo__row'>
                {customLogo ? (
                    <img
                        src={customLogo}
                        alt={brandName}
                        style={{ height: `${height}px`, width: 'auto', display: 'block', objectFit: 'contain' }}
                    />
                ) : (
                    <svg
                        xmlns='http://www.w3.org/2000/svg'
                        viewBox='0 0 120 120'
                        fill='none'
                        className='lth-brand-logo__icon'
                        style={{ height: `${height}px`, width: `${height}px` }}
                        aria-hidden='true'
                    >
                        <defs>
                            {/* Premium 3D Frosted Glass Tile Gradients */}
                            <linearGradient id='lth3dGlassBg' x1='0%' y1='0%' x2='100%' y2='100%'>
                                <stop offset='0%' stopColor='#1e293b' stopOpacity='0.95' />
                                <stop offset='60%' stopColor='#0f172a' stopOpacity='0.92' />
                                <stop offset='100%' stopColor='#020617' stopOpacity='0.98' />
                            </linearGradient>
                            <linearGradient id='lth3dGlassRim' x1='0%' y1='0%' x2='100%' y2='100%'>
                                <stop offset='0%' stopColor='#38bdf8' stopOpacity='0.9' />
                                <stop offset='30%' stopColor='#34d399' stopOpacity='0.8' />
                                <stop offset='70%' stopColor='#10b981' stopOpacity='0.7' />
                                <stop offset='100%' stopColor='#064e3b' stopOpacity='0.4' />
                            </linearGradient>
                            <linearGradient id='lth3dSheen' x1='0%' y1='0%' x2='100%' y2='100%'>
                                <stop offset='0%' stopColor='#ffffff' stopOpacity='0.3' />
                                <stop offset='25%' stopColor='#ffffff' stopOpacity='0.08' />
                                <stop offset='50%' stopColor='#ffffff' stopOpacity='0' />
                            </linearGradient>

                            {/* 3D Isometric Bar 1 Gradients */}
                            <linearGradient id='bar3dFront1' x1='0%' y1='0%' x2='0%' y2='100%'>
                                <stop offset='0%' stopColor='#0ea5e9' />
                                <stop offset='100%' stopColor='#0369a1' />
                            </linearGradient>
                            <linearGradient id='bar3dTop1' x1='0%' y1='0%' x2='100%' y2='100%'>
                                <stop offset='0%' stopColor='#7dd3fc' />
                                <stop offset='100%' stopColor='#38bdf8' />
                            </linearGradient>
                            <linearGradient id='bar3dSide1' x1='0%' y1='0%' x2='100%' y2='0%'>
                                <stop offset='0%' stopColor='#0284c7' />
                                <stop offset='100%' stopColor='#075985' />
                            </linearGradient>

                            {/* 3D Isometric Bar 2 Gradients */}
                            <linearGradient id='bar3dFront2' x1='0%' y1='0%' x2='0%' y2='100%'>
                                <stop offset='0%' stopColor='#10b981' />
                                <stop offset='100%' stopColor='#047857' />
                            </linearGradient>
                            <linearGradient id='bar3dTop2' x1='0%' y1='0%' x2='100%' y2='100%'>
                                <stop offset='0%' stopColor='#6ee7b7' />
                                <stop offset='100%' stopColor='#34d399' />
                            </linearGradient>
                            <linearGradient id='bar3dSide2' x1='0%' y1='0%' x2='100%' y2='0%'>
                                <stop offset='0%' stopColor='#059669' />
                                <stop offset='100%' stopColor='#065f46' />
                            </linearGradient>

                            {/* 3D Isometric Bar 3 Gradients */}
                            <linearGradient id='bar3dFront3' x1='0%' y1='0%' x2='0%' y2='100%'>
                                <stop offset='0%' stopColor='#22d3ee' />
                                <stop offset='50%' stopColor='#10b981' />
                                <stop offset='100%' stopColor='#059669' />
                            </linearGradient>
                            <linearGradient id='bar3dTop3' x1='0%' y1='0%' x2='100%' y2='100%'>
                                <stop offset='0%' stopColor='#e0f2fe' />
                                <stop offset='100%' stopColor='#38bdf8' />
                            </linearGradient>
                            <linearGradient id='bar3dSide3' x1='0%' y1='0%' x2='100%' y2='0%'>
                                <stop offset='0%' stopColor='#0891b2' />
                                <stop offset='100%' stopColor='#0e7490' />
                            </linearGradient>

                            {/* 3D Surging Growth Arrow */}
                            <linearGradient id='surgeArrowGrad' x1='0%' y1='100%' x2='100%' y2='0%'>
                                <stop offset='0%' stopColor='#059669' />
                                <stop offset='35%' stopColor='#10b981' />
                                <stop offset='75%' stopColor='#06b6d4' />
                                <stop offset='100%' stopColor='#38bdf8' />
                            </linearGradient>

                            {/* Filters: 3D Depth Shadows and Glass Ambient Glow */}
                            <filter id='lth3dShadow' x='-25%' y='-25%' width='150%' height='150%'>
                                <feDropShadow dx='0' dy='6' stdDeviation='6' floodColor='#000000' floodOpacity='0.4' />
                            </filter>
                            <filter id='lthGlassGlow' x='-30%' y='-30%' width='160%' height='160%'>
                                <feDropShadow dx='0' dy='2' stdDeviation='3' floodColor='#10b981' floodOpacity='0.45' />
                            </filter>
                        </defs>

                        <g filter='url(#lth3dShadow)'>
                            {/* 3D Frosted Glass Base Squircle Tile */}
                            <rect
                                x='8'
                                y='8'
                                width='104'
                                height='104'
                                rx='26'
                                fill='url(#lth3dGlassBg)'
                                stroke='url(#lth3dGlassRim)'
                                strokeWidth='1.8'
                            />

                            {/* Specular Diagonal Sheen across glass surface */}
                            <path
                                d='M12 46 L46 12 C62 12 82 20 98 36 L36 98 C20 82 12 62 12 46 Z'
                                fill='url(#lth3dSheen)'
                                opacity='0.7'
                            />

                            {/* Top Rim Specular Highlight Arc */}
                            <path
                                d='M24 16 C42 10 78 10 96 16'
                                stroke='#ffffff'
                                strokeWidth='2'
                                strokeLinecap='round'
                                strokeOpacity='0.8'
                                fill='none'
                            />

                            {/* 3D Isometric Chart Bar 1 (Left) */}
                            <g filter='url(#lthGlassGlow)'>
                                <rect x='26' y='62' width='15' height='34' rx='3' fill='url(#bar3dFront1)' />
                                <polygon points='26,62 33,55 48,55 41,62' fill='url(#bar3dTop1)' />
                                <polygon points='41,62 48,55 48,89 41,96' fill='url(#bar3dSide1)' opacity='0.9' />
                                <line x1='28' y1='63' x2='39' y2='63' stroke='#ffffff' strokeWidth='1.2' strokeOpacity='0.65' strokeLinecap='round' />
                            </g>

                            {/* 3D Isometric Chart Bar 2 (Middle) */}
                            <g filter='url(#lthGlassGlow)'>
                                <rect x='49' y='44' width='15' height='52' rx='3' fill='url(#bar3dFront2)' />
                                <polygon points='49,44 56,37 71,37 64,44' fill='url(#bar3dTop2)' />
                                <polygon points='64,44 71,37 71,89 64,96' fill='url(#bar3dSide2)' opacity='0.9' />
                                <line x1='51' y1='45' x2='62' y2='45' stroke='#ffffff' strokeWidth='1.2' strokeOpacity='0.75' strokeLinecap='round' />
                            </g>

                            {/* 3D Isometric Chart Bar 3 (Right) */}
                            <g filter='url(#lthGlassGlow)'>
                                <rect x='72' y='28' width='15' height='68' rx='3' fill='url(#bar3dFront3)' />
                                <polygon points='72,28 79,21 94,21 87,28' fill='url(#bar3dTop3)' />
                                <polygon points='87,28 94,21 94,89 87,96' fill='url(#bar3dSide3)' opacity='0.9' />
                                <line x1='74' y1='29' x2='85' y2='29' stroke='#ffffff' strokeWidth='1.4' strokeOpacity='0.85' strokeLinecap='round' />
                            </g>

                            {/* 3D Surging Growth Vector / Rocketing Arrow */}
                            <path
                                d='M20 88 L46 56 L64 68 L94 28'
                                stroke='rgba(0,0,0,0.35)'
                                strokeWidth='8'
                                strokeLinecap='round'
                                strokeLinejoin='round'
                                fill='none'
                            />
                            <path
                                d='M20 87 L46 55 L64 67 L94 27'
                                stroke='#047857'
                                strokeWidth='6'
                                strokeLinecap='round'
                                strokeLinejoin='round'
                                fill='none'
                            />
                            <path
                                d='M20 85 L46 53 L64 65 L94 25'
                                stroke='url(#surgeArrowGrad)'
                                strokeWidth='3.8'
                                strokeLinecap='round'
                                strokeLinejoin='round'
                                fill='none'
                            />
                            <path
                                d='M22 84 L46 53 L64 65 L93 25'
                                stroke='#ffffff'
                                strokeWidth='1.3'
                                strokeLinecap='round'
                                strokeLinejoin='round'
                                strokeOpacity='0.75'
                                fill='none'
                            />

                            {/* 3D Glass Arrow Head */}
                            <polygon points='80,18 102,20 96,42 91,32 83,34' fill='url(#surgeArrowGrad)' filter='url(#lthGlassGlow)' />
                            <polygon points='83,21 98,23 94,37 91,32 86,33' fill='#ffffff' fillOpacity='0.45' />

                            {/* Specular Diamond Star Flare */}
                            <circle cx='100' cy='21' r='3.2' fill='#ffffff' />
                            <line x1='100' y1='13' x2='100' y2='29' stroke='#ffffff' strokeWidth='1.6' strokeLinecap='round' />
                            <line x1='92' y1='21' x2='108' y2='21' stroke='#ffffff' strokeWidth='1.6' strokeLinecap='round' />
                        </g>
                    </svg>
                )}
                <div className='lth-brand-logo__text-col'>
                    <span className='lth-brand-logo__title lth-brand-logo__legacy'>LEGACY</span>
                    <span className='lth-brand-logo__subtitle lth-brand-logo__trading-hub'>TRADING HUB</span>
                </div>
            </div>
        </div>
    );
});
