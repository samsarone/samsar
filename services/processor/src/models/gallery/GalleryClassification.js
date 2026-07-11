import OpenAI from 'openai';
import mongoose from 'mongoose';
import { z } from 'zod';
import { zodResponseFormat } from 'openai/helpers/zod';

import { PUBLICATION_METADATA_INFERENCE_SETTINGS } from '../../consts/InferenceModels.js';
import { Publication } from '../../schema/Publication.js';
import { normalizePublicationTranscript } from '../publication/Transcript.js';
import { createCompatibleChatCompletion } from '../ai_utils/OpenAICompat.js';
import { getGalleryModels, getGalleryVectorIndexName } from './GalleryDatabase.js';
import { syncGalleryTaxonomyMembership } from './GalleryTaxonomy.js';

export const GALLERY_CLASSIFICATION_VERSION = 'gallery-classification-v1';
export const GALLERY_CLASSIFICATION_MAX_AGE_MS = 24 * 60 * 60 * 1000;
export const GALLERY_CLASSIFICATION_INFERENCE_SETTINGS =
  PUBLICATION_METADATA_INFERENCE_SETTINGS;

export const GALLERY_CATEGORIES = Object.freeze([
  'Arts & Design',
  'Business & Finance',
  'Comedy',
  'DIY & Crafts',
  'Education',
  'Film & Animation',
  'Food & Cooking',
  'Gaming',
  'Health & Fitness',
  'History',
  'Lifestyle',
  'Music',
  'Nature & Environment',
  'News & Politics',
  'Science & Technology',
  'Society & Culture',
  'Sports',
  'Travel',
]);

const MAX_CATEGORIES_PER_PUBLICATION = 3;
const MAX_TOPICS_PER_PUBLICATION = 8;
const MAX_NEW_TOPICS_PER_PUBLICATION = 2;
const MAX_SIMILAR_ITEMS_IN_PROMPT = 12;
const MAX_CANDIDATE_TOPICS = 50;
const SIMILAR_ITEM_LIMIT = Math.max(
  1,
  Math.min(
    500,
    Number.parseInt(process.env.GALLERY_CLASSIFICATION_NEIGHBOUR_LIMIT || '100', 10) || 100,
  ),
);
const CLASSIFICATION_LEASE_MS = 10 * 60 * 1000;
const CLASSIFICATION_RETRY_MS = 60 * 60 * 1000;
const classificationQueue = [];
const classificationQueued = new Set();
let classificationWorkerActive = false;

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY || '' });

const ClassificationResponse = z.object({
  categories: z.array(z.enum(GALLERY_CATEGORIES)).min(1).max(MAX_CATEGORIES_PER_PUBLICATION),
  existing_topics: z.array(z.string()).max(MAX_TOPICS_PER_PUBLICATION),
  new_topics: z.array(z.string()).max(MAX_NEW_TOPICS_PER_PUBLICATION),
});

const normalizeString = (value) =>
  typeof value === 'string' ? value.trim() : '';

const normalizeStringList = (value, limit = MAX_TOPICS_PER_PUBLICATION) =>
  Array.isArray(value)
    ? Array.from(new Set(value.map(normalizeString).filter(Boolean))).slice(0, limit)
    : [];

export const normalizeTopic = (value) =>
  normalizeString(value)
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}&+.'-]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const isValidTopicPhrase = (value) => {
  const normalized = normalizeTopic(value);
  const wordCount = normalized.split(' ').filter(Boolean).length;
  return normalized.length > 0 && normalized.length <= 80 && wordCount >= 1 && wordCount <= 5;
};

const topicTokens = (value) => new Set(
  normalizeTopic(value)
    .split(' ')
    .filter(Boolean)
    .map((token) => {
      if (token.length > 4 && token.endsWith('ies')) return `${token.slice(0, -3)}y`;
      if (token.length > 4 && token.endsWith('s') && !token.endsWith('ss')) return token.slice(0, -1);
      return token;
    })
);

const topicSimilarity = (left, right) => {
  const leftTokens = topicTokens(left);
  const rightTokens = topicTokens(right);
  if (leftTokens.size === 0 || rightTokens.size === 0) return 0;
  const intersection = Array.from(leftTokens).filter((token) => rightTokens.has(token)).length;
  const union = new Set([...leftTokens, ...rightTokens]).size;
  return union > 0 ? intersection / union : 0;
};

const cosineSimilarity = (left, right) => {
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
};

export function isGalleryClassificationStale(classification, now = new Date()) {
  if (classification?.version !== GALLERY_CLASSIFICATION_VERSION) return true;
  const lastUpdatedAt = classification?.lastUpdatedAt
    ? new Date(classification.lastUpdatedAt)
    : null;
  return !lastUpdatedAt || Number.isNaN(lastUpdatedAt.getTime()) ||
    now.getTime() - lastUpdatedAt.getTime() >= GALLERY_CLASSIFICATION_MAX_AGE_MS;
}

const similarProjection = {
  publicationId: 1,
  categories: 1,
  topics: 1,
  embedding: 1,
};

async function findSimilarClassificationItems(current, limit = SIMILAR_ITEM_LIMIT) {
  if (!Array.isArray(current?.embedding) || current.embedding.length === 0) return [];
  const { GalleryPublication } = await getGalleryModels();
  let records;

  // Classification similarity intentionally has no aspect-ratio/format filter.
  // Cross-format videos contribute to the same topic and category taxonomy.
  try {
    records = await GalleryPublication.aggregate([
      {
        $search: {
          cosmosSearch: {
            path: 'embedding',
            vector: current.embedding,
            k: limit + 1,
            filter: { available: { $eq: true } },
          },
        },
      },
      { $project: { ...similarProjection, similarityScore: { $meta: 'searchScore' } } },
    ]);
  } catch {
    try {
      records = await GalleryPublication.aggregate([
        {
          $vectorSearch: {
            index: getGalleryVectorIndexName(),
            queryVector: current.embedding,
            path: 'embedding',
            numCandidates: Math.max(100, limit * 8),
            limit: limit + 1,
            filter: { available: true },
          },
        },
        { $project: { ...similarProjection, similarityScore: { $meta: 'vectorSearchScore' } } },
      ]);
    } catch {
      const candidates = await GalleryPublication.find(
        { available: true, 'embedding.0': { $exists: true } },
        similarProjection,
      ).limit(2000).lean();
      records = candidates
        .map((record) => ({
          ...record,
          similarityScore: cosineSimilarity(current.embedding, record.embedding),
        }))
        .sort((left, right) => right.similarityScore - left.similarityScore)
        .slice(0, limit + 1);
    }
  }

  return records
    .filter((record) => record?.publicationId && record.publicationId !== current.publicationId)
    .slice(0, limit);
}

export function buildGalleryClassificationContext(current, similarItems = []) {
  const currentTopics = normalizeStringList(current?.topics)
    .map(normalizeTopic)
    .filter(isValidTopicPhrase);
  const currentCategories = normalizeStringList(
    current?.categories,
    MAX_CATEGORIES_PER_PUBLICATION,
  ).filter((category) => GALLERY_CATEGORIES.includes(category));
  const topicScores = new Map();
  const categoryScores = new Map();

  currentTopics.forEach((topic) => {
    topicScores.set(topic, { topic, score: 2, support: 1 });
  });
  currentCategories.forEach((category) => {
    categoryScores.set(category, { category, score: 2, support: 1 });
  });
  similarItems.forEach((item) => {
    const similarity = Math.max(0, Math.min(1, Number(item?.similarityScore) || 0));
    normalizeStringList(item?.topics).map(normalizeTopic).filter(isValidTopicPhrase).forEach((topic) => {
      const previous = topicScores.get(topic) || { topic, score: 0, support: 0 };
      previous.score += similarity;
      previous.support += 1;
      topicScores.set(topic, previous);
    });
    normalizeStringList(item?.categories, MAX_CATEGORIES_PER_PUBLICATION)
      .filter((category) => GALLERY_CATEGORIES.includes(category))
      .forEach((category) => {
        const previous = categoryScores.get(category) || { category, score: 0, support: 0 };
        previous.score += similarity;
        previous.support += 1;
        categoryScores.set(category, previous);
      });
  });

  const candidateExistingTopics = Array.from(topicScores.values())
    .sort((left, right) => right.score - left.score || right.support - left.support)
    .slice(0, MAX_CANDIDATE_TOPICS)
    .map((entry) => entry.topic);
  const candidateExistingCategories = Array.from(categoryScores.values())
    .sort((left, right) => right.score - left.score || right.support - left.support)
    .map((entry) => entry.category);
  const promptSimilarItems = similarItems
    .filter((item) =>
      normalizeStringList(item?.categories).length > 0 || normalizeStringList(item?.topics).length > 0
    )
    .slice(0, MAX_SIMILAR_ITEMS_IN_PROMPT)
    .map((item) => ({
      similarity: Number((Number(item.similarityScore) || 0).toFixed(4)),
      categories: normalizeStringList(item.categories, MAX_CATEGORIES_PER_PUBLICATION),
      topics: normalizeStringList(item.topics).map(normalizeTopic).filter(isValidTopicPhrase),
    }));

  return {
    canonical_categories: [...GALLERY_CATEGORIES],
    existing_classification: {
      categories: currentCategories,
      topics: currentTopics,
    },
    candidate_existing_categories: candidateExistingCategories,
    candidate_existing_topics: candidateExistingTopics,
    similar_items: promptSimilarItems,
  };
}

const findCanonicalTopic = (proposed, topics) => {
  const normalized = normalizeTopic(proposed);
  if (!normalized) return '';
  const exact = topics.find((topic) => normalizeTopic(topic) === normalized);
  if (exact) return normalizeTopic(exact);
  const close = topics.find((topic) => topicSimilarity(topic, normalized) >= 0.8);
  return close ? normalizeTopic(close) : '';
};

export function normalizeGalleryClassificationOutput(output, context, globalTopics = []) {
  const categories = normalizeStringList(
    output?.categories,
    MAX_CATEGORIES_PER_PUBLICATION,
  ).filter((category) => GALLERY_CATEGORIES.includes(category));
  const candidateTopics = normalizeStringList([
    ...(context?.candidate_existing_topics || []),
    ...(context?.existing_classification?.topics || []),
  ], MAX_CANDIDATE_TOPICS).map(normalizeTopic).filter(isValidTopicPhrase);
  const canonicalGlobalTopics = normalizeStringList(globalTopics, 10000)
    .map(normalizeTopic)
    .filter(isValidTopicPhrase);
  const existingTopics = normalizeStringList(output?.existing_topics)
    .map((topic) => findCanonicalTopic(topic, candidateTopics))
    .filter(Boolean);
  const newTopics = [];

  for (const proposed of normalizeStringList(output?.new_topics, MAX_NEW_TOPICS_PER_PUBLICATION)) {
    const existingMatch = findCanonicalTopic(proposed, [
      ...candidateTopics,
      ...canonicalGlobalTopics,
    ]);
    const topic = existingMatch || normalizeTopic(proposed);
    if (!topic || existingTopics.includes(topic) || newTopics.includes(topic)) continue;
    if (!isValidTopicPhrase(topic)) continue;
    newTopics.push(topic);
    if (newTopics.length >= MAX_NEW_TOPICS_PER_PUBLICATION) break;
  }

  return {
    categories,
    topics: Array.from(new Set([...existingTopics, ...newTopics])).slice(
      0,
      MAX_TOPICS_PER_PUBLICATION,
    ),
  };
}

export const buildGalleryClassificationMessages = (publication, context) => [
  {
    role: 'developer',
    content: [
      'You classify videos into a stable shared gallery taxonomy.',
      `Choose at most ${MAX_CATEGORIES_PER_PUBLICATION} categories and only from canonical_categories.`,
      'Categories are broad, top-level library sections.',
      'Prefer candidate_existing_categories when they accurately describe the publication.',
      `Choose at most ${MAX_TOPICS_PER_PUBLICATION} topics. Topics are short, reusable phrases of one to five words.`,
      'Reuse candidate_existing_topics whenever one reasonably represents the content, including a broader established grouping.',
      `Return a topic in new_topics only when no candidate existing topic represents an important concept. Return at most ${MAX_NEW_TOPICS_PER_PUBLICATION} new topics.`,
      'Do not invent synonyms or more specific variants when an existing topic is suitable.',
      'Return at least one category and at least one topic in total across existing_topics and new_topics.',
      'Use the original prompt and transcript as the source of truth. Similar items provide taxonomy guidance, not factual content.',
    ].join(' '),
  },
  {
    role: 'user',
    content: JSON.stringify({
      publication: {
        original_prompt: normalizeString(publication.originalPrompt),
        session_transcript: normalizePublicationTranscript(publication.sessionTranscript),
      },
      ...context,
    }),
  },
];

async function generateGalleryClassification(publication, context) {
  const response = await createCompatibleChatCompletion(openai, {
    messages: buildGalleryClassificationMessages(publication, context),
    ...GALLERY_CLASSIFICATION_INFERENCE_SETTINGS,
    response_format: zodResponseFormat(ClassificationResponse, 'gallery_classification'),
  });
  return ClassificationResponse.parse(JSON.parse(response.choices[0].message.content));
}

const classificationClaimQuery = (now, force) => {
  if (force) {
    return {
      $or: [
        { 'classification.status': { $ne: 'running' } },
        { 'classification.leaseExpiresAt': { $lte: now } },
        { 'classification.leaseExpiresAt': null },
      ],
    };
  }
  const staleCutoff = new Date(now.getTime() - GALLERY_CLASSIFICATION_MAX_AGE_MS);
  const retryCutoff = new Date(now.getTime() - CLASSIFICATION_RETRY_MS);
  return {
    $and: [
      {
        $or: [
          { 'classification.version': { $ne: GALLERY_CLASSIFICATION_VERSION } },
          { 'classification.lastUpdatedAt': { $exists: false } },
          { 'classification.lastUpdatedAt': null },
          { 'classification.lastUpdatedAt': { $lte: staleCutoff } },
        ],
      },
      {
        $or: [
          { 'classification.lastAttemptAt': { $exists: false } },
          { 'classification.lastAttemptAt': null },
          { 'classification.lastAttemptAt': { $lte: retryCutoff } },
        ],
      },
      {
        $or: [
          { 'classification.status': { $ne: 'running' } },
          { 'classification.leaseExpiresAt': { $lte: now } },
          { 'classification.leaseExpiresAt': null },
        ],
      },
    ],
  };
};

export async function classifyGalleryPublication(publicationId, { force = false } = {}) {
  const normalizedPublicationId = normalizeString(publicationId);
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

  const { GalleryPublication } = await getGalleryModels();
  const current = await GalleryPublication.findOne({
    publicationId: normalizedPublicationId,
    available: true,
  }).lean();
  if (!current) return { status: 'skipped', reason: 'not_indexed' };
  if (!Array.isArray(current.embedding) || current.embedding.length === 0) {
    return { status: 'skipped', reason: 'embedding_unavailable' };
  }
  const hasTaxonomyAssignments =
    Array.isArray(current.categories) && current.categories.length > 0 &&
    Array.isArray(current.topics) && current.topics.length > 0;
  if (!force && hasTaxonomyAssignments && !isGalleryClassificationStale(current.classification)) {
    await syncGalleryTaxonomyMembership({
      publicationId: normalizedPublicationId,
      categories: current.categories,
      topics: current.topics,
    });
    return { status: 'skipped', reason: 'fresh' };
  }

  const now = new Date();
  const claimed = await GalleryPublication.findOneAndUpdate(
    {
      publicationId: normalizedPublicationId,
      available: true,
      ...classificationClaimQuery(now, force || !hasTaxonomyAssignments),
    },
    {
      $set: {
        'classification.version': GALLERY_CLASSIFICATION_VERSION,
        'classification.status': 'running',
        'classification.lastAttemptAt': now,
        'classification.leaseExpiresAt': new Date(now.getTime() + CLASSIFICATION_LEASE_MS),
        'classification.error': null,
      },
    },
    { new: true },
  ).lean();
  if (!claimed) return { status: 'skipped', reason: 'not_stale_or_already_running' };

  try {
    const publication = await Publication.findById(normalizedPublicationId).lean();
    if (!publication) throw new Error('Source publication not found.');
    const similarItems = await findSimilarClassificationItems(claimed);
    const context = buildGalleryClassificationContext(claimed, similarItems);
    const [generated, globalTopics] = await Promise.all([
      generateGalleryClassification(publication, context),
      GalleryPublication.distinct('topics', { available: true }),
    ]);
    const classification = normalizeGalleryClassificationOutput(
      generated,
      context,
      globalTopics,
    );
    if (classification.categories.length === 0 || classification.topics.length === 0) {
      throw new Error('Gallery classification must contain at least one category and one topic.');
    }
    const completedAt = new Date();
    const classificationState = {
      version: GALLERY_CLASSIFICATION_VERSION,
      status: 'complete',
      lastAttemptAt: now,
      lastUpdatedAt: completedAt,
      leaseExpiresAt: null,
      error: null,
    };

    await Promise.all([
      Publication.updateOne(
        { _id: normalizedPublicationId },
        {
          $set: {
            categories: classification.categories,
            topics: classification.topics,
            classification: classificationState,
          },
        },
      ),
      GalleryPublication.updateOne(
        { publicationId: normalizedPublicationId },
        {
          $set: {
            categories: classification.categories,
            topics: classification.topics,
            classification: classificationState,
          },
        },
      ),
      syncGalleryTaxonomyMembership({
        publicationId: normalizedPublicationId,
        previousCategories: claimed.categories,
        previousTopics: claimed.topics,
        categories: classification.categories,
        topics: classification.topics,
      }),
    ]);

    return {
      status: 'updated',
      publicationId: normalizedPublicationId,
      categories: classification.categories,
      topics: classification.topics,
      similarItemsConsidered: similarItems.length,
      classifiedAt: completedAt,
    };
  } catch (error) {
    const errorMessage = normalizeString(error?.message || String(error)).slice(0, 500);
    await Promise.all([
      Publication.updateOne(
        { _id: normalizedPublicationId },
        {
          $set: {
            'classification.version': GALLERY_CLASSIFICATION_VERSION,
            'classification.status': 'failed',
            'classification.lastAttemptAt': now,
            'classification.leaseExpiresAt': null,
            'classification.error': errorMessage,
          },
        },
      ),
      GalleryPublication.updateOne(
        { publicationId: normalizedPublicationId },
        {
          $set: {
            'classification.version': GALLERY_CLASSIFICATION_VERSION,
            'classification.status': 'failed',
            'classification.lastAttemptAt': now,
            'classification.leaseExpiresAt': null,
            'classification.error': errorMessage,
          },
        },
      ),
    ]);
    throw error;
  }
}

async function drainClassificationQueue() {
  if (classificationWorkerActive) return;
  classificationWorkerActive = true;
  try {
    while (classificationQueue.length > 0) {
      const publicationId = classificationQueue.shift();
      try {
        await classifyGalleryPublication(publicationId);
      } catch (error) {
        console.warn(
          `[gallery] background classification failed for ${publicationId}:`,
          error?.message || error,
        );
      } finally {
        classificationQueued.delete(publicationId);
      }
    }
  } finally {
    classificationWorkerActive = false;
  }
}

export function scheduleGalleryPublicationClassification(publicationId) {
  const normalizedPublicationId = normalizeString(publicationId);
  if (!normalizedPublicationId || classificationQueued.has(normalizedPublicationId)) return false;

  classificationQueued.add(normalizedPublicationId);
  classificationQueue.push(normalizedPublicationId);
  setImmediate(() => void drainClassificationQueue());
  return true;
}

export function scheduleGalleryPublicationClassifications(items) {
  if (!Array.isArray(items)) return 0;
  return items.reduce((scheduled, item) => {
    const publicationId = typeof item === 'string'
      ? item
      : item?.publicationId || item?.id;
    return scheduled + (scheduleGalleryPublicationClassification(publicationId) ? 1 : 0);
  }, 0);
}
