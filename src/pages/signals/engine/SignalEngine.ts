export type DigitFrequency = {
    digit: number;
    count: number;
    percentage: number;
};

export type AnalysisResult = {
    digitFrequencies: DigitFrequency[];
    evenCount: number;
    oddCount: number;
    evenPercentage: number;
    oddPercentage: number;
    highCount: number;
    lowCount: number;
    highPercentage: number;
    lowPercentage: number;
    entropy: number;
    powerIndex: {
        strongest: number;
        weakest: number;
        gap: number;
    };
    missingDigits: number[];
    streaks: { digit: number; count: number }[];
    totalTicks: number;
};

export type SignalType =
    | 'even_odd'
    | 'over_under'
    | 'matches'
    | 'differs'
    | 'rise_fall'
    | 'pro_even_odd'
    | 'pro_over_under'
    | 'pro_differs'
    | 'under_7'
    | 'over_2';
export type SignalStatus = 'STRONG' | 'TRADE NOW' | 'WAIT' | 'NEUTRAL';

export type Signal = {
    type: SignalType;
    status: SignalStatus;
    probability: number;
    recommendation: string;
    entryCondition: string;
    targetDigit?: number;
};

export class SignalEngine {
    private ticks: number[] = [];
    private quotes: number[] = [];
    private readonly MAX_TICKS = 100;

    public addTick(quote: number | string) {
        const num = typeof quote === 'number' ? quote : parseFloat(String(quote));
        if (isNaN(num)) return;

        const s = String(quote).trim();
        const digit = parseInt(s.slice(-1), 10);
        if (isNaN(digit)) return;

        this.quotes.push(num);
        this.ticks.push(digit);

        if (this.ticks.length > this.MAX_TICKS) {
            this.ticks.shift();
            this.quotes.shift();
        }
    }

    public analyze(): AnalysisResult | null {
        if (this.ticks.length === 0) return null;

        const counts = new Array(10).fill(0);
        this.ticks.forEach(t => counts[t]++);

        const total = this.ticks.length;
        const digitFrequencies: DigitFrequency[] = counts.map((count, digit) => ({
            digit,
            count,
            percentage: (count / total) * 100,
        }));

        let evenCount = 0;
        let oddCount = 0;
        let highCount = 0;
        let lowCount = 0;
        const missingDigits: number[] = [];

        digitFrequencies.forEach(f => {
            if (f.digit % 2 === 0) evenCount += f.count;
            else oddCount += f.count;

            if (f.digit >= 5) highCount += f.count;
            else lowCount += f.count;

            if (f.count === 0) missingDigits.push(f.digit);
        });

        let entropy = 0;
        digitFrequencies.forEach(f => {
            const p = f.count / total;
            if (p > 0) {
                entropy -= p * Math.log2(p);
            }
        });

        let strongest = 0;
        let weakest = 0;
        for (let i = 1; i < 10; i++) {
            if (digitFrequencies[i].count > digitFrequencies[strongest].count) strongest = i;
            if (digitFrequencies[i].count < digitFrequencies[weakest].count) weakest = i;
        }

        const gap = digitFrequencies[strongest].percentage - digitFrequencies[weakest].percentage;

        const streaks: { digit: number; count: number }[] = [];
        let currentStreakDigit = this.ticks[0];
        let currentStreakCount = 1;

        for (let i = 1; i < this.ticks.length; i++) {
            if (this.ticks[i] === currentStreakDigit) {
                currentStreakCount++;
            } else {
                if (currentStreakCount >= 2) {
                    streaks.push({ digit: currentStreakDigit, count: currentStreakCount });
                }
                currentStreakDigit = this.ticks[i];
                currentStreakCount = 1;
            }
        }
        if (currentStreakCount >= 2) {
            streaks.push({ digit: currentStreakDigit, count: currentStreakCount });
        }

        return {
            digitFrequencies,
            evenCount,
            oddCount,
            evenPercentage: (evenCount / total) * 100,
            oddPercentage: (oddCount / total) * 100,
            highCount,
            lowCount,
            highPercentage: (highCount / total) * 100,
            lowPercentage: (lowCount / total) * 100,
            entropy,
            powerIndex: {
                strongest,
                weakest,
                gap,
            },
            missingDigits,
            streaks,
            totalTicks: total,
        };
    }

    public generateStandardSignals(analysis: AnalysisResult): Signal[] {
        const signals: Signal[] = [];

        const maxEvenOdd = Math.max(analysis.evenPercentage, analysis.oddPercentage);
        const isEvenFavored = analysis.evenPercentage > analysis.oddPercentage;
        if (maxEvenOdd >= 60) {
            signals.push({
                type: 'even_odd',
                status: 'TRADE NOW',
                probability: maxEvenOdd,
                recommendation: `Strong ${isEvenFavored ? 'even' : 'odd'} bias detected`,
                entryCondition: `Wait for 2+ consecutive ${isEvenFavored ? 'odd' : 'even'}s, then trade ${isEvenFavored ? 'EVEN' : 'ODD'}`,
            });
        } else if (maxEvenOdd >= 55) {
            signals.push({
                type: 'even_odd',
                status: 'WAIT',
                probability: maxEvenOdd,
                recommendation: 'Moderate bias',
                entryCondition: 'Monitor for stronger signal',
            });
        }

        const maxHighLow = Math.max(analysis.highPercentage, analysis.lowPercentage);
        const isHighFavored = analysis.highPercentage > analysis.lowPercentage;
        if (maxHighLow >= 62 && analysis.powerIndex.gap >= 15) {
            signals.push({
                type: 'over_under',
                status: 'TRADE NOW',
                probability: maxHighLow,
                recommendation: `Strong ${isHighFavored ? 'high' : 'low'} bias. Power gap ${analysis.powerIndex.gap.toFixed(1)}%`,
                entryCondition: `Trade ${isHighFavored ? 'OVER' : 'UNDER'} when digit ${analysis.powerIndex.strongest} appears`,
                targetDigit: analysis.powerIndex.strongest,
            });
        } else if (maxHighLow >= 58) {
            signals.push({
                type: 'over_under',
                status: 'WAIT',
                probability: maxHighLow,
                recommendation: 'Moderate bias',
                entryCondition: 'Wait for power gap to increase',
            });
        }

        const strongestPercent = analysis.digitFrequencies[analysis.powerIndex.strongest].percentage;
        if (strongestPercent >= 15) {
            signals.push({
                type: 'matches',
                status: 'TRADE NOW',
                probability: strongestPercent * 3.3,
                recommendation: `Digit ${analysis.powerIndex.strongest} has strong power at ${strongestPercent.toFixed(1)}%`,
                entryCondition: `Trade immediately when digit ${analysis.powerIndex.strongest} appears`,
                targetDigit: analysis.powerIndex.strongest,
            });
        } else if (strongestPercent >= 12) {
            signals.push({
                type: 'matches',
                status: 'WAIT',
                probability: strongestPercent * 3.3,
                recommendation: `Digit ${analysis.powerIndex.strongest} showing moderate frequency`,
                entryCondition: `Wait for frequency to increase`,
                targetDigit: analysis.powerIndex.strongest,
            });
        }

        const weakestPercent = analysis.digitFrequencies[analysis.powerIndex.weakest].percentage;
        if (weakestPercent < 9) {
            signals.push({
                type: 'differs',
                status: 'TRADE NOW',
                probability: 100 - weakestPercent,
                recommendation: `Digit ${analysis.powerIndex.weakest} appears only ${weakestPercent.toFixed(1)}%`,
                entryCondition: `Wait for ${analysis.powerIndex.weakest} to appear, then trade DIFFERS`,
                targetDigit: analysis.powerIndex.weakest,
            });
        }

        if (this.quotes.length >= 10) {
            const last10 = this.quotes.slice(-10);
            const trend = last10[9] - last10[0];
            const direction = trend > 0 ? 'RISE' : 'FALL';
            const confidence = Math.min(60 + Math.abs(trend) * 100, 75);

            if (confidence >= 60) {
                signals.push({
                    type: 'rise_fall',
                    status: 'TRADE NOW',
                    probability: confidence,
                    recommendation: `${direction} trend detected with ${confidence.toFixed(1)}% confidence`,
                    entryCondition: `Trade in detected direction`,
                });
            }
        }

        return signals;
    }

    public generateProSignals(analysis: AnalysisResult): Signal[] {
        const signals: Signal[] = [];
        const last20 = this.ticks.slice(-20);

        const evenDigitsAbove11 = analysis.digitFrequencies.filter(f => f.digit % 2 === 0 && f.percentage >= 11);
        const evenInLast20 = last20.filter(d => d % 2 === 0).length;
        if (
            analysis.evenPercentage >= 55 &&
            evenDigitsAbove11.length >= 2 &&
            analysis.powerIndex.strongest % 2 === 0 &&
            evenInLast20 >= 11
        ) {
            let consecOdds = 0;
            for (let i = this.ticks.length - 1; i >= 0; i--) {
                if (this.ticks[i] % 2 !== 0) consecOdds++;
                else break;
            }

            if (consecOdds >= 3) {
                signals.push({
                    type: 'pro_even_odd',
                    status: 'TRADE NOW',
                    probability: Math.min(analysis.evenPercentage + 15, 99),
                    recommendation: `EVEN STRATEGY: ${consecOdds} consecutive odds detected - Enter EVEN now!`,
                    entryCondition: 'Enter EVEN immediately after first even digit appears',
                });
            } else {
                signals.push({
                    type: 'pro_even_odd',
                    status: 'WAIT',
                    probability: analysis.evenPercentage + 5,
                    recommendation: 'EVEN conditions met - Waiting for 3+ consecutive ODD digits',
                    entryCondition: 'Wait for 3+ consecutive ODD digits, then enter EVEN',
                });
            }
        }

        const oddDigitsAbove11 = analysis.digitFrequencies.filter(f => f.digit % 2 !== 0 && f.percentage >= 11);
        const oddInLast20 = last20.filter(d => d % 2 !== 0).length;
        if (
            analysis.oddPercentage >= 70 &&
            oddDigitsAbove11.length >= 2 &&
            analysis.powerIndex.strongest % 2 !== 0 &&
            oddInLast20 >= 14
        ) {
            let consecEvens = 0;
            for (let i = this.ticks.length - 1; i >= 0; i--) {
                if (this.ticks[i] % 2 === 0) consecEvens++;
                else break;
            }

            if (consecEvens >= 3) {
                signals.push({
                    type: 'pro_even_odd',
                    status: 'TRADE NOW',
                    probability: Math.min(analysis.oddPercentage + 10, 99),
                    recommendation: `ODD STRATEGY: ${consecEvens} consecutive evens detected - Enter ODD now!`,
                    entryCondition: 'Enter ODD immediately after first odd digit appears',
                });
            } else {
                signals.push({
                    type: 'pro_even_odd',
                    status: 'WAIT',
                    probability: analysis.oddPercentage,
                    recommendation: 'ODD conditions met - Waiting for 3+ consecutive EVEN digits',
                    entryCondition: 'Wait for 3+ consecutive EVEN digits, then enter ODD',
                });
            }
        }

        const over1DigitsAbove11 = analysis.digitFrequencies.filter(f => f.digit >= 2 && f.percentage >= 11);
        if (
            analysis.digitFrequencies[0].percentage < 10 &&
            analysis.digitFrequencies[1].percentage < 10 &&
            over1DigitsAbove11.length >= 3 &&
            analysis.highPercentage >= 90
        ) {
            if (analysis.powerIndex.weakest === 0 || analysis.powerIndex.weakest === 1) {
                const over1InLast20 = last20.filter(d => d > 1).length;
                if (over1InLast20 >= 18) {
                    signals.push({
                        type: 'pro_over_under',
                        status: 'TRADE NOW',
                        probability: analysis.highPercentage,
                        recommendation: 'OVER 1 STRATEGY: Strong signal - 90%+ win rate detected!',
                        entryCondition: 'Wait for 1+ UNDER digits, then enter OVER 1 immediately',
                    });
                }
            }
        }

        const under8DigitsAbove11 = analysis.digitFrequencies.filter(f => f.digit <= 7 && f.percentage >= 11);
        if (
            analysis.digitFrequencies[8].percentage < 10 &&
            analysis.digitFrequencies[9].percentage < 10 &&
            under8DigitsAbove11.length >= 3 &&
            analysis.lowPercentage >= 90
        ) {
            if (analysis.powerIndex.weakest === 8 || analysis.powerIndex.weakest === 9) {
                const under8InLast20 = last20.filter(d => d < 8).length;
                if (under8InLast20 >= 18) {
                    signals.push({
                        type: 'pro_over_under',
                        status: 'TRADE NOW',
                        probability: analysis.lowPercentage,
                        recommendation: 'UNDER 8 STRATEGY: Strong signal - 90%+ win rate detected!',
                        entryCondition: 'Wait for 1+ OVER digits, then enter UNDER 8 immediately',
                    });
                }
            }
        }

        const low7Count = analysis.digitFrequencies.filter(f => f.digit <= 6).reduce((sum, f) => sum + f.percentage, 0);
        const over7Weak = analysis.digitFrequencies.filter(f => f.digit >= 7 && f.percentage < 10).length;
        const triggerUnder7 = analysis.digitFrequencies.find(f => f.digit >= 7 && f.percentage > 10);

        if (low7Count >= 70 && over7Weak >= 2 && triggerUnder7) {
            signals.push({
                type: 'under_7',
                status: 'TRADE NOW',
                probability: low7Count,
                recommendation: `UNDER 7 STRATEGY: Strong bias towards 0-6.`,
                entryCondition: `Use digit ${triggerUnder7.digit} as entry point for UNDER 7`,
                targetDigit: triggerUnder7.digit,
            });
        }

        const high2Count = analysis.digitFrequencies
            .filter(f => f.digit >= 3)
            .reduce((sum, f) => sum + f.percentage, 0);
        const under2Weak = analysis.digitFrequencies.filter(f => f.digit <= 2 && f.percentage < 10).length;
        const triggerOver2 = analysis.digitFrequencies.find(f => f.digit <= 2 && f.percentage > 10);

        if (high2Count >= 70 && under2Weak >= 2 && triggerOver2) {
            signals.push({
                type: 'over_2',
                status: 'TRADE NOW',
                probability: high2Count,
                recommendation: `OVER 2 STRATEGY: Strong bias towards 3-9.`,
                entryCondition: `Use digit ${triggerOver2.digit} as entry point for OVER 2`,
                targetDigit: triggerOver2.digit,
            });
        }

        return signals;
    }

    public generateSuperSignals(_analysis: AnalysisResult, std: Signal[], pro: Signal[]): Signal[] {
        const all = [...std, ...pro];
        const superS = all.filter(s => s.probability >= 65);

        return superS
            .map(s => {
                const copy = { ...s };
                if (copy.probability >= 90) {
                    copy.status = 'STRONG';
                } else if (copy.probability >= 65) {
                    copy.status = 'TRADE NOW';
                }
                return copy;
            })
            .sort((a, b) => b.probability - a.probability);
    }
}
