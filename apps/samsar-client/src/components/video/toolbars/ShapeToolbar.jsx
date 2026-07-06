import { useState, useEffect } from 'react';
import { FaChevronCircleDown, FaChevronCircleUp, FaTimesCircle } from 'react-icons/fa';

export default function ShapeToolbar(props) {
  const { pos, moveItem, index, removeItem, colorMode, itemId, updateTargetActiveLayerConfig,
    activeItemList,
    editorVariant = 'videoStudio',
  } = props;
  const isImageStudio = editorVariant === 'imageStudio';


  useState(null);
  useState(0);
  const [xValue, setXValue] = useState(0);
  const [yValue, setYValue] = useState(0);
  const [widthValue, setWidthValue] = useState(0);
  const [heightValue, setHeightValue] = useState(0);

  useEffect(() => {


    // Fetch current item properties to initialize the input values
    if (activeItemList) {

      const currentItem = activeItemList.find(item => item.id === itemId);

      if (!currentItem) {
        return;
      }

      const itemConfig = currentItem.config;
      if (itemConfig) {
        setXValue(itemConfig.x);
        setYValue(itemConfig.y);
        setWidthValue(itemConfig.width);
        setHeightValue(itemConfig.height);
      }
    }
  }, [itemId, activeItemList]);







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

  const iconColor = colorMode === 'dark' ? 'text-neutral-200' : 'text-grey-800';

  const bgColor = colorMode === 'dark' ? `bg-[#111a2f]` : `bg-neutral-300`;
  const textColor = colorMode === 'dark' ? `text-slate-100` : `text-black`;
  const inputClassName = `w-full ${isImageStudio ? 'rounded-xl px-3 py-2 text-[15px]' : 'rounded-sm p-1 pr-0 text-sm'} ${bgColor} ${textColor}`;
  const labelClassName = isImageStudio ? 'mt-1 text-sm text-center' : 'text-xs text-center';
  const iconClassName = isImageStudio ? 'mt-2 text-[26px] cursor-hover' : 'mt-2 text-xl cursor-hover';

  return (
    <div key={pos.id} style={{
      position: 'absolute', left: pos.x, top: pos.y, background: "#0f1629",
      width: isImageStudio ? "480px" : "400px", borderRadius: isImageStudio ? "16px" : "5px", padding: isImageStudio ? "14px" : "5px", paddingTop: isImageStudio ? "14px" : "1px", paddingBottom: isImageStudio ? "14px" : "1px", display: "flex", flexDirection: "column", alignItems: "center",
      zIndex: 100
    }}>
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


        </div>
        <div className='basis-1/4 flex'>
          <FaTimesCircle className={`${iconColor} ml-4 ${iconClassName}`} onClick={() => removeItem(index)} />
        </div>
      </div>
    </div>
  )
}
