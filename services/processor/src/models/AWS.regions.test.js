import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { S3Client } from '@aws-sdk/client-s3';
import {
  __testOnly__,
  copyObjectToPublicationsMedia,
  uploadBufferToPublicationsMedia,
  uploadFileToPublicationsMedia,
} from './AWS.js';

function resolver(send, options = {}) {
  return __testOnly__.createBucketRegionResolver({
    getClient: (region) => ({ send: (command) => send(command, region) }),
    getFallbackRegion: () => 'us-east-1',
    getCacheScope: () => 'test',
    allowHeadBucket: () => true,
    ...options,
  });
}

test('wrong-region discovery uses the AWS region hint and caches only the discovered region', async () => {
  let calls = 0;
  const resolve = resolver(async (command, region) => {
    calls++;
    assert.equal(command.constructor.name, 'GetBucketLocationCommand');
    assert.equal(region, 'us-east-1');
    throw Object.assign(new Error('Authorization header is malformed'), {
      name: 'AuthorizationHeaderMalformed',
      $response: { headers: { 'x-amz-bucket-region': 'us-west-1' } },
    });
  });
  assert.equal(await resolve('publication-bucket'), 'us-west-1');
  assert.equal(await resolve('publication-bucket'), 'us-west-1');
  assert.equal(calls, 1);
});

test('denied location discovery obtains region from HeadBucket, including forbidden responses', async () => {
  for (const headForbidden of [false, true]) {
    const commands = [];
    const resolve = resolver(async (command) => {
      commands.push(command.constructor.name);
      if (command.constructor.name === 'GetBucketLocationCommand') {
        throw Object.assign(new Error('Access Denied'), { name: 'AccessDenied' });
      }
      if (headForbidden) {
        throw { $response: { headers: { 'x-amz-bucket-region': 'us-west-1' } } };
      }
      return { BucketRegion: 'us-west-1' };
    });
    assert.equal(await resolve('publication-bucket'), 'us-west-1');
    assert.deepEqual(commands, ['GetBucketLocationCommand', 'HeadBucketCommand']);
  }
});

test('transient discovery failures do not cache the fallback region', async () => {
  let locationAttempts = 0;
  const resolve = resolver(async (command) => {
    if (command.constructor.name === 'GetBucketLocationCommand' && ++locationAttempts > 1) {
      return { LocationConstraint: 'us-west-1' };
    }
    throw new Error('temporary connection failure');
  });
  assert.equal(await resolve('publication-bucket'), 'us-east-1');
  assert.equal(await resolve('publication-bucket'), 'us-west-1');
  assert.equal(locationAttempts, 2);
});

test('region discovery preserves legacy AWS location responses', async () => {
  for (const [location, expected] of [[null, 'us-east-1'], ['', 'us-east-1'], ['EU', 'eu-west-1'], ['us-west-1', 'us-west-1']]) {
    const resolve = resolver(async () => ({ LocationConstraint: location }));
    assert.equal(await resolve('publication-bucket'), expected);
  }
  const resolve = resolver(async () => { throw { Region: 'us-west-1' }; });
  assert.equal(await resolve('publication-bucket'), 'us-west-1');
});

test('concurrent discovery is shared and each bucket and storage endpoint keeps its own region', async () => {
  let scope = 'first-endpoint';
  let calls = 0;
  const resolve = resolver(async (command) => {
    calls++;
    return { LocationConstraint: command.input.Bucket === 'first' ? 'us-west-1' : 'eu-west-1' };
  }, { getCacheScope: () => scope });
  assert.deepEqual(await Promise.all([resolve('first'), resolve('first')]), ['us-west-1', 'us-west-1']);
  assert.equal(calls, 1);
  assert.equal(await resolve('second'), 'eu-west-1');
  scope = 'second-endpoint';
  assert.equal(await resolve('first'), 'us-west-1');
  assert.equal(calls, 3);
});

function mockStorage(t, overrides, send) {
  const values = {
    CURRENT_ENV: 'production', SAMSAR_MEDIA_DELIVERY_MODE: 's3-cloudfront',
    MEDIA_DELIVERY_MODE: undefined, S3_ENDPOINT: undefined, AWS_S3_ENDPOINT: undefined,
    SAMSAR_STORAGE_BACKEND: undefined, SAMSAR_BACKBLAZE_CREDENTIAL_TYPE: undefined,
    BACKBLAZE_CREDENTIAL_TYPE: undefined,
    AWS_CDN_REGION: 'us-east-1', AWS_S3_REGION: 'us-east-1',
    AWS_ACCESS_KEY_ID: 'test-access-key', AWS_SECRET_ACCESS_KEY: 'test-secret-key',
    ...overrides,
  };
  const original = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]));
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  const originalSend = S3Client.prototype.send;
  S3Client.prototype.send = send;
  t.after(() => {
    S3Client.prototype.send = originalSend;
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
}

test('publication uploads and cross-bucket copies sign for the destination discovered from an authorization error', async (t) => {
  const writes = [];
  mockStorage(t, {}, async function (command) {
    const region = await this.config.region();
    assert.equal(this.config.followRegionRedirects, true);
    if (command.constructor.name === 'GetBucketLocationCommand') {
      assert.equal(region, 'us-east-1');
      throw { name: 'AuthorizationHeaderMalformed', Region: 'us-west-1' };
    }
    assert.equal(region, 'us-west-1');
    writes.push(command);
    return {};
  });
  await copyObjectToPublicationsMedia({
    sourceBucketName: 'source-in-another-region', sourceKey: 'private/original video.mp4',
    key: 'published/test/video.mp4', contentType: 'video/mp4',
  });
  await uploadBufferToPublicationsMedia({
    key: 'published/test/cover.png', buffer: Buffer.from('cover'), contentType: 'image/png',
  });
  assert.deepEqual(writes.map((command) => command.constructor.name), ['CopyObjectCommand', 'PutObjectCommand']);
  assert.equal(writes[0].input.Bucket, writes[1].input.Bucket);
  assert.equal(writes[0].input.CopySource, encodeURIComponent('source-in-another-region/private/original video.mp4'));
});

test('explicit S3-compatible endpoint keeps its configured region and disables AWS redirects', async (t) => {
  const commands = [];
  mockStorage(t, { S3_ENDPOINT: 'https://storage.example.test', AWS_S3_REGION: 'us-west-004' }, async function (command) {
    commands.push(command.constructor.name);
    assert.equal(await this.config.region(), 'us-west-004');
    assert.equal(this.config.followRegionRedirects, false);
    if (command.constructor.name === 'GetBucketLocationCommand') throw new Error('Not supported');
    return {};
  });
  await uploadBufferToPublicationsMedia({ key: 'published/test/cover.png', buffer: Buffer.from('cover') });
  assert.deepEqual(commands, ['GetBucketLocationCommand', 'PutObjectCommand']);
});

test('publication video file streams use the discovered region before uploading', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'publication-region-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const filePath = path.join(directory, 'video.mp4');
  await fs.writeFile(filePath, 'rendered-video');
  let uploaded = false;
  mockStorage(t, { AWS_CDN_REGION: 'eu-west-1' }, async function (command) {
    if (command.constructor.name === 'GetBucketLocationCommand') {
      return { LocationConstraint: 'us-west-1' };
    }
    assert.equal(await this.config.region(), 'us-west-1');
    assert.equal(command.input.ContentType, 'video/mp4');
    assert.equal(command.input.ContentLength, Buffer.byteLength('rendered-video'));
    const chunks = [];
    for await (const chunk of command.input.Body) chunks.push(chunk);
    assert.equal(Buffer.concat(chunks).toString(), 'rendered-video');
    uploaded = true;
    return {};
  });
  await uploadFileToPublicationsMedia({ key: 'published/test/video.mp4', filePath, contentType: 'video/mp4' });
  assert.equal(uploaded, true);
});
