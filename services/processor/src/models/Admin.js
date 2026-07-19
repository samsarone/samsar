


import { getDBConnectionString } from './DBString.js';

import Session from '../schema/Session.js';
import  { Publication } from '../schema/Publication.js';
import InteractivePublication from '../schema/InteractivePublication.js';

import User from '../schema/User.js';
import ImageGeneration from '../schema/ImageGeneration.js';

import VideoSession from '../schema/VideoSession.js';
import { deletePublicPublicationMediaForSession } from './PublicationMedia.js';
import { deleteInteractivePublicationForSession } from './InteractivePublication.js';


export async function deleteAllRows() {
  // Implement the deleteAllRows function here
  await getDBConnectionString();

  const sessionData = await Session.deleteMany({});
  const publicationSessions = await Publication.find({}, { sessionId: 1 }).lean();
  const interactivePublicationSessions = await InteractivePublication.find(
    {},
    { sessionId: 1 },
  ).lean();
  const videoSessions = await VideoSession.find({}, { _id: 1 }).lean();
  const sessionIds = [...new Set(
    publicationSessions
      .map(({ sessionId }) => sessionId?.toString?.() || sessionId)
      .filter(Boolean)
  )];
  const interactiveSessionIds = [...new Set(
    interactivePublicationSessions
      .map(({ sessionId }) => sessionId?.toString?.() || sessionId)
      .filter(Boolean)
  )];
  const videoSessionIds = [...new Set(
    videoSessions
      .map(({ _id }) => _id?.toString?.() || _id)
      .filter(Boolean)
  )];
  const publicationMediaSessionIds = [...new Set([
    ...sessionIds,
    ...interactiveSessionIds,
    ...videoSessionIds,
  ])];
  await Promise.all(
    publicationMediaSessionIds.map((sessionId) => (
      deletePublicPublicationMediaForSession(sessionId)
    )),
  );
  const interactiveDeleteResults = await Promise.all(
    interactiveSessionIds.map((sessionId) => deleteInteractivePublicationForSession(sessionId))
  );
  const publicationData = await Publication.deleteMany({});
  const userData = await User.deleteMany({});
  const generationData = await ImageGeneration.deleteMany({});
  return {
    sessionData,
    publicationData,
    interactivePublicationData: {
      deletedCount: interactiveDeleteResults.filter((result) => result.deleted).length,
    },
    userData,
    generationData,
  };

}

export async function updateEpressGenerationStatus(payload) {
  const { status } = payload;

  await getDBConnectionString();
  try {
    // Update all items in the VideoSession collection, setting expressGenerationPending to false
    const result = await VideoSession.updateMany(
      { expressGenerationPending: true },
      { $set: { expressGenerationPending: false } }
    );

    return { success: true, updatedCount: result.nModified };
  } catch (error) {
    console.error('Error updating expressGenerationPending status:', error);
    return { success: false, error: error.message };
  }
}
