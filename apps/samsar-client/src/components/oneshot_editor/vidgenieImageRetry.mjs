const status = value => typeof value === 'string' ? value.trim().toUpperCase() : '';

export function canRetryVidgenieImageStage({ session, statusDetails, isPending = false } = {}) {
  const current = { ...session, ...statusDetails?.session, ...statusDetails };
  const stages = current.expressGenerationStatus || {};
  const currentStatus = status(current.status);
  return Boolean(
    current.isExpressGeneration &&
    status(stages.prompt_generation) === 'COMPLETED' &&
    status(stages.image_generation) === 'FAILED' &&
    !isPending &&
    !current.expressGenerationPaused &&
    !current.expressGenerationCancelled &&
    !['PENDING', 'RUNNING', 'PROCESSING', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'CANCELED'].includes(currentStatus) &&
    !(typeof current.videoLink === 'string' && current.videoLink.trim())
  );
}
