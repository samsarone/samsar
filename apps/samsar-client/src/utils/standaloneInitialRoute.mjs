function hasModel(values) {
  return Array.isArray(values) && values.length > 0;
}

export function hasConfiguredStandaloneTextToVideoPipeline({
  inferenceModelValues = [],
  textToVideoImageModelValues = [],
  textToVideoVideoModelValues = [],
} = {}) {
  return (
    hasModel(inferenceModelValues) &&
    hasModel(textToVideoImageModelValues) &&
    hasModel(textToVideoVideoModelValues)
  );
}

export function getStandaloneInitialEditorPath({
  isStandaloneDeployment = false,
  isMobile = false,
  hasTextToVideoPipeline = false,
} = {}) {
  if (!isStandaloneDeployment || isMobile || hasTextToVideoPipeline) {
    return '/vidgenie';
  }
  return '/video';
}
