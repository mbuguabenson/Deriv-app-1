import localforage from 'localforage';
import LZString from 'lz-string';
import { injectProfitHubBotLock } from '@/external/bot-skeleton/scratch/blocks/Binary/Tools/Misc/profithub_bot_lock';

export type TBotsManifestItem = {
    name: string;
    file: string; // xml filename relative to its source base path
    description?: string;
    difficulty?: string;
    strategy?: string;
    features?: string[];
    basePath?: string; // optional base path for non-/xml sources such as /xml-uploads/
};

const XML_CACHE_PREFIX = 'freebots:xml:';

// In-memory cache for faster access
const memoryCache = new Map<string, string>();

// Domain-aware XML base path: defaults to /xml/, but can switch to /xml/<domain>/ after manifest resolution
let XML_BASE = '/xml/';
export const getXmlBase = () => XML_BASE;
const setXmlBase = (base: string) => {
    XML_BASE = base.endsWith('/') ? base : `${base}/`;
};

const decompress = (data: string | null) => (data ? LZString.decompressFromUTF16(data) : null);
const compress = (data: string) => LZString.compressToUTF16(data);

export const getCachedXml = async (file: string): Promise<string | null> => {
    try {
        const key = `${XML_CACHE_PREFIX}${file}`;
        const cached = (await localforage.getItem<string>(key)) || null;
        return decompress(cached);
    } catch (e) {
        // eslint-disable-next-line no-console
        console.warn('freebots-cache:getCachedXml error', e);
        return null;
    }
};

export const setCachedXml = async (file: string, xml: string) => {
    try {
        const key = `${XML_CACHE_PREFIX}${file}`;
        await localforage.setItem(key, compress(xml));
    } catch (e) {
        // eslint-disable-next-line no-console
        console.warn('freebots-cache:setCachedXml error', e);
    }
};

export const fetchXmlWithCache = async (file: string, basePath?: string): Promise<string | null> => {
    const isUpload = basePath?.startsWith('/xml-uploads/') || false;
    const cacheKey = basePath ? `${basePath}${file}` : file;

    // Check memory cache first (only if not an upload, to allow real-time development reloading)
    if (!isUpload && memoryCache.has(cacheKey)) {
        return memoryCache.get(cacheKey)!;
    }

    // Check persistent cache (only if not an upload)
    if (!isUpload) {
        const cached = await getCachedXml(cacheKey);
        if (cached) {
            memoryCache.set(cacheKey, cached);
            return cached;
        }
    }

    try {
        const resolveUrl = (sourceFile: string, base: string) => {
            if (sourceFile.startsWith('/') || sourceFile.startsWith('http')) {
                return sourceFile;
            }
            const normalizedBase = base.endsWith('/') ? base : `${base}/`;
            return `${normalizedBase}${sourceFile.split('/').map(encodeURIComponent).join('/')}`;
        };

        let primaryUrl = basePath ? resolveUrl(file, basePath) : resolveUrl(file, getXmlBase());

        // Add cache-busting timestamp query parameter for xml-uploads
        if (isUpload) {
            primaryUrl = `${primaryUrl}?t=${Date.now()}`;
        }

        let res = await fetch(primaryUrl, isUpload ? { cache: 'no-cache' } : undefined);

        // 2) Fallback: try default /xml/ if the primary fails and it isn't already the /xml/ base
        if (!res.ok && (!basePath || basePath !== '/xml/') && !isUpload) {
            const fallbackUrl = resolveUrl(file, '/xml/');
            res = await fetch(fallbackUrl);
        }

        if (!res.ok) {
            if (res.status === 404) {
                return null;
            }
            throw new Error(`Failed to fetch ${file}: ${res.status}`);
        }
        const rawXml = await res.text();
        const xml = injectProfitHubBotLock(rawXml);

        // Store in both caches (only if not an upload)
        if (!isUpload) {
            memoryCache.set(cacheKey, xml);
            await setCachedXml(cacheKey, xml);
        }
        return xml;
    } catch (e: any) {
        if (e?.message && !e.message.includes('404')) {
            // eslint-disable-next-line no-console
            console.warn('freebots-cache:fetchXmlWithCache error', e);
        }
        return null;
    }
};

export const prefetchAllXmlInBackground = async (files: string[]) => {
    // Fire-and-forget prefetch with throttling to avoid overwhelming the browser
    const batchSize = 3; // Load 3 files at a time
    for (let i = 0; i < files.length; i += batchSize) {
        const batch = files.slice(i, i + batchSize);
        await Promise.allSettled(batch.map(file => fetchXmlWithCache(file)));
        // Small delay between batches to prevent blocking
        if (i + batchSize < files.length) {
            await new Promise(resolve => setTimeout(resolve, 100));
        }
    }
};

const fetchJsonManifest = async (url: string, disableCache = false): Promise<TBotsManifestItem[] | null> => {
    try {
        const fetchOptions: RequestInit = disableCache ? { cache: 'no-cache' } : { cache: 'force-cache' };
        const finalUrl = disableCache ? `${url}?t=${Date.now()}` : url;
        const res = await fetch(finalUrl, fetchOptions);
        if (!res.ok) return null;

        const contentType = res.headers.get('content-type') || '';
        if (contentType.includes('text/html') || contentType.includes('application/xhtml+xml')) {
            return null;
        }

        const text = await res.text();
        const trimmed = text.trim();
        if (!trimmed.startsWith('[') && !trimmed.startsWith('{')) {
            return null;
        }

        return JSON.parse(trimmed) as TBotsManifestItem[];
    } catch {
        return null;
    }
};

export const getBotsManifest = async (): Promise<TBotsManifestItem[] | null> => {
    try {
        const hostname = window.location.hostname.toLowerCase();
        const urlParams = new URLSearchParams(window.location.search);
        const override = (urlParams.get('bots_domain') || '').toLowerCase().replace(/^www\./, '');
        const domain = (override || hostname).replace(/^www\./, '');

        // Try domain-specific manifest first
        const domainUrl = `/xml/${encodeURIComponent(domain)}/bots.json`;
        let data = await fetchJsonManifest(domainUrl);

        if (data) {
            setXmlBase(`/xml/${domain}/`);
        } else {
            // Fallback to default manifest when generic /xml/bots.json is not available
            const defaultUrl = '/xml/default/bots.json';
            data = await fetchJsonManifest(defaultUrl);
            setXmlBase('/xml/default/');
        }

        return data;
    } catch (e) {
        // eslint-disable-next-line no-console
        console.warn('freebots-cache:getBotsManifest error', e);
        return null;
    }
};

export const getXmlUploadsManifest = async (): Promise<TBotsManifestItem[] | null> => {
    try {
        const data = await fetchJsonManifest('/xml-uploads/bots.json', true);
        if (!data) return null;
        return data.map(item => ({ ...item, basePath: '/xml-uploads/' }));
    } catch (e) {
        // eslint-disable-next-line no-console
        console.warn('freebots-cache:getXmlUploadsManifest error', e);
        return null;
    }
};
