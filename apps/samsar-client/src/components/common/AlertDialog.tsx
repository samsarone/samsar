
import { FaTimes } from 'react-icons/fa';
import { useAlertDialog } from '../../contexts/AlertDialogContext';
import { useColorMode } from '../../contexts/ColorMode';

export function AlertDialog() {
  const { isAlertDialogOpen, alertDialogContent, closeAlertDialog, useXL, dialogOptions } = useAlertDialog();
  const { colorMode } = useColorMode();

  if (!isAlertDialogOpen) return null;

  const isAuthSurface = dialogOptions?.surface === 'auth';
  const isTransparentShell = Boolean(dialogOptions?.transparentShell);
  let bgColor = colorMode === 'dark' ? 'bg-gray-900 text-neutral-100' : 'bg-neutral-100 text-neutral-900';
  if (isAuthSurface) {
    bgColor = colorMode === 'dark' ? 'bg-slate-950 text-slate-100' : 'bg-white text-slate-900';
  }
  if (isTransparentShell) {
    bgColor = 'bg-transparent';
  }
  const defaultDialogWidthClass = useXL
    ? 'w-[calc(100vw-1.5rem)] max-w-6xl'
    : isAuthSurface
      ? 'w-full max-w-md'
      : 'w-[calc(100vw-1.5rem)] max-w-lg';
  const dialogWidthClass = dialogOptions?.containerClassName || defaultDialogWidthClass;
  const dialogBorderClass = dialogOptions?.hideBorder
    ? isTransparentShell ? 'border-0' : 'border border-transparent'
    : 'border';
  const dialogPaddingClass = dialogOptions?.fullBleed ? 'p-0' : 'p-4 sm:p-5';
  const dialogPositionClass = dialogOptions?.centerContent ? '' : 'my-4 sm:my-8';
  const dialogRadiusClass = isTransparentShell ? '' : dialogOptions?.fullBleed ? 'rounded-xl' : 'rounded-lg';
  const dialogShadowClass = isTransparentShell || (isAuthSurface && colorMode === 'light') ? '' : 'shadow-lg';
  const overlayClass = dialogOptions?.centerContent
    ? 'fixed inset-0 overflow-y-auto bg-slate-950/50 p-3 sm:p-4 flex items-center justify-center'
    : 'fixed inset-0 overflow-y-auto bg-slate-950/50 p-3 sm:p-4 flex items-start justify-center';
  const contentClass = dialogOptions?.centerContent
    ? 'w-full min-h-full flex items-center justify-center text-left'
    : 'text-center max-h-[calc(100dvh-4rem)] overflow-y-auto pr-1';


  return (
    <div
      className={overlayClass}
      style={{ zIndex: 10000 }}
      onClick={closeAlertDialog}
    >
      <div
        className={`relative mx-auto ${dialogShadowClass} ${dialogPositionClass} ${dialogPaddingClass} ${dialogRadiusClass} ${bgColor} ${dialogWidthClass} ${dialogBorderClass}`}
        onClick={(event) => event.stopPropagation()}
      >
        {!dialogOptions?.hideCloseButton && (
          <button
            type="button"
            aria-label="Close dialog"
            className={`absolute right-3 top-3 z-10 inline-flex h-9 w-9 items-center justify-center rounded-full transition focus:outline-none focus:ring-2 ${
              colorMode === 'dark'
                ? 'text-slate-400 hover:bg-white/5 hover:text-slate-100 focus:ring-cyan-400/40'
                : 'text-slate-500 hover:bg-slate-200/70 hover:text-slate-900 focus:ring-slate-300'
            }`}
            onClick={closeAlertDialog}
          >
            <FaTimes className="text-sm" />
          </button>
        )}
        <div className={contentClass}>
          {alertDialogContent}
        </div>
      </div>
    </div>
  );
}
