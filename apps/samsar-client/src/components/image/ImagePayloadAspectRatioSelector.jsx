import { useUiLanguage } from '../../hooks/useUiLanguage.js';
import { translateText as uiText } from '../../utils/localization.js';
import { useMemo } from 'react';
import { useColorMode } from '../../contexts/ColorMode.jsx';
import {
  findAspectRatioOptionForCanvasDimensions,
  normalizeCanvasDimensions,
} from '../../utils/canvas.jsx';

export default function ImagePayloadAspectRatioSelector(props) {
  useUiLanguage();
  const {
    label = uiText("Generation ratio"),
    name,
    value,
    onChange,
    options = [],
    canvasDimensions,
    compactInline = false,
    sizeVariant = 'default',
  } = props;

  const { colorMode } = useColorMode();
  const isImageStudio = sizeVariant === 'imageStudio';

  const normalizedCanvasDimensions = useMemo(
    () => normalizeCanvasDimensions(canvasDimensions, value || options?.[0]?.value || '1:1'),
    [canvasDimensions, options, value]
  );

  const matchingCanvasAspectRatioOption = useMemo(
    () => findAspectRatioOptionForCanvasDimensions(normalizedCanvasDimensions, options),
    [normalizedCanvasDimensions, options]
  );

  const cardSurface =
    `border text-fg ${colorMode === 'dark' ? 'bg-[#20232e] border-[#3a4050]' : 'bg-rose-50 border-rose-200'}`;
  const subtleText = "text-fg-tertiary";
  const eyebrowText = colorMode === 'dark' ? "text-slate-400" : "text-rose-600";
  const selectShell =
    `bg-surface-sunken text-fg border ${colorMode === 'dark' ? 'border-[#667188] focus:border-[#f6c453] focus:outline-none focus:ring-2 focus:ring-[#f6c453]/20' : 'border-rose-200 shadow-sm'}`;
  const cardPaddingClass = isImageStudio ? 'rounded-2xl px-4 py-3' : 'rounded-lg px-3 py-2';
  const layoutClassName = compactInline
    ? isImageStudio
      ? 'flex flex-wrap items-center gap-4'
      : 'flex flex-wrap items-center gap-3'
    : isImageStudio
    ? 'grid grid-cols-[auto,1fr,auto] items-center gap-4'
    : 'grid grid-cols-[auto,1fr,auto] items-center gap-3';
  const labelClass = isImageStudio
    ? `text-caption font-semibold uppercase tracking-[0.22em] ${eyebrowText}`
    : `text-micro font-semibold uppercase tracking-[0.18em] ${eyebrowText}`;
  const helperClass = isImageStudio
    ? `min-w-0 truncate text-label ${subtleText}`
    : `min-w-0 truncate text-caption ${subtleText}`;
  const selectClass = isImageStudio
    ? `${selectShell} min-w-[170px] rounded-xl px-4 py-2.5 text-sm font-medium`
    : `${selectShell} min-w-[150px] rounded-lg px-3 py-2 text-sm font-medium`;

  const canvasResolutionLabel = uiText("{value0} x {value1} px", { value0: normalizedCanvasDimensions.width, value1: normalizedCanvasDimensions.height });
  const helperText = matchingCanvasAspectRatioOption
    ? matchingCanvasAspectRatioOption.value === value
      ? uiText("Canvas {value0}", { value0: canvasResolutionLabel })
      : uiText("Canvas {value0}, preset {value1}", { value0: canvasResolutionLabel, value1: matchingCanvasAspectRatioOption.label })
    : uiText("Custom canvas {value0}", { value0: canvasResolutionLabel });

  return (
    <div className={`${cardPaddingClass} ${cardSurface}`}>
      <div className={layoutClassName}>
        <div className={compactInline ? 'flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1' : ''}>
          <div className={labelClass}>
            {label}
          </div>
          <div className={helperClass}>
            {helperText}
          </div>
        </div>
        <select
          name={name}
          value={value}
          onChange={(event) => onChange?.(event.target.value)}
          className={selectClass}
        >
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
