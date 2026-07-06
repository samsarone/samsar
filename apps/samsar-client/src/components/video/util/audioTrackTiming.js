export function getAudioTrackTimeBounds(audioTrack = {}) {
  const parsedStartTime = Number(audioTrack?.startTime);
  const startTime = Number.isFinite(parsedStartTime) ? parsedStartTime : 0;
  const parsedEndTime = Number(audioTrack?.endTime);
  const parsedDuration = Number(audioTrack?.duration);
  const parsedOriginalDuration = Number(audioTrack?.originalDuration);
  const explicitEndTime = Number.isFinite(parsedEndTime) && parsedEndTime > startTime
    ? parsedEndTime
    : null;
  const durationEndTime = Number.isFinite(parsedDuration) && parsedDuration > 0
    ? startTime + parsedDuration
    : null;
  const originalDurationEndTime = Number.isFinite(parsedOriginalDuration) && parsedOriginalDuration > 0
    ? startTime + parsedOriginalDuration
    : null;
  const canExtendPastSourceDuration = Boolean(
    audioTrack?.loopOverEntireSession
    || audioTrack?.loop
    || audioTrack?.isLooped
  );

  if (explicitEndTime !== null && canExtendPastSourceDuration) {
    return { startTime, endTime: explicitEndTime };
  }

  const candidateEndTimes = [
    explicitEndTime,
    durationEndTime,
    originalDurationEndTime,
  ].filter((endTime) => Number.isFinite(endTime) && endTime >= startTime);

  return {
    startTime,
    endTime: candidateEndTimes.length > 0 ? Math.min(...candidateEndTimes) : startTime,
  };
}

export function getAudioTrackFrameBounds(audioTrack = {}, displayFramesPerSecond = 30) {
  const { startTime, endTime } = getAudioTrackTimeBounds(audioTrack);
  const resolvedFramesPerSecond = Number(displayFramesPerSecond) || 30;

  return {
    startFrame: startTime * resolvedFramesPerSecond,
    endFrame: endTime * resolvedFramesPerSecond,
  };
}
