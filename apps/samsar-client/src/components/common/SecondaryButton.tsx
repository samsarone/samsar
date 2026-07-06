
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

  const bgColor = colorMode === 'dark' ? `text-[#d7ffeb] from-[#0f1b33] to-[#13243d]
   hover:from-[#172c49] hover:to-[#1c3658] hover:text-[#ebfff5]` :
    `text-neutral-100  from-blue-500 to-blue-600  hover:bg-blue-60 hover:text-neutral-300`;
  const interactionClasses =
    colorMode === 'dark'
      ? 'transition-all duration-200 ease-out hover:-translate-y-[1px] hover:shadow-[0_10px_20px_rgba(70,191,255,0.18)] active:translate-y-0'
      : 'transition-all duration-200 ease-out hover:-translate-y-[1px] active:translate-y-0';
  const buttonShadow = colorMode === 'dark' ? 'shadow-[0_6px_14px_rgba(3,12,28,0.2)]' : '';
  const additionalClasses = [extraClasses, className].filter(Boolean).join(" ");
  return (
    <button type={type} onClick={onClick} className={`m-auto text-center min-w-8
    rounded-lg
    ${bgColor}
    font-bold
    bg-gradient-to-r 
    pl-2 pr-2 pt-1 pb-1 text-bold
    ${buttonShadow}
    ${interactionClasses}
    cursor:pointer text-sm
    disabled:opacity-50 disabled:cursor-not-allowed disabled:bg-gray-800 disabled:text-neutral-100 ${additionalClasses}`}
      disabled={isBtnDisabled}>
      {children}
      {pendingSpinner}
    </button>
  )
}
