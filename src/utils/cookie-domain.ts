/**
 * Robust cookie domain utility that accounts for multi-part country TLDs (e.g., .co.ke, .com.au, .co.uk).
 * Returns undefined for localhost or IP addresses so the cookie is set on the current origin without rejection.
 */
export const getCookieDomain = (
    hostname: string = typeof window !== 'undefined' ? window.location.hostname : ''
): string | undefined => {
    if (!hostname || hostname === 'localhost' || hostname === '127.0.0.1' || /^(\d+\.){3}\d+$/.test(hostname)) {
        return undefined;
    }

    const parts = hostname.split('.');
    if (parts.length <= 1) {
        return undefined;
    }

    // Do not set domain attribute for multi-tenant public suffixes (e.g. vercel.app, pages.dev, netlify.app)
    // Browsers reject cookies set on public suffixes with "Cookie has been rejected for invalid domain"
    const publicSuffixes = [
        'vercel.app',
        'pages.dev',
        'netlify.app',
        'github.io',
        'herokuapp.com',
        'firebaseapp.com',
        'web.app',
        'azurewebsites.net',
    ];

    const lowerHostname = hostname.toLowerCase();
    if (publicSuffixes.some(suffix => lowerHostname === suffix || lowerHostname.endsWith(`.${suffix}`))) {
        return undefined;
    }

    if (parts.length === 2) {
        return `.${hostname}`;
    }

    // Check for common second-level domains (e.g., co.ke, com.au, co.uk, net.au, org.uk, com.ng)
    const secondLast = parts[parts.length - 2].toLowerCase();
    const last = parts[parts.length - 1].toLowerCase();
    const commonSLDs = ['co', 'com', 'org', 'net', 'edu', 'gov', 'ac', 'mil'];

    const isCompoundTLD = commonSLDs.includes(secondLast) && last.length === 2;

    if (isCompoundTLD && parts.length >= 3) {
        // e.g. www.profithub.co.ke -> .profithub.co.ke
        return `.${parts.slice(-3).join('.')}`;
    }

    // e.g. staging.profithub.com -> .profithub.com
    return `.${parts.slice(-2).join('.')}`;
};

export const getCleanCookieDomain = (hostname?: string): string => {
    const domain = getCookieDomain(hostname);
    if (!domain) return '';
    return domain.startsWith('.') ? domain.slice(1) : domain;
};
