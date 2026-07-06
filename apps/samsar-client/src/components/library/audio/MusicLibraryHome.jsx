import { useCallback, useEffect, useRef, useState } from 'react';
import axios from 'axios';
import {
  FaCheck,
  FaChevronLeft,
  FaChevronRight,
  FaCopy,
  FaDownload,
  FaPause,
  FaPlay,
  FaSearch,
  FaUpload,
} from 'react-icons/fa';
import { getHeaders } from '../../../utils/web';
import { useColorMode } from '../../../contexts/ColorMode';

const API_SERVER = import.meta.env.VITE_PROCESSOR_API;
const AUDIO_LIBRARY_PAGE_SIZE = 9;
const LIBRARY_SCOPE_PROJECT = 'project';
const LIBRARY_SCOPE_GLOBAL = 'global';
const AUDIO_TYPE_MUSIC = 'music';
const AUDIO_TYPE_SPEECH = 'speech';
const AUDIO_TYPE_SOUND_EFFECT = 'sound_effect';

const EMPTY_GLOBAL_ARTIFACTS = {
  music: [],
  speech: [],
  soundEffect: [],
};

function normalizeSessionId(value) {
  if (typeof value === 'string' && value.trim()) {
    return value.trim();
  }

  if (value && typeof value.toString === 'function') {
    const stringValue = value.toString();
    if (typeof stringValue === 'string' && stringValue.trim()) {
      return stringValue.trim();
    }
  }

  return '';
}

function normalizeAudioLibraryType(generationType) {
  const normalizedGenerationType = typeof generationType === 'string'
    ? generationType.trim().toLowerCase()
    : '';

  if (normalizedGenerationType === 'music' || normalizedGenerationType === 'background_music') {
    return AUDIO_TYPE_MUSIC;
  }

  if (
    normalizedGenerationType === 'speech' ||
    normalizedGenerationType === 'lip_sync' ||
    normalizedGenerationType === 'custom_speech' ||
    normalizedGenerationType === 'recorded_speech'
  ) {
    return AUDIO_TYPE_SPEECH;
  }

  return AUDIO_TYPE_SOUND_EFFECT;
}

function resolveAudioPath(item = {}) {
  if (typeof item.selectedLocalAudioLink === 'string' && item.selectedLocalAudioLink.trim()) {
    return item.selectedLocalAudioLink.trim();
  }

  if (Array.isArray(item.localAudioLinks) && item.localAudioLinks.length > 0) {
    const localAudioLink = item.localAudioLinks.find((link) => typeof link === 'string' && link.trim());
    if (localAudioLink) {
      return localAudioLink.trim();
    }
  }

  if (typeof item.url === 'string' && item.url.trim()) {
    return item.url.trim();
  }

  if (typeof item.selectedRemoteAudioLink === 'string' && item.selectedRemoteAudioLink.trim()) {
    return item.selectedRemoteAudioLink.trim();
  }

  if (Array.isArray(item.remoteAudioLinks) && item.remoteAudioLinks.length > 0) {
    const remoteAudioLink = item.remoteAudioLinks.find((link) => typeof link === 'string' && link.trim());
    if (remoteAudioLink) {
      return remoteAudioLink.trim();
    }
  }

  if (Array.isArray(item.remoteAudioData) && item.remoteAudioData.length > 0) {
    const remoteAudioData = item.remoteAudioData.find((audioData) => (
      typeof audioData?.audio_url === 'string' && audioData.audio_url.trim()
    ));

    if (remoteAudioData?.audio_url) {
      return remoteAudioData.audio_url.trim();
    }
  }

  return null;
}

function resolveAudioUrl(item = {}) {
  const audioPath = resolveAudioPath(item);
  if (!audioPath) {
    return null;
  }

  if (/^https?:\/\//i.test(audioPath)) {
    return audioPath;
  }

  return `${API_SERVER}/${audioPath.replace(/^\/+/, '')}`;
}

function getProjectName(sessionDetails) {
  if (typeof sessionDetails?.sessionName === 'string' && sessionDetails.sessionName.trim()) {
    return sessionDetails.sessionName.trim();
  }

  const sessionId = sessionDetails?._id?.toString?.() || '';
  if (sessionId) {
    return `Project ${sessionId.slice(-6)}`;
  }

  return 'Current Project';
}

function getDisplayTitle(item, libraryType) {
  const title = typeof item.title === 'string' ? item.title.trim() : '';
  const speakerCharacterName = typeof item.speakerCharacterName === 'string'
    ? item.speakerCharacterName.trim()
    : '';
  const promptText = getPromptText(item);
  const hasDistinctTitle = title
    && (!promptText || title.toLowerCase() !== promptText.toLowerCase());

  if (libraryType === AUDIO_TYPE_SPEECH) {
    return (hasDistinctTitle ? title : '') || speakerCharacterName || 'Speech';
  }

  if (libraryType === AUDIO_TYPE_MUSIC) {
    return (hasDistinctTitle ? title : '') || 'Music';
  }

  return (hasDistinctTitle ? title : '') || 'Sound Effect';
}

function getPromptText(item = {}) {
  const prompt = typeof item.prompt === 'string' ? item.prompt.trim() : '';
  if (prompt) {
    return prompt;
  }

  const description = typeof item.description === 'string' ? item.description.trim() : '';
  return description;
}

function resolveLibraryItemDurationSeconds(item = {}) {
  const libraryType = normalizeAudioLibraryType(item?.libraryType || item?.generationType);
  const parsedOriginalDuration = Number(item.originalDuration ?? item.sourceDuration);

  if (
    libraryType === AUDIO_TYPE_SPEECH
    && Number.isFinite(parsedOriginalDuration)
    && parsedOriginalDuration > 0
  ) {
    return parsedOriginalDuration;
  }

  const parsedDuration = Number(item.duration);
  if (Number.isFinite(parsedDuration) && parsedDuration > 0) {
    return parsedDuration;
  }

  if (Number.isFinite(parsedOriginalDuration) && parsedOriginalDuration > 0) {
    return parsedOriginalDuration;
  }

  return null;
}

function getDefaultDurationValue(item = {}) {
  const parsedDuration = resolveLibraryItemDurationSeconds(item);
  if (Number.isFinite(parsedDuration) && parsedDuration > 0) {
    return `${parsedDuration}`;
  }

  return '5';
}

function getSessionEndTime(sessionDetails = {}) {
  const sessionLayers = Array.isArray(sessionDetails?.layers) ? sessionDetails.layers : [];
  const explicitEndTime = sessionLayers.reduce((maxEndTime, layer) => {
    const layerDuration = Number(layer?.duration) || 0;
    const layerOffset = Number(layer?.durationOffset) || 0;
    return Math.max(maxEndTime, layerOffset + layerDuration);
  }, 0);

  if (explicitEndTime > 0) {
    return explicitEndTime;
  }

  return sessionLayers.reduce((totalDuration, layer) => {
    return totalDuration + (Number(layer?.duration) || 0);
  }, 0);
}

function formatTimelineValue(value) {
  if (!Number.isFinite(value)) {
    return '--';
  }

  const roundedValue = Math.round(value * 10) / 10;
  return Number.isInteger(roundedValue) ? `${roundedValue}` : roundedValue.toFixed(1);
}

function getAudioItemTimestamp(item = {}) {
  const candidates = [
    item.updatedAt,
    item.createdAt,
    item.generationMeta?.completedAt,
    item.generationMeta?.createdAt,
  ];

  for (const candidate of candidates) {
    const timestamp = Date.parse(candidate || '');
    if (Number.isFinite(timestamp)) {
      return timestamp;
    }
  }

  const idValue = typeof item._id === 'string' ? item._id : '';
  const objectIdMatch = idValue.match(/[a-f0-9]{24}/i);
  if (objectIdMatch) {
    const objectIdSeconds = parseInt(objectIdMatch[0].slice(0, 8), 16);
    if (Number.isFinite(objectIdSeconds)) {
      return objectIdSeconds * 1000;
    }
  }

  return 0;
}

function sortAudioItemsByRecency(items = []) {
  return [...items].sort((leftItem, rightItem) => (
    getAudioItemTimestamp(rightItem) - getAudioItemTimestamp(leftItem)
  ));
}

function groupAudioItemsByProjectForDisplay(items = []) {
  const groupsByProjectId = new Map();

  items.forEach((item) => {
    const projectId = normalizeSessionId(item?.projectId) || normalizeSessionId(item?.sessionId) || 'unknown_project';
    const projectName = typeof item?.projectName === 'string' && item.projectName.trim()
      ? item.projectName.trim()
      : 'Untitled Project';
    const group = groupsByProjectId.get(projectId) || {
      projectId,
      projectName,
      items: [],
    };

    group.items.push(item);
    groupsByProjectId.set(projectId, group);
  });

  return Array.from(groupsByProjectId.values());
}

function getItemTags(item, libraryType) {
  const tagSet = new Set();

  if (Array.isArray(item.tags)) {
    item.tags.forEach((tag) => {
      if (typeof tag === 'string' && tag.trim()) {
        tagSet.add(tag.trim());
      }
    });
  }

  if (libraryType === AUDIO_TYPE_SPEECH && typeof item.speakerCharacterName === 'string' && item.speakerCharacterName.trim()) {
    tagSet.add(item.speakerCharacterName.trim());
  }

  if (typeof item.generationType === 'string' && item.generationType.trim()) {
    tagSet.add(item.generationType.trim());
  }

  return Array.from(tagSet);
}

function mapSessionAudioLayerToLibraryItem(audioLayer, index, sessionDetails) {
  const audioPath = resolveAudioPath(audioLayer);
  if (!audioPath) {
    return null;
  }

  const libraryType = normalizeAudioLibraryType(audioLayer?.generationType);
  const sessionId = sessionDetails?._id?.toString?.() || '';
  const sourceDuration = resolveLibraryItemDurationSeconds({ ...audioLayer, libraryType });

  return {
    ...audioLayer,
    _id: audioLayer?._id?.toString?.() || audioLayer?._id || `${sessionId}:${libraryType}:${index}`,
    sessionId,
    projectId: sessionId,
    projectName: getProjectName(sessionDetails),
    libraryType,
    title: getDisplayTitle(audioLayer, libraryType),
    description: typeof audioLayer?.prompt === 'string' ? audioLayer.prompt : '',
    url: audioPath,
    duration: sourceDuration || audioLayer?.duration,
    originalDuration: sourceDuration || audioLayer?.originalDuration,
    createdAt: audioLayer?.updatedAt || audioLayer?.createdAt || sessionDetails?.updatedAt || sessionDetails?.createdAt || null,
    connectedLayerId: libraryType === AUDIO_TYPE_SPEECH ? undefined : audioLayer?.connectedLayerId,
    connectedLayerIndex: libraryType === AUDIO_TYPE_SPEECH ? undefined : audioLayer?.connectedLayerIndex,
    connectedLayerStartTimeOffset: libraryType === AUDIO_TYPE_SPEECH
      ? undefined
      : audioLayer?.connectedLayerStartTimeOffset,
    tags: getItemTags(audioLayer, libraryType),
  };
}

function mapGeneratedMusicToProjectLibraryItem(generatedMusic, projectName, fallbackSessionId) {
  const audioPath = resolveAudioPath(generatedMusic);
  if (!audioPath) {
    return null;
  }

  const sessionId = normalizeSessionId(generatedMusic?.sessionId) || normalizeSessionId(fallbackSessionId);
  const generationType = typeof generatedMusic?.generationType === 'string' && generatedMusic.generationType.trim()
    ? generatedMusic.generationType.trim()
    : AUDIO_TYPE_MUSIC;
  const libraryType = normalizeAudioLibraryType(generatedMusic?.libraryType || generationType);
  const generatedMusicItem = {
    ...generatedMusic,
    generationType,
    libraryType,
  };

  return {
    ...generatedMusicItem,
    _id: `generated_music:${generatedMusic?._id?.toString?.() || generatedMusic?._id || audioPath}`,
    sessionId,
    projectId: sessionId,
    projectName: projectName || 'Current Project',
    libraryType,
    title: getDisplayTitle(generatedMusicItem, libraryType),
    description: typeof generatedMusic?.description === 'string' ? generatedMusic.description : '',
    prompt: typeof generatedMusic?.prompt === 'string' ? generatedMusic.prompt : '',
    url: audioPath,
    localAudioLinks: Array.isArray(generatedMusic?.localAudioLinks) && generatedMusic.localAudioLinks.length > 0
      ? generatedMusic.localAudioLinks
      : [audioPath],
    selectedLocalAudioLink: generatedMusic?.selectedLocalAudioLink || audioPath,
    tags: getItemTags(generatedMusicItem, libraryType),
  };
}

function dedupeProjectLibraryItems(items = []) {
  const seenKeys = new Set();

  return items.filter((item) => {
    const libraryType = item?.libraryType || normalizeAudioLibraryType(item?.generationType);
    const audioPath = resolveAudioPath(item) || item?.url || '';
    const dedupeKey = [
      normalizeSessionId(item?.sessionId) || normalizeSessionId(item?.projectId),
      libraryType,
      audioPath,
      getDisplayTitle(item, libraryType),
    ].join('|');

    if (seenKeys.has(dedupeKey)) {
      return false;
    }

    seenKeys.add(dedupeKey);
    return true;
  });
}

function matchesAudioSearch(item, searchTerm) {
  if (!searchTerm || !searchTerm.trim()) {
    return true;
  }

  const normalizedSearchTerm = searchTerm.trim().toLowerCase();
  const searchableText = [
    item?.title,
    item?.description,
    item?.prompt,
    item?.projectName,
    item?.speakerCharacterName,
    item?.generationType,
    ...(Array.isArray(item?.tags) ? item.tags : []),
  ]
    .filter((value) => typeof value === 'string' && value.trim())
    .join(' ')
    .toLowerCase();

  return searchableText.includes(normalizedSearchTerm);
}

function formatTime(time) {
  if (!Number.isFinite(time)) {
    return '00:00';
  }

  const minutes = Math.floor(time / 60);
  const seconds = Math.floor(time % 60);
  return `${minutes < 10 ? `0${minutes}` : minutes}:${seconds < 10 ? `0${seconds}` : seconds}`;
}

function getAudioTypeLabel(audioType) {
  if (audioType === AUDIO_TYPE_SPEECH) {
    return 'Speech';
  }

  if (audioType === AUDIO_TYPE_SOUND_EFFECT) {
    return 'Sound Effect';
  }

  return 'Music';
}

function getScopeLabel(scope) {
  return scope === LIBRARY_SCOPE_GLOBAL ? 'Global' : 'Project';
}

export default function MusicLibraryHome({
  onSelectMusic,
  hideSelectButton,
  sessionDetails,
  sessionId,
  currentLayer,
}) {
  const [globalArtifacts, setGlobalArtifacts] = useState(EMPTY_GLOBAL_ARTIFACTS);
  const [projectGeneratedMusicItems, setProjectGeneratedMusicItems] = useState([]);
  const [selectedScope, setSelectedScope] = useState(LIBRARY_SCOPE_PROJECT);
  const [selectedAudioType, setSelectedAudioType] = useState(AUDIO_TYPE_MUSIC);
  const [searchTerm, setSearchTerm] = useState('');
  const [playingSongId, setPlayingSongId] = useState(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isGlobalLibraryLoading, setIsGlobalLibraryLoading] = useState(false);
  const [globalLibraryError, setGlobalLibraryError] = useState('');
  const [addConfigByItemId, setAddConfigByItemId] = useState({});
  const [copiedPromptId, setCopiedPromptId] = useState(null);
  const [isAudioUploadPending, setIsAudioUploadPending] = useState(false);
  const [audioUploadError, setAudioUploadError] = useState('');
  const [currentAudioPage, setCurrentAudioPage] = useState(1);

  const audioRef = useRef(new Audio());
  const uploadInputRef = useRef(null);
  const { colorMode } = useColorMode();
  const currentProjectName = getProjectName(sessionDetails);

  const textColor = colorMode === 'dark' ? 'text-slate-100' : 'text-slate-900';
  const borderColor = colorMode === 'dark' ? 'border-[#1f2a3d]' : 'border-slate-200';
  const cardBg = colorMode === 'dark' ? 'bg-[#0f1629]' : 'bg-white';
  const headerBg = colorMode === 'dark' ? 'bg-[#0b1224]' : 'bg-slate-50';
  const mutedText = colorMode === 'dark' ? 'text-slate-400' : 'text-slate-600';
  const surfaceButton = colorMode === 'dark'
    ? 'bg-[#0b1224] hover:bg-[#0f1629]'
    : 'bg-white hover:bg-slate-100';
  const activeButton = 'bg-gradient-to-r from-blue-500 to-blue-600 text-white';
  const selectButtonBg = 'bg-gradient-to-r from-blue-500 to-blue-600 text-white hover:opacity-90';
  const tagBg = colorMode === 'dark' ? 'bg-[#0b1224]' : 'bg-slate-100';
  const iconColor = colorMode === 'dark' ? 'text-slate-100' : 'text-slate-800';
  const sliderAccent = colorMode === 'dark' ? '#6366f1' : '#2563eb';
  const sliderTrack = colorMode === 'dark' ? '#1f2a3d' : '#e2e8f0';
  const sessionEndTime = getSessionEndTime(sessionDetails);
  const currentLayerId = currentLayer?._id?.toString?.() || currentLayer?._id || null;
  const currentLayerStartTime = Number(currentLayer?.durationOffset ?? currentLayer?.startTime ?? 0);
  const currentLayerDuration = Number(currentLayer?.duration);
  const hasCurrentLayer = Boolean(currentLayerId) && Number.isFinite(currentLayerStartTime);

  const fetchLibraryData = useCallback(async () => {
    const headers = getHeaders();
    if (!headers || !sessionId) {
      setGlobalArtifacts(EMPTY_GLOBAL_ARTIFACTS);
      setProjectGeneratedMusicItems([]);
      setIsGlobalLibraryLoading(false);
      return;
    }

    setIsGlobalLibraryLoading(true);
    setGlobalLibraryError('');

    try {
      const response = await axios.get(
        `${API_SERVER}/audio/user_music_library?sessionId=${encodeURIComponent(sessionId)}`,
        headers
      );

      setGlobalArtifacts(response.data?.globalArtifacts || EMPTY_GLOBAL_ARTIFACTS);
      const currentSessionId = normalizeSessionId(sessionId);
      const projectItemsFromApi = Array.isArray(response.data?.projectItems)
        ? response.data.projectItems
        : [];
      const fallbackCurrentSessionGeneratedItems = (Array.isArray(response.data?.items) ? response.data.items : [])
        .filter((item) => normalizeSessionId(item?.sessionId) === currentSessionId)
        .map((item) => mapGeneratedMusicToProjectLibraryItem(item, currentProjectName, currentSessionId))
        .filter(Boolean);
      setProjectGeneratedMusicItems(
        projectItemsFromApi.length > 0 ? projectItemsFromApi : fallbackCurrentSessionGeneratedItems
      );
    } catch {
      setGlobalArtifacts(EMPTY_GLOBAL_ARTIFACTS);
      setProjectGeneratedMusicItems([]);
      setGlobalLibraryError('Unable to load global audio artefacts.');
    } finally {
      setIsGlobalLibraryLoading(false);
    }
  }, [currentProjectName, sessionId]);

  useEffect(() => {
    fetchLibraryData().catch(() => {});
  }, [fetchLibraryData]);

  useEffect(() => {
    const audio = audioRef.current;

    const handleTimeUpdate = () => {
      setCurrentTime(audio.currentTime);
    };

    const handleLoadedMetadata = () => {
      setDuration(audio.duration);
    };

    const handleEnded = () => {
      setPlayingSongId(null);
      setCurrentTime(0);
      setDuration(0);
    };

    audio.addEventListener('timeupdate', handleTimeUpdate);
    audio.addEventListener('loadedmetadata', handleLoadedMetadata);
    audio.addEventListener('ended', handleEnded);

    return () => {
      audio.pause();
      audio.removeEventListener('timeupdate', handleTimeUpdate);
      audio.removeEventListener('loadedmetadata', handleLoadedMetadata);
      audio.removeEventListener('ended', handleEnded);
    };
  }, []);

  const sessionAudioLayers = Array.isArray(sessionDetails?.audioLayers) ? sessionDetails.audioLayers : [];
  const projectItems = dedupeProjectLibraryItems([
    ...sessionAudioLayers
      .map((audioLayer, index) => mapSessionAudioLayerToLibraryItem(audioLayer, index, sessionDetails))
      .filter(Boolean),
    ...projectGeneratedMusicItems,
  ]);

  const filteredProjectItems = sortAudioItemsByRecency(projectItems.filter((item) => (
    item.libraryType === selectedAudioType && matchesAudioSearch(item, searchTerm)
  )));

  const selectedGlobalGroups = selectedAudioType === AUDIO_TYPE_MUSIC
    ? globalArtifacts.music
    : selectedAudioType === AUDIO_TYPE_SPEECH
      ? globalArtifacts.speech
      : globalArtifacts.soundEffect;

  const filteredGlobalItems = sortAudioItemsByRecency(
    (Array.isArray(selectedGlobalGroups) ? selectedGlobalGroups : []).flatMap((group) => (
      (Array.isArray(group.items) ? group.items : [])
        .filter((item) => matchesAudioSearch(item, searchTerm))
        .map((item) => ({
          ...item,
          projectId: item?.projectId || group.projectId,
          projectName: item?.projectName || group.projectName,
        }))
    ))
  );
  const activeAudioItems = selectedScope === LIBRARY_SCOPE_PROJECT
    ? filteredProjectItems
    : filteredGlobalItems;
  const totalAudioPages = Math.max(1, Math.ceil(activeAudioItems.length / AUDIO_LIBRARY_PAGE_SIZE));
  const normalizedAudioPage = Math.min(currentAudioPage, totalAudioPages);
  const paginatedAudioItems = activeAudioItems.slice(
    (normalizedAudioPage - 1) * AUDIO_LIBRARY_PAGE_SIZE,
    normalizedAudioPage * AUDIO_LIBRARY_PAGE_SIZE
  );
  const paginatedProjectItems = selectedScope === LIBRARY_SCOPE_PROJECT ? paginatedAudioItems : [];
  const paginatedGlobalGroups = selectedScope === LIBRARY_SCOPE_GLOBAL
    ? groupAudioItemsByProjectForDisplay(paginatedAudioItems)
    : [];

  useEffect(() => {
    setCurrentAudioPage(1);
  }, [searchTerm, selectedAudioType, selectedScope]);

  useEffect(() => {
    setCurrentAudioPage((currentPage) => Math.min(Math.max(currentPage, 1), totalAudioPages));
  }, [totalAudioPages]);

  const openUploadPicker = () => {
    if (uploadInputRef.current) {
      uploadInputRef.current.click();
    }
  };

  const readFileAsDataUrl = (file) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Unable to read the selected MP3 file.'));
    reader.readAsDataURL(file);
  });

  const uploadAudioFile = async (file) => {
    if (!file || !sessionId) {
      return;
    }

    const isMp3File = file.type === 'audio/mpeg' || /\.mp3$/i.test(file.name || '');
    if (!isMp3File) {
      setAudioUploadError('Only MP3 files are supported.');
      return;
    }

    if (!(sessionEndTime > 0)) {
      setAudioUploadError('Unable to determine the current video session duration.');
      return;
    }

    setAudioUploadError('');
    setIsAudioUploadPending(true);

    try {
      const dataURL = await readFileAsDataUrl(file);
      const headers = getHeaders();
      if (!headers) {
        setAudioUploadError('You must be logged in to upload audio.');
        setIsAudioUploadPending(false);
        return;
      }

      const response = await axios.post(`${API_SERVER}/video_sessions/upload_audio_library_item`, {
        sessionId,
        dataURL,
        fileName: file.name,
      }, headers);

      const uploadedItem = response?.data?.item;
      if (uploadedItem) {
        setProjectGeneratedMusicItems((currentItems) => (
          dedupeProjectLibraryItems([uploadedItem, ...currentItems])
        ));
      }

      setSelectedScope(LIBRARY_SCOPE_PROJECT);
      setSelectedAudioType(AUDIO_TYPE_MUSIC);
      await fetchLibraryData();
    } catch (error) {
      setAudioUploadError(
        error?.response?.data?.error || 'Unable to upload the selected MP3 file.'
      );
    } finally {
      setIsAudioUploadPending(false);
      if (uploadInputRef.current) {
        uploadInputRef.current.value = '';
      }
    }
  };

  const handleAudioFileChange = async (event) => {
    const selectedFile = event.target.files?.[0];
    if (!selectedFile) {
      return;
    }

    await uploadAudioFile(selectedFile);
  };

  const handlePlayPause = (item) => {
    const audio = audioRef.current;
    const audioUrl = resolveAudioUrl(item);
    if (!audioUrl) {
      return;
    }

    if (playingSongId === item._id) {
      audio.pause();
      setPlayingSongId(null);
      return;
    }

    if (playingSongId) {
      audio.pause();
    }

    audio.src = audioUrl;
    audio
      .play()
      .then(() => {
        setPlayingSongId(item._id);
      })
      .catch(() => {});
  };

  const handleDownload = async (item) => {
    const audioUrl = resolveAudioUrl(item);
    if (!audioUrl) {
      return;
    }

    try {
      const response = await axios.get(audioUrl, {
        responseType: 'blob',
      });
      const blobUrl = URL.createObjectURL(response.data);
      const link = document.createElement('a');
      const fileName = `${(item.title || 'audio').replace(/[^a-z0-9-_]+/gi, '_')}.mp3`;

      link.href = blobUrl;
      link.setAttribute('download', fileName);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(blobUrl);
    } catch {}
  };

  const getAddConfig = (item) => {
    const currentConfig = addConfigByItemId[item._id] || {};

    return {
      startTime: currentConfig.startTime ?? '0',
      duration: currentConfig.duration ?? getDefaultDurationValue(item),
      loopOverEntireSession: Boolean(currentConfig.loopOverEntireSession),
    };
  };

  const getValidatedAddConfig = (item) => {
    const currentConfig = getAddConfig(item);
    const startTime = Number(currentConfig.startTime);
    const shouldLoopOverEntireSession = item.libraryType === AUDIO_TYPE_MUSIC
      && currentConfig.loopOverEntireSession === true;
    const durationValue = shouldLoopOverEntireSession
      ? sessionEndTime - startTime
      : Number(currentConfig.duration);
    const endTime = shouldLoopOverEntireSession ? sessionEndTime : startTime + durationValue;
    const isValid = Number.isFinite(startTime)
      && startTime >= 0
      && Number.isFinite(durationValue)
      && durationValue > 0
      && Number.isFinite(endTime)
      && endTime > startTime;

    return {
      ...currentConfig,
      parsedStartTime: startTime,
      parsedDuration: durationValue,
      endTime: isValid ? endTime : null,
      loopOverEntireSession: shouldLoopOverEntireSession,
      isValid,
    };
  };

  const updateAddConfig = (item, field, value) => {
    setAddConfigByItemId((previousConfigByItemId) => {
      const existingItemConfig = previousConfigByItemId[item._id] || {
        startTime: '0',
        duration: getDefaultDurationValue(item),
        loopOverEntireSession: false,
      };

      return {
        ...previousConfigByItemId,
        [item._id]: {
          ...existingItemConfig,
          [field]: value,
        },
      };
    });
  };

  const handleAddToProject = (item) => {
    const validatedConfig = getValidatedAddConfig(item);
    if (!validatedConfig.isValid || !onSelectMusic) {
      return;
    }

    onSelectMusic(item, {
      startTime: validatedConfig.parsedStartTime,
      duration: validatedConfig.parsedDuration,
      loopOverEntireSession: validatedConfig.loopOverEntireSession,
      audioBindingMode: item.libraryType === AUDIO_TYPE_SPEECH ? 'unbounded' : undefined,
      bindToLayer: item.libraryType === AUDIO_TYPE_SPEECH ? false : undefined,
    });
  };

  const handleAddSpeechToCurrentLayer = (item) => {
    if (!onSelectMusic || item.libraryType !== AUDIO_TYPE_SPEECH || !hasCurrentLayer) {
      return;
    }

    const itemDuration = Number(item.duration);
    const fallbackDuration = Number.isFinite(currentLayerDuration) && currentLayerDuration > 0
      ? currentLayerDuration
      : Number(getDefaultDurationValue(item));
    const durationValue = Number.isFinite(itemDuration) && itemDuration > 0
      ? itemDuration
      : fallbackDuration;

    onSelectMusic(item, {
      startTime: currentLayerStartTime,
      duration: durationValue,
      volume: Number.isFinite(Number(item.volume)) ? Number(item.volume) : 100,
      addSubtitles: true,
      selectedSubtitleOption: 'SUBTITLE',
      audioBindingMode: 'unbounded',
      bindToLayer: false,
      studioSpeechGeneration: true,
    });
  };

  const handleCopyPrompt = async (item) => {
    const promptText = getPromptText(item);
    if (!promptText || typeof navigator === 'undefined' || !navigator.clipboard?.writeText) {
      return;
    }

    try {
      await navigator.clipboard.writeText(promptText);
      setCopiedPromptId(item._id);
      window.setTimeout(() => {
        setCopiedPromptId((currentPromptId) => (
          currentPromptId === item._id ? null : currentPromptId
        ));
      }, 1200);
    } catch {}
  };

  const handleSeekChange = (e) => {
    const nextTime = Number(e.target.value);
    audioRef.current.currentTime = nextTime;
    setCurrentTime(nextTime);
  };

  const handlePreviousAudioPage = () => {
    setCurrentAudioPage((currentPage) => Math.max(currentPage - 1, 1));
  };

  const handleNextAudioPage = () => {
    setCurrentAudioPage((currentPage) => Math.min(currentPage + 1, totalAudioPages));
  };

  const renderAudioPaginationControls = () => (
    <div className={`flex w-full shrink-0 items-center overflow-hidden rounded-lg border sm:w-auto ${borderColor}`}>
      <button
        type="button"
        onClick={handlePreviousAudioPage}
        disabled={normalizedAudioPage <= 1}
        className={`inline-flex h-10 w-10 items-center justify-center border-r ${borderColor} ${surfaceButton} disabled:cursor-not-allowed disabled:opacity-50`}
        aria-label="Previous audio page"
        title="Previous audio page"
      >
        <FaChevronLeft className="text-xs" />
      </button>
      <span className={`flex h-10 min-w-0 flex-1 items-center justify-center px-3 text-xs font-semibold sm:flex-none ${headerBg}`}>
        Page {normalizedAudioPage} of {totalAudioPages}
      </span>
      <button
        type="button"
        onClick={handleNextAudioPage}
        disabled={normalizedAudioPage >= totalAudioPages}
        className={`inline-flex h-10 w-10 items-center justify-center border-l ${borderColor} ${surfaceButton} disabled:cursor-not-allowed disabled:opacity-50`}
        aria-label="Next audio page"
        title="Next audio page"
      >
        <FaChevronRight className="text-xs" />
      </button>
    </div>
  );

  const renderAudioCard = (item) => {
    const isPlaying = playingSongId === item._id;
    const tags = Array.isArray(item.tags) ? item.tags : [];
    const promptText = getPromptText(item);
    const displayTitle = getDisplayTitle(item, item.libraryType);
    const addConfig = getAddConfig(item);
    const validatedAddConfig = getValidatedAddConfig(item);
    const canLoopOverEntireSession = item.libraryType === AUDIO_TYPE_MUSIC
      && Number.isFinite(sessionEndTime)
      && sessionEndTime > 0;
    const displayDurationValue = validatedAddConfig.loopOverEntireSession
      ? (Number.isFinite(validatedAddConfig.parsedDuration)
        ? `${Math.round(validatedAddConfig.parsedDuration * 1000) / 1000}`
        : '')
      : addConfig.duration;

    return (
      <div key={item._id} className={`relative min-w-0 rounded-lg border ${borderColor} ${cardBg} p-3 shadow-sm sm:p-4`}>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <button
            className={`shrink-0 px-3 py-2 rounded-full border ${borderColor} ${surfaceButton}`}
            onClick={() => handlePlayPause(item)}
          >
            {isPlaying ? (
              <FaPause className={iconColor} />
            ) : (
              <FaPlay className={iconColor} />
            )}
          </button>

          {isPlaying && (
            <div className="order-last flex w-full min-w-0 items-center gap-2 sm:order-none sm:mx-2 sm:flex-1">
              <span className="shrink-0 text-sm">{formatTime(currentTime)}</span>
              <input
                type="range"
                min="0"
                max={duration || 0}
                value={currentTime}
                onChange={handleSeekChange}
                className="min-w-0 flex-1 appearance-none h-2 rounded-full"
                style={{
                  accentColor: sliderAccent,
                  background: `linear-gradient(to right, ${sliderAccent} 0%, ${sliderAccent} ${(duration ? currentTime / duration : 0) * 100}%, ${sliderTrack} ${(duration ? currentTime / duration : 0) * 100}%, ${sliderTrack} 100%)`,
                }}
              />
              <span className="shrink-0 text-sm">{formatTime(duration)}</span>
            </div>
          )}

          <button
            className={`shrink-0 px-3 py-2 rounded-full border ${borderColor} ${surfaceButton}`}
            onClick={() => handleDownload(item)}
          >
            <FaDownload className={iconColor} />
          </button>

          {!hideSelectButton && item.libraryType === AUDIO_TYPE_SPEECH && (
            <button
              type="button"
              className={`shrink-0 px-3 py-2 rounded-full border ${borderColor} ${surfaceButton} disabled:cursor-not-allowed disabled:opacity-50`}
              onClick={() => handleAddSpeechToCurrentLayer(item)}
              disabled={!hasCurrentLayer}
              title={hasCurrentLayer ? 'Add speech to current layer' : 'Select a layer before adding speech'}
              aria-label={hasCurrentLayer ? 'Add speech to current layer' : 'Select a layer before adding speech'}
            >
              <FaCheck className={iconColor} />
            </button>
          )}
        </div>

        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="break-words text-lg font-semibold">{displayTitle}</h2>
            <p className={`mt-1 text-xs ${mutedText}`}>
              {item.speakerCharacterName || item.projectName || getAudioTypeLabel(item.libraryType)}
            </p>
          </div>
          <span className={`inline-flex shrink-0 rounded-full px-2 py-1 text-xs font-semibold ${tagBg}`}>
            {getAudioTypeLabel(item.libraryType)}
          </span>
        </div>

        {promptText && (
          <div className={`mt-3 rounded-lg border ${borderColor} ${headerBg} p-3`}>
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className={`text-xs font-semibold uppercase tracking-wide ${mutedText}`}>
                Prompt
              </span>
              <button
                type="button"
                className={`inline-flex items-center gap-1 text-xs font-semibold ${mutedText}`}
                onClick={() => handleCopyPrompt(item)}
              >
                {copiedPromptId === item._id ? (
                  <>
                    <FaCheck />
                    Copied
                  </>
                ) : (
                  <>
                    <FaCopy />
                    Copy
                  </>
                )}
              </button>
            </div>
            <p className="text-sm line-clamp-2 whitespace-pre-wrap">
              {promptText}
            </p>
          </div>
        )}

        {tags.length > 0 && (
          <div className="mt-3">
            {tags.map((tag) => (
              <span
                key={`${item._id}-${tag}`}
                className={`inline-block ${tagBg} text-sm px-2 py-1 rounded mr-1 mt-1`}
              >
                {tag}
              </span>
            ))}
          </div>
        )}

        {!hideSelectButton && (
          <div className="relative z-20">
            <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-3">
              <label className="block">
                <span className={`mb-1 block text-xs font-semibold ${mutedText}`}>Start</span>
                <input
                  type="number"
                  min="0"
                  step="0.1"
                  value={addConfig.startTime}
                  onChange={(e) => updateAddConfig(item, 'startTime', e.target.value)}
                  className={`w-full rounded-lg border ${borderColor} ${surfaceButton} px-3 py-2 text-sm focus:outline-none`}
                />
              </label>

              <label className="block">
                <span className={`mb-1 block text-xs font-semibold ${mutedText}`}>Duration</span>
                <input
                  type="number"
                  min="0.1"
                  step="0.1"
                  value={displayDurationValue}
                  onChange={(e) => updateAddConfig(item, 'duration', e.target.value)}
                  disabled={validatedAddConfig.loopOverEntireSession}
                  className={`w-full rounded-lg border ${borderColor} ${surfaceButton} px-3 py-2 text-sm focus:outline-none`}
                />
              </label>

              <div className="block">
                <span className={`mb-1 block text-xs font-semibold ${mutedText}`}>End</span>
                <div className={`w-full rounded-lg border ${borderColor} ${headerBg} px-3 py-2 text-sm`}>
                  {formatTimelineValue(validatedAddConfig.endTime)}
                </div>
              </div>
            </div>

            {canLoopOverEntireSession && (
              <label className={`mt-3 flex items-center gap-2 text-sm ${mutedText}`}>
                <input
                  type="checkbox"
                  checked={addConfig.loopOverEntireSession}
                  onChange={(e) => updateAddConfig(item, 'loopOverEntireSession', e.target.checked)}
                />
                <span>Loop over entire session</span>
              </label>
            )}

            <button
              className={`relative z-30 mt-4 w-full ${selectButtonBg} px-3 py-2 rounded-lg font-semibold shadow-lg disabled:cursor-not-allowed disabled:opacity-60`}
              onClick={() => handleAddToProject(item)}
              disabled={!validatedAddConfig.isValid}
            >
              Add To Project
            </button>
          </div>
        )}
        {hideSelectButton && (
          <p className={`mt-3 text-xs ${mutedText}`}>Click play to preview and download.</p>
        )}
      </div>
    );
  };

  const renderProjectContent = () => {
    if (filteredProjectItems.length === 0) {
      return (
        <div className={`rounded-2xl border ${borderColor} ${cardBg} p-6 text-sm ${mutedText}`}>
          No {getAudioTypeLabel(selectedAudioType).toLowerCase()} artefacts found in this project.
        </div>
      );
    }

    return (
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {paginatedProjectItems.map((item) => renderAudioCard(item))}
      </div>
    );
  };

  const renderGlobalContent = () => {
    if (isGlobalLibraryLoading) {
      return (
        <div className={`rounded-2xl border ${borderColor} ${cardBg} p-6 text-sm ${mutedText}`}>
          Loading global audio artefacts...
        </div>
      );
    }

    if (globalLibraryError) {
      return (
        <div className={`rounded-2xl border ${borderColor} ${cardBg} p-6 text-sm ${mutedText}`}>
          {globalLibraryError}
        </div>
      );
    }

    if (filteredGlobalItems.length === 0) {
      return (
        <div className={`rounded-2xl border ${borderColor} ${cardBg} p-6 text-sm ${mutedText}`}>
          No global {getAudioTypeLabel(selectedAudioType).toLowerCase()} artefacts found.
        </div>
      );
    }

    return (
      <div className="space-y-6">
        {paginatedGlobalGroups.map((group) => (
          <section key={`${selectedAudioType}-${group.projectId}`} className="space-y-3">
            <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
              <div>
                <h2 className="text-lg font-semibold">{group.projectName}</h2>
                <p className={`text-xs ${mutedText}`}>
                  {group.items.length} {group.items.length === 1 ? 'track' : 'tracks'}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
              {group.items.map((item) => renderAudioCard(item))}
            </div>
          </section>
        ))}
      </div>
    );
  };

  const renderUploadPanel = () => {
    if (hideSelectButton || selectedScope !== LIBRARY_SCOPE_PROJECT || selectedAudioType !== AUDIO_TYPE_MUSIC) {
      return null;
    }

    return (
      <div className={`rounded-2xl border ${borderColor} ${cardBg} p-4 shadow-sm`}>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="text-lg font-semibold">Upload MP3</h2>
            <p className={`mt-1 text-sm ${mutedText}`}>
              MP3 only. Maximum duration: {formatTimelineValue(sessionEndTime)} seconds.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <input
              ref={uploadInputRef}
              type="file"
              accept=".mp3,audio/mpeg"
              className="hidden"
              onChange={handleAudioFileChange}
            />
            <button
              type="button"
              onClick={openUploadPicker}
              disabled={isAudioUploadPending || !(sessionEndTime > 0)}
              className={`inline-flex w-full items-center justify-center gap-2 rounded-lg px-4 py-2 font-semibold sm:w-auto ${selectButtonBg} disabled:cursor-not-allowed disabled:opacity-60`}
            >
              <FaUpload />
              {isAudioUploadPending ? 'Uploading...' : 'Upload MP3'}
            </button>
          </div>
        </div>

        {audioUploadError && (
          <p className="mt-3 text-sm text-red-500">
            {audioUploadError}
          </p>
        )}
      </div>
    );
  };

  return (
    <div className={`h-full min-h-0 w-full min-w-0 overflow-y-auto px-0 pt-0 pb-12 sm:px-3 sm:pt-3 lg:pb-20 ${textColor}`}>
      <div className="space-y-4">
        <div className={`sticky top-0 z-20 rounded-lg border ${borderColor} ${cardBg} p-3 shadow-sm`}>
          <div className="flex min-w-0 flex-col gap-3">
            <div className="flex min-w-0 flex-col gap-3 lg:flex-row lg:items-center">
              <div className="min-w-0 shrink-0">
                <h1 className="text-lg font-bold">Audio Library</h1>
                <p className={`mt-0.5 text-xs ${mutedText}`}>
                  {getScopeLabel(selectedScope)} {getAudioTypeLabel(selectedAudioType)} artefacts - {activeAudioItems.length} items
                </p>
              </div>

              <div className={`flex h-10 min-w-0 flex-1 items-center gap-2 rounded-lg border ${borderColor} ${surfaceButton} px-3`}>
                <FaSearch className={`shrink-0 text-sm ${mutedText}`} />
                <input
                  type="text"
                  placeholder="Search audio"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full min-w-0 bg-transparent text-sm focus:outline-none"
                />
              </div>
            </div>

            <div className="flex min-w-0 flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                {[LIBRARY_SCOPE_PROJECT, LIBRARY_SCOPE_GLOBAL].map((scope) => (
                  <button
                    key={scope}
                    type="button"
                    onClick={() => setSelectedScope(scope)}
                    className={`h-10 whitespace-nowrap rounded-lg border px-3 text-sm font-semibold ${borderColor} ${
                      selectedScope === scope ? activeButton : surfaceButton
                    }`}
                  >
                    {getScopeLabel(scope)}
                  </button>
                ))}

                {[AUDIO_TYPE_MUSIC, AUDIO_TYPE_SPEECH, AUDIO_TYPE_SOUND_EFFECT].map((audioType) => (
                  <button
                    key={audioType}
                    type="button"
                    onClick={() => setSelectedAudioType(audioType)}
                    className={`h-10 whitespace-nowrap rounded-lg border px-3 text-sm font-semibold ${borderColor} ${
                      selectedAudioType === audioType ? activeButton : `${surfaceButton} ${headerBg}`
                    }`}
                  >
                    {getAudioTypeLabel(audioType)}
                  </button>
                ))}
              </div>

              <div className="flex w-full shrink-0 justify-end sm:w-auto">
                {renderAudioPaginationControls()}
              </div>
            </div>
          </div>
        </div>

        {renderUploadPanel()}

        {selectedScope === LIBRARY_SCOPE_PROJECT ? renderProjectContent() : renderGlobalContent()}
      </div>
    </div>
  );
}
