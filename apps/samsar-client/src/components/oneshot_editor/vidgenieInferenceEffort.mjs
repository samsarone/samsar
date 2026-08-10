export const DEFAULT_VIDGENIE_INFERENCE_EFFORT = 'high';

export function getHydratedInferenceEffortPreferenceUpdate(
  value,
  { userInitiated = false, userFetching = true } = {},
) {
  if (!userInitiated || userFetching) {
    return {};
  }
  return {
    inferenceEffort: value === 'xhigh' ? 'xhigh' : DEFAULT_VIDGENIE_INFERENCE_EFFORT,
  };
}
