
import { FaTimes } from 'react-icons/fa';
import { useState } from 'react';
import CommonButton from '../../common/CommonButton.tsx';
import CommonDropdownButton from '../../common/CommonDropdownButton.tsx';
import PublicPrimaryButton from '../../common/buttons/PrimaryPublicButton.tsx';
import { useColorMode } from '../../../contexts/ColorMode.jsx';
import { useUser } from '../../../contexts/UserContext.jsx';
import { useAlertDialog } from '../../../contexts/AlertDialogContext.jsx';
import PublishOptionsDialog from './frame_toolbar/PublishOptionsDialog.jsx';

export default function RenderActionButton(props) {
  const {
    sessionId,
    submitRenderVideo,
    cancelPendingRender,
    renderedVideoPath,
    downloadLink,
    isRenderPending,
    isVideoGenerating,
    isUpdateLayerPending,
    isCanvasDirty,
    isSessionPublished,
    publishedTitle,
    publishedDescription,
    publishVideoSession,
    unpublishVideoSession,
    renderCompletedThisSession,
    compact = false,
    extraClasses = '',
  } = props;

  const { user } = useUser();
  const { colorMode } = useColorMode();
  const { openAlertDialog, closeAlertDialog } = useAlertDialog();
  const [publishDraft, setPublishDraft] = useState(null);

  const isAnonymousGuest = !user?._id;
  const resolvedDownloadLink = renderedVideoPath || downloadLink;
  const canUseDownloadLink = Boolean(resolvedDownloadLink && !isRenderPending);
  const hasExistingRender = canUseDownloadLink;
  const canCancelPendingRender = Boolean(isRenderPending && typeof cancelPendingRender === 'function');
  const hasPendingSceneChanges = Boolean(isCanvasDirty);
  const shouldShowDropdown = !isAnonymousGuest && hasExistingRender && !canCancelPendingRender;
  const shouldDownloadOnMain = (
    !canCancelPendingRender
    && !hasPendingSceneChanges
    && renderCompletedThisSession
    && hasExistingRender
  );
  const dropdownMainLabel = shouldDownloadOnMain ? 'Download' : 'Render';
  const isRenderActionDisabled = Boolean(isUpdateLayerPending || isRenderPending);
  const shouldShowRenderPendingSpinner = Boolean(isVideoGenerating);

  const compactButtonClasses = compact
    ? '!m-0 !min-h-[34px] !px-4 !py-1.5 !text-sm'
    : '!m-0';
  const pendingButtonClasses = isVideoGenerating ? '!pl-4 !pr-4' : '';
  const renderButtonExtraClasses = `${compactButtonClasses} ${pendingButtonClasses} ${extraClasses}`.trim();
  const cancelButtonSizeClasses = compact ? 'h-[34px] px-2.5 text-sm' : 'px-2 py-2';
  const cancelButtonClasses = colorMode === 'light'
    ? 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-100'
    : 'border border-[#31405e] bg-[#111a2f] text-slate-200 hover:bg-[#16213a]';
  const cancelButtonShadow = colorMode === 'dark' ? 'shadow-[0_6px_14px_rgba(3,12,28,0.2)]' : '';

  const submitDownloadVideo = () => {
    if (!canUseDownloadLink) {
      return;
    }

    const anchor = document.createElement('a');
    anchor.href = resolvedDownloadLink;
    anchor.download = `Rendition_${new Date().toISOString()}.mp4`;
    anchor.click();
  };

  const publishDraftForSession = publishDraft?.sessionId === sessionId
    ? publishDraft
    : null;

  const updatePublishDraft = (updates) => {
    setPublishDraft((currentDraft) => ({
      sessionId,
      title: currentDraft?.sessionId === sessionId
        ? currentDraft.title
        : publishedTitle || '',
      description: currentDraft?.sessionId === sessionId
        ? currentDraft.description
        : publishedDescription || '',
      ...updates,
    }));
  };

  const showPublishOptionsDialog = () => {
    openAlertDialog(
      <PublishOptionsDialog
        isRepublish={Boolean(isSessionPublished)}
        onClose={closeAlertDialog}
        onDraftChange={updatePublishDraft}
        onSubmit={(payload) => {
          closeAlertDialog();
          publishVideoSession?.(payload);
        }}
        publishDraft={publishDraftForSession}
        extraProps={{
          sessionId,
          publishedTitle,
          publishedDescription,
        }}
      />,
      undefined,
      false,
      { containerClassName: 'w-[calc(100vw-1.5rem)] max-w-xl' }
    );
  };

  const dropdownItems = [];
  if (shouldDownloadOnMain) {
    dropdownItems.push({
      label: 'Render again',
      onClick: submitRenderVideo,
    });
  } else if (canUseDownloadLink) {
    dropdownItems.push({
      label: 'Download',
      onClick: submitDownloadVideo,
    });
  }

  if (isSessionPublished) {
    dropdownItems.push({
      label: 'Republish',
      onClick: showPublishOptionsDialog,
    });
    dropdownItems.push({
      label: 'Unpublish',
      onClick: () => {
        setPublishDraft(null);
        if (typeof unpublishVideoSession === 'function') {
          unpublishVideoSession();
        }
      },
    });
  } else if (typeof publishVideoSession === 'function') {
    dropdownItems.push({
      label: 'Publish',
      onClick: showPublishOptionsDialog,
    });
  }

  if (canCancelPendingRender) {
    return (
      <div className='inline-flex items-center gap-2'>
        <CommonButton
          onClick={submitRenderVideo}
          isPending={shouldShowRenderPendingSpinner}
          isDisabled={true}
          extraClasses={renderButtonExtraClasses}
        >
          Render
        </CommonButton>
        <button
          type="button"
          onClick={cancelPendingRender}
          className={`inline-flex items-center justify-center rounded-lg transition-all duration-200 ease-out hover:-translate-y-[1px] active:translate-y-0 ${cancelButtonSizeClasses} ${cancelButtonClasses} ${cancelButtonShadow}`}
          title="Cancel render"
          aria-label="Cancel render"
        >
          <FaTimes />
        </button>
      </div>
    );
  }

  if (isAnonymousGuest && canUseDownloadLink) {
    return (
      <PublicPrimaryButton
        onClick={submitDownloadVideo}
        isPending={shouldShowRenderPendingSpinner}
        isDisabled={isRenderActionDisabled}
        extraClasses={renderButtonExtraClasses}
      >
        Download
      </PublicPrimaryButton>
    );
  }

  if (shouldShowDropdown) {
    return (
      <div className="relative inline-block text-left">
        <CommonDropdownButton
          mainLabel={dropdownMainLabel}
          onMainClick={shouldDownloadOnMain ? submitDownloadVideo : submitRenderVideo}
          isPending={shouldShowRenderPendingSpinner}
          isDisabled={isRenderActionDisabled}
          dropdownItems={dropdownItems}
          compact={compact}
          extraClasses="!m-0"
        />
      </div>
    );
  }

  return (
    <CommonButton
      onClick={submitRenderVideo}
      isPending={shouldShowRenderPendingSpinner}
      isDisabled={isRenderActionDisabled}
      extraClasses={renderButtonExtraClasses}
    >
      Render
    </CommonButton>
  );
}
