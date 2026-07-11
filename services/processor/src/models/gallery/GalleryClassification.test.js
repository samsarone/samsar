import assert from 'node:assert/strict';
import test from 'node:test';

import {
  GALLERY_CATEGORIES,
  GALLERY_CLASSIFICATION_INFERENCE_SETTINGS,
  buildGalleryClassificationContext,
  buildGalleryClassificationMessages,
  isGalleryClassificationStale,
  normalizeGalleryClassificationOutput,
} from './GalleryClassification.js';

test('uses a bounded canonical category taxonomy', () => {
  assert.ok(GALLERY_CATEGORIES.length <= 20);
  assert.ok(GALLERY_CATEGORIES.includes('Health & Fitness'));
  assert.ok(GALLERY_CATEGORIES.includes('Science & Technology'));
  assert.ok(GALLERY_CATEGORIES.includes('Music'));
  assert.ok(GALLERY_CATEGORIES.includes('Film & Animation'));
});

test('uses GPT 5.6 Luna with xhigh reasoning', () => {
  assert.deepEqual(GALLERY_CLASSIFICATION_INFERENCE_SETTINGS, {
    model: 'gpt-5.6-luna',
    reasoning: { effort: 'xhigh' },
  });
});

test('classification becomes stale after 24 hours', () => {
  const now = new Date('2026-07-11T12:00:00.000Z');
  assert.equal(isGalleryClassificationStale(null, now), true);
  assert.equal(isGalleryClassificationStale({
    version: 'gallery-classification-v1',
    lastUpdatedAt: new Date(now.getTime() - 23 * 60 * 60 * 1000),
  }, now), false);
  assert.equal(isGalleryClassificationStale({
    version: 'gallery-classification-v1',
    lastUpdatedAt: new Date(now.getTime() - 24 * 60 * 60 * 1000),
  }, now), true);
});

test('similarity context includes classifications across every video format', () => {
  const context = buildGalleryClassificationContext(
    { categories: ['Education'], topics: ['robotics'] },
    [
      {
        format: 'portrait',
        similarityScore: 0.91,
        categories: ['Science & Technology'],
        topics: ['industrial automation'],
      },
      {
        format: 'landscape',
        similarityScore: 0.86,
        categories: ['Business & Finance'],
        topics: ['smart manufacturing'],
      },
      {
        format: 'square',
        similarityScore: 0.8,
        categories: ['Education'],
        topics: ['control systems'],
      },
    ],
  );

  assert.deepEqual(context.similar_items.map((item) => item.topics[0]), [
    'industrial automation',
    'smart manufacturing',
    'control systems',
  ]);
  assert.ok(context.candidate_existing_topics.includes('robotics'));
  assert.ok(context.candidate_existing_topics.includes('industrial automation'));
  assert.ok(context.candidate_existing_categories.includes('Science & Technology'));
});

test('aggregates taxonomy from neighbours beyond the compact prompt sample', () => {
  const similarItems = Array.from({ length: 13 }, (_, index) => ({
    similarityScore: 1 - index / 100,
    categories: [index === 12 ? 'Music' : 'Education'],
    topics: [index === 12 ? 'ambient music' : `learning topic ${index}`],
  }));
  const context = buildGalleryClassificationContext({}, similarItems);

  assert.equal(context.similar_items.length, 12);
  assert.ok(context.candidate_existing_topics.includes('ambient music'));
  assert.ok(context.candidate_existing_categories.includes('Music'));
});

test('LLM request contains prompt, transcript, current classification and similarity taxonomy', () => {
  const context = buildGalleryClassificationContext(
    { categories: ['Education'], topics: ['robotics'] },
    [{
      similarityScore: 0.9,
      categories: ['Science & Technology'],
      topics: ['industrial automation'],
    }],
  );
  const messages = buildGalleryClassificationMessages({
    originalPrompt: 'Explain feedback-controlled robots.',
    sessionTranscript: {
      scenes: [{ scene_index: 0, type: 'narration', visual: 'A robotic arm moves.', speaker: '' }],
      sounds: [{ type: 'speech', sub_type: 'narration', scene_index: 0, speaker: 'Narrator', text: 'Sensors close the loop.' }],
    },
  }, context);
  const payload = JSON.parse(messages[1].content);

  assert.equal(payload.publication.original_prompt, 'Explain feedback-controlled robots.');
  assert.equal(payload.publication.session_transcript.scenes[0].visual, 'A robotic arm moves.');
  assert.deepEqual(payload.existing_classification.topics, ['robotics']);
  assert.ok(payload.candidate_existing_topics.includes('industrial automation'));
});

test('normalization reuses existing topics before admitting bounded new topics', () => {
  const context = buildGalleryClassificationContext(
    { categories: [], topics: [] },
    [{
      similarityScore: 0.9,
      categories: ['Science & Technology'],
      topics: ['robotic systems', 'industrial automation'],
    }],
  );
  const result = normalizeGalleryClassificationOutput({
    categories: ['Science & Technology', 'Not A Category'],
    existing_topics: ['Industrial Automation', 'invented existing topic'],
    new_topics: ['robotic system', 'sensor fusion'],
  }, context, ['robotic systems', 'sensor fusion']);

  assert.deepEqual(result.categories, ['Science & Technology']);
  assert.deepEqual(result.topics, [
    'industrial automation',
    'robotic systems',
    'sensor fusion',
  ]);
});
