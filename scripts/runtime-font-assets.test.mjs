import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('./setup-docker-runtime-assets.sh', import.meta.url));
const validFont = Buffer.from([0, 1, 0, 0, 0, 1, 0, 0]);
const fontNames = [...fs.readFileSync(script, 'utf8').matchAll(/"[^|\n]+\|([^|\n]+\.ttf)\|https:\/\//g)]
  .map((match) => match[1]);

function fixture(t, scenario, cached = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'samsar-runtime-fonts-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const bin = path.join(directory, 'bin');
  const fonts = path.join(directory, 'fonts');
  const log = path.join(directory, 'downloads');
  fs.mkdirSync(bin);
  fs.mkdirSync(fonts);
  for (const [filename, data] of Object.entries(cached)) fs.writeFileSync(path.join(fonts, filename), data);
  const commands = {
    curl: `#!/bin/bash
set -eu
output=''
for argument in "$@"; do printf '%s ' "$argument" >> "$FONT_DOWNLOAD_LOG"; done
printf '\\n' >> "$FONT_DOWNLOAD_LOG"
while [[ $# -gt 0 ]]; do
  if [[ "$1" == -o ]]; then output="$2"; shift; fi
  shift
done
if [[ "$FONT_TEST_SCENARIO" == http_error ]]; then exit 22; fi
if [[ "$FONT_TEST_SCENARIO" == html_response ]]; then
  printf '<html>download failed</html>' > "$output"
else
  printf '\\000\\001\\000\\000\\000\\001\\000\\000' > "$output"
fi
`,
    'fc-scan': `#!/bin/sh
if [ "$FONT_TEST_SCENARIO" = corrupt_font ]; then exit 1; fi
printf 'Validated font'
`,
  };
  for (const [filename, contents] of Object.entries(commands)) {
    fs.writeFileSync(path.join(bin, filename), contents, { mode: 0o755 });
  }
  return {
    fonts, log,
    run: () => spawnSync('/bin/bash', [script, '--fonts-only', '--no-container-copy'], {
      encoding: 'utf8',
      env: { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}`,
        SAMSAR_DOCKER_FONT_DIR: fonts, FONT_DOWNLOAD_LOG: log, FONT_TEST_SCENARIO: scenario },
    }),
  };
}

test('runtime font setup rejects an HTTP 200 HTML response without installing it', (t) => {
  const f = fixture(t, 'html_response');
  const result = f.run();
  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /not a readable font/);
  assert.deepEqual(fs.readdirSync(f.fonts), []);
});

test('runtime font setup rejects a font that fontconfig cannot parse', (t) => {
  const f = fixture(t, 'corrupt_font');
  const result = f.run();
  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /not a readable font/);
  assert.deepEqual(fs.readdirSync(f.fonts), []);
});

test('runtime font setup replaces a corrupt cached font and retains all configured families', (t) => {
  const f = fixture(t, 'valid', { 'Montserrat.ttf': '<html>cached error</html>' });
  const result = f.run();
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(fs.readFileSync(path.join(f.fonts, 'Montserrat.ttf')), validFont);
  assert.deepEqual(fs.readdirSync(f.fonts).sort(), [...fontNames].sort());
  assert.match(fs.readFileSync(f.log, 'utf8'), /Montserrat/);
});

test('runtime font setup reuses validated cached fonts without downloading', (t) => {
  const f = fixture(t, 'valid', Object.fromEntries(fontNames.map((name) => [name, validFont])));
  const result = f.run();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.existsSync(f.log), false);
});

test('a failed runtime font download preserves an existing font', (t) => {
  const f = fixture(t, 'http_error', { 'Montserrat.ttf': validFont });
  const result = f.run();
  assert.notEqual(result.status, 0);
  assert.deepEqual(fs.readFileSync(path.join(f.fonts, 'Montserrat.ttf')), validFont);
  assert.deepEqual(fs.readdirSync(f.fonts), ['Montserrat.ttf']);
});
