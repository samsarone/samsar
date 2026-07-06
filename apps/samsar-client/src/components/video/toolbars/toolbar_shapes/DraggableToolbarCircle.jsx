import { useRef, useEffect } from 'react';
import { Circle, Transformer } from 'react-konva';

const DraggableToolbarCircle = ({ shapeProps, setShapeProps, isDrawing, id, shapeSet }) => {
  const shapeRef = useRef();
  const transformerRef = useRef();

  useEffect(() => {
    if (shapeSet) {
      transformerRef.current.nodes([shapeRef.current]);
      transformerRef.current.getLayer().batchDraw();
    }
  }, [shapeSet]);

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
      node.scaleY();

      // Reset scale to 1 and apply the new width and height to avoid cumulative scaling
      node.scaleX(1);
      node.scaleY(1);

      const newProps = {
        ...shapeProps,
        x: node.x(),
        y: node.y(),
        radius: (node.width() * scaleX) / 2,
      };
      setShapeProps(newProps);
    }
  };


  return (
    <>
      <Circle
        id={id} 
        type="circle"
        ref={shapeRef}
        {...shapeProps}
        stroke="grey"
        draggable={!isDrawing}
        onDragMove={handleDragMove}
        onTransform={handleTransform}
        onTransformEnd={handleTransform}
      />
      {shapeSet && (
        <Transformer
          ref={transformerRef}
          rotateEnabled={false}
          enabledAnchors={['top-left', 'top-right', 'bottom-left', 'bottom-right']}
        />
      )}
    </>
  );
};

export default DraggableToolbarCircle;
