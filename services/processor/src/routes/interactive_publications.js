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

export const buildPublicInteractivePublicationQuery = (cursorId = null) => {
  const query = { $and: [...visibilityClauses] };
  if (cursorId) {
    query.$and.push({ _id: { $lt: cursorId } });
  }
  return query;
};

export const paginatePublicInteractivePublications = (
  publications,
  { limit = 50, totalCount = 0 } = {},
) => {
  const candidates = Array.isArray(publications) ? publications : [];
  const page = candidates.slice(0, limit);
  const hasMore = candidates.length > limit;

  return {
    items: page.map((publication) => serializeInteractivePublication(publication)),
    nextCursor: hasMore && page.length
      ? page[page.length - 1]._id?.toString?.() || null
      : null,
    hasMore,
    totalCount,
  };
};

export async function listPublicInteractivePublications({
  cursorId = null,
  limit = 50,
  publicationModel = InteractivePublication,
} = {}) {
  const [totalCount, publications] = await Promise.all([
    publicationModel.countDocuments(buildPublicInteractivePublicationQuery()).exec(),
    publicationModel.find(buildPublicInteractivePublicationQuery(cursorId))
      .sort({ _id: -1 })
      .limit(limit + 1)
      .lean()
      .exec(),
  ]);

  return paginatePublicInteractivePublications(publications, { limit, totalCount });
}

router.get('/', async (req, res) => {
  try {
    await getDBConnectionString();

    const limitArg = Array.isArray(req.query.limit) ? req.query.limit[0] : req.query.limit;
    const cursorArg = Array.isArray(req.query.cursor) ? req.query.cursor[0] : req.query.cursor;
    const limit = parseLimitedInteger(limitArg, 50, 200);
    const cursorId = parseCursor(cursorArg);
    return res.json(await listPublicInteractivePublications({
      cursorId,
      limit,
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
