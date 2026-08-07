import mongoose from 'mongoose';
import { getDBConnectionString } from '../DBString.js';
import galleryPublicationSchema from '../../schema/gallery/GalleryPublication.js';
import galleryRecommendationCacheSchema from '../../schema/gallery/GalleryRecommendationCache.js';
import galleryTaxonomyEntrySchema from '../../schema/gallery/GalleryTaxonomyEntry.js';
import galleryWatchHistorySchema from '../../schema/gallery/GalleryWatchHistory.js';
import gallerySyncStateSchema from '../../schema/gallery/GallerySyncState.js';
import {
  GALLERY_DATABASE_NAME,
  GALLERY_EMBEDDING_DIMENSIONS,
} from './GalleryConstants.js';

const GALLERY_VECTOR_INDEX = process.env.GALLERY_VECTOR_INDEX || 'gallery_embedding_vector_index';
const GALLERY_PUBLICATION_COLLECTION = 'gallery_publications';
const GALLERY_TEXT_INDEX = 'gallery_text_search';

let galleryConnection = null;
let models = null;
let indexPromise = null;
let taxonomyIndexPromise = null;

export async function getGalleryDatabase() {
  await getDBConnectionString();

  if (!galleryConnection) {
    galleryConnection = mongoose.connection.useDb(GALLERY_DATABASE_NAME, { useCache: true });
  }

  return galleryConnection;
}

export async function getGalleryModels() {
  const connection = await getGalleryDatabase();
  if (!models) {
    models = {
      GalleryPublication:
        connection.models.GalleryPublication ||
        connection.model('GalleryPublication', galleryPublicationSchema),
      GalleryRecommendationCache:
        connection.models.GalleryRecommendationCache ||
        connection.model('GalleryRecommendationCache', galleryRecommendationCacheSchema),
      GalleryTaxonomyEntry:
        connection.models.GalleryTaxonomyEntry ||
        connection.model('GalleryTaxonomyEntry', galleryTaxonomyEntrySchema),
      GalleryWatchHistory:
        connection.models.GalleryWatchHistory ||
        connection.model('GalleryWatchHistory', galleryWatchHistorySchema),
      GallerySyncState:
        connection.models.GallerySyncState ||
        connection.model('GallerySyncState', gallerySyncStateSchema),
    };
  }

  return models;
}

function isExistingIndexError(error) {
  return (
    error?.code === 68 ||
    error?.code === 85 ||
    error?.code === 86 ||
    /already exists|equivalent index|index options conflict/i.test(error?.message || '')
  );
}

function isMissingIndexError(error) {
  return error?.code === 27 || /index not found/i.test(error?.message || '');
}

function isGalleryTextIndexConflict(error) {
  return isExistingIndexError(error) &&
    String(error?.message || '').includes(GALLERY_TEXT_INDEX);
}

export async function ensureGalleryPublicationIndexesForModel(GalleryPublication) {
  try {
    await GalleryPublication.createIndexes();
    return;
  } catch (error) {
    if (!isGalleryTextIndexConflict(error)) throw error;
  }

  const collectionName = GalleryPublication?.collection?.collectionName;
  if (collectionName !== GALLERY_PUBLICATION_COLLECTION) {
    throw new Error(
      `[gallery] Refusing to reconcile ${GALLERY_TEXT_INDEX} outside ` +
      `${GALLERY_DATABASE_NAME}.${GALLERY_PUBLICATION_COLLECTION}; received ${collectionName || 'unknown'}.`,
    );
  }

  // This index belongs only to the derived GalleryPublication records, which are
  // sourced from the standard Publication model. InteractivePublication uses a
  // different model, database collection, and index set.
  try {
    await GalleryPublication.collection.dropIndex(GALLERY_TEXT_INDEX);
  } catch (error) {
    // Another processor replica may have completed the same narrow migration.
    if (!isMissingIndexError(error)) throw error;
  }
  await GalleryPublication.createIndexes();
}

export async function ensureGalleryTaxonomyIndexes() {
  if (taxonomyIndexPromise) return taxonomyIndexPromise;

  taxonomyIndexPromise = (async () => {
    const { GalleryTaxonomyEntry } = await getGalleryModels();
    await GalleryTaxonomyEntry.createIndexes();
  })().catch((error) => {
    taxonomyIndexPromise = null;
    throw error;
  });

  return taxonomyIndexPromise;
}

export async function ensureGalleryIndexes() {
  if (indexPromise) {
    return indexPromise;
  }

  indexPromise = (async () => {
    const connection = await getGalleryDatabase();
    const {
      GalleryPublication,
      GalleryRecommendationCache,
      GalleryWatchHistory,
      GallerySyncState,
    } =
      await getGalleryModels();

    await Promise.all([
      ensureGalleryPublicationIndexesForModel(GalleryPublication),
      ensureGalleryTaxonomyIndexes(),
      GalleryWatchHistory.createIndexes(),
      GallerySyncState.createIndexes(),
    ]);

    try {
      await GalleryRecommendationCache.createIndexes();
    } catch (error) {
      // Recommendation reads still enforce expiresAt; cache-index setup must not take
      // the gallery recommendation endpoint down on Mongo-compatible deployments
      // that do not support TTL indexes.
      console.warn('[gallery] recommendation cache indexes unavailable:', error?.message || error);
    }

    try {
      await connection.db.command({
        createIndexes: GalleryPublication.collection.collectionName,
        indexes: [
          {
            name: GALLERY_VECTOR_INDEX,
            key: { embedding: 'cosmosSearch' },
            cosmosSearchOptions: {
              kind: process.env.GALLERY_VECTOR_INDEX_KIND || 'vector-ivf',
              dimensions: GALLERY_EMBEDDING_DIMENSIONS,
              similarity: 'COS',
              numLists: Math.max(
                1,
                Number.parseInt(process.env.GALLERY_VECTOR_NUM_LISTS || '1', 10) || 1,
              ),
            },
          },
        ],
      });
    } catch (error) {
      if (!isExistingIndexError(error)) {
        console.warn('[gallery] Cosmos vector index initialization deferred:', error?.message || error);
      }
    }

    return {
      database: GALLERY_DATABASE_NAME,
      vectorIndex: GALLERY_VECTOR_INDEX,
      dimensions: GALLERY_EMBEDDING_DIMENSIONS,
    };
  })().catch((error) => {
    indexPromise = null;
    throw error;
  });

  return indexPromise;
}

export function getGalleryVectorIndexName() {
  return GALLERY_VECTOR_INDEX;
}
