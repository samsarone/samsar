import { getDBConnectionString } from "./DBString.js";
import AudioGeneration from "./schema/AudioGeneration.js";

import { fileURLToPath } from 'url';
import { processMusicEffectRequest } from './sound_effects/index.js';
import { dispatchSpeechRequest} from './speech/SpeechRequestDispatcher.js';
import { processAvatarVoiceoverSpeechRequest } from './speech/AvatarVoiceoverSpeech.js';

import { dispatchAndProcessMusicRequest} from './music/MusicDispatcher.js';
import { markAudioGenerationAsFailed } from './music/audioUtils.js';


import path from 'path';
import { installStructuredLogger } from './utils/StructuredLogger.js';
import { resolveCpuUpperBound } from './utils/CpuResources.js';
import { isSubmissionOutcomeUnknownError } from './utils/ProviderSubmissionSafety.js';
import { recoverAudioProviderNetworkError, canDispatchAudioRequest, recoverExpiredAudioSubmissions } from './utils/AudioNetworkRecovery.js';
import { createNetworkOutageCircuit } from './utils/NetworkOutagePolicy.js';

const networkOutageCircuit = createNetworkOutageCircuit();

installStructuredLogger({
  serviceName: process.env.SERVICE_NAME || 'samsar_audio_generator',
  component: 'music_generator_worker',
});

const MAX_CONCURRENT_REQUESTS = resolveCpuUpperBound(
  process.env.SAMSAR_AUDIO_MAX_CONCURRENT_REQUESTS,
  3,
);

export async function processPendingAudioRequests() {
  while (true) {
    try {
      await getTimeout(1000);
      await checkForPendingRequestsAndGenerate();
    } catch (error) {
      console.error('Audio generator loop error; continuing', error);
      await getTimeout(1000);
    }
  }
}

async function getTimeout(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function checkForPendingRequestsAndGenerate() {
  await getDBConnectionString();
  await recoverExpiredAudioSubmissions({ markFailed: markAudioGenerationAsFailed });
  const admission = await networkOutageCircuit.gate();

  const staleLockCutoff = new Date(Date.now() - 5 * 60 * 1000);
  await AudioGeneration.updateMany(
    {
      rowLocked: true,
      updatedAt: { $lt: staleLockCutoff },
      status: { $in: ['INIT', 'PENDING'] },
      $or: [{ providerSubmissionStartedAt: null, providerSubmissionLeaseExpiresAt: null }, {
        status: 'PENDING', providerSubmissionLeaseExpiresAt: { $lte: new Date() },
      }],
    },
    {
      $set: { rowLocked: false },
    }
  );

  const pendingAudioGenerationRequests = await AudioGeneration.find({
    rowLocked: false,
    // Accepted work can poll/download even while new submissions cool down.
    status: { $in: admission.allowed ? ['INIT', 'PENDING'] : ['PENDING'] },
    $or: [{ nextAttemptAfter: { $exists: false } }, { nextAttemptAfter: null }, { nextAttemptAfter: { $lte: new Date() } }],
  }).limit(MAX_CONCURRENT_REQUESTS);

  const lockedRequests = await Promise.all(
    pendingAudioGenerationRequests.map(async (request) => {
      const lockedRequest = await AudioGeneration.findOneAndUpdate(
        { _id: request._id, rowLocked: false, status: request.status },
        { $set: { rowLocked: true,
          providerSubmissionLeaseExpiresAt: new Date(Date.now() + 15 * 60 * 1000),
          ...(request.status === 'INIT' ? { providerSubmissionStartedAt: new Date() } : {}),
        } },
        { new: true }
      );
      return lockedRequest;
    })
  );

  const filteredLockedRequests = lockedRequests.filter(Boolean);

  const chunks = [];
  for (let i = 0; i < filteredLockedRequests.length; i += MAX_CONCURRENT_REQUESTS) {
    chunks.push(filteredLockedRequests.slice(i, i + MAX_CONCURRENT_REQUESTS));
  }

  for (const chunk of chunks) {
    await Promise.all(chunk.map(async (audioGenerationRequest) => {
      try {
        if (!await canDispatchAudioRequest(audioGenerationRequest)) {
          await AudioGeneration.updateOne({ _id: audioGenerationRequest._id, rowLocked: true }, { $set: { rowLocked: false } });
          return;
        }
        if (audioGenerationRequest.status === 'INIT' && !(await networkOutageCircuit.gate()).allowed) {
          await AudioGeneration.updateOne({ _id: audioGenerationRequest._id, status: 'INIT' }, { $set: { rowLocked: false } });
          return;
        }
        const { generationType, isStreamGenerationPending } = audioGenerationRequest;
        

        if (generationType === 'music') {

          await dispatchAndProcessMusicRequest(audioGenerationRequest);
          if (audioGenerationRequest) {
            await AudioGeneration.findOneAndUpdate(
              { _id: audioGenerationRequest._id },
              { $set: { rowLocked: false } }
            );
          }
        } else if (generationType === 'speech') {

          
          await dispatchSpeechRequest(audioGenerationRequest);
          
        } else if (generationType === 'avatar_voiceover_speech') {

          await processAvatarVoiceoverSpeechRequest(audioGenerationRequest);

        } else if (generationType === 'sound') {

          await processMusicEffectRequest(audioGenerationRequest);
        }
        if (audioGenerationRequest.status === 'PENDING') {
          networkOutageCircuit.recordSuccess();
          if (audioGenerationRequest.providerNetworkErrorCount > 0) {
            await AudioGeneration.updateOne({ _id: audioGenerationRequest._id, status: 'PENDING',
              providerNetworkErrorCount: audioGenerationRequest.providerNetworkErrorCount }, { $set: {
              providerNetworkErrorCount: 0, providerNetworkFirstErrorAt: null, nextAttemptAfter: null,
            } });
          }
        }
      } catch (error) {
        networkOutageCircuit.recordFailure(error);
        console.error(`Error processing request ${audioGenerationRequest._id}:`, error);
        if (await recoverAudioProviderNetworkError(audioGenerationRequest, error, {
          markFailed: markAudioGenerationAsFailed, ambiguous: isSubmissionOutcomeUnknownError(error),
          definitive: error?.providerMediaUnavailable === true,
        })) return;
        if (
          audioGenerationRequest.status === 'PENDING' &&
          (audioGenerationRequest.apiRequestId || audioGenerationRequest.generationId)
        ) {
          // A polling/download failure does not invalidate the submitted job.
          // Keep its adapter and request id so the next pass polls the same job.
          await AudioGeneration.findByIdAndUpdate(audioGenerationRequest._id, {
            rowLocked: false,
            error: error?.message || 'Audio provider polling failed.',
          });
          return;
        }
        await markAudioGenerationAsFailed(
          audioGenerationRequest._id,
          error?.message || 'Audio generation worker failed.'
        );
        if (isSubmissionOutcomeUnknownError(error)) {
          await AudioGeneration.findByIdAndUpdate(audioGenerationRequest._id, {
            submissionOutcomeUnknown: true,
            rowLocked: false,
          });
          return;
        }
        await AudioGeneration.deleteOne({ _id: audioGenerationRequest._id });
      }
    }));
  }
}

// ES Module equivalent of "require.main === module"
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

if (process.argv[1] === __filename) {
  processPendingAudioRequests().catch((error) => {
    console.error('Audio generator worker failed fatally', error);
    process.exit(1);
  });
}
