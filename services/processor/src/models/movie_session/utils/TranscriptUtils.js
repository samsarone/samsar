import {
  getVideoModelDurationUnitsForFramesPerSecond,
  VIDEO_MODEL_PRICES,
} from '../../../consts/ModelPrices.js';
import { normalizeTTSSpeakerGender } from '../../../consts/TTSSpeakers.js';
import {
  getMaxSpeechCharacterLimitForModel,
  getSpeechCharacterLimitForDuration,
} from './ModelUtils.js';

const TEXT_TO_VIDEO_NARRATIVE_DURATION_TOLERANCE_SECONDS = 30;
export const SPEECH_CHARACTER_LIMIT_EXCEEDED_CODE = 'SPEECH_CHARACTER_LIMIT_EXCEEDED';
export const ACCEPTED_NARRATIVE_SOUND_TYPES = Object.freeze([
  'speech',
  'sound_effect',
]);

function getDurationUnitsForVideoGenerationModel(modelKey, framesPerSecond = undefined) {
  if (!modelKey) {
    return [5];
  }

  const fpsAwareUnits = getVideoModelDurationUnitsForFramesPerSecond(modelKey, framesPerSecond);
  if (Array.isArray(fpsAwareUnits) && fpsAwareUnits.length > 0) {
    return fpsAwareUnits;
  }

  const expressModels = VIDEO_MODEL_PRICES.filter((model) => model.isExpressModel === true);
  let modelType = expressModels.find((type) => type.key === modelKey);

  if (!modelType) {
    modelType = VIDEO_MODEL_PRICES.find((type) => type.key === modelKey);
  }

  const units = Array.isArray(modelType?.units) && modelType.units.length > 0
    ? modelType.units
    : [5];

  const sanitizedUnits = [...new Set(units)].filter((unit) => typeof unit === 'number' && unit > 0);

  if (sanitizedUnits.length === 0) {
    return [5];
  }

  return sanitizedUnits.sort((a, b) => a - b);
}

function normalizeDurationForUnits(rawDuration, units) {
  const durationUnits = Array.isArray(units) && units.length > 0 ? units.slice().sort((a, b) => a - b) : [5];

  const numericDuration = Number(rawDuration);
  if (!Number.isFinite(numericDuration) || numericDuration <= 0) {
    return durationUnits[0];
  }

  const match = durationUnits.find((unit) => unit >= numericDuration);
  return match || durationUnits[durationUnits.length - 1];
}

function getSoundLayerDuration(soundLayer) {
  if (!soundLayer) {
    return null;
  }

  const explicitDuration = Number(soundLayer.duration);
  if (Number.isFinite(explicitDuration) && explicitDuration > 0) {
    return explicitDuration;
  }

  const start = Number(soundLayer.startTime);
  const end = Number(soundLayer.endTime);
  if (Number.isFinite(start) && Number.isFinite(end)) {
    const diff = end - start;
    if (diff > 0) {
      return diff;
    }
  }

  return null;
}

function parseSceneIndex(sceneIndex) {
  if (sceneIndex === null || sceneIndex === undefined) {
    return null;
  }

  if (typeof sceneIndex === 'number') {
    if (!Number.isInteger(sceneIndex) || sceneIndex < 0) {
      return null;
    }
    return sceneIndex;
  }

  if (typeof sceneIndex === 'string') {
    const trimmed = sceneIndex.trim();
    if (!/^\d+$/.test(trimmed)) {
      return null;
    }

    const numericSceneIndex = Number.parseInt(trimmed, 10);
    if (!Number.isInteger(numericSceneIndex) || numericSceneIndex < 0) {
      return null;
    }
    return numericSceneIndex;
  }

  return null;
}

function normalizeComparableString(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function normalizeSoundTypeToken(value) {
  return normalizeComparableString(value)
    .replace(/[\s-]+/g, '_')
    .replace(/_+/g, '_');
}

function getEditDistance(leftValue, rightValue) {
  const left = Array.from(leftValue);
  const right = Array.from(rightValue);
  const previous = Array.from({ length: right.length + 1 }, (_unused, index) => index);

  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex];
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      current[rightIndex] = Math.min(
        current[rightIndex - 1] + 1,
        previous[rightIndex] + 1,
        previous[rightIndex - 1] +
          (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1),
      );
    }
    previous.splice(0, previous.length, ...current);
  }

  return previous[right.length];
}

function findNearestNarrativeSoundType(rawType) {
  const normalizedType = normalizeSoundTypeToken(rawType);
  if (!normalizedType) {
    return null;
  }

  return ACCEPTED_NARRATIVE_SOUND_TYPES.reduce((nearest, candidate) => {
    const distance = getEditDistance(normalizedType, candidate);
    if (!nearest || distance < nearest.distance) {
      return { type: candidate, distance };
    }
    return nearest;
  }, null);
}

function canonicalizeNarrativeSoundTypes(sounds, { enabled = false } = {}) {
  const repairs = [];
  const canonicalSounds = sounds.map((sound, soundIndex) => {
    if (!sound || typeof sound !== 'object' || Array.isArray(sound)) {
      return sound;
    }

    const normalizedType = normalizeSoundTypeToken(sound.type);
    if (ACCEPTED_NARRATIVE_SOUND_TYPES.includes(normalizedType)) {
      return normalizedType === sound.type ? sound : { ...sound, type: normalizedType };
    }
    if (!enabled) {
      return { ...sound, type: normalizedType };
    }

    const nearest = findNearestNarrativeSoundType(normalizedType);
    if (!nearest) {
      return { ...sound, type: normalizedType };
    }

    repairs.push({
      soundIndex,
      from: normalizedType,
      to: nearest.type,
      distance: nearest.distance,
    });
    return { ...sound, type: nearest.type };
  });

  return { sounds: canonicalSounds, repairs };
}

function normalizeSpeechGender(rawGender) {
  return normalizeTTSSpeakerGender(rawGender);
}

function inferGenderFromText(rawText) {
  if (rawText === null || rawText === undefined) {
    return null;
  }

  const text = String(rawText).toLowerCase();
  if (!text) {
    return null;
  }

  const femaleMatches = text.match(
    /\b(woman|women|female|feminine|girl|girls|she|her|hers|mother|mom|sister|wife|queen|princess)\b/g
  ) || [];
  const maleMatches = text.match(
    /\b(man|men|male|masculine|boy|boys|he|him|his|father|dad|brother|husband|king|prince)\b/g
  ) || [];

  if (femaleMatches.length > maleMatches.length) {
    return 'F';
  }

  if (maleMatches.length > femaleMatches.length) {
    return 'M';
  }

  return null;
}

function normalizeNarrativeSceneType(rawType) {
  const normalizedType = normalizeComparableString(rawType);
  if (
    normalizedType === 'character' ||
    normalizedType === 'narration' ||
    normalizedType === 'sound_effect' ||
    normalizedType === 'base'
  ) {
    return normalizedType;
  }

  // Backwards compatibility with older schema.
  if (normalizedType === 'none' || normalizedType === 'scene') {
    return 'base';
  }

  return 'base';
}

function matchesSoundForScene(sound, scene) {
  if (!sound || !scene) return false;

  const sceneType = normalizeNarrativeSceneType(scene.type);
  const soundType = normalizeComparableString(sound.type);
  const soundSubType = normalizeComparableString(sound.subType);

  if (sceneType === 'character') {
    if (soundType !== 'speech' || soundSubType !== 'character') return false;

    const sceneSpeaker = normalizeComparableString(scene.speaker);
    const soundActor = normalizeComparableString(sound.actor);
    if (!sceneSpeaker || !soundActor) return false;

    return sceneSpeaker === soundActor;
  }

  if (sceneType === 'narration') {
    return soundType === 'speech' && soundSubType === 'narration';
  }

  if (sceneType === 'sound_effect') {
    return soundType === 'sound_effect';
  }

  return false;
}

function findMatchingSoundForScene(scene, sceneSounds) {
  if (!Array.isArray(sceneSounds) || !scene) return null;
  return sceneSounds.find((sound) => matchesSoundForScene(sound, scene)) || null;
}

function hasMatchingSoundForSceneIndex(sounds, scenes, sceneIndex) {
  const scene = scenes[sceneIndex];
  if (!scene) {
    return false;
  }

  return sounds.some((sound) => (
    parseSceneIndex(sound?.sceneIndex) === sceneIndex &&
    matchesSoundForScene(sound, scene)
  ));
}

function repairAdjacentForwardSceneIndexMismatches(scenes, sounds, { enabled = false } = {}) {
  if (!enabled || !Array.isArray(scenes) || !Array.isArray(sounds) || sounds.length === 0) {
    return { sounds, repairCount: 0 };
  }

  let repairCount = 0;
  const repairedSounds = sounds.map((sound) => {
    const sceneIndex = parseSceneIndex(sound?.sceneIndex);
    if (sceneIndex === null) {
      return sound;
    }

    const currentScene = scenes[sceneIndex];
    if (matchesSoundForScene(sound, currentScene)) {
      return sound;
    }

    const nextSceneIndex = sceneIndex + 1;
    const nextScene = scenes[nextSceneIndex];
    if (!nextScene || !matchesSoundForScene(sound, nextScene)) {
      return sound;
    }

    if (hasMatchingSoundForSceneIndex(sounds, scenes, nextSceneIndex)) {
      return sound;
    }

    repairCount += 1;
    return {
      ...sound,
      sceneIndex: nextSceneIndex,
      sceneIndexRepair: {
        from: sceneIndex,
        to: nextSceneIndex,
        reason: 'adjacent_forward_type_match',
      },
    };
  });

  return { sounds: repairedSounds, repairCount };
}

function normalizeNarrativeSoundEntries(sounds) {
  const normalizedEntries = [];

  sounds.forEach((sound, sourceSoundIndex) => {
    const hasSceneIndex = sound && Object.prototype.hasOwnProperty.call(sound, 'sceneIndex');
    if (!hasSceneIndex) {
      return;
    }

    const parsedSceneIndex = parseSceneIndex(sound.sceneIndex);
    if (parsedSceneIndex === null) {
      return;
    }

    const normalizedSound = { ...sound, sceneIndex: parsedSceneIndex };
    const normalizedGender = normalizeSpeechGender(sound.gender);
    if (normalizeComparableString(sound.type) === 'speech' && normalizedGender) {
      normalizedSound.gender = normalizedGender;
    }

    normalizedEntries.push({ sound: normalizedSound, sourceSoundIndex });
  });

  return normalizedEntries;
}

function normalizeNarrativeSounds(sounds) {
  return normalizeNarrativeSoundEntries(sounds).map(({ sound }) => sound);
}

function backfillMissingSpeechGenders(scenes, sounds) {
  return sounds.map((sound) => {
    if (normalizeComparableString(sound?.type) !== 'speech') {
      return sound;
    }

    const normalizedGender = normalizeSpeechGender(sound.gender);
    if (normalizedGender) {
      return { ...sound, gender: normalizedGender };
    }

    const sceneIndex = parseSceneIndex(sound.sceneIndex);
    const scene = sceneIndex === null ? null : scenes[sceneIndex];
    const sceneType = normalizeNarrativeSceneType(scene?.type);
    const soundSubType = normalizeComparableString(sound.subType);

    if (sceneType === 'narration' && soundSubType === 'narration') {
      return { ...sound, gender: 'F' };
    }

    if (sceneType !== 'character' || soundSubType !== 'character') {
      return sound;
    }

    const inferredGender = inferGenderFromText([
      scene?.visual,
      sound?.Identity,
      sound?.identity,
    ].filter(Boolean).join(' '));

    return inferredGender ? { ...sound, gender: inferredGender } : sound;
  });
}

function validateSpeechGenders(scenes, sounds) {
  const errors = [];

  sounds.forEach((sound) => {
    if (normalizeComparableString(sound?.type) !== 'speech') {
      return;
    }

    const sceneIndex = parseSceneIndex(sound.sceneIndex);
    const scene = sceneIndex === null ? null : scenes[sceneIndex];
    const sceneType = normalizeNarrativeSceneType(scene?.type);
    const soundSubType = normalizeComparableString(sound.subType);
    const isMatchedSpeechScene = (
      (sceneType === 'character' && soundSubType === 'character') ||
      (sceneType === 'narration' && soundSubType === 'narration')
    );
    if (!isMatchedSpeechScene) {
      return;
    }

    const normalizedGender = normalizeSpeechGender(sound.gender);
    if (!normalizedGender) {
      errors.push(`Speech item at scene ${sceneIndex ?? 'unknown'} must include gender "M" or "F".`);
      return;
    }

    if (sceneType !== 'character') {
      return;
    }

    const visualGender = inferGenderFromText(scene?.visual);
    if (visualGender && visualGender !== normalizedGender) {
      errors.push(
        `Character speech at scene ${sceneIndex} has gender "${normalizedGender}" but the scene visual indicates "${visualGender}".`
      );
    }
  });

  return errors;
}

function validateNoSpeechSoundEffectSceneConflicts(sounds) {
  const soundTypesByScene = new Map();

  sounds.forEach((sound) => {
    const sceneIndex = parseSceneIndex(sound?.sceneIndex);
    if (sceneIndex === null) {
      return;
    }

    const soundType = normalizeComparableString(sound?.type);
    if (soundType !== 'speech' && soundType !== 'sound_effect') {
      return;
    }

    if (!soundTypesByScene.has(sceneIndex)) {
      soundTypesByScene.set(sceneIndex, new Set());
    }
    soundTypesByScene.get(sceneIndex).add(soundType);
  });

  const errors = [];
  soundTypesByScene.forEach((soundTypes, sceneIndex) => {
    if (soundTypes.has('speech') && soundTypes.has('sound_effect')) {
      errors.push(`Scene ${sceneIndex} contains both speech and sound_effect audio; regenerate narrative with only one audio role per scene.`);
    }
  });

  return errors;
}

function normalizeNarrativeAudio({ scenes, sounds, model, framesPerSecond = undefined }) {
  const durationUnits = getDurationUnitsForVideoGenerationModel(model, framesPerSecond);
  const maxSceneDuration = durationUnits[durationUnits.length - 1];

  const soundsByScene = new Map();
  sounds.forEach((sound) => {
    const idx = parseSceneIndex(sound.sceneIndex);
    if (idx === null) return;
    if (idx >= scenes.length) return;

    if (!soundsByScene.has(idx)) {
      soundsByScene.set(idx, []);
    }
    // Normalize the sceneIndex so "4" and 4 are treated the same.
    soundsByScene.get(idx).push({ ...sound, sceneIndex: idx });
  });

  const chosenSoundByScene = new Map();
  for (let i = 0; i < scenes.length; i++) {
    const sceneSounds = soundsByScene.get(i) || [];
    const matchedSound = findMatchingSoundForScene(scenes[i], sceneSounds);
    if (matchedSound) {
      chosenSoundByScene.set(i, matchedSound);
    }
  }

  const adjustedScenes = [];
  const adjustedSounds = [];
  let startTimeCursor = 0;

  for (let i = 0; i < scenes.length; i++) {
    let scene = { ...scenes[i], type: normalizeNarrativeSceneType(scenes[i]?.type) };
    const chosenSound = chosenSoundByScene.get(i) || null;

    if (!chosenSound) {
      scene = { ...scene, type: 'base' };
    }

    const soundDuration = chosenSound ? getSoundLayerDuration(chosenSound) : null;

    let sceneDuration = normalizeDurationForUnits(scene.duration, durationUnits);
    if (typeof soundDuration === 'number') {
      const matchedUnit = durationUnits.find((unit) => unit >= soundDuration);
      sceneDuration = matchedUnit || maxSceneDuration;
    }

    if (sceneDuration > maxSceneDuration) {
      sceneDuration = maxSceneDuration;
    }

    const sceneStart = startTimeCursor;
    const sceneEnd = sceneStart + sceneDuration;
    scene = {
      ...scene,
      startTime: sceneStart,
      duration: sceneDuration,
      endTime: sceneEnd,
    };

    if (chosenSound) {
      const usableSoundDuration = Math.min(soundDuration ?? sceneDuration, sceneDuration);
      const adjustedSound = {
        ...chosenSound,
        sceneIndex: i,
        startTime: sceneStart,
        duration: usableSoundDuration,
        endTime: sceneStart + usableSoundDuration,
      };
      adjustedSounds.push(adjustedSound);
    }

    adjustedScenes.push(scene);
    startTimeCursor = sceneEnd;
  }

  return {
    scenes: adjustedScenes,
    sounds: adjustedSounds,
  };
}

function getNarrativeTotalDuration(scenes) {
  return scenes.reduce((totalDuration, scene) => totalDuration + Number(scene.duration), 0);
}

function validateNarrativeDuration(requestedDuration, actualDuration) {
  if (requestedDuration === undefined || requestedDuration === null) {
    return [];
  }

  const numericRequestedDuration = Number(requestedDuration);
  if (!Number.isFinite(numericRequestedDuration) || numericRequestedDuration <= 0) {
    return ['Requested narrative duration must be a positive number.'];
  }

  const deviation = Math.abs(actualDuration - numericRequestedDuration);
  if (deviation <= TEXT_TO_VIDEO_NARRATIVE_DURATION_TOLERANCE_SECONDS) {
    return [];
  }

  return [
    `Narrative duration is ${actualDuration} seconds but ${numericRequestedDuration} seconds were requested. ` +
    `The ${deviation}-second deviation exceeds the allowed ${TEXT_TO_VIDEO_NARRATIVE_DURATION_TOLERANCE_SECONDS} seconds.`,
  ];
}

function validateTextToVideoNarrativeContent(scenes, sounds) {
  const errors = [];

  scenes.forEach((scene, sceneIndex) => {
    if (typeof scene?.visual !== 'string' || !scene.visual.trim()) {
      errors.push(`Scene ${sceneIndex} must include a non-empty visual.`);
    }
  });

  sounds.forEach((sound, soundIndex) => {
    if (sound?.type !== 'speech' && sound?.type !== 'sound_effect') {
      return;
    }
    if (typeof sound?.audio === 'string' && sound.audio.trim()) {
      return;
    }

    const sceneIndex = Number.isInteger(Number(sound?.sceneIndex))
      ? Number(sound.sceneIndex)
      : 'unknown';
    errors.push(
      `Sound ${soundIndex} for scene ${sceneIndex} must include non-empty audio.`,
    );
  });

  return errors;
}

function validateNarrativeSoundTypes(sounds) {
  return sounds.flatMap((sound, soundIndex) => {
    const soundType = normalizeSoundTypeToken(sound?.type);
    if (ACCEPTED_NARRATIVE_SOUND_TYPES.includes(soundType)) {
      return [];
    }
    return [
      `Sound ${soundIndex} has invalid type "${soundType || 'empty'}"; ` +
        `expected ${ACCEPTED_NARRATIVE_SOUND_TYPES.join(' or ')}.`,
    ];
  });
}

function validateSpeechCharacterLimits(
  scenes,
  sounds,
  model,
  framesPerSecond,
  { languageString, sourceSoundIndexes = [] } = {},
) {
  const maximum = getMaxSpeechCharacterLimitForModel(
    model,
    languageString,
    framesPerSecond,
  );
  if (!maximum) return { errors: [], violations: [] };

  const toleratedMaxCharacters = maximum.validationMaxCharacters ?? maximum.maxCharacters;
  const maximumPromptCharacters = maximum.maxCharacters;
  const overshootPercentage = Math.round((maximum.overshootRatio || 0) * 100);
  const modelLabel = typeof model === 'string' && model.trim()
    ? model.trim()
    : 'the selected video model';

  const violations = sounds.flatMap((sound, soundIndex) => {
    if (normalizeComparableString(sound?.type) !== 'speech' ||
      typeof sound?.audio !== 'string') {
      return [];
    }

    const characterCount = Array.from(sound.audio.trim()).length;
    if (characterCount <= toleratedMaxCharacters) return [];

    const sceneIndex = parseSceneIndex(sound.sceneIndex);
    const sceneDuration = sceneIndex === null
      ? getSoundLayerDuration(sound)
      : scenes[sceneIndex]?.duration ?? getSoundLayerDuration(sound);
    const sceneLimit = getSpeechCharacterLimitForDuration(
      model,
      sceneDuration,
      languageString,
      framesPerSecond,
    ) || maximum;
    const sourceSoundIndex = Number.isInteger(sourceSoundIndexes[soundIndex])
      ? sourceSoundIndexes[soundIndex]
      : soundIndex;
    const message =
      `Speech item at scene ${sceneIndex ?? 'unknown'} has ${characterCount} characters; ` +
      `${modelLabel} allows ${maximumPromptCharacters} characters at its maximum ` +
      `${maximum.durationSeconds}-second duration (${toleratedMaxCharacters} characters with ` +
      `${overshootPercentage}% tolerance).`;
    return [{
      code: SPEECH_CHARACTER_LIMIT_EXCEEDED_CODE,
      message,
      path: ['sounds', sourceSoundIndex, 'audio'],
      soundIndex: sourceSoundIndex,
      sceneIndex,
      actualCharacters: characterCount,
      promptMaxCharacters: sceneLimit.maxCharacters,
      validationMaxCharacters: toleratedMaxCharacters,
      excessCharacters: characterCount - toleratedMaxCharacters,
      limitDurationSeconds: sceneLimit.durationSeconds,
      validationLimitDurationSeconds: maximum.durationSeconds,
      overshootRatio: maximum.overshootRatio || 0,
    }];
  });

  return {
    errors: violations.map(({ message }) => message),
    violations,
  };
}

export function validateImageToVideoNarrative(narrativeJson, numScenes, model, framesPerSecond = undefined) {
  if (!Array.isArray(narrativeJson?.scenes)) {
    return { valid: false, errors: ['Missing or invalid `scenes` array.'], narrativeJson: { scenes: [], sounds: [] } };
  }

  let scenes = [...narrativeJson.scenes];
  let sounds = Array.isArray(narrativeJson?.sounds) ? [...narrativeJson.sounds] : [];
  sounds = normalizeNarrativeSounds(sounds);
  sounds = backfillMissingSpeechGenders(scenes, sounds);

  const errors = [
    ...validateSpeechGenders(scenes, sounds),
    ...validateNoSpeechSoundEffectSceneConflicts(sounds),
  ];

  if (scenes.length < numScenes) {
    errors.push(`Narrative has ${scenes.length} scenes but ${numScenes} were requested.`);
    return { valid: false, errors, narrativeJson: { scenes, sounds } };
  }

  if (scenes.length > numScenes) {
    scenes = scenes.slice(0, numScenes);
  }

  return {
    valid: errors.length === 0,
    errors,
    narrativeJson: normalizeNarrativeAudio({ scenes, sounds, model, framesPerSecond }),
  };
}

export function validateTextToVideoNarrative(narrativeJson, model, framesPerSecond = undefined, options = {}) {
  if (!Array.isArray(narrativeJson?.scenes)) {
    return {
      valid: false,
      errors: ['Missing or invalid `scenes` array.'],
      narrativeJson: { scenes: [], sounds: [] },
      violations: { speechCharacterLimits: [] },
    };
  }

  let scenes = [...narrativeJson.scenes];
  const rawSounds = Array.isArray(narrativeJson?.sounds) ? [...narrativeJson.sounds] : [];
  const soundTypeNormalization = canonicalizeNarrativeSoundTypes(rawSounds, {
    enabled: options.repairSoundTypes === true,
  });
  const canonicalNarrativeJson = {
    ...narrativeJson,
    scenes: scenes.map((scene) => ({ ...scene })),
    sounds: soundTypeNormalization.sounds.map((sound) => (
      sound && typeof sound === 'object' && !Array.isArray(sound) ? { ...sound } : sound
    )),
  };
  const normalizedSoundEntries = normalizeNarrativeSoundEntries(soundTypeNormalization.sounds);
  const sourceSoundIndexes = normalizedSoundEntries.map(({ sourceSoundIndex }) => sourceSoundIndex);
  let sounds = normalizedSoundEntries.map(({ sound }) => sound);

  const adjacentRepair = repairAdjacentForwardSceneIndexMismatches(scenes, sounds, {
    enabled: options.repairAdjacentSceneIndex === true,
  });
  sounds = adjacentRepair.sounds;
  sounds = backfillMissingSpeechGenders(scenes, sounds);

  const errors = [
    ...validateNarrativeSoundTypes(sounds),
    ...validateTextToVideoNarrativeContent(scenes, sounds),
    ...validateSpeechGenders(scenes, sounds),
    ...validateNoSpeechSoundEffectSceneConflicts(sounds),
  ];

  const normalizedNarrativeJson = normalizeNarrativeAudio({ scenes, sounds, model, framesPerSecond });
  const actualDuration = getNarrativeTotalDuration(normalizedNarrativeJson.scenes);
  const requestedDuration = options.requestedDuration === undefined || options.requestedDuration === null
    ? null
    : Number(options.requestedDuration);
  errors.push(...validateNarrativeDuration(requestedDuration, actualDuration));

  const speechCharacterValidation = errors.length === 0
    ? validateSpeechCharacterLimits(
      scenes,
      sounds,
      model,
      framesPerSecond,
      { ...options, sourceSoundIndexes },
    )
    : { errors: [], violations: [] };
  errors.push(...speechCharacterValidation.errors);

  return {
    valid: errors.length === 0,
    errors,
    narrativeJson: normalizedNarrativeJson,
    canonicalNarrativeJson,
    violations: {
      speechCharacterLimits: speechCharacterValidation.violations,
    },
    duration: {
      requested: requestedDuration,
      actual: actualDuration,
      deviation: Number.isFinite(requestedDuration) ? actualDuration - requestedDuration : null,
      allowedDeviation: TEXT_TO_VIDEO_NARRATIVE_DURATION_TOLERANCE_SECONDS,
    },
    repairs: {
      adjacentSceneIndex: adjacentRepair.repairCount,
      soundTypes: soundTypeNormalization.repairs,
    },
  };
}
