import test from 'node:test';
import assert from 'node:assert/strict';

import { getResourceListPrompt } from './AgentCreatorSystemPrompts.js';

import {
  getGroundedMovieNarrativeExtractorSystemPrompt,
  getMovieNarrativeExtractorSystemPrompt,
  getTextToVideoNarrativeSystemPrompt,
} from './AgentCreatorSystemPrompts.js';

test('Happy Horse narrative prompts include every supported scene duration', () => {
  const prompts = [
    getMovieNarrativeExtractorSystemPrompt(180, 'HAPPYHORSEI2V', false, 'English'),
    getGroundedMovieNarrativeExtractorSystemPrompt(180, 'HAPPYHORSEI2V', false, 'English'),
  ];

  for (const prompt of prompts) {
    assert.match(prompt, /Each scene must be 5, 10, or 15 seconds long/);
    assert.match(prompt, /83 characters or fewer for a 15-second scene/);
    assert.match(prompt, /spaces and punctuation count toward the limit/);
    assert.doesNotMatch(prompt, /HARD SPEECH LIMIT/);
  }
});

test('shared text-to-video prompt builder returns the complete selected narrative prompt', () => {
  const basePrompt = getGroundedMovieNarrativeExtractorSystemPrompt(
    90,
    'COSMOS3SUPERI2V',
    false,
    'English',
  );
  const sharedPrompt = getTextToVideoNarrativeSystemPrompt({
    duration: 90,
    videoModel: 'COSMOS3SUPERI2V',
    grounded: true,
    languageString: 'English',
    minimumSceneCount: 4,
  });

  assert.equal(
    sharedPrompt,
    basePrompt +
      '\n- The transcript must contain at least 4 scenes so it can support the requested branching depth.',
  );
});
test('Seedance 2.5 agent resource prompts use every supported scene partition', () => {
  const prompt = getResourceListPrompt('SEEDANCE2.5I2V');

  assert.match(prompt, /duration of each scene can be 5, 10, or 15 seconds/);
  assert.doesNotMatch(prompt, /duration of each scene can be 5 or 10 seconds/);
  assert.doesNotMatch(prompt, /20, 25, or 30/);
});
