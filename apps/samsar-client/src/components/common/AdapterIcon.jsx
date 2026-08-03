import {
  SiAlibabacloud,
  SiGooglecloud,
  SiOpenai,
} from "react-icons/si";
import {
  TbBolt,
  TbBraces,
  TbPlugConnected,
  TbRouteAltRight,
} from "react-icons/tb";

import { useColorMode } from "../../contexts/ColorMode.jsx";
import { getAdapterPresentation } from "../../utils/adapterPresentation.mjs";

const MARK_COMPONENTS = Object.freeze({
  openai: SiOpenai,
  googleCloud: SiGooglecloud,
  alibabaCloud: SiAlibabacloud,
  genblaze: TbBolt,
  openrouter: TbRouteAltRight,
  native: TbPlugConnected,
  custom: TbBraces,
});

export default function AdapterIcon({
  adapterKey,
  adapterLabel,
  tooltipId,
  className = "",
}) {
  const { colorMode } = useColorMode();
  const presentation = getAdapterPresentation(adapterKey, {
    label: adapterLabel,
  });
  if (!presentation) return null;

  const Mark = MARK_COMPONENTS[presentation.mark];
  const accessibleLabel = /\badapter$/i.test(presentation.label)
    ? presentation.label
    : `${presentation.label} adapter`;
  const surfaceClassName = colorMode === "dark"
    ? "border-[#667188]/80 bg-[#20232e] text-[#f6c453] shadow-[0_4px_12px_rgba(0,0,0,0.22)] hover:border-[#f6c453]/65 hover:bg-[#292d3a] hover:text-[#ffe0a3] focus:outline-none focus:ring-2 focus:ring-[#f6c453]/55"
    : "border-slate-300 bg-slate-100 text-slate-700 shadow-sm hover:border-slate-400 hover:bg-white hover:text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-400/70";

  return (
    <span
      role="img"
      aria-label={accessibleLabel}
      tabIndex={0}
      title={tooltipId ? undefined : presentation.label}
      data-tooltip-id={tooltipId || undefined}
      data-tooltip-content={tooltipId ? presentation.label : undefined}
      data-adapter-key={presentation.key}
      className={`inline-flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-md border transition-colors ${surfaceClassName} ${className}`}
    >
      {Mark ? (
        <Mark className="h-[13px] w-[13px]" aria-hidden="true" />
      ) : (
        <span
          className={`font-black leading-none ${presentation.glyph.length > 1 ? "text-[8px] tracking-[-0.08em]" : "text-[11px]"}`}
          aria-hidden="true"
        >
          {presentation.glyph}
        </span>
      )}
    </span>
  );
}
