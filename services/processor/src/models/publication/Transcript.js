const normalizeString = (value) =>
  typeof value === 'string' ? value.trim() : '';

const firstString = (record, keys) => {
  if (!record || typeof record !== 'object') {
    return '';
  }

  for (const key of keys) {
    const value = normalizeString(record[key]);
    if (value) {
      return value;
    }
  }

  return '';
};

const parseResourceList = (value) => {
  if (typeof value === 'string') {
    try {
      return parseResourceList(JSON.parse(value));
    } catch {
      return {};
    }
  }

  if (Array.isArray(value)) {
    const structuredItem = value.find(
      (item) => item && typeof item === 'object' &&
        (Array.isArray(item.scenes) || Array.isArray(item.sounds))
    );
    return structuredItem || { scenes: value, sounds: [] };
  }

  return value && typeof value === 'object' ? value : {};
};

const normalizeSceneIndex = (value, fallback = null) => {
  const parsed = typeof value === 'number' ? value : Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
};

export function normalizePublicationTranscript(movieResourceList) {
  const resourceList = parseResourceList(movieResourceList);
  const rawScenes = Array.isArray(resourceList.scenes) ? resourceList.scenes : [];

  const scenes = rawScenes
    .map((scene, index) => {
      if (!scene || typeof scene !== 'object') {
        return null;
      }

      const normalized = {
        scene_index: normalizeSceneIndex(scene.sceneIndex ?? scene.scene_index, index),
        type: firstString(scene, ['type', 'subType', 'sub_type']),
        visual: firstString(scene, ['visual', 'description', 'prompt']),
        speaker: firstString(scene, ['speaker', 'actor', 'speakerCharacterName']),
      };

      return normalized.type || normalized.visual || normalized.speaker ? normalized : null;
    })
    .filter(Boolean);

  const sceneSpeakers = new Map(
    scenes.map((scene) => [scene.scene_index, scene.speaker]).filter(([, speaker]) => speaker)
  );
  const rawSounds = Array.isArray(resourceList.sounds) ? resourceList.sounds : [];
  const sounds = rawSounds
    .filter((sound) =>
      sound && typeof sound === 'object' && firstString(sound, ['type']).toLowerCase() === 'speech'
    )
    .map((sound) => {
      const sceneIndex = normalizeSceneIndex(
        sound.sceneIndex ?? sound.scene_index ?? sound.connectedLayerIndex,
        null
      );
      const speaker = firstString(sound, [
        'actor',
        'speaker',
        'speakerCharacterName',
      ]) || sceneSpeakers.get(sceneIndex) || '';

      return {
        type: 'speech',
        sub_type: firstString(sound, ['subType', 'sub_type']),
        scene_index: sceneIndex,
        speaker,
        text: firstString(sound, ['audio', 'text', 'prompt', 'transcript']),
      };
    })
    .filter((sound) => sound.text);

  return { scenes, sounds };
}

export function resolvePublicationOriginalPrompt(payload = {}, sessionData = {}) {
  const promptList = Array.isArray(sessionData?.promptList)
    ? sessionData.promptList.map(normalizeString).filter(Boolean).join('\n')
    : '';
  const legacyPromptList = Array.isArray(sessionData?.promptlist)
    ? sessionData.promptlist.map(normalizeString).filter(Boolean).join('\n')
    : '';

  return [
    payload?.originalPrompt,
    payload?.original_prompt,
    payload?.prompt,
    sessionData?.inputPrompt,
    sessionData?.expressInputPrompt,
    promptList,
    legacyPromptList,
  ].map(normalizeString).find(Boolean) || '';
}

export function buildPublicationMetadataInput(movieResourceList, originalPrompt = '') {
  const transcript = normalizePublicationTranscript(movieResourceList);
  const normalizedOriginalPrompt = normalizeString(originalPrompt);

  return normalizedOriginalPrompt
    ? { original_prompt: normalizedOriginalPrompt, ...transcript }
    : transcript;
}
