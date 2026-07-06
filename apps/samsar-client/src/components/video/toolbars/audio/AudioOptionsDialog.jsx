import { useEffect, useState } from "react";
import SecondaryButton from "../../../common/SecondaryButton.tsx";

const AudioOptionsDialog = ({
  regenerateVideoSessionSubtitles,
  requestRealignLayers,
  removeAllSubtitles,
  sessionSubtitlesEnabled = true,
  applyAudioDucking = true,
  onApplyAudioDuckingChange,
  regenerateFramesBeforeRender = false,
  onRegenerateFramesBeforeRenderChange,
  submitRenderVideo,
  isRenderPending = false,
  isVideoGenerating = false,
  isUpdateLayerPending = false,
  closeDialog,
}) => {
  const [localApplyAudioDucking, setLocalApplyAudioDucking] = useState(Boolean(applyAudioDucking));
  const [localRegenerateFramesBeforeRender, setLocalRegenerateFramesBeforeRender] = useState(
    Boolean(regenerateFramesBeforeRender)
  );
  const [isDialogRenderPending, setIsDialogRenderPending] = useState(false);

  useEffect(() => {
    setLocalApplyAudioDucking(Boolean(applyAudioDucking));
  }, [applyAudioDucking]);

  useEffect(() => {
    setLocalRegenerateFramesBeforeRender(Boolean(regenerateFramesBeforeRender));
  }, [regenerateFramesBeforeRender]);

  const handleRegenerateSubs = () => {
    regenerateVideoSessionSubtitles();
    if (closeDialog) {
      closeDialog();
    }
  };

  const handleRealignLayers = () => {
    requestRealignLayers();
    if (closeDialog) {
      closeDialog();
    }
  };

  const handleRemoveAllSubtitles = () => {
    if (typeof removeAllSubtitles === 'function') {
      removeAllSubtitles();
    }
    if (closeDialog) {
      closeDialog();
    }
  };

  const handleAudioDuckingChange = (evt) => {
    const nextValue = Boolean(evt.target.checked);
    setLocalApplyAudioDucking(nextValue);
    if (typeof onApplyAudioDuckingChange === 'function') {
      onApplyAudioDuckingChange(nextValue);
    }
  };

  const handleRegenerateFramesBeforeRenderChange = (evt) => {
    const nextValue = Boolean(evt.target.checked);
    setLocalRegenerateFramesBeforeRender(nextValue);
    if (typeof onRegenerateFramesBeforeRenderChange === 'function') {
      onRegenerateFramesBeforeRenderChange(nextValue);
    }
  };

  const handleSessionSubtitlesChange = (evt) => {
    if (evt.target.checked) {
      handleRegenerateSubs();
    } else {
      handleRemoveAllSubtitles();
    }
  };

  const isRenderActionDisabled = Boolean(
    isRenderPending
    || isVideoGenerating
    || isUpdateLayerPending
    || isDialogRenderPending
    || typeof submitRenderVideo !== 'function'
  );

  const handleRender = async () => {
    if (isRenderActionDisabled) {
      return;
    }

    setIsDialogRenderPending(true);
    let didCloseDialog = false;
    try {
      const didRequestRender = await submitRenderVideo({
        applyAudioDucking: localApplyAudioDucking,
        regenerateFramesBeforeRender: localRegenerateFramesBeforeRender,
      });
      if (didRequestRender !== false && closeDialog) {
        didCloseDialog = true;
        closeDialog();
      }
    } finally {
      if (!didCloseDialog) {
        setIsDialogRenderPending(false);
      }
    }
  };

  return (
    <div>
      <div className="mb-4 mt-4">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={sessionSubtitlesEnabled}
            onChange={handleSessionSubtitlesChange}
            disabled={!sessionSubtitlesEnabled && typeof regenerateVideoSessionSubtitles !== 'function'}
          />
          <span>Session subtitles</span>
        </label>
      </div>
      <div className="mb-4 mt-4">
        <SecondaryButton onClick={handleRegenerateSubs}>
          Regenerate Subs
        </SecondaryButton>
      </div>
      {typeof removeAllSubtitles === 'function' && (
        <div className="mb-4">
          <SecondaryButton onClick={handleRemoveAllSubtitles}>
            Remove all subtitles
          </SecondaryButton>
          <div className="mt-1 text-xs opacity-75">
            Removes generated subtitle transcript items and queues frames for regeneration.
          </div>
        </div>
      )}
      <div className="mb-4">
        <button
          type="button"
          onClick={handleRealignLayers}
          className="text-sm font-semibold text-blue-500 underline underline-offset-4 hover:text-blue-400"
        >
          Realign layers
        </button>
      </div>

      <div className="mt-5 border-t border-slate-500/25 pt-4 text-left">
        <div className="text-sm font-semibold">Additional render options</div>
        <div className="mt-3 grid gap-3">
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={localApplyAudioDucking}
              onChange={handleAudioDuckingChange}
            />
            <span>
              <span className="block font-medium">Apply audio ducking</span>
              <span className="mt-1 block text-xs opacity-75">
                Lower music automatically while speech or sound effects are playing during render.
              </span>
            </span>
          </label>

          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={localRegenerateFramesBeforeRender}
              onChange={handleRegenerateFramesBeforeRenderChange}
            />
            <span>
              <span className="block font-medium">Regenerate frames before render</span>
              <span className="mt-1 block text-xs opacity-75">
                Apply the regenerate frames step to every layer before the next video render.
              </span>
            </span>
          </label>
        </div>

        <div className="mt-4">
          <button
            type="button"
            onClick={handleRender}
            disabled={isRenderActionDisabled}
            className="inline-flex min-h-[40px] min-w-24 items-center justify-center rounded-lg bg-gradient-to-r from-blue-500 to-blue-600 px-6 py-2 text-sm font-bold text-white shadow-[0_8px_18px_rgba(3,12,28,0.22)] transition-all duration-200 ease-out hover:-translate-y-[1px] hover:shadow-[0_10px_18px_rgba(15,23,42,0.14)] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0"
          >
            {isDialogRenderPending || isVideoGenerating || isRenderPending ? 'Rendering...' : 'Render'}
          </button>
          {isRenderPending || isVideoGenerating ? (
            <div className="mt-2 text-xs opacity-75">
              Render is already running for this session.
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
};

export default AudioOptionsDialog;
