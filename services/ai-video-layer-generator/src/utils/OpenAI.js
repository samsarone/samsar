



import OpenAI from "openai";
import crypto from "crypto";

import { z } from "zod";
import { zodResponseFormat } from "openai/helpers/zod";
import {
  createGoogleGeminiChatCompletion,
  isGeminiInferenceModel,
  normalizeInferenceModel,
} from './GoogleGemini.js';
import { recordProviderUsageLog } from './ProviderUsageAudit.js';
import {
  createSamsarExternalChatCompletion,
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
  'gpt-5.5',
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
  endingImageDescription, userInferenceModel = 'gpt-5.5', useShortFormPrompt = true, indexData, videoTone = 'grounded') {

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
    const responseData = await sendAssistantMessageRequest(messageList, userInferenceModel);


    return responseData.content;
  } catch (err) {
    return null;
  }
}


function getTextToVideoSystemPromptForStartingLayerPrompt(videoTone, promptLength) {

    let systemPrompt;


  systemPrompt = `You are a filmmaking assistant for a generative video tool that creates cinematic animations.
Given the scene prompt and the descriptions for the starting frame, create a concise image-to-video prompt in ${promptLength},
that effectively transitions the starting frame using the desired camera transition.
Ensure to add instructions, not to introduce any new or out-of-place objects, people, items, or anachronistic elements; maintain strict period and contextual accuracy based on the scene prompt and image descriptions.
Ensure that the transition is in accordance with the contextual details provided in the scene prompt.
Use the provided Starting frame description to guide character movements with reference to the camera and ensure the transition is smooth and coherent.
Use the starting image and scene prompt to determine the transition and action, including any relevant keywords to reinforce the theme if needed.
Refer to characters using general descriptors; avoid specific names, descriptions, locations, proper nouns, copyrighted material, or trademarks.
Use simple language and avoid complicated terminology.
Provide the prompt directly without any prefixes like 'Prompt:'.
`;

  if (videoTone === 'grounded') {
    systemPrompt = `
You are a filmmaking assistant for a generative video tool that creates realistic, physics and world aware animations from starting frame and instructions.
Add instructions to ensure the animations are realistic, the surroundings do not move and the camera movement is minimal and grounded.
Add instructions to ensure that objects do not move unnaturally and any movement of objects is realistic and world and physics aware.
Write a text-to-video prompt of no more than ${promptLength}, that effectively transitions from the starting frame to perform the action described in the scene prompt.
Add instructions in the result prompt to ensure the following-
  Do not introduce any additional text or visualizations that are not present in the starting frame.
  Do not add or remove any text during the animation or manipulate the text in the starting frame image.
  Ensure the animations follow the laws of physics, are coherent with the world and realistic.
  Do not modify any characters beyond the objects already present in the starting frame.
  Do not to add extra elements that are not present in the starting frame.
  Ensure that physics, world awareness and prompt coherence are maintained in any character or object movement.
  Any action being performed is shown in the correct context and object interaction.
  Ensure not to manipulate or modify any text or illustrations in the starting frame image during the animation.
  Emphasize realism and coherence in the animation, ensuring that the actions performed by characters or objects seem natural and realistic.
  Ensure no unnatural movements of animation of any characters or objects.
`;

  } 


  systemPrompt += 
`Add instructions to ensure the following:
  Refer to people with generic terms (“teacher,” “engineer”); avoid names, places, brands, and IP.  
  Use clear, everyday language—no jargon.  
  Output only the finished prompt text, without any prefix or commentary.
  Use the provided camera transition as a guide for overall camera movement and scene transition.`;

  return systemPrompt;

}


export async function createTextToVideoPromptFromStartingLayerPrompt(
  startingPrompt,
  startingImageDescription,
  userInferenceModel = 'gpt-5.5',
  useShortFormPrompt = true,
  isSpeakerTransition = false,
  indexData,
  videoTone = 'grounded',
  cameraTransitionLayer = null,
  auditContext = {}
) {
  const { isStartScene, isEndScene } = indexData;

  const promptLength = useShortFormPrompt
    ? '2-3 lines maximum 150-200 characters,'
    : '4-5 lines maximum 500-600 characters';

  let userPrompt = `Scene action: ${startingPrompt}`;
  if (startingImageDescription) {
    userPrompt += `\n Starting frame description: ${startingImageDescription}`;
  }

  let systemPrompt = getTextToVideoSystemPromptForStartingLayerPrompt(
    videoTone,
    promptLength
  );

  if (cameraTransitionLayer) {
    systemPrompt += `\nUse the provided camera transition as a guide for the camera movement.`;
    userPrompt += `\nCamera transition: ${cameraTransitionLayer}`;
  }


  const baseMessages = [
    { role: 'developer', content: systemPrompt },
    { role: 'user', content: userPrompt }
  ];

  const MAX_CHARS = 600;
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



export async function getTransitionListForLayerSceneDescriptions(layerSceneDescriptions, userInferenceModel = 'gpt-5.5', auditContext = {}) {

  const layerSceneDescriptionsString = layerSceneDescriptions.join('\n\n');



  const systemPrompt = `You are a camera transition assistant tool for a generative video production tool.
  Provided a list of scenes as their starting frame description , give a short 1 line camera transition movement for each scene.
  The transitions should follow smoothly as a professional camera man would do to create a professional cinematic video.
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

export async function getAccentForText(text) {

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
    const inferenceModel = process.env.USER_INFERENCE_MODEL || process.env.DEFAULT_USER_INFERENCE_MODEL || 'gpt-5.5';
    const responseData = await sendAssistantMessageRequest(messageList, inferenceModel);

    return responseData.content;
  } catch (err) {
    return null;
  }
}

export async function sendAssistantMessageRequest(messageList, userInferenceModel = 'gpt-5.5', auditContext = {}) {


  const modelName = getModelNameForInferenceModel(userInferenceModel);

  try {
    const basePayload = {
      model: modelName,
      messages: messageList,
    };

    if (shouldUseSamsarExternalInference(basePayload)) {
      const response = await createSamsarExternalChatCompletion(basePayload);
      await recordInferenceProviderUsage({
        messageList,
        modelName,
        provider: 'samsar',
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

    if (RESPONSES_ONLY_MODELS.has(modelName)) {
      const response = await getOpenAIClient().post('/responses', {
        body: {
          model: modelName,
          input: normalizeMessagesForResponses(messageList),
          reasoning: { effort: 'medium' },
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


export async function sendAssistantStructuredMessageRequest(messageList) {


  const ScreenplayTransitionExtraction = z.object({
    useEndFrame: z.boolean()
  });

  try {
    const payload = {
      messages: messageList,
      model: "gpt-4o-2024-11-20",
      response_format: zodResponseFormat(ScreenplayTransitionExtraction, "screenplay_transition_extraction"),
    };
    const response = shouldUseSamsarExternalInference(payload)
      ? await createSamsarExternalChatCompletion(payload)
      : await getOpenAIClient().chat.completions.create(payload);
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
