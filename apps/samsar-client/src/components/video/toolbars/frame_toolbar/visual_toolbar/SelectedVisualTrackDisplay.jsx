import { useUiLanguage } from '../../../../../hooks/useUiLanguage.js';
import { translateText as uiText } from '../../../../../utils/localization.js';

import { FaTimes } from 'react-icons/fa';
import { useColorMode } from '../../../../../contexts/ColorMode.jsx';

export default function SelectedVisualTrackDisplay(props) {
  useUiLanguage();
  const {
    selectedVisualTrack,
    onDelete,
    onSave,
  } = props;
  const { colorMode } = useColorMode();

  if (!selectedVisualTrack) {
    return <span />;
  }

  const startTime = (selectedVisualTrack.startTime || 0).toFixed(2);
  const endTime = (selectedVisualTrack.endTime || 0).toFixed(2);
  const durationTime = Math.max(
    0,
    (selectedVisualTrack.endTime || 0) - (selectedVisualTrack.startTime || 0),
  ).toFixed(2);

  let statusLabel = '';
  let statusClassName = 'text-neutral-400';
  if (selectedVisualTrack.isSaving) {
    statusLabel = uiText('Saving...');
    statusClassName = 'status-muted';
  } else if (selectedVisualTrack.saveError) {
    statusLabel = uiText("Save failed");
    statusClassName = 'status-error';
  } else if (selectedVisualTrack.isDirty) {
    statusLabel = uiText('Unsaved');
    statusClassName = 'status-warning';
  }

  const metaChipClassName = `border text-fg-secondary ${colorMode === 'dark' ? 'bg-slate-900/70 border-slate-700/70' : 'bg-slate-100 border-slate-200'}`;
  const headingClassName = colorMode === 'dark' ? 'text-slate-100' : 'text-slate-800';
  const subTextClassName = 'text-fg-muted';
  const deleteButtonClassName = colorMode === 'dark'
    ? 'bg-red-800 hover:bg-red-700'
    : 'bg-red-600 hover:bg-red-500';
  const saveButtonClassName = colorMode === 'dark'
    ? 'bg-emerald-700 hover:bg-emerald-600'
    : 'bg-emerald-600 hover:bg-emerald-500';

  return (
    <div className="flex w-full flex-wrap items-center gap-2 text-xs">
      <div className="flex min-w-[132px] flex-col justify-center">
        <span className="uppercase font-bold tracking-[0.12em] status-success text-micro">
          {selectedVisualTrack.assetLabel}
        </span>
        <span className={`font-medium ${headingClassName}`}>
          {selectedVisualTrack.id}
        </span>
        <span className={subTextClassName}>{uiText("Layer {value0}", { value0: selectedVisualTrack.layerIndex + 1 })}</span>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className={`flex min-w-[58px] flex-col rounded-md px-2 py-1 ${metaChipClassName}`}>
          <span className="font-semibold uppercase text-micro tracking-[0.08em]">{uiText("Start")}</span>
          <span>{startTime}s</span>
        </div>
        <div className={`flex min-w-[58px] flex-col rounded-md px-2 py-1 ${metaChipClassName}`}>
          <span className="font-semibold uppercase text-micro tracking-[0.08em]">{uiText("End")}</span>
          <span>{endTime}s</span>
        </div>
        <div className={`flex min-w-[68px] flex-col rounded-md px-2 py-1 ${metaChipClassName}`}>
          <span className="font-semibold uppercase text-micro tracking-[0.08em]">{uiText("Duration")}</span>
          <span>{durationTime}s</span>
        </div>
      </div>

      <div className="ml-auto flex flex-wrap items-center gap-2">
        {statusLabel && (
          <span className={`font-semibold ${statusClassName}`}>
            {statusLabel}
          </span>
        )}

        <button
          type="button"
          className={`${saveButtonClassName} text-white px-3 py-1 rounded-md inline-flex items-center gap-1 disabled:opacity-60`}
          onClick={() => onSave?.(selectedVisualTrack)}
          disabled={!selectedVisualTrack.isDirty || selectedVisualTrack.isSaving}
        >{uiText("Update")}</button>

        <button
          type="button"
          className={`${deleteButtonClassName} text-white px-2 py-1 rounded-md inline-flex items-center gap-1 disabled:opacity-60`}
          onClick={() => onDelete?.(selectedVisualTrack)}
          disabled={selectedVisualTrack.isSaving}
        >
          <FaTimes />{uiText("Delete")}</button>
      </div>
    </div>
  );
}
