import assert from 'node:assert/strict';
import test from 'node:test';
import { createCanvas } from 'canvas';
import { applyTextAnimations } from './TextAnimations.js';

test('generated outro renders exactly the planned lines around the saved center', () => {
  const ctx = createCanvas(1792, 1024).getContext('2d');
  const drawn = [];
  ctx.fillText = (...args) => drawn.push(args);
  const lines = ['A wide generated CTA headline that exceeds the legacy wrap width', 'Visit samsar.one'];
  applyTextAnimations(ctx, {
    text: lines.join('\n'), animations: [],
    config: { x: 896, y: 150, fontSize: 50, lineHeight: 1.1, width: 1469, autoWrap: true, preserveLineBreaks: true },
  }, 0, 30);
  assert.deepEqual(drawn.map(([text]) => text), lines);
  assert.ok(drawn.every(([, x]) => x === 896));
  assert.equal((drawn[0][2] + drawn[1][2]) / 2, 150);
});

test('ordinary text retains automatic wrapping', () => {
  const ctx = createCanvas(1792, 1024).getContext('2d');
  const drawn = [];
  ctx.fillText = (...args) => drawn.push(args);
  applyTextAnimations(ctx, {
    text: 'This ordinary editable text should continue to wrap when automatic wrapping is enabled',
    animations: [], config: { x: 896, y: 150, fontSize: 50, autoWrap: true },
  }, 0, 30);
  assert.ok(drawn.length > 1);
});
