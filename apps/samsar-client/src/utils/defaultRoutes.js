const STUDIO_ACCESS_CREDIT_THRESHOLD = 100;
const VIDGENIE_MINIMUM_GENERATION_CREDITS = STUDIO_ACCESS_CREDIT_THRESHOLD;

function getGenerationCredits(user) {
  return Number(user?.generationCredits || 0);
}

export function hasInsufficientGenerationCredits(
  user,
  threshold = VIDGENIE_MINIMUM_GENERATION_CREDITS,
) {
  if (!user || user.isExternalUser) return false;
  return getGenerationCredits(user) < threshold;
}

export function getDefaultAuthenticatedPath(user) {
  if (user?.isExternalUser) {
    return '/external/studio';
  }

  return '/vidgenie';
}
