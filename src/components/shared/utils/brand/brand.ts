import config_data from '../../../../../brand.config.json';

type TPlatform = {
    name: string;
    logo: any;
    footer?: any;
    hostname?: any;
    auth2_url?: any;
    derivws?: any;
};

const isDomainAllowed = (domain_name: string) => {
    // This regex will match any official deriv production and testing domain names.
    // Allowed deriv domains: localhost, binary.sx, binary.com, deriv.com, deriv.be, deriv.me and their subdomains.
    return /^(((.*)\.)?(localhost:8444|pages.dev|binary\.(sx|com)|deriv.(com|me|be|dev)))$/.test(domain_name);
};

export const getBrandWebsiteName = () => {
    try {
        const siteConfig = JSON.parse(localStorage.getItem('site_config') || '{}');
        if (siteConfig?.brandDomain) return siteConfig.brandDomain;
    } catch {}
    return config_data.domain_name || 'hazelhub.vercel.app';
};

export const getBrandLabel = () => {
    try {
        const siteConfig = JSON.parse(localStorage.getItem('site_config') || '{}');
        if (siteConfig?.brandName) return siteConfig.brandName;
    } catch {}
    return config_data.brand_name || 'Legacy Trading Hub';
};

export const getBrandTitle = () => {
    return getBrandLabel();
};

export const getPlatformConfig = (): TPlatform => {
    const allowed_config_data: TPlatform = { ...config_data.platform };

    if (!isDomainAllowed(window.location.host)) {
        // Remove all official platform logos if the app is hosted under unofficial domain
        allowed_config_data.logo = '';
    }

    return allowed_config_data;
};

export const getDomainName = () => {
    return window.location.hostname;
};
