import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import http from 'http';
import os from 'os';
import path from 'path';

import { buildAvatarImagePrompt, __testOnly__ } from '../../models/AvatarVoiceover.js';
import { buildNarratorAvatarImagePrompt } from '../../models/movie_session/image_list_to_video/SessionRequestBuilder.js';
import { EXPRESS_VIDEO_IMAGE_MODEL_KEYS } from '../../consts/ExpressVideoModelOptions.js';

const AUDIO_AVAILABILITY_ENV_KEYS = [
  'SAMSAR_DOCKER_AUDIO_PROVIDER_ROUTING_ENABLED',
  'SAMSAR_AVAILABLE_MODELS_PATH',
  'SAMSAR_GENBLAZE_ENABLED',
  'SAMSAR_GENBLAZE_MODEL_CATALOG_PATH',
  'OPENAI_API_KEY',
  'FAL_API_KEY',
  'ELEVENLABS_API_KEY',
  'ELEVENLABS_API_TOKEN',
  'SAMSAR_API_KEY',
  'GOOGLE_APPLICATION_CREDENTIALS_JSON_B64',
  'GOOGLE_APPLICATION_CREDENTIALS_JSON',
  'GOOGLE_APPLICATION_CREDENTIALS',
  'GOOGLE_CLOUD_PROJECT',
  'GOOGLE_PROJECT_ID',
  'GCP_PROJECT',
  'GCLOUD_PROJECT',
  'PROJECT_ID',
  'K_SERVICE',
  'GAE_SERVICE',
  'FUNCTION_TARGET',
  'GCE_METADATA_HOST',
];

function configureIsolatedAvatarAudioAvailability(context, {
  providers = [],
  ttsProviders = [],
  genBlazeModels = null,
} = {}) {
  const previousEnvironment = Object.fromEntries(
    AUDIO_AVAILABILITY_ENV_KEYS.map((key) => [key, process.env[key]]),
  );
  const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'avatar-audio-availability-'));
  const availableModelsPath = path.join(tempDirectory, 'available-models.json');
  fs.writeFileSync(availableModelsPath, JSON.stringify({
    providers,
    models: [],
    actions: [],
    audio: {
      providers,
      ttsProviders,
      musicProviders: [],
      soundEffectProviders: [],
      source: 'docker-audio-provider-config',
    },
  }));

  AUDIO_AVAILABILITY_ENV_KEYS.forEach((key) => delete process.env[key]);
  process.env.SAMSAR_DOCKER_AUDIO_PROVIDER_ROUTING_ENABLED = 'true';
  process.env.SAMSAR_AVAILABLE_MODELS_PATH = availableModelsPath;
  if (genBlazeModels) {
    const genBlazeCatalogPath = path.join(tempDirectory, 'genblaze-model-catalog.json');
    fs.writeFileSync(genBlazeCatalogPath, JSON.stringify({
      version: 1,
      provider: 'gmicloud',
      models: genBlazeModels,
    }));
    process.env.SAMSAR_GENBLAZE_ENABLED = 'true';
    process.env.SAMSAR_GENBLAZE_MODEL_CATALOG_PATH = genBlazeCatalogPath;
  }
  context.after(() => {
    for (const key of AUDIO_AVAILABILITY_ENV_KEYS) {
      if (previousEnvironment[key] === undefined) delete process.env[key];
      else process.env[key] = previousEnvironment[key];
    }
    fs.rmSync(tempDirectory, { recursive: true, force: true });
  });
}

test('avatar image model defaults to GPT Image 2', () => {
  assert.equal(__testOnly__.resolveAvatarImageModel({}), 'GPTIMAGE2');
  assert.equal(__testOnly__.resolveAvatarImageModel({ imageModel: '  ' }), 'GPTIMAGE2');
});

test('avatar image model accepts every configured Express image model', () => {
  const envKeys = [
    'CURRENT_ENV',
    'SAMSAR_DEPLOYMENT_EDITION',
    'SAMSAR_RUNTIME',
    'ALIBABA_API_KEY',
    'ALIBABA_API_KEY_TYPE',
    'ALIBABA_API_ENDPOINT_TYPE',
  ];
  const originalEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
  try {
    process.env.CURRENT_ENV = 'standalone';
    process.env.SAMSAR_DEPLOYMENT_EDITION = 'standalone';
    process.env.SAMSAR_RUNTIME = 'docker';
    process.env.ALIBABA_API_KEY = 'test-only-alibaba-key';
    process.env.ALIBABA_API_KEY_TYPE = 'pay_as_you_go';
    process.env.ALIBABA_API_ENDPOINT_TYPE = 'pay_as_you_go';

    for (const imageModel of EXPRESS_VIDEO_IMAGE_MODEL_KEYS) {
      assert.equal(__testOnly__.resolveAvatarImageModel({ imageModel }), imageModel);
    }
  } finally {
    for (const key of envKeys) {
      if (originalEnv[key] === undefined) delete process.env[key];
      else process.env[key] = originalEnv[key];
    }
  }
});

test('avatar image model rejects models outside the Express image configuration', () => {
  assert.throws(
    () => __testOnly__.resolveAvatarImageModel({ imageModel: 'DALLE3' }),
    /not supported for this type/i
  );
  assert.throws(
    () => __testOnly__.resolveAvatarImageModel({ imageModel: 'NOT_A_MODEL' }),
    /invalid image model/i
  );
});

test('avatar voiceover prompt requests square black-background avatar images', () => {
  const prompt = buildAvatarImagePrompt('confident presenter');
  assert.match(prompt, /landscape 16:9/i);
  assert.match(prompt, /solid black background/i);
  assert.match(prompt, /centered/i);
  assert.match(prompt, /do not use a white background or transparent background/i);
});

test('avatar retrieval rebuilds protected image keys through media delivery', () => {
  const serializedTask = __testOnly__.serializeAvatarVoiceoverTask({
    avatarImage: '/assets_v2/generations/session_123/avatar.png',
    avatarImageUrl: '/assets_v2/generations/session_123/avatar.png',
  });
  const avatarUrl = new URL(serializedTask.avatarImageUrl);

  assert.equal(serializedTask.avatarImage, 'assets_v2/generations/session_123/avatar.png');
  assert.equal(avatarUrl.pathname, '/assets_v2/generations/session_123/avatar.png');
});

test('avatar speech rejects unavailable standalone providers before generation is queued', (context) => {
  configureIsolatedAvatarAudioAvailability(context, {
    providers: ['gmicloud'],
    ttsProviders: ['ELEVENLABS'],
    genBlazeModels: {
      ELEVENLABS: {
        audio: {
          modelId: 'elevenlabs-tts-multilingual-v2',
          operation: 'audio.generate',
        },
      },
    },
  });

  assert.doesNotThrow(() => (
    __testOnly__.assertAvatarSpeechProviderAvailable('ELEVENLABS')
  ));
  assert.throws(
    () => __testOnly__.assertAvatarSpeechProviderAvailable('OPENAI'),
    (error) => (
      error?.code === 'DOCKER_AUDIO_PROVIDER_UNAVAILABLE' && error?.status === 400
    ),
  );
});

test('avatar status reports only effective standalone TTS providers', (context) => {
  configureIsolatedAvatarAudioAvailability(context, {
    providers: ['gmicloud'],
    ttsProviders: ['ELEVENLABS'],
    genBlazeModels: {
      ELEVENLABS: {
        audio: {
          modelId: 'elevenlabs-tts-multilingual-v2',
          operation: 'audio.generate',
        },
      },
    },
  });

  const expectedProviders = [
    { value: 'ELEVENLABS', label: 'ElevenLabs' },
    { value: 'CUSTOM_TEXT_TO_SPEECH', label: 'Custom TTS' },
  ];
  assert.deepEqual(
    __testOnly__.getAvailableAvatarVoiceoverTTSProviders(),
    expectedProviders,
  );
  assert.deepEqual(
    __testOnly__.serializeAvatarVoiceoverTask({}).ttsProviders,
    expectedProviders,
  );
});

test('avatar status preserves Fal-backed ElevenLabs and PlayAI providers', (context) => {
  configureIsolatedAvatarAudioAvailability(context);
  process.env.FAL_API_KEY = 'configured-fal-key';

  const expectedProviders = [
    { value: 'ELEVENLABS', label: 'ElevenLabs' },
    { value: 'PLAYAI', label: 'Play.ht' },
    { value: 'CUSTOM_TEXT_TO_SPEECH', label: 'Custom TTS' },
  ];
  assert.deepEqual(
    __testOnly__.getAvailableAvatarVoiceoverTTSProviders(),
    expectedProviders,
  );
  assert.doesNotThrow(() => (
    __testOnly__.assertAvatarSpeechProviderAvailable('PLAYAI')
  ));
});

test('avatar status preserves the complete hosted TTS provider list', (context) => {
  configureIsolatedAvatarAudioAvailability(context);
  process.env.SAMSAR_DOCKER_AUDIO_PROVIDER_ROUTING_ENABLED = 'false';

  assert.deepEqual(
    __testOnly__.getAvailableAvatarVoiceoverTTSProviders(),
    [
      { value: 'OPENAI', label: 'OpenAI' },
      { value: 'ELEVENLABS', label: 'ElevenLabs' },
      { value: 'PLAYAI', label: 'Play.ht' },
      { value: 'GOOGLE', label: 'Google TTS' },
      { value: 'CUSTOM_TEXT_TO_SPEECH', label: 'Custom TTS' },
    ],
  );
});

test('avatar retrieval uses the processor route for a mounted protected image', (t) => {
  const previousAssetsV2Root = process.env.SAMSAR_ASSETS_V2_ROOT;
  const assetsV2Root = fs.mkdtempSync(path.join(os.tmpdir(), 'avatar-assets-v2-'));
  const imagePath = path.join(assetsV2Root, 'generations', 'session_123', 'avatar.png');
  fs.mkdirSync(path.dirname(imagePath), { recursive: true });
  fs.writeFileSync(imagePath, 'avatar');
  process.env.SAMSAR_ASSETS_V2_ROOT = assetsV2Root;
  t.after(() => {
    if (previousAssetsV2Root === undefined) {
      delete process.env.SAMSAR_ASSETS_V2_ROOT;
    } else {
      process.env.SAMSAR_ASSETS_V2_ROOT = previousAssetsV2Root;
    }
    fs.rmSync(assetsV2Root, { recursive: true, force: true });
  });

  const serializedTask = __testOnly__.serializeAvatarVoiceoverTask({
    avatarImage: '/assets_v2/generations/session_123/avatar.png',
    avatarImageUrl: '/assets_v2/generations/session_123/avatar.png',
  });

  assert.equal(serializedTask.avatarImageUrl, '/assets_v2/generations/session_123/avatar.png');
});

test('avatar preparation recovers a cloud-only protected image from object storage', async () => {
  const imageBuffer = Buffer.from('cloud-avatar-image');
  let requestedObject = null;
  const dataUri = await __testOnly__.readImageAsDataUri(
    '/assets_v2/generations/cloud_session/avatar.png',
    {
      getObjectFromS3: async (request) => {
        requestedObject = request;
        return {
          Body: imageBuffer,
          ContentType: 'image/png',
        };
      },
    }
  );

  assert.equal(requestedObject.key, 'assets_v2/generations/cloud_session/avatar.png');
  assert.match(dataUri, /^data:image\/png;base64,/);
  assert.deepEqual(Buffer.from(dataUri.split(',')[1], 'base64'), imageBuffer);
});

test('avatar retrieval replaces expired protected CloudFront signatures', () => {
  const staleUrl = 'https://legacy.example.cloudfront.net/assets_v2/generations/session_123/avatar.png?Expires=1&Signature=old&Key-Pair-Id=old';
  const serializedTask = __testOnly__.serializeAvatarVoiceoverTask({
    avatarImage: staleUrl,
    avatarImageUrl: staleUrl,
  });
  const avatarUrl = new URL(serializedTask.avatarImageUrl);

  assert.equal(serializedTask.avatarImage, 'assets_v2/generations/session_123/avatar.png');
  assert.equal(avatarUrl.pathname, '/assets_v2/generations/session_123/avatar.png');
  assert.notEqual(avatarUrl.searchParams.get('Expires'), '1');
  assert.notEqual(avatarUrl.searchParams.get('Signature'), 'old');
  assert.notEqual(avatarUrl.searchParams.get('Key-Pair-Id'), 'old');
});

test('avatar retrieval preserves third-party media URLs', () => {
  const providerUrl = 'https://provider.example/avatar.png?token=provider-token';
  const serializedTask = __testOnly__.serializeAvatarVoiceoverTask({
    avatarImage: providerUrl,
    avatarImageUrl: providerUrl,
  });

  assert.equal(serializedTask.avatarImageUrl, providerUrl);
});

test('session speech selection excludes uploaded-video and custom audio layers', () => {
  assert.equal(__testOnly__.isGeneratedSpeechLayer({ generationType: 'speech' }), true);
  assert.equal(__testOnly__.isGeneratedSpeechLayer({ generationType: 'recorded_speech' }), true);
  assert.equal(__testOnly__.isGeneratedSpeechLayer({ libraryType: 'speech' }), true);
  assert.equal(__testOnly__.isGeneratedSpeechLayer({ generationType: 'user_video' }), false);
  assert.equal(__testOnly__.isGeneratedSpeechLayer({ generationType: 'custom_audio' }), false);
});

test('session speech mixer resolves deployed asset URLs to local files before FFmpeg', (t) => {
  const previousAssetsV2Root = process.env.SAMSAR_ASSETS_V2_ROOT;
  const assetsV2Root = fs.mkdtempSync(path.join(os.tmpdir(), 'avatar-audio-assets-v2-'));
  const relativeAudioPath = 'video/audio/session_123/layer_123/speech.mp3';
  const audioPath = path.join(assetsV2Root, relativeAudioPath);
  fs.mkdirSync(path.dirname(audioPath), { recursive: true });
  fs.writeFileSync(audioPath, 'speech');
  process.env.SAMSAR_ASSETS_V2_ROOT = assetsV2Root;
  t.after(() => {
    if (previousAssetsV2Root === undefined) {
      delete process.env.SAMSAR_ASSETS_V2_ROOT;
    } else {
      process.env.SAMSAR_ASSETS_V2_ROOT = previousAssetsV2Root;
    }
    fs.rmSync(assetsV2Root, { recursive: true, force: true });
  });

  const resolvedAudio = __testOnly__.getAudioLayerSourceForFfmpeg({
    selectedLocalAudioLink: `https://api.samsar.one/assets_v2/${relativeAudioPath}`,
  });

  assert.equal(resolvedAudio.source, audioPath);
  assert.equal(resolvedAudio.isLocal, true);
});

test('session speech mixer downloads cloud-only audio before invoking FFmpeg', async (t) => {
  const outputFolder = fs.mkdtempSync(path.join(os.tmpdir(), 'avatar-remote-audio-'));
  const audioBuffer = Buffer.from('remote speech audio');
  const server = http.createServer((request, response) => {
    response.writeHead(200, { 'Content-Type': 'audio/mpeg' });
    response.end(audioBuffer);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(outputFolder, { recursive: true, force: true });
  });

  const { port } = server.address();
  const [materializedSegment] = await __testOnly__.materializeRemoteSpeechSegments([
    {
      source: `http://127.0.0.1:${port}/speech.mp3`,
      isLocal: false,
    },
  ], outputFolder);

  assert.equal(materializedSegment.isLocal, true);
  assert.deepEqual(fs.readFileSync(materializedSegment.source), audioBuffer);
});

test('avatar generated media paths use the assets_v2 serializer contract', () => {
  const outputPath = path.join(
    __testOnly__.getAvatarAssetsBasePath(),
    'avatar_voiceover',
    'session_123',
    'speech.mp3'
  );

  assert.equal(
    __testOnly__.getAvatarAssetsBasePath(),
    path.join(process.cwd(), 'assets_v2')
  );
  assert.equal(
    __testOnly__.toAssetRelativePath(outputPath),
    'assets_v2/avatar_voiceover/session_123/speech.mp3'
  );
});

test('avatar provider delivery prefers the uploaded CDN audio URL', () => {
  const providerUrl = 'https://static.samsar.one/assets_v2/temp_audio/avatar/session_speech.mp3';
  assert.equal(__testOnly__.getAvatarSpeechProviderSource({
    audioUrl: providerUrl,
    audioPath: '/local/session_speech.mp3',
    assetPath: '/assets_v2/avatar/session_speech.mp3',
  }), providerUrl);
});

test('image-list narrator avatar prompt uses top-level narrator gender fallback', () => {
  const prompt = buildNarratorAvatarImagePrompt({
    inputPrompt: 'launch a new product',
    themeJson: '{"tone":"premium"}',
    movieResourceList: {
      narrator: { actor: 'Ari', gender: 'M', Identity: 'confident product reviewer' },
      sounds: [],
    },
    languageString: 'English',
  });
  assert.match(prompt, /Narrator avatar gender: M \(male\)/i);
  assert.match(prompt, /Narrator name\/actor: Ari/i);
  assert.match(prompt, /Narrator gender: M/i);
});

test('image-list narrator avatar prompt requests square black-background avatar images', () => {
  const prompt = buildNarratorAvatarImagePrompt({
    inputPrompt: 'launch a new product',
    themeJson: '{"tone":"premium"}',
    movieResourceList: { sounds: [{ type: 'speech', subType: 'narration', actor: 'Mia', gender: 'F' }] },
    languageString: 'English',
    metadata: 'brand-safe ad',
    imageDescriptionList: 'product shots and presenter scenes',
  });
  assert.match(prompt, /landscape 16:9/i);
  assert.match(prompt, /solid black background/i);
  assert.match(prompt, /centered/i);
  assert.match(prompt, /do not use a white background or transparent background/i);
  assert.match(prompt, /Narrator avatar gender: F \(female\)/i);
  assert.match(prompt, /Narrator gender: F/i);
});
