
import { useColorMode } from '../../contexts/ColorMode.jsx';

export default function VidgenieSkeletonLoader() {
  const { colorMode } = useColorMode();
  const isDark = colorMode === 'dark';

  const shellBg = isDark
    ? 'bg-gradient-to-b from-[#080f21] via-[#0d1830] to-[#0b1226]'
    : 'bg-gradient-to-br from-[#e9edf7] via-[#eef3fb] to-white';

  const surface = isDark
    ? 'bg-[#0f1629] border border-[#1f2a3d] shadow-[0_18px_48px_rgba(0,0,0,0.45)]'
    : 'bg-white border border-slate-200 shadow-[0_16px_40px_rgba(15,23,42,0.08)]';

  const mutedSurface = isDark ? 'bg-[#121b33]' : 'bg-slate-100';
  const subtleSurface = isDark ? 'bg-[#1b2942]' : 'bg-slate-200';

  return (
    <div
      className={`${shellBg} fixed inset-0 z-40 min-h-screen w-full overflow-x-hidden overflow-y-auto ${
        isDark ? 'text-slate-100' : 'text-slate-900'
      }`}
    >
      <div className="mx-auto max-w-screen-xl min-w-0 space-y-5 px-4 py-6 sm:px-6">
        <div className={`${surface} flex min-w-0 animate-pulse flex-col gap-3 rounded-2xl px-5 py-4 sm:flex-row sm:items-center sm:justify-between`}>
          <div className="flex min-w-0 items-center gap-3">
            <div className={`${subtleSurface} h-10 w-10 rounded-xl`} />
            <div className="min-w-0 flex-1 space-y-2">
              <div className={`${mutedSurface} h-3 w-full max-w-28 rounded-full`} />
              <div className={`${mutedSurface} h-3 w-full max-w-16 rounded-full`} />
            </div>
          </div>
          <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_2.5rem_2.5rem] items-center gap-3 sm:flex sm:w-auto">
            <div className={`${mutedSurface} h-10 w-full max-w-28 rounded-full`} />
            <div className={`${mutedSurface} h-10 w-10 rounded-full`} />
            <div className={`${mutedSurface} h-10 w-10 rounded-full`} />
          </div>
        </div>

        <div className={`${surface} min-w-0 animate-pulse space-y-5 rounded-2xl p-5`}>
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
            <div className="min-w-0 flex-1 space-y-3">
              <div className={`${mutedSurface} h-4 w-full max-w-44 rounded-full`} />
              <div className={`${mutedSurface} h-3 w-full max-w-72 rounded-full`} />
            </div>
            <div className="flex min-w-0 items-center gap-2">
              <div className={`${mutedSurface} h-10 min-w-0 flex-1 rounded-full sm:w-28 sm:flex-none`} />
              <div className={`${mutedSurface} h-10 w-10 rounded-full`} />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {[...Array(7)].map((_, idx) => (
              <div
                key={`option-${idx}`}
                className={`${mutedSurface} h-12 rounded-xl border border-white/5`}
              />
            ))}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-[3fr_2fr] gap-4 items-start">
            <div className={`${mutedSurface} rounded-2xl relative overflow-hidden`}>
              <div className="absolute inset-4 border-2 border-dashed border-white/10 rounded-2xl" />
              <div className="absolute top-4 left-4 h-4 w-24 rounded-full bg-white/10" />
              <div className="absolute bottom-4 left-4 h-3 w-40 rounded-full bg-white/10" />
              <div className="absolute bottom-4 right-4 flex gap-2">
                <div className="h-9 w-9 rounded-full bg-white/10" />
                <div className="h-9 w-20 rounded-full bg-white/10" />
              </div>
              <div className="aspect-video" />
            </div>

            <div className="space-y-3">
              <div className={`${mutedSurface} h-6 rounded-lg w-32`} />
              {[...Array(3)].map((_, idx) => (
                <div
                  key={`status-${idx}`}
                  className={`${mutedSurface} h-10 rounded-xl border border-white/5`}
                />
              ))}
              <div className={`${mutedSurface} h-16 rounded-xl`} />
            </div>
          </div>

          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className={`${mutedSurface} h-4 w-28 rounded-full`} />
              <div className="flex gap-2">
                <div className={`${mutedSurface} h-10 w-10 rounded-full`} />
                <div className={`${mutedSurface} h-10 w-24 rounded-full`} />
              </div>
            </div>
            <div className={`${mutedSurface} h-32 rounded-2xl`} />
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex gap-2">
                <div className={`${mutedSurface} h-10 w-28 rounded-full`} />
                <div className={`${mutedSurface} h-10 w-10 rounded-full`} />
              </div>
              <div className="flex gap-2">
                <div className={`${mutedSurface} h-10 w-10 rounded-full`} />
                <div className={`${mutedSurface} h-10 w-10 rounded-full`} />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
