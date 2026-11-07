// Keep this payload small: UI selections and drafts only, never URLs, keys or whole sessions.
export function vidgenieAssistantContext({ mode, draft, pending, review, complete, error, hasReferenceImage, locale, selectedImageModel, selectedVideoModel }) {
  return { version: 1, page: 'vidgenie', mode: mode === 'I2V' ? 'I2V' : 'T2V',
    view: review ? 'review' : error ? 'error' : pending ? 'rendering' : complete ? 'complete' : 'initial',
    draft: String(draft || '').slice(0, 4000), hasReferenceImage: Boolean(hasReferenceImage), locale, selectedImageModel, selectedVideoModel };
}
export function studioAssistantView(tool = '', page = 'video') {
  if (tool.includes('AUDIO') || tool.includes('MUSIC') || tool.includes('SPEECH') || tool.includes('SOUND')) return 'audio';
  if (tool.includes('ANIMATE')) return 'animate';
  if (tool.includes('TEXT')) return 'text';
  if (page === 'image') {
    if (tool.includes('MASK')) return 'mask';
    if (tool.includes('EDIT')) return 'edit';
    if (tool.includes('GENERATE')) return 'generate';
    if (tool.includes('UPLOAD')) return 'upload';
    if (tool.includes('LAYERS')) return 'layers';
    return 'canvas';
  }
  if (tool.includes('EDIT')) return 'edit';
  if (tool.includes('GENERATE') || tool.includes('TEMPLATE') || tool.includes('UPLOAD')) return 'image';
  return 'timeline';
}
