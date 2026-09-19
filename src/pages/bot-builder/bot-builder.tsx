import React from 'react';
import classNames from 'classnames';
import { observer } from 'mobx-react-lite';
import { botNotification } from '@/components/bot-notification/bot-notification';
import { notification_message } from '@/components/bot-notification/bot-notification-utils';
import { useStore } from '@/hooks/useStore';
import { localize } from '@deriv-com/translations';
import { useDevice } from '@deriv-com/ui';
import LoadModal from '../../components/load-modal';
import VirtualHookModal from '@/components/virtual-hook-modal/virtual-hook-modal';
import BotBuilderTourHandler from '../tutorials/dbot-tours/bot-builder-tour';
import QuickStrategy1 from './quick-strategy';
import EntryScanner from '../entry-scanner/entry-scanner';
import WorkspaceWrapper from './workspace-wrapper';
import DraggableResizeWrapper from '@/components/draggable/draggable-resize-wrapper';
import { DBOT_TABS } from '@/constants/bot-contents';
import { syncBlocklyPurchaseBlocks } from '@/external/bot-skeleton/services/tradeEngine/utils/fastMode';

import Signals from '@/pages/signals/signals';
import MobileFullPageModal from '@/components/shared_ui/mobile-full-page-modal';

const BotBuilder = observer(() => {
    const { dashboard, app, run_panel, toolbar, quick_strategy, blockly_store, load_modal, entry_scanner } = useStore();
    const { active_tab, active_tour, is_preview_on_popup } = dashboard;
    const { is_open } = quick_strategy;
    const { is_running } = run_panel;
    const { is_loading } = blockly_store;
    const is_blockly_listener_registered = React.useRef(false);
    const is_blockly_delete_listener_registered = React.useRef(false);
    const { isDesktop } = useDevice();
    const { onMount, onUnmount } = app;
    const el_ref = React.useRef<HTMLInputElement | null>(null);

    // TODO: fix
    // const isMounted = useIsMounted();
    // const { data: remote_config_data } = useRemoteConfig(isMounted());
    let deleted_block_id: null | string = null;

    React.useEffect(() => {
        onMount();
        return () => onUnmount();
    }, [onMount, onUnmount]);

    // Keep Blockly purchase blocks synchronized with header speed toggle
    React.useEffect(() => {
        if (active_tab === DBOT_TABS.BOT_BUILDER) {
            syncBlocklyPurchaseBlocks(run_panel.is_every_tick_mode);
        }
    }, [active_tab, run_panel.is_every_tick_mode]);

    React.useEffect(() => {
        const workspace = window.Blockly?.derivWorkspace;
        if (workspace && is_running && !is_blockly_listener_registered.current) {
            is_blockly_listener_registered.current = true;
            workspace.addChangeListener(handleBlockChangeOnBotRun as any);
        } else {
            removeBlockChangeListener();
        }

        return () => {
            if (workspace && is_blockly_listener_registered.current) {
                removeBlockChangeListener();
            }
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [is_running]);

    const handleBlockChangeOnBotRun = (e: Event) => {
        const { is_reset_button_clicked } = toolbar;
        if (e.type !== 'selected' && !is_reset_button_clicked) {
            botNotification(notification_message().workspace_change);
            removeBlockChangeListener();
        } else if (is_reset_button_clicked) {
            removeBlockChangeListener();
        }
    };

    const removeBlockChangeListener = () => {
        is_blockly_listener_registered.current = false;
        window.Blockly?.derivWorkspace?.removeChangeListener(handleBlockChangeOnBotRun as any);
    };
    React.useEffect(() => {
        const workspace = window.Blockly?.derivWorkspace;
        if (workspace && !is_blockly_delete_listener_registered.current) {
            is_blockly_delete_listener_registered.current = true;
            workspace.addChangeListener(handleBlockDelete as any);
        }

        return () => {
            if (workspace && is_blockly_delete_listener_registered.current) {
                is_blockly_delete_listener_registered.current = false;
                workspace.removeChangeListener(handleBlockDelete as any);
            }
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [is_loading]);

    const handleBlockDelete = (e: any) => {
        const { is_reset_button_clicked, setResetButtonState } = toolbar;
        if (e.type === 'undo') {
            deleted_block_id = null;
            return;
        }
        if (e.type === 'delete' && !is_reset_button_clicked) {
            deleted_block_id = e.blockId;
        }
        if (e.type === 'selected' && deleted_block_id === e.oldElementId) {
            handleBlockDeleteNotification();
            deleted_block_id = null;
        }
        if (
            e.type === 'change' &&
            e.name === 'AMOUNT_LIMITS' &&
            e.newValue === '(min: 0.35 - max: 50000)' &&
            is_reset_button_clicked
        ) {
            setResetButtonState(false);
        }
    };

    const handleBlockDeleteNotification = () => {
        botNotification(notification_message().block_delete, {
            label: localize('Undo'),
            onClick: closeToast => {
                (window.Blockly?.derivWorkspace as any)?.undo();
                closeToast?.();
            },
        });
    };

    React.useEffect(() => {
        if (!dashboard.pending_free_bot) return;

        let is_mounted = true;
        let attempts = 0;
        const max_attempts = 40;

        const checkAndLoad = () => {
            const workspace = window.Blockly?.derivWorkspace;
            const blocksLoaded = (window.Blockly?.Blocks as any)?.trade_definition;
            if (workspace && !is_loading && blocksLoaded) {
                if (is_mounted && dashboard.pending_free_bot) {
                    const { name, xml } = dashboard.pending_free_bot;
                    dashboard.setPendingFreeBot(null);
                    setTimeout(() => {
                        load_modal.loadStrategyToBuilder({
                            id: name,
                            name,
                            xml,
                            save_type: 'local',
                        } as any);
                    }, 50);
                }
            } else {
                attempts++;
                if (attempts < max_attempts && is_mounted) {
                    setTimeout(checkAndLoad, 250);
                }
            }
        };

        checkAndLoad();

        return () => {
            is_mounted = false;
        };
    }, [active_tab, is_loading, dashboard.pending_free_bot, load_modal]);

    // Resize Blockly workspace on tab change, assistant toggle, or drawer state
    React.useEffect(() => {
        if (active_tab === DBOT_TABS.BOT_BUILDER) {
            const timer = setTimeout(() => {
                window.dispatchEvent(new Event('resize'));
                if (window.Blockly?.derivWorkspace) {
                    (window.Blockly as any)?.svgResize?.(window.Blockly.derivWorkspace);
                }
            }, 100);
            return () => clearTimeout(timer);
        }
    }, [active_tab, dashboard.is_protool_assistant_visible, run_panel.is_drawer_open]);

    const showSidebar = dashboard.is_protool_assistant_visible;
    const showEntryScanner = entry_scanner.is_scanner_open;

    return (
        <>
            <div
                className={classNames('bot-builder', {
                    'bot-builder--active': active_tab === DBOT_TABS.BOT_BUILDER && !is_preview_on_popup,
                    'bot-builder--inactive': is_preview_on_popup,
                    'bot-builder--tour-active': active_tour,
                    'bot-builder--drawer-open': isDesktop && run_panel.is_drawer_open,
                })}
                style={{ display: 'flex', flexDirection: 'row', width: '100%', height: '100%', overflow: 'hidden' }}
            >
                <div
                    id='scratch_div'
                    ref={el_ref}
                    style={{
                        flex: 1,
                        minWidth: 0,
                        width: '100%',
                    }}
                >
                    <WorkspaceWrapper />
                </div>
                {showSidebar && isDesktop && (
                    <DraggableResizeWrapper
                        boundary='.main'
                        header={localize('Premium AI Signals Engine')}
                        onClose={() => dashboard.setProToolAssistantVisibility(false)}
                        modalWidth={420}
                        modalHeight={540}
                        minWidth={320}
                        minHeight={380}
                        enableResizing
                    >
                        <div
                            style={{
                                flex: 1,
                                height: '100%',
                                overflow: 'hidden',
                                display: 'flex',
                                flexDirection: 'column',
                            }}
                        >
                            <React.Suspense fallback={<div>Loading Premium Signals...</div>}>
                                <Signals />
                            </React.Suspense>
                        </div>
                    </DraggableResizeWrapper>
                )}
                {showEntryScanner && isDesktop && (
                    <DraggableResizeWrapper
                        boundary='.main'
                        header={localize('Entry Scanner')}
                        onClose={() => (entry_scanner.is_scanner_open = false)}
                        modalWidth={520}
                        modalHeight={500}
                        minWidth={340}
                        minHeight={380}
                        enableResizing
                    >
                        <div
                            style={{
                                flex: 1,
                                height: '100%',
                                overflow: 'hidden',
                                display: 'flex',
                                flexDirection: 'column',
                            }}
                        >
                            <React.Suspense fallback={<div>Loading Entry Scanner...</div>}>
                                <EntryScanner />
                            </React.Suspense>
                        </div>
                    </DraggableResizeWrapper>
                )}
            </div>
            {active_tab === DBOT_TABS.BOT_BUILDER && <BotBuilderTourHandler is_mobile={!isDesktop} />}
            {/* removed this outside from toolbar becuase it needs to loaded seperately without dependency */}
            <LoadModal />
            <VirtualHookModal />
            {is_open && <QuickStrategy1 />}
            {showSidebar && !isDesktop && (
                <MobileFullPageModal
                    is_modal_open={showSidebar}
                    header={localize('Premium AI Signals Engine')}
                    onClickClose={() => dashboard.setProToolAssistantVisibility(false)}
                    height_offset='80px'
                >
                    <div className='protool-ai-modal-body'>
                        <React.Suspense fallback={<div>Loading Premium Signals...</div>}>
                            <Signals />
                        </React.Suspense>
                    </div>
                </MobileFullPageModal>
            )}
        </>
    );
});

export default BotBuilder;
