import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BACKBLAZE_CREDENTIAL_TYPE_APPLICATION,
  BACKBLAZE_CREDENTIAL_TYPE_MASTER,
  BackblazeNativeClient,
  normalizeBackblazeCredentialType,
  shouldUseBackblazeNativeApi,
} from './index.js';

test('normalizes saved Backblaze credential types and routes only master keys natively', () => {
  assert.equal(normalizeBackblazeCredentialType('standard'), BACKBLAZE_CREDENTIAL_TYPE_APPLICATION);
  assert.equal(normalizeBackblazeCredentialType('master-key'), BACKBLAZE_CREDENTIAL_TYPE_MASTER);
  assert.equal(shouldUseBackblazeNativeApi({
    SAMSAR_STORAGE_BACKEND: 'backblaze-b2',
    SAMSAR_BACKBLAZE_CREDENTIAL_TYPE: 'master',
  }), true);
  assert.equal(shouldUseBackblazeNativeApi({
    SAMSAR_STORAGE_BACKEND: 'backblaze-b2',
    SAMSAR_BACKBLAZE_CREDENTIAL_TYPE: 'application',
  }), false);
});

test('native client uploads with B2 upload authorization and returns S3-shaped metadata', async () => {
  const requests = [];
  const jsonResponse = (body, status = 200) => new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'x-bz-request-id': 'request-1' },
  });
  const client = new BackblazeNativeClient({
    applicationKeyId: 'account-id',
    applicationKey: 'master-key-value',
    bucketName: 'samsar',
    fetchImpl: async (url, options = {}) => {
      requests.push({ url: String(url), options });
      if (String(url).includes('b2_authorize_account')) {
        return jsonResponse({
          accountId: 'account-id',
          authorizationToken: 'account-token',
          apiInfo: {
            storageApi: {
              apiUrl: 'https://api005.backblazeb2.com',
              downloadUrl: 'https://f005.backblazeb2.com',
              allowed: { capabilities: ['writeFiles', 'listBuckets'] },
            },
          },
        });
      }
      if (String(url).endsWith('/b2_list_buckets')) {
        return jsonResponse({ buckets: [{ bucketId: 'bucket-id', bucketName: 'samsar' }] });
      }
      if (String(url).endsWith('/b2_get_upload_url')) {
        return jsonResponse({ uploadUrl: 'https://upload005.backblazeb2.com/file', authorizationToken: 'upload-token' });
      }
      if (String(url).includes('upload005.backblazeb2.com')) {
        return jsonResponse({ fileId: 'file-id', contentSha1: 'sha1-value' });
      }
      throw new Error(`Unexpected request: ${url}`);
    },
  });

  class PutObjectCommand {
    constructor(input) { this.input = input; }
  }
  const result = await client.send(new PutObjectCommand({
    Bucket: 'samsar',
    Key: 'assets_v2/test.txt',
    Body: Buffer.from('hello'),
    ContentType: 'text/plain',
  }));
  assert.equal(result.VersionId, 'file-id');
  assert.equal(result.$metadata.httpStatusCode, 200);
  const uploadRequest = requests.find((request) => request.url.includes('upload005.backblazeb2.com'));
  assert.equal(uploadRequest.options.headers.Authorization, 'upload-token');
  assert.equal(uploadRequest.options.headers['X-Bz-File-Name'], 'assets_v2%2Ftest.txt');
  assert.equal(uploadRequest.options.headers['Content-Length'], '5');
});
