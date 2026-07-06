import { forwardRef, useEffect, useState, useRef } from "react";
import { Stage, Layer, Group, Line } from 'react-konva';
import { CURRENT_TOOLBAR_VIEW } from '../../constants/Types.ts';
import ResizableImage from "./ResizableImage.tsx";
import ResizableText from "./ResizableText.tsx";
import { STAGE_DIMENSIONS } from '../../constants/Image.jsx';
import ResizableRectangle from "./shapes/ResizableRectangle.tsx";
import ResizablePolygon from "./shapes/ResizablePolygon.tsx";
import ResizableCircle from "./shapes/ResizableCircle.tsx";
import ResizableDialogBubble from "./shapes/ResizableDialogBubble.tsx";
import { useColorMode } from '../../contexts/ColorMode.jsx';
import { FaChevronCircleDown, FaChevronCircleUp } from "react-icons/fa";
import ImageToolbar from './utils/LayerToolbar/ImageToolbar.jsx';
import SimpleImage from "./items/SimpleImage.jsx";

const SELECTABLE_TYPES = ['SHOW_DEFAULT_DISPLAY', 'SHOW_CURSOR_SELECT_DISPLAY'];
const SMSCanvas = forwardRef((props: any, ref: any) => {
  const { activeItemList, setActiveItemList, currentView, editBrushWidth,
    editMasklines, setEditMaskLines, currentCanvasAction,
    setSelectedId, selectedId, buttonPositions, setButtonPositions,
    selectedLayerType, setSelectedLayerType, applyFilter, onChange,
    pencilColor, pencilWidth, eraserWidth,
    sessionId, selectedFrameId,
  } = props;


  const [showMask, setShowMask] = useState(false);
  const [showEraser, setShowEraser] = useState(false);
  const [isPainting, setIsPainting] = useState(false);
  const [showPencil, setShowPencil] = useState(false);
  const [pencilLines, setPencilLines] = useState([]);

  const [eraserLayer, setEraserLayer] = useState(null);

  const showEraserRef = useRef(showEraser);
  const showPencilRef = useRef(showPencil);
  const editMasklinesRef = useRef(editMasklines);
  const eraserWidthRef = useRef(eraserWidth);

  useEffect(() => {
    showEraserRef.current = showEraser;
    showPencilRef.current = showPencil;
    editMasklinesRef.current = editMasklines;
    eraserWidthRef.current = eraserWidth;
  }, [showEraser, showPencil, editMasklines, eraserWidth]);

  useEffect(() => {
    if (currentCanvasAction === 'MOVE') {
      const stage = ref.current.getStage();
      const container = stage.container();
      container.style.cursor = 'grab';
    } else if (currentCanvasAction === 'RESIZE') {
      const stage = ref.current.getStage();
      const container = stage.container();
      container.style.cursor = 'nwse-resize';
    } else if (currentCanvasAction === 'ERASER') {
      const stage = ref.current.getStage();
      const container = stage.container();
      container.style.cursor = generateCursor(eraserWidthRef.current);
    } else {
      const stage = ref.current.getStage();
      const container = stage.container();
      container.style.cursor = 'default';
    }
  }, [currentCanvasAction]);

  useEffect(() => {
    const stage = ref.current.getStage();
    const positions = activeItemList.map(item => {
      const itemId = item.id.toString();
      const node = stage.findOne(`#${itemId}`);
      if (node) {
        const absPos = node.getClientRect({
          skipTransform: false,
          skipShadow: false,
          skipStroke: false,
        });
        return { id: item.id, x: absPos.x + 30, y: absPos.y };
      }
      return null;
    }).filter(Boolean);
    setButtonPositions(positions);
  }, [activeItemList, ref, selectedId]);

  const selectLayer = (item) => {
    if (item.config && SELECTABLE_TYPES.includes(currentView)) {
      setSelectedId(item.id);
    }
  };

  const generateCursor = (size) => {
    return `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='${size}' height='${size}' viewBox='0 0 ${size} ${size}'><circle cx='${size / 2}' cy='${size / 2}' r='${size / 2 - 1}' fill='%23000' /></svg>") ${size / 2} ${size / 2}, auto`;
  };

  const generatePencilCursor = (size) => {
    const svg = `
      <svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="white">
        <path d="M12.83 5.17l6 6-10.83 10.83-6-6 10.83-10.83zm-9.12 10.82l-3.71-3.71 1.41-1.41 3.71 3.71-1.41 1.41zm18.85-14.33l-2.83-2.83c-0.39-0.39-1.02-0.39-1.41 0l-2.83 2.83 6.24 6.24 2.83-2.83c0.39-0.39 0.39-1.02 0-1.41z"/>
      </svg>
    `;
    return `url("data:image/svg+xml;utf8,${encodeURIComponent(svg)}") ${size / 2} ${size / 2}, auto`;
  }

  useEffect(() => {
    setShowMask(false);
    setShowEraser(false);
    if (currentView === CURRENT_TOOLBAR_VIEW.SHOW_EDIT_MASK_DISPLAY) {
      setShowMask(true);
      const stage = ref.current.getStage();
      const container = stage.container();
      container.style.cursor = generateCursor(editBrushWidth);
    } else if (currentView === CURRENT_TOOLBAR_VIEW.SHOW_ERASER_DISPLAY) {
      setShowEraser(true);
      const stage = ref.current.getStage();
      const container = stage.container();
      container.style.cursor = generateCursor(eraserWidthRef.current);
    } else if (currentView === CURRENT_TOOLBAR_VIEW.SHOW_PENCIL_DISPLAY) {
      setShowPencil(true);
      const stage = ref.current.getStage();
      const container = stage.container();
      container.style.cursor = generatePencilCursor(20);
    } else {
      setEditMaskLines([]);
      const stage = ref.current.getStage();
      const container = stage.container();
      container.style.cursor = 'default';
    }
  }, [currentView]);

  useEffect(() => {
    if (currentView === CURRENT_TOOLBAR_VIEW.SHOW_ERASER) {
      const stage = ref.current.getStage();
      const container = stage.container();
      container.style.cursor = generateCursor(eraserWidth);
    }
  }, [eraserWidth]);


  useEffect(() => {
    const checkIfClickedOutside = (e) => {
      if (!document.getElementById('samsar-konva-stage').contains(e.target)) {
        // Handle the click outside event
      }
    };
    document.addEventListener('click', checkIfClickedOutside);
    return () => {
      document.removeEventListener('click', checkIfClickedOutside);
    };
  }, []);

  if (currentView === CURRENT_TOOLBAR_VIEW.SHOW_ERASER) {
    const stage = ref.current.getStage();
    const container = stage.container();
    container.style.cursor = generateCursor(eraserWidthRef.current);
  }
  if (currentView === CURRENT_TOOLBAR_VIEW.SHOW_EDIT_MASK_DISPLAY) {
    const stage = ref.current.getStage();
    const container = stage.container();
    container.style.cursor = generateCursor(editBrushWidth);
  }

  const moveItem = (index, direction) => {
    const newIndex = index + direction;
    if (newIndex < 0 || newIndex >= activeItemList.length) {
      return; // Out of bounds, do nothing
    }
    const newList = [...activeItemList];
    const [item] = newList.splice(index, 1);
    newList.splice(newIndex, 0, item);
    setActiveItemList(newList);
  };

  let imageStackList = <span />;

  const setSelectedLayer = (item) => {
    if (SELECTABLE_TYPES.includes(currentView)) {
      setSelectedId(item.id);
      if (item.type === 'image') {
        setSelectedLayerType('image');
      } else if (item.type === 'text') {
        setSelectedLayerType('text');
      } else if (item.type === 'shape') {
        setSelectedLayerType('shape');
      }
    }
  };

  const updateToolbarButtonPosition = (id, x, y) => {
    setButtonPositions((prevPositions) =>
      prevPositions.map((pos) =>
        pos.id === id ? { ...pos, x: x + 30, y: y } : pos
      )
    );
  };

  const isDraggable = SELECTABLE_TYPES.includes(currentView) ? true : false;
  const flipImageHorizontal = (id) => {
    const stage = ref.current.getStage();
    const image = stage.findOne(`#${id}`);
    const scaleX = image.scaleX() * -1;
    const clientRect = image.getClientRect();

    image.to({
      scaleX: scaleX,
      duration: 0.2, // Optional: add animation duration
      x: clientRect.x + (scaleX === -1 ? clientRect.width : 0),
    });


  }

  const flipImageVertical = (id) => {
    const stage = ref.current.getStage();
    const image = stage.findOne(`#${id}`);
    const scaleY = image.scaleY() * -1;
    const clientRect = image.getClientRect({
      skipTransform: false,
      skipShadow: false,
      skipStroke: false,
    });

    image.to({
      scaleY: scaleY,
      // Adjust position to keep it in place
      duration: 0.2, // Optional: add animation duration
      y: clientRect.y + (scaleY === -1 ? clientRect.height : 0),

    });
  }

  const previousViewRef = useRef();

  useEffect(() => {
    if (previousViewRef.current === CURRENT_TOOLBAR_VIEW.SHOW_ERASER_DISPLAY && currentView !== CURRENT_TOOLBAR_VIEW.SHOW_ERASER_DISPLAY) {
      const stage = ref.current.getStage();
      const layer1 = stage.children[1];

      if (layer1) {
        const dataURL = layer1.toDataURL();
        const imageObj = new window.Image();

        imageObj.onload = () => {
          const newItem = {
            id: `item_${activeItemList.length}`,
            type: 'image',
            src: dataURL,
            width: imageObj.width,
            height: imageObj.height,
            x: 0,
            y: 0,
          };
          const newActiveItemList = [...activeItemList, newItem];
          setActiveItemList(newActiveItemList);

          layer1.off();
          layer1.destroy();
          setEraserLayer(null);
        };

        imageObj.src = dataURL;
      }
    }
  }, [currentView]);

  useEffect(() => {
    if (previousViewRef.current === CURRENT_TOOLBAR_VIEW.SHOW_PENCIL_DISPLAY && currentView !== CURRENT_TOOLBAR_VIEW.SHOW_PENCIL_DISPLAY) {
      const stage = ref.current.getStage();
      const pencilGroup = stage.findOne('#pencilGroup');

      if (pencilGroup) {
        const dataURL = pencilGroup.toDataURL();
        const imageObj = new window.Image();

        imageObj.onload = () => {
          const groupClientRect = pencilGroup.getClientRect();

          const newItem = {
            id: `item_${activeItemList.length}`,
            type: 'simpleImage',
            src: dataURL,
            x: groupClientRect.x,
            y: groupClientRect.y,
            width: groupClientRect.width,
            height: groupClientRect.height,
          };
          setActiveItemList((prevList) => [...prevList, newItem]);
          pencilGroup.off();
          pencilGroup.destroy();
          setShowPencil(false);
        };

        imageObj.src = dataURL;
      }
    }
    if (previousViewRef.current !== currentView) {
      previousViewRef.current = currentView;
    }
  }, [currentView]);

  if (activeItemList && activeItemList.length > 0) {
    imageStackList = activeItemList.map((item, index) => {
      if (item.type === 'image') {
        return (

          <ResizableImage
            {...item}
            image={item}
            isSelected={selectedId === item.id}
            onSelect={() => setSelectedLayer(item)}
            onUnselect={() => setSelectedId(null)}
            showMask={showMask}
            updateToolbarButtonPosition={updateToolbarButtonPosition}
            isDraggable={isDraggable}
            key={`item_${sessionId}_${selectedFrameId}_${index}`}

          />

        );
      } else if (item.type === 'text') {
        return (

          <ResizableText
            {...item}
            isSelected={selectedId === item.id}
            onSelect={() => setSelectedLayer(item)}
            onUnselect={() => setSelectedId(null)}
            updateToolbarButtonPosition={updateToolbarButtonPosition}
            isDraggable={isDraggable}
          />

        );
      } else if (item.type === 'simpleImage') {
        return (

          <SimpleImage {...item} image={item} />

        )
      } else if (item.type === 'shape') {
        if (item.shape === 'circle') {
          return (

            <ResizableCircle
              {...item}
              isSelected={selectedId === item.id}
              onSelect={() => selectLayer(item)}
              onUnselect={() => setSelectedId(null)}
              updateToolbarButtonPosition={updateToolbarButtonPosition}
              isDraggable={isDraggable}
            />

          );
        } else if (item.shape === 'rectangle') {
          return (

            <ResizableRectangle
              config={item.config}
              {...item}
              isSelected={selectedId === item.id}
              onSelect={() => selectLayer(item)}
              onUnselect={() => setSelectedId(null)}
              updateToolbarButtonPosition={updateToolbarButtonPosition}
              isDraggable={isDraggable}
            />

          );
        } else if (item.shape === 'polygon') {
          return (

            <ResizablePolygon
              {...item}
              isSelected={selectedId === item.id}
              onSelect={() => selectLayer(item)}
              onUnselect={() => setSelectedId(null)}
              updateToolbarButtonPosition={updateToolbarButtonPosition}
              isDraggable={isDraggable}
            />

          );
        } else if (item.shape === 'dialog') {
          return (

            <ResizableDialogBubble
              {...item}
              isSelected={selectedId === item.id}
              onSelect={() => selectLayer(item)}
              onUnselect={() => setSelectedId(null)}
              updateToolbarButtonPosition={updateToolbarButtonPosition}
              onChange={(newAttrs) => onChange({ ...newAttrs, id: item.id })}
            />

          );
        }
      }
    }).filter(Boolean);
  }

  const addLine = (points) => {
    setEditMaskLines([...editMasklines, { points, stroke: 'white', strokeWidth: editBrushWidth }]);
  };



  const handleLayerMouseDown = (e) => {
    if (showEraserRef.current) {
      setIsPainting(true);
      const stage = ref.current.getStage();
      const point = stage.getPointerPosition();
      const topShape = stage.getIntersection(point);

      if (topShape) {
        const topItemParentId = topShape.getParent().attrs.id;
        const topItemParentNode = stage.findOne(`#${topItemParentId}`);
        if (topItemParentNode) {
          let newEraserLayer;


          if (eraserLayer) {
            newEraserLayer = eraserLayer;
          } else {
            newEraserLayer = new Konva.Layer();
            const clonedItem = topItemParentNode.clone();
            topItemParentNode.destroy();
            newEraserLayer.add(clonedItem);
            stage.add(newEraserLayer);
            setEraserLayer(newEraserLayer);

          }

          setHandlersForLayer(newEraserLayer);

          newEraserLayer.on('mousedown', () => {
            if (showEraserRef.current) {
              setHandlersForLayer(newEraserLayer);
            } else {
              setIsPainting(false);
            }
          });

          function setHandlersForLayer(newEraserLayer) {
            newEraserLayer.on('mousemove', () => {
              const eraserRadius = eraserWidthRef.current ? eraserWidthRef.current / 2 : eraserWidth / 2;
              const point = stage.getPointerPosition();
              const eraserShape = new Konva.Circle({
                x: point.x,
                y: point.y,
                radius: eraserRadius / 2,
                fill: 'black',
                globalCompositeOperation: 'destination-out'
              });

              newEraserLayer.add(eraserShape);
              newEraserLayer.batchDraw();
            });

            newEraserLayer.on('mouseup', () => {
              setIsPainting(false);
              newEraserLayer.off('mousemove');
              newEraserLayer.off('mouseup');

              //   setEraserLayer(null);
            });
          }
        }
      }
    } else if (showPencilRef.current) {
      setIsPainting(true);
      const pos = e.target.getStage().getPointerPosition();
      setPencilLines([...pencilLines, { points: [pos.x, pos.y], stroke: pencilColor, strokeWidth: pencilWidth }]);
    } else {
      setIsPainting(true);
      const pos = e.target.getStage().getPointerPosition();
      addLine([pos.x, pos.y, pos.x, pos.y]);
    }
  };

  const handleLayerMouseMove = (e) => {
    if (!isPainting) return;

    const stage = e.target.getStage();
    const point = stage.getPointerPosition();

    if (showEraserRef.current && eraserLayer) {
      const eraserRadius = eraserWidthRef.current ? eraserWidthRef.current / 2 : eraserWidth / 2;
      const eraserShape = new Konva.Circle({
        x: point.x,
        y: point.y,
        radius: eraserRadius,
        fill: 'black',
        globalCompositeOperation: 'destination-out'
      });

      eraserLayer.add(eraserShape);
      eraserLayer.batchDraw();
    } else if (showPencilRef.current) {
      let lastLine = pencilLines[pencilLines.length - 1];

      if (lastLine) {
        lastLine.points = lastLine.points.concat([point.x, point.y]);
        setPencilLines(pencilLines.slice(0, -1).concat(lastLine));
      }

    } else if (editMasklinesRef.current.length > 0) {
      let lastLine = editMasklinesRef.current[editMasklinesRef.current.length - 1];
      lastLine.points = lastLine.points.concat([point.x, point.y]);
      setEditMaskLines(editMasklinesRef.current.slice(0, -1).concat(lastLine));
    }
  };

  const handleLayerMouseUp = () => {
    setIsPainting(false);
  };

  const { colorMode } = useColorMode();
  const bgColor = colorMode === 'dark' ? `bg-gray-900` : `bg-neutral-300`;

  const removeItem = (index) => {
    const newList = [...activeItemList];
    newList.splice(index, 1);
    setActiveItemList(newList);
  }
  if (ref && ref.current) {

  }




  return (
    <div className={`m-auto relative ${bgColor} pb-8 shadow-lg pt-[60px]`}>
      <Stage
        width={STAGE_DIMENSIONS.width}
        height={STAGE_DIMENSIONS.height}
        ref={ref}
        id="samsar-konva-stage"
      >
        <Layer
          onMouseDown={handleLayerMouseDown}
          onMouseMove={handleLayerMouseMove}
          onMouseUp={handleLayerMouseUp}
        >
          <Group id="baseGroup">
            {imageStackList}
          </Group>

          {showMask && (
            <Group id="maskGroup">
              {editMasklines.map((line, i) => (
                <Line key={i} points={line.points} stroke={line.stroke} strokeWidth={line.strokeWidth} />
              ))}
            </Group>
          )}

          {showPencil && (
            <Group id="pencilGroup">
              {pencilLines.map((line, i) => (
                <Line key={i} points={line.points} stroke={line.stroke} strokeWidth={line.strokeWidth} />
              ))}
            </Group>
          )}

        </Layer>
      </Stage>
      {buttonPositions.map((pos, index) => {
        if (!selectedId || (selectedId && pos.id && ((selectedId !== pos.id)))) return null; // Show buttons only for the selected item

        if (selectedLayerType === 'image') {
          return <ImageToolbar key={pos.id} pos={pos} index={index}
            moveItem={moveItem} applyFilter={applyFilter}
            colorMode={colorMode} removeItem={removeItem}
            itemId={selectedId}
            flipImageHorizontal={flipImageHorizontal}
            flipImageVertical={flipImageVertical} />;
        }
        return (
          <div key={pos.id} style={{
            position: 'absolute', left: pos.x, top: pos.y, background: "#030712",
            width: "100px", borderRadius: "5px", padding: "5px", display: "flex", justifyContent: "center",
            zIndex: 1000
          }}>
            <button onClick={() => moveItem(index, -1)}>
              <FaChevronCircleDown className="text-white" />
            </button>
            <button onClick={() => moveItem(index, 1)} style={{ marginLeft: '10px' }}>
              <FaChevronCircleUp className="text-white" />
            </button>
          </div>
        );
      })}
    </div>
  );
});

export default SMSCanvas;
