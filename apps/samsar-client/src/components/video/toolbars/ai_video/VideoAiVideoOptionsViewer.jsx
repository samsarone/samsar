import { useState } from 'react';
import SecondaryButton from '../../../common/SecondaryButton.tsx';
import SingleSelect from '../../../common/SingleSelect.jsx'; // <-- Update path as needed
import { useColorMode } from '../../../../contexts/ColorMode.jsx';

export default function VideoAiVideoOptionsViewer(props) {
  const {
    currentLayer,
    removeVideoLayer,
    currentLayerHasSpeechLayer,
    requestLipSyncToSpeech,
    requestAddSyncedSoundEffect,
    sizeVariant = "default",
  } = props;
  const isSidebarPanel =
    sizeVariant === "sidebarCollapsed" || sizeVariant === "sidebarExpanded";
  const isSidebarCollapsed = sizeVariant === "sidebarCollapsed";
  const selectShellClass = isSidebarPanel ? "mb-2 w-full" : "w-48 mb-2";
  const buttonExtraClass = isSidebarPanel
    ? "w-full whitespace-normal text-center leading-tight"
    : "";

  const [showSoundEffectPrompt, setShowSoundEffectPrompt] = useState(false);
  const [soundEffectPrompt, setSoundEffectPrompt] = useState('');
  const { colorMode } = useColorMode();
  const soundEffectPromptClassName = colorMode === 'dark'
    ? 'w-full text-sm p-1 bg-[#111a2f] text-slate-100 border border-[#1f2a3d] rounded'
    : 'w-full text-sm p-1 bg-white text-slate-900 border border-slate-200 rounded placeholder:text-slate-400';

  // Lip sync options
  const lipSyncOptions = [
    { label: 'HummingBird Lip Sync', value: 'HUMMINGBIRDLIPSYNC' },
    { label: 'Latent Sync', value: 'LATENTSYNC' },
    { label: 'Sync Lip Sync', value: 'SYNCLIPSYNC' },
    { label: 'Kling Lip Sync', value: 'KLINGLIPSYNC' },
    {label: 'Creatify Lip Sync', value: 'CREATIFYLIPSYNC' }
  ];
  const [selectedLipSyncOption, setSelectedLipSyncOption] = useState(lipSyncOptions[0]);

  // NEW: Sound effect options + selection
  const soundEffectOptions = [
    { label: 'MMAudio V2', value: 'MMAUDIOV2' },
    { label: 'Mirelo AI', value: 'MIRELOAI' }
  ];
  const [selectedSoundEffectOption, setSelectedSoundEffectOption] = useState(soundEffectOptions[0]);
  const currentUploadTask = currentLayer?.userVideoUploadTask || null;
  const isUserUploadPending = Boolean(
    currentLayer?.userVideoGenerationPending
    || currentUploadTask?.status === 'UPLOADING'
    || currentUploadTask?.status === 'PROCESSING'
  );
  const isUserUploadedVideo = Boolean(currentLayer?.hasUserVideoLayer || currentLayer?.userVideoLayer);
  const uploadStatusLabel = currentUploadTask?.status === 'UPLOADING'
    ? `Uploading video${Number.isFinite(currentUploadTask?.progressPercent) ? ` (${currentUploadTask.progressPercent}%)` : ''}`
    : 'Uploaded video is being processed for this layer.';
  const uploadStatusMessage = currentUploadTask?.message
    || 'The editor will refresh automatically when the background task finishes.';

  const handleDeleteLayer = () => {
    if (removeVideoLayer) {
      removeVideoLayer(currentLayer);
    }
  };

  const handleRequestLipSync = () => {
    if (requestLipSyncToSpeech && selectedLipSyncOption) {
      requestLipSyncToSpeech(selectedLipSyncOption.value);
    }
  };

  const handleRequestSoundEffect = () => {
    setShowSoundEffectPrompt((prev) => !prev);
  };

  const handleSoundEffectSubmit = () => {
    if (requestAddSyncedSoundEffect) {
      const payload = {
        prompt: soundEffectPrompt,
        // Pass the selected model value with the request
        model: selectedSoundEffectOption?.value
      };
      requestAddSyncedSoundEffect(payload);
    }
    setShowSoundEffectPrompt(false);
    setSoundEffectPrompt('');
  };

  const lipSyncOptionViewer = currentLayerHasSpeechLayer ? (
    <div className="mb-4 flex flex-col items-center">
      <div className="text-sm mb-2">Lip Sync</div>
      <div className={selectShellClass}>
        <SingleSelect
          options={lipSyncOptions}
          value={selectedLipSyncOption}
          onChange={setSelectedLipSyncOption}
          classNamePrefix="lipSyncSelect"
          isSearchable={false}
          compactLayout={!isSidebarCollapsed && isSidebarPanel}
          truncateLabels={isSidebarCollapsed}
        />
      </div>
      <SecondaryButton onClick={handleRequestLipSync} className={buttonExtraClass}>
        Request Lip Sync
      </SecondaryButton>
    </div>
  ) : (
    <div className="mb-2 text-sm">
      <p>Create a speech layer</p>
      <p>to generate lipsync</p>
    </div>
  );

  if (isUserUploadPending) {
    return (
      <div className="flex flex-col items-center justify-center mt-2 mx-auto">
        <div className="mb-3 text-sm text-center">
          {uploadStatusLabel}
        </div>
        <div className="mb-2 text-xs text-center opacity-80">
          {uploadStatusMessage}
        </div>
        <div className="mt-4 mb-2">
          <SecondaryButton
            onClick={handleDeleteLayer}
            extraClasses={`bg-red-500 hover:bg-red-600 ${buttonExtraClass}`.trim()}
          >
            Cancel Upload
          </SecondaryButton>
        </div>
      </div>
    );
  }

  if (isUserUploadedVideo) {
    return (
      <div className="flex flex-col items-center justify-center mt-2 mx-auto">
        <div className="mb-3 text-sm text-center">
          Uploaded videos are fixed layer video artefacts.
        </div>
        <div className="mb-2 text-xs text-center opacity-80">
          Remove the video to switch this layer back to AI generation.
        </div>
        <div className="mt-4 mb-2">
          <SecondaryButton
            onClick={handleDeleteLayer}
            extraClasses={`bg-red-500 hover:bg-red-600 ${buttonExtraClass}`.trim()}
          >
            Delete Video Layer
          </SecondaryButton>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center mt-2 mx-auto">
      {/* Lip Sync Section */}
      {lipSyncOptionViewer}

      {/* Sound Effect Section */}
      <div className="mt-2 mb-2 flex flex-col items-center">
        <div className="text-sm mb-2">Sound Effect</div>

        {/* NEW: Sound effect model select */}
        <div className={selectShellClass}>
          <SingleSelect
            options={soundEffectOptions}
            value={selectedSoundEffectOption}
            onChange={setSelectedSoundEffectOption}
            classNamePrefix="soundEffectSelect"
            isSearchable={false}
            compactLayout={!isSidebarCollapsed && isSidebarPanel}
            truncateLabels={isSidebarCollapsed}
          />
        </div>

        <SecondaryButton onClick={handleRequestSoundEffect} className={buttonExtraClass}>
          Request Sound Effect
        </SecondaryButton>

        {showSoundEffectPrompt && (
          <div className="flex flex-col items-center mt-2 w-full">
            <textarea
              className={soundEffectPromptClassName}
              placeholder="Enter prompt for effect"
              value={soundEffectPrompt}
              onChange={(e) => setSoundEffectPrompt(e.target.value)}
            />
            <SecondaryButton
              onClick={handleSoundEffectSubmit}
              extraClasses={`mt-2 ${buttonExtraClass}`.trim()}
            >
              Submit
            </SecondaryButton>
          </div>
        )}
      </div>

      {/* Delete Button */}
      <div className="mt-4 mb-2">
        <SecondaryButton
          onClick={handleDeleteLayer}
          extraClasses={`bg-red-500 hover:bg-red-600 ${buttonExtraClass}`.trim()}
        >
          Delete Video Layer
        </SecondaryButton>
      </div>
    </div>
  );
}
