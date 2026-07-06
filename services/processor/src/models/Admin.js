


import { getDBConnectionString } from './DBString.js';

import Session from '../schema/Session.js';
import  { Publication } from '../schema/Publication.js';

import User from '../schema/User.js';
import ImageGeneration from '../schema/ImageGeneration.js';

import VideoSession from '../schema/VideoSession.js';


export async function deleteAllRows() {
  // Implement the deleteAllRows function here
 await getDBConnectionString();

  const sessionData = await Session.deleteMany({});
  const publicationData = await Publication.deleteMany({});
  const userData = await User.deleteMany({});
  const generationData = await ImageGeneration.deleteMany({});
  return {sessionData, publicationData, userData, generationData};

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
