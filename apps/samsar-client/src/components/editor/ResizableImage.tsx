import { useRef, useEffect, useState } from "react";
import { Image, Transformer, Group, Text } from 'react-konva';
import { useImage } from 'react-konva-utils';
import { getStageDimensions} from '../../constants/Image.jsx';
import { getRenderableImageUrl } from '../../utils/image.jsx';

const IMAGE_BASE = `${import.meta.env.VITE_PROCESSOR_API}`;
const MIN_IMAGE_EDGE = 16;

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function getAxisBounds(contentSize, containerSize) {
  if (contentSize <= containerSize) {
    return {
      min: 0,
      max: Math.max(0, containerSize - contentSize),
    };
  }

  return {
    min: containerSize - contentSize,
    max: 0,
  };
}

export default function ResizableImage({
  image,
  isSelected,
  onSelect,
  updateToolbarButtonPosition,
  updateTargetActiveLayerConfig,
  animations,
  isLayerSeeking,
  stageZoomScale,
  aspectRatio,
  ...props
}) {
  const { isDraggable, x, y } = props;
  let imageSrc;
  const baseStageDimensions = getStageDimensions(aspectRatio);
  const stageDimensions = {
    width: baseStageDimensions.width * (stageZoomScale || 1),
    height: baseStageDimensions.height * (stageZoomScale || 1),
  };

  imageSrc = getRenderableImageUrl(image, IMAGE_BASE);

  const [img, status] = useImage(imageSrc, 'anonymous');
  const [transformEndCalled, setTransformEndCalled] = useState(false);
  const shapeRef = useRef();
  const trRef = useRef();
  const { showMask, id } = props;

  const clampRectToStage = (rect) => {
    const width = Math.max(MIN_IMAGE_EDGE, Number(rect?.width) || MIN_IMAGE_EDGE);
    const height = Math.max(MIN_IMAGE_EDGE, Number(rect?.height) || MIN_IMAGE_EDGE);
    const xBounds = getAxisBounds(width, stageDimensions.width);
    const yBounds = getAxisBounds(height, stageDimensions.height);

    return {
      x: clamp(Number(rect?.x) || 0, xBounds.min, xBounds.max),
      y: clamp(Number(rect?.y) || 0, yBounds.min, yBounds.max),
      width,
      height,
    };
  };

  useEffect(() => {
    if (status !== 'loaded' || !shapeRef.current) {
      return;
    }

    const imageDimensions = {
      width: img.width,
      height: img.height,
    };
    const scalingFactor = 1;

    try {
      const initialRect = clampRectToStage({
        x: x !== undefined ? x : (stageDimensions.width - imageDimensions.width * scalingFactor) / 2,
        y: y !== undefined ? y : (stageDimensions.height - imageDimensions.height * scalingFactor) / 2,
        width: props.width ?? imageDimensions.width * scalingFactor,
        height: props.height ?? imageDimensions.height * scalingFactor,
      });

      // Set the initial position of the image based on props
      shapeRef.current.setAttrs({
        x: initialRect.x,
        y: initialRect.y,
        width: initialRect.width,
        height: initialRect.height,
        scaleX: scalingFactor,
        scaleY: scalingFactor,
      });

      if (trRef.current && isSelected && shapeRef.current) {
        trRef.current.nodes([shapeRef.current]);
        trRef.current.getLayer().batchDraw();
      }
    } catch  {
      // Ignore positioning errors so the editor can continue rendering.
    }
  }, [img, status, props.height, props.width, stageDimensions.height, stageDimensions.width, x, y]);

  useEffect(() => {
    if (!animations || animations.length === 0 || !isLayerSeeking || status !== 'loaded') {
      return;
    }
    const translateAnimationFound = animations.find((animation) => animation.type === 'rotate');
    if (translateAnimationFound) {
      const node = shapeRef.current;
      const clientRect = node.getClientRect();
      node.offsetX(clientRect.width / 2);
      node.offsetY(clientRect.height / 2);
      node.x(node.x() + clientRect.width / 2);
      node.y(node.y() + clientRect.height / 2);
    }
  }, [animations, img, status, isLayerSeeking]);

  useEffect(() => {
    if (trRef.current &&  shapeRef.current) {
      const layer = trRef.current.getLayer();
      if (isSelected && layer) {
        trRef.current.nodes([shapeRef.current]);
        trRef.current.getLayer().batchDraw();
      } else if (layer) {
        // Ensure transformer is detached when not selected
        trRef.current.nodes([]);
        trRef.current.getLayer().batchDraw();
      }
    }
  }, [isSelected]);

  const handleTransformEnd = () => {
    if (transformEndCalled) {
      return; // Prevent duplicate calls
    }
    setTransformEndCalled(true);

    const node = shapeRef.current;
    const scaleX = node.scaleX();
    const scaleY = node.scaleY();
    const rect = clampRectToStage({
      x: node.x(),
      y: node.y(),
      width: node.width() * Math.abs(scaleX),
      height: node.height() * Math.abs(scaleY),
    });
    node.scaleX(1);
    node.scaleY(1);
    node.width(rect.width);
    node.height(rect.height);
    node.x(rect.x);
    node.y(rect.y);

    const newConfig = {
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
    };
    updateToolbarButtonPosition(id, rect.x, rect.y);
    updateTargetActiveLayerConfig(id, newConfig);

    setTimeout(() => setTransformEndCalled(false), 0);
  };

  const handleDragEnd = (e) => {
    const node = e.target;
    const rect = clampRectToStage({
      x: node.x(),
      y: node.y(),
      width: node.width() * Math.abs(node.scaleX()),
      height: node.height() * Math.abs(node.scaleY()),
    });
    node.x(rect.x);
    node.y(rect.y);

    const newConfig = {
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
    };
    updateTargetActiveLayerConfig(id, newConfig);
  };

  return (
    <Group id={`group_${id}`}>
      {status === 'loading' && (
        <Text text="Loading..." /> // Or display a spinner or placeholder
      )}
      {status === 'failed' && (
        <Text text="Failed to load image" fill="red" />
      )}
      {status === 'loaded' && img && (
        <Image
          {...props}
          image={img}
          ref={shapeRef}
          onClick={(e) => {
            e.cancelBubble = true; // Prevent event from bubbling to the stage
            onSelect();
          }}
          onTap={(e) => {
            e.cancelBubble = true; // Same as above for touch devices
            onSelect();
          }}
          draggable={showMask || !isDraggable ? false : true}
          dragBoundFunc={(position) => {
            if (!shapeRef.current) {
              return position;
            }
            const rect = clampRectToStage({
              x: position.x,
              y: position.y,
              width: shapeRef.current.width() * Math.abs(shapeRef.current.scaleX() || 1),
              height: shapeRef.current.height() * Math.abs(shapeRef.current.scaleY() || 1),
            });
            return {
              x: rect.x,
              y: rect.y,
            };
          }}
          onDragMove={(e) => updateToolbarButtonPosition(id, e.target.x(), e.target.y())}
          onDragEnd={handleDragEnd}
          onTransformEnd={handleTransformEnd}
        />
      )}
      {isSelected && (
        <Transformer
          ref={trRef}
          anchorSize={15}
          anchorStyleFunc={(config) => {
            config.attrs.cornerRadius = 20;
            config.attrs.anchorCornerRadius = 20;
          }}
          flipEnabled={false}
          boundBoxFunc={(oldBox, newBox) => {
            const clampedBox = clampRectToStage(newBox);

            if (clampedBox.width < MIN_IMAGE_EDGE || clampedBox.height < MIN_IMAGE_EDGE) {
              return oldBox;
            }

            return {
              ...newBox,
              x: clampedBox.x,
              y: clampedBox.y,
              width: clampedBox.width,
              height: clampedBox.height,
            };
          }}
          onTransformEnd={handleTransformEnd}
        />
      )}
    </Group>
  );
}
