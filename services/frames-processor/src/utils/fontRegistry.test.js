import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { ensureFontsRegistered } from './fontRegistry.js';

function fontFixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'subtitle-font-registry-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const warnings = [];
  const registrations = [];
  const logger = { info() {}, warn(message) { warnings.push(message); } };
  const writeFont = (relativePath, contents = 'valid test font') => {
    const filename = path.join(root, relativePath);
    fs.mkdirSync(path.dirname(filename), { recursive: true });
    fs.writeFileSync(filename, contents);
    return filename;
  };
  const registerFont = (filename, options) => {
    registrations.push({ filename, family: options.family });
    if (fs.readFileSync(filename, 'utf8').startsWith('<html>')) {
      throw new Error('Could not parse font file');
    }
  };
  return { root, warnings, registrations, logger, writeFont, registerFont };
}

test('an invalid legacy download does not hide a valid alternative font filename', (t) => {
  const fixture = fontFixture(t);
  const invalid = fixture.writeFont('fonts/NotoSansJP.ttf', '<html>download failed</html>');
  const valid = fixture.writeFont('fonts/NotoSansJP[wght].ttf');
  ensureFontsRegistered({ ...fixture, fontDirs: [path.join(fixture.root, 'fonts')] });

  assert.deepEqual(fixture.registrations.filter(({ family }) => family === 'Noto Sans JP'), [
    { filename: invalid, family: 'Noto Sans JP' },
    { filename: valid, family: 'Noto Sans JP' },
  ]);
  assert.ok(fixture.warnings.some((warning) => warning.includes(invalid)));
  assert.ok(!fixture.warnings.some((warning) => warning.includes('Font file not found for Noto Sans JP')));
});

test('font registration continues into later directories after an invalid preferred font', (t) => {
  const fixture = fontFixture(t);
  fixture.writeFont('local/NotoSansJP.ttf', '<html>download failed</html>');
  const valid = fixture.writeFont('system/NotoSansJP-Regular.ttf');
  ensureFontsRegistered({
    ...fixture,
    fontDirs: [path.join(fixture.root, 'local'), path.join(fixture.root, 'system')],
  });

  assert.equal(fixture.registrations.filter(({ family }) => family === 'Noto Sans JP').at(-1).filename, valid);
});

test('legacy Sarabun and distro static Noto filenames register under the requested families', (t) => {
  const fixture = fontFixture(t);
  const sarabun = fixture.writeFont('fonts/Sarabun-Regular.ttf');
  const bengali = fixture.writeFont('fonts/NotoSansBengali-Regular.ttf');
  ensureFontsRegistered({ ...fixture, fontDirs: [path.join(fixture.root, 'fonts')] });

  assert.ok(fixture.registrations.some(({ filename, family }) => filename === sarabun && family === 'Sarabun'));
  assert.ok(fixture.registrations.some(({ filename, family }) => filename === bengali && family === 'Noto Sans Bengali'));
});

test('a successfully registered font prevents duplicate registration from other copies', (t) => {
  const fixture = fontFixture(t);
  const preferred = fixture.writeFont('fonts/Sarabun.ttf');
  fixture.writeFont('fonts/Sarabun-Regular.ttf');
  ensureFontsRegistered({ ...fixture, fontDirs: [path.join(fixture.root, 'fonts')] });

  assert.deepEqual(fixture.registrations.filter(({ family }) => family === 'Sarabun'), [
    { filename: preferred, family: 'Sarabun' },
  ]);
});
