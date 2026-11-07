import { useUiLanguage } from '../../../hooks/useUiLanguage.js';

import { useColorMode } from '../../../contexts/ColorMode.jsx';
import { FaChevronCircleRight } from 'react-icons/fa';
export default function FrameToolbarMinimal(props) {
  useUiLanguage();

  const { onToggleDisplay } = props;

  const { colorMode } = useColorMode();

  return (
    <div
      className={`h-full m-auto fixed top-0 overflow-y-auto pl-1 w-[2%] pr-0 transition-colors duration-200 bg-surface border-r border-line text-fg-body ${colorMode === 'dark' ? 'shadow-[0_10px_28px_rgba(0,0,0,0.35)]' : ''}`}
    >
      <div className='mt-[80px]'>
        <FaChevronCircleRight
          className={`text-lg cursor-pointer transition-colors duration-150 ${
            colorMode === 'dark' ? 'text-slate-200 hover:text-slate-100' : 'text-slate-500 hover:text-slate-700'
          }`}
          onClick={onToggleDisplay}
        />
      </div>
    </div>    
  );
}
