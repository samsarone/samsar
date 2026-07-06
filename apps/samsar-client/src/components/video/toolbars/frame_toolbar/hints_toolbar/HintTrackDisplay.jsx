import { useCallback, useMemo, useRef } from 'react';
import { FaGripLines } from 'react-icons/fa6';
import { useColorMode } from '../../../../../contexts/ColorMode.jsx';
import { frameToViewportValue, viewportValueToFrame } from '../../../util/viewportGeometry.js';

const DISPLAY_FRAMES_PER_SECOND = 30;
const MIN_HINT_FRAME_DISTANCE = 1;

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, Number(value) || 0));
}

function clampPercent(value) {
  return clamp(value, 0, 100);
}

export default function HintTrackDisplay({
  hint,
  selectedFrameRange,
  isStartVisible = true,
  isEndVisible = true,
  isDisplaySelected = false,
  onUpdate,
  setHintTrackDisplayAsSelected,
  viewportGeometry = null,
}) {
  const { colorMode } = useColorMode();
  const railRef = useRef(null);
  const hintId = hint?.id || hint?._id;
  const [visibleStartFrame, visibleEndFrame] = selectedFrameRange;
  const hasViewportGeometry = Array.isArray(viewportGeometry?.segments) && viewportGeometry.segments.length > 0;
  const minimumValue = hasViewportGeometry ? 0 : visibleStartFrame;
  const maximumValue = hasViewportGeometry
    ? Math.max(1, Math.round(Number(viewportGeometry?.totalPixels) || 1))
    : visibleEndFrame;
  const visibleValueRange = Math.max(1, maximumValue - minimumValue);
  const frameToDisplayValue = useCallback((frame) => (
    hasViewportGeometry
      ? frameToViewportValue(frame, viewportGeometry)
      : Number(frame) || 0
  ), [hasViewportGeometry, viewportGeometry]);
  const displayValueToFrame = useCallback((value) => (
    hasViewportGeometry
      ? viewportValueToFrame(value, viewportGeometry)
      : Number(value) || 0
  ), [hasViewportGeometry, viewportGeometry]);
  const startFrame = Math.max(0, Math.round(Number(hint?.startFrame) || 0));
  const endFrame = Math.max(startFrame + 1, Math.round(Number(hint?.endFrame) || startFrame + 1));
  const clippedStartValue = clamp(frameToDisplayValue(startFrame), minimumValue, maximumValue);
  const clippedEndValue = clamp(frameToDisplayValue(endFrame), clippedStartValue + 1, maximumValue);
  const trackTopPercent = clampPercent(
    ((clippedStartValue - minimumValue) / visibleValueRange) * 100,
  );
  const trackBottomPercent = clampPercent(
    ((clippedEndValue - minimumValue) / visibleValueRange) * 100,
  );
  const trackHeightPercent = Math.max(0.5, trackBottomPercent - trackTopPercent);
  const railSurfaceClassName = colorMode === 'dark'
    ? 'bg-[#0b1220] border border-[#273449]'
    : 'bg-slate-100 border border-slate-300';
  const selectedRingClassName = isDisplaySelected
    ? 'timeline-layer-range-shell--selected'
    : '';
  const activeTrackStyle = {
    backgroundColor: isDisplaySelected
      ? (colorMode === 'dark' ? '#123046' : '#dbeafe')
      : (colorMode === 'dark' ? '#182234' : '#e2e8f0'),
    border: `1px solid ${isDisplaySelected
      ? (colorMode === 'dark' ? 'rgba(103,232,249,0.55)' : 'rgba(14,165,233,0.6)')
      : (colorMode === 'dark' ? 'rgba(100,116,139,0.7)' : 'rgba(148,163,184,0.8)')}`,
    boxShadow: isDisplaySelected
      ? (colorMode === 'dark'
        ? '0 0 0 1px rgba(103,232,249,0.24), 0 0 14px rgba(34,211,238,0.18)'
        : '0 0 0 1px rgba(14,165,233,0.18), 0 0 12px rgba(14,165,233,0.16)')
      : 'none',
  };
  const bottomEdgeClassName = isDisplaySelected
    ? (colorMode === 'dark' ? 'bg-cyan-200/80' : 'bg-sky-600/80')
    : (colorMode === 'dark' ? 'bg-[#6b7d95]' : 'bg-slate-500/70');
  const thumbClassName = `timeline-layer-trim-handle absolute left-1/2 z-[5] flex h-[10px] w-[18px] items-center justify-center rounded-full border shadow ${
    colorMode === 'dark'
      ? 'border-white/40 bg-white text-slate-800'
      : 'border-slate-300 bg-slate-100 text-slate-700'
  }`;

  const selectHint = useCallback((event) => {
    event?.stopPropagation?.();
    setHintTrackDisplayAsSelected?.(hintId);
  }, [hintId, setHintTrackDisplayAsSelected]);

  const frameFromClientY = useCallback((clientY) => {
    const rect = railRef.current?.getBoundingClientRect?.();
    if (!rect || rect.height <= 0) {
      return visibleStartFrame;
    }

    const y = clamp(clientY - rect.top, 0, rect.height);
    return displayValueToFrame(minimumValue + ((y / rect.height) * visibleValueRange));
  }, [displayValueToFrame, minimumValue, visibleStartFrame, visibleValueRange]);

  const updateFrames = useCallback((nextStartFrame, nextEndFrame) => {
    const normalizedStartFrame = clamp(
      Math.round(nextStartFrame),
      visibleStartFrame,
      Math.max(visibleStartFrame, visibleEndFrame - MIN_HINT_FRAME_DISTANCE),
    );
    const normalizedEndFrame = clamp(
      Math.round(nextEndFrame),
      normalizedStartFrame + MIN_HINT_FRAME_DISTANCE,
      visibleEndFrame,
    );
    const nextStartTime = normalizedStartFrame / DISPLAY_FRAMES_PER_SECOND;
    const nextEndTime = normalizedEndFrame / DISPLAY_FRAMES_PER_SECOND;

    onUpdate?.(hintId, nextStartTime, nextEndTime, nextEndTime - nextStartTime);
  }, [hintId, onUpdate, visibleEndFrame, visibleStartFrame]);

  const beginDrag = useCallback((event, dragMode) => {
    if (event.button !== 0) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    selectHint(event);

    const baselineFrame = frameFromClientY(event.clientY);
    const baselineStartFrame = startFrame;
    const baselineEndFrame = endFrame;
    const baselineDurationFrames = Math.max(
      MIN_HINT_FRAME_DISTANCE,
      baselineEndFrame - baselineStartFrame,
    );

    const handleMouseMove = (moveEvent) => {
      const nextFrame = frameFromClientY(moveEvent.clientY);

      if (dragMode === 'start') {
        updateFrames(nextFrame, baselineEndFrame);
        return;
      }

      if (dragMode === 'end') {
        updateFrames(baselineStartFrame, nextFrame);
        return;
      }

      const deltaFrames = nextFrame - baselineFrame;
      const nextStartFrame = clamp(
        baselineStartFrame + deltaFrames,
        visibleStartFrame,
        visibleEndFrame - baselineDurationFrames,
      );
      updateFrames(nextStartFrame, nextStartFrame + baselineDurationFrames);
    };

    const handleMouseUp = () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }, [
    endFrame,
    frameFromClientY,
    selectHint,
    startFrame,
    updateFrames,
    visibleEndFrame,
    visibleStartFrame,
  ]);

  const hintTitle = useMemo(() => {
    const startTime = Number(hint?.startTime || 0).toFixed(1);
    const endTime = Number(hint?.endTime || 0).toFixed(1);
    return `${startTime}s - ${endTime}s${hint?.text ? ` · ${hint.text}` : ''}`;
  }, [hint?.endTime, hint?.startTime, hint?.text]);

  return (
    <div
      className={`timeline-layer-range-shell ${selectedRingClassName}`}
      onMouseDownCapture={() => setHintTrackDisplayAsSelected?.(hintId)}
      title={hintTitle}
    >
      <div
        ref={railRef}
        className={`timeline-layer-range-surface ${railSurfaceClassName}`}
      >
        <button
          type="button"
          className="timeline-layer-range-bar absolute left-1/2 w-[16px] cursor-grab overflow-hidden rounded-full p-0 outline-none active:cursor-grabbing"
          style={{
            ...activeTrackStyle,
            top: `${trackTopPercent}%`,
            height: `${trackHeightPercent}%`,
            minHeight: '4px',
            transform: 'translateX(-50%)',
          }}
          onMouseDown={(event) => beginDrag(event, 'move')}
          onClick={selectHint}
        >
          <div className={`pointer-events-none absolute inset-x-0 top-0 h-px ${colorMode === 'dark' ? 'bg-white/12' : 'bg-white/80'}`} />
          <div className={`pointer-events-none absolute inset-x-0 bottom-0 h-px ${bottomEdgeClassName}`} />
        </button>

        {isStartVisible ? (
          <button
            type="button"
            className={thumbClassName}
            style={{ top: `${trackTopPercent}%`, transform: 'translate(-50%, -50%)' }}
            onMouseDown={(event) => beginDrag(event, 'start')}
            onClick={selectHint}
          >
            <FaGripLines />
          </button>
        ) : null}

        {isEndVisible ? (
          <button
            type="button"
            className={thumbClassName}
            style={{ top: `${trackBottomPercent}%`, transform: 'translate(-50%, -50%)' }}
            onMouseDown={(event) => beginDrag(event, 'end')}
            onClick={selectHint}
          >
            <FaGripLines />
          </button>
        ) : null}
      </div>
    </div>
  );
}
