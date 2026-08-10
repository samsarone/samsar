import assert from 'node:assert/strict';
import test from 'node:test';

import { assertImageGenerationModelAvailable } from './Images.js';

test('Studio queue guard accepts Alibaba PAYG but rejects plan credentials', () => {
  assert.throws(
    () => assertImageGenerationModelAvailable('QWENIMAGE3PRO', {
      SAMSAR_DEPLOYMENT_EDITION: 'production',
      ALIBABA_API_KEY: 'alibaba-key',
    }),
    (error) => error?.status === 400 && /pay-as-you-go credentials/i.test(error.message),
  );

  assert.equal(assertImageGenerationModelAvailable('qwenimage3pro', {
    SAMSAR_DEPLOYMENT_EDITION: 'standalone',
    ALIBABA_API_KEY: 'alibaba-key',
  }), 'QWENIMAGE3PRO');

  for (const planMetadata of [
    { ALIBABA_API_KEY_TYPE: 'token_plan' },
    { ALIBABA_API_KEY_TYPE: 'plan' },
    { ALIBABA_API_ENDPOINT_TYPE: 'token_plan' },
    { ALIBABA_API_ENDPOINT_TYPE: 'coding_plan' },
  ]) {
    assert.throws(
      () => assertImageGenerationModelAvailable('QWENIMAGE3PRO', {
        SAMSAR_DEPLOYMENT_EDITION: 'standalone',
        ALIBABA_API_KEY: 'alibaba-key',
        ...planMetadata,
      }),
      (error) => error?.status === 400 && /pay-as-you-go credentials/i.test(error.message),
    );
  }

});

test('Studio queue guard leaves other image models unchanged', () => {
  assert.equal(
    assertImageGenerationModelAvailable('GPTIMAGE2', {
      SAMSAR_DEPLOYMENT_EDITION: 'production',
    }),
    'GPTIMAGE2',
  );
});
