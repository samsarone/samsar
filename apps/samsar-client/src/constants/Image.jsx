import { getCanvasDimensionsForAspectRatio } from '../utils/canvas.jsx';

export const STAGE_DIMENSIONS = {
  width: 1024,
  height: 1024,
}

export function getStageDimensions(aspectRatio) {
  return getCanvasDimensionsForAspectRatio(aspectRatio);
}
