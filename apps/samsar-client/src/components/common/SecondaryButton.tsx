
import { FaSpinner } from "react-icons/fa6";
import { useUser } from "../../contexts/UserContext";
import { useColorMode } from "../../contexts/ColorMode";

export default function SecondaryButton(props) {
  const { children, onClick, isPending, extraClasses, disabled, className, type } = props;
  const { user } = useUser();
  const { colorMode } = useColorMode();


  let isBtnDisabled = false;

  if (!user || !user._id || isPending || disabled) {
    isBtnDisabled = true;
  }

  let pendingSpinner = <span />;
  if (isPending) {
    pendingSpinner = <FaSpinner className="animate-spin inline-flex ml-2" />;
  }

  const bgColor = colorMode === 'dark' ? `border border-[#667188] text-[#b6bfd0] from-[#181b24] to-[#20232e]
   hover:border-[#ff4655]/55 hover:from-[#20232e] hover:to-[#292d3a] hover:text-[#f4f6fb]` :
    `text-neutral-100  from-blue-500 to-blue-600  hover:bg-blue-60 hover:text-neutral-300`;
  const interactionClasses =
    colorMode === 'dark'
      ? 'transition-all duration-200 ease-out hover:-translate-y-[1px] hover:shadow-[0_10px_24px_rgba(255,70,85,0.16)] active:translate-y-0'
      : 'transition-all duration-200 ease-out hover:-translate-y-[1px] active:translate-y-0';
  const buttonShadow = colorMode === 'dark' ? 'shadow-[0_6px_14px_rgba(3,12,28,0.2)]' : '';
  const additionalClasses = [extraClasses, className].filter(Boolean).join(" ");
  return (
    <button type={type} onClick={onClick} className={`m-auto inline-flex min-h-8 min-w-8 items-center justify-center gap-1.5 text-center
    rounded-lg
    ${bgColor}
    font-semibold
    bg-gradient-to-r 
    px-2.5 py-1
    ${buttonShadow}
    ${interactionClasses}
    focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ffe0a3]/80 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0c0d12]
    cursor-pointer text-sm
    disabled:opacity-50 disabled:cursor-not-allowed disabled:bg-gray-800 disabled:text-neutral-100 ${additionalClasses}`}
      disabled={isBtnDisabled}>
      {children}
      {pendingSpinner}
    </button>
  )
}
