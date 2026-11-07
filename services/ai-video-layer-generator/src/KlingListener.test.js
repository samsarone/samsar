import test from 'node:test';
import assert from 'node:assert/strict';
import { buildKlingInputPayload, getKlingVideoEndpoint, generateKlingVideoLayer,
  listenToPendingKlingVideoRequest } from './KlingListener.js';
import { buildFalVideoSubmissionReceipt } from './billing/FalVideoTariffs.js';
import { calculateVideoCallCredits } from './billing/VideoPricing.js';

const image = 'https://example.com/first.png';
test('Kling v4 submits every five-second boundary at 720p without an audio parameter', async () => {
  for (const duration of [5, 10, 15, 20, 25, 30]) {
    const payload = { model: 'KLINGIMGTOVID4', startImage: image, prompt: 'A moving train',
      duration, resolution: '1080p', generateAudio: true, generate_audio: true };
    const input = buildKlingInputPayload(payload);
    assert.deepEqual(input, { prompt: 'A moving train', start_image_url: image, duration, resolution: '720p' });
    const receipt = buildFalVideoSubmissionReceipt(payload);
    assert.equal(receipt.endpoint, 'kling/v4/image-to-video');
    assert.equal(receipt.submittedConfig.resolution, '720p');
    assert.equal(receipt.submittedQuantity, duration);
    assert.equal(calculateVideoCallCredits(receipt).credits, Math.round(duration * 18.84 * 100) / 100);
    assert.equal(await generateKlingVideoLayer(payload, { fal: { queue: { submit: async (endpoint, options) => {
      assert.equal(endpoint, receipt.endpoint);
      assert.deepEqual(options.input, input);
      return { request_id: 'v4-request' };
    } } } }), 'v4-request');
  }
});
test('Kling v4 rejects invalid duration and missing first image before submission', () => {
  for (const duration of [0, 3, 7, 31, 35, 'invalid']) {
    const payload = { model: 'KLINGIMGTOVID4', startImage: image, duration };
    assert.throws(() => buildKlingInputPayload(payload), /duration/i);
    assert.throws(() => buildFalVideoSubmissionReceipt(payload), /duration/i);
  }
  assert.throws(() => buildKlingInputPayload({ model: 'KLINGIMGTOVID4' }), /image/i);
});
test('Kling v4 text generation uses the corresponding v4 endpoint and 720p tariff', () => {
  const payload = { model: 'KLINGTXTTOVID4', prompt: 'A moving train', duration: 30, aspectRatio: '16:9' };
  assert.equal(getKlingVideoEndpoint(payload.model), 'kling/v4/text-to-video');
  assert.deepEqual(buildKlingInputPayload(payload), {
    prompt: 'A moving train', duration: 30, resolution: '720p', aspect_ratio: '16:9',
  });
  assert.equal(calculateVideoCallCredits(buildFalVideoSubmissionReceipt(payload)).credits, 565.2);
});
test('polling preserves legacy v3 endpoints for jobs already submitted', async () => {
  for (const [model, endpoint] of [
    ['KLINGIMGTOVID4', 'kling/v4/image-to-video'],
    ['KLINGIMGTOVID3PRO', 'fal-ai/kling-video/v3/pro/image-to-video'],
    ['KLINGIMGTOVIDTURBO', 'fal-ai/kling-video/v3/pro/image-to-video'],
  ]) {
    const fal = { queue: {
      status: async (actual) => { assert.equal(actual, endpoint); return { status: 'COMPLETED' }; },
      result: async (actual) => { assert.equal(actual, endpoint); return { data: { video: { url: 'video.mp4' } } }; },
    } };
    assert.deepEqual(await listenToPendingKlingVideoRequest({ model, generationId: 'existing' }, { fal }),
      { responseStatus: 'COMPLETED', remoteUrl: 'video.mp4' });
  }
});
