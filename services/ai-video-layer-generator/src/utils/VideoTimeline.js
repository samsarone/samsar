import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import ffmpeg from 'fluent-ffmpeg';
import { secondsToFrameCount, frameCountToSeconds } from './FrameClock.js';

export function probeMedia(videoPath, options = []) {
  return new Promise((resolve, reject) => ffmpeg.ffprobe(videoPath, options,
    (error, metadata) => error ? reject(error) : resolve(metadata)));
}

// Use the video presentation interval, never the audio/container end time.
export async function getVideoTimeline(videoPath, framesPerSecond = 24) {
  const metadata = await probeMedia(videoPath);
  const video = metadata.streams?.find(stream => stream.codec_type === 'video');
  if (!video) throw new Error('Video stream is missing.');
  let startTime = Number(video.start_time) || 0;
  let duration = Number(video.duration);
  if (!Number.isFinite(duration) || duration <= 0) {
    const { stdout } = await promisify(execFile)(process.env.FFPROBE_PATH || 'ffprobe', [
      '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'packet=pts_time,duration_time', '-of', 'json', videoPath,
    ], { maxBuffer: 32 * 1024 * 1024 });
    const packetData = JSON.parse(stdout);
    const packets = (packetData.packets || []).filter(packet => Number.isFinite(Number(packet.pts_time)));
    if (!packets.length) throw new Error('Unable to determine video presentation duration.');
    startTime = packets.reduce((min, packet) => Math.min(min, Number(packet.pts_time)), Infinity);
    const endTime = packets.reduce((max, packet) => Math.max(max, Number(packet.pts_time) + (Number(packet.duration_time) || 0)), -Infinity);
    duration = endTime - startTime;
  }
  const frameCount = secondsToFrameCount(duration, framesPerSecond);
  if (frameCount < 1) throw new Error('Video contains no frames on the requested timeline.');
  return { startTime, duration: frameCountToSeconds(frameCount, framesPerSecond), frameCount,
    hasAudio: metadata.streams.some(stream => stream.codec_type === 'audio') };
}

export function buildVideoAudioFilter({ startTime = 0, duration }) {
  if (!Number.isFinite(duration) || duration <= 0) throw new Error('A positive video duration is required.');
  return `asetpts=PTS-(${startTime})/TB,aresample=async=1:first_pts=0,apad,atrim=duration=${duration},asetpts=N/SR/TB`;
}
