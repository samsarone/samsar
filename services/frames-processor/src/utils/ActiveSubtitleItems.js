import { isItemActiveAtFrame } from './FrameTimingUtils.js';

function isSubtitleItem(item = {}) {
  return item?.type === 'text' && item?.subType === 'subtitle';
}

function getSubtitleSlot(item = {}) {
  const audioLayerId = item.audioLayerId?.toString?.() || '';
  if (audioLayerId) {
    return `audio:${audioLayerId}`;
  }

  const x = Number(item?.config?.x ?? item.x);
  const y = Number(item?.config?.y ?? item.y);
  return `position:${Number.isFinite(x) ? x : ''}:${Number.isFinite(y) ? y : ''}`;
}

function getSessionCueStartFrame(item = {}) {
  const candidates = [
    item.subtitleCueStartFrameSession,
    item.subtitle_cue_start_frame_session,
    item.subtitleSessionStartFrame,
    item.subtitle_session_start_frame,
  ];
  for (const value of candidates) {
    if (value == null || value === '') {
      continue;
    }
    const startFrame = Number(value);
    if (Number.isFinite(startFrame)) {
      return startFrame;
    }
  }
  return null;
}

function getItemStartFrame(item = {}, { durationOffsetFrames } = {}) {
  const sessionCueStartFrame = getSessionCueStartFrame(item);
  if (sessionCueStartFrame != null) {
    return sessionCueStartFrame;
  }

  const startFrame = Number(item?.config?.frameOffset);
  if (!Number.isFinite(startFrame)) {
    return Number.NEGATIVE_INFINITY;
  }

  const layerOffsetFrames = Number(durationOffsetFrames);
  return Number.isFinite(layerOffsetFrames)
    ? layerOffsetFrames + startFrame
    : startFrame;
}

function getCurrentSessionFrame(frame, { durationOffsetFrames } = {}) {
  const currentFrame = Number(frame);
  const layerOffsetFrames = Number(durationOffsetFrames);
  if (!Number.isFinite(currentFrame)) {
    return Number.NEGATIVE_INFINITY;
  }
  return Number.isFinite(layerOffsetFrames)
    ? layerOffsetFrames + currentFrame
    : currentFrame;
}

/**
 * Resolve visibility once per frame and arbitrate subtitles by audio layer or
 * visual position. Bad or overlapping upstream cue ranges must never paint
 * two captions into the same visual slot.
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

  const subtitleWinners = new Map();
  const currentSessionFrame = getCurrentSessionFrame(frame, options);
  activeEntries.forEach((entry) => {
    if (!isSubtitleItem(entry.item)) {
      return;
    }
    const slot = getSubtitleSlot(entry.item);
    const currentWinner = subtitleWinners.get(slot);
    const entryStartFrame = getItemStartFrame(entry.item, options);
    const winnerStartFrame = currentWinner
      ? getItemStartFrame(currentWinner.item, options)
      : Number.NEGATIVE_INFINITY;
    const entryHasStarted = entryStartFrame <= currentSessionFrame;
    const winnerHasStarted = currentWinner
      ? winnerStartFrame <= currentSessionFrame
      : false;
    if (
      !currentWinner ||
      (entryHasStarted && !winnerHasStarted) ||
      (
        entryHasStarted === winnerHasStarted &&
        (
          (entryHasStarted && entryStartFrame > winnerStartFrame) ||
          (!entryHasStarted && entryStartFrame < winnerStartFrame) ||
          (
            entryStartFrame === winnerStartFrame &&
            entry.index > currentWinner.index
          )
        )
      )
    ) {
      subtitleWinners.set(slot, entry);
    }
  });

  return activeEntries
    .filter((entry) => {
      if (!isSubtitleItem(entry.item)) {
        return true;
      }
      return subtitleWinners.get(getSubtitleSlot(entry.item)) === entry;
    })
    .map(({ item }) => item);
}
