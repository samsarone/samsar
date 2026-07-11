
import OpenAI from "openai";
import { z } from "zod";
import { zodResponseFormat } from "openai/helpers/zod";
import {
  getResourceListPrompt,
  getThemeForResourceJsonSystemPrompt,
  getGroundedThemeForResourceJsonSystemPrompt,

  getPromptUpdaterWithSystemThemePrompt,
  getMovieNarrativeExtractorSystemPrompt,
  getGroundedMovieNarrativeExtractorSystemPrompt,
  getCharacterPromptWithSystemTheme,
  getThemeForResourceJsonSystemPromptAndImage,
  getMovieNarrativeExtractorSystemPromptForStartImage,
  getGroundedPromptUpdaterWithSystemThemePrompt,
  getGroundedCharacterPromptWithSystemTheme,

} from "./AgentCreatorSystemPrompts.js";

import { getFunctionCallParamsForModel, getModelForUserInferenceModel } from './ModelUtils.js';
import { createCompatibleChatCompletion } from "../ai_utils/OpenAICompat.js";
import {
  GPT_56_SOL_REASONING_EFFORT,
  getDefaultUserInferenceModel,
  isGeminiInferenceModel,
  normalizeInferenceModel,
} from "../../consts/InferenceModels.js";


const API_KEY = process.env.OPENAI_API_KEY;
const openai = new OpenAI({ apiKey: API_KEY || '' });
const GEMINI_THEME_NARRATIVE_REASONING_EFFORT = 'high';
const NarrativeGenderField = z.enum(['M', 'F', '']).describe(
  'For speech sounds, use exactly "M" or "F" uppercase; never use an empty string for speech. Use an empty string only for sound_effect items.'
);

export async function getResourceListForScreenplay(screenplay, inferenceModel = getDefaultUserInferenceModel(), videoModel) {

  const systemPrompt = getResourceListPrompt(videoModel);
  const messageList = [
    {
      role: "developer",
      content: systemPrompt,
    },
    {
      role: "user",
      content: screenplay,
    }
  ];

  const responseData = await sendSessionResourcesMessageRequest(messageList, inferenceModel);
  return responseData;
}




export async function createThemeForResourceJson(resourceJson, inferenceModel = getDefaultUserInferenceModel()) {

  const systemPrompt = getThemeForResourceJsonSystemPrompt(false);

  const messageList = [
    {
      role: "developer",
      content: systemPrompt,
    },
    {
      role: "user",
      content: resourceJson,
    }
  ]

  const responseData = await sendSessionThemeMessageRequest(messageList, inferenceModel);

  return responseData;

}





export async function extractThemeFromUserPromptAndImageTheme(prompt, imageTheme, inferenceModel = getDefaultUserInferenceModel()) {

  const systemPrompt = getThemeForResourceJsonSystemPromptAndImage(true);

  const messageList = [
    {
      role: "developer",
      content: systemPrompt,
    },
    {
      role: "user",
      content: `Reference theme: ${imageTheme}`
    },
    {
      role: "user",
      content: "Prompt " + prompt,
    },

  ]


  const effectiveInferenceModel = normalizeInferenceModel(inferenceModel);

  const responseData = await sendSessionThemeMessageRequest(messageList, effectiveInferenceModel, 'high');

  return responseData;

}



export async function sendSessionResourcesMessageRequest(messageList, inferenceModel = getDefaultUserInferenceModel()) {

  const modelName = getModelForUserInferenceModel(inferenceModel);


  const ScreenplayStorylineExtraction = z.object({
    scenes: z.array(z.object({
      visual: z.string(),
      type: z.string(),
      duration: z.number(),
      startTime: z.number(),
      endTime: z.number(),
      speaker: z.string(),
    })
    ),
    sounds: z.array(z.object({
      audio: z.string(),
      startTime: z.number(),
      duration: z.number(),
      endTime: z.number(),
      type: z.string(),
      sceneIndex: z.number(),
      subType: z.string(),
      actor: z.string(),
      gender: NarrativeGenderField,
    })
    ),
    metadata: z.string(),
  });

  try {
    const response = await createCompatibleChatCompletion(openai, {
      messages: messageList,
      model: modelName,
      response_format: zodResponseFormat(ScreenplayStorylineExtraction, "screenplay_storyline_extraction"),
    });
    const messageContent = response.choices[0].message.content;

    const parsedMessage = JSON.parse(messageContent);

    return parsedMessage;
  } catch (error) {
    console.error('[MovieCreatorAgent][sendSessionResourcesMessageRequest] OpenAI request failed', {
      inferenceModel,
      model: modelName,
      messageSummary: summarizeMessageList(messageList),
      openaiError: summarizeOpenAIError(error),
    });
    throw new Error('An error occurred while sending the message. Please try again.');
  }
}




export async function updatePromptWithTheme(prompt, themeJson, aspectRatio = '1:1',
  userInferenceModel = getDefaultUserInferenceModel(),
  shortForm = false,
  videoTone = 'cinematic') {


  let systemPrompt;

  if (videoTone === 'grounded') {
    systemPrompt = getGroundedPromptUpdaterWithSystemThemePrompt(shortForm, aspectRatio);
  } else {
    systemPrompt = getPromptUpdaterWithSystemThemePrompt(shortForm, aspectRatio);
  }




  const messageList = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: `Theme JSON is: ${themeJson}` },
    { role: 'user', content: `The user input prompt is: ${prompt}` },
  ];

  const response = await sendAssistantMessageRequest(messageList, userInferenceModel);

  return response.content.trim();
}



export async function updateCharacterPromptWithTheme(prompt, speakerActor, themeJson, aspectRatio = '1:1',
  userInferenceModel = getDefaultUserInferenceModel(),
  shortForm = false, videoTone = 'cinematic') {

  let systemPrompt = getCharacterPromptWithSystemTheme(shortForm, speakerActor, aspectRatio);

  if (videoTone === 'grounded') {
    systemPrompt = getGroundedCharacterPromptWithSystemTheme(shortForm, speakerActor, aspectRatio);
  }

  const messageList = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: `Theme JSON is: ${themeJson}` },
    { role: 'user', content: `The speaker is: ${speakerActor}` },
    { role: 'user', content: `The user input prompt is: ${prompt}` },
  ];

  const response = await sendAssistantMessageRequest(messageList, userInferenceModel);

  return response.content.trim();
}



export async function sendSessionThemeMessageRequest(messageList, userInferenceModel = getDefaultUserInferenceModel(), reasoningEffort) {
  const modelName = getModelForUserInferenceModel(userInferenceModel);
  const effectiveReasoningEffort = getThemeNarrativeReasoningEffort(modelName);

  const ThemeKeywordsExtraction = z.object({
    subject: z.array(z.string()),
    actors: z.array(
      z.object({
        name: z.string(),
        keywords: z.array(z.string()),
      })
    ),
    places: z.array(
      z.object({
        name: z.string(),
        keywords: z.array(z.string()),
      })
    ),
    objects: z.array(
      z.object({
        name: z.string(),
        keywords: z.array(z.string()),
      })
    ),
    setting: z.array(z.string()),
    style: z.array(z.string()),
    general: z.array(z.string()),
  });

  const maxRetries = 3;
  const timeoutMs = normalizePositiveInteger(
    process.env.OPENAI_THEME_TIMEOUT_MS,
    180000,
  );

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await createCompatibleChatCompletion(openai, {
        messages: messageList,
        model: modelName,
        response_format: zodResponseFormat(ThemeKeywordsExtraction, "theme_keywords_extraction"),
        ...buildReasoningRequestOptions(effectiveReasoningEffort),
        timeout: timeoutMs,
        maxRetries: 1,
      });

      const messageContent = response.choices[0].message.content;
      const parsedMessage = JSON.parse(messageContent);
      return parsedMessage;
    } catch (error) {
      const isFinalAttempt = attempt >= maxRetries;
      const logPayload = {
        inferenceModel: userInferenceModel,
        model: modelName,
        attempt: attempt + 1,
        maxAttempts: maxRetries + 1,
        timeoutMs,
        messageSummary: summarizeMessageList(messageList),
        openaiError: summarizeOpenAIError(error),
      };
      if (isFinalAttempt) {
        console.error('[MovieCreatorAgent][sendSessionThemeMessageRequest] OpenAI request failed', logPayload);
      } else {
        console.error('[MovieCreatorAgent][sendSessionThemeMessageRequest] OpenAI request failed (will retry)', logPayload);
      }
      if (attempt < maxRetries) {
        const delay = Math.pow(2, attempt) * 500; // exponential backoff: 500ms, 1000ms, 2000ms
        await new Promise((resolve) => setTimeout(resolve, delay));
      } else {
        throw new Error('An error occurred while sending the message after multiple retries. Please try again later.');
      }
    }
  }
}


export async function sendAssistantMessageRequest(messageList, userInferenceModel = getDefaultUserInferenceModel()) {

  // const modelName = getModelForUserInferenceModel(userInferenceModel);

  const callArgs = getFunctionCallParamsForModel(userInferenceModel, messageList);


  try {
    const response = await createCompatibleChatCompletion(openai, callArgs);

    return response.choices[0].message;
  } catch (error) {
    console.error('[MovieCreatorAgent][sendAssistantMessageRequest] OpenAI request failed', {
      inferenceModel: userInferenceModel,
      model: callArgs?.model ?? null,
      messageSummary: summarizeMessageList(messageList),
      openaiError: summarizeOpenAIError(error),
    });
    let errorString = 'An error occurred while sending the message. Please try again with a different message.'
    throw new Error(errorString);
  }

}




export async function extractThemeFromUserPrompt(prompt, inferenceModel = getDefaultUserInferenceModel()) {
  const systemPrompt = getThemeForResourceJsonSystemPrompt(false);

  const messageList = [
    {
      role: "developer",
      content: systemPrompt,
    },
    {
      role: "user",
      content: prompt,
    },
  ];



  // This function call should send 'messageList' to your AI service and
  // return the structured JSON with extracted theme data.
  const themeData = await sendSessionThemeMessageRequest(messageList, inferenceModel);
  return themeData;
}


export async function extractGroundedThemeFromUserPrompt(prompt, inferenceModel = getDefaultUserInferenceModel()) {
  const systemPrompt = getGroundedThemeForResourceJsonSystemPrompt(false);

  const messageList = [
    {
      role: "developer",
      content: systemPrompt,
    },
    {
      role: "user",
      content: prompt,
    },
  ];

  inferenceModel = normalizeInferenceModel(inferenceModel);

  // This function call should send 'messageList' to your AI service and
  // return the structured JSON with extracted theme data.
  const themeData = await sendSessionThemeMessageRequest(messageList, inferenceModel, 'high');
  return themeData;
}



export async function extractGroundedMovieNarrativeFromThemeAndUserPrompt(
  themeJson,
  prompt,
  duration = 10,
  videoModel,
  inferenceModel,
  languageString,
) {


  const narrativePrompt = getGroundedMovieNarrativeExtractorSystemPrompt(duration, videoModel, false, languageString);


  const messageList = [
    {
      role: "developer",
      content: narrativePrompt,
    },
    {
      role: 'user',
      content: `Existing theme: ${JSON.stringify(themeJson)}`
    },

    {
      role: "user",
      content: prompt,
    },
  ];




  const resData = await sendNarrativePromptMessageRequest(messageList, inferenceModel);

  return resData;


}





export async function extractMovieNarrativeFromThemeUserPromptAndStartImage(imgDescription,
  themeJson, prompt,
  duration = 10, videoModel, inferenceModel) {

  const narrativePrompt = getMovieNarrativeExtractorSystemPromptForStartImage(duration, videoModel, true);


  const messageList = [
    {
      role: "developer",
      content: narrativePrompt,
    },
    {
      role: 'user',
      content: `Existing theme: ${JSON.stringify(themeJson)}`
    },
    {
      role: 'user',
      content: `Start image description: ${imgDescription}`
    },

    {
      role: "user",
      content: prompt,
    },
  ];


  const resData = await sendNarrativePromptMessageRequest(messageList, inferenceModel);


  return resData;



}

export async function extractMovieNarrativeFromThemeAndUserPrompt(
  themeJson,
  prompt,
  duration = 10,
  videoModel,
  inferenceModel,
  languageString,
) {


  const narrativePrompt = getMovieNarrativeExtractorSystemPrompt(duration, videoModel, false, languageString);

  const messageList = [
    {
      role: "developer",
      content: narrativePrompt,
    },
    {
      role: 'user',
      content: `Existing theme: ${JSON.stringify(themeJson)}`
    },

    {
      role: "user",
      content: prompt,
    },
  ];


  const resData = await sendNarrativePromptMessageRequest(messageList, inferenceModel);

  return resData;
}


export async function extractMovieDurationFromPrompt(prompt) {
  const systemPrompt = `You are a movie creator assistant.
  Provide the approximate duration of the movie in second `;

}





export async function sendSessionPromptMessageRequest(messageList, themeObject, userInferenceModel = getDefaultUserInferenceModel()) {
  const PromptGeneration = z.object({
    promptList: z.array(z.string()),
  });

  try {
    const modelName = getModelForUserInferenceModel(userInferenceModel || getDefaultUserInferenceModel());
    const response = await createCompatibleChatCompletion(openai, {
      messages: messageList,
      model: modelName,
      response_format: zodResponseFormat(PromptGeneration, "prompt_generation"),
    });

    const messageContent = response.choices[0].message.content;

    const parsedMessage = JSON.parse(messageContent);



    return parsedMessage.promptList;
  } catch (error) {
    throw new Error('An error occurred while sending the message. Please try again.');
  }

}


export async function sendNarrativePromptMessageRequest(
  messageList,
  inferenceModel = getDefaultUserInferenceModel(),
  reasoningEffort,
  options = {},
) {
  const modelName = getModelForUserInferenceModel(inferenceModel);
  const effectiveReasoningEffort = getThemeNarrativeReasoningEffort(modelName);

  const ScreenplayStorylineExtraction = z.object({
    scenes: z.array(z.object({
      visual: z.string(),
      type: z.string(),
      duration: z.number(),
      startTime: z.number(),
      endTime: z.number(),
      speaker: z.string(),
    })),
    sounds: z.array(z.object({
      audio: z.string(),
      startTime: z.number(),
      duration: z.number(),
      endTime: z.number(),
      type: z.string(),  // can be speech or sound_effect
      sceneIndex: z.number(),
      subType: z.string(),
      actor: z.string(),
      gender: NarrativeGenderField,
      Identity: z.string(),
      isHuman: z.boolean(),
    }))
  });

  const maxAttempts = normalizePositiveInteger(
    options.maxAttempts ?? process.env.OPENAI_NARRATIVE_MAX_ATTEMPTS,
    2,
  );
  const timeoutMs = normalizePositiveInteger(
    options.timeoutMs ?? process.env.OPENAI_NARRATIVE_TIMEOUT_MS,
    180000,
  );

  // Helper function for waiting
  function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const responseFormat = zodResponseFormat(ScreenplayStorylineExtraction, "screenplay_storyline_extraction");

      let response;
      
      response = await createCompatibleChatCompletion(openai, {
        messages: messageList,
        model: modelName,
        response_format: responseFormat,
        ...buildReasoningRequestOptions(effectiveReasoningEffort),
        timeout: timeoutMs,
        maxRetries: 1,
      });



      const messageContent = response.choices[0].message.content;
      const parsedMessage = JSON.parse(messageContent);

      return parsedMessage;  // If successful, return here
    } catch (error) {
      const isFinalAttempt = attempt >= maxAttempts;
      const logPayload = {
        inferenceModel,
        model: modelName,
        reasoningEffort: effectiveReasoningEffort || null,
        timeoutMs,
        attempt,
        maxAttempts,
        messageSummary: summarizeMessageList(messageList),
        openaiError: summarizeOpenAIError(error),
      };
      if (isFinalAttempt) {
        console.error('[MovieCreatorAgent][sendNarrativePromptMessageRequest] request failed', logPayload);
      } else {
        console.error('[MovieCreatorAgent][sendNarrativePromptMessageRequest] request failed (will retry)', logPayload);
      }

      if (attempt === maxAttempts) {
        // After max attempts, throw the error
        throw new Error(
          'An error occurred while sending the message. Please try again.'
        );
      } else {
        // Exponential backoff: 1s, 2s, 4s...
        const backoffTime = 1000 * 2 ** (attempt - 1);
        await delay(backoffTime);
      }
    }
  }
}

function getThemeNarrativeReasoningEffort(modelName) {
  return isGeminiInferenceModel(modelName)
    ? GEMINI_THEME_NARRATIVE_REASONING_EFFORT
    : GPT_56_SOL_REASONING_EFFORT;
}

function buildReasoningRequestOptions(reasoningEffort) {
  return reasoningEffort
    ? {
      reasoning: { effort: reasoningEffort },
      reasoning_effort: reasoningEffort,
    }
    : {};
}

function summarizeMessageList(messageList) {
  if (!Array.isArray(messageList)) {
    return null;
  }

  return messageList.map((message) => ({
    role: message?.role ?? null,
    contentLength: getContentLength(message?.content),
    contentType: Array.isArray(message?.content) ? 'array' : typeof message?.content,
  }));
}

function getContentLength(content) {
  if (typeof content === 'string') {
    return content.length;
  }
  if (Array.isArray(content)) {
    return content.reduce((total, item) => total + getContentLength(item?.text), 0);
  }
  if (content === null || content === undefined) {
    return 0;
  }
  try {
    return JSON.stringify(content).length;
  } catch {
    return null;
  }
}

function normalizePositiveInteger(value, fallback) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue) || numericValue <= 0) {
    return fallback;
  }
  return Math.floor(numericValue);
}

function summarizeOpenAIError(error) {
  if (!error) {
    return null;
  }

  const apiError = error?.error;
  const headers = error?.headers || error?.response?.headers;
  const requestId =
    error?.request_id ||
    error?.requestId ||
    headers?.['x-request-id'] ||
    headers?.['x-request_id'] ||
    headers?.['x-openai-request-id'] ||
    headers?.['x-openai-request_id'] ||
    null;

  return {
    name: error?.name,
    message: error?.message,
    status: error?.status ?? error?.response?.status ?? null,
    code: error?.code ?? apiError?.code ?? null,
    type: error?.type ?? apiError?.type ?? null,
    param: error?.param ?? apiError?.param ?? null,
    requestId,
  };
}
