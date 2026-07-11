import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildPublicationMetadataInput,
  normalizePublicationTranscript,
  resolvePublicationOriginalPrompt,
} from './Transcript.js';

const movieResourceList = {
  narrator: { actor: 'Ignored narrator metadata' },
  scenes: [
    {
      type: 'dialogue',
      visual: 'Two engineers inspect a robotic arm.',
      speaker: 'Asha',
      duration: 4,
      startTime: 0,
      characters: ['Asha'],
    },
    {
      type: 'b-roll',
      visual: 'The arm adjusts a component on the assembly line.',
      duration: 3,
    },
  ],
  sounds: [
    {
      type: 'speech',
      subType: 'dialogue',
      sceneIndex: 0,
      actor: 'Asha',
      audio: 'The controller corrects its position in real time.',
      duration: 4,
      gender: 'F',
    },
    {
      type: 'music',
      sceneIndex: 0,
      audio: 'Upbeat electronic score',
    },
    {
      type: 'speech',
      sub_type: 'narration',
      scene_index: 1,
      text: 'Feedback loops keep each movement precise.',
    },
  ],
  metadata: 'Internal generation metadata',
};

test('normalizes a movie resource list into a minimal publication transcript', () => {
  assert.deepEqual(normalizePublicationTranscript(movieResourceList), {
    scenes: [
      {
        scene_index: 0,
        type: 'dialogue',
        visual: 'Two engineers inspect a robotic arm.',
        speaker: 'Asha',
      },
      {
        scene_index: 1,
        type: 'b-roll',
        visual: 'The arm adjusts a component on the assembly line.',
        speaker: '',
      },
    ],
    sounds: [
      {
        type: 'speech',
        sub_type: 'dialogue',
        scene_index: 0,
        speaker: 'Asha',
        text: 'The controller corrects its position in real time.',
      },
      {
        type: 'speech',
        sub_type: 'narration',
        scene_index: 1,
        speaker: '',
        text: 'Feedback loops keep each movement precise.',
      },
    ],
  });
});

test('builds metadata input with the original prompt without adding it to the transcript', () => {
  const transcript = normalizePublicationTranscript(movieResourceList);
  const metadataInput = buildPublicationMetadataInput(
    movieResourceList,
    'Create a concise industrial robotics explainer.'
  );

  assert.equal(
    metadataInput.original_prompt,
    'Create a concise industrial robotics explainer.'
  );
  assert.deepEqual(metadataInput.scenes, transcript.scenes);
  assert.deepEqual(metadataInput.sounds, transcript.sounds);
  assert.equal('original_prompt' in transcript, false);
  assert.equal(JSON.stringify(metadataInput).includes('Internal generation metadata'), false);
  assert.equal(JSON.stringify(metadataInput).includes('Upbeat electronic score'), false);
});

test('resolves the same original prompt used when publishing', () => {
  assert.equal(
    resolvePublicationOriginalPrompt({}, {
      expressInputPrompt: 'Build an Express session about robotics.',
      promptlist: ['generated scene prompt'],
    }),
    'Build an Express session about robotics.'
  );
  assert.equal(
    resolvePublicationOriginalPrompt(
      { originalPrompt: 'Explicit publication prompt' },
      { inputPrompt: 'Session input prompt' }
    ),
    'Explicit publication prompt'
  );
});

test('accepts JSON and single-item array resource-list storage shapes', () => {
  const expected = normalizePublicationTranscript(movieResourceList);
  assert.deepEqual(normalizePublicationTranscript(JSON.stringify(movieResourceList)), expected);
  assert.deepEqual(normalizePublicationTranscript([movieResourceList]), expected);
});
