import fs from 'fs';
import path from 'path';
import { getFramesPerSecondFromValue, getSessionFramesPerSecond } from '../FpsUtils.js';

function getAssetsRoot(folderName = 'assets_v2') {
  return process.env.CURRENT_ENV === 'staging' || process.env.CURRENT_ENV === 'docker'
    ? `/${folderName}`
    : path.join(process.cwd(), folderName);
}

function resolveAssetPath(assetPath) {
  if (typeof assetPath !== 'string' || !assetPath.trim()) {
    return '';
  }
  const normalizedPath = assetPath
    .replace(/^\/+/, '')
    .replace(/^assets_v2\//, '')
    .replace(/^assets\//, '');
  const roots = assetPath.replace(/^\/+/, '').startsWith('assets_v2/')
    ? [getAssetsRoot('assets_v2')]
    : [getAssetsRoot('assets_v2'), getAssetsRoot('assets')];
  for (const root of roots) {
    const candidatePath = path.join(root, normalizedPath);
    if (fs.existsSync(candidatePath)) {
      return candidatePath;
    }
  }
  return path.join(roots[0], normalizedPath);
}

export function setSessionLayerFrames(sessionDetails) {
  const { _id, layers, frames } = sessionDetails;
  const framesPerSecond = getSessionFramesPerSecond(
    sessionDetails,
    'FrameUtils.setSessionLayerFrames'
  );
  const frameDurationMs = 1000 / framesPerSecond;

  const sessionId = _id.toString();
  const frameImageFileBase = path.join(getAssetsRoot('assets_v2'), 'video', 'frames', sessionId);

  if (!fs.existsSync(frameImageFileBase)) {
    fs.mkdirSync(frameImageFileBase, { recursive: true });
  }

  layers.forEach(layer => {
    const { imageSession, duration, _id: layerId, durationOffset } = layer;
    const layerImage = imageSession.activeSelectedImage;
    const durationMs = duration * 1000; // Convert duration from seconds to milliseconds
    const numberOfFrames = Math.round(durationMs / frameDurationMs); // Number of frames for this duration

    const startFrameIndex = Math.round(durationOffset * 1000 / frameDurationMs);

    for (let i = 0; i < numberOfFrames; i++) {
      const globalFrameIndex = startFrameIndex + i;
      const timestamp = calculateTimestamp(globalFrameIndex * frameDurationMs); // Calculate timestamp for each frame

      const frameImageName = `${globalFrameIndex}.png`;
      const frameImagePath = path.join(frameImageFileBase, frameImageName);

      if (layerImage) {
        const layerImagePath = resolveAssetPath(layerImage);
        if (fs.existsSync(layerImagePath)) {
          fs.copyFileSync(layerImagePath, frameImagePath);
        }
      }

      const newFrame = {
        timestamp: timestamp,
        image: frameImageName,
        activeItemList: [],
        layerId: layerId.toString(),
      };
      frames.push(newFrame);
    }
  });

  // Ensure frames array is not null or undefined
  if (!Array.isArray(frames)) {
    throw new Error("Frames list is not an array");
  }

  // Sort frames by timestamp to ensure correct order
  frames.sort((a, b) => a.timestamp - b.timestamp);
}

function calculateTimestamp(ms) {
  const seconds = ms / 1000;
  return seconds.toFixed(3);
}






export function refreshFramesFromLayers(sessionId, layers, frames, framesPerSecond) {
  const effectiveFramesPerSecond = getFramesPerSecondFromValue(framesPerSecond);
  const frameDurationMs = 1000 / effectiveFramesPerSecond;
  let framelist = [...frames]; // Make a shallow copy of frames to modify
  let frameListUpdated = false;
  const frameBasePath = path.join(getAssetsRoot('assets_v2'), 'video', 'frames', sessionId);

  layers.forEach((layer, layerIndex) => {
    const { _id, imageSession: { generationStatus }, duration, durationOffset, image, initFramesGenerated } = layer;
    const layerId = _id;
    const durationMs = duration * 1000; // Convert duration from seconds to milliseconds
    const numberOfFrames = Math.round(durationMs / frameDurationMs); // Number of frames for this duration

    if (!initFramesGenerated && image) {
      let layerFrameStartCounter = 0; // Start counter at 0 for each layer

      for (let i = 0; i < numberOfFrames; i++) {
        const offsetTimeMs = durationOffset * 1000; // Convert durationOffset to milliseconds
        const timestamp = calculateTimestamp(offsetTimeMs + i * frameDurationMs); // Calculate timestamp for each frame

        const frameIndex = framelist.findIndex(frame => frame.timestamp === timestamp && frame.layerId === layerId);
        if (frameIndex !== -1) {
          const frame = framelist[frameIndex];

          const frameImageName = `${sessionId}/${layerFrameStartCounter}.png`;
          layerFrameStartCounter++;
          const imageFilePath = path.join(getAssetsRoot('assets_v2'), 'video', 'frames', frameImageName);
          if (!fs.existsSync(frameBasePath)) {
            fs.mkdirSync(frameBasePath, { recursive: true });
          }
          const layerImageFilePath = resolveAssetPath(image);
          fs.copyFileSync(layerImageFilePath, imageFilePath);
          frame.image = frameImageName;
          frameListUpdated = true; // Set flip to true if any frame is updated
        } else {
          const frameImageName = `${sessionId}/${layerFrameStartCounter}.png`;
          layerFrameStartCounter++;
          const imageFilePath = path.join(getAssetsRoot('assets_v2'), 'video', 'frames', frameImageName);
          if (!fs.existsSync(frameBasePath)) {
            fs.mkdirSync(frameBasePath, { recursive: true });
          }
          const layerImageFilePath = resolveAssetPath(image);
          fs.copyFileSync(layerImageFilePath, imageFilePath);

          const newFrame = {
            image: frameImageName,
            timestamp: timestamp,
            layerId: layerId,
          };
          framelist.push(newFrame);
          frameListUpdated = true;
        }
      }
      layer.initFramesGenerated = true;
    } else {
      if (generationStatus === 'FAILED') {
        layer.initFramesGenerated = true;
        frameListUpdated = true;
      }
    }
  });

  if (frameListUpdated) {
    return { frames: framelist, layers: layers }; // Return the modified framelist
  }
  return { frames, layers }; // Return unmodified framelist if no update occurred
}




export function generateInitialFrames(layers, framesPerSecond) {
  const effectiveFramesPerSecond = getFramesPerSecondFromValue(framesPerSecond);
  const frameDurationMs = 1000 / effectiveFramesPerSecond; // Duration of each frame in milliseconds
  let framelist = [];

  layers.forEach(layer => {
    const { imageSession, duration } = layer;
    const durationMs = duration * 1000; // Convert duration from seconds to milliseconds
    const numberOfFrames = Math.round(durationMs / frameDurationMs); // Number of frames for this duration

    for (let i = 0; i < numberOfFrames; i++) {
      const timestamp = calculateTimestamp(framelist.length * frameDurationMs); 
      framelist.push({
        timestamp: timestamp,
        image: null,
        activeItemList: [],
        layerId: imageSession._id.toString(),
      });
    }
  });

  return framelist;
}


export function updatePendingFramesFromLayers(layers, frames, framesPerSecond) {
  const effectiveFramesPerSecond = getFramesPerSecondFromValue(framesPerSecond);
  const frameDurationMs = 1000 / effectiveFramesPerSecond; // Duration of each frame in milliseconds
  let framelist = [...frames];
  let framesListUpdated = false; // Initialize flip to track updates

  layers.forEach(layer => {
    const { image, duration, imageSession } = layer;
    const durationMs = duration * 1000; // Convert duration from seconds to milliseconds
    const numberOfFrames = Math.round(durationMs / frameDurationMs); // Number of frames for this duration

    if (image) {
      const layerFrames = framelist.filter(frame => frame.layerId === imageSession);
      for (let i = 0; i < layerFrames.length; i++) {
        if (!layerFrames[i].image) {
        layerFrames[i].image = image;

        framesListUpdated = true; // Set flip to true if any frame is updated
          framelist
        }
      }
    }
  });



  if (framesListUpdated) {
    return framelist;
  }
  return null;
}


export function getLayerFrameStartIndex(layers, layer, framesPerSecond) {
  const effectiveFramesPerSecond = getFramesPerSecondFromValue(framesPerSecond);
  const frameDurationMs = 1000 / effectiveFramesPerSecond;
  let totalFramesSoFar = 0;
  for (let i = 0; i < layers.length; i++) {
    const { duration } = layers[i];
    const durationMs = duration * 1000; // Convert duration from seconds to milliseconds
    const numberOfFrames = Math.round(durationMs / frameDurationMs); // Number of frames for this duration
    if (layers[i]._id.toString() === layer._id.toString()) {
      return totalFramesSoFar;
    }
    totalFramesSoFar += numberOfFrames;
  }
  return 0;
}
