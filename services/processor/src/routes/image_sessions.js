import express from 'express';
import VideoSession from '../schema/VideoSession.js';
import {
  createVideoSession,
  getSessionDetails,
  requestGenerateImage,
  requestEditImage,
  updateLayerActiveItemList,
  getVideoSessionGenerationStatus,
  getVideoSessionEditStatus,
} from '../models/VideoSession.js';
import { normalizeResponseAssetUrl } from '../models/api/StatusAPI.js';
import { verifyUserAuth } from '../models/Auth.js';
import { upsertGlobalSessionMapping } from '../models/GlobalSession.js';
import { getCanvasDimensionsForAspectRatio } from '../utils/CanvasUtils.js';

const router = express.Router();

const normalizeThumbnail = (value) => {
  if (!value || typeof value !== 'string') return null;
  if (value.startsWith('http')) return value;
  return value.startsWith('/') ? value.slice(1) : value;
};

const normalizeHexColor = (value, fallback = '#ffffff') => {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  const shortHexPattern = /^#[0-9a-fA-F]{3}$/;
  const fullHexPattern = /^#[0-9a-fA-F]{6}$/;
  if (shortHexPattern.test(trimmed) || fullHexPattern.test(trimmed)) {
    return trimmed;
  }
  return fallback;
};

const resolveImageThumbnail = (session) => {
  const layer = session?.layers?.[0];
  const imageSession = layer?.imageSession;
  if (!imageSession) return null;

  if (imageSession.activeGeneratedImage) {
    const activeGeneratedImage = imageSession.activeGeneratedImage;
    return normalizeThumbnail(
      activeGeneratedImage.startsWith('assets_v2/') || activeGeneratedImage.startsWith('/assets_v2/')
        || activeGeneratedImage.startsWith('generations/') || activeGeneratedImage.startsWith('/generations/')
        ? activeGeneratedImage
        : `generations/${activeGeneratedImage}`
    );
  }
  if (imageSession.activeEditedImage) {
    return normalizeThumbnail(imageSession.activeEditedImage);
  }
  if (imageSession.activeSelectedImage) {
    return normalizeThumbnail(imageSession.activeSelectedImage);
  }

  const activeItems = Array.isArray(imageSession.activeItemList)
    ? imageSession.activeItemList.slice().reverse()
    : [];
  const imageItem = activeItems.find((item) => item && item.type === 'image' && item.src);
  if (imageItem?.src) {
    return normalizeThumbnail(imageItem.src);
  }

  return null;
};

const normalizeLibraryAssetSource = (value) => {
  const normalizeString = (input) => {
    if (typeof input !== 'string') return null;
    const trimmed = input.trim();
    if (!trimmed) return null;
    if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
      return trimmed;
    }
    if (trimmed.startsWith('/')) {
      return trimmed;
    }
    if (trimmed.startsWith('assets_v2/') || trimmed.startsWith('video/') || trimmed.startsWith('generations/')) {
      return `/${trimmed}`;
    }
    if (trimmed.includes('/video/')) {
      return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
    }
    if (trimmed.includes('generation') || trimmed.includes('outpaint')) {
      return `/generations/${trimmed.replace(/^\/?generations\//, '')}`;
    }
    return `/${trimmed}`;
  };

  if (typeof value === 'string') {
    return normalizeString(value);
  }

  if (!value || typeof value !== 'object') {
    return null;
  }

  const candidates = [
    value.src,
    value.image,
    value.imageUrl,
    value.image_url,
    value.url,
  ];

  for (const candidate of candidates) {
    const normalized = normalizeString(candidate);
    if (normalized) {
      return normalized;
    }
  }

  return null;
};

const resolveLibraryAssetNumber = (value) => {
  const parsedValue = Number(value);
  return Number.isFinite(parsedValue) && parsedValue > 0 ? parsedValue : null;
};

const resolveLibraryAssetDimensions = (asset) => {
  if (!asset || typeof asset !== 'object') {
    return {};
  }

  const width = resolveLibraryAssetNumber(
    asset.width ??
    asset.naturalWidth ??
    asset.imageWidth ??
    asset.metadata?.width
  );
  const height = resolveLibraryAssetNumber(
    asset.height ??
    asset.naturalHeight ??
    asset.imageHeight ??
    asset.metadata?.height
  );

  if (!width || !height) {
    return {};
  }

  return {
    width,
    height,
    aspectRatio: width / height,
  };
};

const extractSessionLibraryAssets = (session, req = null) => {
  const assets = [];
  const seen = new Set();
  const sessionId = session?._id?.toString?.() || null;

  const pushAsset = (rawAsset, sourceType) => {
    const normalizedSrc = normalizeLibraryAssetSource(rawAsset);
    if (!normalizedSrc || seen.has(normalizedSrc)) {
      return;
    }
    seen.add(normalizedSrc);
    const previewUrl = normalizeResponseAssetUrl(normalizedSrc, req) || normalizedSrc;
    const dimensions = resolveLibraryAssetDimensions(rawAsset);
    assets.push({
      src: normalizedSrc,
      rawSrc: normalizedSrc,
      url: previewUrl,
      previewUrl,
      imageUrl: previewUrl,
      ...dimensions,
      sessionId,
      sourceType,
    });
  };

  const generations = Array.isArray(session?.generations) ? session.generations : [];
  for (let index = generations.length - 1; index >= 0; index -= 1) {
    pushAsset(generations[index], 'generation');
  }

  const layers = Array.isArray(session?.layers) ? session.layers : [];
  for (const layer of layers) {
    const imageSession = layer?.imageSession;
    if (!imageSession || typeof imageSession !== 'object') {
      continue;
    }
    if (imageSession.activeGeneratedImage) {
      pushAsset(imageSession.activeGeneratedImage, 'activeGeneratedImage');
    }
    if (imageSession.activeEditedImage) {
      pushAsset(imageSession.activeEditedImage, 'activeEditedImage');
    }
  }

  return assets;
};

router.get('/list', async function (req, res) {
  const headers = req.headers;
  const userId = verifyUserAuth(headers);
  if (!userId) {
    return res.status(401).send('Unauthorized');
  }

  try {
    let { page = '1', limit = '10', aspectRatio = 'All' } = req.query;
    page = parseInt(page, 10);
    limit = parseInt(limit, 10);

    const query = { userId, sessionType: 'image' };
    if (aspectRatio && aspectRatio !== 'All') {
      query.aspectRatio = aspectRatio;
    }

    const skip = (page - 1) * limit;
    const total = await VideoSession.countDocuments(query);
    const totalPages = Math.ceil(total / limit) || 1;

    const sessionList = await VideoSession.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    const sessionData = sessionList
      .map((session, idx) => {
        const sessionId = session?._id?.toString();
        if (!sessionId) return null;
        return {
          name: session.sessionName ? session.sessionName : `Image Session ${idx + 1}`,
          id: session._id,
          thumbnail: resolveImageThumbnail(session),
        };
      })
      .filter(Boolean);

    return res.json({
      data: sessionData,
      total,
      totalPages,
      currentPage: page,
      pageSize: limit,
    });
  } catch (error) {
    console.error('[image_sessions][list] failed', error);
    return res.status(400).send('Error listing image sessions');
  }
});

router.post('/create_session', async function (req, res) {
  const headers = req.headers;
  const userId = verifyUserAuth(headers);
  if (!userId) {
    res.status(401).send('Unauthorized');
    return;
  }

  try {
    const payload = { ...(req.body || {}) };
    if (!payload.aspectRatio) {
      payload.aspectRatio = '1:1';
    }
    const shouldAddBackgroundLayer =
      payload.addBackgroundLayer === true || payload.addBackgroundLayer === 'true';
    const backgroundLayerColor = normalizeHexColor(payload.backgroundLayerColor, '#ffffff');

    const requestedCanvasDimensions =
      payload.canvasDimensions && typeof payload.canvasDimensions === 'object'
        ? payload.canvasDimensions
        : {};
    const fallbackCanvasDimensions = getCanvasDimensionsForAspectRatio(payload.aspectRatio);
    const rawWidth = Number(requestedCanvasDimensions.width);
    const rawHeight = Number(requestedCanvasDimensions.height);
    payload.canvasDimensions = {
      width: Number.isFinite(rawWidth) && rawWidth > 0 ? Math.round(rawWidth) : fallbackCanvasDimensions.width,
      height: Number.isFinite(rawHeight) && rawHeight > 0 ? Math.round(rawHeight) : fallbackCanvasDimensions.height,
    };

    if (typeof payload.sessionName === 'string') {
      const normalizedSessionName = payload.sessionName.trim();
      if (normalizedSessionName) {
        payload.sessionName = normalizedSessionName;
      } else {
        delete payload.sessionName;
      }
    } else {
      delete payload.sessionName;
    }

    const session = await createVideoSession(userId, payload);
    session.sessionType = 'image';
    if (payload.sessionName) {
      session.sessionName = payload.sessionName;
    }
    session.canvasDimensions = payload.canvasDimensions;
    session.canvasWidth = payload.canvasDimensions.width;
    session.canvasHeight = payload.canvasDimensions.height;

    if (shouldAddBackgroundLayer && Array.isArray(session.layers) && session.layers[0]?.imageSession) {
      const backgroundItem = {
        id: 'item_0',
        type: 'shape',
        subType: 'background',
        shape: 'rectangle',
        config: {
          x: 0,
          y: 0,
          width: payload.canvasDimensions.width,
          height: payload.canvasDimensions.height,
          fillColor: backgroundLayerColor,
          strokeColor: backgroundLayerColor,
          strokeWidth: 0,
        },
      };
      session.layers[0].imageSession.activeItemList = [backgroundItem];
      session.markModified('layers');
    }

    await session.save();

    await upsertGlobalSessionMapping({
      sessionId: session._id,
      sessionType: 'image',
      userId,
      status: 'INIT',
      requestType: 'APP',
      metadata: {
        aspectRatio: session.aspectRatio || payload.aspectRatio || '1:1',
        canvasDimensions: payload.canvasDimensions,
        sessionName: session.sessionName || null,
        addBackgroundLayer: shouldAddBackgroundLayer,
        backgroundLayerColor: shouldAddBackgroundLayer ? backgroundLayerColor : null,
      },
    });

    res.json(session);
  } catch (error) {
    res.status(400).send('Error creating image session');
  }
});

router.get('/session_details', async function (req, res) {
  const headers = req.headers;
  const { id } = req.query;
  const userId = verifyUserAuth(headers);
  if (!userId) {
    res.status(401).send('Unauthorized');
    return;
  }

  try {
    const sessionData = await getSessionDetails({ userId, id });
    res.send(sessionData);
  } catch (error) {
    res.status(400).send('Error getting image session details');
  }
});

router.get('/library_assets', async function (req, res) {
  const headers = req.headers;
  const userId = verifyUserAuth(headers);
  if (!userId) {
    res.status(401).send('Unauthorized');
    return;
  }

  try {
    const { sessionId, page = '1', limit = '40' } = req.query || {};
    const parsedPage = Number.parseInt(page, 10);
    const parsedLimit = Number.parseInt(limit, 10);
    const safePage = Number.isNaN(parsedPage) || parsedPage < 1 ? 1 : parsedPage;
    const safeLimit = Number.isNaN(parsedLimit) || parsedLimit < 1 ? 40 : Math.min(parsedLimit, 100);

    const currentSessionQuery = { userId, sessionType: 'image' };
    if (sessionId) {
      currentSessionQuery._id = sessionId;
    }

    const currentSession = await VideoSession.findOne(currentSessionQuery)
      .select('_id generations layers updatedAt createdAt')
      .lean();

    const currentSessionAssets = currentSession ? extractSessionLibraryAssets(currentSession, req) : [];
    const currentSessionId = currentSession?._id?.toString?.() || null;

    const globalQuery = { userId, sessionType: 'image' };
    if (currentSessionId) {
      globalQuery._id = { $ne: currentSessionId };
    }

    const sessions = await VideoSession.find(globalQuery)
      .select('_id generations layers updatedAt createdAt')
      .sort({ updatedAt: -1, createdAt: -1, _id: -1 })
      .lean();

    const seenGlobalAssets = new Set();
    const globalAssets = [];

    sessions.forEach((session) => {
      const sessionAssets = extractSessionLibraryAssets(session, req);
      sessionAssets.forEach((asset) => {
        const dedupeKey = typeof asset?.src === 'string' ? asset.src : null;
        if (!dedupeKey || seenGlobalAssets.has(dedupeKey)) {
          return;
        }
        seenGlobalAssets.add(dedupeKey);
        globalAssets.push(asset);
      });
    });

    const totalItems = globalAssets.length;
    const totalPages = Math.max(1, Math.ceil(totalItems / safeLimit));
    const boundedPage = Math.min(safePage, totalPages);
    const startIndex = (boundedPage - 1) * safeLimit;
    const paginatedAssets = globalAssets.slice(startIndex, startIndex + safeLimit);

    res.json({
      currentSessionAssets,
      globalSessionAssets: paginatedAssets,
      pagination: {
        page: boundedPage,
        pageSize: safeLimit,
        totalItems,
        totalPages,
        hasNextPage: boundedPage < totalPages,
        hasPreviousPage: boundedPage > 1,
      },
    });
  } catch (error) {
    console.error('[image_sessions][library_assets] failed', error);
    res.status(400).send('Error loading image library assets');
  }
});

router.post('/update_active_item_list', async function (req, res) {
  const payload = req.body;
  const headers = req.headers;
  const userId = verifyUserAuth(headers);
  if (!userId) {
    res.status(401).send('Unauthorized');
    return;
  }

  try {
    const sessionDataResponse = await updateLayerActiveItemList(userId, payload);
    res.json(sessionDataResponse);
  } catch (error) {
    res.status(400).send('Error updating active item list');
  }
});

router.post('/request_generate', async function (req, res) {
  const headers = req.headers;
  const userId = verifyUserAuth(headers);
  if (!userId) {
    res.status(401).send('Unauthorized');
    return;
  }

  try {
    const payload = req.body;
    const sessionData = await requestGenerateImage(userId, payload);
    res.json(sessionData);
  } catch (error) {
    res.status(400).send('Error requesting image generation');
  }
});

router.get('/generate_status', async function (req, res) {
  const { id, layerId } = req.query;
  try {
    const generationStatus = await getVideoSessionGenerationStatus(id, layerId);
    res.send(generationStatus);
  } catch (error) {
    res.status(400).send('Error getting image generation status');
  }
});

router.post('/request_edit_image', async function (req, res) {
  const headers = req.headers;
  const userId = verifyUserAuth(headers);
  if (!userId) {
    res.status(401).send('Unauthorized');
    return;
  }

  try {
    const payload = req.body;
    const sessionData = await requestEditImage(userId, payload);
    res.json(sessionData);
  } catch (error) {
    res.status(400).send('Error requesting image edit');
  }
});

router.get('/edit_status', async function (req, res) {
  const { id, layerId } = req.query;
  try {
    const generationStatus = await getVideoSessionEditStatus(id, layerId);
    res.send(generationStatus);
  } catch (error) {
    res.status(400).send('Error getting image edit status');
  }
});

router.post('/update_aspect_ratio', async function (req, res) {
  const headers = req.headers;
  const userId = verifyUserAuth(headers);
  if (!userId) {
    res.status(401).send('Unauthorized');
    return;
  }
  const { sessionId, aspectRatio, canvasDimensions: requestedCanvasDimensions } = req.body || {};
  if (!sessionId || !aspectRatio) {
    res.status(400).send('sessionId and aspectRatio are required');
    return;
  }

  try {
    const fallbackCanvasDimensions = getCanvasDimensionsForAspectRatio(aspectRatio);
    const rawWidth = Number(requestedCanvasDimensions?.width);
    const rawHeight = Number(requestedCanvasDimensions?.height);
    const canvasDimensions = {
      width: Number.isFinite(rawWidth) && rawWidth > 0 ? Math.round(rawWidth) : fallbackCanvasDimensions.width,
      height: Number.isFinite(rawHeight) && rawHeight > 0 ? Math.round(rawHeight) : fallbackCanvasDimensions.height,
    };

    const session = await VideoSession.findOne({ _id: sessionId, userId });
    if (!session) {
      res.status(404).send('Session not found');
      return;
    }

    session.aspectRatio = aspectRatio;
    session.canvasDimensions = canvasDimensions;
    session.canvasWidth = canvasDimensions.width;
    session.canvasHeight = canvasDimensions.height;

    const backgroundItem = session.layers?.[0]?.imageSession?.activeItemList?.find(
      (item) => item?.type === 'shape' && item?.subType === 'background'
    );

    if (backgroundItem?.config) {
      backgroundItem.config = {
        ...backgroundItem.config,
        x: 0,
        y: 0,
        width: canvasDimensions.width,
        height: canvasDimensions.height,
      };
      session.markModified('layers');
    }

    await session.save();
    res.json({ session });
  } catch (error) {
    res.status(400).send('Error updating aspect ratio');
  }
});

export default router;
