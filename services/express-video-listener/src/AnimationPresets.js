import { getDBConnectionString } from "./DBString.js";
import VideoSession from "./schema/VideoSession.js";
import User from "./schema/User.js";
import { getPresetAnimationListForDistribution } from "./utils/AnimationUtils.js";
import { getCanvasDimensionsForAspectRatio } from "./utils/CanvasUtils.js";
import { normalizeFramesPerSecond, resolveFramesPerSecond } from "./utils/FpsUtils.js";


export async function applyDefaultAnimationPresets(sessionId) {



  let sessionData = await VideoSession.findById(sessionId);

  sessionData = sessionData.toObject();

  let sessionLayers = sessionData.layers;

  const aspectRatio = sessionData.aspectRatio;
  const sessionFps = normalizeFramesPerSecond(sessionData?.framesPerSecond);
  let framesPerSecond = sessionFps;
  if (!framesPerSecond) {
    const userData = await User.findById(sessionData.userId).select('videoFramesPerSecond').lean();
    framesPerSecond = resolveFramesPerSecond(sessionData, userData);
  }




  for (let [layerIdx, layer] of sessionLayers.entries()) {
    let layerImageSession = layer.imageSession;
    const layerFrameDuration = layer.duration * framesPerSecond;


    let activeItemList = layerImageSession.activeItemList;
    let textItems = activeItemList.filter(item => item.type === "text");



    let imageItem = activeItemList.find(item => item.type === "image");
    const numTextItems = textItems.length;

    const animationBoundaries = [];
    textItems.forEach((textItem, idx) => {
      let endFrame = textItem.config.frameOffset + textItem.config.frameDuration;
      let startFrame = textItem.config.frameOffset;
      if (idx === 0) {
        startFrame = 0;
      }
      if (idx === numTextItems - 1) {
        endFrame = layer.duration * framesPerSecond;
      }
      animationBoundaries.push({ startFrame, endFrame });
    });



    const numLayers = sessionLayers.length;

    const canvasDimensions = getCanvasDimensionsForAspectRatio(aspectRatio);

    if (animationBoundaries && animationBoundaries.length > 0) {
      const animationList = getPresetAnimationListForDistribution(
        animationBoundaries,
        layerIdx,
        canvasDimensions,
        layerFrameDuration,
        framesPerSecond
      );
      imageItem.animations = animationList;
    }

    layer.imageSession.activeItemList = activeItemList;

  }

  await VideoSession.updateOne({ _id: sessionId }, { layers: sessionLayers });



}
