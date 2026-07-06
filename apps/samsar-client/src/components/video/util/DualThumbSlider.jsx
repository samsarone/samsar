// DualThumbSlider.js
import { useEffect, useMemo, useState } from 'react';
import ReactSlider from 'react-slider';

const DUAL_THUMB_HANDLE_HEIGHT = 10;
const DUAL_THUMB_HANDLE_INSET = DUAL_THUMB_HANDLE_HEIGHT / 2;

export default function DualThumbSlider({
  min,
  max,
  value,
  onChange,
  onAfterChange,
  sliderMin,
  sliderMax,
  valueToSliderValue,
  sliderValueToValue,
  disabled = false,
}) {
  const resolvedSliderMin = Number.isFinite(Number(sliderMin)) ? Number(sliderMin) : min;
  const resolvedSliderMax = Number.isFinite(Number(sliderMax)) ? Number(sliderMax) : max;
  const toSliderValue = (domainValue) => (
    typeof valueToSliderValue === 'function'
      ? valueToSliderValue(domainValue)
      : domainValue
  );
  const toDomainValue = (sliderValue) => (
    typeof sliderValueToValue === 'function'
      ? sliderValueToValue(sliderValue)
      : sliderValue
  );
  const domainValuesToSliderValues = (values) => (
    Array.isArray(values)
      ? values.map((val) => toSliderValue(val))
      : values
  );
  const sliderValuesToDomainValues = (values) => (
    Array.isArray(values)
      ? values.map((val) => {
        const domainValue = toDomainValue(val);
        if (!Number.isFinite(domainValue)) return min;
        return Math.min(Math.max(domainValue, min), max);
      })
      : values
  );
  const [sliderValues, setSliderValues] = useState(() => (
    domainValuesToSliderValues(Array.isArray(value) ? value : [min, max])
  ));

  const sliderSpan = max - min;
  const renderedSliderSpan = resolvedSliderMax - resolvedSliderMin;
  const safeSliderMax = renderedSliderSpan === 0 ? resolvedSliderMin + 1 : resolvedSliderMax;

  const sanitizeValues = (values) => (
    Array.isArray(values)
      ? values.map((val) => {
        if (!Number.isFinite(val)) return resolvedSliderMin;
        const clamped = Math.min(Math.max(val, resolvedSliderMin), resolvedSliderMax);
        return renderedSliderSpan === 0 ? resolvedSliderMin : clamped;
      })
      : values
  );

  const handleSliderChange = (values) => {
    if (disabled) {
      return;
    }

    const sanitizedValues = sanitizeValues(values);
    setSliderValues(sanitizedValues);

    if (sliderSpan !== 0 && renderedSliderSpan !== 0 && typeof onChange === 'function') {
      onChange(sliderValuesToDomainValues(sanitizedValues));
    }
  };

  const handleSliderAfterChange = (values) => {
    if (disabled) {
      return;
    }

    const sanitizedValues = sanitizeValues(values);
    setSliderValues(sanitizedValues);

    if (sliderSpan !== 0 && renderedSliderSpan !== 0 && typeof onAfterChange === 'function') {
      onAfterChange(sliderValuesToDomainValues(sanitizedValues));
    }
  };

  useEffect(() => {
    if (Array.isArray(value)) {
      const sanitizedValues = sanitizeValues(domainValuesToSliderValues(value));
      setSliderValues(sanitizedValues);
    }
  }, [
    max,
    min,
    resolvedSliderMax,
    resolvedSliderMin,
    value,
    valueToSliderValue,
  ]);

  const displayValues = useMemo(() => {
    if (!Array.isArray(sliderValues)) return sliderValues;
    return sliderValues.map((val) => {
      if (!Number.isFinite(val)) return resolvedSliderMin;
      if (renderedSliderSpan === 0) return resolvedSliderMin;
      return Math.min(Math.max(val, resolvedSliderMin), safeSliderMax);
    });
  }, [
    renderedSliderSpan,
    resolvedSliderMin,
    safeSliderMax,
    sliderValues,
  ]);

  return (
    <div
      className='dual-thumb-slider'
      style={{ height: '100%' }}
    >
      <div
        className='dual-thumb-slider-rail'
        style={{
          top: `${DUAL_THUMB_HANDLE_INSET}px`,
          bottom: `${DUAL_THUMB_HANDLE_INSET}px`,
        }}
      />
      <ReactSlider
        className='w-full'
        style={{
          height: `calc(100% - ${DUAL_THUMB_HANDLE_HEIGHT}px)`,
          top: `${DUAL_THUMB_HANDLE_INSET}px`,
          position: 'relative',
        }}
        thumbClassName='thumb'
        min={resolvedSliderMin}
        max={safeSliderMax}
        value={displayValues}
        minDistance={1}
        pearling
        withTracks={false}
        disabled={disabled}
        onChange={handleSliderChange}
        onAfterChange={handleSliderAfterChange}
        renderThumb={(props) => {
          const { key, ...thumbProps } = props;
          return <div key={key} {...thumbProps} />;
        }}
        orientation="vertical"
      />
    </div>
  );
}
