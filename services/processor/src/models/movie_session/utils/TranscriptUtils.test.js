import test from 'node:test';
import assert from 'node:assert/strict';

import { validateTextToVideoNarrative } from './TranscriptUtils.js';

function createNarrativeWithSceneDurations(sceneDurations) {
  let startTime = 0;
  const scenes = sceneDurations.map((duration, sceneIndex) => {
    const scene = {
      visual: `Scene ${sceneIndex}`,
      type: 'base',
      duration,
      startTime,
      endTime: startTime + duration,
    };
    startTime = scene.endTime;
    return scene;
  });

  return { scenes, sounds: [] };
}

test('validateTextToVideoNarrative normalizes legacy none scenes to base', () => {
  const narrative = {
    scenes: [
      {
        visual: 'A product shot on a table',
        type: 'none',
        duration: 5,
        startTime: 0,
        endTime: 5,
      },
      {
        visual: 'A person speaks directly to camera',
        type: 'character',
        speaker: 'Alex',
        duration: 5,
        startTime: 5,
        endTime: 10,
      },
    ],
    sounds: [
      {
        type: 'speech',
        subType: 'character',
        actor: 'Alex',
        gender: 'M',
        sceneIndex: 1,
        audio: 'This changed my workflow.',
        duration: 3,
        startTime: 5,
        endTime: 8,
      },
    ],
  };

  const result = validateTextToVideoNarrative(narrative, 'RUNWAYML');
  assert.equal(result.valid, true);
  assert.equal(result.narrativeJson.scenes[0].type, 'base');
  assert.equal(result.narrativeJson.scenes[1].type, 'character');
  assert.equal(result.narrativeJson.sounds.length, 1);
  assert.equal(result.narrativeJson.sounds[0].sceneIndex, 1);
});

test('validateTextToVideoNarrative keeps base scenes speech-free', () => {
  const narrative = {
    scenes: [
      {
        visual: 'Wide establishing shot with many people crossing frame',
        type: 'base',
        duration: 5,
        startTime: 0,
        endTime: 5,
      },
    ],
    sounds: [
      {
        type: 'speech',
        subType: 'narration',
        actor: 'Narrator',
        sceneIndex: 0,
        audio: 'Welcome.',
        duration: 2,
        startTime: 0,
        endTime: 2,
      },
    ],
  };

  const result = validateTextToVideoNarrative(narrative, 'RUNWAYML');
  assert.equal(result.valid, true);
  assert.equal(result.narrativeJson.scenes[0].type, 'base');
  assert.equal(result.narrativeJson.sounds.length, 0);
});

test('validateTextToVideoNarrative keeps mismatched adjacent sound dropped by default', () => {
  const narrative = {
    scenes: [
      {
        visual: 'A silent robot watches the lights.',
        type: 'base',
        duration: 5,
        startTime: 0,
        endTime: 5,
      },
      {
        visual: 'A narrator describes the semantic engine waking up.',
        type: 'narration',
        speaker: 'Narrator',
        duration: 5,
        startTime: 5,
        endTime: 10,
      },
    ],
    sounds: [
      {
        type: 'speech',
        subType: 'narration',
        actor: 'Narrator',
        gender: 'F',
        sceneIndex: 0,
        audio: 'The engine awakens.',
        duration: 3,
        startTime: 5,
        endTime: 8,
      },
    ],
  };

  const result = validateTextToVideoNarrative(narrative, 'RUNWAYML');
  assert.equal(result.valid, true);
  assert.equal(result.narrativeJson.sounds.length, 0);
  assert.equal(result.repairs.adjacentSceneIndex, 0);
});

test('validateTextToVideoNarrative repairs Gemini adjacent sceneIndex underflow when next scene matches', () => {
  const narrative = {
    scenes: [
      {
        visual: 'A silent robot watches the lights.',
        type: 'base',
        duration: 5,
        startTime: 0,
        endTime: 5,
      },
      {
        visual: 'A narrator describes the semantic engine waking up.',
        type: 'narration',
        speaker: 'Narrator',
        duration: 5,
        startTime: 5,
        endTime: 10,
      },
    ],
    sounds: [
      {
        type: 'speech',
        subType: 'narration',
        actor: 'Narrator',
        gender: 'F',
        sceneIndex: 0,
        audio: 'The engine awakens.',
        duration: 3,
        startTime: 5,
        endTime: 8,
      },
    ],
  };

  const result = validateTextToVideoNarrative(narrative, 'RUNWAYML', undefined, {
    repairAdjacentSceneIndex: true,
  });
  assert.equal(result.valid, true);
  assert.equal(result.narrativeJson.sounds.length, 1);
  assert.equal(result.narrativeJson.sounds[0].sceneIndex, 1);
  assert.equal(result.narrativeJson.sounds[0].audio, 'The engine awakens.');
  assert.equal(result.repairs.adjacentSceneIndex, 1);
});

test('validateTextToVideoNarrative rejects localized character gender that conflicts with scene identity', () => {
  const narrative = {
    scenes: [
      {
        visual: 'Character close-up: 蓮 is a weary adult man holding a lantern beside a white cat.',
        type: 'character',
        speaker: '蓮',
        duration: 5,
        startTime: 0,
        endTime: 5,
      },
    ],
    sounds: [
      {
        type: 'speech',
        subType: 'character',
        actor: '蓮',
        gender: 'F',
        sceneIndex: 0,
        audio: '雪、また聞こえるのか。',
        duration: 3,
        startTime: 0,
        endTime: 3,
      },
    ],
  };

  const result = validateTextToVideoNarrative(narrative, 'RUNWAYML');
  assert.equal(result.valid, false);
  assert.match(result.errors[0], /scene 0 has gender "F".*indicates "M"/);
});

test('validateTextToVideoNarrative canonicalizes non-localized gender aliases', () => {
  const narrative = {
    scenes: [
      {
        visual: 'Character close-up: Maria is a woman speaking to camera.',
        type: 'character',
        speaker: 'Maria',
        duration: 5,
        startTime: 0,
        endTime: 5,
      },
    ],
    sounds: [
      {
        type: 'speech',
        subType: 'character',
        actor: 'Maria',
        gender: 'female',
        sceneIndex: 0,
        audio: 'This place remembers us.',
        duration: 3,
        startTime: 0,
        endTime: 3,
      },
    ],
  };

  const result = validateTextToVideoNarrative(narrative, 'RUNWAYML');
  assert.equal(result.valid, true);
  assert.equal(result.narrativeJson.sounds[0].gender, 'F');
});

test('validateTextToVideoNarrative canonicalizes Google enum-style gender values', () => {
  const narrative = {
    scenes: [
      {
        visual: 'Character close-up: Maria is a woman speaking to camera.',
        type: 'character',
        speaker: 'Maria',
        duration: 5,
        startTime: 0,
        endTime: 5,
      },
    ],
    sounds: [
      {
        type: 'speech',
        subType: 'character',
        actor: 'Maria',
        gender: { value: 'SSML_VOICE_GENDER_FEMALE' },
        sceneIndex: 0,
        audio: 'This place remembers us.',
        duration: 3,
        startTime: 0,
        endTime: 3,
      },
    ],
  };

  const result = validateTextToVideoNarrative(narrative, 'RUNWAYML');
  assert.equal(result.valid, true);
  assert.equal(result.narrativeJson.sounds[0].gender, 'F');
});

test('validateTextToVideoNarrative rejects speech and sound effect on the same scene', () => {
  const narrative = {
    scenes: [
      {
        visual: 'A woman scientist speaks from a damaged monitor while static crackles.',
        type: 'character',
        speaker: 'Dr. Aris',
        duration: 5,
        startTime: 0,
        endTime: 5,
      },
    ],
    sounds: [
      {
        type: 'speech',
        subType: 'character',
        actor: 'Dr. Aris',
        gender: 'F',
        sceneIndex: 0,
        audio: 'Trust the future.',
        duration: 3,
        startTime: 0,
        endTime: 3,
      },
      {
        type: 'sound_effect',
        sceneIndex: 0,
        audio: 'Loud electronic static.',
        duration: 5,
        startTime: 0,
        endTime: 5,
      },
    ],
  };

  const result = validateTextToVideoNarrative(narrative, 'RUNWAYML');
  assert.equal(result.valid, false);
  assert.match(result.errors[0], /both speech and sound_effect/);
});

test('validateTextToVideoNarrative backfills missing narrator gender consistently', () => {
  const narrative = {
    scenes: [
      {
        visual: 'A sweeping aerial view of the city at dawn.',
        type: 'narration',
        speaker: 'Narrator',
        duration: 5,
        startTime: 0,
        endTime: 5,
      },
    ],
    sounds: [
      {
        type: 'speech',
        subType: 'narration',
        actor: 'Narrator',
        gender: '',
        sceneIndex: 0,
        audio: 'A new day begins above the skyline.',
        duration: 3,
        startTime: 0,
        endTime: 3,
      },
    ],
  };

  const result = validateTextToVideoNarrative(narrative, 'RUNWAYML');
  assert.equal(result.valid, true);
  assert.equal(result.narrativeJson.sounds[0].gender, 'F');
});

test('validateTextToVideoNarrative backfills missing character gender from scene identity', () => {
  const narrative = {
    scenes: [
      {
        visual: 'Close-up of an adult man in a workshop speaking to camera.',
        type: 'character',
        speaker: 'Evan',
        duration: 5,
        startTime: 0,
        endTime: 5,
      },
    ],
    sounds: [
      {
        type: 'speech',
        subType: 'character',
        actor: 'Evan',
        sceneIndex: 0,
        audio: 'This is where the first prototype came alive.',
        duration: 3,
        startTime: 0,
        endTime: 3,
      },
    ],
  };

  const result = validateTextToVideoNarrative(narrative, 'RUNWAYML');
  assert.equal(result.valid, true);
  assert.equal(result.narrativeJson.sounds[0].gender, 'M');
});

test('validateTextToVideoNarrative still rejects ambiguous missing character gender', () => {
  const narrative = {
    scenes: [
      {
        visual: 'Close-up of Alex speaking to camera in a workshop.',
        type: 'character',
        speaker: 'Alex',
        duration: 5,
        startTime: 0,
        endTime: 5,
      },
    ],
    sounds: [
      {
        type: 'speech',
        subType: 'character',
        actor: 'Alex',
        sceneIndex: 0,
        audio: 'This is where the first prototype came alive.',
        duration: 3,
        startTime: 0,
        endTime: 3,
      },
    ],
  };

  const result = validateTextToVideoNarrative(narrative, 'RUNWAYML');
  assert.equal(result.valid, false);
  assert.match(result.errors[0], /scene 0 must include gender "M" or "F"/);
});

test('validateTextToVideoNarrative allows exactly 30 seconds of duration deviation', () => {
  const cases = [
    { sceneDurations: Array(10).fill(15), actualDuration: 150, deviation: -30 },
    { sceneDurations: Array(14).fill(15), actualDuration: 210, deviation: 30 },
  ];

  for (const { sceneDurations, actualDuration, deviation } of cases) {
    const result = validateTextToVideoNarrative(
      createNarrativeWithSceneDurations(sceneDurations),
      'HAPPYHORSEI2V',
      undefined,
      { requestedDuration: 180 },
    );

    assert.equal(result.valid, true, result.errors.join(', '));
    assert.deepEqual(result.duration, {
      requested: 180,
      actual: actualDuration,
      deviation,
      allowedDeviation: 30,
    });
  }
});

test('validateTextToVideoNarrative rejects duration deviation greater than 30 seconds', () => {
  const cases = [
    { sceneDurations: [...Array(9).fill(15), 10], actualDuration: 145 },
    { sceneDurations: [...Array(14).fill(15), 5], actualDuration: 215 },
  ];

  for (const { sceneDurations, actualDuration } of cases) {
    const result = validateTextToVideoNarrative(
      createNarrativeWithSceneDurations(sceneDurations),
      'HAPPYHORSEI2V',
      undefined,
      { requestedDuration: 180 },
    );

    assert.equal(result.valid, false);
    assert.match(
      result.errors.join(' '),
      new RegExp(`Narrative duration is ${actualDuration} seconds but 180 seconds were requested.*35-second deviation.*allowed 30 seconds`),
    );
  }
});

test('validateTextToVideoNarrative compares requested duration with the normalized render timeline', () => {
  const result = validateTextToVideoNarrative(
    createNarrativeWithSceneDurations([11, 11, 11, 11]),
    'HAPPYHORSEI2V',
    undefined,
    { requestedDuration: 90 },
  );

  assert.equal(result.valid, true, result.errors.join(', '));
  assert.equal(result.duration.actual, 60);
  assert.equal(result.duration.deviation, -30);
});
