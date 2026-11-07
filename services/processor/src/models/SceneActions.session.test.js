import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
import VideoSession from '../schema/VideoSession.js';

const source = fs.readFileSync(new URL('./SceneActions.js', import.meta.url), 'utf8');
const guardedSave = vm.runInNewContext(`${source.slice(source.indexOf('async function saveAssistantSceneActionSession'))}\nsaveAssistantSceneActionSession`);

for (const version of [0, 2]) {
  test(`scene action saves use an atomic conversation predicate for version ${version}`, async (t) => {
    const session = new VideoSession({
      _id: '123456789012345678901234', assistantSessionVersion: version,
      sessionMessages: [{ role: 'assistant', content: 'Scene action result' }],
    });
    session.isNew = false;
    t.mock.method(VideoSession.collection, 'updateOne', async (filter) => {
      if (version === 0) {
        assert.equal(filter.$or[0].assistantSessionVersion, 0);
        assert.equal(filter.$or[1].assistantSessionVersion.$exists, false);
      } else {
        assert.equal(filter.assistantSessionVersion, version);
      }
      // A reset incremented the stored version, so Mongo matches no document.
      return { matchedCount: 0, modifiedCount: 0 };
    });
    await assert.rejects(guardedSave(session), { status: 409 });
  });
}
