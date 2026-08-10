import {
  hasRequestInferenceAuthorization,
  hasRequestInferenceModel,
  resolveRequestInferenceAuthorization,
  resolveRequestInferenceSettings,
} from './RequestInferenceModel.js';
import User from '../schema/User.js';
import VideoSession from '../schema/VideoSession.js';

export function hasSessionInferenceModel(session = {}) {
  return Boolean(
    (typeof session.expressGenerationInferenceModel === 'string' && session.expressGenerationInferenceModel.trim()) ||
    (typeof session.inferenceModel === 'string' && session.inferenceModel.trim()) ||
    (typeof session.inference_model === 'string' && session.inference_model.trim()),
  );
}

export function hasSessionInferenceAuthorization(session = {}) {
  return Boolean(resolveRequestInferenceAuthorization({ session }));
}

function hasUserInferenceModel(user = {}) {
  return Boolean(
    (typeof user.selectedInferenceModel === 'string' && user.selectedInferenceModel.trim()) ||
    (typeof user.inferenceModel === 'string' && user.inferenceModel.trim()),
  );
}

function hasUserInferenceAuthorization(user = {}) {
  return Boolean(resolveRequestInferenceAuthorization({ user }));
}

function toPlainContextValue(value = {}) {
  return typeof value?.toObject === 'function' ? value.toObject() : value || {};
}

export async function resolveInferenceModelFromContext(inferenceContext = {}) {
  const request = inferenceContext?.request || inferenceContext?.payload || inferenceContext || {};
  let session = inferenceContext?.session || {};
  let user = inferenceContext?.user || {};

  if (!hasRequestInferenceModel(request) && !hasSessionInferenceModel(session)) {
    const sessionId = request.sessionId || request.videoSessionId;
    if (sessionId) {
      session = await VideoSession.findById(sessionId)
        .select('expressGenerationInferenceModel expressGenerationInferenceEffort inferenceModel inferenceEffort userId')
        .lean() || {};
    }
  }

  const userId = request.userId || session.userId;
  if (
    !hasRequestInferenceModel(request) &&
    !hasSessionInferenceModel(session) &&
    !user.selectedInferenceModel &&
    userId
  ) {
    user = await User.findById(userId)
      .select('selectedInferenceModel selectedInferenceEffort')
      .lean() || {};
  }

  return resolveRequestInferenceSettings({ request, session, user }).model;
}

export async function resolveInferenceSettingsFromContext(inferenceContext = {}) {
  const request = inferenceContext?.request || inferenceContext?.payload || inferenceContext || {};
  let session = toPlainContextValue(inferenceContext?.session);
  let user = toPlainContextValue(inferenceContext?.user);
  const hasRequestedModel = hasRequestInferenceModel(request);
  const hasRequestedAuthorization = hasRequestInferenceAuthorization(request);

  if (
    (!hasRequestedModel && !hasSessionInferenceModel(session)) ||
    (!hasRequestedAuthorization && !hasSessionInferenceAuthorization(session))
  ) {
    const sessionId = request.sessionId || request.videoSessionId;
    if (sessionId) {
      const fetchedSession = await VideoSession.findById(sessionId)
        .select([
          'expressGenerationInferenceModel',
          'expressGenerationInferenceEffort',
          'inferenceModel',
          'inferenceEffort',
          'expressGenerationInferenceModelAuthorization',
          'selectedInferenceModelAuthorization',
          'inferenceModelAuthorization',
          'userId',
        ].join(' '))
        .lean() || {};
      session = { ...fetchedSession, ...session };
    }
  }

  const userId = request.userId || session.userId;
  if (
    (
      (!hasRequestedModel && !hasSessionInferenceModel(session) && !hasUserInferenceModel(user)) ||
      (
        !hasRequestedAuthorization &&
        !hasSessionInferenceAuthorization(session) &&
        !hasUserInferenceAuthorization(user)
      )
    ) &&
    userId
  ) {
    const fetchedUser = await User.findById(userId)
      .select('selectedInferenceModel selectedInferenceEffort selectedInferenceModelAuthorization')
      .lean() || {};
    user = { ...fetchedUser, ...user };
  }

  return resolveRequestInferenceSettings({ request, session, user });
}
