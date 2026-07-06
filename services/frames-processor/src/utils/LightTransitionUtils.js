// utils/LightTransitionUtils.js
export function applyLightTransitionEffect(ctx, params, t) {
  const {
    color = 'rgba(255, 255, 255, 0.5)', // Light color
    intensity = 1.0 // Controls the brightness
  } = params;

  const width = ctx.canvas.width;
  const height = ctx.canvas.height;

  ctx.save();
  // Halve the intensity by multiplying by 0.5
  ctx.globalAlpha = 0.5 * intensity * Math.sin(Math.PI * t); // Creates a fade-in and fade-out effect

  // Create a radial gradient for the light effect
  const gradient = ctx.createRadialGradient(
    width / 2, height / 2, 0,
    width / 2, height / 2, Math.max(width, height) / 1.5
  );

  gradient.addColorStop(0, color);
  gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');

  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);
  ctx.restore();
}
