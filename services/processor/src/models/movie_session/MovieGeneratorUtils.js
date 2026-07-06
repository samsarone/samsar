import { createAudioEffectInstructionsForMovieTranscript } from '../agent/AudioCreatorAgent.js';
import { validateTextToVideoNarrative } from './utils/TranscriptUtils.js';
import {
  ALL_TTS_SPEAKERS,
  ELEVENLABS_TTS_SPEAKERS,
  OPENAI_TTS_SPEAKERS,
  TTS_PROVIDER_GOOGLE,
  normalizeTTSSpeakerGender,
} from '../../consts/TTSSpeakers.js';
import {
  filterDockerSpeakerOptions,
  isDockerAudioAvailabilityFilteringEnabled,
  isDockerTTSProviderAvailable,
} from '../../consts/DockerAudioAvailability.js';
import { isOpenAITTSForcedLanguage } from './TTSLanguagePolicy.js';

function normalizeSoundGender(gender = '') {
  return normalizeTTSSpeakerGender(gender) || 'F';
}

function normalizeTTSProvider(provider = '') {
  return typeof provider === 'string' ? provider.trim().toUpperCase() : '';
}

function isOpenAISpeechSound(sound = {}) {
  return sound?.type === 'speech' && normalizeTTSProvider(sound.provider) === 'OPENAI';
}

function removeInstructionMetadataForNonOpenAISpeech(sound = {}) {
  if (sound?.type !== 'speech' || isOpenAISpeechSound(sound)) {
    return sound;
  }

  const {
    Affect,
    Tone,
    Emotion,
    Pronunciation,
    Pause,
    AudioEffects,
    instructions,
    ...rest
  } = sound;

  return rest;
}

function hasSpeakerPreferences(speakerOptions = null) {
  if (!speakerOptions || typeof speakerOptions !== 'object') {
    return false;
  }

  return Boolean(
    speakerOptions.allowOpenAI ||
    speakerOptions.allowElevenLabs ||
    speakerOptions.allowGoogle ||
    (Array.isArray(speakerOptions.openAISpeakers) && speakerOptions.openAISpeakers.length > 0) ||
    (Array.isArray(speakerOptions.elevenLabsSpeakers) && speakerOptions.elevenLabsSpeakers.length > 0) ||
    (Array.isArray(speakerOptions.googleSpeakers) && speakerOptions.googleSpeakers.length > 0)
  );
}

function isOpenAIOnlySelection(speakerOptions = null) {
  if (!speakerOptions || typeof speakerOptions !== 'object') {
    return false;
  }

  return Boolean(
    speakerOptions.allowOpenAI === true &&
    speakerOptions.allowElevenLabs !== true &&
    speakerOptions.allowGoogle !== true &&
    (!Array.isArray(speakerOptions.openAISpeakers) || speakerOptions.openAISpeakers.length === 0) &&
    (!Array.isArray(speakerOptions.elevenLabsSpeakers) || speakerOptions.elevenLabsSpeakers.length === 0) &&
    (!Array.isArray(speakerOptions.googleSpeakers) || speakerOptions.googleSpeakers.length === 0)
  );
}

function dedupeSpeakersByValue(speakers = []) {
  const seen = new Set();
  return speakers.filter((speaker) => {
    const speakerValue = typeof speaker?.value === 'string' ? speaker.value : '';
    if (!speakerValue || seen.has(speakerValue)) {
      return false;
    }

    seen.add(speakerValue);
    return true;
  });
}

function filterSpeakersBySelectedValues(speakers = [], selectedValues = []) {
  if (!Array.isArray(selectedValues) || selectedValues.length === 0) {
    return [];
  }

  const selected = new Set(
    selectedValues
      .filter((speakerValue) => typeof speakerValue === 'string' && speakerValue.trim())
      .map((speakerValue) => speakerValue.trim())
  );

  return speakers.filter((speaker) => selected.has(speaker.value));
}

function getGoogleSpeakerDetails(speakerOptions = null) {
  if (!Array.isArray(speakerOptions?.googleSpeakerDetails)) {
    return [];
  }

  return speakerOptions.googleSpeakerDetails
    .filter((speaker) => typeof speaker?.value === 'string' && speaker.value.trim())
    .map((speaker) => ({
      ...speaker,
      value: speaker.value.trim(),
      provider: TTS_PROVIDER_GOOGLE,
      Gender: normalizeTTSSpeakerGender(
        speaker.Gender || speaker.genderCode || speaker.gender || speaker.ssmlGender
      ),
    }));
}

function getProviderSpeakers(speakerOptions = null) {
  const speakers = [];

  if (speakerOptions?.allowOpenAI) {
    speakers.push(...OPENAI_TTS_SPEAKERS);
  }

  if (speakerOptions?.allowElevenLabs) {
    speakers.push(...ELEVENLABS_TTS_SPEAKERS);
  }

  if (speakerOptions?.allowGoogle) {
    speakers.push(...getGoogleSpeakerDetails(speakerOptions));
  }

  return dedupeSpeakersByValue(speakers);
}

function getSpeakerPoolsForPreferences(speakerOptions = null) {
  const googleSpeakerDetails = getGoogleSpeakerDetails(speakerOptions);
  const prioritizedSpeakers = dedupeSpeakersByValue([
    ...filterSpeakersBySelectedValues(OPENAI_TTS_SPEAKERS, speakerOptions?.openAISpeakers),
    ...filterSpeakersBySelectedValues(ELEVENLABS_TTS_SPEAKERS, speakerOptions?.elevenLabsSpeakers),
    ...filterSpeakersBySelectedValues(googleSpeakerDetails, speakerOptions?.googleSpeakers),
  ]);

  const providerSpeakers = getProviderSpeakers(speakerOptions);
  const fallbackSpeakers = providerSpeakers.length > 0 ? providerSpeakers : ALL_TTS_SPEAKERS;

  return {
    prioritizedSpeakers,
    providerSpeakers,
    fallbackSpeakers: dedupeSpeakersByValue(fallbackSpeakers),
  };
}

function pickSpeakerFromPool(pool = [], desiredGender, usedSpeakerIds) {
  const matchingSpeakers = pool.filter(
    (speaker) => speaker?.Gender?.toUpperCase() === desiredGender
  );

  if (matchingSpeakers.length === 0) {
    return null;
  }

  const unusedSpeaker = matchingSpeakers.find((speaker) => !usedSpeakerIds.has(speaker.value));
  if (unusedSpeaker) {
    usedSpeakerIds.add(unusedSpeaker.value);
    return unusedSpeaker;
  }

  return matchingSpeakers[0];
}

function choosePreferredSpeaker(desiredGender, speakerPools, usedSpeakerIds) {
  return (
    pickSpeakerFromPool(speakerPools.prioritizedSpeakers, desiredGender, usedSpeakerIds) ||
    pickSpeakerFromPool(speakerPools.providerSpeakers, desiredGender, usedSpeakerIds) ||
    pickSpeakerFromPool(speakerPools.fallbackSpeakers, desiredGender, usedSpeakerIds) ||
    null
  );
}

function toTitleCase(str) {
  return str
    ? str
      .split(' ')
      .map(
        (word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
      )
      .join(' ')
    : '';
}


export function attemptToFixNarrative(narrativeJson, model) {
  let { scenes = [], sounds = [] } = narrativeJson;
  let modified = false;

  // Group sounds by sceneIndex
  const soundsByScene = {};
  sounds.forEach((s, idx) => {
    const numericSceneIndex = Number(s.sceneIndex);
    if (!Number.isInteger(numericSceneIndex)) return;
    if (!soundsByScene[numericSceneIndex]) soundsByScene[numericSceneIndex] = [];
    soundsByScene[numericSceneIndex].push({ ...s, _idx: idx });
  });

  let filteredSounds = [...sounds];

  for (const [sceneIdxStr, soundList] of Object.entries(soundsByScene)) {
    const sceneIdx = parseInt(sceneIdxStr);

    const narration = soundList.filter((s) => s.type === "speech" && s.subType === "narration");
    const character = soundList.filter((s) => s.type === "speech" && s.subType === "character");
    const sfx = soundList.filter((s) => s.type === "sound_effect");

    // Remove extra narration lines (keep only the first)
    if (narration.length > 1) {
      const extras = narration.slice(1);
      for (const narr of extras) {
        filteredSounds = filteredSounds.filter((s, i) => i !== narr._idx);
        modified = true;
      }
    }

    // Remove extra character lines (keep only the first)
    if (character.length > 1) {
      const extras = character.slice(1);
      for (const ch of extras) {
        filteredSounds = filteredSounds.filter((s, i) => i !== ch._idx);
        modified = true;
      }
    }

    const speechExists = narration.length + character.length > 0;

    // Remove sound effects if any speech exists
    if (speechExists && sfx.length > 0) {
      for (const sfxLayer of sfx) {
        filteredSounds = filteredSounds.filter((s, i) => i !== sfxLayer._idx);
        modified = true;
      }
    }
  }

  if (!modified) return { fixed: false, narrativeJson: narrativeJson };

  const fixedNarrative = { scenes, sounds: filteredSounds };
  const recheck = validateTextToVideoNarrative(fixedNarrative, model, true); // prevent recursive fix attempt

  if (recheck.valid) {
    return { fixed: true, narrativeJson: fixedNarrative };
  } else {
    return { fixed: false, errors: recheck.errors };
  }
}


function assignSpeakersToScenesLegacy(movieResourceList, options = {}) {
  let { scenes, sounds } = movieResourceList;
  if (!scenes) scenes = [];
  if (!sounds) sounds = [];
  const openAIOnly = options.openAIOnly === true;

  // Keep track of which actor has been assigned which TTS voice.
  // Key = normalized actor name, Value = the chosen TTS speaker object (from OPENAI_SPEAKER_TYPES).
  const actorVoiceAssignments = {};

  // Keep track of used speaker IDs so we don't assign the same voice to multiple actors.
  const usedSpeakerIds = new Set();

  // Helper: pick a random speaker from OPENAI_TTS_SPEAKERS that matches a gender
  // and isn't already used.
  function pickRandomSpeakerByGender(gender) {
    const desiredGender = normalizeSoundGender(gender);

    const matchingSpeakers = OPENAI_TTS_SPEAKERS.filter(
      (sp) => sp.Gender?.toUpperCase() === desiredGender.toUpperCase()
    );

    // Filter out any speakers already used.
    const availableSpeakers = matchingSpeakers.filter(
      (sp) => !usedSpeakerIds.has(sp.value)
    );

    if (availableSpeakers.length === 0) {
      const extraMatching = openAIOnly
        ? []
        : ELEVENLABS_TTS_SPEAKERS.filter(
          (sp) => sp.Gender?.toUpperCase() === desiredGender
        );

      const extraAvailable = extraMatching.filter(
        (sp) => !usedSpeakerIds.has(sp.value)
      );

      if (extraAvailable.length > 0) {
        const fallback = extraAvailable[Math.floor(Math.random() * extraAvailable.length)];
        usedSpeakerIds.add(fallback.value);
        return fallback;
      }

      // If still nothing found, allow re-use from OPENAI (gender respected)
      const retryFromMatching = matchingSpeakers;
      if (retryFromMatching.length > 0) {
        const fallback = retryFromMatching[Math.floor(Math.random() * retryFromMatching.length)];
        return fallback;
      }

      // Total last resort: pick anything
      const anySpeakerPool = openAIOnly
        ? OPENAI_TTS_SPEAKERS
        : [...OPENAI_TTS_SPEAKERS, ...ELEVENLABS_TTS_SPEAKERS];
      const anyAvailable = anySpeakerPool.filter(
        (sp) => !usedSpeakerIds.has(sp.value)
      );
      if (anyAvailable.length === 0) return null;

      const finalFallback = anyAvailable[Math.floor(Math.random() * anyAvailable.length)];
      usedSpeakerIds.add(finalFallback.value);
      return finalFallback;
    }


    // Randomly pick one from the available gender-matching set.
    const chosen =
      availableSpeakers[Math.floor(Math.random() * availableSpeakers.length)];
    usedSpeakerIds.add(chosen.value);
    return chosen;
  }

  // Iterate over each sound and assign TTS if type === 'speech'.
  sounds.forEach((sound) => {
    if (sound.type === 'speech') {
      const { subType, actor = '', gender } = sound;
      let actorKey = actor.trim().toLowerCase();

      if (subType === 'narration') {
        // For narration, if actor is not specified, use a key like 'narration'.
        if (!actorKey) actorKey = 'narration';

        // Check if we've already assigned a speaker to this narrator.
        if (!actorVoiceAssignments[actorKey]) {
          const chosenSpeaker = pickRandomSpeakerByGender(gender || 'female');
          if (chosenSpeaker) {
            actorVoiceAssignments[actorKey] = chosenSpeaker;
          }
        }

        // Assign speaker/provider if found.
        if (actorVoiceAssignments[actorKey]) {
          sound.speaker = actorVoiceAssignments[actorKey].value;
          sound.provider = actorVoiceAssignments[actorKey].provider; // "OPENAI"
        }

        const sceneIndex = Number(sound.sceneIndex);
        const sceneSpeakerName = Number.isInteger(sceneIndex) && scenes[sceneIndex]?.speaker
          ? scenes[sceneIndex].speaker
          : null;

        // Prefer localized speaker name from the scene; fallback to generic only if absent.
        sound.speakerCharacterName = sceneSpeakerName || 'Narrator';
      }
      else if (subType === 'character') {
        // For a normal character, we rely on the "actor" field plus optional "gender".
        if (!actorVoiceAssignments[actorKey]) {
          const chosenSpeaker = pickRandomSpeakerByGender(gender || 'female');
          if (chosenSpeaker) {
            actorVoiceAssignments[actorKey] = chosenSpeaker;
          }
        }

        if (actorVoiceAssignments[actorKey]) {
          sound.speaker = actorVoiceAssignments[actorKey].value;
          sound.provider = actorVoiceAssignments[actorKey].provider; // "OPENAI"
        }

        // Title-case the actor's name for display.
        sound.speakerCharacterName = toTitleCase(actor);
      }

      // (If there are other subTypes, handle them similarly as needed.)
    }
  });

  // Put updated arrays back into the resource list and return.
  movieResourceList.scenes = scenes;
  movieResourceList.sounds = sounds;
  return movieResourceList;
}

function assignSpeakersToScenesFromPreferences(movieResourceList, speakerOptions = null) {
  let { scenes, sounds } = movieResourceList;
  if (!scenes) scenes = [];
  if (!sounds) sounds = [];

  const actorVoiceAssignments = {};
  const usedSpeakerIds = new Set();
  const speakerPools = getSpeakerPoolsForPreferences(speakerOptions);

  sounds.forEach((sound, index) => {
    if (sound.type !== 'speech') {
      return;
    }

    const { subType, actor = '', gender } = sound;
    let actorKey = actor.trim().toLowerCase();

    if (subType === 'narration') {
      if (!actorKey) actorKey = 'narration';
    } else if (!actorKey) {
      const sceneIndex = Number(sound.sceneIndex);
      actorKey = Number.isInteger(sceneIndex) ? `character:${sceneIndex}` : `character:${index}`;
    }

    if (!actorVoiceAssignments[actorKey]) {
      const chosenSpeaker = choosePreferredSpeaker(
        normalizeSoundGender(gender),
        speakerPools,
        usedSpeakerIds,
      );

      if (chosenSpeaker) {
        actorVoiceAssignments[actorKey] = chosenSpeaker;
      }
    }

    if (actorVoiceAssignments[actorKey]) {
      const assignedSpeaker = actorVoiceAssignments[actorKey];
      sound.speaker = assignedSpeaker.value;
      sound.provider = assignedSpeaker.provider;
      sound.speakerVoiceId = assignedSpeaker.voiceId || assignedSpeaker.value;
      sound.speakerLabel = assignedSpeaker.label || assignedSpeaker.name || assignedSpeaker.value;
      if (assignedSpeaker.languageCode) {
        sound.languageCode = assignedSpeaker.languageCode;
      }
      if (Array.isArray(assignedSpeaker.languageCodes)) {
        sound.languageCodes = assignedSpeaker.languageCodes;
      }
      if (assignedSpeaker.provider === TTS_PROVIDER_GOOGLE) {
        sound.speakerDetails = assignedSpeaker;
      }
    }

    if (subType === 'narration') {
      const sceneIndex = Number(sound.sceneIndex);
      const sceneSpeakerName = Number.isInteger(sceneIndex) && scenes[sceneIndex]?.speaker
        ? scenes[sceneIndex].speaker
        : null;

      sound.speakerCharacterName = sceneSpeakerName || 'Narrator';
      return;
    }

    if (subType === 'character') {
      sound.speakerCharacterName = toTitleCase(actor);
    }
  });

  movieResourceList.scenes = scenes;
  movieResourceList.sounds = sounds;
  return movieResourceList;
}

export function assignSpeakersToScenes(movieResourceList, options = {}) {
  const speakerOptions = filterDockerSpeakerOptions(options?.speakerOptions || null);
  const forceOpenAI = isOpenAITTSForcedLanguage(options.language) &&
    isDockerTTSProviderAvailable('OPENAI');
  const shouldUseLegacyDefault =
    !hasSpeakerPreferences(speakerOptions) &&
    !isDockerAudioAvailabilityFilteringEnabled();

  if (
    forceOpenAI ||
    shouldUseLegacyDefault ||
    isOpenAIOnlySelection(speakerOptions)
  ) {
    return assignSpeakersToScenesLegacy(movieResourceList, { openAIOnly: forceOpenAI });
  }

  return assignSpeakersToScenesFromPreferences(movieResourceList, speakerOptions);
}


export async function assignCharactersAndInstructionsToScenes(
  inputPrompt,
  movieResourceList,
  videoTone = 'cinematic',
  options = {},
) {
  const originalSounds = movieResourceList.sounds || [];
  const movieResourceListWithSpeakers = assignSpeakersToScenes(
    {
      ...movieResourceList,
      scenes: movieResourceList.scenes,
      sounds: originalSounds,
    },
    options,
  );
  const assignedSounds = Array.isArray(movieResourceListWithSpeakers.sounds)
    ? movieResourceListWithSpeakers.sounds
    : originalSounds;
  const hasOpenAISpeech = assignedSounds.some(isOpenAISpeechSound);

  if (!hasOpenAISpeech) {
    return {
      ...movieResourceListWithSpeakers,
      sounds: assignedSounds.map(removeInstructionMetadataForNonOpenAISpeech),
    };
  }

  let soundsWithInstructions = { sounds: assignedSounds.map(() => ({})) };

  try {
    const generatedInstructions = await createAudioEffectInstructionsForMovieTranscript(
      inputPrompt,
      movieResourceListWithSpeakers,
      videoTone,
      options.inferenceModel,
    );

    if (generatedInstructions?.sounds && Array.isArray(generatedInstructions.sounds)) {
      soundsWithInstructions = generatedInstructions;
    } else {
      console.error('Invalid sounds_with_emotions payload received from AudioCreatorAgent. Using fallback.');
    }
  } catch (error) {
    console.error('Failed to fetch sounds_with_emotions instructions. Using fallback.', error);
  }

  // Map over each sound and conditionally build the instructions
  const updatedSounds = assignedSounds.map((originalSound, idx) => {
    if (!isOpenAISpeechSound(originalSound)) {
      return removeInstructionMetadataForNonOpenAISpeech(originalSound);
    }

    const sound = soundsWithInstructions.sounds[idx] || {};
    const updatedSound = { ...originalSound };
    const instructionsParts = [];

    // Only add if present
    if (sound.Affect) {
      instructionsParts.push(`Personality/affect: ${sound.Affect}`);
      updatedSound.Affect = sound.Affect;

    }

    // Only add if present
    if (sound.Tone) {
      instructionsParts.push(`Tone: ${sound.Tone}`);
      updatedSound.Tone = sound.Tone;

    }

    // Only add if present
    if (sound.Emotion) {
      instructionsParts.push(`Emotion: ${sound.Emotion}`);
      updatedSound.Emotion = sound.Emotion;

    }

    // Only add if present
    if (sound.Pronunciation) {
      instructionsParts.push(`Pronunciation: ${sound.Pronunciation}`);
      updatedSound.Pronunciation = sound.Pronunciation;
    }

    // Only add if present
    if (sound.Pause) {
      instructionsParts.push(`Pause: ${sound.Pause}`);
      updatedSound.Pause = sound.Pause;
    }

    if (sound.AudioEffects) {
      instructionsParts.push(`Audio Effects: ${sound.AudioEffects}`);
      updatedSound.AudioEffects = sound.AudioEffects;
    }

    const instructions = instructionsParts.join('\\n\\n');

    return {
      ...updatedSound,
      instructions
    };
  });


  // Attach updated sounds
  const updatedMovieResourceList = {
    ...movieResourceListWithSpeakers,
    scenes: movieResourceListWithSpeakers.scenes,
    sounds: updatedSounds
  };


  // Finally return the updated object
  return updatedMovieResourceList;
}
