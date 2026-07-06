// utils/SnowfallUtils.js
export function applySnowfallEffect(ctx, params, t) {
  const {
    intensity = 1.0, // Controls the amount of snow
    snowflakeCount = 100,
    maxSnowflakeSize = 3
  } = params;

  const width = ctx.canvas.width;
  const height = ctx.canvas.height;

  ctx.save();
  ctx.fillStyle = 'white';
  ctx.globalAlpha = 0.5 * intensity;

  for (let i = 0; i < snowflakeCount * intensity; i++) {
    const x = Math.random() * width;
    const y = (Math.random() * height + t * height) % height;
    const size = Math.random() * maxSnowflakeSize;
    ctx.beginPath();
    ctx.arc(x, y, size, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}
