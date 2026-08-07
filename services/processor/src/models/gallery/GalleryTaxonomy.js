import { ensureGalleryTaxonomyIndexes, getGalleryModels } from './GalleryDatabase.js';

export const GALLERY_TAXONOMY_KINDS = Object.freeze(['category', 'topic']);

const normalizeString = (value) =>
  typeof value === 'string' ? value.trim() : '';

export function normalizeGalleryTaxonomyKind(value) {
  const normalized = normalizeString(value).toLowerCase();
  if (normalized === 'category' || normalized === 'categories') return 'category';
  if (normalized === 'topic' || normalized === 'topics') return 'topic';
  return '';
}

export function normalizeGalleryTaxonomyName(value) {
  return normalizeString(value)
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

const normalizeNames = (values) => {
  if (!Array.isArray(values)) return [];
  const names = new Map();
  values.forEach((value) => {
    const name = normalizeString(value);
    const normalizedName = normalizeGalleryTaxonomyName(name);
    if (name && normalizedName && !names.has(normalizedName)) {
      names.set(normalizedName, name);
    }
  });
  return names;
};

export function buildGalleryTaxonomyMembershipOperations({
  publicationId,
  previousCategories = [],
  previousTopics = [],
  categories = [],
  topics = [],
} = {}) {
  const normalizedPublicationId = normalizeString(publicationId);
  if (!normalizedPublicationId) return { upserts: [], removals: [] };

  const previousByKind = {
    category: normalizeNames(previousCategories),
    topic: normalizeNames(previousTopics),
  };
  const currentByKind = {
    category: normalizeNames(categories),
    topic: normalizeNames(topics),
  };
  const upserts = [];
  const removals = [];

  GALLERY_TAXONOMY_KINDS.forEach((kind) => {
    currentByKind[kind].forEach((name, normalizedName) => {
      upserts.push({ kind, name, normalizedName, publicationId: normalizedPublicationId });
    });
    previousByKind[kind].forEach((name, normalizedName) => {
      if (!currentByKind[kind].has(normalizedName)) {
        removals.push({ kind, name, normalizedName, publicationId: normalizedPublicationId });
      }
    });
  });

  return { upserts, removals };
}

async function removeEmptyTaxonomyEntries(GalleryTaxonomyEntry) {
  await GalleryTaxonomyEntry.deleteMany({ publicationIds: { $size: 0 } });
}

const isDuplicateKeyOnlyError = (error) => {
  const codes = [
    error?.code,
    ...(Array.isArray(error?.writeErrors)
      ? error.writeErrors.map((writeError) => writeError?.code)
      : []),
  ].filter((code) => Number.isFinite(Number(code)));
  return codes.length > 0 && codes.every((code) => Number(code) === 11000);
};

const taxonomyUpsertOperations = (upserts, now, upsert) => upserts.map((entry) => ({
  updateOne: {
    filter: { kind: entry.kind, normalizedName: entry.normalizedName },
    update: {
      $set: { name: entry.name, updatedAt: now },
      ...(upsert ? { $setOnInsert: { createdAt: now } } : {}),
      $addToSet: { publicationIds: entry.publicationId },
    },
    upsert,
  },
}));

export async function syncGalleryTaxonomyMembership(input) {
  const { upserts, removals } = buildGalleryTaxonomyMembershipOperations(input);
  if (upserts.length === 0 && removals.length === 0) {
    return { upserted: 0, removed: 0 };
  }

  await ensureGalleryTaxonomyIndexes();
  const { GalleryTaxonomyEntry } = await getGalleryModels();
  const now = new Date();

  if (upserts.length > 0) {
    try {
      await GalleryTaxonomyEntry.bulkWrite(
        taxonomyUpsertOperations(upserts, now, true),
        { ordered: false },
      );
    } catch (error) {
      if (!isDuplicateKeyOnlyError(error)) throw error;
      // Multiple processor replicas can discover the same new taxonomy name at
      // once. The unique index chooses one creator; replay membership additions
      // against the winning documents without attempting another upsert.
      await GalleryTaxonomyEntry.bulkWrite(
        taxonomyUpsertOperations(upserts, now, false),
        { ordered: false },
      );
    }
  }

  if (removals.length > 0) {
    await GalleryTaxonomyEntry.bulkWrite(
      removals.map((entry) => ({
        updateOne: {
          filter: { kind: entry.kind, normalizedName: entry.normalizedName },
          update: {
            $set: { updatedAt: now },
            $pull: { publicationIds: entry.publicationId },
          },
        },
      })),
      { ordered: false },
    );
    await removeEmptyTaxonomyEntries(GalleryTaxonomyEntry);
  }

  return { upserted: upserts.length, removed: removals.length };
}

export async function removeGalleryTaxonomyPublications(publicationIds) {
  const normalizedIds = Array.from(new Set(
    (Array.isArray(publicationIds) ? publicationIds : [])
      .map(normalizeString)
      .filter(Boolean),
  ));
  if (normalizedIds.length === 0) return { publicationsRemoved: 0 };

  await ensureGalleryTaxonomyIndexes();
  const { GalleryTaxonomyEntry } = await getGalleryModels();
  await GalleryTaxonomyEntry.updateMany(
    { publicationIds: { $in: normalizedIds } },
    {
      $set: { updatedAt: new Date() },
      $pull: { publicationIds: { $in: normalizedIds } },
    },
  );
  await removeEmptyTaxonomyEntries(GalleryTaxonomyEntry);
  return { publicationsRemoved: normalizedIds.length };
}

function validateKind(kind) {
  const normalizedKind = normalizeGalleryTaxonomyKind(kind);
  if (normalizedKind) return normalizedKind;
  const error = new Error('kind must be category or topic.');
  error.statusCode = 400;
  throw error;
}

export async function listGalleryTaxonomyEntries({
  kind,
  limit = 100,
  offset = 0,
  includePublicationIds = false,
} = {}) {
  const normalizedKind = validateKind(kind);
  const resolvedLimit = Math.max(1, Math.min(500, Number(limit) || 100));
  const resolvedOffset = Math.max(0, Number(offset) || 0);
  await ensureGalleryTaxonomyIndexes();
  const { GalleryTaxonomyEntry } = await getGalleryModels();
  const [records, total] = await Promise.all([
    GalleryTaxonomyEntry.aggregate([
      { $match: { kind: normalizedKind } },
      { $sort: { name: 1 } },
      { $skip: resolvedOffset },
      { $limit: resolvedLimit },
      {
        $project: {
          _id: 0,
          name: 1,
          publicationCount: { $size: '$publicationIds' },
          ...(includePublicationIds ? { publicationIds: 1 } : {}),
        },
      },
    ]),
    GalleryTaxonomyEntry.countDocuments({ kind: normalizedKind }),
  ]);

  return {
    kind: normalizedKind,
    items: records.map((record) => ({
      name: record.name,
      publication_count: Number(record.publicationCount) || 0,
      ...(includePublicationIds ? { publication_ids: record.publicationIds || [] } : {}),
    })),
    total,
    limit: resolvedLimit,
    offset: resolvedOffset,
  };
}

export async function getGalleryTaxonomyPublicationIds({
  kind,
  name,
  limit = 100,
  offset = 0,
} = {}) {
  const normalizedKind = validateKind(kind);
  const normalizedName = normalizeGalleryTaxonomyName(name);
  if (!normalizedName) {
    const error = new Error('name is required.');
    error.statusCode = 400;
    throw error;
  }
  const resolvedLimit = Math.max(1, Math.min(500, Number(limit) || 100));
  const resolvedOffset = Math.max(0, Number(offset) || 0);
  await ensureGalleryTaxonomyIndexes();
  const { GalleryTaxonomyEntry } = await getGalleryModels();
  const [record] = await GalleryTaxonomyEntry.aggregate([
    { $match: { kind: normalizedKind, normalizedName } },
    {
      $project: {
        _id: 0,
        name: 1,
        total: { $size: '$publicationIds' },
        publicationIds: { $slice: ['$publicationIds', resolvedOffset, resolvedLimit] },
      },
    },
  ]);

  return {
    kind: normalizedKind,
    name: record?.name || normalizeString(name),
    publication_ids: record?.publicationIds || [],
    total: Number(record?.total) || 0,
    limit: resolvedLimit,
    offset: resolvedOffset,
  };
}
