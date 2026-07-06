import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { Group, Rect, Text, Transformer } from 'react-konva';

import { INIT_DIMENSIONS } from '../../editor/utils/ShapeUtils.jsx';

const MIN_TEXT_DIMENSION = 24;
const MIN_TEXT_FONT_SIZE = 8;

function buildShapeState(config = {}) {
  const width = config.width ?? 100;
  const height = config.height ?? 50;

  let fontStyle = '';
  if (config.bold) fontStyle += 'bold ';
  if (config.italic) fontStyle += 'italic ';
  if (config.fontEmphasis === 'bold') fontStyle += 'bold ';
  if (!fontStyle.trim()) {
    fontStyle = 'normal';
  }

  return {
    x: (config.x ?? INIT_DIMENSIONS.x) - width / 2,
    y: (config.y ?? INIT_DIMENSIONS.y) - height / 2,
    width,
    height,
    fontFamily: config.fontFamily || 'Arial',
    fontSize: config.fontSize ?? 16,
    fillColor: config.fillColor || '#ffffff',
    textDecoration: config.underline ? 'underline' : '',
    fontStyle: fontStyle.trim(),
    textAlign: config.textAlign || 'center',
    strokeColor: config.strokeColor || '#ffffff',
    strokeWidth: config.strokeWidth ?? 0,
    shadowColor: config.shadowColor || 'transparent',
    shadowBlur: config.shadowBlur ?? 0,
    shadowOffsetX: config.shadowOffsetX ?? 0,
    shadowOffsetY: config.shadowOffsetY ?? 0,
    rotationAngle: config.rotationAngle ?? 0,
    autoWrap: config.autoWrap !== false,
    capitalizeLetters: Boolean(config.capitalizeLetters),
    lineHeight: config.lineHeight ?? 1.2,
    letterSpacing: config.letterSpacing ?? 0,
  };
}

function areShapeStatesEqual(currentState, nextState) {
  if (!currentState || !nextState) {
    return false;
  }

  return (
    currentState.x === nextState.x &&
    currentState.y === nextState.y &&
    currentState.width === nextState.width &&
    currentState.height === nextState.height &&
    currentState.fontFamily === nextState.fontFamily &&
    currentState.fontSize === nextState.fontSize &&
    currentState.fillColor === nextState.fillColor &&
    currentState.textDecoration === nextState.textDecoration &&
    currentState.fontStyle === nextState.fontStyle &&
    currentState.textAlign === nextState.textAlign &&
    currentState.strokeColor === nextState.strokeColor &&
    currentState.strokeWidth === nextState.strokeWidth &&
    currentState.shadowColor === nextState.shadowColor &&
    currentState.shadowBlur === nextState.shadowBlur &&
    currentState.shadowOffsetX === nextState.shadowOffsetX &&
    currentState.shadowOffsetY === nextState.shadowOffsetY &&
    currentState.rotationAngle === nextState.rotationAngle &&
    currentState.autoWrap === nextState.autoWrap &&
    currentState.capitalizeLetters === nextState.capitalizeLetters &&
    currentState.lineHeight === nextState.lineHeight &&
    currentState.letterSpacing === nextState.letterSpacing
  );
}

const ResizableText = ({
  text,
  isSelected,
  onSelect,
  updateToolbarButtonPosition,
  updateTargetActiveLayerConfig,
  stageZoomScale = 1,
  config,
  id,
  isDraggable = true,
}) => {
  const [shapeState, setShapeState] = useState(() => buildShapeState(config));
  const groupRef = useRef(null);
  const textRef = useRef(null);
  const transformerRef = useRef(null);
  const transformPreviewRef = useRef(shapeState);
  const interactionStateRef = useRef({
    dragging: false,
    transforming: false,
  });
  const previousMeasuredSizeRef = useRef({
    width: shapeState.width,
    height: shapeState.height,
  });

  useEffect(() => {
    transformPreviewRef.current = shapeState;
  }, [shapeState]);

  useEffect(() => {
    if (interactionStateRef.current.dragging || interactionStateRef.current.transforming) {
      return;
    }

    const nextShapeState = buildShapeState(config);
    setShapeState((prevState) =>
      areShapeStatesEqual(prevState, nextShapeState) ? prevState : nextShapeState
    );
    previousMeasuredSizeRef.current = {
      width: nextShapeState.width,
      height: nextShapeState.height,
    };
  }, [
    text,
    config?.x,
    config?.y,
    config?.width,
    config?.height,
    config?.fontFamily,
    config?.fontSize,
    config?.fillColor,
    config?.underline,
    config?.bold,
    config?.italic,
    config?.fontEmphasis,
    config?.textAlign,
    config?.strokeColor,
    config?.strokeWidth,
    config?.shadowColor,
    config?.shadowBlur,
    config?.shadowOffsetX,
    config?.shadowOffsetY,
    config?.rotationAngle,
    config?.autoWrap,
    config?.capitalizeLetters,
    config?.lineHeight,
    config?.letterSpacing,
  ]);

  useEffect(() => {
    if (!transformerRef.current || !groupRef.current) return;

    if (isSelected) {
      transformerRef.current.nodes([groupRef.current]);
    } else {
      transformerRef.current.nodes([]);
    }
    transformerRef.current.getLayer()?.batchDraw();
  }, [isSelected]);

  useEffect(() => {
    if (!textRef.current) return;
    if (shapeState.autoWrap) {
      previousMeasuredSizeRef.current = {
        width: shapeState.width,
        height: shapeState.height,
      };
      return;
    }

    const node = textRef.current;
    const measuredWidth = node.width();
    const measuredHeight = node.height();

    if (
      measuredWidth !== previousMeasuredSizeRef.current.width ||
      measuredHeight !== previousMeasuredSizeRef.current.height
    ) {
      previousMeasuredSizeRef.current = {
        width: measuredWidth,
        height: measuredHeight,
      };
      setShapeState((prevState) => ({
        ...prevState,
        width: measuredWidth,
        height: measuredHeight,
      }));
    }
  }, [
    text,
    shapeState.fontFamily,
    shapeState.fontSize,
    shapeState.fontStyle,
    shapeState.textDecoration,
    shapeState.textAlign,
    shapeState.strokeColor,
    shapeState.strokeWidth,
    shapeState.fillColor,
    shapeState.autoWrap,
    shapeState.lineHeight,
    shapeState.letterSpacing,
  ]);

  const displayText = useMemo(
    () => (shapeState.capitalizeLetters ? `${text || ''}`.toUpperCase() : `${text || ''}`),
    [shapeState.capitalizeLetters, text]
  );

  const getGroupNode = (event) => groupRef.current || event?.currentTarget || event?.target;

  const updateShapePosition = (node) => {
    if (!node) {
      return;
    }

    const nextX = node.x();
    const nextY = node.y();
    updateToolbarButtonPosition(id, nextX, nextY);

    setShapeState((prevState) => ({
      ...prevState,
      x: nextX,
      y: nextY,
    }));
  };

  const handleDragMove = (event) => {
    updateShapePosition(getGroupNode(event));
  };

  const handleDragEnd = (event) => {
    const node = getGroupNode(event);
    if (!node) {
      interactionStateRef.current.dragging = false;
      return;
    }

    const committedWidth = Math.max(
      MIN_TEXT_DIMENSION,
      previousMeasuredSizeRef.current.width || shapeState.width
    );
    const committedHeight = Math.max(
      MIN_TEXT_DIMENSION,
      previousMeasuredSizeRef.current.height || shapeState.height
    );
    interactionStateRef.current.dragging = false;
    updateShapePosition(node);

    updateTargetActiveLayerConfig(id, {
      x: (node.x() + committedWidth / 2) / stageZoomScale,
      y: (node.y() + committedHeight / 2) / stageZoomScale,
      width: committedWidth,
      height: committedHeight,
      positionMode: 'center',
      bringToFront: true,
    });
  };

  const handleTransformEnd = () => {
    const groupNode = groupRef.current;
    if (!groupNode) return;

    const nextState = {
      ...transformPreviewRef.current,
      x: groupNode.x(),
      y: groupNode.y(),
    };

    interactionStateRef.current.transforming = false;
    updateToolbarButtonPosition(id, nextState.x, nextState.y);
    previousMeasuredSizeRef.current = {
      width: nextState.width,
      height: nextState.height,
    };
    setShapeState((prevState) => ({
      ...prevState,
      ...nextState,
    }));

    updateTargetActiveLayerConfig(id, {
      x: (nextState.x + nextState.width / 2) / stageZoomScale,
      y: (nextState.y + nextState.height / 2) / stageZoomScale,
      width: nextState.width,
      height: nextState.height,
      fontSize: nextState.fontSize,
      strokeWidth: nextState.strokeWidth,
      lineHeight: nextState.lineHeight,
      positionMode: 'center',
    });
  };

  const handleTransform = () => {
    const groupNode = groupRef.current;
    if (!groupNode) return;

    const scaleX = Math.abs(groupNode.scaleX() || 1);
    const scaleY = Math.abs(groupNode.scaleY() || 1);
    const appliedScale = Math.max(scaleX, scaleY, 0.1);

    const nextWidth = Math.max(MIN_TEXT_DIMENSION, shapeState.width * scaleX);
    const nextHeight = Math.max(MIN_TEXT_DIMENSION, shapeState.height * scaleY);
    const nextFontSize = Math.max(MIN_TEXT_FONT_SIZE, shapeState.fontSize * appliedScale);
    const nextStrokeWidth =
      shapeState.strokeWidth > 0 ? Math.max(0, shapeState.strokeWidth * appliedScale) : 0;
    const nextX = groupNode.x();
    const nextY = groupNode.y();

    groupNode.scaleX(1);
    groupNode.scaleY(1);
    updateToolbarButtonPosition(id, nextX, nextY);
    previousMeasuredSizeRef.current = {
      width: nextWidth,
      height: nextHeight,
    };
    transformPreviewRef.current = {
      ...shapeState,
      x: nextX,
      y: nextY,
      width: nextWidth,
      height: nextHeight,
      fontSize: nextFontSize,
      strokeWidth: nextStrokeWidth,
    };

    setShapeState((prevState) => ({
      ...prevState,
      x: nextX,
      y: nextY,
      width: nextWidth,
      height: nextHeight,
      fontSize: nextFontSize,
      strokeWidth: nextStrokeWidth,
    }));
  };

  return (
    <Fragment>
      <Group
        id={`group_${id}`}
        ref={groupRef}
        x={shapeState.x}
        y={shapeState.y}
        draggable={!config?.fixed && Boolean(isDraggable)}
        onClick={(event) => {
          event.cancelBubble = true;
          onSelect();
        }}
        onTap={(event) => {
          event.cancelBubble = true;
          onSelect();
        }}
        onDragStart={(event) => {
          interactionStateRef.current.dragging = true;
          getGroupNode(event)?.moveToTop?.();
        }}
        onDragMove={handleDragMove}
        onDragEnd={handleDragEnd}
        onTransformStart={() => {
          interactionStateRef.current.transforming = true;
        }}
        onTransform={handleTransform}
        onTransformEnd={handleTransformEnd}
      >
        <Rect
          width={Math.max(shapeState.width, MIN_TEXT_DIMENSION)}
          height={Math.max(shapeState.height, MIN_TEXT_DIMENSION)}
          fill="rgba(255,255,255,0.001)"
        />

        {isSelected ? (
          <Rect
            width={Math.max(shapeState.width, MIN_TEXT_DIMENSION)}
            height={Math.max(shapeState.height, MIN_TEXT_DIMENSION)}
            stroke="rgba(70,191,255,0.9)"
            strokeWidth={1}
            dash={[4, 4]}
            cornerRadius={8}
            listening={false}
          />
        ) : null}

        {shapeState.strokeWidth > 0 ? (
          <Text
            x={0}
            y={0}
            fontFamily={shapeState.fontFamily}
            fontSize={shapeState.fontSize}
            textDecoration={shapeState.textDecoration}
            fontStyle={shapeState.fontStyle}
            align={shapeState.textAlign}
            text={displayText}
            stroke={shapeState.strokeColor}
            strokeWidth={shapeState.strokeWidth}
            shadowColor={shapeState.shadowColor}
            shadowBlur={shapeState.shadowBlur}
            shadowOffsetX={shapeState.shadowOffsetX}
            shadowOffsetY={shapeState.shadowOffsetY}
            rotation={shapeState.rotationAngle}
            wrap={shapeState.autoWrap ? 'word' : 'none'}
            lineHeight={shapeState.lineHeight}
            letterSpacing={shapeState.letterSpacing}
            width={shapeState.autoWrap ? shapeState.width : undefined}
            height={shapeState.autoWrap ? shapeState.height : undefined}
            listening={false}
          />
        ) : null}

        <Text
          id={id}
          x={0}
          y={0}
          fontFamily={shapeState.fontFamily}
          fontSize={shapeState.fontSize}
          fill={shapeState.fillColor}
          textDecoration={shapeState.textDecoration}
          fontStyle={shapeState.fontStyle}
          align={shapeState.textAlign}
          text={displayText}
          shadowColor={shapeState.shadowColor}
          shadowBlur={shapeState.shadowBlur}
          shadowOffsetX={shapeState.shadowOffsetX}
          shadowOffsetY={shapeState.shadowOffsetY}
          rotation={shapeState.rotationAngle}
          wrap={shapeState.autoWrap ? 'word' : 'none'}
          lineHeight={shapeState.lineHeight}
          letterSpacing={shapeState.letterSpacing}
          width={shapeState.autoWrap ? shapeState.width : undefined}
          height={shapeState.autoWrap ? shapeState.height : undefined}
          ref={textRef}
          listening={false}
        />
      </Group>

      {isSelected ? (
        <Transformer
          ref={transformerRef}
          rotateEnabled={false}
          keepRatio={false}
          padding={10}
          anchorSize={14}
          anchorCornerRadius={999}
          enabledAnchors={[
            'top-left',
            'top-center',
            'top-right',
            'middle-left',
            'middle-right',
            'bottom-left',
            'bottom-center',
            'bottom-right',
          ]}
          borderStroke="rgba(70,191,255,0.01)"
          borderStrokeWidth={0.1}
          anchorFill="#ffffff"
          anchorStroke="#46bfff"
          anchorStrokeWidth={2.5}
          flipEnabled={false}
          boundBoxFunc={(oldBox, newBox) => {
            if (newBox.width < MIN_TEXT_DIMENSION || newBox.height < MIN_TEXT_DIMENSION) {
              return oldBox;
            }
            return newBox;
          }}
        />
      ) : null}
    </Fragment>
  );
};

export default ResizableText;
