// Shared by the hydrated view and its loading placeholders.
export const VIDGENIE_PAGE_CLASS = 'vidgenie-page-shell workspace-page mx-auto w-full max-w-6xl px-3 pb-6 pt-[calc(var(--app-nav-height)+var(--workspace-inset))] sm:px-6';
export const VIDGENIE_EDITOR_CLASS = 'vidgenie-editor-shell relative mx-auto w-full min-w-0';
export const VIDGENIE_CARD_CLASS = 'vidgenie-editor-card relative flex flex-col rounded-2xl p-4 sm:p-6';

export function getVidgeniePreviewFrameStyle(aspectRatio) {
  const portrait = aspectRatio === '9:16';
  return {
    aspectRatio: portrait ? '9 / 16' : '16 / 9',
    width: portrait ? 'min(100%, 31.5dvh, 292px)' : 'min(100%, calc(100vw - 48px), 640px)',
    maxWidth: '100%',
    maxHeight: portrait ? 'min(56dvh, 520px)' : 'min(44dvh, 360px)',
  };
}
