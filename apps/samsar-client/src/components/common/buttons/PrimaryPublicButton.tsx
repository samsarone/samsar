import { useUiLanguage } from '../../../hooks/useUiLanguage.js';

import { FaSpinner } from "react-icons/fa6";

import { useColorMode } from "../../../contexts/ColorMode";

export default function PrimaryPublicButton(props) {
  useUiLanguage();
  const {
    children,
    onClick,
    isPending,
    isDisabled,
    extraClasses,
    tone = 'primary',
  } = props;

  const { colorMode } = useColorMode();


  let isBtnDisabled = false;

  if (isPending) {
    isBtnDisabled = true;
  }
  
  const pendingSpinner = isPending ? (
    <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2">
      <FaSpinner className="animate-spin" />
    </span>
  ) : null;

  const darkToneClasses = {
    primary: 'text-[#080a10] from-[#ff4655] to-[#ff6b4a] hover:from-[#ff6572] hover:to-[#ff8066]',
    amber: 'border border-[#f6c453]/70 text-[#101117] from-[#f6c453] to-[#ffe0a3] hover:from-[#ffe0a3] hover:to-[#fff1c8]',
    mint: 'border border-[#38d6a1]/70 text-[#07130f] from-[#38d6a1] to-[#6ee7c2] hover:from-[#6ee7c2] hover:to-[#a7f3d0]',
    neutral: 'border border-[#667188] text-[#f4f6fb] from-[#20232e] to-[#292d3a] hover:border-[#f6c453]/55 hover:from-[#292d3a] hover:to-[#343844]',
  };
  // Light mode: filled accent for primary/amber, outlined secondary for neutral/mint,
  // so a row of actions keeps a single primary call to action.
  const lightToneClasses = {
    primary: 'text-on-accent from-accent-from to-accent-to hover:from-accent-hover-from hover:to-accent-hover-to',
    amber: 'text-on-accent from-accent-from to-accent-to hover:from-accent-hover-from hover:to-accent-hover-to',
    mint: 'border border-control-border text-control-fg from-white to-white hover:from-slate-50 hover:to-slate-100 hover:text-control-fg-hover',
    neutral: 'border border-control-border text-control-fg from-white to-white hover:from-slate-50 hover:to-slate-100 hover:text-control-fg-hover',
  };
  const bgColor = colorMode === 'dark'
    ? darkToneClasses[tone] || darkToneClasses.primary
    : lightToneClasses[tone] || lightToneClasses.primary;
  const darkToneShadow = {
    primary: 'hover:shadow-[0_12px_28px_rgba(255,70,85,0.24)]',
    amber: 'hover:shadow-[0_12px_28px_rgba(246,196,83,0.20)]',
    mint: 'hover:shadow-[0_12px_28px_rgba(56,214,161,0.18)]',
    neutral: 'hover:shadow-[0_12px_28px_rgba(0,0,0,0.28)]',
  };
  const interactionClasses =
    colorMode === 'dark'
      ? `transition-all duration-200 ease-out hover:-translate-y-[1px] ${darkToneShadow[tone] || darkToneShadow.primary} active:translate-y-0`
      : 'transition-all duration-200 ease-out hover:-translate-y-[1px] hover:shadow-[0_10px_18px_rgba(15,23,42,0.14)] active:translate-y-0';
  return (
    <button onClick={onClick} className={`relative m-auto inline-flex min-h-11 min-w-16 items-center justify-center text-center sm:min-h-[38px]
    rounded-lg
    ${bgColor}
    text-sm font-semibold
  
    bg-gradient-to-r 
    px-4 py-1.5 whitespace-nowrap leading-none
    ${colorMode === 'dark' || tone === 'primary' || tone === 'amber' ? 'shadow-[0_8px_18px_rgba(3,12,28,0.22)]' : 'shadow-sm'}
    ${interactionClasses}
    focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus/80 focus-visible:ring-offset-2 focus-visible:ring-offset-canvas
    cursor-pointer
    disabled:opacity-50 disabled:cursor-not-allowed disabled:bg-gray-800 disabled:text-neutral-100 disabled:hover:translate-y-0 ${extraClasses}`}
    disabled={isBtnDisabled || isDisabled} 
    >
      <span className={`inline-flex items-center justify-center leading-none ${isPending ? 'pr-4' : ''}`}>
        {children}
      </span>
      {pendingSpinner}
    </button>
  )
}
