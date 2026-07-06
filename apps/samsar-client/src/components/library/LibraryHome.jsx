import { useState } from 'react';
import ImageLibraryHome from './image/ImageLibraryHome';
import MusicLibraryHome from './audio/MusicLibraryHome';
import SceneLibraryHome from './aivideo/SceneLibraryHome';
import VideoLibraryHome from './video/VideoLibraryHome';
import GenerationsGalleryPanel from '../generations/GenerationsGalleryPanel.jsx';
import { FaChevronCircleLeft, FaSpinner } from 'react-icons/fa';
import { useColorMode } from '../../contexts/ColorMode';
import './library.css';

const LIBRARY_TABS = ['Generations', 'Image', 'Audio', 'Video', 'Scenes'];

export default function LibraryHome(props) {
  const { resetImageLibrary, onSelectVideo, isSelectButtonDisabled } = props;
  const [selectedOption, setSelectedOption] = useState('Generations');
  const { colorMode } = useColorMode();

  const isLoading = isSelectButtonDisabled;

  const renderContent = () => {
    switch (selectedOption) {
      case 'Generations':
        return (
          <GenerationsGalleryPanel
            embedded
            title="Generations"
            subtitle="A panorama wall of image and video generations. Video tiles stay on preview clips until you open the render."
            onSelectImage={props.selectImageFromLibrary}
            onSelectVideo={onSelectVideo}
            isSelectButtonDisabled={isSelectButtonDisabled}
          />
        );
      case 'Image':
        return <ImageLibraryHome {...props} />;
      case 'Audio':
        return <MusicLibraryHome {...props} />;
      case 'Video':
        return <VideoLibraryHome {...props} onSelectVideo={onSelectVideo} />;
      case 'Scenes':
        return <SceneLibraryHome {...props} onSelectVideo={onSelectVideo} />;
      default:
        return null;
    }
  };

  const handleBack = () => {
    resetImageLibrary();
  };

  const headings = {
    Generations: 'Global Generations',
    Image: 'Image Library',
    Audio: 'Audio Library',
    Video: 'Video Library',
    Scenes: 'Scene Library',
  };

  const panelSurface = colorMode === 'dark'
    ? 'border border-[#1f2a3d] bg-[#07101f] text-slate-100'
    : 'border border-slate-200 bg-slate-50 text-slate-900';
  const toolbarSurface = colorMode === 'dark'
    ? 'border-b border-[#1f2a3d] bg-[#0b1224]/95'
    : 'border-b border-slate-200 bg-white/95';
  const backButtonSurface = colorMode === 'dark'
    ? 'border border-[#31405e] bg-[#111a2f] text-slate-100 hover:bg-[#16213a]'
    : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-100';
  const inactiveTabSurface = colorMode === 'dark'
    ? 'border border-[#1f2a3d] bg-[#0f1629] text-slate-300 hover:bg-[#16213a]'
    : 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-100';
  const activeTabSurface = colorMode === 'dark'
    ? 'border border-cyan-400/30 bg-gradient-to-r from-cyan-500 via-sky-500 to-indigo-500 text-white shadow-lg shadow-cyan-500/20'
    : 'border border-sky-300 bg-gradient-to-r from-sky-500 via-blue-500 to-indigo-500 text-white shadow';
  const mutedText = colorMode === 'dark' ? 'text-slate-400' : 'text-slate-500';
  const loadingOverlay = colorMode === 'dark'
    ? 'bg-black bg-opacity-50 text-white'
    : 'bg-slate-100/75 text-slate-700';

  return (
    <div className={`library-home mt-[60px] flex h-full min-h-0 flex-col overflow-hidden rounded-[28px] ${panelSurface}`}>
      <div className={`sticky top-0 z-30 px-3 py-3 backdrop-blur ${toolbarSurface}`}>
        <div className="flex min-w-0 items-center gap-3 overflow-hidden">
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

          <div className="ml-auto flex min-w-0 items-center justify-end gap-2 overflow-x-auto whitespace-nowrap pb-1">
            {LIBRARY_TABS.map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setSelectedOption(option)}
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

      <div className="relative min-h-0 flex-1">
        {renderContent()}

        {isLoading && (
          <div className={`fixed inset-0 z-50 flex items-center justify-center opacity-70 ${loadingOverlay}`}>
            <FaSpinner className="text-4xl animate-spin" />
          </div>
        )}
      </div>
    </div>
  );
}
