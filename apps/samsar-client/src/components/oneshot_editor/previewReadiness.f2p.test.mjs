import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
const source = fs.readFileSync(new URL('./ProgressIndicator.jsx', import.meta.url), 'utf8');
const implementation = source.slice(source.indexOf('function preloadPreviewImage('), source.indexOf('\nfunction preloadPreviewVideo('));
for (const failure of ['error', 'timeout']) {
  test(`F2P: VidGenie image ${failure} never marks the visual ready`, async () => {
    const ready = [];
    let timer;
    let img;
    let sourceCleared = false;
    const context = vm.createContext({ Promise, PREVIEW_MEDIA_PRELOAD_TIMEOUT_MS: 100,
      markPreviewVisualReady: key => ready.push(key),
      window: { setTimeout: fn => { timer = fn; return 1; }, clearTimeout() {} },
      Image: class { constructor() { img = this; } complete = false; set src(_value) {}
        removeAttribute(name) { assert.equal(name, 'src'); sourceCleared = true; } },
    });
    const preload = vm.runInContext(`${implementation};preloadPreviewImage`, context);
    const promise = preload('/missing.png', 'missing');
    if (failure === 'error') img.onerror(); else timer();
    await promise;
    assert.deepEqual(ready, []);
    assert.equal(sourceCleared, true);
  });
}
