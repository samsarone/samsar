import { useRef, useEffect, useState } from 'react';
import { Text, Transformer, Group } from 'react-konva';

import { INIT_DIMENSIONS } from './utils/ShapeUtils';

const ResizableText = ({
  text,
  isSelected,
  onSelect,
  updateToolbarButtonPosition,
  updateTargetActiveLayerConfig,
  stageZoomScale,
  ...props
}) => {


  
  const [shapeState, setShapeState] = useState({
    x: props.config.x || INIT_DIMENSIONS.x,
    y: props.config.y || INIT_DIMENSIONS.y,
    width: props.config.width || 100,
    height: props.config.height || 50,
    fontFamily: props.config.fontFamily || 'Arial',
    fontSize: props.config.fontSize || 16,
    fillColor: props.config.fillColor || '#ffffff',
    textDecoration: props.config.underline ? 'underline' : '',
    fontStyle: 'normal',
    align: props.config.align || 'left',
    stroke: props.config.stroke || 'transparent',
    strokeWidth: props.config.strokeWidth || 0,
    shadowColor: props.config.shadowColor || 'transparent',
    shadowBlur: props.config.shadowBlur || 0,
    shadowOffsetX: props.config.shadowOffsetX || 0,
    shadowOffsetY: props.config.shadowOffsetY || 0,
    rotationAngle: props.config.rotationAngle || 0,
    autoWrap: props.config.autoWrap !== false,
    capitalizeLetters: Boolean(props.config.capitalizeLetters),
    lineHeight: props.config.lineHeight || 1.2,
    letterSpacing: props.config.letterSpacing || 0,
  });

  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [isConfigSet, setIsConfigSet] = useState(false);

  useEffect(() => {
    if (!isConfigSet) {
      setIsConfigSet(true);
      setShapeState((prevState) => ({
        ...prevState,
        x: props.config.x || INIT_DIMENSIONS.x,
        y: props.config.y || INIT_DIMENSIONS.y,
        fontFamily: props.config.fontFamily || 'Arial',
        fontSize: props.config.fontSize || 16,
        fillColor: props.config.fillColor || '#ffffff',
        textDecoration: props.config.underline ? 'underline' : '',
        align: props.config.align || 'left',
        stroke: props.config.stroke || 'transparent',
        strokeWidth: props.config.strokeWidth || 0,
        shadowColor: props.config.shadowColor || 'transparent',
        shadowBlur: props.config.shadowBlur || 0,
        shadowOffsetX: props.config.shadowOffsetX || 0,
        shadowOffsetY: props.config.shadowOffsetY || 0,
        rotationAngle: props.config.rotationAngle || 0,
        autoWrap: props.config.autoWrap !== false,
        capitalizeLetters: Boolean(props.config.capitalizeLetters),
        lineHeight: props.config.lineHeight || 1.2,
        letterSpacing: props.config.letterSpacing || 0,
      }));
    }
  }, [props.config, isConfigSet]);

  const textRef = useRef();
  const trRef = useRef();
  const { config, id } = props;

  useEffect(() => {
    if (trRef.current) {
      if (isSelected && textRef.current) {
        trRef.current.nodes([textRef.current]);
        trRef.current.getLayer().batchDraw();
      } else {
        // Ensure transformer is detached when not selected
        trRef.current.nodes([]);
        trRef.current.getLayer().batchDraw();
      }
    }
  }, [isSelected]);

  useEffect(() => {
    let fontStyle = '';
    if (config.bold) {
      fontStyle += 'bold ';
    }
    if (config.italic) {
      fontStyle += 'italic ';
    }
    if (config.fontEmphasis === 'bold') {
      fontStyle += 'bold ';
    }
    if (fontStyle.trim() === '') {
      fontStyle = 'normal';
    }

    setShapeState((prevState) => ({
      ...prevState,
      fontStyle: fontStyle.trim(),
    }));
  }, [config.bold, config.italic, config.fontEmphasis]);

  // Update offset when text or styling changes
  useEffect(() => {
    if (textRef.current) {
      const node = textRef.current;
      const textWidth = node.width();
      const textHeight = node.height();




      setOffset({ x: textWidth / 2, y: textHeight / 2 });

      // Update shapeState width and height
      setShapeState((prevState) => ({
        ...prevState,
        width: textWidth,
        height: textHeight,
      }));
    }
  }, [
    text,
    shapeState.fontSize,
    shapeState.fontFamily,
    shapeState.fontStyle,
    shapeState.textDecoration,
    shapeState.align,
    shapeState.fillColor,
    shapeState.stroke,
    shapeState.strokeWidth,
    shapeState.shadowColor,
    shapeState.shadowBlur,
    shapeState.shadowOffsetX,
    shapeState.shadowOffsetY,
    shapeState.rotationAngle,
    shapeState.autoWrap,
    shapeState.capitalizeLetters,
    shapeState.lineHeight,
    shapeState.letterSpacing,
  ]);

  const handleDragMove = (e) => {

  

    const node = e.target;
    const newX = node.x();
    const newY = node.y();

    node.width();

    node.height();

    updateToolbarButtonPosition(id, newX, newY);

    const payload = {
      x: newX,
      y: newY,
    }


    updateTargetActiveLayerConfig(id, payload, true);

    setShapeState((prevState) => ({
      ...prevState,
      x: newX,
      y: newY,
    }));
  };

  

  const handleTransformEnd = () => {
    const node = textRef.current;
    const scaleX = node.scaleX();
    const scaleY = node.scaleY();

    // Update width and height based on the scale
    const newWidth = node.width() * scaleX;
    const newHeight = node.height() * scaleY;

    // Reset the scale back to 1
    node.scaleX(1);
    node.scaleY(1);

    setShapeState((prevState) => ({
      ...prevState,
      x: node.x(),
      y: node.y(),
      width: newWidth,
      height: newHeight,
    }));


    const payload = {
      x: node.x(),
      y: node.y(),
      width: newWidth,
      height: newHeight,
    };
    


    updateTargetActiveLayerConfig(id, payload);
  };

  let displayText = text;
  if (shapeState.capitalizeLetters) {
    displayText = text.toUpperCase();
  }

  return (
    <Group id={`group_${id}`}>
    {/* Stroke Text */}
    {shapeState.strokeWidth > 0 && (
      <Text
        {...props}
        x={shapeState.x}
        y={shapeState.y}
        offsetX={offset.x}
        offsetY={offset.y}
        fontFamily={shapeState.fontFamily}
        fontSize={shapeState.fontSize}
        textDecoration={shapeState.textDecoration}
        fontStyle={shapeState.fontStyle}
        align={shapeState.align}
        text={displayText}
        stroke={shapeState.stroke}
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
        ref={textRef}
        listening={false} // This text is for stroke only, not interactive
      />
    )}
    {/* Fill Text */}
    <Text
      {...props}
      x={shapeState.x}
      y={shapeState.y}
      offsetX={offset.x}
      offsetY={offset.y}
      fontFamily={shapeState.fontFamily}
      fontSize={shapeState.fontSize}
      fill={shapeState.fillColor}
      textDecoration={shapeState.textDecoration}
      fontStyle={shapeState.fontStyle}
      align={shapeState.align}
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
      onClick={onSelect}
      onTap={onSelect}
      draggable
      onDragMove={handleDragMove}
      onTransformEnd={handleTransformEnd}
    />
    {isSelected && (
      <Transformer
        ref={trRef}
        boundBoxFunc={(oldBox, newBox) => {
          if (newBox.width < 5 || newBox.height < 5) {
            return oldBox;
          }
          return newBox;
        }}
      />
    )}
  </Group>
  )
    
};

export default ResizableText;
