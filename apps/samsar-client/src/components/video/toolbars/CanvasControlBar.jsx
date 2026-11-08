import { Popover, PopoverButton, PopoverPanel } from '@headlessui/react';
import { useUiLanguage } from '../../../hooks/useUiLanguage.js';
import { translateText as uiText } from '../../../utils/localization.js';

import RenderActionButton from "./RenderActionButton.jsx";
import { useNavigate } from "react-router-dom";
import { FaCog, FaEllipsisH, FaExternalLinkAlt, FaMagic, FaDownload, FaEdit, FaLock, FaPause, FaPlay, FaSearch, FaSearchMinus, FaSearchPlus, FaUndo } from "react-icons/fa";
import { FiShare2 } from "react-icons/fi";
import SingleSelect from "../../common/SingleSelect.jsx";
import { IoMdGrid } from "react-icons/io";
import { useLocalization } from "../../../contexts/LocalizationContext.jsx";
import { useColorMode } from "../../../contexts/ColorMode.jsx";

import { NavCanvasControlContext } from "../../../contexts/NavCanvasControlContext.jsx";
import { useContext } from "react";

function IconActionButton({
  title,
  onClick,
  disabled = false,
  isActive = false,
  allowDuringPending = false,
  triggerOnPointerDown = false,
  isRenderPending = false,
  iconButtonClassName,
  activeIconButtonClassName,
  children,
}) {
  const isActionDisabled = disabled || (isRenderPending && !allowDuringPending);
  const handlePointerDown = (event) => {
    if (!triggerOnPointerDown || isActionDisabled) return;
    event.preventDefault();
    event.stopPropagation();
    onClick?.(event);
  };
  const handleClick = (event) => {
    event.stopPropagation();
    if (isActionDisabled || triggerOnPointerDown) return;
    onClick?.(event);
  };
  return (
    <button
      type="button"
      onPointerDown={handlePointerDown}
      onClick={handleClick}
      title={title}
      aria-label={title}
      disabled={isActionDisabled}
      className={`${iconButtonClassName} ${isActive ? activeIconButtonClassName : ''} ${allowDuringPending ? 'pending-allow-action' : ''}`}
    >
      {children}
    </button>
  );
}

export default function CanvasControlBar(props) {
  useUiLanguage();
  const {
    downloadCurrentFrame,
    isExpressGeneration,
    sessionId,
    canvasActualDimensions,
    totalEffectiveDuration,
    setIsVideoPreviewPlaying,
    isVideoPreviewPlaying,
    isRenderPending,
    submitRenderVideo,
    cancelPendingRender,
    renderedVideoPath,
    downloadLink,
    isVideoGenerating,
    isUpdateLayerPending,
    isCanvasDirty,
    isSessionPublished,
    isInteractiveVideo = false,
    publishedTitle,
    publishedDescription,
    publishVideoSession,
    unpublishVideoSession,
    renderCompletedThisSession,
    editorVariant = 'videoStudio',
    openAdvancedVideoEditDialog,
    openExpressPostProcessingDialog,
    isReadOnlyMode = false,
    isImportedSession = false,
    onRequestEditSession,
    onCreateShareUrl,
  } = props;

  const {
    showCanvasNavigationGrid,
    toggleShowCanvasNavigationGrid,
    canvasNavigationGridGranularity,
    setCanvasNavigationGridGranularity,
    zoomCanvasIn,
    zoomCanvasOut,
    resetCanvasZoom,
    canvasZoomPercent,
    canZoomInCanvas,
    canZoomOutCanvas,
  } = useContext(NavCanvasControlContext);

  const navigate = useNavigate();
  const { t } = useLocalization();
  const { colorMode } = useColorMode();
  const isImageStudio = editorVariant === 'imageStudio';
  const compactExpress = !isImageStudio && isExpressGeneration;
  let expressGenerationLink = null;
  const gridGranularityOptions = Array.from({ length: 10 }, (_, index) => ({
    value: index + 1,
    label: `${index + 1}x`,
  }));
  const selectedGridGranularityOption =
    gridGranularityOptions.find((option) => option.value === canvasNavigationGridGranularity)
    || gridGranularityOptions[2];




  const showPlayPause = () => {
    setIsVideoPreviewPlaying(current => !current);
  }

  const sectionSurfaceClassName = `inline-flex items-center gap-1.5 rounded-2xl border border-line px-2 py-1.5 ${colorMode === 'dark' ? 'bg-[#181b24]/86 shadow-[0_10px_24px_rgba(0,0,0,0.26)] backdrop-blur-xl' : 'bg-white/82 backdrop-blur-md'}`;
  const metricSurfaceClassName = `inline-flex items-stretch divide-x overflow-hidden rounded-2xl border border-line ${colorMode === 'dark' ? 'divide-[#3a4050] bg-[#181b24]/86 shadow-[0_10px_24px_rgba(0,0,0,0.26)] backdrop-blur-xl' : 'divide-slate-200 bg-white/82 backdrop-blur-md'}`;
  const metricValueClassName = colorMode === 'dark'
    ? 'text-xs font-semibold text-slate-100'
    : 'text-xs font-semibold text-slate-800';
  const metricLabelClassName = 'text-micro uppercase tracking-[0.16em] text-fg-muted';
  const zoomReadoutClassName = `inline-flex items-center gap-1 rounded-xl px-2 py-1 text-caption font-semibold text-fg-secondary ${colorMode === 'dark' ? 'bg-[#20232e]' : 'bg-slate-100'}`;
  const iconButtonClassName = `inline-flex h-8 w-8 items-center justify-center rounded-xl transition hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-40 ${colorMode === 'dark' ? 'text-slate-200 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#f6c453]/65' : 'text-slate-600 hover:text-slate-900'}`;
  const activeIconButtonClassName = colorMode === 'dark'
    ? 'bg-[#ff4655]/18 text-[#ffd4d8]'
    : 'bg-sky-50 text-sky-700';
  const expressBadgeClassName = colorMode === 'dark'
    ? 'inline-flex items-center rounded-xl bg-cyan-400/12 px-2.5 py-1 text-caption font-semibold uppercase tracking-[0.12em] text-cyan-200 ring-1 ring-cyan-300/25'
    : 'inline-flex items-center rounded-xl bg-cyan-50 px-2.5 py-1 text-caption font-semibold uppercase tracking-[0.12em] text-cyan-700 ring-1 ring-cyan-200';
  const interactiveVideoBadgeClassName = colorMode === 'dark'
    ? 'inline-flex items-center rounded-xl bg-sky-400/12 px-2.5 py-1 text-caption font-semibold text-sky-200 ring-1 ring-sky-300/25'
    : 'inline-flex items-center rounded-xl bg-sky-50 px-2.5 py-1 text-caption font-semibold text-sky-700 ring-1 ring-sky-200';
  const readOnlyBadgeClassName = colorMode === 'dark'
    ? 'inline-flex items-center gap-1 rounded-xl bg-amber-300/12 px-2.5 py-1 text-caption font-semibold uppercase tracking-[0.12em] text-amber-100 ring-1 ring-amber-200/25'
    : 'inline-flex items-center gap-1 rounded-xl bg-amber-50 px-2.5 py-1 text-caption font-semibold uppercase tracking-[0.12em] text-amber-700 ring-1 ring-amber-200';
  const importedBadgeClassName = colorMode === 'dark'
    ? 'inline-flex items-center rounded-xl bg-emerald-300/12 px-2.5 py-1 text-caption font-semibold uppercase tracking-[0.12em] text-emerald-100 ring-1 ring-emerald-200/25'
    : 'inline-flex items-center rounded-xl bg-emerald-50 px-2.5 py-1 text-caption font-semibold uppercase tracking-[0.12em] text-emerald-700 ring-1 ring-emerald-200';
  const publishedBadgeClassName = colorMode === 'dark'
    ? 'inline-flex items-center rounded-xl bg-violet-300/12 px-2.5 py-1 text-caption font-semibold uppercase tracking-[0.12em] text-violet-100 ring-1 ring-violet-200/25'
    : 'inline-flex items-center rounded-xl bg-violet-50 px-2.5 py-1 text-caption font-semibold uppercase tracking-[0.12em] text-violet-700 ring-1 ring-violet-200';
  const viewInVidgenieButtonClassName = `inline-flex h-8 items-center rounded-xl px-2.5 text-caption font-semibold transition hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 ${colorMode === 'dark' ? 'text-slate-200 hover:text-white focus-visible:ring-[#f6c453]/65' : 'text-slate-600 hover:text-slate-900 focus-visible:ring-sky-400/50'}`;

  const viewSessionInVidgenie = () => {
    if (!sessionId) {
      return;
    }

    navigate(`/vidgenie/${encodeURIComponent(sessionId)}`);
  };

  const iconActionProps = { isRenderPending, iconButtonClassName, activeIconButtonClassName };

  let canvasDimensionsDisplay = null;
  if (canvasActualDimensions) {
    canvasDimensionsDisplay = (
      <div className={metricSurfaceClassName}>
        <div className="px-3 py-1.5">
          <div className={metricValueClassName}>
            {canvasActualDimensions.width} x {canvasActualDimensions.height}
          </div>
          <div className={metricLabelClassName}>
            {t("common.dimensions")}
          </div>
        </div>
        {!isImageStudio && (
          <div className="px-3 py-1.5">
            <div className={metricValueClassName}>
              {totalEffectiveDuration ? totalEffectiveDuration.toFixed(2) : '-'}s
            </div>
            <div className={metricLabelClassName}>
              {t("common.duration")}
            </div>
          </div>
        )}
      </div>
    );
  }
  if (!isImageStudio && (isExpressGeneration || isInteractiveVideo || typeof openAdvancedVideoEditDialog === 'function')) {
    expressGenerationLink = (
      <div className={sectionSurfaceClassName}>
        {isInteractiveVideo ? (
          <span className={interactiveVideoBadgeClassName}>{uiText("Interactive video")}</span>
        ) : (
          isExpressGeneration && !compactExpress && <span className={expressBadgeClassName}>{uiText("Express")}</span>
        )}
        {compactExpress && !isRenderPending && typeof openExpressPostProcessingDialog === 'function' && (
          <button type="button" title={uiText('Express edits')} aria-label={uiText('Express edits')}
            onClick={openExpressPostProcessingDialog} className={viewInVidgenieButtonClassName}>
            <FaMagic className="shrink-0" aria-hidden="true" />
            <span className="ml-2 hidden xl:inline">{uiText('Express edits')}</span>
          </button>
        )}
        {isExpressGeneration && sessionId && (
          <button
            type="button"
            className={`${viewInVidgenieButtonClassName} pending-allow-action`}
            onClick={viewSessionInVidgenie}
            title={uiText("View in Vidgenie")}
            aria-label={uiText("View in Vidgenie")}
          >
            <FaExternalLinkAlt className="shrink-0" aria-hidden="true" />
            <span className={compactExpress ? 'ml-2 hidden 2xl:inline' : 'ml-2'}>{uiText("View in Vidgenie")}</span>
          </button>
        )}
        {!compactExpress && typeof openAdvancedVideoEditDialog === 'function' && (
          <IconActionButton {...iconActionProps} title={uiText("Advanced options")} onClick={openAdvancedVideoEditDialog}>
            <FaCog className="text-label" />
          </IconActionButton>
        )}
      </div>
    );
  }
  const readOnlyControlDisplay = !isImageStudio && isReadOnlyMode && (
    <div className={sectionSurfaceClassName}>
      <span className={readOnlyBadgeClassName}>
        <FaLock className="text-micro" />{uiText("View only")}</span>
      <IconActionButton {...iconActionProps} title={uiText("Create editable copy")} onClick={onRequestEditSession}>
        <FaEdit className="text-label" />
      </IconActionButton>
    </div>
  );
  const importedControlDisplay = !isImageStudio && !isReadOnlyMode && isImportedSession && (
    <div className={sectionSurfaceClassName}>
      <span className={importedBadgeClassName}>{uiText("Imported")}</span>
    </div>
  );
  const publishedControlDisplay = !isImageStudio && isSessionPublished && (
    <div className={sectionSurfaceClassName}>
      <span className={publishedBadgeClassName} title={uiText("Published to gallery")}>{uiText("Published")}</span>
    </div>
  );
  const secondaryControls = (<>
        {!isImageStudio && (
          <div className={sectionSurfaceClassName}>
            <IconActionButton {...iconActionProps} title={uiText("Download current frame")} onClick={downloadCurrentFrame}>
              <FaDownload className="text-label" />
            </IconActionButton>
            {typeof onCreateShareUrl === 'function' && (
              <IconActionButton {...iconActionProps}
                title={uiText("Share session")}
                onClick={onCreateShareUrl}
                triggerOnPointerDown
              >
                <FiShare2 className="text-lead" />
              </IconActionButton>
            )}
          </div>
        )}

        <div className={sectionSurfaceClassName}>
          <IconActionButton {...iconActionProps}
            title={showCanvasNavigationGrid ? uiText("Hide canvas grid") : uiText("Show canvas grid")}
            onClick={toggleShowCanvasNavigationGrid}
            isActive={showCanvasNavigationGrid}
          >
            <IoMdGrid className="text-lead" />
          </IconActionButton>
          {showCanvasNavigationGrid && (
            <div className="w-[78px] min-w-[78px] text-xs">
              <SingleSelect
                options={gridGranularityOptions}
                value={selectedGridGranularityOption}
                onChange={(option) => setCanvasNavigationGridGranularity(option?.value || 1)}
                classNamePrefix="canvas-grid-granularity"
                isSearchable={false}
                isDisabled={isRenderPending}
              />
            </div>
          )}
        </div>

        <div className={sectionSurfaceClassName}>
          <div className={zoomReadoutClassName} title={uiText("Zoom {value0}%", { value0: canvasZoomPercent })}>
            <FaSearch className="text-caption opacity-75" />
            <span>{canvasZoomPercent}%</span>
          </div>
          <IconActionButton {...iconActionProps} title={uiText("Zoom out")} onClick={zoomCanvasOut} disabled={!canZoomOutCanvas}>
            <FaSearchMinus className="text-[12px]" />
          </IconActionButton>
          <IconActionButton {...iconActionProps} title={uiText("Reset zoom")} onClick={resetCanvasZoom}>
            <FaUndo className="text-[12px]" />
          </IconActionButton>
          <IconActionButton {...iconActionProps} title={uiText("Zoom in")} onClick={zoomCanvasIn} disabled={!canZoomInCanvas}>
            <FaSearchPlus className="text-[12px]" />
          </IconActionButton>
        </div>

  </>);



  return (
    <div
      data-studio-controls
      className="relative flex min-w-0 max-w-full min-h-[34px] items-center justify-center"
      style={{ zIndex: 1230 }}
    >
      <div className="flex max-w-full items-center gap-1 whitespace-nowrap lg:gap-2">
        {!compactExpress && canvasDimensionsDisplay}
        {expressGenerationLink}
        {!compactExpress && readOnlyControlDisplay}
        {!compactExpress && importedControlDisplay}
        {!compactExpress && publishedControlDisplay}

        {compactExpress ? (
          <Popover className="relative">
            <PopoverButton title={uiText('More controls')} aria-label={uiText('More controls')}
              disabled={isRenderPending} className={`${iconButtonClassName} border border-line`}>
              <FaEllipsisH />
            </PopoverButton>
            <PopoverPanel anchor="bottom end" className="z-[1300] flex max-w-[calc(100vw-1.5rem)] flex-wrap items-center gap-2 rounded-2xl border border-line bg-surface p-3 text-fg shadow-xl [--anchor-gap:8px] [--anchor-padding:12px]">
              {canvasDimensionsDisplay}
              {readOnlyControlDisplay}
              {importedControlDisplay}
              {publishedControlDisplay}
              {typeof openAdvancedVideoEditDialog === 'function' && (
                <IconActionButton {...iconActionProps} title={uiText('Advanced options')} onClick={openAdvancedVideoEditDialog}><FaCog /></IconActionButton>
              )}
              {secondaryControls}
            </PopoverPanel>
          </Popover>
        ) : secondaryControls}

        {!isImageStudio && (
          <div className={sectionSurfaceClassName}>
            <IconActionButton {...iconActionProps}
              title={isVideoPreviewPlaying ? t("common.pause") : t("common.play")}
              onClick={showPlayPause}
              allowDuringPending
            >
              {isVideoPreviewPlaying ? <FaPause className="text-label" /> : <FaPlay className="text-label translate-x-[1px]" />}
            </IconActionButton>
            <fieldset disabled={isRenderPending} className="contents">
              <RenderActionButton
                compact={true}
                sessionId={sessionId}
                submitRenderVideo={submitRenderVideo}
                cancelPendingRender={cancelPendingRender}
                renderedVideoPath={renderedVideoPath}
                downloadLink={downloadLink}
                isRenderPending={isRenderPending}
                isVideoGenerating={isVideoGenerating}
                isUpdateLayerPending={isUpdateLayerPending}
                isCanvasDirty={isCanvasDirty}
                isSessionPublished={isSessionPublished}
                publishedTitle={publishedTitle}
                publishedDescription={publishedDescription}
                publishVideoSession={publishVideoSession}
                unpublishVideoSession={unpublishVideoSession}
                renderCompletedThisSession={renderCompletedThisSession}
              />
            </fieldset>
          </div>
        )}
      </div>
    </div>
  );
}
