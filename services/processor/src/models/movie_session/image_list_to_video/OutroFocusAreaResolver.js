export function resolveEffectiveOutroFocusAreaForImageListToVideo({
  addOutroFocusArea = false,
  outroFocustArea = null,
  generatedOutroImage = false,
} = {}) {
  if (generatedOutroImage === true) {
    return {
      addOutroFocusArea: false,
      outroFocustArea: null,
    };
  }

  return {
    addOutroFocusArea: addOutroFocusArea === true,
    outroFocustArea,
  };
}
