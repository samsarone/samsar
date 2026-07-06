import test from 'node:test';
import assert from 'node:assert/strict';

import { stripSoundEffectsFromMovieResourceList } from './SanitizeMovieResourceList.js';

test('stripSoundEffectsFromMovieResourceList removes sound_effect narrative', () => {
  const input = {
    scenes: [
      { type: 'narration', speaker: 'Narrator', visual: 'Scene 1' },
      { type: 'sound_effect', speaker: 'Should clear', visual: 'Scene 2' },
      { type: 'character', speaker: 'Alex', visual: 'Scene 3' },
    ],
    sounds: [
      { type: 'speech', subType: 'narration', sceneIndex: 0, audio: 'Hello' },
      { type: 'sound_effect', sceneIndex: 1, audio: 'Boom' },
      { type: 'speech', subType: 'character', sceneIndex: 2, actor: 'Alex', audio: 'Hey' },
    ],
    other: { keep: true },
  };

  const output = stripSoundEffectsFromMovieResourceList(input);

  assert.equal(output.scenes.length, 3);
  assert.equal(output.scenes[1].type, 'base');
  assert.equal(output.scenes[1].speaker, '');
  assert.equal(output.sounds.length, 2);
  assert.ok(output.sounds.every((sound) => sound.type !== 'sound_effect'));
  assert.deepEqual(output.other, input.other);
});
