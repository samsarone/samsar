import crypto from 'crypto';
import mongoose from 'mongoose';
import OpenAI from 'openai';
import { getDBConnectionString } from '../DBString.js';
import { Publication } from '../../schema/Publication.js';
import {
  ensureGalleryIndexes,
  getGalleryModels,
  getGalleryVectorIndexName,
} from './GalleryDatabase.js';
import {
  GALLERY_DATABASE_NAME,
  GALLERY_EMBEDDING_DIMENSIONS,
  GALLERY_EMBEDDING_MODEL,
} from './GalleryConstants.js';
import {
  createSamsarExternalEmbeddings,
  shouldUseSamsarExternalEmbeddings,
} from '../ai_utils/SamsarExternalEmbeddingAdapter.js';
import { normalizePublicationTranscript } from '../publication/Transcript.js';
import {
  removeGalleryTaxonomyPublications,
  syncGalleryTaxonomyMembership,
} from './GalleryTaxonomy.js';

const EMBEDDING_MODEL = GALLERY_EMBEDDING_MODEL;
const EMBEDDING_DIMENSIONS = GALLERY_EMBEDDING_DIMENSIONS;
const EMBEDDING_VERSION = process.env.GALLERY_EMBEDDING_VERSION || 'gallery-v2-content';
const EMBEDDING_BATCH_SIZE = Math.max(
  1,
  Math.min(100, Number.parseInt(process.env.GALLERY_EMBEDDING_BATCH_SIZE || '50', 10) || 50),
);
const VIEW_DEDUPE_MS = 6 * 60 * 60 * 1000;
const MAX_WATCH_TIME_MS = 24 * 60 * 60 * 1000;
const GALLERY_SYNC_STATE_KEY = 'publication_embeddings';
export const GALLERY_PUBLICATION_EMBEDDING_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const GALLERY_EMBEDDING_REFRESH_MS = GALLERY_PUBLICATION_EMBEDDING_MAX_AGE_MS;
const GALLERY_PUBLICATION_EMBEDDING_LEASE_MS = 10 * 60 * 1000;
const GALLERY_SYNC_LEASE_MS = 30 * 60 * 1000;
const GALLERY_RECOMMENDATION_CACHE_TTL_MS = 60 * 60 * 1000;
const GALLERY_RECOMMENDATION_CACHE_VERSION = 'gallery-recommendations-v1';
const recommendationInFlight = new Map();

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY || '' });

function clamp(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return min;
  return Math.min(max, Math.max(min, number));
}

function normalizeString(value, fallback = '') {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function normalizeTags(value) {
  return Array.isArray(value)
    ? Array.from(
        new Set(
          value
            .filter((tag) => typeof tag === 'string')
            .map((tag) => tag.trim().toLowerCase())
            .filter(Boolean),
        ),
      ).slice(0, 30)
    : [];
}

function normalizeStringList(value, { lowercase = false, limit = 30 } = {}) {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(
      value
        .filter((item) => typeof item === 'string')
        .map((item) => item.trim())
        .filter(Boolean)
        .map((item) => lowercase ? item.toLowerCase() : item),
    ),
  ).slice(0, limit);
}

function objectIdString(value) {
  if (!value) return null;
  const normalized = value?.toString?.() || value;
  return typeof normalized === 'string' && normalized.trim() ? normalized.trim() : null;
}

function normalizeAspectFormat(value) {
  if (typeof value !== 'string') return 'unknown';
  const normalized = value.trim().toLowerCase();
  if (['landscape', 'horizontal', 'wide'].includes(normalized)) return 'landscape';
  if (['portrait', 'vertical'].includes(normalized)) return 'portrait';
  if (normalized === 'square') return 'square';
  const match = normalized.match(/(\d*\.?\d+)\s*[:x/×]\s*(\d*\.?\d+)/);
  if (!match) return 'unknown';
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!width || !height) return 'unknown';
  const ratio = width / height;
  if (Math.abs(ratio - 1) <= 0.05) return 'square';
  return ratio > 1 ? 'landscape' : 'portrait';
}

function safeDate(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function calculateEngagementScores({ metrics, createdAt, updatedAt }) {
  const views = Math.max(0, Number(metrics.views) || 0);
  const uniqueViews = Math.max(0, Number(metrics.uniqueViews) || 0);
  const completedViews = Math.max(0, Number(metrics.completedViews) || 0);
  const likes = Math.max(0, Number(metrics.likes) || 0);
  const comments = Math.max(0, Number(metrics.comments) || 0);
  const shares = Math.max(0, Number(metrics.shares) || 0);
  const completionRate = clamp(metrics.averageCompletionRate, 0, 1);
  const ageHours = Math.max(
    1,
    (Date.now() - (safeDate(createdAt)?.getTime() || Date.now())) / (60 * 60 * 1000),
  );
  const activityHours = Math.max(
    1,
    (Date.now() - (safeDate(updatedAt)?.getTime() || Date.now())) / (60 * 60 * 1000),
  );

  const popularityScore =
    Math.log1p(views) * 0.42 +
    Math.log1p(uniqueViews) * 0.12 +
    Math.log1p(likes) * 0.2 +
    Math.log1p(comments) * 0.11 +
    Math.log1p(shares) * 0.1 +
    completionRate * 0.05;
  const trendingScore =
    (Math.log1p(views + likes * 3 + comments * 4 + shares * 6) + completionRate) /
    Math.pow(ageHours + 2, 0.34) +
    0.12 / Math.pow(activityHours + 1, 0.25);
  const qualityScore =
    completionRate * 0.55 +
    Math.min(1, completedViews / Math.max(1, views)) * 0.25 +
    Math.min(1, (likes + comments + shares) / Math.max(1, views)) * 0.2;

  return { popularityScore, trendingScore, qualityScore };
}

function publicationMetrics(publication) {
  return {
    views: Math.max(0, Number(publication.views?.total) || 0),
    uniqueViews: Math.max(0, Number(publication.views?.unique) || 0),
    completedViews: Math.max(0, Number(publication.views?.completed) || 0),
    watchTimeMs: Math.max(0, Number(publication.views?.watchTimeMs) || 0),
    averageWatchTimeMs: Math.max(0, Number(publication.views?.averageWatchTimeMs) || 0),
    averageCompletionRate: clamp(publication.views?.averageCompletionRate, 0, 1),
    likes: Math.max(0, Number(publication.likes?.count) || 0),
    comments: Array.isArray(publication.comments) ? publication.comments.length : 0,
    shares: Math.max(0, Number(publication.shares) || 0),
  };
}

export function buildGalleryEmbeddingText(publication) {
  const transcript = normalizePublicationTranscript(publication.sessionTranscript);
  const sceneText = transcript.scenes
    .map((scene) => [scene.type, scene.visual, scene.speaker].filter(Boolean).join(': '))
    .filter(Boolean);
  const speechText = transcript.sounds
    .map((sound) => [sound.sub_type, sound.speaker, sound.text].filter(Boolean).join(': '))
    .filter(Boolean);

  return [
    `Title: ${normalizeString(publication.title, 'Untitled Video')}`,
    normalizeString(publication.description) && `Description: ${normalizeString(publication.description)}`,
    normalizeString(publication.originalPrompt) && `Original prompt: ${normalizeString(publication.originalPrompt)}`,
    sceneText.length > 0 && `Scenes:\n${sceneText.join('\n')}`,
    speechText.length > 0 && `Speech:\n${speechText.join('\n')}`,
  ]
    .filter(Boolean)
    .join('\n')
    .slice(0, 12000);
}

function buildSearchText(publication, metrics, embeddingText) {
  const tags = normalizeTags(publication.tags);
  const categories = normalizeStringList(publication.categories, { limit: 3 });
  const topics = normalizeStringList(publication.topics, { lowercase: true, limit: 8 });
  return [
    embeddingText,
    categories.length > 0 && `Categories: ${categories.join(', ')}`,
    topics.length > 0 && `Topics: ${topics.join(', ')}`,
    tags.length > 0 && `Legacy tags: ${tags.join(', ')}`,
    normalizeString(publication.creatorHandle) && `Creator: ${normalizeString(publication.creatorHandle)}`,
    normalizeString(publication.sessionLanguage || publication.language) &&
      `Language: ${normalizeString(publication.sessionLanguage || publication.language)}`,
    normalizeString(publication.videoModel) && `Video model: ${normalizeString(publication.videoModel)}`,
    normalizeString(publication.aspectRatio) && `Format: ${normalizeString(publication.aspectRatio)}`,
    `Engagement: ${metrics.views} views, ${metrics.likes} likes, ${metrics.comments} comments, ${metrics.shares} shares`,
    `Average completion: ${Math.round(metrics.averageCompletionRate * 100)} percent`,
  ]
    .filter(Boolean)
    .join('\n')
    .slice(0, 12000);
}

function createFingerprint(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function buildGalleryRecord(publication) {
  const metrics = publicationMetrics(publication);
  const scores = calculateEngagementScores({
    metrics,
    createdAt: publication.createdAt,
    updatedAt: publication.updatedAt,
  });
  const embeddingText = buildGalleryEmbeddingText(publication);
  const searchText = buildSearchText(publication, metrics, embeddingText);
  const publicationId = objectIdString(publication._id);

  return {
    publicationId,
    sessionId: objectIdString(publication.sessionId),
    videoUrl: normalizeString(publication.videoURL),
    posterUrl: normalizeString(publication.splashImage) || null,
    title: normalizeString(publication.title, 'Untitled Video'),
    description: normalizeString(publication.description),
    originalPrompt: normalizeString(publication.originalPrompt),
    creatorHandle: normalizeString(publication.creatorHandle),
    createdBy: objectIdString(publication.createdBy),
    tags: normalizeTags(publication.tags),
    categories: normalizeStringList(publication.categories, { limit: 3 }),
    topics: normalizeStringList(publication.topics, { lowercase: true, limit: 8 }),
    classification: publication.classification || {},
    sessionTranscript: normalizePublicationTranscript(publication.sessionTranscript),
    aspectRatio: normalizeString(publication.aspectRatio) || null,
    format: normalizeAspectFormat(publication.aspectRatio),
    contentLanguage: normalizeString(publication.sessionLanguage || publication.language) || null,
    imageModel: normalizeString(publication.imageModel) || null,
    videoModel: normalizeString(publication.videoModel) || null,
    searchText,
    embeddingText,
    embeddingModel: EMBEDDING_MODEL,
    embeddingFingerprint: createFingerprint(`${EMBEDDING_VERSION}\n${embeddingText}`),
    embeddingVersion: EMBEDDING_VERSION,
    metrics,
    ...scores,
    sourceCreatedAt: safeDate(publication.createdAt),
    sourceUpdatedAt: safeDate(publication.updatedAt),
    indexedAt: new Date(),
    lastEngagementAt: safeDate(publication.views?.lastViewedAt),
    available: true,
    metadata: {
      galleryMetadata: publication.galleryMetadata || {},
      recommendationMetadata: publication.recommendation?.metadata || {},
      hasSubtitles:
        typeof publication.hasSubtitles === 'boolean'
          ? publication.hasSubtitles
          : publication.has_subtitles ?? null,
    },
  };
}

async function createEmbeddings(texts) {
  if (shouldUseSamsarExternalEmbeddings()) {
    return createSamsarExternalEmbeddings(texts);
  }
  if (!process.env.OPENAI_API_KEY?.trim()) {
    const error = new Error(
      'Gallery embeddings require the local OPENAI_API_KEY or a deployed Samsar API key.',
    );
    error.statusCode = 503;
    throw error;
  }

  const response = await openai.embeddings.create({
    model: EMBEDDING_MODEL,
    input: texts,
    dimensions: EMBEDDING_DIMENSIONS,
    encoding_format: 'float',
  });
  return response.data.map((item) => item.embedding);
}

function isGalleryPublicationAvailable(publication) {
  return Boolean(
    publication &&
    publication.isHidden !== true &&
    publication.isDeleted !== true &&
    typeof publication.videoURL === 'string' &&
    publication.videoURL.trim(),
  );
}

export function isGalleryPublicationEmbeddingFresh(
  galleryPublication,
  expectedFingerprint,
  now = new Date(),
) {
  if (!Array.isArray(galleryPublication?.embedding) || galleryPublication.embedding.length === 0) {
    return false;
  }
  if (!expectedFingerprint || galleryPublication.embeddingFingerprint !== expectedFingerprint) {
    return false;
  }
  const indexedAt = safeDate(galleryPublication.indexedAt);
  return Boolean(
    indexedAt &&
    now.getTime() - indexedAt.getTime() < GALLERY_PUBLICATION_EMBEDDING_MAX_AGE_MS
  );
}

function gallerySyncNoopResponse(state, status) {
  const lastUpdatedAt = safeDate(state?.lastUpdatedAt || state?.lastSuccessfulAt);
  const nextUpdateAt = lastUpdatedAt
    ? new Date(lastUpdatedAt.getTime() + GALLERY_EMBEDDING_REFRESH_MS)
    : null;
  return {
    status,
    database: GALLERY_DATABASE_NAME,
    embeddingModel: EMBEDDING_MODEL,
    embeddingVersion: EMBEDDING_VERSION,
    indexed: 0,
    skipped: 0,
    failed: 0,
    scanned: 0,
    removed: 0,
    refreshed: false,
    stale: !lastUpdatedAt || Date.now() >= nextUpdateAt.getTime(),
    startedAt: state?.startedAt || null,
    lastUpdatedAt,
    nextUpdateAt,
  };
}

async function ensureGallerySyncState(GallerySyncState) {
  try {
    await GallerySyncState.updateOne(
      { key: GALLERY_SYNC_STATE_KEY },
      {
        $setOnInsert: {
          key: GALLERY_SYNC_STATE_KEY,
          status: 'idle',
          lastUpdatedAt: null,
          sourceWatermarkAt: null,
        },
      },
      { upsert: true },
    );
  } catch (error) {
    if (error?.code !== 11000) throw error;
  }
}

export async function syncGalleryPublications({ force = false, staleOnly = false } = {}) {
  const syncStartedAt = new Date();
  await getDBConnectionString();
  const { GalleryPublication, GallerySyncState } = await getGalleryModels();
  await ensureGalleryIndexes();

  await ensureGallerySyncState(GallerySyncState);
  const staleCutoff = new Date(syncStartedAt.getTime() - GALLERY_EMBEDDING_REFRESH_MS);
  const leaseCutoff = new Date(syncStartedAt.getTime() - GALLERY_SYNC_LEASE_MS);
  const claimConditions = [
    {
      $or: [
        { status: { $ne: 'running' } },
        { leaseExpiresAt: { $lte: syncStartedAt } },
        {
          $and: [
            { status: 'running' },
            { $or: [{ leaseExpiresAt: null }, { leaseExpiresAt: { $exists: false } }] },
            {
              $or: [
                { startedAt: null },
                { startedAt: { $exists: false } },
                { startedAt: { $lte: leaseCutoff } },
              ],
            },
          ],
        },
      ],
    },
  ];
  if (staleOnly && !force) {
    claimConditions.push({
      $or: [
        { lastUpdatedAt: null },
        { lastUpdatedAt: { $exists: false } },
        { lastUpdatedAt: { $lte: staleCutoff } },
      ],
    });
  }

  const claimedState = await GallerySyncState.findOneAndUpdate(
    { key: GALLERY_SYNC_STATE_KEY, $and: claimConditions },
    {
      $set: {
        status: 'running',
        startedAt: syncStartedAt,
        lastCheckedAt: syncStartedAt,
        leaseExpiresAt: new Date(syncStartedAt.getTime() + GALLERY_SYNC_LEASE_MS),
        lastError: null,
      },
    },
    { new: true },
  ).lean();

  if (!claimedState) {
    const currentState = await GallerySyncState.findOne({ key: GALLERY_SYNC_STATE_KEY }).lean();
    await GallerySyncState.updateOne(
      { key: GALLERY_SYNC_STATE_KEY },
      { $set: { lastCheckedAt: syncStartedAt } },
    );
    const currentLease = safeDate(currentState?.leaseExpiresAt);
    const currentStartedAt = safeDate(currentState?.startedAt);
    const leaseIsActive = currentState?.status === 'running' && (
      currentLease?.getTime() > syncStartedAt.getTime() ||
      (!currentLease && currentStartedAt?.getTime() > leaseCutoff.getTime())
    );
    return gallerySyncNoopResponse(currentState, leaseIsActive ? 'already_running' : 'fresh');
  }

  try {
    const previousWatermark = !force ? safeDate(claimedState.sourceWatermarkAt) : null;
    const sourcePublications = await Publication.find(
      previousWatermark ? { updatedAt: { $gt: previousWatermark } } : {},
    ).lean();
    const activeSourcePublications = sourcePublications.filter(isGalleryPublicationAvailable);
    const records = activeSourcePublications
      .map(buildGalleryRecord)
      .filter((record) => record.publicationId);
    const changedSourceIds = records.map((record) => record.publicationId);
    const existing = await GalleryPublication.find(
      { publicationId: { $in: changedSourceIds } },
      { publicationId: 1, embeddingFingerprint: 1 },
    ).lean();
    const existingFingerprints = new Map(
      existing.map((item) => [item.publicationId, item.embeddingFingerprint]),
    );
    const embeddingChanges = records.filter(
      (record) => force || existingFingerprints.get(record.publicationId) !== record.embeddingFingerprint,
    );
    const metadataOnlyChanges = records.filter(
      (record) => !force && existingFingerprints.get(record.publicationId) === record.embeddingFingerprint,
    );

    for (let offset = 0; offset < embeddingChanges.length; offset += EMBEDDING_BATCH_SIZE) {
      const batch = embeddingChanges.slice(offset, offset + EMBEDDING_BATCH_SIZE);
      const embeddings = await createEmbeddings(batch.map((record) => record.embeddingText));
      await GalleryPublication.bulkWrite(
        batch.map((record, index) => ({
          updateOne: {
            filter: { publicationId: record.publicationId },
            update: { $set: { ...record, embedding: embeddings[index] } },
            upsert: true,
          },
        })),
        { ordered: false },
      );

      await Publication.bulkWrite(
        batch.map((record) => ({
          updateOne: {
            filter: { _id: record.publicationId },
            update: {
              $set: {
                'recommendation.popularityScore': record.popularityScore,
                'recommendation.trendingScore': record.trendingScore,
                'recommendation.qualityScore': record.qualityScore,
                'recommendation.embeddingVersion': record.embeddingFingerprint,
                'recommendation.lastIndexedAt': new Date(),
              },
            },
            timestamps: false,
          },
        })),
        { ordered: false },
      );
    }

    if (metadataOnlyChanges.length > 0) {
      await GalleryPublication.bulkWrite(
        metadataOnlyChanges.map((record) => ({
          updateOne: {
            filter: { publicationId: record.publicationId },
            update: { $set: record },
          },
        })),
        { ordered: false },
      );
    }

    const inactiveChangedIds = sourcePublications
      .filter((publication) => !isGalleryPublicationAvailable(publication))
      .map((publication) => objectIdString(publication._id))
      .filter(Boolean);
    const indexedPublications = await GalleryPublication.find(
      { available: true },
      { publicationId: 1 },
    ).lean();
    const indexedIds = indexedPublications.map((record) => record.publicationId).filter(Boolean);
    const existingActiveSourceIds = indexedIds.length > 0
      ? await Publication.find(
          {
            _id: { $in: indexedIds },
            $and: [
              { $or: [{ isHidden: { $exists: false } }, { isHidden: false }] },
              { $or: [{ isDeleted: { $exists: false } }, { isDeleted: false }] },
              { videoURL: { $type: 'string', $ne: '' } },
            ],
          },
          { _id: 1 },
        ).lean()
      : [];
    const activeSourceIdSet = new Set(
      existingActiveSourceIds.map((record) => objectIdString(record._id)).filter(Boolean),
    );
    const removedIds = Array.from(
      new Set([
        ...inactiveChangedIds,
        ...indexedIds.filter((publicationId) => !activeSourceIdSet.has(publicationId)),
      ]),
    );
    if (removedIds.length > 0) {
      await Promise.all([
        GalleryPublication.updateMany(
          { publicationId: { $in: removedIds }, available: true },
          { $set: { available: false, indexedAt: new Date() } },
        ),
        removeGalleryTaxonomyPublications(removedIds),
      ]);
    }

    const completedAt = new Date();
    const totalAvailable = await GalleryPublication.countDocuments({ available: true });
    await GallerySyncState.findOneAndUpdate(
      { key: GALLERY_SYNC_STATE_KEY },
      {
        $set: {
          status: 'idle',
          completedAt,
          lastSuccessfulAt: completedAt,
          lastUpdatedAt: completedAt,
          nextUpdateAt: new Date(completedAt.getTime() + GALLERY_EMBEDDING_REFRESH_MS),
          sourceWatermarkAt: syncStartedAt,
          leaseExpiresAt: null,
          indexedCount: embeddingChanges.length,
          skippedCount: metadataOnlyChanges.length,
          failedCount: 0,
          metadata: {
            totalAvailable,
            embeddingVersion: EMBEDDING_VERSION,
            scannedCount: sourcePublications.length,
            removedCount: removedIds.length,
          },
        },
      },
    );

    return {
      status: 'complete',
      database: GALLERY_DATABASE_NAME,
      embeddingModel: EMBEDDING_MODEL,
      embeddingVersion: EMBEDDING_VERSION,
      indexed: embeddingChanges.length,
      skipped: metadataOnlyChanges.length,
      failed: 0,
      scanned: sourcePublications.length,
      removed: removedIds.length,
      refreshed: true,
      stale: false,
      totalAvailable,
      startedAt: syncStartedAt,
      completedAt,
      lastUpdatedAt: completedAt,
      nextUpdateAt: new Date(completedAt.getTime() + GALLERY_EMBEDDING_REFRESH_MS),
    };
  } catch (error) {
    await GallerySyncState.findOneAndUpdate(
      { key: GALLERY_SYNC_STATE_KEY },
      {
        $set: {
          status: 'failed',
          completedAt: new Date(),
          leaseExpiresAt: null,
          failedCount: 1,
          lastError: error?.message || 'Gallery sync failed.',
        },
      },
    );
    throw error;
  }
}

export async function updateGalleryPublicationEmbedding(publicationId, { force = false } = {}) {
  const normalizedPublicationId = objectIdString(publicationId);
  if (!normalizedPublicationId) {
    const error = new Error('publication_id is required.');
    error.statusCode = 400;
    throw error;
  }
  if (!mongoose.Types.ObjectId.isValid(normalizedPublicationId)) {
    const error = new Error('publication_id must be a valid publication ID.');
    error.statusCode = 400;
    throw error;
  }

  await getDBConnectionString();
  const { GalleryPublication } = await getGalleryModels();
  await ensureGalleryIndexes();
  const source = await Publication.findById(normalizedPublicationId).lean();
  const current = await GalleryPublication.findOne({
    publicationId: normalizedPublicationId,
  }).lean();

  if (!isGalleryPublicationAvailable(source)) {
    if (current?.available) {
      await Promise.all([
        GalleryPublication.updateOne(
          { publicationId: normalizedPublicationId },
          { $set: { available: false, indexedAt: new Date() } },
        ),
        removeGalleryTaxonomyPublications([normalizedPublicationId]),
      ]);
    }
    return { status: 'skipped', reason: source ? 'unavailable' : 'not_found' };
  }

  const record = buildGalleryRecord(source);
  const now = new Date();
  if (!force && isGalleryPublicationEmbeddingFresh(current, record.embeddingFingerprint, now)) {
    await Promise.all([
      Publication.updateOne(
        { _id: normalizedPublicationId },
        {
          $set: {
            'recommendation.embeddingVersion': record.embeddingFingerprint,
            'recommendation.lastIndexedAt': current.indexedAt,
            'recommendation.embeddingStatus': 'complete',
            'recommendation.embeddingLeaseExpiresAt': null,
            'recommendation.embeddingError': null,
          },
        },
        { timestamps: false },
      ),
      syncGalleryTaxonomyMembership({
        publicationId: normalizedPublicationId,
        previousCategories: current?.categories,
        previousTopics: current?.topics,
        categories: record.categories,
        topics: record.topics,
      }),
    ]);
    return {
      status: 'skipped',
      reason: 'fresh',
      publicationId: normalizedPublicationId,
      nextUpdateAt: new Date(
        safeDate(current.indexedAt).getTime() + GALLERY_PUBLICATION_EMBEDDING_MAX_AGE_MS,
      ),
    };
  }

  // The source document can say indexing completed even when a previous write to
  // the gallery database was lost. Atomically reopen that exact completed attempt
  // so one replica can repair the missing/stale gallery record without allowing
  // concurrent requests to regenerate the same embedding.
  if (!force && source.recommendation?.embeddingStatus === 'complete') {
    await Publication.updateOne(
      {
        _id: normalizedPublicationId,
        'recommendation.embeddingStatus': 'complete',
        'recommendation.embeddingVersion': source.recommendation?.embeddingVersion ?? null,
        'recommendation.lastIndexedAt': source.recommendation?.lastIndexedAt ?? null,
      },
      { $set: { 'recommendation.embeddingStatus': 'pending' } },
      { timestamps: false },
    );
  }

  const staleCutoff = new Date(now.getTime() - GALLERY_PUBLICATION_EMBEDDING_MAX_AGE_MS);
  const leaseAvailable = {
    $or: [
      { 'recommendation.embeddingStatus': { $ne: 'running' } },
      { 'recommendation.embeddingLeaseExpiresAt': { $lte: now } },
      { 'recommendation.embeddingLeaseExpiresAt': null },
    ],
  };
  const needsUpdate = {
    $or: [
      { 'recommendation.embeddingStatus': { $ne: 'complete' } },
      { 'recommendation.embeddingVersion': { $ne: record.embeddingFingerprint } },
      { 'recommendation.lastIndexedAt': { $exists: false } },
      { 'recommendation.lastIndexedAt': null },
      { 'recommendation.lastIndexedAt': { $lte: staleCutoff } },
    ],
  };
  const claimed = await Publication.findOneAndUpdate(
    {
      _id: normalizedPublicationId,
      $and: [leaseAvailable, ...(force ? [] : [needsUpdate])],
    },
    {
      $set: {
        'recommendation.embeddingStatus': 'running',
        'recommendation.embeddingLastAttemptAt': now,
        'recommendation.embeddingLeaseExpiresAt': new Date(
          now.getTime() + GALLERY_PUBLICATION_EMBEDDING_LEASE_MS,
        ),
        'recommendation.embeddingError': null,
      },
    },
    { new: true, timestamps: false },
  ).lean();

  if (!claimed) {
    return {
      status: 'skipped',
      reason: 'fresh_or_already_running',
      publicationId: normalizedPublicationId,
    };
  }

  try {
    const claimedRecord = buildGalleryRecord(claimed);
    const [embedding] = await createEmbeddings([claimedRecord.embeddingText]);
    if (!Array.isArray(embedding) || embedding.length === 0) {
      throw new Error('Embedding provider returned an empty publication embedding.');
    }
    const completedAt = new Date();
    await GalleryPublication.updateOne(
      { publicationId: normalizedPublicationId },
      { $set: { ...claimedRecord, embedding, indexedAt: completedAt } },
      { upsert: true },
    );
    await Promise.all([
      Publication.updateOne(
        { _id: normalizedPublicationId },
        {
          $set: {
            'recommendation.popularityScore': claimedRecord.popularityScore,
            'recommendation.trendingScore': claimedRecord.trendingScore,
            'recommendation.qualityScore': claimedRecord.qualityScore,
            'recommendation.embeddingVersion': claimedRecord.embeddingFingerprint,
            'recommendation.lastIndexedAt': completedAt,
            'recommendation.embeddingStatus': 'complete',
            'recommendation.embeddingLeaseExpiresAt': null,
            'recommendation.embeddingError': null,
          },
        },
        { timestamps: false },
      ),
      syncGalleryTaxonomyMembership({
        publicationId: normalizedPublicationId,
        previousCategories: current?.categories,
        previousTopics: current?.topics,
        categories: claimedRecord.categories,
        topics: claimedRecord.topics,
      }),
    ]);
    return {
      status: 'updated',
      publicationId: normalizedPublicationId,
      indexedAt: completedAt,
      nextUpdateAt: new Date(completedAt.getTime() + GALLERY_PUBLICATION_EMBEDDING_MAX_AGE_MS),
    };
  } catch (error) {
    await Publication.updateOne(
      { _id: normalizedPublicationId },
      {
        $set: {
          'recommendation.embeddingStatus': 'failed',
          'recommendation.embeddingLeaseExpiresAt': null,
          'recommendation.embeddingError': normalizeString(error?.message || String(error)).slice(0, 500),
        },
      },
      { timestamps: false },
    );
    throw error;
  }
}

export async function updateGalleryPublicationEmbeddings({ publicationId, force = false } = {}) {
  const embedding = await updateGalleryPublicationEmbedding(publicationId, { force });
  if (['not_found', 'unavailable', 'fresh_or_already_running'].includes(embedding?.reason)) {
    return { ...embedding, classification: null };
  }
  const { classifyGalleryPublication } = await import('./GalleryClassification.js');
  const classification = await classifyGalleryPublication(publicationId, { force });
  return { ...embedding, classification };
}

function cosineSimilarity(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return 0;
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < left.length; index += 1) {
    dot += left[index] * right[index];
    leftNorm += left[index] * left[index];
    rightNorm += right[index] * right[index];
  }
  return leftNorm && rightNorm ? dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm)) : 0;
}

async function vectorCandidates(queryVector, limit) {
  const { GalleryPublication } = await getGalleryModels();
  const projection = {
    publicationId: 1,
    sessionId: 1,
    videoUrl: 1,
    posterUrl: 1,
    title: 1,
    description: 1,
    originalPrompt: 1,
    creatorHandle: 1,
    createdBy: 1,
    tags: 1,
    categories: 1,
    topics: 1,
    classification: 1,
    aspectRatio: 1,
    format: 1,
    contentLanguage: 1,
    metrics: 1,
    popularityScore: 1,
    trendingScore: 1,
    qualityScore: 1,
    sourceCreatedAt: 1,
    embedding: 1,
  };

  try {
    return await GalleryPublication.aggregate([
      {
        $search: {
          cosmosSearch: {
            path: 'embedding',
            vector: queryVector,
            k: limit,
            filter: { available: { $eq: true } },
          },
        },
      },
      { $project: { ...projection, similarityScore: { $meta: 'searchScore' } } },
    ]);
  } catch (cosmosError) {
    try {
      return await GalleryPublication.aggregate([
        {
          $vectorSearch: {
            index: getGalleryVectorIndexName(),
            queryVector,
            path: 'embedding',
            numCandidates: Math.max(100, limit * 8),
            limit,
            filter: { available: true },
          },
        },
        { $project: { ...projection, similarityScore: { $meta: 'vectorSearchScore' } } },
      ]);
    } catch (vectorError) {
      const records = await GalleryPublication.find(
        { available: true, 'embedding.0': { $exists: true } },
        projection,
      )
        .limit(2000)
        .lean();
      return records
        .map((record) => ({ ...record, similarityScore: cosineSimilarity(queryVector, record.embedding) }))
        .sort((left, right) => right.similarityScore - left.similarityScore)
        .slice(0, limit);
    }
  }
}

function keywordScore(record, query) {
  const terms = query
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((term) => term.length > 1)
    .slice(0, 12);
  if (terms.length === 0) return 0;
  const title = normalizeString(record.title).toLowerCase();
  const creator = normalizeString(record.creatorHandle).toLowerCase();
  const tags = normalizeTags(record.tags).join(' ');
  const categories = normalizeStringList(record.categories).join(' ').toLowerCase();
  const topics = normalizeStringList(record.topics, { lowercase: true }).join(' ');
  const description = normalizeString(record.description).toLowerCase();
  let matches = 0;
  terms.forEach((term) => {
    if (title.includes(term)) matches += 5;
    if (topics.includes(term)) matches += 4;
    if (categories.includes(term)) matches += 3;
    if (tags.includes(term)) matches += 3;
    if (creator.includes(term)) matches += 3;
    if (description.includes(term)) matches += 1;
  });
  return Math.min(1, matches / Math.max(5, terms.length * 5));
}

function normalizeRelativeScore(value, maximum) {
  return maximum > 0 ? clamp(value / maximum, 0, 1) : 0;
}

function formatGalleryResult(record, score = null, reason = null) {
  return {
    id: record.publicationId,
    publicationId: record.publicationId,
    sessionId: record.sessionId || null,
    videoUrl: record.videoUrl,
    posterUrl: record.posterUrl || undefined,
    title: record.title,
    description: record.description || '',
    originalPrompt: record.originalPrompt || undefined,
    creatorHandle: record.creatorHandle || undefined,
    createdBy: record.createdBy || null,
    tags: record.tags || [],
    categories: record.categories || [],
    topics: record.topics || [],
    aspectRatio: record.aspectRatio || null,
    createdAt: record.sourceCreatedAt || null,
    stats: {
      likes: Number(record.metrics?.likes) || 0,
      comments: Number(record.metrics?.comments) || 0,
      shares: Number(record.metrics?.shares) || 0,
      views: Number(record.metrics?.views) || 0,
    },
    viewerHasLiked: false,
    score,
    recommendationReason: reason,
  };
}

export async function searchGalleryPublications({ query, limit = 24, format = null } = {}) {
  const normalizedQuery = normalizeString(query);
  const resolvedLimit = Math.max(1, Math.min(50, Number(limit) || 24));
  const normalizedFormat = ['landscape', 'portrait', 'square'].includes(format) ? format : null;
  const { GalleryPublication } = await getGalleryModels();
  await ensureGalleryIndexes();

  if (!normalizedQuery) {
    const popular = await GalleryPublication.find({
      available: true,
      ...(normalizedFormat ? { format: normalizedFormat } : {}),
    })
      .sort({ trendingScore: -1, popularityScore: -1, sourceCreatedAt: -1 })
      .limit(resolvedLimit)
      .lean();
    return { query: '', items: popular.map((record) => formatGalleryResult(record)), total: popular.length };
  }

  let semantic = [];
  try {
    const [queryVector] = await createEmbeddings([normalizedQuery]);
    semantic = await vectorCandidates(queryVector, resolvedLimit * 6);
  } catch (error) {
    console.warn('[gallery] semantic search unavailable; using lexical ranking:', error?.message || error);
  }

  const escapedTerms = normalizedQuery
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 8)
    .map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const lexical = escapedTerms.length
    ? await GalleryPublication.find({
        available: true,
        ...(normalizedFormat ? { format: normalizedFormat } : {}),
        $or: escapedTerms.map((term) => ({ searchText: { $regex: term, $options: 'i' } })),
      })
        .sort({ popularityScore: -1 })
        .limit(resolvedLimit * 4)
        .lean()
    : [];
  const candidates = new Map();
  [...semantic, ...lexical].forEach((record) => {
    if (!record?.publicationId || (normalizedFormat && record.format !== normalizedFormat)) return;
    const existing = candidates.get(record.publicationId);
    candidates.set(record.publicationId, {
      ...(existing || {}),
      ...record,
      similarityScore: Math.max(existing?.similarityScore || 0, record.similarityScore || 0),
    });
  });
  const values = Array.from(candidates.values());
  const maxPopularity = Math.max(1, ...values.map((record) => record.popularityScore || 0));
  const maxTrending = Math.max(1, ...values.map((record) => record.trendingScore || 0));
  const ranked = values
    .map((record) => {
      const semanticScore = clamp(record.similarityScore, 0, 1);
      const lexicalScore = keywordScore(record, normalizedQuery);
      const popularity = normalizeRelativeScore(record.popularityScore || 0, maxPopularity);
      const trending = normalizeRelativeScore(record.trendingScore || 0, maxTrending);
      const score = semanticScore * 0.62 + lexicalScore * 0.22 + popularity * 0.1 + trending * 0.06;
      return { record, score };
    })
    .sort((left, right) => right.score - left.score)
    .slice(0, resolvedLimit);

  return {
    query: normalizedQuery,
    items: ranked.map(({ record, score }) => formatGalleryResult(record, score, 'search_match')),
    total: ranked.length,
  };
}

function weightedAverageVectors(weightedVectors) {
  const valid = weightedVectors.filter(
    (entry) => Array.isArray(entry.vector) && entry.vector.length > 0 && entry.weight > 0,
  );
  if (valid.length === 0) return null;
  const dimensions = valid[0].vector.length;
  const result = new Array(dimensions).fill(0);
  let totalWeight = 0;
  valid.forEach(({ vector, weight }) => {
    if (vector.length !== dimensions) return;
    totalWeight += weight;
    for (let index = 0; index < dimensions; index += 1) {
      result[index] += vector[index] * weight;
    }
  });
  return totalWeight > 0 ? result.map((value) => value / totalWeight) : null;
}

async function computeGalleryRecommendations({
  viewerId = null,
  publicationId = null,
  limit = 16,
  format = null,
  excludeIds = [],
} = {}) {
  const resolvedLimit = Math.max(1, Math.min(40, Number(limit) || 16));
  const normalizedFormat = ['landscape', 'portrait', 'square'].includes(format) ? format : null;
  const { GalleryPublication, GalleryWatchHistory } = await getGalleryModels();
  await ensureGalleryIndexes();

  const current = publicationId
    ? await GalleryPublication.findOne({ publicationId, available: true }).lean()
    : null;
  const histories = viewerId
    ? await GalleryWatchHistory.find({ viewerId })
        .sort({ lastViewedAt: -1 })
        .limit(40)
        .lean()
    : [];
  const watchedIds = histories.map((history) => history.publicationId);
  const watchedRecords = watchedIds.length
    ? await GalleryPublication.find(
        { publicationId: { $in: watchedIds }, available: true, 'embedding.0': { $exists: true } },
        { publicationId: 1, embedding: 1 },
      ).lean()
    : [];
  const watchedEmbeddingMap = new Map(
    watchedRecords.map((record) => [record.publicationId, record.embedding]),
  );
  const now = Date.now();
  const preferenceVector = weightedAverageVectors(
    histories.map((history) => {
      const ageDays = Math.max(0, (now - new Date(history.lastViewedAt).getTime()) / 86400000);
      return {
        vector: watchedEmbeddingMap.get(history.publicationId),
        weight:
          (0.35 + clamp(history.completionRate, 0, 1) * 0.65) *
          Math.exp(-ageDays / 45),
      };
    }),
  );
  const recommendationVector = weightedAverageVectors([
    ...(preferenceVector ? [{ vector: preferenceVector, weight: current ? 0.55 : 1 }] : []),
    ...(Array.isArray(current?.embedding) && current.embedding.length > 0
      ? [{ vector: current.embedding, weight: preferenceVector ? 0.45 : 1 }]
      : []),
  ]);

  let candidates = recommendationVector
    ? await vectorCandidates(recommendationVector, resolvedLimit * 8)
    : await GalleryPublication.find({ available: true })
        .sort({ trendingScore: -1, popularityScore: -1 })
        .limit(resolvedLimit * 8)
        .lean();
  const excluded = new Set([
    ...excludeIds.filter((id) => typeof id === 'string'),
    ...(publicationId ? [publicationId] : []),
  ]);
  const recentlyWatched = new Set(histories.slice(0, 12).map((history) => history.publicationId));
  candidates = candidates.filter(
    (record) =>
      record?.publicationId &&
      !excluded.has(record.publicationId) &&
      (!normalizedFormat || record.format === normalizedFormat),
  );
  let usedPopularityFallback = !recommendationVector;
  if (candidates.length < resolvedLimit) {
    const existingCandidateIds = new Set(candidates.map((record) => record.publicationId));
    const popularCandidates = await GalleryPublication.find({
      available: true,
      ...(normalizedFormat ? { format: normalizedFormat } : {}),
    })
      .sort({ trendingScore: -1, popularityScore: -1, sourceCreatedAt: -1 })
      .limit(Math.max(resolvedLimit * 16, 100))
      .lean();

    const fallbackCandidates = popularCandidates.filter(
      (record) =>
        record?.publicationId &&
        !excluded.has(record.publicationId) &&
        !existingCandidateIds.has(record.publicationId),
    );
    if (fallbackCandidates.length > 0) {
      usedPopularityFallback = true;
      candidates = [
        ...candidates,
        ...fallbackCandidates.slice(0, Math.max(0, resolvedLimit * 8 - candidates.length)),
      ];
    }
  }
  const maxPopularity = Math.max(1, ...candidates.map((record) => record.popularityScore || 0));
  const maxTrending = Math.max(1, ...candidates.map((record) => record.trendingScore || 0));
  const creatorCounts = new Map();
  const ranked = candidates
    .map((record) => {
      const semantic = clamp(record.similarityScore, 0, 1);
      const popularity = normalizeRelativeScore(record.popularityScore || 0, maxPopularity);
      const trending = normalizeRelativeScore(record.trendingScore || 0, maxTrending);
      const quality = clamp(record.qualityScore, 0, 1);
      const watchedPenalty = recentlyWatched.has(record.publicationId) ? 0.2 : 0;
      return {
        record,
        score: semantic * 0.66 + popularity * 0.14 + trending * 0.12 + quality * 0.08 - watchedPenalty,
      };
    })
    .sort((left, right) => right.score - left.score);
  const diversified = [];
  for (const candidate of ranked) {
    const creator = normalizeString(candidate.record.creatorHandle, 'unknown');
    const creatorCount = creatorCounts.get(creator) || 0;
    if (creatorCount >= 2 && diversified.length < resolvedLimit / 2) continue;
    creatorCounts.set(creator, creatorCount + 1);
    diversified.push(candidate);
    if (diversified.length >= resolvedLimit) break;
  }

  const reason = current && !usedPopularityFallback
    ? 'similar_to_current'
    : histories.length > 0
      ? 'based_on_watch_history'
      : 'popular_now';
  return {
    items: diversified.map(({ record, score }) => formatGalleryResult(record, score, reason)),
    reason,
    personalized: histories.length > 0,
  };
}

function normalizeRecommendationCacheOptions({
  viewerId = null,
  publicationId = null,
  limit = 16,
  format = null,
  excludeIds = [],
} = {}) {
  const normalizedExcludeIds = Array.from(
    new Set(
      (Array.isArray(excludeIds) ? excludeIds : [])
        .filter((id) => typeof id === 'string' && id.trim())
        .map((id) => id.trim()),
    ),
  ).sort();

  return {
    viewerId: normalizeString(viewerId) || null,
    publicationId: normalizeString(publicationId) || null,
    limit: Math.max(1, Math.min(40, Number(limit) || 16)),
    format: ['landscape', 'portrait', 'square'].includes(format) ? format : null,
    excludeIds: normalizedExcludeIds,
  };
}

function recommendationCacheKey(options) {
  return createFingerprint(
    JSON.stringify({
      version: GALLERY_RECOMMENDATION_CACHE_VERSION,
      publicationId: options.publicationId,
      viewerId: options.viewerId,
      limit: options.limit,
      format: options.format,
      excludeIds: options.excludeIds,
    }),
  );
}

async function readCachedGalleryRecommendations(cacheKey) {
  const { GalleryPublication, GalleryRecommendationCache } = await getGalleryModels();
  const cache = await GalleryRecommendationCache.findOne({
    cacheKey,
    expiresAt: { $gt: new Date() },
  }).lean();
  if (!cache || !Array.isArray(cache.items) || cache.items.length === 0) return null;

  const publicationIds = cache.items
    .map((item) => item?.publicationId)
    .filter((id) => typeof id === 'string' && id.length > 0);
  if (publicationIds.length === 0) return null;

  const records = await GalleryPublication.find({
    publicationId: { $in: publicationIds },
    available: true,
  }).lean();
  const recordsById = new Map(records.map((record) => [record.publicationId, record]));
  const items = cache.items
    .map((item) => {
      const record = recordsById.get(item?.publicationId);
      if (!record) return null;
      const score = Number.isFinite(Number(item.score)) ? Number(item.score) : null;
      return formatGalleryResult(record, score, cache.reason || 'similar_to_current');
    })
    .filter(Boolean);

  return items.length > 0
    ? {
        items,
        reason: cache.reason || 'similar_to_current',
        personalized: Boolean(cache.personalized),
      }
    : null;
}

async function writeCachedGalleryRecommendations(cacheKey, options, response) {
  const { GalleryRecommendationCache } = await getGalleryModels();
  const items = response.items
    .map((item) => ({
      publicationId: item.publicationId || item.id,
      score: Number.isFinite(Number(item.score)) ? Number(item.score) : null,
    }))
    .filter((item) => typeof item.publicationId === 'string' && item.publicationId.length > 0);
  if (items.length === 0) return;

  try {
    await GalleryRecommendationCache.updateOne(
      { cacheKey },
      {
        $set: {
          cacheKey,
          publicationId: options.publicationId,
          viewerId: options.viewerId,
          format: options.format,
          limit: options.limit,
          excludeIds: options.excludeIds,
          items,
          reason: response.reason || 'similar_to_current',
          personalized: Boolean(response.personalized),
          expiresAt: new Date(Date.now() + GALLERY_RECOMMENDATION_CACHE_TTL_MS),
        },
      },
      { upsert: true },
    );
  } catch (error) {
    // A cache write must never turn an otherwise valid recommendation response into an error.
    console.warn('[gallery] recommendation cache write failed:', error?.message || error);
  }
}

export async function getGalleryRecommendations(options = {}) {
  const normalizedOptions = normalizeRecommendationCacheOptions(options);
  if (!normalizedOptions.publicationId) {
    return computeGalleryRecommendations(normalizedOptions);
  }

  const cacheKey = recommendationCacheKey(normalizedOptions);
  await ensureGalleryIndexes();
  let cached = null;
  try {
    cached = await readCachedGalleryRecommendations(cacheKey);
  } catch (error) {
    // A cache read failure should fall through to the live recommendation path.
    console.warn('[gallery] recommendation cache read failed:', error?.message || error);
  }
  if (cached) return cached;

  const activeRequest = recommendationInFlight.get(cacheKey);
  if (activeRequest) return activeRequest;

  const request = (async () => {
    const response = await computeGalleryRecommendations(normalizedOptions);
    await writeCachedGalleryRecommendations(cacheKey, normalizedOptions, response);
    return response;
  })();
  recommendationInFlight.set(cacheKey, request);
  try {
    return await request;
  } finally {
    recommendationInFlight.delete(cacheKey);
  }
}

export async function recordGalleryView({
  publicationId,
  viewerId,
  eventType = 'view',
  watchTimeMs = 0,
  durationMs = 0,
  source = 'gallery',
  metadata = {},
} = {}) {
  const normalizedPublicationId = normalizeString(publicationId);
  const normalizedViewerId = normalizeString(viewerId);
  if (!normalizedPublicationId || !normalizedViewerId) {
    const error = new Error('publication_id and viewer_id are required.');
    error.statusCode = 400;
    throw error;
  }
  if (!mongoose.Types.ObjectId.isValid(normalizedPublicationId)) {
    const error = new Error('publication_id must be a valid publication ID.');
    error.statusCode = 400;
    throw error;
  }

  await getDBConnectionString();
  const { GalleryPublication, GalleryWatchHistory } = await getGalleryModels();
  const publication = await Publication.findOne({
    _id: normalizedPublicationId,
    $and: [
      { $or: [{ isHidden: { $exists: false } }, { isHidden: false }] },
      { $or: [{ isDeleted: { $exists: false } }, { isDeleted: false }] },
    ],
  }).lean();
  if (!publication) {
    const error = new Error('Publication not found.');
    error.statusCode = 404;
    throw error;
  }

  const now = new Date();
  const currentHistory = await GalleryWatchHistory.findOne({
    viewerId: normalizedViewerId,
    publicationId: normalizedPublicationId,
  }).lean();
  const normalizedWatchTime = clamp(watchTimeMs, 0, MAX_WATCH_TIME_MS);
  const normalizedDuration = clamp(durationMs, 0, MAX_WATCH_TIME_MS);
  const completionRate = normalizedDuration > 0
    ? clamp(normalizedWatchTime / normalizedDuration, 0, 1)
    : eventType === 'complete'
      ? 1
      : 0;
  const shouldCountView =
    !currentHistory?.lastCountedAt ||
    now.getTime() - new Date(currentHistory.lastCountedAt).getTime() >= VIEW_DEDUPE_MS;
  const isUniqueView = !currentHistory;
  const previousWatchTime = Math.max(0, Number(currentHistory?.watchTimeMs) || 0);
  const watchTimeDelta = Math.max(0, normalizedWatchTime - previousWatchTime);
  const isNewCompletion =
    completionRate >= 0.9 && (Number(currentHistory?.completionRate) || 0) < 0.9;
  const tags = normalizeTags(publication.tags);
  const categories = normalizeStringList(publication.categories, { limit: 3 });
  const topics = normalizeStringList(publication.topics, { lowercase: true, limit: 8 });
  const format = normalizeAspectFormat(publication.aspectRatio);

  await GalleryWatchHistory.findOneAndUpdate(
    { viewerId: normalizedViewerId, publicationId: normalizedPublicationId },
    {
      $set: {
        watchTimeMs: Math.max(previousWatchTime, normalizedWatchTime),
        durationMs: Math.max(Number(currentHistory?.durationMs) || 0, normalizedDuration),
        completionRate: Math.max(Number(currentHistory?.completionRate) || 0, completionRate),
        lastViewedAt: now,
        tags,
        categories,
        topics,
        creatorHandle: normalizeString(publication.creatorHandle) || null,
        format,
        source: normalizeString(source, 'gallery'),
        metadata: metadata && typeof metadata === 'object' ? metadata : {},
        ...(shouldCountView ? { lastCountedAt: now } : {}),
      },
      $setOnInsert: { firstViewedAt: now },
      $inc: {
        viewCount: shouldCountView ? 1 : 0,
        completedCount: isNewCompletion ? 1 : 0,
      },
    },
    { upsert: true, new: true },
  );

  const updatedPublication = await Publication.findByIdAndUpdate(
    normalizedPublicationId,
    {
      $inc: {
        'views.total': shouldCountView ? 1 : 0,
        'views.unique': isUniqueView ? 1 : 0,
        'views.completed': isNewCompletion ? 1 : 0,
        'views.watchTimeMs': watchTimeDelta,
      },
      $set: {
        'views.lastViewedAt': now,
        'galleryMetadata.lastViewSource': normalizeString(source, 'gallery'),
        'galleryMetadata.lastViewEvent': normalizeString(eventType, 'view'),
      },
    },
    { new: true },
  );
  const totalViews = Math.max(1, Number(updatedPublication?.views?.total) || 1);
  const averageWatchTimeMs = (Number(updatedPublication?.views?.watchTimeMs) || 0) / totalViews;
  const averageCompletionRate = normalizedDuration > 0
    ? clamp(
        ((Number(updatedPublication?.views?.averageCompletionRate) || 0) * (totalViews - 1) + completionRate) /
          totalViews,
        0,
        1,
      )
    : Number(updatedPublication?.views?.averageCompletionRate) || 0;
  updatedPublication.views.averageWatchTimeMs = averageWatchTimeMs;
  updatedPublication.views.averageCompletionRate = averageCompletionRate;
  const metrics = publicationMetrics(updatedPublication);
  const scores = calculateEngagementScores({
    metrics,
    createdAt: updatedPublication.createdAt,
    updatedAt: now,
  });
  if (!updatedPublication.recommendation) updatedPublication.recommendation = {};
  updatedPublication.recommendation.popularityScore = scores.popularityScore;
  updatedPublication.recommendation.trendingScore = scores.trendingScore;
  updatedPublication.recommendation.qualityScore = scores.qualityScore;
  await updatedPublication.save();

  await GalleryPublication.findOneAndUpdate(
    { publicationId: normalizedPublicationId },
    {
      $set: {
        metrics,
        ...scores,
        lastEngagementAt: now,
        sourceUpdatedAt: updatedPublication.updatedAt,
      },
    },
  );

  return {
    recorded: true,
    countedView: shouldCountView,
    uniqueView: isUniqueView,
    completed: isNewCompletion,
    stats: {
      views: metrics.views,
      uniqueViews: metrics.uniqueViews,
      completedViews: metrics.completedViews,
      averageWatchTimeMs,
      averageCompletionRate,
    },
  };
}

export async function getGallerySyncStatus() {
  const { GalleryPublication, GallerySyncState } = await getGalleryModels();
  const [state, indexedPublications] = await Promise.all([
    GallerySyncState.findOne({ key: 'publication_embeddings' }).lean(),
    GalleryPublication.countDocuments({ available: true, 'embedding.0': { $exists: true } }),
  ]);
  const lastUpdatedAt = safeDate(state?.lastUpdatedAt || state?.lastSuccessfulAt);
  const nextUpdateAt = lastUpdatedAt
    ? new Date(lastUpdatedAt.getTime() + GALLERY_EMBEDDING_REFRESH_MS)
    : null;
  return {
    database: GALLERY_DATABASE_NAME,
    embeddingModel: EMBEDDING_MODEL,
    embeddingVersion: EMBEDDING_VERSION,
    indexedPublications,
    stale: !lastUpdatedAt || Date.now() >= nextUpdateAt.getTime(),
    refreshIntervalMs: GALLERY_EMBEDDING_REFRESH_MS,
    lastUpdatedAt,
    nextUpdateAt,
    state: state || null,
  };
}
