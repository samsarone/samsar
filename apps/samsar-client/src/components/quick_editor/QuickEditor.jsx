import { useState, useEffect, useRef, useMemo } from 'react';
import { FaPlay, FaPause, FaArrowRight, FaChevronDown } from 'react-icons/fa6';
import { useUser } from '../../contexts/UserContext.jsx';
import ace from 'ace-builds';
import { getFontFamilyForLanguage } from '../../utils/language.jsx';
import { ANIMATION_OPTIONS } from '../../utils/animation.jsx';
import MusicLibraryHome from '../library/audio/MusicLibraryHome.jsx';
import { useColorMode } from '../../contexts/ColorMode.jsx';
import 'ace-builds/src-noconflict/mode-json';
import 'ace-builds/src-noconflict/theme-monokai';

import 'ace-builds/src-noconflict/ext-language_tools';
import 'ace-builds/src-noconflict/ext-beautify';
import TextareaAutosize from 'react-textarea-autosize';
import CombinedAudioSelect from './CombinedAudioSelect.jsx';
import axios from 'axios';
import SecondaryButton from '../common/SecondaryButton.tsx';
import SingleSelect from '../common/SingleSelect.jsx';
import CommonButton from '../common/CommonButton.tsx';
import { useParams } from 'react-router-dom';
import AssistantHome from '../assistant/AssistantHome.jsx';
import { getHeaders } from '../../utils/web.jsx';
import ProgressIndicator from '../oneshot_editor/ProgressIndicator.jsx';

import { useAlertDialog } from '../../contexts/AlertDialogContext.jsx';
import { useNavigate } from 'react-router-dom';
import AuthContainer, { AUTH_DIALOG_OPTIONS } from '../auth/AuthContainer.jsx';
import { INFINITE_ZOOM_ANIMATION_OPTIONS } from '../../utils/animation.jsx';
import './editor.css';
import {
  IMAGE_GENERAITON_MODEL_TYPES,
  RECRAFT_IMAGE_STYLES,
  IDEOGRAM_IMAGE_STYLES,
  MUSIC_PROVIDERS,
  VIDEO_GENERATION_MODEL_TYPES,
  TTS_COMBINED_SPEAKER_TYPES
} from '../../constants/Types.ts';
import {
  fetchGoogleTTSPreviewBlobUrl,
  getGoogleTTSVoiceDetails,
  mergeGoogleTTSSpeakers,
  useGoogleTTSSpeakers,
} from '../../hooks/useGoogleTTSSpeakers.js';
import { useAudioProviderAvailability } from '../../hooks/useAudioProviderAvailability.js';
import { useDeploymentModelAvailability } from '../../hooks/useDeploymentModelAvailability.js';
import {
  filterMusicProvidersForAudioAvailability,
  filterSpeakersForAudioAvailability,
} from '../../constants/audioProviderAvailability.js';
import { filterOptionsForDeploymentModelValues } from '../../utils/deploymentProviders.js';

import {
  COSMOS3_SUPER_MODEL_KEY,
  formatVideoDurationLabel,
  getVideoModelDurationUnitsForFramesPerSecond,
  IMAGE_MODEL_PRICES,
  SPEECH_MODEL_PRICES,
  TRANSLATION_MODEL_PRICES,
  MUSIC_MODEL_PRICES,
  VIDEO_MODEL_PRICES,
} from '../../constants/ModelPrices.jsx';
import ThemeViewer from './ThemeViewer.jsx';


ace.config.set('useWorker', false);

const aspectRatioOptions = [
  { value: '1:1', label: '1:1' },
  { value: '16:9', label: '16:9' },
  { value: '9:16', label: '9:16' },
];

// Define music options
const addMusicOptions = [
  { value: 'autogen', label: 'Autogenerate new track' },
  { value: 'selectLibrary', label: 'Select from Library' },
  { value: 'autoSelectLibrary', label: 'Autoselect from Library' },
];

const PROCESSOR_API_URL = import.meta.env.VITE_PROCESSOR_API;

function pickDuration(units, target) {
  if (!Array.isArray(units) || units.length === 0) {
    return target;
  }
  for (const unit of units) {
    if (unit >= target) {
      return unit;
    }
  }
  return units[units.length - 1];
}

export default function QuickEditor() {
  const { id } = useParams();
  const { openAlertDialog, closeAlertDialog } = useAlertDialog();
  const navigate = useNavigate();
  const { user } = useUser();

  // State variables
  const [videoType, setVideoType] = useState({ value: 'Slideshow', label: 'Narrative' });
  const [animation, setAnimation] = useState({ value: 'preset_short_animation', label: 'Preset Short Animation' });
  const [duration, setDuration] = useState({ value: 'auto', label: 'Auto' });
  const [customDuration, setCustomDuration] = useState('');
  const [sessionDetails, setSessionDetails] = useState(null);
  const [isGenerationPending, setIsGenerationPending] = useState(false);
  const [showResultDisplay, setShowResultDisplay] = useState(false);
  const [expressGenerationStatus, setExpressGenerationStatus] = useState(null);
  const [videoLink, setVideoLink] = useState(null);
  const [showDetails, setShowDetails] = useState(false);
  const [showTheme, setShowTheme] = useState(false);
  const [musicPrompt] = useState('');
  const [theme] = useState('');
  const [sessionMessages, setSessionMessages] = useState([]);
  useState(false);
  const [isAssistantQueryGenerating, setIsAssistantQueryGenerating] = useState(false);
  useState(false);

  const { colorMode } = useColorMode();
  const { googleSpeakers } = useGoogleTTSSpeakers();
  const combinedSpeakerTypes = useMemo(
    () => mergeGoogleTTSSpeakers(TTS_COMBINED_SPEAKER_TYPES, googleSpeakers),
    [googleSpeakers]
  );
  const { audioAvailability } = useAudioProviderAvailability();
  const {
    isDockerInstall: isDockerModelFilteringEnabled,
    textToVideoImageModelValues,
  } = useDeploymentModelAvailability();
  const deploymentSpeakerTypes = useMemo(
    () => filterSpeakersForAudioAvailability(combinedSpeakerTypes, audioAvailability),
    [audioAvailability, combinedSpeakerTypes]
  );
  const availableMusicProviders = useMemo(
    () => filterMusicProvidersForAudioAvailability(MUSIC_PROVIDERS, audioAvailability),
    [audioAvailability]
  );

  useState(() => {
    const storedValue = localStorage.getItem('advancedSettingsVisible');
    return storedValue ? JSON.parse(storedValue) : false;
  });

  const defaultSpeaker = deploymentSpeakerTypes.find(
    (speaker) => speaker.value === 'alloy'
  ) || deploymentSpeakerTypes[0] || null;

  const [speakerType, setSpeakerType] = useState(() => {
    const storedSpeaker = localStorage.getItem('defaultSpeaker');
    return storedSpeaker ? deploymentSpeakerTypes.find((sp) => sp.value === storedSpeaker) : defaultSpeaker;
  });

  const [promptList, setPromptList] = useState('');
  const [speechLanguage] = useState({ value: 'eng', label: 'English' });
  const [subtitlesLanguage] = useState({ value: 'eng', label: 'English' });
  const [errorState, setErrorState] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [creditsPreview, setCreditsPreview] = useState(0);
  const [showCreditsBreakdown, setShowCreditsBreakdown] = useState(false);
  const [sceneCutoffType, setSceneCutoffType] = useState({ value: 'auto', label: 'Auto' });

  const [customThemeText, setCustomThemeText] = useState('');
  useState('');

  // -------------------------------
  // Music / Speech control states:
  // -------------------------------
  const [musicRequired, setMusicRequired] = useState(true);
  const [speechRequired, setSpeechRequired] = useState(true);
  const [normalizeSpeech, setNormalizeSpeech] = useState(true);
  const [addSubtitlesRequired, setAddSubtitlesRequired] = useState(true);
  const [addTranscriptionsRequired, setAddTranscriptionsRequired] = useState(true);

  const [speechStyle] = useState({ value: 'Narrative', label: 'Narrative' });

  const subtitleFontOptions = [
    { value: 'Arial', label: 'Arial' },
    { value: 'Times New Roman', label: 'Times New Roman' },
    { value: 'Roboto', label: 'Roboto' },
    { value: 'Neonderthaw', label: 'Neonderthaw ' },
    { value: 'Monoton', label: 'Monoton ' },
    { value: 'Bungee Outline', label: 'Bungee Outline ' },
    { value: 'Orbitron', label: 'Orbitron ' },
    { value: 'Rampart One', label: 'Rampart One ' },
  ];

  const [wordAnimation, setWordAnimation] = useState({ value: 'system_preset', label: 'System preset (Default)' });
  const wordAnimationOptions = [
    { value: 'none', label: 'No Animation' },
    { value: 'highlight', label: 'Highlight current word' },
    { value: 'system_preset', label: 'System preset (Default)' },
  ];

  const [selectedMusicProvider, setSelectedMusicProvider] = useState(() => {
    return availableMusicProviders.length > 0
      ? { value: availableMusicProviders[0].key, label: availableMusicProviders[0].name }
      : null;
  });

  const textColor = colorMode === 'dark' ? 'text-white' : 'text-black';


  const bgNeutral2Color = colorMode === 'dark' ? 'bg-neutral-950' : 'bg-neutral-50';

  const bgGray1Color = colorMode === 'dark' ? 'bg-gray-950' : 'bg-gray-50';
  const bgGray2Color = colorMode === 'dark' ? 'bg-gray-900' : 'bg-gray-100';

  const bgGray4Color = colorMode === 'dark' ? 'bg-gray-700' : 'bg-gray-300';

  const bgStone1Color = colorMode === 'dark' ? 'bg-stone-950' : 'bg-stone-50';



  useEffect(() => {
    // Whenever id changes, reset all relevant states:
    resetAllStates();

    // Then fetch session details:
    const headers = getHeaders();
    axios
      .get(`${PROCESSOR_API_URL}/quick_session/details?sessionId=${id}`, headers)
      .then((res) => {
        const data = res.data || {};
        setSessionDetails(data);

        // If there's a stored video link:
        if (data.videoLink) {
          setVideoLink(data.videoLink);
        }
        // If any existing assistant messages:
        if (data.sessionMessages) {
          setSessionMessages(data.sessionMessages);
        }

        // If there's a parent theme or derived theme, load them into state:
        if (data.parentJsonTheme) {
          try {
            const pretty = JSON.stringify(JSON.parse(data.parentJsonTheme), null, 2);
            setParentJsonTheme(pretty);
            setThemeType('parentJson');
          } catch  {
            // fallback
            setParentJsonTheme(data.parentJsonTheme);
            setThemeType('parentJson');
          }
        }
        if (data.derivedJsonTheme) {
          try {
            const pretty = JSON.stringify(JSON.parse(data.derivedJsonTheme), null, 2);
            setDerivedJsonTheme(pretty);
            setThemeType('derivedJson');
          } catch  {
            // fallback
            setDerivedJsonTheme(data.derivedJsonTheme);
            setThemeType('derivedJson');
          }
        }

        // If no parent/derived theme => fallback to 'basic'
        if (!data.parentJsonTheme && !data.derivedJsonTheme) {
          setThemeType('basic');
        }

        // If the server says the video is generating => poll
        if (data.videoGenerationPending) {
          startQuickGenerationPoll();
          setShowResultDisplay(true);
        }

        // Also if the session had text lines saved:
        if (data.textList) {
          const joined = data.textList.join('\n');
          setPromptList(joined);

          // Recalc word/char count
          const words = joined.split(/\s+/).filter(Boolean).length;
          setWordCount(words);
          setCharacterCount(joined.length);
        }
      })
      .catch(() => {

      });
  }, [id]);

  // Helper to reset states
  function resetAllStates() {
    setSessionDetails(null);
    setIsGenerationPending(false);
    setShowResultDisplay(false);
    setExpressGenerationStatus(null);
    setVideoLink(null);

    setPromptList('');
    setWordCount(0);
    setCharacterCount(0);

    // Reset theme states
    setThemeType('basic');
    setBasicTextTheme('');
    setCustomThemeText('');
    setParentJsonTheme(null);
    setDerivedJsonTheme(null);
    setDerivedTextTheme('');

    // Reset banner
    setBannerText('');
    setAddBannerToComposition(false);
    setShowBannerTextDisplay(false);

    // Reset main toggles
    setSpeechRequired(true);
    setMusicRequired(true);
    setNormalizeSpeech(true);
    setAddSubtitlesRequired(true);
    setAddTranscriptionsRequired(true);

    // Reset generative video
    setGenerativeVideoRequired(false);
    setSelectedVideoGenerationModel(null);
    setUseEndFrame(true);

    // Reset any leftover error states
    setErrorState(false);
    setErrorMessage('');
    setSessionMessages([]);
    setIsAssistantQueryGenerating(false);
  }

  // For infinite-zoom we only want certain models in the Image dropdown:
  const imageModelOptions = useMemo(() => {
    const deploymentModels = isDockerModelFilteringEnabled
      ? filterOptionsForDeploymentModelValues(
          IMAGE_GENERAITON_MODEL_TYPES,
          textToVideoImageModelValues,
          (model) => model.key
        )
      : IMAGE_GENERAITON_MODEL_TYPES;
    if (videoType.value === 'Infinitezoom') {
      return deploymentModels.filter(
        (model) =>
          model.key === 'FLUX1PRO'
      ).map((model) => ({
        value: model.key,
        label: model.name,
      }));
    } else {
      return deploymentModels
        .filter((model) => model.isExpressModel === true)
        .map((model) => ({
          value: model.key,
          label: model.name,
        }));
    }
  }, [isDockerModelFilteringEnabled, textToVideoImageModelValues, videoType]);

  const [selectedImageModel, setSelectedImageModel] = useState(() => {
    const defaultModel = localStorage.getItem('defaultModel');
    return imageModelOptions.find((model) => model.value === defaultModel) || imageModelOptions[0] || null;
  });

  useEffect(() => {
    setSelectedImageModel((current) => {
      const selectedOption = imageModelOptions.find((model) => model.value === current?.value);
      if (selectedOption) return selectedOption;
      const defaultModel = localStorage.getItem('defaultModel');
      return imageModelOptions.find((model) => model.value === defaultModel) || imageModelOptions[0] || null;
    });
  }, [imageModelOptions]);

  const [subtitleFont, setSubtitleFont] = useState(() => {
    const defaultFont = localStorage.getItem('defaultSubtitleFont');
    if (defaultFont) {
      return subtitleFontOptions.find((font) => font.value === defaultFont);
    } else {
      return subtitleFontOptions[0];
    }
  });

  const [aspectRatio, setAspectRatio] = useState(() => {
    const defaultAspectRatio = localStorage.getItem('defaultAspectRatio');
    if (defaultAspectRatio) {
      return aspectRatioOptions.find((ratio) => ratio.value === defaultAspectRatio);
    } else {
      return aspectRatioOptions[0];
    }
  });

  const [selectedImageStyle, setSelectedImageStyle] = useState(null);
  const [, setWordCount] = useState(0);
  const [characterCount, setCharacterCount] = useState(0);
  useState(false);
  useState(null);
  useState('');
  const [showBannerTextDisplay, setShowBannerTextDisplay] = useState(false);
  const [addBannerToComposition, setAddBannerToComposition] = useState(false);
  const [bannerText, setBannerText] = useState('');
  const [basicTextTheme, setBasicTextTheme] = useState('');
  useState(null);
  const [derivedTextTheme, setDerivedTextTheme] = useState(null);
  const [parentJsonTheme, setParentJsonTheme] = useState(null);
  const [derivedJsonTheme, setDerivedJsonTheme] = useState(null);
  useState(false);
  useState(false);
  useState(null);
  useState(false);

  const [themeType, setThemeType] = useState('basic');

  const [currentlyPlayingSpeaker, setCurrentlyPlayingSpeaker] = useState(null);
  const audioRef = useRef(null);
  const audioObjectUrlRef = useRef(null);

  // ------------------------------------
  // New fields for generative video logic
  // ------------------------------------
  const [generativeVideoRequired, setGenerativeVideoRequired] = useState(() => {
    const storedValue = localStorage.getItem('defaultGenerativeVideoRequired');
    return storedValue ? JSON.parse(storedValue) : false;
  });

  const [selectedVideoGenerationModel, setSelectedVideoGenerationModel] = useState(() => {
    const storedModel = localStorage.getItem('defaultSelectedGenerativeModel');
    return storedModel ? JSON.parse(storedModel) : null;
  });

  const [useEndFrame, setUseEndFrame] = useState(() => {
    const storedUseEndFrame = localStorage.getItem('defaultUseEndFrame');
    return storedUseEndFrame ? JSON.parse(storedUseEndFrame) : true; // default true
  });

  const [selectedMusicOption, setSelectedMusicOption] = useState(() => {
    const defaultOptionValue = localStorage.getItem('defaultSelectedMusicGenerationMode');
    if (defaultOptionValue) {
      return addMusicOptions.find((option) => option.value === defaultOptionValue) || addMusicOptions[0];
    } else {
      return addMusicOptions[0];
    }
  });
  const [previousMusicOption, setPreviousMusicOption] = useState(null);
  const [selectedMusicTrack, setSelectedMusicTrack] = useState(null);

  // Filter the available VIDEO_GENERATION_MODEL_TYPES based on the current videoType
  const videoGenerationModelOptions = useMemo(() => {
    const expressPriority = {
      'VEO3.1I2V': 0,
      'VEO3.1I2VFAST': 1,
      COSMOS3SUPERI2V: 2,
    };
    const sortByExpressPriority = (models = []) =>
      [...models].sort((a, b) => {
        const aPriority = Object.prototype.hasOwnProperty.call(expressPriority, a?.key)
          ? expressPriority[a.key]
          : Number.MAX_SAFE_INTEGER;
        const bPriority = Object.prototype.hasOwnProperty.call(expressPriority, b?.key)
          ? expressPriority[b.key]
          : Number.MAX_SAFE_INTEGER;
        if (aPriority !== bPriority) return aPriority - bPriority;
        return 0;
      });

    if (videoType.value === 'Infinitezoom') {
      return VIDEO_GENERATION_MODEL_TYPES.filter((m) => m.isTransitionModel);
    } else {
      // Default to Slideshow => show isExpressModel
      return sortByExpressPriority(
        VIDEO_GENERATION_MODEL_TYPES.filter((m) => m.isExpressModel)
      );
    }
  }, [videoType]);

  const durationOptionsForSelectedVideoModel = useMemo(() => {
    const defaultDurationOptions = [
      { label: 'Auto', value: 'auto' },
      { label: '2 Seconds', value: '2' },
      { label: '5 Seconds', value: '5' },
      { label: '10 Seconds', value: '10' },
      { label: '20 Seconds', value: '20' },
      { label: 'Custom', value: 'custom' },
    ];

    if (selectedVideoGenerationModel?.value !== COSMOS3_SUPER_MODEL_KEY) {
      return defaultDurationOptions;
    }

    const units = getVideoModelDurationUnitsForFramesPerSecond(
      COSMOS3_SUPER_MODEL_KEY,
      user?.videoFramesPerSecond,
    );
    return [
      { label: 'Auto', value: 'auto' },
      ...units.map((unit) => ({
        label: `${formatVideoDurationLabel(unit)} Seconds`,
        value: String(unit),
      })),
    ];
  }, [selectedVideoGenerationModel?.value, user?.videoFramesPerSecond]);

  useEffect(() => {
    const hasSelectedDuration = durationOptionsForSelectedVideoModel.some(
      (option) => option.value === duration.value
    );
    if (!hasSelectedDuration) {
      setDuration(durationOptionsForSelectedVideoModel[0]);
    }
  }, [duration.value, durationOptionsForSelectedVideoModel]);

  // Handlers for checkboxes
  const handleMusicCheckboxChange = (e) => {
    const checked = e.target.checked;
    setMusicRequired(checked);
    if (!checked) {
      setSelectedMusicTrack(null);
    }
  };

  const handleSpeechCheckboxChange = (e) => {
    const checked = e.target.checked;
    setSpeechRequired(checked);
    if (!checked) {
      setNormalizeSpeech(false);
      setAddSubtitlesRequired(false);
      setAddTranscriptionsRequired(false);
    } else {
      setNormalizeSpeech(true);
      setAddSubtitlesRequired(true);
      setAddTranscriptionsRequired(true);
    }
  };

  useEffect(() => {
    const storedSpeaker = localStorage.getItem('defaultSpeaker');
    const matchedSpeaker = storedSpeaker
      ? deploymentSpeakerTypes.find((sp) => sp.value === storedSpeaker)
      : null;

    const selectedSpeakerStillAvailable =
      speakerType && deploymentSpeakerTypes.some((sp) => (
        sp.value === speakerType.value && sp.provider === speakerType.provider
      ));

    if (!selectedSpeakerStillAvailable) {
      setSpeakerType(matchedSpeaker || defaultSpeaker || null);
      return;
    }

    if (matchedSpeaker && speakerType?.value === matchedSpeaker.value && speakerType?.provider !== matchedSpeaker.provider) {
      setSpeakerType(matchedSpeaker);
    }
  }, [defaultSpeaker, deploymentSpeakerTypes, speakerType]);

  useEffect(() => {
    if (availableMusicProviders.length === 0) {
      setSelectedMusicProvider(null);
      return;
    }

    if (!selectedMusicProvider || !availableMusicProviders.some((provider) => provider.key === selectedMusicProvider.value)) {
      const fallbackProvider = availableMusicProviders[0];
      setSelectedMusicProvider({ value: fallbackProvider.key, label: fallbackProvider.name });
    }
  }, [availableMusicProviders, selectedMusicProvider]);

  const stopSpeakerPreview = () => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    if (audioObjectUrlRef.current) {
      URL.revokeObjectURL(audioObjectUrlRef.current);
      audioObjectUrlRef.current = null;
    }
    setCurrentlyPlayingSpeaker(null);
  };

  // Filter speaker dropdown
  const speakerOptions = useMemo(() => {
    let filteredSpeakers;
    if (speechStyle.value === 'Narrative') {
      filteredSpeakers = deploymentSpeakerTypes;
    } else if (speechStyle.value === 'Conversational') {
      filteredSpeakers = deploymentSpeakerTypes.filter(
        (sp) => sp.Style && sp.Style === 'Conversational'
      );
    } else {
      filteredSpeakers = deploymentSpeakerTypes;
    }

    return filteredSpeakers.map((speaker) => {
      const isPlaying = currentlyPlayingSpeaker && currentlyPlayingSpeaker.value === speaker.value;
      const iconComponent = isPlaying ? <FaPause /> : <FaPlay />;
      const handleIconClick = (evt) => {
        evt.stopPropagation();
        playMusicPreviewForSpeaker(evt, speaker);
      };
      return {
        ...speaker,
        icon: iconComponent,
        onClick: handleIconClick,
      };
    });
  }, [speechStyle, currentlyPlayingSpeaker, deploymentSpeakerTypes]);

  const playMusicPreviewForSpeaker = async (evt, speaker) => {
    evt.stopPropagation();
    if (
      currentlyPlayingSpeaker?.value === speaker.value &&
      currentlyPlayingSpeaker?.provider === speaker.provider
    ) {
      stopSpeakerPreview();
    } else {
      stopSpeakerPreview();
      try {
        const previewUrl = speaker.previewRequiresAuth
          ? await fetchGoogleTTSPreviewBlobUrl(speaker)
          : speaker.previewURL;
        if (!previewUrl) {
          return;
        }
        if (speaker.previewRequiresAuth) {
          audioObjectUrlRef.current = previewUrl;
        }
        const audio = new Audio(previewUrl);
        audioRef.current = audio;
        setCurrentlyPlayingSpeaker(speaker);
        audio.onended = stopSpeakerPreview;
        await audio.play();
      } catch  {
        if (audioObjectUrlRef.current) {
          URL.revokeObjectURL(audioObjectUrlRef.current);
          audioObjectUrlRef.current = null;
        }
        setCurrentlyPlayingSpeaker(null);
        audioRef.current = null;
      }
    }
  };

  useEffect(() => {
    if (sessionDetails && sessionDetails.textList) {
      setPromptList(sessionDetails.textList.join('\n'));
    }
  }, [sessionDetails]);

  useEffect(() => {
    const headers = getHeaders();
    axios
      .get(`${PROCESSOR_API_URL}/quick_session/details?sessionId=${id}`, headers)
      .then((dataRes) => {
        const sessionData = dataRes.data;
        setSessionDetails(sessionData);
        if (sessionData.videoLink) {
          setVideoLink(sessionData.videoLink);
        }
        if (sessionData.sessionMessages) {
          setSessionMessages(sessionData.sessionMessages);
        }
        if (sessionData.videoGenerationPending) {
          startQuickGenerationPoll();
          setShowResultDisplay(true);
        }
      })
      .catch(() => {
        // Swallow fetch errors; UI can retry or show stale data.
      });

    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
      if (audioObjectUrlRef.current) {
        URL.revokeObjectURL(audioObjectUrlRef.current);
        audioObjectUrlRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const startQuickGenerationPoll = () => {
    const headers = getHeaders();
    const timer = setInterval(() => {
      axios
        .get(`${PROCESSOR_API_URL}/quick_session/status?sessionId=${id}`, headers)
        .then((dataRes) => {
          const quickSessionStatus = dataRes.data;
          if (quickSessionStatus.status === 'PENDING') {
            setExpressGenerationStatus(quickSessionStatus.expressGenerationStatus);
          } else if (quickSessionStatus.status === 'COMPLETED' && quickSessionStatus.videoLink) {
            clearInterval(timer);
            setIsGenerationPending(false);
            setVideoLink(quickSessionStatus.videoLink);
          }
        })
        .catch(() => {
          // Ignore transient poll errors; next interval will retry.
        });
    }, 3000);
  };

  const submitQuickRender = (evt) => {
    evt.preventDefault();
    const headers = getHeaders();
    if (!headers) {
      showLoginDialog();
      return;
    }

    const formData = new FormData(evt.target);
    const promptListValue = formData.get('promptList');
    const lineItems = promptListValue
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);

    setIsGenerationPending(true);
    setShowResultDisplay(true);

    // Basic language detection
    // (Commented out because it's optional/placeholder)
    // const detectedLanguage = franc(promptListValue) || 'und';
    // const matchedLanguage = popularLanguages.find((lang) => lang.value === detectedLanguage) || { value: 'eng' };
    const subtitlesTranslationRequired = false;
    const speechTranslationRequired = false;

    let fontFamily = 'Times New Roman';
    if (subtitlesLanguage.value) {
      fontFamily = getFontFamilyForLanguage(subtitlesLanguage.value);
    }

    // For the payload, if speechRequired is off, then forcibly turn off these:
    const finalNormalization = speechRequired && normalizeSpeech;
    const finalAddSubtitles = speechRequired && addSubtitlesRequired;
    const finalAddTranscriptions = speechRequired && addTranscriptionsRequired;

    if (musicRequired && !selectedMusicProvider && !availableMusicProviders[0]) {
      setIsGenerationPending(false);
      setShowResultDisplay(false);
      setErrorState(true);
      setErrorMessage('No music provider is configured for this deployment.');
      return;
    }

    if (speechRequired && !speakerType) {
      setIsGenerationPending(false);
      setShowResultDisplay(false);
      setErrorState(true);
      setErrorMessage('No speech provider is configured for this deployment.');
      return;
    }

    let payload = {
      sessionId: id,
      lineItems,
      videoType: videoType.value,
      animation: animation.value,
      duration: duration.value,
      customDuration: duration.value === 'custom' ? parseInt(customDuration, 10) : undefined,
      sceneCutoffType: sceneCutoffType.value,
      musicPrompt: musicPrompt.trim() || undefined,
      theme: theme
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
        .join(','),
      speakerType: speakerType ? speakerType.value : null,
      ttsProvider: speakerType ? speakerType.provider : null,
      languageCode: speakerType ? speakerType.languageCode : null,
      languageCodes: speakerType ? speakerType.languageCodes : null,
      speakerVoiceId: speakerType ? (speakerType.voiceId || speakerType.value) : null,
      speakerLabel: speakerType ? (speakerType.label || speakerType.name || speakerType.value) : null,
      speakerDetails:
        speakerType?.provider === 'GOOGLE'
          ? getGoogleTTSVoiceDetails(speakerType)
          : null,
      speechLanguage: speechLanguage ? speechLanguage.value : null,
      subtitlesLanguage: subtitlesLanguage ? subtitlesLanguage.value : null,
      textLanguage: speechLanguage ? speechLanguage.value : null,
      fontFamily,
      subtitlesTranslationRequired,
      speechTranslationRequired,
      backgroundMusicRequired: musicRequired,
      speechRequired: speechRequired,
      speechNormalizationRequired: finalNormalization,
      addSubtitlesRequired: finalAddSubtitles,
      addTranscriptionsRequired: finalAddTranscriptions,
      imageModel: selectedImageModel ? selectedImageModel.value : null,
      bannerText,
      addBannerToComposition,
      aspectRatio: aspectRatio.value,
      musicProvider: selectedMusicProvider ? selectedMusicProvider.value : availableMusicProviders[0]?.key || null,
      generativeVideoRequired: generativeVideoRequired,
      subtitleFont: subtitleFont ? subtitleFont.value : null,
      subtitleWordAnimation: wordAnimation ? wordAnimation.value : null,
    };

    if (speechLanguage.value !== 'eng') {
      payload.subtitleFont = getFontFamilyForLanguage(subtitlesLanguage.value);
    }
    if (duration.value === 'auto') {
      payload.setAutoDurationPerScene = true;
      payload.duration = 10; // default scene length
    }
    if (duration.value === 'custom') {
      payload.duration = parseFloat(customDuration);
    }
    if (selectedVideoGenerationModel?.value === COSMOS3_SUPER_MODEL_KEY) {
      const units = getVideoModelDurationUnitsForFramesPerSecond(
        COSMOS3_SUPER_MODEL_KEY,
        user?.videoFramesPerSecond,
      );
      const requestedDuration = duration.value === 'auto'
        ? units[units.length - 1]
        : Number(payload.duration);
      payload.duration = pickDuration(units, requestedDuration);
      delete payload.customDuration;
    }
    if (generativeVideoRequired && selectedVideoGenerationModel) {
      payload.videoGenerationModel = selectedVideoGenerationModel.value;
      payload.useEndFrame = useEndFrame;
    }
    if (selectedMusicTrack && selectedMusicTrack.url) {
      payload.userSelectedMusic = selectedMusicTrack.url;
    }
    if (selectedMusicOption.value === 'autoSelectLibrary') {
      payload.autoSelectMusic = true;
    }

    // NOTE: Extended to also pass style for IDEOGRAMV2, same as RECRAFT:
    if (
      selectedImageModel &&
      (
        selectedImageModel.value === 'RECRAFTV3' ||
        selectedImageModel.value === 'RECRAFT20B' ||
        selectedImageModel.value === 'IDEOGRAMV2'
      )
    ) {
      payload.imageStyle = selectedImageStyle ? selectedImageStyle.value : null;
    }

    axios
      .post(`${PROCESSOR_API_URL}/quick_session/create`, payload, headers)
      .then(() => {
        startQuickGenerationPoll();
      })
      .catch((err) => {
        if (err.response && err.response.data) {
          setErrorMessage(err.response.data);
          setErrorState(true);
        }
        setIsGenerationPending(false);
      });
  };

  const purchaseCreditsForUser = (amountToPurchase) => {
    const purchaseAmountRequest = parseInt(amountToPurchase, 10);
    const headers = getHeaders();
    const payload = {
      amount: purchaseAmountRequest,
    };
    axios
      .post(`${PROCESSOR_API_URL}/users/purchase_credits`, payload, headers)
      .then((dataRes) => {
        const data = dataRes.data;
        if (data.url) {
          window.open(data.url, '_blank');
        }
      })
      .catch(() => {

      });
  };

  const toggleAdvancedToolbar = () => {
    setAdvancedToolbarVisible((prev) => (prev === 'hidden' ? 'block' : 'hidden'));
  };

  const [advancedToolbarVisible, setAdvancedToolbarVisible] = useState('hidden');

  // Toggling smaller panels



  const toggleThemeFunc = () => setShowTheme(!showTheme);
  const toggleDetails = () => setShowDetails(!showDetails);
  const toggleBannerText = () => setShowBannerTextDisplay(!showBannerTextDisplay);
  const handleAddBannerToCompositionChange = () => {
    const newVal = !addBannerToComposition;
    localStorage.setItem('defaultShowBannerCheckedValue', newVal.toString());
    setAddBannerToComposition(newVal);
  };

  const handleVideoTypeChange = (selectedOption) => {
    setVideoType(selectedOption);

    // If user changes to infinitezoom, default animation etc.
    if (selectedOption.value === 'Infinitezoom') {
      setAnimationOptions(INFINITE_ZOOM_ANIMATION_OPTIONS);
      setAnimation({ value: 'zoom_in', label: 'Zoom In' });
      setSpeechRequired(false);
      setNormalizeSpeech(false);
      setAddSubtitlesRequired(false);
      setAddTranscriptionsRequired(false);
    } else {
      setAnimationOptions(ANIMATION_OPTIONS);
      setAnimation({ value: 'preset_short_animation', label: 'Preset Short Animation' });
      setSpeechRequired(true);
      setNormalizeSpeech(true);
      setAddSubtitlesRequired(true);
      setAddTranscriptionsRequired(true);
    }

    // ONLY if user has "Add Generative video" checked, pick a default for that type:
    if (generativeVideoRequired) {
      if (selectedOption.value === 'Infinitezoom') {
        // pick the first model that isTransitionModel
        const defaultInfiniteZoomModel = VIDEO_GENERATION_MODEL_TYPES.find((m) => m.isTransitionModel);
        if (defaultInfiniteZoomModel) {
          const newModelOption = {
            value: defaultInfiniteZoomModel.key,
            label: defaultInfiniteZoomModel.name
          };
          setSelectedVideoGenerationModel(newModelOption);
          localStorage.setItem('defaultSelectedGenerativeModel', JSON.stringify(newModelOption));
        }
      } else {
        // pick the first model that isExpressModel
        const defaultSlideshowModel = VIDEO_GENERATION_MODEL_TYPES.find((m) => m.isExpressModel);
        if (defaultSlideshowModel) {
          const newModelOption = {
            value: defaultSlideshowModel.key,
            label: defaultSlideshowModel.name
          };
          setSelectedVideoGenerationModel(newModelOption);
          localStorage.setItem('defaultSelectedGenerativeModel', JSON.stringify(newModelOption));
        }
      }
    }
  };

  const [animationOptions, setAnimationOptions] = useState(ANIMATION_OPTIONS);

  const handleAnimationChange = (selectedOption) => {
    setAnimation(selectedOption);
  };

  const handleDurationChange = (selectedOption) => {
    setDuration(selectedOption);
    if (selectedOption.value !== 'custom') {
      setCustomDuration('');
    }
  };

  const handleSceneCutoffTypeChange = (selectedOption) => {
    setSceneCutoffType(selectedOption);
  };

  const handleSpeakerChange = (selectedOption) => {
    setSpeakerType(selectedOption);
    localStorage.setItem('defaultSpeaker', selectedOption.value);
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    if (audioObjectUrlRef.current) {
      URL.revokeObjectURL(audioObjectUrlRef.current);
      audioObjectUrlRef.current = null;
    }
    setCurrentlyPlayingSpeaker(null);
  };







  const handleMusicOptionChange = (selectedOption) => {
    if (selectedOption.value === 'selectLibrary') {
      setPreviousMusicOption(selectedMusicOption);
      setSelectedMusicOption(selectedOption);
      setSelectedMusicTrack(null);
      openMusicLibraryDialog();
    } else {
      localStorage.setItem('defaultSelectedMusicGenerationMode', selectedOption.value);
      setSelectedMusicOption(selectedOption);
      setSelectedMusicTrack(null);
    }
  };

  const openMusicLibraryDialog = () => {
    const handleMusicSelect = (track) => {
      setSelectedMusicTrack(track);
      closeAlertDialog();
    };
    const handleMusicLibraryCancel = () => {
      setSelectedMusicOption(previousMusicOption || addMusicOptions[0]);
      closeAlertDialog();
    };
    const musicLibraryComponent = (
      <MusicLibraryHome onSelectMusic={handleMusicSelect} onCancel={handleMusicLibraryCancel} />
    );
    openAlertDialog(musicLibraryComponent, undefined, true);
  };

  const handleRemoveSelectedMusicTrack = () => {
    setSelectedMusicTrack(null);
    const defaultOptionValue =
      localStorage.getItem('defaultSelectedMusicGenerationMode') || addMusicOptions[0].value;
    const defaultOption =
      addMusicOptions.find((option) => option.value === defaultOptionValue) || addMusicOptions[0];
    setSelectedMusicOption(defaultOption);
  };

  const handleMusicProviderChange = (selectedOption) => {
    setSelectedMusicProvider(selectedOption);
  };

  // Updated to handle IDEOGRAMV2, just like RECRAFT:
  const handleSelectedImageModelChange = (selectedOption) => {

    setSelectedImageModel(selectedOption);
    localStorage.setItem('defaultModel', selectedOption.value);

    if (selectedOption.value === 'RECRAFTV3' || selectedOption.value === 'RECRAFT20B') {
      const defaultRecraftModel = localStorage.getItem('defaultRecraftModel');
      if (defaultRecraftModel) {
        setSelectedImageStyle({ value: defaultRecraftModel, label: defaultRecraftModel });
      } else {
        setSelectedImageStyle({ value: RECRAFT_IMAGE_STYLES[0], label: RECRAFT_IMAGE_STYLES[0] });
      }
    }
    // -- IDEOGRAMV2 logic added here:
    else if (selectedOption.value === 'IDEOGRAMV2') {
      const defaultIdeogramModel = localStorage.getItem('defaultIdeogramModel');
      if (defaultIdeogramModel) {
        setSelectedImageStyle({ value: defaultIdeogramModel, label: defaultIdeogramModel });
      } else if (IDEOGRAM_IMAGE_STYLES.length > 0) {
        setSelectedImageStyle({ value: IDEOGRAM_IMAGE_STYLES[0], label: IDEOGRAM_IMAGE_STYLES[0] });
      } else {
        setSelectedImageStyle(null);
      }
    }
    else {
      setSelectedImageStyle(null);
    }
  };

  // Updated to handle saving IDEOGRAM style as well:
  const handleImageStyleChange = (selectedOption) => {
    setSelectedImageStyle(selectedOption);

    if (
      selectedImageModel &&
      (selectedImageModel.value === 'RECRAFTV3' || selectedImageModel.value === 'RECRAFT20B')
    ) {
      localStorage.setItem('defaultRecraftModel', selectedOption.value);
    }
    else if (selectedImageModel && selectedImageModel.value === 'IDEOGRAMV2') {
      localStorage.setItem('defaultIdeogramModel', selectedOption.value);
    }
  };

  const handleAspectRatioChange = (selectedOption) => {
    localStorage.setItem('defaultAspectRatio', selectedOption.value);
    setAspectRatio(selectedOption);
  };

  const handlePromptListChange = (e) => {
    const newPromptList = e.target.value;
    setPromptList(newPromptList);
    const words = newPromptList.split(/\s+/).filter(Boolean).length;
    const characters = newPromptList.length;
    setWordCount(words);
    setCharacterCount(characters);
  };

  const showLoginDialog = () => {
    const loginComponent = <AuthContainer />;
    openAlertDialog(loginComponent, undefined, false, AUTH_DIALOG_OPTIONS);
  };

  // Credits logic placeholders
  const [creditsBreakdown, setCreditsBreakdown] = useState({
    images: 0,
    speech: 0,
    translation: 0,
    music: 0,
    video: 0,
    prompt: 0,
    theme: 0
  });

  const calculateCredits = () => {
    let credits = 0;

    const lineItems = promptList.split('\n').map((prompt) => prompt.trim()).filter(Boolean);
    const numImages = lineItems.length; // Scenes = # lines

    if (numImages === 0) {
      setCreditsPreview(0);
      return;
    }

    // Image model pricing:
    const imageModelKey = selectedImageModel ? selectedImageModel.value : null;
    const aspectRatioValue = aspectRatio ? aspectRatio.value : '1:1';
    const imageModelPricing = IMAGE_MODEL_PRICES.find((model) => model.key === imageModelKey);
    const imagePriceObj = imageModelPricing
      ? imageModelPricing.prices.find((price) => price.aspectRatio === aspectRatioValue)
      : null;
    const imageCreditCostPerImage = imagePriceObj ? imagePriceObj.price : 8;
    const totalImageCredits = numImages * imageCreditCostPerImage;
    credits += totalImageCredits;

    // Speech credits
    const speechModelKey = 'TTS'; // single TTS model for all
    let speechCredits = 0;
    if (speechRequired) {
      const wordsCount = characterCount / 5; // approximate
      const speechModelPricing = SPEECH_MODEL_PRICES.find((model) => model.key === speechModelKey);
      const speechPriceObj = speechModelPricing
        ? speechModelPricing.prices.find((price) => price.operationType === 'words')
        : null;
      const tokensPerUnit = speechPriceObj ? speechPriceObj.tokens : 1000;
      const speechPricePerUnit = speechPriceObj ? speechPriceObj.price : 2;
      const speechUnits = Math.ceil(wordsCount / tokensPerUnit);
      speechCredits = speechUnits * speechPricePerUnit;
      credits += speechCredits;
    }

    // Translation credits
    let translationCredits = 0;
    const speechTranslationRequired = speechLanguage.value !== 'eng';
    const subtitlesTranslationRequired = subtitlesLanguage.value !== 'eng';
    if (speechTranslationRequired || subtitlesTranslationRequired) {
      const translationModelPricing = TRANSLATION_MODEL_PRICES.find((model) => model.key === undefined);
      const translationPriceObj = translationModelPricing
        ? translationModelPricing.prices.find((price) => price.operationType === 'line')
        : null;
      const translationPricePerLine = translationPriceObj ? translationPriceObj.price : 2;
      translationCredits = numImages * translationPricePerLine;
      credits += translationCredits;
    }

    // Music credits
    let musicCredits = 0;
    if (musicRequired) {
      const musicModelKey = 'AUDIOCRAFT';
      const musicModelPricing = MUSIC_MODEL_PRICES.find((model) => model.key === musicModelKey);
      const musicPriceObj = musicModelPricing
        ? musicModelPricing.prices.find((price) => price.operationType === 'generate_song')
        : null;
      musicCredits = musicPriceObj ? musicPriceObj.price : 3;
      credits += musicCredits;
    }

    // Generative video
    let videoCredits = 0;
    if (generativeVideoRequired && selectedVideoGenerationModel) {
      const videoModelKey = selectedVideoGenerationModel.value;
      const aspectRatioValue = aspectRatio ? aspectRatio.value : '1:1';
      const videoModelPricing = VIDEO_MODEL_PRICES.find((model) => model.key === videoModelKey);
      const videoPriceObj = videoModelPricing
        ? videoModelPricing.prices.find((price) => price.aspectRatio === aspectRatioValue)
        : null;
      const videoPricePerUnit = videoPriceObj ? videoPriceObj.price : 90;

      videoCredits = 0;
      lineItems.forEach((line) => {
        const lineLength = line.length;
        let lineCost = videoPricePerUnit;
        if (lineLength > 60) {
          lineCost *= 2;
        }
        videoCredits += lineCost;
      });
      credits += videoCredits;
    }

    // Prompt Enhancement credits
    let promptEnhancementPricePerUnit = 2;
    let totalPromptEnhancementCredits = 0;
    lineItems.forEach((line) => {
      const lineLength = line.length;
      let lineCost = promptEnhancementPricePerUnit;
      if (lineLength > 60) {
        lineCost *= 2;
      }
      totalPromptEnhancementCredits += lineCost;
    });

    // Theming credits
    let themePricePerUnit = 2;
    let totalThemeCredits = 0;
    lineItems.forEach((line) => {
      const lineLength = line.length;
      let lineCost = themePricePerUnit;
      if (lineLength > 60) {
        lineCost *= 2;
      }
      totalThemeCredits += lineCost;
    });

    let totalCredits = credits + totalPromptEnhancementCredits + totalThemeCredits;
    setCreditsPreview(totalCredits);

    // update breakdown
    setCreditsBreakdown({
      images: totalImageCredits,
      speech: speechCredits,
      translation: translationCredits,
      music: musicCredits,
      video: videoCredits,
      prompt: totalPromptEnhancementCredits,
      theme: totalThemeCredits
    });
  };

  const toggleCreditsBreakdown = () => {
    setShowCreditsBreakdown(!showCreditsBreakdown);
  };

  useEffect(() => {
    calculateCredits();
    // eslint-disable-next-line
  }, [
    promptList,
    selectedImageModel,
    aspectRatio,
    speechRequired,
    speechLanguage,
    subtitlesLanguage,
    generativeVideoRequired,
    selectedVideoGenerationModel,
    useEndFrame,
    selectedMusicOption,
    selectedMusicTrack,
  ]);

  let downloadPreviousRenderLinkWithBtn = null;
  if (sessionDetails && sessionDetails.videoLink) {
    const oldElement = (
      <div className='flex justify-center text-xs underline hover:text-neutral-600'>
        <a href={`${PROCESSOR_API_URL}/${sessionDetails.videoLink}`} download className={`${textColor} underline`}>
          Download previous render
        </a>
      </div>
    );
    downloadPreviousRenderLinkWithBtn = (
      <SecondaryButton className="text-xs">
        {oldElement}
      </SecondaryButton>
    );
  }

  const viewInStudio = () => {
    navigate(`/video/${id}`);
  };

  let viewInStudioLinkWithBtn = null;
  if (videoLink) {
    viewInStudioLinkWithBtn = (
      <SecondaryButton onClick={viewInStudio} className="text-xs">
        View in Studio
      </SecondaryButton>
    );
  }

  let errorMessageDisplay = <span />;
  if (errorState) {
    errorMessageDisplay = <div className='text-red-500 text-sm text-center'>{errorMessage}</div>;
  }

  let customBannerTextView = <span />;
  if (showBannerTextDisplay) {
    customBannerTextView = (
      <div className={`p-2 ${bgGray1Color} rounded mt-2 h-[80px]`}>
        <TextareaAutosize
          minRows={2}
          maxRows={5}
          className={`w-full ${bgGray1Color} ${textColor} p-2 rounded`}
          placeholder="Add custom banner text here (max 10 words), leave empty to auto-generate"
          name="bannerText"
          value={bannerText}
          onChange={(e) => setBannerText(e.target.value)}
        />
      </div>
    );
  }

  const updateSubtitleFont = (selectedOption) => {
    setSubtitleFont(selectedOption);
    localStorage.setItem('defaultSubtitleFont', selectedOption.value);
  };

  // Assistant logic
  const startAssistantQueryPoll = () => {
    const headers = getHeaders();
    if (!headers) {
      showLoginDialog();
      return;
    }
    const timer = setInterval(() => {
      axios
        .get(`${PROCESSOR_API_URL}/assistants/assistant_query_status?id=${id}`, headers)
        .then((dataRes) => {
          const assistantQueryData = dataRes.data;
          const assistantQueryStatus = assistantQueryData.status;
          if (assistantQueryStatus === 'COMPLETED') {
            const sessionData = assistantQueryData.sessionDetails;
            clearInterval(timer);
            setSessionMessages(sessionData.sessionMessages);
            setIsAssistantQueryGenerating(false);
          }
        });
    }, 1000);
  };

  const submitAssistantQuery = (query) => {
    const headers = getHeaders();
    if (!headers) {
      showLoginDialog();
      return;
    }
    setSessionMessages([]);
    setIsAssistantQueryGenerating(true);
    axios
      .post(`${PROCESSOR_API_URL}/assistants/submit_assistant_query`, { id: id, query: query }, headers)
      .then(() => {
        startAssistantQueryPoll();
      })
      .catch(function () {
        setIsAssistantQueryGenerating(false);
      });
  };

  const creditsDropdownRef = useRef(null);
  useEffect(() => {
    function handleClickOutside(event) {
      if (
        creditsDropdownRef.current &&
        !creditsDropdownRef.current.contains(event.target)
      ) {
        setShowCreditsBreakdown(false);
      }
    }
    if (showCreditsBreakdown) {
      document.addEventListener("mousedown", handleClickOutside);
    } else {
      document.removeEventListener("mousedown", handleClickOutside);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [showCreditsBreakdown]);

  return (
    <div className='relative w-full'>


      {/* --- TOP BAR / HEADING BAR --- */}
      <div className={`flex justify-between items-center p-2 ${bgNeutral2Color} ${textColor} pt-8 mt-8 rounded-md shadow-md relative`}>
        <h2 className={`text-lg font-bold  ${textColor} pl-2`}>Express Editor</h2>
        <div className="flex items-center space-x-2 mr-2">
          {/* Credits summary & toggle */}
          <div className="relative">
            <div className="text-center items-center cursor-pointer" onClick={toggleCreditsBreakdown}>
              <span className="font-bold text-sm text-neutral-100">
                Incurs {creditsPreview} credits
              </span>
              <FaChevronDown
                className={`transform ${showCreditsBreakdown ? 'rotate-180' : ''} inline-flex text-sm mb-[2px] ml-1`}
              />
            </div>
            {showCreditsBreakdown && (
              <div
                className={`absolute top-full right-0 ${textColor} ${bgGray2Color} p-2 rounded shadow-md mt-2 z-10`}
                ref={creditsDropdownRef}
              >
                {creditsBreakdown.images > 0 && <p>{creditsBreakdown.images} credits for images</p>}
                {creditsBreakdown.speech > 0 && <p>{creditsBreakdown.speech} credits for speech</p>}
                {creditsBreakdown.translation > 0 && <p>{creditsBreakdown.translation} credits for translation</p>}
                {creditsBreakdown.music > 0 && <p>{creditsBreakdown.music} credits for music</p>}
                {creditsBreakdown.video > 0 && <p>{creditsBreakdown.video} credits for generative video</p>}
                {creditsBreakdown.prompt > 0 && <p>{creditsBreakdown.prompt} credits for prompt enhancement</p>}
                {creditsBreakdown.theme > 0 && <p>{creditsBreakdown.theme} credits for theming</p>}
              </div>
            )}
          </div>

          {downloadPreviousRenderLinkWithBtn}
          {viewInStudioLinkWithBtn}
        </div>
      </div>

      <div>{errorMessageDisplay}</div>

      {showResultDisplay && (
        <ProgressIndicator
          videoLink={videoLink}
          isGenerationPending={isGenerationPending}
          expressGenerationStatus={expressGenerationStatus}
          setShowResultDisplay={setShowResultDisplay}
          errorMessage={errorMessage}
          purchaseCreditsForUser={purchaseCreditsForUser}
          viewInStudio={viewInStudio}
        />
      )}


      <form onSubmit={submitQuickRender}>
        <div>
          <div className={`${bgGray1Color} p-2 mt-2 rounded-lg shadow-md`}>
            {/* Toolbar */}
            <div className={`toolbar flex items-center gap-2 p-2 ${bgGray1Color} ${textColor}`}>
              <div className="grid grid-cols-4 items-center gap-2 w-full">
                {/* Aspect Ratio */}
                <div className='block p-2'>
                  <label className="whitespace-nowrap block text-xs text-left pl-2 pb-1">Aspect Ratio:</label>
                  <SingleSelect
                    value={aspectRatio}
                    onChange={handleAspectRatioChange}
                    options={aspectRatioOptions}
                    className="w-24"
                  />
                </div>

                {/* Video Type */}
                <div className='block p-2'>
                  <label className="whitespace-nowrap block text-xs text-left pl-2 pb-1">Type:</label>
                  <SingleSelect
                    value={videoType}
                    onChange={handleVideoTypeChange}
                    options={[
                      { value: 'Slideshow', label: 'Narrative' },
                      { value: 'Infinitezoom', label: 'Infinite Zoom' },
                    ]}
                    className="w-24"
                  />
                </div>

                {/* Image Model */}
                <div className='block p-2'>
                  <label className="whitespace-nowrap block text-xs text-left pl-2 pb-1">Image Model:</label>
                  <SingleSelect
                    value={selectedImageModel}
                    onChange={handleSelectedImageModelChange}
                    options={imageModelOptions}
                    className="w-24"
                  />
                </div>

                {/* If RECRAFT or IDEOGRAM => show the style select, exactly like RECRAFT logic */}
                {selectedImageModel &&
                  (
                    selectedImageModel.value === 'RECRAFTV3' ||
                    selectedImageModel.value === 'RECRAFT20B' ||
                    selectedImageModel.value === 'IDEOGRAMV2'
                  ) && (
                    <div className="block p-2">
                      <label className="whitespace-nowrap block text-xs text-left pl-2 pb-1">
                        Image Style:
                      </label>
                      <SingleSelect
                        value={selectedImageStyle}
                        onChange={handleImageStyleChange}
                        options={
                          selectedImageModel.value === 'IDEOGRAMV2'
                            ? IDEOGRAM_IMAGE_STYLES.map((style) => ({
                                value: style,
                                label: style,
                              }))
                            : RECRAFT_IMAGE_STYLES.map((style) => ({
                                value: style,
                                label: style,
                              }))
                        }
                        className="w-24"
                      />
                    </div>
                  )}

                {/* Speaker => hide if speechRequired is false */}
                {speechRequired && (
                  <div className='block p-2'>
                    <label className={`whitespace-nowrap block text-xs text-left pl-2 pb-1 ${textColor}`}>
                      Speaker
                    </label>
                    <CombinedAudioSelect
                      speakerType={speakerType}
                      onSpeakerChange={handleSpeakerChange}
                      playMusicPreviewForSpeaker={playMusicPreviewForSpeaker}
                      currentlyPlayingSpeaker={currentlyPlayingSpeaker}
                      colorMode="dark"
                      speakerOptions={speakerOptions}
                    />
                  </div>
                )}
              </div>
            </div>

            {/* Generative Video Panel */}
            <div className="flex items-center w-full border-b-2 border-neutral-500 p-2 pl-4">
              <div className="flex items-center space-x-4 w-full">
                <div className="flex items-center">
                  <label className={`${textColor} text-left pr-2`}>Add Generative Video:</label>
                  <input
                    type="checkbox"
                    className="custom-checkbox form-checkbox h-5 w-5 text-gray-600"
                    name="generativeVideoRequired"
                    checked={generativeVideoRequired}
                    onChange={(e) => {
                      const checked = e.target.checked;
                      setGenerativeVideoRequired(checked);
                      localStorage.setItem('defaultGenerativeVideoRequired', JSON.stringify(checked));

                      if (checked) {
                        // If no model is selected, pick the first from the filtered list
                        if (!selectedVideoGenerationModel) {
                          const firstModel = videoGenerationModelOptions[0];
                          if (firstModel) {
                            const modelOption = {
                              value: firstModel.key,
                              label: firstModel.name,
                            };
                            setSelectedVideoGenerationModel(modelOption);
                            localStorage.setItem(
                              'defaultSelectedGenerativeModel',
                              JSON.stringify(modelOption)
                            );
                          }
                        }
                        setUseEndFrame(true);
                        localStorage.setItem('defaultUseEndFrame', JSON.stringify(true));
                      } else {
                        setSelectedVideoGenerationModel(null);
                        localStorage.removeItem('defaultSelectedGenerativeModel');
                        setUseEndFrame(false);
                        localStorage.setItem('defaultUseEndFrame', JSON.stringify(false));
                      }
                    }}
                  />
                </div>

                {generativeVideoRequired && (
                  <>
                    <div className="flex items-center">
                      <label className={`${textColor} text-left pr-2`}>
                        Select Video Generation Model:
                      </label>
                      <SingleSelect
                        value={selectedVideoGenerationModel}
                        onChange={(option) => {
                          setSelectedVideoGenerationModel(option);
                          localStorage.setItem(
                            'defaultSelectedGenerativeModel',
                            JSON.stringify(option)
                          );
                        }}
                        options={videoGenerationModelOptions.map((model) => ({
                          value: model.key,
                          label: model.name,
                        }))}
                        className="w-full"
                      />
                    </div>
                    {selectedVideoGenerationModel && (
                      <div className="flex items-center">
                        {
                          VIDEO_GENERATION_MODEL_TYPES.find(
                            (m) => m.key === selectedVideoGenerationModel.value && m.isTransitionModel
                          ) && (
                            <>
                              <label className={`${textColor} text-left pr-2`}>Use End Frame:</label>
                              <input
                                type="checkbox"
                                className="custom-checkbox form-checkbox h-5 w-5 text-gray-600"
                                name="useEndFrame"
                                checked={useEndFrame}
                                onChange={(e) => {
                                  const checked = e.target.checked;
                                  setUseEndFrame(checked);
                                  localStorage.setItem(
                                    'defaultUseEndFrame',
                                    JSON.stringify(checked)
                                  );
                                }}
                              />
                            </>
                          )
                        }
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>

            {/* Advanced toolbar toggle */}
            <div className='advanced-toolbar-options-container'>
              <div
                className={`${textColor} cursor-pointer mt-2 pt-1 pb-1 text-left pl-4 font-semibold`}
                onClick={toggleAdvancedToolbar}
              >
                Advanced Options <FaChevronDown className='inline-flex mb-1 ml-2' />
              </div>

              <div className={`advanced-options ${advancedToolbarVisible}`}>
                {/* Animation / Duration / Scene Cutoff */}
                <div
                  className={`grid grid-cols-4 items-center gap-2 w-full
                     ${bgNeutral2Color} ${textColor} border-b-2 border-neutral-500 pl-4 pr-2
                     pb-2
                    `}
                >
                  {/* Animation */}
                  <div>
                    <label className="whitespace-nowrap block text-xs text-left pl-2 pb-1">Animation:</label>
                    <SingleSelect
                      value={animation}
                      onChange={handleAnimationChange}
                      options={animationOptions}
                      className="w-28"
                    />
                  </div>

                  {/* Duration */}
                  <div>
                    <label className="whitespace-nowrap block text-xs text-left pl-2 pb-1">
                      Duration/Scene:
                    </label>
                    <SingleSelect
                      value={duration}
                      onChange={handleDurationChange}
                      options={durationOptionsForSelectedVideoModel}
                      className="w-full"
                    />
                    {duration.value === 'custom' && (
                      <input
                        type="number"
                        value={customDuration}
                        onChange={(e) => setCustomDuration(e.target.value)}
                        className={`w-full mt-2 p-2 rounded border-2 border-neutral-500 ${bgNeutral2Color} ${textColor}`}
                        placeholder="Enter custom duration"
                      />
                    )}
                  </div>

                  {/* Scene Cutoff */}
                  <div>
                    <label className="whitespace-nowrap block text-xs text-left pl-2 pb-1">
                      Scene Cutoff:
                    </label>
                    <SingleSelect
                      value={sceneCutoffType}
                      onChange={handleSceneCutoffTypeChange}
                      options={[
                        { label: 'Auto', value: 'auto' },
                        { label: '1 Scene/line', value: 'scene_per_line' },
                      ]}
                      className="w-full"
                    />
                  </div>
                </div>

                {/* Music & Speech */}
                <div className={`mt-2 mb-2 p-2 ${bgNeutral2Color} border-b-2 border-neutral-500`}>
                  <div className={`basis-full flex items-center ${textColor} font-bold text-sm cursor-pointer`}>
                    <div className='flex' onClick={toggleDetails}>
                      <div className='inline-flex'>Music & Speech</div>
                      <FaChevronDown className='inline-flex mt-[2px] ml-1 cursor-pointer' />
                    </div>
                  </div>

                  {/* The row that includes Music / Speech / Normalize / Subtitles / Transcriptions */}
                  <div className={`md:flex hidden w-full ${textColor} mt-2`}>
                    <div className='basis-full flex items-center'>

                      {/* --- MUSIC CHECKBOX --- */}
                      <div className='p-2'>
                        <div className='text-xs mb-1'>Music</div>
                        <input
                          type="checkbox"
                          className="custom-checkbox form-checkbox h-5 w-5 text-gray-600"
                          name="backgroundMusicRequired"
                          checked={musicRequired}
                          onChange={handleMusicCheckboxChange}
                        />
                      </div>

                      {/* Show music selection UI only if musicRequired is true */}
                      {musicRequired && (
                        <>
                          {selectedMusicTrack && (
                            <div className='mt-2 text-sm text-neutral-300 ml-2'>
                              Selected Music Track: {selectedMusicTrack.name}
                            </div>
                          )}
                          <div className='ml-2'>
                            <label className={`whitespace-nowrap block text-xs text-left pl-2 pb-1 ${textColor}`}>
                              Music Selection:
                            </label>
                            <SingleSelect
                              value={selectedMusicOption}
                              onChange={handleMusicOptionChange}
                              options={addMusicOptions}
                              className="w-40"
                            />
                          </div>
                          {selectedMusicTrack && (
                            <button
                              className={`${bgGray4Color} ${textColor} p-1 rounded ml-2`}
                              onClick={handleRemoveSelectedMusicTrack}
                              type="button"
                            >
                              Remove Track
                            </button>
                          )}
                          {/* Music Provider */}
                          <div className='w-1/3 ml-4 p-2'>
                            <label className={`whitespace-nowrap block text-xs text-left pl-2 pb-1 ${textColor}`}>
                              Music Provider:
                            </label>
                            <SingleSelect
                              value={selectedMusicProvider}
                              onChange={handleMusicProviderChange}
                              options={availableMusicProviders.map((provider) => ({
                                value: provider.key,
                                label: provider.name,
                              }))}
                              className="w-full"
                            />
                          </div>
                        </>
                      )}

                      {/* --- SPEECH CHECKBOX --- */}
                      <div className='p-2 ml-4'>
                        <div className='text-xs mb-1'>Speech</div>
                        <input
                          type="checkbox"
                          className="custom-checkbox form-checkbox h-5 w-5 text-gray-600"
                          name="speechRequired"
                          checked={speechRequired}
                          onChange={handleSpeechCheckboxChange}
                        />
                      </div>

                      {/* If speech is required => show these checkboxes */}
                      {speechRequired && (
                        <>
                          <div className='p-2'>
                            <div>
                              <div className='text-xs mb-1'>Normalize</div>
                              <input
                                type="checkbox"
                                name="speechNormalizationRequired"
                                className="custom-checkbox form-checkbox h-5 w-5 text-gray-600"
                                checked={normalizeSpeech}
                                onChange={() => setNormalizeSpeech((prev) => !prev)}
                              />
                            </div>
                          </div>

                          <div className='p-2'>
                            <div>
                              <div className='text-xs mb-1'>Subtitles</div>
                              <input
                                type="checkbox"
                                name="addSubtitlesRequired"
                                className="custom-checkbox form-checkbox h-5 w-5 text-gray-600"
                                checked={addSubtitlesRequired}
                                onChange={() => setAddSubtitlesRequired((prev) => !prev)}
                              />
                            </div>
                          </div>

                          <div className='p-2'>
                            <div>
                              <div className='text-xs mb-1'>Transcriptions</div>
                              <input
                                type="checkbox"
                                name="addTranscriptionsRequired"
                                className="custom-checkbox form-checkbox h-5 w-5 text-gray-600"
                                checked={addTranscriptionsRequired}
                                onChange={() => setAddTranscriptionsRequired((prev) => !prev)}
                              />
                            </div>
                          </div>
                        </>
                      )}


                    </div>
                  </div>
                </div>

                {/* Subtitle & Transcription block => only relevant if speechRequired AND addSubtitlesRequired */}
                {speechRequired && addSubtitlesRequired && (
                  <div className={`mt-2 mb-2 p-2 ${bgNeutral2Color} border-b-2 border-neutral-500`}>
                    <div className={`basis-full flex items-center ${textColor} font-bold text-sm cursor-pointer`}>
                      <div className='flex' onClick={toggleDetails}>
                        <div className='inline-flex'>Subtitle & Transcription</div>
                        <FaChevronDown className='inline-flex mt-[2px] ml-1 cursor-pointer' />
                      </div>
                    </div>
                    <div className={`md:flex hidden w-full ${textColor}`}>
                      <div className='basis-full flex items-center'>
                        <div className='flex w-full'>

                          <div className="flex items-center space-x-4 w-full p-2">
                            <div className='w-1/3'>
                              <label className={`whitespace-nowrap block text-xs text-left pl-2 pb-1 ${textColor}`}>
                                Subtitles Font:
                              </label>
                              <SingleSelect
                                value={subtitleFont}
                                onChange={updateSubtitleFont}
                                options={subtitleFontOptions}
                                className="w-full"
                              />
                            </div>
                            <div className='w-1/3'>
                              <label className={`whitespace-nowrap block text-xs text-left pl-2 pb-1 ${textColor}`}>
                                Word Animation:
                              </label>
                              <SingleSelect
                                value={wordAnimation}
                                onChange={(option) => setWordAnimation(option)}
                                options={wordAnimationOptions}
                                className="w-full"
                              />
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* Theme Section */}
                <div
                  className={`mt-2 mb-2 p-2 text-left ${bgNeutral2Color} ${textColor} h-[40px]
                     cursor-pointer border-b-2 border-neutral-500`}
                >
                  <div className='inline-flex w-[84%]' onClick={toggleThemeFunc}>
                    Theme <FaChevronDown className='inline-flex ml-2 mt-1' />
                  </div>
                </div>

                {showTheme && (
                  <ThemeViewer
                    sessionId={id}
                    aspectRatio={aspectRatio}
                    showTheme={showTheme}
                    setShowTheme={setShowTheme}
                    themeType={themeType}
                    setThemeType={setThemeType}
                    parentJsonTheme={parentJsonTheme}
                    setParentJsonTheme={setParentJsonTheme}
                    derivedJsonTheme={derivedJsonTheme}
                    setDerivedJsonTheme={setDerivedJsonTheme}
                    errorMessage={errorMessage}
                    setErrorMessage={setErrorMessage}
                    errorState={errorState}
                    setErrorState={setErrorState}

                    basicTextTheme={basicTextTheme}
                    setBasicTextTheme={setBasicTextTheme}
                    derivedTextTheme={derivedTextTheme}
                    setDerivedTextTheme={setDerivedTextTheme}
                    customThemeText={customThemeText}
                    setCustomThemeText={setCustomThemeText}
                  />
                )}

                <div
                  className={`p-2 border-b-2 border-neutral-500 ${bgNeutral2Color} ${textColor} cursor-pointer text-left`}
                >
                  <div className='inline-flex w-full items-center'>
                    <div className='flex-1'>
                      Banner <FaArrowRight className='inline-flex ml-2' />
                    </div>
                    <div className='flex items-center'>
                      <label className='mr-2'>Add Banner</label>
                      <input
                        type='checkbox'
                        className="custom-checkbox form-checkbox h-5 w-5 text-gray-600"
                        name="addBannerToComposition"
                        checked={addBannerToComposition}
                        onChange={handleAddBannerToCompositionChange}
                      />
                      <FaChevronDown className='inline-flex ml-2 mt-[1px] mr-2 cursor-pointer' onClick={toggleBannerText} />
                    </div>
                  </div>
                  {customBannerTextView}
                </div>
              </div>
            </div>
          </div>



          {/* Prompt list + credits submission */}
          <div className={`${bgGray2Color}`}>
            <div className={`font-semibold  pl-4 text-left mt-1 ${bgStone1Color} ${textColor}
            pt-1 pb-1`}>
              <div className='pl-1 ml-1'>
                Narrative Lines -
              </div>
            </div>
            <TextareaAutosize
              minRows={5}
              maxRows={20}
              className={`w-full ${bgGray1Color} ${textColor} p-4 rounded mx-auto`}
              placeholder="Type your narrative here. One line per scene. Do not enter prompts, just the narrative text."
              name="promptList"
              value={promptList}
              onChange={handlePromptListChange}
            />
            <div className='relative mt-4'>
              <CommonButton type="submit">Submit</CommonButton>
            </div>
          </div>
        </div>
      </form>

      <AssistantHome
        submitAssistantQuery={submitAssistantQuery}
        sessionId={id}
        sessionMessages={sessionMessages}
        onSessionMessagesChange={setSessionMessages}
        onSessionDetailsChange={setSessionDetails}
        onAssistantQueryGeneratingChange={setIsAssistantQueryGenerating}
        isAssistantQueryGenerating={isAssistantQueryGenerating}
        getSessionImageLayers={() => { }}
      />
    </div>
  );
}
