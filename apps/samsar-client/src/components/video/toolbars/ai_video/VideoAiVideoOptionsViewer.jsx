import { useUiLanguage } from '../../../../hooks/useUiLanguage.js';
import { translateText as uiText } from '../../../../utils/localization.js';
import { useState } from 'react';
import SecondaryButton from '../../../common/SecondaryButton.tsx';
import ModelAdapterSelect from '../../../common/ModelAdapterSelect.jsx';
import { useColorMode } from '../../../../contexts/ColorMode.jsx';
import { useDeploymentModelAvailability } from '../../../../hooks/useDeploymentModelAvailability.js';

export default function VideoAiVideoOptionsViewer(props) {
  useUiLanguage();
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
  const {
    isStandaloneDeployment,
    primaryAdapterByModel,
  } = useDeploymentModelAvailability();
  const soundEffectPromptClassName = `w-full text-sm p-1 bg-surface-raised text-fg border border-line rounded ${colorMode === 'dark' ? '' : 'placeholder:text-slate-400'}`;

  // Lip sync options
  const lipSyncOptions = [
    { label: uiText("HummingBird Lip Sync"), value: 'HUMMINGBIRDLIPSYNC' },
    { label: uiText("Latent Sync"), value: 'LATENTSYNC' },
    { label: uiText("Sync Lip Sync"), value: 'SYNCLIPSYNC' },
    { label: uiText("Kling Lip Sync"), value: 'KLINGLIPSYNC' },
    {label: uiText("Creatify Lip Sync"), value: 'CREATIFYLIPSYNC' }
  ];
  const [selectedLipSyncOption, setSelectedLipSyncOption] = useState(lipSyncOptions[0]);

  // NEW: Sound effect options + selection
  const soundEffectOptions = [
    { label: uiText("MMAudio V2"), value: 'MMAUDIOV2' },
    { label: uiText("Mirelo AI"), value: 'MIRELOAI' }
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
    ? uiText("Uploading video{value0}", { value0: Number.isFinite(currentUploadTask?.progressPercent) ? ` (${currentUploadTask.progressPercent}%)` : '' })
    : uiText("Uploaded video is being processed for this layer.");
  const uploadStatusMessage = currentUploadTask?.message
    || uiText("The editor will refresh automatically when the background task finishes.");

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
      <div className="text-sm mb-2">{uiText("Lip Sync")}</div>
      <div className={selectShellClass}>
        <ModelAdapterSelect
          options={lipSyncOptions}
          value={selectedLipSyncOption}
          onChange={setSelectedLipSyncOption}
          primaryAdapterByModel={primaryAdapterByModel}
          isStandaloneDeployment={isStandaloneDeployment}
          classNamePrefix="lipSyncSelect"
          isSearchable={false}
          compactLayout={!isSidebarCollapsed && isSidebarPanel}
          truncateLabels={isSidebarCollapsed}
        />
      </div>
      <SecondaryButton onClick={handleRequestLipSync} className={buttonExtraClass}>{uiText("Request Lip Sync")}</SecondaryButton>
    </div>
  ) : (
    <div className="mb-2 text-sm">
      <p>{uiText("Create a speech layer")}</p>
      <p>{uiText("to generate lipsync")}</p>
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
          >{uiText("Cancel Upload")}</SecondaryButton>
        </div>
      </div>
    );
  }

  if (isUserUploadedVideo) {
    return (
      <div className="flex flex-col items-center justify-center mt-2 mx-auto">
        <div className="mb-3 text-sm text-center">{uiText("Uploaded videos are fixed layer video artefacts.")}</div>
        <div className="mb-2 text-xs text-center opacity-80">{uiText("Remove the video to switch this layer back to AI generation.")}</div>
        <div className="mt-4 mb-2">
          <SecondaryButton
            onClick={handleDeleteLayer}
            extraClasses={`bg-red-500 hover:bg-red-600 ${buttonExtraClass}`.trim()}
          >{uiText("Delete Video Layer")}</SecondaryButton>
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
        <div className="text-sm mb-2">{uiText("Sound Effect")}</div>

        {/* NEW: Sound effect model select */}
        <div className={selectShellClass}>
          <ModelAdapterSelect
            options={soundEffectOptions}
            value={selectedSoundEffectOption}
            onChange={setSelectedSoundEffectOption}
            primaryAdapterByModel={primaryAdapterByModel}
            isStandaloneDeployment={isStandaloneDeployment}
            classNamePrefix="soundEffectSelect"
            isSearchable={false}
            compactLayout={!isSidebarCollapsed && isSidebarPanel}
            truncateLabels={isSidebarCollapsed}
          />
        </div>

        <SecondaryButton onClick={handleRequestSoundEffect} className={buttonExtraClass}>{uiText("Request Sound Effect")}</SecondaryButton>

        {showSoundEffectPrompt && (
          <div className="flex flex-col items-center mt-2 w-full">
            <textarea
              className={soundEffectPromptClassName}
              placeholder={uiText("Enter prompt for effect")}
              value={soundEffectPrompt}
              onChange={(e) => setSoundEffectPrompt(e.target.value)}
            />
            <SecondaryButton
              onClick={handleSoundEffectSubmit}
              extraClasses={`mt-2 ${buttonExtraClass}`.trim()}
            >{uiText("Submit")}</SecondaryButton>
          </div>
        )}
      </div>

      {/* Delete Button */}
      <div className="mt-4 mb-2">
        <SecondaryButton
          onClick={handleDeleteLayer}
          extraClasses={`bg-red-500 hover:bg-red-600 ${buttonExtraClass}`.trim()}
        >{uiText("Delete Video Layer")}</SecondaryButton>
      </div>
    </div>
  );
}
