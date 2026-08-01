
import { FaSpinner } from "react-icons/fa6";
import { useUser } from "../../contexts/UserContext";
import { useColorMode } from "../../contexts/ColorMode";

export default function CommonButton(props) {
  const {
    children,
    onClick,
    isPending,
    isDisabled,
    extraClasses,
    className,
    type = "button",
  } = props;
  const { user } = useUser();
  const { colorMode } = useColorMode();


  let isBtnDisabled = false;

  if (!user || !user._id || isPending) {
    isBtnDisabled = true;
  }
  
  const pendingSpinner = isPending ? (
    <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2">
      <FaSpinner className="animate-spin" />
    </span>
  ) : null;

  const bgColor = colorMode === 'dark' ? `text-[#080a10] from-[#ff4655] to-[#ff6b4a] hover:from-[#ff6572] hover:to-[#ff8066]` :
    `text-neutral-100  from-blue-500 to-blue-600  hover:bg-blue-60 hover:text-neutral-300
    
    `;
  const interactionClasses =
    colorMode === 'dark'
      ? 'transition-all duration-200 ease-out hover:-translate-y-[1px] hover:shadow-[0_12px_28px_rgba(255,70,85,0.24)] active:translate-y-0'
      : 'transition-all duration-200 ease-out hover:-translate-y-[1px] active:translate-y-0';
  const buttonShadow = colorMode === 'dark' ? 'shadow-[0_8px_18px_rgba(3,12,28,0.22)]' : '';
  const additionalClasses = [extraClasses, className].filter(Boolean).join(" ");
  return (
    <button type={type} onClick={onClick} className={`relative m-auto inline-flex min-h-11 min-w-16 max-w-full items-center justify-center text-center sm:min-h-[38px]
    rounded-lg
    ${bgColor}
    text-sm font-semibold
  
    bg-gradient-to-r 
    px-4 py-1.5 leading-none
    ${buttonShadow}
    ${interactionClasses}
    focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ffe0a3]/80 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0c0d12]
    cursor-pointer
    disabled:opacity-50 disabled:cursor-not-allowed disabled:bg-gray-800 disabled:text-neutral-100 ${additionalClasses}`}
    disabled={isBtnDisabled || isDisabled} 
    >
      <span className={`inline-flex items-center justify-center leading-none ${isPending ? 'pr-4' : ''}`}>
        {children}
      </span>
      {pendingSpinner}
    </button>
  )
}
