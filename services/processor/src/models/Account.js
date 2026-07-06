import { getDBConnectionString } from './DBString.js';
import User from '../schema/User.js';
import dayjs from 'dayjs';
import CouponCode from '../schema/CouponCode.js';
import GeneratedImage from '../schema/generations/GeneratedImage.js';
import GeneratedAIVideo from '../schema/generations/GeneratedAIVideo.js';
import GeneratedMusic from '../schema/generations/GeneratedMusic.js';
import VideoSession from '../schema/VideoSession.js';
import { buildSecureMediaDeliveryUrl } from './AWS.js';

export async function getUserImages(userId) {
  const db = await getDBConnectionString();
  const sessionData = await VideoSession.find({
    userId: userId

  })

  let generationImages = [];
  for (const session of sessionData) {
    const sessionLayers = session.layers;
    for (const layer of sessionLayers) {
      if (layer.imageSession) {
        const layerGenerations = layer.imageSession.generations;
        if (layerGenerations && layerGenerations.length > 0) {
          generationImages = generationImages.concat(layerGenerations);
        }
      }
    }
  }

  return generationImages;
}

export async function getUserMusic(userId) {
  const db = await getDBConnectionString();
  const sessionData = await VideoSession.find({
    userId: userId
  })

  let generationSounds = [];
  for (const session of sessionData) {
    const sessionAudioLayers = session.layers;
    const sessionMusicLayers = sessionAudioLayers.filter(layer => layer.generationStatus === 'music');

    for (const layer of sessionMusicLayers) {
      const localAudioLinks = layer.localAudioLinks;
      if (localAudioLinks && localAudioLinks.length > 0) {
        generationSounds = generationSounds.concat(localAudioLinks);
      }
    }
  }

  return generationSounds;
}








export async function requestRedeemCouponCode(userId, payload) {
  const { couponCode, redemptionType } = payload;


  await getDBConnectionString();

  const userData = await User.findOne({ _id: userId });


  if (!userData) {
    return {
      success: false,
      message: 'User not found.',
    };
  }

  const currentTime = dayjs();

  if (userData.couponCodeRedemptionRetriesLastUpdated) {
    const retriesLastUpdated = dayjs(userData.couponCodeRedemptionRetriesLastUpdated);
    const isCooldownActive = userData.couponCodeRedemptionRetries && userData.couponCodeRedemptionRetries > 3 && currentTime.diff(retriesLastUpdated, 'hour') < 24;

    if (isCooldownActive) {
      return {
        success: false,
        message: 'You have exceeded the maximum number of redemption attempts. Please try again after 24 hours.',
      };
    }

  }
  try {
    // Check if the coupon exists and matches the redemption type
    const coupon = await CouponCode.findOne({
      couponCode: couponCode,
      redemptionActive: true,
      redemptionStartDate: { $lte: new Date() }, // Coupon is valid from the start date
      redemptionEndDate: { $gte: new Date() }, // Coupon is valid until the end date
    });



    if (!coupon) {
      throw new Error('Invalid or expired coupon code.');
    }

    // Check if the coupon has reached its redemption limit
    if (coupon.redemptionCount >= coupon.redemptionLimit) {
      throw new Error('Coupon has reached its redemption limit.');
    }

    // Check if the user has already redeemed this coupon
    if (coupon.redeemedUsers.includes(userId)) {
      throw new Error('You have already redeemed this coupon.');
    }

    // Reset the retries counter on successful redemption
    await User.updateOne({ _id: userId }, {
      couponCodeRedemptionRetries: 0,
      couponCodeRedemptionRetriesLastUpdated: currentTime.toDate(),
    });

    return { success: true, coupon: coupon };
  } catch (error) {
    console.error('Error redeeming coupon:', error);

    // Increment the retries counter and update the last updated timestamp
    const retries = userData.couponCodeRedemptionRetries + 1;
    await User.updateOne(
      { _id: userId },
      {
        couponCodeRedemptionRetries: retries,
        couponCodeRedemptionRetriesLastUpdated: currentTime.toDate(),
      }
    );

    return { success: false, message: error.message };
  }
}




export async function requestUserImageGenerations(userId, options = {}) {
  await getDBConnectionString();

  const {
    page = 1,
    pageSize = 20,
  } = options;

  const parsedPage = Number.parseInt(page, 10);
  const parsedPageSize = Number.parseInt(pageSize, 10);

  const safePage = Number.isNaN(parsedPage) || parsedPage < 1 ? 1 : parsedPage;
  const boundedPageSize = Number.isNaN(parsedPageSize) || parsedPageSize < 1 ? 20 : Math.min(parsedPageSize, 100);

  const skip = (safePage - 1) * boundedPageSize;

  const [items, totalItems] = await Promise.all([
    GeneratedImage.find({ userId })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(boundedPageSize)
      .lean(),
    GeneratedImage.countDocuments({ userId }),
  ]);

  const totalPages = boundedPageSize === 0 ? 0 : Math.ceil(totalItems / boundedPageSize);

  const normalizedItems = items.map((item) => {
    const imagePath = normalizeImageAssetPath(item?.url);
    return {
      ...item,
      rawUrl: item?.url || null,
      assetPath: imagePath,
      displayUrl: imagePath,
      imageUrl: imagePath,
      thumbnailPath: imagePath,
      thumbnail: imagePath,
    };
  });

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

function buildSecureImageAssetPath(value) {
  if (!value) {
    return null;
  }

  if (/^https?:\/\//i.test(value)) {
    try {
      const parsedUrl = new URL(value);
      const pathname = decodeURIComponent(parsedUrl.pathname).replace(/^\/+/, '');
      if (pathname.startsWith('assets_v2/')) {
        return buildSecureMediaDeliveryUrl(pathname) || `/${pathname}`;
      }
    } catch {}
  }

  const relativePath = value.replace(/^\/+/, '');
  if (relativePath.startsWith('assets_v2/')) {
    return buildSecureMediaDeliveryUrl(relativePath) || `/${relativePath}`;
  }

  return buildSecureMediaDeliveryUrl(value);
}

export function normalizeImageAssetPath(value) {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmedValue = value.trim();
  if (!trimmedValue) {
    return null;
  }

  if (/^https?:\/\//i.test(trimmedValue)) {
    return buildSecureImageAssetPath(trimmedValue) || trimmedValue;
  }

  if (/^data:|^blob:/i.test(trimmedValue)) {
    return trimmedValue;
  }

  if (trimmedValue.startsWith('//')) {
    return `https:${trimmedValue}`;
  }

  const relativePath = trimmedValue.replace(/^\/+/, '');
  if (!relativePath) {
    return null;
  }

  if (relativePath.startsWith('assets_v2/')) {
    return buildSecureImageAssetPath(relativePath) || `/${relativePath}`;
  }

  if (relativePath.startsWith('generations/')) {
    return `/${relativePath}`;
  }

  if (relativePath.startsWith('assets/generations/')) {
    return `/${relativePath.replace(/^assets\//, '')}`;
  }

  return `/generations/${relativePath.replace(/^generations\//, '')}`;
}

function normalizeVideoAssetPath(value) {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmedValue = value.trim();
  if (!trimmedValue) {
    return null;
  }

  if (/^https?:\/\//i.test(trimmedValue)) {
    return trimmedValue;
  }

  return trimmedValue.startsWith('/') ? trimmedValue : `/${trimmedValue}`;
}

function getVideoGenerationSourceLabel(generationType = 'ai_video') {
  const normalizedType = typeof generationType === 'string'
    ? generationType.trim().toLowerCase()
    : 'ai_video';

  if (normalizedType === 'lip_sync') {
    return 'Lip Sync Video';
  }
  if (normalizedType === 'sound_effect') {
    return 'Sound Effect Video';
  }
  if (normalizedType === 'user_video') {
    return 'Uploaded Video';
  }

  return 'AI Video';
}

function getImageGenerationSourceLabel(generationType = 'generate') {
  const normalizedType = typeof generationType === 'string'
    ? generationType.trim().toLowerCase()
    : 'generate';

  if (normalizedType === 'edit') {
    return 'Edited Image';
  }
  if (normalizedType === 'upscale') {
    return 'Upscaled Image';
  }

  return 'Image';
}

function resolveSessionProjectName(sessionData = {}) {
  if (typeof sessionData?.sessionName === 'string' && sessionData.sessionName.trim()) {
    return sessionData.sessionName.trim();
  }

  const sessionId = sessionData?._id?.toString?.() || sessionData?._id || sessionData?.sessionId || null;
  if (typeof sessionId === 'string' && sessionId.trim()) {
    return `Project ${sessionId.trim().slice(-6)}`;
  }

  return null;
}

function getSessionPromptPreview(sessionData = {}) {
  if (!Array.isArray(sessionData?.promptList)) {
    return null;
  }

  const promptList = sessionData.promptList
    .filter((prompt) => typeof prompt === 'string' && prompt.trim())
    .map((prompt) => prompt.trim());

  if (!promptList.length) {
    return null;
  }

  return promptList.slice(0, 2).join(' • ');
}

function getGallerySessionMetadataMap(sessionRecords = []) {
  return sessionRecords.reduce((metadataMap, sessionData) => {
    const sessionId = sessionData?._id?.toString?.() || sessionData?._id;
    if (!sessionId) {
      return metadataMap;
    }

    metadataMap[sessionId] = {
      sessionId,
      sessionName: typeof sessionData?.sessionName === 'string' ? sessionData.sessionName.trim() : null,
      projectName: resolveSessionProjectName(sessionData),
      aspectRatio: typeof sessionData?.aspectRatio === 'string' && sessionData.aspectRatio.trim()
        ? sessionData.aspectRatio.trim()
        : null,
      sessionType: typeof sessionData?.sessionType === 'string' && sessionData.sessionType.trim()
        ? sessionData.sessionType.trim()
        : null,
    };
    return metadataMap;
  }, {});
}

function buildGenerationSearchMatcher(search = '') {
  const normalizedSearch = typeof search === 'string' ? search.trim().toLowerCase() : '';
  if (!normalizedSearch) {
    return () => true;
  }

  return (item = {}) => [
    item?.title,
    item?.description,
    item?.prompt,
    item?.model,
    item?.sourceLabel,
    item?.projectName,
    item?.aspectRatio,
  ].some((value) => typeof value === 'string' && value.toLowerCase().includes(normalizedSearch));
}

function mapGeneratedImageToGalleryItem(item = {}, sessionMetadata = {}) {
  const imagePath = normalizeImageAssetPath(item?.url);
  if (!imagePath) {
    return null;
  }

  const generationType = typeof item?.generationType === 'string' && item.generationType.trim()
    ? item.generationType.trim().toLowerCase()
    : 'generate';
  const sourceLabel = getImageGenerationSourceLabel(generationType);
  const projectName = sessionMetadata?.projectName || null;
  const fallbackTitle = typeof item?.prompt === 'string' && item.prompt.trim()
    ? item.prompt.trim()
    : 'Generated image';

  return {
    _id: item?._id?.toString?.() || item?._id || `image:${imagePath}`,
    mediaType: 'image',
    sourceType: generationType,
    generationType,
    sourceLabel,
    title: typeof item?.description === 'string' && item.description.trim() ? item.description.trim() : fallbackTitle,
    description: typeof item?.description === 'string' && item.description.trim() ? item.description.trim() : fallbackTitle,
    prompt: typeof item?.prompt === 'string' && item.prompt.trim() ? item.prompt.trim() : null,
    model: typeof item?.model === 'string' && item.model.trim() ? item.model.trim() : null,
    url: imagePath,
    assetPath: imagePath,
    thumbnailPath: imagePath,
    thumbnail: imagePath,
    sessionId: item?.sessionId || null,
    projectName,
    aspectRatio: typeof item?.aspectRatio === 'string' && item.aspectRatio.trim()
      ? item.aspectRatio.trim()
      : sessionMetadata?.aspectRatio || null,
    userId: item?.userId || null,
    createdAt: item?.createdAt || null,
    updatedAt: item?.updatedAt || item?.createdAt || null,
  };
}

function mapGeneratedVideoToGalleryItem(item = {}, sessionMetadata = {}) {
  const videoPath = normalizeVideoAssetPath(item?.url);
  const remoteVideoPath = normalizeVideoAssetPath(item?.remoteUrl);
  const primaryVideoPath = videoPath || remoteVideoPath;
  if (!primaryVideoPath) {
    return null;
  }

  const generationType = typeof item?.generationType === 'string' && item.generationType.trim()
    ? item.generationType.trim().toLowerCase()
    : 'ai_video';
  const sourceLabel = getVideoGenerationSourceLabel(generationType);
  const projectName = sessionMetadata?.projectName || null;
  const fallbackTitle = typeof item?.prompt === 'string' && item.prompt.trim()
    ? item.prompt.trim()
    : sourceLabel;

  return {
    _id: item?._id?.toString?.() || item?._id || `video:${primaryVideoPath}`,
    mediaType: 'video',
    sourceType: generationType,
    generationType,
    sourceLabel,
    title: typeof item?.description === 'string' && item.description.trim() ? item.description.trim() : fallbackTitle,
    description: typeof item?.description === 'string' && item.description.trim() ? item.description.trim() : fallbackTitle,
    prompt: typeof item?.prompt === 'string' && item.prompt.trim() ? item.prompt.trim() : null,
    model: typeof item?.model === 'string' && item.model.trim() ? item.model.trim() : null,
    audioPrompt: typeof item?.audioPrompt === 'string' && item.audioPrompt.trim() ? item.audioPrompt.trim() : null,
    duration: Number.isFinite(Number(item?.duration)) && Number(item.duration) > 0
      ? Math.round(Number(item.duration) * 100) / 100
      : null,
    url: remoteVideoPath || primaryVideoPath,
    assetPath: primaryVideoPath,
    remoteUrl: remoteVideoPath || null,
    remoteURL: remoteVideoPath || null,
    thumbnailPath: normalizeImageAssetPath(item?.thumbnailPath) || null,
    thumbnail: normalizeImageAssetPath(item?.thumbnailPath) || null,
    endThumbnailPath: normalizeImageAssetPath(item?.endThumbnailPath) || null,
    thumbnailVideoPath: normalizeVideoAssetPath(item?.thumbnailVideoPath) || null,
    thumbnailVideoRemoteUrl: normalizeVideoAssetPath(item?.thumbnailVideoRemoteUrl) || null,
    previewVideoPath: normalizeVideoAssetPath(item?.thumbnailVideoRemoteUrl) || normalizeVideoAssetPath(item?.thumbnailVideoPath) || null,
    sessionId: item?.sessionId || null,
    layerId: item?.layerId || null,
    projectName,
    aspectRatio: sessionMetadata?.aspectRatio || null,
    userId: item?.userId || null,
    createdAt: item?.createdAt || null,
    updatedAt: item?.updatedAt || item?.createdAt || null,
  };
}

function mapFinalRenderToGalleryItem(sessionData = {}) {
  const sessionId = sessionData?._id?.toString?.() || sessionData?._id;
  const videoPath = normalizeVideoAssetPath(sessionData?.remoteURL) || normalizeVideoAssetPath(sessionData?.videoLink);
  if (!sessionId || !videoPath) {
    return null;
  }

  const projectName = resolveSessionProjectName(sessionData);
  const promptPreview = getSessionPromptPreview(sessionData);
  const title = projectName || 'Completed render';
  const normalizedSplashImage = normalizeVideoAssetPath(sessionData?.splashImage);
  const thumbnailPath = normalizedSplashImage || `/video/splash/${sessionId}/splash.png`;
  const duration = Number(sessionData?.totalDuration);

  return {
    _id: `final_render:${sessionId}`,
    mediaType: 'video',
    sourceType: 'final_render',
    generationType: 'final_render',
    sourceLabel: 'Final Render',
    title,
    description: title,
    prompt: promptPreview,
    model: null,
    url: videoPath,
    assetPath: videoPath,
    thumbnailPath,
    thumbnail: thumbnailPath,
    thumbnailVideoPath: null,
    previewVideoPath: null,
    duration: Number.isFinite(duration) && duration > 0 ? Math.round(duration * 100) / 100 : null,
    sessionId,
    layerId: null,
    projectName,
    aspectRatio: typeof sessionData?.aspectRatio === 'string' && sessionData.aspectRatio.trim()
      ? sessionData.aspectRatio.trim()
      : null,
    userId: sessionData?.userId || null,
    createdAt: sessionData?.createdAt || null,
    updatedAt: sessionData?.updatedAt || sessionData?.createdAt || null,
  };
}

export async function requestUserGenerationsGallery(userId, options = {}) {
  await getDBConnectionString();

  const {
    page = 1,
    pageSize = 80,
    search = '',
  } = options;

  const parsedPage = Number.parseInt(page, 10);
  const parsedPageSize = Number.parseInt(pageSize, 10);

  const safePage = Number.isNaN(parsedPage) || parsedPage < 1 ? 1 : parsedPage;
  const boundedPageSize = Number.isNaN(parsedPageSize) || parsedPageSize < 1 ? 80 : Math.min(parsedPageSize, 200);
  const normalizedSearch = typeof search === 'string' ? search.trim() : '';
  const matchGallerySearch = buildGenerationSearchMatcher(normalizedSearch);
  const safeUserId = userId?.toString?.() || userId;

  const imageFilter = { userId: safeUserId };
  if (normalizedSearch) {
    imageFilter.$or = [
      { description: { $regex: normalizedSearch, $options: 'i' } },
      { prompt: { $regex: normalizedSearch, $options: 'i' } },
      { model: { $regex: normalizedSearch, $options: 'i' } },
      { generationType: { $regex: normalizedSearch, $options: 'i' } },
    ];
  }

  const videoFilter = { userId: safeUserId };
  if (normalizedSearch) {
    videoFilter.$or = [
      { description: { $regex: normalizedSearch, $options: 'i' } },
      { prompt: { $regex: normalizedSearch, $options: 'i' } },
      { model: { $regex: normalizedSearch, $options: 'i' } },
      { generationType: { $regex: normalizedSearch, $options: 'i' } },
    ];
  }

  const completedRenderFilter = {
    userId: safeUserId,
    $or: [
      { remoteURL: { $exists: true, $nin: [null, ''] } },
      { videoLink: { $exists: true, $nin: [null, ''] } },
    ],
    expressGenerationPending: { $ne: true },
    videoGenerationPending: { $ne: true },
    expressGenerationFailed: { $ne: true },
    expressGenerationCancelled: { $ne: true },
  };

  const [images, videos, completedRenders] = await Promise.all([
    GeneratedImage.find(imageFilter)
      .select('url description prompt sessionId userId generationType model aspectRatio createdAt updatedAt')
      .lean(),
    GeneratedAIVideo.find(videoFilter)
      .select('url remoteUrl description prompt sessionId layerId userId model audioPrompt duration generationType thumbnailPath endThumbnailPath thumbnailVideoPath thumbnailVideoRemoteUrl createdAt updatedAt')
      .lean(),
    VideoSession.find(completedRenderFilter)
      .select('_id userId sessionName promptList aspectRatio splashImage remoteURL videoLink totalDuration createdAt updatedAt')
      .lean(),
  ]);

  const relatedSessionIds = [
    ...images.map((item) => item?.sessionId),
    ...videos.map((item) => item?.sessionId),
    ...completedRenders.map((item) => item?._id?.toString?.() || item?._id),
  ]
    .filter((value) => typeof value === 'string' && /^[a-f0-9]{24}$/i.test(value));

  const relatedSessions = relatedSessionIds.length > 0
    ? await VideoSession.find({
        _id: { $in: Array.from(new Set(relatedSessionIds)) },
        userId: safeUserId,
      })
        .select('_id sessionName aspectRatio sessionType')
        .lean()
    : [];

  const sessionMetadataMap = getGallerySessionMetadataMap(relatedSessions);
  const items = [
    ...images.map((item) => mapGeneratedImageToGalleryItem(item, sessionMetadataMap[item?.sessionId] || {})),
    ...videos.map((item) => mapGeneratedVideoToGalleryItem(item, sessionMetadataMap[item?.sessionId] || {})),
    ...completedRenders.map((item) => mapFinalRenderToGalleryItem(item)),
  ]
    .filter(Boolean)
    .filter((item) => matchGallerySearch(item))
    .sort((leftItem, rightItem) => {
      const leftTimestamp = Date.parse(leftItem?.updatedAt || leftItem?.createdAt || 0) || 0;
      const rightTimestamp = Date.parse(rightItem?.updatedAt || rightItem?.createdAt || 0) || 0;
      return rightTimestamp - leftTimestamp;
    });

  const totalItems = items.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / boundedPageSize));
  const boundedPage = Math.min(safePage, totalPages);
  const startIndex = (boundedPage - 1) * boundedPageSize;

  return {
    items: items.slice(startIndex, startIndex + boundedPageSize),
    pagination: {
      page: boundedPage,
      pageSize: boundedPageSize,
      totalItems,
      totalPages,
      hasNextPage: boundedPage < totalPages,
      hasPreviousPage: boundedPage > 1,
    },
  };
}

export async function requestUserMusicGenerations(userId) {
  const db = await getDBConnectionString();
  const userMusicGenerations = await GeneratedMusic.find({userId: userId});
  return userMusicGenerations;
}
