import React from 'react';
import { observer } from 'mobx-react-lite';
import { NOTIFICATION_TYPE } from '@/components/bot-notification/bot-notification-utils';
import { useStore } from '@/hooks/useStore';
import { localize } from '@deriv-com/translations';
import { useDevice } from '@deriv-com/ui';
import Button from '../shared_ui/button';

const LocalFooter = observer(() => {
    const { load_modal, dashboard } = useStore();
    const {
        is_open_button_loading,
        is_open_button_disabled,
        loadStrategyOnBotBuilder,
        setLoadedLocalFile,
        saveStrategyToLocalStorage,
        toggleLoadModal,
    } = load_modal;
    const { setOpenSettings, setPreviewOnPopup } = dashboard;
    const { isDesktop } = useDevice();
    const Wrapper = isDesktop ? React.Fragment : Button.Group;

    const [is_saving, setIsSaving] = React.useState(false);

    const handleSaveOnly = async () => {
        setIsSaving(true);
        try {
            await saveStrategyToLocalStorage();
            setLoadedLocalFile(null);
            toggleLoadModal();
            setPreviewOnPopup(false);
            setOpenSettings(NOTIFICATION_TYPE.BOT_IMPORT);
        } finally {
            setIsSaving(false);
        }
    };

    const handleLoadAndOpen = async () => {
        await loadStrategyOnBotBuilder();
        await saveStrategyToLocalStorage();
        setLoadedLocalFile(null);
        toggleLoadModal();
        setPreviewOnPopup(false);
        setOpenSettings(NOTIFICATION_TYPE.BOT_IMPORT);
    };

    return (
        <Wrapper>
            <Button
                text={localize('Cancel')}
                onClick={() => setLoadedLocalFile(null)}
                has_effect
                secondary
                large
            />
            <Button
                text={localize('Save to List')}
                onClick={handleSaveOnly}
                is_loading={is_saving}
                has_effect
                tertiary
                large
                disabled={is_open_button_disabled || is_open_button_loading}
            />
            <Button
                text={localize('Load Bot')}
                onClick={handleLoadAndOpen}
                is_loading={is_open_button_loading}
                has_effect
                primary
                large
                disabled={is_open_button_disabled || is_saving}
            />
        </Wrapper>
    );
});

export default LocalFooter;
