import { useEffect, useMemo, useState } from 'react';
import TextareaAutosize from 'react-textarea-autosize';
import SingleSelect from '../../../common/SingleSelect.jsx';
import CommonButton from '../../../common/CommonButton.tsx';
import AddSpeaker from './AddSpeaker';
import { TTS_COMBINED_SPEAKER_TYPES } from '../../../../constants/Types.ts';
import { useAudioProviderAvailability } from '../../../../hooks/useAudioProviderAvailability.js';
import { filterSpeakersForAudioAvailability } from '../../../../constants/audioProviderAvailability.js';

function normalizeProvider(provider, speakerValue = '') {
  const rawProvider =
    typeof provider === 'string'
      ? provider
      : typeof provider?.value === 'string'
        ? provider.value
        : '';
  const normalizedProvider = rawProvider.trim().toUpperCase();

  if (
    normalizedProvider === 'OPENAI' ||
    normalizedProvider === 'ELEVENLABS' ||
    normalizedProvider === 'PLAYAI' ||
    normalizedProvider === 'GOOGLE' ||
    normalizedProvider === 'CUSTOM_TEXT_TO_SPEECH'
  ) {
    return normalizedProvider;
  }

  const matchedSpeaker = TTS_COMBINED_SPEAKER_TYPES.find((speaker) => speaker.value === speakerValue);
  return matchedSpeaker?.provider || 'OPENAI';
}

function normalizeMovieGenSpeaker(speaker = {}) {
  const speakerValue = typeof speaker?.speaker === 'string' ? speaker.speaker.trim() : '';
  const actor =
    typeof speaker?.actor === 'string' && speaker.actor.trim()
      ? speaker.actor.trim()
      : typeof speaker?.speakerCharacterName === 'string' && speaker.speakerCharacterName.trim()
        ? speaker.speakerCharacterName.trim()
        : speakerValue;

  return {
    ...speaker,
    speaker: speakerValue,
    actor,
    speakerCharacterName:
      typeof speaker?.speakerCharacterName === 'string' && speaker.speakerCharacterName.trim()
        ? speaker.speakerCharacterName.trim()
        : actor,
    speakerVoiceId:
      typeof speaker?.speakerVoiceId === 'string' && speaker.speakerVoiceId.trim()
        ? speaker.speakerVoiceId.trim()
        : speakerValue,
    speakerLabel:
      typeof speaker?.speakerLabel === 'string' && speaker.speakerLabel.trim()
        ? speaker.speakerLabel.trim()
        : speakerValue,
    provider: normalizeProvider(speaker?.provider, speakerValue),
    languageCode:
      typeof speaker?.languageCode === 'string' && speaker.languageCode.trim()
        ? speaker.languageCode.trim()
        : undefined,
    languageCodes: Array.isArray(speaker?.languageCodes) ? speaker.languageCodes : [],
    speakerDetails: speaker?.speakerDetails || null,
  };
}

function normalizeMovieGenSpeakers(speakers = []) {
  return Array.isArray(speakers) ? speakers.map(normalizeMovieGenSpeaker) : [];
}

export default function MovieSpeechProviderSelect(props) {
  const {
    movieGenSpeakers,
    updateMovieGenSpeakers,
    submitGenerateSpeech,
    speakerType,
    handleSpeakerChange,
    audioGenerationPending,
    bgColor,
    text2Color,
    colorMode,
    playMusicPreviewForSpeaker,
    currentlyPlayingSpeaker,
    sizeVariant = "default",
  } = props;
  const isSidebarPanel =
    sizeVariant === "sidebarCollapsed" || sizeVariant === "sidebarExpanded";
  const isSidebarCollapsed = sizeVariant === "sidebarCollapsed";
  const headerRowClass = isSidebarPanel
    ? "mb-3 flex flex-col gap-2"
    : "mb-3 flex items-center justify-between gap-3";
  const addSpeakerButtonClass = isSidebarPanel
    ? "!m-0 !min-h-[38px] !w-full !px-4 !py-2 text-xs"
    : "!m-0 !min-h-[38px] !px-4 !py-2 text-xs";
  const submitContainerClass = isSidebarPanel
    ? "mt-3"
    : "flex justify-center mt-3";

  const [showAddSpeakerForm, setShowAddSpeakerForm] = useState(false);

  // Local copy of speakers to handle additions
  const [localSpeakers, setLocalSpeakers] = useState(() =>
    normalizeMovieGenSpeakers(movieGenSpeakers)
  );

  useEffect(() => {
    setLocalSpeakers(normalizeMovieGenSpeakers(movieGenSpeakers));
  }, [movieGenSpeakers]);

  const { audioAvailability } = useAudioProviderAvailability();
  const availableLocalSpeakers = useMemo(
    () => filterSpeakersForAudioAvailability(localSpeakers, audioAvailability),
    [audioAvailability, localSpeakers]
  );

  // Toggle "Add Speaker" form
  const handleAddSpeakerClick = () => {
    setShowAddSpeakerForm(!showAddSpeakerForm);
  };

  // Called when user finishes AddSpeaker form successfully
  const handleSaveNewSpeaker = (newSpeaker) => {
    const normalizedNewSpeaker = normalizeMovieGenSpeaker(newSpeaker);
    const updated = [...localSpeakers, normalizedNewSpeaker];
    updateMovieGenSpeakers(updated);
    setLocalSpeakers(updated);
    handleSpeakerChange({
      value: normalizedNewSpeaker.speaker,
      label: normalizedNewSpeaker.actor,
      provider: normalizedNewSpeaker.provider,
      speaker: normalizedNewSpeaker.speaker,
      actor: normalizedNewSpeaker.actor,
      speakerCharacterName: normalizedNewSpeaker.speakerCharacterName,
      languageCode: normalizedNewSpeaker.languageCode,
      languageCodes: normalizedNewSpeaker.languageCodes,
      speakerVoiceId: normalizedNewSpeaker.speakerVoiceId,
      speakerLabel: normalizedNewSpeaker.speakerLabel,
      speakerDetails: normalizedNewSpeaker.speakerDetails,
    });
    setShowAddSpeakerForm(false);
  };

  // Build SingleSelect options from localSpeakers
  const speakerOptions = availableLocalSpeakers.map((item, index) => {
    const optionKey = `${item.provider}:${item.speaker}:${item.speakerCharacterName || item.actor}:${index}`;
    return {
      value: optionKey,
      label: item.actor,
      provider: item.provider,
      speaker: item.speaker,
      actor: item.actor,
      speakerCharacterName: item.speakerCharacterName,
      languageCode: item.languageCode,
      languageCodes: item.languageCodes,
      speakerVoiceId: item.speakerVoiceId,
      speakerLabel: item.speakerLabel,
      speakerDetails: item.speakerDetails,
    };
  });
  const selectedSpeakerOption = useMemo(() => {
    if (!speakerType) {
      return null;
    }

    const speakerValue = speakerType.speaker || speakerType.value;
    const providerValue = normalizeProvider(speakerType.provider, speakerValue);
    const speakerName = speakerType.speakerCharacterName || speakerType.label || speakerType.actor;

    return (
      speakerOptions.find((option) => (
        option.speaker === speakerValue
        && option.provider === providerValue
        && (!speakerName || option.speakerCharacterName === speakerName || option.actor === speakerName)
      ))
      || speakerOptions.find((option) => option.speaker === speakerValue && option.provider === providerValue)
      || null
    );
  }, [speakerOptions, speakerType]);

  // Submit handle
  const createSubmitGenerateSpeechRequest = (evt) => {
    evt.preventDefault();

    const formData = new FormData(evt.target);
    const promptText = formData.get('promptText');
    const speakerValue = speakerType?.speaker || speakerType?.value;
    const providerValue = normalizeProvider(speakerType?.provider, speakerValue);
    const speakerName = speakerType?.speakerCharacterName || speakerType?.label || speakerType?.actor;

    // Find matching speaker object
    const speakerData =
      availableLocalSpeakers.find((item) => (
        item.speaker === speakerValue
        && item.provider === providerValue
        && (!speakerName || item.speakerCharacterName === speakerName || item.actor === speakerName)
      ))
      || availableLocalSpeakers.find((item) => item.speaker === speakerValue && item.provider === providerValue);
    if (!speakerData) {
      
      return;
    }

    const body = {
      prompt: promptText,
      generationType: 'speech',
      speaker: speakerValue,
      ttsProvider: speakerData.provider,
      speakerCharacterName: speakerData.speakerCharacterName,
      languageCode: speakerData.languageCode,
      languageCodes: speakerData.languageCodes,
      speakerVoiceId: speakerData.speakerVoiceId,
      speakerLabel: speakerData.speakerLabel,
      speakerDetails: speakerData.speakerDetails,
      studioSpeechGeneration: true,
      audioBindingMode: 'unbounded',
      bindToLayer: false,
    };

    submitGenerateSpeech(body);
  };

  const noSpeakersYet = availableLocalSpeakers.length === 0;



  return (
    <div className="w-full">
      {/* Header row with Add Speaker button */}
      <div className={headerRowClass}>
        <label className={`text-sm font-bold ${text2Color}`}>Speakers</label>
        <CommonButton
          type="button"
          onClick={handleAddSpeakerClick}
          extraClasses={addSpeakerButtonClass}
        >
          {showAddSpeakerForm ? 'Back' : 'Add Speaker'}
        </CommonButton>
      </div>

      {showAddSpeakerForm ? (
        <AddSpeaker
          onAddNewSpeaker={handleSaveNewSpeaker}
          onCancel={() => setShowAddSpeakerForm(false)}
          existingSpeakers={localSpeakers.map((s) => s.speakerCharacterName || s.actor || s.speaker)}
          playMusicPreviewForSpeaker={playMusicPreviewForSpeaker}
          currentlyPlayingSpeaker={currentlyPlayingSpeaker}
          bgColor={bgColor}
          text2Color={text2Color}
          colorMode={colorMode}
          sizeVariant={sizeVariant}
        />
      ) : noSpeakersYet ? (
        // If no speakers are defined yet, simply show a message
        <div className={`text-sm italic ${text2Color}`}>
          Add a speaker
        </div>
      ) : (
        // Otherwise, show the actual speech generation form
        <form
          name="audioGenerateForm"
          className="w-full"
          onSubmit={createSubmitGenerateSpeechRequest}
        >
          {/* Speaker dropdown */}
          <div className="mb-2">
            <SingleSelect
              name="movieSpeaker"
              placeholder="Select speaker..."
              options={speakerOptions}
              value={
                selectedSpeakerOption
              }
              onChange={handleSpeakerChange}
              compactLayout={!isSidebarCollapsed && isSidebarPanel}
              truncateLabels={isSidebarCollapsed}
            />
          </div>

          {/* Prompt textarea */}
          <TextareaAutosize
            name="promptText"
            placeholder="Enter speech prompt text here"
            className={`w-full h-20 ${bgColor} ${text2Color} p-1 rounded border-2 border-gray-500`}
            minRows={3}
          />

          {/* Submit */}
          <div className={submitContainerClass}>
            <CommonButton
              type="submit"
              isPending={audioGenerationPending}
              extraClasses={isSidebarPanel ? 'w-full whitespace-normal text-center leading-tight' : ''}
            >
              Generate
            </CommonButton>
          </div>
        </form>
      )}
    </div>
  );
}
