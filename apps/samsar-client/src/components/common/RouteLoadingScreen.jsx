import { useColorMode } from '../../contexts/ColorMode.jsx';

export default function RouteLoadingScreen({ label = 'Loading...' }) {
  const { colorMode } = useColorMode();
  const isDark = colorMode === 'dark';

  return (
    <div
      className={`flex min-h-screen items-center justify-center ${
        isDark
          ? 'bg-[#0b1021] text-slate-100'
          : 'bg-[#f7f9fc] text-slate-700'
      }`}
    >
      <div className="flex flex-col items-center gap-4">
        <div
          className={`h-10 w-10 animate-spin rounded-full border-4 border-t-transparent ${
            isDark ? 'border-cyan-300/70' : 'border-sky-500/70'
          }`}
          aria-hidden="true"
        />
        <p className="text-sm font-medium">{label}</p>
      </div>
    </div>
  );
}
