import React from 'react';
import classNames from 'classnames';
import { observer } from 'mobx-react-lite';
import GoogleDrive from '@/components/load-modal/google-drive';
import Dialog from '@/components/shared_ui/dialog';
import MobileFullPageModal from '@/components/shared_ui/mobile-full-page-modal';
import { DBOT_TABS } from '@/constants/bot-contents';
import { useApiBase } from '@/hooks/useApiBase';
import { useStore } from '@/hooks/useStore';
import { localize } from '@deriv-com/translations';
import { useDevice } from '@deriv-com/ui';
import DashboardBotList from './bot-list/dashboard-bot-list';
import {
    TrendingUp,
    Bot,
    Cpu,
    Zap,
    BarChart3,
    ShieldCheck,
    ArrowUpRight,
    FolderPlus,
    Target,
    Radio,
    Sparkles,
    MessageCircle,
    Layers,
    Wand2,
    Compass,
    Activity,
    Lock,
    SlidersHorizontal
} from 'lucide-react';

type TCardProps = {
    has_dashboard_strategies: boolean;
    is_mobile: boolean;
};

const Cards = observer(({ is_mobile, has_dashboard_strategies }: TCardProps) => {
    const { dashboard, load_modal, client, quick_strategy } = useStore();
    const { toggleLoadModal, setActiveTabIndex } = load_modal;
    const { isDesktop } = useDevice();
    const { onCloseDialog, dialog_options, is_dialog_open, setActiveTab, setPreviewOnPopup } = dashboard;
    const { setFormVisibility } = quick_strategy;
    const { accountList, activeLoginid } = useApiBase();

    // Resolve active account details
    const activeAccount =
        accountList?.find(acc => acc.loginid === activeLoginid) ||
        client?.account_list?.find(acc => acc.loginid === (client?.loginid || activeLoginid));

    const accountName =
        activeAccount?.loginid ||
        client?.loginid ||
        activeLoginid ||
        localStorage.getItem('active_loginid') ||
        '';

    const isVirtual = Boolean(activeAccount?.is_virtual || client?.is_virtual || accountName.startsWith('VR'));

    const openFileLoader = () => {
        toggleLoadModal();
        setActiveTabIndex(is_mobile ? 0 : 1);
        setActiveTab(DBOT_TABS.BOT_BUILDER);
    };

    const handleOpenQuickStrategy = () => {
        setActiveTab(DBOT_TABS.BOT_BUILDER);
        setFormVisibility(true);
    };

    // ─── Top Row: 5 Strategy Loading Cards in ONE Single Line on Desktop ─
    const loadingCards = [
        {
            id: 'bot-builder',
            title: 'Bot Builder',
            subtitle: 'Visual IDE logic architect',
            icon: <Layers size={22} className='text-indigo' />,
            badge: 'IDE',
            theme: 'card--indigo',
            callback: () => setActiveTab(DBOT_TABS.BOT_BUILDER),
        },
        {
            id: 'quick-strategy',
            title: 'Quick Strategy',
            subtitle: 'Automated strategy wizard',
            icon: <Wand2 size={22} className='text-cyan' />,
            badge: 'WIZARD',
            theme: 'card--cyan',
            callback: () => handleOpenQuickStrategy(),
        },
        {
            id: 'import-xml',
            title: 'Import XML',
            subtitle: 'Load local bot file or drive',
            icon: <FolderPlus size={22} className='text-purple' />,
            badge: 'FILE',
            theme: 'card--purple',
            callback: () => openFileLoader(),
        },
        {
            id: 'free-bots',
            title: '24+ Free Bots',
            subtitle: 'Verified pre-loaded systems',
            icon: <Zap size={22} className='text-amber' />,
            badge: 'PRE-LOADED',
            theme: 'card--amber',
            callback: () => setActiveTab(DBOT_TABS.TRADING_BOTS),
        },
        {
            id: 'smart-trader',
            title: 'Manual Trading',
            subtitle: 'Live institutional manual trading',
            icon: <TrendingUp size={22} className='text-emerald' />,
            badge: 'MANUAL',
            theme: 'card--emerald',
            callback: () => setActiveTab(DBOT_TABS.MANUAL_TRADING),
        },
    ];

    // ─── Secondary Modules: 4 Quantitative Intelligence Cards ─────────────
    const intelligenceModules = [
        {
            id: 'ai-engine',
            title: 'AI Trading Engine',
            desc: 'Neural pattern entry scanner with real-time probability triggers',
            icon: <Cpu size={22} className='text-purple' />,
            theme: 'mod--purple',
            callback: () => setActiveTab(DBOT_TABS.AI_TRADING_ENGINE),
        },
        {
            id: 'market-hunter',
            title: 'Market Hunter Pro',
            desc: 'Multi-symbol volatility scanner tracking momentum breakouts',
            icon: <Target size={22} className='text-amber' />,
            theme: 'mod--amber',
            callback: () => setActiveTab(DBOT_TABS.MARKET_HUNTER_PRO),
        },
        {
            id: 'signals',
            title: 'Market Radar & Signals',
            desc: 'Live statistical digit bias, tick velocity and streak analytics',
            icon: <Radio size={22} className='text-rose' />,
            theme: 'mod--rose',
            callback: () => setActiveTab(DBOT_TABS.SIGNALS),
        },
        {
            id: 'charts',
            title: 'Live Interactive Charts',
            desc: 'High-resolution tick feeds, technical indicators & price barriers',
            icon: <BarChart3 size={22} className='text-cyan' />,
            theme: 'mod--cyan',
            callback: () => setActiveTab(DBOT_TABS.CHART),
        },
    ];

    // ─── Institutional Feature Spotlight ─────────────────────────────────
    const platformHighlights = [
        {
            id: 'high-speed',
            title: 'Ultra-Low Latency Execution',
            desc: 'Direct WebSocket pipeline connected to Deriv trading servers with sub-millisecond dispatch.',
            icon: <Activity size={20} className='text-cyan' />,
        },
        {
            id: 'privacy',
            title: '100% Client-Side Privacy',
            desc: 'Your API tokens, custom algorithms, and XML parameters run locally in your browser sandbox.',
            icon: <Lock size={20} className='text-emerald' />,
        },
        {
            id: 'risk',
            title: 'Algorithmic Risk Shield',
            desc: 'Dynamic stop-loss triggers, consecutive loss ceiling barriers, and capital protection rules.',
            icon: <SlidersHorizontal size={20} className='text-amber' />,
        },
    ];

    return React.useMemo(
        () => (
            <div
                className={classNames('dash-cockpit', {
                    'dash-cockpit--minimized': has_dashboard_strategies && is_mobile,
                })}
            >
                {/* ═══════════════════════════════════════════════════════════════
                    1. BEAUTIFUL FROSTED SPONGY WELCOME BANNER (NO DERIV CONNECTED)
                ═══════════════════════════════════════════════════════════════ */}
                <div className='dash-welcome-strip'>
                    <div className='dash-welcome-glow' />
                    <div className='dash-welcome-glow-secondary' />

                    <div className='dash-welcome-strip__left'>
                        <div className='dash-welcome-avatar'>
                            <Sparkles size={24} className='welcome-avatar-icon' />
                        </div>
                        <div className='dash-welcome-texts'>
                            <h1 className='dash-welcome-title'>
                                Welcome user{accountName ? ` (${accountName})` : ''}!{' '}
                                <span className='dash-welcome-title-accent'>Start your trading journey here.</span>
                            </h1>
                            <p className='dash-welcome-sub'>
                                Institutional quantitative bot execution, AI market radar, and low-latency Deriv API trading.
                            </p>
                        </div>
                    </div>

                    <div className='dash-welcome-strip__right'>
                        {accountName && (
                            <span className={classNames('dash-pill-acc', isVirtual ? 'dash-pill-acc--demo' : 'dash-pill-acc--real')}>
                                {isVirtual ? 'DEMO' : 'REAL'} • {accountName}
                            </span>
                        )}
                    </div>
                </div>

                {/* ═══════════════════════════════════════════════════════════════
                    2. TELEMETRY METRIC PILLS TICKER
                ═══════════════════════════════════════════════════════════════ */}
                <div className='dash-telemetry-row'>
                    <div className='telemetry-pill'>
                        <span className='telemetry-value text-cyan'>&lt; 20ms</span>
                        <span className='telemetry-label'>Execution Speed</span>
                    </div>
                    <div className='telemetry-pill'>
                        <span className='telemetry-value text-emerald'>24+ Bots</span>
                        <span className='telemetry-label'>Verified Algorithms</span>
                    </div>
                    <div className='telemetry-pill'>
                        <span className='telemetry-value text-purple'>100%</span>
                        <span className='telemetry-label'>Client-Side Private</span>
                    </div>
                    <div className='telemetry-pill'>
                        <span className='telemetry-value text-amber'>5,000+</span>
                        <span className='telemetry-label'>Active VIP Traders</span>
                    </div>
                </div>

                {/* ═══════════════════════════════════════════════════════════════
                    3. TOP ROW: 5 STRATEGY LAUNCHERS (ONE SINGLE LINE ON DESKTOP)
                ═══════════════════════════════════════════════════════════════ */}
                <div className='dash-section-header'>
                    <div className='dash-section-title-wrap'>
                        <span className='dash-section-dot' />
                        <h3 className='dash-section-title'>Quick Strategy Launchers</h3>
                    </div>
                    <span className='dash-section-tag'>ONE-CLICK DEPLOY</span>
                </div>

                <div className='dash-load-cards-row'>
                    {loadingCards.map(card => (
                        <div
                            key={card.id}
                            className={classNames('dash-load-card', card.theme)}
                            onClick={card.callback}
                            role='button'
                            tabIndex={0}
                        >
                            <div className='dash-card-glow-halo' />
                            <div className='dash-load-card__top'>
                                <div className='dash-load-card__icon-box'>{card.icon}</div>
                                <span className='dash-load-card__badge'>{card.badge}</span>
                            </div>
                            <div className='dash-load-card__info'>
                                <h4 className='dash-load-card__title'>{card.title}</h4>
                                <span className='dash-load-card__sub'>{card.subtitle}</span>
                            </div>
                            <div className='dash-load-card__arrow'>
                                <ArrowUpRight size={17} />
                            </div>
                        </div>
                    ))}
                </div>

                {/* ═══════════════════════════════════════════════════════════════
                    4. QUANTITATIVE INTELLIGENCE & SCANNERS (4 GLOWING CARDS)
                ═══════════════════════════════════════════════════════════════ */}
                <div className='dash-section-header'>
                    <div className='dash-section-title-wrap'>
                        <span className='dash-section-dot dash-section-dot--purple' />
                        <h3 className='dash-section-title'>Quantitative Intelligence & Scanners</h3>
                    </div>
                    <span className='dash-section-tag'>LIVE MARKET DATA</span>
                </div>

                <div className='dash-intel-grid'>
                    {intelligenceModules.map(mod => (
                        <div
                            key={mod.id}
                            className={classNames('dash-intel-card', mod.theme)}
                            onClick={mod.callback}
                            role='button'
                            tabIndex={0}
                        >
                            <div className='dash-card-glow-halo' />
                            <div className='dash-intel-card__icon-box'>{mod.icon}</div>
                            <div className='dash-intel-card__text'>
                                <h5 className='dash-intel-card__title'>{mod.title}</h5>
                                <p className='dash-intel-card__desc'>{mod.desc}</p>
                            </div>
                            <div className='dash-intel-card__arrow-circle'>
                                <ArrowUpRight size={16} className='dash-intel-card__arrow' />
                            </div>
                        </div>
                    ))}
                </div>

                {/* ═══════════════════════════════════════════════════════════════
                    5. INSTITUTIONAL PLATFORM HIGHLIGHTS (3 SPONGY CARDS)
                ═══════════════════════════════════════════════════════════════ */}
                <div className='dash-features-row'>
                    {platformHighlights.map(feat => (
                        <div key={feat.id} className='dash-feature-card'>
                            <div className='dash-feature-icon-box'>{feat.icon}</div>
                            <div className='dash-feature-content'>
                                <h5 className='dash-feature-title'>{feat.title}</h5>
                                <p className='dash-feature-desc'>{feat.desc}</p>
                            </div>
                        </div>
                    ))}
                </div>

                {/* ═══════════════════════════════════════════════════════════════
                    6. BROKER PARTNERSHIP & COMMUNITY ROW
                ═══════════════════════════════════════════════════════════════ */}
                <div className='dash-partner-row'>
                    <div className='dash-partner-box dash-partner-box--deriv'>
                        <div className='dash-card-glow-halo' />
                        <div className='dash-partner-box__left'>
                            <div className='partner-icon-circle partner-icon-circle--gold'>
                                <ShieldCheck size={24} className='text-amber' />
                            </div>
                            <div>
                                <h5 className='partner-title'>Deriv Verified Live Account</h5>
                                <span className='partner-desc'>Instant deposits, fast withdrawals, tight spreads & zero slippage</span>
                            </div>
                        </div>
                        <a
                            href='https://track.deriv.com/_b_FkYd-u53x-m-sZlUf1gWNd7ZgqdRLk/1/'
                            target='_blank'
                            rel='noopener noreferrer'
                            className='partner-btn partner-btn--gold'
                        >
                            <span>Open Live Account</span>
                            <ArrowUpRight size={16} />
                        </a>
                    </div>

                    <div className='dash-partner-box dash-partner-box--community'>
                        <div className='dash-card-glow-halo' />
                        <div className='dash-partner-box__left'>
                            <div className='partner-icon-circle partner-icon-circle--emerald'>
                                <MessageCircle size={24} className='text-emerald' />
                            </div>
                            <div>
                                <h5 className='partner-title'>VIP Trading Community</h5>
                                <span className='partner-desc'>Join 5,000+ traders for daily setups, bot XML drops & mentorship</span>
                            </div>
                        </div>
                        <a
                            href='https://chat.whatsapp.com/L1n7hNl9ZJ8ErYVvXk1z6D'
                            target='_blank'
                            rel='noopener noreferrer'
                            className='partner-btn partner-btn--emerald'
                        >
                            <span>Join WhatsApp VIP</span>
                            <ArrowUpRight size={16} />
                        </a>
                    </div>
                </div>

                {/* ═══════════════════════════════════════════════════════════════
                    7. STRATEGY WORKSPACE & LOCAL SAVED BOTS
                ═══════════════════════════════════════════════════════════════ */}
                <div className='dash-workspace-card'>
                    <div className='dash-card-glow-halo' />
                    <div className='dash-workspace-card__header'>
                        <div className='dash-workspace-card__title-wrap'>
                            <div className='dash-workspace-icon-wrap'>
                                <Compass size={22} className='text-emerald' />
                            </div>
                            <div>
                                <h4 className='dash-workspace-card__title'>Strategy Workspace & Local Bots</h4>
                                <span className='dash-workspace-card__sub'>Saved strategies stored locally in your browser cache</span>
                            </div>
                        </div>
                        <div className='dash-workspace-card__btns'>
                            <button
                                type='button'
                                className='dash-btn-tactile'
                                onClick={() => openFileLoader()}
                            >
                                <FolderPlus size={15} />
                                <span>Import XML</span>
                            </button>
                            <button
                                type='button'
                                className='dash-btn-tactile dash-btn-tactile--highlight'
                                onClick={() => setActiveTab(DBOT_TABS.TRADING_BOTS)}
                            >
                                <Sparkles size={15} />
                                <span>24+ Free Bots</span>
                            </button>
                        </div>
                    </div>

                    {has_dashboard_strategies ? (
                        <div className='dash-bot-list-area'>
                            <DashboardBotList />
                        </div>
                    ) : (
                        <div className='dash-workspace-empty'>
                            <div className='dash-empty-icon'>
                                <Bot size={32} />
                            </div>
                            <p className='empty-title'>No Custom Strategies Saved Yet</p>
                            <p className='empty-text'>
                                Create custom logic in the Blockly Bot Builder, or choose from our 24+ free institutional strategies to get started.
                            </p>
                        </div>
                    )}
                </div>

                {/* ═══════════════════════════════════════════════════════════════
                    8. GOOGLE DRIVE MODAL DIALOG
                ═══════════════════════════════════════════════════════════════ */}
                {!isDesktop ? (
                    <Dialog
                        title={dialog_options.title}
                        is_visible={is_dialog_open}
                        onCancel={onCloseDialog}
                        onConfirm={() => {}}
                        is_mobile_full_width
                        className='dc-dialog__wrapper--google-drive'
                        has_close_icon
                    >
                        <GoogleDrive />
                    </Dialog>
                ) : (
                    <MobileFullPageModal
                        is_modal_open={is_dialog_open}
                        className='load-strategy__wrapper'
                        header={localize('Load strategy')}
                        onClickClose={() => {
                            setPreviewOnPopup(false);
                            onCloseDialog();
                        }}
                        height_offset='80px'
                    >
                        <div label='Google Drive' className='google-drive-label'>
                            <GoogleDrive />
                        </div>
                    </MobileFullPageModal>
                )}
            </div>
        ),
        [
            is_dialog_open,
            has_dashboard_strategies,
            is_mobile,
            isDesktop,
            accountName,
            isVirtual,
            dialog_options.title,
            onCloseDialog,
            openFileLoader,
            handleOpenQuickStrategy,
            setActiveTab,
            setPreviewOnPopup
        ]
    );
});

export default Cards;
