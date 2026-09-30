import React from 'react';
import { observer } from 'mobx-react-lite';
import { tabs_title } from '@/constants/load-modal';
import { useStore } from '@/hooks/useStore';
import { localize } from '@deriv-com/translations';
import { useDevice } from '@deriv-com/ui';
/* [AI] - Analytics event tracking removed - see migrate-docs/MONITORING_PACKAGES.md for re-implementation guide */
/* [/AI] */
import MobileFullPageModal from '../shared_ui/mobile-full-page-modal';
import Modal from '../shared_ui/modal';
import Tabs from '../shared_ui/tabs';
import Local from './local';
import LocalFooter from './local-footer';
import Recent from './recent';
import RecentFooter from './recent-footer';

const LoadModal: React.FC = observer(() => {
    const { load_modal, dashboard } = useStore();
    const {
        active_index,
        is_load_modal_open,
        loaded_local_file,
        onEntered,
        recent_strategies,
        setActiveTabIndex,
        toggleLoadModal,
        tab_name,
    } = load_modal;
    const { setPreviewOnPopup } = dashboard;
    const { isDesktop } = useDevice();
    const header_text = localize('Load strategy');

    const handleTabItemClick = (active_index: number) => {
        setActiveTabIndex(active_index);
        /* [AI] - Analytics event tracking removed - see migrate-docs/MONITORING_PACKAGES.md for re-implementation guide */
        /* [/AI] */
    };

    if (!isDesktop) {
        return (
            <MobileFullPageModal
                is_modal_open={is_load_modal_open}
                className='load-strategy__wrapper'
                header={header_text}
                onClickClose={() => {
                    setPreviewOnPopup(false);
                    toggleLoadModal();
                }}
                height_offset='80px'
                page_overlay
            >
                <Tabs active_index={active_index} onTabItemClick={handleTabItemClick} top>
                    <div label={localize('Local')}>
                        <Local />
                    </div>
                </Tabs>
            </MobileFullPageModal>
        );
    }

    const is_file_loaded = !!loaded_local_file;
    const has_recent_strategies = !is_file_loaded && recent_strategies.length > 0 && active_index === 0;

    return (
        <Modal
            title={header_text}
            className='load-strategy'
            width='720px'
            height='auto'
            is_open={is_load_modal_open}
            toggleModal={() => {
                toggleLoadModal();
            }}
            onEntered={onEntered}
            elements_to_ignore={[document.querySelector('.injectionDiv')]}
        >
            <Modal.Body>
                <Tabs active_index={active_index} onTabItemClick={handleTabItemClick} top header_fit_content>
                    <div label={localize('Recent')}>
                        <Recent />
                    </div>
                    <div label={localize('Local')}>
                        <Local />
                    </div>
                </Tabs>
            </Modal.Body>
            {has_recent_strategies && (
                <Modal.Footer has_separator>
                    <RecentFooter />
                </Modal.Footer>
            )}
            {is_file_loaded && (
                <Modal.Footer has_separator>
                    <LocalFooter />
                </Modal.Footer>
            )}
        </Modal>
    );
});

export default LoadModal;
