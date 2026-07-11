import 'dotenv/config';
import { spawn } from 'node:child_process';
import mongoose from 'mongoose';
import ffmpegPath from 'ffmpeg-static';
import { getDBConnectionString } from '../src/models/DBString.js';
import {
  inspectPublicPublicationMedia,
  preparePublicPublicationThumbnail,
  preparePublicPublicationVideo,
} from '../src/models/PublicationMedia.js';
import { isPublicPublicationMediaUrlAccessible } from '../src/models/AWS.js';
import { uploadBufferToPublicationsMedia } from '../src/models/AWS.js';
import VideoSession from '../src/schema/VideoSession.js';
import { Publication } from '../src/schema/Publication.js';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 500;

function extractFirstFrameFromVideo(videoUrl) {
  if (!videoUrl) {
    throw new Error('A video URL is required to extract a thumbnail.');
  }

  return new Promise((resolve, reject) => {
    const process = spawn(
      ffmpegPath || 'ffmpeg',
      [
        '-hide_banner',
        '-loglevel',
        'error',
        '-i',
        videoUrl,
        '-frames:v',
        '1',
        '-f',
        'image2pipe',
        '-vcodec',
        'png',
        'pipe:1',
      ],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
    const chunks = [];
    const errorChunks = [];
    process.stdout.on('data', (chunk) => chunks.push(chunk));
    process.stderr.on('data', (chunk) => errorChunks.push(chunk));
    process.once('error', reject);
    process.once('close', (code) => {
      if (code !== 0 || chunks.length === 0) {
        reject(new Error(
          `Unable to extract a first frame from the rendered video${errorChunks.length
            ? `: ${Buffer.concat(errorChunks).toString('utf8').trim()}`
            : '.'}`
        ));
        return;
      }
      resolve(Buffer.concat(chunks));
    });
  });
}

function getArgValue(name, fallback = '') {
  const prefix = `--${name}=`;
  const argument = process.argv.find((value) => value.startsWith(prefix));
  return argument ? argument.slice(prefix.length).trim() : fallback;
}

function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

function parseLimit() {
  if (hasFlag('all')) {
    return null;
  }
  const parsed = Number.parseInt(getArgValue('limit', String(DEFAULT_LIMIT)), 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return DEFAULT_LIMIT;
  }
  return Math.min(parsed, MAX_LIMIT);
}

function parseMode() {
  const mode = getArgValue('media', 'thumbnail').toLowerCase();
  if (!['thumbnail', 'video', 'all'].includes(mode)) {
    throw new Error('--media must be thumbnail, video, or all.');
  }
  return mode;
}

function buildQuery() {
  const sessionId = getArgValue('session');
  if (!sessionId) {
    return { ispublishedVideo: true };
  }
  if (!mongoose.Types.ObjectId.isValid(sessionId)) {
    throw new Error(`Invalid --session value: ${sessionId}`);
  }
  return {
    _id: new mongoose.Types.ObjectId(sessionId),
    ispublishedVideo: true,
  };
}

function printInspection(inspection, mode, extra = {}) {
  console.log(JSON.stringify({
    sessionId: inspection.sessionId,
    mode,
    configured: inspection.configured,
    video: {
      public: inspection.videoIsPublic,
      currentUrl: inspection.videoUrl || null,
      source: inspection.videoSource || null,
    },
    thumbnail: {
      public: inspection.thumbnailIsPublic,
      currentUrl: inspection.thumbnailUrl || null,
      firstFrame: inspection.firstFrameReference || null,
    },
    ...extra,
  }));
}

async function repairSession(session, mode, inspection) {
  const needsThumbnail = !inspection.thumbnailIsPublic;
  const needsVideo = !inspection.videoIsPublic;
  const changes = {};

  if (mode === 'thumbnail' || mode === 'all') {
    if (needsThumbnail) {
      let thumbnail;
      try {
        thumbnail = await preparePublicPublicationThumbnail(session, {
          forceFirstFrame: true,
        });
      } catch (thumbnailError) {
        const fallbackVideo = changes.videoUrl
          ? { url: changes.videoUrl }
          : inspection.videoIsPublic
            ? { url: inspection.videoUrl }
            : await preparePublicPublicationVideo(session);
        if (!await isPublicPublicationMediaUrlAccessible(fallbackVideo.url)) {
          throw thumbnailError;
        }
        const firstFrameBuffer = await extractFirstFrameFromVideo(fallbackVideo.url);
        const fallbackThumbnailUrl = await uploadBufferToPublicationsMedia({
          key: `published/${inspection.sessionId}/thumbnail.png`,
          buffer: firstFrameBuffer,
          contentType: 'image/png',
        });
        thumbnail = {
          url: fallbackThumbnailUrl,
          source: `first-frame:${fallbackVideo.url}`,
        };
      }
      if (!await isPublicPublicationMediaUrlAccessible(thumbnail.url)) {
        throw new Error(`New thumbnail URL is not publicly accessible: ${thumbnail.url}`);
      }
      changes.thumbnailUrl = thumbnail.url;
      changes.thumbnailSource = thumbnail.source;
      session.publishedSplashImage = thumbnail.url;
      session.splashImage = thumbnail.url;
    }
  }

  if (mode === 'video' || mode === 'all') {
    if (needsVideo) {
      const video = await preparePublicPublicationVideo(session);
      if (!await isPublicPublicationMediaUrlAccessible(video.url)) {
        throw new Error(`New video URL is not publicly accessible: ${video.url}`);
      }
      changes.videoUrl = video.url;
      changes.videoSource = video.source;
      session.publishedVideoURL = video.url;
    }
  }

  const sessionId = inspection.sessionId;
  if (Object.keys(changes).length === 0) {
    return { sessionId, changed: false, changes: {} };
  }

  const sessionSet = {};
  if (changes.thumbnailUrl) {
    sessionSet.publishedSplashImage = changes.thumbnailUrl;
    sessionSet.splashImage = changes.thumbnailUrl;
  }
  if (changes.videoUrl) {
    sessionSet.publishedVideoURL = changes.videoUrl;
  }

  await VideoSession.updateOne({ _id: session._id }, { $set: sessionSet }).exec();

  const publicationSet = {};
  if (changes.thumbnailUrl) {
    publicationSet.splashImage = changes.thumbnailUrl;
  }
  if (changes.videoUrl) {
    publicationSet.videoURL = changes.videoUrl;
  }
  if (Object.keys(publicationSet).length > 0) {
    await Publication.updateOne({ sessionId }, { $set: publicationSet }).exec();
  }

  return { sessionId, changed: true, changes };
}

async function inspectSessionMedia(session) {
  const inspection = inspectPublicPublicationMedia(session);
  const [videoAccessible, thumbnailAccessible] = await Promise.all([
    inspection.videoIsPublic
      ? isPublicPublicationMediaUrlAccessible(inspection.videoUrl)
      : false,
    inspection.thumbnailIsPublic
      ? isPublicPublicationMediaUrlAccessible(inspection.thumbnailUrl)
      : false,
  ]);

  return {
    ...inspection,
    videoIsPublic: videoAccessible,
    thumbnailIsPublic: thumbnailAccessible,
  };
}

async function main() {
  const limit = parseLimit();
  const mode = parseMode();
  const apply = hasFlag('apply');
  const query = buildQuery();

  await getDBConnectionString();
  const sessionsQuery = VideoSession.find(query)
    .sort({ publishedAt: -1, updatedAt: -1, _id: -1 })
  if (limit !== null) {
    sessionsQuery.limit(limit);
  }
  const sessions = await sessionsQuery.lean().exec();

  console.log(JSON.stringify({
    dryRun: !apply,
    apply,
    mode,
    requestedLimit: limit ?? 'all',
    matched: sessions.length,
  }));

  let changed = 0;
  let failed = 0;

  for (const session of sessions) {
    const inspection = await inspectSessionMedia(session);
    if (!apply) {
      printInspection(inspection, mode);
      continue;
    }

    try {
      const result = await repairSession(session, mode, inspection);
      printInspection(inspection, mode, result);
      if (result.changed) {
        changed += 1;
      }
    } catch (error) {
      failed += 1;
      printInspection(inspection, mode, {
        error: error?.message || String(error),
      });
    }
  }

  console.log(JSON.stringify({ dryRun: !apply, mode, changed, failed }));
  if (failed > 0) {
    process.exitCode = 1;
  }
}

try {
  await main();
} finally {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.connection.close();
  }
}
