
import { useColorMode } from '../../../contexts/ColorMode.jsx';
import { FaCheck } from 'react-icons/fa6';

import { MdOutlineRefresh } from "react-icons/md";


export default function PaintToolbar(props) {
  const {
    pos,
    addPaintImage,
    resetPaintImage,
    editorVariant = 'videoStudio',
  } = props;

  const { colorMode } = useColorMode();
  const isImageStudio = editorVariant === 'imageStudio';

  const iconColor = colorMode === 'dark' ? 'text-neutral-200' : 'text-slate-600';
  const panelStyles = {
    position: 'absolute',
    left: pos.x,
    top: pos.y,
    background: colorMode === 'dark' ? 'rgba(3, 7, 18, 0.95)' : 'rgba(248, 250, 252, 0.98)',
    border: colorMode === 'dark'
      ? '1px solid rgba(148, 163, 184, 0.25)'
      : '1px solid rgba(148, 163, 184, 0.4)',
    boxShadow: colorMode === 'dark'
      ? '0 18px 45px rgba(15, 23, 42, 0.6)'
      : '0 18px 45px rgba(15, 23, 42, 0.12)',
    color: colorMode === 'dark' ? '#e2e8f0' : '#0f172a',
    width: isImageStudio ? '420px' : '350px',
    borderRadius: isImageStudio ? '16px' : '12px',
    padding: isImageStudio ? '14px' : '12px',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    zIndex: 1000,
    backdropFilter: 'blur(6px)'
  };

  return (
    <div key={pos.id} style={panelStyles}>

      <div className={`grid grid-cols-2 w-full text-center ${isImageStudio ? 'gap-2 text-sm font-medium' : ''}`}>
        <div className={isImageStudio ? 'rounded-xl px-3 py-2 bg-white/5 cursor-pointer' : 'cursor-pointer'} onClick={() => resetPaintImage()}>
          <MdOutlineRefresh className={`inline-flex ${iconColor} ${isImageStudio ? 'text-lg' : ''}`} />
          Reset
        </div>
        <div className={isImageStudio ? 'rounded-xl px-3 py-2 bg-white/5 cursor-pointer' : 'cursor-pointer'} onClick={() => addPaintImage()}>
          <FaCheck className={`inline-flex ${iconColor} ${isImageStudio ? 'text-lg' : ''}`}  />
          Apply
        </div>
      </div>
    </div>
  );
}
