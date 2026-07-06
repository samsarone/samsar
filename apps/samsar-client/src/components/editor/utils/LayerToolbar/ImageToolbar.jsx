import { useState } from 'react';
import { FaChevronCircleDown, FaChevronCircleUp , FaTimesCircle } from 'react-icons/fa';
import Konva from 'konva';
import Select from 'react-select';
import { GiHorizontalFlip , GiVerticalFlip} from "react-icons/gi";




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
  const { pos, moveItem, index, applyFilter, removeItem , colorMode , flipImageVertical,
    flipImageHorizontal, itemId
  } = props;
  const [selectedFilter, setSelectedFilter] = useState(null);
  const [filterValue, setFilterValue] = useState(0);

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

  const iconColor = colorMode === 'dark' ? 'text-neutral-200' : 'text-grey-800';

  let posX = pos.x;
  if (posX < 256) {
    posX = 256;
  }
  let posY = pos.y;
  if (posY < 200) {
    posY = 200;
  } 


  return (
    <div key={pos.id} style={{
      position: 'absolute', left: pos.x, top: pos.y, background: "#030712",
      width: "250px", borderRadius: "5px", padding: "5px", display: "flex", flexDirection: "column", alignItems: "center",
      zIndex: 1000
    }}>
      <div className='flex flex-row w-full'>
        <div className='basis-1/4'>
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '10px' }}>
            <button onClick={() => moveItem(index, -1)}>
              <FaChevronCircleDown className={`${iconColor} mt-2 text-xl cursor-hover`} />
            </button>
            <button onClick={() => moveItem(index, 1)} style={{ marginLeft: '10px' }}>
              <FaChevronCircleUp className={`${iconColor} mt-2 text-xl cursor-hover`} />
            </button>
          </div>
        </div>
        <div className='basis-1/2'>
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
              }),
              menu: (provided) => ({
                ...provided,
                zIndex: 9999
              })
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
              style={{ width: '100%' }}
            />
          )}
        </div>
        <div className='basis-1/4 flex'>
          <GiVerticalFlip className={`${iconColor} float-right mr-2 mt-2 text-xl cursor-hover inline-flex`} onClick={() => flipImageVertical(itemId)}/>
          <GiHorizontalFlip className={`${iconColor} float-right mr-2 mt-2 text-xl cursor-hover inline-flex`} onClick={() => flipImageHorizontal(itemId)}/>
        </div>  
        <div className='basis-1/4'>
          <FaTimesCircle className={`${iconColor} float-right mr-2 mt-2 text-xl cursor-hover`} onClick={() => removeItem(index)}  />
        </div>
      </div>
    </div>
  );
}
