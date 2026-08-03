import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { FaPlus, FaStar, FaTimes } from 'react-icons/fa';
import { useColorMode } from '../../contexts/ColorMode.jsx';
import { MdExplore, MdCreateNewFolder } from 'react-icons/md';
import SingleSelect from './SingleSelect.jsx';
import {
  aspectRatioOptions as defaultAspectRatioOptions,
  findClosestAspectRatioOption,
  getCanvasDimensionsForAspectRatio,
  getSimplifiedAspectRatioLabel,
  MAX_CANVAS_DIMENSION,
  MIN_CANVAS_DIMENSION,
} from '../../utils/canvas.jsx';
import { useLocalization } from '../../contexts/LocalizationContext.jsx';

const CUSTOM_CANVAS_OPTION_VALUE = '__custom_canvas__';
const NEXT_VIDEO_SESSION_INDEX_STORAGE_KEY = 'nextVideoSessionIndex';
const FRIENDLY_PROJECT_PREFIXES = [
  'Sunlit',
  'Velvet',
  'Golden',
  'Bright',
  'Mellow',
  'Lucky',
  'Clever',
  'Curious',
  'Lively',
  'Calm',
];
const FRIENDLY_PROJECT_SUFFIXES = [
  'Canvas',
  'Studio',
  'Sketch',
  'Scene',
  'Draft',
  'Board',
  'Frame',
  'Moment',
  'Spark',
  'Vista',
];

const getRandomFriendlyProjectName = () => {
  const prefix = FRIENDLY_PROJECT_PREFIXES[Math.floor(Math.random() * FRIENDLY_PROJECT_PREFIXES.length)];
  const suffix = FRIENDLY_PROJECT_SUFFIXES[Math.floor(Math.random() * FRIENDLY_PROJECT_SUFFIXES.length)];
  return `${prefix} ${suffix}`;
};

const getStoredVideoSessionIndex = () => {
  if (typeof window === 'undefined') {
    return 1;
  }

  const storedIndex = Number.parseInt(
    window.localStorage.getItem(NEXT_VIDEO_SESSION_INDEX_STORAGE_KEY) || '',
    10
  );
  return Number.isFinite(storedIndex) && storedIndex > 0 ? storedIndex : 1;
};

function AddSessionDropdown(props) {
  const {
    createNewSession,
    gotoViewSessionsPage,
    addNewVidGPTSession,
    aspectRatioOptions = defaultAspectRatioOptions,
    aspectRatioStorageKey = 'defaultAspectRatio',
    switchEditorLabel,
    onSwitchEditor,
    additionalEditorActions = [],
    showStudioOption = true,
    showVideoOptions = true,
    useImageProjectModal = false,
    compact = false,
  } = props;

  const [aspectRatio, setAspectRatio] = useState(aspectRatioOptions[0] || { value: '1:1', label: '1:1' });

  useEffect(() => {
    const defaultAspectRatio = localStorage.getItem(aspectRatioStorageKey);
    const fallbackAspectRatio = aspectRatioOptions[0] || { value: '1:1', label: '1:1' };

    if (defaultAspectRatio) {
      const selectedAspectRatio = aspectRatioOptions.find((option) => option.value === defaultAspectRatio);
      if (selectedAspectRatio) {
        setAspectRatio(selectedAspectRatio);
        return;
      }
    }
    setAspectRatio(fallbackAspectRatio);
  }, [aspectRatioOptions, aspectRatioStorageKey]);

  const { colorMode } = useColorMode();
  const { t } = useLocalization();
  const [isOpen, setIsOpen] = useState(false);
  const [isProjectModalOpen, setIsProjectModalOpen] = useState(false);
  const [sessionIndex, setSessionIndex] = useState(getStoredVideoSessionIndex);
  const [sessionName, setSessionName] = useState('');
  const [sessionDescription, setSessionDescription] = useState('');
  const [addBackgroundLayer, setAddBackgroundLayer] = useState(false);
  const [backgroundLayerColor, setBackgroundLayerColor] = useState('#ffffff');
  const [projectCanvasOption, setProjectCanvasOption] = useState(aspectRatioOptions[0] || { value: '1:1', label: '1:1' });
  const [customCanvasWidth, setCustomCanvasWidth] = useState('');
  const [customCanvasHeight, setCustomCanvasHeight] = useState('');

  const bgColor = colorMode === 'dark'
    ? 'border border-[#667188] bg-[#20232e] hover:border-[#ff4655]/60 hover:bg-[#292d3a] focus-visible:ring-2 focus-visible:ring-[#ffe0a3]/70'
    : 'bg-neutral-200 hover:bg-neutral-300 focus-visible:ring-2 focus-visible:ring-blue-400/50';
  const textColor = colorMode === 'dark' ? 'text-neutral-100' : 'text-neutral-700';
  const menuItemSurface = colorMode === 'dark'
    ? 'text-slate-200 hover:bg-[#292d3a] focus-visible:bg-[#292d3a]'
    : 'text-slate-700 hover:bg-slate-100 focus-visible:bg-slate-100';
  const menuSurface = colorMode === 'dark'
    ? 'bg-[#181b24]/98 ring-1 ring-[#3a4050] shadow-[0_18px_42px_rgba(0,0,0,0.38)] backdrop-blur-xl'
    : 'bg-white ring-1 ring-slate-200';
  const modalSurface = colorMode === 'dark'
    ? 'bg-[#181b24] text-slate-100'
    : 'bg-white text-slate-900';
  const modalInputSurface = colorMode === 'dark'
    ? 'bg-[#151720] border-[#667188] text-slate-100 placeholder-slate-400 focus:border-[#f6c453] focus:ring-[#f6c453]/24'
    : 'bg-white border-slate-300 text-slate-900 placeholder-slate-500 focus:border-blue-500 focus:ring-blue-500/30';
  const modalSecondaryButton = colorMode === 'dark'
    ? 'border border-[#667188] bg-[#20232e] text-slate-100 hover:border-[#ff4655]/60 hover:bg-[#292d3a] hover:shadow-[0_8px_20px_rgba(255,70,85,0.14)]'
    : 'bg-slate-100 text-slate-800 hover:bg-white';
  const modalPrimaryButton = colorMode === 'dark'
    ? 'bg-gradient-to-r from-[#ff4655] to-[#ff6b4a] text-[#080a10] hover:from-[#ff6572] hover:to-[#ff8066] hover:shadow-[0_10px_26px_rgba(255,70,85,0.22)]'
    : 'bg-rose-500 text-white hover:bg-rose-600';
  const triggerShadow = colorMode === 'dark' ? 'shadow-[0_8px_18px_rgba(3,12,28,0.18)]' : '';

  const selectedAspectRatio = aspectRatio?.value || aspectRatioOptions?.[0]?.value || '1:1';
  const selectedCanvasDimensions = useMemo(
    () => getCanvasDimensionsForAspectRatio(selectedAspectRatio),
    [selectedAspectRatio]
  );

  const aspectRatioOptionsWithResolution = useMemo(() => (
    aspectRatioOptions.map((option) => {
      const dimensions = getCanvasDimensionsForAspectRatio(option.value);
      return {
        ...option,
        label: `${option.label} - ${dimensions.width} x ${dimensions.height}`,
      };
    })
  ), [aspectRatioOptions]);

  const selectedAspectRatioOptionWithResolution = useMemo(() => (
    aspectRatioOptionsWithResolution.find((option) => option.value === selectedAspectRatio)
      || aspectRatioOptionsWithResolution[0]
      || null
  ), [aspectRatioOptionsWithResolution, selectedAspectRatio]);

  const projectCanvasOptions = useMemo(
    () => [
      ...aspectRatioOptionsWithResolution,
      { value: CUSTOM_CANVAS_OPTION_VALUE, label: 'Custom' },
    ],
    [aspectRatioOptionsWithResolution]
  );

  const isCustomCanvasSelected = projectCanvasOption?.value === CUSTOM_CANVAS_OPTION_VALUE;

  const projectCanvasDimensions = useMemo(() => {
    if (!isCustomCanvasSelected) {
      return getCanvasDimensionsForAspectRatio(projectCanvasOption?.value || selectedAspectRatio);
    }

    const parsedWidth = Number(customCanvasWidth);
    const parsedHeight = Number(customCanvasHeight);

    return {
      width: Number.isFinite(parsedWidth) && parsedWidth > 0 ? Math.round(parsedWidth) : selectedCanvasDimensions.width,
      height: Number.isFinite(parsedHeight) && parsedHeight > 0 ? Math.round(parsedHeight) : selectedCanvasDimensions.height,
    };
  }, [
    customCanvasHeight,
    customCanvasWidth,
    isCustomCanvasSelected,
    projectCanvasOption,
    selectedAspectRatio,
    selectedCanvasDimensions.height,
    selectedCanvasDimensions.width,
  ]);

  const resolvedProjectGenerationAspectRatio = useMemo(() => {
    if (!isCustomCanvasSelected) {
      return projectCanvasOption?.value || selectedAspectRatio;
    }

    return (
      findClosestAspectRatioOption(projectCanvasDimensions, aspectRatioOptions)?.value ||
      selectedAspectRatio ||
      aspectRatioOptions?.[0]?.value ||
      '1:1'
    );
  }, [
    aspectRatioOptions,
    isCustomCanvasSelected,
    projectCanvasDimensions,
    projectCanvasOption,
    selectedAspectRatio,
  ]);

  const customCanvasValidationMessage = useMemo(() => {
    if (!isCustomCanvasSelected) {
      return null;
    }

    const parsedWidth = Number(customCanvasWidth);
    const parsedHeight = Number(customCanvasHeight);

    if (!Number.isFinite(parsedWidth) || !Number.isFinite(parsedHeight)) {
      return 'Enter both width and height.';
    }

    if (parsedWidth < MIN_CANVAS_DIMENSION || parsedHeight < MIN_CANVAS_DIMENSION) {
      return `Canvas dimensions must be at least ${MIN_CANVAS_DIMENSION}px.`;
    }

    if (parsedWidth > MAX_CANVAS_DIMENSION || parsedHeight > MAX_CANVAS_DIMENSION) {
      return `Canvas dimensions must be ${MAX_CANVAS_DIMENSION}px or smaller.`;
    }

    return null;
  }, [customCanvasHeight, customCanvasWidth, isCustomCanvasSelected]);

  const selectedProjectCanvasOption = useMemo(() => {
    if (isCustomCanvasSelected) {
      return projectCanvasOptions.find((option) => option.value === CUSTOM_CANVAS_OPTION_VALUE) || null;
    }

    return (
      projectCanvasOptions.find((option) => option.value === projectCanvasOption?.value) ||
      selectedAspectRatioOptionWithResolution
    );
  }, [
    isCustomCanvasSelected,
    projectCanvasOption,
    projectCanvasOptions,
    selectedAspectRatioOptionWithResolution,
  ]);

  const toggleDropdown = () => {
    setIsOpen(!isOpen);
  };

  const openProjectModal = () => {
    setIsOpen(false);
    setSessionName(getRandomFriendlyProjectName());
    setSessionDescription('');
    setAddBackgroundLayer(false);
    setBackgroundLayerColor('#ffffff');
    setProjectCanvasOption(selectedAspectRatioOptionWithResolution || aspectRatioOptionsWithResolution[0] || { value: '1:1', label: '1:1' });
    setCustomCanvasWidth(String(selectedCanvasDimensions.width));
    setCustomCanvasHeight(String(selectedCanvasDimensions.height));
    setIsProjectModalOpen(true);
  };

  const openVideoProjectModal = () => {
    setIsOpen(false);
    setSessionName(`Session ${sessionIndex}`);
    setSessionDescription('');
    setIsProjectModalOpen(true);
  };

  const closeProjectModal = () => {
    setIsProjectModalOpen(false);
  };

  const handleDialogBackdropMouseDown = (event) => {
    if (event.target === event.currentTarget) {
      closeProjectModal();
    }
  };

  useEffect(() => {
    if (!isProjectModalOpen) return undefined;
    const handleEscape = (event) => {
      if (event.key === 'Escape') {
        closeProjectModal();
      }
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [isProjectModalOpen]);

  const addNewSession = () => {
    if (useImageProjectModal) {
      if (customCanvasValidationMessage) {
        return;
      }
      const resolvedSessionName = sessionName.trim() || getRandomFriendlyProjectName();

      createNewSession({
        aspectRatio: resolvedProjectGenerationAspectRatio,
        canvasDimensions: projectCanvasDimensions,
        sessionName: resolvedSessionName,
        addBackgroundLayer,
        backgroundLayerColor,
      });
      closeProjectModal();
      return;
    }

    if (isProjectModalOpen) {
      const resolvedSessionName = sessionName.trim();
      const resolvedSessionDescription = sessionDescription.trim();
      createNewSession({
        aspectRatio: selectedAspectRatio,
        ...(resolvedSessionName ? { sessionName: resolvedSessionName } : {}),
        ...(resolvedSessionDescription ? { sessionDescription: resolvedSessionDescription } : {}),
      });
      const nextSessionIndex = sessionIndex + 1;
      setSessionIndex(nextSessionIndex);
      window.localStorage.setItem(
        NEXT_VIDEO_SESSION_INDEX_STORAGE_KEY,
        String(nextSessionIndex)
      );
      closeProjectModal();
      return;
    }

    createNewSession(selectedAspectRatio);
    setIsOpen(false);
  };

  const viewSessions = () => {
    gotoViewSessionsPage();
    setIsOpen(false);
    closeProjectModal();
  };



  const showAddNewVidGPTSession = () => {
    addNewVidGPTSession();
    setIsOpen(false);
  };

  const handleAspectRatioChange = (selectedOption) => {
    if (!selectedOption) return;
    localStorage.setItem(aspectRatioStorageKey, selectedOption.value);
    const selectedAspectRatioOption = aspectRatioOptions.find((option) => option.value === selectedOption.value);
    setAspectRatio(selectedAspectRatioOption || selectedOption);

  };

  const handleProjectCanvasOptionChange = (selectedOption) => {
    if (!selectedOption?.value) return;
    setProjectCanvasOption(selectedOption);

    if (selectedOption.value === CUSTOM_CANVAS_OPTION_VALUE) {
      setCustomCanvasWidth(String(selectedCanvasDimensions.width));
      setCustomCanvasHeight(String(selectedCanvasDimensions.height));
      return;
    }

    const selectedDimensions = getCanvasDimensionsForAspectRatio(selectedOption.value);
    setCustomCanvasWidth(String(selectedDimensions.width));
    setCustomCanvasHeight(String(selectedDimensions.height));
    handleAspectRatioChange(selectedOption);
  };

  const handleSwitchEditor = () => {
    if (onSwitchEditor) {
      onSwitchEditor();
      setIsOpen(false);
      closeProjectModal();
    }
  };

  const handleAdditionalEditorAction = (action) => {
    if (typeof action?.onSelect === 'function') {
      action.onSelect();
      setIsOpen(false);
      closeProjectModal();
    }
  };

  const handleMainButtonClick = () => {
    if (useImageProjectModal) {
      openProjectModal();
      return;
    }
    toggleDropdown();
  };

  const handleCreateSessionSubmit = (event) => {
    event.preventDefault();
    addNewSession();
  };

  return (
    <div className="relative inline-block max-w-full text-left">
      <button
        type="button"
        onClick={handleMainButtonClick}
        title={t("common.newProject")}
        aria-haspopup="dialog"
        aria-expanded={useImageProjectModal ? isProjectModalOpen : isOpen}
        className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-lg py-1.5 text-sm font-semibold transition-all duration-200 ease-out hover:-translate-y-[1px] focus:outline-none sm:min-h-[38px] ${compact ? 'w-11 min-w-11 max-w-11 px-0 sm:w-[38px] sm:min-w-[38px] sm:max-w-[38px]' : 'w-full min-w-[110px] max-w-[144px] px-3'} ${textColor} ${bgColor} ${triggerShadow}`}
      >
        <FaPlus className="shrink-0" />
        <span className={compact ? 'sr-only' : 'truncate text-xs'}>{t("common.newProject")}</span>
      </button>

      {!useImageProjectModal && isOpen && (
        <div className={`absolute right-0 z-[1220] mt-2 min-w-[13rem] max-w-[calc(100vw-1rem)] origin-top-right overflow-hidden rounded-lg
         ${menuSurface}`} >
          <div className="p-1" role="dialog" aria-label={t("common.newProject")}>
            {showStudioOption && (
              <button
                type="button"
                onClick={openVideoProjectModal}
                className={`block w-full rounded-md px-3 py-1.5 text-left text-xs outline-none ${menuItemSurface}`}
              >
                <MdCreateNewFolder className='inline-flex mb-1' /> {t("common.studio")}
              </button>
            )}

            {showVideoOptions && (
              <button
                type="button"
                onClick={showAddNewVidGPTSession}
                className={`block w-full rounded-md px-3 py-1.5 text-left text-xs outline-none ${menuItemSurface}`}
              >
                <FaStar className='inline-flex mb-1' /> {t("common.vidgenie")}
              </button>
            )}

            {switchEditorLabel && onSwitchEditor && (
              <button
                type="button"
                onClick={handleSwitchEditor}
                className={`block w-full rounded-md px-3 py-1.5 text-left text-xs outline-none ${menuItemSurface}`}
              >
                <MdCreateNewFolder className='inline-flex mb-1' /> {switchEditorLabel}
              </button>
            )}

            {additionalEditorActions.map((action) => (
              <button
                key={action.label}
                type="button"
                onClick={() => handleAdditionalEditorAction(action)}
                className={`block w-full rounded-md px-3 py-1.5 text-left text-xs outline-none ${menuItemSurface}`}
              >
                <MdCreateNewFolder className='inline-flex mb-1' /> {action.label}
              </button>
            ))}

            <button
              type="button"
              onClick={viewSessions}
              className={`flex w-full items-center gap-2 whitespace-nowrap rounded-md px-3 py-1.5 text-left text-xs outline-none ${menuItemSurface}`}
            >
              <MdExplore className="shrink-0" />
              <span className="whitespace-nowrap">{t("common.viewProjects")}</span>
            </button>


          </div>
        </div>
      )}

      {isProjectModalOpen && typeof document !== 'undefined' && createPortal(
        <div className="fixed inset-0 z-[11060] overflow-y-auto overscroll-contain">
          <button
            type="button"
            aria-label="Close create project dialog"
            className="fixed inset-0 bg-black/60"
            onClick={closeProjectModal}
          />
          <div
            className="relative z-10 flex min-h-full items-start justify-center p-3 sm:items-center sm:p-4"
            onMouseDown={handleDialogBackdropMouseDown}
          >
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="create-project-dialog-title"
              className={`max-h-[calc(100dvh-1.5rem)] w-full max-w-xl overflow-y-auto overscroll-contain rounded-xl p-4 shadow-[0_20px_46px_rgba(0,0,0,0.5)] sm:max-h-[calc(100dvh-2rem)] sm:p-6 ${modalSurface}`}
            >
              <form onSubmit={handleCreateSessionSubmit}>
                <div className="flex flex-wrap items-center gap-3">
                  <div id="create-project-dialog-title" className="min-w-0 flex-1 text-lg font-semibold">
                    {useImageProjectModal ? 'Create new Image session' : 'Create new session'}
                  </div>
                  {!useImageProjectModal && (
                    <div className="w-[112px] shrink-0" aria-label="Session aspect ratio">
                      <SingleSelect
                        options={aspectRatioOptions}
                        onChange={handleAspectRatioChange}
                        value={aspectRatio}
                        compactLayout
                        isSearchable={false}
                        name="new-session-aspect-ratio"
                        styles={{
                          menuPortal: (provided) => ({ ...provided, zIndex: 11080 }),
                        }}
                      />
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={closeProjectModal}
                    aria-label="Close create project dialog"
                    className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md opacity-75 transition hover:bg-black/10 hover:opacity-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-current dark:hover:bg-white/10"
                  >
                    <FaTimes aria-hidden="true" />
                  </button>
                </div>
              {useImageProjectModal && (
                <div className="mt-1 text-sm opacity-80">
                  Start a new image editing session with your preferred canvas setup.
                </div>
              )}

              <div className="mt-5 space-y-4">
                <div>
                  <label className="block text-sm font-medium mb-2" htmlFor="project-name">
                    {useImageProjectModal ? 'Project name' : 'Session name'}
                  </label>
                  <input
                    id="project-name"
                    type="text"
                    maxLength={120}
                    value={sessionName}
                    onChange={(event) => setSessionName(event.target.value)}
                    placeholder="Untitled project"
                    className={`w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2 ${modalInputSurface}`}
                  />
                </div>

                {!useImageProjectModal && (
                  <div>
                    <label className="block text-sm font-medium mb-2" htmlFor="project-description">
                      Description <span className="opacity-70">(optional)</span>
                    </label>
                    <textarea
                      id="project-description"
                      maxLength={1000}
                      rows={4}
                      value={sessionDescription}
                      onChange={(event) => setSessionDescription(event.target.value)}
                      placeholder="Add a short description"
                      className={`w-full resize-none rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2 ${modalInputSurface}`}
                    />
                  </div>
                )}

                {useImageProjectModal && (
                  <>
                    <div>
                      <label className="block text-sm font-medium mb-2">
                        Canvas preset
                      </label>
                      <SingleSelect
                        options={projectCanvasOptions}
                        onChange={handleProjectCanvasOptionChange}
                        value={selectedProjectCanvasOption}
                        isSearchable={false}
                      />
                    </div>

                    {isCustomCanvasSelected && (
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <div>
                          <label className="block text-sm font-medium mb-2" htmlFor="custom-canvas-width">
                            Width
                          </label>
                          <input
                            id="custom-canvas-width"
                            type="number"
                            min={MIN_CANVAS_DIMENSION}
                            max={MAX_CANVAS_DIMENSION}
                            step="1"
                            value={customCanvasWidth}
                            onChange={(event) => setCustomCanvasWidth(event.target.value)}
                            className={`w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2 ${modalInputSurface}`}
                          />
                        </div>

                        <div>
                          <label className="block text-sm font-medium mb-2" htmlFor="custom-canvas-height">
                            Height
                          </label>
                          <input
                            id="custom-canvas-height"
                            type="number"
                            min={MIN_CANVAS_DIMENSION}
                            max={MAX_CANVAS_DIMENSION}
                            step="1"
                            value={customCanvasHeight}
                            onChange={(event) => setCustomCanvasHeight(event.target.value)}
                            className={`w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2 ${modalInputSurface}`}
                          />
                        </div>
                      </div>
                    )}

                    <div className={`rounded-lg border px-3 py-3 text-sm ${modalInputSurface}`}>
                      <div className="text-xs font-semibold uppercase tracking-wide opacity-70">
                        Canvas resolution
                      </div>
                      <div className="mt-1 font-semibold">
                        {projectCanvasDimensions.width} x {projectCanvasDimensions.height} px
                      </div>
                      {isCustomCanvasSelected && (
                        <div className="mt-1 text-xs opacity-80">
                          Custom ratio {getSimplifiedAspectRatioLabel(projectCanvasDimensions)}. Default model ratio will start at {resolvedProjectGenerationAspectRatio}.
                        </div>
                      )}
                      {customCanvasValidationMessage && (
                        <div className="mt-2 text-xs text-rose-500">{customCanvasValidationMessage}</div>
                      )}
                    </div>

                    <label className="flex items-center gap-2 text-sm font-medium cursor-pointer">
                      <input
                        type="checkbox"
                        checked={addBackgroundLayer}
                        onChange={(event) => setAddBackgroundLayer(event.target.checked)}
                      />
                      Add background layer
                    </label>

                    {addBackgroundLayer && (
                      <div>
                        <label className="block text-sm font-medium mb-2">
                          Background color
                        </label>
                        <div className={`flex items-center gap-3 rounded-lg border px-3 py-2 ${modalInputSurface}`}>
                          <input
                            type="color"
                            value={backgroundLayerColor}
                            onChange={(event) => setBackgroundLayerColor(event.target.value)}
                            className="h-8 w-12 cursor-pointer border-0 bg-transparent p-0"
                          />
                          <div className="text-sm font-mono uppercase">{backgroundLayerColor}</div>
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>

              <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-end">
                {switchEditorLabel && onSwitchEditor && (
                  <button
                    type="button"
                    onClick={handleSwitchEditor}
                    className={`min-h-9 px-3 py-1.5 rounded-md text-sm transition-all duration-200 ease-out hover:-translate-y-[1px] ${modalSecondaryButton}`}
                  >
                    {switchEditorLabel}
                  </button>
                )}
                {additionalEditorActions.map((action) => (
                  <button
                    key={action.label}
                    type="button"
                    onClick={() => handleAdditionalEditorAction(action)}
                    className={`min-h-9 px-3 py-1.5 rounded-md text-sm transition-all duration-200 ease-out hover:-translate-y-[1px] ${modalSecondaryButton}`}
                  >
                    {action.label}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={viewSessions}
                  className={`inline-flex min-h-9 items-center justify-center whitespace-nowrap px-3 py-1.5 rounded-md text-sm transition-all duration-200 ease-out hover:-translate-y-[1px] ${modalSecondaryButton}`}
                >
                  {t("common.viewProjects")}
                </button>
                <button
                  type="button"
                  onClick={closeProjectModal}
                  className={`min-h-9 px-3 py-1.5 rounded-md text-sm transition-all duration-200 ease-out hover:-translate-y-[1px] ${modalSecondaryButton}`}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={Boolean(useImageProjectModal && customCanvasValidationMessage)}
                  className={`min-h-9 px-4 py-1.5 rounded-md text-sm font-semibold transition-all duration-200 ease-out hover:-translate-y-[1px] disabled:cursor-not-allowed disabled:opacity-60 ${modalPrimaryButton}`}
                >
                  Create session
                </button>
              </div>
              </form>
            </div>
          </div>
        </div>
      , document.body)}
    </div>
  );
}

export default AddSessionDropdown;
