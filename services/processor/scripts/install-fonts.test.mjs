import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const installer = fileURLToPath(new URL('../install_fonts.sh', import.meta.url));

function installWithDownload(t, scenario, operatingSystem = 'Linux') {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'subtitle-font-install-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const bin = path.join(directory, 'bin');
  const fontDirectory = path.join(directory, 'fonts');
  const cacheLog = path.join(directory, 'cache-updated');
  fs.mkdirSync(bin);

  const commands = {
    id: '#!/bin/sh\necho 0\n',
    uname: `#!/bin/sh\nprintf '%s\\n' "$FONT_TEST_OS"\n`,
    curl: `#!/bin/bash
output=''
fail_http=false
while [[ $# -gt 0 ]]; do
  case "$1" in
    -o|--output) output="$2"; shift ;;
    --fail|-f) fail_http=true ;;
  esac
  shift
done
printf 'downloaded response' > "$output"
if [[ "$FONT_TEST_SCENARIO" == http_error && "$fail_http" == true ]]; then
  exit 22
fi
`,
    'fc-scan': `#!/bin/sh
if [ "$FONT_TEST_SCENARIO" != invalid_font ]; then
  printf 'Noto Sans JP'
fi
`,
    'fc-cache': '#!/bin/sh\ntouch "$FONT_TEST_CACHE_LOG"\n',
  };
  for (const [name, contents] of Object.entries(commands)) {
    fs.writeFileSync(path.join(bin, name), contents, { mode: 0o755 });
  }

  const result = spawnSync('/bin/bash', [installer], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${bin}${path.delimiter}${process.env.PATH}`,
      SUBTITLE_FONT_DIR: fontDirectory,
      FONT_TEST_SCENARIO: scenario,
      FONT_TEST_OS: operatingSystem,
      FONT_TEST_CACHE_LOG: cacheLog,
    },
  });
  const temporaryDirectory = result.stdout.match(/Using temporary directory: (.+)/)?.[1];
  assert.ok(temporaryDirectory, result.stderr);
  assert.equal(fs.existsSync(temporaryDirectory), false, 'temporary downloads must be cleaned up');
  return {
    result,
    installedFiles: fs.existsSync(fontDirectory) ? fs.readdirSync(fontDirectory) : [],
    cacheUpdated: fs.existsSync(cacheLog),
  };
}

test('an HTTP download failure stops font installation before an error body is installed', (t) => {
  const { result, installedFiles } = installWithDownload(t, 'http_error');
  assert.notEqual(result.status, 0);
  assert.deepEqual(installedFiles, []);
});

test('a successful HTTP response containing an unreadable font fails the build', (t) => {
  const { result, installedFiles } = installWithDownload(t, 'invalid_font');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /not a readable font/);
  assert.deepEqual(installedFiles, []);
});

test('validated downloads use stable filenames recognized by the renderer', (t) => {
  const { result, installedFiles, cacheUpdated } = installWithDownload(t, 'success');
  assert.equal(result.status, 0, result.stderr);
  assert.ok(installedFiles.includes('NotoSansJP.ttf'));
  assert.ok(installedFiles.includes('MPLUSRounded1c.ttf'));
  assert.ok(installedFiles.includes('Sarabun.ttf'));
  assert.equal(cacheUpdated, true);
});

test('macOS installs validated fonts without requiring a Linux font cache update', (t) => {
  const { result, installedFiles, cacheUpdated } = installWithDownload(t, 'success', 'Darwin');
  assert.equal(result.status, 0, result.stderr);
  assert.ok(installedFiles.includes('NotoSansJP.ttf'));
  assert.equal(cacheUpdated, false);
});
