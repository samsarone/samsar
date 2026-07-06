import { useRef, useEffect } from 'react';
import { Rect, Transformer } from 'react-konva';

const DraggableToolbarRectangle = (props) => {
  const { shapeProps, setShapeProps, isDrawing, id, shapeSet, transformerRef } = props;

  const shapeRef = useRef();

  useEffect(() => {
    if (shapeSet && transformerRef.current) {
      transformerRef.current.nodes([shapeRef.current]);
      transformerRef.current.getLayer().batchDraw();
    }
  }, [shapeSet, transformerRef]);

  const handleDragMove = (e) => {
    if (!isDrawing) {
      const newProps = {
        ...shapeProps,
        x: e.target.x(),
        y: e.target.y(),
      };
      setShapeProps(newProps);
    }
  };

  const handleTransform = () => {
    if (shapeSet) {
      const node = shapeRef.current;
      const scaleX = node.scaleX();
      const scaleY = node.scaleY();

      // Reset scale to 1 and apply the new width and height to avoid cumulative scaling
      node.scaleX(1);
      node.scaleY(1);

      const newProps = {
        ...shapeProps,
        x: node.x(),
        y: node.y(),
        width: Math.max(1, node.width() * scaleX),
        height: Math.max(1, node.height() * scaleY),
      };

      setShapeProps(newProps);
    }
  };

  return (
    <>
      <Rect
        ref={shapeRef}
        id={id}
        type="rectangle"
        {...shapeProps}
        stroke="blue"
        draggable={!isDrawing}
        onDragMove={handleDragMove}
        onTransform={handleTransform}
        onTransformEnd={handleTransform}
      />
      {shapeSet && (
        <Transformer
          ref={transformerRef}
          rotateEnabled={false}
          enabledAnchors={[
            'top-left', 'top-right', 'bottom-left', 'bottom-right', 
            'middle-left', 'middle-right', 'middle-top', 'middle-bottom'
          ]}
        />
      )}
    </>
  );
};

export default DraggableToolbarRectangle;
