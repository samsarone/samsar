
import { Comment, Publication } from '../schema/Publication.js';
import VideoSession from '../schema/VideoSession.js';
import { getDBConnectionString } from './DBString.js';
import { extractMetaForMovieResourceList } from '../models/agent/MetaCreatorAgent.js';
import { getLanguageStringFromLanguageCode } from '../consts/LanguageCodes.js';
import TagCloud from '../schema/content/TagCloud.js';

import { updateTagCloudForPublication } from './Content.js';


const API_SERVER = process.env.API_SERVER;

const formatAspectRatioComponent = (value) => {
  if (!Number.isFinite(value) || value <= 0) {
    return null;
  }

  const rounded = Math.round(value * 10000) / 10000;
  return Number.isInteger(rounded)
    ? `${rounded}`
    : `${rounded}`.replace(/\.?0+$/, '');
};

export function normalizePublicationAspectRatio(aspectRatio) {
  if (typeof aspectRatio !== 'string') {
    return null;
  }

  const trimmed = aspectRatio.trim().toLowerCase();
  if (!trimmed) {
    return null;
  }

  switch (trimmed) {
    case 'square':
      return '1:1';
    case 'landscape':
    case 'horizontal':
    case 'wide':
      return '16:9';
    case 'portrait':
    case 'vertical':
      return '9:16';
    default:
      break;
  }

  const normalized = trimmed.replace(/[x/×]/g, ':').replace(/\s+/g, '');
  const match = normalized.match(/^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/);
  if (!match) {
    return null;
  }

  const left = Number.parseFloat(match[1]);
  const right = Number.parseFloat(match[2]);
  const formattedLeft = formatAspectRatioComponent(left);
  const formattedRight = formatAspectRatioComponent(right);

  if (!formattedLeft || !formattedRight) {
    return null;
  }

  return `${formattedLeft}:${formattedRight}`;
}

const normalizeOptionalString = (value) => {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed || null;
};

const normalizeOptionalBoolean = (value) =>
  typeof value === 'boolean' ? value : null;

const resolveSessionHasSubtitles = (sessionData = {}, payload = {}) => {
  const payloadValue =
    normalizeOptionalBoolean(payload.hasSubtitles) ??
    normalizeOptionalBoolean(payload.has_subtitles) ??
    normalizeOptionalBoolean(payload.enableSubtitles) ??
    normalizeOptionalBoolean(payload.enable_subtitles);
  if (payloadValue !== null) {
    return payloadValue;
  }
  if (typeof sessionData.hasSubtitles === 'boolean') {
    return sessionData.hasSubtitles;
  }
  if (typeof sessionData.has_subtitles === 'boolean') {
    return sessionData.has_subtitles;
  }
  if (typeof sessionData.enableSubtitles === 'boolean') {
    return sessionData.enableSubtitles;
  }
  return true;
};

export async function createPublicationForSessionVideo(userId, payload) {



  await getDBConnectionString();

  const {
    id,
    tags,
    title,
    description,
    aspectRatio,
  } = payload;
  const videoSessionData = await VideoSession.findById(id);

  if (!videoSessionData) {
    throw new Error(`Video session ${id} not found`);
  }

  const sessionOwnerId = videoSessionData.userId?.toString?.() || videoSessionData.userId;
  const requestUserId = userId?.toString?.() || userId;
  if (sessionOwnerId && requestUserId && sessionOwnerId !== requestUserId) {
    const err = new Error('Forbidden: You are not allowed to publish this session.');
    err.statusCode = 403;
    throw err;
  }

  const normalizedTags = Array.isArray(tags)
    ? tags.filter((tag) => typeof tag === 'string').map((tag) => tag.trim()).filter(Boolean)
    : typeof tags === 'string'
      ? tags.split(',').map((tag) => tag.trim()).filter(Boolean)
      : [];

  const normalizedTitle = typeof title === 'string' && title.trim().length > 0
    ? title.trim()
    : videoSessionData.sessionName || 'Untitled Video';

  const normalizedDescription = typeof description === 'string'
    ? description.trim()
    : '';

  const normalizedAspectRatio =
    normalizePublicationAspectRatio(aspectRatio) ||
    normalizePublicationAspectRatio(videoSessionData?.publishedAspectRatio) ||
    normalizePublicationAspectRatio(videoSessionData?.aspectRatio) ||
    '1:1';

  const payloadSplashImage = normalizeOptionalString(payload.splashImage);
  const splashImageCandidate = payloadSplashImage ||
    (typeof videoSessionData?.splashImage === 'string' ? videoSessionData.splashImage : null);
  const sessionSplashImage =
    splashImageCandidate && splashImageCandidate.trim().length > 0
      ? splashImageCandidate.trim()
      : null;

  const payloadImageModel = normalizeOptionalString(payload.imageModel);
  const imageModelCandidate = [payloadImageModel, videoSessionData?.imageModel, videoSessionData?.expressGenerationImageModel].find(
    (value) => typeof value === 'string' && value.trim().length > 0
  );
  const sessionImageModel = imageModelCandidate ? imageModelCandidate.trim() : null;

  const payloadVideoModel = normalizeOptionalString(payload.videoModel);
  const videoModelCandidate = [
    payloadVideoModel,
    videoSessionData?.videoGenerationModel,
    videoSessionData?.expressGenerativeVideoModel,
  ].find((value) => typeof value === 'string' && value.trim().length > 0);
  const sessionVideoModel = videoModelCandidate ? videoModelCandidate.trim() : null;

  const payloadOriginalPrompt = normalizeOptionalString(payload.originalPrompt);
  const possiblePrompts = [
    payloadOriginalPrompt,
    videoSessionData?.inputPrompt,
    videoSessionData?.expressInputPrompt,
    Array.isArray(videoSessionData?.promptList) ? videoSessionData.promptList.join('\n') : null,
    Array.isArray(videoSessionData?.promptlist) ? videoSessionData.promptlist.join('\n') : null
  ];

  const originalPrompt = possiblePrompts.find((prompt) => typeof prompt === 'string' && prompt.trim().length > 0) || '';

  payload.tags = normalizedTags;
  payload.title = normalizedTitle;
  payload.description = normalizedDescription;
  payload.aspectRatio = normalizedAspectRatio;
  payload.originalPrompt = originalPrompt;

  const payloadSessionLanguage =
    typeof payload.sessionLanguage === 'string' ? payload.sessionLanguage.trim() : '';
  const payloadLanguageString =
    typeof payload.languageString === 'string' ? payload.languageString.trim() : '';
  const sessionLanguageCandidate =
    payloadSessionLanguage ||
    (typeof videoSessionData.sessionLanguage === 'string'
      ? videoSessionData.sessionLanguage.trim()
      : '') ||
    (typeof videoSessionData.language === 'string' ? videoSessionData.language.trim() : '');
  const languageStringCandidate =
    payloadLanguageString ||
    (typeof videoSessionData.languageString === 'string'
      ? videoSessionData.languageString.trim()
      : '');
  const sessionLanguage = sessionLanguageCandidate || null;
  let languageString = languageStringCandidate || null;
  if (!languageString && sessionLanguage) {
    languageString = getLanguageStringFromLanguageCode(sessionLanguage);
  }
  const hasSubtitles = resolveSessionHasSubtitles(videoSessionData, payload);


  const {
    remoteURL,
    videoLink,
    publishedVideoURL,
  } = videoSessionData;

  if (!remoteURL && !videoLink && !publishedVideoURL) {
    const err = new Error('Video is not ready to publish yet.');
    err.statusCode = 409;
    throw err;
  }

  let videoURL;

  if (videoLink) {
    const trimmedVideoLink = `${videoLink}`.trim();
    videoURL = /^https?:\/\//i.test(trimmedVideoLink)
      ? trimmedVideoLink
      : `${API_SERVER}/${trimmedVideoLink.replace(/^\/+/, '')}`;
  } else if (remoteURL) {


    const remoteBase = `https://samsar-resources.s3.us-west-2.amazonaws.com`;
    const cdnBase = `https://static.samsar.one`;

    const remoteURLStatic = remoteURL.replace(remoteBase, cdnBase);

    videoURL = remoteURLStatic;
  } else {
    videoURL = publishedVideoURL;
  };

  const normalizedCreatorHandle = normalizeOptionalString(payload.creatorHandle);
  const normalizedSlug = normalizeOptionalString(payload.slug);
  const normalizedImageHash = normalizeOptionalString(payload.imageHash);

  videoSessionData.ispublishedVideo = true;
  videoSessionData.publishedTitle = normalizedTitle;
  videoSessionData.publishedDescription = normalizedDescription;
  videoSessionData.publishedTags = normalizedTags;
  videoSessionData.publishedAspectRatio = normalizedAspectRatio;
  videoSessionData.publishedVideoURL = videoURL;
  videoSessionData.publishedAt = new Date();
  videoSessionData.publishedOriginalPrompt = originalPrompt;
  videoSessionData.publishedSplashImage = sessionSplashImage;
  videoSessionData.publishedImageModel = sessionImageModel;
  videoSessionData.publishedVideoModel = sessionVideoModel;
  videoSessionData.publishedHasSubtitles = hasSubtitles;
  videoSessionData.publishedSessionLanguage = sessionLanguage;
  videoSessionData.publishedLanguageString = languageString;

  await videoSessionData.save();

  let publicationExists = await Publication.findOne({ sessionId: id });

  if (publicationExists) {


    publicationExists.videoURL = videoURL;
    publicationExists.title = normalizedTitle;
    publicationExists.description = normalizedDescription;
    publicationExists.tags = normalizedTags;
    publicationExists.aspectRatio = normalizedAspectRatio;
    publicationExists.originalPrompt = originalPrompt;
    publicationExists.splashImage = sessionSplashImage;
    publicationExists.imageModel = sessionImageModel;
    publicationExists.videoModel = sessionVideoModel;
    publicationExists.sessionLanguage = sessionLanguage;
    publicationExists.language = sessionLanguage;
    publicationExists.languageString = languageString;
    publicationExists.hasSubtitles = hasSubtitles;
    publicationExists.has_subtitles = hasSubtitles;
    if (payload.creatorHandle !== undefined) {
      publicationExists.creatorHandle = normalizedCreatorHandle;
    }
    if (payload.slug !== undefined) {
      publicationExists.slug = normalizedSlug;
    }
    if (payload.imageHash !== undefined) {
      publicationExists.imageHash = normalizedImageHash;
    }

    await publicationExists.save({});

    videoSessionData.publishedPublicationId = publicationExists._id.toString();
    await videoSessionData.save();

    payload.publicationId = publicationExists._id.toString();
    updateTagCloudForPublication(payload);

    return publicationExists;
  } else {

    const publicationData = new Publication({
      sessionId: id,
      videoURL: videoURL,
      createdBy: userId,
      title: normalizedTitle,
      description: normalizedDescription,
      tags: normalizedTags,
      aspectRatio: normalizedAspectRatio,
      splashImage: sessionSplashImage,
      imageModel: sessionImageModel,
      videoModel: sessionVideoModel,
      originalPrompt: originalPrompt,
      sessionLanguage: sessionLanguage,
      language: sessionLanguage,
      languageString: languageString,
      hasSubtitles,
      has_subtitles: hasSubtitles,
      ...(normalizedCreatorHandle ? { creatorHandle: normalizedCreatorHandle } : {}),
      ...(normalizedSlug ? { slug: normalizedSlug } : {}),
      ...(normalizedImageHash ? { imageHash: normalizedImageHash } : {}),
    });

    const publicationId = publicationData._id.toString();
    payload.publicationId = publicationId;

    await publicationData.save();

    videoSessionData.publishedPublicationId = publicationId;
    await videoSessionData.save();

    updateTagCloudForPublication(payload);

    return publicationData;
  }

}

export async function unpublishSessionVideo(userId, payload) {
  await getDBConnectionString();

  const { sessionId } = payload;

  if (!sessionId) {
    throw new Error('Missing sessionId');
  }

  const videoSessionData = await VideoSession.findById(sessionId);

  if (!videoSessionData) {
    throw new Error(`Video session ${sessionId} not found`);
  }

  const sessionOwnerId = videoSessionData.userId?.toString();
  if (sessionOwnerId && userId?.toString && sessionOwnerId !== userId.toString()) {
    const err = new Error('Forbidden: You are not allowed to unpublish this session.');
    err.statusCode = 403;
    throw err;
  }

  const publication = await Publication.findOne({ sessionId });

  if (publication) {
    await Comment.deleteMany({ publicationId: publication._id });
    await publication.deleteOne();
  }

  videoSessionData.ispublishedVideo = false;
  videoSessionData.publishedTitle = null;
  videoSessionData.publishedDescription = null;
  videoSessionData.publishedTags = [];
  videoSessionData.publishedAspectRatio = null;
  videoSessionData.publishedVideoURL = null;
  videoSessionData.publishedAt = null;
  videoSessionData.publishedOriginalPrompt = null;
  videoSessionData.publishedSplashImage = null;
  videoSessionData.publishedImageModel = null;
  videoSessionData.publishedVideoModel = null;
  videoSessionData.publishedHasSubtitles = null;
  videoSessionData.publishedSessionLanguage = null;
  videoSessionData.publishedLanguageString = null;
  videoSessionData.publishedPublicationId = null;

  await videoSessionData.save();

  return {
    sessionId,
    ispublishedVideo: false,
  };
}


export async function createMetaForSession(userId, payload) {

  const { sessionId } = payload;


  await getDBConnectionString();

  const sessionData = await VideoSession.findById(sessionId);


  const movieResourceList = sessionData.movieResourceList;

  const metaData = await extractMetaForMovieResourceList(movieResourceList);

  return metaData;


}


export async function updateMetadataForPublication(payload) {

  await getDBConnectionString();



  return true;
}


export async function getRankedPublications(userPreferences) {
  // 1. Fetch all publications, populating comments if you need them directly.
  //    If you only need the count of comments, consider using an alternative approach
  //    (like storing a commentsCount in the Publication itself or using aggregate).
  const publications = await Publication.find()
    .populate('comments') // to be able to count them easily (optional)
    .exec();

  try {

    // 2. Calculate a "score" for each publication.
    const scoredPublications = publications.map((publication) => {
      const matchedTagCount = publication.tags.reduce((count, tag) => {
        return userPreferences.includes(tag) ? count + 1 : count;
      }, 0);

      const likesCount = publication.likes?.count || 0;
      const commentCount = publication.comments?.length || 0;

      // Example scoring logic
      const score = matchedTagCount * 10 + likesCount * 2 + commentCount;

      return {
        publication,
        score,
      };
    });

    // 3. Sort the publications by their score in descending order.
    scoredPublications.sort((a, b) => b.score - a.score);

    // 4. Return the sorted list of publications (or keep the score if you want).
    return scoredPublications.map((item) => item.publication);

  } catch (error) {
    console.error(error);
  }
}
