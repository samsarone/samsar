import assert from 'node:assert/strict';
import test from 'node:test';

import { generateBranchingNarrativeTree } from './BranchingNarrativeTree.js';
import {
  BRANCHED_VIDEO_BRANCHING_TIMELINE_SCHEMA,
  BRANCHED_VIDEO_RENDER_PLAN_VERSION,
  buildBranchedVideoSessionPlan,
  buildBranchingTimelineFromRenderPaths,
  materializeBranchedVideoSessionPaths,
} from './BranchedVideoSessionPlan.js';

function createSourceMovieResourceList(sceneCount) {
  return {
    scenes: Array.from({ length: sceneCount }, (_unused, sceneIndex) => ({
      visual: `source scene ${sceneIndex}`,
      type: 'base',
      duration: 5,
      startTime: sceneIndex * 5,
      endTime: (sceneIndex + 1) * 5,
      speaker: '',
    })),
    sounds: Array.from({ length: sceneCount }, (_unused, sceneIndex) => ({
      sceneIndex,
      type: 'speech',
      audio: `line ${sceneIndex}`,
      duration: 5,
      startTime: sceneIndex * 5,
      endTime: (sceneIndex + 1) * 5,
      speaker: 'NARRATOR',
    })),
  };
}

function passingValidator(movieResourceList) {
  return {
    valid: true,
    errors: [],
    narrativeJson: structuredClone(movieResourceList),
  };
}

async function createTree(sceneCount, numLevels) {
  return generateBranchingNarrativeTree({
    sourceMovieResourceList: createSourceMovieResourceList(sceneCount),
    themeJson: {},
    narrativeJson: {},
    prompt: 'Create a test branching story.',
    numLevels,
    inferenceModel: 'gpt-5.6-sol',
    generateDivergencePaths: async ({ parentMovieResourceList }) => {
      const marker = parentMovieResourceList.scenes.at(-1).visual;
      return [
        { path_name: `Left ${marker}`, path_description: 'Take the left path.' },
        { path_name: `Right ${marker}`, path_description: 'Take the right path.' },
      ];
    },
    generateBranchMovieResourceList: async ({
      parentMovieResourceList,
      divergenceSceneIndex,
      divergence,
    }) => {
      const child = structuredClone(parentMovieResourceList);
      for (let index = divergenceSceneIndex + 1; index < child.scenes.length; index += 1) {
        child.scenes[index].visual = `${divergence.path_name} scene ${index}`;
        const sound = child.sounds.find((candidate) => candidate.sceneIndex === index);
        sound.audio = `${divergence.path_name} line ${index}`;
      }
      return child;
    },
    dependencies: { validateTextToVideoNarrative: passingValidator },
  });
}

test('level-one plan creates two paths and deduplicates the exact shared prefix', async () => {
  const generated = await createTree(4, 1);
  const sourceSnapshot = structuredClone(generated.movieResourceList);
  const plan = buildBranchedVideoSessionPlan(generated.movieResourceList, {
    branchingMeta: generated.branchingMeta,
    requestedDuration: 20,
    validateMovieResourceList: passingValidator,
  });

  assert.equal(plan.renderPlanVersion, BRANCHED_VIDEO_RENDER_PLAN_VERSION);
  assert.equal(plan.defaultBranchPathId, 'root.1');
  assert.deepEqual(plan.branchRenderPaths.map((path) => path.pathId), ['root.1', 'root.2']);
  assert.equal(plan.canonicalUnits.length, 6, '2 shared + 2 unique scenes per leaf');
  assert.equal(plan.cumulativeLayerDuration, 30);
  assert.equal(plan.canonicalMovieResourceList.scenes.length, 6);
  assert.equal(plan.canonicalMovieResourceList.sounds.length, 6);
  assert.equal(plan.branchRenderPaths[0].duration, 20);
  assert.deepEqual(
    plan.branchRenderPaths[0].timeline.slice(0, 2).map((item) => item.assetKey),
    plan.branchRenderPaths[1].timeline.slice(0, 2).map((item) => item.assetKey),
  );
  assert.notDeepEqual(
    plan.branchRenderPaths[0].timeline.slice(2).map((item) => item.assetKey),
    plan.branchRenderPaths[1].timeline.slice(2).map((item) => item.assetKey),
  );
  assert.deepEqual(generated.movieResourceList, sourceSnapshot, 'planning must not mutate the tree');
});

test('render plans persist the selected video model and FPS normalized timing', async () => {
  const generated = await createTree(4, 1);
  const validatorCalls = [];
  const plan = buildBranchedVideoSessionPlan(generated.movieResourceList, {
    videoGenerationModel: 'TEST_MODEL',
    framesPerSecond: 30,
    validateMovieResourceList: (movieResourceList, model, framesPerSecond) => {
      validatorCalls.push({ model, framesPerSecond });
      let offset = 0;
      const scenes = movieResourceList.scenes.map((scene) => {
        const normalized = {
          ...scene,
          duration: 6,
          startTime: offset,
          endTime: offset + 6,
        };
        offset += 6;
        return normalized;
      });
      return {
        valid: true,
        errors: [],
        narrativeJson: {
          scenes,
          sounds: movieResourceList.sounds.map((sound) => ({ ...sound, duration: 4 })),
        },
      };
    },
  });

  assert.equal(validatorCalls.length, generated.movieResourceList.nodes.length);
  assert.deepEqual(validatorCalls[0], { model: 'TEST_MODEL', framesPerSecond: 30 });
  assert.equal(plan.branchRenderPaths[0].duration, 24);
  assert.deepEqual(
    plan.branchRenderPaths[0].timeline.map((entry) => entry.duration),
    [6, 6, 6, 6],
  );
  assert.deepEqual(
    plan.branchRenderPaths[0].audioTimeline.map((entry) => entry.duration),
    [4, 4, 4, 4],
  );
});

test('level-two plan creates four deterministic leaf traversals and fourteen unique assets', async () => {
  const generated = await createTree(6, 2);
  const plan = buildBranchedVideoSessionPlan(generated.movieResourceList, {
    validateMovieResourceList: passingValidator,
  });

  assert.deepEqual(plan.branchRenderPaths.map((path) => path.pathId), [
    'root.1.1',
    'root.1.2',
    'root.2.1',
    'root.2.2',
  ]);
  assert.equal(plan.canonicalUnits.length, 14);
  assert.equal(plan.cumulativeLayerDuration, 70);
  assert.equal(plan.branchRenderPaths.every((path) => path.timeline.length === 6), true);
  assert.deepEqual(plan.branchRenderPaths[0].nodeIds, ['root', 'root.1', 'root.1.1']);
  assert.equal(plan.branchRenderPaths[0].selectionTrail.length, 2);
  assert.equal(plan.branchRenderPaths[0].selectionTrail[0].pathName.startsWith('Left'), true);
  assert.deepEqual(
    plan.branchRenderPaths[0].selectionTrail.map((choice) => choice.switchAtSeconds),
    [10, 20],
  );
  assert.equal(plan.branchRenderPaths[0].branchingHint.startsWith('Left'), true);
  assert.equal(plan.branchRenderPaths[0].branchingDescription, 'Take the left path.');
  assert.equal(plan.branchRenderPaths[0].branchPointId, 'branch-point:root.1');
  assert.equal(plan.branchRenderPaths[0].divergenceSceneIndex, 3);
  assert.equal(plan.branchRenderPaths[0].switchAtSeconds, 20);

  assert.equal(
    plan.branchingTimeline.schemaVersion,
    BRANCHED_VIDEO_BRANCHING_TIMELINE_SCHEMA,
  );
  assert.deepEqual(plan.branchingTimeline.timing, { origin: 'media', unit: 'seconds' });
  assert.equal(plan.branchingTimeline.rootNodeId, 'root');
  assert.equal(plan.branchingTimeline.defaultPathId, 'root.1.1');
  assert.deepEqual(
    plan.branchingTimeline.choicePoints.map((choicePoint) => choicePoint.parentNodeId),
    ['root', 'root.1', 'root.2'],
  );
  assert.deepEqual(plan.branchingTimeline.choicePoints[0].options[0], {
    childNodeId: 'root.1',
    branchOrdinal: 1,
    branchingHint: plan.branchRenderPaths[0].selectionTrail[0].pathName,
    description: 'Take the left path.',
    leafPathIds: ['root.1.1', 'root.1.2'],
  });

  const sharedPrefixKeys = plan.branchRenderPaths.map((path) => (
    path.timeline.slice(0, 2).map((item) => item.assetKey)
  ));
  assert.equal(sharedPrefixKeys.every((keys) => (
    assert.deepEqual(keys, sharedPrefixKeys[0]) === undefined
  )), true);
});

test('materialization installs persisted media IDs, shares prefix IDs, and adds common media', async () => {
  const generated = await createTree(4, 1);
  const plan = buildBranchedVideoSessionPlan(generated.movieResourceList, {
    validateMovieResourceList: passingValidator,
  });
  const layers = plan.canonicalMovieResourceList.scenes.map((scene, index) => ({
    _id: `layer-${index}`,
    branchAssetKey: scene.branchAssetKey,
    duration: scene.duration,
  }));
  layers.push({ _id: 'outro-layer', duration: 8, isGeneratedOutroLayer: true });
  assert.equal(
    layers.reduce((total, layer) => total + layer.duration, 0),
    plan.cumulativeLayerDuration + 8,
  );
  const audioLayers = plan.canonicalMovieResourceList.sounds.map((sound, index) => ({
    _id: `audio-${index}`,
    branchAssetKey: sound.branchAssetKey,
    branchAudioAssetKey: sound.branchAudioAssetKey,
    generationType: 'speech',
  }));
  audioLayers.push({ _id: 'music-layer', generationType: 'music' });

  const paths = materializeBranchedVideoSessionPaths(plan, { layers, audioLayers });
  assert.equal(paths.length, 2);
  assert.deepEqual(
    paths[0].timeline.slice(0, 2).map((item) => item.layerId),
    paths[1].timeline.slice(0, 2).map((item) => item.layerId),
  );
  assert.equal(paths[0].timeline.at(-1).layerId, 'outro-layer');
  assert.equal(paths[0].duration, 28);
  assert.equal(paths[0].audioTimeline.at(-1).audioLayerId, 'music-layer');
  assert.equal(paths[0].audioTimeline.at(-1).endTime, 28);
  assert.equal(paths[0].timeline.every((item) => item.frameGenerationStatus === 'INIT'), true);
});

test('compact branching timeline can be rebuilt after final path timing is retimed', async () => {
  const generated = await createTree(4, 1);
  const plan = buildBranchedVideoSessionPlan(generated.movieResourceList, {
    validateMovieResourceList: passingValidator,
  });
  const retimedPaths = structuredClone(plan.branchRenderPaths);
  retimedPaths.forEach((path) => {
    path.selectionTrail[0].switchAtSeconds = 12;
  });

  const timeline = buildBranchingTimelineFromRenderPaths({
    branchingMeta: plan.branchingMeta,
    branchRenderPaths: retimedPaths,
    defaultBranchPathId: plan.defaultBranchPathId,
  });

  assert.equal(timeline.choicePoints[0].switchAtSeconds, 12);
  assert.deepEqual(timeline.choicePoints[0].options.map((option) => option.leafPathIds), [
    ['root.1'],
    ['root.2'],
  ]);
});

test('invalid tree fails closed before creating a media plan', async () => {
  const generated = await createTree(4, 1);
  generated.movieResourceList.nodes.find((node) => node.nodeId === 'root.1')
    .scenes[0].visual = 'mutated shared prefix';
  assert.throws(
    () => buildBranchedVideoSessionPlan(generated.movieResourceList, {
      validateMovieResourceList: passingValidator,
    }),
    (error) => error.code === 'BRANCH_RENDER_PLAN_INVALID' &&
      error.status === 422 &&
      error.validationErrors.some((message) => message.includes('exact clone')),
  );
});

test('saved branching metadata must describe the same validated leaves', async () => {
  const generated = await createTree(4, 1);
  assert.throws(
    () => buildBranchedVideoSessionPlan(generated.movieResourceList, {
      branchingMeta: { ...generated.branchingMeta, leafNodeIds: ['root.1'] },
      validateMovieResourceList: passingValidator,
    }),
    (error) => error.code === 'BRANCH_RENDER_PLAN_INVALID' &&
      /branchingMeta/.test(error.message),
  );
});
