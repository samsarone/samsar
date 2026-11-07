import { useUiLanguage } from '../../../hooks/useUiLanguage.js';
import { translateText as uiText } from '../../../utils/localization.js';

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
  useUiLanguage();
  const { colorMode } = useColorMode();

  const surfaceClass = 'bg-surface text-fg border border-line';
  const mutedClass = 'text-fg-muted';
  const secondaryButtonClass = `border border-line-control bg-surface-raised text-fg-body ${colorMode === 'dark' ? 'hover:bg-[#292d3a]' : 'hover:bg-slate-50'}`;
  const badgeClass = colorMode === 'dark'
    ? 'bg-[#f6c453]/14 text-[#ffe0a3]'
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
        aria-label={uiText("Close")}
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
