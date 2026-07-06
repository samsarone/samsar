import { getFramesPerSecondFromValue } from './FpsUtils.js';

/**
 * Pads the given layer with its "last frame" item if we need to increase
 * the layer duration to match a new final duration (e.g., when audio is longer).
 * 
 * @param {Object} layer - the layer object from DB (videoSession.layers[i])
 * @param {Number} oldDuration - the original layer.duration before extending
 * @param {Number} newDuration - the final extended duration we need
 * @param {String} layerId - the layer's _id as string
 * @param {Object} canvasDims - e.g. { width, height }
 */
 export function padLayerWithLastFrame(
  layer,
  oldDuration,
  newDuration,
  layerId,
  canvasDims,
  framesPerSecond
) {
  const diff = newDuration - oldDuration;
  if (diff <= 0) return; // no extension required

  // We need to figure out which "frame" to use as the last frame:
  //   If this is an AI-generated layer, you may have `aiLayerEndFrame`.
  //   If it's lip-sync, you might have `lipSyncVideoLayer` frames, etc.
  //   Fallback to a base image or anything you prefer if no "endFrame" is set.
  // 
  let lastFramePath = layer.aiLayerEndFrame 
                    || layer.baseLayerEndFrame 
                    || ''; // fallback if nothing found

  // If you truly have no lastFrame, do a fallback:
  if (!lastFramePath) {
    // This might be your "default" or the first item’s src,
    // or you can skip padding altogether if you can’t find a frame.
    const firstImageItem = layer.imageSession.activeItemList.find(it => it.type === 'image');
    if (firstImageItem) {
      lastFramePath = firstImageItem.src;
    } else {
      // no image at all => skip
      return;
    }
  }

  const effectiveFramesPerSecond = getFramesPerSecondFromValue(framesPerSecond);
  // The offset (in frames) to place this last-frame item is the old total frames
  const frameOffset = Math.round(oldDuration * effectiveFramesPerSecond);
  // The frameDuration is how many frames we need to pad
  const frameDuration = Math.round(diff * effectiveFramesPerSecond);

  // Optionally filter out existing big image items if you want only a static last frame,
  // or keep them if you want them to remain, etc. You might mirror your logic from 
  // processVideoGenerationCompletion(...) or handle differently:
  let newActiveItemList = layer.imageSession.activeItemList.filter(item => {
    // Example: keep text, remove big images
    if (item.type === 'text') return true;
    return false;
  });

  const newImageItem = {
    type: 'image',
    src: lastFramePath,
    x: 0,
    y: 0,
    width: canvasDims.width,
    height: canvasDims.height,
    id: `item_padding_${layerId}`,
    config: {
      frameDuration,
      frameOffset
    },
    animations: []
  };
  
  newActiveItemList.push(newImageItem);
  layer.imageSession.activeItemList = newActiveItemList;

  // Mark frames for regeneration
  layer.frameGenerationPending = true;

  // Update the layer duration
  return layer;
}


 export function padLipSyncLayerWithLastFrame(
  layer,
  oldDuration,
  newDuration,
  layerId,
  canvasDims,
  framesPerSecond
) {
  const diff = newDuration - oldDuration;
  if (diff <= 0) return; // no extension required

  // We need to figure out which "frame" to use as the last frame:
  //   If this is an AI-generated layer, you may have `aiLayerEndFrame`.
  //   If it's lip-sync, you might have `lipSyncVideoLayer` frames, etc.
  //   Fallback to a base image or anything you prefer if no "endFrame" is set.
  // 
  let lastFramePath = layer.aiLayerEndFrame 
                    || layer.baseLayerEndFrame 
                    || ''; // fallback if nothing found

  // If you truly have no lastFrame, do a fallback:
  if (!lastFramePath) {
    // This might be your "default" or the first item’s src,
    // or you can skip padding altogether if you can’t find a frame.
    const firstImageItem = layer.imageSession.activeItemList.find(it => it.type === 'image');
    if (firstImageItem) {
      lastFramePath = firstImageItem.src;
    } else {
      // no image at all => skip
      return;
    }
  }

  const effectiveFramesPerSecond = getFramesPerSecondFromValue(framesPerSecond);
  // The offset (in frames) to place this last-frame item is the old total frames
  const frameOffset = Math.round(oldDuration * effectiveFramesPerSecond);
  // The frameDuration is how many frames we need to pad
  const frameDuration = Math.round(diff * effectiveFramesPerSecond);

  // Optionally filter out existing big image items if you want only a static last frame,
  // or keep them if you want them to remain, etc. You might mirror your logic from 
  // processVideoGenerationCompletion(...) or handle differently:
  let newActiveItemList = layer.imageSession.activeItemList.filter(item => {
    // Example: keep text, remove big images
    if (item.type === 'text') return true;
    return false;
  });

  const newImageItem = {
    type: 'image',
    src: lastFramePath,
    x: 0,
    y: 0,
    width: canvasDims.width,
    height: canvasDims.height,
    id: `item_padding_${layerId}`,
    is_config_image: true,
    config: {
      frameDuration,
      frameOffset
    },
    animations: []
  };
  
  newActiveItemList.push(newImageItem);
  layer.imageSession.activeItemList = newActiveItemList;

  // Mark frames for regeneration
  layer.frameGenerationPending = true;

  // Update the layer duration
  return layer;
}
