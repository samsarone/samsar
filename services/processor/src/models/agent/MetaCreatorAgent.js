

import OpenAI from "openai";
import { z } from "zod";
import { zodResponseFormat } from "openai/helpers/zod";
import { getDBConnectionString } from "../DBString.js";
import { getDefaultUserInferenceModel } from "../../consts/InferenceModels.js";
import { createCompatibleChatCompletion } from "../ai_utils/OpenAICompat.js";
import { getModelForUserInferenceModel } from "./ModelUtils.js";

import TagCloud from "../../schema/content/TagCloud.js";
const API_KEY = process.env.OPENAI_API_KEY;
const openai = new OpenAI({ apiKey: API_KEY || '' });


export async function extractMetaForMovieResourceList(resourceList) {
  const titleAndDescription = await getTitleAndDescription(resourceList);
  const metaTags = await getMetaTags(resourceList);

  return {
    title: titleAndDescription.title,
    description: titleAndDescription.description,
    tags: metaTags,
  };
}


async function getTitleAndDescription(resourceList) {

  const systemPrompt = `You are an assistant for a tool that takes a movie transcript and assigns a title and a description to it.`;

  const messageList = [
    {
      role: "developer",
      content: systemPrompt,
    },
    {
      role: "user",
      content: JSON.stringify(resourceList),
    },
  ];

  const modelName = getModelForUserInferenceModel(getDefaultUserInferenceModel());


  const TitleAndDescription = z.object({
    title: z.string(),
    description: z.string(),
  });

  const response = await createCompatibleChatCompletion(openai, {
    messages: messageList,
    model: modelName,
    response_format: zodResponseFormat(TitleAndDescription, "title_and_description"),
  });

  const resData = response.choices[0].message;
  const responseContent = JSON.parse(resData.content);
  return responseContent;

}

async function getMetaTags(resourceList) {
  const systemPrompt = `You are an assistant for a tool that takes a movie transcript and assigns meta tags to it.
  Create at-least 20 tags for the given movie transcript, find best matches from list of existing tags if possible.
  Add new tags if required.
  Give the response as a single list of comma separated tags.
   `;

  await getDBConnectionString();

  const tagData = await TagCloud.find({});
  const tagList = tagData.map((tag) => tag.tagName).join(", ");




  const messageList = [
    {
      role: "developer",
      content: systemPrompt,
    },
    {
      role: "user",
      content: `Existing tag list is ${tagList}`,
    },
    {
      role: "user",
      content: JSON.stringify(resourceList),
    },
  ];


  const modelName = getModelForUserInferenceModel(getDefaultUserInferenceModel());


  // This function call should send 'messageList' to your AI service and
  // return the structured JSON with extracted meta tags.
  const response = await createCompatibleChatCompletion(openai, {
    messages: messageList,
    model: modelName,
  });


  const resData = response.choices[0].message;
  const responseContent = resData.content.split(",").map((tag) => tag.trim());
  return responseContent;

}
