
import express from 'express';
import {
  createVideoSession, getFrameForSession, getSessionDetails,
  getLayerFrameDownloadForSession,
  requestVideoGeneration, refreshFramesForSession, updatePendingFramesForSession,
  addAudioToSession, updateFramesForLayer, refreshLayersForSession,
  updateLayerActiveItemList, getVideoSessionGenerationStatus,
  requestGenerateImage, requestEditImage,
  updateLayerForSession, getVideoRenderStatus,
  cancelPendingRenderForSession,
  updateAudioLayersForSession,
  updateAllAudioLayersForSession,
  addNewLayerToSession,
  copyLayerInSession, removeLayerInSession,
  getVideoSessionEditStatus, updateSessionDefaults,
  addLayersViaPromptList, fetchLatetstGuestSession,
  getGuestSessionDetails, getGuestSessionMediaObject, getOrCreateSession,
  requestGenerateMask, getVideoSessionMaskGenerationStatus,
  getUserSessionList, requestGenerateSegmentationForMask,
  deleteVideoSessionForUser,
  updateSessionLayers,
  requestRealignLayersToSpeechAndRegenerateSubtitles,
  regenerateFramesForSession, validateSessionDetails,
  getSession, importIntroSessionToUser, getAIVideoRenderStatus,
  removeAIVideoLayerForSession, requestRegenerateSubtitles, requestRegeneratePresetAnimations,
  requestGenerateLayeredSpeech,
  setAdvancedTheme, requestApplyAutoSyncLayersToAnimations, requestApplyAutoSyncLayersToBeats,
  requestApplyAutoSyncBeatsToLayersAndAnimations, addAudioFromLibraryToSession,
  duplicateAudioLayerInSession,
  uploadAudioLibraryItemForSession,
  deleteAudioLibraryItemForSession,
  requestGenerateAudioVisualizer, addAiVideoLayerToSession, updateLayersOrder,
  getUserVideoLibrary, addVideoFromLibraryToSession, requestVideoLayerEdit,
  addTextToActiveList, requestRealignLayersToAiVideoLayerAndRegenerateSubtitles,
  requestRealignLayersAndRegenerateFrames,
  requestGenerateLipSync,
  requestGenerateSyncedSoundEffectVideo,
  requestGenerateAIVideoByModel,
  requestGuestVideoGeneration,
  restartExpressPipelineFromCheckpoint,
  updateSessionMovieGenSpeakers,
  appendUserVideoLayerUploadChunk,
  startUserVideoLayerUploadTask,
  updateLayerVisualItem,
  deleteLayerVisualItem,
  uploadGlobalVideoForSession,
  getGlobalVideoProcessingStatusForSession,
  updateGlobalVideosForSession,
  addGlobalAudioFromLibraryToSession,
  updateGlobalAudioLayersForSession,
  updateSessionHintsForSession,
  createReadOnlyShareForSession,
  getReadOnlySharedSessionDetails,
  getEditableSharedSessionDetails,
  assertVideoSessionEditableAccess,
  logSharedSessionEditOperation,



} from '../models/VideoSession.js';


import { createPublicationForSessionVideo, createMetaForSession, unpublishSessionVideo } from '../models/Publication.js';
import VideoSessionDocument from '../schema/VideoSession.js';

import { requestGenerateCustomAIVideo, } from '../models/ai_video/index.js';

import { getIntroSessionList, } from '../models/IntroSession.js';

import { verifyUserAuth, verifyUserAuthAndGetUser } from '../models/Auth.js';
import { createRealtimeTranscriptionSession } from '../models/Realtime.js';
import { copyVideoSession } from '../models/api/VideoSessionCloneAPI.js';
import {
  acceptAvatarVoiceoverVideoForSession,
  getAvatarVoiceoverStatus,
  listAvatarVoiceoverTasks,
  listUserRunwayAvatars,
  rejectAvatarVoiceoverTask,
  requestGenerateAvatarSpeechFromHints,
  requestCreateRunwayAvatar,
  requestGenerateAvatarImage,
  requestGenerateAvatarVideoFromHints,
  RUNWAY_AVATAR_VOICE_PRESETS,
  saveAvatarVoiceoverVideoToLibrary,
  selectUserRunwayAvatarForSession,
} from '../models/AvatarVoiceover.js';

const router = express.Router();

const VOICE_SESSION_TIMEOUT_SECONDS = 10 * 60; // 10 minutes
const VOICE_TRANSCRIPTION_WORD_LIMIT = 2000;

const getRouteSessionPayload = (payload = {}, fallback = {}) => ({
  ...(payload || {}),
  ...(fallback || {}),
});

async function assertEditableRouteAccess(userId, payload = {}, options = {}) {
  return assertVideoSessionEditableAccess(userId, payload, options);
}

async function logSharedRouteOperation(userId, payload = {}, options = {}) {
  return logSharedSessionEditOperation(userId, payload, options);
}

router.post('/create_video_session', async function (req, res) {

  const payload = req.body;
  const headers = req.headers;
  const userId = verifyUserAuth(headers);
  if (!userId) {
    res.status(401).send("Unauthorized");
    return;
  }

  try {
    const sessionData = await createVideoSession(userId, payload);
    res.json(sessionData);
  } catch (e) {
    res.status(400).send("Error creating video session");
  }
});

router.get('/get_transcription_key', async function (req, res) {
  const headers = req.headers;
  const authHeader = headers?.authorization;
  if (!authHeader) {
    res.status(401).send({ error: 'Unauthorized' });
    return;
  }
  const userId = verifyUserAuth(headers);

  if (!userId) {
    res.status(401).send({ error: 'Unauthorized' });
    return;
  }

  try {
    const user = await verifyUserAuthAndGetUser(headers);
    if (!user?.isEmailVerified && user.generationCredits < 100) {
      res.status(403).send({ error: 'Email verification required.' });
      return;
    }

    const { model, voice, modalities } = req.query;
    const sessionResponse = await createRealtimeTranscriptionSession({
      model,
      voice,
      modalities: modalities
        ? modalities.split(',').map((m) => m.trim()).filter(Boolean)
        : undefined,
      sessionParams: {
        modalities: ['audio', 'text'],
        instructions: `You are a realtime speech-to-text service. Provide concise text transcripts of the user audio, avoid additional commentary, and end the session once it reaches 10 minutes or ${VOICE_TRANSCRIPTION_WORD_LIMIT} transcribed words.`,
        turn_detection: {
          type: 'server_vad',
          threshold: 0.5,
          prefix_padding_ms: 300,
          silence_duration_ms: 200,
          idle_timeout_ms: null,
          create_response: false,
          interrupt_response: false,
        },
        max_duration_seconds: VOICE_SESSION_TIMEOUT_SECONDS,
      },
    });
    res.json({
      ...sessionResponse,
      expiresAt: new Date(Date.now() + VOICE_SESSION_TIMEOUT_SECONDS * 1000).toISOString(),
      maxTranscriptWords: VOICE_TRANSCRIPTION_WORD_LIMIT,
    });
  } catch (error) {
    const status = error?.response?.status || 500;
    const message = error?.response?.data?.error || error?.message;

    console.error('Realtime transcription key error:', {
      status,
      message,
      data: error?.response?.data,
    });

    res.status(status).send({
      error: 'Unable to generate transcription key.',
      message: message || 'Unknown error while contacting OpenAI.',
    });
  }
});


router.get('/details', async function (req, res) {
  const headers = req.headers;
  const { id, layer } = req.query;
  const userId = verifyUserAuth(headers);
  if (!userId) {
    res.status(401).send("Unauthorized");
    return;
  }
  const payload = {
    userId,
    id,
    layer,
  }
  try {
    const sessionData = await getFrameForSession(payload);
    res.send(sessionData);
  } catch (e) {
    res.status(400).send("Error getting frame for session");
  }
});

router.get('/layer_frame', async function (req, res) {
  const headers = req.headers;
  const userId = verifyUserAuth(headers);
  if (!userId) {
    res.status(401).send("Unauthorized");
    return;
  }

  const payload = {
    sessionId: req.query.sessionId || req.query.id,
    layerId: req.query.layerId || req.query.layer,
    timestamp: req.query.timestamp,
    frame: req.query.frame,
  };

  try {
    const frameDownload = await getLayerFrameDownloadForSession(userId, payload);
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Content-Disposition', `attachment; filename="${frameDownload.fileName}"`);
    res.sendFile(frameDownload.absolutePath);
  } catch (e) {
    console.error('Error getting layer frame for session', {
      sessionId: payload.sessionId,
      layerId: payload.layerId,
      message: e?.message,
    });
    res.status(e?.statusCode || 400).send({
      error: e?.message || "Error getting layer frame for session",
    });
  }
});

router.get('/session_details', async function (req, res) {
  const headers = req.headers;
  const { id, isGuest } = req.query;
  const userId = verifyUserAuth(headers);
  res.setHeader('Cache-Control', 'private, no-store');
  if (!userId) {
    const payload = {
      id,
    }
    const sessionData = await getGuestSessionDetails(payload);
    res.send(sessionData);
    return;
  }
  const payload = {
    userId,
    id,
  }

  try {
    const sessionData = await getSessionDetails(payload);
    res.send(sessionData);

  } catch (e) {
    console.error('Error getting session details', {
      sessionId: id,
      userId,
      statusCode: e?.statusCode || e?.status || 400,
      message: e?.message,
    });
    res.status(e?.statusCode || e?.status || 400).send({
      error: e?.message || "Error getting session details",
    });
  }

});

async function streamGuestSessionMedia(req, res, payload) {
  try {
    const mediaObject = await getGuestSessionMediaObject(payload);

    res.status(mediaObject.statusCode || 200);
    res.setHeader('Content-Type', mediaObject.contentType || 'application/octet-stream');
    res.setHeader('Accept-Ranges', mediaObject.acceptRanges || 'bytes');
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.setHeader('Content-Disposition', `inline; filename="${mediaObject.fileName || 'media'}"`);
    if (mediaObject.contentLength !== undefined && mediaObject.contentLength !== null) {
      res.setHeader('Content-Length', String(mediaObject.contentLength));
    }
    if (mediaObject.contentRange) {
      res.setHeader('Content-Range', mediaObject.contentRange);
    }

    if (mediaObject.stream && typeof mediaObject.stream.pipe === 'function') {
      mediaObject.stream.on('error', (error) => {
        console.error('Guest media stream error', {
          sessionId: payload.sessionId,
          assetKey: payload.assetKey,
          message: error?.message,
        });
        if (!res.headersSent) {
          res.status(500);
        }
        res.end();
      });
      return mediaObject.stream.pipe(res);
    }

    return res.send(mediaObject.stream);
  } catch (error) {
    const statusCode = error?.statusCode || error?.status || error?.$metadata?.httpStatusCode || 500;
    console.error('Error getting guest session media', {
      sessionId: payload.sessionId,
      assetKey: payload.assetKey,
      statusCode,
      message: error?.message,
    });
    return res.status(statusCode).send({
      error: error?.message || 'Unable to load guest session media.',
    });
  }
}

router.get('/guest_media', async function (req, res) {
  return streamGuestSessionMedia(req, res, {
    sessionId: req.query.sessionId,
    assetKey: req.query.assetKey,
    range: req.headers.range,
  });
});

router.get('/guest_media/:sessionId/*', async function (req, res) {
  return streamGuestSessionMedia(req, res, {
    sessionId: req.params.sessionId,
    assetKey: req.params[0],
    range: req.headers.range,
  });
});

router.post('/share_session', async function (req, res) {
  const userId = verifyUserAuth(req.headers);
  if (!userId) {
    res.status(401).send("Unauthorized");
    return;
  }

  try {
    const shareData = await createReadOnlyShareForSession(userId, req.body);
    res.json(shareData);
  } catch (error) {
    const statusCode = error?.status || 400;
    res.status(statusCode).json({ error: error?.message || 'Unable to create share URL.' });
  }
});

router.get('/share/:shareToken', async function (req, res) {
  try {
    const sessionData = await getReadOnlySharedSessionDetails(req.params.shareToken);
    res.json(sessionData);
  } catch (error) {
    const statusCode = error?.status || 404;
    res.status(statusCode).json({ error: error?.message || 'Shared session not found.' });
  }
});

router.get('/editable_share/:editableShareToken', async function (req, res) {
  const userId = verifyUserAuth(req.headers);

  try {
    const sessionData = await getEditableSharedSessionDetails(userId, req.params.editableShareToken);
    res.json(sessionData);
  } catch (error) {
    const statusCode = error?.status || 404;
    res.status(statusCode).json({ error: error?.message || 'Editable shared session not found.' });
  }
});


router.post('/request_render_video', async function (req, res) {
  const headers = req.headers;
  const payload = req.body;
  const { id } = payload;

  const userId = verifyUserAuth(headers);
  if (!userId) {
    res.status(401).send("Unauthorized");
    return;
  }
  const generationResponse = await requestVideoGeneration(userId, id, payload);
  await logSharedRouteOperation(userId, getRouteSessionPayload(payload, { sessionId: id }), {
    operation: 'request_render_video',
    category: 'generation',
    route: '/video_sessions/request_render_video',
  });

  res.send(generationResponse);
});


router.post('/request_render_guest_video', async function (req, res) {
  const payload = req.body;
  const { id } = payload;

  const generationResponse = await requestGuestVideoGeneration(id, payload);

  res.send(generationResponse);

});

router.post('/cancel_pending_render', async function (req, res) {
  try {
    const headers = req.headers;
    const userId = verifyUserAuth(headers);
    if (!userId) {
      res.status(401).send("Unauthorized");
      return;
    }

    const session = await cancelPendingRenderForSession(userId, req.body);
    await logSharedRouteOperation(userId, req.body, {
      operation: 'cancel_pending_render',
      category: 'update',
      route: '/video_sessions/cancel_pending_render',
    });
    res.json({ session });
  } catch (e) {
    console.error('Error cancelling pending render:', e);
    res.status(400).send("Error cancelling pending render");
  }
});

router.post('/restart_express_pipeline', async function (req, res) {
  try {
    const headers = req.headers;
    const userId = verifyUserAuth(headers);
    if (!userId) {
      res.status(401).send("Unauthorized");
      return;
    }

    const session = await restartExpressPipelineFromCheckpoint(userId, req.body);
    await logSharedRouteOperation(userId, req.body, {
      operation: 'restart_express_pipeline',
      category: 'generation',
      route: '/video_sessions/restart_express_pipeline',
    });
    res.json({ session });
  } catch (error) {
    console.error('Error restarting express pipeline:', error);
    res.status(400).json({ error: error?.message || 'Unable to restart express pipeline.' });
  }
});

router.post('/refresh_session_frames', async function (req, res) {
  const headers = req.headers;
  const { id } = req.body;

  const userId = verifyUserAuth(headers);
  if (!userId) {
    res.status(401).send("Unauthorized");
    return;
  }
  try {
    //  const updateSessionFrameResponse = await refreshFramesForSession(id);
    // res.send(updateSessionFrameResponse);
    res.send({});

  } catch (e) {
    console.error(e);

    res.status(400).send("Error updating session frames");
  }
});

router.post('/refresh_session_layers', async function (req, res) {
  const headers = req.headers;
  const { id } = req.body;

  const userId = verifyUserAuth(headers);

  if (!userId) {
    res.status(401).send("Unauthorized");
    return;
  }
  try {
    const updateSessionLayerResponse = await refreshLayersForSession(id);
    res.send(updateSessionLayerResponse);
  } catch (e) {
    res.status(400).send("Error updating session layers");
  }
});

router.post('/update_pending_session_frames', async function (req, res) {
  const headers = req.headers;
  const { id } = req.body;

  const userId = verifyUserAuth(headers);
  if (!userId) {
    res.status(401).send("Unauthorized");
    return;
  }
  try {
    const updatePendingSessionFrameResponse = await updatePendingFramesForSession(id);

    res.send(updatePendingSessionFrameResponse);
  } catch (e) {
    res.status(400).send("Error updating session frames");
  }

});

router.post('/add_audio', async function (req, res) {
  const headers = req.headers;
  const { id, dataURL } = req.body;

  const userId = verifyUserAuth(headers);
  if (!userId) {
    res.status(401).send("Unauthorized");
    return;
  }
  try {
    const updateSessionFrameResponse = await addAudioToSession(id, dataURL);

    res.send(updateSessionFrameResponse);
  } catch (e) {
    res.status(400).send("Error updating session frames");
  }
});


router.post('/update_layer_frames', async function (req, res) {
  const headers = req.headers;


  const userId = verifyUserAuth(headers);
  if (!userId) {
    res.status(401).send("Unauthorized");
    return;
  }
  try {

    const updateSessionFrameResponse = await updateFramesForLayer(req.body);

    res.send(updateSessionFrameResponse);
  } catch (e) {
    console.error(e);
    res.status(400).send("Error updating session frames");
  }
});

router.post('/update_active_item_list', async function (req, res) {
  const payload = req.body;

  const headers = req.headers;
  const userId = verifyUserAuth(headers);

  if (!userId) {
    res.status(401).send("Unauthorized");
    return;
  }

  const sessionDataResponse = await updateLayerActiveItemList(userId, payload);
  await logSharedRouteOperation(userId, payload, {
    operation: 'update_active_item_list',
    category: 'update',
    route: '/video_sessions/update_active_item_list',
  });
  res.json(sessionDataResponse);
});

router.post('/update_layer_visual_item', async function (req, res) {
  const payload = req.body;

  const headers = req.headers;
  const userId = verifyUserAuth(headers);

  if (!userId) {
    res.status(401).send("Unauthorized");
    return;
  }

  try {
    const sessionDataResponse = await updateLayerVisualItem(userId, payload);
    await logSharedRouteOperation(userId, payload, {
      operation: 'update_layer_visual_item',
      category: 'update',
      route: '/video_sessions/update_layer_visual_item',
    });
    res.json(sessionDataResponse);
  } catch (error) {
    console.error(error);
    res.status(400).send("Error updating layer visual item");
  }
});

router.post('/delete_layer_visual_item', async function (req, res) {
  const payload = req.body;

  const headers = req.headers;
  const userId = verifyUserAuth(headers);

  if (!userId) {
    res.status(401).send("Unauthorized");
    return;
  }

  try {
    const sessionDataResponse = await deleteLayerVisualItem(userId, payload);
    await logSharedRouteOperation(userId, payload, {
      operation: 'delete_layer_visual_item',
      category: 'update',
      route: '/video_sessions/delete_layer_visual_item',
    });
    res.json(sessionDataResponse);
  } catch (error) {
    console.error(error);
    res.status(400).send("Error deleting layer visual item");
  }
});

router.post('/add_text_to_active_list', async function (req, res) {
  const payload = req.body;

  const headers = req.headers;

  const userId = verifyUserAuth(headers);

  if (!userId) {
    res.status(401).send("Unauthorized");
    return;
  }

  await assertEditableRouteAccess(userId, payload);
  const activeItemList = await addTextToActiveList(userId, payload);
  await logSharedRouteOperation(userId, payload, {
    operation: 'add_text_to_active_list',
    category: 'update',
    route: '/video_sessions/add_text_to_active_list',
  });
  res.json(activeItemList);

});


router.post('/update_layer', async function (req, res) {
  const payload = req.body;

  const headers = req.headers;
  const userId = verifyUserAuth(headers);

  if (!userId) {
    res.status(401).send("Unauthorized");
    return;
  }

  await assertEditableRouteAccess(userId, payload);
  const sessionData = await updateLayerForSession(payload);
  await logSharedRouteOperation(userId, payload, {
    operation: 'update_layer',
    category: 'update',
    route: '/video_sessions/update_layer',
  });
  res.json(sessionData);
});

router.get('/generate_status', async function (req, res) {
  const headers = req.headers;
  const { id, layerId } = req.query;
  const generationStatus = await getVideoSessionGenerationStatus(id, layerId);

  res.send(generationStatus);

});

router.get('/edit_status', async function (req, res) {
  const headers = req.headers;
  const { id, layerId } = req.query;
  const generationStatus = await getVideoSessionEditStatus(id, layerId);
  res.send(generationStatus);
});

router.post('/regenerate_subtitles_for_video_session', async function (req, res) {

  const headers = req.headers;
  const userId = verifyUserAuth(headers);
  if (!userId) {
    res.status(401).send("Unauthorized");
    return;
  }

  const payload = req.body;

  const sessionData = await requestRegenerateSubtitles(userId, payload);
  res.json(sessionData);

});

router.post('/request_generate', async function (req, res) {
  const headers = req.headers;

  const userId = verifyUserAuth(headers);
  if (!userId) {
    res.status(401).send("Unauthorized");
    return;
  }
  const payload = req.body;
  const sessionData = await requestGenerateImage(userId, payload);
  await logSharedRouteOperation(userId, getRouteSessionPayload(payload, { sessionId: payload.videoSessionId }), {
    operation: 'request_generate_image',
    category: 'generation',
    route: '/video_sessions/request_generate',
  });
  res.json(sessionData);
});

router.post('/request_edit_image', async function (req, res) {
  const headers = req.headers;

  const userId = verifyUserAuth(headers);
  if (!userId) {
    res.status(401).send("Unauthorized");
    return;
  }

  const payload = req.body;

  const sessionData = await requestEditImage(userId, payload);
  await logSharedRouteOperation(userId, payload, {
    operation: 'request_edit_image',
    category: 'generation',
    route: '/video_sessions/request_edit_image',
  });
  res.json(sessionData);
});

router.get('/avatar_voiceover/voices', async function (req, res) {
  const headers = req.headers;
  const userId = verifyUserAuth(headers);
  if (!userId) {
    res.status(401).send("Unauthorized");
    return;
  }

  res.json({ voices: RUNWAY_AVATAR_VOICE_PRESETS });
});

router.get('/avatar_voiceover/list', async function (req, res) {
  const headers = req.headers;
  const userId = verifyUserAuth(headers);
  if (!userId) {
    res.status(401).send("Unauthorized");
    return;
  }

  try {
    res.json(await listAvatarVoiceoverTasks(userId, req.query));
  } catch (error) {
    res.status(400).json({ error: error?.message || 'Unable to list avatar voiceovers.' });
  }
});

router.get('/avatar_voiceover/user_avatars', async function (req, res) {
  const headers = req.headers;
  const userId = verifyUserAuth(headers);
  if (!userId) {
    res.status(401).send("Unauthorized");
    return;
  }

  try {
    res.json(await listUserRunwayAvatars(userId));
  } catch (error) {
    res.status(400).json({ error: error?.message || 'Unable to list avatars.' });
  }
});

router.get('/avatar_voiceover/status', async function (req, res) {
  const headers = req.headers;
  const userId = verifyUserAuth(headers);
  if (!userId) {
    res.status(401).send("Unauthorized");
    return;
  }

  try {
    res.json(await getAvatarVoiceoverStatus(userId, req.query));
  } catch (error) {
    res.status(400).json({ error: error?.message || 'Unable to get avatar voiceover status.' });
  }
});

router.post('/avatar_voiceover/select_avatar', async function (req, res) {
  const headers = req.headers;
  const userId = verifyUserAuth(headers);
  if (!userId) {
    res.status(401).send("Unauthorized");
    return;
  }

  try {
    res.json(await selectUserRunwayAvatarForSession(userId, req.body));
  } catch (error) {
    res.status(400).json({ error: error?.message || 'Unable to select avatar.' });
  }
});

router.post('/avatar_voiceover/generate_avatar_image', async function (req, res) {
  const headers = req.headers;
  const userId = verifyUserAuth(headers);
  if (!userId) {
    res.status(401).send("Unauthorized");
    return;
  }

  try {
    res.json(await requestGenerateAvatarImage(userId, req.body));
  } catch (error) {
    res.status(400).json({ error: error?.message || 'Unable to generate avatar image.' });
  }
});

router.post('/avatar_voiceover/create_avatar', async function (req, res) {
  const headers = req.headers;
  const userId = verifyUserAuth(headers);
  if (!userId) {
    res.status(401).send("Unauthorized");
    return;
  }

  try {
    res.json(await requestCreateRunwayAvatar(userId, req.body));
  } catch (error) {
    res.status(400).json({ error: error?.message || 'Unable to create avatar.' });
  }
});

router.post('/avatar_voiceover/generate_speech_from_hints', async function (req, res) {
  const headers = req.headers;
  const userId = verifyUserAuth(headers);
  if (!userId) {
    res.status(401).send("Unauthorized");
    return;
  }

  try {
    res.json(await requestGenerateAvatarSpeechFromHints(userId, req.body));
  } catch (error) {
    res.status(400).json({ error: error?.message || 'Unable to generate avatar speech.' });
  }
});

router.post('/avatar_voiceover/generate_video_from_hints', async function (req, res) {
  const headers = req.headers;
  const userId = verifyUserAuth(headers);
  if (!userId) {
    res.status(401).send("Unauthorized");
    return;
  }

  try {
    res.json(await requestGenerateAvatarVideoFromHints(userId, req.body));
  } catch (error) {
    res.status(400).json({ error: error?.message || 'Unable to generate avatar video.' });
  }
});

router.post('/avatar_voiceover/accept_video', async function (req, res) {
  const headers = req.headers;
  const userId = verifyUserAuth(headers);
  if (!userId) {
    res.status(401).send("Unauthorized");
    return;
  }

  try {
    res.json(await acceptAvatarVoiceoverVideoForSession(userId, req.body));
  } catch (error) {
    res.status(400).json({ error: error?.message || 'Unable to accept avatar video.' });
  }
});

router.post('/avatar_voiceover/save_video_to_library', async function (req, res) {
  const headers = req.headers;
  const userId = verifyUserAuth(headers);
  if (!userId) {
    res.status(401).send("Unauthorized");
    return;
  }

  try {
    res.json(await saveAvatarVoiceoverVideoToLibrary(userId, req.body));
  } catch (error) {
    res.status(400).json({ error: error?.message || 'Unable to save avatar video.' });
  }
});

router.post('/avatar_voiceover/reject', async function (req, res) {
  const headers = req.headers;
  const userId = verifyUserAuth(headers);
  if (!userId) {
    res.status(401).send("Unauthorized");
    return;
  }

  try {
    res.json(await rejectAvatarVoiceoverTask(userId, req.body));
  } catch (error) {
    res.status(400).json({ error: error?.message || 'Unable to reject avatar video.' });
  }
});

router.post('/get_render_video_status', async function (req, res) {

  try {
    const userId = verifyUserAuth(req.headers);
    const videoRenderStatus = await getVideoRenderStatus({
      ...req.body,
      userId,
    });
    res.send(videoRenderStatus);
  } catch (e) {
    console.error(e);
    res.status(400).send("Error getting video render status");
  }
});

router.post('/update_audio_layers', async function (req, res) {
  const headers = req.headers;

  const userId = verifyUserAuth(headers);
  if (!userId) {
    res.status(401).send("Unauthorized");
    return;
  }
  const payload = req.body;
  await assertEditableRouteAccess(userId, payload);
  const sessionData = await updateAudioLayersForSession(userId, payload);
  await logSharedRouteOperation(userId, payload, {
    operation: 'update_audio_layers',
    category: 'update',
    route: '/video_sessions/update_audio_layers',
  });
  res.json(sessionData);

});

router.post('/update_all_audio_layers', async function (req, res) {
  const headers = req.headers;
  const userId = verifyUserAuth(headers);
  if (!userId) {
    res.status(401).send("Unauthorized");
    return;
  }
  const payload = req.body;
  await assertEditableRouteAccess(userId, payload);
  const sessionData = await updateAllAudioLayersForSession(userId, payload);
  await logSharedRouteOperation(userId, payload, {
    operation: 'update_all_audio_layers',
    category: 'update',
    route: '/video_sessions/update_all_audio_layers',
  });
  res.json(sessionData);
});

router.post('/add_global_audio_from_library', async function (req, res) {
  const headers = req.headers;
  const userId = verifyUserAuth(headers);
  if (!userId) {
    res.status(401).send("Unauthorized");
    return;
  }

  try {
    await assertEditableRouteAccess(userId, req.body);
    const sessionResponseData = await addGlobalAudioFromLibraryToSession(userId, req.body);
    await logSharedRouteOperation(userId, req.body, {
      operation: 'add_global_audio_from_library',
      category: 'update',
      route: '/video_sessions/add_global_audio_from_library',
    });
    res.json(sessionResponseData);
  } catch (error) {
    res.status(400).json({ error: error?.message || 'Unable to add global audio.' });
  }
});

router.post('/update_global_audio_layers', async function (req, res) {
  const headers = req.headers;
  const userId = verifyUserAuth(headers);
  if (!userId) {
    res.status(401).send("Unauthorized");
    return;
  }

  try {
    await assertEditableRouteAccess(userId, req.body);
    const sessionData = await updateGlobalAudioLayersForSession(userId, req.body);
    await logSharedRouteOperation(userId, req.body, {
      operation: 'update_global_audio_layers',
      category: 'update',
      route: '/video_sessions/update_global_audio_layers',
    });
    res.json(sessionData);
  } catch (error) {
    res.status(400).json({ error: error?.message || 'Unable to update global audio layers.' });
  }
});

router.post('/update_global_videos', async function (req, res) {
  const headers = req.headers;
  const userId = verifyUserAuth(headers);
  if (!userId) {
    res.status(401).send("Unauthorized");
    return;
  }

  try {
    await assertEditableRouteAccess(userId, req.body);
    const sessionData = await updateGlobalVideosForSession(userId, req.body);
    await logSharedRouteOperation(userId, req.body, {
      operation: 'update_global_videos',
      category: 'update',
      route: '/video_sessions/update_global_videos',
    });
    res.json(sessionData);
  } catch (error) {
    res.status(400).json({ error: error?.message || 'Unable to update global videos.' });
  }
});

router.post('/update_hints', async function (req, res) {
  const headers = req.headers;
  const userId = verifyUserAuth(headers);
  if (!userId) {
    res.status(401).send("Unauthorized");
    return;
  }

  try {
    await assertEditableRouteAccess(userId, req.body);
    const sessionData = await updateSessionHintsForSession(userId, req.body);
    await logSharedRouteOperation(userId, req.body, {
      operation: 'update_hints',
      category: 'update',
      route: '/video_sessions/update_hints',
    });
    res.json(sessionData);
  } catch (error) {
    res.status(400).json({ error: error?.message || 'Unable to update hints.' });
  }
});

router.post('/duplicate_audio_layer', async function (req, res) {
  const headers = req.headers;
  const userId = verifyUserAuth(headers);
  if (!userId) {
    res.status(401).send("Unauthorized");
    return;
  }

  try {
    await assertEditableRouteAccess(userId, req.body);
    const sessionData = await duplicateAudioLayerInSession(userId, req.body);
    await logSharedRouteOperation(userId, req.body, {
      operation: 'duplicate_audio_layer',
      category: 'update',
      route: '/video_sessions/duplicate_audio_layer',
    });
    res.json(sessionData);
  } catch (error) {
    console.error(error);
    res.status(400).json({ error: error?.message || 'Unable to duplicate audio layer.' });
  }
});



router.post('/add_layer', async function (req, res) {
  const headers = req.headers;

  const userId = verifyUserAuth(headers);
  if (!userId) {
    res.status(401).send("Unauthorized");
    return;
  }
  const payload = req.body;
  await assertEditableRouteAccess(userId, payload);
  const sessionData = await addNewLayerToSession(userId, payload);
  await logSharedRouteOperation(userId, payload, {
    operation: 'add_layer',
    category: 'update',
    route: '/video_sessions/add_layer',
  });
  res.json(sessionData);
});


router.post('/copy_layer', async function (req, res) {
  const headers = req.headers;

  const userId = verifyUserAuth(headers);
  if (!userId) {
    res.status(401).send("Unauthorized");
    return;
  }
  const payload = req.body;
  await assertEditableRouteAccess(userId, payload);
  const sessionData = await copyLayerInSession(userId, payload);
  await logSharedRouteOperation(userId, payload, {
    operation: 'copy_layer',
    category: 'update',
    route: '/video_sessions/copy_layer',
  });
  res.json(sessionData);

});

async function handleCopySession(req, res) {
  const headers = req.headers;

  const userId = verifyUserAuth(headers);
  if (!userId) {
    res.status(401).send("Unauthorized");
    return;
  }

  try {
    const sessionData = await copyVideoSession(userId, req.body);
    res.json(sessionData);
  } catch (error) {
    console.error(error);
    const statusCode = error?.status || 400;
    res.status(statusCode).json({ error: error?.message || 'Unable to copy session.' });
  }
}

router.post('/copy_session', handleCopySession);
router.post('/_copy_session', handleCopySession);

router.post('/remove_layer', async function (req, res) {
  const headers = req.headers;
  const userId = verifyUserAuth(headers);
  if (!userId) {
    res.status(401).send("Unauthorized");
    return;
  }
  const payload = req.body;
  await assertEditableRouteAccess(userId, payload);
  const sessionData = await removeLayerInSession(userId, payload);
  await logSharedRouteOperation(userId, payload, {
    operation: 'remove_layer',
    category: 'update',
    route: '/video_sessions/remove_layer',
  });
  res.json(sessionData);
});


router.post('/update_defaults', async function (req, res) {
  const headers = req.headers;
  const userId = verifyUserAuth(headers);
  if (!userId) {
    res.status(401).send("Unauthorized");
    return;
  }
  const payload = req.body;
  await assertEditableRouteAccess(userId, payload);
  const sessionData = await updateSessionDefaults(userId, payload);
  await logSharedRouteOperation(userId, payload, {
    operation: 'update_defaults',
    category: 'update',
    route: '/video_sessions/update_defaults',
  });
  res.json(sessionData);
});

router.post('/add_layers_via_prompt_list', async function (req, res) {
  const headers = req.headers;
  const userId = verifyUserAuth(headers);
  if (!userId) {
    res.status(401).send("Unauthorized");
    return;
  }
  const payload = req.body;
  await assertEditableRouteAccess(userId, payload);
  const sessionData = await addLayersViaPromptList(userId, payload);
  await logSharedRouteOperation(userId, payload, {
    operation: 'add_layers_via_prompt_list',
    category: 'generation',
    route: '/video_sessions/add_layers_via_prompt_list',
  });
  res.json(sessionData);

});

router.get('/fetch_guest_session', async function (req, res) {

  const guestSessionData = await fetchLatetstGuestSession();
  res.json(guestSessionData);

});

router.get('/get_or_create_session', async function (req, res) {
  const headers = req.headers;
  const userId = verifyUserAuth(headers);
  if (!userId) {
    res.status(401).send("Unauthorized");
    return;
  }
  const sessionData = await getOrCreateSession(userId);
  res.json(sessionData);
});


router.get('/get_session', async function (req, res) {
  const headers = req.headers;
  const userId = verifyUserAuth(headers);
  if (!userId) {
    res.status(401).send("Unauthorized");
    return;
  }
  const sessionData = await getSession(userId);
  res.json(sessionData);
});



router.post('/request_generate_mask', async function (req, res) {
  const headers = req.headers;

  const userId = verifyUserAuth(headers);
  if (!userId) {
    res.status(401).send("Unauthorized");
    return;
  }
  const payload = req.body;
  const sessionData = await requestGenerateMask(userId, payload);
  res.json(sessionData);
});

router.get('/generate_mask_status', async function (req, res) {
  const sessionId = req.query.sessionId;
  const sessionData = await getVideoSessionMaskGenerationStatus(sessionId);
  res.json(sessionData);
});


// GET /video_sessions/list
router.get('/list', async function (req, res) {
  // Verify user
  const headers = req.headers;
  const userId = verifyUserAuth(headers);
  if (!userId) {
    return res.status(401).send('Unauthorized');
  }
  res.setHeader('Cache-Control', 'private, no-store');

  try {
    // Extract query params with defaults
    let {
      page = '1',
      limit = '10',
      renderType = 'All',
      aspectRatio = 'All',
      publishedStatus = 'All',
      completionStatus = 'All',
    } = req.query;

    // Convert to integers
    page = parseInt(page, 10);
    limit = parseInt(limit, 10);

    // Call the model helper for filtering + pagination
    const result = await getUserSessionList(
      userId,
      page,
      limit,
      renderType,
      aspectRatio,
      publishedStatus,
      completionStatus,
    );

    return res.json(result);
  } catch (e) {
    console.error('Error fetching session list:', e);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/delete_session', async function (req, res) {
  const headers = req.headers;
  const userId = verifyUserAuth(headers);
  if (!userId) {
    return res.status(401).send('Unauthorized');
  }

  try {
    const result = await deleteVideoSessionForUser(userId, req.body || {});
    return res.json(result);
  } catch (e) {
    const statusCode = Number.isInteger(e?.statusCode) ? e.statusCode : 400;
    console.error('Error deleting video session:', e);
    return res.status(statusCode).json({
      error: e?.message || 'Unable to delete session.',
    });
  }
});

router.post('/segmentation_image', async function (req, res) {
  const payload = req.body;
  const sessionData = await requestGenerateSegmentationForMask(payload);
  res.json(sessionData);
});

router.post('/update_layers', async function (req, res) {
  const payload = req.body;
  const headers = req.headers;
  const userId = verifyUserAuth(headers);
  if (!userId) {
    res.status(401).send("Unauthorized");
    return;
  }
  await assertEditableRouteAccess(userId, payload);
  const sessionData = await updateSessionLayers(payload);
  await logSharedRouteOperation(userId, payload, {
    operation: 'update_layers',
    category: 'update',
    route: '/video_sessions/update_layers',
  });
  res.json(sessionData);
});

router.post('/request_generate_layered_speech', async function (req, res) {

  const payload = req.body;

  const headers = req.headers;
  const userId = verifyUserAuth(headers);
  if (!userId) {
    res.status(401).send("Unauthorized");
    return;
  }
  await assertEditableRouteAccess(userId, payload);
  const sessionData = await requestGenerateLayeredSpeech(userId, payload);
  await logSharedRouteOperation(userId, payload, {
    operation: 'request_generate_layered_speech',
    category: 'generation',
    route: '/video_sessions/request_generate_layered_speech',
  });
  res.json(sessionData);

});

router.post('/regenerate_frames', async function (req, res) {
  try {
    const payload = req.body;
    const userId = verifyUserAuth(req.headers);
    if (!userId) {
      res.status(401).send("Unauthorized");
      return;
    }
    const sessionId = payload.sessionId;
    await assertEditableRouteAccess(userId, payload);
    const sessionData = await regenerateFramesForSession(sessionId, false, {
      setSessionFrameGenerationPending: false,
    });
    await logSharedRouteOperation(userId, payload, {
      operation: 'regenerate_frames',
      category: 'generation',
      route: '/video_sessions/regenerate_frames',
    });
    res.json(sessionData);
  } catch (error) {
    console.error('Error regenerating frames:', error);
    res.status(400).json({ error: error?.message || 'Failed to regenerate frames' });
  }
});

router.get('/validate_session', async function (req, res) {
  const headers = req.headers;
  const userId = verifyUserAuth(headers);
  if (!userId) {
    res.status(401).send("Unauthorized");
    return;
  }
  const sessionId = req.query.sessionId;
  try {
    const sessionData = await validateSessionDetails({ userId, sessionId: sessionId });
    res.json(sessionData);
  } catch (e) {
    res.status(400).send("Error validating session");

  }
})


router.post('/combine_layer_items', async function (req, res) {


});


router.get('/intro_sessions', async function (req, res) {
  const headers = req.headers;
  const userId = verifyUserAuth(headers);

  if (!userId) {
    res.status(401).send("Unauthorized");
    return;
  }
  const introSessionData = await getIntroSessionList();
  res.json(introSessionData);

});


router.post('/import_session', async function (req, res) {
  const headers = req.headers;
  const userId = verifyUserAuth(headers);
  if (!userId) {
    res.status(401).send("Unauthorized");
    return;
  }
  const { sessionId } = req.body;

  try {
    const sessionData = await importIntroSessionToUser(userId, sessionId);
    res.send(sessionData);
  } catch (e) {
    console.error(e);
    res.status(400).send("Error importing session");
  }

});

router.post('/request_generate_custom_video', async function (req, res) {
  const headers = req.headers;
  const userId = verifyUserAuth(headers);
  if (!userId) {
    res.status(401).send("Unauthorized");
    return;
  }
  const payload = req.body;

  await assertEditableRouteAccess(userId, payload);
  const sessionData = await requestGenerateAIVideoByModel(userId, payload);
  await logSharedRouteOperation(userId, getRouteSessionPayload(payload, { sessionId: payload.videoSessionId }), {
    operation: 'request_generate_custom_video',
    category: 'generation',
    route: '/video_sessions/request_generate_custom_video',
  });
  res.json(sessionData);
});


router.post('/generate_ai_video_status', async function (req, res) {
  const payload = req.body;
  const sessionData = await getAIVideoRenderStatus(payload);

  res.json(sessionData);
});


router.post('/remove_ai_video_layer', async function (req, res) {
  const headers = req.headers;
  const userId = verifyUserAuth(headers);
  if (!userId) {
    res.status(401).send("Unauthorized");
    return;
  }
  await assertEditableRouteAccess(userId, req.body);
  const sessionData = await removeAIVideoLayerForSession(userId, req.body);
  await logSharedRouteOperation(userId, req.body, {
    operation: 'remove_ai_video_layer',
    category: 'update',
    route: '/video_sessions/remove_ai_video_layer',
  });
  res.json(sessionData);
});

router.post('/request_regenerate_subtitles', async function (req, res) {
  const headers = req.headers;
  const userId = verifyUserAuth(headers);
  if (!userId) {
    res.status(401).send("Unauthorized");
    return;
  }
  await assertEditableRouteAccess(userId, req.body);
  const sessionData = await requestRegenerateSubtitles(userId, req.body);
  await logSharedRouteOperation(userId, req.body, {
    operation: 'request_regenerate_subtitles',
    category: 'generation',
    route: '/video_sessions/request_regenerate_subtitles',
  });
  res.json(sessionData);
});


router.post('/request_regenerate_animations', async function (req, res) {

  const headers = req.headers;
  const userId = verifyUserAuth(headers);
  if (!userId) {
    res.status(401).send("Unauthorized");
    return;
  }
  const payload = req.body;
  const sessionId = payload.sessionId;
  await assertEditableRouteAccess(userId, payload);
  await requestRegeneratePresetAnimations(sessionId);
  await logSharedRouteOperation(userId, payload, {
    operation: 'request_regenerate_animations',
    category: 'generation',
    route: '/video_sessions/request_regenerate_animations',
  });
  res.json({});

});

router.post('/set_advanced_theme', async function (req, res) {
  const headers = req.headers;
  const userId = verifyUserAuth(headers);
  if (!userId) {
    res.status(401).send("Unauthorized");
    return;
  }
  const payload = req.body;
  await assertEditableRouteAccess(userId, payload);
  const sessionData = await setAdvancedTheme(userId, payload);
  await logSharedRouteOperation(userId, payload, {
    operation: 'set_advanced_theme',
    category: 'update',
    route: '/video_sessions/set_advanced_theme',
  });
  res.json(sessionData);
});


router.post('/apply_auto_synchronize_animations_to_beats', async function (req, res) {

  const headers = req.headers;
  const userId = verifyUserAuth(headers);
  if (!userId) {
    res.status(401).send("Unauthorized");
    return;
  }
  const payload = req.body;
  const sessionId = payload.id;
  await assertEditableRouteAccess(userId, { ...payload, sessionId });
  await requestApplyAutoSyncLayersToAnimations(sessionId);
  await logSharedRouteOperation(userId, { ...payload, sessionId }, {
    operation: 'apply_auto_synchronize_animations_to_beats',
    category: 'generation',
    route: '/video_sessions/apply_auto_synchronize_animations_to_beats',
  });
  res.json({});
});


router.post('/apply_auto_synchronize_layers_to_beats', async function (req, res) {
  const headers = req.headers;
  const userId = verifyUserAuth(headers);
  if (!userId) {
    res.status(401).send("Unauthorized");
    return;
  }
  const payload = req.body;
  const sessionId = payload.id;
  await assertEditableRouteAccess(userId, { ...payload, sessionId });
  await requestApplyAutoSyncLayersToBeats(sessionId);
  await logSharedRouteOperation(userId, { ...payload, sessionId }, {
    operation: 'apply_auto_synchronize_layers_to_beats',
    category: 'generation',
    route: '/video_sessions/apply_auto_synchronize_layers_to_beats',
  });
  res.json({});


});


router.post('/apply_auto_synchronize_layers_to_animations_and_beats', async function (req, res) {
  const headers = req.headers;
  const userId = verifyUserAuth(headers);
  if (!userId) {
    res.status(401).send("Unauthorized");
    return;
  }
  const payload = req.body;
  const sessionId = payload.id;
  await assertEditableRouteAccess(userId, { ...payload, sessionId });
  await requestApplyAutoSyncBeatsToLayersAndAnimations(sessionId);
  await logSharedRouteOperation(userId, { ...payload, sessionId }, {
    operation: 'apply_auto_synchronize_layers_to_animations_and_beats',
    category: 'generation',
    route: '/video_sessions/apply_auto_synchronize_layers_to_animations_and_beats',
  });
  res.json({});
});


router.post('/add_audio_from_library', async function (req, res) {
  const headers = req.headers;
  const userId = verifyUserAuth(headers);
  if (!userId) {
    res.status(401).send("Unauthorized");
    return;
  }
  await assertEditableRouteAccess(userId, req.body);
  const sessionResponseData = await addAudioFromLibraryToSession(userId, req.body);
  await logSharedRouteOperation(userId, req.body, {
    operation: 'add_audio_from_library',
    category: 'update',
    route: '/video_sessions/add_audio_from_library',
  });
  res.json(sessionResponseData);

});

router.get('/video_library', async function (req, res) {
  const headers = req.headers;
  const userId = verifyUserAuth(headers);
  if (!userId) {
    res.status(401).send("Unauthorized");
    return;
  }

  try {
    const libraryData = await getUserVideoLibrary(userId, req.query);
    res.json(libraryData);
  } catch (error) {
    res.status(400).json({ error: error?.message || 'Unable to load the video library.' });
  }
});

router.post('/upload_audio_library_item', async function (req, res) {
  const headers = req.headers;
  const userId = verifyUserAuth(headers);
  if (!userId) {
    res.status(401).send("Unauthorized");
    return;
  }

  try {
    await assertEditableRouteAccess(userId, req.body);
    const uploadResponse = await uploadAudioLibraryItemForSession(userId, req.body);
    await logSharedRouteOperation(userId, req.body, {
      operation: 'upload_audio_library_item',
      category: 'generation',
      route: '/video_sessions/upload_audio_library_item',
    });
    res.json(uploadResponse);
  } catch (error) {
    res.status(400).json({ error: error?.message || 'Unable to upload audio file.' });
  }
});

router.post('/delete_audio_library_item', async function (req, res) {
  const headers = req.headers;
  const userId = verifyUserAuth(headers);
  if (!userId) {
    res.status(401).send("Unauthorized");
    return;
  }

  try {
    if (req.body?.sessionId) {
      await assertEditableRouteAccess(userId, req.body);
    }
    const deleteResponse = await deleteAudioLibraryItemForSession(userId, req.body);
    await logSharedRouteOperation(userId, req.body, {
      operation: 'delete_audio_library_item',
      category: 'update',
      route: '/video_sessions/delete_audio_library_item',
    });
    res.json(deleteResponse);
  } catch (error) {
    res.status(400).json({ error: error?.message || 'Unable to delete audio library item.' });
  }
});

router.post(
  '/upload_global_video',
  express.raw({
    limit: '512mb',
    type: (req) => {
      const contentType = typeof req.headers['content-type'] === 'string'
        ? req.headers['content-type'].toLowerCase()
        : '';
      return contentType.startsWith('video/') || contentType === 'application/octet-stream';
    },
  }),
  async function (req, res) {
    const headers = req.headers;
    const userId = verifyUserAuth(headers);
    if (!userId) {
      res.status(401).send("Unauthorized");
      return;
    }

    try {
      const payload = {
        sessionId: req.query.sessionId,
        editableShareToken: req.query.editableShareToken,
        fileName: req.query.fileName,
        contentType: req.headers['content-type'],
        startTime: req.query.startTime,
        endTime: req.query.endTime,
        duration: req.query.duration,
        position: req.query.position,
        dimensions: req.query.dimensions,
        shapeOverlay: req.query.shapeOverlay,
        title: req.query.title,
        fileBuffer: Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body || []),
      };
      await assertEditableRouteAccess(userId, payload);
      const uploadResponse = await uploadGlobalVideoForSession(userId, payload);
      await logSharedRouteOperation(userId, payload, {
        operation: 'upload_global_video',
        category: 'generation',
        route: '/video_sessions/upload_global_video',
      });
      res.json(uploadResponse);
    } catch (error) {
      console.error('Failed to upload global video:', error);
      res.status(400).json({ error: error?.message || 'Unable to upload global video.' });
    }
  }
);

router.get('/global_video_status', async function (req, res) {
  const headers = req.headers;
  const userId = verifyUserAuth(headers);
  if (!userId) {
    res.status(401).send("Unauthorized");
    return;
  }

  try {
    const statusResponse = await getGlobalVideoProcessingStatusForSession(userId, {
      sessionId: req.query.sessionId,
      globalVideoId: req.query.globalVideoId,
      editableShareToken: req.query.editableShareToken,
    });
    res.json(statusResponse);
  } catch (error) {
    res.status(400).json({ error: error?.message || 'Unable to get global video status.' });
  }
});


router.post('/apply_audio_track_visualizer', async function (req, res) {
  const headers = req.headers;
  const userId = verifyUserAuth(headers);
  if (!userId) {
    res.status(401).send("Unauthorized");
    return;
  }

  const payload = req.body;
  await assertEditableRouteAccess(userId, { ...payload, sessionId: payload.id });
  await requestGenerateAudioVisualizer(userId, payload);
  await logSharedRouteOperation(userId, { ...payload, sessionId: payload.id }, {
    operation: 'apply_audio_track_visualizer',
    category: 'generation',
    route: '/video_sessions/apply_audio_track_visualizer',
  });

  res.json({});


});

router.post('/add_ai_video_layer', async function (req, res) {

  const headers = req.headers;
  const userId = verifyUserAuth(headers);
  if (!userId) {
    res.status(401).send("Unauthorized");
    return;
  }

  await assertEditableRouteAccess(userId, req.body);
  const sessionData = await addAiVideoLayerToSession(userId, req.body);
  await logSharedRouteOperation(userId, req.body, {
    operation: 'add_ai_video_layer',
    category: 'update',
    route: '/video_sessions/add_ai_video_layer',
  });

  res.json(sessionData);

});

router.post('/add_video_from_library', async function (req, res) {
  const headers = req.headers;
  const userId = verifyUserAuth(headers);
  if (!userId) {
    res.status(401).send("Unauthorized");
    return;
  }

  try {
    await assertEditableRouteAccess(userId, req.body);
    const sessionData = await addVideoFromLibraryToSession(userId, req.body);
    await logSharedRouteOperation(userId, req.body, {
      operation: 'add_video_from_library',
      category: 'update',
      route: '/video_sessions/add_video_from_library',
    });
    res.json(sessionData);
  } catch (error) {
    res.status(400).json({ error: error?.message || 'Unable to add the selected video to the layer.' });
  }
});

router.post('/request_video_layer_edit', async function (req, res) {
  const headers = req.headers;
  const userId = verifyUserAuth(headers);
  if (!userId) {
    res.status(401).send("Unauthorized");
    return;
  }

  try {
    const response = await requestVideoLayerEdit(userId, req.body);
    await logSharedRouteOperation(userId, req.body, {
      operation: 'request_video_layer_edit',
      category: 'generation',
      route: '/video_sessions/request_video_layer_edit',
    });
    res.json(response);
  } catch (error) {
    res.status(400).json({ error: error?.message || 'Unable to queue the video edit.' });
  }
});

router.post(
  '/upload_user_video_layer_chunk',
  express.raw({
    limit: '16mb',
    type: (req) => {
      const contentType = typeof req.headers['content-type'] === 'string'
        ? req.headers['content-type'].toLowerCase()
        : '';
      return contentType.startsWith('video/') || contentType === 'application/octet-stream';
    },
  }),
  async function (req, res) {
    const headers = req.headers;
    const userId = verifyUserAuth(headers);
    if (!userId) {
      res.status(401).send("Unauthorized");
      return;
    }

    try {
      const payload = {
        sessionId: req.query.sessionId,
        layerId: req.query.layerId,
        editableShareToken: req.query.editableShareToken,
        uploadId: req.query.uploadId,
        chunkIndex: req.query.chunkIndex,
        totalChunks: req.query.totalChunks,
        totalFileSize: req.query.totalFileSize,
        fileName: req.query.fileName,
        contentType: req.headers['content-type'],
        fileBuffer: Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body || []),
      };

      await assertEditableRouteAccess(userId, payload);
      const uploadResult = await appendUserVideoLayerUploadChunk(userId, payload);
      await logSharedRouteOperation(userId, payload, {
        operation: 'upload_user_video_layer_chunk',
        category: 'generation',
        route: '/video_sessions/upload_user_video_layer_chunk',
      });
      res.status(uploadResult.complete ? 202 : 200).json(uploadResult);
    } catch (error) {
      console.error('Failed to upload user video layer chunk:', error);
      res.status(400).json({ error: error?.message || 'Failed to upload user video chunk.' });
    }
  }
);

router.post(
  '/upload_user_video_layer',
  express.raw({
    limit: '2gb',
    type: (req) => {
      const contentType = typeof req.headers['content-type'] === 'string'
        ? req.headers['content-type'].toLowerCase()
        : '';
      return contentType.startsWith('video/') || contentType === 'application/octet-stream';
    },
  }),
  async function (req, res) {
    const headers = req.headers;
    const userId = verifyUserAuth(headers);
    if (!userId) {
      res.status(401).send("Unauthorized");
      return;
    }

    try {
      const payload = {
        sessionId: req.query.sessionId,
        layerId: req.query.layerId,
        editableShareToken: req.query.editableShareToken,
        fileName: req.query.fileName,
        contentType: req.headers['content-type'],
        fileBuffer: Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body || []),
      };

      await assertEditableRouteAccess(userId, payload);
      const sessionData = await startUserVideoLayerUploadTask(userId, payload);
      await logSharedRouteOperation(userId, payload, {
        operation: 'upload_user_video_layer',
        category: 'generation',
        route: '/video_sessions/upload_user_video_layer',
      });
      res.status(202).json(sessionData);
    } catch (error) {
      console.error('Failed to upload user video layer:', error);
      res.status(400).json({ error: error?.message || 'Failed to upload user video.' });
    }
  }
);


router.post('/update_layers_order', async (req, res) => {
  try {

    const payload = req.body;

    const userId = verifyUserAuth(req.headers);

    if (!userId) {
      res.status(401).send("Unauthorized");
      return;
    }

    await assertEditableRouteAccess(userId, payload);
    const updatedSession = await updateLayersOrder(payload);
    await logSharedRouteOperation(userId, payload, {
      operation: 'update_layers_order',
      category: 'update',
      route: '/video_sessions/update_layers_order',
    });
    res.json({ layers: updatedSession.layers });



  } catch (error) {
    console.error('Error updating layers order:', error);
    res.status(500).json({ error: 'Failed to update layers order' });
  }
});

router.post('/request_realign_layers_to_speech_and_regen_sub', async (req, res) => {
  try {

    const payload = req.body;

    const userId = verifyUserAuth(req.headers);

    if (!userId) {
      res.status(401).send("Unauthorized");
      return;
    }

    await assertEditableRouteAccess(userId, payload);
    const updatedSession = await requestRealignLayersToSpeechAndRegenerateSubtitles(userId, payload);
    await logSharedRouteOperation(userId, payload, {
      operation: 'request_realign_layers_to_speech_and_regen_sub',
      category: 'generation',
      route: '/video_sessions/request_realign_layers_to_speech_and_regen_sub',
    });
    res.json(updatedSession);

  } catch (error) {
    console.error('Error realigning layers to speech:', error);
    res.status(500).json({ error: 'Failed to realign layers to speech' });
  }
});

router.post('/request_realign_to_ai_video_and_layers', async function (req, res) {
  try {

    const payload = req.body;

    const userId = verifyUserAuth(req.headers);

    if (!userId) {
      res.status(401).send("Unauthorized");
      return;
    }

    await assertEditableRouteAccess(userId, payload);
    const updatedSession = await requestRealignLayersToAiVideoLayerAndRegenerateSubtitles(userId, payload);
    await logSharedRouteOperation(userId, payload, {
      operation: 'request_realign_to_ai_video_and_layers',
      category: 'generation',
      route: '/video_sessions/request_realign_to_ai_video_and_layers',
    });
    res.json(updatedSession);

  } catch (error) {

  }
});

router.post('/request_realign_layers', async function (req, res) {
  try {
    const payload = req.body;
    const userId = verifyUserAuth(req.headers);

    if (!userId) {
      res.status(401).send("Unauthorized");
      return;
    }

    await assertEditableRouteAccess(userId, payload);
    const updatedSession = await requestRealignLayersAndRegenerateFrames(userId, payload);
    await logSharedRouteOperation(userId, payload, {
      operation: 'request_realign_layers',
      category: 'generation',
      route: '/video_sessions/request_realign_layers',
    });
    res.json(updatedSession);
  } catch (error) {
    console.error('Error realigning layers and regenerating frames:', error);
    res.status(500).json({ error: 'Failed to realign layers and regenerate frames' });
  }
});


router.post('/update_movie_gen_speakers', async function (req, res) {
  try {

    const payload = req.body;

    const userId = verifyUserAuth(req.headers);

    if (!userId) {
      res.status(401).send("Unauthorized");
      return;
    }

    await assertEditableRouteAccess(userId, payload);
    const updatedSession = await updateSessionMovieGenSpeakers(userId, payload);
    await logSharedRouteOperation(userId, payload, {
      operation: 'update_movie_gen_speakers',
      category: 'update',
      route: '/video_sessions/update_movie_gen_speakers',
    });
    res.json(updatedSession);

  } catch (error) {
    console.error('Error updating movie gen speakers:', error);
    res.status(500).json({ error: 'Failed to update movie gen speakers' });
  }
});

router.post('/request_lip_sync_to_speech', async function (req, res) {
  try {

    const payload = req.body;

    const userId = verifyUserAuth(req.headers);

    if (!userId) {
      res.status(401).send("Unauthorized");
      return;
    }

    await assertEditableRouteAccess(userId, payload);
    const updatedSession = await requestGenerateLipSync(userId, payload);
    await logSharedRouteOperation(userId, payload, {
      operation: 'request_lip_sync_to_speech',
      category: 'generation',
      route: '/video_sessions/request_lip_sync_to_speech',
    });
    res.json(updatedSession);

  } catch (error) {
    console.error('Error realigning layers to speech:', error);
    const statusCode = error?.status || 500;
    const errorMessage = statusCode >= 500
      ? 'Failed to realign layers to speech'
      : (error?.message || 'Failed to realign layers to speech');
    res.status(statusCode).json({ error: errorMessage });
  }
});

router.post('/add_synced_sound_effect', async function (req, res) {
  try {

    const payload = req.body;

    const userId = verifyUserAuth(req.headers);

    if (!userId) {
      res.status(401).send("Unauthorized");
      return;
    }

    await assertEditableRouteAccess(userId, payload);
    const updatedSession = await requestGenerateSyncedSoundEffectVideo(userId, payload);
    await logSharedRouteOperation(userId, payload, {
      operation: 'add_synced_sound_effect',
      category: 'generation',
      route: '/video_sessions/add_synced_sound_effect',
    });
    res.json(updatedSession);

  } catch (error) {
    console.error('Error realigning layers to speech:', error);
    res.status(500).json({ error: 'Failed to realign layers to speech' });
  }
});


router.post('/publish_session', async function (req, res) {
  let userId = null;
  try {

    const payload = req.body;

    userId = verifyUserAuth(req.headers);

    if (!userId) {
      res.status(401).send("Unauthorized");
      return;
    }

    const publication = await createPublicationForSessionVideo(userId, payload);
    const session = await VideoSessionDocument.findById(payload.id || payload.sessionId)
      .select({
        ispublishedVideo: 1,
        publishedTitle: 1,
        publishedDescription: 1,
        publishedTags: 1,
        publishedAspectRatio: 1,
        publishedVideoURL: 1,
        publishedAt: 1,
        publishedOriginalPrompt: 1,
        publishedSplashImage: 1,
        publishedImageModel: 1,
        publishedVideoModel: 1,
        publishedHasSubtitles: 1,
        publishedSessionLanguage: 1,
        publishedLanguageString: 1,
        publishedPublicationId: 1,
      })
      .lean();

    if (!session || session.ispublishedVideo !== true) {
      const error = new Error('Publication succeeded, but the session is not marked as published.');
      error.statusCode = 500;
      throw error;
    }

    const publicationResponse = publication?.toObject?.() || publication || {};
    res.json({
      ...publicationResponse,
      publication: publicationResponse,
      session: {
        ...session,
        isPublished: true,
        ispublishedVideo: true,
      },
      isPublished: true,
      ispublishedVideo: true,
    });

  } catch (error) {
    const statusCode = Number.isInteger(error?.statusCode)
      ? error.statusCode
      : Number.isInteger(error?.status)
        ? error.status
        : 500;
    const message = error?.message || 'Failed to publish video session';
    console.error('Error publishing video session:', {
      sessionId: req.body?.id || req.body?.sessionId || null,
      userId,
      statusCode,
      message,
      stack: error?.stack,
    });
    res.status(statusCode).json({
      error: message,
      code: 'PUBLISH_SESSION_FAILED',
    });
  }
});

router.post('/unpublish_session', async function (req, res) {
  try {
    const payload = req.body;
    const userId = verifyUserAuth(req.headers);

    if (!userId) {
      res.status(401).send('Unauthorized');
      return;
    }

    const response = await unpublishSessionVideo(userId, payload);
    res.json(response);
  } catch (error) {
    const statusCode = error?.statusCode || 500;
    console.error('Error unpublishing video session:', error);
    res.status(statusCode).json({
      error:
        statusCode === 403
          ? 'Forbidden'
          : 'Failed to unpublish video session',
    });
  }
});


router.post('/generate_meta', async function (req, res) {
  try {

    const payload = req.body;

    const userId = verifyUserAuth(req.headers);

    if (!userId) {
      res.status(401).send("Unauthorized");
      return;
    }



    const pubResponse = await createMetaForSession(userId, payload);


    res.send(pubResponse);

  } catch (error) {
    console.error('Error realigning layers to speech:', error);
    res.status(500).json({ error: 'Failed to realign layers to speech' });
  }
});


// You can add more session-related routes here

export default router;
