import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import React, { act } from 'react';
import { JSDOM } from 'jsdom';
import { createServer } from 'vite';

let dom;
let vite;
let createRoot;
let OnboardingWizard;
const originalFetch = globalThis.fetch;
const storageKey = 'samsar.setupWizard.session.v1';
const tokenKey = 'samsarSetupBootstrapToken';
const authFailure = {
  ok: false, authRequired: false, bootstrapAuthRequired: true,
  message: 'Open the authenticated setup URL once.',
};
const freshStatus = {
  installed: false, hasRuntimeConfig: false, setupAuthRequired: false,
  setupBootstrapAuthRequired: true, setupAuthenticated: true,
  readiness: { processor: false, client: false },
  compose: { total: 0, running: 0, containers: [] },
};
const reply = (body, status = 200) => new Response(JSON.stringify(body), { status });

before(async () => {
  dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost:8089', pretendToBeVisual: true });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  dom.window.scrollTo = () => {};
  ({ createRoot } = await import('react-dom/client'));
  vite = await createServer({
    root: fileURLToPath(new URL('.', import.meta.url)),
    server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent',
  });
  ({ default: OnboardingWizard } = await vite.ssrLoadModule('/src/components/OnboardingWizard.jsx'));
});

after(async () => {
  await vite?.close();
  dom?.window.close();
  globalThis.fetch = originalFetch;
  delete globalThis.window;
  delete globalThis.document;
  delete globalThis.IS_REACT_ACT_ENVIRONMENT;
});

async function mount(t, { state = {}, status = freshStatus, auth = () => reply({ ok: true }), start, route } = {}) {
  window.localStorage.clear();
  window.sessionStorage.clear();
  window.localStorage.setItem(tokenKey, 'fixture-bootstrap-token');
  window.sessionStorage.setItem(storageKey, JSON.stringify({
    version: 11, step: 5, maxStep: 5,
    adminConfig: { email: 'admin@example.test', password: 'fixture-password', confirmPassword: 'fixture-password' },
    ...state,
  }));
  const requests = [];
  globalThis.fetch = async (url, options = {}) => {
    requests.push({ url, options });
    if (url === '/api/setup/install-status') return reply(typeof status === 'function' ? status(options) : status);
    if (url === '/api/setup/auth/check') return auth(options);
    if (url === '/api/setup/start') return start?.(options) || reply({ id: 'fixture-run', status: 'completed', steps: [], logs: [] }, 202);
    if (route) return route(url, options);
    throw new Error(`Unexpected request: ${url}`);
  };
  const root = createRoot(document.getElementById('root'));
  await act(async () => root.render(React.createElement(OnboardingWizard)));
  t.after(async () => { await act(async () => root.unmount()); });
  return requests;
}

async function click(text) {
  const button = [...document.querySelectorAll('button')].find((item) => item.textContent === text);
  assert.ok(button, `Button exists: ${text}`);
  assert.equal(button.disabled, false);
  await act(async () => button.click());
}

test('fresh install checks bootstrap access before displaying the wizard; retry adopts another tab token', async (t) => {
  let authenticated = false;
  const requests = await mount(t, {
    status: () => ({ ...freshStatus, setupAuthenticated: authenticated }),
    auth: (options) => {
      authenticated = options.headers['x-samsar-setup-bootstrap-token'] === 'refreshed-token';
      return authenticated ? reply({ ok: true }) : reply(authFailure, 401);
    },
  });
  assert.match(document.body.textContent, /Open your authenticated setup link/);
  assert.equal(document.querySelector('input[type="password"]'), null);
  await click('Retry access');
  assert.match(document.querySelector('[role="alert"]').textContent, /authenticated setup URL/);
  window.localStorage.setItem(tokenKey, 'refreshed-token');
  await click('Retry access');
  assert.match(document.body.textContent, /Create Admin user/);
  assert.equal(document.querySelector('input[type="email"]').value, 'admin@example.test');
  assert.equal(document.querySelector('input[type="password"]').value, 'fixture-password');
  assert.equal(requests.filter(({ url }) => url === '/api/setup/start').length, 0);
});

test('admin submit sends one authenticated start request without calling an unstarted processor', async (t) => {
  const requests = await mount(t, { state: {
    credentials: { openaiApiKey: 'fixture-key' },
    setupStartError: authFailure.message,
  } });
  assert.equal(document.querySelector('[role="alert"]'), null);
  await click('Submit and Continue');
  const starts = requests.filter(({ url }) => url === '/api/setup/start');
  assert.equal(starts.length, 1);
  assert.equal(starts[0].options.headers['x-samsar-setup-bootstrap-token'], 'fixture-bootstrap-token');
  const payload = JSON.parse(starts[0].options.body);
  assert.equal(payload.admin.email, 'admin@example.test');
  assert.equal(payload.deployment.providers.openai.validation.validationMode, 'deferred_processor');
  assert.equal(requests.some(({ url }) => url.includes('/external/providers/validate')), false);
  assert.match(document.body.textContent, /Docker setup/);
});

test('expired access at submit shows the bootstrap gate and never starts deployment', async (t) => {
  const requests = await mount(t, { auth: () => reply(authFailure, 401) });
  await click('Submit and Continue');
  assert.match(document.body.textContent, /Open your authenticated setup link/);
  assert.match(document.querySelector('[role="alert"]').textContent, /authenticated setup URL/);
  assert.equal(requests.some(({ url }) => url === '/api/setup/start'), false);
});

test('provider failure at Admin returns to the visible provider error', async (t) => {
  const requests = await mount(t, { state: { credentials: { googleCredentialsJson: 'not-json' } } });
  await click('Submit and Continue');
  assert.match(document.querySelector('h2').textContent, /provider/i);
  assert.match(document.querySelector('.error-banner').textContent, /Could not validate: Google/);
  assert.equal(requests.some(({ url }) => url === '/api/setup/start'), false);
});

for (const validation of [
  { status: 'invalid', ok: false, message: 'Fal rejected the API key.' },
  { status: 'error', ok: false, message: 'Fal authentication could not be confirmed.' },
  { status: 'configured', ok: true, validationMode: 'deferred_processor' },
  { status: 'format_valid', ok: true, validationMode: 'format_only' },
]) {
  test(`fresh installer blocks Fal ${validation.status} instead of treating it as verified`, async (t) => {
    const requests = await mount(t, {
      state: { credentials: { falApiKey: 'fixture-key' } },
      route: (url, options) => {
        assert.equal(url, '/api/setup/providers/fal/validate');
        assert.equal(options.headers['x-samsar-setup-bootstrap-token'], 'fixture-bootstrap-token');
        return reply({ providers: { fal: { provider: 'fal', ...validation } } });
      },
    });
    await click('Submit and Continue');
    assert.match(document.querySelector('.error-banner').textContent, /Fal/i);
    assert.equal(requests.some(({ url }) => url === '/api/setup/start'), false);
    assert.equal(requests.some(({ url }) => url.includes('/external/providers/validate')), false);
  });
}

test('fresh installer validates Fal through the setup service before the processor is running', async (t) => {
  const requests = await mount(t, {
    state: { credentials: { falApiKey: 'fixture-key' } },
    route: (url) => {
      assert.equal(url, '/api/setup/providers/fal/validate');
      return reply({ providers: { fal: { provider: 'fal', status: 'valid', ok: true, validationMode: 'remote_queue_auth' } } });
    },
  });
  await click('Submit and Continue');
  assert.equal(requests.filter(({ url }) => url === '/api/setup/providers/fal/validate').length, 1);
  assert.equal(requests.filter(({ url }) => url === '/api/setup/start').length, 1);
  assert.equal(requests.some(({ url }) => url.includes('/external/providers/validate')), false);
});

test('mail failure at Admin returns to the visible mail error', async (t) => {
  const requests = await mount(t, {
    state: { mailConfig: { provider: 'smtp', smtpHost: 'smtp.example.test' } },
    route: (url) => {
      assert.equal(url, '/api/setup/mail/validate');
      return reply({ message: 'SMTP connection refused' }, 400);
    },
  });
  await click('Submit and Continue');
  assert.match(document.querySelector('.error-banner').textContent, /SMTP connection refused/);
  assert.equal(requests.some(({ url }) => url === '/api/setup/start'), false);
});

test('server rejection is visible and focused; user can retry', async (t) => {
  await mount(t, { start: () => reply({ message: 'Deployment cannot start: fixture rejection' }, 400) });
  await click('Submit and Continue');
  const alert = document.querySelector('[role="alert"]');
  assert.match(alert.textContent, /fixture rejection/);
  assert.equal(document.activeElement, alert);
  assert.equal([...document.querySelectorAll('button')].find((item) => item.textContent === 'Submit and Continue').disabled, false);
});

test('installed deployments retain their admin password gate', async (t) => {
  await mount(t, { status: { ...freshStatus, setupAuthRequired: true, setupBootstrapAuthRequired: false, setupAuthenticated: false } });
  assert.match(document.body.textContent, /Unlock setup actions/);
  assert.ok(document.querySelector('input[autocomplete="current-password"]'));
  assert.doesNotMatch(document.body.textContent, /Open your authenticated setup link/);
});

test('available processor still validates native credentials and reports a rejection', async (t) => {
  const requests = await mount(t, {
    state: { credentials: { openaiApiKey: 'fixture-key' } },
    status: { ...freshStatus, readiness: { processor: true } },
    route: (url) => {
      assert.equal(url, 'http://localhost:3002/external/providers/validate');
      return reply({ message: 'Invalid provider credential' }, 400);
    },
  });
  await click('Submit and Continue');
  assert.match(document.querySelector('.error-banner').textContent, /Invalid provider credential/);
  assert.equal(requests.filter(({ url }) => url.includes('/external/providers/validate')).length, 1);
  assert.equal(requests.some(({ url }) => url === '/api/setup/start'), false);
});

test('invalid admin details focus the error without making any submission request', async (t) => {
  const requests = await mount(t, { state: { adminConfig: { email: '', password: '', confirmPassword: '' } } });
  await click('Submit and Continue');
  const alert = document.querySelector('[role="alert"]');
  assert.equal(alert.textContent, 'Enter a valid admin email.');
  assert.equal(document.activeElement, alert);
  assert.deepEqual(requests.map(({ url }) => url), ['/api/setup/install-status']);
});
