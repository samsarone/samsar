import { useEffect, useRef } from 'react';
import { Circle, Group, Transformer } from 'react-konva';
import { INIT_DIMENSIONS } from '../utils/ShapeUtils';

export default function ResizableCircle(props) {
  const { config, isSelected, onSelect, id, updateToolbarButtonPosition, updateTargetActiveLayerConfig } = props;
  const circleRef = useRef(null);
  const transformerCircleRef = useRef(null);

  useEffect(() => {
    // Check if the transformer and circle references are correctly set
    if (transformerCircleRef.current && circleRef.current) {
      // Set the transformer's node to the circle component
      transformerCircleRef.current.nodes([circleRef.current]);
      transformerCircleRef.current.getLayer().batchDraw();
    }
  }, [isSelected]);

  const { x, y, radius, fillColor, strokeColor, strokeWidth } = config;

  const handleDragEnd = (e) => {
    const node = e.target;
    const newAttrs = {
      x: node.x(),
      y: node.y(),
      radius: node.radius(),
      fillColor: node.fill(),
      strokeColor: node.stroke(),
      strokeWidth: node.strokeWidth(),
    };
    updateTargetActiveLayerConfig(id, newAttrs);
  };

  const handleTransformEnd = () => {
    const node = circleRef.current;
    const scaleX = node.scaleX();
    node.scaleY();
    const newAttrs = {
      x: node.x(),
      y: node.y(),
      radius: node.radius() * scaleX, // Assuming uniform scaling
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
      <Circle
        id={id}
        x={x !== undefined ? x : INIT_DIMENSIONS.x}
        y={y !== undefined ? y : INIT_DIMENSIONS.y}
        radius={radius || 70}
        fill={fillColor || 'red'}
        stroke={strokeColor || 'black'}
        strokeWidth={strokeWidth ?? 4}
        draggable
        onDragMove={(e) => updateToolbarButtonPosition(id, e.target.x(), e.target.y())}
        onDragEnd={handleDragEnd}
        ref={circleRef}
        onClick={(e) => {
          e.cancelBubble = true; // Prevent event from bubbling to the stage
          onSelect();
        }}
        onTap={(e) => {
          e.cancelBubble = true; // Same as above for touch devices
          onSelect();
        }}
        onTransformEnd={handleTransformEnd}
      />
      {isSelected && <Transformer
        ref={transformerCircleRef}
        boundBoxFunc={(oldBox, newBox) => {
          // Limit the size of the circle (optional)
          if (newBox.width < 5 || newBox.height < 5) {
            return oldBox;
          }
          return newBox;
        }}
      />}
    </Group>
  );
}
