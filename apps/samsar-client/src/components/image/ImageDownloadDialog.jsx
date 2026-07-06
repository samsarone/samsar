import { useMemo, useState } from 'react';
import { useColorMode } from '../../contexts/ColorMode.jsx';

const parseAspectRatio = (value) => {
  if (!value || typeof value !== 'string') return null;
  const match = value.trim().match(/^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/);
  if (!match) return null;
  const width = parseFloat(match[1]);
  const height = parseFloat(match[2]);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return null;
  }
  return width / height;
};

export default function ImageDownloadDialog({
  baseWidth,
  baseHeight,
  aspectRatio,
  aspectRatioOptions,
  onDownload,
  onClose,
}) {
  const { colorMode } = useColorMode();
  const [scale, setScale] = useState(1);
  const [customWidth, setCustomWidth] = useState(baseWidth);
  const [customHeight, setCustomHeight] = useState(baseHeight);
  const [ratioValue, setRatioValue] = useState(aspectRatio || '1:1');
  const [lockRatio, setLockRatio] = useState(true);

  const ratio = useMemo(() => parseAspectRatio(ratioValue), [ratioValue]);

  const surface =
    colorMode === 'dark'
      ? 'bg-[#0f1629] border border-[#1f2a3d] text-slate-100'
      : 'bg-white border border-slate-200 text-slate-900';
  const mutedText = colorMode === 'dark' ? 'text-slate-400' : 'text-slate-500';
  const inputClass =
    colorMode === 'dark'
      ? 'bg-[#111a2f] border border-[#1f2a3d] text-slate-100'
      : 'bg-white border border-slate-200 text-slate-900';
  const primaryButton =
    colorMode === 'dark'
      ? 'bg-rose-500 text-white hover:bg-rose-400'
      : 'bg-rose-500 text-white hover:bg-rose-600';
  const secondaryButton =
    colorMode === 'dark'
      ? 'bg-[#111a2f] text-slate-200 hover:bg-[#16213a] border border-[#1f2a3d]'
      : 'bg-slate-100 text-slate-700 hover:bg-slate-200 border border-slate-200';

  const handleWidthChange = (event) => {
    const value = parseInt(event.target.value || '0', 10);
    setCustomWidth(value);
    if (lockRatio && ratio) {
      setCustomHeight(Math.max(1, Math.round(value / ratio)));
    }
  };

  const handleHeightChange = (event) => {
    const value = parseInt(event.target.value || '0', 10);
    setCustomHeight(value);
    if (lockRatio && ratio) {
      setCustomWidth(Math.max(1, Math.round(value * ratio)));
    }
  };

  const handleRatioChange = (event) => {
    const next = event.target.value;
    setRatioValue(next);
    const nextRatio = parseAspectRatio(next);
    if (lockRatio && nextRatio) {
      const width = customWidth || baseWidth;
      setCustomHeight(Math.max(1, Math.round(width / nextRatio)));
    }
  };

  const scaleOptions = [1, 2, 4];
  const customValid = customWidth > 0 && customHeight > 0;

  return (
    <div className={`rounded-xl p-4 ${surface}`}>
      <div className="flex items-center justify-between mb-4">
        <div className="text-lg font-semibold">Advanced Download</div>
        <button className={`text-sm ${mutedText}`} onClick={onClose}>
          Close
        </button>
      </div>

      <div className="mb-5">
        <div className="text-sm font-semibold mb-2">Scale (keeps current aspect ratio)</div>
        <div className="flex gap-2 mb-2">
          {scaleOptions.map((option) => (
            <button
              key={option}
              className={`px-3 py-1 rounded-md text-sm border ${
                scale === option
                  ? 'border-rose-400 text-rose-400'
                  : colorMode === 'dark'
                    ? 'border-[#1f2a3d] text-slate-300'
                    : 'border-slate-200 text-slate-600'
              }`}
              onClick={() => setScale(option)}
            >
              {option}x
            </button>
          ))}
        </div>
        <div className={`text-xs ${mutedText}`}>
          Output: {baseWidth * scale} × {baseHeight * scale}px
        </div>
        <button
          className={`mt-3 w-full rounded-md px-3 py-2 text-sm ${primaryButton}`}
          onClick={() => onDownload?.({ mode: 'scale', scale })}
        >
          Download Scaled Image
        </button>
      </div>

      <div className="border-t border-slate-200/20 pt-4">
        <div className="text-sm font-semibold mb-2">Custom resolution (cropped)</div>
        <div className="grid grid-cols-2 gap-2 mb-3">
          <div className="flex flex-col gap-1">
            <label className={`text-xs ${mutedText}`}>Width</label>
            <input
              type="number"
              min="1"
              value={customWidth}
              onChange={handleWidthChange}
              className={`rounded-md px-2 py-1 text-sm ${inputClass}`}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className={`text-xs ${mutedText}`}>Height</label>
            <input
              type="number"
              min="1"
              value={customHeight}
              onChange={handleHeightChange}
              className={`rounded-md px-2 py-1 text-sm ${inputClass}`}
            />
          </div>
        </div>
        <div className="flex items-center gap-2 mb-3">
          <select
            value={ratioValue}
            onChange={handleRatioChange}
            className={`flex-1 rounded-md px-2 py-1 text-sm ${inputClass}`}
          >
            {(aspectRatioOptions || []).map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <label className={`flex items-center gap-2 text-xs ${mutedText}`}>
            <input
              type="checkbox"
              checked={lockRatio}
              onChange={(event) => setLockRatio(event.target.checked)}
            />
            Lock ratio
          </label>
        </div>
        <div className={`text-xs ${mutedText}`}>
          Custom size crops the canvas to fit the new resolution.
        </div>
        <button
          className={`mt-3 w-full rounded-md px-3 py-2 text-sm ${secondaryButton}`}
          disabled={!customValid}
          onClick={() =>
            onDownload?.({
              mode: 'custom',
              width: customWidth,
              height: customHeight,
              crop: true,
            })
          }
        >
          Download Custom Image
        </button>
      </div>
    </div>
  );
}
