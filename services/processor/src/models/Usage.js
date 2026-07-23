import { getDBConnectionString } from './DBString.js';
import GenerationCreditTransaction from '../schema/GenerationCreditTransaction.js';
import ProviderUsageLog from '../schema/ProviderUsageLog.js';
import mongoose from 'mongoose';
import { shouldDefaultProviderUsageAuditEnabled } from '../utils/EnvironmentUtils.js';

const API_USAGE_SOURCES = [
  'chat_enhance',
  'embedding_create',
  'embedding_update',
  'embedding_search',
  'embedding_similar',
  'image_update_set',
  'image_remove_branding',
  'image_enhance',
  'image_list_to_video',
  'text_to_video',
];

const EXPRESS_VIDEO_STAGE_SOURCE_PREFIX = 'express_video_stage_';
const EXPRESS_VIDEO_STAGE_ORDER = [
  'narrative_inference',
  'image_generation',
  'speech_generation',
  'music_generation',
  'ai_video_generation',
  'lip_sync_generation',
  'sound_effect_generation',
  'narrator_avatar_generation',
  'pipeline',
];

function normalizeString(value) {
  if (value === null || value === undefined) {
    return '';
  }
  return String(value).trim();
}

function isDockerUsageMode() {
  const explicit = normalizeString(process.env.SAMSAR_PROVIDER_USAGE_AUDIT_ENABLED).toLowerCase();
  if (['0', 'false', 'no', 'off'].includes(explicit)) {
    return false;
  }
  if (['1', 'true', 'yes', 'on'].includes(explicit)) {
    return true;
  }
  return shouldDefaultProviderUsageAuditEnabled();
}

function normalizePaging({ page = 1, pageSize = 25 } = {}) {
  const parsedPage = Number.parseInt(page, 10);
  const parsedPageSize = Number.parseInt(pageSize, 10);

  const safePage = Number.isNaN(parsedPage) || parsedPage < 1 ? 1 : parsedPage;
  const boundedPageSize = Number.isNaN(parsedPageSize) || parsedPageSize < 1 ? 25 : Math.min(parsedPageSize, 100);
  const skip = (safePage - 1) * boundedPageSize;

  return {
    safePage,
    boundedPageSize,
    skip,
  };
}

function toMongoObjectId(value) {
  const normalized = value?.toString?.();
  return normalized && mongoose.Types.ObjectId.isValid(normalized)
    ? new mongoose.Types.ObjectId(normalized)
    : value;
}

function normalizeCredits(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
}

function getStageOrder(stageKey) {
  const index = EXPRESS_VIDEO_STAGE_ORDER.indexOf(normalizeString(stageKey));
  return index === -1 ? EXPRESS_VIDEO_STAGE_ORDER.length : index;
}

function resolveExpressTaskSource(metadata = {}) {
  const expressGenerationType = normalizeString(metadata.expressGenerationType).toUpperCase();
  if (expressGenerationType === 'IMAGE_LIST_TO_VIDEO') {
    return 'image_list_to_video';
  }
  if (expressGenerationType === 'TEXT_TO_VIDEO') {
    return 'text_to_video';
  }

  const routeType = normalizeString(
    metadata.routeType ||
    metadata.builderRouteType ||
    metadata.sessionSubType ||
    metadata.creditSource
  ).toLowerCase();

  if (routeType === 'image_list_to_video') {
    return 'image_list_to_video';
  }
  return 'text_to_video';
}

function normalizeCreditTransaction(tx = {}) {
  const metadata = tx.metadata && typeof tx.metadata === 'object' ? tx.metadata : {};
  return {
    id: tx._id?.toString?.() || tx.id?.toString?.(),
    source: tx.source || 'unknown',
    credits: normalizeCredits(tx.amount ?? metadata.creditsCharged),
    balanceAfter: tx.balanceAfter ?? null,
    metadata,
    direction: tx.direction,
    createdAt: tx.createdAt,
    updatedAt: tx.updatedAt,
  };
}

function normalizeExpressStageTransaction(tx = {}) {
  const normalized = normalizeCreditTransaction(tx);
  const metadata = normalized.metadata || {};
  return {
    ...normalized,
    source: tx.source || `${EXPRESS_VIDEO_STAGE_SOURCE_PREFIX}${metadata.stageKey || 'unknown'}`,
    requestType: metadata.stageKey || normalized.source,
    callType: metadata.stageKey || normalized.source,
    groupType: 'express_video_stage',
  };
}

function normalizeHostedUsageGroup(group = {}) {
  const transactions = Array.isArray(group.transactions) ? group.transactions : [];
  const isExpressGroup = Boolean(group.isExpressStageGroup);
  if (!isExpressGroup) {
    return normalizeCreditTransaction(transactions[0] || {});
  }

  const subRows = transactions
    .map(normalizeExpressStageTransaction)
    .sort((left, right) => {
      const stageDelta = getStageOrder(left.metadata?.stageKey) - getStageOrder(right.metadata?.stageKey);
      if (stageDelta !== 0) return stageDelta;
      return new Date(left.createdAt || 0) - new Date(right.createdAt || 0);
    });

  const latestTransaction = [...subRows].sort(
    (left, right) => new Date(right.createdAt || 0) - new Date(left.createdAt || 0)
  )[0] || {};
  const firstMetadata = subRows.find((row) => row.metadata?.expressGenerationType || row.metadata?.routeType)?.metadata ||
    subRows[0]?.metadata ||
    {};
  const source = resolveExpressTaskSource(firstMetadata);
  const totalCredits = normalizeCredits(
    group.totalCredits ??
    subRows.reduce((sum, row) => sum + normalizeCredits(row.credits), 0)
  );
  const durationSeconds = subRows.find((row) => Number.isFinite(Number(row.metadata?.durationSeconds)))
    ?.metadata?.durationSeconds;

  return {
    id: group._id?.toString?.() || `express:${firstMetadata.sessionId || latestTransaction.id || Date.now()}`,
    source,
    credits: totalCredits,
    balanceAfter: latestTransaction.balanceAfter ?? null,
    metadata: {
      ...firstMetadata,
      sessionId: firstMetadata.sessionId || subRows[0]?.metadata?.sessionId || null,
      requestType: 'API',
      expressUsageGroup: true,
      expressGenerationType: firstMetadata.expressGenerationType || (source === 'image_list_to_video' ? 'IMAGE_LIST_TO_VIDEO' : 'TEXT_TO_VIDEO'),
      stageCount: subRows.length,
      totalCredits,
      ...(durationSeconds !== undefined ? { durationSeconds } : {}),
      distribution: subRows.map((row) => ({
        source: row.source,
        stageKey: row.metadata?.stageKey || null,
        stageLabel: row.metadata?.stageLabel || row.metadata?.stageKey || row.source,
        credits: normalizeCredits(row.credits),
        creditsPerSecond: row.metadata?.creditsPerSecond ?? null,
        durationSeconds: row.metadata?.durationSeconds ?? null,
      })),
    },
    direction: 'debit',
    createdAt: group.latestCreatedAt || latestTransaction.createdAt,
    updatedAt: latestTransaction.updatedAt,
    groupType: 'express_video',
    subRows,
  };
}

async function getUserProviderUsageLogs(userId, options = {}) {
  const { safePage, boundedPageSize, skip } = normalizePaging(options);

  await getDBConnectionString();

  const usageQuery = {
    userId: normalizeString(userId),
  };

  const [items, totalItems] = await Promise.all([
    ProviderUsageLog.find(usageQuery)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(boundedPageSize)
      .lean(),
    ProviderUsageLog.countDocuments(usageQuery),
  ]);

  const totalPages = boundedPageSize === 0 ? 0 : Math.ceil(totalItems / boundedPageSize);

  const normalizedItems = items.map((item) => ({
    id: item._id?.toString(),
    source: item.requestType || item.callType || item.source || 'unknown',
    credits: 0,
    balanceAfter: null,
    provider: item.provider || null,
    authorizationProvider: item.authorizationProvider || item.provider || null,
    requestType: item.requestType || null,
    callType: item.callType || null,
    jobType: item.jobType || null,
    model: item.model || null,
    status: item.status || null,
    service: item.service || null,
    sessionId: item.sessionId || null,
    layerId: item.layerId || null,
    audioLayerId: item.audioLayerId || null,
    localRequestId: item.localRequestId || null,
    providerRequestId: item.providerRequestId || null,
    metadata: {
      ...(item.metadata || {}),
      provider: item.provider || null,
      authorizationProvider: item.authorizationProvider || item.provider || null,
      requestType: item.requestType || item.callType || null,
      callType: item.callType || item.requestType || null,
      jobType: item.jobType || null,
      model: item.model || null,
      status: item.status || null,
      service: item.service || null,
      sessionId: item.sessionId || null,
      layerId: item.layerId || null,
      audioLayerId: item.audioLayerId || null,
    },
    direction: 'audit',
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  }));

  return {
    items: normalizedItems,
    pagination: {
      page: safePage,
      pageSize: boundedPageSize,
      totalItems,
      totalPages,
      hasNextPage: safePage < totalPages,
      hasPreviousPage: safePage > 1,
    },
  };
}

async function getUserHostedUsageLogs(userId, options = {}) {
  const { safePage, boundedPageSize, skip } = normalizePaging(options);

  await getDBConnectionString();

  const usageQuery = {
    userId: toMongoObjectId(userId),
    direction: 'debit',
    $or: [
      { 'metadata.requestType': 'API' },
      {
        $and: [
          { source: { $in: API_USAGE_SOURCES } },
          {
            $or: [
              { 'metadata.requestType': { $exists: false } },
              { 'metadata.requestType': null },
            ],
          },
        ],
      },
      { source: { $regex: `^${EXPRESS_VIDEO_STAGE_SOURCE_PREFIX}` } },
    ],
  };

  const expressionPipeline = [
    { $match: usageQuery },
    {
      $addFields: {
        isExpressStage: {
          $regexMatch: {
            input: { $ifNull: ['$source', ''] },
            regex: `^${EXPRESS_VIDEO_STAGE_SOURCE_PREFIX}`,
          },
        },
        expressSessionId: { $ifNull: ['$metadata.sessionId', ''] },
      },
    },
    {
      $addFields: {
        usageGroupKey: {
          $cond: [
            {
              $and: [
                '$isExpressStage',
                { $ne: ['$expressSessionId', ''] },
              ],
            },
            { $concat: ['express:', { $toString: '$expressSessionId' }] },
            { $concat: ['tx:', { $toString: '$_id' }] },
          ],
        },
      },
    },
    { $sort: { createdAt: 1 } },
    {
      $group: {
        _id: '$usageGroupKey',
        isExpressStageGroup: { $max: { $cond: ['$isExpressStage', 1, 0] } },
        latestCreatedAt: { $max: '$createdAt' },
        totalCredits: { $sum: '$amount' },
        transactions: {
          $push: {
            _id: '$_id',
            source: '$source',
            amount: '$amount',
            direction: '$direction',
            metadata: '$metadata',
            balanceAfter: '$balanceAfter',
            createdAt: '$createdAt',
            updatedAt: '$updatedAt',
          },
        },
      },
    },
  ];

  const [items, totalResult] = await Promise.all([
    GenerationCreditTransaction.aggregate([
      ...expressionPipeline,
      { $sort: { latestCreatedAt: -1, _id: -1 } },
      { $skip: skip },
      { $limit: boundedPageSize },
    ]),
    GenerationCreditTransaction.aggregate([
      ...expressionPipeline,
      { $count: 'totalItems' },
    ]),
  ]);

  const totalItems = totalResult?.[0]?.totalItems || 0;
  const totalPages = boundedPageSize === 0 ? 0 : Math.ceil(totalItems / boundedPageSize);

  return {
    items: items.map(normalizeHostedUsageGroup),
    pagination: {
      page: safePage,
      pageSize: boundedPageSize,
      totalItems,
      totalPages,
      hasNextPage: safePage < totalPages,
      hasPreviousPage: safePage > 1,
    },
  };
}

/**
 * Fetch paginated API usage logs for a user.
 * Filters for debit transactions tied to API calls so we can display
 * what was charged and when.
 */
export async function getUserUsageLogs(userId, options = {}) {
  if (!userId) {
    throw new Error('userId is required to fetch usage logs');
  }

  if (isDockerUsageMode()) {
    return getUserProviderUsageLogs(userId, options);
  }

  return getUserHostedUsageLogs(userId, options);
}

export { API_USAGE_SOURCES };
