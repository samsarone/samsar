
import { FaTimes } from 'react-icons/fa';
import { useColorMode } from '../../../../../contexts/ColorMode.jsx';

export default function SelectedVisualTrackDisplay(props) {
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
    statusLabel = 'Saving...';
    statusClassName = 'text-blue-300';
  } else if (selectedVisualTrack.saveError) {
    statusLabel = 'Save failed';
    statusClassName = 'text-red-300';
  } else if (selectedVisualTrack.isDirty) {
    statusLabel = 'Unsaved';
    statusClassName = 'text-amber-300';
  }

  const metaChipClassName = colorMode === 'dark'
    ? 'bg-slate-900/70 border border-slate-700/70 text-slate-200'
    : 'bg-slate-100 border border-slate-200 text-slate-700';
  const headingClassName = colorMode === 'dark' ? 'text-slate-100' : 'text-slate-800';
  const subTextClassName = colorMode === 'dark' ? 'text-slate-400' : 'text-slate-500';
  const deleteButtonClassName = colorMode === 'dark'
    ? 'bg-red-800 hover:bg-red-700'
    : 'bg-red-600 hover:bg-red-500';
  const saveButtonClassName = colorMode === 'dark'
    ? 'bg-emerald-700 hover:bg-emerald-600'
    : 'bg-emerald-600 hover:bg-emerald-500';

  return (
    <div className="flex w-full flex-wrap items-center gap-2 text-xs">
      <div className="flex min-w-[132px] flex-col justify-center">
        <span className="uppercase font-bold tracking-[0.12em] text-emerald-300 text-[10px]">
          {selectedVisualTrack.assetLabel}
        </span>
        <span className={`font-medium ${headingClassName}`}>
          {selectedVisualTrack.id}
        </span>
        <span className={subTextClassName}>
          Layer {selectedVisualTrack.layerIndex + 1}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className={`flex min-w-[58px] flex-col rounded-md px-2 py-1 ${metaChipClassName}`}>
          <span className="font-semibold uppercase text-[10px] tracking-[0.08em]">Start</span>
          <span>{startTime}s</span>
        </div>
        <div className={`flex min-w-[58px] flex-col rounded-md px-2 py-1 ${metaChipClassName}`}>
          <span className="font-semibold uppercase text-[10px] tracking-[0.08em]">End</span>
          <span>{endTime}s</span>
        </div>
        <div className={`flex min-w-[68px] flex-col rounded-md px-2 py-1 ${metaChipClassName}`}>
          <span className="font-semibold uppercase text-[10px] tracking-[0.08em]">Duration</span>
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
        >
          Update
        </button>

        <button
          type="button"
          className={`${deleteButtonClassName} text-white px-2 py-1 rounded-md inline-flex items-center gap-1 disabled:opacity-60`}
          onClick={() => onDelete?.(selectedVisualTrack)}
          disabled={selectedVisualTrack.isSaving}
        >
          <FaTimes />
          Delete
        </button>
      </div>
    </div>
  );
}
