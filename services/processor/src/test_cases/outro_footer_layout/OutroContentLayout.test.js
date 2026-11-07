import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createCanvas } from 'canvas';
import sharp from 'sharp';
import { generateOutroCompositionAssetsFromImageList } from '../../models/api/OutroImageGenerationAPI.js';
import { createOutroCtaTextItems } from '../../models/movie_session/image_list_to_video/OutroLayerItems.js';
import { getCanvasDimensionsForAspectRatio } from '../../utils/CanvasUtils.js';

const edges = (item) => ({ top: item.config.y - item.config.height / 2, bottom: item.config.y + item.config.height / 2 });

for (const aspectRatio of ['16:9', '9:16', '1:1']) {
  test(`${aspectRatio}: visible image and captions stay centered, separated and inside safe margins`, async (t) => {
    const assetsRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'outro-layout-'));
    t.after(() => fs.rm(assetsRoot, { recursive: true, force: true }));
    const canvasDimensions = getCanvasDimensionsForAspectRatio(aspectRatio);
    // Deliberately asymmetric transparent padding around an opaque wide image.
    const source = await sharp({ create: { width: 400, height: 300, channels: 4, background: '#00000000' } })
      .composite([{ input: await sharp({ create: { width: 200, height: 100, channels: 4, background: '#000000' } }).png().toBuffer(), left: 170, top: 20 }])
      .png().toBuffer();
    const result = await generateOutroCompositionAssetsFromImageList({
      aspectRatio, assetsRoot, sessionId: 'sample',
      outroCtaImage: `data:image/png;base64,${source.toString('base64')}`,
    });
    const bounds = result.center.contentBounds;
    assert.ok(Math.abs(bounds.width / bounds.height - 2) < 0.01, 'only transparent padding should be removed');
    assert.ok(Math.abs(bounds.x + bounds.width / 2 - canvasDimensions.width / 2) <= 1);
    assert.ok(Math.abs(bounds.y + bounds.height / 2 - canvasDimensions.height / 2) <= 1);
    const centerPixels = await sharp(path.join(assetsRoot, result.center.src)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const midPixel = (Math.floor(centerPixels.info.height / 2) * centerPixels.info.width + Math.floor(centerPixels.info.width / 2)) * 4;
    assert.equal(centerPixels.data[midPixel + 3], 255, 'opaque black image content must survive trimming');

    for (const copy of [
      ['Create something extraordinary', 'Start your story at samsar.one'],
      ['Discover everything you need to create your next video with SamsarOne', 'https://samsar.one/this/is/a/very/long/path/that/needs/to/wrap/without/overflowing/the/canvas'],
    ]) {
      const items = createOutroCtaTextItems({ canvasDimensions, centerContentBounds: bounds, ctaTextTop: copy[0], ctaTextBottom: copy[1] });
      const [header, footer] = items.map(edges);
      assert.ok(header.top >= 32 && footer.bottom <= canvasDimensions.height - 32);
      assert.ok(header.bottom <= bounds.y - 30);
      assert.ok(footer.top >= bounds.y + bounds.height + 30);
      for (const item of items) {
        assert.equal(item.config.x, canvasDimensions.width / 2);
        assert.equal(item.config.autoWrap, false);
        assert.equal(item.config.preserveLineBreaks, true);
        assert.ok(item.text.split('\n').length <= 2);
      }
      if (aspectRatio === '9:16') {
        const upperGap = bounds.y - header.bottom;
        const lowerGap = footer.top - bounds.y - bounds.height;
        assert.ok(Math.abs(upperGap - lowerGap) <= 1, 'portrait group uses balanced gaps around visible image');
      }
    }
  });
}

test('QR portrait footer moves lower while keeping enough room for two lines', () => {
  for (const text of ['Visit samsar.one', 'Visit SamsarOne to start creating your next extraordinary video today']) {
    const [footer] = createOutroCtaTextItems({ canvasDimensions: { width: 1024, height: 1792 }, ctaTextBottom: text });
    const box = edges(footer);
    assert.ok(box.top >= 1308 && box.top <= 1328, 'footer should move 30–50 px below the previous y=1278');
    assert.ok(box.bottom <= 1717);
  }
});

test('wide characters, URLs, graphemes and ellipses fit within the measured text box', () => {
  const ctx = createCanvas(1, 1).getContext('2d');
  for (const text of [
    'WWWW WWWW WWWW WWWW WWWW WWWW',
    'https://github.com/samsarone/samsar/tree/main/services/processor/src/models/movie_session/image_list_to_video',
    'สร้างเรื่องราวที่น่าประทับใจด้วยวิดีโอของคุณ '.repeat(4),
    '創造属于你的精彩故事。'.repeat(12),
    '👨‍👩‍👧‍👦 '.repeat(40),
  ]) {
    const [item] = createOutroCtaTextItems({ canvasDimensions: { width: 1024, height: 1792 }, ctaTextBottom: text });
    ctx.font = `bold ${item.config.fontSize}px ${item.config.fontFamily}`;
    const lines = item.text.split('\n');
    assert.ok(lines.length <= 2);
    for (const line of lines) assert.ok(ctx.measureText(line).width <= item.config.width, line);
    assert.ok(!lines[0].endsWith('...'), 'long tokens should continue onto the second line');
  }
});
