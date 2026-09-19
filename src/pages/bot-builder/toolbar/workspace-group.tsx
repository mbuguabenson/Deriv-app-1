import classNames from 'classnames';
import { observer } from 'mobx-react-lite';
import { useStore } from '@/hooks/useStore';
import {
    LabelPairedArrowRotateLeftMdRegularIcon,
    LabelPairedArrowRotateRightMdRegularIcon,
    LabelPairedArrowsRotateMdRegularIcon,
    LabelPairedChartLineMdRegularIcon,
    LabelPairedChartTradingviewMdRegularIcon,
    LabelPairedFolderOpenMdRegularIcon,
    LabelPairedMagnifyingGlassMinusMdRegularIcon,
    LabelPairedMagnifyingGlassPlusMdRegularIcon,
    LabelPairedObjectsAlignLeftMdRegularIcon,
} from '@deriv/quill-icons/LabelPaired';
import { localize } from '@deriv-com/translations';
import { useDevice } from '@deriv-com/ui';
import ToolbarIcon from './toolbar-icon';

const WorkspaceGroup = observer(() => {
    const { dashboard, toolbar, load_modal, scanner, entry_scanner } = useStore();
    const { setPreviewOnPopup, setChartModalVisibility, setTradingViewModalVisibility, setProfihubModalVisibility } =
        dashboard;
    const { has_redo_stack, has_undo_stack, onResetClick, onSortClick, onUndoClick, onZoomInOutClick } = toolbar;
    const { toggleLoadModal } = load_modal;
    const { setScannerVisibility } = scanner;
    const { isDesktop } = useDevice();

    return (
        <div className='toolbar__wrapper'>
            <div className='toolbar__group toolbar__group-btn' data-testid='dt_toolbar_group_btn'>
                <ToolbarIcon
                    popover_message={localize('Reset')}
                    icon={
                        <span
                            id='db-toolbar__reset-button'
                            className='toolbar__icon'
                            onClick={onResetClick}
                            data-testid='dt_toolbar_reset_button'
                        >
                            <LabelPairedArrowsRotateMdRegularIcon />
                        </span>
                    }
                />
                <ToolbarIcon
                    popover_message={localize('Import')}
                    icon={
                        <span
                            className='toolbar__icon'
                            id='db-toolbar__import-button'
                            data-testid='dt_toolbar_import_button'
                            onClick={() => {
                                setPreviewOnPopup(true);
                                toggleLoadModal();
                            }}
                        >
                            <LabelPairedFolderOpenMdRegularIcon />
                        </span>
                    }
                />
                <ToolbarIcon
                    popover_message={localize('Sort blocks')}
                    icon={
                        <span
                            className='toolbar__icon'
                            id='db-toolbar__sort-button'
                            data-testid='dt_toolbar_sort_button'
                            onClick={onSortClick}
                        >
                            <LabelPairedObjectsAlignLeftMdRegularIcon />
                        </span>
                    }
                />
                <>
                    <div className='vertical-divider' />
                    {isDesktop && (
                        <>
                            <ToolbarIcon
                                popover_message={localize('Charts')}
                                icon={
                                    <span
                                        className='toolbar__icon'
                                        id='db-toolbar__charts-button'
                                        onClick={() => setChartModalVisibility()}
                                    >
                                        <LabelPairedChartLineMdRegularIcon />
                                    </span>
                                }
                            />
                            <ToolbarIcon
                                popover_message={localize('TradingView Chart')}
                                icon={
                                    <span
                                        className='toolbar__icon'
                                        id='db-toolbar__tradingview-button'
                                        onClick={() => setTradingViewModalVisibility()}
                                    >
                                        <LabelPairedChartTradingviewMdRegularIcon />
                                    </span>
                                }
                            />
                        </>
                    )}
                    <ToolbarIcon
                        popover_message={localize('Analysis')}
                        icon={
                            <span
                                className='toolbar__icon'
                                id='db-toolbar__analysis-button'
                                onClick={() => setProfihubModalVisibility()}
                            >
                                <svg
                                    width='20'
                                    height='20'
                                    viewBox='0 0 24 24'
                                    fill='none'
                                    style={{
                                        verticalAlign: 'middle',
                                        filter: 'drop-shadow(0 0 4px rgba(56,189,248,0.5))',
                                    }}
                                >
                                    <defs>
                                        <linearGradient id='ph_analysis_grad' x1='0%' y1='0%' x2='100%' y2='100%'>
                                            <stop offset='0%' stopColor='#38bdf8' />
                                            <stop offset='100%' stopColor='#6366f1' />
                                        </linearGradient>
                                    </defs>
                                    <circle
                                        cx='11'
                                        cy='11'
                                        r='7'
                                        stroke='url(#ph_analysis_grad)'
                                        strokeWidth='2'
                                        strokeDasharray='32'
                                        strokeDashoffset='0'
                                    />
                                    <path d='M11 7v4l3 2' stroke='#38bdf8' strokeWidth='2' strokeLinecap='round' />
                                    <path
                                        d='M16 16l4.5 4.5'
                                        stroke='url(#ph_analysis_grad)'
                                        strokeWidth='2.5'
                                        strokeLinecap='round'
                                    />
                                    <circle cx='11' cy='11' r='2' fill='#38bdf8' />
                                </svg>
                            </span>
                        }
                    />
                    <ToolbarIcon
                        popover_message={localize('AI Market Scanner')}
                        icon={
                            <span
                                className='toolbar__icon'
                                id='db-toolbar__scanner-button'
                                data-testid='dt_toolbar_scanner_button'
                                onClick={() => {
                                    console.log('SCANNER TOOLBAR BUTTON CLICKED!');
                                    setPreviewOnPopup(true);
                                    setScannerVisibility();
                                }}
                            >
                                <svg
                                    width='20'
                                    height='20'
                                    viewBox='0 0 24 24'
                                    fill='none'
                                    style={{
                                        verticalAlign: 'middle',
                                        filter: 'drop-shadow(0 0 4px rgba(52,211,153,0.5))',
                                    }}
                                >
                                    <defs>
                                        <linearGradient id='ph_scanner_grad' x1='0%' y1='0%' x2='100%' y2='100%'>
                                            <stop offset='0%' stopColor='#34d399' />
                                            <stop offset='100%' stopColor='#10b981' />
                                        </linearGradient>
                                    </defs>
                                    <path
                                        d='M12 3a9 9 0 0 1 9 9'
                                        stroke='url(#ph_scanner_grad)'
                                        strokeWidth='2'
                                        strokeLinecap='round'
                                        opacity='0.4'
                                    />
                                    <path
                                        d='M12 7a5 5 0 0 1 5 5'
                                        stroke='url(#ph_scanner_grad)'
                                        strokeWidth='2'
                                        strokeLinecap='round'
                                    />
                                    <circle cx='12' cy='12' r='2.5' fill='#34d399' />
                                    <path
                                        d='M3 17l4-4 3 3 6-7'
                                        stroke='#f5c542'
                                        strokeWidth='2'
                                        strokeLinecap='round'
                                        strokeLinejoin='round'
                                    />
                                </svg>
                            </span>
                        }
                    />
                    <ToolbarIcon
                        popover_message={localize('AI Trading Engine')}
                        icon={
                            <span
                                className={classNames('toolbar__icon', {
                                    'toolbar__icon--active': scanner.is_full_ai_automation,
                                })}
                                id='db-toolbar__ai-trading-button'
                                onClick={() => {
                                    scanner.setFullAiAutomation(!scanner.is_full_ai_automation);
                                    if (!scanner.is_open) {
                                        setPreviewOnPopup(true);
                                        setScannerVisibility(true);
                                    }
                                }}
                            >
                                <svg
                                    width='22'
                                    height='22'
                                    viewBox='0 0 24 24'
                                    fill='none'
                                    style={{
                                        verticalAlign: 'middle',
                                        filter: 'drop-shadow(0 0 5px rgba(16,185,129,0.7))',
                                    }}
                                >
                                    <defs>
                                        <linearGradient id='ph_ai_grad' x1='0%' y1='0%' x2='100%' y2='100%'>
                                            <stop offset='0%' stopColor='#10b981' />
                                            <stop offset='100%' stopColor='#059669' />
                                        </linearGradient>
                                    </defs>
                                    <rect
                                        x='2'
                                        y='4'
                                        width='20'
                                        height='16'
                                        rx='4'
                                        fill='url(#ph_ai_grad)'
                                        stroke='#34d399'
                                        strokeWidth='1'
                                    />
                                    <text
                                        x='12'
                                        y='15.5'
                                        textAnchor='middle'
                                        fill='#ffffff'
                                        fontSize='10'
                                        fontWeight='bold'
                                        fontFamily='sans-serif'
                                    >
                                        AI
                                    </text>
                                </svg>
                            </span>
                        }
                    />
                    <ToolbarIcon
                        popover_message={localize('Entry Scanner')}
                        icon={
                            <span
                                className={classNames('toolbar__icon', {
                                    'toolbar__icon--active': entry_scanner.is_scanner_open,
                                })}
                                id='db-toolbar__entry-scanner-button'
                                onClick={() => {
                                    entry_scanner.is_scanner_open = !entry_scanner.is_scanner_open;
                                }}
                            >
                                <svg
                                    width='22'
                                    height='22'
                                    viewBox='0 0 24 24'
                                    fill='none'
                                    style={{
                                        verticalAlign: 'middle',
                                        filter: entry_scanner.is_scanner_open
                                            ? 'drop-shadow(0 0 5px #0ea5e9)'
                                            : 'drop-shadow(0 0 4px rgba(14,165,233,0.3))',
                                    }}
                                >
                                    <path
                                        d='M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242'
                                        stroke='#0ea5e9'
                                        strokeWidth='2'
                                        strokeLinecap='round'
                                    />
                                    <path d='M12 12v9' stroke='#0ea5e9' strokeWidth='2' strokeLinecap='round' />
                                    <path
                                        d='m8 17 4 4 4-4'
                                        stroke='#0ea5e9'
                                        strokeWidth='2'
                                        strokeLinecap='round'
                                        strokeLinejoin='round'
                                    />
                                </svg>
                            </span>
                        }
                    />
                </>
                <div className='vertical-divider' />
                <ToolbarIcon
                    popover_message={localize('Undo')}
                    icon={
                        <span
                            className={classNames('toolbar__icon undo', {
                                'toolbar__icon--disabled': !has_undo_stack,
                            })}
                            id='db-toolbar__undo-button'
                            data-testid='dt_toolbar_undo_button'
                            onClick={() => onUndoClick(/* redo */ false)}
                        >
                            <LabelPairedArrowRotateLeftMdRegularIcon />
                        </span>
                    }
                />
                <ToolbarIcon
                    popover_message={localize('Redo')}
                    icon={
                        <span
                            className={classNames('toolbar__icon redo', {
                                'toolbar__icon--disabled': !has_redo_stack,
                            })}
                            id='db-toolbar__redo-button'
                            data-testid='dt_toolbar_redo_button'
                            onClick={() => onUndoClick(/* redo */ true)}
                        >
                            <LabelPairedArrowRotateRightMdRegularIcon />
                        </span>
                    }
                />
                <div className='vertical-divider' />
                <ToolbarIcon
                    popover_message={localize('Zoom in')}
                    icon={
                        <span
                            className='toolbar__icon'
                            id='db-toolbar__zoom-in-button'
                            data-testid='dt_toolbar_zoom_in_button'
                            onClick={() => onZoomInOutClick(/* in */ true)}
                        >
                            <LabelPairedMagnifyingGlassPlusMdRegularIcon />
                        </span>
                    }
                />
                <ToolbarIcon
                    popover_message={localize('Zoom out')}
                    icon={
                        <span
                            className='toolbar__icon'
                            id='db-toolbar__zoom-out'
                            data-testid='dt_toolbar_zoom_out_button'
                            onClick={() => onZoomInOutClick(/* in */ false)}
                        >
                            <LabelPairedMagnifyingGlassMinusMdRegularIcon />
                        </span>
                    }
                />
            </div>
        </div>
    );
});

export default WorkspaceGroup;

