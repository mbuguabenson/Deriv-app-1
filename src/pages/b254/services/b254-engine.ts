import {
    B254ConditionChecklist,
    B254SignalResult,
    CompoundingProgress,
    DigitPowerItem,
    HorizonStats,
    MultiHorizonBreakdown,
    RegimeAssessment,
    SignalScoreBreakdown,
    StrategyDirection,
    TargetStrategyChoice,
} from '../types/b254.types';

// ─── Multi-Horizon Market Breakdown Engine ─────────────────────────────────────

function computeSingleHorizon(slice: number[]): HorizonStats {
    const total = slice.length || 1;
    const under04 = slice.filter(d => d >= 0 && d <= 4).length;
    const over59 = slice.filter(d => d >= 5 && d <= 9).length;
    const pctUnder04 = (under04 / total) * 100;
    const pctOver59 = (over59 / total) * 100;

    const under05 = slice.filter(d => d >= 0 && d <= 5).length;
    const over49 = slice.filter(d => d >= 4 && d <= 9).length;
    const pctUnder05 = (under05 / total) * 100;
    const pctOver49 = (over49 / total) * 100;

    let bias: HorizonStats['bias'] = 'BALANCED';
    if (pctUnder05 >= 57 && under05 > over49) {
        bias = 'UNDER';
    } else if (pctOver49 >= 57 && over49 > under05) {
        bias = 'OVER';
    } else if (pctUnder05 >= 53) {
        bias = 'UNDER';
    } else if (pctOver49 >= 53) {
        bias = 'OVER';
    }

    return {
        total,
        under04,
        over59,
        pctUnder04,
        pctOver59,
        under05,
        over49,
        pctUnder05,
        pctOver49,
        bias,
    };
}

export function computeMultiHorizon(digits: number[]): MultiHorizonBreakdown {
    const h15 = computeSingleHorizon(digits.slice(-15));
    const h30 = computeSingleHorizon(digits.slice(-30));
    const h50 = computeSingleHorizon(digits.slice(-50));
    const h100 = computeSingleHorizon(digits.slice(-100));
    const h500 = computeSingleHorizon(digits.slice(-500));
    const h1000 = computeSingleHorizon(digits.slice(-1000));

    // 30-Minute Proxy (derived from longer 500-1000 tick horizon)
    const slice30m = digits.slice(-600);
    const total30m = slice30m.length || 1;
    const u30m = slice30m.filter(d => d <= 5).length;
    const pctU30m = (u30m / total30m) * 100;
    const pctO30m = 100 - pctU30m;
    const bias30m = pctU30m >= 54 ? 'UNDER' : pctO30m >= 54 ? 'OVER' : 'NEUTRAL';

    // 1-Hour Proxy (derived from full 1,000 tick horizon)
    const total1h = digits.length || 1;
    const u1h = digits.filter(d => d <= 5).length;
    const pctU1h = (u1h / total1h) * 100;
    const pctO1h = 100 - pctU1h;
    const bias1h = pctU1h >= 54 ? 'UNDER' : pctO1h >= 54 ? 'OVER' : 'NEUTRAL';

    return {
        h15,
        h30,
        h50,
        h100,
        h500,
        h1000,
        history30m: {
            pctUnder: pctU30m,
            pctOver: pctO30m,
            bias: bias30m,
            isAlignedWith50t: (h50.bias === 'UNDER' && bias30m === 'UNDER') || (h50.bias === 'OVER' && bias30m === 'OVER'),
        },
        history1h: {
            pctUnder: pctU1h,
            pctOver: pctO1h,
            bias: bias1h,
            isAlignedWith50t: (h50.bias === 'UNDER' && bias1h === 'UNDER') || (h50.bias === 'OVER' && bias1h === 'OVER'),
        },
    };
}

// ─── Digit Power Matrix (0 – 9) ────────────────────────────────────────────────

export function computeDigitPower(digits: number[]): {
    items: DigitPowerItem[];
    mostAppearing: number;
    secondMostAppearing: number;
    leastAppearing: number;
    outliersUnder6Safe: boolean;
    outliersOver3Safe: boolean;
} {
    const slice1000 = digits.slice(-1000);
    const total1000 = slice1000.length || 1;
    const slice50 = digits.slice(-50);
    const total50 = slice50.length || 1;

    const freq1000 = new Array(10).fill(0);
    slice1000.forEach(d => {
        if (d >= 0 && d <= 9) freq1000[d]++;
    });

    const freq50 = new Array(10).fill(0);
    slice50.forEach(d => {
        if (d >= 0 && d <= 9) freq50[d]++;
    });

    // Momentum comparison: 1st half of 1000 vs 2nd half of 1000
    const half1 = slice1000.slice(0, Math.floor(total1000 / 2));
    const half2 = slice1000.slice(Math.floor(total1000 / 2));
    const getHalfPct = (arr: number[], digit: number) => {
        const count = arr.filter(d => d === digit).length;
        return (count / (arr.length || 1)) * 100;
    };

    const items: DigitPowerItem[] = [];
    for (let d = 0; d <= 9; d++) {
        const count1000 = freq1000[d];
        const pct1000 = (count1000 / total1000) * 100;
        const count50 = freq50[d];
        const pct50 = (count50 / total50) * 100;

        const h1 = getHalfPct(half1, d);
        const h2 = getHalfPct(half2, d);
        let trend: DigitPowerItem['trend'] = 'STABLE';
        if (h2 > h1 + 0.6) trend = 'INCREASING';
        else if (h2 < h1 - 0.6) trend = 'DECREASING';

        const strength = Math.min(100, Math.round((pct50 * 0.6 + pct1000 * 0.4) * 5));

        items.push({
            digit: d,
            count1000,
            pct1000,
            count50,
            pct50,
            trend,
            strength,
            isOutlierSafeUnder: d >= 7 ? pct1000 < 10.0 && trend !== 'INCREASING' : true,
            isOutlierSafeOver: d <= 2 ? pct1000 < 10.0 && trend !== 'INCREASING' : true,
        });
    }

    // Rank sorting
    const sorted = [...items].sort((a, b) => b.pct1000 - a.pct1000);
    const mostAppearing = sorted[0]?.digit ?? 0;
    const secondMostAppearing = sorted[1]?.digit ?? 1;
    const leastAppearing = sorted[sorted.length - 1]?.digit ?? 9;

    // Outlier safety filters
    const outliersUnder6Safe =
        (items[7]?.pct1000 || 0) < 10.0 &&
        (items[8]?.pct1000 || 0) < 10.0 &&
        (items[9]?.pct1000 || 0) < 10.0 &&
        items[7]?.trend !== 'INCREASING' &&
        items[8]?.trend !== 'INCREASING' &&
        items[9]?.trend !== 'INCREASING';

    const outliersOver3Safe =
        (items[0]?.pct1000 || 0) < 10.0 &&
        (items[1]?.pct1000 || 0) < 10.0 &&
        (items[2]?.pct1000 || 0) < 10.0 &&
        items[0]?.trend !== 'INCREASING' &&
        items[1]?.trend !== 'INCREASING' &&
        items[2]?.trend !== 'INCREASING';

    return {
        items,
        mostAppearing,
        secondMostAppearing,
        leastAppearing,
        outliersUnder6Safe,
        outliersOver3Safe,
    };
}

// ─── Regime Shift Detection (15 – 50 Ticks) ────────────────────────────────────

export function evaluateRegime(digits: number[]): RegimeAssessment {
    const slice15 = digits.slice(-15);
    const slice50 = digits.slice(-50);

    const u15 = slice15.filter(d => d <= 5).length;
    const o15 = slice15.filter(d => d >= 4).length;

    const u50 = slice50.filter(d => d <= 5).length;
    const o50 = slice50.filter(d => d >= 4).length;

    const currentRegime: RegimeAssessment['currentRegime'] =
        u15 >= 9 ? 'UNDER' : o15 >= 9 ? 'OVER' : 'NEUTRAL';

    const previousRegime: RegimeAssessment['previousRegime'] =
        u50 > o50 ? 'UNDER' : o50 > u50 ? 'OVER' : 'NEUTRAL';

    let shiftDetected = false;
    let shiftDirection: RegimeAssessment['shiftDirection'] = 'NONE';
    let recentShiftMessage: string | undefined;

    if (previousRegime === 'UNDER' && o15 >= 9) {
        shiftDetected = true;
        shiftDirection = 'FLIPPED_TO_OVER';
        recentShiftMessage = `⚠️ Counter-trend spike detected: Market flipped to Over (${o15}/15 Over digits).`;
    } else if (previousRegime === 'OVER' && u15 >= 9) {
        shiftDetected = true;
        shiftDirection = 'FLIPPED_TO_UNDER';
        recentShiftMessage = `⚠️ Counter-trend spike detected: Market flipped to Under (${u15}/15 Under digits).`;
    }

    const regimeStability: RegimeAssessment['regimeStability'] =
        shiftDetected ? 'UNSTABLE' : Math.abs(u15 - o15) >= 5 ? 'HIGH' : 'MODERATE';

    const shiftStrength = shiftDetected
        ? Math.min(100, Math.round((Math.max(u15, o15) / 15) * 100))
        : 0;

    return {
        currentRegime,
        previousRegime,
        regimeStability,
        shiftDetected,
        shiftDirection,
        shiftStrength,
        recentShiftMessage,
    };
}

// ─── 100-Point Transparent Signal Score Engine ─────────────────────────────────

export function computeSignalScore(
    multiHorizon: MultiHorizonBreakdown,
    digitPower: ReturnType<typeof computeDigitPower>,
    regime: RegimeAssessment,
    direction: StrategyDirection,
    currentLastDigit: number,
    entryDigit: number,
    threshold: number = 75
): SignalScoreBreakdown {
    const isUnder = direction === 'UNDER_6';
    const explanations: string[] = [];

    // 1. Historical market bias (Max 20)
    let historicalBiasScore = 0;
    if (isUnder && multiHorizon.h1000.pctUnder05 >= 58) {
        historicalBiasScore = 20;
        explanations.push('+20 Historical Under 6 Dominance (1,000 Ticks)');
    } else if (!isUnder && multiHorizon.h1000.pctOver49 >= 58) {
        historicalBiasScore = 20;
        explanations.push('+20 Historical Over 3 Dominance (1,000 Ticks)');
    } else if (isUnder && multiHorizon.h1000.pctUnder05 >= 53) {
        historicalBiasScore = 14;
        explanations.push('+14 Moderate Historical Under Bias');
    } else if (!isUnder && multiHorizon.h1000.pctOver49 >= 53) {
        historicalBiasScore = 14;
        explanations.push('+14 Moderate Historical Over Bias');
    }

    // 2. 30-Minute alignment (Max 10)
    let history30mScore = 0;
    if (isUnder && multiHorizon.history30m.bias === 'UNDER') {
        history30mScore = 10;
        explanations.push('+10 30-Minute Under Alignment');
    } else if (!isUnder && multiHorizon.history30m.bias === 'OVER') {
        history30mScore = 10;
        explanations.push('+10 30-Minute Over Alignment');
    }

    // 3. 1-Hour alignment (Max 10)
    let history1hScore = 0;
    if (isUnder && multiHorizon.history1h.bias === 'UNDER') {
        history1hScore = 10;
        explanations.push('+10 1-Hour Under Alignment');
    } else if (!isUnder && multiHorizon.history1h.bias === 'OVER') {
        history1hScore = 10;
        explanations.push('+10 1-Hour Over Alignment');
    }

    // 4. 50-Tick dominance (Max 15)
    let fiftyTickScore = 0;
    if (isUnder && multiHorizon.h50.pctUnder04 >= 55) {
        fiftyTickScore = 15;
        explanations.push(`+15 50-Tick Under 0-4 Dominance (${multiHorizon.h50.pctUnder04.toFixed(0)}%)`);
    } else if (!isUnder && multiHorizon.h50.pctOver59 >= 55) {
        fiftyTickScore = 15;
        explanations.push(`+15 50-Tick Over 5-9 Dominance (${multiHorizon.h50.pctOver59.toFixed(0)}%)`);
    } else if (isUnder && multiHorizon.h50.pctUnder05 >= 56) {
        fiftyTickScore = 10;
        explanations.push(`+10 50-Tick Under 0-5 Dominance (${multiHorizon.h50.pctUnder05.toFixed(0)}%)`);
    } else if (!isUnder && multiHorizon.h50.pctOver49 >= 56) {
        fiftyTickScore = 10;
        explanations.push(`+10 50-Tick Over 4-9 Dominance (${multiHorizon.h50.pctOver49.toFixed(0)}%)`);
    }

    // 5. 30-Tick regime stability (Max 10)
    let thirtyTickScore = 0;
    if (isUnder && multiHorizon.h30.bias === 'UNDER' && !regime.shiftDetected) {
        thirtyTickScore = 10;
        explanations.push('+10 30-Tick Stable Under Regime');
    } else if (!isUnder && multiHorizon.h30.bias === 'OVER' && !regime.shiftDetected) {
        thirtyTickScore = 10;
        explanations.push('+10 30-Tick Stable Over Regime');
    }

    // 6. 10-Tick micro ratio (Max 10)
    let tenTickScore = 0;
    const u10 = multiHorizon.h15.total ? multiHorizon.h15.under05 : 0;
    if (isUnder && u10 >= 7) {
        tenTickScore = 10;
        explanations.push(`+10 Micro 10-Tick Under Confirmation (${u10}/10)`);
    } else if (!isUnder && (10 - u10) >= 7) {
        tenTickScore = 10;
        explanations.push(`+10 Micro 10-Tick Over Confirmation (${10 - u10}/10)`);
    } else if (isUnder && u10 >= 6) {
        tenTickScore = 6;
        explanations.push(`+6 Micro 10-Tick Under Confirmation (${u10}/10)`);
    } else if (!isUnder && (10 - u10) >= 6) {
        tenTickScore = 6;
        explanations.push(`+6 Micro 10-Tick Over Confirmation (${10 - u10}/10)`);
    }

    // 7. 7-Tick continuation (Max 10)
    let sevenTickScore = 0;
    const u7 = Math.min(7, Math.round((multiHorizon.h15.under05 / 15) * 7));
    if (isUnder && u7 >= 5) {
        sevenTickScore = 10;
        explanations.push(`+10 Immediate 7-Tick Continuation (${u7}/7)`);
    } else if (!isUnder && (7 - u7) >= 5) {
        sevenTickScore = 10;
        explanations.push(`+10 Immediate 7-Tick Continuation (${7 - u7}/7)`);
    }

    // 8. 1,000-Tick Outlier Filter (Max 10)
    let outlierFilterScore = 0;
    if (isUnder && digitPower.outliersUnder6Safe) {
        outlierFilterScore = 10;
        explanations.push('+10 Outliers 7,8,9 Safe (<10% & non-increasing)');
    } else if (!isUnder && digitPower.outliersOver3Safe) {
        outlierFilterScore = 10;
        explanations.push('+10 Outliers 0,1,2 Safe (<10% & non-increasing)');
    }

    // 9. Entry Digit Match (Max 5)
    let entryDigitScore = 0;
    if (currentLastDigit === entryDigit) {
        entryDigitScore = 5;
        explanations.push(`+5 Live Tick Matched Dominant Entry Digit [${entryDigit}]`);
    }

    const totalScore =
        historicalBiasScore +
        history30mScore +
        history1hScore +
        fiftyTickScore +
        thirtyTickScore +
        tenTickScore +
        sevenTickScore +
        outlierFilterScore +
        entryDigitScore;

    return {
        totalScore,
        isPassedThreshold: totalScore >= threshold,
        threshold,
        components: {
            historicalBiasScore,
            history30mScore,
            history1hScore,
            fiftyTickScore,
            thirtyTickScore,
            tenTickScore,
            sevenTickScore,
            outlierFilterScore,
            entryDigitScore,
        },
        explanations,
    };
}

// ─── Master B254 Strategy & 8-Point Verification Engine ─────────────────────────

export function evaluateB254Signal(
    digits: number[],
    forcedDirection?: TargetStrategyChoice,
    scoreThreshold: number = 75
): B254SignalResult | null {
    if (digits.length < 15) return null;

    const currentLastDigit = digits[digits.length - 1];
    const multiHorizon = computeMultiHorizon(digits);
    const digitPower = computeDigitPower(digits);
    const regime = evaluateRegime(digits);

    // Determine Active Direction
    let direction: StrategyDirection;
    if (forcedDirection && forcedDirection !== 'AUTO') {
        direction = forcedDirection;
    } else {
        direction = multiHorizon.h50.under05 >= multiHorizon.h50.over49 ? 'UNDER_6' : 'OVER_3';
    }

    const isUnder = direction === 'UNDER_6';
    const prediction = isUnder ? 6 : 3;

    // Determine Strongest Dominant Qualifying Entry Digit
    let entryDigit: number;
    if (isUnder) {
        // Strongest qualifying digit below 6 (0-5) in last 50 ticks
        let maxCount = -1;
        let bestDigit = 0;
        digitPower.items.slice(0, 6).forEach(item => {
            if (item.count50 > maxCount) {
                maxCount = item.count50;
                bestDigit = item.digit;
            }
        });
        entryDigit = bestDigit;
    } else {
        // Strongest qualifying digit above 3 (4-9) in last 50 ticks
        let maxCount = -1;
        let bestDigit = 4;
        digitPower.items.slice(4, 10).forEach(item => {
            if (item.count50 > maxCount) {
                maxCount = item.count50;
                bestDigit = item.digit;
            }
        });
        entryDigit = bestDigit;
    }

    // Micro window checks
    const slice10 = digits.slice(-10);
    const last10Under = slice10.filter(d => d <= 5).length;
    const last10Over = slice10.filter(d => d >= 4).length;

    const slice7 = digits.slice(-7);
    const last7Under = slice7.filter(d => d <= 5).length;
    const last7Over = slice7.filter(d => d >= 4).length;

    // ── Evaluate 8 Systematic Conditions ──
    const cond0_historyAlignment = isUnder
        ? multiHorizon.history30m.bias !== 'OVER' && multiHorizon.history1h.bias !== 'OVER'
        : multiHorizon.history30m.bias !== 'UNDER' && multiHorizon.history1h.bias !== 'UNDER';

    const cond1_stat1_threshold55 = isUnder
        ? multiHorizon.h50.pctUnder04 >= 54
        : multiHorizon.h50.pctOver59 >= 54;

    const cond2_stat2_dominance = isUnder
        ? multiHorizon.h50.under05 > multiHorizon.h50.over49 && multiHorizon.h50.under05 >= 27
        : multiHorizon.h50.over49 > multiHorizon.h50.under05 && multiHorizon.h50.over49 >= 27;

    const cond3_micro10_ratio = isUnder ? last10Under >= 6 : last10Over >= 6;
    const cond4_micro7_continuation = isUnder ? last7Under >= 4 : last7Over >= 4;

    const cond5_outlierSafety = isUnder ? digitPower.outliersUnder6Safe : digitPower.outliersOver3Safe;

    const cond6_digitPowerSupport = isUnder
        ? digitPower.mostAppearing <= 5 || digitPower.secondMostAppearing <= 5
        : digitPower.mostAppearing >= 4 || digitPower.secondMostAppearing >= 4;

    const cond7_entryDigitMatch = currentLastDigit === entryDigit;
    const cycleStable = !regime.shiftDetected;

    const allConditionsPassed =
        cond0_historyAlignment &&
        cond1_stat1_threshold55 &&
        cond2_stat2_dominance &&
        cond3_micro10_ratio &&
        cond4_micro7_continuation &&
        cond5_outlierSafety &&
        cond6_digitPowerSupport &&
        cycleStable;

    const score = computeSignalScore(
        multiHorizon,
        digitPower,
        regime,
        direction,
        currentLastDigit,
        entryDigit,
        scoreThreshold
    );

    const isAutoPaused = regime.shiftDetected;
    const pauseReason = regime.shiftDetected
        ? regime.recentShiftMessage
        : undefined;

    // Why Not Trade Diagnostics
    const whyNotTradeReasons: string[] = [];
    if (!cond0_historyAlignment) whyNotTradeReasons.push('30-minute / 1-hour history opposes current direction');
    if (!cond1_stat1_threshold55) {
        whyNotTradeReasons.push(
            isUnder
                ? `Under 0-4 percentage is ${multiHorizon.h50.pctUnder04.toFixed(1)}% (below 55% threshold)`
                : `Over 5-9 percentage is ${multiHorizon.h50.pctOver59.toFixed(1)}% (below 55% threshold)`
        );
    }
    if (!cond2_stat2_dominance) whyNotTradeReasons.push('50-tick digit dominance not established');
    if (!cond3_micro10_ratio) {
        whyNotTradeReasons.push(
            `Last 10 ticks (${isUnder ? last10Under : last10Over}/10) fails 6/10 rule`
        );
    }
    if (!cond4_micro7_continuation) whyNotTradeReasons.push('Last 7 ticks reversed direction');
    if (!cond5_outlierSafety) whyNotTradeReasons.push('1,000-tick outlier safety threshold exceeded (>10% or rising)');
    if (!cond6_digitPowerSupport) whyNotTradeReasons.push('Top appearing digits do not align with strategy zone');
    if (regime.shiftDetected) whyNotTradeReasons.push('15-tick counter-trend regime shift active');
    if (!score.isPassedThreshold) whyNotTradeReasons.push(`Signal score (${score.totalScore}/100) below minimum threshold (${scoreThreshold})`);
    if (allConditionsPassed && score.isPassedThreshold && !cond7_entryDigitMatch) {
        whyNotTradeReasons.push(`All criteria satisfied — Waiting for entry digit [${entryDigit}] to appear on live tick`);
    }

    // Natural Language Market Explanation
    let marketExplanation = '';
    if (allConditionsPassed && score.isPassedThreshold) {
        marketExplanation = `Statistical bias heavily favours ${isUnder ? 'Under 6' : 'Over 3'} across multi-timeframe windows. Micro 10-tick (${isUnder ? last10Under : last10Over}/10) and 7-tick (${isUnder ? last7Under : last7Over}/7) momentum agree with macro history with low counter-outliers. Market is stable.`;
    } else if (regime.shiftDetected) {
        marketExplanation = `Market is in active transition. A counter-trend regime flip was detected in the last 15 ticks. System pauses trade execution to protect capital until equilibrium restores.`;
    } else {
        marketExplanation = `Market is currently consolidating (${multiHorizon.h50.under05} Under vs ${multiHorizon.h50.over49} Over in 50 ticks). Monitoring for verified directional breakout.`;
    }

    const checklist: B254ConditionChecklist = {
        cond0_historyAlignment,
        cond1_stat1_threshold55,
        cond2_stat2_dominance,
        cond3_micro10_ratio,
        cond4_micro7_continuation,
        cond5_outlierSafety,
        cond6_digitPowerSupport,
        cond7_entryDigitMatch,
        cycleStable,
        allConditionsPassed,
    };

    let status: B254SignalResult['status'] = 'WAITING';
    if (allConditionsPassed && score.isPassedThreshold && cond7_entryDigitMatch && !isAutoPaused) {
        status = 'TRIGGERED';
    } else if (allConditionsPassed && score.isPassedThreshold) {
        status = 'ENTRY_READY';
    }

    return {
        direction,
        prediction,
        entryDigit,
        score,
        checklist,
        status,
        isAutoPaused,
        pauseReason,
        whyNotTradeReasons,
        marketExplanation,
    };
}

// ─── Account Compounding Calculation Engine ────────────────────────────────────

export function calculateCompoundingPlan(
    startBalance: number,
    targetBalance: number,
    durationValue: number = 30,
    timeUnit: 'DAYS' | 'HOURS' | 'MINUTES' = 'DAYS',
    actualBalance: number = startBalance
): CompoundingProgress {
    const validStart = Math.max(0.5, startBalance);
    const validTarget = Math.max(validStart, targetBalance);
    const totalSteps = Math.max(1, durationValue || 30);

    const unitSingular = timeUnit === 'DAYS' ? 'Day' : timeUnit === 'HOURS' ? 'Hour' : 'Min';
    const unitLabel = timeUnit === 'DAYS' ? 'Daily' : timeUnit === 'HOURS' ? 'Hourly' : 'Minute';

    // Dynamic Compound Growth Rate formula: (Target / Start)^(1 / Steps) - 1
    const requiredStepGrowthRate = Math.pow(validTarget / validStart, 1 / totalSteps) - 1;
    const requiredStepGrowthPct = Number((requiredStepGrowthRate * 100).toFixed(2));

    const schedule: CompoundingProgress['schedule'] = [];
    let currentStepBal = validStart;
    let currentStep = 1;

    for (let i = 1; i <= totalSteps; i++) {
        const targetProfit = Number((currentStepBal * requiredStepGrowthRate).toFixed(2));
        const endBal = Number((currentStepBal + targetProfit).toFixed(2));
        const isCompleted = actualBalance >= endBal;

        if (isCompleted && i < totalSteps) {
            currentStep = i + 1;
        }

        schedule.push({
            step: i,
            stepLabel: `${unitSingular} ${i}`,
            startBal: currentStepBal,
            targetProfit,
            endBal,
            isCompleted,
        });

        currentStepBal = endBal;
    }

    const currentScheduleItem = schedule[currentStep - 1] || schedule[0];
    const stepTargetBalance = currentScheduleItem ? currentScheduleItem.endBal : validTarget;

    const differenceFromTarget = Number((actualBalance - stepTargetBalance).toFixed(2));
    const totalTargetProfit = validTarget - validStart;
    const currentActualProfit = Math.max(0, actualBalance - validStart);
    const progressPct = Math.min(100, Number(((currentActualProfit / (totalTargetProfit || 1)) * 100).toFixed(2)));

    const remainingTarget = Math.max(0, Number((validTarget - actualBalance).toFixed(2)));
    const remainingSteps = Math.max(1, totalSteps - currentStep + 1);
    const requiredFutureGrowthRate =
        actualBalance > 0 && remainingTarget > 0
            ? Math.pow(validTarget / actualBalance, 1 / remainingSteps) - 1
            : 0;
    const requiredFutureGrowthPct = Number((requiredFutureGrowthRate * 100).toFixed(2));

    return {
        requiredStepGrowthPct,
        stepTargetBalance,
        actualBalance,
        differenceFromTarget,
        progressPct,
        currentStep,
        totalSteps,
        timeUnit,
        unitLabel,
        remainingTarget,
        requiredFutureGrowthPct,
        schedule,
        // Backward-compatibility aliases
        requiredDailyGrowthPct: requiredStepGrowthPct,
        dailyTargetBalance: stepTargetBalance,
        currentTradingDay: currentStep,
    };
}
