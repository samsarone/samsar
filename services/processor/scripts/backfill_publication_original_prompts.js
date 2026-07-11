import 'dotenv/config';
import mongoose from 'mongoose';

import { getDBConnectionString } from '../src/models/DBString.js';
import { resolvePublicationOriginalPrompt } from '../src/models/publication/Transcript.js';
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
  if (!Number.isFinite(parsed) || parsed < 1) return DEFAULT_BATCH_SIZE;
  return Math.min(parsed, MAX_BATCH_SIZE);
};

const normalizeString = (value) =>
  typeof value === 'string' ? value.trim() : '';

const objectIdForSession = (value) => {
  const normalized = value?.toString?.() || value;
  return typeof normalized === 'string' && mongoose.Types.ObjectId.isValid(normalized)
    ? new mongoose.Types.ObjectId(normalized)
    : null;
};

const isMissingOriginalPrompt = (publication) =>
  !normalizeString(publication?.originalPrompt);

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
        {
          projection: {
            _id: 1,
            inputPrompt: 1,
            expressInputPrompt: 1,
            promptList: 1,
            promptlist: 1,
          },
        }
      ).toArray()
    : [];
  const sessionsById = new Map(sessions.map((session) => [session._id.toString(), session]));
  const operations = [];
  const result = {
    scanned: publications.length,
    eligible: 0,
    invalidSessionId: 0,
    sessionNotFound: 0,
    sourcePromptMissing: 0,
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
    const originalPrompt = resolvePublicationOriginalPrompt({}, session);
    if (!originalPrompt) {
      result.sourcePromptMissing += 1;
      continue;
    }

    result.eligible += 1;
    const originalPromptFilter = Object.prototype.hasOwnProperty.call(publication, 'originalPrompt')
      ? { originalPrompt: publication.originalPrompt }
      : { originalPrompt: { $exists: false } };
    operations.push({
      updateOne: {
        filter: {
          _id: publication._id,
          ...originalPromptFilter,
        },
        update: { $set: { originalPrompt } },
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
  for (const key of Object.keys(target)) target[key] += source[key] || 0;
};

async function loadMissingPublications() {
  const publications = await Publication.collection.find(
    {},
    { projection: { _id: 1, sessionId: 1, originalPrompt: 1 } }
  ).toArray();
  return publications.filter(isMissingOriginalPrompt);
}

async function main() {
  if (process.env.CURRENT_ENV !== 'production') {
    throw new Error('Refusing to run: CURRENT_ENV must be production.');
  }

  const apply = hasFlag('apply');
  const batchSize = parseBatchSize();
  await getDBConnectionString();

  const totalPublications = await Publication.collection.countDocuments({});
  const missingPublications = await loadMissingPublications();
  const totals = {
    scanned: 0,
    eligible: 0,
    invalidSessionId: 0,
    sessionNotFound: 0,
    sourcePromptMissing: 0,
    updated: 0,
  };

  for (let offset = 0; offset < missingPublications.length; offset += batchSize) {
    const batch = missingPublications.slice(offset, offset + batchSize);
    addCounts(totals, await processBatch(batch, apply));
  }

  const missingAfter = (await loadMissingPublications()).length;
  console.log(JSON.stringify({
    mode: apply ? 'apply' : 'dry-run',
    environment: process.env.CURRENT_ENV,
    batchSize,
    totalPublications,
    populatedBefore: totalPublications - missingPublications.length,
    missingBefore: missingPublications.length,
    missingAfter,
    ...totals,
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
