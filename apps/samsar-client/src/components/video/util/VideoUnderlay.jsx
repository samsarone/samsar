import { useEffect, useRef, useState } from 'react';

const VIDEO_SYNC_SEEK_TOLERANCE_SECONDS = 0.2;
const VIDEO_END_EPSILON_SECONDS = 0.05;

function normalizeVideoSrc(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

function getDefaultVideoLayout(videoType) {
  return {
    width: '100%',
    height: '100%',
    left: '0px',
    top: '0px',
    objectFit: videoType === 'user_video' ? 'contain' : 'cover',
  };
}

function getInactiveSlotIndex(activeSlotIndex) {
  return activeSlotIndex === 0 ? 1 : 0;
}

export default function VideoUnderlay(props) {
  const {
    aiVideoLayer,
    currentLayerSeek = 0,
    canvasDimensions,
    aiVideoLayerType,
    nextAiVideoLayer,
    isVideoPreviewPlaying = false,
  } = props;

  const primaryVideoRef = useRef(null);
  const secondaryVideoRef = useRef(null);
  const videoRefs = [primaryVideoRef, secondaryVideoRef];
  const currentVideoSrc = normalizeVideoSrc(aiVideoLayer);
  const nextVideoSrc = normalizeVideoSrc(nextAiVideoLayer);

  const [activeSlotIndex, setActiveSlotIndex] = useState(0);
  const [slotSources, setSlotSources] = useState(['', '']);
  const [isVideoReady, setIsVideoReady] = useState(false);
  const [videoLayout, setVideoLayout] = useState(getDefaultVideoLayout(aiVideoLayerType));

  const resolveVideoLayout = (videoElement) => {
    if (aiVideoLayerType !== 'user_video') {
      return getDefaultVideoLayout(aiVideoLayerType);
    }

    const sourceWidth = Number(videoElement?.videoWidth);
    const sourceHeight = Number(videoElement?.videoHeight);
    const canvasWidth = Number(canvasDimensions?.width);
    const canvasHeight = Number(canvasDimensions?.height);

    if (!sourceWidth || !sourceHeight || !canvasWidth || !canvasHeight) {
      return getDefaultVideoLayout(aiVideoLayerType);
    }

    const scale = Math.min(1, canvasWidth / sourceWidth, canvasHeight / sourceHeight);
    const displayWidth = Math.max(1, Math.round(sourceWidth * scale));
    const displayHeight = Math.max(1, Math.round(sourceHeight * scale));
    const offsetX = Math.round((canvasWidth - displayWidth) / 2);
    const offsetY = Math.round((canvasHeight - displayHeight) / 2);

    return {
      width: `${displayWidth}px`,
      height: `${displayHeight}px`,
      left: `${offsetX}px`,
      top: `${offsetY}px`,
      objectFit: 'contain',
    };
  };

  useEffect(() => {
    if (!currentVideoSrc) {
      setSlotSources((previousSources) => (
        previousSources[0] || previousSources[1] ? ['', ''] : previousSources
      ));
      setIsVideoReady(false);
      setVideoLayout(getDefaultVideoLayout(aiVideoLayerType));
      return;
    }

    const existingSlotIndex = slotSources.findIndex((source) => source === currentVideoSrc);
    if (existingSlotIndex !== -1) {
      if (existingSlotIndex !== activeSlotIndex) {
        const promotedVideo = videoRefs[existingSlotIndex].current;
        setActiveSlotIndex(existingSlotIndex);
        setIsVideoReady(Boolean(promotedVideo && promotedVideo.readyState >= 2));
        setVideoLayout(getDefaultVideoLayout(aiVideoLayerType));
      }
      return;
    }

    const targetSlotIndex = getInactiveSlotIndex(activeSlotIndex);
    setSlotSources((previousSources) => {
      const nextSources = [...previousSources];
      nextSources[targetSlotIndex] = currentVideoSrc;
      return nextSources;
    });
    setActiveSlotIndex(targetSlotIndex);
    setIsVideoReady(false);
    setVideoLayout(getDefaultVideoLayout(aiVideoLayerType));
  }, [activeSlotIndex, aiVideoLayerType, currentVideoSrc, slotSources]);

  useEffect(() => {
    if (!currentVideoSrc || !nextVideoSrc || nextVideoSrc === currentVideoSrc || slotSources.includes(nextVideoSrc)) {
      return;
    }

    setSlotSources((previousSources) => {
      const currentSlotIndex = previousSources.findIndex((source) => source === currentVideoSrc);
      const targetSlotIndex = currentSlotIndex === 0
        ? 1
        : currentSlotIndex === 1
          ? 0
          : getInactiveSlotIndex(activeSlotIndex);
      const nextSources = [...previousSources];
      nextSources[targetSlotIndex] = nextVideoSrc;
      return nextSources;
    });
  }, [activeSlotIndex, currentVideoSrc, nextVideoSrc, slotSources]);

  useEffect(() => {
    const activeVideo = videoRefs[activeSlotIndex].current;
    const activeSlotSource = slotSources[activeSlotIndex];
    if (!activeVideo || !currentVideoSrc || activeSlotSource !== currentVideoSrc) {
      return undefined;
    }

    let isCancelled = false;

    const markReady = () => {
      if (isCancelled) {
        return;
      }
      setVideoLayout(resolveVideoLayout(activeVideo));
      setIsVideoReady(true);
    };

    const handleLoadedMetadata = () => {
      if (!isCancelled) {
        setVideoLayout(resolveVideoLayout(activeVideo));
      }
    };

    const handleError = () => {
      if (!isCancelled) {
        setIsVideoReady(false);
      }
    };

    activeVideo.preload = 'auto';
    activeVideo.muted = true;
    activeVideo.playsInline = true;
    activeVideo.addEventListener('loadedmetadata', handleLoadedMetadata);
    activeVideo.addEventListener('loadeddata', markReady);
    activeVideo.addEventListener('canplay', markReady);
    activeVideo.addEventListener('canplaythrough', markReady);
    activeVideo.addEventListener('error', handleError);

    if (activeVideo.readyState >= 2) {
      markReady();
    } else {
      try {
        activeVideo.load();
      } catch  {
        // Ignore best-effort preload failures; the element will emit an error if needed.
      }
    }

    return () => {
      isCancelled = true;
      activeVideo.removeEventListener('loadedmetadata', handleLoadedMetadata);
      activeVideo.removeEventListener('loadeddata', markReady);
      activeVideo.removeEventListener('canplay', markReady);
      activeVideo.removeEventListener('canplaythrough', markReady);
      activeVideo.removeEventListener('error', handleError);
    };
  }, [activeSlotIndex, aiVideoLayerType, canvasDimensions, currentVideoSrc, slotSources]);

  useEffect(() => {
    const inactiveSlotIndex = getInactiveSlotIndex(activeSlotIndex);
    const inactiveVideo = videoRefs[inactiveSlotIndex].current;
    const inactiveSource = slotSources[inactiveSlotIndex];
    if (!inactiveVideo || !inactiveSource || inactiveSource === currentVideoSrc) {
      return;
    }

    inactiveVideo.preload = 'auto';
    inactiveVideo.muted = true;
    inactiveVideo.playsInline = true;
    if (inactiveVideo.readyState < 2) {
      try {
        inactiveVideo.load();
      } catch  {
        // Ignore best-effort preloading failures; playback still falls back to normal loading.
      }
    }
  }, [activeSlotIndex, currentVideoSrc, slotSources]);

  useEffect(() => {
    videoRefs.forEach((videoRef, slotIndex) => {
      const video = videoRef.current;
      if (!video || slotIndex === activeSlotIndex || video.paused) {
        return;
      }
      video.pause();
    });
  }, [activeSlotIndex, slotSources]);

  useEffect(() => {
    const activeVideo = videoRefs[activeSlotIndex].current;
    if (!activeVideo || slotSources[activeSlotIndex] !== currentVideoSrc || Number.isNaN(Number(currentLayerSeek))) {
      return undefined;
    }

    const syncToCurrentSeek = () => {
      const rawSeekTime = Math.max(0, Number(currentLayerSeek) || 0);
      const hasKnownDuration = Number.isFinite(activeVideo.duration) && activeVideo.duration > 0;
      const maxSeekTime = hasKnownDuration
        ? Math.max(0, activeVideo.duration - VIDEO_END_EPSILON_SECONDS)
        : rawSeekTime;
      const nextSeekTime = hasKnownDuration
        ? Math.min(rawSeekTime, maxSeekTime)
        : rawSeekTime;

      if (!isVideoPreviewPlaying) {
        if (!activeVideo.paused) {
          activeVideo.pause();
        }
        if (Math.abs(activeVideo.currentTime - nextSeekTime) > 0.01) {
          activeVideo.currentTime = nextSeekTime;
        }
        return;
      }

      const shouldCorrectDrift =
        Math.abs(activeVideo.currentTime - nextSeekTime) > VIDEO_SYNC_SEEK_TOLERANCE_SECONDS
        || (activeVideo.ended && (!hasKnownDuration || nextSeekTime < maxSeekTime));

      if (shouldCorrectDrift) {
        activeVideo.currentTime = nextSeekTime;
      }

      if (hasKnownDuration && rawSeekTime >= activeVideo.duration - VIDEO_END_EPSILON_SECONDS) {
        activeVideo.pause();
        return;
      }

      if (activeVideo.paused) {
        const playAttempt = activeVideo.play();
        if (playAttempt && typeof playAttempt.catch === 'function') {
          playAttempt.catch(() => {});
        }
      }
    };

    if (isVideoReady) {
      syncToCurrentSeek();
      return undefined;
    }

    const handleLoadedData = () => {
      syncToCurrentSeek();
    };

    activeVideo.addEventListener('loadeddata', handleLoadedData, { once: true });

    return () => {
      activeVideo.removeEventListener('loadeddata', handleLoadedData);
    };
  }, [
    activeSlotIndex,
    currentLayerSeek,
    currentVideoSrc,
    isVideoPreviewPlaying,
    isVideoReady,
    slotSources,
  ]);

  return (
    <div
      style={{
        position: 'relative',
        width: `${canvasDimensions.width}px`,
        height: `${canvasDimensions.height}px`,
        overflow: 'hidden',
      }}
    >
      <div
        className="absolute top-0 left-0"
        style={{
          position: 'relative',
          width: '100%',
          height: '100%',
          pointerEvents: 'none',
          marginLeft: '1px',
          marginTop: '1px',
        }}
      >
        {[0, 1].map((slotIndex) => {
          const isActiveSlot = slotIndex === activeSlotIndex;
          const source = slotSources[slotIndex];
          const shouldShowSlot = Boolean(currentVideoSrc) && isActiveSlot && source === currentVideoSrc;
          return (
            <video
              key={slotIndex}
              ref={videoRefs[slotIndex]}
              src={source || undefined}
              muted
              preload="auto"
              playsInline
              aria-hidden={!shouldShowSlot}
              style={shouldShowSlot ? {
                position: 'absolute',
                width: videoLayout.width,
                height: videoLayout.height,
                left: videoLayout.left,
                top: videoLayout.top,
                objectFit: videoLayout.objectFit,
                opacity: 1,
              } : {
                position: 'absolute',
                width: '1px',
                height: '1px',
                left: '0px',
                top: '0px',
                opacity: 0,
                pointerEvents: 'none',
              }}
            />
          );
        })}
      </div>

      {isVideoReady === false && currentVideoSrc && (
        <div className="absolute top-0 left-0 w-full h-full flex items-center justify-center bg-black bg-opacity-50">
          <div className="text-white">Loading video...</div>
        </div>
      )}
    </div>
  );
}
