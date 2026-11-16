import assert from 'node:assert/strict';
import test from 'node:test';
import {
  resolveGenerationModelDefaults,
  resolvePreferredGenerationModelOption,
} from './generationDefaults.mjs';

test('new users get Claude Opus 5.5, GPT Image 2.6 and Kling 4', () => {
  assert.deepEqual(resolveGenerationModelDefaults(), {
    inferenceModel: 'claude-opus-5.5', assistantModel: 'claude-opus-5.5',
    imageModel: 'GPTIMAGE2.5', videoModel: 'KLINGIMGTOVID4',
  });
});

test('saved model choices and reasoning effort remain explicit', () => {
  assert.deepEqual(resolveGenerationModelDefaults({
    selectedInferenceModel: 'gpt-6-astra', selectedAssistantModel: 'claude-fable-5.2-xhigh',
    agentImageModel: 'SEEDREAM', agentVideoModel: 'RUNWAYML',
  }), {
    inferenceModel: 'gpt-6-astra', assistantModel: 'claude-fable-5.2-xhigh',
    imageModel: 'SEEDREAM', videoModel: 'RUNWAYML',
  });
});

test('current image request names and saved Kling aliases use canonical routing keys', () => {
  const defaults = resolveGenerationModelDefaults({ agentImageModel: 'gptimage2.6', agentVideoModel: 'KLINGIMGTOVID3PRO' });
  assert.equal(defaults.imageModel, 'GPTIMAGE2.5');
  assert.equal(defaults.videoModel, 'KLINGIMGTOVID4');
});

test('available model selection honors browser then account preferences and defaults', () => {
  const options = ['RUNWAYML', 'KLINGIMGTOVID4', 'VEO3.1I2V'].map((value) => ({ value }));
  const preference = { savedValue: 'VEO3.1I2V', userValue: 'RUNWAYML', defaultValue: 'KLINGIMGTOVID4' };
  assert.equal(resolvePreferredGenerationModelOption(options, preference).value, 'VEO3.1I2V');
  assert.equal(resolvePreferredGenerationModelOption(options, { ...preference, savedValue: '' }).value, 'RUNWAYML');
  assert.equal(resolvePreferredGenerationModelOption(options, { defaultValue: 'KLINGIMGTOVID4' }).value, 'KLINGIMGTOVID4');
  assert.equal(resolvePreferredGenerationModelOption([options[0]], { defaultValue: 'KLINGIMGTOVID4' }).value, 'RUNWAYML');
  assert.equal(resolvePreferredGenerationModelOption([], preference), null);
});
