export const EXPRESS_VIDEO_FIXED_PRICING_COMPONENTS_PER_SECOND = Object.freeze({
  pipeline: 4,
  inference: 4,
  image_gen_edit: 2,
  speech: 2,
  music: 2,
  effects_and_lipsync: 2,
});

export const EXPRESS_VIDEO_FIXED_COMPONENTS_TOTAL_PER_SECOND =
  Object.values(EXPRESS_VIDEO_FIXED_PRICING_COMPONENTS_PER_SECOND)
    .reduce((total, value) => total + value, 0);

export const EXPRESS_VIDEO_STAGE_CREDITS_PER_SECOND = Object.freeze({
  narrative_inference: EXPRESS_VIDEO_FIXED_PRICING_COMPONENTS_PER_SECOND.inference,
  image_generation: EXPRESS_VIDEO_FIXED_PRICING_COMPONENTS_PER_SECOND.image_gen_edit,
  speech_generation: EXPRESS_VIDEO_FIXED_PRICING_COMPONENTS_PER_SECOND.speech,
  music_generation: EXPRESS_VIDEO_FIXED_PRICING_COMPONENTS_PER_SECOND.music,
  sound_effect_generation: 1,
  lip_sync_generation: 1,
  narrator_avatar_generation: 4,
  pipeline: EXPRESS_VIDEO_FIXED_PRICING_COMPONENTS_PER_SECOND.pipeline,
});

export const EXPRESS_VIDEO_OPTIONAL_ADDON_CREDITS_PER_SECOND = Object.freeze({
  express_cta_generation: 1,
});

export const EXPRESS_VIDEO_NON_VIDEO_STAGE_CREDITS_PER_SECOND_TOTAL =
  Object.entries(EXPRESS_VIDEO_STAGE_CREDITS_PER_SECOND)
    .filter(([stageKey]) => stageKey !== 'narrator_avatar_generation')
    .reduce((total, [, value]) => total + value, 0);

export const EXPRESS_VIDEO_CREDITS_PER_SECOND_BY_MODEL = Object.freeze({
  RUNWAYML: 30,
  'VEO3.1I2V': 60,
  'VEO3.1I2VFAST': 36,
  COSMOS3SUPERI2V: 20,
  SEEDANCEI2V: 30,
  'SEEDANCE2.0I2V': 40,
  KLINGIMGTOVID3PRO: 36,
  KLINGIMGTOVIDTURBO: 36,
  HAPPYHORSEI2V: 36,
});

export const EXPRESS_VIDEO_PRICING_DISTRIBUTION_PER_SECOND_BY_MODEL = Object.freeze(
  Object.fromEntries(
    Object.entries(EXPRESS_VIDEO_CREDITS_PER_SECOND_BY_MODEL)
      .map(([model, total]) => [
        model,
        Object.freeze({
          ...EXPRESS_VIDEO_FIXED_PRICING_COMPONENTS_PER_SECOND,
          video: total - EXPRESS_VIDEO_FIXED_COMPONENTS_TOTAL_PER_SECOND,
          total,
          optionalAddons: EXPRESS_VIDEO_OPTIONAL_ADDON_CREDITS_PER_SECOND,
        }),
      ]),
  ),
);

export function getExpressVideoCreditsPerSecond(model) {
  const modelKey = typeof model === 'string' ? model.trim().toUpperCase() : '';
  return EXPRESS_VIDEO_CREDITS_PER_SECOND_BY_MODEL[modelKey] ?? null;
}

export function getExpressVideoStageCreditsPerSecond(stageKey, model) {
  const normalizedStageKey = typeof stageKey === 'string' ? stageKey.trim().toLowerCase() : '';
  if (normalizedStageKey === 'ai_video_generation') {
    const totalCreditsPerSecond = getExpressVideoCreditsPerSecond(model);
    return Number.isFinite(totalCreditsPerSecond)
      ? Math.max(0, totalCreditsPerSecond - EXPRESS_VIDEO_NON_VIDEO_STAGE_CREDITS_PER_SECOND_TOTAL)
      : 0;
  }

  return EXPRESS_VIDEO_STAGE_CREDITS_PER_SECOND[normalizedStageKey] ?? 0;
}

export function getExpressVideoPricingDistributionPerSecond(model) {
  const modelKey = typeof model === 'string' ? model.trim().toUpperCase() : '';
  return EXPRESS_VIDEO_PRICING_DISTRIBUTION_PER_SECOND_BY_MODEL[modelKey] ?? null;
}
