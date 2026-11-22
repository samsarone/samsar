import assert from 'node:assert/strict';
import test from 'node:test';
import mongoose from 'mongoose';
import router from './video.js';
import User from '../../schema/User.js';
import VideoSession from '../../schema/VideoSession.js';
import ExternalUserRequest from '../../schema/ExternalUserRequest.js';
import GlobalSession from '../../schema/GlobalSession.js';

test('translation route forwards either subtitle language alias before creating or charging a session', async (t) => {
  t.mock.method(mongoose, 'connect', async () => mongoose);
  t.mock.method(ExternalUserRequest, 'findOne', () => ({ populate: async () => null }));
  t.mock.method(GlobalSession, 'findOne', () => ({ select: () => ({ lean: async () => null }) }));
  t.mock.method(User, 'findById', () => ({ select: () => ({ lean: async () => ({}) }) }));
  t.mock.method(VideoSession, 'findOne', async () => ({ toObject: () => ({
    _id: 'source-session', userId: 'owner', totalDuration: 5,
    layers: [{ _id: 'layer', duration: 5, durationOffset: 0 }],
    audioLayers: [{ generationType: 'speech', connectedLayerId: 'layer', prompt: 'Hello.', duration: 5 }],
    movieResourceList: {
      scenes: [{ duration: 5 }], sounds: [{ type: 'speech', sceneIndex: 0, audio: 'Hello.', duration: 5 }],
    },
  }) }));
  const accepted = new Error('Translation validated before creation');
  accepted.status = 400;
  const creations = [];
  t.mock.method(VideoSession, 'create', async (data) => {
    creations.push(data);
    throw accepted;
  });
  t.mock.method(console, 'error', () => {});
  const previous = {
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    SAMSAR_DEPLOYMENT_EDITION: process.env.SAMSAR_DEPLOYMENT_EDITION,
  };
  process.env.OPENAI_API_KEY = 'subtitle-route-test';
  process.env.SAMSAR_DEPLOYMENT_EDITION = 'standalone';
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  const handler = router.stack.find((layer) => layer.route?.path === '/translate_video').route.stack.at(-1).handle;
  for (const key of ['subtitle_language', 'subtitleLanguage']) {
    const response = {
      status(code) { this.statusCode = code; return this; },
      json(body) { this.body = body; return this; },
    };
    await handler({ userId: 'owner', headers: {}, body: { input: {
      video_session_id: 'source-session', language: 'fr', [key]: 'ja-JP',
    } } }, response, () => {});
    assert.equal(response.statusCode, 400);
    assert.equal(response.body.message, accepted.message);
    assert.equal(creations.at(-1).enableSubtitles, true);
    assert.equal(creations.at(-1).sessionLanguage, 'fr');
    assert.equal(creations.at(-1).subtitleLanguage, 'ja');
  }
  assert.equal(creations.length, 2);
});
