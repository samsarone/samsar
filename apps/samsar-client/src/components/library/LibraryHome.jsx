import { useId, useState } from 'react';
import ImageLibraryHome from './image/ImageLibraryHome';
import MusicLibraryHome from './audio/MusicLibraryHome';
import VideoLibraryHome from './video/VideoLibraryHome';
import { FaChevronCircleLeft, FaSpinner } from 'react-icons/fa';
import { useColorMode } from '../../contexts/ColorMode';
import './library.css';

const LIBRARY_TABS = ['Image', 'Audio', 'Video'];

export default function LibraryHome(props) {
  const { resetImageLibrary, onSelectVideo, isSelectButtonDisabled } = props;
  const [selectedOption, setSelectedOption] = useState('Image');
  const tabId = useId();
  const { colorMode } = useColorMode();
  const ratio = String(props.aspectRatio || props.sessionDetails?.aspectRatio || '1:1')
    .trim().match(/^(\d+(?:\.\d+)?)\s*[:/]\s*(\d+(?:\.\d+)?)$/);
  const projectAspectRatio = ratio && Number(ratio[1]) > 0 && Number(ratio[2]) > 0
    ? `${ratio[1]} / ${ratio[2]}`
    : '1 / 1';

  const isLoading = isSelectButtonDisabled;

  const renderContent = () => {
    switch (selectedOption) {
      case 'Image':
        return <ImageLibraryHome {...props} showGlobalSessions={false} />;
      case 'Audio':
        return <MusicLibraryHome {...props} />;
      case 'Video':
        return <VideoLibraryHome {...props} onSelectVideo={onSelectVideo} />;
      default:
        return null;
    }
  };

  const handleBack = () => {
    resetImageLibrary();
  };

  const handleTabKeyDown = (event, option) => {
    const index = LIBRARY_TABS.indexOf(option);
    const nextIndex = {
      ArrowRight: (index + 1) % LIBRARY_TABS.length,
      ArrowLeft: (index + LIBRARY_TABS.length - 1) % LIBRARY_TABS.length,
      Home: 0,
      End: LIBRARY_TABS.length - 1,
    }[event.key];
    if (nextIndex === undefined) return;

    event.preventDefault();
    const nextOption = LIBRARY_TABS[nextIndex];
    setSelectedOption(nextOption);
    document.getElementById(`${tabId}-${nextOption}`)?.focus();
  };

  const headings = {
    Image: 'Image Library',
    Audio: 'Audio Library',
    Video: 'Video Library',
  };

  const panelSurface = colorMode === 'dark'
    ? 'border border-[#3a4050] bg-[#0c0d12] text-slate-100'
    : 'border border-slate-200 bg-slate-50 text-slate-900';
  const toolbarSurface = colorMode === 'dark'
    ? 'border-b border-[#3a4050] bg-[#151720]/95'
    : 'border-b border-slate-200 bg-white/95';
  const backButtonSurface = colorMode === 'dark'
    ? 'border border-[#4a5265] bg-[#20232e] text-slate-100 hover:bg-[#292d3a]'
    : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-100';
  const inactiveTabSurface = colorMode === 'dark'
    ? 'border border-[#3a4050] bg-[#181b24] text-slate-300 hover:bg-[#292d3a]'
    : 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-100';
  const activeTabSurface = colorMode === 'dark'
    ? 'border border-[#f6c453]/60 bg-[#f6c453] text-[#0c0d12] shadow-[0_8px_20px_rgba(246,196,83,0.2)]'
    : 'border border-sky-300 bg-gradient-to-r from-sky-500 via-blue-500 to-indigo-500 text-white shadow';
  const mutedText = colorMode === 'dark' ? 'text-slate-400' : 'text-slate-500';
  const loadingOverlay = colorMode === 'dark'
    ? 'bg-black bg-opacity-50 text-white'
    : 'bg-slate-100/75 text-slate-700';

  return (
    <div
      className={`library-home relative flex h-full w-full min-h-0 min-w-0 flex-col overflow-hidden rounded-[28px] ${panelSurface}`}
      style={{ '--studio-library-aspect-ratio': projectAspectRatio }}
    >
      <div className={`shrink-0 px-3 py-3 ${toolbarSurface}`}>
        <div className="flex min-w-0 flex-wrap items-center gap-3">
          <div className="flex min-w-0 shrink-0 items-center gap-3">
            <button
              type="button"
              onClick={handleBack}
              className={`inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold transition ${backButtonSurface}`}
            >
              <FaChevronCircleLeft className="text-base" />
              Back
            </button>

            <div className="min-w-0">
              <div className="text-lg font-semibold">Library</div>
              <div className={`text-xs ${mutedText}`}>
                {headings[selectedOption]}
              </div>
            </div>
          </div>

          <div role="tablist" aria-label="Session library" className="flex min-w-0 flex-wrap items-center gap-2">
            {LIBRARY_TABS.map((option) => (
              <button
                key={option}
                type="button"
                role="tab"
                id={`${tabId}-${option}`}
                aria-selected={selectedOption === option}
                aria-controls={`${tabId}-panel`}
                tabIndex={selectedOption === option ? 0 : -1}
                onClick={() => setSelectedOption(option)}
                onKeyDown={(event) => handleTabKeyDown(event, option)}
                className={`shrink-0 rounded-full px-4 py-2 text-sm font-semibold transition ${
                  selectedOption === option ? activeTabSurface : inactiveTabSurface
                }`}
              >
                {option}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div
        id={`${tabId}-panel`}
        role="tabpanel"
        aria-labelledby={`${tabId}-${selectedOption}`}
        className="relative min-h-0 min-w-0 flex-1 overflow-hidden"
      >
        {renderContent()}

        {isLoading && (
          <div role="status" aria-label="Adding library item" className={`absolute inset-0 z-50 flex items-center justify-center opacity-70 ${loadingOverlay}`}>
            <FaSpinner className="text-4xl animate-spin" />
          </div>
        )}
      </div>
    </div>
  );
}
