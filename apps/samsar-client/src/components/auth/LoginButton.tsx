
import { FaSpinner } from "react-icons/fa6";
import { useUser } from "../../contexts/UserContext";
import { useColorMode } from "../../contexts/ColorMode";

export default function LoginButton(props) {
  const { children, onClick, isPending, extraClasses, type = 'button' } = props;
  useUser();
  const { colorMode } = useColorMode();

  let pendingSpinner = <span />;
  if (isPending) {
    pendingSpinner = <FaSpinner className="animate-spin inline-flex ml-2" />;
  }

  const bgColor = colorMode === 'dark' ? `text-[#080a10] from-[#ff4655] to-[#ff6b4a] hover:from-[#ff6572] hover:to-[#ff8066]` :
    `text-neutral-100  from-blue-500 to-blue-600  hover:bg-blue-60 hover:text-neutral-300`;
  const interactionClasses =
    colorMode === 'dark'
      ? 'transition-all duration-200 ease-out hover:-translate-y-[1px] hover:shadow-[0_12px_28px_rgba(255,70,85,0.24)] active:translate-y-0'
      : 'transition-all duration-200 ease-out hover:-translate-y-[1px] active:translate-y-0';
  const buttonShadow = colorMode === 'dark' ? 'shadow-[0_8px_18px_rgba(3,12,28,0.22)]' : '';
  return (
    <button type={type} onClick={onClick} className={`m-auto inline-flex min-h-11 min-w-16 items-center justify-center gap-1.5 text-center sm:min-h-[38px]
    rounded-lg
    ${bgColor}
    text-sm font-semibold
  
    bg-gradient-to-r 
    px-4 py-1.5
    ${buttonShadow}
    ${interactionClasses}
    focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ffe0a3]/80 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0c0d12]
    cursor-pointer
    disabled:opacity-50 disabled:cursor-not-allowed disabled:bg-gray-800 disabled:text-neutral-100 ${extraClasses}`}>
      {children}
      {pendingSpinner}
    </button>
  )
}
