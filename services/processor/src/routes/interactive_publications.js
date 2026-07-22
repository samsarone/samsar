import express from 'express';
import mongoose from 'mongoose';

import { getDBConnectionString } from '../models/DBString.js';
import {
  isInteractivePublicationPubliclyRenderable,
  serializeInteractivePublication,
} from '../models/InteractivePublication.js';
import InteractivePublication, {
  INTERACTIVE_PUBLICATION_SCHEMA,
} from '../schema/InteractivePublication.js';

const router = express.Router();

const parseLimitedInteger = (value, defaultValue, maxValue) => {
  const parsed = typeof value === 'string' ? Number.parseInt(value, 10) : NaN;
  if (!Number.isFinite(parsed)) return defaultValue;
  return Math.min(Math.max(parsed, 1), maxValue);
};

const parseCursor = (value) => {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    return new mongoose.Types.ObjectId(value.trim());
  } catch {
    return null;
  }
};

const visibilityClauses = [
  { isPublished: true },
  { isRenderable: true },
  { publicRenderableVersion: INTERACTIVE_PUBLICATION_SCHEMA },
  { $or: [{ isHidden: { $exists: false } }, { isHidden: false }] },
  { $or: [{ isDeleted: { $exists: false } }, { isDeleted: false }] },
];

export const buildPublicInteractivePublicationQuery = (
  cursorId = null,
  { category = null, topic = null } = {},
) => {
  const query = { $and: [...visibilityClauses] };
  if (category) query.$and.push({ categories: category });
  if (topic) query.$and.push({ topics: topic });
  if (cursorId) {
    query.$and.push({ _id: { $lt: cursorId } });
  }
  return query;
};

export const paginatePublicInteractivePublications = (
  publications,
  { limit = 50, totalCount = null } = {},
) => {
  const candidates = (Array.isArray(publications) ? publications : [])
    .filter((publication) => isInteractivePublicationPubliclyRenderable(publication));
  const page = candidates.slice(0, limit);
  const hasMore = candidates.length > limit;

  return {
    items: page.map((publication) => serializeInteractivePublication(publication)),
    nextCursor: hasMore && page.length
      ? page[page.length - 1]._id?.toString?.() || null
      : null,
    hasMore,
    ...(Number.isInteger(totalCount) && totalCount >= 0 ? { totalCount } : {}),
  };
};

export async function listPublicInteractivePublications({
  cursorId = null,
  limit = 50,
  category = null,
  topic = null,
  publicationModel = InteractivePublication,
} = {}) {
  const batchSize = limit + 1;
  const publications = [];
  let scanCursor = cursorId;

  while (publications.length < batchSize) {
    const batch = await publicationModel.find(buildPublicInteractivePublicationQuery(
      scanCursor,
      { category, topic },
    ))
      .sort({ _id: -1 })
      .limit(batchSize)
      .lean()
      .exec();
    if (!Array.isArray(batch) || batch.length === 0) break;

    publications.push(
      ...batch.filter((publication) => isInteractivePublicationPubliclyRenderable(publication)),
    );
    if (batch.length < batchSize || publications.length >= batchSize) break;

    const nextScanCursor = batch.at(-1)?._id?.toString?.() || null;
    if (!nextScanCursor || nextScanCursor === scanCursor?.toString?.()) break;
    scanCursor = nextScanCursor;
  }

  return paginatePublicInteractivePublications(publications, { limit });
}

router.get('/', async (req, res) => {
  try {
    await getDBConnectionString();

    const limitArg = Array.isArray(req.query.limit) ? req.query.limit[0] : req.query.limit;
    const cursorArg = Array.isArray(req.query.cursor) ? req.query.cursor[0] : req.query.cursor;
    const categoryArg = Array.isArray(req.query.category) ? req.query.category[0] : req.query.category;
    const topicArg = Array.isArray(req.query.topic) ? req.query.topic[0] : req.query.topic;
    const limit = parseLimitedInteger(limitArg, 50, 200);
    const cursorId = parseCursor(cursorArg);
    return res.json(await listPublicInteractivePublications({
      cursorId,
      limit,
      category: typeof categoryArg === 'string' ? categoryArg.trim() : null,
      topic: typeof topicArg === 'string' ? topicArg.trim() : null,
    }));
  } catch (error) {
    console.error('Error fetching interactive publications:', error);
    return res.status(500).json({ error: 'Failed to fetch interactive publications.' });
  }
});

router.get('/:publicationId', async (req, res) => {
  try {
    await getDBConnectionString();

    const { publicationId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(publicationId)) {
      return res.status(400).json({ error: 'Invalid interactive publication id.' });
    }

    const publication = await InteractivePublication.findOne({
      _id: new mongoose.Types.ObjectId(publicationId),
      $and: [...visibilityClauses],
    }).lean().exec();
    if (!publication || !isInteractivePublicationPubliclyRenderable(publication)) {
      return res.status(404).json({ error: 'Interactive publication not found.' });
    }

    return res.json({
      publication: serializeInteractivePublication(publication),
    });
  } catch (error) {
    console.error('Error fetching interactive publication:', error);
    return res.status(500).json({ error: 'Failed to fetch interactive publication.' });
  }
});

export default router;
