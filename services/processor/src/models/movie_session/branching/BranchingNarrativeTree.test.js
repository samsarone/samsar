import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BRANCHING_FACTOR,
  buildBranchingMeta,
  calculateBranchSceneIndices,
  generateBranchingNarrativeTree,
  validateBranchingNarrativeTree,
} from './BranchingNarrativeTree.js';

function createSourceMovieResourceList(sceneCount = 9) {
  return {
    scenes: Array.from({ length: sceneCount }, (_unused, sceneIndex) => ({
      visual: `source scene ${sceneIndex}`,
      type: 'base',
      duration: 5,
      startTime: sceneIndex * 5,
      endTime: (sceneIndex + 1) * 5,
      speaker: '',
    })),
    sounds: [],
  };
}

function passingValidator(movieResourceList) {
  return {
    valid: true,
    errors: [],
    narrativeJson: structuredClone(movieResourceList),
  };
}

function createInferenceStubs(events, { failPlannerForParentVisual = null } = {}) {
  return {
    generateDivergencePaths: async ({ parentMovieResourceList, divergenceSceneIndex }) => {
      const parentMarker = parentMovieResourceList.scenes.at(-1).visual;
      events.push(`plan:${divergenceSceneIndex}:${parentMarker}`);
      if (failPlannerForParentVisual && parentMarker.includes(failPlannerForParentVisual)) {
        throw new Error('planned test interruption');
      }
      return [
        {
          path_name: `Left ${parentMarker}`,
          path_description: `Take the complementary left path after ${divergenceSceneIndex}.`,
        },
        {
          path_name: `Right ${parentMarker}`,
          path_description: `Take the complementary right path after ${divergenceSceneIndex}.`,
        },
      ];
    },
    generateBranchMovieResourceList: async ({
      parentMovieResourceList,
      divergenceSceneIndex,
      divergence,
    }) => {
      events.push(`child:${divergenceSceneIndex}:${divergence.path_name}`);
      const child = structuredClone(parentMovieResourceList);
      for (let sceneIndex = divergenceSceneIndex + 1;
        sceneIndex < child.scenes.length;
        sceneIndex += 1) {
        child.scenes[sceneIndex].visual =
          `${divergence.path_name} scene ${sceneIndex}`;
      }
      return child;
    },
  };
}

test('calculateBranchSceneIndices divides nine scenes into thirds for two levels', () => {
  assert.deepEqual(calculateBranchSceneIndices(9, 2), [2, 5]);
  assert.deepEqual(calculateBranchSceneIndices(4, 3), [0, 1, 2]);
  assert.deepEqual(calculateBranchSceneIndices(5, 4, { maxLevels: 4 }), [0, 1, 2, 3]);
  assert.throws(
    () => calculateBranchSceneIndices(9, 0),
    (error) => error.code === 'INVALID_BRANCHING_LEVELS' && error.status === 400,
  );
  assert.throws(
    () => calculateBranchSceneIndices(3, 3),
    (error) => error.code === 'INVALID_BRANCHING_LEVELS' && error.status === 400,
  );
});

test('generateBranchingNarrativeTree expands a deterministic full-node binary tree sequentially', async () => {
  const sourceMovieResourceList = createSourceMovieResourceList();
  const sourceSnapshot = structuredClone(sourceMovieResourceList);
  const events = [];
  const checkpoints = [];
  const inference = createInferenceStubs(events);

  const result = await generateBranchingNarrativeTree({
    sourceMovieResourceList,
    themeJson: { actors: ['A'] },
    narrativeJson: sourceMovieResourceList,
    prompt: 'Create a branching story.',
    numLevels: 2,
    inferenceModel: 'gpt-5.6-sol',
    requestedDuration: 45,
    onCheckpoint: async (checkpoint) => checkpoints.push(checkpoint),
    ...inference,
    dependencies: { validateTextToVideoNarrative: passingValidator },
  });

  assert.deepEqual(sourceMovieResourceList, sourceSnapshot, 'the source must not be mutated');
  assert.equal(result.movieResourceList.structureType, 'branched');
  assert.equal(result.movieResourceList.branchingFactor, BRANCHING_FACTOR);
  assert.deepEqual(result.movieResourceList.branchSceneIndices, [2, 5]);
  assert.deepEqual(
    result.movieResourceList.nodes.map((node) => node.nodeId),
    ['root', 'root.1', 'root.2', 'root.1.1', 'root.1.2', 'root.2.1', 'root.2.2'],
  );
  assert.equal(result.movieResourceList.branchPoints.length, 3);
  assert.equal(result.movieResourceList.nodes.length, 7);
  assert.deepEqual(result.branchingMeta.leafNodeIds, [
    'root.1.1',
    'root.1.2',
    'root.2.1',
    'root.2.2',
  ]);
  assert.equal(result.branchingMeta.nodeCount, 7);
  assert.equal(result.validation.valid, true);
  assert.equal(
    Object.prototype.hasOwnProperty.call(result.validation, 'normalizedNodeResourceLists'),
    false,
    'stored branching validation should not duplicate every node resource list',
  );

  assert.deepEqual(events.map((event) => event.split(':')[0]), [
    'plan', 'child', 'child',
    'plan', 'child', 'child',
    'plan', 'child', 'child',
  ]);
  assert.equal(events.filter((event) => event.startsWith('plan:')).length, 3);
  assert.equal(events.filter((event) => event.startsWith('child:')).length, 6);
  const expandedParents = checkpoints.filter(
    (checkpoint) => checkpoint.progress.stage === 'PARENT_EXPANDED',
  );
  assert.equal(expandedParents.length, 3);
  assert.deepEqual(
    expandedParents.map((checkpoint) => checkpoint.progress.parentNodeId),
    ['root', 'root.1', 'root.2'],
  );

  const root = result.movieResourceList.nodes[0];
  const levelOneChild = result.movieResourceList.nodes[1];
  const levelTwoChild = result.movieResourceList.nodes[3];
  assert.deepEqual(levelOneChild.scenes.slice(0, 3), root.scenes.slice(0, 3));
  assert.deepEqual(levelTwoChild.scenes.slice(0, 6), levelOneChild.scenes.slice(0, 6));
});

test('generateBranchingNarrativeTree rejects a child that changes the immutable prefix', async () => {
  const sourceMovieResourceList = createSourceMovieResourceList();

  await assert.rejects(
    generateBranchingNarrativeTree({
      sourceMovieResourceList,
      themeJson: {},
      prompt: 'Create a branch.',
      numLevels: 1,
      inferenceModel: 'gpt-5.6-sol',
      generateDivergencePaths: async () => [
        { path_name: 'Left', path_description: 'Go left.' },
        { path_name: 'Right', path_description: 'Go right.' },
      ],
      generateBranchMovieResourceList: async ({ parentMovieResourceList }) => {
        const child = structuredClone(parentMovieResourceList);
        child.scenes[0].visual = 'illegally changed prefix';
        return child;
      },
      dependencies: { validateTextToVideoNarrative: passingValidator },
    }),
    (error) => {
      assert.equal(error.code, 'BRANCH_PREFIX_MISMATCH');
      assert.equal(error.status, 502);
      assert.match(error.message, /exact clone/);
      return true;
    },
  );
});

test('generateBranchingNarrativeTree fails closed when a child movie resource list is invalid', async () => {
  const sourceMovieResourceList = createSourceMovieResourceList();
  let validationCount = 0;

  await assert.rejects(
    generateBranchingNarrativeTree({
      sourceMovieResourceList,
      themeJson: {},
      prompt: 'Create a branch.',
      numLevels: 1,
      inferenceModel: 'gpt-5.6-sol',
      generateDivergencePaths: async () => [
        { path_name: 'Left', path_description: 'Go left.' },
        { path_name: 'Right', path_description: 'Go right.' },
      ],
      generateBranchMovieResourceList: async ({
        parentMovieResourceList,
        divergenceSceneIndex,
      }) => {
        const child = structuredClone(parentMovieResourceList);
        child.scenes[divergenceSceneIndex + 1].visual = '';
        return child;
      },
      dependencies: {
        validateTextToVideoNarrative: (movieResourceList) => {
          validationCount += 1;
          return validationCount === 1
            ? passingValidator(movieResourceList)
            : {
              valid: false,
              errors: ['Scene visual is blank.'],
              narrativeJson: movieResourceList,
            };
        },
      },
    }),
    (error) => {
      assert.equal(error.code, 'BRANCH_MOVIE_RESOURCE_LIST_VALIDATION_FAILED');
      assert.deepEqual(error.validationErrors, ['Scene visual is blank.']);
      return true;
    },
  );
});

test('existing checkpoints skip completed parent expansion and resume the remaining level', async () => {
  const sourceMovieResourceList = createSourceMovieResourceList();
  const firstRunEvents = [];
  const persistedCheckpoints = [];
  const interruptedInference = createInferenceStubs(firstRunEvents, {
    failPlannerForParentVisual: 'Left source scene 8',
  });

  await assert.rejects(
    generateBranchingNarrativeTree({
      sourceMovieResourceList,
      themeJson: {},
      prompt: 'Create a branch.',
      numLevels: 2,
      inferenceModel: 'gpt-5.6-sol',
      ...interruptedInference,
      onCheckpoint: (checkpoint) => persistedCheckpoints.push(checkpoint),
      dependencies: { validateTextToVideoNarrative: passingValidator },
    }),
    /planned test interruption/,
  );

  const rootExpandedCheckpoint = persistedCheckpoints.findLast((checkpoint) => (
    checkpoint.progress.stage === 'PARENT_EXPANDED' &&
    checkpoint.progress.parentNodeId === 'root'
  ));
  assert.ok(rootExpandedCheckpoint);
  assert.equal(rootExpandedCheckpoint.movieResourceList.nodes.length, 3);

  const resumedEvents = [];
  const resumed = await generateBranchingNarrativeTree({
    sourceMovieResourceList,
    themeJson: {},
    prompt: 'Create a branch.',
    numLevels: 2,
    inferenceModel: 'gpt-5.6-sol',
    existingCheckpoint: rootExpandedCheckpoint,
    ...createInferenceStubs(resumedEvents),
    dependencies: { validateTextToVideoNarrative: passingValidator },
  });

  assert.equal(resumed.validation.valid, true);
  assert.equal(resumed.movieResourceList.nodes.length, 7);
  assert.equal(resumedEvents.filter((event) => event.startsWith('plan:')).length, 2);
  assert.equal(resumedEvents.filter((event) => event.startsWith('child:')).length, 4);
  assert.ok(resumedEvents.every((event) => !event.endsWith(':source scene 8')));
});

test('validateBranchingNarrativeTree catches graph and prefix corruption', async () => {
  const events = [];
  const result = await generateBranchingNarrativeTree({
    sourceMovieResourceList: createSourceMovieResourceList(),
    themeJson: {},
    prompt: 'Create a branch.',
    numLevels: 1,
    inferenceModel: 'gpt-5.6-sol',
    ...createInferenceStubs(events),
    dependencies: { validateTextToVideoNarrative: passingValidator },
  });
  const corrupted = structuredClone(result.movieResourceList);
  corrupted.nodes[1].scenes[0].visual = 'corrupted prefix';
  corrupted.nodes[1].scenes.at(-1).duration = 10;
  corrupted.nodes[2].scenes = structuredClone(corrupted.nodes[1].scenes);
  corrupted.nodes[2].sounds = structuredClone(corrupted.nodes[1].sounds);
  corrupted.nodes[0].childNodeIds.reverse();

  const validation = validateBranchingNarrativeTree(corrupted, {
    requestedDuration: 45,
    validateMovieResourceList: passingValidator,
  });

  assert.equal(validation.valid, false);
  assert.ok(validation.errors.some((error) => error.includes('exact clone')));
  assert.ok(validation.errors.some((error) => error.includes('retain parent duration')));
  assert.ok(validation.errors.some((error) => error.includes('distinct resource lists')));
  assert.ok(validation.errors.some((error) => error.includes('match childNodeIds')));
  assert.deepEqual(buildBranchingMeta(result.movieResourceList), result.branchingMeta);
});
