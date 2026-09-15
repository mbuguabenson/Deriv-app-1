import React, { useState } from 'react';
import classNames from 'classnames';
import './dtrader.scss';

const PageHeader = ({
    eyebrow,
    title,
    subtitle,
    right,
}: {
    eyebrow: string;
    title: string;
    subtitle: string;
    right?: React.ReactNode;
}) => (
    <header className='prodb-import-header'>
        <div>
            <span>{eyebrow}</span>
            <h1>{title}</h1>
            <p>{subtitle}</p>
        </div>
        {right}
    </header>
);

export const DTraderPage: React.FC = () => {
    const [chartSource, setChartSource] = useState<'deriv_charts' | 'deriv_dtrader'>('deriv_charts');
    const [isFullscreen, setIsFullscreen] = useState(false);
    const [isLoading, setIsLoading] = useState(true);
    const [reloadKey, setReloadKey] = useState(0);

    const chartUrl =
        chartSource === 'deriv_charts'
            ? 'https://charts.deriv.com/deriv'
            : 'https://deriv-dtrader.vercel.app';

    const handleReload = () => {
        setIsLoading(true);
        setReloadKey(prev => prev + 1);
    };

    return (
        <div
            className={classNames('prodb-import-page prodb-iframe-page', {
                'is-fullscreen': isFullscreen,
            })}
        >
            <PageHeader
                eyebrow='IMPORTED · DTRADER'
                title='DTrader Charts'
                subtitle='The source DTrader page is preserved with the Deriv chart workspace inside the premium navigation.'
                right={
                    <div className='prodb-header-actions'>
                        <button
                            type='button'
                            className={classNames('prodb-btn', {
                                'prodb-btn--active': chartSource === 'deriv_charts',
                            })}
                            onClick={() => {
                                setChartSource('deriv_charts');
                                setIsLoading(true);
                            }}
                        >
                            📊 Deriv Charts
                        </button>
                        <button
                            type='button'
                            className={classNames('prodb-btn', {
                                'prodb-btn--active': chartSource === 'deriv_dtrader',
                            })}
                            onClick={() => {
                                setChartSource('deriv_dtrader');
                                setIsLoading(true);
                            }}
                        >
                            ⚡ DTrader Terminal
                        </button>
                        <button type='button' className='prodb-btn' onClick={handleReload} title='Reload'>
                            🔄 Reload
                        </button>
                        <button
                            type='button'
                            className='prodb-btn'
                            onClick={() => setIsFullscreen(prev => !prev)}
                            title='Toggle Fullscreen'
                        >
                            {isFullscreen ? '✖ Exit' : '⛶ Fullscreen'}
                        </button>
                        <a
                            href={chartUrl}
                            target='_blank'
                            rel='noopener noreferrer'
                            className='prodb-btn'
                            title='Open in new window'
                        >
                            ↗ Popout
                        </a>
                    </div>
                }
            />

            <div className='prodb-iframe-wrapper'>
                {isLoading && (
                    <div className='prodb-loading-overlay'>
                        <div className='prodb-spinner' />
                        <span>Loading Deriv Chart Workspace...</span>
                    </div>
                )}
                <iframe
                    key={`${chartUrl}-${reloadKey}`}
                    src={chartUrl}
                    title='Deriv DTrader charts'
                    allow='fullscreen; accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture'
                    onLoad={() => setIsLoading(false)}
                />
            </div>
        </div>
    );
};

export default DTraderPage;
