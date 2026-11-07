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
let fixtureFetch = () => { throw new Error('Unexpected request before the fixture is mounted'); };
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
  // SamsarClient captures fetch when the wizard module loads. Keep one
  // dispatcher so its requests use the current fixture alongside direct fetch.
  globalThis.fetch = (...args) => fixtureFetch(...args);
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

async function mount(t, {
  state = {}, status = freshStatus, auth = () => reply({ ok: true }), start, route,
  initialToken = 'fixture-bootstrap-token', persistState = true, blockStorage = false,
} = {}) {
  window.localStorage.clear();
  window.sessionStorage.clear();
  window.history.replaceState(null, '', '/');
  if (initialToken) window.localStorage.setItem(tokenKey, initialToken);
  if (persistState) window.sessionStorage.setItem(storageKey, JSON.stringify({
    version: 11, step: 5, maxStep: 5,
    adminConfig: { email: 'admin@example.test', password: 'fixture-password', confirmPassword: 'fixture-password' },
    ...state,
  }));
  const storageDescriptors = new Map();
  if (blockStorage) {
    for (const name of ['localStorage', 'sessionStorage']) {
      storageDescriptors.set(name, Object.getOwnPropertyDescriptor(window, name));
      Object.defineProperty(window, name, {
        configurable: true,
        get() { throw new Error('Browser storage is unavailable'); },
      });
    }
  }
  const requests = [];
  fixtureFetch = async (url, options = {}) => {
    requests.push({ url, options });
    if (url === '/api/setup/install-status') return reply(typeof status === 'function' ? status(options) : status);
    if (url === '/api/setup/auth/check') return auth(options);
    if (url === '/api/setup/start') return start?.(options) || reply({ id: 'fixture-run', status: 'completed', steps: [], logs: [] }, 202);
    if (route) return route(url, options);
    throw new Error(`Unexpected request: ${url}`);
  };
  const root = createRoot(document.getElementById('root'));
  t.after(async () => {
    try {
      await act(async () => root.unmount());
    } finally {
      for (const [name, descriptor] of storageDescriptors) Object.defineProperty(window, name, descriptor);
    }
  });
  await act(async () => root.render(React.createElement(OnboardingWizard)));
  return requests;
}

async function click(text) {
  const button = [...document.querySelectorAll('button')].find((item) => item.textContent === text);
  assert.ok(button, `Button exists: ${text}`);
  assert.equal(button.disabled, false);
  await act(async () => button.click());
}

async function fillProviderInput(id, value) {
  const input = document.getElementById(id);
  assert.ok(input, `Credential input exists: ${id}`);
  await act(async () => {
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(input, value);
    input.dispatchEvent(new window.Event('input', { bubbles: true }));
  });
}

test('provider cards keep models behind accessible tooltips and expose key actions', async (t) => {
  await mount(t, { state: { step: 1, maxStep: 1 } });
  assert.equal(document.querySelectorAll('.provider-row').length, 11);
  assert.equal(document.querySelectorAll('.provider-key-link').length, 11);
  for (const link of document.querySelectorAll('.provider-key-link')) {
    assert.match(link.href, /^https:\/\//);
    assert.match(link.textContent, /Get API key/);
  }
  assert.equal(document.querySelector('.provider-model-popover'), null);
  assert.equal(document.querySelector('.provider-model-chip'), null);
  const trigger = document.querySelector('[aria-label="Models for OpenAI"]');
  await act(async () => trigger.focus());
  assert.equal(trigger.getAttribute('aria-expanded'), 'true');
  assert.match(document.getElementById('openai-models').textContent, /GPT 6\.1 Sol/);
  await act(async () => trigger.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
  assert.equal(document.querySelector('.provider-model-popover'), null);
  await act(async () => trigger.click());
  assert.ok(document.getElementById('openai-models'));
  await act(async () => document.body.dispatchEvent(new window.Event('pointerdown', { bubbles: true })));
  assert.equal(document.querySelector('.provider-model-popover'), null);
  const tooltip = trigger.closest('.provider-model-tooltip');
  tooltip.getBoundingClientRect = () => ({ top: 600, bottom: 632 });
  await act(async () => trigger.dispatchEvent(new window.MouseEvent('pointerover', { bubbles: true })));
  assert.ok(document.querySelector('.provider-model-popover-above'));
  await act(async () => trigger.dispatchEvent(new window.MouseEvent('pointerout', { bubbles: true, relatedTarget: document.body })));
  assert.equal(document.querySelector('.provider-model-popover'), null);

  await act(async () => document.querySelector('#provider-group-inference .provider-drawer-header').click());
  assert.equal(document.getElementById('openai-credential'), null);
  await act(async () => document.querySelector('a[href="#provider-group-inference"]').click());
  assert.ok(document.getElementById('openai-credential'));
});

test('Samsar capability hint appears on entry and clears on removal without validating automatically', async (t) => {
  const requests = await mount(t, { state: { step: 1, maxStep: 1 } });
  const next = document.querySelector('.provider-continue');
  assert.equal(next.classList.contains('is-ready'), false);
  await fillProviderInput('samsar-credential', 'fixture-key');
  assert.equal(next.classList.contains('is-ready'), true);
  assert.match(document.getElementById('provider-readiness').textContent, /Continue to check your keys/);
  await fillProviderInput('samsar-credential', '');
  assert.equal(next.classList.contains('is-ready'), false);
  await act(async () => [...document.querySelectorAll('button')].find((button) => button.textContent.startsWith('Bash environment')).click());
  assert.equal(next.classList.contains('is-ready'), false);
  await fillProviderInput('samsar-credential', '$SAMSAR_API_KEY');
  assert.equal(document.getElementById('samsar-credential').type, 'text');
  assert.equal(next.classList.contains('is-ready'), true);
  assert.deepEqual(requests.map(({ url }) => url), ['/api/setup/install-status']);
});

test('inference and media keys together highlight Continue but either alone does not', async (t) => {
  await mount(t, { state: { step: 1, maxStep: 1 } });
  const next = document.querySelector('.provider-continue');
  await fillProviderInput('openrouter-credential', 'fixture-inference');
  assert.equal(next.classList.contains('is-ready'), false);
  await fillProviderInput('fal-credential', 'fixture-media');
  assert.equal(next.classList.contains('is-ready'), true);
  await fillProviderInput('openrouter-credential', '');
  assert.equal(next.classList.contains('is-ready'), false);
});

test('music-only Google keys do not advertise inference or complete a media-only setup', async (t) => {
  await mount(t, { state: { step: 1, maxStep: 1 } });
  await fillProviderInput('google-lyria-gemini-key', 'fixture-music');
  await fillProviderInput('fal-credential', 'fixture-media');
  assert.equal(document.querySelector('.provider-continue').classList.contains('is-ready'), false);
  await act(async () => document.querySelector('[aria-label="Models for Google Cloud / Gemini"]').click());
  const models = document.getElementById('googleCloud-models');
  assert.equal(models.querySelectorAll('li').length, 1);
  assert.equal(models.querySelector('li').textContent, 'Lyria 3.5');
  await fillProviderInput('openrouter-credential', 'fixture-inference');
  assert.equal(document.querySelector('.provider-continue').classList.contains('is-ready'), true);
});

test('GMICloud waits for discovery instead of promising unverified model coverage', async (t) => {
  await mount(t, { state: { step: 1, maxStep: 1 } });
  await fillProviderInput('gmicloud-credential', 'fixture-gmi');
  await act(async () => document.querySelector('[aria-label="Models for GMICloud via GenBlaze"]').click());
  const models = document.getElementById('gmicloud-models');
  assert.match(models.textContent, /discovered when you continue/);
  assert.equal(models.querySelector('li'), null);
  assert.equal(document.querySelector('.provider-continue').classList.contains('is-ready'), false);
});

test('GMICloud tooltip shows discovered supported routes and excludes incomplete inference routes', async (t) => {
  await mount(t, { state: {
    step: 1, maxStep: 1, credentials: { gmiCloudApiKey: 'fixture-gmi' },
    validationResult: {
      providers: { gmicloud: { ok: true, modelMappings: {
        SEEDREAM: { image: { modelId: 'fixture-seedream' } },
        'gpt-6-astra': { text: { modelId: 'fixture-text-without-vision' } },
        UNKNOWN: { video: { modelId: 'unsupported-model' } },
      } } },
      available: { models: ['SEEDREAM'], actions: ['image'], providers: ['gmicloud'] },
    },
  } });
  await act(async () => document.querySelector('[aria-label="Models for GMICloud via GenBlaze"]').click());
  const names = [...document.querySelectorAll('#gmicloud-models li')].map((item) => item.textContent);
  assert.equal(names.length, 1);
  assert.match(names[0], /Seedream/);
});

test('a rejected key removes the ready hint and keeps the user on Providers', async (t) => {
  await mount(t, {
    state: { step: 1, maxStep: 1 },
    route: () => reply({ message: 'Invalid API key', valid: false }, 401),
  });
  await fillProviderInput('samsar-credential', 'fixture-invalid');
  assert.equal(document.querySelector('.provider-continue').classList.contains('is-ready'), true);
  await act(async () => document.querySelector('.provider-continue').click());
  assert.equal(document.querySelector('.provider-continue').classList.contains('is-ready'), false);
  assert.match(document.querySelector('.error-banner').textContent, /Could not validate: Samsar API/);
  assert.equal(document.querySelector('.panel-header h2').textContent, 'Connect your AI providers');
});

for (const initialToken of [null, 'stale-bootstrap-token']) {
  test(`fresh local setup automatically acquires access from a bare URL with ${initialToken ? 'a stale' : 'no'} browser token`, async (t) => {
    const requests = await mount(t, {
      initialToken,
      persistState: false,
      status: (options) => ({
        ...freshStatus,
        setupLocalBootstrapAvailable: true,
        setupAuthenticated: options.headers['x-samsar-setup-bootstrap-token'] === 'local-bootstrap-token',
      }),
      route: (url, options) => {
        assert.equal(url, '/api/setup/auth/bootstrap');
        assert.equal(options.cache, 'no-store');
        return reply({ ok: true, bootstrapToken: 'local-bootstrap-token' });
      },
    });
    assert.equal(window.location.hash, '');
    assert.match(document.querySelector('h2').textContent, /Connect your AI providers/);
    assert.doesNotMatch(document.body.textContent, /Open your authenticated setup link|Unlock setup actions/);
    assert.equal(window.localStorage.getItem(tokenKey), 'local-bootstrap-token');
    assert.deepEqual(requests.map(({ url }) => url), [
      '/api/setup/install-status', '/api/setup/auth/bootstrap', '/api/setup/install-status',
    ]);
    assert.equal(requests[2].options.headers['x-samsar-setup-bootstrap-token'], 'local-bootstrap-token');
  });
}

test('fresh local setup keeps acquired access in memory when browser storage is unavailable', async (t) => {
  const requests = await mount(t, {
    initialToken: null,
    persistState: false,
    blockStorage: true,
    status: (options) => ({
      ...freshStatus,
      setupLocalBootstrapAvailable: true,
      setupAuthenticated: options.headers['x-samsar-setup-bootstrap-token'] === 'memory-bootstrap-token',
    }),
    route: (url) => {
      if (url === '/api/setup/auth/bootstrap') return reply({ ok: true, bootstrapToken: 'memory-bootstrap-token' });
      assert.equal(url, '/api/setup/reset');
      return reply({ message: 'Fixture reset stopped after checking authentication.' }, 400);
    },
  });
  assert.match(document.querySelector('h2').textContent, /Connect your AI providers/);
  assert.equal(requests[2].options.headers['x-samsar-setup-bootstrap-token'], 'memory-bootstrap-token');
  await act(async () => document.querySelector('[aria-label="Reset setup"]').click());
  await click('Reset');
  const reset = requests.find(({ url }) => url === '/api/setup/reset');
  assert.equal(reset.options.headers['x-samsar-setup-bootstrap-token'], 'memory-bootstrap-token');
});

test('failed automatic local bootstrap retains the access gate without starting deployment', async (t) => {
  const requests = await mount(t, {
    initialToken: null,
    status: { ...freshStatus, setupLocalBootstrapAvailable: true, setupAuthenticated: false },
    route: (url) => {
      assert.equal(url, '/api/setup/auth/bootstrap');
      return reply({ ok: false }, 403);
    },
  });
  assert.match(document.body.textContent, /Open your authenticated setup link/);
  assert.equal(requests.some(({ url }) => url === '/api/setup/start'), false);
});

test('retry access recovers a transient local bootstrap failure without reloading the page', async (t) => {
  let bootstrapAttempts = 0;
  const requests = await mount(t, {
    initialToken: null,
    status: (options) => ({
      ...freshStatus,
      setupLocalBootstrapAvailable: true,
      setupAuthenticated: options.headers['x-samsar-setup-bootstrap-token'] === 'recovered-bootstrap-token',
    }),
    route: (url) => {
      assert.equal(url, '/api/setup/auth/bootstrap');
      bootstrapAttempts += 1;
      return bootstrapAttempts === 1
        ? reply({ ok: false }, 503)
        : reply({ ok: true, bootstrapToken: 'recovered-bootstrap-token' });
    },
  });
  assert.match(document.body.textContent, /Open your authenticated setup link/);
  await click('Retry access');
  assert.equal(bootstrapAttempts, 2);
  assert.match(document.body.textContent, /Create Admin user/);
  assert.doesNotMatch(document.body.textContent, /Open your authenticated setup link/);
  assert.equal(window.localStorage.getItem(tokenKey), 'recovered-bootstrap-token');
  assert.equal(requests.some(({ url }) => url === '/api/setup/auth/check' || url === '/api/setup/start'), false);
});

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
