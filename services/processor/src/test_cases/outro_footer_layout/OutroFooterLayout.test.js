import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';

import sharp from 'sharp';

import { getCanvasDimensionsForAspectRatio } from '../../utils/CanvasUtils.js';
import { collectGeneratedOutroTileInputs } from '../../models/api/OutroTileInputCollector.js';
import { resolveEffectiveOutroFocusAreaForImageListToVideo } from '../../models/movie_session/image_list_to_video/OutroFocusAreaResolver.js';
import { createOutroCtaTextItems } from '../../models/movie_session/image_list_to_video/OutroLayerItems.js';
import { renderOutroFooterLayoutFixture } from './OutroFooterLayoutHarness.js';

function clampNumber(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function getGeneratedOutroCenterBoundsForTest(canvasDimensions) {
  const { width, height } = canvasDimensions;
  const referenceSide = Math.min(width, height);
  const padding = Math.max(20, Math.round(referenceSide * (28 / 1024)));
  const availableWidth = Math.max(1, width - padding * 2);
  const availableHeight = Math.max(1, height - padding * 2);
  const maxCenterSize = Math.max(
    220,
    Math.min(
      Math.round(availableWidth * 0.68),
      Math.round(availableHeight * 0.8),
    ),
  );
  const minCenterSize = Math.min(
    maxCenterSize,
    Math.max(320, Math.round(referenceSide * 0.52)),
  );
  const centerSize = clampNumber(
    Math.round(referenceSide * 0.68),
    minCenterSize,
    maxCenterSize,
  );
  const centerY = padding + Math.round((availableHeight - centerSize) / 2);

  return {
    top: centerY,
    bottom: centerY + centerSize,
  };
}

function getTextBlockEdges(item) {
  const lines = String(item.text || '').split('\n').length;
  const lineHeight = Number(item.config.lineHeight) || 1;
  const fontSize = Number(item.config.fontSize) || 0;
  const blockHeight = lines * fontSize * lineHeight;
  return {
    top: item.config.y - blockHeight / 2,
    bottom: item.config.y + blockHeight / 2,
  };
}

test('renders footer QR scene frames, generated outro layer, and final video without generative tasks', async () => {
  const result = await renderOutroFooterLayoutFixture();

  const videoStats = await fs.promises.stat(result.finalVideoPath);
  const outroStats = await fs.promises.stat(result.outroImagePath);
  const manifestStats = await fs.promises.stat(result.manifestPath);

  assert.ok(videoStats.size > 5000, 'final video should be rendered and non-empty');
  assert.ok(outroStats.size > 5000, 'generated outro image should be rendered and non-empty');
  assert.ok(manifestStats.size > 0, 'manifest should be written');

  const generatedFrameFiles = (await fs.promises.readdir(result.framesDir))
    .filter((fileName) => fileName.endsWith('.png'))
    .sort((left, right) => Number.parseInt(left, 10) - Number.parseInt(right, 10));
  assert.equal(generatedFrameFiles.length, result.totalFrameCount);
  assert.equal(generatedFrameFiles[0], '0.png');
  assert.equal(generatedFrameFiles[generatedFrameFiles.length - 1], `${result.totalFrameCount - 1}.png`);

  const firstFrameMetadata = await sharp(path.join(result.framesDir, '0.png')).metadata();
  const outroFrameMetadata = await sharp(result.outroImagePath).metadata();
  assert.equal(firstFrameMetadata.width, result.canvasDimensions.width);
  assert.equal(firstFrameMetadata.height, result.canvasDimensions.height);
  assert.equal(outroFrameMetadata.width, result.canvasDimensions.width);
  assert.equal(outroFrameMetadata.height, result.canvasDimensions.height);
  assert.ok(
    result.footerRenderMetrics.qrPosition.size >= 150,
    'footer QR image should remain large enough for scanning after the minimal footer treatment',
  );
  assert.ok(
    result.footerRenderMetrics.footerLayout.footerHeight <= Math.ceil(result.canvasDimensions.height * 0.22),
    'footer CTA section should stay compact relative to the rendered aspect ratio',
  );
  assert.equal(
    result.footerRenderMetrics.footerLayout.backgroundOpacity,
    0.6,
    'footer CTA section should use the stronger footer background opacity',
  );
  assert.equal(
    result.footerRenderMetrics.footerLayout.footerWidth,
    result.canvasDimensions.width,
    'footer CTA section should span the full display width',
  );
  assert.ok(
    result.mockSession.layers[2].outroImagePath,
    'generated outro should be represented as a separate outro layer',
  );
  assert.ok(
    result.generatedOutro.focusArea.width >= 380,
    'generated outro QR focus area should be large enough for desktop mobile scanning',
  );

  const userSuppliedFocusArea = { x: 0, y: 0, width: 24, height: 24 };
  const effectiveGeneratedOutroFocusArea = resolveEffectiveOutroFocusAreaForImageListToVideo({
    aspectRatio: '16:9',
    addOutroAnimation: true,
    addOutroFocusArea: false,
    outroFocustArea: userSuppliedFocusArea,
    generatedOutroImage: true,
  });
  assert.equal(effectiveGeneratedOutroFocusArea.addOutroFocusArea, false);
  assert.equal(
    effectiveGeneratedOutroFocusArea.outroFocustArea,
    null,
    'server-generated outro animation keeps QR and CTA layers above the fade instead of extracting a focus crop',
  );
  assert.notDeepEqual(effectiveGeneratedOutroFocusArea.outroFocustArea, userSuppliedFocusArea);

  const effectiveUploadedOutroFocusArea = resolveEffectiveOutroFocusAreaForImageListToVideo({
    aspectRatio: '16:9',
    addOutroAnimation: true,
    addOutroFocusArea: true,
    outroFocustArea: userSuppliedFocusArea,
    generatedOutroImage: false,
  });
  assert.deepEqual(effectiveUploadedOutroFocusArea.outroFocustArea, userSuppliedFocusArea);

  const pendingGenerativeStatuses = Object.entries(result.mockSession.expressGenerationStatus)
    .filter(([key, value]) => (
      [
        'prompt_generation',
        'image_generation',
        'audio_generation',
        'ai_video_generation',
        'speech_generation',
        'music_generation',
        'transcript_generation',
      ].includes(key) && value !== 'COMPLETED'
    ));
  assert.deepEqual(pendingGenerativeStatuses, []);

  const sceneLayers = result.mockSession.layers.filter((layer) => layer.name.startsWith('scene-'));
  const outroLayer = result.mockSession.layers.find((layer) => layer.name === 'outro');
  assert.ok(sceneLayers.every((layer) => layer.addFooterAnimation === true));
  assert.equal(outroLayer.addFooterAnimation, false);
  assert.equal(outroLayer.skipAiVideoGeneration, true);

  const outroActiveItems = outroLayer.imageSession.activeItemList;
  assert.equal(outroActiveItems[0].type, 'image');
  assert.equal(outroActiveItems[0].image, 'server_generated_outro_background');

  const tileItems = outroActiveItems.filter((item) => item.isGeneratedOutroTile === true);
  assert.equal(tileItems.length, result.generatedOutro.tileCount);
  assert.ok(
    tileItems.every((item) => item.sourceImageUrl === undefined),
    'generated outro tile layer items should not persist original source URLs or data URLs',
  );

  const fadeItem = outroActiveItems.find((item) => item.type === 'shape');
  assert.ok(fadeItem, 'generated outro should include a fade overlay shape');
  assert.deepEqual(fadeItem.animations[0].params, {
    startFade: 0,
    endFade: 100,
  });

  const qrItem = outroActiveItems.find((item) => item.image === 'server_generated_outro_qr');
  assert.ok(qrItem, 'generated outro should include a QR image layer');
  assert.ok(qrItem.x <= result.generatedOutro.focusArea.x);
  assert.ok(qrItem.y <= result.generatedOutro.focusArea.y);

  const outroTextItems = outroActiveItems.filter((item) => item.type === 'text');
  assert.equal(outroTextItems.length, 2);
  const topTextEdges = getTextBlockEdges(outroTextItems[0]);
  const bottomTextEdges = getTextBlockEdges(outroTextItems[1]);
  const fadeIndex = outroActiveItems.findIndex((item) => item === fadeItem);
  const qrIndex = outroActiveItems.findIndex((item) => item === qrItem);
  const textIndexes = outroTextItems.map((item) => outroActiveItems.findIndex((candidate) => candidate === item));
  assert.ok(
    tileItems.every((item) => outroActiveItems.findIndex((candidate) => candidate === item) < fadeIndex),
    'background tile image layers should render below the fade overlay',
  );
  assert.ok(
    textIndexes.every((index) => index > fadeIndex) && qrIndex > fadeIndex,
    'QR and CTA text layers should render above the fade overlay',
  );
  assert.ok(
    outroTextItems[0].config.y < result.generatedOutro.focusArea.y,
    'top CTA text should sit above the QR focus area',
  );
  assert.ok(
    outroTextItems[1].config.y > result.generatedOutro.focusArea.y + result.generatedOutro.focusArea.height,
    'bottom CTA text should sit below the QR focus area',
  );
  assert.ok(
    outroTextItems[0].config.fontSize > outroTextItems[1].config.fontSize,
    'top CTA text should stay slightly larger than the bottom footer text',
  );
  assert.ok(
    outroTextItems[0].config.fontSize - outroTextItems[1].config.fontSize <= 5,
    'bottom footer text should be close to the top CTA text size',
  );
  assert.ok(
    outroTextItems[0].config.fontSize <= 58,
    'top CTA text should avoid the previous oversized 16:9 layout',
  );
  assert.ok(
    topTextEdges.top >= 56,
    'top CTA text should leave visible margin above the text in 16:9',
  );
  assert.ok(
    result.canvasDimensions.height - bottomTextEdges.bottom >= 56,
    'bottom CTA text should leave visible margin below the text in 16:9',
  );
  assert.ok(
    topTextEdges.bottom < qrItem.y,
    'top CTA text block should clear the QR panel in 16:9',
  );
  assert.ok(
    bottomTextEdges.top > qrItem.y + qrItem.height,
    'bottom CTA text block should clear the QR panel in 16:9',
  );
  const wrappedOutroTextItems = createOutroCtaTextItems({
    canvasDimensions: result.canvasDimensions,
    ctaTextTop: 'Scan this code to reserve your custom travel package before this limited offer closes',
    ctaTextBottom: 'Book today for priority access, local details, and a faster reservation path',
  });
  assert.equal(wrappedOutroTextItems.length, 2);
  assert.ok(
    wrappedOutroTextItems[0].text.includes('\n'),
    'long top CTA text should wrap in the layout fixture',
  );
  assert.ok(
    getTextBlockEdges(wrappedOutroTextItems[0]).bottom < qrItem.y,
    'wrapped top CTA text block should clear the QR panel in 16:9',
  );
  assert.ok(
    getTextBlockEdges(wrappedOutroTextItems[1]).top > qrItem.y + qrItem.height,
    'wrapped bottom CTA text block should clear the QR panel in 16:9',
  );

});

test('generated outro CTA text offsets away from edges and truncates after two lines', () => {
  const longHeader = 'Scan this code to reserve your custom travel package before this limited offer closes with bonus upgrades included';
  const longFooter = 'Book today for priority access, local details, and a faster reservation path with support included before the offer closes';

  const landscapeDimensions = getCanvasDimensionsForAspectRatio('16:9');
  const landscapeItems = createOutroCtaTextItems({
    canvasDimensions: landscapeDimensions,
    ctaTextTop: longHeader,
    ctaTextBottom: longFooter,
  });
  assert.equal(landscapeItems.length, 2);
  assert.equal(landscapeItems[0].text.split('\n').length, 2);
  assert.equal(landscapeItems[1].text.split('\n').length, 2);
  assert.match(landscapeItems[0].text.split('\n')[1], /bonus upgrades\.\.\.$/);
  assert.match(landscapeItems[1].text.split('\n')[1], /support included before/);

  const landscapeTopEdges = getTextBlockEdges(landscapeItems[0]);
  const landscapeBottomEdges = getTextBlockEdges(landscapeItems[1]);
  assert.ok(
    landscapeTopEdges.top >= 47,
    'two-line 16:9 header should move lower while clearing the center panel',
  );
  assert.ok(
    landscapeDimensions.height - landscapeBottomEdges.bottom >= 51,
    'two-line 16:9 footer should move higher while clearing the center panel',
  );

  const portraitDimensions = getCanvasDimensionsForAspectRatio('9:16');
  const portraitItems = createOutroCtaTextItems({
    canvasDimensions: portraitDimensions,
    ctaTextTop: longHeader,
    ctaTextBottom: longFooter,
  });
  assert.equal(portraitItems.length, 2);
  assert.equal(portraitItems[0].text.split('\n').length, 2);
  assert.equal(portraitItems[1].text.split('\n').length, 2);

  const portraitTopEdges = getTextBlockEdges(portraitItems[0]);
  const portraitBottomEdges = getTextBlockEdges(portraitItems[1]);
  const portraitCenterBounds = getGeneratedOutroCenterBoundsForTest(portraitDimensions);
  const portraitFooterGap = portraitBottomEdges.top - portraitCenterBounds.bottom;
  assert.ok(
    portraitTopEdges.top >= 190,
    'two-line 9:16 header should sit proportionally lower than the landscape header',
  );
  assert.ok(
    portraitFooterGap >= 36,
    'two-line 9:16 footer should leave visible margin below the center image',
  );
  assert.ok(
    portraitFooterGap <= 70,
    'two-line 9:16 footer should stay close to the center image instead of the bottom edge',
  );
});

test('generated outro footer URL splits across two lines before truncating', () => {
  const portraitDimensions = getCanvasDimensionsForAspectRatio('9:16');
  const [, footerItem] = createOutroCtaTextItems({
    canvasDimensions: portraitDimensions,
    ctaTextTop: 'Checkout the Github',
    ctaTextBottom: 'https://github.com/samsarone/samsar/tree/main/services/processor/src/models/movie_session/image_list_to_video',
  });

  const footerLines = footerItem.text.split('\n');
  assert.equal(footerLines.length, 2);
  assert.ok(!footerLines[0].endsWith('...'), 'first footer line should continue onto the second line');
  assert.ok(footerLines[1].endsWith('...'), 'second footer line should carry final truncation');
});

test('update generated outro tiles use text-to-video image session stills', async () => {
  const firstImage = 'data:image/png;base64,ZmFrZS1pbWFnZS0x';
  const secondImage = 'data:image/png;base64,ZmFrZS1pbWFnZS0y';
  const duplicateImage = firstImage;

  const tileInputs = await collectGeneratedOutroTileInputs({
    assetsRoot: '/tmp/missing-assets-root',
    outroLayerIndex: 3,
    sessionData: {
      layers: [
        {
          imageSession: {
            activeItemList: [],
            previousActiveItemList: [],
            activeSelectedImage: firstImage,
          },
        },
        {
          imageSession: {
            activeItemList: [],
            previousActiveItemList: [],
            activeGeneratedImage: secondImage,
          },
        },
        {
          imageSession: {
            activeItemList: [],
            previousActiveItemList: [],
            activeSelectedImage: duplicateImage,
          },
        },
        {
          imageSession: {
            activeItemList: [],
            activeSelectedImage: 'data:image/png;base64,b3V0cm8=',
          },
        },
      ],
    },
  });

  assert.deepEqual(tileInputs.imageUrls, [firstImage, secondImage]);
  assert.deepEqual(
    tileInputs.imageListPayload.map((item) => item.image_url),
    [firstImage, secondImage],
  );
});

test('update generated outro tiles preserve Docker-local asset references', async () => {
  const assetsRoot = await fs.promises.mkdtemp('/tmp/samsar-outro-tiles-');
  const generatedImagePath = path.join(assetsRoot, 'generations', 'scene-1.png');
  await fs.promises.mkdir(path.dirname(generatedImagePath), { recursive: true });
  await fs.promises.writeFile(generatedImagePath, Buffer.from('image-bytes'));

  const tileInputs = await collectGeneratedOutroTileInputs({
    assetsRoot,
    outroLayerIndex: -1,
    sessionData: {
      layers: [
        {
          imageSession: {
            activeItemList: [],
            activeGeneratedImage: 'assets_v2/generations/scene-1.png',
          },
        },
      ],
    },
  });

  assert.deepEqual(tileInputs.imageUrls, ['assets_v2/generations/scene-1.png']);
  assert.ok(
    !tileInputs.imageUrls[0].startsWith('data:image'),
    'Docker-local tile sources should stay as internal asset references',
  );
});
