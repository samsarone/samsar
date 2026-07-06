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

installStructuredLogger({
  serviceName: process.env.SERVICE_NAME || 'samsar_audio_generator',
  component: 'music_generator_worker',
});

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

  const staleLockCutoff = new Date(Date.now() - 5 * 60 * 1000);
  await AudioGeneration.updateMany(
    {
      rowLocked: true,
      updatedAt: { $lt: staleLockCutoff },
      status: { $in: ['INIT', 'PENDING'] },
    },
    {
      $set: { rowLocked: false },
    }
  );

  const pendingAudioGenerationRequests = await AudioGeneration.find({
    rowLocked: false,
    
  }).limit(10);

  const lockedRequests = await Promise.all(
    pendingAudioGenerationRequests.map(async (request) => {
      const lockedRequest = await AudioGeneration.findOneAndUpdate(
        { _id: request._id, rowLocked: false },
        { $set: { rowLocked: true } },
        { new: true }
      );
      return lockedRequest;
    })
  );

  const filteredLockedRequests = lockedRequests.filter(Boolean);

  const chunks = [];
  for (let i = 0; i < filteredLockedRequests.length; i += 3) {
    chunks.push(filteredLockedRequests.slice(i, i + 3));
  }

  for (const chunk of chunks) {
    await Promise.all(chunk.map(async (audioGenerationRequest) => {
      try {
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
      } catch (error) {
        console.error(`Error processing request ${audioGenerationRequest._id}:`, error);
        await markAudioGenerationAsFailed(
          audioGenerationRequest._id,
          error?.message || 'Audio generation worker failed.'
        );
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
