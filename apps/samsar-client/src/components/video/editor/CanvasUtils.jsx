import ResizableImage from "../../editor/ResizableImage.tsx";
import ResizableText from "../text_display/ResizableText.jsx";
import ResizableRectangle from "../../editor/shapes/ResizableRectangle.tsx";
import ResizablePolygon from "../../editor/shapes/ResizablePolygon.tsx";
import ResizableCircle from "../../editor/shapes/ResizableCircle.tsx";
import ResizableDialogBubble from "../../editor/shapes/ResizableDialogBubble.tsx";

const FPS = 30;
const DEFAULT_SESSION_FRAMES_PER_SECOND = 24;
const VALID_SESSION_FRAME_RATES = new Set([16, 24, 30]);
const SHAPE_CONFIG_SCALE_KEYS = [
  'x',
  'y',
  'width',
  'height',
  'radius',
  'strokeWidth',
  'pointerX',
  'pointerY',
  'xRadius',
  'yRadius',
];

function scaleShapeConfig(config = {}, scale = 1) {
  return SHAPE_CONFIG_SCALE_KEYS.reduce((scaledConfig, key) => {
    if (typeof config[key] === 'number') {
      scaledConfig[key] = config[key] * scale;
    }
    return scaledConfig;
  }, {});
}

function normalizeSessionFramesPerSecond(value) {
  const parsed = Math.round(Number(value));
  return VALID_SESSION_FRAME_RATES.has(parsed)
    ? parsed
    : DEFAULT_SESSION_FRAMES_PER_SECOND;
}

function convertFramesBetweenRates(value, sourceFramesPerSecond, targetFramesPerSecond) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    return null;
  }

  const sourceRate = Number(sourceFramesPerSecond) || FPS;
  const targetRate = Number(targetFramesPerSecond) || FPS;
  return Math.round((numericValue / sourceRate) * targetRate);
}

function getFrameConfigSourceRate(item, framesPerSecond) {
  const configuredRate = Number(item?.config?.frameRate || item?.config?.framesPerSecond);
  if (Number.isFinite(configuredRate) && configuredRate > 0) {
    return configuredRate;
  }

  return normalizeSessionFramesPerSecond(framesPerSecond);
}

function getItemDisplayFrameRange(item, framesPerSecond) {
  const frameOffset = Number(item?.config?.frameOffset);
  const frameDuration = Number(item?.config?.frameDuration);

  if (!Number.isFinite(frameOffset) || !Number.isFinite(frameDuration) || frameDuration <= 0) {
    return null;
  }

  const sourceRate = getFrameConfigSourceRate(item, framesPerSecond);
  const startFrame = Math.max(0, convertFramesBetweenRates(frameOffset, sourceRate, FPS) ?? 0);
  const durationFrames = Math.max(1, convertFramesBetweenRates(frameDuration, sourceRate, FPS) ?? 1);

  return {
    startFrame,
    endFrame: startFrame + durationFrames,
  };
}

export function isItemVisibleAtDisplayFrame(item, currentRelativeFrame, framesPerSecond) {
  const frameRange = getItemDisplayFrameRange(item, framesPerSecond);
  if (!frameRange) {
    return true;
  }

  return currentRelativeFrame >= frameRange.startFrame
    && currentRelativeFrame <= frameRange.endFrame;
}

export function ActiveRenderItem(props) {
  const {
    item,
    index,
    selectedId,
    setSelectedLayer,
    setSelectedId,
    selectedFrameId,
    showMask,
    updateToolbarButtonPosition,
    isDraggable,
    updateTargetActiveLayerConfig,
    isLayerSeeking,
    selectLayer,
    updateTargetShapeActiveLayerConfig,
    updateTargetTextActiveLayerConfig,
    onChange,
    sessionId,
    currentLayerSeek,
    durationOffset,
    createTextLayer,
    stageZoomScale = 1,
    aspectRatio,
    framesPerSecond,

  } = props;

  const currentRelativeFrame = currentLayerSeek - (durationOffset * FPS);


  if (item.type === 'image') {
    if (!isItemVisibleAtDisplayFrame(item, currentRelativeFrame, framesPerSecond)) {
      return null;
    }

    const newItem = {
      ...item,
      width: item.width * stageZoomScale,
      height: item.height * stageZoomScale,
      x: item.x * stageZoomScale,
      y: item.y * stageZoomScale,

    }
    return (
      <ResizableImage
        {...newItem}
        image={item}
        src={item.src}
        isSelected={selectedId === item.id}
        onSelect={() => setSelectedLayer(item)}
        onUnselect={() => setSelectedId(null)}
        showMask={showMask}
        updateToolbarButtonPosition={updateToolbarButtonPosition}
        isDraggable={isDraggable}
        key={`item_${sessionId}_${selectedFrameId}_${item.src}_${index}`}
        updateTargetActiveLayerConfig={updateTargetActiveLayerConfig}
        isLayerSeeking={isLayerSeeking}
        stageZoomScale={stageZoomScale}
        aspectRatio={aspectRatio}
      />
    );
  } else if (item.type === 'text') {

    const frameRange = getItemDisplayFrameRange(item, framesPerSecond);

    const newItem = {
      ...item,
      config: {
        ...item.config,
        x: item.config.x * stageZoomScale,
        y: item.config.y * stageZoomScale,
        width: item.config.width * stageZoomScale,
        height: item.config.height * stageZoomScale,
        fontSize: item.config.fontSize * stageZoomScale,
        strokeWidth: item.config.strokeWidth * stageZoomScale,
        letterSpacing: (item.config.letterSpacing || 0) * stageZoomScale,
        shadowBlur: (item.config.shadowBlur || 0) * stageZoomScale,
        shadowOffsetX: (item.config.shadowOffsetX || 0) * stageZoomScale,
        shadowOffsetY: (item.config.shadowOffsetY || 0) * stageZoomScale,
        
      }

    }
    if (!frameRange) {

      return (
        <ResizableText
          {...newItem}
          isSelected={selectedId === item.id}
          onSelect={() => setSelectedLayer(item)}
          onUnselect={() => setSelectedId(null)}
          updateToolbarButtonPosition={updateToolbarButtonPosition}
          isDraggable={isDraggable}
          updateTargetActiveLayerConfig={updateTargetTextActiveLayerConfig}
          stageZoomScale={stageZoomScale}
          aspectRatio={aspectRatio}
          createTextLayer={createTextLayer}
        />
      );
    } else {
      
      if (currentRelativeFrame >= frameRange.startFrame && currentRelativeFrame <= frameRange.endFrame) {
        return (
          <ResizableText
            {...newItem}
            isSelected={selectedId === item.id}
            onSelect={() => setSelectedLayer(item)}
            onUnselect={() => setSelectedId(null)}
            updateToolbarButtonPosition={updateToolbarButtonPosition}
            isDraggable={isDraggable}
            updateTargetActiveLayerConfig={updateTargetTextActiveLayerConfig}
            stageZoomScale={stageZoomScale}
            aspectRatio={aspectRatio}
          />
        );
      }
    }
  } else if (item.type === 'shape') {
    const newItem = {
      ...item,
      config: {
        ...item.config,
        ...scaleShapeConfig(item.config, stageZoomScale),
      }
    }
    if (!isItemVisibleAtDisplayFrame(item, currentRelativeFrame, framesPerSecond)) {
      return null;
    }
    if (item.shape === 'circle') {
      return (
        <ResizableCircle
          {...newItem}
          isSelected={selectedId === item.id}
          onSelect={() => selectLayer(item)}
          onUnselect={() => setSelectedId(null)}
          updateToolbarButtonPosition={updateToolbarButtonPosition}
          isDraggable={isDraggable}
          updateTargetActiveLayerConfig={updateTargetShapeActiveLayerConfig}
          stageZoomScale={stageZoomScale}
          aspectRatio={aspectRatio}
        />
      );
    } else if (item.shape === 'rectangle') {
      return (
        <ResizableRectangle
          config={newItem.config}
          {...newItem}
          isSelected={selectedId === item.id}
          onSelect={() => selectLayer(item)}
          onUnselect={() => setSelectedId(null)}
          updateToolbarButtonPosition={updateToolbarButtonPosition}
          isDraggable={isDraggable}
          updateTargetActiveLayerConfig={updateTargetShapeActiveLayerConfig}
          stageZoomScale={stageZoomScale}
          aspectRatio={aspectRatio}
        />
      );
    } else if (item.shape === 'polygon') {
      return (
        <ResizablePolygon
          {...newItem}
          isSelected={selectedId === item.id}
          onSelect={() => selectLayer(item)}
          onUnselect={() => setSelectedId(null)}
          updateToolbarButtonPosition={updateToolbarButtonPosition}
          isDraggable={isDraggable}
          updateTargetActiveLayerConfig={updateTargetShapeActiveLayerConfig}
          stageZoomScale={stageZoomScale}
          aspectRatio={aspectRatio}
        />
      );
    } else if (item.shape === 'dialog') {
      return (
        <ResizableDialogBubble
          {...newItem}
          isSelected={selectedId === item.id}
          onSelect={() => selectLayer(item)}
          onUnselect={() => setSelectedId(null)}
          updateToolbarButtonPosition={updateToolbarButtonPosition}
          onChange={(newAttrs) => onChange({ ...newAttrs, id: item.id })}
          updateTargetActiveLayerConfig={updateTargetShapeActiveLayerConfig}
          stageZoomScale={stageZoomScale}
          aspectRatio={aspectRatio}
        />
      );

    }
  }

}
