



import OpenAI from "openai";
import crypto from "crypto";

import { z } from "zod";
import { zodResponseFormat } from "openai/helpers/zod";
import {
  GPT_56_SOL_REASONING_EFFORT,
  createGoogleGeminiChatCompletion,
  isGeminiInferenceModel,
  isQwenInferenceModel,
  normalizeInferenceModel,
} from './GoogleGemini.js';
import { createAlibabaQwenChatCompletion } from './AlibabaQwen.js';
import { recordProviderUsageLog } from './ProviderUsageAudit.js';
import {
  createSamsarExternalChatCompletion,
  resolveConfiguredInferenceProvider,
  shouldUseSamsarExternalInference,
} from './SamsarExternalInferenceAdapter.js';

let openaiClient = null;
let openaiClientApiKey = '';

function getOpenAIClient() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is required for native OpenAI inference.');
  }
  if (!openaiClient || openaiClientApiKey !== apiKey) {
    openaiClient = new OpenAI({ apiKey });
    openaiClientApiKey = apiKey;
  }
  return openaiClient;
}

const RESPONSES_ONLY_MODELS = new Set([
  'gpt-5.6-sol',
]);

function getAuditHash(value) {
  try {
    return crypto.createHash('sha1').update(JSON.stringify(value)).digest('hex').slice(0, 12);
  } catch {
    return `${Date.now()}`;
  }
}

async function recordInferenceProviderUsage({
  messageList,
  modelName,
  provider,
  response,
  auditContext = {},
}) {
  const requestType = auditContext.requestType || 'narrative_inference';
  const localRequestId =
    auditContext.localRequestId ||
    auditContext.layerId ||
    auditContext.sessionId;
  const providerRequestId = response?.id || response?.data?.id || '';

  await recordProviderUsageLog({
    payload: auditContext,
    userId: auditContext.userId,
    sessionId: auditContext.sessionId,
    layerId: auditContext.layerId,
    localRequestId,
    providerRequestId,
    idempotencyKey: [
      'samsar_ai_video_layer_generator',
      localRequestId,
      requestType,
      provider,
      modelName,
      providerRequestId || getAuditHash(messageList),
      Date.now(),
    ].filter(Boolean).join(':'),
    requestType,
    callType: requestType,
    provider,
    model: modelName,
    source: auditContext.source || 'ai_video_inference',
    service: 'samsar_ai_video_layer_generator',
    status: 'requested',
    metadata: {
      messageCount: Array.isArray(messageList) ? messageList.length : undefined,
      sourceTask: auditContext.sourceTask,
    },
  });
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
  endingImageDescription, userInferenceModel = 'gpt-5.6-sol', useShortFormPrompt = true, indexData, videoTone = 'grounded', auditContext = {}) {

  const { isStartScene, isEndScene } = indexData;

  let userPrompt = `Scene action: ${startingPrompt}`;

  if (startingImageDescription) {
    userPrompt += `\n Starting frame description: ${startingImageDescription}`;
  }

  if (endingImageDescription) {
    userPrompt += `\n Ending frame description: ${endingImageDescription}`;
  }

  let promptLength;
  if (useShortFormPrompt) {
    promptLength = '2-3 lines maximum 250-300 characters,';
  } else {
    promptLength = '4-5 lines maximum 500-600 characters';
  }

  let systemPrompt;

  if (videoTone === 'grounded') {

    systemPrompt = `
You are a filmmaking assistant for a generative video tool that produces **simple, grounded, educational** animations.

Write a **system prompt** of no more than ${promptLength} words that tells the model how to create a smooth transition beginning from the starting frame.

• Use only basic, straightforward camera moves and transitions—no advanced or flashy techniques.  
• Base every action on the starting frame (e.g., “character walks toward camera”) so the motion feels natural and coherent.  
• Do **not** add new characters, props, or anachronistic objects; preserve strict historical and contextual accuracy.  
• If helpful, repeat key thematic words from the scene prompt, but never introduce anything out of place.  
• Refer to characters with generic descriptors (“teacher,” “mechanic”)—omit names, places, trademarks, or copyrighted terms.  
• Use clear, everyday language; avoid technical jargon or complicated vocabulary.  
• Output *only* the finished system prompt text—no prefixes like “Prompt:” or extra commentary.
`;



  } else {

    systemPrompt = `You are a filmmaking assistant for a generative video tool.
Given the scene prompt and the descriptions for the starting and ending frames, 
create a concise text-to-video prompt in ${promptLength} that effectively transitions between the described frames.
Use the provided Starting frame description to guide character movements with reference to the camera (e.g., moving toward or away) and ensure the transition is smooth and coherent.
Ensure to add instructions to not introduce any new characters or elements in the scene.
Do not introduce any new or out-of-place objects, people, items, or anachronistic elements; maintain strict period and contextual accuracy based on the scene prompt and image descriptions.
Ensure that the transition is in accordance with the contextual details provided in the scene prompt.
Consider contextual and historical accuracy when transitioning between the scenes.
Use the starting image, ending image, and scene prompt to determine the transition and action, including any relevant keywords to reinforce the theme if needed.
Refer to characters using general descriptors; avoid specific names, descriptions, locations, proper nouns, copyrighted material, or trademarks.
Use simple language and avoid complicated terminology.
Provide the prompt directly without any prefixes like 'Prompt:'.
`;
  }

  if (isStartScene) {
    systemPrompt +=
      `Since this is the first scene, begin with a brief establishing camera shot or an introduction to the environment.
Emphasize how the camera enters or focuses on the setting to start the scene.`;
  }




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
    const responseData = await sendAssistantMessageRequest(messageList, userInferenceModel, auditContext);


    return responseData.content;
  } catch (err) {
    return null;
  }
}


function getTextToVideoSystemPromptForStartingLayerPrompt(videoTone, promptLength) {
  let systemPrompt = `You are a filmmaking assistant for an image-to-video generation tool.
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

  systemPrompt += `Use generic terms for people and avoid names, places, brands, or IP.
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
  userInferenceModel = 'gpt-5.6-sol',
  useShortFormPrompt = true,
  isSpeakerTransition = false,
  indexData,
  videoTone = 'grounded',
  cameraTransitionLayer = null,
  auditContext = {}
) {
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



export async function getTransitionListForLayerSceneDescriptions(layerSceneDescriptions, userInferenceModel = 'gpt-5.6-sol', auditContext = {}) {

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
    const responseData = await sendAssistantMessageRequest(messageList, userInferenceModel, {
      ...auditContext,
      sourceTask: auditContext.sourceTask || 'camera_transition_prompt',
    });
    return responseData.content;
  }
  catch (err) {
    return null;
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
    const inferenceModel = auditContext.inferenceModel ||
      process.env.USER_INFERENCE_MODEL ||
      process.env.DEFAULT_USER_INFERENCE_MODEL ||
      'gpt-5.6-sol';
    const responseData = await sendAssistantMessageRequest(messageList, inferenceModel, auditContext);

    return responseData.content;
  } catch (err) {
    return null;
  }
}

export async function sendAssistantMessageRequest(messageList, userInferenceModel = 'gpt-5.6-sol', auditContext = {}) {


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
    };

    if (shouldUseSamsarExternalInference(basePayload)) {
      const response = await createSamsarExternalChatCompletion(basePayload);
      await recordInferenceProviderUsage({
        messageList,
        modelName,
        provider: resolveConfiguredInferenceProvider(modelName) || 'samsar',
        response,
        auditContext,
      });
      return response.choices[0].message;
    }

    if (isGeminiInferenceModel(modelName)) {
      const response = await createGoogleGeminiChatCompletion(messageList);
      await recordInferenceProviderUsage({
        messageList,
        modelName,
        provider: 'googleCloud',
        response,
        auditContext,
      });
      return response;
    }

    if (isQwenInferenceModel(modelName)) {
      const response = await createAlibabaQwenChatCompletion(basePayload);
      await recordInferenceProviderUsage({
        messageList,
        modelName: response?.model || modelName,
        provider: 'alibabaCloud',
        response,
        auditContext,
      });
      return response.choices[0].message;
    }

    if (RESPONSES_ONLY_MODELS.has(modelName)) {
      const response = await getOpenAIClient().post('/responses', {
        body: {
          model: modelName,
          input: normalizeMessagesForResponses(messageList),
          reasoning: { effort: GPT_56_SOL_REASONING_EFFORT },
        },
      });
      await recordInferenceProviderUsage({
        messageList,
        modelName,
        provider: 'openai',
        response,
        auditContext,
      });
      return {
        role: 'assistant',
        content: extractResponsesOutputText(response),
      };
    }

    const response = await getOpenAIClient().chat.completions.create({
      messages: messageList,
      model: modelName,
    });
    await recordInferenceProviderUsage({
      messageList,
      modelName,
      provider: 'openai',
      response,
      auditContext,
    });
    return response.choices[0].message;
  } catch (error) {
    let errorString = 'An error occurred while sending the message. Please try again with a different message.'
    throw new Error(errorString);
  }

}


export async function sendAssistantStructuredMessageRequest(
  messageList,
  userInferenceModel = 'gpt-5.6-sol',
  auditContext = {},
) {


  const ScreenplayTransitionExtraction = z.object({
    useEndFrame: z.boolean()
  });

  try {
    const selectedInferenceModel = normalizeInferenceModel(userInferenceModel);
    const selectedInferenceModelAuthorization =
      auditContext.selectedInferenceModelAuthorization ||
      auditContext.inferenceModelAuthorization ||
      auditContext.authorization;
    const payload = {
      messages: messageList,
      model: isQwenInferenceModel(selectedInferenceModel)
        ? selectedInferenceModel
        : "gpt-4o-2024-11-20",
      response_format: zodResponseFormat(ScreenplayTransitionExtraction, "screenplay_transition_extraction"),
      ...(selectedInferenceModelAuthorization
        ? { authorization: selectedInferenceModelAuthorization }
        : {}),
    };
    const { authorization: _authorization, ...nativePayload } = payload;
    let response;
    if (shouldUseSamsarExternalInference(payload)) {
      response = await createSamsarExternalChatCompletion(payload);
    } else if (isQwenInferenceModel(payload.model)) {
      response = await createAlibabaQwenChatCompletion(payload);
    } else {
      response = await getOpenAIClient().chat.completions.create(nativePayload);
    }
    const messageContent = response.choices[0].message.content;

    const parsedMessage = JSON.parse(messageContent);

    return parsedMessage;
  } catch (error) {


    console.error(error);
    throw new Error('An error occurred while sending the message. Please try again.');
  }
}

function getModelNameForInferenceModel(userInferenceModel) {
  return normalizeInferenceModel(userInferenceModel);
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
