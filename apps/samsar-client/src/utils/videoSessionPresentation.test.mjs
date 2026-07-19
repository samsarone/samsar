import test from 'node:test';
import assert from 'node:assert/strict';

import {
  isInteractiveVideoSession,
  isVideoSessionPublished,
  mergePublishedVideoSessionState,
  resolveVideoPublicationResponse,
} from './videoSessionPresentation.mjs';

test('identifies interactive sessions across list, detail, and status projections', () => {
  assert.equal(isInteractiveVideoSession({ narrativeType: 'branched' }), true);
  assert.equal(isInteractiveVideoSession({
    branchingTimeline: { schemaVersion: 'branching_timeline.v1', choicePoints: [] },
  }), true);
  assert.equal(isInteractiveVideoSession({
    session: { narrative_type: 'branched' },
  }), true);
  assert.equal(isInteractiveVideoSession({ sourceNarrativeType: 'branched' }), true);
  assert.equal(isInteractiveVideoSession({ source_narrative_type: 'branched' }), true);
  assert.equal(isInteractiveVideoSession({
    status_detail_schema: 'interactive_video_manifest.v1',
  }), true);
  assert.equal(isInteractiveVideoSession({
    narrativeType: 'linear',
    branchRenderPaths: [],
  }), false);
});

test('resolves InteractivePublication before the legacy publication wrapper', () => {
  const interactivePublication = { id: 'interactive-publication', title: 'Branching story' };
  const response = {
    session: { id: 'session-1' },
    interactivePublication,
    publication: { id: 'legacy-publication' },
  };

  assert.deepEqual(resolveVideoPublicationResponse(response), {
    session: response.session,
    publication: interactivePublication,
  });
});

test('published-state aliases preserve the existing true-wins behavior', () => {
  assert.equal(isVideoSessionPublished({ ispublishedVideo: false, isPublished: true }), true);
  assert.equal(isVideoSessionPublished({ ispublishedVideo: false, publishedPublicationId: 'stale' }), false);
});

test('normalizes an InteractivePublication response into published session state', () => {
  const merged = mergePublishedVideoSessionState({
    currentSession: {
      _id: 'session-1',
      narrativeType: 'branched',
      remoteURL: 'https://static.example/default-before-publish.mp4',
    },
    responseData: {
      session: { _id: 'session-1', narrativeType: 'branched' },
      interactivePublication: {
        _id: 'interactive-publication-1',
        title: 'Choose a path',
        description: 'An interactive story',
        mainVideoUrl: 'https://static.example/main-video.mp4',
        mainThumbnailUrl: 'https://static.example/main-thumbnail.png',
        manifest: {
          default_path_id: 'root.2',
          outputs: {
            paths: [
              { path_id: 'root.1', url: 'https://static.example/root.1.mp4' },
              { path_id: 'root.2', url: 'https://static.example/root.2.mp4' },
            ],
          },
        },
        updatedAt: '2026-07-19T08:00:00.000Z',
      },
    },
    publishPayload: { aspectRatio: '16:9', tags: ['interactive'] },
  });

  assert.equal(merged.ispublishedVideo, true);
  assert.equal(merged.isPublished, true);
  assert.equal(merged.publishedTitle, 'Choose a path');
  assert.equal(merged.publishedVideoURL, 'https://static.example/main-video.mp4');
  assert.equal(merged.publishedSplashImage, 'https://static.example/main-thumbnail.png');
  assert.equal(merged.publishedPublicationId, 'interactive-publication-1');
  assert.equal(merged.publishedInteractivePublicationId, 'interactive-publication-1');
  assert.equal(isVideoSessionPublished(merged), true);
});

test('uses the serialized interactive manifest default path when mainVideoUrl is absent', () => {
  const merged = mergePublishedVideoSessionState({
    currentSession: { _id: 'session-3', source_narrative_type: 'branched' },
    responseData: {
      interactive_publication: {
        id: 'interactive-publication-3',
        manifest: {
          outputs: {
            default_path_id: 'root.2',
            paths: [
              { path_id: 'root.1', url: 'https://static.example/root.1.mp4' },
              { path_id: 'root.2', url: 'https://static.example/root.2.mp4' },
            ],
          },
        },
      },
    },
  });

  assert.equal(merged.publishedVideoURL, 'https://static.example/root.2.mp4');
  assert.equal(merged.publishedInteractivePublicationId, 'interactive-publication-3');
});

test('keeps legacy Publication response handling intact', () => {
  const merged = mergePublishedVideoSessionState({
    currentSession: { _id: 'session-2', narrativeType: 'linear' },
    responseData: {
      publication: {
        id: 'publication-2',
        title: 'Linear story',
        videoURL: 'https://static.example/linear.mp4',
      },
    },
    publishPayload: { description: 'Linear description' },
  });

  assert.equal(merged.publishedPublicationId, 'publication-2');
  assert.equal(merged.publishedInteractivePublicationId, undefined);
  assert.equal(merged.publishedVideoURL, 'https://static.example/linear.mp4');
  assert.equal(merged.publishedDescription, 'Linear description');
});
