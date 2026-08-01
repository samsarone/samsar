
import CommonContainer from '../../common/CommonContainer.tsx';
import { useColorMode } from '../../../contexts/ColorMode.jsx';

export default function StudioSkeletonLoader() {
  const { colorMode } = useColorMode();
  const isDark = colorMode === 'dark';

  const collapsedFrameToolbarWidth = 'min(10vw, 128px)';
  const collapsedRightPanelWidth = 'clamp(148px, 11vw, 168px)';
  const studioInsetPx = 16;
  const studioTopInsetPx = 72;
  const reservedLeftRailWidth = `calc(${collapsedFrameToolbarWidth} + ${studioInsetPx * 2}px)`;
  const reservedRightRailWidth = `calc(${collapsedRightPanelWidth} + ${studioInsetPx}px)`;

  const railSurface = isDark
    ? 'bg-[#20232e]/92 border border-[#3a4050] shadow-[0_12px_32px_rgba(0,0,0,0.30)] backdrop-blur-xl'
    : 'bg-white/90 border border-slate-200 shadow-[0_12px_30px_rgba(15,23,42,0.08)]';
  const workspaceSurface = isDark
    ? 'bg-[linear-gradient(180deg,#15171f_0%,#0c0d12_100%)]'
    : 'bg-gradient-to-br from-[#e9edf7] via-[#eef3fb] to-white';
  const canvasCardSurface = isDark
    ? 'bg-[#181b24] border border-[#3a4050] shadow-[0_16px_34px_rgba(2,6,23,0.18)]'
    : 'bg-[#f1f5f9] border border-slate-300 shadow-[0_14px_28px_rgba(15,23,42,0.08)]';
  const timelineSurface = isDark
    ? 'bg-[#181b24] border border-[#3a4050] shadow-[0_14px_36px_rgba(0,0,0,0.32)]'
    : 'bg-white/90 border border-slate-200 shadow-[0_14px_32px_rgba(15,23,42,0.06)]';
  const mutedSurface = isDark ? 'bg-[#273247]' : 'bg-slate-200';
  const subtleSurface = isDark ? 'bg-[#3b4862]' : 'bg-slate-300';

  return (
    <CommonContainer>
      <div
        className="box-border h-[100dvh] overflow-hidden px-4 pb-4"
        style={{ paddingTop: `${studioTopInsetPx}px` }}
        role="status"
        aria-busy="true"
        aria-label="Loading Studio"
      >
        <span className="sr-only">Loading Studio</span>
        <div className="theme-skeleton-pulse grid h-full min-h-0 grid-rows-[minmax(0,1fr)_auto] gap-4 overflow-hidden">
          <div className="flex min-h-0 gap-4 overflow-hidden">
            <div className="shrink-0" style={{ width: reservedLeftRailWidth }} />

            <div
              className="flex min-h-0 min-w-0 flex-1"
              style={{ paddingRight: reservedRightRailWidth }}
            >
              <div className={`${workspaceSurface} relative min-h-0 flex-1 overflow-hidden`}>
                <div className="flex h-full w-full items-center justify-center px-6 py-6">
                  <div
                    className={`${canvasCardSurface} rounded-xl px-4 py-6`}
                    style={{ width: 'min(78vw, 960px)' }}
                  >
                    <div className="mx-auto flex w-full max-w-[360px] items-center justify-center gap-2">
                      <div className={`${mutedSurface} h-10 flex-1 rounded-full`} />
                      <div className={`${mutedSurface} h-10 flex-1 rounded-full`} />
                    </div>

                    <div
                      className={`${mutedSurface} mx-auto mt-5 rounded-lg`}
                      style={{
                        width: 'min(64vw, 720px)',
                        height: 'min(48vw, 420px)',
                        maxHeight: '52vh',
                      }}
                    />

                    <div className="mx-auto mt-5 flex w-full max-w-[300px] items-center justify-center gap-2">
                      <div className={`${subtleSurface} h-9 w-9 rounded-lg`} />
                      <div className={`${mutedSurface} h-9 flex-1 rounded-full`} />
                      <div className={`${subtleSurface} h-9 w-9 rounded-lg`} />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="flex items-end gap-4 overflow-hidden">
            <div className="shrink-0" style={{ width: reservedLeftRailWidth }} />

            <div className="min-w-0 flex-1" style={{ paddingRight: reservedRightRailWidth }}>
              <div className={`${timelineSurface} overflow-hidden rounded-2xl p-3`}>
                <div className={`${mutedSurface} mb-3 h-4 w-full rounded-full`} />

                <div className="flex items-center gap-2">
                  <div className={`${subtleSurface} h-10 w-10 rounded-full`} />
                  <div className={`${mutedSurface} h-11 flex-1 rounded-lg`} />
                  <div className={`${subtleSurface} h-10 w-10 rounded-full`} />
                </div>
              </div>
            </div>
          </div>
        </div>

        <div
          className="theme-skeleton-pulse pointer-events-none fixed left-4 top-[72px] bottom-4 z-10"
          style={{ width: collapsedFrameToolbarWidth }}
        >
          <div className={`${railSurface} flex h-full flex-col rounded-2xl p-3`}>
            <div className={`${subtleSurface} h-14 rounded-xl`} />
            <div className={`${mutedSurface} mt-2 h-9 rounded-xl`} />

            <div className={`${mutedSurface} mt-4 h-6 w-10 rounded-full`} />
            <div className="mt-3 flex-1 rounded-xl">
              <div className={`${mutedSurface} h-full rounded-xl`} />
            </div>

            <div className={`${subtleSurface} mt-3 h-7 rounded-full`} />
          </div>
        </div>

        <div
          className="theme-skeleton-pulse pointer-events-none fixed top-[72px] right-4 bottom-4 z-10"
          style={{ width: collapsedRightPanelWidth }}
        >
          <div className={`${railSurface} flex h-full flex-col rounded-2xl p-3`}>
            <div className={`${mutedSurface} h-12 rounded-xl`} />

            <div className="mt-5 space-y-5">
              {[...Array(7)].map((_, index) => (
                <div key={`skeleton-tool-${index}`} className={`${mutedSurface} h-12 rounded-xl`} />
              ))}
            </div>

            <div className={`${subtleSurface} mt-auto h-16 rounded-full`} />
          </div>
        </div>

        <div className="theme-skeleton-pulse pointer-events-none fixed right-4 bottom-4 z-20">
          <div className={`${railSurface} flex items-center gap-3 rounded-full px-4 py-3`}>
            <div className="h-10 w-10 rounded-full bg-gradient-to-br from-[#343844] to-[#f6c453]/70" />
            <div className={`${mutedSurface} h-4 w-20 rounded-full`} />
          </div>
        </div>
      </div>
    </CommonContainer>
  );
}
