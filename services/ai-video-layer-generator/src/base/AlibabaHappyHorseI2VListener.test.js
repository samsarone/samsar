import assert from 'node:assert/strict';
import test from 'node:test';

import axios from 'axios';

import {
  buildAlibabaHappyHorseI2VPayload,
  encodeAlibabaHappyHorseGenerationId,
  generateAlibabaHappyHorseImgToVideoLayer,
  getAlibabaHappyHorseBaseUrl,
  getAlibabaHappyHorseTaskId,
  isAlibabaHappyHorseGenerationId,
  listenToPendingAlibabaHappyHorseImgToVidRequests,
  normalizeAlibabaHappyHorseDuration,
  parseAlibabaHappyHorseTask,
} from './AlibabaHappyHorseI2VListener.js';

const ENV_KEYS = [
  'ALIBABA_API_KEY',
  'ALIBABA_API_HOST',
  'ALIBABA_CLOUD_API_KEY',
  'ALIBABA_CLOUD_BASE_URL',
  'ALIBABA_VIDEO_BASE_URL',
  'DASHSCOPE_API_KEY',
  'DASHSCOPE_BASE_URL',
  'DASHSCOPE_VIDEO_BASE_URL',
  'QWEN_API_KEY',
];
const originalEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
const originalAxiosPost = axios.post;
const originalAxiosGet = axios.get;

function clearAlibabaEnv() {
  ENV_KEYS.forEach((key) => delete process.env[key]);
}

test.afterEach(() => {
  ENV_KEYS.forEach((key) => {
    if (originalEnv[key] === undefined) delete process.env[key];
    else process.env[key] = originalEnv[key];
  });
  axios.post = originalAxiosPost;
  axios.get = originalAxiosGet;
});

test('normalizes the workspace host independently from its OpenAI-compatible path', () => {
  assert.equal(
    getAlibabaHappyHorseBaseUrl({
      ALIBABA_API_HOST: 'workspace.ap-southeast-1.maas.aliyuncs.com',
    }),
    'https://workspace.ap-southeast-1.maas.aliyuncs.com',
  );
  assert.equal(
    getAlibabaHappyHorseBaseUrl({
      ALIBABA_API_HOST: 'https://workspace.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1/',
    }),
    'https://workspace.ap-southeast-1.maas.aliyuncs.com',
  );
  assert.throws(
    () => getAlibabaHappyHorseBaseUrl({ ALIBABA_API_HOST: 'http://workspace.example.com' }),
    /valid HTTPS Alibaba Model Studio host/,
  );
});

test('maps the existing Happy Horse settings to the native I2V contract', () => {
  assert.equal(normalizeAlibabaHappyHorseDuration(4), 5);
  assert.equal(normalizeAlibabaHappyHorseDuration(8), 10);
  assert.equal(normalizeAlibabaHappyHorseDuration(14), 15);

  const request = buildAlibabaHappyHorseI2VPayload({
    startImage: 'https://media.example.com/frame.png',
    prompt: 'Camera slowly pushes toward the subject.',
    duration: 8,
    aspectRatio: '9:16',
  });

  assert.deepEqual(request, {
    model: 'happyhorse-1.1-i2v',
    input: {
      prompt: 'Camera slowly pushes toward the subject.',
      media: [{ type: 'first_frame', url: 'https://media.example.com/frame.png' }],
    },
    parameters: {
      resolution: '720P',
      duration: 10,
      watermark: false,
    },
  });
  assert.equal(Object.hasOwn(request.parameters, 'ratio'), false);
});

test('prefixes native task ids so later polls never switch to the FAL adapter', () => {
  const generationId = encodeAlibabaHappyHorseGenerationId('task-123');
  assert.equal(generationId, 'alibaba-happyhorse:task-123');
  assert.equal(isAlibabaHappyHorseGenerationId(generationId), true);
  assert.equal(getAlibabaHappyHorseTaskId(generationId), 'task-123');
  assert.equal(isAlibabaHappyHorseGenerationId('fal-request-123'), false);
});

test('maps native task states to the worker completion contract', () => {
  assert.deepEqual(
    parseAlibabaHappyHorseTask({ output: { task_status: 'RUNNING', task_id: 'task-1' } }),
    {
      responseStatus: 'PENDING',
      providerStatus: {
        requestId: null,
        taskId: 'task-1',
        taskStatus: 'RUNNING',
        code: null,
        message: null,
        usage: null,
      },
    },
  );

  const completed = parseAlibabaHappyHorseTask({
    output: {
      task_status: 'SUCCEEDED',
      task_id: 'task-1',
      video_url: 'https://media.example.com/video.mp4',
    },
  });
  assert.equal(completed.responseStatus, 'COMPLETED');
  assert.equal(completed.remoteUrl, 'https://media.example.com/video.mp4');

  const failed = parseAlibabaHappyHorseTask({
    output: {
      task_status: 'FAILED',
      task_id: 'task-1',
      code: 'InvalidParameter',
      message: 'Invalid duration.',
    },
  });
  assert.equal(failed.responseStatus, 'FAILED');
  assert.equal(failed.providerFailureMessage, 'Invalid duration.');
});

test('submits and polls using the workspace native async endpoints', async () => {
  clearAlibabaEnv();
  process.env.ALIBABA_API_KEY = 'test-key';
  process.env.ALIBABA_API_HOST = 'workspace.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1';

  let submitCall;
  axios.post = async (...args) => {
    submitCall = args;
    return {
      status: 200,
      data: { output: { task_id: 'task-456', task_status: 'PENDING' } },
    };
  };

  const generationId = await generateAlibabaHappyHorseImgToVideoLayer({
    startImage: 'https://media.example.com/frame.png',
    prompt: 'A steady dolly shot.',
    duration: 5,
  });

  assert.equal(generationId, 'alibaba-happyhorse:task-456');
  assert.equal(
    submitCall[0],
    'https://workspace.ap-southeast-1.maas.aliyuncs.com/api/v1/services/aigc/video-generation/video-synthesis',
  );
  assert.equal(submitCall[2].headers.Authorization, 'Bearer test-key');
  assert.equal(submitCall[2].headers['X-DashScope-Async'], 'enable');

  let pollCall;
  axios.get = async (...args) => {
    pollCall = args;
    return {
      status: 200,
      data: {
        output: {
          task_id: 'task-456',
          task_status: 'SUCCEEDED',
          video_url: 'https://media.example.com/video.mp4',
        },
      },
    };
  };

  const result = await listenToPendingAlibabaHappyHorseImgToVidRequests({ generationId });
  assert.equal(result.responseStatus, 'COMPLETED');
  assert.equal(result.remoteUrl, 'https://media.example.com/video.mp4');
  assert.equal(
    pollCall[0],
    'https://workspace.ap-southeast-1.maas.aliyuncs.com/api/v1/tasks/task-456',
  );
  assert.equal(pollCall[1].headers.Authorization, 'Bearer test-key');
  assert.equal(Object.hasOwn(pollCall[1].headers, 'X-DashScope-Async'), false);
});

test('preserves Alibaba provider details from rejected submit responses', async () => {
  clearAlibabaEnv();
  process.env.ALIBABA_API_KEY = 'test-key';
  axios.post = async () => {
    const error = new Error('Request failed with status code 403');
    error.response = {
      status: 403,
      data: {
        request_id: 'request-403',
        code: 'DataInspectionFailed',
        message: 'The submitted content did not pass data inspection.',
      },
    };
    throw error;
  };

  await assert.rejects(
    generateAlibabaHappyHorseImgToVideoLayer({
      startImage: 'https://media.example.com/frame.png',
      prompt: 'A steady dolly shot.',
      duration: 5,
    }),
    (error) => {
      assert.equal(error.name, 'AlibabaHappyHorseError');
      assert.equal(error.status, 403);
      assert.equal(error.code, 'DataInspectionFailed');
      assert.equal(error.message, 'The submitted content did not pass data inspection.');
      assert.deepEqual(error.body, {
        requestId: 'request-403',
        taskId: null,
        taskStatus: null,
        code: 'DataInspectionFailed',
        message: 'The submitted content did not pass data inspection.',
        usage: null,
      });
      return true;
    },
  );
});

test('preserves Alibaba provider details from rejected poll responses', async () => {
  clearAlibabaEnv();
  process.env.ALIBABA_API_KEY = 'test-key';
  axios.get = async () => {
    const error = new Error('Request failed with status code 429');
    error.response = {
      status: 429,
      headers: { 'retry-after': '7' },
      data: {
        request_id: 'request-429',
        code: 'Throttling',
        message: 'Too many requests.',
      },
    };
    throw error;
  };

  await assert.rejects(
    listenToPendingAlibabaHappyHorseImgToVidRequests({
      generationId: 'alibaba-happyhorse:task-789',
    }),
    (error) => {
      assert.equal(error.name, 'AlibabaHappyHorseError');
      assert.equal(error.status, 429);
      assert.equal(error.code, 'Throttling');
      assert.equal(error.message, 'Too many requests.');
      assert.equal(error.body.requestId, 'request-429');
      assert.equal(error.headers['retry-after'], '7');
      return true;
    },
  );
});
