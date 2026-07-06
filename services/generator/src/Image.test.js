import test from 'node:test';
import assert from 'node:assert/strict';

import { __testOnly__ } from './Image.js';

test('image scoring context prefers current request prompt over movie resource scene index', () => {
  const context = __testOnly__.buildImageThemeScoringContext(
    {
      movieResourceList: {
        scenes: [
          { visual: 'Asha scene visual' },
        ],
      },
      layers: [
        {
          originalImageGenerationPrompt: 'Kenji layer prompt',
        },
      ],
    },
    0,
    'Kenji current retry prompt',
  );

  assert.equal(context, 'Layer visual prompt: Kenji current retry prompt');
});

test('image scoring context falls back to layer prompt before scene visual', () => {
  const context = __testOnly__.buildImageThemeScoringContext(
    {
      movieResourceList: {
        scenes: [
          { visual: 'Asha scene visual' },
        ],
      },
      layers: [
        {
          originalImageGenerationPrompt: 'Kenji layer prompt',
        },
      ],
    },
    0,
    '',
  );

  assert.equal(context, 'Layer visual prompt: Kenji layer prompt');
});

test('image scoring context does not use layer index as scene index when scene and layer arrays diverge', () => {
  const context = __testOnly__.buildImageThemeScoringContext(
    {
      movieResourceList: {
        scenes: [
          { visual: 'Asha scene visual' },
          { visual: 'Rack scene visual' },
          { visual: 'Kenji scene visual' },
        ],
      },
      layers: [
        {},
      ],
    },
    0,
    '',
  );

  assert.equal(context, '');
});

test('image scoring context uses explicit source scene index when available', () => {
  const context = __testOnly__.buildImageThemeScoringContext(
    {
      movieResourceList: {
        scenes: [
          { visual: 'Asha scene visual' },
          { visual: 'Rack scene visual' },
          { visual: 'Kenji scene visual' },
        ],
      },
      layers: [
        {
          sourceSceneIndex: 2,
        },
      ],
    },
    0,
    '',
  );

  assert.equal(context, 'Scene visual: Kenji scene visual');
});

test('image scoring payload context uses explicit source scene index for reroll scene visual', () => {
  const details = __testOnly__.buildImageThemeScoringContextDetailsForPayload(
    {
      movieResourceList: {
        scenes: [
          { visual: 'Asha scene visual' },
          { visual: 'Rack scene visual' },
          { visual: 'Kenji scene visual' },
        ],
      },
      layers: [
        {},
      ],
    },
    0,
    {
      sourceSceneIndex: 2,
    },
  );

  assert.equal(details.context, 'Scene visual: Kenji scene visual');
  assert.equal(details.diagnostics.contextType, 'scene_visual');
  assert.equal(details.diagnostics.layerDataIndex, 0);
  assert.equal(details.diagnostics.sourceSceneIndex, 2);
  assert.equal(details.diagnostics.sourceSceneIndexSource, 'payload.sourceSceneIndex');
  assert.equal(details.diagnostics.sceneIndexFallbackUsed, false);
});

test('image scoring context diagnostics identifies selected prompt source', () => {
  const details = __testOnly__.buildImageThemeScoringContextDetails(
    {
      movieResourceList: {
        scenes: [
          { visual: 'Asha scene visual' },
        ],
      },
      layers: [
        {
          originalImageGenerationPrompt: 'Kenji layer prompt',
        },
      ],
    },
    0,
    '',
  );

  assert.equal(details.context, 'Layer visual prompt: Kenji layer prompt');
  assert.equal(details.diagnostics.contextType, 'layer_prompt');
  assert.equal(details.diagnostics.selectedPromptSource, 'layer.originalImageGenerationPrompt');
  assert.equal(details.diagnostics.layerDataIndex, 0);
  assert.equal(details.diagnostics.selectedPromptText.length, 'Kenji layer prompt'.length);
});
