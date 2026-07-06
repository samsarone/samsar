export function applyHologramEffect(ctx, params, t) {
  const { intensity, flickerFrequency, colorShift } = params;

  // Apply flickering effect
  const flicker = Math.sin(t * flickerFrequency * Math.PI * 2) * 0.5 + 0.5; // Value between 0 and 1

  // Adjust global alpha for flickering
  ctx.globalAlpha *= flicker * intensity;

  // Apply color shift
  const imageData = ctx.getImageData(0, 0, ctx.canvas.width, ctx.canvas.height);
  const data = imageData.data;

  for (let i = 0; i < data.length; i += 4) {
    // Shift color channels
    data[i] = data[i] * (1 + colorShift);     // Red
    data[i + 1] = data[i + 1];                // Green
    data[i + 2] = data[i + 2] * (1 - colorShift); // Blue
  }

  ctx.putImageData(imageData, 0, 0);
}
