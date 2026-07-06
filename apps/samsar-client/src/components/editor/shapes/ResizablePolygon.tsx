import { useEffect, useRef } from "react";
import { RegularPolygon, Group, Transformer } from 'react-konva';
import { INIT_DIMENSIONS } from '../utils/ShapeUtils';

export default function ResizablePolygon(props) {
  const transformerRef = useRef();
  const polygonRef = useRef();
  const { config, isSelected, onSelect, id, updateToolbarButtonPosition, updateTargetActiveLayerConfig
   } = props;
  const { x, y, sides, radius, fillColor, strokeColor, strokeWidth } = config;

  useEffect(() => {
    if (transformerRef.current && polygonRef.current) {
      transformerRef.current.nodes([polygonRef.current]);
      transformerRef.current.getLayer().batchDraw();
    }
  }, [isSelected]);

  const handleDragEnd = (e) => {
    const node = e.target;
    const newAttrs = {
      x: node.x(),
      y: node.y(),
      sides: node.sides(),
      radius: node.radius(),
      fillColor: node.fill(),
      strokeColor: node.stroke(),
      strokeWidth: node.strokeWidth(),
    };
    updateTargetActiveLayerConfig(id, newAttrs);
  };

  const handleTransformEnd = () => {
    const node = polygonRef.current;
    const scaleX = node.scaleX();
    const scaleY = node.scaleY();
    const newAttrs = {
      x: node.x(),
      y: node.y(),
      sides: node.sides(),
      radius: node.radius() * Math.max(scaleX, scaleY),
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
      <RegularPolygon
        id={id}
        x={x !== undefined ? x : INIT_DIMENSIONS.x}
        y={y !== undefined ? y : INIT_DIMENSIONS.y}
        sides={sides || 6}
        radius={radius || 70}
        fill={fillColor || 'red'}
        stroke={strokeColor || 'black'}
        strokeWidth={strokeWidth ?? 4}
        draggable
        onDragMove={(e) => updateToolbarButtonPosition(id, e.target.x(), e.target.y())}
        onDragEnd={handleDragEnd}
        onTransformEnd={handleTransformEnd}
        ref={polygonRef}
        onClick={(e) => {
          e.cancelBubble = true; // Prevent event from bubbling to the stage
          onSelect();
        }}
        onTap={(e) => {
          e.cancelBubble = true; // Same as above for touch devices
          onSelect();
        }}
      />

      {isSelected && (
        <Transformer
          ref={transformerRef}
          boundBoxFunc={(oldBox, newBox) => {
            // Limit the size of the polygon (optional)
            if (newBox.width < 5 || newBox.height < 5) {
              return oldBox;
            }
            return newBox;
          }}
        />
      )}
    </Group>
  );
}
