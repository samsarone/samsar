import OpenAI from "openai";
import { z } from "zod";
import { zodResponseFormat } from "openai/helpers/zod";

import { getFunctionCallParamsForModel , getModelForUserInferenceModel} from './agent/ModelUtils.js';
import { createCompatibleChatCompletion } from "./ai_utils/OpenAICompat.js";

const API_KEY = process.env.OPENAI_API_KEY;


const openai = new OpenAI({ apiKey: API_KEY || '' });


export async function generateThemeKeywords(textListString, aspectRatio = '1:1', userInferenceModel = 'gpt-5.5') {
  const themeAspectRatioPrompt = getThemeAspectRatioPrompt(aspectRatio);

  let systemPrompt = `
    You are a creative assistant for a generative AI tool that creates images from text prompts. Your task is to provide detailed theme and context keywords in the following structured format which can be used to recreate the narrative storyline accurately in a generative AI engine like DALL-E 3.:
    {
      actors: [
        { name: "<name>", keywords: ["<keywords>"] },
        ...
      ],
      places: [
        { name: "<name>", keywords: ["<keywords>"] },
        ...
      ],
      subject: ["<keywords>"],
      setting: ["<keywords>"],
      style: ["<keywords>"],
      general: ["<keywords>"],
      custom: ["<keywords>"]
    }

    Enrich keywords with historically and geographically relevant details using your own knowledge where applicable.
    ${themeActorAdditionSystemPrompt}
    ${themePlaceAdditionSystemPrompt}
    ${themeSceneMetaAdditionalSystemPrompt}
    Ensure all text and keywords are content filter-friendly, maintaining a consistent cinematic style and visual elements.
    If custom keywords are present, emphasize them heavily and include resulting custom settings in the custom keywords field.
  `;

  const userPrompt = `Generate structured theme keywords for the following text: ${textListString}`;

  const messageList = [
    { role: 'developer', content: systemPrompt },
    { role: 'user', content: userPrompt }
  ];

  const content = await sendSessionThemeMessageRequest(messageList, userInferenceModel);
  return content;
}


export async function updateThemeWithText(themeJson, textListString, aspectRatio = '1:1', userInferenceModel = 'gpt-5.5') {

  const themeAspectRatioPrompt = getThemeAspectRatioPrompt(aspectRatio);

  const systemPrompt = `
    You are a creative assistant for a generative AI tool that takes a base theme and a text input and creates a new theme from it.
    The input theme is structured as follows:
    {
      actors: [
        { name: "<name>", keywords: ["<keywords>"] },
        ...
      ],
      places: [
        { name: "<name>", keywords: ["<keywords>"] },
        ...
      ],
      subject: ["<keywords>"],
      setting: ["<keywords>"],
      style: ["<keywords>"],
      general: ["<keywords>"],
      custom: ["<keywords>"]
    }

    In the output theme-
    Extract all actors from the base theme which are present in the text and add the keywords to output.
    Add additional keywords needed for the actors based on the text.
    For new actors in the text but not the in theme generate new actor entries based on input and context.
    Ensure the actor traits are consistent with the following rules-
    ${themeActorAdditionSystemPrompt}
    Extract all places from the base theme which are present or inferred in the text and add the keywords to output.
    Add additional keywords needed for the places based on the text.
    For new places in the text but not in the theme generate new place entries based on input and context.
    Ensure that the place characteristics are consistent with the following rules-
    ${themePlaceAdditionSystemPrompt}

    Add the subject, setting, style, general and custom keywords from the base theme to the output theme.
    Infer additional subject, setting, style, general and custom keywords if needed from the text base on the following rules-
    ${themeSceneMetaAdditionalSystemPrompt}
  `;

  const userPrompt = `Create a new theme derived from the base theme, based on the following text: ${textListString}`;

  const messageList = [
    { role: 'developer', content: systemPrompt },
    { role: 'user', content: `Existing theme: ${JSON.stringify(themeJson)}` },
    { role: 'user', content: userPrompt },
  ];

  const updatedTheme = await sendSessionThemeMessageRequest(messageList, userInferenceModel);


  // Return the updated theme JSON
  return updatedTheme;
}


export async function generatePromptsForText(textList, themeJson, aspectRatio = '1:1',
  userInferenceModel = 'gpt-5.5', shortForm = false) {


  const baseAspectRatioUnitPrompt = getBaseAspectRatioUnitPrompt(aspectRatio);


  let systemPrompt = `
  You are a creative assistant for a generative AI tool that updates a storyline provided as a list of dialogues within a narrative, based on a given subject and theme, to render it accurately in a generative text-to-image AI engine.
  ${baseAspectRatioUnitPrompt}
  The provided text contains dialogs separated by line breaks, with each line representing a narrative dialogue in the storyline.
  You must provide one output prompt for each input dialogue, ensuring it is suitable for rendering a historically and contextually accurate cinematic scene in accordance with the narrative dialogue and the overall theme without including text or labels.

  The theme JSON includes:
    - subject: ["<keywords>"],
    - actors: [{ name: "<name>", keywords: ["<keywords>"] }, ...],
    - places: [{ name: "<name>", keywords: ["<keywords>"] }, ...],
    - setting: ["<keywords>"],
    - style: ["<keywords>"],
    - general: ["<keywords>"],
    - custom: ["<keywords>"]

  For each line-item separated by line breaks in the provided storyline narrative:
    - If the line item is part of the narrative-
      ${optimizedBaseDialogSystemPrompt}
    - If the line item is an introduction line or not part of the narrative, do the following-
      Provide a prompt result in a single paragraph that accurately represents the summary of the entire narrative in the provided cinematic style and subject as a visual-only image without text.
  ${baseModerationSystemPrompt} 
`;

  if (shortForm) {

    systemPrompt = `
  You are a creative assistant for a generative AI tool that updates a storyline provided as a list of dialogues within a narrative, based on a given subject and theme, to create a concise prompt to render it accurately in a generative AI engine like DALL-E 3.
  ${baseAspectRatioUnitPrompt}
  The provided text contains dialogs separated by line breaks, with each line representing a narrative dialogue in the storyline.
  You must provide one output prompt for each input dialogue, ensuring it is suitable for rendering a historically and contextually accurate cinematic scene in accordance with the narrative dialogue and the overall theme without including text or labels.

  The theme JSON includes:
    - subject: ["<keywords>"],
    - actors: [{ name: "<name>", keywords: ["<keywords>"] }, ...],
    - places: [{ name: "<name>", keywords: ["<keywords>"] }, ...],
    - setting: ["<keywords>"],
    - style: ["<keywords>"],
    - general: ["<keywords>"],
    - custom: ["<keywords>"]

  For each line-item separated by line breaks in the provided storyline narrative:
    - If the line item is part of the narrative-
      ${optimizedBaseDialogSystemPrompt}
    - If the line item is an introduction line or not part of the narrative, do the following-
      Provide a prompt result in a single paragraph that accurately represents the summary of the entire narrative in the provided cinematic style and subject as a visual-only image without text.
  ${baseModerationSystemPrompt}
Ensure that each result line is extremely concise, in a single paragraph and 300-400 characters in length.
`;



  }

  const userPrompt = `Storyline:\n${textList.join('\n')}`;

  const messageList = [
    { role: 'developer', content: systemPrompt },
    { role: 'user', content: `Theme JSON: ${themeJson}` },
    { role: 'user', content: userPrompt },
  ];

  const response = await sendAssistantMessageRequest(messageList, userInferenceModel);

  const responseContent = response.content.split('\n').map(item => item.trim()).filter(Boolean);



  return responseContent;
}


export async function updatePromptWithTheme(prompt, themeJson, aspectRatio = '1:1',
  userInferenceModel = 'gpt-5.5', shortForm = false, videoTone = 'cinematic') {
  const baseAspectRatioPrompt = getBaseAspectRatioPrompt(aspectRatio);


  let videoTonePrompt = null;
  if (videoTone === 'grounded') {
    videoTonePrompt = `Ensure no fantastical elements, the prompt is grounded to reality and no fantasy elements are included.`;

  }

  let systemPrompt = `
    You are an assistant for a generative AI tool that updates the provided prompt with a given subject and theme to render the scene accurately in a generative AI engine like DALL-E 3.
    ${baseAspectRatioPrompt}
    ${videoTonePrompt}
    The theme JSON includes:
      - subject: ["<keywords>"],
      - actors: [{ name: "<name>", keywords: ["<keywords>"] }, ...],
      - setting: ["<keywords>"],
      - style: ["<keywords>"],
      - general: ["<keywords>"]
      - custom: ["<keywords>"]

      ${optimizedBaseDialogSystemPrompt}
              Ensure the result is a single paragraph without line breaks or numbering. Provide one result per input line.
              ${baseModerationSystemPrompt}
  `;

  if (shortForm) {

    systemPrompt = `
    You are an assistant for a generative AI tool that updates the provided prompt with a given subject and theme to render the scene accurately in a generative AI engine in a concise manner.
    Ensure that the result is concise, in a single paragraph and 400-500 characters in length.
    The theme JSON includes:
      - subject: ["<keywords>"],
      - actors: [{ name: "<name>", keywords: ["<keywords>"] }, ...],
      - setting: ["<keywords>"],
      - style: ["<keywords>"],
      - general: ["<keywords>"]
      - custom: ["<keywords>"]

      ${optimizedBaseDialogSystemPrompt}
              Ensure the result is a single paragraph without line breaks or numbering. Provide one result per input line.
              ${baseModerationSystemPrompt}
              Keep each prompt concise, not more than 400-500 characters.
  `;
  }


  const messageList = [
    { role: 'developer', content: systemPrompt },
    { role: 'user', content: `Theme JSON is: ${themeJson}` },
    { role: 'user', content: `Generate prompts from the following input, using the provided theme: ${prompt}` },
  ];

  const response = await sendAssistantMessageRequest(messageList, userInferenceModel);

  return response.content.trim();
}



export async function updateCharacterPromptWithTheme(prompt, themeJson, aspectRatio = '1:1',
  userInferenceModel = 'gpt-5.5', shortForm = false, videoTone = 'cinematic') {
  const baseAspectRatioPrompt = getBaseAspectRatioPrompt(aspectRatio);


  let videoTonePrompt = null;
  if (videoTone === 'grounded') {
    videoTonePrompt = `Ensure no fantastical elements, the prompt is grounded to reality and no fantasy elements are included.`;
  }


  let systemPrompt = `
    You are an assistant for a generative AI tool that updates the provided prompt with a given subject and theme to render the scene accurately in a generative AI engine like DALL-E 3.
    ${baseAspectRatioPrompt}
    ${videoTonePrompt}
    The theme JSON includes:
      - subject: ["<keywords>"],
      - actors: [{ name: "<name>", keywords: ["<keywords>"] }, ...],
      - setting: ["<keywords>"],
      - style: ["<keywords>"],
      - general: ["<keywords>"]
      - custom: ["<keywords>"]

      ${optimizedBaseCharacterDialogSystemPrompt}
              Ensure the result is a single paragraph without line breaks or numbering. Provide one result per input line.
              ${baseModerationSystemPrompt}
  `;

  if (shortForm) {

    systemPrompt = `
    You are an assistant for a generative AI tool that updates the provided prompt with a given subject and theme to render the scene accurately in a generative AI engine in a concise manner.
    Ensure that the result is concise, in a single paragraph and 400-500 characters in length.
    The theme JSON includes:
      - subject: ["<keywords>"],
      - actors: [{ name: "<name>", keywords: ["<keywords>"] }, ...],
      - setting: ["<keywords>"],
      - style: ["<keywords>"],
      - general: ["<keywords>"]
      - custom: ["<keywords>"]

      ${optimizedBaseCharacterDialogSystemPrompt}
              Ensure the result is a single paragraph without line breaks or numbering. Provide one result per input line.
              ${baseModerationSystemPrompt}
              Keep each prompt concise, not more than 400-500 characters.
  `;
  }


  const messageList = [
    { role: 'developer', content: systemPrompt },
    { role: 'user', content: `Theme JSON is: ${themeJson}` },
    { role: 'user', content: `Generate prompts from the following input, using the provided theme: ${prompt}` },
  ];

  const response = await sendAssistantMessageRequest(messageList, userInferenceModel);

  return response.content.trim();
}




export async function updatePromptWithCharacterPOV(prompt, themeKeywords, aspectRatio = '1:1',
  userInferenceModel = 'gpt-5.5', shortForm = false) {
  const baseAspectRatioPrompt = getBaseAspectRatioPrompt(aspectRatio);



  let systemPrompt = `
    You are an assistant for a generative AI tool that updates the provided prompt with a given subject and theme to render the scene accurately in a generative text-to-image.
    ${baseAspectRatioPrompt}
    The theme includes keywords to enforce styles and context.
      ${optimizedBaseCharacterDialogSystemPrompt}
              Ensure the result is a single paragraph without line breaks or numbering. Provide one result per input line.
              ${baseModerationSystemPrompt}
  `;

  if (shortForm) {
    systemPrompt = `
    You are an assistant for a generative AI tool that updates the provided prompt with a given subject and theme to render the scene accurately in a generative AI engine in a concise manner.
    The theme includes keywords to enforce styles and context.
      ${optimizedBaseCharacterDialogSystemPrompt}
              Ensure the result is a single paragraph without line breaks or numbering. Provide one result per input line.
              ${baseModerationSystemPrompt}
              Keep each prompt concise, not more than 400-500 characters.
  `;
  }


  const messageList = [
    { role: 'developer', content: systemPrompt },
    { role: 'user', content: `Theme keywords are: ${themeKeywords}` },
    { role: 'user', content: `Generate prompts from the following input, using the provided theme: ${prompt}` },
  ];

  const response = await sendAssistantMessageRequest(messageList, userInferenceModel);

  return response.content.trim();
}





const themeActorAdditionSystemPrompt = `
Extract all actors (humans, animals, beasts) from the text, including inferred references.
Provide period and context-appropriate keywords for each character's traits, including race, religion, gender, skin color, clothing and its color, accessories, body type, height, build, age group, demographic, facial structure, skin tone, hairstyle, hair type, hair color, hair length, eye shape and color, facial features, complexion, and other identifying features.
In the case of science-fiction characters, include details regarding futuristic enhancements, gear, and accessories.
Generate at least thirty keywords for physical, ethnic, emotional, and contextual traits such as ethnicity, nationality, facial expressions, mood, appearance, charm, and symmetry. Ensure clothing and accessories are described in detail and are appropriate to the period and context.
Include relevant details such as race, age, skin/hair color, body type, and any specific cultural traits that enrich the character description.
Describe the characters with accuracy and rich detail, drawing from your knowledge base and considering the theme.
For animals/beasts, include features like fur or skin color, patterns, size, body structure, and other relevant characteristics.
`;


const themePlaceAdditionSystemPrompt = `
Extract all places (indoor/outdoor locations, cities, countries, planets) and add detailed keywords for attributes, including place names and meta details.
Infer additional keywords from your knowledge base to enrich the description of the place if needed.
Ensure that the place attributes are aligned with the subject, setting, period, and overall context of the story and theme.
`;


const themeSceneMetaAdditionalSystemPrompt = `
Identify the primary subject and central theme, adding titles and relevant keywords under subject.
Add exhaustive keywords for subjects, settings, styles, techniques, and general aspects, inferring from your knowledge base if needed.
For scientific or technical themes, include exhaustive relevant keywords from your knowledge base to maintain authenticity.
For historical or culturally specific themes, include exhaustive relevant keywords from your knowledge base to maintain authenticity.
Add keywords covering the cinematic details in the style section to ensure consistency of scenes.
Add additional meta cinematic details based on the context of the input; for example, for futuristic themes, include futuristic keywords.
Ensure all keywords maintain a consistent cinematic style without mixing conflicting elements.
Infer and expand on cinematic styles as needed, providing detailed, consistent, and cohesive keywords to maintain a consistent cinematic style.
`;




const optimizedBaseDialogSystemPrompt = `
Create a richly detailed, cinematic text-to-image prompt based on the given input line. Do not include any text or labels in the final prompt. Apply the following guidelines using details from both the input line and the theme JSON:

1. Overall Context & Theme
   - Accurately reflect the storyline and theme, including any time-period, geographical, ethnic, and cultural elements.
   - Incorporate relevant keywords from "subject," "general," "style," and any "custom" fields in the theme.
   - Emphasize custom theme keywords if present.
   - Maintain consistency with historical, geographical, and narrative accuracy.

2. Places & Settings
   - Identify and extract any places mentioned in the input line.
   - Match them with corresponding "places" entries in the theme. If none exist, create descriptive settings aligned with the theme.
   - Provide vivid descriptions of locations, including details like time period, weather, mood, architecture, and any other environment-related cues.

3. Characters & Actors
   - For each character reference (direct or indirect), find the closest matching entry in the theme’s "actors." 
     - If no match is found, create a new actor fully aligned with theme and storyline constraints.
   - Include only the attributes needed for scene continuity and image quality, such as broad age group, build, outfit type, posture, expression, and non-identifying appearance. Do not dump every actor keyword into the prompt.
   - Ensure all clothing, accessories, and physical features are appropriate to the time period, setting, and ethnicity.

4. Visual Style & Presentation
   - Integrate style keywords (cinematic, dramatic lighting, specific artistic influences, etc.) from the theme to ensure visual coherence.
   - The final prompt should focus on visual storytelling rather than text descriptions, with an upright orientation and the specified aspect ratio.

5. Accuracy Directives
   - When relevant, include concise natural wording for historical, scientific, technical, or numerical accuracy in the same paragraph.
   - Include any aspect ratio or orientation instructions at the end of the prompt.

Output Format
- Present the final text-to-image prompt in a single paragraph without line breaks or bullet points.
- There must be only one prompt per input line.
`;


export const optimizedBaseCharacterDialogSystemPrompt = `
Create a detailed prompt that visually represents the input line cinematically from the speaker’s point of view, without text or labels, in the context of the storyline and theme suitable for generative AI rendition. Focus exclusively on the speaker; do not include or describe any other characters.

Enforce the subject, general, style, and other theme attributes, emphasizing custom theme keywords if present. Ensure context, theme, and time-period accuracy by inferring details from the input and theme JSON. Extract places or settings from the input line (if any) and align them with the theme’s places. Add vivid, thematically consistent descriptions for each place, including time period, weather, mood, and architecture. Incorporate relevant setting and style keywords for a cinematic and visually coherent scene.

Center the scene around the speaker. The camera should focus on the speaker from a front-facing perspective to enable accurate lip sync. All non-essential elements in the background or setting are secondary; do not show or describe other people, animals, or characters.

Highlight only the speaker attire and physical features needed for continuity, lip sync, and image quality. Use broad non-identifying traits rather than exhaustive feature lists, and avoid protected likenesses or trademarked character recipes. If the input provides details about the speaker’s physicality, attire, or implied environment, weave the relevant details into the prompt in a cinematic, visually appealing manner.

Maintain historical, geographical, ethnic, and numerical accuracy in the storyline, subject, and theme elements. The image must always be upright and maintain the specified aspect ratio. When relevant, include concise natural wording for historical, scientific, technical, or numerical accuracy in the same paragraph, and include any aspect ratio or orientation instruction from the base aspect ratio prompt.
`;








const baseDialogSystemPrompt = `
Create a detailed prompt that visually represents the input line cinematically, without text or labels, in the context of the storyline and theme suitable for generative AI rendition.
Enforce the subject, general, style, and other theme attributes, emphasizing custom theme keywords if present.
Ensure context, theme, and time-period accuracy by inferring details from the input and theme JSON.

Extract places mentioned in the input line, align them with the theme's places, and incorporate relevant keyword matches into the output prompt.
Add a vivid description for the places based on the theme keywords. Ensure place characteristics match the subject and general theme settings and the time period.
Add appropriate keywords for the setting, including time period, location, weather, mood, architecture, and other relevant details.

For each character referenced in the input (people, animals, or beasts), whether direct, indirect, or inferred, find the closest matching "actors" entry from the theme.
Use only the actor attributes that are visually important for this scene and continuity, such as broad age group, build, outfit type, posture, expression, and non-identifying appearance. Do not dump every actor keyword into the prompt.
Accurately infer indirect actor references (e.g., "they", "them", "he", "him") using the storyline, theme, and your knowledge base, then find a match for corresponding "actors" from the theme.
Ensure all physical characteristics and clothing align with the period, ethnicity, geography, race, religion, gender, physical traits, and story context.
If no match is found, create new characters with attributes based on prompt input completely aligned the theme, ensuring the traits such as appearance and clothing match the theme, storyline, and time-period context.
Ensure that inferred as well as new characters are aligned with the theme and storyline.
Describe each main actor clearly but avoid protected likenesses, trademarked character recipes, or excessive identity-specific feature lists.

If the input doesn't contain any characters or actors, create a prompt based on input in the context of the theme and storyline.

Focus on "subject" and "general" theme keywords to determine context and time period.
Incorporate the relevant style keywords for cinematic consistency and visual coherence.
The rendition must be cinematic, visually appealing, and contextually accurate, without text or labels.
Maintain historical, geographical, ethnic, and numerical accuracy in the storyline, subject, and theme elements.
Ensure that the image is always upright and aspect-ratio is maintained.

When relevant, include concise natural wording for historical, scientific, technical, or numerical accuracy in the same paragraph, and include any aspect ratio or orientation instruction from the base aspect ratio prompt.
`;



const baseModerationSystemPrompt = `
  Output one natural image prompt per input line, with no numbering, headings, labels, or policy notes.
  Keep prompts safe for moderation and suitable for direct text-to-image generation.
  If the input or theme references a real person, celebrity, public figure, or copyrighted/trademarked character, rewrite it as an original non-identifying equivalent. Preserve the narrative role, relationship, broad theme, mood, setting, action, camera framing, lighting, and art style, but do not include protected names, exact facial likenesses, logos, signature markings, franchise terms, fictional species labels, transformation names, attack names, exact costume colorways, or distinctive hair/eye/costume combinations.
  Keep the scene coherent and theme-relevant; do not replace it with an unrelated fallback.
`;


const getThemeAspectRatioPrompt = (aspectRatio) => {
  let systemPrompt;
  if (aspectRatio === '16:9') {
    systemPrompt = `
      Add keywords that align with the cinematic style and visual elements of a horizontal aspect ratio, landscape, expansive landscape etc. to the settings, general and style sections.
      Ensure that all theme elements subjects, settings, styles, and general keywords, are suitable for a 16:9 aspect ratio.
      Provide keywords that align with the cinematic style and visual elements of this format, emphasizing wide-screen compositions, panoramic views, and elements that utilize the horizontal space effectively.
    `;
  } else if (aspectRatio === '9:16') {
    systemPrompt = `
      Incorporate keywords that emphasize vertical composition and effective use of vertical space into the settings, general, and style sections.
      Ensure all theme elements—subjects, settings, styles, and general keywords—are suitable for a vertical aspect ratio.
      Focus on elements like towering structures, vertical landscapes, and compositions that naturally fit a taller frame.
    `;
  }
  return systemPrompt;

}

const getBaseAspectRatioPrompt = (aspectRatio) => {
  if (aspectRatio === '16:9') {
    return `
Ensure the image is in a horizontal (landscape) orientation with a 16:9 aspect ratio. Emphasize wide-screen compositions and panoramic views that utilize the horizontal space effectively.
At the end of each prompt, in the same paragraph, add: " ar 16:9 orientation landscape"
    `;
  } else if (aspectRatio === '9:16') {
    return `
Ensure the image is in a vertical (portrait) orientation with a 9:16 aspect ratio. Emphasize compositions that utilize vertical space effectively, such as tall structures or upright characters.
At the beginning of each prompt, add: "Create a centered, tall, vertical portrait image with a 9:16 aspect ratio, ensuring that all characters and objects are vertical straight that depicts the following: "
At the end of each prompt, in the same paragraph, add: " ar 9:16 orientation portrait"
`;
  }
  return '';
}

const getBaseAspectRatioUnitPrompt = (aspectRatio) => {
  if (aspectRatio === '16:9') {
    return `
Ensure the image is in a horizontal (landscape) orientation with a 16:9 aspect ratio. Emphasize wide-screen compositions and panoramic views that utilize the horizontal space effectively.
At the end of the prompt, in the same paragraph, add: " ar 16:9 orientation landscape"
    `;
  } else if (aspectRatio === '9:16') {
    return `
Ensure the image is in a vertical (portrait) orientation with a 9:16 aspect ratio. Emphasize compositions that utilize vertical space effectively, such as tall structures or upright characters.
At the beginning of the prompt, add: "Create a centered, tall, vertical portrait image with a 9:16 aspect ratio, ensuring that all characters and objects are vertical straight that depicts the following: "
At the end of the prompt, in the same paragraph, add: " ar 9:16 orientation portrait"
`;
  }
  return '';
}



export async function getMusicForTextTheme(themeJson, inferenceModel, musicModel = 'CASSETTEAI') {


  let systemPrompt;

  let bpmString;

  if (musicModel === 'CASSETTEAI') {
    bpmString = `Add BPM information to the prompt if applicable.`;
  }

  systemPrompt = String.raw`
You are an assistant for a text-to-music composer, an expert at distilling scene metadata into succinct prompts for a text-to-music model.

INPUT → a JSON object with fields such as "setting", "style", "technical", "general".  
Task -   
Combine those elements into **one sentence (≤ 35 words)** that evokes the mood, genre, and atmosphere.  
${bpmString}
RULES → plain text only, no lists, no headings, no code fences, no brand names, no disallowed content.”
`;



  const userPrompt = `Generate a music theme prompt using the following theme JSON: ${themeJson}`;

  const messageList = [
    { role: 'developer', content: systemPrompt },
    { role: 'user', content: userPrompt }
  ];

  const response = await sendAssistantMessageRequest(messageList, inferenceModel);

  return response.content;
}



export async function translateTextContent(textList, translationLanguage) {
  const systemPrompt = `
  You are a creative assistant for a generative AI tool that can generate speech from text prompts.
  Your task is to provide a translated version of the text to the ${translationLanguage} language.
  Provide answers in one output line, for each input line.
  For eaxample if input containts 5 lines provide 5 output lines of translated text respectively.
  `;

  const userPrompt = `Translate the following text to ${translationLanguage}: ${textList.join('\n')}`;

  const messageList = [
    { role: 'developer', content: systemPrompt },
    { role: 'user', content: userPrompt }
  ];

  const response = await sendAssistantMessageRequest(messageList);

  const responseList = response.content.split('\n');
  const filteredData = responseList.map((prompt) => prompt.trim()).filter(Boolean);

  return filteredData;

}

export async function translateTextContentForSubtitles(textList, translationLanguage) {

  const systemPrompt = `
You are a creative assistant for a generative AI tool that can generate subtitles from text prompts.
Your task is to provide a translated version of the text to the ${translationLanguage} language.
Provide one output line for each input line.
For example, if the input contains 5 lines, provide exactly 5 output lines of translated text respectively separated by new lines.
Ensure that there is a translatation for each line of the input text.
Do not add any extra text, explanations, or number the lines.
`;


  const userPrompt = `Translate the following text to ${translationLanguage}: ${textList.join('\n')}`;

  const messageList = [
    { role: 'developer', content: systemPrompt },
    { role: 'user', content: userPrompt }
  ];

  const response = await sendAssistantMessageRequest(messageList);

  const responseList = response.content.split('\n');
  const filteredData = responseList.map((prompt) => prompt.trim()).filter(Boolean);
  return filteredData;
}

export async function normalizeTextContent(textList) {

  const systemPrompt = "You are a creative assistant specializing in text transformation. \
  In each line of input, convert words, abbreviations, and emojis into their spoken language equivalents where necessary. \
  For example, transform 'tbh' to 'to be honest' and 'fr' to 'for real'. \
  Minimize changes and only transform words or symbols that require it. \
  Replace emojis and shorthand with their verbal equivalents, like replacing a laughter emoji with 'lol'. \
  Maintain a one-to-one correspondence between input and output lines, ensuring each line is transformed individually.\
  For example if input containts 5 lines provide 5 output lines of normalized text respectively each output line should be separated by a new line.";

  const userPrompt = `Normalize the following text -\n ${textList.join('\n')}`;

  const messageList = [
    { role: 'developer', content: systemPrompt },
    { role: 'user', content: userPrompt }
  ];

  const response = await sendAssistantMessageRequest(messageList);

  const responseList = response.content.split('\n');

  return responseList;

}


export async function divideTextIntoGroups(textList) {
  const systemPrompt = `You are a linguistic assistant specialized in text segmentation.
  Respect original line breaks in the input, and further subdivide each line into smaller segments based on the following criteria:
    Split the text into individual sentences based on line breaks, periods (.), question marks (?), exclamation marks (!), and other language-specific punctuation marks.
    Do not split at ellipses unless they naturally conclude a sentence.
  Output each sentence on a new line, ensuring each is correctly isolated while preserving its original meaning across languages such as English, Spanish, French, German, Russian, Chinese, Japanese, and Korean.`;


  const userPrompt = `Divide the following content into sentences:\n ${textList.join('\n')}`;

  const messageList = [
    { role: 'developer', content: systemPrompt },
    { role: 'user', content: userPrompt }
  ];

  const response = await sendAssistantMessageRequest(messageList);

  const filteredData = response.content.split('\n').map((sentence) => sentence.trim()).filter(Boolean);

  return filteredData;
}



export async function getBannerTextForSession(textList) {
  const systemPrompt = `You are a creative assistant for a generative AI tool that creates engaging banner titles for social media posts.
  Your task is to generate a contextually accurate title for the provided content.
  Ensure the title captures the essence of the content, is concise, engaging, at atleast 2 paragraphs long.
  Do not include numbers, quotes, formatting, or special characters.`;


  const userPrompt = `Generate banner text for the following content: ${textList.join('\n')}`;

  const messageList = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt }
  ];

  const response = await sendAssistantMessageRequest(messageList);

  return response.content;

}

export async function sendAssistantMessageRequest(messageList, userInferenceModel = 'gpt-5.5') {



  const modelName = getModelForUserInferenceModel(userInferenceModel);

  let baseFunctionCallParams = getFunctionCallParamsForModel(modelName, messageList);

  try {
    const response = await createCompatibleChatCompletion(openai, baseFunctionCallParams);
    return response.choices[0].message;
  } catch (error) {
    let errorString = 'An error occurred while sending the message. Please try again with a different message.'
    throw new Error(errorString);
  }

}


export async function sendSessionThemeMessageRequest(messageList, userInferenceModel = 'gpt-5.5') {


  const modelName = getModelForUserInferenceModel(userInferenceModel);



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
    setting: z.array(z.string()),
    style: z.array(z.string()),
    general: z.array(z.string()),
  });


  let baseFunctionCallParams = getFunctionCallParamsForModel(modelName, messageList);

  baseFunctionCallParams.response_format = zodResponseFormat(ThemeKeywordsExtraction, "theme_keywords_extraction");


  try {
    const response = await createCompatibleChatCompletion(openai, baseFunctionCallParams);

    const messageContent = response.choices[0].message.content;

    const parsedMessage = JSON.parse(messageContent);

    return parsedMessage;
  } catch (error) {


    console.error(error);
    throw new Error('An error occurred while sending the message. Please try again.');
  }
}

export async function sendSessionPromptMessageRequest(messageList, themeObject, userInferenceModel = 'gpt-5.5') {


  const modelName = getModelForUserInferenceModel(userInferenceModel);


  const PromptGeneration = z.object({
    promptList: z.array(z.string()),
  });

  let baseFunctionCallParams = getFunctionCallParamsForModel(modelName, messageList);

  baseFunctionCallParams.response_format = zodResponseFormat(PromptGeneration, "prompt_generation");

  try {
    const response = await createCompatibleChatCompletion(openai, baseFunctionCallParams);

    const messageContent = response.choices[0].message.content;

    const parsedMessage = JSON.parse(messageContent);



    return parsedMessage.promptList;
  } catch (error) {
    throw new Error('An error occurred while sending the message. Please try again.');
  }

}
