import { sendAssistantMessageRequest } from "../inference/OpenAI.js";

const DEFAULT_SIMPLIFIED_BACKING_TRACK_PROMPT =
  "Create a clean instrumental cinematic backing track for a short social video ad. Use upbeat travel energy, clear rhythm, warm synths, light percussion, and no vocals.";
const DEFAULT_USER_INFERENCE_MODEL = process.env.USER_INFERENCE_MODEL || process.env.DEFAULT_USER_INFERENCE_MODEL || 'gpt-5.5';

function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function parsePromptRewriteContent(rawContent) {
  const trimmedContent = normalizeString(rawContent);
  if (!trimmedContent) {
    return '';
  }

  const jsonCandidate = trimmedContent.match(/\{[\s\S]*\}/)?.[0] || trimmedContent;

  try {
    const parsed = JSON.parse(jsonCandidate);
    return normalizeString(parsed?.content);
  } catch {
    return '';
  }
}

export async function getSimplifiedBackingTrackPromptForRetry(originalPrompt, errorMessage) {
  const sourcePrompt = normalizeString(originalPrompt) || DEFAULT_SIMPLIFIED_BACKING_TRACK_PROMPT;
  const failureReason = normalizeString(errorMessage) || 'The audio provider rejected or could not process this prompt.';

  const messages = [
    {
      role: 'system',
      content: [
        'Simplify the prompt for an instrumental backing-track generator.',
        'Maintain the original meaning, pacing, and mood while making it more likely to pass content filters.',
        'Avoid lyrics, vocals, artist names, brand names, copyrighted references, and complex instructions.',
        'Return JSON only with the shape {"content":"rewritten prompt"}.',
        'The content value must be one plain sentence under 220 characters.',
      ].join(' '),
    },
    {
      role: 'user',
      content: `Original prompt:\n${sourcePrompt}\n\nFailure reason:\n${failureReason}`,
    },
  ];

  try {
    const response = await sendAssistantMessageRequest(messages, DEFAULT_USER_INFERENCE_MODEL);
    const simplifiedPrompt = parsePromptRewriteContent(response?.content);
    return simplifiedPrompt || DEFAULT_SIMPLIFIED_BACKING_TRACK_PROMPT;
  } catch (error) {
    console.error('Failed to simplify backing track prompt; using deterministic fallback', {
      error: error?.message || String(error),
    });
    return DEFAULT_SIMPLIFIED_BACKING_TRACK_PROMPT;
  }
}
