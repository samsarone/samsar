import { randomUUID } from 'node:crypto';

import InteractivePublication, {
  INTERACTIVE_PUBLICATION_SCHEMA,
} from '../schema/InteractivePublication.js';
import { buildNormalizedBranchingStatus } from './api/StatusAPI.js';
import {
  deletePublicInteractivePublicationMediaForSession,
  preparePublicInteractivePublicationPathMedia,
} from './PublicationMedia.js';
import { isPublicPublicationMediaUrl } from './AWS.js';
import {
  assertInteractiveSessionReadyForPublication,
  assertInteractivePublicationManifestRenderable,
  buildInteractivePublicationManifest,
  serializeInteractivePublicationManifest,
} from './interactive/InteractivePublicationManifest.js';
import { resolvePublicationAspectRatio } from './publication/AspectRatio.js';
import { resolvePublicationOriginalPrompt } from './publication/Transcript.js';

const INTERACTIVE_MEDIA_CONCURRENCY = 2;
const INTERACTIVE_PUBLICATION_REVISION = Symbol('interactivePublicationRevision');

const normalizeOptionalString = (value) => {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized || null;
};

const normalizeTags = (tags) => {
  if (Array.isArray(tags)) {
    return tags
      .filter((tag) => typeof tag === 'string')
      .map((tag) => tag.trim())
      .filter(Boolean);
  }
  if (typeof tags === 'string') {
    return tags.split(',').map((tag) => tag.trim()).filter(Boolean);
  }
  return [];
};

const normalizeSessionId = (session) => (
  session?._id?.toString?.() || session?.id?.toString?.() || normalizeOptionalString(session?.sessionId)
);

const resolveHasSubtitles = (session = {}, payload = {}) => {
  for (const value of [
    payload.hasSubtitles,
    payload.has_subtitles,
    payload.enableSubtitles,
    payload.enable_subtitles,
    session.hasSubtitles,
    session.has_subtitles,
    session.enableSubtitles,
  ]) {
    if (typeof value === 'boolean') return value;
  }
  return null;
};

const resolveInLanguage = (session = {}, payload = {}) => (
  normalizeOptionalString(payload.sessionLanguage) ||
  normalizeOptionalString(payload.session_language) ||
  normalizeOptionalString(payload.language) ||
  normalizeOptionalString(payload.language_code) ||
  normalizeOptionalString(session.sessionLanguage) ||
  normalizeOptionalString(session.language)
);

async function mapWithConcurrency(items, concurrency, worker) {
  const source = Array.isArray(items) ? items : [];
  const results = new Array(source.length);
  let nextIndex = 0;

  const runWorker = async () => {
    while (nextIndex < source.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await worker(source[currentIndex], currentIndex);
    }
  };

  const workers = Array.from(
    { length: Math.min(Math.max(1, concurrency), source.length) },
    () => runWorker(),
  );
  const settledWorkers = await Promise.allSettled(workers);
  const rejectedWorker = settledWorkers.find((result) => result.status === 'rejected');
  if (rejectedWorker) {
    throw rejectedWorker.reason;
  }
  return results;
}

const toPlainObject = (value) => value?.toObject?.() || value || {};

const attachInteractivePublicationRevision = (publication, revision) => {
  if (publication && revision) {
    Object.defineProperty(publication, INTERACTIVE_PUBLICATION_REVISION, {
      value: revision,
      enumerable: false,
      configurable: false,
      writable: false,
    });
  }
  return publication;
};

export const getInteractivePublicationPublishRevision = (publication) => (
  publication?.[INTERACTIVE_PUBLICATION_REVISION] || null
);

export function serializeInteractivePublication(publication) {
  if (!publication) return null;
  const source = toPlainObject(publication);
  const publicationId = source._id?.toString?.() || source.id || null;

  return {
    id: publicationId,
    type: source.type || 'InteractiveVideo',
    schema: source.schemaVersion || INTERACTIVE_PUBLICATION_SCHEMA,
    title: source.title || 'Untitled Interactive Video',
    description: source.description || '',
    tags: normalizeTags(source.tags),
    creatorHandle: source.creatorHandle || '',
    ...(source.slug ? { slug: source.slug } : {}),
    datePublished: source.datePublished || source.createdAt || null,
    thumbnailUrl: source.thumbnailUrl || null,
    aspectRatio: source.aspectRatio || null,
    inLanguage: source.inLanguage || null,
    hasSubtitles: typeof source.hasSubtitles === 'boolean' ? source.hasSubtitles : null,
    manifest: serializeInteractivePublicationManifest(source.manifest),
  };
}

export function isInteractivePublicationPubliclyRenderable(publication) {
  const source = toPlainObject(publication);
  const serialized = serializeInteractivePublication(publication);
  const paths = serialized?.manifest?.outputs?.paths;
  if (
    source?.type !== 'InteractiveVideo' ||
    (source?.schemaVersion || source?.schema) !== INTERACTIVE_PUBLICATION_SCHEMA ||
    source?.publicRenderableVersion !== INTERACTIVE_PUBLICATION_SCHEMA ||
    source?.isPublished !== true ||
    source?.isRenderable !== true ||
    !serialized?.id ||
    !isPublicPublicationMediaUrl(serialized.thumbnailUrl) ||
    !Array.isArray(paths) ||
    paths.length === 0
  ) {
    return false;
  }

  try {
    assertInteractivePublicationManifestRenderable(serialized.manifest);
  } catch {
    return false;
  }

  return paths.every((path) => (
    normalizeOptionalString(path?.path_id) &&
    isPublicPublicationMediaUrl(path?.contentUrl) &&
    isPublicPublicationMediaUrl(path?.thumbnailUrl) &&
    path?.encodingFormat === 'video/mp4' &&
    Number.isFinite(Number(path?.duration)) &&
    Number(path.duration) >= 0
  ));
}

export function buildInteractivePublishedSessionUpdate(
  publication,
  session = {},
  payload = {},
  publishedAt = new Date(),
) {
  const serialized = serializeInteractivePublication(publication);
  const defaultPath = serialized?.manifest?.outputs?.paths?.find((path) => (
    path.path_id === serialized.manifest.default_path_id && path.is_default === true
  ));
  if (!serialized?.id || !defaultPath?.contentUrl || !defaultPath?.thumbnailUrl) {
    throw new Error('InteractivePublication is missing its default public video path.');
  }

  const imageModel = normalizeOptionalString(payload.imageModel) ||
    normalizeOptionalString(payload.image_model) ||
    normalizeOptionalString(session.imageModel) ||
    normalizeOptionalString(session.expressGenerationImageModel);
  const videoModel = normalizeOptionalString(payload.videoModel) ||
    normalizeOptionalString(payload.video_model) ||
    normalizeOptionalString(session.videoGenerationModel) ||
    normalizeOptionalString(session.expressGenerativeVideoModel);
  const languageString = normalizeOptionalString(payload.languageString) ||
    normalizeOptionalString(payload.language_string) ||
    normalizeOptionalString(session.languageString);

  return {
    ispublishedVideo: true,
    publishedTitle: serialized.title,
    publishedDescription: serialized.description,
    publishedTags: serialized.tags,
    publishedAspectRatio: serialized.aspectRatio,
    publishedVideoURL: defaultPath.contentUrl,
    publishedAt,
    publishedOriginalPrompt: resolvePublicationOriginalPrompt(payload, session),
    publishedSplashImage: defaultPath.thumbnailUrl,
    publishedImageModel: imageModel,
    publishedVideoModel: videoModel,
    publishedHasSubtitles: serialized.hasSubtitles,
    publishedSessionLanguage: serialized.inLanguage,
    publishedLanguageString: languageString,
    publishedPublicationId: serialized.id,
  };
}

export async function createInteractivePublicationForSessionVideo(
  userId,
  payload = {},
  {
    sessionData,
    publicationModel = InteractivePublication,
    preparePathMedia = preparePublicInteractivePublicationPathMedia,
    buildBranchingStatus = buildNormalizedBranchingStatus,
    cleanupPathMedia = deletePublicInteractivePublicationMediaForSession,
  } = {},
) {
  const session = sessionData;
  const sessionId = normalizeSessionId(session);
  if (!session || !sessionId) {
    const error = new Error('A persisted video session is required for interactive publication.');
    error.statusCode = 404;
    throw error;
  }

  const branching = buildBranchingStatus(session);
  const completedBranching = assertInteractiveSessionReadyForPublication(session, branching);
  const existingPublication = await publicationModel.findOne({ sessionId }).lean();
  if (existingPublication?.unpublishToken) {
    const error = new Error('InteractivePublication is currently being unpublished.');
    error.statusCode = 409;
    throw error;
  }
  const existingPendingRevision = normalizeOptionalString(existingPublication?.pendingMediaRevision);
  const existingPendingData = existingPublication?.pendingPublicationData;
  const existingPendingDefaultPath = existingPendingData?.manifest?.outputs?.paths?.find?.((path) => (
    path?.path_id === existingPendingData?.manifest?.default_path_id && path?.is_default === true
  ));
  if (
    existingPendingRevision &&
    normalizeOptionalString(existingPendingData?.mediaRevision) === existingPendingRevision &&
    existingPendingDefaultPath?.contentUrl
  ) {
    return attachInteractivePublicationRevision(
      serializeInteractivePublication({
        ...existingPublication,
        ...existingPendingData,
        _id: existingPublication._id,
        datePublished: existingPublication.datePublished,
      }),
      existingPendingRevision,
    );
  }
  const existingLiveRevision = normalizeOptionalString(existingPublication?.mediaRevision);
  const existingLiveDefaultPath = existingPublication?.manifest?.outputs?.paths?.find?.((path) => (
    path?.path_id === existingPublication?.manifest?.default_path_id && path?.is_default === true
  ));
  if (
    existingPublication &&
    existingPublication.isPublished !== true &&
    existingLiveRevision &&
    existingLiveDefaultPath?.contentUrl
  ) {
    return attachInteractivePublicationRevision(
      serializeInteractivePublication(existingPublication),
      existingLiveRevision,
    );
  }
  const mediaRevision = randomUUID();
  const rawPathsById = new Map(
    (Array.isArray(session.branchRenderPaths) ? session.branchRenderPaths : [])
      .map((path) => [normalizeOptionalString(path?.pathId), path])
      .filter(([pathId]) => pathId),
  );
  const completedPaths = completedBranching.outputs.paths;

  let publication;
  let candidatePublication;
  try {
    const publicMedia = await mapWithConcurrency(
      completedPaths,
      INTERACTIVE_MEDIA_CONCURRENCY,
      async (path) => {
        const rawPath = rawPathsById.get(path.path_id);
        if (!rawPath) {
          const error = new Error(`Rendered interactive path ${path.path_id} is missing.`);
          error.statusCode = 409;
          throw error;
        }
        const media = await preparePathMedia(session, rawPath, { revisionId: mediaRevision });
        if (!isPublicPublicationMediaUrl(media.videoUrl) || !isPublicPublicationMediaUrl(media.thumbnailUrl)) {
          const error = new Error(`Interactive path ${path.path_id} did not produce public media URLs.`);
          error.statusCode = 500;
          throw error;
        }
        return media;
      },
    );
    const manifest = buildInteractivePublicationManifest({
      completedBranching,
      publicMedia,
    });
    const defaultPath = manifest.outputs.paths.find((path) => path.is_default);
    const inLanguage = resolveInLanguage(session, payload);
    const title = normalizeOptionalString(payload.title) ||
      normalizeOptionalString(session.sessionName) ||
      'Untitled Interactive Video';
    const description = typeof payload.description === 'string'
      ? payload.description.trim()
      : normalizeOptionalString(session.sessionDescription) || '';
    const aspectRatio = resolvePublicationAspectRatio({
      sessionAspectRatio: session.aspectRatio,
      requestedAspectRatio: payload.aspectRatio || payload.aspect_ratio,
      publishedAspectRatio: session.publishedAspectRatio,
    });

    const publicationData = {
      schemaVersion: INTERACTIVE_PUBLICATION_SCHEMA,
      type: 'InteractiveVideo',
      sessionId,
      mediaRevision,
      creatorHandle: normalizeOptionalString(payload.creatorHandle || payload.creator_handle) || '',
      slug: normalizeOptionalString(payload.slug),
      title,
      description,
      tags: normalizeTags(payload.tags),
      thumbnailUrl: defaultPath.thumbnailUrl,
      aspectRatio,
      inLanguage,
      hasSubtitles: resolveHasSubtitles(session, payload),
      manifest,
      publicRenderableVersion: INTERACTIVE_PUBLICATION_SCHEMA,
      isRenderable: true,
      isHidden: false,
      isDeleted: false,
    };

    if (existingPublication?.isPublished === true) {
      publication = await publicationModel.findOneAndUpdate(
        {
          _id: existingPublication._id,
          sessionId,
          mediaRevision: normalizeOptionalString(existingPublication.mediaRevision),
          pendingMediaRevision: existingPendingRevision,
          isPublished: true,
        },
        {
          $set: {
            pendingMediaRevision: mediaRevision,
            pendingPublicationData: publicationData,
          },
        },
        { new: true, runValidators: true },
      );
      candidatePublication = {
        ...existingPublication,
        ...publicationData,
        _id: existingPublication._id,
        datePublished: existingPublication.datePublished,
      };
    } else if (existingPublication) {
      publication = await publicationModel.findOneAndUpdate(
        {
          _id: existingPublication._id,
          sessionId,
          mediaRevision: normalizeOptionalString(existingPublication.mediaRevision),
          pendingMediaRevision: existingPendingRevision,
          isPublished: { $ne: true },
        },
        {
          $set: {
            ...publicationData,
            isPublished: false,
          },
          $unset: {
            pendingMediaRevision: '',
            pendingPublicationData: '',
          },
        },
        { new: true, runValidators: true },
      );
      candidatePublication = publication;
    } else {
      publication = await publicationModel.findOneAndUpdate(
        { sessionId },
        {
          $setOnInsert: {
            ...publicationData,
            isPublished: false,
            createdBy: userId,
            datePublished: new Date(),
          },
        },
        {
          new: true,
          upsert: true,
          runValidators: true,
          setDefaultsOnInsert: true,
        },
      );
      candidatePublication = publication;
    }
    if (!publication || normalizeOptionalString(candidatePublication?.mediaRevision) !== mediaRevision) {
      const error = new Error('InteractivePublication publish revision was superseded.');
      error.statusCode = 409;
      throw error;
    }
  } catch (error) {
    await cleanupPathMedia(
      sessionId,
      completedPaths,
      { revisionId: mediaRevision },
    ).catch((cleanupError) => {
      console.error(`Failed to clean partial interactive publication media for ${sessionId}:`, cleanupError);
    });
    throw error;
  }

  if (existingPublication && existingPublication.isPublished !== true) {
    const previousPaths = Array.isArray(existingPublication?.manifest?.outputs?.paths)
      ? existingPublication.manifest.outputs.paths
      : [];
    const previousRevision = normalizeOptionalString(existingPublication.mediaRevision);
    if (previousRevision && previousRevision !== mediaRevision && previousPaths.length) {
      await cleanupPathMedia(
        sessionId,
        previousPaths,
        { revisionId: previousRevision },
      ).catch((cleanupError) => {
        console.error(`Failed to clean replaced interactive publication draft for ${sessionId}:`, cleanupError);
      });
    }
  }

  return attachInteractivePublicationRevision(
    serializeInteractivePublication(candidatePublication),
    mediaRevision,
  );
}

export async function markInteractivePublicationPublished(
  publicationId,
  {
    expectedRevision = null,
    publicationModel = InteractivePublication,
    cleanupPathMedia = deletePublicInteractivePublicationMediaForSession,
  } = {},
) {
  const normalizedPublicationId = publicationId?.toString?.() || normalizeOptionalString(publicationId);
  if (!normalizedPublicationId) {
    throw new Error('Missing InteractivePublication id.');
  }

  const current = await publicationModel.findOne({ _id: normalizedPublicationId }).lean();
  if (!current) {
    const error = new Error('InteractivePublication could not be finalized for public rendering.');
    error.statusCode = 500;
    throw error;
  }

  const normalizedExpectedRevision = normalizeOptionalString(expectedRevision);
  const pendingRevision = normalizeOptionalString(current.pendingMediaRevision);
  let publication;
  if (pendingRevision) {
    if (normalizedExpectedRevision && normalizedExpectedRevision !== pendingRevision) {
      const error = new Error('InteractivePublication publish revision was superseded.');
      error.statusCode = 409;
      throw error;
    }
    const pendingData = current.pendingPublicationData;
    if (
      !pendingData ||
      normalizeOptionalString(pendingData.mediaRevision) !== pendingRevision
    ) {
      const error = new Error('InteractivePublication draft data is incomplete.');
      error.statusCode = 500;
      throw error;
    }

    publication = await publicationModel.findOneAndUpdate(
      {
        _id: normalizedPublicationId,
        pendingMediaRevision: pendingRevision,
        unpublishToken: null,
        isDeleted: { $ne: true },
      },
      {
        $set: {
          ...pendingData,
          isPublished: true,
          isRenderable: true,
        },
        $unset: {
          pendingMediaRevision: '',
          pendingPublicationData: '',
        },
      },
      { new: true, runValidators: true },
    );

    if (publication) {
      const previousPaths = Array.isArray(current?.manifest?.outputs?.paths)
        ? current.manifest.outputs.paths
        : [];
      const previousRevision = normalizeOptionalString(current.mediaRevision);
      if (previousPaths.length && previousRevision !== pendingRevision) {
        await cleanupPathMedia(
          current.sessionId,
          previousPaths,
          { revisionId: previousRevision },
        ).catch((cleanupError) => {
          console.error(
            `Failed to clean replaced interactive publication media for ${current.sessionId}:`,
            cleanupError,
          );
        });
      }
    }
  } else {
    const currentRevision = normalizeOptionalString(current.mediaRevision);
    if (normalizedExpectedRevision && normalizedExpectedRevision !== currentRevision) {
      const error = new Error('InteractivePublication publish revision was superseded.');
      error.statusCode = 409;
      throw error;
    }
    publication = await publicationModel.findOneAndUpdate(
      {
        _id: normalizedPublicationId,
        mediaRevision: currentRevision,
        unpublishToken: null,
        isRenderable: true,
        isDeleted: { $ne: true },
      },
      { $set: { isPublished: true } },
      { new: true, runValidators: true },
    );
  }

  if (!publication) {
    const error = new Error('InteractivePublication could not be finalized for public rendering.');
    error.statusCode = 500;
    throw error;
  }

  return serializeInteractivePublication(publication);
}

export async function abortInteractivePublicationPublish(
  publicationId,
  {
    expectedRevision = null,
    publicationModel = InteractivePublication,
    cleanupPathMedia = deletePublicInteractivePublicationMediaForSession,
  } = {},
) {
  const normalizedPublicationId = publicationId?.toString?.() || normalizeOptionalString(publicationId);
  if (!normalizedPublicationId) return { aborted: false };

  const publication = await publicationModel.findOne({ _id: normalizedPublicationId }).lean();
  if (!publication) return { aborted: false };

  const normalizedExpectedRevision = normalizeOptionalString(expectedRevision);
  const pendingRevision = normalizeOptionalString(publication.pendingMediaRevision);
  if (pendingRevision) {
    if (normalizedExpectedRevision && normalizedExpectedRevision !== pendingRevision) {
      return { aborted: false };
    }
    const updateResult = await publicationModel.updateOne(
      { _id: publication._id, pendingMediaRevision: pendingRevision },
      {
        $unset: {
          pendingMediaRevision: '',
          pendingPublicationData: '',
        },
      },
    );
    if ((updateResult?.matchedCount ?? updateResult?.n ?? 1) === 0) {
      return { aborted: false };
    }
    const pendingPaths = Array.isArray(
      publication?.pendingPublicationData?.manifest?.outputs?.paths,
    )
      ? publication.pendingPublicationData.manifest.outputs.paths
      : [];
    await cleanupPathMedia(
      publication.sessionId,
      pendingPaths,
      { revisionId: pendingRevision },
    );
    return { aborted: true, deleted: false };
  }

  const liveRevision = normalizeOptionalString(publication.mediaRevision);
  if (
    publication.isPublished === true ||
    (normalizedExpectedRevision && normalizedExpectedRevision !== liveRevision)
  ) {
    return { aborted: false };
  }

  const updateResult = await publicationModel.updateOne(
    { _id: publication._id, mediaRevision: liveRevision, isPublished: { $ne: true } },
    { $set: { isPublished: false, isRenderable: false } },
  );
  if ((updateResult?.matchedCount ?? updateResult?.n ?? 1) === 0) {
    return { aborted: false };
  }
  const paths = Array.isArray(publication?.manifest?.outputs?.paths)
    ? publication.manifest.outputs.paths
    : [];
  await cleanupPathMedia(
    publication.sessionId,
    paths,
    { revisionId: liveRevision },
  );
  await publicationModel.deleteOne({ _id: publication._id, isPublished: { $ne: true } });
  return { aborted: true, deleted: true };
}

export async function stageInteractivePublicationUnpublish(
  sessionId,
  {
    publicationModel = InteractivePublication,
  } = {},
) {
  const normalizedSessionId = sessionId?.toString?.() || normalizeOptionalString(sessionId);
  if (!normalizedSessionId) {
    throw new Error('Missing sessionId');
  }

  const publication = await publicationModel.findOne({ sessionId: normalizedSessionId }).lean();
  if (!publication) {
    return {
      sessionId: normalizedSessionId,
      publicationId: null,
      token: null,
      existed: false,
    };
  }

  const existingToken = normalizeOptionalString(publication.unpublishToken);
  if (existingToken) {
    return {
      sessionId: normalizedSessionId,
      publicationId: publication._id?.toString?.() || null,
      token: existingToken,
      existed: true,
      previousPublished: publication.unpublishPreviousPublished === true,
      previousRenderable: publication.unpublishPreviousRenderable === true,
    };
  }

  const token = randomUUID();
  const previousPublished = publication.isPublished === true;
  const previousRenderable = publication.isRenderable === true;
  const staged = await publicationModel.findOneAndUpdate(
    {
      _id: publication._id,
      mediaRevision: normalizeOptionalString(publication.mediaRevision),
      pendingMediaRevision: normalizeOptionalString(publication.pendingMediaRevision),
      isPublished: previousPublished,
      isRenderable: previousRenderable,
      unpublishToken: null,
    },
    {
      $set: {
        isPublished: false,
        unpublishToken: token,
        unpublishPreviousPublished: previousPublished,
        unpublishPreviousRenderable: previousRenderable,
      },
    },
    { new: true, runValidators: true },
  );
  if (!staged) {
    const error = new Error('InteractivePublication changed while unpublish was starting.');
    error.statusCode = 409;
    throw error;
  }

  return {
    sessionId: normalizedSessionId,
    publicationId: publication._id?.toString?.() || null,
    token,
    existed: true,
    previousPublished,
    previousRenderable,
  };
}

export async function restoreInteractivePublicationUnpublish(
  stage,
  { publicationModel = InteractivePublication } = {},
) {
  if (!stage?.publicationId || !stage?.token) return { restored: false };

  const publication = await publicationModel.findOneAndUpdate(
    { _id: stage.publicationId, unpublishToken: stage.token },
    {
      $set: {
        isPublished: stage.previousPublished === true,
        isRenderable: stage.previousRenderable === true,
      },
      $unset: {
        unpublishToken: '',
        unpublishPreviousPublished: '',
        unpublishPreviousRenderable: '',
      },
    },
    { new: true, runValidators: true },
  );
  return { restored: Boolean(publication) };
}

export async function finalizeInteractivePublicationUnpublish(
  stage,
  {
    publicationModel = InteractivePublication,
    cleanupPathMedia = deletePublicInteractivePublicationMediaForSession,
  } = {},
) {
  if (!stage?.publicationId || !stage?.token) {
    return { publicationId: null, deleted: false };
  }

  const publication = await publicationModel.findOne({
    _id: stage.publicationId,
    unpublishToken: stage.token,
  }).lean();
  if (!publication) {
    return { publicationId: stage.publicationId, deleted: false };
  }

  const paths = Array.isArray(publication?.manifest?.outputs?.paths)
    ? publication.manifest.outputs.paths
    : [];
  const pendingPaths = Array.isArray(
    publication?.pendingPublicationData?.manifest?.outputs?.paths,
  )
    ? publication.pendingPublicationData.manifest.outputs.paths
    : [];
  const finalizationToken = randomUUID();
  const hideResult = await publicationModel.updateOne(
    { _id: publication._id, unpublishToken: stage.token },
    {
      $set: {
        isPublished: false,
        isRenderable: false,
        unpublishToken: finalizationToken,
      },
    },
  );
  if ((hideResult?.matchedCount ?? hideResult?.n ?? 1) === 0) {
    return { publicationId: stage.publicationId, deleted: false };
  }
  const mediaVersions = [
    {
      paths,
      revisionId: normalizeOptionalString(publication.mediaRevision),
    },
    ...(pendingPaths.length
      ? [{
        paths: pendingPaths,
        revisionId: normalizeOptionalString(publication.pendingMediaRevision),
      }]
      : []),
  ];
  const cleanupResults = await Promise.allSettled(
    mediaVersions.map((media) => cleanupPathMedia(
      publication.sessionId,
      media.paths,
      { revisionId: media.revisionId },
    )),
  );
  const rejectedCleanup = cleanupResults.find((result) => result.status === 'rejected');
  if (rejectedCleanup) throw rejectedCleanup.reason;
  const failedObjects = cleanupResults.flatMap((result) => (
    result.status === 'fulfilled' && Array.isArray(result.value?.failed)
      ? result.value.failed
      : []
  ));
  if (failedObjects.length) {
    const error = new Error('InteractivePublication media cleanup is incomplete.');
    error.statusCode = 502;
    error.cleanupFailures = failedObjects;
    throw error;
  }
  await publicationModel.deleteOne({
    _id: publication._id,
    unpublishToken: finalizationToken,
  });

  return {
    publicationId: publication._id?.toString?.() || null,
    deleted: true,
  };
}

export async function deleteInteractivePublicationForSession(
  sessionId,
  {
    publicationModel = InteractivePublication,
    cleanupPathMedia = deletePublicInteractivePublicationMediaForSession,
  } = {},
) {
  const stage = await stageInteractivePublicationUnpublish(sessionId, { publicationModel });
  return finalizeInteractivePublicationUnpublish(stage, {
    publicationModel,
    cleanupPathMedia,
  });
}

export default InteractivePublication;
