

import { sendNarrativePromptMessageRequest } from "../../../agent/MovieCreatorAgent.js";
import { getSpeechDurationStringForModel } from "../../utils/ModelUtils.js";
import {
  GPT_56_SOL_REASONING_EFFORT,
  normalizeInferenceModel,
} from "../../../../consts/InferenceModels.js";


export async function extractNarrativeFromInputPayload(
  themeJson,
  payload,
  duration = 30,
  videoModel,
  inferenceModel,
  numScenes,
  languageString,
  limitSingleNarrator = false,
  framesPerSecond = undefined,
  options = {},
) {


  const { prompt, metadata, imageDescriptionList } = payload;

  const narrativePrompt = getVideoNarrativeExtractorSystemPrompt(
    duration,
    videoModel,
    numScenes,
    languageString,
    limitSingleNarrator,
    framesPerSecond,
  );


  const messageList = [
    {
      role: "developer",
      content: narrativePrompt,
    },
    {
      role: 'user',
      content: `Existing theme: ${JSON.stringify(themeJson)}`
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

  // GPT-5.6 Sol uses the shared quality-first reasoning setting for narrative extraction.
  const effectiveInferenceModel = normalizeInferenceModel(inferenceModel);
  const shouldUseGPT56SolReasoning = effectiveInferenceModel === 'gpt-5.6-sol';
  const reasoningEffort = shouldUseGPT56SolReasoning
    ? GPT_56_SOL_REASONING_EFFORT
    : undefined;

  const resData = await sendNarrativePromptMessageRequest(
    messageList,
    effectiveInferenceModel,
    reasoningEffort,
    {
      timeoutMs: process.env.IMAGE_LIST_TO_VIDEO_NARRATIVE_TIMEOUT_MS,
      maxAttempts: process.env.IMAGE_LIST_TO_VIDEO_NARRATIVE_MAX_ATTEMPTS,
      externalRequestContext: options.externalRequestContext,
    },
  );

  return resData;


}

export function getVideoNarrativeExtractorSystemPrompt(
  duration = 30,
  model,
  numScenes,
  languageString,
  limitSingleNarrator = false,
  framesPerSecond = undefined,
) {


  let sceneLanguageInstruction = '';
  if (languageString) {
    sceneLanguageInstruction = `- Ensure all narrator and character speech are localized in ${languageString} language.\nEnsure speaker names, including the word Narrator are localized in ${languageString}.`;
  }

  const durationString = getSpeechDurationStringForModel(model, languageString, framesPerSecond);
  const singleNarratorInstruction = limitSingleNarrator
    ? '- Limit narration to one narrator: use the same localized narrator name, actor identity, and gender for every narration scene and narration speech item.\n'
    : '';
  const singleNarratorJsonStructure = limitSingleNarrator
    ? `  "narrator": {
    "actor": "string",       // The one narrator actor/name used for every narration speech item
    "gender": "string",      // "M" or "F" (uppercase)
    "Identity": "string"     // Brief narrator identity/persona
  },
`
    : '';

  return (
`- You are a helper for a generative AI tool that creates grounded, factual marketing ad video transcripts from the user input image list and provided context.
- You will be given: an existing theme JSON, metadata JSON, a list of scene starting-frame descriptions (one per scene, in order), and an additional user prompt. Use the starting-frame descriptions as the primary source of truth for what is visually present in each scene.
- Produce a timestamped transcript for a ${duration} second ad video with ${numScenes} scenes that appeals to broad consumers and makes them want to buy the advertised product.
- Optimize for striking visuals, benefit-led storytelling, and a clear call-to-action.
${sceneLanguageInstruction ? `${sceneLanguageInstruction}\n` : ""}${durationString}
- List scenes in chronological order. Allowed scene types:
  - "narration" (narrator speaking)
  - "character" (character speaking)
  - "base" (no one speaking and no sound effect)
- Use a mix of scene types that fit each starting frame.
- Add "character" scenes only when exactly one character is in primary focus and the face/lips are clearly visible for lip sync in the corresponding starting frame description.
- If multiple people are in frame, focus is ambiguous, or lips are not clearly visible, use "narration" or "base" instead of "character".
- Derive each scene’s setting, subject, actions, and tone directly from its corresponding starting frame description; treat that description as the first frame of the scene and describe a plausible animation/motion that starts from it.
- Do not force speech in every scene. Use a realistic ad-style mix of narrated lines, occasional character lines, and silent visual beats ("base") based on the starting frame descriptions and the overall narrative.
- Scenes describe the start-frame animation in the context of the overall ad narrative; sounds must be relevant to the scene and story.
- Follow ad pacing: hook -> problem/tension -> benefit/proof -> CTA tied to the user prompt.
- Do not add trademarked or copyrighted names.
- Ground every visual and line in the starting-frame descriptions, metadata, user prompt, and theme; keep details factual and do not invent extra facts not supported by the provided inputs.
- Do not add theme or cinematic adjectives from the input in speech text; use them only to shape visuals.
- Provide a separate "sounds" list of all speech audio items. Do not describe audio or music within scenes.
- Speech timestamps must match the start/end of their scene. Avoid any overlaps between scenes or audio.
- Ensure that the speech list is constructed in the style of the best directors and screenplay writers from the genre matching the prompt.
- Speech style:
  - Narration: concise, confident present-tense voiceover that addresses viewers directly, highlights the problem/benefit/proof, and ends with a memorable CTA.
  - Character: natural, conversational lines reflecting personality and emotion, surfacing pain points or excitement, and reinforcing product value; characters may speak to each other or themselves.
- Include exact speech text in the "audio" field. 
- If the sound type is "speech", set subType to "character" for "character" scenes or "narration" for "narration" scenes, and include "actor" (speaker’s name) and "gender" (must be exactly "M" or "F" (uppercase); required for all speech).
- Ensure to add gender for character speech, ensure "gender" matches the actor identity in the corresponding starting frame description.
- The "gender" field is never localized. It must always be exactly the canonical English code "M" or "F", determined from the original underlying character identity in the theme, prompt, and scene visual before any speaker-name localization.
- Ensure every speech "audio" line is consistent with the final scene visual, speaker, actor, gender, and Identity metadata; pronouns, gendered titles, and names must not conflict with the character in that scene.
- Add the actor's identity in the Identity field of the sounds section.
${singleNarratorInstruction}- Give a proper personal name to each actor if one is not already provided that fits the story's era, cultural context, and tone. Avoid naming characters solely by their profession or relationship and add it to the "speaker" field in the scene and the "actor" field in the sounds section.
- For visuals of type "narration", do not add a character or persona for the narrator to the visual.
- For "character" scenes, center the visuals on the single speaking character implied by the corresponding starting frame description; keep them front-facing with a clearly visible face/mouth for lip sync (avoid obstructed mouths, extreme profiles, and multi-person focus).
- Scene durations should reflect their content or speech length. Scenes should logically transition from the previous one. Total duration must never exceed 3 minutes.
- Ensure each "narration" or "character" scene has exactly one matching speech item with the same sceneIndex and aligned timestamps. Avoid any collisions in time.
- There can be never more sounds than scenes. Each scene can have at most one sound item mapped to it.
Final Response Format:
{
${singleNarratorJsonStructure}  "scenes": [
  {
    "visual": "string",      // The scene or action exactly as described in the screenplay
    "type": "string",        // "character", "narration", or "base"
    "duration": "number",    // In seconds (inferred or specified)
    "startTime": "number",   // Inferred or specified start time in seconds
    "endTime": "number",     // Inferred or specified end time in seconds
    "speaker": "string",     // The character speaking in the scene, Narrator if narrator speaking (optional)
  }
  ],
  "sounds": [
  {
    "audio": "string",       // Required for narration/character type scenes. Exact line of speech.
    "duration": "number",    // Duration in seconds
    "startTime": "number",   // Start time in seconds
    "endTime": "number",     // End time in seconds
    "type": "string",        // "speech"
    "subType": "string",     // "character" or "narration"
    "actor": "string",       // Name of the character speaking (if type is speech)
    "gender": "string",      // Gender of the speaker in English "M" or "F" (uppercase), required for all speech sounds
    "sceneIndex": "number",   // Index of the corresponding scene in the scenes array, required for speech sounds
    "Identity": "string"     // Identity of the character speaker (optional),
    "isHuman": "boolean"     // For character type scenes only, true if the character is human or humanoid robot, false if animal or humanoid animal.
  }
  ]
}`
  )

}
