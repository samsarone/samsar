import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import OpenAI from 'openai';
import { normalizeStoredGPTImageModelKey } from '../consts/GPTImageModelKeys.js';
import { __testOnly__ } from '../Image.js';
import { getEditImageFromText } from '../Dispatcher.js';
import { handleGPTImageTwoRequest } from './GPTImageOne.js';
import { GPT_IMAGE_TWO_FAL_ENDPOINT, buildOpenAIGPTImageTwoInput } from './GPTImageTwoPayload.js';

test('2.5 and 2.6 generation/edit keys submit GPT Image 2.6 Sunburst to OpenAI', async (t) => {
  const prior = process.env.SAMSAR_DEPLOYMENT_EDITION;
  process.env.SAMSAR_DEPLOYMENT_EDITION = 'production';
  const directory = mkdtempSync(join(tmpdir(), 'samsar-provider-alias-'));
  const image = join(directory, 'input.png');
  writeFileSync(image, Buffer.from('fixture'));
  t.after(() => {
    if (prior === undefined) delete process.env.SAMSAR_DEPLOYMENT_EDITION;
    else process.env.SAMSAR_DEPLOYMENT_EDITION = prior;
    rmSync(directory, { recursive: true, force: true });
  });
  const calls = [];
  for (const operation of ['generate', 'edit']) {
    t.mock.method(OpenAI.Images.prototype, operation, async (payload) => {
      calls.push({ operation, model: payload.model, quality: payload.quality });
      // Stop at the provider boundary: no network, output files or billing.
      throw Object.assign(new Error('captured'), { error: { message: 'captured' } });
    });
  }
  for (const version of ['2.5', '2.6']) {
    const model = `GPTIMAGE${version}`;
    assert.equal(normalizeStoredGPTImageModelKey(model), 'GPTIMAGE2.5');
    assert.equal(__testOnly__.resolveImageProviderForModel(model, { apiGenerationStatus: 'INIT' }), 'openai');
    const result = await handleGPTImageTwoRequest({ model, prompt: 'A landscape', aspectRatio: '16:9' });
    assert.equal(result.error, 'captured');
    const editModel = `${model}EDIT`;
    assert.equal(normalizeStoredGPTImageModelKey(editModel), 'GPTIMAGE2.5EDIT');
    assert.equal(__testOnly__.resolveImageEditProviderForModel(editModel, { apiEditStatus: 'INIT' }), 'openai');
    const edited = await getEditImageFromText({ model: editModel, image, maskImage: image, prompt: 'Blue sky', aspectRatio: '16:9' });
    assert.equal(edited.error, 'captured');
  }
  assert.deepEqual(calls, ['generate', 'edit', 'generate', 'edit'].map(operation => ({ operation, model: 'gpt-image-2.6-sunburst', quality: 'high' })));
  assert.equal(GPT_IMAGE_TWO_FAL_ENDPOINT, 'openai/gpt-image-2.6/sunburst/text-to-image');
  for (const model of ['GPTIMAGE2.5', 'GPTIMAGE2.6']) {
    assert.equal(__testOnly__.resolveImageProviderForModel(model, { apiGenerationStatus: 'PENDING', apiRequestId: 'already-submitted', submittedAdapter: 'fal' }), 'fal');
    assert.equal(buildOpenAIGPTImageTwoInput({ model, imageAdapterTariffSnapshot: { adapter: 'openai', providerModel: 'gpt-image-2.5-sunburst' } }).model, 'gpt-image-2.5-sunburst');
  }
});
