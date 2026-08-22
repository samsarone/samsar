import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getAlibabaQwenImage3TimeoutMs,
  handleAlibabaQwenImage3Request,
  MIN_ALIBABA_QWEN_IMAGE_3_TIMEOUT_MS,
  requestAlibabaQwenImage3,
} from './AlibabaQwenImage3.js';
import { isAlibabaImageInfrastructureError } from './AlibabaCloudImage.js';

test('uses a ten-minute minimum timeout only for Alibaba Qwen Image 3.0 Pro', () => {
  assert.equal(MIN_ALIBABA_QWEN_IMAGE_3_TIMEOUT_MS, 600000);
  assert.equal(getAlibabaQwenImage3TimeoutMs({ env: {} }), 600000);
  assert.equal(getAlibabaQwenImage3TimeoutMs({
    env: { ALIBABA_IMAGE_GENERATION_TIMEOUT_MS: '180000' },
  }), 600000);
  assert.equal(getAlibabaQwenImage3TimeoutMs({
    env: { ALIBABA_QWEN_IMAGE_3_PRO_TIMEOUT_MS: '420000' },
  }), 600000);
  assert.equal(getAlibabaQwenImage3TimeoutMs({
    env: { ALIBABA_QWEN_IMAGE_3_PRO_TIMEOUT_MS: '660000' },
  }), 660000);
});

test('calls the synchronous Alibaba endpoint with its Qwen-only dispatcher', async () => {
  let request;
  const dispatcher = {};
  const result = await requestAlibabaQwenImage3(
    {
      prompt: 'A detailed newspaper front page',
      aspectRatio: '9:16',
      negative_prompt: 'illegible text',
    },
    {
      env: { DASHSCOPE_API_KEY: 'test-key' },
      dispatcher,
      fetchImpl: async (...args) => {
        request = args;
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({
            output: {
              choices: [{
                finish_reason: 'stop',
                message: {
                  role: 'assistant',
                  content: [{ image: 'https://example.com/qwen.png' }],
                },
              }],
            },
            usage: { width: 1024, height: 1792, image_count: 1 },
            request_id: 'qwen-request-123',
          }),
        };
      },
    },
  );

  assert.equal(
    request[0],
    'https://dashscope-intl.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation',
  );
  assert.equal(request[1].headers.Authorization, 'Bearer test-key');
  assert.equal(request[1].dispatcher, dispatcher);
  assert.deepEqual(JSON.parse(request[1].body), {
    model: 'qwen-image-3.0-pro',
    input: {
      messages: [{
        role: 'user',
        content: [{ text: 'A detailed newspaper front page' }],
      }],
    },
    parameters: {
      size: '1024*1792',
      n: 1,
      prompt_extend: true,
      watermark: false,
      negative_prompt: 'illegible text',
    },
  });
  assert.deepEqual(result, {
    imageUrl: 'https://example.com/qwen.png',
    requestId: 'qwen-request-123',
    usage: { width: 1024, height: 1792, image_count: 1 },
  });
});

test('schedules the synchronous Qwen request abort at ten minutes', async (t) => {
  let scheduledTimeoutMs = null;
  t.mock.method(globalThis, 'setTimeout', (_callback, timeoutMs) => {
    scheduledTimeoutMs = timeoutMs;
    return 1;
  });
  t.mock.method(globalThis, 'clearTimeout', () => {});

  await requestAlibabaQwenImage3(
    { prompt: 'A slow synchronous generation' },
    {
      env: { DASHSCOPE_API_KEY: 'test-key' },
      dispatcher: {},
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          output: {
            choices: [{
              message: { content: [{ image: 'https://example.com/qwen.png' }] },
            }],
          },
        }),
      }),
    },
  );

  assert.equal(scheduledTimeoutMs, 600000);
});

test('persists the downloaded Qwen result as a completed Alibaba generation', async () => {
  const updates = [];
  const imageGenerationModel = {
    async findByIdAndUpdate(filter, update) {
      updates.push({ filter, update });
    },
    async findOneAndUpdate(filter, update) {
      updates.push({ filter, update });
    },
  };

  const result = await handleAlibabaQwenImage3Request({
    _id: 'image-row-1',
    prompt: 'A crisp product photo',
    apiGenerationStatus: 'INIT',
  }, {
    isStandalone: () => true,
    connect: async () => {},
    imageGenerationModel,
    requestImage: async () => ({
      imageUrl: 'https://example.com/result.png',
      requestId: 'provider-request-1',
    }),
    saveFile: async (url) => {
      assert.equal(url, 'https://example.com/result.png');
      return 'local-qwen.png';
    },
  });

  assert.deepEqual(result, {
    image: 'local-qwen.png',
    provider: 'alibabaCloud',
    providerRequestId: 'provider-request-1',
  });
  assert.deepEqual(updates.at(-2).filter, { _id: 'image-row-1' });
  assert.deepEqual(
    {
      ...updates.at(-2).update,
      apiSubmittedAt: updates.at(-2).update.apiSubmittedAt instanceof Date,
    },
    {
      apiRequestId: 'provider-request-1',
      apiGenerationStatus: 'PENDING',
      apiSubmittedAt: true,
      externalProvider: 'alibabaCloud',
      providerResultUrl: 'https://example.com/result.png',
      providerSubmissionAccepted: true,
      submissionOutcomeUnknown: true,
      rowLocked: true,
    },
  );
  assert.deepEqual(updates.at(-1), {
    filter: { _id: 'image-row-1' },
    update: {
      apiRequestId: 'provider-request-1',
      apiGenerationStatus: 'COMPLETED',
      generationStatus: 'COMPLETED',
      externalProvider: 'alibabaCloud',
      providerResultUrl: 'https://example.com/result.png',
      providerSubmissionAccepted: true,
      submissionOutcomeUnknown: false,
      rowLocked: false,
    },
  });
});

test('fails closed for ambiguous Alibaba submissions that may already be billed', async () => {
  const cases = [
    { label: 'timeout', metadata: { status: 408, providerSubmissionAttempted: true } },
    { label: 'conflict', metadata: { status: 409, providerSubmissionAttempted: true } },
    {
      label: 'server error',
      metadata: {
        status: 500,
        providerSubmissionAttempted: true,
        providerRequestId: 'ambiguous-provider-request',
      },
    },
    { label: 'network disconnect', metadata: { providerSubmissionAttempted: true } },
  ];

  for (const testCase of cases) {
    const updates = [];
    const imageGenerationModel = {
      async findByIdAndUpdate(filter, update) {
        updates.push({ filter, update });
      },
      async findOneAndUpdate(filter, update) {
        updates.push({ filter, update });
      },
    };
    const providerError = Object.assign(
      new Error(`Ambiguous ${testCase.label}`),
      testCase.metadata,
    );

    await assert.rejects(
      handleAlibabaQwenImage3Request({
        _id: `ambiguous-${testCase.label}`,
        prompt: 'A generated image',
        apiGenerationStatus: 'INIT',
        operationType: 'GENERATE',
        isBatchGeneration: true,
      }, {
        isStandalone: () => true,
        connect: async () => {},
        imageGenerationModel,
        requestImage: async () => {
          throw providerError;
        },
      }),
      (error) => {
        assert.equal(error, providerError);
        assert.equal(error.submissionOutcomeUnknown, true, testCase.label);
        assert.equal(error.nonPromptProviderFailure, true, testCase.label);
        assert.equal(error.preserveExpressImageLayer, true, testCase.label);
        return true;
      },
    );

    assert.deepEqual(updates.at(-1).update, {
      generationStatus: 'FAILED',
      apiGenerationStatus: 'FAILED',
      generationError: `Ambiguous ${testCase.label}`,
      ...(testCase.metadata.providerRequestId
        ? { apiRequestId: testCase.metadata.providerRequestId }
        : {}),
      providerSubmissionAccepted: false,
      submissionOutcomeUnknown: true,
      externalProvider: 'alibabaCloud',
      rowLocked: false,
    });
  }
});

test('keeps definitive pre-submit and provider rejections retry-safe', async () => {
  const cases = [
    {
      label: 'local validation',
      error: Object.assign(new Error('Invalid local request'), {
        providerSubmissionAttempted: false,
      }),
    },
    {
      label: 'provider rejection',
      error: Object.assign(new Error('Prompt rejected'), {
        status: 400,
        providerSubmissionAttempted: true,
        providerResponseReceived: true,
      }),
    },
  ];

  for (const testCase of cases) {
    const updates = [];
    const imageGenerationModel = {
      async findByIdAndUpdate(filter, update) {
        updates.push({ filter, update });
      },
      async findOneAndUpdate(filter, update) {
        updates.push({ filter, update });
      },
    };
    const result = await handleAlibabaQwenImage3Request({
      _id: `definitive-${testCase.label}`,
      prompt: 'A generated image',
      apiGenerationStatus: 'INIT',
    }, {
      isStandalone: () => true,
      connect: async () => {},
      imageGenerationModel,
      requestImage: async () => {
        throw testCase.error;
      },
    });

    assert.deepEqual(result, {
      image: null,
      error: testCase.error.message,
    });
    assert.equal(updates.at(-1).update.providerSubmissionAccepted, false);
    assert.equal(updates.at(-1).update.submissionOutcomeUnknown, false);
  }
});

test('preserves an accepted Alibaba result and blocks resubmission when download fails', async () => {
  const updates = [];
  let requestCount = 0;
  const imageGenerationModel = {
    async findByIdAndUpdate(filter, update) {
      updates.push({ filter, update });
    },
    async findOneAndUpdate(filter, update) {
      updates.push({ filter, update });
    },
  };
  const downloadError = Object.assign(new Error('Local image download timed out'), {
    code: 'ETIMEDOUT',
  });

  await assert.rejects(
    handleAlibabaQwenImage3Request({
      _id: 'accepted-download-failure',
      prompt: 'A generated image',
      apiGenerationStatus: 'INIT',
      operationType: 'GENERATE',
      isBatchGeneration: true,
    }, {
      isStandalone: () => true,
      connect: async () => {},
      imageGenerationModel,
      requestImage: async () => {
        requestCount += 1;
        return {
          imageUrl: 'https://example.com/accepted-result.png',
          requestId: 'accepted-provider-request',
        };
      },
      saveFile: async () => {
        const acceptedUpdate = updates.at(-1).update;
        assert.equal(acceptedUpdate.apiRequestId, 'accepted-provider-request');
        assert.equal(acceptedUpdate.providerResultUrl, 'https://example.com/accepted-result.png');
        assert.equal(acceptedUpdate.providerSubmissionAccepted, true);
        assert.equal(acceptedUpdate.submissionOutcomeUnknown, true);
        throw downloadError;
      },
    }),
    (error) => {
      assert.equal(error, downloadError);
      assert.equal(error.submissionOutcomeUnknown, true);
      assert.equal(error.nonPromptProviderFailure, true);
      return true;
    },
  );

  assert.equal(requestCount, 1);
  assert.deepEqual(updates.at(-1).update, {
    generationStatus: 'FAILED',
    apiGenerationStatus: 'FAILED',
    generationError: 'Local image download timed out',
    apiRequestId: 'accepted-provider-request',
    providerResultUrl: 'https://example.com/accepted-result.png',
    providerSubmissionAccepted: true,
    submissionOutcomeUnknown: true,
    externalProvider: 'alibabaCloud',
    rowLocked: false,
  });
});

test('keeps the unsafe-resubmission marker when accepted-result persistence is unavailable', async () => {
  let persistenceAttempts = 0;
  const acceptedStateError = new Error('Database unavailable before download');
  const failureStateError = new Error('Database unavailable while recording failure');
  const imageGenerationModel = {
    async findByIdAndUpdate() {},
    async findOneAndUpdate() {
      persistenceAttempts += 1;
      throw persistenceAttempts === 1 ? acceptedStateError : failureStateError;
    },
  };

  await assert.rejects(
    handleAlibabaQwenImage3Request({
      _id: 'accepted-persistence-failure',
      prompt: 'A generated image',
      apiGenerationStatus: 'INIT',
      operationType: 'GENERATE',
      isBatchGeneration: true,
    }, {
      isStandalone: () => true,
      connect: async () => {},
      imageGenerationModel,
      requestImage: async () => ({
        imageUrl: 'https://example.com/accepted-result.png',
        requestId: 'accepted-provider-request',
      }),
      saveFile: async () => {
        throw new Error('download must not start before accepted state is durable');
      },
    }),
    (error) => {
      assert.equal(error, failureStateError);
      assert.equal(error.submissionOutcomeUnknown, true);
      assert.equal(error.nonPromptProviderFailure, true);
      assert.equal(error.cause, acceptedStateError);
      return true;
    },
  );

  assert.equal(persistenceAttempts, 2);
});

test('submits Qwen Image 3 after hosted routing selects native Alibaba', async () => {
  let submitted = false;
  const imageGenerationModel = {
    async findByIdAndUpdate() {},
    async findOneAndUpdate() {},
  };
  const result = await handleAlibabaQwenImage3Request({
    _id: 'hosted-image-row',
    prompt: 'Submit this through native Alibaba',
    apiGenerationStatus: 'INIT',
  }, {
    connect: async () => {},
    imageGenerationModel,
    requestImage: async () => {
      submitted = true;
      return {
        imageUrl: 'https://example.com/hosted-qwen.png',
        requestId: 'hosted-provider-request',
      };
    },
    saveFile: async () => 'hosted-qwen.png',
  });

  assert.equal(submitted, true);
  assert.deepEqual(result, {
    image: 'hosted-qwen.png',
    provider: 'alibabaCloud',
    providerRequestId: 'hosted-provider-request',
  });
});

test('Alibaba Qwen provider errors do not expose the API key', async () => {
  await assert.rejects(
    requestAlibabaQwenImage3(
      { prompt: 'test' },
      {
        env: { ALIBABA_API_KEY: 'secret-qwen-key' },
        fetchImpl: async () => ({
          ok: false,
          status: 401,
          text: async () => JSON.stringify({ code: 'InvalidApiKey', message: 'Rejected' }),
        }),
      },
    ),
    (error) => {
      assert.equal(error.message, 'Rejected');
      assert.equal(JSON.stringify(error).includes('secret-qwen-key'), false);
      return true;
    },
  );
});

test('preserves Alibaba rate-limit status and Retry-After metadata', async () => {
  await assert.rejects(
    requestAlibabaQwenImage3(
      { prompt: 'test' },
      {
        env: { ALIBABA_API_KEY: 'secret-qwen-key' },
        fetchImpl: async () => ({
          ok: false,
          status: 429,
          headers: { get: (name) => name === 'retry-after' ? '60' : null },
          text: async () => JSON.stringify({
            code: 'Throttling.RateQuota',
            message: 'Rate limit exceeded',
            request_id: 'rate-limited-request',
          }),
        }),
      },
    ),
    (error) => {
      assert.equal(error.status, 429);
      assert.equal(error.providerCode, 'Throttling.RateQuota');
      assert.equal(error.providerRequestId, 'rate-limited-request');
      assert.equal(error.retryAfterMs, 60000);
      assert.equal(error.providerSubmissionAttempted, true);
      assert.equal(error.providerResponseReceived, true);
      assert.equal(isAlibabaImageInfrastructureError(error), true);
      return true;
    },
  );
});

test('marks unavailable transport as a definitive pre-submit failure', async () => {
  await assert.rejects(
    requestAlibabaQwenImage3(
      { prompt: 'test' },
      {
        env: { ALIBABA_API_KEY: 'test-key' },
        fetchImpl: {},
      },
    ),
    (error) => {
      assert.equal(error.providerSubmissionAttempted, false);
      assert.equal(error.providerResponseReceived, false);
      return true;
    },
  );
});
