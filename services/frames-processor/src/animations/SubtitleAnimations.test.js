import test from 'node:test';
import assert from 'node:assert/strict';

import { applyTextSubtitleAnimations } from './SubtitleAnimations.js';

function createTextContext() {
  const calls = {
    fillText: [],
    strokeText: [],
    fillRect: [],
  };
  const context = {
    canvas: { width: 1024, height: 1024 },
    font: '',
    fillStyle: '#FFFFFF',
    strokeStyle: '#000000',
    lineWidth: 1,
    textAlign: 'left',
    textBaseline: 'alphabetic',
    shadowColor: 'transparent',
    shadowBlur: 0,
    shadowOffsetX: 0,
    shadowOffsetY: 0,
    globalAlpha: 1,
    save() {},
    restore() {},
    measureText(text) {
      return { width: Array.from(String(text)).length * 12 };
    },
    createLinearGradient() {
      return { addColorStop() {} };
    },
    fillText(text, x, y) {
      calls.fillText.push({ text, x, y });
    },
    strokeText(text, x, y) {
      calls.strokeText.push({ text, x, y });
    },
    fillRect(x, y, width, height) {
      calls.fillRect.push({ x, y, width, height });
    },
  };

  return { context, calls };
}

test('static subtitles render full text without typewriter or word-highlight animation', () => {
  const { context, calls } = createTextContext();
  const item = {
    type: 'text',
    subType: 'subtitle',
    text: 'Translated subtitle',
    isStaticSubtitle: true,
    subtitleRenderMode: 'static',
    config: {
      fontSize: 48,
      fontFamily: 'Poppins',
      fillColor: '#FFFFFF',
      strokeColor: '#000000',
      strokeWidth: 3,
      y: 900,
      autoWrap: true,
      breakTextWidth: 824,
    },
    animations: [{ type: 'typewriter', startFrame: 0, endFrame: 240 }],
    words: [
      { word: 'Translated', frameOffset: 0, frameDuration: 20 },
      { word: 'subtitle', frameOffset: 20, frameDuration: 20 },
    ],
    wordAnimation: 'highlight',
    textAccent: 'glowing',
  };

  applyTextSubtitleAnimations(context, item, 100, 0, 24);

  assert.deepEqual(calls.fillText.map((call) => call.text), ['Translated subtitle']);
  assert.deepEqual(calls.strokeText.map((call) => call.text), ['Translated subtitle']);
  assert.deepEqual(calls.fillRect, []);
  assert.equal(item.config.autoWrap, true);
  assert.equal(item.text, 'Translated subtitle');
});
