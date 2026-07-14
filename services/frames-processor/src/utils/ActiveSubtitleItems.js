import { isItemActiveAtFrame } from './FrameTimingUtils.js';
import {
  isMappedTranslatedSubtitleItem,
  normalizeComparableSubtitleLanguage,
} from './SubtitleRenderPolicy.js';

function isTranslatedSubtitleItem(item = {}) {
  if (isMappedTranslatedSubtitleItem(item)) {
    return true;
  }

  if (item?.type !== 'text' || item?.subType !== 'subtitle') {
    return false;
  }

  const audioLanguage = normalizeComparableSubtitleLanguage(
    item.audioLanguage || item.audio_language,
  );
  const subtitleLanguage = normalizeComparableSubtitleLanguage(
    item.subtitleLanguage || item.subtitle_language,
  );
  return Boolean(
    audioLanguage &&
    subtitleLanguage &&
    audioLanguage !== subtitleLanguage
  );
}

function getTranslatedSubtitleSlot(item = {}) {
  const audioLayerId = item.audioLayerId?.toString?.() || '';
  if (audioLayerId) {
    return `audio:${audioLayerId}`;
  }

  const x = Number(item?.config?.x ?? item.x);
  const y = Number(item?.config?.y ?? item.y);
  return `position:${Number.isFinite(x) ? x : ''}:${Number.isFinite(y) ? y : ''}`;
}

function getItemStartFrame(item = {}) {
  const startFrame = Number(item?.config?.frameOffset);
  return Number.isFinite(startFrame) ? startFrame : Number.NEGATIVE_INFINITY;
}

/**
 * Resolve visibility once per frame and arbitrate translated subtitles by
 * audio layer. Bad or overlapping upstream cue ranges must never paint two
 * captions into the same visual slot.
 */
export function selectActiveItemsForFrame(items, frame, options = {}) {
  if (!Array.isArray(items)) {
    return [];
  }

  const activeEntries = items.map((item, index) => ({ item, index })).filter(({ item }) => {
    if (!item) {
      return false;
    }
    const hasFrameRange = (
      item.config &&
      item.config.frameDuration !== undefined &&
      item.config.frameOffset !== undefined
    );
    return !hasFrameRange || isItemActiveAtFrame(item, frame, options);
  });

  const translatedWinners = new Map();
  activeEntries.forEach((entry) => {
    if (!isTranslatedSubtitleItem(entry.item)) {
      return;
    }
    const slot = getTranslatedSubtitleSlot(entry.item);
    const currentWinner = translatedWinners.get(slot);
    if (
      !currentWinner ||
      getItemStartFrame(entry.item) > getItemStartFrame(currentWinner.item) ||
      (
        getItemStartFrame(entry.item) === getItemStartFrame(currentWinner.item) &&
        entry.index > currentWinner.index
      )
    ) {
      translatedWinners.set(slot, entry);
    }
  });

  return activeEntries
    .filter((entry) => {
      if (!isTranslatedSubtitleItem(entry.item)) {
        return true;
      }
      return translatedWinners.get(getTranslatedSubtitleSlot(entry.item)) === entry;
    })
    .map(({ item }) => item);
}

