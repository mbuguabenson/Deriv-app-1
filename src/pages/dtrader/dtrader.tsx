import React from 'react';
import { observer } from 'mobx-react-lite';
import { DTraderIframeContainer } from '@/components/dtrader-iframe';
import { useStore } from '@/hooks/useStore';
import {
    getAccountsList,
    getActiveLoginId,
    getActiveToken,
    getLegacyDTraderToken,
    isLegacyToken,
} from '@/utils/token-bridge';
import './dtrader.scss';

const DTraderPage: React.FC = observer(() => {
    const { client, ui } = useStore() ?? {};

    const activeLoginId = client?.loginid || getActiveLoginId();
    const legacyToken = getLegacyDTraderToken(activeLoginId);
    const token =
        (legacyToken && isLegacyToken(legacyToken) ? legacyToken : null) ||
        (client?.token && isLegacyToken(client.token) ? client.token : null) ||
        (getAccountsList()[activeLoginId] && isLegacyToken(getAccountsList()[activeLoginId]) ? getAccountsList()[activeLoginId] : null) ||
        getActiveToken(activeLoginId) ||
        localStorage.getItem('token1') ||
        localStorage.getItem('legacy_dtrader_token') ||
        '';
    const theme = ui?.is_dark_mode_on ? 'dark' : 'light';

    return (
        <div className='dtrader-page-wrapper'>
            <DTraderIframeContainer
                baseUrl='https://profhubdtrader.vercel.app'
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
