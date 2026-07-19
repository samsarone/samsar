



import OpenAI from "openai";
import crypto from "crypto";

const API_KEY = process.env.OPENAI_API_KEY;

import { z } from "zod";
import { zodResponseFormat } from "openai/helpers/zod";
import {
  GPT_56_SOL_REASONING_EFFORT,
  createGoogleGeminiChatCompletion,
  getDefaultInferenceModel,
  isGeminiInferenceModel,
  isQwenInferenceModel,
  normalizeInferenceModel,
} from '../../ai_utils/GoogleGemini.js';
import { createCompatibleChatCompletion } from '../../ai_utils/OpenAICompat.js';
import { createQwenChatCompletion } from '../../ai_utils/Qwen.js';
import {
  createSamsarExternalChatCompletion,
  resolveConfiguredInferenceProvider,
  shouldUseSamsarExternalInference,
} from '../../ai_utils/SamsarExternalInferenceAdapter.js';
import { recordProviderUsageLog } from '../../utils/ProviderUsageAudit.js';
import { formatBranchedCameraTransitionContext } from '../utils/BranchedCameraTransitions.js';

const openai = new OpenAI({ apiKey: API_KEY || '' });

const RESPONSES_ONLY_MODELS = new Set([
  'gpt-5.6-sol',
]);
const DEFAULT_GEMINI_REASONING_EFFORT = 'high';

function getAuditHash(value) {
  try {
    return crypto
      .createHash('sha1')
      .update(JSON.stringify(value))
      .digest('hex')
      .slice(0, 12);
  } catch {
    return `${Date.now()}`;
  }
}

async function recordInferenceProviderUsage({
  basePayload,
  provider,
  response,
  auditContext = {},
  reasoningEffort,
}) {
  const requestType = auditContext.requestType || 'narrative_inference';
  const providerRequestId =
    response?.id ||
    response?.data?.id ||
    response?.response?.id ||
    '';
  const localRequestId =
    auditContext.localRequestId ||
    auditContext.layerId ||
    auditContext.audioLayerId ||
    auditContext.sessionId;

  await recordProviderUsageLog({
    payload: auditContext,
    userId: auditContext.userId,
    sessionId: auditContext.sessionId,
    layerId: auditContext.layerId,
    audioLayerId: auditContext.audioLayerId,
    localRequestId,
    providerRequestId,
    idempotencyKey: [
      'samsar_express_video_listener',
      localRequestId,
      requestType,
      provider,
      basePayload?.model,
      providerRequestId || getAuditHash(basePayload),
      Date.now(),
    ].filter(Boolean).join(':'),
    requestType,
    callType: requestType,
    provider,
    model: basePayload?.model,
    source: auditContext.source || 'express_video_inference',
    service: 'samsar_express_video_listener',
    status: 'requested',
    metadata: {
      messageCount: Array.isArray(basePayload?.messages) ? basePayload.messages.length : undefined,
      reasoningEffort: reasoningEffort || basePayload?.reasoning_effort,
      sourceTask: auditContext.sourceTask,
    },
  });
}

function normalizeAssistantText(responseData) {
  return typeof responseData?.content === 'string' ? responseData.content : '';
}

const textWordCustomAnimations = [
  'bleeding',
  'glowing',
  'throbbing',
  'shimmering',
  'wobbling',
  'rising',
  'none'
];




export async function createTextToVideoPromptFromLayerPrompt(startingPrompt, startingImageDescription,
  endingImageDescription, userInferenceModel = getDefaultInferenceModel(), useShortFormPrompt = true, indexData, videoTone = 'cinematic', auditContext = {}) {

  const { isStartScene, isEndScene } = indexData;

  let userPrompt = `Scene action: ${startingPrompt}`;

  if (startingImageDescription) {
    userPrompt += `\n Starting frame description: ${startingImageDescription}`;
  }

  if (endingImageDescription) {
    userPrompt += `\n Ending frame description: ${endingImageDescription}`;
  }

  const promptLength = '4-5 lines maximum 500-600 characters';

  let systemPrompt;

  if (videoTone === 'grounded') {

    systemPrompt = `
You are a filmmaking assistant for a grounded image-to-video generation tool.
Create a concise prompt in ${promptLength} for a smooth transition from the starting frame to the ending frame.
• Use simple, realistic motion and basic camera movement.
• Base motion on the starting frame, scene action, and image descriptions.
• Preserve existing characters, props, text, and context; do not add new elements, anachronisms, or non-English text.
• Use generic character descriptors and plain language.
• Output only the finished prompt text, with no prefix or commentary.
`;



  } else {

    systemPrompt = `You are a filmmaking assistant for an image-to-video generation tool.
Create a concise prompt in ${promptLength} that transitions from the starting frame to the ending frame.
Use the scene action and frame descriptions to guide camera movement, subject motion, and continuity.
Do not introduce new characters, props, text, or out-of-context elements.
Use generic descriptors and plain language.
Output only the finished prompt text, with no prefix or commentary.
`;
  }

  if (isStartScene) {
    systemPrompt +=
      `Since this is the first scene, begin with a brief establishing camera shot or an introduction to the environment.
Emphasize how the camera enters or focuses on the setting to start the scene.`;
  }

  systemPrompt += getMotionContinuityInstruction(indexData);



  const messageList = [
    {
      "role": "developer",
      "content": systemPrompt
    },
    {
      "role": "user",
      "content": userPrompt
    },

  ];

  try {
    const responseData = await sendAssistantMessageRequest(messageList, userInferenceModel, undefined, {
      ...auditContext,
      sourceTask: auditContext.sourceTask || 'text_to_video_prompt',
    });


    return responseData.content;
  } catch (err) {
    return null;
  }
}


function getTextToVideoSystemPromptForStartingLayerPrompt(videoTone, promptLength) {

  let systemPrompt;



  systemPrompt = `You are a filmmaking assistant for an image-to-video generation tool.
Create a concise prompt in ${promptLength} that animates the starting frame according to the scene action and camera transition.
Use the starting frame description to guide subject motion, camera movement, and scene continuity.
Do not introduce new characters, props, text, or out-of-context elements.
Use generic descriptors and plain language.
Output only the finished prompt text, with no prefix or commentary.
`;

  if (videoTone === 'grounded') {
    systemPrompt = `
You are a filmmaking assistant for a grounded image-to-video generation tool.
Create a concise prompt in ${promptLength} that animates the starting frame according to the scene action.
Use minimal camera movement and realistic, physics-aware subject/object motion.
Preserve existing characters, objects, text, diagrams, and context; do not add, remove, duplicate, or distort elements.
Show the requested action in the correct scene context with coherent world interaction.
`;

  }


  systemPrompt +=
    `Use generic terms for people and avoid names, places, brands, or IP.
Use clear, everyday language.
Do not add extra text or infographics beyond what is already present in the starting image.
Output only the finished prompt text, without any prefix or commentary.`;

  return systemPrompt;

}

function getMotionContinuityInstruction(indexData = {}) {
  const { isStartScene = false, isEndScene = false } = indexData;

  if (isStartScene && isEndScene) {
    return `\nTreat this as a self-contained shot: let motion begin naturally from the starting frame and resolve cleanly within the scene.`;
  }

  if (isStartScene) {
    return `\nTreat this as the opening shot: let motion emerge naturally from the starting frame and ease into the action.`;
  }

  if (isEndScene) {
    return `\nTreat this as the closing shot: let motion resolve naturally and finish cleanly without introducing a new action beat.`;
  }

  return `\nTreat this as a continuation shot: preserve motion continuity across camera, subjects, and layered elements, and avoid opening on a static hold unless the scene prompt explicitly calls for stillness.`;
}


export async function createTextToVideoPromptFromStartingLayerPrompt(
  startingPrompt,
  startingImageDescription,
  userInferenceModel = getDefaultInferenceModel(),
  useShortFormPrompt = true,
  isSpeakerTransition = false,
  indexData,
  videoTone = 'grounded',
  cameraTransitionLayer = null,
  reasoningEffort,
  auditContext = {}
) {
  const { isStartScene, isEndScene } = indexData;




  const promptLength = '4-5 lines maximum 500-600 characters';

  let userPrompt = `Scene action: ${startingPrompt}`;
  if (startingImageDescription) {
    userPrompt += `\n Starting frame description: ${startingImageDescription}`;
  }

  let systemPrompt = getTextToVideoSystemPromptForStartingLayerPrompt(
    videoTone,
    promptLength
  );

  systemPrompt += getMotionContinuityInstruction(indexData);



  if (cameraTransitionLayer) {
    systemPrompt += `\nUse the provided camera transition as a guide for the camera movement.`;
    userPrompt += `\nCamera transition: ${cameraTransitionLayer}`;
  }


  const baseMessages = [
    { role: 'developer', content: systemPrompt },
    { role: 'user', content: userPrompt }
  ];

  const MAX_CHARS = 900;
  const MAX_RETRIES = 3;

  try {
    let attempt = 0;
    let responseData;

    // Clone the base messages so we can append extra system notes on retries
    const messageList = [...baseMessages];

    while (attempt < MAX_RETRIES) {
      responseData = await sendAssistantMessageRequest(
        messageList,
        userInferenceModel,
        reasoningEffort,
        {
          ...auditContext,
          sourceTask: auditContext.sourceTask || 'text_to_video_prompt',
        }
      );

      if (!responseData?.content) return null;



      if (responseData.content.length <= MAX_CHARS) {


        return responseData.content;
      }

      // Instruct the model to shorten the next answer
      messageList.push({
        role: 'system',
        content: `Your previous reply was ${responseData.content.length} characters. Please rewrite it in ≤${MAX_CHARS} characters without losing essential detail.`
      });

      attempt += 1;
    }

    // All attempts exceeded the limit
    return null;
  } catch (err) {
    return null;
  }
}



export async function getTransitionListForLayerSceneDescriptions(layerSceneDescriptions, userInferenceModel = getDefaultInferenceModel(), auditContext = {}) {


  const layerSceneDescriptionsString = layerSceneDescriptions.join('\n\n');



  const systemPrompt = `You are a camera transition assistant tool for a generative video production tool.
  Provided a list of scenes as their starting frame description , give a short 1 line camera transition movement for each scene.
  The transitions should follow smoothly as a professional camera man would do to create a professional cinematic video.
  Prefer natural, stable camera movement unless the scene explicitly requests stylized motion.
  Give one transition for each scene, the output should be a list of transitions, each in a newline, each transition should be a single line description of the camera movement without any line numbers or formatting strings.`;


  const messageList = [
    {
      "role": "system",
      "content": systemPrompt
    },
    {
      "role": "user",
      "content": layerSceneDescriptionsString
    }
  ];



  try {
    const responseData = await sendAssistantMessageRequest(messageList, userInferenceModel, undefined, {
      ...auditContext,
      sourceTask: auditContext.sourceTask || 'camera_transition_prompt',
    });
    return normalizeAssistantText(responseData);
  }
  catch (err) {
    console.warn('[AIVideoPrompt][transition_list] Falling back without camera transitions', {
      inferenceModel: normalizeInferenceModel(userInferenceModel),
      error: err?.message,
    });
    return '';
  }



}

export async function getCameraTransitionForBranchedScene(
  previousScenes,
  currentSceneDescription,
  userInferenceModel = getDefaultInferenceModel(),
  auditContext = {},
) {
  const systemPrompt = `You are a camera transition assistant tool for a generative video production tool.
  Provided the starting frame descriptions and camera transitions for the previous scenes in the current branch path, plus the current scene starting frame description, give a short 1 line camera transition movement for the current scene.
  The transition should follow smoothly as a professional camera man would do to create a professional cinematic video.
  Prefer natural, stable camera movement unless the scene explicitly requests stylized motion.
  Give one transition for the current scene. The output should be a single line description of the camera movement without any line numbers or formatting strings.`;

  const messageList = [
    {
      role: 'system',
      content: systemPrompt,
    },
    {
      role: 'user',
      content: formatBranchedCameraTransitionContext({
        previousScenes,
        currentSceneDescription,
      }),
    },
  ];

  try {
    const responseData = await sendAssistantMessageRequest(
      messageList,
      userInferenceModel,
      undefined,
      {
        ...auditContext,
        sourceTask: auditContext.sourceTask || 'camera_transition_prompt',
      },
    );
    const transitionLines = normalizeAssistantText(responseData)
      .split('\n')
      .map((item) => item.trim())
      .filter(Boolean);
    return transitionLines.length === 1 ? transitionLines[0] : '';
  } catch (err) {
    console.warn('[AIVideoPrompt][branched_transition] Falling back without a camera transition', {
      inferenceModel: normalizeInferenceModel(userInferenceModel),
      layerId: auditContext.layerId,
      branchPathId: auditContext.branchPathId,
      error: err?.message,
    });
    return '';
  }
}

export async function getAccentForText(text, auditContext = {}) {

  const textAnimationOptions = textWordCustomAnimations.join(', ');
  const systemPrompt = `You are a subtitle and transctiption assistant for a video production tool.
   Given a text prompt, determine the accent that best suits the emotion of the text from a list of accents.
  Here is the list of possible accents ${textAnimationOptions}.
  Provide the accent as a single word response.`;

  const messageList = [
    {
      "role": "system",
      "content": systemPrompt
    },
    {
      "role": "user",
      "content": text
    },

  ];

  try {
    const inferenceModel = normalizeInferenceModel(
      auditContext.inferenceModel || getDefaultInferenceModel()
    );
    const responseData = await sendAssistantMessageRequest(messageList, inferenceModel, undefined, {
      ...auditContext,
      requestType: auditContext.requestType || 'subtitle_accent_inference',
      sourceTask: auditContext.sourceTask || 'subtitle_accent',
    });

    return responseData.content;
  } catch (err) {
    return null;
  }
}

export async function sendAssistantMessageRequest(messageList, userInferenceModel = getDefaultInferenceModel(), reasoningEffort, auditContext = {}) {

  const modelName = getModelNameForInferenceModel(userInferenceModel);

  try {
    const selectedInferenceModelAuthorization =
      auditContext.selectedInferenceModelAuthorization ||
      auditContext.inferenceModelAuthorization ||
      auditContext.authorization;
    const basePayload = {
      model: modelName,
      messages: messageList,
      ...(selectedInferenceModelAuthorization
        ? { authorization: selectedInferenceModelAuthorization }
        : {}),
      ...(!isGeminiInferenceModel(modelName) && !isQwenInferenceModel(modelName)
        ? { reasoning_effort: GPT_56_SOL_REASONING_EFFORT }
        : reasoningEffort
          ? (!isQwenInferenceModel(modelName) ? { reasoning_effort: reasoningEffort } : {})
          : {}),
    };
    if (shouldUseSamsarExternalInference(basePayload)) {
      const response = await createSamsarExternalChatCompletion(basePayload);
      await recordInferenceProviderUsage({
        basePayload,
        provider: resolveConfiguredInferenceProvider(modelName) || 'samsar',
        response,
        auditContext,
        reasoningEffort,
      });
      return response.choices[0].message;
    }

    if (isGeminiInferenceModel(modelName)) {
      const geminiPayload = {
        model: modelName,
        messages: messageList,
        reasoning_effort: reasoningEffort || DEFAULT_GEMINI_REASONING_EFFORT,
      };
      const response = await createGoogleGeminiChatCompletion(geminiPayload);
      await recordInferenceProviderUsage({
        basePayload: geminiPayload,
        provider: 'googleCloud',
        response,
        auditContext,
        reasoningEffort: reasoningEffort || DEFAULT_GEMINI_REASONING_EFFORT,
      });
      return response.choices[0].message;
    }

    if (isQwenInferenceModel(modelName)) {
      const response = await createQwenChatCompletion(basePayload);
      await recordInferenceProviderUsage({
        basePayload,
        provider: 'alibabaCloud',
        response,
        auditContext,
        reasoningEffort,
      });
      return response.choices[0].message;
    }

    if (isResponsesOnlyModel(modelName)) {
      const body = {
        model: modelName,
        input: normalizeMessagesForResponses(messageList),
      };

      body.reasoning = { effort: GPT_56_SOL_REASONING_EFFORT };

      const responsesResponse = await openai.post('/responses', {
        body,
      });
      await recordInferenceProviderUsage({
        basePayload,
        provider: 'openai',
        response: responsesResponse,
        auditContext,
        reasoningEffort: GPT_56_SOL_REASONING_EFFORT,
      });
      const outputText = extractResponsesOutputText(responsesResponse);
      return { role: 'assistant', content: outputText ?? '' };
    }
    const chatPayload = {
      messages: messageList,
      model: modelName,
    };
    const response = await openai.chat.completions.create(chatPayload);
    await recordInferenceProviderUsage({
      basePayload: chatPayload,
      provider: 'openai',
      response,
      auditContext,
      reasoningEffort,
    });
    const resData = response.choices[0].message;

    return resData;
  } catch (error) {
    const isGeminiModel = isGeminiInferenceModel(modelName);
    const isQwenModel = isQwenInferenceModel(modelName);
    console.error('[Inference][sendAssistantMessageRequest] request failed', {
      provider: isQwenModel ? 'alibaba_qwen' : isGeminiModel ? 'google_gemini' : 'openai',
      inferenceModel: userInferenceModel,
      model: modelName,
      messageCount: Array.isArray(messageList) ? messageList.length : 0,
      error: {
        message: error?.message,
        status: error?.status,
        code: error?.code,
        type: error?.type,
      },
    });
    let errorString = 'An error occurred while sending the message. Please try again with a different message.'
    throw new Error(errorString);
  }

}


export async function sendAssistantStructuredMessageRequest(
  messageList,
  userInferenceModel = getDefaultInferenceModel(),
  auditContext = {},
) {


  const ScreenplayTransitionExtraction = z.object({
    useEndFrame: z.boolean()
  });

  try {
    const modelName = getModelNameForInferenceModel(userInferenceModel || getDefaultInferenceModel());
    const selectedInferenceModelAuthorization =
      auditContext.selectedInferenceModelAuthorization ||
      auditContext.inferenceModelAuthorization ||
      auditContext.authorization;
    const payload = {
      messages: messageList,
      model: modelName,
      response_format: zodResponseFormat(ScreenplayTransitionExtraction, "screenplay_transition_extraction"),
      ...(selectedInferenceModelAuthorization
        ? { authorization: selectedInferenceModelAuthorization }
        : {}),
    };
    const response = await createCompatibleChatCompletion(openai, payload);
    const messageContent = response.choices[0].message.content;

    const parsedMessage = JSON.parse(messageContent);

    return parsedMessage;
  } catch (error) {


    throw new Error('An error occurred while sending the message. Please try again.');
  }
}

function getModelNameForInferenceModel(userInferenceModel) {
  return normalizeInferenceModel(userInferenceModel);
}

function isResponsesOnlyModel(model) {
  return typeof model === 'string' && RESPONSES_ONLY_MODELS.has(model);
}

function normalizeMessagesForResponses(messages) {
  if (!Array.isArray(messages)) {
    return [];
  }

  return messages.map((message) => {
    if (!message || typeof message !== 'object') {
      return message;
    }

    if (message.role === 'system') {
      return { ...message, role: 'developer' };
    }

    return message;
  });
}

function extractResponsesOutputText(response) {
  if (!response || typeof response !== 'object') {
    return '';
  }

  if (typeof response.output_text === 'string') {
    return response.output_text;
  }

  const output = response.output;
  if (!Array.isArray(output)) {
    return '';
  }

  const texts = [];
  for (const item of output) {
    if (!item || typeof item !== 'object' || item.type !== 'message') {
      continue;
    }
    const contentList = item.content;
    if (!Array.isArray(contentList)) {
      continue;
    }
    for (const content of contentList) {
      if (!content || typeof content !== 'object') {
        continue;
      }
      if (content.type === 'output_text' && typeof content.text === 'string') {
        texts.push(content.text);
      }
    }
  }

  return texts.join('');
}
