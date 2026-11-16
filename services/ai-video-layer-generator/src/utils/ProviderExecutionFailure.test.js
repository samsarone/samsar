import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getProviderExecutionRejection,
  getProviderResultInfrastructureCode,
  readProviderVideoResult,
} from './ProviderNetworkRecovery.js';

const moderationBody = {
  detail: [{
    loc: ['body'],
    msg: 'The content could not be processed because it contained material flagged by a content checker.',
    type: 'content_policy_violation',
    url: 'https://docs.fal.ai/errors#content_policy_violation',
    input: '',
    categories: ['model_moderated'],
  }],
};

function resultError(status = 422, fields = {}) {
  return Object.assign(new Error('Unprocessable Entity'), {
    status,
    providerOperation: 'result',
    ...fields,
  });
}

test('result reads return the original successful result after exactly one read', async () => {
  const result = { data: { video: { url: 'https://media.example/completed.mp4' } } };
  let reads = 0;
  const actual = await readProviderVideoResult(async () => {
    reads++;
    return result;
  });
  assert.strictEqual(actual, result);
  assert.equal(reads, 1);
});

test('result reads annotate and rethrow the same provider error without retrying', async () => {
  const error = Object.assign(new Error('Unprocessable Entity'), {
    name: 'ValidationError',
    status: 422,
    body: structuredClone(moderationBody),
  });
  const originalBody = error.body;
  let reads = 0;
  await assert.rejects(readProviderVideoResult(async () => {
    reads++;
    throw error;
  }), actual => {
    assert.strictEqual(actual, error);
    assert.strictEqual(actual.body, originalBody);
    assert.equal(actual.providerOperation, 'result');
    assert.equal(actual.status, 422);
    return true;
  });
  assert.equal(reads, 1);
});

test('the production FAL moderation result becomes a definitive execution rejection with full details', () => {
  const body = structuredClone(moderationBody);
  const error = resultError(422, { name: 'ValidationError', body });
  const rejection = getProviderExecutionRejection(error);
  assert.deepEqual(rejection, {
    responseStatus: 'FAILED',
    providerStatus: { status: 422, ...body },
    providerFailureMessage: body.detail[0].msg,
    providerFailureCode: null,
  });
  assert.deepEqual(rejection.providerStatus.detail[0].categories, ['model_moderated']);
  assert.equal(error.message, 'Unprocessable Entity');
  assert.deepEqual(error.body, body);
});

test('Axios result rejections preserve response data and their HTTP status', () => {
  const body = {
    detail: [{ type: 'value_error', msg: 'The requested duration is not supported.', loc: ['body', 'duration'] }],
    request_id: 'accepted-request',
  };
  const rejection = getProviderExecutionRejection(resultError(undefined, {
    status: undefined,
    response: { status: 422, data: body },
  }));
  assert.equal(rejection.responseStatus, 'FAILED');
  assert.equal(rejection.providerFailureMessage, body.detail[0].msg);
  assert.deepEqual(rejection.providerStatus, { status: 422, ...body });
  assert.equal(rejection.providerFailureCode, null);
});

test('result rejections recognize statusCode as well as status', () => {
  const body = { detail: [{ type: 'value_error', msg: 'Image dimensions are invalid.' }] };
  const rejection = getProviderExecutionRejection(resultError(undefined, {
    status: undefined,
    statusCode: 422,
    body,
  }));
  assert.equal(rejection.providerStatus.status, 422);
  assert.equal(rejection.providerFailureMessage, body.detail[0].msg);
});

for (const [name, body, expectedMessage] of [
  ['string detail', { detail: 'The supplied video duration is invalid.' }, 'The supplied video duration is invalid.'],
  ['body message', { message: 'The requested resolution is unsupported.', field: 'resolution' }, 'The requested resolution is unsupported.'],
  ['body error', { error: 'The supplied frame is invalid.', request_id: 'accepted-request' }, 'The supplied frame is invalid.'],
  ['unstructured details', { detail: [{ reason: 'Unsupported input' }] }, 'Unprocessable Entity'],
  ['no response body', undefined, 'Unprocessable Entity'],
]) {
  test(`result HTTP 422 uses ${name} while retaining provider response details`, () => {
    const rejection = getProviderExecutionRejection(resultError(422, { body }));
    assert.equal(rejection.responseStatus, 'FAILED');
    assert.equal(rejection.providerFailureMessage, expectedMessage);
    assert.equal(rejection.providerFailureCode, null);
    assert.equal(rejection.providerStatus.status, 422);
    if (body) assert.deepEqual(rejection.providerStatus, { status: 422, ...body });
  });
}

test('multiple structured validation details retain their fields and combine their messages', () => {
  const body = {
    detail: [
      { type: 'value_error', msg: 'Invalid duration.', loc: ['body', 'duration'] },
      { type: 'value_error', msg: 'Invalid resolution.', loc: ['body', 'resolution'] },
    ],
  };
  const rejection = getProviderExecutionRejection(resultError(422, { body }));
  assert.equal(rejection.providerFailureMessage, 'Invalid duration.; Invalid resolution.');
  assert.deepEqual(rejection.providerStatus.detail, body.detail);
});

test('a provider media-download result failure remains infrastructure instead of an execution rejection', () => {
  const error = resultError(422, {
    body: { detail: [{ type: 'file_download_error', msg: 'Failed to download file.', loc: ['body', 'image_url'] }] },
  });
  assert.equal(getProviderExecutionRejection(error), null);
  assert.equal(getProviderResultInfrastructureCode({
    providerStatus: { status: 422, ...error.body },
  }), 'PROVIDER_MEDIA_DOWNLOAD_FAILED');
});

test('result validation details reporting network infrastructure remain outside execution recovery', () => {
  const error = resultError(422, {
    body: { detail: [{ type: 'gateway_timeout', msg: 'Provider gateway timed out.' }] },
  });
  assert.equal(getProviderExecutionRejection(error), null);
});

for (const status of [400, 401, 403, 404, 408, 429, 500, 503]) {
  test(`result HTTP ${status} does not become an execution rejection`, () => {
    const error = resultError(status, { body: structuredClone(moderationBody) });
    assert.equal(getProviderExecutionRejection(error), null);
  });
}

test('HTTP 422 from submission or status reads never becomes an execution rejection', () => {
  for (const providerOperation of [undefined, 'submit', 'status', 'poll']) {
    const error = resultError(422, { providerOperation, body: structuredClone(moderationBody) });
    assert.equal(getProviderExecutionRejection(error), null);
  }
});

test('missing provider status or error cannot be classified as an execution rejection', () => {
  for (const error of [undefined, null, {}, new Error('Unprocessable Entity'), {
    providerOperation: 'result', body: structuredClone(moderationBody),
  }]) {
    assert.equal(getProviderExecutionRejection(error), null);
  }
});
