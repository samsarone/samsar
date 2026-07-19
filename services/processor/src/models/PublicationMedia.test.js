import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';
import ffmpegPath from 'ffmpeg-static';
import sharp from 'sharp';
import {
  buildInteractivePublicationMainMediaKey,
  buildInteractivePublicationMediaKey,
  buildInteractivePublicationSafePathId,
  deletePublicInteractivePublicationMediaForSession,
  deletePublicPublicationMediaForSession,
  preparePublicInteractivePublicationPathMedia,
  validateInteractivePublicationPathId,
} from './PublicationMedia.js';

const execFileAsync = promisify(execFile);

const createSolidVideo = async (filePath, color) => {
  await execFileAsync(ffmpegPath, [
    '-hide_banner',
    '-loglevel',
    'error',
    '-f',
    'lavfi',
    '-i',
    `color=c=${color}:s=32x32:d=0.3`,
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    '-y',
    filePath,
  ]);
};

const createSplitVideo = async (filePath, firstColor, secondColor) => {
  await execFileAsync(ffmpegPath, [
    '-hide_banner',
    '-loglevel',
    'error',
    '-f',
    'lavfi',
    '-i',
    `color=c=${firstColor}:s=32x32:d=0.5`,
    '-f',
    'lavfi',
    '-i',
    `color=c=${secondColor}:s=32x32:d=0.5`,
    '-filter_complex',
    '[0:v][1:v]concat=n=2:v=1:a=0[outv]',
    '-map',
    '[outv]',
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    '-y',
    filePath,
  ]);
};

const readAverageRgb = async (filePath) => {
  const { data, info } = await sharp(filePath)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const totals = [0, 0, 0];
  for (let offset = 0; offset < data.length; offset += info.channels) {
    totals[0] += data[offset];
    totals[1] += data[offset + 1];
    totals[2] += data[offset + 2];
  }
  const pixels = info.width * info.height;
  return totals.map((total) => total / pixels);
};

test('interactive publication keys are deterministic, collision-safe, and traversal-safe', () => {
  assert.equal(validateInteractivePublicationPathId('root.1'), 'root.1');
  assert.equal(buildInteractivePublicationSafePathId('root.1'), 'cm9vdC4x');
  assert.equal(
    buildInteractivePublicationMediaKey(
      '507f1f77bcf86cd799439011',
      'root.1',
      'video.mp4',
      { revisionId: 'revision-1' },
    ),
    'published/507f1f77bcf86cd799439011/interactive/revisions/revision-1/paths/cm9vdC4x/video.mp4'
  );
  assert.notEqual(
    buildInteractivePublicationSafePathId('root.1'),
    buildInteractivePublicationSafePathId('root-1')
  );
  assert.equal(
    buildInteractivePublicationMainMediaKey(
      '507f1f77bcf86cd799439011',
      'thumbnail.png',
      { revisionId: 'revision-1' },
    ),
    'published/507f1f77bcf86cd799439011/interactive/revisions/revision-1/main/thumbnail.png',
  );

  for (const unsafeId of ['', '.', '..', '../root', 'root/1', 'root\\1', ' root.1', 'root.1 ']) {
    assert.throws(
      () => validateInteractivePublicationPathId(unsafeId),
      /path ID|Unsafe interactive publication path ID/
    );
  }
  assert.throws(
    () => buildInteractivePublicationMediaKey('session', 'root.1', '../video.mp4'),
    /Unsupported interactive publication media name/
  );
  assert.throws(
    () => buildInteractivePublicationMediaKey(
      'session',
      'root.1',
      'video.mp4',
      { revisionId: '../revision' },
    ),
    /safe revision ID/,
  );
});

test('interactive publication separates the main splash from path divergence thumbnails', async (t) => {
  const tempRoot = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), 'samsar-interactive-publication-media-test-')
  );
  const assetsRoot = path.join(tempRoot, 'assets_v2');
  const priorCurrentEnv = process.env.CURRENT_ENV;
  const priorDeliveryMode = process.env.SAMSAR_MEDIA_DELIVERY_MODE;
  const priorAssetsRoot = process.env.SAMSAR_ASSETS_V2_ROOT;
  process.env.CURRENT_ENV = 'docker';
  process.env.SAMSAR_MEDIA_DELIVERY_MODE = 'docker-local';
  process.env.SAMSAR_ASSETS_V2_ROOT = assetsRoot;
  t.after(async () => {
    if (priorCurrentEnv === undefined) delete process.env.CURRENT_ENV;
    else process.env.CURRENT_ENV = priorCurrentEnv;
    if (priorDeliveryMode === undefined) delete process.env.SAMSAR_MEDIA_DELIVERY_MODE;
    else process.env.SAMSAR_MEDIA_DELIVERY_MODE = priorDeliveryMode;
    if (priorAssetsRoot === undefined) delete process.env.SAMSAR_ASSETS_V2_ROOT;
    else process.env.SAMSAR_ASSETS_V2_ROOT = priorAssetsRoot;
    await fs.promises.rm(tempRoot, { recursive: true, force: true });
  });

  const redVideoPath = path.join(tempRoot, 'red.mp4');
  const blueVideoPath = path.join(tempRoot, 'blue.mp4');
  const divergenceThumbnailPath = path.join(tempRoot, 'divergence.png');
  const mainThumbnailPath = path.join(tempRoot, 'main.png');
  await Promise.all([
    createSolidVideo(redVideoPath, 'red'),
    createSplitVideo(blueVideoPath, 'red', 'blue'),
    sharp({
      create: { width: 32, height: 32, channels: 3, background: 'green' },
    }).png().toFile(divergenceThumbnailPath),
    sharp({
      create: { width: 32, height: 32, channels: 3, background: 'yellow' },
    }).png().toFile(mainThumbnailPath),
  ]);

  const sessionId = '507f1f77bcf86cd799439011';
  const session = {
    _id: sessionId,
    splashImage: mainThumbnailPath,
  };
  const revisionId = 'revision-1';
  const redMedia = await preparePublicInteractivePublicationPathMedia(session, {
    pathId: 'root.1',
    videoGenerationStatus: 'COMPLETED',
    videoLink: redVideoPath,
    thumbnailPath: divergenceThumbnailPath,
  }, { revisionId, isDefault: true });
  const blueMedia = await preparePublicInteractivePublicationPathMedia(session, {
    pathId: 'root.2',
    videoGenerationStatus: 'COMPLETED',
    videoLink: blueVideoPath,
    selectionTrail: [{ switchAtSeconds: 0.5 }],
  }, { revisionId });

  assert.match(
    redMedia.videoUrl,
    /\/interactive\/revisions\/revision-1\/paths\/cm9vdC4x\/video\.mp4$/,
  );
  assert.match(
    redMedia.thumbnailUrl,
    /\/interactive\/revisions\/revision-1\/paths\/cm9vdC4x\/thumbnail\.png$/,
  );
  assert.match(
    blueMedia.videoUrl,
    /\/interactive\/revisions\/revision-1\/paths\/cm9vdC4y\/video\.mp4$/,
  );
  assert.equal(redMedia.thumbnailSource, divergenceThumbnailPath);
  assert.equal(redMedia.mainThumbnailSource, mainThumbnailPath);
  assert.equal(blueMedia.thumbnailSource, 'ffmpeg-divergence-video-frame');

  const redThumbnailPath = path.join(
    assetsRoot,
    'published',
    sessionId,
    'interactive',
    'revisions',
    revisionId,
    'paths',
    redMedia.safePathId,
    'thumbnail.png'
  );
  const blueThumbnailPath = path.join(
    assetsRoot,
    'published',
    sessionId,
    'interactive',
    'revisions',
    revisionId,
    'paths',
    blueMedia.safePathId,
    'thumbnail.png'
  );
  const publishedMainThumbnailPath = path.join(
    assetsRoot,
    'published',
    sessionId,
    'interactive',
    'revisions',
    revisionId,
    'main',
    'thumbnail.png',
  );
  const [redAverage, blueAverage, mainAverage] = await Promise.all([
    readAverageRgb(redThumbnailPath),
    readAverageRgb(blueThumbnailPath),
    readAverageRgb(publishedMainThumbnailPath),
  ]);
  assert.ok(redAverage[1] > redAverage[0] + 50, 'saved divergence thumbnail should be green');
  assert.ok(blueAverage[2] > blueAverage[0] + 100, 'blue path thumbnail should be blue');
  assert.ok(
    mainAverage[0] > mainAverage[2] + 100 && mainAverage[1] > mainAverage[2] + 100,
    'main publication thumbnail should preserve the yellow session splash',
  );

  const linearDirectory = path.join(assetsRoot, 'published', sessionId);
  await fs.promises.mkdir(linearDirectory, { recursive: true });
  const linearVideoPath = path.join(linearDirectory, 'video.mp4');
  const linearThumbnailPath = path.join(linearDirectory, 'thumbnail.png');
  await Promise.all([
    fs.promises.writeFile(linearVideoPath, 'linear-video-sentinel'),
    fs.promises.writeFile(linearThumbnailPath, 'linear-thumbnail-sentinel'),
  ]);

  const cleanup = await deletePublicInteractivePublicationMediaForSession(sessionId, [
    { pathId: 'root.1' },
    { path_id: 'root.2' },
  ], { revisionId });
  assert.equal(cleanup.deleted.length, 5);
  assert.equal(cleanup.failed.length, 0);
  assert.equal(fs.existsSync(redThumbnailPath), false);
  assert.equal(fs.existsSync(blueThumbnailPath), false);
  assert.equal(fs.existsSync(publishedMainThumbnailPath), false);
  assert.equal(fs.existsSync(linearVideoPath), true);
  assert.equal(fs.existsSync(linearThumbnailPath), true);

  const rawBranchThumbnailPath = path.join(
    linearDirectory,
    'branches',
    'path-cm9vdC4x',
    'thumbnail.png',
  );
  await fs.promises.mkdir(path.dirname(rawBranchThumbnailPath), { recursive: true });
  await fs.promises.writeFile(rawBranchThumbnailPath, 'raw-branch-thumbnail');

  const sessionCleanup = await deletePublicPublicationMediaForSession(sessionId);
  assert.equal(sessionCleanup.failed.length, 0);
  assert.equal(sessionCleanup.deleted.includes(`published/${sessionId}/branches/`), true);
  assert.equal(fs.existsSync(rawBranchThumbnailPath), false);
  assert.equal(fs.existsSync(linearVideoPath), false);
  assert.equal(fs.existsSync(linearThumbnailPath), false);
});
