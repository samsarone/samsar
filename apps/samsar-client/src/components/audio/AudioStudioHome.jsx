import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import {
  FaArrowDown,
  FaArrowUp,
  FaCheck,
  FaGripVertical,
  FaLink,
  FaMusic,
  FaSearch,
  FaSyncAlt,
  FaTimes,
  FaWaveSquare,
} from 'react-icons/fa';
import { MdAudiotrack, MdGraphicEq } from 'react-icons/md';

import CommonContainer from '../common/CommonContainer.tsx';
import { useColorMode } from '../../contexts/ColorMode.jsx';
import { useUser } from '../../contexts/UserContext.jsx';
import { getHeaders } from '../../utils/web.jsx';
import { MUSIC_PROVIDERS, TTS_COMBINED_SPEAKER_TYPES } from '../../constants/Types.ts';
import { useAudioProviderAvailability } from '../../hooks/useAudioProviderAvailability.js';
import {
  filterMusicProvidersForAudioAvailability,
  filterSpeakersForAudioAvailability,
  hasAudioAvailabilityRules,
} from '../../constants/audioProviderAvailability.js';
import {
  AUDIO_TYPE_LABELS,
  AUDIO_TYPE_MUSIC,
  AUDIO_TYPE_SOUND_EFFECT,
  AUDIO_TYPE_SPEECH,
  formatAudioStudioDuration,
  getAudioStudioItemId,
  resolveAudioStudioUrls,
} from './audioStudioUtils.mjs';

const PROCESSOR_API = import.meta.env.VITE_PROCESSOR_API;
const PENDING_AUDIO_STUDIO_REQUEST_KEY = 'audioStudioPendingRequestId';
const PENDING_AUDIO_JOIN_REQUEST_KEY = 'audioStudioPendingJoinRequestId';
const AUDIO_GENERATION_POLL_INTERVAL_MS = 2500;
const AUDIO_JOIN_POLL_INTERVAL_MS = 1500;
const AUDIO_LIBRARY_PAGE_SIZE = 18;

const AUDIO_TYPES = [
  { value: AUDIO_TYPE_MUSIC, label: AUDIO_TYPE_LABELS[AUDIO_TYPE_MUSIC], icon: FaMusic },
  { value: AUDIO_TYPE_SPEECH, label: AUDIO_TYPE_LABELS[AUDIO_TYPE_SPEECH], icon: MdAudiotrack },
  { value: AUDIO_TYPE_SOUND_EFFECT, label: AUDIO_TYPE_LABELS[AUDIO_TYPE_SOUND_EFFECT], icon: FaWaveSquare },
];

const SOUND_EFFECT_MODELS = [
  { value: 'SDAUDIO', label: 'Stable Audio' },
  { value: 'CUSTOM_TEXT_TO_SOUND_EFFECT', label: 'Custom Sound Effect' },
];

function getApiErrorMessage(error, fallback) {
  return error?.response?.data?.error || error?.response?.data?.message || error?.message || fallback;
}

function getAudioItemTitle(item) {
  const title = typeof item?.title === 'string' ? item.title.trim() : '';
  const prompt = typeof item?.prompt === 'string' ? item.prompt.trim() : '';
  const description = typeof item?.description === 'string' ? item.description.trim() : '';
  return title || prompt || description || AUDIO_TYPE_LABELS[item?.libraryType] || 'Audio item';
}

function getAudioItemDescription(item) {
  const prompt = typeof item?.prompt === 'string' ? item.prompt.trim() : '';
  const description = typeof item?.description === 'string' ? item.description.trim() : '';
  const title = getAudioItemTitle(item);
  const value = prompt || description;
  return value && value !== title ? value : '';
}

function AudioStudioPlayer({ item, className = '', unavailableClassName = '' }) {
  const audioUrls = useMemo(
    () => resolveAudioStudioUrls(item, PROCESSOR_API),
    [item]
  );
  const audioUrlKey = audioUrls.join('|');
  const [sourceIndex, setSourceIndex] = useState(0);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    setSourceIndex(0);
    setUnavailable(false);
  }, [audioUrlKey]);

  if (audioUrls.length === 0 || unavailable) {
    return <div className={unavailableClassName}>Preview unavailable</div>;
  }
  const resolvedSourceIndex = Math.min(sourceIndex, audioUrls.length - 1);

  return (
    <audio
      key={audioUrls[resolvedSourceIndex]}
      className={className}
      controls
      preload="metadata"
      src={audioUrls[resolvedSourceIndex]}
      onClick={(event) => event.stopPropagation()}
      onError={() => {
        if (resolvedSourceIndex + 1 < audioUrls.length) {
          setSourceIndex(resolvedSourceIndex + 1);
        } else {
          setUnavailable(true);
        }
      }}
    >
      Your browser does not support audio playback.
    </audio>
  );
}

function AudioTypeTabs({ value, onChange, counts, buttonClassName }) {
  return (
    <div className="flex flex-wrap items-center gap-2" role="tablist" aria-label="Audio categories">
      {AUDIO_TYPES.map((audioType) => {
        const Icon = audioType.icon;
        const active = value === audioType.value;
        return (
          <button
            key={audioType.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(audioType.value)}
            className={`${buttonClassName} inline-flex min-h-9 items-center gap-2 rounded-full px-3 py-2 text-xs font-semibold transition ${
              active ? 'border-[#f6c453] bg-[#f6c453]/15 text-[#f6c453]' : ''
            }`}
          >
            <Icon className="shrink-0" />
            <span>{audioType.label}</span>
            {counts ? (
              <span className={`rounded-full px-1.5 py-0.5 text-[10px] ${active ? 'bg-[#f6c453]/15' : 'bg-black/10'}`}>
                {counts[audioType.value] || 0}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

function AudioLibraryCard({
  item,
  isDark,
  isSelected,
  selectionOrder,
  onSelect,
  selectable = false,
}) {
  const itemId = getAudioStudioItemId(item);
  const title = getAudioItemTitle(item);
  const description = getAudioItemDescription(item);
  const cardClass = isDark
    ? 'border-[#3a4050] bg-[#181b24] shadow-[0_14px_34px_rgba(0,0,0,0.25)]'
    : 'border-slate-200 bg-white shadow-[0_14px_30px_rgba(15,23,42,0.08)]';
  const mutedText = isDark ? 'text-slate-400' : 'text-slate-500';

  return (
    <article
      onClick={() => onSelect(item)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onSelect(item);
        }
      }}
      role={selectable ? 'checkbox' : 'button'}
      aria-checked={selectable ? isSelected : undefined}
      tabIndex={0}
      className={`relative overflow-hidden rounded-2xl border p-4 transition ${cardClass} ${
        isSelected ? 'ring-2 ring-[#f6c453]/75' : 'hover:-translate-y-0.5'
      }`}
    >
      <div className="flex items-start gap-3">
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onSelect(item);
          }}
          className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${
            isSelected ? 'bg-[#f6c453] text-[#111319]' : isDark ? 'bg-[#252936] text-[#ff7a84]' : 'bg-rose-50 text-rose-600'
          }`}
          aria-label={selectable ? `${isSelected ? 'Remove' : 'Select'} ${title}` : `View ${title}`}
        >
          {selectable && isSelected ? <FaCheck /> : <MdGraphicEq className="text-xl" />}
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <h3 className="truncate text-sm font-semibold" title={title}>{title}</h3>
              <div className={`mt-1 flex flex-wrap items-center gap-2 text-[11px] ${mutedText}`}>
                <span>{item.projectName || 'Audio Studio'}</span>
                <span aria-hidden="true">•</span>
                <span>{formatAudioStudioDuration(item.duration)}</span>
              </div>
            </div>
            {selectable && isSelected ? (
              <span className="flex h-7 min-w-7 items-center justify-center rounded-full bg-[#f6c453] px-2 text-xs font-bold text-[#111319]">
                {selectionOrder}
              </span>
            ) : null}
          </div>
          {description ? (
            <p className={`mt-2 line-clamp-2 text-xs leading-5 ${mutedText}`}>{description}</p>
          ) : null}
        </div>
      </div>
      <AudioStudioPlayer
        item={item}
        className="mt-4 h-9 w-full"
        unavailableClassName={`mt-4 rounded-lg px-3 py-2 text-xs ${mutedText}`}
      />
      <span className="sr-only">Audio library item {itemId}</span>
    </article>
  );
}

export default function AudioStudioHome() {
  const { colorMode } = useColorMode();
  const isDark = colorMode === 'dark';
  const { user, getUserAPI } = useUser();
  const { audioAvailability, isLoading: isAudioAvailabilityLoading } = useAudioProviderAvailability();

  const [activeAction, setActiveAction] = useState('generate');
  const [libraryItems, setLibraryItems] = useState([]);
  const [libraryLoading, setLibraryLoading] = useState(true);
  const [libraryLoadingMore, setLibraryLoadingMore] = useState(false);
  const [libraryError, setLibraryError] = useState('');
  const [libraryPage, setLibraryPage] = useState(0);
  const [libraryTotalPages, setLibraryTotalPages] = useState(0);
  const [libraryTotalItems, setLibraryTotalItems] = useState(0);
  const [categoryCounts, setCategoryCounts] = useState({
    [AUDIO_TYPE_MUSIC]: 0,
    [AUDIO_TYPE_SPEECH]: 0,
    [AUDIO_TYPE_SOUND_EFFECT]: 0,
  });
  const [libraryType, setLibraryType] = useState(AUDIO_TYPE_MUSIC);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedItem, setSelectedItem] = useState(null);

  const [generationType, setGenerationType] = useState(AUDIO_TYPE_MUSIC);
  const [prompt, setPrompt] = useState('');
  const [generationTitle, setGenerationTitle] = useState('');
  const [duration, setDuration] = useState(30);
  const [musicModel, setMusicModel] = useState(MUSIC_PROVIDERS[0]?.key || 'ELEVENLABS_MUSIC');
  const [speakerValue, setSpeakerValue] = useState('alloy');
  const [soundEffectModel, setSoundEffectModel] = useState('SDAUDIO');
  const [isInstrumental, setIsInstrumental] = useState(true);
  const [generationPending, setGenerationPending] = useState(false);
  const [generationStatus, setGenerationStatus] = useState('');
  const [generationError, setGenerationError] = useState('');

  const [joinType, setJoinType] = useState(AUDIO_TYPE_MUSIC);
  const [selectedJoinItems, setSelectedJoinItems] = useState([]);
  const [joinTitle, setJoinTitle] = useState('');
  const [fadeAudioAtEnds, setFadeAudioAtEnds] = useState(false);
  const [joinPending, setJoinPending] = useState(false);
  const [joinStatus, setJoinStatus] = useState('');
  const [joinError, setJoinError] = useState('');
  const [joinSuccess, setJoinSuccess] = useState('');

  const generationPollTimerRef = useRef(null);
  const joinPollTimerRef = useRef(null);
  const activeJoinRequestRef = useRef('');
  const libraryRequestRef = useRef(0);

  const surfaceClass = isDark
    ? 'bg-[#0c0d12] text-slate-100'
    : 'bg-[#eef3fb] text-slate-900';
  const panelClass = isDark
    ? 'border-[#3a4050] bg-[#15171f]'
    : 'border-slate-200 bg-white';
  const inputClass = isDark
    ? 'border-[#4a5265] bg-[#11131a] text-slate-100 placeholder:text-slate-500 focus:border-[#f6c453] focus:ring-[#f6c453]/20'
    : 'border-slate-300 bg-white text-slate-900 placeholder:text-slate-400 focus:border-rose-400 focus:ring-rose-300/30';
  const mutedText = isDark ? 'text-slate-400' : 'text-slate-500';
  const neutralButton = isDark
    ? 'border border-[#4a5265] bg-[#20232e] text-slate-200 hover:border-[#f6c453]/60 hover:bg-[#292d3a]'
    : 'border border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50';
  const actionButton = 'bg-gradient-to-r from-[#ff4655] to-[#ff704d] text-white shadow-[0_12px_28px_rgba(255,70,85,0.22)] hover:from-[#ff5e6b] hover:to-[#ff8165] disabled:cursor-not-allowed disabled:opacity-55';

  const availableMusicProviders = useMemo(
    () => filterMusicProvidersForAudioAvailability(MUSIC_PROVIDERS, audioAvailability),
    [audioAvailability]
  );
  const availableSpeakers = useMemo(
    () => filterSpeakersForAudioAvailability(TTS_COMBINED_SPEAKER_TYPES, audioAvailability),
    [audioAvailability]
  );
  const availableSoundEffectModels = useMemo(() => {
    if (!hasAudioAvailabilityRules(audioAvailability)) return SOUND_EFFECT_MODELS;
    const allowed = new Set(
      (audioAvailability.soundEffectProviders || []).map((provider) => provider.trim().toUpperCase())
    );
    if (allowed.size === 0) return [];
    return SOUND_EFFECT_MODELS.filter((model) => allowed.has(model.value));
  }, [audioAvailability]);

  useEffect(() => {
    if (availableMusicProviders.length > 0 && !availableMusicProviders.some((provider) => provider.key === musicModel)) {
      setMusicModel(availableMusicProviders[0].key);
    }
  }, [availableMusicProviders, musicModel]);

  useEffect(() => {
    if (availableSpeakers.length > 0 && !availableSpeakers.some((speaker) => speaker.value === speakerValue)) {
      setSpeakerValue(availableSpeakers[0].value);
    }
  }, [availableSpeakers, speakerValue]);

  useEffect(() => {
    if (availableSoundEffectModels.length > 0 && !availableSoundEffectModels.some((model) => model.value === soundEffectModel)) {
      setSoundEffectModel(availableSoundEffectModels[0].value);
    }
  }, [availableSoundEffectModels, soundEffectModel]);

  const fetchLibrary = useCallback(async ({
    page = 1,
    append = false,
    libraryTypeOverride,
    searchOverride,
  } = {}) => {
    if (!user?._id) return [];
    const requestNumber = libraryRequestRef.current + 1;
    libraryRequestRef.current = requestNumber;
    const requestedLibraryType = libraryTypeOverride || (
      activeAction === 'join' ? joinType : libraryType
    );
    const requestedSearch = searchOverride === undefined ? searchTerm.trim() : searchOverride;
    if (append) setLibraryLoadingMore(true);
    else setLibraryLoading(true);
    setLibraryError('');
    try {
      const response = await axios.get(`${PROCESSOR_API}/audio/studio/library`, {
        ...(getHeaders() || {}),
        params: {
          page,
          limit: AUDIO_LIBRARY_PAGE_SIZE,
          libraryType: requestedLibraryType,
          ...(requestedSearch ? { search: requestedSearch } : {}),
        },
      });
      if (libraryRequestRef.current !== requestNumber) return [];
      const items = Array.isArray(response.data?.items) ? response.data.items : [];
      setLibraryItems((currentItems) => {
        if (!append) return items;
        const itemById = new Map(
          [...currentItems, ...items].map((item) => [getAudioStudioItemId(item), item])
        );
        return Array.from(itemById.values());
      });
      setLibraryPage(Number(response.data?.page) || page);
      setLibraryTotalPages(Number(response.data?.totalPages) || 0);
      setLibraryTotalItems(Number(response.data?.totalItems) || 0);
      if (response.data?.categoryCounts) setCategoryCounts(response.data.categoryCounts);
      return items;
    } catch (error) {
      if (libraryRequestRef.current !== requestNumber) return [];
      setLibraryError(getApiErrorMessage(error, 'Unable to load your audio library.'));
      return [];
    } finally {
      if (libraryRequestRef.current === requestNumber) {
        setLibraryLoading(false);
        setLibraryLoadingMore(false);
      }
    }
  }, [activeAction, joinType, libraryType, searchTerm, user?._id]);

  useEffect(() => {
    libraryRequestRef.current += 1;
    setLibraryItems([]);
    setLibraryPage(0);
    const timer = window.setTimeout(() => {
      void fetchLibrary({ page: 1 });
    }, searchTerm ? 250 : 0);
    return () => window.clearTimeout(timer);
  }, [fetchLibrary]);

  useEffect(() => () => {
    if (generationPollTimerRef.current) window.clearTimeout(generationPollTimerRef.current);
    if (joinPollTimerRef.current) window.clearTimeout(joinPollTimerRef.current);
  }, []);

  const checkGenerationStatus = useCallback(async (requestId) => {
    if (!requestId) return;
    if (generationPollTimerRef.current) window.clearTimeout(generationPollTimerRef.current);
    try {
      const response = await axios.get(`${PROCESSOR_API}/audio/studio/status`, {
        ...(getHeaders() || {}),
        params: { requestId },
      });
      const status = (response.data?.status || 'PENDING').toString().toUpperCase();
      setGenerationStatus(status === 'PENDING' || status === 'INIT' ? 'Generating your audio…' : status);

      if (['COMPLETED', 'SUCCEEDED', 'SUCCESS', 'DONE'].includes(status)) {
        localStorage.removeItem(PENDING_AUDIO_STUDIO_REQUEST_KEY);
        setGenerationPending(false);
        setGenerationStatus('Audio ready');
        const completedType = response.data?.item?.libraryType || generationType;
        if (response.data?.item) {
          setSelectedItem(response.data.item);
        }
        setSearchTerm('');
        setLibraryType(completedType);
        await Promise.all([
          fetchLibrary({
            page: 1,
            libraryTypeOverride: completedType,
            searchOverride: '',
          }),
          getUserAPI(),
        ]);
        return;
      }
      if (['FAILED', 'ERROR', 'CANCELLED'].includes(status)) {
        localStorage.removeItem(PENDING_AUDIO_STUDIO_REQUEST_KEY);
        setGenerationPending(false);
        setGenerationError(response.data?.error || response.data?.message || 'Audio generation failed.');
        return;
      }

      generationPollTimerRef.current = window.setTimeout(
        () => void checkGenerationStatus(requestId),
        AUDIO_GENERATION_POLL_INTERVAL_MS
      );
    } catch (error) {
      const statusCode = error?.response?.status;
      if (statusCode === 404 || statusCode === 401) {
        localStorage.removeItem(PENDING_AUDIO_STUDIO_REQUEST_KEY);
        setGenerationPending(false);
        setGenerationError(getApiErrorMessage(error, 'The audio generation request is no longer available.'));
        return;
      }
      generationPollTimerRef.current = window.setTimeout(
        () => void checkGenerationStatus(requestId),
        AUDIO_GENERATION_POLL_INTERVAL_MS
      );
    }
  }, [fetchLibrary, generationType, getUserAPI]);

  useEffect(() => {
    const pendingRequestId = localStorage.getItem(PENDING_AUDIO_STUDIO_REQUEST_KEY);
    if (!pendingRequestId || !user?._id) return;
    setGenerationPending(true);
    setGenerationStatus('Checking your audio…');
    void checkGenerationStatus(pendingRequestId);
  }, [checkGenerationStatus, user?._id]);

  const checkJoinStatus = useCallback(async (requestId) => {
    if (!requestId) return;
    if (joinPollTimerRef.current) window.clearTimeout(joinPollTimerRef.current);
    try {
      const response = await axios.get(`${PROCESSOR_API}/audio/join/status`, {
        ...(getHeaders() || {}),
        params: { requestId },
      });
      const status = (response.data?.status || 'PENDING').toString().toUpperCase();
      setJoinPending(!['COMPLETED', 'FAILED', 'ERROR', 'CANCELLED'].includes(status));
      setJoinStatus(status === 'PROCESSING' ? 'Joining selected audio…' : 'Join queued…');

      if (status === 'COMPLETED') {
        localStorage.removeItem(PENDING_AUDIO_JOIN_REQUEST_KEY);
        activeJoinRequestRef.current = '';
        setJoinPending(false);
        setJoinStatus('Joined audio ready');
        const item = response.data?.item;
        const completedType = item?.libraryType || joinType;
        if (item) setSelectedItem(item);
        setSelectedJoinItems([]);
        setJoinTitle('');
        setFadeAudioAtEnds(false);
        setJoinSuccess(`Joined ${response.data?.joinedItemCount || 0} audio items.`);
        setSearchTerm('');
        setLibraryType(completedType);
        setActiveAction('generate');
        await Promise.all([
          fetchLibrary({
            page: 1,
            libraryTypeOverride: completedType,
            searchOverride: '',
          }),
          getUserAPI(),
        ]);
        return;
      }
      if (['FAILED', 'ERROR', 'CANCELLED'].includes(status)) {
        localStorage.removeItem(PENDING_AUDIO_JOIN_REQUEST_KEY);
        activeJoinRequestRef.current = '';
        setJoinPending(false);
        setJoinStatus('');
        setJoinError(response.data?.error || response.data?.message || 'Audio join failed.');
        return;
      }

      joinPollTimerRef.current = window.setTimeout(
        () => void checkJoinStatus(requestId),
        AUDIO_JOIN_POLL_INTERVAL_MS
      );
    } catch (error) {
      const statusCode = error?.response?.status;
      if (statusCode === 404 || statusCode === 401) {
        localStorage.removeItem(PENDING_AUDIO_JOIN_REQUEST_KEY);
        activeJoinRequestRef.current = '';
        setJoinPending(false);
        setJoinStatus('');
        setJoinError(getApiErrorMessage(error, 'The audio join request is no longer available.'));
        return;
      }
      joinPollTimerRef.current = window.setTimeout(
        () => void checkJoinStatus(requestId),
        AUDIO_JOIN_POLL_INTERVAL_MS
      );
    }
  }, [fetchLibrary, getUserAPI, joinType]);

  useEffect(() => {
    const pendingRequestId = localStorage.getItem(PENDING_AUDIO_JOIN_REQUEST_KEY);
    if (!pendingRequestId || !user?._id || activeJoinRequestRef.current === pendingRequestId) return;
    activeJoinRequestRef.current = pendingRequestId;
    setJoinPending(true);
    setJoinStatus('Checking joined audio…');
    void checkJoinStatus(pendingRequestId);
  }, [checkJoinStatus, user?._id]);

  useEffect(() => {
    if (!selectedItem && libraryItems.length > 0) {
      setSelectedItem(libraryItems[0]);
    }
  }, [libraryItems, selectedItem]);

  const selectedSpeaker = useMemo(
    () => availableSpeakers.find((speaker) => speaker.value === speakerValue) || availableSpeakers[0] || null,
    [availableSpeakers, speakerValue]
  );

  const handleGenerate = async (event) => {
    event.preventDefault();
    if (!prompt.trim() || generationPending) return;
    setGenerationError('');
    setGenerationStatus('Submitting generation…');
    setGenerationPending(true);

    const payload = {
      generationType,
      prompt: prompt.trim(),
      ...(generationTitle.trim() ? { title: generationTitle.trim() } : {}),
    };
    if (generationType === AUDIO_TYPE_MUSIC) {
      Object.assign(payload, {
        model: musicModel,
        duration: Number(duration),
        isInstrumental,
      });
    } else if (generationType === AUDIO_TYPE_SPEECH) {
      Object.assign(payload, {
        model: selectedSpeaker?.provider || 'OPENAI',
        provider: selectedSpeaker?.provider || 'OPENAI',
        speaker: selectedSpeaker?.value || 'alloy',
        speakerCharacterName: selectedSpeaker?.label || 'Voice',
      });
    } else {
      Object.assign(payload, {
        model: soundEffectModel,
        duration: Number(duration),
      });
    }

    try {
      const response = await axios.post(
        `${PROCESSOR_API}/audio/studio/generate`,
        payload,
        getHeaders()
      );
      const requestId = response.data?.request_id || response.data?.requestId;
      if (!requestId) throw new Error('The audio generation response did not include a request id.');
      localStorage.setItem(PENDING_AUDIO_STUDIO_REQUEST_KEY, requestId);
      setGenerationStatus('Generating your audio…');
      setLibraryType(generationType);
      await getUserAPI();
      void checkGenerationStatus(requestId);
    } catch (error) {
      setGenerationPending(false);
      setGenerationStatus('');
      setGenerationError(getApiErrorMessage(error, 'Unable to request audio generation.'));
    }
  };

  const handleJoinTypeChange = (nextType) => {
    setJoinType(nextType);
    setSelectedJoinItems([]);
    setJoinError('');
    setJoinSuccess('');
  };

  const toggleJoinSelection = (item) => {
    const itemId = getAudioStudioItemId(item);
    if (!itemId) return;
    setJoinError('');
    setJoinSuccess('');
    setSelectedJoinItems((currentItems) => (
      currentItems.some((currentItem) => getAudioStudioItemId(currentItem) === itemId)
        ? currentItems.filter((currentItem) => getAudioStudioItemId(currentItem) !== itemId)
        : currentItems.length >= 25
          ? currentItems
          : [...currentItems, item]
    ));
  };

  const moveJoinSelection = (itemId, direction) => {
    setSelectedJoinItems((currentItems) => {
      const currentIndex = currentItems.findIndex(
        (item) => getAudioStudioItemId(item) === itemId
      );
      const targetIndex = currentIndex + direction;
      if (currentIndex < 0 || targetIndex < 0 || targetIndex >= currentItems.length) {
        return currentItems;
      }
      const nextItems = [...currentItems];
      [nextItems[currentIndex], nextItems[targetIndex]] = [nextItems[targetIndex], nextItems[currentIndex]];
      return nextItems;
    });
  };

  const selectedJoinIds = useMemo(
    () => selectedJoinItems.map(getAudioStudioItemId).filter(Boolean),
    [selectedJoinItems]
  );

  const handleJoin = async (event) => {
    event.preventDefault();
    if (selectedJoinIds.length < 2 || joinPending) return;
    setJoinPending(true);
    setJoinError('');
    setJoinSuccess('');
    try {
      const response = await axios.post(
        `${PROCESSOR_API}/audio/join`,
        {
          audioItemIds: selectedJoinIds,
          libraryType: joinType,
          fadeAudioAtEnds,
          ...(joinTitle.trim() ? { title: joinTitle.trim() } : {}),
        },
        getHeaders()
      );
      const requestId = response.data?.requestId || response.data?.request_id;
      if (!requestId) throw new Error('The audio join response did not include a request id.');
      localStorage.setItem(PENDING_AUDIO_JOIN_REQUEST_KEY, requestId);
      activeJoinRequestRef.current = requestId;
      setJoinStatus('Join queued…');
      void checkJoinStatus(requestId);
    } catch (error) {
      setJoinPending(false);
      setJoinStatus('');
      setJoinError(getApiErrorMessage(error, 'Unable to join the selected audio items.'));
    }
  };

  const providerUnavailable = generationType === AUDIO_TYPE_MUSIC
    ? availableMusicProviders.length === 0
    : generationType === AUDIO_TYPE_SPEECH
      ? availableSpeakers.length === 0
      : availableSoundEffectModels.length === 0;

  return (
    <CommonContainer>
      <div className={`${surfaceClass} grid h-[100dvh] grid-cols-1 overflow-hidden pt-14 lg:grid-cols-[minmax(0,1fr)_minmax(290px,18%)]`}>
        <main className="min-h-0 overflow-y-auto px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          {activeAction === 'generate' ? (
            <div className="mx-auto max-w-6xl">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <div className="text-xs font-semibold uppercase tracking-[0.24em] text-[#ff6572]">Audio canvas</div>
                  <h1 className="mt-2 text-2xl font-semibold sm:text-3xl">Generate, preview, and organize audio</h1>
                  <p className={`mt-2 max-w-2xl text-sm ${mutedText}`}>
                    New audio appears here when generation completes. Browse your library by audio type and preview any item in place.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void fetchLibrary()}
                  className={`${neutralButton} inline-flex min-h-10 items-center justify-center gap-2 rounded-lg px-3 text-xs font-semibold`}
                >
                  <FaSyncAlt className={libraryLoading ? 'animate-spin' : ''} />
                  Refresh library
                </button>
              </div>

              {generationPending ? (
                <div className={`mt-6 flex items-center gap-3 rounded-2xl border p-4 ${panelClass}`} role="status">
                  <div className="h-9 w-9 animate-spin rounded-full border-2 border-[#ff6572] border-t-transparent" />
                  <div>
                    <div className="text-sm font-semibold">{generationStatus || 'Generating your audio…'}</div>
                    <div className={`mt-1 text-xs ${mutedText}`}>You can leave this view; polling resumes when you return.</div>
                  </div>
                </div>
              ) : null}

              {selectedItem ? (
                <section className={`mt-6 overflow-hidden rounded-3xl border ${panelClass}`} aria-label="Selected audio preview">
                  <div className="grid gap-0 md:grid-cols-[minmax(0,1fr)_260px]">
                    <div className="p-6 sm:p-8">
                      <div className="flex items-center gap-3">
                        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-[#ff4655] to-[#f6c453] text-xl text-white">
                          <MdGraphicEq />
                        </div>
                        <div className="min-w-0">
                          <div className={`text-xs font-semibold uppercase tracking-wider ${mutedText}`}>
                            {AUDIO_TYPE_LABELS[selectedItem.libraryType] || 'Audio'}
                          </div>
                          <h2 className="mt-1 truncate text-xl font-semibold">{getAudioItemTitle(selectedItem)}</h2>
                        </div>
                      </div>
                      {getAudioItemDescription(selectedItem) ? (
                        <p className={`mt-5 max-w-3xl text-sm leading-6 ${mutedText}`}>
                          {getAudioItemDescription(selectedItem)}
                        </p>
                      ) : null}
                      <AudioStudioPlayer
                        item={selectedItem}
                        className="mt-6 w-full"
                        unavailableClassName={`mt-6 rounded-xl border border-dashed p-4 text-sm ${panelClass} ${mutedText}`}
                      />
                    </div>
                    <div className={`flex flex-col justify-between border-t p-6 md:border-l md:border-t-0 ${isDark ? 'border-[#3a4050] bg-black/10' : 'border-slate-200 bg-slate-50'}`}>
                      <div>
                        <div className={`text-xs font-semibold uppercase tracking-wider ${mutedText}`}>Details</div>
                        <dl className="mt-4 space-y-3 text-sm">
                          <div className="flex items-center justify-between gap-3">
                            <dt className={mutedText}>Duration</dt>
                            <dd className="font-semibold">{formatAudioStudioDuration(selectedItem.duration)}</dd>
                          </div>
                          <div className="flex items-center justify-between gap-3">
                            <dt className={mutedText}>Source</dt>
                            <dd className="truncate font-semibold">{selectedItem.projectName || 'Audio Studio'}</dd>
                          </div>
                        </dl>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setActiveAction('join');
                          handleJoinTypeChange(selectedItem.libraryType || AUDIO_TYPE_MUSIC);
                        }}
                        className={`${neutralButton} mt-6 inline-flex min-h-10 items-center justify-center gap-2 rounded-lg px-3 text-xs font-semibold`}
                      >
                        <FaLink /> Use in Join Audio
                      </button>
                    </div>
                  </div>
                </section>
              ) : null}

              <section className="mt-8" aria-label="Audio library">
                <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
                  <AudioTypeTabs
                    value={libraryType}
                    onChange={setLibraryType}
                    counts={categoryCounts}
                    buttonClassName={neutralButton}
                  />
                  <label className="relative block w-full xl:max-w-xs">
                    <span className="sr-only">Search audio library</span>
                    <FaSearch className={`pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-xs ${mutedText}`} />
                    <input
                      type="search"
                      value={searchTerm}
                      onChange={(event) => setSearchTerm(event.target.value)}
                      placeholder="Search your audio"
                      className={`${inputClass} h-10 w-full rounded-xl border pl-9 pr-3 text-sm outline-none focus:ring-2`}
                    />
                  </label>
                </div>

                {libraryError ? <div className="mt-5 rounded-xl border border-red-400/30 bg-red-500/10 p-3 text-sm text-red-300">{libraryError}</div> : null}
                {libraryLoading && libraryItems.length === 0 ? (
                  <div className="grid gap-4 py-6 sm:grid-cols-2 xl:grid-cols-3">
                    {[0, 1, 2].map((item) => <div key={item} className={`h-40 animate-pulse rounded-2xl border ${panelClass}`} />)}
                  </div>
                ) : libraryItems.length > 0 ? (
                  <>
                    <div className="grid gap-4 py-6 sm:grid-cols-2 xl:grid-cols-3">
                      {libraryItems.map((item) => (
                        <AudioLibraryCard
                          key={getAudioStudioItemId(item)}
                          item={item}
                          isDark={isDark}
                          isSelected={getAudioStudioItemId(selectedItem) === getAudioStudioItemId(item)}
                          onSelect={setSelectedItem}
                        />
                      ))}
                    </div>
                    {libraryPage < libraryTotalPages ? (
                      <div className="flex justify-center pb-3">
                        <button
                          type="button"
                          disabled={libraryLoadingMore}
                          onClick={() => void fetchLibrary({ page: libraryPage + 1, append: true })}
                          className={`${neutralButton} inline-flex min-h-10 items-center justify-center gap-2 rounded-lg px-4 text-xs font-semibold disabled:opacity-55`}
                        >
                          {libraryLoadingMore ? <FaSyncAlt className="animate-spin" /> : null}
                          Load more ({libraryItems.length} of {libraryTotalItems})
                        </button>
                      </div>
                    ) : null}
                  </>
                ) : (
                  <div className={`mt-6 rounded-2xl border border-dashed p-10 text-center ${panelClass}`}>
                    <MdGraphicEq className={`mx-auto text-4xl ${mutedText}`} />
                    <div className="mt-4 text-sm font-semibold">No {AUDIO_TYPE_LABELS[libraryType].toLowerCase()} yet</div>
                    <div className={`mt-2 text-xs ${mutedText}`}>Use Generate audio to create the first item in this category.</div>
                  </div>
                )}
              </section>
            </div>
          ) : (
            <div className="mx-auto max-w-6xl">
              <div>
                <div className="text-xs font-semibold uppercase tracking-[0.24em] text-[#ff6572]">Join Audio</div>
                <h1 className="mt-2 text-2xl font-semibold sm:text-3xl">Build one longer MP3</h1>
                <p className={`mt-2 max-w-2xl text-sm ${mutedText}`}>
                  Pick two or more items from one category. Numbered badges show the exact order used in the joined track.
                </p>
              </div>

              <div className="mt-6 flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
                <AudioTypeTabs
                  value={joinType}
                  onChange={handleJoinTypeChange}
                  counts={categoryCounts}
                  buttonClassName={neutralButton}
                />
                <label className="relative block w-full xl:max-w-xs">
                  <span className="sr-only">Search join audio library</span>
                  <FaSearch className={`pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-xs ${mutedText}`} />
                  <input
                    type="search"
                    value={searchTerm}
                    onChange={(event) => setSearchTerm(event.target.value)}
                    placeholder="Search this category"
                    className={`${inputClass} h-10 w-full rounded-xl border pl-9 pr-3 text-sm outline-none focus:ring-2`}
                  />
                </label>
              </div>

              {libraryItems.length > 0 ? (
                <>
                  <div className="grid gap-4 py-6 sm:grid-cols-2 xl:grid-cols-3">
                    {libraryItems.map((item) => {
                      const itemId = getAudioStudioItemId(item);
                      const selectionIndex = selectedJoinIds.indexOf(itemId);
                      return (
                        <AudioLibraryCard
                          key={itemId}
                          item={item}
                          isDark={isDark}
                          isSelected={selectionIndex >= 0}
                          selectionOrder={selectionIndex + 1}
                          onSelect={toggleJoinSelection}
                          selectable
                        />
                      );
                    })}
                  </div>
                  {libraryPage < libraryTotalPages ? (
                    <div className="flex justify-center pb-3">
                      <button
                        type="button"
                        disabled={libraryLoadingMore}
                        onClick={() => void fetchLibrary({ page: libraryPage + 1, append: true })}
                        className={`${neutralButton} inline-flex min-h-10 items-center justify-center gap-2 rounded-lg px-4 text-xs font-semibold disabled:opacity-55`}
                      >
                        {libraryLoadingMore ? <FaSyncAlt className="animate-spin" /> : null}
                        Load more ({libraryItems.length} of {libraryTotalItems})
                      </button>
                    </div>
                  ) : null}
                </>
              ) : (
                <div className={`mt-6 rounded-2xl border border-dashed p-10 text-center ${panelClass}`}>
                  <FaLink className={`mx-auto text-3xl ${mutedText}`} />
                  <div className="mt-4 text-sm font-semibold">No matching audio to join</div>
                  <div className={`mt-2 text-xs ${mutedText}`}>Generate or upload more {AUDIO_TYPE_LABELS[joinType].toLowerCase()} first.</div>
                </div>
              )}
            </div>
          )}
        </main>

        <aside className={`min-h-0 overflow-y-auto border-t p-4 lg:border-l lg:border-t-0 lg:p-5 ${panelClass}`} aria-label="Audio Studio actions">
          <div className="grid grid-cols-2 gap-2 lg:grid-cols-1">
            <button
              type="button"
              onClick={() => setActiveAction('generate')}
              className={`flex min-h-12 items-center gap-3 rounded-xl border px-3 text-left text-sm font-semibold transition ${
                activeAction === 'generate'
                  ? 'border-[#ff6572] bg-[#ff4655]/15 text-[#ff7a84]'
                  : neutralButton
              }`}
            >
              <MdGraphicEq className="text-xl" />
              Generate audio
            </button>
            <button
              type="button"
              onClick={() => setActiveAction('join')}
              className={`flex min-h-12 items-center gap-3 rounded-xl border px-3 text-left text-sm font-semibold transition ${
                activeAction === 'join'
                  ? 'border-[#f6c453] bg-[#f6c453]/15 text-[#f6c453]'
                  : neutralButton
              }`}
            >
              <FaLink className="text-base" />
              Join Audio
            </button>
          </div>

          {activeAction === 'generate' ? (
            <form className="mt-6" onSubmit={handleGenerate}>
              <div className="text-sm font-semibold">Generate audio</div>
              <p className={`mt-1 text-xs leading-5 ${mutedText}`}>Choose a type, describe the result, then keep this panel open while it is queued.</p>

              <label className="mt-5 block text-xs font-semibold" htmlFor="audio-generation-type">Audio type</label>
              <select
                id="audio-generation-type"
                value={generationType}
                onChange={(event) => {
                  setGenerationType(event.target.value);
                  setDuration(event.target.value === AUDIO_TYPE_SOUND_EFFECT ? 5 : 30);
                  setGenerationError('');
                }}
                className={`${inputClass} mt-2 h-10 w-full rounded-lg border px-3 text-sm outline-none focus:ring-2`}
              >
                {AUDIO_TYPES.map((audioType) => <option key={audioType.value} value={audioType.value}>{audioType.label}</option>)}
              </select>

              <label className="mt-4 block text-xs font-semibold" htmlFor="audio-generation-prompt">
                {generationType === AUDIO_TYPE_SPEECH ? 'Script' : 'Prompt'}
              </label>
              <textarea
                id="audio-generation-prompt"
                rows={5}
                maxLength={6000}
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                placeholder={generationType === AUDIO_TYPE_SPEECH
                  ? 'Enter the words to speak…'
                  : generationType === AUDIO_TYPE_MUSIC
                    ? 'Warm cinematic strings with a gentle pulse…'
                    : 'A wooden door closing in a quiet room…'}
                className={`${inputClass} mt-2 w-full resize-y rounded-lg border px-3 py-2 text-sm leading-5 outline-none focus:ring-2`}
              />

              <label className="mt-4 block text-xs font-semibold" htmlFor="audio-generation-title">Title <span className={mutedText}>(optional)</span></label>
              <input
                id="audio-generation-title"
                type="text"
                maxLength={120}
                value={generationTitle}
                onChange={(event) => setGenerationTitle(event.target.value)}
                placeholder="Name this audio"
                className={`${inputClass} mt-2 h-10 w-full rounded-lg border px-3 text-sm outline-none focus:ring-2`}
              />

              {generationType === AUDIO_TYPE_MUSIC ? (
                <>
                  <label className="mt-4 block text-xs font-semibold" htmlFor="audio-music-model">Provider</label>
                  <select
                    id="audio-music-model"
                    value={musicModel}
                    onChange={(event) => setMusicModel(event.target.value)}
                    disabled={availableMusicProviders.length === 0}
                    className={`${inputClass} mt-2 h-10 w-full rounded-lg border px-3 text-sm outline-none focus:ring-2 disabled:opacity-50`}
                  >
                    {availableMusicProviders.map((provider) => <option key={provider.key} value={provider.key}>{provider.name}</option>)}
                  </select>
                  <label className={`mt-4 flex cursor-pointer items-center gap-2 text-xs ${mutedText}`}>
                    <input type="checkbox" checked={isInstrumental} onChange={(event) => setIsInstrumental(event.target.checked)} className="h-4 w-4 accent-[#ff4655]" />
                    Instrumental track
                  </label>
                </>
              ) : null}

              {generationType === AUDIO_TYPE_SPEECH ? (
                <>
                  <label className="mt-4 block text-xs font-semibold" htmlFor="audio-speech-voice">Voice</label>
                  <select
                    id="audio-speech-voice"
                    value={speakerValue}
                    onChange={(event) => setSpeakerValue(event.target.value)}
                    disabled={availableSpeakers.length === 0}
                    className={`${inputClass} mt-2 h-10 w-full rounded-lg border px-3 text-sm outline-none focus:ring-2 disabled:opacity-50`}
                  >
                    {availableSpeakers.map((speaker) => (
                      <option key={`${speaker.provider}:${speaker.value}`} value={speaker.value}>{speaker.label} · {speaker.provider}</option>
                    ))}
                  </select>
                </>
              ) : null}

              {generationType === AUDIO_TYPE_SOUND_EFFECT ? (
                <>
                  <label className="mt-4 block text-xs font-semibold" htmlFor="audio-sound-model">Provider</label>
                  <select
                    id="audio-sound-model"
                    value={soundEffectModel}
                    onChange={(event) => setSoundEffectModel(event.target.value)}
                    disabled={availableSoundEffectModels.length === 0}
                    className={`${inputClass} mt-2 h-10 w-full rounded-lg border px-3 text-sm outline-none focus:ring-2 disabled:opacity-50`}
                  >
                    {availableSoundEffectModels.map((model) => <option key={model.value} value={model.value}>{model.label}</option>)}
                  </select>
                </>
              ) : null}

              {generationType !== AUDIO_TYPE_SPEECH ? (
                <label className="mt-4 block text-xs font-semibold" htmlFor="audio-generation-duration">
                  Duration <span className={mutedText}>({duration}s)</span>
                  <input
                    id="audio-generation-duration"
                    type="range"
                    min={generationType === AUDIO_TYPE_MUSIC ? 3 : 1}
                    max={generationType === AUDIO_TYPE_MUSIC ? 180 : 30}
                    step="1"
                    value={duration}
                    onChange={(event) => setDuration(Number(event.target.value))}
                    className="mt-3 w-full accent-[#ff4655]"
                  />
                </label>
              ) : null}

              {providerUnavailable && !isAudioAvailabilityLoading ? (
                <div className="mt-4 rounded-lg border border-amber-400/25 bg-amber-400/10 p-3 text-xs text-amber-300">
                  No provider for this audio type is configured on this deployment.
                </div>
              ) : null}
              {generationError ? <div className="mt-4 rounded-lg border border-red-400/30 bg-red-500/10 p-3 text-xs text-red-300">{generationError}</div> : null}
              {generationStatus && !generationError ? <div className={`mt-4 text-xs ${mutedText}`}>{generationStatus}</div> : null}

              <button
                type="submit"
                disabled={!prompt.trim() || generationPending || providerUnavailable || isAudioAvailabilityLoading}
                className={`${actionButton} mt-5 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold`}
              >
                {generationPending ? <><FaSyncAlt className="animate-spin" /> Generating…</> : <><MdGraphicEq className="text-lg" /> Generate audio</>}
              </button>
            </form>
          ) : (
            <form className="mt-6" onSubmit={handleJoin}>
              <div className="text-sm font-semibold">Join selected audio</div>
              <p className={`mt-1 text-xs leading-5 ${mutedText}`}>The list below is the final playback order. This action does not consume credits.</p>

              <label className="mt-5 block text-xs font-semibold" htmlFor="joined-audio-title">Output title <span className={mutedText}>(optional)</span></label>
              <input
                id="joined-audio-title"
                type="text"
                maxLength={120}
                value={joinTitle}
                onChange={(event) => setJoinTitle(event.target.value)}
                placeholder={`Joined ${AUDIO_TYPE_LABELS[joinType]}`}
                className={`${inputClass} mt-2 h-10 w-full rounded-lg border px-3 text-sm outline-none focus:ring-2`}
              />

              <div className="mt-5 flex items-center justify-between gap-3">
                <div className="text-xs font-semibold">Playback order</div>
                <div className={`text-[11px] ${mutedText}`}>{selectedJoinItems.length}/25 selected</div>
              </div>

              {selectedJoinItems.length > 0 ? (
                <ol className="mt-3 space-y-2">
                  {selectedJoinItems.map((item, index) => {
                    const itemId = getAudioStudioItemId(item);
                    return (
                      <li key={itemId} className={`flex items-center gap-2 rounded-lg border p-2 ${isDark ? 'border-[#3a4050] bg-[#11131a]' : 'border-slate-200 bg-slate-50'}`}>
                        <FaGripVertical className={`shrink-0 ${mutedText}`} />
                        <span className="flex h-6 min-w-6 items-center justify-center rounded-full bg-[#f6c453] text-[11px] font-bold text-[#111319]">{index + 1}</span>
                        <span className="min-w-0 flex-1 truncate text-xs font-semibold">{getAudioItemTitle(item)}</span>
                        <div className="flex items-center gap-1">
                          <button type="button" disabled={index === 0} onClick={() => moveJoinSelection(itemId, -1)} className={`${neutralButton} flex h-7 w-7 items-center justify-center rounded-md disabled:opacity-30`} aria-label={`Move ${getAudioItemTitle(item)} earlier`}><FaArrowUp className="text-[10px]" /></button>
                          <button type="button" disabled={index === selectedJoinItems.length - 1} onClick={() => moveJoinSelection(itemId, 1)} className={`${neutralButton} flex h-7 w-7 items-center justify-center rounded-md disabled:opacity-30`} aria-label={`Move ${getAudioItemTitle(item)} later`}><FaArrowDown className="text-[10px]" /></button>
                          <button type="button" onClick={() => toggleJoinSelection(item)} className={`${neutralButton} flex h-7 w-7 items-center justify-center rounded-md`} aria-label={`Remove ${getAudioItemTitle(item)}`}><FaTimes className="text-[10px]" /></button>
                        </div>
                      </li>
                    );
                  })}
                </ol>
              ) : (
                <div className={`mt-3 rounded-xl border border-dashed p-5 text-center text-xs ${isDark ? 'border-[#4a5265]' : 'border-slate-300'} ${mutedText}`}>
                  Select audio cards in the center view.
                </div>
              )}

              {selectedJoinItems.length > 0 ? (
                <label className={`mt-4 flex cursor-pointer items-start gap-3 rounded-xl border p-3 text-xs ${panelClass}`}>
                  <input
                    type="checkbox"
                    checked={fadeAudioAtEnds}
                    disabled={joinPending}
                    onChange={(event) => setFadeAudioAtEnds(event.target.checked)}
                    className="mt-0.5 h-4 w-4 shrink-0 accent-[#ff4655]"
                  />
                  <span>
                    <span className="block font-semibold">Fade audio at ends</span>
                    <span className={`mt-1 block leading-5 ${mutedText}`}>
                      Softly fades each selected clip in and out for smoother joins.
                    </span>
                  </span>
                </label>
              ) : null}

              {joinError ? <div className="mt-4 rounded-lg border border-red-400/30 bg-red-500/10 p-3 text-xs text-red-300">{joinError}</div> : null}
              {joinSuccess ? <div className="mt-4 rounded-lg border border-emerald-400/30 bg-emerald-500/10 p-3 text-xs text-emerald-300">{joinSuccess}</div> : null}
              {joinPending && joinStatus ? <div className={`mt-4 text-xs ${mutedText}`}>{joinStatus}</div> : null}

              {selectedJoinIds.length > 0 ? (
                <>
                  <button
                    type="submit"
                    disabled={selectedJoinIds.length < 2 || joinPending}
                    className={`${actionButton} mt-5 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold`}
                  >
                    {joinPending ? <><FaSyncAlt className="animate-spin" /> Joining…</> : <><FaLink /> Submit join</>}
                  </button>
                  {selectedJoinIds.length === 1 ? (
                    <div className={`mt-2 text-center text-[11px] ${mutedText}`}>Select one more audio item to submit.</div>
                  ) : null}
                </>
              ) : null}
              <div className={`mt-3 flex items-center justify-center gap-2 text-[11px] ${mutedText}`}>
                <FaCheck className="text-emerald-400" /> Authenticated · Unmetered
              </div>
            </form>
          )}
        </aside>
      </div>
    </CommonContainer>
  );
}
