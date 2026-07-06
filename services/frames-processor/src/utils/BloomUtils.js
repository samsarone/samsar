export function applyBloomEffect(ctx, params, t) {
  // Destructure the parameters
  let { intensity, threshold, radius } = params;

  // Halve the intensity
  intensity = intensity / 2;

  // Simplified bloom effect: Increase brightness of pixels above threshold
  const imageData = ctx.getImageData(0, 0, ctx.canvas.width, ctx.canvas.height);
  const data = imageData.data;

  for (let i = 0; i < data.length; i += 4) {
    // Calculate the average brightness of the pixel
    const brightness = (data[i] + data[i + 1] + data[i + 2]) / 3;

    if (brightness > threshold) {
      // Apply the halved intensity and further reduce the result by half
      data[i] = Math.min(255, (data[i] * intensity) / 2);       // Red channel
      data[i + 1] = Math.min(255, (data[i + 1] * intensity) / 2); // Green channel
      data[i + 2] = Math.min(255, (data[i + 2] * intensity) / 2); // Blue channel
      // Alpha channel (data[i + 3]) remains unchanged
    }
  }

  ctx.putImageData(imageData, 0, 0);
}
