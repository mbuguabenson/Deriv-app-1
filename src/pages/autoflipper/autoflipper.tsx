import React, { useCallback, useEffect, useRef, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { generateOAuthURL, TradingMilestoneModal } from '@/components/shared';
import type { MilestoneType } from '@/components/shared/trading-milestone-modal';
import { api_base } from '@/external/bot-skeleton';
import { observer as globalObserver } from '@/external/bot-skeleton/utils/observer';
import { useStore } from '@/hooks/useStore';
import { isLoggedIn } from '@/utils/token-bridge';
import { buyContractForUi, streamContractUntilSettled } from '@/utils/trade-purchase';
import { subscribeTicks, derivTickManager } from '@/utils/websocket-handler';
import { aiContinuousLearningService } from '@/services/ai-continuous-learning.service';
import { AiLearningHubModal } from '@/components/ai-learning-hub/ai-learning-hub-modal';
import {
    Activity,
    AlertTriangle,
    BarChart3,
    BookOpen,
    CheckCircle2,
    ChevronDown,
    ChevronUp,
    Info,
    Layers,
    Pause,
    Play,
    RefreshCw,
    Shield,
    Sparkles,
    Square,
    Target,
    TrendingUp,
    Zap,
} from 'lucide-react';
import './autoflipper.scss';

// ─── Constants ──────────────────────────────────────────────────────────────────

const FLIP_START_DEFAULT = 20;
const FLIP_TARGET_DEFAULT = 8080;
const FLIP_HOURS = 45;
const STAKE_DIVISOR = 8;
const MAX_DIGITS_BUFFER = 1000;
const CHART_DIGITS = 50;
const MIN_ANALYSIS_DWELL_TICKS = 8;
const MIN_ANALYSIS_DWELL_MS = 4000;
const SMART_SWITCH_COOLDOWN_MS = 12000; // min ms between market switches
const MARKET_DWELL_LIMIT_MS = 10 * 60 * 1000; // 10 minutes dwell for scheduled market rotation
const PERSIST_KEY = 'af2_engine_state';
const PING_INTERVAL_MS = 25000; // keep-alive WebSocket ping

const MARKETS = [
    { symbol: 'R_10', label: 'Vol 10' },
    { symbol: 'R_25', label: 'Vol 25' },
    { symbol: 'R_50', label: 'Vol 50' },
    { symbol: 'R_75', label: 'Vol 75' },
    { symbol: 'R_100', label: 'Vol 100' },
    { symbol: '1HZ10V', label: 'Vol 10 (1s)' },
    { symbol: '1HZ25V', label: 'Vol 25 (1s)' },
    { symbol: '1HZ50V', label: 'Vol 50 (1s)' },
    { symbol: '1HZ75V', label: 'Vol 75 (1s)' },
    { symbol: '1HZ100V', label: 'Vol 100 (1s)' },
];

// ─── Persistence helpers ──────────────────────────────────────────────────────

type PersistedState = {
    totalProfit: number;
    hourProfit: number;
    wins: number;
    losses: number;
    currentHour: number;
    currentStake: number;
    consecutiveLoss: number;
    selectedSymbol: string;
    startBalance: string;
    targetBalance: string;
    martingale: string;
    stopLoss: string;
    tickDuration: string;
    savedAt: number;
};

const loadPersistedState = (): PersistedState | null => {
    try {
        const raw = localStorage.getItem(PERSIST_KEY);
        if (!raw) return null;
        const s: PersistedState = JSON.parse(raw);
        // Discard stale saves older than 12 hours
        if (!s.savedAt || Date.now() - s.savedAt > 12 * 60 * 60 * 1000) return null;
        return s;
    } catch { return null; }
};

const savePersistedState = (s: PersistedState): void => {
    try { localStorage.setItem(PERSIST_KEY, JSON.stringify({ ...s, savedAt: Date.now() })); } catch {}
};

const clearPersistedState = (): void => {
    try { localStorage.removeItem(PERSIST_KEY); } catch {}
};

// ─── WebSocket readiness helper ───────────────────────────────────────────────

/** Waits until api_base WebSocket is open (readyState === 1), up to maxWait ms */
const waitForSocketReady = (maxWait = 8000): Promise<boolean> => {
    return new Promise(resolve => {
        if (api_base?.api?.connection?.readyState === 1) {
            resolve(true);
            return;
        }
        const deadline = Date.now() + maxWait;
        const check = () => {
            if (api_base?.api?.connection?.readyState === 1) {
                resolve(true);
                return;
            }
            if (Date.now() >= deadline) {
                resolve(false);
                return;
            }
            setTimeout(check, 150);
        };
        check();
    });
};

// ─── Types ───────────────────────────────────────────────────────────────────────

type AutoState = 'IDLE' | 'SCANNING' | 'WAITING_TRIGGER' | 'TRADING' | 'PAUSED';

type MarketData = {
    symbol: string;
    label: string;
    digits: number[];
    currentPrice: string;
    lastDigit: number;
    tickCount: number;
    lastTickTime: number;
    cycleTicks: number;
};

type HourStage = {
    hour: number;
    startBalance: number;
    hourTP: number;
    stake: number;
    endBalance: number;
    status: 'DONE' | 'ACTIVE' | 'PENDING';
};

type TradeLog = {
    id: string;
    time: string;
    type: string;
    market: string;
    result: 'WIN' | 'LOSS' | 'PENDING' | 'ABORTED';
    profit: number;
    details?: string;
};

type TxnRecord = {
    id: string;
    contractId?: number | string;
    time: string;
    market: string;
    contractType: string;
    stake: number;
    profit: number;
    result: 'WIN' | 'LOSS' | 'OPEN';
    status: 'open' | 'settled';
    entrySpot?: string | number;
    exitSpot?: string | number;
};

// ─── Helpers ─────────────────────────────────────────────────────────────────────

const extractDigit = (quote: number | string | undefined | null): number => {
    if (quote === undefined || quote === null) return 0;
    const s = typeof quote === 'number' ? quote.toFixed(6).replace(/\.?0+$/, '') : String(quote).trim();
    if (!s) return 0;
    const parts = s.split('.');
    if (parts.length > 1 && parts[1].length > 0) return parseInt(parts[1].slice(-1), 10) || 0;
    return parseInt(parts[0].slice(-1), 10) || 0;
};

const createMarketsMap = (): Map<string, MarketData> => {
    const m = new Map<string, MarketData>();
    MARKETS.forEach(mk => {
        m.set(mk.symbol, {
            symbol: mk.symbol,
            label: mk.label,
            digits: [],
            currentPrice: '—',
            lastDigit: 0,
            tickCount: 0,
            lastTickTime: 0,
            cycleTicks: 0,
        });
    });
    return m;
};

const generateFlipSchedule = (startBalance: number, targetBalance: number, hours: number): HourStage[] => {
    if (startBalance <= 0 || targetBalance <= startBalance || hours <= 0) return [];
    const gf = Math.pow(targetBalance / startBalance, 1 / hours);
    let balance = startBalance;
    return Array.from({ length: hours }, (_, i) => {
        const hourTP = balance * (gf - 1);
        const stake = Math.max(0.35, parseFloat((hourTP / STAKE_DIVISOR).toFixed(2)));
        const endBal = balance + hourTP;
        const stage: HourStage = {
            hour: i + 1,
            startBalance: parseFloat(balance.toFixed(2)),
            hourTP: parseFloat(hourTP.toFixed(2)),
            stake,
            endBalance: parseFloat(endBal.toFixed(2)),
            status: 'PENDING',
        };
        balance = endBal;
        return stage;
    });
};

// ─── Sound Cues ──────────────────────────────────────────────────────────────────

const playSound = (type: 'win' | 'loss' | 'signal') => {
    try {
        const Ctx = window.AudioContext || (window as any).webkitAudioContext;
        if (!Ctx) return;
        const ctx = new Ctx();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        const now = ctx.currentTime;
        if (type === 'win') {
            osc.frequency.setValueAtTime(587, now);
            osc.frequency.exponentialRampToValueAtTime(880, now + 0.15);
            gain.gain.setValueAtTime(0.15, now);
            gain.gain.exponentialRampToValueAtTime(0.01, now + 0.35);
            osc.start(now); osc.stop(now + 0.35);
        } else if (type === 'loss') {
            osc.frequency.setValueAtTime(392, now);
            osc.frequency.exponentialRampToValueAtTime(220, now + 0.2);
            gain.gain.setValueAtTime(0.15, now);
            gain.gain.exponentialRampToValueAtTime(0.01, now + 0.3);
            osc.start(now); osc.stop(now + 0.3);
        } else {
            osc.frequency.setValueAtTime(659, now);
            gain.gain.setValueAtTime(0.1, now);
            gain.gain.exponentialRampToValueAtTime(0.01, now + 0.15);
            osc.start(now); osc.stop(now + 0.15);
        }
    } catch { /* ignore */ }
};

// ─── SVG Bezier Chart ────────────────────────────────────────────────────────────

const getBezier = (pts: { x: number; y: number }[]) => {
    if (pts.length < 2) return '';
    let d = `M ${pts[0].x.toFixed(1)},${pts[0].y.toFixed(1)}`;
    for (let i = 0; i < pts.length - 1; i++) {
        const p0 = pts[i], p1 = pts[i + 1];
        const cpX = p0.x + (p1.x - p0.x) / 2;
        d += ` C ${cpX.toFixed(1)},${p0.y.toFixed(1)} ${cpX.toFixed(1)},${p1.y.toFixed(1)} ${p1.x.toFixed(1)},${p1.y.toFixed(1)}`;
    }
    return d;
};

const DigitChart: React.FC<{ digits: number[] }> = ({ digits }) => {
    const slice = digits.slice(-CHART_DIGITS);
    if (slice.length < 2) {
        return (
            <div className='af2-chart-empty'>
                <div className='af2-chart-empty__spinner' />
                <span>Connecting live tick stream…</span>
            </div>
        );
    }
    const W = Math.max(600, slice.length * 14);
    const H = 110;
    const padT = 16, padB = 14;
    const usable = H - padT - padB;
    const stepX = (W - 24) / (slice.length - 1);
    const pts = slice.map((d, i) => ({ x: 12 + i * stepX, y: padT + usable - (d / 9) * usable, d }));
    const pathD = getBezier(pts);
    const areaD = pathD ? `${pathD} L ${pts[pts.length - 1].x},${H} L ${pts[0].x},${H} Z` : '';

    return (
        <div className='af2-chart-scroll'>
            <svg width='100%' height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio='none' style={{ display: 'block', minWidth: `${W}px` }}>
                <defs>
                    <linearGradient id='af2Grad' x1='0%' y1='0%' x2='100%' y2='0%'>
                        <stop offset='0%' stopColor='#6366f1' stopOpacity='0.9' />
                        <stop offset='50%' stopColor='#8b5cf6' stopOpacity='1' />
                        <stop offset='100%' stopColor='#a78bfa' stopOpacity='0.9' />
                    </linearGradient>
                    <linearGradient id='af2Area' x1='0%' y1='0%' x2='0%' y2='100%'>
                        <stop offset='0%' stopColor='#8b5cf6' stopOpacity='0.18' />
                        <stop offset='100%' stopColor='#8b5cf6' stopOpacity='0' />
                    </linearGradient>
                    <filter id='af2Glow'>
                        <feDropShadow dx='0' dy='1' stdDeviation='3' floodColor='#8b5cf6' floodOpacity='0.7' />
                    </filter>
                </defs>
                {/* Barrier lines */}
                {[3, 6].map(lv => {
                    const y = padT + usable - (lv / 9) * usable;
                    return (
                        <g key={lv}>
                            <line x1={0} y1={y} x2={W} y2={y} stroke={lv === 6 ? 'rgba(99,102,241,0.45)' : 'rgba(245,158,11,0.45)'} strokeDasharray='4 3' strokeWidth='1' />
                            <text x={6} y={y - 3} fill={lv === 6 ? '#818cf8' : '#fbbf24'} fontSize='9' fontWeight='700'>
                                {lv === 6 ? 'UNDER 6' : 'OVER 3'}
                            </text>
                        </g>
                    );
                })}
                {areaD && <path d={areaD} fill='url(#af2Area)' />}
                {pathD && <path d={pathD} fill='none' stroke='url(#af2Grad)' strokeWidth='2.5' strokeLinecap='round' filter='url(#af2Glow)' />}
                {pts.map((p, i) => {
                    const isLast = i === pts.length - 1;
                    const isUnder = p.d <= 4;
                    return (
                        <g key={i}>
                            {isLast && <circle cx={p.x} cy={p.y} r={12} fill='rgba(139,92,246,0.2)' className='af2-pulse-ring' />}
                            <circle cx={p.x} cy={p.y} r={isLast ? 5 : 3} fill={isLast ? '#fff' : isUnder ? '#6366f1' : '#f59e0b'} stroke={isLast ? '#8b5cf6' : 'transparent'} strokeWidth='2' filter={isLast ? 'url(#af2Glow)' : undefined} />
                            <text x={p.x} y={p.y - (isLast ? 9 : 7)} textAnchor='middle' fill={isLast ? '#fff' : isUnder ? '#a5b4fc' : '#fcd34d'} fontSize={isLast ? '11' : '9'} fontWeight={isLast ? '800' : '600'}>{p.d}</text>
                        </g>
                    );
                })}
            </svg>
        </div>
    );
};

// ─── Elite Pro Analysis Engine (transplanted from elite-pro.tsx) ─────────────────

type ComprehensiveAnalysis = {
    macro: {
        total1000: number; pct1000: number[]; most1000: number; second1000: number; least1000: number;
        outlier7Pct: number; outlier8Pct: number; outlier9Pct: number;
        outlier0Pct: number; outlier1Pct: number; outlier2Pct: number;
        outlier7Increasing: boolean; outlier8Increasing: boolean; outlier9Increasing: boolean;
        outlier0Increasing: boolean; outlier1Increasing: boolean; outlier2Increasing: boolean;
        outliersUnder6Safe: boolean; outliersOver3Safe: boolean;
        macroUnder6Dominant: boolean; macroOver3Dominant: boolean;
    };
    mid: {
        under04: number; over59: number; pctUnder04: number; pctOver59: number;
        under05: number; over49: number; pctUnder05: number; pctOver49: number;
        underIncreasing: boolean; overIncreasing: boolean;
        under04Increasing: boolean; over59Increasing: boolean;
        under05Increasing: boolean; over49Increasing: boolean;
        highestUnderDigit: number; highestUnderCount: number; highestUnderPct: number;
        highestOverDigit: number; highestOverCount: number; highestOverPct: number;
        freq50: number[];
    };
    cycle: {
        cycleUnder05: number; cycleOver49: number; pctCycleUnder05: number; pctCycleOver49: number;
        isRegimeShiftUnder: boolean; isRegimeShiftOver: boolean;
        stabilityStatus: 'STABLE_UNDER' | 'STABLE_OVER' | 'SHIFTING' | 'NEUTRAL';
    };
    micro: { last10UnderCount: number; last10OverCount: number; last7UnderCount: number; last7OverCount: number };
    bias: 'under' | 'over' | 'shifting' | 'neutral';
    qualityScore: number;
    totalTicks: number;
    isAvoidMarket: boolean;
    condition: {
        status: 'GOOD' | 'ANALYZING' | 'NOT_GOOD';
        isGood: boolean; isNotGood: boolean;
        alertTitle: string; alertMessage: string; alertSeverity: 'danger' | 'warning' | 'success' | 'info';
        unbalancedDigits: boolean; unidentifiedPattern: boolean; conditionsNotMet: boolean; reasons: string[];
        marketHealthScore: number;
    };
};

type SignalResult = {
    direction: 'UNDER' | 'OVER';
    prediction: number;
    triggerDigit: number;
    reason: string;
    status: 'WAITING' | 'TRIGGERED';
    isAutoPaused: boolean;
    qualityScore: number;
    conditions: { macroCondition: boolean; stat1Condition: boolean; stat2Condition: boolean; micro10Condition: boolean; cycleCondition: boolean; triggerDigitCondition: boolean };
};

function computeAnalysis(digits: number[]): ComprehensiveAnalysis {
    const totalTicks = digits.length;
    const slice1000 = digits.slice(-1000);
    const total1000 = slice1000.length || 1;
    const freq1000 = new Array(10).fill(0);
    slice1000.forEach(d => { if (d >= 0 && d <= 9) freq1000[d]++; });
    const pct1000 = freq1000.map(c => (c / total1000) * 100);
    const sorted1000 = [0,1,2,3,4,5,6,7,8,9].sort((a,b) => freq1000[b]-freq1000[a]);
    const most1000 = sorted1000[0], second1000 = sorted1000[1], least1000 = sorted1000[9];
    const half = Math.floor(total1000 / 2) || 1;
    const h1 = slice1000.slice(0, half), h2 = slice1000.slice(half);
    const hp = (arr: number[], d: number) => arr.filter(x => x === d).length / (arr.length || 1) * 100;
    const o7P = pct1000[7]||0, o8P = pct1000[8]||0, o9P = pct1000[9]||0;
    const o0P = pct1000[0]||0, o1P = pct1000[1]||0, o2P = pct1000[2]||0;
    const o7I = hp(h2,7) > hp(h1,7)+0.8, o8I = hp(h2,8) > hp(h1,8)+0.8, o9I = hp(h2,9) > hp(h1,9)+0.8;
    const o0I = hp(h2,0) > hp(h1,0)+0.8, o1I = hp(h2,1) > hp(h1,1)+0.8, o2I = hp(h2,2) > hp(h1,2)+0.8;
    const outliersUnder6Safe = o7P < 14 && o8P < 14 && o9P < 14 && !o7I && !o8I && !o9I;
    const outliersOver3Safe  = o0P < 14 && o0P < 14 && o2P < 14 && !o0I && !o1I && !o2I;
    const macroUnder6Dominant = (most1000 <= 5 && second1000 <= 5) || (outliersUnder6Safe && pct1000.slice(0,6).reduce((a,b) => a+b,0) >= 54);
    const macroOver3Dominant  = (most1000 >= 4 && second1000 >= 4) || (outliersOver3Safe  && pct1000.slice(4,10).reduce((a,b) => a+b,0) >= 54);

    const slice50 = digits.slice(-50);
    const total50 = slice50.length || 1;
    const under04 = slice50.filter(d => d >= 0 && d <= 4).length;
    const over59  = slice50.filter(d => d >= 5 && d <= 9).length;
    const under05 = slice50.filter(d => d >= 0 && d <= 5).length;
    const over49  = slice50.filter(d => d >= 4 && d <= 9).length;
    const pctUnder04 = (under04/total50)*100, pctOver59 = (over59/total50)*100;
    const pctUnder05 = (under05/total50)*100, pctOver49 = (over49/total50)*100;
    const fh50 = slice50.slice(0, Math.floor(total50/2)), sh50 = slice50.slice(Math.floor(total50/2));
    const under04Increasing = sh50.filter(d => d <= 4).length / (sh50.length||1) >= fh50.filter(d => d <= 4).length / (fh50.length||1);
    const over59Increasing  = !under04Increasing;
    const under05Increasing = sh50.filter(d => d <= 5).length / (sh50.length||1) >= fh50.filter(d => d <= 5).length / (fh50.length||1);
    const over49Increasing  = !under05Increasing;
    const underIncreasing   = under04Increasing || under05Increasing;
    const overIncreasing    = over59Increasing  || over49Increasing;
    const freq50 = new Array(10).fill(0);
    slice50.forEach(d => { if (d >= 0 && d <= 9) freq50[d]++; });
    let maxUC = -1, highestUnderDigit = 0;
    freq50.slice(0,6).forEach((c,i) => { if (c > maxUC) { maxUC = c; highestUnderDigit = i; } });
    let maxOC = -1, highestOverDigit = 4;
    freq50.slice(4,10).forEach((c,i) => { if (c > maxOC) { maxOC = c; highestOverDigit = i+4; } });
    const highestUnderPct = (maxUC/total50)*100, highestOverPct = (maxOC/total50)*100;

    const slice15 = digits.slice(-15);
    const total15 = slice15.length || 1;
    const cycleUnder05 = slice15.filter(d => d <= 5).length;
    const cycleOver49  = slice15.filter(d => d >= 4).length;
    const pctCycleUnder05 = (cycleUnder05/total15)*100, pctCycleOver49 = (cycleOver49/total15)*100;
    const isRegimeShiftUnder = cycleOver49 >= 10, isRegimeShiftOver = cycleUnder05 >= 10;
    let stabilityStatus: 'STABLE_UNDER' | 'STABLE_OVER' | 'SHIFTING' | 'NEUTRAL' = 'NEUTRAL';
    if (cycleUnder05 >= 9 && !isRegimeShiftUnder) stabilityStatus = 'STABLE_UNDER';
    else if (cycleOver49 >= 9 && !isRegimeShiftOver) stabilityStatus = 'STABLE_OVER';
    else if (isRegimeShiftUnder || isRegimeShiftOver) stabilityStatus = 'SHIFTING';

    const slice10 = digits.slice(-10);
    const last10UnderCount = slice10.filter(d => d <= 5).length;
    const last10OverCount  = slice10.filter(d => d >= 4).length;
    const slice7 = digits.slice(-7);
    const last7UnderCount  = slice7.filter(d => d <= 5).length;
    const last7OverCount   = slice7.filter(d => d >= 4).length;

    let bias: 'under' | 'over' | 'shifting' | 'neutral' = 'neutral';
    if (stabilityStatus === 'SHIFTING') bias = 'shifting';
    else if (pctUnder05 >= 50 && under05 >= over49) bias = 'under';
    else if (pctOver49  >= 50 && over49  >= under05) bias = 'over';

    let qualityScore = 50;
    if (bias === 'under')
        qualityScore = Math.round((pctUnder05*0.45) + ((last10UnderCount/10)*100*0.35) + (outliersUnder6Safe?15:0) + (macroUnder6Dominant?5:0));
    else if (bias === 'over')
        qualityScore = Math.round((pctOver49*0.45) + ((last10OverCount/10)*100*0.35) + (outliersOver3Safe?15:0) + (macroOver3Dominant?5:0));
    else
        qualityScore = Math.round(Math.max(pctUnder05, pctOver49) * 0.85);
    qualityScore = Math.min(100, Math.max(0, qualityScore));

    const isAvoidMarket = (bias==='under' && !outliersUnder6Safe) || (bias==='over' && !outliersOver3Safe) || stabilityStatus==='SHIFTING' || qualityScore<40;

    // Condition assessment
    const reasons: string[] = [];
    const isSampleSufficient = totalTicks >= 15;
    const maxDomPct = Math.max(pctUnder05, pctOver49);
    const hasNoDominance = maxDomPct < 48 && totalTicks >= 20;
    const isNeutralChoppy = (bias==='neutral'||bias==='shifting') && totalTicks >= 20;
    const dominantMicroCount = bias==='under' ? last10UnderCount : last10OverCount;
    const isWeakMicro = dominantMicroCount <= 3 && totalTicks >= 15;
    let unbalancedDigits = false, unidentifiedPattern = false, conditionsNotMet = false;
    const maxOutlierUnder = Math.max(o7P,o8P,o9P), maxOutlierOver = Math.max(o0P,o1P,o2P);
    const hasOutlierSurgeUnder = o7P>=14.5 || o8P>=14.5 || o9P>=14.5 || (o7P>=13&&o7I) || (o8P>=13&&o8I) || (o9P>=13&&o9I);
    const hasOutlierSurgeOver  = o0P>=14.5 || o1P>=14.5 || o2P>=14.5 || (o0P>=13&&o0I) || (o1P>=13&&o1I) || (o2P>=13&&o2I);
    const isDeadlocked = Math.abs(under05-over49) <= 1 && totalTicks >= 25;
    if ((bias==='under'||under05>=over49) && hasOutlierSurgeUnder) { unbalancedDigits=true; reasons.push(`Outlier Spike: Digits 7,8,9 at ${maxOutlierUnder.toFixed(1)}%`); }
    else if ((bias==='over'||over49>under05) && hasOutlierSurgeOver) { unbalancedDigits=true; reasons.push(`Outlier Spike: Digits 0,1,2 at ${maxOutlierOver.toFixed(1)}%`); }
    else if (isDeadlocked && (hasOutlierSurgeUnder||hasOutlierSurgeOver)) { unbalancedDigits=true; reasons.push('Deadlocked ratio with unstable outliers'); }
    if (hasNoDominance || (isNeutralChoppy && stabilityStatus!=='STABLE_UNDER' && stabilityStatus!=='STABLE_OVER')) { unidentifiedPattern=true; reasons.push(`Consolidating (${maxDomPct.toFixed(0)}% edge)`); }
    else if (isWeakMicro && !unidentifiedPattern) { unidentifiedPattern=true; reasons.push(`Weak micro (${dominantMicroCount}/10 ratio)`); }
    const hasRegimeShift = isRegimeShiftUnder || isRegimeShiftOver;
    const isLowQuality = qualityScore < 45 && totalTicks >= 25;
    const isMacroMismatch = (bias==='under' && !macroUnder6Dominant && macroOver3Dominant) || (bias==='over' && !macroOver3Dominant && macroUnder6Dominant);
    if (hasRegimeShift) { conditionsNotMet=true; reasons.push(`15t Regime Shift (${isRegimeShiftUnder?cycleOver49:cycleUnder05}/15 counter digits)`); }
    else if (isMacroMismatch) { conditionsNotMet=true; reasons.push('Macro vs. 50t direction mismatch'); }
    else if (isLowQuality && !conditionsNotMet) { conditionsNotMet=true; reasons.push(`Low quality score (${qualityScore}/100)`); }

    const isNotGood = (unbalancedDigits||unidentifiedPattern||conditionsNotMet||isAvoidMarket) && isSampleSufficient;
    const isGood = !isNotGood && isSampleSufficient && qualityScore>=55 && !hasRegimeShift && ((bias==='under'&&pctUnder05>=50)||(bias==='over'&&pctOver49>=50));
    let status: 'GOOD'|'ANALYZING'|'NOT_GOOD' = 'ANALYZING';
    let alertTitle = '🔍 ANALYZING', alertMessage = `Collecting data (${totalTicks}/20 ticks)…`;
    let alertSeverity: 'danger'|'warning'|'success'|'info' = 'info';
    if (!isSampleSufficient) { status='ANALYZING'; alertSeverity='info'; }
    else if (isNotGood) { status='NOT_GOOD'; alertTitle='⚠️ MARKET NOT GOOD'; alertSeverity='danger'; alertMessage=reasons.length>0?reasons.join(' • '):'Conditions not met'; }
    else if (isGood) { status='GOOD'; alertTitle='✅ CONDITIONS OPTIMAL'; alertSeverity='success'; alertMessage=`${bias==='under'?'Under 6':'Over 3'} momentum (${maxDomPct.toFixed(0)}% dom, Score: ${qualityScore}/100)`; }
    else { status='ANALYZING'; alertTitle='⚖️ CONSOLIDATING'; alertSeverity='warning'; alertMessage=`Building momentum (U:${under05} vs O:${over49}, Score: ${qualityScore}/100)`; }

    return {
        macro: { total1000, pct1000, most1000, second1000, least1000, outlier7Pct:o7P, outlier8Pct:o8P, outlier9Pct:o9P, outlier0Pct:o0P, outlier1Pct:o1P, outlier2Pct:o2P, outlier7Increasing:o7I, outlier8Increasing:o8I, outlier9Increasing:o9I, outlier0Increasing:o0I, outlier1Increasing:o1I, outlier2Increasing:o2I, outliersUnder6Safe, outliersOver3Safe, macroUnder6Dominant, macroOver3Dominant },
        mid: { under04, over59, pctUnder04, pctOver59, under05, over49, pctUnder05, pctOver49, underIncreasing, overIncreasing, under04Increasing, over59Increasing, under05Increasing, over49Increasing, highestUnderDigit, highestUnderCount:maxUC, highestUnderPct, highestOverDigit, highestOverCount:maxOC, highestOverPct, freq50 },
        cycle: { cycleUnder05, cycleOver49, pctCycleUnder05, pctCycleOver49, isRegimeShiftUnder, isRegimeShiftOver, stabilityStatus },
        micro: { last10UnderCount, last10OverCount, last7UnderCount, last7OverCount },
        bias, qualityScore, totalTicks, isAvoidMarket,
        condition: { status, isGood, isNotGood, alertTitle, alertMessage, alertSeverity, unbalancedDigits, unidentifiedPattern, conditionsNotMet, reasons, marketHealthScore: qualityScore },
    };
}

function checkEntrySignal(digits: number[], forcedDir?: 'UNDER_6'|'OVER_3'|'AUTO'): SignalResult | null {
    if (digits.length < 15) return null;
    const a = computeAnalysis(digits);
    const cur = digits[digits.length - 1];
    const dir: 'UNDER_6'|'OVER_3' = forcedDir && forcedDir !== 'AUTO' ? forcedDir : (a.mid.under05 >= a.mid.over49 ? 'UNDER_6' : 'OVER_3');

    if (dir === 'UNDER_6') {
        const hasHist = a.macro.total1000 >= 30;
        const macroCondition = !hasHist || (a.macro.macroUnder6Dominant || a.macro.outliersUnder6Safe);
        // 50-tick dominance condition: Under 6 digits (0-5) have >= 50% frequency and exceed over49
        const stat1Condition = a.mid.pctUnder05 >= 50;
        const stat2Condition = a.mid.under05 >= a.mid.over49;
        // 10-tick micro trend: at least 5 of last 10 ticks are Under 6
        const micro10Condition = a.micro.last10UnderCount >= 5;
        // 15-tick cycle: no strong regime shift against under
        const cycleCondition = !a.cycle.isRegimeShiftUnder;
        // Winning digit range for Under 6 is 0, 1, 2, 3, 4, 5
        const triggerDigitCondition = cur <= 5;
        const all = macroCondition && stat1Condition && stat2Condition && cycleCondition && micro10Condition;
        const isTriggered = all && triggerDigitCondition && !a.cycle.isRegimeShiftUnder;
        const isAutoPaused = a.cycle.isRegimeShiftUnder;

        let reason = '';
        if (isAutoPaused) {
            reason = `⏸ 15t Regime Shift (${a.cycle.cycleOver49}/15 Over). Auto-paused.`;
        } else if (isTriggered) {
            const isPrime = cur === a.mid.highestUnderDigit || cur <= 3;
            reason = `🎯 UNDER 6 FIRED! Digit [${cur}] (50t: ${a.mid.pctUnder05.toFixed(0)}%, 10t: ${a.micro.last10UnderCount}/10${isPrime ? ' ★ High Confluence' : ''})`;
        } else if (all) {
            reason = `⏳ Signal clear! Waiting under digit [0-5] (current: ${cur})`;
        } else {
            reason = `Consolidating — U05: ${a.mid.pctUnder05.toFixed(0)}% (${a.mid.under05} vs O49: ${a.mid.over49}), 10t: ${a.micro.last10UnderCount}/10`;
        }

        return {
            direction: 'UNDER',
            prediction: 6,
            triggerDigit: a.mid.highestUnderDigit,
            reason,
            status: isTriggered ? 'TRIGGERED' : 'WAITING',
            isAutoPaused,
            qualityScore: a.qualityScore,
            conditions: { macroCondition, stat1Condition, stat2Condition, micro10Condition, cycleCondition, triggerDigitCondition }
        };
    } else {
        const hasHist = a.macro.total1000 >= 30;
        const macroCondition = !hasHist || (a.macro.macroOver3Dominant || a.macro.outliersOver3Safe);
        // 50-tick dominance condition: Over 3 digits (4-9) have >= 50% frequency and exceed under05
        const stat1Condition = a.mid.pctOver49 >= 50;
        const stat2Condition = a.mid.over49 >= a.mid.under05;
        // 10-tick micro trend: at least 5 of last 10 ticks are Over 3
        const micro10Condition = a.micro.last10OverCount >= 5;
        // 15-tick cycle: no strong regime shift against over
        const cycleCondition = !a.cycle.isRegimeShiftOver;
        // Winning digit range for Over 3 is 4, 5, 6, 7, 8, 9
        const triggerDigitCondition = cur >= 4;
        const all = macroCondition && stat1Condition && stat2Condition && cycleCondition && micro10Condition;
        const isTriggered = all && triggerDigitCondition && !a.cycle.isRegimeShiftOver;
        const isAutoPaused = a.cycle.isRegimeShiftOver;

        let reason = '';
        if (isAutoPaused) {
            reason = `⏸ 15t Regime Shift (${a.cycle.cycleUnder05}/15 Under). Auto-paused.`;
        } else if (isTriggered) {
            const isPrime = cur === a.mid.highestOverDigit || cur >= 6;
            reason = `🎯 OVER 3 FIRED! Digit [${cur}] (50t: ${a.mid.pctOver49.toFixed(0)}%, 10t: ${a.micro.last10OverCount}/10${isPrime ? ' ★ High Confluence' : ''})`;
        } else if (all) {
            reason = `⏳ Signal clear! Waiting over digit [4-9] (current: ${cur})`;
        } else {
            reason = `Consolidating — O49: ${a.mid.pctOver49.toFixed(0)}% (${a.mid.over49} vs U05: ${a.mid.under05}), 10t: ${a.micro.last10OverCount}/10`;
        }

        return {
            direction: 'OVER',
            prediction: 3,
            triggerDigit: a.mid.highestOverDigit,
            reason,
            status: isTriggered ? 'TRIGGERED' : 'WAITING',
            isAutoPaused,
            qualityScore: a.qualityScore,
            conditions: { macroCondition, stat1Condition, stat2Condition, micro10Condition, cycleCondition, triggerDigitCondition }
        };
    }
}

// ─── Main Component ───────────────────────────────────────────────────────────────

const Autoflipper: React.FC = observer(() => {
    const store = useStore();
    const { client, transactions, journal } = store || {};
    const currency = client?.currency || 'USD';
    const loggedIn = Boolean(client?.is_logged_in || isLoggedIn() || api_base.is_authorized);

    // ── Config State (restored from persistence if available) ──
    const _ps = React.useMemo(() => loadPersistedState(), []);
    const [startBalance, setStartBalance] = useState<string>(_ps?.startBalance ?? String(FLIP_START_DEFAULT));
    const [targetBalance, setTargetBalance] = useState<string>(_ps?.targetBalance ?? String(FLIP_TARGET_DEFAULT));
    const [martingale, setMartingale] = useState<string>(_ps?.martingale ?? '2.6');
    const [stopLoss, setStopLoss] = useState<string>(_ps?.stopLoss ?? '50');
    const [tickDuration, setTickDuration] = useState<string>(_ps?.tickDuration ?? '1');

    // ── Market State ──
    const [selectedSymbol, setSelectedSymbol] = useState<string>(_ps?.selectedSymbol ?? '1HZ10V');
    const [scanAll, setScanAll] = useState<boolean>(true);
    const [autoSwitch, setAutoSwitch] = useState<boolean>(true);

    // ── 10-Minute Dwell & Auto-Switch ──
    const marketStartTimeRef = useRef<number>(Date.now());
    const [dwellRemainingSec, setDwellRemainingSec] = useState<number>(600);

    const switchSelectedSymbol = useCallback((sym: string) => {
        setSelectedSymbol(sym);
        selectedSymbolRef.current = sym;
        marketStartTimeRef.current = Date.now();
        setDwellRemainingSec(600);
    }, []);

    // ── WS Status ──
    const [wsReady, setWsReady] = useState<boolean>(Boolean(api_base?.is_authorized));

    // ── Engine State (restored from persistence) ──
    const [autoState, setAutoState] = useState<AutoState>('IDLE');
    const [totalProfit, setTotalProfit] = useState<number>(_ps?.totalProfit ?? 0);
    const [hourProfit, setHourProfit] = useState<number>(_ps?.hourProfit ?? 0);
    const [wins, setWins] = useState<number>(_ps?.wins ?? 0);
    const [losses, setLosses] = useState<number>(_ps?.losses ?? 0);
    const [currentHour, setCurrentHour] = useState<number>(_ps?.currentHour ?? 1);
    const [schedule, setSchedule] = useState<HourStage[]>([]);
    const [showSchedule, setShowSchedule] = useState<boolean>(false);

    // ── Trade Log ──
    const [tradeLogs, setTradeLogs] = useState<TradeLog[]>([]);
    const [txns, setTxns] = useState<TxnRecord[]>([]);
    const [activeTab, setActiveTab] = useState<'TRADES' | 'JOURNAL'>('TRADES');

    // ── 5-Run Batch Tracking ──
    const runsInBatchRef = useRef<number>(0);
    const [runsInBatch, setRunsInBatch] = useState<number>(0);

    // ── Modals ──
    const [milestone, setMilestone] = useState<{ isOpen: boolean; type: MilestoneType }>({ isOpen: false, type: null });
    const [isAiOpen, setIsAiOpen] = useState<boolean>(false);

    // ── 10-Minute Dwell Countdown Timer ──
    useEffect(() => {
        if (autoState === 'IDLE') {
            setDwellRemainingSec(600);
            return;
        }
        const dwellInterval = setInterval(() => {
            const elapsed = Date.now() - marketStartTimeRef.current;
            const rem = Math.max(0, Math.ceil((MARKET_DWELL_LIMIT_MS - elapsed) / 1000));
            setDwellRemainingSec(rem);
        }, 1000);
        return () => clearInterval(dwellInterval);
    }, [autoState]);

    // ── Refs ──
    const marketsRef = useRef<Map<string, MarketData>>(createMarketsMap());
    const subsRef = useRef<Map<string, { unsubscribe: () => void }>>(new Map());
    const histFetchedRef = useRef<Set<string>>(new Set());
    const unmountedRef = useRef(false);
    const uiThrottleRef = useRef<number>(0);
    const throttleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const autoStateRef = useRef<AutoState>('IDLE');
    const autoAbortRef = useRef<AbortController | null>(null);
    const contractAbortsRef = useRef<Set<AbortController>>(new Set());
    const currentStakeRef = useRef<number>(_ps?.currentStake ?? 0.35);
    const totalProfitRef = useRef<number>(_ps?.totalProfit ?? 0);
    const hourProfitRef = useRef<number>(_ps?.hourProfit ?? 0);
    const winsRef = useRef<number>(_ps?.wins ?? 0);
    const lossesRef = useRef<number>(_ps?.losses ?? 0);
    const consecutiveLossRef = useRef<number>(_ps?.consecutiveLoss ?? 0);
    const selectedSymbolRef = useRef<string>(selectedSymbol);
    const currentHourRef = useRef<number>(_ps?.currentHour ?? 1);
    const scheduleRef = useRef<HourStage[]>([]);
    const smartSwitchLastRef = useRef<number>(0); // timestamp of last market switch
    const [, forceRender] = useState<number>(0);
    const [streamKey, setStreamKey] = useState<number>(0);

    // Sync refs
    useEffect(() => { selectedSymbolRef.current = selectedSymbol; }, [selectedSymbol]);
    useEffect(() => { autoStateRef.current = autoState; }, [autoState]);
    useEffect(() => { currentHourRef.current = currentHour; }, [currentHour]);

    // Periodic persistence save (every 5 s while running)
    useEffect(() => {
        const saveInterval = setInterval(() => {
            if (autoStateRef.current === 'IDLE') return;
            savePersistedState({
                totalProfit: totalProfitRef.current,
                hourProfit: hourProfitRef.current,
                wins: winsRef.current,
                losses: lossesRef.current,
                currentHour: currentHourRef.current,
                currentStake: currentStakeRef.current,
                consecutiveLoss: consecutiveLossRef.current,
                selectedSymbol: selectedSymbolRef.current,
                startBalance, targetBalance, martingale, stopLoss, tickDuration,
                savedAt: Date.now(),
            });
        }, 5000);
        return () => clearInterval(saveInterval);
    }, [startBalance, targetBalance, martingale, stopLoss, tickDuration]);

    // Throttled render
    const throttleRender = useCallback(() => {
        const now = Date.now();
        const elapsed = now - uiThrottleRef.current;
        if (elapsed >= 80) {
            uiThrottleRef.current = now;
            if (throttleTimerRef.current) { clearTimeout(throttleTimerRef.current); throttleTimerRef.current = null; }
            if (!unmountedRef.current) forceRender(n => (n + 1) % 1_000_000);
        } else if (!throttleTimerRef.current) {
            throttleTimerRef.current = setTimeout(() => {
                throttleTimerRef.current = null;
                uiThrottleRef.current = Date.now();
                if (!unmountedRef.current) forceRender(n => (n + 1) % 1_000_000);
            }, 80 - elapsed);
        }
    }, []);

    // Build schedule whenever start/target changes
    useEffect(() => {
        const sb = parseFloat(startBalance) || FLIP_START_DEFAULT;
        const tb = parseFloat(targetBalance) || FLIP_TARGET_DEFAULT;
        const s = generateFlipSchedule(sb, tb, FLIP_HOURS);
        setSchedule(s);
        scheduleRef.current = s;
    }, [startBalance, targetBalance]);

    // ── Ranked markets helper ──
    const getLiveRanked = useCallback(() => {
        const result: Array<{ symbol: string; label: string; currentPrice: string; lastDigit: number; qualityScore: number; bias: string; under05: number; over49: number; pctUnder05: number; pctOver49: number; highestUnderDigit: number; highestOverDigit: number; hasSignal: boolean; isTriggered: boolean; isAutoPaused: boolean; signalDirection?: 'UNDER'|'OVER'; condStatus: string }> = [];
        marketsRef.current.forEach(m => {
            const a = computeAnalysis(m.digits);
            const sig = checkEntrySignal(m.digits, 'AUTO');
            result.push({ symbol:m.symbol, label:m.label, currentPrice:m.currentPrice, lastDigit:m.lastDigit, qualityScore:a.qualityScore, bias:a.bias, under05:a.mid.under05, over49:a.mid.over49, pctUnder05:a.mid.pctUnder05, pctOver49:a.mid.pctOver49, highestUnderDigit:a.mid.highestUnderDigit, highestOverDigit:a.mid.highestOverDigit, hasSignal:Boolean(sig&&!sig.isAutoPaused), isTriggered:Boolean(sig&&sig.status==='TRIGGERED'), isAutoPaused:Boolean(sig?.isAutoPaused), signalDirection:sig?.direction, condStatus:a.condition.status });
        });
        result.sort((a,b) => {
            const ag = a.isTriggered && a.condStatus==='GOOD', bg = b.isTriggered && b.condStatus==='GOOD';
            if (ag && !bg) return -1; if (!ag && bg) return 1;
            if (a.condStatus==='GOOD' && b.condStatus!=='GOOD') return -1;
            if (a.condStatus!=='GOOD' && b.condStatus==='GOOD') return 1;
            return b.qualityScore - a.qualityScore;
        });
        return result;
    }, []);

    // ── 1000-tick history fetch (fast non-blocking, retries if socket connecting) ──
    const fetchHistory = useCallback(async (sym: string) => {
        if (histFetchedRef.current.has(sym)) return;
        histFetchedRef.current.add(sym);
        try {
            await waitForSocketReady(6000);
            if (api_base?.api?.connection?.readyState === 1) {
                const res = (await api_base.api
                    .send({ ticks_history: sym, count: 1000, end: 'latest', style: 'ticks' })
                    .catch(() => null)) as { history?: { prices?: (number | string)[] } } | null;
                if (res?.history?.prices && Array.isArray(res.history.prices) && res.history.prices.length > 0) {
                    const m = marketsRef.current.get(sym);
                    if (m) {
                        m.digits = res.history.prices.map(p => extractDigit(p)).slice(-MAX_DIGITS_BUFFER);
                        m.currentPrice = String(res.history.prices[res.history.prices.length - 1]);
                        m.lastDigit = m.digits[m.digits.length - 1] || 0;
                        m.lastTickTime = Date.now();
                        throttleRender();
                    }
                }
            } else {
                histFetchedRef.current.delete(sym);
            }
        } catch {
            histFetchedRef.current.delete(sym);
        }
    }, [throttleRender]);

    // ── WebSocket assurance & reconnect listeners ──
    useEffect(() => {
        if (!api_base.api || api_base.api?.connection?.readyState !== 1) {
            api_base.init().catch(() => {});
        }
        if (api_base?.api?.connection?.readyState === 1) {
            setWsReady(true);
        }
        const onWsOpen = () => {
            setWsReady(true);
            histFetchedRef.current.clear();
            derivTickManager.resubscribeAll('ws.opened');
            setStreamKey(k => k + 1);
        };
        const onAuth = () => {
            setWsReady(true);
            histFetchedRef.current.clear();
            derivTickManager.resubscribeAll('api.authorize');
            setStreamKey(k => k + 1);
        };
        globalObserver.register('ws.opened', onWsOpen);
        globalObserver.register('api.authorize', onAuth);
        return () => {
            globalObserver.unregister('ws.opened', onWsOpen);
            globalObserver.unregister('api.authorize', onAuth);
        };
    }, []);

    // ── Keep-alive ping + Wake Lock ──
    useEffect(() => {
        let wakeLock: WakeLockSentinel | null = null;
        const acquireWakeLock = async () => {
            try {
                if ('wakeLock' in navigator) {
                    wakeLock = await (navigator as any).wakeLock.request('screen');
                }
            } catch { /* wake lock denied — fallback to ping */ }
        };
        void acquireWakeLock();
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible') void acquireWakeLock();
        });
        // WebSocket keep-alive ping every 25 s
        const pingInterval = setInterval(() => {
            try {
                if (api_base?.api?.connection?.readyState === 1) {
                    api_base.api.send({ ping: 1 }).catch(() => {});
                } else {
                    derivTickManager.healStalledStreams();
                }
            } catch {}
        }, PING_INTERVAL_MS);
        return () => {
            clearInterval(pingInterval);
            if (wakeLock) { try { wakeLock.release(); } catch {} }
        };
    }, []);

    // ── Stream event listeners (account switch / online / visibility / watchdog) ──
    useEffect(() => {
        const handleRefresh = () => {
            subsRef.current.forEach(s => { try { s.unsubscribe(); } catch {} });
            subsRef.current.clear();
            histFetchedRef.current.clear();
            derivTickManager.healStalledStreams();
            setStreamKey(k => k + 1);
        };
        const handleVisibility = () => {
            if (!document.hidden) {
                derivTickManager.healStalledStreams();
                setStreamKey(k => k + 1);
            }
        };
        window.addEventListener('account_switched', handleRefresh);
        window.addEventListener('online', handleRefresh);
        document.addEventListener('visibilitychange', handleVisibility);

        const watchdog = setInterval(() => {
            if (unmountedRef.current || document.hidden) return;
            const cur = marketsRef.current.get(selectedSymbolRef.current);
            const now = Date.now();
            const isStale = !cur || cur.lastTickTime === 0 || now - cur.lastTickTime > 3500;
            if (isStale) {
                derivTickManager.healStalledStreams();
                histFetchedRef.current.delete(selectedSymbolRef.current);
                void fetchHistory(selectedSymbolRef.current);
            }
        }, 3000);

        return () => {
            window.removeEventListener('account_switched', handleRefresh);
            window.removeEventListener('online', handleRefresh);
            document.removeEventListener('visibilitychange', handleVisibility);
            clearInterval(watchdog);
        };
    }, [fetchHistory]);

    useEffect(() => {
        const syms = scanAll ? MARKETS.map(m => m.symbol) : [selectedSymbol];
        syms.forEach(sym => {
            if (!marketsRef.current.has(sym)) {
                const label = MARKETS.find(m => m.symbol === sym)?.label || sym;
                marketsRef.current.set(sym, { symbol:sym, label, digits:[], currentPrice:'—', lastDigit:0, tickCount:0, lastTickTime:0, cycleTicks:0 });
            }
            void fetchHistory(sym);
        });
        syms.forEach(sym => {
            if (subsRef.current.has(sym)) return;
            const sub = subscribeTicks(sym, (data: Record<string, unknown>) => {
                if (unmountedRef.current) return;
                const m = marketsRef.current.get(sym);
                if (!m) return;
                const tickObj = (data?.tick || data) as { quote?: number | string; symbol?: string } | undefined;
                const quote = tickObj?.quote;
                if (quote !== undefined && quote !== null) {
                    const digit = extractDigit(quote);
                    aiContinuousLearningService.ingestMarketTick(sym, digit);
                    m.digits.push(digit);
                    if (m.digits.length > MAX_DIGITS_BUFFER) m.digits.shift();
                    m.currentPrice = String(quote);
                    m.lastDigit = digit;
                    m.tickCount = (m.tickCount || 0) + 1;
                    m.cycleTicks = (m.cycleTicks || 0) + 1;
                    m.lastTickTime = Date.now();
                    throttleRender();
                }
            });
            subsRef.current.set(sym, sub);
        });
    }, [scanAll, selectedSymbol, streamKey, fetchHistory, throttleRender]);

    useEffect(() => () => {
        unmountedRef.current = true;
        subsRef.current.forEach(s => { try { s.unsubscribe(); } catch {} });
        subsRef.current.clear();
    }, []);

    // ── Single trade executor ──
    const executeTrade = useCallback(async (symbol: string, direction: 'UNDER'|'OVER', prediction: number, stake: number): Promise<number> => {
        const contractType = direction === 'UNDER' ? 'DIGITUNDER' : 'DIGITOVER';
        const dur = parseInt(tickDuration) || 1;
        const label = MARKETS.find(m => m.symbol === symbol)?.label || symbol;
        const timeStr = new Date().toLocaleTimeString();
        const tempId = `AF-${Date.now()}-${Math.random().toString(36).slice(2,6)}`;

        const openTxn: TxnRecord = { id:tempId, time:timeStr, market:label, contractType:direction==='UNDER'?'Under 6':'Over 3', stake, profit:0, result:'OPEN', status:'open' };
        setTxns(prev => [openTxn, ...prev].slice(0, 100));

        // Direct buy execution with instantBuy: true for real-time tick synchronization
        const buy = await buyContractForUi({
            parameters: {
                amount: stake,
                basis: 'stake',
                contract_type: contractType,
                currency: currency || 'USD',
                duration: dur,
                duration_unit: 't',
                symbol,
                barrier: String(prediction),
            },
            price: stake,
            source: 'Autoflipper',
            instantBuy: true,
        });
        const { contract_id, buy_price, transaction_id } = buy;

        const init = {
            buy_price,
            contract_id,
            transaction_ids: { buy: transaction_id },
            date_start: Math.floor(Date.now() / 1000),
            display_name: label,
            underlying_symbol: symbol,
            shortcode: `AF_${contractType}_${symbol}`,
            contract_type: contractType,
            currency: currency || 'USD',
            barrier: String(prediction),
            status: 'open',
            is_sold: false,
        };

        // Broadcast open contract to Run Panel Transactions & global observer
        try {
            transactions?.onBotContractEvent?.(init as any);
            globalObserver.emit('bot.contract', init);
        } catch {}

        try {
            const openMsg = `[AutoFlipper] Purchased ${direction === 'UNDER' ? 'Under 6' : 'Over 3'} on ${label} @ $${stake.toFixed(2)}`;
            journal?.pushMessage?.(openMsg, 'notify', '');
            globalObserver.emit('ui.log.notify', { message: openMsg, sound: 'silent' });
        } catch {}

        const abort = new AbortController();
        contractAbortsRef.current.add(abort);
        const settled = await streamContractUntilSettled({
            contractId: contract_id,
            fallback: init,
            onUpdate: snap => {
                if (!unmountedRef.current) {
                    try {
                        transactions?.onBotContractEvent?.(snap as any);
                        globalObserver.emit('bot.contract', snap);
                    } catch {}
                }
            },
            signal: abort.signal,
            source: 'Autoflipper',
        });
        contractAbortsRef.current.delete(abort);

        const profit = Number(settled?.profit ?? 0);
        const isWin = profit > 0;
        const entrySpot = settled?.entry_tick_display_value ?? settled?.entry_tick ?? '—';
        const exitSpot  = settled?.exit_tick_display_value  ?? settled?.exit_tick  ?? '—';

        // Broadcast settled contract to Run Panel Transactions & Journal
        const settledContract = {
            ...init,
            ...settled,
            buy_price,
            contract_id,
            transaction_ids: { buy: transaction_id, sell: settled?.transaction_ids?.sell || settled?.sell_id },
            display_name: label,
            underlying_symbol: symbol,
            shortcode: `AF_${contractType}_${symbol}`,
            contract_type: contractType,
            currency: currency || 'USD',
            barrier: String(prediction),
            entry_spot: entrySpot,
            exit_spot: exitSpot,
            profit,
            sell_price: settled?.sell_price ?? (isWin ? buy_price + profit : 0),
            payout: settled?.payout ?? (isWin ? buy_price + profit : 0),
            status: isWin ? 'won' : 'lost',
            is_sold: true,
        };

        try {
            transactions?.onBotContractEvent?.(settledContract as any);
            globalObserver.emit('bot.contract', settledContract);
        } catch {}

        try {
            const resMsg = `[AutoFlipper] ${isWin ? 'WON (+$' + profit.toFixed(2) + ')' : 'LOST (-$' + Math.abs(profit).toFixed(2) + ')'} on ${label} [${direction === 'UNDER' ? 'Under 6' : 'Over 3'}] | Exit Spot: ${exitSpot}`;
            journal?.pushMessage?.(resMsg, isWin ? 'success' : 'error', '');
            globalObserver.emit('ui.log.notify', { message: resMsg, sound: 'silent' });
        } catch {}

        setTxns(prev => prev.map(t => t.id === tempId ? { ...t, contractId:contract_id, profit, result:isWin?'WIN':'LOSS', status:'settled', entrySpot, exitSpot } : t));
        aiContinuousLearningService.recordBotTrade({ botName:'AUTOFLIPPER', strategy:`DIGIT${direction}_${prediction}`, market:symbol, contractType, barrier:String(prediction), prediction, isWin, profit, stake });
        return profit;
    }, [tickDuration, currency, transactions, journal]);

    // ── Log helpers ──
    const addLog = useCallback((type: string, market: string, result: TradeLog['result'], profit: number, details?: string) => {
        const entry: TradeLog = { id:`AL-${Date.now()}-${Math.random().toString(36).slice(2,5)}`, time:new Date().toLocaleTimeString(), type, market, result, profit, details };
        setTradeLogs(prev => [entry, ...prev].slice(0, 100));

        try {
            const jType = result === 'WIN' ? 'success' : result === 'LOSS' ? 'error' : 'notify';
            const jMsg = `[AutoFlipper] ${type} | ${market}${details ? ' — ' + details : ''}`;
            journal?.pushMessage?.(jMsg, jType, '');
            globalObserver.emit('ui.log.notify', { message: jMsg, sound: 'silent' });
        } catch {}
    }, [journal]);

    // ── Main auto trading loop ──
    const startAutoTrading = useCallback(async () => {
        if (!loggedIn) {
            const url = await generateOAuthURL();
            if (url) window.location.replace(url);
            return;
        }

        const sl = parseFloat(stopLoss) || 50;
        const mgMult = parseFloat(martingale) || 2.6;

        totalProfitRef.current = 0;
        hourProfitRef.current = 0;
        winsRef.current = 0;
        lossesRef.current = 0;
        consecutiveLossRef.current = 0;
        currentHourRef.current = 1;
        runsInBatchRef.current = 0;
        setTotalProfit(0);
        setHourProfit(0);
        setWins(0);
        setLosses(0);
        setCurrentHour(1);
        setRunsInBatch(0);

        // Reset dwell timer for current market
        marketStartTimeRef.current = Date.now();
        setDwellRemainingSec(600);

        const sched = scheduleRef.current;
        if (!sched.length) { addLog('ERROR', 'Engine', 'ABORTED', 0, 'No schedule generated. Adjust start/target.'); return; }
        const getHourStake = (hour: number) => sched[Math.min(hour-1, sched.length-1)]?.stake ?? 0.35;
        currentStakeRef.current = getHourStake(1);

        addLog('ENGINE STARTED', selectedSymbolRef.current, 'PENDING', 0, `${FLIP_HOURS}h Compounding Engine: $${startBalance} → $${targetBalance} | SL: $${sl} | Martingale: ${mgMult}x`);
        playSound('signal');
        setAutoState('SCANNING');
        autoStateRef.current = 'SCANNING';
        autoAbortRef.current = new AbortController();
        const abortSig = autoAbortRef.current.signal;

        let currentMarketDwellTicks = 0;
        let lastProcessedTickCount = 0;
        let lastSwitchTime = Date.now();
        let badMarketCycles = 0;
        let noPatternCycles = 0;

        const loop = async () => {
            while (!abortSig.aborted && autoStateRef.current !== 'IDLE') {
                if (autoStateRef.current === 'PAUSED') { await new Promise(r => setTimeout(r, 400)); continue; }

                // 1. Check Stop Loss Auto-Stop
                if (totalProfitRef.current <= -sl) {
                    const msg = `⚠️ Stop Loss Limit (-$${sl}) reached. Engine Auto-Stopped.`;
                    addLog('STOP LOSS HIT', selectedSymbolRef.current, 'LOSS', totalProfitRef.current, msg);
                    setAutoState('IDLE');
                    autoStateRef.current = 'IDLE';
                    playSound('loss');
                    setMilestone({ isOpen: true, type: 'sl' });
                    break;
                }

                // 2. Check 45-Hour Completion Auto-Stop
                const hour = currentHourRef.current;
                if (hour > FLIP_HOURS) {
                    const msg = `🏆 45-Hour Compounding Plan Completed! Total Profit: +$${totalProfitRef.current.toFixed(2)}. Engine Auto-Stopped.`;
                    addLog('GOAL COMPLETED', selectedSymbolRef.current, 'WIN', totalProfitRef.current, msg);
                    setAutoState('IDLE');
                    autoStateRef.current = 'IDLE';
                    playSound('win');
                    setMilestone({ isOpen: true, type: 'tp' });
                    break;
                }

                // 3. Check Consecutive Loss Safety Auto-Stop (5 consecutive losses)
                if (consecutiveLossRef.current >= 5) {
                    const msg = `🛑 Safety Limit: 5 Consecutive Losses reached. Engine Auto-Stopped to protect capital.`;
                    addLog('SAFETY AUTO-STOP', selectedSymbolRef.current, 'LOSS', 0, msg);
                    setAutoState('IDLE');
                    autoStateRef.current = 'IDLE';
                    playSound('loss');
                    break;
                }

                // Current hour target
                const curStage = sched[hour - 1];
                if (!curStage) { await new Promise(r => setTimeout(r, 200)); continue; }

                // Check if hour TP hit
                if (hourProfitRef.current >= curStage.hourTP) {
                    const nextHour = hour + 1;
                    addLog(`✅ HOUR ${hour} DONE`, `Profit: +$${hourProfitRef.current.toFixed(2)}`, 'WIN', hourProfitRef.current, `Advancing to Hour ${nextHour}. New stake: $${getHourStake(nextHour).toFixed(2)}`);
                    hourProfitRef.current = 0;
                    setHourProfit(0);
                    setCurrentHour(nextHour);
                    currentHourRef.current = nextHour;
                    consecutiveLossRef.current = 0;
                    currentStakeRef.current = getHourStake(nextHour);
                    await new Promise(r => setTimeout(r, 300));
                    continue;
                }

                // Get market data
                let targetSym = selectedSymbolRef.current;
                const data = marketsRef.current.get(targetSym);
                if (!data || data.digits.length < 15) {
                    if (autoStateRef.current !== 'SCANNING') { setAutoState('SCANNING'); autoStateRef.current = 'SCANNING'; }
                    await new Promise(r => setTimeout(r, 200)); continue;
                }

                const curTickCount = data.tickCount || 0;
                if (curTickCount > lastProcessedTickCount) { currentMarketDwellTicks += Math.max(1, curTickCount - lastProcessedTickCount); lastProcessedTickCount = curTickCount; }

                const a = computeAnalysis(data.digits);
                const sig = checkEntrySignal(data.digits, 'AUTO');
                const isDwellOk = currentMarketDwellTicks >= MIN_ANALYSIS_DWELL_TICKS || Date.now() - lastSwitchTime >= MIN_ANALYSIS_DWELL_MS;
                const isMarketBad = a.condition.isNotGood || Boolean(sig?.isAutoPaused) || a.condition.unbalancedDigits || a.condition.unidentifiedPattern;
                if (isMarketBad) badMarketCycles++; else badMarketCycles = 0;

                // 4. Auto-Switch: 10-Minute Dwell Rotation OR Market Degradation (when not in Martingale recovery)
                const dwellElapsed = Date.now() - marketStartTimeRef.current;
                const isTenMinuteDwellReached = dwellElapsed >= MARKET_DWELL_LIMIT_MS;

                if (autoSwitch && currentStakeRef.current <= getHourStake(hour)) {
                    const isCritical = Boolean(sig?.isAutoPaused) || a.condition.unbalancedDigits;
                    const shouldRotate = isTenMinuteDwellReached || (isMarketBad && (isDwellOk || isCritical)) || noPatternCycles >= 15;

                    if (shouldRotate) {
                        const ranked = getLiveRanked();
                        const alt = ranked.find(m => m.symbol !== targetSym && m.condStatus === 'GOOD' && m.qualityScore >= 55 && !m.isAutoPaused) ||
                                    (isTenMinuteDwellReached ? ranked.find(m => m.symbol !== targetSym && !m.isAutoPaused) : null);
                        if (alt) {
                            const oldLabel = data.label;
                            switchSelectedSymbol(alt.symbol);
                            currentMarketDwellTicks = 0;
                            lastProcessedTickCount = marketsRef.current.get(alt.symbol)?.tickCount || 0;
                            lastSwitchTime = Date.now();
                            badMarketCycles = 0;
                            noPatternCycles = 0;
                            const reasonDesc = isTenMinuteDwellReached ? '10-minute scheduled rotation' : `[${oldLabel}] bad conditions`;
                            addLog('MARKET ROTATE', alt.label, 'PENDING', 0, `🔄 ${reasonDesc} → Auto-switched to ${alt.label} (Score: ${alt.qualityScore})`);
                            throttleRender();
                            await new Promise(r => setTimeout(r, 600));
                            continue;
                        }
                    }
                }

                if (sig?.isAutoPaused) { if (autoStateRef.current !== 'SCANNING') { setAutoState('SCANNING'); autoStateRef.current = 'SCANNING'; } await new Promise(r => setTimeout(r, 200)); continue; }

                if (!sig || sig.status === 'WAITING') {
                    noPatternCycles++;
                    const newState = sig?.status === 'WAITING' && a.condition.isGood ? 'WAITING_TRIGGER' : 'SCANNING';
                    if (autoStateRef.current !== newState) { setAutoState(newState); autoStateRef.current = newState; }
                    await new Promise(r => setTimeout(r, 100)); continue;
                }

                // EXECUTE TRADE
                noPatternCycles = 0;
                setAutoState('TRADING'); autoStateRef.current = 'TRADING';

                try {
                    const stake = currentStakeRef.current;
                    addLog(`BUY ${sig.direction} ${sig.prediction}`, data.label, 'PENDING', 0, `Stake: $${stake.toFixed(2)} | ${sig.reason}`);

                    const profit = await executeTrade(targetSym, sig.direction, sig.prediction, stake);
                    if (abortSig.aborted || (autoStateRef.current as AutoState) === 'IDLE') break;

                    const isWin = profit > 0;
                    totalProfitRef.current = parseFloat((totalProfitRef.current + profit).toFixed(2));
                    hourProfitRef.current  = parseFloat((hourProfitRef.current  + profit).toFixed(2));
                    setTotalProfit(totalProfitRef.current);
                    setHourProfit(hourProfitRef.current);

                    aiContinuousLearningService.recordBotTrade({ botName:'AUTOFLIPPER', strategy:`DIGIT${sig.direction}_${sig.prediction}`, market:targetSym, contractType:sig.direction==='UNDER'?'DIGITUNDER':'DIGITOVER', barrier:String(sig.prediction), prediction:sig.prediction, isWin, profit, stake });

                    addLog(`${sig.direction} ${sig.prediction}`, data.label, isWin?'WIN':'LOSS', profit, `${isWin?'+':'-'}$${Math.abs(profit).toFixed(2)} ${currency}`);

                    if (isWin) {
                        winsRef.current++; setWins(winsRef.current);
                        consecutiveLossRef.current = 0;
                        currentStakeRef.current = getHourStake(currentHourRef.current);
                        playSound('win');
                    } else {
                        lossesRef.current++; setLosses(lossesRef.current);
                        consecutiveLossRef.current++;
                        const maxSteps = 5;
                        if (consecutiveLossRef.current < maxSteps) {
                            currentStakeRef.current = parseFloat((currentStakeRef.current * mgMult).toFixed(2));
                        } else {
                            currentStakeRef.current = getHourStake(currentHourRef.current);
                            consecutiveLossRef.current = 0;
                            addLog('MARTINGALE RESET', data.label, 'PENDING', 0, `Max recovery steps (${maxSteps}) reached. Reset to hour stake.`);
                        }
                        playSound('loss');

                        // ── Post-loss re-analysis guard ─────────────────────────────────────
                        // After every loss (especially the 1st and 2nd consecutive) pause the
                        // engine and wait for a genuinely fresh TRIGGERED signal before the
                        // next trade.  Market may be shifting — don't enter blindly.
                        if (!abortSig.aborted && (autoStateRef.current as AutoState) !== 'IDLE') {
                            const lossCount = consecutiveLossRef.current;
                            const cooldownMs = lossCount >= 2 ? 4000 : 2000;
                            const emoji = lossCount >= 2 ? '🛑' : '⚠️';

                            addLog(
                                'LOSS GUARD',
                                data.label,
                                'PENDING',
                                0,
                                `${emoji} ${lossCount} consecutive loss${lossCount > 1 ? 'es' : ''}. Re-analysing market before next entry (may be shifting)…`
                            );
                            setAutoState('PAUSED'); autoStateRef.current = 'PAUSED';

                            // Initial cooldown — let the market settle
                            await new Promise(r => setTimeout(r, cooldownMs));

                            // Poll until a fresh TRIGGERED signal appears (max 60 s)
                            const pollStart = Date.now();
                            const maxWait = 60_000;
                            const pollInterval = 3_000;
                            let foundSignal = false;

                            while (
                                !abortSig.aborted &&
                                (autoStateRef.current as AutoState) === 'PAUSED' &&
                                Date.now() - pollStart < maxWait
                            ) {
                                const liveData = marketsRef.current.get(selectedSymbolRef.current);
                                if (liveData && liveData.digits.length >= 15) {
                                    const freshSig = checkEntrySignal(liveData.digits, 'AUTO');
                                    if (freshSig && freshSig.status === 'TRIGGERED' && !freshSig.isAutoPaused && freshSig.qualityScore >= 55) {
                                        foundSignal = true;
                                        addLog(
                                            'LOSS GUARD CLEARED',
                                            data.label,
                                            'PENDING',
                                            0,
                                            `✅ High-confidence entry found (Q:${freshSig.qualityScore}). Resuming engine…`
                                        );
                                        break;
                                    }
                                }
                                await new Promise(r => setTimeout(r, pollInterval));
                            }

                            if (!foundSignal && !abortSig.aborted && (autoStateRef.current as AutoState) === 'PAUSED') {
                                addLog(
                                    'LOSS GUARD TIMEOUT',
                                    data.label,
                                    'PENDING',
                                    0,
                                    '⏸️ No high-confidence entry after 60 s. Resuming scan — will wait for trigger naturally.'
                                );
                            }

                            if (!abortSig.aborted && (autoStateRef.current as AutoState) === 'PAUSED') {
                                setAutoState('SCANNING'); autoStateRef.current = 'SCANNING';
                            }
                        } else {
                            await new Promise(r => setTimeout(r, 1200));
                        }
                        // ── End post-loss re-analysis guard ────────────────────────────────
                    }

                    // ── Batch pause: every 5 completed trades, pause for reanalysis ──
                    runsInBatchRef.current++;
                    setRunsInBatch(runsInBatchRef.current);
                    if (runsInBatchRef.current >= 5) {
                        runsInBatchRef.current = 0;
                        setRunsInBatch(0);
                        addLog('BATCH REANALYSIS', data.label, 'PENDING', 0,
                            `⏸ 5-trade batch complete. Pausing 8s for market reanalysis before next batch…`);
                        setAutoState('PAUSED'); autoStateRef.current = 'PAUSED';
                        // Auto-resume after 8 seconds of reanalysis
                        await new Promise(r => setTimeout(r, 8000));
                        if ((autoStateRef.current as AutoState) === 'PAUSED') {
                            addLog('BATCH RESUME', data.label, 'PENDING', 0, '▶ Reanalysis complete. Resuming engine…');
                            setAutoState('SCANNING'); autoStateRef.current = 'SCANNING';
                        }
                    }

                    if ((autoStateRef.current as AutoState) !== 'IDLE') { setAutoState('SCANNING'); autoStateRef.current = 'SCANNING'; }
                    await new Promise(r => setTimeout(r, 350));
                } catch (err) {
                    if (abortSig.aborted || (autoStateRef.current as AutoState) === 'IDLE') break;
                    const msg = err instanceof Error ? err.message : String(err);
                    console.error('[Autoflipper] Trade error:', msg);
                    addLog('TRADE ERROR', data.label, 'LOSS', 0, msg);
                    if ((autoStateRef.current as AutoState) !== 'IDLE') { setAutoState('SCANNING'); autoStateRef.current = 'SCANNING'; }
                    await new Promise(r => setTimeout(r, 1200));
                }
            }
        };

        void loop();
    }, [loggedIn, stopLoss, martingale, selectedSymbol, getLiveRanked, executeTrade, addLog, throttleRender, autoSwitch, startBalance, targetBalance, currency, switchSelectedSymbol]);

    const pauseBot = useCallback(() => {
        setAutoState('PAUSED'); autoStateRef.current = 'PAUSED';
        addLog('BOT PAUSED', selectedSymbolRef.current, 'PENDING', 0);
    }, [addLog]);

    const resumeBot = useCallback(() => {
        if (autoStateRef.current === 'PAUSED') { setAutoState('SCANNING'); autoStateRef.current = 'SCANNING'; addLog('BOT RESUMED', selectedSymbolRef.current, 'PENDING', 0); }
    }, [addLog]);

    const stopBot = useCallback(() => {
        setAutoState('IDLE'); autoStateRef.current = 'IDLE';
        autoAbortRef.current?.abort(); autoAbortRef.current = null;
        contractAbortsRef.current.forEach(c => c.abort()); contractAbortsRef.current.clear();
        addLog('BOT STOPPED', selectedSymbolRef.current, 'PENDING', 0);
        clearPersistedState();
    }, [addLog]);

    // ── Derived UI data ──
    const activeData = marketsRef.current.get(selectedSymbol);
    const analysis = activeData?.digits ? computeAnalysis(activeData.digits) : null;
    const signal = activeData?.digits ? checkEntrySignal(activeData.digits, 'AUTO') : null;
    const allMarkets = getLiveRanked();

    const curStage = schedule[currentHour - 1];
    const hourTPAmt = curStage?.hourTP ?? 0;
    const hourProgressPct = hourTPAmt > 0 ? Math.min(100, Math.max(0, (hourProfit / hourTPAmt) * 100)) : 0;
    const totalOverall = parseFloat(targetBalance) - parseFloat(startBalance);
    const totalProgressPct = totalOverall > 0 ? Math.min(100, Math.max(0, (totalProfit / totalOverall) * 100)) : 0;
    const totalTrades = wins + losses;
    const winRate = totalTrades > 0 ? ((wins / totalTrades) * 100).toFixed(1) : '0.0';
    const isRunning = autoState !== 'IDLE';

    const stateLabel: Record<AutoState, string> = {
        IDLE: '● READY', SCANNING: '⚡ SCANNING', WAITING_TRIGGER: '🎯 TRIGGER WAIT', TRADING: '🚀 EXECUTING', PAUSED: '⏸ PAUSED',
    };

    // Schedule stages with live status
    const scheduleWithStatus = schedule.map((s, i) => {
        let status: HourStage['status'] = 'PENDING';
        if (i + 1 < currentHour) status = 'DONE';
        else if (i + 1 === currentHour) status = 'ACTIVE';
        return { ...s, status };
    });

    return (
        <div className='af2'>
            {/* Ambient blobs */}
            <div className='af2__blobs'>
                <div className='af2__blob af2__blob--1' />
                <div className='af2__blob af2__blob--2' />
                <div className='af2__blob af2__blob--3' />
            </div>

            {/* ══ HEADER ══════════════════════════════════════════════════════════ */}
            <header className='af2__header'>
                <div className='af2__header-brand'>
                    <div className='af2__header-icon'>
                        <Zap size={20} />
                    </div>
                    <div className='af2__header-text'>
                        <h1>AutoFlipper Elite</h1>
                        <span>45-Hour Geometric Compounding Engine · Elite Pro Strategy · Under 6 / Over 3</span>
                    </div>
                    <span className={`af2__status-chip af2__status-chip--${autoState.toLowerCase()}`}>
                        {stateLabel[autoState]}
                    </span>
                </div>

                <div className='af2__header-stats'>
                    <div className='af2__stat-pill'>
                        <span className='af2__stat-label'>Session P/L</span>
                        <span className={`af2__stat-val ${totalProfit > 0 ? 'af2__stat-val--profit' : totalProfit < 0 ? 'af2__stat-val--loss' : ''}`}>
                            {totalProfit >= 0 ? `+$${totalProfit.toFixed(2)}` : `-$${Math.abs(totalProfit).toFixed(2)}`}
                        </span>
                    </div>
                    <div className='af2__stat-pill'>
                        <span className='af2__stat-label'>Hour {currentHour}/{FLIP_HOURS}</span>
                        <span className='af2__stat-val af2__stat-val--accent'>
                            +${hourProfit.toFixed(2)} / ${hourTPAmt.toFixed(2)}
                        </span>
                    </div>
                    <div className='af2__stat-pill'>
                        <span className='af2__stat-label'>Win Rate</span>
                        <span className={`af2__stat-val ${Number(winRate) >= 60 ? 'af2__stat-val--profit' : Number(winRate) > 0 ? 'af2__stat-val--warn' : ''}`}>
                            {winRate}% ({wins}W/{losses}L)
                        </span>
                    </div>
                    <div className='af2__stat-pill'>
                        <span className='af2__stat-label'>Current Stake</span>
                        <span className='af2__stat-val af2__stat-val--gold'>
                            ${currentStakeRef.current.toFixed(2)} {currency}
                        </span>
                    </div>
                    <div className='af2__stat-pill' title='5-trade batch: auto-pauses after 5 runs for reanalysis'>
                        <span className='af2__stat-label'>Batch Run</span>
                        <span className='af2__stat-val' style={{ color: autoState === 'PAUSED' ? '#f59e0b' : '#34d399' }}>
                            {isRunning ? `${runsInBatch}/5` : '—'}
                        </span>
                    </div>
                    <div className='af2__stat-pill af2__dwell-badge' title='Automated 10-minute market rotation countdown'>
                        <span className='af2__stat-label'>10m Rotation</span>
                        <span className='af2__stat-val' style={{ color: '#a5b4fc', display: 'flex', alignItems: 'center', gap: '5px' }}>
                            <RefreshCw size={11} className={isRunning ? 'af2-spin-slow' : ''} />
                            {isRunning
                                ? `${Math.floor(dwellRemainingSec / 60)}:${(dwellRemainingSec % 60).toString().padStart(2, '0')}`
                                : '10:00'}
                        </span>
                    </div>
                    <button className='af2__ai-btn' onClick={() => setIsAiOpen(true)}>
                        <Sparkles size={14} /> AI Lab
                    </button>
                </div>
            </header>

            {/* ══ MAIN LAYOUT ═════════════════════════════════════════════════════ */}
            <div className='af2__layout'>

                {/* ── LEFT SIDEBAR: Market Scanner ── */}
                <aside className='af2__sidebar'>
                    <div className='af2__sidebar-header'>
                        <span className='af2__sidebar-title'><Activity size={14} /> Markets</span>
                        <div className='af2__sidebar-toggles'>
                            <label className='af2__toggle-label' title='Scan All Markets'>
                                <input type='checkbox' checked={scanAll} onChange={e => setScanAll(e.target.checked)} />
                                <span className='af2__toggle-track'><span className='af2__toggle-thumb' /></span>
                                All
                            </label>
                            <label className='af2__toggle-label' title='Auto-Switch on Bad Market'>
                                <input type='checkbox' checked={autoSwitch} onChange={e => setAutoSwitch(e.target.checked)} />
                                <span className='af2__toggle-track'><span className='af2__toggle-thumb' /></span>
                                Auto
                            </label>
                        </div>
                    </div>

                    <div className='af2__market-list'>
                        {allMarkets.map(m => {
                            const isSelected = m.symbol === selectedSymbol;
                            return (
                                <div
                                    key={m.symbol}
                                    className={`af2__market-card ${isSelected ? 'af2__market-card--active' : ''} ${m.isTriggered ? 'af2__market-card--triggered' : ''} af2__market-card--${m.condStatus.toLowerCase()}`}
                                    onClick={() => switchSelectedSymbol(m.symbol)}
                                >
                                    <div className='af2__mc-top'>
                                        <span className='af2__mc-label'>{m.label}</span>
                                        <span className={`af2__mc-digit ${m.lastDigit <= 5 ? 'af2__mc-digit--under' : 'af2__mc-digit--over'}`}>{m.lastDigit}</span>
                                    </div>
                                    <div className='af2__mc-bar'>
                                        <div className='af2__mc-bar-u' style={{ width: `${m.pctUnder05}%` }} />
                                        <div className='af2__mc-bar-o' style={{ width: `${m.pctOver49}%` }} />
                                    </div>
                                    <div className='af2__mc-foot'>
                                        <span className='af2__mc-price'>{m.currentPrice}</span>
                                        <span className={`af2__mc-cond af2__mc-cond--${m.condStatus.toLowerCase()}`}>
                                            {m.condStatus === 'GOOD' ? '✓' : m.condStatus === 'NOT_GOOD' ? '✗' : '…'}
                                        </span>
                                        {m.hasSignal && <span className={`af2__mc-sig af2__mc-sig--${m.signalDirection?.toLowerCase()}`}>{m.signalDirection}</span>}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </aside>

                {/* ── MAIN CONTENT ── */}
                <main className='af2__main'>

                    {/* Row 1: Market condition banner */}
                    {analysis && (
                        <div className={`af2__banner af2__banner--${analysis.condition.alertSeverity}`}>
                            <div className='af2__banner-left'>
                                <span className={`af2__banner-status af2__banner-status--${analysis.condition.status.toLowerCase()}`}>
                                    {analysis.condition.status === 'GOOD' && <CheckCircle2 size={14} />}
                                    {analysis.condition.status === 'NOT_GOOD' && <AlertTriangle size={14} />}
                                    {analysis.condition.status === 'ANALYZING' && <Info size={14} />}
                                    {analysis.condition.alertTitle}
                                </span>
                                <span className='af2__banner-msg'>{analysis.condition.alertMessage}</span>
                                <div className='af2__diag-chips'>
                                    <span className={`af2__diag ${analysis.condition.unbalancedDigits ? 'bad' : 'good'}`}>{analysis.condition.unbalancedDigits ? '⚠ Unbalanced' : '✓ Balanced'}</span>
                                    <span className={`af2__diag ${analysis.condition.unidentifiedPattern ? 'bad' : 'good'}`}>{analysis.condition.unidentifiedPattern ? '⚠ No Pattern' : `✓ ${analysis.bias.toUpperCase()}`}</span>
                                    <span className={`af2__diag ${analysis.cycle.stabilityStatus === 'SHIFTING' ? 'bad' : 'good'}`}>{analysis.cycle.stabilityStatus === 'SHIFTING' ? '⚠ Regime Shift' : '✓ Stable'}</span>
                                    <span className={`af2__diag ${analysis.qualityScore >= 60 ? 'good' : analysis.qualityScore >= 45 ? 'warn' : 'bad'}`}>Score: {analysis.qualityScore}/100</span>
                                </div>
                            </div>
                            {analysis.condition.isNotGood && allMarkets[0] && allMarkets[0].symbol !== selectedSymbol && (
                                <button className='af2__switch-btn' onClick={() => switchSelectedSymbol(allMarkets[0].symbol)}>
                                    <RefreshCw size={13} /> Switch to {allMarkets[0].label}
                                </button>
                            )}
                        </div>
                    )}

                    {/* Row 2: Live Price + Digit + Signal cards */}
                    <div className='af2__hero-row'>
                        <div className='af2__glass af2__hero-card'>
                            <span className='af2__hero-label'>LIVE PRICE</span>
                            <div className='af2__price-row'>
                                <span className='af2__price-val'>{activeData?.currentPrice ?? '—'}</span>
                                <span className={`af2__live-dot ${activeData?.lastTickTime && Date.now() - activeData.lastTickTime < 4000 ? 'af2__live-dot--active' : ''}`} />
                            </div>
                            <span className='af2__price-sym'>{MARKETS.find(m => m.symbol === selectedSymbol)?.label}</span>
                        </div>

                        <div className={`af2__glass af2__hero-card af2__digit-card ${(activeData?.lastDigit ?? 0) <= 5 ? 'af2__digit-card--under' : 'af2__digit-card--over'}`}>
                            <span className='af2__hero-label'>LAST DIGIT</span>
                            <div className='af2__digit-orb'>{activeData?.lastDigit ?? '—'}</div>
                            <span className='af2__digit-zone'>{(activeData?.lastDigit ?? 0) <= 5 ? 'Under Zone (0–5)' : 'Over Zone (6–9)'}</span>
                        </div>

                        <div className={`af2__glass af2__hero-card af2__signal-card ${signal?.status === 'TRIGGERED' ? 'af2__signal-card--fired' : signal && !signal.isAutoPaused ? 'af2__signal-card--ready' : ''}`}>
                            <span className='af2__hero-label'>SIGNAL ENGINE</span>
                            <div className='af2__signal-dir'>
                                {signal ? (signal.isAutoPaused ? '⏸ PAUSED' : signal.status === 'TRIGGERED' ? `🎯 ${signal.direction} ${signal.prediction}` : `⏳ ${signal.direction} ${signal.prediction}`) : '● SCANNING'}
                            </div>
                            <span className='af2__signal-reason'>{signal?.reason?.slice(0, 72) ?? 'Waiting for market data...'}</span>
                        </div>

                        <div className='af2__glass af2__hero-card af2__hour-card'>
                            <span className='af2__hero-label'>HOUR {currentHour} / {FLIP_HOURS}</span>
                            <div className='af2__hour-ring'>
                                <svg viewBox='0 0 52 52' className='af2__ring-svg'>
                                    <circle cx='26' cy='26' r='22' fill='none' stroke='rgba(139,92,246,0.15)' strokeWidth='4' />
                                    <circle cx='26' cy='26' r='22' fill='none' stroke='url(#ringGrad)' strokeWidth='4' strokeDasharray={`${(hourProgressPct / 100) * 138.2} 138.2`} strokeLinecap='round' transform='rotate(-90 26 26)' />
                                    <defs>
                                        <linearGradient id='ringGrad' x1='0%' y1='0%' x2='100%' y2='0%'>
                                            <stop offset='0%' stopColor='#6366f1' />
                                            <stop offset='100%' stopColor='#a78bfa' />
                                        </linearGradient>
                                    </defs>
                                </svg>
                                <span className='af2__ring-pct'>{hourProgressPct.toFixed(0)}%</span>
                            </div>
                            <span className='af2__hour-target'>Target: +${hourTPAmt.toFixed(2)}</span>
                        </div>
                    </div>

                    {/* Row 3: Chart */}
                    <div className='af2__glass af2__chart-card'>
                        <div className='af2__chart-header'>
                            <span><BarChart3 size={14} /> Live Digit Stream — {MARKETS.find(m => m.symbol === selectedSymbol)?.label} (Last {CHART_DIGITS} ticks)</span>
                            {analysis && (
                                <div className='af2__chart-badges'>
                                    <span className='af2__cb af2__cb--under'>U[{analysis.mid.highestUnderDigit}] × {analysis.mid.highestUnderPct.toFixed(0)}%</span>
                                    <span className='af2__cb af2__cb--over'>O[{analysis.mid.highestOverDigit}] × {analysis.mid.highestOverPct.toFixed(0)}%</span>
                                </div>
                            )}
                        </div>
                        <DigitChart digits={activeData?.digits || []} />
                    </div>

                    {/* Row 4: Stats + Signal Conditions */}
                    {analysis && (
                        <div className='af2__stats-row'>
                            {/* Parity bars */}
                            <div className='af2__glass af2__parity-card'>
                                <div className='af2__parity-head'><TrendingUp size={13} /> Statistical Analysis</div>
                                <div className='af2__parity-block'>
                                    <div className='af2__parity-label'>
                                        <span>Under (0–4) vs Over (5–9)</span>
                                        <span className={analysis.mid.pctUnder04 >= 50 ? 'af2__parity-edge af2__parity-edge--u' : 'af2__parity-edge af2__parity-edge--o'}>
                                            {analysis.mid.pctUnder04 >= 50 ? `U +${analysis.mid.pctUnder04.toFixed(0)}%` : `O +${analysis.mid.pctOver59.toFixed(0)}%`}
                                        </span>
                                    </div>
                                    <div className='af2__split-bar'>
                                        <div className='af2__split-u' style={{ width: `${analysis.mid.pctUnder04}%` }} />
                                        <div className='af2__split-o' style={{ width: `${analysis.mid.pctOver59}%` }} />
                                    </div>
                                    <div className='af2__split-foot'>
                                        <span>{analysis.mid.under04} Under</span>
                                        <span>{analysis.mid.over59} Over</span>
                                    </div>
                                </div>
                                <div className='af2__parity-block'>
                                    <div className='af2__parity-label'>
                                        <span>Extended (0–5) vs (4–9)</span>
                                        <span className={analysis.mid.pctUnder05 >= 50 ? 'af2__parity-edge af2__parity-edge--u' : 'af2__parity-edge af2__parity-edge--o'}>
                                            {analysis.mid.pctUnder05 >= 50 ? `U +${analysis.mid.pctUnder05.toFixed(0)}%` : `O +${analysis.mid.pctOver49.toFixed(0)}%`}
                                        </span>
                                    </div>
                                    <div className='af2__split-bar'>
                                        <div className='af2__split-u' style={{ width: `${analysis.mid.pctUnder05}%` }} />
                                        <div className='af2__split-o' style={{ width: `${analysis.mid.pctOver49}%` }} />
                                    </div>
                                    <div className='af2__split-foot'>
                                        <span>{analysis.mid.under05} U (0-5)</span>
                                        <span>{analysis.mid.over49} O (4-9)</span>
                                    </div>
                                </div>
                                {/* Last 10 digit pills */}
                                <div className='af2__micro-row'>
                                    <span className='af2__micro-label'>Last 10 ticks:</span>
                                    {(activeData?.digits.slice(-10) ?? []).map((d, i) => (
                                        <span key={i} className={`af2__digit-pill ${d <= 4 ? 'af2__digit-pill--u' : 'af2__digit-pill--o'}`}>{d}</span>
                                    ))}
                                </div>
                            </div>

                            {/* Signal conditions checklist */}
                            <div className='af2__glass af2__conditions-card'>
                                <div className='af2__cond-head'><Shield size={13} /> Signal Conditions ({signal ? signal.direction : '—'})</div>
                                {signal ? (
                                    <div className='af2__cond-list'>
                                        {[
                                            { k: 'macroCondition',   label: 'Macro 1000t Dominance' },
                                            { k: 'stat1Condition',   label: 'Stat1: 50t ≥55% Edge' },
                                            { k: 'stat2Condition',   label: 'Stat2: Count Dominance' },
                                            { k: 'micro10Condition', label: 'Micro: 7/10 Recent Ticks' },
                                            { k: 'cycleCondition',   label: '15t Cycle Stable' },
                                            { k: 'triggerDigitCondition', label: `Trigger Digit [${signal.triggerDigit}] Hit` },
                                        ].map(({ k, label }) => {
                                            const ok = signal.conditions[k as keyof typeof signal.conditions];
                                            return (
                                                <div key={k} className={`af2__cond-item ${ok ? 'af2__cond-item--ok' : 'af2__cond-item--fail'}`}>
                                                    {ok ? <CheckCircle2 size={12} /> : <AlertTriangle size={12} />}
                                                    <span>{label}</span>
                                                </div>
                                            );
                                        })}
                                        <div className='af2__cond-quality'>
                                            <span>Quality Score</span>
                                            <div className='af2__qs-bar-track'>
                                                <div className='af2__qs-bar-fill' style={{ width: `${signal.qualityScore}%`, background: signal.qualityScore >= 70 ? '#22c55e' : signal.qualityScore >= 50 ? '#f59e0b' : '#ef4444' }} />
                                            </div>
                                            <strong>{signal.qualityScore}/100</strong>
                                        </div>
                                    </div>
                                ) : (
                                    <div className='af2__cond-empty'>Collecting market data…</div>
                                )}
                            </div>
                        </div>
                    )}

                    {/* Row 5: Controls + Compounding Progress */}
                    <div className='af2__control-row'>
                        {/* Left: Config panel */}
                        <div className='af2__glass af2__config-card'>
                            <div className='af2__config-title'><Layers size={14} /> Engine Configuration</div>

                            <div className='af2__inputs-grid'>
                                <div className='af2__input-group'>
                                    <label>Start Balance ({currency})</label>
                                    <input type='number' min='5' step='5' value={startBalance} onChange={e => setStartBalance(e.target.value)} disabled={isRunning} />
                                </div>
                                <div className='af2__input-group'>
                                    <label>Target Balance ({currency})</label>
                                    <input type='number' min='10' step='100' value={targetBalance} onChange={e => setTargetBalance(e.target.value)} disabled={isRunning} />
                                </div>
                                <div className='af2__input-group'>
                                    <label>Stop Loss ({currency})</label>
                                    <input type='number' min='1' step='1' value={stopLoss} onChange={e => setStopLoss(e.target.value)} disabled={isRunning} />
                                </div>
                                <div className='af2__input-group'>
                                    <label>Martingale ×</label>
                                    <input type='number' min='1.1' max='5' step='0.1' value={martingale} onChange={e => setMartingale(e.target.value)} disabled={isRunning} />
                                </div>
                                <div className='af2__input-group'>
                                    <label>Trade Duration (ticks)</label>
                                    <input type='number' min='1' max='10' step='1' value={tickDuration} onChange={e => setTickDuration(e.target.value)} disabled={isRunning} />
                                </div>
                                <div className='af2__input-group'>
                                    <label>Active Market</label>
                                    <select value={selectedSymbol} onChange={e => switchSelectedSymbol(e.target.value)} disabled={isRunning}>
                                        {MARKETS.map(m => <option key={m.symbol} value={m.symbol}>{m.label} ({m.symbol})</option>)}
                                    </select>
                                </div>
                            </div>

                            {/* Stake formula info */}
                            {schedule.length > 0 && curStage && (
                                <div className='af2__stake-info'>
                                    <span>Hour {currentHour} Stake = ${curStage.hourTP.toFixed(2)} ÷ {STAKE_DIVISOR} = <strong>${curStage.stake.toFixed(2)}</strong></span>
                                </div>
                            )}

                            {/* Buttons */}
                            <div className='af2__btn-row'>
                                {autoState === 'IDLE' ? (
                                    <button className='af2__btn af2__btn--start' onClick={startAutoTrading}>
                                        <Play size={16} fill='currentColor' /> START ENGINE
                                    </button>
                                ) : (
                                    <>
                                        <button className='af2__btn af2__btn--pause' onClick={autoState === 'PAUSED' ? resumeBot : pauseBot}>
                                            {autoState === 'PAUSED' ? <Play size={15} /> : <Pause size={15} />}
                                            {autoState === 'PAUSED' ? 'RESUME' : 'PAUSE'}
                                        </button>
                                        <button className='af2__btn af2__btn--stop' onClick={stopBot}>
                                            <Square size={15} /> STOP
                                        </button>
                                    </>
                                )}
                            </div>
                        </div>

                        {/* Right: Compounding progress */}
                        <div className='af2__glass af2__progress-card'>
                            <div className='af2__progress-title'>
                                <Target size={14} /> 45-Hour Compounding Progress
                                <button className='af2__sched-toggle' onClick={() => setShowSchedule(s => !s)}>
                                    {showSchedule ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                                    {showSchedule ? 'Hide' : 'Schedule'}
                                </button>
                            </div>

                            <div className='af2__prog-overall'>
                                <div className='af2__prog-meta'>
                                    <span>${parseFloat(startBalance).toFixed(0)} → ${parseFloat(targetBalance).toFixed(0)}</span>
                                    <span>{totalProgressPct.toFixed(1)}% Complete</span>
                                </div>
                                <div className='af2__prog-bar'>
                                    <div className='af2__prog-fill' style={{ width: `${totalProgressPct}%` }} />
                                </div>
                            </div>

                            <div className='af2__prog-metrics'>
                                <div className='af2__prog-metric'>
                                    <span>Hour {currentHour} Target</span>
                                    <strong>+${hourTPAmt.toFixed(2)}</strong>
                                </div>
                                <div className='af2__prog-metric'>
                                    <span>Hour Progress</span>
                                    <strong className={hourProfit >= 0 ? 'af2__stat-val--profit' : 'af2__stat-val--loss'}>+${hourProfit.toFixed(2)}</strong>
                                </div>
                                <div className='af2__prog-metric'>
                                    <span>Total P/L</span>
                                    <strong className={totalProfit >= 0 ? 'af2__stat-val--profit' : 'af2__stat-val--loss'}>{totalProfit >= 0 ? '+' : ''}${totalProfit.toFixed(2)}</strong>
                                </div>
                                <div className='af2__prog-metric'>
                                    <span>Remaining</span>
                                    <strong>{FLIP_HOURS - currentHour + 1}h left</strong>
                                </div>
                            </div>

                            {/* Horizontal hour mini-track */}
                            <div className='af2__hour-track'>
                                {Array.from({ length: FLIP_HOURS }, (_, i) => {
                                    const h = i + 1;
                                    const done = h < currentHour;
                                    const active = h === currentHour;
                                    return (
                                        <div key={h} className={`af2__hour-dot ${done ? 'af2__hour-dot--done' : active ? 'af2__hour-dot--active' : ''}`} title={`Hour ${h}: $${schedule[i]?.stake.toFixed(2) ?? '—'} stake`} />
                                    );
                                })}
                            </div>

                            {/* Collapsible schedule table */}
                            {showSchedule && (
                                <div className='af2__sched-table-wrap'>
                                    <table className='af2__sched-table'>
                                        <thead>
                                            <tr>
                                                <th>Hr</th>
                                                <th>Start $</th>
                                                <th>Hour TP</th>
                                                <th>Stake (÷8)</th>
                                                <th>End $</th>
                                                <th>Status</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {scheduleWithStatus.map(s => (
                                                <tr key={s.hour} className={`af2__sched-row af2__sched-row--${s.status.toLowerCase()}`}>
                                                    <td>{s.hour}</td>
                                                    <td>${s.startBalance.toFixed(2)}</td>
                                                    <td className='af2__sched-tp'>+${s.hourTP.toFixed(2)}</td>
                                                    <td className='af2__sched-stake'>${s.stake.toFixed(2)}</td>
                                                    <td>${s.endBalance.toFixed(2)}</td>
                                                    <td>
                                                        <span className={`af2__sched-badge af2__sched-badge--${s.status.toLowerCase()}`}>
                                                            {s.status === 'DONE' && '✓'}
                                                            {s.status === 'ACTIVE' && '⚡'}
                                                            {s.status === 'PENDING' && '○'}
                                                        </span>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Row 6: Trade Logs */}
                    <div className='af2__glass af2__logs-card'>
                        <div className='af2__logs-header'>
                            <div className='af2__logs-tabs'>
                                <button className={`af2__tab ${activeTab === 'TRADES' ? 'af2__tab--active' : ''}`} onClick={() => setActiveTab('TRADES')}>
                                    <BookOpen size={13} /> Trades ({txns.length})
                                </button>
                                <button className={`af2__tab ${activeTab === 'JOURNAL' ? 'af2__tab--active' : ''}`} onClick={() => setActiveTab('JOURNAL')}>
                                    <Activity size={13} /> Journal ({tradeLogs.length})
                                </button>
                            </div>
                            {(txns.length > 0 || tradeLogs.length > 0) && (
                                <button className='af2__clear-btn' onClick={() => { setTxns([]); setTradeLogs([]); }} type='button'>Clear</button>
                            )}
                        </div>

                        {activeTab === 'TRADES' ? (
                            <div className='af2__txn-wrap'>
                                {txns.length === 0 ? (
                                    <div className='af2__logs-empty'><BookOpen size={28} /><span>No trades yet. Start the engine to post live trades.</span></div>
                                ) : (
                                    <table className='af2__txn-table'>
                                        <thead>
                                            <tr><th>Time</th><th>ID</th><th>Market</th><th>Type</th><th>Entry → Exit</th><th>Stake</th><th>Profit</th><th>Result</th></tr>
                                        </thead>
                                        <tbody>
                                            {txns.map(t => (
                                                <tr key={t.id} className={`af2__txn-row af2__txn-row--${t.result.toLowerCase()}`}>
                                                    <td>{t.time}</td>
                                                    <td className='af2__txn-id'>{t.contractId ? `#${String(t.contractId).slice(-6)}` : '—'}</td>
                                                    <td>{t.market}</td>
                                                    <td><span className={`af2__type-badge af2__type-badge--${t.contractType.toLowerCase().includes('under') ? 'under' : 'over'}`}>{t.contractType}</span></td>
                                                    <td>{t.result === 'OPEN' ? <span className='af2__open-label'>Running…</span> : <span>{t.entrySpot} → <strong>{t.exitSpot}</strong></span>}</td>
                                                    <td>${t.stake.toFixed(2)}</td>
                                                    <td className={`af2__profit-cell ${t.result === 'WIN' ? 'af2__profit-cell--win' : t.result === 'LOSS' ? 'af2__profit-cell--loss' : ''}`}>
                                                        {t.result === 'OPEN' ? '—' : t.result === 'WIN' ? `+$${t.profit.toFixed(2)}` : `-$${Math.abs(t.profit).toFixed(2)}`}
                                                    </td>
                                                    <td><span className={`af2__result-pill af2__result-pill--${t.result.toLowerCase()}`}>{t.result === 'WIN' ? '✓ WIN' : t.result === 'LOSS' ? '✗ LOSS' : '● OPEN'}</span></td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                )}
                            </div>
                        ) : (
                            <div className='af2__journal-wrap'>
                                {tradeLogs.length === 0 ? (
                                    <div className='af2__logs-empty'><Activity size={28} /><span>Engine log idle. Events will appear here when trading.</span></div>
                                ) : (
                                    <div className='af2__journal-list'>
                                        {tradeLogs.map(log => (
                                            <div key={log.id} className={`af2__journal-item af2__journal-item--${log.result.toLowerCase()}`}>
                                                <div className='af2__journal-left'>
                                                    <span className='af2__journal-type'>{log.type}</span>
                                                    <span className='af2__journal-market'>{log.market}</span>
                                                </div>
                                                <div className='af2__journal-center'>
                                                    <span className='af2__journal-details'>{log.details}</span>
                                                </div>
                                                <div className='af2__journal-right'>
                                                    <span className={`af2__journal-profit ${log.profit > 0 ? 'win' : log.profit < 0 ? 'loss' : ''}`}>
                                                        {log.profit > 0 ? `+$${log.profit.toFixed(2)}` : log.profit < 0 ? `-$${Math.abs(log.profit).toFixed(2)}` : ''}
                                                    </span>
                                                    <span className='af2__journal-time'>{log.time}</span>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        )}
                    </div>

                </main>
            </div>

            <TradingMilestoneModal isOpen={milestone.isOpen} type={milestone.type} amount={totalProfit} currency={currency} botName='AutoFlipper Elite' onClose={() => setMilestone({ isOpen: false, type: null })} />
            <AiLearningHubModal isOpen={isAiOpen} onClose={() => setIsAiOpen(false)} />
        </div>
    );
});

export default Autoflipper;
