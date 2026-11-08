// Shared by the hydrated view and its loading placeholders.
export const VIDGENIE_PAGE_CLASS = 'vidgenie-page-shell workspace-page mx-auto w-full max-w-6xl px-2 pb-6 pt-[calc(var(--app-nav-height)+var(--workspace-inset))] sm:px-4';
export const VIDGENIE_EDITOR_CLASS = 'vidgenie-editor-shell relative mx-auto mt-2 w-full max-w-6xl overflow-x-hidden px-2 sm:mt-5 sm:px-6';
export const VIDGENIE_CARD_CLASS = 'vidgenie-editor-card relative mt-2 flex flex-col rounded-2xl p-3 sm:mt-6 sm:px-8 sm:py-5';

export function getVidgeniePreviewFrameStyle(aspectRatio) {
  const portrait = aspectRatio === '9:16';
  return {
    aspectRatio: portrait ? '9 / 16' : '16 / 9',
    width: portrait ? 'min(100%, 31.5dvh, 292px)' : 'min(100%, calc(100vw - 48px), 640px)',
    maxWidth: '100%',
    maxHeight: portrait ? 'min(56dvh, 520px)' : 'min(44dvh, 360px)',
  };
}
