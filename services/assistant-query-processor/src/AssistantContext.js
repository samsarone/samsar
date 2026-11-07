// UI hints are bounded reference data, never authorization or model instructions.
const views = {
  vidgenie: ['initial', 'rendering', 'review', 'complete', 'error'],
  video: ['timeline', 'edit', 'audio', 'image', 'text', 'animate', 'export'],
  audio: ['generate', 'join', 'library'],
  image: ['generate', 'edit', 'mask', 'layers', 'text', 'upload', 'canvas'],
};
const text = (value, max) => typeof value === 'string' ? value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').slice(0, max) : '';
export function normalizeAssistantContext(value) {
  if (!value || value.version !== 1 || !Object.hasOwn(views, value.page)) return null;
  const page = value.page;
  const context = { version: 1, page, view: views[page].includes(value.view) ? value.view : views[page][0] };
  if (['T2V', 'I2V'].includes(value.mode) && page === 'vidgenie') context.mode = value.mode;
  if (['en', 'th', 'ja'].includes(value.locale)) context.locale = value.locale;
  if (typeof value.draft === 'string') context.draft = text(value.draft, 4000);
  for (const field of ['selectedModel', 'selectedImageModel', 'selectedVideoModel']) {
    if (typeof value[field] === 'string' && /^[a-zA-Z0-9._:-]{1,100}$/.test(value[field])) context[field] = value[field];
  }
  if (typeof value.selectedLayerId === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(value.selectedLayerId)) context.selectedLayerId = value.selectedLayerId;
  if (['image', 'text', 'shape', 'music', 'speech', 'sound', 'sound_effect', 'video'].includes(value.selectedItemType)) context.selectedItemType = value.selectedItemType;
  if (Number.isInteger(value.selectedCount) && value.selectedCount >= 0 && value.selectedCount <= 100) context.selectedCount = value.selectedCount;
  if (Number.isFinite(value.playheadSeconds) && value.playheadSeconds >= 0 && value.playheadSeconds <= 86400) context.playheadSeconds = Math.round(value.playheadSeconds * 100) / 100;
  if (typeof value.hasReferenceImage === 'boolean') context.hasReferenceImage = value.hasReferenceImage;
  return context;
}

export function summarizeAssistantSession(session = {}, context = {}) {
  const layers = Array.isArray(session.layers) ? session.layers : [];
  const layer = context.selectedLayerId ? layers.find(item => item && String(item._id || item.id) === context.selectedLayerId) : null;
  const stages = {};
  for (const name of ['prompt_generation', 'image_generation', 'speech_generation', 'music_generation', 'ai_video_generation', 'lip_sync_generation', 'video_generation']) {
    const raw = session.expressGenerationStatus?.[name];
    if (typeof raw === 'string' && /^(INIT|PENDING|PROCESSING|COMPLETED|FAILED|ERROR|CANCELLED|SKIPPED)$/i.test(raw)) stages[name] = raw.toUpperCase();
  }
  return {
    layerCount: layers.length,
    audioLayerCount: Array.isArray(session.audioLayers) ? session.audioLayers.length : 0,
    hasRenderedVideo: Boolean(session.videoLink || session.remoteURL),
    renderPending: Boolean(session.expressGenerationPending || session.videoGenerationPending || session.aiVideoGenerationPending),
    stages,
    ...(layer ? { selectedLayer: { id: String(layer._id || layer.id),
      prompt: text(layer.prompt || layer.imageSession?.prompt, 1200),
      items: (Array.isArray(layer.imageSession?.activeItemList) ? layer.imageSession.activeItemList : []).slice(0, 30).map(item => ({ type: text(item?.type, 30) })),
    } } : {}),
  };
}
