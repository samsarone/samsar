
import { FaTimes } from 'react-icons/fa';
import { useColorMode } from '../../../contexts/ColorMode.jsx';

export default function CanvasActionOptionsDialog({
  title,
  subtitle,
  badge,
  children,
  footer,
  onClose,
  maxWidth = '760px',
}) {
  const { colorMode } = useColorMode();

  const surfaceClass = colorMode === 'dark'
    ? 'bg-[#0f1629] text-slate-100 border border-[#1f2a3d]'
    : 'bg-white text-slate-900 border border-slate-200';
  const mutedClass = colorMode === 'dark' ? 'text-slate-400' : 'text-slate-500';
  const secondaryButtonClass = colorMode === 'dark'
    ? 'border border-[#273956] bg-[#111a2f] text-slate-100 hover:bg-[#172642]'
    : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50';
  const badgeClass = colorMode === 'dark'
    ? 'bg-cyan-500/15 text-cyan-200'
    : 'bg-blue-50 text-blue-700';

  return (
    <div
      className={`relative max-h-[82vh] overflow-y-auto rounded-2xl p-5 text-left shadow-2xl ${surfaceClass}`}
      style={{ width: `min(92vw, ${maxWidth})` }}
    >
      <button
        type="button"
        className={`absolute right-4 top-4 rounded-full p-2 ${secondaryButtonClass}`}
        onClick={onClose}
        aria-label="Close"
      >
        <FaTimes />
      </button>

      <div className="pr-12">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-lg font-semibold">{title}</h2>
          {badge && (
            <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${badgeClass}`}>
              {badge}
            </span>
          )}
        </div>
        {subtitle && <div className={`mt-1 text-xs ${mutedClass}`}>{subtitle}</div>}
      </div>

      <div className="mt-5">
        {children}
      </div>

      {footer && (
        <div className="mt-5 flex flex-wrap items-center justify-end gap-3">
          {footer}
        </div>
      )}
    </div>
  );
}
