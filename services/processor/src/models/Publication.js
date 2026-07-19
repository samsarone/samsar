
import { Comment, Publication } from '../schema/Publication.js';
import VideoSession from '../schema/VideoSession.js';
import { getDBConnectionString } from './DBString.js';
import { extractMetaForMovieResourceList } from '../models/agent/MetaCreatorAgent.js';
import { getLanguageStringFromLanguageCode } from '../consts/LanguageCodes.js';
import TagCloud from '../schema/content/TagCloud.js';
import User from '../schema/User.js';
import {
  deletePublicPublicationMediaForSession,
  preparePublicPublicationMedia,
} from './PublicationMedia.js';
import {
  normalizePublicationAspectRatio,
  resolvePublicationAspectRatio,
} from './publication/AspectRatio.js';
import {
  normalizePublicationTranscript,
  resolvePublicationOriginalPrompt,
} from './publication/Transcript.js';
import {
  getStoredSessionInferenceModel,
  resolvePublicationMetadataInferenceModel,
} from './publication/InferenceModel.js';
import {
  abortInteractivePublicationPublish,
  buildInteractivePublishedSessionUpdate,
  createInteractivePublicationForSessionVideo,
  finalizeInteractivePublicationUnpublish,
  getInteractivePublicationPublishRevision,
  markInteractivePublicationPublished,
  restoreInteractivePublicationUnpublish,
  stageInteractivePublicationUnpublish,
} from './InteractivePublication.js';
import { isBranchedVideoSession } from './interactive/InteractivePublicationManifest.js';

import { updateTagCloudForPublication } from './Content.js';

export { normalizePublicationAspectRatio } from './publication/AspectRatio.js';

const normalizeOptionalString = (value) => {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed || null;
};

const normalizeOptionalBoolean = (value) =>
  typeof value === 'boolean' ? value : null;

const canManageAnotherUsersPublication = async (userId) => {
  const normalizedUserId = userId?.toString?.() || userId;
  if (!normalizedUserId) return false;
  const user = await User.findById(normalizedUserId).select({ isAdminUser: 1 }).lean();
  return Boolean(user?.isAdminUser);
};

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

const buildInteractivePublishedSessionSnapshot = (session = {}) => ({
  ispublishedVideo: session.ispublishedVideo === true,
  publishedTitle: session.publishedTitle ?? null,
  publishedDescription: session.publishedDescription ?? null,
  publishedTags: Array.isArray(session.publishedTags) ? [...session.publishedTags] : [],
  publishedAspectRatio: session.publishedAspectRatio ?? null,
  publishedVideoURL: session.publishedVideoURL ?? null,
  publishedAt: session.publishedAt ?? null,
  publishedOriginalPrompt: session.publishedOriginalPrompt ?? null,
  publishedSplashImage: session.publishedSplashImage ?? null,
  publishedImageModel: session.publishedImageModel ?? null,
  publishedVideoModel: session.publishedVideoModel ?? null,
  publishedHasSubtitles: session.publishedHasSubtitles ?? null,
  publishedSessionLanguage: session.publishedSessionLanguage ?? null,
  publishedLanguageString: session.publishedLanguageString ?? null,
  publishedPublicationId: session.publishedPublicationId ?? null,
});

const buildInteractiveUnpublishedSessionUpdate = () => ({
  ispublishedVideo: false,
  publishedTitle: null,
  publishedDescription: null,
  publishedTags: [],
  publishedAspectRatio: null,
  publishedVideoURL: null,
  publishedAt: null,
  publishedOriginalPrompt: null,
  publishedSplashImage: null,
  publishedImageModel: null,
  publishedVideoModel: null,
  publishedHasSubtitles: null,
  publishedSessionLanguage: null,
  publishedLanguageString: null,
  publishedPublicationId: null,
});

export async function createPublicationForSessionVideo(
  userId,
  payload,
  {
    connectToDatabase = getDBConnectionString,
    videoSessionModel = VideoSession,
    createInteractivePublication = createInteractivePublicationForSessionVideo,
    buildInteractiveSessionUpdate = buildInteractivePublishedSessionUpdate,
    markInteractivePublication = markInteractivePublicationPublished,
    abortInteractivePublication = abortInteractivePublicationPublish,
  } = {},
) {



  await connectToDatabase();

  const {
    id,
    tags,
    title,
    description,
    aspectRatio,
  } = payload;
  const videoSessionData = await videoSessionModel.findById(id);

  if (!videoSessionData) {
    throw new Error(`Video session ${id} not found`);
  }

  const sessionOwnerId = videoSessionData.userId?.toString?.() || videoSessionData.userId;
  const requestUserId = userId?.toString?.() || userId;
  if (
    sessionOwnerId &&
    requestUserId &&
    sessionOwnerId !== requestUserId &&
    !(await canManageAnotherUsersPublication(requestUserId))
  ) {
    const err = new Error('Forbidden: You are not allowed to publish this session.');
    err.statusCode = 403;
    throw err;
  }

  // Interactive sessions publish through their own compact multi-path model.
  // Keep the existing singular Publication path below unchanged.
  if (isBranchedVideoSession(videoSessionData)) {
    const previousPublishedSessionState = buildInteractivePublishedSessionSnapshot(videoSessionData);
    const interactivePublication = await createInteractivePublication(
      userId,
      payload,
      { sessionData: videoSessionData },
    );
    const publishedSessionUpdate = buildInteractiveSessionUpdate(
      interactivePublication,
      videoSessionData,
      payload,
    );
    const expectedRevision = getInteractivePublicationPublishRevision(interactivePublication);
    const rollbackAndAbortCandidate = async (context) => {
      let restoredSession = null;
      let rollbackCheckCompleted = false;
      try {
        restoredSession = await videoSessionModel.findOneAndUpdate(
          {
            _id: id,
            publishedPublicationId: publishedSessionUpdate.publishedPublicationId,
            publishedVideoURL: publishedSessionUpdate.publishedVideoURL,
          },
          { $set: previousPublishedSessionState },
          { new: true, runValidators: true },
        );
        rollbackCheckCompleted = true;
      } catch (rollbackError) {
        console.error(`Failed to restore session after ${context}:`, rollbackError);
      }
      if (!rollbackCheckCompleted) return false;

      await abortInteractivePublication(interactivePublication.id, { expectedRevision })
        .catch((abortError) => {
          console.error(`Failed to abort interactive publication after ${context}:`, abortError);
        });
      return Boolean(restoredSession);
    };
    let publishedSession;
    try {
      publishedSession = await videoSessionModel.findOneAndUpdate(
        {
          _id: id,
          ispublishedVideo: videoSessionData.ispublishedVideo === true,
          publishedPublicationId: videoSessionData.publishedPublicationId ?? null,
          publishedVideoURL: videoSessionData.publishedVideoURL ?? null,
        },
        { $set: publishedSessionUpdate },
        { new: true, runValidators: true },
      );
    } catch (error) {
      await rollbackAndAbortCandidate('session update failure');
      throw error;
    }
    if (!publishedSession || publishedSession.ispublishedVideo !== true) {
      await rollbackAndAbortCandidate('incomplete session update');
      const err = new Error(
        'InteractivePublication was created, but the session could not be marked as published.',
      );
      err.statusCode = 500;
      throw err;
    }
    try {
      return await markInteractivePublication(interactivePublication.id, { expectedRevision });
    } catch (error) {
      await rollbackAndAbortCandidate('publication finalization failure');
      throw error;
    }
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

  const normalizedSessionAspectRatio = normalizePublicationAspectRatio(
    videoSessionData?.aspectRatio,
  );
  const normalizedRequestedAspectRatio = normalizePublicationAspectRatio(aspectRatio);
  const normalizedAspectRatio = resolvePublicationAspectRatio({
    sessionAspectRatio: videoSessionData?.aspectRatio,
    requestedAspectRatio: aspectRatio,
    publishedAspectRatio: videoSessionData?.publishedAspectRatio,
  });

  if (
    normalizedSessionAspectRatio &&
    normalizedRequestedAspectRatio &&
    normalizedSessionAspectRatio !== normalizedRequestedAspectRatio
  ) {
    console.warn('Ignoring publication aspect ratio that conflicts with its video session.', {
      sessionId: videoSessionData._id?.toString?.() ?? id,
      requestedAspectRatio: normalizedRequestedAspectRatio,
      sessionAspectRatio: normalizedSessionAspectRatio,
    });
  }

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

  const originalPrompt = resolvePublicationOriginalPrompt(payload, videoSessionData);
  const sessionTranscript = normalizePublicationTranscript(videoSessionData.movieResourceList);

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

  const payloadVideoReference = [
    payload.renderedVideoURL,
    payload.renderedVideoUrl,
    payload.rendered_video_url,
    payload.remoteURL,
    payload.remoteUrl,
    payload.remote_url,
    payload.videoLink,
    payload.video_link,
  ].find((value) => typeof value === 'string' && value.trim()) || null;
  const payloadThumbnailReference = normalizeOptionalString(payload.splashImage);

  if (
    !videoSessionData.remoteURL &&
    !videoSessionData.videoLink &&
    !videoSessionData.publishedVideoURL &&
    !payloadVideoReference
  ) {
    const err = new Error('Video is not ready to publish yet.');
    err.statusCode = 409;
    throw err;
  }

  const mediaSession = payloadVideoReference || payloadThumbnailReference
    ? {
        ...videoSessionData.toObject({ depopulate: true }),
        ...(payloadVideoReference
          ? {
              remoteURL: payloadVideoReference,
              videoLink: payloadVideoReference,
            }
          : {}),
        ...(payloadThumbnailReference
          ? { splashImage: payloadThumbnailReference }
          : {}),
      }
    : videoSessionData;

  const publicMedia = await preparePublicPublicationMedia(mediaSession, {
    thumbnailReference: payloadThumbnailReference || sessionSplashImage,
  });
  const videoURL = publicMedia.videoUrl;
  const publicThumbnailUrl = publicMedia.thumbnailUrl;
  const resolvedSessionSplashImage = publicThumbnailUrl || sessionSplashImage;
  const thumbnailGeneratedFromVideo = publicMedia.thumbnailSource === 'ffmpeg-video-frame';

  const normalizedCreatorHandle = normalizeOptionalString(payload.creatorHandle);
  const normalizedSlug = normalizeOptionalString(payload.slug);
  const normalizedImageHash = normalizeOptionalString(payload.imageHash);

  let publicationExists = await Publication.findOne({ sessionId: id });
  let publicationData;

  if (publicationExists) {


    publicationExists.videoURL = videoURL;
    publicationExists.title = normalizedTitle;
    publicationExists.description = normalizedDescription;
    publicationExists.tags = normalizedTags;
    publicationExists.aspectRatio = normalizedAspectRatio;
    publicationExists.originalPrompt = originalPrompt;
    publicationExists.sessionTranscript = sessionTranscript;
    publicationExists.splashImage = resolvedSessionSplashImage;
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
    publicationData = publicationExists;
  } else {

    publicationData = new Publication({
      sessionId: id,
      videoURL: videoURL,
      createdBy: userId,
      title: normalizedTitle,
      description: normalizedDescription,
      tags: normalizedTags,
      aspectRatio: normalizedAspectRatio,
      splashImage: resolvedSessionSplashImage,
      imageModel: sessionImageModel,
      videoModel: sessionVideoModel,
      originalPrompt: originalPrompt,
      sessionTranscript,
      sessionLanguage: sessionLanguage,
      language: sessionLanguage,
      languageString: languageString,
      hasSubtitles,
      has_subtitles: hasSubtitles,
      ...(normalizedCreatorHandle ? { creatorHandle: normalizedCreatorHandle } : {}),
      ...(normalizedSlug ? { slug: normalizedSlug } : {}),
      ...(normalizedImageHash ? { imageHash: normalizedImageHash } : {}),
    });

    await publicationData.save();
  }

  const publicationId = publicationData._id.toString();
  const publishedAt = new Date();
  const publishedSessionUpdate = {
    ispublishedVideo: true,
    publishedTitle: normalizedTitle,
    publishedDescription: normalizedDescription,
    publishedTags: normalizedTags,
    publishedAspectRatio: normalizedAspectRatio,
    publishedVideoURL: videoURL,
    publishedAt,
    publishedOriginalPrompt: originalPrompt,
    publishedSplashImage: resolvedSessionSplashImage,
    publishedImageModel: sessionImageModel,
    publishedVideoModel: sessionVideoModel,
    publishedHasSubtitles: hasSubtitles,
    publishedSessionLanguage: sessionLanguage,
    publishedLanguageString: languageString,
    publishedPublicationId: publicationId,
    ...(thumbnailGeneratedFromVideo
      ? { splashImage: resolvedSessionSplashImage }
      : {}),
  };

  // Treat the session marker as part of publish success. This final atomic
  // update prevents a successful response from being returned while the
  // session still carries stale unpublished metadata.
  const publishedSession = await videoSessionModel.findByIdAndUpdate(
    id,
    { $set: publishedSessionUpdate },
    { new: true, runValidators: true },
  );
  if (!publishedSession || publishedSession.ispublishedVideo !== true) {
    const err = new Error('Publication was created, but the session could not be marked as published.');
    err.statusCode = 500;
    throw err;
  }

  payload.publicationId = publicationId;
  updateTagCloudForPublication(payload);

  return publicationData;

}

export async function unpublishSessionVideo(
  userId,
  payload,
  {
    connectToDatabase = getDBConnectionString,
    videoSessionModel = VideoSession,
    stageInteractiveUnpublish = stageInteractivePublicationUnpublish,
    finalizeInteractiveUnpublish = finalizeInteractivePublicationUnpublish,
    restoreInteractiveUnpublish = restoreInteractivePublicationUnpublish,
  } = {},
) {
  await connectToDatabase();

  const { sessionId } = payload;

  if (!sessionId) {
    throw new Error('Missing sessionId');
  }

  const videoSessionData = await videoSessionModel.findById(sessionId);

  if (!videoSessionData) {
    throw new Error(`Video session ${sessionId} not found`);
  }

  const sessionOwnerId = videoSessionData.userId?.toString();
  if (
    sessionOwnerId &&
    userId?.toString &&
    sessionOwnerId !== userId.toString() &&
    !(await canManageAnotherUsersPublication(userId))
  ) {
    const err = new Error('Forbidden: You are not allowed to unpublish this session.');
    err.statusCode = 403;
    throw err;
  }

  if (isBranchedVideoSession(videoSessionData)) {
    const unpublishStage = await stageInteractiveUnpublish(sessionId);
    const unpublishedSessionUpdate = buildInteractiveUnpublishedSessionUpdate();
    const sessionHasPublishedMarkers = Boolean(
      videoSessionData.ispublishedVideo ||
      videoSessionData.publishedPublicationId ||
      videoSessionData.publishedVideoURL
    );
    let sessionCleared = !sessionHasPublishedMarkers;

    if (sessionHasPublishedMarkers) {
      try {
        const clearedSession = await videoSessionModel.findOneAndUpdate(
          {
            _id: sessionId,
            ispublishedVideo: videoSessionData.ispublishedVideo === true,
            publishedPublicationId: videoSessionData.publishedPublicationId ?? null,
            publishedVideoURL: videoSessionData.publishedVideoURL ?? null,
          },
          { $set: unpublishedSessionUpdate },
          { new: true, runValidators: true },
        );
        sessionCleared = Boolean(clearedSession);
        if (!sessionCleared) {
          const currentSession = await videoSessionModel.findById(sessionId);
          sessionCleared = Boolean(
            currentSession &&
            currentSession.ispublishedVideo !== true &&
            !currentSession.publishedPublicationId &&
            !currentSession.publishedVideoURL
          );
        }
      } catch (error) {
        await restoreInteractiveUnpublish(unpublishStage).catch((restoreError) => {
          console.error('Failed to restore InteractivePublication after session clear failure:', restoreError);
        });
        throw error;
      }
    }

    if (!sessionCleared) {
      await restoreInteractiveUnpublish(unpublishStage).catch((restoreError) => {
        console.error('Failed to restore InteractivePublication after concurrent session change:', restoreError);
      });
      const error = new Error('Video session changed while InteractivePublication was being unpublished.');
      error.statusCode = 409;
      throw error;
    }

    await finalizeInteractiveUnpublish(unpublishStage);
    return {
      sessionId,
      ispublishedVideo: false,
    };
  }

  const publication = await Publication.findOne({ sessionId });

  if (publication) {
    await Comment.deleteMany({ publicationId: publication._id });
    await publication.deleteOne();
  }

  await deletePublicPublicationMediaForSession(sessionId);

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

  if (!sessionData) {
    throw new Error(`Video session ${sessionId} not found`);
  }


  const movieResourceList = sessionData.movieResourceList;
  const originalPrompt = resolvePublicationOriginalPrompt(payload, sessionData);
  let fallbackInferenceModel = '';

  if (!getStoredSessionInferenceModel(sessionData)) {
    const inferenceModelUser = await User.findById(sessionData.userId || userId)
      .select('selectedInferenceModel')
      .lean();
    fallbackInferenceModel = inferenceModelUser?.selectedInferenceModel || '';
  }

  const inferenceModel = resolvePublicationMetadataInferenceModel(
    sessionData,
    fallbackInferenceModel,
  );

  const metaData = await extractMetaForMovieResourceList(movieResourceList, {
    originalPrompt,
    inferenceModel,
  });

  return {
    title: metaData.title,
    description: metaData.description,
  };


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
