import fs from 'fs';
import path from 'path';
import { createCanvas, loadImage } from 'canvas';
import url from 'url';
import { getFramesPerSecondFromValue } from '../FpsUtils.js';
import { isContainerRuntime } from '../EnvironmentUtils.js';

const CANVAS_WIDTH = 1024; // Set this to your desired canvas width
const CANVAS_HEIGHT = 1024; // Set this to your desired canvas height

function getProcessorAssetsRoot(folderName = 'assets_v2') {
  const configuredRoot = folderName === 'assets_v2'
    ? process.env.SAMSAR_ASSETS_V2_ROOT
    : process.env.SAMSAR_ASSETS_ROOT;
  if (configuredRoot) return configuredRoot;
  return isContainerRuntime()
    ? `/${folderName}`
    : path.join(process.cwd(), '..', 'samsar_processor', folderName);
}

function resolveProcessorAssetPath(assetPath) {
  if (typeof assetPath !== 'string' || !assetPath.trim()) {
    return '';
  }

  const rawPath = assetPath.trim();
  if (path.isAbsolute(rawPath) && fs.existsSync(rawPath)) {
    return rawPath;
  }

  const normalizedPath = rawPath
    .replace(/^\/+/, '')
    .replace(/^assets_v2\//, '')
    .replace(/^assets\//, '');
  const roots = rawPath.replace(/^\/+/, '').startsWith('assets_v2/')
    ? [getProcessorAssetsRoot('assets_v2')]
    : [getProcessorAssetsRoot('assets_v2'), getProcessorAssetsRoot('assets')];

  for (const root of roots) {
    const candidatePath = path.join(root, normalizedPath);
    if (fs.existsSync(candidatePath)) {
      return candidatePath;
    }
  }

  return path.join(roots[0], normalizedPath);
}

export async function createCanvasFromLayer(layer, sessionId, startIndex, framesPerSecond) {
  const { imageSession, duration, durationOffset, _id } = layer;
  const effectiveFramesPerSecond = getFramesPerSecondFromValue(framesPerSecond);

  const layerId = _id.toString();
  
  const activeItemList = layer.imageSession.activeItemList;


  if (!activeItemList || activeItemList.length === 0) {
    return;
  }

  const frameNameSpace = path.join('video', 'frames', sessionId, layerId);
  const frameFileBasePath = path.join(getProcessorAssetsRoot('assets_v2'), frameNameSpace);
  


  

  if (!fs.existsSync(frameFileBasePath)) fs.mkdirSync(frameFileBasePath, { recursive: true });


  const frameCount = duration * effectiveFramesPerSecond;
  const frameDuration = 1000 / effectiveFramesPerSecond;

  let frameIndex = startIndex;
  const pwd = process.cwd();

  const framesList = [];

  for (let frame = 0; frame < frameCount; frame++) {
    const elapsedTime = frame * frameDuration;

    const canvas = createCanvas(CANVAS_WIDTH, CANVAS_HEIGHT);
    const ctx = canvas.getContext('2d');

    for (let i = 0; i < activeItemList.length; i++) {
      const item = activeItemList[i];

      let { x, y, width, height, src, fillColor, strokeColor, strokeWidth, type, text, fontFamily, fontSize, radius } = item;

      if (!width) {
        width = CANVAS_WIDTH;
      }
      if (!height) {
        height = CANVAS_HEIGHT;
      }
      
      ctx.save(); // Save the current context state

      // Check if any animation that requires translation is present
      let requiresTranslation = false;
      item.animations?.forEach(animation => {
        if (animation.type === 'rotate' || animation.type === 'slide' || animation.type === 'zoom') {
          requiresTranslation = true;
        }
      });

      // Apply translation for centering rotation or other transformations
      if (requiresTranslation) {
        ctx.translate(x + (width || 0) / 2, y + (height || 0) / 2);
      }

      // Apply animations
      applyAnimationsToObject(ctx, item, elapsedTime, duration, durationOffset);

      // Apply reverse translation if required
      if (requiresTranslation) {
        ctx.translate(-(x + (width || 0) / 2), -(y + (height || 0) / 2));
      }

      if (type === 'image') {
        const originalImagePath = resolveProcessorAssetPath(src);

        const img = await loadImage(originalImagePath);
        ctx.drawImage(img, x, y, width, height);
      } else if (type === 'text') {
        ctx.font = `${fontSize}px ${fontFamily}`;
        ctx.fillStyle = fillColor;
        ctx.fillText(text, x, y);
      } else if (type === 'rectangle') {
        ctx.fillStyle = fillColor;
        ctx.fillRect(x, y, width, height);
        if (strokeColor && strokeWidth) {
          ctx.strokeStyle = strokeColor;
          ctx.lineWidth = strokeWidth;
          ctx.strokeRect(x, y, width, height);
        }
      } else if (type === 'circle') {
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2, true);
        ctx.fillStyle = fillColor;
        ctx.fill();
        if (strokeColor && strokeWidth) {
          ctx.strokeStyle = strokeColor;
          ctx.lineWidth = strokeWidth;
          ctx.stroke();
        }
      }

      ctx.restore(); // Restore the context state
    }

    // Export the frame as PNG
    const buffer = canvas.toBuffer('image/png');
    

    const imageName = `/${frameNameSpace}/${frameIndex}.png`;
    framesList.push(imageName);

    fs.writeFileSync(path.join(frameFileBasePath, `${frameIndex}.png`), buffer);

    frameIndex++;
  }

  return framesList;
}



function applyAnimationsToObject(ctx, item, elapsedTime, duration, durationOffset) {
  const { animations } = item;

  if (!animations) return;

  // Convert duration and durationOffset to milliseconds
  const durationMs = duration * 1000;
  const durationOffsetMs = durationOffset * 1000;
  
  animations.forEach(animation => {
    const { type, params } = animation;
    const startTime = durationOffsetMs;
    const endTime = startTime + durationMs;

    // Calculate the animation progress based on elapsed time
    const animationElapsed = elapsedTime - startTime;
    const totalDuration = endTime - startTime;

    // Only apply the animation if within the animation duration
    if (animationElapsed >= 0 && animationElapsed <= totalDuration) {
      switch (type) {
        case 'fade':
          const startFade = params.startFade / 100;
          const endFade = params.endFade / 100;
          ctx.globalAlpha = startFade + (endFade - startFade) * (animationElapsed / totalDuration);
          break;
        case 'slide':
          const startX = params.startX;
          const endX = params.endX;
          const startY = params.startY;
          const endY = params.endY;
          ctx.translate(
            startX + (endX - startX) * (animationElapsed / totalDuration),
            startY + (endY - startY) * (animationElapsed / totalDuration)
          );
          break;
        case 'zoom':
          const startScale = params.startScale / 100;
          const endScale = params.endScale / 100;
          const scale = startScale + (endScale - startScale) * (animationElapsed / totalDuration);
          ctx.scale(scale, scale);
          break;
        case 'rotate':
          const rotationSpeed = params.rotationSpeed || 1;
          const angle = (animationElapsed / totalDuration) * rotationSpeed * 360;
          ctx.rotate((angle * Math.PI) / 180);
          break;
        default:
          break;
      }
    }
  });
}



export function getCanvasDimensionsForAspectRatio(aspectRatio) {
  if (aspectRatio === '1:1') {
    return {
      width: 1024,
      height: 1024,
    }
  } else if (aspectRatio === '16:9') {
    return {
      width: 1792,
      height: 1024,
    }
  } else if (aspectRatio === '9:16') {
    return {
      width: 1024,
      height: 1792,
    }
  } else {
    return {
      width: 1024,
      height: 1024,
    }
  }

}
