


import ffmpeg from 'fluent-ffmpeg';
import { promisify } from 'util';




export async function padBlankAudioAtBeginningAndEnd(
  inputAudioPath,
  layerDuration,
  outputAudioPath,
  startOffset = 0
) {
  const targetDuration = Number(layerDuration);
  if (!Number.isFinite(targetDuration) || targetDuration <= 0) {
    throw new Error('Invalid target duration for padded audio');
  }
  const safeStartOffset = Math.min(
    Math.max(0, Number(startOffset) || 0),
    targetDuration
  );

  // 1) Get original audio duration using ffprobe
  const ffprobePromise = promisify(ffmpeg.ffprobe);
  const audioMetadata = await ffprobePromise(inputAudioPath);
  const audioStreams = audioMetadata.streams.find(s => s.codec_type === 'audio');
  if (!audioStreams) {
    throw new Error('No audio stream found in the file');
  }
  const inputAudioDuration = Math.max(0, Number(audioStreams.duration) || 0);

  // 2) Calculate end-padding (in seconds). If negative, no end pad is applied.
  const endOffset = targetDuration - safeStartOffset - inputAudioDuration;
  const endPad = endOffset > 0 ? endOffset : 0;

  // 3) Build up ffmpeg filters
  //    - adelay adds silence at the beginning (in milliseconds).
  //    - apad pads silence at the end (in seconds).
  //    - atrim caps overlong audio to the exact layer duration.
  const delayMs = Math.round(safeStartOffset * 1000);
  const adelayFilter = `adelay=${delayMs}|${delayMs}`;
  const apadFilter = `apad=pad_dur=${endPad}`;
  const trimFilter = `atrim=duration=${targetDuration}`;

  // 4) Run ffmpeg to generate a new file with padded audio
  return new Promise((resolve, reject) => {
    ffmpeg()
      .input(inputAudioPath)
      .audioFilters([adelayFilter, apadFilter, trimFilter, 'asetpts=PTS-STARTPTS'])
      .duration(targetDuration)
      .on('error', reject)
      .on('end', () => {
        resolve(outputAudioPath);
      })
      .save(outputAudioPath);
  });
}


