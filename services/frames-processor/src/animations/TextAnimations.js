// animations/TextAnimations.js
import { wrapText } from '../utils/TextUtils.js'; // Remove if not needed
import { getFramesPerSecondFromValue } from '../utils/FpsUtils.js';

export function applyTextAnimations(ctx, item, elapsedTime, framesPerSecond) {
  const effectiveFramesPerSecond = getFramesPerSecondFromValue(framesPerSecond);


  
  const { animations, animation } = item;

  const hasAnimations = Array.isArray(animations) && animations.length > 0;

  if (!hasAnimations) {
    // If no animations, just render the text
    renderText(ctx, item);
    return;
  }

  animations.sort((a, b) => a.startFrame - b.startFrame);

  let animationApplied = false;

  animations.forEach(animation => {
    const { type, startFrame, endFrame } = animation;

    const startTime = startFrame * (1000 / effectiveFramesPerSecond);
    const endTime = endFrame * (1000 / effectiveFramesPerSecond);
    const totalDuration = endTime - startTime;
    const animationElapsed = elapsedTime - startTime;

    if (animationElapsed >= 0 && animationElapsed <= totalDuration) {
      const t = animationElapsed / totalDuration; // Progress [0,1]

      switch (type) {
        case 'typewriter':
          applyTypewriterEffect(ctx, item, t);
          animationApplied = true;
          break;
        case 'fade-in':
          applyFadeInEffect(ctx, item, t);
          animationApplied = true;
          break;
        case 'fade-out':
          applyFadeOutEffect(ctx, item, t);
          animationApplied = true;
          break;
        case 'slide-in':
          applySlideInEffect(ctx, item, t);
          animationApplied = true;
          break;
        case 'slide-out':
          applySlideOutEffect(ctx, item, t);
          animationApplied = true;
          break;
        default:
          renderText(ctx, item);
          animationApplied = true;
      }
    } else if (animationElapsed > totalDuration) {
      // After animation ends
      if (type === 'fade-in' || type === 'slide-in' || type === 'typewriter') {
        // Just render normally
        renderText(ctx, item);
        animationApplied = true;
      }
      // For 'fade-out' and 'slide-out', do not render after animation ends
    }
  });

  if (!animationApplied) {
    const lastAnimation = animations[animations.length - 1];
    if (lastAnimation && (lastAnimation.type === 'fade-in' || lastAnimation.type === 'slide-in' || lastAnimation.type === 'typewriter')) {
      renderText(ctx, item);
    }
    // For fade-out and slide-out, do not render after animation ends
  }
}

function applyTypewriterEffect(ctx, item, t) {
  const { text } = item;
  const config = item.config || {};

  setupTextContext(ctx, config);

  const totalCharacters = text.length;
  const currentCharacters = Math.floor(totalCharacters * t);
  const displayText = text.substring(0, currentCharacters);



  renderExactText(ctx, displayText, config);
}

function applyFadeInEffect(ctx, item, t) {
  ctx.save();
  ctx.globalAlpha = t;
  renderText(ctx, item);
  ctx.restore();
}

function applyFadeOutEffect(ctx, item, t) {
  ctx.save();
  ctx.globalAlpha = 1 - t;
  renderText(ctx, item);
  ctx.restore();
}

function applySlideInEffect(ctx, item, t) {
  ctx.save();
  const config = item.config || {};
  const { x } = config;
  const startX = x - 200;
  const currentX = startX + (x - startX) * t;
  ctx.translate(currentX - x, 0);
  renderText(ctx, item);
  ctx.restore();
}

function applySlideOutEffect(ctx, item, t) {
  ctx.save();
  const config = item.config || {};
  const { x } = config;
  const endX = x + 200;
  const currentX = x + (endX - x) * t;
  ctx.translate(currentX - x, 0);
  renderText(ctx, item);
  ctx.restore();
}


function setupTextContext(ctx, config) {
  const {
    fontSize = 40,
    fontFamily = 'Arial',
    fillColor = '#000',
    strokeColor,
    strokeWidth,
    textAlign = 'left',
    fontEmphasis,
    textShadow,
    rotationAngle,
  } = config;



  let fontStyle = '';
  if (fontEmphasis === 'bold') {
    fontStyle = 'bold ';
  } else if (fontEmphasis === 'italic') {
    fontStyle = 'italic ';
  }

  ctx.textBaseline = 'middle';//  well see


  ctx.font = `${fontStyle}${fontSize}px ${fontFamily}`;
  ctx.fillStyle = fillColor;
  ctx.textAlign = textAlign;

  if (textShadow) {
    const {
      color = 'rgba(0, 0, 0, 0.3)',
      blur = 4,
      offsetX = 2,
      offsetY = 2
    } = textShadow;

    ctx.shadowColor = color;
    ctx.shadowBlur = blur;
    ctx.shadowOffsetX = offsetX;
    ctx.shadowOffsetY = offsetY;
  } else {
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;
  }


  if (rotationAngle) {
    const centerX = config.x;
    const centerY = config.y;

    ctx.translate(centerX, centerY);
    ctx.rotate((rotationAngle * Math.PI) / 180);
    ctx.translate(-centerX, -centerY);
  }
}



function renderText(ctx, item) {
  const { text } = item;
  const config = item.config || {};

  setupTextContext(ctx, config);
  renderExactText(ctx, text, config);
}


function renderExactText(ctx, text, config) {


  const {
    x: originalX,
    y: originalY,
    fontSize = 40,
    strokeColor,
    strokeWidth,
    width,
    height,
    lineHeight = 1,  // Default lineHeight to 1 if not provided
    autoWrap
  } = config;

  // Split text by newline
  let lines = text.split('\n');

  if (autoWrap) {
    const maxWidth = 600;
    // Wrap each line if it exceeds max width
    // flatMap is used in case wrapped lines increase line count
    lines = lines.flatMap(line => wrapText(ctx, line, maxWidth));
  }

  const lineCount = lines.length;
  
  // Calculate total text block height
  const totalHeight = lineCount * fontSize * lineHeight;

  // Starting y coordinate so that the block of text is centered vertically around originalY
  const startY = originalY - (totalHeight / 2) + (fontSize * lineHeight) / 2;

  const x = originalX;

  // If stroke is needed, set stroke parameters now (to avoid re-setting for each line)
  if (strokeColor && strokeWidth) {
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = strokeWidth;
  }

  // Render each line
  lines.forEach((line, i) => {
    const lineY = startY + i * (fontSize * lineHeight);

    // Stroke text if needed
    if (strokeColor && strokeWidth) {
      ctx.strokeText(line, x, lineY);
    }

    // Fill text
    ctx.fillText(line, x, lineY);
  });
}
