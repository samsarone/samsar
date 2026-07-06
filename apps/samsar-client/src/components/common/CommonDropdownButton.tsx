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
      ? "text-[#041420] from-[#46bfff] to-[#39d881] hover:from-[#60cbff] hover:to-[#55e8a2]"
      : "text-neutral-100 from-blue-500 to-blue-600 hover:text-neutral-300";
  const interactionClasses =
    colorMode === "dark"
      ? "transition-all duration-200 ease-out hover:-translate-y-[1px] hover:shadow-[0_12px_24px_rgba(70,191,255,0.22)] active:translate-y-0"
      : "transition-all duration-200 ease-out hover:-translate-y-[1px] active:translate-y-0";
  const buttonShadow = colorMode === "dark" ? "shadow-lg" : "";
  const mainButtonShadow = colorMode === "dark" ? "shadow-sm" : "";
  const menuSurface =
    colorMode === "dark"
      ? "bg-neutral-900/95 ring-1 ring-white/10 shadow-[0_16px_30px_rgba(0,0,0,0.42)]"
      : "bg-white ring-1 ring-slate-200";
  const menuItemBase = colorMode === "dark" ? "text-gray-300" : "text-slate-700";
  const menuItemActive = colorMode === "dark" ? "bg-gray-800 text-white" : "bg-slate-100 text-slate-900";

  const mainButtonSizeClasses = compact
    ? "min-h-[34px] px-3 py-1.5 text-sm"
    : "min-h-[42px] px-3 py-2";
  const menuButtonSizeClasses = compact
    ? "min-h-[34px] px-2 text-[11px]"
    : "min-h-[42px] px-2";

  return (
    <Menu as="div" className="relative z-[260] inline-block text-left">
      <div className={`flex ${buttonShadow}`}>
        {/* Main (left) portion of the split-button */}
        <button
          onClick={onMainClick}
          disabled={isBtnDisabled}
          className={`
            relative m-auto inline-flex min-w-16 items-center justify-center text-center
            rounded-l-lg ${mainButtonShadow}
            font-bold bg-gradient-to-r
            whitespace-nowrap leading-none
            cursor-pointer
            disabled:opacity-50 disabled:cursor-not-allowed
            disabled:bg-gray-800 disabled:text-neutral-100
            ${mainButtonSizeClasses}
            ${gradientBg}
            ${interactionClasses}
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
          className={`
            inline-flex items-center justify-center
            rounded-r-lg
            font-bold bg-gradient-to-r
            cursor-pointer
            disabled:opacity-50 disabled:cursor-not-allowed
            disabled:bg-gray-800 disabled:text-neutral-100
            ${menuButtonSizeClasses}
            ${gradientBg}
            ${interactionClasses}
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
          className={`
            origin-top-right absolute right-0 mt-2
            w-36 rounded z-[320] ${menuSurface}
          `}
        >
          {dropdownItems.map((item, idx) => (
            <Menu.Item key={idx}>
              {({ active }) => (
                <div
                  onClick={item.onClick}
                  className={`
                    block pl-8 py-2 text-sm
                    ${menuItemBase}
                    ${active ? menuItemActive : ""}
                    cursor-pointer
                  `}
                >
                  {item.label}
                </div>
              )}
            </Menu.Item>
          ))}
        </Menu.Items>
      </Transition>
    </Menu>
  );
}
