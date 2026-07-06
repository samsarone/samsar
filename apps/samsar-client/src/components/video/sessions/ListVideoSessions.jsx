import { useEffect, useState } from 'react';
import axios from 'axios';
import { getHeaders } from '../../../utils/web';
import { useNavigate } from 'react-router-dom';
import { FaTimes } from 'react-icons/fa';
import OverflowContainer from '../../common/OverflowContainer.tsx';
import ShowNewUserIntroDisplay from './ShowNewUserIntroDisplay';
import { useColorMode } from '../../../contexts/ColorMode.jsx';
import { useAlertDialog } from '../../../contexts/AlertDialogContext.jsx';

import SingleSelect from '../../common/SingleSelect'; // adjust path as needed

const PROCESSOR_API = import.meta.env.VITE_PROCESSOR_API;

// Options for the filters
const renderTypeOptions = [
  { value: 'All', label: 'All' },
  { value: 'Rendered', label: 'Rendered' },
  { value: 'Pending', label: 'Pending' },
];

const aspectRatioOptions = [
  { value: 'All', label: 'All' },
  { value: '16:9', label: '16:9' },
  { value: '9:16', label: '9:16' },
  { value: '1:1', label: '1:1' },
];

const normalizeSessionText = (value) => (
  typeof value === 'string' ? value.trim() : ''
);

const truncateSessionDescription = (value, maxLength = 110) => {
  const normalized = normalizeSessionText(value);
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength).trimEnd()}...`;
};

const firstNonEmptyString = (values = []) => (
  values.find((value) => typeof value === 'string' && value.trim()) || ''
);

const isAbsolutePreviewUrl = (value) => (
  typeof value === 'string' && /^(https?:|data:|blob:)/i.test(value.trim())
);

const getRawSessionPreviewImage = (session = {}) => (
  firstNonEmptyString([
    session.thumbnailUrl,
    session.thumbnailURL,
    session.previewImageUrl,
    session.previewImageURL,
    session.previewImage,
    session.thumbnail,
  ])
);

const resolveSessionPreviewImage = (session = {}, colorMode = 'dark', forcePlaceholder = false) => {
  const previewImage = getRawSessionPreviewImage(session);

  if (forcePlaceholder || !previewImage) {
    return {
      src: '',
      isPlaceholder: true,
    };
  }

  const trimmedPreviewImage = previewImage.trim();
  if (isAbsolutePreviewUrl(trimmedPreviewImage)) {
    return {
      src: trimmedPreviewImage,
      isPlaceholder: false,
    };
  }

  if (trimmedPreviewImage.startsWith('//')) {
    return {
      src: `https:${trimmedPreviewImage}`,
      isPlaceholder: false,
    };
  }

  const normalizedPath = trimmedPreviewImage.startsWith('/')
    ? trimmedPreviewImage
    : `/${trimmedPreviewImage}`;
  const processorBaseUrl = typeof PROCESSOR_API === 'string'
    ? PROCESSOR_API.trim().replace(/\/+$/, '')
    : '';

  return {
    src: processorBaseUrl ? `${processorBaseUrl}${normalizedPath}` : normalizedPath,
    isPlaceholder: false,
  };
};

function DeleteVideoSessionDialog({ session, onDeleted, onClose, colorMode }) {
  const [deleteArtifacts, setDeleteArtifacts] = useState(true);
  const [isDeleting, setIsDeleting] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  const sessionIdentifier = session?.id ?? session?._id;
  const sessionName = normalizeSessionText(session?.sessionName) || session?.name || 'this session';
  const dialogTextClass = colorMode === 'dark' ? 'text-slate-200' : 'text-slate-700';
  const subtleTextClass = colorMode === 'dark' ? 'text-slate-400' : 'text-slate-500';
  const checkboxClass = colorMode === 'dark'
    ? 'border-slate-600 bg-slate-900 text-rose-500'
    : 'border-slate-300 bg-white text-rose-600';
  const secondaryButtonClass = colorMode === 'dark'
    ? 'border border-slate-700 bg-slate-900 text-slate-100 hover:bg-slate-800'
    : 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50';

  const handleConfirmDelete = async () => {
    if (!sessionIdentifier || isDeleting) {
      return;
    }

    setIsDeleting(true);
    setErrorMessage('');

    try {
      await axios.post(
        `${PROCESSOR_API}/video_sessions/delete_session`,
        {
          sessionId: sessionIdentifier.toString(),
          deleteArtifacts,
        },
        getHeaders()
      );
      onDeleted?.(sessionIdentifier.toString());
      onClose?.();
    } catch (error) {
      setErrorMessage(
        error?.response?.data?.error ||
        error?.message ||
        'Unable to delete session.'
      );
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="w-full text-left">
      <div className="pr-8 text-lg font-semibold">Delete session?</div>
      <div className={`mt-2 text-sm leading-5 ${dialogTextClass}`}>
        This will permanently delete {sessionName}.
      </div>

      <label className={`mt-5 flex cursor-pointer items-center gap-3 text-sm ${dialogTextClass}`}>
        <input
          type="checkbox"
          checked={deleteArtifacts}
          onChange={(event) => setDeleteArtifacts(event.target.checked)}
          disabled={isDeleting}
          className={`h-4 w-4 rounded focus:ring-rose-500 ${checkboxClass}`}
        />
        <span>Delete session artifacts</span>
      </label>

      {errorMessage && (
        <div className="mt-4 rounded-md border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {errorMessage}
        </div>
      )}

      <div className="mt-6 flex justify-end gap-3">
        <button
          type="button"
          onClick={onClose}
          disabled={isDeleting}
          className={`min-h-[38px] rounded-md px-4 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${secondaryButtonClass}`}
        >
          No
        </button>
        <button
          type="button"
          onClick={handleConfirmDelete}
          disabled={isDeleting}
          className="min-h-[38px] rounded-md bg-rose-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isDeleting ? 'Deleting' : 'Yes'}
        </button>
      </div>

      <div className={`mt-3 text-xs ${subtleTextClass}`}>
        This action cannot be undone.
      </div>
    </div>
  );
}

export default function ListVideoSessions() {
  const [sessionList, setSessionList] = useState([]);
  const [page, setPage] = useState(1);
  const [limit] = useState(30); // Show 30 items per page by default
  const [totalPages, setTotalPages] = useState(1);
  const [refreshCounter, setRefreshCounter] = useState(0);
  const [failedPreviewKeys, setFailedPreviewKeys] = useState(() => new Set());

  const [renderType, setRenderType] = useState('All');
  const [aspectRatio, setAspectRatio] = useState('All');

  const [, setShowIntroDisplay] = useState(false);

  const navigate = useNavigate();
  const { colorMode } = useColorMode();
  const { openAlertDialog, closeAlertDialog } = useAlertDialog();
  const containerSurface =
    colorMode === 'dark'
      ? 'bg-[#0b1021] text-slate-100'
      : 'bg-[#f7f9fc] text-slate-900';
  const cardSurface =
    colorMode === 'dark'
      ? 'bg-[#0f1629] border border-[#1f2a3d] shadow-[0_14px_36px_rgba(0,0,0,0.35)]'
      : 'bg-white border border-slate-200 shadow-sm';
  const resetButtonClass =
    colorMode === 'dark'
      ? 'bg-rose-500/90 hover:bg-rose-500 text-white'
      : 'bg-rose-500 hover:bg-rose-600 text-white';
  const paginationButtonClass =
    colorMode === 'dark'
      ? 'bg-[#111a2f] hover:bg-[#16213a] text-slate-100 border border-[#1f2a3d]'
      : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-100 shadow-sm';

  // On mount, load defaults from localStorage if present
  useEffect(() => {
    const storedRenderType = localStorage.getItem('defaultSessionSelectRenderType');
    const storedAspectRatio = localStorage.getItem('defaultSessionSelectAspectRatio');
    const storedPage = localStorage.getItem('currentSessionsPage');

    if (storedRenderType) {
      setRenderType(storedRenderType);
    }
    if (storedAspectRatio) {
      setAspectRatio(storedAspectRatio);
    }
    if (storedPage) {
      setPage(parseInt(storedPage, 10));
    }
  }, []);

  // Fetch sessions whenever page, limit, renderType, aspectRatio change
  useEffect(() => {
    // Save current page to localStorage
    localStorage.setItem('currentSessionsPage', page.toString());

    const headers = getHeaders();
    let isCancelled = false;

    axios
      .get(
        `${PROCESSOR_API}/video_sessions/list?page=${page}&limit=${limit}&renderType=${renderType}&aspectRatio=${aspectRatio}`,
        headers
      )
      .then(function (response) {
        if (isCancelled) {
          return;
        }

        // Expecting { data, total, totalPages, currentPage, pageSize } from the server
        const { data, totalPages } = response.data;
        setSessionList(data);
        setTotalPages(totalPages);

        // If no sessions, show your intro display
        if (!data || data.length === 0) {
          setShowIntroDisplay(true);
        } else {
          setShowIntroDisplay(false);
        }
      })
      .catch(() => {
        if (!isCancelled) {
          
        }
      });

    return () => {
      isCancelled = true;
    };
  }, [page, limit, renderType, aspectRatio, refreshCounter]);

  // Handle filter changes
  const handleChangeRenderType = (selectedOption) => {
    const val = selectedOption.value;
    setRenderType(val);
    localStorage.setItem('defaultSessionSelectRenderType', val);
    // Reset page to 1 when filter changes
    setPage(1);
  };

  const handleChangeAspectRatio = (selectedOption) => {
    const val = selectedOption.value;
    setAspectRatio(val);
    localStorage.setItem('defaultSessionSelectAspectRatio', val);
    // Reset page to 1 when filter changes
    setPage(1);
  };

  // Reset everything
  const handleResetFilters = () => {
    setPage(1);
    setRenderType('All');
    setAspectRatio('All');

    localStorage.setItem('currentSessionsPage', '1');
    localStorage.setItem('defaultSessionSelectRenderType', 'All');
    localStorage.setItem('defaultSessionSelectAspectRatio', 'All');
  };

  // Navigation
  const gotoPage = (event, session) => {
    const sessionIdentifier = session?.id ?? session?._id;
    if (!sessionIdentifier) {
      return;
    }

    const newSessionId = sessionIdentifier.toString();
    localStorage.setItem('sessionId', newSessionId);
    localStorage.setItem('videoSessionId', newSessionId);

    if (event?.metaKey || event?.ctrlKey) {
      window.open(`/video/${newSessionId}`, '_blank', 'noopener,noreferrer');
      return;
    }

    navigate(`/video/${newSessionId}`);
  };

  const handleSessionDeleted = (deletedSessionId) => {
    const normalizedDeletedSessionId = deletedSessionId?.toString?.();
    if (!normalizedDeletedSessionId) {
      return;
    }

    setSessionList((currentList) => (
      currentList.filter((session) => {
        const currentSessionId = session?.id ?? session?._id;
        return currentSessionId?.toString?.() !== normalizedDeletedSessionId;
      })
    ));

    if (localStorage.getItem('sessionId') === normalizedDeletedSessionId) {
      localStorage.removeItem('sessionId');
    }
    if (localStorage.getItem('videoSessionId') === normalizedDeletedSessionId) {
      localStorage.removeItem('videoSessionId');
    }

    setRefreshCounter((currentValue) => currentValue + 1);
  };

  const openDeleteSessionDialog = (event, session) => {
    event?.preventDefault?.();
    event?.stopPropagation?.();

    openAlertDialog(
      <DeleteVideoSessionDialog
        session={session}
        onDeleted={handleSessionDeleted}
        onClose={closeAlertDialog}
        colorMode={colorMode}
      />,
      undefined,
      false,
      {
        centerContent: true,
        containerClassName: 'w-full max-w-md',
        hideCloseButton: true,
      }
    );
  };

  const createNewStudioSession = () => {
    const headers = getHeaders();
    const payload = {
      prompts: [],
    };
    axios.post(`${PROCESSOR_API}/video_sessions/create_video_session`, payload, headers).then(function (response) {
      const session = response.data;
      const sessionId = session._id.toString();
      localStorage.setItem('videoSessionId', sessionId);

      navigate(`/video/${session._id}`);
    });

  };



  const createNewVidGPTSession = () => {
    const headers = getHeaders();
    const payload = {
      prompts: [],
    };
    axios.post(`${PROCESSOR_API}/video_sessions/create_video_session`, payload, headers).then(function (response) {
      const session = response.data;
      const sessionId = session._id.toString();
      localStorage.setItem('videoSessionId', sessionId);

      navigate(`/vidgenie/${session._id}`);
    });

  };

  const createNewAdVideoSession = () => {
    const headers = getHeaders();
    const payload = {
      prompts: [],
    };
    axios.post(`${PROCESSOR_API}/video_sessions/create_video_session`, payload, headers).then(function (response) {
      const session = response.data;
      const sessionId = session._id.toString();
      localStorage.setItem('videoSessionId', sessionId);
      navigate(`/adcreator/${session._id}`);
    });
  };

  const handleImportClick = () => {
    // ... your existing code ...
  };

  // Pagination handlers
  const handlePrevPage = () => {
    if (page > 1) {
      setPage((prev) => prev - 1);
    }
  };

  const handleNextPage = () => {
    if (page < totalPages) {
      setPage((prev) => prev + 1);
    }
  };

  const getSessionKey = (session, index) => (
    (session?.id ?? session?._id ?? `session-${index}`).toString()
  );

  const handleSessionPreviewImageError = (sessionKey) => {
    if (!sessionKey) {
      return;
    }

    setFailedPreviewKeys((currentKeys) => {
      if (currentKeys.has(sessionKey)) {
        return currentKeys;
      }
      const nextKeys = new Set(currentKeys);
      nextKeys.add(sessionKey);
      return nextKeys;
    });
  };

  // If sessionList is null or undefined, return nothing
  if (!sessionList) return null;

  // Projects label
  let projectsLabelDisplay = null;
  if (sessionList.length > 0) {
    projectsLabelDisplay = (
      <div className="mx-auto mb-3 w-full max-w-[1600px] text-left text-lg font-bold">
        My Projects
      </div>
    );
  } else {
    projectsLabelDisplay = (
      <div className="mx-auto mb-3 w-full max-w-[1600px] text-left text-lg font-bold">
        Looks like you don't have any projects yet. Get started by creating a new project.
      </div>
    );
  }

  return (
    <OverflowContainer>
      <div className={`min-h-screen w-full px-4 pb-12 pt-20 sm:px-6 lg:px-8 ${containerSurface}`}>
        {/* Top Section: Filters + Reset + Pagination controls */}
        <div className="mx-auto mb-6 flex w-full max-w-[1600px] flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          {/* Filters */}
          <div className="grid w-full grid-cols-1 gap-3 sm:grid-cols-[minmax(0,220px)_minmax(0,220px)_auto] lg:w-auto">
            {/* Render Type Filter */}
            <div className="min-w-0">
              <SingleSelect
                options={renderTypeOptions}
                value={renderTypeOptions.find((o) => o.value === renderType)}
                onChange={handleChangeRenderType}
                classNamePrefix="renderTypeSelect"
                isSearchable={false}
              />
            </div>

            {/* Aspect Ratio Filter */}
            <div className="min-w-0">
              <SingleSelect
                options={aspectRatioOptions}
                value={aspectRatioOptions.find((o) => o.value === aspectRatio)}
                onChange={handleChangeAspectRatio}
                classNamePrefix="aspectRatioSelect"
                isSearchable={false}
              />
            </div>

            {/* Reset Button */}
            <button
              onClick={handleResetFilters}
              className={`min-h-[40px] rounded-md px-4 py-2 text-sm font-medium transition-colors duration-150 ${resetButtonClass}`}
            >
              Reset
            </button>
          </div>

          {/* Pagination controls */}
          <div className="flex flex-wrap items-center justify-center gap-3 text-sm">
            <button
              onClick={handlePrevPage}
              disabled={page <= 1}
              className={`min-h-[40px] rounded-md px-4 py-2 font-medium transition-all duration-150 disabled:cursor-not-allowed disabled:opacity-50 ${paginationButtonClass}`}
            >
              Prev
            </button>
            <span className="min-w-[96px] text-center">
              Page {page} of {totalPages}
            </span>
            <button
              onClick={handleNextPage}
              disabled={page >= totalPages}
              className={`min-h-[40px] rounded-md px-4 py-2 font-medium transition-all duration-150 disabled:cursor-not-allowed disabled:opacity-50 ${paginationButtonClass}`}
            >
              Next
            </button>
          </div>
        </div>

        {/* Projects label */}
        {projectsLabelDisplay}

        {/* Sessions grid */}
        <div className="mx-auto grid w-full max-w-[1600px] grid-cols-[repeat(auto-fit,minmax(min(100%,260px),1fr))] gap-4 sm:gap-5 lg:gap-6">
          {sessionList.map((session, index) => {
            if (!session) return null;
            const sessionKey = getSessionKey(session, index);
            const rawPreviewImage = getRawSessionPreviewImage(session);
            const sessionPreviewKey = `${sessionKey}:${rawPreviewImage || 'missing'}`;
            const sessionName = normalizeSessionText(session.sessionName);
            const sessionDescription = normalizeSessionText(session.sessionDescription);
            const sessionDisplayName = sessionName || session.name;
            const sessionDisplayDescription = truncateSessionDescription(sessionDescription);
            const sessionPreview = resolveSessionPreviewImage(
              session,
              colorMode,
              failedPreviewKeys.has(sessionPreviewKey)
            );
            const isExpressSession = Boolean(session.isExpressGeneration);
            const isImportedSession = Boolean(session.isImportedSession);

            return (
              <div
                key={sessionKey}
                className={`group relative min-w-0 cursor-pointer overflow-hidden rounded-lg ${cardSurface} transition-transform duration-200 hover:-translate-y-1`}
                onClick={(event) => gotoPage(event, session)}
              >
                {!isImportedSession && (
                  <button
                    type="button"
                    aria-label="Delete session"
                    title="Delete session"
                    onClick={(event) => openDeleteSessionDialog(event, session)}
                    className={`absolute right-2 top-2 z-10 flex h-7 w-7 items-center justify-center rounded-full text-xs transition-colors ${
                      colorMode === 'dark'
                        ? 'bg-slate-950/80 text-slate-300 hover:bg-rose-500 hover:text-white'
                        : 'bg-white/90 text-slate-500 shadow-sm hover:bg-rose-500 hover:text-white'
                    }`}
                  >
                    <FaTimes />
                  </button>
                )}
                <div className="flex min-h-[54px] items-start justify-between gap-2 px-4 py-3 pr-11">
                  <div className="min-w-0 flex-1 text-left">
                    <div className="text-sm font-semibold leading-5">
                      {sessionDisplayName}
                    </div>
                    {sessionDisplayDescription && (
                      <div
                        className="mt-1 text-xs font-normal leading-4 text-slate-500"
                        title={sessionDescription}
                      >
                        {sessionDisplayDescription}
                      </div>
                    )}
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    {isImportedSession && (
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                          colorMode === 'dark'
                            ? 'bg-emerald-400/12 text-emerald-200 ring-1 ring-emerald-300/25'
                            : 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200'
                        }`}
                      >
                        Imported
                      </span>
                    )}
                    {isExpressSession && (
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                          colorMode === 'dark'
                            ? 'bg-cyan-400/12 text-cyan-200 ring-1 ring-cyan-300/25'
                            : 'bg-cyan-50 text-cyan-700 ring-1 ring-cyan-200'
                        }`}
                      >
                        Express
                      </span>
                    )}
                  </div>
                </div>
                <div className="relative aspect-[16/10] w-full overflow-hidden bg-slate-100 dark:bg-slate-900">
                  {!sessionPreview.isPlaceholder && sessionPreview.src && (
                    <img
                      src={sessionPreview.src}
                      onError={() => handleSessionPreviewImageError(sessionPreviewKey)}
                      className="h-full w-full object-cover"
                      alt={`Session ${index + 1}`}
                    />
                  )}
                  {sessionPreview.isPlaceholder && (
                    <div className="pointer-events-none absolute inset-x-0 top-[calc(50%+1.25rem)] z-[1] flex justify-center px-4">
                      <span
                        className={`rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] ${
                          colorMode === 'dark'
                            ? 'bg-slate-950/55 text-slate-200 ring-1 ring-white/10'
                            : 'bg-white/75 text-slate-600 ring-1 ring-slate-200/80'
                        }`}
                      >
                        Missing thumbnail
                      </span>
                    </div>
                  )}
                </div>
                <div className="px-4 py-3 text-xs text-slate-500">
                  Tap to open in Studio
                </div>
              </div>
            );
          })}
        </div>

        {/* New user intro / create session */}
        <div className="mx-auto mt-8 w-full max-w-[1600px]">
          <ShowNewUserIntroDisplay
            createNewStudioSession={createNewStudioSession}
            createNewVidGPTSession={createNewVidGPTSession}
            createNewAdVideoSession={createNewAdVideoSession}
            handleImportClick={handleImportClick}
          />
        </div>
      </div>
    </OverflowContainer>
  );
}
