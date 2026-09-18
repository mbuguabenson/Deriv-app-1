import React from 'react';
import { observer } from 'mobx-react-lite';
import { DTraderIframeContainer } from '@/components/dtrader-iframe';
import './dtrader.scss';

const DTraderPage: React.FC = observer(() => {
    return (
        <div className='dtrader-page-wrapper'>
            <DTraderIframeContainer
                height='100%'
                showToolbar={true}
            />
        </div>
    );
});

export default DTraderPage;
