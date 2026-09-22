import { action, makeObservable, observable, runInAction } from 'mobx';
import { api_base } from '@/external/bot-skeleton';
import RootStore from './root-store';
import { getLastDigitFromQuote } from '@/utils/market-data';
import { generateBotXML, mapSignalToBestSignal } from '@/utils/bot-xml-generator';
import { connectionStatus$ } from '@/external/bot-skeleton/services/api/observables/connection-status-stream';
import { hybridMarketAdapter } from '@/adapters/hybrid-market-adapter';

export type TStrategyType =
    | 'even_odd'
    | 'over_under'
    | 'matches'
    | 'differs'
    | 'rise_fall'
    | 'pro_even_odd'
    | 'pro_over_under'
    | 'pro_differs'
    | 'under_7'
    | 'over_2'
    | 'super'
    | '';
export type TSignalStatus = 'TRADE NOW' | 'WAIT' | 'NEUTRAL';
export type TDigitFrequency = { digit: number; count: number; percentage: number };

export type TAnalysisResult = {
    digitFrequencies: TDigitFrequency[];
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
    lastDigits: number[];
    lastQuote: number;
};

export type TSignal = {
    type: TStrategyType;
    status: TSignalStatus;
    probability: number;
    recommendation: string;
    entryCondition: string;
    targetDigit?: number;
    signalDetails?: any;
};

export type TScanSignal = {
    symbol: string;
    strategy: TStrategyType;
    confidence: number;
    timestamp: number;
    details: TSignal;
    analysisResult: TAnalysisResult;
};

interface IScannerStore {
    is_open: boolean;
    is_scanning: boolean;
    selected_strategy: TStrategyType;
    selected_symbols: string[];
    scan_mode: 'single' | 'multiple';
    signals: TScanSignal[];
    current_signal: TScanSignal | null;
    selected_strategies: TStrategyType[];
    scan_market_mode: 'single' | 'multi';
    single_market_symbol: string;
    single_market_price: number | null;
    single_market_last_digit: number | null;
    ticks_counter: number;
    is_manual_selection: boolean;
    connection_status: 'connected' | 'connecting' | 'disconnected';

    // Trading and automation fields
    stake: number;
    take_profit: number;
    stop_loss: number;
    martingale_multiplier: number;
    alternate_after_losses: boolean;
    auto_switch_markets: boolean;
    loss_threshold: number;
    is_auto_trading: boolean;
    is_full_ai_automation: boolean;
    consecutive_losses: number;
    last_trade_result: 'WIN' | 'LOSS' | null;
    signal_sequence_id: string | null;
    switch_strategy_after_losses: number;
    target_switch_strategy: TStrategyType | 'auto';

    // Trading Console Transaction Stats
    total_runs: number;
    wins: number;
    losses: number;
    total_stake: number;
    // Bulk Trades & Virtual Hook Parameters
    is_bulk_trades_enabled: boolean;
    bulk_trades_count: number;
    is_virtual_hook_enabled: boolean;
    virtual_loss_threshold: number;
    virtual_losses_count: number;

    setBulkTradesEnabled: (enabled: boolean) => void;
    setBulkTradesCount: (count: number) => void;
    setVirtualHookEnabled: (enabled: boolean) => void;
    setVirtualLossThreshold: (threshold: number) => void;
    selectSignalFromSignalsTab: (signal: {
        symbol?: string;
        type: TStrategyType;
        status: TSignalStatus;
        probability: number;
        recommendation: string;
        entryCondition: string;
        targetDigit?: number;
    }) => void;
    loadSignalStrategyToBuilder: (signal: {
        symbol?: string;
        type: TStrategyType;
        status: TSignalStatus;
        probability: number;
        recommendation: string;
        entryCondition: string;
        targetDigit?: number;
    }) => Promise<void>;
    setScannerVisibility: (is_open?: boolean) => void;
    setSelectedStrategy: (strategy: TStrategyType) => void;
    setSelectedSymbols: (symbols: string[]) => void;
    setScanMode: (mode: 'single' | 'multiple') => void;
    startScanning: () => void;
    stopScanning: () => void;
    resetScanner: () => void;
    toggleStrategy: (strategy: TStrategyType) => void;
    setScanMarketMode: (mode: 'single' | 'multi') => void;
    setSingleMarketSymbol: (symbol: string) => void;
    setTicksCounter: (count: number) => void;
    setFullAiAutomation: (is_full: boolean) => void;
    recordTradeResult: (result: 'WIN' | 'LOSS', profit: number, stakeUsed: number) => void;
    resetConsoleStats: () => void;
    setSwitchStrategyAfterLosses: (count: number) => void;
    setTargetSwitchStrategy: (strategy: TStrategyType | 'auto') => void;
}

export default class ScannerStore implements IScannerStore {
    root_store: RootStore;
    is_open = false;
    is_scanning = false;
    selected_strategy: TStrategyType = 'even_odd';
    selected_symbols: string[] = [];
    scan_mode: 'single' | 'multiple' = 'multiple';
    signals: TScanSignal[] = [];
    current_signal: TScanSignal | null = null;
    connection_status: 'connected' | 'connecting' | 'disconnected' = 'connected';
    private scanning_timeout: ReturnType<typeof setTimeout> | null = null;

    // Single market live tracking
    single_market_price: number | null = null;
    single_market_last_digit: number | null = null;

    // Multi-strategy and market selection options
    selected_strategies: TStrategyType[] = ['even_odd'];
    scan_market_mode: 'single' | 'multi' = 'multi';
    single_market_symbol: string = 'R_100';
    ticks_counter: number = 0;
    is_manual_selection = false;
    symbol_analysis: Record<string, TAnalysisResult> = {};

    // Automation parameters & state
    stake = 1;
    take_profit = 10;
    stop_loss = 10;
    martingale_multiplier = 2.0;
    alternate_after_losses = false;
    auto_switch_markets = false;
    loss_threshold = 1;
    is_auto_trading = false;
    is_full_ai_automation = false;
    consecutive_losses = 0;
    last_trade_result: 'WIN' | 'LOSS' | null = null;
    signal_sequence_id: string | null = null;
    switch_strategy_after_losses = 3;
    target_switch_strategy: TStrategyType | 'auto' = 'auto';
    current_strategy_index = 0;
    selected_trade_type = 'both';

    // Transaction Console Stats
    total_runs = 0;
    wins = 0;
    losses = 0;
    total_stake = 0;
    total_profit = 0;
    auto_runs_count = 0;

    // Bulk Trades & Virtual Hook Parameters
    is_bulk_trades_enabled = false;
    bulk_trades_count = 2;
    is_virtual_hook_enabled = false;
    virtual_loss_threshold = 2;
    virtual_losses_count = 0;

    // Internal Caches & Subscriptions
    private ticks_cache: Map<string, { epoch: number; quote: number }[]> = new Map();
    private tick_subscriptions: Map<string, string> = new Map();
    private is_subscribed_to_messages = false;
    private message_subscription: any = null;
    private candle_cache: Map<string, { direction: 'up' | 'down' | 'neutral'; timestamp: number }> = new Map();
    private is_bot_loading = false;

    // ── Post-loss re-analysis guard ──────────────────────────────────────────
    // After 1-2 losses the bot pauses and waits for a fresh high-confidence
    // signal before executing the next trade.  This prevents over-trading into
    // a shifting market.
    private _loss_reanalysis_pending = false;
    private _loss_reanalysis_timer: ReturnType<typeof setTimeout> | null = null;
    // Minimum signal confidence required to re-enter after a loss streak
    readonly LOSS_REANALYSIS_MIN_CONFIDENCE = 0.70;

    constructor(root_store: RootStore) {
        makeObservable(this, {
            is_open: observable,
            is_scanning: observable,
            selected_strategy: observable,
            selected_symbols: observable,
            scan_mode: observable,
            signals: observable,
            current_signal: observable,
            selected_strategies: observable,
            scan_market_mode: observable,
            single_market_symbol: observable,
            single_market_price: observable,
            single_market_last_digit: observable,
            connection_status: observable,
            ticks_counter: observable,
            is_manual_selection: observable,
            symbol_analysis: observable,
            stake: observable,
            take_profit: observable,
            stop_loss: observable,
            martingale_multiplier: observable,
            alternate_after_losses: observable,
            auto_switch_markets: observable,
            loss_threshold: observable,
            is_auto_trading: observable,
            is_full_ai_automation: observable,
            consecutive_losses: observable,
            last_trade_result: observable,
            signal_sequence_id: observable,
            selected_trade_type: observable,
            total_runs: observable,
            wins: observable,
            losses: observable,
            total_stake: observable,
            total_profit: observable,
            is_bulk_trades_enabled: observable,
            bulk_trades_count: observable,
            is_virtual_hook_enabled: observable,
            virtual_loss_threshold: observable,
            virtual_losses_count: observable,
            setScannerVisibility: action,
            setSelectedStrategy: action,
            setSelectedSymbols: action,
            setScanMode: action,
            startScanning: action,
            stopScanning: action,
            resetScanner: action,
            addSignal: action,
            toggleStrategy: action,
            setScanMarketMode: action,
            setSingleMarketSymbol: action,
            setTicksCounter: action,
            setSymbolAnalysis: action,
            setAutoTrading: action,
            setFullAiAutomation: action,
            selectSignal: action,
            recordTradeResult: action,
            resetConsoleStats: action,
            setSwitchStrategyAfterLosses: action,
            setTargetSwitchStrategy: action,
            setBulkTradesEnabled: action,
            setBulkTradesCount: action,
            setVirtualHookEnabled: action,
            setVirtualLossThreshold: action,
            selectSignalFromSignalsTab: action,
        });

        this.root_store = root_store;
        (window as any).scanner_store = this;

        // Subscribe to WebSocket Connection Status
        connectionStatus$.subscribe(status => {
            runInAction(() => {
                if (status === 'opened') this.connection_status = 'connected';
                else if (status === 'closed') this.connection_status = 'disconnected';
                else this.connection_status = 'connecting';
            });
        });

        this.setupAutomationListeners();
    }

    recordTradeResult = (result: 'WIN' | 'LOSS', profit: number, stakeUsed: number) => {
        this.total_runs += 1;
        this.auto_runs_count += 1;
        this.total_stake += stakeUsed;
        this.total_profit += profit;

        if (result === 'WIN') {
            this.wins += 1;
            this.consecutive_losses = 0;
            this.last_trade_result = 'WIN';
        } else {
            this.losses += 1;
            this.consecutive_losses += 1;
            this.last_trade_result = 'LOSS';
        }

        // Push live trade stats notification to Journal
        try {
            const journal = this.root_store.journal;
            if (journal && journal.pushMessage) {
                const digit = this.single_market_last_digit !== null ? this.single_market_last_digit : '-';
                const quote = this.single_market_price !== null ? this.single_market_price : '-';
                const statusMsg = `[AI SCANNER] Market: ${this.single_market_symbol} | Quote: ${quote} | Last Digit: ${digit} | Result: ${result} (${profit >= 0 ? '+' : ''}$${profit.toFixed(2)}) | Condition Matched!`;
                journal.pushMessage(
                    statusMsg,
                    result === 'WIN' ? 'success' : 'warn',
                    result === 'WIN' ? 'journal__text--success' : 'journal__text--warn'
                );
            }
        } catch (e) {
            // ignore
        }
    };

    resetConsoleStats = () => {
        this.total_runs = 0;
        this.wins = 0;
        this.losses = 0;
        this.total_stake = 0;
        this.total_profit = 0;
        this.auto_runs_count = 0;
        this.consecutive_losses = 0;
        this.last_trade_result = null;
    };

    setSwitchStrategyAfterLosses = (count: number) => {
        this.switch_strategy_after_losses = count;
    };

    setTargetSwitchStrategy = (strategy: TStrategyType | 'auto') => {
        this.target_switch_strategy = strategy;
    };

    setFullAiAutomation = (is_full: boolean) => {
        this.is_full_ai_automation = is_full;
        if (is_full) {
            // If full AI is enabled, ensure auto trading is enabled
            this.is_auto_trading = true;
            this.setupAutomationListeners();
        } else {
            // If disabled, turn off auto trading
            this.is_auto_trading = false;
        }
    };

    setBulkTradesEnabled = (enabled: boolean) => {
        this.is_bulk_trades_enabled = enabled;
    };

    setBulkTradesCount = (count: number) => {
        this.bulk_trades_count = Math.max(1, Math.min(100, count));
    };

    setVirtualHookEnabled = (enabled: boolean) => {
        this.is_virtual_hook_enabled = enabled;
    };

    setVirtualLossThreshold = (threshold: number) => {
        this.virtual_loss_threshold = Math.max(1, Math.min(10, threshold));
    };

    shouldExecuteRealTrade = (): boolean => {
        if (!this.is_virtual_hook_enabled) return true;
        if (this.virtual_losses_count >= this.virtual_loss_threshold) {
            return true; // Virtual loss threshold met -> execute REAL trade
        }
        // Simulate virtual trade loss count step
        this.virtual_losses_count += 1;
        try {
            const journal = this.root_store.journal;
            if (journal && journal.pushMessage) {
                journal.pushMessage(
                    `[VIRTUAL HOOK] Virtual Trade Step ${this.virtual_losses_count}/${this.virtual_loss_threshold}. Real account protected.`,
                    'warn',
                    'journal__text--warn'
                );
            }
        } catch (e) {
            // ignore
        }
        return false;
    };

    toggleStrategy = (strategy: TStrategyType) => {
        const existingIndex = this.selected_strategies.indexOf(strategy);
        if (existingIndex > -1) {
            if (this.selected_strategies.length > 1) {
                this.selected_strategies = this.selected_strategies.filter(s => s !== strategy);
            }
        } else {
            this.selected_strategies = [...this.selected_strategies, strategy];
        }
    };

    setScanMarketMode = (mode: 'single' | 'multi') => {
        this.scan_market_mode = mode;
    };

    setTicksCounter = (count: number) => {
        this.ticks_counter = count;
    };

    setSymbolAnalysis = (symbol: string, analysis: TAnalysisResult) => {
        this.symbol_analysis[symbol] = analysis;
    };

    subscribeToSymbolTicks = async (symbol: string) => {
        if (!symbol) return;
        this.single_market_symbol = symbol;
        this.setupMessageListener();

        // Subscribe via HybridMarketAdapter for instant live tick stream with dual WS fallback
        try {
            hybridMarketAdapter.subscribe(symbol, tickData => {
                const price = Number(tickData.quote);
                const digit = tickData.digit ?? getLastDigitFromQuote(price, symbol);

                if (symbol === this.single_market_symbol) {
                    this.single_market_price = price;
                    this.single_market_last_digit = digit;
                }

                const ticks = this.ticks_cache.get(symbol) || [];
                ticks.push({ epoch: tickData.epoch, quote: price });
                if (ticks.length > 120) {
                    ticks.shift();
                }
                this.ticks_cache.set(symbol, ticks);

                try {
                    const analysis = this.analyzeTicks(ticks, symbol);
                    this.setSymbolAnalysis(symbol, analysis);
                } catch (err) {}

                if (this.is_scanning) {
                    this.evaluateMarketPower();
                }
            });
        } catch (e) {
            console.warn(`[ScannerStore] Hybrid tick subscription fallback for ${symbol}:`, e);
        }

        if (!api_base.api) return;

        try {
            const response = await (api_base.api as any).send({
                ticks_history: symbol,
                end: 'latest',
                count: 120,
                style: 'ticks',
                subscribe: 1,
            });
            if (response && response.history && response.history.prices) {
                const { prices, times } = response.history;
                const lastPrice = Number(prices[prices.length - 1]);
                this.single_market_price = lastPrice;
                this.single_market_last_digit = getLastDigitFromQuote(lastPrice, symbol);

                const ticks = [];
                for (let i = 0; i < prices.length; i++) {
                    ticks.push({ epoch: Number(times[i]), quote: Number(prices[i]) });
                }
                this.ticks_cache.set(symbol, ticks);

                try {
                    const analysis = this.analyzeTicks(ticks, symbol);
                    this.setSymbolAnalysis(symbol, analysis);
                } catch (err) {
                    // ignore
                }

                if (response.subscription && response.subscription.id) {
                    this.tick_subscriptions.set(symbol, response.subscription.id);
                }
            }
        } catch (e) {
            console.warn(`[ScannerStore] Primary WS ticks history fetch for ${symbol}:`, e);
        }
    };

    setSingleMarketSymbol = (symbol: string) => {
        this.single_market_symbol = symbol;
        this.single_market_price = null;
        this.single_market_last_digit = null;
        this.subscribeToSymbolTicks(symbol);
    };

    setScannerVisibility = (is_open?: boolean | any) => {
        this.is_open = typeof is_open === 'boolean' ? is_open : !this.is_open;
        console.log('setScannerVisibility called, is_open now:', this.is_open);
        if (this.is_open) {
            this.subscribeToSymbolTicks(this.single_market_symbol);
        }
    };

    setSelectedStrategy = (strategy: TStrategyType) => {
        this.selected_strategy = strategy;
    };

    selectSignalFromSignalsTab = (signal: {
        symbol?: string;
        type: TStrategyType;
        status: TSignalStatus;
        probability: number;
        recommendation: string;
        entryCondition: string;
        targetDigit?: number;
    }) => {
        const symbol = signal.symbol || this.single_market_symbol || 'R_100';
        this.current_signal = {
            symbol,
            strategy: signal.type,
            confidence: signal.probability / 100,
            timestamp: Date.now(),
            details: {
                type: signal.type,
                status: signal.status,
                probability: signal.probability,
                recommendation: signal.recommendation,
                entryCondition: signal.entryCondition,
                targetDigit: signal.targetDigit,
            },
            analysisResult: this.symbol_analysis[symbol] || ({} as TAnalysisResult),
        };
        this.is_manual_selection = true;
        this.setSelectedStrategy(signal.type);
        this.setSingleMarketSymbol(symbol);
        this.setScannerVisibility(true);
    };

    loadSignalStrategyToBuilder = async (signal: {
        symbol?: string;
        type: TStrategyType;
        status: TSignalStatus;
        probability: number;
        recommendation: string;
        entryCondition: string;
        targetDigit?: number;
    }) => {
        this.selectSignalFromSignalsTab(signal);
        this.setScannerVisibility(false);
        this.root_store.dashboard.setActiveTab(1);

        for (let attempt = 0; attempt < 20; attempt += 1) {
            if (typeof window !== 'undefined' && window.Blockly?.derivWorkspace) {
                await this.loadBotWithStrategy();
                return;
            }
            await new Promise(resolve => setTimeout(resolve, 100));
        }

        console.warn('[ScannerStore] Bot Builder workspace did not initialize for signal strategy load');
    };

    setSelectedSymbols = (symbols: string[]) => {
        this.selected_symbols = symbols;
    };

    setScanMode = (mode: 'single' | 'multiple') => {
        this.scan_mode = mode;
    };

    addSignal = (signal: TScanSignal) => {
        if (!this.is_manual_selection) {
            if (!this.current_signal || signal.confidence > this.current_signal.confidence) {
                this.current_signal = signal;
            }
        }
        this.signals = [signal, ...this.signals].slice(0, 20); // Keep last 20 signals
    };

    startScanning = async () => {
        if (!this.selected_symbols.length) {
            if (api_base.active_symbols) {
                const allSymbols = api_base.active_symbols
                    .map((s: any) => s.symbol || s.underlying_symbol)
                    .filter((sym: string) => {
                        if (!sym) return false;
                        const s = sym.toUpperCase();
                        if (s.includes('BOOM') || s.includes('CRASH')) return false;
                        return s.includes('1HZ') || s.startsWith('R_') || s.includes('JD') || s.includes('JUMP');
                    });
                this.selected_symbols = allSymbols;
            } else {
                console.warn('[ScannerStore] No active symbols available');
                return;
            }
        }

        this.is_scanning = true;
        this.ticks_counter = 0;
        this.is_manual_selection = false;
        this.symbol_analysis = {};

        this.setupMessageListener();
        this.unsubscribeAllTicks();

        try {
            await this.initMarketSubscriptions();
            await this.analyzeMarkets();
            this.setupContinuousScanning();
        } catch (error) {
            console.error('[ScannerStore] Scanning error:', error);
            this.is_scanning = false;
        }
    };

    stopScanning = async () => {
        this.is_scanning = false;
        if (this.scanning_timeout) {
            clearTimeout(this.scanning_timeout);
            this.scanning_timeout = null;
        }
        this.unsubscribeAllTicks();
    };

    resetScanner = () => {
        this.stopScanning();
        this.signals = [];
        this.current_signal = null;
        this.ticks_counter = 0;
        this.symbol_analysis = {};
        return () => {
            this.stopScanning();
        };
    };

    // @ts-ignore
    private _setupLiveListeners = () => {
        if (this.is_subscribed_to_messages || !api_base.api) return;

        api_base.api.onMessage().subscribe((data: any) => {
            if (data.msg_type === 'tick' && data.tick) {
                const tick = data.tick;
                const symbol = tick.symbol;
                if (symbol === this.single_market_symbol) {
                    this.single_market_price = Number(tick.quote);
                    this.single_market_last_digit = getLastDigitFromQuote(tick.quote, symbol);
                }
                if (this.ticks_cache.has(symbol)) {
                    const ticks = this.ticks_cache.get(symbol)!;
                    ticks.push({ epoch: tick?.epoch || Math.floor(Date.now() / 1000), quote: tick.quote });
                    if (ticks.length > 120) {
                        ticks.shift();
                    }
                }
            }
        });
        this.is_subscribed_to_messages = true;
    };

    private setupMessageListener = () => {
        if (!this.is_subscribed_to_messages && api_base.api) {
            this.message_subscription = api_base.api.onMessage().subscribe((msg: any) => {
                const data = msg.data || msg;
                if (data.msg_type === 'tick' && data.tick) {
                    const tick = data.tick;
                    const symbol = tick.symbol;
                    if (symbol === this.single_market_symbol) {
                        this.single_market_price = Number(tick.quote);
                        this.single_market_last_digit = getLastDigitFromQuote(tick.quote, symbol);
                    }
                    if (this.ticks_cache.has(symbol)) {
                        const ticks = this.ticks_cache.get(symbol)!;
                        ticks.push({ epoch: tick.epoch, quote: tick.quote });
                        if (ticks.length > 120) {
                            ticks.shift();
                        }
                    }
                }
            });
            this.is_subscribed_to_messages = true;
        }
    };

    selectSignal = async (signal: TScanSignal) => {
        this.current_signal = signal;
        this.is_manual_selection = true;

        if (signal && api_base.api) {
            const symbol = signal.symbol;
            if (!this.tick_subscriptions.has(symbol)) {
                this.unsubscribeAllTicks();
                try {
                    const response = await (api_base.api as any).send({
                        ticks_history: symbol,
                        end: 'latest',
                        count: 120,
                        style: 'ticks',
                        subscribe: 1,
                    });
                    if (response && response.history && response.history.prices) {
                        const { prices, times } = response.history;
                        const ticks = [];
                        for (let i = 0; i < prices.length; i++) {
                            ticks.push({ epoch: Number(times[i]), quote: Number(prices[i]) });
                        }
                        this.ticks_cache.set(symbol, ticks);
                        if (response.subscription && response.subscription.id) {
                            this.tick_subscriptions.set(symbol, response.subscription.id);
                        }
                    }
                } catch (e) {
                    console.warn(`[ScannerStore] Failed to switch active subscription to ${symbol}:`, e);
                }
            }
        }
    };

    private initMarketSubscriptions = async () => {
        const activeSymbol =
            this.scan_market_mode === 'single'
                ? this.single_market_symbol
                : this.current_signal?.symbol || this.single_market_symbol;

        const symbolsToScan = this.scan_market_mode === 'single' ? [this.single_market_symbol] : this.selected_symbols;

        this.unsubscribeAllTicks();

        // Subscribe ONLY to the active symbol for real-time tick updates (keeps client lightweight)
        try {
            const response = await (api_base.api as any).send({
                ticks_history: activeSymbol,
                end: 'latest',
                count: 120,
                style: 'ticks',
                subscribe: 1,
            });
            if (response && response.history && response.history.prices) {
                const { prices, times } = response.history;
                const ticks = [];
                for (let i = 0; i < prices.length; i++) {
                    ticks.push({ epoch: Number(times[i]), quote: Number(prices[i]) });
                }
                this.ticks_cache.set(activeSymbol, ticks);
                if (response.subscription && response.subscription.id) {
                    this.tick_subscriptions.set(activeSymbol, response.subscription.id);
                }
            }
        } catch (e) {
            console.warn(`[ScannerStore] Failed to subscribe to active symbol ${activeSymbol}:`, e);
        }

        // Snapshot query for other symbols (zero streaming ticks in background = 0% lag)
        const otherSymbols = symbolsToScan.filter(s => s !== activeSymbol);
        await Promise.all(
            otherSymbols.map(async symbol => {
                try {
                    const response = await (api_base.api as any).send({
                        ticks_history: symbol,
                        end: 'latest',
                        count: 120,
                        style: 'ticks',
                    });
                    if (response && response.history && response.history.prices) {
                        const { prices, times } = response.history;
                        const ticks = [];
                        for (let i = 0; i < prices.length; i++) {
                            ticks.push({ epoch: Number(times[i]), quote: Number(prices[i]) });
                        }
                        this.ticks_cache.set(symbol, ticks);
                    }
                } catch (e) {
                    console.warn(`[ScannerStore] Failed to query ticks history for ${symbol}:`, e);
                }
            })
        );
    };

    private unsubscribeAllTicks = () => {
        if (!api_base.api) return;
        this.tick_subscriptions.forEach((id: string) => {
            (api_base.api as any).send({ forget: id }).catch(() => {});
        });
        this.tick_subscriptions.clear();
        this.ticks_cache.clear();

        if (this.message_subscription) {
            this.message_subscription.unsubscribe();
            this.message_subscription = null;
            this.is_subscribed_to_messages = false;
        }
    };

    private setupContinuousScanning = () => {
        if (this.is_scanning) {
            this.scanning_timeout = setTimeout(async () => {
                try {
                    if (this.ticks_counter >= 3) {
                        // Scan every 6s (3 * 2s)
                        this.ticks_counter = 0;
                        if (this.scan_market_mode === 'multi') {
                            const activeSymbol = this.current_signal?.symbol || this.single_market_symbol;
                            const otherSymbols = this.selected_symbols.filter(s => s !== activeSymbol);
                            await Promise.all(
                                otherSymbols.map(async symbol => {
                                    try {
                                        const response = await (api_base.api as any).send({
                                            ticks_history: symbol,
                                            end: 'latest',
                                            count: 120,
                                            style: 'ticks',
                                        });
                                        if (response && response.history && response.history.prices) {
                                            const { prices, times } = response.history;
                                            const ticks = [];
                                            for (let i = 0; i < prices.length; i++) {
                                                ticks.push({ epoch: Number(times[i]), quote: Number(prices[i]) });
                                            }
                                            this.ticks_cache.set(symbol, ticks);
                                        }
                                    } catch (e) {
                                        // ignore
                                    }
                                })
                            );
                        }
                        await this.analyzeMarkets();
                    } else {
                        this.ticks_counter += 1;
                    }
                    this.setupContinuousScanning();
                } catch (error) {
                    console.error('[ScannerStore] Continuous scanning error:', error);
                    this.setupContinuousScanning();
                }
            }, 2000);
        }
    };

    // Helper: Extract last digit from quote
    private extractLastDigit = (quote: number, symbol: string): number => {
        return getLastDigitFromQuote(quote, symbol);
    };

    // Step 1: Analyze ticks
    analyzeTicks = (ticks: any[], symbol: string): TAnalysisResult => {
        if (!ticks || ticks.length === 0) {
            throw new Error('No ticks to analyze');
        }

        const totalTicks = ticks.length;
        const lastDigits = ticks.map(t => this.extractLastDigit(t.quote, symbol));
        const digitCounts = Array(10).fill(0);
        let evenCount = 0,
            oddCount = 0,
            highCount = 0,
            lowCount = 0;

        lastDigits.forEach(digit => {
            digitCounts[digit]++;
            if (digit % 2 === 0) evenCount++;
            else oddCount++;
            if (digit >= 5) highCount++;
            else lowCount++;
        });

        const digitFrequencies = digitCounts.map((count, digit) => ({
            digit,
            count,
            percentage: totalTicks > 0 ? (count / totalTicks) * 100 : 0,
        }));

        const sortedDigits = [...digitFrequencies].sort((a, b) => b.percentage - a.percentage);
        const strongestDigit = sortedDigits[0].digit;
        const weakestDigit = sortedDigits[sortedDigits.length - 1].digit;
        const gap = sortedDigits[0].percentage - sortedDigits[sortedDigits.length - 1].percentage;

        const missingDigits = digitCounts.map((count, digit) => (count === 0 ? digit : -1)).filter(d => d !== -1);
        const streaks = this.detectStreaks(lastDigits);
        const entropy = this.calculateEntropy(digitFrequencies);

        const lastQuote = ticks[ticks.length - 1].quote;

        return {
            digitFrequencies,
            evenCount,
            oddCount,
            evenPercentage: (evenCount / totalTicks) * 100,
            oddPercentage: (oddCount / totalTicks) * 100,
            highCount,
            lowCount,
            highPercentage: (highCount / totalTicks) * 100,
            lowPercentage: (lowCount / totalTicks) * 100,
            entropy,
            powerIndex: { strongest: strongestDigit, weakest: weakestDigit, gap },
            missingDigits,
            streaks,
            totalTicks,
            lastDigits,
            lastQuote,
        };
    };

    // Step 2: Detect streaks
    detectStreaks = (digits: number[]): { digit: number; count: number }[] => {
        const streaks: { digit: number; count: number }[] = [];
        let currentDigit = digits[0];
        let currentCount = 1;

        for (let i = 1; i < digits.length; i++) {
            if (digits[i] === currentDigit) {
                currentCount++;
            } else {
                if (currentCount >= 2) {
                    streaks.push({ digit: currentDigit, count: currentCount });
                }
                currentDigit = digits[i];
                currentCount = 1;
            }
        }

        if (currentCount >= 2) {
            streaks.push({ digit: currentDigit, count: currentCount });
        }
        return streaks;
    };

    // Step 3: Calculate Shannon entropy
    calculateEntropy = (frequencies: TDigitFrequency[]): number => {
        let entropy = 0;
        frequencies.forEach(f => {
            if (f.percentage > 0) {
                const p = f.percentage / 100;
                entropy -= p * Math.log2(p);
            }
        });
        return entropy;
    };

    // Step 4: Generate all standard signals
    generateAllSignals = (analysis: TAnalysisResult, symbol: string): Map<TStrategyType, TSignal> => {
        const signals = new Map<TStrategyType, TSignal>();
        const prevAnalysis = this.symbol_analysis[symbol];

        // Even/Odd Signal
        const maxEvenOdd = Math.max(analysis.evenPercentage, analysis.oddPercentage);
        const isEvenBias = analysis.evenPercentage > analysis.oddPercentage;

        let isEvenOddIncreasing = true;
        if (prevAnalysis) {
            const prevPct = isEvenBias ? prevAnalysis.evenPercentage : prevAnalysis.oddPercentage;
            isEvenOddIncreasing = maxEvenOdd > prevPct;
        }

        const evenOddConditionMet = maxEvenOdd >= 55 && isEvenOddIncreasing;

        if (evenOddConditionMet) {
            if (maxEvenOdd >= 60) {
                signals.set('even_odd', {
                    type: 'even_odd',
                    status: 'TRADE NOW',
                    probability: maxEvenOdd / 100,
                    recommendation: `Strong ${isEvenBias ? 'even' : 'odd'} bias detected at ${maxEvenOdd.toFixed(1)}%`,
                    entryCondition: `Wait for 2+ consecutive ${isEvenBias ? 'odd' : 'even'} digits, then trade ${isEvenBias ? 'even' : 'odd'}`,
                    signalDetails: { bias: isEvenBias ? 'even' : 'odd' },
                });
            } else {
                signals.set('even_odd', {
                    type: 'even_odd',
                    status: 'WAIT',
                    probability: maxEvenOdd / 100,
                    recommendation: `Moderate ${isEvenBias ? 'even' : 'odd'} bias at ${maxEvenOdd.toFixed(1)}%`,
                    entryCondition: 'Monitor for stronger signal',
                });
            }
        } else {
            signals.set('even_odd', {
                type: 'even_odd',
                status: 'NEUTRAL',
                probability: 0,
                recommendation: 'No clear pattern or not increasing',
                entryCondition: '',
            });
        }

        // Over/Under - Advanced Statistical Analysis
        const pctUnder = analysis.lowPercentage;
        // const pctOver = analysis.highPercentage;

        let isUnderIncreasing = true;
        if (prevAnalysis) {
            isUnderIncreasing = pctUnder > prevAnalysis.lowPercentage;
        }

        // Sort all 10 digits by frequency (descending)
        const sortedDigitsDesc = [...analysis.digitFrequencies].sort((a, b) => b.percentage - a.percentage);
        const mostAppearingDigit = sortedDigitsDesc[0].digit;
        const secondMostAppearingDigit = sortedDigitsDesc[1].digit;
        const leastAppearingDigit = sortedDigitsDesc[9].digit;

        // Check if most, 2nd most, and least appearing digits are in Under (0-4)
        const topDigitsInUnder = mostAppearingDigit < 5 && secondMostAppearingDigit < 5;
        const leastDigitInUnder = leastAppearingDigit < 5;

        // Check if ALL Over digits (5-9) individually have < 10% frequency
        const allOverLessThan10Pct = analysis.digitFrequencies.filter(d => d.digit >= 5).every(d => d.percentage < 10);

        // Check if the last 15 ticks are primarily Under (require at least 12 out of 15 to be < 5)
        const recent15Ticks = analysis.lastDigits.slice(-15);
        const underCountInLast15 = recent15Ticks.filter(d => d < 5).length;
        const last15AreMostlyUnder = underCountInLast15 >= 12;

        const underConditionMet =
            pctUnder > 60 &&
            isUnderIncreasing &&
            topDigitsInUnder &&
            leastDigitInUnder &&
            allOverLessThan10Pct &&
            last15AreMostlyUnder;

        if (underConditionMet) {
            const highestUnderDigit = sortedDigitsDesc.find(d => d.digit < 5)?.digit ?? 0;
            signals.set('over_under', {
                type: 'over_under',
                status: 'TRADE NOW',
                probability: pctUnder / 100,
                recommendation: `Strong Under bias detected: ${pctUnder.toFixed(1)}%. Most freq digit: ${mostAppearingDigit}`,
                entryCondition: `Wait for digit ${highestUnderDigit} to appear, then trade UNDER ${highestUnderDigit}`,
                targetDigit: highestUnderDigit,
                signalDetails: { bias: 'low' },
            });
        } else {
            signals.set('over_under', {
                type: 'over_under',
                status: 'NEUTRAL',
                probability: 0,
                recommendation: 'Strict Under conditions not met',
                entryCondition: '',
            });
        }

        // Matches
        const strongestFreq = analysis.digitFrequencies[analysis.powerIndex.strongest].percentage;
        if (strongestFreq >= 15) {
            signals.set('matches', {
                type: 'matches',
                status: 'TRADE NOW',
                probability: strongestFreq / 100,
                recommendation: `Digit ${analysis.powerIndex.strongest} has strong power at ${strongestFreq.toFixed(1)}%`,
                entryCondition: 'Trade immediately when digit appears',
                targetDigit: analysis.powerIndex.strongest,
            });
        } else if (strongestFreq >= 12) {
            signals.set('matches', {
                type: 'matches',
                status: 'WAIT',
                probability: strongestFreq / 100,
                recommendation: `Digit ${analysis.powerIndex.strongest} showing moderate frequency at ${strongestFreq.toFixed(1)}%`,
                entryCondition: 'Wait for frequency to increase',
                targetDigit: analysis.powerIndex.strongest,
            });
        } else {
            signals.set('matches', {
                type: 'matches',
                status: 'NEUTRAL',
                probability: 0,
                recommendation: 'No dominant digit',
                entryCondition: '',
            });
        }

        // Differs
        const leastFreq = analysis.digitFrequencies[analysis.powerIndex.weakest].percentage;
        if (leastFreq < 9) {
            signals.set('differs', {
                type: 'differs',
                status: 'TRADE NOW',
                probability: (100 - leastFreq) / 100,
                recommendation: `Digit ${analysis.powerIndex.weakest} appears only ${leastFreq.toFixed(1)}%`,
                entryCondition: 'Wait for rare digit to appear, then trade DIFFERS',
                targetDigit: analysis.powerIndex.weakest,
            });
        } else {
            signals.set('differs', {
                type: 'differs',
                status: 'NEUTRAL',
                probability: 0,
                recommendation: 'No clear differs pattern',
                entryCondition: '',
            });
        }

        // Rise/Fall
        if (analysis.lastDigits.length >= 10) {
            const last10 = analysis.lastDigits.slice(-10);
            const firstTickValue = last10[0];
            const lastTickValue = last10[last10.length - 1];
            const trend = lastTickValue - firstTickValue;
            const direction = trend > 0 ? 'rise' : 'fall';
            const confidence = Math.min(60 + Math.abs(trend) * 100, 75);
            if (confidence >= 60) {
                signals.set('rise_fall', {
                    type: 'rise_fall',
                    status: 'TRADE NOW',
                    probability: confidence / 100,
                    recommendation: `${direction.toUpperCase()} trend detected with ${confidence.toFixed(1)}% confidence`,
                    entryCondition: 'Trade in detected direction',
                    signalDetails: { trend: direction, strength: Math.abs(trend) },
                });
            } else {
                signals.set('rise_fall', {
                    type: 'rise_fall',
                    status: 'NEUTRAL',
                    probability: 0,
                    recommendation: 'Insufficient trend strength',
                    entryCondition: '',
                });
            }
        } else {
            signals.set('rise_fall', {
                type: 'rise_fall',
                status: 'NEUTRAL',
                probability: 0,
                recommendation: 'Not enough ticks',
                entryCondition: '',
            });
        }

        return signals;
    };

    // Step 5: Generate Pro Signals (Advanced Strategies)
    generateProSignals = (analysis: TAnalysisResult): Map<TStrategyType, TSignal> => {
        const signals = new Map<TStrategyType, TSignal>();
        const lastDigits = analysis.lastDigits;
        const last20 = lastDigits.slice(-20);

        // --- 1. Pro Even/Odd ---
        const evenDigitsFreqs = analysis.digitFrequencies.filter(f => f.digit % 2 === 0);
        const oddDigitsFreqs = analysis.digitFrequencies.filter(f => f.digit % 2 !== 0);
        const evenFreq11Plus = evenDigitsFreqs.filter(f => f.percentage >= 11).length;
        const oddFreq11Plus = oddDigitsFreqs.filter(f => f.percentage >= 11).length;
        const strongestIsEven = analysis.powerIndex.strongest % 2 === 0;
        const evenInLast20 = last20.filter(d => d % 2 === 0).length;
        const oddInLast20 = last20.filter(d => d % 2 !== 0).length;

        // EVEN Strategy
        if (analysis.evenPercentage >= 55 && evenFreq11Plus >= 2 && strongestIsEven && evenInLast20 >= 11) {
            let consecutiveOdds = 0;
            for (let i = lastDigits.length - 1; i >= 0; i--) {
                if (lastDigits[i] % 2 !== 0) consecutiveOdds++;
                else break;
            }

            if (consecutiveOdds >= 3) {
                signals.set('pro_even_odd', {
                    type: 'pro_even_odd',
                    status: 'TRADE NOW',
                    probability: analysis.evenPercentage / 100,
                    recommendation: `EVEN STRATEGY: ${consecutiveOdds} consecutive odds detected - Enter EVEN now!`,
                    entryCondition: 'Enter EVEN immediately after first even digit appears',
                });
            } else {
                signals.set('pro_even_odd', {
                    type: 'pro_even_odd',
                    status: 'WAIT',
                    probability: analysis.evenPercentage / 100,
                    recommendation: 'EVEN conditions met - Waiting for 3+ consecutive ODD digits',
                    entryCondition: 'Wait for 3+ consecutive ODD digits, then enter EVEN',
                });
            }
        }
        // ODD Strategy
        else if (analysis.oddPercentage >= 70 && oddFreq11Plus >= 2 && !strongestIsEven && oddInLast20 >= 14) {
            let consecutiveEvens = 0;
            for (let i = lastDigits.length - 1; i >= 0; i--) {
                if (lastDigits[i] % 2 === 0) consecutiveEvens++;
                else break;
            }

            if (consecutiveEvens >= 3) {
                signals.set('pro_even_odd', {
                    type: 'pro_even_odd',
                    status: 'TRADE NOW',
                    probability: analysis.oddPercentage / 100,
                    recommendation: `ODD STRATEGY: ${consecutiveEvens} consecutive evens detected - Enter ODD now!`,
                    entryCondition: 'Enter ODD immediately after first odd digit appears',
                });
            } else {
                signals.set('pro_even_odd', {
                    type: 'pro_even_odd',
                    status: 'WAIT',
                    probability: analysis.oddPercentage / 100,
                    recommendation: 'ODD conditions met - Waiting for 3+ consecutive EVEN digits',
                    entryCondition: 'Wait for 3+ consecutive EVEN digits, then enter ODD',
                });
            }
        }

        // --- 2. Pro Over/Under ---
        const d0Freq = analysis.digitFrequencies[0].percentage;
        const d1Freq = analysis.digitFrequencies[1].percentage;
        const range2_9Freq11Plus = analysis.digitFrequencies.filter(f => f.digit >= 2 && f.percentage >= 11).length;
        const weakestIs0or1 = analysis.powerIndex.weakest === 0 || analysis.powerIndex.weakest === 1;
        const digitsGt1Last20 = last20.filter(d => d > 1).length;
        const pctGt1 = (lastDigits.filter(d => d > 1).length / lastDigits.length) * 100;

        // Over 1
        if (d0Freq < 10 && d1Freq < 10 && range2_9Freq11Plus >= 3 && weakestIs0or1 && analysis.highPercentage >= 90) {
            if (digitsGt1Last20 >= 18) {
                signals.set('pro_over_under', {
                    type: 'pro_over_under',
                    status: 'TRADE NOW',
                    probability: pctGt1 / 100,
                    recommendation: 'OVER 1 STRATEGY: Strong signal - 90%+ win rate detected!',
                    entryCondition: 'Wait for 1+ UNDER digits, then enter OVER 1 immediately',
                    targetDigit: 1,
                    signalDetails: { bias: 'high' },
                });
            }
        }
        // Under 8
        else {
            const d8Freq = analysis.digitFrequencies[8].percentage;
            const d9Freq = analysis.digitFrequencies[9].percentage;
            const range0_7Freq11Plus = analysis.digitFrequencies.filter(f => f.digit <= 7 && f.percentage >= 11).length;
            const weakestIs8or9 = analysis.powerIndex.weakest === 8 || analysis.powerIndex.weakest === 9;
            const digitsLt8Last20 = last20.filter(d => d < 8).length;
            const pctLt8 = (lastDigits.filter(d => d < 8).length / lastDigits.length) * 100;

            if (
                d8Freq < 10 &&
                d9Freq < 10 &&
                range0_7Freq11Plus >= 3 &&
                weakestIs8or9 &&
                analysis.lowPercentage >= 90
            ) {
                if (digitsLt8Last20 >= 18) {
                    signals.set('pro_over_under', {
                        type: 'pro_over_under',
                        status: 'TRADE NOW',
                        probability: pctLt8 / 100,
                        recommendation: 'UNDER 8 STRATEGY: Strong signal - 90%+ win rate detected!',
                        entryCondition: 'Wait for 1+ OVER digits, then enter UNDER 8 immediately',
                        targetDigit: 8,
                        signalDetails: { bias: 'low' },
                    });
                }
            }
        }

        // --- 3. Pro Differs ---
        const rareDigits = analysis.digitFrequencies.filter(f => f.percentage < 9);
        if (rareDigits.length >= 2) {
            const avgRarePct = rareDigits.reduce((acc, f) => acc + f.percentage, 0) / rareDigits.length;
            const combinedDiffersConfidence = 100 - avgRarePct;
            signals.set('pro_differs', {
                type: 'pro_differs',
                status: 'TRADE NOW',
                probability: combinedDiffersConfidence / 100,
                recommendation: `Pro differs on digit ${analysis.powerIndex.weakest} (multiple rare digits detected)`,
                entryCondition: `Wait for digit ${analysis.powerIndex.weakest} to appear, then trade DIFFERS`,
                targetDigit: analysis.powerIndex.weakest,
            });
        }

        // --- 4. Under 7 ---
        const endRange7_9 = [7, 8, 9];
        const range7_9Freqs = endRange7_9.map(d => analysis.digitFrequencies[d].percentage);
        const countLt10Pct7_9 = range7_9Freqs.filter(p => p < 10).length;
        const triggerDigit7_9 = endRange7_9.find(d => analysis.digitFrequencies[d].percentage >= 10);
        const pctUnder7 = (lastDigits.filter(d => d < 7).length / lastDigits.length) * 100;

        if (countLt10Pct7_9 >= 2 && triggerDigit7_9 !== undefined) {
            signals.set('under_7', {
                type: 'under_7',
                status: 'TRADE NOW',
                probability: pctUnder7 / 100,
                recommendation: `UNDER 7 STRATEGY: Strong under 7 bias (trigger digit: ${triggerDigit7_9})`,
                entryCondition: `Enter trade when trigger digit ${triggerDigit7_9} appears`,
                targetDigit: triggerDigit7_9,
            });
        }

        // --- 5. Over 2 ---
        const startRange0_2 = [0, 1, 2];
        const range0_2Freqs = startRange0_2.map(d => analysis.digitFrequencies[d].percentage);
        const countLt10Pct0_2 = range0_2Freqs.filter(p => p < 10).length;
        const triggerDigit0_2 = startRange0_2.find(d => analysis.digitFrequencies[d].percentage >= 10);
        const pctOver2 = (lastDigits.filter(d => d > 2).length / lastDigits.length) * 100;

        if (countLt10Pct0_2 >= 2 && triggerDigit0_2 !== undefined) {
            signals.set('over_2', {
                type: 'over_2',
                status: 'TRADE NOW',
                probability: pctOver2 / 100,
                recommendation: `OVER 2 STRATEGY: Strong over 2 bias (trigger digit: ${triggerDigit0_2})`,
                entryCondition: `Enter trade when trigger digit ${triggerDigit0_2} appears`,
                targetDigit: triggerDigit0_2,
            });
        }

        return signals;
    };

    // Step 6: Generate Super Signals (Real-Time Monitoring)
    generateSuperSignals = (analysis: TAnalysisResult, symbol: string): TSignal[] => {
        const activeSuperSignals: TSignal[] = [];
        const allStd = this.generateAllSignals(analysis, symbol);
        const allPro = this.generateProSignals(analysis);

        const allMerged = new Map<TStrategyType, TSignal>();
        for (const [key, val] of allStd.entries()) {
            allMerged.set(key, val);
        }
        for (const [key, val] of allPro.entries()) {
            allMerged.set(key, val);
        }

        for (const [, signal] of allMerged.entries()) {
            const confidencePercent = signal.probability * 100;

            let status: TSignalStatus = 'NEUTRAL';
            if (confidencePercent >= 90) {
                status = 'TRADE NOW';
            } else if (confidencePercent >= 65) {
                status = 'TRADE NOW';
            } else if (confidencePercent >= 55) {
                status = 'WAIT';
            }

            const superSignal: TSignal = {
                ...signal,
                status,
                signalDetails: {
                    ...signal.signalDetails,
                    isStrong: confidencePercent >= 90,
                    confidencePercent,
                },
            };

            if (confidencePercent >= 65) {
                activeSuperSignals.push(superSignal);
            }
        }

        return activeSuperSignals.sort((a, b) => b.probability - a.probability);
    };

    fetchCandleDirection = async (symbol: string): Promise<'up' | 'down' | 'neutral'> => {
        const now = Date.now();
        const cached = this.candle_cache.get(symbol);
        if (cached && now - cached.timestamp < 60000) {
            return cached.direction;
        }

        try {
            if (!api_base.api) return 'neutral';
            const response = (await (api_base.api as any).send({
                ticks_history: symbol,
                granularity: 1800, // 30 mins
                count: 2,
                style: 'candles',
            })) as any;
            if (response && response.candles && response.candles.length > 0) {
                const candles = response.candles;
                const latestCandle = candles[candles.length - 1];
                let direction: 'up' | 'down' | 'neutral' = 'neutral';
                if (latestCandle.close > latestCandle.open) direction = 'up';
                else if (latestCandle.close < latestCandle.open) direction = 'down';

                this.candle_cache.set(symbol, { direction, timestamp: now });
                return direction;
            }
            return 'neutral';
        } catch (e) {
            console.warn('[ScannerStore] Failed to fetch candle direction:', e);
            return 'neutral';
        }
    };

    checkSignalConfirmation = async (
        symbol: string,
        strategy: TStrategyType,
        signal: TSignal,
        analysis: TAnalysisResult
    ): Promise<boolean> => {
        const candleDirection = await this.fetchCandleDirection(symbol);
        const last15Digits = analysis.lastDigits.slice(-15);
        const evenInLast15 = last15Digits.filter(d => d % 2 === 0).length;
        const oddInLast15 = last15Digits.filter(d => d % 2 !== 0).length;
        const highInLast15 = last15Digits.filter(d => d >= 5).length;
        const lowInLast15 = last15Digits.filter(d => d < 5).length;

        let alignsWith30Min = true;
        let alignsWith15Ticks = true;
        let isEntryTriggered = true;

        const currentLastDigit = analysis.lastDigits[analysis.lastDigits.length - 1];
        const prevQuote =
            analysis.lastDigits.length > 1 ? analysis.lastDigits[analysis.lastDigits.length - 2] : analysis.lastQuote;
        const quoteDelta = analysis.lastQuote - prevQuote;

        isEntryTriggered = this.isEntryConditionTriggered(strategy, currentLastDigit, signal.targetDigit, quoteDelta);

        if (strategy === 'even_odd' || strategy === 'pro_even_odd' || strategy === 'super') {
            const isEvenSignal = signal.recommendation.toLowerCase().includes('even');
            if (candleDirection !== 'neutral') {
                alignsWith30Min = isEvenSignal ? candleDirection === 'up' : candleDirection === 'down';
            }
            alignsWith15Ticks = isEvenSignal ? evenInLast15 >= 8 : oddInLast15 >= 8;
        } else if (
            strategy === 'over_under' ||
            strategy === 'pro_over_under' ||
            strategy === 'under_7' ||
            strategy === 'over_2'
        ) {
            const isOverSignal = signal.recommendation.toLowerCase().includes('over') || strategy === 'over_2';
            if (candleDirection !== 'neutral') {
                alignsWith30Min = isOverSignal ? candleDirection === 'up' : candleDirection === 'down';
            }
            alignsWith15Ticks = isOverSignal ? highInLast15 >= 8 : lowInLast15 >= 8;
        } else if (strategy === 'rise_fall') {
            const isRiseSignal = signal.recommendation.toLowerCase().includes('rise');
            if (candleDirection !== 'neutral') {
                alignsWith30Min = isRiseSignal ? candleDirection === 'up' : candleDirection === 'down';
            }
            const last15TicksData = analysis.lastDigits.slice(-15);
            const quoteTrend = last15TicksData[last15TicksData.length - 1] - last15TicksData[0];
            alignsWith15Ticks = isRiseSignal ? quoteTrend > 0 : quoteTrend < 0;
        }

        return alignsWith30Min && alignsWith15Ticks && isEntryTriggered;
    };

    isEntryConditionTriggered = (
        strategy: TStrategyType,
        lastDigit: number,
        targetDigit?: number,
        quoteDelta: number = 0
    ): boolean => {
        const strat = strategy.toLowerCase();

        if (strat.includes('under_7') || strat.includes('under')) {
            const trigger = targetDigit !== undefined ? targetDigit : 7;
            return lastDigit >= trigger;
        }
        if (strat.includes('over_2') || strat.includes('over')) {
            const trigger = targetDigit !== undefined ? targetDigit : 2;
            return lastDigit <= trigger;
        }
        if (strat.includes('even')) {
            return lastDigit % 2 !== 0; // Wait for ODD digit pullback before entering EVEN
        }
        if (strat.includes('odd')) {
            return lastDigit % 2 === 0; // Wait for EVEN digit pullback before entering ODD
        }
        if (strat.includes('differs')) {
            const trigger = targetDigit !== undefined ? targetDigit : 4;
            return lastDigit === trigger; // Enter DIFFERS on rare digit trigger
        }
        if (strat.includes('matches')) {
            const trigger = targetDigit !== undefined ? targetDigit : 7;
            return lastDigit !== trigger;
        }
        if (strat.includes('rise')) {
            return quoteDelta >= 0;
        }
        if (strat.includes('fall')) {
            return quoteDelta <= 0;
        }

        return true;
    };

    setupAutomationListeners = () => {
        try {
            const { observer } = require('@/external/bot-skeleton/utils/observer');
            observer.unregister('bot.contract', this.handleContractEvent);
            observer.register('bot.contract', this.handleContractEvent);
        } catch (e) {
            console.warn('[ScannerStore] Failed to register bot contract observer:', e);
        }
    };

    handleContractEvent = async (contract: any) => {
        if (!contract || !contract.is_sold) return;

        const profit = Number(contract.profit) || 0;
        const isWin = profit > 0;

        if (isWin) {
            this.consecutive_losses = 0;
            this.last_trade_result = 'WIN';
            // Clear any pending re-analysis lock so the bot runs freely after a win
            this._loss_reanalysis_pending = false;
            if (this._loss_reanalysis_timer) {
                clearTimeout(this._loss_reanalysis_timer);
                this._loss_reanalysis_timer = null;
            }
        } else {
            this.consecutive_losses += 1;
            this.last_trade_result = 'LOSS';

            // ── Post-loss re-analysis guard ──────────────────────────────────
            // After the 1st OR 2nd consecutive loss, pause the bot immediately
            // and re-analyse the market.  Only resume when a fresh high-confidence
            // signal (≥ LOSS_REANALYSIS_MIN_CONFIDENCE) is confirmed, because the
            // market may be shifting direction.
            if (this.consecutive_losses >= 1 && !this._loss_reanalysis_pending) {
                this._loss_reanalysis_pending = true;
                await this.triggerPostLossReanalysis(this.consecutive_losses);
            }

            if (this.alternate_after_losses && this.consecutive_losses >= this.switch_strategy_after_losses) {
                console.log(
                    `[ScannerStore] Loss threshold reached (${this.consecutive_losses} losses). Switching strategy...`
                );

                let nextStrategy = this.selected_strategy;
                if (this.target_switch_strategy !== 'auto') {
                    nextStrategy = this.target_switch_strategy;
                } else {
                    const strategies: TStrategyType[] =
                        this.selected_strategies.length > 1
                            ? this.selected_strategies
                            : ['even_odd', 'over_under', 'differs'];
                    const currentIndex = strategies.indexOf(this.selected_strategy);
                    nextStrategy = strategies[(currentIndex + 1) % strategies.length];
                }

                this.selected_strategy = nextStrategy;
                console.log(`[ScannerStore] Switched to new strategy: ${nextStrategy}`);
                this.rotateStrategy();
            }
        }
    };

    /**
     * Pause the bot, run a fresh market re-analysis, then wait for a high-
     * confidence signal before resuming.  Called on the 1st and 2nd consecutive
     * loss so the bot never blindly continues into a shifting market.
     */
    triggerPostLossReanalysis = async (lossCount: number) => {
        const { run_panel } = this.root_store;

        // 1. Pause the bot immediately so no new trade fires during re-analysis
        if (run_panel?.is_running && !run_panel?.is_paused) {
            run_panel.onPauseButtonClick?.();
        }

        // 2. Log the pause reason to the Journal so the user knows what's happening
        try {
            const journal = this.root_store.journal;
            if (journal?.pushMessage) {
                const emoji = lossCount >= 2 ? '🛑' : '⚠️';
                journal.pushMessage(
                    `${emoji} [LOSS GUARD] ${lossCount} consecutive loss${lossCount > 1 ? 'es' : ''}. ` +
                        `Bot paused — re-analysing market before next entry. ` +
                        `Market may be shifting. Waiting for signal ≥ ${(this.LOSS_REANALYSIS_MIN_CONFIDENCE * 100).toFixed(0)}% confidence...`,
                    'warn',
                    'journal__text--warn'
                );
            }
        } catch (_) { /* ignore */ }

        // 3. Wait a brief moment for the market to settle (2s on 1st loss, 4s on 2nd+)
        const cooldownMs = lossCount >= 2 ? 4000 : 2000;
        await new Promise(resolve => setTimeout(resolve, cooldownMs));

        // 4. Run a full fresh market analysis
        try {
            await this.analyzeMarkets();
        } catch (e) {
            console.warn('[ScannerStore] Post-loss re-analysis failed:', e);
        }

        // 5. Poll every 3 s (up to 90 s) until a high-confidence signal is confirmed
        const maxWaitMs = 90_000;
        const pollIntervalMs = 3_000;
        const startTime = Date.now();

        const waitForHighEntry = async (): Promise<void> => {
            // Abort if the bot was stopped manually or re-analysis was cleared by a win
            if (!this._loss_reanalysis_pending || this.$scope?.stopped) return;
            if (run_panel?.is_running && !run_panel?.is_paused) {
                // Bot already resumed externally — release the lock
                this._loss_reanalysis_pending = false;
                return;
            }

            // Re-analyse on each poll so the signal is truly fresh
            try { await this.analyzeMarkets(); } catch (_) { /* ignore */ }

            const bestSignal = this.signals.length > 0 ? this.signals[0] : null;
            const signalConfidence = bestSignal?.confidence ?? 0;
            const signalStatus = bestSignal?.details?.status;

            if (
                bestSignal &&
                signalStatus === 'TRADE NOW' &&
                signalConfidence >= this.LOSS_REANALYSIS_MIN_CONFIDENCE
            ) {
                // High-confidence signal confirmed — resume trading
                this._loss_reanalysis_pending = false;
                this._loss_reanalysis_timer = null;

                try {
                    const journal = this.root_store.journal;
                    if (journal?.pushMessage) {
                        journal.pushMessage(
                            `✅ [LOSS GUARD] High-confidence entry found: ${bestSignal.strategy.toUpperCase()} on ` +
                                `${bestSignal.symbol} at ${(signalConfidence * 100).toFixed(1)}% confidence. ` +
                                `Resuming bot now...`,
                            'success',
                            'journal__text--success'
                        );
                    }
                } catch (_) { /* ignore */ }

                // Load the freshly confirmed strategy then resume
                this.current_signal = bestSignal;
                try { await this.loadBotWithStrategy(); } catch (_) { /* ignore */ }
                setTimeout(() => {
                    if (run_panel?.is_running && run_panel?.is_paused) {
                        run_panel.onResumeFromPause?.();
                    } else if (!run_panel?.is_running) {
                        run_panel.onRunButtonClick?.();
                    }
                }, 1000);
                return;
            }

            // Timed out — log and stay paused; don't force a bad trade
            if (Date.now() - startTime >= maxWaitMs) {
                this._loss_reanalysis_pending = false;
                this._loss_reanalysis_timer = null;
                try {
                    const journal = this.root_store.journal;
                    if (journal?.pushMessage) {
                        journal.pushMessage(
                            `⏸️ [LOSS GUARD] No high-confidence entry found after 90 s. ` +
                                `Bot remains paused. Resume manually when conditions improve.`,
                            'warn',
                            'journal__text--warn'
                        );
                    }
                } catch (_) { /* ignore */ }
                return;
            }

            // Schedule the next poll
            this._loss_reanalysis_timer = setTimeout(waitForHighEntry, pollIntervalMs);
        };

        // Kick off the first poll
        await waitForHighEntry();
    };

    rotateStrategy = async () => {
        if (this.selected_strategies.length > 1) {
            this.current_strategy_index = (this.current_strategy_index + 1) % this.selected_strategies.length;
            const nextStrategy = this.selected_strategies[this.current_strategy_index];

            const { run_panel } = this.root_store;
            run_panel.stopBot();

            const bestSignal = this.signals.find(s => s.strategy === nextStrategy);
            if (bestSignal) {
                this.current_signal = bestSignal;
                console.log(`[ScannerStore] Switching to new strategy: ${nextStrategy} on symbol ${bestSignal.symbol}`);

                await this.loadBotWithStrategy();

                setTimeout(() => {
                    run_panel.onRunButtonClick();
                }, 1500);
            } else {
                console.log(`[ScannerStore] No active signals for strategy: ${nextStrategy}. Waiting...`);
            }
        }
    };

    evaluateMarketPower = () => {
        if (!this.is_auto_trading || !this.current_signal) return;

        const activeSignal = this.signals.find(
            s => s.symbol === this.current_signal?.symbol && s.strategy === this.current_signal?.strategy
        );

        const { run_panel } = this.root_store;

        if (!activeSignal || activeSignal.confidence < 0.6) {
            if (run_panel.is_running && !run_panel.is_paused) {
                console.log(
                    `[ScannerStore] Market power shifted (confidence: ${activeSignal ? activeSignal.confidence : 'none'}). Pausing bot...`
                );
                run_panel.onPauseButtonClick();
            }
        } else if (activeSignal && activeSignal.confidence >= 0.65) {
            if (run_panel.is_running && run_panel.is_paused) {
                console.log(
                    `[ScannerStore] Market power aligned (confidence: ${activeSignal.confidence}). Resuming bot...`
                );
                run_panel.onResumeFromPause();
            } else if (!run_panel.is_running && !this.is_bot_loading) {
                this.is_bot_loading = true;
                console.log(
                    `[ScannerStore] Strong signal detected (confidence: ${activeSignal.confidence}). Loading and starting bot...`
                );
                this.loadBotWithStrategy()
                    .then(() => {
                        setTimeout(() => {
                            run_panel.onRunButtonClick();
                            this.is_bot_loading = false;
                        }, 1500);
                    })
                    .catch(() => {
                        this.is_bot_loading = false;
                    });
            }
        }
    };

    setAutoTrading = (is_auto: boolean) => {
        this.is_auto_trading = is_auto;
    };

    private analyzeMarkets = async () => {
        if (!api_base.api) {
            console.warn('[ScannerStore] Deriv API client not initialized.');
            return;
        }

        // Start with a copy of existing signals
        let updatedSignals = [...this.signals];

        const symbolsToScan = this.scan_market_mode === 'single' ? [this.single_market_symbol] : this.selected_symbols;

        for (const symbol of symbolsToScan) {
            try {
                const ticks = this.ticks_cache.get(symbol);
                if (!ticks || ticks.length < 50) continue; // Skip if not enough ticks yet

                const analysisResult = this.analyzeTicks(ticks, symbol);
                this.setSymbolAnalysis(symbol, analysisResult);

                const allStd = this.generateAllSignals(analysisResult, symbol);
                const allPro = this.generateProSignals(analysisResult);

                for (const strat of this.selected_strategies) {
                    if (strat === 'super') {
                        const superSignals = this.generateSuperSignals(analysisResult, symbol);

                        for (const signal of superSignals) {
                            const isConfirmed = await this.checkSignalConfirmation(
                                symbol,
                                signal.type,
                                signal,
                                analysisResult
                            );
                            const idx = updatedSignals.findIndex(
                                s => s.symbol === symbol && s.strategy === signal.type
                            );

                            if (isConfirmed) {
                                const scanSignal: TScanSignal = {
                                    symbol,
                                    strategy: signal.type,
                                    confidence: signal.probability,
                                    timestamp: Date.now(),
                                    details: signal,
                                    analysisResult,
                                };
                                if (idx > -1) {
                                    updatedSignals[idx] = scanSignal;
                                } else {
                                    updatedSignals.push(scanSignal);
                                }
                            } else {
                                if (idx > -1) {
                                    updatedSignals.splice(idx, 1);
                                }
                            }
                        }
                    } else {
                        const signal = allStd.get(strat) || allPro.get(strat);
                        const isConfirmed =
                            signal && (signal.status === 'TRADE NOW' || signal.status === 'WAIT')
                                ? await this.checkSignalConfirmation(symbol, strat, signal, analysisResult)
                                : false;

                        const idx = updatedSignals.findIndex(s => s.symbol === symbol && s.strategy === strat);

                        if (signal && (signal.status === 'TRADE NOW' || signal.status === 'WAIT') && isConfirmed) {
                            const scanSignal: TScanSignal = {
                                symbol,
                                strategy: strat,
                                confidence: signal.probability,
                                timestamp: Date.now(),
                                details: signal,
                                analysisResult,
                            };
                            if (idx > -1) {
                                updatedSignals[idx] = scanSignal;
                            } else {
                                updatedSignals.push(scanSignal);
                            }
                        } else {
                            // Remove from active signals since the signal power changed to NEUTRAL or failed confirmation
                            if (idx > -1) {
                                updatedSignals.splice(idx, 1);
                            }
                        }
                    }
                }
            } catch (error) {
                console.error(`[ScannerStore] Error analyzing symbol ${symbol}:`, error);
            }
        }

        // Keep unique signals and sort by confidence
        const uniqueSignals = new Map<string, TScanSignal>();
        for (const sig of updatedSignals) {
            const key = `${sig.symbol}-${sig.strategy}`;
            uniqueSignals.set(key, sig);
        }

        this.signals = Array.from(uniqueSignals.values())
            .sort((a, b) => b.confidence - a.confidence)
            .slice(0, 20);

        // Update current signal if not manually selected
        if (!this.is_manual_selection) {
            if (this.signals.length > 0) {
                this.current_signal = this.signals[0];
            } else {
                this.current_signal = null;
            }
        }

        this.evaluateMarketPower();
    };

    loadBotWithStrategy = async () => {
        if (!this.current_signal) return;

        const signalToUse = mapSignalToBestSignal(this.current_signal);
        const entryDigit = (this as any).prediction_override ?? signalToUse?.targetDigit ?? undefined;

        const strategyName = this.current_signal.strategy;
        const strategyOptions = [
            { value: 'even_odd', label: 'Even/Odd' },
            { value: 'over_under', label: 'Over/Under' },
            { value: 'matches', label: 'Matches' },
            { value: 'differs', label: 'Differs' },
            { value: 'rise_fall', label: 'Rise/Fall' },
            { value: 'pro_even_odd', label: 'Pro E/O' },
            { value: 'pro_over_under', label: 'Pro O/U' },
            { value: 'pro_differs', label: 'Pro Diff' },
            { value: 'under_7', label: 'Under 7' },
            { value: 'over_2', label: 'Over 2' },
            { value: 'super', label: 'Super' },
        ];
        const tradeTypeLabel = strategyOptions.find(t => t.value === strategyName)?.label ?? strategyName;

        const recMode = (this as any).rec_mode;
        const recovery = recMode
            ? {
                  lossThreshold: (this as any).rec_loss_threshold ?? 3,
                  altTradeTypeId: (this as any).rec_alt_type ?? 'even_odd',
              }
            : undefined;

        const xml = generateBotXML({
            stake: this.stake.toString(),
            takeProfit: this.take_profit.toString(),
            stopLoss: this.stop_loss.toString(),
            martingale: this.martingale_multiplier.toString(),
            symbol: this.current_signal.symbol,
            tradeTypeLabel,
            bestSignal: signalToUse,
            entryDigit,
            recovery,
        });

        try {
            if (typeof window !== 'undefined' && window.Blockly?.derivWorkspace) {
                const name = `ProAI_${tradeTypeLabel.replace(/[\s/]/g, '_')}_${this.current_signal.symbol}`;
                const { load_modal, dashboard } = this.root_store;
                if (load_modal && dashboard) {
                    await load_modal.loadStrategyToBuilder({
                        id: name,
                        name,
                        xml,
                        save_type: 'local',
                        timestamp: Date.now(),
                    });
                    dashboard.setActiveTab(1);
                }
            }
        } catch (e) {
            console.error('[ScannerStore] Failed to load strategy XML directly to Blockly:', e);
        }
    };

    loadBotAndRun = async () => {
        await this.loadBotWithStrategy();
        setTimeout(() => {
            const { run_panel } = this.root_store;
            run_panel.onRunButtonClick();
        }, 1000);
    };
}
