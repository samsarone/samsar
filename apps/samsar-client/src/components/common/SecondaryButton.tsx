import { useUiLanguage } from '../../hooks/useUiLanguage.js';

import { FaSpinner } from "react-icons/fa6";
import { useUser } from "../../contexts/UserContext";

/*
 * Secondary action button. Styled from the theme tokens in index.css so it reads
 * as secondary next to CommonButton in both themes (light mode previously
 * rendered it with the same blue gradient as the primary button).
 */
export default function SecondaryButton(props) {
  useUiLanguage();
  const { children, onClick, isPending, extraClasses, disabled, className, type } = props;
  const { user } = useUser();

  let isBtnDisabled = false;

  if (!user || !user._id || isPending || disabled) {
    isBtnDisabled = true;
  }

  let pendingSpinner = <span />;
  if (isPending) {
    pendingSpinner = <FaSpinner className="animate-spin inline-flex ml-2" />;
  }

  const additionalClasses = [extraClasses, className].filter(Boolean).join(" ");
  return (
    <button type={type} onClick={onClick} className={`m-auto inline-flex min-h-8 min-w-8 items-center justify-center gap-1.5 text-center
    rounded-lg
    border border-control-border text-control-fg
    bg-gradient-to-r from-surface to-surface-raised
    hover:from-surface-raised hover:to-surface-hover hover:text-control-fg-hover
    dark:hover:border-accent/55
    font-semibold
    px-2.5 py-1
    dark:shadow-[0_6px_14px_rgba(3,12,28,0.2)]
    transition-all duration-200 ease-out hover:-translate-y-[1px] active:translate-y-0 dark:hover:shadow-[0_10px_24px_rgba(255,70,85,0.16)] motion-reduce:transition-none motion-reduce:hover:translate-y-0
    focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus/80 focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--panel-background)]
    cursor-pointer text-sm
    disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:translate-y-0 disabled:bg-[var(--panel-raised)] disabled:text-[var(--panel-muted)] ${additionalClasses}`}
      disabled={isBtnDisabled}>
      {children}
      {pendingSpinner}
    </button>
  )
}
