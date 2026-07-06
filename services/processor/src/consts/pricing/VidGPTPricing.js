
import { getExpressVideoCreditsPerSecond } from './ExpressVideoPricingDistribution.js';

export function calculatePricingForExpectedrender(movieResourceList, userInferenceModel, payload) {


  const { scenes } = movieResourceList;

  const { videoGenerationModel, creditsPerSecondOverride } = payload || {};

  const totalDuration = scenes[scenes.length - 1].endTime;

  const overrideCreditsPerSecond = Number(creditsPerSecondOverride);
  if (Number.isFinite(overrideCreditsPerSecond) && overrideCreditsPerSecond >= 0) {
    return Math.ceil(totalDuration * overrideCreditsPerSecond);
  }

  const normalizedVideoModel =
    typeof videoGenerationModel === 'string' ? videoGenerationModel.trim().toUpperCase() : '';
  if (normalizedVideoModel === 'CUSTOM_IMAGE_TO_VIDEO') {
    return 0;
  }

  const creditsPerSecond = getExpressVideoCreditsPerSecond(videoGenerationModel) ?? 30;
  const totalPrice = totalDuration * (creditsPerSecond / 100);

  const totalCredits = totalPrice * 100;

  return Math.ceil(totalCredits);
}
