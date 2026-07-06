export function stripSoundEffectsFromMovieResourceList(movieResourceList) {
  if (!movieResourceList || typeof movieResourceList !== 'object') {
    return movieResourceList;
  }

  const scenes = Array.isArray(movieResourceList.scenes) ? movieResourceList.scenes : [];
  const sounds = Array.isArray(movieResourceList.sounds) ? movieResourceList.sounds : [];

  const sanitizedScenes = scenes.map((scene) => {
    if (!scene || typeof scene !== 'object') {
      return scene;
    }

    const sceneType = typeof scene.type === 'string' ? scene.type.trim().toLowerCase() : '';
    if (sceneType !== 'sound_effect') {
      return scene;
    }

    return {
      ...scene,
      type: 'base',
      speaker: '',
    };
  });

  const sanitizedSounds = sounds.filter((sound) => {
    const soundType = typeof sound?.type === 'string' ? sound.type.trim().toLowerCase() : '';
    return soundType !== 'sound_effect';
  });

  return {
    ...movieResourceList,
    scenes: sanitizedScenes,
    sounds: sanitizedSounds,
  };
}
