import { useRef, useEffect } from 'react';
import { Rect, Group, Transformer } from 'react-konva';
import { INIT_DIMENSIONS } from '../utils/ShapeUtils';

export default function ResizableRectangle(props) {
  const { config, isSelected, onSelect, id, updateToolbarButtonPosition, updateTargetActiveLayerConfig
   } = props;
  const rectangleTransformerRef = useRef();
  const rectangleRef = useRef();

  


  useEffect(() => {
    // Check if the transformer and rectangle references are correctly set
    if (rectangleTransformerRef.current && rectangleRef.current) {
      // Set the transformer's node to the rectangle component
      rectangleTransformerRef.current.nodes([rectangleRef.current]);
      rectangleTransformerRef.current.getLayer().batchDraw();
    }
  }, [isSelected]);

  const { x, y, width, height, fillColor, strokeColor, strokeWidth } = config;

  const handleDragEnd = (e) => {
    const node = e.target;
    const newAttrs = {
      x: node.x(),
      y: node.y(),
      width: node.width(),
      height: node.height(),
      fillColor: node.fill(),
      strokeColor: node.stroke(),
      strokeWidth: node.strokeWidth(),
    };
    updateTargetActiveLayerConfig(id, newAttrs);
  };

  const handleTransformEnd = () => {
    const node = rectangleRef.current;
    const newAttrs = {
      x: node.x(),
      y: node.y(),
      width: node.width() * node.scaleX(),
      height: node.height() * node.scaleY(),
      scaleX: 1,
      scaleY: 1,
      fillColor: node.fill(),
      strokeColor: node.stroke(),
      strokeWidth: node.strokeWidth(),
    };
    node.scaleX(1);
    node.scaleY(1);
    updateTargetActiveLayerConfig(id, newAttrs);
  };

  return (
    <Group id={`group_${id}`}>
      <Rect
        id={id}
        x={x !== undefined ? x : INIT_DIMENSIONS.x}
        y={y !== undefined ? y : INIT_DIMENSIONS.y}
        width={width || 100}
        height={height || 100}
        onClick={(e) => {
          e.cancelBubble = true; // Prevent event from bubbling to the stage
          onSelect();
        }}
        onTap={(e) => {
          e.cancelBubble = true; // Same as above for touch devices
          onSelect();
        }}
        fill={fillColor || 'red'}
        stroke={strokeColor || 'black'}
        strokeWidth={strokeWidth ?? 4}
        ref={rectangleRef}
        draggable={!config.fixed}
        onDragMove={(e) => updateToolbarButtonPosition(id, e.target.x(), e.target.y())}
        onDragEnd={handleDragEnd}
        onTransformEnd={handleTransformEnd}
      />
      {isSelected && <Transformer
        ref={rectangleTransformerRef}
        boundBoxFunc={(oldBox, newBox) => {
          // Limit the size of the rectangle (optional)
          if (newBox.width < 5 || newBox.height < 5) {
            return oldBox;
          }
          return newBox;
        }}
      />}
    </Group>
  );
}
