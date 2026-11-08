import { useEffect, useRef, useState } from 'react';
import { useUiLanguage } from '../../hooks/useUiLanguage.js';
import { translateText as uiText } from '../../utils/localization.js';

export default function StudioPostProcessingPreview({ src, isPlaying, setIsPlaying }) {
  useUiLanguage();
  const videoRef = useRef(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (isPlaying) {
      if (video.ended) video.currentTime = 0;
      let active = true;
      video.play()?.catch(() => { if (active) setIsPlaying(false); });
      return () => { active = false; };
    }
    video.pause();
  }, [isPlaying, setIsPlaying, src]);
  useEffect(() => {
    const video = videoRef.current;
    return () => { video?.pause(); setIsPlaying(false); };
  }, [setIsPlaying]);

  return <div className="flex h-full min-h-0 flex-col items-center justify-center gap-3 p-4" data-studio-post-processing-preview>
    <p className="shrink-0 text-center text-sm text-fg-muted" role="status">
      {uiText('Preparing scene previews. Showing the previous render while your changes are processed.')}
    </p>
    <video ref={videoRef} src={src} controls playsInline preload="metadata"
      aria-label={uiText('Previous render preview')}
      className="min-h-0 max-h-full w-full rounded-xl bg-black object-contain"
      onPlay={() => setIsPlaying(true)} onPause={() => setIsPlaying(false)} onEnded={() => setIsPlaying(false)}
      onError={() => { setFailed(true); setIsPlaying(false); }} />
    {failed && <p className="shrink-0 text-sm text-fg-muted">{uiText('The previous preview is unavailable. Scene previews will appear when ready.')}</p>}
  </div>;
}
