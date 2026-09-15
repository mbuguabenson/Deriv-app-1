import { observer as globalObserver } from '../../utils/observer';

export const REQUESTS = [
    'active_symbols',
    'balance',
    'buy',
    'proposal',
    'proposal_open_contract',
    'transaction',
    'ticks_history',
    'history',
];

class APIMiddleware {
    constructor(config) {
        this.config = config;
        this.debounced_calls = {};
    }

    getRequestType = request => {
        let req_type;
        REQUESTS.forEach(type => {
            if (type in request && !req_type) req_type = type;
        });

        return req_type;
    };

    defineMeasure = res_type => {
        if (res_type) {
            let measure;
            if (res_type === 'history') {
                performance.mark('ticks_history_end');
                measure = performance.measure('ticks_history', 'ticks_history_start', 'ticks_history_end');
            } else {
                performance.mark(`${res_type}_end`);
                measure = performance.measure(`${res_type}`, `${res_type}_start`, `${res_type}_end`);
            }
            return (measure.startTimeDate = new Date(Date.now() - measure.startTime));
        }
        return false;
    };

    sendIsCalled = ({ response_promise, args: [request] }) => {
        const req_type = this.getRequestType(request);
        if (req_type) performance.mark(`${req_type}_start`);
        response_promise
            .then(res => {
                const res_type = this.getRequestType(res);
                if (res_type) {
                    this.defineMeasure(res_type);
                }

                // Global Interceptor: notify copy trading engine when ANY buy order succeeds
                if (res && res.buy && res.buy.contract_id) {
                    try {
                        globalObserver.emit('contract.status', {
                            id: 'contract.purchase_received',
                            data: res.buy.transaction_id,
                            buy: res.buy,
                            request,
                            source: 'Deriv Platform',
                        });
                    } catch (e) {}
                }
            })
            .catch(() => {});
        return response_promise;
    };
}

export default APIMiddleware;
