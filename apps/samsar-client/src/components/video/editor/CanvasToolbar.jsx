

import { FaChevronCircleDown, FaChevronCircleUp } from 'react-icons/fa';
import ImageToolbar from '../toolbars/ImageToolbar.jsx';
import ShapeToolbar from '../toolbars/ShapeToolbar.jsx';
import TextToolbar from '../toolbars/text_toolbar/TextToolbar.jsx';
import EraserToolbar from "../toolbars/EraserToolbar.jsx";
import PaintToolbar from "../toolbars/PaintToolbar.jsx";
import ShapeSelectToolbar from '../toolbars/toolbar_shapes/ShapeSelectToolbar.jsx';


export default function CanvasToolbar(props) {

  const {
    buttonPositions,
    selectedId,
    selectedLayerType,
    moveItem,
    applyFilter,
    applyFinalFilter,
    colorMode,
    removeSelectedItem,
    flipImageHorizontal,
    flipImageVertical,
    activeItemList,
    eraserToolbarVisible,
    eraserToolbarPosition,
    replaceEraserImage,
    duplicateEraserImage,
    undoEraserStroke,
    redoEraserStroke,
    eraserUndoCount,
    eraserRedoCount,
    eraserHistoryLimit,
    canUndoEraserStroke,
    canRedoEraserStroke,
    resetEraserImage,
    shapeSelectToolbarVisible,
    shapeSelectToolbarPosition,
    handleResetShapeLayer,
    onCopyShapeLayer,
    onReplaceShapeLayer,
    paintToolbarVisible,
    paintToolbarPosition,
    addPaintImage,
    resetPaintImage,

    updateTargetImageActiveLayerConfig,
    updateTargetShapeActiveLayerConfigNoScale,
    updateTargetTextActiveLayerConfig,
    onPersistTextStyle,
    stageZoomScale = 1,
    canvasDimensions,
    editorVariant = 'videoStudio',
  } = props;

  return (
    <div>
      {buttonPositions.map((pos, index) => {        
        if (!selectedId || (selectedId && pos.id && ((selectedId !== pos.id)))) return null;        
        if (selectedLayerType === 'image') {
          return (
            <ImageToolbar
              key={pos.id}
              pos={pos}
              index={index}
              moveItem={moveItem}
              applyFilter={applyFilter}
              applyFinalFilter={applyFinalFilter}
              colorMode={colorMode}
              removeItem={removeSelectedItem}
              itemId={selectedId}
              flipImageHorizontal={flipImageHorizontal}
              flipImageVertical={flipImageVertical}
              updateTargetActiveLayerConfig={updateTargetImageActiveLayerConfig} 
              activeItemList={activeItemList} 
              editorVariant={editorVariant}
            />
          );
        } else if (selectedLayerType === 'shape') {
          
          return (
            <ShapeToolbar 
            key={pos.id}
            pos={pos}
            index={index}
            moveItem={moveItem}
            applyFilter={applyFilter}
            applyFinalFilter={applyFinalFilter}
            colorMode={colorMode}
            removeItem={removeSelectedItem}
            itemId={selectedId}
            updateTargetActiveLayerConfig={updateTargetShapeActiveLayerConfigNoScale}
            activeItemList={activeItemList}
            editorVariant={editorVariant}
            />
          )

        } else if (selectedLayerType === 'text') {
          return (
            <TextToolbar 
            key={pos.id}
            pos={pos}
            index={index}
            moveItem={moveItem}
            applyFilter={applyFilter}
            applyFinalFilter={applyFinalFilter}
            colorMode={colorMode}
            removeItem={removeSelectedItem}
            itemId={selectedId}
            updateTargetTextActiveLayerConfig={updateTargetTextActiveLayerConfig}
            activeItemList={activeItemList}
            onPersistTextStyle={onPersistTextStyle}
            stageZoomScale={stageZoomScale}
            canvasDimensions={canvasDimensions}
            editorVariant={editorVariant}
            />
          )
        } else {
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
        }
      })}
      {eraserToolbarVisible && (
        <EraserToolbar
          pos={eraserToolbarPosition}
          replaceEraserImage={replaceEraserImage}
          duplicateEraserImage={duplicateEraserImage}
          undoEraserStroke={undoEraserStroke}
          redoEraserStroke={redoEraserStroke}
          eraserUndoCount={eraserUndoCount}
          eraserRedoCount={eraserRedoCount}
          eraserHistoryLimit={eraserHistoryLimit}
          canUndoEraserStroke={canUndoEraserStroke}
          canRedoEraserStroke={canRedoEraserStroke}
          resetEraserImage={resetEraserImage}
          editorVariant={editorVariant}
        />
      )}
      {shapeSelectToolbarVisible && (
        <ShapeSelectToolbar
          pos={shapeSelectToolbarPosition}
          onResetShape={handleResetShapeLayer}
          onCopyShape={onCopyShapeLayer}
          onReplaceShape={onReplaceShapeLayer}
          editorVariant={editorVariant}
        />
      )}
      {paintToolbarVisible && (
        <PaintToolbar
          pos={paintToolbarPosition}
          addPaintImage={addPaintImage}
          resetPaintImage={resetPaintImage}
          editorVariant={editorVariant}
        />
      )}
    </div>
  )
}
