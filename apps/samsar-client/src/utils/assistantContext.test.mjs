import assert from 'node:assert/strict';
import test from 'node:test';
import { vidgenieAssistantContext, studioAssistantView } from './assistantContext.js';

test('Vidgenie resolves current view with review/error/pending precedence over older output', () => {
  assert.equal(vidgenieAssistantContext({}).view, 'initial');
  assert.equal(vidgenieAssistantContext({ complete: true }).view, 'complete');
  assert.equal(vidgenieAssistantContext({ pending: true, complete: true }).view, 'rendering');
  assert.equal(vidgenieAssistantContext({ error: true, complete: true }).view, 'error');
  assert.equal(vidgenieAssistantContext({ review: true, pending: true }).view, 'review');
  const value = vidgenieAssistantContext({ mode: 'I2V', draft: 'x'.repeat(5000), hasReferenceImage: true, apiKey: 'excluded' });
  assert.equal(value.mode, 'I2V'); assert.equal(value.draft.length, 4000); assert.equal(value.apiKey, undefined);
});
test('Studio toolbar states become narrow page-aware hints', () => {
  assert.equal(studioAssistantView('SHOW_AUDIO_DISPLAY'), 'audio');
  assert.equal(studioAssistantView('SHOW_EDIT_MASK_DISPLAY', 'image'), 'mask');
  assert.equal(studioAssistantView('SHOW_GENERATE_DISPLAY', 'image'), 'generate');
  assert.equal(studioAssistantView('SHOW_ADD_TEXT_DISPLAY'), 'text');
  assert.equal(studioAssistantView('SHOW_ANIMATE_DISPLAY'), 'animate');
});
