import express from 'express';
import { resolveRequestActorFromAuthHeaders } from '../models/external/User.js';
import User from '../schema/User.js';
import {
  getGalleryRecommendations,
  getGallerySyncStatus,
  recordGalleryView,
  searchGalleryPublications,
  syncGalleryPublications,
  updateGalleryPublicationEmbeddings,
} from '../models/gallery/GalleryService.js';
import {
  getDeployedGalleryStatus,
  getDeployedGalleryTaxonomyPublicationIds,
  isConfiguredGalleryServiceRequest,
  listDeployedGalleryTaxonomy,
  loadDeployedGalleryRecommendations,
  recordDeployedGalleryView,
  updateDeployedGalleryPublicationEmbeddings,
  updateDeployedGalleryPublicationClassification,
  searchDeployedGallery,
  shouldUseDeployedGallery,
  syncDeployedGallery,
} from '../models/gallery/GalleryExternalAdapter.js';
import {
  classifyGalleryPublication,
} from '../models/gallery/GalleryClassification.js';
import {
  scheduleGalleryPublicationReady,
  scheduleGalleryPublicationsReady,
} from '../models/gallery/GalleryPublicationPipeline.js';
import {
  getGalleryTaxonomyPublicationIds,
  listGalleryTaxonomyEntries,
} from '../models/gallery/GalleryTaxonomy.js';

const router = express.Router();

function normalizeString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function parseLimit(value, fallback, maximum) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? Math.max(1, Math.min(maximum, parsed)) : fallback;
}

function parseOffset(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
}

function parseBoolean(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value || '').toLowerCase());
}

async function authenticateGalleryRequest(req, res, next) {
  try {
    if (shouldUseDeployedGallery()) {
      if (!isConfiguredGalleryServiceRequest(req.headers)) {
        return res.status(401).json({
          error: 'The configured Samsar API key is required for standalone gallery forwarding.',
        });
      }
      req.galleryUsesDeployedService = true;
      req.galleryServiceAuthorized = true;
      return next();
    }

    const authContext = await resolveRequestActorFromAuthHeaders(req.headers);
    const allowedAuthTypes = new Set([
      'api_key',
      'app_key',
      'auth_token',
      'customer_sub_account_api_key',
    ]);
    if (!allowedAuthTypes.has(authContext.authType)) {
      return res.status(403).json({ error: 'A Samsar API key or app key is required.' });
    }

    req.galleryActor = authContext;
    const user = authContext.internalUserId
      ? await User.findById(authContext.internalUserId).select({ isAdminUser: 1 }).lean()
      : null;
    const isServerApiKey = ['api_key', 'app_key', 'customer_sub_account_api_key'].includes(
      authContext.authType,
    );
    const requiresAdminServiceKey = process.env.GALLERY_REQUIRE_ADMIN_SERVICE_KEY === 'true';
    req.galleryServiceAuthorized = Boolean(
      (isServerApiKey && (!requiresAdminServiceKey || user?.isAdminUser)) ||
      (process.env.GALLERY_SERVICE_USER_ID &&
        process.env.GALLERY_SERVICE_USER_ID === authContext.internalUserId?.toString?.()),
    );
    return next();
  } catch (error) {
    return res.status(error?.status || 401).json({
      error: error?.message || 'Unable to authenticate gallery request.',
    });
  }
}

function requireGalleryService(req, res, next) {
  if (!req.galleryServiceAuthorized) {
    return res.status(403).json({
      error: 'This operation requires the configured Samsar Gallery service account.',
    });
  }
  return next();
}

function sendError(res, error, fallback) {
  const status = error?.statusCode || error?.status || 500;
  return res.status(status).json({
    error: error?.message || fallback,
    ...(error?.code ? { code: error.code } : {}),
  });
}

router.use(authenticateGalleryRequest);

router.post('/search', async (req, res) => {
  try {
    const payload = {
      query: req.body?.query ?? req.body?.search_term ?? '',
      limit: parseLimit(req.body?.limit, 24, 50),
      format: normalizeString(req.body?.format ?? req.body?.aspect_format),
    };
    const result = req.galleryUsesDeployedService
      ? await searchDeployedGallery(payload)
      : await searchGalleryPublications(payload);
    if (!req.galleryUsesDeployedService) {
      scheduleGalleryPublicationsReady(result?.items);
    }
    return res.json(result);
  } catch (error) {
    return sendError(res, error, 'Unable to search gallery publications.');
  }
});

router.post('/recommendations', async (req, res) => {
  try {
    const requestedViewerId = normalizeString(req.body?.viewer_id ?? req.body?.viewerId);
    if (requestedViewerId && !req.galleryServiceAuthorized) {
      return res.status(403).json({ error: 'Personalized recommendations require the Gallery service account.' });
    }
    const payload = {
      viewerId: requestedViewerId,
      publicationId: normalizeString(
        req.body?.publication_id ?? req.body?.publicationId ?? req.body?.video_id,
      ),
      limit: parseLimit(req.body?.limit, 16, 40),
      format: normalizeString(req.body?.format ?? req.body?.aspect_format),
      excludeIds: Array.isArray(req.body?.exclude_ids)
        ? req.body.exclude_ids.filter((id) => typeof id === 'string').slice(0, 100)
        : [],
    };
    const result = req.galleryUsesDeployedService
      ? await loadDeployedGalleryRecommendations({
          viewer_id: payload.viewerId,
          publication_id: payload.publicationId,
          limit: payload.limit,
          format: payload.format,
          exclude_ids: payload.excludeIds,
        })
      : await getGalleryRecommendations(payload);
    if (!req.galleryUsesDeployedService) {
      scheduleGalleryPublicationsReady(result?.items);
    }
    return res.json(result);
  } catch (error) {
    return sendError(res, error, 'Unable to load gallery recommendations.');
  }
});

router.get('/taxonomy/:kind', async (req, res) => {
  try {
    const payload = {
      kind: req.params.kind,
      limit: parseLimit(req.query?.limit, 100, 500),
      offset: parseOffset(req.query?.offset),
      includePublicationIds: parseBoolean(req.query?.include_publication_ids),
    };
    const result = req.galleryUsesDeployedService
      ? await listDeployedGalleryTaxonomy(payload)
      : await listGalleryTaxonomyEntries(payload);
    return res.json(result);
  } catch (error) {
    return sendError(res, error, 'Unable to load gallery taxonomy.');
  }
});

router.get('/taxonomy/:kind/:name/publications', async (req, res) => {
  try {
    const payload = {
      kind: req.params.kind,
      name: req.params.name,
      limit: parseLimit(req.query?.limit, 100, 500),
      offset: parseOffset(req.query?.offset),
    };
    const result = req.galleryUsesDeployedService
      ? await getDeployedGalleryTaxonomyPublicationIds(payload)
      : await getGalleryTaxonomyPublicationIds(payload);
    return res.json(result);
  } catch (error) {
    return sendError(res, error, 'Unable to load gallery taxonomy publications.');
  }
});

router.post('/events/view', requireGalleryService, async (req, res) => {
  try {
    const payload = {
      publicationId: req.body?.publication_id ?? req.body?.publicationId,
      viewerId: req.body?.viewer_id ?? req.body?.viewerId,
      eventType: req.body?.event_type ?? req.body?.eventType ?? 'view',
      watchTimeMs: req.body?.watch_time_ms ?? req.body?.watchTimeMs ?? 0,
      durationMs: req.body?.duration_ms ?? req.body?.durationMs ?? 0,
      source: req.body?.source ?? 'gallery',
      metadata: req.body?.metadata ?? {},
    };
    const result = req.galleryUsesDeployedService
      ? await recordDeployedGalleryView({
          publication_id: payload.publicationId,
          viewer_id: payload.viewerId,
          event_type: payload.eventType,
          watch_time_ms: payload.watchTimeMs,
          duration_ms: payload.durationMs,
          source: payload.source,
          metadata: payload.metadata,
        })
      : await recordGalleryView(payload);
    if (!req.galleryUsesDeployedService) {
      scheduleGalleryPublicationReady(payload.publicationId);
    }
    return res.status(202).json(result);
  } catch (error) {
    return sendError(res, error, 'Unable to record gallery view.');
  }
});

router.post('/sync', requireGalleryService, async (req, res) => {
  try {
    const payload = { force: req.body?.force === true };
    const result = req.galleryUsesDeployedService
      ? await syncDeployedGallery(payload)
      : await syncGalleryPublications(payload);
    return res.json(result);
  } catch (error) {
    return sendError(res, error, 'Unable to synchronize gallery embeddings.');
  }
});

router.post('/publications/update_embeddings', requireGalleryService, async (req, res) => {
  try {
    const publicationId = normalizeString(
      req.body?.publication_id ?? req.body?.publicationId,
    );
    if (!publicationId) {
      return res.status(400).json({ error: 'publication_id is required.' });
    }
    const payload = {
      publicationId,
      force: req.body?.force === true,
    };
    const result = req.galleryUsesDeployedService
      ? await updateDeployedGalleryPublicationEmbeddings({
          publication_id: publicationId,
          force: payload.force,
        })
      : await updateGalleryPublicationEmbeddings(payload);
    return res.json(result);
  } catch (error) {
    return sendError(res, error, 'Unable to update gallery publication embeddings.');
  }
});

router.post('/publications/update_classification', requireGalleryService, async (req, res) => {
  try {
    const publicationId = normalizeString(
      req.body?.publication_id ?? req.body?.publicationId,
    );
    if (!publicationId) {
      return res.status(400).json({ error: 'publication_id is required.' });
    }
    const payload = {
      publication_id: publicationId,
      force: req.body?.force === true,
    };
    const result = req.galleryUsesDeployedService
      ? await updateDeployedGalleryPublicationClassification(payload)
      : await classifyGalleryPublication(publicationId, { force: payload.force });
    return res.json(result);
  } catch (error) {
    return sendError(res, error, 'Unable to update gallery publication classification.');
  }
});

router.get('/status', requireGalleryService, async (req, res) => {
  try {
    return res.json(
      req.galleryUsesDeployedService
        ? await getDeployedGalleryStatus()
        : await getGallerySyncStatus(),
    );
  } catch (error) {
    return sendError(res, error, 'Unable to load gallery index status.');
  }
});

export default router;
