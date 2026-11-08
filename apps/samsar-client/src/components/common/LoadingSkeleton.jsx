import { LoadingNavigation } from './WorkspaceNavigation.jsx';
import { useColorMode } from '../../contexts/ColorMode.jsx';

// Placeholders follow the page theme even before the provider updates the document.
export function SkeletonBlock({ className = '', style }) {
  const { colorMode } = useColorMode();
  return <div aria-hidden="true" style={style} className={`theme-skeleton-pulse min-w-0 rounded-lg ${colorMode === 'dark' ? 'bg-slate-700/60' : 'bg-slate-200'} ${className}`} />;
}

export function SkeletonStatus({ label, className = '', children, ...props }) {
  const { colorMode } = useColorMode();
  return (
    <div role="status" aria-busy="true" aria-label={label} className={`${colorMode === 'dark' ? 'text-slate-100' : 'text-slate-900'} ${className}`} {...props}>
      <span className="sr-only">{label}</span>
      <div aria-hidden="true">{children}</div>
    </div>
  );
}

export function SkeletonPage({ children, className = '' }) {
  const { colorMode } = useColorMode();
  return (
    <div className={`workspace-page min-h-[100dvh] ${colorMode === 'dark' ? 'bg-[linear-gradient(180deg,#15171f_0%,#12141c_44%,#0c0d12_100%)]' : 'bg-gradient-to-b from-[#eef3fb] via-[#e4ebf8] to-[#f7fbff]'} ${className}`}>
      <LoadingNavigation />
      {children}
    </div>
  );
}

export function SkeletonFields({ count = 6, className = 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3' }) {
  return <div className={`grid gap-3 sm:gap-4 ${className}`}>
    {Array.from({ length: count }, (_, index) => <div key={index} className="min-w-0 space-y-1.5">
      <SkeletonBlock className="h-3 w-20" />
      <SkeletonBlock className="h-9 w-full" />
    </div>)}
  </div>;
}
