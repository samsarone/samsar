
import { FaCheck } from 'react-icons/fa6';

import { MdOutlineRefresh } from "react-icons/md";

const ShapeSelectToolbar = ({ pos, onResetShape,  onCopyShape, onReplaceShape, editorVariant = 'videoStudio' }) => {
  const isImageStudio = editorVariant === 'imageStudio';
  return (
    <div
      style={{
        position: 'absolute',
        left: pos.x,
        top: pos.y,
        background: '#030712',
        borderRadius: isImageStudio ? '16px' : '5px',
        padding: isImageStudio ? '12px' : '5px',
        display: 'flex',
        justifyContent: 'center',
        zIndex: 1000,
      }}
    >
      <div className={`grid grid-cols-3 w-full text-center ${isImageStudio ? 'gap-2 text-sm font-medium' : ''}`}>
        <button onClick={onResetShape} style={{ margin: isImageStudio ? '0' : '0 5px' }} className={isImageStudio ? 'rounded-xl bg-white/5 px-3 py-2' : ''}>
        <MdOutlineRefresh className={`inline-flex ${isImageStudio ? 'text-lg' : ''}`} />
          Reset
        </button>
        <button onClick={onCopyShape} style={{ margin: isImageStudio ? '0' : '0 5px' }} className={isImageStudio ? 'rounded-xl bg-white/5 px-3 py-2' : ''}>
        <FaCheck className={`inline-flex ${isImageStudio ? 'text-lg' : ''}`} />
         Copy
        </button>
        <button onClick={onReplaceShape} style={{ margin: isImageStudio ? '0' : '0 5px' }} className={isImageStudio ? 'rounded-xl bg-white/5 px-3 py-2' : ''}>
        <FaCheck className={`inline-flex ${isImageStudio ? 'text-lg' : ''}`} />
         Replace
        </button>

      </div>
    </div>
  );
};

export default ShapeSelectToolbar;
