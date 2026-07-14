// src/components/util/RangeOverlaySlider.js
import { useCallback, useEffect, useState, useRef } from 'react';
import ReactSlider from 'react-slider';

function areSliderValuesEqual(left, right) {
  if (left === right) {
    return true;
  }
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
    return false;
  }
  return left.every((entry, index) => Number(entry) === Number(right[index]));
}

export default function RangeOverlaySlider({
  min,
  max,
  value,
  onChange,
  layerDurationUpdated,
  onDragAmountChange, // Add this prop
  onBeforeChange, onAfterChange 
}) {
  const [sliderValues, setSliderValues] = useState(value);
  const [initialValue, setInitialValue] = useState(null);
  const sliderRef = useRef(null);
  const latestSliderValuesRef = useRef(value);
  const isInteractionActiveRef = useRef(false);

  // Define constants for minimum duration
  const MIN_LAYER_DURATION = 0.1; // Minimum layer duration in seconds
  const FPS = 30; // Frames per second
  const MIN_DISTANCE_IN_FRAMES = MIN_LAYER_DURATION * FPS; // Minimum distance between thumbs in frames

  const handleSliderChange = (values) => {
    // Update internal slider values
    latestSliderValuesRef.current = values;
    setSliderValues(values);

    // Call the parent onChange handler
    onChange(values);


  };

  const handleMouseDown = (event) => {
    event.preventDefault();
    event.stopPropagation();
  };

  const finishInteraction = useCallback(() => {
    if (!isInteractionActiveRef.current) {
      return;
    }

    isInteractionActiveRef.current = false;
    setInitialValue(null);

    if (onDragAmountChange) {
      onDragAmountChange(0);
    }

    const settledValues = latestSliderValuesRef.current;
    if (layerDurationUpdated) {
      layerDurationUpdated(settledValues);
    }
    if (onAfterChange) {
      onAfterChange(settledValues);
    }
  }, [layerDurationUpdated, onAfterChange, onDragAmountChange]);

  const scheduleForcedInteractionStop = useCallback(() => {
    requestAnimationFrame(() => {
      if (!isInteractionActiveRef.current) {
        return;
      }

      if (sliderRef.current?.onMouseUp) {
        sliderRef.current.onMouseUp();
        return;
      }

      finishInteraction();
    });
  }, [finishInteraction]);

  // Update sliderValues only when not dragging
  useEffect(() => {
    latestSliderValuesRef.current = value;
    if (initialValue === null) {
      setSliderValues((previousValues) => (
        areSliderValuesEqual(previousValues, value) ? previousValues : value
      ));
    }
  }, [initialValue, value]);

  useEffect(() => {
    const handleWindowBlur = () => {
      scheduleForcedInteractionStop();
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        scheduleForcedInteractionStop();
      }
    };

    window.addEventListener('mouseup', scheduleForcedInteractionStop, true);
    window.addEventListener('pointerup', scheduleForcedInteractionStop, true);
    window.addEventListener('touchend', scheduleForcedInteractionStop, true);
    window.addEventListener('blur', handleWindowBlur);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.removeEventListener('mouseup', scheduleForcedInteractionStop, true);
      window.removeEventListener('pointerup', scheduleForcedInteractionStop, true);
      window.removeEventListener('touchend', scheduleForcedInteractionStop, true);
      window.removeEventListener('blur', handleWindowBlur);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [scheduleForcedInteractionStop]);

  return (
    <div
      style={{
        height: `100%`,
        overflow: 'visible',
      }}
      onMouseDown={handleMouseDown}
      onMouseUp={(event) => {
        event.stopPropagation();
      }}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
    >
      <ReactSlider
        ref={sliderRef}
        className={`range-overlay-slider h-full m-auto`}
        min={min}
        max={max}
        value={sliderValues}
        onChange={handleSliderChange}
        renderThumb={(props) => {
          const { key, className, style, ...thumbProps } = props;
          return (
            <div
              key={key}
              {...thumbProps}
              className={className}
              style={{
                ...style,
                left: '50%',
                transform: 'translateX(-50%)',
              }}
              onMouseDown={(event) => {
                event.preventDefault();
                event.stopPropagation();
                thumbProps.onMouseDown?.(event);
              }}
            />
          );
        }}
        onBeforeChange={() => {
          isInteractionActiveRef.current = true;
          setInitialValue(latestSliderValuesRef.current);
          if (onBeforeChange) {
            onBeforeChange(latestSliderValuesRef.current);
          }
        }}
        onAfterChange={() => {
          finishInteraction();
        }}
        orientation="vertical"
        minDistance={MIN_DISTANCE_IN_FRAMES}
        withTracks={false}
        style={{ height: '100%', pointerEvents: 'auto' }}
      />
    </div>
  );
}
