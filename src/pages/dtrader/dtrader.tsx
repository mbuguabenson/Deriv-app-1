import React from 'react';
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

export const DTraderPage: React.FC = () => (
    <div className='prodb-import-page prodb-iframe-page'>
        <PageHeader
            eyebrow='IMPORTED · DTRADER'
            title='DTrader Charts'
            subtitle='The source DTrader page is preserved with the Deriv chart workspace inside the premium navigation.'
        />
        <iframe
            src='https://charts.deriv.com/deriv'
            title='Deriv DTrader charts'
            allow='fullscreen'
        />
    </div>
);

export default DTraderPage;
