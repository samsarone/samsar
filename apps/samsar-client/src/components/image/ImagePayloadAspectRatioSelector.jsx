import { useMemo } from 'react';
import { useColorMode } from '../../contexts/ColorMode.jsx';
import {
  findAspectRatioOptionForCanvasDimensions,
  normalizeCanvasDimensions,
} from '../../utils/canvas.jsx';

export default function ImagePayloadAspectRatioSelector(props) {
  const {
    label = 'Generation ratio',
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
    colorMode === 'dark'
      ? 'bg-[#10192e] border border-[#25324a] text-slate-100'
      : 'bg-rose-50 border border-rose-200 text-slate-900';
  const subtleText = colorMode === 'dark' ? 'text-slate-300' : 'text-slate-600';
  const eyebrowText = colorMode === 'dark' ? 'text-slate-400' : 'text-rose-600';
  const selectShell =
    colorMode === 'dark'
      ? 'bg-slate-950/80 text-slate-100 border border-white/10'
      : 'bg-white text-slate-900 border border-rose-200 shadow-sm';
  const cardPaddingClass = isImageStudio ? 'rounded-2xl px-4 py-3' : 'rounded-lg px-3 py-2';
  const layoutClassName = compactInline
    ? isImageStudio
      ? 'flex flex-wrap items-center gap-4'
      : 'flex flex-wrap items-center gap-3'
    : isImageStudio
    ? 'grid grid-cols-[auto,1fr,auto] items-center gap-4'
    : 'grid grid-cols-[auto,1fr,auto] items-center gap-3';
  const labelClass = isImageStudio
    ? `text-[11px] font-semibold uppercase tracking-[0.22em] ${eyebrowText}`
    : `text-[10px] font-semibold uppercase tracking-[0.18em] ${eyebrowText}`;
  const helperClass = isImageStudio
    ? `min-w-0 truncate text-[13px] ${subtleText}`
    : `min-w-0 truncate text-[11px] ${subtleText}`;
  const selectClass = isImageStudio
    ? `${selectShell} min-w-[170px] rounded-xl px-4 py-2.5 text-sm font-medium`
    : `${selectShell} min-w-[150px] rounded-lg px-3 py-2 text-sm font-medium`;

  const canvasResolutionLabel = `${normalizedCanvasDimensions.width} x ${normalizedCanvasDimensions.height} px`;
  const helperText = matchingCanvasAspectRatioOption
    ? matchingCanvasAspectRatioOption.value === value
      ? `Canvas ${canvasResolutionLabel}`
      : `Canvas ${canvasResolutionLabel}, preset ${matchingCanvasAspectRatioOption.label}`
    : `Custom canvas ${canvasResolutionLabel}`;

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
