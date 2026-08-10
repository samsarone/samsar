import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const ENV_KEYS = [
  'CURRENT_ENV',
  'MONGO_URL',
  'SAMSAR_DEPLOYMENT_EDITION',
  'SAMSAR_EDITION',
  'SAMSAR_RUNTIME',
  'SAMSAR_MEDIA_DELIVERY_MODE',
  'MEDIA_DELIVERY_MODE',
  'SAMSAR_EXTERNAL_MEDIA_PUBLISH_ENABLED',
  'EXTERNAL_MEDIA_PUBLISH_ENABLED',
  'SAMSAR_MEDIA_TUNNEL_PUBLIC_URL',
  'SAMSAR_PUBLIC_MEDIA_BASE_URL',
  'SAMSAR_EXTERNAL_MEDIA_PUBLIC_BASE_URL',
  'MEDIA_PUBLIC_URL',
  'SAMSAR_INTERNAL_MEDIA_BASE_URL',
  'SAMSAR_RUNTIME_CONFIG_FILE',
  'SAMSAR_CONFIG_FILE',
  'SAMSAR_MEDIA_TUNNEL_REFRESH_WAIT_MS',
  'SAMSAR_MEDIA_TUNNEL_REFRESH_POLL_MS',
  'SAMSAR_MEDIA_TUNNEL_REFRESH_REQUEST_PATH',
  'SAMSAR_PUBLIC_MEDIA_PROBE_TIMEOUT_MS',
  'SAMSAR_ASSETS_V2_ROOT',
  'SAMSAR_ASSETS_ROOT',
  'SECURE_ASSET_PREFIX',
  'STATIC_CDN_URL',
  'PUBLIC_STATIC_CDN_URL',
  'MEDIA_BUCKET_NAME',
  'STATIC_CDN_BUCKET',
  'PUBLIC_API_BASE_URL',
  'PUBLIC_BASE_URL',
  'API_SERVER',
];

const originalFetch = globalThis.fetch;
let fixture;

function snapshotEnv() {
  return Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
}

function restoreEnv(snapshot) {
  for (const key of ENV_KEYS) {
    if (snapshot[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = snapshot[key];
    }
  }
}

function writeRuntimeConfig(publicUrl, options = {}) {
  fs.writeFileSync(fixture.configPath, JSON.stringify({
    localMediaTunnel: {
      enabled: options.enabled !== false,
      publicUrl,
    },
    publicUrls: {
      media: options.localMediaUrl || 'http://localhost:3002',
    },
    ...(options.storage ? { storage: options.storage } : {}),
  }));
}

function buildFetchResponse(url, { status = 206, contentType = 'image/png', finalUrl = url } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    url: finalUrl,
    headers: { get: (name) => name.toLowerCase() === 'content-type' ? contentType : null },
    body: { cancel: async () => {} },
  };
}

async function loadVisionMediaUrl() {
  const moduleUrl = new URL('./VisionMediaUrl.js', import.meta.url).href;
  return import(`${moduleUrl}?test=${Date.now()}-${Math.random()}`);
}

test.beforeEach(() => {
  const envSnapshot = snapshotEnv();
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'samsar-processor-vision-'));
  fixture = {
    envSnapshot,
    tempRoot,
    configPath: path.join(tempRoot, 'samsar.config.json'),
    markerPath: path.join(tempRoot, 'media-tunnel-refresh.request.json'),
  };

  process.env.CURRENT_ENV = 'docker';
  process.env.MONGO_URL = 'mongodb://test-user:test-password@mongo:27017/SamsarOne?authSource=admin';
  process.env.SAMSAR_MEDIA_DELIVERY_MODE = 'docker-local';
  process.env.MEDIA_DELIVERY_MODE = 'docker-local';
  delete process.env.SAMSAR_EXTERNAL_MEDIA_PUBLISH_ENABLED;
  delete process.env.EXTERNAL_MEDIA_PUBLISH_ENABLED;
  delete process.env.SAMSAR_MEDIA_TUNNEL_PUBLIC_URL;
  process.env.SAMSAR_PUBLIC_MEDIA_BASE_URL = 'http://localhost:3002';
  process.env.SAMSAR_EXTERNAL_MEDIA_PUBLIC_BASE_URL = 'http://localhost:3002';
  process.env.MEDIA_PUBLIC_URL = 'http://localhost:3002';
  process.env.SAMSAR_INTERNAL_MEDIA_BASE_URL = 'http://media-gateway';
  process.env.SAMSAR_RUNTIME_CONFIG_FILE = fixture.configPath;
  delete process.env.SAMSAR_CONFIG_FILE;
  process.env.SAMSAR_MEDIA_TUNNEL_REFRESH_WAIT_MS = '30';
  process.env.SAMSAR_MEDIA_TUNNEL_REFRESH_POLL_MS = '10';
  process.env.SAMSAR_MEDIA_TUNNEL_REFRESH_REQUEST_PATH = fixture.markerPath;
  process.env.SAMSAR_PUBLIC_MEDIA_PROBE_TIMEOUT_MS = '100';
  process.env.SAMSAR_ASSETS_V2_ROOT = path.join(tempRoot, 'assets_v2');
  process.env.SAMSAR_ASSETS_ROOT = path.join(tempRoot, 'assets');
  process.env.STATIC_CDN_URL = 'https://cdn.example.com/';
  process.env.PUBLIC_STATIC_CDN_URL = 'https://cdn.example.com/';
  process.env.MEDIA_BUCKET_NAME = 'processor-test-media';
  process.env.STATIC_CDN_BUCKET = 'processor-test-media';
  fs.mkdirSync(process.env.SAMSAR_ASSETS_V2_ROOT, { recursive: true });
  fs.mkdirSync(process.env.SAMSAR_ASSETS_ROOT, { recursive: true });
  writeRuntimeConfig('https://vision-fresh.trycloudflare.com');
});

test.afterEach(() => {
  globalThis.fetch = originalFetch;
  fs.rmSync(fixture.tempRoot, { recursive: true, force: true });
  restoreEnv(fixture.envSnapshot);
  fixture = null;
});

test('Docker-local vision resolves and probes the exact asset through the managed tunnel', async () => {
  const requestedUrls = [];
  globalThis.fetch = async (url) => {
    requestedUrls.push(String(url));
    return buildFetchResponse(String(url));
  };

  const { getAccessibleVisionImageUrl } = await loadVisionMediaUrl();
  const resolved = await getAccessibleVisionImageUrl(
    'http://localhost:3002/api/assets_v2/generations/session-id/frame one.png?cache=old',
  );

  assert.equal(
    resolved,
    'https://vision-fresh.trycloudflare.com/assets_v2/generations/session-id/frame%20one.png',
  );
  assert.deepEqual(requestedUrls, [resolved]);
});

test('Docker-local vision canonicalizes bare mounted-media keys under assets_v2', async () => {
  const requestedUrls = [];
  globalThis.fetch = async (url) => {
    requestedUrls.push(String(url));
    return buildFetchResponse(String(url));
  };

  const { getAccessibleVisionImageUrl } = await loadVisionMediaUrl();
  const resolved = await getAccessibleVisionImageUrl('generations/session-id/frame.png');

  assert.equal(
    resolved,
    'https://vision-fresh.trycloudflare.com/assets_v2/generations/session-id/frame.png',
  );
  assert.deepEqual(requestedUrls, [resolved]);
});

test('Docker-local provider media resolves audio and video with media-specific probes', async () => {
  const requestedUrls = [];
  globalThis.fetch = async (url) => {
    const normalizedUrl = String(url);
    requestedUrls.push(normalizedUrl);
    return buildFetchResponse(normalizedUrl, {
      contentType: normalizedUrl.endsWith('.mp3') ? 'audio/mpeg' : 'video/mp4',
    });
  };

  const { getAccessibleProviderMediaUrl } = await loadVisionMediaUrl();
  const audioUrl = await getAccessibleProviderMediaUrl(
    '/assets/avatar_voiceover/session-id/speech.mp3',
    { mediaKind: 'audio', serviceName: 'audio-provider-test' },
  );
  const videoUrl = await getAccessibleProviderMediaUrl(
    'video/session-id/source.mp4',
    { mediaKind: 'video', serviceName: 'video-provider-test' },
  );

  assert.equal(
    audioUrl,
    'https://vision-fresh.trycloudflare.com/assets/avatar_voiceover/session-id/speech.mp3',
  );
  assert.equal(
    videoUrl,
    'https://vision-fresh.trycloudflare.com/assets_v2/video/session-id/source.mp4',
  );
  assert.deepEqual(requestedUrls, [audioUrl, videoUrl]);
});

test('Docker-local provider media validates the declared data URL kind', async () => {
  const { getAccessibleProviderMediaUrl } = await loadVisionMediaUrl();
  const audioDataUrl = 'data:audio/mpeg;base64,QUJD';

  assert.equal(
    await getAccessibleProviderMediaUrl(audioDataUrl, { mediaKind: 'audio' }),
    audioDataUrl,
  );
  await assert.rejects(
    () => getAccessibleProviderMediaUrl(audioDataUrl, { mediaKind: 'video' }),
    (error) => {
      assert.equal(error?.code, 'SAMSAR_PROVIDER_MEDIA_REFERENCE_INVALID');
      assert.equal(error?.mediaKind, 'video');
      assert.equal(error?.retryable, false);
      return true;
    },
  );
});

test('Docker-local tunnel resolution prefers live runtime config over stale process env', async () => {
  const staleBase = 'https://vision-stale-env.trycloudflare.com';
  const freshBase = 'https://vision-runtime.trycloudflare.com';
  process.env.SAMSAR_MEDIA_TUNNEL_PUBLIC_URL = staleBase;
  writeRuntimeConfig(freshBase);
  const requestedUrls = [];
  globalThis.fetch = async (url) => {
    requestedUrls.push(String(url));
    return buildFetchResponse(String(url));
  };

  const { getAccessibleProviderMediaUrl } = await loadVisionMediaUrl();
  const resolved = await getAccessibleProviderMediaUrl(
    'generations/session-id/runtime-first.png',
    { mediaKind: 'image' },
  );

  assert.equal(
    resolved,
    `${freshBase}/assets_v2/generations/session-id/runtime-first.png`,
  );
  assert.deepEqual(requestedUrls, [resolved]);
});

test('production Docker prefers its stable public HTTPS origin before a dynamic tunnel', async () => {
  process.env.SAMSAR_DEPLOYMENT_EDITION = 'production';
  process.env.SAMSAR_RUNTIME = 'docker';
  process.env.CURRENT_ENV = 'production';
  process.env.PUBLIC_API_BASE_URL = 'https://processor.example.com';
  const requestedUrls = [];
  globalThis.fetch = async (url) => {
    requestedUrls.push(String(url));
    return buildFetchResponse(String(url));
  };

  const { getAccessibleProviderMediaUrl } = await loadVisionMediaUrl();
  const resolved = await getAccessibleProviderMediaUrl(
    'generations/session-id/stable-origin.png',
    { mediaKind: 'image' },
  );

  assert.equal(
    resolved,
    'https://processor.example.com/assets_v2/generations/session-id/stable-origin.png',
  );
  assert.deepEqual(requestedUrls, [resolved]);
});

test('Docker-local media namespace stays assets_v2 when SECURE_ASSET_PREFIX is customized', async () => {
  process.env.SECURE_ASSET_PREFIX = 'custom_secure_prefix';
  const requestedUrls = [];
  globalThis.fetch = async (url) => {
    requestedUrls.push(String(url));
    return buildFetchResponse(String(url));
  };

  const { getAccessibleProviderMediaUrl } = await loadVisionMediaUrl();
  const resolved = await getAccessibleProviderMediaUrl(
    'generations/session-id/fixed-namespace.png',
    { mediaKind: 'image' },
  );

  assert.equal(
    resolved,
    'https://vision-fresh.trycloudflare.com/assets_v2/generations/session-id/fixed-namespace.png',
  );
  assert.deepEqual(requestedUrls, [resolved]);
});

test('Docker-local rejects absolute paths that only embed a media-looking segment', async () => {
  let fetchCount = 0;
  globalThis.fetch = async (url) => {
    fetchCount += 1;
    return buildFetchResponse(String(url));
  };

  const { getAccessibleProviderMediaUrl } = await loadVisionMediaUrl();
  await assert.rejects(
    () => getAccessibleProviderMediaUrl(
      path.join(fixture.tempRoot, 'unmounted', 'generations', 'session-id', 'frame.png'),
      { mediaKind: 'image' },
    ),
    (error) => error?.code === 'SAMSAR_VISION_MEDIA_REFERENCE_INVALID',
  );
  assert.equal(fetchCount, 0);
});

test('Docker-local vision does not duplicate assets_v2 when the tunnel base contains that path', async () => {
  writeRuntimeConfig('https://vision-fresh.trycloudflare.com/assets_v2');
  const requestedUrls = [];
  globalThis.fetch = async (url) => {
    requestedUrls.push(String(url));
    return buildFetchResponse(String(url));
  };

  const { getAccessibleVisionImageUrl } = await loadVisionMediaUrl();
  const resolved = await getAccessibleVisionImageUrl('/assets_v2/generations/session-id/frame.png');

  assert.equal(
    resolved,
    'https://vision-fresh.trycloudflare.com/assets_v2/generations/session-id/frame.png',
  );
  assert.deepEqual(requestedUrls, [resolved]);
});

test('Docker-local vision replaces a stale tunnel and returns only the freshly probed URL', async () => {
  const staleBase = 'https://vision-stale.trycloudflare.com';
  const freshBase = 'https://vision-replacement.trycloudflare.com';
  const mediaPath = 'assets_v2/generations/session-id/frame.png';
  const mountedMediaPath = path.join(
    process.env.SAMSAR_ASSETS_V2_ROOT,
    'generations/session-id/frame.png',
  );
  fs.mkdirSync(path.dirname(mountedMediaPath), { recursive: true });
  fs.writeFileSync(mountedMediaPath, 'image');
  const requestedUrls = [];
  let refreshScheduled = false;
  writeRuntimeConfig(staleBase);
  process.env.SAMSAR_MEDIA_TUNNEL_REFRESH_WAIT_MS = '250';

  globalThis.fetch = async (url) => {
    const normalizedUrl = String(url);
    requestedUrls.push(normalizedUrl);
    if (normalizedUrl.startsWith(staleBase)) {
      if (!refreshScheduled) {
        refreshScheduled = true;
        setTimeout(() => writeRuntimeConfig(freshBase), 5);
      }
      return buildFetchResponse(normalizedUrl, { status: 502, contentType: 'text/html' });
    }
    return buildFetchResponse(normalizedUrl);
  };

  const { getAccessibleVisionImageUrl } = await loadVisionMediaUrl();
  const resolved = await getAccessibleVisionImageUrl(`https://old.trycloudflare.com/${mediaPath}`);

  assert.equal(resolved, `${freshBase}/${mediaPath}`);
  assert.equal(requestedUrls.includes(`${staleBase}/${mediaPath}`), true);
  assert.equal(requestedUrls.includes(`${freshBase}/${mediaPath}`), true);
  const marker = JSON.parse(fs.readFileSync(fixture.markerPath, 'utf8'));
  assert.equal(marker.service, 'samsar_processor_vision');
  assert.equal(marker.reason, 'exact_provider_media_url_unreachable');
  assert.equal(marker.mediaPath, mediaPath);
});

test('Docker-local vision rejects a successful non-image tunnel response', async () => {
  process.env.SAMSAR_MEDIA_TUNNEL_REFRESH_WAIT_MS = '1';
  globalThis.fetch = async (url) => buildFetchResponse(String(url), {
    status: 200,
    contentType: 'application/json',
  });

  const { getAccessibleVisionImageUrl } = await loadVisionMediaUrl();
  await assert.rejects(
    () => getAccessibleVisionImageUrl('/assets_v2/generations/session-id/frame.png'),
    (error) => {
      assert.equal(error?.code, 'SAMSAR_MEDIA_TUNNEL_UNREACHABLE');
      assert.equal(error?.retryable, true);
      return true;
    },
  );
});

test('Docker-local vision fails closed for malformed and unresolved local references', async () => {
  let fetchCount = 0;
  globalThis.fetch = async (url) => {
    fetchCount += 1;
    return buildFetchResponse(String(url));
  };

  const { getAccessibleVisionImageUrl } = await loadVisionMediaUrl();
  for (const invalidReference of [
    'http://localhost:3002/not-a-media-route/frame.png',
    'http://[malformed',
    'https://images.example.net/%ZZ/frame.png',
    '/tmp/unmounted-frame.png',
    '/assets_v2/generations/../private.png',
    '/assets_v2/%252e%252e/private.png',
    'data:text/plain;base64,bm90IGFuIGltYWdl',
  ]) {
    await assert.rejects(
      () => getAccessibleVisionImageUrl(invalidReference),
      (error) => error?.code === 'SAMSAR_VISION_MEDIA_REFERENCE_INVALID' && error?.retryable === false,
      invalidReference,
    );
  }
  assert.equal(fetchCount, 0);
});

test('Docker-local vision preserves an unowned public remote image URL', async () => {
  let fetchCount = 0;
  globalThis.fetch = async (url) => {
    fetchCount += 1;
    return buildFetchResponse(String(url));
  };

  const { getAccessibleVisionImageUrl } = await loadVisionMediaUrl();
  const publicUrl = 'https://images.example.net/reference/photo.png?version=2';
  assert.equal(await getAccessibleVisionImageUrl(publicUrl), publicUrl);
  const foreignTunnelUrl = 'https://foreign.trycloudflare.com/assets_v2/other/frame.png';
  assert.equal(await getAccessibleVisionImageUrl(foreignTunnelUrl), foreignTunnelUrl);
  const implicitHostedUrl = 'https://static.samsar.one/assets_v2/other/frame.png';
  assert.equal(await getAccessibleVisionImageUrl(implicitHostedUrl), implicitHostedUrl);
  assert.equal(fetchCount, 0);
});

test('Docker-local vision does not treat configured cloud storage delivery as a local tunnel', async () => {
  writeRuntimeConfig('https://vision-fresh.trycloudflare.com', {
    storage: {
      staticCdnUrl: 'https://configured-storage.example.com',
      mediaBucketName: 'configured-storage-bucket',
    },
  });
  let fetchCount = 0;
  globalThis.fetch = async (url) => {
    fetchCount += 1;
    return buildFetchResponse(String(url));
  };

  const { getAccessibleVisionImageUrl } = await loadVisionMediaUrl();
  const cloudUrl = 'https://configured-storage.example.com/assets_v2/generations/frame.png';
  assert.equal(await getAccessibleVisionImageUrl(cloudUrl), cloudUrl);
  assert.equal(fetchCount, 0);
});

test('hosted provider resolution preserves an external Docker tunnel asset URL', async () => {
  process.env.CURRENT_ENV = 'production';
  delete process.env.SAMSAR_MEDIA_TUNNEL_PUBLIC_URL;
  writeRuntimeConfig('', { enabled: false });
  let fetchCount = 0;
  globalThis.fetch = async (url) => {
    fetchCount += 1;
    return buildFetchResponse(String(url));
  };

  const { getAccessibleProviderMediaUrl } = await loadVisionMediaUrl();
  const publicDockerTunnelUrl =
    'https://docker-client-media.trycloudflare.com/assets_v2/generations/session/frame.png';

  assert.equal(
    await getAccessibleProviderMediaUrl(publicDockerTunnelUrl, { mediaKind: 'image' }),
    publicDockerTunnelUrl,
  );
  assert.equal(fetchCount, 0);
});

test('Docker with external S3 publishing maps owned local references to configured CDN delivery', async () => {
  process.env.SAMSAR_MEDIA_DELIVERY_MODE = 's3-cloudfront';
  process.env.MEDIA_DELIVERY_MODE = 's3-cloudfront';
  process.env.SAMSAR_EXTERNAL_MEDIA_PUBLISH_ENABLED = 'true';
  const requestedUrls = [];
  globalThis.fetch = async (url) => {
    requestedUrls.push(String(url));
    return buildFetchResponse(String(url));
  };

  const { getAccessibleVisionImageUrl } = await loadVisionMediaUrl();
  const resolved = await getAccessibleVisionImageUrl(
    'http://localhost:3002/assets_v2/generations/session-id/frame.png',
  );

  assert.equal(resolved, 'https://cdn.example.com/assets_v2/generations/session-id/frame.png');
  assert.deepEqual(requestedUrls, [resolved]);
});

test('Docker external S3 provider media fails closed without explicit bucket and CDN config', async () => {
  process.env.SAMSAR_MEDIA_DELIVERY_MODE = 's3-cloudfront';
  process.env.MEDIA_DELIVERY_MODE = 's3-cloudfront';
  process.env.SAMSAR_EXTERNAL_MEDIA_PUBLISH_ENABLED = 'true';
  delete process.env.MEDIA_BUCKET_NAME;
  delete process.env.STATIC_CDN_BUCKET;
  delete process.env.STATIC_CDN_URL;
  delete process.env.PUBLIC_STATIC_CDN_URL;

  const { getAccessibleVisionImageUrl } = await loadVisionMediaUrl();
  await assert.rejects(
    () => getAccessibleVisionImageUrl(
      'http://localhost:3002/assets_v2/generations/session-id/frame.png',
    ),
    (error) => error?.code === 'SAMSAR_VISION_MEDIA_REFERENCE_INVALID',
  );
});

test('VisionUtils resolves and rebuilds its image payload on every provider retry', async (t) => {
  t.mock.method(console, 'error', () => {});
  const { getDescriptionForImageToCreateImageList } = await import('./VisionUtils.js');
  const sourceReference = 'http://localhost:3002/assets_v2/generations/session-id/frame.png';
  const resolvedUrls = [
    'https://tunnel-one.trycloudflare.com/assets_v2/generations/session-id/frame.png',
    'https://tunnel-two.trycloudflare.com/assets_v2/generations/session-id/frame.png',
  ];
  const resolverInputs = [];
  const payloads = [];

  const result = await getDescriptionForImageToCreateImageList(sourceReference, undefined, {
    resolveImageUrl: async (value) => {
      resolverInputs.push(value);
      return resolvedUrls[resolverInputs.length - 1];
    },
    createCompletion: async (_client, payload) => {
      payloads.push(payload);
      if (payloads.length === 1) {
        const error = new Error('temporary provider failure');
        error.retryable = true;
        throw error;
      }
      return { choices: [{ message: { content: 'fresh description' } }] };
    },
    sleep: async () => {},
  });

  assert.equal(result, 'fresh description');
  assert.deepEqual(resolverInputs, [sourceReference, sourceReference]);
  assert.equal(payloads[0].messages[0].content[1].image_url.url, resolvedUrls[0]);
  assert.equal(payloads[1].messages[0].content[1].image_url.url, resolvedUrls[1]);
  assert.notEqual(payloads[0], payloads[1]);
});

test('VisionUtils keeps the canonical mounted reference for native Gemini inlineData', async () => {
  const { getDescriptionForImageToCreateImageList } = await import('./VisionUtils.js');
  const sourceReference = 'http://localhost:3002/assets_v2/generations/session-id/frame.png';
  let resolverCalled = false;
  let capturedPayload;

  const result = await getDescriptionForImageToCreateImageList(
    sourceReference,
    'gemini-3.1-pro',
    {
      resolveImageUrl: async () => {
        resolverCalled = true;
        throw new Error('Native Gemini must not create a public media tunnel.');
      },
      createCompletion: async (_client, payload) => {
        capturedPayload = payload;
        return { choices: [{ message: { content: 'inline description' } }] };
      },
    },
  );

  assert.equal(result, 'inline description');
  assert.equal(resolverCalled, false);
  assert.equal(capturedPayload.messages[0].content[1].image_url.url, sourceReference);
});

test('AdUtils refreshes every image and rebuilds the list payload on provider retry', async (t) => {
  t.mock.method(console, 'error', () => {});
  const { processThemesFromStartImages } = await import('../movie_session/ad_creator/AdUtils.js');
  const sourceReferences = [
    'http://localhost:3002/assets_v2/generations/session-id/one.png',
    'http://localhost:3002/assets_v2/generations/session-id/two.png',
  ];
  const resolverInputs = [];
  const payloads = [];

  const result = await processThemesFromStartImages(sourceReferences, undefined, {
    resolveImageUrl: async (value) => {
      resolverInputs.push(value);
      const attempt = resolverInputs.length <= sourceReferences.length ? 'one' : 'two';
      return `https://tunnel-${attempt}.trycloudflare.com/${new URL(value).pathname.replace(/^\/+/, '')}`;
    },
    createCompletion: async (_client, payload) => {
      payloads.push(payload);
      if (payloads.length === 1) {
        const error = new Error('temporary provider failure');
        error.retryable = true;
        throw error;
      }
      return { choices: [{ message: { content: 'fresh theme' } }] };
    },
    sleep: async () => {},
  });

  assert.equal(result, 'fresh theme');
  assert.deepEqual(resolverInputs, [...sourceReferences, ...sourceReferences]);
  const firstAttemptUrls = payloads[0].messages[0].content.slice(1).map((part) => part.image_url.url);
  const secondAttemptUrls = payloads[1].messages[0].content.slice(1).map((part) => part.image_url.url);
  assert.equal(firstAttemptUrls.every((url) => url.startsWith('https://tunnel-one.')), true);
  assert.equal(secondAttemptUrls.every((url) => url.startsWith('https://tunnel-two.')), true);
  assert.notEqual(payloads[0], payloads[1]);
});

test('AdUtils keeps mounted image references canonical for native Gemini inlineData', async () => {
  const { processThemesFromStartImages } = await import('../movie_session/ad_creator/AdUtils.js');
  const sourceReferences = [
    'http://localhost:3002/assets_v2/generations/session-id/one.png',
    'http://localhost:3002/assets_v2/generations/session-id/two.png',
  ];
  let resolverCalled = false;
  let capturedPayload;

  const result = await processThemesFromStartImages(sourceReferences, 'gemini-3.1-pro', {
    resolveImageUrl: async () => {
      resolverCalled = true;
      throw new Error('Native Gemini must not create a public media tunnel.');
    },
    createCompletion: async (_client, payload) => {
      capturedPayload = payload;
      return { choices: [{ message: { content: 'inline theme' } }] };
    },
  });

  assert.equal(result, 'inline theme');
  assert.equal(resolverCalled, false);
  assert.deepEqual(
    capturedPayload.messages[0].content.slice(1).map((part) => part.image_url.url),
    sourceReferences,
  );
});
