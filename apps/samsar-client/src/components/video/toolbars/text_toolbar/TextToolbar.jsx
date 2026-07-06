import { useCallback, useEffect, useMemo, useState } from 'react';
import TextareaAutosize from 'react-textarea-autosize';
import { FaCheck, FaEye, FaEyeSlash, FaSlidersH, FaTrash } from 'react-icons/fa';

import TextStylePanel, {
  buildTextStyleDraft,
  mapTextDraftToConfig,
  mapTextDraftToStyleConfig,
  mapTextItemToDraft,
  persistTextStyleConfig,
} from '../../../common/TextStylePanel.jsx';
import CanvasActionOptionsDialog from '../../../editor/utils/CanvasActionOptionsDialog.jsx';
import { useAlertDialog } from '../../../../contexts/AlertDialogContext.jsx';

const TOOLBAR_GAP = 12;
const TOOLBAR_MIN_TOP = 8;

function getNumber(value, fallback = 0) {
  const parsedValue = Number(value);
  return Number.isFinite(parsedValue) ? parsedValue : fallback;
}

function clamp(value, min, max) {
  if (max < min) {
    return value;
  }
  return Math.max(min, Math.min(value, max));
}

function getTextItemBounds(activeTextItem, pos, stageZoomScale) {
  const config = activeTextItem?.config || {};
  const scale = Number.isFinite(Number(stageZoomScale)) ? Number(stageZoomScale) : 1;
  const width = Math.max(24, getNumber(config.width, 280)) * scale;
  const height = Math.max(24, getNumber(config.height, 120)) * scale;
  const positionLeft = Number.isFinite(Number(pos?.x)) ? Number(pos.x) - 30 : null;
  const positionTop = Number.isFinite(Number(pos?.y)) ? Number(pos.y) - 30 : null;
  const configLeft = getNumber(config.x, width / 2 / scale) * scale - width / 2;
  const configTop = getNumber(config.y, height / 2 / scale) * scale - height / 2;
  const left = positionLeft ?? configLeft;
  const top = positionTop ?? configTop;

  return {
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    centerX: left + width / 2,
    centerY: top + height / 2,
  };
}

function getToolbarPlacement(bounds, canvasDimensions, toolbarWidth, toolbarHeight) {
  const canvasWidth = getNumber(canvasDimensions?.width, 1024);
  const canvasHeight = getNumber(canvasDimensions?.height, 1024);
  const candidates = [
    {
      side: 'right',
      space: canvasWidth - bounds.right,
      left: bounds.right + TOOLBAR_GAP,
      top: clamp(bounds.centerY - toolbarHeight / 2, TOOLBAR_MIN_TOP, canvasHeight - toolbarHeight - TOOLBAR_MIN_TOP),
    },
    {
      side: 'left',
      space: bounds.left,
      left: bounds.left - toolbarWidth - TOOLBAR_GAP,
      top: clamp(bounds.centerY - toolbarHeight / 2, TOOLBAR_MIN_TOP, canvasHeight - toolbarHeight - TOOLBAR_MIN_TOP),
    },
    {
      side: 'bottom',
      space: canvasHeight - bounds.bottom,
      left: clamp(bounds.centerX - toolbarWidth / 2, TOOLBAR_MIN_TOP, canvasWidth - toolbarWidth - TOOLBAR_MIN_TOP),
      top: bounds.bottom + TOOLBAR_GAP,
    },
    {
      side: 'top',
      space: bounds.top,
      left: clamp(bounds.centerX - toolbarWidth / 2, TOOLBAR_MIN_TOP, canvasWidth - toolbarWidth - TOOLBAR_MIN_TOP),
      top: bounds.top - toolbarHeight - TOOLBAR_GAP,
    },
  ];
  const candidatesWithFit = candidates.map((candidate) => ({
    ...candidate,
    fits:
      candidate.side === 'left' || candidate.side === 'right'
        ? candidate.space >= toolbarWidth + TOOLBAR_GAP
        : candidate.space >= toolbarHeight + TOOLBAR_GAP,
  }));
  const fittingCandidates = candidatesWithFit.filter((candidate) => candidate.fits);
  const sortedCandidates = (fittingCandidates.length ? fittingCandidates : candidatesWithFit)
    .sort((a, b) => b.space - a.space);

  return sortedCandidates[0];
}

function getHiddenTogglePlacement(bounds, canvasDimensions) {
  const canvasWidth = getNumber(canvasDimensions?.width, 1024);
  const topCandidate = bounds.top - 46;
  return {
    left: clamp(bounds.centerX - 18, TOOLBAR_MIN_TOP, canvasWidth - 44),
    top: topCandidate >= TOOLBAR_MIN_TOP ? topCandidate : bounds.top + TOOLBAR_GAP,
  };
}

function EditTextOptionsDialog({
  initialDraft,
  editorVariant,
  onClose,
  onDraftChange,
  onSubmit,
  onDelete,
}) {
  const [dialogDraft, setDialogDraft] = useState(() => buildTextStyleDraft(initialDraft));

  const handleDialogDraftChange = (nextDraft) => {
    const resolvedDraft = buildTextStyleDraft(nextDraft);
    setDialogDraft(resolvedDraft);
    onDraftChange(resolvedDraft);
  };

  return (
    <CanvasActionOptionsDialog
      title="Text options"
      subtitle="Update text content, wrap behavior, bounding box, typography, and advanced layout."
      badge="Selected text"
      onClose={onClose}
      maxWidth="820px"
    >
      <div className="max-h-[68vh] overflow-y-auto pr-1">
        <TextStylePanel
          value={dialogDraft}
          onChange={handleDialogDraftChange}
          onSubmit={() => onSubmit(dialogDraft)}
          submitLabel="Update"
          submitDisabled={!`${dialogDraft.text || ''}`.trim()}
          editorVariant={editorVariant}
          header="Text"
          density="comfortable"
          layerActions={[
            {
              label: 'Delete',
              icon: 'trash',
              intent: 'danger',
              onClick: onDelete,
            },
          ]}
        />
      </div>
    </CanvasActionOptionsDialog>
  );
}

export default function TextToolbar(props) {
  const {
    pos,
    removeItem,
    colorMode,
    itemId,
    updateTargetTextActiveLayerConfig,
    activeItemList,
    onPersistTextStyle,
    stageZoomScale = 1,
    canvasDimensions,
    editorVariant = 'videoStudio',
  } = props;

  const { openAlertDialog, closeAlertDialog } = useAlertDialog();
  const isImageStudio = editorVariant === 'imageStudio';
  const activeTextItem = useMemo(
    () => activeItemList?.find((item) => item.id === itemId && item.type === 'text') || null,
    [activeItemList, itemId]
  );
  const activeTextItemSignature = useMemo(
    () => (activeTextItem ? JSON.stringify(mapTextItemToDraft(activeTextItem)) : null),
    [activeTextItem]
  );

  const [draft, setDraft] = useState(null);
  const [isDirty, setIsDirty] = useState(false);
  const [isToolbarHidden, setIsToolbarHidden] = useState(false);

  useEffect(() => {
    if (!activeTextItem) {
      setDraft(null);
      setIsDirty(false);
      setIsToolbarHidden(false);
      return;
    }

    setDraft(mapTextItemToDraft(activeTextItem));
    setIsDirty(false);
  }, [activeTextItem, activeTextItemSignature]);

  useEffect(() => {
    setIsToolbarHidden(false);
  }, [itemId]);

  const persistSharedStyle = useCallback(
    (draftToPersist) => {
      const normalizedDraft = buildTextStyleDraft(draftToPersist);
      persistTextStyleConfig(normalizedDraft);

      if (typeof onPersistTextStyle === 'function') {
        onPersistTextStyle(mapTextDraftToStyleConfig(normalizedDraft));
      }
    },
    [onPersistTextStyle]
  );

  const commitDraft = useCallback(
    (draftOverride = draft, options = {}) => {
      if (!draftOverride || !activeTextItem || typeof updateTargetTextActiveLayerConfig !== 'function') {
        return;
      }

      const normalizedDraft = buildTextStyleDraft(draftOverride);
      updateTargetTextActiveLayerConfig(itemId, {
        text: `${normalizedDraft.text || ''}`,
        styleValueSpace: 'raw',
        ...mapTextDraftToConfig(normalizedDraft),
      });
      persistSharedStyle(normalizedDraft);
      setDraft(normalizedDraft);
      setIsDirty(false);
      setIsToolbarHidden(true);

      if (options.closeDialog) {
        closeAlertDialog();
      }
    },
    [
      activeTextItem,
      closeAlertDialog,
      draft,
      itemId,
      persistSharedStyle,
      updateTargetTextActiveLayerConfig,
    ]
  );

  const updateDraft = useCallback((changes) => {
    setDraft((prev) => buildTextStyleDraft({ ...(prev || {}), ...changes }));
    setIsDirty(true);
  }, []);

  const handleDelete = useCallback(() => {
    closeAlertDialog();
    removeItem?.();
  }, [closeAlertDialog, removeItem]);

  if (!activeTextItem || !draft) {
    return null;
  }

  const toolbarSurface =
    colorMode === 'dark'
      ? 'bg-[#0f1629] border border-[#1f2a3d] text-slate-100 shadow-[0_18px_42px_rgba(2,6,23,0.45)]'
      : 'bg-white border border-slate-200 text-slate-900 shadow-[0_18px_36px_rgba(15,23,42,0.16)]';
  const fieldSurface =
    colorMode === 'dark'
      ? 'bg-[#111a2f] border border-[#1f2a3d] text-slate-100'
      : 'bg-slate-50 border border-slate-200 text-slate-900';
  const mutedText = colorMode === 'dark' ? 'text-slate-400' : 'text-slate-500';
  const actionButtonClass =
    colorMode === 'dark'
      ? 'bg-rose-500 text-white hover:bg-rose-400 disabled:bg-[#17233d] disabled:text-slate-500'
      : 'bg-rose-500 text-white hover:bg-rose-600 disabled:bg-slate-200 disabled:text-slate-400';
  const secondaryButtonClass =
    colorMode === 'dark'
      ? 'border border-[#273956] bg-[#111a2f] text-slate-100 hover:bg-[#172642]'
      : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50';
  const deleteButtonClass =
    colorMode === 'dark'
      ? 'bg-rose-500/12 border border-rose-400/30 text-rose-100 hover:bg-rose-500/18'
      : 'bg-rose-50 border border-rose-200 text-rose-700 hover:bg-rose-100';
  const wrapButtonClass = draft.autoWrap
    ? 'bg-blue-600 text-white hover:bg-blue-500'
    : secondaryButtonClass;
  const toolbarWidth = isImageStudio ? 330 : 310;
  const toolbarHeight = 205;
  const textBounds = getTextItemBounds(activeTextItem, pos, stageZoomScale);
  const toolbarPlacement = getToolbarPlacement(
    textBounds,
    canvasDimensions,
    toolbarWidth,
    toolbarHeight
  );
  const hiddenTogglePlacement = getHiddenTogglePlacement(textBounds, canvasDimensions);

  const showTextOptionsDialog = () => {
    openAlertDialog(
      <EditTextOptionsDialog
        initialDraft={draft}
        editorVariant={editorVariant}
        onClose={closeAlertDialog}
        onDraftChange={updateDraft}
        onSubmit={(nextDraft) => commitDraft(nextDraft, { closeDialog: true })}
        onDelete={handleDelete}
      />,
      undefined,
      true,
      { hideCloseButton: true, hideBorder: true, fullBleed: true, centerContent: true }
    );
  };

  if (isToolbarHidden) {
    return (
      <button
        type="button"
        onClick={() => setIsToolbarHidden(false)}
        className={`absolute inline-flex h-9 w-9 items-center justify-center rounded-full border text-sm shadow-lg transition ${secondaryButtonClass}`}
        style={{
          left: hiddenTogglePlacement.left,
          top: hiddenTogglePlacement.top,
          zIndex: 100,
        }}
        title="Show text toolbar"
        aria-label="Show text toolbar"
      >
        <FaEye />
      </button>
    );
  }

  return (
    <div
      key={`toolbar_${pos.id}`}
      className={`${toolbarSurface} absolute rounded-[20px] p-3`}
      style={{
        left: toolbarPlacement.left,
        top: toolbarPlacement.top,
        width: `${toolbarWidth}px`,
        maxWidth: 'calc(100vw - 24px)',
        maxHeight: 'min(62vh, 360px)',
        overflowY: 'auto',
        zIndex: 100,
      }}
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
            Text
          </div>
          <div className={`mt-0.5 text-[11px] ${mutedText}`}>
            {draft.autoWrap ? 'Wrap on' : 'Wrap off'} · {draft.width} x {draft.height}
          </div>
        </div>
      </div>

      <TextareaAutosize
        minRows={2}
        value={draft.text || ''}
        onChange={(event) => updateDraft({ text: event.target.value })}
        className={`mb-3 min-h-[76px] w-full resize-none rounded-xl px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-400/20 ${fieldSurface}`}
        placeholder="Edit text"
      />

      <button
        type="button"
        onClick={() => updateDraft({ autoWrap: !draft.autoWrap })}
        className={`mb-2 flex h-9 w-full items-center justify-between rounded-xl px-3 text-sm font-semibold transition ${wrapButtonClass}`}
        title="Toggle word wrap"
      >
        <span>Word Wrap</span>
        <span className="text-xs">{draft.autoWrap ? 'On' : 'Off'}</span>
      </button>

      <div className="grid grid-cols-[40px_minmax(0,1fr)_minmax(0,1fr)_40px] gap-2">
        <button
          type="button"
          onClick={() => setIsToolbarHidden(true)}
          className={`inline-flex h-10 items-center justify-center rounded-xl text-sm transition ${secondaryButtonClass}`}
          title="Hide text toolbar"
          aria-label="Hide text toolbar"
        >
          <FaEyeSlash />
        </button>
        <button
          type="button"
          onClick={showTextOptionsDialog}
          className={`inline-flex h-10 items-center justify-center gap-2 rounded-xl px-3 text-sm font-semibold transition ${secondaryButtonClass}`}
          title="Text options"
        >
          <FaSlidersH />
          <span>Options</span>
        </button>
        <button
          type="button"
          onClick={() => commitDraft()}
          disabled={!isDirty || !`${draft.text || ''}`.trim()}
          className={`inline-flex h-10 items-center justify-center gap-2 rounded-xl px-3 text-sm font-semibold transition ${actionButtonClass}`}
          title="Update text"
        >
          <FaCheck />
          <span>Update</span>
        </button>
        <button
          type="button"
          onClick={handleDelete}
          className={`inline-flex h-10 items-center justify-center rounded-xl text-sm transition ${deleteButtonClass}`}
          title="Delete text"
          aria-label="Delete text"
        >
          <FaTrash />
        </button>
      </div>
    </div>
  );
}
