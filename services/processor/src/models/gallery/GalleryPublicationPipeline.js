import mongoose from 'mongoose';

import { classifyGalleryPublication } from './GalleryClassification.js';
import { updateGalleryPublicationEmbedding } from './GalleryService.js';

const queue = [];
const queued = new Set();
let workerActive = false;

const normalizePublicationId = (value) => {
  const normalized = value?.toString?.() || value;
  return typeof normalized === 'string' ? normalized.trim() : '';
};

export async function ensureGalleryPublicationReady(publicationId) {
  const normalizedPublicationId = normalizePublicationId(publicationId);
  if (!mongoose.Types.ObjectId.isValid(normalizedPublicationId)) {
    return { status: 'skipped', reason: 'invalid_publication_id' };
  }

  const embedding = await updateGalleryPublicationEmbedding(normalizedPublicationId);
  if (['not_found', 'unavailable'].includes(embedding?.reason)) {
    return { status: 'skipped', reason: embedding.reason, embedding };
  }
  if (embedding?.reason === 'fresh_or_already_running') {
    return { status: 'skipped', reason: embedding.reason, embedding };
  }

  const classification = await classifyGalleryPublication(normalizedPublicationId);
  return { status: 'complete', publicationId: normalizedPublicationId, embedding, classification };
}

async function drainQueue() {
  if (workerActive) return;
  workerActive = true;
  try {
    while (queue.length > 0) {
      const publicationId = queue.shift();
      try {
        await ensureGalleryPublicationReady(publicationId);
      } catch (error) {
        console.warn(
          `[gallery] background publication pipeline failed for ${publicationId}:`,
          error?.message || error,
        );
      } finally {
        queued.delete(publicationId);
      }
    }
  } finally {
    workerActive = false;
  }
}

export function scheduleGalleryPublicationReady(publicationId) {
  const normalizedPublicationId = normalizePublicationId(publicationId);
  if (!mongoose.Types.ObjectId.isValid(normalizedPublicationId) || queued.has(normalizedPublicationId)) {
    return false;
  }
  queued.add(normalizedPublicationId);
  queue.push(normalizedPublicationId);
  setImmediate(() => void drainQueue());
  return true;
}

export function scheduleGalleryPublicationsReady(items) {
  if (!Array.isArray(items)) return 0;
  return items.reduce((count, item) => {
    const publicationId = typeof item === 'string'
      ? item
      : item?.publicationId || item?.id || item?._id;
    return count + (scheduleGalleryPublicationReady(publicationId) ? 1 : 0);
  }, 0);
}
