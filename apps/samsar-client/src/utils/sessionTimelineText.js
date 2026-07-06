export function normalizeSessionId(value) {
  if (typeof value === 'string') {
    return value.trim();
  }
  if (value == null) {
    return '';
  }
  return value?.toString?.() || '';
}

function toFiniteNumber(value, fallback = 0) {
  const parsedValue = Number(value);
  return Number.isFinite(parsedValue) ? parsedValue : fallback;
}

function formatTimestamp(value) {
  const totalMilliseconds = Math.max(0, Math.round(toFiniteNumber(value) * 1000));
  const milliseconds = totalMilliseconds % 1000;
  const totalSeconds = Math.floor(totalMilliseconds / 1000);
  const seconds = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const minutes = totalMinutes % 60;
  const hours = Math.floor(totalMinutes / 60);
  const pad = (input, length = 2) => String(input).padStart(length, '0');

  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}.${pad(milliseconds, 3)}`;
}

function getAudioLayerId(audioLayer) {
  return audioLayer?._id?.toString?.() || audioLayer?._id || audioLayer?.id || null;
}

function getAudioLayerSpeaker(audioLayer = {}) {
  return (
    audioLayer.speakerCharacterName ||
    audioLayer.speaker ||
    audioLayer.actor ||
    ''
  );
}

function getSubtitleText(item = {}) {
  return (
    item.text ||
    item.normalizedText ||
    item.config?.text ||
    ''
  ).toString().replace(/\s+/g, ' ').trim();
}

function isSubtitleItem(item = {}) {
  return item?.type === 'text' && item?.subType === 'subtitle';
}

function mergeTranscriptRows(rows = [], frameDurationSeconds = 1 / 16) {
  const sortedRows = [...rows].sort((left, right) => left.startTime - right.startTime);
  const mergedRows = [];

  sortedRows.forEach((row) => {
    const previousRow = mergedRows[mergedRows.length - 1];
    const canMerge = previousRow &&
      previousRow.text === row.text &&
      previousRow.audioLayerId === row.audioLayerId &&
      row.startTime - previousRow.endTime <= Math.max(0.12, frameDurationSeconds * 2);

    if (canMerge) {
      previousRow.endTime = Math.max(previousRow.endTime, row.endTime);
      previousRow.duration = Math.max(0, previousRow.endTime - previousRow.startTime);
      return;
    }

    mergedRows.push({
      ...row,
      duration: Math.max(0, row.endTime - row.startTime),
    });
  });

  return mergedRows;
}

function buildSubtitleTranscriptRows(sessionDetails = {}) {
  const framesPerSecond = Math.max(1, toFiniteNumber(sessionDetails.framesPerSecond, 24));
  const audioLayerMap = new Map();
  const audioLayers = Array.isArray(sessionDetails.audioLayers) ? sessionDetails.audioLayers : [];

  audioLayers.forEach((audioLayer) => {
    const id = getAudioLayerId(audioLayer);
    if (id) {
      audioLayerMap.set(id.toString(), audioLayer);
    }
  });

  const rows = [];
  const layers = Array.isArray(sessionDetails.layers) ? sessionDetails.layers : [];

  layers.forEach((layer) => {
    const layerStartTime = toFiniteNumber(layer?.durationOffset ?? layer?.startTime, 0);
    const activeItemList = Array.isArray(layer?.imageSession?.activeItemList)
      ? layer.imageSession.activeItemList
      : [];

    activeItemList.forEach((item) => {
      if (!isSubtitleItem(item)) {
        return;
      }

      const text = getSubtitleText(item);
      if (!text) {
        return;
      }

      const frameOffset = toFiniteNumber(item?.config?.frameOffset, 0);
      const frameDuration = Math.max(1, toFiniteNumber(item?.config?.frameDuration, 1));
      const startTime = layerStartTime + frameOffset / framesPerSecond;
      const endTime = startTime + frameDuration / framesPerSecond;
      const audioLayerId = item.audioLayerId?.toString?.() || item.audioLayerId || null;
      const audioLayer = audioLayerId ? audioLayerMap.get(audioLayerId.toString()) : null;

      rows.push({
        startTime,
        endTime,
        duration: Math.max(0, endTime - startTime),
        text,
        audioLayerId,
        speaker: item.speaker || getAudioLayerSpeaker(audioLayer),
      });
    });
  });

  return mergeTranscriptRows(rows, 1 / framesPerSecond);
}

function buildAudioPromptTranscriptRows(sessionDetails = {}) {
  const audioLayers = Array.isArray(sessionDetails.audioLayers) ? sessionDetails.audioLayers : [];

  return audioLayers
    .filter((audioLayer) => {
      const generationType = typeof audioLayer?.generationType === 'string'
        ? audioLayer.generationType.toLowerCase()
        : '';
      return generationType === 'speech' && typeof audioLayer?.prompt === 'string' && audioLayer.prompt.trim();
    })
    .map((audioLayer) => {
      const startTime = Math.max(0, toFiniteNumber(audioLayer.startTime, 0));
      const explicitEndTime = toFiniteNumber(audioLayer.endTime, NaN);
      const duration = toFiniteNumber(audioLayer.duration, 0);
      const endTime = Number.isFinite(explicitEndTime) && explicitEndTime > startTime
        ? explicitEndTime
        : startTime + Math.max(0, duration);

      return {
        startTime,
        endTime,
        duration: Math.max(0, endTime - startTime),
        text: audioLayer.prompt.replace(/\s+/g, ' ').trim(),
        audioLayerId: getAudioLayerId(audioLayer),
        speaker: getAudioLayerSpeaker(audioLayer),
      };
    })
    .sort((left, right) => left.startTime - right.startTime);
}

function buildTranscriptRows(sessionDetails = {}) {
  const subtitleRows = buildSubtitleTranscriptRows(sessionDetails);
  return subtitleRows.length ? subtitleRows : buildAudioPromptTranscriptRows(sessionDetails);
}

function getAlignmentWords(audioLayer = {}) {
  const words = audioLayer?.transcriptAlignment?.words;
  if (!Array.isArray(words)) {
    return [];
  }

  return words
    .map((wordInfo) => {
      const text = (wordInfo?.word || wordInfo?.alignedWord || wordInfo?.text || '').toString().trim();
      const start = toFiniteNumber(wordInfo?.start, NaN);
      const end = toFiniteNumber(wordInfo?.end, NaN);

      if (!text || !Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
        return null;
      }

      return {
        text,
        start,
        end,
      };
    })
    .filter(Boolean)
    .sort((left, right) => left.start - right.start);
}

function resolveAudioLayerGlobalStartTime(audioLayer = {}) {
  const rawStartTime = toFiniteNumber(audioLayer?.startTime, NaN);
  return Number.isFinite(rawStartTime) ? Math.max(0, rawStartTime) : 0;
}

function buildAlignmentRowsForAudioLayer(audioLayer = {}) {
  const words = getAlignmentWords(audioLayer);
  if (!words.length) {
    return [];
  }

  const audioLayerStartTime = resolveAudioLayerGlobalStartTime(audioLayer);
  const speaker = getAudioLayerSpeaker(audioLayer);
  const rows = [];
  let currentWords = [];
  let currentStart = null;
  let previousEnd = null;
  const flushCurrent = () => {
    if (!currentWords.length || currentStart === null || previousEnd === null) {
      currentWords = [];
      currentStart = null;
      previousEnd = null;
      return;
    }

    const startTime = audioLayerStartTime + currentStart;
    const endTime = audioLayerStartTime + previousEnd;
    rows.push({
      startTime,
      endTime,
      duration: Math.max(0, endTime - startTime),
      text: currentWords.join(' ').replace(/\s+/g, ' ').trim(),
      audioLayerId: getAudioLayerId(audioLayer),
      speaker,
    });
    currentWords = [];
    currentStart = null;
    previousEnd = null;
  };

  words.forEach((wordInfo) => {
    const gap = previousEnd === null ? 0 : wordInfo.start - previousEnd;
    const currentDuration = currentStart === null ? 0 : previousEnd - currentStart;
    const shouldStartNewRow = currentWords.length > 0 && (
      gap > 0.55 ||
      currentWords.length >= 10 ||
      currentDuration >= 4
    );

    if (shouldStartNewRow) {
      flushCurrent();
    }

    if (currentStart === null) {
      currentStart = wordInfo.start;
    }
    currentWords.push(wordInfo.text);
    previousEnd = Math.max(previousEnd ?? wordInfo.end, wordInfo.end);
  });

  flushCurrent();
  return rows;
}

export function buildSpeechTranscriptHintRows(sessionDetails = {}) {
  const audioLayers = Array.isArray(sessionDetails.audioLayers) ? sessionDetails.audioLayers : [];
  const alignmentRows = audioLayers
    .flatMap((audioLayer) => buildAlignmentRowsForAudioLayer(audioLayer))
    .sort((left, right) => left.startTime - right.startTime);

  if (alignmentRows.length) {
    return alignmentRows;
  }

  return audioLayers
    .filter((audioLayer) => {
      const generationType = typeof audioLayer?.generationType === 'string'
        ? audioLayer.generationType.toLowerCase()
        : '';
      return generationType === 'speech' && typeof audioLayer?.prompt === 'string' && audioLayer.prompt.trim();
    })
    .map((audioLayer) => {
      const startTime = resolveAudioLayerGlobalStartTime(audioLayer);
      const explicitEndTime = toFiniteNumber(audioLayer.endTime, NaN);
      const duration = Math.max(1 / 30, toFiniteNumber(audioLayer.duration, 1));
      const endTime = Number.isFinite(explicitEndTime) && explicitEndTime > startTime
        ? explicitEndTime
        : startTime + duration;

      return {
        startTime,
        endTime,
        duration: Math.max(0, endTime - startTime),
        text: audioLayer.prompt.replace(/\s+/g, ' ').trim(),
        audioLayerId: getAudioLayerId(audioLayer),
        speaker: getAudioLayerSpeaker(audioLayer),
      };
    })
    .sort((left, right) => left.startTime - right.startTime);
}

export function buildTranscriptText(sessionDetails = {}) {
  const sessionId = normalizeSessionId(sessionDetails?._id || sessionDetails?.id);
  const rows = buildTranscriptRows(sessionDetails);

  if (!rows.length) {
    return null;
  }

  const lines = [
    'Samsar session transcript',
    `Session: ${sessionId || '-'}`,
    `Generated: ${new Date().toISOString()}`,
    '',
  ];

  rows.forEach((row) => {
    const speaker = row.speaker ? `${row.speaker}: ` : '';
    lines.push(`[${formatTimestamp(row.startTime)} - ${formatTimestamp(row.endTime)}] ${speaker}${row.text}`);
  });

  return `${lines.join('\n')}\n`;
}

export function normalizeTimelineHints(hints = [], options = {}) {
  if (!Array.isArray(hints)) {
    return [];
  }

  const minimumDuration = Math.max(1 / 30, toFiniteNumber(options.minimumDuration, 1 / 30));
  const totalDuration = toFiniteNumber(options.totalDuration, NaN);

  return hints
    .map((hint, index) => {
      const text = (hint?.text || hint?.content || '').toString().replace(/\s+/g, ' ').trim();
      if (!text) {
        return null;
      }

      const rawStartTime = Math.max(0, toFiniteNumber(hint?.startTime ?? hint?.start, 0));
      const startTime = Number.isFinite(totalDuration) && totalDuration > 0
        ? Math.min(rawStartTime, Math.max(0, totalDuration - minimumDuration))
        : rawStartTime;
      const rawDuration = toFiniteNumber(hint?.duration, NaN);
      const rawEndTime = toFiniteNumber(hint?.endTime ?? hint?.end, NaN);
      const derivedEndTime = Number.isFinite(rawEndTime) && rawEndTime > startTime
        ? rawEndTime
        : startTime + Math.max(minimumDuration, Number.isFinite(rawDuration) ? rawDuration : 1);
      const finalEndTime = Number.isFinite(totalDuration) && totalDuration > 0
        ? Math.max(startTime + minimumDuration, Math.min(totalDuration, derivedEndTime))
        : Math.max(startTime + minimumDuration, derivedEndTime);

      return {
        ...hint,
        id: normalizeSessionId(hint?.id || hint?._id) || `hint_${index}`,
        text,
        startTime,
        duration: Math.max(minimumDuration, finalEndTime - startTime),
        endTime: finalEndTime,
        speaker: hint?.speaker || '',
      };
    })
    .filter(Boolean)
    .sort((left, right) => left.startTime - right.startTime);
}

export function buildHintsText(sessionDetails = {}) {
  const sessionId = normalizeSessionId(sessionDetails?._id || sessionDetails?.id);
  const rows = normalizeTimelineHints(sessionDetails?.timelineHints || sessionDetails?.hints || []);

  if (!rows.length) {
    return null;
  }

  const lines = [
    'Samsar session hints',
    `Session: ${sessionId || '-'}`,
    `Generated: ${new Date().toISOString()}`,
    '',
  ];

  rows.forEach((row) => {
    const speaker = row.speaker ? `${row.speaker}: ` : '';
    lines.push(`[${formatTimestamp(row.startTime)} - ${formatTimestamp(row.endTime)}] ${speaker}${row.text}`);
  });

  return `${lines.join('\n')}\n`;
}
