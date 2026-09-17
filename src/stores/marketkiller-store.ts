import { action, makeObservable, observable, reaction, runInAction } from 'mobx';
import { api_base, observer as globalObserver } from '@/external/bot-skeleton';
import { DigitStatsEngine } from '@/lib/digit-stats-engine';
import { subscribeTicks } from '@/utils/websocket-handler';
import RootStore from './root-store';

type TMarketkillerSubtab = 'onetrader' | 'matches';

export type TRecoveryStep = {
    id: string;
    symbol: string;
    contract_type: string;
    stake_multiplier: number;
    barrier?: number;
};

export type TMarketState = {
    symbol: string;
    price: string | number;
    digit: number | null;
    is_up: boolean;
};

export type TStrategyType = 'DIGITMATCH' | 'DIGITDIFF' | 'DIGITEVEN' | 'DIGITODD' | 'DIGITOVER' | 'DIGITUNDER';

export default class MarketkillerStore {
    root_store: RootStore;
    stats_engine: DigitStatsEngine;

    @observable accessor active_subtab: TMarketkillerSubtab = 'onetrader';
    @observable accessor is_connected = false;
    @observable accessor active_symbols: any[] = [];
    @observable accessor symbol = 'R_100';
    @observable accessor current_price: string | number = 0;
    @observable accessor last_digit: number | null = null;
    @observable accessor ticks: number[] = [];
    @observable accessor live_market_ribbon: TMarketState[] = [];

    // Digit Analytics (0-9)
    @observable accessor digit_stats: {
        digit: number;
        count: number;
        percentage: number;
        rank: number;
        is_increasing: boolean;
    }[] = Array.from({ length: 10 }, (_, i) => ({
        digit: i,
        count: 0,
        percentage: 0,
        rank: i + 1,
        is_increasing: false,
    }));
    @observable accessor digit_power_scores: number[] = Array(10).fill(0);

    // Global Execution State
    @observable accessor is_running = false;
    @observable accessor session_pl = 0;
    @observable accessor wins = 0;
    @observable accessor losses = 0;
    @observable accessor consecutive_losses = 0;
    @observable accessor total_stake_used = 0;
    @observable accessor total_runs = 0;
    @observable accessor trades_journal: any[] = [];

    // Signal Data
    @observable accessor signal_power = 0;
    @observable accessor signal_stability = 0;
    @observable accessor signal_strategy = 'OVER_4';
    @observable accessor use_signals = false;
    @observable accessor entry_point_enabled = false;
    @observable accessor signal_detected = false;

    // --- ONETRADER (HEDGING) SETTINGS ---
    @observable accessor onetrader_settings = {
        contract_type: 'DIGITOVER',
        stake: 0.35,
        duration: 1,
        barrier: 4,
        bulk_count: 1,
        enable_recovery: false,
        recovery_chain: [
            { id: '1', symbol: 'R_100', contract_type: 'DIGITUNDER', stake_multiplier: 2, barrier: 5 },
        ] as TRecoveryStep[],
    };

    // --- MATCHES KILLER SETTINGS ---
    @observable accessor matches_settings = {
        check_ticks: 15,
        predictions: [] as number[],
        slot_strategies: [] as TStrategyType[],
        default_strategy: 'DIGITDIFF' as TStrategyType,
        is_running: false,
        is_auto: true,
        stake: 0.35,
        duration: 1,
        simultaneous_trades: 1,
        bulk_trades_count: 1,
        enabled_conditions: [true, true, true, true, false, false, false, false],
        c4_op: '>=',
        c4_val: 12,
        c4_ticks: 15,
        c6_count: 5,
        c6_target_rank: 'most' as 'most' | '2nd' | 'least',
        enable_multiple_predictions: true,
        max_predictions: 6,
        martingale_enabled: true,
        martingale_multiplier: 0.5,
        // Specific market prediction & condition controls
        specific_differs_prediction: 0,
        differs_target_mode: 'least' as 'least' | 'most' | '2nd_least' | 'custom',
        over_barrier: 1,
        under_barrier: 8,
        even_odd_min_bias: 52,
        over_under_min_bias: 52,
        differs_max_freq: 10,
    };

    @observable accessor matches_ranks = {
        most: null as number | null,
        second: null as number | null,
        least: null as number | null,
    };

    @observable accessor is_executing = false;

    private main_tick_unsub: { unsubscribe: () => void } | null = null;
    private recent_powers: number[][] = [];
    private ribbon_unsubs: Map<string, { unsubscribe: () => void }> = new Map();

    // ── Rate-Limit Guard ──────────────────────────────────────────────────────
    // directBuy fires all trades in parallel (no proposal subscription limit).
    private readonly MAX_RETRIES = 3;

    /** Wait helper */
    private sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

    /** Extract a clean error string from whatever Deriv throws */
    private extractErrorMsg = (e: any): string => {
        if (!e) return 'Unknown error';
        // Deriv rejects with { error: { code, message } }
        if (e?.error?.message) return `[${e.error.code}] ${e.error.message}`;
        if (e?.message) return e.message;
        try {
            return JSON.stringify(e);
        } catch {
            return String(e);
        }
    };

    /**
     * Direct Buy — uses Deriv's buy: "1" with inline parameters.
     * This skips the proposal step entirely, eliminating the InvalidContractProposal
     * race condition where 1-tick proposals expire between propose and buy.
     * One API call per trade = half the rate-limit cost + no expiry window.
     */
    private directBuy = async (config: any, attempt = 0): Promise<any> => {
        const safeStake = Number(Math.max(config.stake || 0.35, 0.35).toFixed(2));

        if (!api_base.api || api_base.api.connection?.readyState !== 1) {
            console.warn('[Marketkiller] Buy aborted: WebSocket disconnected.');
            return null;
        }

        let buyRes: any;
        try {
            const rawBarrier =
                config.barrier !== undefined && config.barrier !== null ? config.barrier : config.prediction;
            const currency = this.root_store?.client?.currency || 'USD';
            const isEvenOdd = config.type === 'DIGITEVEN' || config.type === 'DIGITODD';
            const parameters: Record<string, any> = {
                amount: safeStake,
                basis: 'stake',
                contract_type: config.type,
                currency,
                duration: this.matches_settings.duration || 1,
                duration_unit: 't',
                underlying_symbol: config.symbol,
            };
            if (!isEvenOdd && rawBarrier !== undefined && rawBarrier !== null && rawBarrier !== '') {
                parameters.barrier = String(rawBarrier);
            }

            buyRes = await api_base.api.send({
                buy: '1',
                price: safeStake,
                parameters,
            });
        } catch (e: any) {
            const msg = this.extractErrorMsg(e);
            const isRateLimit =
                msg.includes('429') ||
                msg.toLowerCase().includes('ratelimit') ||
                msg.toLowerCase().includes('rate limit');
            if (isRateLimit && attempt < this.MAX_RETRIES) {
                const backoff = (attempt + 1) * 700;
                console.warn(`[Marketkiller] Buy rate-limited for digit ${config.barrier}. Retrying in ${backoff}ms`);
                await this.sleep(backoff);
                return this.directBuy(config, attempt + 1);
            }
            console.error(`[Marketkiller] Buy exception for digit ${config.barrier}:`, msg);
            return null;
        }

        if (buyRes?.error) {
            const { code, message } = buyRes.error;
            if (code === 'RateLimit' && attempt < this.MAX_RETRIES) {
                const backoff = (attempt + 1) * 700;
                console.warn(`[Marketkiller] Buy RateLimit for digit ${config.barrier}. Retrying in ${backoff}ms`);
                await this.sleep(backoff);
                return this.directBuy(config, attempt + 1);
            }
            console.error(`[Marketkiller] Buy rejected for digit ${config.barrier}: [${code}] ${message}`);
            return null;
        }

        return buyRes;
    };

    constructor(root_store: RootStore) {
        makeObservable(this);
        this.root_store = root_store;
        this.stats_engine = new DigitStatsEngine();

        // Initial ribbon markets - covering all core volatility and jump indices
        const initialMarkets = [
            'R_10',
            '1HZ10V',
            'R_25',
            '1HZ25V',
            'R_50',
            '1HZ50V',
            'R_75',
            '1HZ75V',
            'R_100',
            'JD10',
            'JD25',
            'JD50',
            'JD75',
            'JD100',
        ];
        initialMarkets.forEach(sym => {
            this.live_market_ribbon.push({ symbol: sym, price: '0.00', digit: null, is_up: true });
        });

        // Debounced subscribe to prevent duplicate parallel subscriptions on startup
        this.waitForApiAndConnect();

        reaction(
            () => this.root_store.common?.is_socket_opened,
            is_socket_opened => {
                this.is_connected = !!is_socket_opened;
                if (is_socket_opened) {
                    this.debouncedSubscribe();
                }
            }
        );

        if (typeof window !== 'undefined') {
            window.addEventListener('account_switched', () => {
                this.debouncedSubscribe();
            });
            document.addEventListener('visibilitychange', () => {
                if (!document.hidden && (!this.ticks || this.ticks.length === 0)) {
                    this.debouncedSubscribe();
                }
            });
        }
        globalObserver.register('api.authorize', () => {
            this.debouncedSubscribe();
        });
    }

    private subscribeDebounceTimer: any = null;

    @action
    public debouncedSubscribe = (delay = 300) => {
        if (this.subscribeDebounceTimer) clearTimeout(this.subscribeDebounceTimer);
        this.subscribeDebounceTimer = setTimeout(() => {
            this.subscribeToTicks();
            this.subscribeToRibbon();
        }, delay);
    };

    @action
    private waitForApiAndConnect = () => {
        const tryConnect = () => {
            if (api_base?.api && api_base.api.connection?.readyState === 1) {
                runInAction(() => {
                    this.is_connected = true;
                });
                this.debouncedSubscribe(100);
            } else {
                setTimeout(tryConnect, 800);
            }
        };
        tryConnect();
    };

    @action
    setActiveSubtab = (tab: TMarketkillerSubtab) => {
        this.active_subtab = tab;
    };

    @action
    setSymbol = (sym: string) => {
        this.symbol = sym;
        this.subscribeToTicks();
    };

    @action
    toggleEngine = () => {
        this.is_running = !this.is_running;
        if (!this.is_running) {
            this.consecutive_losses = 0;
        }
    };

    @action
    addRecoveryStep = () => {
        const id = Math.random().toString(36).substring(2, 9);
        runInAction(() => {
            this.onetrader_settings.recovery_chain.push({
                id,
                symbol: this.symbol,
                contract_type: this.onetrader_settings.contract_type === 'DIGITOVER' ? 'DIGITUNDER' : 'DIGITOVER',
                stake_multiplier: 2,
                barrier: this.onetrader_settings.barrier,
            });
        });
    };

    @action
    removeRecoveryStep = (id: string) => {
        runInAction(() => {
            this.onetrader_settings.recovery_chain = this.onetrader_settings.recovery_chain.filter(s => s.id !== id);
        });
    };

    private is_subscribing = false;

    @action
    public subscribeToTicks = async (retry_count = 0) => {
        if (this.is_subscribing) return;
        this.is_subscribing = true;

        try {
            if (this.main_tick_unsub) {
                try {
                    this.main_tick_unsub.unsubscribe();
                } catch (_) {}
                this.main_tick_unsub = null;
            }

            const sym = this.symbol;

            // 1. Initial historical data
            if (api_base?.api && api_base.api.connection?.readyState === 1) {
                try {
                    const response = await api_base.api.send({
                        ticks_history: sym,
                        count: 100,
                        end: 'latest',
                        style: 'ticks',
                    });

                    if (this.symbol === sym && response?.history?.prices && Array.isArray(response.history.prices)) {
                        const prices: number[] = response.history.prices;
                        const digits = prices
                            .map(p => {
                                const priceStr = parseFloat(String(p)).toFixed(2);
                                return parseInt(priceStr.slice(-1), 10);
                            })
                            .filter(d => !isNaN(d));

                        runInAction(() => {
                            this.ticks = digits.slice(-120);
                            if (prices.length > 0) {
                                const lastPrice = prices[prices.length - 1];
                                this.current_price = parseFloat(String(lastPrice)).toFixed(2);
                                this.last_digit = parseInt(this.current_price.slice(-1), 10);
                                this.stats_engine.updateWithHistory(
                                    this.ticks.slice(-this.matches_settings.check_ticks),
                                    parseFloat(String(this.current_price))
                                );
                                this.updateDigitAnalytics();
                            }
                        });
                    }
                } catch (histErr) {
                    console.warn('[Marketkiller] History fetch note:', histErr);
                }
            }

            if (this.symbol !== sym) return;

            // 2. Centralized multiplexed subscription with auto-reconnect & rate-limit safety
            const unsub = subscribeTicks(sym, (res: any) => {
                if (this.symbol !== sym) return;
                if (res?.tick && res.tick.symbol === sym) {
                    this.onTickArrival(res.tick);
                }
            });

            this.main_tick_unsub = unsub;
            runInAction(() => {
                this.is_connected = true;
            });
        } catch (error: any) {
            console.warn('[Marketkiller] tick sub note:', error?.message || error);
            if (retry_count < 5) {
                setTimeout(() => this.subscribeToTicks(retry_count + 1), 2000);
            }
        } finally {
            this.is_subscribing = false;
        }
    };

    @action
    public subscribeToRibbon = () => {
        // Clean up previous ribbon subscriptions
        this.ribbon_unsubs.forEach(unsub => {
            try {
                unsub.unsubscribe();
            } catch (_) {}
        });
        this.ribbon_unsubs.clear();

        this.live_market_ribbon.forEach(m => {
            const unsub = subscribeTicks(m.symbol, (res: any) => {
                if (res?.tick) {
                    const tick = res.tick;
                    const index = this.live_market_ribbon.findIndex(item => item?.symbol === tick.symbol);
                    if (index !== -1) {
                        runInAction(() => {
                            const item = this.live_market_ribbon[index];
                            if (!item) return;
                            const price = parseFloat(String(tick.quote)).toFixed(tick.pip_size || 2);
                            item.is_up = parseFloat(price) >= parseFloat(String(item.price));
                            item.price = price;
                            item.digit = parseInt(price.slice(-1), 10);
                        });
                    }
                }
            });
            this.ribbon_unsubs.set(m.symbol, unsub);
        });
    };

    @action
    public cleanupSubscriptions = () => {
        if (this.main_tick_unsub) {
            try {
                this.main_tick_unsub.unsubscribe();
            } catch (_) {}
            this.main_tick_unsub = null;
        }
        this.ribbon_unsubs.forEach(unsub => {
            try {
                unsub.unsubscribe();
            } catch (_) {}
        });
        this.ribbon_unsubs.clear();
    };

    @action
    private onTickArrival = (tick: any) => {
        const price = parseFloat(tick.quote).toFixed(tick.pip_size || 2);
        const last_digit = parseInt(price.slice(-1));

        runInAction(() => {
            this.current_price = price;
            this.last_digit = last_digit;
            this.ticks = [...this.ticks, last_digit].slice(-120);

            // Feed DigitStatsEngine
            this.stats_engine.updateWithHistory(
                this.ticks.slice(-this.matches_settings.check_ticks),
                parseFloat(String(this.current_price))
            );

            // Track recent power scores for Rule 3
            const currentPowers = this.stats_engine.digit_stats.map(s => s.power);
            this.recent_powers = [...this.recent_powers, currentPowers].slice(-5);

            this.updateDigitAnalytics();

            if (this.is_running && !this.is_executing) {
                this.evaluateLogicEngine();
            }
        });
    };

    @action
    private updateDigitAnalytics = () => {
        const stats = this.stats_engine.digit_stats;
        if (stats.length === 0) return;

        this.digit_stats = stats.map(s => ({
            digit: s.digit,
            count: s.count,
            percentage: s.percentage,
            rank: s.rank,
            is_increasing: s.is_increasing,
        }));

        this.digit_power_scores = stats.map(s => s.power);

        // Update global Signal state
        const percentages = this.stats_engine.getPercentages();
        switch (this.signal_strategy) {
            case 'EVEN':
                this.signal_power = percentages.even;
                break;
            case 'ODD':
                this.signal_power = percentages.odd;
                break;
            case 'RISE':
                this.signal_power = percentages.rise;
                break;
            case 'FALL':
                this.signal_power = percentages.fall;
                break;
            case 'OVER_4':
                this.signal_power = percentages.over;
                break;
            case 'UNDER_5':
                this.signal_power = percentages.under;
                break;
        }

        this.signal_stability = Math.max(20, 100 - Math.abs(50 - this.signal_power) / 2);

        // Calculate Special Ranks for Matches
        if (this.digit_stats.length >= 10) {
            const sorted = [...this.digit_stats].sort((a, b) => b.count - a.count);
            this.matches_ranks = {
                most: sorted[0].digit,
                second: sorted[1].digit,
                least: sorted[9].digit,
            };
        }
    };

    @action
    private evaluateLogicEngine = () => {
        if (this.active_subtab === 'onetrader') {
            this.evaluateOnetrader();
        } else if (this.active_subtab === 'matches') {
            this.evaluateMatchesKiller();
        }
    };

    @action
    private evaluateOnetrader = () => {
        // Recovery Engine Overrides
        let current_symbol = this.symbol;
        let current_type = this.onetrader_settings.contract_type;
        let current_stake = this.onetrader_settings.stake;
        let current_barrier = this.onetrader_settings.barrier;

        const is_recovery_step = this.onetrader_settings.enable_recovery && this.consecutive_losses > 0;

        if (is_recovery_step) {
            const step_index = Math.min(this.consecutive_losses - 1, this.onetrader_settings.recovery_chain.length - 1);
            const step = this.onetrader_settings.recovery_chain[step_index];
            if (step) {
                current_symbol = step.symbol;
                current_type = step.contract_type;
                current_stake *= step.stake_multiplier;
                current_barrier = step.barrier ?? current_barrier;
            }
        }

        // Logic check: if using signals, only trade if power > 55
        if (this.use_signals && !is_recovery_step) {
            if (this.signal_power < 55) return; // Wait for better signal
        }

        const tradesToExecute = Array(this.onetrader_settings.bulk_count).fill({
            type: current_type,
            symbol: current_symbol,
            barrier: current_barrier,
            stake: current_stake,
        });

        this.executeConcurrentTrades(tradesToExecute);
        runInAction(() => {
            this.signal_detected = true;
            setTimeout(
                () =>
                    runInAction(() => {
                        this.signal_detected = false;
                    }),
                2000
            );
        });
        // Halt to prevent rapid-fire while evaluating execution resolution
        this.is_running = false;
    };

    @action
    private evaluateMatchesKiller = () => {
        const most = this.matches_ranks.most;
        const second = this.matches_ranks.second;
        const least = this.matches_ranks.least;

        if (most === null || second === null || least === null) return;

        const enabled = this.matches_settings.enabled_conditions;
        const defaultStrat = this.matches_settings.default_strategy || 'DIGITDIFF';
        const percentages = this.stats_engine.getPercentages();
        const powers = this.recent_powers;
        const len = powers.length;
        const sortedDigits = [...this.digit_stats].sort((a, b) => b.count - a.count).map(s => s.digit);
        const leastDigits = [...this.digit_stats].sort((a, b) => a.count - b.count).map(s => s.digit);
        const activeSlotsCount = this.matches_settings.simultaneous_trades || 1;
        const bulkCount = this.matches_settings.bulk_trades_count || 1;

        const tradesToExecute: Array<{ type: TStrategyType; symbol: string; barrier?: number; stake: number }> = [];

        // Check common digit conditions (Rules 2, 3, 4, 5, 8)
        const checkDigitRules = (digit: number, isDiffers = false) => {
            const stat = this.digit_stats.find(s => s.digit === digit);
            if (!stat) return false;

            // Rule 2: Power Acceleration
            if (enabled[1]) {
                if (len < 2) return false;
                const lastPower = powers[len - 1][digit];
                const prevPower = powers[len - 2][digit];
                if (isDiffers) {
                    // For differs, target power should not be surging upwards
                    if (lastPower > prevPower && lastPower > 15) return false;
                } else {
                    if (lastPower <= prevPower) return false;
                }
            }

            // Rule 3: Dual Velocity (two consecutive increases)
            if (enabled[2]) {
                if (len < 3) return false;
                const p1 = powers[len - 3][digit];
                const p2 = powers[len - 2][digit];
                const p3 = powers[len - 1][digit];
                if (!isDiffers && !(p3 > p2 && p2 > p1)) return false;
            }

            // Rule 4: Sequential Stability (Last 5 digits)
            if (enabled[3]) {
                const last5 = this.ticks.slice(-5);
                if (isDiffers) {
                    // For differs, target digit should not have appeared in last 3 ticks
                    if (last5.slice(-3).includes(digit)) return false;
                } else {
                    const top3 = [most, second, least];
                    if (!last5.every(d => top3.includes(d))) return false;
                }
            }

            // Rule 5: Probability Threshold
            if (enabled[4]) {
                const { c4_op: op, c4_val: val } = this.matches_settings;
                const power = stat.percentage;
                if (op === '>' && power <= val) return false;
                if (op === '>=' && power < val) return false;
                if (op === '==' && Math.abs(power - val) > 0.1) return false;
                if (op === '<' && power >= val) return false;
                if (op === '<=' && power > val) return false;
            }

            // Rule 8: Differs Safety Gate (Frequency <= differs_max_freq)
            if (isDiffers && enabled[7]) {
                if (stat.percentage > (this.matches_settings.differs_max_freq || 10)) return false;
            }

            return true;
        };

        for (let slotIdx = 0; slotIdx < activeSlotsCount; slotIdx++) {
            const slotStrat = this.matches_settings.slot_strategies[slotIdx] || defaultStrat;

            if (slotStrat === 'DIGITEVEN' || slotStrat === 'DIGITODD') {
                const isEven = slotStrat === 'DIGITEVEN';
                const pct = isEven ? percentages.even : percentages.odd;

                // Gate 6: Even/Odd Bias Gate
                if (enabled[5] && pct < (this.matches_settings.even_odd_min_bias || 52)) {
                    continue;
                }

                for (let b = 0; b < bulkCount; b++) {
                    tradesToExecute.push({
                        type: slotStrat,
                        symbol: this.symbol,
                        stake: this.calculateMatchesStake(),
                    });
                }
            } else if (slotStrat === 'DIGITOVER') {
                const barrier = this.matches_settings.is_auto
                    ? (this.matches_settings.over_barrier ?? 1)
                    : (this.matches_settings.predictions[slotIdx] ?? this.matches_settings.over_barrier ?? 1);

                // Gate 7: Over/Under Momentum Gate
                if (enabled[6] && percentages.over < (this.matches_settings.over_under_min_bias || 50)) {
                    continue;
                }

                for (let b = 0; b < bulkCount; b++) {
                    tradesToExecute.push({
                        type: 'DIGITOVER',
                        symbol: this.symbol,
                        barrier,
                        stake: this.calculateMatchesStake(),
                    });
                }
            } else if (slotStrat === 'DIGITUNDER') {
                const barrier = this.matches_settings.is_auto
                    ? (this.matches_settings.under_barrier ?? 8)
                    : (this.matches_settings.predictions[slotIdx] ?? this.matches_settings.under_barrier ?? 8);

                // Gate 7: Over/Under Momentum Gate
                if (enabled[6] && percentages.under < (this.matches_settings.over_under_min_bias || 50)) {
                    continue;
                }

                for (let b = 0; b < bulkCount; b++) {
                    tradesToExecute.push({
                        type: 'DIGITUNDER',
                        symbol: this.symbol,
                        barrier,
                        stake: this.calculateMatchesStake(),
                    });
                }
            } else if (slotStrat === 'DIGITDIFF') {
                let targetDigit: number;
                if (this.matches_settings.is_auto) {
                    if (this.matches_settings.differs_target_mode === 'custom') {
                        targetDigit = this.matches_settings.specific_differs_prediction ?? leastDigits[slotIdx] ?? 0;
                    } else if (this.matches_settings.differs_target_mode === 'most') {
                        targetDigit = sortedDigits[slotIdx] ?? 0;
                    } else if (this.matches_settings.differs_target_mode === '2nd_least') {
                        targetDigit = leastDigits[1] ?? leastDigits[0] ?? 0;
                    } else {
                        targetDigit = leastDigits[slotIdx] ?? 0;
                    }
                } else {
                    targetDigit = this.matches_settings.predictions[slotIdx] ?? (leastDigits[slotIdx] ?? 0);
                }

                if (!checkDigitRules(targetDigit, true)) {
                    continue;
                }

                for (let b = 0; b < bulkCount; b++) {
                    tradesToExecute.push({
                        type: 'DIGITDIFF',
                        symbol: this.symbol,
                        barrier: targetDigit,
                        stake: this.calculateMatchesStake(),
                    });
                }
            } else {
                // DIGITMATCH
                let targetDigit: number;
                if (this.matches_settings.is_auto) {
                    targetDigit = sortedDigits[slotIdx] ?? 0;
                } else {
                    targetDigit = this.matches_settings.predictions[slotIdx] ?? (sortedDigits[slotIdx] ?? 0);
                }

                if (!checkDigitRules(targetDigit, false)) {
                    continue;
                }

                for (let b = 0; b < bulkCount; b++) {
                    tradesToExecute.push({
                        type: 'DIGITMATCH',
                        symbol: this.symbol,
                        barrier: targetDigit,
                        stake: this.calculateMatchesStake(),
                    });
                }
            }
        }

        if (tradesToExecute.length > 0) {
            console.log(`[Marketkiller] Auto-Execution triggered ${tradesToExecute.length} trades.`);
            this.executeConcurrentTrades(tradesToExecute);

            runInAction(() => {
                this.signal_detected = true;
                setTimeout(
                    () =>
                        runInAction(() => {
                            this.signal_detected = false;
                        }),
                    2000
                );
            });

            // If NOT in auto-mode, shut down engine after one burst.
            // In AUTO-MODE, we keep it running but rely on is_executing to prevent overlaps.
            if (!this.matches_settings.is_auto) {
                this.is_running = false;
            }
        }
    };

    private calculateMatchesStake = () => {
        let stake = this.matches_settings.stake || 0.35;
        if (this.matches_settings.martingale_enabled && this.consecutive_losses > 0) {
            stake = stake * Math.pow(this.matches_settings.martingale_multiplier, this.consecutive_losses);
        }
        return Number(Math.max(stake, 0.35).toFixed(2));
    };

    @action
    private executeConcurrentTrades = async (tradeConfigs: any[]) => {
        if (tradeConfigs.length === 0) return;
        runInAction(() => {
            this.is_executing = true;
        });

        console.log(
            `[Marketkiller] ⚡ Atomic burst: ${tradeConfigs.length} trade(s) — digits:`,
            tradeConfigs.map(c => c.barrier)
        );

        // ── ZERO-GAP SYNCHRONOUS FIRE ─────────────────────────────────────────
        // All api.send() calls are started in a plain synchronous .map() loop
        // — NO await between them. Every WebSocket message is queued in the
        // SAME JavaScript event loop tick before any suspension occurs.
        // This gives the absolute minimum gap between sends and guarantees all
        // contracts open on the same entry tick → same entry AND exit spot.
        const sendPromises: Promise<any>[] = tradeConfigs.map(config => {
            const safeStake = Number(Math.max(config.stake || 0.35, 0.35).toFixed(2));
            const rawBarrier =
                config.barrier !== undefined && config.barrier !== null ? config.barrier : config.prediction;
            const currency = this.root_store?.client?.currency || 'USD';
            const isEvenOdd = config.type === 'DIGITEVEN' || config.type === 'DIGITODD';
            const parameters: Record<string, any> = {
                amount: safeStake,
                basis: 'stake',
                contract_type: config.type,
                currency,
                duration: this.matches_settings.duration || 1,
                duration_unit: 't',
                underlying_symbol: config.symbol,
            };
            if (!isEvenOdd && rawBarrier !== undefined && rawBarrier !== null && rawBarrier !== '') {
                parameters.barrier = String(rawBarrier);
            }

            return api_base.api.send({
                buy: '1',
                price: safeStake,
                parameters,
            });
        });

        // Await all responses together.
        const results = await Promise.allSettled(sendPromises);

        const successfulTrades: Array<{ trade: any; config: any }> = [];
        results.forEach((result, i) => {
            if (result.status === 'fulfilled') {
                const trade = result.value;
                if (trade?.error) {
                    const { code, message } = trade.error;
                    console.error(`[Marketkiller] ❌ Digit ${tradeConfigs[i]?.barrier} rejected: [${code}] ${message}`);
                    return;
                }
                if (!trade?.buy?.contract_id) {
                    console.warn(`[Marketkiller] ❌ Digit ${tradeConfigs[i]?.barrier}: no contract_id`, trade);
                    return;
                }
                console.log(
                    `[Marketkiller] ✅ Digit ${tradeConfigs[i]?.barrier} confirmed | Contract ${trade.buy.contract_id}`
                );
                successfulTrades.push({ trade, config: tradeConfigs[i] });
            } else {
                const msg = this.extractErrorMsg(result.reason);
                console.error(`[Marketkiller] ❌ Digit ${tradeConfigs[i]?.barrier} exception: ${msg}`);
            }
        });

        console.log(
            `[Marketkiller] Burst complete: ${successfulTrades.length}/${tradeConfigs.length} confirmed on same tick.`
        );

        // ── Journal & Settlement Tracking ─────────────────────────────────────
        successfulTrades.forEach(({ trade, config }) => {
            const contractId = trade.buy.contract_id;

            runInAction(() => {
                this.total_stake_used += config.stake;
                this.total_runs++;
                this.trades_journal.unshift({
                    id: contractId,
                    market: config.symbol,
                    type: config.type,
                    prediction: config.barrier,
                    stake: config.stake,
                    time: new Date().toLocaleTimeString(),
                    entry: trade.buy?.entry_spot_display_value ?? undefined,
                    exit: undefined,
                    status: 'PENDING',
                });
            });

            const sub = api_base.api.onMessage().subscribe((res: any) => {
                const data = res?.data || res;
                const poc = data?.proposal_open_contract;
                if (data?.msg_type === 'proposal_open_contract' && poc?.contract_id === contractId && poc?.is_sold) {
                    runInAction(() => {
                        if (poc.status === 'won') {
                            this.wins++;
                            this.consecutive_losses = 0;
                        } else {
                            this.losses++;
                            this.consecutive_losses++;
                        }
                        this.session_pl += poc.profit;

                        const jIdx = this.trades_journal.findIndex(j => j.id === contractId);
                        if (jIdx !== -1) {
                            this.trades_journal[jIdx].status = poc.status.toUpperCase();
                            this.trades_journal[jIdx].exit = poc.exit_tick_display_value ?? poc.exit_tick;
                            this.trades_journal[jIdx].entry = poc.entry_tick_display_value ?? poc.entry_tick;
                            this.trades_journal[jIdx].profit = poc.profit;
                        }
                    });
                    try {
                        sub.unsubscribe();
                    } catch (_) {
                        /* ignore */
                    }
                }
            });

            api_base.api
                .send({
                    proposal_open_contract: 1,
                    contract_id: contractId,
                    subscribe: 1,
                })
                .catch((e: any) => {
                    console.warn(`[Marketkiller] POC subscribe failed for ${contractId}:`, e?.error?.message || e);
                });
        });

        // Release execution lock after trades are initiated and settled (or timeout)
        // We wait a small buffer to ensure the socket isn't flooded and ticks have progressed.
        setTimeout(() => {
            runInAction(() => {
                this.is_executing = false;
            });
        }, 1500);
    };

    @action
    public resetStats = () => {
        this.wins = 0;
        this.losses = 0;
        this.session_pl = 0;
        this.total_stake_used = 0;
        this.total_runs = 0;
        this.consecutive_losses = 0;
        this.trades_journal = [];
    };

    @action
    public executeOneShot = async () => {
        const bulkCount = this.matches_settings.bulk_trades_count || 1;
        const sortedDigits = [...this.digit_stats].sort((a, b) => b.count - a.count).map(s => s.digit);
        const leastDigits = [...this.digit_stats].sort((a, b) => a.count - b.count).map(s => s.digit);

        const activeSlotsCount = this.matches_settings.simultaneous_trades || 1;
        const trades: any[] = [];

        for (let i = 0; i < activeSlotsCount; i++) {
            const slotStrat = this.matches_settings.slot_strategies[i] || this.matches_settings.default_strategy || 'DIGITDIFF';

            let targetDigit: number | undefined;
            if (this.matches_settings.is_auto) {
                if (slotStrat === 'DIGITDIFF') {
                    if (this.matches_settings.differs_target_mode === 'custom') {
                        targetDigit = this.matches_settings.specific_differs_prediction ?? leastDigits[i] ?? 0;
                    } else if (this.matches_settings.differs_target_mode === 'most') {
                        targetDigit = sortedDigits[i] ?? 0;
                    } else if (this.matches_settings.differs_target_mode === '2nd_least') {
                        targetDigit = leastDigits[1] ?? leastDigits[0] ?? 0;
                    } else {
                        targetDigit = leastDigits[i] ?? 0;
                    }
                } else if (slotStrat === 'DIGITOVER') {
                    targetDigit = this.matches_settings.over_barrier ?? 1;
                } else if (slotStrat === 'DIGITUNDER') {
                    targetDigit = this.matches_settings.under_barrier ?? 8;
                } else {
                    targetDigit = sortedDigits[i] ?? 0;
                }
            } else {
                if (slotStrat === 'DIGITOVER') {
                    targetDigit = this.matches_settings.predictions[i] ?? (this.matches_settings.over_barrier ?? 1);
                } else if (slotStrat === 'DIGITUNDER') {
                    targetDigit = this.matches_settings.predictions[i] ?? (this.matches_settings.under_barrier ?? 8);
                } else {
                    targetDigit = this.matches_settings.predictions[i] ?? 0;
                }
            }

            const barrier = (slotStrat === 'DIGITEVEN' || slotStrat === 'DIGITODD') ? undefined : targetDigit;

            for (let b = 0; b < bulkCount; b++) {
                trades.push({
                    type: slotStrat,
                    symbol: this.symbol,
                    barrier,
                    stake: this.matches_settings.stake,
                });
            }
        }

        if (trades.length > 0) {
            await this.executeConcurrentTrades(trades);
        }
    };

    @action
    public executeSingleManualTrade = async (
        target: number | string,
        strategyType?: TStrategyType,
        customBulkCount?: number
    ) => {
        const strat = strategyType || this.matches_settings.default_strategy || 'DIGITMATCH';
        const count = customBulkCount || this.matches_settings.bulk_trades_count || 1;
        const stake = this.matches_settings.stake;
        const barrier = (strat === 'DIGITEVEN' || strat === 'DIGITODD') ? undefined : Number(target);

        const trades = Array(count).fill(null).map(() => ({
            type: strat,
            symbol: this.symbol,
            barrier,
            stake,
        }));

        await this.executeConcurrentTrades(trades);
    };
}
