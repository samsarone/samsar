

import OpenAI from "openai";
import { z } from "zod";
import { zodResponseFormat } from "openai/helpers/zod";
import { PUBLICATION_METADATA_INFERENCE_SETTINGS } from "../../consts/InferenceModels.js";
import { createCompatibleChatCompletion } from "../ai_utils/OpenAICompat.js";
import { buildPublicationMetadataInput } from "../publication/Transcript.js";

const API_KEY = process.env.OPENAI_API_KEY;
const openai = new OpenAI({ apiKey: API_KEY || '' });


export async function extractMetaForMovieResourceList(resourceList, { originalPrompt = '' } = {}) {
  const metadataInput = buildPublicationMetadataInput(resourceList, originalPrompt);
  const titleAndDescription = await getTitleAndDescription(metadataInput);

  return {
    title: titleAndDescription.title,
    description: titleAndDescription.description,
  };
}


async function getTitleAndDescription(resourceList) {

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
    title: z.string(),
    description: z.string(),
  });

  const response = await createCompatibleChatCompletion(openai, {
    messages: messageList,
    ...PUBLICATION_METADATA_INFERENCE_SETTINGS,
    response_format: zodResponseFormat(TitleAndDescription, "title_and_description"),
  });

  const resData = response.choices[0].message;
  const responseContent = JSON.parse(resData.content);
  return responseContent;

}
