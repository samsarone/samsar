import VideoSession from '../../schema/VideoSession.js';

export const NARRATIVE_MODERATION_FAILURE_MESSAGE = 'Narrative failed moderation';

export function buildNarrativeModerationFailureUpdate(
  message = NARRATIVE_MODERATION_FAILURE_MESSAGE,
) {
  const errorMessage = typeof message === 'string' && message.trim()
    ? message.trim()
    : NARRATIVE_MODERATION_FAILURE_MESSAGE;

  return {
    $set: {
      'expressGenerationStatus.status': 'FAILED',
      'expressGenerationStatus.prompt_generation': 'FAILED',
      'expressGenerationStatus.video_generation': 'FAILED',
      expressGenerationPending: false,
      videoGenerationPending: false,
      expressGenerationFailed: true,
      expressGenerationError: errorMessage,
    },
  };
}

export async function markNarrativeModerationFailure(
  sessionId,
  {
    message = NARRATIVE_MODERATION_FAILURE_MESSAGE,
    VideoSessionModel = VideoSession,
  } = {},
) {
  if (!sessionId) {
    return null;
  }

  try {
    return await VideoSessionModel.findByIdAndUpdate(
      sessionId,
      buildNarrativeModerationFailureUpdate(message),
    );
  } catch (error) {
    console.error(`Failed to mark session ${sessionId} as a moderation failure`, error);
    return null;
  }
}
