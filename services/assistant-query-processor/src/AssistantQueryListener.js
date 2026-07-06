import { getDBConnectionString } from './DBConnection.js';
import VideoSession from './schema/VideoSession.js';
import AssistantQueryGeneration from './schema/AssistantQueryGeneration.js';
import { sendAssistantCompletionRequest } from './OpenAI.js';
import { getSystemPrompt } from './SystemPrompt.js';
import User from './schema/User.js'; // Import the User model
import {
  calculateAssistantCreditsFromUsage,
  calculateLegacyAssistantCredits,
} from './AssistantBilling.js';
import { isGeminiInferenceModel, normalizeInferenceModel } from './InferenceModels.js';

export async function listenToAssistantQueryRequests() {
  while (true) {
    await getTimeout(1000);

    try {
      await getDBConnectionString();
      await processPendingAssistantRequests();
    } catch (error) {
      console.error('[assistant-query-processor] Worker loop failed:', error);
    }
  }
}

async function processPendingAssistantRequests() {

  const pendingRequests = await AssistantQueryGeneration.find({ rowLocked: false });


  for (const request of pendingRequests) {

    
    const { sessionId, query, queryId } = request;
    const inferenceModel = getAssistantRequestInferenceModel(request.inferenceModel);

    // Lock the row to prevent concurrent processing
    await AssistantQueryGeneration.updateOne({ _id: request._id }, { rowLocked: true });

    let sessionData = null;

    try {
      // Fetch the session data
      sessionData = await VideoSession.findOne({ _id: sessionId });
      if (!sessionData) {
        throw new Error('Session not found');
      }

      // Fetch the user data
      let userData = await User.findOne({ _id: sessionData.userId });
      if (!userData) {
        throw new Error('User not found');
      }

      let sessionMessages = sessionData.sessionMessages;

      // Prepare the payload for the assistant, including the system prompt and session messages

   
      const sessionMessagesWithRoles = sessionMessages.map(function(message) {
        let messageRole = message.role;


        const retObject = {
          role: messageRole,
          content: message.content,
        }


        return retObject;


      });

      

      const systemPromptObject = getSystemPrompt(inferenceModel, userData.assistantSystemPrompt);





      const oaiPayload = [
        systemPromptObject,
        ...sessionMessagesWithRoles,
      ];
      const assistantAuthorization = getAssistantModelAuthorization(userData, request);
      const completionOptions = {
        ...(request.modelSettings && typeof request.modelSettings === 'object' && !Array.isArray(request.modelSettings)
          ? request.modelSettings
          : {}),
        authorization: assistantAuthorization,
      };

      // Send the assistant message request to OpenAI
      const messageResponse = await sendAssistantCompletionRequest(
        oaiPayload,
        inferenceModel,
        completionOptions,
      );
      const messageContent = messageResponse.outputText || '';
      const [activeRequest, latestSessionData] = await Promise.all([
        AssistantQueryGeneration.findOne({ _id: request._id }),
        VideoSession.findOne({ _id: sessionId }),
      ]);

      const linkedUserMessage = latestSessionData?.sessionMessages
        ?.slice?.()
        ?.reverse?.()
        ?.find((message) => message.role === 'user' && message.id === queryId);

      if (!activeRequest || !latestSessionData || !linkedUserMessage) {
        await AssistantQueryGeneration.deleteOne({ _id: request._id });
        continue;
      }

      sessionData = latestSessionData;
      sessionMessages = Array.isArray(sessionData.sessionMessages)
        ? sessionData.sessionMessages
        : [];

      let creditsNeeded = 0;
      if (!isDockerRuntime()) {
        const billing =
          calculateAssistantCreditsFromUsage({
            model: messageResponse?.response?.model || messageResponse?.model,
            usage: messageResponse?.response?.usage,
          });
        creditsNeeded =
          billing.credits ||
          calculateLegacyAssistantCredits({
            inputMessages: oaiPayload,
            outputText: messageContent,
            inferenceModel,
          });

        // Check if the user has enough credits
        if (userData.generationCredits >= creditsNeeded) {
          // Deduct the required credits
          userData.generationCredits -= creditsNeeded;
        } else {
          // Delete the current pending request to prevent reprocessing
          await AssistantQueryGeneration.deleteOne({ _id: request._id });

          throw new Error('Not enough credits for assistant query');
        }

        // Save updated user data
        await userData.save();
      }

      // Update the session with the new assistant message
      sessionData.sessionMessages.push({
        role: 'assistant',
        content:
          Array.isArray(messageResponse.outputContent) && messageResponse.outputContent.length > 0
            ? messageResponse.outputContent
            : messageContent,
        id: linkedUserMessage.id,
        timestamp: new Date(),
        openaiResponseId: messageResponse?.response?.id || null,
        model: messageResponse?.response?.model || messageResponse?.model || null,
        usage: messageResponse?.response?.usage || null,
        creditsCharged: creditsNeeded,
      });

      sessionData.sessionMessageGenerationPending = false;
      sessionData.sessionMessageGenerationError = null;

      // Save the updated session data
      await sessionData.save();

      // Delete the current pending request as it has been processed
      await AssistantQueryGeneration.deleteOne({ _id: request._id });
    } catch (e) {
      console.error(e);

      if (sessionData) {
        sessionData.sessionMessageGenerationPending = false;
        sessionData.sessionMessageGenerationError = e?.message || 'Assistant query failed';
        await sessionData.save();
      }

      // Delete the current pending request to prevent reprocessing in case of error
      await AssistantQueryGeneration.deleteOne({ _id: request._id });
    }
  }
}

function getAssistantRequestInferenceModel(inferenceModel) {
  if (isGeminiInferenceModel(inferenceModel)) {
    return typeof inferenceModel === 'string' && inferenceModel.trim()
      ? inferenceModel.trim()
      : normalizeInferenceModel(inferenceModel);
  }

  return normalizeInferenceModel(inferenceModel);
}

function normalizeAuthorization(value) {
  return typeof value === 'string' && value.trim()
    ? value.trim().toLowerCase().replace(/[_\s]+/g, '-')
    : '';
}

function getAssistantModelAuthorization(userData = {}, request = {}) {
  const modelSettings = request?.modelSettings && typeof request.modelSettings === 'object'
    ? request.modelSettings
    : {};
  const authorization = normalizeAuthorization(
    modelSettings.authorization ||
    modelSettings.modelAuthorization ||
    modelSettings.assistantModelAuthorization ||
    modelSettings.selectedAssistantModelAuthorization ||
    userData?.selectedAssistantModelAuthorization
  );

  return authorization || 'native';
}

function isDockerRuntime() {
  return typeof process.env.CURRENT_ENV === 'string' &&
    process.env.CURRENT_ENV.trim().toLowerCase() === 'docker';
}

async function getTimeout(timeout = 1000) {
  return new Promise((resolve) => {
    setTimeout(resolve, timeout);
  });
}
