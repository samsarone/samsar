// SpeechSelectToolbar.jsx
import { useEffect, useState } from 'react';
import SecondaryButton from '../../../common/SecondaryButton.tsx';
import { TOOLBAR_ACTION_VIEW } from '../../../../constants/Types.ts';
import { useColorMode } from '../../../../contexts/ColorMode.jsx';

const PROCESSOR_API_URL = import.meta.env.VITE_PROCESSOR_API;

function resolveDefaultStartTime(currentLayer, audioLayer) {
  const currentLayerStartTime = Number(currentLayer?.durationOffset ?? currentLayer?.startTime);
  if (Number.isFinite(currentLayerStartTime) && currentLayerStartTime >= 0) {
    return currentLayerStartTime;
  }

  const audioLayerStartTime = Number(audioLayer?.startTime);
  return Number.isFinite(audioLayerStartTime) && audioLayerStartTime >= 0 ? audioLayerStartTime : 0;
}

function resolveSpeechDuration(audioLayer) {
  const parsedOriginalDuration = Number(audioLayer?.originalDuration);
  if (Number.isFinite(parsedOriginalDuration) && parsedOriginalDuration > 0) {
    return parsedOriginalDuration;
  }

  const parsedDuration = Number(audioLayer?.duration);
  return Number.isFinite(parsedDuration) && parsedDuration > 0 ? parsedDuration : 5;
}

function resolveSessionSubtitlesEnabled(sessionDetails = {}) {
  if (sessionDetails?.enableSubtitles === false) {
    return false;
  }

  if (typeof sessionDetails?.hasSubtitles === 'boolean') {
    return sessionDetails.hasSubtitles;
  }

  if (typeof sessionDetails?.has_subtitles === 'boolean') {
    return sessionDetails.has_subtitles;
  }

  if (typeof sessionDetails?.enableSubtitles === 'boolean') {
    return sessionDetails.enableSubtitles;
  }

  return true;
}

export default function SpeechSelectToolbar(props) {
  const {
    audioLayer,
    submitAddTrackToProject,
    setCurrentCanvasAction,
    currentLayer,
    sessionDetails,
  } = props;

  const [startTime, setStartTime] = useState(() => resolveDefaultStartTime(currentLayer, audioLayer));
  const [duration, setDuration] = useState(() => resolveSpeechDuration(audioLayer));
  const [volume] = useState(100);
  const sessionSubtitlesEnabled = resolveSessionSubtitlesEnabled(sessionDetails);

  useEffect(() => {
    setStartTime(resolveDefaultStartTime(currentLayer, audioLayer));
    setDuration(resolveSpeechDuration(audioLayer));
  }, [currentLayer, audioLayer]);

  const { colorMode } = useColorMode();

  const panelSurface =
    colorMode === 'dark'
      ? 'bg-[#0f1629] text-slate-100 border border-[#1f2a3d] shadow-[0_10px_28px_rgba(0,0,0,0.35)]'
      : 'bg-white text-slate-900 border border-slate-200 shadow-sm';
  const compactButtonClass = '!m-0 !min-w-0 !rounded-md !px-2 !py-1 text-xs leading-tight';
  const audioUrl = `${PROCESSOR_API_URL}/${audioLayer.localAudioLinks[0]}`;

  const handleAccept = () => {
    const parsedStartTime = parseFloat(startTime);
    const parsedDuration = parseFloat(duration);
    const payload = {
      startTime: Number.isFinite(parsedStartTime) ? parsedStartTime : 0,
      duration: Number.isFinite(parsedDuration) ? parsedDuration : resolveSpeechDuration(audioLayer),
      volume: parseFloat(volume),
      endTime: (
        Number.isFinite(parsedStartTime) ? parsedStartTime : 0
      ) + (
        Number.isFinite(parsedDuration) ? parsedDuration : resolveSpeechDuration(audioLayer)
      ),
      addSubtitles: sessionSubtitlesEnabled,
      speakerCharacterName: audioLayer.speakerCharacterName,
      audioLayerId: audioLayer._id?.toString?.() || audioLayer._id,
      audioBindingMode: 'unbounded',
      bindToLayer: false,
      studioSpeechGeneration: true,
    };

    submitAddTrackToProject(0, payload);
  };

  return (
    <div className={`${panelSurface} p-3 rounded-xl space-y-3`}>
      <div>
        <audio controls className="h-8 w-full">
          <source src={audioUrl} type="audio/mpeg" />
          Your browser does not support the audio element.
        </audio>
      </div>

      <div className="pt-1 flex justify-end gap-2">
        <SecondaryButton onClick={handleAccept} className={compactButtonClass}>Accept</SecondaryButton>
        <SecondaryButton
          onClick={() => setCurrentCanvasAction(TOOLBAR_ACTION_VIEW.SHOW_DEFAULT_DISPLAY)}
          className={compactButtonClass}
        >
          Reject
        </SecondaryButton>
      </div>
    </div>
  );
}
