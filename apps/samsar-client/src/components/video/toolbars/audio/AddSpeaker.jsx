import { useEffect, useMemo, useState } from 'react';
import CommonButton from '../../../common/CommonButton.tsx';
import SingleSelect from '../../../common/SingleSelect.jsx';
import SpeechProviderSelect from './SpeechProviderSelect.jsx';
import { getGoogleTTSVoiceDetails } from '../../../../hooks/useGoogleTTSSpeakers.js';
import { useAudioProviderAvailability } from '../../../../hooks/useAudioProviderAvailability.js';
import { filterTtsProviderOptionsForAudioAvailability } from '../../../../constants/audioProviderAvailability.js';

const TTS_PROVIDER_OPTIONS = [
  { value: 'OPENAI', label: 'OpenAI' },
  { value: 'ELEVENLABS', label: 'ElevenLabs' },
  { value: 'PLAYAI', label: 'Play.ht' },
  { value: 'GOOGLE', label: 'Google TTS' },
  { value: 'CUSTOM_TEXT_TO_SPEECH', label: 'Custom TTS' },
];

export default function AddSpeaker(props) {
  const {
    onAddNewSpeaker,
    onCancel,
    existingSpeakers = [],
    bgColor,
    text2Color,
    // Optional extras:
    playMusicPreviewForSpeaker,
    currentlyPlayingSpeaker,
    colorMode,
    sizeVariant = "default",
  } = props;
  const isSidebarPanel =
    sizeVariant === "sidebarCollapsed" || sizeVariant === "sidebarExpanded";

  const [speakerName, setSpeakerName] = useState('');
  const [error, setError] = useState('');


  const [ttsProvider, setTtsProvider] = useState(TTS_PROVIDER_OPTIONS[0]);
  const { audioAvailability } = useAudioProviderAvailability();
  const availableTtsProviderOptions = useMemo(
    () => filterTtsProviderOptionsForAudioAvailability(TTS_PROVIDER_OPTIONS, audioAvailability),
    [audioAvailability]
  );


  const [speakerType, setSpeakerType] = useState(null);
  const isSidebarCollapsed = sizeVariant === "sidebarCollapsed";
  const panelClass = isSidebarPanel
    ? `mt-3 rounded-lg ${bgColor} p-3 ${text2Color}`
    : `mt-3 rounded-lg border p-3 ${bgColor} ${text2Color}`;
  const fieldLabelClass = `mb-1 block text-[11px] font-semibold uppercase tracking-[0.08em] ${text2Color}`;
  const inputClass = `w-full rounded-lg ${bgColor} ${text2Color} px-3 py-2 text-sm leading-5 placeholder:text-slate-400 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-400/20`;
  const sidebarButtonClass = isSidebarPanel
    ? '!m-0 !min-h-[38px] !w-full !px-4 !py-2 text-xs'
    : '!m-0 !min-h-[38px] !px-4 !py-2 text-xs';
  const providerValue = ttsProvider?.value || availableTtsProviderOptions[0]?.value || '';
  const isGoogleProvider = providerValue === 'GOOGLE';

  useEffect(() => {
    if (availableTtsProviderOptions.length === 0) {
      setTtsProvider(null);
      setSpeakerType(null);
      return;
    }

    if (!availableTtsProviderOptions.some((option) => option.value === ttsProvider?.value)) {
      setTtsProvider(availableTtsProviderOptions[0]);
      setSpeakerType(null);
    }
  }, [availableTtsProviderOptions, ttsProvider?.value]);

  const getSelectedSpeakerDisplayName = () => (
    speakerType?.speakerCharacterName
    || speakerType?.shortLabel
    || speakerType?.label
    || speakerType?.name
    || speakerType?.value
    || ''
  );

  const handleTtsProviderChange = (selectedOption) => {
    setTtsProvider(selectedOption || availableTtsProviderOptions[0] || null);
    setSpeakerType(null);
    setError('');
  };

  const handleSpeakerChange = (selectedOption) => {
    setSpeakerType(selectedOption);
    setError('');
  };

  const handleSave = async () => {
    if (!providerValue) {
      setError('Please select a TTS Provider.');
      return;
    }
    if (!speakerType) {
      setError('Please select a speaker/voice.');
      return;
    }

    const normalizedSpeakerName = speakerName.trim() || (isGoogleProvider ? getSelectedSpeakerDisplayName().trim() : '');

    if (!normalizedSpeakerName) {
      setError('Please enter a speaker name.');
      return;
    }
    if (existingSpeakers.some(s => s.toLowerCase() === normalizedSpeakerName.toLowerCase())) {
      setError('Speaker name already exists.');
      return;
    }

    setError('');

    const newSpeaker = {
      speaker: speakerType.value,
      speakerVoiceId: speakerType.voiceId || speakerType.value,
      speakerLabel: speakerType.label || speakerType.name || speakerType.value,
      speakerShortLabel: speakerType.shortLabel,
      actor: normalizedSpeakerName,
      speakerCharacterName: normalizedSpeakerName,
      subType: 'character',
      provider: speakerType.provider || providerValue,
      languageCode: speakerType.languageCode,
      languageCodes: speakerType.languageCodes,
      speakerDetails:
        (speakerType.provider || providerValue) === 'GOOGLE'
          ? getGoogleTTSVoiceDetails(speakerType)
          : undefined,
    };

    onAddNewSpeaker(newSpeaker);
  };

  return (
    <div className={panelClass}>


      {error && <div className="text-red-500 text-xs mt-1 mb-2">{error}</div>}

      <div className="mb-3">
        <label className={fieldLabelClass}>Speaker name</label>
        <input
          type="text"
          className={inputClass}
          value={speakerName}
          onChange={(e) => setSpeakerName(e.target.value)}
          placeholder="Character name"
        />

      </div>

      <div className="mb-3">
        <label className={fieldLabelClass}>Provider</label>
        <SingleSelect
          name="ttsProvider"
          options={availableTtsProviderOptions}
          value={ttsProvider}
          onChange={handleTtsProviderChange}
          isSearchable={false}
          truncateLabels={isSidebarCollapsed}
        />
      </div>

      <div className="mb-2">
        <label className={fieldLabelClass}>Voice</label>
        <SpeechProviderSelect
          name="speakerVoice"
          placeholder={`Select ${ttsProvider?.label || 'provider'} voice...`}
          speakerType={speakerType}
          onSpeakerChange={handleSpeakerChange}
          playMusicPreviewForSpeaker={playMusicPreviewForSpeaker}
          currentlyPlayingSpeaker={currentlyPlayingSpeaker}
          colorMode={colorMode}
          compactLayout={isSidebarPanel}
          truncateLabels={isSidebarCollapsed}
          providerFilter={providerValue}
          showProviderLabel={false}
        />
      </div>

      <div className={`mt-3 ${isSidebarPanel ? 'grid grid-cols-1 gap-2' : 'flex justify-end space-x-2'}`}>
        <CommonButton
          type="button"
          onClick={onCancel}
          extraClasses={sidebarButtonClass}
        >
          Back
        </CommonButton>
        <CommonButton
          type="button"
          onClick={handleSave}
          extraClasses={sidebarButtonClass}
        >
          Save
        </CommonButton>
      </div>
    </div>
  );
}
