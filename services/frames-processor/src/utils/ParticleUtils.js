export function applyParticleEffect(ctx, params, t) {
  const { particleCount, color, size, speed } = params;

  const width = ctx.canvas.width;
  const height = ctx.canvas.height;

  // Randomly generate particles
  for (let i = 0; i < particleCount; i++) {
    const x = Math.random() * width;
    const y = (Math.random() * height + speed * t * 1000) % height;

    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, size, 0, Math.PI * 2);
    ctx.fill();
  }
}
