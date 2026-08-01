import axios from 'axios';
import { randomUUID } from 'crypto';
import fs from 'fs';
import { promises as fsPromises } from 'fs';
import path from 'path';
import { tmpdir } from 'os';
import { pipeline } from 'stream/promises';
import ffmpeg from 'fluent-ffmpeg';
import mongoose from 'mongoose';

import GlobalSession from '../../schema/GlobalSession.js';
import AudioJoinRequest from '../../schema/AudioJoinRequest.js';
import GeneratedMusic from '../../schema/generations/GeneratedMusic.js';
import VideoSession from '../../schema/VideoSession.js';
import {
  buildSecureMediaDeliveryUrl,
  uploadSpeechAudioToCDN,
} from '../AWS.js';
import { getDBConnectionString } from '../DBString.js';
import {
  AUDIO_ROUTE_TEXT_TO_MUSIC,
  AUDIO_ROUTE_TEXT_TO_SOUND_EFFECT,
  AUDIO_ROUTE_TEXT_TO_SPEECH,
  createExternalAudioRequest,
  getExternalAudioStatus,
} from '../api/ExternalAudioAPI.js';
import {
  getAudioDurationSeconds,
  resolveAudioLinkToLocalPath,
} from './AudioUtils.js';
import { shouldBypassGenerationCredits } from '../../utils/EnvironmentUtils.js';
import { withProcessorFfmpegResources } from '../../utils/FfmpegResources.js';

const AUDIO_LIBRARY_TYPE_MUSIC = 'music';
const AUDIO_LIBRARY_TYPE_SPEECH = 'speech';
const AUDIO_LIBRARY_TYPE_SOUND_EFFECT = 'sound_effect';
const MAX_JOIN_AUDIO_ITEMS = 25;
const MAX_REMOTE_AUDIO_BYTES = 512 * 1024 * 1024;
const DEFAULT_AUDIO_LIBRARY_PAGE_SIZE = 18;
const MAX_AUDIO_LIBRARY_PAGE_SIZE = 50;
const AUDIO_JOIN_LEASE_TIMEOUT_MS = 30 * 60 * 1000;
const ACTIVE_AUDIO_JOIN_REQUESTS = new Set();

const GENERATION_ROUTE_BY_TYPE = Object.freeze({
  [AUDIO_LIBRARY_TYPE_MUSIC]: AUDIO_ROUTE_TEXT_TO_MUSIC,
  [AUDIO_LIBRARY_TYPE_SPEECH]: AUDIO_ROUTE_TEXT_TO_SPEECH,
  [AUDIO_LIBRARY_TYPE_SOUND_EFFECT]: AUDIO_ROUTE_TEXT_TO_SOUND_EFFECT,
});

function buildAudioStudioError(message, status = 400, code = 'AUDIO_STUDIO_REQUEST_INVALID') {
  const error = new Error(message);
  error.status = status;
  error.statusCode = status;
  error.code = code;
  return error;
}

function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function buildAudioStudioPlaybackUrl(value) {
  const audioPath = normalizeString(value);
  if (!audioPath || /^(data:|blob:)/i.test(audioPath)) return audioPath;
  try {
    return buildSecureMediaDeliveryUrl(audioPath) || audioPath;
  } catch (error) {
    console.warn('Unable to build Audio Studio playback URL:', error?.message || error);
    return audioPath;
  }
}

function getAudioStudioMediaFileName(userId, prefix = 'audio') {
  const normalizedUserId = (userId?.toString?.() || userId || 'user')
    .replace(/[^a-z0-9_-]/gi, '_');
  const normalizedPrefix = normalizeString(prefix).replace(/[^a-z0-9_-]/gi, '_') || 'audio';
  return path.posix.join(
    'audio_studio',
    normalizedUserId,
    `${normalizedPrefix}-${randomUUID()}.mp3`
  );
}

export function normalizeAudioLibraryType(value) {
  const normalized = normalizeString(value).toLowerCase();
  if (normalized === 'music' || normalized === 'background_music') {
    return AUDIO_LIBRARY_TYPE_MUSIC;
  }
  if (
    normalized === 'speech' ||
    normalized === 'lip_sync' ||
    normalized === 'custom_speech' ||
    normalized === 'recorded_speech'
  ) {
    return AUDIO_LIBRARY_TYPE_SPEECH;
  }
  if (normalized === 'sound' || normalized === 'sound_effect' || normalized === 'sound effect') {
    return AUDIO_LIBRARY_TYPE_SOUND_EFFECT;
  }
  return '';
}

export function parseAudioStudioItemId(value) {
  const itemId = normalizeString(value);
  if (!itemId) {
    return null;
  }

  if (itemId.startsWith('generated_music:')) {
    const generatedMusicId = itemId.slice('generated_music:'.length);
    if (!mongoose.Types.ObjectId.isValid(generatedMusicId)) {
      return null;
    }
    return {
      kind: 'generated_music',
      itemId,
      generatedMusicId,
    };
  }

  const [sessionId, audioLayerId, ...remainder] = itemId.split(':');
  if (
    remainder.length > 0 ||
    !mongoose.Types.ObjectId.isValid(sessionId) ||
    !mongoose.Types.ObjectId.isValid(audioLayerId)
  ) {
    return null;
  }

  return {
    kind: 'session_audio_layer',
    itemId,
    sessionId,
    audioLayerId,
  };
}

export function validateJoinAudioPayload(payload = {}) {
  const rawItemIds = Array.isArray(payload.audioItemIds)
    ? payload.audioItemIds
    : Array.isArray(payload.itemIds)
      ? payload.itemIds
      : [];
  const itemIds = rawItemIds.map((itemId) => normalizeString(itemId)).filter(Boolean);

  if (itemIds.length < 2) {
    throw buildAudioStudioError('Select at least two audio items to join.');
  }
  if (itemIds.length > MAX_JOIN_AUDIO_ITEMS) {
    throw buildAudioStudioError(`Join up to ${MAX_JOIN_AUDIO_ITEMS} audio items at a time.`);
  }
  if (new Set(itemIds).size !== itemIds.length) {
    throw buildAudioStudioError('Each audio item can only be selected once.');
  }

  const parsedItemIds = itemIds.map(parseAudioStudioItemId);
  if (parsedItemIds.some((item) => !item)) {
    throw buildAudioStudioError('One or more selected audio items are invalid.');
  }

  const requestedLibraryType = payload.libraryType
    ? normalizeAudioLibraryType(payload.libraryType)
    : '';
  if (payload.libraryType && !requestedLibraryType) {
    throw buildAudioStudioError('Select a valid audio category to join.');
  }

  return {
    itemIds,
    parsedItemIds,
    requestedLibraryType,
    title: normalizeString(payload.title).slice(0, 120),
    fadeAudioAtEnds: payload.fadeAudioAtEnds === true || payload.fadeAudioAtEnds === 'true',
  };
}

export function normalizeAudioStudioLibraryQuery(query = {}) {
  const parsedPage = Number.parseInt(query.page, 10);
  const parsedLimit = Number.parseInt(query.limit, 10);
  const page = Number.isFinite(parsedPage) && parsedPage > 0 ? parsedPage : 1;
  const limit = Number.isFinite(parsedLimit) && parsedLimit > 0
    ? Math.min(parsedLimit, MAX_AUDIO_LIBRARY_PAGE_SIZE)
    : DEFAULT_AUDIO_LIBRARY_PAGE_SIZE;
  const requestedLibraryType = normalizeString(query.libraryType || query.type);
  const libraryType = requestedLibraryType
    ? normalizeAudioLibraryType(requestedLibraryType)
    : '';
  if (requestedLibraryType && !libraryType) {
    throw buildAudioStudioError('Select a valid audio library category.');
  }

  return {
    page,
    limit,
    libraryType,
    search: normalizeString(query.search).slice(0, 160),
  };
}

function resolveAudioItemPath(item = {}) {
  const candidates = [
    item.selectedLocalAudioLink,
    ...(Array.isArray(item.localAudioLinks) ? item.localAudioLinks : []),
    item.url,
    item.selectedRemoteAudioLink,
    ...(Array.isArray(item.remoteAudioLinks) ? item.remoteAudioLinks : []),
    ...(Array.isArray(item.remoteAudioData)
      ? item.remoteAudioData.map((audioData) => audioData?.audio_url)
      : []),
  ];
  return candidates.find((candidate) => normalizeString(candidate))?.trim() || '';
}

function getAudioItemTitle(item = {}, libraryType) {
  const explicitTitle = normalizeString(item.title);
  const prompt = normalizeString(item.prompt || item.description);
  const speakerName = normalizeString(item.speakerCharacterName);
  if (explicitTitle) return explicitTitle;
  if (libraryType === AUDIO_LIBRARY_TYPE_SPEECH) return speakerName || prompt || 'Speech';
  if (libraryType === AUDIO_LIBRARY_TYPE_MUSIC) return prompt || 'Music';
  return prompt || 'Sound Effect';
}

async function resolveOwnedAudioItems(userId, parsedItemIds) {
  await getDBConnectionString();
  const normalizedUserId = userId?.toString?.() || userId;
  const generatedMusicIds = parsedItemIds
    .filter((item) => item.kind === 'generated_music')
    .map((item) => item.generatedMusicId);
  const sessionIds = Array.from(new Set(
    parsedItemIds
      .filter((item) => item.kind === 'session_audio_layer')
      .map((item) => item.sessionId)
  ));

  const [generatedMusicItems, sessions] = await Promise.all([
    generatedMusicIds.length > 0
      ? GeneratedMusic.find({ _id: { $in: generatedMusicIds }, userId: normalizedUserId }).lean()
      : [],
    sessionIds.length > 0
      ? VideoSession.find({ _id: { $in: sessionIds }, userId: normalizedUserId })
          .select('_id audioLayers')
          .lean()
      : [],
  ]);

  const generatedMusicById = new Map(
    generatedMusicItems.map((item) => [item._id.toString(), item])
  );
  const sessionById = new Map(sessions.map((session) => [session._id.toString(), session]));

  return parsedItemIds.map((parsedItem) => {
    let sourceItem;
    if (parsedItem.kind === 'generated_music') {
      sourceItem = generatedMusicById.get(parsedItem.generatedMusicId);
    } else {
      const session = sessionById.get(parsedItem.sessionId);
      sourceItem = Array.isArray(session?.audioLayers)
        ? session.audioLayers.find((audioLayer) => (
            audioLayer?._id?.toString?.() === parsedItem.audioLayerId
          ))
        : null;
    }

    if (!sourceItem) {
      throw buildAudioStudioError(
        'An audio item was not found in your library.',
        404,
        'AUDIO_STUDIO_ITEM_NOT_FOUND'
      );
    }

    const libraryType = normalizeAudioLibraryType(
      sourceItem.libraryType || sourceItem.generationType
    );
    const audioPath = resolveAudioItemPath(sourceItem);
    if (!libraryType || !audioPath) {
      throw buildAudioStudioError('An audio item is not ready to join.');
    }

    return {
      itemId: parsedItem.itemId,
      libraryType,
      title: getAudioItemTitle(sourceItem, libraryType),
      audioPath,
    };
  });
}

function getDownloadFileExtension(audioUrl) {
  try {
    const extension = path.extname(new URL(audioUrl).pathname).toLowerCase();
    if (['.mp3', '.wav', '.m4a', '.aac', '.ogg', '.flac', '.webm'].includes(extension)) {
      return extension;
    }
  } catch {
  }
  return '.mp3';
}

async function materializeAudioInput(audioPath, tempDirectory, index) {
  if (!/^https?:\/\//i.test(audioPath)) {
    const localPath = resolveAudioLinkToLocalPath(audioPath);
    if (!localPath || !fs.existsSync(localPath)) {
      throw buildAudioStudioError(
        'An audio file is no longer available.',
        404,
        'AUDIO_STUDIO_FILE_NOT_FOUND'
      );
    }
    return localPath;
  }

  const outputPath = path.join(
    tempDirectory,
    `source-${index + 1}${getDownloadFileExtension(audioPath)}`
  );
  const response = await axios.get(audioPath, {
    responseType: 'stream',
    timeout: 120000,
    maxContentLength: MAX_REMOTE_AUDIO_BYTES,
    maxBodyLength: MAX_REMOTE_AUDIO_BYTES,
  });
  const contentLength = Number(response.headers?.['content-length']);
  if (Number.isFinite(contentLength) && contentLength > MAX_REMOTE_AUDIO_BYTES) {
    response.data.destroy();
    throw buildAudioStudioError('An audio file is too large to join.', 413);
  }
  await pipeline(response.data, fs.createWriteStream(outputPath));
  return outputPath;
}

function buildJoinedAudioFilters(inputCount, durations = [], fadeAudioAtEnds = false) {
  const audioFilters = Array.from({ length: inputCount }, (_, index) => {
    const duration = Number(durations[index]);
    let fades = '';
    if (fadeAudioAtEnds && Number.isFinite(duration) && duration > 0) {
      const fadeDuration = Math.min(0.35, Math.max(0.03, duration / 4));
      const fadeOutStart = Math.max(0, duration - fadeDuration);
      fades = `afade=t=in:st=0:d=${fadeDuration.toFixed(3)},` +
        `afade=t=out:st=${fadeOutStart.toFixed(3)}:d=${fadeDuration.toFixed(3)},`;
    }
    return (
      `[${index}:a]aresample=44100,` +
      'aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo,' +
      `${fades}asetpts=PTS-STARTPTS[a${index}]`
    );
  });
  audioFilters.push(
    `${Array.from({ length: inputCount }, (_, index) => `[a${index}]`).join('')}` +
    `concat=n=${inputCount}:v=0:a=1[joined]`
  );
  return audioFilters;
}

async function renderJoinedAudio(inputPaths, outputPath, { fadeAudioAtEnds = false } = {}) {
  const durations = fadeAudioAtEnds
    ? await Promise.all(inputPaths.map((inputPath) => getAudioDurationSeconds(inputPath)))
    : [];
  const audioFilters = buildJoinedAudioFilters(
    inputPaths.length,
    durations,
    fadeAudioAtEnds
  );

  await withProcessorFfmpegResources((threadOptions) => (
    new Promise((resolve, reject) => {
      const command = ffmpeg();
      inputPaths.forEach((inputPath) => {
        command.input(inputPath).inputOptions(threadOptions.inputOptions);
      });
      command
        .complexFilter(audioFilters)
        .outputOptions([
          ...threadOptions.outputOptions,
          '-map', '[joined]',
          '-c:a', 'libmp3lame',
          '-b:a', '192k',
        ])
        .noVideo()
        .on('end', resolve)
        .on('error', reject)
        .save(outputPath);
    })
  ));
}

async function uploadAudioStudioMp3(outputPath, userId, prefix) {
  return uploadSpeechAudioToCDN(
    outputPath,
    getAudioStudioMediaFileName(userId, prefix)
  );
}

async function persistStudioGenerationAudio(userId, requestId, resultUrl) {
  const tempDirectory = await fsPromises.mkdtemp(
    path.join(tmpdir(), 'samsar-audio-studio-generation-')
  );
  try {
    const inputPath = await materializeAudioInput(resultUrl, tempDirectory, 0);
    const outputPath = path.join(tempDirectory, 'generated.mp3');
    await renderJoinedAudio([inputPath], outputPath);
    return await uploadAudioStudioMp3(
      outputPath,
      userId,
      `generated-${normalizeString(requestId).slice(-24)}`
    );
  } finally {
    await fsPromises.rm(tempDirectory, { recursive: true, force: true }).catch(() => {});
  }
}

async function ensureDurableAudioStudioMedia(generatedMusic) {
  const generationMeta = generatedMusic?.generationMeta || {};
  if (
    generationMeta.durableMediaPersisted ||
    (!generationMeta.audioStudioJoined && !generationMeta.audioStudioRequest)
  ) {
    return generatedMusic;
  }
  const sourceUrl = resolveAudioItemPath(generatedMusic);
  if (!sourceUrl) return generatedMusic;

  try {
    let durableUrl;
    if (generationMeta.audioStudioJoined && !/^https?:\/\//i.test(sourceUrl)) {
      const localPath = resolveAudioLinkToLocalPath(sourceUrl);
      if (!localPath || !fs.existsSync(localPath)) return generatedMusic;
      durableUrl = await uploadAudioStudioMp3(
        localPath,
        generatedMusic.userId,
        `recovered-join-${generatedMusic._id?.toString?.() || 'audio'}`
      );
    } else {
      durableUrl = await persistStudioGenerationAudio(
        generatedMusic.userId,
        generationMeta.audioStudioRequestId || generatedMusic._id?.toString?.(),
        buildAudioStudioPlaybackUrl(sourceUrl)
      );
    }
    const promotedAt = new Date().toISOString();
    await GeneratedMusic.updateOne(
      { _id: generatedMusic._id, userId: generatedMusic.userId },
      {
        $set: {
          url: durableUrl,
          'generationMeta.durableMediaPersisted': true,
          'generationMeta.durableMediaPromotedAt': promotedAt,
        },
      }
    );
    return {
      ...generatedMusic,
      url: durableUrl,
      generationMeta: {
        ...generationMeta,
        durableMediaPersisted: true,
        durableMediaPromotedAt: promotedAt,
      },
    };
  } catch (error) {
    console.error('Unable to promote existing Audio Studio media:', error);
    return generatedMusic;
  }
}

function buildStudioLibraryItem(generatedMusic) {
  const libraryType = normalizeAudioLibraryType(
    generatedMusic?.libraryType || generatedMusic?.generationType
  ) || AUDIO_LIBRARY_TYPE_SOUND_EFFECT;
  const sourceUrl = resolveAudioItemPath(generatedMusic);
  const playbackUrl = buildAudioStudioPlaybackUrl(sourceUrl);
  const duration = Number(generatedMusic?.duration) || 0;
  return {
    _id: `generated_music:${generatedMusic._id.toString()}`,
    audioLayerId: null,
    sessionId: generatedMusic.sessionId || null,
    projectId: generatedMusic.sessionId || null,
    projectName: 'Audio Studio',
    source: generatedMusic?.generationMeta?.audioStudioJoined
      ? 'joined_audio'
      : 'audio_studio_generation',
    title: getAudioItemTitle(generatedMusic, libraryType),
    description: generatedMusic.description || '',
    prompt: generatedMusic.prompt || '',
    playbackUrl,
    url: playbackUrl || sourceUrl,
    sourceUrl,
    localAudioLinks: /^https?:\/\//i.test(sourceUrl) ? [] : [sourceUrl],
    selectedLocalAudioLink: /^https?:\/\//i.test(sourceUrl) ? null : sourceUrl,
    remoteAudioLinks: /^https?:\/\//i.test(sourceUrl) ? [sourceUrl] : [],
    selectedRemoteAudioLink: /^https?:\/\//i.test(sourceUrl) ? sourceUrl : null,
    remoteAudioData: [],
    duration,
    startTime: 0,
    endTime: duration,
    volume: Number(generatedMusic.volume) || 100,
    generationType: generatedMusic.generationType,
    libraryType,
    speakerCharacterName: generatedMusic.speakerCharacterName || '',
    tags: Array.isArray(generatedMusic.tags) ? generatedMusic.tags : [],
    createdAt: generatedMusic.createdAt || generatedMusic.updatedAt || null,
    fadeOnEdges: libraryType !== AUDIO_LIBRARY_TYPE_SPEECH,
    generationMeta: generatedMusic.generationMeta || {},
  };
}

function buildSessionStudioLibraryItem(sessionData) {
  const audioLayer = sessionData?.audioLayer || {};
  const sessionId = sessionData?._id?.toString?.() || '';
  const audioLayerId = audioLayer?._id?.toString?.() || '';
  const libraryType = sessionData?.__libraryType || normalizeAudioLibraryType(
    audioLayer.libraryType || audioLayer.generationType
  );
  const sourceUrl = resolveAudioItemPath(audioLayer);
  const playbackUrl = buildAudioStudioPlaybackUrl(sourceUrl);
  if (!sessionId || !audioLayerId || !libraryType || !sourceUrl) {
    return null;
  }
  const duration = Number(audioLayer.duration) || 0;
  const localAudioLinks = Array.isArray(audioLayer.localAudioLinks)
    ? audioLayer.localAudioLinks.filter(Boolean)
    : [];
  const remoteAudioLinks = Array.isArray(audioLayer.remoteAudioLinks)
    ? audioLayer.remoteAudioLinks.filter(Boolean)
    : [];
  return {
    _id: `${sessionId}:${audioLayerId}`,
    audioLayerId,
    sessionId,
    projectId: sessionId,
    projectName: normalizeString(sessionData.sessionName) || `Project ${sessionId.slice(-6)}`,
    source: 'session_audio_layer',
    title: getAudioItemTitle(audioLayer, libraryType),
    description: normalizeString(audioLayer.prompt),
    prompt: normalizeString(audioLayer.prompt),
    playbackUrl,
    url: playbackUrl || sourceUrl,
    sourceUrl,
    localAudioLinks,
    selectedLocalAudioLink: audioLayer.selectedLocalAudioLink || localAudioLinks[0] || null,
    remoteAudioLinks,
    selectedRemoteAudioLink: audioLayer.selectedRemoteAudioLink || remoteAudioLinks[0] || null,
    remoteAudioData: Array.isArray(audioLayer.remoteAudioData) ? audioLayer.remoteAudioData : [],
    duration,
    startTime: Number(audioLayer.startTime) || 0,
    endTime: Number(audioLayer.endTime) || duration,
    volume: Number(audioLayer.volume) || 100,
    generationType: audioLayer.generationType || libraryType,
    libraryType,
    speakerCharacterName: normalizeString(audioLayer.speakerCharacterName),
    tags: [audioLayer.generationType, audioLayer.speakerCharacterName].filter(Boolean),
    createdAt: sessionData.__sortDate || audioLayer.createdAt || audioLayer.streamCreatedAt ||
      sessionData.createdAt || sessionData.updatedAt || null,
    fadeOnEdges: Boolean(audioLayer.fadeOnEdges),
    generationMeta: audioLayer.generationMeta || {},
  };
}

function buildLibraryTypeExpression(libraryTypePath, generationTypePath) {
  return {
    $let: {
      vars: {
        normalizedType: {
          $toLower: {
            $ifNull: [libraryTypePath, { $ifNull: [generationTypePath, ''] }],
          },
        },
      },
      in: {
        $switch: {
          branches: [
            {
              case: { $in: ['$$normalizedType', ['music', 'background_music']] },
              then: AUDIO_LIBRARY_TYPE_MUSIC,
            },
            {
              case: {
                $in: [
                  '$$normalizedType',
                  ['speech', 'lip_sync', 'custom_speech', 'recorded_speech'],
                ],
              },
              then: AUDIO_LIBRARY_TYPE_SPEECH,
            },
          ],
          default: AUDIO_LIBRARY_TYPE_SOUND_EFFECT,
        },
      },
    },
  };
}

function escapeRegularExpression(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildAudioLibraryFacet({ libraryType, search, candidateLimit, searchFields }) {
  const itemFilters = [];
  if (libraryType) {
    itemFilters.push({ $match: { __libraryType: libraryType } });
  }
  if (search) {
    const searchPattern = new RegExp(escapeRegularExpression(search), 'i');
    itemFilters.push({
      $match: {
        $or: searchFields.map((field) => ({ [field]: searchPattern })),
      },
    });
  }

  return {
    $facet: {
      items: [
        ...itemFilters,
        { $sort: { __sortDate: -1, _id: -1 } },
        { $limit: candidateLimit },
      ],
      total: [...itemFilters, { $count: 'count' }],
      categories: [
        { $group: { _id: '$__libraryType', count: { $sum: 1 } } },
      ],
    },
  };
}

function readFacetCount(facetResult) {
  return Number(facetResult?.total?.[0]?.count) || 0;
}

function mergeFacetCategoryCounts(...facetResults) {
  const counts = {
    [AUDIO_LIBRARY_TYPE_MUSIC]: 0,
    [AUDIO_LIBRARY_TYPE_SPEECH]: 0,
    [AUDIO_LIBRARY_TYPE_SOUND_EFFECT]: 0,
  };
  facetResults.forEach((facetResult) => {
    (facetResult?.categories || []).forEach((category) => {
      if (Object.hasOwn(counts, category?._id)) {
        counts[category._id] += Number(category.count) || 0;
      }
    });
  });
  return counts;
}

function sortAudioStudioLibraryItemsByCreationDate(items = []) {
  return [...items].sort((leftItem, rightItem) => {
    const timeDifference = new Date(rightItem.createdAt || 0).getTime() -
      new Date(leftItem.createdAt || 0).getTime();
    return timeDifference || rightItem._id.localeCompare(leftItem._id);
  });
}

export async function getAudioStudioLibraryPage(userId, query = {}) {
  await getDBConnectionString();
  const normalizedUserId = userId?.toString?.() || userId;
  const { page, limit, libraryType, search } = normalizeAudioStudioLibraryQuery(query);
  const candidateLimit = page * limit;

  const generatedPipeline = [
    { $match: { userId: normalizedUserId } },
    {
      $match: {
        $or: [
          { url: { $exists: true, $nin: [null, ''] } },
          { selectedLocalAudioLink: { $exists: true, $nin: [null, ''] } },
          { 'localAudioLinks.0': { $exists: true } },
          { selectedRemoteAudioLink: { $exists: true, $nin: [null, ''] } },
          { 'remoteAudioLinks.0': { $exists: true } },
          { 'remoteAudioData.0.audio_url': { $exists: true } },
        ],
      },
    },
    {
      $addFields: {
        __libraryType: buildLibraryTypeExpression('$libraryType', '$generationType'),
        __sortDate: { $ifNull: ['$createdAt', '$updatedAt'] },
      },
    },
    buildAudioLibraryFacet({
      libraryType,
      search,
      candidateLimit,
      searchFields: ['title', 'description', 'prompt', 'speakerCharacterName', 'tags'],
    }),
  ];

  const sessionPipeline = [
    { $match: { userId: normalizedUserId } },
    {
      $project: {
        sessionName: 1,
        audioLayers: 1,
        createdAt: 1,
        updatedAt: 1,
      },
    },
    { $unwind: '$audioLayers' },
    {
      $match: {
        'audioLayers.generationStatus': { $in: [null, '', 'COMPLETED'] },
        $or: [
          { 'audioLayers.selectedLocalAudioLink': { $exists: true, $nin: [null, ''] } },
          { 'audioLayers.localAudioLinks.0': { $exists: true } },
          { 'audioLayers.url': { $exists: true, $nin: [null, ''] } },
          { 'audioLayers.selectedRemoteAudioLink': { $exists: true, $nin: [null, ''] } },
          { 'audioLayers.remoteAudioLinks.0': { $exists: true } },
          { 'audioLayers.remoteAudioData.0.audio_url': { $exists: true } },
        ],
      },
    },
    {
      $addFields: {
        audioLayer: '$audioLayers',
        __libraryType: buildLibraryTypeExpression(
          '$audioLayers.libraryType',
          '$audioLayers.generationType'
        ),
        __sortDate: {
          $ifNull: [
            '$audioLayers.createdAt',
            {
              $ifNull: [
                '$audioLayers.streamCreatedAt',
                {
                  $convert: {
                    input: '$audioLayers._id',
                    to: 'date',
                    onError: { $ifNull: ['$createdAt', '$updatedAt'] },
                    onNull: { $ifNull: ['$createdAt', '$updatedAt'] },
                  },
                },
              ],
            },
          ],
        },
      },
    },
    { $unset: 'audioLayers' },
    buildAudioLibraryFacet({
      libraryType,
      search,
      candidateLimit,
      searchFields: [
        'audioLayer.title',
        'audioLayer.prompt',
        'audioLayer.speakerCharacterName',
        'audioLayer.tags',
        'sessionName',
      ],
    }),
  ];

  const [generatedResults, sessionResults] = await Promise.all([
    GeneratedMusic.aggregate(generatedPipeline),
    VideoSession.aggregate(sessionPipeline),
  ]);
  const generatedFacet = generatedResults[0] || {};
  const sessionFacet = sessionResults[0] || {};
  const durableGeneratedItems = await Promise.all(
    (generatedFacet.items || []).map(ensureDurableAudioStudioMedia)
  );
  const candidates = sortAudioStudioLibraryItemsByCreationDate([
    ...durableGeneratedItems.map(buildStudioLibraryItem),
    ...(sessionFacet.items || []).map(buildSessionStudioLibraryItem),
  ].filter(Boolean));
  const skip = (page - 1) * limit;
  const items = candidates.slice(skip, skip + limit);
  const totalItems = readFacetCount(generatedFacet) + readFacetCount(sessionFacet);
  const totalPages = totalItems > 0 ? Math.ceil(totalItems / limit) : 0;

  return {
    items,
    page,
    limit,
    totalItems,
    totalPages,
    hasMore: page < totalPages,
    categoryCounts: mergeFacetCategoryCounts(generatedFacet, sessionFacet),
  };
}

function getGenerationRequestType(payload = {}) {
  return normalizeAudioLibraryType(
    payload.libraryType || payload.generationType || payload.type
  );
}

export async function requestStudioAudioGeneration(userId, payload = {}) {
  const generationType = getGenerationRequestType(payload);
  const route = GENERATION_ROUTE_BY_TYPE[generationType];
  if (!route) {
    throw buildAudioStudioError('Choose music, speech, or sound effect generation.');
  }

  const prompt = normalizeString(payload.prompt || payload.text || payload.input);
  if (!prompt) {
    throw buildAudioStudioError('Describe the audio you want to generate.');
  }
  if (prompt.length > 6000) {
    throw buildAudioStudioError('Audio prompts must be 6,000 characters or fewer.');
  }

  const title = normalizeString(payload.title).slice(0, 120);
  const metadata = {
    ...(payload.metadata && typeof payload.metadata === 'object' && !Array.isArray(payload.metadata)
      ? payload.metadata
      : {}),
    audioStudioRequest: true,
    ...(title ? { title } : {}),
  };
  const requestPayload = {
    ...payload,
    prompt,
    text: prompt,
    input: prompt,
    metadata,
  };

  const result = await createExternalAudioRequest({
    userId,
    route,
    payload: requestPayload,
    meterCredits: !shouldBypassGenerationCredits(),
  });

  await GlobalSession.updateOne(
    { sessionType: 'audio', sessionId: result.request_id, userId },
    {
      $set: {
        'metadata.audioStudioRequest': true,
        'metadata.libraryType': generationType,
        'metadata.prompt': prompt,
        ...(title ? { 'metadata.title': title } : {}),
      },
    }
  );

  return result;
}

async function persistCompletedStudioGeneration(userId, requestId, statusPayload) {
  const resultUrl = normalizeString(
    statusPayload?.result_url || statusPayload?.audio_url || statusPayload?.audio?.url
  );
  if (!resultUrl) {
    return null;
  }

  const globalSession = await GlobalSession.findOne({
    sessionType: 'audio',
    userId,
    $or: [
      { sessionId: requestId },
      { requestId },
      { apiSessionId: requestId },
    ],
  }).lean();
  if (!globalSession) {
    throw buildAudioStudioError('Audio generation request was not found.', 404);
  }

  const normalizedUserId = userId?.toString?.() || userId;
  const existingGeneratedMusic = await GeneratedMusic.findOne({
    userId: normalizedUserId,
    'generationMeta.audioStudioRequestId': requestId,
  }).lean();
  if (existingGeneratedMusic?.generationMeta?.durableMediaPersisted) {
    return buildStudioLibraryItem(existingGeneratedMusic);
  }

  const libraryType = normalizeAudioLibraryType(
    globalSession?.metadata?.libraryType ||
    statusPayload?.generation_type ||
    globalSession?.metadata?.generationType
  ) || AUDIO_LIBRARY_TYPE_SOUND_EFFECT;
  const generationType = libraryType === AUDIO_LIBRARY_TYPE_SOUND_EFFECT
    ? 'sound'
    : libraryType;
  const defaultTitle = libraryType === AUDIO_LIBRARY_TYPE_MUSIC
    ? 'Generated Music'
    : libraryType === AUDIO_LIBRARY_TYPE_SPEECH
      ? 'Generated Speech'
      : 'Generated Sound Effect';
  const title = normalizeString(globalSession?.metadata?.title) || defaultTitle;
  const prompt = normalizeString(globalSession?.metadata?.prompt);
  const durationValue = Number(globalSession?.metadata?.duration);
  let durableResultUrl = resultUrl;
  let durableMediaPersisted = false;
  try {
    durableResultUrl = await persistStudioGenerationAudio(userId, requestId, resultUrl);
    durableMediaPersisted = true;
  } catch (error) {
    console.error('Unable to persist generated Audio Studio media:', error);
  }
  const generationMeta = {
    audioStudioRequest: true,
    audioStudioRequestId: requestId,
    provider: statusPayload?.provider || null,
    model: statusPayload?.model || null,
    durableMediaPersisted,
    completedAt: globalSession?.metadata?.completedAt || new Date().toISOString(),
  };

  const generatedMusic = await GeneratedMusic.findOneAndUpdate(
    {
      userId: normalizedUserId,
      'generationMeta.audioStudioRequestId': requestId,
    },
    {
      $set: {
        userId: normalizedUserId,
        url: durableResultUrl,
        title,
        prompt,
        description: prompt,
        tags: ['audio-studio', libraryType],
        generationType,
        libraryType,
        ...(Number.isFinite(durationValue) && durationValue > 0
          ? { duration: durationValue }
          : {}),
        generationMeta,
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  return buildStudioLibraryItem(generatedMusic);
}

export async function getStudioAudioGenerationStatus(userId, requestId) {
  const normalizedRequestId = normalizeString(requestId);
  if (!normalizedRequestId) {
    throw buildAudioStudioError('requestId is required.');
  }

  const statusPayload = await getExternalAudioStatus({
    requestId: normalizedRequestId,
    userId,
  });
  const normalizedStatus = normalizeString(statusPayload?.status).toUpperCase();
  if (['COMPLETED', 'SUCCEEDED', 'SUCCESS', 'DONE'].includes(normalizedStatus)) {
    const item = await persistCompletedStudioGeneration(
      userId,
      normalizedRequestId,
      statusPayload
    );
    return { ...statusPayload, status: 'COMPLETED', item };
  }
  return statusPayload;
}

async function resolveValidatedJoinPayload(userId, payload = {}) {
  const {
    itemIds,
    parsedItemIds,
    requestedLibraryType,
    title,
    fadeAudioAtEnds,
  } = validateJoinAudioPayload(payload);
  const ownedItems = await resolveOwnedAudioItems(userId, parsedItemIds);
  const resolvedLibraryType = ownedItems[0]?.libraryType;
  if (!resolvedLibraryType || ownedItems.some((item) => item.libraryType !== resolvedLibraryType)) {
    throw buildAudioStudioError('Only audio items from the same category can be joined.');
  }
  if (requestedLibraryType && requestedLibraryType !== resolvedLibraryType) {
    throw buildAudioStudioError('The selected audio category does not match the chosen items.');
  }

  return {
    itemIds,
    ownedItems,
    resolvedLibraryType,
    title,
    fadeAudioAtEnds,
  };
}

async function performAudioStudioJoin(userId, payload = {}) {
  const {
    itemIds,
    ownedItems,
    resolvedLibraryType,
    title,
    fadeAudioAtEnds,
  } = await resolveValidatedJoinPayload(userId, payload);

  const tempDirectory = await fsPromises.mkdtemp(path.join(tmpdir(), 'samsar-audio-join-'));
  const outputPath = path.join(tempDirectory, 'joined.mp3');

  try {
    const inputPaths = [];
    for (let index = 0; index < ownedItems.length; index += 1) {
      inputPaths.push(await materializeAudioInput(
        ownedItems[index].audioPath,
        tempDirectory,
        index
      ));
    }

    await renderJoinedAudio(inputPaths, outputPath, { fadeAudioAtEnds });
    const duration = await getAudioDurationSeconds(outputPath);
    const url = await uploadAudioStudioMp3(outputPath, userId, 'joined');
    const typeLabel = resolvedLibraryType === AUDIO_LIBRARY_TYPE_MUSIC
      ? 'Music'
      : resolvedLibraryType === AUDIO_LIBRARY_TYPE_SPEECH
        ? 'Speech'
        : 'Sound Effects';
    const generatedMusic = await GeneratedMusic.create({
      userId: userId?.toString?.() || userId,
      url,
      title: title || `Joined ${typeLabel}`,
      prompt: '',
      description: `Joined ${ownedItems.length} ${typeLabel.toLowerCase()} items in Audio Studio.`,
      tags: ['audio-studio', 'joined', resolvedLibraryType],
      duration,
      generationType: 'joined_audio',
      libraryType: resolvedLibraryType,
      volume: 100,
      generationMeta: {
        audioStudioJoined: true,
        sourceItemIds: itemIds,
        sourceTitles: ownedItems.map((item) => item.title),
        fadeAudioAtEnds,
        durableMediaPersisted: true,
        joinedAt: new Date().toISOString(),
      },
    });

    return {
      item: buildStudioLibraryItem(generatedMusic),
      generatedMusicId: generatedMusic._id.toString(),
      joinedItemCount: ownedItems.length,
      metered: false,
    };
  } catch (error) {
    throw error;
  } finally {
    await fsPromises.rm(tempDirectory, { recursive: true, force: true }).catch(() => {});
  }
}

async function processAudioStudioJoinRequest(requestId) {
  await getDBConnectionString();
  const request = await AudioJoinRequest.findOneAndUpdate(
    { _id: requestId, status: 'PENDING' },
    {
      $set: {
        status: 'PROCESSING',
        claimedAt: new Date(),
        errorMessage: '',
      },
    },
    { new: true }
  ).lean();
  if (!request) return;

  try {
    const result = await performAudioStudioJoin(request.userId, {
      audioItemIds: request.audioItemIds,
      libraryType: request.libraryType,
      title: request.title,
      fadeAudioAtEnds: request.fadeAudioAtEnds,
    });
    await AudioJoinRequest.updateOne(
      { _id: requestId, status: 'PROCESSING' },
      {
        $set: {
          status: 'COMPLETED',
          generatedMusicId: result.generatedMusicId,
          completedAt: new Date(),
        },
      }
    );
  } catch (error) {
    console.error('Error processing Audio Studio join request:', error);
    await AudioJoinRequest.updateOne(
      { _id: requestId, status: 'PROCESSING' },
      {
        $set: {
          status: 'FAILED',
          errorMessage: normalizeString(error?.message).slice(0, 1000) ||
            'Unable to join the selected audio items.',
          completedAt: new Date(),
        },
      }
    );
  }
}

function scheduleAudioStudioJoinRequest(requestId) {
  const normalizedRequestId = requestId?.toString?.() || requestId;
  if (!normalizedRequestId || ACTIVE_AUDIO_JOIN_REQUESTS.has(normalizedRequestId)) return;
  ACTIVE_AUDIO_JOIN_REQUESTS.add(normalizedRequestId);
  setImmediate(async () => {
    try {
      await processAudioStudioJoinRequest(normalizedRequestId);
    } catch (error) {
      console.error('Unable to run Audio Studio join request:', error);
      await AudioJoinRequest.updateOne(
        { _id: normalizedRequestId, status: { $in: ['PENDING', 'PROCESSING'] } },
        {
          $set: {
            status: 'FAILED',
            errorMessage: 'Unable to process the audio join request.',
            completedAt: new Date(),
          },
        }
      ).catch(() => {});
    } finally {
      ACTIVE_AUDIO_JOIN_REQUESTS.delete(normalizedRequestId);
    }
  });
}

export async function requestAudioStudioJoin(userId, payload = {}) {
  await getDBConnectionString();
  const validated = await resolveValidatedJoinPayload(userId, payload);
  const request = await AudioJoinRequest.create({
    userId: userId?.toString?.() || userId,
    audioItemIds: validated.itemIds,
    libraryType: validated.resolvedLibraryType,
    title: validated.title,
    fadeAudioAtEnds: validated.fadeAudioAtEnds,
    status: 'PENDING',
  });
  scheduleAudioStudioJoinRequest(request._id);
  return {
    requestId: request._id.toString(),
    status: 'PENDING',
    joinedItemCount: validated.itemIds.length,
    metered: false,
  };
}

export async function getAudioStudioJoinStatus(userId, requestId) {
  await getDBConnectionString();
  const normalizedRequestId = normalizeString(requestId);
  if (!mongoose.Types.ObjectId.isValid(normalizedRequestId)) {
    throw buildAudioStudioError('Audio join request was not found.', 404, 'AUDIO_JOIN_NOT_FOUND');
  }
  const normalizedUserId = userId?.toString?.() || userId;
  let request = await AudioJoinRequest.findOne({
    _id: normalizedRequestId,
    userId: normalizedUserId,
  }).lean();
  if (!request) {
    throw buildAudioStudioError('Audio join request was not found.', 404, 'AUDIO_JOIN_NOT_FOUND');
  }

  const leaseExpired = request.status === 'PROCESSING' && request.claimedAt &&
    (Date.now() - new Date(request.claimedAt).getTime()) > AUDIO_JOIN_LEASE_TIMEOUT_MS;
  if (leaseExpired) {
    await AudioJoinRequest.updateOne(
      { _id: request._id, userId: normalizedUserId, status: 'PROCESSING', claimedAt: request.claimedAt },
      { $set: { status: 'PENDING', claimedAt: null } }
    );
    request = await AudioJoinRequest.findById(request._id).lean();
  }
  if (request.status === 'PENDING') {
    scheduleAudioStudioJoinRequest(request._id);
  }

  const response = {
    requestId: request._id.toString(),
    status: request.status,
    joinedItemCount: request.audioItemIds.length,
    fadeAudioAtEnds: Boolean(request.fadeAudioAtEnds),
    metered: false,
  };
  if (request.status === 'FAILED') {
    response.error = request.errorMessage || 'Unable to join the selected audio items.';
  }
  if (request.status === 'COMPLETED' && request.generatedMusicId) {
    const generatedMusic = await GeneratedMusic.findOne({
      _id: request.generatedMusicId,
      userId: normalizedUserId,
    }).lean();
    if (generatedMusic) {
      response.item = buildStudioLibraryItem(
        await ensureDurableAudioStudioMedia(generatedMusic)
      );
    }
  }
  return response;
}

export const __testOnly__ = Object.freeze({
  buildAudioStudioPlaybackUrl,
  buildJoinedAudioFilters,
  renderJoinedAudio,
  sortAudioStudioLibraryItemsByCreationDate,
});
