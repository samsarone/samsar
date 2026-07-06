import { getTextConfigForCanvas } from '../constants/TextConfig.jsx';

function buildCanvasFont(config) {
  const fontTokens = [];

  if (config.italic) {
    fontTokens.push('italic');
  }

  if (config.bold) {
    fontTokens.push('bold');
  }

  fontTokens.push(`${config.fontSize}px`);
  fontTokens.push(config.fontFamily || 'Arial');

  return fontTokens.join(' ');
}

function measureTextLine(ctx, line, letterSpacing = 0) {
  const text = `${line || ''}`;
  if (!text) {
    return 0;
  }

  const baseWidth = ctx.measureText(text).width;
  return baseWidth + Math.max(0, Array.from(text).length - 1) * letterSpacing;
}

function wrapTextToWidth(ctx, text, maxWidth, letterSpacing = 0) {
  if (!text) {
    return [''];
  }

  if (!Number.isFinite(maxWidth) || maxWidth <= 0) {
    return `${text}`.split('\n');
  }

  const paragraphs = `${text}`.split('\n');
  const wrappedLines = [];

  for (const paragraph of paragraphs) {
    const words = paragraph.split(/\s+/).filter(Boolean);

    if (words.length === 0) {
      wrappedLines.push('');
      continue;
    }

    let currentLine = words[0];
    for (let index = 1; index < words.length; index += 1) {
      const nextLine = `${currentLine} ${words[index]}`;
      if (measureTextLine(ctx, nextLine, letterSpacing) <= maxWidth) {
        currentLine = nextLine;
      } else {
        wrappedLines.push(currentLine);
        currentLine = words[index];
      }
    }

    wrappedLines.push(currentLine);
  }

  return wrappedLines;
}

function getTextAnchorX(width, textAlign) {
  if (textAlign === 'center') {
    return width / 2;
  }

  if (textAlign === 'right') {
    return width;
  }

  return 0;
}

function drawTextLine(ctx, line, x, y, textAlign, letterSpacing, drawMode) {
  if (!letterSpacing) {
    ctx[drawMode](line, x, y);
    return;
  }

  const measuredWidth = measureTextLine(ctx, line, letterSpacing);
  let startX = x;

  if (textAlign === 'center') {
    startX = x - measuredWidth / 2;
  } else if (textAlign === 'right') {
    startX = x - measuredWidth;
  }

  const previousTextAlign = ctx.textAlign;
  ctx.textAlign = 'left';
  let cursorX = startX;

  for (const character of Array.from(`${line || ''}`)) {
    ctx[drawMode](character, cursorX, y);
    cursorX += ctx.measureText(character).width + letterSpacing;
  }

  ctx.textAlign = previousTextAlign;
}

function drawUnderline(ctx, line, x, y, textAlign, fontSize, letterSpacing = 0) {
  const measuredWidth = measureTextLine(ctx, line, letterSpacing);
  let startX = x;

  if (textAlign === 'center') {
    startX = x - measuredWidth / 2;
  } else if (textAlign === 'right') {
    startX = x - measuredWidth;
  }

  const underlineY = y + fontSize + 2;
  ctx.beginPath();
  ctx.moveTo(startX, underlineY);
  ctx.lineTo(startX + measuredWidth, underlineY);
  ctx.lineWidth = Math.max(1, fontSize * 0.05);
  ctx.strokeStyle = ctx.fillStyle;
  ctx.stroke();
}

export function drawCanvasTextItem(ctx, item, canvasDimensions) {
  if (!ctx || !item || item.type !== 'text') {
    return;
  }

  const config = getTextConfigForCanvas(item.config || {}, canvasDimensions);
  const displayText = config.capitalizeLetters
    ? `${item.text || ''}`.toUpperCase()
    : `${item.text || ''}`;

  if (!displayText.trim()) {
    return;
  }

  const width = Math.max(1, Number(config.width) || 1);
  const height = Math.max(1, Number(config.height) || 1);
  const originX = config.x - width / 2;
  const originY = config.y - height / 2;
  const rotationAngle = Number(config.rotationAngle) || 0;
  const textAlign = config.textAlign || 'left';
  const lineHeight = Math.max(0.1, Number(config.lineHeight) || 1.2);
  const letterSpacing = Number(config.letterSpacing) || 0;

  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.translate(originX, originY);

  if (rotationAngle) {
    ctx.rotate((rotationAngle * Math.PI) / 180);
  }

  ctx.beginPath();
  ctx.rect(0, 0, width, height);
  ctx.clip();

  ctx.font = buildCanvasFont(config);
  ctx.fillStyle = config.fillColor || '#ffffff';
  ctx.textBaseline = 'top';
  ctx.textAlign = textAlign;
  ctx.shadowColor = config.shadowColor || 'transparent';
  ctx.shadowBlur = Number(config.shadowBlur) || 0;
  ctx.shadowOffsetX = Number(config.shadowOffsetX) || 0;
  ctx.shadowOffsetY = Number(config.shadowOffsetY) || 0;

  const lines = config.autoWrap
    ? wrapTextToWidth(ctx, displayText, width, letterSpacing)
    : displayText.split('\n');
  const textAnchorX = getTextAnchorX(width, textAlign);
  const lineHeightPx = config.fontSize * lineHeight;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const lineY = index * lineHeightPx;

    if ((config.strokeWidth || 0) > 0) {
      ctx.strokeStyle = config.strokeColor || '#ffffff';
      ctx.lineWidth = config.strokeWidth || 0;
      drawTextLine(ctx, line, textAnchorX, lineY, textAlign, letterSpacing, 'strokeText');
    }

    drawTextLine(ctx, line, textAnchorX, lineY, textAlign, letterSpacing, 'fillText');

    if (config.underline) {
      drawUnderline(ctx, line, textAnchorX, lineY, textAlign, config.fontSize, letterSpacing);
    }
  }

  ctx.restore();
}
