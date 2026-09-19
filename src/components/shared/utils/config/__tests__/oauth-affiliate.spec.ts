import { TextEncoder } from 'util';
import { webcrypto } from 'crypto';

if (typeof global.TextEncoder === 'undefined') {
    (global as any).TextEncoder = TextEncoder;
}

Object.defineProperty(window, 'crypto', {
    value: {
        subtle: {
            digest: async (_algorithm: any, data: any) => new Uint8Array(32).buffer,
        },
        getRandomValues: (arr: any) => webcrypto.getRandomValues(arr),
    },
    writable: true,
});

import { generateOAuthURL } from '../config';
import { DERIV_AFFILIATE_CONFIG } from '@/constants/affiliate-config';

describe('OAuth Affiliate & Referral Tracking', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    it('returns the affiliate signup link when prompt is "registration"', async () => {
        const url = await generateOAuthURL('registration');
        expect(url).toBe(DERIV_AFFILIATE_CONFIG.signupUrl);
        expect(url).toBe('https://t.deriv.link?t=HFJ29NBD7CHV');
    });

    it('attaches referral code and affiliate tracking parameters to the login OAuth URL', async () => {
        const url = await generateOAuthURL();
        expect(url).toMatch(/https:\/\/(oauth|auth)\.deriv\.com\/oauth2\/(authorize|auth)/);
        expect(url).toContain(`affiliate_token=${DERIV_AFFILIATE_CONFIG.referralCode}`);
        expect(url).toContain(`referral_code=${DERIV_AFFILIATE_CONFIG.referralCode}`);
        expect(url).toContain(`t=${DERIV_AFFILIATE_CONFIG.affiliateToken}`);
        expect(url).toContain('DVKTYNL244QE');
        expect(url).toContain('HFJ29NBD7CHV');

        // Verify storage persistence
        expect(localStorage.getItem('referral_code')).toBe('DVKTYNL244QE');
        expect(localStorage.getItem('affiliate_token')).toBe('DVKTYNL244QE');
    });
});
