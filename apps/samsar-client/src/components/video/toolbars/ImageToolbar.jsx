import { useState, useEffect } from 'react';
import { FaChevronCircleDown, FaChevronCircleUp, FaTimesCircle } from 'react-icons/fa';
import Konva from 'konva';
import Select from 'react-select';
import { GiHorizontalFlip, GiVerticalFlip } from "react-icons/gi";

const filters = [
  { label: 'Blur', value: Konva.Filters.Blur, min: 0, max: 20, step: 1 },
  { label: 'Brighten', value: Konva.Filters.Brighten, min: -1, max: 1, step: 0.01 },
  { label: 'Contrast', value: Konva.Filters.Contrast, min: -1, max: 1, step: 0.01 },
  { label: 'Grayscale', value: Konva.Filters.Grayscale, min: 0, max: 1, step: 1 },
  { label: 'HSL', value: Konva.Filters.HSL, min: -1, max: 1, step: 0.01 },
  { label: 'Invert', value: Konva.Filters.Invert, min: 0, max: 1, step: 1 },
  { label: 'Pixelate', value: Konva.Filters.Pixelate, min: 1, max: 20, step: 1 },
  { label: 'Posterize', value: Konva.Filters.Posterize, min: 1, max: 20, step: 1 },
  { label: 'Sepia', value: Konva.Filters.Sepia, min: 0, max: 1, step: 1 },
  { label: 'Solarize', value: Konva.Filters.Solarize, min: 0, max: 1, step: 1 },
  { label: 'RGBA', value: Konva.Filters.RGBA, min: 0, max: 1, step: 0.01 }
];

export default function ImageToolbar(props) {
  const { pos, moveItem, index, applyFilter, removeItem, colorMode, flipImageVertical,
    flipImageHorizontal, itemId, applyFinalFilter, updateTargetActiveLayerConfig,
    editorVariant = 'videoStudio',
  } = props;
  const isImageStudio = editorVariant === 'imageStudio';

  const [selectedFilter, setSelectedFilter] = useState(null);
  const [filterValue, setFilterValue] = useState(0);
  const [xValue, setXValue] = useState(0);
  const [yValue, setYValue] = useState(0);
  const [widthValue, setWidthValue] = useState(0);
  const [heightValue, setHeightValue] = useState(0);

  useEffect(() => {
    // Fetch current item properties to initialize the input values
    const currentItem = props.activeItemList.find(item => item.id === itemId);
    if (currentItem) {
      setXValue(currentItem.x);
      setYValue(currentItem.y);
      setWidthValue(currentItem.width);
      setHeightValue(currentItem.height);
    }
  }, [itemId, props.activeItemList]);

  const handleFilterChange = (selectedOption) => {
    setSelectedFilter(selectedOption);
    setFilterValue(selectedOption.min); // Reset the filter value
    applyFilter(index, selectedOption.value, selectedOption.min); // Apply filter with initial value
  };

  const handleSliderChange = (e) => {
    const value = parseFloat(e.target.value);
    setFilterValue(value);
    if (selectedFilter) {
      applyFilter(index, selectedFilter.value, value);
    }
  };

  const handleSliderChangeEnd = (e) => {
    const value = parseFloat(e.target.value);
    if (selectedFilter) {
      applyFinalFilter(index, selectedFilter.value, value);
    }
  };

  const handleInputChange = (e, type) => {
    const value = parseInt(e.target.value, 10);
    switch (type) {
      case 'x':
        setXValue(value);
        break;
      case 'y':
        setYValue(value);
        break;
      case 'width':
        setWidthValue(value);
        break;
      case 'height':
        setHeightValue(value);
        break;
      default:
        break;
    }
  };

  const handleInputBlur = () => {
    const newConfig = {
      x: xValue,
      y: yValue,
      width: widthValue,
      height: heightValue,
    };
    updateTargetActiveLayerConfig(itemId, newConfig);
  };

  const iconColor = colorMode === 'dark' ? 'text-neutral-200' : 'text-slate-600';
  const fieldShell = colorMode === 'dark'
    ? 'bg-slate-900/60 text-slate-100 border border-white/10'
    : 'bg-white text-slate-900 border border-slate-200 shadow-sm';
  const accentColor = colorMode === 'dark' ? '#6366f1' : '#2563eb';
  const trackColor = colorMode === 'dark' ? '#1f2937' : '#e2e8f0';
  const inputClassName = `${fieldShell} w-full ${isImageStudio ? 'rounded-xl px-3 py-2 text-[15px]' : 'rounded-md px-2 py-1 text-sm'}`;
  const labelClassName = isImageStudio ? 'mt-1 text-sm text-center' : 'text-xs text-center';
  const iconClassName = isImageStudio ? 'mt-2 text-[26px] cursor-hover' : 'mt-2 text-xl cursor-hover';

  const panelStyles = {
    position: 'absolute',
    left: Math.max(pos.x, 0),
    top: Math.max(pos.y, 0),
    background: colorMode === 'dark' ? 'rgba(3, 7, 18, 0.95)' : 'rgba(248, 250, 252, 0.98)',
    border: colorMode === 'dark'
      ? '1px solid rgba(148, 163, 184, 0.25)'
      : '1px solid rgba(148, 163, 184, 0.45)',
    boxShadow: colorMode === 'dark'
      ? '0 20px 50px rgba(15, 23, 42, 0.55)'
      : '0 20px 45px rgba(15, 23, 42, 0.12)',
    color: colorMode === 'dark' ? '#e2e8f0' : '#0f172a',
    width: isImageStudio ? '580px' : '512px',
    borderRadius: isImageStudio ? '18px' : '14px',
    padding: isImageStudio ? '16px' : '12px',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    zIndex: 100,
    backdropFilter: 'blur(6px)'
  };

  const getSliderStyle = (value, min, max) => {
    const numValue = Number(value);
    const safeValue = Number.isFinite(numValue) ? Math.min(Math.max(numValue, min), max) : min;
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

  return (
    <div key={pos.id} style={panelStyles}>
      <div className='flex flex-row w-full'>
        <div className='basis-1/2'>
          <div className='grid grid-cols-4'>
            <div>
              <input
                type="number"
                value={xValue}
                onChange={(e) => handleInputChange(e, 'x')}
                onBlur={() => handleInputBlur('x')}
                placeholder="X"
                className={inputClassName}
              />
              <div className={labelClassName}>
                X
              </div>
            </div>
            <div>
              <input
                type="number"
                value={yValue}
                onChange={(e) => handleInputChange(e, 'y')}
                onBlur={() => handleInputBlur('y')}
                placeholder="Y"
                className={inputClassName}
              />
              <div className={labelClassName}>
                Y
              </div>
            </div>
            <div>
              <input
                type="number"
                value={widthValue}
                onChange={(e) => handleInputChange(e, 'width')}
                onBlur={() => handleInputBlur('width')}
                placeholder="W"
                className={inputClassName}
              />
              <div className={labelClassName}>
                W
              </div>
            </div>
            <div>
              <input
                type="number"
                value={heightValue}
                onChange={(e) => handleInputChange(e, 'height')}
                onBlur={() => handleInputBlur('height')}
                placeholder="H"
                className={inputClassName}
              />
              <div className={labelClassName}>
                H
              </div>
            </div>
          </div>
        </div>
        <div className='basis-1/4'>
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '10px' }}>
            <button onClick={() => moveItem(index, -1)}>
              <FaChevronCircleDown className={`${iconColor} ${iconClassName}`} />
            </button>
            <button onClick={() => moveItem(index, 1)} style={{ marginLeft: '10px' }}>
              <FaChevronCircleUp className={`${iconColor} ${iconClassName}`} />
            </button>
          </div>
        </div>
        <div className='basis-1/4'>
          <Select
            options={filters}
            onChange={handleFilterChange}
            placeholder="Filter"
            styles={{
              control: (provided) => ({
                ...provided,
                marginBottom: '10px',
                width: '100%',
                backgroundColor: colorMode === 'dark' ? '#1a202c' : '#f7fafc',
                color: colorMode === 'dark' ? 'white' : 'black',
              }),
              menu: (provided) => ({
                ...provided,
                zIndex: 9999,
                backgroundColor: colorMode === 'dark' ? '#1a202c' : '#f7fafc',
                color: colorMode === 'dark' ? 'white' : 'black',
              }),
              option: (provided, state) => ({
                ...provided,
                backgroundColor: state.isSelected ? (colorMode === 'dark' ? '#2d3748' : '#e2e8f0') : (colorMode === 'dark' ? '#1a202c' : '#f7fafc'),
                color: colorMode === 'dark' ? 'white' : 'black',
                '&:hover': {
                  backgroundColor: colorMode === 'dark' ? '#2d3748' : '#e2e8f0',
                },
              }),
              singleValue: (provided) => ({
                ...provided,
                color: colorMode === 'dark' ? 'white' : 'black',
              }),
              placeholder: (provided) => ({
                ...provided,
                color: colorMode === 'dark' ? 'white' : 'black',
              }),
            }}
          />
          {selectedFilter && (
            <input
              type="range"
              min={selectedFilter.min}
              max={selectedFilter.max}
              step={selectedFilter.step}
              value={filterValue}
              onChange={handleSliderChange}
              onMouseUp={handleSliderChangeEnd}
              onTouchEnd={handleSliderChangeEnd}
              style={getSliderStyle(filterValue, selectedFilter.min, selectedFilter.max)}
              className="w-full appearance-none rounded-full"
            />
          )}
        </div>
        <div className='basis-1/4 flex'>
          <GiVerticalFlip className={`${iconColor} mr-2 ${iconClassName} inline-flex`} onClick={() => flipImageVertical(itemId)} />
          <GiHorizontalFlip className={`${iconColor} mr-2 ${iconClassName} inline-flex`} onClick={() => flipImageHorizontal(itemId)} />
          <FaTimesCircle className={`${iconColor} ml-4 ${iconClassName}`} onClick={() => removeItem(index)} />
        </div>
      </div>
    </div>
  );
}
