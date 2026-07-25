import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildDirectExternalI2VGenerationDocument,
  requestRenderDirectExternalI2VVideo,
} from './DirectExternalI2V.js';

const GENERATION_ID = '64b000000000000000000001';
const SESSION_ID = '64b000000000000000000002';
const LAYER_ID = '64b000000000000000000003';

function buildPayload() {
  return {
    generationRequestId: GENERATION_ID,
    videoSessionId: SESSION_ID,
    currentLayerId: LAYER_ID,
    externalRequestIdempotencyKey: 'local-job:attempt:0',
    startImage: 'https://media.example.com/start.png',
    prompt: 'Slow camera push',
    model: 'COSMOS3SUPERI2V',
    aspectRatio: '9:16',
    duration: 8,
    framesPerSecond: 24,
    userId: '64b000000000000000000004',
  };
}

test('direct external I2V queue document contains one final start image and no image-edit stage', () => {
  const document = buildDirectExternalI2VGenerationDocument(buildPayload());

  assert.equal(document._id, GENERATION_ID);
  assert.equal(document.startImage, 'https://media.example.com/start.png');
  assert.equal(document.model, 'COSMOS3SUPERI2V');
  assert.equal(document.useStartFrame, true);
  assert.equal(document.useEndFrame, false);
  assert.equal(document.retryOnFail, false);
  assert.equal(document.isExternalDirectImageToVideo, true);
  assert.equal(Object.hasOwn(document, 'imageModel'), false);
  assert.equal(Object.hasOwn(document, 'image_model'), false);
  assert.equal(Object.hasOwn(document, 'requiresEnhancement'), false);
});

test('repeated direct I2V queue calls converge on one deterministic generation document', async () => {
  let storedDocument = null;
  let insertedDocuments = 0;
  const generationModel = {
    async findOneAndUpdate(filter, update) {
      assert.equal(filter._id, GENERATION_ID);
      if (!storedDocument) {
        storedDocument = update.$setOnInsert;
        insertedDocuments += 1;
      }
      return storedDocument;
    },
  };

  const first = await requestRenderDirectExternalI2VVideo(
    buildPayload(),
    { generationModel },
  );
  const second = await requestRenderDirectExternalI2VVideo(
    buildPayload(),
    { generationModel },
  );

  assert.equal(first, second);
  assert.equal(insertedDocuments, 1);
  assert.equal(storedDocument._id, GENERATION_ID);
});
