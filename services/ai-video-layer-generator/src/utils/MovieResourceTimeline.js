// Keep this dependency-free module identical in the processor and both video workers.
// A sourceSceneRef is immutable provenance; movieResourceList describes the current edit.
const copy = (value) => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
const id = (value) => value?.toString?.() || '';
const index = (value) => (typeof value === 'number' || typeof value === 'string' && /^\d+$/.test(value.trim())) &&
  Number.isSafeInteger(Number(value)) && Number(value) >= 0 ? Number(value) : null;
const finite = (value) => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));
const positive = (value) => finite(value) && Number(value) > 0;
const text = (value) => typeof value === 'string' ? value.trim().replace(/\s+/g, ' ')
  .replace(/\s*Create the image upright in aspect ratio\s+\d+\s*:\s*\d+\s*\.?\s*$/i, '').trim() : '';

export function isNonNarrativeTimelineLayer(layer = {}) {
  const kind = text(layer.layerBaseAiImageType || layer.layerAiVideoType).toLowerCase();
  return kind === 'none' || kind === 'outro' || layer.sourceSceneKind === 'non_narrative';
}

function planFor(session) {
  const movie = session?.movieResourceList;
  // Branch layers form an asset catalog; projecting them as a single path destroys the tree.
  if (!movie || typeof movie !== 'object' || Array.isArray(movie) || Array.isArray(movie.nodes) ||
      session?.isBranchedVideo || text(session?.sessionType).toLowerCase() === 'branched' ||
      text(session?.narrativeType).toLowerCase() === 'branched' ||
      text(session?.sourceNarrativeType).toLowerCase() === 'branched' || session?.branchingTimeline?.schema ||
      session?.branchRenderPaths?.length || !Array.isArray(movie.scenes)) return null;
  return movie;
}

function referenceFor(layer) {
  return [layer?.sourceSceneRef, layer?.imageSession?.sourceSceneRef].find((ref) =>
    ref && typeof ref === 'object' && ref.scene && index(ref.sceneIndex) !== null);
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
}

function hasInvalidReferences(layer) {
  const references = [layer?.sourceSceneRef, layer?.imageSession?.sourceSceneRef]
    .filter((ref) => ref !== null && ref !== undefined);
  return references.some((ref) => ref?.version !== 1 || index(ref.sceneIndex) === null ||
    !ref.scene || typeof ref.scene !== 'object' || Array.isArray(ref.scene) ||
    ref.sounds !== undefined && !Array.isArray(ref.sounds)) ||
    new Set(references.map((ref) => JSON.stringify(stableValue(ref)))).size > 1;
}

function promptsFor(layer) {
  const image = layer?.imageSession || {};
  return [layer.originalImageGenerationPrompt, image.originalImageGenerationPrompt,
    layer.originalImagePrompt, image.originalImagePrompt, layer.sourcePrompt, image.sourcePrompt,
    layer.originalPrompt, image.originalPrompt, image.prompt, layer.prompt].map(text).filter(Boolean);
}

function scenePrompts(scene) {
  return [scene?.visual, scene?.imagePrompt, scene?.image_prompt, scene?.visualPrompt, scene?.visual_prompt]
    .map(text).filter(Boolean);
}

/** Resolve a current scene by its binding or complete provenance, never a compressed source index. */
export function resolveMovieResourceScene(session = {}, layer = {}, layerIndex = -1) {
  const movie = planFor(session);
  if (!movie || isNonNarrativeTimelineLayer(layer)) return null;
  if (hasInvalidReferences(layer)) return { ambiguous: true };
  const scenes = movie.scenes;
  const ref = referenceFor(layer);
  const result = (sceneIndex) => ({ scene: scenes[sceneIndex], sceneIndex,
    sounds: (Array.isArray(movie.sounds) ? movie.sounds : []).filter((sound) => index(sound?.sceneIndex) === sceneIndex) });
  const bound = scenes.flatMap((scene, i) => id(layer._id) && id(scene?.timelineLayerId) === id(layer._id) ? [i] : []);
  if (bound.length === 1) return result(bound[0]);
  if (bound.length > 1) return { ambiguous: true };
  if (ref) {
    const matches = scenes.flatMap((scene, i) => id(scene?.sourceSessionId) === id(ref.sourceSessionId) &&
      index(scene?.sourceSceneIndex) === index(ref.sceneIndex) ? [i] : []);
    // Copies may share provenance but have distinct bindings. Prefer the immutable snapshot
    // if more than one occurrence exists, rather than another copy's mutable scene metadata.
    if (matches.length === 1) return result(matches[0]);
    const sourceIndex = index(ref.sceneIndex);
    if (!scenes.some((scene) => scene?.timelineLayerId) && id(session._id) &&
        id(session._id) === id(ref.sourceSessionId) && scenes[sourceIndex]) return result(sourceIndex);
    return { scene: ref.scene, sceneIndex: null, sounds: Array.isArray(ref.sounds) ? ref.sounds : [], reference: ref };
  }
  // Once projected, source indexes are deliberately different from current array positions.
  const projected = scenes.some((scene) => scene?.timelineLayerId);
  if (!projected && !(session.joinedSourceSessionIds?.length || session.sessionSubType === 'join_videos' ||
      session.creditSource === 'join_videos' || session.metadata?.source === 'join_videos')) {
    const candidates = [layer.sourceSceneIndex, layer.imageSession?.sourceSceneIndex, layer.sceneIndex,
      layer.movieResourceIndex].map(index).filter((i) => i !== null && scenes[i]);
    if (new Set(candidates).size > 1) return { ambiguous: true };
    if (candidates.length) return result(candidates[0]);
  }
  const prompts = promptsFor(layer);
  const matches = scenes.flatMap((scene, i) => scenePrompts(scene).some((prompt) => prompts.includes(prompt)) ? [i] : []);
  if (matches.length === 1) return result(matches[0]);
  if (matches.length > 1) return { ambiguous: true };
  const content = (Array.isArray(session.layers) ? session.layers : []).filter((item) => !isNonNarrativeTimelineLayer(item));
  const compatible = content.length === scenes.length && content.every((item, i) => {
    const known = promptsFor(item);
    return !known.length || scenePrompts(scenes[i]).some((prompt) => known.includes(prompt));
  });
  if (!projected && compatible) {
    const i = content.indexOf(layer);
    return result(i >= 0 ? i : layerIndex);
  }
  // An unmatched existing legacy catalog is not evidence of a newly inserted scene.
  // New inserts are distinguishable after capture has bound the pre-edit catalog.
  return !projected && scenes.length ? { ambiguous: true } : null;
}

function assignPlan(session, movie) {
  if (JSON.stringify(session.movieResourceList) === JSON.stringify(movie)) return { changed: false, reason: 'already_synchronized' };
  if (typeof session.set === 'function') session.set('movieResourceList', movie, { strict: false });
  session.movieResourceList = typeof session.get === 'function' ? session.get('movieResourceList') : movie;
  session.markModified?.('movieResourceList');
  return { changed: true, reason: 'synchronized' };
}

function identityFields(session, layer, resolved) {
  const ref = referenceFor(layer);
  const originalIndex = index(ref?.sceneIndex ?? resolved?.scene?.sourceSceneIndex ?? layer.sourceSceneIndex ?? resolved?.sceneIndex);
  return {
    timelineLayerId: id(layer._id),
    ...(originalIndex !== null ? { sourceSceneIndex: originalIndex } : {}),
    ...(id(ref?.sourceSessionId || resolved?.scene?.sourceSessionId || session._id)
      ? { sourceSessionId: id(ref?.sourceSessionId || resolved?.scene?.sourceSessionId || session._id) } : {}),
  };
}

/** Bind legacy scenes before deletion/reordering changes the available positional evidence. */
export function captureMovieResourceTimeline(session = {}) {
  const movie = planFor(session);
  if (!movie) return { changed: false, reason: 'unsupported_plan' };
  const next = copy(movie);
  const claimed = new Set();
  const resolutions = (session.layers || []).map((layer, i) => resolveMovieResourceScene(session, layer, i));
  if (resolutions.some((resolved, i) => !isNonNarrativeTimelineLayer(session.layers[i]) && resolved?.ambiguous)) {
    return { changed: false, reason: 'ambiguous_scene_mapping' };
  }
  (session.layers || []).forEach((layer, i) => {
    const resolved = resolutions[i];
    if (!resolved || resolved.ambiguous || resolved.sceneIndex === null || claimed.has(resolved.sceneIndex)) return;
    // Never steal a different copy's binding merely because it shares source provenance.
    if (next.scenes[resolved.sceneIndex]?.timelineLayerId &&
        id(next.scenes[resolved.sceneIndex].timelineLayerId) !== id(layer._id)) return;
    claimed.add(resolved.sceneIndex);
    Object.assign(next.scenes[resolved.sceneIndex], identityFields(session, layer, resolved));
    const templates = (next.sounds || []).filter((sound) => index(sound?.sceneIndex) === resolved.sceneIndex);
    const used = new Set();
    for (const audio of connectedSounds(session, layer, i)) {
      const templateIndex = matchSoundTemplate(templates, audio, used);
      if (templateIndex >= 0) {
        used.add(templateIndex);
        if (id(audio._id)) templates[templateIndex].timelineAudioId = id(audio._id);
      }
    }
  });
  return assignPlan(session, next);
}

function soundType(sound) {
  return sound?.type === 'sound_effect' || sound?.generationType === 'sound_effect' ? 'sound_effect' : 'speech';
}

function connectedSounds(session, layer, layerIndex) {
  return (session.audioLayers || []).filter((audio) => {
    if (!['speech', 'sound_effect'].includes(audio.generationType)) return false;
    return id(audio.connectedLayerId) ? id(audio.connectedLayerId) === id(layer._id)
      : index(audio.connectedLayerIndex) === layerIndex;
  });
}

function actorFor(sound) {
  return text(sound?.speakerCharacterName || sound?.actor || sound?.speakerLabel ||
    (typeof sound?.speaker === 'string' ? sound.speaker : '')).toLowerCase();
}

function matchSoundTemplate(templates, audio, used) {
  const bound = templates.findIndex((sound, i) => !used.has(i) && id(audio._id) && id(sound.timelineAudioId) === id(audio._id));
  if (bound >= 0) return bound;
  const actor = actorFor(audio);
  const candidates = templates.flatMap((sound, i) => !used.has(i) && soundType(sound) === soundType(audio) &&
    (!actor || !actorFor(sound) || actorFor(sound) === actor) ? [i] : []);
  const audioText = text(audio.speechText || audio.prompt || audio.transcriptText);
  const matchingText = candidates.filter((i) => audioText && text(templates[i].audio) === audioText);
  if (matchingText.length === 1) return matchingText[0];
  const matchingActor = candidates.filter((i) => actor && actorFor(templates[i]) === actor);
  if (matchingActor.length === 1) return matchingActor[0];
  if (candidates.length === 1) return candidates[0];
  // Identical dialogue from different speakers is not an ordinal match.
  const sameActor = new Set(candidates.map((i) => actorFor(templates[i]))).size <= 1;
  return sameActor ? (matchingText[0] ?? candidates[0] ?? -1) : -1;
}

export function resolveMovieResourceSound(templates = [], audio = {}, used = new Set()) {
  const templateIndex = matchSoundTemplate(templates, audio, used);
  return templateIndex >= 0 ? { sound: templates[templateIndex], index: templateIndex } : null;
}

function projectSounds(session, layer, layerIndex, sceneIndex, templates, sourceScene = {}) {
  const audios = connectedSounds(session, layer, layerIndex);
  const used = new Set();
  const sounds = audios.map((audio) => {
    const kind = soundType(audio);
    const audioText = text(audio.speechText || audio.prompt || audio.transcriptText);
    const templateIndex = matchSoundTemplate(templates, audio, used);
    if (templateIndex >= 0) used.add(templateIndex);
    const sound = copy(templates[templateIndex] || {});
    const offset = finite(audio.startTime) && finite(layer.durationOffset)
      ? Math.max(0, Number(audio.startTime) - Number(layer.durationOffset))
      : Math.max(0, Number(audio.connectedLayerStartTimeOffset) || 0);
    const available = Math.max(0, Number(layer.duration) - offset);
    const duration = Math.min(available, positive(audio.duration) ? Number(audio.duration)
      : positive(sound.duration) ? Number(sound.duration) : available);
    const startTime = (Number(layer.durationOffset) || 0) + offset;
    const voiceFields = Object.fromEntries(['speakerCharacterName', 'speaker', 'speakerVoiceId', 'provider',
      'speakerLabel', 'speakerDetails', 'languageCode', 'languageCodes'].filter((key) => audio[key] !== undefined)
      .map((key) => [key, copy(audio[key])]));
    return { ...sound, ...voiceFields, type: sound.type || kind, sceneIndex,
      ...(audio.speakerCharacterName ? { actor: audio.speakerCharacterName } : {}),
      ...(id(audio._id) ? { timelineAudioId: id(audio._id) } : {}),
      ...(audioText ? { audio: audio.speechText || audio.prompt || audio.transcriptText } : {}),
      duration, startTime, endTime: startTime + duration };
  });
  // Some model stages create audio rows later. Keep their scene-local planned sounds
  // until the corresponding generated track exists, without resurrecting removed scenes.
  templates.forEach((template, i) => {
    if (used.has(i) || audios.some((audio) => soundType(audio) === soundType(template))) return;
    const sound = copy(template);
    const offset = finite(sound.startTime) && finite(sourceScene.startTime)
      ? Math.max(0, Number(sound.startTime) - Number(sourceScene.startTime)) : 0;
    const available = Math.max(0, Number(layer.duration) - offset);
    const duration = Math.min(available, positive(sound.duration) ? Number(sound.duration) : available);
    const startTime = (Number(layer.durationOffset) || 0) + offset;
    sounds.push({ ...sound, sceneIndex, duration, startTime, endTime: startTime + duration });
  });
  return sounds;
}

/** Project the finalized current edit, preserving provenance, scene metadata and branch topology. */
export function synchronizeMovieResourceTimeline(session = {}) {
  const movie = planFor(session);
  if (!movie) return { changed: false, reason: 'unsupported_plan' };
  const scenes = [];
  const sounds = [];
  for (const [layerIndex, layer] of (session.layers || []).entries()) {
    if (isNonNarrativeTimelineLayer(layer)) continue;
    if (!positive(layer.duration)) return { changed: false, reason: 'invalid_layer_duration' };
    const resolved = resolveMovieResourceScene(session, layer, layerIndex);
    if (resolved?.ambiguous) return { changed: false, reason: 'ambiguous_scene_mapping' };
    const duration = Number(layer.duration);
    const startTime = Number(layer.durationOffset) || 0;
    const scene = { ...copy(resolved?.scene || {
      visual: promptsFor(layer)[0] || '', type: layer.layerBaseAiImageType || layer.layerAiVideoType || 'image',
    }), ...identityFields(session, layer, resolved), duration, startTime, endTime: startTime + duration };
    sounds.push(...projectSounds(session, layer, layerIndex, scenes.length, resolved?.sounds || [], resolved?.scene));
    scenes.push(scene);
  }
  // Preserve unbound background music/metadata; scene-indexed sounds follow retained scenes.
  const unbound = (movie.sounds || []).filter((sound) => index(sound?.sceneIndex) === null);
  const next = { ...copy(movie), scenes, ...(Array.isArray(movie.sounds) || sounds.length ? { sounds: [...copy(unbound), ...sounds] } : {}) };
  if ('totalDuration' in movie) next.totalDuration = (session.layers || []).reduce((end, layer) =>
    Math.max(end, (Number(layer.durationOffset) || 0) + (Number(layer.duration) || 0)), 0);
  if ('duration' in movie) next.duration = scenes.reduce((sum, scene) => sum + scene.duration, 0);
  return assignPlan(session, next);
}
