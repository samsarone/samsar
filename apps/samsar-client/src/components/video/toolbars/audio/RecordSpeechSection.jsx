import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import axios from 'axios';
import { Tooltip } from 'react-tooltip';
import 'react-tooltip/dist/react-tooltip.css';
import {
  FaHome,
  FaLightbulb,
  FaCircle,
  FaCheck,
  FaImage,
  FaMicrophone,
  FaPause,
  FaPlay,
  FaPlus,
  FaQuestionCircle,
  FaSave,
  FaStop,
  FaSyncAlt,
  FaTrash,
  FaTimesCircle,
  FaUserCircle,
  FaVideo,
} from 'react-icons/fa';
import { toast } from 'react-toastify';
import { getHeaders } from '../../../../utils/web';
import { normalizeTimelineHints } from '../../../../utils/sessionTimelineText.js';
import {
  IMAGE_GENERAITON_MODEL_TYPES,
  TTS_COMBINED_SPEAKER_TYPES,
} from '../../../../constants/Types.ts';
import {
  getGoogleTTSVoiceDetails,
  mergeGoogleTTSSpeakers,
  useGoogleTTSSpeakers,
} from '../../../../hooks/useGoogleTTSSpeakers.js';
import { useAudioProviderAvailability } from '../../../../hooks/useAudioProviderAvailability.js';
import {
  filterSpeakersForAudioAvailability,
  filterTtsProviderOptionsForAudioAvailability,
} from '../../../../constants/audioProviderAvailability.js';

const PROCESSOR_API_URL = import.meta.env.VITE_PROCESSOR_API;
const DISPLAY_FRAMES_PER_SECOND = 30;
const DEBUG_RECORD_SPEECH = true;
const FACECAM_VIDEO_BITS_PER_SECOND = 1_500_000;
const FACECAM_RECORDER_TIMESLICE_MS = 1000;
const FACECAM_GLOBAL_VIDEO_POLL_INTERVAL_MS = 2000;
const FACECAM_GLOBAL_VIDEO_POLL_TIMEOUT_MS = 10 * 60 * 1000;
const AVATAR_VOICEOVER_POLL_INTERVAL_MS = 5000;
const AVATAR_VIDEO_BILLING_UNIT_SECONDS = 6;
const AVATAR_VIDEO_UPFRONT_CREDITS = 2;
const AVATAR_VIDEO_BASE_CREDITS_PER_UNIT = 2;
const AVATAR_VIDEO_CREDIT_CONVERSION_MULTIPLIER = 2;
const DEFAULT_ELEVENLABS_AVATAR_SPEAKER = 'N2lVS1w4EtoT3dr4eOWO';
const DEFAULT_AVATAR_IMAGE_MODEL = 'GPTIMAGE2';
const AVATAR_IMAGE_MODEL_STORAGE_KEY = 'defaultAvatarImageGenerationModel';
const AVATAR_IMAGE_MODEL_OPTIONS = IMAGE_GENERAITON_MODEL_TYPES.filter(
  (model) => model.isExpressModel === true
).map((model) => ({
  value: model.key,
  label: model.name,
}));
const AVATAR_VIDEO_AUDIO_SOURCE_SESSION_SPEECH = 'session_speech';
const AVATAR_VIDEO_AUDIO_SOURCE_HINT_SPEECH = 'hint_speech';
const AVATAR_VIDEO_AUDIO_SOURCE_OPTIONS = [
  { value: AVATAR_VIDEO_AUDIO_SOURCE_SESSION_SPEECH, label: 'Generated speech lip sync' },
  { value: AVATAR_VIDEO_AUDIO_SOURCE_HINT_SPEECH, label: 'Text hints avatar speech' },
];
const AVATAR_TTS_PROVIDER_OPTIONS = [
  { value: 'OPENAI', label: 'OpenAI' },
  { value: 'ELEVENLABS', label: 'ElevenLabs' },
  { value: 'PLAYAI', label: 'Play.ht' },
  { value: 'GOOGLE', label: 'Google TTS' },
  { value: 'CUSTOM_TEXT_TO_SPEECH', label: 'Custom TTS' },
];

const RECORDER_MIME_TYPES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/mp4',
  'audio/ogg;codecs=opus',
  'audio/ogg',
];

const VIDEO_RECORDER_MIME_TYPES = [
  'video/webm;codecs=vp9',
  'video/webm;codecs=vp8',
  'video/webm',
  'video/mp4',
];

function getSupportedRecorderMimeType() {
  if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') {
    return '';
  }

  return RECORDER_MIME_TYPES.find((mimeType) => MediaRecorder.isTypeSupported(mimeType)) || '';
}

function getRecordingExtension(mimeType = '') {
  const normalizedMimeType = mimeType.toLowerCase();
  if (normalizedMimeType.includes('mp4')) {
    return 'm4a';
  }
  if (normalizedMimeType.includes('ogg')) {
    return 'ogg';
  }
  if (normalizedMimeType.includes('mpeg') || normalizedMimeType.includes('mp3')) {
    return 'mp3';
  }
  return 'webm';
}

function getSupportedVideoRecorderMimeType() {
  if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') {
    return '';
  }

  return VIDEO_RECORDER_MIME_TYPES.find((mimeType) => MediaRecorder.isTypeSupported(mimeType)) || '';
}

function getVideoRecordingExtension(mimeType = '') {
  const normalizedMimeType = mimeType.toLowerCase();
  if (normalizedMimeType.includes('mp4')) {
    return 'mp4';
  }
  if (normalizedMimeType.includes('quicktime')) {
    return 'mov';
  }
  return 'webm';
}

function wait(milliseconds) {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

function getInitialAvatarImageModel() {
  let savedModel = '';
  try {
    savedModel = localStorage.getItem(AVATAR_IMAGE_MODEL_STORAGE_KEY) || '';
  } catch (_error) {
    savedModel = '';
  }
  if (AVATAR_IMAGE_MODEL_OPTIONS.some((model) => model.value === savedModel)) {
    return savedModel;
  }
  if (AVATAR_IMAGE_MODEL_OPTIONS.some((model) => model.value === DEFAULT_AVATAR_IMAGE_MODEL)) {
    return DEFAULT_AVATAR_IMAGE_MODEL;
  }
  return AVATAR_IMAGE_MODEL_OPTIONS[0]?.value || '';
}

function getGlobalVideoId(globalVideo = {}) {
  return globalVideo?._id?.toString?.()
    || globalVideo?._id
    || globalVideo?.id?.toString?.()
    || globalVideo?.id
    || globalVideo?.globalVideoId?.toString?.()
    || globalVideo?.globalVideoId
    || '';
}

function normalizeGlobalVideoProcessingStatus(value = '') {
  return typeof value === 'string' ? value.trim().toUpperCase() : '';
}

function normalizeProcessorAssetUrl(value = '') {
  if (typeof value !== 'string') {
    return '';
  }

  const trimmedValue = value.trim();
  if (!trimmedValue) {
    return '';
  }
  if (/^(data:|blob:|https?:\/\/)/i.test(trimmedValue)) {
    return trimmedValue;
  }

  const baseUrl = (PROCESSOR_API_URL || '').replace(/\/+$/, '');
  const normalizedPath = trimmedValue.startsWith('/') ? trimmedValue : `/${trimmedValue.replace(/^\/+/, '')}`;
  return baseUrl ? `${baseUrl}${normalizedPath}` : normalizedPath;
}

function AvatarImage({
  src,
  className,
  onUnavailable,
}) {
  if (!src) {
    return null;
  }

  return (
    <img
      src={src}
      alt=""
      className={className}
      onError={onUnavailable}
    />
  );
}

function normalizeAvatarTaskStatus(value = '') {
  return typeof value === 'string' ? value.trim().toUpperCase() : '';
}

function normalizeAvatarTtsProvider(value = '') {
  const normalized = typeof value === 'string' ? value.trim().toUpperCase() : '';
  if (normalized === 'PLAYHT') {
    return 'PLAYAI';
  }
  return normalized || 'OPENAI';
}

function getAvatarSpeechSpeakerOptions(provider = '', speakerTypes = TTS_COMBINED_SPEAKER_TYPES) {
  const normalizedProvider = normalizeAvatarTtsProvider(provider);
  return speakerTypes.filter((speaker) => (
    normalizeAvatarTtsProvider(speaker.provider) === normalizedProvider
  ));
}

function getDefaultAvatarSpeechSpeakerValue(provider = '', speakerTypes = TTS_COMBINED_SPEAKER_TYPES) {
  const speakerOptions = getAvatarSpeechSpeakerOptions(provider, speakerTypes);
  if (normalizeAvatarTtsProvider(provider) === 'ELEVENLABS') {
    return speakerOptions.find((speaker) => speaker.value === DEFAULT_ELEVENLABS_AVATAR_SPEAKER)?.value
      || speakerOptions[0]?.value
      || '';
  }
  return speakerOptions[0]?.value || '';
}

function getAvatarTaskId(task = {}) {
  return task?._id?.toString?.()
    || task?._id
    || task?.id?.toString?.()
    || task?.id
    || '';
}

function getTaskUpdatedTime(task = {}) {
  const timestamp = Date.parse(task?.updatedAt || task?.createdAt || '');
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function shouldUseIncomingAvatarTask(currentTask = null, nextTask = null) {
  if (!currentTask || !nextTask) {
    return true;
  }

  const currentUpdatedAt = getTaskUpdatedTime(currentTask);
  const nextUpdatedAt = getTaskUpdatedTime(nextTask);
  return !currentUpdatedAt || !nextUpdatedAt || nextUpdatedAt >= currentUpdatedAt;
}

function isAvatarTaskPolling(task = {}, { includeSpeech = true } = {}) {
  const status = normalizeAvatarTaskStatus(task?.status);
  const imageStatus = normalizeAvatarTaskStatus(task?.imageStatus);
  const runwayAvatarStatus = normalizeAvatarTaskStatus(task?.runwayAvatarStatus);
  const avatarSpeechStatus = normalizeAvatarTaskStatus(task?.avatarSpeechStatus);
  const avatarVideoStatus = normalizeAvatarTaskStatus(task?.avatarVideoStatus);
  return [
    'IMAGE_PENDING',
    'AVATAR_PROCESSING',
    'VIDEO_PROCESSING',
  ].includes(status)
    || (includeSpeech && status === 'SPEECH_PROCESSING')
    || ['PENDING', 'INIT', 'PROCESSING'].includes(imageStatus)
    || ['PROCESSING', 'PENDING'].includes(runwayAvatarStatus)
    || (includeSpeech && ['INIT', 'PENDING', 'PROCESSING'].includes(avatarSpeechStatus))
    || ['PENDING', 'RUNNING', 'THROTTLED'].includes(avatarVideoStatus);
}

function getAvatarTaskStatusLabel(task = {}) {
  const status = normalizeAvatarTaskStatus(task?.status);
  const imageStatus = normalizeAvatarTaskStatus(task?.imageStatus);
  const runwayAvatarStatus = normalizeAvatarTaskStatus(task?.runwayAvatarStatus);
  const avatarSpeechStatus = normalizeAvatarTaskStatus(task?.avatarSpeechStatus);
  const avatarVideoStatus = normalizeAvatarTaskStatus(task?.avatarVideoStatus);

  if (status === 'FAILED') {
    return 'Failed';
  }
  if (status === 'REJECTED') {
    return 'Rejected';
  }
  if (status === 'ACCEPTED') {
    return 'Accepted';
  }
  if (status === 'SAVED') {
    return 'Saved';
  }
  if (status === 'VIDEO_COMPLETED') {
    return 'Video ready';
  }
  if (status === 'VIDEO_PROCESSING' || ['PENDING', 'RUNNING', 'THROTTLED'].includes(avatarVideoStatus)) {
    return 'Generating video';
  }
  if (status === 'SPEECH_READY' || avatarSpeechStatus === 'COMPLETED') {
    return 'Speech ready';
  }
  if (status === 'SPEECH_PROCESSING' || ['INIT', 'PENDING', 'PROCESSING'].includes(avatarSpeechStatus)) {
    return 'Generating speech';
  }
  if (status === 'AVATAR_READY' || runwayAvatarStatus === 'READY') {
    return 'Avatar ready';
  }
  if (status === 'AVATAR_PROCESSING' || runwayAvatarStatus === 'PROCESSING') {
    return 'Creating avatar';
  }
  if (status === 'IMAGE_COMPLETED' || imageStatus === 'COMPLETED') {
    return 'Image ready';
  }
  if (status === 'IMAGE_PENDING' || imageStatus === 'PENDING') {
    return 'Generating image';
  }
  return status ? status.toLowerCase().replace(/_/g, ' ') : 'Draft';
}

function estimateAvatarVideoCreditCost(durationSeconds = 1) {
  const safeDuration = Math.max(1, Number(durationSeconds) || 1);
  const durationUnits = Math.max(1, Math.ceil(safeDuration / AVATAR_VIDEO_BILLING_UNIT_SECONDS));
  const baseCredits = AVATAR_VIDEO_UPFRONT_CREDITS + (durationUnits * AVATAR_VIDEO_BASE_CREDITS_PER_UNIT);
  const creditsToCharge = Math.ceil(baseCredits * AVATAR_VIDEO_CREDIT_CONVERSION_MULTIPLIER);
  const upfrontCredits = AVATAR_VIDEO_UPFRONT_CREDITS * AVATAR_VIDEO_CREDIT_CONVERSION_MULTIPLIER;
  const creditsPerBillingUnit = AVATAR_VIDEO_BASE_CREDITS_PER_UNIT * AVATAR_VIDEO_CREDIT_CONVERSION_MULTIPLIER;

  return {
    baseCredits,
    creditsToCharge,
    upfrontCredits,
    creditsPerBillingUnit,
    creditsPerSecond: creditsPerBillingUnit / AVATAR_VIDEO_BILLING_UNIT_SECONDS,
    durationSeconds: safeDuration,
    durationUnits,
  };
}

function shouldPollGlobalVideoProcessing(responseData = {}, globalVideo = {}) {
  const status = normalizeGlobalVideoProcessingStatus(
    responseData?.status
      || globalVideo?.framesGenerationStatus
      || globalVideo?.frameGenerationStatus
  );

  return status === 'PROCESSING'
    || status === 'INIT'
    || Boolean(globalVideo?.framesGenerationPending);
}

async function pollGlobalVideoProcessing({
  sessionId,
  globalVideo,
  headers,
  failureMessage = 'Unable to process recorded facecam.',
  timeoutMessage = 'Facecam was uploaded, but processing is still running. Please try again in a moment.',
}) {
  const globalVideoId = getGlobalVideoId(globalVideo);
  if (!sessionId || !globalVideoId) {
    return globalVideo;
  }

  const startedAt = Date.now();
  let latestGlobalVideo = globalVideo;
  while (Date.now() - startedAt < FACECAM_GLOBAL_VIDEO_POLL_TIMEOUT_MS) {
    await wait(FACECAM_GLOBAL_VIDEO_POLL_INTERVAL_MS);
    const response = await axios.get(`${PROCESSOR_API_URL}/video_sessions/global_video_status`, {
      ...headers,
      params: {
        sessionId,
        globalVideoId,
      },
    });
    latestGlobalVideo = response?.data?.globalVideo || latestGlobalVideo;
    const status = normalizeGlobalVideoProcessingStatus(
      response?.data?.status
        || latestGlobalVideo?.framesGenerationStatus
        || latestGlobalVideo?.frameGenerationStatus
    );

    if (response?.data?.complete || status === 'COMPLETED') {
      return latestGlobalVideo;
    }
    if (response?.data?.failed || status === 'FAILED') {
      throw new Error(latestGlobalVideo?.framesGenerationError || failureMessage);
    }
  }

  throw new Error(timeoutMessage);
}

function mergeGlobalVideoIntoSessionDetails(sessionDetails = null, globalVideo = null) {
  if (!sessionDetails || !globalVideo) {
    return sessionDetails;
  }

  const globalVideoId = getGlobalVideoId(globalVideo);
  if (!globalVideoId) {
    return sessionDetails;
  }

  const existingGlobalVideos = Array.isArray(sessionDetails.global_videos)
    ? sessionDetails.global_videos
    : Array.isArray(sessionDetails.globalVideos)
      ? sessionDetails.globalVideos
      : [];
  let foundGlobalVideo = false;
  const nextGlobalVideos = existingGlobalVideos.map((existingGlobalVideo) => {
    if (getGlobalVideoId(existingGlobalVideo) !== globalVideoId) {
      return existingGlobalVideo;
    }
    foundGlobalVideo = true;
    return {
      ...existingGlobalVideo,
      ...globalVideo,
    };
  });

  if (!foundGlobalVideo) {
    nextGlobalVideos.push(globalVideo);
  }

  return {
    ...sessionDetails,
    global_videos: nextGlobalVideos,
    globalVideos: nextGlobalVideos,
  };
}

function formatRecordingTime(seconds) {
  const safeSeconds = Math.max(0, Math.floor(Number(seconds) || 0));
  const minutes = Math.floor(safeSeconds / 60);
  const remainingSeconds = safeSeconds % 60;
  return `${minutes}:${remainingSeconds < 10 ? `0${remainingSeconds}` : remainingSeconds}`;
}

function readBlobAsDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Unable to read recorded audio.'));
    reader.readAsDataURL(blob);
  });
}

function resolveLayerStartTime(currentLayer = {}) {
  const layerStartTime = Number(currentLayer?.durationOffset ?? currentLayer?.startTime);
  return Number.isFinite(layerStartTime) && layerStartTime >= 0 ? layerStartTime : 0;
}

function resolveSessionDuration(sessionDetails = {}, latestHintEndTime = 0) {
  const explicitDuration = Number(sessionDetails?.totalDuration ?? sessionDetails?.duration);
  const layerDuration = Array.isArray(sessionDetails?.layers)
    ? sessionDetails.layers.reduce((durationTotal, layer) => (
      durationTotal + Math.max(0, Number(layer?.duration) || 0)
    ), 0)
    : 0;

  return Math.max(
    Number.isFinite(explicitDuration) && explicitDuration > 0 ? explicitDuration : 0,
    layerDuration,
    Number.isFinite(latestHintEndTime) ? latestHintEndTime : 0,
    1
  );
}

function normalizeAudioLayerType(value = '') {
  return typeof value === 'string' ? value.trim().toLowerCase().replace(/[\s-]+/g, '_') : '';
}

const GENERATED_SPEECH_AUDIO_LAYER_TYPES = new Set([
  'speech',
  'custom_speech',
  'recorded_speech',
  'lip_sync',
]);

function isGeneratedSpeechAudioLayer(audioLayer = {}) {
  const audioType = normalizeAudioLayerType(
    audioLayer?.generationType
    || audioLayer?.type
    || audioLayer?.audioType
    || audioLayer?.sourceType
    || audioLayer?.source
    || audioLayer?.generationMeta?.sourceType
  );
  const libraryType = normalizeAudioLayerType(audioLayer?.libraryType);
  return GENERATED_SPEECH_AUDIO_LAYER_TYPES.has(audioType) || libraryType === 'speech';
}

function collectSessionSpeechAudioLayers(sessionDetails = {}) {
  const audioLayerGroups = [
    sessionDetails?.audioLayers,
    sessionDetails?.audio_layers,
    sessionDetails?.global_audio_layers,
    sessionDetails?.globalAudioLayers,
  ];
  const seenLayerIds = new Set();
  const audioLayers = [];

  audioLayerGroups.forEach((group) => {
    if (!Array.isArray(group)) {
      return;
    }

    group.forEach((audioLayer) => {
      const layerId = audioLayer?._id?.toString?.() || audioLayer?.id?.toString?.() || '';
      if (layerId) {
        if (seenLayerIds.has(layerId)) {
          return;
        }
        seenLayerIds.add(layerId);
      }
      audioLayers.push(audioLayer);
    });
  });

  return audioLayers;
}

function hasAudioLayerSource(audioLayer = {}) {
  const sources = [
    audioLayer.selectedLocalAudioLink,
    ...(Array.isArray(audioLayer.localAudioLinks) ? audioLayer.localAudioLinks : []),
    audioLayer.selectedRemoteAudioLink,
    ...(Array.isArray(audioLayer.remoteAudioLinks) ? audioLayer.remoteAudioLinks : []),
    audioLayer.audioLink,
    audioLayer.url,
    ...(Array.isArray(audioLayer.remoteAudioData)
      ? audioLayer.remoteAudioData.map((audioData) => audioData?.audio_url || audioData?.audioUrl)
      : []),
  ];
  return sources.some((source) => typeof source === 'string' && source.trim());
}

function getGeneratedSpeechAudioSummary(sessionDetails = {}) {
  const audioLayers = collectSessionSpeechAudioLayers(sessionDetails);
  const speechLayers = audioLayers.filter((audioLayer) => (
    isGeneratedSpeechAudioLayer(audioLayer) && hasAudioLayerSource(audioLayer)
  ));
  const durationSeconds = speechLayers.reduce((latestEndTime, audioLayer) => {
    const startTime = Math.max(0, Number(audioLayer?.startTime) || 0);
    const endTime = Number(audioLayer?.endTime);
    const duration = Number(audioLayer?.duration);
    const layerEndTime = Number.isFinite(endTime) && endTime > startTime
      ? endTime
      : startTime + (Number.isFinite(duration) && duration > 0 ? duration : 0);
    return Math.max(latestEndTime, layerEndTime);
  }, 0);

  return {
    count: speechLayers.length,
    durationSeconds,
    hasAudio: speechLayers.length > 0,
  };
}

function getHintCueKey(hintCue = {}) {
  return hintCue?.id || `${hintCue.startTime}-${hintCue.endTime}-${hintCue.text}`;
}

function calculateHintProgressPercent(intervalStartTime, targetStartTime, currentTime) {
  const intervalDuration = Math.max(0.001, targetStartTime - intervalStartTime);
  const elapsed = Math.max(0, currentTime - intervalStartTime);
  return Math.max(0, Math.min(100, (elapsed / intervalDuration) * 100));
}

function resolveBlobDuration(blobUrl) {
  return new Promise((resolve) => {
    if (!blobUrl) {
      resolve(null);
      return;
    }

    const audio = new Audio();
    audio.preload = 'metadata';
    audio.onloadedmetadata = () => {
      const duration = Number(audio.duration);
      resolve(Number.isFinite(duration) && duration > 0 ? duration : null);
    };
    audio.onerror = () => resolve(null);
    audio.src = blobUrl;
  });
}

function resolveVideoBlobDuration(blobUrl) {
  return new Promise((resolve) => {
    if (!blobUrl || typeof document === 'undefined') {
      resolve(null);
      return;
    }

    const video = document.createElement('video');
    let settled = false;
    let timeoutId = null;
    const finish = (duration = null) => {
      if (settled) {
        return;
      }
      settled = true;
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      video.removeAttribute('src');
      video.load?.();
      resolve(duration);
    };
    const resolveCurrentDuration = () => {
      const duration = Number(video.duration);
      if (Number.isFinite(duration) && duration > 0) {
        finish(duration);
        return true;
      }
      return false;
    };

    video.preload = 'metadata';
    video.muted = true;
    video.playsInline = true;
    video.onloadedmetadata = () => {
      if (!resolveCurrentDuration()) {
        try {
          video.currentTime = Number.MAX_SAFE_INTEGER;
        } catch {
          finish(null);
        }
      }
    };
    video.ontimeupdate = resolveCurrentDuration;
    video.onerror = () => finish(null);
    timeoutId = setTimeout(() => finish(null), 3000);
    video.src = blobUrl;
  });
}

function logRecordSpeechDebug(message, payload = {}) {
  if (!DEBUG_RECORD_SPEECH || typeof console === 'undefined') {
    return;
  }

  console.log(`[RecordSpeech] ${message}`, payload);
}

function warnRecordSpeech(message, payload = {}) {
  if (typeof console === 'undefined') {
    return;
  }

  console.warn(`[RecordSpeech] ${message}`, payload);
}

export default function RecordSpeechSection({
  bgColor,
  text2Color,
  colorMode,
  currentLayer,
  sessionDetails,
  requestAddAudioLayerFromLibrary,
  requestAddGlobalAudioLayerFromLibrary,
  currentLayerSeek,
  setCurrentLayerSeek,
  isVideoPreviewPlaying,
  setIsVideoPreviewPlaying,
  onRecordSpeechRecordingChange,
  onAvatarVoiceoverSessionChange,
  onSetAvatarHints,
  isCollapsedSidebarView = false,
}) {
  const [microphones, setMicrophones] = useState([]);
  const [selectedMicId, setSelectedMicId] = useState('');
  const [micVolume, setMicVolume] = useState(100);
  const [isStartingRecording, setIsStartingRecording] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isPlayingPreview, setIsPlayingPreview] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [recordingBlob, setRecordingBlob] = useState(null);
  const [recordingUrl, setRecordingUrl] = useState('');
  const [recordingDuration, setRecordingDuration] = useState(null);
  const [uploadedLibraryItem, setUploadedLibraryItem] = useState(null);
  const [recorderError, setRecorderError] = useState('');
  const [isUploadPending, setIsUploadPending] = useState(false);
  const [level, setLevel] = useState(0);
  const [isImmersiveActive, setIsImmersiveActive] = useState(false);
  const [hintsEnabled, setHintsEnabled] = useState(false);
  const [hasAddedToSession, setHasAddedToSession] = useState(false);
  const [recordingPreviewStartSeconds, setRecordingPreviewStartSeconds] = useState(null);
  const [isRecordingPreviewActive, setIsRecordingPreviewActive] = useState(false);
  const [facecamVoiceoverMode, setFacecamVoiceoverMode] = useState('recording_facecam');
  const [recordMode, setRecordMode] = useState('audio');
  const [cameraDevices, setCameraDevices] = useState([]);
  const [selectedCameraId, setSelectedCameraId] = useState('');
  const [facecamShapeOverlay, setFacecamShapeOverlay] = useState('circle');
  const [isFacecamRecording, setIsFacecamRecording] = useState(false);
  const [facecamBlob, setFacecamBlob] = useState(null);
  const [facecamUrl, setFacecamUrl] = useState('');
  const [facecamDuration, setFacecamDuration] = useState(null);
  const [uploadedGlobalVideo, setUploadedGlobalVideo] = useState(null);
  const [facecamError, setFacecamError] = useState('');
  const [avatarPrompt, setAvatarPrompt] = useState('');
  const [selectedAvatarImageModel, setSelectedAvatarImageModel] = useState(getInitialAvatarImageModel);
  const [avatarTasks, setAvatarTasks] = useState([]);
  const [userRunwayAvatars, setUserRunwayAvatars] = useState([]);
  const [unavailableAvatarImageKeys, setUnavailableAvatarImageKeys] = useState(() => new Set());
  const [selectedAvatarTaskId, setSelectedAvatarTaskId] = useState('');
  const [, setAvatarVoices] = useState([]);
  const [selectedAvatarVoiceId, setSelectedAvatarVoiceId] = useState('victoria');
  const [avatarVideoAudioSource, setAvatarVideoAudioSource] = useState(AVATAR_VIDEO_AUDIO_SOURCE_SESSION_SPEECH);
  const [selectedAvatarSpeechProvider, setSelectedAvatarSpeechProvider] = useState('OPENAI');
  const [selectedAvatarSpeechSpeaker, setSelectedAvatarSpeechSpeaker] = useState('alloy');
  const [avatarError, setAvatarError] = useState('');
  const [isAvatarTasksLoading, setIsAvatarTasksLoading] = useState(false);
  const [isUserRunwayAvatarsLoading, setIsUserRunwayAvatarsLoading] = useState(false);
  const [isUserRunwayAvatarSelecting, setIsUserRunwayAvatarSelecting] = useState(false);
  const [isAvatarImageGenerating, setIsAvatarImageGenerating] = useState(false);
  const [isRunwayAvatarCreating, setIsRunwayAvatarCreating] = useState(false);
  const [isAvatarSpeechGenerating, setIsAvatarSpeechGenerating] = useState(false);
  const [isAvatarVideoGenerating, setIsAvatarVideoGenerating] = useState(false);
  const [isAvatarVideoAccepting, setIsAvatarVideoAccepting] = useState(false);
  const [isAvatarVideoSaving, setIsAvatarVideoSaving] = useState(false);
  const [isAvatarRejecting, setIsAvatarRejecting] = useState(false);
  const { googleSpeakers } = useGoogleTTSSpeakers();
  const combinedTtsSpeakerTypes = useMemo(
    () => mergeGoogleTTSSpeakers(TTS_COMBINED_SPEAKER_TYPES, googleSpeakers),
    [googleSpeakers]
  );
  const { audioAvailability } = useAudioProviderAvailability();
  const availableTtsSpeakerTypes = useMemo(
    () => filterSpeakersForAudioAvailability(combinedTtsSpeakerTypes, audioAvailability),
    [audioAvailability, combinedTtsSpeakerTypes]
  );

  useEffect(() => {
    if (!selectedAvatarImageModel) {
      return;
    }
    try {
      localStorage.setItem(AVATAR_IMAGE_MODEL_STORAGE_KEY, selectedAvatarImageModel);
    } catch (_error) {
      // Model persistence is optional when browser storage is unavailable.
    }
  }, [selectedAvatarImageModel]);

  const mediaRecorderRef = useRef(null);
  const mediaStreamRef = useRef(null);
  const facecamMediaRecorderRef = useRef(null);
  const facecamStreamRef = useRef(null);
  const audioContextRef = useRef(null);
  const gainNodeRef = useRef(null);
  const analyserRef = useRef(null);
  const recordedChunksRef = useRef([]);
  const facecamChunksRef = useRef([]);
  const facecamDiscardStoppedRef = useRef(false);
  const facecamStopPromiseRef = useRef(null);
  const facecamDurationRef = useRef(null);
  const recordingStartedAtRef = useRef(0);
  const recordingTimerRef = useRef(null);
  const chunkFlushTimerRef = useRef(null);
  const levelTimerRef = useRef(null);
  const levelSamplesRef = useRef(null);
  const previewAudioRef = useRef(null);
  const facecamPreviewRef = useRef(null);
  const recordingUrlRef = useRef('');
  const facecamUrlRef = useRef('');
  const discardStoppedRecordingRef = useRef(false);
  const recorderStopReasonRef = useRef('idle');
  const currentLayerSeekRef = useRef(0);
  const recordingStartTimeRef = useRef(null);
  const isStartingRecordingRef = useRef(false);
  const isRecordingRef = useRef(false);
  const isImmersiveActiveRef = useRef(false);
  const lastLevelUpdateRef = useRef(0);
  const levelValueRef = useRef(0);
  const lastTranscriptDebugBucketRef = useRef(null);
  const lastTranscriptDebugCueRef = useRef('');

  const borderColor = colorMode === 'dark' ? 'border-[#1f2a3d]' : 'border-slate-200';
  const panelBg = colorMode === 'dark' ? 'bg-[#0b1224]' : 'bg-slate-50';
  const mutedText = colorMode === 'dark' ? 'text-slate-400' : 'text-slate-600';
  const sliderAccent = colorMode === 'dark' ? '#f87171' : '#2563eb';
  const currentLayerStartTime = resolveLayerStartTime(currentLayer);
  const currentPreviewTime = Math.max(0, (Number(currentLayerSeek) || 0) / DISPLAY_FRAMES_PER_SECOND);
  const requestedFacecamFramesPerSecond = Number(sessionDetails?.framesPerSecond);
  const facecamFramesPerSecond = [16, 24, 30].includes(requestedFacecamFramesPerSecond)
    ? requestedFacecamFramesPerSecond
    : 24;
  const hintTimelineTime = currentPreviewTime;
  const canUseRecorder = typeof navigator !== 'undefined'
    && Boolean(navigator.mediaDevices?.getUserMedia)
    && typeof MediaRecorder !== 'undefined';
  const hasRecording = Boolean(recordingBlob && recordingUrl);
  const hasFacecamRecording = Boolean(facecamBlob && facecamUrl);
  const normalizedRecordMode = ['audio_video', 'facecam_audio', 'record_facecam'].includes(recordMode)
    ? 'audio_video'
    : 'audio';
  const shouldRecordFacecam = normalizedRecordMode === 'audio_video';
  const hasCurrentLayer = Boolean(currentLayer?._id || currentLayer?.id);
  const resolvedRecordingDuration = Number.isFinite(Number(recordingDuration)) && Number(recordingDuration) > 0
    ? Number(recordingDuration)
    : recordingSeconds;
  const selectedMicLabel = useMemo(() => {
    const selectedMic = microphones.find((device) => device.deviceId === selectedMicId);
    return selectedMic?.label || 'Default microphone';
  }, [microphones, selectedMicId]);
  const selectedCameraLabel = useMemo(() => {
    const selectedCamera = cameraDevices.find((device) => device.deviceId === selectedCameraId);
    return selectedCamera?.label || 'Default camera';
  }, [cameraDevices, selectedCameraId]);
  const speechHintCues = useMemo(() => normalizeTimelineHints(
    sessionDetails?.timelineHints || sessionDetails?.hints || []
  ), [sessionDetails?.hints, sessionDetails?.timelineHints]);
  const latestHintEndTime = useMemo(() => (
    speechHintCues.reduce((latestEndTime, hintCue) => (
      Math.max(latestEndTime, Number(hintCue?.endTime) || 0)
    ), 0)
  ), [speechHintCues]);
  const sessionDuration = useMemo(() => resolveSessionDuration(
    sessionDetails,
    latestHintEndTime
  ), [
    latestHintEndTime,
    sessionDetails,
  ]);
  const generatedSpeechAudioSummary = useMemo(
    () => getGeneratedSpeechAudioSummary(sessionDetails),
    [sessionDetails]
  );
  const usesSessionSpeechForAvatarVideo = avatarVideoAudioSource === AVATAR_VIDEO_AUDIO_SOURCE_SESSION_SPEECH;
  const usesHintSpeechForAvatarVideo = avatarVideoAudioSource === AVATAR_VIDEO_AUDIO_SOURCE_HINT_SPEECH;
  const selectedAvatarTask = useMemo(() => {
    if (!avatarTasks.length) {
      return null;
    }
    return avatarTasks.find((task) => getAvatarTaskId(task) === selectedAvatarTaskId)
      || avatarTasks[0]
      || null;
  }, [avatarTasks, selectedAvatarTaskId]);
  const getAvatarImageKey = (task) => {
    const taskId = getAvatarTaskId(task) || task?.runwayAvatarId || 'avatar';
    const imageUrl = normalizeProcessorAssetUrl(task?.avatarImageUrl || task?.avatarImage || '');
    return imageUrl ? `${taskId}:${imageUrl}` : '';
  };
  const markAvatarImageUnavailable = (task) => {
    const imageKey = getAvatarImageKey(task);
    if (!imageKey) {
      return;
    }
    setUnavailableAvatarImageKeys((currentKeys) => {
      if (currentKeys.has(imageKey)) {
        return currentKeys;
      }
      const nextKeys = new Set(currentKeys);
      nextKeys.add(imageKey);
      return nextKeys;
    });
  };
  const generatedAvatarTasks = useMemo(() => avatarTasks.filter((task) => {
    const imageUrl = normalizeProcessorAssetUrl(task?.avatarImageUrl || task?.avatarImage || '');
    const taskId = getAvatarTaskId(task) || task?.runwayAvatarId || 'avatar';
    return Boolean(imageUrl) && !unavailableAvatarImageKeys.has(`${taskId}:${imageUrl}`);
  }), [avatarTasks, unavailableAvatarImageKeys]);
  const reusableRunwayAvatars = useMemo(() => {
    const sessionAvatarIds = new Set(
      avatarTasks
        .map((task) => task?.runwayAvatarId)
        .filter(Boolean)
    );
    return userRunwayAvatars.filter((task) => {
      const imageUrl = normalizeProcessorAssetUrl(task?.avatarImageUrl || task?.avatarImage || '');
      const taskId = getAvatarTaskId(task) || task?.runwayAvatarId || 'avatar';
      return task?.runwayAvatarId
        && imageUrl
        && !sessionAvatarIds.has(task.runwayAvatarId)
        && !unavailableAvatarImageKeys.has(`${taskId}:${imageUrl}`);
    });
  }, [avatarTasks, unavailableAvatarImageKeys, userRunwayAvatars]);
  const selectedAvatarImageUrl = normalizeProcessorAssetUrl(
    selectedAvatarTask?.avatarImageUrl || selectedAvatarTask?.avatarImage || ''
  );
  const selectedAvatarImageUnavailable = selectedAvatarTask
    ? unavailableAvatarImageKeys.has(getAvatarImageKey(selectedAvatarTask))
    : false;
  const selectedAvatarVideoUrl = normalizeProcessorAssetUrl(
    selectedAvatarTask?.avatarVideoPreviewUrl
      || selectedAvatarTask?.avatarVideoUrl
      || selectedAvatarTask?.avatarVideoAssetPath
      || ''
  );
  const selectedAvatarSpeechAudioUrl = normalizeProcessorAssetUrl(
    selectedAvatarTask?.avatarSpeechAudioPreviewUrl
      || selectedAvatarTask?.avatarSpeechAudioUrl
      || selectedAvatarTask?.avatarSpeechAudioAssetPath
      || ''
  );
  const selectedAvatarStatusLabel = selectedAvatarTask
    ? getAvatarTaskStatusLabel(selectedAvatarTask)
    : '';
  const selectedAvatarStatus = normalizeAvatarTaskStatus(selectedAvatarTask?.status);
  const selectedAvatarImageStatus = normalizeAvatarTaskStatus(selectedAvatarTask?.imageStatus);
  const selectedRunwayAvatarStatus = normalizeAvatarTaskStatus(selectedAvatarTask?.runwayAvatarStatus);
  const selectedAvatarSpeechStatus = normalizeAvatarTaskStatus(selectedAvatarTask?.avatarSpeechStatus);
  const selectedAvatarVideoStatus = normalizeAvatarTaskStatus(selectedAvatarTask?.avatarVideoStatus);
  const selectedAvatarTaskIdValue = selectedAvatarTask ? getAvatarTaskId(selectedAvatarTask) : '';
  const selectedAvatarImagePending = Boolean(selectedAvatarTask)
    && !selectedAvatarImageUrl
    && (
      selectedAvatarStatus === 'IMAGE_PENDING'
      || ['PENDING', 'INIT', 'PROCESSING'].includes(selectedAvatarImageStatus)
    );
  const avatarImageReady = Boolean(selectedAvatarImageUrl)
    && !selectedAvatarImageUnavailable
    && (
      selectedAvatarStatus !== 'FAILED'
      || selectedAvatarImageStatus === 'COMPLETED'
    );
  const runwayAvatarReady = Boolean(selectedAvatarTask?.runwayAvatarId)
    && (
      selectedRunwayAvatarStatus === 'READY'
      || ['AVATAR_READY', 'SPEECH_PROCESSING', 'SPEECH_READY', 'VIDEO_PROCESSING', 'VIDEO_COMPLETED', 'SAVED', 'ACCEPTED'].includes(selectedAvatarStatus)
    );
  const avatarGenerationStarted = Boolean(selectedAvatarTask?.runwayAvatarId)
    || ['AVATAR_PROCESSING', 'AVATAR_READY', 'SPEECH_PROCESSING', 'SPEECH_READY', 'VIDEO_PROCESSING', 'VIDEO_COMPLETED', 'SAVED', 'ACCEPTED'].includes(selectedAvatarStatus);
  const avatarSpeechReady = Boolean(selectedAvatarSpeechAudioUrl)
    && (
      selectedAvatarSpeechStatus === 'COMPLETED'
      || ['SPEECH_READY', 'VIDEO_PROCESSING', 'VIDEO_COMPLETED', 'SAVED', 'ACCEPTED'].includes(selectedAvatarStatus)
    );
  const avatarVideoAudioReady = usesSessionSpeechForAvatarVideo
    ? generatedSpeechAudioSummary.hasAudio
    : avatarSpeechReady;
  const avatarVideoPricingDurationSeconds = Number(selectedAvatarTask?.pricingDurationSeconds) > 0
    ? Number(selectedAvatarTask.pricingDurationSeconds)
    : usesSessionSpeechForAvatarVideo && Number(generatedSpeechAudioSummary.durationSeconds) > 0
      ? Number(generatedSpeechAudioSummary.durationSeconds)
      : Number(selectedAvatarTask?.avatarSpeechDuration) > 0
        ? Number(selectedAvatarTask.avatarSpeechDuration)
        : latestHintEndTime || 1;
  const avatarVideoCreditEstimate = useMemo(
    () => estimateAvatarVideoCreditCost(avatarVideoPricingDurationSeconds),
    [avatarVideoPricingDurationSeconds]
  );
  const avatarVideoCostTooltip = [
    `${avatarVideoCreditEstimate.upfrontCredits} credits upfront, then ${avatarVideoCreditEstimate.creditsPerBillingUnit} credits per ${AVATAR_VIDEO_BILLING_UNIT_SECONDS} seconds.`,
    `Timed usage is about ${avatarVideoCreditEstimate.creditsPerSecond.toFixed(2)} credits/sec and rounds up to the next ${AVATAR_VIDEO_BILLING_UNIT_SECONDS}-second block.`,
    `Estimated total: ${avatarVideoCreditEstimate.creditsToCharge} credits for ${Math.ceil(avatarVideoCreditEstimate.durationSeconds)}s.`,
  ].join(' ');
  const avatarVideoDisabledReason = !avatarImageReady
    ? ''
    : !runwayAvatarReady && avatarGenerationStarted
      ? 'Avatar is still preparing.'
      : usesSessionSpeechForAvatarVideo && !generatedSpeechAudioSummary.hasAudio
        ? 'Generated session speech is not ready.'
      : usesHintSpeechForAvatarVideo && !avatarSpeechReady
        ? ['INIT', 'PENDING', 'PROCESSING'].includes(selectedAvatarSpeechStatus)
          ? 'Speech is still generating.'
          : 'Generate speech from hints before creating the video.'
      : usesHintSpeechForAvatarVideo && speechHintCues.length === 0
        ? 'Timeline hints unavailable.'
        : '';
  const avatarVideoActionLabel = !runwayAvatarReady
    ? avatarGenerationStarted
      ? 'Preparing avatar and video'
      : 'Generate avatar video'
    : 'Generate avatar video';
  const avatarVideoReady = Boolean(selectedAvatarVideoUrl)
    || ['VIDEO_COMPLETED', 'SAVED', 'ACCEPTED'].includes(selectedAvatarStatus);
  const avatarVideoTerminal = ['FAILED', 'CANCELLED'].includes(selectedAvatarVideoStatus)
    || ['FAILED', 'REJECTED'].includes(selectedAvatarStatus);
  const acceptedGlobalVideoId = getGlobalVideoId({ globalVideoId: selectedAvatarTask?.globalVideoId });
  const acceptedGlobalVideo = acceptedGlobalVideoId
    ? (
      sessionDetails?.global_videos
      || sessionDetails?.globalVideos
      || []
    ).find((globalVideo) => getGlobalVideoId(globalVideo) === acceptedGlobalVideoId)
    : null;
  const acceptedAvatarVideoNeedsRepair = selectedAvatarStatus === 'ACCEPTED'
    && (
      !acceptedGlobalVideoId
      || !acceptedGlobalVideo
      || shouldPollGlobalVideoProcessing({}, acceptedGlobalVideo)
    );
  const avatarTaskBusy = Boolean(selectedAvatarTask)
    && isAvatarTaskPolling(selectedAvatarTask, { includeSpeech: usesHintSpeechForAvatarVideo });
  const avatarAnyActionPending = isAvatarImageGenerating
    || isUserRunwayAvatarSelecting
    || isRunwayAvatarCreating
    || isAvatarSpeechGenerating
    || isAvatarVideoGenerating
    || isAvatarVideoAccepting
    || isAvatarVideoSaving
    || isAvatarRejecting;
  const avatarSpeechProviderOptions = useMemo(
    () => filterTtsProviderOptionsForAudioAvailability(AVATAR_TTS_PROVIDER_OPTIONS, audioAvailability),
    [audioAvailability]
  );
  const avatarSpeechSpeakerOptions = useMemo(() => {
    return getAvatarSpeechSpeakerOptions(selectedAvatarSpeechProvider, availableTtsSpeakerTypes);
  }, [selectedAvatarSpeechProvider, availableTtsSpeakerTypes]);
  const selectedAvatarSpeechSpeakerOption = useMemo(() => (
    avatarSpeechSpeakerOptions.find((option) => option.value === selectedAvatarSpeechSpeaker) || null
  ), [avatarSpeechSpeakerOptions, selectedAvatarSpeechSpeaker]);
  const selectedAvatarSpeechSpeakerLabel = useMemo(() => {
    const speaker = selectedAvatarSpeechSpeakerOption;
    return speaker?.label || speaker?.name || selectedAvatarSpeechSpeaker;
  }, [selectedAvatarSpeechSpeaker, selectedAvatarSpeechSpeakerOption]);
  const selectedAvatarTaskError = selectedAvatarStatus === 'FAILED'
    ? (
      selectedAvatarTask?.imageError
      || selectedAvatarTask?.avatarError
      || selectedAvatarTask?.avatarSpeechError
      || selectedAvatarTask?.avatarVideoError
      || selectedAvatarTask?.errorMessage
      || ''
    )
    : selectedAvatarImageStatus === 'FAILED'
      ? selectedAvatarTask?.imageError || selectedAvatarTask?.errorMessage || ''
      : selectedRunwayAvatarStatus === 'FAILED'
        ? selectedAvatarTask?.avatarError || selectedAvatarTask?.errorMessage || ''
        : selectedAvatarSpeechStatus === 'FAILED'
          ? selectedAvatarTask?.avatarSpeechError || selectedAvatarTask?.errorMessage || ''
        : ['FAILED', 'CANCELLED'].includes(selectedAvatarVideoStatus)
          ? selectedAvatarTask?.avatarVideoError || selectedAvatarTask?.errorMessage || ''
          : '';
  const globalRemainingSeconds = Math.max(0, sessionDuration - hintTimelineTime);
  const activeTranscriptCue = useMemo(() => {
    if (!hintsEnabled || speechHintCues.length === 0) {
      return null;
    }

    const resolvedTime = Math.max(0, Number(hintTimelineTime) || 0);
    const timeTolerance = 0.001;
    let activeCue = null;

    for (const candidateCue of speechHintCues) {
      const cueStartTime = Number(candidateCue?.startTime);
      if (!Number.isFinite(cueStartTime)) {
        continue;
      }
      if (cueStartTime > resolvedTime + timeTolerance) {
        break;
      }
      activeCue = candidateCue;
    }

    if (!activeCue) {
      return null;
    }

    const activeCueStartTime = Number(activeCue.startTime);
    const nextCue = speechHintCues.find((candidateCue) => (
      Number(candidateCue?.startTime) > activeCueStartTime + timeTolerance
    ));
    const finalCueEndTime = Number(activeCue.endTime);
    if (!nextCue && Number.isFinite(finalCueEndTime) && resolvedTime >= finalCueEndTime + 0.05) {
      return null;
    }

    return activeCue;
  }, [
    hintTimelineTime,
    hintsEnabled,
    speechHintCues,
  ]);
  const hintProgressWindow = useMemo(() => {
    if (!hintsEnabled || speechHintCues.length === 0) {
      return null;
    }

    const resolvedTime = Math.max(0, Number(hintTimelineTime) || 0);
    const timeTolerance = 0.001;
    const nextHint = speechHintCues.find((hintCue) => (
      Number(hintCue?.startTime) > resolvedTime + timeTolerance
    )) || null;

    if (!nextHint) {
      return null;
    }

    const targetStartTime = Math.max(0, Number(nextHint.startTime) || 0);
    const currentHint = [...speechHintCues]
      .reverse()
      .find((hintCue) => (
        Number(hintCue?.startTime) <= resolvedTime + timeTolerance
        && Number(hintCue?.startTime) < targetStartTime
      ));
    const fallbackStartTime = Number.isFinite(Number(recordingPreviewStartSeconds))
      ? Number(recordingPreviewStartSeconds)
      : currentLayerStartTime;
    const intervalStartTime = Math.min(
      targetStartTime - 0.001,
      Math.max(0, Number(currentHint?.startTime ?? fallbackStartTime) || 0)
    );

    return {
      targetKey: getHintCueKey(nextHint),
      targetHint: nextHint,
      currentHint,
      targetStartTime,
      intervalStartTime,
      progressPercent: calculateHintProgressPercent(intervalStartTime, targetStartTime, resolvedTime),
      remainingSeconds: Math.max(0, targetStartTime - resolvedTime),
    };
  }, [
    currentLayerStartTime,
    hintTimelineTime,
    hintsEnabled,
    recordingPreviewStartSeconds,
    speechHintCues,
  ]);
  const refreshMicrophones = async () => {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.enumerateDevices) {
      return;
    }

    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const audioInputs = devices.filter((device) => device.kind === 'audioinput');
      setMicrophones(audioInputs);
      setSelectedMicId((currentMicId) => {
        if (currentMicId && audioInputs.some((device) => device.deviceId === currentMicId)) {
          return currentMicId;
        }
        return audioInputs[0]?.deviceId || '';
      });
    } catch {
      setMicrophones([]);
    }
  };

  const refreshCameras = async () => {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.enumerateDevices) {
      return;
    }

    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const videoInputs = devices.filter((device) => device.kind === 'videoinput');
      setCameraDevices(videoInputs);
      setSelectedCameraId((currentCameraId) => {
        if (currentCameraId && videoInputs.some((device) => device.deviceId === currentCameraId)) {
          return currentCameraId;
        }
        return videoInputs[0]?.deviceId || '';
      });
    } catch {
      setCameraDevices([]);
    }
  };

  const mergeAvatarTask = (nextTask) => {
    if (!nextTask) {
      return;
    }

    const nextTaskId = getAvatarTaskId(nextTask);
    setAvatarTasks((currentTasks) => {
      const taskIndex = currentTasks.findIndex((task) => getAvatarTaskId(task) === nextTaskId);
      if (taskIndex === -1) {
        return [nextTask, ...currentTasks];
      }

      return currentTasks.map((task, index) => (
        index === taskIndex && shouldUseIncomingAvatarTask(task, nextTask)
          ? { ...task, ...nextTask }
          : task
      ));
    });

    if (nextTaskId) {
      setSelectedAvatarTaskId(nextTaskId);
    }
    if (nextTask.voicePresetId) {
      setSelectedAvatarVoiceId(nextTask.voicePresetId);
    }
    if (nextTask.speechProvider) {
      setSelectedAvatarSpeechProvider(normalizeAvatarTtsProvider(nextTask.speechProvider));
    }
    if (nextTask.speechSpeaker) {
      setSelectedAvatarSpeechSpeaker(nextTask.speechSpeaker);
    }
  };

  const applyAvatarVoices = (voices = []) => {
    if (!Array.isArray(voices) || voices.length === 0) {
      return;
    }

    setAvatarVoices(voices);
    setSelectedAvatarVoiceId((currentVoiceId) => {
      if (currentVoiceId && voices.some((voice) => voice.presetId === currentVoiceId)) {
        return currentVoiceId;
      }
      return voices[0]?.presetId || 'victoria';
    });
  };

  const loadAvatarTasks = async ({ silent = false } = {}) => {
    if (!sessionDetails?._id) {
      return;
    }

    const headers = getHeaders();
    if (!headers) {
      setAvatarError('You must be logged in to use avatar voiceover.');
      return;
    }

    if (!silent) {
      setIsAvatarTasksLoading(true);
    }
    setAvatarError('');
    try {
      const response = await axios.get(`${PROCESSOR_API_URL}/video_sessions/avatar_voiceover/list`, {
        ...headers,
        params: {
          sessionId: sessionDetails._id.toString(),
        },
      });
      const tasks = Array.isArray(response?.data?.tasks) ? response.data.tasks : [];
      setAvatarTasks((currentTasks) => {
        if (!silent) {
          return tasks;
        }

        const taskMap = new Map(currentTasks.map((task) => [getAvatarTaskId(task), task]));
        tasks.forEach((task) => {
          const taskId = getAvatarTaskId(task);
          if (!taskId) {
            return;
          }
          const currentTask = taskMap.get(taskId);
          if (!currentTask || shouldUseIncomingAvatarTask(currentTask, task)) {
            taskMap.set(taskId, currentTask ? { ...currentTask, ...task } : task);
          }
        });
        return Array.from(taskMap.values());
      });
      applyAvatarVoices(response?.data?.voices);
      setSelectedAvatarTaskId((currentTaskId) => {
        if (currentTaskId && tasks.some((task) => getAvatarTaskId(task) === currentTaskId)) {
          return currentTaskId;
        }
        return getAvatarTaskId(tasks[0]) || '';
      });
    } catch (error) {
      setAvatarError(error?.response?.data?.error || 'Unable to load avatar voiceover tasks.');
    } finally {
      if (!silent) {
        setIsAvatarTasksLoading(false);
      }
    }
  };

  const loadUserRunwayAvatars = async ({ silent = false } = {}) => {
    const headers = getHeaders();
    if (!headers) {
      setAvatarError('You must be logged in to use avatar voiceover.');
      return;
    }

    if (!silent) {
      setIsUserRunwayAvatarsLoading(true);
    }
    setAvatarError('');
    try {
      const response = await axios.get(`${PROCESSOR_API_URL}/video_sessions/avatar_voiceover/user_avatars`, headers);
      const avatars = Array.isArray(response?.data?.avatars) ? response.data.avatars : [];
      setUserRunwayAvatars(avatars);
      applyAvatarVoices(response?.data?.voices);
    } catch (error) {
      setAvatarError(error?.response?.data?.error || 'Unable to load saved avatars.');
    } finally {
      if (!silent) {
        setIsUserRunwayAvatarsLoading(false);
      }
    }
  };

  const refreshAvatarTask = async (taskId) => {
    if (!taskId) {
      return null;
    }

    const headers = getHeaders();
    if (!headers) {
      return null;
    }

    const response = await axios.get(`${PROCESSOR_API_URL}/video_sessions/avatar_voiceover/status`, {
      ...headers,
      params: {
        taskId,
      },
    });
    applyAvatarVoices(response?.data?.voices);
    const nextTask = response?.data?.task || null;
    if (nextTask) {
      mergeAvatarTask(nextTask);
    }
    return nextTask;
  };

  const handleGenerateAvatarImage = async () => {
    if (!sessionDetails?._id) {
      setAvatarError('Open a video session before generating an avatar image.');
      return;
    }

    const prompt = avatarPrompt.trim();
    if (!prompt) {
      setAvatarError('Describe the avatar image first.');
      return;
    }

    const headers = getHeaders();
    if (!headers) {
      setAvatarError('You must be logged in to generate an avatar image.');
      return;
    }

    setIsAvatarImageGenerating(true);
    setAvatarError('');
    try {
      const response = await axios.post(`${PROCESSOR_API_URL}/video_sessions/avatar_voiceover/generate_avatar_image`, {
        sessionId: sessionDetails._id.toString(),
        prompt,
        imageModel: selectedAvatarImageModel,
      }, headers);
      applyAvatarVoices(response?.data?.voices);
      mergeAvatarTask(response?.data?.task);
      toast.success('Avatar image generation started.', {
        position: 'bottom-center',
        className: 'custom-toast',
      });
    } catch (error) {
      setAvatarError(error?.response?.data?.error || 'Unable to generate avatar image.');
    } finally {
      setIsAvatarImageGenerating(false);
    }
  };

  const handleCreateRunwayAvatar = async ({ silent = false, autoGenerateVideo = false } = {}) => {
    if (!selectedAvatarTaskIdValue || !avatarImageReady) {
      setAvatarError('Generate or select an avatar image first.');
      return null;
    }

    const headers = getHeaders();
    if (!headers) {
      setAvatarError('You must be logged in to create an avatar.');
      return null;
    }

    setIsRunwayAvatarCreating(true);
    setAvatarError('');
    try {
      const response = await axios.post(`${PROCESSOR_API_URL}/video_sessions/avatar_voiceover/create_avatar`, {
        taskId: selectedAvatarTaskIdValue,
        voicePresetId: selectedAvatarVoiceId,
        autoGenerateVideo,
        audioSource: avatarVideoAudioSource,
      }, headers);
      applyAvatarVoices(response?.data?.voices);
      mergeAvatarTask(response?.data?.task);
      loadUserRunwayAvatars({ silent: true }).catch(() => {});
      if (!silent) {
        toast.success('Avatar generation started.', {
          position: 'bottom-center',
          className: 'custom-toast',
        });
      }
      return response?.data?.task || null;
    } catch (error) {
      setAvatarError(error?.response?.data?.error || 'Unable to create avatar.');
      return null;
    } finally {
      setIsRunwayAvatarCreating(false);
    }
  };

  const handleSelectUserRunwayAvatar = async (avatarTask) => {
    if (!sessionDetails?._id) {
      setAvatarError('Open a video session before selecting an avatar.');
      return;
    }

    const sourceTaskId = getAvatarTaskId(avatarTask);
    const runwayAvatarId = avatarTask?.runwayAvatarId;
    if (!sourceTaskId && !runwayAvatarId) {
      setAvatarError('Choose an avatar first.');
      return;
    }

    const headers = getHeaders();
    if (!headers) {
      setAvatarError('You must be logged in to select an avatar.');
      return;
    }

    setIsUserRunwayAvatarSelecting(true);
    setAvatarError('');
    try {
      const response = await axios.post(`${PROCESSOR_API_URL}/video_sessions/avatar_voiceover/select_avatar`, {
        sessionId: sessionDetails._id.toString(),
        taskId: sourceTaskId,
        runwayAvatarId,
      }, headers);
      applyAvatarVoices(response?.data?.voices);
      mergeAvatarTask(response?.data?.task);
      toast.success('Avatar selected for this session.', {
        position: 'bottom-center',
        className: 'custom-toast',
      });
    } catch (error) {
      setAvatarError(error?.response?.data?.error || 'Unable to select avatar.');
    } finally {
      setIsUserRunwayAvatarSelecting(false);
    }
  };

  const handleGenerateAvatarSpeechFromHints = async () => {
    if (!selectedAvatarTaskIdValue) {
      setAvatarError('Generate or select an avatar image first.');
      return;
    }
    if (speechHintCues.length === 0) {
      setAvatarError('Timeline hints are required before generating avatar speech.');
      return;
    }
    if (!selectedAvatarSpeechSpeakerOption) {
      setAvatarError('Choose a speaker before generating avatar speech.');
      return;
    }

    const headers = getHeaders();
    if (!headers) {
      setAvatarError('You must be logged in to generate avatar speech.');
      return;
    }

    setIsAvatarSpeechGenerating(true);
    setAvatarError('');
    try {
      const response = await axios.post(`${PROCESSOR_API_URL}/video_sessions/avatar_voiceover/generate_speech_from_hints`, {
        taskId: selectedAvatarTaskIdValue,
        provider: normalizeAvatarTtsProvider(selectedAvatarSpeechSpeakerOption.provider),
        speaker: selectedAvatarSpeechSpeakerOption.value,
        languageCode: selectedAvatarSpeechSpeakerOption.languageCode,
        languageCodes: selectedAvatarSpeechSpeakerOption.languageCodes,
        speakerName: selectedAvatarSpeechSpeakerLabel,
        speakerVoiceId: selectedAvatarSpeechSpeakerOption.voiceId || selectedAvatarSpeechSpeakerOption.value,
        speakerLabel: selectedAvatarSpeechSpeakerOption.label || selectedAvatarSpeechSpeakerOption.name,
        speakerDetails:
          normalizeAvatarTtsProvider(selectedAvatarSpeechSpeakerOption.provider) === 'GOOGLE'
            ? getGoogleTTSVoiceDetails(selectedAvatarSpeechSpeakerOption)
            : null,
      }, headers);
      applyAvatarVoices(response?.data?.voices);
      mergeAvatarTask(response?.data?.task);
      toast.success('Avatar speech generation started.', {
        position: 'bottom-center',
        className: 'custom-toast',
      });
    } catch (error) {
      setAvatarError(error?.response?.data?.error || 'Unable to generate avatar speech.');
    } finally {
      setIsAvatarSpeechGenerating(false);
    }
  };

  const handleGenerateAvatarVideoFromHints = async () => {
    if (!selectedAvatarTaskIdValue || !avatarImageReady) {
      setAvatarError('Generate or select an avatar image first.');
      return;
    }
    if (usesHintSpeechForAvatarVideo && speechHintCues.length === 0) {
      setAvatarError('Timeline hints are required before generating avatar video.');
      return;
    }
    if (usesHintSpeechForAvatarVideo && !avatarSpeechReady) {
      setAvatarError('Generate speech from hints before generating avatar video.');
      return;
    }
    if (usesSessionSpeechForAvatarVideo && !generatedSpeechAudioSummary.hasAudio) {
      setAvatarError('Generated session speech is not ready.');
      return;
    }
    if (!runwayAvatarReady) {
      if (avatarGenerationStarted || avatarTaskBusy) {
        setAvatarError('Avatar is still preparing.');
        return;
      }

      const preparedTask = await handleCreateRunwayAvatar({
        silent: true,
        autoGenerateVideo: true,
      });
      if (!preparedTask) {
        return;
      }

      const preparedStatus = normalizeAvatarTaskStatus(preparedTask?.status);
      const preparedVideoStatus = normalizeAvatarTaskStatus(preparedTask?.avatarVideoStatus);
      if (preparedStatus === 'FAILED' || preparedVideoStatus === 'FAILED') {
        setAvatarError(
          preparedTask?.avatarVideoError
          || preparedTask?.errorMessage
          || 'Unable to start avatar video generation.'
        );
        return;
      }

      const preparedVideoStarted = Boolean(preparedTask?.avatarVideoTaskId)
        || preparedStatus === 'VIDEO_PROCESSING'
        || ['PENDING', 'PROCESSING', 'RUNNING'].includes(preparedVideoStatus);
      toast.success(
        preparedVideoStarted
          ? 'Avatar video generation started.'
          : 'Avatar is being prepared. Lip sync will start automatically when it is ready.',
        {
          position: 'bottom-center',
          className: 'custom-toast',
        }
      );
      return;
    }

    const headers = getHeaders();
    if (!headers) {
      setAvatarError('You must be logged in to generate an avatar video.');
      return;
    }

    setIsAvatarVideoGenerating(true);
    setAvatarError('');
    try {
      const response = await axios.post(`${PROCESSOR_API_URL}/video_sessions/avatar_voiceover/generate_video_from_hints`, {
        taskId: selectedAvatarTaskIdValue,
        audioSource: avatarVideoAudioSource,
      }, headers);
      applyAvatarVoices(response?.data?.voices);
      mergeAvatarTask(response?.data?.task);
      toast.success('Avatar video generation started.', {
        position: 'bottom-center',
        className: 'custom-toast',
      });
    } catch (error) {
      setAvatarError(error?.response?.data?.error || 'Unable to generate avatar video.');
    } finally {
      setIsAvatarVideoGenerating(false);
    }
  };

  const handleAcceptAvatarVideo = async () => {
    if (!selectedAvatarTaskIdValue || !avatarVideoReady) {
      setAvatarError('Generate an avatar video before accepting it.');
      return;
    }

    const headers = getHeaders();
    if (!headers) {
      setAvatarError('You must be logged in to accept avatar video.');
      return;
    }

    setIsAvatarVideoAccepting(true);
    setAvatarError('');
    try {
      const response = await axios.post(`${PROCESSOR_API_URL}/video_sessions/avatar_voiceover/accept_video`, {
        taskId: selectedAvatarTaskIdValue,
        startTime: currentLayerStartTime,
        framesPerSecond: facecamFramesPerSecond,
        shapeOverlay: facecamShapeOverlay,
      }, headers);
      mergeAvatarTask(response?.data?.task);
      let nextSessionDetails = response?.data?.sessionDetails || null;
      let acceptedGlobalVideo = response?.data?.globalVideo || null;
      if (nextSessionDetails && typeof onAvatarVoiceoverSessionChange === 'function') {
        onAvatarVoiceoverSessionChange(nextSessionDetails);
      }
      if (acceptedGlobalVideo && shouldPollGlobalVideoProcessing(response?.data, acceptedGlobalVideo)) {
        acceptedGlobalVideo = await pollGlobalVideoProcessing({
          sessionId: sessionDetails?._id?.toString?.() || nextSessionDetails?._id?.toString?.(),
          globalVideo: acceptedGlobalVideo,
          headers,
          failureMessage: 'Unable to process avatar video for the session.',
          timeoutMessage: 'Avatar video was added, but processing is still running. Please try again in a moment.',
        });
        nextSessionDetails = mergeGlobalVideoIntoSessionDetails(nextSessionDetails || sessionDetails, acceptedGlobalVideo);
        if (nextSessionDetails && typeof onAvatarVoiceoverSessionChange === 'function') {
          onAvatarVoiceoverSessionChange(nextSessionDetails);
        }
      }
      toast.success('Avatar voiceover added to the session.', {
        position: 'bottom-center',
        className: 'custom-toast',
      });
    } catch (error) {
      setAvatarError(error?.response?.data?.error || 'Unable to accept avatar video.');
    } finally {
      setIsAvatarVideoAccepting(false);
    }
  };

  const handleSaveAvatarVideoToLibrary = async () => {
    if (!selectedAvatarTaskIdValue || !avatarVideoReady) {
      setAvatarError('Generate an avatar video before saving it.');
      return;
    }

    const headers = getHeaders();
    if (!headers) {
      setAvatarError('You must be logged in to save avatar video.');
      return;
    }

    setIsAvatarVideoSaving(true);
    setAvatarError('');
    try {
      const response = await axios.post(`${PROCESSOR_API_URL}/video_sessions/avatar_voiceover/save_video_to_library`, {
        taskId: selectedAvatarTaskIdValue,
      }, headers);
      mergeAvatarTask(response?.data?.task);
      toast.success('Avatar video saved to library.', {
        position: 'bottom-center',
        className: 'custom-toast',
      });
    } catch (error) {
      setAvatarError(error?.response?.data?.error || 'Unable to save avatar video.');
    } finally {
      setIsAvatarVideoSaving(false);
    }
  };

  const handleRejectAvatarVideo = async () => {
    if (!selectedAvatarTaskIdValue) {
      return;
    }

    const headers = getHeaders();
    if (!headers) {
      setAvatarError('You must be logged in to reject avatar video.');
      return;
    }

    setIsAvatarRejecting(true);
    setAvatarError('');
    try {
      const response = await axios.post(`${PROCESSOR_API_URL}/video_sessions/avatar_voiceover/reject`, {
        taskId: selectedAvatarTaskIdValue,
      }, headers);
      mergeAvatarTask(response?.data?.task);
    } catch (error) {
      setAvatarError(error?.response?.data?.error || 'Unable to reject avatar video.');
    } finally {
      setIsAvatarRejecting(false);
    }
  };

  useEffect(() => {
    refreshMicrophones().catch(() => {});
    refreshCameras().catch(() => {});

    if (typeof navigator !== 'undefined' && navigator.mediaDevices?.addEventListener) {
      const handleDeviceChange = () => {
        refreshMicrophones().catch(() => {});
        refreshCameras().catch(() => {});
      };
      navigator.mediaDevices.addEventListener('devicechange', handleDeviceChange);
      return () => {
        navigator.mediaDevices.removeEventListener('devicechange', handleDeviceChange);
      };
    }

    return undefined;
  }, []);

  useEffect(() => {
    if (avatarSpeechProviderOptions.length === 0) {
      setSelectedAvatarSpeechProvider('');
      setSelectedAvatarSpeechSpeaker('');
      return;
    }

    if (!avatarSpeechProviderOptions.some((provider) => provider.value === selectedAvatarSpeechProvider)) {
      const nextProvider = avatarSpeechProviderOptions[0].value;
      setSelectedAvatarSpeechProvider(nextProvider);
      setSelectedAvatarSpeechSpeaker(
        getDefaultAvatarSpeechSpeakerValue(nextProvider, availableTtsSpeakerTypes)
      );
      return;
    }

    if (avatarSpeechSpeakerOptions.some((speaker) => speaker.value === selectedAvatarSpeechSpeaker)) {
      return;
    }
    setSelectedAvatarSpeechSpeaker(
      getDefaultAvatarSpeechSpeakerValue(selectedAvatarSpeechProvider, availableTtsSpeakerTypes)
    );
  }, [
    avatarSpeechProviderOptions,
    avatarSpeechSpeakerOptions,
    availableTtsSpeakerTypes,
    selectedAvatarSpeechProvider,
    selectedAvatarSpeechSpeaker,
  ]);

  const handleAvatarSpeechProviderChange = (nextProviderValue) => {
    const nextProvider = normalizeAvatarTtsProvider(nextProviderValue);
    setSelectedAvatarSpeechProvider(nextProvider);
    setSelectedAvatarSpeechSpeaker(
      getDefaultAvatarSpeechSpeakerValue(nextProvider, availableTtsSpeakerTypes)
    );
  };

  const handleAvatarSpeechSpeakerChange = (nextSpeakerValue) => {
    const nextSpeaker = avatarSpeechSpeakerOptions.find((option) => option.value === nextSpeakerValue);
    setSelectedAvatarSpeechSpeaker(nextSpeaker?.value || '');
  };

  useEffect(() => {
    if (facecamVoiceoverMode !== 'avatar_voiceover') {
      return;
    }

    loadAvatarTasks().catch(() => {});
    loadUserRunwayAvatars().catch(() => {});
  }, [facecamVoiceoverMode, sessionDetails?._id]);

  useEffect(() => {
    if (facecamVoiceoverMode !== 'avatar_voiceover' || !selectedAvatarTaskIdValue || !avatarTaskBusy) {
      return undefined;
    }

    const intervalId = window.setInterval(() => {
      refreshAvatarTask(selectedAvatarTaskIdValue).catch(() => {});
      loadAvatarTasks({ silent: true }).catch(() => {});
      loadUserRunwayAvatars({ silent: true }).catch(() => {});
    }, AVATAR_VOICEOVER_POLL_INTERVAL_MS);

    refreshAvatarTask(selectedAvatarTaskIdValue).catch(() => {});
    loadAvatarTasks({ silent: true }).catch(() => {});
    loadUserRunwayAvatars({ silent: true }).catch(() => {});
    return () => {
      window.clearInterval(intervalId);
    };
  }, [
    avatarTaskBusy,
    facecamVoiceoverMode,
    selectedAvatarTaskIdValue,
  ]);

  useEffect(() => {
    if (gainNodeRef.current) {
      gainNodeRef.current.gain.value = Math.max(0, Number(micVolume) || 0) / 100;
    }
  }, [micVolume]);

  useEffect(() => {
    recordingUrlRef.current = recordingUrl;
  }, [recordingUrl]);

  useEffect(() => {
    facecamUrlRef.current = facecamUrl;
  }, [facecamUrl]);

  useEffect(() => {
    if (!facecamPreviewRef.current || isFacecamRecording) {
      return;
    }

    facecamPreviewRef.current.srcObject = null;
  }, [facecamUrl, isFacecamRecording]);

  useEffect(() => {
    const resolvedSeek = Number(currentLayerSeek);
    currentLayerSeekRef.current = Number.isFinite(resolvedSeek) ? resolvedSeek : 0;
  }, [currentLayerSeek]);

  useEffect(() => {
    isRecordingRef.current = isRecording;
  }, [isRecording]);

  useEffect(() => {
    isImmersiveActiveRef.current = isImmersiveActive;
  }, [isImmersiveActive]);

  useEffect(() => {
    if (typeof onRecordSpeechRecordingChange !== 'function') {
      return;
    }

    onRecordSpeechRecordingChange(Boolean(isRecording || isStartingRecording));
  }, [isRecording, isStartingRecording, onRecordSpeechRecordingChange]);

  useEffect(() => () => {
    if (typeof onRecordSpeechRecordingChange === 'function') {
      onRecordSpeechRecordingChange(false);
    }
  }, [onRecordSpeechRecordingChange]);

  useEffect(() => {
    return () => {
      stopRecorderStream();
      clearRecordingTimers();
      if (levelTimerRef.current) {
        window.clearTimeout(levelTimerRef.current);
      }
      if (previewAudioRef.current) {
        previewAudioRef.current.pause();
      }
      if (recordingUrlRef.current) {
        URL.revokeObjectURL(recordingUrlRef.current);
      }
      if (facecamUrlRef.current) {
        URL.revokeObjectURL(facecamUrlRef.current);
      }
      stopFacecamStream();
    };
  }, []);

  const clearRecordingTimers = () => {
    if (recordingTimerRef.current) {
      window.clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
    if (chunkFlushTimerRef.current) {
      window.clearInterval(chunkFlushTimerRef.current);
      chunkFlushTimerRef.current = null;
    }
  };

  const stopRecorderStream = () => {
    if (levelTimerRef.current) {
      window.clearTimeout(levelTimerRef.current);
      levelTimerRef.current = null;
    }

    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => track.stop());
      mediaStreamRef.current = null;
    }

    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }

    gainNodeRef.current = null;
    analyserRef.current = null;
    levelSamplesRef.current = null;
    levelValueRef.current = 0;
    setLevel(0);
  };

  const stopFacecamStream = () => {
    if (facecamStreamRef.current) {
      facecamStreamRef.current.getTracks().forEach((track) => track.stop());
      facecamStreamRef.current = null;
    }
    if (facecamPreviewRef.current) {
      facecamPreviewRef.current.srcObject = null;
    }
  };

  const stopFacecamRecording = ({ discard = false } = {}) => {
    const recorder = facecamMediaRecorderRef.current;
    if (!recorder || recorder.state === 'inactive') {
      stopFacecamStream();
      return facecamStopPromiseRef.current || Promise.resolve(null);
    }

    if (discard) {
      facecamDiscardStoppedRef.current = true;
    }

    try {
      recorder.stop();
    } catch {
      stopFacecamStream();
      setIsFacecamRecording(false);
    }

    return facecamStopPromiseRef.current || Promise.resolve(null);
  };

  const startFacecamRecording = async () => {
    if (!shouldRecordFacecam) {
      return true;
    }

    setFacecamError('');
    const constraints = {
      video: selectedCameraId
        ? { deviceId: { exact: selectedCameraId }, width: { ideal: 960 }, height: { ideal: 960 }, frameRate: { ideal: facecamFramesPerSecond, max: facecamFramesPerSecond } }
        : { width: { ideal: 960 }, height: { ideal: 960 }, frameRate: { ideal: facecamFramesPerSecond, max: facecamFramesPerSecond } },
      audio: false,
    };
    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    facecamStreamRef.current = stream;
    refreshCameras().catch(() => {});

    if (facecamPreviewRef.current) {
      facecamPreviewRef.current.srcObject = stream;
      facecamPreviewRef.current.muted = true;
      facecamPreviewRef.current.play?.().catch(() => {});
    }

    const mimeType = getSupportedVideoRecorderMimeType();
    const recorderOptions = {
      ...(mimeType ? { mimeType } : {}),
      videoBitsPerSecond: FACECAM_VIDEO_BITS_PER_SECOND,
    };
    let recorder;
    try {
      recorder = new MediaRecorder(stream, recorderOptions);
    } catch {
      recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    }
    facecamMediaRecorderRef.current = recorder;
    facecamChunksRef.current = [];
    facecamDiscardStoppedRef.current = false;

    facecamStopPromiseRef.current = new Promise((resolve) => {
      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          facecamChunksRef.current.push(event.data);
        }
      };

      recorder.onerror = (event) => {
        setFacecamError(event?.error?.message || event?.message || 'Unable to record facecam.');
      };

      recorder.onstop = async () => {
        setIsFacecamRecording(false);
        stopFacecamStream();

        if (facecamDiscardStoppedRef.current) {
          facecamDiscardStoppedRef.current = false;
          facecamChunksRef.current = [];
          resolve(null);
          return;
        }

        const recordedMimeType = recorder.mimeType || mimeType || 'video/webm';
        const blob = new Blob(facecamChunksRef.current, { type: recordedMimeType });
        if (!blob.size) {
          resolve(null);
          return;
        }

        if (facecamUrlRef.current) {
          URL.revokeObjectURL(facecamUrlRef.current);
        }
        const objectUrl = URL.createObjectURL(blob);
        facecamUrlRef.current = objectUrl;
        setFacecamBlob(blob);
        setFacecamUrl(objectUrl);
        const resolvedFacecamDuration = await resolveVideoBlobDuration(objectUrl);
        facecamDurationRef.current = resolvedFacecamDuration;
        setFacecamDuration(resolvedFacecamDuration);
        resolve(blob);
      };
    });

    recorder.start(FACECAM_RECORDER_TIMESLICE_MS);
    setIsFacecamRecording(true);
    return true;
  };

  const updateLevel = () => {
    const analyser = analyserRef.current;
    if (!analyser || !isRecordingRef.current) {
      return;
    }

    let samples = levelSamplesRef.current;
    if (!samples || samples.length !== analyser.fftSize) {
      samples = new Uint8Array(analyser.fftSize);
      levelSamplesRef.current = samples;
    }

    analyser.getByteTimeDomainData(samples);
    let sumSquares = 0;
    for (let sampleIndex = 0; sampleIndex < samples.length; sampleIndex += 1) {
      const sample = samples[sampleIndex];
      const centeredSample = (sample - 128) / 128;
      sumSquares += centeredSample * centeredSample;
    }
    const rms = Math.sqrt(sumSquares / samples.length);
    const nextLevel = Math.min(1, rms * 4);
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (
      now - lastLevelUpdateRef.current > 100 ||
      Math.abs(nextLevel - levelValueRef.current) > 0.08
    ) {
      lastLevelUpdateRef.current = now;
      levelValueRef.current = nextLevel;
      setLevel(nextLevel);
    }
    levelTimerRef.current = window.setTimeout(updateLevel, 100);
  };

  const resetRecording = ({ preserveRecordingPreview = false } = {}) => {
    if (previewAudioRef.current) {
      previewAudioRef.current.pause();
      previewAudioRef.current = null;
    }
    if (recordingUrl) {
      URL.revokeObjectURL(recordingUrl);
    }
    if (facecamUrl) {
      URL.revokeObjectURL(facecamUrl);
    }
    setRecordingBlob(null);
    setRecordingUrl('');
    setRecordingDuration(null);
    setFacecamBlob(null);
    setFacecamUrl('');
    setFacecamDuration(null);
    setUploadedGlobalVideo(null);
    setFacecamError('');
    facecamStopPromiseRef.current = null;
    facecamDurationRef.current = null;
    setUploadedLibraryItem(null);
    setHasAddedToSession(false);
    setIsPlayingPreview(false);
    setRecordingSeconds(0);
    if (!preserveRecordingPreview) {
      recordingStartTimeRef.current = null;
      setRecordingPreviewStartSeconds(null);
      setIsRecordingPreviewActive(false);
    }
  };

  const startRecording = async ({ onStarted, preserveRecordingPreview = false } = {}) => {
    if (!canUseRecorder || isRecording || isStartingRecordingRef.current) {
      return false;
    }

    isStartingRecordingRef.current = true;
    setIsStartingRecording(true);
    setRecorderError('');
    resetRecording({ preserveRecordingPreview });

    try {
      if (shouldRecordFacecam) {
        await startFacecamRecording();
      }

      const constraints = {
        audio: selectedMicId
          ? { deviceId: { exact: selectedMicId }, echoCancellation: true, noiseSuppression: true }
          : { echoCancellation: true, noiseSuppression: true },
      };
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      mediaStreamRef.current = stream;
      stream.getAudioTracks().forEach((track) => {
        track.onended = () => {
          recorderStopReasonRef.current = 'microphone_track_ended';
          warnRecordSpeech('microphone track ended while recording', {
            label: track.label,
            readyState: track.readyState,
            muted: track.muted,
          });
        };
        track.onmute = () => {
          warnRecordSpeech('microphone track muted', {
            label: track.label,
            readyState: track.readyState,
          });
        };
      });
      refreshMicrophones().catch(() => {});

      const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
      const audioContext = new AudioContextCtor();
      const sourceNode = audioContext.createMediaStreamSource(stream);
      const gainNode = audioContext.createGain();
      const analyserNode = audioContext.createAnalyser();
      const destinationNode = audioContext.createMediaStreamDestination();
      gainNode.gain.value = Math.max(0, Number(micVolume) || 0) / 100;
      analyserNode.fftSize = 256;
      sourceNode.connect(gainNode);
      gainNode.connect(analyserNode);
      analyserNode.connect(destinationNode);

      audioContextRef.current = audioContext;
      gainNodeRef.current = gainNode;
      analyserRef.current = analyserNode;
      levelSamplesRef.current = new Uint8Array(analyserNode.fftSize);
      levelValueRef.current = 0;
      lastLevelUpdateRef.current = 0;

      const mimeType = getSupportedRecorderMimeType();
      const recorder = new MediaRecorder(
        destinationNode.stream,
        mimeType ? { mimeType } : undefined
      );
      mediaRecorderRef.current = recorder;
      recordedChunksRef.current = [];
      discardStoppedRecordingRef.current = false;
      recorderStopReasonRef.current = 'unexpected_stop';

      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          recordedChunksRef.current.push(event.data);
        }
      };

      recorder.onerror = (event) => {
        recorderStopReasonRef.current = 'recorder_error';
        warnRecordSpeech('media recorder error', {
          error: event?.error?.message || event?.message || String(event),
          state: recorder.state,
          mimeType: recorder.mimeType,
        });
      };

      recorder.onstop = async () => {
        const stopReason = recorderStopReasonRef.current;
        clearRecordingTimers();
        logRecordSpeechDebug('media recorder stopped', {
          reason: stopReason,
          chunks: recordedChunksRef.current.length,
          seconds: Math.floor((Date.now() - recordingStartedAtRef.current) / 1000),
          discarded: discardStoppedRecordingRef.current,
        });

        if (discardStoppedRecordingRef.current) {
          discardStoppedRecordingRef.current = false;
          recordedChunksRef.current = [];
          recorderStopReasonRef.current = 'idle';
          setIsRecording(false);
          stopRecorderStream();
          return;
        }

        const recordedMimeType = recorder.mimeType || mimeType || 'audio/webm';
        const blob = new Blob(recordedChunksRef.current, { type: recordedMimeType });
        const objectUrl = URL.createObjectURL(blob);
        setRecordingBlob(blob);
        setRecordingUrl(objectUrl);
        const duration = await resolveBlobDuration(objectUrl);
        setRecordingDuration(duration);
        setIsRecording(false);
        stopRecorderStream();
        recorderStopReasonRef.current = 'idle';
      };

      recorder.start();
      recordingStartedAtRef.current = Date.now();
      setRecordingSeconds(0);
      isRecordingRef.current = true;
      setIsRecording(true);
      if (typeof onStarted === 'function') {
        onStarted();
      }
      recordingTimerRef.current = window.setInterval(() => {
        setRecordingSeconds(Math.floor((Date.now() - recordingStartedAtRef.current) / 1000));
      }, 250);
      chunkFlushTimerRef.current = window.setInterval(() => {
        if (recorder.state !== 'recording' || typeof recorder.requestData !== 'function') {
          return;
        }

        try {
          recorder.requestData();
        } catch (error) {
          warnRecordSpeech('failed to flush recorder chunk', {
            error: error?.message || String(error),
            state: recorder.state,
          });
        }
      }, 1000);
      updateLevel();
      return true;
    } catch (error) {
      setRecorderError(error?.message || 'Unable to start microphone recording.');
      if (shouldRecordFacecam) {
        await stopFacecamRecording({ discard: true });
      }
      isRecordingRef.current = false;
      setIsRecording(false);
      clearRecordingTimers();
      stopRecorderStream();
      return false;
    } finally {
      isStartingRecordingRef.current = false;
      setIsStartingRecording(false);
    }
  };

  const stopRecording = ({ discard = false } = {}) => {
    if (!isRecording || !mediaRecorderRef.current) {
      return;
    }

    if (discard) {
      discardStoppedRecordingRef.current = true;
    }
    recorderStopReasonRef.current = discard ? 'discard' : 'user_stop';

    clearRecordingTimers();
    setRecordingSeconds(Math.max(1, Math.floor((Date.now() - recordingStartedAtRef.current) / 1000)));
    mediaRecorderRef.current.stop();
    stopFacecamRecording({ discard });
    isRecordingRef.current = false;
    if (isImmersiveActive || isImmersiveActiveRef.current) {
      exitImmersiveView();
    } else if (typeof setIsVideoPreviewPlaying === 'function') {
      setIsVideoPreviewPlaying(false);
    }
  };

  const togglePreviewPlayback = () => {
    if (!recordingUrl) {
      return;
    }

    if (!previewAudioRef.current) {
      previewAudioRef.current = new Audio(recordingUrl);
      previewAudioRef.current.onended = () => setIsPlayingPreview(false);
    } else if (previewAudioRef.current.src !== recordingUrl) {
      previewAudioRef.current.pause();
      previewAudioRef.current = new Audio(recordingUrl);
      previewAudioRef.current.onended = () => setIsPlayingPreview(false);
    }

    if (isPlayingPreview) {
      previewAudioRef.current.pause();
      setIsPlayingPreview(false);
      return;
    }

    previewAudioRef.current.currentTime = 0;
    previewAudioRef.current
      .play()
      .then(() => setIsPlayingPreview(true))
      .catch(() => setIsPlayingPreview(false));
  };

  const uploadRecording = async () => {
    if (!recordingBlob || !recordingUrl || !sessionDetails?._id) {
      return null;
    }

    if (uploadedLibraryItem) {
      return uploadedLibraryItem;
    }

    const headers = getHeaders();
    if (!headers) {
      setRecorderError('You must be logged in to save recorded speech.');
      return null;
    }

    setIsUploadPending(true);
    setRecorderError('');

    try {
      const dataURL = await readBlobAsDataUrl(recordingBlob);
      const extension = getRecordingExtension(recordingBlob.type);
      const response = await axios.post(`${PROCESSOR_API_URL}/video_sessions/upload_audio_library_item`, {
        sessionId: sessionDetails._id.toString(),
        dataURL,
        fileName: `recorded-speech.${extension}`,
        generationType: 'recorded_speech',
        libraryType: 'speech',
        title: 'Recorded speech',
        speakerCharacterName: 'Recorded speech',
        addTranscription: false,
        volume: Number(micVolume) || 100,
      }, headers);

      const uploadedItem = response?.data?.item || null;
      if (uploadedItem) {
        setUploadedLibraryItem(uploadedItem);
      }
      return uploadedItem;
    } catch (error) {
      setRecorderError(error?.response?.data?.error || 'Unable to save recorded speech.');
      return null;
    } finally {
      setIsUploadPending(false);
    }
  };

  const handleAddToLibrary = async () => {
    const uploadedItem = await uploadRecording();
    if (!uploadedItem) {
      return;
    }

    if (shouldRecordFacecam && (facecamBlob || facecamStopPromiseRef.current)) {
      const globalVideo = await uploadFacecamRecording();
      if (!globalVideo) {
        return;
      }
    }

    toast.success('Recorded speech added to library.', {
      position: 'bottom-center',
      className: 'custom-toast',
    });
  };

  const uploadFacecamRecording = async () => {
    if (!shouldRecordFacecam || !sessionDetails?._id) {
      return null;
    }

    const stoppedFacecamBlob = facecamStopPromiseRef.current
      ? await facecamStopPromiseRef.current.catch(() => null)
      : null;
    const activeFacecamBlob = facecamBlob || stoppedFacecamBlob;

    if (!activeFacecamBlob) {
      return null;
    }

    const headers = getHeaders();
    if (!headers?.headers) {
      setRecorderError('You must be logged in to save recorded facecam.');
      return null;
    }

    setIsUploadPending(true);
    setFacecamError('');

    try {
      if (uploadedGlobalVideo) {
        if (!shouldPollGlobalVideoProcessing({}, uploadedGlobalVideo)) {
          return uploadedGlobalVideo;
        }

        const completedGlobalVideo = await pollGlobalVideoProcessing({
          sessionId: sessionDetails._id.toString(),
          globalVideo: uploadedGlobalVideo,
          headers,
        });
        setUploadedGlobalVideo(completedGlobalVideo);
        return completedGlobalVideo;
      }

      const startTime = Number.isFinite(Number(recordingStartTimeRef.current))
        ? Number(recordingStartTimeRef.current)
        : currentLayerStartTime;
      const recordedFacecamDuration = Number(facecamDurationRef.current ?? facecamDuration);
      const duration = Number.isFinite(recordedFacecamDuration) && recordedFacecamDuration > 0
        ? recordedFacecamDuration
        : resolvedRecordingDuration || 1;
      const extension = getVideoRecordingExtension(activeFacecamBlob.type);
      const response = await axios.post(
        `${PROCESSOR_API_URL}/video_sessions/upload_global_video`,
        activeFacecamBlob,
        {
          headers: {
            ...headers.headers,
            'Content-Type': activeFacecamBlob.type || 'video/webm',
          },
          params: {
            sessionId: sessionDetails._id.toString(),
            fileName: `recorded-facecam.${extension}`,
            startTime,
            duration,
            framesPerSecond: facecamFramesPerSecond,
            shapeOverlay: facecamShapeOverlay,
            title: 'Recorded facecam',
          },
        }
      );
      let globalVideo = response?.data?.globalVideo || null;
      if (globalVideo) {
        setUploadedGlobalVideo(globalVideo);
      }
      if (globalVideo && shouldPollGlobalVideoProcessing(response?.data, globalVideo)) {
        globalVideo = await pollGlobalVideoProcessing({
          sessionId: sessionDetails._id.toString(),
          globalVideo,
          headers,
        });
      }
      if (globalVideo) {
        setUploadedGlobalVideo(globalVideo);
      }
      return globalVideo;
    } catch (error) {
      const statusCode = error?.response?.status;
      const serverError = error?.response?.data?.error || error?.response?.data?.message;
      setFacecamError(
        (statusCode === 504 ? 'Facecam processing timed out. Please try again.' : '')
        || serverError
        || error?.message
        || 'Unable to save recorded facecam.'
      );
      return null;
    } finally {
      setIsUploadPending(false);
    }
  };

  const handleAddToSession = async () => {
    if (typeof requestAddAudioLayerFromLibrary !== 'function') {
      setRecorderError('Unable to add recorded speech to this session.');
      return;
    }

    const uploadedItem = await uploadRecording();
    if (!uploadedItem) {
      return;
    }

    if (shouldRecordFacecam && (facecamBlob || facecamStopPromiseRef.current)) {
      const globalVideo = await uploadFacecamRecording();
      if (!globalVideo) {
        return;
      }
    }

    const addRecordedAudioLayer = typeof requestAddGlobalAudioLayerFromLibrary === 'function'
      ? requestAddGlobalAudioLayerFromLibrary
      : requestAddAudioLayerFromLibrary;
    const uploadedDuration = Number(uploadedItem.duration);
    const recordedDuration = Number(resolvedRecordingDuration);
    const sessionRecordingDuration = Number.isFinite(uploadedDuration) && uploadedDuration > 0
      ? uploadedDuration
      : Number.isFinite(recordedDuration) && recordedDuration > 0
        ? recordedDuration
        : 1;

    await addRecordedAudioLayer(uploadedItem, {
      startTime: Number.isFinite(Number(recordingStartTimeRef.current))
        ? Number(recordingStartTimeRef.current)
        : currentLayerStartTime,
      duration: sessionRecordingDuration,
      recordedDuration: sessionRecordingDuration,
      volume: Number(micVolume) || 100,
      addSubtitles: false,
      audioBindingMode: 'unbounded',
      bindToLayer: false,
      studioSpeechGeneration: true,
    });
    setHasAddedToSession(true);
  };

  const deleteUploadedRecording = async () => {
    if (!uploadedLibraryItem || !sessionDetails?._id) {
      return;
    }

    const headers = getHeaders();
    if (!headers) {
      return;
    }

    await axios.post(`${PROCESSOR_API_URL}/video_sessions/delete_audio_library_item`, {
      sessionId: sessionDetails._id.toString(),
      audioItem: uploadedLibraryItem,
      deleteAsset: !hasAddedToSession,
    }, headers).catch(() => {});
  };

  const handleDeleteRecording = async () => {
    if (isRecording) {
      stopRecording({ discard: true });
    }
    await deleteUploadedRecording();
    resetRecording();
  };

  const resolveCurrentSeekFrame = () => {
    const currentSeekFrame = Number(currentLayerSeekRef.current);
    if (Number.isFinite(currentSeekFrame)) {
      return Math.max(0, Math.round(currentSeekFrame));
    }

    return Math.max(0, Math.round(currentLayerStartTime * DISPLAY_FRAMES_PER_SECOND));
  };

  const startNormalVideoPlayback = () => {
    if (typeof setIsVideoPreviewPlaying !== 'function') {
      return;
    }

    setIsVideoPreviewPlaying(true);
  };

  const startSessionPreviewFromCurrentSeek = () => {
    const startFrame = resolveCurrentSeekFrame();
    currentLayerSeekRef.current = startFrame;
    recordingStartTimeRef.current = currentLayerStartTime;
    setRecordingPreviewStartSeconds(startFrame / DISPLAY_FRAMES_PER_SECOND);
    setIsRecordingPreviewActive(true);
    if (typeof setCurrentLayerSeek === 'function') {
      setCurrentLayerSeek(startFrame);
    }
    startNormalVideoPlayback();
  };

  const handleStartRecordingWithPreview = async () => {
    if (typeof onRecordSpeechRecordingChange === 'function') {
      onRecordSpeechRecordingChange(true);
    }
    if (hintsEnabled && speechHintCues.length > 0) {
      await enterImmersiveView();
    }
    startSessionPreviewFromCurrentSeek();
    const didStartRecording = await startRecording({ preserveRecordingPreview: true }).catch(() => false);
    if (!didStartRecording) {
      if (isImmersiveActiveRef.current) {
        exitImmersiveView();
      } else {
        setRecordingPreviewStartSeconds(null);
        setIsRecordingPreviewActive(false);
        if (typeof setIsVideoPreviewPlaying === 'function') {
          setIsVideoPreviewPlaying(false);
        }
      }
    }
  };

  const handleStartRecordingClick = () => {
    handleStartRecordingWithPreview();
  };

  const requestImmersiveFullscreen = async () => {
    if (typeof document === 'undefined' || document.fullscreenElement) {
      return;
    }

    await document.documentElement.requestFullscreen?.().catch(() => {});
  };

  const enterImmersiveView = async () => {
    if (isImmersiveActiveRef.current) {
      return;
    }
    if (typeof setIsVideoPreviewPlaying === 'function') {
      setIsVideoPreviewPlaying(false);
    }
    isImmersiveActiveRef.current = true;
    setIsImmersiveActive(true);
    await requestImmersiveFullscreen();
  };

  const exitImmersiveView = () => {
    setIsRecordingPreviewActive(false);
    if (typeof setIsVideoPreviewPlaying === 'function') {
      setIsVideoPreviewPlaying(false);
    }
    isImmersiveActiveRef.current = false;
    setIsImmersiveActive(false);

    if (typeof document !== 'undefined' && document.fullscreenElement) {
      document.exitFullscreen?.().catch(() => {});
    }
  };

  useEffect(() => {
    if (typeof document === 'undefined') {
      return undefined;
    }

    const handleFullscreenChange = () => {
      logRecordSpeechDebug('fullscreen state changed', {
        isImmersiveActive,
        hasFullscreenElement: Boolean(document.fullscreenElement),
        isRecording: isRecordingRef.current,
      });
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
    };
  }, [isImmersiveActive]);

  useEffect(() => {
    if (!hintsEnabled || speechHintCues.length === 0) {
      return;
    }

    const debugBucket = Math.floor(hintTimelineTime);
    const cueKey = activeTranscriptCue
      ? `${activeTranscriptCue.startTime}-${activeTranscriptCue.endTime}-${activeTranscriptCue.text}`
      : '';
    const shouldLog = activeTranscriptCue
      ? cueKey !== lastTranscriptDebugCueRef.current
      : debugBucket !== lastTranscriptDebugBucketRef.current;

    if (!shouldLog) {
      return;
    }

    lastTranscriptDebugBucketRef.current = debugBucket;
    lastTranscriptDebugCueRef.current = cueKey;
    logRecordSpeechDebug('hint cue lookup', {
      currentPreviewTime,
      hintTimelineTime,
      currentLayerStartTime,
      isRecording,
      isRecordingPreviewActive,
      isVideoPreviewPlaying,
      recordingPreviewStartSeconds,
      cueCount: speechHintCues.length,
      progressWindow: hintProgressWindow,
      matchedCue: activeTranscriptCue,
    });
    if (activeTranscriptCue) {
      logRecordSpeechDebug('helper hint overlay active', {
        text: activeTranscriptCue.text,
        startTime: activeTranscriptCue.startTime,
        endTime: activeTranscriptCue.endTime,
      });
    }
  }, [
    activeTranscriptCue,
    currentLayerStartTime,
    currentPreviewTime,
    hintProgressWindow,
    hintTimelineTime,
    hintsEnabled,
    isRecording,
    isRecordingPreviewActive,
    isVideoPreviewPlaying,
    recordingPreviewStartSeconds,
    speechHintCues.length,
  ]);

  const iconButtonBaseClass = 'inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border text-xs shadow-sm transition disabled:cursor-not-allowed disabled:opacity-50';
  const recordPrimaryButtonClass = 'inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-blue-500 bg-blue-600 text-sm text-white shadow-sm transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50';
  const recordAudioVideoButtonClass = colorMode === 'dark'
    ? 'inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-red-400/70 bg-red-500/12 text-sm text-red-300 shadow-sm transition hover:bg-red-500/20 disabled:cursor-not-allowed disabled:opacity-50'
    : 'inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-red-500/70 bg-white text-sm text-red-600 shadow-sm transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50';
  const stopSquareButtonClass = 'inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-red-500/70 bg-red-600 text-sm text-white shadow-sm transition hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-50';
  const hintsIconButtonClass = `inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border text-xs shadow-sm transition disabled:cursor-not-allowed disabled:opacity-50 ${
    hintsEnabled
      ? 'border-amber-400 bg-amber-500 text-slate-950 hover:bg-amber-400'
      : colorMode === 'dark'
        ? 'border-[#273956] bg-[#111a2f] text-slate-100 hover:bg-[#172642]'
        : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
  }`;
  const secondaryIconButtonClass = colorMode === 'dark'
    ? `${iconButtonBaseClass} border-[#273956] bg-[#111a2f] text-slate-100 hover:bg-[#172642]`
    : `${iconButtonBaseClass} border-slate-200 bg-white text-slate-700 hover:bg-slate-50`;
  const resultIconButtonBaseClass = 'inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-[11px] shadow-sm transition disabled:cursor-not-allowed disabled:opacity-50';
  const resultPrimaryIconButtonClass = `${resultIconButtonBaseClass} border-blue-500 bg-blue-600 text-white hover:bg-blue-500`;
  const resultSecondaryIconButtonClass = colorMode === 'dark'
    ? `${resultIconButtonBaseClass} border-[#273956] bg-[#111a2f] text-slate-100 hover:bg-[#172642]`
    : `${resultIconButtonBaseClass} border-slate-200 bg-white text-slate-700 hover:bg-slate-50`;
  const resultDangerIconButtonClass = `${resultIconButtonBaseClass} border-red-500/60 bg-red-600 text-white hover:bg-red-500`;
  const modeButtonBaseClass = 'inline-flex min-h-10 flex-1 items-center justify-center gap-2 rounded-lg border px-3 py-2 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-60';
  const selectedModeButtonClass = colorMode === 'dark'
    ? `${modeButtonBaseClass} border-blue-400/50 bg-blue-500/20 text-blue-100`
    : `${modeButtonBaseClass} border-blue-500 bg-blue-50 text-blue-700`;
  const unselectedModeButtonClass = colorMode === 'dark'
    ? `${modeButtonBaseClass} border-[#273956] bg-[#111a2f] text-slate-200 hover:bg-[#172642]`
    : `${modeButtonBaseClass} border-slate-200 bg-white text-slate-700 hover:bg-slate-50`;
  const avatarTextButtonBaseClass = 'inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border px-3 py-2 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-50';
  const avatarPrimaryButtonClass = `${avatarTextButtonBaseClass} border-blue-500 bg-blue-600 text-white hover:bg-blue-500`;
  const avatarSecondaryButtonClass = colorMode === 'dark'
    ? `${avatarTextButtonBaseClass} border-[#273956] bg-[#111a2f] text-slate-100 hover:bg-[#172642]`
    : `${avatarTextButtonBaseClass} border-slate-200 bg-white text-slate-700 hover:bg-slate-50`;
  const avatarDangerButtonClass = `${avatarTextButtonBaseClass} border-red-500/60 bg-red-600 text-white hover:bg-red-500`;
  const avatarThumbnailButtonClass = colorMode === 'dark'
    ? 'relative aspect-square overflow-hidden rounded-lg border border-[#273956] bg-[#111a2f] transition disabled:cursor-not-allowed disabled:opacity-50'
    : 'relative aspect-square overflow-hidden rounded-lg border border-slate-200 bg-white transition disabled:cursor-not-allowed disabled:opacity-50';
  const avatarThumbnailSelectedClass = colorMode === 'dark'
    ? 'ring-2 ring-blue-300 ring-offset-2 ring-offset-[#0b1224]'
    : 'ring-2 ring-blue-500 ring-offset-2 ring-offset-slate-50';
  const recordButtonLabel = shouldRecordFacecam ? 'Record audio and video' : 'Record audio';
  const stopButtonLabel = 'Stop recording';
  const teleprompterCue = activeTranscriptCue;
  const teleprompterCueText = teleprompterCue?.text || 'Hints are ready';
  const nextHintTimeLabel = hintProgressWindow ? formatRecordingTime(hintProgressWindow.remainingSeconds) : '--:--';
  const handleHintsToggleClick = () => {
    const nextHintsEnabled = !hintsEnabled;
    setHintsEnabled(nextHintsEnabled);
    if (nextHintsEnabled && isRecordingRef.current && speechHintCues.length > 0) {
      enterImmersiveView().catch(() => {});
    } else if (!nextHintsEnabled && isImmersiveActiveRef.current) {
      exitImmersiveView();
    }
  };
  const handleFacecamVoiceoverModeChange = (nextMode) => {
    if (isRecording || isStartingRecording || facecamVoiceoverMode === nextMode) {
      return;
    }

    if (isPlayingPreview && previewAudioRef.current) {
      previewAudioRef.current.pause();
      previewAudioRef.current.currentTime = 0;
      setIsPlayingPreview(false);
    }

    setFacecamVoiceoverMode(nextMode);
  };
  const helperTranscriptOverlay = isImmersiveActive && hintsEnabled && (teleprompterCue || hintProgressWindow) ? (
    <div className="pointer-events-none fixed inset-0 z-[10000]">
      <div
        className="absolute left-1/2 w-[min(94vw,1120px)] -translate-x-1/2 text-center"
        style={{ top: 'max(14px, 4vh)' }}
      >
        <div className="overflow-hidden rounded-2xl border border-white/15 bg-black/80 px-4 py-4 text-white shadow-2xl backdrop-blur-md sm:px-7 sm:py-5">
          {hintProgressWindow && (
            <div className="mb-4">
              <div className="h-1.5 overflow-hidden rounded-full bg-white/15" aria-label="Progress until next hint">
                <div
                  className="h-full rounded-full bg-amber-300"
                  style={{ width: `${hintProgressWindow.progressPercent}%` }}
                />
              </div>
            </div>
          )}

          <div
            className="mx-auto max-h-[36vh] max-w-[980px] overflow-hidden px-2 font-semibold leading-tight"
            style={{ fontSize: 'clamp(1.8rem, 4vw, 3.6rem)' }}
          >
            {teleprompterCueText}
          </div>

          <div className="mt-4 flex items-end justify-between gap-4 text-left text-xs font-semibold uppercase text-white/65">
            <div>
              <div className="text-[10px] tracking-wide text-white/45">Next text</div>
              <div className="text-lg text-amber-100 tabular-nums">{nextHintTimeLabel}</div>
            </div>
            <div className="text-right">
              <div className="text-[10px] tracking-wide text-white/45">Global</div>
              <div className="text-xs tabular-nums text-white/75">
                {formatRecordingTime(hintTimelineTime)} · {formatRecordingTime(globalRemainingSeconds)} left
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  ) : null;
  const facecamUploadComplete = Boolean(uploadedGlobalVideo)
    && !shouldPollGlobalVideoProcessing({}, uploadedGlobalVideo);
  const libraryActionComplete = Boolean(uploadedLibraryItem)
    && (!shouldRecordFacecam || facecamUploadComplete);
  const isAvatarVoiceoverMode = facecamVoiceoverMode === 'avatar_voiceover';
  const isRecordingFacecamMode = facecamVoiceoverMode === 'recording_facecam';

  return (
    <>
    <section className={`mb-4 rounded-xl border ${borderColor} ${panelBg} p-3`}>
      <div className="grid gap-3">
        {isCollapsedSidebarView ? (
          <label className="block">
            <span className={`mb-1 block text-xs font-semibold ${mutedText}`}>Mode</span>
            <select
              value={facecamVoiceoverMode}
              onChange={(event) => handleFacecamVoiceoverModeChange(event.target.value)}
              disabled={isRecording || isStartingRecording}
              className={`w-full rounded-lg ${bgColor} ${text2Color} px-2 py-2 text-xs font-semibold`}
              aria-label="Facecam and voiceover mode"
            >
              <option value="avatar_voiceover">Voiceover with avatar</option>
              <option value="recording_facecam">Recording with facecam</option>
            </select>
          </label>
        ) : (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2" role="tablist" aria-label="Facecam and voiceover mode">
            <button
              type="button"
              role="tab"
              aria-selected={facecamVoiceoverMode === 'avatar_voiceover'}
              onClick={() => handleFacecamVoiceoverModeChange('avatar_voiceover')}
              disabled={isRecording || isStartingRecording}
              className={facecamVoiceoverMode === 'avatar_voiceover' ? selectedModeButtonClass : unselectedModeButtonClass}
            >
              <FaUserCircle aria-hidden="true" />
              <span>Voiceover with avatar</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={isRecordingFacecamMode}
              onClick={() => handleFacecamVoiceoverModeChange('recording_facecam')}
              disabled={isRecording || isStartingRecording}
              className={isRecordingFacecamMode ? selectedModeButtonClass : unselectedModeButtonClass}
            >
              <FaVideo aria-hidden="true" />
              <span>Recording with facecam</span>
            </button>
          </div>
        )}

        {isAvatarVoiceoverMode && (
          <>
            <div className="grid gap-2">
              <label className="block">
                <span className={`mb-1 block text-xs font-semibold ${mutedText}`}>Avatar prompt</span>
                <textarea
                  value={avatarPrompt}
                  onChange={(event) => setAvatarPrompt(event.target.value)}
                  rows={3}
                  className={`w-full resize-none rounded-lg ${bgColor} ${text2Color} px-3 py-2 text-sm`}
                  placeholder="Professional presenter with warm studio lighting"
                />
              </label>
              <label className="block">
                <span className={`mb-1 block text-xs font-semibold ${mutedText}`}>Avatar image model</span>
                <select
                  value={selectedAvatarImageModel}
                  onChange={(event) => setSelectedAvatarImageModel(event.target.value)}
                  disabled={isAvatarImageGenerating || avatarAnyActionPending}
                  className={`w-full rounded-lg ${bgColor} ${text2Color} px-3 py-2 text-sm`}
                >
                  {AVATAR_IMAGE_MODEL_OPTIONS.map((model) => (
                    <option key={model.value} value={model.value}>{model.label}</option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                onClick={handleGenerateAvatarImage}
                disabled={isAvatarImageGenerating || !avatarPrompt.trim() || !selectedAvatarImageModel || avatarAnyActionPending}
                className={`${avatarPrimaryButtonClass} w-full`}
              >
                {isAvatarImageGenerating ? <FaSyncAlt className="animate-spin" aria-hidden="true" /> : <FaImage aria-hidden="true" />}
                <span>{generatedAvatarTasks.length ? 'Generate another avatar image' : 'Generate avatar image'}</span>
              </button>
            </div>

            {isAvatarTasksLoading && (
              <div className={`rounded-lg border ${borderColor} px-3 py-2 text-xs ${mutedText}`}>
                Loading avatar voiceovers.
              </div>
            )}

            {selectedAvatarImagePending && (
              <div className={`flex items-center gap-2 rounded-lg border ${borderColor} px-3 py-2 text-xs ${mutedText}`}>
                <FaSyncAlt className="shrink-0 animate-spin" aria-hidden="true" />
                <span>Generating avatar image.</span>
              </div>
            )}

            {generatedAvatarTasks.length > 0 && (
              <div className="grid gap-2">
                <div className={`text-xs font-semibold ${mutedText}`}>Generated avatars</div>
                <div className="grid grid-cols-3 gap-2">
                  {generatedAvatarTasks.map((task) => {
                    const taskId = getAvatarTaskId(task);
                    const imageUrl = normalizeProcessorAssetUrl(task.avatarImageUrl || task.avatarImage);
                    const isSelectedTask = taskId === selectedAvatarTaskIdValue;
                    return (
                      <button
                        key={taskId}
                        type="button"
                        onClick={() => setSelectedAvatarTaskId(taskId)}
                        className={`${avatarThumbnailButtonClass} ${isSelectedTask ? avatarThumbnailSelectedClass : ''}`}
                        title={getAvatarTaskStatusLabel(task)}
                        aria-label={`Select avatar image: ${getAvatarTaskStatusLabel(task)}`}
                      >
                        <AvatarImage
                          src={imageUrl}
                          className="h-full w-full object-cover"
                          onUnavailable={() => markAvatarImageUnavailable(task)}
                        />
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {selectedAvatarTask && (selectedAvatarImagePending || (selectedAvatarImageUrl && !selectedAvatarImageUnavailable)) && (
              <div className={`overflow-hidden rounded-lg border ${borderColor}`}>
                <div className={`flex items-center justify-between gap-2 px-3 py-2 text-xs ${mutedText}`}>
                  <span className="inline-flex min-w-0 items-center gap-2 truncate">
                    <FaUserCircle className="shrink-0" aria-hidden="true" />
                    <span className="truncate">Avatar preview</span>
                  </span>
                  <span className="shrink-0">{selectedAvatarStatusLabel}</span>
                </div>
                {selectedAvatarImageUrl ? (
                  <AvatarImage
                    src={selectedAvatarImageUrl}
                    className="aspect-square w-full bg-black object-cover"
                    onUnavailable={() => markAvatarImageUnavailable(selectedAvatarTask)}
                  />
                ) : (
                  <div className={`flex aspect-square w-full flex-col items-center justify-center gap-3 ${bgColor} ${mutedText}`}>
                    {selectedAvatarImagePending ? (
                      <FaSyncAlt className="text-2xl animate-spin" aria-hidden="true" />
                    ) : (
                      <FaUserCircle className="text-4xl" aria-hidden="true" />
                    )}
                    <span className="px-4 text-center text-xs font-semibold">
                      {selectedAvatarImagePending ? 'Generating image' : 'No image yet'}
                    </span>
                  </div>
                )}
              </div>
            )}

            {avatarImageReady && (
              <div className="grid gap-2">
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2" role="tablist" aria-label="Avatar audio source">
                  {AVATAR_VIDEO_AUDIO_SOURCE_OPTIONS.map((audioSourceOption) => {
                    const isSelectedAudioSource = avatarVideoAudioSource === audioSourceOption.value;
                    const Icon = audioSourceOption.value === AVATAR_VIDEO_AUDIO_SOURCE_SESSION_SPEECH
                      ? FaMicrophone
                      : FaLightbulb;
                    return (
                      <button
                        key={audioSourceOption.value}
                        type="button"
                        role="tab"
                        aria-selected={isSelectedAudioSource}
                        onClick={() => setAvatarVideoAudioSource(audioSourceOption.value)}
                        disabled={avatarAnyActionPending || avatarTaskBusy}
                        className={isSelectedAudioSource ? selectedModeButtonClass : unselectedModeButtonClass}
                      >
                        <Icon aria-hidden="true" />
                        <span>{audioSourceOption.label}</span>
                      </button>
                    );
                  })}
                </div>

                {usesSessionSpeechForAvatarVideo && generatedSpeechAudioSummary.hasAudio && (
                  <div className={`rounded-lg border ${borderColor} px-3 py-2 text-xs ${mutedText}`}>
                    Using {generatedSpeechAudioSummary.count} generated speech layer{generatedSpeechAudioSummary.count === 1 ? '' : 's'} for lip sync.
                  </div>
                )}

                {usesHintSpeechForAvatarVideo && (
                  speechHintCues.length === 0 ? (
                    <button
                      type="button"
                      onClick={onSetAvatarHints}
                      disabled={typeof onSetAvatarHints !== 'function'}
                      className={`${avatarSecondaryButtonClass} w-full`}
                    >
                      <FaLightbulb aria-hidden="true" />
                      <span>Set hints</span>
                    </button>
                  ) : (
                    <>
                      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                        <label className="block">
                          <span className={`mb-1 block text-xs font-semibold ${mutedText}`}>Speech provider</span>
                          <select
                            value={selectedAvatarSpeechProvider}
                            onChange={(event) => handleAvatarSpeechProviderChange(event.target.value)}
                            disabled={avatarAnyActionPending || avatarTaskBusy || avatarSpeechProviderOptions.length === 0}
                            className={`w-full rounded-lg ${bgColor} ${text2Color} px-3 py-2 text-sm`}
                          >
                            {avatarSpeechProviderOptions.map((providerOption) => (
                              <option key={providerOption.value} value={providerOption.value}>
                                {providerOption.label}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="block">
                          <span className={`mb-1 block text-xs font-semibold ${mutedText}`}>Speaker</span>
                          <select
                            value={selectedAvatarSpeechSpeaker}
                            onChange={(event) => handleAvatarSpeechSpeakerChange(event.target.value)}
                            disabled={avatarAnyActionPending || avatarTaskBusy || avatarSpeechSpeakerOptions.length === 0}
                            className={`w-full rounded-lg ${bgColor} ${text2Color} px-3 py-2 text-sm`}
                          >
                            {avatarSpeechSpeakerOptions.map((speakerOption) => (
                              <option key={`${speakerOption.provider}:${speakerOption.value}`} value={speakerOption.value}>
                                {speakerOption.label || speakerOption.name || speakerOption.value}
                              </option>
                            ))}
                          </select>
                        </label>
                      </div>
                      <button
                        type="button"
                        onClick={handleGenerateAvatarSpeechFromHints}
                        disabled={isAvatarSpeechGenerating || avatarTaskBusy || !selectedAvatarSpeechSpeakerOption}
                        className={`${avatarSecondaryButtonClass} w-full`}
                      >
                        {isAvatarSpeechGenerating || ['INIT', 'PENDING', 'PROCESSING'].includes(selectedAvatarSpeechStatus)
                          ? <FaSyncAlt className="animate-spin" aria-hidden="true" />
                          : <FaMicrophone aria-hidden="true" />}
                        <span>{avatarSpeechReady ? 'Generate speech again' : 'Generate speech from hints'}</span>
                      </button>
                      {selectedAvatarSpeechAudioUrl && (
                        <div className={`overflow-hidden rounded-lg border ${borderColor}`}>
                          <div className={`flex items-center justify-between gap-2 px-3 py-2 text-xs ${mutedText}`}>
                            <span className="inline-flex min-w-0 items-center gap-2 truncate">
                              <FaMicrophone className="shrink-0" aria-hidden="true" />
                              <span className="truncate">Speech preview</span>
                            </span>
                            <span className="shrink-0">{selectedAvatarTask?.speechSpeakerName || selectedAvatarSpeechSpeakerLabel}</span>
                          </div>
                          <audio
                            src={selectedAvatarSpeechAudioUrl}
                            controls
                            className="w-full px-3 pb-3"
                          />
                        </div>
                      )}
                    </>
                  )
                )}

                {(usesSessionSpeechForAvatarVideo || speechHintCues.length > 0) && (
                  <>
                    <div className={`flex items-center justify-between gap-3 rounded-lg border ${borderColor} px-3 py-2 text-xs ${mutedText}`}>
                      <span>Avatar video cost</span>
                      <span className={`inline-flex items-center gap-1 font-semibold ${text2Color}`}>
                        {avatarVideoCreditEstimate.creditsToCharge} credits
                        <span
                          className="inline-flex cursor-help items-center"
                          data-tooltip-id="avatarVideoCostTooltip"
                          data-tooltip-content={avatarVideoCostTooltip}
                          aria-label="Avatar video credit calculation"
                        >
                          <FaQuestionCircle className="text-[11px]" aria-hidden="true" />
                        </span>
                      </span>
                      <Tooltip id="avatarVideoCostTooltip" place="top" effect="solid" />
                    </div>
                    <button
                      type="button"
                      onClick={handleGenerateAvatarVideoFromHints}
                      disabled={isAvatarVideoGenerating || isRunwayAvatarCreating || avatarTaskBusy || !avatarVideoAudioReady}
                      className={`${avatarPrimaryButtonClass} w-full`}
                    >
                      {isAvatarVideoGenerating || isRunwayAvatarCreating || (!runwayAvatarReady && avatarGenerationStarted)
                        ? <FaSyncAlt className="animate-spin" aria-hidden="true" />
                        : <FaVideo aria-hidden="true" />}
                      <span>{avatarVideoActionLabel}</span>
                    </button>
                  </>
                )}

                {avatarVideoDisabledReason && (usesSessionSpeechForAvatarVideo || speechHintCues.length > 0) && (
                  <div className={`rounded-lg border ${borderColor} px-3 py-2 text-xs ${mutedText}`}>
                    {avatarVideoDisabledReason}
                  </div>
                )}
              </div>
            )}

            {(isUserRunwayAvatarsLoading || reusableRunwayAvatars.length > 0) && (
              <div className="grid gap-2">
                <div className={`text-xs font-semibold ${mutedText}`}>Previously generated RunwayML avatars</div>
                {isUserRunwayAvatarsLoading ? (
                  <div className={`flex items-center gap-2 rounded-lg border ${borderColor} px-3 py-2 text-xs ${mutedText}`}>
                    <FaSyncAlt className="shrink-0 animate-spin" aria-hidden="true" />
                    <span>Loading saved avatars.</span>
                  </div>
                ) : (
                  <div className="grid grid-cols-3 gap-2">
                    {reusableRunwayAvatars.map((task) => {
                      const taskId = getAvatarTaskId(task);
                      const imageUrl = normalizeProcessorAssetUrl(task.avatarImageUrl || task.avatarImage);
                      const label = task.avatarName || task.voicePresetName || task.runwayAvatarId || 'RunwayML avatar';
                      return (
                        <button
                          key={`${task.runwayAvatarId || taskId}-reusable`}
                          type="button"
                          onClick={() => handleSelectUserRunwayAvatar(task)}
                          disabled={avatarAnyActionPending || isUserRunwayAvatarSelecting}
                          className={avatarThumbnailButtonClass}
                          title={`Use ${label}`}
                          aria-label={`Use previously generated avatar: ${label}`}
                        >
                          <AvatarImage
                            src={imageUrl}
                            className="h-full w-full object-cover"
                            onUnavailable={() => markAvatarImageUnavailable(task)}
                          />
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {selectedAvatarVideoUrl && (
              <div className={`overflow-hidden rounded-lg border ${borderColor}`}>
                <div className={`flex items-center justify-between gap-2 px-3 py-2 text-xs ${mutedText}`}>
                  <span className="inline-flex min-w-0 items-center gap-2 truncate">
                    <FaVideo className="shrink-0" aria-hidden="true" />
                    <span className="truncate">Avatar video</span>
                  </span>
                  <span className="shrink-0">{selectedAvatarStatusLabel}</span>
                </div>
                <video
                  src={selectedAvatarVideoUrl}
                  controls
                  playsInline
                  className="aspect-video w-full bg-black object-cover"
                />
              </div>
            )}

            {avatarVideoReady && !avatarVideoTerminal && (
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                <button
                  type="button"
                  onClick={handleAcceptAvatarVideo}
                  disabled={isAvatarVideoAccepting || (selectedAvatarStatus === 'ACCEPTED' && !acceptedAvatarVideoNeedsRepair)}
                  className={`${avatarPrimaryButtonClass} w-full`}
                >
                  {isAvatarVideoAccepting ? <FaSyncAlt className="animate-spin" aria-hidden="true" /> : <FaCheck aria-hidden="true" />}
                  <span>{acceptedAvatarVideoNeedsRepair ? 'Retry accept' : 'Accept'}</span>
                </button>
                <button
                  type="button"
                  onClick={handleSaveAvatarVideoToLibrary}
                  disabled={isAvatarVideoSaving || Boolean(selectedAvatarTask?.savedLibraryItemId)}
                  className={`${avatarSecondaryButtonClass} w-full`}
                >
                  {isAvatarVideoSaving ? <FaSyncAlt className="animate-spin" aria-hidden="true" /> : <FaSave aria-hidden="true" />}
                  <span>Save</span>
                </button>
                <button
                  type="button"
                  onClick={handleRejectAvatarVideo}
                  disabled={isAvatarRejecting || selectedAvatarStatus === 'ACCEPTED'}
                  className={`${avatarDangerButtonClass} w-full`}
                >
                  {isAvatarRejecting ? <FaSyncAlt className="animate-spin" aria-hidden="true" /> : <FaTrash aria-hidden="true" />}
                  <span>Reject</span>
                </button>
              </div>
            )}

            {(avatarError || selectedAvatarTaskError) && (
              <div className="rounded-lg border border-red-400/40 bg-red-500/10 px-3 py-2 text-xs text-red-400">
                {avatarError || selectedAvatarTaskError}
              </div>
            )}
          </>
        )}

        {isRecordingFacecamMode && (
          <>
            <label className="block">
              <span className={`mb-1 block text-xs font-semibold ${mutedText}`}>Microphone</span>
              <select
                value={selectedMicId}
                onChange={(event) => setSelectedMicId(event.target.value)}
                disabled={isRecording || microphones.length === 0}
                className={`w-full rounded-lg ${bgColor} ${text2Color} px-3 py-2 text-sm`}
              >
                {microphones.length === 0 ? (
                  <option value="">Default microphone</option>
                ) : microphones.map((device, index) => (
                  <option key={device.deviceId || index} value={device.deviceId}>
                    {device.label || `Microphone ${index + 1}`}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className={`mb-1 block text-xs font-semibold ${mutedText}`}>Record</span>
              <select
                value={normalizedRecordMode}
                onChange={(event) => setRecordMode(event.target.value)}
                disabled={isRecording || isStartingRecording}
                className={`w-full rounded-lg ${bgColor} ${text2Color} px-3 py-2 text-sm`}
              >
                <option value="audio">Audio</option>
                <option value="audio_video">Audio & Video</option>
              </select>
            </label>

            {shouldRecordFacecam && (
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <label className="block">
                  <span className={`mb-1 block text-xs font-semibold ${mutedText}`}>Camera</span>
                  <select
                    value={selectedCameraId}
                    onChange={(event) => setSelectedCameraId(event.target.value)}
                    disabled={isRecording || cameraDevices.length === 0}
                    className={`w-full rounded-lg ${bgColor} ${text2Color} px-3 py-2 text-sm`}
                  >
                    {cameraDevices.length === 0 ? (
                      <option value="">Default camera</option>
                    ) : cameraDevices.map((device, index) => (
                      <option key={device.deviceId || index} value={device.deviceId}>
                        {device.label || `Camera ${index + 1}`}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="block">
                  <span className={`mb-1 block text-xs font-semibold ${mutedText}`}>Shape</span>
                  <select
                    value={facecamShapeOverlay}
                    onChange={(event) => setFacecamShapeOverlay(event.target.value)}
                    disabled={isRecording}
                    className={`w-full rounded-lg ${bgColor} ${text2Color} px-3 py-2 text-sm`}
                  >
                    <option value="circle">Circle</option>
                    <option value="oval">Oval</option>
                    <option value="rectangle">Rectangle</option>
                    <option value="rounded_rectangle">Rounded rectangle</option>
                  </select>
                </label>
              </div>
            )}

            <label className="block">
              <span className={`mb-1 flex items-center justify-between text-xs font-semibold ${mutedText}`}>
                <span>Volume</span>
                <span>{micVolume}%</span>
              </span>
              <input
                type="range"
                min="0"
                max="200"
                value={micVolume}
                onChange={(event) => setMicVolume(event.target.value)}
                className="w-full"
                style={{ accentColor: sliderAccent }}
              />
            </label>

            <div className={`h-2 overflow-hidden rounded-full ${colorMode === 'dark' ? 'bg-slate-800' : 'bg-slate-200'}`}>
              <div
                className="h-full rounded-full bg-blue-500 transition-[width] duration-75"
                style={{ width: `${Math.round(level * 100)}%` }}
              />
            </div>

            {(shouldRecordFacecam || hasFacecamRecording || isFacecamRecording) && (
              <div className={`overflow-hidden rounded-lg border ${borderColor}`}>
                <div className={`flex items-center justify-between gap-2 px-3 py-2 text-xs ${mutedText}`}>
                  <span className="inline-flex items-center gap-2">
                    <FaVideo aria-hidden="true" />
                    {isFacecamRecording ? selectedCameraLabel : 'Camera preview'}
                  </span>
                  <span>{hasFacecamRecording ? formatRecordingTime(facecamDuration || resolvedRecordingDuration) : ''}</span>
                </div>
                <video
                  ref={facecamPreviewRef}
                  src={!isFacecamRecording && facecamUrl ? facecamUrl : undefined}
                  controls={!isFacecamRecording && Boolean(facecamUrl)}
                  muted
                  playsInline
                  autoPlay={isFacecamRecording}
                  className="aspect-video w-full bg-black object-cover"
                />
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={handleStartRecordingClick}
                disabled={!canUseRecorder || isRecording || isStartingRecording}
                className={shouldRecordFacecam ? recordAudioVideoButtonClass : recordPrimaryButtonClass}
                title={isStartingRecording ? 'Starting recording' : recordButtonLabel}
                aria-label={isStartingRecording ? 'Starting recording' : recordButtonLabel}
              >
                {shouldRecordFacecam ? <FaCircle aria-hidden="true" /> : <FaMicrophone aria-hidden="true" />}
              </button>
              <button
                type="button"
                onClick={stopRecording}
                disabled={!isRecording}
                className={shouldRecordFacecam ? stopSquareButtonClass : secondaryIconButtonClass}
                title={stopButtonLabel}
                aria-label={stopButtonLabel}
              >
                <FaStop aria-hidden="true" />
              </button>
              <button
                type="button"
                onClick={handleHintsToggleClick}
                className={hintsIconButtonClass}
                title={hintsEnabled ? 'Hide hints' : 'Show hints'}
                aria-label={hintsEnabled ? 'Hide hints' : 'Show hints'}
              >
                <FaLightbulb aria-hidden="true" />
              </button>
            </div>

            {hasRecording && (
              <div className="grid gap-2">
                <div className={`flex h-8 items-center justify-between gap-2 rounded-lg border px-3 text-xs ${
                  colorMode === 'dark'
                    ? 'border-[#273956] bg-[#111a2f] text-slate-100'
                    : 'border-slate-200 bg-white text-slate-700'
                }`}>
                  <span className="inline-flex min-w-0 items-center gap-2 truncate">
                    <FaMicrophone className="shrink-0" aria-hidden="true" />
                    <span className="truncate">Audio preview</span>
                  </span>
                  <span className="shrink-0 tabular-nums">{formatRecordingTime(resolvedRecordingDuration)}</span>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={togglePreviewPlayback}
                    className={resultSecondaryIconButtonClass}
                    title={isPlayingPreview ? 'Pause preview' : 'Play preview'}
                    aria-label={isPlayingPreview ? 'Pause preview' : 'Play preview'}
                  >
                    {isPlayingPreview ? <FaPause aria-hidden="true" /> : <FaPlay aria-hidden="true" />}
                  </button>
                  <button
                    type="button"
                    onClick={handleAddToSession}
                    disabled={isUploadPending || !hasCurrentLayer}
                    className={resultPrimaryIconButtonClass}
                    title="Add to session"
                    aria-label="Add to session"
                  >
                    <FaPlus aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    onClick={handleAddToLibrary}
                    disabled={isUploadPending || libraryActionComplete}
                    className={resultSecondaryIconButtonClass}
                    title={libraryActionComplete ? 'Already in library' : 'Add to library'}
                    aria-label={libraryActionComplete ? 'Already in library' : 'Add to library'}
                  >
                    <FaHome aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    onClick={handleDeleteRecording}
                    disabled={isUploadPending}
                    className={resultDangerIconButtonClass}
                    title="Remove and delete recording"
                    aria-label="Remove and delete recording"
                  >
                    <FaTimesCircle aria-hidden="true" />
                  </button>
                </div>
              </div>
            )}

            {recorderError && (
              <div className="rounded-lg border border-red-400/40 bg-red-500/10 px-3 py-2 text-xs text-red-400">
                {recorderError}
              </div>
            )}

            {facecamError && (
              <div className="rounded-lg border border-red-400/40 bg-red-500/10 px-3 py-2 text-xs text-red-400">
                {facecamError}
              </div>
            )}

            {!canUseRecorder && (
              <div className={`rounded-lg border ${borderColor} px-3 py-2 text-xs ${mutedText}`}>
                Recording is unavailable in this browser.
              </div>
            )}

            {canUseRecorder && microphones.length === 0 && (
              <div className={`text-xs ${mutedText}`}>
                Using {selectedMicLabel}.
              </div>
            )}

            {canUseRecorder && shouldRecordFacecam && cameraDevices.length === 0 && (
              <div className={`text-xs ${mutedText}`}>
                Using {selectedCameraLabel}.
              </div>
            )}
          </>
        )}
      </div>

    </section>
    {helperTranscriptOverlay && typeof document !== 'undefined'
      ? createPortal(helperTranscriptOverlay, document.body)
      : helperTranscriptOverlay}
    </>
  );
}
