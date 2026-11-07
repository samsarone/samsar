import { getSpeechCharacterBudget } from './utils/ModelUtils.js';
import { rewriteNarrativeSpeechItemToFitScene } from '../agent/MovieCreatorAgent.js';

const id = (value) => value?.toString?.() || '';
const number = (value) => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value))
  ? Number(value) : null;
const isSpeech = (audio) => String(audio?.generationType || '').trim().toLowerCase() === 'speech';
const count = (text) => Array.from(text.trim()).length;

function validationError(message, details = {}, cause) {
  return Object.assign(new Error(message, cause ? { cause } : undefined), {
    code: 'TRANSLATED_SPEECH_VALIDATION_FAILED', status: 502, ...details,
  });
}

/** Use the final translation timeline, not measured source TTS duration or model buckets. */
export function getTranslatedSpeechSlots(session) {
  const layers = session.layers || [];
  const slots = (session.audioLayers || []).filter(isSpeech).map((audioLayer, speechIndex) => {
    const connectedId = id(audioLayer.connectedLayerId);
    const layerIndex = connectedId
      ? layers.findIndex((layer) => id(layer._id) === connectedId)
      : number(audioLayer.connectedLayerIndex);
    const layer = Number.isSafeInteger(layerIndex) ? layers[layerIndex] : null;
    if (!layer) {
      throw validationError(`Cannot resolve the containing layer for translated speech ${speechIndex}.`, { speechIndex });
    }
    const layerDuration = number(layer.duration);
    const layerStart = number(layer.durationOffset) ?? 0;
    const audioStart = number(audioLayer.startTime);
    const offset = audioStart === null ? (number(audioLayer.connectedLayerStartTimeOffset) ?? 0) : audioStart - layerStart;
    if (!(layerDuration > 0) || offset < 0 || offset >= layerDuration) {
      throw validationError(`No available speaking time for translated speech ${speechIndex}.`, { speechIndex, layerIndex });
    }
    return { audioLayer, speechIndex, layer, layerIndex, offset, layerDuration };
  });
  return slots.map((slot) => {
    const followingStarts = slots.filter((other) => other.layerIndex === slot.layerIndex && other.offset > slot.offset)
      .map((other) => other.offset);
    const endOffset = Math.min(slot.layerDuration, ...followingStarts);
    const plannedDuration = number(slot.audioLayer.duration);
    const durationSeconds = Math.min(endOffset - slot.offset, plannedDuration > 0 ? plannedDuration : Infinity);
    return { ...slot, durationSeconds };
  });
}

export async function validateTranslatedSpeech({
  session, originalTexts, translatedTexts, targetLanguage, inferenceModel, inferenceEffort, sessionId,
}, { rewriteSpeechItem = rewriteNarrativeSpeechItemToFitScene } = {}) {
  const slots = getTranslatedSpeechSlots(session);
  if (slots.length !== originalTexts.length || slots.length !== translatedTexts.length) {
    throw validationError('Translated speech count does not match the source speech layers.');
  }
  const texts = [];
  const validation = [];
  for (const slot of slots) {
    const { audioLayer, speechIndex, layer, layerIndex, durationSeconds } = slot;
    const originalText = typeof originalTexts[speechIndex] === 'string' ? originalTexts[speechIndex].trim() : '';
    const translatedText = typeof translatedTexts[speechIndex] === 'string' ? translatedTexts[speechIndex].trim() : '';
    if (!originalText || !translatedText) {
      throw validationError(`Translated speech ${speechIndex} must contain non-empty speech.`, { speechIndex, layerIndex });
    }
    const budget = getSpeechCharacterBudget(durationSeconds, targetLanguage);
    const maxCharacters = budget.validationMaxCharacters;
    let text = translatedText;
    let attempts = 0;
    if (count(text) > maxCharacters) {
      // A compact context keeps the source speech immutable across retries and
      // works for edited sessions without an exact sound-array index mapping.
      const scene = { ...(layer.sourceSceneRef?.scene || {}), duration: durationSeconds };
      const speechItem = {
        type: 'speech', sceneIndex: 0, audio: translatedText,
        actor: audioLayer.speakerCharacterName || '', duration: durationSeconds,
      };
      try {
        text = await rewriteSpeechItem({
          movieResourceList: { scenes: [scene], sounds: [speechItem] },
          scene, speechItem, maxCharacters, inferenceModel,
          options: {
            sceneIndex: 0, soundIndex: 0, maxAttempts: 3,
            reasoningEffort: inferenceEffort,
            translationContext: {
              originalText, translatedText, targetLanguage, durationSeconds,
              currentCharacters: count(translatedText), maxCharacters,
            },
            externalRequestContext: {
              sessionId, requestKey: `retranslation:speech-repair-${speechIndex}`,
            },
            onRepairAttempt: (attempt) => { attempts = attempt; },
          },
        });
      } catch (cause) {
        throw validationError(
          `Unable to fit translated speech ${speechIndex} in layer ${layerIndex} ` +
          `within ${maxCharacters} characters (including ${Math.round(budget.overshootRatio * 100)}% tolerance) ` +
          `after ${attempts} repair attempts.`,
          { speechIndex, layerIndex, maxCharacters, attempts }, cause,
        );
      }
    }
    // Also guard the queue boundary if an adapter/dependency returns invalid data.
    text = typeof text === 'string' ? text.trim() : '';
    if (!text || count(text) > maxCharacters) {
      throw validationError(`Translated speech ${speechIndex} exceeds its ${maxCharacters}-character limit or is empty.`,
        { speechIndex, layerIndex, maxCharacters });
    }
    texts.push(text);
    validation.push({
      speechIndex, layerIndex, durationSeconds, maxCharacters,
      promptMaxCharacters: budget.maxCharacters, overshootRatio: budget.overshootRatio,
      originalCharacters: count(originalText), translatedCharacters: count(translatedText),
      finalCharacters: count(text), attempts,
    });
  }
  return { texts, validation };
}
