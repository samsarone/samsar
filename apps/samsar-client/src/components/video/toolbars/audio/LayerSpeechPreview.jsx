
import SecondaryButton from '../../../common/SecondaryButton.tsx';
import { FaArrowLeft, FaCheck } from 'react-icons/fa';
import SpeechSelectToolbar from './SpeechSelectToolbar';

export default function LayerSpeechPreview(props) {
  const {
    audioLayers,
    onAddAll,
    onBack,
    submitAddTrackToProject,
    colorMode,
    sessionDetails,
  } = props;
  const compactButtonClass = '!m-0 !min-w-0 !rounded-md !px-2 !py-1 text-xs leading-tight';

  return (
    <div>
      {/* Header with "Back" and "Add All" buttons */}
      <div className="flex justify-between items-center mb-2">
        <SecondaryButton onClick={onBack} className={compactButtonClass}>
          <FaArrowLeft className="inline mr-1" /> Back
        </SecondaryButton>
        <SecondaryButton onClick={onAddAll} className={compactButtonClass}>
          <FaCheck className="inline mr-1" /> Add All
        </SecondaryButton>
      </div>

      {/* Display each audio layer using SpeechSelectToolbar */}
      {audioLayers.map((layer, index) => (
        <div key={index} className="mb-4">
          <SpeechSelectToolbar
            audioLayer={layer}
            submitAddTrackToProject={submitAddTrackToProject}
            setCurrentCanvasAction={() => {
              if (typeof onBack === 'function') {
                onBack();
              }
            }}
            colorMode={colorMode}
            sessionDetails={sessionDetails}
          />
        </div>
      ))}
    </div>
  );
}
