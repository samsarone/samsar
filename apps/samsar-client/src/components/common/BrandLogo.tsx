
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
          ? 'border border-white/[0.08] bg-white/[0.035] text-[#f4f6fb] shadow-[0_8px_24px_rgba(0,0,0,0.3)] hover:border-[#ff4655]/40 hover:bg-white/[0.055] hover:shadow-[0_12px_30px_rgba(255,70,85,0.14)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ffe0a3]/70'
          : 'border border-[#cbd6e6] bg-gradient-to-r from-[#d9e2f0] via-[#cfd9eb] to-[#e6ecf7] text-[#0f1a2f]'
      } ${className}`}
      aria-label={ariaLabel}
    >
      <span
        className={`text-[11px] sm:text-[12px] font-black uppercase tracking-[0.18em] ${
          isDark ? 'text-[#f4f6fb]' : 'text-[#0f1a2f]'
        }`}
      >
        {brandName}
      </span>
      <span
        className={`text-[11px] sm:text-[12px] font-black uppercase tracking-[0.18em] ${
          isDark ? 'text-[#ff7f8a]' : 'text-[#ff6b3b]'
        }`}
      >
        {studioLabel}
      </span>
    </button>
  );
}
