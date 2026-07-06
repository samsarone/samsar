
import { FaSpinner } from "react-icons/fa6";

import { useColorMode } from "../../../contexts/ColorMode";

export default function PrimaryPublicButton(props) {
  const { children , onClick, isPending, isDisabled, extraClasses} = props;

  const { colorMode } = useColorMode();


  let isBtnDisabled = false;

  if (isPending) {
    isBtnDisabled = true;
  }
  
  const pendingSpinner = isPending ? (
    <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2">
      <FaSpinner className="animate-spin" />
    </span>
  ) : null;

  const bgColor = colorMode === 'dark' ? `text-[#041420] from-[#46bfff] to-[#39d881] hover:from-[#60cbff] hover:to-[#55e8a2]` :
    `text-neutral-100  from-blue-500 to-blue-600  hover:bg-blue-60 hover:text-neutral-300
    
    `;
  const interactionClasses =
    colorMode === 'dark'
      ? 'transition-all duration-200 ease-out hover:-translate-y-[1px] hover:shadow-[0_12px_24px_rgba(70,191,255,0.22)] active:translate-y-0'
      : 'transition-all duration-200 ease-out hover:-translate-y-[1px] hover:shadow-[0_10px_18px_rgba(15,23,42,0.14)] active:translate-y-0';
  return (
    <button onClick={onClick} className={`relative m-auto inline-flex min-h-[42px] min-w-16 items-center justify-center text-center
    rounded-lg
    ${bgColor}
    font-bold
  
    bg-gradient-to-r 
    pl-8 pr-8 pt-2 pb-2 text-bold whitespace-nowrap leading-none
    shadow-[0_8px_18px_rgba(3,12,28,0.22)]
    ${interactionClasses}
    cursor:pointer 
    disabled:opacity-50 disabled:cursor-not-allowed disabled:bg-gray-800 disabled:text-neutral-100 ${extraClasses}`}
    disabled={isBtnDisabled || isDisabled} 
    >
      <span className={`inline-flex items-center justify-center leading-none ${isPending ? 'pr-5' : ''}`}>
        {children}
      </span>
      {pendingSpinner}
    </button>
  )
}
