// Usage: node scripts/render_outro_layout_samples.js OUTPUT_DIR CTA_IMAGE FRAMES_PROCESSOR_DIR
// Uses the production composition builder and video-frame text renderer; no model calls.
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createCanvas, loadImage } from 'canvas';
import { generateOutroCompositionAssetsFromImageList } from '../src/models/api/OutroImageGenerationAPI.js';
import { createOutroCtaTextItems } from '../src/models/movie_session/image_list_to_video/OutroLayerItems.js';

const [outputArg, imageArg, rendererArg] = process.argv.slice(2);
if (!outputArg || !imageArg || !rendererArg) {
  throw new Error('Expected OUTPUT_DIR CTA_IMAGE FRAMES_PROCESSOR_DIR');
}
const outputDir = path.resolve(outputArg);
const { applyTextAnimations } = await import(pathToFileURL(path.resolve(rendererArg, 'src/animations/TextAnimations.js')));
const imageBytes = await fs.readFile(path.resolve(imageArg));
const imageSource = `data:image/png;base64,${imageBytes.toString('base64')}`;
await fs.mkdir(outputDir, { recursive: true });
const assetsRoot = path.join(outputDir, 'assets');
const manifest = [];

for (const aspectRatio of ['16:9', '9:16']) {
  for (const mode of ['image', 'qr']) {
    const name = `outro-${mode}-${aspectRatio.replace(':', 'x')}`;
    const composition = await generateOutroCompositionAssetsFromImageList({
      aspectRatio, assetsRoot, sessionId: name,
      ...(mode === 'image' ? { outroCtaImage: imageSource } : { ctaUrl: 'https://samsar.one' }),
    });
    const canvasDimensions = { width: composition.width, height: composition.height };
    const textItems = createOutroCtaTextItems({
      canvasDimensions,
      centerContentBounds: composition.center.contentBounds,
      ctaTextTop: mode === 'image' ? 'Create something extraordinary' : 'Scan to create your next video',
      ctaTextBottom: 'Turn your ideas into videos. Explore samsar.one',
    });
    const canvas = createCanvas(composition.width, composition.height);
    const ctx = canvas.getContext('2d');
    // Initial outro frame, before the background fades to black.
    for (const asset of [composition.background, ...composition.tiles, composition.center]) {
      const image = await loadImage(await fs.readFile(path.join(assetsRoot, asset.src)));
      ctx.drawImage(image, asset.x, asset.y, asset.width, asset.height);
    }
    for (const item of textItems) {
      ctx.save();
      applyTextAnimations(ctx, item, 0, 30);
      ctx.restore();
    }
    const file = path.join(outputDir, `${name}.png`);
    await fs.writeFile(file, canvas.toBuffer('image/png'));
    manifest.push({ file, aspectRatio, ...canvasDimensions, centerContentBounds: composition.center.contentBounds, textItems });
  }
}
await fs.writeFile(path.join(outputDir, 'layout-manifest.json'), JSON.stringify(manifest, null, 2));
console.log(JSON.stringify(manifest.map(({ file, width, height }) => ({ file, width, height })), null, 2));
