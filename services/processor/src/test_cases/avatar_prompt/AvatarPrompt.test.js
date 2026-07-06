import test from 'node:test';
import assert from 'node:assert/strict';

import { buildAvatarImagePrompt } from '../../models/AvatarVoiceover.js';
import { buildNarratorAvatarImagePrompt } from '../../models/movie_session/image_list_to_video/SessionRequestBuilder.js';

test('avatar voiceover prompt requests square black-background avatar images', () => {
  const prompt = buildAvatarImagePrompt('confident presenter');
  assert.match(prompt, /landscape 16:9/i);
  assert.match(prompt, /solid black background/i);
  assert.match(prompt, /centered/i);
  assert.match(prompt, /do not use a white background or transparent background/i);
});

test('image-list narrator avatar prompt uses top-level narrator gender fallback', () => {
  const prompt = buildNarratorAvatarImagePrompt({
    inputPrompt: 'launch a new product',
    themeJson: '{"tone":"premium"}',
    movieResourceList: {
      narrator: { actor: 'Ari', gender: 'M', Identity: 'confident product reviewer' },
      sounds: [],
    },
    languageString: 'English',
  });
  assert.match(prompt, /Narrator avatar gender: M \(male\)/i);
  assert.match(prompt, /Narrator name\/actor: Ari/i);
  assert.match(prompt, /Narrator gender: M/i);
});

test('image-list narrator avatar prompt requests square black-background avatar images', () => {
  const prompt = buildNarratorAvatarImagePrompt({
    inputPrompt: 'launch a new product',
    themeJson: '{"tone":"premium"}',
    movieResourceList: { sounds: [{ type: 'speech', subType: 'narration', actor: 'Mia', gender: 'F' }] },
    languageString: 'English',
    metadata: 'brand-safe ad',
    imageDescriptionList: 'product shots and presenter scenes',
  });
  assert.match(prompt, /landscape 16:9/i);
  assert.match(prompt, /solid black background/i);
  assert.match(prompt, /centered/i);
  assert.match(prompt, /do not use a white background or transparent background/i);
  assert.match(prompt, /Narrator avatar gender: F \(female\)/i);
  assert.match(prompt, /Narrator gender: F/i);
});
