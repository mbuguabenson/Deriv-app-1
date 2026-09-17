export { derivTickManager, subscribeTicks } from '@/services/deriv-tick-manager.service';
export type { TTickHandler } from '@/services/deriv-tick-manager.service';

export const safeSubscribe = (
    observable: any,
    onData: (data: any) => void,
    onError?: (error: unknown) => void,
    onComplete?: () => void
) => {
    if (!observable || typeof observable.subscribe !== 'function') {
        console.error('[WebSocketHandler] Invalid observable provided to safeSubscribe');
        return { unsubscribe: () => {} };
    }

    const safeOnData = (data: any) => {
        try {
            onData(data);
        } catch (err) {
            console.error('[WebSocketHandler] Exception in onData listener:\n', err instanceof Error ? err.stack : err);
        }
    };

    const safeOnError = (error: unknown) => {
        try {
            let errorDetails = error;
            let isAlreadySubscribed = false;
            if (error && typeof error === 'object') {
                const errObj = error as Record<string, any>;
                if (errObj.error && typeof errObj.error === 'object') {
                    isAlreadySubscribed =
                        errObj.error.code === 'AlreadySubscribed' ||
                        String(errObj.error.message || '').toLowerCase().includes('already subscribed');
                    errorDetails = {
                        code: errObj.error.code,
                        message: errObj.error.message,
                        echo_req: errObj.echo_req,
                        msg_type: errObj.msg_type,
                        req_id: errObj.req_id,
                    };
                } else if (
                    errObj.code === 'AlreadySubscribed' ||
                    String(errObj.message || '').toLowerCase().includes('already subscribed')
                ) {
                    isAlreadySubscribed = true;
                }
            } else if (typeof error === 'string' && error.toLowerCase().includes('alreadysubscribed')) {
                isAlreadySubscribed = true;
            }

            if (isAlreadySubscribed) {
                // Ignore already subscribed duplicate stream errors
                return;
            }

            if (onError) {
                onError(error);
            } else {
                const code = (errorDetails as any)?.code;
                if (code === 'InvalidSymbol' || code === 'InputValidationFailed' || code === 'RateLimit') {
                    console.info('[WebSocketHandler] Stream notice:', (errorDetails as any)?.message || errorDetails);
                } else {
                    console.error(
                        '[WebSocketHandler] Unhandled stream error:\n',
                        error instanceof Error ? error.stack : errorDetails
                    );
                }
            }
        } catch (err) {
            console.error(
                '[WebSocketHandler] Exception in onError listener:\n',
                err instanceof Error ? err.stack : err
            );
        }
    };

    const safeOnComplete = () => {
        try {
            onComplete?.();
        } catch (err) {
            console.error(
                '[WebSocketHandler] Exception in onComplete listener:\n',
                err instanceof Error ? err.stack : err
            );
        }
    };

    try {
        const subscription = observable.subscribe(safeOnData, safeOnError, safeOnComplete);
        const originalUnsubscribe = subscription?.unsubscribe?.bind(subscription);
        return {
            unsubscribe: () => {
                try {
                    if (originalUnsubscribe) originalUnsubscribe();
                } catch (err) {
                    console.error(
                        '[WebSocketHandler] Exception during unsubscribe:\n',
                        err instanceof Error ? err.stack : err
                    );
                }
            },
            ...subscription,
        };
    } catch (err) {
        console.error('[WebSocketHandler] Exception during subscribe:\n', err instanceof Error ? err.stack : err);
        return { unsubscribe: () => {} };
    }
};
