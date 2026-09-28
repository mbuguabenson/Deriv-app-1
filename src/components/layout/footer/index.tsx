// Updated to include WhatsApp contact link and ensure theme toggle is always present
// Controls language settings and theme toggle via brand.config.json
import brandConfig from '@/../brand.config.json';
import { useApiBase } from '@/hooks/useApiBase';
import useModalManager from '@/hooks/useModalManager';
import { getActiveTabUrl } from '@/utils/getActiveTabUrl';
import { FILTERED_LANGUAGES } from '@/utils/languages';
import { isLoggedIn } from '@/utils/token-bridge';
import { useTranslations } from '@deriv-com/translations';
import { DesktopLanguagesModal } from '@deriv-com/ui';
import ChangeTheme from './ChangeTheme';
import FullScreen from './FullScreen';
import LanguageSettings from './LanguageSettings';
import LogoutFooter from './LogoutFooter';
import NetworkStatus from './NetworkStatus';
import ServerTime from './ServerTime';
import './footer.scss';

// ─────────────────────────────────────────────────────────────────────────────
// WhatsApp icon button (moved from header)
// ─────────────────────────────────────────────────────────────────────────────
const WhatsAppFooterLink = () => (
    <a
        href='https://wa.me/254757722344'
        target='_blank'
        rel='noopener noreferrer'
        className='app-footer__whatsapp'
        title='Contact us on WhatsApp'
        aria-label='Contact on WhatsApp'
    >
        <svg viewBox='0 0 24 24' width='16' height='16' fill='currentColor'>
            <path d='M6.62 10.79a15.15 15.15 0 0 0 6.59 6.59l2.2-2.2a1 1 0 0 1 1.02-.27 11.4 11.4 0 0 0 3.58.57 1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A17 17 0 0 1 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1 11.4 11.4 0 0 0 .57 3.58 1 1 0 0 1-.27 1.02z' />
        </svg>
    </a>
);

// ─────────────────────────────────────────────────────────────────────────────
// Account icon button
// ─────────────────────────────────────────────────────────────────────────────
const AccountFooterButton = () => (
    <button
        type='button'
        className='app-footer__account'
        onClick={() => window.dispatchEvent(new Event('open_account_info'))}
        title='Account Details & Settings'
        aria-label='Account Details'
    >
        <svg viewBox='0 0 24 24' width='16' height='16' fill='none' stroke='currentColor' strokeWidth='2' strokeLinecap='round' strokeLinejoin='round'>
            <path d='M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2' />
            <circle cx='12' cy='7' r='4' />
        </svg>
    </button>
);

// ─────────────────────────────────────────────────────────────────────────────
// Risk Disclaimer button (Desktop)
// ─────────────────────────────────────────────────────────────────────────────
const RiskDisclaimerFooterButton = () => (
    <button
        type='button'
        className='app-footer__risk-btn'
        onClick={() => window.dispatchEvent(new Event('open_risk_disclaimer'))}
        title='Risk Disclaimer & Regulatory Warning'
        aria-label='Risk Disclaimer'
    >
        <svg viewBox='0 0 24 24' width='13' height='13' fill='none' stroke='currentColor' strokeWidth='2' strokeLinecap='round' strokeLinejoin='round'>
            <path d='M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z' />
            <line x1='12' y1='8' x2='12' y2='12' />
            <line x1='12' y1='16' x2='12.01' y2='16' />
        </svg>
        <span>Risk Disclaimer</span>
    </button>
);

const Footer = () => {
    const { currentLang = 'EN', localize, switchLanguage } = useTranslations();
    const { hideModal, isModalOpenFor, showModal } = useModalManager();
    const { isAuthorized } = useApiBase();

    // Get footer configuration from brand.config.json
    const enableLanguageSettings = brandConfig.platform.footer?.enable_language_settings ?? true;
    const enableThemeToggle = brandConfig.platform.footer?.enable_theme_toggle ?? true;

    const openLanguageSettingModal = () => showModal('DesktopLanguagesModal');

    return (
        <footer className='app-footer'>
            <FullScreen />
            <div className='app-footer__vertical-line' />
            <RiskDisclaimerFooterButton />
            {(isAuthorized || isLoggedIn()) && (
                <>
                    <div className='app-footer__vertical-line' />
                    <LogoutFooter />
                    <div className='app-footer__vertical-line' />
                    <AccountFooterButton />
                </>
            )}
            <div className='app-footer__vertical-line' />

            {/* WhatsApp contact link (migrated from header) */}
            <>
                <WhatsAppFooterLink />
                <div className='app-footer__vertical-line' />
            </>

            {/* Language settings */}
            {enableLanguageSettings && (
                <>
                    <LanguageSettings openLanguageSettingModal={openLanguageSettingModal} />
                    <div className='app-footer__vertical-line' />
                </>
            )}

            {/* Theme toggle */}
            {enableThemeToggle && (
                <>
                    <ChangeTheme />
                    <div className='app-footer__vertical-line' />
                </>
            )}

            <ServerTime />
            <div className='app-footer__vertical-line' />
            <NetworkStatus />

            {/* Copyright by Benadesigns */}
            <div className='app-footer__copyright'>
                <span>© {new Date().getFullYear()}</span>
                <a
                    href='https://benadesigns.co.ke'
                    target='_blank'
                    rel='noopener noreferrer'
                    className='app-footer__copyright-link'
                >
                    Copyright by Benadesigns
                </a>
            </div>

            {/* Language modal */}
            {enableLanguageSettings && isModalOpenFor('DesktopLanguagesModal') && (
                <DesktopLanguagesModal
                    headerTitle={localize('Select Language')}
                    isModalOpen
                    languages={FILTERED_LANGUAGES as any}
                    onClose={hideModal}
                    onLanguageSwitch={code => {
                        try {
                            switchLanguage(code);
                            hideModal();
                            window.location.replace(getActiveTabUrl());
                        } catch (error) {
                            console.error('Failed to switch language:', error);
                            hideModal();
                        }
                    }}
                    selectedLanguage={currentLang}
                />
            )}
        </footer>
    );
};

export default Footer;
