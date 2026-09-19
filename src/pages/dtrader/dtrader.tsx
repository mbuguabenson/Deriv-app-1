import React from 'react';
import { observer } from 'mobx-react-lite';
import { DTraderIframeContainer } from '@/components/dtrader-iframe';
import { useStore } from '@/hooks/useStore';
import {
    getAccountsList,
    getActiveLoginId,
    getActiveToken,
    getLegacyDTraderToken,
} from '@/utils/token-bridge';
import './dtrader.scss';

const DTraderPage: React.FC = observer(() => {
    const { client, ui } = useStore() ?? {};

    const activeLoginId = client?.loginid || getActiveLoginId();
    const token =
        getActiveToken(activeLoginId) ||
        getLegacyDTraderToken(activeLoginId) ||
        getAccountsList()[activeLoginId] ||
        '';
    const theme = ui?.is_dark_mode_on ? 'dark' : 'light';

    return (
        <div className='dtrader-page-wrapper'>
            <DTraderIframeContainer
                baseUrl='https://deriv-dtrader.vercel.app'
                token={token || undefined}
                loginId={activeLoginId || undefined}
                theme={theme}
                height='100%'
                showToolbar={false}
            />
        </div>
    );
});

export default DTraderPage;
