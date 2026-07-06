import { useState, useEffect, useRef, useCallback } from 'react';
import ReactSlider from 'react-slider';
import { FaGripLines } from 'react-icons/fa6';
import './audioTrack/audioTrackSlider.css';
import AudioLevelsTrackSlider from './AudioLevelsTrackSlider';
import AudioTrackWaveformOverlay from './AudioTrackWaveformOverlay.jsx';
import { useColorMode } from '../../../contexts/ColorMode.jsx';
import { frameToViewportValue, viewportValueToFrame } from './viewportGeometry.js';
import { getAudioTrackFrameBounds } from './audioTrackTiming.js';

const DISPLAY_FRAMES_PER_SECOND = 30;
const PROCESSOR_API_URL = import.meta.env.VITE_PROCESSOR_API;
const AUDIO_TRACK_THUMB_HEIGHT = 10;

function addStyleValueOffset(styleValue, offsetPixels) {
  if (typeof styleValue === 'number') {
    return styleValue + offsetPixels;
  }

  if (typeof styleValue === 'string' && styleValue.length > 0) {
    return `calc(${styleValue} + ${offsetPixels}px)`;
  }

  return offsetPixels;
}

function resolveAudioTrackUrl(audioTrack = {}) {
  const candidate = (
    (typeof audioTrack?.url === 'string' && audioTrack.url.trim() && audioTrack.url.trim())
    || (typeof audioTrack?.audioUrl === 'string' && audioTrack.audioUrl.trim() && audioTrack.audioUrl.trim())
    || (typeof audioTrack?.selectedLocalAudioLink === 'string' && audioTrack.selectedLocalAudioLink.trim() && audioTrack.selectedLocalAudioLink.trim())
    || (Array.isArray(audioTrack?.localAudioLinks) && audioTrack.localAudioLinks.find((link) => typeof link === 'string' && link.trim()))
    || (typeof audioTrack?.selectedRemoteAudioLink === 'string' && audioTrack.selectedRemoteAudioLink.trim() && audioTrack.selectedRemoteAudioLink.trim())
    || (Array.isArray(audioTrack?.remoteAudioLinks) && audioTrack.remoteAudioLinks.find((link) => typeof link === 'string' && link.trim()))
    || ''
  );

  if (!candidate) {
    return null;
  }

  if (/^https?:\/\//i.test(candidate)) {
    return candidate;
  }

  const normalizedPath = candidate.replace(/^\/+/, '');
  return PROCESSOR_API_URL
    ? `${PROCESSOR_API_URL}/${normalizedPath}`
    : `/${normalizedPath}`;
}

const AudioTrackSlider = (props) => {
  const { audioTrack, onUpdate, selectedFrameRange, isStartVisible, isEndVisible,
    setAudioRangeSliderDisplayAsSelected, 
    viewportGeometry = null,
    showWaveformOverlay = false,
    visualizationMode = 'waveform',
    manualVolumeAdjustmentEnabled = false,
    volumeAutomationPoints = [],
    selectedVolumePointId = null,
    onSelectVolumePoint,
    onCreateVolumePoint,
   } = props;

  const audioTrackId = audioTrack._id;
  const { colorMode } = useColorMode();
  const [visibleStartFrame, visibleEndFrame] = selectedFrameRange;
  const hasViewportGeometry = Array.isArray(viewportGeometry?.segments) && viewportGeometry.segments.length > 0;
  const min = hasViewportGeometry ? 0 : visibleStartFrame;
  const max = hasViewportGeometry
    ? Math.max(1, Math.round(Number(viewportGeometry?.totalPixels) || 1))
    : visibleEndFrame;
  const sliderValueToFrame = useCallback((value) => (
    hasViewportGeometry
      ? viewportValueToFrame(value, viewportGeometry)
      : Number(value) || 0
  ), [hasViewportGeometry, viewportGeometry]);
  const frameToSliderValue = useCallback((value) => (
    hasViewportGeometry
      ? frameToViewportValue(value, viewportGeometry)
      : Number(value) || 0
  ), [hasViewportGeometry, viewportGeometry]);

  const [, setAudioDuration] = useState(0);
  const [sliderValues, setSliderValues] = useState([0, 0]);
  const [isDraggingRange, setIsDraggingRange] = useState(false);
  const [dragStartY, setDragStartY] = useState(0);
  const [sliderHeight, setSliderHeight] = useState(0);

  const trackRef = useRef(null);
  const sliderContainerRef = useRef(null);
  const resolvedAudioUrl = resolveAudioTrackUrl(audioTrack);
  const resolvedTrackStartTime = Number.isFinite(Number(audioTrack?.startTime)) ? Number(audioTrack.startTime) : 0;
  const resolvedTrackDuration = Number.isFinite(Number(audioTrack?.duration)) ? Math.max(0, Number(audioTrack.duration)) : 0;
  const resolvedSourceTrimStartTime = Number.isFinite(Number(audioTrack?.sourceTrimStartTime))
    ? Math.max(0, Number(audioTrack.sourceTrimStartTime))
    : 0;
  const sliderRange = Math.max(1, max - min);
  const visibleTrackStartPercent = Math.max(0, Math.min(100, ((sliderValues[0] - min) / sliderRange) * 100));
  const visibleTrackEndPercent = Math.max(visibleTrackStartPercent, Math.min(100, ((sliderValues[1] - min) / sliderRange) * 100));
  const visibleTrackInsetStyle = {
    top: `${visibleTrackStartPercent}%`,
    bottom: `${Math.max(0, 100 - visibleTrackEndPercent)}%`,
  };
  const visibleTrackStartFrame = sliderValueToFrame(sliderValues[0]);
  const visibleTrackEndFrame = sliderValueToFrame(sliderValues[1]);
  const visibleLayerStartSeconds = Math.max(0, (visibleTrackStartFrame / DISPLAY_FRAMES_PER_SECOND) - resolvedTrackStartTime);
  const visibleLayerDurationSeconds = Math.max(0, (visibleTrackEndFrame - visibleTrackStartFrame) / DISPLAY_FRAMES_PER_SECOND);
  const sourceWindowStartSeconds = resolvedSourceTrimStartTime + visibleLayerStartSeconds;
  const volumeScaleMax = Math.max(
    100,
    Number(audioTrack?.volume) || 0,
    ...volumeAutomationPoints.map((point) => Number(point?.volume) || 0),
  );
  const canShowWaveformOverlay = Boolean(showWaveformOverlay && resolvedAudioUrl && visibleLayerDurationSeconds > 0.0001);
  const railSurfaceClassName = colorMode === 'dark'
    ? 'bg-[#0b1220] border border-[#273449]'
    : 'bg-slate-100 border border-slate-300';
  const waveformSurfaceClassName = colorMode === 'dark'
    ? (audioTrack.isDisplaySelected
      ? 'border-cyan-500/30 bg-[#081524]'
      : 'border-[#1d2d43] bg-[#08111d]')
    : (audioTrack.isDisplaySelected
      ? 'border-sky-200 bg-[#f7fbff]'
      : 'border-slate-200 bg-white/95');
  const activeTrackStyle = {
    backgroundColor: audioTrack.isDisplaySelected
      ? (colorMode === 'dark' ? '#123046' : '#dbeafe')
      : (colorMode === 'dark' ? '#182234' : '#e2e8f0'),
    border: `1px solid ${audioTrack.isDisplaySelected
      ? (colorMode === 'dark' ? 'rgba(103,232,249,0.55)' : 'rgba(14,165,233,0.6)')
      : (colorMode === 'dark' ? 'rgba(100,116,139,0.7)' : 'rgba(148,163,184,0.8)')}`,
    boxShadow: audioTrack.isDisplaySelected
      ? (colorMode === 'dark'
        ? '0 0 0 1px rgba(103,232,249,0.24), 0 0 14px rgba(34,211,238,0.18)'
        : '0 0 0 1px rgba(14,165,233,0.18), 0 0 12px rgba(14,165,233,0.16)')
      : 'none',
    cursor: 'grab',
  };


  useEffect(() => {
    if (!resolvedAudioUrl) {
      setAudioDuration(0);
      return undefined;
    }

    const audio = new Audio(resolvedAudioUrl);

    const handleLoadedMetadata = () => {
      setAudioDuration(audio.duration);
    };

    audio.addEventListener('loadedmetadata', handleLoadedMetadata);

    return () => {
      audio.removeEventListener('loadedmetadata', handleLoadedMetadata);
      audio.src = '';
    };
  }, [resolvedAudioUrl]);

  useEffect(() => {
    const { startFrame: resolvedStartFrame, endFrame: resolvedEndFrame } =
      getAudioTrackFrameBounds(audioTrack, DISPLAY_FRAMES_PER_SECOND);
    const startValue = Math.max(min, Math.min(max, frameToSliderValue(resolvedStartFrame)));
    const endValue = Math.max(
      startValue,
      Math.max(min, Math.min(max, frameToSliderValue(resolvedEndFrame))),
    );

    setSliderValues([startValue, endValue]);
  }, [audioTrack.startTime, audioTrack.endTime, audioTrack.duration, frameToSliderValue, max, min]);


  const handleChange = (value) => {
    if (!isDraggingRange) {
      const [prevStartFrame, prevEndFrame] = sliderValues;
      const [newStartFrame, newEndFrame] = value;
  
      const trackId = audioTrack._id || audioTrack.id;
      const previousStartTime = sliderValueToFrame(prevStartFrame) / DISPLAY_FRAMES_PER_SECOND;
      const previousEndTime = sliderValueToFrame(prevEndFrame) / DISPLAY_FRAMES_PER_SECOND;
      const nextStartTime = sliderValueToFrame(newStartFrame) / DISPLAY_FRAMES_PER_SECOND;
      const nextEndTime = sliderValueToFrame(newEndFrame) / DISPLAY_FRAMES_PER_SECOND;
  
      if (newStartFrame !== prevStartFrame && newEndFrame === prevEndFrame) {
        // Start thumb moved
        const newStartTime = nextStartTime;
        const newEndTime = previousEndTime;
        const newDuration = newEndTime - newStartTime;
        onUpdate(trackId, newStartTime, newEndTime, newDuration);
      } else if (newEndFrame !== prevEndFrame && newStartFrame === prevStartFrame) {
        // End thumb moved
        const newStartTime = previousStartTime;
        const newEndTime = nextEndTime;
        const newDuration = newEndTime - newStartTime;
        onUpdate(trackId, newStartTime, newEndTime, newDuration);
      } else if (newStartFrame !== prevStartFrame && newEndFrame !== prevEndFrame) {
        // Both thumbs moved
        const newStartTime = nextStartTime;
        const newEndTime = nextEndTime;
        const newDuration = newEndTime - newStartTime;
        onUpdate(trackId, newStartTime, newEndTime, newDuration);
      }
  
      setSliderValues(value);
    }
  };
  

  const handleRangeMouseDown = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (sliderContainerRef.current) {
      setSliderHeight(sliderContainerRef.current.clientHeight);
    } else {
      
      return;
    }
    setIsDraggingRange(true);
    setDragStartY(e.clientY);
  };

  useEffect(() => {
    if (!isDraggingRange) return;

    const handleMouseMove = (e) => {
      const deltaY = e.clientY - dragStartY;

      if (sliderHeight === 0) return;

      const sliderRange = max - min;
      const deltaValue = (deltaY / sliderHeight) * sliderRange;

      setSliderValues(([start, end]) => {
        let newStart = start + deltaValue;
        let newEnd = end + deltaValue;

        // Clamp values within min and max
        newStart = Math.max(min, Math.min(max - (end - start), newStart));
        newEnd = newStart + (end - start);

        setDragStartY(e.clientY);

        const newStartFrame = sliderValueToFrame(newStart);
        const newEndFrame = sliderValueToFrame(newEnd);
        const newStartTime = newStartFrame / DISPLAY_FRAMES_PER_SECOND;
        const newEndTime = newEndFrame / DISPLAY_FRAMES_PER_SECOND;
        const newDuration = newEndTime - newStartTime;
        const trackId = audioTrack._id || audioTrack.id;
        onUpdate(trackId, newStartTime, newEndTime, newDuration);

        return [newStart, newEnd];
      });
    };

    const handleMouseUp = () => {
      setIsDraggingRange(false);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [
    isDraggingRange,
    dragStartY,
    sliderHeight,
    min,
    max,
    onUpdate,
    audioTrack._id,
    audioTrack.id,
  ]);

  const audioRangeSliderClicked = () => {
    setAudioRangeSliderDisplayAsSelected(audioTrackId);
  }

  const renderTrack = (props, state) => {
    if (state.index === 1) {
      const { key, className, style, ...trackProps } = props;
      return (
        <div
          key={key}
          {...trackProps}
          ref={trackRef}
          onMouseDown={handleRangeMouseDown}

          onClick={(e) => {
            // Your custom click handling logic
            audioRangeSliderClicked(e);
            // Optionally stop propagation if needed
             e.stopPropagation();
          }}

          className={`track rounded-full timeline-layer-range-bar audio_range_track-${audioTrackId} ${className ?? ''}`}
          style={{
            ...style,
            bottom: addStyleValueOffset(style?.bottom, AUDIO_TRACK_THUMB_HEIGHT),
            ...activeTrackStyle,
            position: 'relative',
            overflow: 'hidden',
            width: '16px',
            left: '50%',
            transform: 'translateX(-50%)',
          }}
        >
          <div className={`pointer-events-none absolute inset-x-0 top-0 h-px ${colorMode === 'dark' ? 'bg-white/12' : 'bg-white/80'}`} />
          <div
            className={`pointer-events-none absolute inset-x-0 bottom-0 h-px ${
              audioTrack.isDisplaySelected
                ? (colorMode === 'dark' ? 'bg-cyan-200/80' : 'bg-sky-600/80')
                : (colorMode === 'dark' ? 'bg-[#6b7d95]' : 'bg-slate-500/70')
            }`}
          />
        </div>
      );
    } else {
      const { key, style, ...trackProps } = props;
      return (
        <div
          key={key}
          {...trackProps}
          className={`track rounded-full audio_range_track-${audioTrackId}`}
          style={{
            ...style,
            backgroundColor: 'transparent',
            width: '4px',
            left: '50%',
            transform: 'translateX(-50%)',
          }}
        />
      );
    }
  };
  return (
<>
    <div
      className={`relative mr-2 inline-flex h-full min-h-0 items-stretch gap-2 ${canShowWaveformOverlay ? 'w-[126px] min-w-[126px]' : 'w-[42px] min-w-[42px]'}`}
    >
      <div
        ref={sliderContainerRef}
        className={`timeline-layer-range-shell ${audioTrack.isDisplaySelected ? 'timeline-layer-range-shell--selected' : ''}`}
      >
        <div className={`timeline-layer-range-surface ${railSurfaceClassName}`}>
          <ReactSlider
            className="vertical-slider w-full relative"
            orientation="vertical"
            min={min}
            max={max}
            value={sliderValues}
            onChange={handleChange}
            onClick={audioRangeSliderClicked}
            pearling
            style={{ height: `calc(100% + ${AUDIO_TRACK_THUMB_HEIGHT}px)` }}
            renderThumb={(props, state) => {
              const { index } = state;
              const shouldRenderThumb =
                (index === 0 && isStartVisible) || (index === 1 && isEndVisible);

              if (shouldRenderThumb) {
                const { key, className, style, ...thumbProps } = props;
                return (
                  <div
                    key={key}
                    {...thumbProps}
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
                  >
                    <FaGripLines />
                  </div>
                );
              }

              return null;
            }}
            renderTrack={renderTrack}
          />
        </div>
      </div>

      {canShowWaveformOverlay ? (
        <div className="relative h-full min-h-0 flex-1">
          <div
            className={`absolute inset-x-0 overflow-hidden rounded-[20px] border ${waveformSurfaceClassName}`}
            style={visibleTrackInsetStyle}
          >
            <AudioTrackWaveformOverlay
              audioUrl={resolvedAudioUrl}
              visualizationMode={visualizationMode}
              manualVolumeAdjustmentEnabled={manualVolumeAdjustmentEnabled}
              volumeAutomationPoints={volumeAutomationPoints}
              selectedVolumePointId={selectedVolumePointId}
              onSelectVolumePoint={onSelectVolumePoint}
              onCreateVolumePoint={onCreateVolumePoint}
              onActivate={() => setAudioRangeSliderDisplayAsSelected(audioTrackId)}
              trackDurationSeconds={resolvedTrackDuration}
              visibleLayerStartSeconds={visibleLayerStartSeconds}
              visibleLayerDurationSeconds={visibleLayerDurationSeconds}
              sourceWindowStartSeconds={sourceWindowStartSeconds}
              sourceWindowDurationSeconds={visibleLayerDurationSeconds}
              volumeScaleMax={volumeScaleMax}
              isSelected={Boolean(audioTrack.isDisplaySelected)}
            />
          </div>
        </div>
      ) : null}
    </div>


{audioTrack.isAudioLevelsDisplaySelected && (
  <AudioLevelsTrackSlider />
)}
</>

  );
};

export default AudioTrackSlider;
