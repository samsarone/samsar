
import OpenAI from "openai";
import { z } from "zod";
import { zodResponseFormat } from "openai/helpers/zod";
import {
  getResourceListPrompt,
  getThemeForResourceJsonSystemPrompt,
  getGroundedThemeForResourceJsonSystemPrompt,

  getPromptUpdaterWithSystemThemePrompt,
  getCharacterPromptWithSystemTheme,
  getThemeForResourceJsonSystemPromptAndImage,
  getMovieNarrativeExtractorSystemPromptForStartImage,
  getGroundedPromptUpdaterWithSystemThemePrompt,
  getGroundedCharacterPromptWithSystemTheme,
  getTextToVideoNarrativeSystemPrompt,

} from "./AgentCreatorSystemPrompts.js";

import { getFunctionCallParamsForModel, getModelForUserInferenceModel } from './ModelUtils.js';
import { createCompatibleChatCompletion } from "../ai_utils/OpenAICompat.js";
import { createPublicInferenceError } from "../ai_utils/PublicInferenceError.js";
import {
  SPEECH_CHARACTER_LIMIT_EXCEEDED_CODE,
} from '../movie_session/utils/TranscriptUtils.js';
import {
  GPT_56_SOL_REASONING_EFFORT,
  getDefaultUserInferenceModel,
  isGeminiInferenceModel,
  isQwenInferenceModel,
  normalizeInferenceModel,
} from "../../consts/InferenceModels.js";


const API_KEY = process.env.OPENAI_API_KEY;
const openai = new OpenAI({ apiKey: API_KEY || '' });
const GEMINI_THEME_NARRATIVE_REASONING_EFFORT = 'high';
const DEFAULT_THEME_NARRATIVE_TIMEOUT_MS = 10 * 60 * 1000;
const DEFAULT_QWEN_THEME_NARRATIVE_TIMEOUT_MS = 20 * 60 * 1000;
const NARRATIVE_SPEECH_REPAIR_MAX_ATTEMPTS = 3;
const QWEN_NARRATIVE_SPEECH_REPAIR_MAX_TOKENS = 8192;
const NarrativeGenderField = z.enum(['M', 'F', '']).describe(
  'For speech sounds, use exactly "M" or "F" uppercase; never use an empty string for speech. Use an empty string only for sound_effect items.'
);

function buildExternalRequestAttemptContext(context, attempt) {
  if (!context || typeof context !== 'object') return undefined;
  const requestKey = typeof context.requestKey === 'string'
    ? context.requestKey.trim()
    : '';
  if (!requestKey) return undefined;
  return {
    ...context,
    requestKey: `${requestKey}:attempt-${attempt}`,
  };
}

async function notifyInferenceResponse(options, response, metadata = {}) {
  if (typeof options?.onInferenceResponse !== 'function') {
    return;
  }

  try {
    await options.onInferenceResponse({
      ...metadata,
      model: response?.model || metadata.model || null,
      usage: response?.usage || null,
      response,
    });
  } catch (error) {
    // Receipt persistence is part of metered request correctness. Do not let a
    // storage failure masquerade as a provider failure and trigger a duplicate
    // inference call in the surrounding retry loop.
    try {
      error.code ||= 'INFERENCE_USAGE_OBSERVER_FAILED';
      error.inferenceUsageObserverFailed = true;
    } catch {
      // Preserve non-extensible errors; the caller will still receive them.
    }
    throw error;
  }
}

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





export async function extractThemeFromUserPromptAndImageTheme(
  prompt,
  imageTheme,
  inferenceModel = getDefaultUserInferenceModel(),
  options = {},
) {

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

  const responseData = await sendSessionThemeMessageRequest(
    messageList,
    effectiveInferenceModel,
    'high',
    options,
  );

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
    const parsedMessage = parseStructuredCompletion(
      response,
      'screenplay_storyline_extraction',
    );

    return parsedMessage;
  } catch (error) {
    console.error('[MovieCreatorAgent][sendSessionResourcesMessageRequest] OpenAI request failed', {
      inferenceModel,
      model: modelName,
      messageSummary: summarizeMessageList(messageList),
      openaiError: summarizeOpenAIError(error),
    });
    const publicError = createPublicInferenceError(error, { model: modelName });
    if (publicError) throw publicError;
    throw new Error('An error occurred while sending the message. Please try again.');
  }
}




export async function updatePromptWithTheme(prompt, themeJson, aspectRatio = '1:1',
  userInferenceModel = getDefaultUserInferenceModel(),
  shortForm = false,
  videoTone = 'cinematic',
  options = {}) {


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

  const response = await sendAssistantMessageRequest(messageList, userInferenceModel, options);

  return response.content.trim();
}



export async function updateCharacterPromptWithTheme(prompt, speakerActor, themeJson, aspectRatio = '1:1',
  userInferenceModel = getDefaultUserInferenceModel(),
  shortForm = false, videoTone = 'cinematic', options = {}) {

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

  const response = await sendAssistantMessageRequest(messageList, userInferenceModel, options);

  return response.content.trim();
}



export async function sendSessionThemeMessageRequest(
  messageList,
  userInferenceModel = getDefaultUserInferenceModel(),
  reasoningEffort,
  options = {},
) {
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
  const configuredTimeoutMs = normalizePositiveInteger(
    process.env.OPENAI_THEME_TIMEOUT_MS,
    isQwenInferenceModel(modelName)
      ? DEFAULT_QWEN_THEME_NARRATIVE_TIMEOUT_MS
      : DEFAULT_THEME_NARRATIVE_TIMEOUT_MS,
  );
  const timeoutMs = isQwenInferenceModel(modelName)
    ? Math.max(configuredTimeoutMs, DEFAULT_QWEN_THEME_NARRATIVE_TIMEOUT_MS)
    : configuredTimeoutMs;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await createCompatibleChatCompletion(openai, {
        messages: messageList,
        model: modelName,
        response_format: zodResponseFormat(ThemeKeywordsExtraction, "theme_keywords_extraction"),
        ...buildReasoningRequestOptions(effectiveReasoningEffort),
        ...(isQwenInferenceModel(modelName) ? { max_tokens: 65536 } : {}),
        timeout: timeoutMs,
        maxRetries: 1,
        externalPolling: true,
        externalPollTimeoutMs: timeoutMs,
        externalPollIntervalMs: process.env.SAMSAR_EXTERNAL_ASSISTANT_POLL_INTERVAL_MS,
        externalRequestContext: buildExternalRequestAttemptContext(
          options.externalRequestContext,
          attempt + 1,
        ),
        // This call already owns its bounded retry loop; the shared adapter
        // still enforces a hard timeout but must not multiply attempts.
        externalMaxRetries: 0,
      });

      await notifyInferenceResponse(options, response, {
        stage: 'theme_generation',
        attempt: attempt + 1,
        model: modelName,
      });

      const parsedMessage = parseStructuredCompletion(
        response,
        'theme_keywords_extraction',
      );
      return parsedMessage;
    } catch (error) {
      if (error?.inferenceUsageObserverFailed === true ||
        error?.code === 'INFERENCE_USAGE_OBSERVER_FAILED') {
        throw error;
      }
      const publicError = createPublicInferenceError(error, { model: modelName });
      const isFinalAttempt = attempt >= maxRetries || Boolean(publicError);
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
      if (publicError) {
        throw publicError;
      }
      if (attempt < maxRetries) {
        const delay = Math.pow(2, attempt) * 5000; // exponential backoff: 5s, 10s, 20s
        await new Promise((resolve) => setTimeout(resolve, delay));
      } else {
        throw new Error('An error occurred while sending the message after multiple retries. Please try again later.');
      }
    }
  }
}


export async function sendAssistantMessageRequest(
  messageList,
  userInferenceModel = getDefaultUserInferenceModel(),
  options = {},
) {

  // const modelName = getModelForUserInferenceModel(userInferenceModel);

  const callArgs = getFunctionCallParamsForModel(userInferenceModel, messageList);
  const externalRequestContext = buildExternalRequestAttemptContext(
    options.externalRequestContext,
    1,
  );


  try {
    const response = await createCompatibleChatCompletion(openai, {
      ...callArgs,
      ...(externalRequestContext
        ? {
          externalPolling: true,
          externalRequestContext,
          externalMaxRetries: 0,
        }
        : {}),
    });

    await notifyInferenceResponse(options, response, {
      stage: 'visual_prompt_generation',
      attempt: 1,
      model: callArgs.model,
    });

    return response.choices[0].message;
  } catch (error) {
    if (error?.inferenceUsageObserverFailed === true ||
      error?.code === 'INFERENCE_USAGE_OBSERVER_FAILED') {
      throw error;
    }
    console.error('[MovieCreatorAgent][sendAssistantMessageRequest] OpenAI request failed', {
      inferenceModel: userInferenceModel,
      model: callArgs?.model ?? null,
      messageSummary: summarizeMessageList(messageList),
      openaiError: summarizeOpenAIError(error),
    });
    const publicError = createPublicInferenceError(error, { model: callArgs?.model });
    if (publicError) throw publicError;
    let errorString = 'An error occurred while sending the message. Please try again with a different message.'
    throw new Error(errorString);
  }

}




export async function extractThemeFromUserPrompt(
  prompt,
  inferenceModel = getDefaultUserInferenceModel(),
  options = {},
) {
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
  const themeData = await sendSessionThemeMessageRequest(
    messageList,
    inferenceModel,
    undefined,
    options,
  );
  return themeData;
}


export async function extractGroundedThemeFromUserPrompt(
  prompt,
  inferenceModel = getDefaultUserInferenceModel(),
  options = {},
) {
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
  const themeData = await sendSessionThemeMessageRequest(
    messageList,
    inferenceModel,
    'high',
    options,
  );
  return themeData;
}



export async function extractGroundedMovieNarrativeFromThemeAndUserPrompt(
  themeJson,
  prompt,
  duration = 10,
  videoModel,
  inferenceModel,
  languageString,
  options = {},
) {


  const narrativePrompt = typeof options?.narrativeSystemPrompt === 'string' &&
    options.narrativeSystemPrompt.trim()
    ? options.narrativeSystemPrompt
    : getTextToVideoNarrativeSystemPrompt({
      duration,
      videoModel,
      grounded: true,
      languageString,
      minimumSceneCount: options?.minimumSceneCount,
    });


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




  const resData = await sendNarrativePromptMessageRequest(
    messageList,
    inferenceModel,
    undefined,
    options,
  );

  return resData;


}





export async function extractMovieNarrativeFromThemeUserPromptAndStartImage(imgDescription,
  themeJson, prompt,
  duration = 10, videoModel, inferenceModel, options = {}) {

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


  const resData = await sendNarrativePromptMessageRequest(
    messageList,
    inferenceModel,
    undefined,
    options,
  );


  return resData;



}

export async function extractMovieNarrativeFromThemeAndUserPrompt(
  themeJson,
  prompt,
  duration = 10,
  videoModel,
  inferenceModel,
  languageString,
  options = {},
) {


  const narrativePrompt = typeof options?.narrativeSystemPrompt === 'string' &&
    options.narrativeSystemPrompt.trim()
    ? options.narrativeSystemPrompt
    : getTextToVideoNarrativeSystemPrompt({
      duration,
      videoModel,
      grounded: false,
      languageString,
      minimumSceneCount: options?.minimumSceneCount,
    });

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


  const resData = await sendNarrativePromptMessageRequest(
    messageList,
    inferenceModel,
    undefined,
    options,
  );

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

    const parsedMessage = parseStructuredCompletion(response, 'prompt_generation');



    return parsedMessage.promptList;
  } catch (error) {
    const publicError = createPublicInferenceError(error, { model: userInferenceModel });
    if (publicError) throw publicError;
    throw new Error('An error occurred while sending the message. Please try again.');
  }

}


export async function rewriteNarrativeSpeechItemToFitScene({
  narrativeSystemPrompt,
  scene,
  speechItem,
  maxCharacters,
  inferenceModel = getDefaultUserInferenceModel(),
  options = {},
} = {}) {
  const normalizedSystemPrompt = typeof narrativeSystemPrompt === 'string'
    ? narrativeSystemPrompt
    : '';
  const normalizedMaxCharacters = Number(maxCharacters);
  if (!normalizedSystemPrompt.trim()) {
    throw new TypeError('narrativeSystemPrompt is required for speech repair.');
  }
  if (!scene || typeof scene !== 'object' || Array.isArray(scene)) {
    throw new TypeError('scene is required for speech repair.');
  }
  if (!speechItem || typeof speechItem !== 'object' || Array.isArray(speechItem)) {
    throw new TypeError('speechItem is required for speech repair.');
  }
  if (!Number.isSafeInteger(normalizedMaxCharacters) || normalizedMaxCharacters < 1) {
    throw new TypeError('maxCharacters must be a positive integer for speech repair.');
  }

  const modelName = getModelForUserInferenceModel(inferenceModel);
  const effectiveReasoningEffort = getThemeNarrativeReasoningEffort(modelName);
  const configuredTimeoutMs = normalizePositiveInteger(
    options.timeoutMs ?? process.env.OPENAI_NARRATIVE_TIMEOUT_MS,
    isQwenInferenceModel(modelName)
      ? DEFAULT_QWEN_THEME_NARRATIVE_TIMEOUT_MS
      : DEFAULT_THEME_NARRATIVE_TIMEOUT_MS,
  );
  const timeoutMs = isQwenInferenceModel(modelName)
    ? Math.max(configuredTimeoutMs, DEFAULT_QWEN_THEME_NARRATIVE_TIMEOUT_MS)
    : configuredTimeoutMs;
  const maxAttempts = Math.min(
    normalizePositiveInteger(
      options.maxAttempts ?? process.env.OPENAI_NARRATIVE_SPEECH_REPAIR_MAX_ATTEMPTS,
      NARRATIVE_SPEECH_REPAIR_MAX_ATTEMPTS,
    ),
    NARRATIVE_SPEECH_REPAIR_MAX_ATTEMPTS,
  );
  const createCompletion = options.dependencies?.createCompatibleChatCompletion ||
    createCompatibleChatCompletion;
  const openaiClient = options.dependencies?.openaiClient || openai;
  const sleep = options.dependencies?.sleep || ((delayMs) => new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  }));
  const SpeechAudioReplacement = z.object({
    audio: z.string().trim().min(1),
  });
  const existingAudio = typeof speechItem.audio === 'string' ? speechItem.audio.trim() : '';
  const existingCharacterCount = Array.from(existingAudio).length;
  const messages = [
    {
      role: 'developer',
      content: normalizedSystemPrompt,
    },
    {
      role: 'developer',
      content:
        'The narrative is complete. Rewrite only the supplied speech item\'s "audio" text ' +
        'so it fits the scene while preserving its meaning, language, factual content, ' +
        `speaker, and tone. The replacement must contain no more than ${normalizedMaxCharacters} ` +
        `characters, counting spaces and punctuation; the current line has ` +
        `${existingCharacterCount} characters. Do not change or return any other narrative field. ` +
        'For this correction, return only {"audio":"..."}; this focused response format ' +
        'replaces the full-narrative response format above.',
    },
    {
      role: 'user',
      content: JSON.stringify({ scene, speechItem }),
    },
  ];
  let lastError = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const attemptMessages = lastError
      ? [
        ...messages,
        {
          role: 'developer',
          content:
            `The prior correction was invalid: ${String(lastError.message || lastError).slice(0, 1000)} ` +
            `Try again and keep "audio" within ${normalizedMaxCharacters} characters.`,
        },
      ]
      : messages;

    try {
      const response = await createCompletion(openaiClient, {
        messages: attemptMessages,
        model: modelName,
        response_format: zodResponseFormat(
          SpeechAudioReplacement,
          'narrative_speech_repair',
        ),
        ...buildReasoningRequestOptions(effectiveReasoningEffort),
        ...(isQwenInferenceModel(modelName)
          ? { max_tokens: QWEN_NARRATIVE_SPEECH_REPAIR_MAX_TOKENS }
          : {}),
        timeout: timeoutMs,
        maxRetries: 0,
        externalPolling: true,
        externalPollTimeoutMs: timeoutMs,
        externalPollIntervalMs: process.env.SAMSAR_EXTERNAL_ASSISTANT_POLL_INTERVAL_MS,
        externalRequestContext: buildExternalRequestAttemptContext(
          options.externalRequestContext,
          attempt,
        ),
        externalMaxRetries: 0,
      });

      await notifyInferenceResponse(options, response, {
        stage: 'narrative_speech_repair',
        attempt,
        model: modelName,
        sceneIndex: options.sceneIndex ?? speechItem.sceneIndex ?? null,
        soundIndex: options.soundIndex ?? null,
      });

      const parsedJson = parseStructuredCompletion(response, 'narrative_speech_repair');
      const parsed = SpeechAudioReplacement.safeParse(parsedJson);
      if (!parsed.success) {
        throw new Error('Narrative speech repair returned an invalid audio response.');
      }
      const replacementAudio = parsed.data.audio;
      const replacementCharacterCount = Array.from(replacementAudio).length;
      if (replacementCharacterCount > normalizedMaxCharacters) {
        const error = new Error(
          `Replacement speech has ${replacementCharacterCount} characters; ` +
          `${normalizedMaxCharacters} are allowed.`,
        );
        error.code = SPEECH_CHARACTER_LIMIT_EXCEEDED_CODE;
        throw error;
      }

      return { ...speechItem, audio: replacementAudio };
    } catch (error) {
      if (error?.inferenceUsageObserverFailed === true ||
        error?.code === 'INFERENCE_USAGE_OBSERVER_FAILED') {
        throw error;
      }
      const publicError = createPublicInferenceError(error, { model: modelName });
      if (publicError) {
        throw publicError;
      }
      lastError = error;
      if (attempt < maxAttempts) {
        await sleep(1000 * (2 ** (attempt - 1)));
      }
    }
  }

  throw lastError || new Error('Unable to repair narrative speech.');
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
      visual: z.string().min(1),
      type: z.string(),
      duration: z.number(),
      startTime: z.number(),
      endTime: z.number(),
      speaker: z.string(),
    })),
    sounds: z.array(z.object({
      audio: z.string().min(1),
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
    4,
  );
  const configuredTimeoutMs = normalizePositiveInteger(
    options.timeoutMs ?? process.env.OPENAI_NARRATIVE_TIMEOUT_MS,
    isQwenInferenceModel(modelName)
      ? DEFAULT_QWEN_THEME_NARRATIVE_TIMEOUT_MS
      : DEFAULT_THEME_NARRATIVE_TIMEOUT_MS,
  );
  const timeoutMs = isQwenInferenceModel(modelName)
    ? Math.max(configuredTimeoutMs, DEFAULT_QWEN_THEME_NARRATIVE_TIMEOUT_MS)
    : configuredTimeoutMs;

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
        ...(isQwenInferenceModel(modelName) ? { max_tokens: 65536 } : {}),
        timeout: timeoutMs,
        maxRetries: 1,
        externalPolling: true,
        externalPollTimeoutMs: timeoutMs,
        externalPollIntervalMs: process.env.SAMSAR_EXTERNAL_ASSISTANT_POLL_INTERVAL_MS,
        externalRequestContext: buildExternalRequestAttemptContext(
          options.externalRequestContext,
          attempt,
        ),
        // Narrative generation has its own bounded retry/backoff loop.
        externalMaxRetries: 0,
      });

      await notifyInferenceResponse(options, response, {
        stage: 'narrative_generation',
        attempt,
        model: modelName,
      });



      const parsedMessage = parseStructuredCompletion(
        response,
        'screenplay_storyline_extraction',
      );

      return parsedMessage;  // If successful, return here
    } catch (error) {
      if (error?.inferenceUsageObserverFailed === true ||
        error?.code === 'INFERENCE_USAGE_OBSERVER_FAILED') {
        throw error;
      }
      const publicError = createPublicInferenceError(error, { model: modelName });
      const isFinalAttempt = attempt >= maxAttempts || Boolean(publicError);
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

      if (publicError) {
        throw publicError;
      } else if (attempt === maxAttempts) {
        // After max attempts, throw the error
        throw new Error(
          'An error occurred while sending the message. Please try again.'
        );
      } else {
        // Exponential backoff: 5s, 10s, 20s.
        const backoffTime = 5000 * 2 ** (attempt - 1);
        await delay(backoffTime);
      }
    }
  }
}

function getThemeNarrativeReasoningEffort(modelName) {
  if (isGeminiInferenceModel(modelName) || isQwenInferenceModel(modelName)) {
    return GEMINI_THEME_NARRATIVE_REASONING_EFFORT;
  }
  return GPT_56_SOL_REASONING_EFFORT;
}

function buildReasoningRequestOptions(reasoningEffort) {
  return reasoningEffort
    ? {
      reasoning: { effort: reasoningEffort },
      reasoning_effort: reasoningEffort,
    }
    : {};
}

function parseStructuredCompletion(response, operation) {
  const choice = response?.choices?.[0];
  const messageContent = choice?.message?.content;
  try {
    return JSON.parse(messageContent);
  } catch (cause) {
    const contentLength = typeof messageContent === 'string' ? messageContent.length : 0;
    const finishReason = choice?.finish_reason ?? null;
    const nativeFinishReason = choice?.native_finish_reason ?? null;
    const completionTokens = response?.usage?.completion_tokens ?? null;
    const reasoningTokens = response?.usage?.completion_tokens_details?.reasoning_tokens ?? null;
    const error = new SyntaxError(
      `${operation} returned invalid JSON ` +
      `(finishReason=${finishReason}, nativeFinishReason=${nativeFinishReason}, ` +
      `contentLength=${contentLength}, completionTokens=${completionTokens}, ` +
      `reasoningTokens=${reasoningTokens}): ${cause?.message || 'JSON parsing failed'}`,
    );
    error.cause = cause;
    throw error;
  }
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
