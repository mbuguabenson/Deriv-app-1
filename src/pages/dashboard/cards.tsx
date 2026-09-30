import React from 'react';
import classNames from 'classnames';
import { observer } from 'mobx-react-lite';
import Text from '@/components/shared_ui/text';
import { DBOT_TABS } from '@/constants/bot-contents';
import { useStore } from '@/hooks/useStore';
import { Localize } from '@deriv-com/translations';
import DashboardBotList from './bot-list/dashboard-bot-list';

type TCardProps = {
    has_dashboard_strategies: boolean;
    is_mobile: boolean;
};

type TCardArray = {
    id: string;
    icon: React.ReactElement;
    content: React.ReactElement;
    description?: React.ReactElement;
    callback: () => void;
};

const Cards = observer(({ is_mobile, has_dashboard_strategies }: TCardProps) => {
    const { dashboard, load_modal, quick_strategy } = useStore();
    const { toggleLoadModal, setActiveTabIndex } = load_modal;
    const { setActiveTab } = dashboard;
    const { setFormVisibility } = quick_strategy;

    const openFileLoader = () => {
        toggleLoadModal();
        setActiveTabIndex(is_mobile ? 0 : 1);
        setActiveTab(DBOT_TABS.BOT_BUILDER);
    };

    const actions: TCardArray[] = [
        {
            id: 'my-computer',
            icon: (
                <svg width='48' height='48' viewBox='0 0 48 48' fill='none' className='dashboard-action-icon'>
                    <defs>
                        <linearGradient id='device-grad' x1='0%' y1='0%' x2='100%' y2='100%'>
                            <stop offset='0%' stopColor='#06b6d4' />
                            <stop offset='100%' stopColor='#3b82f6' />
                        </linearGradient>
                        <filter id='cyan-glow' x='-20%' y='-20%' width='140%' height='140%'>
                            <feDropShadow dx='0' dy='2' stdDeviation='4' floodColor='#06b6d4' floodOpacity='0.45' />
                        </filter>
                    </defs>
                    <rect
                        x='6'
                        y='8'
                        width='36'
                        height='26'
                        rx='5'
                        fill='url(#device-grad)'
                        fillOpacity='0.16'
                        stroke='url(#device-grad)'
                        strokeWidth='2.2'
                        filter='url(#cyan-glow)'
                    />
                    <path d='M18 38h12M24 34v4' stroke='url(#device-grad)' strokeWidth='2.2' strokeLinecap='round' />
                    <path
                        d='M24 26V16m0 0l-4 4m4-4l4 4'
                        stroke='#38bdf8'
                        strokeWidth='2.2'
                        strokeLinecap='round'
                        strokeLinejoin='round'
                    />
                    <circle cx='24' cy='11' r='1.2' fill='#38bdf8' />
                </svg>
            ),
            content: <Localize i18n_default_text='Import Bot' />,
            description: <Localize i18n_default_text='From this device' />,
            callback: () => {
                openFileLoader();
            },
        },
        {
            id: 'bot-builder',
            icon: (
                <svg width='48' height='48' viewBox='0 0 48 48' fill='none' className='dashboard-action-icon'>
                    <defs>
                        <linearGradient id='bot-grad' x1='0%' y1='0%' x2='100%' y2='100%'>
                            <stop offset='0%' stopColor='#a855f7' />
                            <stop offset='100%' stopColor='#6366f1' />
                        </linearGradient>
                        <filter id='bot-glow' x='-20%' y='-20%' width='140%' height='140%'>
                            <feDropShadow dx='0' dy='2' stdDeviation='4' floodColor='#8b5cf6' floodOpacity='0.45' />
                        </filter>
                    </defs>
                    <rect
                        x='8'
                        y='12'
                        width='32'
                        height='26'
                        rx='6'
                        fill='url(#bot-grad)'
                        fillOpacity='0.16'
                        stroke='url(#bot-grad)'
                        strokeWidth='2.2'
                        filter='url(#bot-glow)'
                    />
                    <path d='M24 6v6M18 6h12' stroke='url(#bot-grad)' strokeWidth='2' strokeLinecap='round' />
                    <circle cx='18' cy='23' r='3' fill='#c084fc' />
                    <circle cx='30' cy='23' r='3' fill='#c084fc' />
                    <path
                        d='M19 30c1.5 1.8 3.5 2.2 5 2.2s3.5-.4 5-2.2'
                        stroke='#e9d5ff'
                        strokeWidth='2'
                        strokeLinecap='round'
                    />
                    <rect x='4' y='21' width='4' height='8' rx='2' fill='#8b5cf6' />
                    <rect x='40' y='21' width='4' height='8' rx='2' fill='#8b5cf6' />
                </svg>
            ),
            content: <Localize i18n_default_text='Bot Builder' />,
            description: <Localize i18n_default_text='Visual block editor' />,
            callback: () => {
                setActiveTab(DBOT_TABS.BOT_BUILDER);
            },
        },
        {
            id: 'quick-strategy',
            icon: (
                <svg width='48' height='48' viewBox='0 0 48 48' fill='none' className='dashboard-action-icon'>
                    <defs>
                        <linearGradient id='quick-grad' x1='0%' y1='0%' x2='100%' y2='100%'>
                            <stop offset='0%' stopColor='#f59e0b' />
                            <stop offset='100%' stopColor='#10b981' />
                        </linearGradient>
                        <filter id='quick-glow' x='-20%' y='-20%' width='140%' height='140%'>
                            <feDropShadow dx='0' dy='2' stdDeviation='4' floodColor='#f59e0b' floodOpacity='0.45' />
                        </filter>
                    </defs>
                    <circle
                        cx='24'
                        cy='24'
                        r='18'
                        fill='url(#quick-grad)'
                        fillOpacity='0.14'
                        stroke='url(#quick-grad)'
                        strokeWidth='2.2'
                        filter='url(#quick-glow)'
                    />
                    <path
                        d='M26 10L14 26h10l-2 12 12-16H24l2-12z'
                        fill='url(#quick-grad)'
                        stroke='#fbbf24'
                        strokeWidth='1.5'
                        strokeLinejoin='round'
                    />
                </svg>
            ),
            content: <Localize i18n_default_text='Quick Strategy' />,
            description: <Localize i18n_default_text='Pre-built algorithms' />,
            callback: () => {
                setActiveTab(DBOT_TABS.BOT_BUILDER);
                setFormVisibility(true);
            },
        },
    ];

    return React.useMemo(
        () => (
            <div
                className={classNames('tab__dashboard__table', {
                    'tab__dashboard__table--minimized': has_dashboard_strategies && is_mobile,
                })}
            >
                <div
                    className={classNames('tab__dashboard__table__tiles', {
                        'tab__dashboard__table__tiles--minimized': has_dashboard_strategies && is_mobile,
                    })}
                    id='tab__dashboard__table__tiles'
                >
                    {actions.map(actionItem => {
                        const { icon, content, description, callback, id } = actionItem;
                        return (
                            <div
                                key={id}
                                className={classNames('tab__dashboard__table__block', {
                                    'tab__dashboard__table__block--minimized': has_dashboard_strategies && is_mobile,
                                })}
                                onClick={callback}
                            >
                                <div
                                    className={classNames('tab__dashboard__table__images', {
                                        'tab__dashboard__table__images--minimized': has_dashboard_strategies,
                                    })}
                                    id={id}
                                >
                                    {icon}
                                </div>
                                <div className='tab__dashboard__table__text-wrap'>
                                    <Text
                                        color='prominent'
                                        weight='bold'
                                        size={is_mobile ? 'xxs' : 'xs'}
                                        className='tab__dashboard__table__title'
                                    >
                                        {content}
                                    </Text>
                                    {!has_dashboard_strategies && description && (
                                        <Text color='less-prominent' size='xxs' className='tab__dashboard__table__sub'>
                                            {description}
                                        </Text>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>
                <DashboardBotList />
            </div>
        ),
        [has_dashboard_strategies, is_mobile]
    );
});

export default Cards;
