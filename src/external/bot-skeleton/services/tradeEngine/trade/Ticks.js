/* eslint-disable no-promise-executor-return */
import debounce from 'lodash.debounce';
import { getLocalizedErrorMessage } from '@/constants/backend-error-messages';
import { localize } from '@deriv-com/translations';
import { getLast } from '../../../utils/binary-utils';
import { observer as globalObserver } from '../../../utils/observer';
import { api_base } from '../../api/api-base';
import { getDirection, getLastDigit } from '../utils/helpers';
import { expectPositiveInteger } from '../utils/sanitize';
import * as constants from './state/constants';

let tickListenerKey;

export default Engine =>
    class Ticks extends Engine {
        async watchTicks(symbol) {
            if (!symbol) return;

            const { ticksService } = this.$scope;
            const alreadyWatching = this.symbol === symbol && tickListenerKey;
            if (alreadyWatching) {
                return;
            }

            if (tickListenerKey) {
                await ticksService.stopMonitor({
                    symbol: this.symbol || symbol,
                    key: tickListenerKey,
                });
                tickListenerKey = null;
            }

            this.symbol = symbol;
            const callback = ticks => {
                if (this.is_proposal_subscription_required) {
                    this.checkProposalReady();
                }
                const lastTick = ticks.slice(-1)[0];
                if (!lastTick || typeof lastTick.epoch !== 'number') return;

                const { epoch } = lastTick;
                this.lastTickEpoch = epoch;
                this.store.dispatch({ type: constants.NEW_TICK, payload: epoch });
            };

            const key = await ticksService.monitor({ symbol, callback });
            tickListenerKey = key;
        }

        checkTicksPromiseExists() {
            return this.$scope.ticksService.ticks_history_promise;
        }

        getTicks(toString = false) {
            return new Promise(resolve => {
                const targetSymbol = this.symbol || this.options?.symbol;
                if (!targetSymbol) {
                    resolve([]);
                    return;
                }
                this.$scope.ticksService
                    .request({ symbol: targetSymbol })
                    .then(ticks => {
                        const ticks_list = (ticks || []).map(tick => {
                            if (toString) {
                                return typeof tick?.quote === 'number'
                                    ? tick.quote.toFixed(this.getPipSize())
                                    : String(tick?.quote ?? '');
                            }
                            return tick?.quote ?? 0;
                        });

                        resolve(ticks_list);
                    })
                    .catch(err => {
                        console.warn('[Ticks] getTicks request error:', err);
                        resolve([]);
                    });
            });
        }

        getLastTick(raw, toString = false) {
            return new Promise(resolve => {
                const targetSymbol = this.symbol || this.options?.symbol;
                if (!targetSymbol) {
                    resolve(raw ? { epoch: Math.floor(Date.now() / 1000), quote: 0 } : (toString ? '0.00' : 0));
                    return;
                }
                this.$scope.ticksService
                    .request({ symbol: targetSymbol })
                    .then(ticks => {
                        try {
                            const last = getLast(ticks || []);
                            if (!last) {
                                resolve(
                                    raw ? { epoch: Math.floor(Date.now() / 1000), quote: 0 } : (toString ? '0.00' : 0)
                                );
                                return;
                            }
                            let last_tick = raw ? last : last.quote;
                            if (!raw && toString && typeof last?.quote === 'number') {
                                last_tick = last.quote.toFixed(this.getPipSize());
                            }
                            resolve(last_tick);
                        } catch (error) {
                            resolve(
                                raw ? { epoch: Math.floor(Date.now() / 1000), quote: 0 } : (toString ? '0.00' : 0)
                            );
                        }
                    })
                    .catch(e => {
                        if (e?.code === 'MarketIsClosed') {
                            const localizedError = {
                                ...e,
                                message: getLocalizedErrorMessage(e.code, e.details),
                            };
                            globalObserver.emit('Error', localizedError);
                            resolve(e.code);
                        } else {
                            resolve(
                                raw ? { epoch: Math.floor(Date.now() / 1000), quote: 0 } : (toString ? '0.00' : 0)
                            );
                        }
                    });
            });
        }

        getLastDigit() {
            return new Promise(resolve =>
                this.getLastTick(false, true)
                    .then(tick => resolve(getLastDigit(tick)))
                    .catch(() => resolve(0))
            );
        }

        getLastDigitList() {
            return new Promise(resolve =>
                this.getTicks()
                    .then(ticks => resolve(this.getLastDigitsFromList(ticks)))
                    .catch(() => resolve([]))
            );
        }

        getLastDigitsFromList(ticks) {
            if (!Array.isArray(ticks)) return [];
            return ticks.map(tick => {
                const num = typeof tick === 'number' ? tick.toFixed(this.getPipSize()) : String(tick ?? '');
                return getLastDigit(num);
            });
        }

        checkDirection(dir) {
            return new Promise(resolve => {
                const targetSymbol = this.symbol || this.options?.symbol;
                if (!targetSymbol) {
                    resolve(false);
                    return;
                }
                this.$scope.ticksService
                    .request({ symbol: targetSymbol })
                    .then(ticks => resolve(getDirection(ticks || []) === dir))
                    .catch(() => resolve(false));
            });
        }

        getOhlc(args) {
            const { granularity = this.options?.candleInterval || 60, field } = args || {};
            const targetSymbol = this.symbol || this.options?.symbol;

            return new Promise(resolve => {
                if (!targetSymbol) {
                    resolve([]);
                    return;
                }
                this.$scope.ticksService
                    .request({ symbol: targetSymbol, granularity })
                    .then(ohlc => resolve(field ? (ohlc || []).map(o => o?.[field]) : (ohlc || [])))
                    .catch(() => resolve([]));
            });
        }

        getOhlcFromEnd(args) {
            const { index: i = 1 } = args || {};

            const index = expectPositiveInteger(Number(i), localize('Index must be a positive integer'));

            return new Promise(resolve =>
                this.getOhlc(args)
                    .then(ohlc => resolve((ohlc || []).slice(-index)[0]))
                    .catch(() => resolve(null))
            );
        }

        getPipSize() {
            const pip = this.$scope.ticksService?.pipSizes?.[this.symbol] ?? api_base?.pip_sizes?.[this.symbol];
            return typeof pip === 'number' ? pip : 2;
        }

        async requestAccumulatorStats() {
            const subscription_id = this.subscription_id_for_accumulators;
            const is_proposal_requested = this.is_proposal_requested_for_accumulators;
            const proposal_request = {
                ...window.Blockly.accumulators_request,
                amount: Number(this?.tradeOptions?.amount || 1),
                basis: this?.tradeOptions?.basis || 'stake',
                contract_type: 'ACCU',
                currency: this?.tradeOptions?.currency || 'USD',
                growth_rate: Number(this?.tradeOptions?.growth_rate || 0.01),
                proposal: 1,
                subscribe: 1,
                underlying_symbol: this?.tradeOptions?.underlying_symbol || this?.tradeOptions?.symbol || 'R_100',
            };
            delete proposal_request.symbol;
            if (!subscription_id && !is_proposal_requested) {
                this.is_proposal_requested_for_accumulators = true;
                if (proposal_request) {
                    await api_base?.api?.send(proposal_request);
                }
            }
        }

        async handleOnMessageForAccumulators() {
            let ticks_stayed_in_list = [];
            return new Promise(resolve => {
                const subscription = api_base.api.onMessage().subscribe(({ data }) => {
                    if (data.msg_type === 'proposal') {
                        try {
                            this.subscription_id_for_accumulators = data.subscription.id;
                            // this was done because we can multile arrays in the respone and the list comes in reverse order
                            const stat_list = (data.proposal.contract_details.ticks_stayed_in || []).flat().reverse();
                            ticks_stayed_in_list = [...stat_list, ...ticks_stayed_in_list];
                            if (ticks_stayed_in_list.length > 0) resolve(ticks_stayed_in_list);
                        } catch (error) {
                            globalObserver.emit('Unexpected message type or no proposal found:', error);
                        }
                    }
                });
                api_base.pushSubscription(subscription);
            });
        }

        async fetchStatsForAccumulators() {
            try {
                // request stats for accumulators
                const debouncedAccumulatorsRequest = debounce(() => this.requestAccumulatorStats(), 300);
                debouncedAccumulatorsRequest();
                // wait for proposal response
                const ticks_stayed_in_list = await this.handleOnMessageForAccumulators();
                return ticks_stayed_in_list;
            } catch (error) {
                globalObserver.emit('Error in subscription promise:', error);
                throw error;
            } finally {
                // forget all proposal subscriptions so we can fetch new stats data on new call
                try {
                    await api_base?.api?.send({ forget_all: 'proposal' });
                } catch {
                    /* ignore when no active proposal subscriptions exist */
                }
                this.is_proposal_requested_for_accumulators = false;
                this.subscription_id_for_accumulators = null;
            }
        }

        async getCurrentStat() {
            try {
                const ticks_stayed_in = await this.fetchStatsForAccumulators();
                return ticks_stayed_in?.[0];
            } catch (error) {
                globalObserver.emit('Error fetching current stat:', error);
            }
        }

        async getStatList() {
            try {
                const ticks_stayed_in = await this.fetchStatsForAccumulators();
                // we need to send only lastest 100 ticks
                return ticks_stayed_in?.slice(0, 100);
            } catch (error) {
                globalObserver.emit('Error fetching current stat:', error);
            }
        }

        async getDelayTickValue(tick_value) {
            return new Promise((resolve, reject) => {
                try {
                    const ticks = [];
                    const symbol = this.symbol;

                    const resolveAndExit = () => {
                        this.$scope.ticksService.stopMonitor({
                            symbol,
                            key: '',
                        });
                        resolve(ticks);
                        ticks.length = 0;
                    };

                    const watchTicks = tick_list => {
                        ticks.push(tick_list);
                        const current_tick = ticks.length;
                        if (current_tick === tick_value) {
                            resolveAndExit();
                        }
                    };

                    const delayExecution = tick_list => watchTicks(tick_list);

                    if (Number(tick_value) <= 0) resolveAndExit();
                    this.$scope.ticksService.monitor({ symbol, callback: delayExecution });
                } catch (error) {
                    reject(new Error(`Failed to start tick monitoring: ${error.message}`));
                }
            });
        }
    };
