
import RenderActionButton from "./RenderActionButton.jsx";
import { useNavigate } from "react-router-dom";
import { FaCog, FaDownload, FaEdit, FaLock, FaPause, FaPlay, FaSearch, FaSearchMinus, FaSearchPlus, FaUndo } from "react-icons/fa";
import { FiShare2 } from "react-icons/fi";
import SingleSelect from "../../common/SingleSelect.jsx";
import { IoMdGrid } from "react-icons/io";
import { useLocalization } from "../../../contexts/LocalizationContext.jsx";
import { useColorMode } from "../../../contexts/ColorMode.jsx";

import { NavCanvasControlContext } from "../../../contexts/NavCanvasControlContext.jsx";
import { useContext } from "react";

export default function CanvasControlBar(props) {
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
    publishVideoSession,
    unpublishVideoSession,
    renderCompletedThisSession,
    editorVariant = 'videoStudio',
    openAdvancedVideoEditDialog,
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

  useNavigate();
  const { t } = useLocalization();
  const { colorMode } = useColorMode();
  const isImageStudio = editorVariant === 'imageStudio';
  let expressGenerationLink = null;
  const gridGranularityOptions = Array.from({ length: 10 }, (_, index) => ({
    value: index + 1,
    label: `${index + 1}x`,
  }));
  const selectedGridGranularityOption =
    gridGranularityOptions.find((option) => option.value === canvasNavigationGridGranularity)
    || gridGranularityOptions[2];




  const showPlayPause = () => {
   // toggleIsVideoPreviewPlaying();
   isVideoPreviewPlaying ? setIsVideoPreviewPlaying(false) : setIsVideoPreviewPlaying(true);
  }

  const sectionSurfaceClassName = colorMode === 'dark'
    ? 'inline-flex items-center gap-1.5 rounded-2xl border border-[#23324a] bg-[#0a1526]/82 px-2 py-1.5 shadow-[0_10px_24px_rgba(0,0,0,0.28)] backdrop-blur-md'
    : 'inline-flex items-center gap-1.5 rounded-2xl border border-slate-200 bg-white/82 px-2 py-1.5 backdrop-blur-md';
  const metricSurfaceClassName = colorMode === 'dark'
    ? 'inline-flex items-stretch divide-x divide-[#22314a] overflow-hidden rounded-2xl border border-[#23324a] bg-[#0a1526]/82 shadow-[0_10px_24px_rgba(0,0,0,0.28)] backdrop-blur-md'
    : 'inline-flex items-stretch divide-x divide-slate-200 overflow-hidden rounded-2xl border border-slate-200 bg-white/82 backdrop-blur-md';
  const metricValueClassName = colorMode === 'dark'
    ? 'text-xs font-semibold text-slate-100'
    : 'text-xs font-semibold text-slate-800';
  const metricLabelClassName = colorMode === 'dark'
    ? 'text-[10px] uppercase tracking-[0.16em] text-slate-400'
    : 'text-[10px] uppercase tracking-[0.16em] text-slate-500';
  const zoomReadoutClassName = colorMode === 'dark'
    ? 'inline-flex items-center gap-1 rounded-xl bg-[#101d34] px-2 py-1 text-[11px] font-semibold text-slate-200'
    : 'inline-flex items-center gap-1 rounded-xl bg-slate-100 px-2 py-1 text-[11px] font-semibold text-slate-700';
  const iconButtonClassName = colorMode === 'dark'
    ? 'inline-flex h-8 w-8 items-center justify-center rounded-xl text-slate-200 transition hover:bg-[#14213a] hover:text-white disabled:cursor-not-allowed disabled:opacity-40'
    : 'inline-flex h-8 w-8 items-center justify-center rounded-xl text-slate-600 transition hover:bg-slate-100 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-40';
  const activeIconButtonClassName = colorMode === 'dark'
    ? 'bg-[#132341] text-cyan-100'
    : 'bg-sky-50 text-sky-700';
  const expressBadgeClassName = colorMode === 'dark'
    ? 'inline-flex items-center rounded-xl bg-cyan-400/12 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-cyan-200 ring-1 ring-cyan-300/25'
    : 'inline-flex items-center rounded-xl bg-cyan-50 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-cyan-700 ring-1 ring-cyan-200';
  const readOnlyBadgeClassName = colorMode === 'dark'
    ? 'inline-flex items-center gap-1 rounded-xl bg-amber-300/12 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-amber-100 ring-1 ring-amber-200/25'
    : 'inline-flex items-center gap-1 rounded-xl bg-amber-50 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-amber-700 ring-1 ring-amber-200';
  const importedBadgeClassName = colorMode === 'dark'
    ? 'inline-flex items-center rounded-xl bg-emerald-300/12 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-emerald-100 ring-1 ring-emerald-200/25'
    : 'inline-flex items-center rounded-xl bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-emerald-700 ring-1 ring-emerald-200';

  const IconActionButton = ({
    title,
    onClick,
    disabled = false,
    isActive = false,
    allowDuringPending = false,
    triggerOnPointerDown = false,
    children,
  }) => {
    const handlePointerDown = (event) => {
      if (!triggerOnPointerDown || disabled) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      onClick?.(event);
    };

    const handleClick = (event) => {
      event.stopPropagation();
      if (triggerOnPointerDown) {
        return;
      }

      onClick?.(event);
    };

    return (
      <button
        type="button"
        onPointerDown={handlePointerDown}
        onClick={handleClick}
        title={title}
        aria-label={title}
        disabled={disabled}
        className={`${iconButtonClassName} ${isActive ? activeIconButtonClassName : ''} ${allowDuringPending ? 'pending-allow-action' : ''}`}
      >
        {children}
      </button>
    );
  };

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
  if (!isImageStudio && (isExpressGeneration || typeof openAdvancedVideoEditDialog === 'function')) {
    expressGenerationLink = (
      <div className={sectionSurfaceClassName}>
        {isExpressGeneration && <span className={expressBadgeClassName}>Express</span>}
        {typeof openAdvancedVideoEditDialog === 'function' && (
          <IconActionButton title="Advanced options" onClick={openAdvancedVideoEditDialog}>
            <FaCog className="text-[13px]" />
          </IconActionButton>
        )}
      </div>
    );
  }
  const readOnlyControlDisplay = !isImageStudio && isReadOnlyMode && (
    <div className={sectionSurfaceClassName}>
      <span className={readOnlyBadgeClassName}>
        <FaLock className="text-[10px]" />
        View only
      </span>
      <IconActionButton title="Create editable copy" onClick={onRequestEditSession}>
        <FaEdit className="text-[13px]" />
      </IconActionButton>
    </div>
  );
  const importedControlDisplay = !isImageStudio && !isReadOnlyMode && isImportedSession && (
    <div className={sectionSurfaceClassName}>
      <span className={importedBadgeClassName}>Imported</span>
    </div>
  );
  const disabledShellClass = isRenderPending ? "pending-disabled-shell" : "";

  return (
    <div
      className={`relative flex min-h-[34px] items-center justify-center ${disabledShellClass}`}
      style={{ zIndex: 1230 }}
      aria-disabled={isRenderPending}
    >
      <div className="flex max-w-full items-center gap-2 whitespace-nowrap">
        {canvasDimensionsDisplay}
        {expressGenerationLink}
        {readOnlyControlDisplay}
        {importedControlDisplay}

        {!isImageStudio && (
          <div className={sectionSurfaceClassName}>
            <IconActionButton title="Download current frame" onClick={downloadCurrentFrame}>
              <FaDownload className="text-[13px]" />
            </IconActionButton>
            {typeof onCreateShareUrl === 'function' && (
              <IconActionButton
                title="Share session"
                onClick={onCreateShareUrl}
                allowDuringPending
                triggerOnPointerDown
              >
                <FiShare2 className="text-[15px]" />
              </IconActionButton>
            )}
          </div>
        )}

        <div className={sectionSurfaceClassName}>
          <IconActionButton
            title={showCanvasNavigationGrid ? 'Hide canvas grid' : 'Show canvas grid'}
            onClick={toggleShowCanvasNavigationGrid}
            isActive={showCanvasNavigationGrid}
          >
            <IoMdGrid className="text-[15px]" />
          </IconActionButton>
          {showCanvasNavigationGrid && (
            <div className="w-[78px] min-w-[78px] text-xs">
              <SingleSelect
                options={gridGranularityOptions}
                value={selectedGridGranularityOption}
                onChange={(option) => setCanvasNavigationGridGranularity(option?.value || 1)}
                classNamePrefix="canvas-grid-granularity"
                isSearchable={false}
              />
            </div>
          )}
        </div>

        <div className={sectionSurfaceClassName}>
          <div className={zoomReadoutClassName} title={`Zoom ${canvasZoomPercent}%`}>
            <FaSearch className="text-[11px] opacity-75" />
            <span>{canvasZoomPercent}%</span>
          </div>
          <IconActionButton title="Zoom out" onClick={zoomCanvasOut} disabled={!canZoomOutCanvas}>
            <FaSearchMinus className="text-[12px]" />
          </IconActionButton>
          <IconActionButton title="Reset zoom" onClick={resetCanvasZoom}>
            <FaUndo className="text-[12px]" />
          </IconActionButton>
          <IconActionButton title="Zoom in" onClick={zoomCanvasIn} disabled={!canZoomInCanvas}>
            <FaSearchPlus className="text-[12px]" />
          </IconActionButton>
        </div>

        {!isImageStudio && (
          <div className={sectionSurfaceClassName}>
            <IconActionButton
              title={isVideoPreviewPlaying ? t("common.pause") : t("common.play")}
              onClick={showPlayPause}
            >
              {isVideoPreviewPlaying ? <FaPause className="text-[13px]" /> : <FaPlay className="text-[13px] translate-x-[1px]" />}
            </IconActionButton>
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
              publishVideoSession={publishVideoSession}
              unpublishVideoSession={unpublishVideoSession}
              renderCompletedThisSession={renderCompletedThisSession}
            />
          </div>
        )}
      </div>
    </div>
  );
}
