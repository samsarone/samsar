// Kept byte-identical in processor and express listener; neither service imports
// another service's runtime. The parity test protects the settlement contract.
export const HOSTED_AGENT_BILLING_VERSION = 2;
const number = value => Number.isFinite(Number(value)) ? Math.max(0, Number(value)) : 0;
const completed = value => String(value || '').toUpperCase() === 'COMPLETED';
const identity = value => value?._id?.toString?.() || value?.id?.toString?.();
const unique = values => [...new Map((values || []).map((value, index) => [identity(value) || `index:${index}`, value])).values()];
const hasAudio = audio => Boolean(audio.selectedLocalAudioLink || audio.selectedRemoteAudioLink || audio.localAudioLinks?.length || audio.remoteAudioLinks?.length);

export function hasHostedAgentProviderOverrides(session = {}) {
  const custom = session.custom_adapters || {};
  const operations = ['text_to_image', 'image_to_image', 'image_to_video', 'text_to_video',
    'text_to_speech', 'text_to_music', 'text_to_sound_effect', 'text_to_text', 'inference'];
  return operations.some(key => typeof custom[key] === 'string' && custom[key].trim()) ||
    Boolean(custom.custom_endpoints?.length) || Object.keys(session.samsarExternalProviderStages || {}).length > 0;
}

export function buildHostedAgentQuote(estimate, metadata = {}) {
  const durationSeconds = number(estimate.durationSeconds);
  const rates = Object.fromEntries(Object.entries(estimate.stages || {}).map(([stage, item]) => [stage, number(item.creditsPerSecond)]));
  const rate = Object.values(rates).reduce((sum, value) => sum + value, 0);
  if (!durationSeconds || !rate) throw new Error('A positive hosted-agent duration and price are required.');
  return { ...metadata, durationSeconds, rates, rate, credits: Math.ceil(durationSeconds * rate), pricingVersion: 'agent-allocation-v2' };
}

export function resolveHostedAgentFinalDuration(session) {
  if (session.narrativeType !== 'branched' && number(session.finalVideoDurationSeconds)) {
    return number(session.finalVideoDurationSeconds);
  }
  const layers = unique(session.layers);
  if (session.narrativeType === 'branched') {
    // Shared branch assets, including a shared outro, are counted once.
    return layers.reduce((sum, layer) => sum + number(layer.duration), 0);
  }
  return layers.reduce((end, layer) => Math.max(end, number(layer.durationOffset) + number(layer.duration)), 0);
}

function mediaDone(layer, kind) {
  if (kind === 'image') {
    const image = layer.imageSession || {};
    return (completed(image.generationStatus) || completed(image.editStatus)) && Boolean(image.activeGeneratedImage || image.activeEditedImage || image.activeSelectedImage || image.activeImageRemoteLink ||
      image.activeItemList?.some(item => item.type === 'image' && (item.src || item.url)));
  }
  const fields = kind === 'ai' ? ['aiVideoGenerationStatus', 'aiVideoLayer', 'aiVideoRemoteLink']
    : kind === 'lip' ? ['lipSyncVideoGenerationStatus', 'lipSyncVideoLayer', 'lipSyncRemoteLink']
      : ['soundEffectVideoGenerationStatus', 'soundEffectVideoLayer', 'soundEffectRemoteLink'];
  if (kind === 'sound' && layer.isAudioVideoLayer) return mediaDone(layer, 'ai');
  return completed(layer[fields[0]]) && Boolean(layer[fields[1]] || layer[fields[2]]);
}

function audioDuration(session, layers, kind, allocations, intervals) {
  const seenLayers = new Set();
  for (const audio of unique(session.audioLayers).filter(item => item.generationType === kind)) {
    if (!completed(audio.generationStatus) || !hasAudio(audio)) continue;
    const layer = layers.find(item => identity(item) === String(audio.connectedLayerId || '')) ||
      (Number.isInteger(audio.connectedLayerIndex) ? layers[audio.connectedLayerIndex] : null);
    if (kind === 'speech' && layer) {
      const key = identity(layer) || `index:${layers.indexOf(layer)}`;
      if (!seenLayers.has(key)) allocations[key] = Math.max(allocations[key] || 0, number(layer.duration));
      seenLayers.add(key);
    } else {
      const start = number(audio.startTime);
      intervals.push([start, start + number(audio.duration)]);
    }
  }
  // Alternative music tracks or duplicated unlinked audio cannot multiply usage.
  intervals.sort((a, b) => a[0] - b[0]);
  let linkedDuration = Object.values(allocations).reduce((sum, seconds) => sum + seconds, 0);
  let end = 0;
  for (const [start, stop] of intervals) { linkedDuration += Math.max(0, stop - Math.max(start, end)); end = Math.max(end, stop); }
  return linkedDuration;
}

export function calculateHostedAgentUsage(session, outcome) {
  const billing = session.hostedAgentBilling;
  const quote = billing.quote;
  const layers = unique(session.layers);
  const stageStatus = session.expressGenerationStatus || {};
  const success = outcome === 'COMPLETED';
  const duration = success ? Math.min(quote.durationSeconds, resolveHostedAgentFinalDuration(session)) : quote.durationSeconds;
  const layerAllocations = structuredClone(billing.usage?.layerAllocations || {});
  const audioIntervals = structuredClone(billing.usage?.audioIntervals || {});
  const mediaDuration = (stage, kind) => {
    const allocations = layerAllocations[stage] ||= {};
    layers.forEach((layer, index) => {
      if (mediaDone(layer, kind)) {
        const key = identity(layer) || `index:${index}`;
        allocations[key] = Math.max(allocations[key] || 0, number(layer.duration));
      }
    });
    return Object.values(allocations).reduce((sum, seconds) => sum + seconds, 0);
  };
  const completedAudioDuration = kind => audioDuration(session, layers, kind,
    layerAllocations[`${kind}_generation`] ||= {}, audioIntervals[kind] ||= []);
  const durations = {
    narrative_inference: completed(stageStatus.prompt_generation) && !session.expressGenerationNarrativeReused ? duration : 0,
    image_generation: mediaDuration('image_generation', 'image'),
    ai_video_generation: mediaDuration('ai_video_generation', 'ai'),
    lip_sync_generation: mediaDuration('lip_sync_generation', 'lip'),
    sound_effect_generation: mediaDuration('sound_effect_generation', 'sound'),
    speech_generation: completedAudioDuration('speech'),
    music_generation: completedAudioDuration('music'),
    narrator_avatar_generation: completed(session.narratorAvatarVideoStatus) && (session.narratorAvatarVideoAssetPath || session.narratorAvatarVideoUrl) ? duration : 0,
    pipeline: 0,
  };
  const stages = {};
  let exactCredits = 0;
  for (const [stage, rate] of Object.entries(quote.rates)) {
    // Whole completed stages retain their fixed allocation. Success reconciles
    // the entire package to the delivered timeline, including the outro.
    const seconds = success || billing.completedStages?.[stage]
      ? duration : Math.min(duration, Math.max(number(durations[stage]), number(billing.usage?.stages?.[stage]?.durationSeconds)));
    const credits = Math.round(seconds * rate * 1e6) / 1e6;
    stages[stage] = { stageKey: stage, durationSeconds: seconds, creditsPerSecond: rate, creditsCharged: credits,
      status: seconds > 0 ? (success || billing.completedStages?.[stage] ? 'CHARGED' : 'PARTIAL') : 'UNUSED' };
    exactCredits += credits;
  }
  const totalCharged = Math.min(quote.credits, Math.ceil(Math.round(exactCredits * 1e6) / 1e6));
  // Compact overlapping audio ranges before persisting the pause checkpoint.
  for (const [kind, ranges] of Object.entries(audioIntervals)) {
    const merged = [];
    for (const [start, end] of ranges.sort((a, b) => a[0] - b[0])) {
      const last = merged.at(-1);
      if (last && start <= last[1]) last[1] = Math.max(last[1], end);
      else merged.push([start, end]);
    }
    audioIntervals[kind] = merged;
  }
  return { outcome, durationSeconds: duration, totalCharged, roundingAdjustment: totalCharged - exactCredits,
    stages, layerAllocations, audioIntervals };
}
