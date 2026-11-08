import mongoose from 'mongoose';
import { getDatabase } from './DBString.js';

const QUEUE_COLLECTIONS = [
  'framegenerations',
  'videogenerations',
  'audiogenerations',
  'aivideolayergenerations',
];

const ACTIVITY_FIELDS = [
  'expressGenerationPending', 'videoGenerationPending', 'frameGenerationPending',
  'framesGenerationPending', 'audioGenerationPending', 'transcriptGenerationPending',
  'aiVideoGenerationPending', 'aiVideoFrameGenerationPending', 'lipSyncGenerationPending',
  'soundEffectGenerationPending', 'narratorAvatarGenerationPending',
  'userVideoGenerationPending', 'videoEditPending', 'maskGenerationPending',
  'isFrameGenerating',
  'framesGenerationStatus', 'frameGenerationStatus',
];

const SESSION_PROJECTION = {
  _id: 1,
  updatedAt: 1,
  createdAt: 1,
  isGuestSession: 1,
  isIntroSession: 1,
  expressGenerationPending: 1,
  videoGenerationPending: 1,
  frameGenerationPending: 1,
  framesGenerationPending: 1,
  expressGenerationFailed: 1,
  videoGenerationFailed: 1,
  frameGenerationFailed: 1,
  expressGenerationStatus: 1,
  videoGenerationStatus: 1,
  videoLink: 1,
  remoteURL: 1,
  ...Object.fromEntries(ACTIVITY_FIELDS.flatMap((flag) => [
    [flag, 1],
    [`layers.${flag}`, 1],
    [`branchRenderPaths.${flag}`, 1],
    [`branchRenderPaths.timeline.${flag}`, 1],
    [`global_videos.${flag}`, 1],
    [`globalVideos.${flag}`, 1],
  ])),
};

export function createFrameCleanupStateLoader({ database = getDatabase } = {}) {
  return async function loadSessionState(sessionId) {
    if (typeof sessionId !== 'string' || !/^[a-f0-9]{24}$/i.test(sessionId)) {
      throw new Error('Frame cleanup requires a valid session identifier.');
    }
    const db = await database();
    const objectId = new mongoose.Types.ObjectId(sessionId);
    const session = await db.collection('videosessions').findOne(
      { _id: objectId },
      { projection: SESSION_PROJECTION },
    );
    if (!session) return { session: null, hasActiveJobs: false };

    const identifiers = [...new Set([sessionId, sessionId.toLowerCase()]), objectId];
    const queueFilter = {
      $or: [
        { sessionId: { $in: identifiers } },
        // Final video jobs use videoSessionId, unlike frame/audio/AI jobs.
        { videoSessionId: { $in: identifiers } },
      ],
    };
    for (const name of QUEUE_COLLECTIONS) {
      if (await db.collection(name).findOne(queueFilter, { projection: { _id: 1 } })) {
        return { session, hasActiveJobs: true };
      }
    }
    return { session, hasActiveJobs: false };
  };
}
