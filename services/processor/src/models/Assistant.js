import AssistantWorkspace from '../schema/AssistantWorkspace.js';
import { assertAssistantWorkspaceAccess } from './AssistantWorkspace.js';
import { normalizeAssistantContext } from '../utils/AssistantContext.js';
import { createHash } from 'node:crypto';
import VideoSession from '../schema/VideoSession.js';
import AssistantQueryGeneration from '../schema/AssistantQueryGeneration.js';
import AssistantBillingRequest from '../schema/AssistantBillingRequest.js';
import User from '../schema/User.js';
import { getDBConnectionString } from './DBString.js';
import { assertVideoSessionEditableAccess } from './VideoSession.js';

import hat from 'hat';
import {
  appendSceneActionsCommandResponse,
  isSceneActionsCommand,
} from './SceneActions.js';
import { normalizeInferenceModel } from '../consts/InferenceModels.js';
import { shouldBypassGenerationCredits } from '../utils/EnvironmentUtils.js';

function normalizeAssistantQueryText(query) {
  return typeof query === 'string' ? query.trim() : '';
}

function normalizeAssistantFrameImage(frameImage) {
  const dataUrl = typeof frameImage?.dataUrl === 'string' ? frameImage.dataUrl.trim() : '';
  if (!dataUrl.startsWith('data:image/')) {
    return null;
  }

  return {
    dataUrl,
    mimeType: typeof frameImage?.mimeType === 'string' ? frameImage.mimeType : 'image/png',
  };
}

function buildAssistantUserMessageContent(query, frameImage) {
  const normalizedQuery = normalizeAssistantQueryText(query);
  const normalizedFrameImage = normalizeAssistantFrameImage(frameImage);

  if (!normalizedFrameImage) {
    return normalizedQuery;
  }

  const content = [];
  if (normalizedQuery) {
    content.push({
      type: 'input_text',
      text: normalizedQuery,
    });
  }

  content.push({
    type: 'input_image',
    image_url: normalizedFrameImage.dataUrl,
  });

  return content;
}

const ASSISTANT_MODEL_SETTING_ALIASES = Object.freeze({
  model: 'model',
  providerModel: 'providerModel',
  provider_model: 'providerModel',
  vertexModel: 'vertexModel',
  geminiModel: 'model',
  gemini_model: 'model',
  googleModel: 'model',
  google_model: 'model',
  google_gemini_model: 'model',
  vertex_model: 'vertexModel',
  location: 'location',
  geminiLocation: 'location',
  googleGeminiLocation: 'location',
  vertexLocation: 'location',
  google_gemini_location: 'location',
  vertex_location: 'location',
  temperature: 'temperature',
  top_p: 'top_p',
  topP: 'topP',
  max_tokens: 'max_tokens',
  max_output_tokens: 'max_output_tokens',
  maxOutputTokens: 'maxOutputTokens',
  max_completion_tokens: 'max_completion_tokens',
  thinking_level: 'thinking_level',
  thinkingLevel: 'thinkingLevel',
  effort: 'effort',
  reasoning_effort: 'reasoning_effort',
  reasoningEffort: 'reasoningEffort',
});

function normalizeModelSettingValue(value) {
  if (typeof value === 'string') {
    return value.trim() || undefined;
  }

  if (value === null || value === undefined) {
    return undefined;
  }

  return value;
}

function mergeAssistantModelSettings(target, source) {
  if (!source || typeof source !== 'object' || Array.isArray(source)) {
    return;
  }

  for (const [sourceKey, targetKey] of Object.entries(ASSISTANT_MODEL_SETTING_ALIASES)) {
    if (!Object.prototype.hasOwnProperty.call(source, sourceKey)) {
      continue;
    }

    const value = normalizeModelSettingValue(source[sourceKey]);
    if (value !== undefined) {
      target[targetKey] = value;
    }
  }

  const reasoningEffort = normalizeModelSettingValue(source.reasoning?.effort);
  if (reasoningEffort !== undefined) {
    target.reasoning = { effort: reasoningEffort };
  }

  const thinkingLevel = normalizeModelSettingValue(
    source.thinkingConfig?.thinkingLevel ?? source.thinkingConfig?.thinking_level
  );
  if (thinkingLevel !== undefined) {
    target.thinkingLevel = thinkingLevel;
  }
}

function buildAssistantModelSettings(payload = {}) {
  const modelSettings = {};
  mergeAssistantModelSettings(modelSettings, payload.modelSettings);
  mergeAssistantModelSettings(modelSettings, payload.assistantModelSettings);
  mergeAssistantModelSettings(modelSettings, payload.geminiSettings);
  mergeAssistantModelSettings(modelSettings, payload.gemini);
  mergeAssistantModelSettings(modelSettings, payload.generationConfig);
  mergeAssistantModelSettings(modelSettings, payload.generation_config);
  mergeAssistantModelSettings(modelSettings, payload.modelConfig);
  mergeAssistantModelSettings(modelSettings, payload.model_config);
  mergeAssistantModelSettings(modelSettings, payload.custom_settings);
  mergeAssistantModelSettings(modelSettings, payload.customSettings);
  mergeAssistantModelSettings(modelSettings, payload);

  return Object.keys(modelSettings).length ? modelSettings : null;
}

export async function createAssistantQueryRequest(userId, payload) {

  const { id, query, frameImage } = payload;
  const normalizedQuery = normalizeAssistantQueryText(query);
  const userMessageContent = buildAssistantUserMessageContent(normalizedQuery, frameImage);
  const modelSettings = buildAssistantModelSettings(payload);
  const assistantContext = normalizeAssistantContext(payload.assistantContext);



  const sessionId = id;
  await getDBConnectionString();

  const Session = payload.workspace ? AssistantWorkspace : VideoSession;
  let sessionData = await assertAssistantConversationAccess(userId, {
    ...payload,
    sessionId,
  });
  if (!sessionData) {
    throw new Error('Session not found');
  }

  if (payload.assistantSessionVersion !== undefined &&
    payload.assistantSessionVersion !== (sessionData.assistantSessionVersion || 0)) {
    throw Object.assign(new Error('Assistant session was cleared. Please send your message again.'), { status: 409 });
  }

  if (!payload.workspace && isSceneActionsCommand(normalizedQuery)) {
    return appendSceneActionsCommandResponse(sessionData, userMessageContent);
  }

  const clientRequestId = payload.client_request_id || payload.clientRequestId;
  if (clientRequestId && (typeof clientRequestId !== 'string' || clientRequestId.length > 512)) {
    throw Object.assign(new Error('Invalid assistant request key.'), { status: 400 });
  }
  const assistantSessionVersion = sessionData.assistantSessionVersion || 0;
  const messageId = clientRequestId ? createHash('sha256')
    .update(`${userId}:${sessionId}:${assistantSessionVersion}:${clientRequestId}`).digest('hex').slice(0, 32) : hat();
  const requestFingerprint = createHash('sha256').update(JSON.stringify({ query: normalizedQuery, frameImage, modelSettings, ...(assistantContext ? { assistantContext } : {}), ...(payload.workspace ? { workspace: payload.workspace } : {}) })).digest('hex');
  const previous = sessionData.sessionMessages?.find(message => message.role === 'user' && message.id === messageId);
  if (previous) {
    if (previous.requestFingerprint !== requestFingerprint) throw Object.assign(new Error('Request key was already used for a different message.'), { status: 409 });
    const hasReply = sessionData.sessionMessages.some(message => message.role === 'assistant' && message.id === messageId);
    if (!hasReply && sessionData.sessionMessageGenerationPending && previous.assistantRequest) {
      await saveAssistantQueueMessage({ ...previous.assistantRequest, sessionId, queryId: messageId, assistantSessionVersion, query: normalizedQuery });
    }
    return { queryId: messageId, status: !hasReply && sessionData.sessionMessageGenerationPending ? 'PENDING' : 'COMPLETED', sessionDetails: sessionData };
  }

  const userData = await User.findOne({ _id:
    userId
  });
  if (!userData) {
    throw new Error('User not found');
  }
  const userAssistantModel = normalizeInferenceModel(userData?.selectedAssistantModel);
  if (!shouldBypassGenerationCredits() && (!Number.isFinite(userData.generationCredits) || userData.generationCredits <= 0)) {
    const error = new Error('Insufficient credits');
    error.code = 'INSUFFICIENT_CREDITS';
    throw error;
  }


  const timestamp = new Date();
  const assistantRequest = { inferenceModel: userAssistantModel, stream: payload.stream === true, modelSettings, ...(assistantContext ? { assistantContext } : {}), ...(payload.workspace ? { sessionStore: "workspace" } : {}) };
  // Append atomically: an older submit must never restore cleared history.
  const appended = await Session.updateOne({
    _id: sessionId,
    ...assistantVersionFilter(assistantSessionVersion),
    $nor: [{ sessionMessages: { $elemMatch: { role: 'user', id: messageId } } }],
  }, {
    $push: { sessionMessages: { role: 'user', content: userMessageContent, id: messageId, timestamp, requestFingerprint, assistantRequest } },
    $set: { sessionMessageGenerationPending: true, sessionMessageGenerationError: null,
      assistantStream: { queryId: messageId, sessionVersion: assistantSessionVersion, status: 'queued', text: '', sequence: 0 } },
  });
  if (!appended.matchedCount) {
    const current = await Session.findOne({ _id: sessionId });
    const duplicate = current?.sessionMessages?.find(message => message.role === 'user' && message.id === messageId);
    if (duplicate?.requestFingerprint === requestFingerprint) {
      if (current.sessionMessageGenerationPending && duplicate.assistantRequest) await saveAssistantQueueMessage({
        ...duplicate.assistantRequest, sessionId, queryId: messageId, assistantSessionVersion, query: normalizedQuery,
      });
      return { queryId: messageId, status: current.sessionMessageGenerationPending ? 'PENDING' : 'COMPLETED', sessionDetails: current };
    }
    throw Object.assign(new Error('Assistant session was cleared. Please send your message again.'), { status: 409 });
  }

  const newAssistantQueryGeneration = await saveAssistantQueueMessage({
    ...assistantRequest, query: normalizedQuery, sessionId, queryId: messageId, assistantSessionVersion,
  });
  // Reset can happen between appending the message and saving the queue row.
  if (!await Session.exists({ _id: sessionId, ...assistantVersionFilter(assistantSessionVersion) })) {
    await AssistantQueryGeneration.deleteOne({ _id: newAssistantQueryGeneration._id });
  }
  return newAssistantQueryGeneration;

}

export async function getAssistantQueryGenerationStatus(sessionId) {
  await getDBConnectionString();

  if (!sessionId) {
    throw new Error('Session ID is required');
  }
  if (sessionId.length !== 24) {
    throw new Error('Invalid session ID format');
  }
  

  let sessionQueryResponse;

  try {
   sessionQueryResponse = await VideoSession.findOne({
    _id: sessionId
  });
} catch (error) {
  console.error("Error fetching session data:", error);
  return;
}

  
  if (!sessionQueryResponse) {
    throw new Error('Session not found');
  }

  if (sessionQueryResponse.sessionMessageGenerationPending) {
    return {
      status: 'PENDING',
      assistantStream: sessionQueryResponse.assistantStream || null,
      assistantSessionVersion: sessionQueryResponse.assistantSessionVersion || 0
    }
  } else {
    return {
      status: 'COMPLETED',
      sessionDetails: sessionQueryResponse
    }
  }

}

export async function deleteAssistantSessionMessage(userId, payload = {}) {
  const sessionId = payload.id;
  const messageId = payload.messageId;

  await getDBConnectionString();

  if (!sessionId) {
    throw new Error('Session ID is required');
  }
  if (sessionId.length !== 24) {
    throw new Error('Invalid session ID format');
  }
  if (!messageId) {
    throw new Error('Message ID is required');
  }

  const Session = payload.workspace ? AssistantWorkspace : VideoSession;
  const sessionData = await assertAssistantConversationAccess(userId, payload);
  if (!sessionData) {
    throw new Error('Session not found');
  }

  await AssistantQueryGeneration.deleteMany({
    sessionId,
    queryId: String(messageId),
  });

  const hasPendingRequests = Boolean(
    await AssistantQueryGeneration.exists({ sessionId, status: { $ne: 'reconciliation_required' } })
  );

  const updatedSession = await Session.findOneAndUpdate(
    { _id: sessionId, ...assistantVersionFilter(sessionData.assistantSessionVersion || 0) },
    {
      $pull: { sessionMessages: { id: String(messageId) } },
      $set: {
        ...(sessionData.assistantStream?.queryId === String(messageId) ? { assistantStream: null } : {}),
        sessionMessageGenerationPending: hasPendingRequests,
        sessionMessageGenerationError: null,
      },
    },
    { new: true }
  );
  if (!updatedSession) {
    throw Object.assign(new Error('Assistant session was cleared. Please refresh the conversation.'), { status: 409 });
  }

  return {
    sessionDetails: updatedSession,
  };
}

export async function resetAssistantSessionMessages(userId, payload = {}) {
  const sessionId = payload.id;

  await getDBConnectionString();

  if (!sessionId) {
    throw new Error('Session ID is required');
  }
  if (sessionId.length !== 24) {
    throw new Error('Invalid session ID format');
  }

  const Session = payload.workspace ? AssistantWorkspace : VideoSession;
  const sessionData = await assertAssistantConversationAccess(userId, payload);
  if (!sessionData) {
    throw new Error('Session not found');
  }

  // Invalidate active workers before removing old queue rows. New requests use
  // the incremented version and survive cleanup even when submitted concurrently.
  const updatedSession = await Session.findOneAndUpdate(
    { _id: sessionId },
    {
      $set: {
        sessionMessages: [],
        assistantStream: null,
        sessionMessageGenerationPending: false,
        sessionMessageGenerationError: null,
      },
      $inc: { assistantSessionVersion: 1 },
    },
    { new: true }
  );
  await AssistantQueryGeneration.deleteMany({
    sessionId,
    $or: [
      { assistantSessionVersion: { $lt: updatedSession.assistantSessionVersion } },
      { assistantSessionVersion: { $exists: false } },
    ],
  });

  // Older workers kept completed replies in billing receipts as well. Keep
  // usage/debit records, but remove those duplicate conversation payloads.
  await AssistantBillingRequest.updateMany({
    scope: 'queued_assistant', 'context.sessionId': sessionId, status: 'COMPLETED',
  }, { $unset: { providerResponse: '', result: '', errorMessage: '' } });

  return { sessionDetails: updatedSession };
}

function assistantVersionFilter(version) {
  return version === 0
    ? { $or: [{ assistantSessionVersion: 0 }, { assistantSessionVersion: { $exists: false } }] }
    : { assistantSessionVersion: version };
}


export async function getAssistantStreamSnapshot(userId, payload = {}) {
  if (!/^[a-f0-9]{24}$/i.test(payload.id || '')) {
    throw Object.assign(new Error('Invalid session ID.'), { status: 400 });
  }
  // Recheck shared-edit access on each snapshot, including after reconnects.
  const session = await assertAssistantConversationAccess(userId, payload, { markEdited: false });
  return {
    sessionId: String(session._id),
    assistantSessionVersion: session.assistantSessionVersion || 0,
    // Streaming history needs attachment markers, never repeated base64 image bytes.
    sessionMessages: (session.sessionMessages || []).map(({ assistantRequest, ...message }) => ({
      ...message, content: stripAssistantStreamMedia(message.content),
    })),
    sessionMessageGenerationPending: Boolean(session.sessionMessageGenerationPending),
    sessionMessageGenerationError: session.sessionMessageGenerationError || null,
    assistantStream: session.assistantStream || null,
  };
}


async function saveAssistantQueueMessage(data) {
  const request = new AssistantQueryGeneration({ ...data, _id: data.queryId.slice(0, 24), status: 'pending' });
  try { await request.save(); } catch (error) { if (error.code !== 11000) throw error; }
  return request;
}

function stripAssistantStreamMedia(content) {
  if (Array.isArray(content)) return content.map(stripAssistantStreamMedia);
  if (!content || typeof content !== 'object') return content;
  if (['image_url', 'input_image'].includes(content.type)) return { type: content.type };
  return { ...content, ...(content.content ? { content: stripAssistantStreamMedia(content.content) } : {}) };
}

async function assertAssistantConversationAccess(userId, payload, options) {
  if (payload.workspace) return assertAssistantWorkspaceAccess(userId, payload);
  return assertVideoSessionEditableAccess(userId, payload, options);
}
