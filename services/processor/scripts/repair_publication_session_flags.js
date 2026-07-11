import 'dotenv/config';
import mongoose from 'mongoose';
import { getDBConnectionString } from '../src/models/DBString.js';
import VideoSession from '../src/schema/VideoSession.js';
import { Publication } from '../src/schema/Publication.js';

const DEFAULT_LIMIT = 500;
const MAX_LIMIT = 5000;

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

function normalizeString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function buildPublicationQuery() {
  const sessionId = getArgValue('session');
  return {
    isDeleted: { $ne: true },
    ...(sessionId ? { sessionId } : {}),
  };
}

function buildPublishedSessionUpdate(publication, session) {
  const hasSubtitles = typeof publication.hasSubtitles === 'boolean'
    ? publication.hasSubtitles
    : typeof publication.has_subtitles === 'boolean'
      ? publication.has_subtitles
      : session.publishedHasSubtitles ?? null;

  return {
    ispublishedVideo: true,
    publishedPublicationId: publication._id.toString(),
    publishedTitle:
      normalizeString(publication.title) ||
      normalizeString(session.publishedTitle) ||
      normalizeString(session.sessionName) ||
      'Untitled Video',
    publishedDescription:
      typeof publication.description === 'string'
        ? publication.description
        : session.publishedDescription || '',
    publishedTags: Array.isArray(publication.tags)
      ? publication.tags
      : Array.isArray(session.publishedTags)
        ? session.publishedTags
        : [],
    publishedAspectRatio:
      normalizeString(publication.aspectRatio) ||
      normalizeString(session.publishedAspectRatio) ||
      normalizeString(session.aspectRatio),
    publishedVideoURL:
      normalizeString(publication.videoURL) ||
      normalizeString(session.publishedVideoURL) ||
      normalizeString(session.remoteURL) ||
      normalizeString(session.videoLink),
    publishedAt: publication.updatedAt || publication.createdAt || session.publishedAt || new Date(),
    publishedOriginalPrompt:
      normalizeString(publication.originalPrompt) ||
      normalizeString(session.publishedOriginalPrompt),
    publishedSplashImage:
      normalizeString(publication.splashImage) ||
      normalizeString(session.publishedSplashImage) ||
      normalizeString(session.splashImage),
    publishedImageModel:
      normalizeString(publication.imageModel) ||
      normalizeString(session.publishedImageModel),
    publishedVideoModel:
      normalizeString(publication.videoModel) ||
      normalizeString(session.publishedVideoModel),
    publishedHasSubtitles: hasSubtitles,
    publishedSessionLanguage:
      normalizeString(publication.sessionLanguage) ||
      normalizeString(publication.language) ||
      normalizeString(session.publishedSessionLanguage) ||
      normalizeString(session.sessionLanguage),
    publishedLanguageString:
      normalizeString(publication.languageString) ||
      normalizeString(session.publishedLanguageString) ||
      normalizeString(session.languageString),
  };
}

async function main() {
  const apply = hasFlag('apply');
  const limit = parseLimit();

  await getDBConnectionString();
  const publicationQuery = Publication.find(buildPublicationQuery())
    .sort({ updatedAt: -1, _id: -1 });
  if (limit !== null) {
    publicationQuery.limit(limit);
  }
  const publications = await publicationQuery.lean().exec();

  let mismatched = 0;
  let repaired = 0;
  let missingSessions = 0;
  let failed = 0;

  for (const publication of publications) {
    const sessionId = normalizeString(publication.sessionId);
    if (!sessionId || !mongoose.Types.ObjectId.isValid(sessionId)) {
      missingSessions += 1;
      console.log(JSON.stringify({ publicationId: publication._id, sessionId, status: 'invalid-session-id' }));
      continue;
    }

    const session = await VideoSession.findById(sessionId).lean();
    if (!session) {
      missingSessions += 1;
      console.log(JSON.stringify({ publicationId: publication._id, sessionId, status: 'missing-session' }));
      continue;
    }

    const publicationId = publication._id.toString();
    const isMismatched = session.ispublishedVideo !== true ||
      normalizeString(session.publishedPublicationId) !== publicationId;
    if (!isMismatched) {
      continue;
    }

    mismatched += 1;
    if (!apply) {
      console.log(JSON.stringify({ publicationId, sessionId, status: 'would-repair' }));
      continue;
    }

    try {
      await VideoSession.updateOne(
        { _id: session._id },
        { $set: buildPublishedSessionUpdate(publication, session) },
        { runValidators: true },
      );
      repaired += 1;
      console.log(JSON.stringify({ publicationId, sessionId, status: 'repaired' }));
    } catch (error) {
      failed += 1;
      console.log(JSON.stringify({
        publicationId,
        sessionId,
        status: 'failed',
        error: error?.message || String(error),
      }));
    }
  }

  console.log(JSON.stringify({
    dryRun: !apply,
    scanned: publications.length,
    mismatched,
    repaired,
    missingSessions,
    failed,
  }));
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
