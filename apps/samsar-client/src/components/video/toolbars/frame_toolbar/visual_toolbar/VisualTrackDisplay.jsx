import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import ReactSlider from 'react-slider';
import { FaGripLines } from 'react-icons/fa6';
import { useColorMode } from '../../../../../contexts/ColorMode.jsx';
import { frameToViewportValue, viewportValueToFrame } from '../../../util/viewportGeometry.js';

function getTrackPalette(visualTrackItem, isDisplaySelected, colorMode) {
  const isShape = visualTrackItem?.type === 'shape';

  if (colorMode === 'light') {
    return {
      active: isDisplaySelected
        ? (isShape ? '#fef3c7' : '#dbeafe')
        : (isShape ? '#fef3c7' : '#e2e8f0'),
      border: isDisplaySelected
        ? (isShape ? 'rgba(217, 119, 6, 0.68)' : 'rgba(14, 165, 233, 0.62)')
        : (isShape ? 'rgba(217, 119, 6, 0.45)' : 'rgba(148, 163, 184, 0.82)'),
      bottomEdge: isDisplaySelected
        ? (isShape ? 'bg-amber-600/85' : 'bg-sky-600/80')
        : (isShape ? 'bg-amber-500/70' : 'bg-slate-500/70'),
    };
  }

  return {
    active: isDisplaySelected
      ? (isShape ? '#3a2a12' : '#123046')
      : (isShape ? '#2b2118' : '#182234'),
    border: isDisplaySelected
      ? (isShape ? 'rgba(251, 191, 36, 0.62)' : 'rgba(103, 232, 249, 0.58)')
      : (isShape ? 'rgba(217, 119, 6, 0.52)' : 'rgba(100, 116, 139, 0.72)'),
    bottomEdge: isDisplaySelected
      ? (isShape ? 'bg-amber-300/80' : 'bg-cyan-200/80')
      : (isShape ? 'bg-amber-400/65' : 'bg-[#6b7d95]'),
  };
}

function clampTrackRange(rawValue, parentLayerStartFrame, parentLayerEndFrame) {
  const startBoundary = Math.max(0, Math.round(parentLayerStartFrame));
  const endBoundary = Math.max(startBoundary + 1, Math.round(parentLayerEndFrame));

  const nextStart = Math.min(
    Math.max(Math.round(rawValue[0]), startBoundary),
    endBoundary - 1,
  );
  const nextEnd = Math.max(
    Math.min(Math.round(rawValue[1]), endBoundary),
    nextStart + 1,
  );

  return [nextStart, nextEnd];
}

const VISUAL_TRACK_THUMB_HEIGHT = 10;

function addStyleValueOffset(styleValue, offsetPixels) {
  if (typeof styleValue === 'number') {
    return styleValue + offsetPixels;
  }

  if (typeof styleValue === 'string' && styleValue.length > 0) {
    return `calc(${styleValue} + ${offsetPixels}px)`;
  }

  return offsetPixels;
}

export default function VisualTrackDisplay(props) {
  const {
    visualTrackItem,
    onUpdate,
    onCommit,
    selectedFrameRange,
    setVisualTrackDisplayAsSelected,
    isDisplaySelected,
    isStartVisible,
    isEndVisible,
    parentLayerStartFrame,
    parentLayerEndFrame,
    viewportGeometry = null,
  } = props;

  const { colorMode } = useColorMode();
  const [visibleStartFrame, visibleEndFrame] = selectedFrameRange;
  const hasViewportGeometry = Array.isArray(viewportGeometry?.segments) && viewportGeometry.segments.length > 0;
  const min = hasViewportGeometry ? 0 : visibleStartFrame;
  const max = hasViewportGeometry
    ? Math.max(1, Math.round(Number(viewportGeometry?.totalPixels) || 1))
    : visibleEndFrame;
  const frameToSliderValue = useCallback((value) => (
    hasViewportGeometry
      ? frameToViewportValue(value, viewportGeometry)
      : Number(value) || 0
  ), [hasViewportGeometry, viewportGeometry]);
  const sliderValueToFrame = useCallback((value) => (
    hasViewportGeometry
      ? viewportValueToFrame(value, viewportGeometry)
      : Number(value) || 0
  ), [hasViewportGeometry, viewportGeometry]);
  const sliderContainerRef = useRef(null);
  const dragStartYRef = useRef(0);
  const dragBaselineRef = useRef(null);
  const [isDraggingBody, setIsDraggingBody] = useState(false);

  const visibleSliderValues = useMemo(() => {
    const clampedStart = Math.max(min, Math.min(max, frameToSliderValue(visualTrackItem.startFrame)));
    const clampedEnd = Math.max(
      clampedStart + 1,
      Math.min(max, frameToSliderValue(visualTrackItem.endFrame)),
    );

    return [clampedStart, clampedEnd];
  }, [
    frameToSliderValue,
    max,
    min,
    visualTrackItem.endFrame,
    visualTrackItem.startFrame,
  ]);

  const [sliderValues, setSliderValues] = useState(visibleSliderValues);

  useEffect(() => {
    setSliderValues(visibleSliderValues);
  }, [visibleSliderValues]);

  const palette = useMemo(
    () => getTrackPalette(visualTrackItem, isDisplaySelected, colorMode),
    [colorMode, isDisplaySelected, visualTrackItem]
  );
  const railSurfaceClassName = colorMode === 'dark'
    ? 'bg-[#0b1220] border border-[#273449]'
    : 'bg-slate-100 border border-slate-300';
  const selectedRingClassName = isDisplaySelected
    ? 'timeline-layer-range-shell--selected'
    : '';

  const selectTrack = (event) => {
    if (event && typeof event.stopPropagation === 'function') {
      event.stopPropagation();
    }
    if (setVisualTrackDisplayAsSelected) {
      setVisualTrackDisplayAsSelected(visualTrackItem.trackKey);
    }
  };

  useEffect(() => {
    if (!isDraggingBody || !dragBaselineRef.current) {
      return undefined;
    }

    const handleMouseMove = (event) => {
      if (!sliderContainerRef.current || !dragBaselineRef.current) {
        return;
      }

      const sliderHeight = sliderContainerRef.current.clientHeight || 0;
      if (sliderHeight <= 0) {
        return;
      }

      const deltaY = event.clientY - dragStartYRef.current;
      const visibleFrameRange = Math.max(1, max - min);
      const valueDelta = (deltaY / sliderHeight) * visibleFrameRange;

      const baselineStart = dragBaselineRef.current.startValue;
      const baselineEnd = dragBaselineRef.current.endValue;
      const baselineLength = baselineEnd - baselineStart;
      const parentStartValue = frameToSliderValue(parentLayerStartFrame);
      const parentEndValue = frameToSliderValue(parentLayerEndFrame);

      let shiftedStart = baselineStart + valueDelta;
      let shiftedEnd = baselineEnd + valueDelta;

      if (shiftedStart < parentStartValue) {
        shiftedStart = parentStartValue;
        shiftedEnd = shiftedStart + baselineLength;
      }
      if (shiftedEnd > parentEndValue) {
        shiftedEnd = parentEndValue;
        shiftedStart = shiftedEnd - baselineLength;
      }

      const [absoluteStart, absoluteEnd] = clampTrackRange(
        [sliderValueToFrame(shiftedStart), sliderValueToFrame(shiftedEnd)],
        parentLayerStartFrame,
        parentLayerEndFrame,
      );

      dragBaselineRef.current.currentStartFrame = absoluteStart;
      dragBaselineRef.current.currentEndFrame = absoluteEnd;

      setSliderValues([
        Math.max(min, Math.min(max, frameToSliderValue(absoluteStart))),
        Math.max(min, Math.min(max, frameToSliderValue(absoluteEnd))),
      ]);

      if (onUpdate) {
        onUpdate(visualTrackItem.trackKey, absoluteStart, absoluteEnd);
      }
    };

    const handleMouseUp = () => {
      const baseline = dragBaselineRef.current;
      setIsDraggingBody(false);
      dragBaselineRef.current = null;

      if (baseline && onCommit) {
        onCommit(
          visualTrackItem.trackKey,
          baseline.currentStartFrame,
          baseline.currentEndFrame,
        );
      }
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [
    isDraggingBody,
    max,
    min,
    onCommit,
    onUpdate,
    parentLayerEndFrame,
    parentLayerStartFrame,
    frameToSliderValue,
    sliderValueToFrame,
    visualTrackItem.trackKey,
  ]);

  const handleChange = (value) => {
    const [absoluteStart, absoluteEnd] = clampTrackRange(
      [sliderValueToFrame(value[0]), sliderValueToFrame(value[1])],
      parentLayerStartFrame,
      parentLayerEndFrame,
    );

    setSliderValues([
      Math.max(min, Math.min(max, frameToSliderValue(absoluteStart))),
      Math.max(min, Math.min(max, frameToSliderValue(absoluteEnd))),
    ]);

    if (onUpdate) {
      onUpdate(visualTrackItem.trackKey, absoluteStart, absoluteEnd);
    }
  };

  const handleAfterChange = (value) => {
    const [absoluteStart, absoluteEnd] = clampTrackRange(
      [sliderValueToFrame(value[0]), sliderValueToFrame(value[1])],
      parentLayerStartFrame,
      parentLayerEndFrame,
    );

    if (onCommit) {
      onCommit(visualTrackItem.trackKey, absoluteStart, absoluteEnd);
    }
  };

  const handleTrackMouseDown = (event) => {
    if (event.button !== 0) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    selectTrack();

    dragStartYRef.current = event.clientY;
    dragBaselineRef.current = {
      startValue: frameToSliderValue(visualTrackItem.startFrame),
      endValue: frameToSliderValue(visualTrackItem.endFrame),
      currentStartFrame: visualTrackItem.startFrame,
      currentEndFrame: visualTrackItem.endFrame,
    };
    setIsDraggingBody(true);
  };

  const renderTrack = (trackProps, state) => {
    const { key, className, style, ...restTrackProps } = trackProps;
    const isActiveTrack = state.index === 1;

    return (
      <div
        key={key}
        {...restTrackProps}
        className={`track rounded-full ${isActiveTrack ? 'timeline-layer-range-bar' : ''} ${className ?? ''}`}
        style={{
          ...style,
          bottom: isActiveTrack
            ? addStyleValueOffset(style?.bottom, VISUAL_TRACK_THUMB_HEIGHT)
            : style?.bottom,
          backgroundColor: isActiveTrack ? palette.active : 'transparent',
          border: isActiveTrack ? `1px solid ${palette.border}` : 'none',
          width: isActiveTrack ? '16px' : '4px',
          left: '50%',
          transform: 'translateX(-50%)',
          cursor: isActiveTrack ? 'grab' : 'default',
          overflow: 'hidden',
        }}
        onClick={selectTrack}
        onMouseDown={isActiveTrack ? handleTrackMouseDown : undefined}
        title={`${visualTrackItem.assetLabel} · ${visualTrackItem.id}`}
      >
        {isActiveTrack ? (
          <>
            <div className={`pointer-events-none absolute inset-x-0 top-0 h-px ${colorMode === 'dark' ? 'bg-white/12' : 'bg-white/80'}`} />
            <div className={`pointer-events-none absolute inset-x-0 bottom-0 h-px ${palette.bottomEdge}`} />
          </>
        ) : null}
      </div>
    );
  };

  return (
    <div
      ref={sliderContainerRef}
      className={`timeline-layer-range-shell ${selectedRingClassName}`}
    >
      <div className={`timeline-layer-range-surface ${railSurfaceClassName}`}>
        <ReactSlider
          className="w-full relative"
          orientation="vertical"
          min={min}
          max={max}
          value={sliderValues}
          onChange={handleChange}
          onAfterChange={handleAfterChange}
          onBeforeChange={() => selectTrack()}
          pearling
          style={{ height: `calc(100% + ${VISUAL_TRACK_THUMB_HEIGHT}px)` }}
          renderTrack={renderTrack}
          renderThumb={(thumbProps, state) => {
            const { index } = state;
            const shouldRenderThumb =
              (index === 0 && isStartVisible) || (index === 1 && isEndVisible);

            if (!shouldRenderThumb) {
              return null;
            }

            const { key, className, style, ...restThumbProps } = thumbProps;

            return (
              <div
                key={key}
                {...restThumbProps}
                className={`timeline-layer-trim-handle flex items-center justify-center rounded-full border shadow w-[18px] h-[10px] ${
                  colorMode === 'dark'
                    ? 'bg-white border-white/40 text-slate-800'
                    : 'bg-slate-100 border-slate-300 text-slate-700'
                } ${className ?? ''}`}
                style={{
                  ...style,
                  left: '50%',
                  transform: 'translate(-50%, -50%)',
                }}
                onMouseDown={(event) => {
                  selectTrack(event);
                  if (typeof restThumbProps.onMouseDown === 'function') {
                    restThumbProps.onMouseDown(event);
                  }
                }}
                title={`${visualTrackItem.assetLabel} · ${visualTrackItem.id}`}
              >
                <FaGripLines />
              </div>
            );
          }}
        />
      </div>
    </div>
  );
}
