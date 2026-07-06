import { useState, useEffect, useCallback } from 'react';
import ReactSlider from 'react-slider';
import { FaDiamond } from 'react-icons/fa6';
import './textAnimationTrackDisplay.css';
import { frameToViewportValue, viewportValueToFrame } from '../../../util/viewportGeometry.js';
import { useColorMode } from '../../../../../contexts/ColorMode.jsx';

const TEXT_ANIMATION_THUMB_HEIGHT = 12;

function addStyleValueOffset(styleValue, offsetPixels) {
  if (typeof styleValue === 'number') {
    return styleValue + offsetPixels;
  }

  if (typeof styleValue === 'string' && styleValue.length > 0) {
    return `calc(${styleValue} + ${offsetPixels}px)`;
  }

  return offsetPixels;
}

export default function TextAnimationTrackDisplay(props) {
  const {
    selectedFrameRange,
    selectedAnimation,
    onAnimationSelect, 
    updateTrackAnimationBoundaries,
    selectedAnimationInTextTrack,
    viewportGeometry = null,
  } = props;

  const [visibleStartFrame, visibleEndFrame] = selectedFrameRange;
  const { colorMode } = useColorMode();
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
  const [sliderValues, setSliderValues] = useState([0, 0]);
  const [, setIsDragging] = useState(false);

  const isAnimationSelected = selectedAnimationInTextTrack === selectedAnimation;

  useEffect(() => {
    if (selectedAnimation) {
      setSliderValues([
        frameToSliderValue(selectedAnimation.startFrame),
        frameToSliderValue(selectedAnimation.endFrame),
      ]);
    }
  }, [frameToSliderValue, selectedAnimation]);

  const handleTrackMouseDown = (e) => {
    // Prevent track clicks from moving the slider
    e.preventDefault();
    e.stopPropagation();
  };

  const handleTrackClick = (e) => {
    e.stopPropagation();
    if (onAnimationSelect) {
      onAnimationSelect(selectedAnimation);
    }
  };

  const railSurfaceClassName = colorMode === 'dark'
    ? 'bg-[#0b1220] border border-[#273449]'
    : 'bg-slate-100 border border-slate-300';
  const selectedRingClassName = isAnimationSelected
    ? 'timeline-layer-range-shell--selected'
    : '';
  const activeTrackStyle = {
    backgroundColor: isAnimationSelected
      ? (colorMode === 'dark' ? '#20304a' : '#dbeafe')
      : (colorMode === 'dark' ? '#1a2436' : '#e2e8f0'),
    border: `1px solid ${isAnimationSelected
      ? (colorMode === 'dark' ? 'rgba(147,197,253,0.58)' : 'rgba(59,130,246,0.55)')
      : (colorMode === 'dark' ? 'rgba(100,116,139,0.68)' : 'rgba(148,163,184,0.76)')}`,
  };


  return (
    <div
      className={`timeline-layer-range-shell timeline-layer-range-shell--compact ${selectedRingClassName}`}
    >
      <div className={`timeline-layer-range-surface ${railSurfaceClassName}`}>
        <ReactSlider
          className="vertical-slider w-full relative"
          orientation="vertical"
          min={min}
          max={max}
          value={sliderValues}
          onChange={(value) => {
            setSliderValues(value);
          }}
          onBeforeChange={() => setIsDragging(true)}
          onAfterChange={(value) => {
            setIsDragging(false);
            if (updateTrackAnimationBoundaries) {
              updateTrackAnimationBoundaries(
                sliderValueToFrame(value[0]),
                sliderValueToFrame(value[1]),
              );
            }
          }}
          style={{ height: `calc(100% + ${TEXT_ANIMATION_THUMB_HEIGHT}px)` }}
          renderTrack={(props, state) => {
            const { key, className, style, ...trackProps } = props;
            const isActiveTrack = state.index === 1;
            return (
              <div
                key={key}
                {...trackProps}
                className={`track rounded-full text-animation-track ${isActiveTrack ? 'timeline-layer-range-bar' : ''} ${isAnimationSelected ? 'animation-selected' : ''} ${className ?? ''}`}
                style={{
                  ...style,
                  bottom: isActiveTrack
                    ? addStyleValueOffset(style?.bottom, TEXT_ANIMATION_THUMB_HEIGHT)
                    : style?.bottom,
                  ...(isActiveTrack ? activeTrackStyle : {}),
                  width: isActiveTrack ? '8px' : '3px',
                  left: '50%',
                  transform: 'translateX(-50%)',
                  overflow: 'hidden',
                  backgroundColor: isActiveTrack ? activeTrackStyle.backgroundColor : 'transparent',
                }}
                onMouseDown={isActiveTrack ? handleTrackMouseDown : undefined}
                onClick={handleTrackClick}
              >
                {isActiveTrack ? (
                  <>
                    <div className={`pointer-events-none absolute inset-x-0 top-0 h-px ${colorMode === 'dark' ? 'bg-white/12' : 'bg-white/80'}`} />
                    <div
                      className={`pointer-events-none absolute inset-x-0 bottom-0 h-px ${
                        isAnimationSelected
                          ? (colorMode === 'dark' ? 'bg-blue-200/80' : 'bg-blue-600/80')
                          : (colorMode === 'dark' ? 'bg-[#6b7d95]' : 'bg-slate-500/70')
                      }`}
                    />
                  </>
                ) : null}
              </div>
            );
          }}
          renderThumb={(props) => {
            const { key, className, style, ...thumbProps } = props;
            return (
              <div
                key={key}
                {...thumbProps}
                className={`flex h-[12px] w-[12px] items-center justify-center rounded-[3px] border ${
                  colorMode === 'dark'
                    ? 'bg-slate-100 border-slate-300/70 text-slate-900'
                    : 'bg-white border-slate-300 text-slate-700'
                } ${className ?? ''}`}
                style={{
                  ...style,
                  left: '50%',
                  transform: 'translate(-50%, -50%)',
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  handleTrackClick(e);
                }}
              >
                <FaDiamond className='text-[9px]' />
              </div>
            );
          }}
        />
      </div>
    </div>
  );
}
