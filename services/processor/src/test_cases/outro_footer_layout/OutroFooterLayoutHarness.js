import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

import ffmpegPath from 'ffmpeg-static';
import QRCode from 'qrcode';
import sharp from 'sharp';

import {
  generateOutroCompositionAssetsFromImageList,
  generateOutroImageFromImageList,
} from '../../models/api/OutroImageGenerationAPI.js';
import {
  createOutroCtaTextItems,
  createOutroFadeOverlayItem,
} from '../../models/movie_session/image_list_to_video/OutroLayerItems.js';
import { getCanvasDimensionsForAspectRatio } from '../../utils/CanvasUtils.js';

const DEFAULT_OUTPUT_ROOT = path.join(
  process.cwd(),
  'assets',
  'unit_tests',
  'outro_footer_layout',
);

function escapeXml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function svgBuffer(svg) {
  return Buffer.from(svg);
}

function clampNumber(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

async function createDataUrlSvgPng(svg) {
  const buffer = await sharp(svgBuffer(svg)).png().toBuffer();
  return `data:image/png;base64,${buffer.toString('base64')}`;
}

async function createFixtureTileDataUrls() {
  return Promise.all([
    createDataUrlSvgPng(`
      <svg width="1200" height="800" viewBox="0 0 1200 800" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="bg1" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stop-color="#0f766e"/>
            <stop offset="1" stop-color="#38bdf8"/>
          </linearGradient>
        </defs>
        <rect width="1200" height="800" fill="url(#bg1)"/>
        <circle cx="880" cy="220" r="170" fill="#fef3c7" opacity="0.82"/>
        <path d="M0 610 C170 560 300 690 460 640 C650 580 760 650 920 610 C1040 580 1120 600 1200 570 L1200 800 L0 800 Z" fill="#0f172a" opacity="0.28"/>
      </svg>
    `),
    createDataUrlSvgPng(`
      <svg width="1200" height="800" viewBox="0 0 1200 800" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="bg2" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stop-color="#7c2d12"/>
            <stop offset="1" stop-color="#f97316"/>
          </linearGradient>
        </defs>
        <rect width="1200" height="800" fill="url(#bg2)"/>
        <rect x="120" y="150" width="960" height="420" rx="44" fill="#111827" opacity="0.34"/>
        <circle cx="900" cy="250" r="150" fill="#fed7aa" opacity="0.35"/>
        <path d="M0 580 C160 520 280 650 440 610 C620 560 760 630 940 600 C1080 575 1140 590 1200 560 L1200 800 L0 800 Z" fill="#431407" opacity="0.26"/>
      </svg>
    `),
  ]);
}

async function createFixtureLogoDataUrl() {
  return createDataUrlSvgPng(`
    <svg width="640" height="180" viewBox="0 0 640 180" xmlns="http://www.w3.org/2000/svg">
      <rect width="640" height="180" rx="42" fill="#020617"/>
      <circle cx="94" cy="90" r="42" fill="#22c55e"/>
      <text x="162" y="112" font-family="Arial, sans-serif" font-size="62" font-weight="800" fill="#f8fafc">Samsar Test</text>
    </svg>
  `);
}

function createFooterBaseSvg({ canvasDimensions, title, sceneLabel }) {
  const { width: canvasWidth, height: canvasHeight } = canvasDimensions;
  const referenceSide = Math.min(canvasWidth, canvasHeight);
  const footerHeight = Math.round(clampNumber(
    canvasHeight * 0.2,
    referenceSide * 0.16,
    referenceSide * 0.28,
  ));
  const footerWidth = canvasWidth;
const footerBackgroundOpacity = 0.6;
  const verticalPadding = Math.round(clampNumber(footerHeight * 0.055, 10, 18));
  const horizontalPadding = Math.round(clampNumber(referenceSide * 0.032, 28, 48));
  const qrSize = Math.round(Math.min(
    footerHeight - verticalPadding * 2,
    clampNumber(referenceSide * 0.24, 170, 240),
    footerWidth * 0.18,
  ));
  const footerY = canvasHeight - footerHeight;
  const qrX = footerWidth - horizontalPadding - qrSize;
  const qrY = footerY + (footerHeight - qrSize) / 2;
  const textX = horizontalPadding;
  const fontSize = Math.round(clampNumber(referenceSide * 0.04, 30, 48));
  const titleY = footerY + footerHeight / 2 + Math.round(fontSize * 0.34);

  return {
    qrPosition: {
      left: Math.round(qrX),
      top: Math.round(qrY),
      size: Math.round(qrSize),
    },
    footerLayout: {
      footerHeight,
      footerWidth,
      qrSize,
      qrInset: 0,
      backgroundOpacity: footerBackgroundOpacity,
    },
    svg: svgBuffer(`
      <svg width="${canvasWidth}" height="${canvasHeight}" viewBox="0 0 ${canvasWidth} ${canvasHeight}" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="sceneBg" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stop-color="#172554"/>
            <stop offset="1" stop-color="#0f172a"/>
          </linearGradient>
          <filter id="textShadow" x="-10%" y="-40%" width="120%" height="180%">
            <feDropShadow dx="0" dy="${Math.max(1, Math.round(referenceSide * 0.0025))}" stdDeviation="${Math.round(referenceSide * 0.006)}" flood-color="#000000" flood-opacity="0.58"/>
          </filter>
        </defs>
        <rect width="${canvasWidth}" height="${canvasHeight}" fill="url(#sceneBg)"/>
        <rect x="${Math.round(canvasWidth * 0.06)}" y="${Math.round(canvasHeight * 0.12)}" width="${Math.round(canvasWidth * 0.44)}" height="${Math.round(canvasHeight * 0.32)}" rx="42" fill="#ffffff" opacity="0.08"/>
        <text x="${Math.round(canvasWidth * 0.07)}" y="${Math.round(canvasHeight * 0.32)}" font-family="Arial, sans-serif" font-size="${Math.round(canvasHeight * 0.07)}" font-weight="800" fill="#f8fafc">${escapeXml(sceneLabel)}</text>
        <rect x="0" y="${footerY}" width="${footerWidth}" height="${footerHeight}" fill="#05080f" opacity="${footerBackgroundOpacity}"/>
        <text x="${textX}" y="${titleY}" font-family="Arial, sans-serif" font-size="${fontSize}" font-weight="800" fill="rgba(248, 250, 252, 0.94)" filter="url(#textShadow)">${escapeXml(title)}</text>
      </svg>
    `),
  };
}

async function renderFooterFrame({
  outputPath,
  canvasDimensions,
  footerMetadata,
  sceneLabel,
}) {
  const qrBuffer = await QRCode.toBuffer(footerMetadata.url, {
    type: 'png',
    errorCorrectionLevel: 'M',
    margin: 1,
    width: 1024,
    color: {
      dark: '#111827',
      light: '#ffffff',
    },
  });
  const { svg, qrPosition, footerLayout } = createFooterBaseSvg({
    canvasDimensions,
    title: footerMetadata.title,
    sceneLabel,
  });
  const resizedQrBuffer = await sharp(qrBuffer)
    .resize(qrPosition.size, qrPosition.size, { fit: 'contain' })
    .png()
    .toBuffer();

  await sharp(svg)
    .composite([
      {
        input: resizedQrBuffer,
        left: qrPosition.left,
        top: qrPosition.top,
      },
    ])
    .png()
    .toFile(outputPath);

  return {
    footerLayout,
    qrPosition,
  };
}

async function renderFramesToVideo({ framesDir, outputPath, frameRate, durationSeconds }) {
  if (!ffmpegPath) {
    throw new Error('ffmpeg-static did not resolve an ffmpeg binary.');
  }

  await fs.promises.mkdir(path.dirname(outputPath), { recursive: true });

  const args = [
    '-y',
    '-framerate', String(frameRate),
    '-start_number', '0',
    '-i', path.join(framesDir, '%d.png'),
    '-t', String(durationSeconds),
    '-c:v', 'libx264',
    '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart',
    outputPath,
  ];

  await new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
      if (stderr.length > 12000) {
        stderr = stderr.slice(-12000);
      }
    });

    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`ffmpeg exited with code ${code}: ${stderr}`));
    });
  });
}

function buildMockExpressStatus() {
  return {
    prompt_generation: 'COMPLETED',
    image_generation: 'COMPLETED',
    audio_generation: 'COMPLETED',
    frame_generation: 'COMPLETED',
    video_generation: 'COMPLETED',
    ai_video_generation: 'COMPLETED',
    speech_generation: 'COMPLETED',
    music_generation: 'COMPLETED',
    delete_reflow: 'COMPLETED',
    transcript_generation: 'COMPLETED',
  };
}

export async function renderOutroFooterLayoutFixture({
  outputRoot = DEFAULT_OUTPUT_ROOT,
} = {}) {
  const runRoot = path.join(outputRoot, 'latest');
  const framesDir = path.join(runRoot, 'frames');
  const outroDir = path.join(runRoot, 'outro');
  const videoDir = path.join(runRoot, 'video');

  await fs.promises.rm(runRoot, { recursive: true, force: true });
  await Promise.all([
    fs.promises.mkdir(framesDir, { recursive: true }),
    fs.promises.mkdir(outroDir, { recursive: true }),
    fs.promises.mkdir(videoDir, { recursive: true }),
  ]);

  const aspectRatio = '16:9';
  const canvasDimensions = getCanvasDimensionsForAspectRatio(aspectRatio);
  const frameRate = 4;
  const sceneDurationSeconds = 1;
  const outroDurationSeconds = 1;
  const framesPerScene = frameRate * sceneDurationSeconds;
  const outroFrameCount = frameRate * outroDurationSeconds;
  const footerMetadata = [
    {
      url: 'https://example.test/fake-lagoon-offer',
      title: 'Fictional Lagoon Escape',
    },
    {
      url: 'https://example.test/fake-sunset-offer',
      title: 'Fictional Sunset Dinner',
    },
  ];
  const [tileA, tileB] = await createFixtureTileDataUrls();
  const ctaLogo = await createFixtureLogoDataUrl();
  const ctaUrl = 'https://example.test/fake-booking-cta';
  const ctaTextTop = 'Scan to reserve this fictional offer';
  const ctaTextBottom = 'Layout test only - no network request';
  const fixtureSessionId = 'layout_fixture';

  const generatedOutro = await generateOutroImageFromImageList({
    imageListPayload: [
      { image_url: tileA, title: 'Fictional Lagoon Escape' },
      { image_url: tileB, title: 'Fictional Sunset Dinner' },
    ],
    imageUrls: [tileA, tileB],
    aspectRatio,
    ctaUrl,
    ctaTextTop,
    ctaTextBottom,
    ctaLogo,
  });
  const generatedOutroComposition = await generateOutroCompositionAssetsFromImageList({
    imageListPayload: [
      { image_url: tileA, title: 'Fictional Lagoon Escape' },
      { image_url: tileB, title: 'Fictional Sunset Dinner' },
    ],
    imageUrls: [tileA, tileB],
    aspectRatio,
    ctaUrl,
    assetsRoot: runRoot,
    sessionId: fixtureSessionId,
  });

  const outroImagePath = path.join(outroDir, 'generated_outro.png');
  await fs.promises.writeFile(outroImagePath, generatedOutro.buffer);
  const outroActiveItemList = [
    {
      id: 'item_0',
      type: 'image',
      image: 'server_generated_outro_background',
      x: generatedOutroComposition.background.x,
      y: generatedOutroComposition.background.y,
      width: generatedOutroComposition.background.width,
      height: generatedOutroComposition.background.height,
      src: generatedOutroComposition.background.src,
      is_base_image: true,
      animations: [],
    },
    ...generatedOutroComposition.tiles.map((tile, index) => ({
      id: `item_${index + 1}`,
      type: 'image',
      image: tile.sourceImageUrl,
      x: tile.x,
      y: tile.y,
      width: tile.width,
      height: tile.height,
      src: tile.src,
      is_base_image: false,
      animations: [],
    })),
    createOutroFadeOverlayItem({
      id: `item_${1 + generatedOutroComposition.tiles.length}`,
      canvasDimensions,
    }),
    ...createOutroCtaTextItems({
      canvasDimensions,
      ctaTextTop,
      ctaTextBottom,
      startIndex: 2 + generatedOutroComposition.tiles.length,
    }),
  ];
  outroActiveItemList.push({
    id: `item_${outroActiveItemList.length}`,
    type: 'image',
    image: 'server_generated_outro_qr',
    x: generatedOutroComposition.qr.x,
    y: generatedOutroComposition.qr.y,
    width: generatedOutroComposition.qr.width,
    height: generatedOutroComposition.qr.height,
    src: generatedOutroComposition.qr.src,
    is_base_image: false,
    animations: [],
  });

  const mockSession = {
    expressGenerationType: 'IMAGE_LIST_TO_VIDEO',
    expressGenerationPending: false,
    videoGenerationPending: false,
    frameGenerationPending: false,
    expressGenerationStatus: buildMockExpressStatus(),
    aspectRatio,
    framesPerSecond: frameRate,
    hasOutroImage: true,
    outroImageURL: generatedOutroComposition.background.src,
    addFooterAnimation: true,
    footerMetadata,
    layers: [
      {
        name: 'scene-1',
        duration: sceneDurationSeconds,
        frameGenerationPending: false,
        aiVideoGenerationPending: false,
        lipSyncGenerationPending: false,
        soundEffectGenerationPending: false,
        addFooterAnimation: true,
        footerMetadata: footerMetadata[0],
      },
      {
        name: 'scene-2',
        duration: sceneDurationSeconds,
        frameGenerationPending: false,
        aiVideoGenerationPending: false,
        lipSyncGenerationPending: false,
        soundEffectGenerationPending: false,
        addFooterAnimation: true,
        footerMetadata: footerMetadata[1],
      },
      {
        name: 'outro',
        duration: outroDurationSeconds,
        frameGenerationPending: false,
        aiVideoGenerationPending: false,
        lipSyncGenerationPending: false,
        soundEffectGenerationPending: false,
        skipAiVideoGeneration: true,
        addFooterAnimation: false,
        outroImagePath: generatedOutroComposition.background.src,
        imageSession: {
          activeItemList: outroActiveItemList,
        },
      },
    ],
  };

  let frameIndex = 0;
  let firstFooterRenderMetrics = null;
  for (let sceneIndex = 0; sceneIndex < footerMetadata.length; sceneIndex += 1) {
    for (let localFrame = 0; localFrame < framesPerScene; localFrame += 1) {
      const footerRenderMetrics = await renderFooterFrame({
        outputPath: path.join(framesDir, `${frameIndex}.png`),
        canvasDimensions,
        footerMetadata: footerMetadata[sceneIndex],
        sceneLabel: `Blank Scene ${sceneIndex + 1}`,
      });
      firstFooterRenderMetrics ??= footerRenderMetrics;
      frameIndex += 1;
    }
  }

  for (let localFrame = 0; localFrame < outroFrameCount; localFrame += 1) {
    await sharp(generatedOutro.buffer)
      .resize(canvasDimensions.width, canvasDimensions.height, { fit: 'cover' })
      .png()
      .toFile(path.join(framesDir, `${frameIndex}.png`));
    frameIndex += 1;
  }

  const finalVideoPath = path.join(videoDir, 'outro_footer_layout.mp4');
  const totalDurationSeconds = sceneDurationSeconds * footerMetadata.length + outroDurationSeconds;
  await renderFramesToVideo({
    framesDir,
    outputPath: finalVideoPath,
    frameRate,
    durationSeconds: totalDurationSeconds,
  });

  const manifest = {
    createdAt: new Date().toISOString(),
    description: 'Non-generative layout fixture for image_list_to_video footer QR and outro layers.',
    canvasDimensions,
    frameRate,
    totalFrameCount: frameIndex,
    totalDurationSeconds,
    requestParameters: {
      add_footer_animation: true,
      footer_metadata: footerMetadata,
      generate_outro_image: true,
      cta_url: ctaUrl,
      cta_text_top: ctaTextTop,
      cta_text_bottom: ctaTextBottom,
      cta_logo: 'data:image/png;base64,...',
    },
    generatedOutro: {
      path: outroImagePath,
      width: generatedOutroComposition.width,
      height: generatedOutroComposition.height,
      focusArea: generatedOutroComposition.focusArea,
      tileCount: generatedOutroComposition.tileCount,
      qrSize: generatedOutroComposition.qrSize,
    },
    footerRenderMetrics: firstFooterRenderMetrics,
    finalVideoPath,
    mockSession,
  };

  const manifestPath = path.join(runRoot, 'manifest.json');
  await fs.promises.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  return {
    runRoot,
    framesDir,
    outroImagePath,
    finalVideoPath,
    manifestPath,
    canvasDimensions,
    totalFrameCount: frameIndex,
    footerRenderMetrics: firstFooterRenderMetrics,
    generatedOutro: manifest.generatedOutro,
    mockSession,
  };
}
