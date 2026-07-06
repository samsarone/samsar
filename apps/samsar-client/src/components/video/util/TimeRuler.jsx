import { useEffect, useMemo, useRef, useState } from 'react';

const DEFAULT_TICK_COUNT = 8;
const MIN_TICK_COUNT = 2;
const MAX_TICK_COUNT = 14;
const MIN_TICK_SPACING_PX = 56;
const EPSILON = 1e-6;
const TICK_INTERVALS = [
  1 / 30,
  2 / 30,
  5 / 30,
  10 / 30,
  15 / 30,
  0.5,
  1,
  2,
  5,
  10,
  15,
  20,
  30,
  45,
  60,
  90,
  120,
  180,
  300,
  600,
  900,
  1800,
  3600,
  7200,
  14400,
];

const clampToPrecision = (value, precision = 4) => Number(value.toFixed(precision));
const clamp = (value, minimum, maximum) => Math.min(Math.max(value, minimum), maximum);

const trimTrailingZeroes = (value) => value
  .replace(/\.0+$/, '')
  .replace(/(\.\d*?)0+$/, '$1');

const getTickInterval = (visibleDuration, desiredTickCount) => {
  const safeTickCount = clamp(
    Math.round(desiredTickCount) || DEFAULT_TICK_COUNT,
    MIN_TICK_COUNT,
    MAX_TICK_COUNT,
  );
  const minimumInterval = visibleDuration / safeTickCount;

  return TICK_INTERVALS.find((interval) => interval >= minimumInterval)
    || TICK_INTERVALS[TICK_INTERVALS.length - 1];
};

const formatTickLabel = (seconds, interval, visibleDuration) => {
  const roundedSeconds = Math.max(0, clampToPrecision(seconds, 2));

  if (visibleDuration >= 3600 || interval >= 3600 || roundedSeconds >= 3600) {
    const totalSeconds = Math.round(roundedSeconds);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const remainingSeconds = totalSeconds % 60;
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(remainingSeconds).padStart(2, '0')}`;
  }

  if (visibleDuration >= 60 || interval >= 60 || roundedSeconds >= 60) {
    const totalSeconds = Math.round(roundedSeconds);
    const minutes = Math.floor(totalSeconds / 60);
    const remainingSeconds = totalSeconds % 60;
    return `${minutes}:${String(remainingSeconds).padStart(2, '0')}`;
  }

  const decimalPlaces =
    interval >= 1 ? 0 : interval >= 0.1 ? 1 : 2;

  return `${trimTrailingZeroes(
    clampToPrecision(roundedSeconds, decimalPlaces).toFixed(decimalPlaces)
  )}s`;
};

const buildTicks = (startTime, endTime, interval) => {
  const firstTick = Math.ceil((startTime - EPSILON) / interval) * interval;
  const ticks = [];

  for (let tick = firstTick; tick <= endTime + EPSILON; tick += interval) {
    const normalizedTick = clampToPrecision(tick);

    if (normalizedTick < startTime - EPSILON) {
      continue;
    }

    ticks.push(normalizedTick);
  }

  return ticks.length > 0 ? ticks : [startTime];
};

const TimeRuler = ({
  totalDuration = 0,
  visibleStartTime = 0,
  visibleEndTime,
}) => {
  const rulerRef = useRef(null);
  const [rulerHeight, setRulerHeight] = useState(0);

  useEffect(() => {
    const element = rulerRef.current;

    if (!element) {
      return undefined;
    }

    const updateHeight = () => {
      const nextHeight = element.getBoundingClientRect().height || 0;
      setRulerHeight((previousHeight) => (
        Math.abs(previousHeight - nextHeight) < 1 ? previousHeight : nextHeight
      ));
    };

    updateHeight();

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', updateHeight);
      return () => {
        window.removeEventListener('resize', updateHeight);
      };
    }

    const resizeObserver = new ResizeObserver(() => {
      updateHeight();
    });

    resizeObserver.observe(element);

    return () => {
      resizeObserver.disconnect();
    };
  }, []);

  const fallbackEndTime = Number.isFinite(totalDuration) && totalDuration > 0
    ? totalDuration
    : 0;
  const rawStartTime = Number.isFinite(visibleStartTime) ? visibleStartTime : 0;
  const rawEndTime = Number.isFinite(visibleEndTime) ? visibleEndTime : fallbackEndTime;
  const startTime = Math.max(0, Math.min(rawStartTime, rawEndTime));
  const endTime = Math.max(startTime, rawEndTime);
  const visibleDuration = Math.max(endTime - startTime, EPSILON);
  const desiredTickCount = useMemo(() => {
    if (!Number.isFinite(rulerHeight) || rulerHeight <= 0) {
      return DEFAULT_TICK_COUNT;
    }

    return clamp(
      Math.floor(rulerHeight / MIN_TICK_SPACING_PX),
      MIN_TICK_COUNT,
      MAX_TICK_COUNT,
    );
  }, [rulerHeight]);
  const tickInterval = getTickInterval(visibleDuration, desiredTickCount);
  const ticks = buildTicks(startTime, endTime, tickInterval);

  return (
    <div className="time-ruler" ref={rulerRef}>
      {ticks.map((tick) => {
        const offset = Math.min(
          100,
          Math.max(0, ((tick - startTime) / visibleDuration) * 100),
        );
        const transform =
          offset <= 0
            ? 'translateY(0)'
            : offset >= 100
              ? 'translateY(-100%)'
              : 'translateY(-50%)';

        return (
          <div
            key={tick}
            className="time-ruler-tick"
            style={{ top: `${offset}%`, transform }}
          >
            <span className="time-ruler-tick-mark" />
            <span className="time-ruler-tick-label">
              {formatTickLabel(tick, tickInterval, visibleDuration)}
            </span>
          </div>
        );
      })}
    </div>
  );
};

export default TimeRuler;
