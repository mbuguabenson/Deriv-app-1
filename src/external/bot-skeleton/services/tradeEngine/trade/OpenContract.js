import { getRoundedNumber } from '@/components/shared';
import DBotStore from '../../../scratch/dbot-store';
import { api_base } from '../../api/api-base';
import { contract as broadcastContract, contractStatus } from '../utils/broadcast';
import { isFastModeActive } from '../utils/fastMode';
import { openContractReceived, sell } from './state/actions';

export default Engine =>
    class OpenContract extends Engine {
        observeOpenContract() {
            if (!api_base.api) return;
            const subscription = api_base.api.onMessage().subscribe(({ data }) => {
                if (data.msg_type === 'proposal_open_contract') {
                    const contract = data.proposal_open_contract;

                    if (!contract || !this.expectedContractId(contract?.contract_id)) {
                        return;
                    }

                    // Deriv delivers subscription.id at the root message level, not inside proposal_open_contract
                    if (data.subscription?.id && contract.contract_id) {
                        if (!this.contract_subscription_ids) {
                            this.contract_subscription_ids = new Map();
                        }
                        this.contract_subscription_ids.set(String(contract.contract_id), data.subscription.id);
                    }

                    if (this.bulk_group_map && this.bulk_group_map[contract.contract_id]) {
                        contract.bulk_group_id = this.bulk_group_map[contract.contract_id];
                    }

                    broadcastContract({ accountID: api_base.account_info?.loginid, ...contract });

                    const isFast = isFastModeActive();
                    const isContractFinished = Boolean(
                        contract.is_sold ||
                        (isFast && (contract.is_expired || (contract.status && contract.status !== 'open')))
                    );

                    if (isContractFinished) {
                        this.handleContractSold(contract);
                    } else {
                        this.setContractFlags(contract);
                        this.data.contract = contract;
                        this.store.dispatch(openContractReceived());
                    }
                }
            });
            api_base.pushSubscription(subscription);
        }

        handleContractSold(contract) {
            if (!contract) return;
            const cId = String(contract.contract_id);
            if (!this.bulk_sold_contract_ids) {
                this.bulk_sold_contract_ids = new Set();
            }

            if (this.bulk_sold_contract_ids.has(cId)) {
                return;
            }
            this.bulk_sold_contract_ids.add(cId);

            // Enrich contract if sell_price is not yet populated on immediate is_expired exit
            const enrichedContract = { ...contract };
            const buyPrice = Number(enrichedContract.buy_price || 0);
            if (enrichedContract.sell_price === undefined || enrichedContract.sell_price === null) {
                if (enrichedContract.profit !== undefined && enrichedContract.profit !== null) {
                    enrichedContract.sell_price = buyPrice + Number(enrichedContract.profit);
                } else if (enrichedContract.status === 'won') {
                    enrichedContract.sell_price = Number(enrichedContract.payout || buyPrice * 1.95);
                } else if (enrichedContract.status === 'lost') {
                    enrichedContract.sell_price = 0;
                }
            }
            if (enrichedContract.profit === undefined || enrichedContract.profit === null) {
                if (enrichedContract.sell_price !== undefined) {
                    enrichedContract.profit = Number(enrichedContract.sell_price) - buyPrice;
                }
            }

            // Post win/loss result in Journal & update statistics for this contract
            this.updateTotals(enrichedContract);

            // Clean up Deriv contract stream immediately so WebSocket does not accumulate subscriptions
            try {
                const subId = this.contract_subscription_ids?.get(cId) || contract?.subscription?.id;
                if (subId) {
                    api_base.api?.send({ forget: subId }).catch(() => {});
                    this.contract_subscription_ids?.delete(cId);
                }
            } catch (e) {}

            const isBulk = Boolean(this.bulk_contract_ids && this.bulk_contract_ids.size > 1);
            const allBulkDone = !isBulk || this.bulk_sold_contract_ids.size >= this.bulk_contract_ids.size;

            if (allBulkDone) {
                // Cancel any pending watchdog timers immediately
                if (typeof this._clearWatchdog === 'function') {
                    this._clearWatchdog();
                }

                this.setContractFlags(enrichedContract);
                this.data.contract = enrichedContract;
                this.isSold = true;
                this.contractId = '';
                if (this.bulk_contract_ids) this.bulk_contract_ids.clear();
                if (this.bulk_sold_contract_ids) this.bulk_sold_contract_ids.clear();
                this.lastPurchasedTickEpoch = undefined;
                clearTimeout(this.transaction_recovery_timeout);

                contractStatus({
                    id: 'contract.sold',
                    data: enrichedContract.transaction_ids?.sell,
                    contract: enrichedContract,
                });

                if (this.afterPromise) {
                    // Null-guard: capture and clear BEFORE calling, so a racing
                    // watchdog / subscription double-fire can't resolve the NEXT
                    // run cycle's waitForAfter() promise.
                    const ap = this.afterPromise;
                    this.afterPromise = null;
                    ap();
                }

                // If no more open contracts, ensure all contract streams on WebSocket are forgotten
                try {
                    if (!this.contract_subscription_ids || this.contract_subscription_ids.size === 0) {
                        api_base.api?.send({ forget_all: 'proposal_open_contract' }).catch(() => {});
                    }
                } catch (e) {}

                // ⚡ ZERO-DELAY BALANCE UPDATE:
                // 1. Optimistic instant balance credit: if the contract resulted in a payout,
                // immediately reflect it on the client balance without waiting for network latency.
                try {
                    const { client } = DBotStore.instance || {};
                    const payout = parseFloat(enrichedContract.sell_price ?? enrichedContract.payout ?? 0) || 0;
                    if (client && typeof client.balance !== 'undefined' && payout > 0) {
                        const currentBal = parseFloat(String(client.balance).replace(/,/g, '')) || 0;
                        const targetId = this.accountInfo?.loginid || client.loginid;
                        if (client.setBalance && currentBal > 0) {
                            client.setBalance((currentBal + payout).toFixed(2), targetId);
                        }
                    }
                } catch (e) {}

                // 2. Immediate WebSocket balance reconciliation:
                // Request fresh official balance from Deriv in BOTH Normal and Speed/Fast mode
                // so the user's balance is guaranteed accurate to the cent with zero lag.
                try {
                    if (api_base.api) {
                        api_base.api.send({ balance: 1 }).then(res => {
                            if (res?.balance && typeof res.balance.balance === 'number') {
                                const { client } = DBotStore.instance || {};
                                if (client?.setBalance) {
                                    client.setBalance(
                                        res.balance.balance.toString(),
                                        res.balance.loginid || this.accountInfo?.loginid || client.loginid
                                    );
                                }
                            }
                        }).catch(() => {});
                    }
                } catch (e) {}

                this.store.dispatch(sell());
            }
        }

        waitForAfter() {
            if (this.isSold) {
                return Promise.resolve();
            }
            return new Promise(resolve => {
                this.afterPromise = resolve;
            });
        }

        setContractFlags(contract) {
            const { is_expired, is_valid_to_sell, is_sold, entry_tick, status } = contract;
            const isFast = isFastModeActive();

            this.isSold = Boolean(is_sold || (isFast && (is_expired || (status && status !== 'open'))));
            this.isSellAvailable = !this.isSold && Boolean(is_valid_to_sell);
            this.isExpired = Boolean(is_expired);
            this.hasEntryTick = Boolean(entry_tick);
        }

        expectedContractId(contractId) {
            if (!contractId) return false;
            const cIdStr = String(contractId);
            if (this.bulk_contract_ids && this.bulk_contract_ids.has(cIdStr)) {
                return true;
            }
            return Boolean(this.contractId && String(this.contractId) === cIdStr);
        }

        getSellPrice() {
            const { bid_price: bidPrice, buy_price: buyPrice, currency } = this.data.contract;
            return getRoundedNumber(Number(bidPrice) - Number(buyPrice), currency);
        }
    };
