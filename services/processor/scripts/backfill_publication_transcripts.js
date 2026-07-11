import 'dotenv/config';
import mongoose from 'mongoose';

import { getDBConnectionString } from '../src/models/DBString.js';
import { normalizePublicationTranscript } from '../src/models/publication/Transcript.js';
import { Publication } from '../src/schema/Publication.js';
import VideoSession from '../src/schema/VideoSession.js';

const DEFAULT_BATCH_SIZE = 200;
const MAX_BATCH_SIZE = 1000;

const hasFlag = (name) => process.argv.includes(`--${name}`);

const getArgValue = (name, fallback = '') => {
  const prefix = `--${name}=`;
  const argument = process.argv.find((value) => value.startsWith(prefix));
  return argument ? argument.slice(prefix.length).trim() : fallback;
};

const parseBatchSize = () => {
  const parsed = Number.parseInt(getArgValue('batch-size', `${DEFAULT_BATCH_SIZE}`), 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return DEFAULT_BATCH_SIZE;
  }
  return Math.min(parsed, MAX_BATCH_SIZE);
};

const missingTranscriptQuery = {
  $or: [
    { sessionTranscript: { $exists: false } },
    { sessionTranscript: null },
  ],
};

const objectIdForSession = (value) => {
  const normalized = value?.toString?.() || value;
  return typeof normalized === 'string' && mongoose.Types.ObjectId.isValid(normalized)
    ? new mongoose.Types.ObjectId(normalized)
    : null;
};

const processBatch = async (publications, apply) => {
  const sessionIds = Array.from(
    new Map(
      publications
        .map((publication) => objectIdForSession(publication.sessionId))
        .filter(Boolean)
        .map((id) => [id.toString(), id])
    ).values()
  );

  const sessions = sessionIds.length > 0
    ? await VideoSession.collection.find(
        { _id: { $in: sessionIds } },
        { projection: { _id: 1, movieResourceList: 1 } }
      ).toArray()
    : [];
  const sessionsById = new Map(sessions.map((session) => [session._id.toString(), session]));
  const operations = [];
  const result = {
    scanned: publications.length,
    eligible: 0,
    invalidSessionId: 0,
    sessionNotFound: 0,
    emptyTranscript: 0,
    updated: 0,
  };

  for (const publication of publications) {
    const sessionId = objectIdForSession(publication.sessionId);
    if (!sessionId) {
      result.invalidSessionId += 1;
      continue;
    }

    const session = sessionsById.get(sessionId.toString());
    if (!session) {
      result.sessionNotFound += 1;
      continue;
    }

    const sessionTranscript = normalizePublicationTranscript(session.movieResourceList);
    if (sessionTranscript.scenes.length === 0 && sessionTranscript.sounds.length === 0) {
      result.emptyTranscript += 1;
    }

    result.eligible += 1;
    operations.push({
      updateOne: {
        filter: { _id: publication._id, ...missingTranscriptQuery },
        update: { $set: { sessionTranscript } },
      },
    });
  }

  if (apply && operations.length > 0) {
    const writeResult = await Publication.collection.bulkWrite(operations, { ordered: false });
    result.updated = writeResult.modifiedCount;
  }

  return result;
};

const addCounts = (target, source) => {
  for (const key of Object.keys(target)) {
    target[key] += source[key] || 0;
  }
};

const hasOnlyKeys = (record, allowedKeys) =>
  record && typeof record === 'object' && !Array.isArray(record) &&
  Object.keys(record).every((key) => allowedKeys.has(key));

const auditPublicationTranscripts = async () => {
  const audit = {
    present: 0,
    invalidShape: 0,
    empty: 0,
    containsOriginalPrompt: 0,
    unexpectedTopLevelFields: 0,
    unexpectedSceneFields: 0,
    unexpectedSoundFields: 0,
    nonSpeechSounds: 0,
  };
  const topLevelKeys = new Set(['scenes', 'sounds']);
  const sceneKeys = new Set(['scene_index', 'type', 'visual', 'speaker']);
  const soundKeys = new Set(['type', 'sub_type', 'scene_index', 'speaker', 'text']);
  const cursor = Publication.collection.find(
    { sessionTranscript: { $exists: true, $ne: null } },
    { projection: { sessionTranscript: 1 } }
  );

  for await (const publication of cursor) {
    audit.present += 1;
    const transcript = publication.sessionTranscript;
    if (
      !transcript || typeof transcript !== 'object' || Array.isArray(transcript) ||
      !Array.isArray(transcript.scenes) || !Array.isArray(transcript.sounds)
    ) {
      audit.invalidShape += 1;
      continue;
    }
    if (transcript.scenes.length === 0 && transcript.sounds.length === 0) {
      audit.empty += 1;
    }
    if ('original_prompt' in transcript || 'originalPrompt' in transcript) {
      audit.containsOriginalPrompt += 1;
    }
    if (!hasOnlyKeys(transcript, topLevelKeys)) {
      audit.unexpectedTopLevelFields += 1;
    }
    audit.unexpectedSceneFields += transcript.scenes.filter(
      (scene) => !hasOnlyKeys(scene, sceneKeys)
    ).length;
    audit.unexpectedSoundFields += transcript.sounds.filter(
      (sound) => !hasOnlyKeys(sound, soundKeys)
    ).length;
    audit.nonSpeechSounds += transcript.sounds.filter(
      (sound) => sound?.type !== 'speech'
    ).length;
  }

  return audit;
};

async function main() {
  if (process.env.CURRENT_ENV !== 'production') {
    throw new Error('Refusing to run: CURRENT_ENV must be production.');
  }

  const apply = hasFlag('apply');
  const batchSize = parseBatchSize();
  await getDBConnectionString();

  const [totalPublications, missingBefore] = await Promise.all([
    Publication.collection.countDocuments({}),
    Publication.collection.countDocuments(missingTranscriptQuery),
  ]);
  const totals = {
    scanned: 0,
    eligible: 0,
    invalidSessionId: 0,
    sessionNotFound: 0,
    emptyTranscript: 0,
    updated: 0,
  };

  const cursor = Publication.collection.find(missingTranscriptQuery, {
    projection: { _id: 1, sessionId: 1 },
    sort: { _id: 1 },
  });
  let batch = [];

  for await (const publication of cursor) {
    batch.push(publication);
    if (batch.length < batchSize) {
      continue;
    }
    addCounts(totals, await processBatch(batch, apply));
    batch = [];
  }

  if (batch.length > 0) {
    addCounts(totals, await processBatch(batch, apply));
  }

  const missingAfter = await Publication.collection.countDocuments(missingTranscriptQuery);
  const transcriptAudit = await auditPublicationTranscripts();
  console.log(JSON.stringify({
    mode: apply ? 'apply' : 'dry-run',
    environment: process.env.CURRENT_ENV,
    batchSize,
    totalPublications,
    missingBefore,
    missingAfter,
    ...totals,
    transcriptAudit,
  }, null, 2));
}

main()
  .catch((error) => {
    console.error(JSON.stringify({
      status: 'failed',
      message: error?.message || String(error),
    }));
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect().catch(() => undefined);
  });
