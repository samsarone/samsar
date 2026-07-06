
import { useColorMode } from '../../contexts/ColorMode.jsx';
import { useLocalization } from '../../contexts/LocalizationContext.jsx';

type BrandLogoProps = {
  onClick?: () => void;
  className?: string;
};

export default function BrandLogo({ onClick, className = '' }: BrandLogoProps) {
  const { colorMode } = useColorMode();
  const { t } = useLocalization();
  const isDark = colorMode === 'dark';
  const brandName = 'Samsar';
  const studioLabel = t('common.studio');
  const ariaLabel = `${brandName} ${studioLabel}`;

  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center justify-center gap-2 rounded-lg px-3 py-[8px] text-center transition-all duration-200 ease-out hover:-translate-y-[1px] ${
        isDark
          ? 'bg-gradient-to-r from-[#081425] via-[#0f233a] to-[#0a1a2e] text-[#e8edf7] shadow-[0_10px_24px_rgba(0,0,0,0.42)] hover:brightness-[1.03] hover:shadow-[0_14px_30px_rgba(70,191,255,0.2)]'
          : 'border border-[#cbd6e6] bg-gradient-to-r from-[#d9e2f0] via-[#cfd9eb] to-[#e6ecf7] text-[#0f1a2f]'
      } ${className}`}
      aria-label={ariaLabel}
    >
      <span
        className={`text-[11px] sm:text-[12px] font-black uppercase tracking-[0.18em] ${
          isDark ? 'text-[#89dcff]' : 'text-[#0f1a2f]'
        }`}
      >
        {brandName}
      </span>
      <span
        className={`text-[11px] sm:text-[12px] font-black uppercase tracking-[0.18em] ${
          isDark ? 'text-[#72f1b0]' : 'text-[#ff6b3b]'
        }`}
      >
        {studioLabel}
      </span>
    </button>
  );
}
