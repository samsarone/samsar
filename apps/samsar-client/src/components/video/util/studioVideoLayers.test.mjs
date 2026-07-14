import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildStudioGuestMediaUrl,
  canPreloadNextStudioVideo,
  isCloudFrontSignedVideoUrl,
  isStudioVideoSourceReady,
  resolveStudioLayerVideo,
  shouldSuppressStudioBaseImage,
} from './studioVideoLayers.mjs';

const options = {
  processorApiUrl: 'https://api.samsar.one',
  staticCdnUrl: 'https://static.samsar.one',
};

const guestSession = {
  _id: 'session-123',
  isGuestSession: true,
};

test('guest layers prefer fresh signed raw links for every video type', () => {
  const variants = [
    {
      expectedType: 'lip_sync',
      flag: 'hasLipSyncVideoLayer',
      remote: 'lipSyncRemoteLink',
      rawRemote: 'rawLipSyncRemoteLink',
    },
    {
      expectedType: 'sound_effect',
      flag: 'hasSoundEffectVideoLayer',
      remote: 'soundEffectRemoteLink',
      rawRemote: 'rawSoundEffectRemoteLink',
    },
    {
      expectedType: 'user_video',
      flag: 'hasUserVideoLayer',
      remote: 'userVideoRemoteLink',
      rawRemote: 'rawUserVideoRemoteLink',
    },
    {
      expectedType: 'ai_video',
      flag: 'hasAiVideoLayer',
      remote: 'aiVideoRemoteLink',
      rawRemote: 'rawAiVideoRemoteLink',
    },
  ];

  variants.forEach((variant) => {
    const signedUrl = `https://media.example/assets_v2/users/session-123/${variant.expectedType}.mp4`
      + '?Expires=2000000000&Signature=fresh-signature&Key-Pair-Id=K123';
    const result = resolveStudioLayerVideo({
      [variant.flag]: true,
      [variant.remote]: `assets_v2/users/session-123/${variant.expectedType}.mp4`,
      [variant.rawRemote]: signedUrl,
    }, guestSession, options);

    assert.deepEqual(result, { url: signedUrl, type: variant.expectedType });
  });

  assert.equal(isCloudFrontSignedVideoUrl(
    'https://media.example/video.mp4?Policy=encoded&Signature=sig&Key-Pair-Id=key'
  ), true);
  assert.equal(isCloudFrontSignedVideoUrl(
    'https://media.example/video.mp4?Expires=2000000000&Signature=missing-key'
  ), false);

  const signedCurrentRemote = 'https://media.example/assets_v2/users/session-123/ai.mp4'
    + '?Expires=2000000000&Signature=current-signature&Key-Pair-Id=K123';
  assert.deepEqual(resolveStudioLayerVideo({
    hasAiVideoLayer: true,
    aiVideoRemoteLink: signedCurrentRemote,
  }, guestSession, options), {
    type: 'ai_video',
    url: signedCurrentRemote,
  });
});

test('guest session-scoped assets_v2 paths fall back to the guest media proxy', () => {
  const result = resolveStudioLayerVideo({
    hasAiVideoLayer: true,
    aiVideoLayer: 'assets_v2/users/session-123/generated/ai-video.mp4',
  }, guestSession, options);

  assert.deepEqual(result, {
    type: 'ai_video',
    url: 'https://api.samsar.one/video_sessions/guest_media'
      + '?sessionId=session-123'
      + '&assetKey=assets_v2%2Fusers%2Fsession-123%2Fgenerated%2Fai-video.mp4',
  });
  assert.equal(
    buildStudioGuestMediaUrl(
      guestSession,
      'assets_v2/users/another-session/ai-video.mp4',
      options
    ),
    null
  );
});

test('already normalized guest media links are preserved', () => {
  const proxyPath = '/video_sessions/guest_media'
    + '?sessionId=session-123&assetKey=assets_v2%2Fusers%2Fsession-123%2Flip.mp4';
  const result = resolveStudioLayerVideo({
    hasLipSyncVideoLayer: true,
    lipSyncRemoteLink: proxyPath,
  }, guestSession, options);

  assert.deepEqual(result, {
    type: 'lip_sync',
    url: `https://api.samsar.one${proxyPath}`,
  });
});

test('video selection preserves lip sync, sound effect, user video, AI video priority', () => {
  const result = resolveStudioLayerVideo({
    hasLipSyncVideoLayer: true,
    hasSoundEffectVideoLayer: true,
    hasUserVideoLayer: true,
    hasAiVideoLayer: true,
    lipSyncRemoteLink: 'https://media.example/lip.mp4',
    soundEffectRemoteLink: 'https://media.example/sound.mp4',
    userVideoRemoteLink: 'https://media.example/user.mp4',
    aiVideoRemoteLink: 'https://media.example/ai.mp4',
  }, {}, options);

  assert.deepEqual(result, {
    type: 'lip_sync',
    url: 'https://media.example/lip.mp4',
  });

  const preferredResult = resolveStudioLayerVideo({
    layerAiVideoType: 'user_video',
    lipSyncRemoteLink: 'https://media.example/lip.mp4',
    userVideoRemoteLink: 'https://media.example/user.mp4',
  }, {}, options);
  assert.deepEqual(preferredResult, {
    type: 'user_video',
    url: 'https://media.example/user.mp4',
  });
});

test('structured video fields support all current URL aliases', () => {
  const aliases = ['url', 'remoteURL', 'remoteUrl', 'remote_url', 'assetPath', 'src'];

  aliases.forEach((alias) => {
    const source = `https://media.example/structured-${alias}.mp4`;
    const result = resolveStudioLayerVideo({
      hasAiVideoLayer: true,
      aiVideo: { [alias]: source },
    }, {}, options);
    assert.deepEqual(result, { type: 'ai_video', url: source });
  });

  assert.deepEqual(resolveStudioLayerVideo({
    hasSoundEffectVideoLayer: true,
    soundEffectVideo: 'https://media.example/structured-string.mp4',
  }, {}, options), {
    type: 'sound_effect',
    url: 'https://media.example/structured-string.mp4',
  });
});

test('non-guest layers keep legacy resolution and normalize unsigned static assets', () => {
  assert.deepEqual(resolveStudioLayerVideo({
    hasAiVideoLayer: true,
    aiVideoRemoteLink: 'https://static.samsar.one/assets_v2/users/session-123/ai.mp4',
  }, {}, options), {
    type: 'ai_video',
    url: 'https://api.samsar.one/assets_v2/users/session-123/ai.mp4',
  });

  assert.deepEqual(resolveStudioLayerVideo({
    hasUserVideoLayer: true,
    userVideoRemoteLink: 'https://static.samsar.one/assets_v2/user_resources/user-video.mp4',
  }, {}, options), {
    type: 'user_video',
    url: 'https://static.samsar.one/assets_v2/user_resources/user-video.mp4',
  });

  assert.deepEqual(resolveStudioLayerVideo({
    hasAiVideoLayer: true,
    aiVideoLayer: 'assets_v2/users/session-123/local-ai.mp4',
  }, {}, options), {
    type: 'ai_video',
    url: 'https://api.samsar.one/assets_v2/users/session-123/local-ai.mp4',
  });
});

test('lookahead video loading waits for the active video but skips still-only scenes', () => {
  assert.equal(canPreloadNextStudioVideo('scene-1.mp4', ''), false);
  assert.equal(canPreloadNextStudioVideo('scene-1.mp4', 'scene-2.mp4'), false);
  assert.equal(canPreloadNextStudioVideo('scene-1.mp4', 'scene-1.mp4'), true);
  assert.equal(canPreloadNextStudioVideo('', ''), true);
  assert.equal(isStudioVideoSourceReady('scene-1.mp4', 'scene-1.mp4'), true);
  assert.equal(isStudioVideoSourceReady('scene-1.mp4', ''), false);
});

test('ready video composition suppresses only the base image', () => {
  const currentSource = 'scene-1.mp4';
  const readySource = 'scene-1.mp4';

  assert.equal(shouldSuppressStudioBaseImage({
    type: 'image',
    is_base_image: true,
  }, currentSource, readySource), true);
  assert.equal(shouldSuppressStudioBaseImage({
    type: 'image',
    isBaseImage: true,
  }, currentSource, readySource), true);
  assert.equal(shouldSuppressStudioBaseImage({
    type: 'image',
    is_base_image: false,
  }, currentSource, readySource), false);
  assert.equal(shouldSuppressStudioBaseImage({
    type: 'text',
    is_base_image: true,
  }, currentSource, readySource), false);
  assert.equal(shouldSuppressStudioBaseImage({
    type: 'image',
    is_base_image: true,
  }, currentSource, 'scene-2.mp4'), false);
});
