import test from 'node:test';
import assert from 'node:assert/strict';

import { wrapText } from './TextUtils.js';

const context = {
  measureText(text) {
    return { width: Array.from(String(text)).length * 10 };
  },
};

test('default wrapping keeps legacy single-token behavior', () => {
  assert.deepEqual(wrapText(context, '字幕语言测试文本', 30), ['字幕语言测试文本']);
});

test('static subtitle wrapping splits long unspaced text without losing content', () => {
  const text = '字幕语言测试文本';
  const lines = wrapText(context, text, 30, { breakLongWords: true });

  assert.ok(lines.length > 1);
  assert.equal(lines.join(''), text);
  assert.ok(lines.every((line) => context.measureText(line).width <= 30));
});
