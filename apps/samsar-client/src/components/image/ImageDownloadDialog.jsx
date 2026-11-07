import { useUiLanguage } from '../../hooks/useUiLanguage.js';
import { translateText as uiText } from '../../utils/localization.js';
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
  useUiLanguage();
  const { colorMode } = useColorMode();
  const [scale, setScale] = useState(1);
  const [customWidth, setCustomWidth] = useState(baseWidth);
  const [customHeight, setCustomHeight] = useState(baseHeight);
  const [ratioValue, setRatioValue] = useState(aspectRatio || '1:1');
  const [lockRatio, setLockRatio] = useState(true);

  const ratio = useMemo(() => parseAspectRatio(ratioValue), [ratioValue]);

  const surface =
    'bg-surface border border-line text-fg';
  const mutedText = "text-fg-muted";
  const inputClass =
    'bg-surface-raised border border-line text-fg';
  const primaryButton =
    colorMode === 'dark'
      ? 'bg-rose-500 text-white hover:bg-rose-400'
      : 'bg-rose-500 text-white hover:bg-rose-600';
  const secondaryButton =
    `text-fg-secondary border border-line ${colorMode === 'dark' ? 'bg-[#20232e] hover:bg-[#292d3a]' : 'bg-slate-100 hover:bg-slate-200'}`;

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
        <div className="text-lg font-semibold">{uiText("Advanced Download")}</div>
        <button className={`text-sm ${mutedText}`} onClick={onClose}>{uiText("Close")}</button>
      </div>

      <div className="mb-5">
        <div className="text-sm font-semibold mb-2">{uiText("Scale (keeps current aspect ratio)")}</div>
        <div className="flex gap-2 mb-2">
          {scaleOptions.map((option) => (
            <button
              key={option}
              className={`px-3 py-1 rounded-md text-sm border ${
                scale === option
                  ? 'border-rose-400 text-rose-400'
                  : 'border-line text-fg-tertiary'
              }`}
              onClick={() => setScale(option)}
            >
              {option}x
            </button>
          ))}
        </div>
        <div className={`text-xs ${mutedText}`}>{uiText("Output: {value0} × {value1}px", { value0: baseWidth * scale, value1: baseHeight * scale })}</div>
        <button
          className={`mt-3 w-full rounded-md px-3 py-2 text-sm ${primaryButton}`}
          onClick={() => onDownload?.({ mode: 'scale', scale })}
        >{uiText("Download Scaled Image")}</button>
      </div>

      <div className="border-t border-slate-200/20 pt-4">
        <div className="text-sm font-semibold mb-2">{uiText("Custom resolution (cropped)")}</div>
        <div className="grid grid-cols-2 gap-2 mb-3">
          <div className="flex flex-col gap-1">
            <label className={`text-xs ${mutedText}`}>{uiText("Width")}</label>
            <input
              type="number"
              min="1"
              value={customWidth}
              onChange={handleWidthChange}
              className={`rounded-md px-2 py-1 text-sm ${inputClass}`}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className={`text-xs ${mutedText}`}>{uiText("Height")}</label>
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
            />{uiText("Lock ratio")}</label>
        </div>
        <div className={`text-xs ${mutedText}`}>{uiText("Custom size crops the canvas to fit the new resolution.")}</div>
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
        >{uiText("Download Custom Image")}</button>
      </div>
    </div>
  );
}
