
import { themeActorAdditionSystemPrompt, themePlaceAdditionSystemPrompt,
  themeObjectsAdditionSystemPrompt, themeSceneMetaAdditionalSystemPrompt,
  getSpeechDurationStringForModel, baseDialogSystemPrompt, baseModerationSystemPrompt,
  baseCharacterDialogSystemPrompt,

 } from "../../agent/AgentCreatorSystemPrompts.js";

import {   sendSessionThemeMessageRequest, sendNarrativePromptMessageRequest, sendAssistantMessageRequest } from '../../agent/MovieCreatorAgent.js';
import { getDefaultUserInferenceModel, normalizeInferenceModel } from "../../../consts/InferenceModels.js";




export function getThemeForResourceJsonSystemPromptAndImage(hasReferenceTheme = false) {


  const themeForResourceJsonSystemPrompt = `
You are a creative assistant for a generative AI tool that creates a theme JSON object based on a description for the theme and adds modifiers based on a text prompt.

Your task is to extract and organize detailed thematic and contextual keywords from the reference description, add any modifiers added via the user prompt, producing a structured JSON object that can accurately recreate the narrative in a generative image or video creation model.
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

Strictly follow any user-provided style or cinematic type instructions if provided.
Enchance any user provided styling or theme keywords with complementary keywords to match and enforce the theme. 
Do not add conflicting style or setting elements.


Enrich keywords with historically and geographically relevant details using your own knowledge where applicable.
${themeActorAdditionSystemPrompt}
${themePlaceAdditionSystemPrompt}
${themeObjectsAdditionSystemPrompt}
${themeSceneMetaAdditionalSystemPrompt}

Ensure all text and keywords are content filter-friendly, maintaining a consistent cinematic style and visual elements.
If custom keywords are present, emphasize them heavily and include resulting custom settings in the custom keywords field.
`;
  return themeForResourceJsonSystemPrompt;

}


export async function extractThemeForImageListAndPrompt(themeText, prompt, userInferenceModel) {

  const systemPrompt = getThemeForResourceJsonSystemPromptAndImage(true);

  const messageList = [
    {
      role: "developer",
      content: systemPrompt,
    },
    {
      role: "user",
      content: `Reference theme: ${themeText}`
    },
    {
      role: "user",
      content: "Modified prompt: " + prompt,
    },

  ]

  const effectiveInferenceModel = normalizeInferenceModel(userInferenceModel);

  const responseData = await sendSessionThemeMessageRequest(
    messageList,
    effectiveInferenceModel,
  );

  return responseData;

}



export function getMovieNarrativeExtractorSystemPromptForStartImage(duration = 30, model) {

  const durationString = getSpeechDurationStringForModel(model);


  return (
`- You are a helper for a transcript creation tool that creates transcripts for an ad video in the genre matching the prompt.
- Create a an ad video transcript as a timestamped list of scenes and sounds.
- Create the narrative by stitching together the provided image descriptions and the user prompt to create a compelling narrative.
- Ensure accuracy and ensure the narrative is within the bounds of the user prompt and the image description list.
- If the user specifies a total duration or a number of lines/scenes, match that request without exceeding it. Otherwise, default to a ${duration} second movie.
- Use the start image description for creating the visual of the first scene and create the narrative progression accordingly.
- You can further modify the styling to match any modifications specified by the user text prompt.
- Do not add additional characters to the the narrative beyond the ones specified in the start image description and user prompt.
- Strictly follow the boundaries specified in the start image description and the user prompt when constructing the movie narrative.
- List all scenes in correct chronological order. Each scene can be:
- "character" (character speaking)
- "narration" (narrator speaking)
- "sound_effect" (sound effect no speaker)
- "base" (no one speaking and no sound effect)
- Reflect the typical distribution of scenes in films of the chosen genre for each scene type. 
- Add speech scenes only where appropriate to the context of the story. 
- Add narration and character scenes only if appropriate to the context specified in the user input.
- Use "character" only when a single speaking character is in primary focus with clearly visible lips/face suitable for lip sync; otherwise use "narration", "sound_effect", or "base".
- For "character" scenes, infer visuals from the speaker’s POV.
- Provide a separate "sounds" list of all audio items (speech or sound effects). 
- Speech timestamps must match the start/end of its scene.
- Sound effect timestamps must align with the scene in which they occur.
- Ensure that the speech list is natural and constructed in the style of the best directors and screenplay writers from the genre matching the prompt.
${durationString}
- Ensure there are no overlapping scenes or audio.
- The total duration can not exceed 4 minutes.
- Do not include adjectives and words used to describe cinematics  from the input in the speech text, instead use it to construct the narrative.
- Speech of type "narration" should be in present tense, like a film narration or voice-over.
- For Speech of type "character" create authentic conversational speech. Characters may speak to each other or to themselves. The dialog should reflect the character’s personality, emotions, and context within the scene.
- Include exact speech text in the "audio" field. 
- Do not include audio or music descriptions within the scenes; they belong in the "sounds" list.
- If the sound type is "speech", use subType: "character" or "narration" (based on context provided in theme), and also include "actor" (speaker’s name) and "gender".
- Infer the actor's name and gender correctly based on context provided in theme.
- Add the actor's identity in the Identity field of the sounds section.
- Give a proper personal name to each actor if one is not already provided that fits the story's era, cultural context, and tone. Avoid naming characters solely by their profession or relationship and add it to the "speaker" field in the scene and the "actor" field in the sounds section. 
- For visuals of type "narration", do not add a character or persona for the narrator to the visual.
- Scene durations should reflect their content or speech length. Scenes should logically transition from the previous one.
- Ensure each "character" scene has a matching speech item (subType "character") with aligned timestamps; similarly for each "narration" scene (subType "narration"). Avoid any collisions in time.
- Verify no overlapping scenes or audio.
Final Response Format:
{
  "scenes": [
  {
    "visual": "string",      // The scene or action exactly as described in the screenplay
    "type": "string",        // "character", "narration", "sound_effect", or "base"
    "duration": "number",    // In seconds (inferred or specified)
    "startTime": "number",   // Inferred or specified start time in seconds
    "endTime": "number",     // Inferred or specified end time in seconds
    "speaker": "string",     // The character speaking in the scene (optional)
  }
  ],
  "sounds": [
  {
    "audio": "string",       // Exact line or speech or sound_effect description
    "duration": "number",    // In seconds
    "startTime": "number",   // Start time in seconds
    "endTime": "number",     // End time in seconds
    "type": "string",        // "speech" or "sound_effect"
    "subType": "string",     // For speech sounds: "character" or "narration"
    "actor": "string",       // Name of the character speaking (if type is speech)
    "gender": "string",      // Gender of the speaker if there is a character speaking in the scene
    "sceneIndex": "string",   // Index of the corresponding scene in the scenes array
    "Identity": "string"     // Identity of the character speaker (optional),
    "isHuman": "boolean"     // For character type scenes only, true if the character is human, false if animal or humanoid.
  }
  ]
}`
  )
};



export async function createNarrativeForImageListAndPrompt(sessionTheme, startImageDescriptions, prompt,
   duration, videoGenerationModel, userInferenceModel
) {

  const systemPrompt = getMovieNarrativeExtractorSystemPromptForStartImage(duration, videoGenerationModel);

  const messageList = [
    {
      role: "developer",
      content: systemPrompt,
    },
    {
      role: "user",
      content: `Reference theme: ${sessionTheme}`
    },
    {
      role: "user",
      content: "Modified prompt: " + prompt,
    },
    {
      role: "user",
      content: "Start image descriptions: " + startImageDescriptions
    },
  ];


  const effectiveInferenceModel = normalizeInferenceModel(userInferenceModel);

  const responseData = await sendNarrativePromptMessageRequest(messageList, effectiveInferenceModel);


  return responseData;


}


export async function updateAdPromptWithTheme(prompt, themeJson, aspectRatio = '1:1',
  userInferenceModel = getDefaultUserInferenceModel(),
  shortForm = false) {

  const systemPrompt = getPromptUpdaterWithSystemThemePrompt(shortForm);

  const messageList = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: `Theme JSON is: ${themeJson}` },
    { role: 'user', content: `Generate prompts from the following input, using the provided theme: ${prompt}` },
  ];

  const response = await sendAssistantMessageRequest(messageList, userInferenceModel);

  return response.content.trim();
}



export async function updateAdVideoCharacterPromptWithTheme(
  prompt, 
  imageDescriptionList,
  speakerActor, themeJson, aspectRatio = '1:1',
  userInferenceModel = getDefaultUserInferenceModel(),
  shortForm = false)
  {


  const systemPrompt = getAdVideoCharacterImageSystemPrompt(shortForm, speakerActor);

  const messageList = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: `Theme JSON is: ${themeJson}` },
    { role: 'user', content: `The speaker is: ${speakerActor}` },
    { 'role': 'user', content: `The start image descriptions are: ${imageDescriptionList}` },
    { role: 'user', content: `Generate prompts from the following input, using the provided theme: ${prompt}` },
  ];

  const response = await sendAssistantMessageRequest(messageList, userInferenceModel);

  const contentResponse = response.content.trim();

  return contentResponse;
}


export async function updateAdVideoPromptWithTheme(prompt, 
  imageDescriptionList,
  themeJson, aspectRatio = '1:1',
  userInferenceModel = getDefaultUserInferenceModel(),
  shortForm = false) {
    
  const systemPrompt = getAdVideoGenericImageScenePrompt(shortForm);

  const messageList = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: `Theme JSON is: ${themeJson}` },
    { 'role': 'user', content: `The start image descriptions are: ${imageDescriptionList}` },
    { role: 'user', content: `Generate prompts from the following input, using the provided theme: ${prompt}` },
  ];

  const response = await sendAssistantMessageRequest(messageList, userInferenceModel);

  return response.content.trim();
}


export function getAdVideoGenericImageScenePrompt(shortForm) {

  let systemPrompt = `
    You are an assistant for a generative AI text to image creation tool that updates the provided prompt with a given subject and theme to render the scene accurately in a generative text to image, AI engine.
    Use the provided image descriptions to create a detailed, relevant and accurate prompt for the object. 
    Ensure that the object description matches accurately with the provided image description and the overall image matches the provided theme.
    The theme JSON includes:
      - subject: ["<keywords>"],
      - actors: [{ name: "<name>", keywords: ["<keywords>"] }, ...],
      - setting: ["<keywords>"],
      - style: ["<keywords>"],
      - general: ["<keywords>"]
      - custom: ["<keywords>"]

      ${baseDialogSystemPrompt}
      Ensure the result is a single paragraph without line breaks or numbering.
      ${baseModerationSystemPrompt}
      Ensure the prompt includes any aspect ratio and orientation instructions, as provided, at the end of the prompt in the same paragraph.
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

      ${baseDialogSystemPrompt}
      Ensure the result is a single paragraph without line breaks or numbering. Ensure to provide one result per input line.
      ${baseModerationSystemPrompt}
      Ensure the prompt is are concise, not more than 400-500 characters.
  `;

  }

  return systemPrompt;
}

export function getAdVideoCharacterImageSystemPrompt(shortForm, speakerActor) {


  let systemPrompt = `
      You are an assistant for a generative AI tool that updates the provided prompt with a given subject and theme to render the scene accurately in a generative text to image engine.
      Extract and create the prompt making the speaker the central subject of the scene. The input prompt may have other characters or a general prompt, but the output prompt must update the input so that ${speakerActor} is the focal point of the scene.
      Use the provided image descriptions to create a detailed, relevant and accurate prompt for the object. 
      Ensure that the object description matches accurately with the provided image description and the overall image matches the provided theme.
      The theme JSON includes:
        - subject: ["<keywords>"],
        - actors: [{ name: "<name>", keywords: ["<keywords>"] }, ...],
        - setting: ["<keywords>"],
        - style: ["<keywords>"],
        - general: ["<keywords>"]
        - custom: ["<keywords>"]
        ${baseCharacterDialogSystemPrompt}
        Ensure that ${speakerActor} is the focus of the scene and facing the camera.
        Describe the actor and the settings to perfectly match the theme and the storyline.
        Find the closest match in the theme actors for the provided actor in the theme, and ensure the scene and actor descriptions match the theme perfectly.
        Ensure the prompt includes instructions to ensure that the main character being mentioned is the focus of the scene and facing the camera.
        Ensure the result is a single paragraph without line breaks or numbering.
        ${baseModerationSystemPrompt}
        Ensure the prompt includes any aspect ratio and orientation instructions, as provided, at the end of the prompt in the same paragraph.
    `;

  if (shortForm) {
    systemPrompt = `
      You are an assistant for a generative AI tool that updates the provided prompt with a given subject and theme to render the scene accurately in a generative AI engine in a concise manner.
      Extract and create the prompt making the speaker the central subject of the scene. The input prompt may have other characters or a general prompt, but the output prompt must update the input so that ${speakerActor} is the focal point of the scene.
      Ensure that the result is concise, in a single paragraph and 400-500 characters in length.
      The theme JSON includes:
        - subject: ["<keywords>"],
        - actors: [{ name: "<name>", keywords: ["<keywords>"] }, ...],
        - setting: ["<keywords>"],
        - style: ["<keywords>"],
        - general: ["<keywords>"]
        - custom: ["<keywords>"]
        ${baseCharacterDialogSystemPrompt}
        Find the closest match in the theme actors for the provided actor, and ensure the scene and actor descriptions match the theme perfectly.
        Ensure the result is a single paragraph without line breaks or numbering. Ensure to provide one result per input line.
        ${baseModerationSystemPrompt}
        Ensure the prompt is concise, not more than 400-500 characters.
    `;
  }



  return systemPrompt;

}
