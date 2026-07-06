export function applyLensFlareEffect(ctx, params, t) {
  const {
    intensity = 0.5, // Reduced default intensity
    color,
    position
  } = params;
  const [x, y] = position;

  const gradient = ctx.createRadialGradient(x, y, 0, x, y, 200);
  gradient.addColorStop(0, color);
  gradient.addColorStop(1, 'transparent');

  ctx.globalAlpha = intensity;
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(x, y, 200, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1.0; // Reset alpha
}
