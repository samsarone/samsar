import test from 'node:test';
import assert from 'node:assert/strict';

import {
  filterVisibleGeneratedImages,
  normalizeGeneratedImageAssetKey,
} from './ImageGenerationVisibility.js';

test('normalizes equivalent generated image URLs to one asset key', () => {
  assert.equal(
    normalizeGeneratedImageAssetKey('https://media.example/assets_v2/generations/session/final.png?token=one'),
    'assets_v2/generations/session/final.png'
  );
  assert.equal(
    normalizeGeneratedImageAssetKey('/assets_v2/generations/session/final.png'),
    'assets_v2/generations/session/final.png'
  );
});

test('keeps only active final images from video scene generation', () => {
  const images = [
    { _id: 'final', sessionId: 'video-1', url: 'assets_v2/generations/video-1/final.png' },
    { _id: 'candidate-2', sessionId: 'video-1', url: 'assets_v2/generations/video-1/candidate-2.png' },
    { _id: 'candidate-1', sessionId: 'video-1', url: 'assets_v2/generations/video-1/candidate-1.png' },
    { _id: 'user-edit', sessionId: 'video-1', url: 'assets_v2/generations/video-1/edit.png', generationType: 'edit' },
  ];
  const sessions = [{
    _id: 'video-1',
    sessionType: 'video',
    layers: [{
      imageSession: {
        activeGeneratedImage: '/assets_v2/generations/video-1/final.png',
      },
    }],
  }];

  assert.deepEqual(
    filterVisibleGeneratedImages(images, sessions).map((item) => item._id),
    ['final', 'user-edit']
  );
});

test('keeps image-studio and standalone history while deduplicating assets', () => {
  const images = [
    { _id: 'studio-new', sessionId: 'image-1', url: '/generations/studio.png' },
    { _id: 'studio-duplicate', sessionId: 'image-1', url: 'https://media.example/generations/studio.png?new=signature' },
    { _id: 'studio-old', sessionId: 'image-1', url: '/generations/older.png' },
    { _id: 'standalone', sessionId: 'request-1', url: '/generations/standalone.png' },
  ];
  const sessions = [{ _id: 'image-1', sessionType: 'image', layers: [] }];

  assert.deepEqual(
    filterVisibleGeneratedImages(images, sessions).map((item) => item._id),
    ['studio-new', 'studio-old', 'standalone']
  );
});

test('excludes explicitly tagged intermediate records', () => {
  const images = [
    { _id: 'visible', sessionId: 'request-1', url: '/generations/final.png' },
    { _id: 'flagged', sessionId: 'request-1', url: '/generations/flagged.png', isIntermediate: true },
    { _id: 'typed', sessionId: 'request-1', url: '/generations/typed.png', generationType: 'filter_pass' },
  ];

  assert.deepEqual(
    filterVisibleGeneratedImages(images, []).map((item) => item._id),
    ['visible']
  );
});
