const INTERACTIVE_NARRATIVE_TYPES = new Set([
  'branched',
  'branching',
  'interactive',
  'interactive_video',
  'interactive-video',
]);

function isRecord(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function normalizeType(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function firstText(values, fallback = null) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
      return String(value);
    }
  }
  return fallback;
}

function firstArray(values, fallback = []) {
  return values.find(Array.isArray) || fallback;
}

function hasBranchManifest(value) {
  if (!isRecord(value)) {
    return false;
  }

  const schema = normalizeType(value.schema || value.schemaVersion || value.status_detail_schema);
  return (
    schema.includes('branch') ||
    schema.includes('interactive_video') ||
    Array.isArray(value.paths) ||
    Array.isArray(value.choicePoints) ||
    Array.isArray(value.choice_points) ||
    isRecord(value.tree) ||
    isRecord(value.outputs)
  );
}

/**
 * VideoSession responses vary between list, detail, and v2 status projections.
 * Keep the UI classification structural so a branched session remains labelled
 * even when one of those projections omits narrativeType.
 */
export function isInteractiveVideoSession(value) {
  if (!isRecord(value)) {
    return false;
  }

  const narrativeType = normalizeType(
    value.narrativeType ||
    value.narrative_type ||
    value.sourceNarrativeType ||
    value.source_narrative_type ||
    value.narrativeGenerationType ||
    value.narrative_generation_type
  );
  if (INTERACTIVE_NARRATIVE_TYPES.has(narrativeType)) {
    return true;
  }

  if (
    value.isBranchedNarrative === true ||
    value.isBranchedSession === true ||
    value.isInteractiveVideo === true ||
    value.interactiveVideo === true
  ) {
    return true;
  }

  if (
    hasBranchManifest(value.branching) ||
    hasBranchManifest(value.branchingTimeline) ||
    hasBranchManifest(value.branching_timeline) ||
    hasBranchManifest(value.branchingMeta) ||
    hasBranchManifest(value.branching_meta) ||
    (Array.isArray(value.branchRenderPaths) && value.branchRenderPaths.length > 0) ||
    (Array.isArray(value.branch_render_paths) && value.branch_render_paths.length > 0) ||
    firstText([value.defaultBranchPathId, value.default_branch_path_id])
  ) {
    return true;
  }

  const statusDetailSchema = normalizeType(value.statusDetailSchema || value.status_detail_schema);
  if (statusDetailSchema.includes('interactive_video') || statusDetailSchema.includes('branched_video')) {
    return true;
  }

  return isRecord(value.session) && value.session !== value
    ? isInteractiveVideoSession(value.session)
    : false;
}

export function isVideoSessionPublished(session) {
  if (!isRecord(session)) {
    return false;
  }

  const explicitPublishedValues = ['ispublishedVideo', 'isPublished', 'is_published']
    .map((field) => session[field])
    .filter((value) => typeof value === 'boolean');
  if (explicitPublishedValues.includes(true)) {
    return true;
  }
  if (explicitPublishedValues.includes(false)) {
    return false;
  }

  return Boolean(firstText([
    session.publishedInteractivePublicationId,
    session.published_interactive_publication_id,
    session.interactivePublicationId,
    session.interactive_publication_id,
    session.publishedPublicationId,
    session.published_publication_id,
  ]));
}

export function resolveVideoPublicationResponse(responseData) {
  const data = isRecord(responseData) ? responseData : {};
  const publicationWrapper = isRecord(data.publication) ? data.publication : {};
  const resultWrapper = isRecord(data.result) ? data.result : {};
  const publication = [
    data.interactivePublication,
    data.interactive_publication,
    publicationWrapper.interactivePublication,
    publicationWrapper.interactive_publication,
    resultWrapper.interactivePublication,
    resultWrapper.interactive_publication,
    data.publication,
    resultWrapper.publication,
    data,
  ].find(isRecord) || {};

  return {
    session: isRecord(data.session) ? data.session : {},
    publication,
  };
}

function resolvePublicationId(record, { includeRecordId = true } = {}) {
  if (!isRecord(record)) {
    return null;
  }
  return firstText([
    record.publishedInteractivePublicationId,
    record.published_interactive_publication_id,
    record.interactivePublicationId,
    record.interactive_publication_id,
    record.publishedPublicationId,
    record.published_publication_id,
    record.publicationId,
    record.publication_id,
    ...(includeRecordId ? [record._id, record.id] : []),
  ]);
}

function resolveManifestDefaultVideoUrl(publication) {
  if (!isRecord(publication)) {
    return null;
  }

  const manifest = isRecord(publication.manifest) ? publication.manifest : {};
  const outputs = isRecord(manifest.outputs) ? manifest.outputs : {};
  const paths = Array.isArray(outputs.paths)
    ? outputs.paths
    : Array.isArray(manifest.paths)
      ? manifest.paths
      : [];
  const defaultPathId = firstText([
    outputs.defaultPathId,
    outputs.default_path_id,
    manifest.defaultPathId,
    manifest.default_path_id,
  ]);
  const defaultPath = (
    (defaultPathId
      ? paths.find((path) => firstText([path?.pathId, path?.path_id, path?.id]) === defaultPathId)
      : null) ||
    paths.find((path) => path?.isDefault === true || path?.is_default === true) ||
    paths[0]
  );

  return firstText([
    outputs.defaultUrl,
    outputs.default_url,
    manifest.defaultUrl,
    manifest.default_url,
    defaultPath?.url,
    defaultPath?.videoUrl,
    defaultPath?.video_url,
  ]);
}

/**
 * Normalizes both legacy Publication and InteractivePublication responses into
 * the VideoSession fields consumed by Studio and VidGenie.
 */
export function mergePublishedVideoSessionState({
  currentSession,
  responseData,
  publishPayload,
  fallbackVideoUrl,
} = {}) {
  const current = isRecord(currentSession) ? currentSession : {};
  const payload = isRecord(publishPayload) ? publishPayload : {};
  const { session: responseSession, publication } = resolveVideoPublicationResponse(responseData);
  const publicationId = resolvePublicationId(responseSession, { includeRecordId: false }) ||
    resolvePublicationId(publication);
  const isInteractive = [current, responseSession, publication, responseData]
    .some(isInteractiveVideoSession);
  const publishedVideoURL = firstText([
    responseSession.publishedVideoURL,
    responseSession.published_video_url,
    publication.videoURL,
    publication.video_url,
    publication.mainVideoUrl,
    publication.main_video_url,
    publication.defaultUrl,
    publication.default_url,
    publication.outputs?.defaultUrl,
    publication.outputs?.default_url,
    publication.branching?.outputs?.defaultUrl,
    publication.branching?.outputs?.default_url,
    resolveManifestDefaultVideoUrl(publication),
    responseData?.videoURL,
    responseData?.video_url,
    responseData?.mainVideoUrl,
    responseData?.main_video_url,
    fallbackVideoUrl,
    current.publishedVideoURL,
    current.remoteURL,
  ]);
  const publishedAt = firstText([
    responseSession.publishedAt,
    responseSession.published_at,
    publication.publishedAt,
    publication.published_at,
    publication.updatedAt,
    publication.updated_at,
    publication.createdAt,
    publication.created_at,
    current.publishedAt,
  ]) || new Date().toISOString();
  const publishedSplashImage = firstText([
    responseSession.publishedSplashImage,
    responseSession.published_splash_image,
    publication.mainThumbnailUrl,
    publication.main_thumbnail_url,
    publication.thumbnailUrl,
    publication.thumbnail_url,
    publication.splashImage,
    publication.splash_image,
    responseData?.mainThumbnailUrl,
    responseData?.main_thumbnail_url,
    payload.splashImage,
    current.publishedSplashImage,
    current.splashImage,
  ]);

  const nextSession = {
    ...current,
    ...responseSession,
    ispublishedVideo: true,
    isPublished: true,
    publishedTitle: firstText([
      responseSession.publishedTitle,
      responseSession.published_title,
      publication.title,
      payload.title,
      current.publishedTitle,
    ]),
    publishedDescription:
      typeof responseSession.publishedDescription === 'string'
        ? responseSession.publishedDescription
        : typeof responseSession.published_description === 'string'
          ? responseSession.published_description
          : typeof publication.description === 'string'
            ? publication.description
            : typeof payload.description === 'string'
              ? payload.description
              : current.publishedDescription || '',
    publishedTags: firstArray([
      responseSession.publishedTags,
      responseSession.published_tags,
      publication.tags,
      payload.tags,
      current.publishedTags,
    ]),
    publishedAspectRatio: firstText([
      responseSession.publishedAspectRatio,
      responseSession.published_aspect_ratio,
      publication.aspectRatio,
      publication.aspect_ratio,
      payload.aspectRatio,
      current.publishedAspectRatio,
    ]),
    publishedVideoURL,
    publishedSplashImage,
    publishedAt,
    publishedPublicationId: publicationId || current.publishedPublicationId || null,
  };

  if (isInteractive) {
    nextSession.publishedInteractivePublicationId = firstText([
      responseSession.publishedInteractivePublicationId,
      responseSession.published_interactive_publication_id,
      responseSession.interactivePublicationId,
      responseSession.interactive_publication_id,
      publicationId,
      current.publishedInteractivePublicationId,
    ]);
  }

  return nextSession;
}
