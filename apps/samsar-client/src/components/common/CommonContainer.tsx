import { useEffect } from "react";
import TopNav from "./TopNav.tsx";
import { AlertDialog } from "./AlertDialog.tsx";
import { useColorMode } from "../../contexts/ColorMode.jsx";


export default function CommonContainer(props) {
  const {
    children,
    isVideoPreviewPlaying,
    setIsVideoPreviewPlaying,
    downloadCurrentFrame,
    resetSession,
    isRenderPending,
    submitRenderVideo,
    cancelPendingRender,
    renderedVideoPath,
    downloadLink,
    isVideoGenerating,
    isUpdateLayerPending,
    isCanvasDirty,
    isSessionPublished,
    publishedTitle,
    publishedDescription,
    publishedTags,
    publishVideoSession,
    unpublishVideoSession,
    renderCompletedThisSession,
    sessionId,
    openAdvancedVideoEditDialog,
    isReadOnlyShareView,
    isEditableShareView,
    isImportedSession,
    onRequestEditSession,
    openAuthDialog,
  } = props;
  const { colorMode } = useColorMode();

  useEffect(() => {
    if (typeof setIsVideoPreviewPlaying !== 'function') {
      return undefined;
    }

    const shouldIgnoreSpaceToggle = (target: EventTarget | null) => {
      if (!(target instanceof HTMLElement)) {
        return false;
      }

      const interactiveAncestor = target.closest(
        'input, textarea, select, button, [contenteditable="true"], [role="textbox"]'
      );

      return Boolean(interactiveAncestor);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.code !== 'Space') {
        return;
      }

      if (event.ctrlKey || event.metaKey || event.altKey) {
        return;
      }

      if (shouldIgnoreSpaceToggle(event.target)) {
        return;
      }

      event.preventDefault();
      setIsVideoPreviewPlaying((previousValue: boolean) => !previousValue);
    };

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [setIsVideoPreviewPlaying]);

  const resetCurrentSession = () => {
    if (resetSession) {
      resetSession();

    }
  }

  const shellBg =
    colorMode === 'dark'
      ? 'bg-gradient-to-b from-[#060a16] via-[#0b1226] to-[#070b16]'
      : 'bg-gradient-to-b from-[#e9edf7] via-[#dfe7f5] to-[#eef3fb]';

  return (
    <div className={`h-[100dvh] min-h-[100dvh] overflow-hidden ${shellBg}`}>
      <TopNav
        resetCurrentSession={resetCurrentSession}
        isVideoPreviewPlaying={isVideoPreviewPlaying}
        setIsVideoPreviewPlaying={setIsVideoPreviewPlaying}
        downloadCurrentFrame={downloadCurrentFrame}
        isRenderPending={isRenderPending}
        submitRenderVideo={submitRenderVideo}
        cancelPendingRender={cancelPendingRender}
        renderedVideoPath={renderedVideoPath}
        downloadLink={downloadLink}
        isVideoGenerating={isVideoGenerating}
        isUpdateLayerPending={isUpdateLayerPending}
        isCanvasDirty={isCanvasDirty}
        isSessionPublished={isSessionPublished}
        publishedTitle={publishedTitle}
        publishedDescription={publishedDescription}
        publishedTags={publishedTags}
        publishVideoSession={publishVideoSession}
        unpublishVideoSession={unpublishVideoSession}
        renderCompletedThisSession={renderCompletedThisSession}
        sessionId={sessionId}
        openAdvancedVideoEditDialog={openAdvancedVideoEditDialog}
        isReadOnlyShareView={isReadOnlyShareView}
        isEditableShareView={isEditableShareView}
        isImportedSession={isImportedSession}
        onRequestEditSession={onRequestEditSession}
        openAuthDialog={openAuthDialog}
      />
      <div>
        <AlertDialog />
        {children}
      </div>
    </div>
  )
}
