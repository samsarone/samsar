import { useEffect, useState } from 'react';
import TextareaAutosize from 'react-textarea-autosize';
import { FaSlidersH } from 'react-icons/fa';

import TextStylePanel, {
  buildTextStyleDraft,
  loadStoredTextStyleConfig,
  mapTextDraftToConfig,
  mapTextDraftToStyleConfig,
  persistTextStyleConfig,
} from '../../../common/TextStylePanel.jsx';
import CanvasActionOptionsDialog from '../../../editor/utils/CanvasActionOptionsDialog.jsx';
import { useAlertDialog } from '../../../../contexts/AlertDialogContext.jsx';
import { useColorMode } from '../../../../contexts/ColorMode.jsx';

const STORAGE_KEYS = {
  addText: 'selected_text_config_addText',
};

function TextOptionsDialogContent({
  initialDraft,
  editorVariant,
  onClose,
  onDraftChange,
  onSubmit,
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
      subtitle="Text style preferences are saved and reused for new text layers."
      badge="Canvas action"
      onClose={onClose}
      maxWidth="820px"
    >
      <TextStylePanel
        value={dialogDraft}
        onChange={handleDialogDraftChange}
        onSubmit={() => onSubmit(dialogDraft)}
        submitLabel="Add"
        submitDisabled={!`${dialogDraft.text || ''}`.trim()}
        editorVariant={editorVariant}
        header="Text"
        density="comfortable"
      />
    </CanvasActionOptionsDialog>
  );
}

export default function AddText(props) {
  const {
    setAddText,
    submitAddText,
    addText,
    textConfig,
    setTextConfig,
    editorVariant = 'videoStudio',
    isExpandedView = false,
  } = props;

  const { colorMode } = useColorMode();
  const { openAlertDialog, closeAlertDialog } = useAlertDialog();
  const draft = buildTextStyleDraft({
    text: addText || '',
    ...(textConfig || {}),
  });

  const handleDraftChange = (nextDraft) => {
    const resolvedDraft = buildTextStyleDraft(nextDraft);
    setAddText(resolvedDraft.text);
    setTextConfig((prev) => ({
      ...(prev || {}),
      ...mapTextDraftToStyleConfig(resolvedDraft),
    }));
  };

  const handleSubmit = (draftOverride = draft, options = {}) => {
    const resolvedDraft = buildTextStyleDraft(draftOverride);
    const normalizedText = `${resolvedDraft.text || ''}`.trim();
    if (!normalizedText) return;

    submitAddText?.({
      text: normalizedText,
      config: mapTextDraftToConfig(resolvedDraft),
    });

    if (options.closeDialog) {
      closeAlertDialog();
    }
  };

  useEffect(() => {
    const storedStyleConfig = loadStoredTextStyleConfig();
    const storedAddText = localStorage.getItem(STORAGE_KEYS.addText);

    setTextConfig((prev) => ({
      ...(prev || {}),
      ...storedStyleConfig,
    }));

    if (storedAddText) {
      setAddText(storedAddText);
    }
  }, [setAddText, setTextConfig]);

  useEffect(() => {
    persistTextStyleConfig(draft);
    localStorage.setItem(STORAGE_KEYS.addText, draft.text || '');
  }, [draft]);

  const showTextOptionsDialog = () => {
    openAlertDialog(
      <TextOptionsDialogContent
        initialDraft={draft}
        editorVariant={editorVariant}
        onClose={closeAlertDialog}
        onDraftChange={handleDraftChange}
        onSubmit={(nextDraft) => handleSubmit(nextDraft, { closeDialog: true })}
      />,
      undefined,
      true,
      { hideCloseButton: true, hideBorder: true, fullBleed: true, centerContent: true }
    );
  };

  const fieldSurface =
    colorMode === 'dark'
      ? 'bg-[#111a2f] border border-[#1f2a3d] text-slate-100'
      : 'bg-white border border-slate-200 text-slate-900';
  const compactSurface =
    colorMode === 'dark'
      ? 'bg-[#111a2f] border border-[#24314d] text-slate-100'
      : 'bg-slate-50 border border-slate-200 text-slate-900';
  const mutedText = colorMode === 'dark' ? 'text-slate-400' : 'text-slate-500';
  const secondaryButtonClass = colorMode === 'dark'
    ? 'border border-[#273956] bg-[#111a2f] text-slate-100 hover:bg-[#172642]'
    : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50';

  if (!isExpandedView) {
    return (
      <div className="p-2">
        <div className={`rounded-xl p-3 ${compactSurface}`}>
          <div className="mb-3">
            <div className="text-sm font-semibold">Text</div>
            <div className={`mt-1 text-[11px] ${mutedText}`}>
              Uses saved style preferences
            </div>
          </div>

          <TextareaAutosize
            minRows={2}
            value={draft.text}
            onChange={(event) => handleDraftChange({ ...draft, text: event.target.value })}
            placeholder="Enter text"
            className={`mb-3 min-h-[72px] w-full resize-none rounded-xl px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-400/20 ${fieldSurface}`}
          />

          <button
            type="button"
            onClick={showTextOptionsDialog}
            className={`mb-2 flex w-full items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold transition ${secondaryButtonClass}`}
          >
            <FaSlidersH />
            Options
          </button>
          <button
            type="button"
            onClick={() => handleSubmit()}
            disabled={!`${draft.text || ''}`.trim()}
            className="w-full rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:bg-slate-500"
          >
            Add
          </button>
        </div>
      </div>
    );
  }

  return (
    <TextStylePanel
      value={draft}
      onChange={handleDraftChange}
      onSubmit={() => handleSubmit()}
      submitLabel="Add"
      submitDisabled={!`${draft.text || ''}`.trim()}
      editorVariant={editorVariant}
      header="Text"
      density="comfortable"
    />
  );
}
