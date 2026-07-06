
import { useColorMode } from '../../contexts/ColorMode.jsx';

export default function MinimalTaskSkeleton({
  title = 'Processing task',
  subtitle = 'This can take a few minutes.',
  className = '',
}) {
  const { colorMode } = useColorMode();
  const isDark = colorMode === 'dark';

  const shell = isDark
    ? 'border border-[#1f2a3d] bg-[#0f1629]/90 text-slate-100 shadow-[0_18px_48px_rgba(0,0,0,0.4)]'
    : 'border border-slate-200 bg-white/95 text-slate-800 shadow-[0_18px_48px_rgba(15,23,42,0.12)]';
  const block = isDark ? 'bg-slate-700/70' : 'bg-slate-200';
  const line = isDark ? 'bg-slate-600/70' : 'bg-slate-200';
  const mutedText = isDark ? 'text-slate-400' : 'text-slate-500';

  return (
    <div className={`w-full max-w-xs rounded-2xl px-4 py-4 animate-pulse ${shell} ${className}`}>
      <div className="flex items-center gap-3">
        <div className={`h-10 w-10 rounded-xl ${block}`} />
        <div className="min-w-0 flex-1">
          <div className={`h-3 w-24 rounded-full ${line}`} />
          <div className={`mt-2 h-3 w-16 rounded-full ${line}`} />
        </div>
      </div>
      <div className="mt-4 space-y-2">
        <div className={`h-2 w-full rounded-full ${line}`} />
        <div className={`h-2 w-[84%] rounded-full ${line}`} />
        <div className={`h-2 w-[68%] rounded-full ${line}`} />
      </div>
      <div className="mt-4">
        <div className="text-sm font-medium">{title}</div>
        <div className={`mt-1 text-xs ${mutedText}`}>{subtitle}</div>
      </div>
    </div>
  );
}
