

import OpenAI from "openai";
import { z } from "zod";
import { zodResponseFormat } from "openai/helpers/zod";
import { getPublicationMetadataInferenceSettings } from "../../consts/InferenceModels.js";
import { createCompatibleChatCompletion } from "../ai_utils/OpenAICompat.js";
import { buildPublicationMetadataInput } from "../publication/Transcript.js";

const API_KEY = process.env.OPENAI_API_KEY;
const openai = new OpenAI({ apiKey: API_KEY || '' });


export async function extractMetaForMovieResourceList(
  resourceList,
  {
    originalPrompt = '',
    inferenceModel = null,
    onInferenceResponse = null,
    createChatCompletion = createCompatibleChatCompletion,
  } = {},
) {
  const metadataInput = buildPublicationMetadataInput(resourceList, originalPrompt);
  const titleAndDescription = await getTitleAndDescription(metadataInput, inferenceModel, {
    onInferenceResponse,
    createChatCompletion,
  });

  return {
    title: titleAndDescription.title,
    description: titleAndDescription.description,
  };
}


async function getTitleAndDescription(
  resourceList,
  inferenceModel,
  { onInferenceResponse = null, createChatCompletion = createCompatibleChatCompletion } = {},
) {

  const systemPrompt = 'You generate publication metadata for a movie from its transcript and original prompt. Return only a concise title and a clear description.';
  const userPrompt = `Generate the title and description for this movie:\n${JSON.stringify(resourceList)}`;

  const messageList = [
    {
      role: "developer",
      content: systemPrompt,
    },
    {
      role: "user",
      content: userPrompt,
    },
  ];

  const TitleAndDescription = z.object({
    title: z.string().trim().min(1).max(160),
    description: z.string().trim().min(1).max(2000),
  });

  const inferenceSettings = getPublicationMetadataInferenceSettings(inferenceModel);
  const response = await createChatCompletion(openai, {
    messages: messageList,
    ...inferenceSettings,
    response_format: zodResponseFormat(TitleAndDescription, "title_and_description"),
  });

  if (typeof onInferenceResponse === 'function') {
    await onInferenceResponse({
      stage: 'publication_metadata_generation',
      attempt: 1,
      model: response?.model || inferenceSettings.model,
      usage: response?.usage || null,
    });
  }

  const resData = response.choices[0].message;
  const responseContent = resData?.parsed || JSON.parse(resData?.content || '');
  return TitleAndDescription.parse(responseContent);

}
