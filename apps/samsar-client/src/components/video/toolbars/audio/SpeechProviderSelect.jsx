// components/common/SpeechProviderSelect.js
import { useMemo } from 'react';
import Select, { components } from 'react-select';
import { FaPlay, FaPause } from 'react-icons/fa';
import { TTS_COMBINED_SPEAKER_TYPES } from '../../../../constants/Types.ts';
import {
  mergeGoogleTTSSpeakers,
  useGoogleTTSSpeakers,
} from '../../../../hooks/useGoogleTTSSpeakers.js';
import { useAudioProviderAvailability } from '../../../../hooks/useAudioProviderAvailability.js';
import { filterSpeakersForAudioAvailability } from '../../../../constants/audioProviderAvailability.js';

export default function SpeechProviderSelect(props) {
  const {
    name,
    placeholder = 'Select voice...',
    speakerType,
    onSpeakerChange,
    playMusicPreviewForSpeaker,
    currentlyPlayingSpeaker,
    colorMode,
    compactLayout = false,
    truncateLabels = false,
    providerFilter = null,
    showProviderLabel = true,
    isSearchable = true,
  } = props;

  // Styles for select and dropdowns
  const formSelectBgColor = colorMode === 'dark' ? '#030712' : '#f3f4f6';
  const formSelectTextColor = colorMode === 'dark' ? '#f3f4f6' : '#111827';
  const formSelectSelectedTextColor = colorMode === 'dark' ? '#f3f4f6' : '#111827';
  const formSelectHoverColor = colorMode === 'dark' ? '#1f2937' : '#2563EB';
  const { googleSpeakers, isLoading, error } = useGoogleTTSSpeakers();
  const combinedSpeakerTypes = useMemo(
    () => mergeGoogleTTSSpeakers(TTS_COMBINED_SPEAKER_TYPES, googleSpeakers),
    [googleSpeakers]
  );
  const { audioAvailability } = useAudioProviderAvailability();
  const deploymentFilteredSpeakerTypes = useMemo(
    () => filterSpeakersForAudioAvailability(combinedSpeakerTypes, audioAvailability),
    [audioAvailability, combinedSpeakerTypes]
  );
  const normalizedProviderFilter =
    typeof providerFilter === 'string' ? providerFilter.trim().toUpperCase() : '';
  const isGoogleProviderSelected = normalizedProviderFilter === 'GOOGLE';
  const availableSpeakerTypes = normalizedProviderFilter
    ? deploymentFilteredSpeakerTypes.filter((speaker) => speaker.provider === normalizedProviderFilter)
    : deploymentFilteredSpeakerTypes;

  const getOptionLabel = (speaker = {}) => {
    if (truncateLabels) {
      return speaker.shortLabel || speaker.compactLabel || speaker.abbreviatedLabel || speaker.label || speaker.name || speaker.value;
    }
    return speaker.label || speaker.name || speaker.value;
  };
  const longestSpeakerLabelLength = availableSpeakerTypes.reduce(
    (maxLength, speaker) => Math.max(maxLength, String(getOptionLabel(speaker) || '').length),
    0
  );
  const shouldUseMultilineValue =
    !truncateLabels && (compactLayout || longestSpeakerLabelLength > 18);
  const controlMinHeight = shouldUseMultilineValue ? 52 : 38;

  // Build speaker options from combined list
  const speakerOptions = availableSpeakerTypes.map((speaker) => {
    const isPlaying =
      currentlyPlayingSpeaker
      && currentlyPlayingSpeaker.value === speaker.value
      && currentlyPlayingSpeaker.provider === speaker.provider;

    const handleIconClick = (evt) => {
      evt.stopPropagation();
      if (playMusicPreviewForSpeaker) {
        playMusicPreviewForSpeaker(evt, speaker);
      }
    };

    const IconComponent = isPlaying ? <FaPause /> : <FaPlay />;

 
    return {
      ...speaker,
      icon: IconComponent,
      onClick: handleIconClick,
    };
  });


  // Custom Option Component to include play/pause icons and provider
  const Option = (props) => {
    const { data } = props;
    const isCurrentPreview =
      currentlyPlayingSpeaker
      && currentlyPlayingSpeaker.value === data.value
      && currentlyPlayingSpeaker.provider === data.provider;
    return (
      <components.Option {...props}>
        <div className="flex items-center justify-between">
          <span className={truncateLabels ? 'min-w-0 flex-1 truncate' : 'min-w-0 flex-1 whitespace-normal break-words'}>
            {getOptionLabel(data)}
            {showProviderLabel && (
              <small className="text-xs text-gray-500">
                {' '}
                ({data.provider.toLowerCase()})
              </small>
            )}
          </span>
          {(data.previewURL || data.previewRequiresAuth) && data.icon && (
            <span
              className="ml-1.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded border border-slate-400/40 text-[9px]"
              onClick={(evt) => data.onClick(evt)}
              aria-label={isCurrentPreview ? 'Pause preview' : 'Play preview'}
            >
              {data.icon}
            </span>
          )}
        </div>
      </components.Option>
    );
  };

  const SingleValue = (props) => (
    <components.SingleValue {...props}>
      <span className={truncateLabels ? 'block truncate leading-tight' : 'whitespace-normal break-words leading-tight'}>
        {getOptionLabel(props.data)}{' '}
      </span>
      {showProviderLabel && !truncateLabels && (
        <small className="text-xs text-gray-500 whitespace-normal break-words">
          ({props.data.provider.toLowerCase()})
        </small>
      )}
    </components.SingleValue>
  );

  return (
    <div className="w-full min-w-0">
      <Select
        name={name}
        placeholder={placeholder}
        isSearchable={isSearchable}
        isLoading={isGoogleProviderSelected && isLoading}
        value={speakerType}
        onChange={onSpeakerChange}
        options={speakerOptions}
        noOptionsMessage={() => {
          if (isGoogleProviderSelected && isLoading) {
            return 'Loading Google voices...';
          }
          if (isGoogleProviderSelected && error) {
            return 'Google voices are unavailable.';
          }
          return 'No voices available.';
        }}
        menuPortalTarget={typeof document !== 'undefined' ? document.body : undefined}
        menuPosition="fixed"
        components={{ Option, SingleValue }}
        styles={{
          container: (provided) => ({
            ...provided,
            width: '100%',
            minWidth: 0,
          }),
          menu: (provided) => ({
            ...provided,
            backgroundColor: formSelectBgColor,
            zIndex: 11050,
          }),
          menuPortal: (provided) => ({
            ...provided,
            zIndex: 11050,
          }),
          singleValue: (provided) => ({
            ...provided,
            color: formSelectTextColor,
            maxWidth: '100%',
            marginLeft: 0,
            marginRight: 0,
            overflow: shouldUseMultilineValue ? 'visible' : 'hidden',
            textOverflow: shouldUseMultilineValue ? 'clip' : 'ellipsis',
            whiteSpace: shouldUseMultilineValue ? 'normal' : 'nowrap',
            lineHeight: shouldUseMultilineValue ? '1.2' : provided.lineHeight,
            position: shouldUseMultilineValue ? 'static' : provided.position,
            transform: shouldUseMultilineValue ? 'none' : provided.transform,
          }),
          valueContainer: (provided) => ({
            ...provided,
            paddingTop: shouldUseMultilineValue ? 6 : provided.paddingTop,
            paddingBottom: shouldUseMultilineValue ? 6 : provided.paddingBottom,
            overflow: 'visible',
            minWidth: 0,
          }),
          control: (provided, state) => ({
            ...provided,
            backgroundColor: formSelectBgColor,
            borderColor: state.isFocused ? '#007BFF' : '#ced4da',
            '&:hover': {
              borderColor: state.isFocused ? '#007BFF' : '#ced4da',
            },
            boxShadow: state.isFocused
              ? '0 0 0 0.2rem rgba(0, 123, 255, 0.25)'
              : null,
            minHeight: `${controlMinHeight}px`,
            height: shouldUseMultilineValue ? 'auto' : '38px',
            width: '100%',
            minWidth: 0,
          }),
          option: (provided, state) => ({
            ...provided,
            backgroundColor: formSelectBgColor,
            color: state.isSelected
              ? formSelectSelectedTextColor
              : formSelectTextColor,
            whiteSpace: 'normal',
            wordBreak: 'break-word',
            '&:hover': {
              backgroundColor: formSelectHoverColor,
            },
          }),
        }}
      />
    </div>
  );
}
