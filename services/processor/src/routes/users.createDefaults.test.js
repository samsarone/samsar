import assert from 'node:assert/strict';
import test from 'node:test';
import mongoose from 'mongoose';
import User from '../schema/User.js';
import { generateAuthToken, generateExternalAuthToken } from '../models/Auth.js';
import { SYSTEM_CREATE_DEFAULTS } from '../consts/CreateDefaults.js';
import usersRouter from './users.js';

const route = (method) => usersRouter.stack.find((layer) => layer.route?.path === '/create_defaults' && layer.route.methods[method.toLowerCase()]).route.stack[0].handle;
const response = () => ({ code: 200, headers: {}, set(headers) { Object.assign(this.headers, headers); }, status(code) { this.code = code; return this; }, send(body) { this.body = body; return this; } });

function setup(t) {
  const keys = ['TOKEN_SECRET', 'SAMSAR_DEPLOYMENT_EDITION', 'SAMSAR_AVAILABLE_MODELS_PATH'];
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  process.env.TOKEN_SECRET = 'create-defaults-test-only-auth-token-secret';
  process.env.SAMSAR_DEPLOYMENT_EDITION = 'production';
  process.env.SAMSAR_AVAILABLE_MODELS_PATH = '/tmp/samsar-create-defaults-no-model-config.json';
  t.after(() => {
    for (const key of keys) previous[key] === undefined ? delete process.env[key] : (process.env[key] = previous[key]);
  });
  t.mock.method(mongoose, 'connect', async () => mongoose);
}

test('both Create defaults routes require a valid internal bearer token before reading the database', async (t) => {
  setup(t);
  const lookup = t.mock.method(User, 'findById', async () => { throw new Error('Unexpected database access'); });
  for (const method of ['GET', 'PUT']) {
    for (const token of ['', 'invalid', generateExternalAuthToken({ internalUserId: 'owner', externalUserId: 'external' })]) {
      const res = response();
      await route(method)({ method, headers: { authorization: token ? `Bearer ${token}` : '' }, body: {} }, res);
      assert.equal(res.code, 401);
      assert.match(res.headers['Cache-Control'], /no-store/);
    }
  }
  assert.equal(lookup.mock.callCount(), 0);
});

test('Create defaults persist for the authenticated account and survive a separate profile read', async (t) => {
  setup(t);
  let stored = { _id: new mongoose.Types.ObjectId(), selectedInferenceModel: 'gpt-6.2-astra', agentImageModel: 'SEEDREAM', agentVideoModel: 'RUNWAYML' };
  let saves = 0;
  t.mock.method(User, 'findById', async (id) => {
    assert.equal(id, String(stored._id));
    const doc = User.hydrate(stored);
    doc.save = async () => { await doc.validate(); saves += 1; stored = doc.toObject(); return doc; };
    return doc;
  });
  const headers = { authorization: `Bearer ${generateAuthToken(String(stored._id))}` };
  const initial = response();
  await route('GET')({ method: 'GET', headers }, initial);
  assert.equal(initial.body.createDefaults.inferenceModel, 'gpt-6.2-astra');
  assert.equal(initial.body.createDefaults.duration, 60);
  assert.equal(saves, 0);

  const saved = response();
  await route('PUT')({ method: 'PUT', headers, body: { userId: 'another-user', createDefaults: { ...SYSTEM_CREATE_DEFAULTS, duration: 30, aspectRatio: '9:16', enableSubtitles: true } } }, saved);
  assert.equal(saved.code, 200);
  assert.equal(saves, 1);
  assert.equal(stored.selectedInferenceModel, 'gpt-6.2-astra');
  assert.equal(stored.agentImageModel, 'SEEDREAM');
  assert.equal(stored.agentVideoModel, 'RUNWAYML');
  const reloaded = response();
  await route('GET')({ method: 'GET', headers }, reloaded);
  assert.deepEqual(reloaded.body, saved.body);
  assert.equal(reloaded.body.createDefaults.duration, 30);
  assert.match(reloaded.headers['Cache-Control'], /no-store/);
});

test('invalid saves return actionable validation errors and perform no write', async (t) => {
  setup(t);
  const doc = User.hydrate({ _id: new mongoose.Types.ObjectId(), createDefaults: SYSTEM_CREATE_DEFAULTS });
  const save = t.mock.method(doc, 'save', async () => doc);
  t.mock.method(User, 'findById', async () => doc);
  const res = response();
  await route('PUT')({ method: 'PUT', headers: { authorization: `Bearer ${generateAuthToken(String(doc._id))}` }, body: { createDefaults: { duration: 999 } } }, res);
  assert.equal(res.code, 400);
  assert.match(res.body.message, /duration/);
  assert.equal(save.mock.callCount(), 0);
  assert.deepEqual(doc.toObject().createDefaults, SYSTEM_CREATE_DEFAULTS);
});

test('missing accounts and database failures retain their distinct status codes', async (t) => {
  setup(t);
  const find = t.mock.method(User, 'findById', async () => null);
  const headers = { authorization: `Bearer ${generateAuthToken('owner')}` };
  const missing = response();
  await route('GET')({ method: 'GET', headers }, missing);
  assert.equal(missing.code, 404);
  find.mock.mockImplementation(async () => { throw new Error('Database unavailable'); });
  const unavailable = response();
  await route('GET')({ method: 'GET', headers }, unavailable);
  assert.equal(unavailable.code, 500);
});
