export function getCanvasDimensionsForAspectRatio(aspectRatio) {
  if (aspectRatio === '16:9') {
    return {
      width: 1792,
      height: 1024
    };
  } else if (aspectRatio === '9:16') {
    return {
      width: 1024,
      height: 1792
    };
  } else {
    return {
      width: 1024,
      height: 1024
    };
  }
}
