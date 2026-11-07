import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateImageCallCredits, imageBillingMode, reportedImageCharge } from './ImagePricing.js';

for (const adapter of ['openai', 'fal', 'googleCloud', 'alibabaCloud', 'gmicloud', 'samsar']) {
  test(`${adapter}: a completed call charges the reported adapter amount once at 120%`, () => {
    assert.equal(calculateImageCallCredits({ adapter, costUsd: 0.125 }).credits, 15);
    assert.equal(calculateImageCallCredits({ adapter, costUsd: 0 }).credits, 0);
  });
}

test('missing, negative, non-finite and malformed charges are never treated as free images', () => {
  for (const costUsd of [undefined, null, '', true, -1, Infinity, NaN, 'no charge']) {
    assert.throws(() => calculateImageCallCredits({ costUsd }), /charge/i);
  }
});

test('native OpenAI image billing uses actual text and image token usage', () => {
  for (const model of ['gpt-image-2.5-sunburst', 'gpt-image-2.6-sunburst']) {
    const result = calculateImageCallCredits({ adapter: 'openai', model,
      usage: { input_tokens: 300, input_tokens_details: { text_tokens: 100, image_tokens: 200 }, output_tokens: 1000 } });
    assert.equal(result.credits, 3.852);
  }
});

test('native Google distinguishes image output, text output, reasoning and cached input', () => {
  const result = calculateImageCallCredits({ adapter: 'googleCloud', model: 'gemini-3.1-flash-image', region: 'global',
    usage: { promptTokenCount: 1000, cachedContentTokenCount: 200, candidatesTokenCount: 1200, thoughtsTokenCount: 100,
      candidatesTokensDetails: [{ modality: 'IMAGE', tokenCount: 1120 }, { modality: 'TEXT', tokenCount: 80 }] } });
  assert.equal(result.credits, 8.178);
});

test('an image adapter cannot silently use another adapter token tariff', () => {
  assert.throws(() => calculateImageCallCredits({ adapter: 'gmicloud', model: 'gpt-image-2.5-sunburst',
    usage: { input_tokens: 10, output_tokens: 1000 } }), /charge/i);
});

test('native Alibaba matches model, resolution, image count and region', () => {
  const base = { adapter: 'alibabaCloud', model: 'qwen-image-3.0-pro', outputImages: 1, resolution: '1K', region: 'international' };
  assert.equal(calculateImageCallCredits(base).credits, 4.8);
  assert.equal(calculateImageCallCredits({ ...base, resolution: '2K' }).credits, 9);
  assert.equal(calculateImageCallCredits({ ...base, inputImages: 2, outputImages: 3 }).credits, 15.12);
  assert.equal(calculateImageCallCredits({ ...base, region: 'china' }).credits, 4.1256);
  assert.equal(calculateImageCallCredits({ ...base, model: 'wan2.7-image-pro', outputImages: 2 }).credits, 18);
});

test('a reported discounted charge takes priority over a native standard tariff', () => {
  assert.equal(calculateImageCallCredits({ adapter: 'alibabaCloud', model: 'qwen-image-3.0-pro',
    outputImages: 5, resolution: '2K', ...reportedImageCharge({ billing: { cost_usd: 0.01 } }) }).credits, 1.2);
});

test('invalid reported costs remain available for reconciliation rather than erasing a completed image', () => {
  const receipt = reportedImageCharge({ billing: { cost_usd: 'invalid' } });
  assert.deepEqual(receipt, { costUsd: 'invalid' });
  assert.throws(() => calculateImageCallCredits(receipt), /valid.*charge/);
});

test('Google long image outputs and regional requests retain their own rates', () => {
  const usage = { promptTokenCount: 1000, candidatesTokenCount: 2000,
    candidatesTokensDetails: [{ modality: 'IMAGE', tokenCount: 2000 }] };
  assert.equal(calculateImageCallCredits({ adapter: 'googleCloud', model: 'gemini-3-pro-image', usage }).credits, 29.04);
  assert.equal(calculateImageCallCredits({ adapter: 'googleCloud', model: 'gemini-3-pro-image', usage, region: 'us-central1' }).credits, 31.944);
  assert.throws(() => calculateImageCallCredits({ adapter: 'googleCloud', model: 'gemini-3-pro-image', usage: { ...usage, candidatesTokenCount: 3000 } }), /Inconsistent/);
});

test('direct OpenAI image edits do not apply Responses-only cache discounts', () => {
  const usage = { input_tokens: 1000, input_tokens_details: { text_tokens: 200, image_tokens: 800, cached_tokens: 1000 }, output_tokens: 1000 };
  assert.equal(calculateImageCallCredits({ adapter: 'openai', model: 'gpt-image-2.5-sunburst', usage }).credits, 4.488);
});

test('production image requests are metered while production pipeline jobs remain flat', () => {
  const production = { SAMSAR_DEPLOYMENT_EDITION: 'production', SAMSAR_RUNTIME: 'docker' };
  assert.equal(imageBillingMode({ imageBillingPolicy: 'adapter' }, production), 'adapter');
  assert.equal(imageBillingMode({ imageBillingPolicy: 'pipeline' }, production), 'pipeline');
  assert.equal(imageBillingMode({}, production), 'legacy');
});

test('standalone Docker waives the local debit even for an agent using Samsar.js', () => {
  assert.equal(imageBillingMode({ imageBillingPolicy: 'adapter', adapterProvider: 'samsar' }, { CURRENT_ENV: 'docker' }), 'standalone');
  assert.equal(imageBillingMode({ imageBillingPolicy: 'adapter' }, { SAMSAR_DEPLOYMENT_EDITION: 'standalone', SAMSAR_RUNTIME: 'docker' }), 'standalone');
  assert.equal(imageBillingMode({ imageBillingPolicy: 'adapter' }, { SAMSAR_DEPLOYMENT_EDITION: 'production', CURRENT_ENV: 'docker' }), 'adapter');
});
