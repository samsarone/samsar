


import OpenAI from "openai";
import { z } from "zod";
import { zodResponseFormat } from "openai/helpers/zod";
import { getDBConnectionString } from "../DBString.js";
import { getModelForUserInferenceModel } from "./ModelUtils.js";
import { createCompatibleChatCompletion } from "../ai_utils/OpenAICompat.js";
import { getDefaultUserInferenceModel } from "../../consts/InferenceModels.js";
import { normalizeDetectedLanguageCode } from '../../consts/SupportedLanguages.js';


import TagCloud from "../../schema/content/TagCloud.js";
const API_KEY = process.env.OPENAI_API_KEY;
const openai = new OpenAI({ apiKey: API_KEY || '' });

import { getToneAndPronunciationForTranscript } from "./system_prompts/AudioCreator.js";


export async function translateSpeech(
  text,
  targetLanguage,
  inferenceModel = getDefaultUserInferenceModel(),
  options = {},
) {
  const normalizedText = typeof text === 'string' ? text.trim() : '';
  if (!normalizedText) {
    return typeof text === 'string' ? text : '';
  }

  const normalizedTargetLanguage = typeof targetLanguage === 'string'
    ? targetLanguage.trim()
    : '';
  const detectSourceLanguage = options.detectSourceLanguage === true;
  const returnMetadata = options.returnMetadata === true;
  const targetLanguageCode = normalizeDetectedLanguageCode(options.targetLanguageCode) || '';
  if (!normalizedTargetLanguage && !detectSourceLanguage) {
    throw new Error('targetLanguage is required to translate speech.');
  }

  const SpeechTranslation = detectSourceLanguage
    ? z.object({
      sourceLanguage: z.string(),
      translation: z.string(),
    })
    : z.object({
      translation: z.string(),
    });
  const translationInstruction = normalizedTargetLanguage
    ? `Translate the supplied speech text into ${normalizedTargetLanguage}. If it is already in ${normalizedTargetLanguage}, return the input text verbatim as the translation.`
    : 'Return the supplied speech text verbatim in the translation field; do not translate it.';
  const messageList = [
    {
      role: 'developer',
      content: [
        translationInstruction,
        ...(detectSourceLanguage
          ? ['Identify the primary language of the supplied speech and return its lowercase ISO 639-1 code in sourceLanguage.']
          : []),
        'Translate only the spoken text. Preserve meaning, speaker point of view, proper nouns, numbers, and punctuation.',
        'Do not add explanations, labels, quotation marks, stage directions, or delivery instructions.',
      ].join(' '),
    },
    {
      role: 'user',
      content: normalizedText,
    },
  ];
  const modelName = getModelForUserInferenceModel(inferenceModel);
  const createChatCompletion = typeof options.createChatCompletion === 'function'
    ? options.createChatCompletion
    : createCompatibleChatCompletion;
  const response = await createChatCompletion(openai, {
    messages: messageList,
    model: modelName,
    response_format: zodResponseFormat(SpeechTranslation, 'speech_translation'),
  });
  const responseMessage = response?.choices?.[0]?.message;

  let parsedResponse = responseMessage?.parsed;
  if (!parsedResponse) {
    const rawContent = Array.isArray(responseMessage?.content)
      ? responseMessage.content
        .map((part) => (typeof part === 'string' ? part : part?.text || ''))
        .join('')
      : responseMessage?.content;
    if (typeof rawContent !== 'string' || !rawContent.trim()) {
      throw new Error('Speech translation returned an empty response.');
    }
    try {
      parsedResponse = JSON.parse(rawContent);
    } catch (error) {
      const parseError = new Error('Failed to parse speech translation response as JSON.');
      parseError.cause = error;
      throw parseError;
    }
  }

  const translatedText = typeof parsedResponse?.translation === 'string'
    ? parsedResponse.translation.trim()
    : '';
  if (!translatedText) {
    throw new Error('Speech translation returned empty text.');
  }

  if (returnMetadata) {
    const sourceLanguage = normalizeDetectedLanguageCode(parsedResponse?.sourceLanguage) || '';
    if (detectSourceLanguage && !sourceLanguage) {
      throw new Error('Speech language detection returned an invalid language code.');
    }
    const translationRequired = Boolean(
      targetLanguageCode && sourceLanguage && targetLanguageCode !== sourceLanguage,
    );
    return {
      text: translationRequired ? translatedText : text,
      sourceLanguage: sourceLanguage || null,
      translationRequired,
    };
  }

  return translatedText;
}




export async function createAudioEffectInstructionsForMovieTranscript(
  inputPrompt,
  movieTranscript,
  videoTone,
  userInferenceModel = 'gpt-5.6-sol',
) {
  // Check if the input is a valid string
  if (typeof inputPrompt !== 'string' || inputPrompt.trim() === '') {
    throw new Error('Invalid inputPrompt: must be a non-empty string');
  }

  await getDBConnectionString();
  
  const systemPrompt = getToneAndPronunciationForTranscript(videoTone);


  const messageList = [
    {
      role: "developer",
      content: systemPrompt,
    },
    {
      role: "user",
      content: `User Input prompt ${inputPrompt}`,
    },
    {
      role: "user",
      content: `Movie Transcript ${JSON.stringify(movieTranscript)}`,
    },
    {
      role: "user",
      content: "Create a sounds with emotions object based on the movie transcript and the user input.",
    }
  ];

  const inferenceModel = userInferenceModel;

  const modelName = getModelForUserInferenceModel(inferenceModel);



  const SoundsWithEmotions = z.object({
    sounds: z.array(z.object({
      sceneIndex: z.string(),
      Affect: z.string(),
      Tone: z.string(),
      Emotion: z.string(),
      Pronunciation: z.string(),
      Pause: z.string()
    }))
  });


  const response = await createCompatibleChatCompletion(openai, {
    messages: messageList,
    model: modelName,
    response_format: zodResponseFormat(SoundsWithEmotions, "sounds_with_emotions"),
  });


  const resData = response.choices[0].message;
  let responseContent;

  if (resData?.parsed) {
    responseContent = resData.parsed;
  } else {
    let rawContent = resData?.content ?? '';

    if (Array.isArray(rawContent)) {
      rawContent = rawContent
        .map((part) => {
          if (typeof part === 'string') {
            return part;
          }

          if (part && typeof part === 'object' && 'text' in part) {
            return part.text;
          }

          return '';
        })
        .join('');
    }

    if (typeof rawContent !== 'string') {
      throw new Error('Invalid LLM response: expected string content that can be parsed as JSON.');
    }

    try {
      responseContent = JSON.parse(rawContent);
    } catch (error) {
      const parseError = new Error(`Failed to parse sounds_with_emotions response as JSON.`);
      parseError.cause = error;
      throw parseError;
    }
  }

  return responseContent;

}
