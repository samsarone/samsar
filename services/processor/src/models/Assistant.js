import VideoSession from '../schema/VideoSession.js';
import AssistantQueryGeneration from '../schema/AssistantQueryGeneration.js';
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



  const sessionId = id;
  await getDBConnectionString();

  let sessionData = await assertVideoSessionEditableAccess(userId, {
    ...payload,
    sessionId,
  });
  if (!sessionData) {
    throw new Error('Session not found');
  }

  if (isSceneActionsCommand(normalizedQuery)) {
    return appendSceneActionsCommandResponse(sessionData, userMessageContent);
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


  let sessionMessages = sessionData.sessionMessages;
  
  const messageId = hat();
  const timestamp = new Date();
  if (!sessionMessages || sessionMessages.length === 0) {
    sessionMessages = [
      {
        role: 'user',
        content: userMessageContent,
        id: messageId,
        timestamp,
      }
    ]
  } else {
    sessionMessages.push({
      role: 'user',
      content: userMessageContent,
      id: messageId,
      timestamp,
    });
  
  }

  await VideoSession.updateOne({
    _id: sessionId
  }, {
    sessionMessages,
    sessionMessageGenerationPending: true,
    sessionMessageGenerationError: null,
  });

  const newAssistantQueryGeneration = new AssistantQueryGeneration({
    query: normalizedQuery,
    sessionId: sessionId,
    queryId: messageId,
    status: 'pending',
    inferenceModel: userAssistantModel,
    ...(modelSettings ? { modelSettings } : {}),
  });

  
  await newAssistantQueryGeneration.save();
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
      status: 'PENDING'
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

  const sessionData = await assertVideoSessionEditableAccess(userId, payload);
  if (!sessionData) {
    throw new Error('Session not found');
  }

  const sessionMessages = Array.isArray(sessionData.sessionMessages)
    ? sessionData.sessionMessages
    : [];
  const nextSessionMessages = sessionMessages.filter(
    (message) => String(message?.id || '') !== String(messageId)
  );

  await AssistantQueryGeneration.deleteMany({
    sessionId,
    queryId: String(messageId),
  });

  const hasPendingRequests = Boolean(
    await AssistantQueryGeneration.exists({ sessionId })
  );

  const updatedSession = await VideoSession.findOneAndUpdate(
    { _id: sessionId },
    {
      sessionMessages: nextSessionMessages,
      sessionMessageGenerationPending: hasPendingRequests,
      sessionMessageGenerationError: null,
    },
    { new: true }
  );

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

  const sessionData = await assertVideoSessionEditableAccess(userId, payload);
  if (!sessionData) {
    throw new Error('Session not found');
  }

  await AssistantQueryGeneration.deleteMany({ sessionId });

  const updatedSession = await VideoSession.findOneAndUpdate(
    { _id: sessionId },
    {
      sessionMessages: [],
      sessionMessageGenerationPending: false,
      sessionMessageGenerationError: null,
    },
    { new: true }
  );

  return {
    sessionDetails: updatedSession,
  };
}
