import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { resolveLocalAssetPath } from './LocalAssetPath.js';

function isolateAssetEnvironment(t) {
  const previousEnvironment = process.env.CURRENT_ENV;
  const previousAssetsRoot = process.env.SAMSAR_ASSETS_ROOT;
  const previousAssetsV2Root = process.env.SAMSAR_ASSETS_V2_ROOT;
  t.after(() => {
    for (const [key, value] of [
      ['CURRENT_ENV', previousEnvironment],
      ['SAMSAR_ASSETS_ROOT', previousAssetsRoot],
      ['SAMSAR_ASSETS_V2_ROOT', previousAssetsV2Root],
    ]) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });
  delete process.env.SAMSAR_ASSETS_ROOT;
  delete process.env.SAMSAR_ASSETS_V2_ROOT;
}

test('assets_v2 references resolve against the processor assets_v2 root', (t) => {
  isolateAssetEnvironment(t);
  process.env.CURRENT_ENV = 'production';

  const resolved = resolveLocalAssetPath('assets_v2/video/audio/session/speech.mp3');
  const expected = path.join(
    process.cwd(),
    '../',
    'samsar_processor',
    'assets_v2',
    'video/audio/session/speech.mp3',
  );

  assert.equal(resolved, expected);
  assert.equal(resolved.includes('/assets/assets_v2/'), false);
});

test('legacy assets references retain the legacy processor root', (t) => {
  isolateAssetEnvironment(t);
  process.env.CURRENT_ENV = 'production';

  assert.equal(
    resolveLocalAssetPath('assets/video/audio/session/speech.mp3'),
    path.join(
      process.cwd(),
      '../',
      'samsar_processor',
      'assets',
      'video/audio/session/speech.mp3',
    ),
  );
});

test('Docker references resolve to their matching mounted asset volume', (t) => {
  isolateAssetEnvironment(t);
  process.env.CURRENT_ENV = 'docker';

  assert.equal(
    resolveLocalAssetPath('assets_v2/video/audio/session/speech.mp3'),
    '/assets_v2/video/audio/session/speech.mp3',
  );
  assert.equal(
    resolveLocalAssetPath('assets/video/audio/session/speech.mp3'),
    '/assets/video/audio/session/speech.mp3',
  );
});

test('asset traversal and untrusted absolute paths are rejected', (t) => {
  isolateAssetEnvironment(t);
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'samsar-local-assets-'));
  const assetsRoot = path.join(tempRoot, 'assets');
  const assetsV2Root = path.join(tempRoot, 'assets_v2');
  const outsideFile = path.join(tempRoot, 'outside.mp3');
  fs.mkdirSync(assetsRoot, { recursive: true });
  fs.mkdirSync(assetsV2Root, { recursive: true });
  fs.writeFileSync(outsideFile, 'not audio');
  process.env.SAMSAR_ASSETS_ROOT = assetsRoot;
  process.env.SAMSAR_ASSETS_V2_ROOT = assetsV2Root;
  t.after(() => fs.rmSync(tempRoot, { recursive: true, force: true }));

  assert.equal(resolveLocalAssetPath('assets_v2/../../outside.mp3'), null);
  assert.equal(resolveLocalAssetPath('assets/../../outside.mp3'), null);
  assert.equal(resolveLocalAssetPath('../../outside.mp3'), null);
  assert.equal(resolveLocalAssetPath(outsideFile), null);

  const trustedFile = path.join(assetsV2Root, 'session', 'speech.mp3');
  fs.mkdirSync(path.dirname(trustedFile), { recursive: true });
  fs.writeFileSync(trustedFile, 'not audio');
  assert.equal(resolveLocalAssetPath(trustedFile), trustedFile);
});

test('existing symlinks cannot redirect an asset reference outside its trusted root', (t) => {
  isolateAssetEnvironment(t);
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'samsar-local-assets-link-'));
  const assetsRoot = path.join(tempRoot, 'assets');
  const assetsV2Root = path.join(tempRoot, 'assets_v2');
  const outsideRoot = path.join(tempRoot, 'outside');
  fs.mkdirSync(assetsRoot, { recursive: true });
  fs.mkdirSync(assetsV2Root, { recursive: true });
  fs.mkdirSync(outsideRoot, { recursive: true });
  fs.writeFileSync(path.join(outsideRoot, 'speech.mp3'), 'not audio');
  fs.symlinkSync(outsideRoot, path.join(assetsV2Root, 'redirect'));
  process.env.SAMSAR_ASSETS_ROOT = assetsRoot;
  process.env.SAMSAR_ASSETS_V2_ROOT = assetsV2Root;
  t.after(() => fs.rmSync(tempRoot, { recursive: true, force: true }));

  assert.equal(resolveLocalAssetPath('assets_v2/redirect/speech.mp3'), null);
  assert.equal(resolveLocalAssetPath('assets_v2/redirect/missing.mp3'), null);
});
