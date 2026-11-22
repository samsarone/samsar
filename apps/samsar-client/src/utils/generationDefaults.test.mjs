import assert from 'node:assert/strict';
import test from 'node:test';
import {
  resolveGenerationModelDefaults,
  resolveCreateDefaults,
  resolvePreferredGenerationModelOption,
} from './generationDefaults.mjs';

test('Create preferences are independent, normalized and fall back for older accounts', () => {
  assert.deepEqual(resolveCreateDefaults(), {
    inferenceModel: 'claude-opus-5.5', imageModel: 'GPTIMAGE2.5', videoModel: 'KLINGIMGTOVID4',
    inferenceEffort: 'high', duration: 30, aspectRatio: '16:9', enableSubtitles: false,
  });
  const user = { selectedInferenceModel: 'gpt-6.1-sol-xhigh', agentImageModel: 'SEEDREAM', createDefaults: {
    imageModel: 'GPTIMAGE2.6', videoModel: 'RUNWAYML', duration: 90, aspectRatio: '9:16', enableSubtitles: true,
  } };
  assert.deepEqual(resolveCreateDefaults(user), {
    inferenceModel: 'gpt-6.1-sol', imageModel: 'GPTIMAGE2.5', videoModel: 'RUNWAYML',
    inferenceEffort: 'xhigh', duration: 90, aspectRatio: '9:16', enableSubtitles: true,
  });
  assert.equal(user.agentImageModel, 'SEEDREAM');
  assert.equal(resolveCreateDefaults({ createDefaults: { duration: 999, aspectRatio: 'bogus' } }).duration, 30);
});

test('new users get Claude Opus 5.5, GPT Image 2.6 and Kling 4', () => {
  assert.deepEqual(resolveGenerationModelDefaults(), {
    inferenceModel: 'claude-opus-5.5', assistantModel: 'claude-opus-5.5',
    imageModel: 'GPTIMAGE2.5', videoModel: 'KLINGIMGTOVID4',
  });
});

test('saved model choices and reasoning effort remain explicit', () => {
  assert.deepEqual(resolveGenerationModelDefaults({
    selectedInferenceModel: 'gpt-6.2-astra', selectedAssistantModel: 'claude-fable-5.2-xhigh',
    agentImageModel: 'SEEDREAM', agentVideoModel: 'RUNWAYML',
  }), {
    inferenceModel: 'gpt-6.2-astra', assistantModel: 'claude-fable-5.2-xhigh',
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
