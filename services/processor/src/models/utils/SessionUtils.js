   
   export async function addLastFrameForMissingDuration(payload) {
   // Use the absolute value of durationDiff to ensure zoomPercentage is positive
    const durationDiffInSeconds = Math.abs(durationDiff);

    // Calculate the zoom percentage based on durationDiff (2% per second, up to 20%)
    const zoomPercentage = Math.min(durationDiffInSeconds * 2, 20); // Max 20%
    const finalEndScale = 100 + zoomPercentage; // in percentage

    // Calculate the amount to shift x and y to keep the image centered during zoom
    const deltaX = ((finalEndScale / 100) * canvasWidth - canvasWidth) / 2;
    const deltaY = ((finalEndScale / 100) * canvasHeight - canvasHeight) / 2;

    // Set the end positions to keep the image centered
    const finalEndX = -deltaX;
    const finalEndY = -deltaY;

    const configAnimations = [
      {
        type: 'zoom',
        params: {
          startScale: 100,
          endScale: finalEndScale,
        },
        frameDuration: imageConfig.frameDuration,
        frameOffset: imageConfig.frameOffset
      },
      {
        type: 'slide',
        params: {
          startX: 0,
          startY: 0,
          endX: finalEndX,
          endY: finalEndY,
        },
        frameDuration: imageConfig.frameDuration,
        frameOffset: imageConfig.frameOffset
      }
    ];

    const newImageConfigItem = {
      type: 'image',
      src: lastFrameGenerationPath,
      x: 0,
      y: 0,
      width: canvasWidth,
      height: canvasHeight,
      id: 'item_0',
      config: imageConfig,
      animations: configAnimations
    };

  }


  export function getResourcesFromSession(layerList) {

    let itemList = [];

    for (let i = 0; i < layerList.length; i++) {
      const layer = layerList[i];
      const activeItemList = layer.imageSession.activeItemList ;
      itemList.push(activeItemList);
    }
    return itemList;

  }