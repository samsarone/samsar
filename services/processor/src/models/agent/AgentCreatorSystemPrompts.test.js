import test from 'node:test';
import assert from 'node:assert/strict';

import {
  getGroundedMovieNarrativeExtractorSystemPrompt,
  getMovieNarrativeExtractorSystemPrompt,
} from './AgentCreatorSystemPrompts.js';

test('Happy Horse narrative prompts include every supported scene duration', () => {
  const prompts = [
    getMovieNarrativeExtractorSystemPrompt(180, 'HAPPYHORSEI2V', false, 'English'),
    getGroundedMovieNarrativeExtractorSystemPrompt(180, 'HAPPYHORSEI2V', false, 'English'),
  ];

  for (const prompt of prompts) {
    assert.match(prompt, /Each scene can be 5, 10, or 15 seconds long/);
    assert.match(prompt, /75 characters for 15 second scenes/);
  }
});
