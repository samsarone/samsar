
import { FaPencilAlt, FaEraser, FaUpload, FaSave, FaCrosshairs } from "react-icons/fa";
import { useColorMode } from "../../../contexts/ColorMode.jsx";

export default function ActionToolbar(props) {
  const { showSaveAction, showUploadAction,

    pencilWidth,
    setPencilWidth,
    pencilColor,
    setPencilColor,
    eraserWidth,
    setEraserWidth,
    pencilOptionsVisible,
    setPencilOptionsVisible,
    eraserOptionsVisible,
    setEraserOptionsVisible,
    cursorSelectOptionVisible,
    setCursorSelectOptionVisible,
  } = props;

  const { colorMode } = useColorMode();



  const baseShell =
    colorMode === 'dark'
      ? 'bg-[#0f1629] border-[#1f2a3d] text-slate-100 shadow-[0_14px_36px_rgba(0,0,0,0.35)]'
      : 'bg-white text-slate-900 border border-[#d7deef] shadow-sm';

  const optionShell =
    colorMode === 'dark'
      ? 'bg-[#111a2f] border border-[#1f2a3d]'
      : 'bg-white border border-[#d7deef] shadow-sm';

  const optionSelected =
    colorMode === 'dark'
      ? 'bg-[#16213a] text-rose-100 border border-rose-400/30'
      : 'bg-rose-50 text-rose-700 border border-rose-200';

  const accentColor = colorMode === 'dark' ? '#ff5f8a' : '#f97316';
  const trackColor = colorMode === 'dark' ? '#1f2a3d' : '#d7deef';

  const getSliderStyle = (value: number, min: number, max: number) => {
    const safeValue = Number.isFinite(value) ? Math.min(Math.max(value, min), max) : min;
    const percent = ((safeValue - min) / (max - min)) * 100;
    return {
      accentColor,
      background: `linear-gradient(to right, ${accentColor} 0%, ${accentColor} ${percent}%, ${trackColor} ${percent}%, ${trackColor} 100%)`,
      height: '8px',
      borderRadius: '9999px',
      outline: 'none',
      transition: 'background 0.25s ease',
    };
  };

  const togglePencilOptions = () => {
    setPencilOptionsVisible(!pencilOptionsVisible);
    setEraserOptionsVisible(false);
    setCursorSelectOptionVisible(false);
  };

  const toggleEraserOptions = () => {
    setEraserOptionsVisible(!eraserOptionsVisible);
    setPencilOptionsVisible(false);
    setCursorSelectOptionVisible(false);

  };



  const toggleCursorSelectOptions = () => {
    setCursorSelectOptionVisible(!cursorSelectOptionVisible);
    setPencilOptionsVisible(false);
    setEraserOptionsVisible(false);
  };



  return (
    <div className={`border-r-2 ${baseShell} h-full m-auto fixed top-0 overflow-auto w-[5%]`}>
      <div className="h-[60%]">
        <div className=" mt-[80px]">
          <div className={`text-center m-auto align-center mt-4 mb-4 pt-2 pb-2 rounded-lg transition-colors duration-150 ${cursorSelectOptionVisible ? optionSelected : optionShell}`}>
            <FaCrosshairs className="text-2xl m-auto cursor-pointer" onClick={toggleCursorSelectOptions} />
            <div className="text-[10px] tracking-tight m-auto text-center">
              Select
            </div>
          </div>


          <div className={`text-center m-auto align-center mt-4 mb-4 pt-2 pb-2 rounded-lg transition-colors duration-150 ${pencilOptionsVisible ? optionSelected : optionShell}`}>
            <FaPencilAlt className="text-2xl m-auto cursor-pointer" onClick={togglePencilOptions} />
            <div className="text-[10px] tracking-tight m-auto text-center">
              Pencil
            </div>
            {pencilOptionsVisible && (
              <div className="static mt-2 rounded-lg p-3 space-y-2 bg-black/10 dark:bg-white/10">
                <label className="block mb-2">Width:</label>
                <input type="range" min="1" max="50"
                  className="w-full appearance-none rounded-full"
                  value={pencilWidth}
                  onChange={(e) => setPencilWidth(e.target.value)}
                  style={getSliderStyle(Number(pencilWidth), 1, 50)}
                />
                <label className="block mt-2 mb-2">Color:</label>
                <input type="color" value={pencilColor} onChange={(e) => setPencilColor(e.target.value)} />
              </div>
            )}
          </div>

          <div className={`text-center m-auto align-center mt-4 mb-4 pt-2 pb-2 rounded-lg transition-colors duration-150 ${eraserOptionsVisible ? optionSelected : optionShell}`}>
            <FaEraser className="text-2xl m-auto cursor-pointer" onClick={toggleEraserOptions} />
            <div className="text-[10px] tracking-tight m-auto text-center">
              Magic Eraser
            </div>
            {eraserOptionsVisible && (
              <div className="static mt-2 rounded-lg p-3 bg-black/10 dark:bg-white/10">
                <label className="block mb-2">Width:</label>
                <input
                  type="range"
                  min="1"
                  max="100"
                  className="w-full appearance-none rounded-full"
                  value={eraserWidth}
                  onChange={(e) => setEraserWidth(e.target.value)}
                  style={getSliderStyle(Number(eraserWidth), 1, 100)}
                />
              </div>
            )}
          </div>


        </div>
      </div>
      <div>
        <div className="text-center m-auto align-center mt-4 mb-4">
          <FaUpload className="text-2xl m-auto cursor-pointer" onClick={() => showUploadAction()} />
          <div className="text-[12px] tracking-tight m-auto text-center">
            Upload
          </div>
        </div>
      </div>
      <div>
        <div className="text-center m-auto align-center mt-4 mb-4">
          <FaSave className="text-2xl m-auto cursor-pointer" onClick={() => showSaveAction()} />
          <div className="text-[12px] tracking-tight m-auto text-center">
            Save
          </div>
        </div>
      </div>
    </div>
  );
}
