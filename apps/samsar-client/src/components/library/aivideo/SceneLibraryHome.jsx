import { useEffect, useState, useRef } from 'react';
import axios from 'axios';
import { FaPlay, FaPause, FaDownload } from 'react-icons/fa';
import { useColorMode } from '../../../contexts/ColorMode';
import { getHeaders } from '../../../utils/web'; // Adjust the path as needed

const API_SERVER = import.meta.env.VITE_PROCESSOR_API;

function resolveMediaUrl(value) {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmedValue = value.trim();
  if (!trimmedValue) {
    return null;
  }

  if (/^https?:\/\//i.test(trimmedValue)) {
    return trimmedValue;
  }

  return `${API_SERVER}${trimmedValue.startsWith('/') ? trimmedValue : `/${trimmedValue}`}`;
}

export default function SceneLibraryHome(props) {
  const { hideSelectButton, onSelectVideo, isSelectButtonDisabled } = props;
  const [libraryData, setLibraryData] = useState([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [searchTerm, setSearchTerm] = useState('');
  const [playingVideoId, setPlayingVideoId] = useState(null);
  const [trimScenes, setTrimScenes] = useState({}); // track trim checkbox
  const videoRefs = useRef({});

  const { colorMode } = useColorMode();
  const itemsPerPage = 12; // Adjust as needed

  // Palette aligned with account page styling
  const textColor = colorMode === 'dark' ? 'text-slate-100' : 'text-slate-900';
  const borderColor = colorMode === 'dark' ? 'border-[#1f2a3d]' : 'border-slate-200';
  const cardBg = colorMode === 'dark' ? 'bg-[#0f1629]' : 'bg-white';
  const headerBg = colorMode === 'dark' ? 'bg-[#0b1224]' : 'bg-slate-50';
  const mutedText = colorMode === 'dark' ? 'text-slate-400' : 'text-slate-600';
  const surfaceButton = colorMode === 'dark'
    ? 'bg-[#0b1224] hover:bg-[#0f1629]'
    : 'bg-white hover:bg-slate-100';
  const iconColor = colorMode === 'dark' ? 'text-slate-100' : 'text-slate-800';
  const selectButtonGradient = 'bg-gradient-to-r from-blue-500 to-blue-600 text-white hover:opacity-90';

  useEffect(() => {
    fetchLibraryData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPage, searchTerm]);

  const fetchLibraryData = async () => {
    const headers = getHeaders();
    try {
      const response = await axios.get(
        `${API_SERVER}/ai_video/user_video_library?page=${currentPage}&limit=${itemsPerPage}&search=${encodeURIComponent(
          searchTerm
        )}`,
        headers
      );
      const data = response.data.items;
      setLibraryData(data);
      setTotalPages(response.data.totalPages);
    } catch  {
      
    }
  };

  const handleSearchChange = (e) => {
    setSearchTerm(e.target.value);
    setCurrentPage(1);
  };

  const handlePrevPage = () => {
    setCurrentPage((prev) => Math.max(prev - 1, 1));
  };

  const handleNextPage = () => {
    setCurrentPage((prev) => Math.min(prev + 1, totalPages));
  };

  const handlePlayPause = (videoId) => {
    if (playingVideoId === videoId) {
      const currentVideo = videoRefs.current[videoId];
      if (currentVideo?.pause) {
        currentVideo.pause();
        currentVideo.currentTime = 0;
      }
      setPlayingVideoId(null);
    } else {
      if (playingVideoId && videoRefs.current[playingVideoId]) {
        videoRefs.current[playingVideoId].pause();
        videoRefs.current[playingVideoId].currentTime = 0;
      }
      setPlayingVideoId(videoId);
    }
  };

  const handleDownload = (item) => {
    const link = document.createElement('a');
    link.href = resolveMediaUrl(item?.url) || '';
    link.download = `${item.description || 'Video'}.mp4`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleSelect = (item) => {
    if (onSelectVideo) {
      const payload = {
        video: item,
        trimScene: trimScenes[item._id] || false,
      };
      onSelectVideo(payload);
    }
  };

  const handleTrimChange = (videoId) => {
    setTrimScenes((prev) => ({
      ...prev,
      [videoId]: !prev[videoId],
    }));
  };

  return (
    <div className={`min-w-0 space-y-4 ${textColor}`}>
      {/* Top Toolbar */}
      <div className={`flex flex-col gap-3 rounded-lg border ${borderColor} ${cardBg} p-3 shadow-sm sm:p-4 lg:flex-row lg:items-center lg:justify-between`}>
        <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
          <div className={`flex min-w-0 items-center rounded-lg border overflow-hidden ${borderColor}`}>
            <button
              onClick={handlePrevPage}
              disabled={currentPage === 1}
              className={`shrink-0 px-3 py-2 text-sm font-semibold border-r ${borderColor} ${surfaceButton} disabled:opacity-50 disabled:cursor-not-allowed`}
            >
              Prev
            </button>
            <span className={`min-w-0 flex-1 px-3 py-2 text-center text-sm sm:flex-none sm:px-4 ${headerBg}`}>
              Page {currentPage} of {totalPages}
            </span>
            <button
              onClick={handleNextPage}
              disabled={currentPage === totalPages}
              className={`shrink-0 px-3 py-2 text-sm font-semibold border-l ${borderColor} ${surfaceButton} disabled:opacity-50 disabled:cursor-not-allowed`}
            >
              Next
            </button>
          </div>

          <input
            type="text"
            placeholder="Search"
            value={searchTerm}
            onChange={handleSearchChange}
            className={`w-full px-3 py-2 text-sm rounded-lg border sm:w-64 ${borderColor} ${surfaceButton} focus:outline-none`}
          />
        </div>
      </div>

      {/* Grid Display */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
        {libraryData.map((item) => (
          <div key={item._id} className={`min-w-0 rounded-lg border ${borderColor} ${cardBg} p-3 shadow-sm sm:p-4`}>
            <div className="relative">
              {playingVideoId === item._id ? (
                <video
                  ref={(el) => {
                    videoRefs.current[item._id] = el;
                  }}
                  src={resolveMediaUrl(item?.url) || undefined}
                  poster={resolveMediaUrl(item?.thumbnailPath) || undefined}
                  className="w-full h-48 object-cover rounded-lg cursor-pointer"
                  controls
                  autoPlay
                  playsInline
                  preload="metadata"
                  onEnded={() => setPlayingVideoId(null)}
                />
              ) : item?.thumbnailVideoPath || item?.thumbnailVideoRemoteUrl ? (
                <video
                  src={resolveMediaUrl(item?.thumbnailVideoPath || item?.thumbnailVideoRemoteUrl) || undefined}
                  poster={resolveMediaUrl(item?.thumbnailPath) || undefined}
                  className="w-full h-48 object-cover rounded-lg cursor-pointer"
                  muted
                  autoPlay
                  loop
                  playsInline
                  preload="metadata"
                  onClick={() => handlePlayPause(item._id)}
                />
              ) : item?.thumbnailPath ? (
                <img
                  src={resolveMediaUrl(item.thumbnailPath) || ''}
                  alt={item.description || 'Video preview'}
                  className="w-full h-48 object-cover rounded-lg cursor-pointer"
                  onClick={() => handlePlayPause(item._id)}
                />
              ) : (
                <button
                  type="button"
                  className="flex h-48 w-full items-center justify-center rounded-lg bg-slate-950/70 text-sm text-slate-200"
                  onClick={() => handlePlayPause(item._id)}
                >
                  Preview unavailable
                </button>
              )}
              <button
                className={`absolute bottom-2 right-2 px-3 py-2 rounded-full border ${borderColor} ${surfaceButton}`}
                onClick={() => handlePlayPause(item._id)}
              >
                {playingVideoId === item._id ? (
                  <FaPause className={iconColor} />
                ) : (
                  <FaPlay className={iconColor} />
                )}
              </button>
            </div>
            {/* Description */}
            <h2 className="mt-3 break-words text-lg font-semibold">
              {item.description || 'No Description'}
            </h2>
            {/* Model and Prompt */}
            <p className={`break-words text-sm ${mutedText}`}>
              Model: {item.model || 'Unknown'}
            </p>
            <p className={`break-words text-sm ${mutedText}`}>
              Prompt: {item.prompt || 'No Prompt'}
            </p>

            {/* Download and Select Buttons */}
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
              <button
                className={`px-3 py-2 rounded-lg border ${borderColor} ${surfaceButton}`}
                onClick={() => handleDownload(item)}
              >
                <FaDownload className={iconColor} />
              </button>

              {!hideSelectButton && (
                <div className="flex items-center gap-2">
                  <label className="text-xs flex items-center gap-1">
                    <input
                      type="checkbox"
                      checked={trimScenes[item._id] || false}
                      onChange={() => handleTrimChange(item._id)}
                      className="h-4 w-4 accent-blue-500"
                    />
                    Trim
                  </label>
                  <button
                    className={`${selectButtonGradient} px-4 py-2 rounded-lg font-semibold shadow`}
                    onClick={() => handleSelect(item)}
                    disabled={isSelectButtonDisabled}
                  >
                    Select
                  </button>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
