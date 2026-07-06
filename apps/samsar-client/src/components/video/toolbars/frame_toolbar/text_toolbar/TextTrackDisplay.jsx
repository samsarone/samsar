import { useState, useEffect, useRef, useCallback } from 'react';
import ReactSlider from 'react-slider';
import { FaGripLines } from 'react-icons/fa6';
import './textTrackDisplay.css';
import TextAnimationTrackDisplay from './TextAnimationTrackDisplay.jsx';
import { frameToViewportValue, viewportValueToFrame } from '../../../util/viewportGeometry.js';
import { useColorMode } from '../../../../../contexts/ColorMode.jsx';

const TEXT_TRACK_THUMB_HEIGHT = 10;

function addStyleValueOffset(styleValue, offsetPixels) {
  if (typeof styleValue === 'number') {
    return styleValue + offsetPixels;
  }

  if (typeof styleValue === 'string' && styleValue.length > 0) {
    return `calc(${styleValue} + ${offsetPixels}px)`;
  }

  return offsetPixels;
}

const TextTrackDisplay = (props) => {
  const {
    textItemLayer,
    onUpdate,
    selectedFrameRange,
    setTextTrackDisplayAsSelected,
    showTextTrackAnimations,
    onAnimationSelect,
    isDisplaySelected,
    updateTrackAnimationBoundariesForTextLayer,
    parentLayerStartFrame,
    parentLayerEndFrame,
    viewportGeometry = null,
  } = props;

  const [, setTextItemInState] = useState(textItemLayer);
  const [selectedAnimationInTextTrack, setSelectedAnimationInTextTrack] = useState(null);
  const { colorMode } = useColorMode();

  useEffect(() => {
    setTextItemInState(textItemLayer);
  }, [textItemLayer]);

  const textItemId = textItemLayer.id;
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

  const [sliderValues, setSliderValues] = useState([
    frameToSliderValue(textItemLayer.startFrame),
    frameToSliderValue(textItemLayer.endFrame),
  ]);

  useEffect(() => {
    setSliderValues([
      frameToSliderValue(textItemLayer.startFrame),
      frameToSliderValue(textItemLayer.endFrame),
    ]);
  }, [frameToSliderValue, textItemLayer.endFrame, textItemLayer.startFrame]);

  const trackRef = useRef(null);

  const handleChange = (value) => {
    let [newStartFrame, newEndFrame] = [
      sliderValueToFrame(value[0]),
      sliderValueToFrame(value[1]),
    ];
    newStartFrame = Math.max(parentLayerStartFrame, newStartFrame);
    newEndFrame = Math.min(parentLayerEndFrame, newEndFrame);

    const nextStartValue = Math.max(min, Math.min(max, frameToSliderValue(newStartFrame)));
    const nextEndValue = Math.max(
      nextStartValue,
      Math.min(max, frameToSliderValue(newEndFrame)),
    );

    setSliderValues([nextStartValue, nextEndValue]);
    const newStartTime = newStartFrame / 30;
    const newEndTime = newEndFrame / 30;

    if (onUpdate) {
      onUpdate(newStartTime, newEndTime);
    }
  };

  const textTrackClicked = (e) => {
    e.stopPropagation();
    // Select this text track
    if (setTextTrackDisplayAsSelected) {
      setTextTrackDisplayAsSelected(textItemLayer);
    }
    // Clear any selected animation since user clicked on main text track
    if (onAnimationSelect) {
      onAnimationSelect(null, textItemLayer);
    }
  };

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
  };

  const renderTrack = (props, state) => {
    const { key, className, style, ...trackProps } = props;
    const isActiveTrack = state.index === 1;
    return (
      <div
        key={key}
        {...trackProps}
        ref={trackRef}
        style={{
          ...style,
          bottom: isActiveTrack
            ? addStyleValueOffset(style?.bottom, TEXT_TRACK_THUMB_HEIGHT)
            : style?.bottom,
          ...(isActiveTrack ? activeTrackStyle : {}),
          width: isActiveTrack ? '16px' : '4px',
          left: '50%',
          transform: 'translateX(-50%)',
          overflow: 'hidden',
          backgroundColor: isActiveTrack ? activeTrackStyle.backgroundColor : 'transparent',
        }}
        onMouseDown={(e) => {
          if (!isActiveTrack) {
            return;
          }
          e.preventDefault();
          e.stopPropagation();
        }}
        onClick={textTrackClicked}
        className={`track rounded-full text_track-${textItemId} ${isActiveTrack ? 'timeline-layer-range-bar' : ''} ${className ?? ''}`}
      >
        {isActiveTrack ? (
          <>
            <div className={`pointer-events-none absolute inset-x-0 top-0 h-px ${colorMode === 'dark' ? 'bg-white/12' : 'bg-white/80'}`} />
            <div
              className={`pointer-events-none absolute inset-x-0 bottom-0 h-px ${
                isDisplaySelected
                  ? (colorMode === 'dark' ? 'bg-cyan-200/80' : 'bg-sky-600/80')
                  : (colorMode === 'dark' ? 'bg-[#6b7d95]' : 'bg-slate-500/70')
              }`}
            />
          </>
        ) : null}
      </div>
    );
  };

  let animationSliders = null;
  if (showTextTrackAnimations && textItemLayer && textItemLayer.animations) {
    animationSliders = textItemLayer.animations.map((animation) => (
      <TextAnimationTrackDisplay
        key={`index_${animation.id}`}
        selectedFrameRange={selectedFrameRange}
        viewportGeometry={viewportGeometry}
        textItemLayer={textItemLayer}
        {...props}
        selectedAnimationInTextTrack={selectedAnimationInTextTrack}
        selectedAnimation={animation}
        updateTrackAnimationBoundaries={(start, end) => {
          updateTrackAnimationBoundariesForTextLayer(animation, start, end);
        }}
        onAnimationSelect={(animation) => {
          // When an animation is clicked, select it
          setSelectedAnimationInTextTrack(animation);
          if (onAnimationSelect) {
            onAnimationSelect(animation, textItemLayer);
          }
        }}
      />
    ));
  }

  return (
    <span className='text-track-slider-component'>
      <div
        className={`timeline-layer-range-shell ${selectedRingClassName}`}
      >
        <div className={`timeline-layer-range-surface ${railSurfaceClassName}`}>
          <ReactSlider
            className='vertical-slider w-full relative'
            orientation='vertical'
            min={min}
            max={max}
            value={sliderValues}
            onChange={handleChange}
            pearling
            style={{ height: `calc(100% + ${TEXT_TRACK_THUMB_HEIGHT}px)` }}
            renderTrack={renderTrack}
            onBeforeChange={() => {
              if (setTextTrackDisplayAsSelected) {
                setTextTrackDisplayAsSelected(textItemLayer);
              }
              if (onAnimationSelect) {
                onAnimationSelect(null);
              }
            }}
            renderThumb={(props) => {
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
            }}
          />
        </div>
      </div>
      {animationSliders}
    </span>
  );
};

export default TextTrackDisplay;
