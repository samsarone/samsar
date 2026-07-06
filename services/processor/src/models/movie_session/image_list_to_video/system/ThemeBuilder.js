

import OpenAI from "openai";
import { z } from "zod";
import { zodResponseFormat } from "openai/helpers/zod";
import { getModelForUserInferenceModel } from "../../utils/ModelUtils.js";


import { sendSessionThemeMessageRequest } from "../../../agent/MovieCreatorAgent.js";
import { normalizeInferenceModel } from "../../../../consts/InferenceModels.js";

const API_KEY = process.env.OPENAI_API_KEY;
const openai = new OpenAI({ apiKey: API_KEY || '' });

export async function extractThemeFromInputPayload(payload, inferenceModel = 'gpt-5.5') {

  const { prompt, metadata, imageDescriptionList } = payload;

  const systemPrompt = getThemeForResourceJson();

  const messageList = [
    {
      role: "developer",
      content: systemPrompt,
    },
    {
      role: "user",
      content: `Metadata: ${JSON.stringify(metadata)}`
    },
    {
      role: "user",
      content: `Scene Starting Frame Descriptions: ${JSON.stringify(imageDescriptionList)}`
    },
    {
      role: "user",
      content: prompt,
    },
  ];

  inferenceModel = normalizeInferenceModel(inferenceModel);

  // This function call should send 'messageList' to your AI service and
  // return the structured JSON with extracted theme data.
  const themeData = await sendSessionThemeMessageRequest(messageList, inferenceModel);
  return themeData;
}

export function getThemeForResourceJson() {

  const themeForResourceJsonSystemPrompt = `
You are a creative assistant for a generative AI tool that builds concise, accurate theme JSON for marketing/ad video creation.
Use the start-frame descriptions for each scene, metadata, and user prompt to make the theme aligned to context and product.
Deliver themes that enable striking, benefit-led consumer ads that make viewers want the product while staying factual and grounded.
{
  actors: [
    { name: "<name>", keywords: ["<keywords>"] },
    ...
  ],
  places: [
    { name: "<name>", keywords: ["<keywords>"] },
    ...
  ],
  objects: [
    { name: "<name>", keywords: ["<keywords>"] },
     ...
  ],
  subject: ["<keywords>"],
  setting: ["<keywords>"],
  style: ["<keywords>"],
  general: ["<keywords>"],
  custom: ["<keywords>"]
}
Guidelines:
- Follow style/cinematic cues from image descriptions and prompt; do not introduce conflicting settings or invented facts.
- Keep every attribute realistic and tied to the provided scenario; make the product/brand central and consumer-appealing.
- Enhance user styling/theme keywords with complementary, consistent terms that reinforce marketing tone (benefit/proof/CTA ready).
- Enrich with historically or geographically relevant details only when accurate.
- Ensure keywords stay content-filter-friendly and maintain a cohesive cinematic style.
- If custom keywords are present, emphasize them and reflect resulting custom settings in the custom field.
${themeActorAdditionSystemPrompt}
${themePlaceAdditionSystemPrompt}
${themeObjectsAdditionSystemPrompt}
${themeSceneMetaAdditionalSystemPrompt}
`;
return themeForResourceJsonSystemPrompt;

}




export const themeSceneMetaAdditionalSystemPrompt =
  `Identify the primary subject and central theme, adding titles and relevant keywords under subject.
Add comprehensive keywords for subjects, settings, styles/techniques, and general aspects; use your knowledge to keep technical, historical, or culturally specific themes authentic.
Include cinematic details in the style section to keep scenes consistent; add meta cues (e.g., futuristic) when context implies.
Keep all keywords cohesive, non-conflicting, and stylistically consistent while expanding cinematic styles as needed.
`;


export const themeObjectsAdditionSystemPrompt = `
Extract all objects of interest (items, vehicles, tools, weapons) with grounded keywords for names and attributes.
Enrich with accurate details from your knowledge base when helpful, staying aligned to the subject, setting, period, and overall context of the story and theme.
`;

export const themePlaceAdditionSystemPrompt = `
Extract all places (indoor/outdoor locations, cities, countries, planets) with grounded keywords for names and attributes.
Enrich with accurate details from your knowledge base when helpful, staying aligned to the subject, setting, period, and overall context of the story and theme.
`;

export const themeActorAdditionSystemPrompt =
  `Extract all actors (humans, animals, beasts) except the narrator from the image descriptions of the starting frame and inferred references, favoring relatable consumer or brand-rep archetypes suited to the product context.
Provide period and context-appropriate keywords for each character's traits, including race, religion, gender, skin color, clothing and its color, accessories, body type, height, build, age group, demographic, facial structure, skin tone, hairstyle, hair type, hair color, hair length, eye shape and color, facial features, complexion, and other identifying features.
Avoid minors and avoid non-binary or gender non-conforming characters when possible; for ambiguous cases prefer friendly humanoid robot characters. For science-fiction, include relevant futuristic enhancements, gear, and accessories.
Generate at least thirty keywords for physical, ethnic, emotional, and contextual traits such as ethnicity, nationality, facial expressions, mood, appearance, charm, and symmetry. Ensure clothing and accessories are detailed and appropriate to the period and context.
Describe the characters with accuracy and rich detail using your knowledge base; do not add any attributes for the narrator.
For animals/beasts, include features like fur or skin color, patterns, size, body structure, and other relevant characteristics.`;
