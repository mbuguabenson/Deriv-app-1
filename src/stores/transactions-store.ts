import { action, computed, makeObservable, observable, reaction, runInAction } from 'mobx';
import { formatDate, isEnded } from '@/components/shared';
import { api_base, LogTypes, observer as globalObserver, observer } from '@/external/bot-skeleton';
import { ProposalOpenContract } from '@deriv/api-types';
// @ts-ignore
import { TPortfolioPosition, TStores } from '@deriv/stores/types';
import { TContractInfo } from '../components/summary/summary-card.types';
import { transaction_elements } from '../constants/transactions';
import { getStoredItemsByKey, getStoredItemsByUser, setStoredItemsByKey } from '../utils/session-storage';
import RootStore from './root-store';

type TTransaction = {
    type: string;
    data?: string | TContractInfo;
};

type TElement = {
    [key: string]: TTransaction[];
};

export default class TransactionsStore {
    root_store: RootStore;
    core: TStores;
    disposeReactionsFn: () => void;
    private pocSubscription: any = null;

    constructor(root_store: RootStore, core: TStores) {
        this.root_store = root_store;
        this.core = core;
        this.is_transaction_details_modal_open = false;

        const activeUser =
            this.core?.client?.loginid ||
            (typeof localStorage !== 'undefined'
                ? localStorage.getItem('active_loginid') || localStorage.getItem('client.loginid')
                : '') ||
            'default';
        const storedMap = getStoredItemsByKey(this.TRANSACTION_CACHE, {});
        this.elements = storedMap[activeUser]?.length
            ? { [activeUser]: storedMap[activeUser], ...storedMap }
            : getStoredItemsByUser(this.TRANSACTION_CACHE, activeUser, []);

        this.disposeReactionsFn = this.registerReactions();

        // ── Permanent Observers so trades are never dropped ──
        observer.register('bot.contract', this.onBotContractEvent);
        globalObserver.register('bot.contract', this.onBotContractEvent);

        if (typeof window !== 'undefined') {
            window.addEventListener('bot_contract_event', (e: any) => {
                if (e?.detail) this.onBotContractEvent(e.detail);
            });
            window.addEventListener('contract_purchased', (e: any) => {
                if (e?.detail) this.onBotContractEvent(e.detail);
            });
            window.addEventListener('contract_settled', (e: any) => {
                if (e?.detail) this.onBotContractEvent(e.detail);
            });
            window.addEventListener('transaction_recorded', (e: any) => {
                if (e?.detail) this.onBotContractEvent(e.detail);
            });
        }

        // Direct live Deriv WebSocket proposal_open_contract listener
        const hookWebSocketPOC = () => {
            try {
                if (api_base?.api?.onMessage) {
                    if (this.pocSubscription?.unsubscribe) {
                        this.pocSubscription.unsubscribe();
                    }
                    this.pocSubscription = api_base.api.onMessage().subscribe(({ data }: any) => {
                        if (data?.msg_type === 'proposal_open_contract' && data.proposal_open_contract) {
                            const poc = data.proposal_open_contract;
                            this.onBotContractEvent({
                                accountID: poc.account_id || api_base?.account_info?.loginid,
                                ...poc,
                            });
                        }
                    });
                }
            } catch (err) {
                console.warn('[TransactionsStore] WS POC hook error:', err);
            }
        };

        hookWebSocketPOC();
        observer.register('api.authorize', hookWebSocketPOC);

        makeObservable(this, {
            elements: observable,
            active_transaction_id: observable,
            recovered_completed_transactions: observable,
            recovered_transactions: observable,
            is_called_proposal_open_contract: observable,
            is_transaction_details_modal_open: observable,
            total_completed_runs: observable,
            total_profit_accumulator: observable,
            total_stake_accumulator: observable,
            total_payout_accumulator: observable,
            total_won_accumulator: observable,
            total_lost_accumulator: observable,
            transactions: computed,
            active_loginid: computed,
            contracts: computed,
            onBotContractEvent: action.bound,
            pushTransaction: action.bound,
            clear: action.bound,
            registerReactions: action.bound,
            recoverPendingContracts: action.bound,
            updateResultsCompletedContract: action.bound,
            sortOutPositionsBeforeAction: action.bound,
            recoverPendingContractsById: action.bound,
        });
    }
    TRANSACTION_CACHE = 'transaction_cache';

    elements: TElement;
    active_transaction_id: null | number = null;
    recovered_completed_transactions: number[] = [];
    private _recovered_set = new Set<number>();
    private _recovered_completed_set = new Set<number>();
    // Persistent counter that survives array truncation
    total_completed_runs = 0;
    total_profit_accumulator = 0;
    total_stake_accumulator = 0;
    total_payout_accumulator = 0;
    total_won_accumulator = 0;
    total_lost_accumulator = 0;
    recovered_transactions: number[] = [];
    is_called_proposal_open_contract = false;
    is_transaction_details_modal_open = false;

    get active_loginid(): string {
        return (
            this.core?.client?.loginid ||
            (typeof localStorage !== 'undefined'
                ? localStorage.getItem('active_loginid') || localStorage.getItem('client.loginid')
                : '') ||
            'default'
        );
    }

    get transactions(): TTransaction[] {
        const id = this.active_loginid;
        const list = this.elements[id];
        if (list && list.length > 0) return list;

        if (id !== 'default' && this.elements['default']?.length > 0) {
            return this.elements['default'];
        }
        if (this.elements['']?.length > 0) {
            return this.elements[''];
        }
        for (const k of Object.keys(this.elements)) {
            if (this.elements[k]?.length > 0) {
                return this.elements[k];
            }
        }
        return [];
    }

    get contracts(): TContractInfo[] {
        return this.transactions
            .filter(item => item.type === transaction_elements.CONTRACT && typeof item.data === 'object' && item.data !== null)
            .map(item => item.data as TContractInfo);
    }

    get statistics() {
        return {
            number_of_runs: this.total_completed_runs,
            total_profit: this.total_profit_accumulator,
            total_stake: this.total_stake_accumulator,
            total_payout: this.total_payout_accumulator,
            won_contracts: this.total_won_accumulator,
            lost_contracts: this.total_lost_accumulator,
        };
    }

    toggleTransactionDetailsModal = (is_open: boolean) => {
        this.is_transaction_details_modal_open = is_open;
    };

    onBotContractEvent(data: TContractInfo) {
        this.pushTransaction(data);
    }

    pushTransaction(data: TContractInfo) {
        const is_completed = isEnded(data as ProposalOpenContract);
        const { run_id } = this.root_store.run_panel;
        const current_account =
            (data as any)?.accountID ||
            (data as any)?.loginid ||
            this.core?.client?.loginid ||
            (typeof localStorage !== 'undefined'
                ? localStorage.getItem('active_loginid') || localStorage.getItem('client.loginid')
                : '') ||
            'default';

        const contract: TContractInfo = {
            ...data,
            is_completed,
            run_id,
            date_start: formatDate(data.date_start, 'YYYY-M-D HH:mm:ss [GMT]'),
            entry_tick: data.entry_spot ?? undefined,
            entry_tick_time: data.entry_tick_time
                ? formatDate(data.entry_tick_time, 'YYYY-M-D HH:mm:ss [GMT]')
                : undefined,
            exit_tick: (data as any).exit_spot ?? data.exit_tick ?? undefined,
            exit_tick_time: data.exit_tick_time && formatDate(data.exit_tick_time, 'YYYY-M-D HH:mm:ss [GMT]'),
            profit: is_completed ? (typeof data.profit === 'number' ? data.profit : parseFloat(data.profit as any || '0')) : 0,
        };

        if (!this.elements[current_account]) {
            this.elements = {
                ...this.elements,
                [current_account]: [],
            };
        }

        const incoming_contract_id = (data as any).contract_id || (data as any).id || (data as any).transaction_id;
        const incoming_buy_id = data.transaction_ids?.buy;

        const account_elements = this.elements[current_account] || [];

        // Fast-path: 99% of contract updates are for the most recent contract (index 0 or 1 if divider was added)
        let same_contract_index = -1;
        const checkCount = Math.min(account_elements.length, 6);
        for (let i = 0; i < checkCount; i++) {
            const c = account_elements[i];
            if (c.type === transaction_elements.CONTRACT && typeof c.data === 'object' && c.data !== null) {
                const cData = c.data as TContractInfo;
                const existing_contract_id =
                    (cData as any).contract_id || (cData as any).id || (cData as any).transaction_id;
                const existing_buy_id = cData.transaction_ids?.buy;

                if (
                    (incoming_contract_id && existing_contract_id && String(incoming_contract_id) === String(existing_contract_id)) ||
                    (incoming_buy_id && existing_buy_id && String(incoming_buy_id) === String(existing_buy_id))
                ) {
                    same_contract_index = i;
                    break;
                }
            }
        }

        if (same_contract_index === -1 && account_elements.length > 6) {
            same_contract_index = account_elements.findIndex(c => {
                if (typeof c.data === 'string' || c.type !== transaction_elements.CONTRACT) return false;
                const cData = c.data as TContractInfo;
                const existing_contract_id =
                    (cData as any).contract_id || (cData as any).id || (cData as any).transaction_id;
                const existing_buy_id = cData.transaction_ids?.buy;

                if (incoming_contract_id && existing_contract_id) {
                    return String(incoming_contract_id) === String(existing_contract_id);
                }
                if (incoming_buy_id && existing_buy_id) {
                    return String(incoming_buy_id) === String(existing_buy_id);
                }
                return false;
            });
        }

        if (same_contract_index === -1) {
            // Render a divider if the "run_id" for this contract is different.
            if (account_elements.length > 0) {
                const temp_contract = account_elements[0];
                const is_contract = temp_contract.type === transaction_elements.CONTRACT;
                const is_new_run =
                    is_contract &&
                    typeof temp_contract.data === 'object' &&
                    contract.run_id !== temp_contract?.data?.run_id;

                if (is_new_run) {
                    account_elements.unshift({
                        type: transaction_elements.DIVIDER,
                        data: contract.run_id,
                    });
                }
            }

            account_elements.unshift({
                type: transaction_elements.CONTRACT,
                data: contract,
            });

            // Accumulate stats if this new contract is already completed
            if (is_completed) {
                const profit = Number(data.profit) || 0;
                const buy_price = Number(data.buy_price) || 0;
                const payout = Number(data.payout) || Number(data.bid_price) || 0;
                this.total_completed_runs += 1;
                this.total_profit_accumulator += profit;
                this.total_stake_accumulator += buy_price;
                if (profit > 0) {
                    this.total_won_accumulator += 1;
                    this.total_payout_accumulator += payout;
                } else {
                    this.total_lost_accumulator += 1;
                }
            }

            // Keep in-memory drawer elements bounded to 500 items for high-performance rendering
            if (account_elements.length > 500) {
                account_elements.length = 500;
            }
        } else {
            // Update existing contract data in-place
            const existing = account_elements[same_contract_index];
            const existingData = typeof existing.data === 'object' ? (existing.data as TContractInfo) : null;
            const wasAlreadyCompleted = existingData?.is_completed;

            account_elements[same_contract_index] = {
                ...existing,
                data: {
                    ...(typeof existing.data === 'object' ? existing.data : {}),
                    ...contract,
                },
            };

            // Accumulate stats when contract transitions to completed (only once)
            if (is_completed && !wasAlreadyCompleted) {
                const profit = Number(data.profit) || 0;
                const buy_price = Number(data.buy_price) || 0;
                const payout = Number(data.payout) || Number(data.bid_price) || 0;
                this.total_completed_runs += 1;
                this.total_profit_accumulator += profit;
                this.total_stake_accumulator += buy_price;
                if (profit > 0) {
                    this.total_won_accumulator += 1;
                    this.total_payout_accumulator += payout;
                } else {
                    this.total_lost_accumulator += 1;
                }
            }
        }

        this.elements = {
            ...this.elements,
            [current_account]: [...account_elements],
        };
    }

    clear() {
        if (this.elements && this.elements[this.core?.client?.loginid as string]?.length > 0) {
            this.elements[this.core?.client?.loginid as string] = [];
        }
        this.recovered_completed_transactions = this.recovered_completed_transactions?.slice(0, 0);
        this.recovered_transactions = this.recovered_transactions?.slice(0, 0);
        this._recovered_set.clear();
        this._recovered_completed_set.clear();
        this.is_transaction_details_modal_open = false;
        this.total_completed_runs = 0;
        this.total_profit_accumulator = 0;
        this.total_stake_accumulator = 0;
        this.total_payout_accumulator = 0;
        this.total_won_accumulator = 0;
        this.total_lost_accumulator = 0;
    }

    registerReactions() {
        let storageDebounceTimer: ReturnType<typeof setTimeout> | null = null;
        // Write transactions to session storage with debounce to prevent UI freezes on high-frequency bulk trades
        const disposeTransactionElementsListener = reaction(
            () => this.transactions.length,
            () => {
                if (storageDebounceTimer) clearTimeout(storageDebounceTimer);
                storageDebounceTimer = setTimeout(() => {
                    const activeId = this.active_loginid;
                    const stored_transactions = getStoredItemsByKey(this.TRANSACTION_CACHE, {});
                    stored_transactions[activeId] = (this.transactions ?? []).slice(0, 200);
                    setStoredItemsByKey(this.TRANSACTION_CACHE, stored_transactions);
                }, 500);
            }
        );

        // User could've left the page mid-contract. On initial load, try
        // to recover any pending contracts so we can reflect accurate stats.
        // Guarded so it does NOT execute on every single trade while the bot is running.
        const disposeRecoverContracts = reaction(
            () => this.transactions.length,
            () => {
                if (!this.root_store.run_panel?.is_running) {
                    this.recoverPendingContracts();
                }
            }
        );

        return () => {
            if (storageDebounceTimer) clearTimeout(storageDebounceTimer);
            disposeTransactionElementsListener();
            disposeRecoverContracts();
        };
    }

    recoverPendingContracts(contract = null) {
        this.transactions.forEach(({ data: trx }) => {
            if (
                typeof trx === 'string' ||
                trx?.is_completed ||
                !trx?.contract_id ||
                this._recovered_set.has(trx.contract_id) ||
                this.recovered_transactions.includes(trx?.contract_id)
            )
                return;
            this.recoverPendingContractsById(trx.contract_id, contract);
        });
    }

    updateResultsCompletedContract(contract: ProposalOpenContract) {
        const { journal, summary_card } = this.root_store;
        const { contract_info } = summary_card;
        const { currency, profit } = contract;

        if (contract.contract_id !== contract_info?.contract_id) {
            this.onBotContractEvent(contract);

            if (contract.contract_id && !this._recovered_set.has(contract.contract_id)) {
                this._recovered_set.add(contract.contract_id);
                this.recovered_transactions.push(contract.contract_id);
            }
            if (
                contract.contract_id &&
                !this._recovered_completed_set.has(contract.contract_id) &&
                isEnded(contract)
            ) {
                this._recovered_completed_set.add(contract.contract_id);
                this.recovered_completed_transactions.push(contract.contract_id);

                journal.onLogSuccess({
                    log_type: profit && profit > 0 ? LogTypes.PROFIT : LogTypes.LOST,
                    extra: { currency, profit },
                });
            }
        }
    }

    sortOutPositionsBeforeAction(positions: TPortfolioPosition[], element_id?: number) {
        positions?.forEach(position => {
            if (!element_id || (element_id && position.id === element_id)) {
                const contract_details = position.contract_info;
                this.updateResultsCompletedContract(contract_details);
            }
        });
    }

    async recoverPendingContractsById(contract_id: number, contract: ProposalOpenContract | null = null) {
        // TODO: need to fix as the portfolio is not available now
        // const positions = this.core.portfolio.positions;
        const positions: unknown[] = [];

        if (contract) {
            this.is_called_proposal_open_contract = true;
            if (contract.contract_id === contract_id) {
                this.updateResultsCompletedContract(contract);
            }
        }

        if (!this.is_called_proposal_open_contract) {
            if (this.core?.client?.loginid) {
                const current_account = this.core?.client?.loginid;
                if (!this.elements[current_account]?.length) {
                    this.sortOutPositionsBeforeAction(positions);
                }

                const elements = this.elements[current_account];
                const [element = null] = elements;
                if (typeof element?.data === 'object' && !element?.data?.profit) {
                    const element_id = element.data.contract_id;
                    this.sortOutPositionsBeforeAction(positions, element_id);
                }
            }
        }
    }
}
