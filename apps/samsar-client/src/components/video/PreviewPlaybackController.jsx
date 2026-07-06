import { useCallback, useEffect, useRef } from 'react';
import {
  buildResolvedPreviewAudioVolumeAutomationPoints,
  buildMusicDuckingWindows,
  clampAudioValue,
  getAudioVolumeGainAtTime,
  getMusicDuckingVolumeAtTime,
  hasManualAudioVolumeAutomation,
  isMusicLikeAudioType,
  isRenderablePreviewAudioLayer,
  normalizeAudioLayerType,
  resolvePreviewAudioUrl,
  resolvePreviewLayerBaseVolume,
  shouldDuckMusicAgainstAudioType,
} from './util/audioPreviewDucking.js';

const PROCESSOR_API_URL = import.meta.env.VITE_PROCESSOR_API;
const DISPLAY_FRAMES_PER_SECOND = 30;
const DEFAULT_PREVIEW_FRAMES_PER_SECOND = 24;
const VALID_PREVIEW_FRAME_RATES = new Set([16, 24, 30]);
const PREVIEW_AUDIO_READY_STATE = 3;
const PREVIEW_AUDIO_PRIME_LOOKAHEAD_SECONDS = 0.75;
const PREVIEW_AUDIO_PRIME_TIMEOUT_MS = 250;
const PREVIEW_AUDIO_SEEK_TOLERANCE_SECONDS = 0.2;

function markPreviewAudioFailed(audioEntry, reason = 'media_error') {
  if (!audioEntry || audioEntry.hasPlaybackError) {
    return;
  }

  audioEntry.hasPlaybackError = true;
  audioEntry.failedSourceSet?.add?.(audioEntry.url);
  if (typeof console !== 'undefined') {
    console.warn('[PreviewPlayback] skipping failed audio source', {
      reason,
      url: audioEntry.url,
      errorCode: audioEntry.audio?.error?.code,
      errorMessage: audioEntry.audio?.error?.message,
    });
  }
}

function resolvePreviewFramesPerSecond(value) {
  const parsed = Math.round(Number(value));
  return VALID_PREVIEW_FRAME_RATES.has(parsed)
    ? parsed
    : DEFAULT_PREVIEW_FRAMES_PER_SECOND;
}

export default function PreviewPlaybackController(props) {
  const {
    applyAudioDucking = true,
    audioLayers,
    currentLayerSeek,
    framesPerSecond,
    isVideoPreviewPlaying,
    setCurrentLayerSeek,
    setIsVideoPreviewPlaying,
    suspendAudioPreview = false,
    totalDuration,
  } = props;

  const audioRefs = useRef([]);
  const audioContextRef = useRef(null);
  const playbackIntervalRef = useRef(null);
  const currentLayerSeekRef = useRef(0);
  const failedAudioSourceRef = useRef(new Set());

  useEffect(() => {
    const resolvedSeek = Number(currentLayerSeek);
    currentLayerSeekRef.current = Number.isFinite(resolvedSeek) ? resolvedSeek : 0;
  }, [currentLayerSeek]);

  const clearPlaybackInterval = useCallback(() => {
    if (playbackIntervalRef.current) {
      clearInterval(playbackIntervalRef.current);
      playbackIntervalRef.current = null;
    }
  }, []);

  const setPreviewBaseGain = useCallback((audioEntry, baseGain = 1) => {
    if (!audioEntry) {
      return;
    }

    const resolvedBaseGain = Math.max(0, Number(baseGain) || 0);
    if (audioEntry.baseGainNode) {
      audioEntry.baseGainNode.gain.value = resolvedBaseGain;
      return;
    }

    audioEntry.audio.volume = clampAudioValue(resolvedBaseGain);
  }, []);

  const setPreviewDuckGain = useCallback((audioEntry, duckGain = 1) => {
    if (!audioEntry) {
      return;
    }

    const resolvedDuckGain = clampAudioValue(duckGain);
    if (audioEntry.duckGainNode) {
      audioEntry.duckGainNode.gain.value = resolvedDuckGain;
      return;
    }

    audioEntry.audio.volume = clampAudioValue(audioEntry.baseVolume * resolvedDuckGain);
  }, []);

  const resetPreviewAudioLevels = useCallback(() => {
    audioRefs.current.forEach((audioEntry) => {
      const nextBaseGain = audioEntry.manualVolumeAdjustmentEnabled
        ? getAudioVolumeGainAtTime(0, audioEntry.manualVolumeAutomationPoints)
        : audioEntry.baseVolume;

      setPreviewBaseGain(audioEntry, nextBaseGain);

      if (isMusicLikeAudioType(audioEntry?.type)) {
        setPreviewDuckGain(audioEntry, 1);
      }
    });
  }, [setPreviewBaseGain, setPreviewDuckGain]);

  const syncPreviewAudioLevels = useCallback((previewTime) => {
    const musicEntries = audioRefs.current.filter((audioEntry) => isMusicLikeAudioType(audioEntry?.type));

    audioRefs.current.forEach((audioEntry) => {
      const layerTime = Math.max(0, previewTime - audioEntry.startTime);
      const nextBaseGain = audioEntry.manualVolumeAdjustmentEnabled
        ? getAudioVolumeGainAtTime(layerTime, audioEntry.manualVolumeAutomationPoints)
        : audioEntry.baseVolume;

      setPreviewBaseGain(audioEntry, nextBaseGain);
    });

    if (!applyAudioDucking) {
      musicEntries.forEach((audioEntry) => setPreviewDuckGain(audioEntry, 1));
      return;
    }

    const autoDuckMusicEntries = musicEntries.filter((audioEntry) => !audioEntry.manualVolumeAdjustmentEnabled);
    musicEntries
      .filter((audioEntry) => audioEntry.manualVolumeAdjustmentEnabled)
      .forEach((audioEntry) => setPreviewDuckGain(audioEntry, 1));

    if (autoDuckMusicEntries.length === 0) {
      return;
    }

    const duckingEntries = audioRefs.current.filter((audioEntry) => shouldDuckMusicAgainstAudioType(audioEntry?.type));
    if (duckingEntries.length === 0) {
      autoDuckMusicEntries.forEach((audioEntry) => setPreviewDuckGain(audioEntry, 1));
      return;
    }

    autoDuckMusicEntries.forEach((audioEntry) => {
      const nextGain = getMusicDuckingVolumeAtTime(previewTime, audioEntry.duckingWindows);
      setPreviewDuckGain(audioEntry, nextGain);
    });
  }, [
    applyAudioDucking,
    setPreviewBaseGain,
    setPreviewDuckGain,
  ]);

  const primePreviewAudioWindow = useCallback((previewTime) => {
    return audioRefs.current.filter((audioEntry) => {
      if (audioEntry.hasPlaybackError) {
        return false;
      }

      const shouldPrime = audioEntry.endTime > previewTime
        && audioEntry.startTime <= previewTime + PREVIEW_AUDIO_PRIME_LOOKAHEAD_SECONDS;

      if (!shouldPrime) {
        return false;
      }

      if (
        audioEntry.audio.readyState < PREVIEW_AUDIO_READY_STATE
        && !audioEntry.hasRequestedLoad
      ) {
        try {
          audioEntry.hasRequestedLoad = true;
          audioEntry.audio.load();
        } catch  {
          markPreviewAudioFailed(audioEntry, 'load_error');
        }
      }

      return true;
    });
  }, []);

  const waitForPreviewAudioWindow = useCallback(async (previewTime) => {
    const pendingEntries = primePreviewAudioWindow(previewTime).filter(
      (audioEntry) => audioEntry.audio.readyState < PREVIEW_AUDIO_READY_STATE
    );

    if (pendingEntries.length === 0) {
      return;
    }

    await Promise.race([
      Promise.all(pendingEntries.map((audioEntry) => (
        new Promise((resolve) => {
          const { audio } = audioEntry;
          let settled = false;
          let timeoutId = null;

          const cleanup = () => {
            if (timeoutId) {
              clearTimeout(timeoutId);
            }
            audio.removeEventListener('canplay', handleReady);
            audio.removeEventListener('loadeddata', handleReady);
            audio.removeEventListener('error', handleReady);
          };

          const handleReady = () => {
            if (settled) {
              return;
            }
            settled = true;
            cleanup();
            resolve();
          };

          timeoutId = setTimeout(handleReady, PREVIEW_AUDIO_PRIME_TIMEOUT_MS);
          audio.addEventListener('canplay', handleReady);
          audio.addEventListener('loadeddata', handleReady);
          audio.addEventListener('error', handleReady);
        })
      ))),
      new Promise((resolve) => setTimeout(resolve, PREVIEW_AUDIO_PRIME_TIMEOUT_MS)),
    ]);
  }, [primePreviewAudioWindow]);

  const syncPreviewAudioPlayback = useCallback((previewTime, shouldAutoPlay = true) => {
    primePreviewAudioWindow(previewTime);

    audioRefs.current.forEach((audioEntry) => {
      if (audioEntry.hasPlaybackError) {
        return;
      }

      const {
        audio,
        startTime,
        endTime,
        sourceTrimStartTime = 0,
      } = audioEntry;

      if (previewTime >= startTime && previewTime < endTime) {
        const nextCurrentTime = Math.max(0, sourceTrimStartTime + (previewTime - startTime));
        if (Math.abs(audio.currentTime - nextCurrentTime) > PREVIEW_AUDIO_SEEK_TOLERANCE_SECONDS) {
          audio.currentTime = nextCurrentTime;
        }

        if (shouldAutoPlay && audio.paused) {
          const playPromise = audio.play();
          if (playPromise?.catch) {
            playPromise.catch((error) => {
              if (audio.error) {
                markPreviewAudioFailed(audioEntry, error?.name || 'playback_error');
              }
            });
          }
        }
      } else if (!audio.paused) {
        audio.pause();
      }
    });

    syncPreviewAudioLevels(previewTime);
  }, [primePreviewAudioWindow, syncPreviewAudioLevels]);

  useEffect(() => {
    const renderableAudioLayers = !suspendAudioPreview && Array.isArray(audioLayers)
      ? audioLayers.filter(isRenderablePreviewAudioLayer)
      : [];
    const shouldBuildPreviewAudioGraph = Boolean(
      renderableAudioLayers.length > 0
      && renderableAudioLayers.some((layer) => (
        applyAudioDucking
        || hasManualAudioVolumeAutomation(layer)
        || resolvePreviewLayerBaseVolume(layer) > 1
      ))
    );
    const AudioContextCtor = typeof window !== 'undefined'
      ? (window.AudioContext || window.webkitAudioContext)
      : null;
    const audioContext = shouldBuildPreviewAudioGraph && AudioContextCtor
      ? new AudioContextCtor()
      : null;
    const createdAudioRefs = renderableAudioLayers
      .map((layer) => {
        const resolvedAudioUrl = resolvePreviewAudioUrl(layer, PROCESSOR_API_URL);
        if (!resolvedAudioUrl) {
          return null;
        }
        if (failedAudioSourceRef.current.has(resolvedAudioUrl)) {
          return null;
        }

        const baseVolume = resolvePreviewLayerBaseVolume(layer);
        const mediaElementVolume = clampAudioValue(baseVolume);
        const startTime = Number.isFinite(Number(layer.startTime))
          ? Math.max(0, Number(layer.startTime))
          : 0;
        const duration = Number.isFinite(Number(layer.duration))
          ? Math.max(0, Number(layer.duration))
          : 0;
        const explicitEndTime = Number(layer.endTime);
        const endTime = Number.isFinite(explicitEndTime) && explicitEndTime > startTime
          ? explicitEndTime
          : startTime + duration;
        const audioEl = new Audio(resolvedAudioUrl);
        audioEl.preload = 'none';
        audioEl.crossOrigin = 'anonymous';
        audioEl.volume = mediaElementVolume;

        const manualVolumeAdjustmentEnabled = hasManualAudioVolumeAutomation(layer);
        const manualVolumeAutomationPoints = manualVolumeAdjustmentEnabled
          ? buildResolvedPreviewAudioVolumeAutomationPoints(layer)
          : [];

        const audioEntry = {
          audio: audioEl,
          baseVolume,
          startTime,
          endTime,
          type: normalizeAudioLayerType(layer.generationType),
          sourceTrimStartTime: Number.isFinite(Number(layer.sourceTrimStartTime))
            ? Math.max(0, Number(layer.sourceTrimStartTime))
            : 0,
          duckingWindows: [],
          sourceNode: null,
          baseGainNode: null,
          duckGainNode: null,
          manualVolumeAdjustmentEnabled,
          manualVolumeAutomationPoints,
          hasPlaybackError: failedAudioSourceRef.current.has(resolvedAudioUrl),
          hasRequestedLoad: false,
          failedSourceSet: failedAudioSourceRef.current,
          url: resolvedAudioUrl,
        };

        audioEl.addEventListener('error', () => {
          markPreviewAudioFailed(audioEntry, 'media_error');
        });

        if (audioContext) {
          try {
            const sourceNode = audioContext.createMediaElementSource(audioEl);
            const baseGainNode = audioContext.createGain();
            const initialBaseGain = manualVolumeAdjustmentEnabled
              ? getAudioVolumeGainAtTime(0, manualVolumeAutomationPoints)
              : baseVolume;
            baseGainNode.gain.value = initialBaseGain;

            audioEntry.sourceNode = sourceNode;
            audioEntry.baseGainNode = baseGainNode;
            audioEl.volume = 1;

            sourceNode.connect(baseGainNode);

            if (isMusicLikeAudioType(audioEntry.type)) {
              const duckGainNode = audioContext.createGain();
              duckGainNode.gain.value = 1;
              baseGainNode.connect(duckGainNode);
              duckGainNode.connect(audioContext.destination);
              audioEntry.duckGainNode = duckGainNode;
            } else {
              baseGainNode.connect(audioContext.destination);
            }
          } catch  {
            audioEl.volume = mediaElementVolume;
            audioEntry.sourceNode = null;
            audioEntry.baseGainNode = null;
            audioEntry.duckGainNode = null;
          }
        }

        return audioEntry;
      })
      .filter(Boolean);

    const duckingLayers = createdAudioRefs.filter((audioEntry) => shouldDuckMusicAgainstAudioType(audioEntry.type));
    createdAudioRefs.forEach((audioEntry) => {
      if (!isMusicLikeAudioType(audioEntry.type)) {
        return;
      }

      audioEntry.duckingWindows = buildMusicDuckingWindows({
        musicStartTime: audioEntry.startTime,
        musicEndTime: audioEntry.endTime,
        duckingLayers,
      });
    });

    audioContextRef.current = audioContext;
    audioRefs.current = createdAudioRefs;
    resetPreviewAudioLevels();

    return () => {
      createdAudioRefs.forEach((audioEntry) => {
        audioEntry.audio.pause();
        audioEntry.audio.src = '';

        [
          audioEntry.duckGainNode,
          audioEntry.baseGainNode,
          audioEntry.sourceNode,
        ].forEach((audioNode) => {
          try {
            audioNode?.disconnect();
          } catch  {
            // Ignore best-effort cleanup errors.
          }
        });
      });

      if (audioRefs.current === createdAudioRefs) {
        audioRefs.current = [];
      }
      if (audioContextRef.current === audioContext) {
        audioContextRef.current = null;
      }

      if (audioContext && audioContext.state !== 'closed') {
        audioContext.close().catch(() => {});
      }
    };
  }, [
    audioLayers,
    applyAudioDucking,
    resetPreviewAudioLevels,
    suspendAudioPreview,
  ]);

  useEffect(() => {
    if (!isVideoPreviewPlaying) {
      clearPlaybackInterval();
      audioRefs.current.forEach(({ audio }) => {
        audio.pause();
      });
      resetPreviewAudioLevels();
      return undefined;
    }

    let isCancelled = false;

    const startPlayback = async () => {
      if (audioContextRef.current?.state === 'suspended') {
        await audioContextRef.current.resume().catch(() => {});
      }

      const previewFramesPerSecond = resolvePreviewFramesPerSecond(framesPerSecond);
      const displayFrameStep = DISPLAY_FRAMES_PER_SECOND / previewFramesPerSecond;
      const totalFrames = Math.floor((Number(totalDuration) || 0) * DISPLAY_FRAMES_PER_SECOND);
      if (totalFrames <= 0) {
        setIsVideoPreviewPlaying(false);
        return;
      }

      const initialFrame = Math.max(
        0,
        Math.min(totalFrames - 1, Math.floor(currentLayerSeekRef.current))
      );
      const initialPreviewTime = initialFrame / DISPLAY_FRAMES_PER_SECOND;

      currentLayerSeekRef.current = initialFrame;
      syncPreviewAudioPlayback(initialPreviewTime, false);
      await waitForPreviewAudioWindow(initialPreviewTime);

      if (isCancelled) {
        return;
      }

      syncPreviewAudioPlayback(initialPreviewTime, true);
      clearPlaybackInterval();

      playbackIntervalRef.current = setInterval(() => {
        const nextFrame = currentLayerSeekRef.current + displayFrameStep;

        if (nextFrame >= totalFrames) {
          clearPlaybackInterval();
          setIsVideoPreviewPlaying(false);
          return;
        }

        currentLayerSeekRef.current = nextFrame;
        setCurrentLayerSeek(nextFrame);
        syncPreviewAudioPlayback(nextFrame / DISPLAY_FRAMES_PER_SECOND, true);
      }, 1000 / previewFramesPerSecond);
    };

    startPlayback();

    return () => {
      isCancelled = true;
      clearPlaybackInterval();
    };
  }, [
    clearPlaybackInterval,
    isVideoPreviewPlaying,
    resetPreviewAudioLevels,
    setCurrentLayerSeek,
    setIsVideoPreviewPlaying,
    syncPreviewAudioPlayback,
    framesPerSecond,
    totalDuration,
    waitForPreviewAudioWindow,
  ]);

  useEffect(() => () => {
    clearPlaybackInterval();
  }, [clearPlaybackInterval]);

  return null;
}
