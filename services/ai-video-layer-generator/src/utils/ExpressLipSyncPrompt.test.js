import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildFallbackExpressLipSyncPrompt,
  buildExpressLipSyncPromptMessages,
  normalizeGeneratedExpressLipSyncPrompt,
  resolveExpressLipSyncPromptContext,
} from './ExpressLipSyncPrompt.js';

test('resolves the connected speech speaker and selected starting-frame description', () => {
  const context = resolveExpressLipSyncPromptContext({
    layers: [
      {
        _id: 'layer-1',
        prompt: 'A tense discussion unfolds beside the conference table.',
        activeImageCandidate: {
          description: 'Maya in a blue jacket sits on the left; Arun in a grey shirt stands close to camera.',
        },
      },
    ],
    audioLayers: [
      {
        _id: 'audio-1',
        generationType: 'speech',
        connectedLayerId: 'layer-1',
        speakerCharacterName: 'Maya',
        prompt: 'We need to reconsider the launch date.',
      },
    ],
  }, {
    layerId: 'layer-1',
    audioPrompt: 'We need to reconsider the launch date.',
  });

  assert.deepEqual(context, {
    layerId: 'layer-1',
    audioLayerId: 'audio-1',
    startingFrameDescription: 'Maya in a blue jacket sits on the left; Arun in a grey shirt stands close to camera.',
    sceneDescription: 'A tense discussion unfolds beside the conference table.',
    speechText: 'We need to reconsider the launch date.',
    speakerName: 'Maya',
    speakerDescription: '',
  });
});

test('falls back to the connected layer index for legacy speech bindings', () => {
  const context = resolveExpressLipSyncPromptContext({
    layers: [{ _id: 'layer-1' }, { _id: 'layer-2', activeImageDescription: 'Two people at a cafe.' }],
    audioLayers: [{
      _id: 'audio-2',
      generationType: 'speech',
      connectedLayerIndex: 1,
      speaker: 'The barista',
      prompt: 'Your order is ready.',
    }],
  }, { layerId: 'layer-2' });

  assert.equal(context.audioLayerId, 'audio-2');
  assert.equal(context.speakerName, 'The barista');
  assert.equal(context.speechText, 'Your order is ready.');
});

test('fallback prompt uses the explicit prompt arguments to target the named speaker', () => {
  const prompt = buildFallbackExpressLipSyncPrompt({
    startingFrameDescription: 'Maya wears blue on the left while Arun is foregrounded.',
    sceneDescription: 'A discussion at a conference table.',
    speechItem: {
      characterName: 'Maya',
      text: 'We need to reconsider the launch date.',
    },
  });
  const lines = prompt.split('\n');

  assert.equal(lines.length, 7);
  assert.match(lines[0], /Maya is the character/);
  assert.match(prompt, /identity anchor/);
  assert.match(prompt, /camera movement, cuts, reframing, or position changes/);
  assert.match(prompt, /never switch, share, or distribute/);
});

test('normalizes valid model output and rejects output outside the 5-8 line contract', () => {
  const valid = [
    '1. Target Maya.',
    '2. Match her blue jacket.',
    '3. Preserve the scene.',
    '4. Follow the dialogue.',
    '5. Keep Arun silent.',
  ].join('\n');

  assert.equal(
    normalizeGeneratedExpressLipSyncPrompt(valid),
    [
      'Target Maya.',
      'Match her blue jacket.',
      'Preserve the scene.',
      'Follow the dialogue.',
      'Keep Arun silent.',
    ].join('\n'),
  );
  assert.equal(normalizeGeneratedExpressLipSyncPrompt('Only one line.'), '');
});

test('inference request uses a minimal natural system prompt and a structured input payload', () => {
  const messages = buildExpressLipSyncPromptMessages({
    startingFrameDescription: 'Arun is foregrounded; Maya is seated on the left.',
    sceneDescription: 'Two colleagues talk.',
    speechItem: {
      characterName: 'Maya',
      characterDescription: 'A woman wearing a blue jacket.',
      text: 'Hello.',
    },
  });

  assert.equal(messages[0].content.split('\n').length, 1);
  assert.match(messages[0].content, /identify the speaker and describe that same character's location/);
  assert.match(messages[0].content, /starting position as an identity anchor/);
  assert.match(messages[0].content, /sole lip-sync target throughout the video/);
  assert.match(messages[0].content, /never switch, share, or distribute/);
  assert.doesNotMatch(messages[0].content, /\bif\b|\bwhen\b|\botherwise\b/i);

  assert.deepEqual(JSON.parse(messages[1].content), {
    starting_frame_image_description: 'Arun is foregrounded; Maya is seated on the left.',
    scene_description: 'Two colleagues talk.',
    speech_item: {
      character_name: 'Maya',
      text: 'Hello.',
      character_description: 'A woman wearing a blue jacket.',
    },
  });
});
