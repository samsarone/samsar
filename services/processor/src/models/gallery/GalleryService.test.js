import assert from 'node:assert/strict';
import test from 'node:test';

import { buildGalleryEmbeddingText } from './GalleryService.js';

test('gallery embeddings use prompt and transcript but not mutable taxonomy fields', () => {
  const publication = {
    title: 'Feedback Loops',
    description: 'A robotics explainer.',
    originalPrompt: 'Explain industrial robot control systems.',
    sessionTranscript: {
      scenes: [{
        scene_index: 0,
        type: 'narration',
        visual: 'A robotic arm aligns a component.',
        speaker: '',
      }],
      sounds: [{
        type: 'speech',
        sub_type: 'narration',
        scene_index: 0,
        speaker: 'Narrator',
        text: 'Sensors continuously correct the arm position.',
      }],
    },
    tags: ['legacy robotics'],
    categories: ['Science & Technology'],
    topics: ['industrial automation'],
  };
  const first = buildGalleryEmbeddingText(publication);
  const second = buildGalleryEmbeddingText({
    ...publication,
    tags: ['different legacy tag'],
    categories: ['Education'],
    topics: ['control systems'],
  });

  assert.equal(first, second);
  assert.match(first, /industrial robot control systems/i);
  assert.match(first, /robotic arm aligns a component/i);
  assert.match(first, /sensors continuously correct/i);
  assert.doesNotMatch(first, /legacy robotics/i);
  assert.doesNotMatch(first, /industrial automation/i);
});
