import { getSpeechDurationStringForModel } from '../movie_session/utils/ModelUtils.js';

export { getSpeechDurationStringForModel };



export const themeActorAdditionSystemPrompt = `
Extract all actors (humans, animals, beasts) except the narrator from the text, including inferred references.
Provide period and context-appropriate keywords for each character's traits, including race, religion, gender, skin color, clothing and its color, accessories, body type, height, build, age group, demographic, facial structure, skin tone, hairstyle, hair type, hair color, hair length, eye shape and color, facial features, complexion, and other identifying features.
Ensure not to add minors as characters unless specifically asked for in the user input.
In the case of science-fiction characters, include details regarding futuristic enhancements, gear, and accessories.
Generate at least thirty keywords for physical, ethnic, emotional, and contextual traits such as ethnicity, nationality, facial expressions, mood, appearance, charm, and symmetry. Ensure clothing and accessories are described in detail and are appropriate to the period and context.
Include relevant details such as race, age, skin/hair color, body type, and any specific cultural traits that enrich the character description.
Describe the characters with accuracy and rich detail, drawing from your knowledge base and considering the theme.
Do not add any attributes for the narrator.
For animals/beasts, include features like fur or skin color, patterns, size, body structure, and other relevant characteristics.
`;


export const themeGroundedActorAdditionSystemPrompt =
  `Extract all actors (humans, animals, beasts) except the narrator from the text, including inferred references.
Provide period and context-appropriate keywords for each character's traits, including race, religion, gender, skin color, clothing and its color, accessories, body type, height, build, age group, demographic, facial structure, skin tone, hairstyle, hair type, hair color, hair length, eye shape and color, facial features, complexion, and other identifying features.
Ensure not to add minors as actors if possible.
Ensure not to add non-binary or gender non-conforming characters if possible.
Ensure to add characters that reflect the typical context to the user request in real world.
If adding ambiguous characters or if character cannot be inferred directly from context then prefer adding friendly humanoid robot characters.
In the case of science-fiction characters, include details regarding futuristic enhancements, gear, and accessories.
Generate at least thirty keywords for physical, ethnic, emotional, and contextual traits such as ethnicity, nationality, facial expressions, mood, appearance, charm, and symmetry. Ensure clothing and accessories are described in detail and are appropriate to the period and context.
Include relevant details such as race, age, skin/hair color, body type, and any specific cultural traits that enrich the character description.
Describe the characters with accuracy and rich detail, drawing from your knowledge base and considering the theme.
Do not add any attributes for the narrator.
For animals/beasts, include features like fur or skin color, patterns, size, body structure, and other relevant characteristics.`;


export const themePlaceAdditionSystemPrompt = `
Extract all places (indoor/outdoor locations, cities, countries, planets) and add detailed keywords for attributes, including place names and meta details.
Infer additional keywords from your knowledge base to enrich the description of the place if needed.
Ensure that the place attributes are aligned with the subject, setting, period, and overall context of the story and theme.
`;

export const themeGroundedPlaceAdditionSystemPrompt = `
Extract all places (indoor/outdoor locations, cities, countries, planets) and add detailed keywords for attributes, including place names and meta details.
Infer additional keywords from your knowledge base to enrich the description of the places if needed.
Ensure that the place attributes are aligned with the subject, setting, period, and overall context of the story and theme.
`;


export const themeObjectsAdditionSystemPrompt = `
Extract all objects of interest (items, vehicles, tools, weapons) and add detailed keywords for attributes, including object names and meta details.
Infer additional keywords from your knowledge base to enrich the description of the objects if needed.
Ensure that the object attributes are aligned with the subject, setting, period, and overall context of the story and theme.
`;

export const themeGroundedObjectsAdditionSystemPrompt = `
Extract all objects of interest (items, vehicles, tools, weapons) and add detailed keywords for attributes, including object names and meta details.
Ensure that all object representations are grounded.
Infer additional keywords from your knowledge base to enrich the description of the objects if needed.
Ensure that the object attributes are aligned with the subject, setting, period, and overall context of the story and theme.
`;


export const themeSceneMetaAdditionalSystemPrompt = `
Identify the primary subject and central theme, adding titles and relevant keywords under subject.
Add exhaustive keywords for subjects, settings, styles, techniques, and general aspects, inferring from your knowledge base if needed.
For scientific or technical themes, include exhaustive relevant keywords from your knowledge base to maintain authenticity.
For historical or culturally specific themes, include exhaustive relevant keywords from your knowledge base to maintain authenticity.
Add keywords covering the cinematic details in the style section to ensure consistency of scenes.
Add additional meta cinematic details based on the context of the input; for example, for futuristic themes, include futuristic keywords.
Ensure all keywords maintain a consistent cinematic style without mixing conflicting elements.
Infer and expand on cinematic styles as needed, providing detailed, consistent, and cohesive keywords to maintain a consistent cinematic style.
`;

export const themeGroundedSceneMetaAdditionalSystemPrompt =
  `Identify the primary subject and central theme, adding titles and relevant keywords under subject.
Add exhaustive keywords for subjects, settings, styles, techniques, and general aspects, inferring from your knowledge base if needed.
For scientific or technical themes, include exhaustive relevant keywords from your knowledge base to maintain authenticity.
For historical or culturally specific themes, include exhaustive relevant keywords from your knowledge base to maintain authenticity.
Add keywords covering the cinematic details in the style section to ensure consistency of scenes.
Add additional meta cinematic details based on the context of the input; for example, for futuristic themes, include futuristic keywords.
Ensure all keywords maintain a consistent cinematic style without mixing conflicting elements.
Infer and expand on cinematic styles as needed, providing detailed, consistent, and cohesive keywords to maintain a consistent cinematic style.
`;


export const baseDialogSystemPrompt = `
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





export const baseModerationSystemPrompt = `
  Output one natural image prompt per input line, with no numbering, headings, labels, or policy notes.
  Keep prompts safe for moderation and suitable for direct text-to-image generation.
  If the input or theme references a real person, celebrity, public figure, or copyrighted/trademarked character, rewrite it as an original non-identifying equivalent. Preserve the narrative role, relationship, broad theme, mood, setting, action, camera framing, lighting, and art style, but do not include protected names, exact facial likenesses, logos, signature markings, franchise terms, fictional species labels, transformation names, attack names, exact costume colorways, or distinctive hair/eye/costume combinations.
  Keep the scene coherent and theme-relevant; do not replace it with an unrelated fallback.
`;


export function getThemeForResourceJsonSystemPrompt(hasReferenceTheme = false) {


  let themeFrameReference = '';

  if (hasReferenceTheme) {
    themeFrameReference = `
Use the reference theme provided by the user to construct the theme json and apply any modifications as suggested by the prompt.
`;
  }
  const themeForResourceJsonSystemPrompt = `
You are a creative assistant for a generative AI tool that creates a theme based on a text prompt.
${themeFrameReference}
Your task is to extract and organize detailed thematic and contextual keywords from a user prompt, producing a structured JSON object that can accurately recreate the narrative in a generative image or video creation model.
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
Do not add conflicting style or setting keywords.

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


export function getGroundedThemeForResourceJsonSystemPrompt(hasReferenceTheme = false) {

  const themeForResourceJsonSystemPrompt = `
You are a creative assistant for a generative AI tool that creates a theme JSON object based on a reference image and adds modifiers based on a text prompt.

Your task is to extract and organize detailed thematic and contextual keywords from the reference image , add any modifiers added via the user prompt, producing a structured JSON object that can accurately recreate the narrative in a generative image or video creation model.
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
Ensure that all attributes are grounded to reality and reflect real world settings in the context of the user request.
Enchance any user provided styling or theme keywords with complementary keywords to match and enforce the theme. 
Do not add conflicting style or setting elements.
Enrich keywords with historically and geographically relevant details using your own knowledge where applicable.
${themeGroundedActorAdditionSystemPrompt}
${themeGroundedPlaceAdditionSystemPrompt}
${themeGroundedObjectsAdditionSystemPrompt}
${themeGroundedSceneMetaAdditionalSystemPrompt}
Ensure all text and keywords are content filter-friendly, maintaining a consistent cinematic style and visual elements.
If custom keywords are present, emphasize them heavily and include resulting custom settings in the custom keywords field.
`;
  return themeForResourceJsonSystemPrompt;


}

export function getThemeForResourceJsonSystemPromptAndImage(hasReferenceTheme = false) {


  const themeForResourceJsonSystemPrompt = `
You are a creative assistant for a generative AI tool that creates a theme JSON object based on a reference image and adds modifiers based on a text prompt.

Your task is to extract and organize detailed thematic and contextual keywords from the reference image , add any modifiers added via the user prompt, producing a structured JSON object that can accurately recreate the narrative in a generative image or video creation model.
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


export function getGroundedPromptUpdaterWithSystemThemePrompt(shortForm, aspectRatio) {


  let arString = '';
  if (aspectRatio) {
    arString = `Ensure the prompt includes the instruction to create the image in aspect ratio ${aspectRatio}, at the end of the prompt in the same paragraph.`;
  }

  let systemPrompt = `
    You are an assistant for a generative AI tool that updates the provided prompt with a given subject and theme to render the scene accurately in a generative text to image, AI engine.
    The theme JSON includes:
      - subject: ["<keywords>"],
      - actors: [{ name: "<name>", keywords: ["<keywords>"] }, ...],
      - setting: ["<keywords>"],
      - style: ["<keywords>"],
      - general: ["<keywords>"]
              - custom: ["<keywords>"]

              ${baseDialogSystemPrompt}
              Prioritize scene-relevant theme details, realistic physics, accurate object placement, and clear grammar.
              Keep the prompt grounded to reality without adding labels, text overlays, or unnecessary instruction text.
              Ensure the result is a single paragraph without line breaks or numbering.
              ${baseModerationSystemPrompt}
              ${arString}
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
              Ensure the result is a single paragraph without line breaks or numbering. Provide one result per input line.
              ${baseModerationSystemPrompt}
              Keep each prompt concise, not more than 400-500 characters.
          `;

  }

  return systemPrompt;

}

export function getPromptUpdaterWithSystemThemePrompt(shortForm, aspectRatio) {
  let arString = '';
  if (aspectRatio) {
    arString = `Ensure the prompt includes the instruction to create the image in aspect ratio ${aspectRatio}, at the end of the prompt in the same paragraph.`;
  }
  let systemPrompt = `
    You are an assistant for a generative AI tool that updates the provided prompt with a given subject and theme to render the scene accurately in a generative text to image, AI engine.
    The theme JSON includes:
      - subject: ["<keywords>"],
      - actors: [{ name: "<name>", keywords: ["<keywords>"] }, ...],
      - setting: ["<keywords>"],
      - style: ["<keywords>"],
      - general: ["<keywords>"]
      - custom: ["<keywords>"]

              ${baseDialogSystemPrompt}
              Prioritize the most important contextual details from the theme.
              Ensure the result is a single paragraph without line breaks or numbering.
              ${baseModerationSystemPrompt}
              ${arString}
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
              Ensure the result is a single paragraph without line breaks or numbering. Provide one result per input line.
              ${baseModerationSystemPrompt}
              Keep each prompt concise, not more than 400-500 characters.
          `;

  }

  return systemPrompt;
}



export function getResourceListPrompt(model) {
  let maxDuration = 10;
  if (model === 'LUMA') {
    maxDuration = 9;
  }
  const sceneDurationInstruction = model === 'SEEDANCE2.5I2V'
    ? '5, 10, or 15'
    : `5 or ${maxDuration}`;
  return `
You are a helper for a video editing software that creates videos from screenplays, writing in the style of the most talented screenplay writers of all time (Billy Wilder, Francis Ford Coppola, Paddy Chayefsky, William Goldman, Robert Towne, Quentin Tarantino, Charlie Kaufman, The Coen Brothers, Aaron Sorkin, Christopher Nolan, etc.) depending on the context of the user input.

Instructions:
- You will be provided with a screenplay, which is a text document containing dialogues, actions, and scenes of a movie.
- Once you have the screenplay, provide a timestamped list of scenes, music, effects, and speech.
- Each scene should be listed in correct chronological order.
- A scene can be of type "character" (character speaking), "narration" (narrator speaking), or "base" (no speech, other sound effects may be present).

- For scenes of type "character", infer the visual from the point of view of the speaking character if not otherwise specified in the screenplay.
- The duration of each scene can be ${sceneDurationInstruction} seconds, based on scene content or speech length.
- Infer start times for scenes and audio based on scene indices, ensuring no overlaps.
- Put additional details about scenes, cinematics, or characters in the metadata field as CSV.
- For speech items, extract the exact spoken line from the screenplay in the "audio" key.
- The total length of the movie cannot exceed 4 minutes.
- Do not include audio or music descriptions within the scenes; instead, include them in the sounds list.
- If the sound type is "speech", add the subType as "character" or "narration" based on context.
- If the sound type is "speech", also add "actor" (the speaker’s name) and "gender".
- The scene's duration should be inferred based on its content or the corresponding speech.
- Each scene visual should transition logically from the previous scene.
- For historical and scientific themes, ensure the scenes are contextually and historically accurate.
- Ensure there is a matching "speech" of subType "character" for each "character" scene, with aligned start and end times.
- Ensure there is a matching "speech" of subType "narration" for each "narration" scene, also with aligned timestamps and no collisions.
- Avoid any audio layers that conflict with video layers.
- Separate narration and speech in the final JSON.
- Narration should speak to the audience directly, in present tense, like a film narrator or voice-over.
- Speech should be conversational, like a character speaking to another character.
- Ensure that the mapping is accurate, scenes with speech attached must have "character" or "narration" type.
- Ensure there are no overlapping scenes or audio and each speech item has a matching scene.

Final Response Format:
{
  "scenes": [
    {
      "visual": "string",      // The scene or action exactly as described in the screenplay
      "type": "string",        // "character", "narration", or "base"
      "duration": "number",    // In seconds (inferred or specified)
      "startTime": "number",   // Inferred or specified start time in seconds
      "endTime": "number",     // Inferred or specified end time in seconds
      "speaker": "string"      // The character speaking in the scene (optional)
    }
  ],
  "sounds": [
    {
      "audio": "string",       // Exact line or sound as in the screenplay
      "duration": "number",    // In seconds (optional if inferred)
      "startTime": "number",   // Start time in seconds
      "endTime": "number",     // End time in seconds
      "type": "string",        // "music", "speech", or "effect"
      "subType": "string",     // For speech sounds: "character" or "narration"
      "actor": "string",       // Character speaking (optional)
      "gender": "string",      // Gender of the speaker (optional)
      "sceneIndex": number,   // Index of the corresponding scene in the scenes array
      "isHuman": "boolean",  // For character type scenes only, true if the character is human or humanoid robot, false if animal or humanoid animal.
    }
  ],
  "metadata": "string"
}
`;
}



export const baseCharacterDialogSystemPrompt = `
Create a detailed prompt that visually represents the input line cinematically (without text or labels) from the speaker's perspective, enforcing the subject, general, style, and custom theme keywords if present, and ensuring context, theme, and time-period accuracy by inferring details from the input and theme JSON. 
Extract places mentioned in the input, align them with the theme's places, incorporate relevant keyword matches, and add vivid descriptions of those places based on theme keywords, ensuring place characteristics match the subject, general theme, time period, and setting (including weather, mood, and architecture).
Center the scene on the speaker, with the camera focused on them and all other objects secondary from their POV. Capture a frontal view to enable accurate lip sync; otherwise lip sync fails. Ensure the face and mouth of the main character remain unobstructed and clearly visible for accurate lip sync.
For each character referenced (people, animals, or beasts), whether direct, indirect, or inferred, find the closest matching "actors" entry in the theme. If a user-specified actor is provided, also match it to the theme's "actors" list. Use only visually important, non-identifying attributes needed for continuity, such as broad age group, build, outfit type, posture, expression, and role in the scene. Do not dump every actor keyword into the prompt.
Accurately infer indirect actor references (e.g., "they", "them", "he", "him") using the storyline, theme, and your knowledge base, matching them to the theme's actors. Ensure all physical characteristics and clothing align with the period, ethnicity, geography, race, religion, gender, physical traits, and story context.
If no match is found, create new characters with attributes based on the prompt input, ensuring they align with the theme, storyline, and time period. Provide suitable descriptions of their appearance and clothing that match the context, while avoiding protected likenesses, trademarked character recipes, and excessive identity-specific feature lists.
If the input doesn't contain any characters or actors, create a prompt based on the input in the context of the theme and storyline. Focus on "subject" and "general" theme keywords to determine context and time period, and incorporate relevant style keywords for cinematic consistency and visual coherence. The rendition must be cinematic, visually appealing, and contextually accurate (without text or labels), maintaining historical, geographical, ethnic, and numerical accuracy, and ensuring the image is upright with the correct aspect ratio.
When relevant, include concise natural wording for historical, scientific, technical, or numerical accuracy in the same paragraph, and include any aspect ratio or orientation instruction from the base aspect ratio prompt.
`;





export function getCharacterPromptWithSystemTheme(shortForm, speakerActor, aspectRatio) {

  let arString = '';
  if (aspectRatio) {
    arString = `Ensure the prompt includes the instruction to create the image in aspect ratio ${aspectRatio}, at the end of the prompt in the same paragraph.`;
  }
  let systemPrompt = `
      You are an assistant for a generative AI tool that updates the provided prompt with a given subject and theme to render the scene accurately in a generative text to image engine.
      Extract and create the prompt making the speaker the central subject of the scene. The input prompt may have other characters or a general prompt, but the output prompt must update the input so that ${speakerActor} is the focal point of the scene.
              Keep the result grounded, physically plausible, visually coherent, and free of text overlays or labels.
              Use only the most important contextual details from the theme.
      The theme JSON includes:
        - subject: ["<keywords>"],
        - actors: [{ name: "<name>", keywords: ["<keywords>"] }, ...],
        - setting: ["<keywords>"],
        - style: ["<keywords>"],
        - general: ["<keywords>"]
                - custom: ["<keywords>"]
                ${baseCharacterDialogSystemPrompt}
                Ensure that ${speakerActor} is the focus of the scene, facing the camera, with a clear unobstructed face and mouth.
                Match the actor and setting to the theme and storyline without overloading the prompt with redundant details.
                Ensure the result is a single paragraph without line breaks or numbering.
                ${baseModerationSystemPrompt}
        ${arString}
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
                Ensure the result is a single paragraph without line breaks or numbering. Provide one result per input line.
                ${baseModerationSystemPrompt}
                Ensure the prompt is concise, not more than 400-500 characters.
    `;
  }

  return systemPrompt;

}



export function getGroundedCharacterPromptWithSystemTheme(shortForm, speakerActor, aspectRatio) {

  let arString = null;
  if (aspectRatio) {
    arString = `Ensure the prompt includes the instruction to create the image in aspect ratio ${aspectRatio}, at the end of the prompt in the same paragraph.`;
  }

  let systemPrompt = `
      You are an assistant for a generative AI tool that updates the provided prompt with a given subject and theme to render the scene accurately in a generative text to image engine.
      Extract and create the prompt making the speaker the central subject of the scene. The input prompt may have other characters or a general prompt, but the output prompt must update the input so that ${speakerActor} is the focal point of the scene.
              Keep the result grounded, physically plausible, anatomically accurate, grammatically clean, and free of text overlays or labels.
              Use the most important theme details and place objects or creatures in contextually accurate locations.
      The theme JSON includes:
        - subject: ["<keywords>"],
        - actors: [{ name: "<name>", keywords: ["<keywords>"] }, ...],
        - setting: ["<keywords>"],
        - style: ["<keywords>"],
        - general: ["<keywords>"]
                - custom: ["<keywords>"]
                ${baseCharacterDialogSystemPrompt}
                Ensure that ${speakerActor} is the focus of the scene, facing the camera, with a clear unobstructed face and mouth.
                Match the actor and setting to the theme and storyline without overloading the prompt with redundant details.
                Ensure the result is a single paragraph without line breaks or numbering.
                ${baseModerationSystemPrompt}
        ${arString}
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
                Ensure the result is a single paragraph without line breaks or numbering. Provide one result per input line.
                ${baseModerationSystemPrompt}
        Ensure the prompt is concise, not more than 400-500 characters.
    `;
  }

  return systemPrompt;

}


export const themeExtractorSystemPrompt = `
  You are a system assistant that creates a theme json from a user input prompt.
   Your task is to extract and organize detailed thematic and contextual keywords from a user prompt, producing a structured JSON object that can accurately recreate the narrative in a generative image or video creation model.
  The final output **must** follow this format :
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
    objects: ["<keywords>"],
    style: ["<keywords>"],
    general: ["<keywords>"],
    custom: ["<keywords>"]
  }
`;



export function getMovieNarrativeExtractorSystemPromptForStartImage(
  duration = 10,
  model,
  hasStartImage = false,
  languageString,
) {

  let sceneLanguageInstruction = '';
  if (languageString) {
    sceneLanguageInstruction = `- Ensure all narrator and character speech are localized in ${languageString} language.\nEnsure speaker names, including the word Narrator are localized in ${languageString}.`;
  }

  const durationString = getSpeechDurationStringForModel(model, languageString);


  return (
    `- You are a helper for a transcript creation tool that creates transcripts for a movie in the styles of the genre matching the prompt.
- Create a movie transcript as a timestamped list of scenes and sounds.
- If the user specifies a total duration or a number of lines/scenes, match that request without exceeding it. Otherwise, default to a ${duration} second movie.
- Use the start image description for creating the visual of the first scene and create the narrative progression accordingly.
- You can further modify the styling to match any modifications specified by the user text prompt.
- Do not add additional characters to the the narrative beyond the ones specified in the start image description and user prompt.
- Strictly follow the boundaries specified in the start image description and the user prompt when constructing the movie narrative.


- List all scenes in correct chronological order. Each scene can be:
  - "narration" (narrator speaking)
  - "sound_effect" (sound effect no speaker)
  - "base" (no one speaking and no sound effect)
  - "character" (character speaking)
- Add a mix of all four scene types, reflect the typical distribution of scenes in films of the chosen genre for each scene type in the context of the user prompt.
- Add character and narration scenes only when appropriate in the context of the narrative.
- Use "character" only when a single speaking character is in primary focus with clearly visible lips/face suitable for lip sync; otherwise use "narration", "sound_effect", or "base".
- For "character" scenes, use the speaker’s POV and keep only the speaker prominent; relegate any necessary secondary characters to the background.
- Provide a separate "sounds" list of all audio items (speech or sound effects). 
- Speech timestamps must match the start/end of its scene.
- Sound effect timestamps must align with the scene in which they occur.
- Ensure that the speech list is natural and constructed in the style of the best directors and screenplay writers from the genre matching the prompt.
${sceneLanguageInstruction ? `${sceneLanguageInstruction}\n` : ""}${durationString}
- Ensure there are no overlapping scenes or audio.
- Do not include words from prompt that is used to describe theme or cinematics in the speech text.
- Do not include adjectives and words used to describe cinematics  from the input in the speech text, instead use it to construct the narrative.
- Speech of type "narration" should speak to the audience directly, in present tense, like a film narrator or voice-over.
- For Speech of type "character" create authentic conversational speech. Characters may speak to each other or to themselves. The dialog should reflect the character’s personality, emotions, and context within the scene.
- Include exact speech text in the "audio" field. 
- Do not include audio or music descriptions within the scenes; they belong in the "sounds" list.
- If the sound type is "speech", use subType: "character" or "narration" (based on context provided in theme), and also include "actor" (speaker’s name) and "gender".
- Every speech sound must include "gender"; never leave it blank or empty. Use exactly "M" or "F" uppercase for both character speech and narration. Before returning, check every sound with type "speech" and replace any missing, empty, or non-canonical gender with inferred "M" or "F"; only sound_effect items may use an empty gender.
- Infer the actor's name and gender correctly based on context provided in theme.
- The "gender" field is never localized. It must always be exactly the canonical English code "M" or "F", determined from the original underlying character identity in the theme, prompt, and scene visual before any speaker-name localization. Do not infer or alter gender from the localized spelling of the actor or speaker name.
- Ensure every speech "audio" line is consistent with the final scene visual, speaker, actor, gender, and Identity metadata; pronouns, gendered titles, and names must not conflict with the character in that scene.
- Add the actor's identity in the Identity field of the sounds section.
- Give a proper personal name to each actor if one is not already provided that fits the story's era, cultural context, and tone. Avoid naming characters solely by their profession or relationship and add it to the "speaker" field in the scene and the "actor" field in the sounds section. 
- For visuals of type "narration", do not add a character or persona for the narrator to the visual.
- Scene durations should reflect their content or speech length. Scenes should logically transition from the previous one.
- Ensure each "character" scene has a matching speech item (subType "character") with aligned timestamps; similarly for each "narration" scene (subType "narration"). Avoid any collisions in time.
- Ensure that any scenes with a corresponding speech item must have "character" or "narration" type.
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
    "audio": "string",       // Exact line of speech or sound_effect description
    "duration": "number",    // In seconds
    "startTime": "number",   // Start time in seconds
    "endTime": "number",     // End time in seconds
    "type": "string",        // "speech" or "sound_effect"
    "subType": "string",     // For speech sounds: "character" or "narration"
    "actor": "string",       // Name of the character speaking (if type is speech)
    "gender": "string",      // Required for every speech sound. Must be exactly "M" or "F" uppercase.
    "sceneIndex": "number",   // Index of the corresponding scene in the scenes array
    "Identity": "string",     // Identity of the character speaker (optional),
    "isHuman": "boolean"     // For character type scenes only, true if the character is human or humanoid robot, false if animal or humanoid animal.
  }
  ]
}`
  )
};





export function getMovieNarrativeExtractorSystemPrompt(
  duration = 10,
  model,
  hasStartImage = false,
  languageString,
) {

  const durationString = getSpeechDurationStringForModel(model, languageString);

  let implementationString = '';
  if (hasStartImage) {
    implementationString = 'Use the start image description for create the visual for the first scene and create a progression of scenes based on the start image description.';
  }
  let sceneLanguageInstruction = '';
  if (languageString) {
    sceneLanguageInstruction = `- Ensure all narrator and character speech are localized in ${languageString} language.\nEnsure speaker names, including the word Narrator are localized in ${languageString}.`;
  }
  return (
    `- You are a helper for a video creation software that creates transcripts for movie creation in the styles of the genre matching the prompt.
- Create a movie transcript as a timestamped list of scenes and sounds.
- Ensure the total duration is ${duration} second video transcript.
${implementationString}
- List all scenes in correct chronological order. Each scene can be:
- "character" (character speaking)
- "narration" (narrator speaking)
- "sound_effect" (sound effect no speaker)
- "base" (no one speaking and no sound effect)
- Add a mix of all four scene types, reflecting the typical distribution of scenes in films of the chosen genre for each scene type.
- Add instructions to ensure that the narrative is interesting and engaging in the style and context of the user prompt.
- Add speech scenes only where appropriate to the context of the story.
- Add narration and character scenes only if appropriate to the context specified in the user input.
- Use "character" only when a single speaking character is in primary focus with clearly visible lips/face suitable for lip sync; otherwise use "narration", "sound_effect", or "base".
- For "character" scenes, use the speaker’s POV and keep only the speaker prominent; relegate any necessary secondary characters to the background.
- Provide a separate "sounds" list of all audio items (speech or sound effects). 
- Add specific instructions to ensure not to add trademarked or copyrighted characters or names in the transcript. 
- Speech timestamps must match the start/end of its scene.
- Sound effect timestamps must align with the scene in which they occur.
- Ensure that the speech list is constructed in the style of the best directors and screenplay writers from the genre matching the prompt.
${sceneLanguageInstruction ? `${sceneLanguageInstruction}\n` : ""}${durationString}
- Ensure there are no overlapping scenes or audio.
- The total duration can never exceed 4 minutes.
- Do not include words from prompt that is used to describe theme or cinematics in the speech text.
- Do not include adjectives and words used to describe cinematics  from the input in the speech text, instead use it to construct the narrative.
- Speech of type "narration" should speak to the audience directly, in present tense, like a film narrator or voice-over.
- For Speech of type "character" create authentic conversational speech. Characters may speak to each other or to themselves. The dialog should reflect the character’s personality, emotions, and context within the scene.
- Include exact speech text in the "audio" field. 
- Do not include audio or music descriptions within the scenes; they belong in the "sounds" list.
- If the sound type is "speech", use subType: "character" or "narration" (based on context provided in theme), and also include "actor" (speaker’s name) and "gender".
- Every speech sound must include "gender"; never leave it blank or empty. Use exactly "M" or "F" uppercase for both character speech and narration. Before returning, check every sound with type "speech" and replace any missing, empty, or non-canonical gender with inferred "M" or "F"; only sound_effect items may use an empty gender.
- Infer the actor's name and gender correctly based on context provided in theme.
- The "gender" field is never localized. It must always be exactly the canonical English code "M" or "F", determined from the original underlying character identity in the theme, prompt, and scene visual before any speaker-name localization. Do not infer or alter gender from the localized spelling of the actor or speaker name.
- Ensure every speech "audio" line is consistent with the final scene visual, speaker, actor, gender, and Identity metadata; pronouns, gendered titles, and names must not conflict with the character in that scene.
- Add the actor's identity in the Identity field of the sounds section.
- Give a proper personal name to each actor if one is not already provided that fits the story's era, cultural context, and tone. Avoid naming characters solely by their profession or relationship and add it to the "speaker" field in the scene and the "actor" field in the sounds section. 
- For visuals of type "narration", do not add a character or persona for the narrator to the visual.
- Scene durations should reflect their content or speech length. Scenes should logically transition from the previous one.
- Ensure each "character" scene has a matching speech item (subType "character") with aligned timestamps; similarly for each "narration" scene (subType "narration"). Avoid any collisions in time.
- Ensure that any scenes with a corresponding speech item must have "character" or "narration" type.
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
    "audio": "string",       // Exact line of speech or sound_effect description
    "duration": "number",    // Speech duration in seconds
    "startTime": "number",   // Start time in seconds
    "endTime": "number",     // End time in seconds
    "type": "string",        // "speech" or "sound_effect"
    "subType": "string",     // For speech sounds: "character" or "narration"
    "actor": "string",       // Name of the character speaking (if type is speech)
    "gender": "string",      // Required for every speech sound. Must be exactly "M" or "F" uppercase.
    "sceneIndex": number,   // Index of the corresponding scene in the scenes array
    "Identity": "string",     // Identity of the character speaker (optional),
    "isHuman": "boolean"     // For character type scenes only, true if the character is human or humanoid robot, false if animal or humanoid animal.
  }
  ]
}`
  )
};



export function getGroundedMovieNarrativeExtractorSystemPrompt(
  duration = 10,
  model,
  hasStartImage = false,
  languageString,
) {
  const durationString = getSpeechDurationStringForModel(model, languageString);
  let sceneLanguageInstruction = '';
  if (languageString) {
    sceneLanguageInstruction = `- Ensure all narrator and character speech are localized in ${languageString} language.\nEnsure speaker names, including the word Narrator are localized in ${languageString}.`;
  }

  return (
    `- You are a helper for a generative AI tool that that creates transcripts for grounded, factual and accurate video creation for the user prompt.
- Create a factual cinematic transcript that as a timestamped list of scenes and sounds.
- Ensure the total duration is ${duration} second video transcript.
- List all scenes in correct chronological order. Each scene can be:
  - "narration" (narrator speaking)
  - "character" (character speaking)
  - "sound_effect" (sound effect no speaker)
  - "base" (no one speaking and no sound effect)
- Add a mix of the four scene types when appropriate, reflecting the typical scene distribution for the genre, format, and style implied by the user prompt.
- Do not add trademarked or copyrighted characters or names in the result transcript. 
- Add instructions to ensure to provide accurate and specific context from the user prompt and theme into each visual line.
- Add instructions to ensure that the narrative is accurate, interesting and engaging.
- Ensure to add instructions that each visual is factual, grounded, accurate and as close to the truth as possible with the provided user context.
- Ensure to add instructions that any text or visualizations/graphs etc. in the visual is factual, accurate and has the correct spelling.
- Ensure the speech transcript is factual, and uses the correct tense as per the user input and the context.
- Prefer context-provided people or roles for character scenes.
- Use "character" only when a single speaking character is in primary focus with clearly visible lips/face suitable for lip sync; otherwise use "narration", "sound_effect", or "base".
- For "character" scenes, use the speaker’s POV and keep only the speaker prominent; relegate any necessary secondary characters to the background.
- Provide a separate "sounds" list of all audio items (speech or sound effects). 
- Speech timestamps must match the start/end of its scene.
- Sound effect timestamps must align with the scene in which they occur.
- Ensure that the speech list is constructed in the style of the best directors and screenplay writers from the genre matching the prompt.

${sceneLanguageInstruction ? `${sceneLanguageInstruction}\n` : ""}${durationString}
- Ensure there are no overlapping scenes or audio.
- The total duration can never exceed 4 minutes.
- Do not include words from prompt that is used to describe theme or cinematics in the speech text.
- Do not include adjectives and words used to describe cinematics  from the input in the speech text, instead use it to construct the narrative.
- Speech of type "narration" must be third-person, present-tense, atmospheric description that sets scene and context without addressing the audience or using second-person phrasing.
- For Speech of type "character" create authentic conversational speech. Characters may speak to each other or to themselves. The dialog should reflect the character’s personality, emotions, and context within the scene.
- Include exact speech text in the "audio" field. 
- Do not include audio or music descriptions within the scenes; they belong in the "sounds" list.
- If the sound type is "speech", use subType: "character" or "narration" (based on context provided in theme), and also include "actor" (speaker’s name) and "gender".
- Every speech sound must include "gender"; never leave it blank or empty. Use exactly "M" or "F" uppercase for both character speech and narration. Before returning, check every sound with type "speech" and replace any missing, empty, or non-canonical gender with inferred "M" or "F"; only sound_effect items may use an empty gender.
- Infer the actor's name and gender correctly based on context provided in theme.
- The "gender" field is never localized. It must always be exactly the canonical English code "M" or "F", determined from the original underlying character identity in the theme, prompt, and scene visual before any speaker-name localization. Do not infer or alter gender from the localized spelling of the actor or speaker name.
- Ensure every speech "audio" line is consistent with the final scene visual, speaker, actor, gender, and Identity metadata; pronouns, gendered titles, and names must not conflict with the character in that scene.
- Add the actor's identity in the Identity field of the sounds section.
- Give a proper personal name to each actor if one is not already provided that fits the story's era, cultural context, and tone. Avoid naming characters solely by their profession or relationship and add it to the "speaker" field in the scene and the "actor" field in the sounds section. 
- For visuals of type "narration", do not add a character or persona for the narrator to the visual.
- Scene durations should reflect their content or speech length. Scenes should logically transition from the previous one.
- Ensure each "character" scene has a matching speech item (subType "character") with aligned timestamps; similarly for each "narration" scene (subType "narration"). Avoid any collisions in time.
- Verify no overlapping scenes or audio.
- Ensure that every speech item has a sceneIndex mapping it to its corresponding scene.
- Ensure that any scene has at-most one corresponding speech item with aligned timestamps.
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
    "audio": "string",       // Required for character and sound_effect type scenes. Exact line of speech for character type or sound_effect description for sound_effect type.
    "duration": "number",    // Duration in seconds
    "startTime": "number",   // Start time in seconds
    "endTime": "number",     // End time in seconds
    "type": "string",        // "speech" or "sound_effect"
    "subType": "string",     // For speech sounds: "character" or "narration"
    "actor": "string",       // Name of the character speaking (if type is speech)
    "gender": "string",      // Required for every speech sound. Must be exactly "M" or "F" uppercase.
    "sceneIndex": number,   // Index of the corresponding scene in the scenes array, required for speech and sound_effect type scenes
    "Identity": "string"     // Identity of the character speaker (optional),
    "isHuman": "boolean"     // For character type scenes only, true if the character is human or humanoid robot, false if animal or humanoid animal.
  }
  ]
}`
  )

}

export function getTextToVideoNarrativeSystemPrompt({
  duration = 10,
  videoModel,
  grounded = false,
  languageString,
  minimumSceneCount = null,
} = {}) {
  const basePrompt = grounded
    ? getGroundedMovieNarrativeExtractorSystemPrompt(
      duration,
      videoModel,
      false,
      languageString,
    )
    : getMovieNarrativeExtractorSystemPrompt(
      duration,
      videoModel,
      false,
      languageString,
    );
  const normalizedMinimumSceneCount = Number(minimumSceneCount);
  if (!Number.isSafeInteger(normalizedMinimumSceneCount) || normalizedMinimumSceneCount < 2) {
    return basePrompt;
  }

  return basePrompt +
    `\n- The transcript must contain at least ${normalizedMinimumSceneCount} scenes ` +
    'so it can support the requested branching depth.';
}
