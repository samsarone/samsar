import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildBranchedCameraTransitionTraversal,
  createBranchedCameraTransitions,
  formatBranchedCameraTransitionContext,
} from './BranchedCameraTransitions.js';

function buildLayers(ids) {
  return ids.map((id) => ({ _id: id, description: `Description ${id}` }));
}

function buildPath(pathId, ordinal, layerIds) {
  return {
    pathId,
    ordinal,
    timeline: layerIds.map((layerId, sequenceIndex) => ({ layerId, sequenceIndex })),
  };
}

test('traversal separates the common root and walks branch scenes breadth first', () => {
  const layers = buildLayers(['root-1', 'root-2', 'left-1', 'left-2', 'right-1', 'right-2']);
  const traversal = buildBranchedCameraTransitionTraversal({
    layers,
    branchingMeta: { branchSceneIndices: [1] },
    branchRenderPaths: [
      buildPath('root.2', 1, ['root-1', 'root-2', 'right-1', 'right-2']),
      buildPath('root.1', 0, ['root-1', 'root-2', 'left-1', 'left-2']),
    ],
  });

  assert.deepEqual(traversal.rootLayerIds, ['root-1', 'root-2']);
  assert.deepEqual(
    traversal.levels.map((level) => level.map((node) => node.layerId)),
    [['left-1', 'right-1'], ['left-2', 'right-2']],
  );
  assert.deepEqual(
    traversal.levels[1][1].previousLayerIds,
    ['root-1', 'root-2', 'right-1'],
  );
});

test('nested branch traversal preserves each node path ancestry', () => {
  const layerIds = ['root', 'left', 'right', 'left-a', 'left-b', 'right-a', 'right-b'];
  const traversal = buildBranchedCameraTransitionTraversal({
    layers: buildLayers(layerIds),
    branchingMeta: { branchSceneIndices: [0, 1] },
    branchRenderPaths: [
      buildPath('root.1.1', 0, ['root', 'left', 'left-a']),
      buildPath('root.1.2', 1, ['root', 'left', 'left-b']),
      buildPath('root.2.1', 2, ['root', 'right', 'right-a']),
      buildPath('root.2.2', 3, ['root', 'right', 'right-b']),
    ],
  });

  assert.deepEqual(traversal.rootLayerIds, ['root']);
  assert.deepEqual(
    traversal.levels.map((level) => level.map((node) => node.layerId)),
    [['left', 'right'], ['left-a', 'left-b', 'right-a', 'right-b']],
  );
  assert.deepEqual(traversal.levels[1][2].previousLayerIds, ['root', 'right']);
});

test('branched generation persists every parent level before requesting descendants', async () => {
  const layers = buildLayers(['root', 'left', 'right', 'left-leaf', 'right-leaf']);
  const events = [];
  const result = await createBranchedCameraTransitions({
    layers,
    branchingMeta: { branchSceneIndices: [0] },
    branchRenderPaths: [
      buildPath('root.1', 0, ['root', 'left', 'left-leaf']),
      buildPath('root.2', 1, ['root', 'right', 'right-leaf']),
    ],
    getLayerDescription: (layer) => layer.description,
    requestRootTransitions: async ({ sceneDescriptions }) => {
      events.push(`request-root:${sceneDescriptions.join('|')}`);
      return 'Root transition';
    },
    requestSceneTransition: async ({ layerId, previousScenes }) => {
      events.push(`request:${layerId}:${previousScenes.map((scene) => scene.cameraTransition).join('|')}`);
      return `Transition ${layerId}`;
    },
    persistTransitions: async (results) => {
      events.push(`persist:${results.map((entry) => entry.layerId).join('|')}`);
    },
  });

  assert.deepEqual(Object.fromEntries(result), {
    root: 'Root transition',
    left: 'Transition left',
    right: 'Transition right',
    'left-leaf': 'Transition left-leaf',
    'right-leaf': 'Transition right-leaf',
  });
  assert.deepEqual(events, [
    'request-root:Description root',
    'persist:root',
    'request:left:Root transition',
    'request:right:Root transition',
    'persist:left|right',
    'request:left-leaf:Root transition|Transition left',
    'request:right-leaf:Root transition|Transition right',
    'persist:left-leaf|right-leaf',
  ]);
});

test('descendant requests wait for the complete parent-level persistence barrier', async () => {
  const layers = buildLayers(['root', 'left', 'right', 'left-leaf', 'right-leaf']);
  const requestedLayerIds = [];
  let releaseParentPersistence;
  const parentPersistenceGate = new Promise((resolve) => {
    releaseParentPersistence = resolve;
  });
  let parentPersistenceStarted;
  const parentPersistenceStartedGate = new Promise((resolve) => {
    parentPersistenceStarted = resolve;
  });

  const generationPromise = createBranchedCameraTransitions({
    layers,
    branchingMeta: { branchSceneIndices: [0] },
    branchRenderPaths: [
      buildPath('root.1', 0, ['root', 'left', 'left-leaf']),
      buildPath('root.2', 1, ['root', 'right', 'right-leaf']),
    ],
    getLayerDescription: (layer) => layer.description,
    requestRootTransitions: async () => 'Root transition',
    requestSceneTransition: async ({ layerId }) => {
      requestedLayerIds.push(layerId);
      return `Transition ${layerId}`;
    },
    persistTransitions: async (results) => {
      if (results.some((entry) => entry.layerId === 'left')) {
        parentPersistenceStarted();
        await parentPersistenceGate;
      }
    },
  });

  await parentPersistenceStartedGate;
  assert.deepEqual(requestedLayerIds, ['left', 'right']);
  releaseParentPersistence();
  await generationPromise;
  assert.deepEqual(requestedLayerIds, ['left', 'right', 'left-leaf', 'right-leaf']);
});

test('a malformed root list is persisted as failed and blocks every descendant request', async () => {
  const persistedResults = [];
  const requestedLayerIds = [];
  const generationPromise = createBranchedCameraTransitions({
    layers: buildLayers(['root-1', 'root-2', 'left', 'right']),
    branchingMeta: { branchSceneIndices: [1] },
    branchRenderPaths: [
      buildPath('root.1', 0, ['root-1', 'root-2', 'left']),
      buildPath('root.2', 1, ['root-1', 'root-2', 'right']),
    ],
    getLayerDescription: (layer) => layer.description,
    requestRootTransitions: async () => 'Only one transition',
    requestSceneTransition: async ({ layerId }) => {
      requestedLayerIds.push(layerId);
      return `Transition ${layerId}`;
    },
    persistTransitions: async (results) => {
      persistedResults.push(...results);
    },
  });

  await assert.rejects(
    generationPromise,
    (error) => error.code === 'BRANCHED_CAMERA_TRANSITION_INFERENCE_FAILED',
  );
  assert.deepEqual(requestedLayerIds, []);
  assert.deepEqual(
    persistedResults.slice(0, 2).map(({ layerId, status, transition }) => ({
      layerId,
      status,
      transition,
    })),
    [
      { layerId: 'root-1', status: 'FAILED', transition: '' },
      { layerId: 'root-2', status: 'FAILED', transition: '' },
    ],
  );
});

test('a failed branch wave is persisted and blocks the next traversal depth', async () => {
  const persistedLevels = [];
  const requestedLayerIds = [];
  const generationPromise = createBranchedCameraTransitions({
    layers: buildLayers(['root', 'left', 'right', 'left-leaf', 'right-leaf']),
    branchingMeta: { branchSceneIndices: [0] },
    branchRenderPaths: [
      buildPath('root.1', 0, ['root', 'left', 'left-leaf']),
      buildPath('root.2', 1, ['root', 'right', 'right-leaf']),
    ],
    getLayerDescription: (layer) => layer.description,
    requestRootTransitions: async () => 'Root transition',
    requestSceneTransition: async ({ layerId }) => {
      requestedLayerIds.push(layerId);
      return layerId === 'left' ? '' : `Transition ${layerId}`;
    },
    persistTransitions: async (results) => {
      persistedLevels.push(results.map(({ layerId, status }) => ({ layerId, status })));
    },
  });

  await assert.rejects(
    generationPromise,
    (error) => error.code === 'BRANCHED_CAMERA_TRANSITION_INFERENCE_FAILED',
  );
  assert.deepEqual(requestedLayerIds, ['left', 'right']);
  assert.deepEqual(persistedLevels.at(-1), [
    { layerId: 'left', status: 'FAILED' },
    { layerId: 'right', status: 'COMPLETED' },
  ]);
});

test('completed persisted transitions are reused while missing descendants are requested', async () => {
  const layers = buildLayers(['root', 'left', 'right']);
  layers[0].cameraTransition = 'Saved root transition';
  layers[0].cameraTransitionGenerationStatus = 'COMPLETED';
  layers[1].cameraTransition = 'Saved left transition';
  layers[1].cameraTransitionGenerationStatus = 'COMPLETED';
  const requestedLayerIds = [];
  let rootRequestCount = 0;

  const result = await createBranchedCameraTransitions({
    layers,
    branchingMeta: { branchSceneIndices: [0] },
    branchRenderPaths: [
      buildPath('root.1', 0, ['root', 'left']),
      buildPath('root.2', 1, ['root', 'right']),
    ],
    getLayerDescription: (layer) => layer.description,
    requestRootTransitions: async () => {
      rootRequestCount += 1;
      return 'Unexpected root transition';
    },
    requestSceneTransition: async ({ layerId, previousScenes }) => {
      requestedLayerIds.push(layerId);
      assert.equal(previousScenes[0].cameraTransition, 'Saved root transition');
      return 'Generated right transition';
    },
    persistTransitions: async () => {},
  });

  assert.equal(rootRequestCount, 0);
  assert.deepEqual(requestedLayerIds, ['right']);
  assert.equal(result.get('left'), 'Saved left transition');
  assert.equal(result.get('right'), 'Generated right transition');
});

test('regenerating an ancestor invalidates persisted descendant transitions', async () => {
  const layers = buildLayers(['root', 'left', 'right']);
  layers.forEach((layer) => {
    layer.cameraTransition = `Saved ${layer._id} transition`;
    layer.cameraTransitionGenerationStatus = 'COMPLETED';
  });
  layers[0].cameraTransitionGenerationStatus = 'FAILED';
  const requestedLayerIds = [];

  const result = await createBranchedCameraTransitions({
    layers,
    branchingMeta: { branchSceneIndices: [0] },
    branchRenderPaths: [
      buildPath('root.1', 0, ['root', 'left']),
      buildPath('root.2', 1, ['root', 'right']),
    ],
    getLayerDescription: (layer) => layer.description,
    requestRootTransitions: async () => 'Regenerated root transition',
    requestSceneTransition: async ({ layerId, previousScenes }) => {
      requestedLayerIds.push(layerId);
      assert.equal(previousScenes[0].cameraTransition, 'Regenerated root transition');
      return `Regenerated ${layerId} transition`;
    },
    persistTransitions: async () => {},
  });

  assert.deepEqual(requestedLayerIds, ['left', 'right']);
  assert.equal(result.get('left'), 'Regenerated left transition');
  assert.equal(result.get('right'), 'Regenerated right transition');
});

test('configured divergence prevents identical sibling scenes from extending the root batch', () => {
  const traversal = buildBranchedCameraTransitionTraversal({
    layers: buildLayers(['root', 'same-after-branch', 'left', 'right']),
    branchingMeta: { branchSceneIndices: [0] },
    branchRenderPaths: [
      buildPath('root.1', 0, ['root', 'same-after-branch', 'left']),
      buildPath('root.2', 1, ['root', 'same-after-branch', 'right']),
    ],
  });

  assert.deepEqual(traversal.rootLayerIds, ['root']);
  assert.deepEqual(
    traversal.levels.map((level) => level.map((node) => node.layerId)),
    [['same-after-branch'], ['left', 'right']],
  );
});

test('appended shared layers outside the narrative timeline are not transition nodes', () => {
  const layers = [
    { _id: 'root', branchAssetKey: 'scene:root' },
    { _id: 'left', branchAssetKey: 'scene:left' },
    { _id: 'right', branchAssetKey: 'scene:right' },
    { _id: 'outro', isGeneratedOutroLayer: true },
  ];
  const branchRenderPaths = [
    {
      ...buildPath('root.1', 0, ['root', 'left']),
      timeline: [
        { layerId: 'root', sequenceIndex: 0, assetKey: 'scene:root', sceneIndex: 0 },
        { layerId: 'left', sequenceIndex: 1, assetKey: 'scene:left', sceneIndex: 1 },
        { layerId: 'outro', sequenceIndex: 2, assetKey: null, sceneIndex: null },
      ],
    },
    {
      ...buildPath('root.2', 1, ['root', 'right']),
      timeline: [
        { layerId: 'root', sequenceIndex: 0, assetKey: 'scene:root', sceneIndex: 0 },
        { layerId: 'right', sequenceIndex: 1, assetKey: 'scene:right', sceneIndex: 1 },
        { layerId: 'outro', sequenceIndex: 2, assetKey: null, sceneIndex: null },
      ],
    },
  ];

  const traversal = buildBranchedCameraTransitionTraversal({
    layers,
    branchRenderPaths,
    branchingMeta: { branchSceneIndices: [0] },
  });

  assert.deepEqual(traversal.rootLayerIds, ['root']);
  assert.deepEqual(traversal.levels.map((level) => level.map((node) => node.layerId)), [
    ['left', 'right'],
  ]);
});

test('branch scene context includes history transitions and only one current scene', () => {
  const context = formatBranchedCameraTransitionContext({
    previousScenes: [
      { description: 'Opening landscape', cameraTransition: 'Slow push in' },
      { description: 'Hero reaches a fork', cameraTransition: 'Pan toward the fork' },
    ],
    currentSceneDescription: 'Hero follows the forest trail',
  });

  assert.match(context, /Previous scene 1 description: Opening landscape/);
  assert.match(context, /Previous scene 2 camera transition: Pan toward the fork/);
  assert.equal(context.match(/Current scene description:/g)?.length, 1);
  assert.match(context, /Current scene description: Hero follows the forest trail/);
});
