import assert from 'node:assert/strict';
import test from 'node:test';
import { getRetiredGPTImageModelError, normalizeStoredGPTImageModelKey } from './GPTImageModelKeys.js';
import { resolveNarrativeToVideoModels } from '../models/api/NarrativeToVideoAPI.js';
import { addImageGeneratorRequest, addImageEditRequest } from '../models/Images.js';

test('saved GPT Image selections upgrade without accepting retired request keys', async () => {
  for (const [oldKey, newKey] of [['GPTIMAGE2', 'GPTIMAGE2.5'], ['GPTIMAGE2EDIT', 'GPTIMAGE2.5EDIT']]) {
    assert.equal(normalizeStoredGPTImageModelKey(oldKey), newKey);
    assert.equal(normalizeStoredGPTImageModelKey(newKey), newKey);
    assert.match(getRetiredGPTImageModelError(oldKey), /^Invalid model:/);
    assert.equal(getRetiredGPTImageModelError(newKey), null);
  }
  assert.equal(resolveNarrativeToVideoModels({ user: { agentImageModel: 'GPTIMAGE2' } }).imageModel, 'GPTIMAGE2.5');
  assert.throws(() => resolveNarrativeToVideoModels({ requestedImageModel: 'GPTIMAGE2' }),
    (error) => error.status === 400 && /^Invalid model:/.test(error.message));
  await assert.rejects(addImageGeneratorRequest('test-user', { model: 'GPTIMAGE2' }),
    (error) => error.status === 400 && /^Invalid model:/.test(error.message));
  await assert.rejects(addImageEditRequest('test-user', { model: 'GPTIMAGE2EDIT' }),
    (error) => error.status === 400 && /^Invalid model:/.test(error.message));
});
