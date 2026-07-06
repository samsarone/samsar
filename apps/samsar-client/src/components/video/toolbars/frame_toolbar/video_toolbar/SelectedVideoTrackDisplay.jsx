import { useEffect, useMemo, useState } from 'react';
import { FaBolt, FaCheck, FaCut, FaPlus, FaTimes } from 'react-icons/fa';
import { useColorMode } from '../../../../../contexts/ColorMode.jsx';

const DEFAULT_SPEED_MULTIPLIER = 1.5;
const MIN_SPEED_MULTIPLIER = 1.25;
const MAX_SPEED_MULTIPLIER = 8;
const SPEED_MULTIPLIER_STEP = 0.25;
const DISPLAY_FRAMES_PER_SECOND = 30;

function getToolLabel(activeTool) {
  if (!activeTool) {
    return 'Choose action';
  }

  if (activeTool.type === 'REMOVE') {
    return 'Clip';
  }

  return `${activeTool.speedMultiplier || DEFAULT_SPEED_MULTIPLIER}x`;
}

function formatFrameRange(rangeFrames = [], framesPerSecond = DISPLAY_FRAMES_PER_SECOND) {
  if (!Array.isArray(rangeFrames) || rangeFrames.length < 2) {
    return '0.0s to 0.0s';
  }

  const startSeconds = Math.max(0, Number(rangeFrames[0]) || 0) / framesPerSecond;
  const endSeconds = Math.max(startSeconds, Number(rangeFrames[1]) || 0) / framesPerSecond;

  return `${startSeconds.toFixed(1)}s to ${endSeconds.toFixed(1)}s`;
}



function ActionButton({
  children,
  isActive = false,
  onClick,
  title,
  ariaLabel,
  colorMode,
  disabled = false,
}) {
  const surfaceClassName = isActive
    ? (colorMode === 'dark'
      ? 'bg-cyan-500/22 border-cyan-300/55 text-cyan-100 shadow-[0_0_18px_rgba(34,211,238,0.18)]'
      : 'bg-sky-100 border-sky-400/55 text-sky-700')
    : (colorMode === 'dark'
      ? 'bg-[#111a2f]/72 border-[#1f2a3d] text-slate-300 hover:bg-[#16213a]'
      : 'bg-white/80 border-slate-200 text-slate-600 hover:bg-slate-100');

  return (
    <button
      type="button"
      title={title}
      aria-label={ariaLabel || title}
      disabled={disabled}
      onClick={onClick}
      className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border text-[11px] transition disabled:opacity-50 ${surfaceClassName}`}
    >
      <span className="inline-flex items-center justify-center">{children}</span>
    </button>
  );
}

export default function SelectedVideoTrackDisplay(props) {
  const {
    selectedVideoTrack,
    activeTool,
    onSelectTool,
    onSpeedMultiplierChange,
    selectedRangeFrames = [0, 1],
    draftOperations = [],
    onApplySelection,
    onAddDraft,
    onClearDrafts,
    onApplyDrafts,
    isBusy = false,
  } = props;
  const { colorMode } = useColorMode();
  const [feedbackMessage, setFeedbackMessage] = useState('');

  useEffect(() => {
    setFeedbackMessage('');
  }, [selectedVideoTrack?.layerId]);

  const isSpeedToolActive = activeTool?.type === 'SPEED';
  const isCutToolActive = activeTool?.type === 'REMOVE';
  const resolvedSpeedMultiplier = isSpeedToolActive
    ? Math.min(
      MAX_SPEED_MULTIPLIER,
      Math.max(MIN_SPEED_MULTIPLIER, Number(activeTool?.speedMultiplier) || DEFAULT_SPEED_MULTIPLIER)
    )
    : DEFAULT_SPEED_MULTIPLIER;

  const statusTitle = useMemo(() => {
    if (feedbackMessage) {
      return feedbackMessage;
    }
    if (selectedVideoTrack?.videoEditPending) {
      return selectedVideoTrack.videoEditTaskMessage || 'Processing';
    }
    if (selectedVideoTrack?.videoEditStatus === 'FAILED') {
      return selectedVideoTrack.videoEditError || 'Edit failed';
    }
    if (draftOperations.length > 0) {
      return `${draftOperations.length} staged change${draftOperations.length === 1 ? '' : 's'} ready to apply.`;
    }
    if (!activeTool) {
      return 'Choose an action.';
    }
    return `Selection ready for ${getToolLabel(activeTool)} on ${formatFrameRange(selectedRangeFrames)}.`;
  }, [
    activeTool,
    draftOperations.length,
    feedbackMessage,
    selectedRangeFrames,
    selectedVideoTrack?.videoEditError,
    selectedVideoTrack?.videoEditPending,
    selectedVideoTrack?.videoEditStatus,
    selectedVideoTrack?.videoEditTaskMessage,
  ]);

  const statusDotClassName = feedbackMessage
    ? (colorMode === 'dark' ? 'bg-amber-300 shadow-[0_0_10px_rgba(252,211,77,0.6)]' : 'bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.45)]')
    : selectedVideoTrack?.videoEditPending
      ? 'bg-cyan-400 shadow-[0_0_12px_rgba(34,211,238,0.65)]'
      : selectedVideoTrack?.videoEditStatus === 'FAILED'
        ? 'bg-rose-400 shadow-[0_0_10px_rgba(251,113,133,0.55)]'
        : draftOperations.length > 0
          ? (colorMode === 'dark' ? 'bg-amber-300 shadow-[0_0_10px_rgba(252,211,77,0.45)]' : 'bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.4)]')
          : activeTool
            ? (colorMode === 'dark' ? 'bg-sky-300 shadow-[0_0_10px_rgba(125,211,252,0.45)]' : 'bg-sky-500 shadow-[0_0_8px_rgba(14,165,233,0.35)]')
            : (colorMode === 'dark' ? 'bg-slate-600' : 'bg-slate-300');

  const toolbarSurfaceClassName = colorMode === 'dark'
    ? 'bg-[#0b1224]/68 border border-[#1f2a3d] backdrop-blur-md'
    : 'bg-white/72 border border-slate-200 backdrop-blur-md';
  const inputSurfaceClassName = colorMode === 'dark'
    ? 'bg-[#111a2f]/82 border border-[#1f2a3d] text-slate-100'
    : 'bg-white/88 border border-slate-200 text-slate-700';
  const secondaryButtonClassName = colorMode === 'dark'
    ? 'border border-[#31405e] bg-[#111a2f]/78 text-slate-200 hover:bg-[#16213a]'
    : 'border border-slate-200 bg-white/85 text-slate-700 hover:bg-slate-100';
  const destructiveButtonClassName = colorMode === 'dark'
    ? 'border border-rose-500/40 bg-rose-500/10 text-rose-200 hover:bg-rose-500/18'
    : 'border border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100';
  const primaryButtonClassName = colorMode === 'dark'
    ? 'bg-cyan-400 text-[#041420] hover:bg-cyan-300'
    : 'bg-sky-600 text-white hover:bg-sky-500';
  const showClearDrafts = draftOperations.length > 0;

  const applyButtonTitle = showClearDrafts ? 'Apply staged edits' : 'Apply current edit';
  const canApplyCurrentSelection = Boolean(activeTool);
  const canApplyAnyEdit = showClearDrafts || canApplyCurrentSelection;

  const handleAddDraftClick = async () => {
    const response = await onAddDraft?.();
    if (response?.authRequired) {
      return;
    }
    if (response?.success === false) {
      setFeedbackMessage(response.error || 'Unable to stage this selection.');
      return;
    }
    setFeedbackMessage('Selection staged. Click Apply when ready.');
  };

  const handleApplyClick = async () => {
    const response = showClearDrafts
      ? await onApplyDrafts?.()
      : await onApplySelection?.();

    if (response?.authRequired) {
      return;
    }
    if (response?.success === false) {
      setFeedbackMessage(response.error || 'Unable to apply this edit.');
      return;
    }
    setFeedbackMessage('');
  };

  return (
    <div className={`flex min-h-[44px] w-full max-w-full items-center gap-2 overflow-hidden rounded-2xl px-2 py-2 ${toolbarSurfaceClassName}`}>
      <div
        className={`h-2.5 w-2.5 shrink-0 rounded-full ${statusDotClassName}`}
        title={statusTitle}
        aria-label={statusTitle}
      />

      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
        <ActionButton
          colorMode={colorMode}
          isActive={isSpeedToolActive}
          disabled={isBusy}
          onClick={() => onSelectTool?.({
            type: 'SPEED',
            speedMultiplier: resolvedSpeedMultiplier,
          })}
          title="Fast edit"
        >
          <FaBolt />
        </ActionButton>

        <ActionButton
          colorMode={colorMode}
          isActive={isCutToolActive}
          disabled={isBusy}
          onClick={() => onSelectTool?.({
            type: 'REMOVE',
            speedMultiplier: 1,
          })}
          title="Clip edit"
        >
          <FaCut />
        </ActionButton>

        {isSpeedToolActive && (
          <>
            <input
              type="range"
              min={MIN_SPEED_MULTIPLIER}
              max={MAX_SPEED_MULTIPLIER}
              step={SPEED_MULTIPLIER_STEP}
              value={resolvedSpeedMultiplier}
              disabled={isBusy}
              onChange={(event) => onSpeedMultiplierChange?.(Number(event.target.value))}
              className="h-1.5 w-[108px] cursor-pointer accent-cyan-400"
              title="Speed multiplier"
            />
            <input
              type="number"
              min={MIN_SPEED_MULTIPLIER}
              max={MAX_SPEED_MULTIPLIER}
              step={SPEED_MULTIPLIER_STEP}
              value={resolvedSpeedMultiplier}
              disabled={isBusy}
              onChange={(event) => onSpeedMultiplierChange?.(Number(event.target.value))}
              className={`h-8 w-[68px] rounded-lg px-2 py-1 text-[11px] ${inputSurfaceClassName}`}
              title="Speed multiplier"
            />
          </>
        )}

        <button
          type="button"
          title="Stage edit"
          aria-label="Stage edit"
          disabled={isBusy || !activeTool}
          onClick={handleAddDraftClick}
          className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[11px] transition disabled:opacity-50 ${secondaryButtonClassName}`}
        >
          <FaPlus />
        </button>

        <button
          type="button"
          title={applyButtonTitle}
          aria-label={applyButtonTitle}
          disabled={isBusy || !canApplyAnyEdit}
          onClick={handleApplyClick}
          className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[11px] transition disabled:opacity-50 ${primaryButtonClassName}`}
        >
          <FaCheck />
        </button>

        {showClearDrafts ? (
          <button
            type="button"
            title="Clear staged edits"
            aria-label="Clear staged edits"
            disabled={isBusy}
            onClick={onClearDrafts}
            className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[11px] transition disabled:opacity-50 ${destructiveButtonClassName}`}
          >
            <FaTimes />
          </button>
        ) : null}
      </div>
    </div>
  );
}
