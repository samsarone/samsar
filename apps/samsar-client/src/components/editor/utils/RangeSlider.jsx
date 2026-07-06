
import { useColorMode } from '../../../contexts/ColorMode.jsx';

function RangeSlider(props) {
  const { editBrushWidth, setEditBrushWidth, sizeVariant = 'default' } = props;

  const { colorMode } = useColorMode();
  const isImageStudio = sizeVariant === 'imageStudio';

  const min = 5;
  const max = 100;

  const handleSliderChange = (event) => {
    setEditBrushWidth(event.target.value);
  };

  const numericWidth = Number(editBrushWidth);
  const clampedWidth = Number.isFinite(numericWidth)
    ? Math.min(Math.max(numericWidth, min), max)
    : min;
  const fillPercent = ((clampedWidth - min) / (max - min)) * 100;
  const trackColor = colorMode === 'dark' ? '#1f2937' : '#e2e8f0';
  const accentColor = colorMode === 'dark' ? '#6366f1' : '#2563eb';

  return (
    <div>
      <input
        type="range"
        min={min}
        max={max}
        value={editBrushWidth}
        onChange={handleSliderChange}
        className={`w-full rounded-full cursor-pointer appearance-none ${isImageStudio ? 'h-3' : 'h-2'}`}
        style={{
          accentColor,
          background: `linear-gradient(to right, ${accentColor} 0%, ${accentColor} ${fillPercent}%, ${trackColor} ${fillPercent}%, ${trackColor} 100%)`,
          outline: 'none',
          transition: 'background 0.25s ease',
        }}
      />
      <div className={`${isImageStudio ? 'text-sm mt-3' : 'text-xs mt-2'} text-center font-bold text-slate-500 dark:text-slate-300`}>
        Brush width
      </div>
    </div>
  );
}

export default RangeSlider;
