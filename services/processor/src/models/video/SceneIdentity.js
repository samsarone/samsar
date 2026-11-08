import { buildBranchedVideoSessionPlan } from '../movie_session/branching/BranchedVideoSessionPlan.js';

const clone = (value) => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
const text = (value) => typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
const promptText = (value) => text(value).replace(/\s*Create the image upright in aspect ratio\s+\d+\s*:\s*\d+\s*\.?\s*$/i, '').trim();
const id = (value) => value?.toString?.() || '';
const integer = (value) => {
  if (typeof value === 'string' && !/^\d+$/.test(value.trim())) return null;
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
};
const parse = (value) => {
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value); } catch { return null; }
};
const themeValue = (value) => {
  if (typeof value !== 'string') return value || {};
  try { return JSON.parse(value); } catch { return value; }
};

/** A source snapshot stays meaningful after layers are moved, copied or joined. */
export function buildSourceSceneFields({
  sourceSessionId, sceneIndex, scene, sounds = [], themeJson = {}, branchAssetKey,
} = {}) {
  const index = integer(sceneIndex);
  if (index === null || !scene || typeof scene !== 'object' || Array.isArray(scene)) return {};
  return {
    sourceSceneIndex: index,
    sourceSceneRef: {
      version: 1,
      sourceSessionId: id(sourceSessionId),
      sceneIndex: index,
      scene: clone(scene),
      sounds: clone((Array.isArray(sounds) ? sounds : []).filter((sound) => integer(sound?.sceneIndex) === index)),
      themeJson: clone(themeValue(themeJson)),
      ...(branchAssetKey ? { branchAssetKey } : {}),
    },
  };
}

export function isNonNarrativeLayer(layer = {}) {
  const type = text(layer.layerBaseAiImageType || layer.layerAiVideoType).toLowerCase();
  return type === 'none' || type === 'outro' || layer.sourceSceneKind === 'non_narrative';
}

export function getSourceSceneCatalog(session = {}) {
  const movie = parse(session.movieResourceList) || {};
  const narrative = parse(session.narrativeJson) || {};
  let source = movie;
  let branched = false;
  if (!Array.isArray(movie.scenes) && Array.isArray(movie.nodes)) {
    try {
      source = buildBranchedVideoSessionPlan(movie, {
        branchingMeta: session.branchingMeta,
        videoGenerationModel: session.expressGenerativeVideoModel,
        framesPerSecond: Number(session.framesPerSecond) || 24,
      }).canonicalMovieResourceList;
      branched = true;
    } catch {
      return { scenes: [], sounds: [], sceneVariants: [], branched: true };
    }
  }
  const movieScenes = Array.isArray(source.scenes) ? source.scenes : [];
  const rawScenes = !branched && Array.isArray(narrative.scenes) ? narrative.scenes : [];
  const alignedRaw = !movieScenes.some((scene) => scene?.timelineLayerId) &&
    rawScenes.length > 0 && (!movieScenes.length || movieScenes.length === rawScenes.length);
  const baseScenes = movieScenes.length ? movieScenes : rawScenes;
  const scenes = baseScenes.map((scene, index) => ({
    ...(scene || {}),
    ...(alignedRaw ? rawScenes[index] || {} : {}),
  }));
  const sceneVariants = baseScenes.map((scene, index) => [...new Set([
    scene?.visual, scene?.imagePrompt, scene?.image_prompt, scene?.visualPrompt, scene?.visual_prompt,
    ...(alignedRaw ? [rawScenes[index]?.visual] : []),
  ].map(promptText).filter(Boolean))]);
  const sounds = Array.isArray(source.sounds) && source.sounds.length
    ? source.sounds : Array.isArray(narrative.sounds) ? narrative.sounds : [];
  return { scenes, sounds, sceneVariants, branched };
}

function validReference(reference) {
  return reference?.version === 1 && integer(reference.sceneIndex) !== null &&
    reference.scene && typeof reference.scene === 'object' && !Array.isArray(reference.scene) &&
    (reference.sounds === undefined || Array.isArray(reference.sounds));
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
}

function isJoinedSession(session) {
  return Boolean(session.joinedSourceSessionIds?.length || session.joinedSourceVideoTitles ||
    session.joinedNarratorAvatarOverlays?.length || session.sessionSubType === 'join_videos' ||
    session.creditSource === 'join_videos' || session.metadata?.source === 'join_videos');
}

function promptMatches(layer, catalog) {
  const image = layer?.imageSession || {};
  const candidates = [
    layer.originalImageGenerationPrompt, image.originalImageGenerationPrompt,
    layer.originalImagePrompt, image.originalImagePrompt, layer.sourcePrompt, image.sourcePrompt,
    layer.originalPrompt, image.originalPrompt, image.prompt, layer.prompt,
  ].map(promptText).filter(Boolean);
  for (const prompt of candidates) {
    const matches = catalog.sceneVariants.flatMap((variants, index) => variants.includes(prompt) ? [index] : []);
    if (matches.length) return matches;
  }
  return [];
}

function hasStoredOriginalPrompt(layer = {}) {
  const image = layer.imageSession || {};
  return [layer.originalImageGenerationPrompt, image.originalImageGenerationPrompt,
    layer.originalImagePrompt, image.originalImagePrompt, layer.sourcePrompt, image.sourcePrompt,
    layer.originalPrompt, image.originalPrompt].some((value) => Boolean(text(value)));
}

/** Resolve without confusing the mutable timeline/audio position with narrative identity. */
export function resolveLayerSourceSceneReference(session = {}, layer = {}, layerIndex = -1, {
  allowPosition = true,
} = {}) {
  const catalog = getSourceSceneCatalog(session);
  const layers = Array.isArray(session.layers) ? session.layers : [];
  const base = { sceneCount: catalog.scenes.length, layerCount: layers.length };
  const missing = (reason) => ({ ...base, sourceSceneIndex: null, sourceSceneIndexSource: '', sourceSceneRef: null, reason });
  const resolved = (index, source, reference = null) => ({
    ...base,
    sourceSceneIndex: index,
    sourceSceneIndexSource: source,
    sourceSceneRef: reference ? clone(reference) : buildSourceSceneFields({
      sourceSessionId: session._id,
      sceneIndex: index,
      scene: catalog.scenes[index],
      sounds: catalog.sounds,
      themeJson: session.themeJson || session.parentJsonTheme || session.derivedJsonTheme || {},
      branchAssetKey: catalog.scenes[index]?.branchAssetKey,
    }).sourceSceneRef,
  });
  if (isNonNarrativeLayer(layer)) return missing('non_narrative_layer');
  const providedRefs = [layer.sourceSceneRef, layer.imageSession?.sourceSceneRef]
    .filter((reference) => reference !== null && reference !== undefined);
  if (providedRefs.some((reference) => !validReference(reference))) return missing('invalid_source_scene_reference');
  const refs = providedRefs.filter(validReference);
  if (refs.length) {
    if (refs.length > 1 && JSON.stringify(stableValue(refs[0])) !== JSON.stringify(stableValue(refs[1]))) return missing('conflicting_source_scene_references');
    return resolved(integer(refs[0].sceneIndex), 'sourceLayer.sourceSceneRef', refs[0]);
  }
  const linked = (Array.isArray(session.audioLayers) ? session.audioLayers : []).filter((audio) =>
    id(layer._id) && id(audio.connectedLayerId) === id(layer._id));
  const audioRefs = linked.map((audio) => audio.sourceSceneRef)
    .filter((reference) => reference !== null && reference !== undefined);
  if (audioRefs.some((reference) => !validReference(reference))) return missing('invalid_audio_scene_reference');
  if (audioRefs.length) {
    if (new Set(audioRefs.map((reference) => JSON.stringify(stableValue(reference)))).size > 1) {
      return missing('conflicting_audio_scene_references');
    }
    return resolved(integer(audioRefs[0].sceneIndex), 'connectedAudioLayer.sourceSceneRef', audioRefs[0]);
  }
  // A finalized current plan can be compacted or reordered. Its explicit layer binding
  // identifies the original scene without treating the new array position as provenance.
  const currentMatches = catalog.scenes.flatMap((scene, index) =>
    id(layer._id) && id(scene?.timelineLayerId) === id(layer._id) ? [index] : []);
  if (currentMatches.length > 1) return missing('conflicting_current_scene_bindings');
  if (currentMatches.length === 1) {
    const currentIndex = currentMatches[0];
    const scene = catalog.scenes[currentIndex];
    const originalIndex = integer(scene.sourceSceneIndex) ?? currentIndex;
    const reference = buildSourceSceneFields({ sourceSessionId: scene.sourceSessionId || session._id,
      sceneIndex: currentIndex, scene, sounds: catalog.sounds,
      themeJson: session.themeJson || session.parentJsonTheme || session.derivedJsonTheme || {},
    }).sourceSceneRef;
    reference.sceneIndex = originalIndex;
    reference.sounds.forEach((sound) => { sound.sceneIndex = originalIndex; });
    return resolved(originalIndex, 'movieResourceList.timelineLayerId', reference);
  }
  const joined = isJoinedSession(session);
  if (joined) return missing('joined_scene_provenance_missing');
  if (!catalog.scenes.length) return missing('narrative_scenes_missing');
  if (layer.branchAssetKey) {
    const matches = catalog.scenes.flatMap((scene, index) => scene.branchAssetKey === layer.branchAssetKey ? [index] : []);
    if (matches.length === 1) return resolved(matches[0], 'sourceLayer.branchAssetKey');
    return missing('branch_asset_unresolved');
  }
  const explicit = [
    ['sourceLayer.sourceSceneIndex', layer.sourceSceneIndex],
    ['sourceLayer.sceneIndex', layer.sceneIndex],
    ['sourceLayer.movieResourceIndex', layer.movieResourceIndex],
    ['sourceLayer.imageSession.sourceSceneIndex', layer.imageSession?.sourceSceneIndex],
    ['sourceLayer.imageSession.sceneIndex', layer.imageSession?.sceneIndex],
    ['sourceLayer.imageSession.movieResourceIndex', layer.imageSession?.movieResourceIndex],
  ].map(([source, value]) => ({ source, index: integer(value) })).filter((candidate) => candidate.index !== null && catalog.scenes[candidate.index]);
  if (new Set(explicit.map((candidate) => candidate.index)).size > 1) return missing('conflicting_source_scene_indexes');
  if (explicit.length) return resolved(explicit[0].index, explicit[0].source);

  const matches = promptMatches(layer, catalog);
  if (matches.length === 1) return resolved(matches[0], 'sourceLayer.originalPromptMatch');
  const audioIndexes = linked.flatMap((audio) => ['sourceSceneIndex', 'sceneIndex', 'movieResourceIndex']
    .map((key) => ({ index: integer(audio[key]), source: `connectedAudioLayer.${key}` })))
    .filter((candidate) => candidate.index !== null && catalog.scenes[candidate.index]);
  const distinctAudio = new Set(audioIndexes.map((candidate) => candidate.index));
  if (distinctAudio.size > 1) return missing('conflicting_audio_scene_indexes');
  if (audioIndexes.length) {
    if (matches.length && !matches.includes(audioIndexes[0].index)) return missing('audio_prompt_scene_conflict');
    return resolved(audioIndexes[0].index, audioIndexes[0].source);
  }
  // Repeated visuals do not establish which narrative occurrence a mutable
  // audio position belongs to, especially after a reorder.
  if (matches.length > 1) return missing('ambiguous_original_prompt');

  const contentLayers = layers.filter((candidate) => !isNonNarrativeLayer(candidate));
  const compatibleOrder = contentLayers.every((candidate, index) => {
    const known = promptMatches(candidate, catalog);
    return known.length ? known.includes(index) : !hasStoredOriginalPrompt(candidate);
  });
  const ordered = contentLayers.length === catalog.scenes.length && compatibleOrder;
  const connectedIndexes = linked.map((audio) => integer(audio.connectedLayerIndex))
    .filter((index) => index !== null && catalog.scenes[index]);
  const distinctConnected = new Set(connectedIndexes);
  if (distinctConnected.size > 1) return missing('conflicting_connected_audio_indexes');
  // Legacy audio indices were source-local at creation. Do not use them after
  // a known reorder, a join, or when a prompt identifies a different scene.
  if (!joined && !catalog.branched && connectedIndexes.length &&
      (!matches.length || matches.includes(connectedIndexes[0])) &&
      compatibleOrder && (!hasStoredOriginalPrompt(layer) || matches.length > 0) &&
      (ordered || contentLayers.length !== catalog.scenes.length)) {
    return resolved(connectedIndexes[0], 'connectedAudioLayer.connectedLayerIndex');
  }
  const contentIndex = contentLayers.indexOf(layer);
  const index = contentIndex >= 0 ? contentIndex : layerIndex;
  if (allowPosition && ordered && !joined && !catalog.branched && catalog.scenes[index]) {
    return resolved(index, layers.length === catalog.scenes.length
      ? 'layerIndexEqualSceneIndexFallback' : 'contentLayerIndexFallback');
  }
  return missing('scene_mapping_ambiguous');
}

/** Capture legacy mappings before a transform changes layer/audio positions. */
export function captureSessionSceneReferences(session = {}, options = {}) {
  const layers = Array.isArray(session.layers) ? session.layers : [];
  const results = layers.map((layer, index) => resolveLayerSourceSceneReference(session, layer, index, options));
  results.forEach((result, index) => {
    if (!result.sourceSceneRef) return;
    const layer = layers[index];
    const fields = { sourceSceneIndex: result.sourceSceneIndex, sourceSceneRef: clone(result.sourceSceneRef) };
    assignSourceSceneFields(layer, fields);
    if (layer.imageSession && typeof layer.imageSession === 'object') assignSourceSceneFields(layer.imageSession, fields);
    for (const audio of Array.isArray(session.audioLayers) ? session.audioLayers : []) {
      if (id(layer._id) && id(audio.connectedLayerId) === id(layer._id)) assignSourceSceneFields(audio, fields);
    }
  });
  return session;
}

export function assignSourceSceneFields(target, fields) {
  if (!target || typeof target !== 'object') return target;
  for (const [key, value] of Object.entries(fields)) {
    const copied = clone(value);
    if (typeof target.set === 'function') target.set(key, copied, { strict: false });
    // Mongoose does not define property accessors for an unknown path added
    // after hydration. Keep immediate in-memory readers and its stored _doc in sync.
    target[key] = typeof target.get === 'function' ? target.get(key) : copied;
  }
  return target;
}
