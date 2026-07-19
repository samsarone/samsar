import express from 'express';
import mongoose from 'mongoose';
import { getDBConnectionString } from '../models/DBString.js';
import {
  createPublicationForSessionVideo,
  normalizePublicationAspectRatio,
  unpublishSessionVideo,
} from '../models/Publication.js';
import { Comment, Publication } from '../schema/Publication.js';
import InteractivePublication from '../schema/InteractivePublication.js';
import VideoSession from '../schema/VideoSession.js';
import { verifyUserAuthentication } from '../models/Auth.js';
import User from '../schema/User.js';
import { resolveRequestActorFromAuthHeaders } from '../models/external/User.js';
import { isPublicPublicationMediaUrl } from '../models/AWS.js';
import { normalizePublicationTranscript } from '../models/publication/Transcript.js';
import { serializeInteractivePublication } from '../models/InteractivePublication.js';
import {
  isBranchedVideoSession,
  isInteractiveSessionReadyForPublication,
} from '../models/interactive/InteractivePublicationManifest.js';
import {
  scheduleGalleryPublicationReady,
  scheduleGalleryPublicationsReady,
} from '../models/gallery/GalleryPublicationPipeline.js';

const router = express.Router();

const parseLimitedInteger = (value, defaultValue, maxValue) => {
  const parsed = typeof value === 'string' ? parseInt(value, 10) : NaN;
  if (!Number.isFinite(parsed)) {
    return defaultValue;
  }

  return Math.min(Math.max(parsed, 1), maxValue);
};

const parseCursor = (value) => {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return null;
  }

  try {
    return new mongoose.Types.ObjectId(value.trim());
  } catch (error) {
    return null;
  }
};

const normalizeTags = (tags) =>
  Array.isArray(tags)
    ? tags
        .filter((tag) => typeof tag === 'string')
        .map((tag) => tag.trim())
        .filter(Boolean)
    : [];

const extractLikedByStrings = (likedBy) =>
  Array.isArray(likedBy)
    ? likedBy
        .map((entry) => {
          if (!entry) {
            return '';
          }
          if (typeof entry === 'string') {
            return entry;
          }
          if (entry instanceof mongoose.Types.ObjectId) {
            return entry.toString();
          }
          if (typeof entry.toString === 'function') {
            return entry.toString();
          }
          return '';
        })
        .filter(Boolean)
    : [];

const normalizeSessionId = (value) => {
  if (!value) {
    return null;
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  if (value instanceof mongoose.Types.ObjectId) {
    return value.toString();
  }

  if (typeof value === 'object' && typeof value.toString === 'function') {
    const stringValue = value.toString();
    return stringValue && stringValue !== '[object Object]' ? stringValue : null;
  }

  return null;
};

const normalizeInputPayload = (req) => req.body?.input ?? req.body ?? {};

const normalizeOptionalString = (value) => {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed || null;
};

const getPayloadValue = (payload = {}, keys = []) => {
  if (!payload || typeof payload !== 'object') {
    return undefined;
  }

  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(payload, key)) {
      return payload[key];
    }
  }

  return undefined;
};

const resolveSessionAspectRatio = (session) =>
  normalizePublicationAspectRatio(session?.aspectRatio) ||
  normalizePublicationAspectRatio(session?.publishedAspectRatio);

const resolvePublicationHasSubtitles = (publication) => {
  if (typeof publication?.hasSubtitles === 'boolean') {
    return publication.hasSubtitles;
  }
  if (typeof publication?.has_subtitles === 'boolean') {
    return publication.has_subtitles;
  }
  return null;
};

const hydrateMissingPublicationAspectRatios = async (publications) => {
  const items = Array.isArray(publications) ? publications : [];
  const missingAspectRatioItems = items.filter(
    (publication) => !normalizePublicationAspectRatio(publication?.aspectRatio)
  );

  if (missingAspectRatioItems.length === 0) {
    return new Map();
  }

  const sessionIds = Array.from(
    new Set(
      missingAspectRatioItems
        .map((publication) => normalizeSessionId(publication?.sessionId))
        .filter((sessionId) => sessionId && mongoose.Types.ObjectId.isValid(sessionId))
    )
  );

  if (sessionIds.length === 0) {
    return new Map();
  }

  const sessions = await VideoSession.find({
    _id: { $in: sessionIds.map((sessionId) => new mongoose.Types.ObjectId(sessionId)) },
  })
    .select({ aspectRatio: 1, publishedAspectRatio: 1 })
    .lean()
    .exec();

  const sessionAspectRatioMap = new Map(
    sessions
      .map((session) => {
        const sessionId = normalizeSessionId(session?._id);
        const aspectRatio = resolveSessionAspectRatio(session);
        return sessionId && aspectRatio ? [sessionId, aspectRatio] : null;
      })
      .filter(Boolean)
  );

  const updates = missingAspectRatioItems
    .map((publication) => {
      const sessionId = normalizeSessionId(publication?.sessionId);
      const aspectRatio = sessionId ? sessionAspectRatioMap.get(sessionId) ?? null : null;
      if (!publication?._id || !aspectRatio) {
        return null;
      }

      return {
        updateOne: {
          filter: { _id: publication._id },
          update: { $set: { aspectRatio } },
        },
      };
    })
    .filter(Boolean);

  if (updates.length > 0) {
    try {
      await Publication.bulkWrite(updates, { ordered: false });
    } catch (error) {
      console.error('Failed to backfill publication aspect ratios:', error);
    }
  }

  return sessionAspectRatioMap;
};

const mapPublicationResponse = (
  publication,
  viewerId,
  botUserMap = new Map(),
  sessionAspectRatioMap = new Map(),
  requirePublicVideo = false,
) => {
  if (!publication) {
    return null;
  }

  const videoUrl = typeof publication.videoURL === 'string' ? publication.videoURL : '';
  if (!videoUrl || (requirePublicVideo && !isPublicPublicationMediaUrl(videoUrl))) {
    return null;
  }

  const likedByStrings = extractLikedByStrings(publication.likes?.likedBy);
  const likesCount =
    typeof publication.likes?.count === 'number'
      ? publication.likes.count
      : likedByStrings.length;

  const commentCount = Array.isArray(publication.comments) ? publication.comments.length : 0;
  const sharesCount = typeof publication.shares === 'number' ? publication.shares : 0;
  const createdById = publication.createdBy?.toString?.() ?? null;
  const isBotUser = createdById ? botUserMap.get(createdById) ?? false : false;
  const rawSplashImage =
    typeof publication.splashImage === 'string' && publication.splashImage.trim().length > 0
      ? publication.splashImage.trim()
      : null;
  const splashImage = rawSplashImage &&
    (!requirePublicVideo || isPublicPublicationMediaUrl(rawSplashImage))
    ? rawSplashImage
    : null;
  const imageModel =
    typeof publication.imageModel === 'string' && publication.imageModel.trim().length > 0
      ? publication.imageModel.trim()
      : null;
  const videoModel =
    typeof publication.videoModel === 'string' && publication.videoModel.trim().length > 0
      ? publication.videoModel.trim()
      : null;
  const sessionLanguage =
    typeof publication.sessionLanguage === 'string' && publication.sessionLanguage.trim().length > 0
      ? publication.sessionLanguage.trim()
      : typeof publication.language === 'string' && publication.language.trim().length > 0
        ? publication.language.trim()
        : null;
  const languageString =
    typeof publication.languageString === 'string' && publication.languageString.trim().length > 0
      ? publication.languageString.trim()
      : null;
  const hasSubtitles = resolvePublicationHasSubtitles(publication);
  const sessionId = normalizeSessionId(publication.sessionId);
  const aspectRatio =
    normalizePublicationAspectRatio(publication.aspectRatio) ||
    (sessionId ? sessionAspectRatioMap.get(sessionId) ?? null : null);

  return {
    id: publication._id?.toString?.() ?? '',
    videoUrl,
    title:
      typeof publication.title === 'string' && publication.title.trim().length > 0
        ? publication.title.trim()
        : 'Untitled Video',
    description:
      typeof publication.description === 'string' ? publication.description.trim() : '',
    tags: normalizeTags(publication.tags),
    categories: normalizeTags(publication.categories),
    topics: normalizeTags(publication.topics),
    classification: publication.classification || {},
    originalPrompt:
      typeof publication.originalPrompt === 'string' ? publication.originalPrompt.trim() : '',
    sessionTranscript: normalizePublicationTranscript(publication.sessionTranscript),
    creatorHandle:
      typeof publication.creatorHandle === 'string' ? publication.creatorHandle : '',
    createdBy: publication.createdBy?.toString?.() ?? null,
    sessionId,
    createdAt: publication.createdAt ?? null,
    splashImage,
    aspectRatio,
    imageModel,
    videoModel,
    sessionLanguage,
    language: sessionLanguage,
    languageString,
    hasSubtitles,
    has_subtitles: hasSubtitles,
    stats: {
      likes: likesCount,
      comments: commentCount,
      shares: sharesCount,
      views: Math.max(0, Number(publication.views?.total) || 0),
    },
    viewerHasLiked: viewerId ? likedByStrings.includes(viewerId) : false,
    isBotUser,
  };
};

const resolvePublicationSessionId = (req, payload = {}) =>
  normalizeOptionalString(req.params?.sessionId) ||
  normalizeOptionalString(payload.session_id) ||
  normalizeOptionalString(payload.sessionId) ||
  normalizeOptionalString(payload.video_session_id) ||
  normalizeOptionalString(payload.videoSessionId) ||
  normalizeOptionalString(payload.id);

const buildPublicationSessionPayload = (sessionId, payload = {}, existingPublication = null) => {
  const valueOrExisting = (keys, existingValue) => {
    const value = getPayloadValue(payload, keys);
    return value === undefined ? existingValue : value;
  };

  return {
    id: sessionId,
    title: valueOrExisting(['title'], existingPublication?.title),
    description: valueOrExisting(['description'], existingPublication?.description),
    tags: valueOrExisting(['tags', 'tag_list', 'tagList'], existingPublication?.tags),
    aspectRatio: valueOrExisting(['aspectRatio', 'aspect_ratio'], existingPublication?.aspectRatio),
    creatorHandle: valueOrExisting(
      ['creatorHandle', 'creator_handle'],
      existingPublication?.creatorHandle,
    ),
    slug: valueOrExisting(['slug'], existingPublication?.slug),
    imageHash: valueOrExisting(['imageHash', 'image_hash'], existingPublication?.imageHash),
    splashImage: valueOrExisting(
      ['splashImage', 'splash_image'],
      existingPublication?.splashImage,
    ),
    imageModel: valueOrExisting(['imageModel', 'image_model'], existingPublication?.imageModel),
    videoModel: valueOrExisting(['videoModel', 'video_model'], existingPublication?.videoModel),
    originalPrompt: valueOrExisting(
      ['originalPrompt', 'original_prompt', 'prompt'],
      existingPublication?.originalPrompt,
    ),
    sessionLanguage: valueOrExisting(
      ['sessionLanguage', 'session_language', 'language', 'language_code'],
      existingPublication?.sessionLanguage,
    ),
    languageString: valueOrExisting(
      ['languageString', 'language_string'],
      existingPublication?.languageString,
    ),
    hasSubtitles: valueOrExisting(
      ['hasSubtitles', 'has_subtitles', 'enableSubtitles', 'enable_subtitles'],
      existingPublication?.hasSubtitles ?? existingPublication?.has_subtitles,
    ),
  };
};

const isVideoSessionReadyForPublication = (session) => (
  isBranchedVideoSession(session)
    ? isInteractiveSessionReadyForPublication(session)
    : Boolean(
    normalizeOptionalString(session?.remoteURL) ||
    normalizeOptionalString(session?.videoLink) ||
    normalizeOptionalString(session?.publishedVideoURL)
    )
);

async function authenticatePublicationManagementRequest(req, res, next) {
  try {
    const authContext = await resolveRequestActorFromAuthHeaders(req.headers);
    const allowedAuthTypes = new Set([
      'api_key',
      'auth_token',
      'customer_sub_account_api_key',
    ]);

    if (!allowedAuthTypes.has(authContext.authType)) {
      return res.status(403).json({
        message: 'Use a Samsar API key, customer sub-account API key, or user auth token.',
      });
    }

    req.userId = authContext.internalUserId;
    req.authType = authContext.authType;
    req.customerSubAccount = authContext.customerSubAccount || null;
    next();
  } catch (error) {
    if (
      error?.code === 'API_KEY_EXPIRED' ||
      error?.code === 'CUSTOMER_SUB_ACCOUNT_API_KEY_EXPIRED'
    ) {
      return res.status(401).json({ message: error.message });
    }

    return res.status(error?.status || 500).json({
      message: error?.message || 'Internal server error while validating API key or auth token.',
    });
  }
}

async function getAuthorizedPublicationSession(req, sessionId) {
  if (!sessionId || !mongoose.Types.ObjectId.isValid(sessionId)) {
    const error = new Error('session_id is required and must be a valid video session id.');
    error.status = 400;
    throw error;
  }

  await getDBConnectionString();

  const session = await VideoSession.findById(sessionId);
  if (!session) {
    const error = new Error('Video session not found.');
    error.status = 404;
    throw error;
  }

  const sessionOwnerId = session.userId?.toString?.() || session.userId;
  const requestUserId = req.userId?.toString?.() || req.userId;
  const requestingUser = mongoose.Types.ObjectId.isValid(requestUserId)
    ? await User.findById(requestUserId).select({ isAdminUser: 1 }).lean()
    : null;
  const canManageAnyPublication = Boolean(requestingUser?.isAdminUser);

  if ((!sessionOwnerId || sessionOwnerId !== requestUserId) && !canManageAnyPublication) {
    const error = new Error('Forbidden: You are not allowed to manage this session publication.');
    error.status = 403;
    throw error;
  }

  return session;
}

const formatPublicationManagementResponse = ({ publication, session, created = false }) => {
  const publicationData = publication?.toObject?.() || publication || {};
  const sessionData = session?.toObject?.() || session || {};
  const publicationId = publicationData._id?.toString?.() || publicationData.id || null;
  const sessionId = normalizeSessionId(publicationData.sessionId) ||
    normalizeSessionId(sessionData._id) ||
    normalizeSessionId(sessionData.id);
  if (publicationData.type === 'InteractiveVideo' && publicationData.manifest) {
    return {
      created,
      publication: serializeInteractivePublication(publicationData),
      session: {
        id: normalizeSessionId(sessionData._id) || sessionId,
        session_id: normalizeSessionId(sessionData._id) || sessionId,
        is_published: Boolean(sessionData.ispublishedVideo),
        published_publication_id: normalizeOptionalString(sessionData.publishedPublicationId),
        published_video_url: normalizeOptionalString(sessionData.publishedVideoURL),
        published_at: sessionData.publishedAt || null,
      },
    };
  }
  const summary = mapPublicationResponse(publicationData, null, new Map(), new Map(), true) || {};

  return {
    created,
    publication: {
      ...summary,
      id: publicationId,
      publication_id: publicationId,
      sessionId,
      session_id: sessionId,
      videoUrl: publicationData.videoURL || summary.videoUrl || null,
      video_url: publicationData.videoURL || summary.videoUrl || null,
      title: publicationData.title || summary.title || null,
      description: publicationData.description || summary.description || '',
      tags: normalizeTags(publicationData.tags),
      categories: normalizeTags(publicationData.categories),
      topics: normalizeTags(publicationData.topics),
      classification: publicationData.classification || {},
      creatorHandle: publicationData.creatorHandle || '',
      creator_handle: publicationData.creatorHandle || '',
      slug: publicationData.slug || null,
      imageHash: publicationData.imageHash || null,
      image_hash: publicationData.imageHash || null,
      splashImage: publicationData.splashImage || null,
      splash_image: publicationData.splashImage || null,
      imageModel: publicationData.imageModel || null,
      image_model: publicationData.imageModel || null,
      videoModel: publicationData.videoModel || null,
      video_model: publicationData.videoModel || null,
      originalPrompt: publicationData.originalPrompt || '',
      original_prompt: publicationData.originalPrompt || '',
      sessionTranscript: normalizePublicationTranscript(publicationData.sessionTranscript),
      session_transcript: normalizePublicationTranscript(publicationData.sessionTranscript),
      sessionLanguage: publicationData.sessionLanguage || null,
      session_language: publicationData.sessionLanguage || null,
      language: publicationData.language || publicationData.sessionLanguage || null,
      language_code: publicationData.language || publicationData.sessionLanguage || null,
      languageString: publicationData.languageString || null,
      language_string: publicationData.languageString || null,
      hasSubtitles: typeof publicationData.hasSubtitles === 'boolean'
        ? publicationData.hasSubtitles
        : summary.hasSubtitles ?? null,
      has_subtitles: typeof publicationData.hasSubtitles === 'boolean'
        ? publicationData.hasSubtitles
        : summary.has_subtitles ?? null,
      aspectRatio: publicationData.aspectRatio || summary.aspectRatio || null,
      aspect_ratio: publicationData.aspectRatio || summary.aspectRatio || null,
      createdAt: publicationData.createdAt || null,
      created_at: publicationData.createdAt || null,
      updatedAt: publicationData.updatedAt || null,
      updated_at: publicationData.updatedAt || null,
    },
    session: {
      id: normalizeSessionId(sessionData._id) || sessionId,
      session_id: normalizeSessionId(sessionData._id) || sessionId,
      is_published: Boolean(sessionData.ispublishedVideo),
      published_publication_id: normalizeOptionalString(sessionData.publishedPublicationId),
      published_video_url: normalizeOptionalString(sessionData.publishedVideoURL),
      published_at: sessionData.publishedAt || null,
    },
  };
};

function sendPublicationManagementError(res, error, fallbackMessage) {
  const statusCode = error?.status || error?.statusCode || 500;
  return res.status(statusCode).json({
    message: error?.message || fallbackMessage,
  });
}

async function handlePublishSessionPublication(req, res) {
  try {
    const payload = normalizeInputPayload(req);
    const sessionId = resolvePublicationSessionId(req, payload);
    const session = await getAuthorizedPublicationSession(req, sessionId);

    if (!isVideoSessionReadyForPublication(session)) {
      return res.status(409).json({
        message: 'Video is not ready to publish yet.',
      });
    }

    const publicationModel = isBranchedVideoSession(session)
      ? InteractivePublication
      : Publication;
    const existingPublication = await publicationModel.findOne({ sessionId }).lean();
    const publicationPayload = buildPublicationSessionPayload(
      sessionId,
      payload,
      existingPublication,
    );
    const publication = await createPublicationForSessionVideo(req.userId, publicationPayload);
    const refreshedSession = await VideoSession.findById(sessionId).lean();

    return res.status(existingPublication ? 200 : 201).json(
      formatPublicationManagementResponse({
        publication,
        session: refreshedSession,
        created: !existingPublication,
      }),
    );
  } catch (error) {
    console.error('Error publishing session publication:', error);
    return sendPublicationManagementError(
      res,
      error,
      'Internal server error while publishing session.',
    );
  }
}

async function handleEditSessionPublication(req, res) {
  try {
    const payload = normalizeInputPayload(req);
    const sessionId = resolvePublicationSessionId(req, payload);
    const session = await getAuthorizedPublicationSession(req, sessionId);
    const publicationModel = isBranchedVideoSession(session)
      ? InteractivePublication
      : Publication;
    const existingPublication = await publicationModel.findOne({ sessionId }).lean();

    if (!existingPublication) {
      return res.status(404).json({
        message: 'Publication not found for this session.',
      });
    }

    if (!isVideoSessionReadyForPublication(session)) {
      return res.status(409).json({
        message: 'Video is not ready to publish yet.',
      });
    }

    const publicationPayload = buildPublicationSessionPayload(
      sessionId,
      payload,
      existingPublication,
    );
    const publication = await createPublicationForSessionVideo(req.userId, publicationPayload);
    const refreshedSession = await VideoSession.findById(sessionId).lean();

    return res.status(200).json(
      formatPublicationManagementResponse({
        publication,
        session: refreshedSession,
        created: false,
      }),
    );
  } catch (error) {
    console.error('Error editing session publication:', error);
    return sendPublicationManagementError(
      res,
      error,
      'Internal server error while editing session publication.',
    );
  }
}

async function handleRevokeSessionPublication(req, res) {
  try {
    const payload = normalizeInputPayload(req);
    const sessionId = resolvePublicationSessionId(req, payload);
    const session = await getAuthorizedPublicationSession(req, sessionId);
    const publicationModel = isBranchedVideoSession(session)
      ? InteractivePublication
      : Publication;
    const existingPublication = await publicationModel.findOne({ sessionId }).lean();
    const wasPublished = Boolean(
      existingPublication ||
      session.ispublishedVideo ||
      session.publishedPublicationId ||
      session.publishedVideoURL
    );

    const response = await unpublishSessionVideo(req.userId, { sessionId });

    return res.status(200).json({
      revoked: wasPublished,
      publication_id: existingPublication?._id?.toString?.() || null,
      session: {
        id: sessionId,
        session_id: sessionId,
        is_published: false,
      },
      ...response,
    });
  } catch (error) {
    console.error('Error revoking session publication:', error);
    return sendPublicationManagementError(
      res,
      error,
      'Internal server error while revoking session publication.',
    );
  }
}

router.post('/publish', authenticatePublicationManagementRequest, handlePublishSessionPublication);
router.post('/edit', authenticatePublicationManagementRequest, handleEditSessionPublication);
router.post('/revoke', authenticatePublicationManagementRequest, handleRevokeSessionPublication);
router.post('/session/:sessionId?', authenticatePublicationManagementRequest, handlePublishSessionPublication);
router.patch('/session/:sessionId?', authenticatePublicationManagementRequest, handleEditSessionPublication);
router.delete('/session/:sessionId?', authenticatePublicationManagementRequest, handleRevokeSessionPublication);

router.get('/', async (req, res) => {
  try {
    await getDBConnectionString();

    const limitArg = Array.isArray(req.query.limit) ? req.query.limit[0] : req.query.limit;
    const limit = parseLimitedInteger(limitArg, 50, 200);
    const cursorArg = Array.isArray(req.query.cursor) ? req.query.cursor[0] : req.query.cursor;
    const cursorId = parseCursor(cursorArg);

    let viewerId = null;
    if (req.headers.authorization) {
      try {
        viewerId = await verifyUserAuthentication(req.headers);
      } catch (authError) {
        viewerId = null;
      }
    }

    const visibilityClauses = [
      { $or: [{ isHidden: { $exists: false } }, { isHidden: false }] },
      { $or: [{ isDeleted: { $exists: false } }, { isDeleted: false }] },
    ];

    const baseQuery = { $and: [...visibilityClauses] };
    const paginatedQuery = { $and: [...visibilityClauses] };

    if (cursorId) {
      paginatedQuery.$and.push({ _id: { $lt: cursorId } });
    }

    const [totalCount, publications] = await Promise.all([
      Publication.countDocuments(baseQuery).exec(),
      Publication.find(paginatedQuery)
        .sort({ _id: -1 })
        .limit(limit + 1)
        .lean()
        .exec(),
    ]);

    let hasMore = false;
    let nextCursor = null;
    let items = publications;

    if (items.length > limit) {
      hasMore = true;
      items = items.slice(0, limit);
    }

    if (hasMore && items.length > 0) {
      const lastItem = items[items.length - 1];
      nextCursor = lastItem?._id?.toString?.() ?? null;
    }

    const sessionAspectRatioMap = await hydrateMissingPublicationAspectRatios(items);

    const createdByIds = Array.from(
      new Set(
        items
          .map((publication) => {
            const createdBy = publication?.createdBy;
            if (!createdBy) {
              return null;
            }
            if (typeof createdBy === 'string') {
              return createdBy;
            }
            if (createdBy instanceof mongoose.Types.ObjectId) {
              return createdBy.toString();
            }
            if (
              typeof createdBy === 'object' &&
              typeof createdBy.toString === 'function'
            ) {
              return createdBy.toString();
            }
            return null;
          })
          .filter(Boolean)
      )
    );

    let botUserMap = new Map();
    const objectIdItems = createdByIds.filter((id) => mongoose.Types.ObjectId.isValid(id));
    if (objectIdItems.length > 0) {
      const botUsers = await User.find({
        _id: { $in: objectIdItems.map((id) => new mongoose.Types.ObjectId(id)) },
      })
        .select({ isBotUser: 1 })
        .lean()
        .exec();

      botUserMap = new Map(
        botUsers
          .filter((user) => user?._id)
          .map((user) => [user._id.toString(), Boolean(user.isBotUser)])
      );
    }

    const payload = items
      .map((publication) =>
        mapPublicationResponse(publication, viewerId, botUserMap, sessionAspectRatioMap, true)
      )
      .filter(Boolean);

    scheduleGalleryPublicationsReady(payload);

    res.json({
      items: payload,
      nextCursor,
      hasMore,
      totalCount,
    });
  } catch (error) {
    console.error('Error fetching publications:', error);
    res.status(500).json({ error: 'Failed to fetch publications.' });
  }
});

router.get('/:publicationId', async (req, res) => {
  try {
    await getDBConnectionString();

    const { publicationId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(publicationId)) {
      return res.status(400).json({ error: 'Invalid publication id.' });
    }

    let viewerId = null;
    if (req.headers.authorization) {
      try {
        viewerId = await verifyUserAuthentication(req.headers);
      } catch (authError) {
        viewerId = null;
      }
    }

    const publication = await Publication.findOne({
      _id: new mongoose.Types.ObjectId(publicationId),
      $and: [
        { $or: [{ isHidden: { $exists: false } }, { isHidden: false }] },
        { $or: [{ isDeleted: { $exists: false } }, { isDeleted: false }] },
      ],
    })
      .lean()
      .exec();

    if (!publication) {
      return res.status(404).json({ error: 'Publication not found.' });
    }

    const createdBy = publication?.createdBy;
    const createdById =
      typeof createdBy === 'string'
        ? createdBy
        : createdBy instanceof mongoose.Types.ObjectId
        ? createdBy.toString()
        : createdBy && typeof createdBy.toString === 'function'
        ? createdBy.toString()
        : null;

    let botUserMap = new Map();
    if (createdById && mongoose.Types.ObjectId.isValid(createdById)) {
      const author = await User.findById(new mongoose.Types.ObjectId(createdById))
        .select({ isBotUser: 1 })
        .lean()
        .exec();

      if (author?._id) {
        botUserMap = new Map([[author._id.toString(), Boolean(author.isBotUser)]]);
      }
    }

    const sessionAspectRatioMap = await hydrateMissingPublicationAspectRatios([publication]);
    const normalized = mapPublicationResponse(
      publication,
      viewerId,
      botUserMap,
      sessionAspectRatioMap,
      true,
    );
    if (!normalized) {
      return res.status(404).json({ error: 'Publication not available.' });
    }

    scheduleGalleryPublicationReady(publicationId);
    res.json({ publication: normalized });
  } catch (error) {
    console.error('Error fetching publication:', error);
    res.status(500).json({ error: 'Failed to fetch publication.' });
  }
});

router.get('/:publicationId/interactions', async (req, res) => {
  try {
    await getDBConnectionString();

    const { publicationId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(publicationId)) {
      return res.status(400).json({ error: 'Invalid publication id.' });
    }

    const publication = await Publication.findById(publicationId).lean();
    if (!publication) {
      return res.status(404).json({ error: 'Publication not found.' });
    }

    let viewerId = null;
    if (req.headers.authorization) {
      try {
        viewerId = await verifyUserAuthentication(req.headers);
      } catch (authError) {
        viewerId = null;
      }
    }

    const sessionAspectRatioMap = await hydrateMissingPublicationAspectRatios([publication]);
    const summary = mapPublicationResponse(
      publication,
      viewerId,
      new Map(),
      sessionAspectRatioMap
    );
    if (!summary) {
      return res.status(404).json({ error: 'Publication not available.' });
    }

    res.json({
      stats: summary.stats,
      viewerHasLiked: summary.viewerHasLiked,
    });
  } catch (error) {
    console.error('Error fetching publication interactions:', error);
    res.status(500).json({ error: 'Failed to fetch interactions.' });
  }
});

router.post('/:publicationId/like', async (req, res) => {
  try {
    await getDBConnectionString();

    let userId;
    try {
      userId = await verifyUserAuthentication(req.headers);
    } catch (authError) {
      return res.status(401).json({ error: 'Authentication required.' });
    }

    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ error: 'Invalid user identifier.' });
    }

    const { publicationId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(publicationId)) {
      return res.status(400).json({ error: 'Invalid publication id.' });
    }

    const publication = await Publication.findById(publicationId);
    if (!publication) {
      return res.status(404).json({ error: 'Publication not found.' });
    }

    const likedByStrings = extractLikedByStrings(publication.likes?.likedBy);
    const likedBySet = new Set(likedByStrings);

    let liked;
    if (likedBySet.has(userId)) {
      likedBySet.delete(userId);
      liked = false;
    } else {
      likedBySet.add(userId);
      liked = true;
    }

    const likedBy = Array.from(likedBySet).map((value) => new mongoose.Types.ObjectId(value));
    const likesCount = likedBy.length;

    publication.likes = {
      count: likesCount,
      likedBy,
    };

    await publication.save();

    res.json({
      liked,
      stats: {
        likes: likesCount,
        comments: Array.isArray(publication.comments) ? publication.comments.length : 0,
        shares: typeof publication.shares === 'number' ? publication.shares : 0,
      },
    });
  } catch (error) {
    console.error('Error toggling like:', error);
    res.status(500).json({ error: 'Failed to update like.' });
  }
});

router.post('/:publicationId/share', async (req, res) => {
  try {
    await getDBConnectionString();

    try {
      await verifyUserAuthentication(req.headers);
    } catch (authError) {
      return res.status(401).json({ error: 'Authentication required.' });
    }

    const { publicationId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(publicationId)) {
      return res.status(400).json({ error: 'Invalid publication id.' });
    }

    const updatedPublication = await Publication.findByIdAndUpdate(
      publicationId,
      { $inc: { shares: 1 } },
      { new: true }
    );

    if (!updatedPublication) {
      return res.status(404).json({ error: 'Publication not found.' });
    }

    const likedByStrings = extractLikedByStrings(updatedPublication.likes?.likedBy);
    const likesCount =
      typeof updatedPublication.likes?.count === 'number'
        ? updatedPublication.likes.count
        : likedByStrings.length;

    res.json({
      stats: {
        likes: likesCount,
        comments: Array.isArray(updatedPublication.comments)
          ? updatedPublication.comments.length
          : 0,
        shares: typeof updatedPublication.shares === 'number'
          ? updatedPublication.shares
          : 0,
      },
    });
  } catch (error) {
    console.error('Error recording share:', error);
    res.status(500).json({ error: 'Failed to record share.' });
  }
});

router.post('/:publicationId/comments', async (req, res) => {
  try {
    await getDBConnectionString();

    let userId;
    try {
      userId = await verifyUserAuthentication(req.headers);
    } catch (authError) {
      return res.status(401).json({ error: 'Authentication required.' });
    }

    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ error: 'Invalid user identifier.' });
    }

    const { publicationId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(publicationId)) {
      return res.status(400).json({ error: 'Invalid publication id.' });
    }

    const text = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
    if (!text) {
      return res.status(400).json({ error: 'Comment text is required.' });
    }

    const publication = await Publication.findById(publicationId);
    if (!publication) {
      return res.status(404).json({ error: 'Publication not found.' });
    }

    const user = await User.findById(userId).lean();
    if (!user) {
      return res.status(404).json({ error: 'User not found.' });
    }

    const creatorHandle =
      (typeof user.username === 'string' && user.username.trim()) ||
      (typeof user.displayName === 'string' && user.displayName.trim()) ||
      (typeof user.email === 'string' && user.email.trim()) ||
      'Anonymous';

    const comment = await Comment.create({
      publicationId: publication._id,
      text,
      createdBy: new mongoose.Types.ObjectId(userId),
      creatorHandle,
    });

    if (!Array.isArray(publication.comments)) {
      publication.comments = [];
    }
    publication.comments.push(comment._id);
    await publication.save();

    const likedByStrings = extractLikedByStrings(publication.likes?.likedBy);
    const likesCount =
      typeof publication.likes?.count === 'number'
        ? publication.likes.count
        : likedByStrings.length;

    res.status(201).json({
      comment: {
        id: comment._id.toString(),
        text: comment.text,
        creatorHandle: comment.creatorHandle,
        createdBy: comment.createdBy.toString(),
        createdAt: comment.createdAt,
        likes: comment.likes?.count ?? 0,
        isBotUser: Boolean(user.isBotUser),
      },
      stats: {
        likes: likesCount,
        comments: publication.comments.length,
        shares: typeof publication.shares === 'number' ? publication.shares : 0,
      },
    });
  } catch (error) {
    console.error('Error creating comment:', error);
    res.status(500).json({ error: 'Failed to create comment.' });
  }
});

router.get('/:publicationId/comments', async (req, res) => {
  try {
    await getDBConnectionString();

    const { publicationId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(publicationId)) {
      return res.status(400).json({ error: 'Invalid publication id.' });
    }

    const limitArg = Array.isArray(req.query.limit) ? req.query.limit[0] : req.query.limit;
    const limit = parseLimitedInteger(limitArg, 20, 100);

    const cursorRaw = Array.isArray(req.query.cursor) ? req.query.cursor[0] : req.query.cursor;
    const commentQuery = {
      publicationId: new mongoose.Types.ObjectId(publicationId),
    };

    if (cursorRaw && mongoose.Types.ObjectId.isValid(cursorRaw)) {
      commentQuery._id = { $lt: new mongoose.Types.ObjectId(cursorRaw) };
    }

    const comments = await Comment.find(commentQuery)
      .sort({ _id: -1 })
      .limit(limit + 1)
      .lean()
      .exec();

    const hasMore = comments.length > limit;
    const trimmed = hasMore ? comments.slice(0, limit) : comments;
    const nextCursor = hasMore ? trimmed[trimmed.length - 1]._id.toString() : null;

    const createdByIds = Array.from(
      new Set(
        trimmed
          .map((comment) => {
            const createdBy = comment.createdBy;
            if (!createdBy) {
              return null;
            }
            if (typeof createdBy === 'string') {
              return createdBy;
            }
            if (createdBy instanceof mongoose.Types.ObjectId) {
              return createdBy.toString();
            }
            if (
              typeof createdBy === 'object' &&
              typeof createdBy.toString === 'function'
            ) {
              return createdBy.toString();
            }
            return null;
          })
          .filter(Boolean)
      )
    );

    let botUserMap = new Map();
    const objectIdList = createdByIds.filter((id) => mongoose.Types.ObjectId.isValid(id));
    if (objectIdList.length > 0) {
      const users = await User.find({
        _id: { $in: objectIdList.map((id) => new mongoose.Types.ObjectId(id)) },
      })
        .select({ isBotUser: 1 })
        .lean()
        .exec();

      botUserMap = new Map(
        users
          .filter((user) => user && user._id)
          .map((user) => [user._id.toString(), Boolean(user.isBotUser)])
      );
    }

    res.json({
      items: trimmed.map((comment) => ({
        id: comment._id.toString(),
        text: comment.text,
        creatorHandle: comment.creatorHandle,
        createdBy: comment.createdBy?.toString?.() ?? '',
        createdAt: comment.createdAt,
        likes: comment.likes?.count ?? 0,
        isBotUser: botUserMap.get(comment.createdBy?.toString?.() ?? '') ?? false,
      })),
      nextCursor,
      hasMore,
    });
  } catch (error) {
    console.error('Error fetching comments:', error);
    res.status(500).json({ error: 'Failed to load comments.' });
  }
});

export default router;
