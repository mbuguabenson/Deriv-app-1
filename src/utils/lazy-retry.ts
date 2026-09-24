import React from 'react';

/**
 * Wraps dynamic React.lazy imports with retry logic and automatic cache-busting page reload
 * in case a chunk hash has changed following a new deployment.
 */
export const lazyRetry = <T extends React.ComponentType<any>>(
    componentImport: () => Promise<{ default: T }>,
    name = 'module'
): React.LazyExoticComponent<T> => {
    return React.lazy(async () => {
        try {
            return await componentImport();
        } catch (firstError) {
            // Immediate in-memory retry after brief pause before attempting anything drastic
            await new Promise(resolve => setTimeout(resolve, 500));
            try {
                return await componentImport();
            } catch (error: any) {
                const isChunkError =
                    error?.name === 'ChunkLoadError' ||
                    /loading chunk/i.test(error?.message || '') ||
                    /failed to fetch dynamically imported module/i.test(error?.message || '') ||
                    /importing a module script failed/i.test(error?.message || '') ||
                    /error loading dynamically imported module/i.test(error?.message || '');

                const now = Date.now();
                const lastReload = Number(sessionStorage.getItem('last_global_chunk_reload') || '0');

                // Enforce a strict single global reload with a 45-second debounce across ALL modules
                if (isChunkError && now - lastReload > 45000 && process.env.NODE_ENV === 'production') {
                    console.warn(`[LazyRetry] Chunk load failed for ${name}. Reloading application once for new deployment...`);
                    sessionStorage.setItem('last_global_chunk_reload', String(now));
                    window.location.reload();
                    return { default: (() => null) as unknown as T };
                }

                console.error(`[LazyRetry] Module failed to load: ${name}`, error);
                throw error;
            }
        }
    });
};
