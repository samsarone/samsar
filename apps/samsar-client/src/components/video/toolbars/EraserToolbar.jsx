
import { useColorMode } from '../../../contexts/ColorMode.jsx';
import { FaCheck } from 'react-icons/fa6';
import { FaRedo, FaUndo } from 'react-icons/fa';

import { MdOutlineRefresh } from "react-icons/md";


export default function EraserToolbar(props) {
  const {
    pos,
    replaceEraserImage,
    undoEraserStroke,
    redoEraserStroke,
    eraserUndoCount = 0,
    eraserRedoCount = 0,
    eraserHistoryLimit = 5,
    canUndoEraserStroke = false,
    canRedoEraserStroke = false,
    resetEraserImage,
    editorVariant = 'videoStudio',
  } = props;

  const { colorMode } = useColorMode();
  const isImageStudio = editorVariant === 'imageStudio';

  if (!pos) {
    return null;
  }

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
    gap: '10px',
    zIndex: 1000,
    backdropFilter: 'blur(6px)',
  };
  const historyMetaClass = colorMode === 'dark' ? 'text-slate-400' : 'text-slate-500';
  const baseActionClass = isImageStudio
    ? 'rounded-xl px-3 py-2 bg-white/5 cursor-pointer transition'
    : 'rounded-lg px-3 py-2 cursor-pointer transition';
  const disabledActionClass = 'cursor-not-allowed opacity-50';

  return (
    <div key={pos.id} style={panelStyles}>
      <div className={`w-full text-center text-xs ${historyMetaClass}`}>
        Magic eraser history: {eraserUndoCount}/{eraserHistoryLimit} undo, {eraserRedoCount} redo
      </div>
      <div className={`grid grid-cols-2 w-full text-center ${isImageStudio ? 'gap-2 text-sm font-medium' : 'gap-2'}`}>
        <button
          type="button"
          className={`${baseActionClass} ${canUndoEraserStroke ? '' : disabledActionClass}`}
          disabled={!canUndoEraserStroke}
          onClick={() => undoEraserStroke?.()}
        >
          <FaUndo className={`inline-flex ${isImageStudio ? 'text-lg' : ''} ${iconColor}`} />
          Undo
        </button>
        <button
          type="button"
          className={`${baseActionClass} ${canRedoEraserStroke ? '' : disabledActionClass}`}
          disabled={!canRedoEraserStroke}
          onClick={() => redoEraserStroke?.()}
        >
          <FaRedo className={`inline-flex ${isImageStudio ? 'text-lg' : ''} ${iconColor}`} />
          Redo
        </button>
      </div>
      <div className={`grid grid-cols-2 w-full text-center ${isImageStudio ? 'text-sm font-medium gap-2' : 'gap-2'}`}>
        <button type="button" className={baseActionClass} onClick={() => resetEraserImage()}>
          <MdOutlineRefresh className={`inline-flex ${isImageStudio ? 'text-lg' : ''} ${iconColor}`} />
          Reset
        </button>
        <button type="button" className={baseActionClass} onClick={() => replaceEraserImage()}>
          <FaCheck className={`inline-flex ${isImageStudio ? 'text-lg' : ''} ${iconColor}`} />
          Replace
        </button>
      </div>
    </div>
  );
}
