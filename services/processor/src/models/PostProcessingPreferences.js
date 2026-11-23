import { Types } from 'mongoose';
import VideoSession from '../schema/VideoSession.js';
import { getDBConnectionString } from './DBString.js';

export const POST_PROCESSING_PREFERENCE_KEYS = Object.freeze([
  'translationEnableSubtitles', 'translationTranslateOutro', 'translationTranslateFooter',
]);

export function normalizePostProcessingPreferences(value) {
  return Object.fromEntries(POST_PROCESSING_PREFERENCE_KEYS.map((key) => [key, value?.[key] === true]));
}

export async function updatePostProcessingPreferences(userId, payload = {}) {
  if (!userId) throw Object.assign(new Error('Unauthorized.'), { status: 401 });
  const sessionId = typeof payload.sessionId === 'string' ? payload.sessionId.trim() : '';
  if (!Types.ObjectId.isValid(sessionId)) {
    throw Object.assign(new Error('sessionId must be a valid video session id.'), { status: 400 });
  }
  const preferences = payload.preferences;
  if (!preferences || typeof preferences !== 'object' || Array.isArray(preferences) ||
      Object.keys(preferences).length === 0 || Object.keys(preferences).some((key) =>
        !POST_PROCESSING_PREFERENCE_KEYS.includes(key) || typeof preferences[key] !== 'boolean')) {
    throw Object.assign(new Error('preferences must contain supported post-processing boolean options.'), { status: 400 });
  }

  const fields = Object.fromEntries(Object.entries(preferences)
    .map(([key, value]) => [`postProcessingPreferences.${key}`, value]));
  await getDBConnectionString();
  const session = await VideoSession.findOneAndUpdate(
    { _id: sessionId, userId: userId.toString() },
    { $set: fields },
    { new: true, projection: { postProcessingPreferences: 1 } },
  ).lean();
  if (!session) throw Object.assign(new Error('Video session not found.'), { status: 404 });
  return { sessionId, postProcessingPreferences: normalizePostProcessingPreferences(session.postProcessingPreferences) };
}
