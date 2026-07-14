import test from 'node:test';
import assert from 'node:assert/strict';

import { applyTextSubtitleAnimations } from './SubtitleAnimations.js';

function createTextContext() {
  const calls = {
    fillText: [],
    strokeText: [],
    fillRect: [],
  };
  const stateStack = [];
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
    save() {
      stateStack.push({
        font: this.font,
        fillStyle: this.fillStyle,
        strokeStyle: this.strokeStyle,
        lineWidth: this.lineWidth,
        textAlign: this.textAlign,
        globalAlpha: this.globalAlpha,
      });
    },
    restore() {
      Object.assign(this, stateStack.pop() || {});
    },
    measureText(text) {
      return { width: Array.from(String(text)).length * 12 };
    },
    createLinearGradient() {
      return { addColorStop() {} };
    },
    fillText(text, x, y) {
      calls.fillText.push({
        text,
        x,
        y,
        font: this.font,
        fillStyle: this.fillStyle,
        globalAlpha: this.globalAlpha,
      });
    },
    strokeText(text, x, y) {
      calls.strokeText.push({
        text,
        x,
        y,
        font: this.font,
        strokeStyle: this.strokeStyle,
        globalAlpha: this.globalAlpha,
      });
    },
    fillRect(x, y, width, height) {
      calls.fillRect.push({
        x,
        y,
        width,
        height,
        fillStyle: this.fillStyle,
        globalAlpha: this.globalAlpha,
      });
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

test('mapped translated subtitles render one calm cue without word-highlight restarts', () => {
  const { context, calls } = createTextContext();
  const item = {
    type: 'text',
    subType: 'subtitle',
    text: 'BONJOUR LE MONDE',
    subtitleRenderMode: 'mapped',
    subtitleAlignmentMapped: true,
    isStaticSubtitle: false,
    config: {
      fontSize: 48,
      fontFamily: 'Poppins',
      fillColor: '#FFFFFF',
      strokeColor: '#000000',
      strokeWidth: 3,
      y: 900,
      autoWrap: false,
      breakLongWords: true,
      breakTextWidth: 110,
      frameOffset: 0,
      frameDuration: 24,
    },
    animations: [{ type: 'typewriter', startFrame: 0, endFrame: 240 }],
    words: [
      { word: 'BONJOUR', frameOffset: 0, frameDuration: 12, joinerBefore: '' },
      { word: 'LE MONDE', frameOffset: 12, frameDuration: 12, joinerBefore: ' ' },
    ],
    wordAnimation: 'highlight',
  };

  applyTextSubtitleAnimations(context, item, 600, 0, 24);

  assert.deepEqual(calls.fillText.map((call) => call.text), ['BONJOUR', 'LE MONDE']);
  assert.deepEqual(calls.strokeText.map((call) => call.text), ['BONJOUR', 'LE MONDE']);
  assert.equal(calls.fillRect.length, 0);
  assert.notEqual(calls.fillText[0].y, calls.fillText[1].y);
  assert.equal(item.config.autoWrap, true);
  assert.equal(item.text, 'BONJOUR LE MONDE');
});

test('mapped no-space subtitle phrases render without synthetic gaps', () => {
  const { context, calls } = createTextContext();
  const item = {
    type: 'text',
    subType: 'subtitle',
    text: 'สวัสดีโลก',
    subtitleRenderMode: 'mapped',
    subtitleTimingMapped: true,
    config: {
      fontSize: 48,
      fontFamily: 'Sarabun',
      fillColor: '#FFFFFF',
      y: 900,
      autoWrap: true,
      breakTextWidth: 800,
      frameOffset: 0,
      frameDuration: 24,
    },
    words: [
      { word: 'สวัสดี', frameOffset: 0, frameDuration: 12, joinerBefore: '' },
      { word: 'โลก', frameOffset: 12, frameDuration: 12, joinerBefore: '' },
    ],
    wordAnimation: 'highlight',
  };

  applyTextSubtitleAnimations(context, item, 100, 0, 24);

  const first = calls.fillText[0];
  const second = calls.fillText[1];
  assert.equal(second.x - first.x, 72);
});

test('overlapping word timings select exactly one latest-started highlight', () => {
  const { context, calls } = createTextContext();
  const item = {
    type: 'text',
    subType: 'subtitle',
    text: 'ONE LONGER',
    config: {
      fontSize: 48,
      fontFamily: 'Poppins',
      fillColor: '#FFFFFF',
      strokeColor: '#000000',
      strokeWidth: 2,
      frameOffset: 0,
      frameDuration: 24,
    },
    words: [
      { word: 'ONE', frameOffset: 0, frameDuration: 12 },
      { word: 'LONGER', frameOffset: 6, frameDuration: 12 },
    ],
    wordAnimation: 'highlight',
  };

  applyTextSubtitleAnimations(context, item, (8 / 24) * 1000, 0, 24);

  assert.equal(calls.fillRect.length, 1);
  assert.equal(calls.fillRect[0].width, 72);
});

test('highlight opacity eases in at a timed word edge', () => {
  const createItem = () => ({
    type: 'text',
    subType: 'subtitle',
    text: 'HELLO',
    config: {
      fontSize: 48,
      fontFamily: 'Poppins',
      frameOffset: 0,
      frameDuration: 8,
    },
    words: [{ word: 'HELLO', frameOffset: 0, frameDuration: 8 }],
    wordAnimation: 'highlight',
  });
  const edgeRender = createTextContext();
  const middleRender = createTextContext();

  applyTextSubtitleAnimations(edgeRender.context, createItem(), 0, 0, 24);
  applyTextSubtitleAnimations(middleRender.context, createItem(), (3 / 24) * 1000, 0, 24);

  const getAlpha = (fillStyle) => Number(fillStyle.match(/([\d.]+)\)$/)?.[1]);
  const edgeAlpha = getAlpha(edgeRender.calls.fillRect[0].fillStyle);
  const middleAlpha = getAlpha(middleRender.calls.fillRect[0].fillStyle);
  assert.ok(edgeAlpha > 0);
  assert.ok(edgeAlpha < middleAlpha);
  assert.equal(middleAlpha, 0.22);
});

test('long mapped phrases advance through unique two-line cue pages', () => {
  const createItem = () => ({
    type: 'text',
    subType: 'subtitle',
    text: 'ABCDEFGHIJKL',
    subtitleRenderMode: 'mapped',
    subtitleAlignmentMapped: true,
    config: {
      fontSize: 48,
      fontFamily: 'Poppins',
      fillColor: '#FFFFFF',
      breakLongWords: true,
      breakTextWidth: 48,
      frameOffset: 0,
      frameDuration: 12,
    },
    animations: [],
    words: [{ word: 'ABCDEFGHIJKL', frameOffset: 0, frameDuration: 12 }],
    wordAnimation: 'highlight',
  });
  const firstChunkRender = createTextContext();
  const secondChunkRender = createTextContext();
  const endOfFirstPage = createTextContext();
  const startOfSecondPage = createTextContext();
  const nextPageRender = createTextContext();

  applyTextSubtitleAnimations(firstChunkRender.context, createItem(), (1 / 24) * 1000, 0, 24);
  applyTextSubtitleAnimations(secondChunkRender.context, createItem(), (5 / 24) * 1000, 0, 24);
  applyTextSubtitleAnimations(endOfFirstPage.context, createItem(), (7 / 24) * 1000, 0, 24);
  applyTextSubtitleAnimations(startOfSecondPage.context, createItem(), (8 / 24) * 1000, 0, 24);
  applyTextSubtitleAnimations(nextPageRender.context, createItem(), (9 / 24) * 1000, 0, 24);

  assert.deepEqual(
    firstChunkRender.calls.fillText.map((call) => call.text),
    ['ABCD', 'EFGH'],
  );
  assert.deepEqual(
    secondChunkRender.calls.fillText.map((call) => call.text),
    ['ABCD', 'EFGH'],
  );
  assert.deepEqual(
    nextPageRender.calls.fillText.map((call) => call.text),
    ['IJKL'],
  );
  assert.deepEqual(
    endOfFirstPage.calls.fillText.map((call) => call.text),
    ['ABCD', 'EFGH'],
  );
  assert.deepEqual(
    startOfSecondPage.calls.fillText.map((call) => call.text),
    ['IJKL'],
  );
  assert.equal(
    endOfFirstPage.calls.fillText[0].globalAlpha,
    startOfSecondPage.calls.fillText[0].globalAlpha,
  );
  assert.equal(endOfFirstPage.calls.fillText[0].globalAlpha, 0.5);
  assert.equal(firstChunkRender.calls.fillRect.length, 0);
  assert.equal(secondChunkRender.calls.fillRect.length, 0);
  assert.equal(nextPageRender.calls.fillRect.length, 0);
});

test('one translated mapping phrase has one animation epoch across its layout tokens', () => {
  const createItem = () => ({
    type: 'text',
    subType: 'subtitle',
    text: 'I LOVE THE WORLD',
    subtitleRenderMode: 'mapped',
    subtitleAlignmentMapped: true,
    config: {
      fontSize: 48,
      fontFamily: 'Poppins',
      fillColor: '#FFFFFF',
      frameOffset: 0,
      frameDuration: 16,
      autoWrap: true,
      breakTextWidth: 800,
    },
    words: [
      { word: 'I', frameOffset: 0, frameDuration: 3, mappingIndex: 0, translatedPhraseTokenIndex: 0 },
      { word: 'LOVE', frameOffset: 3, frameDuration: 4, mappingIndex: 0, translatedPhraseTokenIndex: 1 },
      { word: 'THE', frameOffset: 7, frameDuration: 3, mappingIndex: 0, translatedPhraseTokenIndex: 2 },
      { word: 'WORLD', frameOffset: 10, frameDuration: 6, mappingIndex: 0, translatedPhraseTokenIndex: 3 },
    ],
    wordAnimation: 'system_preset',
    textAccent: 'glowing',
  });
  const beforeTokenBoundary = createTextContext();
  const afterTokenBoundary = createTextContext();

  applyTextSubtitleAnimations(beforeTokenBoundary.context, createItem(), (6 / 24) * 1000, 0, 24);
  applyTextSubtitleAnimations(afterTokenBoundary.context, createItem(), (7 / 24) * 1000, 0, 24);

  assert.deepEqual(
    beforeTokenBoundary.calls.fillText.map((call) => call.text),
    ['I', 'LOVE', 'THE', 'WORLD'],
  );
  assert.deepEqual(
    afterTokenBoundary.calls.fillText.map((call) => call.text),
    ['I', 'LOVE', 'THE', 'WORLD'],
  );
  assert.equal(beforeTokenBoundary.calls.fillRect.length, 0);
  assert.equal(afterTokenBoundary.calls.fillRect.length, 0);
  assert.equal(beforeTokenBoundary.calls.fillText[0].globalAlpha, 1);
  assert.equal(afterTokenBoundary.calls.fillText[0].globalAlpha, 1);
});

test('duplicate translated layout tokens are painted only once', () => {
  const { context, calls } = createTextContext();
  const duplicateWord = {
    word: 'BONJOUR',
    frameOffset: 0,
    frameDuration: 12,
    mappingIndex: 0,
    translatedPhraseTokenIndex: 0,
  };
  const item = {
    type: 'text',
    subType: 'subtitle',
    text: 'BONJOUR',
    subtitleRenderMode: 'mapped',
    subtitleAlignmentMapped: true,
    config: {
      fontSize: 48,
      fontFamily: 'Poppins',
      frameOffset: 0,
      frameDuration: 12,
      autoWrap: true,
      breakTextWidth: 800,
    },
    words: [duplicateWord, { ...duplicateWord }],
    wordAnimation: 'highlight',
  };

  applyTextSubtitleAnimations(context, item, (5 / 24) * 1000, 0, 24);

  assert.deepEqual(calls.fillText.map((call) => call.text), ['BONJOUR']);
  assert.deepEqual(calls.strokeText.map((call) => call.text), []);
  assert.equal(calls.fillRect.length, 0);
});

test('translated phrases separated by a meaningful timing gap never reveal future text early', () => {
  const createItem = () => ({
    type: 'text',
    subType: 'subtitle',
    text: 'FIRST SECOND',
    subtitleRenderMode: 'translated_cue',
    subtitleAlignmentMapped: true,
    subtitleTimingBase: 'session',
    config: {
      fontSize: 48,
      fontFamily: 'Poppins',
      frameOffset: 0,
      frameDuration: 24,
      autoWrap: true,
      breakTextWidth: 800,
    },
    words: [
      { word: 'FIRST', frameOffset: 0, frameDuration: 4, mappingIndex: 0 },
      { word: 'SECOND', frameOffset: 20, frameDuration: 4, mappingIndex: 1 },
    ],
  });
  const firstCue = createTextContext();
  const silence = createTextContext();
  const secondCue = createTextContext();

  applyTextSubtitleAnimations(firstCue.context, createItem(), (1 / 24) * 1000, 0, 24);
  applyTextSubtitleAnimations(silence.context, createItem(), (12 / 24) * 1000, 0, 24);
  applyTextSubtitleAnimations(secondCue.context, createItem(), (21 / 24) * 1000, 0, 24);

  assert.deepEqual(firstCue.calls.fillText.map((call) => call.text), ['FIRST']);
  assert.deepEqual(silence.calls.fillText, []);
  assert.deepEqual(secondCue.calls.fillText.map((call) => call.text), ['SECOND']);
});

test('contiguous translated phrases never retain expired text across scene layers', () => {
  const createClone = () => ({
    type: 'text',
    subType: 'subtitle',
    text: 'FIRST SECOND THIRD',
    subtitleRenderMode: 'translated_cue',
    subtitleAlignmentMapped: true,
    subtitleTimingBase: 'session',
    config: {
      fontSize: 48,
      fontFamily: 'Poppins',
      frameOffset: 0,
      frameDuration: 24,
      autoWrap: true,
      breakTextWidth: 800,
    },
    words: [
      { word: 'FIRST', frameOffset: 0, frameDuration: 24, mappingIndex: 0 },
      { word: 'SECOND', frameOffset: 24, frameDuration: 24, mappingIndex: 1 },
      { word: 'THIRD', frameOffset: 48, frameDuration: 24, mappingIndex: 2 },
    ],
  });
  const firstLayer = createTextContext();
  const endOfFirstLayer = createTextContext();
  const startOfSecondLayer = createTextContext();
  const secondLayer = createTextContext();
  const thirdLayer = createTextContext();

  applyTextSubtitleAnimations(
    firstLayer.context,
    createClone(),
    (6 / 24) * 1000,
    0,
    24,
  );
  applyTextSubtitleAnimations(
    endOfFirstLayer.context,
    createClone(),
    (23 / 24) * 1000,
    0,
    24,
  );
  applyTextSubtitleAnimations(
    startOfSecondLayer.context,
    createClone(),
    (24 / 24) * 1000,
    1,
    24,
  );
  applyTextSubtitleAnimations(
    secondLayer.context,
    createClone(),
    (30 / 24) * 1000,
    1,
    24,
  );
  applyTextSubtitleAnimations(
    thirdLayer.context,
    createClone(),
    (54 / 24) * 1000,
    2,
    24,
  );

  assert.deepEqual(firstLayer.calls.fillText.map((call) => call.text), ['FIRST']);
  assert.deepEqual(endOfFirstLayer.calls.fillText.map((call) => call.text), ['FIRST']);
  assert.deepEqual(startOfSecondLayer.calls.fillText.map((call) => call.text), ['SECOND']);
  assert.deepEqual(secondLayer.calls.fillText.map((call) => call.text), ['SECOND']);
  assert.deepEqual(thirdLayer.calls.fillText.map((call) => call.text), ['THIRD']);
  assert.equal(
    endOfFirstLayer.calls.fillText[0].globalAlpha,
    startOfSecondLayer.calls.fillText[0].globalAlpha,
  );
});

test('translated cue identity separates segment-local mapping indexes in the renderer', () => {
  const { context, calls } = createTextContext();
  const item = {
    type: 'text',
    subType: 'subtitle',
    text: 'FIRST SECOND',
    subtitleRenderMode: 'translated_cue',
    subtitleAlignmentMapped: true,
    subtitleTimingBase: 'session',
    config: {
      fontSize: 48,
      fontFamily: 'Poppins',
      frameOffset: 0,
      frameDuration: 24,
      autoWrap: true,
      breakTextWidth: 800,
    },
    words: [
      {
        word: 'FIRST',
        frameOffset: 0,
        frameDuration: 4,
        mappingIndex: 0,
        translatedCueIdentity: 'mapping:0:first:occurrence:0',
      },
      {
        word: 'SECOND',
        frameOffset: 20,
        frameDuration: 4,
        mappingIndex: 0,
        translatedCueIdentity: 'mapping:0:second:occurrence:0',
      },
    ],
  };

  applyTextSubtitleAnimations(context, item, (1 / 24) * 1000, 0, 24);

  assert.deepEqual(calls.fillText.map((call) => call.text), ['FIRST']);
});

test('one translated cue keeps a continuous animation epoch across scene-layer clones', () => {
  const createClone = () => ({
    type: 'text',
    subType: 'subtitle',
    text: 'CONTINUOUS',
    subtitleRenderMode: 'translated_cue',
    subtitleAlignmentMapped: true,
    subtitleTimingBase: 'session',
    config: {
      fontSize: 48,
      fontFamily: 'Poppins',
      frameOffset: 0,
      frameDuration: 12,
      autoWrap: true,
      breakTextWidth: 800,
    },
    words: [{ word: 'CONTINUOUS', frameOffset: 0, frameDuration: 24, mappingIndex: 0 }],
  });
  const endOfFirstLayer = createTextContext();
  const startOfSecondLayer = createTextContext();

  applyTextSubtitleAnimations(
    endOfFirstLayer.context,
    createClone(),
    (11 / 24) * 1000,
    0,
    24,
  );
  applyTextSubtitleAnimations(
    startOfSecondLayer.context,
    createClone(),
    (12 / 24) * 1000,
    0.5,
    24,
  );

  assert.equal(endOfFirstLayer.calls.fillText[0].globalAlpha, 1);
  assert.equal(startOfSecondLayer.calls.fillText[0].globalAlpha, 1);
});

test('same-language session-timed subtitles keep highlight and opacity across scene layers', () => {
  const createClone = (frameOffset) => ({
    type: 'text',
    subType: 'subtitle',
    text: 'CONTINUOUS',
    subtitleTimingBase: 'session',
    subtitleCueStartFrameSession: 5,
    subtitleCueEndFrameSession: 15,
    config: {
      fontSize: 48,
      fontFamily: 'Poppins',
      frameOffset,
      frameDuration: 5,
    },
    words: [{ word: 'CONTINUOUS', frameOffset: 5, frameDuration: 10 }],
    wordAnimation: 'highlight',
  });
  const endOfFirstLayer = createTextContext();
  const startOfSecondLayer = createTextContext();

  applyTextSubtitleAnimations(
    endOfFirstLayer.context,
    createClone(5),
    (9 / 24) * 1000,
    0,
    24,
  );
  applyTextSubtitleAnimations(
    startOfSecondLayer.context,
    createClone(0),
    (10 / 24) * 1000,
    10 / 24,
    24,
  );

  assert.equal(endOfFirstLayer.calls.fillText[0].globalAlpha, 1);
  assert.equal(startOfSecondLayer.calls.fillText[0].globalAlpha, 1);
  assert.equal(endOfFirstLayer.calls.fillRect.length, 1);
  assert.equal(startOfSecondLayer.calls.fillRect.length, 1);
});

test('static translated clones do not replay their edge fade at a scene boundary', () => {
  const createClone = () => ({
    type: 'text',
    subType: 'subtitle',
    text: 'CONTINUOUS STATIC CAPTION',
    subtitleRenderMode: 'static',
    isStaticSubtitle: true,
    subtitleCueStartFrameSession: 0,
    subtitleCueEndFrameSession: 24,
    config: {
      fontSize: 48,
      fontFamily: 'Poppins',
      frameOffset: 0,
      frameDuration: 12,
      autoWrap: true,
      breakTextWidth: 800,
    },
    words: [],
  });
  const endOfFirstLayer = createTextContext();
  const startOfSecondLayer = createTextContext();

  applyTextSubtitleAnimations(
    endOfFirstLayer.context,
    createClone(),
    (11 / 24) * 1000,
    0,
    24,
  );
  applyTextSubtitleAnimations(
    startOfSecondLayer.context,
    createClone(),
    (12 / 24) * 1000,
    0.5,
    24,
  );

  assert.equal(endOfFirstLayer.calls.fillText[0].globalAlpha, 1);
  assert.equal(startOfSecondLayer.calls.fillText[0].globalAlpha, 1);
});

test('touching legacy animations render once and use eased progress', () => {
  const { context, calls } = createTextContext();
  const item = {
    type: 'text',
    subType: 'subtitle',
    text: 'ONE RENDER',
    config: { fontSize: 48, fontFamily: 'Poppins' },
    animations: [
      { type: 'fade-in', startFrame: 0, endFrame: 5 },
      { type: 'fade-out', startFrame: 5, endFrame: 10 },
    ],
    words: [],
  };

  applyTextSubtitleAnimations(context, item, (7 / 24) * 1000, 0, 24);

  assert.deepEqual(calls.fillText.map((call) => call.text), ['ONE RENDER']);
  assert.ok(Math.abs(calls.fillText[0].globalAlpha - 0.648) < 0.001);
});

test('subtitle item edges receive a shared gentle fade', () => {
  const createItem = () => ({
    type: 'text',
    subType: 'subtitle',
    text: 'SMOOTH',
    config: {
      fontSize: 48,
      fontFamily: 'Poppins',
      frameOffset: 0,
      frameDuration: 12,
    },
    words: [],
  });
  const edgeRender = createTextContext();
  const middleRender = createTextContext();

  applyTextSubtitleAnimations(edgeRender.context, createItem(), 0, 0, 24);
  applyTextSubtitleAnimations(middleRender.context, createItem(), (6 / 24) * 1000, 0, 24);

  assert.ok(edgeRender.calls.fillText[0].globalAlpha > 0);
  assert.ok(edgeRender.calls.fillText[0].globalAlpha < 1);
  assert.equal(middleRender.calls.fillText[0].globalAlpha, 1);
});

test('listener-style final subtitle frame remains visibly faded instead of transparent', () => {
  const { context, calls } = createTextContext();
  const item = {
    type: 'text',
    subType: 'subtitle',
    text: 'LAST FRAME',
    subtitleRenderMode: 'mapped',
    subtitleAlignmentMapped: true,
    config: {
      fontSize: 48,
      fontFamily: 'Poppins',
      frameOffset: 0,
      frameDuration: 11,
    },
    words: [{ word: 'LAST FRAME', frameOffset: 0, frameDuration: 12 }],
  };

  applyTextSubtitleAnimations(context, item, (11 / 24) * 1000, 0, 24);

  assert.equal(calls.fillText.length, 1);
  assert.ok(calls.fillText[0].globalAlpha > 0);
  assert.ok(calls.fillText[0].globalAlpha < 1);
});

test('fractional layer offsets keep item-relative highlights on the first frame', () => {
  const { context, calls } = createTextContext();
  const durationOffset = 2.03;
  const item = {
    type: 'text',
    subType: 'subtitle',
    text: 'FIRST',
    config: {
      fontSize: 48,
      fontFamily: 'Poppins',
      frameOffset: 0,
      frameDuration: 12,
    },
    words: [{ word: 'FIRST', frameOffset: 0, frameDuration: 6 }],
    wordAnimation: 'highlight',
  };

  applyTextSubtitleAnimations(context, item, durationOffset * 1000, durationOffset, 24);

  assert.equal(calls.fillRect.length, 1);
});

test('session-global listener timings render a translated cue in a later layer', () => {
  const { context, calls } = createTextContext();
  const durationOffset = 5;
  const item = {
    type: 'text',
    subType: 'subtitle',
    text: 'GLOBAL',
    subtitleRenderMode: 'mapped',
    subtitleAlignmentMapped: true,
    config: {
      fontSize: 48,
      fontFamily: 'Poppins',
      frameOffset: 0,
      frameDuration: 11,
    },
    words: [{ word: 'GLOBAL', frameOffset: 120, frameDuration: 12 }],
    wordAnimation: 'highlight',
  };

  applyTextSubtitleAnimations(context, item, durationOffset * 1000, durationOffset, 24);

  assert.deepEqual(calls.fillText.map((call) => call.text), ['GLOBAL']);
  assert.equal(calls.fillRect.length, 0);
  assert.ok(calls.fillText[0].globalAlpha > 0);
});

test('speaker labels preserve body typography and casing with an exact one-pixel size lift', () => {
  const { context, calls } = createTextContext();
  const item = {
    type: 'text',
    subType: 'subtitle',
    text: 'HELLO',
    speaker: 'Narrator',
    showSpeaker: true,
    config: {
      fontSize: 50,
      fontFamily: 'Poppins',
      fillColor: '#F8FAFC',
      strokeColor: '#111827',
      strokeWidth: 2,
      speakerFontSize: 39,
      speakerFontFamily: 'Arial',
      speakerFillColor: '#FACC15',
      speakerStrokeColor: '#EF4444',
      frameOffset: 0,
      frameDuration: 12,
    },
    words: [{ word: 'HELLO', frameOffset: 0, frameDuration: 12 }],
  };

  applyTextSubtitleAnimations(context, item, (5 / 24) * 1000, 0, 24);

  const speakerCall = calls.fillText.find((call) => call.text === 'Narrator:');
  const bodyCall = calls.fillText.find((call) => call.text === 'HELLO');
  assert.equal(speakerCall.font, bodyCall.font.replace('50px', '51px'));
  assert.match(speakerCall.font, /51px Poppins/);
  assert.equal(speakerCall.fillStyle, '#F8FAFC');
  const speakerStroke = calls.strokeText.find((call) => call.text === 'Narrator:');
  assert.equal(speakerStroke.strokeStyle, '#111827');
});

test('cross-script speaker and subtitle text share one resolved font stack', () => {
  const { context, calls } = createTextContext();
  const item = {
    type: 'text',
    subType: 'subtitle',
    text: 'ยินดีต้อนรับ',
    speaker: 'Narrator',
    showSpeaker: true,
    subtitleRenderMode: 'mapped',
    subtitleAlignmentMapped: true,
    config: {
      fontSize: 48,
      fontFamily: 'Sarabun',
      fillColor: '#FFFFFF',
      frameOffset: 0,
      frameDuration: 12,
      autoWrap: true,
      breakTextWidth: 800,
    },
    words: [{
      word: 'ยินดีต้อนรับ',
      frameOffset: 0,
      frameDuration: 12,
      mappingIndex: 0,
    }],
  };

  applyTextSubtitleAnimations(context, item, (5 / 24) * 1000, 0, 24);

  const speakerCall = calls.fillText.find((call) => call.text === 'Narrator:');
  const bodyCall = calls.fillText.find((call) => call.text === 'ยินดีต้อนรับ');
  assert.equal(speakerCall.font, bodyCall.font.replace('48px', '49px'));
  assert.equal(
    speakerCall.font.replace('49px', '48px'),
    bodyCall.font,
  );
  assert.match(bodyCall.font, /48px Sarabun/);
});

test('wrapped page-first lines reserve width for the localized speaker label', () => {
  const { context, calls } = createTextContext();
  const item = {
    type: 'text',
    subType: 'subtitle',
    text: 'ONE TWO',
    speaker: 'Narrator',
    showSpeaker: true,
    subtitleRenderMode: 'mapped',
    subtitleAlignmentMapped: true,
    config: {
      fontSize: 48,
      fontFamily: 'Poppins',
      fillColor: '#FFFFFF',
      autoWrap: true,
      breakLongWords: true,
      breakTextWidth: 180,
      frameOffset: 0,
      frameDuration: 12,
    },
    words: [
      { word: 'ONE', frameOffset: 0, frameDuration: 6 },
      { word: 'TWO', frameOffset: 6, frameDuration: 6 },
    ],
    wordAnimation: 'highlight',
  };

  applyTextSubtitleAnimations(context, item, (2 / 24) * 1000, 0, 24);

  const speakerCall = calls.fillText.find((call) => call.text === 'Narrator:');
  const firstWordCall = calls.fillText.find((call) => call.text === 'ONE');
  const renderedFirstLineWidth = firstWordCall.x + 36 - speakerCall.x;
  assert.ok(renderedFirstLineWidth <= item.config.breakTextWidth);
  assert.notEqual(
    firstWordCall.y,
    calls.fillText.find((call) => call.text === 'TWO').y,
  );
});
