import { useEffect, useState } from "react";
import { FaTimes } from "react-icons/fa";

import { useColorMode } from "../../../../contexts/ColorMode";
import OverlayPromptGenerator from "./OverlayPromptGenerator";
import OverlayPromptGenerateVideo from "./OverlayPromptGenerateVideo";

export default function VideoCanvasOverlay(props) {
  const {
    activeItemList,
    onCloseOverlay,
    activeTab,
    promptText,
    setPromptText,
    submitGenerateRequest,
    isGenerationPending,
    selectedGenerationModel,
    setSelectedGenerationModel,
    generationError,
    currentDefaultPrompt,
    submitGenerateNewRequest,
    aspectRatio,
    setAspectRatio,
    canvasDimensions,
    videoPromptText,
    setVideoPromptText,
    submitGenerateNewVideoRequest,
    aiVideoGenerationPending,
    selectedVideoGenerationModel,
    setSelectedVideoGenerationModel,
    currentLayer,
    sessionDetails,
    editorVariant = "videoStudio",
    maxContentHeight,
  } = props;

  const { colorMode } = useColorMode();
  const canvasWidth = Number(canvasDimensions?.width) || 1024;
  const canvasHeight = Number(canvasDimensions?.height) || 1024;
  const isImageStudioOverlay = editorVariant === "imageStudio";
  const isPortraitCanvas =
    canvasHeight > canvasWidth || aspectRatio === "9:16";
  const isLandscapeCanvas =
    canvasWidth > canvasHeight || aspectRatio === "16:9";
  const overlayLayout = isPortraitCanvas
    ? "portrait"
    : isLandscapeCanvas
    ? "landscape"
    : "square";
  const overlayCardWidth = isLandscapeCanvas
    ? Math.min(760, Math.max(560, canvasWidth * 0.68))
    : isPortraitCanvas
    ? Math.min(560, Math.max(360, canvasWidth * 0.96))
    : Math.min(660, Math.max(420, canvasWidth * 0.9));
  const imageStudioTopOffset = isPortraitCanvas
    ? Math.min(140, Math.max(36, canvasHeight * 0.18))
    : isLandscapeCanvas
    ? Math.min(100, Math.max(24, canvasHeight * 0.13))
    : Math.min(120, Math.max(30, canvasHeight * 0.16));
  const overlayCardMaxHeight = `calc(100% - ${imageStudioTopOffset + 16}px)`;
  const videoStudioPanelWidth = isLandscapeCanvas
    ? Math.min(560, Math.max(400, canvasWidth * 0.6))
    : Math.min(480, Math.max(360, canvasWidth * 0.84));
  const availableVideoStudioPanelHeight = Number.isFinite(maxContentHeight)
    ? maxContentHeight
    : Math.max(0, canvasHeight - 24);
  const videoStudioPanelMaxHeight = isPortraitCanvas
    ? availableVideoStudioPanelHeight
    : isLandscapeCanvas
    ? Math.min(320, availableVideoStudioPanelHeight, Math.max(0, canvasHeight - 24))
    : Math.min(420, availableVideoStudioPanelHeight, Math.max(0, canvasHeight - 24));

  const [selectedTab, setSelectedTab] = useState(activeTab || "image");

  useEffect(() => {
    if (isImageStudioOverlay) {
      setSelectedTab("image");
    } else if (activeTab) {
      setSelectedTab(activeTab);
    }
  }, [activeTab, isImageStudioOverlay]);

  useEffect(() => {
    const handleEscapeKey = (event) => {
      if (event.key === "Escape" && onCloseOverlay) {
        onCloseOverlay();
      }
    };

    window.addEventListener("keydown", handleEscapeKey);
    return () => window.removeEventListener("keydown", handleEscapeKey);
  }, [onCloseOverlay]);

  const overlayVidPrompt = (
    <OverlayPromptGenerateVideo
      videoPromptText={videoPromptText}
      setVideoPromptText={setVideoPromptText}
      aiVideoGenerationPending={aiVideoGenerationPending}
      selectedVideoGenerationModel={selectedVideoGenerationModel}
      setSelectedVideoGenerationModel={setSelectedVideoGenerationModel}
      generationError={generationError}
      currentDefaultPrompt={currentDefaultPrompt}
      submitGenerateNewVideoRequest={submitGenerateNewVideoRequest}
      aspectRatio={aspectRatio}
      onCloseOverlay={onCloseOverlay}
      activeItemList={activeItemList}
      currentLayer={currentLayer}
      sessionDetails={sessionDetails}
      layoutMode={overlayLayout}
    />
  );

  if (!activeItemList || activeItemList.length === 0) {
    const overlaySurface =
      colorMode === "dark"
        ? "bg-[#181b24] text-slate-100 border border-[#3a4050] shadow-[0_28px_70px_rgba(0,0,0,0.46)]"
        : "bg-white text-slate-900 border border-slate-200 shadow-[0_24px_60px_rgba(15,23,42,0.18)]";
    const videoOverlayBackdrop =
      colorMode === "dark"
        ? "bg-[#181b24] text-slate-100"
        : "bg-white text-slate-900";
    const tabBase =
      colorMode === "dark"
        ? "bg-[#20232e] text-slate-300 border border-[#4a5265] hover:bg-[#292d3a] hover:text-white"
        : "bg-slate-100 text-slate-600 border border-slate-200 hover:text-slate-900";
    const tabActive =
      colorMode === "dark"
        ? "bg-[#f6c453] text-[#101117] border border-[#ffe0a3]/70 shadow-[0_8px_20px_rgba(246,196,83,0.16)]"
        : "bg-indigo-600 text-white border border-indigo-600 shadow-sm";
    const closeButtonColor =
      colorMode === "dark"
        ? "bg-[#20232e] text-slate-200 border border-[#4a5265] hover:bg-[#292d3a]"
        : "bg-slate-100 text-slate-700 border border-slate-200 hover:bg-slate-200";
    const subText = colorMode === "dark" ? "text-slate-300" : "text-slate-600";
    const headerTextLayout = isImageStudioOverlay
      ? "min-w-0 flex flex-wrap items-baseline gap-x-2 gap-y-1"
      : isPortraitCanvas
      ? "min-w-0 flex flex-col gap-0.5"
      : "min-w-0 flex flex-wrap items-baseline gap-x-2 gap-y-0.5";
    const overlayTitle = isImageStudioOverlay
      ? "Start this canvas"
      : "Start this frame";
    const overlaySubtitle = isImageStudioOverlay
      ? "Generate the first image directly on the Image Studio canvas."
      : "Generate media directly on canvas";
    return (
      <div
        data-studio-blank-overlay
        data-overlay-layout={overlayLayout}
        className={`absolute inset-0 z-[320] flex justify-center pointer-events-none ${
          isImageStudioOverlay
            ? "items-start overflow-visible px-3 pb-4"
            : `items-start overflow-visible rounded-[inherit] ${videoOverlayBackdrop}`
        }`}
        style={isImageStudioOverlay ? { paddingTop: `${imageStudioTopOffset}px` } : undefined}
      >
        <div
          data-studio-blank-overlay-content
          className={`pointer-events-auto relative z-[321] flex min-h-0 flex-col text-left ${
            isImageStudioOverlay
              ? `${overlaySurface} rounded-[28px] px-5 py-5`
              : `sticky top-3 overflow-hidden p-3 ${
                  isPortraitCanvas ? "h-full w-full" : ""
                }`
          }`}
          style={isImageStudioOverlay ? {
            width: `${overlayCardWidth}px`,
            maxWidth: "calc(100% - 24px)",
            maxHeight: overlayCardMaxHeight,
          } : {
            width: isPortraitCanvas ? "100%" : `${videoStudioPanelWidth}px`,
            maxWidth: "calc(100% - 24px)",
            height: isPortraitCanvas ? "100%" : "auto",
            maxHeight: `${videoStudioPanelMaxHeight}px`,
          }}
        >
          <div className={`flex shrink-0 items-start justify-between gap-3 ${isImageStudioOverlay ? "mb-5" : "mb-2"}`}>
            <div className={headerTextLayout}>
              <div className={isImageStudioOverlay ? "text-base font-semibold" : "text-sm font-semibold"}>{overlayTitle}</div>
              <div className={`${isImageStudioOverlay ? "text-sm" : "text-xs"} ${subText}`}>
                {overlaySubtitle}
              </div>
            </div>

            <button
              type="button"
              onClick={onCloseOverlay}
              className={`inline-flex shrink-0 items-center gap-2 rounded-full ${isImageStudioOverlay ? "px-4 py-2 text-sm" : "px-3 py-1.5 text-xs"} font-semibold transition-colors duration-150 ${closeButtonColor}`}
              aria-label="Close overlay"
            >
              <FaTimes size={isImageStudioOverlay ? 14 : 12} />
              <span>Close</span>
            </button>
          </div>

          {!isImageStudioOverlay ? (
            <div className="mb-2 grid shrink-0 grid-cols-2 gap-2">
              <button
                type="button"
                className={`w-full whitespace-nowrap rounded-full px-3 py-2 text-xs font-semibold text-center transition-colors duration-150 ${selectedTab === "image" ? tabActive : tabBase}`}
                onClick={() => setSelectedTab("image")}
              >
                Generate Image
              </button>
              <button
                type="button"
                className={`w-full whitespace-nowrap rounded-full px-3 py-2 text-xs font-semibold text-center transition-colors duration-150 ${selectedTab === "video" ? tabActive : tabBase}`}
                onClick={() => setSelectedTab("video")}
              >
                Generate Video
              </button>
            </div>
          ) : null}

          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pr-0.5">
            {selectedTab === "image" ? (
              <OverlayPromptGenerator
                promptText={promptText}
                setPromptText={setPromptText}
                submitGenerateRequest={submitGenerateRequest}
                isGenerationPending={isGenerationPending}
                selectedGenerationModel={selectedGenerationModel}
                setSelectedGenerationModel={setSelectedGenerationModel}
                generationError={generationError}
                currentDefaultPrompt={currentDefaultPrompt}
                submitGenerateNewRequest={submitGenerateNewRequest}
                aspectRatio={aspectRatio}
                setAspectRatio={setAspectRatio}
                canvasDimensions={canvasDimensions}
                layoutMode={overlayLayout}
                showAspectRatioSelector={isImageStudioOverlay}
                editorVariant={editorVariant}
              />
            ) : (
              <div className="h-full w-full">{overlayVidPrompt}</div>
            )}
          </div>
        </div>
      </div>
    );
  }

  return null;
}
