import { useState } from 'react';
import SecondaryButton from '../../../common/SecondaryButton.tsx';
import { TOOLBAR_ACTION_VIEW } from '../../../../constants/Types.ts';
import { useColorMode } from '../../../../contexts/ColorMode.jsx';

const PROCESSOR_API_URL = import.meta.env.VITE_PROCESSOR_API;

export default function SoundSelectToolbar(props) {
  const { audioLayer, submitAddTrackToProject, setCurrentCanvasAction
  } = props;


  const [startTime, setStartTime] = useState(0);
  const [duration, setDuration] = useState(audioLayer.duration || 5); // Default duration from audioLayer or 5
  const [volume, setVolume] = useState(100); // Default volume is 100

  const { colorMode } = useColorMode();

  const panelSurface =
    colorMode === 'dark'
      ? 'bg-[#0f1629] text-slate-100 border border-[#1f2a3d] shadow-[0_10px_28px_rgba(0,0,0,0.35)]'
      : 'bg-white text-slate-900 border border-slate-200 shadow-sm';
  const inputSurface =
    colorMode === 'dark'
      ? 'bg-[#111a2f] border border-[#1f2a3d] text-slate-100'
      : 'bg-white border border-slate-200 text-slate-900 shadow-sm';
  const compactButtonClass = '!m-0 !min-w-0 !rounded-md !px-2 !py-1 text-xs leading-tight';

  // Construct the full audio URL
  const audioUrl = `${PROCESSOR_API_URL}/${audioLayer.localAudioLinks[0]}`;

  const handleSubmit = (evt) => {
    evt.preventDefault();
    const payload = {
      startTime: parseFloat(startTime),
      duration: parseFloat(duration),
      volume: parseFloat(volume),
      endTime: parseFloat(startTime) + parseFloat(duration),
    };


    submitAddTrackToProject(0, payload); // Pass 0 as index
  };

  return (
    <div className={`${panelSurface} rounded-xl p-3 space-y-3`}>
      <div className="mt-2">
        <audio controls className="h-8 w-full">
          <source src={audioUrl} type="audio/mpeg" />
          Your browser does not support the audio element.
        </audio>
      </div>
      <div className="mt-2">
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="grid grid-cols-3 gap-3 items-center">
            <div>
              <input
                type="number"
                name="startTime"
                placeholder="Start Time (secs)"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                className={`${inputSurface} h-10 w-full rounded-md px-3 py-2 bg-transparent`}
              />
              <div className="text-xs text-center">Start Time</div>
            </div>
            <div>
              <input
                type="number"
                name="duration"
                placeholder="Duration (secs)"
                value={duration}
                onChange={(e) => setDuration(e.target.value)}
                className={`${inputSurface} h-10 w-full rounded-md px-3 py-2 bg-transparent`}
              />
              <div className="text-xs text-center">Duration</div>
            </div>
            <div>
              <input
                type="number"
                name="volume"
                placeholder="Volume"
                value={volume}
                onChange={(e) => setVolume(e.target.value)}
                className={`${inputSurface} h-10 w-full rounded-md px-3 py-2 bg-transparent`}
              />
              <div className="text-xs text-center">Volume</div>
            </div>
          </div>
          <div className="mt-2 flex justify-end">
            <SecondaryButton type="submit" className={compactButtonClass}>Add</SecondaryButton>
          </div>
        </form>
      </div>
      <div className="mt-2 flex justify-end">
        <SecondaryButton
          onClick={() => setCurrentCanvasAction(TOOLBAR_ACTION_VIEW.SHOW_DEFAULT_DISPLAY)}
          className={compactButtonClass}
        >
          Cancel
        </SecondaryButton>
      </div>
    </div>
  );
}
