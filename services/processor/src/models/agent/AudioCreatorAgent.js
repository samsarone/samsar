


import OpenAI from "openai";
import { z } from "zod";
import { zodResponseFormat } from "openai/helpers/zod";
import { getDBConnectionString } from "../DBString.js";
import { getModelForUserInferenceModel } from "./ModelUtils.js";
import { createCompatibleChatCompletion } from "../ai_utils/OpenAICompat.js";
import {
  INFERENCE_MODELS,
  getDefaultUserInferenceModel,
} from "../../consts/InferenceModels.js";
import { normalizeDetectedLanguageCode } from '../../consts/SupportedLanguages.js';
import {
  getSubtitleAlignmentMapCoverage,
  normalizeSubtitleAlignmentMap,
  repairSubtitleAlignmentMapTranslationCoverage,
} from '../movie_session/SubtitleAlignmentMapping.js';


import TagCloud from "../../schema/content/TagCloud.js";
const API_KEY = process.env.OPENAI_API_KEY;
const openai = new OpenAI({ apiKey: API_KEY || '' });

import { getToneAndPronunciationForTranscript } from "./system_prompts/AudioCreator.js";


const MAX_SPEECH_TRANSLATION_ALIGNMENT_ATTEMPTS = 3;

function resolveSpeechTranslationValidationAttempts(value) {
  if (value === undefined) {
    return MAX_SPEECH_TRANSLATION_ALIGNMENT_ATTEMPTS;
  }

  const parsedValue = Number(value);
  if (!Number.isFinite(parsedValue)) {
    return MAX_SPEECH_TRANSLATION_ALIGNMENT_ATTEMPTS;
  }

  return Math.min(
    MAX_SPEECH_TRANSLATION_ALIGNMENT_ATTEMPTS,
    Math.max(1, Math.floor(parsedValue)),
  );
}

function getParsedSpeechTranslationResponse(response) {
  const responseMessage = response?.choices?.[0]?.message;
  const parsedResponse = responseMessage?.parsed;
  if (parsedResponse) {
    return parsedResponse;
  }

  const rawContent = Array.isArray(responseMessage?.content)
    ? responseMessage.content
      .map((part) => (typeof part === 'string' ? part : part?.text || ''))
      .join('')
    : responseMessage?.content;
  if (typeof rawContent !== 'string' || !rawContent.trim()) {
    throw new Error('Speech translation returned an empty response.');
  }

  try {
    return JSON.parse(rawContent);
  } catch (error) {
    const parseError = new Error('Failed to parse speech translation response as JSON.');
    parseError.cause = error;
    throw parseError;
  }
}

function buildSpeechTranslationAlignmentMessages({
  normalizedText,
  translatedText,
  targetLanguage,
  speakerCharacterName,
  validationFailure,
}) {
  const developerInstructions = [
    'Build an ordered subtitleAlignmentMap between the immutable source speech and immutable translated subtitle text supplied by the user.',
    'Do not translate, rewrite, summarize, or paraphrase either immutable text.',
    'Each sourceText value must copy an exact contiguous word or shortest meaningful phrase from sourceSpeechText.',
    'Each translatedText value must copy its corresponding exact contiguous word or phrase from translatedSubtitleText.',
    'Collectively cover every source word exactly once in source order and all translated subtitle text exactly once in translated order.',
    'Keep punctuation attached to the nearest word or phrase; never include speaker labels in the mapping.',
    ...(speakerCharacterName
      ? [
        `Translate or localize the separate speaker label into ${targetLanguage} and return it in subtitleSpeakerCharacterName. Preserve a proper name when it should not be translated.`,
      ]
      : []),
  ];
  if (!validationFailure) {
    return [
      { role: 'developer', content: developerInstructions.join(' ') },
      {
        role: 'user',
        content: JSON.stringify({
          sourceSpeechText: normalizedText,
          translatedSubtitleText: translatedText,
          ...(speakerCharacterName ? { speakerCharacterName } : {}),
        }),
      },
    ];
  }

  return [
    { role: 'developer', content: developerInstructions.join(' ') },
    {
      role: 'developer',
      content: [
        `The prior alignment response failed semantic validation: ${validationFailure}`,
        'Return a new mapping that copies only from the two immutable texts and corrects that validation failure.',
      ].join(' '),
    },
    {
      role: 'user',
      content: JSON.stringify({
        sourceSpeechText: normalizedText,
        translatedSubtitleText: translatedText,
        ...(speakerCharacterName ? { speakerCharacterName } : {}),
      }),
    },
  ];
}

function getSpeechTranslationAlignmentValidationError({
  subtitleAlignmentMap,
  normalizedText,
  translatedText,
  speakerCharacterName,
  translatedSpeakerCharacterName,
}) {
  if (!subtitleAlignmentMap.length) {
    return 'Speech translation returned an empty subtitle alignment map.';
  }

  const alignmentCoverage = getSubtitleAlignmentMapCoverage(
    subtitleAlignmentMap,
    normalizedText,
    translatedText,
  );
  if (!alignmentCoverage.sourceMatches) {
    return 'Speech translation subtitle alignment map does not completely cover the source speech.';
  }
  if (!alignmentCoverage.translationMatches) {
    return 'Speech translation subtitle alignment map does not completely cover the translated speech.';
  }
  if (speakerCharacterName && !translatedSpeakerCharacterName) {
    return 'Speech translation returned an empty localized subtitle speaker name.';
  }

  return null;
}


export async function translateSpeech(
  text,
  targetLanguage,
  _inferenceModel = getDefaultUserInferenceModel(),
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
  const includeSubtitleAlignment = options.includeSubtitleAlignment === true;
  const speakerCharacterName = typeof options.speakerCharacterName === 'string'
    ? options.speakerCharacterName.trim()
    : '';
  const targetLanguageCode = normalizeDetectedLanguageCode(options.targetLanguageCode) || '';
  if (!normalizedTargetLanguage && !detectSourceLanguage) {
    throw new Error('targetLanguage is required to translate speech.');
  }

  const speechTranslationShape = {
    ...(detectSourceLanguage ? { sourceLanguage: z.string() } : {}),
    translation: z.string(),
  };
  const SpeechTranslation = z.object(speechTranslationShape);
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
  // Subtitle translation is an OpenAI-owned pipeline regardless of the
  // inference model selected for narrative or image/video generation. The
  // compatible client still permits the configured Samsar API fallback when
  // The standalone edition may have no native OpenAI key.
  const modelName = INFERENCE_MODELS.Inference;
  const createChatCompletion = typeof options.createChatCompletion === 'function'
    ? options.createChatCompletion
    : createCompatibleChatCompletion;
  const response = await createChatCompletion(openai, {
    messages: messageList,
    model: modelName,
    response_format: zodResponseFormat(SpeechTranslation, 'speech_translation'),
  });
  const parsedResponse = getParsedSpeechTranslationResponse(response);

  const translatedText = typeof parsedResponse?.translation === 'string'
    ? parsedResponse.translation.trim()
    : '';
  if (!translatedText) {
    throw new Error('Speech translation returned empty text.');
  }

  const sourceLanguage = returnMetadata
    ? normalizeDetectedLanguageCode(parsedResponse?.sourceLanguage) || ''
    : '';
  if (detectSourceLanguage && !sourceLanguage) {
    throw new Error('Speech language detection returned an invalid language code.');
  }
  const metadataTranslationRequired = Boolean(
    targetLanguageCode && sourceLanguage && targetLanguageCode !== sourceLanguage,
  );
  const translatedSubtitleMetadataRequired = includeSubtitleAlignment &&
    (!returnMetadata || metadataTranslationRequired);

  let subtitleAlignmentMap = [];
  let translatedSpeakerCharacterName = '';
  if (translatedSubtitleMetadataRequired) {
    const SpeechTranslationAlignment = z.object({
      subtitleAlignmentMap: z.array(z.object({
        sourceText: z.string(),
        translatedText: z.string(),
      })),
      ...(speakerCharacterName
        ? { subtitleSpeakerCharacterName: z.string() }
        : {}),
    });
    const maxValidationAttempts = resolveSpeechTranslationValidationAttempts(
      options.maxValidationAttempts,
    );
    let validationFailure = null;
    let bestCompleteAlignmentMap = [];
    let bestTranslatedSpeakerCharacterName = '';

    for (let attempt = 1; attempt <= maxValidationAttempts; attempt += 1) {
      const alignmentResponse = await createChatCompletion(openai, {
        messages: buildSpeechTranslationAlignmentMessages({
          normalizedText,
          translatedText,
          targetLanguage: normalizedTargetLanguage,
          speakerCharacterName,
          validationFailure,
        }),
        model: modelName,
        response_format: zodResponseFormat(
          SpeechTranslationAlignment,
          'speech_translation_alignment',
        ),
      });
      const parsedAlignment = getParsedSpeechTranslationResponse(alignmentResponse);
      let candidateAlignmentMap = normalizeSubtitleAlignmentMap(
        parsedAlignment?.subtitleAlignmentMap,
      );
      const candidateSpeakerCharacterName = speakerCharacterName &&
        typeof parsedAlignment?.subtitleSpeakerCharacterName === 'string'
        ? parsedAlignment.subtitleSpeakerCharacterName.trim()
        : '';
      let candidateCoverage = getSubtitleAlignmentMapCoverage(
        candidateAlignmentMap,
        normalizedText,
        translatedText,
      );
      if (candidateCoverage.sourceMatches && !candidateCoverage.translationMatches) {
        const repairedAlignmentMap = repairSubtitleAlignmentMapTranslationCoverage(
          candidateAlignmentMap,
          normalizedText,
          translatedText,
        );
        if (repairedAlignmentMap.length > 0) {
          candidateAlignmentMap = repairedAlignmentMap;
          candidateCoverage = getSubtitleAlignmentMapCoverage(
            candidateAlignmentMap,
            normalizedText,
            translatedText,
          );
        }
      }
      if (candidateCoverage.isComplete) {
        bestCompleteAlignmentMap = candidateAlignmentMap;
      }
      if (candidateSpeakerCharacterName) {
        bestTranslatedSpeakerCharacterName = candidateSpeakerCharacterName;
      }

      validationFailure = getSpeechTranslationAlignmentValidationError({
        subtitleAlignmentMap: candidateAlignmentMap,
        normalizedText,
        translatedText,
        speakerCharacterName,
        translatedSpeakerCharacterName: candidateSpeakerCharacterName,
      });
      if (!validationFailure) {
        subtitleAlignmentMap = candidateAlignmentMap;
        translatedSpeakerCharacterName = candidateSpeakerCharacterName;
        break;
      }
    }

    if (!subtitleAlignmentMap.length) {
      subtitleAlignmentMap = bestCompleteAlignmentMap.length
        ? bestCompleteAlignmentMap
        : [{ sourceText: normalizedText, translatedText }];
      translatedSpeakerCharacterName = bestTranslatedSpeakerCharacterName || '';
    }

    // A valid phrase map must not silently fall back to an untranslated display
    // label. Alignment responses normally include the localized speaker name,
    // but a dedicated translation-only call gives that metadata an independent,
    // validated fallback without changing the immutable subtitle translation.
    if (speakerCharacterName && !translatedSpeakerCharacterName) {
      const localizedSpeakerCharacterName = await translateSpeech(
        speakerCharacterName,
        normalizedTargetLanguage,
        _inferenceModel,
        { createChatCompletion },
      );
      translatedSpeakerCharacterName = typeof localizedSpeakerCharacterName === 'string'
        ? localizedSpeakerCharacterName.trim()
        : '';
    }

    const fallbackValidationError = getSpeechTranslationAlignmentValidationError({
      subtitleAlignmentMap,
      normalizedText,
      translatedText,
      speakerCharacterName,
      translatedSpeakerCharacterName,
    });
    if (fallbackValidationError) {
      throw new Error(fallbackValidationError);
    }
  }

  if (returnMetadata) {
    return {
      text: metadataTranslationRequired ? translatedText : text,
      sourceLanguage: sourceLanguage || null,
      translationRequired: metadataTranslationRequired,
      ...(includeSubtitleAlignment
        ? {
          subtitleAlignmentMap: metadataTranslationRequired ? subtitleAlignmentMap : [],
          subtitleSpeakerCharacterName: metadataTranslationRequired
            ? translatedSpeakerCharacterName || null
            : null,
        }
        : {}),
    };
  }

  if (includeSubtitleAlignment) {
    return {
      text: translatedText,
      subtitleAlignmentMap,
      subtitleSpeakerCharacterName: translatedSpeakerCharacterName || null,
    };
  }

  return translatedText;
}




export async function createAudioEffectInstructionsForMovieTranscript(
  inputPrompt,
  movieTranscript,
  videoTone,
  userInferenceModel = 'gpt-5.6-sol',
  options = {},
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

  if (typeof options?.onInferenceResponse === 'function') {
    await options.onInferenceResponse({
      stage: 'movie_resource_list_enrichment',
      attempt: 1,
      model: response?.model || modelName,
      usage: response?.usage || null,
      response,
    });
  }


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
