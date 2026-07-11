


import OpenAI from "openai";
import { z } from "zod";
import { zodResponseFormat } from "openai/helpers/zod";
import { getDBConnectionString } from "../DBString.js";
import { getModelForUserInferenceModel } from "./ModelUtils.js";
import { createCompatibleChatCompletion } from "../ai_utils/OpenAICompat.js";


import TagCloud from "../../schema/content/TagCloud.js";
const API_KEY = process.env.OPENAI_API_KEY;
const openai = new OpenAI({ apiKey: API_KEY || '' });

import { getToneAndPronunciationForTranscript } from "./system_prompts/AudioCreator.js";




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
