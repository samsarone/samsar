const normalizeString = (value) => (typeof value === 'string' ? value.trim() : '');

/**
 * Thumbnail publication is intentionally best-effort once the final MP4 has
 * rendered. A transient image upload must never make the video render retry or
 * mark the branch as failed; publication can still materialize the persisted
 * local thumbnail (or decode the divergence frame from the video).
 */
export async function uploadBranchThumbnailBestEffort({
  artifact,
  existingThumbnailUrl = '',
  sessionId,
  renderPathId,
  uploadThumbnail,
} = {}) {
  const fallbackUrl = normalizeString(existingThumbnailUrl) || null;
  if (!artifact?.absoluteThumbnailPath) {
    return { thumbnailUrl: fallbackUrl, error: null };
  }

  try {
    const thumbnailUrl = await uploadThumbnail(
      artifact.absoluteThumbnailPath,
      sessionId,
      renderPathId,
    );
    return {
      thumbnailUrl: normalizeString(thumbnailUrl) || fallbackUrl,
      error: null,
    };
  } catch (error) {
    return {
      thumbnailUrl: fallbackUrl,
      error: error?.message || String(error),
    };
  }
}
