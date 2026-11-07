import { useUiLanguage } from '../../hooks/useUiLanguage.js';

import { FaSpinner } from "react-icons/fa6";
import { useUser } from "../../contexts/UserContext";

/*
 * Primary call-to-action button.
 *
 * Colours come from the theme tokens in index.css (accent / on-accent / focus /
 * canvas), so the button follows light and dark mode without reading colorMode.
 *
 * Optional props (backwards compatible — existing call sites render as before):
 *   variant: 'primary' (default) | 'secondary' | 'ghost' | 'danger'
 *   size:    'md' (default) | 'sm' | 'lg'
 */
const VARIANT_CLASSES = {
  primary:
    'bg-gradient-to-r from-accent-from to-accent-to text-on-accent hover:from-accent-hover-from hover:to-accent-hover-to dark:shadow-[0_8px_18px_rgba(3,12,28,0.22)] dark:hover:shadow-[0_12px_28px_rgba(255,70,85,0.24)] disabled:bg-gray-800 disabled:text-neutral-100',
  secondary:
    'border border-control-border bg-gradient-to-r from-surface to-surface-raised text-control-fg hover:from-surface-raised hover:to-surface-hover hover:text-control-fg-hover dark:hover:border-accent/55 dark:shadow-[0_6px_14px_rgba(3,12,28,0.2)]',
  ghost:
    'bg-transparent text-control-fg hover:bg-surface-hover hover:text-control-fg-hover',
  danger:
    'bg-gradient-to-r from-danger-from to-danger-to text-on-danger hover:brightness-110',
};

const SIZE_CLASSES = {
  sm: 'min-h-9 min-w-12 px-3 py-1 text-xs sm:min-h-8',
  md: 'min-h-11 min-w-16 px-4 py-1.5 text-sm sm:min-h-[38px]',
  lg: 'min-h-12 min-w-20 px-5 py-2 text-base sm:min-h-11',
};

export default function CommonButton(props) {
  useUiLanguage();
  const {
    children,
    onClick,
    isPending,
    isDisabled,
    extraClasses,
    className,
    type = "button",
    variant = "primary",
    size = "md",
  } = props;
  const { user } = useUser();

  let isBtnDisabled = false;

  if (!user || !user._id || isPending) {
    isBtnDisabled = true;
  }

  const pendingSpinner = isPending ? (
    <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2">
      <FaSpinner className="animate-spin" />
    </span>
  ) : null;

  const variantClasses = VARIANT_CLASSES[variant] || VARIANT_CLASSES.primary;
  const sizeClasses = SIZE_CLASSES[size] || SIZE_CLASSES.md;
  const additionalClasses = [extraClasses, className].filter(Boolean).join(" ");
  return (
    <button type={type} onClick={onClick} className={`relative m-auto inline-flex max-w-full items-center justify-center text-center
    rounded-lg
    ${sizeClasses}
    ${variantClasses}
    font-semibold leading-none
    transition-all duration-200 ease-out hover:-translate-y-[1px] active:translate-y-0 motion-reduce:transition-none motion-reduce:hover:translate-y-0
    focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus/80 focus-visible:ring-offset-2 focus-visible:ring-offset-canvas
    cursor-pointer
    disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:translate-y-0 ${additionalClasses}`}
    disabled={isBtnDisabled || isDisabled}
    >
      <span className={`inline-flex items-center justify-center leading-none ${isPending ? 'pr-4' : ''}`}>
        {children}
      </span>
      {pendingSpinner}
    </button>
  )
}
