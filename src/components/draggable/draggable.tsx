import React, { useEffect, useRef, useState } from 'react';
import {
    calculateHeight,
    calculateWidth,
    calculateZindex,
    DRAGGABLE_CONSTANTS,
    EXTRA_BOTTOM_RIGHT_SAFETY_MARGIN,
    SAFETY_MARGIN,
    TDraggableProps,
} from './draggable-utils';
import './draggable.scss';

const Draggable: React.FC<TDraggableProps> = ({
    children,
    boundary,
    initialValues = {
        width: 400,
        height: 400,
        xAxis: 0,
        yAxis: 0,
    },
    minWidth = 100,
    minHeight = 100,
    enableResizing = false,
    enableDragging = true,
    header = '',
    onClose,
}) => {
    const [position, setPosition] = useState({ x: initialValues.xAxis, y: initialValues.yAxis });
    const [size, setSize] = useState({ width: initialValues.width, height: initialValues.height });
    const [zIndex, setZIndex] = useState(100);
    const [zoomScale, setZoomScale] = useState(1);
    const [isMinimized, setIsMinimized] = useState(false);
    const [isMaximized, setIsMaximized] = useState(false);

    const savedGeometryRef = useRef<{
        x: number;
        y: number;
        width: number;
        height: number;
    }>({
        x: initialValues.xAxis,
        y: initialValues.yAxis,
        width: initialValues.width,
        height: initialValues.height,
    });

    const isResizing = useRef(false);
    const [isDragging, setIsDragging] = useState(false);
    const draggableRef = useRef<HTMLDivElement>(null);
    const [boundaryRef, setBoundaryRef] = useState<HTMLElement | null>(null);

    useEffect(() => {
        if (!isMaximized && !isMinimized) {
            setSize({ width: initialValues.width, height: initialValues.height });
            setPosition({ x: initialValues.xAxis, y: initialValues.yAxis });
            savedGeometryRef.current = {
                x: initialValues.xAxis,
                y: initialValues.yAxis,
                width: initialValues.width,
                height: initialValues.height,
            };
        }
    }, [initialValues.height, initialValues.width, initialValues.xAxis, initialValues.yAxis]);

    useEffect(() => {
        const boundaryEl = document.querySelector(boundary ?? DRAGGABLE_CONSTANTS.BODY_REF) as HTMLElement | null;
        setBoundaryRef(boundaryEl);
        calculateZindex({ setZIndex });
    }, [boundary]);

    const handleZoomIn = (e: React.MouseEvent) => {
        e.stopPropagation();
        setZoomScale(prev => Math.min(2.0, Number((prev + 0.15).toFixed(2))));
    };

    const handleZoomOut = (e: React.MouseEvent) => {
        e.stopPropagation();
        setZoomScale(prev => Math.max(0.5, Number((prev - 0.15).toFixed(2))));
    };

    const handleZoomReset = (e: React.MouseEvent) => {
        e.stopPropagation();
        setZoomScale(1.0);
    };

    const handleMinimizeToggle = (e: React.MouseEvent) => {
        e.stopPropagation();
        if (isMinimized) {
            setIsMinimized(false);
            if (!isMaximized) {
                setSize({ width: savedGeometryRef.current.width, height: savedGeometryRef.current.height });
                setPosition({ x: savedGeometryRef.current.x, y: savedGeometryRef.current.y });
            }
        } else {
            if (!isMaximized) {
                savedGeometryRef.current = {
                    x: position.x,
                    y: position.y,
                    width: size.width,
                    height: size.height,
                };
            }
            setIsMinimized(true);
        }
    };

    const handleMaximizeToggle = (e: React.MouseEvent) => {
        e.stopPropagation();
        if (isMaximized) {
            // Restore to previous normal state
            setIsMaximized(false);
            setIsMinimized(false);
            setPosition({ x: savedGeometryRef.current.x, y: savedGeometryRef.current.y });
            setSize({ width: savedGeometryRef.current.width, height: savedGeometryRef.current.height });
        } else {
            // Save current geometry first
            if (!isMinimized) {
                savedGeometryRef.current = {
                    x: position.x,
                    y: position.y,
                    width: size.width,
                    height: size.height,
                };
            }
            setIsMinimized(false);
            setIsMaximized(true);

            const boundaryRect = boundaryRef?.getBoundingClientRect();
            const topOffset = boundaryRef?.offsetTop ?? 0;
            const leftOffset = boundaryRef?.offsetLeft ?? 0;

            const maxWidth = boundaryRect ? Math.max(minWidth, boundaryRect.width - (SAFETY_MARGIN * 2)) : window.innerWidth - 16;
            const maxHeight = boundaryRect ? Math.max(minHeight, boundaryRect.height - (SAFETY_MARGIN * 2)) : window.innerHeight - 80;

            setPosition({ x: leftOffset + SAFETY_MARGIN, y: topOffset + SAFETY_MARGIN });
            setSize({ width: maxWidth, height: maxHeight });
        }
    };

    useEffect(() => {
        if (!isMaximized) return;

        const handleWindowResize = () => {
            const boundaryRect = boundaryRef?.getBoundingClientRect();
            const topOffset = boundaryRef?.offsetTop ?? 0;
            const leftOffset = boundaryRef?.offsetLeft ?? 0;

            const maxWidth = boundaryRect ? Math.max(minWidth, boundaryRect.width - (SAFETY_MARGIN * 2)) : window.innerWidth - 16;
            const maxHeight = boundaryRect ? Math.max(minHeight, boundaryRect.height - (SAFETY_MARGIN * 2)) : window.innerHeight - 80;

            setPosition({ x: leftOffset + SAFETY_MARGIN, y: topOffset + SAFETY_MARGIN });
            setSize({ width: maxWidth, height: maxHeight });
        };

        window.addEventListener('resize', handleWindowResize);
        return () => window.removeEventListener('resize', handleWindowResize);
    }, [isMaximized, boundaryRef, minWidth, minHeight]);

    const handleClose = (e: React.MouseEvent) => {
        e.stopPropagation();
        onClose?.();
    };

    const handleMouseDown = (
        event: React.MouseEvent<HTMLElement, MouseEvent> | React.TouchEvent<HTMLElement> | null,
        action: string
    ) => {
        event?.stopPropagation();
        calculateZindex({ setZIndex });
        if (!action) return;

        // If maximized, disable resizing and dragging
        if (isMaximized) return;

        const resize_direction = action;
        isResizing.current = action !== DRAGGABLE_CONSTANTS.MOVE && enableResizing && !isMinimized;
        setIsDragging(action === DRAGGABLE_CONSTANTS.MOVE && enableDragging);

        const boundaryRect = boundaryRef?.getBoundingClientRect();
        const topOffset = boundaryRef?.offsetTop ?? 0;
        const leftOffset = boundaryRef?.offsetLeft ?? 0;

        let initialMouseX = 0;
        let initialMouseY = 0;

        if (event) {
            if ('touches' in event && event.touches.length > 0) {
                initialMouseX = event.touches[0].clientX;
                initialMouseY = event.touches[0].clientY;
            } else if ('clientX' in event) {
                initialMouseX = (event as React.MouseEvent).clientX;
                initialMouseY = (event as React.MouseEvent).clientY;
            }
        }

        const initialWidth = size?.width ?? initialValues.width;
        const initialHeight = size?.height ?? initialValues.height;
        const initialX = position?.x ?? 0;
        const initialY = position?.y ?? 0;
        const initialSelfRight = draggableRef.current?.getBoundingClientRect()?.right ?? size.width;
        const initialSelfBottom = draggableRef.current?.getBoundingClientRect()?.bottom ?? size.height;

        let previousStyle = {};
        const draggableContentBody = draggableRef.current?.querySelector(
            '#draggable-content-body'
        ) as HTMLElement | null;

        if (draggableContentBody) {
            const { style } = draggableContentBody;
            if (style && style.pointerEvents !== 'none') {
                previousStyle = { ...style };
                style.pointerEvents = 'none';
            }
        }

        const handleMouseMove = (e: MouseEvent | TouchEvent) => {
            if (!e) return;
            let clientX = 0;
            let clientY = 0;
            if ('touches' in e && e.touches.length > 0) {
                clientX = e.touches[0].clientX;
                clientY = e.touches[0].clientY;
            } else if ('clientX' in e) {
                clientX = (e as MouseEvent).clientX;
                clientY = (e as MouseEvent).clientY;
            } else {
                return;
            }

            const deltaX = clientX - initialMouseX;
            const deltaY = clientY - initialMouseY;
            try {
                if (isResizing.current) {
                    handleResize(deltaX, deltaY, clientX, clientY);
                } else {
                    handleDrag(deltaX, deltaY);
                }
            } catch (error) {
                handleMouseUp();
            }
        };

        const handleResize = (deltaX: number, deltaY: number, clientX: number, clientY: number) => {
            if (isMinimized) return;

            let newX = position?.x ?? 0;
            let newY = position?.y ?? 0;
            let newWidth = initialWidth;
            let newHeight = initialHeight;

            if (resize_direction.includes(DRAGGABLE_CONSTANTS.RIGHT)) {
                newWidth += deltaX;
            } else if (resize_direction.includes(DRAGGABLE_CONSTANTS.LEFT)) {
                newX = deltaX + initialX;
                newWidth -= deltaX;
            }

            if (resize_direction.includes(DRAGGABLE_CONSTANTS.BOTTOM)) {
                newHeight += deltaY;
            } else if (resize_direction.includes(DRAGGABLE_CONSTANTS.TOP)) {
                newY = deltaY + initialY;
                newHeight -= deltaY;
            }

            setPosition(prev => {
                const maxY = Math.max(newY, topOffset + SAFETY_MARGIN);
                const maxX = Math.max(newX, leftOffset + SAFETY_MARGIN);
                return { x: newWidth <= minWidth ? prev.x : maxX, y: newHeight <= minHeight ? prev.y : maxY };
            });

            const self = draggableRef.current?.getBoundingClientRect();

            setSize(prev => {
                const updatedWidth = calculateWidth({
                    prevWidth: prev.width,
                    leftOffset,
                    boundaryRect,
                    initialSelfRight,
                    resize_direction,
                    newWidth,
                    minWidth,
                    clientX,
                    self,
                });
                const updatedHeight = calculateHeight({
                    prevHeight: prev.height,
                    topOffset,
                    boundaryRect,
                    initialSelfBottom,
                    resize_direction,
                    newHeight,
                    minHeight,
                    clientY,
                    self,
                });

                savedGeometryRef.current.width = updatedWidth;
                savedGeometryRef.current.height = updatedHeight;

                return {
                    width: updatedWidth,
                    height: updatedHeight,
                };
            });
        };

        const handleDrag = (deltaX: number, deltaY: number) => {
            const newX = deltaX + initialX;
            const newY = deltaY + initialY;
            const currentH = isMinimized ? 44 : size.height;
            const boundedX = Math.min(
                Math.max(newX, leftOffset + SAFETY_MARGIN),
                leftOffset +
                    (boundaryRect?.width ?? window.innerWidth) -
                    size.width -
                    (SAFETY_MARGIN + EXTRA_BOTTOM_RIGHT_SAFETY_MARGIN * 2)
            );
            const boundedY = Math.min(
                Math.max(newY, topOffset + SAFETY_MARGIN),
                topOffset +
                    (boundaryRect?.height ?? window.innerHeight) -
                    currentH -
                    (SAFETY_MARGIN + EXTRA_BOTTOM_RIGHT_SAFETY_MARGIN * 2)
            );
            setPosition({ x: boundedX, y: boundedY });
            if (!isMinimized && !isMaximized) {
                savedGeometryRef.current.x = boundedX;
                savedGeometryRef.current.y = boundedY;
            }
        };

        const handleMouseUp = () => {
            setIsDragging(false);
            isResizing.current = false;
            if (draggableContentBody?.style) {
                try {
                    Object.assign(draggableContentBody.style, previousStyle);
                } catch {
                    draggableContentBody.style.pointerEvents = 'unset';
                }
            }
            window.removeEventListener('mousemove', handleMouseMove as any);
            window.removeEventListener('mouseup', handleMouseUp);
            window.removeEventListener('touchmove', handleMouseMove as any);
            window.removeEventListener('touchend', handleMouseUp);
            window.removeEventListener('touchcancel', handleMouseUp);
        };

        window.addEventListener('mousemove', handleMouseMove as any);
        window.addEventListener('mouseup', handleMouseUp);
        window.addEventListener('touchmove', handleMouseMove as any, { passive: true });
        window.addEventListener('touchend', handleMouseUp);
        window.addEventListener('touchcancel', handleMouseUp);
    };

    return (
        <div
            className={`draggable ${isDragging ? 'dragging' : ''} ${isMinimized ? 'draggable--minimized' : ''} ${isMaximized ? 'draggable--maximized' : ''}`}
            style={{
                position: 'absolute',
                top: position.y,
                left: position.x,
                zIndex,
                transform: zoomScale !== 1 && !isMinimized && !isMaximized ? `scale(${zoomScale})` : undefined,
                transformOrigin: 'top left',
            }}
            onMouseDown={() => calculateZindex({ setZIndex })}
            onTouchStart={() => calculateZindex({ setZIndex })}
            onKeyDown={() => calculateZindex({ setZIndex })}
            data-testid='dt_react_draggable'
            tabIndex={0}
        >
            <div
                ref={draggableRef}
                className={`draggable-content ${isMinimized ? 'draggable-content--minimized' : ''}`}
                data-testid='dt_react_draggable_content'
                style={{
                    width: size.width,
                    height: isMinimized ? 'auto' : size.height,
                }}
            >
                <div
                    id='draggable-content__header'
                    data-testid='dt_react_draggable_handler'
                    className='draggable-content__header'
                    onMouseDown={e => handleMouseDown(e, DRAGGABLE_CONSTANTS.MOVE)}
                    onTouchStart={e => handleMouseDown(e, DRAGGABLE_CONSTANTS.MOVE)}
                    onKeyDown={(e: React.KeyboardEvent<HTMLElement>) =>
                        e.key === 'Enter' && handleMouseDown(null, DRAGGABLE_CONSTANTS.MOVE)
                    }
                    tabIndex={0}
                >
                    <div className='draggable-content__header__title' title={typeof header === 'string' ? header : undefined}>
                        {header}
                    </div>

                    <div className='draggable-header-actions'>
                        {/* Zoom Controls (visible when expanded) */}
                        {!isMinimized && (
                            <div className='draggable-zoom-controls'>
                                <button
                                    type='button'
                                    className='draggable-zoom-btn'
                                    onClick={handleZoomOut}
                                    title='Zoom Out'
                                    aria-label='Zoom Out'
                                >
                                    🔍-
                                </button>
                                <button
                                    type='button'
                                    className='draggable-zoom-btn'
                                    onClick={handleZoomReset}
                                    title='Reset Zoom'
                                    aria-label='Reset Zoom'
                                >
                                    {Math.round(zoomScale * 100)}%
                                </button>
                                <button
                                    type='button'
                                    className='draggable-zoom-btn'
                                    onClick={handleZoomIn}
                                    title='Zoom In'
                                    aria-label='Zoom In'
                                >
                                    🔍+
                                </button>
                            </div>
                        )}

                        {/* Window Management Controls: Minimize, Maximize / Restore, Close */}
                        <div className='draggable-window-controls'>
                            <button
                                type='button'
                                className={`draggable-window-btn draggable-window-btn--minimize ${isMinimized ? 'active' : ''}`}
                                onClick={handleMinimizeToggle}
                                title={isMinimized ? 'Restore' : 'Minimize'}
                                aria-label={isMinimized ? 'Restore window' : 'Minimize window'}
                            >
                                <svg width='12' height='12' viewBox='0 0 12 12' fill='currentColor'>
                                    {isMinimized ? (
                                        <path d='M2 9h8V7H2v2zm0-4h8V3H2v2z' fill='currentColor' />
                                    ) : (
                                        <path d='M2 6h8v2H2z' fill='currentColor' />
                                    )}
                                </svg>
                            </button>

                            <button
                                type='button'
                                className={`draggable-window-btn draggable-window-btn--maximize ${isMaximized ? 'active' : ''}`}
                                onClick={handleMaximizeToggle}
                                title={isMaximized ? 'Restore' : 'Maximize'}
                                aria-label={isMaximized ? 'Restore window size' : 'Maximize window'}
                            >
                                <svg width='12' height='12' viewBox='0 0 12 12' fill='none' stroke='currentColor' strokeWidth='1.5'>
                                    {isMaximized ? (
                                        <>
                                            <rect x='3.5' y='1.5' width='7' height='7' rx='1' fill='none' />
                                            <path d='M1.5 4.5v6a1 1 0 001 1h6' fill='none' />
                                        </>
                                    ) : (
                                        <rect x='2' y='2' width='8' height='8' rx='1.2' fill='none' />
                                    )}
                                </svg>
                            </button>

                            <button
                                type='button'
                                className='draggable-window-btn draggable-window-btn--close'
                                onClick={handleClose}
                                title='Close'
                                aria-label='Close window'
                                data-testid='dt_react_draggable-close-modal'
                            >
                                <svg width='12' height='12' viewBox='0 0 12 12' fill='none' stroke='currentColor' strokeWidth='1.75' strokeLinecap='round'>
                                    <line x1='2.5' y1='2.5' x2='9.5' y2='9.5' />
                                    <line x1='9.5' y1='2.5' x2='2.5' y2='9.5' />
                                </svg>
                            </button>
                        </div>
                    </div>
                </div>

                <div
                    className='draggable-content__body'
                    id='draggable-content-body'
                    style={{
                        display: isMinimized ? 'none' : 'block',
                        height: isMinimized ? 0 : 'calc(100% - 44px)',
                        overflow: 'hidden',
                    }}
                >
                    {children}
                </div>

                {enableResizing && !isMinimized && !isMaximized && (
                    <>
                        <div
                            className='resizable-handle__top'
                            data-testid='dt_resizable-handle__top'
                            onMouseDown={e => handleMouseDown(e, DRAGGABLE_CONSTANTS.TOP)}
                            onTouchStart={e => handleMouseDown(e, DRAGGABLE_CONSTANTS.TOP)}
                            tabIndex={0}
                        />
                        <div
                            className='resizable-handle__right'
                            data-testid='dt_resizable-handle__right'
                            onMouseDown={e => handleMouseDown(e, DRAGGABLE_CONSTANTS.RIGHT)}
                            onTouchStart={e => handleMouseDown(e, DRAGGABLE_CONSTANTS.RIGHT)}
                            tabIndex={0}
                        />
                        <div
                            className='resizable-handle__bottom'
                            data-testid='dt_resizable-handle__bottom'
                            onMouseDown={e => handleMouseDown(e, DRAGGABLE_CONSTANTS.BOTTOM)}
                            onTouchStart={e => handleMouseDown(e, DRAGGABLE_CONSTANTS.BOTTOM)}
                            tabIndex={0}
                        />
                        <div
                            className='resizable-handle__left'
                            data-testid='dt_resizable-handle__left'
                            onMouseDown={e => handleMouseDown(e, DRAGGABLE_CONSTANTS.LEFT)}
                            onTouchStart={e => handleMouseDown(e, DRAGGABLE_CONSTANTS.LEFT)}
                            tabIndex={0}
                        />
                        <div
                            className='resizable-handle__top-right'
                            data-testid='dt_resizable-handle__top-right'
                            onMouseDown={e => handleMouseDown(e, DRAGGABLE_CONSTANTS.TOP_RIGHT)}
                            onTouchStart={e => handleMouseDown(e, DRAGGABLE_CONSTANTS.TOP_RIGHT)}
                            tabIndex={0}
                        />
                        <div
                            className='resizable-handle__bottom-right'
                            data-testid='dt_resizable-handle__bottom-right'
                            onMouseDown={e => handleMouseDown(e, DRAGGABLE_CONSTANTS.BOTTOM_RIGHT)}
                            onTouchStart={e => handleMouseDown(e, DRAGGABLE_CONSTANTS.BOTTOM_RIGHT)}
                            tabIndex={0}
                        />
                        <div
                            className='resizable-handle__bottom-left'
                            data-testid='dt_resizable-handle__bottom-left'
                            onMouseDown={e => handleMouseDown(e, DRAGGABLE_CONSTANTS.BOTTOM_LEFT)}
                            onTouchStart={e => handleMouseDown(e, DRAGGABLE_CONSTANTS.BOTTOM_LEFT)}
                            tabIndex={0}
                        />
                        <div
                            className='resizable-handle__top-left'
                            data-testid='dt_resizable-handle__top-left'
                            onMouseDown={e => handleMouseDown(e, DRAGGABLE_CONSTANTS.TOP_LEFT)}
                            onTouchStart={e => handleMouseDown(e, DRAGGABLE_CONSTANTS.TOP_LEFT)}
                            tabIndex={0}
                        />
                    </>
                )}
            </div>
        </div>
    );
};

export default Draggable;
