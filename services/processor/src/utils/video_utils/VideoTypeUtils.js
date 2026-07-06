

export function getModelType(model) {
  let isAudioVideoModel = false;
  let isLipSyncModel = false;
  let isSoundEffectModel = false;
  if (model === 'LATENTSYNC' || model === 'SYNCLIPSYNC') {
    isAudioVideoModel = true;
    isLipSyncModel = true;
  } else if (model === 'MMAUDIOV2' ) {
    isAudioVideoModel = true;
    isSoundEffectModel = true;
  }
  
  return {
    isAudioVideoModel,
    isLipSyncModel,
    isSoundEffectModel
  };
}