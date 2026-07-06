import { getDBConnectionString } from './DBString.js';
import { requestQuickMovieGeneration } from './movie_session/TranscriptMovieGenerator.js';


export async function createMovieGenSession(userId, payload) {
  const { screenplay , sessionId, aspectRatio } = payload;
  
  await getDBConnectionString();

  
  
  const session = await requestQuickMovieGeneration(userId, payload);
  return session;
}
