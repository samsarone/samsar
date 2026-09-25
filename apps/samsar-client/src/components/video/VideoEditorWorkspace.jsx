export default function VideoEditorWorkspace({ isLibraryView, isRenderPending, className = '', children }) {
  // The canvas can exceed the viewport at its current zoom. The library must fit it.
  return (
    <div
      className={`min-h-0 min-w-0 flex-1 px-6 py-6 text-center ${isLibraryView ? 'overflow-hidden' : 'overflow-auto'} ${className}`}
      aria-disabled={isRenderPending}
    >
      <div className={isLibraryView
        ? 'h-full w-full min-h-0 min-w-0 overflow-hidden'
        : 'grid h-max min-h-full w-max min-w-full place-items-center overflow-visible'}
      >
        {children}
      </div>
    </div>
  );
}
