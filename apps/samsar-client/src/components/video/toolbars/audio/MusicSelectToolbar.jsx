import { useState, useEffect } from 'react';
import { useColorMode } from '../../../../contexts/ColorMode.jsx';
import { TOOLBAR_ACTION_VIEW } from '../../../../constants/Types.ts';
import SecondaryButton from '../../../common/SecondaryButton.tsx';

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

export default function MusicSelectToolbar(props) {

  const { audioLayer, sessionDetails, setCurrentCanvasAction, submitAddTrackToProject } = props;

  const [audioData, setAudioData] = useState([]);

  useEffect(() => {
    const audioData = audioLayer.remoteAudioData;
    setAudioData(audioData);

  }, [audioLayer]);


  const { colorMode } = useColorMode();

  const showAudioSubOptionsDisplay = (index) => {
    const newAudioLayers = audioData.map((layer, i) => {
      if (i === index) {
        return {
          ...layer,
          isOptionSelected: true
        }
      } else {
        return {
          ...layer,
          isOptionSelected: false
        }
      }
    });
    setAudioData(newAudioLayers);
  }

  const panelSurface =
    colorMode === 'dark'
      ? 'bg-[#0f1629] text-slate-100 border border-[#1f2a3d] shadow-[0_10px_28px_rgba(0,0,0,0.35)]'
      : 'bg-white text-slate-900 border border-slate-200 shadow-sm';
  const inputSurface =
    colorMode === 'dark'
      ? 'bg-[#111a2f] border border-[#1f2a3d] text-slate-100'
      : 'bg-white border border-slate-200 text-slate-900 shadow-sm';
  const compactButtonClass = '!m-0 !min-w-0 !rounded-md !px-2 !py-1 text-xs leading-tight';

  const latestLayer = audioData[audioData.length - 1];
  const sessionEndTime = getSessionEndTime(sessionDetails);
  if (!latestLayer) {
    return;
  }

  const addTrackSubmit = (evt, index) => {

    const formData = new FormData(evt.target);

    const startTimestamp = Number(formData.get('track'));
    const loopOverEntireSession = formData.get('loopOverEntireSession') === 'on';
 
    evt.preventDefault();

    const volume = Number(formData.get('volume'));
    let payload = {
      startTime: Number.isFinite(startTimestamp) ? startTimestamp : 0,
      volume: Number.isFinite(volume) ? volume : 100,
      loopOverEntireSession,
    }

    if (audioLayer.generationType === 'music') {
      const parsedDuration = Number(audioLayer.originalDuration ?? audioLayer.duration);
      const duration = Number.isFinite(parsedDuration) && parsedDuration > 0 ? parsedDuration : 120;
      const endTime = payload.startTime + duration;
      payload = {
        ...payload,
        endTime: endTime,
        duration: duration,
      }
    }

    

    submitAddTrackToProject(index, payload);


  }

  const audioPreviewDisplay = audioData.map((layer, index) => {

    const previewUrl = layer.audio_url;
    let optionsSelectDisplay = <span />;
    if (layer.isOptionSelected) {
      optionsSelectDisplay = (
        <div className={`${panelSurface} mt-3 rounded-lg p-3`}>
          <form onSubmit={(evt) => addTrackSubmit(evt, index)} className="grid grid-cols-1 gap-3 sm:grid-cols-4 items-end">
            <div>
              <input
                type='number'
                name="track"
                placeholder='Start timestamp (secs)'
                defaultValue={0}
                className={`${inputSurface} h-10 w-full rounded-md px-3 py-2 bg-transparent`}
              />
              <div className='text-xs mt-1 text-center'>
                Start Time (secs)
              </div>
            </div>
            <div>
              <input
                type='number'
                name="volume"
                placeholder='Volume'
                defaultValue={100}
                className={`${inputSurface} h-10 w-full rounded-md px-3 py-2 bg-transparent`}
              />
              <div className='text-xs mt-1 text-center'>
                Volume
              </div>
            </div>
            <label className="flex flex-col justify-center gap-2 text-sm">
              <span className="text-xs text-center">Loop</span>
              <div className="flex items-center justify-center gap-2">
                <input
                  type="checkbox"
                  name="loopOverEntireSession"
                />
                <span>Entire Session</span>
              </div>
              {Number.isFinite(sessionEndTime) && sessionEndTime > 0 && (
                <div className='text-[11px] text-center opacity-75'>
                  Ends at {Math.round(sessionEndTime * 10) / 10}s
                </div>
              )}
            </label>
            <SecondaryButton type="submit" className={`w-full ${compactButtonClass}`}>
              Add
            </SecondaryButton>
          </form>
        </div>
      )
    }

    let selectButton = layer.isOptionSelected ? <span /> : <SecondaryButton className={compactButtonClass}>
      Select
    </SecondaryButton>

    return (
      <div onClick={() => showAudioSubOptionsDisplay(index)}>
        <div className='text-sm cursor-pointer truncate' title={layer.title}>
          {layer.title}
        </div>
        <div>
          <audio controls className='h-8 w-full min-w-0' >
            <source src={previewUrl} type="audio/mpeg" />
            Your browser does not support the audio element.
          </audio>
        </div>
        <div className="mt-1 flex justify-end">
          {selectButton}
        </div>
        <div>
          {optionsSelectDisplay}
        </div>
      </div>
    )
  });


  
  return (
    <div className={`${panelSurface} rounded-xl p-3 space-y-3`}>
      <div>
        <button
          className="text-sm font-medium underline-offset-4 hover:underline"
          onClick={() => setCurrentCanvasAction(TOOLBAR_ACTION_VIEW.SHOW_MUSIC_GENERATE_DISPLAY)}
        >
          Back
        </button>
      </div>
      <div className="space-y-4">
        {audioPreviewDisplay}
      </div>
    </div>
  );
}
