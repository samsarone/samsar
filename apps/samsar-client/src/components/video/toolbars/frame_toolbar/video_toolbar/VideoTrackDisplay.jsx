import { useMemo } from 'react';
import ReactSlider from 'react-slider';
import { useColorMode } from '../../../../../contexts/ColorMode.jsx';

function clampPercent(value) {
  return Math.max(0, Math.min(100, value));
}

function getOperationPalette(operation, colorMode) {
  const isSpeedOperation = operation?.type === 'SPEED';

  if (colorMode === 'light') {
    return isSpeedOperation
      ? {
        fill: operation?.status === 'pending' ? 'rgba(59, 130, 246, 0.22)' : 'rgba(14, 165, 233, 0.24)',
        border: operation?.status === 'pending' ? 'rgba(37, 99, 235, 0.5)' : 'rgba(2, 132, 199, 0.52)',
      }
      : {
        fill: operation?.status === 'pending' ? 'rgba(244, 63, 94, 0.2)' : 'rgba(248, 113, 113, 0.2)',
        border: operation?.status === 'pending' ? 'rgba(225, 29, 72, 0.48)' : 'rgba(239, 68, 68, 0.45)',
      };
  }

  return isSpeedOperation
    ? {
      fill: operation?.status === 'pending' ? 'rgba(37, 99, 235, 0.28)' : 'rgba(6, 182, 212, 0.28)',
      border: operation?.status === 'pending' ? 'rgba(96, 165, 250, 0.52)' : 'rgba(103, 232, 249, 0.52)',
    }
    : {
      fill: operation?.status === 'pending' ? 'rgba(225, 29, 72, 0.28)' : 'rgba(244, 63, 94, 0.28)',
      border: operation?.status === 'pending' ? 'rgba(253, 164, 175, 0.52)' : 'rgba(251, 113, 133, 0.52)',
    };
}

function clampSelectionRange(range, durationFrames) {
  const safeDurationFrames = Math.max(1, Math.round(durationFrames) || 1);
  const rawStart = Array.isArray(range) ? Math.round(Number(range[0]) || 0) : 0;
  const rawEnd = Array.isArray(range) ? Math.round(Number(range[1]) || 0) : safeDurationFrames;
  const nextStart = Math.min(Math.max(rawStart, 0), safeDurationFrames - 1);
  const nextEnd = Math.max(nextStart + 1, Math.min(rawEnd, safeDurationFrames));
  return [nextStart, nextEnd];
}

function clampSelectionRangeToWindow(range, minimumFrame, maximumFrame) {
  const safeMinimumFrame = Math.max(0, Math.round(Number(minimumFrame) || 0));
  const safeMaximumFrame = Math.max(
    safeMinimumFrame + 1,
    Math.round(Number(maximumFrame) || safeMinimumFrame + 1),
  );
  const [normalizedStartFrame, normalizedEndFrame] = clampSelectionRange(range, safeMaximumFrame);
  const nextStartFrame = Math.min(
    Math.max(normalizedStartFrame, safeMinimumFrame),
    safeMaximumFrame - 1,
  );
  const nextEndFrame = Math.max(
    nextStartFrame + 1,
    Math.min(normalizedEndFrame, safeMaximumFrame),
  );

  return [nextStartFrame, nextEndFrame];
}

const VIDEO_DIAMOND_THUMB_SIZE = 16;


export default function VideoTrackDisplay(props) {
  const {
    videoTrackItem,
    selectedFrameRange,
    visibleLayerLayout = null,
    isDisplaySelected = false,
    showSelectionHandles = false,
    setVideoTrackDisplayAsSelected,
    operationDisplayList = [],
    selectedLocalRangeFrames,
    onSelectionChange,
    onSelectionCommit,
    isBusy = false,
  } = props;
  const { colorMode } = useColorMode();
  const [visibleStartFrame, visibleEndFrame] = selectedFrameRange;
  const visibleFrameRange = Math.max(1, visibleEndFrame - visibleStartFrame);
  const visibleTrackStartFrame = Math.max(videoTrackItem.startFrame, visibleStartFrame);
  const visibleTrackEndFrame = Math.max(
    visibleTrackStartFrame + 1,
    Math.min(videoTrackItem.endFrame, visibleEndFrame),
  );
  const visibleTrackDurationFrames = Math.max(1, visibleTrackEndFrame - visibleTrackStartFrame);
  const visibleLocalStartFrame = Math.max(0, visibleTrackStartFrame - videoTrackItem.startFrame);
  const visibleLocalEndFrame = Math.max(
    visibleLocalStartFrame + 1,
    Math.min(videoTrackItem.durationFrames, visibleTrackEndFrame - videoTrackItem.startFrame),
  );
  const hasExplicitLayerLayout = Number.isFinite(visibleLayerLayout?.top)
    && Number.isFinite(visibleLayerLayout?.height)
    && Number(visibleLayerLayout.height) > 0;

  const trackTopPercent = clampPercent(
    ((videoTrackItem.startFrame - visibleStartFrame) / visibleFrameRange) * 100
  );
  const trackBottomPercent = clampPercent(
    ((videoTrackItem.endFrame - visibleStartFrame) / visibleFrameRange) * 100
  );
  const trackHeightPercent = Math.max(1, trackBottomPercent - trackTopPercent);
  const normalizedSelectionRange = clampSelectionRange(
    selectedLocalRangeFrames,
    videoTrackItem.durationFrames,
  );
  const visibleSelectionRange = clampSelectionRangeToWindow(
    normalizedSelectionRange,
    visibleLocalStartFrame,
    visibleLocalEndFrame,
  );
  const visibleSelectionWindowFrames = Math.max(1, visibleLocalEndFrame - visibleLocalStartFrame);
  const selectionTopPercent = clampPercent(
    ((visibleSelectionRange[0] - visibleLocalStartFrame) / visibleSelectionWindowFrames) * 100
  );
  const selectionBottomPercent = clampPercent(
    ((visibleSelectionRange[1] - visibleLocalStartFrame) / visibleSelectionWindowFrames) * 100
  );
  const selectionHeightPercent = Math.max(0, selectionBottomPercent - selectionTopPercent);
  const trackStyle = hasExplicitLayerLayout
    ? {
      top: `${visibleLayerLayout.top}px`,
      height: `${Math.max(1, visibleLayerLayout.height)}px`,
    }
    : {
      top: `${trackTopPercent}%`,
      height: `${trackHeightPercent}%`,
    };
  const selectionOverlayStyle = hasExplicitLayerLayout
    ? {
      top: `${visibleLayerLayout.top}px`,
      height: `${Math.max(1, visibleLayerLayout.height) + VIDEO_DIAMOND_THUMB_SIZE}px`,
    }
    : {
      top: `${trackTopPercent}%`,
      height: `calc(${trackHeightPercent}% + ${VIDEO_DIAMOND_THUMB_SIZE}px)`,
    };

  const visibleOperations = useMemo(() => (
    operationDisplayList.filter((operation) => (
      operation?.endFrame >= visibleStartFrame && operation?.startFrame <= visibleEndFrame
    ))
  ), [operationDisplayList, visibleEndFrame, visibleStartFrame]);

  const railSurface = colorMode === 'dark'
    ? 'bg-[#0b1220] border border-[#273449]'
    : 'bg-slate-100 border border-slate-300';
  const inactiveTrackSurface = colorMode === 'dark'
    ? 'bg-[#182234] border border-[#46556b]'
    : 'bg-slate-200 border border-slate-400/90';
  const activeTrackSurface = colorMode === 'dark'
    ? 'bg-[#123046] border border-cyan-300/60'
    : 'bg-sky-100 border border-sky-500/70';
  const labelClassName = colorMode === 'dark' ? 'text-slate-300' : 'text-slate-500';
  const selectedRing = isDisplaySelected
    ? 'timeline-layer-range-shell--selected'
    : '';

  const handleSelect = (event) => {
    event.stopPropagation();
    setVideoTrackDisplayAsSelected?.(videoTrackItem.layerId);
  };

  return (
    <button
      type="button"
      className={`timeline-layer-range-shell border-0 bg-transparent transition ${selectedRing}`}
      onClick={handleSelect}
      title={`${videoTrackItem.assetLabel} on layer ${videoTrackItem.layerIndex + 1}`}
    >
      <div className={`timeline-layer-range-surface ${railSurface}`}>
        <div
          className={`timeline-layer-range-bar absolute left-1/2 w-[16px] -translate-x-1/2 overflow-hidden rounded-[18px] ${isDisplaySelected ? activeTrackSurface : inactiveTrackSurface}`}
          style={trackStyle}
        >
          <div
            className={`pointer-events-none absolute inset-x-0 top-0 h-px ${
              colorMode === 'dark' ? 'bg-white/12' : 'bg-white/80'
            }`}
          />
          <div
            className={`pointer-events-none absolute inset-x-0 bottom-0 h-px ${
              isDisplaySelected
                ? (colorMode === 'dark' ? 'bg-cyan-200/80' : 'bg-sky-600/80')
                : (colorMode === 'dark' ? 'bg-[#6b7d95]' : 'bg-slate-500/70')
            }`}
          />
        </div>

        {isDisplaySelected && showSelectionHandles && (
          <div
            className="absolute left-1/2 z-[5] w-[24px] -translate-x-1/2"
            style={selectionOverlayStyle}
          >
            <div
              className="pointer-events-none absolute inset-x-0"
              style={{
                top: '0',
                bottom: `${VIDEO_DIAMOND_THUMB_SIZE}px`,
              }}
            >
              <div
                className="video-diamond-selection-rail"
                style={{
                  top: `${selectionTopPercent}%`,
                  height: `${selectionHeightPercent}%`,
                  minHeight: '2px',
                }}
              />
            </div>
            <ReactSlider
              min={visibleLocalStartFrame}
              max={Math.max(visibleLocalStartFrame + 1, visibleLocalEndFrame)}
              value={visibleSelectionRange}
              minDistance={1}
              pearling
              orientation="vertical"
              withTracks={false}
              className="video-diamond-slider"
              thumbClassName="video-diamond-thumb"
              onChange={onSelectionChange}
              onAfterChange={onSelectionCommit}
              disabled={isBusy}
            />
          </div>
        )}

        {visibleOperations.map((operation) => {
          const operationPalette = getOperationPalette(operation, colorMode);
          const clippedOperationStartFrame = Math.max(operation.startFrame, visibleTrackStartFrame);
          const clippedOperationEndFrame = Math.max(
            clippedOperationStartFrame + 1,
            Math.min(operation.endFrame, visibleTrackEndFrame),
          );
          const operationStyle = hasExplicitLayerLayout
            ? {
              top: `${visibleLayerLayout.top + (
                ((clippedOperationStartFrame - visibleTrackStartFrame) / visibleTrackDurationFrames)
                * visibleLayerLayout.height
              )}px`,
              height: `${Math.max(
                1,
                ((clippedOperationEndFrame - clippedOperationStartFrame) / visibleTrackDurationFrames)
                * visibleLayerLayout.height,
              )}px`,
            }
            : (() => {
              const operationTopPercent = clampPercent(
                ((operation.startFrame - visibleStartFrame) / visibleFrameRange) * 100
              );
              const operationBottomPercent = clampPercent(
                ((operation.endFrame - visibleStartFrame) / visibleFrameRange) * 100
              );
              const operationHeightPercent = Math.max(1, operationBottomPercent - operationTopPercent);

              return {
                top: `${operationTopPercent}%`,
                height: `${operationHeightPercent}%`,
              };
            })();

          return (
            <div
              key={operation.id}
              className="pointer-events-none absolute left-1/2 z-[3] w-[24px] -translate-x-1/2"
              style={operationStyle}
            >
              <div
                className="absolute left-1/2 top-0 h-[10px] w-[10px] -translate-x-1/2 -translate-y-1/2 rotate-45 rounded-[2px]"
                style={{
                  background: operationPalette.fill,
                  border: `1px solid ${operationPalette.border}`,
                }}
              />
              <div
                className="absolute left-1/2 top-0 h-full w-[10px] -translate-x-1/2 rounded-full"
                style={{
                  background: operationPalette.fill,
                  borderLeft: `1px solid ${operationPalette.border}`,
                  borderRight: `1px solid ${operationPalette.border}`,
                }}
              />
              <div
                className="absolute left-1/2 bottom-0 h-[10px] w-[10px] -translate-x-1/2 translate-y-1/2 rotate-45 rounded-[2px]"
                style={{
                  background: operationPalette.fill,
                  border: `1px solid ${operationPalette.border}`,
                }}
              />
            </div>
          );
        })}

        <div className="pointer-events-none absolute left-1/2 top-2 z-[4] -translate-x-1/2">
          <div className={`rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.16em] ${labelClassName}`}>
            {videoTrackItem.shortLabel}
          </div>
        </div>

        {videoTrackItem.videoEditPending && (
          <div className="pointer-events-none absolute bottom-2 left-1/2 z-[4] h-2 w-2 -translate-x-1/2 rounded-full bg-cyan-400 shadow-[0_0_12px_rgba(34,211,238,0.65)]" />
        )}
      </div>
    </button>
  );
}
