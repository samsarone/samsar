import { useUiLanguage } from '../../hooks/useUiLanguage.js';
import { useEffect } from "react";
import TopNav from "./TopNav.tsx";
import { AlertDialog } from "./AlertDialog.tsx";
import { useColorMode } from "../../contexts/ColorMode.jsx";


export default function CommonContainer(props) {
  useUiLanguage();
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
    isInteractiveVideo,
    publishedTitle,
    publishedDescription,
    publishedTags,
    publishVideoSession,
    unpublishVideoSession,
    renderCompletedThisSession,
    sessionId,
    openAdvancedVideoEditDialog,
    openExpressPostProcessingDialog,
    isReadOnlyShareView,
    isEditableShareView,
    isImportedSession,
    onRequestEditSession,
    openAuthDialog,
    openAudioActions,
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
        'input, textarea, select, button, [contenteditable="true"], [role="textbox"], [role="dialog"]'
      );

      return Boolean(interactiveAncestor);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.code !== 'Space' || event.defaultPrevented || event.isComposing) {
        return;
      }

      if (event.ctrlKey || event.metaKey || event.altKey) {
        return;
      }

      if (shouldIgnoreSpaceToggle(event.target)) {
        return;
      }

      event.preventDefault();
      // Holding Space should not repeatedly start and stop the preview.
      if (event.repeat) {
        return;
      }
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
      ? 'bg-[linear-gradient(180deg,#15171f_0%,#12141c_44%,#0c0d12_100%)]'
      : 'bg-gradient-to-b from-[#e9edf7] via-[#dfe7f5] to-[#eef3fb]';

  return (
    <div className={`workspace-page h-[100dvh] min-h-[100dvh] overflow-hidden ${shellBg}`}>
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
        isInteractiveVideo={isInteractiveVideo}
        publishedTitle={publishedTitle}
        publishedDescription={publishedDescription}
        publishedTags={publishedTags}
        publishVideoSession={publishVideoSession}
        unpublishVideoSession={unpublishVideoSession}
        renderCompletedThisSession={renderCompletedThisSession}
        sessionId={sessionId}
        openAdvancedVideoEditDialog={openAdvancedVideoEditDialog}
        openExpressPostProcessingDialog={openExpressPostProcessingDialog}
        isReadOnlyShareView={isReadOnlyShareView}
        isEditableShareView={isEditableShareView}
        isImportedSession={isImportedSession}
        onRequestEditSession={onRequestEditSession}
        openAuthDialog={openAuthDialog}
        openAudioActions={openAudioActions}
      />
      <div>
        <AlertDialog />
        {children}
      </div>
    </div>
  )
}
