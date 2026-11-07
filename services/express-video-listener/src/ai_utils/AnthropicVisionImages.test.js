import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { inlineAnthropicVisionImages, usesLocalAnthropicVisionImages } from './AnthropicVisionImages.js';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZlSAAAAAASUVORK5CYII=', 'base64');
const image = url => ({ type: 'image', source: { type: 'url', url } });
const bodyFor = (...content) => ({ model: 'claude-fable-5-1', messages: [{ role: 'user', content }] });

async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'samsar-claude-local-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const assets = path.join(directory, 'assets');
  const assetsV2 = path.join(directory, 'assets_v2');
  await Promise.all([fs.mkdir(path.join(assets, 'generations'), { recursive: true }), fs.mkdir(path.join(assetsV2, 'generations'), { recursive: true })]);
  const file = path.join(assetsV2, 'generations', 'frame.png');
  await fs.writeFile(file, png);
  return {
    directory, assets, assetsV2, file,
    env: {
      CURRENT_ENV: 'standalone', SAMSAR_DEPLOYMENT_EDITION: 'standalone', SAMSAR_RUNTIME: 'docker',
      SAMSAR_MEDIA_DELIVERY_MODE: 'docker-local', SAMSAR_ASSETS_ROOT: assets, SAMSAR_ASSETS_V2_ROOT: assetsV2,
    },
  };
}

test('base64 mode is restricted to standalone Docker with local media', () => {
  assert.equal(usesLocalAnthropicVisionImages({ CURRENT_ENV: 'docker' }), true);
  assert.equal(usesLocalAnthropicVisionImages({ CURRENT_ENV: 'standalone' }), true);
  assert.equal(usesLocalAnthropicVisionImages({ CURRENT_ENV: 'production', SAMSAR_RUNTIME: 'docker' }), false);
  assert.equal(usesLocalAnthropicVisionImages({ CURRENT_ENV: 'standalone', SAMSAR_DEPLOYMENT_EDITION: 'production', SAMSAR_RUNTIME: 'docker', MEDIA_DELIVERY_MODE: 'docker-local' }), false);
  assert.equal(usesLocalAnthropicVisionImages({ CURRENT_ENV: 'standalone', SAMSAR_RUNTIME: 'server', MEDIA_DELIVERY_MODE: 'docker-local' }), false);
  assert.equal(usesLocalAnthropicVisionImages({ CURRENT_ENV: 'docker', SAMSAR_MEDIA_DELIVERY_MODE: 's3-cloudfront' }), false);
  assert.equal(usesLocalAnthropicVisionImages({ CURRENT_ENV: 'docker', MEDIA_DELIVERY_MODE: 'external-s3' }), false);
  assert.equal(usesLocalAnthropicVisionImages({ CURRENT_ENV: 'docker', SAMSAR_EXTERNAL_MEDIA_PUBLISH_ENABLED: 'true' }), false);
  assert.equal(usesLocalAnthropicVisionImages({ CURRENT_ENV: 'docker', MEDIA_DELIVERY_MODE: 'local-filesystem' }), true);
  assert.equal(usesLocalAnthropicVisionImages({}), false);
});

test('mounted images become native base64 including nested tool results, with input preserved', async t => {
  const f = await fixture(t);
  const existing = { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'existing-data' } };
  const file = { type: 'image', source: { type: 'file', file_id: 'file-existing' } };
  const input = bodyFor(
    { ...image('/assets_v2/generations/frame.png'), cache_control: { type: 'ephemeral' } },
    { type: 'tool_result', tool_use_id: 'tool-1', content: [{ type: 'text', text: 'Screenshot' }, image('assets_v2/generations/frame.png')] },
    existing, file,
    { type: 'tool_use', id: 'untouched', input: image('/assets_v2/metadata-not-an-image.png') },
  );
  const before = structuredClone(input);
  const result = await inlineAnthropicVisionImages(input, { env: f.env, fetchImpl: () => assert.fail('No network request is expected.') });
  assert.deepEqual(input, before);
  assert.deepEqual(result.messages[0].content[0].source, { type: 'base64', media_type: 'image/png', data: png.toString('base64') });
  assert.deepEqual(result.messages[0].content[0].cache_control, { type: 'ephemeral' });
  assert.equal(result.messages[0].content[1].content[1].source.type, 'base64');
  assert.deepEqual(result.messages[0].content.slice(2), input.messages[0].content.slice(2));
});

test('configured roots support absolute paths, assets aliases, and legacy generations', async t => {
  const f = await fixture(t);
  await fs.writeFile(path.join(f.assets, 'generations', 'legacy.png'), png);
  const result = await inlineAnthropicVisionImages(bodyFor(
    image(f.file), image('/assets/generations/legacy.png'), image('generations/legacy.png'),
  ), { env: f.env });
  for (const block of result.messages[0].content) assert.equal(block.source.data, png.toString('base64'));
});

test('legacy media aliases prefer assets_v2, fall back to assets, and resolve owned URL prefixes', async t => {
  const f = await fixture(t);
  const references = [];
  for (const alias of ['temp_images', 'user_resources', 'video', 'ai_video']) {
    await fs.mkdir(path.join(f.assetsV2, alias, 'session'), { recursive: true });
    await fs.mkdir(path.join(f.assets, alias, 'session'), { recursive: true });
    await fs.writeFile(path.join(f.assetsV2, alias, 'session', 'frame.png'), png);
    await fs.writeFile(path.join(f.assets, alias, 'session', 'frame.png'), Buffer.concat([png, Buffer.from('legacy')]));
    references.push(`${alias}/session/frame.png`, `https://media.example.test/install/${alias}/session/frame.png?asset_token=secret`);
  }
  await fs.writeFile(path.join(f.assets, 'user_resources', 'session', 'fallback.png'), png);
  references.push('user_resources/session/fallback.png');
  const result = await inlineAnthropicVisionImages(bodyFor(...references.map(image)), {
    env: { ...f.env, SAMSAR_PROVIDER_MEDIA_BASE_URL: 'https://media.example.test/install' },
    fetchImpl: () => assert.fail('Legacy mounted aliases must not be fetched remotely.'),
  });
  for (const block of result.messages[0].content) {
    assert.equal(block.source.type, 'base64');
    assert.equal(block.source.data, png.toString('base64'));
  }
});

test('local URLs and current managed tunnel URLs resolve mounted files without fetching', async t => {
  const f = await fixture(t);
  const config = path.join(f.directory, 'runtime.json');
  await fs.writeFile(config, JSON.stringify({ localMediaTunnel: { enabled: true, publicUrl: 'https://current-tunnel.trycloudflare.com' } }));
  const env = { ...f.env, SAMSAR_RUNTIME_CONFIG_FILE: config, SAMSAR_PROVIDER_MEDIA_BASE_URL: 'https://media.example.test/install' };
  const references = [
    'http://localhost:3002/assets_v2/generations/frame.png?asset_token=private-token',
    'http://processor:3002/assets_v2/generations/frame.png',
    'http://media-gateway/assets_v2/generations/frame.png',
    'https://current-tunnel.trycloudflare.com/assets_v2/generations/frame.png',
    'https://media.example.test/install/assets_v2/generations/frame.png',
  ];
  const result = await inlineAnthropicVisionImages(bodyFor(...references.map(image)), {
    env, fetchImpl: () => assert.fail('Mounted images must not use the tunnel.'),
  });
  for (const block of result.messages[0].content) assert.equal(block.source.type, 'base64');
});

test('unrelated remote URLs stay URL sources even when an identically named local image exists', async t => {
  const f = await fixture(t);
  const input = bodyFor(
    image('https://example.com/assets_v2/generations/frame.png?signature=remote'),
    image('https://bucket.s3.amazonaws.com/assets_v2/generations/frame.png'),
    image('https://distribution.cloudfront.net/assets_v2/generations/frame.png'),
    image('https://unrelated.trycloudflare.com/assets_v2/generations/frame.png'),
    image('http://localhost:3002/assets_v2/generations/missing.png'),
  );
  const result = await inlineAnthropicVisionImages(input, { env: f.env, fetchImpl: () => assert.fail('Remote images must remain untouched.') });
  assert.deepEqual(result, input);
});

test('production, server and S3 modes leave even local image references untouched', async t => {
  const f = await fixture(t);
  const input = bodyFor(image('/assets_v2/generations/frame.png'), image('https://bucket.s3.amazonaws.com/frame.png'));
  for (const env of [
    { ...f.env, SAMSAR_DEPLOYMENT_EDITION: 'production', CURRENT_ENV: 'production' },
    { ...f.env, SAMSAR_RUNTIME: 'server' },
    { ...f.env, SAMSAR_MEDIA_DELIVERY_MODE: 's3-cloudfront' },
    { ...f.env, SAMSAR_MEDIA_DELIVERY_MODE: 'external-s3' },
  ]) assert.equal(await inlineAnthropicVisionImages(input, { env }), input);
});

test('outside paths, traversal and symlinks cannot read outside mounted media roots', async t => {
  const f = await fixture(t);
  const outside = path.join(f.directory, 'outside.png');
  await fs.writeFile(outside, png);
  await fs.symlink(outside, path.join(f.assetsV2, 'generations', 'escape.png'));
  for (const reference of [outside, '/assets_v2/../outside.png', '/assets_v2/generations/escape.png', 'file:///tmp/outside.png']) {
    await assert.rejects(inlineAnthropicVisionImages(bodyFor(image(reference)), { env: f.env }), /allowed media root|unsupported/);
  }
});

test('size limits, empty files and unsupported image bytes fail before native dispatch', async t => {
  const f = await fixture(t);
  await assert.rejects(inlineAnthropicVisionImages(bodyFor(image(f.file)), { env: f.env, maxEncodedImageBytes: 16 }), { code: 'ANTHROPIC_VISION_IMAGE_TOO_LARGE' });
  await fs.writeFile(path.join(f.assetsV2, 'empty.png'), '');
  await fs.writeFile(path.join(f.assetsV2, 'not-image.png'), '<html>not an image</html>');
  await assert.rejects(inlineAnthropicVisionImages(bodyFor(image('/assets_v2/empty.png')), { env: f.env }), /empty/);
  await assert.rejects(inlineAnthropicVisionImages(bodyFor(image('/assets_v2/not-image.png')), { env: f.env }), /PNG, JPEG, GIF, or WebP/);
});

test('local MIME type follows supported image bytes', async t => {
  const f = await fixture(t);
  const formats = [
    ['jpeg', Buffer.from([255, 216, 255, 224]), 'image/jpeg'],
    ['gif', Buffer.from('GIF89a'), 'image/gif'],
    ['webp', Buffer.from('RIFF0000WEBP'), 'image/webp'],
  ];
  for (const [extension, bytes, mime] of formats) {
    const file = path.join(f.assetsV2, `frame.${extension}`);
    await fs.writeFile(file, bytes);
    const result = await inlineAnthropicVisionImages(bodyFor(image(file)), { env: f.env });
    assert.equal(result.messages[0].content[0].source.media_type, mime);
    assert.deepEqual(Buffer.from(result.messages[0].content[0].source.data, 'base64'), bytes);
  }
});
