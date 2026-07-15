export function resolveVidgenieLoadedProjectView({
  hasPausedGeneration = false,
  hasPendingGeneration = false,
  hasStartedGeneration = false,
  latestVideoUrl = null,
  failureStatus = '',
} = {}) {
  const isPaused = Boolean(hasPausedGeneration);
  const isPending = Boolean(!isPaused && hasPendingGeneration);
  const hasResult = Boolean(latestVideoUrl);
  const hasFailure = Boolean(failureStatus);

  return {
    isPaused,
    isPending,
    hasFailure,
    showResultDisplay: Boolean(
      isPaused ||
      isPending ||
      hasResult ||
      hasFailure ||
      hasStartedGeneration
    ),
  };
}
