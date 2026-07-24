import { sendAssistantMessageRequest } from './OpenAI.js';

const MIN_PROMPT_LINES = 5;
const MAX_PROMPT_LINES = 8;

function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeId(value) {
  if (value === null || value === undefined) {
    return '';
  }
  return normalizeString(value?.toString?.());
}

function firstNonEmptyString(...values) {
  return values.map(normalizeString).find(Boolean) || '';
}

function findConnectedSpeechAudioLayer(audioLayers = [], layer = {}, layerIndex = -1) {
  const speechLayers = Array.isArray(audioLayers)
    ? audioLayers.filter((audioLayer) => normalizeString(audioLayer?.generationType).toLowerCase() === 'speech')
    : [];
  const layerId = normalizeId(layer?._id);

  if (layerId) {
    const connectedById = speechLayers.find((audioLayer) => (
      normalizeId(audioLayer?.connectedLayerId) === layerId
    ));
    if (connectedById) {
      return connectedById;
    }
  }

  if (!Number.isInteger(layerIndex) || layerIndex < 0) {
    return null;
  }

  return speechLayers.find((audioLayer) => (
    Number(audioLayer?.connectedLayerIndex) === layerIndex
  )) || null;
}

function getStartingFrameDescription(layer = {}, payload = {}) {
  return firstNonEmptyString(
    payload.startImageDescription,
    layer?.activeImageCandidate?.description,
    layer?.imageSession?.activeImageDescription,
    layer?.activeImageDescription,
  );
}

export function resolveExpressLipSyncPromptContext(sessionData = {}, payload = {}) {
  const layers = Array.isArray(sessionData?.layers) ? sessionData.layers : [];
  const requestedLayerId = normalizeId(payload?.layerId);
  const layerIndex = layers.findIndex((layer) => normalizeId(layer?._id) === requestedLayerId);
  const layer = layerIndex >= 0 ? layers[layerIndex] : null;
  if (!layer) {
    return null;
  }

  const audioLayer = findConnectedSpeechAudioLayer(
    sessionData?.audioLayers,
    layer,
    layerIndex,
  );

  const speakerName = firstNonEmptyString(
    audioLayer?.speakerCharacterName,
    audioLayer?.translated_speaker_character_name,
    audioLayer?.subtitle_speaker_character_name,
    audioLayer?.speaker,
  );
  const speakerDescription = firstNonEmptyString(
    audioLayer?.speakerDescription,
    audioLayer?.characterDescription,
    audioLayer?.generationMeta?.speakerDescription,
    audioLayer?.generationMeta?.characterDescription,
  );

  return {
    layerId: requestedLayerId,
    audioLayerId: normalizeId(audioLayer?._id),
    startingFrameDescription: getStartingFrameDescription(layer, payload),
    sceneDescription: firstNonEmptyString(
      layer?.prompt,
      payload?.sceneDescription,
      payload?.promptSeedContext?.sceneAction,
    ),
    speechText: firstNonEmptyString(
      payload?.audioPrompt,
      audioLayer?.prompt,
      audioLayer?.previousAudioData?.prompt,
    ),
    speakerName,
    speakerDescription,
  };
}

function singleLine(value, fallback = '') {
  const normalized = normalizeString(value).replace(/\s+/g, ' ');
  return normalized || fallback;
}

export function buildFallbackExpressLipSyncPrompt({
  startingFrameDescription,
  sceneDescription,
  speechItem = {},
} = {}) {
  const speakerName = singleLine(
    speechItem.characterName,
    'the speaker named in the connected speech item',
  );

  return [
    `${speakerName} is the character delivering the supplied speech and is the lip-sync target.`,
    `Locate ${speakerName} from this starting-frame description: ${singleLine(startingFrameDescription)}`,
    `Distinguish the speaker by the described position, appearance, clothing, pose, and nearby visual anchors.`,
    `The speech associated with ${speakerName} is: ${singleLine(speechItem.text)}`,
    `Keep the character consistent with this scene: ${singleLine(sceneDescription)}`,
    `Treat the starting position as an identity anchor and track ${speakerName} through camera movement, cuts, reframing, or position changes.`,
    `Pin all speech-driven mouth movement to ${speakerName}; never switch, share, or distribute it across other characters.`,
  ].join('\n');
}

export function normalizeGeneratedExpressLipSyncPrompt(value) {
  const lines = normalizeString(value)
    .split('\n')
    .map((line) => line.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').trim())
    .filter(Boolean);

  if (lines.length < MIN_PROMPT_LINES || lines.length > MAX_PROMPT_LINES) {
    return '';
  }

  return lines.join('\n');
}

export function buildExpressLipSyncPromptMessages({
  startingFrameDescription,
  sceneDescription,
  speechItem = {},
} = {}) {
  const inputPayload = {
    starting_frame_image_description: singleLine(startingFrameDescription),
    scene_description: singleLine(sceneDescription),
    speech_item: {
      character_name: singleLine(speechItem.characterName),
      text: singleLine(speechItem.text),
      ...(singleLine(speechItem.characterDescription)
        ? { character_description: singleLine(speechItem.characterDescription) }
        : {}),
    },
  };

  return [
    {
      role: 'developer',
      content: `You create precise subject descriptions for multi-character lip-sync video generation. From the starting-frame description and the named speech item in the input payload, identify the speaker and describe that same character's location in the frame, visible appearance, clothing, pose, and nearby visual anchors. Make the description specific enough for the video model to select the named speaker instead of the most prominent or foreground character. Treat the starting position as an identity anchor, then track that same character through camera movement, cuts, reframing, or position changes. State naturally that this character delivers the supplied speech and is the sole lip-sync target throughout the video; pin all speech-driven mouth movement to that character and never switch, share, or distribute it across other characters while preserving them and the existing scene. Return only the finished prompt in 5-8 concise lines.`,
    },
    {
      role: 'user',
      content: JSON.stringify(inputPayload, null, 2),
    },
  ];
}

export async function createExpressLipSyncPrompt({
  startingFrameDescription,
  sceneDescription,
  speechItem,
  userInferenceModel,
  auditContext = {},
} = {}) {
  const promptArguments = {
    startingFrameDescription,
    sceneDescription,
    speechItem,
  };
  const fallbackPrompt = buildFallbackExpressLipSyncPrompt(promptArguments);

  try {
    const response = await sendAssistantMessageRequest(
      buildExpressLipSyncPromptMessages(promptArguments),
      userInferenceModel,
      {
        ...auditContext,
        requestType: auditContext.requestType || 'lip_sync_prompt_inference',
        sourceTask: auditContext.sourceTask || 'lip_sync_prompt',
      },
    );
    const generatedPrompt = normalizeGeneratedExpressLipSyncPrompt(response?.content);
    if (generatedPrompt) {
      return { prompt: generatedPrompt, source: 'inference' };
    }
  } catch (error) {
    console.warn('[lip_sync][prompt_generation] using deterministic prompt fallback', {
      sessionId: auditContext.sessionId || null,
      layerId: auditContext.layerId || null,
      error: error?.message || String(error),
    });
  }

  return { prompt: fallbackPrompt, source: 'deterministic_fallback' };
}
