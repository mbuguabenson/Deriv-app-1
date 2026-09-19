import { LogTypes } from '../../../constants/messages';
import DBotStore from '../../../scratch/dbot-store';
import { api_base } from '../../api/api-base';
import { contractStatus, info, log } from '../utils/broadcast';
import { isFastModeActive, setFastExecutionOverride } from '../utils/fastMode';
import { doUntilDone, getUUID, recoverFromError, tradeOptionToBuy } from '../utils/helpers';
import { proposalsReady, purchaseSuccessful, sell } from './state/actions';
import { BEFORE_PURCHASE } from './state/constants';
import { observer as globalObserver } from '../../../utils/observer';

let delayIndex = 0;
let purchase_reference;

export default Engine =>
    class Purchase extends Engine {
        bulkPurchase(contract_type, count) {
            this.purchase_block_allow_bulk = 'yes';
            this.purchase_block_bulk_count = count;
            return this.purchase(contract_type);
        }

        // ─── Watchdog helpers ──────────────────────────────────────────────────────
        // Store all active watchdog timers so they can be cleared when a contract
        // is sold (normal path) and do not accumulate across hundreds of runs.
        _clearWatchdog() {
            if (this._watchdogTimer) {
                clearTimeout(this._watchdogTimer);
                this._watchdogTimer = null;
            }
            if (this._bulkWatchdogTimer) {
                clearTimeout(this._bulkWatchdogTimer);
                this._bulkWatchdogTimer = null;
            }
        }

        // ─── Purchase (single trade) ───────────────────────────────────────────────
        async purchase(contract_type, is_fast_override) {
            const blockFastOn =
                is_fast_override === true ||
                is_fast_override === 'true' ||
                is_fast_override === 'TRUE' ||
                is_fast_override === 1;
            if (blockFastOn) {
                setFastExecutionOverride(true);
            }

            const isFastMode = blockFastOn || isFastModeActive();
            if (isFastMode) {
                this.is_proposal_subscription_required = false;
                if (!this.store.getState().proposalsReady) {
                    this.store.dispatch(proposalsReady());
                }
            }

            if (this.multiple_trades_count > 1) {
                const count = this.multiple_trades_count;
                this.multiple_trades_count = 0; // Reset flag for subsequent runs
                return this.bulkPurchase(contract_type, count);
            }

            // Prevent duplicate parallel purchases or purchases when stopped
            if (this.is_contract_buying_in_progress || this.$scope?.stopped) {
                return Promise.resolve();
            }

            // If paused, wait for resume before proceeding with purchase
            if (typeof window !== 'undefined' && window.is_bot_paused) {
                await new Promise(resolve => {
                    let resolved = false;
                    const onResume = () => {
                        if (resolved) return;
                        resolved = true;
                        globalObserver.unregister('bot.resume', onResume);
                        resolve();
                    };
                    globalObserver.register('bot.resume', onResume);
                    if (!window.is_bot_paused) onResume();
                });
                if (this.$scope?.stopped) {
                    return Promise.resolve();
                }
            }

            this.is_contract_buying_in_progress = true;

            if (this.store.getState().scope !== BEFORE_PURCHASE) {
                this.is_contract_buying_in_progress = false;
                return Promise.resolve();
            }

            const onSuccess = response => {
                this.is_contract_buying_in_progress = false;

                if (this.$scope?.stopped) {
                    return;
                }

                const { buy } = response;

                if (buy && typeof buy.balance_after === 'number') {
                    try {
                        const { client } = DBotStore.instance || {};
                        if (client?.setBalance) {
                            client.setBalance(
                                buy.balance_after.toString(),
                                this.accountInfo?.loginid || client.loginid
                            );
                        }
                    } catch (e) {}
                }

                contractStatus({
                    id: 'contract.purchase_received',
                    data: buy.transaction_id,
                    buy,
                });

                this.contractId = String(buy.contract_id);
                this.bulk_contract_ids = new Set([String(buy.contract_id)]);
                this.bulk_sold_contract_ids = new Set();
                this.store.dispatch(purchaseSuccessful());

                if (this.is_proposal_subscription_required && !isFastMode) {
                    this.renewProposalsOnPurchase();
                }

                // Stream proposal_open_contract real-time updates for this purchased contract
                if (api_base.api && buy.contract_id) {
                    try {
                        api_base.api.send({
                            proposal_open_contract: 1,
                            contract_id: buy.contract_id,
                            subscribe: 1,
                        });
                    } catch {}
                }

                // 🛡️ POC Watchdog Recovery Timer: Auto-poll contract completion if stream is delayed.
                // Store on `this` so handleContractSold() can clear it immediately when the
                // contract settles via the normal subscription path — preventing timer accumulation.
                const purchasedContractId = buy.contract_id;
                const watchdogDuration = Number(this.tradeOptions?.duration || 5) * 1200 + 3500;

                this._clearWatchdog();
                this._watchdogTimer = setTimeout(async () => {
                    this._watchdogTimer = null;
                    if (this.contractId === String(purchasedContractId) && !this.isSold) {
                        try {
                            const res = await api_base.api?.send({
                                proposal_open_contract: 1,
                                contract_id: purchasedContractId,
                            });
                            if (res && res.proposal_open_contract) {
                                const poc = res.proposal_open_contract;
                                const isFast = isFastModeActive();
                                const isFinished = Boolean(
                                    poc.is_sold || (isFast && (poc.is_expired || (poc.status && poc.status !== 'open')))
                                );
                                if (isFinished) {
                                    this.handleContractSold(poc);
                                }
                            }
                        } catch {}
                    }
                }, watchdogDuration);

                delayIndex = 0;
                log(LogTypes.PURCHASE, { transaction_id: buy.transaction_id });
                info({
                    accountID: this.accountInfo?.loginid,
                    totalRuns: this.updateAndReturnTotalRuns(),
                    transaction_ids: { buy: buy.transaction_id },
                    contract_type,
                    buy_price: buy.buy_price,
                });
            };

            const isBulkEnabled =
                this.purchase_block_allow_bulk === 'yes' || window.scanner_store?.is_bulk_trades_enabled;
            const bulkCount = isBulkEnabled
                ? Math.max(
                      1,
                      Math.min(
                          100,
                          Number(this.purchase_block_bulk_count || window.scanner_store?.bulk_trades_count || 2)
                      )
                  )
                : 1;

            if (bulkCount > 1) {
                log(LogTypes.INFO, {
                    message: `🚀 [BULK TRADES] Placing ${bulkCount} parallel contracts simultaneously on Deriv...`,
                });
                const trade_option = tradeOptionToBuy(contract_type, this.tradeOptions);

                try {
                    globalObserver.emit('replicator.purchase', {
                        mode: 'parameters',
                        request: trade_option,
                        tradeOptions: this.tradeOptions,
                        contract_type,
                        account_id: this.accountInfo?.loginid,
                    });
                } catch {}

                const bulkGroupId = `BULK_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
                this.isSold = false;
                contractStatus({
                    id: 'contract.purchase_sent',
                    data: this.tradeOptions.amount,
                });

                // Keep concurrency bounded so large bulk orders do not freeze the
                // browser or overwhelm the WebSocket connection.
                const batchSize = 8;
                const responses = [];
                for (let index = 0; index < bulkCount; index += batchSize) {
                    const batch = Array.from({ length: Math.min(batchSize, bulkCount - index) }, () =>
                        api_base.api.send(JSON.parse(JSON.stringify(trade_option))).catch(err => ({ error: err }))
                    );
                    responses.push(...(await Promise.all(batch)));
                }

                return Promise.resolve(responses)
                    .then(responses => {
                        this.purchase_block_allow_bulk = 'no';
                        const validResponses = responses.filter(r => r && r.buy && !r.error);

                        if (validResponses.length === 0) {
                            // ─── Bug 3 fix (bulk): Emit Error so the run-panel's onError ──────
                            // fires, logs to Journal, and un-freezes the panel. Without this
                            // emit the run-panel stays frozen in PURCHASE_SENT forever.
                            const errObj = responses.find(r => r && r.error);
                            const errMsg = errObj?.error?.message || errObj?.error || 'Bulk trade purchase failed';
                            const errCode = errObj?.error?.code || errObj?.error?.error?.code || 'BulkPurchaseFailed';

                            log(LogTypes.ERROR, { message: `❌ [BULK TRADES FAILED] ${errMsg}` });

                            // Notify run-panel — this causes it to show the error in Journal
                            // and correctly update is_running / contract_stage state.
                            globalObserver.emit('Error', {
                                code: errCode,
                                message: errMsg,
                                name: errCode,
                            });

                            this.store.dispatch(purchaseSuccessful());
                            if (this.afterPromise) {
                                this.afterPromise();
                            }
                            return null;
                        }

                        this.bulk_group_map = this.bulk_group_map || {};
                        this.bulk_contract_ids = new Set(validResponses.map(r => String(r.buy.contract_id)));
                        this.bulk_sold_contract_ids = new Set();
                        this.contractId = String(validResponses[0].buy.contract_id);

                        validResponses.forEach(res => {
                            const { buy } = res;
                            buy.bulk_group_id = bulkGroupId; // Inject bulk group ID
                            buy.is_bulk_group = true;
                            buy.bulk_count = validResponses.length;
                            this.bulk_group_map[buy.contract_id] = bulkGroupId;

                            // Subscribe to proposal_open_contract for EACH contract in the bulk batch
                            if (api_base.api && buy.contract_id) {
                                try {
                                    api_base.api.send({
                                        proposal_open_contract: 1,
                                        contract_id: buy.contract_id,
                                        subscribe: 1,
                                    });
                                } catch {}
                            }

                            contractStatus({
                                id: 'contract.purchase_received',
                                data: buy.transaction_id,
                                buy,
                            });
                            log(LogTypes.PURCHASE, { transaction_id: buy.transaction_id });
                            info({
                                accountID: this.accountInfo?.loginid,
                                totalRuns: this.updateAndReturnTotalRuns(),
                                transaction_ids: { buy: buy.transaction_id },
                                contract_type,
                                buy_price: buy.buy_price,
                            });
                        });

                        // ⚡ Instant balance update for bulk purchases:
                        const lastBuy = validResponses[validResponses.length - 1]?.buy;
                        if (lastBuy && typeof lastBuy.balance_after === 'number') {
                            try {
                                const { client } = DBotStore.instance || {};
                                if (client?.setBalance) {
                                    client.setBalance(
                                        lastBuy.balance_after.toString(),
                                        this.accountInfo?.loginid || client.loginid
                                    );
                                }
                            } catch (e) {}
                        }

                        this.store.dispatch(purchaseSuccessful());

                        if (this.is_proposal_subscription_required) {
                            this.renewProposalsOnPurchase();
                        }

                        // 🛡️ Watchdog Recovery Timer across all contracts in the bulk batch.
                        // Stored on this._bulkWatchdogTimer so handleContractSold() clears
                        // it when all contracts settle — preventing timer accumulation.
                        const watchdogDuration = Number(this.tradeOptions?.duration || 5) * 1200 + 4000;
                        const contractIdsToCheck = new Set(this.bulk_contract_ids);
                        this._clearWatchdog();
                        this._bulkWatchdogTimer = setTimeout(async () => {
                            this._bulkWatchdogTimer = null;
                            for (const cid of contractIdsToCheck) {
                                if (!this.bulk_sold_contract_ids.has(cid)) {
                                    try {
                                        const res = await api_base.api?.send({
                                            proposal_open_contract: 1,
                                            contract_id: Number(cid),
                                        });
                                        const poc = res?.proposal_open_contract;
                                        const isFast = isFastModeActive();
                                        const isFinished = Boolean(
                                            poc?.is_sold || (isFast && (poc?.is_expired || (poc?.status && poc?.status !== 'open')))
                                        );
                                        if (poc && isFinished) {
                                            if (this.bulk_group_map && this.bulk_group_map[poc.contract_id]) {
                                                poc.bulk_group_id = this.bulk_group_map[poc.contract_id];
                                            }
                                            this.handleContractSold(poc);
                                        }
                                    } catch {}
                                }
                            }
                        }, watchdogDuration);

                        return validResponses[0];
                    })
                    .catch(err => {
                        this.purchase_block_allow_bulk = 'no';
                        const errMsg = err?.message || String(err);
                        const errCode = err?.error?.code || err?.code || 'BulkPurchaseError';

                        log(LogTypes.ERROR, { message: `❌ [BULK TRADES ERROR] ${errMsg}` });

                        // ─── Bug 3 fix (bulk catch): Emit Error to unfreeze the panel ──
                        globalObserver.emit('Error', {
                            code: errCode,
                            message: errMsg,
                            name: errCode,
                        });

                        this.store.dispatch(purchaseSuccessful());
                        if (this.afterPromise) {
                            this.afterPromise();
                        }
                        return null;
                    });
            }

            const trade_option = tradeOptionToBuy(contract_type, this.tradeOptions);

            let selectedProposal = null;
            // In Fast Mode, completely bypass proposal ID negotiation to avoid PriceMoved slippage retries
            if (!isFastMode && this.is_proposal_subscription_required) {
                try {
                    selectedProposal = this.selectProposal(contract_type);
                } catch (propErr) {
                    console.warn('[Purchase] Proposal selection failed, falling back to parameters:', propErr);
                }
            }

            if (selectedProposal && selectedProposal.id) {
                const { id, askPrice } = selectedProposal;

                try {
                    globalObserver.emit('replicator.purchase', {
                        mode: 'proposal_id',
                        request: { buy: id, price: Number(askPrice) },
                        tradeOptions: this.tradeOptions,
                        contract_type,
                        account_id: this.accountInfo?.loginid,
                    });
                } catch {}

                const action = () => api_base.api.send({ buy: id, price: Number(askPrice) });
                this.isSold = false;

                contractStatus({
                    id: 'contract.purchase_sent',
                    data: askPrice,
                });

                return action()
                    .then(onSuccess)
                    .catch(err => {
                        console.warn('[Purchase] Proposal purchase failed, retrying with parameters:', err);
                        const paramAction = () => api_base.api.send(trade_option);
                        return paramAction()
                            .then(onSuccess)
                            .catch(paramErr => {
                                const errCode = paramErr?.error?.code || paramErr?.code || 'PurchaseFailed';
                                const errMsg = paramErr?.error?.message || paramErr?.message || 'Purchase failed';

                                log(LogTypes.ERROR, { message: `❌ [PURCHASE FAILED] ${errMsg}` });

                                // ── Fix 1: always reset buying flag on failure ──────────────
                                // Without this reset, every subsequent purchase() call returns
                                // immediately as a no-op → bot freezes silently after 1 error.
                                this.is_contract_buying_in_progress = false;

                                globalObserver.emit('Error', {
                                    code: errCode,
                                    message: errMsg,
                                    name: errCode,
                                });

                                if (
                                    ['InsufficientBalance', 'NotEnoughMoney', 'AccountBalanceExceeded'].includes(
                                        errCode
                                    ) ||
                                    errMsg.toLowerCase().includes('insufficient')
                                ) {
                                    globalObserver.emit('bot.stop_button_click');
                                }

                                this.store.dispatch(purchaseSuccessful());
                                if (this.afterPromise) {
                                    // ── Fix 2: null-guard to prevent resolving next cycle's promise ─
                                    const ap = this.afterPromise;
                                    this.afterPromise = null;
                                    ap();
                                }
                            });
                    });
            }

            try {
                globalObserver.emit('replicator.purchase', {
                    mode: 'parameters',
                    request: trade_option,
                    tradeOptions: this.tradeOptions,
                    contract_type,
                    account_id: this.accountInfo?.loginid,
                });
            } catch {}

            const action = () => api_base.api.send(trade_option);
            this.isSold = false;

            contractStatus({
                id: 'contract.purchase_sent',
                data: this.tradeOptions.amount,
            });

            return action()
                .then(onSuccess)
                .catch(err => {
                    this.is_contract_buying_in_progress = false;
                    const errCode = err?.error?.code || err?.code || 'PurchaseFailed';
                    const errMsg = err?.error?.message || err?.message || 'Purchase failed';

                    log(LogTypes.ERROR, { message: `❌ [PURCHASE FAILED] ${errMsg}` });

                    // Emit Error to unfreeze run-panel
                    globalObserver.emit('Error', {
                        code: errCode,
                        message: errMsg,
                        name: errCode,
                    });

                    if (
                        [
                            'InsufficientBalance',
                            'NotEnoughMoney',
                            'AccountBalanceExceeded',
                            'CustomLimitsReached',
                        ].includes(errCode) ||
                        errMsg.toLowerCase().includes('insufficient') ||
                        errMsg.toLowerCase().includes('balance')
                    ) {
                        globalObserver.emit('bot.stop');
                        globalObserver.emit('bot.stop_button_click');
                    }

                    this.store.dispatch(purchaseSuccessful());
                    if (this.afterPromise) {
                        this.afterPromise();
                    }
                });
        }

        getPurchaseReference = () => purchase_reference;
        regeneratePurchaseReference = () => {
            purchase_reference = getUUID();
        };
    };
