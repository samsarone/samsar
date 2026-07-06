function getStageFromRef(stageRef) {
  const current = stageRef?.current;
  if (!current) {
    return null;
  }

  if (typeof current.getStage === 'function') {
    return current.getStage();
  }

  return current;
}

function hideStageNodes(stage, selectors = []) {
  const visibilityEntries = [];

  selectors.forEach((selector) => {
    stage.find(selector).forEach((node) => {
      visibilityEntries.push([node, node.visible()]);
      node.visible(false);
    });
  });

  stage.find((node) => {
    const nodeId = typeof node?.id === 'function' ? node.id() : '';
    return typeof nodeId === 'string' && nodeId.startsWith('bbox_rect_');
  }).forEach((node) => {
    visibilityEntries.push([node, node.visible()]);
    node.visible(false);
  });

  return () => {
    visibilityEntries.forEach(([node, isVisible]) => {
      node.visible(isVisible);
    });
    stage.draw();
  };
}

function scaleCanvasToDataUrl(sourceCanvas, maxDimension = 1536) {
  if (!sourceCanvas) {
    return null;
  }

  const sourceWidth = Number(sourceCanvas.width) || 0;
  const sourceHeight = Number(sourceCanvas.height) || 0;
  const longestSide = Math.max(sourceWidth, sourceHeight);

  if (!longestSide || longestSide <= maxDimension) {
    return sourceCanvas.toDataURL('image/png');
  }

  const scale = maxDimension / longestSide;
  const scaledCanvas = document.createElement('canvas');
  scaledCanvas.width = Math.max(1, Math.round(sourceWidth * scale));
  scaledCanvas.height = Math.max(1, Math.round(sourceHeight * scale));

  const ctx = scaledCanvas.getContext('2d');
  ctx.drawImage(sourceCanvas, 0, 0, scaledCanvas.width, scaledCanvas.height);

  return scaledCanvas.toDataURL('image/png');
}

export async function captureStageCanvas(stageRef, options = {}) {
  const {
    hideSelectors = ['Transformer', '#maskGroup', '#pencilGroup'],
    pixelRatio = 1,
  } = options;

  const stage = getStageFromRef(stageRef);
  if (!stage) {
    return null;
  }

  const restoreStageVisibility = hideStageNodes(stage, hideSelectors);

  try {
    return await stage.toCanvas({ pixelRatio });
  } finally {
    restoreStageVisibility();
  }
}

export async function captureAssistantStageImageData(stageRef, options = {}) {
  const {
    maxDimension = 1536,
    hideSelectors = ['Transformer', '#maskGroup', '#pencilGroup'],
  } = options;

  const sourceCanvas = await captureStageCanvas(stageRef, {
    hideSelectors,
    pixelRatio: 1,
  });

  return scaleCanvasToDataUrl(sourceCanvas, maxDimension);
}
