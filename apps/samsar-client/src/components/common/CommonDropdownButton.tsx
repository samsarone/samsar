import { useUiLanguage } from '../../hooks/useUiLanguage.js';
import { translateText as uiText } from '../../utils/localization.js';
import { Fragment } from "react";
import { Menu, Transition } from "@headlessui/react";
import { FaSpinner } from "react-icons/fa6";
import { useUser } from "../../contexts/UserContext";
import { useColorMode } from "../../contexts/ColorMode";

/**
 * A split-button that replicates the styling of CommonButton
 * but provides a main action + dropdown items, using Headless UI.
 *
 * Props:
 * - mainLabel:     string or JSX – the text shown on the main (left) button.
 * - onMainClick:   function – callback when user clicks the main (left) button.
 * - isPending:     boolean – show spinner & disable if true (similar to CommonButton).
 * - isDisabled:    boolean – additional disable logic.
 * - extraClasses:  string – optional extra tailwind classes for further styling.
 * - dropdownItems: array of { label: string, onClick: () => void } – the items in the dropdown.
 */
export default function CommonDropdownButton({
  mainLabel,
  onMainClick,
  isPending,
  isDisabled,
  extraClasses = "",
  dropdownItems = [],
  allowAnonymous = false,
  compact = false,
}) {
  useUiLanguage();
  // Access user context & color mode to replicate CommonButton logic
  const { user } = useUser();
  const { colorMode } = useColorMode();

  // Determine if button should be disabled
  const isBtnDisabled = ((!allowAnonymous && !user?._id) || isPending || isDisabled);

  // If isPending, show the spinner
  const pendingSpinner = isPending ? (
    <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2">
      <FaSpinner className="animate-spin" />
    </span>
  ) : null;

  // Replicate the gradient styles from CommonButton
  const gradientBg =
    colorMode === "dark"
      ? "text-[#080a10] from-[#ff4655] to-[#ff6b4a] hover:from-[#ff6572] hover:to-[#ff8066]"
      : "text-neutral-100 from-blue-500 to-blue-600 hover:text-neutral-300";
  const interactionClasses =
    colorMode === "dark"
      ? "transition-all duration-200 ease-out hover:-translate-y-[1px] hover:shadow-[0_12px_28px_rgba(255,70,85,0.24)] active:translate-y-0"
      : "transition-all duration-200 ease-out hover:-translate-y-[1px] active:translate-y-0";
  const buttonShadow = colorMode === "dark" ? "shadow-lg" : "";
  const menuSurface =
    colorMode === "dark"
      ? "bg-[#181b24]/95 ring-1 ring-[#3a4050] shadow-[0_18px_42px_rgba(0,0,0,0.38)] backdrop-blur-xl"
      : "bg-white ring-1 ring-slate-200";
  const menuItemBase = colorMode === "dark" ? "text-gray-300" : "text-slate-700";
  const menuItemActive = colorMode === "dark" ? "bg-[#292d3a] text-white" : "bg-slate-100 text-slate-900";

  const mainButtonSizeClasses = compact
    ? "min-h-[34px] px-3 py-1 text-xs"
    : "min-h-11 px-3 py-1.5 text-sm sm:min-h-[38px]";
  const menuButtonSizeClasses = compact
    ? "min-h-[34px] px-2 text-micro"
    : "min-h-11 px-2 text-caption sm:min-h-[38px]";

  return (
    <Menu as="div" className="relative z-[260] inline-block text-left">
      <div className={`flex ${buttonShadow}`}>
        {/* Main (left) portion of the split-button */}
        <button
          type="button"
          onClick={onMainClick}
          disabled={isBtnDisabled}
          className={`
            relative m-auto inline-flex min-w-16 items-center justify-center text-center
            rounded-l-lg
            font-semibold bg-gradient-to-r
            whitespace-nowrap leading-none
            cursor-pointer
            disabled:opacity-50 disabled:cursor-not-allowed
            disabled:bg-gray-800 disabled:text-neutral-100
            ${mainButtonSizeClasses}
            ${gradientBg}
            ${interactionClasses}
            focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ffe0a3]/80 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0c0d12]
            ${extraClasses}
          `}
        >
          <span className={`inline-flex items-center justify-center leading-none ${isPending ? "pr-5" : ""}`}>
            {mainLabel}
          </span>
          {pendingSpinner}
        </button>

        {/* Chevron (right) portion of the split-button */}
        <Menu.Button
          disabled={isBtnDisabled}
          aria-label={uiText("{value0} options", { value0: typeof mainLabel === "string" ? mainLabel : "Action" })}
          className={`
            inline-flex items-center justify-center
            rounded-r-lg
            font-semibold bg-gradient-to-r
            cursor-pointer
            disabled:opacity-50 disabled:cursor-not-allowed
            disabled:bg-gray-800 disabled:text-neutral-100
            ${menuButtonSizeClasses}
            ${gradientBg}
            ${interactionClasses}
            focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ffe0a3]/80 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0c0d12]
          `}
        >
          ▼
        </Menu.Button>
      </div>

      {/* Dropdown menu (Headless UI Transition for animations) */}
      <Transition
        as={Fragment}
        enter="transition ease-out duration-100"
        enterFrom="opacity-0 scale-95"
        enterTo="opacity-100 scale-100"
        leave="transition ease-in duration-75"
        leaveFrom="opacity-100 scale-100"
        leaveTo="opacity-0 scale-95"
      >
        <Menu.Items
          anchor={{ to: 'bottom end', gap: 8 }}
          portal
          className={`
            origin-top-right max-h-[calc(100dvh-24px)] overflow-y-auto
            w-36 rounded-lg p-1 z-[11050] ${menuSurface}
          `}
        >
          {dropdownItems.map((item, idx) => (
            <Menu.Item key={idx}>
              {({ active }) => (
                <button
                  type="button"
                  onClick={item.onClick}
                  className={`
                    block w-full rounded-md px-3 py-1.5 text-left text-xs
                    ${menuItemBase}
                    ${active ? menuItemActive : ""}
                    cursor-pointer
                  `}
                >
                  {item.label}
                </button>
              )}
            </Menu.Item>
          ))}
        </Menu.Items>
      </Transition>
    </Menu>
  );
}
